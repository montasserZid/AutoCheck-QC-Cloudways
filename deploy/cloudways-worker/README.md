# AutoCheck QC - Cloudways Extraction Worker

Moves the **Puppeteer/Chrome workload** off Vercel serverless and onto the Cloudways
Debian 12 host. The AutoCheck app and Supabase stay on Vercel unchanged.

```
Browser -> AutoCheck Next.js API (/api/listing-extraction)
        -> authenticated HTTPS -> worker-gateway.php (Cloudways, public HTTPS)
        -> http://127.0.0.1:3000 -> Node worker -> Puppeteer -> Chrome -> listing
        -> rendered listing JSON -> AutoCheck parser (unchanged)
```

## Architecture boundary

This is the whole design: **the worker does browser/network work, AutoCheck keeps
parsing.** No extraction, normalization or provenance logic is duplicated.

| AutoCheck (Vercel) | Worker (Cloudways) |
| --- | --- |
| `src/server/listing/browserWorker.ts` (authenticated client) | `src/server.ts` (HTTP surface, auth, concurrency) |
| `src/lib/listingUrlExtraction.ts` (parsing/normalization/provenance - **authoritative**) | `src/render.ts` (reuses `resolvePublicUrl` + `renderFacebookMarketplaceListing`) |
| `src/lib/listingUrlClient.ts`, `VehicleIntakeFlow.tsx` (**unchanged**) | `src/auth.ts`, `src/logging.ts` |

The worker imports AutoCheck's *existing* modules rather than a second copy, so:

- SSRF protection is literally the same code (`resolvePublicUrl`, `ListingFetchError`).
- Facebook redirect re-validation is literally the same code (`assertFacebookNavigation`).
- Chrome is cleaned up by the existing `try/finally`, now with a forced SIGKILL fallback.

Only the Facebook branch ever launched a browser, so only that branch changed. The
non-Facebook secure-fetch path is untouched and still runs on Vercel.

## Files

| File | Purpose |
| --- | --- |
| `src/main.ts` | Entry point. Refuses non-loopback bind, requires the secret, handles SIGTERM. |
| `src/server.ts` | `/health`, `/extract`, auth, bounded concurrency, JSON errors, logging. |
| `src/render.ts` | SSRF pre-check + existing Facebook renderer. Returns rendered text only. |
| `src/auth.ts` | Constant-time secret comparison. |
| `src/logging.ts` | Single-line JSON logs with secret redaction. |
| `public_html/worker-gateway.php` | Thin HTTPS gateway. Fixed backend `127.0.0.1:3000`. |
| `scripts/sync-shared-sources.mjs` | Copies the shared AutoCheck modules into `vendor/` (see below). |
| `scripts/facebookStructured.ts` | Pure parsers/survey for the experimental structured diagnostic (never imported by production). |
| `scripts/facebook-structured-diagnostic.ts` | Standalone CLI: anonymous HTTP + Relay probe for one item URL. Emits safe JSON. |
| `types/sparticuz-chromium.stub.d.ts` | Compile-time only type for the Vercel-only Sparticuz import. |
| `start-worker.sh` / `stop-worker.sh` / `restart-worker.sh` | `nohup` lifecycle with PID file. |
| `.env.example` | Configuration template. |

`node_modules/`, `dist/`, `vendor/`, `.env`, `worker.log` and `worker.pid` are git-ignored.
Chrome and the locally installed Debian libraries are **not** part of this directory;
they already exist on the server.

## Package layout

The deployed worker is one **self-contained tree** rooted at
`/home/master/autocheck-worker`, with `node_modules` directly inside it:

```
/home/master/autocheck-worker/
  src/          main.ts, server.ts, render.ts, auth.ts, logging.ts
  vendor/src/   copied AutoCheck modules (server/listing/*, lib/*, types/domain.ts)
  scripts/      sync-shared-sources.mjs + the experimental structured diagnostic
  types/        sparticuz-chromium.stub.d.ts
  node_modules/ puppeteer-core
  dist/         dist/src/main.js + dist/scripts/*.js + dist/vendor/src/**
```

