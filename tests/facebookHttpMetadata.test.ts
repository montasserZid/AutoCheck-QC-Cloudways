import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createListingExtractionPostHandler } from "../src/server/listing/handler";
import {
  extractFacebookMarketplaceItemViaHttp,
  facebookHttpMetadataToRenderedListing,
  type FacebookHttpMetadataFallbackReason,
} from "../src/server/listing/facebook";
import {
  parseRenderedListingPayload,
  type BrowserWorkerEnvironment,
} from "../src/server/listing/browserWorker";
import {
  fetchPublicListingHtml,
  ListingFetchError,
  type FetchPublicListingOptions,
} from "../src/server/listing/secureFetch";
import { extractWithBrowserWorker } from "../deploy/cloudways-worker/src/render";

/**
 * Regression suite for the HTTP-first direct Marketplace item extraction.
 *
 * Every test keeps the browser fallback observable: the worker environment is
 * configured and `globalThis.fetch` (the AutoCheck -> Cloudways worker hop) is
 * mocked, so "the browser path did not run" is always an assertion rather than
 * an assumption, and no test can launch a real Chromium.
 */

const SECRET = "test-worker-secret-value";
const ITEM_ID = "4948179818741919";
const ITEM_URL = `https://www.facebook.com/marketplace/item/${ITEM_ID}/`;
const SHARE_URL = "https://www.facebook.com/share/1HjKAsQwoy/";

const WORKER_ENV: BrowserWorkerEnvironment & Record<string, string> = {
  AUTOCHECK_WORKER_URL:
    "https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=extract",
  AUTOCHECK_WORKER_SECRET: SECRET,
};

const RENDERED_FALLBACK = {
  requestedUrl: SHARE_URL,
  finalUrl: ITEM_URL,
  canonicalUrl: ITEM_URL,
  itemId: ITEM_ID,
  title: "2018 Toyota Corolla LE | Facebook",
  bodyText: "About this vehicle\nCA$ 18,995\nDriven 82,300 km",
  ogTitle: "2018 Toyota Corolla LE",
  ogDescription: "Clean car.",
  elapsedMs: 4200,
};

const FULL_OG_HTML = `<!doctype html><html><head>
<meta property="og:title" content="$18,995 · 2018 Toyota Corolla LE - Mississauga, ON">
<meta property="og:description" content="Driven 82,300 km · Automatic transmission · Fuel type: gas">
<meta property="og:image" content="https://scontent.xx.fbcdn.net/photo.jpg">
<meta property="og:url" content="${ITEM_URL}">
<link rel="canonical" href="${ITEM_URL}">
</head><body>Marketplace listing document</body></html>`;

