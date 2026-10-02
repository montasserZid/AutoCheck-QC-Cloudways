import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { builtinModules } from "node:module";
import path from "node:path";

import {
  browserWorkerConfiguration,
  BROWSER_WORKER_LIMITS,
  fetchRenderedListingFromWorker,
  isBrowserWorkerConfigured,
  isBrowserWorkerFailure,
  parseBrowserWorkerUrl,
  parseRenderedListingPayload,
  renderFacebookMarketplaceListingForExtraction,
  WORKER_FAILURE_CODES,
} from "../src/server/listing/browserWorker";
import { createListingExtractionPostHandler } from "../src/server/listing/handler";
import {
  closeFacebookBrowserForCleanup,
  configuredLocalChromeArgs,
  FacebookExtractionError,
} from "../src/server/listing/facebook";
import { resolvePublicUrl } from "../src/server/listing/secureFetch";
import {
  constantTimeSecretEquals,
  isAuthorizedRequest,
  readPresentedSecret,
} from "../deploy/cloudways-worker/src/auth";
import { createExtractionWorker } from "../deploy/cloudways-worker/src/server";
import {
  extractWithBrowserWorker,
  WORKER_EXTRACT_ROUTE,
  WORKER_HEALTH_ROUTE,
} from "../deploy/cloudways-worker/src/render";
import {
  redactLogRecord,
  sanitizeLogHostname,
  sanitizeRenderDiagnostics,
} from "../deploy/cloudways-worker/src/logging";

const SECRET = "test-worker-secret-value";
const LISTING_URL = "https://www.facebook.com/share/1HjKAsQwoy/";

const RENDERED = {
  requestedUrl: LISTING_URL,
  finalUrl: "https://www.facebook.com/marketplace/item/1234567890/",
  canonicalUrl: "https://www.facebook.com/marketplace/item/1234567890/",
  itemId: "1234567890",
  title: "2018 Toyota Corolla LE | Facebook",
  bodyText: "About this vehicle\nCA$ 18,995\nDriven 82,300 km",
  ogTitle: "2018 Toyota Corolla LE",
  ogDescription: "Clean car.",
  elapsedMs: 7800,
};

const WORKER_ENV = {
  AUTOCHECK_WORKER_URL:
    "https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=extract",
  AUTOCHECK_WORKER_SECRET: SECRET,
};

const CONFIGURATION = { url: WORKER_ENV.AUTOCHECK_WORKER_URL, secret: SECRET };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Worker authentication
// ---------------------------------------------------------------------------

test("worker accepts the shared secret in either accepted header", () => {
  assert.equal(isAuthorizedRequest({ authorization: `Bearer ${SECRET}` }, SECRET), true);
  assert.equal(isAuthorizedRequest({ "x-autocheck-worker-secret": SECRET }, SECRET), true);
  assert.equal(isAuthorizedRequest({ authorization: `bearer ${SECRET}` }, SECRET), true);
  assert.equal(isAuthorizedRequest({ authorization: SECRET }, SECRET), true);
});

test("worker rejects invalid, missing and unconfigured credentials", () => {
  assert.equal(isAuthorizedRequest({ authorization: "Bearer wrong" }, SECRET), false);
  assert.equal(isAuthorizedRequest({ authorization: `Bearer ${SECRET}x` }, SECRET), false);
  assert.equal(isAuthorizedRequest({}, SECRET), false);
  assert.equal(isAuthorizedRequest({ authorization: `Bearer ${SECRET}` }, undefined), false);
  assert.equal(isAuthorizedRequest({ authorization: `Bearer ${SECRET}` }, ""), false);
  assert.equal(readPresentedSecret({ authorization: "Basic abc" }), "Basic abc");
  assert.equal(readPresentedSecret({}), undefined);
});

test("worker secret comparison is length-safe", () => {
  assert.equal(constantTimeSecretEquals(SECRET, SECRET), true);
  assert.equal(constantTimeSecretEquals("short", SECRET), false);
  assert.equal(constantTimeSecretEquals(undefined, SECRET), false);
  assert.equal(constantTimeSecretEquals(`${SECRET}x`, SECRET), false);
});

// ---------------------------------------------------------------------------
// Worker configuration
// ---------------------------------------------------------------------------

test("worker configuration requires both URL and secret", () => {
  assert.equal(isBrowserWorkerConfigured({}), false);
  assert.equal(
    isBrowserWorkerConfigured({ AUTOCHECK_WORKER_URL: WORKER_ENV.AUTOCHECK_WORKER_URL }),
    false,
  );
  assert.equal(
    isBrowserWorkerConfigured({ AUTOCHECK_WORKER_SECRET: SECRET }),
    false,
  );
  assert.deepEqual(browserWorkerConfiguration(WORKER_ENV), CONFIGURATION);
});

