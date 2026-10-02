import type { VehicleIntake } from "@/types/domain";

export const FINALIZED_INTAKE_LIMITS = {
  bodyBytes: 48_000,
  listingText: 20_000,
  sellerDescription: 4_000,
  make: 100,
  model: 100,
  trim: 100,
  title: 300,
  sellerName: 150,
  city: 150,
  location: 300,
  vehicleDetail: 150,
  photoName: 150,
  photos: 6,
} as const;

export type FinalizedIntake = Pick<
  VehicleIntake,
  | "listingUrl"
  | "listingSource"
  | "listingTitle"
  | "sellerName"
  | "listingText"
  | "make"
  | "model"
  | "year"
  | "trim"
  | "mileageKm"
  | "mileageUnit"
  | "askingPriceCad"
  | "priceCurrency"
  | "city"
  | "location"
  | "sellerType"
  | "vin"
  | "transmission"
  | "drivetrain"
  | "engine"
  | "accidentHistoryMentioned"
  | "rebuiltStatus"
  | "maintenanceRecords"
  | "carfaxStatus"
  | "inspectionAllowed"
  | "sellerDescription"
  | "photos"
  | "preferredLanguage"
>;

export interface FinalizeIntakeRequest {
  submissionKey: string;
  intake: FinalizedIntake;
}

export interface FinalizedIntakeValue {
  submissionKey: string;
  intake: Omit<FinalizedIntake, "priceCurrency" | "vin"> & { priceCurrency: string; vin: string | null };
}

type ValidationResult =
  | { ok: true; value: FinalizedIntakeValue }
  | { ok: false; fields: string[] };

const intakeKeys = [
  "listingUrl", "listingSource", "listingTitle", "sellerName", "listingText",
  "make", "model", "year", "trim", "mileageKm", "mileageUnit",
  "askingPriceCad", "priceCurrency", "city", "location", "sellerType", "vin",
  "transmission", "drivetrain", "engine", "accidentHistoryMentioned",
  "rebuiltStatus", "maintenanceRecords", "carfaxStatus", "inspectionAllowed",
  "sellerDescription", "photos", "preferredLanguage",
] as const;

