import type {
  DemoBuyerReport,
  InspectionRequest,
  ReportPackage,
  VehicleIntake,
} from "@/types/domain";

export interface ReportGenerationService {
  generateReport(
    intake: VehicleIntake,
    reportType: ReportPackage,
  ): Promise<DemoBuyerReport>;
}

export interface PaymentService {
  startCheckout(
    reportType: ReportPackage,
    intake: VehicleIntake,
  ): Promise<{ checkoutUrl: string }>;
}

export interface LeadStorageService {
  saveVehicleIntake(intake: VehicleIntake): Promise<{ id: string }>;
}

export interface FileStorageService {
  createUploadTarget(
    fileName: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; publicUrl?: string }>;
}

export interface InspectionDispatchService {
  submitInspectionRequest(
    request: InspectionRequest,
  ): Promise<{ id: string; status: "received" }>;
}

export interface EmailService {
  sendReport(
    report: DemoBuyerReport,
    recipientEmail: string,
  ): Promise<{ sent: boolean }>;
}
