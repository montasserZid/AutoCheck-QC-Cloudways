---
type: "query"
date: "2026-09-29T18:03:58.465815+00:00"
question: "Why did Facebook login UI cause a false extraction failure?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["detectFacebookPageState", "renderFacebookMarketplaceListing", "detectBlockedState"]
---

# Q: Why did Facebook login UI cause a false extraction failure?

## Answer

Expanded from graph vocabulary: [facebook, login, authentication, detect, blocked, state, marketplace, render, listing]. detectBlockedState in src/server/listing/facebook.ts threw before item discovery. The corrected classifier accepts target item URL/Open Graph URL or bounded primary listing evidence before classifying login UI, while recommendation-only text remains insufficient.

## Outcome

- Signal: useful

## Source Nodes

- detectFacebookPageState
- renderFacebookMarketplaceListing
- detectBlockedState