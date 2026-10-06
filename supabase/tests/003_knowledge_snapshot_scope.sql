-- Run after 202610030002. This transaction leaves no fixture data behind.
begin;

do $scope_test$
declare
  legacy_id bigint;
  full_id bigint;
  sample_id bigint;
  second_sample_id bigint;
  resolved_id bigint;
  status_value text;
  hash_value char(64);
begin
  -- Pre-scope call shape remains a full snapshot with no sample definition.
  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status)
  values ('CarComplaints.com', repeat('b', 64), 1, 'staged') returning id into legacy_id;
  select scope, sample_definition_hash into status_value, hash_value
  from knowledge.source_snapshot where id = legacy_id;
  if status_value <> 'full' or hash_value is not null then
    raise exception 'legacy/default snapshot semantics are not full/null';
  end if;

  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope)
  values ('CarComplaints.com', repeat('c', 64), 1, 'staged', 'full') returning id into full_id;
  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope, sample_definition_hash)
  values ('CarComplaints.com', repeat('c', 64), 1, 'staged', 'sample', repeat('d', 64)) returning id into sample_id;
  if full_id = sample_id then raise exception 'full and sample snapshots were not isolated'; end if;

  begin
    insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope)
    values ('CarComplaints.com', repeat('c', 64), 1, 'staged', 'full');
    raise exception 'duplicate full snapshot accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope, sample_definition_hash)
    values ('CarComplaints.com', repeat('c', 64), 1, 'staged', 'sample', repeat('d', 64));
    raise exception 'duplicate sample definition accepted';
  exception when unique_violation then null;
  end;
  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope, sample_definition_hash)
  values ('CarComplaints.com', repeat('c', 64), 1, 'staged', 'sample', repeat('e', 64)) returning id into second_sample_id;
  if second_sample_id = sample_id then raise exception 'different sample definitions were not isolated'; end if;

  begin
    insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope, sample_definition_hash)
    values ('CarComplaints.com', repeat('f', 64), 1, 'staged', 'full', repeat('d', 64));
    raise exception 'full accepted a sample definition';
  exception when check_violation then null;
  end;
  begin
    insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope)
    values ('CarComplaints.com', repeat('f', 64), 1, 'staged', 'sample');
    raise exception 'sample accepted no definition';
  exception when check_violation then null;
  end;
  begin
    insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope)
    values ('CarComplaints.com', repeat('a', 64), 1, 'staged', 'partial');
    raise exception 'invalid scope accepted';
  exception when check_violation then null;
  end;
  begin
    insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope, sample_definition_hash)
    values ('CarComplaints.com', repeat('a', 64), 1, 'staged', 'sample', repeat('g', 64));
    raise exception 'malformed sample hash accepted';
  exception when check_violation then null;
  end;

  -- Identity changes are rejected, while normal import lifecycle fields work.
  begin
    update knowledge.source_snapshot set source_sha256 = repeat('9', 64) where id = full_id;
    raise exception 'source SHA mutation accepted';
  exception when raise_exception then
    if sqlerrm <> 'knowledge source snapshot identity is immutable' then raise; end if;
  end;
  begin
    update knowledge.source_snapshot set scope = 'sample' where id = full_id;
    raise exception 'scope mutation accepted';
  exception when raise_exception then
    if sqlerrm <> 'knowledge source snapshot identity is immutable' then raise; end if;
  end;
  begin
    update knowledge.source_snapshot set sample_definition_hash = repeat('f', 64) where id = sample_id;
    raise exception 'sample definition mutation accepted';
  exception when raise_exception then
    if sqlerrm <> 'knowledge source snapshot identity is immutable' then raise; end if;
  end;
  update knowledge.source_snapshot set import_status = 'importing', notes = 'status update allowed' where id = full_id;
  select import_status into status_value from knowledge.source_snapshot where id = full_id;
  if status_value <> 'importing' then raise exception 'ordinary status update was blocked'; end if;

  -- Exact partial-index conflict inference forms used by the importer.
  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope)
  values ('CarComplaints.com', repeat('c', 64), 1, 'staged', 'full')
  on conflict (source_sha256) where scope = 'full'
  do update set notes = 'full conflict inferred'
  returning id into resolved_id;
  if resolved_id <> full_id then raise exception 'full partial conflict did not resolve existing snapshot'; end if;
  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, scope, sample_definition_hash)
  values ('CarComplaints.com', repeat('c', 64), 1, 'staged', 'sample', repeat('d', 64))
  on conflict (source_sha256, sample_definition_hash) where scope = 'sample'
  do update set notes = 'sample conflict inferred'
  returning id into resolved_id;
  if resolved_id <> sample_id then raise exception 'sample partial conflict did not resolve existing snapshot'; end if;
end;
$scope_test$;

rollback;
