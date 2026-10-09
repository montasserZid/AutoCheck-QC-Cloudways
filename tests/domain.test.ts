import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { emptyIntake, extractListing } from "../src/lib/listingExtraction";
import { extractListingFromHtml } from "../src/lib/listingUrlExtraction";
import { generateDemoReport } from "../src/lib/reportEngine";
import {
  getVehicleChecklist,
  vehicleKnowledge,
} from "../src/lib/vehicleKnowledge";
import {
  validListingUrl,
  validVin,
  validateIntake,
  validatePhotos,
  validateBooking,
} from "../src/lib/validation";
import { demoVehicleIntake } from "../src/lib/mockData";
import { readLocal, writeLocal, clearLocalData, getSubmittedIntakeContext, saveSubmittedIntakeContext } from "../src/lib/localStorage";
import {
  CONTACT_LIMITS,
  submitContactMessage,
  validateContactSubmission,
} from "../src/lib/contactSubmission";
import { createContactMessageRepository } from "../src/lib/data/contactMessageRepository";
import { createContactPostHandler } from "../src/server/contact/handler";
import { createFinalizeIntakePostHandler } from "../src/server/intakes/handler";
import { FINALIZED_INTAKE_LIMITS, validateFinalizedIntake } from "../src/lib/finalizedIntake";
import { createFinalizedIntakeRepository } from "../src/lib/data/finalizedIntakeRepository";
import { finalizeIntake } from "../src/lib/intakeFinalization";
import {
  createListingExtractionPostHandler,
  serializeListingFetchErrorForLog,
} from "../src/server/listing/handler";
import {
  fetchPublicListingHtml,
  ListingFetchError,
  resolvePublicUrl,
} from "../src/server/listing/secureFetch";
import {
  buildFacebookChromiumArgvVariants,
  canonicalFacebookItemUrl,
  classifyFacebookPageTitle,
  classifyFacebookPath,
  classifyFacebookRenderFailure,
  createFacebookLifecycleTracker,
  detectFacebookPageState,
  evaluateFacebookRenderGate,
  extractFacebookItemId,
  extractFacebookListingFromRenderedText,
  facebookBrowserRuntime,
  facebookRenderChromiumLaunchOptions,
  facebookRenderWaitBudget,
  facebookServerlessChromiumLaunchOptions,
  FacebookExtractionError,
  facebookErrorToListingFetchError,
  FacebookRenderWaitError,
  isSupportedFacebookMarketplaceUrl,
  primaryFacebookListingText,
  readFacebookRuntimeMemoryDiagnostics,
  retryFacebookPageOperation,
  resolveFacebookBrowserExecutable,
  runFacebookChromiumLaunchMatrix,
  reuseOrCreateFacebookPage,
  summarizeFacebookRenderProbe,
  validateFacebookChromiumGraphicsArgs,
  waitForFacebookRenderReadiness,
} from "../src/server/listing/facebook";

test("extracts full English ad without requiring duplicate entry", () => {
  const { details } = extractListing(
    "2015 Honda Civic EX. 165,000 km. $8,500. Montreal. Private seller. VIN: 2HGFB2F50FH123456. Carfax available. No accidents. Not rebuilt. Inspection welcome. Maintenance records available.",
  );
  assert.deepEqual(details, {
    make: "Honda",
    model: "Civic",
    year: 2015,
    trim: "EX",
    mileageKm: 165000,
    askingPriceCad: 8500,
    city: "Montreal",
    vin: "2HGFB2F50FH123456",
    sellerType: "private",
    accidentHistoryMentioned: "no",
    rebuiltStatus: "no",
    inspectionAllowed: "yes",
    maintenanceRecords: "yes",
    carfaxStatus: "available",
  });
});
for (const ad of [
  "Honda Civic 2015, 165000km, 8 500$, Montréal",
  "2015 Honda Civic, 165 000 km, $8,500, Montreal",
  "2015 Honda Civic, 165\u202f000 km, 8\u00a0500$, Montreal",
])
  test(`numeric format: ${ad}`, () => {
    const d = extractListing(ad).details;
    assert.equal(d.year, 2015);
    assert.equal(d.mileageKm, 165000);
    assert.equal(d.askingPriceCad, 8500);
    assert.equal(d.city, "Montreal");
  });
for (const city of ["Laval", "Longueuil", "Brossard"])
  test(`city ${city}`, () =>
    assert.equal(extractListing(city).details.city, city));
test("common French claims", () => {
  const d = extractListing(
    "Toyota Corolla 2016. 150000km. 9 000$. Particulier. Carfax disponible. Aucun accident. Inspection acceptée. Factures disponibles.",
  ).details;
  assert.equal(d.accidentHistoryMentioned, "no");
  assert.equal(d.inspectionAllowed, "yes");
  assert.equal(d.maintenanceRecords, "yes");
  assert.equal(d.carfaxStatus, "available");
});
test("unknown facts remain unknown; partial VIN is not trusted", () => {
  const d = extractListing("2015 Honda Civic, VIN: 2HG...");
  assert.equal(d.details.vin, undefined);
  assert.ok(d.uncertain.includes("vin"));
  assert.equal(d.details.mileageKm, undefined);
  assert.equal(d.details.askingPriceCad, undefined);
  assert.equal(d.details.carfaxStatus, undefined);
});
test("ambiguous price, model and mileage are not guessed", () => {
  const r = extractListing(
    "2015 Honda Civic or Toyota Corolla. $8,500 or $9,000. 150000km or 160000km.",
  );
  assert.equal(r.details.model, undefined);
  assert.equal(r.details.askingPriceCad, undefined);
  assert.equal(r.details.mileageKm, undefined);
});
test("conflicting and qualified history is unknown", () => {
  for (const t of [
    "No accidents. Accident repaired.",
    "No known accidents",
    "No major accidents",
    "Accident history unknown",
  ])
    assert.equal(
      extractListing(t).details.accidentHistoryMentioned,
      undefined,
      t,
    );
});
test("negative claims and inspection refusal are recognized", () => {
  const d = extractListing(
    "No Carfax. No service records. Inspection refused. Never had an accident. Not rebuilt.",
  ).details;
  assert.equal(d.carfaxStatus, "not_available");
  assert.equal(d.maintenanceRecords, "no");
  assert.equal(d.inspectionAllowed, "no");
  assert.equal(d.accidentHistoryMentioned, "no");
  assert.equal(d.rebuiltStatus, "no");
});
test("decimal price and monthly financing", () => {
  assert.equal(extractListing("$8,500.50").details.askingPriceCad, 8500.5);
  assert.equal(extractListing("$299/month").details.askingPriceCad, undefined);
  assert.equal(extractListing("-100km. -8500$").details.mileageKm, undefined);
  assert.equal(
    extractListing("-100km. -8500$").details.askingPriceCad,
    undefined,
  );
});
test("unsupported model uses general checklist without inventing a model", () => {
  const d = extractListing("2019 Volvo XC40, 80000km").details;
  assert.equal(d.make, "Volvo");
  assert.equal(d.model, undefined);
  assert.match(
    getVehicleChecklist({ ...emptyIntake, make: "Volvo", model: "XC40" })[0]
      .title,
    /General/,
  );
});
test("all nine models have dedicated verification checklists", () => {
  assert.equal(vehicleKnowledge.length, 9);
  for (const v of vehicleKnowledge) {
    const checks = getVehicleChecklist({
      ...emptyIntake,
      make: v.make,
      model: v.model,
    });
    assert.equal(checks.length, 6);
    assert.ok(!checks[0].title.includes("General"));
  }
});
test("missing information never becomes a zero price or an automatic avoid", () => {
  const r = generateDemoReport(
    { ...emptyIntake, make: "Honda", model: "Civic" },
    "full",
  );
  assert.equal(r.riskLevel, "Unknown");
  assert.equal(r.finalRecommendation, "Ask more questions");
  assert.equal(
    r.vehicleSummary.find((v) => v.label === "Mileage")?.value,
    "Not provided",
  );
  assert.ok(!r.priceCheck[0].title.includes("$0"));
});
test("inspection refusal dominates recommendation and cannot suggest booking first", () => {
  const r = generateDemoReport(
    { ...demoVehicleIntake, inspectionAllowed: "no" },
    "full",
  );
  assert.equal(r.finalRecommendation, "Avoid");
  assert.match(r.topConcern, /refuses/);
  assert.match(r.inspectionRecommendation, /Not while/);
});
test("reported rebuilt status is actionable, not a confirmed defect", () => {
  const r = generateDemoReport(
    { ...demoVehicleIntake, rebuiltStatus: "yes" },
    "full",
  );
  assert.equal(r.finalRecommendation, "Ask more questions");
  assert.ok(r.biggestRedFlags.some((f) => /Rebuilt/.test(f.title)));
  assert.match(r.biggestRedFlags[0].detail, /not been verified/);
});
test("complete seller claims still lead to inspection, never a guarantee", () => {
  const r = generateDemoReport(
    {
      ...demoVehicleIntake,
      mileageKm: 80000,
      vin: "2HGFB2F50FH123456",
      carfaxStatus: "available",
      maintenanceRecords: "yes",
      rebuiltStatus: "no",
      accidentHistoryMentioned: "no",
    },
    "full",
  );
  assert.equal(r.riskLevel, "Low");
  assert.equal(r.finalRecommendation, "Worth professional inspection");
  assert.equal(r.missingInformation.length, 0);
});
test("attachments cannot improve risk without image analysis", () => {
  const a = generateDemoReport(demoVehicleIntake, "full");
  const b = generateDemoReport(
    {
      ...demoVehicleIntake,
      photos: [{ name: "photo.jpg", type: "image/jpeg", size: 100 }],
    },
    "full",
  );
  assert.equal(a.riskScore, b.riskScore);
});
test("scores are explained and capped; free/full recommendations agree", () => {
  const a = generateDemoReport(
    {
      ...emptyIntake,
      make: "Honda",
      model: "Civic",
      inspectionAllowed: "no",
      rebuiltStatus: "yes",
      accidentHistoryMentioned: "yes",
    },
    "free",
  );
  assert.equal(
    a.riskScore,
    Math.min(
      100,
      a.riskContributions.reduce((s, c) => s + c.points, 0),
    ),
  );
  assert.equal(
    generateDemoReport(demoVehicleIntake, "free").finalRecommendation,
    generateDemoReport(demoVehicleIntake, "full").finalRecommendation,
  );
});
test("review validation permits unknowns and real zero mileage but rejects invalid data", () => {
  assert.deepEqual(
    validateIntake({
      ...emptyIntake,
      make: "Honda",
      model: "Civic",
      mileageKm: 0,
    }),
    {},
  );
  const e = validateIntake({
    ...emptyIntake,
    year: 1000,
    mileageKm: -1,
    askingPriceCad: -20,
    vin: "bad",
  });
  for (const key of [
    "make",
    "model",
    "year",
    "mileageKm",
    "askingPriceCad",
    "vin",
  ])
    assert.ok(e[key]);
});
test("URL and VIN validation", () => {
  assert.ok(validListingUrl("https://www.kijiji.ca/v-cars/trial"));
  assert.ok(!validListingUrl("javascript:alert(1)"));
  assert.ok(!validListingUrl("not a link"));
  assert.ok(!validListingUrl("https://user:pass@example.com"));
  assert.ok(validVin("2HGFB2F50FH123456"));
  assert.ok(!validVin("2HGIB2F50FH123456"));
});

