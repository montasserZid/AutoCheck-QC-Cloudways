# Implementation Log

## 2026-09-28 - Listing URL Deterministic Auto-Fill

Objective:
- Add deterministic, zero-AI listing URL auto-fill to the existing vehicle intake flow.
- Preserve pasted listing-text extraction, manual entry, review/edit, localStorage intake compatibility, Free/Full selection, reports, inspection flow, and contact persistence.

Architecture:
- Browser URL input posts to `/api/listing-extraction`.
- Next.js server route calls a server-only secure fetcher.
- Fetcher validates URL, DNS resolution, redirects, response type, timeout, redirect count, and body size before returning HTML.
- Deterministic extraction parses JSON-LD, embedded JSON/state, metadata, and labelled HTML.
- Extracted fields are normalized into `VehicleIntake` and returned with field provenance.
- `VehicleIntakeFlow` pre-fills the existing review/edit step and leaves all values editable.

Files created:
- `src/app/api/listing-extraction/route.ts`
- `src/server/listing/handler.ts`
- `src/server/listing/secureFetch.ts`
- `src/lib/listingUrlExtraction.ts`
- `src/lib/listingUrlClient.ts`
- `docs/IMPLEMENTATION_LOG.md`

Files modified:
- `src/components/VehicleIntakeFlow.tsx`
- `src/lib/listingExtraction.ts`
- `src/types/domain.ts`
- `tests/domain.test.ts`
- `graphify-out/graph.json`
- `graphify-out/.graphify_analysis.json`

Extraction strategies:
- JSON-LD: supports Vehicle, Car, Product, Offer, ItemList, and `@graph` nesting.
- Structured page data: parses standalone embedded JSON without executing remote JavaScript.
- Metadata: reads OpenGraph, Twitter/standard meta description, and document title.
- HTML fallback: reads obvious `dt/dd`, `th/td`, and labelled values.
- Source adapters: extraction code is layered so source-specific adapters can be added later without replacing the generic parser.

Security / SSRF protections:
- Allows only `http://` and `https://`.
- Rejects malformed URLs and embedded credentials.
- Rejects localhost, loopback, private IPv4, link-local, multicast/reserved IPv4, IPv6 loopback, IPv6 unique-local, IPv6 link-local, IPv6 multicast, IPv6 unspecified, and IPv4-mapped private IPv6.
- Rejects known internal hostnames such as metadata/internal hosts.
- Resolves and validates destination addresses before request.
- Manually follows redirects and validates every redirect destination.
- Uses a maximum redirect count, timeout, maximum body size, and HTML content-type validation.
- Returns structured extraction results only, never arbitrary fetched page HTML.

Fields supported:
- `year`
- `make`
- `model`
- `trim`
- `askingPriceCad`
- `priceCurrency`
- `mileageKm`
- `mileageUnit`
- `vin`
- `transmission`
- `drivetrain`
- `engine`
- `city`
- `location`
- `sellerName`
- `sellerType`
- `sellerDescription`
- `listingTitle`
- `listingSource`
- `listingUrl`
- Existing seller claims where deterministic text extraction recognizes them.

Normalization behavior:
- Handles prices such as `$21,995`, `21 995 $`, and `CAD 21995`.
- Handles mileage such as `82,300 km`, `82300 KM`, and `82 300 kilometres`.
- Does not convert miles to kilometres. Mile-based structured mileage is preserved as `mileageUnit: "mi"` and does not populate `mileageKm`.
- VINs are normalized to uppercase and accepted only when they match the 17-character VIN pattern excluding I, O, and Q.
- Non-CAD prices preserve `priceCurrency`; CAD/unknown-currency prices can populate the current CAD asking-price field.

Fallback UX:
- URL mode now shows "Reading listing..." during server extraction.
- Successful extraction moves to the existing review/edit screen with found fields marked.
- Partial extraction keeps the fields found and asks the user to complete/correct missing details.
- Retrieval failure keeps the listing URL and routes the user to the existing pasted-text extraction fallback.
- Manual entry remains available.

Real URLs tested:

| Source | URL | Live retrieval result | Extracted fields | Result | Limitation |
| --- | --- | --- | --- | --- | --- |
| AutoTrader Canada detail | `https://www.autotrader.ca/offers/toyota-rav4-gasoline-grey-cat_ma70gr201439tr11875-40a2bdf1-ef94-4b8e-95ee-db631d3ca93c` | API handler returned 502 `network-error` | None | FAILED | Local sandbox cannot resolve external DNS. |
| Ken Shaw Toyota dealer listing | `https://www.kenshawtoyota.ca/inventory/2021-toyota-rav4-le-fQKQguA6Toa2amJnuIF5wwvdp/` | API handler returned 502 `network-error` | None | FAILED | Local sandbox cannot resolve external DNS. |
| AutoTrader Canada search/listing page | `https://www.autotrader.ca/cars/toyota/rav4/my_2021/ot_used` | API handler returned 502 `network-error` | None | FAILED | Local sandbox cannot resolve external DNS. |
| Kijiji Autos listing/search page | `https://www.kijijiautos.ca/cars/toyota/rav-4/` | API handler returned 502 failed response | None | FAILED | Local sandbox cannot resolve external DNS. |

Live test notes:
- The route handler was exercised through the actual server-side extraction handler used by `/api/listing-extraction`.
- Next dev server startup was blocked by the sandbox because Next attempted to `realpath` the denied parent directory.
- Shell and Node DNS checks both failed for `www.example.com`, confirming the live retrieval blocker is the execution environment, not a parser result.
- No live success was claimed.

Automated test results:
- Lint: PASS (`npm run lint`)
- Typecheck: PASS (`npm run typecheck`)
- Tests: PASS (`NODE_OPTIONS='--preserve-symlinks-main --preserve-symlinks' npm test`) with 46/46 passing
- Production build: PASS (`npm run build`)
- Contact regression: PASS through existing contact validation, repository, API, and client tests

Graphify:
- Incremental Graphify refresh completed in code-only mode because no LLM key was available for semantic doc extraction.
- Updated graph counts: 493 nodes, 939 edges.
- Cluster-only report refresh hung without output and was interrupted; graph JSON was still refreshed.

Limitations:
- Live URL retrieval could not succeed in this sandbox because external DNS/network access is blocked.
- No marketplace bypassing, CAPTCHA handling, authentication bypassing, proxying, or headless browser scraping was added.
- Generic extraction is implemented; source-specific adapters are deferred until live source behavior can be tested from a network-enabled environment.
- The current report engine does not use the newly added optional mechanical/source fields.

Deferred source adapters:
- AutoTrader Canada adapter if the generic parser misses stable fields on live detail pages.
- Kijiji/Kijiji Autos adapter if publicly retrievable pages expose stable structured data.
- Dealer-site adapters for common Canadian inventory platforms after live testing identifies reusable patterns.

AI USED: NO

AI CALLS FOR URL EXTRACTION: ZERO

## 2026-09-29 - Facebook False Login-Required Classification Fix Addendum

Real local endpoint result supplied for diagnosis:
- Chromium launch: PASS.
- Facebook response/navigation: PASS in approximately 7.8 seconds.
- Existing endpoint returned HTTP 502 with `FACEBOOK_LOGIN_REQUIRED` / `Facebook requested login.`

Confirmed cause and fix:
- AutoCheck threw immediately for login URL/text markers before target Marketplace item discovery.
- The read-only `fb_ref/facebook_listing_test.ts` records the same markers as a state but continues item discovery and extraction.
- AutoCheck now prefers target-listing evidence (Marketplace item ID in final/Open Graph URL, or primary listing details containing a vehicle value) over co-rendered login UI.
- Login/checkpoint routes and login text with no target listing remain `login-required`; block/captcha content with no target listing remains `blocked`.
- Recommendation-only content is not accepted as listing evidence.

Verification:
- Added deterministic tests for login UI plus listing, genuine auth wall, item metadata plus login UI, and recommendation contamination.
- Typecheck: PASS.
- Tests: PASS, 57/57.
- Lint and build: blocked by the Codex sandbox's host-level `EPERM lstat C:\\Users\\novitek` restriction.
- Live retest after this fix: NOT TESTED from Codex.
- Vercel Hobby: NOT TESTED.

