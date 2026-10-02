/**
 * Pure logic for the isolated Facebook Marketplace structured diagnostic.
 *
 * This module is EXPERIMENTAL. It is imported only by the standalone
 * diagnostic CLI and its regression tests — never by the production
 * extraction flow (handler.ts / render.ts / the worker request path).
 *
 * Everything here is pure: no I/O, no network, no page state. Inputs are raw
 * documents or parsed JSON; outputs are bounded, log-safe structures of
 * categories, counts, booleans and normalized public listing fields. Raw
 * HTML, cookies, headers, tokens and query strings never cross the boundary.
 *
 * Identity rule (same principle as the production HTTP path): a structured
 * result is accepted only when the detail target's own `id` field equals the
 * requested Marketplace item id. A URL that merely contains the id — a login
 * `next=` parameter, a redirect target, navigation state — is never identity
 * evidence. Conflicting ids reject the result.
 */

import {
  classifyFacebookPath,
  extractFacebookItemId,
  type FacebookPathCategory,
} from "../vendor/src/server/listing/facebook";
import { parseAttributes } from "../vendor/src/lib/listingUrlExtraction";

// ---------------------------------------------------------------------------
// Verified request metadata (checked live against Facebook on 2026-10-01).
//
// Facebook rotates Relay document ids over time, so the CLI prefers ids
// discovered from the fetched page (`expectedPreloaders`) and treats these
// constants only as last-known-good fallbacks, always labelled with their
// provenance in the output. They are public query identifiers — the same
// values Facebook's own logged-out page embeds — never credentials.
// ---------------------------------------------------------------------------

/** Last-known-good listing-detail doc id; replay verified 2026-10-01. */
export const FACEBOOK_DETAIL_DOC_ID_FALLBACK = "34344688261796183";

/**
 * Listing-images doc id. Today this equals the id the fetched page itself
 * publishes for `MarketplacePDPC2CMediaViewerWithImagesQuery`.
 */
export const FACEBOOK_IMAGES_DOC_ID_FALLBACK = "10059604367394414";

/** Query names published by Facebook's own Marketplace PDP page. */
export const FACEBOOK_DETAIL_QUERY_NAME = "MarketplacePDPContainerQuery";
export const FACEBOOK_IMAGES_QUERY_NAME = "MarketplacePDPC2CMediaViewerWithImagesQuery";

const GRAPHQL_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);

export function isAllowedGraphqlHost(hostname: string): boolean {
  return GRAPHQL_HOSTS.has(hostname.toLowerCase());
}

// ---------------------------------------------------------------------------
// Safe representations
// ---------------------------------------------------------------------------

