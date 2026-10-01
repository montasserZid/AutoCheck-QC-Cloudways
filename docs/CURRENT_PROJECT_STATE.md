# AutoCheck QC - Current Project State

## Product Purpose

AutoCheck QC is a Next.js used-car pre-screening prototype for Quebec buyers. It helps a buyer bring in a vehicle listing, review extracted facts, choose a Free Quick Check or Full Buyer Report preview, read a deterministic rules-based report, and prepare an inspection/contact follow-up.

The current product is still a prototype/early operational slice. It now includes server routes for listing URL extraction and contact submission, plus a Supabase operational schema and repository layer, but most buyer journey state is still browser-local.

## Current User Flow

Graphify shows the main customer path as:

Landing/pricing/contact pages -> `/check` listing intake -> URL/text/photo/manual extraction and review -> Free/Full selection -> `/report` report generation/rendering -> `/inspection` booking form -> `/inspection/confirmation`.

Important route/page nodes include `app/page.tsx`, `check/page.tsx`, `report/page.tsx`, `inspection/page.tsx`, `inspection/confirmation/page.tsx`, `contact/page.tsx`, `example-report/page.tsx`, plus supporting pricing/FAQ/legal/not-found pages. API route nodes include `/api/listing-extraction`, `/api/contact`, and a dev Supabase route.

## What Works Today

- IMPLEMENTED: Landing and public content pages.
- IMPLEMENTED: Listing intake through pasted ad text, listing URL, photo metadata, and manual entry.
- IMPLEMENTED: Deterministic listing URL extraction path from browser to API to secure fetcher to parser to review screen.
- IMPLEMENTED: Editable review flow with validation and local draft persistence.
- IMPLEMENTED: Free/Full report selection in the runtime flow.
- IMPLEMENTED: Rules-based report generation through `reportEngine.ts`, rendered by `ReportExperience`/`ReportView`.
- IMPLEMENTED: Local inspection booking and confirmation flow.
- IMPLEMENTED/PARTIAL: Contact submission now has an API/server/repository path and Supabase table support, but full production delivery/notification is not verified in this snapshot.
- PARTIAL: Supabase persistence foundation exists, but most customer flows still use browser `localStorage`.
- LOCAL/MOCK: Payments, authentication, email/SMS delivery, inspector dispatch, and human review operations.
- BLOCKED: Live listing fetch tests were blocked by this environment's DNS/outbound network restrictions.
- NOT IMPLEMENTED: Runtime AI report generation or AI listing extraction.

## Listing Intake

Current intake methods are:

- Listing URL: posts to `/api/listing-extraction`, then prefills the existing review/edit step when extraction succeeds or partially succeeds.
- Pasted listing text: handled locally by `listingExtraction.ts`.
- Photo/screenshot metadata: stores file metadata only; no OCR or image-content analysis is implemented.
- Manual entry: buyer enters vehicle facts directly.

## Listing URL Extraction

Current architecture from Graphify and the implementation log:

URL -> `VehicleIntakeFlow` -> `listingUrlClient.extractListingUrl()` -> `/api/listing-extraction` -> `createListingExtractionPostHandler()` -> `fetchPublicListingHtml()` -> deterministic `listingUrlExtraction.ts` -> normalized `VehicleIntake` fields/provenance -> review/edit.

The fetcher is server-only and applies SSRF protections before any HTML is parsed. The parser uses deterministic sources only: JSON-LD, embedded JSON/state, metadata, labelled HTML, text extraction, normalization, and source/host inference. No remote JavaScript execution, proxy bypassing, marketplace authentication bypass, CAPTCHA handling, or headless browser scraping is implemented.

Supported fields documented in the latest implementation log include year, make, model, trim, CAD asking price/currency, mileage/unit, VIN, transmission, drivetrain, engine, city/location, seller name/type/description, listing title/source/url, and deterministic seller claims when recognized.