test("worker endpoint must be HTTPS and credential-free", () => {
  assert.throws(() => parseBrowserWorkerUrl("http://phpstack.cloudwaysapps.com/x.php"), {
    code: "worker-unavailable",
  });
  assert.throws(() => parseBrowserWorkerUrl("https://user:pass@example.com/x.php"), {
    code: "worker-unavailable",
  });
  assert.throws(() => parseBrowserWorkerUrl("file:///etc/passwd"), {
    code: "worker-unavailable",
  });
  assert.throws(() => parseBrowserWorkerUrl("not a url"), { code: "worker-unavailable" });
  assert.equal(
    parseBrowserWorkerUrl("https://phpstack-1676372-6705476.cloudwaysapps.com/worker-gateway.php?route=extract"),
    WORKER_ENV.AUTOCHECK_WORKER_URL,
  );
  assert.throws(() =>
    browserWorkerConfiguration({ ...WORKER_ENV, AUTOCHECK_WORKER_URL: "http://10.0.0.5/x.php" }),
  );
});

// ---------------------------------------------------------------------------
// AutoCheck -> worker client
// ---------------------------------------------------------------------------

test("valid worker authentication returns a validated rendered listing", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const rendered = await fetchRenderedListingFromWorker(LISTING_URL, {
    configuration: CONFIGURATION,
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenInit = init;
      return jsonResponse(200, { ok: true, rendered: RENDERED });
    },
  });
  assert.equal(rendered.canonicalUrl, RENDERED.canonicalUrl);
  assert.equal(rendered.itemId, "1234567890");
  assert.equal(rendered.bodyText, RENDERED.bodyText);
  assert.equal(seenUrl, CONFIGURATION.url);
  assert.equal(seenInit?.method, "POST");
  const headers = seenInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(headers["X-AutoCheck-Worker-Secret"], SECRET);
  // The credential stays server-to-server: it is never a public env var.
  assert.equal(headers.Authorization.includes("NEXT_PUBLIC"), false);
});

test("invalid worker authentication surfaces as an authorization failure", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      () =>
        fetchRenderedListingFromWorker(LISTING_URL, {
          configuration: CONFIGURATION,
          fetchImpl: async () => jsonResponse(status, { ok: false, code: "UNAUTHORIZED" }),
        }),
      { name: "ListingFetchError", code: "worker-unauthorized" },
    );
  }
});

test("worker busy, unavailable and rejected targets map into the error model", async () => {
  const respond = async (status: number, body: unknown) =>
    fetchRenderedListingFromWorker(LISTING_URL, {
      configuration: CONFIGURATION,
      fetchImpl: async () => jsonResponse(status, body),
    });

  await assert.rejects(
    () => respond(429, { ok: false, code: "BUSY", error: "Another extraction is running." }),
    { code: "worker-busy" },
  );
  await assert.rejects(
    () => respond(502, { ok: false, code: "WORKER_ERROR", error: "boom" }),
    { code: "worker-unavailable" },
  );
  await assert.rejects(() => respond(404, { ok: false }), { code: "worker-unavailable" });

  // A target the worker refused must stay an unsafe/unsupported URL error, so the
  // existing public message and 400 status are preserved.
  for (const code of ["UNSAFE_URL", "INVALID_URL", "UNSUPPORTED_URL"]) {
    await assert.rejects(
      () => respond(400, { ok: false, code, error: "blocked" }),
      (error: unknown) =>
        error instanceof FacebookExtractionError && error.code === "FACEBOOK_INVALID_URL",
    );
  }
  // Real Facebook failures keep their existing codes and public messages.
  await assert.rejects(
    () => respond(502, { ok: false, code: "FACEBOOK_LOGIN_REQUIRED", error: "Facebook requested login." }),
    (error: unknown) =>
      error instanceof FacebookExtractionError && error.code === "FACEBOOK_LOGIN_REQUIRED",
  );
});

