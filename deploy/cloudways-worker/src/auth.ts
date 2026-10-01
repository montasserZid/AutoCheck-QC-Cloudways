import { createHash, timingSafeEqual } from "node:crypto";

export const WORKER_AUTH_HEADER = "x-autocheck-worker-secret";

/**
 * Constant-time secret comparison. Both sides are hashed first so the
 * comparison length is fixed and no early return leaks the secret length.
 */
export function constantTimeSecretEquals(
  provided: string | undefined,
  expected: string,
): boolean {
  const presented = createHash("sha256").update(provided ?? "", "utf8").digest();
  const accepted = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(presented, accepted);
}

function firstHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function readPresentedSecret(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const authorization = firstHeaderValue(headers, "authorization");
  if (authorization) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (bearer) return bearer[1].trim();
    // Tolerate a raw Authorization value from the PHP gateway.
    return authorization.trim();
  }
  const custom = firstHeaderValue(headers, WORKER_AUTH_HEADER);
  return custom?.trim() || undefined;
}

/**
 * A missing/empty configured secret denies every request. The worker must never
 * fall back to an open mode if its secret was not provisioned.
 */
export function isAuthorizedRequest(
  headers: Record<string, string | string[] | undefined>,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  return constantTimeSecretEquals(readPresentedSecret(headers), expectedSecret);
}
