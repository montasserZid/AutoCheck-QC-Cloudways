import type { VehicleIntake } from "../../types/domain";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addListingField,
  extractListingIdentity,
  normalizeListingNumber,
  parseAttributes,
  type ExtractionSource,
  type ListingField,
  type ListingUrlExtraction,
} from "../../lib/listingUrlExtraction";
import {
  ListingFetchError,
  fetchPublicListingHtml,
  type ListingBrowserLifecycleDiagnostics,
  type ListingRuntimeMemoryDiagnostics,
} from "./secureFetch";

const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
]);

const ITEM_ID_RE = /^\/marketplace\/item\/(\d+)\/?$/i;
const PRIMARY_SECTION_END_RE =
  /\n(?:today's picks|more from marketplace|related listings|similar vehicles|related searches|see more on facebook|email or phone number|password|log in|create new account)\b/i;

export type FacebookExtractionErrorCode =
  | "FACEBOOK_INVALID_URL"
  | "FACEBOOK_BROWSER_EXECUTABLE_NOT_FOUND"
  | "FACEBOOK_BROWSER_LAUNCH_FAILED"
  | "FACEBOOK_NAVIGATION_TIMEOUT"
  | "FACEBOOK_SHARE_REDIRECT_FAILED"
  | "FACEBOOK_ITEM_NOT_FOUND"
  | "FACEBOOK_LOGIN_REQUIRED"
  | "FACEBOOK_CONSENT_REQUIRED"
  | "FACEBOOK_BLOCKED"
  | "FACEBOOK_LISTING_NOT_RENDERED"
  | "FACEBOOK_EXTRACTION_PARTIAL"
  | "FACEBOOK_EXTRACTION_FAILED"
  | "FACEBOOK_HTTP_METADATA_UNAVAILABLE";

export class FacebookExtractionError extends Error {
  constructor(
    public readonly code: FacebookExtractionErrorCode,
    message: string,
    public readonly diagnostics?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FacebookExtractionError";
  }
}

export interface FacebookRenderedListing {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  itemId: string;
  title: string;
  bodyText: string;
  ogTitle?: string;
  ogDescription?: string;
  elapsedMs: number;
  /**
   * Set only when the payload was built from public HTTP OpenGraph metadata
   * without launching a browser. The extraction pipeline then records every
   * metadata-derived field with the `meta` provenance instead of
   * `facebook-rendered`.
   */
  source?: "http-metadata";
}

type LifecycleEventListener = (...args: unknown[]) => void;

interface LifecycleEventSourceLike {
  on?: (event: string, listener: LifecycleEventListener) => unknown;
}

interface BrowserProcessLike extends LifecycleEventSourceLike {
  exitCode?: number | null;
  signalCode?: string | null;
  killed?: boolean;
  spawnargs?: string[];
  kill?: (signal?: string) => boolean;
  stderr?: LifecycleEventSourceLike | null;
}

interface BrowserLifecycleLike extends LifecycleEventSourceLike {
  connected?: boolean;
  isConnected?: () => boolean;
  process?: () => BrowserProcessLike | null;
}

interface PageLifecycleLike extends LifecycleEventSourceLike {
  isClosed?: () => boolean;
  target?: () => unknown;
}

interface BrowserLike extends BrowserLifecycleLike {
  close: () => Promise<void>;
  newPage: () => Promise<PageLike>;
  pages: () => Promise<PageLike[]>;
}

interface PageLike extends PageLifecycleLike {
  close: () => Promise<void>;
  goto: (
    url: string,
    options: { waitUntil: string; timeout: number },
  ) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  setDefaultNavigationTimeout?: (timeout: number) => void;
  setUserAgent?: (userAgent: string) => Promise<void>;
}

type FacebookRuntimeStage =
  | "browser-launch"
  | "page-setup"
  | "initial-navigation"
  | "share-resolution"
  | "canonical-navigation"
  | "render-wait"
  | "page-read"
  | "extraction";

interface FacebookPageOperationRetryOptions {
  deadline?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

interface FacebookRenderWaitOptions {
  deadline?: number;
  maxChecks?: number;
  pollIntervalMs?: number;
  requiredReadyChecks?: number;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
  /**
   * Stop waiting immediately when the page has reached a state that will never
   * become ready (login wall, consent interstitial, anti-bot checkpoint) so a
   * blocked request fails fast instead of burning the whole budget.
   */
  terminalCheck?: () => boolean;
  onPoll?: (poll: { check: number; ready: boolean; consecutiveReadyChecks: number }) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addLifecycleListener(
  source: LifecycleEventSourceLike | undefined,
  event: string,
  listener: LifecycleEventListener,
) {
  try {
    source?.on?.(event, listener);
  } catch {
    // Diagnostics must never interrupt extraction.
  }
}

function readLifecycleValue<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

type RuntimeFileReader = (path: string) => string;

function firstRuntimeNumber(readText: RuntimeFileReader, paths: string[]): number | null {
  for (const path of paths) {
    try {
      const value = readText(path).trim();
      if (value === "max") return null;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    } catch {
      // Runtime diagnostics are optional across cgroup versions and providers.
    }
  }
  return null;
}

function cgroupMemoryEvents(readText: RuntimeFileReader): Record<string, number> | null {
  try {
    return Object.fromEntries(
      readText("/sys/fs/cgroup/memory.events")
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/, 2))
        .filter((entry) => entry.length === 2 && Number.isFinite(Number(entry[1])))
        .map(([key, value]) => [key, Number(value)]),
    );
  } catch {
    return null;
  }
}

export function readFacebookRuntimeMemoryDiagnostics(
  readText: RuntimeFileReader = (path) => readFileSync(path, "utf8"),
  memoryUsage: () => NodeJS.MemoryUsage = process.memoryUsage,
): ListingRuntimeMemoryDiagnostics {
  const memory = memoryUsage();
  const events = cgroupMemoryEvents(readText);
  return {
    nodeRssBytes: memory.rss,
    nodeHeapUsedBytes: memory.heapUsed,
    nodeExternalBytes: memory.external,
    nodeArrayBuffersBytes: memory.arrayBuffers,
    cgroupCurrentBytes: firstRuntimeNumber(readText, [
      "/sys/fs/cgroup/memory.current",
      "/sys/fs/cgroup/memory/memory.usage_in_bytes",
    ]),
    cgroupPeakBytes: firstRuntimeNumber(readText, [
      "/sys/fs/cgroup/memory.peak",
      "/sys/fs/cgroup/memory/memory.max_usage_in_bytes",
    ]),
    cgroupLimitBytes: firstRuntimeNumber(readText, [
      "/sys/fs/cgroup/memory.max",
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ]),
    cgroupMemoryEvents: events,
    cgroupOomEvents:
      events?.oom ??
      firstRuntimeNumber(readText, ["/sys/fs/cgroup/memory/memory.failcnt"]),
    cgroupOomKillEvents: events?.oom_kill ?? null,
  };
}

export function createFacebookLifecycleTracker(
  requestStartedAt: number,
  deadline: number,
  now: () => number = Date.now,
  readMemory: () => ListingRuntimeMemoryDiagnostics = readFacebookRuntimeMemoryDiagnostics,
) {
  let browser: BrowserLifecycleLike | undefined;
  let page: PageLifecycleLike | undefined;
  let browserProcess: BrowserProcessLike | null | undefined;
  let pageTarget: unknown;
  let browserLaunchedAt: number | undefined;
  let browserDisconnectedAt: number | undefined;
  let lastNavigationFinishedAt: number | undefined;
  let lastTargetChangeAt: number | undefined;
  let navigationActive = false;
  let lastNavigationSucceeded: boolean | undefined;
  let cleanupStarted = false;
  let pageCloseEvent = false;
  let pageError: string | undefined;
  let browserDisconnectedEvent = false;
  let targetCreatedCount = 0;
  let targetChangedCount = 0;
  let targetDestroyedCount = 0;
  let pageTargetChangedCount = 0;
  let pageTargetDestroyed = false;
  let browserProcessExitEvent = false;
  let browserProcessCloseEvent = false;
  let processExitCode: number | null | undefined;
  let processSignal: string | null | undefined;
  let browserStderrTail = "";
  const memoryAtRequestStart = readMemory();
  let memoryAtBrowserLaunch: ListingRuntimeMemoryDiagnostics | undefined;
  let memoryAfterNavigation: ListingRuntimeMemoryDiagnostics | undefined;

  const attachBrowser = (browserValue: BrowserLifecycleLike) => {
    browser = browserValue;
    browserProcess = readLifecycleValue(() => browserValue.process?.()) ?? null;

    addLifecycleListener(browser, "disconnected", () => {
      browserDisconnectedEvent = true;
      browserDisconnectedAt = now();
    });
    addLifecycleListener(browser, "targetcreated", () => {
      targetCreatedCount += 1;
    });
    addLifecycleListener(browser, "targetchanged", (...args) => {
      targetChangedCount += 1;
      if (args[0] === pageTarget) pageTargetChangedCount += 1;
      lastTargetChangeAt = now();
    });
    addLifecycleListener(browser, "targetdestroyed", (...args) => {
      targetDestroyedCount += 1;
      if (args[0] === pageTarget) pageTargetDestroyed = true;
    });
    addLifecycleListener(browserProcess ?? undefined, "exit", (...args) => {
      browserProcessExitEvent = true;
      processExitCode =
        typeof args[0] === "number" || args[0] === null ? args[0] : undefined;
      processSignal =
        typeof args[1] === "string" || args[1] === null ? args[1] : undefined;
    });
    addLifecycleListener(browserProcess ?? undefined, "close", (...args) => {
      browserProcessCloseEvent = true;
      processExitCode =
        typeof args[0] === "number" || args[0] === null ? args[0] : processExitCode;
      processSignal =
        typeof args[1] === "string" || args[1] === null ? args[1] : processSignal;
    });
    addLifecycleListener(browserProcess?.stderr ?? undefined, "data", (...args) => {
      browserStderrTail = `${browserStderrTail}${String(args[0] ?? "")}`
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?")
        .slice(-2000);
    });
  };

  const attachPage = (pageValue: PageLifecycleLike) => {
    page = pageValue;
    pageTarget = readLifecycleValue(() => pageValue.target?.());
    addLifecycleListener(page, "close", () => {
      pageCloseEvent = true;
    });
    addLifecycleListener(page, "error", (...args) => {
      pageError = errorMessage(args[0]).slice(0, 500);
    });
  };

  return {
    markBrowserLaunched() {
      browserLaunchedAt = now();
      memoryAtBrowserLaunch = readMemory();
    },
    attachBrowser,
    attachPage,
    attach(browserValue: BrowserLifecycleLike, pageValue: PageLifecycleLike) {
      attachBrowser(browserValue);
      attachPage(pageValue);
    },
    markNavigationStarted() {
      navigationActive = true;
      lastNavigationSucceeded = undefined;
    },
    markNavigationFinished(succeeded: boolean) {
      navigationActive = false;
      lastNavigationSucceeded = succeeded;
      lastNavigationFinishedAt = now();
      memoryAfterNavigation = readMemory();
    },
    markCleanupStarted() {
      cleanupStarted = true;
    },
    async waitForTerminationDetails(
      delayMs = 75,
      sleep: (delay: number) => Promise<void> = (delay) =>
        new Promise((resolve) => setTimeout(resolve, delay)),
    ) {
      if (
        browserDisconnectedEvent &&
        !browserProcessExitEvent &&
        !browserProcessCloseEvent
      ) {
        await sleep(delayMs);
      }
    },
    snapshot(): ListingBrowserLifecycleDiagnostics {
      const observedAt = now();
      const connected = readLifecycleValue(() =>
        typeof browser?.connected === "boolean"
          ? browser.connected
          : browser?.isConnected?.(),
      );
      const pageClosed = readLifecycleValue(() => page?.isClosed?.());
      const currentExitCode = readLifecycleValue(() => browserProcess?.exitCode);
      const currentSignal = readLifecycleValue(() => browserProcess?.signalCode);
      return {
        pageClosed,
        pageCloseEvent,
        pageError,
        browserConnected: connected,
        browserDisconnectedEvent,
        targetCreatedCount,
        targetChangedCount,
        targetDestroyedCount,
        pageTargetChangedCount,
        pageTargetDestroyed,
        browserProcessExitEvent,
        browserProcessCloseEvent,
        browserProcessExitCode: processExitCode ?? currentExitCode,
        browserProcessSignal: processSignal ?? currentSignal,
        browserProcessKilled: readLifecycleValue(() => browserProcess?.killed),
        browserProcessSpawnArgs: readLifecycleValue(() => browserProcess?.spawnargs),
        browserStderrTail: browserStderrTail || undefined,
        elapsedSinceBrowserLaunchMs:
          browserLaunchedAt === undefined ? undefined : observedAt - browserLaunchedAt,
        elapsedSinceRequestStartMs: observedAt - requestStartedAt,
        msSinceBrowserDisconnect:
          browserDisconnectedAt === undefined ? undefined : observedAt - browserDisconnectedAt,
        cleanupStarted,
        deadlineExpired: observedAt >= deadline,
        navigationActive,
        lastNavigationSucceeded,
        msSinceLastNavigation:
          lastNavigationFinishedAt === undefined
            ? undefined
            : observedAt - lastNavigationFinishedAt,
        msSinceLastTargetChange:
          lastTargetChangeAt === undefined ? undefined : observedAt - lastTargetChangeAt,
        memoryAtRequestStart,
        memoryAtBrowserLaunch,
        memoryAfterNavigation,
        memoryAtFailure: readMemory(),
      };
    },
  };
}

type FacebookLifecycleTracker = ReturnType<typeof createFacebookLifecycleTracker>;

export function isTransientFacebookPageLifecycleError(error: unknown): boolean {
  return /attempted to use detached frame|execution context was destroyed|cannot find context with specified id|execution context is not available in detached frame/i.test(
    errorMessage(error),
  );
}

export async function retryFacebookPageOperation<T>(
  operation: () => Promise<T>,
  options: FacebookPageOperationRetryOptions = {},
): Promise<T> {
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 150);
  const sleep =
    options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const now = options.now ?? Date.now;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (now() >= deadline) throw new Error("Facebook page operation timed out.");
    try {
      return await operation();
    } catch (error) {
      const remainingMs = deadline - now();
      if (
        !isTransientFacebookPageLifecycleError(error) ||
        attempt === maxAttempts ||
        remainingMs <= 0
      ) {
        throw error;
      }
      await sleep(Math.min(retryDelayMs, remainingMs));
    }
  }
  throw new Error("Facebook page operation retry exhausted unexpectedly.");
}