test("malformed worker responses are rejected instead of parsed", async () => {
  const send = async (body: string) =>
    fetchRenderedListingFromWorker(LISTING_URL, {
      configuration: CONFIGURATION,
      fetchImpl: async () => new Response(body, { status: 200 }),
    });

  await assert.rejects(() => send("not json"), { code: "worker-invalid-response" });
  await assert.rejects(() => send("[1,2,3]"), { code: "worker-invalid-response" });
  await assert.rejects(() => send(JSON.stringify({ ok: true })), { code: "worker-invalid-response" });
  await assert.rejects(
    () => send(JSON.stringify({ ok: true, rendered: { ...RENDERED, bodyText: "" } })),
    { code: "worker-invalid-response" },
  );
  await assert.rejects(
    () => send(JSON.stringify({ ok: true, rendered: { ...RENDERED, itemId: undefined } })),
    { code: "worker-invalid-response" },
  );
  await assert.rejects(
    () => send(JSON.stringify({ ok: true, rendered: { ...RENDERED, elapsedMs: "fast" } })),
    { code: "worker-invalid-response" },
  );
  await assert.rejects(
    () =>
      send(
        JSON.stringify({
          ok: true,
          rendered: { ...RENDERED, bodyText: "x".repeat(BROWSER_WORKER_LIMITS.maxResponseBytes) },
        }),
      ),
    { code: WORKER_FAILURE_CODES.invalidResponse },
  );

  // The payload validator itself accepts a well-formed listing and coerces
  // nothing else, so a partially corrupted payload cannot be parsed silently.
  assert.equal(parseRenderedListingPayload(RENDERED)?.itemId, "1234567890");
  assert.equal(parseRenderedListingPayload(null), null);
  assert.equal(parseRenderedListingPayload({ ...RENDERED, ogTitle: 7 })?.ogTitle, undefined);
  assert.equal(parseRenderedListingPayload({ ...RENDERED, finalUrl: 42 }), null);
});

test("worker unavailability and timeouts never throw an unstructured error", async () => {
  await assert.rejects(
    () =>
      fetchRenderedListingFromWorker(LISTING_URL, {
        configuration: CONFIGURATION,
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    { name: "ListingFetchError", code: "worker-unavailable" },
  );

  await assert.rejects(
    () =>
      fetchRenderedListingFromWorker(LISTING_URL, {
        configuration: CONFIGURATION,
        timeoutMs: 5,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      }),
    { name: "ListingFetchError", code: "worker-timeout" },
  );
});

test("a busy worker is reported to the API caller as a graceful 503", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.AUTOCHECK_WORKER_URL;
  const originalSecret = process.env.AUTOCHECK_WORKER_SECRET;
  process.env.AUTOCHECK_WORKER_URL = WORKER_ENV.AUTOCHECK_WORKER_URL;
  process.env.AUTOCHECK_WORKER_SECRET = SECRET;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, code: "BUSY", error: "busy" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    const handler = createListingExtractionPostHandler(undefined, () => undefined);
    const response = await handler(
      new Request("http://localhost/api/listing-extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: LISTING_URL }),
      }),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.status, "failed");
    assert.equal(body.code, "worker-busy");
    assert.equal(typeof body.error, "string");
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.AUTOCHECK_WORKER_URL;
    else process.env.AUTOCHECK_WORKER_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.AUTOCHECK_WORKER_SECRET;
    else process.env.AUTOCHECK_WORKER_SECRET = originalSecret;
  }
});

// ---------------------------------------------------------------------------
// Worker-side SSRF guard (reuses the existing implementation)
// ---------------------------------------------------------------------------

test("worker rejects unsafe targets before launching a browser", async () => {
  for (const url of [
    "http://localhost/listing",
    "http://127.0.0.1/listing",
    "http://10.0.0.2/listing",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/listing",
    "http://[fd00::1]/listing",
    "file:///etc/passwd",
    "https://user:pass@example.com/listing",
    "not a url",
  ]) {
    const result = await extractWithBrowserWorker(url);
    assert.equal(result.body.ok, false, url);
    assert.equal(result.status, 400, url);
    assert.match(result.body.code as string, /^(UNSAFE_URL|INVALID_URL)$/, url);
  }
});

test("worker-side SSRF guard is AutoCheck's existing guard, not a second implementation", async () => {
  for (const url of [
    "http://localhost/listing",
    "http://127.0.0.1/listing",
    "http://[::1]/listing",
    "http://10.0.0.2/listing",
    "http://169.254.169.254/latest/meta-data",
  ]) {
    await assert.rejects(() => resolvePublicUrl(url), { code: "unsafe-url" }, url);
    const result = await extractWithBrowserWorker(url);
    assert.equal(result.status, 400, url);
  }
});

// ---------------------------------------------------------------------------
// Worker HTTP surface
// ---------------------------------------------------------------------------

interface WorkerCall {
  path: string;
  method?: string;
  body?: string;
  contentType?: string;
  auth?: string | null;
}

