import { test } from "node:test";
import assert from "node:assert/strict";

import { createListingExtractionPostHandler } from "../src/server/listing/handler";
import {
  BRIGHT_DATA_FACEBOOK_DATASET_ID_DEFAULT,
  BRIGHT_DATA_FACEBOOK_ENDPOINT,
  extractFacebookListingViaBrightData,
  type BrightDataFacebookFetch,
  type BrightDataFacebookFallbackReason,
  type BrightDataFacebookHttpRequest,
  type BrightDataFacebookOptions,
} from "../src/server/listing/brightDataFacebook";
import {
  ListingFetchError,
  type FetchPublicListingOptions,
} from "../src/server/listing/secureFetch";
import type { BrowserWorkerEnvironment } from "../src/server/listing/browserWorker";
import { FacebookExtractionError } from "../src/server/listing/facebook";

/**
 * Regression suite for the Bright Data Marketplace scraper as the PRIMARY
 * direct-URL Facebook extraction path.
 *
 * Every provider transport is mocked (injected `fetchImpl` or a mocked
 * `globalThis.fetch`): no test can reach api.brightdata.com, spend credits or
 * depend on live credentials. The fallback ladder (Bright Data -> HTTP
 * metadata -> browser worker) stays observable in every handler test.
 */

const SECRET = "test-worker-secret-value";
const API_KEY = "brt_MARKER_key_must_never_leak_9f3a";
const DATASET_ID = "gd_lvt9iwuh6fbcwmx1a";
const ITEM_ID = "4948179818741919";
const ITEM_URL = `https://www.facebook.com/marketplace/item/${ITEM_ID}/`;
const SHARE_URL = "https://www.facebook.com/share/1HjKAsQwoy/";
const EXAMPLE_URL = "https://example.com/listing/123";

const failingBrowser = async () => {
  throw new FacebookExtractionError("FACEBOOK_LISTING_NOT_RENDERED", "test browser failure");
};

const WORKER_ENV: BrowserWorkerEnvironment & Record<string, string> = {
  AUTOCHECK_WORKER_URL:
    "https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=extract",
  AUTOCHECK_WORKER_SECRET: SECRET,
};

const RENDERED_FALLBACK = {
  requestedUrl: ITEM_URL,
  finalUrl: ITEM_URL,
  canonicalUrl: ITEM_URL,
  itemId: ITEM_ID,
  title: "1987 944S Porsche parts car | Facebook",
  bodyText: "About this vehicle\nCA$ 5,000",
  ogTitle: "1987 944S Porsche parts car",
  ogDescription: "Parts car.",
  elapsedMs: 4200,
};

const FULL_OG_HTML = `<!doctype html><html><head>
<meta property="og:title" content="$18,995 · 2018 Toyota Corolla LE - Mississauga, ON">
<meta property="og:description" content="Driven 82,300 km · Automatic transmission">
<meta property="og:url" content="${ITEM_URL}">
<link rel="canonical" href="${ITEM_URL}">
</head><body>Marketplace listing document</body></html>`;

/** The proven live-record shape for the reference test listing. */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: ITEM_URL,
    title: "1987 944S Porsche parts car",
    initial_price: 5000,
    final_price: 5000,
    currency: "USD",
    product_id: ITEM_ID,
    breadcrumbs: null,
    condition: "Used - Fair",
    description: "Rebuilt engine with crank scraper, lsd rear-end, sport leather seat.",
    location: "Santa Cruz, CA",
    country_code: null,
    root_category: null,
    images: [
      "https://scontent.xx.fbcdn.net/v/t15.5256-10/111_n.jpg",
      "https://scontent.xx.fbcdn.net/v/t15.5256-10/222_n.jpg",
    ],
    seller_description: "Top rated seller",
    color: null,
    brand: null,
    videos: null,
    profile_id: "36724139323896963",
    listing_date: "2026-07-03T17:12:26.000Z",
    car_miles: null,
    is_sold: false,
    transmission: null,
    timestamp: "2026-10-02T14:07:31.860Z",
    input: { url: ITEM_URL },
    ...overrides,
  };
}

/** JSONL body; string entries pass through raw so malformed lines are easy. */
function jsonl(...entries: unknown[]): string {
  return `${entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join("\n")}\n`;
}

