# Project Overview

AutoCheck QC is a Phase 1, English-language frontend prototype for Quebec used-car buyers. A buyer can paste a vehicle advertisement, review conservatively extracted facts, choose a free or full preview report, receive a rules-based buyer checklist, and prepare a mobile-inspection request.

The repository is deliberately local-only. It does not currently scrape listing sites, analyze image contents, call an AI service, collect payments, send email/SMS, persist to a database, authenticate users, verify Carfax/RDPRM/SAAQ data, or dispatch inspectors. Those capabilities are described in `plan.md` but are not implemented services.

# Architecture

The application is a Next.js 15 App Router project using React 19, TypeScript, plain global CSS, and Lucide icons.

The main flow is:

1. `src/app/check/page.tsx` renders `VehicleIntakeFlow`.
2. `VehicleIntakeFlow` accepts ad text, a reference URL, image metadata, or manual data.
3. `src/lib/listingExtraction.ts` extracts explicit listing claims into `VehicleIntake`.
4. The user confirms the normalized data; `src/lib/validation.ts` validates key fields.
5. State is serialized into browser `localStorage` by `src/lib/localStorage.ts`.
6. `src/lib/reportEngine.ts` applies fixed concern-score rules and model checklists from `src/lib/vehicleKnowledge.ts`.
7. `ReportExperience` and `ReportView` render either a limited free view or a full preview.
8. `InspectionBookingForm` prepares a local inspection request, and `ConfirmationDetails` reads it back from browser storage.

There is no server-side application layer beyond Next.js page rendering. There are no Route Handlers, API routes, Server Actions, database adapters, authentication modules, or external service clients. `src/lib/serviceInterfaces.ts` defines future interfaces only; current components call local storage and the local report engine directly.

Most public routes are server-rendered page shells. Interactive flows are client components because they use browser storage, navigation, clipboard, printing, and local form state. The production build statically prerendered every current application route.

# Current State

Verified working in the current checkout:

- The home, check, contact, example report, FAQ, inspection, inspection confirmation, pricing, privacy, report, terms, and 404 routes render successfully.
- The production build statically generated 14 pages, including framework-generated pages.
- A fresh browser run completed the main customer path: paste an ad, extract and review vehicle data, generate a full report, prefill an inspection request, submit it locally, and view confirmation.
- The tested listing extracted make, model, year, trim, mileage, city, VIN, seller type, history claims, inspection permission, and maintenance-record status.
- Free/full report presentation, report scoring, seller questions, model checklists, clipboard handling, and report/inspection navigation are implemented.
- Intake and booking drafts persist in browser storage during normal use.
- The 390 px homepage check had no horizontal overflow and exposed the mobile navigation control.
- All declared lint, typecheck, unit-test, and build commands pass.
- `npm audit` reported no known registry vulnerabilities. This does not supersede the framework vendor's current hardening notice described under Problems Found.

This is a functioning product prototype, not a launch-ready service. Forms that appear to submit externally only save data to the current browser.

# Implemented Features

- Public marketing homepage with product explanation, pricing preview, Quebec guidance, FAQs, official external resources, and calls to action.
- Four intake modes: pasted ad text, reference URL, screenshot/photo metadata, and manual entry.
- Conservative local extraction for nine named vehicle models and a wider set of makes.
- Recognition of common English and limited French listing phrases.
- Editable review screen with Found, Missing, and Needs confirmation states.
- Validation for year, mileage, price, VIN, listing URL, image metadata, buyer contact data, and future appointment time.
- Free Quick Check and Full Buyer Report preview choices.
- Rules-based concern score with explainable point contributions and capped score.
- Decision-oriented report sections, seller questions/message, negotiation prompts, walk-away guidance, and inspection focus list.
- Dedicated static checklists for Honda Civic, Honda CR-V, Honda Odyssey, Toyota Corolla, Toyota RAV4, Toyota Sienna, Mazda3, Hyundai Elantra, and Nissan Rogue; unsupported vehicles use a general checklist.
- Example report page generated from local mock data.
- Local-only inspection request and confirmation flow.
- Local-only contact-message save flow.
- Browser-data deletion control.
- Pricing, FAQ, contact, privacy, terms, not-found, and inspection-related pages.
- Responsive CSS and print styles.
- Focused Node test suite covering extraction, report logic, validation, model fallback, and storage-denial behavior.

# Incomplete Features

