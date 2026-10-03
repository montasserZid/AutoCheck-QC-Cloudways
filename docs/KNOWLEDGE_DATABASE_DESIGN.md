# CarComplaints Knowledge Database Design

## Scope and decision record

This is a read-only design pass for a separate vehicle-knowledge domain. It does not authorize a migration, import, endpoint, UI change, AI call, payment/entitlement feature, or changes to the operational `public` tables.

The inspected source is `data/source/carcomplaints_dataset.json` (gitignored, 140,832,632 bytes). `docs/CARCOMPLAINTS_DATASET_AUDIT.md` was requested but is not present in this checkout; this design therefore treats the actual JSON, not an absent audit file, as evidence.

Measured source facts:

| Level | Count |
| --- | ---: |
| Makes (`brands`) | 36 |
| Source make/model rows | 1,474 |
| Source make/model/year rows | 10,607 |
| Category observations | 88,384 |
| Aggregate problem observations | 95,065 |
| Common-solution observations | 121,170 |

An aggregate problem is not an owner narrative. It is a CarComplaints aggregate carrying a title, counts, severity, optional repair metrics, optional faulty part/warranty note, solution aggregates, and a source URL. The source does not support claims about complaint dates, individual narratives, crashes, fires, injuries, deaths, recalls, investigations, or TSBs.

## Current AutoCheck integration constraints

The existing operational schema is in `public`: `vehicles`, `listings`, `reports`, `inspection_requests`, and `contact_messages`. `vehicles` is a normalized submitted vehicle identity (optional unique VIN); `listings` is a many-listings-per-vehicle operational record. The recent finalization RPC performs server-mediated, atomic vehicle/listing persistence. Knowledge data must not be attached to, copied into, or used to redefine those tables.

`VehicleIntake` supplies reviewed `make`, `model`, nullable `year`, optional `trim`, listing source fields, and seller claims. Current deterministic extractors populate these fields but do not provide a universal canonical vehicle taxonomy. `listingUrlExtraction.ts` preserves discovered make/model/year as listing facts; `listingExtraction.ts` has a small parser vocabulary, not a knowledge matching system.

Current `generateDemoReport()` accepts `free` or `full` but its output is presently deterministic seller/listing-risk logic. It does not query vehicle knowledge. The new knowledge feature should be a distinct bounded server capability; it must not treat the current client-selected report package as authorization.

The established server pattern is route -> handler -> operational repository -> `src/server/supabase/admin.ts`. That client is server-only and uses `SUPABASE_SECRET_KEY`. Operational tables have forced RLS, restrictive deny policies for `anon`/`authenticated`, revoked table privileges, and `service_role` access. Knowledge must follow that posture.

## Namespace recommendation

Use a dedicated PostgreSQL schema: `knowledge`, not `public` tables with prefixes.

This makes ownership, grants, migrations, backups, review, and accidental-query prevention explicit. It also prevents operational foreign keys and retention rules from being confused with a scraped reference snapshot. Prefixes such as `public.knowledge_problem` would be technically workable, but make RLS/grant review and data-domain separation materially weaker. The application will use fully qualified `knowledge.*` relations through a server-only repository.

No table stores a complete raw source JSON/JSONB copy. The canonical source file remains local/trusted-machine input; relational source fields needed for attribution and display are retained.

## Proposed schema

All identifiers below are `bigint generated always as identity` unless stated otherwise. Bigint is compact at this scale, avoids UUID index overhead for a static reference corpus, and is never exposed as an authorization token. Timestamps are `timestamptz`.

### `knowledge.source_snapshot`

Purpose: immutable provenance for one imported source file, not a raw-data store.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `source_name` | `text not null`, check 1..100; expected `CarComplaints.com` |
| `source_scraped_at` | `timestamptz null`; source root `scraped_at` when parseable |
| `source_sha256` | `char(64) not null unique` |
| `source_bytes` | `bigint not null check (source_bytes > 0)` |
| `import_status` | `text not null`, check `staged`, `importing`, `ready`, `failed`, `superseded` |
| `imported_at`, `completed_at` | timestamptz nullable |
| `importer_version` | text nullable, max 100 |
| `notes` | text nullable, max 1,000; no source JSON |

Expected rows: 1 active snapshot for MVP, plus a small number of future import runs. It is retained on delete of no child rows: application policy should mark old snapshots `superseded`; a later explicit purge migration may cascade only after review.