function responder(
  body: string = jsonl(record()),
  status = 200,
): { fetchImpl: BrightDataFacebookFetch; calls: BrightDataFacebookHttpRequest[] } {
  const calls: BrightDataFacebookHttpRequest[] = [];
  const fetchImpl: BrightDataFacebookFetch = async (request) => {
    calls.push(request);
    return { status, body };
  };
  return { fetchImpl, calls };
}

function fallbackLog(): {
  onFallback: (reason: BrightDataFacebookFallbackReason) => void;
  reasons: BrightDataFacebookFallbackReason[];
} {
  const reasons: BrightDataFacebookFallbackReason[] = [];
  return {
    onFallback: (reason) => {
      reasons.push(reason);
    },
    reasons,
  };
}

/** Runs the REAL provider client behind an injected transport (handler tests). */
function realExtractor(
  fetchImpl: BrightDataFacebookFetch,
  overrides: { apiKey?: string; datasetId?: string } = {},
): {
  extract: typeof extractFacebookListingViaBrightData;
  calls: BrightDataFacebookHttpRequest[];
} {
  const calls: BrightDataFacebookHttpRequest[] = [];
  const extract = ((url: string, options: BrightDataFacebookOptions = {}) =>
    extractFacebookListingViaBrightData(url, {
      ...options,
      apiKey: overrides.apiKey ?? API_KEY,
      datasetId: overrides.datasetId ?? DATASET_ID,
      fetchImpl: async (request) => {
        calls.push(request);
        return fetchImpl(request);
      },
    })) as typeof extractFacebookListingViaBrightData;
  return { extract, calls };
}

function pageFetcher(
  html: string,
  finalUrl: string = ITEM_URL,
  calls: string[] = [],
): (
  rawUrl: string,
  options?: FetchPublicListingOptions,
) => Promise<{ finalUrl: string; status: number; html: string }> {
  return async (rawUrl) => {
    calls.push(rawUrl);
    return { finalUrl, status: 200, html };
  };
}

async function captureConsole(run: () => Promise<void>): Promise<string[]> {
  const originals = { warn: console.warn, error: console.error, log: console.log };
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  console.warn = record;
  console.error = record;
  console.log = record;
  try {
    await run();
  } finally {
    console.warn = originals.warn;
    console.error = originals.error;
    console.log = originals.log;
  }
  return lines;
}

function brightDataReasons(lines: string[]): BrightDataFacebookFallbackReason[] {
  return lines
    .filter((line) => line.includes("facebook_brightdata_fallback"))
    .map((line) => JSON.parse(line) as { reason: BrightDataFacebookFallbackReason })
    .map((entry) => entry.reason);
}

async function withEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Mocks the AutoCheck -> Cloudways worker hop so the browser path is observable. */
async function withWorkerHop(
  run: (state: { workerCalls: unknown[] }) => Promise<void>,
): Promise<void> {
  const originalUrl = process.env.AUTOCHECK_WORKER_URL;
  const originalSecret = process.env.AUTOCHECK_WORKER_SECRET;
  const originalFetch = globalThis.fetch;
  const workerCalls: unknown[] = [];

  process.env.AUTOCHECK_WORKER_URL = WORKER_ENV.AUTOCHECK_WORKER_URL;
  process.env.AUTOCHECK_WORKER_SECRET = WORKER_ENV.AUTOCHECK_WORKER_SECRET;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    workerCalls.push({ input: String(input), init });
    return jsonResponse(200, { ok: true, rendered: RENDERED_FALLBACK });
  }) as typeof fetch;

  try {
    await run({ workerCalls });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.AUTOCHECK_WORKER_URL;
    else process.env.AUTOCHECK_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.AUTOCHECK_WORKER_SECRET;
    else process.env.AUTOCHECK_WORKER_SECRET = originalSecret;
  }
}

// ---------------------------------------------------------------------------
// 1. Transport: exactly one POST to the fixed endpoint, key header only
// ---------------------------------------------------------------------------

test("a valid item URL sends one POST to the fixed endpoint with the key only in the Authorization header", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return new Response(jsonl(record()), {
      status: 200,
      headers: { "Content-Type": "application/jsonl" },
    });
  }) as typeof fetch;

  try {
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
    });
    assert.ok(result);
    assert.equal(result.itemId, ITEM_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.startsWith(`${BRIGHT_DATA_FACEBOOK_ENDPOINT}?`));
  assert.ok(seen[0].url.includes(`dataset_id=${DATASET_ID}`));
  assert.ok(seen[0].url.includes("notify=false"));
  assert.ok(seen[0].url.includes("include_errors=true"));

  const init = seen[0].init;
  assert.equal(init.method, "POST");
  const headers = (init.headers ?? {}) as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(headers["Content-Type"], "application/json");
  // Redirects are refused so a Location hop can never move the key.
  assert.equal(init.redirect, "error");

  const body = JSON.parse(String(init.body)) as {
    input: { url: string }[];
    limit_per_input: unknown;
  };
  assert.deepEqual(body.input, [{ url: ITEM_URL }]);
  assert.equal(body.limit_per_input, null);
  // The key travels only in the header, never in the payload.
  assert.equal(String(init.body).includes(API_KEY), false);
});

