import { FREE_QUICK_CHECK_LIMITS, validateFreeQuickCheckRequest } from "@/lib/freeQuickCheck";
import { toFreeQuickCheckResponse } from "@/server/knowledge/freeQuickCheckService";
import type { InternalFreeKnowledgeResult } from "@/server/knowledge/freeQuickCheckRepository";

const headers = { "Cache-Control": "no-store" };
const json = (body: object, status: number) => Response.json(body, { status, headers });

export function createFreeQuickCheckPostHandler(
  repository: { lookup(listingId: string, submissionKey: string): Promise<InternalFreeKnowledgeResult | null> },
  onError: (error: unknown) => void = (error) => console.error("Free Quick Check failed.", error),
) {
  return async function POST(request: Request): Promise<Response> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ ok: false, error: "Send the Free Quick Check request as JSON." }, 415);
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > FREE_QUICK_CHECK_LIMITS.bodyBytes) return json({ ok: false, error: "The Free Quick Check request is too large." }, 413);
    let raw: string;
    try { raw = await request.text(); } catch { return json({ ok: false, error: "The Free Quick Check request could not be read." }, 400); }
    if (new TextEncoder().encode(raw).byteLength > FREE_QUICK_CHECK_LIMITS.bodyBytes) return json({ ok: false, error: "The Free Quick Check request is too large." }, 413);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "The Free Quick Check request is not valid JSON." }, 400); }
    const validation = validateFreeQuickCheckRequest(payload);
    if (!validation.ok) return json({ ok: false, error: "Check the Free Quick Check request and try again.", fields: validation.fields }, 400);
    try {
      const result = await repository.lookup(validation.value.listingId, validation.value.submissionKey);
      if (!result) return json({ ok: false, error: "We couldn't find that saved listing." }, 404);
      return json({ ok: true, report: toFreeQuickCheckResponse(result) }, 200);
    } catch (error) {
      onError(error);
      return json({ ok: false, error: "Historical data is temporarily unavailable. Please try again." }, 503);
    }
  };
}
