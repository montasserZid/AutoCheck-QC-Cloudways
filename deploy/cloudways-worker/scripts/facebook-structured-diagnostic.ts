/**
 * Isolated anonymous structured-extraction diagnostic for a DIRECT Facebook
 * Marketplace item URL. EXPERIMENTAL — this file is never imported by the
 * production extraction flow; it exists to answer, with safe evidence,
 * whether Facebook currently serves genuine listing data to an anonymous
 * HTTP client, and how.
 *
 * What it does (bounded, no login, no cookies, no CAPTCHA, no crawler
 * impersonation — an honest User-Agent throughout):
 *
 *   PATH 1  One secure GET of the item URL through the existing
 *           `fetchPublicListingHtml` (full SSRF/redirect/size/deadline
 *           protection), reduced to a safe survey: path category, OpenGraph
 *           presence, payload markers, id-tie evidence.
 *   PATH 2  One or two POSTs to Facebook's own logged-out Relay endpoint
 *           (`/api/graphql/`) — the same request its public frontend makes —
 *           carrying a listing-detail query. The doc id comes from the
 *           fetched page's own `expectedPreloaders` metadata when possible,
 *           with a last-known-good fallback; every attempt is labelled with
 *           its provenance. The answer is accepted only when the detail
 *           target's own `id` field equals the requested item id.
 *   PHOTOS  If the detail answer carries no photos, one bounded follow-up
 *           images query under the same identity rule.
 *
 * Output is a single safe JSON document: categories, counts, booleans and
 * normalized public listing fields. Never raw HTML, cookies, headers,
 * tokens, query strings or complete Facebook payloads.
 *
 * Usage:
 *   node facebook-structured-diagnostic.js --url "https://www.facebook.com/marketplace/item/<id>/"
 *   optional: --doc-id <id>   replay a specific listing-detail doc id
 *   optional: --no-photos     skip the follow-up images query
 */

import https from "node:https";

import {
  extractFacebookItemId,
  isDirectFacebookMarketplaceItemUrl,
} from "../vendor/src/server/listing/facebook";
import {
  ListingFetchError,
  fetchPublicListingHtml,
  resolvePublicUrl,
} from "../vendor/src/server/listing/secureFetch";
import {
  FACEBOOK_DETAIL_DOC_ID_FALLBACK,
  FACEBOOK_IMAGES_DOC_ID_FALLBACK,
  buildFacebookDetailVariables,
  countFacebookStructuredFields,
  decodeFacebookGraphqlBody,
  discoverFacebookDocIds,
  facebookStructuredSafeUrl,
  isAllowedGraphqlHost,
  parseFacebookListingPhotosResponse,
  parseFacebookMarketplaceDetailResponse,
  selectFacebookDetailDocId,
  selectFacebookImagesDocId,
  surveyFacebookStructuredDocument,
  type FacebookStructuredHtmlSurvey,
  type FacebookStructuredListing,
} from "./facebookStructured";

/** Honest client identity — never a crawler or privileged-agent persona. */
const DIAGNOSTIC_USER_AGENT = "AutoCheckQC/1.0 (+https://autocheckqc.com)";

const GRAPHQL_ENDPOINT = "https://www.facebook.com/api/graphql/";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const ATTEMPT_SPACING_MS = 1_200;

interface DiagnosticAttempt {
  docId: string;
  source: "cli-override" | "known-verified-fallback" | "page-expectedPreloaders";
  httpStatus: number | null;
  bodyCategory: string | null;
  outcome: string;
}

interface DiagnosticStageError {
  stage: "html-fetch" | "detail-fetch" | "photos-fetch";
  code: string;
  status?: number;
}

