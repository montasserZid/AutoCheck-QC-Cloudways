---
type: "query"
date: "2026-09-29T20:06:33.944102+00:00"
question: "Continue the exact Vercel Puppeteer packaging investigation and stop transitive dependency whack-a-mole."
contributor: "graphify"
outcome: "useful"
source_nodes: ["loadPuppeteer", "chromiumLaunchOptions", "next.config.ts"]
---

# Q: Continue the exact Vercel Puppeteer packaging investigation and stop transitive dependency whack-a-mole.

## Answer

Expanded from graph vocabulary via puppeteer, chromium, listing, extraction, route, runtime, package, config. The opaque new Function imports prevented static tracing. Replaced them with literal dynamic imports, explicitly externalized puppeteer-core and @sparticuz/chromium, and retained only the Sparticuz bin asset include. Installed Node File Trace now includes @puppeteer/browsers, semver, and chromium.br.

## Outcome

- Signal: useful

## Source Nodes

- loadPuppeteer
- chromiumLaunchOptions
- next.config.ts