### `knowledge.make`

Purpose: source-preserving make anchor for a snapshot.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `snapshot_id` | bigint FK -> `source_snapshot(id)` `on delete restrict` |
| `source_make` | `text not null`, check trimmed 1..100 |
| `canonical_make_key` | `text not null`, ASCII folded matching key, check 1..100 |
| `source_url` | `text not null`, check 1..2048 and `^https://` |

Unique `(snapshot_id, source_make)` and `(snapshot_id, canonical_make_key)`. Expected rows: 36. `source_make` remains display/attribution truth; canonical key is lookup-only.

### `knowledge.canonical_model`

Purpose: reviewed matching identity, deliberately separate from the scraped source model spelling.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `make_id` | bigint FK -> `make(id)` `on delete restrict` |
| `canonical_name` | text not null, 1..100, display name chosen by review |
| `canonical_model_key` | text not null, 1..100 |
| `match_status` | text not null, check `approved`, `review_required`, `disabled` |

Unique `(make_id, canonical_model_key)`. Expected rows: at most 1,474, normally fewer when reviewed source spellings are confirmed to represent one physical model. This is a small curated taxonomy, not an attempt to infer trims.

### `knowledge.source_model`

Purpose: exact source make/model record and its relationship to a reviewed canonical model.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `make_id` | bigint FK -> `make(id)` `on delete restrict` |
| `canonical_model_id` | bigint nullable FK -> `canonical_model(id)` `on delete restrict` |
| `source_model` | text not null, trimmed 1..100 |
| `source_model_key` | text not null, 1..100 |
| `source_complaint_count` | integer not null, check >= 0 |
| `source_url` | text not null, HTTPS <= 2048 |
| `mapping_status` | text not null, check `mapped`, `unmapped`, `ambiguous`, `quarantined` |

Unique `(make_id, source_model)`. Expected rows: 1,474. `source_url` is not globally unique: the actual data includes different source model labels whose year URLs collide, so URL uniqueness is not valid at this level.

### `knowledge.model_alias`

Purpose: reviewed, deterministic alternate lookup spellings. It does not overwrite source data and it intentionally permits an alias to have multiple candidates.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `make_id` | bigint FK -> `make(id)` `on delete restrict` |
| `canonical_model_id` | bigint FK -> `canonical_model(id)` `on delete restrict` |
| `alias_value` | text not null, 1..100; human-auditable spelling |
| `alias_key` | text not null, 1..100; matching normalization |
| `alias_kind` | text not null, check `source_exact`, `punctuation_variant`, `reviewed_alias` |
| `enabled` | boolean not null default true |

Unique `(make_id, alias_key, canonical_model_id)`. Expected rows: roughly 1,474 source-exact aliases plus a small curated set. Do **not** unique `(make_id, alias_key)`; multiple enabled candidates must yield an ambiguous result rather than a silent arbitrary match.

### `knowledge.model_year`

Purpose: one exact source model/year observation, including valid empty coverage.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `source_model_id` | bigint FK -> `source_model(id)` `on delete restrict` |
| `model_year` | smallint not null |
| `source_reported_problems` | integer not null, check >= 0 |
| `source_url` | text not null, HTTPS <= 2048 |
| `quality_status` | text not null, check `eligible`, `quarantined_invalid_year` |
| `quarantine_reason` | text nullable, <= 200 |

Unique `(source_model_id, model_year)`. Expected rows: 10,607. The two year-zero observations are retained with `quarantined_invalid_year`; no normal lookup may select them. A valid year with zero categories remains `eligible` and returns coverage state `no_category_data`, not an error.

### `knowledge.category_observation`

Purpose: a source category aggregate for one source model-year, including category-level CarComplaints and separate NHTSA counts.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `model_year_id` | bigint FK -> `model_year(id)` `on delete restrict` |
| `source_category` | text not null, 1..100 |
| `category_key` | text not null, 1..100 |
| `carcomplaints_complaint_count` | integer not null, check >= 0 |
| `nhtsa_complaint_count` | integer nullable, check >= 0 |
| `source_url` | text not null, HTTPS <= 2048 |
| `display_status` | text not null, check `eligible`, `quarantined_artifact` |
| `quarantine_reason` | text nullable, <= 200 |