This layout matters because Node resolves `puppeteer-core` by walking **upwards** from
the importing file. If the shared AutoCheck modules lived outside the worker directory
(for example `/home/master/src`), no ancestor directory would contain the worker's
`node_modules` and the build fails with `Cannot find module 'puppeteer-core'`.

`scripts/sync-shared-sources.mjs` therefore copies the shared modules into `vendor/src/`
before every build. The file list is derived from the transitive relative-import closure
of the two entry modules, so a new AutoCheck import cannot silently break the deployment.
The copies are never edited by hand: the repository `src/` is the only source of truth.

`npm run build` then compiles with `rootDir: "."`, so **everything** is emitted under
`dist/` (`dist/src/main.js`, `dist/vendor/src/...`) and every compiled file resolves
modules through the worker's own `node_modules`.

### `@sparticuz/chromium`

The shared Facebook renderer keeps a lazy `await import("@sparticuz/chromium")` branch
for Vercel/Render. **Cloudways never takes that branch**: `resolveFacebookBrowserExecutable()`
returns `{ kind: "local" }` as soon as `CHROME_EXECUTABLE_PATH` is set, which
`start-worker.sh` always sets (and `start-worker.sh` clears `VERCEL`/`RENDER` so no stray
marker can select it). Installing the real package would only download a second, unused
Chromium, so `types/sparticuz-chromium.stub.d.ts` supplies the type through a tsconfig
`paths` mapping instead. The Vercel application still resolves the real package from the
repository root `node_modules`.

## Prerequisites (already satisfied on this host)

- Node.js v20.5.1, npm 9.8.0, no sudo/root.
- Chrome at `/home/master/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`.
- Chrome libraries under `/home/master/chrome-libs/root`.
- Cloudways PHP application `mwgyfxvkun` with public HTTPS.

## Deploy

### First deployment (Windows / PowerShell)

Run from the AutoCheck repository. `$Server` is the Cloudways host and `$User` is the
master account (`master_dwzpyzstbx`, not plain `master`).

```powershell
cd "C:\Users\novitek\Desktop\AutoCheck QC"
$Server = "phpstack-1676372-6705476.cloudwaysapps.com"
$User   = "master_dwzpyzstbx"
$WorkerSrc = "$PWD\deploy\cloudways-worker"

# 1. Refresh the vendored shared AutoCheck modules (generated, git-ignored).
npm run sync:worker-sources

# 2. Create the worker directory. Cloudways SCP uses a RELATIVE destination:
#    "autocheck-worker/" (SSH sees it as /home/master/autocheck-worker).
ssh "$User@$Server" "mkdir -p /home/master/autocheck-worker"

# 3. Copy the worker package. vendor/ MUST be included: it is what the build compiles.
scp -r "$WorkerSrc\src" "$WorkerSrc\scripts" "$WorkerSrc\types" "$WorkerSrc\vendor" `
      "$WorkerSrc\public_html" "$WorkerSrc\package.json" "$WorkerSrc\tsconfig.json" `
      "$WorkerSrc\.env.example" "$WorkerSrc\start-worker.sh" "$WorkerSrc\stop-worker.sh" `
      "$WorkerSrc\restart-worker.sh" "$WorkerSrc\README.md" `
      "$User@$Server:autocheck-worker/"

# 4. PHP gateway to the application web root (absolute path: not under the SSH cwd).
scp "$WorkerSrc\public_html\worker-gateway.php" `
    "$User@$Server:/home/master/applications/mwgyfxvkun/public_html/worker-gateway.php"
