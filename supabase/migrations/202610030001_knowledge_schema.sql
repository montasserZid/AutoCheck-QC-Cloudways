-- CarComplaints aggregate reference data. This schema is deliberately
-- separate from customer-facing operational data in public.*.

create schema knowledge;

create table knowledge.source_snapshot (
  id bigint generated always as identity primary key,
  source_name text not null
    check (source_name = btrim(source_name) and char_length(source_name) between 1 and 100),
  source_scraped_at timestamptz,
  source_sha256 char(64) not null unique,
  source_bytes bigint not null check (source_bytes > 0),
  import_status text not null
    check (import_status in ('staged', 'importing', 'ready', 'failed', 'superseded')),
  imported_at timestamptz,
  completed_at timestamptz,
  importer_version text check (importer_version is null or char_length(importer_version) <= 100),
  notes text check (notes is null or char_length(notes) <= 1000)
);

create table knowledge.make (
  id bigint generated always as identity primary key,
  snapshot_id bigint not null references knowledge.source_snapshot (id) on delete restrict,
  source_make text not null
    check (source_make = btrim(source_make) and char_length(source_make) between 1 and 100),
  canonical_make_key text not null
    check (canonical_make_key = btrim(canonical_make_key) and char_length(canonical_make_key) between 1 and 100),
  source_url text not null
    check (char_length(source_url) between 1 and 2048 and source_url ~ '^https://'),
  unique (snapshot_id, source_make),
  unique (snapshot_id, canonical_make_key)
);

create table knowledge.canonical_model (
  id bigint generated always as identity primary key,
  make_id bigint not null references knowledge.make (id) on delete restrict,
  canonical_name text not null
    check (canonical_name = btrim(canonical_name) and char_length(canonical_name) between 1 and 100),
  canonical_model_key text not null
    check (canonical_model_key = btrim(canonical_model_key) and char_length(canonical_model_key) between 1 and 100),
  match_status text not null
    check (match_status in ('approved', 'review_required', 'disabled')),
  unique (make_id, canonical_model_key),
  -- Supports same-make composite references from source models and aliases.
  unique (id, make_id)
);

create table knowledge.source_model (
  id bigint generated always as identity primary key,
  make_id bigint not null references knowledge.make (id) on delete restrict,
  canonical_model_id bigint,
  source_model text not null
    check (source_model = btrim(source_model) and char_length(source_model) between 1 and 100),
  source_model_key text not null
    check (source_model_key = btrim(source_model_key) and char_length(source_model_key) between 1 and 100),
  source_complaint_count integer not null check (source_complaint_count >= 0),
  source_url text not null
    check (char_length(source_url) between 1 and 2048 and source_url ~ '^https://'),
  mapping_status text not null
    check (mapping_status in ('mapped', 'unmapped', 'ambiguous', 'quarantined')),
  constraint source_model_mapping_canonical_check check (
    (mapping_status = 'mapped') = (canonical_model_id is not null)
  ),
  constraint source_model_canonical_model_make_fk
    foreign key (canonical_model_id, make_id)
    references knowledge.canonical_model (id, make_id)
    on delete restrict,
  unique (make_id, source_model)
);

create table knowledge.model_alias (
  id bigint generated always as identity primary key,
  make_id bigint not null references knowledge.make (id) on delete restrict,
  canonical_model_id bigint not null,
  alias_value text not null
    check (alias_value = btrim(alias_value) and char_length(alias_value) between 1 and 100),
  alias_key text not null
    check (alias_key = btrim(alias_key) and char_length(alias_key) between 1 and 100),
  alias_kind text not null
    check (alias_kind in ('source_exact', 'punctuation_variant', 'reviewed_alias')),
  enabled boolean not null default true,
  constraint model_alias_canonical_model_make_fk
    foreign key (canonical_model_id, make_id)
    references knowledge.canonical_model (id, make_id)
    on delete restrict,
  unique (make_id, alias_key, canonical_model_id)
);

create table knowledge.model_year (
  id bigint generated always as identity primary key,
  source_model_id bigint not null references knowledge.source_model (id) on delete restrict,
  model_year smallint not null,
  source_reported_problems integer not null check (source_reported_problems >= 0),
  source_url text not null
    check (char_length(source_url) between 1 and 2048 and source_url ~ '^https://'),
  quality_status text not null
    check (quality_status in ('eligible', 'quarantined_invalid_year')),
  quarantine_reason text check (quarantine_reason is null or char_length(quarantine_reason) <= 200),
  constraint model_year_quality_check check (
    (quality_status = 'eligible' and model_year between 1886 and 2100)
    or (
      quality_status = 'quarantined_invalid_year'
      and (model_year < 1886 or model_year > 2100)
      and quarantine_reason is not null
    )
  ),
  unique (source_model_id, model_year)
);