Unique `(model_year_id, source_category)`. Expected rows: 88,384. The six literal `add your complaint »` rows, all pointing to the add-report page, are retained as `quarantined_artifact` and excluded from normal responses. A category with zero problems is eligible coverage and must not be deleted.

### `knowledge.aggregate_problem`

Purpose: one aggregate CarComplaints problem observation; explicitly not an individual complaint.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `category_id` | bigint FK -> `category_observation(id)` `on delete restrict` |
| `source_problem_title` | text not null, 1..200 |
| `reports_count` | integer not null, check >= 0 |
| `total_complaints_count` | integer nullable, check >= 0 |
| `severity_score` | numeric(3,1) nullable, check 0..10 |
| `severity_label` | text nullable, <= 50 |
| `typical_repair_cost_usd` | integer nullable, check >= 0 |
| `repair_cost_raw` | text nullable, <= 100 |
| `average_mileage` | integer nullable, check >= 0 |
| `mileage_raw` | text nullable, <= 100 |
| `mileage_unit` | text nullable, check `miles`, `km`, `unknown` |
| `faulty_part` | text nullable, <= 200 |
| `warranty_note` | text nullable, <= 500 |
| `source_url` | text nullable, HTTPS <= 2048 |
| `display_status` | text not null, check `eligible`, `quarantined_incomplete` |
| `quarantine_reason` | text nullable, <= 200 |

Unique `(category_id, source_problem_title, source_url)`. Expected rows: 95,065. Nullable repair/warranty fields represent absence of source evidence, never zero. The observed incomplete `Dodge / Ram 1500 / 2009 / miscellaneous / Recalls` record has no repair or severity structure and is retained as `quarantined_incomplete`; it is not a normal product result.

### `knowledge.common_solution`

Purpose: source solution aggregate attached to one aggregate problem, preserving source order and duplicate strings if they occur.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `problem_id` | bigint FK -> `aggregate_problem(id)` `on delete restrict` |
| `source_ordinal` | smallint not null, check > 0 |
| `source_solution` | text not null, 1..500 |
| `reports_count` | integer not null, check >= 0 |

Unique `(problem_id, source_ordinal)`. Expected rows: 121,170. It is intentionally not a de-duplicated global solution dictionary: that would lose source context and add joins without benefiting MVP queries.

### `knowledge.import_run`

Purpose: trusted-machine import checkpoint/audit, not an application event log.

| Column | Type / rules |
| --- | --- |
| `id` | bigint PK |
| `snapshot_id` | bigint FK -> `source_snapshot(id)` `on delete restrict` |
| `run_key` | uuid not null unique |
| `phase` | text not null, check `validate`, `load`, `verify`, `complete`, `failed` |
| `last_source_path` | text nullable, <= 500 |
| `rows_read`, `rows_written`, `rows_quarantined` | bigint not null default 0, checks >= 0 |
| `started_at`, `finished_at` | timestamptz |
| `failure_summary` | text nullable, <= 1,000 |

Expected rows: one per attempt. A failed run is retained for recovery diagnostics; it contains no raw source payload.

`on delete restrict` is recommended for all knowledge hierarchy FKs during MVP. Snapshot replacement should be an explicit, measured maintenance action, never an accidental cascade.

## Source fidelity, canonicalization, and matching

The actual source contains real spelling variants: `CX-5`/`CX5`, `CX-9`/`CX9`, `HR-V`/`HRV`, `E-320`/`E320`, `RS 3`/`RS3`, `Pro Master`/`Promaster`/`ProMaster`, and `Van`/`VAN`. Some could be one vehicle family; some can be source distinctions or materially different models. Therefore punctuation removal alone cannot establish identity.

Store source strings unchanged in `source_make` and `source_model`. Store deterministic matching keys separately: Unicode NFKD fold, lower case, trim/collapse whitespace, remove punctuation/hyphen/space for keys such as `cx5`; do not remove meaningful alphanumerics. Keep canonical display names on `canonical_model`; associate source models only after a reviewed mapping decision. Aliases point to canonical models and can deliberately return multiple candidates.

Matching pipeline:

1. Use reviewed `VehicleIntake.year`, `make`, and `model`; do not use `trim` to choose a model.
2. Normalize make. Exactly one active `knowledge.make` candidate is required.
3. First try enabled `source_exact`/reviewed alias candidates for normalized model text. If exactly one approved canonical model results, continue.
4. Otherwise compare `source_model_key` candidates within that make. A single approved candidate is a normalized match; more than one is ambiguous.
5. Resolve that canonical model to eligible `source_model` rows and then an eligible `model_year` matching the intake year. If that produces exactly one source-model-year record, match succeeds. If multiple source rows represent a reviewed canonical family, the mapping must explicitly designate a primary aggregate strategy before automatic matching is enabled.
6. Do not search by trim, approximate text similarity, make-only, model-only, or year-nearest fallback.

Returned statuses are deterministic strings, not AI probabilities:

| Status | Meaning |
| --- | --- |
| `exact_match` | Exact source/approved alias and one eligible year record |
| `alias_match` | Reviewed non-source alias and one eligible year record |
| `normalized_match` | One unambiguous normalized source key and one eligible year record |
| `no_match` | No make/model/year record or year absent from intake |
| `ambiguous_match` | More than one candidate at any matching stage |
| `quarantined_match` | Candidate exists only in source rows excluded from normal lookup |

For every result other than the first three, return `No reliable knowledge match found.` Do not infer a model from trim text or select the first row. A model with no source years, or a valid source year with no categories, is a coverage result rather than a defect verdict.

## Data quality and quarantine policy

| Source condition | Retention | Normal lookup behavior |
| --- | --- | --- |
| Two `year = 0` rows | Retain `model_year` with invalid-year quarantine | Never match |
| Six add-report category artifacts | Retain category with artifact quarantine | Never show or aggregate |
| One structurally incomplete problem | Retain problem with incomplete quarantine | Never show/aggregate until reviewed |
| Null NHTSA count (13,243 categories) | Preserve null | Omit NHTSA field; never convert to zero |
| Null repair cost (65,856 problems) | Preserve null/raw source value | Omit repair cost |
| Null warranty note (79,136 problems) | Preserve null | Omit warranty note |
| Zero-problem category (44,790) | Retain as coverage | May contribute category/NHTSA coverage, no problem headline |
| Zero-category year (2,338) | Retain valid model-year | Return `no_category_data` coverage |
| Model with no years (113) | Retain `source_model` | No automatic year match |

Import validation must also reject malformed URLs, negative counts, invalid severity outside 0..10, invalid mileage units, and string values above proposed bounds into a failed import/quarantine report rather than silently truncating them. Source data should not be silently deleted.

## Minimum index design

PK and stated unique constraints supply most MVP indexes. Add only:

1. `source_model (make_id, source_model_key) where mapping_status = 'mapped'` for normalized candidate lookup.
2. `model_alias (make_id, alias_key) where enabled` for alias candidate lookup.
3. `model_year (source_model_id, model_year) where quality_status = 'eligible'` for exact year lookup; the unique hierarchy index may already cover this, so benchmark before adding a duplicate partial index.
4. `category_observation (model_year_id) where display_status = 'eligible'`.
5. `aggregate_problem (category_id, reports_count desc, severity_score desc nulls last) where display_status = 'eligible'` for bounded paid detail.
6. `common_solution (problem_id, reports_count desc, source_ordinal)` for paid detail.

Do not create a global source-URL unique index: source year URLs are demonstrably not globally unique. Do not create full-text/GIN indexes; MVP queries are hierarchy lookups, not text search. The problem and solution indexes will consume the meaningful share of index storage; alias/taxonomy indexes are negligible.

## Free Quick Check: deterministic server query

The API must accept a small reviewed identity DTO, not an arbitrary SQL-like filter:

```ts
type FreeKnowledgeRequest = { year: number; make: string; model: string };
type FreeKnowledgeResponse = {
  match: { status: "exact_match" | "alias_match" | "normalized_match" | "no_match" | "ambiguous_match" | "quarantined_match"; matched?: { year: number; make: string; model: string; sourceUrl: string } };
  coverage?: { categoryCount: number; eligibleProblemCount: number; sourceReportedProblems: number; nhtsaComplaintCount: number | null };
  categorySummaries?: Array<{ category: string; carcomplaintsComplaintCount: number; nhtsaComplaintCount: number | null; eligibleProblemCount: number; maxSeverityScore: number | null }>;
  flags?: Array<{ code: "multiple_problem_categories" | "high_severity_problem" | "high_report_volume" | "nhtsa_volume_present"; inputs: Record<string, number> }>;
  headlines?: Array<{ category: string; problemTitle: string; reportsCount: number; severityLabel: string | null }>;
};
```