Graphify:
- Incremental refresh: YES.
- Before: 600 nodes, 1170 links/edges.
- After: 600 nodes, 1170 links/edges.

## 2026-09-29 - Facebook Chromium Launch Resolution Fix

Objective:
- Fix the existing Facebook extractor's browser-launch boundary for local Windows Chrome and Vercel Hobby Chromium without changing Facebook navigation, parsing, normalization, or provenance.

Live local Facebook test attempted:
- The existing `POST /api/listing-extraction` endpoint was called with the Facebook Marketplace share URL.
- Result before this fix: HTTP 502 after approximately 318 ms, before Facebook navigation.
- Exact diagnostic: `FACEBOOK_BROWSER_LAUNCH_FAILED`.
- Root cause: `puppeteer-core` received neither `executablePath` nor `channel` because local mode only read optional overrides and otherwise passed `undefined`.

Fix implemented:
- Added one shared browser executable resolver in `src/server/listing/facebook.ts`.
- Resolution order: `CHROME_EXECUTABLE_PATH` (or the existing `PUPPETEER_EXECUTABLE_PATH` compatibility override), Vercel's `@sparticuz/chromium`, then standard local Chrome/Chromium locations under `LOCALAPPDATA`, `PROGRAMFILES`, and `PROGRAMFILES(X86)`.
- Local launch receives the discovered installed Chrome `executablePath` and normal Puppeteer headless mode.
- Vercel launch receives `await chromium.executablePath()`, Chromium's serverless arguments, and headless shell mode.
- Missing local executables now return `FACEBOOK_BROWSER_EXECUTABLE_NOT_FOUND` instead of Puppeteer's generic launch error.
- No Facebook redirect, item-ID, primary-listing boundary, parser, or normalization code changed.

Local executable strategy and result:
- This machine resolved Chrome from `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`.
- A direct invocation of the same production extractor confirmed Chromium launch succeeded.
- The subsequent Facebook request timed out after 31,419 ms and returned `FACEBOOK_NAVIGATION_TIMEOUT`; no Marketplace item, rendered listing, or extracted fields were observed in this retest.
- This is a post-launch navigation timeout, not a browser executable failure and not evidence of Facebook blocking.
- Starting the Next dev server and the production build from the Codex sandbox remains blocked by the host-level `EPERM lstat C:\\Users\\novitek` restriction, so the endpoint-specific retest must be repeated outside this sandbox after the navigation timeout is addressed.

Vercel Hobby strategy/result:
- Designed to use `@sparticuz/chromium` only when `VERCEL` is present; `NODE_ENV=production` alone does not select Vercel Chromium.
- Vercel Hobby has not been deployed or runtime-tested in this session.

Tests and checks:
- Added deterministic coverage for explicit executable override, Vercel selection, standard local discovery, and missing executable resolution.
- `npm test`: PASS, 53/53.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: BLOCKED in this sandbox by the host-level `EPERM lstat C:\\Users\\novitek` restriction, after typecheck passed.

Security and scope:
- Existing Facebook host/path validation is unchanged.
- No credentials, cookies, login, proxy, stealth/evasion, AI calls, or paid infrastructure were added.
- Non-Facebook secure-fetch extraction remains unchanged.

Graphify:
- Before this targeted launch fix: 593 nodes, 1157 links/edges.
- Incremental refresh: YES, targeted code refresh completed with `graphify update .`.
- After refresh: 600 nodes, 1170 links/edges.

Status:
- PARTIAL - local Chromium launch is verified; Facebook navigation, extraction, and Vercel Hobby runtime verification remain required.

## 2026-09-29 - Facebook False Login-Required Classification Fix

Objective:
- Correct the Facebook page-state classifier so ordinary login/sign-up UI does not reject an anonymously readable Marketplace listing.

Real local endpoint result supplied for diagnosis:
- Chromium launch: PASS.
- Facebook response/navigation: PASS in approximately 7.8 seconds.
- Existing endpoint result: HTTP 502 with `FACEBOOK_LOGIN_REQUIRED` and `Facebook requested login.`

Confirmed cause:
- `src/server/listing/facebook.ts` called `detectBlockedState()` immediately after each snapshot and threw on login URL/text markers before Marketplace item discovery and extraction.
- `fb_ref/facebook_listing_test.ts` uses the same broad login markers in `detectState()`, but records `requires_auth` in its snapshot and continues to discover the item and extract rendered listing data. It does not use that state as an immediate extraction abort.
- Therefore AutoCheck treated ordinary co-rendered login UI as a hard access wall even when target-listing evidence could be present.

Fix:
- Added a page-state classifier that first looks for target-listing evidence: a Marketplace item ID in the final or Open Graph URL, or primary (pre-recommendation) listing detail content with a vehicle value.
- Target-listing evidence returns `listing-available` before login/control text is considered.
- Login/checkpoint/authentication routes or explicit login text still return `login-required` when no target listing is available.
- Block/captcha markers remain an explicit `blocked` state when no target listing is available.
- Recommendation-only content is not evidence because it lacks primary listing-detail markers and is bounded by the existing primary-listing boundary.
- No browser-launch, Vercel Chromium, URL-validation, parser, normalization, provenance, SSRF, authentication, cookies, stealth/evasion, or non-Facebook logic changed.

Tests:
- Added deterministic coverage for login UI plus valid listing, actual authentication wall without listing, Marketplace metadata plus login UI, and recommendation-only content.
- Typecheck: PASS.
- Tests: PASS, 57/57.
- Lint and build: BLOCKED in the Codex sandbox by host-level `EPERM lstat C:\\Users\\novitek`; no source lint/build failure was reported.

Live test:
- NOT TESTED from the Codex sandbox after this page-state change.
- Real local endpoint retest is required.

Vercel Hobby:
- Still NOT TESTED.

Graphify:
- Before this page-state fix: 600 nodes, 1170 links/edges.
- Incremental refresh: pending after the source change.

## 2026-09-29 - Facebook Marketplace Browser Extraction Upgrade

Objective:
- Upgrade the existing AutoCheck listing URL extraction path for Facebook Marketplace using the proven `fb_ref` browser-rendered approach.
- Preserve the existing `/api/listing-extraction` architecture, normalized `VehicleIntake` contract, provenance model, review/edit UX, and non-Facebook secure-fetch path.
- Target local development and Vercel Hobby without adding paid scraping services, Browserless, VPS workers, authentication, cookies, proxies, evasion, or AI.

Status: PARTIAL - VERCEL RUNTIME VERIFICATION REQUIRED

Previous Facebook behavior:
- Facebook URLs entered in `VehicleIntakeFlow` used the same URL mode as every other listing source.
- Client function: `extractListingUrl()` in `src/lib/listingUrlClient.ts`.
- API route: `src/app/api/listing-extraction/route.ts`.
- Server handler: `createListingExtractionPostHandler()` in `src/server/listing/handler.ts`.
- Fetch mechanism: `fetchPublicListingHtml()` in `src/server/listing/secureFetch.ts`.
- Parser: `extractListingFromHtml()` in `src/lib/listingUrlExtraction.ts`.
- Normalized output: existing `ListingUrlExtraction` details/found/uncertain/provenance contract, then existing review step in `VehicleIntakeFlow`.
- Limitation: Facebook Marketplace was treated as static HTML. The existing secure fetcher does not execute JavaScript or wait for React-rendered Marketplace content, so useful primary listing fields were often absent or buried in static metadata.

New Facebook architecture:
- The same listing API now branches only when `isSupportedFacebookMarketplaceUrl()` accepts an HTTPS Facebook share or `/marketplace/item/<id>/` URL.
- Facebook path:
  - validate supported Facebook host and URL form
  - launch a real browser through `puppeteer-core`
  - use serverless Chromium through `@sparticuz/chromium` for production/Vercel
  - let the browser follow the share URL redirect
  - discover the Marketplace item ID from the final URL or `og:url`
  - navigate to the canonical item URL
  - read rendered body text and OpenGraph metadata
  - isolate primary listing text before recommendation/login sections such as `Today's picks`
  - parse deterministic fields into the existing `ListingUrlExtraction` model using `facebook-rendered` provenance
