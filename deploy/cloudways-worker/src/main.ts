import { createWorkerLogger } from "./logging";
import { createExtractionWorker, WORKER_SERVER_LIMITS } from "./server";

/**
 * Worker entry point.
 *
 * The worker refuses to start on any non-loopback bind address. Public HTTPS is
 * provided exclusively by the Cloudways PHP gateway.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export function main(environment: NodeJS.ProcessEnv = process.env): void {
  const logger = createWorkerLogger();
  const host = (environment.AUTOCHECK_WORKER_HOST ?? "127.0.0.1").trim();
  const port = positiveInteger(environment.AUTOCHECK_WORKER_PORT, 3000);
  const secret = environment.AUTOCHECK_WORKER_SECRET?.trim();
  const maxConcurrent = positiveInteger(
    environment.AUTOCHECK_WORKER_MAX_CONCURRENT,
    WORKER_SERVER_LIMITS.maxConcurrent,
  );
  const extractTimeoutMs = positiveInteger(
    environment.AUTOCHECK_WORKER_EXTRACT_TIMEOUT_MS,
    WORKER_SERVER_LIMITS.extractTimeoutMs,
  );

  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
    logger.error({
      event: "worker_start_failed",
      detail: "AUTOCHECK_WORKER_HOST must be a loopback address.",
    });
    process.exitCode = 1;
    return;
  }
  if (!secret) {
    logger.error({
      event: "worker_start_failed",
      detail: "AUTOCHECK_WORKER_SECRET is required.",
    });
    process.exitCode = 1;
    return;
  }

  const server = createExtractionWorker({
    secret,
    maxConcurrent,
    extractTimeoutMs,
    logger,
  });

  server.listen(port, host, () => {
    logger.info({
      event: "worker_started",
      host,
      port,
      maxConcurrent,
      extractTimeoutMs,
      pid: process.pid,
    });
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    logger.error({ event: "worker_socket_error", code: error.code });
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: "worker_shutdown", signal });
    const forcedExit = setTimeout(() => process.exit(0), WORKER_SERVER_LIMITS.shutdownGraceMs);
    forcedExit.unref();
    server.close(() => {
      clearTimeout(forcedExit);
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error({
      event: "worker_unhandled_rejection",
      detail: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on("uncaughtException", (error) => {
    logger.error({
      event: "worker_uncaught_exception",
      detail: error.message,
    });
    shutdown("uncaughtException");
  });
}

if (require.main === module) main();