async function withWorker(
  create: () => http.Server,
  run: (
    call: (
      options: WorkerCall,
    ) => Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }>,
  ) => Promise<void>,
) {
  const server = create();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  try {
    await run(async ({ path, method = "GET", body, contentType, auth = SECRET }) => {
      const headers: Record<string, string> = {};
      if (contentType) headers["Content-Type"] = contentType;
      if (auth) headers.Authorization = `Bearer ${auth}`;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        body,
        headers,
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : {},
        headers: Object.fromEntries(response.headers),
      };
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const extractCall: WorkerCall = {
  path: WORKER_EXTRACT_ROUTE,
  method: "POST",
  contentType: "application/json",
  body: JSON.stringify({ url: LISTING_URL }),
};

test("health is authenticated, non-sensitive and never launches Chrome", async () => {
  assert.equal(WORKER_HEALTH_ROUTE, "/health");
  let launched = 0;
  await withWorker(
    () =>
      createExtractionWorker({
        secret: SECRET,
        extract: async () => {
          launched += 1;
          return { status: 200, body: { ok: true, rendered: RENDERED } };
        },
      }),
    async (call) => {
      const health = await call({ path: WORKER_HEALTH_ROUTE });
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
      assert.equal(health.body.service, "autocheck-extraction-worker");
      assert.equal(health.body.ready, true);
      assert.equal(health.body.maxConcurrent, 1);
      const serialized = JSON.stringify(health.body);
      assert.equal(serialized.includes(SECRET), false);
      assert.equal(serialized.includes("/home/"), false);
      assert.equal(serialized.includes("CHROME"), false);

      const unauthenticated = await call({ path: WORKER_HEALTH_ROUTE, auth: null });
      assert.equal(unauthenticated.status, 401);
      assert.equal(unauthenticated.body.code, "UNAUTHORIZED");

      const wrongSecret = await call({ path: WORKER_HEALTH_ROUTE, auth: "wrong" });
      assert.equal(wrongSecret.status, 401);

      assert.equal(launched, 0, "health must not start a browser");
    },
  );
});

test("worker rejects bad methods, routes, media types and oversized requests", async () => {
  await withWorker(
    () => createExtractionWorker({ secret: SECRET }),
    async (call) => {
      assert.equal((await call({ path: WORKER_EXTRACT_ROUTE, method: "GET" })).status, 405);
      assert.equal((await call({ path: WORKER_HEALTH_ROUTE, method: "POST" })).status, 405);
      assert.equal((await call({ path: "/../../etc/passwd" })).status, 404);
      assert.equal((await call({ path: "/" })).status, 404);
      assert.equal(
        (await call({ ...extractCall, contentType: "text/plain" })).status,
        415,
      );
      assert.equal((await call({ ...extractCall, body: "{oops" })).status, 400);
      assert.equal(
        (await call({ ...extractCall, body: JSON.stringify({ notUrl: 1 }) })).status,
        400,
      );
      assert.equal(
        (
          await call({
            ...extractCall,
            body: JSON.stringify({ url: `https://example.com/${"x".repeat(9000)}` }),
          })
        ).status,
        413,
      );
    },
  );
});

test("worker bounds browser concurrency with an explicit busy response", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  await withWorker(
    () =>
      createExtractionWorker({
        secret: SECRET,
        maxConcurrent: 1,
        extract: async () => {
          started += 1;
          await gate;
          return { status: 200, body: { ok: true, rendered: RENDERED } };
        },
      }),
    async (call) => {
      const first = call(extractCall);
      await new Promise((resolve) => setImmediate(resolve));
      const second = await call(extractCall);
      assert.equal(second.status, 429);
      assert.equal(second.body.code, "BUSY");
      assert.equal(second.headers["retry-after"], "10");
      release();
      const firstResponse = await first;
      assert.equal(firstResponse.status, 200);
      assert.equal(firstResponse.body.ok, true);
      assert.equal(started, 1, "a rejected request must never start a second browser");
    },
  );
});

test("worker surfaces extraction failures and always releases its slot", async () => {
  await withWorker(
    () =>
      createExtractionWorker({
        secret: SECRET,
        extract: async () => ({
          status: 502,
          body: {
            ok: false,
            code: "FACEBOOK_LOGIN_REQUIRED",
            error: "Facebook requested login.",
          },
        }),
      }),
    async (call) => {
      const failure = await call(extractCall);
      assert.equal(failure.status, 502);
      assert.equal(failure.body.code, "FACEBOOK_LOGIN_REQUIRED");

      const health = await call({ path: WORKER_HEALTH_ROUTE });
      assert.equal(health.body.activeExtractions, 0);
      assert.equal(health.body.ready, true);

      // The slot is genuinely reusable after a failure (cleanup, not a stuck lock).
      assert.equal((await call(extractCall)).status, 502);
    },
  );
});

test("worker converts an unexpected extractor crash into a JSON 502", async () => {
  await withWorker(
    () =>
      createExtractionWorker({
        secret: SECRET,
        extract: async () => {
          throw new Error("chrome exploded");
        },
      }),
    async (call) => {
      const response = await call(extractCall);
      assert.equal(response.status, 502);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, "WORKER_ERROR");
      assert.equal(JSON.stringify(response.body).toLowerCase().includes("secret"), false);
    },
  );
});

test("worker logs a request without the secret, query string or page contents", async () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = {
    info: (record: Record<string, unknown>) => records.push(record),
    warn: (record: Record<string, unknown>) => records.push(record),
    error: (record: Record<string, unknown>) => records.push(record),
  };
  await withWorker(
    () =>
      createExtractionWorker({
        secret: SECRET,
        logger,
        extract: async () => ({
          status: 502,
          body: {
            ok: false,
            code: "FACEBOOK_LOGIN_REQUIRED",
            error: "Facebook requested login.",
          },
        }),
      }),
    async (call) => {
      assert.equal(
        (
          await call({
            ...extractCall,
            body: JSON.stringify({ url: `${LISTING_URL}?token=leak` }),
          })
        ).status,
        502,
      );
    },
  );
  const log = JSON.stringify(records);
  assert.equal(log.includes(SECRET), false);
  assert.equal(log.includes("token=leak"), false);
  assert.equal(log.includes("About this vehicle"), false);
  assert.match(log, /extraction_start/);
  assert.match(log, /extraction_failed/);
  assert.match(log, /www\.facebook\.com/);
  assert.match(log, /requestId/);
});