- Non-Facebook path remains `secureFetch` plus deterministic HTML extraction. Chromium is not launched for Kijiji/general/dealer URLs.

Reference used: `fb_ref`
- `fb_ref/facebook_listing_test.ts`
- `fb_ref/facebook_listing_test_result.json`
- `fb_ref/listing_visible_text.txt`
- `fb_ref` modified: NO

Files changed:
- `src/server/listing/facebook.ts`
- `src/server/listing/handler.ts`
- `src/app/api/listing-extraction/route.ts`
- `src/lib/listingUrlExtraction.ts`
- `tests/domain.test.ts`
- `next.config.ts`
- `package.json`
- `docs/IMPLEMENTATION_LOG.md`

API changes:
- Success response shape remains compatible with existing client expectations.
- Facebook success `retrieval` additionally includes `itemId` and `elapsedMs`.
- Facebook failures return safe `ok: false`, `status: "failed"`, and a stable internal code such as `FACEBOOK_LOGIN_REQUIRED` without leaking server internals.

Browser/runtime choice:
- `puppeteer-core` avoids bundling a full browser.
- `@sparticuz/chromium` provides a serverless Chromium binary for production/Vercel.
- Route remains `runtime = "nodejs"` and sets `maxDuration = 60`.
- `next.config.ts` adds output file tracing includes for the listing API route so Chromium/Puppeteer files can be bundled by Vercel.

Local result:
- Deterministic parser implementation completed.
- Automated local checks pass with the Node symlink workaround noted below.
- Live local Facebook integration NOT TESTED because the new browser packages could not be installed in this sandbox.
- `npm install` with `NODE_OPTIONS='--preserve-symlinks-main --preserve-symlinks'` reached the npm registry but failed with `EACCES` fetching `https://registry.npmjs.org/@sparticuz%2fchromium`, so `package-lock.json` was not regenerated in this environment.

Vercel Hobby result:
- NOT TESTED from Codex. No deployment credentials/runtime access were available in this session.
- Do not claim Vercel compatibility until the deployed endpoint test succeeds.

Extracted fields:
- Canonical Facebook listing URL
- Marketplace item ID in API retrieval metadata
- Listing source
- Listing title
- Year, make, model, trim where deterministic title parsing supports them
- CAD asking price
- Mileage and mileage unit
- Transmission
- City/location
- Seller description
- Facebook-specific primary attributes such as fuel type, exterior color, interior color, and owners are preserved in seller notes/claims instead of expanding the public schema.

Failure handling:
- `FACEBOOK_INVALID_URL`
- `FACEBOOK_BROWSER_LAUNCH_FAILED`
- `FACEBOOK_NAVIGATION_TIMEOUT`
- `FACEBOOK_SHARE_REDIRECT_FAILED`
- `FACEBOOK_ITEM_NOT_FOUND`
- `FACEBOOK_LOGIN_REQUIRED`
- `FACEBOOK_BLOCKED`
- `FACEBOOK_LISTING_NOT_RENDERED`
- `FACEBOOK_EXTRACTION_PARTIAL`
- `FACEBOOK_EXTRACTION_FAILED`

Security:
- Facebook browser path only accepts HTTPS URLs on explicit Facebook hosts and share/item path forms.
- Redirect/final browser locations are checked to remain on supported Facebook hosts.
- No arbitrary browser proxy behavior was added.
- Existing SSRF-secure fetch path remains unchanged for non-Facebook URLs.
- No login, cookies, saved profile, OAuth, tokens, CAPTCHA solving, proxies, stealth plugins, webdriver fingerprint hiding, or access-control bypass was added.

Resource/timing observations:
- Browser work is isolated to Facebook URLs only.
- Browser, page, and resources are closed in `finally`.
- Timeouts are bounded.
- No screenshots, HTML dumps, or debug artifacts are written in production.
- Actual local/Vercel timings are pending real runtime tests.

Free vs Paid impact:
- No entitlement or Free/Paid architecture changes.
- No paid browser API, scraping service, external VPS, or browser worker was introduced.

AI usage: ZERO

## 2026-10-02 - Phase 2A.2 Finalized Vehicle + Listing Persistence

Objective:
- Persist the user-reviewed `VehicleIntake` before package selection, without re-fetching a listing or changing any extraction path.

Implementation status:
- Implemented in source; production Supabase was not changed from this workspace.

Files changed:
- Added the explicit finalization DTO/validator, client finalization helper, safe repository adapter, focused route handler, API route, migration, and migration test.
- Updated the server operational repository, intake flow, localStorage helpers, and deterministic test suite.

Migration/database changes:
- `202610020001_finalize_vehicle_listing.sql` adds nullable `listings.submission_key` with a partial unique index and `public.finalize_vehicle_listing(uuid, jsonb, jsonb)`.
- The security-definer RPC takes an advisory transaction lock per submission key, replays an existing listing for that key, reuses an existing VIN vehicle only when the reviewed identity does not conflict, and inserts vehicle/listing in one database transaction.
- Execute is revoked from public roles and granted only to `service_role`; existing forced RLS, deny policies, and browser restrictions are unchanged.

API changes:
- Added `POST /api/intakes/finalize`. It accepts only JSON below 48 KB, validates an explicit allowlisted intake DTO plus a UUIDv4 `submissionKey`, and returns `{ ok, vehicleId, listingId, replayed }` with `Cache-Control: no-store`.

Client changes:
- `VehicleIntakeFlow` validates locally, finalizes to the server, stores `autocheck-qc:v2:submitted-intake` containing `{ vehicleId, listingId, submissionKey }`, then continues to package selection.
- A failed submission leaves the existing draft untouched. The pending submission key is retained in the draft for refresh/retry; the confirm control is disabled while the request is active.

Security implications:
- The browser never receives Supabase credentials and cannot select target tables/IDs/metadata. Metadata is constructed server-side from a bounded allowlist.
- Non-CAD reviewed prices are stored only as `{ value, currency }` metadata and never placed in `asking_price_cad`.
- Finalization performs no URL fetch, Bright Data request, or extraction work.

Tests:
- Added DTO, route, repository, client-contract, and SQL transaction/RLS coverage for invalid input, response replay, VIN conflict/reuse, same-VIN multiple listings, and listing-failure rollback.
- `npm test` passed: 196/196. `npm run typecheck` passed.
- Lint and production build are blocked by the managed sandbox's host-level `EPERM: lstat C:\Users\novitek` while ESLint/Next resolves dependencies; this is an environment failure, not a code failure.

Graphify status:
- Used the existing graph for navigation. No rebuild was performed. A fresh incremental update would include this append-only documentation file and require semantic extraction; source code remains the final implementation record.

Known debt:
- Apply the migration and run the SQL migration tests against the target Supabase project before enabling the endpoint in production. Report persistence remains intentionally absent.

Next step:
- REPORT PERSISTENCE

Supabase impact:
- No Supabase schema or persistence changes.

JSON dataset status: NOT INTEGRATED / UNCHANGED

Tests:
- Added focused deterministic tests for Facebook URL recognition, share URL recognition, item ID extraction, canonicalization, primary listing isolation, recommendation contamination prevention, field normalization, and non-Facebook handler regression through the existing API test.
- `npm test` requires `NODE_OPTIONS='--preserve-symlinks-main --preserve-symlinks'` in this sandbox to avoid Node's parent-directory `EPERM` realpath failure.
- Tests PASS: 49/49.

Build:
- Lint: PASS.
- Typecheck: PASS.
- Production build: PASS.

Graphify before/after:
- Before query: 498 nodes, 0 edges in `graphify-out/graph.json` as observed at the start of this task.
- Incremental refresh after implementation: YES, code graph only with `graphify update .`.
- After refresh: 593 nodes, 1157 links/edges.

