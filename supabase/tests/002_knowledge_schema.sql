-- Run after all migrations with psql. The transaction always rolls back.
begin;

do $knowledge_fixture$
<<knowledge_fixture>>
declare
  honda_snapshot_id bigint;
  toyota_snapshot_id bigint;
  honda_make_id bigint;
  toyota_make_id bigint;
  civic_id bigint;
  accord_id bigint;
  toyota_model_id bigint;
  source_model_id bigint;
  model_year_id bigint;
  invalid_year_id bigint;
  category_id bigint;
  problem_id bigint;
begin
  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, importer_version)
  values ('CarComplaints.com', repeat('a', 64), 1, 'staged', 'schema-test')
  returning id into honda_snapshot_id;
  insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status, importer_version)
  values ('CarComplaints.com', repeat('b', 64), 1, 'staged', 'schema-test')
  returning id into toyota_snapshot_id;

  insert into knowledge.make (snapshot_id, source_make, canonical_make_key, source_url)
  values (honda_snapshot_id, 'Honda', 'honda', 'https://example.test/honda')
  returning id into honda_make_id;
  insert into knowledge.make (snapshot_id, source_make, canonical_make_key, source_url)
  values (toyota_snapshot_id, 'Toyota', 'toyota', 'https://example.test/toyota')
  returning id into toyota_make_id;

  insert into knowledge.canonical_model (make_id, canonical_name, canonical_model_key, match_status)
  values (honda_make_id, 'Civic', 'civic', 'approved') returning id into civic_id;
  insert into knowledge.canonical_model (make_id, canonical_name, canonical_model_key, match_status)
  values (honda_make_id, 'Accord', 'accord', 'review_required') returning id into accord_id;
  insert into knowledge.canonical_model (make_id, canonical_name, canonical_model_key, match_status)
  values (toyota_make_id, 'Camry', 'camry', 'approved') returning id into toyota_model_id;

  -- Same-make canonical mapping succeeds.
  insert into knowledge.source_model (
    make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status
  ) values (
    honda_make_id, civic_id, 'Civic', 'civic', 0, 'https://example.test/honda/civic', 'mapped'
  ) returning id into source_model_id;

  -- Non-mapped states intentionally retain no single canonical candidate.
  insert into knowledge.source_model (
    make_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status
  ) values
    (honda_make_id, 'Civic Source Variant', 'civicvariant', 0, 'https://example.test/honda/civic-variant', 'unmapped'),
    (honda_make_id, 'Civic Ambiguous', 'civicambiguous', 0, 'https://example.test/honda/civic-ambiguous', 'ambiguous'),
    (honda_make_id, 'Civic Quarantined', 'civicquarantined', 0, 'https://example.test/honda/civic-quarantined', 'quarantined');

  begin
    insert into knowledge.source_model (
      make_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status
    ) values (
      honda_make_id, 'Invalid Mapping State', 'invalidmappingstate', 0,
      'https://example.test/honda/invalid-mapping-state', 'guessed'
    );
    raise exception 'invalid source model mapping status was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into knowledge.source_model (
      make_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status
    ) values (
      honda_make_id, 'Mapped Without Canonical', 'mappedwithoutcanonical', 0,
      'https://example.test/honda/mapped-without-canonical', 'mapped'
    );
    raise exception 'mapped source model was accepted without a canonical model';
  exception when check_violation then null;
  end;

  begin
    insert into knowledge.source_model (
      make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status
    ) values (
      honda_make_id, toyota_model_id, 'Cross Make Model', 'crossmakemodel', 0,
      'https://example.test/honda/cross-make', 'mapped'
    );
    raise exception 'cross-make/cross-snapshot source model mapping was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into knowledge.source_model (
      make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status
    ) values (
      honda_make_id, civic_id, 'Unmapped With Canonical', 'unmappedwithcanonical', 0,
      'https://example.test/honda/unmapped-with-canonical', 'unmapped'
    );
    raise exception 'non-mapped source model retained a canonical model';
  exception when check_violation then null;
  end;

  -- Multiple same-make candidates preserve ambiguity rather than guessing.
  insert into knowledge.model_alias (make_id, canonical_model_id, alias_value, alias_key, alias_kind)
  values
    (honda_make_id, civic_id, 'Civic/Accord', 'civicaccord', 'reviewed_alias'),
    (honda_make_id, accord_id, 'Civic/Accord', 'civicaccord', 'reviewed_alias');
  begin
    insert into knowledge.model_alias (make_id, canonical_model_id, alias_value, alias_key, alias_kind)
    values (honda_make_id, toyota_model_id, 'Cross Make Alias', 'crossmakealias', 'reviewed_alias');
    raise exception 'cross-make/cross-snapshot alias mapping was accepted';
  exception when foreign_key_violation then null;
  end;

  -- Valid years are eligible; invalid years require invalid-year quarantine and a reason.
  insert into knowledge.model_year (
    source_model_id, model_year, source_reported_problems, source_url, quality_status
  ) values (
    source_model_id, 2018, 0, 'https://example.test/honda/civic/2018', 'eligible'
  ) returning id into model_year_id;
  insert into knowledge.model_year (
    source_model_id, model_year, source_reported_problems, source_url, quality_status, quarantine_reason
  ) values (
    source_model_id, 0, 0, 'https://example.test/honda/civic/0',
    'quarantined_invalid_year', 'source reported year zero'
  ) returning id into invalid_year_id;
  begin
    update knowledge.model_year
      set quality_status = 'quarantined_invalid_year', quarantine_reason = 'incorrectly quarantined'
      where id = model_year_id;
    raise exception 'valid year was accepted as quarantined_invalid_year';
  exception when check_violation then null;
  end;
  begin
    update knowledge.model_year set quality_status = 'eligible' where id = invalid_year_id;
    raise exception 'year zero was accepted as eligible';
  exception when check_violation then null;
  end;
  begin
    update knowledge.model_year set quarantine_reason = null where id = invalid_year_id;
    raise exception 'year zero invalid quarantine was accepted without a reason';
  exception when check_violation then null;
  end;

  insert into knowledge.category_observation (
    model_year_id, source_category, category_key, carcomplaints_complaint_count,
    nhtsa_complaint_count, source_url, display_status
  ) values (
    model_year_id, 'Engine', 'engine', 0, null,
    'https://example.test/honda/civic/2018/engine', 'eligible'
  ) returning id into category_id;
  begin
    update knowledge.category_observation set quarantine_reason = 'contradictory eligible reason' where id = category_id;
    raise exception 'eligible category accepted a quarantine reason';
  exception when check_violation then null;
  end;
  insert into knowledge.category_observation (
    model_year_id, source_category, category_key, carcomplaints_complaint_count,
    source_url, display_status, quarantine_reason
  ) values (
    model_year_id, 'Artifact', 'artifact', 0,
    'https://example.test/honda/civic/2018/artifact', 'quarantined_artifact', 'source UI artifact'
  );
  begin
    insert into knowledge.category_observation (
      model_year_id, source_category, category_key, carcomplaints_complaint_count, source_url, display_status
    ) values (
      model_year_id, 'Artifact Missing Reason', 'artifactmissingreason', 0,
      'https://example.test/honda/civic/2018/artifact-missing-reason', 'quarantined_artifact'
    );
    raise exception 'quarantined category was accepted without a reason';
  exception when check_violation then null;
  end;

  insert into knowledge.aggregate_problem (
    category_id, source_problem_title, reports_count, display_status
  ) values (
    category_id, 'Test aggregate problem', 0, 'eligible'
  ) returning id into problem_id;
  begin
    update knowledge.aggregate_problem set quarantine_reason = 'contradictory eligible reason' where id = problem_id;
    raise exception 'eligible problem accepted a quarantine reason';
  exception when check_violation then null;
  end;
  insert into knowledge.aggregate_problem (
    category_id, source_problem_title, reports_count, display_status, quarantine_reason
  ) values (
    category_id, 'Incomplete aggregate problem', 0, 'quarantined_incomplete', 'missing source structure'
  );
  begin
    insert into knowledge.aggregate_problem (category_id, source_problem_title, reports_count, display_status)
    values (category_id, 'Incomplete Missing Reason', 0, 'quarantined_incomplete');
    raise exception 'quarantined problem was accepted without a reason';
  exception when check_violation then null;
  end;

  insert into knowledge.common_solution (problem_id, source_ordinal, source_solution, reports_count)
  values (problem_id, 1, 'Test aggregate solution', 0);
  insert into knowledge.import_run (snapshot_id, run_key, phase, started_at)
  values (honda_snapshot_id, '00000000-0000-0000-0000-000000000001', 'validate', now());

  if (
    select count(*) from knowledge.model_alias a
    where a.make_id = knowledge_fixture.honda_make_id and a.alias_key = 'civicaccord'
  ) <> 2 then
    raise exception 'ambiguous aliases were not retained';
  end if;
  if exists (
    select 1 from knowledge.aggregate_problem
    where id = problem_id
      and (total_complaints_count is not null or severity_score is not null
        or typical_repair_cost_usd is not null or warranty_note is not null)
  ) then
    raise exception 'nullable aggregate source fields were coerced';
  end if;
  begin
    insert into knowledge.category_observation (
      model_year_id, source_category, category_key, carcomplaints_complaint_count, source_url, display_status
    ) values (
      model_year_id, 'Negative', 'negative', -1,
      'https://example.test/honda/civic/2018/negative', 'eligible'
    );
    raise exception 'negative category count was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into knowledge.aggregate_problem (
      category_id, source_problem_title, reports_count, severity_score, display_status
    ) values (category_id, 'Invalid severity', 1, 10.1, 'eligible');
    raise exception 'out-of-range severity was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into knowledge.common_solution (problem_id, source_ordinal, source_solution, reports_count)
    values (problem_id, 1, 'Duplicate ordinal', 0);
    raise exception 'duplicate solution natural identity was accepted';
  exception when unique_violation then null;
  end;
  begin
    delete from knowledge.make where id = honda_make_id;
    raise exception 'restrict hierarchy delete was accepted';
  exception when foreign_key_violation then null;
  end;