- **Production report generation:** `ReportGenerationService` is only an interface. Missing: a real service implementation, structured runtime schema, prompt/version management, error handling, observability, and report persistence.
- **Listing URL ingestion:** URLs are validated and saved only. Missing: supported-source ingestion or a documented manual-only production decision. The current UI correctly says that marketplace pages are not read.
- **Image handling/OCR:** only file name, MIME type, and size are retained. Missing: upload transport, server-side size/type/content validation, private storage, OCR/image analysis, deletion, and failure states.
- **Payments:** displayed prices are planned. Missing: checkout, payment success/cancel pages, webhook verification, entitlement/report-access logic, refunds, and transaction records.
- **Persistence:** all product data is browser-local. Missing: database schema/migrations, repositories, retention/deletion workflows, backups, and multi-device access.
- **Contact delivery:** contact messages are saved locally but not delivered. Missing: backend endpoint, spam/rate controls, support notification, acknowledgement, and delivery status.
- **Inspection operations:** requests are saved locally only. Missing: backend submission, availability workflow, pricing, inspector assignment, notifications, rescheduling/cancellation, and status tracking.
- **Authentication/accounts:** no implementation exists.
- **Email/SMS:** interfaces/documentation exist, but there are no providers or send flows.
- **Human review:** the premium plan links to contact and explicitly cannot be ordered. Missing: checkout, review queue, reviewer UI, audit history, and delivery.
- **Admin/partner workflow:** no admin routes, authorization, lead/report/payment/request views, or inspector-partner management exist.
- **French product experience:** the public UI, reports, metadata, and SEO pages are English-only. `homeCopy.fr` is unused content, not a functioning locale.
- **Analytics/feedback:** no event instrumentation, consent design, report feedback, or conversion measurement exists.
- **Production SEO:** basic page titles/descriptions exist. Missing: sitemap, robots configuration, canonical/alternate locale metadata, structured data, Open Graph assets/metadata, and the planned city/model/content pages.
- **Automated browser tests:** browser scripts exist only under ignored `output/playwright/`; they are not tracked, installed as a project dependency, or run by `npm test`/CI.

# Problems Found

## Critical and high-priority findings

### DEP-001 — Next.js patch/hardening update is pending

- **Severity:** High operational priority.
- **Location:** `package.json` dependency declaration; `package-lock.json:3848` resolves `next` 15.5.25.
- **Evidence:** The official September 22, 2026 Next.js security notice asks 15.5 users to update to 15.5.26. It states that 15.5.26 contains related hardening and that Next.js 15.x is not affected by the specific `ImageResponse` remote-code-execution issue: <https://nextjs.org/blog/nextjs-security-update-september-22-2026>.
- **Impact:** The project is one maintenance patch behind the framework vendor's current hardening recommendation. `npm audit` returned zero vulnerabilities, demonstrating that registry audit output alone is insufficient for framework advisories.
- **Fix:** Update `next` and `eslint-config-next` together to 15.5.26, regenerate the lockfile, and rerun lint, typecheck, unit tests, build, and browser smoke tests. Next.js 15 remains Maintenance LTS according to <https://nextjs.org/support-policy>.
- **Mitigation:** Do not deploy the current lockfile publicly before reviewing the vendor notice and patching. Monitor the announced September 30 release separately; it was not available at audit time.
- **False-positive note:** The vendor explicitly says 15.x is not affected by the described RCE; this finding is about the vendor-requested hardening update, not a claim that this application is RCE-vulnerable.

### REL-001 — Unvalidated browser storage can crash routes

- **Severity:** High reliability, Low security.
- **Location:** `src/lib/localStorage.ts:10`, `src/lib/localStorage.ts:56`, `src/lib/localStorage.ts:59`, `src/components/ConfirmationDetails.tsx:12`, and `src/lib/format.ts:25`.
- **Evidence:** `readLocal<T>` uses a TypeScript cast after `JSON.parse` without runtime validation. A browser test set `autocheck-qc:v2:inspection` to `{}` and reloaded `/inspection/confirmation`; the route crashed with `TypeError: Cannot read properties of undefined (reading 'replaceAll')` in `titleCaseStatus`, called for the missing `urgency` field.
- **Impact:** Corrupt, stale, manually edited, extension-modified, or schema-incompatible local data can take down confirmation/report/intake flows instead of falling back safely. Similar unchecked reads exist for reports, report type, intake drafts, and booking drafts.
- **Fix:** Add runtime schemas and versioned migration/fallback logic for every stored payload. Reject or repair invalid data before it reaches components. Add route-level error boundaries and regression tests.
- **Mitigation:** The Privacy page's clear-data control can recover storage, but a crashed route may prevent users from discovering it.
- **False-positive note:** This was reproduced in a real browser; it is not theoretical. It is currently a local denial of service, not evidence of code execution or data exfiltration.

## Functional defects

