import type { VehicleIntake, MentionStatus } from "../types/domain";

export type Extraction = {
  details: Partial<VehicleIntake>;
  found: string[];
  uncertain: string[];
};
export const emptyIntake: VehicleIntake = {
  listingUrl: "",
  listingSource: "",
  listingTitle: "",
  sellerName: "",
  listingText: "",
  year: null,
  make: "",
  model: "",
  trim: "",
  mileageKm: null,
  mileageUnit: "unknown",
  askingPriceCad: null,
  priceCurrency: "",
  city: "",
  location: "",
  vin: "",
  transmission: "",
  drivetrain: "",
  engine: "",
  sellerType: "unknown",
  accidentHistoryMentioned: "unknown",
  rebuiltStatus: "unknown",
  maintenanceRecords: "unknown",
  carfaxStatus: "unknown",
  inspectionAllowed: "unknown",
  sellerDescription: "",
  photos: [],
  preferredLanguage: "en",
  submittedAt: "",
};

const vehicles: [string, string, RegExp][] = [
  ["Honda", "Civic", /\bhonda\s+civic\b/i],
  ["Honda", "CR-V", /\bhonda\s+cr[ -]?v\b/i],
  ["Honda", "Odyssey", /\bhonda\s+odyssey\b/i],
  ["Toyota", "Corolla", /\btoyota\s+corolla\b/i],
  ["Toyota", "RAV4", /\btoyota\s+rav[ -]?4\b/i],
  ["Toyota", "Sienna", /\btoyota\s+sienna\b/i],
  ["Mazda", "Mazda3", /\bmazda\s*(?:mazda\s*)?3\b/i],
  ["Hyundai", "Elantra", /\bhyundai\s+elantra\b/i],
  ["Nissan", "Rogue", /\bnissan\s+rogue\b/i],
];
const normalize = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const amount = (value: string) =>
  Number(value.replace(/[ ,\u00a0\u202f]/g, ""));