interface DiagnosticReport {
  diagnostic: "facebook-structured";
  version: 1;
  generatedAt: string;
  requestedUrl: string;
  requestedItemId: string;
  html: Partial<FacebookStructuredHtmlSurvey> & { error?: string; status?: number };
  docIdDiscovery: {
    source: "page-expectedPreloaders" | "none";
    candidates: Array<{ queryName: string; queryID: string }>;
    detailDocId: string | null;
    imagesDocId: string | null;
  };
  structured: {
    attempted: boolean;
    success: boolean;
    requestedIdTied: boolean;
    docId?: string;
    docIdSource?: string;
    httpStatus?: number;
    bodyCategory?: string;
    reason?: string;
    facebookErrorCode?: string;
    facebookErrorSummary?: string;
    detailTargetCount?: number;
    otherListingObjectCount?: number;
    fieldCount: number;
    listing?: FacebookStructuredListing;
  };
  photos: {
    attempted: boolean;
    success: boolean;
    photoCount: number;
    photos: string[];
    docId?: string;
    docIdSource?: string;
    reason?: string;
  };
  attempts: DiagnosticAttempt[];
  errors: DiagnosticStageError[];
}

interface GraphqlPostOutcome {
  status: number;
  location: string | null;
  bodyCategory: string;
  body: string;
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stageErrorOf(
  stage: DiagnosticStageError["stage"],
  error: unknown,
): DiagnosticStageError {
  if (error instanceof ListingFetchError) {
    const entry: DiagnosticStageError = { stage, code: error.code };
    if (typeof error.status === "number") entry.status = error.status;
    return entry;
  }
  return { stage, code: "network-error" };
}

/**
 * POSTs a form body to Facebook's GraphQL endpoint through the existing
 * SSRF pipeline: `resolvePublicUrl` validates and DNS-pins the target, the
 * socket is pinned to that address exactly like `requestHtml` does, TLS SNI
 * uses the real hostname, redirects are reported (never followed), and the
 * response is size- and deadline-bounded.
 */
function postFacebookGraphqlForm(form: URLSearchParams): Promise<GraphqlPostOutcome> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let resolved: { url: URL; addresses: ResolvedAddress[] };
      try {
        resolved = await resolvePublicUrl(GRAPHQL_ENDPOINT);
      } catch (error) {
        reject(error);
        return;
      }
      const { url, addresses } = resolved;
      if (!isAllowedGraphqlHost(url.hostname)) {
        reject(new ListingFetchError("unsafe-url", "The structured endpoint host was rejected."));
        return;
      }

      const body = form.toString();
      let lastNetworkError: unknown;
      for (const address of addresses) {
        try {
          const outcome = await new Promise<GraphqlPostOutcome>((innerResolve, innerReject) => {
            const request = https.request(
              {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                path: `${url.pathname}${url.search}`,
                method: "POST",
                headers: {
                  Host: url.host,
                  "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                  "Content-Length": String(Buffer.byteLength(body)),
                  Accept: "*/*",
                  "Accept-Language": "en-US,en;q=0.9",
                  Origin: "https://www.facebook.com",
                  Referer: "https://www.facebook.com/marketplace/",
                  "User-Agent": DIAGNOSTIC_USER_AGENT,
                },
                servername: url.hostname,
                // Pin the socket to the address `resolvePublicUrl` validated,
                // exactly like the production GET path (no second DNS lookup
                // can drift to a different host between check and connect).
                lookup(_hostname, lookupOptions, callback) {
                  if (
                    typeof lookupOptions === "object" &&
                    lookupOptions !== null &&
                    "all" in lookupOptions &&
                    lookupOptions.all
                  ) {
                    callback(null, [{ address: address.address, family: address.family }]);
                    return;
                  }
                  callback(null, address.address, address.family);
                },
              },
              (response) => {
                const status = response.statusCode ?? 0;
                if ([301, 302, 303, 307, 308].includes(status)) {
                  response.resume();
                  const location = response.headers.location;
                  innerResolve({
                    status,
                    location: typeof location === "string" ? location : null,
                    bodyCategory: "redirect",
                    body: "",
                  });
                  return;
                }
                const declaredLength = Number(response.headers["content-length"]);
                if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
                  response.destroy();
                  innerReject(
                    new ListingFetchError("too-large", "The structured answer is too large.", status),
                  );
                  return;
                }
                const chunks: Buffer[] = [];
                let total = 0;
                let failed = false;
                response.on("data", (chunk: Buffer) => {
                  if (failed) return;
                  total += chunk.length;
                  if (total > MAX_BODY_BYTES) {
                    failed = true;
                    response.destroy();
                    innerReject(
                      new ListingFetchError("too-large", "The structured answer is too large.", status),
                    );
                    return;
                  }
                  chunks.push(chunk);
                });
                response.on("error", () => {
                  if (!failed) {
                    innerReject(
                      new ListingFetchError("network-error", "The structured request failed.", status),
                    );
                  }
                });
                response.on("end", () => {
                  if (failed) return;
                  innerResolve({
                    status,
                    location: null,
                    bodyCategory: "",
                    body: Buffer.concat(chunks).toString("utf8"),
                  });
                });
              },
            );
            request.setTimeout(REQUEST_TIMEOUT_MS, () => {
              request.destroy(
                new ListingFetchError("timeout", "The structured request timed out."),
              );
            });
            request.on("error", (error) => {
              if (error instanceof ListingFetchError) innerReject(error);
              else {
                innerReject(
                  new ListingFetchError("network-error", "The structured request failed."),
                );
              }
            });
            request.end(body);
          });
          resolve(outcome);
          return;
        } catch (error) {
          if (
            error instanceof ListingFetchError &&
            error.code === "network-error" &&
            addresses.length > 1
          ) {
            lastNetworkError = error;
            continue;
          }
          reject(error);
          return;
        }
      }
      reject(lastNetworkError ?? new ListingFetchError("network-error", "The structured request failed."));
    })();
  });
}