end;
$knowledge_fixture$;

-- Actual service-role identity insert. The surrounding transaction rolls it back.
set local role service_role;
insert into knowledge.source_snapshot (source_name, source_sha256, source_bytes, import_status)
values ('Service Role Schema Test', repeat('c', 64), 1, 'staged');
reset role;

do $knowledge_security$
declare
  table_name text;
  privilege_name text;
  sequence_name text;
  expected_tables text[] := array[
    'source_snapshot', 'make', 'canonical_model', 'source_model', 'model_alias',
    'model_year', 'category_observation', 'aggregate_problem', 'common_solution', 'import_run'
  ];
  expected_indexes text[] := array[
    'source_model_mapped_make_key_idx', 'model_alias_enabled_make_key_idx',
    'category_observation_eligible_model_year_idx',
    'aggregate_problem_eligible_category_order_idx', 'common_solution_problem_order_idx'
  ];
  expected_sequences text[] := array[
    'source_snapshot_id_seq', 'make_id_seq', 'canonical_model_id_seq', 'source_model_id_seq',
    'model_alias_id_seq', 'model_year_id_seq', 'category_observation_id_seq',
    'aggregate_problem_id_seq', 'common_solution_id_seq', 'import_run_id_seq'
  ];
begin
  foreach table_name in array expected_tables loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'knowledge' and c.relname = table_name and c.relkind = 'r'
    ) then
      raise exception 'knowledge.% does not exist', table_name;
    end if;
    if not exists (
      select 1 from pg_constraint c join pg_class relation on relation.oid = c.conrelid
      join pg_namespace n on n.oid = relation.relnamespace
      where n.nspname = 'knowledge' and relation.relname = table_name and c.contype = 'p'
    ) then
      raise exception 'knowledge.% has no primary key', table_name;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'knowledge' and c.relname = table_name and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception 'RLS is not enabled and forced for knowledge.%', table_name;
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'knowledge' and tablename = table_name
        and policyname = table_name || '_deny_public'
        and permissive = 'RESTRICTIVE' and cmd = 'ALL'
        and roles @> array['anon'::name, 'authenticated'::name]
        and qual = 'false' and with_check = 'false'
    ) then
      raise exception 'complete restrictive deny policy is missing for knowledge.%', table_name;
    end if;
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', format('knowledge.%I', table_name), privilege_name)
        or has_table_privilege('authenticated', format('knowledge.%I', table_name), privilege_name) then
        raise exception 'browser role has unexpected % access to knowledge.%', privilege_name, table_name;
      end if;
    end loop;
    if not has_table_privilege('service_role', format('knowledge.%I', table_name), 'SELECT')
      or not has_table_privilege('service_role', format('knowledge.%I', table_name), 'INSERT') then
      raise exception 'service_role is missing read/write access to knowledge.%', table_name;
    end if;
  end loop;

  foreach sequence_name in array expected_sequences loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'knowledge' and c.relname = sequence_name and c.relkind = 'S'
    ) then
      raise exception 'expected identity sequence knowledge.% is missing', sequence_name;
    end if;
    if not has_sequence_privilege('service_role', format('knowledge.%I', sequence_name), 'USAGE')
      or has_sequence_privilege('anon', format('knowledge.%I', sequence_name), 'USAGE')
      or has_sequence_privilege('authenticated', format('knowledge.%I', sequence_name), 'USAGE') then
      raise exception 'identity sequence privilege is not server-only for knowledge.%', sequence_name;
    end if;
  end loop;

  if has_schema_privilege('anon', 'knowledge', 'USAGE')
    or has_schema_privilege('authenticated', 'knowledge', 'USAGE')
    or not has_schema_privilege('service_role', 'knowledge', 'USAGE') then
    raise exception 'knowledge schema grants are not server-only';
  end if;

  foreach table_name in array expected_indexes loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'knowledge' and c.relname = table_name and c.relkind = 'i'
    ) then
      raise exception 'expected knowledge index % is missing', table_name;
    end if;
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'source_model_canonical_model_make_fk' and confdeltype = 'r')
    or not exists (select 1 from pg_constraint where conname = 'model_alias_canonical_model_make_fk' and confdeltype = 'r') then
    raise exception 'same-make canonical composite foreign keys are missing or not restrictive';
  end if;
  if (
    select count(*) from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace child_schema on child_schema.oid = child.relnamespace
    where c.contype = 'f' and child_schema.nspname = 'knowledge'
  ) <> 11 then
    raise exception 'knowledge hierarchy foreign key count is unexpected';
  end if;
  if exists (
    select 1 from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace child_schema on child_schema.oid = child.relnamespace
    where c.contype = 'f' and child_schema.nspname = 'knowledge' and c.confdeltype <> 'r'
  ) then
    raise exception 'knowledge hierarchy contains a non-restrict delete action';
  end if;
  if exists (
    select 1 from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace child_schema on child_schema.oid = child.relnamespace
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace parent_schema on parent_schema.oid = parent.relnamespace
    where c.contype = 'f'
      and ((child_schema.nspname = 'knowledge' and parent_schema.nspname = 'public')
        or (child_schema.nspname = 'public' and parent_schema.nspname = 'knowledge'))
  ) then
    raise exception 'knowledge schema has an operational-table foreign key';
  end if;
end;
$knowledge_security$;

do $knowledge_browser_access$
declare browser_role name;
begin
  foreach browser_role in array array['anon'::name, 'authenticated'::name] loop
    execute format('set local role %I', browser_role);
    begin
      execute 'select 1 from knowledge.source_snapshot limit 1';
      raise exception 'browser role % unexpectedly selected from knowledge', browser_role;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
  end loop;
end;
$knowledge_browser_access$;

rollback;
