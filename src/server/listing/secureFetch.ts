import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const LISTING_FETCH_LIMITS = {
  bodyBytes: 5 * 1024 * 1024,
  redirects: 4,
  timeoutMs: 8000,
} as const;

export type ListingFetchErrorCode =
  | "invalid-url"
  | "unsafe-url"
  | "dns-failed"
  | "timeout"
  | "too-many-redirects"
  | "http-error"
  | "non-html"
  | "too-large"
  | "network-error"
  // Browser-worker boundary failures. These describe the AutoCheck <-> Cloudways
  // hop, never the target listing, so they are kept separate from the
  // `unsafe-url`/`invalid-url` codes that describe a rejected target URL.
  | "worker-unavailable"
  | "worker-unauthorized"
  | "worker-busy"
  | "worker-timeout"
  | "worker-invalid-response";

export interface ListingRuntimeMemoryDiagnostics {
  nodeRssBytes?: number;
  nodeHeapUsedBytes?: number;
  nodeExternalBytes?: number;
  nodeArrayBuffersBytes?: number;
  cgroupCurrentBytes?: number | null;
  cgroupPeakBytes?: number | null;
  cgroupLimitBytes?: number | null;
  cgroupMemoryEvents?: Record<string, number> | null;
  cgroupOomEvents?: number | null;
  cgroupOomKillEvents?: number | null;
}

export interface ListingBrowserLifecycleDiagnostics {
  pageClosed?: boolean;
  pageCloseEvent?: boolean;
  pageError?: string;
  browserConnected?: boolean;
  browserDisconnectedEvent?: boolean;
  targetCreatedCount?: number;
  targetChangedCount?: number;
  targetDestroyedCount?: number;
  pageTargetChangedCount?: number;
  pageTargetDestroyed?: boolean;
  browserProcessExitEvent?: boolean;
  browserProcessCloseEvent?: boolean;
  browserProcessExitCode?: number | null;
  browserProcessSignal?: string | null;
  browserProcessKilled?: boolean;
  browserProcessSpawnArgs?: string[];
  browserStderrTail?: string;
  elapsedSinceBrowserLaunchMs?: number;
  elapsedSinceRequestStartMs?: number;
  msSinceBrowserDisconnect?: number;
  cleanupStarted?: boolean;
  deadlineExpired?: boolean;
  navigationActive?: boolean;
  lastNavigationSucceeded?: boolean;
  msSinceLastNavigation?: number;
  msSinceLastTargetChange?: number;
  memoryAtRequestStart?: ListingRuntimeMemoryDiagnostics;
  memoryAtBrowserLaunch?: ListingRuntimeMemoryDiagnostics;
  memoryAfterNavigation?: ListingRuntimeMemoryDiagnostics;
  memoryAtFailure?: ListingRuntimeMemoryDiagnostics;
}

export interface ListingNetworkDiagnostics {
  name?: string;
  code?: string;
  errno?: string | number;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: string | number;
  message?: string;
  stage?: string;
  lifecycle?: ListingBrowserLifecycleDiagnostics;
  cause?: ListingNetworkDiagnostics;
  attemptedAddresses?: string[];
}

export class ListingFetchError extends Error {
  public readonly diagnostics?: ListingNetworkDiagnostics;

  constructor(
    public readonly code: ListingFetchErrorCode,
    message: string,
    public readonly status?: number,
    diagnostics?: ListingNetworkDiagnostics,
  ) {
    super(message);
    this.name = "ListingFetchError";
    this.diagnostics = diagnostics;
  }
}

export interface FetchPublicListingOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  lookup?: PublicLookup;
  testOnlyAllowPrivateNetwork?: boolean;
  headers?: Record<string, string>;
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

type PublicLookup = (
  hostname: string,
  options: { all: true; verbatim: false },
) => Promise<ResolvedAddress[]>;

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function ipv4ToNumber(address: string): number {
  return address
    .split(".")
    .reduce((sum, part) => (sum << 8) + Number(part), 0) >>> 0;
}

function ipv4In(address: string, cidrBase: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(cidrBase) & mask);
}

function isUnsafeIpv4(address: string): boolean {
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, bits]) => ipv4In(address, String(base), Number(bits)));
}

function expandedIpv6(address: string): string[] {
  const normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    const number = ipv4ToNumber(ipv4);
    return [
      ...expandedIpv6(normalized.slice(0, lastColon)),
      ((number >>> 16) & 0xffff).toString(16),
      (number & 0xffff).toString(16),
    ];
  }
  const [head, tail] = normalized.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  return [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts].map(
    (part) => part || "0",
  );
}

