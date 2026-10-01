import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

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
import { redactLogRecord, sanitizeLogHostname } from "../deploy/cloudways-worker/src/logging";

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
