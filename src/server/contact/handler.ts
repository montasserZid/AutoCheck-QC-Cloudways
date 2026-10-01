import type { OperationalRepository } from "../../lib/data/operationalRepository";
import {
  CONTACT_LIMITS,
  validateContactSubmission,
} from "../../lib/contactSubmission";

type ContactRepository = Pick<OperationalRepository, "createContactMessage">;

const noStoreHeaders = { "Cache-Control": "no-store" };
const publicFailureMessage =
  "We couldn't send your message right now. Please try again.";

function json(body: object, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}

export function createContactPostHandler(
  repository: ContactRepository,
  onPersistenceError: (error: unknown) => void = (error) =>
    console.error("Contact message persistence failed.", error),
) {
  return async function POST(request: Request): Promise<Response> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ ok: false, error: "Send the contact form as JSON." }, 415);
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > CONTACT_LIMITS.bodyBytes
    ) {
      return json({ ok: false, error: "The contact submission is too large." }, 413);
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return json({ ok: false, error: "The contact submission could not be read." }, 400);
    }
    if (new TextEncoder().encode(rawBody).byteLength > CONTACT_LIMITS.bodyBytes) {
      return json({ ok: false, error: "The contact submission is too large." }, 413);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "The contact submission is not valid JSON." }, 400);
    }

    const validation = validateContactSubmission(payload);
    if (!validation.ok) {
      return json(
        {
          ok: false,
          error: "Check the contact form fields and try again.",
          fields: validation.fields,
        },
        400,
      );
    }

    try {
      await repository.createContactMessage(validation.value);
      return json({ ok: true }, 201);
    } catch (error) {
      onPersistenceError(error);
      return json({ ok: false, error: publicFailureMessage }, 503);
    }
  };
}