function isUnsafeIpv6(address: string): boolean {
  const parts = expandedIpv6(address);
  const first = Number.parseInt(parts[0] || "0", 16);
  const second = Number.parseInt(parts[1] || "0", 16);
  const isLoopback = parts.slice(0, 7).every((part) => Number.parseInt(part, 16) === 0) && second === 0 && Number.parseInt(parts[7] || "0", 16) === 1;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isLinkLocal = first === 0xfe80 || (first === 0xfe00 && (second & 0xc000) === 0x8000);
  const isMulticast = (first & 0xff00) === 0xff00;
  const isUnspecified = parts.every((part) => Number.parseInt(part, 16) === 0);
  const isIpv4Mapped = parts.slice(0, 5).every((part) => Number.parseInt(part, 16) === 0) && Number.parseInt(parts[5] || "0", 16) === 0xffff;
  if (isIpv4Mapped) {
    const ipv4 = `${Number.parseInt(parts[6], 16) >> 8}.${Number.parseInt(parts[6], 16) & 255}.${Number.parseInt(parts[7], 16) >> 8}.${Number.parseInt(parts[7], 16) & 255}`;
    return isUnsafeIpv4(ipv4);
  }
  return isLoopback || isUniqueLocal || isLinkLocal || isMulticast || isUnspecified;
}

function unsafeHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname).toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host.endsWith(".internal")
  );
}

function assertPublicAddress(address: string) {
  const ipVersion = net.isIP(stripIpv6Brackets(address));
  if (!ipVersion)
    throw new ListingFetchError("unsafe-url", "Resolved address is not valid.");
  if (ipVersion === 4 && isUnsafeIpv4(address))
    throw new ListingFetchError("unsafe-url", "Private IPv4 targets are blocked.");
  if (ipVersion === 6 && isUnsafeIpv6(stripIpv6Brackets(address)))
    throw new ListingFetchError("unsafe-url", "Private IPv6 targets are blocked.");
}

export async function resolvePublicUrl(
  rawUrl: string,
  options: Pick<FetchPublicListingOptions, "lookup" | "testOnlyAllowPrivateNetwork"> = {},
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ListingFetchError("invalid-url", "The listing URL is malformed.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new ListingFetchError("unsafe-url", "Only http and https listing URLs are allowed.");
  if (!url.hostname || url.username || url.password)
    throw new ListingFetchError("unsafe-url", "Listing URLs cannot include credentials.");
  if (unsafeHostname(url.hostname))
    throw new ListingFetchError("unsafe-url", "Internal hostnames are blocked.");

  const hostname = stripIpv6Brackets(url.hostname);
  const ipVersion = net.isIP(hostname);
  let addresses: ResolvedAddress[];
  try {
    const lookup = options.lookup ?? (dnsLookup as PublicLookup);
    addresses = ipVersion
      ? [{ address: hostname, family: ipVersion as 4 | 6 }]
      : await lookup(hostname, {
          all: true,
          verbatim: false,
        });
  } catch (error) {
    throw new ListingFetchError(
      "dns-failed",
      "The listing host could not be resolved.",
      undefined,
      diagnosticFromError(error),
    );
  }

  if (!addresses.length)
    throw new ListingFetchError("dns-failed", "The listing host could not be resolved.");
  if (!options.testOnlyAllowPrivateNetwork)
    addresses.forEach((entry) => assertPublicAddress(entry.address));
  return { url, addresses };
}

function contentTypeIsHtml(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType.join(",") : contentType || "";
  return /\btext\/html\b|\bapplication\/xhtml\+xml\b/i.test(value);
}

function diagnosticFromError(error: unknown): ListingNetworkDiagnostics {
  if (!error || typeof error !== "object")
    return { message: typeof error === "string" ? error : undefined };
  const record = error as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    errno:
      typeof record.errno === "string" || typeof record.errno === "number"
        ? record.errno
        : undefined,
    syscall: typeof record.syscall === "string" ? record.syscall : undefined,
    hostname: typeof record.hostname === "string" ? record.hostname : undefined,
    address: typeof record.address === "string" ? record.address : undefined,
    port:
      typeof record.port === "string" || typeof record.port === "number"
        ? record.port
        : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    cause: record.cause ? diagnosticFromError(record.cause) : undefined,
  };
}

function publicHostnameForTls(url: URL): string | undefined {
  const hostname = stripIpv6Brackets(url.hostname);
  return net.isIP(hostname) ? undefined : hostname;
}