// ---------------------------------------------------------------------------
// 2 + 3. Successful record: mapping, provenance, exact id binding
// ---------------------------------------------------------------------------

test("a successful JSONL record maps into the existing extraction model with brightdata-facebook provenance", async () => {
  const { fetchImpl } = responder();
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });

  assert.ok(result);
  assert.deepEqual(log.reasons, []);

  const details = result.extraction.details;
  assert.equal(result.extraction.details.listingTitle, "1987 944S Porsche parts car");
  assert.equal(details.year, 1987);
  assert.equal(details.make, "Porsche");
  assert.equal(details.askingPriceCad, 5000);
  assert.equal(details.priceCurrency, "USD");
  assert.equal(details.location, "Santa Cruz, CA");
  assert.equal(details.city, "Santa Cruz");
  assert.equal(details.listingUrl, ITEM_URL);
  assert.equal(details.listingSource, "facebook.com");
  assert.equal(details.mileageKm, undefined);

  const provenance = result.extraction.provenance;
  assert.equal(provenance.listingTitle?.source, "brightdata-facebook");
  assert.equal(provenance.askingPriceCad?.source, "brightdata-facebook");
  assert.equal(provenance.priceCurrency?.source, "brightdata-facebook");
  assert.equal(provenance.listingUrl?.source, "url");
  assert.ok(result.extraction.methods.includes("brightdata-facebook"));
  assert.ok(result.extraction.methods.includes("url"));
  assert.equal(result.extraction.methods.includes("meta"), false);
  assert.equal(result.extraction.methods.includes("facebook-rendered"), false);

  assert.ok(result.extraction.found.includes("listingTitle"));
  assert.ok(result.extraction.found.includes("askingPriceCad"));
});

test("an exact product_id match binds the result to the requested item id and canonical URL", async () => {
  const { fetchImpl } = responder();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.itemId, ITEM_ID);
  assert.equal(result.canonicalUrl, ITEM_URL);
  assert.equal(result.finalUrl, ITEM_URL);
  assert.equal(result.requestedUrl, ITEM_URL);
  assert.equal(result.httpStatus, 200);
  assert.equal(typeof result.elapsedMs, "number");
  assert.equal(result.recordCount, 1);
});

// ---------------------------------------------------------------------------
// 4 + 5 + 6. Identity binding: mismatch, missing and malformed product_id
// ---------------------------------------------------------------------------

test("a product_id mismatch is rejected after exactly one attempt", async () => {
  const { fetchImpl, calls } = responder(
    jsonl(record({ product_id: "1111111111111111", url: "https://www.facebook.com/marketplace/item/1111111111111111/" })),
  );
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });

  assert.equal(result, null);
  assert.deepEqual(log.reasons, ["brightdata-id-mismatch"]);
  assert.equal(calls.length, 1);
});

test("a missing or malformed product_id is rejected with the explicit reason", async () => {
  for (const badId of [
    record({ product_id: undefined }),
    record({ product_id: "" }),
    record({ product_id: "not-a-number" }),
    record({ product_id: { nested: true } }),
    record({ product_id: 12.5 }),
  ]) {
    const { fetchImpl, calls } = responder(jsonl(badId));
    const log = fallbackLog();
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl,
      ...log,
    });
    assert.equal(result, null, JSON.stringify(badId.product_id));
    assert.deepEqual(log.reasons, ["brightdata-missing-product-id"]);
    assert.equal(calls.length, 1);
  }
});

test("a record whose own url names a different item is rejected as conflicting identity", async () => {
  const { fetchImpl } = responder(
    jsonl(
      record({
        product_id: ITEM_ID,
        url: "https://www.facebook.com/marketplace/item/2222222222222222/",
      }),
    ),
  );
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });
  assert.equal(result, null);
  assert.deepEqual(log.reasons, ["brightdata-id-mismatch"]);
});

