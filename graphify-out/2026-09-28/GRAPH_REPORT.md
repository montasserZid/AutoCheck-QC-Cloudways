# Graph Report - AutoCheck QC  (2026-09-28)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 420 nodes · 761 edges · 27 communities (23 shown, 4 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- next
- VehicleIntakeFlow.tsx
- domain.test.ts
- package.json
- domain.ts
- contactMessageRepository.ts
- 202609270001_initial_operational_schema.sql
- ContactForm.tsx
- compilerOptions
- AutoCheck QC Project Status
- compilerOptions
- AutoCheck QC Complete Roadmap
- Paid Full AI Buyer Report
- eslint.config.mjs
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

## God Nodes (most connected - your core abstractions)
1. `next` - 24 edges
2. `VehicleIntakeFlow()` - 22 edges
3. `compilerOptions` - 16 edges
4. `VehicleIntake` - 15 edges
5. `Container()` - 15 edges
6. `InspectionBookingForm()` - 13 edges
7. `react` - 12 edges
8. `generateDemoReport()` - 11 edges
9. `readLocal()` - 10 edges
10. `writeLocal()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Current application data map` --references--> `VehicleIntake`  [INFERRED]
  docs/database-foundation.md → src/types/domain.ts
- `Decision-Focused Buyer Report` --semantically_similar_to--> `Paid Full AI Buyer Report`  [INFERRED] [semantically similar]
  PHASE1.md → plan.md
- `Ad-First Intake Flow` --semantically_similar_to--> `Planned Full User Journey`  [INFERRED] [semantically similar]
  PHASE1.md → plan.md
- `Next.js App Router Selection` --semantically_similar_to--> `Recommended Next.js Supabase Stripe Stack`  [INFERRED] [semantically similar]
  PHASE1.md → plan.md
- `Local Customer Journey` --semantically_similar_to--> `Main Customer Flow`  [INFERRED] [semantically similar]
  PHASE1.md → PROJECT_STATUS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 1 Local Buyer Flow** — phase1_ad_first_intake, phase1_conservative_extraction, phase1_decision_focused_report, phase1_local_only_services [EXTRACTED 1.00]
- **Planned Revenue and Service Ladder** — plan_free_quick_check, plan_paid_full_ai_buyer_report, plan_premium_human_review, plan_inspection_booking [EXTRACTED 1.00]
- **Documented Prototype-to-Production Transition** — readme_mocked_exclusions, phase1_phase_2_integrations, project_status_production_service_gap, plan_recommended_stack [INFERRED 0.85]
- **Vehicle Icon Composition** — public_favicon_car_silhouette, public_favicon_windshield, public_favicon_red_wheels [INFERRED 0.95]
- **Automotive Inspection Workflow** — public_images_hero_autocheck_qc_inspector, public_images_hero_autocheck_qc_suv, public_images_hero_autocheck_qc_mobile_documentation, public_images_hero_autocheck_qc_inspection_checklist, public_images_hero_autocheck_qc_measuring_tape [INFERRED 0.95]

## Communities (27 total, 4 thin omitted)

### Community 0 - "next"
Cohesion: 0.05
Nodes (33): nextConfig, lucide-react, next, react, metadata, metadata, metadata, src_app_globals (+25 more)

### Community 1 - "VehicleIntakeFlow.tsx"
Cohesion: 0.08
Nodes (46): Boundary and security model, Current application data map, Database foundation, BookingFormState, initialBooking, InspectionBookingForm(), submitBooking(), validate() (+38 more)

### Community 2 - "domain.test.ts"
Cohesion: 0.11
Nodes (19): ref_node_assert, ref_node_test, ExampleReportPage(), metadata, ProgressSteps(), ReportExperience(), ReportView(), formatCurrencyCad() (+11 more)

### Community 3 - "package.json"
Cohesion: 0.06
Nodes (31): dependencies, lucide-react, next, react, react-dom, @supabase/supabase-js, devDependencies, eslint (+23 more)

### Community 4 - "domain.ts"
Cohesion: 0.10
Nodes (18): ListingSourceType, StoredOperationalRecord, EmailService, FileStorageService, InspectionDispatchService, LeadStorageService, PaymentService, ReportGenerationService (+10 more)

