import type { VehicleIntake } from "../../types/domain";
import {
  addListingField,
  extractListingIdentity,
  normalizeListingNumber,
  normalizePriceCurrency,
  type ListingField,
  type ListingUrlExtraction,
} from "../../lib/listingUrlExtraction";
import {
  canonicalFacebookItemUrl,
  extractFacebookItemId,
  isDirectFacebookMarketplaceItemUrl,
} from "./facebook";

/**
 * PRIMARY Facebook Marketplace extraction via Bright Data's Marketplace
 * Scraper API (`datasets/v3/scrape`, dataset `gd_lvt9iwuh6fbcwmx1a`).
 *
 * Invoked by the extraction handler for a supported DIRECT Marketplace item
 * URL only. The contract mirrors `extractFacebookMarketplaceItemViaHttp`:
 * return a usable result, or `null` plus a safe enum reason so the existing
 * HTTP-metadata and browser fallbacks continue untouched.
 *
 * Cost and security posture:
 * - ONE bounded POST per invocation; never retried internally. A Bright Data
 *   call costs money, so every failure path returns immediately.
 * - The endpoint is a fixed server-side constant; the API key comes from the
 *   server environment only, is sent once as the Authorization header, and
 *   never appears in results, logs or fallback reasons.
 * - The user URL enters the request body only after the existing trusted
 *   Facebook URL validation (`isDirectFacebookMarketplaceItemUrl` +
 *   `extractFacebookItemId`); non-item URLs skip the provider silently so
 *   share links and other pages keep their existing behaviour at zero cost.
 * - Every response is treated as untrusted: bounded read, line-by-line JSONL
 *   parsing, and STRICT `product_id` binding to the requested item id before
 *   any field is mapped. A 200 alone proves nothing.
 * - No cookies, no credentials, no browser profiles, no crawler impersonation.
 */

/** Safe, loggable reasons why a Bright Data attempt could not be used. */
export type BrightDataFacebookFallbackReason =
  | "brightdata-not-configured"
  | "brightdata-timeout"
  | "brightdata-network-error"
  | "brightdata-http-error"
  | "brightdata-invalid-jsonl"
  | "brightdata-api-error"
  | "brightdata-missing-product-id"
  | "brightdata-id-mismatch"
  | "brightdata-insufficient-data";

/**
 * Fixed, trusted server-side destination. Never derived from request input,
 * environment variables or provider responses.
 */
export const BRIGHT_DATA_FACEBOOK_ENDPOINT =
  "https://api.brightdata.com/datasets/v3/scrape";

export const BRIGHT_DATA_FACEBOOK_DATASET_ID_DEFAULT = "gd_lvt9iwuh6fbcwmx1a";
export const BRIGHT_DATA_FACEBOOK_TIMEOUT_MS_DEFAULT = 30_000;

/** Bounded response size: a single listing's JSONL record is far below this. */
const BRIGHT_DATA_FACEBOOK_BODY_BYTES_DEFAULT = 2 * 1024 * 1024;
const BRIGHT_DATA_FACEBOOK_TIMEOUT_MIN_MS = 1_000;
const BRIGHT_DATA_FACEBOOK_TIMEOUT_MAX_MS = 55_000;
/** Defensive caps so a noisy record can never balloon the extraction. */
const MAX_IMAGES = 20;
const DESCRIPTION_LIMIT = 4000;
const MILES_TO_KM = 1.609344;

/** Fields that make a record a usable listing read (beyond URL bookkeeping). */
const USABLE_FIELDS = [
  "listingTitle",
  "askingPriceCad",
  "location",
  "sellerDescription",
] as const;

export interface BrightDataFacebookHttpRequest {
  endpoint: string;
  datasetId: string;
  apiKey: string;
  url: string;
  timeoutMs: number;
  maxBodyBytes: number;
  signal: AbortSignal;
}

export interface BrightDataFacebookHttpResponse {
  status: number;
  body: string;
}

export type BrightDataFacebookFetch = (
  request: BrightDataFacebookHttpRequest,
) => Promise<BrightDataFacebookHttpResponse>;

/** Thrown by the bounded reader when a response exceeds `maxBodyBytes`. */
export class BrightDataBodyTooLargeError extends Error {
  constructor() {
    super("The Bright Data response exceeded the bounded read limit.");
    this.name = "BrightDataBodyTooLargeError";
  }
}

export interface BrightDataFacebookExtraction {
  extraction: ListingUrlExtraction;
  itemId: string;
  canonicalUrl: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  elapsedMs: number;
  /** `is_sold` as reported; `null` when absent. Never coerced to a default. */
  sold: boolean | null;
  /** Safe diagnostics: number of data records parsed from the JSONL body. */
  recordCount: number;
  imageCount: number;
}

