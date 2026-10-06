import "server-only";

import type { FreeQuickCheckResponse } from "@/lib/freeQuickCheck";
import type { InternalFreeKnowledgeResult } from "./freeQuickCheckRepository";

export function toFreeQuickCheckResponse(result: InternalFreeKnowledgeResult): FreeQuickCheckResponse {
  if (result.outcome === "matched") {
    const headlines = result.areas.slice(0, 3).map((area) => `${area.name} is among the historical problem areas reported for this model-year.`);
    return {
      vehicle: result.vehicle,
      coverage: { status: "matched", label: "Historical model-year data available" },
      historicalSignal: null,
      topHistoricalAreas: result.areas.slice(0, 3).map((area) => ({ name: area.name, historicalComplaintCount: area.complaintCount })),
      headlines,
      lockedSummary: { additionalHistoricalDetailAvailable: result.additionalHistoricalDetailAvailable },
    };
  }
  const limited = result.outcome === "limited";
  return {
    vehicle: result.vehicle,
    coverage: { status: limited ? "limited" : "unavailable", label: limited ? "Historical data for this model-year is limited" : "No reliable historical match available" },
    historicalSignal: null,
    topHistoricalAreas: [],
    headlines: [],
    lockedSummary: null,
  };
}