// ---------------------------------------------------------------------------
// Chrome configuration and cleanup on a persistent Linux host
// ---------------------------------------------------------------------------

test("local Chrome args accept only switch flags and never the serverless stack", () => {
  assert.deepEqual(
    configuredLocalChromeArgs({ AUTOCHECK_CHROME_ARGS: "--no-sandbox --disable-setuid-sandbox" }),
    ["--no-sandbox", "--disable-setuid-sandbox"],
  );
  assert.deepEqual(configuredLocalChromeArgs({ AUTOCHECK_CHROME_ARGS: "--a,--b, --c" }), [
    "--a",
    "--b",
    "--c",
  ]);
  assert.deepEqual(configuredLocalChromeArgs({ AUTOCHECK_CHROME_ARGS: "user-data-dir=/tmp/x --no-sandbox" }), [
    "--no-sandbox",
  ]);
  assert.deepEqual(configuredLocalChromeArgs({}), []);
});

test("browser cleanup closes gracefully, then force-kills a stuck Chrome", async () => {
  let closed = false;
  await closeFacebookBrowserForCleanup({
    close: async () => {
      closed = true;
    },
    process: () => ({ exitCode: null, kill: () => true }),
  } as never);
  assert.equal(closed, true);

  let signalled = "";
  await closeFacebookBrowserForCleanup({
    close: async () => {
      throw new Error("target closed");
    },
    process: () => ({
      exitCode: null,
      kill: (signal?: string) => ((signalled = signal ?? ""), true),
    }),
  } as never);
  assert.equal(signalled, "SIGKILL");

  signalled = "";
  await closeFacebookBrowserForCleanup({
    close: async () => {
      throw new Error("crashed");
    },
    process: () => ({ exitCode: 1, kill: () => ((signalled = "killed"), true) }),
  } as never);
  assert.equal(signalled, "", "an already-exited browser must not be signalled again");

  // A missing browser is a no-op, so cleanup can never mask the real failure.
  await closeFacebookBrowserForCleanup(undefined);
});

// ---------------------------------------------------------------------------
// Logging hygiene
// ---------------------------------------------------------------------------

test("worker logging redacts secrets and never logs query strings", () => {
  const redacted = redactLogRecord({
    event: "extraction_start",
    AUTOCHECK_WORKER_SECRET: SECRET,
    authorization: `Bearer ${SECRET}`,
    hostname: "www.facebook.com",
  });
  assert.equal(redacted.AUTOCHECK_WORKER_SECRET, "[redacted]");
  assert.equal(redacted.authorization, "[redacted]");
  assert.equal(redacted.hostname, "www.facebook.com");
  assert.equal(JSON.stringify(redacted).includes(SECRET), false);
  assert.equal(
    sanitizeLogHostname("https://www.facebook.com/share/abc/?token=secret#x"),
    "www.facebook.com",
  );
  assert.equal(sanitizeLogHostname("not a url"), "invalid-url");
});

// ---------------------------------------------------------------------------
// Facebook render diagnostics
//
// These records must be enough to tell a login wall from a consent interstitial
// from an anti-bot checkpoint from an unrendered listing, while never carrying
// page HTML, rendered text, cookies, headers, the worker secret, a query string
// or the raw URL/title.
// ---------------------------------------------------------------------------

