import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createListingExtractionPostHandler,
  defaultFacebookBrowserExtractor,
} from "../src/server/listing/handler";
import {
  extractFacebookListingFromRenderedText,
  FacebookExtractionError,
  primaryFacebookListingText,
  renderFacebookMarketplaceListing,
  type FacebookRenderedListing,
} from "../src/server/listing/facebook";
import type { BrightDataFacebookExtraction } from "../src/server/listing/brightDataFacebook";
import {
  browserWorkerConfiguration,
  renderFacebookMarketplaceListingForExtraction,
} from "../src/server/listing/browserWorker";

const ITEM_ID = "2056401321697433";
const DIRECT_URL = `https://www.facebook.com/marketplace/item/${ITEM_ID}/`;
const SHARE_URL = "https://www.facebook.com/share/19c3qc4tmr/";

const LISTING_TEXT = `1999 Audi A8
CA$3,200
Listed 17 hours ago in Mirabel, QC

Details
Driven 324000 KM
Automatic transmission
Exterior color: Grey

Seller's description
Audi a8 d2 1999 4.2
324xxx km
Body tout en aluminium ne rouillera jamais
Check engine (catless et evap) et lumière abs

Seller information
Seller details
Jacob
Joined Facebook in 2016

Log in
Similar vehicles with lower price
CA$12,900
2009 Audi A6 V8 4.2
Laval, QC
Related searches`;

function rendered(requestedUrl: string): FacebookRenderedListing {
  return {
    requestedUrl,
    finalUrl: DIRECT_URL,
    canonicalUrl: DIRECT_URL,
    itemId: ITEM_ID,
    title: "1999 Audi A8 | Facebook",
    bodyText: LISTING_TEXT,
    elapsedMs: 1234,
  };
}

function request(url: string): Request {
  return new Request("http://localhost/api/listing-extraction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

function brightResult(url: string): BrightDataFacebookExtraction {
  return {
    extraction: extractFacebookListingFromRenderedText(rendered(url)),
    itemId: ITEM_ID,
    canonicalUrl: DIRECT_URL,
    requestedUrl: url,
    finalUrl: DIRECT_URL,
    httpStatus: 200,
    elapsedMs: 20,
    sold: null,
    recordCount: 1,
    imageCount: 0,
  };
}

test("the normal handler selects the in-process renderer even when a worker is configured", async () => {
  const workerConfiguration = browserWorkerConfiguration({
    AUTOCHECK_WORKER_URL: "https://worker.example.test/extract",
    AUTOCHECK_WORKER_SECRET: "test-worker-secret",
  });

  assert.ok(workerConfiguration);
  assert.equal(defaultFacebookBrowserExtractor, renderFacebookMarketplaceListing);
  assert.notEqual(
    defaultFacebookBrowserExtractor,
    renderFacebookMarketplaceListingForExtraction,
  );

  const originalUrl = process.env.AUTOCHECK_WORKER_URL;
  const originalSecret = process.env.AUTOCHECK_WORKER_SECRET;
  const originalFetch = globalThis.fetch;
  let workerCalls = 0;
  let browserCalls = 0;
  process.env.AUTOCHECK_WORKER_URL = "https://worker.example.test/extract";
  process.env.AUTOCHECK_WORKER_SECRET = "test-worker-secret";
  globalThis.fetch = (async () => {
    workerCalls += 1;
    throw new Error("normal handler must not call the worker");
  }) as typeof fetch;

  try {
    const handler = createListingExtractionPostHandler(
      async () => {
        throw new Error("HTTP metadata must not run after browser success");
      },
      () => undefined,
      (async () => {
        throw new Error("Bright Data must not run after browser success");
      }) as never,
      async (url) => {
        browserCalls += 1;
        return rendered(url);
      },
    );
    const response = await handler(request(DIRECT_URL));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).retrieval.strategy, "browser-rendered");
    assert.equal(browserCalls, 1);
    assert.equal(workerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.AUTOCHECK_WORKER_URL;
    else process.env.AUTOCHECK_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.AUTOCHECK_WORKER_SECRET;
    else process.env.AUTOCHECK_WORKER_SECRET = originalSecret;
  }
});

test("direct Marketplace URLs go straight to Chromium and never invoke Bright Data on success", async () => {
  let browserUrl = "";
  let brightCalls = 0;
  const handler = createListingExtractionPostHandler(
    async () => { throw new Error("HTTP fallback must not run"); },
    () => undefined,
    (async () => { brightCalls += 1; return null; }) as never,
    async (url) => { browserUrl = url; return rendered(url); },
  );

  const response = await handler(request(DIRECT_URL));
  assert.equal(response.status, 200);
  assert.equal(browserUrl, DIRECT_URL);
  assert.equal(brightCalls, 0);
  assert.equal((await response.json()).retrieval.strategy, "browser-rendered");
});

test("share URLs are handled by Chromium and return the resolved direct listing without Bright Data", async () => {
  let browserUrl = "";
  let brightCalls = 0;
  const handler = createListingExtractionPostHandler(
    async () => { throw new Error("HTTP fallback must not run"); },
    () => undefined,
    (async () => { brightCalls += 1; return null; }) as never,
    async (url) => { browserUrl = url; return rendered(url); },
  );

  const response = await handler(request(SHARE_URL));
  const body = await response.json();
  assert.equal(browserUrl, SHARE_URL);
  assert.equal(brightCalls, 0);
  assert.equal(body.retrieval.finalUrl, DIRECT_URL);
  assert.equal(body.extraction.details.askingPriceCad, 3200);
});

test("a share URL resolved before a scrape failure falls back to Bright Data once with the direct URL", async () => {
  const brightUrls: string[] = [];
  const handler = createListingExtractionPostHandler(
    async () => { throw new Error("HTTP fallback must not run"); },
    () => undefined,
    (async (url: string) => { brightUrls.push(url); return brightResult(url); }) as never,
    async () => {
      throw new FacebookExtractionError("FACEBOOK_LISTING_NOT_RENDERED", "scrape failed", {
        resolvedDirectUrl: DIRECT_URL,
      });
    },
  );

  const response = await handler(request(SHARE_URL));
  assert.equal(response.status, 200);
  assert.deepEqual(brightUrls, [DIRECT_URL]);
  assert.equal((await response.json()).retrieval.strategy, "brightdata");
});

test("a failed share resolution performs no duplicate provider attempt", async () => {
  let brightCalls = 0;
  const handler = createListingExtractionPostHandler(
    async () => { throw new Error("metadata unavailable"); },
    () => undefined,
    (async () => { brightCalls += 1; return null; }) as never,
    async () => { throw new FacebookExtractionError("FACEBOOK_SHARE_REDIRECT_FAILED", "no item"); },
  );

  const response = await handler(request(SHARE_URL));
  assert.equal(response.status, 502);
  assert.equal(brightCalls, 1);
});

test("login UI and recommendation cards do not displace a rendered primary listing", () => {
  const primary = primaryFacebookListingText(LISTING_TEXT);
  const extraction = extractFacebookListingFromRenderedText(rendered(DIRECT_URL));
  assert.equal(primary.includes("2009 Audi A6"), false);
  assert.equal(extraction.details.listingTitle, "1999 Audi A8");
  assert.equal(extraction.details.askingPriceCad, 3200);
  assert.equal(extraction.details.mileageKm, 324000);
  assert.equal(extraction.details.transmission, "Automatic");
  assert.equal(extraction.details.location, "Mirabel, QC");
  assert.match(String(extraction.details.sellerDescription), /Check engine/);
});