// ---------------------------------------------------------------------------
// 5 cont. + 7 + 8. Bounded, defensive JSONL parsing
// ---------------------------------------------------------------------------

test("malformed JSONL with no usable record fails closed", async () => {
  const { fetchImpl, calls } = responder("this is {not json\n{\"broken\":\n");
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });
  assert.equal(result, null);
  assert.deepEqual(log.reasons, ["brightdata-invalid-jsonl"]);
  assert.equal(calls.length, 1);
});

test("blank lines, whitespace and a single-line JSON array are parsed safely", async () => {
  const body = `\n\n${JSON.stringify(record())}\n\n   \r\n${JSON.stringify([record({ title: "Second record" })])}\n`;
  const { fetchImpl } = responder(body);
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });

  assert.ok(result);
  assert.deepEqual(log.reasons, []);
  // Deterministic first-match line order; the duplicate never shadows it.
  assert.equal(result.extraction.details.listingTitle, "1987 944S Porsche parts car");
  assert.equal(result.recordCount, 2);
});

// ---------------------------------------------------------------------------
// 8. Bright Data error records
// ---------------------------------------------------------------------------

test("a Bright Data error record never becomes a successful extraction", async () => {
  for (const body of [
    jsonl({ _error: "target returned unexpected status", url: ITEM_URL }),
    jsonl(record(), { _error: "provider failure", input: { url: ITEM_URL } }),
    jsonl({ error: { message: "dataset quota exceeded" } }),
  ]) {
    const { fetchImpl, calls } = responder(body);
    const log = fallbackLog();
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl,
      ...log,
    });
    assert.equal(result, null);
    assert.deepEqual(log.reasons, ["brightdata-api-error"]);
    assert.equal(calls.length, 1);
  }
});

// ---------------------------------------------------------------------------
// 9 + 10 + 11 + 12. HTTP failure statuses, one attempt each
// ---------------------------------------------------------------------------

test("401, 403, 429 and 500 responses fall back with one attempt each and no retry", async () => {
  for (const status of [401, 403, 429, 500]) {
    const { fetchImpl, calls } = responder(jsonl(record()), status);
    const log = fallbackLog();
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl,
      ...log,
    });
    assert.equal(result, null, String(status));
    assert.deepEqual(log.reasons, ["brightdata-http-error"], String(status));
    assert.equal(calls.length, 1, String(status));
  }
});

// ---------------------------------------------------------------------------
// 13 + 14. Timeout and network failure
// ---------------------------------------------------------------------------

test("the provider request cannot hang past the timeout", async () => {
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    timeoutMs: 20,
    fetchImpl: (request) =>
      new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
    ...log,
  });
  assert.equal(result, null);
  assert.deepEqual(log.reasons, ["brightdata-timeout"]);
});

test("a network failure falls back without leaking the underlying error", async () => {
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
    ...log,
  });
  assert.equal(result, null);
  assert.deepEqual(log.reasons, ["brightdata-network-error"]);
});

// ---------------------------------------------------------------------------
// 15 + 16. Missing configuration never reaches the network
// ---------------------------------------------------------------------------

test("a missing API key is reported without any provider request", async () => {
  await withEnv(
    {
      BRIGHT_DATA_API_KEY: undefined,
      BRIGHT_DATA_FACEBOOK_DATASET_ID: undefined,
      BRIGHT_DATA_TIMEOUT_MS: undefined,
    },
    async () => {
      const { fetchImpl, calls } = responder();
      const log = fallbackLog();
      const result = await extractFacebookListingViaBrightData(ITEM_URL, {
        fetchImpl,
        ...log,
      });
      assert.equal(result, null);
      assert.deepEqual(log.reasons, ["brightdata-not-configured"]);
      assert.equal(calls.length, 0);

      // An explicitly empty key is treated exactly like a missing one.
      const second = fallbackLog();
      const empty = await extractFacebookListingViaBrightData(ITEM_URL, {
        apiKey: "",
        fetchImpl,
        ...second,
      });
      assert.equal(empty, null);
      assert.deepEqual(second.reasons, ["brightdata-not-configured"]);
      assert.equal(calls.length, 0);
    },
  );
});

test("missing dataset configuration is reported without any provider request", async () => {
  const { fetchImpl, calls } = responder();
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: "",
    fetchImpl,
    ...log,
  });
  assert.equal(result, null);
  assert.deepEqual(log.reasons, ["brightdata-not-configured"]);
  assert.equal(calls.length, 0);
});