/** Origin + pathname only; query strings and fragments are where tokens live. */
export function facebookStructuredSafeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function safePathname(raw: string): string | null {
  try {
    return new URL(raw).pathname;
  } catch {
    return null;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capped(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// OpenGraph / canonical metadata (shared attribute parser, no HTML escapes)
// ---------------------------------------------------------------------------

export interface FacebookStructuredOgMeta {
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  canonical: string;
}

/**
 * Reads only `<meta>`/`<link>` attributes from a document. Attribute order,
 * quote style and entity encoding are handled by the shared `parseAttributes`
 * parser; the first occurrence of a property wins, matching production.
 * Returns attribute values only — never tag or document text.
 */
export function extractFacebookStructuredOgMeta(html: string): FacebookStructuredOgMeta {
  const properties: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const property = (attributes.property || "").toLowerCase();
    if (property && attributes.content && properties[property] === undefined) {
      properties[property] = attributes.content;
    }
  }
  let canonical = "";
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if ((attributes.rel || "").toLowerCase() === "canonical" && attributes.href) {
      canonical = attributes.href;
      break;
    }
  }
  return {
    ogTitle: properties["og:title"] ?? "",
    ogDescription: properties["og:description"] ?? "",
    ogImage: facebookStructuredSafeUrl(properties["og:image"] ?? ""),
    ogUrl: facebookStructuredSafeUrl(properties["og:url"] ?? ""),
    canonical: facebookStructuredSafeUrl(canonical),
  };
}

// ---------------------------------------------------------------------------
// HTML document survey
// ---------------------------------------------------------------------------

export interface FacebookStructuredIdEvidence {
  canonical: boolean;
  ogUrl: boolean;
  finalPath: boolean;
}

export interface FacebookStructuredHtmlSurvey {
  status: number;
  finalHost: string;
  finalPathCategory: FacebookPathCategory;
  canonicalCategory: FacebookPathCategory | "none";
  hasOgTitle: boolean;
  hasOgDescription: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImagePresent: boolean;
  canonicalPresent: boolean;
  jsonScriptCount: number;
  relayCandidateCount: number;
  expectedPreloadersCount: number;
  pdpQueryNameCount: number;
  detailTargetMentionCount: number;
  requestedIdOccurrences: number;
  requestedIdTied: boolean;
  requestedIdTiedVia: FacebookStructuredIdEvidence;
  idOnlyInLoginParams: boolean;
  conflictingIdInEvidence: boolean;
  htmlLength: number;
}

export interface FacebookStructuredHtmlSurveyInput {
  requestedItemId: string;
  finalUrl: string;
  status: number;
  html: string;
}

/**
 * Reduces a fetched document to safe signals. The requested id counts as
 * "tied" only through identity-bearing locations (canonical URL, og:url, or
 * the final path itself). An id that appears solely inside `next=`-style
 * redirect parameters — a login wall echoing the requested URL back — is
 * reported through `idOnlyInLoginParams` and NEVER as a tie.
 */
export function surveyFacebookStructuredDocument(
  input: FacebookStructuredHtmlSurveyInput,
): FacebookStructuredHtmlSurvey {
  const og = extractFacebookStructuredOgMeta(input.html);
  const requestedId = input.requestedItemId;

  const canonicalId = extractFacebookItemId(og.canonical || "");
  const ogUrlId = extractFacebookItemId(og.ogUrl || "");
  const finalPathId = extractFacebookItemId(input.finalUrl || "");

  const tiedVia: FacebookStructuredIdEvidence = {
    canonical: canonicalId === requestedId,
    ogUrl: ogUrlId === requestedId,
    finalPath:
      finalPathId === requestedId &&
      classifyFacebookPath(safePathname(input.finalUrl) ?? "") === "marketplace-item",
  };
  const requestedIdTied = tiedVia.canonical || tiedVia.ogUrl || tiedVia.finalPath;

  const evidenceIds = [canonicalId, ogUrlId, finalPathId].filter(
    (id): id is string => id !== null,
  );
  const conflictingIdInEvidence = evidenceIds.some((id) => id !== requestedId);

  const requestedIdOccurrences = countOccurrences(input.html, requestedId);
  const idOnlyInLoginParams =
    !requestedIdTied &&
    requestedIdOccurrences > 0 &&
    new RegExp(`next=[^"'<>\\s]{0,400}${escapeRegExp(requestedId)}`).test(input.html);

  const finalPathname = safePathname(input.finalUrl);
  const canonicalPathname = og.canonical ? safePathname(og.canonical) : null;

  return {
    status: input.status,
    finalHost: safePathname(input.finalUrl) === null ? "" : (() => {
      try {
        return new URL(input.finalUrl).hostname;
      } catch {
        return "";
      }
    })(),
    finalPathCategory: classifyFacebookPath(finalPathname ?? "/"),
    canonicalCategory: canonicalPathname
      ? classifyFacebookPath(canonicalPathname)
      : "none",
    hasOgTitle: og.ogTitle.trim().length > 0,
    hasOgDescription: og.ogDescription.trim().length > 0,
    ogTitle: capped(og.ogTitle, 160),
    ogDescription: capped(og.ogDescription, 300),
    ogImagePresent: og.ogImage.trim().length > 0,
    canonicalPresent: og.canonical.trim().length > 0,
    jsonScriptCount: countOccurrences(input.html, '<script type="application/json">'),
    relayCandidateCount: countOccurrences(input.html, "RelayPrefetchedStreamCache"),
    expectedPreloadersCount: countOccurrences(input.html, '"expectedPreloaders"'),
    pdpQueryNameCount: countOccurrences(input.html, FACEBOOK_DETAIL_QUERY_NAME),
    detailTargetMentionCount: countOccurrences(
      input.html,
      "marketplace_product_details_page",
    ),
    requestedIdOccurrences,
    requestedIdTied,
    requestedIdTiedVia: tiedVia,
    idOnlyInLoginParams,
    conflictingIdInEvidence,
    htmlLength: input.html.length,
  };
}

// ---------------------------------------------------------------------------
// Doc-id discovery from the fetched page (Facebook's own public metadata)
// ---------------------------------------------------------------------------

export interface FacebookDocIdCandidate {
  queryName: string;
  queryID: string;
  /** The page's own variables for this query, when published. Not printed. */
  variables?: Record<string, unknown>;
}

const MAX_PRELOADER_SCAN_CHARS = 3_000_000;

/**
 * Extracts the balanced JSON array that follows `"expectedPreloaders":` and
 * returns its `queryName`/`queryID` pairs — the same public identifiers
 * Facebook's logged-out page uses to preload its own queries. Returns `[]`
 * when the page publishes none (a login wall, for example).
 */
export function discoverFacebookDocIds(html: string): FacebookDocIdCandidate[] {
  const marker = '"expectedPreloaders":';
  const markerAt = html.indexOf(marker);
  if (markerAt === -1) return [];
  const start = html.indexOf("[", markerAt + marker.length);
  if (start === -1 || start - markerAt > 50) return [];

  const scanEnd = Math.min(html.length, start + MAX_PRELOADER_SCAN_CHARS);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let arrayText: string | null = null;
  for (let i = start; i < scanEnd; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        arrayText = html.slice(start, i + 1);
        break;
      }
    }
  }
  if (arrayText === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const candidates: FacebookDocIdCandidate[] = [];
  for (const entry of parsed) {
    if (candidates.length >= 50) break;
    if (!isPlainObject(entry)) continue;
    const queryName = readString(entry.queryName);
    const queryID = readString(entry.queryID);
    if (!queryName || !queryID || !/^\d{4,}$/.test(queryID)) continue;
    const candidate: FacebookDocIdCandidate = { queryName, queryID };
    if (isPlainObject(entry.variables)) candidate.variables = entry.variables;
    candidates.push(candidate);
  }
  return candidates;
}

