import { getSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }

  const headers = { "Cache-Control": "no-store" };
  let config: ReturnType<typeof getSupabaseConfig>;
  try {
    config = getSupabaseConfig();
  } catch {
    return Response.json(
      { ok: false, error: "Missing or invalid Supabase public environment variables." },
      { status: 503, headers },
    );
  }

  try {
    // Read public Auth configuration to validate the project URL and API key.
    const response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey, Accept: "application/openapi+json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return Response.json(
        { ok: false, error: "Supabase API check failed.", status: response.status },
        { status: 502, headers },
      );
    }
    const settings = await response.json();
    if (!settings || typeof settings !== "object") {
      throw new Error("Unexpected API response");
    }
    return Response.json({ ok: true, service: "supabase" }, { headers });
  } catch {
    return Response.json(
      { ok: false, error: "Could not verify the Supabase API connection." },
      { status: 502, headers },
    );
  }
}