### Community 5 - "contactMessageRepository.ts"
Cohesion: 0.10
Nodes (17): ref_server_only, @supabase/supabase-js, dynamic, POST, dynamic, GET(), ContactMessageInserter, ContactMessageInsertRow (+9 more)

### Community 6 - "202609270001_initial_operational_schema.sql"
Cohesion: 0.15
Nodes (21): public, public.set_updated_at, contact_messages_open_created_at_idx, contact_messages_set_updated_at, inspection_requests_listing_id_idx, inspection_requests_report_id_idx, inspection_requests_set_updated_at, inspection_requests_status_created_at_idx (+13 more)

### Community 7 - "ContactForm.tsx"
Cohesion: 0.16
Nodes (15): ContactForm(), submit(), emptyForm, contactTopics, CONTACT_LIMITS, ContactSubmission, ContactValidationResult, normalizedSingleLine() (+7 more)

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

### Community 13 - "eslint.config.mjs"
Cohesion: 0.25
Nodes (7): compat, __dirname, eslintConfig, __filename, ref_eslint_eslintrc, ref_node_path, ref_node_url

### Community 14 - "AutoCheck QC README"
Cohesion: 0.25
Nodes (8): Next.js App Router Selection, Recommended Next.js Supabase Stripe Stack, Production Service Implementation Gap, AutoCheck QC README, Documented Phase 1 Features, Repository Project Structure, Frontend Local-Only Prototype Scope, Phase 1 Technology Stack

### Community 15 - "Local Customer Journey"
Cohesion: 0.29
Nodes (7): Phase 1 Bilingual Product Gap, Local Customer Journey, Phase 1 Implementation Notes, Bilingual Quebec Market Strategy, Bilingual Quebec SEO Strategy, Current Application Architecture, Main Customer Flow

### Community 16 - "Conservative Local Listing Extraction"
Cohesion: 0.33
Nodes (7): Conservative Local Listing Extraction, Decision-Focused Buyer Report, Model-Specific Verification Checklists, Two-Step AI Extraction and Report Workflow, Report Safety and Non-Fabrication Rules, Planned Used-Car Risk Analysis, Planned Structured Listing Extraction

### Community 17 - "Automotive Quality Control"
Cohesion: 0.33
Nodes (7): Vehicle Inspection Checklist, Vehicle Inspector, Inspection Measuring Tape, Mobile Vehicle Photo Documentation, Automotive Quality Control, Gray SUV, Vehicle Inspection Scene

### Community 18 - "Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first., Source Nodes

### Community 19 - "Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection, Source Nodes

### Community 20 - "Recommended Phase 2 Integrations"
Cohesion: 0.50
Nodes (5): Local-Only Mocked Services, Recommended Phase 2 Integrations, Separated Domain and Service Boundaries, Mocked and Excluded Production Capabilities, Phase 2 Backend Integration Readiness

### Community 21 - "White Car Silhouette"
Cohesion: 0.40
Nodes (5): White Car Silhouette, AutoCheck Favicon Icon, Red Car Wheels, Dark Rounded-Square Background, Light Gray Windshield

### Community 22 - "Planned Domain Data Model"
Cohesion: 0.67
Nodes (3): Planned Domain Data Model, Production Privacy Principles, JavaScript-Readable Personal Data Storage

## Knowledge Gaps
- **128 isolated node(s):** `ButtonLinkProps`, `ContainerProps`, `Method`, `Extraction`, `SectionHeadingProps` (+123 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 178 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `VehicleIntakeFlow.tsx`, `domain.test.ts`, `package.json`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `react` connect `next` to `VehicleIntakeFlow.tsx`, `domain.test.ts`, `package.json`, `ContactForm.tsx`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `VehicleIntake` connect `VehicleIntakeFlow.tsx` to `domain.test.ts`, `domain.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `ButtonLinkProps`, `ContainerProps`, `Method` to the rest of the system?**
  _128 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `next` be split into smaller, more focused modules?**
  _Cohesion score 0.05311676909569798 - nodes in this community are weakly interconnected._
- **Should `VehicleIntakeFlow.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08484848484848485 - nodes in this community are weakly interconnected._
- **Should `domain.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11363636363636363 - nodes in this community are weakly interconnected._