interface FetchCall {
  url: string;
  options: FetchPublicListingOptions | undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function listingRequest(url: string): Request {
  return new Request("http://localhost/api/listing-extraction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

function pageFetcher(
  html: string,
  finalUrl: string = ITEM_URL,
  calls: FetchCall[] = [],
): (rawUrl: string, options?: FetchPublicListingOptions) => Promise<{
  finalUrl: string;
  status: number;
  html: string;
}> {
  return async (rawUrl, options) => {
    calls.push({ url: rawUrl, options });
    return { finalUrl, status: 200, html };
  };
}

/**
 * Configures the worker environment and a mocked worker fetch. `onWorkerFetch`
 * receives every AutoCheck -> Cloudways call; the default answers with a valid
 * rendered listing so a fallback always completes successfully.
 */
async function withWorkerHop(
  run: (state: {
    workerCalls: unknown[];
    setWorkerResponse: (response: () => Response) => void;
  }) => Promise<void>,
): Promise<void> {
  const originalUrl = process.env.AUTOCHECK_WORKER_URL;
  const originalSecret = process.env.AUTOCHECK_WORKER_SECRET;
  const originalFetch = globalThis.fetch;
  const workerCalls: unknown[] = [];
  let workerResponse: () => Response = () =>
    jsonResponse(200, { ok: true, rendered: RENDERED_FALLBACK });

  process.env.AUTOCHECK_WORKER_URL = WORKER_ENV.AUTOCHECK_WORKER_URL;
  process.env.AUTOCHECK_WORKER_SECRET = WORKER_ENV.AUTOCHECK_WORKER_SECRET;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    workerCalls.push({ input: String(input), init });
    return workerResponse();
  }) as typeof fetch;

  try {
    await run({
      workerCalls,
      setWorkerResponse: (response) => {
        workerResponse = response;
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.AUTOCHECK_WORKER_URL;
    else process.env.AUTOCHECK_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.AUTOCHECK_WORKER_SECRET;
    else process.env.AUTOCHECK_WORKER_SECRET = originalSecret;
  }
}

async function captureWarn(run: () => Promise<void>): Promise<string[]> {
  const originalWarn = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  try {
    await run();
  } finally {
    console.warn = originalWarn;
  }
  return lines;
}

function fallbackReasons(warnLines: string[]): FacebookHttpMetadataFallbackReason[] {
  return warnLines
    .filter((line) => line.includes("facebook_http_metadata_fallback"))
    .map((line) => JSON.parse(line) as { reason: FacebookHttpMetadataFallbackReason })
    .map((record) => record.reason);
}

/**
 * Mirrors the handler's fallback wiring for direct orchestrator calls so the
 * reported reason can be asserted.
 */
function warnOnFallback(): {
  onFallback: (reason: FacebookHttpMetadataFallbackReason) => void;
} {
  return {
    onFallback: (reason) =>
      console.warn(JSON.stringify({ event: "facebook_http_metadata_fallback", reason })),
  };
}

// ---------------------------------------------------------------------------
// 1. Valid direct Marketplace item: HTTP metadata succeeds, no browser
// ---------------------------------------------------------------------------

test("a direct Marketplace item URL succeeds over HTTP without the browser", async () => {
  await withWorkerHop(async ({ workerCalls }) => {
    const fetchCalls: FetchCall[] = [];
    const handler = createListingExtractionPostHandler(
      pageFetcher(FULL_OG_HTML, ITEM_URL, fetchCalls),
      () => undefined,
    );

    const response = await handler(listingRequest(ITEM_URL));
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.ok, true);
    assert.equal(body.retrieval.strategy, "http-metadata");
    assert.equal(body.retrieval.itemId, ITEM_ID);
    assert.equal(body.retrieval.finalUrl, ITEM_URL);
    assert.equal(body.retrieval.httpStatus, 200);
    assert.equal(typeof body.retrieval.elapsedMs, "number");

    // A truthful HTTP-client User-Agent is sent, and the fetch keeps the
    // production SSRF posture: no test-only private-network bypass.
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, ITEM_URL);
    assert.equal(
      fetchCalls[0].options?.headers?.["User-Agent"],
      "AutoCheckQC/1.0 (+https://autocheckqc.com)",
    );
    assert.equal(fetchCalls[0].options?.testOnlyAllowPrivateNetwork, undefined);

    // Provenance: metadata-derived fields are recorded through the existing
    // provenance system as `meta`; URL-derived fields stay `url`.
    assert.equal(body.extraction.provenance.listingTitle.source, "meta");
    assert.equal(body.extraction.provenance.askingPriceCad.source, "meta");
    assert.equal(body.extraction.provenance.listingUrl.source, "url");
    assert.ok(body.extraction.methods.includes("meta"));
    assert.equal(body.extraction.methods.includes("facebook-rendered"), false);

    assert.equal(body.extraction.details.year, 2018);
    assert.equal(body.extraction.details.make, "Toyota");
    assert.equal(body.extraction.details.model, "Corolla");
    assert.equal(body.extraction.details.askingPriceCad, 18995);
    assert.equal(body.extraction.details.mileageKm, 82300);
    assert.equal(body.status, "extracted");

    // The browser hop (Cloudways worker -> Chromium) must not run.
    assert.equal(workerCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 2. Partial OpenGraph response: accept real information, invent nothing
// ---------------------------------------------------------------------------

test("partial OpenGraph metadata is accepted without inventing missing fields", async () => {
  await withWorkerHop(async ({ workerCalls }) => {
    const partialHtml = `<!doctype html><html><head>
<meta property="og:title" content="Honda Civic EX for sale">
<meta property="og:url" content="${ITEM_URL}">
</head><body>listing</body></html>`;
    const handler = createListingExtractionPostHandler(
      pageFetcher(partialHtml, ITEM_URL),
      () => undefined,
    );

    const response = await handler(listingRequest(ITEM_URL));
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.ok, true);
    assert.equal(body.retrieval.strategy, "http-metadata");
    // The existing contract reports a usable-but-incomplete extraction as
    // `partial` instead of failing the request.
    assert.equal(body.status, "partial");

    // Absent metadata stays absent: no fabricated values.
    assert.equal(body.extraction.details.year, undefined);
    assert.equal(body.extraction.details.askingPriceCad, undefined);
    assert.equal(body.extraction.details.mileageKm, undefined);
    assert.equal(body.extraction.details.vin, undefined);
    assert.equal(body.extraction.provenance.listingTitle.source, "meta");

    assert.equal(workerCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. Generic Facebook metadata: never a successful listing
// ---------------------------------------------------------------------------

test("generic Facebook metadata falls back to the browser path", async () => {
  const warns = await captureWarn(async () => {
    await withWorkerHop(async ({ workerCalls }) => {
      const genericHtml = `<!doctype html><html><head>
<meta property="og:title" content="Facebook">
<meta property="og:description" content="Facebook helps you connect and share with the people in your life.">
<meta property="og:url" content="${ITEM_URL}">
<link rel="canonical" href="${ITEM_URL}">
</head><body>generic facebook document</body></html>`;
      const handler = createListingExtractionPostHandler(
        pageFetcher(genericHtml, ITEM_URL),
        () => undefined,
      );

      const response = await handler(listingRequest(ITEM_URL));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.retrieval.strategy, "browser-rendered");
      // The generic document never becomes the extracted listing.
      assert.equal(body.extraction.details.listingTitle, "2018 Toyota Corolla LE");

      // The fallback (existing browser path through the worker) ran.
      assert.equal(workerCalls.length, 1);
    });
  });
  assert.deepEqual(fallbackReasons(warns), ["generic-metadata"]);
});

// ---------------------------------------------------------------------------
// 4. Login wall: HTTP path rejected, Puppeteer fallback remains available
// ---------------------------------------------------------------------------

test("a login wall is rejected from the HTTP path and the fallback still runs", async () => {
  const warns = await captureWarn(async () => {
    await withWorkerHop(async ({ workerCalls }) => {
      const loginHtml = `<!doctype html><html><head>
<title>Log in to Facebook</title>
<meta property="og:title" content="Facebook - Log In Or Sign Up">
<meta property="og:description" content="Log in to Facebook to continue.">
<meta property="og:url" content="https://www.facebook.com/login/?ref=dbl">
</head><body><form>login fields</form></body></html>`;
      const handler = createListingExtractionPostHandler(
        pageFetcher(loginHtml, ITEM_URL),
        () => undefined,
      );

      const response = await handler(listingRequest(ITEM_URL));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.retrieval.strategy, "browser-rendered");
      assert.equal(workerCalls.length, 1);
    });
  });
  assert.deepEqual(fallbackReasons(warns), ["generic-metadata"]);
});

// ---------------------------------------------------------------------------
// 5 + 6. Item-id binding: metadata from another listing is never associated
// ---------------------------------------------------------------------------

test("og:url pointing at a different Marketplace item is rejected", async () => {
  const foreignId = "1111111111111111";
  const warns = await captureWarn(async () => {
    await withWorkerHop(async ({ workerCalls }) => {
      const foreignHtml = `<!doctype html><html><head>
<meta property="og:title" content="2018 Toyota Corolla LE">
<meta property="og:url" content="https://www.facebook.com/marketplace/item/${foreignId}/">
<link rel="canonical" href="${ITEM_URL}">
</head><body>document</body></html>`;
      const handler = createListingExtractionPostHandler(
        pageFetcher(foreignHtml, ITEM_URL),
        () => undefined,
      );

      const response = await handler(listingRequest(ITEM_URL));
      const raw = JSON.stringify(await response.json());
      // The foreign listing id never appears anywhere in the response.
      assert.equal(raw.includes(foreignId), false);
      assert.equal(workerCalls.length, 1);
    });
  });
  assert.deepEqual(fallbackReasons(warns), ["id-mismatch"]);
});

test("a canonical pointing at a different item id is rejected", async () => {
  const foreignId = "2222222222222222";
  const warns = await captureWarn(async () => {
    await withWorkerHop(async ({ workerCalls }) => {
      const foreignHtml = `<!doctype html><html><head>
<meta property="og:title" content="2018 Toyota Corolla LE">
<meta property="og:url" content="${ITEM_URL}">
<link rel="canonical" href="https://www.facebook.com/marketplace/item/${foreignId}/">
</head><body>document</body></html>`;
      const handler = createListingExtractionPostHandler(
        pageFetcher(foreignHtml, ITEM_URL),
        () => undefined,
      );

      const response = await handler(listingRequest(ITEM_URL));
      const raw = JSON.stringify(await response.json());
      assert.equal(raw.includes(foreignId), false);
      assert.equal(workerCalls.length, 1);
    });
  });
  assert.deepEqual(fallbackReasons(warns), ["id-mismatch"]);
});

test("metadata that never ties back to the requested item is rejected", async () => {
  const warns = await captureWarn(async () => {
    // No og:url/canonical and the document was served from a non-item path:
    // nothing positively ties this metadata to the requested listing.
    const untied = await extractFacebookMarketplaceItemViaHttp(ITEM_URL, {
      fetchHtml: pageFetcher(
        "<!doctype html><html><head><meta property=\"og:title\" content=\"Marketplace\"></head><body></body></html>",
        "https://www.facebook.com/marketplace/",
      ),
      ...warnOnFallback(),
    });
    assert.equal(untied, null);
  });
  assert.deepEqual(fallbackReasons(warns), ["no-id-tie"]);
});

test("a document served by a foreign host is rejected before its metadata is read", async () => {
  const warns = await captureWarn(async () => {
    const result = await extractFacebookMarketplaceItemViaHttp(ITEM_URL, {
      fetchHtml: pageFetcher(
        FULL_OG_HTML,
        `https://example.com/marketplace/item/${ITEM_ID}/`,
      ),
      ...warnOnFallback(),
    });
    assert.equal(result, null);
  });
  assert.deepEqual(fallbackReasons(warns), ["foreign-host"]);
});

// ---------------------------------------------------------------------------
// 7. HTTP/network failure: the extraction pipeline keeps working
// ---------------------------------------------------------------------------

test("an HTTP failure falls back to the browser path instead of breaking", async () => {
  const warns = await captureWarn(async () => {
    await withWorkerHop(async ({ workerCalls }) => {
      const failingFetch = async (): Promise<{
        finalUrl: string;
        status: number;
        html: string;
      }> => {
        throw new ListingFetchError("timeout", "The listing request timed out.");
      };
      const handler = createListingExtractionPostHandler(failingFetch, () => undefined);

      const response = await handler(listingRequest(ITEM_URL));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.retrieval.strategy, "browser-rendered");
      assert.equal(workerCalls.length, 1);
    });
  });
  assert.deepEqual(fallbackReasons(warns), ["fetch-failed"]);
});

// ---------------------------------------------------------------------------
// 8. Redirects still go through the existing SSRF validation
// ---------------------------------------------------------------------------

async function withServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
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

test("redirects still go through the existing SSRF validation", async () => {
  // Internal hostnames, credential-bearing URLs and unsupported protocols are
  // rejected on the redirect hop itself, independent of the test-only address
  // relaxation that lets the loopback origin server answer at all.
  for (const location of [
    "http://localhost/steal",
    "https://user:pass@example.com/steal",
    "file:///etc/passwd",
    "http://metadata.google.internal/latest",
  ]) {
    await withServer(
      (_request, response) => {
        response.writeHead(302, { Location: location });
        response.end();
      },
      async (baseUrl) => {
        await assert.rejects(
          () =>
            fetchPublicListingHtml(`${baseUrl}/listing`, {
              testOnlyAllowPrivateNetwork: true,
              timeoutMs: 1000,
            }),
          { name: "ListingFetchError", code: "unsafe-url" },
          location,
        );
      },
    );
  }

  // Redirect loops stay bounded by the existing limit.
  await withServer(
    (_request, response) => {
      response.writeHead(302, { Location: "/listing" });
      response.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        () =>
          fetchPublicListingHtml(`${baseUrl}/listing`, {
            testOnlyAllowPrivateNetwork: true,
            maxRedirects: 2,
            timeoutMs: 1000,
          }),
        { name: "ListingFetchError", code: "too-many-redirects" },
      );
    },
  );

  // A rejected fetch (including an SSRF rejection on a redirect hop) must
  // surface to the HTTP-first path as a fallback, never as a successful
  // extraction.
  const warns = await captureWarn(async () => {
    const result = await extractFacebookMarketplaceItemViaHttp(ITEM_URL, {
      fetchHtml: async () => {
        throw new ListingFetchError("unsafe-url", "Private IPv4 targets are blocked.");
      },
      ...warnOnFallback(),
    });
    assert.equal(result, null);
  });
  assert.deepEqual(fallbackReasons(warns), ["fetch-failed"]);
});

// ---------------------------------------------------------------------------
// 9. Share URLs keep their existing behaviour
// ---------------------------------------------------------------------------

test("share URLs never attempt HTTP metadata extraction", async () => {
  const warns = await captureWarn(async () => {
    await withWorkerHop(async ({ workerCalls }) => {
      const forbiddenFetcher = async (): Promise<{
        finalUrl: string;
        status: number;
        html: string;
      }> => {
        throw new Error("HTTP metadata must not run for share URLs");
      };
      const handler = createListingExtractionPostHandler(forbiddenFetcher, () => undefined);

      const response = await handler(listingRequest(SHARE_URL));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.retrieval.strategy, "browser-rendered");
      // The existing browser path handled it, exactly as before.
      assert.equal(workerCalls.length, 1);
    });
  });
  assert.deepEqual(fallbackReasons(warns), []);
});

// ---------------------------------------------------------------------------
// 11. Safe diagnostics: no response bodies, cookies or headers in logs
// ---------------------------------------------------------------------------

test("HTTP fallback diagnostics never contain page content or headers", async () => {
  const marker = "RAW_FACEBOOK_BODY_MARKER_9f3a";
  const errorLines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errorLines.push(args.map((value) => String(value)).join(" "));
  };
  try {
    const warns = await captureWarn(async () => {
      await withWorkerHop(async () => {
        const leakyHtml = `<!doctype html><html><head>
<title>Log in to Facebook</title>
<meta property="og:title" content="Log in to Facebook">
<meta property="og:url" content="${ITEM_URL}">
</head><body>${marker} raw body with session=abc</body></html>`;
        const handler = createListingExtractionPostHandler(
          pageFetcher(leakyHtml, ITEM_URL),
          (error) => console.error("Listing URL extraction failed.", String(error)),
        );
        const response = await handler(listingRequest(ITEM_URL));
        const bodyText = JSON.stringify(await response.json());
        assert.equal(bodyText.includes(marker), false);
        assert.equal(bodyText.includes("session=abc"), false);
      });
    });

    const combined = [...warns, ...errorLines];
    assert.ok(combined.length > 0, "the fallback must be observable");
    for (const line of combined) {
      assert.equal(line.includes(marker), false, line);
      assert.equal(line.includes("session=abc"), false, line);
      assert.equal(line.includes("<meta"), false, line);
      assert.equal(line.includes("Set-Cookie"), false, line);
    }
    // The fallback log record carries only the event name and the enum reason.
    for (const line of warns.filter((l) => l.includes("facebook_http_metadata_fallback"))) {
      const record = JSON.parse(line) as Record<string, unknown>;
      assert.deepEqual(Object.keys(record).sort(), ["event", "reason"]);
    }
  } finally {
    console.error = originalError;
  }
});

// ---------------------------------------------------------------------------
// 10/12. Parser robustness: attribute order, quoting, entities, duplicates
// ---------------------------------------------------------------------------

test("OpenGraph parsing tolerates reversed attributes, entities and duplicates", async () => {
  await withWorkerHop(async () => {
    const trickyHtml = `<!doctype html><html><head>
<meta content="$21,000 · 2016 Mazda CX-5 GS Men&#39;s Edition &amp; more" property="og:title">
<meta content="First description wins" property="og:description">
<meta content="Duplicate description must not win" property="og:description">
<meta content="${ITEM_URL}" property="og:url">
<link href="${ITEM_URL}" rel="canonical">
</head><body>document</body></html>`;
    const result = await extractFacebookMarketplaceItemViaHttp(ITEM_URL, {
      fetchHtml: pageFetcher(trickyHtml, ITEM_URL),
    });

    assert.ok(result);
    // The apostrophe (a quote of the other type) never truncates the value,
    // entities are decoded, and reversed attribute order is understood.
    assert.equal(
      result.meta.ogTitle,
      "$21,000 · 2016 Mazda CX-5 GS Men's Edition & more",
    );
    assert.equal(result.meta.ogDescription, "First description wins");
    assert.equal(result.meta.canonical, ITEM_URL);
    assert.equal(result.itemId, ITEM_ID);
    assert.equal(
      result.extraction.details.listingTitle,
      "$21,000 · 2016 Mazda CX-5 GS Men's Edition & more",
    );
    assert.equal(result.extraction.provenance.listingTitle?.source, "meta");
  });
});

// ---------------------------------------------------------------------------
// 13. Cloudways worker: HTTP metadata without launching Chromium
// ---------------------------------------------------------------------------

test("the Cloudways worker serves HTTP metadata without launching Chromium", async () => {
  const result = await extractWithBrowserWorker(ITEM_URL, {
    fetchHtml: pageFetcher(FULL_OG_HTML, ITEM_URL),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  if (!result.body.ok) return;
  const rendered = result.body.rendered;
  // The marker travels the worker boundary so AutoCheck records `meta`
  // provenance instead of browser-rendered provenance.
  assert.equal(rendered.source, "http-metadata");
  assert.equal(rendered.itemId, ITEM_ID);
  assert.equal(rendered.canonicalUrl, ITEM_URL);
  assert.equal(rendered.bodyText.trim().length > 0, true);
  assert.equal(rendered.ogTitle, "$18,995 · 2018 Toyota Corolla LE - Mississauga, ON");
});

test("the worker payload marker is validated at the trust boundary", () => {
  const withMarker = parseRenderedListingPayload({
    ...RENDERED_FALLBACK,
    source: "http-metadata",
  });
  assert.equal(withMarker?.source, "http-metadata");

  const withoutMarker = parseRenderedListingPayload(RENDERED_FALLBACK);
  assert.equal(withoutMarker?.source, undefined);

  const garbageMarker = parseRenderedListingPayload({
    ...RENDERED_FALLBACK,
    source: "made-up-value",
  });
  assert.equal(garbageMarker?.source, undefined);
});

// ---------------------------------------------------------------------------
// Cross-boundary provenance: worker-returned metadata is recorded as `meta`
// ---------------------------------------------------------------------------

test("a worker-returned HTTP metadata payload keeps `meta` provenance", async () => {
  const warns = await captureWarn(async () => {
    await withWorkerHop(async ({ setWorkerResponse }) => {
      setWorkerResponse(() =>
        jsonResponse(200, {
          ok: true,
          rendered: facebookHttpMetadataToRenderedListing({
            meta: {
              ogTitle: "2015 Honda Civic EX",
              ogDescription: "Great condition.",
              ogImage: "",
              ogUrl: ITEM_URL,
              canonical: ITEM_URL,
              htmlTextLength: FULL_OG_HTML.length,
              status: 200,
            },
            extraction: { details: {}, found: [], uncertain: [], provenance: {}, methods: [] },
            itemId: ITEM_ID,
            canonicalUrl: ITEM_URL,
            requestedUrl: ITEM_URL,
            finalUrl: ITEM_URL,
            httpStatus: 200,
            elapsedMs: 12,
          }),
        }),
      );
      const handler = createListingExtractionPostHandler(
        async () => {
          throw new ListingFetchError("timeout", "The listing request timed out.");
        },
        () => undefined,
      );

      const response = await handler(listingRequest(ITEM_URL));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.retrieval.strategy, "http-metadata");
      assert.equal(body.extraction.provenance.listingTitle.source, "meta");
      assert.equal(body.extraction.details.make, "Honda");
      assert.equal(body.extraction.methods.includes("facebook-rendered"), false);
    });
  });
  assert.deepEqual(fallbackReasons(warns), ["fetch-failed"]);
});
