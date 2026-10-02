/**
 * Compile-time stand-in for `@sparticuz/chromium`.
 *
 * The shared AutoCheck Facebook renderer keeps a lazy `await import("@sparticuz/
 * chromium")` branch for Vercel/Render. On the Cloudways host that branch is
 * never reached: `resolveFacebookBrowserExecutable()` returns `{kind:"local"}` as
 * soon as `CHROME_EXECUTABLE_PATH` (or a discovered Chrome) is present, which
 * start-worker.sh always sets. Installing the real package on the host would
 * download a second, unused Chromium binary, so this declaration satisfies
 * TypeScript instead.
 *
 * The worker's tsconfig maps "@sparticuz/chromium" here via `paths`, so this
 * file is scoped to the worker build: the Vercel application keeps resolving the
 * real package from the repository root node_modules. The emitted JavaScript
 * still contains the original `require("@sparticuz/chromium")` specifier inside
 * the unreachable branch, which fails loudly instead of silently starting a
 * Chromium the host was not configured for.
 */
declare interface SparticuzChromiumStub {
  args: string[];
  executablePath: () => Promise<string>;
  setGraphicsMode: boolean;
}

declare const chromium: SparticuzChromiumStub;

export default chromium;