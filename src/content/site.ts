import type { SupportedLanguage } from "@/types/domain";

export const supportedLanguages: SupportedLanguage[] = ["en"];

export const siteConfig = {
  name: "AutoCheck QC",
  tagline: "Don't buy a used car blind.",
  region: "Montreal and Quebec",
  disclaimer:
    "A listing pre-screen does not replace an independent mechanical inspection. Seller claims, vehicle history and actual condition must be verified before buying.",
};

export const homeCopy = {
  en: {
    heroTitle: "Don't buy a used car blind.",
    heroSubtitle:
      "Paste the ad. Spot red flags, ask better questions and decide whether the car deserves a professional inspection.",
    primaryCta: "Check This Car",
    secondaryCta: "Book an Inspection",
  },
  fr: {
    heroTitle: "N'achetez pas une voiture usagee a l'aveugle.",
    heroSubtitle:
      "Collez l'annonce, le kilometrage, le prix et les photos. Recevez un rapport de risque clair avant de vous deplacer, negocier ou payer une inspection.",
    primaryCta: "Verifier cette auto",
    secondaryCta: "Reserver une inspection",
  },
};

export const platformLabels = [
  "Facebook Marketplace",
  "Kijiji",
  "AutoTrader",
  "dealer listings",
  "private seller listings",
];

export const officialSources = [
  {
    label: "SAAQ vehicle transfer guidance",
    href: "https://saaq.gouv.qc.ca/en/vehicle-registration/registering-vehicle/automobile-motor-home/passenger-vehicle-between-individuals",
  },
  {
    label: "Quebec consumer protection for used cars",
    href: "https://www.opc.gouv.qc.ca/en/consumer/topic/warranties/automobile/used-car",
  },
  {
    label: "Quebec vehicle purchase and leasing portal",
    href: "https://www.quebec.ca/en/transports/purchase-or-leasing-of-a-vehicle",
  },
];
