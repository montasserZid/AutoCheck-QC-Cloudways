import type {
  DemoBuyerReport,
  InspectionRequest,
  ReportPackage,
  VehicleIntake,
} from "../types/domain";
import { emptyIntake } from "./listingExtraction";
import type { SubmittedIntakeContext } from "./intakeFinalization";
const prefix = "autocheck-qc:v2:";
const memory = new Map<string, unknown>();
const failedWrites = new Set<string>();
export function readLocal<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  // A readable stored value may predate a failed write (for example, quota
  // exceeded). Keep the latest in-tab value across client-side navigation.
  if (failedWrites.has(key)) return (memory.get(key) as T) ?? null;
  try {
    const raw = window.localStorage.getItem(prefix + key);
    return raw ? (JSON.parse(raw) as T) : ((memory.get(key) as T) ?? null);
  } catch {
    return (memory.get(key) as T) ?? null;
  }
}
export function writeLocal<T>(key: string, value: T): boolean {
  memory.set(key, value);
  try {
    window.localStorage.setItem(prefix + key, JSON.stringify(value));
    failedWrites.delete(key);
    return true;
  } catch {
    failedWrites.add(key);
    return false;
  }
}
export function removeLocal(key: string): boolean {
  memory.delete(key);
  failedWrites.delete(key);
  try {
    window.localStorage.removeItem(prefix + key);
    return true;
  } catch {
    return false;
  }
}
export const saveIntake = (v: VehicleIntake) => writeLocal("intake", v);
export const saveSubmittedIntakeContext = (v: SubmittedIntakeContext) =>
  writeLocal("submitted-intake", v);
export function getSubmittedIntakeContext(): SubmittedIntakeContext | null {
  const value = readLocal<SubmittedIntakeContext>("submitted-intake");
  return value && typeof value.vehicleId === "string" && typeof value.listingId === "string" && typeof value.submissionKey === "string"
    ? value
    : null;
}
export function getStoredIntake(): VehicleIntake | null {
  const v = readLocal<VehicleIntake>("intake");
  if (
    !v ||
    typeof v.make !== "string" ||
    typeof v.model !== "string" ||
    !v.make ||
    !v.model ||
    !Array.isArray(v.photos)
  )
    return null;
  return { ...emptyIntake, ...v };
}
export const saveReportType = (v: ReportPackage) =>
  writeLocal("report-type", v);
export const getStoredReportType = () =>
  readLocal<ReportPackage>("report-type");
export const saveReport = (v: DemoBuyerReport) => writeLocal("report", v);
export const getStoredReport = () => readLocal<DemoBuyerReport>("report");
export const saveInspectionRequest = (v: InspectionRequest) =>
  writeLocal("inspection", v);
export const getStoredInspectionRequest = () =>
  readLocal<InspectionRequest>("inspection");
export function clearLocalData(): boolean {
  memory.clear();
  failedWrites.clear();
  try {
    for (const key of Object.keys(window.localStorage))
      if (key.startsWith("autocheck-qc:")) window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