The response is server-calculated and bounded: at most 5 category summaries and 3 headlines. NHTSA is always labeled as a separate source aggregate, never combined with CarComplaints counts.

Transparent flags, all based only on available aggregates:

- `multiple_problem_categories`: at least 3 eligible categories have one or more aggregate problems.
- `high_severity_problem`: one eligible problem has severity score >= 8.0.
- `high_report_volume`: one eligible problem has `reports_count >= 10`.
- `nhtsa_volume_present`: sum of non-null category NHTSA counts >= 25.

These flags are prompts for investigation, not reliability scores, defect findings, predictions, or safety conclusions. No weighted composite/risk score is proposed. Category ordering: eligible CarComplaints complaint count descending, then maximum severity, then category name. Headlines: eligible problems ordered reports desc, severity desc, title; no more than one headline per category.

## Future paid knowledge query

This is an internal server DTO only. It does not authorize paid access and must be callable only after a future server-side entitlement decision.

```ts
type PaidKnowledgeEvidence = {
  match: { status: string; year?: number; make?: string; model?: string };
  source: { name: "CarComplaints.com"; scrapedAt: string | null };
  categories: Array<{
    category: string;
    carcomplaintsComplaintCount: number;
    nhtsaComplaintCount: number | null;
    sourceUrl: string;
    problems: Array<{
      title: string; reportsCount: number; totalComplaintsCount: number | null;
      severity: { score: number | null; label: string | null };
      repair: { typicalCostUsd: number | null; averageMileage: number | null; mileageUnit: string | null };
      faultyPart: string | null; warrantyNote: string | null; sourceUrl: string | null;
      commonSolutions: Array<{ text: string; reportsCount: number }>;
    }>;
  }>;
  truncated: boolean;
  truncation: { omittedCategories: number; omittedProblems: number; omittedSolutions: number };
};
```

Bound it to 6 categories, 8 problems per category (48 maximum), and 5 solutions per problem (240 maximum). Categories are ordered by eligible problem reports sum, then maximum severity; problems by reports desc/severity desc/title; solutions by reports desc/source order. The repository must calculate omitted counts and set `truncated`, rather than silently creating an unbounded future AI prompt. Repair costs remain USD and NHTSA remains a distinct category aggregate.

## Security, access, and caching

Browser clients must not query `knowledge.*` directly. Enable and force RLS on all knowledge tables; create restrictive deny policies for `anon` and `authenticated`; revoke all table/function privileges from those roles; grant privileged access only to `service_role`. This mirrors the existing operational model without changing it.

Expose only server routes/handlers with an explicit input DTO, `application/json`, small body bounds (for example 4 KB), string/year validation, rate limits, and response caps. Repository queries must use fixed joins and fixed limits; no client-controlled table, column, order clause, limit, snapshot, or package value. The Free route never fetches paid problem rows. The paid route must independently receive verified server entitlement context in a later phase; a request body such as `{ package: "full" }` has no authority.

Knowledge is snapshot data and is cacheable after matching: server-side cache keyed by active snapshot id plus canonical `year/make/model`, with a short public response cache only after privacy/replay review. Cache no intake/listing text. No caching infrastructure is needed before measured traffic warrants it.

## Trusted-machine importer design

Implement a Node/TypeScript CLI under a future `scripts/knowledge/` directory. It fits the existing TypeScript project, has the required database client/runtime conventions, and avoids deploying Python or an importer to Vercel. It must run only from a trusted machine with the direct database credential; it must never be a Next route, browser action, or Vercel build step.

Use a streaming parser (for example a JSON token/array streaming parser) over the root `brands` array. Do not use `JSON.parse` for production import because the source is already ~134 MB and full-object memory amplification is avoidable. The importer computes SHA-256 while reading, validates root metadata and every typed record, then writes deterministic batches.

Recommended process:

1. Validate source file path, size, root source name, timestamp, and SHA-256; create/resume the snapshot by checksum.
2. Upsert source makes/models/model-years/categories by their stated natural keys within the snapshot. Resolve curated canonical mappings/aliases from a committed, reviewed mapping file in a later implementation; never generate aliases with AI.
3. Insert eligible and quarantined problem/solution rows in 500-row batches. Use a transaction per source model or 500 rows, not one all-dataset transaction.
4. Persist `import_run` checkpoints after each committed model/year boundary. On rerun, skip already completed natural keys for the same checksum and resume from `last_source_path`.
5. Run verification counts, foreign-key/orphan checks, quarantine counts, duplicate-natural-key checks, and sampled query checks. Mark the snapshot `ready` only after verification succeeds.