Real-world status: live AutoTrader/dealer/Kijiji-style URL retrieval could not be proven from this sandbox because DNS/outbound connections failed. The latest log explicitly says no live success was claimed and source-specific adapters are deferred until network-enabled testing.

## Data & Persistence

Supabase is integrated at the dependency/schema/repository level. Graphify shows `@supabase/supabase-js`, `src/lib/supabase.ts`, `src/server/supabase/admin.ts`, `src/lib/data/contactMessageRepository.ts`, `src/lib/data/operationalRepository.ts`, and `src/server/data/operationalRepository.ts`.

The operational schema includes tables for `vehicles`, `listings`, `reports`, `inspection_requests`, and `contact_messages`, with indexes/triggers shown in Graphify. `docs/database-foundation.md` states that all operational tables have forced RLS, restrictive deny policies for anon/authenticated, and revoked public API grants; sensitive writes are intended to be mediated by validated server routes using `SUPABASE_SECRET_KEY`.

Runtime persistence remains mixed:

- Browser/localStorage still stores intake draft, intake, report type, report, booking draft, inspection request, and local recovery/clear-data flows.
- Supabase persistence is present for contact/operational repository paths, but broad migration of the full customer flow to server persistence is not verified in this snapshot.
- Binary photo upload/storage is not implemented; only metadata is retained.

## Free vs Full

Free and Full are implemented as report package choices in the UI/runtime flow and saved in browser storage for report rendering. Current enforcement is presentation-level/report-content gating in the prototype, not payment-backed entitlement. Pricing and paid report concepts exist, but checkout, webhooks, account entitlements, refunds, paid access control, and production report access records are not implemented.

## Reports

Reports are currently generated by local deterministic code in `reportEngine.ts`, using the normalized intake and `vehicleKnowledge.ts` model checklists. `ReportExperience` loads stored intake/report type and creates the report; `ReportView` renders the free/full report experience, clipboard/print/navigation behavior, recommendations, questions, and inspection focus.

Production AI report generation is not active. `ReportGenerationService` exists as an interface/planned boundary, not a verified runtime service.

## Contact

The contact flow has advanced beyond the older local-only documentation. Graphify shows `ContactForm.tsx`, `contactSubmission.ts`, `/api/contact`, `server/contact/handler.ts`, `contactMessageRepository.ts`, and Supabase admin/repository modules. This indicates a server-mediated contact persistence architecture with validation and repository insertion.

Delivery beyond persistence, such as email/SMS/support notification, was not verified and should be treated as not implemented.

## Inspection

The inspection flow is implemented locally: `InspectionBookingForm` validates a booking request, persists draft/request data through `localStorage.ts`, and `ConfirmationDetails` reads the stored request. Supabase tables/repository methods for inspection requests exist, but this snapshot did not verify that the customer inspection runtime path writes to Supabase. Inspector availability, dispatch, notifications, rescheduling, cancellation, and operational status workflow are not implemented.

## Security

Existing protections identified from Graphify/docs/logs:

- Supabase boundary: server-only admin client and secret handling are separated from browser bundles; operational tables use forced RLS and deny public policies.
- Validation: intake, booking, VIN, URL, and photo metadata validation exist in `validation.ts`; contact validation exists in the contact submission/handler path.
- Listing SSRF controls: allowed protocols only, credential rejection, DNS/IP validation, rejection of localhost/private/link-local/reserved targets, redirect revalidation, timeout, redirect count, body-size limits, and HTML content-type checks.
- Browser worker boundary: the Puppeteer workload for Facebook Marketplace listings now runs on a Cloudways host instead of Vercel serverless. AutoCheck authenticates the hop with a server-only `AUTOCHECK_WORKER_SECRET` (constant-time comparison), the worker binds to `127.0.0.1` only and is publicly reachable only through a thin PHP gateway, browser concurrency is bounded to one extraction at a time with explicit `429` rejections, and the worker re-validates every target with the same `resolvePublicUrl()` SSRF guard AutoCheck uses. Parsing, normalization and provenance remain on the AutoCheck side, so no extraction logic was duplicated.
- Secret handling: Supabase secret use is server-side through `src/server/supabase/admin.ts`. Worker communication secrets are server-only and never prefixed with `NEXT_PUBLIC_`.