interface DetailAttemptResult {
  attempt: DiagnosticAttempt;
  parsed: ReturnType<typeof parseFacebookMarketplaceDetailResponse> | null;
}

async function attemptDetailQuery(
  requestedItemId: string,
  spec: { docId: string; source: DiagnosticAttempt["source"]; variables: Record<string, unknown> },
): Promise<DetailAttemptResult> {
  const form = new URLSearchParams({
    __a: "1",
    __comet_req: "15",
    doc_id: spec.docId,
    variables: JSON.stringify(spec.variables),
  });

  let outcome: GraphqlPostOutcome;
  try {
    outcome = await postFacebookGraphqlForm(form);
  } catch (error) {
    const stage = stageErrorOf("detail-fetch", error);
    return {
      attempt: {
        docId: spec.docId,
        source: spec.source,
        httpStatus: typeof stage.status === "number" ? stage.status : null,
        bodyCategory: null,
        outcome: `transport-error:${stage.code}`,
      },
      parsed: null,
    };
  }

  if (outcome.location !== null) {
    // A redirect from the structured endpoint (typically to /login/) is a
    // recorded outcome, never something to follow.
    return {
      attempt: {
        docId: spec.docId,
        source: spec.source,
        httpStatus: outcome.status,
        bodyCategory: "redirect",
        outcome: "redirected",
      },
      parsed: null,
    };
  }

  const decoded = decodeFacebookGraphqlBody(outcome.body);
  const parsed = parseFacebookMarketplaceDetailResponse(decoded.json, requestedItemId);
  const outcomeLabel =
    parsed.status === "accepted" ? "accepted" : `rejected:${parsed.reason}`;
  return {
    attempt: {
      docId: spec.docId,
      source: spec.source,
      httpStatus: outcome.status,
      bodyCategory: decoded.kind,
      outcome: parsed.status === "accepted" || parsed.status === "rejected" ? outcomeLabel : "rejected",
    },
    parsed,
  };
}

function usage(): string {
  return [
    "Usage: node facebook-structured-diagnostic.js --url \"<direct marketplace item url>\"",
    "  --doc-id <id>   replay a specific listing-detail doc id (overrides discovery)",
    "  --no-photos     skip the follow-up listing-images query",
    "  --help          show this message",
  ].join("\n");
}