```

Then configure, install, build and start on the host:

```bash
ssh master_dwzpyzstbx@phpstack-1676372-6705476.cloudwaysapps.com
cd /home/master/autocheck-worker
cp .env.example .env
sed -i "s|^AUTOCHECK_WORKER_SECRET=.*|AUTOCHECK_WORKER_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^CHROME_EXECUTABLE_PATH=.*|CHROME_EXECUTABLE_PATH=/home/master/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome|" .env
sed -i "s|^AUTOCHECK_CHROME_ARGS=.*|AUTOCHECK_CHROME_ARGS=--no-sandbox --disable-setuid-sandbox|" .env
chmod +x *.sh
npm install --no-audit --no-fund
npm run build
./start-worker.sh
```

`npm run build` prints `[sync-shared-sources] using the existing vendor/ tree` on the host
(no repository there) and emits `dist/src/main.js`. `.env` already exists after the first
deployment, so skip steps 3-4 when updating.

### Updating the renderer only

`src/server/listing/facebook.ts` is vendored into the worker, so a renderer change only
needs the sync step plus the worker sources — `node_modules`, `.env` and the Chrome setup
are untouched:

```powershell
cd "C:\Users\novitek\Desktop\AutoCheck QC"
npm run sync:worker-sources
scp -r "deploy\cloudways-worker\vendor" `
      "master_dwzpyzstbx@phpstack-1676372-6705476.cloudwaysapps.com:autocheck-worker/"
ssh master_dwzpyzstbx@phpstack-1676372-6705476.cloudwaysapps.com "cd /home/master/autocheck-worker && rm -rf dist && npm run build && ./restart-worker.sh"
```

Repeat a single extraction against the gateway to reproduce or confirm a fix:

```bash
SECRET=$(grep '^AUTOCHECK_WORKER_SECRET=' /home/master/autocheck-worker/.env | cut -d= -f2)
curl -s -X POST -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"url":"https://www.facebook.com/share/1HjKAsQwoy/"}' \
  "https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=extract"
```

### Updating an existing deployment

Nothing outside `/home/master/autocheck-worker` is touched: Chrome, `chrome-libs/` and
the worker's `node_modules` all stay in place. `.env` is preserved, so the secret does
not change.

From PowerShell, in the AutoCheck repository:

```powershell
cd "C:\Users\novitek\Desktop\AutoCheck QC"
npm run sync:worker-sources

scp -r "deploy\cloudways-worker\src" "deploy\cloudways-worker\scripts" `
      "deploy\cloudways-worker\types" "deploy\cloudways-worker\vendor" `
      "deploy\cloudways-worker\package.json" "deploy\cloudways-worker\tsconfig.json" `
      "deploy\cloudways-worker\start-worker.sh" "deploy\cloudways-worker\stop-worker.sh" `
      "deploy\cloudways-worker\restart-worker.sh" `
      "master_dwzpyzstbx@phpstack-1676372-6705476.cloudwaysapps.com:autocheck-worker/"

scp "deploy\cloudways-worker\public_html\worker-gateway.php" `
    "master_dwzpyzstbx@phpstack-1676372-6705476.cloudwaysapps.com:/home/master/applications/mwgyfxvkun/public_html/worker-gateway.php"

ssh master_dwzpyzstbx@phpstack-1676372-6705476.cloudwaysapps.com "cd /home/master/autocheck-worker && rm -rf dist && npm run build && ./restart-worker.sh"
```

`rm -rf dist` is only inside the worker directory and forces a clean rebuild, so a stale
`dist/deploy/cloudways-worker/` from the earlier layout cannot linger. If the worker
directory still contains a stale nested copy from an older attempt, remove it once:

```bash
ssh master_dwzpyzstbx@phpstack-1676372-6705476.cloudwaysapps.com \
  "rm -rf /home/master/autocheck-worker/deploy /home/master/src"
```

## Verify

```bash
# Local worker health (loopback, authenticated)
grep AUTOCHECK_WORKER_SECRET .env | cut -d= -f2
curl -s -H "Authorization: Bearer <secret>" http://127.0.0.1:3000/health

# Public gateway health (HTTPS, through PHP)
curl -s -H "Authorization: Bearer <secret>" \
  "https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=health"

# Public gateway must reject an unauthenticated caller
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=health"

# Real extraction through the gateway
curl -s -X POST -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" \
  -d '{"url":"https://www.facebook.com/share/1HjKAsQwoy/"}' \
  "https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=extract"
```