Known limitations:
- `package-lock.json` still needs to be regenerated with the new dependencies.
- Local live Facebook test still needs to be run after dependencies install.
- Vercel Hobby runtime test still needs to be run against the actual deployed endpoint.
- Facebook anonymous rendering can change or require login; the implementation returns explicit failure states rather than escalating around it.

Deferred work:
- Tune browser resource blocking only after a real Vercel test proves which assets are safe to block without breaking Marketplace rendering.
- Add optional development-only diagnostics if future Facebook changes require parser debugging.

Next recommended step:
- Run `npm install` locally to update `package-lock.json`, then run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- Start local dev and test `/api/listing-extraction` with `https://www.facebook.com/share/1HjKAsQwoy/`.
- Deploy to Vercel Hobby and POST the same URL to the deployed `/api/listing-extraction` endpoint, recording `retrieval.elapsedMs`, whether Chromium launched, the item ID, and extracted fields.

## 2026-09-28 - Listing Fetch Network Failure Debug/Fix

Objective:
- Diagnose why real listing URL extraction failed before parsing with generic `network-error` / 502 responses.
- Preserve SSRF protections and keep browser-facing errors safe.

Root cause:
- The secure fetcher used a custom `lookup` callback to pin requests to prevalidated DNS results.
- Node's `http`/`https` client can call a custom lookup with `all: true`.
- The fetcher always returned the single-address callback shape: `callback(null, address, family)`.
- When Node expected the all-address shape, the underlying runtime error was `TypeError ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`.
- That original error was wrapped as a generic `ListingFetchError("network-error")`, hiding the real cause in logs.

Fix:
- Updated `src/server/listing/secureFetch.ts` so the custom lookup callback honors both Node callback shapes:
  - `callback(null, [{ address, family }])` when `lookupOptions.all` is true.
  - `callback(null, address, family)` otherwise.
- Added explicit HTTPS `servername` and `Host` preservation for the original public hostname while still connecting to the validated IP address.
- Added fallback across all resolved, validated addresses instead of failing on the first public address only.
- Wrapped DNS failures in `ListingFetchError("dns-failed")` with diagnostic metadata.
- Added server-only diagnostics for network failures. Browser/customer responses remain generic.

Security implications:
- SSRF protections were not weakened.
- URL protocol, credential, hostname, DNS/IP, private network, redirect, timeout, response-size, and content-type checks remain in place.
- Redirect destinations are still revalidated.
- The fetcher still does not act as an unrestricted proxy and still returns only structured extraction results through the API.

Actual diagnostic fields logged server-side only:
- error name
- error code
- errno
- syscall
- hostname
- address
- port
- message
- cause
- attempted addresses

Connectivity diagnostics from this environment:
- `https://example.com`: Node DNS failed with `ENOTFOUND example.com`; PowerShell also failed to resolve `example.com`.
- `https://www.google.com`: DNS resolved IPv4 addresses, but Node HTTPS failed with `connect EACCES ...:443`; PowerShell also could not connect.
- `https://www.autotrader.ca`: DNS resolved CloudFront IPv4 addresses, but secure fetch failed with `connect EACCES ...:443`.
- `https://www.kenshawtoyota.ca`: DNS resolved IPv4 address, but secure fetch failed with `connect EACCES ...:443`.
- `https://www.kijijiautos.ca`: DNS failed with `ENOTFOUND`.

Live URLs tested through secure fetch / API handler:

| Source | URL | Fetch result | HTTP status | Parser result | Fields extracted | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| Basic public HTTPS | `https://example.com` | FAILED | N/A | NOT REACHED | none | Environment DNS returned `ENOTFOUND`. |
| Basic public HTTPS | `https://www.google.com` | FAILED | N/A | NOT REACHED | none | Environment blocked outbound connect with `EACCES`. |
| AutoTrader Canada | `https://www.autotrader.ca/cars/toyota/rav4/my_2021/ot_used` | FAILED | API 502 | NOT REACHED | none | Environment blocked outbound connect with `EACCES`. |
| Ken Shaw Toyota dealer | `https://www.kenshawtoyota.ca/inventory/2021-toyota-rav4-le-fQKQguA6Toa2amJnuIF5wwvdp/` | FAILED | API 502 | NOT REACHED | none | Environment blocked outbound connect with `EACCES`. |
| Kijiji Autos | `https://www.kijijiautos.ca/cars/toyota/rav-4/` | FAILED | API 502 | NOT REACHED | none | Environment DNS returned `ENOTFOUND`. |

Tests:
- Added regression coverage for fallback to the next validated resolved address.
- Existing SSRF, timeout, oversized response, non-HTML response, malformed URL, and dangerous-target tests remain passing.
- Lint: PASS.
- Typecheck: PASS.
- Full automated tests: PASS, 47/47.
- Production build: BLOCKED in this sandbox by generated `.next/trace` permission error (`EPERM: operation not permitted, open ...\.next\trace`) after the host reported zero free disk. Source typecheck and tests pass.

Graphify:
- Incremental code-only refresh completed.
- Updated graph counts: 498 nodes, 951 edges.

AI USED: NO

AI CALLS FOR URL EXTRACTION: ZERO

## 2026-09-29 - Facebook False Login-Required Classification Fix (Append-Only Record)

Real local endpoint result supplied for diagnosis:
- Chromium launch: PASS.
- Facebook response/navigation: PASS in approximately 7.8 seconds.
- Existing endpoint returned HTTP 502 with `FACEBOOK_LOGIN_REQUIRED` / `Facebook requested login.`

Confirmed cause and fix:
- AutoCheck threw immediately for login URL/text markers before target Marketplace item discovery.
- The read-only `fb_ref/facebook_listing_test.ts` records the same markers as a state but continues item discovery and extraction.
- AutoCheck now prefers target-listing evidence (Marketplace item ID in final/Open Graph URL, or primary listing details containing a vehicle value) over co-rendered login UI.
- Login/checkpoint routes and login text with no target listing remain `login-required`; block/captcha content with no target listing remains `blocked`.
- Recommendation-only content is not accepted as listing evidence.

Verification:
- Added deterministic tests for login UI plus listing, genuine auth wall, item metadata plus login UI, and recommendation contamination.
- Typecheck: PASS.
- Tests: PASS, 57/57.
- Lint and build: blocked by the Codex sandbox's host-level `EPERM lstat C:\\Users\\novitek` restriction.
- Live retest after this fix: NOT TESTED from Codex.
- Vercel Hobby: NOT TESTED.

Graphify:
- Incremental refresh: YES.
- Before: 600 nodes, 1170 links/edges.
- After: 600 nodes, 1170 links/edges.
- Final source refresh after this record: 616 nodes, 1191 links/edges.

## 2026-09-29 - Vercel Puppeteer Runtime Dependency Trace Fix

VERCEL HOBBY LIVE TEST:
- HTTP 502.
- Classification: VERCEL PACKAGING/DEPENDENCY FAILURE.
- Exact runtime message: `Cannot find package '@puppeteer/browsers' imported from /var/task/node_modules/puppeteer-core/lib/esm/puppeteer/node/ChromeLauncher.js`.

Investigation:
- Local `puppeteer-core@24.43.1` resolves successfully and declares `@puppeteer/browsers@2.13.2` as a required runtime dependency.
- `npm ls` and `npm explain` confirm `@puppeteer/browsers@2.13.2` is installed locally beneath Puppeteer.
- `package-lock.json` contains the exact Puppeteer, browser-helper, and Sparticuz Chromium versions.
- The deployed error proves the existing route trace included `puppeteer-core` but omitted its sibling runtime package.
- Dynamic module loading in the Facebook browser boundary prevents static output tracing from reliably discovering that dependency edge.

Fix:
- Added `./node_modules/@puppeteer/browsers/**/*` to the existing `/api/listing-extraction` `outputFileTracingIncludes` entry in `next.config.ts`.
- Kept the existing `puppeteer-core` and `@sparticuz/chromium` trace includes.
- No root dependency was added because `@puppeteer/browsers` is already a required, lockfile-pinned Puppeteer runtime dependency; this is a trace-completeness fix, not a dependency-version fix.
- No Facebook extraction, navigation, login detection, Chromium launch configuration, SSRF, parser, normalization, provenance, or non-Facebook logic changed.