function requestHtml(
  url: URL,
  address: ResolvedAddress,
  options: Required<Pick<FetchPublicListingOptions, "timeoutMs" | "maxBodyBytes">> & { headers?: Record<string, string> },
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body?: string;
}> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Host: url.host,
          "User-Agent": "AutoCheckQC/1.0 deterministic-listing-reader",
          ...(options.headers || {}),
        },
        servername:
          url.protocol === "https:" ? publicHostnameForTls(url) : undefined,
        lookup(_hostname, lookupOptions, callback) {
          if (
            typeof lookupOptions === "object" &&
            lookupOptions !== null &&
            "all" in lookupOptions &&
            lookupOptions.all
          ) {
            callback(null, [{ address: address.address, family: address.family }]);
            return;
          }
          callback(null, address.address, address.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          resolve({ status, headers: response.headers });
          return;
        }
        if (status < 200 || status >= 400) {
          response.resume();
          reject(new ListingFetchError("http-error", "The listing returned an unsuccessful status.", status));
          return;
        }
        if (!contentTypeIsHtml(response.headers["content-type"])) {
          response.resume();
          reject(new ListingFetchError("non-html", "The listing did not return an HTML page.", status));
          return;
        }
        const declaredLength = Number(response.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > options.maxBodyBytes) {
          response.resume();
          reject(new ListingFetchError("too-large", "The listing page is too large.", status));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let failed = false;
        response.on("data", (chunk: Buffer) => {
          if (failed) return;
          total += chunk.length;
          if (total > options.maxBodyBytes) {
            failed = true;
            response.destroy();
            reject(new ListingFetchError("too-large", "The listing page is too large.", status));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () => {
          if (!failed)
            reject(
              new ListingFetchError(
                "network-error",
                "The listing could not be retrieved.",
                undefined,
                { address: address.address, port: url.port || (url.protocol === "https:" ? 443 : 80) },
              ),
            );
        });
        response.on("end", () => {
          if (failed) return;
          resolve({
            status,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new ListingFetchError("timeout", "The listing request timed out."));
    });
    request.on("error", (error) => {
      if (error instanceof ListingFetchError) reject(error);
      else {
        const diagnostics = diagnosticFromError(error);
        reject(
          new ListingFetchError(
            "network-error",
            "The listing could not be retrieved.",
            undefined,
            {
              ...diagnostics,
              address: diagnostics.address ?? address.address,
              port:
                diagnostics.port ??
                (url.port || (url.protocol === "https:" ? 443 : 80)),
            },
          ),
        );
      }
    });
    request.end();
  });
}

export async function fetchPublicListingHtml(
  rawUrl: string,
  options: FetchPublicListingOptions = {},
): Promise<{ finalUrl: string; status: number; html: string }> {
  const maxRedirects = options.maxRedirects ?? LISTING_FETCH_LIMITS.redirects;
  const timeoutMs = options.timeoutMs ?? LISTING_FETCH_LIMITS.timeoutMs;
  const maxBodyBytes = options.maxBodyBytes ?? LISTING_FETCH_LIMITS.bodyBytes;
  let currentUrl = rawUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const { url, addresses } = await resolvePublicUrl(currentUrl, options);
    let response:
      | Awaited<ReturnType<typeof requestHtml>>
      | undefined;
    let lastNetworkError: ListingFetchError | undefined;
    for (const address of addresses) {
      try {
        response = await requestHtml(url, address, { timeoutMs, maxBodyBytes });
        lastNetworkError = undefined;
        break;
      } catch (error) {
        if (
          error instanceof ListingFetchError &&
          error.code === "network-error"
        ) {
          lastNetworkError = error;
          continue;
        }
        throw error;
      }
    }
    if (!response) {
      throw new ListingFetchError(
        "network-error",
        "The listing could not be retrieved.",
        undefined,
        {
          ...lastNetworkError?.diagnostics,
          attemptedAddresses: addresses.map((entry) => `${entry.address}/${entry.family}`),
        },
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = Array.isArray(response.headers.location)
        ? response.headers.location[0]
        : response.headers.location;
      if (!location)
        throw new ListingFetchError("http-error", "The listing redirected without a location.", response.status);
      currentUrl = new URL(location, url).toString();
      await resolvePublicUrl(currentUrl, options);
      continue;
    }

    return { finalUrl: url.toString(), status: response.status, html: response.body ?? "" };
  }
  throw new ListingFetchError("too-many-redirects", "The listing redirected too many times.");
}