export interface BrightDataFacebookOptions {
  /** Transport seam for tests. Defaults to the fixed-endpoint POST below. */
  fetchImpl?: BrightDataFacebookFetch;
  /** Overrides `BRIGHT_DATA_API_KEY` (tests; empty forces not-configured). */
  apiKey?: string;
  /** Overrides `BRIGHT_DATA_FACEBOOK_DATASET_ID` (tests; empty is invalid). */
  datasetId?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  now?: () => number;
  /** Receives only the safe enum reason, never the key or response body. */
  onFallback?: (reason: BrightDataFacebookFallbackReason) => void;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function envTimeoutMs(): number | undefined {
  const raw = process.env.BRIGHT_DATA_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(
    Math.max(parsed, BRIGHT_DATA_FACEBOOK_TIMEOUT_MIN_MS),
    BRIGHT_DATA_FACEBOOK_TIMEOUT_MAX_MS,
  );
}

function boundedBodyBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0)
    return BRIGHT_DATA_FACEBOOK_BODY_BYTES_DEFAULT;
  return value;
}

/**
 * Reads the response with a hard byte cap: a declared `content-length` over
 * the limit fails before the body is read, and the stream is cancelled the
 * moment the accumulated bytes pass the limit.
 */
async function readBoundedBody(
  response: Response,
  maxBodyBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBodyBytes)
    throw new BrightDataBodyTooLargeError();

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (utf8Length(text) > maxBodyBytes) throw new BrightDataBodyTooLargeError();
    return text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BrightDataBodyTooLargeError();
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/**
 * The production transport: one POST to the fixed endpoint with the key in
 * the Authorization header only. `redirect: "error"` keeps a redirect from
 * changing where the request (and the key) would be delivered.
 */
async function fetchBrightDataFacebook(
  request: BrightDataFacebookHttpRequest,
): Promise<BrightDataFacebookHttpResponse> {
  const endpoint =
    `${request.endpoint}?dataset_id=${encodeURIComponent(request.datasetId)}` +
    "&notify=false&include_errors=true";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [{ url: request.url }],
      limit_per_input: null,
    }),
    redirect: "error",
    signal: request.signal,
  });
  return {
    status: response.status,
    body: await readBoundedBody(response, request.maxBodyBytes),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Bright Data error records (`include_errors=true`) carry one of these keys. */
function isBrightDataErrorRecord(record: Record<string, unknown>): boolean {
  for (const key of ["_error", "_error_type", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return true;
    if (value !== null && typeof value === "object") return true;
  }
  return false;
}

interface BrightDataParsedBody {
  dataRecords: Record<string, unknown>[];
  errorRecords: Record<string, unknown>[];
}

/**
 * Bounded, defensive JSONL parsing: split on newlines, ignore blanks, parse
 * every line independently, and accept a single-line JSON array as well (the
 * v3 endpoint may serialize either form). Unparseable lines and primitives
 * are counted and rejected only when nothing usable remains.
 */
function parseBrightDataJsonl(body: string): BrightDataParsedBody {
  const dataRecords: Record<string, unknown>[] = [];
  const errorRecords: Record<string, unknown>[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue;
      if (isBrightDataErrorRecord(entry)) errorRecords.push(entry);
      else dataRecords.push(entry);
    }
  }
  return { dataRecords, errorRecords };
}

/**
 * True when a record's URL fields point at this exact request (its echoed
 * `url` or `input.url` naming the same item id). Used to attribute provider
 * error records to this input.
 */
function recordTiedTo(
  record: Record<string, unknown>,
  requestedUrl: string,
  requestedId: string,
): boolean {
  const input = isPlainObject(record.input) ? record.input.url : undefined;
  for (const candidate of [record.url, input]) {
    if (typeof candidate !== "string" || candidate === "") continue;
    if (candidate === requestedUrl) return true;
    if (extractFacebookItemId(candidate) === requestedId) return true;
  }
  return false;
}

/**
 * A record whose own `url` names a DIFFERENT Marketplace item id conflicts
 * with the request and must never be used, even if `product_id` agreed.
 */
function recordConflictsWith(
  record: Record<string, unknown>,
  requestedId: string,
): boolean {
  if (typeof record.url !== "string" || record.url === "") return false;
  const recordItemId = extractFacebookItemId(record.url);
  return recordItemId !== null && recordItemId !== requestedId;
}

/**
 * Normalizes `product_id` to a comparable digit string. Numbers are only
 * accepted when they are safe integers (an imprecise float would risk a
 * false match); everything else — empty, malformed, non-digit — returns
 * `null` and the record is never bound to the request.
 */
function normalizeProductId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? trimmed : null;
  }
  return null;
}