### FUNC-001 — Province text is misidentified as Quebec City

- **Severity:** Medium.
- **Location:** `src/lib/listingExtraction.ts:123-140`.
- **Evidence:** The city extractor matches any standalone city name from a fixed list. `extractListing("2018 Honda Civic located in Gatineau, Quebec")` returned `{ city: "Quebec" }`, even though “Quebec” is the province qualifier and the actual city is Gatineau.
- **Impact:** Reports and inspection forms can display/prefill the wrong location for common Quebec address wording.
- **Fix:** Require stronger location context, distinguish Quebec City from the province, support `Québec City`/`Ville de Québec`, and leave unsupported/ambiguous cities unknown. Add regression cases for Gatineau, Montreal QC, Quebec City, and province-only mentions.

### FUNC-002 — Pricing plan query parameters are ignored

- **Severity:** Low to Medium.
- **Location:** `src/components/PricingCards.tsx:110-113` creates `/check?package=free|full`; `src/components/VehicleIntakeFlow.tsx:60-107` reads only `new` and `step`.
- **Evidence:** There is no code that reads or persists the `package` parameter.
- **Impact:** Selecting “Get Full Buyer Report” or “Get Free Quick Check” from the home/pricing page does not carry that choice through intake; the user must choose again.
- **Fix:** Validate and store the requested package on entry, then preselect or proceed consistently after review. Add a browser test for both deep links.

### FUNC-003 — Contact success state can become stale

- **Severity:** Low.
- **Location:** `src/components/ContactForm.tsx:7-25`.
- **Evidence:** `saved` becomes `true` after submit, but uncontrolled field edits never reset it.
- **Impact:** A user can edit the form after saving while the page still says the message is saved, although the changed text has not been persisted.
- **Fix:** Reset saved state on input, or make the form controlled and autosave/track dirty state explicitly.

## Security and configuration findings

### SEC-001 — Security headers are not configured in this repository

- **Severity:** Medium defense-in-depth.
- **Location:** `next.config.ts:1-8`.
- **Evidence:** No CSP, `X-Content-Type-Options`, clickjacking control, `Referrer-Policy`, or `Permissions-Policy` is configured. A localhost runtime header check returned all of those empty and exposed `X-Powered-By: Next.js`.
- **Impact:** If the deployment edge does not add headers, the app lacks common browser hardening against XSS impact, framing, MIME confusion, and excess browser capabilities.
- **Fix:** Define a tested production header policy in Next.js or deployment configuration and set `poweredByHeader: false`. CSP should be designed for the actual deployment rather than copied blindly.
- **Mitigation:** React rendering uses normal JSX escaping, and the code scan found no `dangerouslySetInnerHTML`, direct HTML sinks, dynamic code execution, remote scripts, or network request code.
- **False-positive note:** A CDN/hosting layer may add headers. That configuration is not present here and must be verified against the deployed response. HSTS was not assessed from localhost because it is deployment/TLS-specific.

### SEC-002 — Personal data is stored in JavaScript-readable local storage

- **Severity:** Low in the current prototype; higher if production scope expands.
- **Location:** `src/lib/localStorage.ts:8-35`, inspection/contact forms, and the disclosures in `src/app/privacy/page.tsx`.
- **Evidence:** Buyer name, phone, email, seller contact, location, listings, and reports are serialized to `localStorage`.
- **Impact:** Any future same-origin XSS or anyone with access to the browser profile can read the data. Storage has no confidentiality or user/account isolation.
- **Fix:** Keep this strictly preview-only, minimize stored data, validate reads, and move production personal data to an authenticated server-side store with defined retention/deletion controls.
- **Mitigation:** The product clearly discloses local storage, warns against sensitive documents/card data, does not store authentication tokens, and provides a clear-data control.

## Test, documentation, and maintainability issues