async function run(argv: string[]): Promise<number> {
  let url: string | null = null;
  let docIdOverride: string | null = null;
  let includePhotos = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (arg === "--url") {
      url = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--doc-id") {
      docIdOverride = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--no-photos") {
      includePhotos = false;
      continue;
    }
    process.stderr.write(`Unknown argument: ${arg}\n${usage()}\n`);
    return 2;
  }

  if (!url || !isDirectFacebookMarketplaceItemUrl(url)) {
    process.stderr.write(`--url must be a direct facebook.com/marketplace/item/<id>/ URL.\n${usage()}\n`);
    return 2;
  }
  const requestedItemId = extractFacebookItemId(url);
  if (!requestedItemId) {
    process.stderr.write(`--url must contain a numeric Marketplace item id.\n${usage()}\n`);
    return 2;
  }
  if (docIdOverride !== null && !/^\d{4,}$/.test(docIdOverride)) {
    process.stderr.write(`--doc-id must be a numeric document id.\n${usage()}\n`);
    return 2;
  }

  const report: DiagnosticReport = {
    diagnostic: "facebook-structured",
    version: 1,
    generatedAt: new Date().toISOString(),
    requestedUrl: facebookStructuredSafeUrl(url),
    requestedItemId,
    html: {},
    docIdDiscovery: {
      source: "none",
      candidates: [],
      detailDocId: null,
      imagesDocId: null,
    },
    structured: {
      attempted: false,
      success: false,
      requestedIdTied: false,
      fieldCount: 0,
    },
    photos: {
      attempted: false,
      success: false,
      photoCount: 0,
      photos: [],
    },
    attempts: [],
    errors: [],
  };

  // ---- PATH 1: secure public HTML fetch (existing SSRF pipeline) ----------
  let html = "";
  try {
    const page = await fetchPublicListingHtml(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
      headers: {
        "User-Agent": DIAGNOSTIC_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    html = page.html;
    report.html = {
      ...surveyFacebookStructuredDocument({
        requestedItemId,
        finalUrl: page.finalUrl,
        status: page.status,
        html,
      }),
    };
  } catch (error) {
    const stage = stageErrorOf("html-fetch", error);
    report.errors.push(stage);
    report.html = { error: stage.code };
    if (typeof stage.status === "number") report.html.status = stage.status;
  }

  // ---- Doc-id discovery from the page's own public metadata ----------------
  if (html) {
    const discovered = discoverFacebookDocIds(html);
    if (discovered.length > 0) {
      report.docIdDiscovery.source = "page-expectedPreloaders";
      report.docIdDiscovery.candidates = discovered
        .slice(0, 8)
        .map((entry) => ({ queryName: entry.queryName, queryID: entry.queryID }));
    }
    const detailCandidate = selectFacebookDetailDocId(discovered);
    const imagesCandidate = selectFacebookImagesDocId(discovered);
    if (detailCandidate) report.docIdDiscovery.detailDocId = detailCandidate.queryID;
    if (imagesCandidate) report.docIdDiscovery.imagesDocId = imagesCandidate.queryID;

    // ---- PATH 2: anonymous listing-detail query ---------------------------
    const specs: Array<{
      docId: string;
      source: DiagnosticAttempt["source"];
      variables: Record<string, unknown>;
    }> = [];
    if (docIdOverride !== null) {
      specs.push({
        docId: docIdOverride,
        source: "cli-override",
        variables: buildFacebookDetailVariables(requestedItemId),
      });
    } else {
      // Verified live 2026-10-01. Facebook rotates ids, so the page's own
      // (possibly different) container query id is tried as the bounded
      // fallback below, and every attempt records which source answered.
      specs.push({
        docId: FACEBOOK_DETAIL_DOC_ID_FALLBACK,
        source: "known-verified-fallback",
        variables: buildFacebookDetailVariables(requestedItemId),
      });
      if (
        detailCandidate &&
        detailCandidate.queryID !== FACEBOOK_DETAIL_DOC_ID_FALLBACK
      ) {
        specs.push({
          docId: detailCandidate.queryID,
          source: "page-expectedPreloaders",
          variables:
            detailCandidate.variables && Object.keys(detailCandidate.variables).length > 0
              ? detailCandidate.variables
              : buildFacebookDetailVariables(requestedItemId),
        });
      }
    }

    report.structured.attempted = true;
    for (let index = 0; index < specs.length; index += 1) {
      if (index > 0) await sleep(ATTEMPT_SPACING_MS);
      const result = await attemptDetailQuery(requestedItemId, specs[index]);
      report.attempts.push(result.attempt);
      if (result.parsed && result.parsed.status === "accepted") {
        report.structured.success = true;
        report.structured.requestedIdTied = true;
        report.structured.docId = result.attempt.docId;
        report.structured.docIdSource = result.attempt.source;
        report.structured.httpStatus = result.attempt.httpStatus ?? undefined;
        report.structured.bodyCategory = result.attempt.bodyCategory ?? undefined;
        report.structured.detailTargetCount = result.parsed.detailTargetCount;
        report.structured.otherListingObjectCount = result.parsed.otherListingObjectCount;
        report.structured.listing = result.parsed.listing;
        report.structured.fieldCount = countFacebookStructuredFields(result.parsed.listing);
        break;
      }
      if (result.parsed && result.parsed.status === "rejected") {
        report.structured.reason = result.parsed.reason;
        if (result.parsed.facebookErrorCode !== undefined) {
          report.structured.facebookErrorCode = result.parsed.facebookErrorCode;
        }
        if (result.parsed.facebookErrorSummary !== undefined) {
          report.structured.facebookErrorSummary = result.parsed.facebookErrorSummary;
        }
        report.structured.httpStatus = result.attempt.httpStatus ?? undefined;
        report.structured.bodyCategory = result.attempt.bodyCategory ?? undefined;
      } else if (!result.parsed) {
        report.structured.reason = "transport-error";
      }
    }

    // ---- Bounded follow-up: listing photos (same identity rule) -----------
    if (
      includePhotos &&
      report.structured.success &&
      report.structured.listing &&
      report.structured.listing.photoCount === 0
    ) {
      const imagesSpec = imagesCandidate
        ? { docId: imagesCandidate.queryID, source: "page-expectedPreloaders" as const }
        : { docId: FACEBOOK_IMAGES_DOC_ID_FALLBACK, source: "known-verified-fallback" as const };
      report.photos.attempted = true;
      report.photos.docId = imagesSpec.docId;
      report.photos.docIdSource = imagesSpec.source;
      await sleep(ATTEMPT_SPACING_MS);
      const form = new URLSearchParams({
        __a: "1",
        __comet_req: "15",
        doc_id: imagesSpec.docId,
        variables: JSON.stringify({ targetId: requestedItemId }),
      });
      try {
        const outcome = await postFacebookGraphqlForm(form);
        if (outcome.location !== null) {
          report.photos.reason = "redirected";
        } else {
          const decoded = decodeFacebookGraphqlBody(outcome.body);
          const parsed = parseFacebookListingPhotosResponse(decoded.json, requestedItemId);
          if (parsed.status === "accepted") {
            report.photos.success = true;
            report.photos.photoCount = parsed.photoCount;
            report.photos.photos = parsed.photos;
            report.structured.listing.photoCount = parsed.photoCount;
            report.structured.listing.photos = parsed.photos;
          } else {
            report.photos.reason = parsed.reason;
          }
        }
      } catch (error) {
        const stage = stageErrorOf("photos-fetch", error);
        report.errors.push(stage);
        report.photos.reason = stage.code;
      }
    }
  } else {
    // No document to discover metadata from: still record the honest reason
    // the structured path was not attempted.
    report.structured.reason = "no-page-for-discovery";
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.structured.success ? 0 : 1;
}

const entry = process.argv[1];
const invokedDirectly =
  typeof entry === "string" &&
  entry.replace(/\\/g, "/").includes("facebook-structured-diagnostic");

if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("Diagnostic failed unexpectedly.\n");
      process.exitCode = 1;
    },
  );
}

export { run as runFacebookStructuredDiagnostic };
