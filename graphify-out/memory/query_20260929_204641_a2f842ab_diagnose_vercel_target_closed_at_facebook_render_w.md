---
type: "query"
date: "2026-09-29T20:46:41.780483+00:00"
question: "Diagnose Vercel Target closed at Facebook render-wait without a speculative fix."
contributor: "graphify"
outcome: "useful"
source_nodes: ["renderFacebookMarketplaceListing", "settle", "createFacebookLifecycleTracker", "facebook.ts"]
---

# Q: Diagnose Vercel Target closed at Facebook render-wait without a speculative fix.

## Answer

Expanded from graph vocabulary via facebook, browser, target, render, settle, error. Source proves there is no Promise.race, AbortController, or independent deadline task; all page operations are awaited and failure diagnostics are captured before finally cleanup. Root cause remains unproven among page closure, browser disconnect/crash, or external process termination. Added diagnostics-only tracking for page/browser/target/process events, timing, deadline, navigation, and cleanup state.

## Outcome

- Signal: useful

## Source Nodes

- renderFacebookMarketplaceListing
- settle
- createFacebookLifecycleTracker
- facebook.ts