const RENDER_DIAGNOSTICS = {
  phase: "share",
  outcome: "checks-exhausted",
  reason: "login-wall",
  polls: 120,
  waitMs: 24120,
  httpStatus: 200,
  pageState: null,
  timings: { navigationMs: 410, renderWaitMs: 24120 },
  page: {
    host: "www.facebook.com",
    pathCategory: "login",
    titleCategory: "login",
    readyState: "complete",
    bodyTextLength: 412,
    hasOgUrl: false,
    hasMarketplaceMarker: false,
    hasListingDetailMarkers: false,
  },
  predicates: { readyStateComplete: true, hasBodyText: true, noLoginWall: false },
};

test("render diagnostics are reduced to a safe whitelist", () => {
  const safe = sanitizeRenderDiagnostics(RENDER_DIAGNOSTICS);
  assert.ok(safe);
  assert.equal(safe.phase, "share");
  assert.equal(safe.reason, "login-wall");
  assert.equal(safe.polls, 120);
  assert.equal(safe.httpStatus, 200);
  assert.deepEqual(safe.page, RENDER_DIAGNOSTICS.page);
  assert.deepEqual(safe.predicates, RENDER_DIAGNOSTICS.predicates);
  assert.deepEqual(safe.timings, RENDER_DIAGNOSTICS.timings);

  // Anything unrecognised is dropped rather than forwarded.
  const withJunk = sanitizeRenderDiagnostics({
    ...RENDER_DIAGNOSTICS,
    bodyText: "Driven 82,300 km. Seller says cash only.",
    cookies: "c_user=abc",
    authorization: `Bearer ${SECRET}`,
    page: {
      ...RENDER_DIAGNOSTICS.page,
      rawTitle: "Log in to Facebook",
      rawPath: "/login?next=x",
    },
  });
  assert.ok(withJunk);
  assert.equal("bodyText" in withJunk, false);
  assert.equal("cookies" in withJunk, false);
  assert.equal("authorization" in withJunk, false);
  assert.equal("rawTitle" in (withJunk.page as Record<string, unknown>), false);
  assert.equal("rawPath" in (withJunk.page as Record<string, unknown>), false);
  const serialized = JSON.stringify(withJunk);
  assert.equal(serialized.includes("Driven 82,300"), false);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes("Log in to Facebook"), false);

  // Non-primitive and oversized values cannot survive either.
  const hostile = sanitizeRenderDiagnostics({
    ...RENDER_DIAGNOSTICS,
    reason: { nested: "object" },
    phase: "x".repeat(500),
    timings: { weird: [1, 2, 3], alsoWeird: Number.NaN },
  });
  assert.ok(hostile);
  assert.equal(hostile.reason, null, "non-primitives must not be forwarded");
  assert.equal(typeof hostile.phase, "string");
  assert.equal((hostile.phase as string).length, 123);
  assert.deepEqual(hostile.timings, { weird: null, alsoWeird: null });

  assert.equal(sanitizeRenderDiagnostics(null), null);
  assert.equal(sanitizeRenderDiagnostics(undefined), null);
  assert.equal(sanitizeRenderDiagnostics({ unrelated: 1 }), null);
});

test("a failed extraction logs safe render diagnostics and keeps them out of the response", async () => {
  const records: Record<string, unknown>[] = [];
  await withWorker(
    () =>
      createExtractionWorker({
        secret: SECRET,
        logger: {
          info: (record) => records.push(record),
          warn: (record) => records.push(record),
          error: (record) => records.push(record),
        },
        extract: async () => ({
          status: 502,
          body: {
            ok: false,
            code: "FACEBOOK_LOGIN_REQUIRED",
            error: "Facebook served a login wall instead of the listing.",
            diagnostics: { render: RENDER_DIAGNOSTICS },
          },
        }),
      }),
    async (call) => {
      const failure = await call(extractCall);
      assert.equal(failure.status, 502);
      assert.equal(failure.body.code, "FACEBOOK_LOGIN_REQUIRED");
      // Diagnostics are operator-facing, not part of the API contract.
      assert.equal("diagnostics" in failure.body, false);
      assert.equal(JSON.stringify(failure.body).includes("waitMs"), false);
    },
  );

  const logged = records.find((record) => record.event === "extraction_failed");
  assert.ok(logged, "the failure must be logged");
  assert.equal(logged.code, "FACEBOOK_LOGIN_REQUIRED");
  const render = logged.render as Record<string, unknown>;
  assert.equal(render.reason, "login-wall");
  assert.equal(render.waitMs, 24120);
  assert.equal(
    (render.page as Record<string, unknown>).pathCategory,
    "login",
    "the log must show Facebook served a login page",
  );
  assert.equal(JSON.stringify(records).includes(SECRET), false);
});

// ---------------------------------------------------------------------------
// Fallback behaviour
// ---------------------------------------------------------------------------

