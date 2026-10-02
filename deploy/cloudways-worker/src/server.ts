import { randomUUID } from "node:crypto";
import http from "node:http";

import { isAuthorizedRequest } from "./auth";
import {
  sanitizeLogHostname,
  sanitizeRenderDiagnostics,
  type WorkerLogger,
} from "./logging";
import {
  extractWithBrowserWorker,
  WORKER_EXTRACTION_LIMITS,
  WORKER_EXTRACT_ROUTE,
  WORKER_HEALTH_ROUTE,
  WORKER_SERVICE_NAME,
  type WorkerExtractor,
} from "./render";

/**
 * AutoCheck Cloudways extraction worker.
 *
 * Binds to 127.0.0.1 only and is reachable exclusively through the authenticated
 * PHP gateway. It is never an open URL fetcher:
 *   - every request requires the shared worker secret (constant-time compared),
 *   - the target URL is re-validated with AutoCheck's own SSRF guard,
 *   - browser concurrency is hard-bounded and excess requests are rejected,
 *     never queued without limit,
 *   - browser cleanup is guaranteed by the reused renderer.
 */

export const WORKER_SERVER_LIMITS = {
  maxConcurrent: WORKER_EXTRACTION_LIMITS.maxConcurrent,
  extractTimeoutMs: WORKER_EXTRACTION_LIMITS.timeoutMs,
  maxBodyBytes: WORKER_EXTRACTION_LIMITS.maxBodyBytes,
  shutdownGraceMs: 10_000,
} as const;

export interface ExtractionWorkerOptions {
  secret?: string;
  maxConcurrent?: number;
  extractTimeoutMs?: number;
  maxBodyBytes?: number;
  extract?: WorkerExtractor;
  logger?: WorkerLogger;
  now?: () => number;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

function sendJson(response: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...NO_STORE,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

type BodyResult =
  | { ok: true; body: string }
  | { ok: false; reason: "too-large" | "unreadable" };

function readRequestBody(
  request: http.IncomingMessage,
  maxBytes: number,
): Promise<BodyResult> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes)
    return Promise.resolve({ ok: false, reason: "too-large" });

  return new Promise<BodyResult>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: BodyResult) => {
      if (settled) return;
      settled = true;
      request.removeAllListeners("data");
      request.removeAllListeners("end");
      request.removeAllListeners("error");
      request.removeAllListeners("aborted");
      request.pause();
      resolve(result);
    };
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        finish({ ok: false, reason: "too-large" });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) finish({ ok: true, body: Buffer.concat(chunks).toString("utf8") });
    });
    request.on("error", () => finish({ ok: false, reason: "unreadable" }));
    request.on("aborted", () => finish({ ok: false, reason: "unreadable" }));
  });
}

