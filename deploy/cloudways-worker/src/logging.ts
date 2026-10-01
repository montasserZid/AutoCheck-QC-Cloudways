/**
 * Concise, credential-safe logging for the Cloudways extraction worker.
 *
 * Log lines are single-line JSON so they can be grepped with `grep worker.log`.
 * Secrets, authorization headers and page contents are never logged: the worker
 * secret key is redacted defensively even though no call site passes it.
 */

export type WorkerLogLevel = "info" | "warn" | "error";

export interface WorkerLogger {
  info(record: Record<string, unknown>): void;
  warn(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

const SENSITIVE_KEY = /secret|authorization|token|password|cookie|apikey|api_key/i;

export function redactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : value,
    ]),
  );
}

export function sanitizeLogHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "invalid-url";
  }
}

export function createWorkerLogger(
  write: (line: string) => void = (line) => process.stdout.write(line),
  now: () => Date = () => new Date(),
): WorkerLogger {
  const emit = (level: WorkerLogLevel) => (record: Record<string, unknown>) => {
    write(
      `${JSON.stringify({
        ts: now().toISOString(),
        level,
        ...redactLogRecord(record),
      })}\n`,
    );
  };
  return {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}