test("an unconfigured worker keeps the existing in-process browser path", async () => {
  // No worker configuration => the previous in-process behaviour, so Facebook URL
  // validation still applies locally. A non-marketplace Facebook URL is rejected
  // without any network or browser work, which makes this deterministic.
  assert.equal(browserWorkerConfiguration({}), null);
  await assert.rejects(
    () =>
      renderFacebookMarketplaceListingForExtraction("https://www.facebook.com/someone", {
        environment: {},
      }),
    (error: unknown) =>
      error instanceof FacebookExtractionError && error.code === "FACEBOOK_INVALID_URL",
  );
});

test("browser worker failure codes are classified separately from target URL codes", () => {
  assert.equal(isBrowserWorkerFailure("worker-unavailable"), true);
  assert.equal(isBrowserWorkerFailure("worker-unauthorized"), true);
  assert.equal(isBrowserWorkerFailure("worker-timeout"), true);
  assert.equal(isBrowserWorkerFailure("worker-invalid-response"), true);
  // `worker-busy` is deliberately distinct: it is retryable, so it must not be
  // grouped with the permanent "temporarily unavailable" client message.
  assert.equal(isBrowserWorkerFailure("worker-busy"), false);
  assert.equal(isBrowserWorkerFailure("timeout"), false);
  assert.equal(isBrowserWorkerFailure("unsafe-url"), false);
  assert.equal(isBrowserWorkerFailure("network-error"), false);
});

// ---------------------------------------------------------------------------
// Deployment layout
//
// The worker ships as a standalone tree to /home/master/autocheck-worker, with
// node_modules at /home/master/autocheck-worker/node_modules. Node resolves
// `puppeteer-core` by walking upwards from the importing file, so every
// compiled file has to live at or below the worker root. These tests pin that
// invariant so a shared-module import can never escape the worker tree again.
// ---------------------------------------------------------------------------

function findRepoRoot(): string {
  let current = __dirname;
  for (let depth = 0; depth < 10; depth += 1) {
    const manifest = path.join(current, "package.json");
    if (fs.existsSync(manifest)) {
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string };
      if (parsed.name === "autocheck-qc") return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not locate the AutoCheck repository root from ${__dirname}`);
}

const REPO_ROOT = findRepoRoot();
const WORKER_DIR = path.join(REPO_ROOT, "deploy", "cloudways-worker");
const VENDOR_DIR = path.join(WORKER_DIR, "vendor");

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/** Every TypeScript source the worker compiles: its own plus the vendored AutoCheck modules. */
function workerSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (absolute.endsWith(".ts")) files.push(absolute);
    }
  };
  walk(path.join(WORKER_DIR, "src"));
  walk(path.join(WORKER_DIR, "scripts"));
  walk(path.join(VENDOR_DIR, "src"));
  return files.sort();
}

function importSpecifiers(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = new Set<string>();
  // Static import/export-from plus dynamic import()/require() of a literal.
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ??
    null
  );
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** `@sparticuz/chromium` is one package name, not the package `@sparticuz`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

test("shared AutoCheck modules are vendored inside the worker tree and match the repository", () => {
  const manifestPath = path.join(VENDOR_DIR, "manifest.json");
  assert.equal(
    fs.existsSync(manifestPath),
    true,
    "deploy/cloudways-worker/vendor/manifest.json is missing. Run `npm run sync:worker-sources`.",
  );

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    files?: { path: string; sha256: string }[];
  };
  const entries = manifest.files ?? [];
  assert.deepEqual(
    entries.map((entry) => entry.path),
    [
      "src/lib/listingExtraction.ts",
      "src/lib/listingUrlExtraction.ts",
      "src/server/listing/facebook.ts",
      "src/server/listing/secureFetch.ts",
      "src/types/domain.ts",
    ],
    "the vendored module set must be exactly the transitive relative-import closure of the worker entry modules",
  );

  for (const entry of entries) {
    const vendored = path.join(VENDOR_DIR, entry.path);
    const original = path.join(REPO_ROOT, entry.path);
    assert.equal(fs.existsSync(vendored), true, `vendor/${entry.path} was not deployed`);
    assert.equal(
      fs.existsSync(original),
      true,
      `vendor/${entry.path} has no counterpart at ${entry.path} in the repository`,
    );
    assert.equal(sha256(vendored), entry.sha256, `vendor/${entry.path} does not match its manifest checksum`);
    assert.equal(
      sha256(vendored),
      sha256(original),
      `vendor/${entry.path} is stale. Run \`npm run sync:worker-sources\`.`,
    );
  }
});