- **Browser tests are not reproducible project tests.** `PHASE1.md` says Playwright scripts cover core and responsive flows, but `.gitignore` excludes `output/`, the scripts are not tracked, Playwright is not a dependency, and no package script or CI job runs them. The ignored `customer-flow.js` also hardcodes September 15, 2026, which is now in the past and would fail booking validation if rerun unchanged.
- **No CI configuration exists.** Passing commands depend on a developer running them manually.
- **Coverage is narrow.** The single 309-line test file covers domain functions but not components, query-string behavior, malformed storage, contact state, accessibility, route errors, or deployment headers.
- **Large client components concentrate responsibilities.** `VehicleIntakeFlow.tsx` is 621 lines, `ReportView.tsx` is 409 lines, and `InspectionBookingForm.tsx` is 338 lines. Parsing state, persistence, navigation, accessibility behavior, and rendering are tightly coupled.
- **Global CSS is monolithic.** `globals.css` is 2,496 lines with many breakpoint overrides. No harmful duplicate production rule was proven, but the size makes dead-style detection and component changes difficult.
- **Unused/dead scaffolding exists.** `ButtonLink`, `RecommendationBadge`, and `SectionHeading` have no imports. `supportedLanguages`, `homeCopy`, `platformLabels`, several `siteConfig` fields, and the `mockData.ts` FAQ re-export are unused. `serviceInterfaces.ts` defines future boundaries but nothing implements or consumes them.
- **Service boundaries are weaker than the documentation suggests.** Components directly call concrete local-storage/report functions; the future service interfaces are not dependency boundaries yet.
- **Runtime/tooling versions are not aligned explicitly.** The machine ran Node 20.20.2, while `@types/node` is version 24.x and `package.json` has no `engines` field. This currently compiles, but types can expose APIs unavailable on the deployed Node runtime.
- **The local install contains two extraneous packages.** `npm ls --depth=0` reported `@emnapi/runtime` and `@img/sharp-wasm32` as extraneous. They are not a committed dependency issue but indicate local `node_modules` drift; a clean `npm ci` should be the reproducibility baseline.
- **Documentation mixes product vision and implementation state.** `plan.md` is a broad launch roadmap and includes historical statements such as there being no existing app; `README.md` and `PHASE1.md` are more accurate for the current code. The ignored browser artifacts referenced by README/PHASE1 will not exist in a clean clone.
- **No substantive TODO/FIXME markers or duplicated business-logic implementations were found.** Incompleteness is mostly explicit preview scope rather than hidden placeholder functions.

# Build & Test Status

Audit date: 2026-09-24.

Commands actually run:

- `npm run lint` — passed, exit code 0.
- `npm run typecheck` — passed, exit code 0.
- `npm test` — passed, 26 tests, 0 failures, 0 skipped/todo.
- `npm run build` — passed, exit code 0; Next.js 15.5.25 compiled and statically generated all listed routes.
- `npm audit --json` — exit code 0; 0 known vulnerabilities reported across 364 dependencies. See DEP-001 for the separate vendor hardening notice that npm audit did not flag.
- `npm outdated --json` — showed a 15.5.26 patch available for Next.js/`eslint-config-next`, minor/patch updates for several packages, and major releases for Next.js, ESLint, TypeScript, and `@types/node`. Major upgrades were not attempted during this audit.
- `npm ls --depth=0` — resolved dependency tree successfully and reported two extraneous local packages.
- Fresh Playwright CLI browser run — completed listing extraction, review, full report, inspection prefill/submission, and confirmation with no console errors on the normal path.
- Playwright malformed-storage probe — reproduced the `localStorage` crash described in REL-001.
- Playwright 390 × 844 homepage check — no horizontal overflow (`scrollWidth` 390 for viewport width 390); mobile navigation control was present.
- Local HTTP route probe — all 11 application URLs tested returned 200; an unknown URL returned 404.
- Local response-header probe — common security headers were absent in development; `X-Powered-By: Next.js` was present.
- Direct extraction probe — reproduced the Quebec City/province false positive described in FUNC-001.

The old `output/dev-server.err.log` contains missing `.next/routes-manifest.json` errors from a prior run. They were not reproduced: the fresh dev server served all tested routes, and the fresh production build passed.

# Important Files

- `package.json` — dependencies and the authoritative lint/typecheck/test/build scripts.
- `package-lock.json` — reproducible npm dependency resolution; currently resolves Next.js 15.5.25.
- `next.config.ts` — minimal Next configuration; strict mode and tracing root only.
- `tsconfig.json` / `tsconfig.test.json` — strict application compilation and CommonJS test emission into `output/tests`.
- `eslint.config.mjs` — Next.js core-web-vitals and TypeScript ESLint configuration.
- `src/app/` — App Router pages, metadata, layout, not-found page, and global stylesheet.
- `src/components/VehicleIntakeFlow.tsx` — complete multi-step listing intake/review/package-selection UI.
- `src/components/ReportExperience.tsx` — loads local intake, selects report type, generates and stores the report.
- `src/components/ReportView.tsx` — free/full report presentation, navigation, print, and clipboard behavior.
- `src/components/InspectionBookingForm.tsx` — local inspection form, draft persistence, validation, and request creation.
- `src/components/ConfirmationDetails.tsx` — local inspection request confirmation view.
- `src/components/ContactForm.tsx` — local-only contact-message save behavior.
- `src/lib/listingExtraction.ts` — regex-based ad extraction and empty intake defaults.
- `src/lib/reportEngine.ts` — concern scoring, recommendations, questions, report assembly, and disclaimer.
- `src/lib/vehicleKnowledge.ts` — nine model-specific editorial verification checklists plus general fallback.
- `src/lib/validation.ts` — intake, URL, VIN, image metadata, and booking validation.
- `src/lib/localStorage.ts` — namespaced browser persistence and memory fallback; currently lacks runtime schemas.
- `src/lib/serviceInterfaces.ts` — unused interfaces proposed for future backend services.
- `src/types/domain.ts` — domain models for intake, reports, and inspection requests.
- `src/content/` — FAQ, contact topics, official links, and partially unused localization/content scaffolding.
- `tests/domain.test.ts` — all tracked automated tests.
- `README.md` / `PHASE1.md` — current prototype scope and limitations.
- `plan.md` — broader business/product/launch roadmap; not an implementation-status document.
- `public/images/hero-autocheck-qc.png` / `public/favicon.svg` — visual assets.
- `output/playwright/` — useful but ignored local browser scripts/screenshots; not part of a clean checkout.

