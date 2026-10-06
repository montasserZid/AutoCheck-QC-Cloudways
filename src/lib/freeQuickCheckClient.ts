import type { FreeQuickCheckRequest, FreeQuickCheckResponse } from "./freeQuickCheck";

export async function requestFreeQuickCheck(
  request: FreeQuickCheckRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<FreeQuickCheckResponse> {
  const body: FreeQuickCheckRequest = {
    listingId: request.listingId,
    submissionKey: request.submissionKey,
  };
  const response = await fetchImpl("/api/free-quick-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object" || !(payload as { report?: unknown }).report)
    throw new Error((payload as { error?: string } | null)?.error || "Historical data is temporarily unavailable. Please try again.");
  return (payload as { report: FreeQuickCheckResponse }).report;
}
