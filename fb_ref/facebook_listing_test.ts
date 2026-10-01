/**

facebook_listing_test.ts
========================

TypeScript port of facebook_listing_test.py (the reference implementation).

The Python file is READ-ONLY and was NOT modified. This file reproduces its
behaviour 1:1 so the two can be compared side by side.

Question (same as the Python reference):
    Does Selenium -> real Chrome -> Facebook URL -> JavaScript rendering ->
    rendered-DOM extraction work for ONE individual Marketplace listing reached
    through a share URL, on a fresh anonymous session?

        https://www.facebook.com/share/1HjKAsQwoy/
            -> follow Facebook's normal redirect
            -> discover the Marketplace item
            -> render the individual listing
            -> inspect what vehicle information is available in the rendered DOM

Behaviour mirrored from the Python reference:
    - chrome.Options() with only the operational flags, NO evasion flags
    - driver.get(...) and let Chrome resolve redirects itself
    - fixed settle wait + window.scrollTo rounds to trigger lazy rendering
    - read the post-hydration DOM (findElements / getAttribute / getText)
    - a fresh browser session per run, always closed with driver.quit()
    - the same id/price/label/regex extraction logic, field for field
    - the same JSON result shape and the same console output

Not used (matching the reference):
    - --disable-blink-features=AutomationControlled
    - excludeSwitches ["enable-automation", ...]
    - no login, no cookies, no token, no --user-data-dir

Output goes to listing_test_output_ts/ (a separate directory) so the Python
artifacts in listing_test_output/ stay intact for comparison.
*/

import { Builder, By, WebDriver, error } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// CONFIGURATION
// ============================================================

const SHARE_URL = "https://www.facebook.com/share/1HjKAsQwoy/";

// Matches the reference (HEADLESS = True).
const HEADLESS = true;

// Wait/scroll barrier, same constants as the reference.
const HYDRATE_WAIT_SECONDS = 10;
const SCROLL_ROUNDS = 3;
const SCROLL_PAUSE_SECONDS = 2;
const PAGE_LOAD_TIMEOUT_MS = 60_000;

// Separate artifacts directory to avoid clobbering the Python run.
const OUTPUT_DIR = "listing_test_output_ts";
const RESULT_JSON = path.join(OUTPUT_DIR, "facebook_listing_test_result.json");
const SHARE_SCREENSHOT = path.join(OUTPUT_DIR, "01_share_url.png");
const LISTING_SCREENSHOT = path.join(OUTPUT_DIR, "02_listing_page.png");
const LISTING_TEXT_TXT = path.join(OUTPUT_DIR, "listing_visible_text.txt");

const ITEM_ID_RE = /\/marketplace\/item\/(\d+)/;

// ============================================================
// SMALL UTILITIES
// ============================================================

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** Python strftime("%Y-%m-%d %H:%M:%S") */
function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

// ============================================================
// URL HELPERS (concept borrowed from Nvme.py via the reference)
// ============================================================

function extractId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(ITEM_ID_RE);
  return match ? match[1] : null;
}

function canonicalItemUrl(itemId: string): string {
  return `https://www.facebook.com/marketplace/item/${itemId}/`;
}

// ============================================================
// BROWSER SETUP  (mirrors the reference, minus the evasion flags)
// ============================================================

function buildOptions(): chrome.Options {
  const options = new chrome.Options();

  // Operational flags, same as the reference:
  options.addArguments(
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--log-level=3",
    "--disable-logging",
  );

  if (HEADLESS) {
    options.addArguments("--headless");
  }

  // NOTE: intentionally NOT setting
  //   --disable-blink-features=AutomationControlled
  //   excludeSwitches ["enable-automation", "enable-logging"]
  //   --user-agent / --user-data-dir / cookies / tokens
  // The point of this test is to see what the plain approach does.

  return options;
}

// ============================================================
// RENDERED-DOM READING HELPERS
// ============================================================

