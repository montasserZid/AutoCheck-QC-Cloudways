-- Run after all migrations with psql. All fixture writes are rolled back.
begin;

do $canonical_alias_matching$
declare
  v_snapshot_id bigint := 17;
  v_subaru_make_id bigint;
  v_wrx_canonical_id bigint;
  v_vehicle_id uuid;
  v_listing_id uuid;
  v_result record;
  v_test_make_id bigint;
  v_historic_canonical_id bigint;
  v_single_canonical_id bigint;
  v_alternate_canonical_id bigint;
  v_historic_source_id bigint;
  v_second_historic_source_id bigint;
  v_single_source_id bigint;
  v_direct_zero_source_id bigint;
  v_alternate_source_id bigint;
  v_fixture record;
  v_fixture_key uuid;
  v_rejected_constraint text;
begin
  if not exists (
    select 1
    from knowledge.source_snapshot s
    where s.id = v_snapshot_id
      and s.scope = 'full'
      and s.import_status = 'ready'
      and s.source_sha256 = '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  ) then
    raise exception 'pinned snapshot 17 is unavailable for canonical alias tests';
  end if;

  select m.id into v_subaru_make_id
  from knowledge.make m
  where m.snapshot_id = v_snapshot_id
    and m.canonical_make_key = 'subaru';

  select cm.id into v_wrx_canonical_id
  from knowledge.canonical_model cm
  where cm.make_id = v_subaru_make_id
    and cm.canonical_model_key = 'wrx'
    and cm.canonical_name = 'WRX'
    and cm.match_status = 'approved';

  if v_wrx_canonical_id is null
    or not exists (
      select 1 from knowledge.source_model sm
      where sm.make_id = v_subaru_make_id
        and sm.source_model = 'Impreza WRX'
        and sm.source_model_key = 'imprezawrx'
        and sm.canonical_model_id = v_wrx_canonical_id
        and sm.mapping_status = 'mapped'
    )
    or not exists (
      select 1 from knowledge.source_model sm
      where sm.make_id = v_subaru_make_id
        and sm.source_model = 'WRX'
        and sm.source_model_key = 'wrx'
        and sm.canonical_model_id = v_wrx_canonical_id
        and sm.mapping_status = 'mapped'
    )
    or not exists (
      select 1 from knowledge.model_alias a
      where a.make_id = v_subaru_make_id
        and a.canonical_model_id = v_wrx_canonical_id
        and a.alias_key = 'wrx'
        and a.valid_from_year = 2009
        and a.valid_to_year = 2014
        and a.enabled
    ) then
    raise exception 'reviewed Subaru WRX mapping was not seeded as expected';
  end if;

  -- The real reviewed fallback: 2013 WRX reaches Impreza WRX.
  insert into public.vehicles (make, model, model_year, trim)
  values ('Subaru', 'WRX', 2013, 'Limited') returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key)
  values (v_vehicle_id, '10000000-0000-4000-8000-000000000001') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(
    v_listing_id, '10000000-0000-4000-8000-000000000001', 'subaru', 'wrx', v_snapshot_id,
    '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  );
  if v_result.outcome <> 'matched' then raise exception '2013 Subaru WRX did not use reviewed fallback'; end if;

  -- 2015 direct WRX exists and must match without an alias range covering 2015.
  insert into public.vehicles (make, model, model_year)
  values ('Subaru', 'WRX', 2015) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key)
  values (v_vehicle_id, '10000000-0000-4000-8000-000000000002') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(
    v_listing_id, '10000000-0000-4000-8000-000000000002', 'subaru', 'wrx', v_snapshot_id,
    '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  );
  if v_result.outcome <> 'matched' then raise exception '2015 Subaru WRX direct match failed'; end if;

  insert into public.vehicles (make, model, model_year)
  values ('Subaru', 'Impreza', 2013) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key)
  values (v_vehicle_id, '10000000-0000-4000-8000-00000000000a') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(
    v_listing_id, '10000000-0000-4000-8000-00000000000a', 'subaru', 'impreza', v_snapshot_id,
    '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  );
  if v_result.outcome <> 'matched' then raise exception '2013 Subaru Impreza did not retain its direct match'; end if;

  -- Distinct models must not reach the ordinary WRX alias family.
  insert into public.vehicles (make, model, model_year)
  values ('Subaru', 'WRX STI', 2013) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key)
  values (v_vehicle_id, '10000000-0000-4000-8000-000000000003') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(
    v_listing_id, '10000000-0000-4000-8000-000000000003', 'subaru', 'wrxsti', v_snapshot_id,
    '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  );
  if v_result.outcome <> 'limited' then raise exception 'WRX STI incorrectly resolved to ordinary WRX'; end if;

  insert into public.vehicles (make, model, model_year)
  values ('Subaru', 'Impreza WRX STI', 2013) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key)
  values (v_vehicle_id, '10000000-0000-4000-8000-000000000004') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(
    v_listing_id, '10000000-0000-4000-8000-000000000004', 'subaru', 'imprezawrxsti', v_snapshot_id,
    '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  );
  if v_result.outcome <> 'limited' then raise exception 'Impreza WRX STI incorrectly resolved to ordinary WRX'; end if;

  -- Outside the reviewed/source coverage does not use a nearest year.
  insert into public.vehicles (make, model, model_year)
  values ('Subaru', 'WRX', 2008) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key)
  values (v_vehicle_id, '10000000-0000-4000-8000-000000000005') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(
    v_listing_id, '10000000-0000-4000-8000-000000000005', 'subaru', 'wrx', v_snapshot_id,
    '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  );
  if v_result.outcome <> 'limited' then raise exception 'out-of-range Subaru WRX used a fallback year'; end if;

  -- Synthetic snapshot-17 rows verify direct precedence, bounds, and ambiguity.
  insert into knowledge.make (snapshot_id, source_make, canonical_make_key, source_url)
  values (v_snapshot_id, 'Phase 6B Test Make', 'phase6btestmake', 'https://example.test/phase6b')
  returning id into v_test_make_id;
  insert into knowledge.canonical_model (make_id, canonical_name, canonical_model_key, match_status)
  values (v_test_make_id, 'Historic Roadster', 'historicroadster', 'approved')
  returning id into v_historic_canonical_id;
  insert into knowledge.canonical_model (make_id, canonical_name, canonical_model_key, match_status)
  values (v_test_make_id, 'Single Roadster', 'singleroadster', 'approved')
  returning id into v_single_canonical_id;
  insert into knowledge.canonical_model (make_id, canonical_name, canonical_model_key, match_status)
  values (v_test_make_id, 'Alternate Roadster', 'alternateroadster', 'approved')
  returning id into v_alternate_canonical_id;

  insert into knowledge.source_model (make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status)
  values (v_test_make_id, v_historic_canonical_id, 'Historic Roadster', 'historicroadster', 1, 'https://example.test/historic', 'mapped')
  returning id into v_historic_source_id;
  insert into knowledge.source_model (make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status)
  values (v_test_make_id, v_historic_canonical_id, 'Historic Roadster Two', 'historicroadstertwo', 1, 'https://example.test/historic-two', 'mapped')
  returning id into v_second_historic_source_id;
  insert into knowledge.source_model (make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status)
  values (v_test_make_id, v_single_canonical_id, 'Single Roadster', 'singleroadster', 1, 'https://example.test/single', 'mapped')
  returning id into v_single_source_id;
  insert into knowledge.source_model (make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status)
  values (v_test_make_id, v_historic_canonical_id, 'Direct Zero', 'directzero', 0, 'https://example.test/direct-zero', 'mapped')
  returning id into v_direct_zero_source_id;
  insert into knowledge.source_model (make_id, canonical_model_id, source_model, source_model_key, source_complaint_count, source_url, mapping_status)
  values (v_test_make_id, v_alternate_canonical_id, 'Alternate Roadster', 'alternateroadster', 1, 'https://example.test/alternate', 'mapped')
  returning id into v_alternate_source_id;

  insert into knowledge.model_year (source_model_id, model_year, source_reported_problems, source_url, quality_status)
  values
    (v_historic_source_id, 2013, 1, 'https://example.test/historic/2013', 'eligible'),
    (v_second_historic_source_id, 2013, 1, 'https://example.test/historic-two/2013', 'eligible'),
    (v_single_source_id, 2012, 1, 'https://example.test/single/2012', 'eligible'),
    (v_single_source_id, 2013, 1, 'https://example.test/single/2013', 'eligible'),
    (v_single_source_id, 2014, 1, 'https://example.test/single/2014', 'eligible'),
    (v_direct_zero_source_id, 2013, 0, 'https://example.test/direct-zero/2013', 'eligible'),
    (v_alternate_source_id, 2013, 1, 'https://example.test/alternate/2013', 'eligible');
  insert into knowledge.category_observation (model_year_id, source_category, category_key, carcomplaints_complaint_count, source_url, display_status)
  select my.id, 'engine', 'engine', 1, 'https://example.test/category/' || my.id, 'eligible'
  from knowledge.model_year my
  where my.source_model_id in (v_historic_source_id, v_second_historic_source_id, v_single_source_id, v_alternate_source_id);

  insert into knowledge.model_alias (make_id, canonical_model_id, alias_value, alias_key, alias_kind, enabled, valid_from_year, valid_to_year)
  values
    (v_test_make_id, v_single_canonical_id, 'Alias Match', 'aliasmatch', 'reviewed_alias', true, 2013, 2013),
    (v_test_make_id, v_single_canonical_id, 'Direct Zero', 'directzero', 'reviewed_alias', true, 2013, 2013),
    (v_test_make_id, v_single_canonical_id, 'Open Lower', 'openlower', 'reviewed_alias', true, null, 2013),
    (v_test_make_id, v_single_canonical_id, 'Open Upper', 'openupper', 'reviewed_alias', true, 2013, null),
    (v_test_make_id, v_single_canonical_id, 'Ambiguous Alias', 'ambiguousalias', 'reviewed_alias', true, 2013, 2013),
    (v_test_make_id, v_alternate_canonical_id, 'Ambiguous Alias', 'ambiguousalias', 'reviewed_alias', true, 2013, 2013),
    (v_test_make_id, v_historic_canonical_id, 'Multi Alias', 'multialias', 'reviewed_alias', true, 2013, 2013);

  begin
    insert into knowledge.model_alias (make_id, canonical_model_id, alias_value, alias_key, alias_kind, valid_from_year, valid_to_year)
    values (v_test_make_id, v_historic_canonical_id, 'Invalid Range', 'invalidrange', 'reviewed_alias', 2014, 2013);
    raise exception 'invalid alias year range was accepted';
  exception when check_violation then
    get stacked diagnostics v_rejected_constraint = constraint_name;
    if v_rejected_constraint <> 'model_alias_valid_year_range_check' then
      raise exception 'invalid alias range was rejected by unexpected constraint: %', v_rejected_constraint;
    end if;
  end;

  -- Exact boundary matches; bounds outside the interval do not resolve.
  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Alias Match', 2013) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-000000000006') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-000000000006', 'phase6btestmake', 'aliasmatch', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'matched' then raise exception 'single populated alias candidate did not match'; end if;

  -- A direct exact-year zero-evidence candidate wins over an alias with evidence.
  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Direct Zero', 2013) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-000000000007') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-000000000007', 'phase6btestmake', 'directzero', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'limited' then raise exception 'direct zero-evidence candidate did not win'; end if;

  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Ambiguous Alias', 2013) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-000000000008') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-000000000008', 'phase6btestmake', 'ambiguousalias', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'ambiguous' then raise exception 'multiple alias canonical targets were not ambiguous'; end if;

  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Open Lower', 2012) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-000000000009') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-000000000009', 'phase6btestmake', 'openlower', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'matched' then raise exception 'open lower bound did not resolve an in-range earlier year'; end if;

  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Open Upper', 2014) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-00000000000b') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-00000000000b', 'phase6btestmake', 'openupper', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'matched' then raise exception 'open upper bound did not resolve an in-range later year'; end if;

  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Alias Match', 2012) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-00000000000c') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-00000000000c', 'phase6btestmake', 'aliasmatch', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'limited' then raise exception 'year below alias range resolved'; end if;

  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Alias Match', 2014) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-00000000000d') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-00000000000d', 'phase6btestmake', 'aliasmatch', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'limited' then raise exception 'year above alias range resolved'; end if;

  -- One canonical expanding to two populated source-model rows remains ambiguous.
  insert into public.vehicles (make, model, model_year) values ('Phase 6B Test Make', 'Multi Alias', 2013) returning id into v_vehicle_id;
  insert into public.listings (vehicle_id, submission_key) values (v_vehicle_id, '10000000-0000-4000-8000-00000000000e') returning id into v_listing_id;
  select * into v_result from public.free_quick_check_knowledge(v_listing_id, '10000000-0000-4000-8000-00000000000e', 'phase6btestmake', 'multialias', v_snapshot_id, '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f');
  if v_result.outcome <> 'ambiguous' then raise exception 'canonical multi-source ambiguity was not preserved'; end if;

  -- Existing normalized populated collision fixtures remain ambiguous.
  for v_fixture in
    select * from (values
      ('Dodge'::text, 'Promaster'::text, 'dodge'::text, 'promaster'::text, 2015::smallint),
      ('Lexus'::text, 'GX460'::text, 'lexus'::text, 'gx460'::text, 2019::smallint),
      ('Lexus'::text, 'LS460'::text, 'lexus'::text, 'ls460'::text, 2007::smallint),
      ('Lexus'::text, 'NX200t'::text, 'lexus'::text, 'nx200t'::text, 2016::smallint)
    ) as f(make_name, model_name, make_key, model_key, model_year)
  loop
    v_fixture_key := gen_random_uuid();
    insert into public.vehicles (make, model, model_year)
    values (v_fixture.make_name, v_fixture.model_name, v_fixture.model_year)
    returning id into v_vehicle_id;
    insert into public.listings (vehicle_id, submission_key)
    values (v_vehicle_id, v_fixture_key) returning id into v_listing_id;
    select * into v_result from public.free_quick_check_knowledge(
      v_listing_id, v_fixture_key, v_fixture.make_key, v_fixture.model_key, v_snapshot_id,
      '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
    );
    if v_result.outcome <> 'ambiguous' then
      raise exception 'normalized collision fixture % / % / % was not ambiguous', v_fixture.make_name, v_fixture.model_name, v_fixture.model_year;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.free_quick_check_knowledge(uuid,uuid,text,text,bigint,char)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.free_quick_check_knowledge(uuid,uuid,text,text,bigint,char)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.free_quick_check_knowledge(uuid,uuid,text,text,bigint,char)', 'EXECUTE') then
    raise exception 'Free Quick Check RPC privileges are not service-role-only';
  end if;
end;
$canonical_alias_matching$;

rollback;
