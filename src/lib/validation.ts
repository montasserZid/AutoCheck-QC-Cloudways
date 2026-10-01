import type { VehicleIntake, UploadedFileMeta } from "../types/domain";

export function validListingUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export const validVin = (value: string) =>
  !value || /^[A-HJ-NPR-Z0-9]{17}$/i.test(value);
export function validateIntake(value: VehicleIntake): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!value.make.trim()) errors.make = "Enter the vehicle make.";
  if (!value.model.trim()) errors.model = "Enter the model shown in the ad.";
  if (
    value.year !== null &&
    (!Number.isInteger(value.year) ||
      value.year < 1980 ||
      value.year > new Date().getFullYear() + 1)
  )
    errors.year = "Use a year from 1980 through next year, or leave unknown.";
  if (
    value.mileageKm !== null &&
    (!Number.isInteger(value.mileageKm) ||
      value.mileageKm < 0 ||
      value.mileageKm > 2000000)
  )
    errors.mileageKm =
      "Use a whole mileage between 0 and 2,000,000 km, or leave unknown.";
  if (
    value.askingPriceCad !== null &&
    (!Number.isFinite(value.askingPriceCad) ||
      value.askingPriceCad <= 0 ||
      value.askingPriceCad > 10000000)
  )
    errors.askingPriceCad = "Enter a positive asking price, or leave unknown.";
  if (!validVin(value.vin ?? ""))
    errors.vin =
      "Use 17 letters/numbers, excluding I, O and Q, or leave unknown.";
  if (!validListingUrl(value.listingUrl ?? ""))
    errors.listingUrl = "Use a complete http:// or https:// listing link.";
  return errors;
}
export function validatePhotos(files: UploadedFileMeta[]): string | null {
  if (files.length > 6) return "Add up to 6 images.";
  if (
    files.some(
      (f) => !["image/jpeg", "image/png", "image/webp"].includes(f.type),
    )
  )
    return "Choose JPG, PNG or WebP images.";
  if (files.some((f) => f.size > 10 * 1024 * 1024))
    return "Each image must be 10 MB or smaller.";
  return null;
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validateBooking(
  form: {
    buyerName: string;
    buyerPhone: string;
    buyerEmail: string;
    vehicleTitle: string;
    sellerContact: string;
    vehicleAddress: string;
    vehicleVin: string;
    preferredDate: string;
    preferredTime: string;
  },
  now = new Date(),
): string[] {
  const errors: string[] = [];
  if (!form.buyerName.trim()) errors.push("Enter your full name.");
  if (
    !/^[+\d\s().-]+$/.test(form.buyerPhone) ||
    form.buyerPhone.replace(/\D/g, "").length < 10 ||
    form.buyerPhone.replace(/\D/g, "").length > 15
  )
    errors.push("Enter a valid phone number with area code.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.buyerEmail))
    errors.push("Enter a valid email address.");
  if (!form.vehicleTitle.trim()) errors.push("Enter the vehicle.");
  if (!form.sellerContact.trim())
    errors.push("Enter seller contact information.");
  if (!form.vehicleAddress.trim())
    errors.push("Enter the inspection location.");
  if (!validVin(form.vehicleVin))
    errors.push("VIN must contain 17 letters/numbers, excluding I, O and Q.");
  const appointment = new Date(`${form.preferredDate}T${form.preferredTime}`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(form.preferredDate) ||
    !/^\d{2}:\d{2}$/.test(form.preferredTime) ||
    !Number.isFinite(appointment.getTime()) ||
    localDate(appointment) !== form.preferredDate ||
    appointment <= now
  )
    errors.push("Choose a future date and time.");
  return errors;
}