test("the dataset id comes from the environment with the documented default", async () => {
  await withEnv({ BRIGHT_DATA_FACEBOOK_DATASET_ID: undefined }, async () => {
    const { fetchImpl, calls } = responder();
    await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      fetchImpl,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].datasetId, BRIGHT_DATA_FACEBOOK_DATASET_ID_DEFAULT);
    assert.equal(calls[0].endpoint, BRIGHT_DATA_FACEBOOK_ENDPOINT);
    assert.equal(calls[0].apiKey, API_KEY);
  });

  await withEnv({ BRIGHT_DATA_FACEBOOK_DATASET_ID: "gd_env_override" }, async () => {
    const { fetchImpl, calls } = responder();
    await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      fetchImpl,
    });
    assert.equal(calls[0].datasetId, "gd_env_override");
  });
});

// ---------------------------------------------------------------------------
// 17 + 18 + 19 + 20 + 21. Numeric fields: never defaulted, price preference
// ---------------------------------------------------------------------------

test("a null price never becomes 0", async () => {
  const { fetchImpl } = responder(
    jsonl(record({ final_price: null, initial_price: null })),
  );
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.extraction.details.askingPriceCad, undefined);
  assert.equal(result.extraction.provenance.askingPriceCad, undefined);
  assert.equal(result.extraction.found.includes("askingPriceCad"), false);
  assert.equal(result.extraction.details.year, 1987);
});

test("a null mileage never becomes 0, and a present reading is stored in kilometres", async () => {
  const missing = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: responder(jsonl(record({ car_miles: null }))).fetchImpl,
  });
  assert.ok(missing);
  assert.equal(missing.extraction.details.mileageKm, undefined);
  assert.equal(missing.extraction.details.mileageUnit, undefined);
  assert.equal(missing.extraction.found.includes("mileageKm"), false);

  const present = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: responder(jsonl(record({ car_miles: 1000 }))).fetchImpl,
  });
  assert.ok(present);
  assert.equal(present.extraction.details.mileageKm, 1609);
  assert.equal(present.extraction.details.mileageUnit, "km");
  assert.equal(present.extraction.provenance.mileageKm?.source, "brightdata-facebook");
});

test("final_price is preferred over initial_price", async () => {
  const { fetchImpl } = responder(
    jsonl(record({ final_price: 5000, initial_price: 4500 })),
  );
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
  });
  assert.ok(result);
  assert.equal(result.extraction.details.askingPriceCad, 5000);
});

test("initial_price is the fallback when final_price is missing or invalid", async () => {
  for (const finalPrice of [null, 0, "n/a"]) {
    const { fetchImpl } = responder(
      jsonl(record({ final_price: finalPrice, initial_price: 4500 })),
    );
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl,
    });
    assert.ok(result, String(finalPrice));
    assert.equal(result.extraction.details.askingPriceCad, 4500, String(finalPrice));
  }
});

test("the reported currency is preserved and junk currency is not invented", async () => {
  const usd = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: responder(jsonl(record({ currency: "USD" }))).fetchImpl,
  });
  assert.ok(usd);
  assert.equal(usd.extraction.details.priceCurrency, "USD");
  assert.equal(usd.extraction.provenance.priceCurrency?.source, "brightdata-facebook");

  const junk = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: responder(jsonl(record({ currency: "dollars" }))).fetchImpl,
  });
  assert.ok(junk);
  assert.equal(junk.extraction.details.priceCurrency, undefined);
});

// ---------------------------------------------------------------------------
// 22 + 23 + 24 + 25. Description, images, sold status, transmission
// ---------------------------------------------------------------------------

test("description, condition and seller note are preserved with brightdata-facebook provenance", async () => {
  const { fetchImpl } = responder();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
  });

  assert.ok(result);
  const description = result.extraction.details.sellerDescription ?? "";
  assert.match(description, /Rebuilt engine with crank scraper/);
  assert.match(description, /Condition: Used - Fair/);
  assert.match(description, /Top rated seller/);
  assert.ok(description.length <= 4000);
  assert.equal(result.extraction.provenance.sellerDescription?.source, "brightdata-facebook");

  const empty = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: responder(
      jsonl(
        record({
          title: "Bare record",
          description: "",
          condition: undefined,
          seller_description: undefined,
        }),
      ),
    ).fetchImpl,
  });
  assert.ok(empty);
  // Absent text stays absent instead of becoming an empty string field.
  assert.equal(empty.extraction.details.sellerDescription, undefined);
});

