import {
  FacebookExtractionError,
  renderFacebookMarketplaceListing,
  validatedFacebookMarketplaceItemUrl,
  type FacebookExtractionErrorCode,
  type FacebookRenderedListing,
} from "./facebook";
import { ListingFetchError, type ListingFetchErrorCode } from "./secureFetch";

/**
 * AutoCheck <-> Cloudways browser worker boundary.
 *
 * The worker performs browser/network work only and returns the rendered
 * listing payload. `extractFacebookMarketplaceListingFromRenderedText()` stays
 * authoritative for parsing, normalization and provenance, so extraction
 * quality is identical to the previous in-process path.
 */

export const BROWSER_WORKER_LIMITS = {
  bodyBytes: 8 * 1024,
  /** Must stay below the PHP gateway read timeout, which stays below Vercel's route budget. */
  timeoutMs: 40_000,
  /** Rendered body text is large but bounded; anything beyond this is a broken worker. */
  maxResponseBytes: 4 * 1024 * 1024,
} as const;

export const WORKER_FAILURE_CODES = {
  unavailable: "worker-unavailable",
  unauthorized: "worker-unauthorized",
  busy: "worker-busy",
  timeout: "worker-timeout",
  invalidResponse: "worker-invalid-response",
} as const;

const WORKER_UNAVAILABLE_CODES: ReadonlySet<ListingFetchErrorCode> = new Set([
  WORKER_FAILURE_CODES.unavailable,
  WORKER_FAILURE_CODES.unauthorized,
  WORKER_FAILURE_CODES.invalidResponse,
  WORKER_FAILURE_CODES.timeout,
]);

export function isBrowserWorkerFailure(code: ListingFetchErrorCode): boolean {
  return WORKER_UNAVAILABLE_CODES.has(code);
}

export type BrowserWorkerEnvironment = Readonly<Record<string, string | undefined>>;

export interface BrowserWorkerConfiguration {
  url: string;
  secret: string;
}

const FACEBOOK_ERROR_CODES: ReadonlySet<string> = new Set<FacebookExtractionErrorCode>([
  "FACEBOOK_INVALID_URL",
  "FACEBOOK_BROWSER_EXECUTABLE_NOT_FOUND",
  "FACEBOOK_BROWSER_LAUNCH_FAILED",
  "FACEBOOK_NAVIGATION_TIMEOUT",
  "FACEBOOK_SHARE_REDIRECT_FAILED",
  "FACEBOOK_ITEM_NOT_FOUND",
  "FACEBOOK_LOGIN_REQUIRED",
  "FACEBOOK_BLOCKED",
  "FACEBOOK_LISTING_NOT_RENDERED",
  "FACEBOOK_EXTRACTION_PARTIAL",
  "FACEBOOK_EXTRACTION_FAILED",
]);

/** Worker codes that mean "this target URL must never be fetched". */
const WORKER_REJECTED_TARGET_CODES = new Set(["UNSAFE_URL", "INVALID_URL", "UNSUPPORTED_URL"]);

function workerFailure(
  code: (typeof WORKER_FAILURE_CODES)[keyof typeof WORKER_FAILURE_CODES],
  message: string,
): ListingFetchError {
  return new ListingFetchError(code, message);
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

/**
 * The worker credential travels over this hop, so the endpoint itself must be
 * HTTPS. Plain HTTP is only tolerated for a loopback development address.
 */
export function parseBrowserWorkerUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw workerFailure(WORKER_FAILURE_CODES.unavailable, "The worker endpoint URL is malformed.");
  }
  if (url.username || url.password)
    throw workerFailure(
      WORKER_FAILURE_CODES.unavailable,
      "The worker endpoint URL cannot include credentials.",
    );
  const loopbackDevelopmentEndpoint =
    url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !loopbackDevelopmentEndpoint)
    throw workerFailure(
      WORKER_FAILURE_CODES.unavailable,
      "The worker endpoint must use HTTPS.",
    );
  return url.toString();
}

export function browserWorkerConfiguration(
  environment: BrowserWorkerEnvironment = process.env,
): BrowserWorkerConfiguration | null {
  const url = environment.AUTOCHECK_WORKER_URL?.trim();
  const secret = environment.AUTOCHECK_WORKER_SECRET?.trim();
  if (!url || !secret) return null;
  return { url: parseBrowserWorkerUrl(url), secret };
}

export function isBrowserWorkerConfigured(
  environment: BrowserWorkerEnvironment = process.env,
): boolean {
  const url = environment.AUTOCHECK_WORKER_URL?.trim();
  const secret = environment.AUTOCHECK_WORKER_SECRET?.trim();
  return Boolean(url && secret);
}

