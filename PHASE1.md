# Phase 1 Implementation Notes

## Implemented

- Complete local customer journey:
  - Home
  - Check a Car
  - Add listing by URL, pasted text, screenshots/photos metadata or manual entry
  - Review extracted vehicle details
  - Choose Free Quick Check or Full Buyer Report preview
  - View report
  - Book Mobile Inspection
  - View inspection request confirmation
- Public pages for pricing, FAQ, example report, privacy, terms, contact and 404.
- Local browser storage for intake, report, inspection request and contact draft state.
- Generated project hero image saved at `public/images/hero-autocheck-qc.png`.

## Phase 1 Polish Pass

### UI redesign completed

- Rebuilt the visual system around a more credible automotive buyer-protection identity.
- Added stronger dark/white contrast, refined cards, tighter typography, clearer spacing, improved focus states and polished mobile layouts.
- Expanded the homepage into a serious review-ready product page: hero, trust signals, process, checks, report preview, pricing comparison, Quebec guidance, inspection CTA, FAQ preview and footer.
- Removed customer-facing internal language such as Phase 1, mock engine, localStorage, future integration, demo checkout and backend-coming-later language.
- Kept one discreet preview message in the footer explaining that payments and live report delivery are not enabled.

### New intake flow

- The buyer now starts with the ad itself, not a long manual form.
- Supported input paths:
  - Listing URL
  - Pasted listing text
  - Screenshot/photo metadata
  - Manual entry fallback
- URL-only behavior is honest: the link is saved, but the app explains that marketplace pages are not read in this preview and asks for pasted text or screenshots.
- The review step shows found, missing and needs-confirmation states, with editable fields grouped by vehicle identity, listing details and seller/history claims.

### Local extraction logic

- Added `src/lib/listingExtraction.ts`.
- Extracts safe, explicit patterns for:
  - year
  - make
  - model
  - trim
  - mileage
  - asking price
  - Quebec-area city
  - VIN
  - seller type
  - Carfax mention
  - accident mention
  - rebuilt/salvage mention
  - inspection allowed
  - maintenance-record mention
- Missing or conflicting facts remain unknown. The extractor does not infer facts that are not present.

### Report redesign

- Rebuilt the report as a decision-focused buyer report instead of plain paragraphs.
- Added a premium report summary with vehicle, risk level, recommendation, inspection guidance, top concern and best next action.
- Report sections now cover:
  - Vehicle Summary
  - First Impression
  - Risk Score
  - Price Check
  - Biggest Red Flags
  - Missing Information
  - Common Areas to Verify for This Model
  - Questions to Ask the Seller
  - Message to Send the Seller
  - What to Check in Person
  - What Could Cost You Money
  - Negotiation Points
  - Deal Breakers
  - When to Walk Away
  - Inspector Focus List
  - Inspection Recommendation
  - Final Recommendation
  - Next Step
  - Disclaimer
- Report wording is cautious: model checklist items are areas to verify, not confirmed defects.

### Model-specific demo dataset

Added `src/lib/vehicleKnowledge.ts` with local verification checklists for:

- Honda Civic
- Toyota Corolla
- Mazda3
- Honda CR-V
- Toyota RAV4
- Hyundai Elantra
- Honda Odyssey
- Toyota Sienna
- Nissan Rogue

Unsupported vehicles use a general checklist instead of invented model facts.

### Bilingual status

- The working UI is English-only in this Phase 1 pass.
- The previous fake-looking language toggle was removed.
- The extractor recognizes some common French listing phrases where safe, such as French accident, inspection, Carfax and invoice wording.
- French navigation, French report copy and localized SEO pages remain Phase 2 work.

### Remaining mocked services

- Report generation is local rule-based logic.
- Listing URL scraping is not implemented.
- Screenshot contents are not analyzed or uploaded.
- Payments are not collected.
- Full reports open as previews.
- Contact and inspection request submissions are saved locally in the browser only.
- No emails, SMS, database writes, account login, marketplace dispatch, Carfax checks, RDPRM checks or production analytics run in Phase 1.

### Known limitations

- Extraction handles common listing patterns, not every ad format.
- The app cannot verify seller claims, history reports, liens, accident records or mechanical condition.
- Local browser storage is not secure account storage and can be cleared by the user or browser.
- English-only UI is not ready for a full bilingual Quebec public launch.
- Human inspection review and payment flows are represented as product paths, not live services.

### Ready for Phase 2

- The frontend flow is ready for serious product review before backend integration.
- Domain types, local extraction, report generation and service interface boundaries are separated enough to connect Phase 2 services without replacing the core buyer journey.
- Recommended next integrations: database persistence, production file storage/OCR, real report service, Stripe checkout, email delivery and admin/review workflow.

## Architectural Decisions

- Next.js App Router was selected because the folder had no existing stack and the plan prioritizes SEO, public pages and a future full web app.
- Phase 1 avoids backend services and keeps state in `localStorage`.
- Domain types live in `src/types/domain.ts` so future backend payloads can reuse the same shape.
- External services are represented by interfaces in `src/lib/serviceInterfaces.ts`.
- Business logic stays outside route components:
  - `src/lib/listingExtraction.ts`
  - `src/lib/reportEngine.ts`
  - `src/lib/vehicleKnowledge.ts`
  - `src/lib/validation.ts`
  - `src/lib/localStorage.ts`
  - `src/lib/mockData.ts`

## Routes

- `/`
- `/check`
- `/report`
- `/inspection`
- `/inspection/confirmation`
- `/example-report`
- `/pricing`
- `/faq`
- `/privacy`
- `/terms`
- `/contact`

## Quality Coverage

- Focused Node tests cover extraction, report recommendation logic, validation and storage fallback behavior.
- Playwright browser scripts under `output/playwright/` cover the main customer flow, responsive route checks, edge cases and supporting pages.
- Browser screenshots are stored under `output/playwright/` for visual review.

## Recommended Phase 2 Order

1. Add database persistence for vehicle intake, reports and inspection requests.
2. Add production file upload/storage and OCR/image analysis.
3. Add real report generation behind the existing report service interface.
4. Add Stripe Checkout and webhook-triggered report access.
5. Add transactional email delivery.
6. Add admin/review workflow for leads, reports and inspection requests.
7. Add inspection scheduling/dispatch workflow.
8. Expand French UI, reports and SEO pages.
9. Add production analytics events.