/**
 * Render-wait polling budget.
 *
 * The wait used to default to a fixed 18 checks x 200 ms, so it always abandoned
 * the wait after ~3.4 s no matter how much of the extraction deadline was left.
 * On the Cloudways worker that produced a ~5 s failure against a 25 s budget.
 * The poll count is now derived from the deadline that the caller already
 * configured, so the wait can only be as long as the extraction it belongs to.
 */
const FACEBOOK_RENDER_POLL_INTERVAL_MS = 200;
const FACEBOOK_MIN_RENDER_POLLS = 3;
const FACEBOOK_MAX_RENDER_POLLS = 200;

export function facebookRenderWaitBudget(
  deadline: number | undefined,
  now: () => number = Date.now,
): { maxChecks: number; pollIntervalMs: number } {
  if (deadline === undefined || !Number.isFinite(deadline)) {
    return {
      maxChecks: FACEBOOK_MAX_RENDER_POLLS,
      pollIntervalMs: FACEBOOK_RENDER_POLL_INTERVAL_MS,
    };
  }
  const affordable = Math.floor((deadline - now()) / FACEBOOK_RENDER_POLL_INTERVAL_MS);
  return {
    maxChecks: Math.max(
      FACEBOOK_MIN_RENDER_POLLS,
      Math.min(FACEBOOK_MAX_RENDER_POLLS, affordable),
    ),
    pollIntervalMs: FACEBOOK_RENDER_POLL_INTERVAL_MS,
  };
}

export type FacebookRenderWaitOutcome =
  | "ready"
  | "deadline"
  | "checks-exhausted"
  | "terminal"
  | "transient-error";

/**
 * Carries why the render wait stopped. The message strings are unchanged so the
 * existing callers and tests that match on them keep working.
 */
export class FacebookRenderWaitError extends Error {
  constructor(
    public readonly outcome: FacebookRenderWaitOutcome,
    message: string,
  ) {
    super(message);
    this.name = "FacebookRenderWaitError";
  }
}

export async function waitForFacebookRenderReadiness(
  readinessCheck: () => Promise<boolean>,
  options: FacebookRenderWaitOptions = {},
): Promise<void> {
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const budget = facebookRenderWaitBudget(
    Number.isFinite(deadline) ? deadline : undefined,
    options.now ?? Date.now,
  );
  const maxChecks = Math.max(1, options.maxChecks ?? budget.maxChecks);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? budget.pollIntervalMs);
  const requiredReadyChecks = Math.max(1, options.requiredReadyChecks ?? 2);
  const sleep =
    options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const now = options.now ?? Date.now;
  let consecutiveReadyChecks = 0;
  let lastTransientError: unknown;

  for (let check = 1; check <= maxChecks; check += 1) {
    if (now() >= deadline) throw new FacebookRenderWaitError("deadline", "Facebook render wait timed out.");
    if (options.terminalCheck?.()) {
      throw new FacebookRenderWaitError(
        "terminal",
        "Facebook render wait stopped on a blocking page.",
      );
    }
    let ready = false;
    try {
      ready = await readinessCheck();
      lastTransientError = undefined;
      consecutiveReadyChecks = ready ? consecutiveReadyChecks + 1 : 0;
      if (consecutiveReadyChecks >= requiredReadyChecks) return;
    } catch (error) {
      if (!isTransientFacebookPageLifecycleError(error)) throw error;
      lastTransientError = error;
      consecutiveReadyChecks = 0;
    }
    options.onPoll?.({ check, ready, consecutiveReadyChecks });

    if (check < maxChecks) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) throw new FacebookRenderWaitError("deadline", "Facebook render wait timed out.");
      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  if (lastTransientError) {
    throw new FacebookRenderWaitError("transient-error", errorMessage(lastTransientError));
  }
  throw new FacebookRenderWaitError(
    "checks-exhausted",
    "Facebook render wait timed out before readiness.",
  );
}

// ---------------------------------------------------------------------------
// Render readiness classification
//
// These are pure functions so the Facebook-visible outcome can be classified
// and unit tested without a browser. Nothing here retains page HTML, rendered
// text, cookies, headers, query strings or the page title/path themselves: only
// categories, counts and booleans ever cross into logs.
// ---------------------------------------------------------------------------

export type FacebookPathCategory =
  | "marketplace-item"
  | "share"
  | "login"
  | "checkpoint"
  | "consent"
  | "home"
  | "other";

export function classifyFacebookPath(pathname: string): FacebookPathCategory {
  const lowerPath = pathname.toLowerCase();
  if (ITEM_ID_RE.test(lowerPath)) return "marketplace-item";
  if (/^\/share\/[^/]+\/?$/.test(lowerPath)) return "share";
  if (lowerPath.startsWith("/checkpoint")) return "checkpoint";
  if (lowerPath.includes("/consent")) return "consent";
  if (
    lowerPath.startsWith("/login") ||
    lowerPath.includes("login.php") ||
    lowerPath.startsWith("/recover")
  ) {
    return "login";
  }
  if (lowerPath === "" || lowerPath === "/") return "home";
  return "other";
}

export type FacebookTitleCategory =
  | "empty"
  | "login"
  | "checkpoint"
  | "consent"
  | "unavailable"
  | "marketplace"
  | "facebook-page"
  | "other";

/**
 * Classifies the document title without ever returning or logging it, because
 * the title is page content.
 */
export function classifyFacebookPageTitle(title: string): FacebookTitleCategory {
  const lower = title.trim().toLowerCase();
  if (!lower) return "empty";
  if (/\b(?:log in|login|sign in)\b/.test(lower)) return "login";
  if (/\b(?:checkpoint|captcha|verify|confirm your identity|security check)\b/.test(lower)) {
    return "checkpoint";
  }
  if (/\b(?:cookie|consent)\b/.test(lower)) return "consent";
  if (
    /\b(?:content isn't available|content is no longer available|page not found|this page isn't available|item not found)\b/.test(
      lower,
    )
  ) {
    return "unavailable";
  }
  if (lower.includes("marketplace")) return "marketplace";
  if (/\|\s*facebook\s*$/.test(lower)) return "facebook-page";
  return "other";
}

/** Raw probe signals collected inside the page. Never logged as-is. */
export interface FacebookRenderProbe {
  host: string;
  path: string;
  title: string;
  readyState: string;
  bodyTextLength: number;
  hasOgUrl: boolean;
  hasMarketplaceMarker: boolean;
  hasListingDetailMarkers: boolean;
}

/** Log-safe reduction of a probe: categories, counts and booleans only. */
export interface FacebookRenderProbeSummary {
  host: string;
  pathCategory: FacebookPathCategory;
  titleCategory: FacebookTitleCategory;
  readyState: string;
  bodyTextLength: number;
  hasOgUrl: boolean;
  hasMarketplaceMarker: boolean;
  hasListingDetailMarkers: boolean;
}

export function summarizeFacebookRenderProbe(probe: FacebookRenderProbe): FacebookRenderProbeSummary {
  return {
    host: probe.host,
    pathCategory: classifyFacebookPath(probe.path),
    titleCategory: classifyFacebookPageTitle(probe.title),
    readyState: probe.readyState,
    bodyTextLength: probe.bodyTextLength,
    hasOgUrl: probe.hasOgUrl,
    hasMarketplaceMarker: probe.hasMarketplaceMarker,
    hasListingDetailMarkers: probe.hasListingDetailMarkers,
  };
}

/**
 * The render-readiness predicate, unchanged in intent from the original:
 * a settled document that carries Marketplace item evidence (from the location
 * path or the og:url meta tag, so both server-side and client-side share
 * resolution are covered) and is not a login/consent/checkpoint wall.
 *
 * The Cloudways failure was NOT this predicate: it was that the wait gave up
 * after a fixed ~3.4 s, before Facebook could finish resolving the share URL.
 * Weakening the predicate here would let the caller read the page before the
 * share link had resolved, so the budget and the early wall exit are what changed.
 */
export type FacebookGateVerdict = "ready" | "pending" | "terminal";

export interface FacebookGateEvaluation {
  verdict: FacebookGateVerdict;
  predicates: Record<string, boolean>;
}

export function evaluateFacebookRenderGate(
  summary: FacebookRenderProbeSummary,
): FacebookGateEvaluation {
  const predicates = {
    readyStateComplete: summary.readyState !== "loading",
    hasBodyText: summary.bodyTextLength > 0,
    noLoginWall: summary.pathCategory !== "login" && summary.titleCategory !== "login",
    noConsentWall: summary.pathCategory !== "consent" && summary.titleCategory !== "consent",
    noBlockWall: summary.pathCategory !== "checkpoint" && summary.titleCategory !== "checkpoint",
    hasMarketplaceItemMarker: summary.hasMarketplaceMarker,
  };
  if (!predicates.noLoginWall || !predicates.noConsentWall || !predicates.noBlockWall) {
    return { verdict: "terminal", predicates };
  }
  const ready =
    predicates.readyStateComplete && predicates.hasBodyText && predicates.hasMarketplaceItemMarker;
  return { verdict: ready ? "ready" : "pending", predicates };
}

export type FacebookRenderFailureReason =
  | "listing-rendered-predicate-missed"
  | "login-wall"
  | "consent-interstitial"
  | "checkpoint-block"
  | "listing-unavailable"
  | "empty-page"
  | "navigation-failure"
  | "deadline-exceeded";

export interface FacebookRenderFailureClassification {
  reason: FacebookRenderFailureReason;
  code: FacebookExtractionErrorCode;
  message: string;
}

/**
 * Turns a stalled render wait into one specific, actionable outcome instead of
 * the single undifferentiated "timed out before readiness".
 */
export function classifyFacebookRenderFailure(input: {
  probe: FacebookRenderProbeSummary | null;
  outcome: FacebookRenderWaitOutcome | "navigation-failure";
}): FacebookRenderFailureClassification {
  if (input.outcome === "navigation-failure") {
    return {
      reason: "navigation-failure",
      code: "FACEBOOK_NAVIGATION_TIMEOUT",
      message: "Facebook navigation failed before the page could be read.",
    };
  }
  if (input.outcome === "deadline") {
    return {
      reason: "deadline-exceeded",
      code: "FACEBOOK_NAVIGATION_TIMEOUT",
      message: "Facebook did not finish rendering before the extraction deadline.",
    };
  }

  const probe = input.probe;
  if (!probe) {
    return {
      reason: "listing-unavailable",
      code: "FACEBOOK_LISTING_NOT_RENDERED",
      message: "Facebook returned no readable page state.",
    };
  }
  if (probe.pathCategory === "login" || probe.titleCategory === "login") {
    return {
      reason: "login-wall",
      code: "FACEBOOK_LOGIN_REQUIRED",
      message: "Facebook served a login wall instead of the listing.",
    };
  }
  if (probe.pathCategory === "consent" || probe.titleCategory === "consent") {
    return {
      reason: "consent-interstitial",
      code: "FACEBOOK_CONSENT_REQUIRED",
      message: "Facebook served a cookie/consent interstitial instead of the listing.",
    };
  }
  if (probe.pathCategory === "checkpoint" || probe.titleCategory === "checkpoint") {
    return {
      reason: "checkpoint-block",
      code: "FACEBOOK_BLOCKED",
      message: "Facebook served an anti-bot checkpoint instead of the listing.",
    };
  }
  if (probe.titleCategory === "unavailable") {
    return {
      reason: "listing-unavailable",
      code: "FACEBOOK_LISTING_NOT_RENDERED",
      message: "Facebook reported that this listing is unavailable.",
    };
  }
  if (probe.bodyTextLength === 0) {
    return {
      reason: "empty-page",
      code: "FACEBOOK_LISTING_NOT_RENDERED",
      message: "Facebook served an empty document.",
    };
  }
  // The page carried listing evidence but the gate still never confirmed twice in
  // a row: the render was usable-looking yet readiness never stabilised.
  return {
    reason: "listing-rendered-predicate-missed",
    code: "FACEBOOK_LISTING_NOT_RENDERED",
    message: "Facebook rendered a page with listing markers but readiness never stabilised.",
  };
}