Verification:
- Local runtime import resolution: Puppeteer launch API, `@puppeteer/browsers`, and Sparticuz Chromium executable API all PASS.
- Typecheck: PASS.
- Tests: PASS, 57/57.
- Lint and build: blocked in the Codex sandbox by host-level `EPERM lstat C:\\Users\\novitek`.
- Local Facebook regression: not re-run; no local runtime behavior changed.
- Vercel retest: REQUIRED after deployment.

Graphify:
- Before this fix: 616 nodes, 1191 links/edges.
- Incremental refresh: pending after source/config change.
- Incremental refresh result: YES, 617 nodes and 1192 links/edges.

## 2026-09-29 - Vercel Puppeteer Transitive Dependency Tracing Fix

VERCEL HOBBY LIVE TEST #2:
- `@puppeteer/browsers`: FOUND / PASS after the first explicit trace include.
- HTTP result: 502.
- Classification: INCOMPLETE TRANSITIVE RUNTIME DEPENDENCY TRACING.
- Exact runtime message: `Cannot find package 'semver' imported from /var/task/node_modules/@puppeteer/browsers/lib/esm/browser-data/chrome.js`.

Root cause:
- The Facebook launcher loaded `puppeteer-core` and `@sparticuz/chromium` through `new Function(... import(specifier))`, hiding both package edges from Next.js static output tracing.
- The first fix copied `@puppeteer/browsers` files with an `outputFileTracingIncludes` glob. A file glob does not establish that package as a statically traced module root, so its npm runtime dependency closure was not followed; `semver` was the next missing dependency.
- The installed and locked dependency tree is complete locally: `puppeteer-core@24.43.1` requires `@puppeteer/browsers@2.13.2`, which requires `semver@^7.7.4`; npm resolves that edge to `semver@7.8.5`.
- Next.js 15.5.25 supports `serverExternalPackages` and already recognizes `puppeteer-core` and `@sparticuz/chromium` as server externals. Explicit configuration records this route's intended native Node package-loading boundary.

Fix:
- Replaced the opaque `new Function` module loaders with standard literal `import("puppeteer-core")` and `import("@sparticuz/chromium")` calls. Loading remains lazy and uses the same Facebook browser implementation, while Next/Node File Trace can now discover package roots and their transitive runtime dependencies.
- Explicitly configured `serverExternalPackages` for `puppeteer-core` and `@sparticuz/chromium`, preserving native Node package resolution rather than bundling or manually enumerating Puppeteer's dependency tree.
- Removed the broad `puppeteer-core/**/*` and `@puppeteer/browsers/**/*` trace globs.
- Retained only `@sparticuz/chromium/bin/**/*` in `outputFileTracingIncludes`, because the compressed Chromium runtime assets are loaded from the filesystem and genuinely require explicit asset tracing.
- No package or lockfile changes were required.
- No Facebook parsing, navigation, login detection, listing isolation, normalization, provenance, SSRF, or non-Facebook behavior changed.

Verification:
- `npm ls next puppeteer-core @puppeteer/browsers @sparticuz/chromium semver --all`: PASS; exact runtime dependency chain present.
- Direct Node ESM imports of Puppeteer, browser helpers, semver, and Sparticuz Chromium: PASS.
- Next.js's installed Node File Trace engine followed the new literal imports to `puppeteer-core`, `@puppeteer/browsers`, `semver`, `@sparticuz/chromium`, and `@sparticuz/chromium/bin/chromium.br`: PASS.
- Typecheck: PASS.
- Tests: PASS, 57/57.
- Lint: BLOCKED by the Codex sandbox's host-level `EPERM lstat C:\\Users\\novitek` restriction.
- Production build/output trace inspection: BLOCKED by the same sandbox restriction.
- Local live Facebook regression: NOT RE-RUN; the previously proven local flow remains the baseline and browser behavior was not changed.
- Vercel retest after this fix: REQUIRED; no Vercel PASS is claimed from local checks.

Graphify:
- Before: 617 nodes, 1192 links/edges.
- Incremental refresh: YES.
- After: 625 nodes, 1201 links/edges.

## 2026-09-29 - Vercel Facebook Detached-Frame Lifecycle Fix

VERCEL HOBBY LIVE TEST #3:
- Dependency loading: PASS.
- `@puppeteer/browsers`: PASS.
- `semver` and transitive runtime dependencies: PASS.
- Chromium runtime reached: PASS.
- Facebook extraction: FAILED during Puppeteer page/frame interaction.
- Classification: FACEBOOK/PUPPETEER NAVIGATION LIFECYCLE RACE.
- Exact runtime message: `Attempted to use detached Frame '441C2C219A937D64278CCD6CD380AE61'.`

Root cause:
- After `page.goto(..., { waitUntil: "domcontentloaded" })`, Facebook can continue redirecting or replace its main frame while rendering.
- The extractor then performed frame-bound operations in `settle()` and `snapshot()`. The old snapshot made four separate `page.evaluate()` calls plus `page.title()`, increasing the interval in which a navigation could dispose the frame selected by Puppeteer.
- Puppeteer 24.43.1 emits the observed message from its `Frame` detached-state guard. The previous log did not include a lifecycle stage, so it cannot prove which individual `goto`, scroll evaluation, snapshot evaluation, or title read threw; it does prove a frame-bound operation raced frame disposal.
- Local success and Vercel failure establish an environment-specific timing difference, but they do not establish why Vercel's timing exposed the race.

Fix:
- Added a small, bounded page-operation retry for known transient lifecycle messages only: detached frame, destroyed execution context, missing context ID, and unavailable execution context in a detached frame.
- Page reads and idempotent navigation/scroll operations are invoked again through `Page`, causing Puppeteer to resolve the current main frame on every attempt. No `Frame` or element handle is retained across navigation.
- Read retries are limited to three attempts with a 150 ms pause; navigation retries are limited to two attempts.
- All attempts share the existing 25-second extraction deadline. Deadline exhaustion and unrelated exceptions are not swallowed.
- Consolidated final URL, title, body text, and Open Graph metadata into one atomic `page.evaluate()` snapshot instead of five separate frame-bound reads.
- Preserved existing share resolution, canonical item navigation, auth/block classification, primary-listing parsing, normalization, provenance, cleanup, and non-Facebook behavior.

Diagnostics:
- Internal Facebook errors now record the active stage: `browser-launch`, `initial-navigation`, `render-wait`, `share-resolution`, `canonical-navigation`, `page-read`, or `extraction`.
- The existing compact server logger preserves this optional stage. Customer-facing API behavior remains unchanged.

Verification:
- Typecheck: PASS.
- Tests: PASS, 61/61.
- Added deterministic tests for successful transient recovery, bounded retry exhaustion, unrelated-error propagation, and lifecycle-stage diagnostic mapping.
- Puppeteer/browser-helper/semver/Sparticuz direct runtime imports: PASS.
- Packaging regression: PASS; literal lazy imports, `serverExternalPackages`, and Chromium asset tracing remain unchanged.
- `git diff --check`: PASS.
- Lint and production build: BLOCKED by the Codex sandbox's host-level `EPERM lstat C:\\Users\\novitek` restriction.
- Local live Facebook: NOT RETESTED.
- Vercel extraction after this fix: VERIFICATION REQUIRED.

Graphify:
- Before: 625 nodes, 1201 links/edges.
- Incremental refresh: YES.
- After: 639 nodes, 1230 links/edges.

## 2026-09-29 - Vercel Facebook Render-Wait Polling Fix

VERCEL HOBBY LIVE TEST #4:
- Dependency packaging: PASS.
- Chromium runtime: PASS.
- Facebook runtime: PASS.
- Failure: detached frame.
- Precise stage: `render-wait`.
- Exact runtime message: `Attempted to use detached Frame 'CF69FF0A2440024456C451BA6FBA6800'.`
- The stage diagnostic added after test #3 successfully localized the remaining race to `settle()`.