Then set both variables in the **Vercel project settings** (server-only, never
`NEXT_PUBLIC_`):

```
AUTOCHECK_WORKER_URL=https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=extract
AUTOCHECK_WORKER_SECRET=<the same value as the worker's .env>
AUTOCHECK_WORKER_TIMEOUT_MS=40000
```

Redeploy Vercel and POST a Facebook Marketplace URL to `/api/listing-extraction`.

## Operations

```bash
./restart-worker.sh            # stop, install/build if needed, start
./stop-worker.sh               # graceful stop + reap any stray Chrome
tail -f worker.log             # single-line JSON logs
kill -HUP ...                 # not supported; use the scripts
```

Logs record request id, timestamp, sanitized hostname, duration, outcome and code.
They never record the secret, the `Authorization` header, query strings or page contents.

### Render diagnostics

A failed extraction logs a `render` object so the outcome is diagnosable from
`worker.log` alone:

```json
{"event":"extraction_failed","code":"FACEBOOK_LOGIN_REQUIRED","elapsedMs":4820,
 "render":{"phase":"share","outcome":"terminal","reason":"login-wall",
           "polls":1,"waitMs":205,"httpStatus":302,
           "timings":{"navigationMs":410,"renderWaitMs":205},
           "page":{"host":"www.facebook.com","pathCategory":"login","titleCategory":"login",
                   "readyState":"complete","bodyTextLength":412,"hasOgUrl":false,
                   "hasMarketplaceMarker":false,"hasListingDetailMarkers":false},
           "predicates":{"readyStateComplete":true,"hasBodyText":true,"noLoginWall":false,
                         "noConsentWall":true,"noBlockWall":true,
                         "hasMarketplaceItemMarker":false}}}
```

`phase` is `share` (waiting after the `/share/...` navigation) or `canonical`
(waiting after navigating to `/marketplace/item/<id>`). `outcome` is `ready`,
`deadline`, `checks-exhausted`, `terminal` or `transient-error`.

`reason` distinguishes what Facebook actually served:

| `reason` | Meaning | `code` |
| --- | --- | --- |
| `login-wall` | Login page instead of the listing | `FACEBOOK_LOGIN_REQUIRED` |
| `consent-interstitial` | Cookie/consent page | `FACEBOOK_CONSENT_REQUIRED` |
| `checkpoint-block` | Anti-bot / checkpoint | `FACEBOOK_BLOCKED` |
| `listing-unavailable` | Listing deleted or not accessible | `FACEBOOK_LISTING_NOT_RENDERED` |
| `empty-page` | Empty document | `FACEBOOK_LISTING_NOT_RENDERED` |
| `listing-rendered-predicate-missed` | Listing markers present but readiness never stabilised | `FACEBOOK_LISTING_NOT_RENDERED` |
| `deadline-exceeded` | The whole extraction budget elapsed | `FACEBOOK_NAVIGATION_TIMEOUT` |
| `navigation-failure` | Navigation itself failed | `FACEBOOK_NAVIGATION_TIMEOUT` |

Walls are detected from the URL/title category and abort the wait immediately
(`outcome: "terminal"`) instead of consuming the budget. Only categories, counts,
booleans and timings are recorded: the worker re-filters the renderer's
diagnostics through `sanitizeRenderDiagnostics()`, which rebuilds the record from a
fixed key allow-list, so page HTML, rendered text, cookies, headers, the secret,
query strings, the raw path and the raw title can never reach the log. The
diagnostics are operator-facing and are **not** returned in the HTTP response.

To pull them:

```bash
grep '"event":"extraction_failed"' worker.log | tail -5
grep -o '"render":{.*}' worker.log | tail -5
```