function requestPath(request: http.IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

export function createExtractionWorker(options: ExtractionWorkerOptions = {}): http.Server {
  const secret = options.secret?.trim();
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? WORKER_SERVER_LIMITS.maxConcurrent);
  const extractTimeoutMs =
    options.extractTimeoutMs ?? WORKER_SERVER_LIMITS.extractTimeoutMs;
  const maxBodyBytes = options.maxBodyBytes ?? WORKER_SERVER_LIMITS.maxBodyBytes;
  const extract = options.extract ?? extractWithBrowserWorker;
  const logger = options.logger;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let activeExtractions = 0;

  const reject = (
    response: http.ServerResponse,
    requestId: string,
    status: number,
    code: string,
    error: string,
    reason: string,
  ) => {
    logger?.warn({ event: "worker_request_rejected", requestId, status, code, reason });
    sendJson(response, status, { ok: false, code, error, requestId });
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestId = randomUUID();
      const path = requestPath(request);

      // Authentication is checked before routing so an unauthenticated caller
      // cannot probe which endpoints exist.
      if (!isAuthorizedRequest(request.headers, secret)) {
        reject(
          response,
          requestId,
          401,
          "UNAUTHORIZED",
          "Worker authentication failed.",
          secret ? "invalid-secret" : "worker-secret-not-configured",
        );
        return;
      }

      if (path === WORKER_HEALTH_ROUTE) {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          reject(response, requestId, 405, "METHOD_NOT_ALLOWED", "Use GET.", "method");
          return;
        }
        logger?.info({
          event: "worker_health",
          requestId,
          activeExtractions,
          maxConcurrent,
          uptimeSeconds: Math.round((now() - startedAt) / 1000),
        });
        sendJson(response, 200, {
          ok: true,
          service: WORKER_SERVICE_NAME,
          activeExtractions,
          maxConcurrent,
          ready: activeExtractions < maxConcurrent,
          uptimeSeconds: Math.round((now() - startedAt) / 1000),
        });
        return;
      }

      if (path !== WORKER_EXTRACT_ROUTE) {
        reject(response, requestId, 404, "NOT_FOUND", "Unknown worker route.", "unknown-route");
        return;
      }

      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        reject(response, requestId, 405, "METHOD_NOT_ALLOWED", "Use POST.", "method");
        return;
      }

      const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
      if (!contentType.startsWith("application/json")) {
        reject(
          response,
          requestId,
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Send the listing URL as JSON.",
          "content-type",
        );
        return;
      }

      const body = await readRequestBody(request, maxBodyBytes);
      if (!body.ok) {
        reject(
          response,
          requestId,
          body.reason === "too-large" ? 413 : 400,
          body.reason === "too-large" ? "REQUEST_TOO_LARGE" : "UNREADABLE_REQUEST",
          body.reason === "too-large"
            ? "The extraction request is too large."
            : "The extraction request could not be read.",
          body.reason,
        );
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body.body);
      } catch {
        reject(
          response,
          requestId,
          400,
          "INVALID_JSON",
          "The extraction request is not valid JSON.",
          "invalid-json",
        );
        return;
      }

      const listingUrl =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).url
          : undefined;
      if (typeof listingUrl !== "string" || !listingUrl.trim()) {
        reject(
          response,
          requestId,
          400,
          "MISSING_URL",
          "Provide a listing URL.",
          "missing-url",
        );
        return;
      }
      const requestedUrl = listingUrl.trim();

      if (activeExtractions >= maxConcurrent) {
        response.setHeader("Retry-After", "10");
        logger?.warn({
          event: "worker_busy",
          requestId,
          hostname: sanitizeLogHostname(requestedUrl),
          activeExtractions,
          maxConcurrent,
        });
        sendJson(response, 429, {
          ok: false,
          code: "BUSY",
          error: "Another extraction is already running.",
          requestId,
        });
        return;
      }

      activeExtractions += 1;
      const extractionStartedAt = now();
      logger?.info({
        event: "extraction_start",
        requestId,
        hostname: sanitizeLogHostname(requestedUrl),
      });
      try {
        const result = await extract(requestedUrl, { timeoutMs: extractTimeoutMs });
        const elapsedMs = now() - extractionStartedAt;
        if (result.body.ok) {
          logger?.info({
            event: "extraction_success",
            requestId,
            hostname: sanitizeLogHostname(requestedUrl),
            elapsedMs,
          });
          sendJson(response, 200, { ...result.body, requestId });
          return;
        }
        const timeouted = elapsedMs >= extractTimeoutMs;
        const render = sanitizeRenderDiagnostics(result.body.diagnostics?.render);
        logger?.[timeouted ? "warn" : "error"]({
          event: timeouted ? "extraction_timeout" : "extraction_failed",
          requestId,
          hostname: sanitizeLogHostname(requestedUrl),
          elapsedMs,
          code: result.body.code,
          // What Facebook actually served, so a failed extraction is diagnosable
          // from worker.log alone. Categories/counts only, never page content.
          ...(render ? { render } : {}),
        });
        // Diagnostics are logged above, never shipped back to the gateway:
        // JSON.stringify omits undefined values, so the key disappears.
        sendJson(response, result.status, {
          ...result.body,
          diagnostics: undefined,
          requestId,
        });
      } catch (error) {
        const elapsedMs = now() - extractionStartedAt;
        logger?.error({
          event: "extraction_failed",
          requestId,
          hostname: sanitizeLogHostname(requestedUrl),
          elapsedMs,
          code: "WORKER_ERROR",
          detail: error instanceof Error ? error.message : String(error),
        });
        sendJson(response, 502, {
          ok: false,
          code: "WORKER_ERROR",
          error: "The extraction worker failed.",
          requestId,
        });
      } finally {
        activeExtractions -= 1;
      }
    })().catch(() => {
      if (!response.headersSent)
        sendJson(response, 500, { ok: false, code: "WORKER_ERROR", error: "Worker failure." });
      else response.end();
    });
  });

  server.on("close", () => {
    logger?.info({ event: "worker_stopped" });
  });

  return server;
}
