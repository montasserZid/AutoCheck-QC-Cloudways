import "server-only";

import { normalizeKnowledgeKey } from "@/lib/knowledgeNormalization";
import { getSupabaseAdminClient } from "@/server/supabase/admin";
import { PINNED_FREE_KNOWLEDGE_SNAPSHOT } from "./pinnedSnapshot";

export type InternalFreeKnowledgeResult = {
  outcome: "matched" | "limited" | "ambiguous" | "unavailable";
  vehicle: { year: number | null; make: string; model: string; trim: string | null };
  eligibleCategoryCount: number;
  areas: Array<{ name: string; complaintCount: number }>;
  additionalHistoricalDetailAvailable: boolean;
};

type RpcRow = {
  outcome: "matched" | "limited" | "ambiguous" | "unavailable";
  vehicle_year: number | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_trim: string | null;
  eligible_category_count: number;
  top_areas: unknown;
  additional_historical_detail_available: boolean;
};

function areas(value: unknown): Array<{ name: string; complaintCount: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.name === "string" && typeof row.historicalComplaintCount === "number" && Number.isInteger(row.historicalComplaintCount) && row.historicalComplaintCount > 0
      ? [{ name: row.name, complaintCount: row.historicalComplaintCount }]
      : [];
  }).slice(0, 3);
}

export const freeQuickCheckRepository = {
  async lookup(listingId: string, submissionKey: string): Promise<InternalFreeKnowledgeResult | null> {
    const client = getSupabaseAdminClient();
    const { data: listing, error: listingError } = await client
      .from("listings")
      .select("id, submission_key, vehicle:vehicles!inner(make, model, model_year, trim)")
      .eq("id", listingId)
      .eq("submission_key", submissionKey)
      .maybeSingle();
    if (listingError) throw new Error("Free Quick Check listing lookup failed.");
    if (!listing || !listing.vehicle || Array.isArray(listing.vehicle)) return null;
    const vehicle = listing.vehicle as { make: string; model: string; model_year: number | null; trim: string | null };
    const { data, error } = await client.rpc("free_quick_check_knowledge", {
      p_listing_id: listingId,
      p_submission_key: submissionKey,
      p_make_key: normalizeKnowledgeKey(vehicle.make),
      p_model_key: normalizeKnowledgeKey(vehicle.model),
      p_snapshot_id: PINNED_FREE_KNOWLEDGE_SNAPSHOT.id,
      p_snapshot_sha256: PINNED_FREE_KNOWLEDGE_SNAPSHOT.sha256,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) throw new Error("Free Quick Check knowledge lookup failed.");
    const result = row as RpcRow;
    if (!["matched", "limited", "ambiguous", "unavailable"].includes(result.outcome) || typeof result.vehicle_make !== "string" || typeof result.vehicle_model !== "string")
      throw new Error("Free Quick Check knowledge response was invalid.");
    return {
      outcome: result.outcome,
      vehicle: { year: result.vehicle_year, make: result.vehicle_make, model: result.vehicle_model, trim: result.vehicle_trim },
      eligibleCategoryCount: Number.isInteger(result.eligible_category_count) && result.eligible_category_count >= 0 ? result.eligible_category_count : 0,
      areas: areas(result.top_areas),
      additionalHistoricalDetailAvailable: result.additional_historical_detail_available === true,
    };
  },
};