test("listing URL extraction reads Vehicle JSON-LD with provenance", () => {
  const html = `<!doctype html>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Vehicle",
        "name": "2021 Toyota RAV4 XLE AWD",
        "brand": {"@type": "Brand", "name": "Toyota"},
        "model": "RAV4",
        "vehicleModelDate": "2021",
        "vehicleConfiguration": "XLE AWD",
        "vehicleIdentificationNumber": "2T3R1RFV1MW123456",
        "mileageFromOdometer": {"@type": "QuantitativeValue", "value": "82,300", "unitCode": "KMT"},
        "vehicleTransmission": "Automatic",
        "driveWheelConfiguration": "AWD",
        "vehicleEngine": "2.5L I4",
        "offers": {"@type": "Offer", "price": "21995", "priceCurrency": "CAD"},
        "seller": {"@type": "AutoDealer", "name": "Demo Motors"}
      }
    </script>`;
  const result = extractListingFromHtml(html, "https://dealer.example/listing/1");
  assert.equal(result.details.year, 2021);
  assert.equal(result.details.make, "Toyota");
  assert.equal(result.details.model, "RAV4");
  assert.equal(result.details.askingPriceCad, 21995);
  assert.equal(result.details.mileageKm, 82300);
  assert.equal(result.details.vin, "2T3R1RFV1MW123456");
  assert.equal(result.details.transmission, "Automatic");
  assert.equal(result.details.drivetrain, "AWD");
  assert.equal(result.details.engine, "2.5L I4");
  assert.equal(result.details.sellerName, "Demo Motors");
  assert.equal(result.provenance.mileageKm?.source, "json-ld");
});

test("listing URL extraction reads Product and Offer JSON-LD", () => {
  const html = `<!doctype html>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "2019 Honda Civic EX Sedan",
        "brand": "Honda",
        "model": "Civic",
        "description": "2019 Honda Civic EX. 82 300 kilometres. Carfax available. No accidents.",
        "offers": {"@type": "Offer", "price": "21 995 $", "priceCurrency": "CAD"}
      }
    </script>`;
  const result = extractListingFromHtml(html, "https://market.example/civic");
  assert.equal(result.details.year, 2019);
  assert.equal(result.details.make, "Honda");
  assert.equal(result.details.model, "Civic");
  assert.equal(result.details.mileageKm, 82300);
  assert.equal(result.details.askingPriceCad, 21995);
  assert.equal(result.details.carfaxStatus, "available");
  assert.equal(result.details.accidentHistoryMentioned, "no");
});

test("listing URL extraction reads @graph and nested JSON-LD", () => {
  const html = `<!doctype html>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {"@type": "Organization", "name": "Graph Dealer"},
          {
            "@type": "ItemList",
            "itemListElement": [{
              "@type": "ListItem",
              "item": {
                "@type": "Car",
                "name": "2020 Mazda Mazda3 GT",
                "brand": "Mazda",
                "model": "Mazda3",
                "offers": {"price": "18995", "priceCurrency": "CAD"}
              }
            }]
          }
        ]
      }
    </script>`;
  const result = extractListingFromHtml(html, "https://dealer.example/mazda3");
  assert.equal(result.details.year, 2020);
  assert.equal(result.details.make, "Mazda");
  assert.equal(result.details.model, "Mazda3");
  assert.equal(result.details.askingPriceCad, 18995);
});

test("listing URL extraction falls back to metadata", () => {
  const html = `<!doctype html>
    <title>2022 Hyundai Elantra Preferred for sale</title>
    <meta name="description" content="$21,995. 82,300 km. Laval. Dealer. Inspection welcome.">`;
  const result = extractListingFromHtml(html, "https://meta.example/elantra");
  assert.equal(result.details.year, 2022);
  assert.equal(result.details.make, "Hyundai");
  assert.equal(result.details.model, "Elantra");
  assert.equal(result.details.askingPriceCad, 21995);
  assert.equal(result.details.mileageKm, 82300);
  assert.equal(result.details.city, "Laval");
  assert.equal(result.provenance.listingTitle?.source, "meta");
});

test("listing URL extraction falls back to labelled HTML", () => {
  const html = `<!doctype html>
    <h1>2018 Subaru Outback Touring</h1>
    <dl>
      <dt>Price</dt><dd>CAD 21,995</dd>
      <dt>Odometer</dt><dd>82 300 kilomètres</dd>
      <dt>Transmission</dt><dd>CVT</dd>
      <dt>Drivetrain</dt><dd>AWD</dd>
      <dt>VIN</dt><dd>4S4BSENC4J3123456</dd>
    </dl>`;
  const result = extractListingFromHtml(html, "https://html.example/outback");
  assert.equal(result.details.year, 2018);
  assert.equal(result.details.make, "Subaru");
  assert.equal(result.details.model, "Outback");
  assert.equal(result.details.askingPriceCad, 21995);
  assert.equal(result.details.mileageKm, 82300);
  assert.equal(result.details.transmission, "CVT");
  assert.equal(result.details.drivetrain, "AWD");
  assert.equal(result.details.vin, "4S4BSENC4J3123456");
});

test("listing URL extraction ignores malformed JSON-LD and returns partial metadata", () => {
  const html = `<!doctype html>
    <script type="application/ld+json">{ "name": "broken", </script>
    <title>2021 Nissan Rogue SV</title>`;
  const result = extractListingFromHtml(html, "https://broken.example/rogue");
  assert.equal(result.details.year, 2021);
  assert.equal(result.details.make, "Nissan");
  assert.equal(result.details.model, "Rogue");
  assert.ok(result.uncertain.includes("json-ld"));
});