// Extract explicit claims, not verified history. Conflicting or qualified claims stay unknown.
export function extractListing(text: string): Extraction {
  const t = normalize(text);
  const details: Partial<VehicleIntake> = {};
  const uncertain: string[] = [];
  function unique(key: keyof VehicleIntake, values: (string | number)[]) {
    const distinct = [...new Set(values)];
    if (distinct.length === 1) Object.assign(details, { [key]: distinct[0] });
    else if (distinct.length > 1) uncertain.push(key);
  }
  const matches = vehicles.filter(([, , re]) => re.test(t));
  if (matches.length === 1) {
    const [make, model, re] = matches[0];
    details.make = make;
    details.model = model;
    const match = re.exec(t)!;
    const before = t.slice(Math.max(0, match.index - 6), match.index);
    const after = t.slice(
      match.index + match[0].length,
      match.index + match[0].length + 65,
    );
    const years = [
      before.match(/\b((?:19|20)\d{2})\s*$/)?.[1],
      after.match(/^\s+((?:19|20)\d{2})\b/)?.[1],
    ]
      .filter(Boolean)
      .map(Number);
    unique("year", years);
    const trim = after.match(
      /^\s+(?:(?:19|20)\d{2}\s+)?(EX-L|EX|LX|LE|SE|XLE|XSE|GS|GX|GT|Touring|Sport|Si|SL|SV)\b/i,
    );
    if (trim) details.trim = trim[1];
  } else if (matches.length > 1)
    uncertain.push("make", "model", "year", "trim");
  else {
    const make = t.match(
      /\b(Honda|Toyota|Mazda|Hyundai|Nissan|Ford|Chevrolet|Kia|Subaru|Volkswagen|BMW|Audi|Volvo|Tesla)\b/i,
    );
    if (make) details.make = make[1];
  }
  if (!details.year && !uncertain.includes("year")) {
    unique(
      "year",
      [...t.matchAll(/\b(?:year|annee)\s*[:=]\s*((?:19|20)\d{2})\b/gi)].map(
        (m) => Number(m[1]),
      ),
    );
  }
  if (
    details.year &&
    (details.year < 1980 || details.year > new Date().getFullYear() + 1)
  ) {
    delete details.year;
    uncertain.push("year");
  }
  unique(
    "mileageKm",
    [
      ...t.matchAll(
        /(?<![-\d.])\b(\d{1,3}(?:[ ,\u00a0\u202f]\d{3})+|\d+)\s*(?:km|kilometres|kilometers)\b/gi,
      ),
    ].map((m) => amount(m[1])),
  );
  const prices = [
    ...t.matchAll(
      /\$\s*((?:\d{1,3}(?:[ ,\u00a0\u202f]\d{3})+|\d+)(?:\.\d{2})?)|(?<![-\d.])\b((?:\d{1,3}(?:[ ,\u00a0\u202f]\d{3})+|\d+)(?:\.\d{2})?)\s*(?:\$|CAD\b)/gi,
    ),
  ]
    .filter(
      (m) =>
        !/^(?:\s*\/?\s*(?:mo(?:nth)?|week|semaine|mois|biweekly)\b)/i.test(
          t.slice(m.index! + m[0].length),
        ),
    )
    .map((m) => amount(m[1] ?? m[2]));
  unique("askingPriceCad", prices);
  const cities = [
    "Montreal",
    "Laval",
    "Longueuil",
    "Brossard",
    "Boucherville",
    "Terrebonne",
    "Repentigny",
    "Dorval",
    "Blainville",
    "Mirabel",
    "Quebec",
    "Sherbrooke",
  ];
  unique(
    "city",
    cities.filter((city) => new RegExp(`\\b${city}\\b`, "i").test(t)),
  );
  unique(
    "vin",
    [...t.matchAll(/\bVIN\s*[:#-]?\s*([A-HJ-NPR-Z0-9]{17})\b/gi)].map((m) =>
      m[1].toUpperCase(),
    ),
  );
  if (/\bVIN\s*[:#-]/i.test(t) && !details.vin) uncertain.push("vin");
  const privateSeller =
    /\b(private seller|private sale|particulier|vente privee)\b/i.test(t);
  const dealer = /\b(dealer|dealership|concessionnaire|commercant)\b/i.test(t);
  if (privateSeller !== dealer)
    details.sellerType = privateSeller ? "private" : "dealer";
  else if (privateSeller) uncertain.push("sellerType");
  function claim(
    key: keyof VehicleIntake,
    negative: RegExp,
    positive: RegExp,
    topic: RegExp,
    map: (value: "yes" | "no") => string = (value) => value,
  ) {
    const clauses = t
      .split(/[\n.;!?]+|\bbut\b|\bmais\b/i)
      .filter((c) => topic.test(c));
    const values = new Set<MentionStatus>();
    for (const c of clauses) {
      if (
        /\b(unknown|unsure|not sure|maybe|inconnu|peut-etre|not confirmed|cannot confirm|can't confirm|no known|no major|no serious|not aware)\b/i.test(
          c,
        )
      )
        values.add("unknown");
      else {
        if (negative.test(c)) values.add("no");
        if (positive.test(c.replace(negative, ""))) values.add("yes");
      }
    }
    if (values.size === 1 && !values.has("unknown"))
      Object.assign(details, { [key]: map([...values][0] as "yes" | "no") });
    else if (clauses.length) uncertain.push(key);
  }
  claim(
    "accidentHistoryMentioned",
    /\b(no accident(?:s| history)?|never (?:had |been )?(?:in an? |an? )?accident|accident[ -]free|aucun accident|jamais accidente)\b/gi,
    /\b(accidents?|accidente)\b/i,
    /accident/i,
  );
  claim(
    "rebuiltStatus",
    /\b(not rebuilt|no (?:rebuilt|salvage)(?: title)?|jamais reconstruit)\b/gi,
    /\b(rebuilt|salvage|reconstruit|recupere)\b/i,
    /rebuilt|salvage|reconstruit|recupere/i,
  );
  claim(
    "inspectionAllowed",
    /\b(no inspections?|inspection (?:not allowed|refused)|refuse inspection|inspection refusee)\b/gi,
    /\b(inspection(?:s)? (?:welcome|accepted|allowed|acceptee|bienvenue)|inspection bienvenue)\b/i,
    /inspection/i,
  );
  claim(
    "maintenanceRecords",
    /\b(no (?:maintenance |service )?records|records (?:unavailable|not available)|aucune facture)\b/gi,
    /\b((?:maintenance|service) records (?:available|included)|records available|factures disponibles)\b/i,
    /records|factures/i,
  );
  claim(
    "carfaxStatus",
    /\b(no carfax|carfax (?:not available|unavailable)|pas de carfax)\b/gi,
    /\b(carfax (?:available|included|disponible))\b/i,
    /carfax/i,
    (value) => value === "yes" ? "available" : "not_available",
  );
  return {
    details,
    found: Object.keys(details),
    uncertain: [...new Set(uncertain)],
  };
}
