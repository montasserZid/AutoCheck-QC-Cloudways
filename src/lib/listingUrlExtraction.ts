import type { VehicleIntake, SellerType } from "../types/domain";
import { extractListing } from "./listingExtraction";

export type ExtractionSource =
  | "json-ld"
  | "structured-data"
  | "meta"
  | "html"
  | "facebook-rendered"
  | "url";

export type ListingField = keyof VehicleIntake;

export interface FieldProvenance {
  value: string | number | null;
  source: ExtractionSource;
}

export interface ListingUrlExtraction {
  details: Partial<VehicleIntake>;
  found: string[];
  uncertain: string[];
  provenance: Partial<Record<ListingField, FieldProvenance>>;
  methods: ExtractionSource[];
}

const meaningfulFields: ListingField[] = [
  "year",
  "make",
  "model",
  "trim",
  "mileageKm",
  "askingPriceCad",
  "vin",
  "transmission",
  "drivetrain",
  "engine",
  "city",
  "location",
  "sellerName",
  "sellerType",
  "sellerDescription",
  "listingTitle",
  "listingSource",
  "listingUrl",
];

const vehicleMakes = [
  "Acura",
  "Audi",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Ford",
  "Genesis",
  "GMC",
  "Honda",
  "Hyundai",
  "Infiniti",
  "Jaguar",
  "Jeep",
  "Kia",
  "Land Rover",
  "Lexus",
  "Lincoln",
  "Mazda",
  "Mercedes-Benz",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Porsche",
  "Ram",
  "Subaru",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
] as const;