### Login-modal survey and dismissal (`wall` + `dismissal`)

When `reason` is `login-wall`, the renderer additionally logs two log-safe
sections that tell apart the two ways Facebook demands login on a direct item
URL:

- **`wall`** — a read-only survey of the page at the moment the wait aborted:
  `pathCategory`/`titleCategory` (`login` = case A, a real redirect to
  `/login`; `marketplace-item` = case B, a login/signup modal over the item
  page), `visibleDialogCount`, `authDialogCount`, `hasSafeControl` plus the
  categorised close control (`safeControlType`, `safeControlLabelSource`,
  `safeControlLabelKind` — never the label itself), and whether listing DOM
  renders outside the dialog (`listingMarkersOutsideDialog`,
  `marketplaceItemLinksOutsideDialog`).
- **`dismissal`** — what happened next. `action` is `attempt`,
  `no-safe-control` or `not-applicable`; `reason` explains the decision
  (`redirected-to-login`, `no-auth-dialog`, `no-listing-behind-dialog`,
  `no-labeled-close-control`, `dismissible-login-modal-over-listing`, …);
  `clickResult` records the single in-page click outcome; `stabilizationPolls`
  and `dialogClosedAfterClick` describe the bounded post-click window, and
  `recovered` reports whether the existing readiness checks passed again
  afterwards.

Dismissal runs **at most once per wall** and only when all of these hold: the
URL is still `/marketplace/item/<id>`, a visible auth dialog exists, listing
markers render outside it, and a `button`/`[role="button"]` carries an
aria-label/title/text saying close or dismiss. Generated class names, the
`<i data-visualcompletion>` icon nodes and nth-child positions are never
touched; credentials are never entered. If any condition fails, the original
`FACEBOOK_LOGIN_REQUIRED` classification is preserved unchanged.

Each decision also emits one stdout line, greppable before the failure record:

```bash
grep '"event":"facebook_login_modal_dismissal"' worker.log | tail -5
```

```json
{"event":"facebook_login_modal_dismissal","phase":"share",
 "pathCategory":"marketplace-item","titleCategory":"login",
 "visibleDialogCount":1,"authDialogCount":1,"hasSafeControl":true,
 "listingMarkersOutsideDialog":true,"action":"attempt",
 "reason":"dismissible-login-modal-over-listing","clickResult":"clicked",
 "dialogClosedAfterClick":true,"stabilizationPolls":1,"recovered":true,
 "elapsedMs":431}
```

Both records are rebuilt key by key by `sanitizeRenderDiagnostics()` through
the `SAFE_RENDER_WALL_FIELDS` / `SAFE_RENDER_DISMISSAL_FIELDS` allow-lists, so
they carry categories, counts, booleans and enum strings only.

### Anonymous structured-data diagnostic (experimental)

`scripts/facebook-structured-diagnostic.ts` is a **standalone, read-only
probe** that answers one question with safe evidence: does Facebook currently
serve genuine listing data for a direct item URL to an anonymous client, and
through which path? It is never imported by the worker server, the renderer
or the application's extraction decision tree — running it changes no
production behaviour.

What it does, per run (at most 3–4 requests, ~1.2 s apart):

1. **PATH 1 (HTML)** — one GET of `--url` through the existing
   `fetchPublicListingHtml`, so every hop keeps the production SSRF, redirect,
   size and deadline guards. The document is reduced to a survey: path
   category, OpenGraph presence, payload markers (`expectedPreloaders`,
   Relay stream markers, JSON-script count) and id-tie evidence. Canonical /
   og:url / final path are the only identity channels; an id appearing only
   inside a login `next=` parameter is reported as `idOnlyInLoginParams`,
   never as a tie. URLs are query-stripped, raw HTML never leaves the process.
