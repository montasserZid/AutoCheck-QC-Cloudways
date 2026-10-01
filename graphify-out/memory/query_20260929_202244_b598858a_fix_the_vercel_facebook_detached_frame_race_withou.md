---
type: "query"
date: "2026-09-29T20:22:44.334227+00:00"
question: "Fix the Vercel Facebook detached-frame race without changing packaging or extraction semantics."
contributor: "graphify"
outcome: "useful"
source_nodes: ["renderFacebookMarketplaceListing", "settle", "snapshot", "facebook.ts"]
---

# Q: Fix the Vercel Facebook detached-frame race without changing packaging or extraction semantics.

## Answer

Expanded from graph vocabulary via facebook, browser, navigation, settle, snapshot, render, extraction, listing. The affected path was renderFacebookMarketplaceListing through settle and snapshot. Frame-bound operations ran after domcontentloaded while Facebook could replace the main frame. The fix uses bounded known-error retries through Page, one atomic snapshot evaluation, a shared deadline, and lifecycle-stage diagnostics. Packaging stayed unchanged.

## Outcome

- Signal: useful

## Source Nodes

- renderFacebookMarketplaceListing
- settle
- snapshot
- facebook.ts