/** Trim-only text extraction: keeps truthful content, drops stray padding. */
function textOf(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim();
}

/** Positive, finite numeric field; `0`, negatives and junk stay unknown. */
function positiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? normalizeListingNumber(value)
        : null;
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Only http(s) image URLs survive, deduplicated and capped. */
function imageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const candidate = entry.trim();
    if (candidate === "") continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    if (urls.includes(candidate)) continue;
    urls.push(candidate);
    if (urls.length >= MAX_IMAGES) break;
  }
  return urls;
}

function imageMime(url: string): string {
  if (/\.png(?:$|\?)/i.test(url)) return "image/png";
  if (/\.webp(?:$|\?)/i.test(url)) return "image/webp";
  if (/\.gif(?:$|\?)/i.test(url)) return "image/gif";
  return "image/jpeg";
}

/**
 * Maps an ID-bound Bright Data record into the existing extraction model.
 * Every field goes through `addListingField` with the `brightdata-facebook`
 * source, so provenance and `methods` record where the data came from.
 * Absent values stay absent: no field is ever defaulted to 0 or "".
 */
function buildExtraction(
  record: Record<string, unknown>,
  requestedId: string,
): {
  extraction: ListingUrlExtraction;
  sold: boolean | null;
  imageCount: number;
} {
  const source = "brightdata-facebook" as const;
  const canonicalUrl = canonicalFacebookItemUrl(requestedId);
  const result: ListingUrlExtraction = {
    details: {},
    found: [],
    uncertain: [],
    provenance: {},
    methods: [],
  };
  addListingField(result, "listingUrl", canonicalUrl, "url");
  addListingField(result, "listingSource", "facebook.com", "url");

  const title = textOf(record.title);
  if (title) {
    addListingField(result, "listingTitle", title, source);
    const identity = extractListingIdentity(title);
    for (const [key, value] of Object.entries(identity)) {
      addListingField(result, key as ListingField, value as never, source);
    }
  }
  // The structured brand can supply the make when the title never names it.
  if (!result.details.make) {
    const brand = textOf(record.brand);
    if (brand) addListingField(result, "make", brand, source);
  }

  // final_price is authoritative; initial_price is the fallback. The schema
  // carries one asking-price slot plus a currency field, so the number and
  // the reported currency are both preserved exactly as given.
  const price = positiveNumber(record.final_price) ?? positiveNumber(record.initial_price);
  if (price !== null) addListingField(result, "askingPriceCad", price, source);
  const currency = normalizePriceCurrency(record.currency);
  if (currency) addListingField(result, "priceCurrency", currency, source);

  // Facebook reports odometer reading in miles; the schema stores kilometres,
  // so a present reading is converted. A missing reading stays missing.
  const miles = positiveNumber(record.car_miles);
  if (miles !== null) {
    addListingField(result, "mileageUnit", "km", source);
    addListingField(result, "mileageKm", Math.round(miles * MILES_TO_KM), source);
  }

  const transmission = textOf(record.transmission);
  if (transmission) addListingField(result, "transmission", transmission, source);

  const location = textOf(record.location);
  if (location) {
    addListingField(result, "location", location, source);
    addListingField(result, "city", location.split(",")[0].trim(), source);
  }

  // The listing description is the seller's own text; the condition line and
  // the seller-profile note travel with it as unverified claims, clearly
  // labelled, within the existing 4000-character cap.
  const description = textOf(record.description);
  const condition = textOf(record.condition);
  const sellerNote = textOf(record.seller_description);
  const blocks = [
    description,
    condition ? `Condition: ${condition}` : "",
    sellerNote && sellerNote !== description ? sellerNote : "",
  ];
  const sellerDescription = blocks
    .filter((block) => block !== "")
    .join("\n\n")
    .slice(0, DESCRIPTION_LIMIT);
  if (sellerDescription)
    addListingField(result, "sellerDescription", sellerDescription, source);

  const images = imageUrls(record.images);
  if (images.length)
    addListingField(
      result,
      "photos",
      images.map((name) => ({ name, size: 0, type: imageMime(name) })),
      source,
    );

  result.found = Object.keys(result.details).filter((key) => {
    const value = result.details[key as keyof VehicleIntake];
    return value !== undefined && value !== null && value !== "";
  });
  result.uncertain = [...new Set(result.uncertain)];
  if (!result.details.make || !result.details.model)
    result.uncertain.push("make", "model");

  const sold = typeof record.is_sold === "boolean" ? record.is_sold : null;
  return { extraction: result, sold, imageCount: images.length };
}

