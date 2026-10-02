import "server-only";

import { createContactMessageRepository } from "@/lib/data/contactMessageRepository";
import { createFinalizedIntakeRepository } from "@/lib/data/finalizedIntakeRepository";
import { getSupabaseAdminClient } from "@/server/supabase/admin";

const contactRepository = createContactMessageRepository(
  async (row) => {
    const { data, error } = await getSupabaseAdminClient()
      .from("contact_messages")
      .insert(row)
      .select("id, created_at")
      .single();

    if (error || !data) throw new Error("Contact insert failed.");
    return data;
  },
);

const finalizedIntakeRepository = createFinalizedIntakeRepository(async ({ submissionKey, intake }) => {
  const metadata = {
    listing_title: intake.listingTitle || undefined,
    seller_name: intake.sellerName || undefined,
    location: intake.location || undefined,
    listing_source: intake.listingSource || undefined,
    mileage_unit: intake.mileageUnit === "unknown" ? undefined : intake.mileageUnit,
    transmission: intake.transmission || undefined,
    drivetrain: intake.drivetrain || undefined,
    engine: intake.engine || undefined,
    price: intake.askingPriceCad === null || intake.priceCurrency === "CAD" ? undefined : {
      value: intake.askingPriceCad,
      currency: intake.priceCurrency,
    },
  };
  const { data, error } = await getSupabaseAdminClient().rpc("finalize_vehicle_listing", {
    p_submission_key: submissionKey,
    p_vehicle: { make: intake.make, model: intake.model, model_year: intake.year, trim: intake.trim || null, vin: intake.vin },
    p_listing: {
      source_type: intake.listingUrl ? "url" : intake.listingText ? "text" : intake.photos.length ? "images" : "manual",
      listing_url: intake.listingUrl || null,
      raw_listing_text: intake.listingText,
      photo_metadata: intake.photos,
      preferred_language: intake.preferredLanguage,
      mileage_km: intake.mileageKm,
      asking_price_cad: intake.askingPriceCad !== null && intake.priceCurrency === "CAD" ? intake.askingPriceCad : null,
      city: intake.city || null,
      seller_type: intake.sellerType,
      accident_history_mentioned: intake.accidentHistoryMentioned,
      rebuilt_status: intake.rebuiltStatus,
      maintenance_records: intake.maintenanceRecords,
      carfax_status: intake.carfaxStatus,
      inspection_allowed: intake.inspectionAllowed,
      seller_description: intake.sellerDescription,
      normalization_metadata: metadata,
    },
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row.vehicle_id !== "string" || typeof row.listing_id !== "string" || typeof row.replayed !== "boolean")
    throw new Error("Finalized intake RPC failed.");
  return { vehicleId: row.vehicle_id, listingId: row.listing_id, replayed: row.replayed };
});

export const operationalRepository = { ...contactRepository, ...finalizedIntakeRepository };
