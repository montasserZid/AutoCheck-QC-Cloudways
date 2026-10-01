import { createClient } from "@supabase/supabase-js";

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.");
  }

  // Only accept the publishable key format, never secret or legacy service keys.
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key.");
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be the HTTPS project URL.");
  }

  return { url: parsedUrl.origin, publishableKey };
}

// Safe for browser and server callers; no user sessions or shared server state.
export function createSupabaseClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