test("listing URL extraction preserves mileage units without converting miles", () => {
  const html = `<!doctype html>
    <script type="application/ld+json">
      {
        "@type": "Vehicle",
        "name": "2021 Ford Escape SE",
        "mileageFromOdometer": {"value": "50,000", "unitCode": "SMI"}
      }
    </script>`;
  const result = extractListingFromHtml(html, "https://dealer.example/escape");
  assert.equal(result.details.mileageUnit, "mi");
  assert.equal(result.details.mileageKm, undefined);
});

test("Facebook Marketplace URL helpers recognize share and item URLs only", () => {
  assert.equal(
    isSupportedFacebookMarketplaceUrl("https://www.facebook.com/share/1HjKAsQwoy/"),
    true,
  );
  assert.equal(
    isSupportedFacebookMarketplaceUrl(
      "https://www.facebook.com/marketplace/item/4263002720500667/?rdid=x",
    ),
    true,
  );
  assert.equal(
    isSupportedFacebookMarketplaceUrl("http://www.facebook.com/share/1HjKAsQwoy/"),
    false,
  );
  assert.equal(
    isSupportedFacebookMarketplaceUrl("https://user:pass@www.facebook.com/share/1HjKAsQwoy/"),
    false,
  );
  assert.equal(
    isSupportedFacebookMarketplaceUrl("https://example.com/marketplace/item/4263002720500667/"),
    false,
  );
  assert.equal(
    extractFacebookItemId(
      "https://www.facebook.com/marketplace/item/4263002720500667/?rdid=x",
    ),
    "4263002720500667",
  );
  assert.equal(
    canonicalFacebookItemUrl("4263002720500667"),
    "https://www.facebook.com/marketplace/item/4263002720500667/",
  );
});

test("Facebook browser executable resolution prioritizes an explicit override", () => {
  const result = resolveFacebookBrowserExecutable(
    { CHROME_EXECUTABLE_PATH: "D:\\tools\\chrome.exe", VERCEL: "1" },
    () => false,
  );
  assert.deepEqual(result, {
    kind: "local",
    executablePath: "D:\\tools\\chrome.exe",
    source: "override",
  });
});

test("Facebook browser executable resolution selects Vercel Chromium", () => {
  assert.deepEqual(resolveFacebookBrowserExecutable({ VERCEL: "1" }, () => false), {
    kind: "vercel",
  });
});

test("Facebook browser executable resolution selects Render Chromium", () => {
  assert.deepEqual(resolveFacebookBrowserExecutable({ RENDER: "true" }, () => false), {
    kind: "render",
  });
  assert.equal(facebookBrowserRuntime({ RENDER: "true", VERCEL: "1" }), "render");
  assert.equal(facebookBrowserRuntime({ VERCEL: "1" }), "vercel");
  assert.equal(facebookBrowserRuntime({}), "local");
});

test("Facebook browser executable resolution discovers local Chrome", () => {
  const expected = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const result = resolveFacebookBrowserExecutable(
    {
      LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local",
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    },
    (path) => path === expected,
  );
  assert.deepEqual(result, { kind: "local", executablePath: expected, source: "discovered" });
});

test("Facebook browser executable resolution reports a missing local executable", () => {
  assert.deepEqual(resolveFacebookBrowserExecutable({}, () => false), { kind: "missing" });
});

test("Facebook page operation retries a transient detached-frame failure", async () => {
  let attempts = 0;
  const result = await retryFacebookPageOperation(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Attempted to use detached Frame 'frame-1'.");
      }
      return "fresh-page-state";
    },
    { sleep: async () => undefined },
  );
  assert.equal(result, "fresh-page-state");
  assert.equal(attempts, 2);
});

test("Facebook page operation lifecycle retries are bounded", async () => {
  let attempts = 0;
  await assert.rejects(
    retryFacebookPageOperation(
      async () => {
        attempts += 1;
        throw new Error("Execution context was destroyed, most likely because of a navigation.");
      },
      { maxAttempts: 3, sleep: async () => undefined },
    ),
    /Execution context was destroyed/,
  );
  assert.equal(attempts, 3);
});

test("Facebook page operation does not swallow unrelated errors", async () => {
  let attempts = 0;
  await assert.rejects(
    retryFacebookPageOperation(
      async () => {
        attempts += 1;
        throw new Error("Unexpected extraction failure");
      },
      { sleep: async () => undefined },
    ),
    /Unexpected extraction failure/,
  );
  assert.equal(attempts, 1);
});

test("Facebook extraction diagnostics preserve the lifecycle stage", () => {
  const mapped = facebookErrorToListingFetchError(
    new FacebookExtractionError(
      "FACEBOOK_EXTRACTION_FAILED",
      "Attempted to use detached Frame 'frame-1'.",
      { stage: "page-read", lifecycle: { pageClosed: true } },
    ),
  );
  assert.equal(mapped.diagnostics?.stage, "page-read");
  assert.equal(mapped.diagnostics?.lifecycle?.pageClosed, true);
});

test("Facebook lifecycle diagnostics capture target and process closure evidence", () => {
  type Listener = (...args: unknown[]) => void;
  const browserListeners = new Map<string, Listener>();
  const pageListeners = new Map<string, Listener>();
  const processListeners = new Map<string, Listener>();
  const stderrListeners = new Map<string, Listener>();
  const pageTarget = {};
  const memory = { nodeRssBytes: 123, cgroupCurrentBytes: 456 };
  let currentTime = 1000;
  let pageClosed = false;
  let browserConnected = true;
  const tracker = createFacebookLifecycleTracker(
    1000,
    1800,
    () => currentTime,
    () => memory,
  );

  currentTime = 1100;
  tracker.markBrowserLaunched();
  tracker.attach(
    {
      isConnected: () => browserConnected,
      process: () => ({
        exitCode: null,
        signalCode: null,
        killed: false,
        spawnargs: ["/tmp/chromium", "--single-process"],
        stderr: {
          on: (event, listener) => stderrListeners.set(event, listener),
        },
        on: (event, listener) => processListeners.set(event, listener),
      }),
      on: (event, listener) => browserListeners.set(event, listener),
    },
    {
      isClosed: () => pageClosed,
      target: () => pageTarget,
      on: (event, listener) => pageListeners.set(event, listener),
    },
  );

  currentTime = 1200;
  tracker.markNavigationStarted();
  currentTime = 1300;
  tracker.markNavigationFinished(true);
  currentTime = 1400;
  browserListeners.get("targetchanged")?.(pageTarget);
  currentTime = 1500;
  pageListeners.get("error")?.(new Error("Page crashed"));
  stderrListeners.get("data")?.("[ERROR] renderer terminated\n");
  currentTime = 1600;
  pageClosed = true;
  browserConnected = false;
  pageListeners.get("close")?.();
  browserListeners.get("targetdestroyed")?.(pageTarget);
  browserListeners.get("disconnected")?.();
  processListeners.get("exit")?.(null, "SIGKILL");
  processListeners.get("close")?.(null, "SIGKILL");
  currentTime = 1900;

  assert.deepEqual(tracker.snapshot(), {
    pageClosed: true,
    pageCloseEvent: true,
    pageError: "Page crashed",
    browserConnected: false,
    browserDisconnectedEvent: true,
    targetCreatedCount: 0,
    targetChangedCount: 1,
    targetDestroyedCount: 1,
    pageTargetChangedCount: 1,
    pageTargetDestroyed: true,
    browserProcessExitEvent: true,
    browserProcessCloseEvent: true,
    browserProcessExitCode: null,
    browserProcessSignal: "SIGKILL",
    browserProcessKilled: false,
    browserProcessSpawnArgs: ["/tmp/chromium", "--single-process"],
    browserStderrTail: "[ERROR] renderer terminated\n",
    elapsedSinceBrowserLaunchMs: 800,
    elapsedSinceRequestStartMs: 900,
    msSinceBrowserDisconnect: 300,
    cleanupStarted: false,
    deadlineExpired: true,
    navigationActive: false,
    lastNavigationSucceeded: true,
    msSinceLastNavigation: 600,
    msSinceLastTargetChange: 500,
    memoryAtRequestStart: memory,
    memoryAtBrowserLaunch: memory,
    memoryAfterNavigation: memory,
    memoryAtFailure: memory,
  });
  tracker.markCleanupStarted();
  assert.equal(tracker.snapshot().cleanupStarted, true);
});

