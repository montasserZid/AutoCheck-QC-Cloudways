# Graph Report - AutoCheck QC  (2026-09-29)

## Corpus Check
- 81 files · ~125,509 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 646 nodes · 1238 edges · 36 communities (32 shown, 4 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 53 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- ContactForm.tsx
- serviceInterfaces.ts
- domain.test.ts
- next
- secureFetch.ts
- listingUrlExtraction.ts
- package.json
- 202609270001_initial_operational_schema.sql
- compilerOptions
- AutoCheck QC Project Status
- compilerOptions
- AutoCheck QC Complete Roadmap
- Paid Full AI Buyer Report
- Q: Fix the Vercel Facebook detached-frame race without changing packaging or extraction semantics.
- AutoCheck QC README
- Local Customer Journey
- Conservative Local Listing Extraction
- Automotive Quality Control
- Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first.
- Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection
- Recommended Phase 2 Integrations
- White Car Silhouette
- Planned Domain Data Model
- SectionHeading.tsx
- next-env.d.ts
- facebook_listing_test.ts
- facebook.ts
- AutoCheck QC - Current Project State
- Q: Why did Vercel omit Puppeteer's browser helper package?
- VehicleIntakeFlow.tsx
- Q: Locate and fix the Facebook browser launch path for local Windows Chrome and Vercel Chromium
- Q: Why did Facebook login UI cause a false extraction failure?
- eslint.config.mjs
- Q: Continue the exact Vercel Puppeteer packaging investigation and stop transitive dependency whack-a-mole.

## God Nodes (most connected - your core abstractions)
1. `VehicleIntakeFlow()` - 26 edges
2. `next` - 24 edges
3. `VehicleIntake` - 22 edges
4. `AutoCheck QC - Current Project State` - 21 edges
5. `renderFacebookMarketplaceListing()` - 17 edges
6. `compilerOptions` - 16 edges
7. `Container()` - 15 edges
8. `extractVehicleObject()` - 15 edges
9. `InspectionBookingForm()` - 14 edges
10. `extractListingFromHtml()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Snapshot Metadata` --references--> `main()`  [INFERRED]
  docs/CURRENT_PROJECT_STATE.md → fb_ref/facebook_listing_test.ts
- `What Works Today` --references--> `ReportExperience()`  [INFERRED]
  docs/CURRENT_PROJECT_STATE.md → src/components/ReportExperience.tsx
- `What Works Today` --references--> `ReportView()`  [INFERRED]
  docs/CURRENT_PROJECT_STATE.md → src/components/ReportView.tsx
- `2026-09-29 - Facebook Marketplace Browser Extraction Upgrade` --references--> `extractListingFromHtml()`  [INFERRED]
  docs/IMPLEMENTATION_LOG.md → src/lib/listingUrlExtraction.ts
- `Reports` --references--> `ReportGenerationService`  [INFERRED]
  docs/CURRENT_PROJECT_STATE.md → src/lib/serviceInterfaces.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 1 Local Buyer Flow** — phase1_ad_first_intake, phase1_conservative_extraction, phase1_decision_focused_report, phase1_local_only_services [EXTRACTED 1.00]
- **Planned Revenue and Service Ladder** — plan_free_quick_check, plan_paid_full_ai_buyer_report, plan_premium_human_review, plan_inspection_booking [EXTRACTED 1.00]
- **Documented Prototype-to-Production Transition** — readme_mocked_exclusions, phase1_phase_2_integrations, project_status_production_service_gap, plan_recommended_stack [INFERRED 0.85]
- **Vehicle Icon Composition** — public_favicon_car_silhouette, public_favicon_windshield, public_favicon_red_wheels [INFERRED 0.95]
- **Automotive Inspection Workflow** — public_images_hero_autocheck_qc_inspector, public_images_hero_autocheck_qc_suv, public_images_hero_autocheck_qc_mobile_documentation, public_images_hero_autocheck_qc_inspection_checklist, public_images_hero_autocheck_qc_measuring_tape [INFERRED 0.95]

## Communities (36 total, 4 thin omitted)

### Community 0 - "ContactForm.tsx"
Cohesion: 0.09
Nodes (28): ref_server_only, @supabase/supabase-js, dynamic, POST, dynamic, GET(), metadata, ContactForm() (+20 more)

### Community 1 - "serviceInterfaces.ts"
Cohesion: 0.09
Nodes (16): ContactMessageInserter, ContactMessageInsertRow, ContactMessagePersistenceError, createContactMessageRepository(), InsertedContactMessage, ListingSourceType, OperationalRepository, StoredOperationalRecord (+8 more)

### Community 2 - "domain.test.ts"
Cohesion: 0.09
Nodes (27): ref_node_assert, ref_node_test, ExampleReportPage(), metadata, formatCurrencyCad(), formatKilometers(), titleCaseStatus(), amount() (+19 more)

### Community 3 - "next"
Cohesion: 0.06
Nodes (28): nextConfig, next, react, metadata, metadata, src_app_globals, metadata, metadata (+20 more)

### Community 4 - "secureFetch.ts"
Cohesion: 0.09
Nodes (37): ref_node_dns, ref_node_http, ref_node_https, ref_node_net, dynamic, maxDuration, POST, runtime (+29 more)

### Community 5 - "listingUrlExtraction.ts"
Cohesion: 0.16
Nodes (33): addListingField(), asArray(), cleanText(), decodeEntities(), extractAddress(), ExtractionSource, extractListingFromHtml(), extractListingIdentity() (+25 more)

### Community 6 - "package.json"
Cohesion: 0.06
Nodes (35): dependencies, lucide-react, next, puppeteer-core, react, react-dom, @sparticuz/chromium, @supabase/supabase-js (+27 more)

### Community 7 - "202609270001_initial_operational_schema.sql"
Cohesion: 0.15
Nodes (21): public, public.set_updated_at, contact_messages_open_created_at_idx, contact_messages_set_updated_at, inspection_requests_listing_id_idx, inspection_requests_report_id_idx, inspection_requests_set_updated_at, inspection_requests_status_created_at_idx (+13 more)

### Community 8 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 9 - "AutoCheck QC Project Status"
Cohesion: 0.16
Nodes (14): Phase 1 Quality Coverage, Unvalidated Browser Storage Reliability Defect, Stale Contact Saved-State Defect, Patch Next.js Before Broader Work, Next.js Hardening Update Finding, Next.js Security Update September 22 2026, Ignored Pricing Package Query Defect, AutoCheck QC Project Status (+6 more)

### Community 10 - "compilerOptions"
Cohesion: 0.15
Nodes (12): ./tsconfig.json, compilerOptions, incremental, module, moduleResolution, noEmit, outDir, plugins (+4 more)

### Community 11 - "AutoCheck QC Complete Roadmap"
Cohesion: 0.22
Nodes (9): Ad-First Intake Flow, AutoCheck QC Complete Roadmap, Used-Car Buyer Pre-Screening Business Concept, Planned Full User Journey, OPC Used Car Dealer Guidance, Pre-Screen Before Professional Inspection, Gouvernement du Québec Vehicle Purchase Guidance, SAAQ Vehicle Transfer Guidance (+1 more)

### Community 12 - "Paid Full AI Buyer Report"
Cohesion: 0.42
Nodes (9): Input Process Output Feedback Automation Map, Free Quick Check, Initial Three-Offer Pricing Strategy, Inspection Booking and Partner Referral, Manual Partner Dispatch for V1, Minimum Monthly Net Revenue Target, Paid Full AI Buyer Report, Premium Human Review (+1 more)

### Community 13 - "Q: Fix the Vercel Facebook detached-frame race without changing packaging or extraction semantics."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Fix the Vercel Facebook detached-frame race without changing packaging or extraction semantics., Source Nodes

### Community 15 - "AutoCheck QC README"
Cohesion: 0.25
Nodes (8): Next.js App Router Selection, Recommended Next.js Supabase Stripe Stack, Production Service Implementation Gap, AutoCheck QC README, Documented Phase 1 Features, Repository Project Structure, Frontend Local-Only Prototype Scope, Phase 1 Technology Stack

### Community 16 - "Local Customer Journey"
Cohesion: 0.29
Nodes (7): Phase 1 Bilingual Product Gap, Local Customer Journey, Phase 1 Implementation Notes, Bilingual Quebec Market Strategy, Bilingual Quebec SEO Strategy, Current Application Architecture, Main Customer Flow

### Community 17 - "Conservative Local Listing Extraction"
Cohesion: 0.33
Nodes (7): Conservative Local Listing Extraction, Decision-Focused Buyer Report, Model-Specific Verification Checklists, Two-Step AI Extraction and Report Workflow, Report Safety and Non-Fabrication Rules, Planned Used-Car Risk Analysis, Planned Structured Listing Extraction

### Community 18 - "Automotive Quality Control"
Cohesion: 0.33
Nodes (7): Vehicle Inspection Checklist, Vehicle Inspector, Inspection Measuring Tape, Mobile Vehicle Photo Documentation, Automotive Quality Control, Gray SUV, Vehicle Inspection Scene

### Community 19 - "Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first., Source Nodes

### Community 20 - "Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection, Source Nodes

### Community 21 - "Recommended Phase 2 Integrations"
Cohesion: 0.50
Nodes (5): Local-Only Mocked Services, Recommended Phase 2 Integrations, Separated Domain and Service Boundaries, Mocked and Excluded Production Capabilities, Phase 2 Backend Integration Readiness

### Community 22 - "White Car Silhouette"
Cohesion: 0.40
Nodes (5): White Car Silhouette, AutoCheck Favicon Icon, Red Car Wheels, Dark Rounded-Square Background, Light Gray Windshield

### Community 23 - "Planned Domain Data Model"
Cohesion: 0.67
Nodes (3): Planned Domain Data Model, Production Privacy Principles, JavaScript-Readable Personal Data Storage

### Community 28 - "facebook_listing_test.ts"
Cohesion: 0.10
Nodes (32): Snapshot Metadata, 2026-09-29 - Facebook False Login-Required Classification Fix, buildOptions(), canonicalItemUrl(), countItemAnchors(), detectState(), extractId(), extractLabeledFields() (+24 more)

### Community 29 - "facebook.ts"
Cohesion: 0.07
Nodes (48): 2026-09-29 - Vercel Facebook Detached-Frame Lifecycle Fix, 2026-09-29 - Vercel Facebook Render-Wait Polling Fix, ref_node_fs, ListingField, addRenderedText(), assertFacebookNavigation(), BrowserEnvironment, BrowserLike (+40 more)

### Community 30 - "AutoCheck QC - Current Project State"
Cohesion: 0.11
Nodes (18): AI Status, AutoCheck QC - Current Project State, Contact, Current User Flow, Data & Persistence, Free vs Full, Graphify, Known Limitations / Blockers (+10 more)

### Community 31 - "Q: Why did Vercel omit Puppeteer's browser helper package?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Why did Vercel omit Puppeteer's browser helper package?, Source Nodes

### Community 32 - "VehicleIntakeFlow.tsx"
Cohesion: 0.06
Nodes (65): Inspection, Listing URL Extraction, Reports, Boundary and security model, Current application data map, Database foundation, 2026-09-28 - Listing Fetch Network Failure Debug/Fix, 2026-09-28 - Listing URL Deterministic Auto-Fill (+57 more)

### Community 35 - "Q: Locate and fix the Facebook browser launch path for local Windows Chrome and Vercel Chromium"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Locate and fix the Facebook browser launch path for local Windows Chrome and Vercel Chromium, Source Nodes

### Community 36 - "Q: Why did Facebook login UI cause a false extraction failure?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Why did Facebook login UI cause a false extraction failure?, Source Nodes

### Community 39 - "eslint.config.mjs"
Cohesion: 0.25
Nodes (7): compat, __dirname, eslintConfig, __filename, ref_eslint_eslintrc, ref_node_path, ref_node_url

### Community 40 - "Q: Continue the exact Vercel Puppeteer packaging investigation and stop transitive dependency whack-a-mole."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Continue the exact Vercel Puppeteer packaging investigation and stop transitive dependency whack-a-mole., Source Nodes

## Knowledge Gaps
- **197 isolated node(s):** `__filename`, `__dirname`, `compat`, `eslintConfig`, `Result` (+192 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 262 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Preferred sources** — corroborated by past sessions; start here.
- `package.json` (2× useful, score=1.952863681)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `ContactForm.tsx`, `domain.test.ts`, `VehicleIntakeFlow.tsx`, `package.json`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `VehicleIntake` connect `VehicleIntakeFlow.tsx` to `serviceInterfaces.ts`, `domain.test.ts`, `facebook.ts`, `listingUrlExtraction.ts`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `AutoCheck QC - Current Project State` connect `AutoCheck QC - Current Project State` to `VehicleIntakeFlow.tsx`, `facebook_listing_test.ts`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `VehicleIntakeFlow()` (e.g. with `Listing URL Extraction` and `2026-09-28 - Listing URL Deterministic Auto-Fill`) actually correct?**
  _`VehicleIntakeFlow()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `VehicleIntake` (e.g. with `Listing URL Extraction` and `Current application data map`) actually correct?**
  _`VehicleIntake` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `__filename`, `__dirname`, `compat` to the rest of the system?**
  _197 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ContactForm.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0858974358974359 - nodes in this community are weakly interconnected._