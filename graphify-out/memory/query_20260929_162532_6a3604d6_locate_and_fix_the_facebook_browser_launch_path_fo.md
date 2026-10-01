---
type: "query"
date: "2026-09-29T16:25:32.058798+00:00"
question: "Locate and fix the Facebook browser launch path for local Windows Chrome and Vercel Chromium"
contributor: "graphify"
outcome: "useful"
source_nodes: ["chromiumLaunchOptions", "renderFacebookMarketplaceListing", "createListingExtractionPostHandler"]
---

# Q: Locate and fix the Facebook browser launch path for local Windows Chrome and Vercel Chromium

## Answer

Expanded from graph vocabulary: [facebook, browser, chromium, puppeteer, executable, launch, handler, listing]. The browser launch boundary is chromiumLaunchOptions() in src/server/listing/facebook.ts, called by renderFacebookMarketplaceListing() and the existing listing handler. The fix adds explicit override, Vercel, and local Windows discovery resolution while leaving navigation and parsing unchanged.

## Outcome

- Signal: useful

## Source Nodes

- chromiumLaunchOptions
- renderFacebookMarketplaceListing
- createListingExtractionPostHandler