const trimWords = new Set([
  "awd",
  "fwd",
  "rwd",
  "4wd",
  "auto",
  "automatic",
  "manual",
  "sedan",
  "coupe",
  "hatchback",
  "wagon",
  "suv",
  "truck",
  "van",
  "used",
  "certified",
  "new",
  "for",
  "sale",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? decodeEntities(value)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

export function normalizeListingNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[^\d.,\s\u00a0\u202f-]/g, "")
    .replace(/[ \u00a0\u202f]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInteger(value: unknown): number | null {
  const parsed = normalizeListingNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

export function normalizeListingVin(value: unknown): string {
  const vin = cleanText(value).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : "";
}

function hostSource(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function addListingField<K extends ListingField>(
  result: ListingUrlExtraction,
  key: K,
  value: VehicleIntake[K] | undefined | null,
  source: ExtractionSource,
) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "number" && !Number.isFinite(value)) return;
  if (result.details[key] !== undefined && result.details[key] !== "") return;
  Object.assign(result.details, { [key]: value });
  result.provenance[key] = { value: value as string | number | null, source };
  if (!result.methods.includes(source)) result.methods.push(source);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function typeMatches(value: unknown, names: string[]) {
  return asArray(value).some(
    (v) =>
      typeof v === "string" &&
      names.some((name) => v.toLowerCase().includes(name.toLowerCase())),
  );
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return cleanText(String(value));
  const obj = getObject(value);
  if (!obj) return "";
  for (const key of ["name", "value", "description", "addressLocality"]) {
    const text = getText(obj[key]);
    if (text) return text;
  }
  return "";
}

export function extractListingIdentity(text: string): Partial<VehicleIntake> {
  const normalized = cleanText(text);
  const lower = normalized.toLowerCase();
  const year = normalized.match(/\b((?:19|20)\d{2})\b/)?.[1];
  const make = vehicleMakes.find((candidate) =>
    new RegExp(`\\b${candidate.replace("-", "[- ]")}\\b`, "i").test(
      normalized,
    ),
  );
  if (!make) return year ? { year: Number(year) } : {};

  const index = lower.search(
    new RegExp(`\\b${make.toLowerCase().replace("-", "[- ]")}\\b`),
  );
  const afterMake = normalized.slice(index + make.length).trim();
  const tokens = afterMake
    .split(/[\s,|/()]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => !trimWords.has(v.toLowerCase()));
  const modelTokens =
    tokens[0] && /^\d+$/.test(tokens[0]) && /^series$/i.test(tokens[1] ?? "")
      ? tokens.slice(0, 2)
      : tokens.slice(0, 1);
  const model = modelTokens.join(" ").replace(/[.:;]+$/, "");
  const trim = tokens.slice(modelTokens.length, modelTokens.length + 3).join(" ").replace(/[.:;]+$/, "");
  return {
    ...(year ? { year: Number(year) } : {}),
    make,
    ...(model ? { model } : {}),
    ...(trim ? { trim } : {}),
  };
}

function extractMileage(
  value: unknown,
): { value: number; unit: "km" | "mi" | "unknown" } | null {
  const text = getText(value);
  const obj = getObject(value);
  const unitText = `${getText(obj?.unitText)} ${getText(obj?.unitCode)} ${text}`;
  const number = normalizeInteger(obj?.value ?? text);
  if (number === null) return null;
  if (/\b(km|kilometres|kilometers|kmt)\b/i.test(unitText))
    return { value: number, unit: "km" };
  if (/\b(mi|mile|miles|smi)\b/i.test(unitText))
    return { value: number, unit: "mi" };
  return { value: number, unit: "unknown" };
}

function normalizePriceCurrency(value: unknown): string {
  const currency = cleanText(value).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

function maybeSellerType(text: string): SellerType | "" {
  if (/\b(dealer|dealership|concessionnaire)\b/i.test(text)) return "dealer";
  if (/\b(private seller|private sale|owner|particulier)\b/i.test(text))
    return "private";
  return "";
}

function mergeTextExtraction(
  result: ListingUrlExtraction,
  text: string,
  source: ExtractionSource,
) {
  const extracted = extractListing(text);
  for (const [key, value] of Object.entries(extracted.details)) {
    addListingField(result, key as ListingField, value as never, source);
  }
  for (const key of extracted.uncertain) {
    if (!result.uncertain.includes(key)) result.uncertain.push(key);
  }
}

function mergeIdentity(
  result: ListingUrlExtraction,
  text: string,
  source: ExtractionSource,
) {
  const identity = extractListingIdentity(text);
  for (const [key, value] of Object.entries(identity)) {
    addListingField(result, key as ListingField, value as never, source);
  }
}

function extractAddress(value: unknown): string {
  const obj = getObject(value);
  if (!obj) return getText(value);
  const parts = [
    getText(obj.streetAddress),
    getText(obj.addressLocality),
    getText(obj.addressRegion),
    getText(obj.postalCode),
    getText(obj.addressCountry),
  ].filter(Boolean);
  return parts.join(", ");
}

function extractVehicleObject(
  result: ListingUrlExtraction,
  obj: Record<string, unknown>,
  source: ExtractionSource,
) {
  const name = getText(obj.name);
  const description = getText(obj.description);
  const title = name || getText(obj.title);
  if (title) {
    addListingField(result, "listingTitle", title, source);
    mergeIdentity(result, title, source);
  }
  if (description) {
    addListingField(result, "sellerDescription", description.slice(0, 4000), source);
    mergeTextExtraction(result, description, source);
  }

  const brand = getText(obj.brand) || getText(obj.manufacturer);
  const model = getText(obj.model) || getText(obj.vehicleModel);
  addListingField(result, "make", brand, source);
  addListingField(result, "model", model, source);
  addListingField(result, "trim", getText(obj.vehicleConfiguration), source);

  const year =
    normalizeInteger(obj.vehicleModelDate) ??
    normalizeInteger(obj.modelDate) ??
    normalizeInteger(obj.productionDate) ??
    normalizeInteger(obj.releaseDate);
  if (year && year >= 1980 && year <= new Date().getFullYear() + 1)
    addListingField(result, "year", year, source);

  const vin =
    normalizeListingVin(obj.vehicleIdentificationNumber) ||
    normalizeListingVin(obj.vehicleIdentificationId) ||
    normalizeListingVin(obj.vin);
  addListingField(result, "vin", vin, source);

  const mileage = extractMileage(
    obj.mileageFromOdometer ?? obj.vehicleMileage ?? obj.mileage,
  );
  if (mileage) {
    addListingField(result, "mileageUnit", mileage.unit, source);
    if (mileage.unit === "km") addListingField(result, "mileageKm", mileage.value, source);
  }

  addListingField(result, "transmission", getText(obj.vehicleTransmission), source);
  addListingField(result, "drivetrain", getText(obj.driveWheelConfiguration), source);
  addListingField(result, "engine", getText(obj.vehicleEngine), source);

  const location =
    extractAddress(obj.availableAtOrFrom) ||
    extractAddress(obj.itemLocation) ||
    extractAddress(obj.address);
  addListingField(result, "location", location, source);
  const city = getText(getObject(obj.address)?.addressLocality);
  addListingField(result, "city", city, source);

  const seller = getObject(obj.seller) ?? getObject(obj.offeredBy);
  if (seller) {
    addListingField(result, "sellerName", getText(seller.name), source);
    const sellerType = maybeSellerType(getText(seller["@type"]));
    if (sellerType) addListingField(result, "sellerType", sellerType, source);
  }

  for (const offer of asArray(obj.offers)) {
    const offerObject = getObject(offer);
    if (!offerObject) continue;
    const price = normalizeListingNumber(offerObject.price ?? offerObject.lowPrice);
    const currency = normalizePriceCurrency(offerObject.priceCurrency);
    addListingField(result, "priceCurrency", currency, source);
    if (price !== null && (!currency || currency === "CAD"))
      addListingField(result, "askingPriceCad", price, source);
    const sellerObject = getObject(offerObject.seller);
    if (sellerObject) addListingField(result, "sellerName", getText(sellerObject.name), source);
  }
}

function traverseStructured(
  value: unknown,
  result: ListingUrlExtraction,
  source: ExtractionSource,
  depth = 0,
) {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => traverseStructured(entry, result, source, depth + 1));
    return;
  }
  const obj = getObject(value);
  if (!obj) return;

  if (
    typeMatches(obj["@type"], ["Vehicle", "Car", "Product"]) ||
    obj.offers ||
    obj.vehicleIdentificationNumber ||
    obj.mileageFromOdometer
  ) {
    extractVehicleObject(result, obj, source);
  }

  for (const key of [
    "@graph",
    "mainEntity",
    "itemListElement",
    "item",
    "vehicle",
    "product",
    "about",
  ])
    traverseStructured(obj[key], result, source, depth + 1);
}

function parseJsonLd(html: string, result: ListingUrlExtraction) {
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    const raw = decodeEntities(match[1]).replace(/^\s*<!--|-->\s*$/g, "");
    try {
      traverseStructured(JSON.parse(raw), result, "json-ld");
    } catch {
      if (!result.uncertain.includes("json-ld"))
        result.uncertain.push("json-ld");
    }
  }
}

function parseEmbeddedJson(html: string, result: ListingUrlExtraction) {
  const scripts = html.matchAll(
    /<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    const content = match[1];
    if (!/(vehicle|vin|mileage|odometer|price|offers?)/i.test(content))
      continue;
    const jsonMatches = content.matchAll(/({[\s\S]{80,20000}}|\[[\s\S]{80,20000}\])/g);
    for (const jsonMatch of jsonMatches) {
      try {
        traverseStructured(JSON.parse(jsonMatch[1]), result, "structured-data");
      } catch {
        // Remote JavaScript is never executed; only standalone JSON parses count.
      }
    }
  }
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-z_:.-]+)\s*=\s*(["'])(.*?)\2/gi)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[3]);
  }
  return attrs;
}