export function isSupportedFacebookMarketplaceUrl(rawUrl: string): boolean {
  const parsed = parseFacebookUrl(rawUrl);
  return !!parsed && (isSharePath(parsed) || isMarketplaceItemPath(parsed));
}

/**
 * True only for a direct `facebook.com/marketplace/item/<numeric-id>` URL on an
 * allowed host over HTTPS without credentials. Share URLs deliberately return
 * false: they keep their existing rendering path unless the existing code
 * explicitly resolves them publicly.
 */
export function isDirectFacebookMarketplaceItemUrl(rawUrl: string): boolean {
  const parsed = parseFacebookUrl(rawUrl);
  return !!parsed && isMarketplaceItemPath(parsed);
}

/** Returns the validated, canonical direct Marketplace URL or null. */
export function validatedFacebookMarketplaceItemUrl(rawUrl: string): string | null {
  if (!isDirectFacebookMarketplaceItemUrl(rawUrl)) return null;
  const itemId = extractFacebookItemId(rawUrl);
  return itemId ? canonicalFacebookItemUrl(itemId) : null;
}

export function extractFacebookItemId(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).pathname.match(ITEM_ID_RE)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function canonicalFacebookItemUrl(itemId: string): string {
  return `https://www.facebook.com/marketplace/item/${itemId}/`;
}

function parseFacebookUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url;
}

function isMarketplaceItemPath(url: URL): boolean {
  return ITEM_ID_RE.test(url.pathname);
}

function isSharePath(url: URL): boolean {
  return /^\/share\/[^/]+\/?$/i.test(url.pathname);
}

function assertFacebookNavigation(url: string, code: FacebookExtractionErrorCode) {
  if (!parseFacebookUrl(url)) {
    throw new FacebookExtractionError(code, "Facebook navigation left the allowed host set.");
  }
}

export type FacebookPageState = "listing-available" | "login-required" | "blocked" | "unknown";