test("every relative import in the worker tree resolves inside the worker tree", () => {
  const files = workerSourceFiles();
  // 5 worker sources + 5 vendored AutoCheck modules.
  assert.equal(files.length >= 10, true, `expected the full worker source set, found ${files.length}`);

  for (const file of files) {
    const from = path.relative(REPO_ROOT, file);
    for (const specifier of importSpecifiers(file)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved === null) {
        assert.fail(`${from}: relative import "${specifier}" does not resolve to a file`);
      }
      const relative = path.relative(WORKER_DIR, resolved);
      assert.equal(
        path.isAbsolute(relative) || relative.startsWith(".."),
        false,
        `${from}: "${specifier}" resolves to ${relative}, outside deploy/cloudways-worker. ` +
          "The worker is deployed as a standalone tree with node_modules at " +
          "autocheck-worker/node_modules, so no compiled file may live above the worker root " +
          "or the shared modules' package imports become unresolvable.",
      );
    }
  }
});

test("every package import in the worker tree is a builtin or declared by the worker package", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(WORKER_DIR, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));

  const tsconfig = JSON.parse(fs.readFileSync(path.join(WORKER_DIR, "tsconfig.json"), "utf8")) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  const mapped = Object.keys(tsconfig.compilerOptions?.paths ?? {});

  const builtins = new Set(
    builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]),
  );

  for (const file of workerSourceFiles()) {
    const from = path.relative(REPO_ROOT, file);
    for (const specifier of importSpecifiers(file)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      const packageName = packageNameOf(specifier);
      assert.equal(
        builtins.has(packageName) || declared.has(packageName) || mapped.includes(packageName),
        true,
        `${from}: package "${specifier}" is neither a Node builtin, a dependency of ` +
          "deploy/cloudways-worker/package.json, nor mapped by its tsconfig, so the worker " +
          "build would fail with 'Cannot find module'.",
      );
    }
  }

  // puppeteer-core is genuinely required at runtime on the host.
  assert.equal(declared.has("puppeteer-core"), true);
  // @sparticuz/chromium is only reachable from the Vercel/Render branch of the
  // shared renderer, which Cloudways never takes (CHROME_EXECUTABLE_PATH wins),
  // so it must be type-supplied without installing a second Chromium.
  assert.equal(mapped.includes("@sparticuz/chromium"), true);
  assert.equal(
    declared.has("@sparticuz/chromium"),
    false,
    "@sparticuz/chromium must not be installed on the worker host",
  );
});

test("worker tsconfig, package entry point and start scripts agree on one self-contained layout", () => {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(WORKER_DIR, "tsconfig.json"), "utf8")) as {
    compilerOptions?: { rootDir?: string; outDir?: string; paths?: Record<string, string[]> };
    include?: string[];
  };
  const rootDir = tsconfig.compilerOptions?.rootDir ?? "";
  const outDir = tsconfig.compilerOptions?.outDir ?? "";

  assert.equal(
    rootDir,
    ".",
    "the worker rootDir must be the worker directory so nothing compiles outside the deployed tree",
  );
  assert.equal(outDir, "./dist");
  assert.equal(
    (tsconfig.include ?? []).includes("vendor/src/**/*.ts"),
    true,
    "the worker tsconfig must compile the vendored AutoCheck modules",
  );

  for (const [name, targets] of Object.entries(tsconfig.compilerOptions?.paths ?? {})) {
    for (const target of targets) {
      assert.equal(
        fs.existsSync(path.resolve(WORKER_DIR, target)),
        true,
        `tsconfig maps "${name}" to ${target}, which does not exist`,
      );
    }
  }

  // src/main.ts compiled with rootDir "." and outDir "./dist" => dist/src/main.js,
  // and every emitted file stays under dist/, so node_modules resolution always
  // reaches autocheck-worker/node_modules.
  const entry = `${outDir.replace(/^\.\//, "")}/src/main.ts`.replace(/\.ts$/, ".js");
  const pkg = JSON.parse(fs.readFileSync(path.join(WORKER_DIR, "package.json"), "utf8")) as {
    main?: string;
    scripts?: Record<string, string>;
  };
  assert.equal(entry, "dist/src/main.js");
  assert.equal(pkg.main, entry);
  assert.equal(pkg.scripts?.start, `node ${entry}`);

  const startScript = fs.readFileSync(path.join(WORKER_DIR, "start-worker.sh"), "utf8");
  for (const script of ["start-worker.sh", "restart-worker.sh"]) {
    const contents = fs.readFileSync(path.join(WORKER_DIR, script), "utf8");
    assert.equal(
      contents.includes(entry),
      true,
      `${script} must launch ${entry}`,
    );
    assert.equal(
      contents.includes("dist/deploy/"),
      false,
      `${script} still references the old in-repo output path`,
    );
  }

  // A stray VERCEL/RENDER marker must not be able to switch the shared renderer
  // onto the Sparticuz Chromium that is deliberately not installed here.
  assert.equal(
    startScript.includes("unset VERCEL RENDER"),
    true,
    "start-worker.sh must clear VERCEL/RENDER so the system Chrome is always used",
  );
});
