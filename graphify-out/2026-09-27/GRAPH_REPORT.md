# Graph Report - AutoCheck QC  (2026-09-27)

## Corpus Check
- 61 files · ~105,851 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .example 1, .css 1)

## Summary
- 365 nodes · 667 edges · 20 communities (18 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- next
- domain.ts
- Paid Full AI Buyer Report
- package.json
- contact/page.tsx
- AutoCheck QC Project Status
- VehicleIntakeFlow.tsx
- listingExtraction.ts
- compilerOptions
- compilerOptions
- eslint.config.mjs
- Automotive Quality Control
- White Car Silhouette
- SectionHeading.tsx
- next-env.d.ts
- getSupabaseConfig
- site.ts
- reportEngine.ts
- Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first.
- Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection

## God Nodes (most connected - your core abstractions)
1. `next` - 24 edges
2. `VehicleIntakeFlow()` - 22 edges
3. `VehicleIntake` - 16 edges
4. `compilerOptions` - 16 edges
5. `Container()` - 15 edges
6. `InspectionBookingForm()` - 13 edges
7. `writeLocal()` - 13 edges
8. `react` - 12 edges
9. `generateDemoReport()` - 11 edges
10. `lucide-react` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Current application data map` --references--> `VehicleIntake`  [INFERRED]
  docs/database-foundation.md → src/types/domain.ts
- `Ad-First Intake Flow` --semantically_similar_to--> `Planned Full User Journey`  [INFERRED] [semantically similar]
  PHASE1.md → plan.md
- `Conservative Local Listing Extraction` --semantically_similar_to--> `Planned Structured Listing Extraction`  [INFERRED] [semantically similar]
  PHASE1.md → plan.md
- `Decision-Focused Buyer Report` --semantically_similar_to--> `Paid Full AI Buyer Report`  [INFERRED] [semantically similar]
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

## Communities (20 total, 2 thin omitted)

### Community 0 - "next"
Cohesion: 0.06
Nodes (25): nextConfig, lucide-react, next, react, metadata, ExampleReportPage(), metadata, metadata (+17 more)

### Community 1 - "domain.ts"
Cohesion: 0.08
Nodes (24): Boundary and security model, Current application data map, Database foundation, Draft, ListingSourceType, OperationalRepository, StoredOperationalRecord, EmailService (+16 more)

### Community 2 - "Paid Full AI Buyer Report"
Cohesion: 0.08
Nodes (34): Ad-First Intake Flow, Phase 1 Bilingual Product Gap, Conservative Local Listing Extraction, Decision-Focused Buyer Report, Local Customer Journey, Model-Specific Verification Checklists, Next.js App Router Selection, Phase 1 Implementation Notes (+26 more)

### Community 3 - "package.json"
Cohesion: 0.06
Nodes (31): dependencies, lucide-react, next, react, react-dom, @supabase/supabase-js, devDependencies, eslint (+23 more)

### Community 4 - "contact/page.tsx"
Cohesion: 0.39
Nodes (4): metadata, ContactForm(), submit(), contactTopics

### Community 5 - "AutoCheck QC Project Status"
Cohesion: 0.08
Nodes (28): Local-Only Mocked Services, Recommended Phase 2 Integrations, Phase 1 Quality Coverage, Separated Domain and Service Boundaries, Planned Domain Data Model, Production Privacy Principles, Unvalidated Browser Storage Reliability Defect, Stale Contact Saved-State Defect (+20 more)

### Community 6 - "VehicleIntakeFlow.tsx"
Cohesion: 0.11
Nodes (41): ref_node_assert, ref_node_test, BookingFormState, initialBooking, InspectionBookingForm(), submitBooking(), validate(), ProgressSteps() (+33 more)

### Community 7 - "listingExtraction.ts"
Cohesion: 0.28
Nodes (6): amount(), Extraction, extractListing(), normalize(), vehicles, MentionStatus

### Community 8 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 9 - "compilerOptions"
Cohesion: 0.15
Nodes (12): ./tsconfig.json, compilerOptions, incremental, module, moduleResolution, noEmit, outDir, plugins (+4 more)

### Community 10 - "eslint.config.mjs"
Cohesion: 0.25
Nodes (7): compat, __dirname, eslintConfig, __filename, ref_eslint_eslintrc, ref_node_path, ref_node_url

### Community 11 - "Automotive Quality Control"
Cohesion: 0.33
Nodes (7): Vehicle Inspection Checklist, Vehicle Inspector, Inspection Measuring Tape, Mobile Vehicle Photo Documentation, Automotive Quality Control, Gray SUV, Vehicle Inspection Scene

### Community 12 - "White Car Silhouette"
Cohesion: 0.40
Nodes (5): White Car Silhouette, AutoCheck Favicon Icon, Red Car Wheels, Dark Rounded-Square Background, Light Gray Windshield

### Community 15 - "getSupabaseConfig"
Cohesion: 0.31
Nodes (8): ref_server_only, @supabase/supabase-js, dynamic, GET(), createSupabaseClient(), getSupabaseConfig(), getSupabaseAdminClient(), getSupabaseSecretKey()

### Community 16 - "site.ts"
Cohesion: 0.18
Nodes (10): src_app_globals, metadata, Footer(), Header(), homeCopy, officialSources, platformLabels, siteConfig (+2 more)

### Community 17 - "reportEngine.ts"
Cohesion: 0.25
Nodes (9): metadata, formatCurrencyCad(), formatKilometers(), titleCaseStatus(), generateDemoReport(), reportDisclaimer, getVehicleChecklist(), vehicleKnowledge (+1 more)

### Community 18 - "Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first., Source Nodes

### Community 19 - "Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection, Source Nodes

## Knowledge Gaps
- **118 isolated node(s):** `__filename`, `__dirname`, `compat`, `eslintConfig`, `nextConfig` (+113 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 158 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `package.json`, `contact/page.tsx`, `VehicleIntakeFlow.tsx`, `site.ts`, `reportEngine.ts`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Why does `react` connect `next` to `package.json`, `contact/page.tsx`, `VehicleIntakeFlow.tsx`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `VehicleIntake` connect `domain.ts` to `next`, `reportEngine.ts`, `VehicleIntakeFlow.tsx`, `listingExtraction.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `__filename`, `__dirname`, `compat` to the rest of the system?**
  _118 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `next` be split into smaller, more focused modules?**
  _Cohesion score 0.0647307924984876 - nodes in this community are weakly interconnected._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0782051282051282 - nodes in this community are weakly interconnected._
- **Should `Paid Full AI Buyer Report` be split into smaller, more focused modules?**
  _Cohesion score 0.0784313725490196 - nodes in this community are weakly interconnected._