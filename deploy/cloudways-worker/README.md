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
| `start-worker.sh` / `stop-worker.sh` / `restart-worker.sh` | `nohup` lifecycle with PID file. |
| `.env.example` | Configuration template. |

`node_modules/`, `dist/`, `.env`, `worker.log` and `worker.pid` are git-ignored.
Chrome and the locally installed Debian libraries are **not** part of this directory;
they already exist on the server.

## Prerequisites (already satisfied on this host)

- Node.js v20.5.1, npm 9.8.0, no sudo/root.
- Chrome at `/home/master/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`.
- Chrome libraries under `/home/master/chrome-libs/root`.
- Cloudways PHP application `mwgyfxvkun` with public HTTPS.

## Deploy

Run from a machine that can reach the server, replacing the three `<...>` values.
`<worker-src>` is this repository's `deploy/cloudways-worker` directory.

```bash
# 1. Worker to /home/master/
ssh master@<server> 'mkdir -p /home/master/autocheck-worker'
scp -r <worker-src>/src <worker-src>/package.json <worker-src>/tsconfig.json \
      <worker-src>/.env.example <worker-src>/start-worker.sh \
      <worker-src>/stop-worker.sh <worker-src>/restart-worker.sh \
      <worker-src>/public_html master@<server>:/home/master/autocheck-worker/

# 2. PHP gateway to public_html
scp <worker-src>/public_html/worker-gateway.php \
    master@<server>:/home/master/applications/mwgyfxvkun/public_html/worker-gateway.php

# 3. Configure, install, build, start
ssh master@<server>
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

The build emits `dist/deploy/cloudways-worker/src/main.js` plus the shared AutoCheck
modules under `dist/src/`, because `rootDir` is the repository root. That is expected.

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