create table knowledge.category_observation (
  id bigint generated always as identity primary key,
  model_year_id bigint not null references knowledge.model_year (id) on delete restrict,
  source_category text not null
    check (source_category = btrim(source_category) and char_length(source_category) between 1 and 100),
  category_key text not null
    check (category_key = btrim(category_key) and char_length(category_key) between 1 and 100),
  carcomplaints_complaint_count integer not null check (carcomplaints_complaint_count >= 0),
  nhtsa_complaint_count integer check (nhtsa_complaint_count >= 0),
  source_url text not null
    check (char_length(source_url) between 1 and 2048 and source_url ~ '^https://'),
  display_status text not null
    check (display_status in ('eligible', 'quarantined_artifact')),
  quarantine_reason text check (quarantine_reason is null or char_length(quarantine_reason) <= 200),
  constraint category_observation_quality_check check (
    (display_status = 'eligible' and quarantine_reason is null)
    or (display_status = 'quarantined_artifact' and quarantine_reason is not null)
  ),
  unique (model_year_id, source_category)
);

create table knowledge.aggregate_problem (
  id bigint generated always as identity primary key,
  category_id bigint not null references knowledge.category_observation (id) on delete restrict,
  source_problem_title text not null
    check (source_problem_title = btrim(source_problem_title) and char_length(source_problem_title) between 1 and 200),
  reports_count integer not null check (reports_count >= 0),
  total_complaints_count integer check (total_complaints_count >= 0),
  severity_score numeric(3, 1) check (severity_score between 0 and 10),
  severity_label text check (severity_label is null or char_length(severity_label) <= 50),
  typical_repair_cost_usd integer check (typical_repair_cost_usd >= 0),
  repair_cost_raw text check (repair_cost_raw is null or char_length(repair_cost_raw) <= 100),
  average_mileage integer check (average_mileage >= 0),
  mileage_raw text check (mileage_raw is null or char_length(mileage_raw) <= 100),
  mileage_unit text check (mileage_unit is null or mileage_unit in ('miles', 'km', 'unknown')),
  faulty_part text check (faulty_part is null or char_length(faulty_part) <= 200),
  warranty_note text check (warranty_note is null or char_length(warranty_note) <= 500),
  source_url text check (source_url is null or (char_length(source_url) between 1 and 2048 and source_url ~ '^https://')),
  display_status text not null
    check (display_status in ('eligible', 'quarantined_incomplete')),
  quarantine_reason text check (quarantine_reason is null or char_length(quarantine_reason) <= 200),
  constraint aggregate_problem_quality_check check (
    (display_status = 'eligible' and quarantine_reason is null)
    or (display_status = 'quarantined_incomplete' and quarantine_reason is not null)
  ),
  unique (category_id, source_problem_title, source_url)
);

create table knowledge.common_solution (
  id bigint generated always as identity primary key,
  problem_id bigint not null references knowledge.aggregate_problem (id) on delete restrict,
  source_ordinal smallint not null check (source_ordinal > 0),
  source_solution text not null
    check (source_solution = btrim(source_solution) and char_length(source_solution) between 1 and 500),
  reports_count integer not null check (reports_count >= 0),
  unique (problem_id, source_ordinal)
);