Use `INSERT ... ON CONFLICT ... DO UPDATE` only for an incomplete same-checksum run. A changed source checksum must create a new snapshot, not mutate a ready snapshot. Progress should log make/model/year path, read/written/quarantined counts, elapsed time, and batch failures—never raw seller/listing data or credentials.

## Sample import and measurements

Do not import the full dataset first. Create a sample snapshot containing all rows for:

- `Toyota Yaris`: a lower-volume reference (20 years, 174 categories, 141 aggregate problems, 160 solutions).
- `Ford Explorer`: a high-volume reference (36 years, 553 categories, 1,933 aggregate problems, 3,017 solutions).
- One reviewed alias cluster from each punctuation family: Mazda `CX-5`/`CX5`, Honda `HR-V`/`HRV`, Audi `RS 3`/`RS3`, and Ram/Dodge ProMaster spelling variants.
- The known invalid/anomalous rows, imported only to exercise quarantine paths.

This sample intentionally exercises low/high fan-out, alias ambiguity, valid empty coverage, nullable fields, a zero year, artifact category, and incomplete problem. It should be selected by exact source paths, never by mutating the JSON.

Measure before and after the sample:

- row counts per table and quarantine-status counts;
- `pg_total_relation_size` for every table and index, plus database size delta;
- p50/p95 server query duration for exact, alias, ambiguous, no-match, Yaris, and Explorer cases;
- Free response serialized-byte size; target <= 8 KB;
- paid evidence serialized-byte size; target <= 80 KB before any future AI selection;
- `EXPLAIN (ANALYZE, BUFFERS)` for match, Free aggregate, and paid bounded-detail queries.

Project full size from measured bytes per source problem and solution, not from raw JSON bytes alone. Do not full-import until the projection stays comfortably within the chosen Supabase plan allowance.

## Storage budget

The source JSON is 134.3 MB on disk but includes repeated JSON keys/hierarchy. A normalized relational form retains important strings and URLs, so it should not be assumed tiny. Initial planning budget:

| Component | Expected | Conservative high |
| --- | ---: | ---: |
| Snapshot/taxonomy/aliases/import audit | < 2 MB | 5 MB |
| Model-year and category tables | 15–25 MB | 40 MB |
| Aggregate problem table plus TOAST | 35–60 MB | 95 MB |
| Common-solution table plus TOAST | 20–35 MB | 60 MB |
| Required indexes | 25–45 MB | 70 MB |
| Table/index free space and PostgreSQL overhead | 20–35 MB | 50 MB |
| Knowledge total | **117–202 MB** | **320 MB** |
| Operational database allowance | 20–40 MB | 75 MB |
| Future snapshot/import-growth allowance | 40–60 MB | 90 MB |
| Project planning total | **177–302 MB** | **485 MB** |

The upper bound approaches a typical 500 MB free database allowance and is not a commitment that the free tier will remain comfortable. The largest risks are long repeated URLs/text, index bloat, retaining multiple full snapshots, and adding unneeded text/JSON indexes. Keep raw JSON outside Supabase, retain one active full snapshot for MVP, and measure the sample before authorization of a complete load.

## Snapshot update strategy

For MVP, retain one active `ready` snapshot plus import metadata. On new scrape checksum:

1. import and verify it as a new snapshot;
2. point application configuration/query selection to the new snapshot only after verification;
3. mark the old snapshot `superseded`;
4. after a defined recovery window and storage measurement, explicitly purge the old snapshot in a separately approved maintenance operation.

Do not silently upsert changed source facts into the active snapshot: that weakens provenance and makes rollback impossible. Do not retain unlimited history: it jeopardizes free-tier storage without established product value.

## Phased implementation plan