async function safeBodyText(driver: WebDriver): Promise<string> {
  try {
    return (await driver.findElement(By.tagName("body")).getText()) || "";
  } catch {
    return "";
  }
}

async function getMeta(driver: WebDriver, prop: string): Promise<string | null> {
  try {
    const el = await driver.findElement(By.css(`meta[property="${prop}"]`));
    return await el.getAttribute("content");
  } catch {
    return null;
  }
}

const ITEM_ANCHOR_XPATH = '//a[contains(@href, "/marketplace/item/")]';

async function countItemAnchors(driver: WebDriver): Promise<number> {
  try {
    return (await driver.findElements(By.xpath(ITEM_ANCHOR_XPATH))).length;
  } catch {
    return 0;
  }
}

async function firstItemAnchor(driver: WebDriver): Promise<string | null> {
  try {
    const els = await driver.findElements(By.xpath(ITEM_ANCHOR_XPATH));
    if (els.length > 0) {
      return await els[0].getAttribute("href");
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Discriminated outcome, so a blocked page is NOT silently reported as an
 * empty page. Returns one of: "ok", "requires_auth".
 */
async function detectState(driver: WebDriver): Promise<string> {
  const url = ((await driver.getCurrentUrl()) || "").toLowerCase();
  const urlMarkers = ["/login", "checkpoint", "/recover", "login.php", "/consent"];
  if (urlMarkers.some((marker) => url.includes(marker))) {
    return "requires_auth";
  }

  const text = (await safeBodyText(driver)).toLowerCase();
  const textMarkers = [
    "you must log in",
    "log in to continue",
    "log into facebook",
    "please log in",
    "you're temporarily blocked",
    "temporarily blocked",
    "confirm your identity",
    "session expired",
  ];
  if (textMarkers.some((marker) => text.includes(marker))) {
    return "requires_auth";
  }

  return "ok";
}

async function hydrateAndRender(driver: WebDriver): Promise<void> {
  await sleep(HYDRATE_WAIT_SECONDS);
  for (let i = 0; i < SCROLL_ROUNDS; i++) {
    try {
      await driver.executeScript(
        "window.scrollTo(0, document.body.scrollHeight);",
      );
    } catch {
      // ignore
    }
    await sleep(SCROLL_PAUSE_SECONDS);
  }
  try {
    await driver.executeScript("window.scrollTo(0, 0);");
    await sleep(1);
  } catch {
    // ignore
  }
}

interface Snapshot {
  label: string;
  requested_url: string | null;
  final_url: string | null;
  title: string;
  state: string;
  item_id_in_url: string | null;
  og_url: string | null;
  og_title: string | null;
  og_description: string | null;
  item_anchor_count: number;
  first_item_anchor: string | null;
  window_count: number;
  body_text_length: number;
  body_text: string;
  error?: string;
}

async function snapshot(driver: WebDriver, label: string): Promise<Snapshot> {
  const bodyText = await safeBodyText(driver);
  const finalUrl = await driver.getCurrentUrl();
  return {
    label,
    requested_url: null, // filled in by navigate()
    final_url: finalUrl,
    title: await driver.getTitle(),
    state: await detectState(driver),
    item_id_in_url: extractId(finalUrl),
    og_url: await getMeta(driver, "og:url"),
    og_title: await getMeta(driver, "og:title"),
    og_description: await getMeta(driver, "og:description"),
    item_anchor_count: await countItemAnchors(driver),
    first_item_anchor: await firstItemAnchor(driver),
    window_count: (await driver.getAllWindowHandles()).length,
    body_text_length: bodyText.length,
    body_text: bodyText,
  };
}

async function navigate(
  driver: WebDriver,
  url: string,
  label: string,
): Promise<Snapshot> {
  console.log(`\n[..] Navigating (${label}): ${url}`);
  let info: Partial<Snapshot> = { label, requested_url: url };

  try {
    await driver.get(url);
  } catch (exc) {
    // Python catches TimeoutException separately; here that is error.TimeoutError.
    if (exc instanceof error.TimeoutError) {
      console.log("     [!] Page load timed out; continuing with whatever rendered.");
    } else {
      const message = (exc as Error).message ?? String(exc);
      console.log(`     [X] Navigation error: ${message}`);
      info = { label, requested_url: url, final_url: null, state: "error", error: message };
      return info as Snapshot;
    }
  }

  // A share link can open a new tab; follow it if so.
  try {
    const handles = await driver.getAllWindowHandles();
    if (handles.length > 1) {
      await driver.switchTo().window(handles[handles.length - 1]);
    }
  } catch {
    // ignore
  }

  await hydrateAndRender(driver);

  const snap = await snapshot(driver, label);
  info = { ...snap, requested_url: url };
  const full = info as Snapshot;
  console.log(`     -> final URL : ${full.final_url}`);
  console.log(`     -> state     : ${full.state}`);
  console.log(`     -> title     : ${JSON.stringify(full.title)}`);
  console.log(`     -> body text : ${full.body_text_length} chars`);
  console.log(`     -> item hrefs: ${full.item_anchor_count}`);
  return full;
}

// ============================================================
// VEHICLE INFORMATION EXTRACTION (diagnostic, not authoritative)
// ============================================================

const VEHICLE_LABELS: Record<string, string[]> = {
  year: ["year", "annee", "annee du vehicule"],
  make: ["make", "marque"],
  model: ["model", "modele"],
  trim: ["trim", "version", "finition"],
  mileage: ["mileage", "kilometrage", "odometer"],
  transmission: ["transmission", "boite de vitesses", "boite"],
  drivetrain: ["drivetrain", "traction", "type de traction"],
  fuel_type: ["fuel type", "carburant", "type de carburant"],
  body_type: ["body type", "carrosserie", "type de carrosserie"],
  exterior_color: [
    "exterior color",
    "exterior colour",
    "couleur exterieure",
    "couleur exterieur",
    "couleur",
  ],
  interior_color: [
    "interior color",
    "interior colour",
    "couleur interieure",
    "couleur interieur",
  ],
  owners: ["owners", "proprietaires", "nombre de proprietaires"],
  condition: ["condition", "etat", "etat du vehicule"],
  engine: ["engine", "moteur"],
  cylinders: ["cylinders", "cylindres"],
  vin: ["vin", "numero d'identification du vehicule"],
};

/** Lowercase + strip accents/punctuation for label matching. */
function normalize(line: string): string {
  let s = line.trim().toLowerCase().replace(/:+$/, "");
  const accents: Array<[string, string]> = [
    ["é", "e"],
    ["è", "e"],
    ["ê", "e"],
    ["à", "a"],
    ["ô", "o"],
    ["î", "i"],
    ["û", "u"],
    ["ç", "c"],
  ];
  for (const [src, dst] of accents) {
    s = s.split(src).join(dst);
  }
  return s.trim();
}

/**
 * Find 'Label -> next non-empty line' pairs, plus 'Label: value' inline pairs.
 */
function extractLabeledFields(bodyText: string): Record<string, string> {
  // Marketplace joins attribute values with " · " (e.g.
  // "Exterior color: White · Interior color: Black"); split so each is its own line.
  const lines = bodyText.replace(/·/g, "\n").split("\n");
  const norm = lines.map(normalize);

  const labelToField: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(VEHICLE_LABELS)) {
    for (const alias of aliases) {
      labelToField[normalize(alias)] = field;
    }
  }

  const found: Record<string, string> = {};
  for (let i = 0; i < norm.length; i++) {
    const nline = norm[i];
    if (!nline) continue;

    // Inline form: "Year: 2015"
    const colon = nline.indexOf(":");
    if (colon !== -1) {
      const head = nline.slice(0, colon).trim();
      const field = labelToField[head];
      const tail = nline.slice(colon + 1).trim();
      if (field && tail && !found[field]) {
        const rawColon = lines[i].indexOf(":");
        found[field] = lines[i].slice(rawColon + 1).trim();
        continue;
      }
    }

    // Label-on-its-own-line form: take the next non-empty line.
    const field = labelToField[nline];
    if (field && !found[field]) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (norm[j]) {
          found[field] = lines[j].trim();
          break;
        }
      }
    }
  }

  return found;
}