Root cause:
- `settle()` contained exactly two Puppeteer operations: a `page.evaluate()` that scrolled to the document bottom and a second `page.evaluate()` that returned to the top. It did not use `waitForFunction`, `waitForSelector`, element handles, explicit `Frame` objects, or other Puppeteer waits.
- Both evaluations were awaited inside `retryFacebookPageOperation`; no promise was created inside the wrapper and rejected outside it.
- The exact detached-frame message matches the transient classifier. Therefore it can leave that helper only after its three rapid attempts are exhausted or the shared deadline expires. The previous diagnostics cannot distinguish the bottom-scroll evaluation from the top-scroll evaluation without guessing.
- Facebook's frame replacement on Vercel outlasted that short retry envelope during render-wait.

Fix:
- Replaced the two rapid render-wait retries and fixed pauses with a bounded readiness poll that performs a new short `page.evaluate()` through `Page` on every check.
- Each check obtains only primitive current-page state, verifies that the document is readable and a Marketplace item URL is present in the current/Open Graph URL, and triggers the existing bottom scroll without retaining a `Frame` or element handle.
- Readiness requires two consecutive successful checks, preventing one transient pre-navigation document from ending render-wait.
- The poll allows at most 18 checks at 200 ms intervals, approximately matching the old settle window, and remains constrained by the existing 25-second overall deadline.
- The final scroll-to-top is a separate fresh-page poll bounded to six checks; unrelated errors still propagate immediately.
- If readable readiness is not observed but checks themselves remain valid, render-wait remains best-effort and continues after the bounded window, preserving the existing fallback behavior. Repeated lifecycle failures are rethrown.
- Packaging, Chromium configuration, navigation, canonicalization, login classification, parsing, normalization, provenance, cleanup, SSRF protection, and non-Facebook extraction were unchanged.

Verification:
- Typecheck: PASS.
- Tests: PASS, 66/66.
- Added deterministic render-wait tests for detached-frame recovery against fresh calls, bounded repeated failures, deadline enforcement, unrelated-error propagation, and normal readiness completion.
- `git diff --check`: PASS.
- Lint and production build: BLOCKED by the Codex sandbox's host-level `EPERM lstat C:\\Users\\novitek` restriction.
- Vercel render-wait fix: VERIFICATION REQUIRED after deployment.

Graphify:
- Before: 639 nodes, 1230 links/edges.
- Incremental refresh: YES.
- After: 646 nodes, 1238 links/edges.

## 2026-09-29 - Vercel Facebook Target-Closed Diagnostics

VERCEL HOBBY LIVE TEST #5:
- Vercel function: PASS.
- Puppeteer dependency closure: PASS.
- Chromium startup: PASS.
- Facebook runtime reached: PASS.
- Stage: `render-wait`.
- Previous detached-frame failure changed to: `Protocol error (Runtime.callFunctionOn): Target closed`.
- Classification: PAGE/BROWSER TARGET LIFECYCLE FAILURE.
- Cause: NOT YET PROVEN.

Source lifecycle findings:
- The Facebook extractor launches one browser, creates one page, awaits each navigation/evaluation operation, and closes that page and browser only in `finally`.
- There is no `Promise.race`, abort controller, detached timeout task, or equivalent operation that can reject while leaving `page.evaluate()` running.
- The shared deadline is checked synchronously between awaited operations. Render-wait's polling delay is itself awaited. The deadline cannot independently trigger cleanup while `Runtime.callFunctionOn` is pending.
- The lifecycle snapshot is taken in `catch` before `finally` marks cleanup as started or calls `page.close()` / `browser.close()`. Therefore our own cleanup cannot be the event that first generated the observed `Target closed` error.
- Puppeteer emits this error when the CDP session used by `Runtime.callFunctionOn` closes. Source inspection alone cannot distinguish a page target closure, browser disconnect/crash, or external runtime/process termination.

Diagnostics-only change:
- No retry, sleep, browser recreation, parser change, packaging change, or behavioral workaround was added.
- Added compact server-only lifecycle tracking using documented Puppeteer/Node surfaces.
- Failure diagnostics now record `page.isClosed()`, page close/crash events, browser connected/disconnected state, target create/change/destroy counts, whether the current page target changed or was destroyed, Chromium child-process exit/close events with code/signal, elapsed time from request and browser launch, cleanup state, deadline state, navigation activity/result, and time since navigation/target change.
- The browser child process is obtained through Puppeteer's public `browser.process()` API. No undocumented internals are used.
- Diagnostics are snapshotted at failure before cleanup and passed through the existing compact server logger. They are not exposed in the customer API response.

Verification:
- Typecheck: PASS.
- Tests: PASS, 67/67.
- Added deterministic coverage for browser disconnect, page close/crash, page-target change/destruction, process exit/close code and signal, timing, deadline, navigation, cleanup, and API diagnostic mapping.
- `git diff --check`: PASS.
- Lint and production build: BLOCKED by the Codex sandbox's host-level `EPERM lstat C:\\Users\\novitek` restriction.
- Behavioral fix: NONE pending deployed evidence.
- Next Vercel runtime test: REQUIRED.

Graphify:
- Before: 646 nodes, 1238 links/edges.
- Incremental refresh: YES.
- After: 663 nodes, 1262 links/edges.

## 2026-09-30 - Complete Vercel Facebook Browser/CDP Compatibility Fix

Live evidence entering this pass:
- Chromium launch and Facebook navigation both passed on Vercel Hobby.
- The failure was `Protocol error (Runtime.callFunctionOn): Target closed` at `render-wait` about 2.7 seconds after launch.
- The page did not report close/crash or target destruction, while the browser reported `disconnected`; cleanup had not started, the deadline had not expired, and navigation had succeeded.
- This rules out AutoCheck cleanup/deadline as the initiating event and localizes the remaining failure to the browser/CDP process boundary, but does not by itself prove OOM or a Chromium crash.

Compatibility evidence:
- The installed lock had floated from the declared caret range to `puppeteer-core@24.43.1`; its installed `PUPPETEER_REVISIONS` targets Chrome/headless-shell `148.0.7778.97`.
- The deployed binary remains `@sparticuz/chromium@141.0.0`.
- Puppeteer's authoritative supported-browser table maps `puppeteer@24.23.0` to Chrome for Testing `141.0.7390.54`, and the installed Sparticuz 141 package declares `puppeteer-core@^24.23.0` for its own development/integration tests.
- The previous pair was therefore outside Puppeteer's supported browser mapping. The package and lockfile now pin `puppeteer-core@24.23.0` and `@sparticuz/chromium@141.0.0` exactly, including Puppeteer's matching transitive protocol packages (`@puppeteer/browsers@2.10.10`, `chromium-bidi@9.1.0`, `devtools-protocol@0.0.1508733`, and `webdriver-bidi-protocol@0.3.6`). Exact pins prevent a future caret install from silently separating the controller and browser again.

Launch and render fixes:
- Preserved Sparticuz's complete recommended `chromium.args`, `chromium.executablePath()`, and `headless: "shell"` configuration. No unsupported flag removal, transport swap, sandbox change, proxy, stealth, login profile, or cookie behavior was introduced.
- Disabled Sparticuz graphics/WebGL before reading its generated args. AutoCheck extracts DOM text and Open Graph metadata and does not render images or WebGL output, so this removes an unused graphics subsystem while retaining Sparticuz's serverless flags.
- Reused Puppeteer's initial launch page instead of creating a second page/renderer. Removed the duplicate viewport command and the synthetic cross-platform user-agent override; Puppeteer's launch viewport and Chromium's real anonymous user agent remain.
- Removed render-wait's repeated scroll-to-document-bottom operation and the follow-up scroll-to-top poll. The old readiness loop could trigger additional lazy Marketplace/recommendation work on every 200 ms check even though extraction reads the existing DOM and explicitly excludes recommendations.
- Readiness still requires two consecutive current-page checks for a readable body plus a Marketplace item URL. Exhausting valid-but-not-ready checks now fails deterministically instead of silently continuing.
- Share URL resolution, canonical item discovery/navigation, item ID detection, anonymous/login-wall classification, primary listing isolation, parsing, normalization, provenance, SSRF protection, and non-Facebook extraction are unchanged.

