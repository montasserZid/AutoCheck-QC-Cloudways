---
type: "query"
date: "2026-09-29T19:46:13.916315+00:00"
question: "Why did Vercel omit Puppeteer's browser helper package?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["package.json", "chromiumLaunchOptions", "renderFacebookMarketplaceListing"]
---

# Q: Why did Vercel omit Puppeteer's browser helper package?

## Answer

Expanded from graph vocabulary: [puppeteer, browsers, chromium, package, dependencies, tracing, runtime, vercel]. puppeteer-core is dynamically loaded in the Facebook renderer, so static tracing did not see its required @puppeteer/browsers dependency. The listing route already manually included puppeteer-core and Chromium; the fix completes that trace with node_modules/@puppeteer/browsers/**/* while keeping the lockfile-pinned transitive dependency unchanged.

## Outcome

- Signal: useful

## Source Nodes

- package.json
- chromiumLaunchOptions
- renderFacebookMarketplaceListing