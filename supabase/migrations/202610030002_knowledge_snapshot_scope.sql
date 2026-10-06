-- Separate immutable physical-source identity from import-coverage identity.
-- A sample and a full traversal may legitimately use the same source file.

alter table knowledge.source_snapshot
  add column scope text not null default 'full',
  add column sample_definition_hash char(64);

alter table knowledge.source_snapshot
  add constraint source_snapshot_scope_check
    check (scope in ('full', 'sample')),
  add constraint source_snapshot_scope_definition_check
    check (
      (scope = 'full' and sample_definition_hash is null)
      or (scope = 'sample' and sample_definition_hash is not null)
    ),
  add constraint source_snapshot_sample_definition_hash_format_check
    check (
      sample_definition_hash is null
      or sample_definition_hash ~ '^[0-9a-f]{64}$'
    );

-- Existing deployed rows predate sample support and are full snapshots.
alter table knowledge.source_snapshot
  drop constraint if exists source_snapshot_source_sha256_key;

create unique index source_snapshot_full_source_sha256_uidx
  on knowledge.source_snapshot (source_sha256)
  where scope = 'full';

create unique index source_snapshot_sample_source_sha256_definition_uidx
  on knowledge.source_snapshot (source_sha256, sample_definition_hash)
  where scope = 'sample';

create function knowledge.prevent_source_snapshot_identity_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.source_sha256 is distinct from old.source_sha256
    or new.scope is distinct from old.scope
    or new.sample_definition_hash is distinct from old.sample_definition_hash then
    raise exception 'knowledge source snapshot identity is immutable';
  end if;
  return new;
end;
$$;

create trigger source_snapshot_identity_immutable
before update on knowledge.source_snapshot
for each row execute function knowledge.prevent_source_snapshot_identity_change();

revoke all on function knowledge.prevent_source_snapshot_identity_change() from public, anon, authenticated;