1. **Approve data contract and schema.** Add only knowledge-schema migration(s), RLS/grants/schema tests, and no operational-table changes. Verify migration transaction and permissions; rollback is a new reviewed migration, never `db reset`.
2. **Canonicalization library.** Add a pure TypeScript normalization module, curated mapping/alias file, fixtures for listed spelling variants, and ambiguous/no-match tests. No database or UI call yet.
3. **Importer CLI and validation.** Add trusted-machine script, streaming parser dependency if justified, checksum/checkpoint model, dry-run mode, and source/anomaly tests. Recovery is rerun by checksum/run key.
4. **Sample snapshot import.** Run only approved source paths; measure relation sizes, plans, latency, and response sizes. Recovery is snapshot isolation/purge of that non-active sample.
5. **Review measurements and tune.** Adjust only demonstrated indexes/bounds/quarantine mapping. Re-run sample before full import.
6. **Full import.** Use the verified importer; publish one ready snapshot only after count/foreign-key/quarantine verification. Keep prior active snapshot until rollback window closes.
7. **Free repository and API.** Add server-only bounded query/repository/route tests, zero-AI assertions, RLS tests, and response-size tests. No client direct database access.
8. **Free UI integration.** Present only matched coverage, flags, and limited headlines; preserve the existing report logic and clear no-match language.
9. **Future paid evidence repository.** Add only bounded internal evidence retrieval after a separate entitlement design. Do not accept client package selection as authority and do not add AI in this phase.

## Decisions and blockers

### Blocking before implementation

1. Approve `knowledge` as a separate schema and the one-active-snapshot MVP retention policy.
2. Confirm the Supabase plan/database-size limit to use for the go/no-go sample threshold; the conservative estimate can approach 485 MB including operational/growth allowance.
3. Decide who approves canonical model mappings and aliases, particularly source spelling collisions. The importer must not guess them.
4. Confirm whether CarComplaints terms/licensing permit this storage and user-facing derived presentation. This is a product/legal source-rights decision, not a technical inference.

### Can decide later

- Exact user-facing wording/design for Free flags.
- Cache TTL/provider after traffic measurement.
- Paid entitlement, payment, AI prompt construction, report persistence, and full-history retention.
- Whether a later, measured storage budget justifies keeping two full snapshots.

## === CHATGPT HANDOFF ===

- **Recommended schema:** separate `knowledge` PostgreSQL schema; no operational-table reuse and no raw JSONB copy.
- **Tables:** `source_snapshot`, `make`, `canonical_model`, `source_model`, `model_alias`, `model_year`, `category_observation`, `aggregate_problem`, `common_solution`, `import_run`.
- **Rows:** 36 makes, 1,474 source models, 10,607 years, 88,384 categories, 95,065 aggregate problems, and 121,170 solutions; taxonomy/audit rows are small.
- **Canonical/alias strategy:** preserve source spellings, use deterministic separate keys, curate canonical mappings and aliases, and return ambiguity/no-match instead of guessing.
- **Anomalies:** retain with status/reason; quarantine year-zero, add-report artifacts, and structurally incomplete problem rows from ordinary lookup; preserve null/zero coverage accurately.
- **Minimum indexes:** hierarchy unique keys plus alias/model-key lookup, category lookup, bounded problem ordering, and bounded solution ordering; no GIN/full text/global URL uniqueness.
- **Free shape:** server-only, zero-AI, identity/coverage, five category summaries, transparent deterministic flags, and three aggregate-problem headlines.
- **Paid shape:** internal bounded evidence: six categories, eight problems/category, five solutions/problem, source attribution, distinct NHTSA counts, explicit truncation.
- **Security:** forced RLS and deny/revoke for browser roles; service-role server repository only; bounded request/query/response; future paid access requires server-verified entitlement.
- **Importer:** trusted-machine TypeScript streaming CLI; checksum snapshot, validation, deterministic upserts, 500-row transactions, checkpoints, quarantine, and verification; never Vercel/browser/AI.
- **Sample import:** Yaris, Explorer, reviewed alias families, and anomalies; measure rows, relation/index/database sizes, query plans/latency, and Free/Paid response bytes before full import.
- **Expected storage:** knowledge approximately 117–202 MB; conservative knowledge high 320 MB. With operational and growth allowances, plan for 177–302 MB and a conservative 485 MB; validate by sample before full load.
- **Blocking decisions:** schema/snapshot policy, actual plan size threshold, canonical mapping owner, and source-use/licensing approval.
- **Exact next implementation step:** approve this design and create only the `knowledge` schema migration plus RLS/grant/schema tests; do not start the importer or sample load first.
