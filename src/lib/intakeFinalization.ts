import type { VehicleIntake } from "@/types/domain";
import { toFinalizedIntake, type FinalizeIntakeRequest } from "./finalizedIntake";

export interface SubmittedIntakeContext { vehicleId: string; listingId: string; submissionKey: string }
export interface FinalizationResponse extends SubmittedIntakeContext { replayed: boolean }

export async function finalizeIntake(
  intake: VehicleIntake,
  submissionKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FinalizationResponse> {
  const body: FinalizeIntakeRequest = { submissionKey, intake: toFinalizedIntake(intake) };
  const response = await fetchImpl("/api/intakes/finalize", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object" ||
    typeof (payload as FinalizationResponse).vehicleId !== "string" ||
    typeof (payload as FinalizationResponse).listingId !== "string")
    throw new Error((payload as { error?: string } | null)?.error || "We couldn't save this listing. Please try again.");
  return payload as FinalizationResponse;
}
