import { emptyIntake, extractListing } from "./listingExtraction";
import type { VehicleIntake } from "../types/domain";
export const exampleListingText =
  "2017 Mazda3 GS. 168,000 km. $8,900 CAD. Located in Laval. Private seller. Winter tires included. Selling because we bought an SUV. Inspection welcome. No trades.";
export const demoVehicleIntake: VehicleIntake = {
  ...emptyIntake,
  ...extractListing(exampleListingText).details,
  listingText: exampleListingText,
  submittedAt: "2026-09-10T12:00:00.000Z",
};
export { faqItems } from "../content/faq";