Resource and lifecycle findings:
- OOM remains unproven. Current Vercel documentation gives Hobby functions 2 GB / 1 vCPU, while Sparticuz documents at least 512 MB and recommends 1600 MB or more; nominal Hobby memory therefore exceeds the package recommendation.
- Diagnostics now sample Node RSS/heap/external/array-buffer memory plus available cgroup current/peak/limit and OOM/OOM-kill counters at request start, browser launch, navigation completion, and failure.
- Chromium stderr is retained as a bounded 2,000-character tail. Browser disconnect timing and the child process `killed` state are included.
- On disconnect, failure capture allows a bounded 75 ms for child `exit`/`close` events to arrive before snapshotting, addressing the prior evidence gap where CDP disconnect was observed before process events.

Verification performed:
- Package-lock JSON parse and exact dependency-closure assertions: PASS.
- Installed Sparticuz source/type metadata inspection: PASS (`setGraphicsMode`, args, executable path, shell headless support).
- `git diff --check`: PASS (line-ending notices only).
- Added deterministic regressions for exact serverless launch behavior, launch-page reuse, render-readiness exhaustion, delayed process-exit observation, stderr capture, and Node/cgroup memory collection. Expected suite size: 72 tests.
- Typecheck, test execution, lint, direct Node imports, and build: BLOCKED in this managed sandbox by the existing host-level `EPERM: lstat C:\\Users\\novitek` restriction before Node can load project tools.
- Local live Facebook: NOT TESTED; this host cannot start the Node toolchain, and no live call was added to unit tests.
- Deployed Vercel Hobby: NOT TESTED. One post-commit deployment/request remains required; local/static verification is not a Vercel success claim.

Graphify:
- Before: 663 nodes, 1262 links/edges.
- Incremental refresh: YES; limited to the five changed code/config files and this implementation-log document.
- After: 703 nodes, 1311 links/edges. Health check found no dangling, missing-endpoint, or collapsed edges; six self-loops remain reported for audit.

## 2026-09-30 - Proven Vercel Chromium SIGSEGV / Graphics Stack Fix

Proven Vercel failure:
- The Chromium child process exited and closed with `browserProcessExitEvent=true`, `browserProcessCloseEvent=true`, `browserProcessExitCode=null`, and `browserProcessSignal=SIGSEGV`.
- `browserProcessKilled=false`, `cleanupStarted=false`, `deadlineExpired=false`, and the last navigation had succeeded. This proves a Chromium process crash rather than AutoCheck cleanup or deadline termination.
- Chromium stderr immediately before the crash reported `ContextResult::kTransientFailure: Failed to send GpuControl.CreateCommandBuffer.`

Graphics/argv evidence and correction:
- AutoCheck previously set `chromium.setGraphicsMode=false`. Installed `@sparticuz/chromium@141.0.0` then retained `--ignore-gpu-blocklist` and `--in-process-gpu`, removed its explicit SwiftShader backend flags, and added `--disable-webgl`.
- The exact graphics subset before was `--ignore-gpu-blocklist`, `--in-process-gpu`, `--disable-webgl`; it contained no `--use-gl`, `--use-angle`, `--disable-gpu`, or `--disable-software-rasterizer` flag.
- Sparticuz's installed source defaults graphics mode to true and describes ANGLE plus SwiftShader as its serverless WebGL/graphics path. AutoCheck now explicitly restores that default before reading `chromium.args`.
- The exact graphics subset after is `--ignore-gpu-blocklist`, `--in-process-gpu`, `--use-gl=angle`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`. No `--disable-gpu`, `--disable-software-rasterizer`, or `--disable-webgl` flag is present.
- All non-graphics Sparticuz arguments, `chromium.executablePath()`, Puppeteer's `headless: "shell"`, one-browser/one-page reuse, no repeated scrolling, no duplicate viewport reset, and the native anonymous user agent remain unchanged.
- Runtime validation now rejects missing SwiftShader/ANGLE flags, conflicting GPU/WebGL-disable flags, and duplicate graphics flags before launch, preventing the incompatible hybrid from silently returning.
- No resource interception was added: Facebook scripts, styles, images, and fonts remain available because blocking them cannot be proven harmless to Marketplace rendering.

Memory logging:
- The handler now serializes the complete compact failure record as one JSON string. Vercel logs therefore expose the actual nested request/launch/navigation/failure memory snapshots, RSS, cgroup current/peak/limit, and OOM/OOM-kill counters instead of rendering nested values as `[Object]`.

Verification:
- Installed runtime versions remain `puppeteer-core@24.23.0` and `@sparticuz/chromium@141.0.0`.
- Exact before/after `chromium.args` were evaluated from the installed package at runtime.
- Typecheck: PASS.
- Deterministic tests: PASS, 74/74; new coverage locks the SwiftShader argv and nested memory-log serialization.
- Live Facebook was not called from unit tests.
- `git diff --check`: PASS (line-ending notices only).
- Lint and production build: BLOCKED by the managed sandbox's host-level `EPERM: lstat C:\\Users\\novitek` restriction while resolving ESLint/Next.js files. Typecheck and tests succeeded with Node's preserve-symlinks flags.

Graphify:
- Before: 703 nodes, 1311 links/edges.
- Incremental refresh: YES; limited to the three changed TypeScript files and this implementation-log document.
- After: 727 nodes, 1345 links/edges. Health check found no dangling endpoints, missing endpoints, collapsed edges, duplicate edges, or self-loops.

## 2026-09-30 - Vercel Chromium SIGSEGV Controlled Launch Matrix

Production evidence entering this pass:
- Chromium still exited and closed with `browserProcessSignal=SIGSEGV`, `browserProcessExitEvent=true`, `browserProcessCloseEvent=true`, `cleanupStarted=false`, and `deadlineExpired=false`, about 2.5 seconds after launch.
- After restoring Sparticuz's ANGLE/SwiftShader stack, the earlier `GpuControl.CreateCommandBuffer` stderr message disappeared, but the process SIGSEGV remained.
- This pass intentionally did not alter Facebook parsing, login classification, URL extraction, page-operation retries, or package versions.

Installed-source evidence and controlled variables:
- Installed `@sparticuz/chromium@141.0.0` supplies `--single-process` because its source documents the Lambda `prctl(PR_SET_NO_NEW_PRIVS)` constraint, and supplies `--in-process-gpu` as a memory-saving process-collapsing optimization.
- These are the only two process-layout flags varied. Every entry preserves Sparticuz's remaining args, `--no-sandbox`, `--no-zygote`, `--use-gl=angle`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`, executable path, and shell headless mode.
- Variant order is A: exact control; B: remove only `--in-process-gpu`; C: remove only `--single-process`; D: remove both. Argument construction fails closed if either controlled flag disappears from a future Sparticuz control set or the validated graphics stack changes.

Runtime behavior:
- The matrix exists only on the Vercel/Sparticuz path. Local Chrome still receives its prior executable path and `headless: true` configuration, with no matrix.
- Variants run sequentially under the original shared 25-second request deadline. Each failed attempt awaits page and browser closure in `finally` before the next launch begins, so one invocation never has two Chromium browsers concurrently.
- Fallback occurs only for browser launch failure or concrete browser-process/CDP termination evidence, including exit/close, signal, or disconnected-and-not-connected state. Deadline expiry and normal Facebook extraction/login failures do not advance the matrix.
- The first variant that completes the existing listing extraction stops the matrix. Its name is retained for subsequent requests in the same warm Vercel instance, which then launch only that proven variant.
- Each Vercel attempt writes one JSON record containing the variant, complete configured Chromium args, exact removed/added diff, actual child `spawnargs` when launch succeeds, launch/navigation/render-read status, process exit code/signal, stderr tail, elapsed time, and the full lifecycle/memory snapshot.