test("images are mapped as validated listing photos with junk filtered out and a hard cap", async () => {
  const images = [
    "https://scontent.xx.fbcdn.net/v/photo1.jpg",
    "javascript:alert(1)",
    "data:text/html,<script>x</script>",
    42,
    "",
    "https://scontent.xx.fbcdn.net/v/photo1.jpg",
    "https://scontent.xx.fbcdn.net/v/photo2.png",
    "https://scontent.xx.fbcdn.net/v/photo3.webp",
  ];
  const { fetchImpl } = responder(jsonl(record({ images })));
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
  });

  assert.ok(result);
  const photos = result.extraction.details.photos ?? [];
  assert.deepEqual(
    photos.map((photo) => photo.name),
    [
      "https://scontent.xx.fbcdn.net/v/photo1.jpg",
      "https://scontent.xx.fbcdn.net/v/photo2.png",
      "https://scontent.xx.fbcdn.net/v/photo3.webp",
    ],
  );
  assert.deepEqual(
    photos.map((photo) => photo.type),
    ["image/jpeg", "image/png", "image/webp"],
  );
  assert.equal(result.extraction.provenance.photos?.source, "brightdata-facebook");
  assert.equal(result.imageCount, 3);

  const many = Array.from({ length: 25 }, (_, index) => `https://example.com/img${index}.jpg`);
  const capped = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: responder(jsonl(record({ images: many }))).fetchImpl,
  });
  assert.ok(capped);
  assert.equal((capped.extraction.details.photos ?? []).length, 20);
});

test("the sold flag is carried without being coerced or leaking into vehicle fields", async () => {
  for (const [value, expected] of [
    [true, true],
    [false, false],
    [undefined, null],
    [null, null],
  ] as const) {
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl: responder(jsonl(record({ is_sold: value }))).fetchImpl,
    });
    assert.ok(result);
    assert.equal(result.sold, expected, String(value));
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.extraction.details, "sold"),
      false,
    );
  }

  await captureConsole(async () => {
    const { extract } = realExtractor(responder(jsonl(record({ is_sold: true }))).fetchImpl);
    const handler = createListingExtractionPostHandler(
      async (): Promise<{ finalUrl: string; status: number; html: string }> => {
        throw new Error("HTTP fallback must not run");
      },
      () => undefined,
      extract,
      failingBrowser,
    );
    const response = await handler(
      new Request("http://localhost/api/listing-extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ITEM_URL }),
      }),
    );
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.retrieval.strategy, "brightdata");
    assert.equal(body.retrieval.sold, true);
  });
});

test("transmission maps only when it is a real value", async () => {
  const automatic = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl: responder(jsonl(record({ transmission: "Automatic" }))).fetchImpl,
  });
  assert.ok(automatic);
  assert.equal(automatic.extraction.details.transmission, "Automatic");
  assert.equal(automatic.extraction.provenance.transmission?.source, "brightdata-facebook");

  for (const value of [null, undefined, 5]) {
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl: responder(jsonl(record({ transmission: value }))).fetchImpl,
    });
    assert.ok(result);
    assert.equal(result.extraction.details.transmission, undefined, String(value));
  }
});

// ---------------------------------------------------------------------------
// 26 + 27. Provider never touched for unsupported inputs
// ---------------------------------------------------------------------------