/** Fallback patterns for values even when no label line is present. */
function extractRegexFields(bodyText: string): Record<string, string> {
  const found: Record<string, string> = {};

  let m = bodyText.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  if (m) found.year = m[1];

  m = bodyText.match(/\b(\d[\d.,\s]{2,}\s*k(?:m|ilometres?|m))\b/i);
  if (m) found.mileage = m[1].trim();

  m = bodyText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (m) found.vin = m[1];

  // Value-first attribute lines observed on a real listing ("Automatic transmission").
  m = bodyText.match(/\b(Automatic|Manual|CVT)\s+transmission\b/i);
  if (m) found.transmission = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();

  m = bodyText.match(/\b(\d\+?)\s*owners?\b/i);
  if (m) found.owners = m[1];

  return found;
}

/** First currency amount in the rendered page = the listing's own price. */
function extractPrice(bodyText: string): string | null {
  const m = bodyText.match(/(?:CA|US)?\$\s*[\d][\d,\s]*(?:\.\d{2})?/);
  return m ? m[0].trim() : null;
}

type VehicleReport = Record<string, string | null | Record<string, string>>;

function extractVehicleInfo(bodyText: string): VehicleReport {
  const labeled = extractLabeledFields(bodyText);
  const regex = extractRegexFields(bodyText);
  const merged: Record<string, string> = { ...regex, ...labeled }; // labels win

  // Report every known field as extracted or unknown - never silently guess.
  const report: VehicleReport = {};
  for (const field of Object.keys(VEHICLE_LABELS)) {
    report[field] = merged[field] ?? null;
  }
  const unrecognized: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (!(k in VEHICLE_LABELS)) unrecognized[k] = v;
  }
  report._unrecognized = unrecognized;
  return report;
}