function parseMeta(html: string, result: ListingUrlExtraction) {
  const meta: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content) meta[key] = cleanText(attrs.content);
  }
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const listingTitle =
    meta["og:title"] || meta["twitter:title"] || meta.title || title;
  const description =
    meta["og:description"] ||
    meta["twitter:description"] ||
    meta.description ||
    "";
  addListingField(result, "listingTitle", listingTitle, "meta");
  addListingField(result, "sellerDescription", description.slice(0, 4000), "meta");
  mergeIdentity(result, `${listingTitle} ${description}`, "meta");
  mergeTextExtraction(result, `${listingTitle}\n${description}`, "meta");
}

function textFromHtml(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/dd|\/dt|\/th|\/td)\b[^>]*>/gi, "\n"),
  );
}

function parseLabelValueHtml(html: string, result: ListingUrlExtraction) {
  const pairs: [string, string][] = [];
  for (const match of html.matchAll(
    /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
  ))
    pairs.push([cleanText(match[1]), cleanText(match[2])]);
  for (const match of html.matchAll(
    /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
  ))
    pairs.push([cleanText(match[1]), cleanText(match[2])]);

  const plain = textFromHtml(html);
  for (const match of plain.matchAll(
    /\b(VIN|Mileage|Odometer|Kilometres|Kilometers|Price|Transmission|Drivetrain|Drive train|Engine|Location|City|Dealer|Seller)\b\s*[:\-]\s*([^\n]{2,120})/gi,
  ))
    pairs.push([match[1], match[2]]);

  for (const [label, value] of pairs) {
    if (!label || !value) continue;
    if (/vin/i.test(label)) addListingField(result, "vin", normalizeListingVin(value), "html");
    else if (/mileage|odometer|kilomet/i.test(label)) {
      const mileage = extractMileage(`${value} ${/kilomet/i.test(label) ? "km" : ""}`);
      if (mileage) {
        addListingField(result, "mileageUnit", mileage.unit, "html");
        if (mileage.unit === "km")
          addListingField(result, "mileageKm", mileage.value, "html");
      }
    } else if (/price/i.test(label)) {
      const currency = /\bCAD\b|C\$/i.test(value) ? "CAD" : "";
      const price = normalizeListingNumber(value);
      addListingField(result, "priceCurrency", currency, "html");
      if (price !== null && (!currency || currency === "CAD"))
        addListingField(result, "askingPriceCad", price, "html");
    } else if (/transmission/i.test(label))
      addListingField(result, "transmission", cleanText(value), "html");
    else if (/drive/i.test(label))
      addListingField(result, "drivetrain", cleanText(value), "html");
    else if (/engine/i.test(label)) addListingField(result, "engine", cleanText(value), "html");
    else if (/location/i.test(label))
      addListingField(result, "location", cleanText(value), "html");
    else if (/city/i.test(label)) addListingField(result, "city", cleanText(value), "html");
    else if (/dealer|seller/i.test(label)) {
      addListingField(result, "sellerName", cleanText(value), "html");
      const sellerType = maybeSellerType(`${label} ${value}`);
      if (sellerType) addListingField(result, "sellerType", sellerType, "html");
    }
  }
}

export function extractListingFromHtml(
  html: string,
  listingUrl: string,
): ListingUrlExtraction {
  const result: ListingUrlExtraction = {
    details: {},
    found: [],
    uncertain: [],
    provenance: {},
    methods: [],
  };

  addListingField(result, "listingUrl", listingUrl, "url");
  addListingField(result, "listingSource", hostSource(listingUrl), "url");
  parseJsonLd(html, result);
  parseEmbeddedJson(html, result);
  parseMeta(html, result);
  parseLabelValueHtml(html, result);

  const text = textFromHtml(html);
  mergeTextExtraction(result, text.slice(0, 20000), "html");
  mergeIdentity(result, text.slice(0, 2000), "html");

  result.found = meaningfulFields.filter((field) => {
    const value = result.details[field];
    return value !== undefined && value !== null && value !== "";
  });
  result.uncertain = [...new Set(result.uncertain)];
  return result;
}