export function selectFacebookDetailDocId(
  candidates: FacebookDocIdCandidate[],
): FacebookDocIdCandidate | null {
  return (
    candidates.find((entry) => entry.queryName === FACEBOOK_DETAIL_QUERY_NAME) ??
    candidates.find((entry) => /MarketplacePDP/i.test(entry.queryName)) ??
    null
  );
}

export function selectFacebookImagesDocId(
  candidates: FacebookDocIdCandidate[],
): FacebookDocIdCandidate | null {
  return (
    candidates.find((entry) => entry.queryName === FACEBOOK_IMAGES_QUERY_NAME) ??
    candidates.find(
      (entry) => /MarketplacePDP/i.test(entry.queryName) && /Media|Image/i.test(entry.queryName),
    ) ??
    null
  );
}

// ---------------------------------------------------------------------------
// GraphQL answer decoding (XSSI prefix, deferred/extra data)
// ---------------------------------------------------------------------------

export type FacebookGraphqlBodyKind = "xssi-json" | "json" | "html" | "empty" | "other";

export interface FacebookGraphqlDecoded {
  kind: FacebookGraphqlBodyKind;
  json: Record<string, unknown> | null;
}

const XSSI_PREFIX = "for (;;);";

/** First balanced JSON object in a text, string-aware. */
function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return isPlainObject(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Decodes a GraphQL answer without ever throwing: Facebook may serve an XSSI
 * prefixed document, a single JSON object, or a deferred multi-line answer
 * whose first object is the result.
 */
export function decodeFacebookGraphqlBody(text: string): FacebookGraphqlDecoded {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty", json: null };

  const body = trimmed.startsWith(XSSI_PREFIX)
    ? trimmed.slice(XSSI_PREFIX.length)
    : trimmed;

  const head = body.trimStart().slice(0, 15);
  const kind: FacebookGraphqlBodyKind = trimmed.startsWith(XSSI_PREFIX)
    ? "xssi-json"
    : head.startsWith("{")
      ? "json"
      : head.startsWith("<")
        ? "html"
        : "other";

  const attempt = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(body) ?? attempt(body.split("\n")[0] ?? "");
  return { kind, json: direct ?? parseFirstJsonObject(body) };
}

// ---------------------------------------------------------------------------
// Listing-detail response parsing with strict identity validation
// ---------------------------------------------------------------------------

export type FacebookStructuredRejectReason =
  | "malformed"
  | "facebook-error"
  | "no-data"
  | "no-target"
  | "missing-listing-id"
  | "id-mismatch"
  | "conflicting-ids";

export interface FacebookStructuredVehicleFields {
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: string;
  transmission?: string;
  fuel?: string;
}

export interface FacebookStructuredAttribute {
  name: string;
  value: string;
}

export interface FacebookStructuredListing {
  id: string;
  title: string;
  description: string;
  descriptionLength: number;
  priceFormatted: string;
  priceAmount: string | null;
  currency: string | null;
  originalPriceFormatted: string | null;
  location: string;
  condition: string | null;
  category: string | null;
  attributes: FacebookStructuredAttribute[];
  vehicle: FacebookStructuredVehicleFields;
  delivery: string[];
  creationTimeUnix: number | null;
  creationTimeIso: string | null;
  status: "available" | "pending" | "sold" | "unavailable";
  url: string;
  photoCount: number;
  photos: string[];
  tiedToRequestedId: true;
}

export interface FacebookStructuredAccepted {
  status: "accepted";
  listing: FacebookStructuredListing;
  detailTargetCount: number;
  otherListingObjectCount: number;
  graphQLErrorCount: number;
}

export interface FacebookStructuredRejected {
  status: "rejected";
  reason: FacebookStructuredRejectReason;
  facebookErrorCode?: string;
  facebookErrorSummary?: string;
  detailTargetCount?: number;
}

export type FacebookStructuredParseResult =
  | FacebookStructuredAccepted
  | FacebookStructuredRejected;

/** Numeric listing ids Facebook serves as strings (or bare numbers). */
export function readFacebookListingId(value: unknown): string | null {
  const text = readString(value);
  if (text && /^\d{4,}$/.test(text)) return text;
  return null;
}

function collectDetailTargets(root: unknown): Record<string, unknown>[] {
  const targets: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let budget = 30_000;
  while (queue.length > 0 && targets.length < 10 && budget > 0) {
    budget -= 1;
    const entry = queue.shift();
    if (!entry) break;
    const { value, depth } = entry;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) {
        if (item && typeof item === "object") queue.push({ value: item, depth: depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (!child || typeof child !== "object") continue;
      if (key.includes("marketplace_product_details_page") && isPlainObject(child)) {
        const target = child.target;
        if (isPlainObject(target) && !seen.has(target)) {
          seen.add(target);
          targets.push(target);
        }
      }
      if (depth < 10) queue.push({ value: child, depth: depth + 1 });
    }
  }
  return targets;
}

function collectOtherListingObjects(
  root: unknown,
  targets: Record<string, unknown>[],
): number {
  const targetSet = new Set<unknown>(targets);
  let others = 0;
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let budget = 30_000;
  while (queue.length > 0 && budget > 0) {
    budget -= 1;
    const entry = queue.shift();
    if (!entry) break;
    const { value, depth } = entry;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) {
        if (item && typeof item === "object") queue.push({ value: item, depth: depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(value)) continue;
    if (readFacebookListingId(value.id) !== null && !targetSet.has(value)) {
      const looksLikeListing =
        "marketplace_listing_title" in value ||
        "base_marketplace_listing_title" in value ||
        "listing_price" in value;
      if (looksLikeListing) others += 1;
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object" && depth < 10) {
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return others;
}

function sanitizeFacebookErrorText(value: unknown, max: number): string | undefined {
  const text = readString(value);
  if (!text) return undefined;
  const cleaned = text.replace(/https?:\/\/\S+/g, "[url]").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned || undefined;
}

function firstGraphqlErrorMessage(json: Record<string, unknown>): string | undefined {
  const errors = json.errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const first = errors[0];
  if (isPlainObject(first)) return sanitizeFacebookErrorText(first.message, 160);
  return sanitizeFacebookErrorText(first, 160);
}

function facebookErrorCodeOf(json: Record<string, unknown>): string | undefined {
  const error = json.error;
  if (error === undefined || error === null) return undefined;
  if (typeof error === "string" || typeof error === "number") {
    const text = String(error).trim();
    return text.length > 40 ? "present" : text || "present";
  }
  if (isPlainObject(error)) {
    const code = readString(error.code);
    return code && code.length <= 40 ? code : "present";
  }
  return "present";
}

const VEHICLE_ATTRIBUTE_MAP: Array<{
  field: keyof FacebookStructuredVehicleFields;
  pattern: RegExp;
}> = [
  { field: "year", pattern: /\byear\b/i },
  { field: "make", pattern: /\b(?:make|manufacturer)\b/i },
  { field: "model", pattern: /\bmodel\b/i },
  { field: "trim", pattern: /\btrim\b/i },
  { field: "mileage", pattern: /\b(?:mileage|odometer|odo)\b/i },
  { field: "transmission", pattern: /\btransmission\b/i },
  { field: "fuel", pattern: /\bfuel\b/i },
];

function normalizePhotos(target: Record<string, unknown>): {
  photoCount: number;
  photos: string[];
} {
  const photos = target.listing_photos;
  if (!Array.isArray(photos)) return { photoCount: 0, photos: [] };
  const sample: string[] = [];
  for (const photo of photos.slice(0, 5)) {
    if (!isPlainObject(photo)) continue;
    const image = photo.image;
    if (!isPlainObject(image)) continue;
    const uri = readString(image.uri);
    if (!uri) continue;
    const safe = facebookStructuredSafeUrl(uri);
    if (safe) sample.push(safe);
  }
  return { photoCount: photos.length, photos: sample };
}

/** Status precedence mirrors the marketplace contract: sold > pending > off-shelf. */
function normalizeStatus(target: Record<string, unknown>): FacebookStructuredListing["status"] {
  if (target.is_sold === true) return "sold";
  if (target.is_pending === true) return "pending";
  if (target.is_live === false) return "unavailable";
  return "available";
}

function normalizeCreationTime(target: Record<string, unknown>): {
  unix: number | null;
  iso: string | null;
} {
  const raw = target.creation_time;
  const unix = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  if (unix === null) return { unix: null, iso: null };
  try {
    const iso = new Date(unix * 1000).toISOString();
    return { unix, iso };
  } catch {
    return { unix, iso: null };
  }
}

/**
 * Normalizes a detail target into bounded public listing fields. Vehicle
 * attributes (year/make/model/trim/mileage/transmission/fuel) are read from
 * Facebook's structured `attribute_data` pairs — never scraped from free
 * text — and every string is length-capped.
 */
export function normalizeFacebookStructuredListing(
  target: Record<string, unknown>,
  requestedItemId: string,
): FacebookStructuredListing {
  const title = readString(target.marketplace_listing_title) ??
    readString(target.base_marketplace_listing_title) ?? "";

  const descriptionRaw = isPlainObject(target.redacted_description)
    ? readString(target.redacted_description.text) ?? ""
    : "";

  const price = isPlainObject(target.listing_price) ? target.listing_price : {};
  const strikethrough = isPlainObject(target.strikethrough_price)
    ? target.strikethrough_price
    : {};

  const location = isPlainObject(target.location_text)
    ? readString(target.location_text.text) ?? ""
    : "";

  const attributes: FacebookStructuredAttribute[] = [];
  const vehicle: FacebookStructuredVehicleFields = {};
  let condition: string | null = null;

  const attributeData = Array.isArray(target.attribute_data)
    ? target.attribute_data.slice(0, 40)
    : [];
  for (const entry of attributeData) {
    if (!isPlainObject(entry)) continue;
    const name = readString(entry.attribute_name) ?? readString(entry.key) ?? "";
    const value = readString(entry.label) ?? readString(entry.value) ?? "";
    if (!name || !value) continue;
    if (attributes.length < 20) {
      attributes.push({ name: capped(name, 60), value: capped(value, 120) });
    }
    if (/^condition$/i.test(name)) {
      condition = capped(value, 60);
      continue;
    }
    for (const mapping of VEHICLE_ATTRIBUTE_MAP) {
      if (vehicle[mapping.field] === undefined && mapping.pattern.test(name)) {
        vehicle[mapping.field] = capped(value, 60);
      }
    }
  }

  const renderable = isPlainObject(target.marketplaceListingRenderableIfLoggedOut)
    ? target.marketplaceListingRenderableIfLoggedOut
    : {};
  const category = readString(renderable.marketplace_listing_category_name);

  const delivery = (Array.isArray(target.delivery_types) ? target.delivery_types : [])
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null)
    .slice(0, 10)
    .map((entry) => capped(entry, 40));

  const creation = normalizeCreationTime(target);
  const id = readFacebookListingId(target.id) ?? requestedItemId;
  const { photoCount, photos } = normalizePhotos(target);

  return {
    id,
    title: capped(title, 200),
    description: capped(descriptionRaw, 400),
    descriptionLength: descriptionRaw.length,
    priceFormatted: capped(
      price.formatted_amount_zeros_stripped ?? price.formatted_amount ?? "",
      60,
    ),
    priceAmount: readString(price.amount),
    currency: readString(price.currency),
    originalPriceFormatted: capped(
      strikethrough.formatted_amount_zeros_stripped ??
        strikethrough.formatted_amount ??
        "",
      60,
    ),
    location: capped(location, 120),
    condition,
    category: capped(category ?? "", 80) || null,
    attributes,
    vehicle,
    delivery,
    creationTimeUnix: creation.unix,
    creationTimeIso: creation.iso,
    status: normalizeStatus(target),
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    photoCount,
    photos,
    tiedToRequestedId: true,
  };
}

/**
 * Parses a listing-detail GraphQL answer.
 *
 * Acceptance requires a detail target whose own id equals `requestedItemId`.
 * Everything else is a labelled rejection: malformed answers, Facebook error
 * envelopes, missing targets, missing ids, mismatched ids and conflicting
 * ids across detail targets. Ids that appear only inside URLs (login
 * `next=` parameters, redirects) are structurally incapable of acceptance
 * because only the target's `id` field is ever consulted.
 */
export function parseFacebookMarketplaceDetailResponse(
  json: Record<string, unknown> | null,
  requestedItemId: string,
): FacebookStructuredParseResult {
  if (!isPlainObject(json)) return { status: "rejected", reason: "malformed" };

  const targets = collectDetailTargets(json.data ?? null);
  const graphQLErrorCount = Array.isArray(json.errors) ? json.errors.length : 0;

  if (targets.length === 0) {
    const code = facebookErrorCodeOf(json);
    const summary =
      sanitizeFacebookErrorText(json.errorSummary, 160) ?? firstGraphqlErrorMessage(json);
    if (code !== undefined || summary !== undefined) {
      const rejected: FacebookStructuredRejected = { status: "rejected", reason: "facebook-error" };
      if (code !== undefined) rejected.facebookErrorCode = code;
      if (summary !== undefined) rejected.facebookErrorSummary = summary;
      return rejected;
    }
    if (graphQLErrorCount > 0) {
      const rejected: FacebookStructuredRejected = { status: "rejected", reason: "facebook-error" };
      const summaryOnly = firstGraphqlErrorMessage(json);
      if (summaryOnly !== undefined) rejected.facebookErrorSummary = summaryOnly;
      return rejected;
    }
    if (!("data" in json)) return { status: "rejected", reason: "no-data" };
    return { status: "rejected", reason: "no-target", detailTargetCount: 0 };
  }

  // The canonical path is authoritative when present; otherwise the first
  // detail target found. This is the object that claims to answer the
  // `targetId` we requested, so its id is the only identity evidence.
  const canonicalPath =
    isPlainObject(json.data) &&
    isPlainObject(json.data.viewer) &&
    isPlainObject(json.data.viewer.marketplace_product_details_page) &&
    isPlainObject(json.data.viewer.marketplace_product_details_page.target)
      ? json.data.viewer.marketplace_product_details_page.target
      : null;
  const primary = canonicalPath ?? targets[0];
  if (!primary) return { status: "rejected", reason: "no-target", detailTargetCount: targets.length };

  const primaryId = readFacebookListingId(primary.id);
  if (primaryId === null) {
    return { status: "rejected", reason: "missing-listing-id", detailTargetCount: targets.length };
  }
  if (primaryId !== requestedItemId) {
    return { status: "rejected", reason: "id-mismatch", detailTargetCount: targets.length };
  }

  for (const target of targets) {
    const otherId = readFacebookListingId(target.id);
    if (otherId !== null && otherId !== primaryId) {
      return {
        status: "rejected",
        reason: "conflicting-ids",
        detailTargetCount: targets.length,
      };
    }
  }

  const listing = normalizeFacebookStructuredListing(primary, requestedItemId);
  if (listing.id !== requestedItemId) {
    // Normalization can never rename the id; this guards future edits.
    return { status: "rejected", reason: "id-mismatch", detailTargetCount: targets.length };
  }

  const dataRoot = json.data ?? null;
  return {
    status: "accepted",
    listing,
    detailTargetCount: targets.length,
    otherListingObjectCount: collectOtherListingObjects(dataRoot, targets),
    graphQLErrorCount,
  };
}

// ---------------------------------------------------------------------------
// Photos query answer
// ---------------------------------------------------------------------------

export type FacebookStructuredPhotosResult =
  | { status: "accepted"; photoCount: number; photos: string[] }
  | { status: "rejected"; reason: FacebookStructuredRejectReason };

/**
 * Parses the listing-images query answer. Same identity rule: the target's
 * own id must equal the requested item id before any photo is surfaced.
 */
export function parseFacebookListingPhotosResponse(
  json: Record<string, unknown> | null,
  requestedItemId: string,
): FacebookStructuredPhotosResult {
  if (!isPlainObject(json)) return { status: "rejected", reason: "malformed" };
  const targets = collectDetailTargets(json.data ?? null);
  if (targets.length === 0) {
    if (!("data" in json) || facebookErrorCodeOf(json) !== undefined || Array.isArray(json.errors)) {
      return { status: "rejected", reason: "facebook-error" };
    }
    return { status: "rejected", reason: "no-target" };
  }
  const canonicalPath =
    isPlainObject(json.data) &&
    isPlainObject(json.data.viewer) &&
    isPlainObject(json.data.viewer.marketplace_product_details_page) &&
    isPlainObject(json.data.viewer.marketplace_product_details_page.target)
      ? json.data.viewer.marketplace_product_details_page.target
      : targets[0];
  const id = readFacebookListingId(canonicalPath.id);
  if (id === null) return { status: "rejected", reason: "missing-listing-id" };
  if (id !== requestedItemId) return { status: "rejected", reason: "id-mismatch" };
  const { photoCount, photos } = normalizePhotos(canonicalPath);
  return { status: "accepted", photoCount, photos };
}

// ---------------------------------------------------------------------------
// Detail-query variables (Facebook's own logged-out PDP request shape)
// ---------------------------------------------------------------------------

/**
 * The variables Facebook's logged-out PDP page sends for a listing-detail
 * query. Verified live 2026-10-01: without the `__relay_internal__pv__*`
 * provider flags Facebook answers with `missing_required_variable_value`
 * errors alongside partial data; with them the answer is clean.
 */
export function buildFacebookDetailVariables(itemId: string): Record<string, unknown> {
  return {
    feedbackSource: 56,
    feedLocation: "MARKETPLACE_MEGAMALL",
    scale: 2,
    targetId: itemId,
    useDefaultActor: false,
    __relay_internal__pv__ShouldUpdateMarketplaceBoostListingBoostedStatusrelayprovider: false,
    __relay_internal__pv__CometUFISingleLineUFIrelayprovider: false,
    __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
    __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
    __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
    __relay_internal__pv__IsWorkUserrelayprovider: false,
    __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: false,
    __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: false,
    __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: false,
  };
}

/** Count of populated top-level fields in a normalized listing (for output). */
export function countFacebookStructuredFields(listing: FacebookStructuredListing): number {
  let count = 0;
  const bump = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.trim()) count += 1;
      return;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) count += 1;
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) count += 1;
      return;
    }
    if (typeof value === "object") {
      if (Object.keys(value as object).length > 0) count += 1;
    }
  };
  bump(listing.id);
  bump(listing.title);
  bump(listing.description);
  bump(listing.priceFormatted);
  bump(listing.priceAmount);
  bump(listing.currency);
  bump(listing.location);
  bump(listing.condition);
  bump(listing.category);
  bump(listing.attributes);
  bump(Object.keys(listing.vehicle).length > 0 ? listing.vehicle : null);
  bump(listing.delivery);
  bump(listing.creationTimeUnix);
  bump(listing.status);
  bump(listing.photoCount > 0 ? listing.photoCount : null);
  return count;
}
