---
type: "query"
date: "2026-09-29T20:31:56.842621+00:00"
question: "Fix the Vercel detached frame at render-wait only."
contributor: "graphify"
outcome: "useful"
source_nodes: ["settle", "retryFacebookPageOperation", "waitForFacebookRenderReadiness", "facebook.ts"]
---

# Q: Fix the Vercel detached frame at render-wait only.

## Answer

Expanded from graph vocabulary via facebook, render, settle, navigation, browser, retry. The render-wait path contained two awaited page.evaluate scroll calls. Their existing three-attempt transient retry could only leak the exact detached-frame error after exhausting attempts or deadline. Replaced render-wait with bounded short atomic readiness polling against fresh Page state, two consecutive readiness checks, shared deadline, and a separately bounded scroll reset.

## Outcome

- Signal: useful

## Source Nodes

- settle
- retryFacebookPageOperation
- waitForFacebookRenderReadiness
- facebook.ts