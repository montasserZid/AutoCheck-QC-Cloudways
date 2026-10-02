import { FINALIZED_INTAKE_LIMITS, validateFinalizedIntake } from "../../lib/finalizedIntake";

type Repository = {
  finalizeIntake(input: Extract<ReturnType<typeof validateFinalizedIntake>, { ok: true }>['value']): Promise<{ vehicleId: string; listingId: string; replayed: boolean }>;
};

const noStoreHeaders = { "Cache-Control": "no-store" };
function json(body: object, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}

export function createFinalizeIntakePostHandler(
  repository: Repository,
  onPersistenceError: (error: unknown) => void = (error) => console.error("Finalized intake persistence failed.", error),
) {
  return async function POST(request: Request): Promise<Response> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return json({ ok: false, error: "Send the finalized intake as JSON." }, 415);
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > FINALIZED_INTAKE_LIMITS.bodyBytes)
      return json({ ok: false, error: "The finalized intake is too large." }, 413);
    let raw: string;
    try { raw = await request.text(); } catch { return json({ ok: false, error: "The finalized intake could not be read." }, 400); }
    if (new TextEncoder().encode(raw).byteLength > FINALIZED_INTAKE_LIMITS.bodyBytes)
      return json({ ok: false, error: "The finalized intake is too large." }, 413);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "The finalized intake is not valid JSON." }, 400); }
    const validation = validateFinalizedIntake(payload);
    if (!validation.ok)
      return json({ ok: false, error: "Check the vehicle details and try again.", fields: validation.fields }, 400);
    try {
      const result = await repository.finalizeIntake(validation.value);
      return json({ ok: true, ...result }, result.replayed ? 200 : 201);
    } catch (error) {
      onPersistenceError(error);
      return json({ ok: false, error: "We couldn't save this listing right now. Please try again." }, 503);
    }
  };
}
