import { contactTopics } from "../content/contact";

export const CONTACT_LIMITS = {
  bodyBytes: 24 * 1024,
  topic: 150,
  name: 100,
  email: 200,
  message: 4000,
} as const;

export interface ContactSubmission {
  topic: string;
  name: string;
  email: string;
  message: string;
}

export interface ValidatedContactMessage {
  topic: string;
  customerName: string;
  customerEmail: string;
  message: string;
}

export type ContactValidationResult =
  | { ok: true; value: ValidatedContactMessage }
  | { ok: false; fields: string[] };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizedSingleLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateContactSubmission(
  input: unknown,
): ContactValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, fields: ["topic", "name", "email", "message"] };
  }

  const record = input as Record<string, unknown>;
  const topic =
    typeof record.topic === "string"
      ? normalizedSingleLine(record.topic)
      : "";
  const customerName =
    typeof record.name === "string" ? normalizedSingleLine(record.name) : "";
  const customerEmail =
    typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const message =
    typeof record.message === "string"
      ? record.message.replace(/\r\n?/g, "\n").trim()
      : "";

  const fields: string[] = [];
  if (
    !topic ||
    topic.length > CONTACT_LIMITS.topic ||
    !contactTopics.includes(topic)
  )
    fields.push("topic");
  if (!customerName || customerName.length > CONTACT_LIMITS.name)
    fields.push("name");
  if (
    !customerEmail ||
    customerEmail.length > CONTACT_LIMITS.email ||
    !emailPattern.test(customerEmail)
  )
    fields.push("email");
  if (!message || message.length > CONTACT_LIMITS.message)
    fields.push("message");

  if (fields.length) return { ok: false, fields };

  return {
    ok: true,
    value: { topic, customerName, customerEmail, message },
  };
}

export async function submitContactMessage(
  submission: ContactSubmission,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
  } catch {
    throw new Error("We couldn't send your message. Check your connection and try again.");
  }

  if (response.ok) return;

  let error = "We couldn't send your message right now. Please try again.";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) error = body.error;
  } catch {
    // Keep the safe generic message for non-JSON failures.
  }
  throw new Error(error);
}