This is not a fresh security audit. Existing documentation still notes missing production security headers and unvalidated browser storage risks.

## AI Status

AI does not currently exist in runtime listing URL extraction or report generation. The latest implementation log explicitly records `AI USED: NO` and `AI CALLS FOR URL EXTRACTION: ZERO`. AI-based workflows are roadmap/planning concepts only.

## Vehicle Knowledge Dataset

`vehicleKnowledge.ts` exists and is integrated into report generation as model-specific verification/checklist data with a general fallback. A large vehicle-problems dataset is not verified as present or integrated in this snapshot. The database foundation document also states the future vehicle-knowledge corpus is separate and not represented/imported there.

## Payments / Authentication / External Services

Payments are not implemented beyond UI/pricing concepts and service interfaces. Authentication/accounts are not implemented. Email/SMS, OCR/image analysis, payment processors, inspector dispatch, Carfax/RDPRM/SAAQ verification, and marketplace-specific external integrations are not verified as runtime services.

## Tests / Build

Last documented result from `docs/IMPLEMENTATION_LOG.md` on 2026-09-28:

- Lint: PASS.
- Typecheck: PASS.
- Tests: PASS, 47/47 after listing fetch diagnostics.
- Production build: BLOCKED in this sandbox by `.next/trace` permission/disk conditions, after source typecheck and tests passed.

Earlier `PROJECT_STATUS.md` results from 2026-09-24 reported lint/typecheck/tests/build passing, but that document predates the latest listing URL and Supabase/contact changes. No test/build suite was rerun for this documentation snapshot.

## Graphify

Existing Graphify graph was used as the primary source. The current `graphify-out/graph.json` contains 498 nodes and 951 links, plus 5 hyperedges. `GRAPH_REPORT.md` appears older/stale for counts, so the graph JSON count is used for this snapshot.

## Known Limitations / Blockers

- Live listing retrieval cannot be confirmed in this sandbox because outbound network/DNS is restricted.
- Browser `localStorage` remains a major runtime dependency and older documentation reports malformed-storage crash risk.
- Free vs Full is not payment/entitlement enforced.
- Full customer persistence to Supabase is only partial/not verified.
- Security headers remain a documented production hardening gap.
- Source-specific listing adapters are deferred.
- Browser smoke tests/CI status are not verified in this snapshot.

## Not Yet Implemented

- Payment checkout, webhook verification, and paid entitlements.
- User accounts/authentication and multi-device saved reports.
- Production AI/report-generation service.
- OCR or uploaded binary file storage.
- Inspector scheduling/dispatch operations.
- Email/SMS/support delivery.
- Human review queue and admin/partner workflows.
- Large integrated vehicle-problems dataset.
- Confirmed live source adapters for AutoTrader/Kijiji/dealer pages.

## Recommended Next Step

1. Verify and complete one vertical persistence slice: choose contact or inspection, confirm the runtime path writes through validated server code to Supabase, and document the resulting boundary/tests.
2. In a network-enabled environment, test listing URL extraction against real supported sources and decide whether source-specific adapters are needed before presenting URL extraction as reliable.

## Snapshot Metadata

- Date: 2026-09-28.
- Git branch/commit: `main` / `c0e9b1d` from `.git/HEAD` and direct ref read; normal `git rev-parse` was blocked by dubious ownership protection.
- Graphify nodes/links: 498 nodes, 951 links.
- Graphify hyperedges: 5.
- Last documented tests: PASS, 47/47 on 2026-09-28.
- Last documented build status: BLOCKED in sandbox on 2026-09-28 by `.next/trace` permission/disk issue; earlier 2026-09-24 build passed before latest changes.
