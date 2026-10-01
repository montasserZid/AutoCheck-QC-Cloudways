# Graph Report - AutoCheck QC  (2026-09-30)

## Corpus Check
- 5 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 737 nodes · 1372 edges · 50 communities (46 shown, 4 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Data and Listing Foundation
- Next Application Routes
- Project Dependencies
- Listing HTML Parsing
- Facebook Browser Runtime
- Facebook Reference Harness
- Secure Listing Fetch
- Inspection Experience
- Report Presentation
- Contact Form
- Operational Database Schema
- Current Project State
- TypeScript Configuration
- Contact and Supabase
- Facebook Extraction Tests
- Chromium Launch Validation
- Listing API Handler
- Report Extraction
- Vehicle Intake Validation
- Quality and Security Debt
- Root Layout and Content
- Implementation History
- Browser Lifecycle Recovery
- Test TypeScript Configuration
- Anonymous Facebook Extraction
- Chromium SIGSEGV Fix
- Vercel Runtime Diagnostics
- Product Roadmap
- Pricing and Automation
- ESLint Configuration
- Architecture Documentation
- Inspection Confirmation
- Browser Version Compatibility
- Quebec Market Strategy
- AI Report Safety
- Inspection Visual Assets
- Privacy Data Controls
- Facebook Field Parsing
- Deterministic Listing Principles
- Graphify Architecture Query
- Graphify Supabase Query
- Graphify Browser Launch Query
- Graphify Login Query
- Graphify Packaging Query
- Graphify Dependency Query
- Graphify Detached Frame Query
- Graphify Render Wait Query
- Phase Two Services

## God Nodes (most connected - your core abstractions)
1. `VehicleIntakeFlow()` - 26 edges
2. `next` - 24 edges
3. `VehicleIntake` - 22 edges
4. `AutoCheck QC - Current Project State` - 21 edges
5. `compilerOptions` - 16 edges
6. `FacebookExtractionError` - 15 edges
7. `Container()` - 15 edges
8. `renderFacebookMarketplaceListingAttempt()` - 15 edges
9. `extractVehicleObject()` - 15 edges
10. `InspectionBookingForm()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Current application data map` --references--> `VehicleIntake`  [INFERRED]
  docs/database-foundation.md → src/types/domain.ts
- `2026-09-28 - Listing URL Deterministic Auto-Fill` --references--> `VehicleIntake`  [INFERRED]
  docs/IMPLEMENTATION_LOG.md → src/types/domain.ts
- `Reports` --references--> `ReportGenerationService`  [INFERRED]
  docs/CURRENT_PROJECT_STATE.md → src/lib/serviceInterfaces.ts
- `Reports` --references--> `ReportExperience()`  [INFERRED]
  docs/CURRENT_PROJECT_STATE.md → src/components/ReportExperience.tsx
- `What Works Today` --references--> `ReportExperience()`  [INFERRED]
  docs/CURRENT_PROJECT_STATE.md → src/components/ReportExperience.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Compatible Facebook Browser Runtime** — docs_implementation_log_puppeteer_core_24_23_0, docs_implementation_log_sparticuz_chromium_141_0_0, docs_implementation_log_angle_swiftshader_graphics_stack, docs_implementation_log_serverless_chromium_launch_configuration, docs_implementation_log_vercel_hobby_runtime [EXTRACTED 1.00]
- **Controlled Chromium Process-Layout Experiment** — docs_implementation_log_controlled_launch_matrix, docs_implementation_log_launch_variant_a_control, docs_implementation_log_launch_variant_b_without_in_process_gpu, docs_implementation_log_launch_variant_c_without_single_process, docs_implementation_log_launch_variant_d_without_both_process_flags, docs_implementation_log_single_process_flag, docs_implementation_log_in_process_gpu_flag [EXTRACTED 1.00]
- **Phase 1 Local Buyer Flow** — phase1_ad_first_intake, phase1_conservative_extraction, phase1_decision_focused_report, phase1_local_only_services [EXTRACTED 1.00]
- **Planned Revenue and Service Ladder** — plan_free_quick_check, plan_paid_full_ai_buyer_report, plan_premium_human_review, plan_inspection_booking [EXTRACTED 1.00]
- **Preserved Facebook Extraction Contract** — docs_implementation_log_anonymous_facebook_access, docs_implementation_log_share_url_resolution, docs_implementation_log_canonical_listing_discovery, docs_implementation_log_primary_listing_isolation, docs_implementation_log_normalized_vehicle_intake [EXTRACTED 1.00]
- **Documented Prototype-to-Production Transition** — readme_mocked_exclusions, phase1_phase_2_integrations, project_status_production_service_gap, plan_recommended_stack [INFERRED 0.85]
- **Vehicle Icon Composition** — public_favicon_car_silhouette, public_favicon_windshield, public_favicon_red_wheels [INFERRED 0.95]
- **Automotive Inspection Workflow** — public_images_hero_autocheck_qc_inspector, public_images_hero_autocheck_qc_suv, public_images_hero_autocheck_qc_mobile_documentation, public_images_hero_autocheck_qc_inspection_checklist, public_images_hero_autocheck_qc_measuring_tape [INFERRED 0.95]

## Communities (50 total, 4 thin omitted)

### Community 0 - "Data and Listing Foundation"
Cohesion: 0.07
Nodes (53): Inspection, ConfirmationDetails(), BookingFormState, initialBooking, InspectionBookingForm(), submitBooking(), validate(), ProgressSteps() (+45 more)

### Community 1 - "Next Application Routes"
Cohesion: 0.06
Nodes (50): Listing URL Extraction, Boundary and security model, Current application data map, Database foundation, 2026-09-29 - Facebook Marketplace Browser Extraction Upgrade, ref_node_dns, ref_node_http, ref_node_https (+42 more)

### Community 2 - "Project Dependencies"
Cohesion: 0.12
Nodes (39): amount(), emptyIntake, Extraction, extractListing(), normalize(), vehicles, addListingField(), asArray() (+31 more)

### Community 3 - "Listing HTML Parsing"
Cohesion: 0.09
Nodes (28): ref_server_only, @supabase/supabase-js, dynamic, POST, dynamic, GET(), metadata, ContactForm() (+20 more)

### Community 4 - "Facebook Browser Runtime"
Cohesion: 0.07
Nodes (31): ref_node_fs, ListingField, BrowserEnvironment, BrowserLifecycleLike, BrowserLike, BrowserProcessLike, cgroupMemoryEvents(), CONFLICTING_SERVERLESS_GRAPHICS_ARGS (+23 more)

### Community 5 - "Facebook Reference Harness"
Cohesion: 0.06
Nodes (34): dependencies, lucide-react, next, puppeteer-core, react, react-dom, @sparticuz/chromium, @supabase/supabase-js (+26 more)

### Community 6 - "Secure Listing Fetch"
Cohesion: 0.10
Nodes (32): Snapshot Metadata, 2026-09-29 - Facebook False Login-Required Classification Fix, buildOptions(), canonicalItemUrl(), countItemAnchors(), detectState(), extractId(), extractLabeledFields() (+24 more)

### Community 7 - "Inspection Experience"
Cohesion: 0.08
Nodes (33): ANGLE and SwiftShader Graphics Stack, Bounded Browser Disconnect Grace, Browser and CDP Lifecycle Diagnostics, Puppeteer Chrome 141 Supported Mapping, Chromium SIGSEGV Process Crash, Complete JSON Failure Logging, Vercel Chromium Controlled Launch Matrix, Exact Browser Dependency Pinning (+25 more)

### Community 8 - "Report Presentation"
Cohesion: 0.08
Nodes (24): 2026-09-28 - Listing Fetch Network Failure Debug/Fix, 2026-09-28 - Listing URL Deterministic Auto-Fill, 2026-09-29 - Facebook Chromium Launch Resolution Fix, 2026-09-29 - Facebook False Login-Required Classification Fix Addendum, 2026-09-29 - Vercel Facebook Target-Closed Diagnostics, 2026-09-29 - Vercel Puppeteer Runtime Dependency Trace Fix, 2026-09-29 - Vercel Puppeteer Transitive Dependency Tracing Fix, Anonymous Facebook Access (+16 more)

### Community 9 - "Contact Form"
Cohesion: 0.15
Nodes (21): public, public.set_updated_at, contact_messages_open_created_at_idx, contact_messages_set_updated_at, inspection_requests_listing_id_idx, inspection_requests_report_id_idx, inspection_requests_set_updated_at, inspection_requests_status_created_at_idx (+13 more)

### Community 10 - "Operational Database Schema"
Cohesion: 0.15
Nodes (13): ref_node_assert, ref_node_test, buildFacebookChromiumArgvVariants(), chromiumLaunchPlans(), configuredChromeExecutable(), FacebookExtractionError, facebookServerlessChromiumLaunchOptions(), facebookServerlessChromiumLaunchVariants() (+5 more)

### Community 11 - "Current Project State"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 12 - "TypeScript Configuration"
Cohesion: 0.14
Nodes (7): metadata, metadata, metadata, metadata, Container(), ContainerProps, reportDisclaimer

### Community 13 - "Contact and Supabase"
Cohesion: 0.12
Nodes (15): AI Status, AutoCheck QC - Current Project State, Contact, Current User Flow, Data & Persistence, Free vs Full, Graphify, Listing Intake (+7 more)

### Community 14 - "Facebook Extraction Tests"
Cohesion: 0.17
Nodes (8): EmailService, FileStorageService, InspectionDispatchService, LeadStorageService, PaymentService, ReportGenerationService, DemoBuyerReport, ReportPackage

### Community 15 - "Chromium Launch Validation"
Cohesion: 0.17
Nodes (10): src_app_globals, metadata, Footer(), Header(), homeCopy, officialSources, platformLabels, siteConfig (+2 more)

### Community 16 - "Listing API Handler"
Cohesion: 0.20
Nodes (14): 2026-09-29 - Vercel Facebook Detached-Frame Lifecycle Fix, 2026-09-29 - Vercel Facebook Render-Wait Polling Fix, assertFacebookNavigation(), canonicalFacebookItemUrl(), isTransientFacebookPageLifecycleError(), logFacebookChromiumVariant(), navigate(), remainingTimeout() (+6 more)

### Community 17 - "Report Extraction"
Cohesion: 0.16
Nodes (14): Phase 1 Quality Coverage, Unvalidated Browser Storage Reliability Defect, Stale Contact Saved-State Defect, Patch Next.js Before Broader Work, Next.js Hardening Update Finding, Next.js Security Update September 22 2026, Ignored Pricing Package Query Defect, AutoCheck QC Project Status (+6 more)

### Community 18 - "Vehicle Intake Validation"
Cohesion: 0.16
Nodes (8): ContactMessageInserter, ContactMessageInsertRow, ContactMessagePersistenceError, createContactMessageRepository(), InsertedContactMessage, ListingSourceType, OperationalRepository, StoredOperationalRecord

### Community 19 - "Quality and Security Debt"
Cohesion: 0.18
Nodes (5): nextConfig, next, react, metadata, ButtonLinkProps

### Community 20 - "Root Layout and Content"
Cohesion: 0.19
Nodes (13): puppeteer-core, addLifecycleListener(), createFacebookLifecycleTracker(), errorMessage(), facebookRuntimeError(), isMarketplaceItemPath(), isSharePath(), isSupportedFacebookMarketplaceUrl() (+5 more)

### Community 21 - "Implementation History"
Cohesion: 0.15
Nodes (12): ./tsconfig.json, compilerOptions, incremental, module, moduleResolution, noEmit, outDir, plugins (+4 more)

### Community 22 - "Browser Lifecycle Recovery"
Cohesion: 0.24
Nodes (6): lucide-react, metadata, PricingCards(), Draft, Method, methods

### Community 23 - "Test TypeScript Configuration"
Cohesion: 0.25
Nodes (6): ExampleReportPage(), metadata, metadata, faqItems, demoVehicleIntake, exampleListingText

### Community 24 - "Anonymous Facebook Extraction"
Cohesion: 0.22
Nodes (9): Ad-First Intake Flow, AutoCheck QC Complete Roadmap, Used-Car Buyer Pre-Screening Business Concept, Planned Full User Journey, OPC Used Car Dealer Guidance, Pre-Screen Before Professional Inspection, Gouvernement du Québec Vehicle Purchase Guidance, SAAQ Vehicle Transfer Guidance (+1 more)

### Community 25 - "Chromium SIGSEGV Fix"
Cohesion: 0.42
Nodes (9): Input Process Output Feedback Automation Map, Free Quick Check, Initial Three-Offer Pricing Strategy, Inspection Booking and Partner Referral, Manual Partner Dispatch for V1, Minimum Monthly Net Revenue Target, Paid Full AI Buyer Report, Premium Human Review (+1 more)

### Community 26 - "Vercel Runtime Diagnostics"
Cohesion: 0.25
Nodes (7): compat, __dirname, eslintConfig, __filename, ref_eslint_eslintrc, ref_node_path, ref_node_url

### Community 27 - "Product Roadmap"
Cohesion: 0.25
Nodes (8): Next.js App Router Selection, Recommended Next.js Supabase Stripe Stack, Production Service Implementation Gap, AutoCheck QC README, Documented Phase 1 Features, Repository Project Structure, Frontend Local-Only Prototype Scope, Phase 1 Technology Stack

### Community 28 - "Pricing and Automation"
Cohesion: 0.29
Nodes (7): Phase 1 Bilingual Product Gap, Local Customer Journey, Phase 1 Implementation Notes, Bilingual Quebec Market Strategy, Bilingual Quebec SEO Strategy, Current Application Architecture, Main Customer Flow

### Community 29 - "ESLint Configuration"
Cohesion: 0.33
Nodes (7): Conservative Local Listing Extraction, Decision-Focused Buyer Report, Model-Specific Verification Checklists, Two-Step AI Extraction and Report Workflow, Report Safety and Non-Fabrication Rules, Planned Used-Car Risk Analysis, Planned Structured Listing Extraction

### Community 30 - "Architecture Documentation"
Cohesion: 0.33
Nodes (7): Vehicle Inspection Checklist, Vehicle Inspector, Inspection Measuring Tape, Mobile Vehicle Photo Documentation, Automotive Quality Control, Gray SUV, Vehicle Inspection Scene

### Community 31 - "Inspection Confirmation"
Cohesion: 0.33
Nodes (7): addIdentity(), addRenderedText(), cityFromLocation(), extractFacebookListingFromRenderedText(), firstLineMatching(), locationFromPrimary(), sellerDescriptionFromPrimary()

### Community 32 - "Browser Version Compatibility"
Cohesion: 0.33
Nodes (5): Known Limitations / Blockers, Reports, What Works Today, ReportView(), localStorage()

### Community 33 - "Quebec Market Strategy"
Cohesion: 0.47
Nodes (3): metadata, ClearDataButton(), clearLocalData()

### Community 34 - "AI Report Safety"
Cohesion: 0.33
Nodes (6): detectBlockedState(), detectFacebookPageState(), extractFacebookItemId(), hasPrimaryFacebookListingEvidence(), normalizeText(), primaryFacebookListingText()

### Community 35 - "Inspection Visual Assets"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first., Source Nodes

### Community 36 - "Privacy Data Controls"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection, Source Nodes

### Community 37 - "Facebook Field Parsing"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Locate and fix the Facebook browser launch path for local Windows Chrome and Vercel Chromium, Source Nodes

### Community 38 - "Deterministic Listing Principles"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Why did Facebook login UI cause a false extraction failure?, Source Nodes

### Community 39 - "Graphify Architecture Query"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Why did Vercel omit Puppeteer's browser helper package?, Source Nodes

### Community 40 - "Graphify Supabase Query"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Continue the exact Vercel Puppeteer packaging investigation and stop transitive dependency whack-a-mole., Source Nodes

### Community 41 - "Graphify Browser Launch Query"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Fix the Vercel Facebook detached-frame race without changing packaging or extraction semantics., Source Nodes

### Community 42 - "Graphify Login Query"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Fix the Vercel detached frame at render-wait only., Source Nodes

### Community 43 - "Graphify Packaging Query"
Cohesion: 0.50
Nodes (5): Local-Only Mocked Services, Recommended Phase 2 Integrations, Separated Domain and Service Boundaries, Mocked and Excluded Production Capabilities, Phase 2 Backend Integration Readiness

### Community 44 - "Graphify Dependency Query"
Cohesion: 0.40
Nodes (5): White Car Silhouette, AutoCheck Favicon Icon, Red Car Wheels, Dark Rounded-Square Background, Light Gray Windshield

### Community 45 - "Graphify Detached Frame Query"
Cohesion: 0.67
Nodes (3): Planned Domain Data Model, Production Privacy Principles, JavaScript-Readable Personal Data Storage

## Knowledge Gaps
- **218 isolated node(s):** `CarfaxStatus`, `InspectionAllowedStatus`, `SummaryItem`, `ListingUrlClientResult`, `FetchPublicListingOptions` (+213 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 299 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AutoCheck QC Implementation Log` connect `Report Presentation` to `Listing API Handler`, `Next Application Routes`, `Secure Listing Fetch`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `Facebook Marketplace Browser Extraction` connect `Report Presentation` to `Inspection Experience`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `VehicleIntakeFlow()` (e.g. with `Listing URL Extraction` and `2026-09-28 - Listing URL Deterministic Auto-Fill`) actually correct?**
  _`VehicleIntakeFlow()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `VehicleIntake` (e.g. with `Listing URL Extraction` and `Current application data map`) actually correct?**
  _`VehicleIntake` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CarfaxStatus`, `InspectionAllowedStatus`, `SummaryItem` to the rest of the system?**
  _218 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Data and Listing Foundation` be split into smaller, more focused modules?**
  _Cohesion score 0.07459207459207459 - nodes in this community are weakly interconnected._
- **Should `Next Application Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.06233766233766234 - nodes in this community are weakly interconnected._