test("Facebook lifecycle diagnostics allow process events to catch up after disconnect", async () => {
  type Listener = (...args: unknown[]) => void;
  const browserListeners = new Map<string, Listener>();
  const processListeners = new Map<string, Listener>();
  const tracker = createFacebookLifecycleTracker(0, 1000, () => 100, () => ({}));
  tracker.attachBrowser({
    isConnected: () => false,
    process: () => ({
      exitCode: null,
      signalCode: null,
      on: (event, listener) => processListeners.set(event, listener),
    }),
    on: (event, listener) => browserListeners.set(event, listener),
  });
  browserListeners.get("disconnected")?.();

  await tracker.waitForTerminationDetails(75, async (delayMs) => {
    assert.equal(delayMs, 75);
    processListeners.get("exit")?.(137, null);
  });

  assert.equal(tracker.snapshot().browserProcessExitEvent, true);
  assert.equal(tracker.snapshot().browserProcessExitCode, 137);
});

test("Facebook render wait reacquires state after a detached frame", async () => {
  let checks = 0;
  await waitForFacebookRenderReadiness(
    async () => {
      checks += 1;
      if (checks === 1) throw new Error("Attempted to use detached Frame 'frame-1'.");
      return checks >= 3;
    },
    { sleep: async () => undefined },
  );
  assert.equal(checks, 4);
});

test("Facebook render wait bounds repeated detached-frame checks", async () => {
  let checks = 0;
  await assert.rejects(
    waitForFacebookRenderReadiness(
      async () => {
        checks += 1;
        throw new Error("Attempted to use detached Frame 'frame-2'.");
      },
      { maxChecks: 3, sleep: async () => undefined },
    ),
    /Attempted to use detached Frame/,
  );
  assert.equal(checks, 3);
});

test("Facebook render wait respects its deadline", async () => {
  let checks = 0;
  await assert.rejects(
    waitForFacebookRenderReadiness(
      async () => {
        checks += 1;
        return false;
      },
      { deadline: 100, now: () => 100, sleep: async () => undefined },
    ),
    /render wait timed out/,
  );
  assert.equal(checks, 0);
});

test("Facebook render wait propagates unrelated errors", async () => {
  let checks = 0;
  await assert.rejects(
    waitForFacebookRenderReadiness(
      async () => {
        checks += 1;
        throw new Error("Unexpected render failure");
      },
      { sleep: async () => undefined },
    ),
    /Unexpected render failure/,
  );
  assert.equal(checks, 1);
});

test("Facebook render wait exits after consecutive successful readiness checks", async () => {
  let checks = 0;
  await waitForFacebookRenderReadiness(
    async () => {
      checks += 1;
      return true;
    },
    { sleep: async () => undefined },
  );
  assert.equal(checks, 2);
});

test("Facebook render wait fails when readiness never arrives", async () => {
  let checks = 0;
  await assert.rejects(
    waitForFacebookRenderReadiness(
      async () => {
        checks += 1;
        return false;
      },
      { maxChecks: 3, sleep: async () => undefined },
    ),
    /render wait timed out before readiness/,
  );
  assert.equal(checks, 3);
});

// ---------------------------------------------------------------------------
// Facebook render readiness
//
// Regression cover for the Cloudways failure: the render wait abandoned polling
// after a fixed 18 x 200 ms (~3.4 s) no matter how much of the extraction
// deadline remained, and the first gate demanded a /marketplace/item/ URL that
// only the later share-resolution step could discover.
// ---------------------------------------------------------------------------

test("render wait budget follows the extraction deadline instead of a fixed ceiling", () => {
  // The old fixed ceiling was 18 polls. A 25 s budget must allow far more.
  assert.equal(facebookRenderWaitBudget(25_000, () => 0).maxChecks, 125);
  assert.equal(facebookRenderWaitBudget(25_000, () => 0).pollIntervalMs, 200);
  // Already spent budget reduces the polls rather than being ignored.
  assert.equal(facebookRenderWaitBudget(25_000, () => 23_000).maxChecks, 10);
  // A tiny or exhausted remainder still gets a floor so the wait is not skipped.
  assert.equal(facebookRenderWaitBudget(25_000, () => 24_950).maxChecks, 3);
  assert.equal(facebookRenderWaitBudget(1, () => 1_000).maxChecks, 3);
  // No deadline means the hard ceiling, which still exceeds the historical 18.
  const unbounded = facebookRenderWaitBudget(undefined);
  assert.equal(unbounded.maxChecks, 200);
  assert.equal(unbounded.maxChecks > 18, true);
});

test("render wait polls for the whole remaining budget, not 18 checks", async () => {
  let checks = 0;
  await assert.rejects(
    waitForFacebookRenderReadiness(
      async () => {
        checks += 1;
        return false;
      },
      { deadline: 25_000, now: () => 0, sleep: async () => undefined },
    ),
    /render wait timed out before readiness/,
  );
  assert.equal(checks, 125, "the wait must use the derived budget");
});

test("render wait reports why it stopped instead of one generic timeout", async () => {
  const outcomeOf = async (
    check: () => Promise<boolean>,
    options: Parameters<typeof waitForFacebookRenderReadiness>[1],
  ) => {
    try {
      await waitForFacebookRenderReadiness(check, options);
      return "ready" as const;
    } catch (error) {
      assert.ok(error instanceof FacebookRenderWaitError);
      return error.outcome;
    }
  };

  assert.equal(
    await outcomeOf(async () => false, { deadline: 100, now: () => 100, sleep: async () => undefined }),
    "deadline",
  );
  assert.equal(
    await outcomeOf(async () => false, { maxChecks: 2, sleep: async () => undefined }),
    "checks-exhausted",
  );
  assert.equal(
    await outcomeOf(async () => {
      throw new Error("Attempted to use detached Frame 'x'.");
    }, { maxChecks: 2, sleep: async () => undefined }),
    "transient-error",
  );
  assert.equal(
    await outcomeOf(async () => true, {
      terminalCheck: () => true,
      sleep: async () => undefined,
    }),
    "terminal",
  );
});

test("render wait stops early on a blocking page instead of burning the budget", async () => {
  let checks = 0;
  await assert.rejects(
    waitForFacebookRenderReadiness(
      async () => {
        checks += 1;
        return false;
      },
      {
        deadline: 25_000,
        now: () => 0,
        sleep: async () => undefined,
        terminalCheck: () => true,
      },
    ),
    (error: unknown) => error instanceof FacebookRenderWaitError && error.outcome === "terminal",
  );
  assert.equal(checks, 0, "a wall must be detected before any further polling");
});

test("a terminal verdict never counts towards required ready checks", async () => {
  // Mirrors settle(): the probe reports terminal, the check returns false, and
  // terminalCheck aborts. A wall can therefore never be reported as ready.
  const state = { verdict: "terminal" as "ready" | "pending" | "terminal" };
  const check = async () => state.verdict === "ready";
  const run = async () => {
    try {
      await waitForFacebookRenderReadiness(check, {
        deadline: 25_000,
        now: () => 0,
        sleep: async () => undefined,
        terminalCheck: () => state.verdict === "terminal",
      });
      return "ready";
    } catch (error) {
      assert.ok(error instanceof FacebookRenderWaitError);
      return error.outcome;
    }
  };
  assert.equal(await run(), "terminal");

  state.verdict = "pending";
  assert.equal(await run(), "checks-exhausted");

  state.verdict = "ready";
  assert.equal(await run(), "ready");
});

const probe = (overrides: Record<string, unknown> = {}) =>
  summarizeFacebookRenderProbe({
    host: "www.facebook.com",
    path: "/marketplace/item/1234567890/",
    title: "2018 Toyota Corolla LE | Facebook",
    readyState: "complete",
    bodyTextLength: 2400,
    hasOgUrl: true,
    hasMarketplaceMarker: true,
    hasListingDetailMarkers: true,
    ...overrides,
  } as never);

test("Facebook path and title are classified without retaining their contents", () => {
  assert.equal(classifyFacebookPath("/marketplace/item/1234567890/"), "marketplace-item");
  assert.equal(classifyFacebookPath("/share/1HjKAsQwoy/"), "share");
  assert.equal(classifyFacebookPath("/login/device-based/regular/login/"), "login");
  assert.equal(classifyFacebookPath("/checkpoint/d/"), "checkpoint");
  assert.equal(classifyFacebookPath("/consent/"), "consent");
  assert.equal(classifyFacebookPath("/"), "home");
  assert.equal(classifyFacebookPath("/groups/12345"), "other");

  assert.equal(classifyFacebookPageTitle("Log in to Facebook"), "login");
  assert.equal(classifyFacebookPageTitle("Facebook - Checkpoint Required"), "checkpoint");
  assert.equal(classifyFacebookPageTitle("Facebook Cookie Consent"), "consent");
  assert.equal(classifyFacebookPageTitle("This content isn't available right now"), "unavailable");
  assert.equal(classifyFacebookPageTitle("Facebook Marketplace | Buy and Sell"), "marketplace");
  assert.equal(classifyFacebookPageTitle("2018 Toyota Corolla LE | Facebook"), "facebook-page");
  assert.equal(classifyFacebookPageTitle(""), "empty");
  assert.equal(classifyFacebookPageTitle("Something else"), "other");

  // The summary carries categories and counts, never the raw path or title.
  const summary = probe();
  assert.equal(summary.pathCategory, "marketplace-item");
  assert.equal(summary.titleCategory, "facebook-page");
  assert.equal("path" in summary, false);
  assert.equal("title" in summary, false);
  assert.equal(summary.bodyTextLength, 2400);
});

