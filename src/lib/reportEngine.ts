import type {
  DemoBuyerReport,
  FinalRecommendation,
  ReportFinding,
  ReportPackage,
  RiskLevel,
  VehicleIntake,
} from "../types/domain";
import { formatCurrencyCad, formatKilometers, titleCaseStatus } from "./format";
import { getVehicleChecklist } from "./vehicleKnowledge";

export const reportDisclaimer =
  "AutoCheck QC is a listing pre-screen, not a professional mechanical inspection or a guarantee. Seller claims are unverified. No vehicle history, liens, market value or image contents have been independently checked. Confirm documents and arrange an independent inspection before buying.";
export function vehicleTitle(intake: VehicleIntake): string {
  return [intake.year, intake.make, intake.model, intake.trim]
    .filter(Boolean)
    .join(" ");
}
export function generateDemoReport(
  intake: VehicleIntake,
  reportType: ReportPackage,
): DemoBuyerReport {
  const missing: ReportFinding[] = [];
  const redFlags: ReportFinding[] = [];
  const contributions: { label: string; points: number }[] = [];
  const add = (
    title: string,
    detail: string,
    points: number,
    isMissing = false,
  ) => {
    contributions.push({ label: title, points });
    (isMissing ? missing : redFlags).push({ title, detail });
  };
  if (intake.inspectionAllowed === "no")
    add(
      "Seller refuses independent inspection",
      "Pause this purchase. Do not proceed while the seller refuses independent verification.",
      40,
    );
  if (intake.rebuiltStatus === "yes")
    add(
      "Rebuilt or salvage status is reported",
      "Request status documents, repair evidence and a qualified structural inspection before considering this vehicle. The listing claim has not been verified.",
      25,
    );
  if (intake.accidentHistoryMentioned === "yes")
    add(
      "Accident history is reported",
      "Ask for the history report, damage photos and repair invoices. Severity and repair quality are unknown.",
      15,
    );
  if (!intake.vin)
    add(
      "VIN is missing",
      "Ask for the complete VIN before travelling. Compare it with the vehicle and documents.",
      10,
      true,
    );
  if (intake.inspectionAllowed === "unknown")
    add(
      "Inspection permission is unanswered",
      "Ask whether the seller accepts an independent inspection before purchase.",
      12,
      true,
    );
  if (intake.carfaxStatus !== "available")
    add(
      "Vehicle history report is not available to review",
      "Ask for a current report and read it yourself. A missing report does not establish an accident.",
      8,
      true,
    );
  if (intake.accidentHistoryMentioned === "unknown")
    add(
      "Accident history is unstated",
      "Ask about past damage and repairs; a clean-looking ad is not evidence of an accident-free vehicle.",
      7,
      true,
    );
  if (intake.rebuiltStatus !== "yes" && intake.rebuiltStatus !== "no")
    add(
      "Rebuilt status is unstated",
      "Request the vehicle's documented status. Do not assume a clean title.",
      7,
      true,
    );
  if (intake.maintenanceRecords !== "yes")
    add(
      "Maintenance records need confirmation",
      "Request dated invoices and compare mileage across services.",
      8,
      true,
    );
  for (const [key, label] of [
    ["year", "Year"],
    ["mileageKm", "Mileage"],
    ["askingPriceCad", "Asking price"],
    ["city", "Location"],
  ] as const) {
    if (intake[key] === null || intake[key] === "")
      add(
        `${label} is missing`,
        `Confirm the ${label.toLowerCase()} with the seller before making plans.`,
        5,
        true,
      );
  }
  if (intake.mileageKm !== null && intake.mileageKm >= 150000)
    add(
      "Higher-mileage wear needs checking",
      "Service history, suspension, brakes and drivetrain condition deserve attention. Mileage alone is not a defect.",
      intake.mileageKm >= 200000 ? 12 : 6,
    );
  const score = Math.min(
    100,
    contributions.reduce((sum, c) => sum + c.points, 0),
  );
  const insufficient =
    !intake.year && intake.mileageKm === null && intake.askingPriceCad === null;
  const level: RiskLevel =
    insufficient && redFlags.length === 0
      ? "Unknown"
      : score >= 75
        ? "Very High"
        : score >= 50
          ? "High"
          : score >= 25
            ? "Medium"
            : "Low";
  const recommendation: FinalRecommendation =
    intake.inspectionAllowed === "no"
      ? "Avoid"
      : missing.length ||
          intake.rebuiltStatus === "yes" ||
          intake.accidentHistoryMentioned === "yes"
        ? "Ask more questions"
        : "Worth professional inspection";
  const questions = [
    ...(intake.inspectionAllowed !== "yes"
      ? ["Would you allow an independent inspection before I commit to buying?"]
      : []),
    ...(!intake.vin
      ? [
          "Could you send the complete VIN and a current vehicle history report?",
        ]
      : [
          "Can I compare the VIN on the vehicle with your registration and history report?",
        ]),
    ...(intake.maintenanceRecords !== "yes"
      ? ["Can you share dated maintenance records and recent repair invoices?"]
      : [
          "Can I review the maintenance invoices and confirm any upcoming service?",
        ]),
    "Has it had accident repairs, rebuilt status, flood damage or commercial use? Can you provide supporting documents?",
    ...(intake.mileageKm === null
      ? ["What is the current odometer reading in kilometres?"]
      : []),
    ...(intake.askingPriceCad === null
      ? ["What is the total asking price in Canadian dollars?"]
      : []),
    "Are there warning lights, leaks, rust, unusual noises or other issues I should know about?",
  ];
  const checklist = getVehicleChecklist(intake);
  const inspect =
    recommendation === "Avoid"
      ? "Not while inspection is refused. Resolve permission first; walk away if refusal continues."
      : recommendation === "Ask more questions"
        ? "Potentially, after the seller answers the open questions and provides supporting documents. Resolve history and inspection permission before spending money."
        : "Yes. The supplied details support moving to an independent inspection, but do not establish the car's condition.";
  const nextStep =
    recommendation === "Avoid"
      ? "Ask the seller to allow independent verification. If they still refuse, move on to another listing."
      : recommendation === "Ask more questions"
        ? "Send the first three seller questions before travelling. Review the answers, then decide whether to arrange an inspection."
        : "Arrange an independent inspection and keep any purchase decision conditional on its findings and document checks.";
  return {
    id: `AC-${Date.now().toString(36).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    isDemo: true,
    reportType,
    vehicleTitle: vehicleTitle(intake),
    vehicleSummary: [
      {
        label: "Year / trim",
        value: [intake.year ?? "Year unknown", intake.trim]
          .filter(Boolean)
          .join(" / "),
      },
      {
        label: "Mileage",
        value:
          intake.mileageKm === null
            ? "Not provided"
            : formatKilometers(intake.mileageKm),
      },
      {
        label: "Asking price",
        value:
          intake.askingPriceCad === null
            ? "Not provided"
            : `${formatCurrencyCad(intake.askingPriceCad)} CAD`,
      },
      { label: "Location", value: intake.city || "Not provided" },
      { label: "Seller", value: titleCaseStatus(intake.sellerType) },
      { label: "VIN", value: intake.vin || "Not provided" },
      { label: "Carfax claim", value: titleCaseStatus(intake.carfaxStatus) },
      {
        label: "Inspection allowed",
        value: titleCaseStatus(intake.inspectionAllowed),
      },
      {
        label: "Accident claim",
        value:
          intake.accidentHistoryMentioned === "no"
            ? "Seller says no accidents"
            : titleCaseStatus(intake.accidentHistoryMentioned),
      },
      {
        label: "Rebuilt claim",
        value: titleCaseStatus(intake.rebuiltStatus ?? "unknown"),
      },
      {
        label: "Records claim",
        value: titleCaseStatus(intake.maintenanceRecords ?? "unknown"),
      },
    ],
    firstImpression: `${vehicleTitle(intake)} has ${missing.length ? `${missing.length} information gaps to resolve` : "the key listing details supplied"}. ${redFlags.length ? "The concerns below warrant specific checks." : "No explicit adverse claim was identified in the confirmed fields."} Seller statements remain unverified; this is a decision checklist, not a condition assessment.`,
    riskScore: score,
    riskLevel: level,
    riskDrivers: contributions.map((c) => c.label),
    riskContributions: contributions,
    topConcern:
      [...contributions].sort((a, b) => b.points - a.points)[0]?.label ??
      "Actual mechanical condition is unverified",
    priceCheck: [
      {
        title:
          intake.askingPriceCad === null
            ? "Ask for the asking price"
            : `${formatCurrencyCad(intake.askingPriceCad)} CAD asking price`,
        detail:
          "Market value has not been assessed. Compare similar local listings by year, trim, mileage and documented condition; asking prices are not completed sale prices.",
      },
      {
        title: "Set a budget after verification",
        detail:
          "Request written estimates for inspection findings. No automatic discount or repair cost is assumed from missing information.",
      },
    ],
    biggestRedFlags: [...redFlags, ...missing],
    missingInformation: missing,
    commonProblems: checklist,
    sellerQuestions: questions,
    sellerMessage: `Hi, I'm interested in your ${vehicleTitle(intake)}. Before arranging a visit:\n\n${questions
      .slice(0, 3)
      .map((q, i) => `${i + 1}. ${q}`)
      .join(
        "\n",
      )}\n\nThanks. I'd like to review the documents before deciding on an independent inspection.`,
    inPersonChecks: [
      {
        title: "Identity and documents",
        detail:
          "Compare the physical VIN with registration and history documents. Ask the seller to explain any mismatch before proceeding.",
      },
      {
        title: "Cold start and road test",
        detail:
          "Ask to see a cold start. Note warning lights, noises, smoke and road-test behaviour for the inspector. Do not enter traffic in a vehicle that appears unsafe.",
      },
      {
        title: "Body and underbody",
        detail:
          "Check visible panel seams and rust; leave lifting and structural assessment to a qualified inspector.",
      },
    ],
    potentialCosts: [
      {
        title: "Wear items",
        detail:
          "Tires, brakes, suspension and battery condition may affect your budget. No replacement need or amount is confirmed.",
      },
      {
        title: "Deferred maintenance",
        detail:
          "Missing invoices call for verification against the correct service schedule. Ask for an estimate only when work is identified.",
      },
    ],
    negotiationPoints: [
      {
        title: "Documents before an offer",
        detail:
          "Missing records are a reason to pause, not proof that a discount makes a purchase safe.",
      },
      {
        title: "Use written findings",
        detail:
          "Discuss verified repairs using the inspector's findings and a written estimate. Avoid arbitrary percentage discounts.",
      },
      {
        title: "A conditional conversation",
        detail:
          "I'm interested at a price we can agree on after reviewing the documents and independent inspection. Can we arrange those checks first?",
      },
    ],
    dealBreakers: [
      "Continued refusal of independent inspection",
      "VIN or ownership inconsistencies that cannot be resolved",
      "Pressure to pay before you can verify the vehicle",
    ],
    walkAway:
      "Walk away if essential documents or inspection access remain unavailable, or if an inspector identifies safety or structural concerns you are not prepared to resolve. These are decision rules, not findings about this seller.",
    inspectorFocus: checklist.slice(1),
    inspectionRecommendation: inspect,
    finalRecommendation: recommendation,
    nextStep,
    disclaimer: reportDisclaimer,
  };
}
