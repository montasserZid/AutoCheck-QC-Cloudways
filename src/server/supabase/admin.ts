import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase";

let client: SupabaseClient | undefined;

function getSupabaseSecretKey(): string {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error("Set SUPABASE_SECRET_KEY in the server environment.");
  }

  if (!secretKey.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SECRET_KEY must be a Supabase secret key.");
  }

  return secretKey;
}

/**
 * Privileged client for server repositories and trusted route handlers only.
 * Never import this module from a Client Component or expose its credential.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!client) {
    const { url } = getSupabaseConfig();
    client = createClient(url, getSupabaseSecretKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}