const enumValues = {
  mileageUnit: ["km", "mi", "unknown"],
  sellerType: ["private", "dealer", "unknown"],
  mention: ["yes", "no", "unknown"],
  carfax: ["available", "not_available", "unknown"],
  language: ["en", "fr"],
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
  return normalized.length <= max ? normalized : null;
}
function optional(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return clean(value, max);
}
function validUrl(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
function oneOf(value: unknown, values: readonly string[]): value is string {
  return typeof value === "string" && values.includes(value);
}
function optionalInteger(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}
function optionalPrice(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10_000_000
    ? value
    : undefined;
}

/** Validates the small, explicit finalization DTO at the server trust boundary. */
export function validateFinalizedIntake(payload: unknown): ValidationResult {
  const root = record(payload);
  const fields: string[] = [];
  if (!root || Object.keys(root).some((key) => key !== "submissionKey" && key !== "intake"))
    return { ok: false, fields: ["request"] };
  const submissionKey = clean(root.submissionKey, 36);
  if (!submissionKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionKey))
    fields.push("submissionKey");
  const source = record(root.intake);
  if (!source || Object.keys(source).some((key) => !(intakeKeys as readonly string[]).includes(key)))
    return { ok: false, fields: ["intake"] };

  const make = clean(source.make, FINALIZED_INTAKE_LIMITS.make);
  const model = clean(source.model, FINALIZED_INTAKE_LIMITS.model);
  const listingText = clean(source.listingText, FINALIZED_INTAKE_LIMITS.listingText);
  const sellerDescription = clean(source.sellerDescription, FINALIZED_INTAKE_LIMITS.sellerDescription);
  if (!make) fields.push("make");
  if (!model) fields.push("model");
  if (listingText === null) fields.push("listingText");
  if (sellerDescription === null) fields.push("sellerDescription");
  const year = optionalInteger(source.year, 1980, new Date().getFullYear() + 1);
  const mileageKm = optionalInteger(source.mileageKm, 0, 2_000_000);
  const askingPriceCad = optionalPrice(source.askingPriceCad);
  if (year === undefined) fields.push("year");
  if (mileageKm === undefined) fields.push("mileageKm");
  if (askingPriceCad === undefined) fields.push("askingPriceCad");
  const vinValue = optional(source.vin, 17);
  const vin = vinValue === undefined ? null : vinValue?.toUpperCase();
  if (vinValue === null || (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))) fields.push("vin");
  const listingUrl = optional(source.listingUrl, 2048);
  if (listingUrl === null || !validUrl(listingUrl)) fields.push("listingUrl");
  const priceCurrencyValue = optional(source.priceCurrency, 3);
  const priceCurrency = priceCurrencyValue === undefined ? "CAD" : priceCurrencyValue?.toUpperCase();
  if (!priceCurrency || !/^[A-Z]{3}$/.test(priceCurrency)) fields.push("priceCurrency");
  const stringFields: Array<[keyof FinalizedIntake, number]> = [
    ["listingSource", FINALIZED_INTAKE_LIMITS.vehicleDetail], ["listingTitle", FINALIZED_INTAKE_LIMITS.title],
    ["sellerName", FINALIZED_INTAKE_LIMITS.sellerName], ["trim", FINALIZED_INTAKE_LIMITS.trim],
    ["city", FINALIZED_INTAKE_LIMITS.city], ["location", FINALIZED_INTAKE_LIMITS.location],
    ["transmission", FINALIZED_INTAKE_LIMITS.vehicleDetail], ["drivetrain", FINALIZED_INTAKE_LIMITS.vehicleDetail],
    ["engine", FINALIZED_INTAKE_LIMITS.vehicleDetail],
  ];
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, max] of stringFields) {
    const value = optional(source[key], max);
    if (value === null) fields.push(key);
    else cleaned[key] = value;
  }
  const mileageUnit = source.mileageUnit ?? "unknown";
  const sellerType = source.sellerType ?? "unknown";
  const accidentHistoryMentioned = source.accidentHistoryMentioned ?? "unknown";
  const rebuiltStatus = source.rebuiltStatus ?? "unknown";
  const maintenanceRecords = source.maintenanceRecords ?? "unknown";
  const carfaxStatus = source.carfaxStatus ?? "unknown";
  const inspectionAllowed = source.inspectionAllowed ?? "unknown";
  const preferredLanguage = source.preferredLanguage ?? "en";
  if (!oneOf(mileageUnit, enumValues.mileageUnit)) fields.push("mileageUnit");
  if (!oneOf(sellerType, enumValues.sellerType)) fields.push("sellerType");
  for (const [field, value] of [["accidentHistoryMentioned", accidentHistoryMentioned], ["rebuiltStatus", rebuiltStatus], ["maintenanceRecords", maintenanceRecords], ["inspectionAllowed", inspectionAllowed]] as const)
    if (!oneOf(value, enumValues.mention)) fields.push(field);
  if (!oneOf(carfaxStatus, enumValues.carfax)) fields.push("carfaxStatus");
  if (!oneOf(preferredLanguage, enumValues.language)) fields.push("preferredLanguage");
  const photos = source.photos;
  if (!Array.isArray(photos) || photos.length > FINALIZED_INTAKE_LIMITS.photos || photos.some((photo) => {
    const item = record(photo);
    return !item || !clean(item.name, FINALIZED_INTAKE_LIMITS.photoName) ||
      !["image/jpeg", "image/png", "image/webp"].includes(item.type as string) ||
      typeof item.size !== "number" || !Number.isInteger(item.size) || item.size < 0 || item.size > 10 * 1024 * 1024;
  })) fields.push("photos");
  if (fields.length) return { ok: false, fields: [...new Set(fields)] };
  return { ok: true, value: {
    submissionKey: submissionKey!,
    intake: {
      listingUrl: listingUrl ?? undefined, listingSource: cleaned.listingSource, listingTitle: cleaned.listingTitle, sellerName: cleaned.sellerName,
      listingText: listingText!, make: make!, model: model!, year: year as number | null, trim: cleaned.trim,
      mileageKm: mileageKm as number | null, mileageUnit: mileageUnit as FinalizedIntake["mileageUnit"],
      askingPriceCad: askingPriceCad as number | null, priceCurrency: priceCurrency!, city: cleaned.city ?? "",
      location: cleaned.location, sellerType: sellerType as FinalizedIntake["sellerType"], vin: vin ?? null,
      transmission: cleaned.transmission, drivetrain: cleaned.drivetrain, engine: cleaned.engine,
      accidentHistoryMentioned: accidentHistoryMentioned as FinalizedIntake["accidentHistoryMentioned"],
      rebuiltStatus: rebuiltStatus as FinalizedIntake["rebuiltStatus"], maintenanceRecords: maintenanceRecords as FinalizedIntake["maintenanceRecords"],
      carfaxStatus: carfaxStatus as FinalizedIntake["carfaxStatus"], inspectionAllowed: inspectionAllowed as FinalizedIntake["inspectionAllowed"],
      sellerDescription: sellerDescription!, photos: (photos as VehicleIntake["photos"]).map((photo) => ({ name: clean(photo.name, FINALIZED_INTAKE_LIMITS.photoName)!, type: photo.type, size: photo.size })),
      preferredLanguage: preferredLanguage as FinalizedIntake["preferredLanguage"],
    },
  }};
}

export function toFinalizedIntake(intake: VehicleIntake): FinalizedIntake {
  const { submittedAt: _submittedAt, ...value } = intake;
  return value;
}
