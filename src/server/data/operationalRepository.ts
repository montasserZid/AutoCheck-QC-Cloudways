import "server-only";

import { createContactMessageRepository } from "@/lib/data/contactMessageRepository";
import { getSupabaseAdminClient } from "@/server/supabase/admin";

export const operationalRepository = createContactMessageRepository(
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