Cgroup diagnostics:
- Memory snapshots now always emit cgroup current, peak, limit, the complete parsed `memory.events` map, and the derived `oom`/`oom_kill` counters.
- Missing files, an unavailable metric, or cgroup `memory.max=max` is represented explicitly as `null` rather than being silently omitted from JSON.
- Node RSS/heap/external/array-buffer values and the existing request/launch/navigation/failure sample points remain intact.

Verification:
- Installed versions remain exactly `puppeteer-core@24.23.0` and `@sparticuz/chromium@141.0.0`.
- Typecheck: PASS.
- Deterministic tests: PASS, 78/78. New coverage locks all four argv variants, graphics preservation, sequential order, first-success short-circuiting, no fallback for normal extraction failures, child spawn argv capture, parsed cgroup events, and explicit unavailable cgroup values.
- Live Facebook was not called from unit tests.
- `git diff --check`: PASS (line-ending notices only).
- Deployed Vercel matrix: NOT TESTED. One deployment and one Facebook Marketplace extraction request are required.

Graphify:
- Before: 727 nodes, 1345 links/edges.
- Incremental refresh: YES; restricted to the four changed Facebook runtime/test TypeScript files and this implementation-log document.
- After: 737 nodes, 1372 links/edges. The health check found no missing, dangling, duplicate, or collapsed edges; it reports three legitimate recursive-call self-loops already present in `compactDiagnostics`, `expandedIpv6`, and `diagnosticFromError`.

## 2026-09-30 - Render Hosted Sparticuz Chromium

Objective:
- Enable the existing `@sparticuz/chromium@141.0.0` dependency on Render Free, where no system Chrome/Chromium executable is installed, without changing the Vercel experiment, parsing, extraction, Supabase, or browser-package versions.

Runtime and executable resolution:
- `RENDER=true` identifies the Render runtime (ahead of Vercel when both variables are present for deterministic diagnostics); `VERCEL` identifies Vercel; all other environments are `local`.
- Explicit `CHROME_EXECUTABLE_PATH` or `PUPPETEER_EXECUTABLE_PATH` remains the first-priority override.
- With no override, Vercel and Render both resolve the executable through `await chromium.executablePath()`. Local development retains the existing Chrome/Chromium discovery path.

Render launch behavior:
- Render uses the existing Sparticuz/ANGLE/SwiftShader setup with the existing D configuration only: `--single-process` and `--in-process-gpu` are removed. Required `--use-gl=angle`, `--use-angle=swiftshader`, and `--enable-unsafe-swiftshader` remain validated and present.
- The Vercel A/B/C/D controlled launch matrix and warm-instance variant selection are unchanged. Render does not enter that matrix.
- Each hosted launch diagnostic now includes `runtime`, `executableSource`, exact configured launch arguments, the lifecycle cgroup current/peak/limit and `oom`/`oom_kill` fields, plus child-process exit code and signal.

Verification:
- `npm run typecheck` and `npm test` first hit the managed sandbox's `EPERM lstat C:\\Users\\novitek` restriction before TypeScript starts. The same commands passed with the established `NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main` workaround: typecheck PASS; tests PASS, 80/80.
- Added regression coverage for `RENDER=true` resolution/runtime detection and the Render-only no-`--single-process`/no-`--in-process-gpu` Sparticuz launch configuration while retaining the SwiftShader stack.
- Live Render/Facebook extraction: NOT TESTED from Codex.
- Incremental Graphify was attempted because runtime resolution changed, but it stopped before graph output because 14 changed documentation files require a semantic-extraction API key that is not available in this environment. Its query/cache metadata changed during the attempt; the existing graph was not rebuilt.

## 2026-10-01 - Migrate Puppeteer Extraction to a Cloudways Worker

Objective:
- Move the browser/Puppeteer workload off the Vercel serverless runtime to the already-verified Cloudways Debian 12 host.
- Preserve the existing AutoCheck architecture, extraction logic, parsers, validation, SSRF protections, provenance handling, API behavior, and UI.

Repository finding that shaped the change:
- Chromium was only ever launched by the Facebook branch of `/api/listing-extraction`. `isSupportedFacebookMarketplaceUrl()` routes to `renderFacebookMarketplaceListing()` (Puppeteer); every other listing uses `fetchPublicListingHtml()`, a plain validated HTTPS GET. The non-browser path therefore stays on Vercel and is unchanged.

Files created:
- `src/server/listing/browserWorker.ts` - authenticated AutoCheck -> Cloudways client.
- `deploy/cloudways-worker/` - Node worker, PHP gateway, lifecycle scripts, env example, README.
- `tests/workerBoundary.test.ts` - 24 tests for the new boundary.

Files modified:
- `src/server/listing/facebook.ts`
- `src/server/listing/handler.ts`
- `src/server/listing/secureFetch.ts`
- `src/lib/...` none. `src/app/...` none. `src/components/...` none. `next.config.ts` none.
- `.env.example`, `package.json` (test glob), `tsconfig.test.json` (test include)

Architecture:
- The worker returns the browser/network result only (`FacebookRenderedListing`). `extractFacebookListingFromRenderedText()` remains authoritative on AutoCheck, so parsing, normalization, provenance and every API response shape are unchanged.
- `handler.ts` changed one call site: `renderFacebookMarketplaceListing()` -> `renderFacebookMarketplaceListingForExtraction()`.
- The worker imports AutoCheck's existing modules instead of copying them. `resolvePublicUrl()` (SSRF) and `renderFacebookMarketplaceListing()` (navigation, render waits, redirect re-validation) are the same code on both sides.
- Unset `AUTOCHECK_WORKER_URL` to fall back to the previous in-process behaviour, which is the rollback path.

Security:
- `AUTOCHECK_WORKER_SECRET` is server-to-server only, verified with a constant-time SHA-256 comparison before routing. A missing or empty secret denies every request; there is no open mode.
- `main.ts` refuses to bind on a non-loopback host, so the worker is reachable only through the PHP gateway.
- The worker independently re-validates the target with `resolvePublicUrl()` before launching Chrome; the worker is a separate trust boundary, so Vercel validation is not trusted. Every redirect destination is still re-validated by the existing navigation guard.
- The PHP gateway hardcodes `127.0.0.1:3000`, never accepts a caller-supplied backend, rejects control characters in forwarded credential headers, caps request and response sizes, and uses 3s connect / 45s total timeouts.
- Only the Facebook Marketplace URL form is accepted by `/extract`, so the endpoint cannot become a general URL fetcher.

Resource control:
- One extraction at a time; excess requests receive `429` plus `Retry-After` instead of an unbounded queue.
- Extraction timeout (25s default), AutoCheck hop timeout (40s default), request body cap (8 KB) and response cap (4 MB) are enforced at their respective hops.
- `closeFacebookBrowserForCleanup()` closes page and browser in `finally`, then SIGKILLs a stuck Chrome process so a persistent worker leaks nothing. `stop-worker.sh` also reaps Puppeteer's Chrome processes.

Failure handling:
- New `ListingFetchError` codes: `worker-unavailable`, `worker-unauthorized`, `worker-busy`, `worker-timeout`, `worker-invalid-response`. They map to `503`/`502` with safe public messages and never expose internals.
- Worker-reported `UNSAFE_URL`/`INVALID_URL`/`UNSUPPORTED_URL` become `FACEBOOK_INVALID_URL` (existing 400 and message). Real Facebook codes are forwarded verbatim, so `publicFacebookMessage()` needed no change.
- A malformed or oversized worker response is rejected before parsing instead of being trusted.

Verification:
- Tests: PASS, 104/104 (80 pre-existing, unchanged, plus 24 new).
- Typecheck: PASS. Lint: PASS. Production build: PASS (exit 0). Worker build (`tsc -p deploy/cloudways-worker/tsconfig.json`): PASS. `php -l` on the gateway: PASS.
- Worker smoke test against the compiled `dist` output confirmed authenticated health, `401` without a credential, `404` on unknown routes, `UNSAFE_URL` blocking a loopback target, and log lines that contain no secret, query string, or page content.
- Live Cloudways/Facebook extraction: NOT TESTED from this environment; deployment steps are in `deploy/cloudways-worker/README.md`.

AI usage: ZERO
