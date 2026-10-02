/**
 * Concise, credential-safe logging for the Cloudways extraction worker.
 *
 * Log lines are single-line JSON so they can be grepped with `grep worker.log`.
 * Secrets, authorization headers and page contents are never logged: the worker
 * secret key is redacted defensively even though no call site passes it.
 */

export type WorkerLogLevel = "info" | "warn" | "error";

export interface WorkerLogger {
  info(record: Record<string, unknown>): void;
  warn(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

const SENSITIVE_KEY = /secret|authorization|token|password|cookie|apikey|api_key/i;

export function redactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : value,
    ]),
  );
}

export function sanitizeLogHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "invalid-url";
  }
}

/**
 * Whitelist for the Facebook render diagnostics.
 *
 * The renderer only produces categories, counts, booleans and timings, but this
 * worker is a separate trust boundary, so the render record is rebuilt key by
 * key from this list. Anything unrecognised is dropped rather than forwarded:
 * page HTML, rendered text, cookies, headers, the worker secret, query strings
 * and the raw URL/path/title can therefore never reach worker.log.
 */
const SAFE_RENDER_SCALARS = [
  "phase",
  "outcome",
  "reason",
  "polls",
  "waitMs",
  "httpStatus",
  "pageState",
] as const;

const SAFE_RENDER_SESSION_FIELDS = [
  "configured",
  "loaded",
  "cookieCount",
  "loadFailure",
] as const;

const SAFE_RENDER_PAGE_FIELDS = [
  "host",
  "pathCategory",
  "titleCategory",
  "readyState",
  "bodyTextLength",
  "hasOgUrl",
  "hasMarketplaceMarker",
  "hasListingDetailMarkers",
] as const;

/**
 * Login-wall modal survey: only categories, counts and booleans ever produced
 * by `summarizeFacebookLoginWallSurvey`. The raw page path, title, dialog
 * text and aria labels are categorised in-page and are not part of this list.
 */
const SAFE_RENDER_WALL_FIELDS = [
  "pathCategory",
  "titleCategory",
  "bodyTextLength",
  "visibleDialogCount",
  "authDialogCount",
  "hasSafeControl",
  "safeControlType",
  "safeControlLabelSource",
  "safeControlLabelKind",
  "listingMarkersOutsideDialog",
  "marketplaceItemLinksOutsideDialog",
] as const;

/** The single dismissal attempt: decision enums, booleans and counters. */
const SAFE_RENDER_DISMISSAL_FIELDS = [
  "action",
  "reason",
  "clickResult",
  "dialogClosedAfterClick",
  "stabilizationPolls",
  "recovered",
] as const;

function safeScalar(value: unknown): unknown {
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}...` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return null;
}

function safeScalarMap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      safeScalar(entry),
    ]),
  );
}

export function sanitizeRenderDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const render = value as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const key of SAFE_RENDER_SCALARS) {
    if (key in render) out[key] = safeScalar(render[key]);
  }

  const page = render.page;
  if (page && typeof page === "object" && !Array.isArray(page)) {
    const pageRecord = page as Record<string, unknown>;
    out.page = Object.fromEntries(
      SAFE_RENDER_PAGE_FIELDS.filter((key) => key in pageRecord).map((key) => [
        key,
        safeScalar(pageRecord[key]),
      ]),
    );
  }

  if (render.predicates !== undefined) out.predicates = safeScalarMap(render.predicates);
  if (render.timings !== undefined) out.timings = safeScalarMap(render.timings);
  const session = render.session;
  if (session && typeof session === "object" && !Array.isArray(session)) {
    const s = session as Record<string, unknown>;
    out.session = Object.fromEntries(
      SAFE_RENDER_SESSION_FIELDS.filter((k) => k in s).map((k) => [k, safeScalar(s[k])]),
    );
  }

  const wall = render.wall;
  if (wall && typeof wall === "object" && !Array.isArray(wall)) {
    const w = wall as Record<string, unknown>;
    out.wall = Object.fromEntries(
      SAFE_RENDER_WALL_FIELDS.filter((k) => k in w).map((k) => [k, safeScalar(w[k])]),
    );
  }
  const dismissal = render.dismissal;
  if (dismissal && typeof dismissal === "object" && !Array.isArray(dismissal)) {
    const d = dismissal as Record<string, unknown>;
    out.dismissal = Object.fromEntries(
      SAFE_RENDER_DISMISSAL_FIELDS.filter((k) => k in d).map((k) => [k, safeScalar(d[k])]),
    );
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function createWorkerLogger(
  write: (line: string) => void = (line) => process.stdout.write(line),
  now: () => Date = () => new Date(),
): WorkerLogger {
  const emit = (level: WorkerLogLevel) => (record: Record<string, unknown>) => {
    write(
      `${JSON.stringify({
        ts: now().toISOString(),
        level,
        ...redactLogRecord(record),
      })}\n`,
    );
  };
  return {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}
