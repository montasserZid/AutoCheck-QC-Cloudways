export type FreeCoverage = "matched" | "limited" | "unavailable";

export interface FreeQuickCheckRequest {
  listingId: string;
  submissionKey: string;
}

export interface FreeQuickCheckResponse {
  vehicle: { year: number | null; make: string; model: string; trim: string | null };
  coverage: { status: FreeCoverage; label: string };
  historicalSignal: null;
  topHistoricalAreas: Array<{ name: string; historicalComplaintCount: number }>;
  headlines: string[];
  lockedSummary: { additionalHistoricalDetailAvailable: boolean } | null;
}

export const FREE_QUICK_CHECK_LIMITS = { bodyBytes: 512, areas: 3, headlines: 3 } as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateFreeQuickCheckRequest(value: unknown): { ok: true; value: FreeQuickCheckRequest } | { ok: false; fields: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, fields: ["request"] };
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "listingId" && key !== "submissionKey")) return { ok: false, fields: ["request"] };
  const fields: string[] = [];
  if (typeof source.listingId !== "string" || !uuid.test(source.listingId)) fields.push("listingId");
  if (typeof source.submissionKey !== "string" || !uuid.test(source.submissionKey)) fields.push("submissionKey");
  return fields.length ? { ok: false, fields } : { ok: true, value: { listingId: source.listingId as string, submissionKey: source.submissionKey as string } };
}