test("readiness still requires a settled page with Marketplace item evidence", () => {
  // The predicate itself is unchanged: weakening it would let the caller read
  // the page before Facebook finished resolving the share URL.
  const onSharePage = probe({
    path: "/share/1HjKAsQwoy/",
    hasMarketplaceMarker: false,
    hasListingDetailMarkers: false,
  });
  const pending = evaluateFacebookRenderGate(onSharePage);
  assert.equal(pending.verdict, "pending");
  assert.equal(pending.predicates.readyStateComplete, true);
  assert.equal(pending.predicates.hasBodyText, true);
  assert.equal(
    pending.predicates.hasMarketplaceItemMarker,
    false,
    "an unresolved share URL must not be treated as ready",
  );

  // Ready once the item evidence appears, by location path or by og:url.
  assert.equal(evaluateFacebookRenderGate(probe()).verdict, "ready");
  assert.equal(
    evaluateFacebookRenderGate(
      probe({ path: "/share/1HjKAsQwoy/", hasMarketplaceMarker: true }),
    ).verdict,
    "ready",
    "client-side resolution via og:url counts as ready",
  );

  // Still pending while the document is loading or has no text at all.
  assert.equal(evaluateFacebookRenderGate(probe({ readyState: "loading" })).verdict, "pending");
  assert.equal(evaluateFacebookRenderGate(probe({ bodyTextLength: 0 })).verdict, "pending");
  assert.equal(
    evaluateFacebookRenderGate(probe({ hasMarketplaceMarker: false })).verdict,
    "pending",
  );
});

test("a login wall, consent interstitial or checkpoint is terminal", () => {
  const cases: { path: string; title: string; category: string }[] = [
    { path: "/login/device-based/regular/login/", title: "Log in to Facebook", category: "login" },
    { path: "/consent/", title: "Facebook Consent", category: "consent" },
    { path: "/checkpoint/d/", title: "Facebook", category: "checkpoint" },
  ];
  for (const entry of cases) {
    const evaluation = evaluateFacebookRenderGate(probe({ path: entry.path, title: entry.title }));
    assert.equal(evaluation.verdict, "terminal", entry.category);
  }
  // A title-only wall is terminal too.
  assert.equal(evaluateFacebookRenderGate(probe({ title: "Log in to Facebook" })).verdict, "terminal");
});

test("a stalled render wait is classified into a specific, actionable outcome", () => {
  const withProbe = (overrides: Record<string, unknown>) => probe(overrides);

  assert.deepEqual(
    classifyFacebookRenderFailure({
      probe: withProbe({ path: "/login/", title: "Log in to Facebook" }),
      outcome: "checks-exhausted",
    }),
    {
      reason: "login-wall",
      code: "FACEBOOK_LOGIN_REQUIRED",
      message: "Facebook served a login wall instead of the listing.",
    },
  );
  assert.equal(
    classifyFacebookRenderFailure({
      probe: withProbe({ path: "/consent/", title: "Facebook" }),
      outcome: "checks-exhausted",
    }).code,
    "FACEBOOK_CONSENT_REQUIRED",
  );
  assert.equal(
    classifyFacebookRenderFailure({
      probe: withProbe({ path: "/checkpoint/d/", title: "Facebook" }),
      outcome: "checks-exhausted",
    }).code,
    "FACEBOOK_BLOCKED",
  );
  assert.equal(
    classifyFacebookRenderFailure({
      probe: withProbe({ title: "This content isn't available right now" }),
      outcome: "checks-exhausted",
    }).reason,
    "listing-unavailable",
  );
  assert.equal(
    classifyFacebookRenderFailure({
      probe: withProbe({ bodyTextLength: 0 }),
      outcome: "checks-exhausted",
    }).reason,
    "empty-page",
  );
  // Listing evidence present but readiness never stabilised.
  assert.equal(
    classifyFacebookRenderFailure({
      probe: withProbe({ path: "/share/1HjKAsQwoy/", hasMarketplaceMarker: false }),
      outcome: "checks-exhausted",
    }).reason,
    "listing-rendered-predicate-missed",
  );
  // A real deadline and a real navigation failure stay distinct from all of the above.
  assert.equal(
    classifyFacebookRenderFailure({ probe: probe(), outcome: "deadline" }).reason,
    "deadline-exceeded",
  );
  assert.equal(
    classifyFacebookRenderFailure({ probe: null, outcome: "deadline" }).code,
    "FACEBOOK_NAVIGATION_TIMEOUT",
  );
  assert.equal(
    classifyFacebookRenderFailure({ probe: null, outcome: "navigation-failure" }).reason,
    "navigation-failure",
  );

  // Every reason maps to a distinct, non-generic classification.
  const reasons = [
    "login-wall",
    "consent-interstitial",
    "checkpoint-block",
    "listing-unavailable",
    "empty-page",
    "listing-rendered-predicate-missed",
  ].map((reason) =>
    classifyFacebookRenderFailure({
      probe:
        reason === "login-wall"
          ? withProbe({ path: "/login/", title: "Log in to Facebook" })
          : reason === "consent-interstitial"
            ? withProbe({ path: "/consent/" })
            : reason === "checkpoint-block"
              ? withProbe({ path: "/checkpoint/d/" })
              : reason === "listing-unavailable"
                ? withProbe({ title: "This content isn't available right now" })
                : reason === "empty-page"
                  ? withProbe({ bodyTextLength: 0 })
                  : withProbe({}),
      outcome: "checks-exhausted",
    }),
  );
  assert.equal(new Set(reasons.map((entry) => entry.reason)).size, reasons.length);
  assert.equal(
    reasons.some((entry) => entry.code === "FACEBOOK_EXTRACTION_FAILED"),
    false,
    "a stalled render must never be reported as an undifferentiated failure",
  );
});

test("Facebook serverless launch restores the Sparticuz SwiftShader graphics stack", async () => {
  let graphicsMode = false;
  const baseArgs = ["--single-process", "--ignore-gpu-blocklist", "--in-process-gpu"];
  const chromium = {
    get args() {
      return graphicsMode
        ? [
            ...baseArgs,
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--no-sandbox",
          ]
        : [...baseArgs, "--disable-webgl", "--no-sandbox"];
    },
    executablePath: async () => "/tmp/chromium",
    set setGraphicsMode(value: boolean) {
      graphicsMode = value;
    },
  };
  assert.deepEqual(await facebookServerlessChromiumLaunchOptions(chromium), {
    args: [
      ...baseArgs,
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
    ],
    executablePath: "/tmp/chromium",
    headless: "shell",
  });
  assert.equal(graphicsMode, true);
});

test("Facebook Render launch uses Sparticuz without single-process GPU flags", async () => {
  let graphicsMode = false;
  const chromium = {
    get args() {
      return graphicsMode
        ? [
            "--single-process",
            "--in-process-gpu",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--no-sandbox",
          ]
        : [];
    },
    executablePath: async () => "/tmp/chromium",
    set setGraphicsMode(value: boolean) {
      graphicsMode = value;
    },
  };
  const launch = await facebookRenderChromiumLaunchOptions(chromium);
  assert.equal(launch.name, "D-no-single-process-or-in-process-gpu");
  assert.deepEqual(launch.removedArgs, ["--single-process", "--in-process-gpu"]);
  assert.equal(launch.args.includes("--single-process"), false);
  assert.equal(launch.args.includes("--in-process-gpu"), false);
  assert.equal(launch.args.includes("--use-gl=angle"), true);
  assert.equal(launch.args.includes("--use-angle=swiftshader"), true);
  assert.equal(launch.args.includes("--enable-unsafe-swiftshader"), true);
  assert.equal(launch.executablePath, "/tmp/chromium");
  assert.equal(launch.headless, "shell");
});

test("Facebook serverless graphics validation rejects disabled or incomplete GPU stacks", () => {
  assert.throws(
    () =>
      validateFacebookChromiumGraphicsArgs([
        "--in-process-gpu",
        "--disable-webgl",
      ]),
    /missing: --use-gl=angle.*conflicting: --disable-webgl/,
  );
});