test("a non-Facebook URL never calls Bright Data", async () => {
  const { fetchImpl, calls } = responder();
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(EXAMPLE_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
  assert.deepEqual(log.reasons, []);
});

test("an unsupported Facebook URL (share link) never calls Bright Data", async () => {
  const { fetchImpl, calls } = responder();
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(SHARE_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
  assert.deepEqual(log.reasons, []);

  const junk = await extractFacebookListingViaBrightData("not a url", {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    ...log,
  });
  assert.equal(junk, null);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Bounded reads + usable-data threshold
// ---------------------------------------------------------------------------

test("an oversized response is rejected by the bounded read", async () => {
  const { fetchImpl, calls } = responder(jsonl(record()));
  const log = fallbackLog();
  const result = await extractFacebookListingViaBrightData(ITEM_URL, {
    apiKey: API_KEY,
    datasetId: DATASET_ID,
    fetchImpl,
    maxBodyBytes: 10,
    ...log,
  });
  assert.equal(result, null);
  assert.deepEqual(log.reasons, ["brightdata-invalid-jsonl"]);
  assert.equal(calls.length, 1);
});

test("an ID-bound record with no usable fields is insufficient data, not an empty success", async () => {
  for (const bare of [
    record({
      title: undefined,
      description: undefined,
      condition: undefined,
      location: undefined,
      seller_description: undefined,
      images: undefined,
      final_price: null,
      initial_price: null,
    }),
    { product_id: ITEM_ID },
  ]) {
    const { fetchImpl } = responder(jsonl(bare));
    const log = fallbackLog();
    const result = await extractFacebookListingViaBrightData(ITEM_URL, {
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl,
      ...log,
    });
    assert.equal(result, null);
    assert.deepEqual(log.reasons, ["brightdata-insufficient-data"]);
  }
});

// ---------------------------------------------------------------------------
// Handler: PRIMARY -> HTTP metadata -> browser ordering
// ---------------------------------------------------------------------------

test("Chromium failure falls back to Bright Data before HTTP metadata", async () => {
  const { fetchImpl, calls } = responder();
  const { extract } = realExtractor(fetchImpl);
  const handler = createListingExtractionPostHandler(
    async (): Promise<{ finalUrl: string; status: number; html: string }> => {
      throw new Error("HTTP fallback must not run on Bright Data success");
    },
    () => undefined,
    extract,
    failingBrowser,
  );

  const response = await handler(
    new Request("http://localhost/api/listing-extraction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ITEM_URL }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.status, "extracted");
  assert.equal(body.retrieval.strategy, "brightdata");
  assert.equal(body.retrieval.itemId, ITEM_ID);
  assert.equal(body.retrieval.finalUrl, ITEM_URL);
  assert.equal(body.retrieval.httpStatus, 200);
  assert.equal(body.retrieval.sold, false);
  assert.equal(typeof body.retrieval.elapsedMs, "number");

  assert.equal(body.extraction.details.askingPriceCad, 5000);
  assert.equal(body.extraction.details.priceCurrency, "USD");
  assert.equal(body.extraction.details.location, "Santa Cruz, CA");
  assert.equal(body.extraction.provenance.listingTitle.source, "brightdata-facebook");
  assert.ok(body.extraction.methods.includes("brightdata-facebook"));
  // Exactly one provider request for this extraction.
  assert.equal(calls.length, 1);
});

test("a Bright Data failure falls back to the existing HTTP metadata path", async () => {
  const { fetchImpl } = responder(jsonl(record()), 500);
  const { extract, calls } = realExtractor(fetchImpl);
  await withWorkerHop(async ({ workerCalls }) => {
    const lines = await captureConsole(async () => {
      const handler = createListingExtractionPostHandler(
        pageFetcher(FULL_OG_HTML),
        () => undefined,
        extract,
        failingBrowser,
      );
      const response = await handler(
        new Request("http://localhost/api/listing-extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: ITEM_URL }),
        }),
      );
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.retrieval.strategy, "http-metadata");
      assert.equal(body.extraction.details.make, "Toyota");
      assert.equal(workerCalls.length, 0);
    });
    assert.deepEqual(brightDataReasons(lines), ["brightdata-http-error"]);
    assert.equal(calls.length, 1);
  });
});

test("when Chromium, Bright Data and HTTP metadata fail, the initial browser failure is returned", async () => {
  const { fetchImpl } = responder(jsonl(record()), 429);
  const { extract } = realExtractor(fetchImpl);
  await withWorkerHop(async ({ workerCalls }) => {
    const lines = await captureConsole(async () => {
      const failingFetch = async (): Promise<{
        finalUrl: string;
        status: number;
        html: string;
      }> => {
        throw new ListingFetchError("timeout", "The listing request timed out.");
      };
      const handler = createListingExtractionPostHandler(
        failingFetch,
        () => undefined,
        extract,
        failingBrowser,
      );
      const response = await handler(
        new Request("http://localhost/api/listing-extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: ITEM_URL }),
        }),
      );
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, "FACEBOOK_LISTING_NOT_RENDERED");
      assert.equal(workerCalls.length, 0);
    });
    assert.deepEqual(brightDataReasons(lines), ["brightdata-http-error"]);
  });
});

test("without configuration the default client reports not-configured and HTTP behaviour is unchanged", async () => {
  await withEnv(
    {
      BRIGHT_DATA_API_KEY: undefined,
      BRIGHT_DATA_FACEBOOK_DATASET_ID: undefined,
      BRIGHT_DATA_TIMEOUT_MS: undefined,
    },
    async () => {
      await withWorkerHop(async ({ workerCalls }) => {
        const lines = await captureConsole(async () => {
          // No third argument: the real default Bright Data client runs and
          // must short-circuit before any network activity.
          const handler = createListingExtractionPostHandler(
            pageFetcher(FULL_OG_HTML),
            () => undefined,
            undefined,
            failingBrowser,
          );
          const response = await handler(
            new Request("http://localhost/api/listing-extraction", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: ITEM_URL }),
            }),
          );
          const body = await response.json();
          assert.equal(body.ok, true);
          assert.equal(body.retrieval.strategy, "http-metadata");
          assert.equal(body.extraction.provenance.listingTitle.source, "meta");
          assert.equal(workerCalls.length, 0);
        });
        assert.deepEqual(brightDataReasons(lines), ["brightdata-not-configured"]);
      });
    },
  );
});