2. **PATH 2 (structured)** — one or two POSTs to Facebook's own logged-out
   Relay endpoint (`/api/graphql/`, `__a=1&__comet_req=15`) carrying a
   listing-detail query. The doc id is labelled by provenance:
   `page-expectedPreloaders` (discovered from step 1's page metadata) or
   `known-verified-fallback` (last-good constant, verified live 2026-10-01;
   Facebook rotates these). The answer is accepted **only** when the detail
   target's own `id` field equals the requested item id — mismatching or
   conflicting ids are labelled rejections, and URL-embedded ids can never
   satisfy the rule.
3. **PHOTOS** — if the detail answer carries no photos, one bounded images
   query (today the page-derived `MarketplacePDPC2CMediaViewerWithImagesQuery`
   id) under the same identity rule.

It uses the honest `AutoCheckQC/1.0` User-Agent throughout — no cookies, no
accounts, no CAPTCHA, no crawler impersonation — and prints one safe JSON
document (categories, counts, booleans, normalized public listing fields,
public query ids). It never prints raw HTML, headers, cookies, tokens or
query strings.

**Locally** (compiles through the test config):

```bash
npm run diag:fb-structured -- --url "https://www.facebook.com/marketplace/item/<id>/"
# optional: --doc-id <id> to replay a specific doc id, --no-photos to skip the images query
```

**On Cloudways** (compiled by the regular worker build into `dist/`):

```bash
cd /home/master/autocheck-worker
npm run build    # already runs as part of any worker update
node dist/scripts/facebook-structured-diagnostic.js \
  --url "https://www.facebook.com/marketplace/item/<id>/"
```

Exit code `0` means the structured path produced a positively tied listing;
`1` means the run completed but no tied result was obtained (the JSON explains
which labelled step stopped it); `2` is a usage error. Whether Cloudways'
datacentre IP gets the same answer as a residential one is exactly what this
diagnostic is meant to establish — `html.finalPathCategory`, `attempts[].outcome`
and `errors[]` distinguish a login redirect (case A/B) from a rejected or
throttled structured request (case C/D) without dumping any response body.

### Reboot limitation

`nohup` keeps the worker alive after an SSH disconnect, **but not after a full Cloudways
server reboot**. No init system or user-level cron can be installed without SSH access to
the server. After a reboot, run `./start-worker.sh` again, or add a Cloudways cron job if
one becomes available. Until then, `/api/listing-extraction` returns `503 worker-unavailable`
for browser listings instead of failing.

## Rollback

Remove the two Vercel variables (or clear `AUTOCHECK_WORKER_URL`) and redeploy. With no
worker configured, the route uses the previous in-process behaviour unchanged. To also stop
the worker:

```bash
./stop-worker.sh
rm /home/master/applications/mwgyfxvkun/public_html/worker-gateway.php
```

After production verification, retire the temporary test setup:

```bash
rm /home/master/applications/mwgyfxvkun/public_html/node-test.php
pkill -f test-server.mjs
```

## Security summary

- **Loopback only.** `main.ts` refuses to start on a non-loopback `AUTOCHECK_WORKER_HOST`.
  The PHP gateway is the only public entry point.
- **Server-to-server secret.** `AUTOCHECK_WORKER_SECRET` is verified by the worker with a
  constant-time SHA-256 comparison, before routing, so there is no open mode if unset.
  The browser never calls Cloudways; it only calls the AutoCheck API.
- **Not an open fetcher.** `/extract` only accepts the Facebook Marketplace URL form, then
  re-validates with `resolvePublicUrl` before launching Chrome. Every redirect destination
  is re-validated by the existing navigation guard.
- **Fixed backend.** The gateway hardcodes `127.0.0.1:3000` and never accepts a
  caller-supplied host or port.
- **Bounded resources.** One extraction at a time; extra requests get `429` + `Retry-After`
  rather than an unbounded queue. Timeouts, body caps and response caps are enforced at
  every hop.
- **No zombie Chrome.** `try/finally` closes page and browser, with a SIGKILL fallback;
  `stop-worker.sh` also reaps Puppeteer's Chrome processes.
