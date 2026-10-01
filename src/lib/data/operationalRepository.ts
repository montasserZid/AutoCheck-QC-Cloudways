import type {
  DemoBuyerReport,
  InspectionRequest,
  ReportPackage,
  VehicleIntake,
} from "@/types/domain";

export type ListingSourceType = "text" | "url" | "images" | "manual" | "unknown";

export interface StoredOperationalRecord {
  id: string;
  createdAt: string;
}

export interface OperationalRepository {
  createListing(input: {
    intake: VehicleIntake;
    sourceType: ListingSourceType;
  }): Promise<StoredOperationalRecord & { vehicleId: string }>;

  createReport(input: {
    listingId: string;
    vehicleId: string;
    reportPackage: ReportPackage;
    report: DemoBuyerReport;
  }): Promise<StoredOperationalRecord>;

  createInspectionRequest(input: {
    listingId: string;
    vehicleId: string;
    request: InspectionRequest;
  }): Promise<StoredOperationalRecord>;

  createContactMessage(input: {
    topic: string;
    customerName: string;
    customerEmail: string;
    message: string;
  }): Promise<StoredOperationalRecord>;
}