test("Facebook Vercel launch matrix changes only the two controlled process flags", () => {
  const control = [
    "--ash-no-nudges",
    "--single-process",
    "--ignore-gpu-blocklist",
    "--in-process-gpu",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--no-zygote",
  ];
  const variants = buildFacebookChromiumArgvVariants(control);
  assert.deepEqual(
    variants.map(({ name, removedArgs }) => ({ name, removedArgs })),
    [
      { name: "A-control", removedArgs: [] },
      { name: "B-no-in-process-gpu", removedArgs: ["--in-process-gpu"] },
      { name: "C-no-single-process", removedArgs: ["--single-process"] },
      {
        name: "D-no-single-process-or-in-process-gpu",
        removedArgs: ["--single-process", "--in-process-gpu"],
      },
    ],
  );
  assert.deepEqual(variants[0].args, control);
  assert.equal(variants[1].args.includes("--in-process-gpu"), false);
  assert.equal(variants[1].args.includes("--single-process"), true);
  assert.equal(variants[2].args.includes("--single-process"), false);
  assert.equal(variants[2].args.includes("--in-process-gpu"), true);
  assert.equal(variants[3].args.includes("--single-process"), false);
  assert.equal(variants[3].args.includes("--in-process-gpu"), false);
  for (const variant of variants) {
    assert.equal(variant.args.includes("--use-gl=angle"), true);
    assert.equal(variant.args.includes("--use-angle=swiftshader"), true);
    assert.equal(variant.args.includes("--enable-unsafe-swiftshader"), true);
    assert.equal(variant.args.includes("--disable-gpu"), false);
    assert.equal(variant.args.includes("--disable-webgl"), false);
  }
});

test("Facebook Vercel launch matrix is sequential and stops at the first survivor", async () => {
  const variants = ["A", "B", "C", "D"];
  const attempts: string[] = [];
  let activeBrowsers = 0;
  let maximumActiveBrowsers = 0;
  const result = await runFacebookChromiumLaunchMatrix(variants, async (variant) => {
    attempts.push(variant);
    activeBrowsers += 1;
    maximumActiveBrowsers = Math.max(maximumActiveBrowsers, activeBrowsers);
    try {
      if (variant !== "C") {
        throw new FacebookExtractionError("FACEBOOK_EXTRACTION_FAILED", "Target closed", {
          lifecycle: {
            browserConnected: false,
            browserDisconnectedEvent: true,
            browserProcessExitEvent: true,
            browserProcessCloseEvent: true,
            browserProcessSignal: "SIGSEGV",
            deadlineExpired: false,
          },
        });
      }
      return "survived";
    } finally {
      activeBrowsers -= 1;
    }
  });
  assert.equal(result, "survived");
  assert.deepEqual(attempts, ["A", "B", "C"]);
  assert.equal(maximumActiveBrowsers, 1);
});

test("Facebook Vercel launch matrix does not retry non-process extraction failures", async () => {
  const attempts: string[] = [];
  await assert.rejects(
    runFacebookChromiumLaunchMatrix(["A", "B"], async (variant) => {
      attempts.push(variant);
      throw new FacebookExtractionError(
        "FACEBOOK_LOGIN_REQUIRED",
        "Facebook requires login.",
        { lifecycle: { browserConnected: true, deadlineExpired: false } },
      );
    }),
    /requires login/,
  );
  assert.deepEqual(attempts, ["A"]);
});

test("Facebook browser reuses the launch page instead of creating another renderer", async () => {
  const initialPage = { id: "initial" };
  let newPageCalls = 0;
  const page = await reuseOrCreateFacebookPage({
    pages: async () => [initialPage],
    newPage: async () => {
      newPageCalls += 1;
      return { id: "new" };
    },
  });
  assert.equal(page, initialPage);
  assert.equal(newPageCalls, 0);
});

test("Facebook runtime diagnostics read Node and cgroup memory evidence", () => {
  const files: Record<string, string> = {
    "/sys/fs/cgroup/memory.current": "1000\n",
    "/sys/fs/cgroup/memory.peak": "2000\n",
    "/sys/fs/cgroup/memory.max": "3000\n",
    "/sys/fs/cgroup/memory.events": "low 0\noom 2\noom_kill 1\n",
  };
  assert.deepEqual(
    readFacebookRuntimeMemoryDiagnostics(
      (path) => {
        if (!(path in files)) throw new Error("missing");
        return files[path];
      },
      () => ({
        rss: 10,
        heapTotal: 20,
        heapUsed: 30,
        external: 40,
        arrayBuffers: 50,
      }),
    ),
    {
      nodeRssBytes: 10,
      nodeHeapUsedBytes: 30,
      nodeExternalBytes: 40,
      nodeArrayBuffersBytes: 50,
      cgroupCurrentBytes: 1000,
      cgroupPeakBytes: 2000,
      cgroupLimitBytes: 3000,
      cgroupMemoryEvents: { low: 0, oom: 2, oom_kill: 1 },
      cgroupOomEvents: 2,
      cgroupOomKillEvents: 1,
    },
  );
});

test("Facebook runtime diagnostics explicitly report unavailable cgroup fields", () => {
  assert.deepEqual(
    readFacebookRuntimeMemoryDiagnostics(
      () => {
        throw new Error("not mounted");
      },
      () => ({
        rss: 10,
        heapTotal: 20,
        heapUsed: 30,
        external: 40,
        arrayBuffers: 50,
      }),
    ),
    {
      nodeRssBytes: 10,
      nodeHeapUsedBytes: 30,
      nodeExternalBytes: 40,
      nodeArrayBuffersBytes: 50,
      cgroupCurrentBytes: null,
      cgroupPeakBytes: null,
      cgroupLimitBytes: null,
      cgroupMemoryEvents: null,
      cgroupOomEvents: null,
      cgroupOomKillEvents: null,
    },
  );
});

test("listing failure logs serialize nested browser memory values", () => {
  const serialized = serializeListingFetchErrorForLog(
    new ListingFetchError("network-error", "Chromium crashed.", 502, {
      stage: "render-wait",
      lifecycle: {
        browserProcessSignal: "SIGSEGV",
        memoryAtFailure: {
          nodeRssBytes: 123,
          cgroupCurrentBytes: 456,
          cgroupPeakBytes: 789,
          cgroupLimitBytes: 2048,
          cgroupOomEvents: 0,
          cgroupOomKillEvents: 0,
        },
      },
    }),
  );
  const logged = JSON.parse(serialized);
  assert.deepEqual(logged.diagnostics.lifecycle.memoryAtFailure, {
    nodeRssBytes: 123,
    cgroupCurrentBytes: 456,
    cgroupPeakBytes: 789,
    cgroupLimitBytes: 2048,
    cgroupOomEvents: 0,
    cgroupOomKillEvents: 0,
  });
  assert.equal(logged.diagnostics.lifecycle.browserProcessSignal, "SIGSEGV");
});

test("Facebook login controls do not override primary listing evidence", () => {
  const bodyText = `Log in to continue
1998 BMW 5 Series
CA$4,999
About this vehicle
Driven 271,000 km
Automatic transmission
Seller's description
Available.`;
  assert.equal(
    detectFacebookPageState(
      "https://www.facebook.com/marketplace/item/4263002720500667/",
      bodyText,
    ),
    "listing-available",
  );
});

test("Facebook authentication walls require login when no listing is available", () => {
  assert.equal(
    detectFacebookPageState(
      "https://www.facebook.com/login/?next=%2Fmarketplace%2Fitem%2F4263002720500667%2F",
      "Log in to continue\nEmail or phone number\nPassword",
    ),
    "login-required",
  );
});

test("Facebook Marketplace metadata permits extraction despite login UI", () => {
  assert.equal(
    detectFacebookPageState(
      "https://www.facebook.com/share/1HjKAsQwoy/",
      "Log in to continue\nCreate new account",
      "https://www.facebook.com/marketplace/item/4263002720500667/",
    ),
    "listing-available",
  );
});

test("Facebook recommendations do not count as primary listing evidence", () => {
  assert.equal(
    detectFacebookPageState(
      "https://www.facebook.com/login/",
      "Log in to continue\nToday's picks\nCA$2,200\n2010 Ford Ranger\nDriven 120,000 km",
    ),
    "login-required",
  );
});