// ============================================================
// MAIN
// ============================================================

interface Result {
  share_url: string;
  headless: boolean;
  started_at: string;
  evasion_flags_used: boolean;
  authentication_used: boolean;
  share_page: Snapshot | null;
  listing_page: Snapshot | null;
  discovered_item_id: string | null;
  discovered_item_url: string | null;
  listing_price: string | null;
  vehicle_info: VehicleReport | null;
  conclusion: string | null;
  finished_at?: string;
}

async function saveScreenshot(driver: WebDriver, file: string): Promise<void> {
  try {
    const b64 = await driver.takeScreenshot();
    fs.writeFileSync(file, Buffer.from(b64, "base64"));
  } catch {
    // ignored, matching the reference's guarded save
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("=".repeat(60));
  console.log("FACEBOOK MARKETPLACE LISTING TEST");
  console.log("=".repeat(60));
  console.log(`Share URL : ${SHARE_URL}`);
  console.log(`Headless  : ${HEADLESS}`);
  console.log("Evasion flags: NOT used (no AutomationControlled, no excludeSwitches)");
  console.log("Auth      : none (no login, cookies, profile, or token)");
  console.log("=".repeat(60));

  let driver: WebDriver;
  try {
    driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(buildOptions())
      .build();
  } catch (exc) {
    console.log(
      `\n[X] Could not start Chrome via Selenium: ${(exc as Error).message}`,
    );
    console.log("    Check that Chrome and a matching chromedriver are available.");
    return;
  }

  const result: Result = {
    share_url: SHARE_URL,
    headless: HEADLESS,
    started_at: timestamp(),
    evasion_flags_used: false,
    authentication_used: false,
    share_page: null,
    listing_page: null,
    discovered_item_id: null,
    discovered_item_url: null,
    listing_price: null,
    vehicle_info: null,
    conclusion: null,
  };

  try {
    await driver.manage().setTimeouts({ pageLoad: PAGE_LOAD_TIMEOUT_MS });

    // --- Step 1: open the share URL and let Chrome follow the redirect. ---
    const share = await navigate(driver, SHARE_URL, "share_url");
    result.share_page = share;
    await saveScreenshot(driver, SHARE_SCREENSHOT);

    // --- Step 2: discover the Marketplace item. ---
    // Preference order: the URL we landed on, then og:url, then any item anchor.
    let itemId = extractId(share.final_url);
    if (!itemId) itemId = extractId(share.og_url);
    if (!itemId) itemId = extractId(share.first_item_anchor);

    if (itemId) {
      result.discovered_item_id = itemId;
      result.discovered_item_url = canonicalItemUrl(itemId);
      console.log(`\n[OK] Discovered item ID: ${itemId}`);

      // --- Step 3: render the individual listing page. ---
      const listing = await navigate(driver, result.discovered_item_url, "listing_page");
      result.listing_page = listing;
      await saveScreenshot(driver, LISTING_SCREENSHOT);

      // --- Step 4: inspect available vehicle information. ---
      const vehicle = extractVehicleInfo(listing.body_text);
      const price = extractPrice(listing.body_text);
      result.listing_price = price;
      result.vehicle_info = vehicle;

      console.log("\n[RESULT] Listing info visible anonymously:");
      console.log(`     price: ${price}`);
      const vehicleFound: Array<[string, string]> = [];
      for (const [k, v] of Object.entries(vehicle)) {
        if (k.startsWith("_")) continue;
        if (typeof v === "string" && v) vehicleFound.push([k, v]);
      }
      if (vehicleFound.length > 0) {
        for (const [k, v] of vehicleFound) {
          console.log(`     ${k}: ${v}`);
        }
      } else {
        console.log("     (no vehicle fields matched - inspect the raw text below)");
      }

      fs.writeFileSync(LISTING_TEXT_TXT, listing.body_text, "utf-8");
      console.log(`\n[i] Full listing text saved to: ${LISTING_TEXT_TXT}`);

      if (listing.state === "requires_auth") {
        result.conclusion =
          "item URL was reachable but the listing page requested login";
      } else if (vehicleFound.length > 0) {
        result.conclusion =
          "listing rendered anonymously and vehicle fields were readable";
      } else {
        result.conclusion =
          "listing rendered anonymously but no vehicle fields were " +
          "recognized - inspect raw text and refine selectors";
      }
    } else {
      console.log("\n[!] No /marketplace/item/<id> discovered from the share URL.");
      if (share.state === "requires_auth") {
        result.conclusion =
          "share URL resolved to a login/checkpoint page (requires_auth)";
      } else {
        result.conclusion =
          "share URL did not expose a Marketplace item id; " +
          "see share_page snapshot + screenshot";
      }
    }

    result.finished_at = timestamp();
    fs.writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2), "utf-8");

    console.log("\n" + "=".repeat(60));
    console.log(`CONCLUSION: ${result.conclusion}`);
    console.log(`Artifacts : ${OUTPUT_DIR}/`);
    console.log(`            - ${path.basename(RESULT_JSON)}`);
    console.log(`            - ${path.basename(SHARE_SCREENSHOT)}`);
    console.log(`            - ${path.basename(LISTING_SCREENSHOT)}`);
    console.log(`            - ${path.basename(LISTING_TEXT_TXT)}`);
    console.log("=".repeat(60));
  } finally {
    // Fresh session, retired afterwards.
    await driver.quit();
  }
}

if (require.main === module) {
  main().catch((exc) => {
    console.error(exc);
    process.exitCode = 1;
  });
}