export function browserWorkerTimeoutMs(
  environment: BrowserWorkerEnvironment = process.env,
): number {
  const configured = Number(environment.AUTOCHECK_WORKER_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return BROWSER_WORKER_LIMITS.timeoutMs;
  return Math.min(Math.max(Math.trunc(configured), 1000), 55_000);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * The worker is a separate trust boundary, so its response shape is validated
 * before any rendered text reaches the parser.
 */
export function parseRenderedListingPayload(value: unknown): FacebookRenderedListing | null {
  const record = asRecord(value);
  if (!record) return null;
  const finalUrl = record.finalUrl;
  const canonicalUrl = record.canonicalUrl;
  const itemId = record.itemId;
  const title = record.title;
  const bodyText = record.bodyText;
  const elapsedMs = record.elapsedMs;
  if (
    typeof finalUrl !== "string" ||
    !finalUrl ||
    typeof canonicalUrl !== "string" ||
    !canonicalUrl ||
    typeof itemId !== "string" ||
    typeof title !== "string" ||
    typeof bodyText !== "string" ||
    !bodyText.trim() ||
    typeof elapsedMs !== "number" ||
    !Number.isFinite(elapsedMs)
  ) {
    return null;
  }
  return {
    requestedUrl: optionalString(record.requestedUrl) ?? finalUrl,
    finalUrl,
    canonicalUrl,
    itemId,
    title,
    bodyText,
    ogTitle: optionalString(record.ogTitle),
    ogDescription: optionalString(record.ogDescription),
    elapsedMs,
    // Whitelisted marker: only the exact HTTP metadata value survives the
    // trust boundary; anything else falls back to browser-rendered provenance.
    ...(record.source === "http-metadata" ? { source: "http-metadata" as const } : {}),
  };
}

function workerFailureResponseToError(
  status: number,
  code: string,
  message: string,
  resolvedUrl?: string,
): FacebookExtractionError | ListingFetchError {
  const resolvedDirectUrl = resolvedUrl ? validatedFacebookMarketplaceItemUrl(resolvedUrl) : null;
  const facebookError = (facebookCode: FacebookExtractionErrorCode) =>
    new FacebookExtractionError(
      facebookCode,
      message,
      resolvedDirectUrl ? { resolvedDirectUrl } : undefined,
    );
  if (WORKER_REJECTED_TARGET_CODES.has(code))
    return facebookError("FACEBOOK_INVALID_URL");
  if (code === "BUSY") return workerFailure(WORKER_FAILURE_CODES.busy, message);
  if (FACEBOOK_ERROR_CODES.has(code))
    return facebookError(code as FacebookExtractionErrorCode);
  if (status >= 500 || status === 404)
    return workerFailure(WORKER_FAILURE_CODES.unavailable, message);
  return workerFailure(WORKER_FAILURE_CODES.invalidResponse, message);
}

export async function fetchRenderedListingFromWorker(
  listingUrl: string,
  options: {
    configuration: BrowserWorkerConfiguration;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<FacebookRenderedListing> {
  const timeoutMs = options.timeoutMs ?? BROWSER_WORKER_LIMITS.timeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(options.configuration.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // Sent twice on purpose: `Authorization` is dropped by some SAPIs and
        // proxies, while the custom header always survives as a normal header.
        Authorization: `Bearer ${options.configuration.secret}`,
        "X-AutoCheck-Worker-Secret": options.configuration.secret,
      },
      body: JSON.stringify({ url: listingUrl }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted)
      throw workerFailure(WORKER_FAILURE_CODES.timeout, "The listing reader did not respond in time.");
    throw workerFailure(
      WORKER_FAILURE_CODES.unavailable,
      `The listing reader could not be reached: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403)
    throw workerFailure(
      WORKER_FAILURE_CODES.unauthorized,
      "The listing reader rejected AutoCheck's worker credential.",
    );
  if (response.status === 429)
    throw workerFailure(
      WORKER_FAILURE_CODES.busy,
      "The listing reader is busy with another extraction.",
    );

  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    throw workerFailure(
      WORKER_FAILURE_CODES.invalidResponse,
      `The listing reader response could not be read: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  if (new TextEncoder().encode(raw).byteLength > BROWSER_WORKER_LIMITS.maxResponseBytes)
    throw workerFailure(
      WORKER_FAILURE_CODES.invalidResponse,
      "The listing reader response was too large.",
    );

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw workerFailure(
      WORKER_FAILURE_CODES.invalidResponse,
      "The listing reader returned a malformed response.",
    );
  }

  const record = asRecord(payload);
  if (!record)
    throw workerFailure(
      WORKER_FAILURE_CODES.invalidResponse,
      "The listing reader returned a malformed response.",
    );

  if (record.ok === true) {
    const rendered = parseRenderedListingPayload(record.rendered);
    if (!rendered)
      throw workerFailure(
        WORKER_FAILURE_CODES.invalidResponse,
        "The listing reader returned an unusable rendered listing.",
      );
    return rendered;
  }

  const code = typeof record.code === "string" ? record.code : "";
  const resolvedUrl = typeof record.resolvedUrl === "string" ? record.resolvedUrl : undefined;
  const message =
    typeof record.error === "string" && record.error
      ? record.error
      : `The listing reader responded with status ${response.status}.`;
  throw workerFailureResponseToError(response.status, code, message, resolvedUrl);
}

/**
 * Single entry point used by the listing extraction route. When the Cloudways
 * worker is configured it performs the browser work; otherwise the previous
 * in-process behaviour is kept so local development and a deliberate rollback
 * continue to work unchanged.
 */
export async function renderFacebookMarketplaceListingForExtraction(
  listingUrl: string,
  options: {
    configuration?: BrowserWorkerConfiguration | null;
    environment?: BrowserWorkerEnvironment;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<FacebookRenderedListing> {
  const configuration =
    options.configuration === undefined
      ? browserWorkerConfiguration(options.environment ?? process.env)
      : options.configuration;
  if (!configuration) return renderFacebookMarketplaceListing(listingUrl);
  return fetchRenderedListingFromWorker(listingUrl, {
    configuration,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? browserWorkerTimeoutMs(options.environment ?? process.env),
  });
}
