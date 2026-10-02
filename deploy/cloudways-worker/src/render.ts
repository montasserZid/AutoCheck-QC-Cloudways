import {
  extractFacebookMarketplaceItemViaHttp,
  facebookHttpMetadataToRenderedListing,
  FacebookExtractionError,
  renderFacebookMarketplaceListing,
  type FacebookRenderedListing,
} from "../vendor/src/server/listing/facebook";
import {
  ListingFetchError,
  resolvePublicUrl,
  type fetchPublicListingHtml,
} from "../vendor/src/server/listing/secureFetch";
import { sanitizeLogHostname, sanitizeRenderDiagnostics } from "./logging";

/**
 * The worker's browser/network half of the extraction.
 *
 * It deliberately reuses AutoCheck's existing modules rather than a second copy:
 *   - `resolvePublicUrl()` is the project's existing SSRF guard (protocol,
 *     credentials, internal hostnames, DNS resolution, private/loopback/
 *     link-local/metadata IPv4 + IPv6 rejection).
 *   - `renderFacebookMarketplaceListing()` is the project's existing Facebook
 *     browser renderer, which re-validates the final location after every
 *     navigation so a redirect cannot leave the allowed host set.
 *
 * Only the browser/network work happens here. Parsing, normalization and
 * provenance stay on the AutoCheck side.
 */

export const WORKER_HEALTH_ROUTE = "/health";
export const WORKER_EXTRACT_ROUTE = "/extract";
export const WORKER_SERVICE_NAME = "autocheck-extraction-worker";

export const WORKER_EXTRACTION_LIMITS = {
  timeoutMs: 25_000,
  maxConcurrent: 1,
  maxBodyBytes: 8 * 1024,
} as const;

export type WorkerFailureCode = "UNSAFE_URL" | "INVALID_URL" | "BUSY" | "WORKER_ERROR";

export type WorkerExtractResult =
  | { status: 200; body: { ok: true; rendered: FacebookRenderedListing } }
  | {
      status: number;
      body: {
        ok: false;
        code: WorkerFailureCode | string;
        error: string;
        /** Log-safe only: categories, counts, booleans and timings. */
        diagnostics?: Record<string, unknown>;
      };
    };

export type WorkerExtractor = (
  listingUrl: string,
  options: { timeoutMs: number },
) => Promise<WorkerExtractResult>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface WorkerExtractOptions {
  timeoutMs?: number;
  sessionDir?: string | null;
  /** Test seam: the HTTP metadata fetcher; defaults to AutoCheck's guarded fetch. */
  fetchHtml?: typeof fetchPublicListingHtml;
}

export async function extractWithBrowserWorker(
  listingUrl: string,
  options: WorkerExtractOptions | { timeoutMs?: number } = {},
): Promise<WorkerExtractResult> {
  const opts = (options as WorkerExtractOptions);
  const timeoutMs = opts.timeoutMs ?? WORKER_EXTRACTION_LIMITS.timeoutMs;
  const sessionDir = opts.sessionDir ?? process.env.AUTOCHECK_FACEBOOK_SESSION_DIR ?? null;

  // HTTP-first for direct Marketplace item URLs: the fetch runs through
  // AutoCheck's own SSRF-guarded `fetchPublicListingHtml`, which resolves and
  // validates the destination and every redirect hop before any request, so
  // public OpenGraph metadata can be served without launching Chromium.
  // Share URLs and unusable metadata (login walls, generic or mismatched
  // metadata, network failure) return null immediately or after a failed
  // attempt and continue to the browser path below, which keeps its own
  // independent resolvePublicUrl validation.
  const metadata = await extractFacebookMarketplaceItemViaHttp(listingUrl, {
    fetchHtml: opts.fetchHtml,
    onFallback: (reason) =>
      console.warn(
        JSON.stringify({
          event: "facebook_http_metadata_fallback",
          reason,
          hostname: sanitizeLogHostname(listingUrl),
        }),
      ),
  });
  if (metadata) {
    return {
      status: 200,
      body: { ok: true, rendered: facebookHttpMetadataToRenderedListing(metadata) },
    };
  }

  // Independent validation at this trust boundary. A URL that AutoCheck already
  // validated on Vercel is not trusted again: the worker resolves and checks the
  // destination itself before any browser is launched.
  try {
    await resolvePublicUrl(listingUrl);
  } catch (error) {
    const code =
      error instanceof ListingFetchError && error.code === "invalid-url"
        ? "INVALID_URL"
        : "UNSAFE_URL";
    return { status: 400, body: { ok: false, code, error: errorMessage(error) } };
  }

  try {
    const rendered = await renderFacebookMarketplaceListing(listingUrl, {
      timeoutMs,
      session: sessionDir ? { directory: sessionDir } : null,
    });
    return { status: 200, body: { ok: true, rendered } };
  } catch (error) {
    if (error instanceof FacebookExtractionError) {
      // Only the renderer's already-log-safe `render` diagnostics are forwarded,
      // and the caller re-filters them through sanitizeRenderDiagnostics().
      const render = sanitizeRenderDiagnostics(error.diagnostics?.render);
      return {
        status: error.code === "FACEBOOK_INVALID_URL" ? 400 : 502,
        body: {
          ok: false,
          code: error.code,
          error: error.message,
          ...(render ? { diagnostics: { render } } : {}),
        },
      };
    }
    return { status: 502, body: { ok: false, code: "WORKER_ERROR", error: errorMessage(error) } };
  }
}
