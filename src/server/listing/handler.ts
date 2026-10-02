import { extractListingFromHtml } from "../../lib/listingUrlExtraction";
import {
  FacebookExtractionError,
  extractFacebookListingFromRenderedText,
  extractFacebookMarketplaceItemViaHttp,
  facebookErrorToListingFetchError,
  isSupportedFacebookMarketplaceUrl,
} from "./facebook";
import { extractFacebookListingViaBrightData } from "./brightDataFacebook";
import {
  isBrowserWorkerFailure,
  renderFacebookMarketplaceListingForExtraction,
} from "./browserWorker";
import {
  fetchPublicListingHtml,
  LISTING_FETCH_LIMITS,
  ListingFetchError,
  type ListingNetworkDiagnostics,
} from "./secureFetch";

export const LISTING_EXTRACTION_LIMITS = {
  bodyBytes: 8 * 1024,
} as const;

const noStoreHeaders = { "Cache-Control": "no-store" };

function json(body: object, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function publicMessage(error: ListingFetchError): string {
  if (error.code === "unsafe-url" || error.code === "invalid-url")
    return "This listing URL cannot be retrieved safely.";
  if (error.code === "worker-busy")
    return "Our listing reader is busy with another listing. Please try again in a moment.";
  if (isBrowserWorkerFailure(error.code))
    return "Our listing reader is temporarily unavailable. Paste the listing text below, or try again shortly.";
  if (error.code === "timeout")
    return "The listing took too long to respond.";
  if (error.code === "non-html")
    return "The listing did not return a readable HTML page.";
  if (error.code === "too-large")
    return "The listing page is too large to read automatically.";
  return "We couldn't automatically read this listing.";
}

function listingFetchErrorStatus(error: ListingFetchError): number {
  if (error.code === "unsafe-url" || error.code === "invalid-url") return 400;
  return isBrowserWorkerFailure(error.code) || error.code === "worker-busy" ? 503 : 502;
}

function publicFacebookMessage(error: FacebookExtractionError): string {
  if (error.code === "FACEBOOK_INVALID_URL")
    return "This Facebook Marketplace URL cannot be retrieved safely.";
  if (error.code === "FACEBOOK_LOGIN_REQUIRED")
    return "Facebook requested login before showing this listing.";
  if (error.code === "FACEBOOK_BLOCKED")
    return "Facebook blocked anonymous listing access.";
  if (error.code === "FACEBOOK_NAVIGATION_TIMEOUT")
    return "Facebook took too long to render this listing.";
  if (error.code === "FACEBOOK_ITEM_NOT_FOUND")
    return "We could not find the Marketplace item from this Facebook link.";
  return "We couldn't automatically read this Facebook listing.";
}

function extractionStatus(found: string[]): "extracted" | "partial" | "empty" {
  const core = ["year", "make", "model", "askingPriceCad", "mileageKm"];
  const coreCount = core.filter((field) => found.includes(field)).length;
  if (coreCount >= 3) return "extracted";
  if (found.some((field) => !["listingUrl", "listingSource"].includes(field)))
    return "partial";
  return "empty";
}

function compactDiagnostics(
  diagnostics: ListingNetworkDiagnostics | undefined,
): ListingNetworkDiagnostics | undefined {
  if (!diagnostics) return undefined;
  return {
    name: diagnostics.name,
    code: diagnostics.code,
    errno: diagnostics.errno,
    syscall: diagnostics.syscall,
    hostname: diagnostics.hostname,
    address: diagnostics.address,
    port: diagnostics.port,
    message: diagnostics.message,
    stage: diagnostics.stage,
    lifecycle: diagnostics.lifecycle
      ? {
          pageClosed: diagnostics.lifecycle.pageClosed,
          pageCloseEvent: diagnostics.lifecycle.pageCloseEvent,
          pageError: diagnostics.lifecycle.pageError,
          browserConnected: diagnostics.lifecycle.browserConnected,
          browserDisconnectedEvent: diagnostics.lifecycle.browserDisconnectedEvent,
          targetCreatedCount: diagnostics.lifecycle.targetCreatedCount,
          targetChangedCount: diagnostics.lifecycle.targetChangedCount,
          targetDestroyedCount: diagnostics.lifecycle.targetDestroyedCount,
          pageTargetChangedCount: diagnostics.lifecycle.pageTargetChangedCount,
          pageTargetDestroyed: diagnostics.lifecycle.pageTargetDestroyed,
          browserProcessExitEvent: diagnostics.lifecycle.browserProcessExitEvent,
          browserProcessCloseEvent: diagnostics.lifecycle.browserProcessCloseEvent,
          browserProcessExitCode: diagnostics.lifecycle.browserProcessExitCode,
          browserProcessSignal: diagnostics.lifecycle.browserProcessSignal,
          browserProcessKilled: diagnostics.lifecycle.browserProcessKilled,
          browserProcessSpawnArgs: diagnostics.lifecycle.browserProcessSpawnArgs,
          browserStderrTail: diagnostics.lifecycle.browserStderrTail,
          elapsedSinceBrowserLaunchMs: diagnostics.lifecycle.elapsedSinceBrowserLaunchMs,
          elapsedSinceRequestStartMs: diagnostics.lifecycle.elapsedSinceRequestStartMs,
          msSinceBrowserDisconnect: diagnostics.lifecycle.msSinceBrowserDisconnect,
          cleanupStarted: diagnostics.lifecycle.cleanupStarted,
          deadlineExpired: diagnostics.lifecycle.deadlineExpired,
          navigationActive: diagnostics.lifecycle.navigationActive,
          lastNavigationSucceeded: diagnostics.lifecycle.lastNavigationSucceeded,
          msSinceLastNavigation: diagnostics.lifecycle.msSinceLastNavigation,
          msSinceLastTargetChange: diagnostics.lifecycle.msSinceLastTargetChange,
          memoryAtRequestStart: diagnostics.lifecycle.memoryAtRequestStart,
          memoryAtBrowserLaunch: diagnostics.lifecycle.memoryAtBrowserLaunch,
          memoryAfterNavigation: diagnostics.lifecycle.memoryAfterNavigation,
          memoryAtFailure: diagnostics.lifecycle.memoryAtFailure,
        }
      : undefined,
    attemptedAddresses: diagnostics.attemptedAddresses,
    cause: diagnostics.cause
      ? compactDiagnostics(diagnostics.cause)
      : undefined,
  };
}

export function serializeListingFetchErrorForLog(error: ListingFetchError): string {
  return JSON.stringify({
    name: error.name,
    code: error.code,
    status: error.status,
    message: error.message,
    diagnostics: compactDiagnostics(error.diagnostics),
  });
}

export function createListingExtractionPostHandler(
  fetchListingHtml: typeof fetchPublicListingHtml = fetchPublicListingHtml,
  onRetrievalError: (error: unknown) => void = (error) => {
    if (error instanceof ListingFetchError) {
      // Vercel's console formatter collapses nested objects to "[Object]".
      // A single JSON string preserves every nested lifecycle/memory value.
      console.error("Listing URL extraction failed.", serializeListingFetchErrorForLog(error));
      return;
    }
    console.error("Listing URL extraction failed.", error);
  },
  // Primary Facebook path (server-side Bright Data Marketplace scraper).
  // Injection seam for tests; defaults to the real provider client, which is
  // a no-op (missing configuration) unless BRIGHT_DATA_API_KEY is set.
  extractBrightData: typeof extractFacebookListingViaBrightData = extractFacebookListingViaBrightData,
) {
  return async function POST(request: Request): Promise<Response> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return json({ ok: false, error: "Send the listing URL as JSON." }, 415);

    const declaredLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > LISTING_EXTRACTION_LIMITS.bodyBytes
    )
      return json({ ok: false, error: "The listing request is too large." }, 413);

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return json({ ok: false, error: "The listing request could not be read." }, 400);
    }
    if (new TextEncoder().encode(rawBody).byteLength > LISTING_EXTRACTION_LIMITS.bodyBytes)
      return json({ ok: false, error: "The listing request is too large." }, 413);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "The listing request is not valid JSON." }, 400);
    }

    const url =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).url
        : undefined;
    if (typeof url !== "string" || !url.trim())
      return json({ ok: false, error: "Provide a listing URL." }, 400);

    try {
      if (isSupportedFacebookMarketplaceUrl(url.trim())) {
        // PRIMARY: the Bright Data Marketplace scraper for DIRECT item URLs.
        // Missing configuration, timeout, malformed payloads and every
        // identity failure return null with a safe enum reason, so the
        // existing HTTP-first metadata attempt and the browser worker below
        // continue exactly as before. Exactly one provider request is made
        // per extraction (never retried here).
        const brightData = await extractBrightData(url.trim(), {
          onFallback: (reason) =>
            console.warn(
              JSON.stringify({ event: "facebook_brightdata_fallback", reason }),
            ),
        });
        if (brightData) {
          console.log(
            JSON.stringify({
              event: "facebook_brightdata_extraction",
              itemId: brightData.itemId,
              recordCount: brightData.recordCount,
              elapsedMs: brightData.elapsedMs,
            }),
          );
          const status = extractionStatus(brightData.extraction.found);
          return json(
            {
              ok: true,
              status,
              retrieval: {
                finalUrl: brightData.canonicalUrl,
                httpStatus: brightData.httpStatus,
                itemId: brightData.itemId,
                elapsedMs: brightData.elapsedMs,
                strategy: "brightdata",
                sold: brightData.sold,
              },
              extraction: brightData.extraction,
            },
            200,
          );
        }

        // HTTP-first for direct Marketplace item URLs: public OpenGraph
        // metadata is used only when it is provably tied to the requested
        // item and genuinely usable. Every other case (share URLs, login
        // walls, generic or mismatched metadata, network failure) falls back
        // to the existing browser rendering path unchanged.
        const metadata = await extractFacebookMarketplaceItemViaHttp(url.trim(), {
          fetchHtml: fetchListingHtml,
          onFallback: (reason) =>
            console.warn(
              JSON.stringify({ event: "facebook_http_metadata_fallback", reason }),
            ),
        });
        if (metadata) {
          const status = extractionStatus(metadata.extraction.found);
          return json(
            {
              ok: true,
              status,
              retrieval: {
                finalUrl: metadata.canonicalUrl,
                httpStatus: metadata.httpStatus,
                itemId: metadata.itemId,
                elapsedMs: metadata.elapsedMs,
                strategy: "http-metadata",
              },
              extraction: metadata.extraction,
            },
            200,
          );
        }

        const rendered = await renderFacebookMarketplaceListingForExtraction(url.trim());
        const extraction = extractFacebookListingFromRenderedText(
          rendered,
          rendered.source === "http-metadata" ? "meta" : "facebook-rendered",
        );
        const status = extractionStatus(extraction.found);
        return json(
          {
            ok: true,
            status,
            retrieval: {
              finalUrl: rendered.canonicalUrl,
              httpStatus: 200,
              itemId: rendered.itemId,
              elapsedMs: rendered.elapsedMs,
              strategy:
                rendered.source === "http-metadata"
                  ? "http-metadata"
                  : "browser-rendered",
            },
            extraction,
          },
          200,
        );
      }

      const page = await fetchListingHtml(url.trim(), {
        maxBodyBytes: LISTING_FETCH_LIMITS.bodyBytes,
        maxRedirects: LISTING_FETCH_LIMITS.redirects,
        timeoutMs: LISTING_FETCH_LIMITS.timeoutMs,
      });
      const extraction = extractListingFromHtml(page.html, page.finalUrl);
      const status = extractionStatus(extraction.found);
      return json(
        {
          ok: true,
          status,
          retrieval: {
            finalUrl: page.finalUrl,
            httpStatus: page.status,
          },
          extraction,
        },
        200,
      );
    } catch (error) {
      if (error instanceof FacebookExtractionError) {
        onRetrievalError(facebookErrorToListingFetchError(error));
        return json(
          {
            ok: false,
            status: "failed",
            code: error.code,
            error: publicFacebookMessage(error),
          },
          error.code === "FACEBOOK_INVALID_URL" ? 400 : 502,
        );
      }
      if (error instanceof ListingFetchError) {
        onRetrievalError(error);
        return json(
          {
            ok: false,
            status: "failed",
            code: error.code,
            error: publicMessage(error),
          },
          listingFetchErrorStatus(error),
        );
      }
      onRetrievalError(error);
      return json(
        {
          ok: false,
          status: "failed",
          error: "We couldn't automatically read this listing.",
        },
        502,
      );
    }
  };
}