create table knowledge.import_run (
  id bigint generated always as identity primary key,
  snapshot_id bigint not null references knowledge.source_snapshot (id) on delete restrict,
  run_key uuid not null unique,
  phase text not null check (phase in ('validate', 'load', 'verify', 'complete', 'failed')),
  last_source_path text check (last_source_path is null or char_length(last_source_path) <= 500),
  rows_read bigint not null default 0 check (rows_read >= 0),
  rows_written bigint not null default 0 check (rows_written >= 0),
  rows_quarantined bigint not null default 0 check (rows_quarantined >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  failure_summary text check (failure_summary is null or char_length(failure_summary) <= 1000)
);

-- The hierarchy and uniqueness constraints supply the remaining MVP indexes.
create index source_model_mapped_make_key_idx
  on knowledge.source_model (make_id, source_model_key)
  where mapping_status = 'mapped';
create index model_alias_enabled_make_key_idx
  on knowledge.model_alias (make_id, alias_key)
  where enabled;
-- The model_year natural-key unique index already covers the exact lookup;
-- defer its proposed partial duplicate until a measured query plan needs it.
create index category_observation_eligible_model_year_idx
  on knowledge.category_observation (model_year_id)
  where display_status = 'eligible';
create index aggregate_problem_eligible_category_order_idx
  on knowledge.aggregate_problem (category_id, reports_count desc, severity_score desc nulls last)
  where display_status = 'eligible';
create index common_solution_problem_order_idx
  on knowledge.common_solution (problem_id, reports_count desc, source_ordinal);

alter table knowledge.source_snapshot enable row level security;
alter table knowledge.source_snapshot force row level security;
alter table knowledge.make enable row level security;
alter table knowledge.make force row level security;
alter table knowledge.canonical_model enable row level security;
alter table knowledge.canonical_model force row level security;
alter table knowledge.source_model enable row level security;
alter table knowledge.source_model force row level security;
alter table knowledge.model_alias enable row level security;
alter table knowledge.model_alias force row level security;
alter table knowledge.model_year enable row level security;
alter table knowledge.model_year force row level security;
alter table knowledge.category_observation enable row level security;
alter table knowledge.category_observation force row level security;
alter table knowledge.aggregate_problem enable row level security;
alter table knowledge.aggregate_problem force row level security;
alter table knowledge.common_solution enable row level security;
alter table knowledge.common_solution force row level security;
alter table knowledge.import_run enable row level security;
alter table knowledge.import_run force row level security;

create policy source_snapshot_deny_public
  on knowledge.source_snapshot as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy make_deny_public
  on knowledge.make as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy canonical_model_deny_public
  on knowledge.canonical_model as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy source_model_deny_public
  on knowledge.source_model as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy model_alias_deny_public
  on knowledge.model_alias as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy model_year_deny_public
  on knowledge.model_year as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy category_observation_deny_public
  on knowledge.category_observation as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy aggregate_problem_deny_public
  on knowledge.aggregate_problem as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy common_solution_deny_public
  on knowledge.common_solution as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy import_run_deny_public
  on knowledge.import_run as restrictive for all to anon, authenticated
  using (false) with check (false);

revoke all on schema knowledge from public, anon, authenticated;
revoke all on table
  knowledge.source_snapshot,
  knowledge.make,
  knowledge.canonical_model,
  knowledge.source_model,
  knowledge.model_alias,
  knowledge.model_year,
  knowledge.category_observation,
  knowledge.aggregate_problem,
  knowledge.common_solution,
  knowledge.import_run
from public, anon, authenticated;
revoke all on sequence
  knowledge.source_snapshot_id_seq,
  knowledge.make_id_seq,
  knowledge.canonical_model_id_seq,
  knowledge.source_model_id_seq,
  knowledge.model_alias_id_seq,
  knowledge.model_year_id_seq,
  knowledge.category_observation_id_seq,
  knowledge.aggregate_problem_id_seq,
  knowledge.common_solution_id_seq,
  knowledge.import_run_id_seq
from public, anon, authenticated;

grant usage on schema knowledge to service_role;
grant all on table
  knowledge.source_snapshot,
  knowledge.make,
  knowledge.canonical_model,
  knowledge.source_model,
  knowledge.model_alias,
  knowledge.model_year,
  knowledge.category_observation,
  knowledge.aggregate_problem,
  knowledge.common_solution,
  knowledge.import_run
to service_role;
-- USAGE is sufficient for identity nextval() during INSERT. SELECT is not
-- granted because the importer reads returned table IDs, not sequences.
grant usage on sequence
  knowledge.source_snapshot_id_seq,
  knowledge.make_id_seq,
  knowledge.canonical_model_id_seq,
  knowledge.source_model_id_seq,
  knowledge.model_alias_id_seq,
  knowledge.model_year_id_seq,
  knowledge.category_observation_id_seq,
  knowledge.aggregate_problem_id_seq,
  knowledge.common_solution_id_seq,
  knowledge.import_run_id_seq
to service_role;

comment on schema knowledge is
  'Server-only aggregate vehicle knowledge snapshots; never customer operational data or raw source JSON.';
comment on table knowledge.aggregate_problem is
  'CarComplaints aggregate problem pages, not individual owner complaint narratives.';
comment on table knowledge.common_solution is
  'Aggregate/common source solutions, not verified repair recommendations.';