test("Bright Data is attempted at most once per extraction request", async () => {
  let attempts = 0;
  const extract = (async (
    url: string,
    options?: BrightDataFacebookOptions,
  ) => {
    attempts += 1;
    options?.onFallback?.("brightdata-network-error");
    return null;
  }) as typeof extractFacebookListingViaBrightData;

  await withWorkerHop(async () => {
    const handler = createListingExtractionPostHandler(
      pageFetcher(FULL_OG_HTML),
      () => undefined,
      extract,
      failingBrowser,
    );
    const response = await handler(
      new Request("http://localhost/api/listing-extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ITEM_URL }),
      }),
    );
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.retrieval.strategy, "http-metadata");
  });
  assert.equal(attempts, 1);
});

test("the API key never appears in logs, errors or the API response", async () => {
  const failing = realExtractor(
    async () => {
      throw new TypeError("fetch failed");
    },
    { apiKey: API_KEY },
  );

  const lines = await captureConsole(async () => {
    await withWorkerHop(async () => {
      // Success path: the key was configured but must never surface.
      const success = realExtractor(responder().fetchImpl, { apiKey: API_KEY });
      const successHandler = createListingExtractionPostHandler(
        pageFetcher(FULL_OG_HTML),
        () => undefined,
        success.extract,
        failingBrowser,
      );
      const successResponse = await successHandler(
        new Request("http://localhost/api/listing-extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: ITEM_URL }),
        }),
      );
      const successBody = await successResponse.json();
      assert.equal(successBody.retrieval.strategy, "brightdata");
      assert.equal(JSON.stringify(successBody).includes(API_KEY), false);

      // Failure path: fallback logs carry only the event name and enum reason.
      const failureHandler = createListingExtractionPostHandler(
        pageFetcher(FULL_OG_HTML),
        (error) => console.error("Listing URL extraction failed.", String(error)),
        failing.extract,
        failingBrowser,
      );
      const failureResponse = await failureHandler(
        new Request("http://localhost/api/listing-extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: ITEM_URL }),
        }),
      );
      const failureText = JSON.stringify(await failureResponse.json());
      assert.equal(failureText.includes(API_KEY), false);
    });
  });

  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(line.includes(API_KEY), false, line);
  }
  for (const line of lines.filter((entry) => entry.includes("facebook_brightdata_fallback"))) {
    const record = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(Object.keys(record).sort(), ["event", "reason"]);
  }
});

// ---------------------------------------------------------------------------
// Handler regression: non-Facebook URLs keep their existing behaviour
// ---------------------------------------------------------------------------

test("a non-Facebook URL never reaches Bright Data and keeps the HTML extraction path", async () => {
  let attempts = 0;
  const extract = (async () => {
    attempts += 1;
    return null;
  }) as typeof extractFacebookListingViaBrightData;

  const handler = createListingExtractionPostHandler(
    pageFetcher(
      `<!doctype html><title>2021 Toyota Corolla LE</title><meta name="description" content="$18,995. 82,300 km.">`,
      "https://dealer.example/listing",
    ),
    () => undefined,
    extract,
  );
  const response = await handler(
    new Request("http://localhost/api/listing-extraction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: EXAMPLE_URL }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.extraction.details.make, "Toyota");
  assert.equal(body.retrieval.finalUrl, "https://dealer.example/listing");
  assert.equal(typeof body.retrieval.httpStatus, "number");
  assert.equal(attempts, 0);
});
