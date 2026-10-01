import type { VehicleIntake } from "../../types/domain";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addListingField,
  extractListingIdentity,
  normalizeListingNumber,
  type ListingField,
  type ListingUrlExtraction,
} from "../../lib/listingUrlExtraction";
import {
  ListingFetchError,
  type ListingBrowserLifecycleDiagnostics,
  type ListingRuntimeMemoryDiagnostics,
} from "./secureFetch";

const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
]);

const ITEM_ID_RE = /\/marketplace\/item\/(\d+)/i;
const PRIMARY_SECTION_END_RE =
  /\n(?:today's picks|more from marketplace|related listings|see more on facebook|email or phone number|password|log in|create new account)\b/i;

export type FacebookExtractionErrorCode =
  | "FACEBOOK_INVALID_URL"
  | "FACEBOOK_BROWSER_EXECUTABLE_NOT_FOUND"
  | "FACEBOOK_BROWSER_LAUNCH_FAILED"
  | "FACEBOOK_NAVIGATION_TIMEOUT"
  | "FACEBOOK_SHARE_REDIRECT_FAILED"
  | "FACEBOOK_ITEM_NOT_FOUND"
  | "FACEBOOK_LOGIN_REQUIRED"
  | "FACEBOOK_BLOCKED"
  | "FACEBOOK_LISTING_NOT_RENDERED"
  | "FACEBOOK_EXTRACTION_PARTIAL"
  | "FACEBOOK_EXTRACTION_FAILED";

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

export async function waitForFacebookRenderReadiness(
  readinessCheck: () => Promise<boolean>,
  options: FacebookRenderWaitOptions = {},
): Promise<void> {
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const maxChecks = Math.max(1, options.maxChecks ?? 18);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 200);
  const requiredReadyChecks = Math.max(1, options.requiredReadyChecks ?? 2);
  const sleep =
    options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const now = options.now ?? Date.now;
  let consecutiveReadyChecks = 0;
  let lastTransientError: unknown;

  for (let check = 1; check <= maxChecks; check += 1) {
    if (now() >= deadline) throw new Error("Facebook render wait timed out.");
    try {
      const ready = await readinessCheck();
      lastTransientError = undefined;
      consecutiveReadyChecks = ready ? consecutiveReadyChecks + 1 : 0;
      if (consecutiveReadyChecks >= requiredReadyChecks) return;
    } catch (error) {
      if (!isTransientFacebookPageLifecycleError(error)) throw error;
      lastTransientError = error;
      consecutiveReadyChecks = 0;
    }

    if (check < maxChecks) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) throw new Error("Facebook render wait timed out.");
      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  if (lastTransientError) throw lastTransientError;
  throw new Error("Facebook render wait timed out before readiness.");
}