function hasPrimaryFacebookListingEvidence(
  url: string,
  bodyText: string,
  ogUrl?: string,
): boolean {
  if (extractFacebookItemId(url) || extractFacebookItemId(ogUrl ?? "")) return true;

  const primary = primaryFacebookListingText(bodyText);
  const hasDetailSection = /\b(?:about this vehicle|seller'?s description)\b/i.test(primary);
  const hasVehicleValue =
    /\b(?:19|20)\d{2}\b/.test(primary) ||
    /(?:CA|US)?\$\s*[\d,. ]+/i.test(primary) ||
    /\bdriven\s+[\d,.\s]+\s*(?:km|kilometres|kilometers)\b/i.test(primary);
  return hasDetailSection && hasVehicleValue;
}

export function detectFacebookPageState(
  url: string,
  bodyText: string,
  ogUrl?: string,
): FacebookPageState {
  // Facebook can render login controls beside an anonymously readable listing.
  // A target item URL/metadata or primary listing details is stronger evidence than that UI.
  if (hasPrimaryFacebookListingEvidence(url, bodyText, ogUrl)) return "listing-available";

  const lowerUrl = url.toLowerCase();
  const lowerText = bodyText.toLowerCase();
  if (
    [
      "temporarily blocked",
      "you're temporarily blocked",
      "confirm your identity",
      "captcha",
    ].some((marker) => lowerText.includes(marker))
  ) {
    return "blocked";
  }
  if (
    ["/login", "login.php", "checkpoint", "/recover", "/consent"].some((marker) =>
      lowerUrl.includes(marker),
    ) ||
    [
      "you must log in",
      "log in to continue",
      "log into facebook",
      "please log in",
      "session expired",
    ].some((marker) => lowerText.includes(marker))
  ) {
    return "login-required";
  }
  return "unknown";
}

function detectBlockedState(url: string, bodyText: string, ogUrl?: string) {
  const state = detectFacebookPageState(url, bodyText, ogUrl);
  if (state === "login-required")
    throw new FacebookExtractionError("FACEBOOK_LOGIN_REQUIRED", "Facebook requested login.");
  if (state === "blocked")
    throw new FacebookExtractionError("FACEBOOK_BLOCKED", "Facebook blocked anonymous access.");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function primaryFacebookListingText(bodyText: string): string {
  const normalized = normalizeText(bodyText);
  const end = normalized.search(PRIMARY_SECTION_END_RE);
  return end === -1 ? normalized : normalized.slice(0, end).trim();
}

function firstLineMatching(lines: string[], pattern: RegExp): string {
  return lines.find((line) => pattern.test(line)) ?? "";
}

function sellerDescriptionFromPrimary(lines: string[]): string {
  const start = lines.findIndex((line) => /^seller'?s description$/i.test(line));
  if (start === -1) return "";
  return lines
    .slice(start + 1)
    .filter((line) => !/^see more$/i.test(line))
    .join("\n")
    .trim()
    .slice(0, 4000);
}

function locationFromPrimary(lines: string[]): string {
  const listed = firstLineMatching(lines, /^listed\b.+\bin\b/i);
  const listedLocation = listed.match(/\bin\s+(.+)$/i)?.[1]?.trim();
  const approximate = firstLineMatching(lines, /\blocation is approximate\b/i)
    .replace(/\s*[\u00b7-]\s*Location is approximate\b/i, "")
    .trim();
  return listedLocation || approximate;
}

function cityFromLocation(location: string): string {
  return location.split(",")[0]?.trim() ?? "";
}

function addIdentity(
  result: ListingUrlExtraction,
  title: string,
  source: ExtractionSource,
) {
  const identity = extractListingIdentity(title);
  for (const [key, value] of Object.entries(identity)) {
    addListingField(result, key as ListingField, value as never, source);
  }
}

function addRenderedText(
  result: ListingUrlExtraction,
  key: ListingField,
  value: VehicleIntake[typeof key] | undefined | null,
  source: ExtractionSource,
) {
  addListingField(result, key, value as never, source);
}

export function extractFacebookListingFromRenderedText(
  rendered: Pick<
    FacebookRenderedListing,
    "bodyText" | "canonicalUrl" | "finalUrl" | "itemId" | "title" | "ogTitle" | "ogDescription"
  >,
  /**
   * Provenance recorded for every derived field. Defaults to the existing
   * browser-rendered source; the HTTP metadata path passes `meta` so field
   * provenance stays accurate.
   */
  source: ExtractionSource = "facebook-rendered",
): ListingUrlExtraction {
  const result: ListingUrlExtraction = {
    details: {},
    found: [],
    uncertain: [],
    provenance: {},
    methods: [],
  };
  addListingField(result, "listingUrl", rendered.canonicalUrl, "url");
  addListingField(result, "listingSource", "facebook.com", "url");

  const primary = primaryFacebookListingText(rendered.bodyText);
  const lines = primary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title =
    rendered.ogTitle ||
    firstLineMatching(lines, /\b(19|20)\d{2}\b/) ||
    rendered.title.replace(/\s+\| Facebook.*$/i, "");
  addRenderedText(result, "listingTitle", title, source);
  addIdentity(result, title, source);

  const priceLine = firstLineMatching(lines, /^(?:CA|US)?\$\s*[\d,. ]+/i);
  if (/^CA\$/i.test(priceLine)) addRenderedText(result, "priceCurrency", "CAD", source);
  const price = priceLine ? normalizeListingNumber(priceLine) : null;
  if (price !== null) addRenderedText(result, "askingPriceCad", price, source);

  const mileageLine = firstLineMatching(lines, /\bdriven\s+[\d,.\s]+\s*(km|kilometres|kilometers)\b/i);
  const mileage = mileageLine ? normalizeListingNumber(mileageLine) : null;
  if (mileage !== null) {
    addRenderedText(result, "mileageUnit", "km", source);
    addRenderedText(result, "mileageKm", Math.round(mileage), source);
  }

  const transmission = firstLineMatching(lines, /\b(automatic|manual|cvt)\s+transmission\b/i)
    .replace(/\s+transmission\b/i, "")
    .trim();
  addRenderedText(result, "transmission", transmission, source);

  const location = locationFromPrimary(lines);
  addRenderedText(result, "location", location, source);
  addRenderedText(result, "city", cityFromLocation(location), source);

  const description = sellerDescriptionFromPrimary(lines) || rendered.ogDescription || "";
  const claims = lines
    .filter((line) =>
      /fuel type|exterior colou?r|interior colou?r|\d\+?\s*owners?/i.test(line),
    )
    .join("\n");
  addRenderedText(
    result,
    "sellerDescription",
    [description, claims].filter(Boolean).join("\n\n").slice(0, 4000),
    source,
  );

  result.found = Object.keys(result.details).filter((key) => {
    const value = result.details[key as keyof VehicleIntake];
    return value !== undefined && value !== null && value !== "";
  });
  result.uncertain = [...new Set(result.uncertain)];
  if (!result.details.make || !result.details.model)
    result.uncertain.push("make", "model");
  return result;
}

async function loadPuppeteer(): Promise<{
  launch: (options: Record<string, unknown>) => Promise<BrowserLike>;
}> {
  const puppeteer = (await import("puppeteer-core")) as {
    default?: { launch: (options: Record<string, unknown>) => Promise<BrowserLike> };
    launch?: (options: Record<string, unknown>) => Promise<BrowserLike>;
  };
  const loaded = puppeteer.default ?? puppeteer;
  if (!loaded.launch)
    throw new FacebookExtractionError(
      "FACEBOOK_BROWSER_LAUNCH_FAILED",
      "puppeteer-core did not expose a launch function.",
    );
  return { launch: loaded.launch };
}

interface ServerlessChromiumLike {
  args: string[];
  executablePath: () => Promise<string>;
  setGraphicsMode: boolean;
}

export type FacebookChromiumLaunchVariantName =
  | "A-control"
  | "B-no-in-process-gpu"
  | "C-no-single-process"
  | "D-no-single-process-or-in-process-gpu";

export interface FacebookChromiumArgvVariant {
  name: FacebookChromiumLaunchVariantName;
  removedArgs: string[];
  args: string[];
}

const SERVERLESS_PROCESS_ARGS = ["--single-process", "--in-process-gpu"] as const;

const SERVERLESS_ARGV_VARIANTS: ReadonlyArray<{
  name: FacebookChromiumLaunchVariantName;
  removedArgs: ReadonlyArray<(typeof SERVERLESS_PROCESS_ARGS)[number]>;
}> = [
  { name: "A-control", removedArgs: [] },
  { name: "B-no-in-process-gpu", removedArgs: ["--in-process-gpu"] },
  { name: "C-no-single-process", removedArgs: ["--single-process"] },
  {
    name: "D-no-single-process-or-in-process-gpu",
    removedArgs: ["--single-process", "--in-process-gpu"],
  },
];

const REQUIRED_SERVERLESS_GRAPHICS_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
] as const;

const CONFLICTING_SERVERLESS_GRAPHICS_ARGS = [
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--disable-webgl",
] as const;

export function validateFacebookChromiumGraphicsArgs(args: string[]): string[] {
  const missing = REQUIRED_SERVERLESS_GRAPHICS_ARGS.filter((arg) => !args.includes(arg));
  const conflicting = CONFLICTING_SERVERLESS_GRAPHICS_ARGS.filter((arg) =>
    args.includes(arg),
  );
  const graphicsArgs = args.filter(
    (arg) =>
      REQUIRED_SERVERLESS_GRAPHICS_ARGS.includes(
        arg as (typeof REQUIRED_SERVERLESS_GRAPHICS_ARGS)[number],
      ) ||
      CONFLICTING_SERVERLESS_GRAPHICS_ARGS.includes(
        arg as (typeof CONFLICTING_SERVERLESS_GRAPHICS_ARGS)[number],
      ),
  );
  const duplicates = graphicsArgs.filter((arg, index) => graphicsArgs.indexOf(arg) !== index);
  if (missing.length || conflicting.length || duplicates.length) {
    throw new FacebookExtractionError(
      "FACEBOOK_BROWSER_LAUNCH_FAILED",
      `Invalid serverless Chromium graphics arguments (missing: ${missing.join(", ") || "none"}; conflicting: ${conflicting.join(", ") || "none"}; duplicates: ${[...new Set(duplicates)].join(", ") || "none"}).`,
    );
  }
  return [...args];
}

export function buildFacebookChromiumArgvVariants(
  sparticuzArgs: string[],
): FacebookChromiumArgvVariant[] {
  const controlArgs = validateFacebookChromiumGraphicsArgs(sparticuzArgs);
  const missingProcessArgs = SERVERLESS_PROCESS_ARGS.filter(
    (arg) => !controlArgs.includes(arg),
  );
  if (missingProcessArgs.length) {
    throw new FacebookExtractionError(
      "FACEBOOK_BROWSER_LAUNCH_FAILED",
      `Sparticuz Chromium no longer supplies the controlled process arguments: ${missingProcessArgs.join(", ")}.`,
    );
  }
  return SERVERLESS_ARGV_VARIANTS.map((variant) => ({
    name: variant.name,
    removedArgs: [...variant.removedArgs],
    args: validateFacebookChromiumGraphicsArgs(
      controlArgs.filter((arg) => !variant.removedArgs.includes(
        arg as (typeof SERVERLESS_PROCESS_ARGS)[number],
      )),
    ),
  }));
}

export async function facebookServerlessChromiumLaunchVariants(
  chromium: ServerlessChromiumLike,
) {
  // Preserve Sparticuz's supported SwANGLE stack in every matrix entry. The
  // only controlled variables are its process-collapsing flags.
  chromium.setGraphicsMode = true;
  const variants = buildFacebookChromiumArgvVariants(chromium.args);
  const executablePath = await chromium.executablePath();
  if (!executablePath) {
    throw new FacebookExtractionError(
      "FACEBOOK_BROWSER_EXECUTABLE_NOT_FOUND",
      "The hosted Chromium executable could not be resolved.",
    );
  }
  return variants.map((variant) => ({
    ...variant,
    executablePath,
    headless: "shell" as const,
  }));
}

export async function facebookServerlessChromiumLaunchOptions(
  chromium: ServerlessChromiumLike,
) {
  const [control] = await facebookServerlessChromiumLaunchVariants(chromium);
  if (!control) throw new Error("Facebook Chromium control variant is missing.");
  return {
    args: control.args,
    executablePath: control.executablePath,
    headless: control.headless,
  };
}

export async function facebookRenderChromiumLaunchOptions(
  chromium: ServerlessChromiumLike,
) {
  const variants = await facebookServerlessChromiumLaunchVariants(chromium);
  const renderVariant = variants.find(
    ({ name }) => name === "D-no-single-process-or-in-process-gpu",
  );
  if (!renderVariant) throw new Error("Facebook Render Chromium variant is missing.");
  return renderVariant;
}

export async function reuseOrCreateFacebookPage<T>(browser: {
  pages: () => Promise<T[]>;
  newPage: () => Promise<T>;
}): Promise<T> {
  const [existingPage] = await browser.pages();
  return existingPage ?? browser.newPage();
}

export async function closeFacebookBrowserForCleanup(
  browser: BrowserLike | undefined,
): Promise<void> {
  // A persistent worker must never leak a Chrome process when a request fails.
  // A graceful close is attempted first; a stubborn or crashed browser process is
  // then signalled directly so no zombie Chrome is left behind.
  if (!browser) return;
  try {
    await browser.close();
    return;
  } catch {
    // Fall through to a forced process kill.
  }
  const browserProcess = readLifecycleValue(() => browser.process?.()) ?? null;
  if (!browserProcess) return;
  try {
    if (browserProcess.exitCode === null || browserProcess.exitCode === undefined) {
      browserProcess.kill?.("SIGKILL");
    }
  } catch {
    // Cleanup must never mask the original extraction failure.
  }
}

export type FacebookBrowserExecutableResolution =
  | { kind: "local"; executablePath: string; source: "override" | "discovered" }
  | { kind: "vercel" }
  | { kind: "render" }
  | { kind: "missing" };

type BrowserEnvironment = Readonly<Record<string, string | undefined>>;

function configuredChromeExecutable(environment: BrowserEnvironment): string | undefined {
  return environment.CHROME_EXECUTABLE_PATH || environment.PUPPETEER_EXECUTABLE_PATH;
}

export function facebookBrowserRuntime(
  environment: BrowserEnvironment = process.env,
): "render" | "vercel" | "local" {
  if (environment.RENDER === "true") return "render";
  if (environment.VERCEL) return "vercel";
  return "local";
}

function localChromeCandidates(environment: BrowserEnvironment): string[] {
  const roots = [
    environment.LOCALAPPDATA,
    environment.PROGRAMFILES,
    environment["PROGRAMFILES(X86)"],
  ].filter((root): root is string => Boolean(root));
  return roots.flatMap((root) => [
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Chromium", "Application", "chrome.exe"),
  ]);
}

/**
 * Chrome flags for a normal persistent Linux host (the Cloudways worker) are
 * supplied explicitly through `AUTOCHECK_CHROME_ARGS`, e.g.
 * `--no-sandbox --disable-setuid-sandbox`. The serverless graphics/process flags
 * used on Vercel are deliberately not applied here. Only `--` prefixed tokens
 * are accepted so the variable cannot inject arbitrary launch arguments.
 */
export function configuredLocalChromeArgs(
  environment: BrowserEnvironment = process.env,
): string[] {
  return (environment.AUTOCHECK_CHROME_ARGS ?? "")
    .split(/[\s,]+/)
    .map((arg) => arg.trim())
    .filter((arg) => arg.startsWith("--"));
}

export function resolveFacebookBrowserExecutable(
  environment: BrowserEnvironment = process.env,
  executableExists: (path: string) => boolean = existsSync,
): FacebookBrowserExecutableResolution {
  const configured = configuredChromeExecutable(environment);
  if (configured) return { kind: "local", executablePath: configured, source: "override" };
  const runtime = facebookBrowserRuntime(environment);
  if (runtime === "render") return { kind: "render" };
  if (runtime === "vercel") return { kind: "vercel" };
  const discovered = localChromeCandidates(environment).find(executableExists);
  return discovered
    ? { kind: "local", executablePath: discovered, source: "discovered" }
    : { kind: "missing" };
}

interface FacebookChromiumLaunchPlan {
  name: FacebookChromiumLaunchVariantName | "local";
  serverless: boolean;
  launchMatrix: boolean;
  runtime: "render" | "vercel" | "local";
  executableSource: "override" | "discovered" | "sparticuz";
  removedArgs: string[];
  configuredArgs?: string[];
  options: Record<string, unknown>;
}

async function chromiumLaunchPlans(
  environment: BrowserEnvironment = process.env,
): Promise<FacebookChromiumLaunchPlan[]> {
  const executable = resolveFacebookBrowserExecutable(environment);
  if (executable.kind === "local") {
    const localArgs = configuredLocalChromeArgs(environment);
    return [{
      name: "local",
      serverless: false,
      launchMatrix: false,
      runtime: facebookBrowserRuntime(environment),
      executableSource: executable.source,
      removedArgs: [],
      options: {
        executablePath: executable.executablePath,
        headless: true,
        ...(localArgs.length ? { args: localArgs } : {}),
      },
    }];
  }
  if (executable.kind === "vercel") {
    const { default: chromium } = await import("@sparticuz/chromium");
    return (await facebookServerlessChromiumLaunchVariants(chromium)).map(
      ({ name, removedArgs, args, executablePath, headless }) => ({
        name,
        serverless: true,
        launchMatrix: true,
        runtime: "vercel",
        executableSource: "sparticuz",
        removedArgs,
        configuredArgs: args,
        options: { args, executablePath, headless },
      }),
    );
  }
  if (executable.kind === "render") {
    const { default: chromium } = await import("@sparticuz/chromium");
    const { name, removedArgs, args, executablePath, headless } =
      await facebookRenderChromiumLaunchOptions(chromium);
    return [{
      name,
      serverless: true,
      launchMatrix: false,
      runtime: "render",
      executableSource: "sparticuz",
      removedArgs,
      configuredArgs: args,
      options: { args, executablePath, headless },
    }];
  }
  throw new FacebookExtractionError(
    "FACEBOOK_BROWSER_EXECUTABLE_NOT_FOUND",
    "No local Chrome or Chromium executable was found. Set CHROME_EXECUTABLE_PATH to configure one.",
  );
}

function remainingTimeout(deadline: number): number {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new FacebookExtractionError(
      "FACEBOOK_NAVIGATION_TIMEOUT",
      "Facebook navigation exceeded its timeout.",
    );
  }
  return remainingMs;
}

/**
 * The probe runs inside the page, so it must not close over anything outside
 * itself. It returns only raw signals; the log-safe reduction happens in Node
 * via `summarizeFacebookRenderProbe`, which is why no HTML, rendered text,
 * cookies, headers or query string ever reach a log record.
 */
export function facebookRenderProbeInPage(): FacebookRenderProbe {
  const ogUrl =
    document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content ?? "";
  const bodyText = document.body?.innerText ?? "";
  return {
    host: window.location.hostname,
    // pathname only: excludes the query string, which can carry session data.
    path: window.location.pathname,
    title: document.title,
    readyState: document.readyState,
    bodyTextLength: bodyText.trim().length,
    hasOgUrl: ogUrl.trim().length > 0,
    hasMarketplaceMarker: /\/marketplace\/item\/\d+(?:\/|$)/i.test(
      `${window.location.pathname}\n${ogUrl}`,
    ),
    hasListingDetailMarkers: /\b(?:about this vehicle|seller'?s description)\b/i.test(bodyText),
  };
}

// ---------------------------------------------------------------------------
// Login-wall modal survey and conservative dismissal
//
// Facebook sometimes renders a login/signup modal on top of an anonymously
// readable Marketplace item instead of redirecting to /login. This section
// answers which case occurred without ever moving raw page content into a log
// record:
//
//   1. Diagnostics — `facebookLoginWallSurveyInPage` reports only categories,
//      counts and booleans (visible/auth dialog counts, whether a semantically
//      labelled close control exists, whether listing markers render outside
//      the dialog), so FACEBOOK_LOGIN_REQUIRED can be classified as a real
//      /login redirect or a dismissible modal from worker.log alone.
//   2. Recovery — when, and only when, the survey proves a login/signup modal
//      sits over a Marketplace item page whose listing DOM renders outside the
//      dialog, `evaluateFacebookLoginWallDismissal` allows exactly one click,
//      and `facebookLoginWallDismissInPage` re-validates every condition in
//      the page before touching a single control.
//
// Targets are restricted to stable semantics: `button`, `[role="button"]`,
// and an aria-label/title/text that says close or dismiss. Generated class
// names, the `<i data-visualcompletion="css-img">` icon nodes, sprite/CSS
// backgrounds and nth-child positions are never inspected or clicked.
// ---------------------------------------------------------------------------

/** A semantically labelled close control found inside a visible auth dialog. */
export interface FacebookLoginWallSafeControl {
  controlType: "button" | "role-button";
  labelSource: "aria-label" | "title" | "text";
  labelKind: "close" | "dismiss";
}

/**
 * Raw survey signals collected inside the page. Every string is categorised
 * in-page ("close", "dismiss"), so no aria-label, dialog text, URL or DOM
 * fragment ever leaves the browser context.
 */
export interface FacebookLoginWallSurvey {
  bodyTextLength: number;
  visibleDialogCount: number;
  authDialogCount: number;
  safeDismissControl: FacebookLoginWallSafeControl | null;
  listingMarkersOutsideDialog: boolean;
  marketplaceItemLinksOutsideDialog: number;
}

export interface FacebookLoginWallDismissResult {
  clicked: boolean;
  outcome:
    | "clicked"
    | "path-not-item"
    | "no-auth-dialog"
    | "no-listing-behind-dialog"
    | "no-safe-control"
    | "click-failed";
}

/** Log-safe reduction of a survey: categories, counts and booleans only. */
export interface FacebookLoginWallDiagnostics {
  pathCategory: FacebookPathCategory;
  titleCategory: FacebookTitleCategory;
  bodyTextLength: number;
  visibleDialogCount: number;
  authDialogCount: number;
  hasSafeControl: boolean;
  safeControlType: "button" | "role-button" | null;
  safeControlLabelSource: "aria-label" | "title" | "text" | null;
  safeControlLabelKind: "close" | "dismiss" | null;
  listingMarkersOutsideDialog: boolean;
  marketplaceItemLinksOutsideDialog: number;
}

export type FacebookLoginWallDismissalDecision =
  | { action: "attempt"; reason: "dismissible-login-modal-over-listing" }
  | { action: "no-safe-control"; reason: "no-labeled-close-control" }
  | {
      action: "not-applicable";
      reason:
        | "survey-unavailable"
        | "redirected-to-login"
        | "not-marketplace-item-path"
        | "no-auth-dialog"
        | "no-listing-behind-dialog";
    };

/** Log-safe record of the single dismissal attempt, or of why none happened. */
export interface FacebookLoginWallDismissalDiagnostics {
  action: FacebookLoginWallDismissalDecision["action"];
  reason: FacebookLoginWallDismissalDecision["reason"];
  clickResult:
    | FacebookLoginWallDismissResult["outcome"]
    | "not-attempted"
    | "evaluate-failed"
    | "deadline-exceeded"
    | null;
  dialogClosedAfterClick: boolean | null;
  stabilizationPolls: number;
  recovered: boolean;
}

/**
 * Runs inside the page: a read-only survey of the current login wall. It never
 * clicks, and it returns no page text, no labels and no DOM fragments — only
 * counts, booleans and categorised control metadata.
 */
export function facebookLoginWallSurveyInPage(): FacebookLoginWallSurvey {
  const authPromptRe =
    /\b(?:log\s?in|sign\s?up|sign\s?in|create\s+(?:new\s+)?account|forgot\s+(?:your\s+)?password)\b/i;
  const closeRe = /\bclose\b/i;
  const dismissRe = /\bdismiss\b/i;
  const bodyText = document.body ? document.body.innerText : "";

  const dialogNodes = document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog');
  const visibleDialogs: Element[] = [];
  for (let i = 0; i < dialogNodes.length; i += 1) {
    const dialog = dialogNodes[i];
    const style = window.getComputedStyle(dialog);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      continue;
    }
    if (dialog.getClientRects().length === 0) continue;
    visibleDialogs.push(dialog);
  }

  const authDialogs: Element[] = [];
  for (let i = 0; i < visibleDialogs.length; i += 1) {
    const text = visibleDialogs[i].textContent ?? "";
    if (authPromptRe.test(text.slice(0, 4000))) authDialogs.push(visibleDialogs[i]);
  }

  let safeDismissControl: FacebookLoginWallSafeControl | null = null;
  for (let d = 0; d < authDialogs.length && !safeDismissControl; d += 1) {
    const controls = authDialogs[d].querySelectorAll('button, [role="button"]');
    for (let i = 0; i < controls.length && !safeDismissControl; i += 1) {
      const control = controls[i];
      const style = window.getComputedStyle(control);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        continue;
      }
      if (control.getClientRects().length === 0) continue;
      if (typeof (control as HTMLElement).click !== "function") continue;
      const ariaLabel = control.getAttribute("aria-label");
      const titleAttr = control.getAttribute("title");
      const controlText = (control.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
      let labelSource: "aria-label" | "title" | "text" | null = null;
      let labelText = "";
      if (ariaLabel && (closeRe.test(ariaLabel) || dismissRe.test(ariaLabel))) {
        labelSource = "aria-label";
        labelText = ariaLabel;
      } else if (titleAttr && (closeRe.test(titleAttr) || dismissRe.test(titleAttr))) {
        labelSource = "title";
        labelText = titleAttr;
      } else if (controlText && (closeRe.test(controlText) || dismissRe.test(controlText))) {
        labelSource = "text";
        labelText = controlText;
      }
      if (!labelSource) continue;
      safeDismissControl = {
        controlType: control.tagName === "BUTTON" ? "button" : "role-button",
        labelSource,
        labelKind: dismissRe.test(labelText) ? "dismiss" : "close",
      };
    }
  }

  // Listing evidence outside the visible dialogs: a bounded text scan plus
  // Marketplace item links. This is what proves that dismissing the dialog
  // would reveal existing listing DOM instead of an empty shell.
  let outsideText = "";
  const textRoot = document.body ? document.body : document.documentElement;
  if (textRoot) {
    const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT, {
      acceptNode: (node: Node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        for (let i = 0; i < visibleDialogs.length; i += 1) {
          if (visibleDialogs[i].contains(parent)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node && outsideText.length < 20000) {
      outsideText += `${node.textContent ?? ""} `;
      node = walker.nextNode();
    }
  }
  const listingMarkersOutsideDialog =
    /\/marketplace\/item\/\d+|\b(?:about this vehicle|seller'?s description)\b/i.test(outsideText);

  let marketplaceItemLinksOutsideDialog = 0;
  const itemLinks = document.querySelectorAll('a[href*="/marketplace/item/"]');
  for (let i = 0; i < itemLinks.length; i += 1) {
    let insideDialog = false;
    for (let d = 0; d < visibleDialogs.length; d += 1) {
      if (visibleDialogs[d].contains(itemLinks[i])) {
        insideDialog = true;
        break;
      }
    }
    if (insideDialog) continue;
    marketplaceItemLinksOutsideDialog += 1;
    if (marketplaceItemLinksOutsideDialog >= 99) break;
  }

  return {
    bodyTextLength: bodyText.trim().length,
    visibleDialogCount: visibleDialogs.length,
    authDialogCount: authDialogs.length,
    safeDismissControl,
    listingMarkersOutsideDialog,
    marketplaceItemLinksOutsideDialog,
  };
}

/**
 * Runs inside the page immediately before a click. It repeats every survey
 * condition (self-contained: page functions cannot close over module scope)
 * so a stale Node-side decision can never click outside a Marketplace item
 * page, inside a non-auth dialog, or without listing DOM behind the dialog.
 * At most one element is clicked, via `.click()`.
 */
export function facebookLoginWallDismissInPage(): FacebookLoginWallDismissResult {
  if (!/\/marketplace\/item\/\d+/i.test(window.location.pathname)) {
    return { clicked: false, outcome: "path-not-item" };
  }
  const authPromptRe =
    /\b(?:log\s?in|sign\s?up|sign\s?in|create\s+(?:new\s+)?account|forgot\s+(?:your\s+)?password)\b/i;
  const closeRe = /\bclose\b/i;
  const dismissRe = /\bdismiss\b/i;

  const dialogNodes = document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog');
  const visibleDialogs: Element[] = [];
  for (let i = 0; i < dialogNodes.length; i += 1) {
    const dialog = dialogNodes[i];
    const style = window.getComputedStyle(dialog);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      continue;
    }
    if (dialog.getClientRects().length === 0) continue;
    visibleDialogs.push(dialog);
  }

  const authDialogs: Element[] = [];
  for (let i = 0; i < visibleDialogs.length; i += 1) {
    const text = visibleDialogs[i].textContent ?? "";
    if (authPromptRe.test(text.slice(0, 4000))) authDialogs.push(visibleDialogs[i]);
  }
  if (authDialogs.length === 0) return { clicked: false, outcome: "no-auth-dialog" };

  let listingMarkersOutsideDialog = false;
  let marketplaceItemLinksOutsideDialog = 0;
  const textRoot = document.body ? document.body : document.documentElement;
  if (textRoot) {
    const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT, {
      acceptNode: (node: Node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        for (let i = 0; i < visibleDialogs.length; i += 1) {
          if (visibleDialogs[i].contains(parent)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let outsideText = "";
    let node = walker.nextNode();
    while (node && outsideText.length < 20000) {
      outsideText += `${node.textContent ?? ""} `;
      node = walker.nextNode();
    }
    listingMarkersOutsideDialog =
      /\/marketplace\/item\/\d+|\b(?:about this vehicle|seller'?s description)\b/i.test(
        outsideText,
      );
  }
  const itemLinks = document.querySelectorAll('a[href*="/marketplace/item/"]');
  for (let i = 0; i < itemLinks.length; i += 1) {
    let insideDialog = false;
    for (let d = 0; d < visibleDialogs.length; d += 1) {
      if (visibleDialogs[d].contains(itemLinks[i])) {
        insideDialog = true;
        break;
      }
    }
    if (insideDialog) continue;
    marketplaceItemLinksOutsideDialog += 1;
    if (marketplaceItemLinksOutsideDialog >= 99) break;
  }
  if (!listingMarkersOutsideDialog && marketplaceItemLinksOutsideDialog === 0) {
    return { clicked: false, outcome: "no-listing-behind-dialog" };
  }

  let closeTarget: HTMLElement | null = null;
  for (let d = 0; d < authDialogs.length && !closeTarget; d += 1) {
    const controls = authDialogs[d].querySelectorAll('button, [role="button"]');
    for (let i = 0; i < controls.length && !closeTarget; i += 1) {
      const control = controls[i] as HTMLElement;
      const style = window.getComputedStyle(control);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        continue;
      }
      if (control.getClientRects().length === 0) continue;
      if (typeof control.click !== "function") continue;
      const ariaLabel = control.getAttribute("aria-label");
      const titleAttr = control.getAttribute("title");
      const controlText = (control.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
      const labelled =
        (ariaLabel && (closeRe.test(ariaLabel) || dismissRe.test(ariaLabel))) ||
        (titleAttr && (closeRe.test(titleAttr) || dismissRe.test(titleAttr))) ||
        (controlText && (closeRe.test(controlText) || dismissRe.test(controlText)));
      if (!labelled) continue;
      closeTarget = control;
    }
  }
  if (!closeTarget) return { clicked: false, outcome: "no-safe-control" };

  try {
    closeTarget.click();
  } catch {
    return { clicked: false, outcome: "click-failed" };
  }
  return { clicked: true, outcome: "clicked" };
}

/** Log-safe reduction of a survey: categories, counts and booleans only. */
export function summarizeFacebookLoginWallSurvey(
  survey: FacebookLoginWallSurvey,
  probe: FacebookRenderProbeSummary,
): FacebookLoginWallDiagnostics {
  const control = survey.safeDismissControl;
  return {
    pathCategory: probe.pathCategory,
    titleCategory: probe.titleCategory,
    bodyTextLength: survey.bodyTextLength,
    visibleDialogCount: survey.visibleDialogCount,
    authDialogCount: survey.authDialogCount,
    hasSafeControl: control !== null,
    safeControlType: control ? control.controlType : null,
    safeControlLabelSource: control ? control.labelSource : null,
    safeControlLabelKind: control ? control.labelKind : null,
    listingMarkersOutsideDialog: survey.listingMarkersOutsideDialog,
    marketplaceItemLinksOutsideDialog: survey.marketplaceItemLinksOutsideDialog,
  };
}

/**
 * The single decision point for modal dismissal, kept pure so every branch is
 * unit testable without a browser. Dismissal is allowed only for a
 * login/signup modal that sits on a Marketplace item path, with auth-dialog
 * evidence, listing DOM outside the dialog, and a labelled close control.
 */
export function evaluateFacebookLoginWallDismissal(input: {
  pathCategory: FacebookPathCategory;
  survey: FacebookLoginWallSurvey | null;
}): FacebookLoginWallDismissalDecision {
  if (!input.survey) return { action: "not-applicable", reason: "survey-unavailable" };
  // A redirected /login page has no Marketplace listing DOM underneath it.
  if (input.pathCategory === "login") {
    return { action: "not-applicable", reason: "redirected-to-login" };
  }
  if (input.pathCategory !== "marketplace-item") {
    return { action: "not-applicable", reason: "not-marketplace-item-path" };
  }
  if (input.survey.authDialogCount < 1) {
    return { action: "not-applicable", reason: "no-auth-dialog" };
  }
  const hasListingBehind =
    input.survey.listingMarkersOutsideDialog ||
    input.survey.marketplaceItemLinksOutsideDialog > 0;
  if (!hasListingBehind) {
    return { action: "not-applicable", reason: "no-listing-behind-dialog" };
  }
  if (!input.survey.safeDismissControl) {
    return { action: "no-safe-control", reason: "no-labeled-close-control" };
  }
  return { action: "attempt", reason: "dismissible-login-modal-over-listing" };
}

export interface FacebookRenderSettleOptions {
  /**
   * Bounded window used to observe the DOM settle after a dismissal click.
   * The extraction deadline always caps it, so it can never extend a request.
   */
  stabilizationPollIntervalMs?: number;
  stabilizationTimeoutMs?: number;
}

const FACEBOOK_LOGIN_WALL_STABILIZATION_POLL_MS = 100;
const FACEBOOK_LOGIN_WALL_STABILIZATION_TIMEOUT_MS = 1500;

/**
 * The bounded recovery sequence behind a login wall: survey (read-only) →
 * pure decision → at most one click (re-validated in-page) → stabilisation
 * window → the existing readiness checks again from a clean state. Any
 * failure anywhere returns `recovered: false` so the caller can preserve the
 * original FACEBOOK_LOGIN_REQUIRED classification.
 */
async function runFacebookLoginWallDismissal(input: {
  page: PageLike;
  deadline: number;
  probe: FacebookRenderProbeSummary;
  options?: FacebookRenderSettleOptions;
  retryReadiness: () => Promise<void>;
}): Promise<{
  wall: FacebookLoginWallDiagnostics | null;
  dismissal: FacebookLoginWallDismissalDiagnostics;
  recovered: boolean;
}> {
  const sleep = (delayMs: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });

  let survey: FacebookLoginWallSurvey | null = null;
  try {
    survey = await input.page.evaluate(facebookLoginWallSurveyInPage);
  } catch {
    // Diagnostics must never replace the classified login error.
    survey = null;
  }

  const decision = evaluateFacebookLoginWallDismissal({
    pathCategory: input.probe.pathCategory,
    survey,
  });
  const wall = survey ? summarizeFacebookLoginWallSurvey(survey, input.probe) : null;
  const dismissal: FacebookLoginWallDismissalDiagnostics = {
    action: decision.action,
    reason: decision.reason,
    clickResult: null,
    dialogClosedAfterClick: null,
    stabilizationPolls: 0,
    recovered: false,
  };

  if (decision.action !== "attempt") {
    dismissal.clickResult = "not-attempted";
    return { wall, dismissal, recovered: false };
  }
  if (Date.now() >= input.deadline) {
    dismissal.clickResult = "deadline-exceeded";
    return { wall, dismissal, recovered: false };
  }

  let click: FacebookLoginWallDismissResult | null = null;
  try {
    click = await input.page.evaluate(facebookLoginWallDismissInPage);
  } catch {
    click = null;
  }
  dismissal.clickResult = click ? click.outcome : "evaluate-failed";
  if (!click || !click.clicked) {
    return { wall, dismissal, recovered: false };
  }

  const pollIntervalMs = Math.max(
    0,
    input.options?.stabilizationPollIntervalMs ?? FACEBOOK_LOGIN_WALL_STABILIZATION_POLL_MS,
  );
  const stabilizationTimeoutMs = Math.max(
    0,
    input.options?.stabilizationTimeoutMs ?? FACEBOOK_LOGIN_WALL_STABILIZATION_TIMEOUT_MS,
  );
  const stabilizeUntil = Math.min(input.deadline, Date.now() + stabilizationTimeoutMs);
  let stabilizedSurvey: FacebookLoginWallSurvey | null = null;
  while (Date.now() < stabilizeUntil) {
    let next: FacebookLoginWallSurvey | null = null;
    try {
      next = await input.page.evaluate(facebookLoginWallSurveyInPage);
    } catch {
      next = null;
    }
    dismissal.stabilizationPolls += 1;
    stabilizedSurvey = next;
    if (!next || next.authDialogCount === 0) break;
    const remainingMs = stabilizeUntil - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }

  dismissal.dialogClosedAfterClick = stabilizedSurvey
    ? stabilizedSurvey.authDialogCount === 0
    : null;
  if (!stabilizedSurvey || stabilizedSurvey.authDialogCount !== 0) {
    return { wall, dismissal, recovered: false };
  }
  const listingVisible =
    stabilizedSurvey.listingMarkersOutsideDialog ||
    stabilizedSurvey.marketplaceItemLinksOutsideDialog > 0;
  if (!listingVisible) {
    return { wall, dismissal, recovered: false };
  }

  try {
    await input.retryReadiness();
  } catch {
    // The original FACEBOOK_LOGIN_REQUIRED classification is preserved when
    // genuine Marketplace listing markers are still not available.
    return { wall, dismissal, recovered: false };
  }
  dismissal.recovered = true;
  return { wall, dismissal, recovered: true };
}

interface FacebookRenderWaitResult {
  summary: FacebookRenderProbeSummary | null;
  predicates: Record<string, boolean> | null;
  polls: number;
  elapsedMs: number;
  wall: FacebookLoginWallDiagnostics | null;
  dismissal: FacebookLoginWallDismissalDiagnostics | null;
}

/**
 * Waits for render readiness and, only when the terminal verdict classifies
 * as a login wall, runs the bounded survey/dismissal recovery above.
 * Exported for the regression tests; production callers pass no options.
 */
export async function settle(
  page: PageLike,
  deadline: number,
  phase: "share" | "canonical",
  options?: FacebookRenderSettleOptions,
): Promise<FacebookRenderWaitResult> {
  const startedAt = Date.now();
  let summary: FacebookRenderProbeSummary | null = null;
  let evaluation: FacebookGateEvaluation | null = null;
  let polls = 0;
  let pollsBase = 0;
  // Accessors keep the declared types: control-flow analysis cannot see the
  // assignments made inside the polling closure.
  const readProbe = (): FacebookRenderProbeSummary | null => summary;
  const readEvaluation = (): FacebookGateEvaluation | null => evaluation;

  const runReadiness = async (): Promise<void> => {
    await waitForFacebookRenderReadiness(
      async () => {
        summary = summarizeFacebookRenderProbe(await page.evaluate(facebookRenderProbeInPage));
        evaluation = evaluateFacebookRenderGate(summary);
        // A terminal verdict must never count towards requiredReadyChecks, or a
        // blocking page could be reported as ready.
        return evaluation.verdict === "ready";
      },
      {
        deadline,
        onPoll: (poll) => {
          polls = pollsBase + poll.check;
        },
        terminalCheck: () => readEvaluation()?.verdict === "terminal",
      },
    );
  };

  const retryReadiness = async (): Promise<void> => {
    // Reset the poll bookkeeping and drop the stale terminal verdict: the
    // retry must start clean, or terminalCheck would abort before the first
    // new readiness check could run.
    pollsBase = polls;
    summary = null;
    evaluation = null;
    await runReadiness();
  };

  try {
    await runReadiness();
  } catch (error) {
    if (!(error instanceof FacebookRenderWaitError)) throw error;
    const failedProbe = readProbe();
    const classified = classifyFacebookRenderFailure({
      probe: failedProbe,
      outcome: error.outcome === "ready" ? "checks-exhausted" : error.outcome,
    });

    let wall: FacebookLoginWallDiagnostics | null = null;
    let dismissal: FacebookLoginWallDismissalDiagnostics | null = null;
    if (classified.reason === "login-wall" && failedProbe) {
      const recovery = await runFacebookLoginWallDismissal({
        page,
        deadline,
        probe: failedProbe,
        options,
        retryReadiness,
      });
      wall = recovery.wall;
      dismissal = recovery.dismissal;
      logFacebookLoginWallDismissal(phase, wall, dismissal, Date.now() - startedAt);
      if (recovery.recovered) {
        return {
          summary: readProbe(),
          predicates: readEvaluation()?.predicates ?? null,
          polls,
          elapsedMs: Date.now() - startedAt,
          wall,
          dismissal,
        };
      }
    }

    throw new FacebookExtractionError(classified.code, classified.message, {
      render: facebookRenderDiagnostics({
        phase,
        probe: readProbe(),
        predicates: readEvaluation()?.predicates ?? null,
        polls,
        elapsedMs: Date.now() - startedAt,
        waitOutcome: error.outcome,
        reason: classified.reason,
        wall,
        dismissal,
      }),
    });
  }

  return {
    summary: readProbe(),
    predicates: readEvaluation()?.predicates ?? null,
    polls,
    elapsedMs: Date.now() - startedAt,
    wall: null,
    dismissal: null,
  };
}

/**
 * Log-safe render diagnostics: categories, counts, booleans and timings only.
 * It never contains page HTML, rendered text, cookies, headers, the worker
 * secret, a query string, the raw path or the raw title.
 */
function facebookRenderDiagnostics(input: {
  phase: "share" | "canonical";
  probe: FacebookRenderProbeSummary | null;
  predicates: Record<string, boolean> | null;
  polls: number;
  elapsedMs: number;
  waitOutcome: FacebookRenderWaitOutcome | "ready";
  reason?: FacebookRenderFailureReason;
  timings?: Record<string, number>;
  httpStatus?: number | null;
  pageState?: FacebookPageState;
  wall?: FacebookLoginWallDiagnostics | null;
  dismissal?: FacebookLoginWallDismissalDiagnostics | null;
  session?: {
    configured: boolean;
    loaded: boolean;
    cookieCount: number | null;
    loadFailure: string | null;
  };
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    phase: input.phase,
    outcome: input.waitOutcome,
    reason: input.reason ?? null,
    polls: input.polls,
    waitMs: input.elapsedMs,
    httpStatus: input.httpStatus ?? null,
    pageState: input.pageState ?? null,
    timings: input.timings ?? null,
    page: input.probe,
    predicates: input.predicates,
  };
  if (input.session) {
    out.session = {
      configured: Boolean(input.session.configured),
      loaded: Boolean(input.session.loaded),
      cookieCount: typeof input.session.cookieCount === "number" ? input.session.cookieCount : null,
      loadFailure: input.session.loadFailure ?? null,
    };
  }
  // Log-safe by construction (categories, counts, booleans), and copied field
  // by field so nothing else can ride along into a log record.
  if (input.wall) {
    out.wall = {
      pathCategory: input.wall.pathCategory,
      titleCategory: input.wall.titleCategory,
      bodyTextLength: input.wall.bodyTextLength,
      visibleDialogCount: input.wall.visibleDialogCount,
      authDialogCount: input.wall.authDialogCount,
      hasSafeControl: input.wall.hasSafeControl,
      safeControlType: input.wall.safeControlType,
      safeControlLabelSource: input.wall.safeControlLabelSource,
      safeControlLabelKind: input.wall.safeControlLabelKind,
      listingMarkersOutsideDialog: input.wall.listingMarkersOutsideDialog,
      marketplaceItemLinksOutsideDialog: input.wall.marketplaceItemLinksOutsideDialog,
    };
  }
  if (input.dismissal) {
    out.dismissal = {
      action: input.dismissal.action,
      reason: input.dismissal.reason,
      clickResult: input.dismissal.clickResult,
      dialogClosedAfterClick: input.dismissal.dialogClosedAfterClick,
      stabilizationPolls: input.dismissal.stabilizationPolls,
      recovered: input.dismissal.recovered,
    };
  }
  return out;
}

/** Puppeteer exposes the response status; tolerate both method and value shapes. */
function readNavigationStatus(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const candidate = (response as { status?: unknown }).status;
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "function") {
    try {
      const value = (candidate as () => unknown)();
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function navigate(
  page: PageLike,
  url: string,
  deadline: number,
  lifecycle: FacebookLifecycleTracker,
): Promise<{ status: number | null; elapsedMs: number }> {
  lifecycle.markNavigationStarted();
  const startedAt = Date.now();
  try {
    const response = await retryFacebookPageOperation(
      () =>
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: remainingTimeout(deadline),
        }),
      { deadline, maxAttempts: 2 },
    );
    lifecycle.markNavigationFinished(true);
    return { status: readNavigationStatus(response), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    lifecycle.markNavigationFinished(false);
    throw error;
  }
}

async function snapshot(page: PageLike, deadline: number) {
  const result = await retryFacebookPageOperation(
    () =>
      page.evaluate(() => ({
        finalUrl: window.location.href,
        title: document.title,
        bodyText: document.body?.innerText ?? "",
        ogTitle: document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content,
        ogDescription: document.querySelector<HTMLMetaElement>(
          'meta[property="og:description"]',
        )?.content,
        ogUrl: document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content,
      })),
    { deadline },
  );
  return {
    ...result,
    bodyText: normalizeText(result.bodyText),
  };
}

function facebookRuntimeError(
  error: unknown,
  stage: FacebookRuntimeStage,
  lifecycle: ListingBrowserLifecycleDiagnostics,
): FacebookExtractionError {
  if (error instanceof FacebookExtractionError) {
    return new FacebookExtractionError(error.code, error.message, {
      ...error.diagnostics,
      stage,
      lifecycle,
    });
  }
  const message = errorMessage(error);
  if (/timeout/i.test(message)) {
    return new FacebookExtractionError("FACEBOOK_NAVIGATION_TIMEOUT", message, {
      stage,
      lifecycle,
    });
  }
  if (/cannot find module|failed to launch|executable/i.test(message)) {
    return new FacebookExtractionError("FACEBOOK_BROWSER_LAUNCH_FAILED", message, {
      stage,
      lifecycle,
    });
  }
  return new FacebookExtractionError("FACEBOOK_EXTRACTION_FAILED", message, {
    stage,
    lifecycle,
  });
}

export function shouldTryNextFacebookChromiumVariant(error: unknown): boolean {
  if (!(error instanceof FacebookExtractionError)) return false;
  const lifecycle =
    error.diagnostics?.lifecycle && typeof error.diagnostics.lifecycle === "object"
      ? (error.diagnostics.lifecycle as ListingBrowserLifecycleDiagnostics)
      : undefined;
  if (lifecycle?.deadlineExpired) return false;
  if (error.code === "FACEBOOK_BROWSER_LAUNCH_FAILED") return true;
  return Boolean(
    lifecycle?.browserProcessExitEvent ||
      lifecycle?.browserProcessCloseEvent ||
      lifecycle?.browserProcessSignal ||
      (lifecycle?.browserDisconnectedEvent && lifecycle.browserConnected === false),
  );
}

export async function runFacebookChromiumLaunchMatrix<TVariant, TResult>(
  variants: readonly TVariant[],
  attempt: (variant: TVariant) => Promise<TResult>,
  shouldContinue: (error: unknown) => boolean = shouldTryNextFacebookChromiumVariant,
): Promise<TResult> {
  if (!variants.length) throw new Error("Facebook Chromium launch matrix is empty.");
  for (let index = 0; index < variants.length; index += 1) {
    try {
      return await attempt(variants[index]);
    } catch (error) {
      if (index === variants.length - 1 || !shouldContinue(error)) throw error;
    }
  }
  throw new Error("Facebook Chromium launch matrix exhausted unexpectedly.");
}

function logFacebookChromiumVariant(
  plan: FacebookChromiumLaunchPlan,
  status: "success" | "failure",
  attemptStartedAt: number,
  browserLaunchSucceeded: boolean,
  renderReadSucceeded: boolean,
  lifecycle: ListingBrowserLifecycleDiagnostics,
) {
  if (!plan.serverless) return;
  const record = JSON.stringify({
    event: "facebook_chromium_launch_variant",
    runtime: plan.runtime,
    executableSource: plan.executableSource,
    status,
    variant: plan.name,
    configuredArgs: plan.configuredArgs,
    argvDifference: { removed: plan.removedArgs, added: [] },
    browserLaunchSucceeded,
    navigationSucceeded: lifecycle.lastNavigationSucceeded === true,
    renderReadSucceeded,
    browserProcessExitCode:
      lifecycle.browserProcessExitCode === undefined
        ? null
        : lifecycle.browserProcessExitCode,
    browserProcessSignal:
      lifecycle.browserProcessSignal === undefined
        ? null
        : lifecycle.browserProcessSignal,
    browserProcessSpawnArgs: lifecycle.browserProcessSpawnArgs ?? null,
    browserStderrTail: lifecycle.browserStderrTail ?? null,
    elapsedMs: Date.now() - attemptStartedAt,
    lifecycle,
  });
  if (status === "success") console.info(record);
  else console.error(record);
}

/**
 * One structured stdout line per login-wall dismissal decision, mirroring
 * `logFacebookChromiumVariant`. It carries only categorised and numeric
 * fields (path/title categories, decision enums, booleans, counts) — never
 * the URL, the page title, dialog text, aria labels or HTML — so the live
 * Cloudways run can be classified as a /login redirect or a dismissed modal.
 */
function logFacebookLoginWallDismissal(
  phase: "share" | "canonical",
  wall: FacebookLoginWallDiagnostics | null,
  dismissal: FacebookLoginWallDismissalDiagnostics | null,
  elapsedMs: number,
): void {
  if (!dismissal) return;
  const record = JSON.stringify({
    event: "facebook_login_modal_dismissal",
    phase,
    pathCategory: wall ? wall.pathCategory : null,
    titleCategory: wall ? wall.titleCategory : null,
    visibleDialogCount: wall ? wall.visibleDialogCount : null,
    authDialogCount: wall ? wall.authDialogCount : null,
    hasSafeControl: wall ? wall.hasSafeControl : null,
    listingMarkersOutsideDialog: wall ? wall.listingMarkersOutsideDialog : null,
    action: dismissal.action,
    reason: dismissal.reason,
    clickResult: dismissal.clickResult,
    dialogClosedAfterClick: dismissal.dialogClosedAfterClick,
    stabilizationPolls: dismissal.stabilizationPolls,
    recovered: dismissal.recovered,
    elapsedMs,
  });
  console.info(record);
}

async function renderFacebookMarketplaceListingAttempt(
  rawUrl: string,
  url: URL,
  timeoutMs: number,
  requestStartedAt: number,
  deadline: number,
  puppeteer: Awaited<ReturnType<typeof loadPuppeteer>>,
  plan: FacebookChromiumLaunchPlan,
  sessionCfg: FacebookRenderSessionConfig | null,
  onResolvedDirectUrl: ((url: string) => void) | undefined,
): Promise<FacebookRenderedListing> {
  const attemptStartedAt = Date.now();
  const lifecycle = createFacebookLifecycleTracker(requestStartedAt, deadline);
  let stage: FacebookRuntimeStage = "browser-launch";
  let browser: BrowserLike | undefined;
  let page: PageLike | undefined;
  let browserLaunchSucceeded = false;
  const timings: Record<string, number> = {};
  let lastRenderDiagnostics: Record<string, unknown> | null = null;
  let lastHttpStatus: number | null = null; // moved later; reuse variable above if needed (already exists in outer scope)
  let renderReadSucceeded = false;
  let resolvedDirectUrl: string | undefined;
  const sessionState: {
    configured: boolean;
    loaded: boolean;
    cookieCount: number | null;
    loadFailure: string | null;
  } = {
    configured: Boolean(sessionCfg?.directory),
    loaded: false,
    cookieCount: null,
    loadFailure: null,
  };
  try {
    browser = await puppeteer.launch({
      ...plan.options,
      ...(plan.serverless ? { timeout: remainingTimeout(deadline) } : {}),
      // Match the anonymous mobile Chromium context proven on Cloudways. The
      // renderer still lets Facebook load normally; only returned text is trimmed.
      defaultViewport: { width: 412, height: 915, isMobile: true, hasTouch: true },
    });
    browserLaunchSucceeded = true;
    lifecycle.markBrowserLaunched();
    lifecycle.attachBrowser(browser);
    stage = "page-setup";
    page = await reuseOrCreateFacebookPage(browser);
    lifecycle.attachPage(page);
    page.setDefaultNavigationTimeout?.(timeoutMs);
    await page.setUserAgent?.(
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    );

    // Optional: load Facebook session cookies from a persisted state file
    if (sessionCfg?.directory) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const sessDir = path.resolve(sessionCfg.directory);
        const cookiesPath = path.join(sessDir, "cookies.json");
        if (fs.existsSync(cookiesPath)) {
          const raw = fs.readFileSync(cookiesPath, "utf8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const cookies = parsed
              .filter((c) => c && typeof c === "object" && c.name && c.value)
              .map((c) => ({
                name: c.name,
                value: c.value,
                domain: c.domain || ".facebook.com",
                path: c.path || "/",
                secure: c.secure !== false,
                httpOnly: c.httpOnly !== false,
                sameSite: c.sameSite || "Lax",
                expires: c.expires,
                session: c.session,
              }));
            if (cookies.length > 0) {
              await (page as unknown as { setCookie: (...args: unknown[]) => Promise<void> }).setCookie(...cookies);
              sessionState.loaded = true;
              sessionState.cookieCount = cookies.length;
            } else {
              sessionState.loadFailure = "empty-cookie-set";
            }
          } else {
            sessionState.loadFailure = "malformed-session";
          }
        } else {
          sessionState.loadFailure = "missing-session-file";
        }
      } catch {
        sessionState.loadFailure = "session-load-failed";
      }
    }
    stage = "initial-navigation";
    const initialNavigation = await navigate(page, url.toString(), deadline, lifecycle);
    timings.navigationMs = initialNavigation.elapsedMs;
    lastHttpStatus = initialNavigation.status;
    await readFacebookShareRedirectMeta(page, deadline);
    stage = "render-wait";
    const shareRenderWait = await settle(page, deadline, "share");
    timings.renderWaitMs = (timings.renderWaitMs ?? 0) + shareRenderWait.elapsedMs;
    lastRenderDiagnostics = facebookRenderDiagnostics({
      phase: "share",
      probe: shareRenderWait.summary,
      predicates: shareRenderWait.predicates,
      polls: shareRenderWait.polls,
      elapsedMs: shareRenderWait.elapsedMs,
      waitOutcome: "ready",
      timings: { ...timings },
      httpStatus: lastHttpStatus,
      wall: shareRenderWait.wall,
      dismissal: shareRenderWait.dismissal,
      session: { ...sessionState },
    });
    stage = "share-resolution";
    const shareStartedAt = Date.now();
    const share = await snapshot(page, deadline);
    timings.shareResolveMs = Date.now() - shareStartedAt;
    assertFacebookNavigation(share.finalUrl, "FACEBOOK_SHARE_REDIRECT_FAILED");
    detectBlockedState(share.finalUrl, share.bodyText, share.ogUrl);

    let itemId = extractFacebookItemId(share.finalUrl);
    if (!itemId && share.ogUrl) itemId = extractFacebookItemId(share.ogUrl);
    if (!itemId) throw new FacebookExtractionError("FACEBOOK_ITEM_NOT_FOUND", "No Marketplace item ID found.");
    const canonicalUrl = canonicalFacebookItemUrl(itemId);
    resolvedDirectUrl = canonicalUrl;
    // This callback is deliberately invoked only after host/path/id validation.
    // It lets the worker retain a usable direct URL if later rendering fails.
    onResolvedDirectUrl?.(canonicalUrl);

    if (share.finalUrl !== canonicalUrl) {
      stage = "canonical-navigation";
      const canonicalNavigation = await navigate(page, canonicalUrl, deadline, lifecycle);
      timings.canonicalNavigationMs = canonicalNavigation.elapsedMs;
      lastHttpStatus = canonicalNavigation.status ?? lastHttpStatus;
      stage = "render-wait";
      const itemRenderWait = await settle(page, deadline, "canonical");
      timings.renderWaitMs = (timings.renderWaitMs ?? 0) + itemRenderWait.elapsedMs;
      lastRenderDiagnostics = facebookRenderDiagnostics({
        phase: "canonical",
        probe: itemRenderWait.summary,
        predicates: itemRenderWait.predicates,
        polls: itemRenderWait.polls,
        elapsedMs: itemRenderWait.elapsedMs,
        waitOutcome: "ready",
        timings: { ...timings },
        httpStatus: lastHttpStatus,
        wall: itemRenderWait.wall,
        dismissal: itemRenderWait.dismissal,
        session: { ...sessionState },
      });
    }
    stage = "page-read";
    const pageReadStartedAt = Date.now();
    const listing = await snapshot(page, deadline);
    timings.pageReadMs = Date.now() - pageReadStartedAt;
    renderReadSucceeded = true;
    stage = "extraction";
    assertFacebookNavigation(listing.finalUrl, "FACEBOOK_ITEM_NOT_FOUND");
    detectBlockedState(listing.finalUrl, listing.bodyText, listing.ogUrl);
    if (!listing.bodyText || !/marketplace|about this vehicle|seller'?s description/i.test(listing.bodyText)) {
      throw new FacebookExtractionError("FACEBOOK_LISTING_NOT_RENDERED", "Facebook listing did not render readable details.");
    }

    const result = {
      requestedUrl: rawUrl,
      finalUrl: listing.finalUrl,
      canonicalUrl,
      itemId,
      title: listing.title,
      bodyText: listing.bodyText,
      ogTitle: listing.ogTitle,
      ogDescription: listing.ogDescription,
      elapsedMs: Date.now() - requestStartedAt,
    };
    logFacebookChromiumVariant(
      plan,
      "success",
      attemptStartedAt,
      browserLaunchSucceeded,
      renderReadSucceeded,
      lifecycle.snapshot(),
    );
    return result;
  } catch (error) {
    await lifecycle.waitForTerminationDetails();
    const lifecycleDiagnostics = lifecycle.snapshot();
    const wrapped = facebookRuntimeError(error, stage, lifecycleDiagnostics);
    // A render wait that already succeeded still describes what Facebook served,
    // which is what makes a later-stage failure diagnosable.
    const reported =
      lastRenderDiagnostics && !wrapped.diagnostics?.render
        ? new FacebookExtractionError(wrapped.code, wrapped.message, {
            ...wrapped.diagnostics,
            render: lastRenderDiagnostics,
            ...(resolvedDirectUrl ? { resolvedDirectUrl } : {}),
          })
        : resolvedDirectUrl
          ? new FacebookExtractionError(wrapped.code, wrapped.message, {
              ...wrapped.diagnostics,
              resolvedDirectUrl,
            })
          : wrapped;
    logFacebookChromiumVariant(
      plan,
      "failure",
      attemptStartedAt,
      browserLaunchSucceeded,
      renderReadSucceeded,
      lifecycleDiagnostics,
    );
    throw reported;
  } finally {
    lifecycle.markCleanupStarted();
    await page?.close().catch(() => undefined);
    await closeFacebookBrowserForCleanup(browser);
  }
}

let selectedVercelChromiumVariant: FacebookChromiumLaunchVariantName | undefined;

export interface FacebookRenderSessionConfig {
  directory?: string | null;
}

export interface FacebookRenderOptions {
  timeoutMs?: number;
  session?: FacebookRenderSessionConfig | null;
  /** Internal worker seam; receives only a validated canonical Marketplace URL. */
  onResolvedDirectUrl?: (url: string) => void;
}

export async function renderFacebookMarketplaceListing(
  rawUrl: string,
  options: FacebookRenderOptions | { timeoutMs?: number } = {},
): Promise<FacebookRenderedListing> {
  const url = parseFacebookUrl(rawUrl);
  if (!url || (!isSharePath(url) && !isMarketplaceItemPath(url))) {
    throw new FacebookExtractionError("FACEBOOK_INVALID_URL", "Unsupported Facebook Marketplace URL.");
  }

  const normalizedOptions =
    "timeoutMs" in options && !(options as FacebookRenderOptions).session
      ? (options as { timeoutMs?: number })
      : (options as FacebookRenderOptions);
  const timeoutMs = normalizedOptions.timeoutMs ?? 25000;
  const sessionCfg = (options as FacebookRenderOptions).session ?? null;
  const onResolvedDirectUrl = (options as FacebookRenderOptions).onResolvedDirectUrl;
  const started = Date.now();
  const deadline = started + timeoutMs;
  const setupLifecycle = createFacebookLifecycleTracker(started, deadline);
  let puppeteer: Awaited<ReturnType<typeof loadPuppeteer>>;
  let plans: FacebookChromiumLaunchPlan[];
  try {
    puppeteer = await loadPuppeteer();
    plans = await chromiumLaunchPlans();
  } catch (error) {
    throw facebookRuntimeError(error, "browser-launch", setupLifecycle.snapshot());
  }

  const [firstPlan] = plans;
  if (!firstPlan) throw new Error("Facebook Chromium launch plan is empty.");
  if (!firstPlan.launchMatrix) {
    return renderFacebookMarketplaceListingAttempt(
      rawUrl,
      url,
      timeoutMs,
      started,
      deadline,
      puppeteer,
      firstPlan,
      sessionCfg,
      onResolvedDirectUrl,
    );
  }

  const selectedPlans = selectedVercelChromiumVariant
    ? plans.filter((plan) => plan.name === selectedVercelChromiumVariant)
    : plans;
  return runFacebookChromiumLaunchMatrix(selectedPlans, async (plan) => {
    const result = await renderFacebookMarketplaceListingAttempt(
      rawUrl,
      url,
      timeoutMs,
      started,
      deadline,
      puppeteer,
      plan,
      sessionCfg,
      onResolvedDirectUrl,
    );
    selectedVercelChromiumVariant = plan.name as FacebookChromiumLaunchVariantName;
    return result;
  });
}

export interface FacebookHttpOgMeta {
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  canonical: string;
  htmlTextLength: number;
  status: number;
}

/**
 * Reads the OpenGraph/canonical tags from a public Facebook document.
 *
 * The document is scanned tag by tag with the project's shared attribute
 * parser (`parseAttributes`), so attribute order is irrelevant
 * (`content` before or after `property`), matched quote pairs are required
 * (an apostrophe inside a double-quoted value never truncates it), HTML
 * entities are decoded and the first occurrence of a property wins when
 * Facebook emits duplicates. No HTML is ever returned from this function.
 */
function extractOgMeta(html: string): {
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  canonical: string;
} {
  const properties: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const property = (attributes.property || "").toLowerCase();
    if (property && attributes.content && properties[property] === undefined) {
      properties[property] = attributes.content;
    }
  }
  let canonical = "";
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if ((attributes.rel || "").toLowerCase() === "canonical" && attributes.href) {
      canonical = attributes.href;
      break;
    }
  }
  return {
    ogTitle: properties["og:title"] ?? "",
    ogDescription: properties["og:description"] ?? "",
    ogImage: properties["og:image"] ?? "",
    ogUrl: properties["og:url"] ?? "",
    canonical,
  };
}

async function readFacebookShareRedirectMeta(page: PageLike, deadline: number) {
  try {
    const meta = await retryFacebookPageOperation(
      () =>
        page.evaluate(() => {
          const ogUrl =
            document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content ?? "";
          const canonical =
            document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "";
          return { ogUrl, canonical };
        }),
      { deadline, maxAttempts: 1 },
    );
    let itemId = extractFacebookItemId(meta.ogUrl);
    if (!itemId) itemId = extractFacebookItemId(meta.canonical);
    if (!itemId) return null;
    const canonicalUrl = canonicalFacebookItemUrl(itemId);
    return { itemId, canonicalUrl, ogUrl: meta.ogUrl, canonical: meta.canonical };
  } catch {
    return null;
  }
}

/** Safe, loggable reasons why an HTTP metadata attempt could not be used. */
export type FacebookHttpMetadataFallbackReason =
  | "foreign-host"
  | "fetch-failed"
  | "id-mismatch"
  | "no-id-tie"
  | "generic-metadata"
  | "insufficient-metadata";

export interface FacebookHttpMetadataExtraction {
  meta: FacebookHttpOgMeta;
  extraction: ListingUrlExtraction;
  itemId: string;
  canonicalUrl: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  elapsedMs: number;
}

/**
 * Extracts a Marketplace item id only from an allowed Facebook URL, so a
 * foreign `og:url`/`canonical` can never borrow an unrelated
 * `/marketplace/item/<id>` path.
 */
function facebookMarketplaceMetadataItemId(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const parsed = parseFacebookUrl(candidate);
  if (!parsed) return null;
  return parsed.pathname.match(ITEM_ID_RE)?.[1] ?? null;
}

/**
 * True when the served metadata describes Facebook itself (login wall,
 * generic homepage, Marketplace index) rather than a vehicle listing.
 * Operates only on the title/description strings and never logs them.
 */
function isGenericFacebookHttpMetadata(og: {
  ogTitle: string;
  ogDescription: string;
}): boolean {
  const title = og.ogTitle.trim();
  if (!title) return true;
  const text = `${title}\n${og.ogDescription}`.toLowerCase();
  if (
    /\b(?:log in|login|sign in|sign up|create (?:a )?new account|forgot (?:your )?password)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (text.includes("facebook helps you connect and share")) return true;
  const bareTitle = title
    .toLowerCase()
    .replace(/\s*[|–—-]+\s*facebook\s*$/, "")
    .trim();
  return (
    bareTitle === "" ||
    bareTitle === "facebook" ||
    bareTitle === "marketplace" ||
    bareTitle === "facebook marketplace"
  );
}

/**
 * Body text for the shared line-based parser, built ONLY from metadata
 * Facebook actually served. Separator runs (`·`, `|`, dashes surrounded by
 * spaces) become line breaks so a combined title such as
 * `$18,995 · 2018 Toyota Corolla LE` yields a clean price line instead of one
 * merged number. Nothing is invented: absent fields stay absent.
 */
function facebookMetadataBodyText(meta: {
  ogTitle: string;
  ogDescription: string;
}): string {
  return [meta.ogTitle, meta.ogDescription]
    .filter((value) => value.trim())
    .join("\n")
    .replace(/\s+[·|–—]\s+/g, "\n")
    .trim();
}

/**
 * HTTP-first extraction for a DIRECT Marketplace item URL.
 *
 * Performs a secure server-side HTTP fetch (the existing `fetchPublicListingHtml`,
 * so every hop keeps the existing SSRF validation), reads the public
 * OpenGraph/canonical metadata, and only returns a result when the metadata is
 * genuinely usable and provably belongs to the requested item. Returns `null`
 * with a safe enum reason otherwise, so callers fall back to the existing
 * Puppeteer path. Never throws for expected failures and never returns or
 * logs raw HTML, cookies or headers.
 */
export async function extractFacebookMarketplaceItemViaHttp(
  url: string,
  options: {
    fetchHtml?: typeof fetchPublicListingHtml;
    fetchTimeoutMs?: number;
    maxBodyBytes?: number;
    maxRedirects?: number;
    userAgent?: string;
    now?: () => number;
    /** Receives only the safe enum reason, never any page content. */
    onFallback?: (reason: FacebookHttpMetadataFallbackReason) => void;
  } = {},
): Promise<FacebookHttpMetadataExtraction | null> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const fallback = (reason: FacebookHttpMetadataFallbackReason): null => {
    options.onFallback?.(reason);
    return null;
  };

  const requestedId = extractFacebookItemId(url);
  // Not a direct Marketplace item URL (share links, other pages): HTTP metadata
  // extraction simply does not apply, so no attempt is made and no fallback is
  // reported — those URLs keep their existing behaviour untouched.
  if (!isDirectFacebookMarketplaceItemUrl(url) || !requestedId) return null;

  let page: { finalUrl: string; status: number; html: string };
  try {
    page = await (options.fetchHtml ?? fetchPublicListingHtml)(url, {
      timeoutMs: options.fetchTimeoutMs,
      maxBodyBytes: options.maxBodyBytes,
      maxRedirects: options.maxRedirects,
      headers: {
        "User-Agent": options.userAgent ?? "AutoCheckQC/1.0 (+https://autocheckqc.com)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    // Timeout, SSRF rejection, oversized or non-HTML responses all mean the
    // existing browser fallback must take over; the fetch error object is
    // deliberately not propagated with any response details.
    return fallback("fetch-failed");
  }

  // The document must have been served by an allowed Facebook host.
  if (!parseFacebookUrl(page.finalUrl)) return fallback("foreign-host");

  const og = extractOgMeta(page.html);

  // Item-id binding: every URL that carries a Marketplace item id must agree
  // with the request (a foreign id means this metadata belongs to another
  // listing), and at least one must positively tie the document to the
  // requested item. Ambiguity falls back to the browser path.
  const evidenceIds = [og.ogUrl, og.canonical, page.finalUrl].map(
    facebookMarketplaceMetadataItemId,
  );
  if (evidenceIds.some((itemId) => itemId !== null && itemId !== requestedId))
    return fallback("id-mismatch");
  if (!evidenceIds.some((itemId) => itemId === requestedId))
    return fallback("no-id-tie");

  if (isGenericFacebookHttpMetadata(og)) return fallback("generic-metadata");

  const canonicalUrl = canonicalFacebookItemUrl(requestedId);
  const extraction = extractFacebookListingFromRenderedText(
    {
      bodyText: facebookMetadataBodyText(og),
      canonicalUrl,
      finalUrl: page.finalUrl,
      itemId: requestedId,
      title: og.ogTitle,
      ogTitle: og.ogTitle,
      ogDescription: og.ogDescription,
    },
    "meta",
  );
  // The existing AutoCheck contract treats `listingUrl`/`listingSource` alone
  // as an empty extraction; anything more is usable (`partial` or better).
  const meaningful = extraction.found.filter(
    (field) => field !== "listingUrl" && field !== "listingSource",
  );
  if (!meaningful.length) return fallback("insufficient-metadata");

  return {
    meta: {
      ogTitle: og.ogTitle,
      ogDescription: og.ogDescription,
      ogImage: og.ogImage,
      ogUrl: og.ogUrl,
      canonical: og.canonical,
      htmlTextLength: page.html.length,
      status: page.status,
    },
    extraction,
    itemId: requestedId,
    canonicalUrl,
    requestedUrl: url,
    finalUrl: page.finalUrl,
    httpStatus: page.status,
    elapsedMs: now() - startedAt,
  };
}

/**
 * Shapes validated HTTP metadata as a rendered listing payload for the
 * worker boundary. The `source: "http-metadata"` marker tells the AutoCheck
 * side to record provenance as `meta`.
 */
export function facebookHttpMetadataToRenderedListing(
  metadata: FacebookHttpMetadataExtraction,
): FacebookRenderedListing {
  return {
    requestedUrl: metadata.requestedUrl,
    finalUrl: metadata.finalUrl,
    canonicalUrl: metadata.canonicalUrl,
    itemId: metadata.itemId,
    title: metadata.meta.ogTitle,
    bodyText: facebookMetadataBodyText(metadata.meta),
    ogTitle: metadata.meta.ogTitle,
    ogDescription: metadata.meta.ogDescription,
    elapsedMs: metadata.elapsedMs,
    source: "http-metadata",
  };
}

export function facebookErrorToListingFetchError(error: FacebookExtractionError) {
  const fetchCode =
    error.code === "FACEBOOK_INVALID_URL" ? "unsafe-url" : "network-error";
  const stage =
    typeof error.diagnostics?.stage === "string" ? error.diagnostics.stage : undefined;
  const lifecycle =
    error.diagnostics?.lifecycle && typeof error.diagnostics.lifecycle === "object"
      ? (error.diagnostics.lifecycle as ListingBrowserLifecycleDiagnostics)
      : undefined;
  return new ListingFetchError(fetchCode, error.message, undefined, {
    code: error.code,
    message: error.message,
    stage,
    lifecycle,
  });
}
