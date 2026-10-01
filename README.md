# AutoCheck QC

AutoCheck QC is a Phase 1 frontend prototype for used-car listing pre-screening and mobile inspection requests in Quebec. It helps a buyer turn a marketplace ad into a structured checklist of red flags, missing information, seller questions, negotiation points and inspection focus areas.

Customer workflows still use local data. A production-oriented Supabase schema
and server-only access boundary are available, but application persistence,
production AI, payments, scraping, OCR, email, SMS, authentication and
inspection dispatch services are not implemented.

## Stack

- Next.js App Router
- React
- TypeScript
- Plain CSS in `src/app/globals.css`
- Browser `localStorage` for local Phase 1 persistence
- Local listing extraction in `src/lib/listingExtraction.ts`
- Local report generation in `src/lib/reportEngine.ts`
- Static model checklist data in `src/lib/vehicleKnowledge.ts`

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Default local URL:

```text
http://localhost:3000
```

## Supabase Connection

Set the values from your Supabase project's Connect dialog in `.env.local`
(ignored by Git), using the variable names in `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Use a publishable key from Settings > API Keys, never a secret or service-role
key. Restart the development server after changing environment variables.
`src/lib/supabase.ts` provides `createSupabaseClient()` for browser and server
callers with session persistence, token refresh and URL session detection disabled.
Configuration is validated when called, so existing pages build without credentials.

With `npm run dev` running, request `/api/dev/supabase`. A successful read-only
Supabase Auth settings check returns `{"ok":true,"service":"supabase"}`.
The check does not require tables, return settings or keys, or modify data.
It returns 404 outside development. This verifies API connectivity and key
acceptance, not table permissions or database persistence.

The reproducible operational schema is in `supabase/migrations/`. It uses UUID
keys, database-managed timestamps, relational integrity, and deny-by-default RLS.
Until authentication is implemented, database access is server-mediated through
`src/server/`; privileged code expects `SUPABASE_SECRET_KEY` only in the server
environment. Do not prefix that variable with `NEXT_PUBLIC_`.
Applying migrations from a trusted development machine additionally uses
`SUPABASE_DB_PASSWORD`; application code must never read that variable.

## Quality Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` compiles the focused Node test suite and runs extraction, report logic, validation and local-storage behavior tests.

## Project Structure

```text
src/app/                  Route pages and global CSS
src/components/           Reusable UI and flow components
src/content/              Public copy shared by routes/components
src/lib/                  Extraction, report logic, vehicle data, persistence helpers
src/lib/data/             Backend-neutral operational repository contracts
src/server/               Server-only integrations and privileged clients
src/types/                Domain types for intake, reports and inspection requests
supabase/migrations/      Reproducible database schema and security migrations
supabase/tests/           Rollback-only database verification SQL
docs/                     Architecture and current-data documentation
tests/                    Focused Node tests for Phase 1 logic
public/images/            Project visual assets
output/playwright/        Browser test artifacts and screenshots
```

## Phase 1 Implements

- Premium public homepage for Quebec used-car buyers.
- Ad-first intake flow with listing URL, pasted listing text, screenshot/photo metadata and manual-entry fallback.
- Conservative local extraction for common listing patterns.
- Editable vehicle review step with found, missing and needs-confirmation states.
- Free Quick Check and Full Buyer Report preview selection.
- Decision-focused report experience with risk scoring, seller questions, missing information, negotiation points, inspection focus list and final recommendation.
- Static verification checklists for Honda Civic, Toyota Corolla, Mazda3, Honda CR-V, Toyota RAV4, Hyundai Elantra, Honda Odyssey, Toyota Sienna and Nissan Rogue.
- Pricing, FAQ, example report, mobile inspection request, confirmation, contact, privacy, terms and 404 pages.
- Local-only contact/request persistence with deletion controls.
- English UI. French listing phrases are partially recognized by the extractor, but French navigation/reports are not implemented in Phase 1.

## Mocked or Excluded

- Real AI report generation
- Real marketplace scraping
- Production OCR/image analysis
- Vehicle history, Carfax, RDPRM or SAAQ API checks
- Market pricing APIs
- Production file uploads
- Stripe/payment collection
- Email/SMS delivery
- Database persistence
- Authentication/accounts
- Inspector marketplace or partner dispatch
- Production analytics

## Phase 2 Readiness

The Phase 1 frontend now has the right product flow and service boundaries for backend integration. The next phase should connect persistence, production report generation, payments and messaging behind the existing domain/service interfaces without changing the core buyer journey.