export function isSupportedFacebookMarketplaceUrl(rawUrl: string): boolean {
  const parsed = parseFacebookUrl(rawUrl);
  return !!parsed && (isSharePath(parsed) || isMarketplaceItemPath(parsed));
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

function addIdentity(result: ListingUrlExtraction, title: string) {
  const identity = extractListingIdentity(title);
  for (const [key, value] of Object.entries(identity)) {
    addListingField(result, key as ListingField, value as never, "facebook-rendered");
  }
}

function addRenderedText(
  result: ListingUrlExtraction,
  key: ListingField,
  value: VehicleIntake[typeof key] | undefined | null,
) {
  addListingField(result, key, value as never, "facebook-rendered");
}

export function extractFacebookListingFromRenderedText(
  rendered: Pick<
    FacebookRenderedListing,
    "bodyText" | "canonicalUrl" | "finalUrl" | "itemId" | "title" | "ogTitle" | "ogDescription"
  >,
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
  addRenderedText(result, "listingTitle", title);
  addIdentity(result, title);

  const priceLine = firstLineMatching(lines, /^(?:CA|US)?\$\s*[\d,. ]+/i);
  if (/^CA\$/i.test(priceLine)) addRenderedText(result, "priceCurrency", "CAD");
  const price = normalizeListingNumber(priceLine);
  if (price !== null) addRenderedText(result, "askingPriceCad", price);

  const mileageLine = firstLineMatching(lines, /\bdriven\s+[\d,.\s]+\s*(km|kilometres|kilometers)\b/i);
  const mileage = normalizeListingNumber(mileageLine);
  if (mileage !== null) {
    addRenderedText(result, "mileageUnit", "km");
    addRenderedText(result, "mileageKm", Math.round(mileage));
  }

  const transmission = firstLineMatching(lines, /\b(automatic|manual|cvt)\s+transmission\b/i)
    .replace(/\s+transmission\b/i, "")
    .trim();
  addRenderedText(result, "transmission", transmission);

  const location = locationFromPrimary(lines);
  addRenderedText(result, "location", location);
  addRenderedText(result, "city", cityFromLocation(location));

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

async function settle(page: PageLike, deadline: number) {
  await waitForFacebookRenderReadiness(
    () =>
      page.evaluate(() => {
        const bodyText = document.body?.innerText ?? "";
        const ogUrl =
          document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content ?? "";
        const hasMarketplaceItem = /\/marketplace\/item\/\d+/i.test(
          `${window.location.href}\n${ogUrl}`,
        );
        return (
          document.readyState !== "loading" &&
          hasMarketplaceItem &&
          bodyText.trim().length > 0
        );
      }),
    { deadline },
  );
}

async function navigate(
  page: PageLike,
  url: string,
  deadline: number,
  lifecycle: FacebookLifecycleTracker,
) {
  lifecycle.markNavigationStarted();
  try {
    await retryFacebookPageOperation(
      () =>
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: remainingTimeout(deadline),
        }),
      { deadline, maxAttempts: 2 },
    );
    lifecycle.markNavigationFinished(true);
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

async function renderFacebookMarketplaceListingAttempt(
  rawUrl: string,
  url: URL,
  timeoutMs: number,
  requestStartedAt: number,
  deadline: number,
  puppeteer: Awaited<ReturnType<typeof loadPuppeteer>>,
  plan: FacebookChromiumLaunchPlan,
): Promise<FacebookRenderedListing> {
  const attemptStartedAt = Date.now();
  const lifecycle = createFacebookLifecycleTracker(requestStartedAt, deadline);
  let stage: FacebookRuntimeStage = "browser-launch";
  let browser: BrowserLike | undefined;
  let page: PageLike | undefined;
  let browserLaunchSucceeded = false;
  let renderReadSucceeded = false;
  try {
    browser = await puppeteer.launch({
      ...plan.options,
      ...(plan.serverless ? { timeout: remainingTimeout(deadline) } : {}),
      defaultViewport: { width: 1365, height: 900 },
    });
    browserLaunchSucceeded = true;
    lifecycle.markBrowserLaunched();
    lifecycle.attachBrowser(browser);
    stage = "page-setup";
    page = await reuseOrCreateFacebookPage(browser);
    lifecycle.attachPage(page);
    page.setDefaultNavigationTimeout?.(timeoutMs);
    stage = "initial-navigation";
    await navigate(page, url.toString(), deadline, lifecycle);
    stage = "render-wait";
    await settle(page, deadline);
    stage = "share-resolution";
    const share = await snapshot(page, deadline);
    assertFacebookNavigation(share.finalUrl, "FACEBOOK_SHARE_REDIRECT_FAILED");
    detectBlockedState(share.finalUrl, share.bodyText, share.ogUrl);

    let itemId = extractFacebookItemId(share.finalUrl);
    if (!itemId && share.ogUrl) itemId = extractFacebookItemId(share.ogUrl);
    if (!itemId) throw new FacebookExtractionError("FACEBOOK_ITEM_NOT_FOUND", "No Marketplace item ID found.");
    const canonicalUrl = canonicalFacebookItemUrl(itemId);

    if (share.finalUrl !== canonicalUrl) {
      stage = "canonical-navigation";
      await navigate(page, canonicalUrl, deadline, lifecycle);
      stage = "render-wait";
      await settle(page, deadline);
    }
    stage = "page-read";
    const listing = await snapshot(page, deadline);
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
    logFacebookChromiumVariant(
      plan,
      "failure",
      attemptStartedAt,
      browserLaunchSucceeded,
      renderReadSucceeded,
      lifecycleDiagnostics,
    );
    throw wrapped;
  } finally {
    lifecycle.markCleanupStarted();
    await page?.close().catch(() => undefined);
    await closeFacebookBrowserForCleanup(browser);
  }
}

let selectedVercelChromiumVariant: FacebookChromiumLaunchVariantName | undefined;

export async function renderFacebookMarketplaceListing(
  rawUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<FacebookRenderedListing> {
  const url = parseFacebookUrl(rawUrl);
  if (!url || (!isSharePath(url) && !isMarketplaceItemPath(url))) {
    throw new FacebookExtractionError("FACEBOOK_INVALID_URL", "Unsupported Facebook Marketplace URL.");
  }

  const timeoutMs = options.timeoutMs ?? 25000;
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
    );
    selectedVercelChromiumVariant = plan.name as FacebookChromiumLaunchVariantName;
    return result;
  });
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