/**
 * Attempts the Bright Data Marketplace scrape for a DIRECT Marketplace item
 * URL. Returns `null` plus a safe enum reason for every failure so callers
 * fall back to the existing HTTP-metadata/browser paths. Never throws for
 * expected failures, never logs or returns the API key or raw response body,
 * and performs at most one provider request per invocation.
 */
export async function extractFacebookListingViaBrightData(
  url: string,
  options: BrightDataFacebookOptions = {},
): Promise<BrightDataFacebookExtraction | null> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const fallback = (reason: BrightDataFacebookFallbackReason): null => {
    options.onFallback?.(reason);
    return null;
  };

  const requestedId = extractFacebookItemId(url);
  // Not a direct Marketplace item URL (share links, other pages, non-Facebook
  // targets): Bright Data simply does not apply. No attempt, no fallback
  // event, no cost — those URLs keep their existing behaviour untouched.
  if (!isDirectFacebookMarketplaceItemUrl(url) || !requestedId) return null;

  const apiKey = (options.apiKey ?? process.env.BRIGHT_DATA_API_KEY ?? "").trim();
  const datasetId = (
    options.datasetId ??
    process.env.BRIGHT_DATA_FACEBOOK_DATASET_ID ??
    BRIGHT_DATA_FACEBOOK_DATASET_ID_DEFAULT
  ).trim();
  if (!apiKey || !datasetId) return fallback("brightdata-not-configured");

  const requestedTimeout = options.timeoutMs ?? envTimeoutMs() ?? BRIGHT_DATA_FACEBOOK_TIMEOUT_MS_DEFAULT;
  const timeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : BRIGHT_DATA_FACEBOOK_TIMEOUT_MS_DEFAULT;
  const maxBodyBytes = boundedBodyBytes(options.maxBodyBytes);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: BrightDataFacebookHttpResponse;
  try {
    response = await (options.fetchImpl ?? fetchBrightDataFacebook)({
      endpoint: BRIGHT_DATA_FACEBOOK_ENDPOINT,
      datasetId,
      apiKey,
      url,
      timeoutMs,
      maxBodyBytes,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return fallback("brightdata-timeout");
    if (error instanceof BrightDataBodyTooLargeError)
      return fallback("brightdata-invalid-jsonl");
    return fallback("brightdata-network-error");
  } finally {
    clearTimeout(timer);
  }
  if (controller.signal.aborted) return fallback("brightdata-timeout");

  if (response.status < 200 || response.status >= 300)
    return fallback("brightdata-http-error");
  if (utf8Length(response.body) > maxBodyBytes)
    return fallback("brightdata-invalid-jsonl");

  const parsed = parseBrightDataJsonl(response.body);
  if (parsed.dataRecords.length === 0) {
    // Provider errors (or an unparseable body) with nothing usable: never a
    // successful extraction.
    if (parsed.errorRecords.length > 0) return fallback("brightdata-api-error");
    return fallback("brightdata-invalid-jsonl");
  }
  if (parsed.errorRecords.some((record) => recordTiedTo(record, url, requestedId)))
    return fallback("brightdata-api-error");

  // STRICT identity binding: the first record whose product_id ties exactly
  // to the requested item id wins (deterministic line order). No matching id
  // means the attempt is rejected — a 200 proves nothing on its own.
  let matched: Record<string, unknown> | null = null;
  let sawUsableId = false;
  for (const record of parsed.dataRecords) {
    const productId = normalizeProductId(record.product_id);
    if (productId === null) continue;
    sawUsableId = true;
    if (productId !== requestedId) continue;
    matched = record;
    break;
  }
  if (!matched)
    return fallback(sawUsableId ? "brightdata-id-mismatch" : "brightdata-missing-product-id");
  if (recordConflictsWith(matched, requestedId)) return fallback("brightdata-id-mismatch");

  const { extraction, sold, imageCount } = buildExtraction(matched, requestedId);
  const usable = USABLE_FIELDS.some((field) => extraction.found.includes(field));
  if (!usable) return fallback("brightdata-insufficient-data");

  const canonicalUrl = canonicalFacebookItemUrl(requestedId);
  return {
    extraction,
    itemId: requestedId,
    canonicalUrl,
    requestedUrl: url,
    finalUrl: canonicalUrl,
    httpStatus: response.status,
    elapsedMs: now() - startedAt,
    sold,
    recordCount: parsed.dataRecords.length,
    imageCount,
  };
}