test("Facebook rendered parser isolates the primary listing from recommendations", () => {
  const bodyText = `Log In
1998 BMW 5 series
CA$4,999
Listed 6 weeks ago in MontrÃ©al, QC
Message
Save
Share
About this vehicle
Driven 271,000 km
Automatic transmission
Exterior color: White Â· Interior color: Black
Fuel type: Gasoline
3+ owners
Seller's description
V6
Si vous voyez l'annonce, il est disponible.
See more
MontrÃ©al, QC Â· Location is approximate
Today's picks
MontrÃ©al
CA$2,200
2010 Ford ranger
Ste-ThÃ©rÃ¨se, QC`;
  const primary = primaryFacebookListingText(bodyText);
  assert.match(primary, /1998 BMW 5 series/);
  assert.doesNotMatch(primary, /2010 Ford ranger/);

  const result = extractFacebookListingFromRenderedText({
    bodyText,
    canonicalUrl: "https://www.facebook.com/marketplace/item/4263002720500667/",
    finalUrl: "https://www.facebook.com/marketplace/item/4263002720500667/",
    itemId: "4263002720500667",
    title:
      "1998 BMW 5 Series - Cars & Trucks - Montreal, Quebec | Facebook Marketplace | Facebook",
    ogTitle: "1998 BMW 5 Series",
    ogDescription: "V6",
  });
  assert.equal(result.details.listingSource, "facebook.com");
  assert.equal(
    result.details.listingUrl,
    "https://www.facebook.com/marketplace/item/4263002720500667/",
  );
  assert.equal(result.details.year, 1998);
  assert.equal(result.details.make, "BMW");
  assert.equal(result.details.model, "5 Series");
  assert.equal(result.details.askingPriceCad, 4999);
  assert.equal(result.details.priceCurrency, "CAD");
  assert.equal(result.details.mileageKm, 271000);
  assert.equal(result.details.mileageUnit, "km");
  assert.equal(result.details.transmission, "Automatic");
  assert.equal(result.details.location, "MontrÃ©al, QC");
  assert.equal(result.details.city, "MontrÃ©al");
  assert.match(result.details.sellerDescription ?? "", /Gasoline/);
  assert.match(result.details.sellerDescription ?? "", /White/);
  assert.match(result.details.sellerDescription ?? "", /3\+ owners/);
  assert.doesNotMatch(result.details.sellerDescription ?? "", /Ford ranger/);
  assert.equal(result.provenance.mileageKm?.source, "facebook-rendered");
});

test("listing extraction API returns structured fields without page HTML", async () => {
  const handler = createListingExtractionPostHandler(async () => ({
    finalUrl: "https://dealer.example/listing",
    status: 200,
    html: `<!doctype html><title>2021 Toyota Corolla LE</title><meta name="description" content="$18,995. 82,300 km.">`,
  }));
  const response = await handler(
    new Request("http://localhost/api/listing-extraction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://dealer.example/listing" }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.extraction.details.make, "Toyota");
  assert.equal(body.extraction.details.model, "Corolla");
  assert.equal(body.extraction.details.askingPriceCad, 18995);
  assert.equal(body.extraction.details.mileageKm, 82300);
  assert.equal(JSON.stringify(body).includes("<title>"), false);
});

test("listing URL SSRF guard rejects dangerous targets", async () => {
  for (const url of [
    "http://localhost/listing",
    "http://127.0.0.1/listing",
    "http://10.0.0.2/listing",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/listing",
    "file:///etc/passwd",
    "https://user:pass@example.com/listing",
    "not a url",
  ]) {
    await assert.rejects(() => resolvePublicUrl(url), ListingFetchError, url);
  }
});

test("listing URL SSRF guard validates unsafe redirect destinations", async () => {
  await assert.rejects(
    () => resolvePublicUrl("http://127.0.0.1/redirect-target"),
    { name: "ListingFetchError", code: "unsafe-url" },
  );
});

async function withServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("listing fetch rejects timeout, oversized and non-HTML responses", async () => {
  await withServer(
    (_request, response) => {
      setTimeout(() => response.end("<html>slow</html>"), 80);
    },
    async (baseUrl) => {
      await assert.rejects(
        () =>
          fetchPublicListingHtml(baseUrl, {
            timeoutMs: 10,
            testOnlyAllowPrivateNetwork: true,
          }),
        { name: "ListingFetchError", code: "timeout" },
      );
    },
  );

  await withServer(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<html>" + "x".repeat(200) + "</html>");
    },
    async (baseUrl) => {
      await assert.rejects(
        () =>
          fetchPublicListingHtml(baseUrl, {
            maxBodyBytes: 40,
            testOnlyAllowPrivateNetwork: true,
          }),
        { name: "ListingFetchError", code: "too-large" },
      );
    },
  );

  await withServer(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    },
    async (baseUrl) => {
      await assert.rejects(
        () =>
          fetchPublicListingHtml(baseUrl, {
            testOnlyAllowPrivateNetwork: true,
          }),
        { name: "ListingFetchError", code: "non-html" },
      );
    },
  );
});

test("listing fetch falls back to the next validated resolved address", async () => {
  await withServer(
    (request, response) => {
      assert.match(request.headers.host ?? "", /^public\.test:/);
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>2021 Toyota Corolla LE</title>");
    },
    async (baseUrl) => {
      const port = new URL(baseUrl).port;
      const result = await fetchPublicListingHtml(`http://public.test:${port}/listing`, {
        testOnlyAllowPrivateNetwork: true,
        timeoutMs: 500,
        lookup: async () => [
          { address: "127.0.0.2", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      });
      assert.equal(result.status, 200);
      assert.match(result.html, /Toyota Corolla/);
    },
  );
});
test("image metadata validation", () => {
  assert.equal(
    validatePhotos([{ name: "a.jpg", type: "image/jpeg", size: 100 }]),
    null,
  );
  assert.ok(
    validatePhotos([{ name: "a.svg", type: "image/svg+xml", size: 100 }]),
  );
  assert.ok(
    validatePhotos([{ name: "a.png", type: "image/png", size: 11000000 }]),
  );
});
test("booking rejects past times, malformed dates and invalid contacts", () => {
  const now = new Date("2026-09-10T12:00:00");
  const valid = {
    buyerName: "Alex",
    buyerPhone: "514-555-0198",
    buyerEmail: "alex@example.com",
    vehicleTitle: "Honda Civic",
    vehicleVin: "",
    sellerContact: "Seller",
    vehicleAddress: "Laval",
    preferredDate: "2026-09-11",
    preferredTime: "14:30",
  };
  assert.deepEqual(validateBooking(valid, now), []);
  assert.ok(
    validateBooking({ ...valid, preferredDate: "2026-09-09" }, now).length,
  );
  assert.ok(
    validateBooking({ ...valid, preferredDate: "2026-02-30" }, now).length,
  );
  assert.ok(
    validateBooking(
      { ...valid, buyerPhone: "abc", buyerEmail: "x", vehicleVin: "bad" },
      now,
    ).length >= 3,
  );
});
test("failed storage writes keep the newest draft ahead of readable stale data", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let raw = JSON.stringify({ step: 0, method: "text" });
  let quotaExceeded = true;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        if (quotaExceeded) throw new Error("QuotaExceededError");
        raw = value;
      },
    } },
  });
  try {
    const draft = { step: 1, method: "manual" };
    assert.equal(writeLocal("intake-draft", draft), false);
    assert.deepEqual(readLocal("intake-draft"), draft);
    assert.equal(JSON.parse(raw).step, 0);
    quotaExceeded = false;
    assert.equal(writeLocal("intake-draft", draft), true);
    raw = JSON.stringify({ step: 2, method: "manual" });
    assert.deepEqual(readLocal("intake-draft"), { step: 2, method: "manual" });
  } finally {
    clearLocalData();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("storage denial is handled without crashing", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new Error("blocked");
      },
    },
  });
  try {
    assert.equal(writeLocal("test", { saved: true }), false);
    assert.deepEqual(readLocal("test"), { saved: true });
    assert.equal(clearLocalData(), false);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

const validContact = {
  topic: "Buyer support",
  name: "  Alex   Buyer  ",
  email: " ALEX@EXAMPLE.COM ",
  message: "  Please help with this listing.\r\nThank you.  ",
};

test("valid contact payload is normalized", () => {
  const result = validateContactSubmission(validContact);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    topic: "Buyer support",
    customerName: "Alex Buyer",
    customerEmail: "alex@example.com",
    message: "Please help with this listing.\nThank you.",
  });
});

