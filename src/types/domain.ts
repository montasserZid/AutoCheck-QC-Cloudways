export type SupportedLanguage = "en" | "fr";

export type SellerType = "private" | "dealer" | "unknown";

export type ReportPackage = "free" | "full";

export type MentionStatus = "yes" | "no" | "unknown";

export type CarfaxStatus = "available" | "not_available" | "unknown";

export type InspectionAllowedStatus = "yes" | "no" | "unknown";

export type RiskLevel = "Low" | "Medium" | "High" | "Very High" | "Unknown";

export type FinalRecommendation =
  | "Avoid"
  | "Ask more questions"
  | "Worth seeing"
  | "Worth professional inspection"
  | "Strong candidate";

export type Urgency = "today" | "24_48_hours" | "this_week" | "flexible";

export interface UploadedFileMeta {
  name: string;
  size: number;
  type: string;
}

export interface VehicleIntake {
  listingUrl?: string;
  listingSource?: string;
  listingTitle?: string;
  sellerName?: string;
  listingText: string;
  make: string;
  model: string;
  year: number | null;
  trim?: string;
  mileageKm: number | null;
  mileageUnit?: "km" | "mi" | "unknown";
  askingPriceCad: number | null;
  priceCurrency?: string;
  city: string;
  location?: string;
  sellerType: SellerType;
  vin?: string;
  transmission?: string;
  drivetrain?: string;
  engine?: string;
  accidentHistoryMentioned: MentionStatus;
  rebuiltStatus: MentionStatus;
  maintenanceRecords: MentionStatus;
  carfaxStatus: CarfaxStatus;
  inspectionAllowed: InspectionAllowedStatus;
  sellerDescription: string;
  photos: UploadedFileMeta[];
  preferredLanguage: SupportedLanguage;
  submittedAt: string;
}

export interface SummaryItem {
  label: string;
  value: string;
}

export interface ReportFinding {
  title: string;
  detail: string;
}

export interface DemoBuyerReport {
  id: string;
  generatedAt: string;
  reportType: ReportPackage;
  isDemo: true;
  vehicleTitle: string;
  vehicleSummary: SummaryItem[];
  firstImpression: string;
  riskScore: number;
  riskLevel: RiskLevel;
  riskDrivers: string[];
  riskContributions: { label: string; points: number }[];
  topConcern: string;
  sellerMessage: string;
  potentialCosts: ReportFinding[];
  dealBreakers: string[];
  walkAway: string;
  inspectorFocus: ReportFinding[];
  priceCheck: ReportFinding[];
  biggestRedFlags: ReportFinding[];
  missingInformation: ReportFinding[];
  commonProblems: ReportFinding[];
  sellerQuestions: string[];
  inPersonChecks: ReportFinding[];
  negotiationPoints: ReportFinding[];
  inspectionRecommendation: string;
  finalRecommendation: FinalRecommendation;
  nextStep: string;
  disclaimer: string;
}

export interface InspectionRequest {
  id: string;
  submittedAt: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  vehicleTitle: string;
  vehicleVin?: string;
  sellerContact: string;
  vehicleAddress: string;
  preferredDate: string;
  preferredTime: string;
  urgency: Urgency;
  notes: string;
  reportId?: string;
}
