---
type: "query"
date: "2026-09-27T19:02:12.833625+00:00"
question: "Identify architecture and utility placement for the AutoCheck QC Supabase connection"
contributor: "graphify"
outcome: "useful"
source_nodes: ["layout.tsx", "package.json"]
---

# Q: Identify architecture and utility placement for the AutoCheck QC Supabase connection

## Answer

Expanded graph vocabulary: next Router layout lib dependencies env scripts Supabase. The graph identifies Next.js App Router in src/app/layout.tsx and shared utilities under src/lib. Read actual package.json and configuration before implementation. Added src/lib/supabase.ts and development-only src/app/api/dev/supabase/route.ts; no persistence migration. Targeted AST merge refreshed these two files and package.json.

## Outcome

- Signal: useful

## Source Nodes

- layout.tsx
- package.json