test("contact validation rejects invalid email and missing fields", () => {
  const invalidEmail = validateContactSubmission({
    ...validContact,
    email: "not-an-email",
  });
  assert.equal(invalidEmail.ok, false);
  if (!invalidEmail.ok) assert.deepEqual(invalidEmail.fields, ["email"]);

  const missing = validateContactSubmission({});
  assert.equal(missing.ok, false);
  if (!missing.ok)
    assert.deepEqual(missing.fields, ["topic", "name", "email", "message"]);
});

test("contact validation rejects excessive field lengths", () => {
  for (const [field, value] of [
    ["name", "n".repeat(CONTACT_LIMITS.name + 1)],
    ["email", `${"e".repeat(CONTACT_LIMITS.email)}@example.com`],
    ["message", "m".repeat(CONTACT_LIMITS.message + 1)],
  ] as const) {
    const result = validateContactSubmission({ ...validContact, [field]: value });
    assert.equal(result.ok, false, field);
    if (!result.ok) assert.ok(result.fields.includes(field), field);
  }
});

test("contact repository maps a successful insert", async () => {
  let inserted: unknown;
  const repository = createContactMessageRepository(async (row) => {
    inserted = row;
    return { id: "record-1", created_at: "2026-09-28T12:00:00.000Z" };
  });
  const result = await repository.createContactMessage({
    topic: "Buyer support",
    customerName: "Alex Buyer",
    customerEmail: "alex@example.com",
    message: "Help",
  });
  assert.deepEqual(inserted, {
    topic: "Buyer support",
    customer_name: "Alex Buyer",
    customer_email: "alex@example.com",
    message: "Help",
  });
  assert.deepEqual(result, {
    id: "record-1",
    createdAt: "2026-09-28T12:00:00.000Z",
  });
});

test("contact repository converts insert failures to a safe domain error", async () => {
  const repository = createContactMessageRepository(async () => {
    throw new Error("database internals");
  });
  await assert.rejects(
    repository.createContactMessage({
      topic: "Buyer support",
      customerName: "Alex Buyer",
      customerEmail: "alex@example.com",
      message: "Help",
    }),
    { name: "ContactMessagePersistenceError", message: "Contact message persistence failed." },
  );
});

test("contact API accepts valid input without returning PII", async () => {
  let persisted = false;
  const handler = createContactPostHandler({
    async createContactMessage() {
      persisted = true;
      return { id: "record-1", createdAt: new Date().toISOString() };
    },
  });
  const response = await handler(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validContact),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(persisted, true);
  assert.deepEqual(await response.json(), { ok: true });
});

test("contact API rejects invalid, missing, and oversized payloads", async () => {
  const handler = createContactPostHandler({
    async createContactMessage() {
      throw new Error("must not be called");
    },
  });
  for (const body of [
    { ...validContact, email: "bad" },
    { topic: "Buyer support" },
  ]) {
    const response = await handler(
      new Request("http://localhost/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 400);
  }
  const oversized = await handler(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(CONTACT_LIMITS.bodyBytes + 1),
    }),
  );
  assert.equal(oversized.status, 413);
});

test("contact API failure response does not leak repository details", async () => {
  const handler = createContactPostHandler(
    {
      async createContactMessage() {
        throw new Error("relation contact_messages does not exist: secret SQL");
      },
    },
    () => undefined,
  );
  const response = await handler(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validContact),
    }),
  );
  assert.equal(response.status, 503);
  const body = JSON.stringify(await response.json());
  assert.match(body, /couldn't send/i);
  assert.doesNotMatch(body, /contact_messages|secret SQL|relation/i);
});

test("contact client resolves only after success and preserves safe failures", async () => {
  let sentBody = "";
  await submitContactMessage(validContact, async (_input, init) => {
    sentBody = String(init?.body);
    return Response.json({ ok: true }, { status: 201 });
  });
  assert.deepEqual(JSON.parse(sentBody), validContact);

  await assert.rejects(
    submitContactMessage(validContact, async () =>
      Response.json(
        { ok: false, error: "Please retry this message." },
        { status: 503 },
      ),
    ),
    /Please retry this message/,
  );
});

const { submittedAt: _testSubmittedAt, ...finalizedBase } = emptyIntake;
const finalizedRequest = {
  submissionKey: "550e8400-e29b-41d4-a716-446655440000",
  intake: {
    ...finalizedBase,
    make: "  Honda  ", model: " Civic ", year: 2018, trim: " EX ",
    listingUrl: "https://example.test/listing/1", listingText: "  2018 Honda Civic  ",
    mileageKm: 120000, askingPriceCad: 12000, priceCurrency: "cad", city: "Montreal",
    vin: "2hgfb2f50fh123456", sellerDescription: "  Seller note  ",
  },
};

test("finalized intake DTO validates and normalizes an explicit reviewed payload", () => {
  const result = validateFinalizedIntake(finalizedRequest);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.intake.make, "Honda");
  assert.equal(result.value.intake.priceCurrency, "CAD");
  assert.equal(result.value.intake.vin, "2HGFB2F50FH123456");
  assert.equal(result.value.intake.sellerDescription, "Seller note");
});

test("finalized intake DTO rejects unsafe or invalid values", () => {
  for (const request of [
    { ...finalizedRequest, intake: { ...finalizedRequest.intake, vin: "bad" } },
    { ...finalizedRequest, intake: { ...finalizedRequest.intake, year: 1979 } },
    { ...finalizedRequest, intake: { ...finalizedRequest.intake, listingUrl: "javascript:alert(1)" } },
    { ...finalizedRequest, intake: { ...finalizedRequest.intake, mileageKm: -1 } },
    { ...finalizedRequest, intake: { ...finalizedRequest.intake, make: "x".repeat(101) } },
    { ...finalizedRequest, intake: { ...finalizedRequest.intake, arbitraryMetadata: { unsafe: true } } },
  ]) assert.equal(validateFinalizedIntake(request).ok, false);
});

test("finalization API enforces JSON/body limits and returns safe persistence failures", async () => {
  let calls = 0;
  const handler = createFinalizeIntakePostHandler({
    async finalizeIntake() { calls++; return { vehicleId: "vehicle-1", listingId: "listing-1", replayed: false }; },
  }, () => undefined);
  for (const request of [
    new Request("http://localhost/api/intakes/finalize", { method: "POST", body: JSON.stringify(finalizedRequest) }),
    new Request("http://localhost/api/intakes/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
    new Request("http://localhost/api/intakes/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(FINALIZED_INTAKE_LIMITS.bodyBytes + 1) }),
  ]) {
    const response = await handler(request);
    assert.ok([400, 413, 415].includes(response.status));
  }
  const success = await handler(new Request("http://localhost/api/intakes/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(finalizedRequest) }));
  assert.equal(success.status, 201);
  assert.equal(success.headers.get("cache-control"), "no-store");
  assert.deepEqual(await success.json(), { ok: true, vehicleId: "vehicle-1", listingId: "listing-1", replayed: false });
  assert.equal(calls, 1);
});

test("finalized intake repository maps stable IDs and hides database failures", async () => {
  const valid = validateFinalizedIntake(finalizedRequest);
  assert.equal(valid.ok, true); if (!valid.ok) return;
  const repository = createFinalizedIntakeRepository(async () => ({ vehicleId: "vehicle-1", listingId: "listing-1", replayed: true }));
  assert.deepEqual(await repository.finalizeIntake(valid.value), { vehicleId: "vehicle-1", listingId: "listing-1", replayed: true });
  await assert.rejects(createFinalizedIntakeRepository(async () => { throw new Error("SQL detail"); }).finalizeIntake(valid.value), { name: "FinalizedIntakePersistenceError" });
});

test("finalization client posts its supplied key and exposes stable IDs", async () => {
  let sent = "";
  const result = await finalizeIntake({ ...emptyIntake, make: "Honda", model: "Civic" }, finalizedRequest.submissionKey, async (_url, init) => {
    sent = String(init?.body);
    return Response.json({ ok: true, vehicleId: "vehicle-1", listingId: "listing-1", replayed: false }, { status: 201 });
  });
  assert.equal(JSON.parse(sent).submissionKey, finalizedRequest.submissionKey);
  assert.deepEqual(result, { ok: true, vehicleId: "vehicle-1", listingId: "listing-1", submissionKey: finalizedRequest.submissionKey, replayed: false });
});

test("submitted intake context retains the locally generated finalization key", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    get length() { return values.size; }, key: () => null,
  } } });
  try {
    saveSubmittedIntakeContext({ vehicleId: "vehicle-1", listingId: "listing-1", submissionKey: finalizedRequest.submissionKey });
    assert.deepEqual(getSubmittedIntakeContext(), { vehicleId: "vehicle-1", listingId: "listing-1", submissionKey: finalizedRequest.submissionKey });
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
