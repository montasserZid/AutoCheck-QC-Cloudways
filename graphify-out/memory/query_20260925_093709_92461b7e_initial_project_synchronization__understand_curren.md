---
type: "query"
date: "2026-09-25T09:37:09.285972+00:00"
question: "Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first."
contributor: "graphify"
outcome: "useful"
source_nodes: ["VehicleIntakeFlow()", "extractListing()", "validateIntake()", "saveIntake()", "saveReportType()", "ReportExperience()", "generateDemoReport()", "getVehicleChecklist()", "ReportView()", "InspectionBookingForm()"]
---

# Q: Initial project synchronization: understand current AutoCheck QC architecture and customer flow using Graphify first.

## Answer

Expanded from the graph vocabulary via [listing, extraction, validation, intake, report, package, vehicle, knowledge, inspection, confirmation, storage, pricing]. The current flow is CheckPage and VehicleIntakeFlow to extractListing and validateIntake; saveIntake and saveReportType persist browser state; ReportExperience loads state and calls generateDemoReport; reportEngine calls getVehicleChecklist; ReportView renders free/full output and links eligible users to InspectionBookingForm; validateBooking and saveInspectionRequest persist the request; ConfirmationDetails reads it. Domain contracts live in domain.ts, production service boundaries are interfaces only, and domain.test.ts covers core extraction, validation, reports, knowledge, and storage behavior. Verified against targeted source reads.

## Outcome

- Signal: useful

## Source Nodes

- VehicleIntakeFlow()
- extractListing()
- validateIntake()
- saveIntake()
- saveReportType()
- ReportExperience()
- generateDemoReport()
- getVehicleChecklist()
- ReportView()
- InspectionBookingForm()
- ConfirmationDetails()
- domain.test.ts