# Technical Debt

- Introduce schemas at every persistence/service boundary instead of relying on generic TypeScript casts.
- Split the three largest client components into state/controller hooks and focused view components.
- Break the global stylesheet into maintainable layers or component-scoped modules and remove verified unused rules.
- Convert useful ignored Playwright scripts into tracked, date-independent automated tests.
- Add CI using `npm ci`, lint, typecheck, unit tests, production build, and browser smoke tests.
- Remove unused components/content or wire them into a deliberate localization/design system.
- Align `@types/node` with the supported deployment runtime and declare `engines.node`.
- Either implement the service interfaces as real adapters or remove/replace them with an architecture that current code actually uses.
- Establish score/checklist versioning, editorial review, provenance, and regression fixtures before presenting rules as a production decision tool.
- Separate historical product planning from a concise living implementation roadmap.

# Recommended Next Steps

## 1. Critical fixes

1. Patch Next.js and `eslint-config-next` from 15.5.25 to 15.5.26, regenerate the lockfile, and rerun the complete verification suite. Monitor the separately announced 15.5.27 release when it becomes available.

## 2. Required fixes

1. Add runtime validation/migration for every `localStorage` payload and regression-test malformed/stale data.
2. Add a user-safe error boundary for client-flow failures.
3. Correct Quebec location extraction and add a larger table of positive, negative, ambiguous, and bilingual fixtures.
4. Honor or remove the `?package=free|full` deep links.
5. Convert the browser scripts into tracked, repeatable tests with dynamically generated future dates and add CI.
6. Define and verify production security headers; confirm the actual hosting-edge response before launch.
7. Align and document the supported Node runtime and clean-install workflow.

## 3. Feature completion

1. Choose and implement one end-to-end backend vertical slice: persisted intake/report records, runtime schemas, server authorization boundaries, and deletion/retention behavior.
2. Implement real report generation behind a tested service adapter with versioned prompts/rules and failure handling.
3. Add private file upload/OCR only after server-side validation, storage, and deletion controls are designed.
4. Add payment checkout and verified webhooks before enabling paid report claims.
5. Add email/contact/inspection delivery and operational status handling.
6. Build French navigation, forms, reports, legal copy, metadata, and SEO pages with qualified review.

## 4. Improvements

1. Refactor large client components and global CSS.
2. Expand component, accessibility, route, and report-fixture coverage.
3. Add sitemap, robots, canonical/locale metadata, structured data, and social metadata.
4. Remove dead scaffolding and reconcile README/PHASE1 claims with what a clean clone contains.
5. Add analytics/feedback only with a documented privacy and consent approach.

## 5. Optional future work

1. Human review queue and reviewer audit trail.
2. Inspector partner portal, dispatch, scheduling, completion, and commission workflows.
3. Accounts, saved vehicles, comparison, report sharing, and multi-device access.
4. Expanded model/year/powertrain knowledge with reviewed sources and versioning.
5. City/model SEO content and carefully measured acquisition experiments.

# Next Recommended Task

**Upgrade Next.js and `eslint-config-next` to 15.5.26, regenerate the lockfile, and rerun lint, typecheck, all 26 unit tests, the production build, and the browser smoke flow.**

This is the single next task because the installed 15.5.25 release is behind an official out-of-band hardening update published two days before this audit. It is a small, isolated, verifiable change that reduces framework risk before broader reliability fixes or feature work. The follow-up task should then be runtime validation and migration of all browser-stored payloads, starting with a regression test for the reproduced confirmation-route crash.
