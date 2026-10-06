-- Seed only the reviewed snapshot-17 Subaru WRX family, then add canonical
-- alias fallback to the bounded Free Quick Check RPC.

do $subaru_wrx_mapping$
declare
  v_snapshot_id bigint;
  v_subaru_make_id bigint;
  v_canonical_id bigint;
  v_impreza_wrx_id bigint;
  v_wrx_id bigint;
  v_source_years smallint[];
begin
  select s.id into v_snapshot_id
  from knowledge.source_snapshot s
  where s.id = 17
    and s.scope = 'full'
    and s.import_status = 'ready'
    and s.source_sha256 = '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f';

  if v_snapshot_id is null then
    raise exception 'expected pinned full knowledge snapshot is unavailable';
  end if;

  select m.id into v_subaru_make_id
  from knowledge.make m
  where m.snapshot_id = v_snapshot_id
    and m.canonical_make_key = 'subaru';

  if v_subaru_make_id is null then
    raise exception 'expected Subaru make is unavailable in pinned snapshot';
  end if;

  select sm.id into v_impreza_wrx_id
  from knowledge.source_model sm
  where sm.make_id = v_subaru_make_id
    and sm.source_model = 'Impreza WRX'
    and sm.source_model_key = 'imprezawrx';

  if v_impreza_wrx_id is null then
    raise exception 'expected Subaru Impreza WRX source model is unavailable';
  end if;

  select array_agg(my.model_year order by my.model_year)
    into v_source_years
  from knowledge.model_year my
  where my.source_model_id = v_impreza_wrx_id;

  if v_source_years is distinct from array[2009, 2010, 2011, 2012, 2013, 2014]::smallint[] then
    raise exception 'unexpected Subaru Impreza WRX model-year coverage';
  end if;

  select sm.id into v_wrx_id
  from knowledge.source_model sm
  where sm.make_id = v_subaru_make_id
    and sm.source_model = 'WRX'
    and sm.source_model_key = 'wrx';

  if v_wrx_id is null then
    raise exception 'expected Subaru WRX source model is unavailable';
  end if;

  select array_agg(my.model_year order by my.model_year)
    into v_source_years
  from knowledge.model_year my
  where my.source_model_id = v_wrx_id;

  if v_source_years is distinct from array[2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022]::smallint[] then
    raise exception 'unexpected Subaru WRX model-year coverage';
  end if;

  select cm.id into v_canonical_id
  from knowledge.canonical_model cm
  where cm.make_id = v_subaru_make_id
    and cm.canonical_model_key = 'wrx';

  if v_canonical_id is not null then
    if not exists (
      select 1
      from knowledge.canonical_model cm
      where cm.id = v_canonical_id
        and cm.canonical_name = 'WRX'
        and cm.match_status = 'approved'
    ) then
      raise exception 'existing Subaru WRX canonical model does not match reviewed mapping';
    end if;
  else
    insert into knowledge.canonical_model (
      make_id, canonical_name, canonical_model_key, match_status
    ) values (
      v_subaru_make_id, 'WRX', 'wrx', 'approved'
    ) returning id into v_canonical_id;
  end if;

  if exists (
    select 1
    from knowledge.source_model sm
    where sm.id in (v_impreza_wrx_id, v_wrx_id)
      and (
        sm.mapping_status not in ('unmapped', 'mapped')
        or (sm.canonical_model_id is not null and sm.canonical_model_id <> v_canonical_id)
      )
  ) then
    raise exception 'existing Subaru WRX source mapping conflicts with reviewed mapping';
  end if;

  if exists (
    select 1
    from knowledge.source_model sm
    where sm.make_id = v_subaru_make_id
      and sm.source_model in ('Impreza', 'Impreza WRX STI', 'WRX STI')
      and sm.canonical_model_id = v_canonical_id
  ) then
    raise exception 'distinct Subaru Impreza or STI source model is already mapped to WRX';
  end if;

  update knowledge.source_model sm
  set canonical_model_id = v_canonical_id,
      mapping_status = 'mapped'
  where sm.id in (v_impreza_wrx_id, v_wrx_id);

  if exists (
    select 1
    from knowledge.model_alias a
    where a.make_id = v_subaru_make_id
      and a.canonical_model_id = v_canonical_id
      and a.alias_key = 'wrx'
      and (
        a.alias_value <> 'WRX'
        or a.alias_kind <> 'reviewed_alias'
        or a.enabled is not true
        or a.valid_from_year is distinct from 2009::smallint
        or a.valid_to_year is distinct from 2014::smallint
      )
  ) then
    raise exception 'existing Subaru WRX alias does not match reviewed mapping';
  end if;

  insert into knowledge.model_alias (
    make_id,
    canonical_model_id,
    alias_value,
    alias_key,
    alias_kind,
    enabled,
    valid_from_year,
    valid_to_year
  ) values (
    v_subaru_make_id,
    v_canonical_id,
    'WRX',
    'wrx',
    'reviewed_alias',
    true,
    2009,
    2014
  ) on conflict (make_id, alias_key, canonical_model_id) do nothing;
end;
$subaru_wrx_mapping$;

create or replace function public.free_quick_check_knowledge(
  p_listing_id uuid,
  p_submission_key uuid,
  p_make_key text,
  p_model_key text,
  p_snapshot_id bigint,
  p_snapshot_sha256 char(64)
)
returns table(
  outcome text,
  vehicle_year smallint,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  eligible_category_count integer,
  top_areas jsonb,
  additional_historical_detail_available boolean
)
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_selected_model_year_id bigint;
  v_direct_candidate_count integer;
  v_populated_candidates integer;
  v_alias_target_count integer;
  v_alias_canonical_model_id bigint;
begin
  if p_snapshot_id <> 17
    or p_snapshot_sha256 <> '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f' then
    raise exception 'unexpected Free Quick Check snapshot';
  end if;

  if not exists (
    select 1
    from knowledge.source_snapshot snapshot
    where snapshot.id = 17
      and snapshot.scope = 'full'
      and snapshot.import_status = 'ready'
      and snapshot.source_sha256 = '2617b681a5113a238e0f4920a8e561e8a4ce351206e528ce1cace082be17425f'
  ) then
    raise exception 'pinned Free Quick Check snapshot is unavailable';
  end if;

  select vehicle.model_year, vehicle.make, vehicle.model, vehicle.trim
    into vehicle_year, vehicle_make, vehicle_model, vehicle_trim
  from public.listings listing
  join public.vehicles vehicle on vehicle.id = listing.vehicle_id
  where listing.id = p_listing_id
    and listing.submission_key = p_submission_key;

  if not found then
    raise exception 'listing proof not found';
  end if;

  if vehicle_year is null or p_make_key = '' or p_model_key = '' then
    outcome := 'unavailable';
    eligible_category_count := 0;
    top_areas := '[]'::jsonb;
    additional_historical_detail_available := false;
    return next;
    return;
  end if;

  with direct_candidates as (
    select my.id
    from knowledge.make m
    join knowledge.source_model sm on sm.make_id = m.id
    join knowledge.model_year my on my.source_model_id = sm.id
    where m.snapshot_id = 17
      and m.canonical_make_key = p_make_key
      and sm.source_model_key = p_model_key
      and my.model_year = vehicle_year
      and my.quality_status = 'eligible'
  ), direct_populated as (
    select dc.id
    from direct_candidates dc
    where exists (
      select 1
      from knowledge.category_observation c
      where c.model_year_id = dc.id
        and c.display_status = 'eligible'
        and c.carcomplaints_complaint_count > 0
    )
  )
  select count(*)::integer, count(dp.id)::integer, min(dp.id)
    into v_direct_candidate_count, v_populated_candidates, v_selected_model_year_id
  from direct_candidates dc
  left join direct_populated dp on dp.id = dc.id;

  -- Direct exact-year identity is authoritative, including a zero-evidence result.
  if v_direct_candidate_count > 0 then
    if v_populated_candidates = 0 then
      outcome := 'limited';
      eligible_category_count := 0;
      top_areas := '[]'::jsonb;
      additional_historical_detail_available := false;
      return next;
      return;
    end if;

    if v_populated_candidates > 1 then
      outcome := 'ambiguous';
      eligible_category_count := 0;
      top_areas := '[]'::jsonb;
      additional_historical_detail_available := false;
      return next;
      return;
    end if;
  else
    select count(*)::integer, min(a.canonical_model_id)
      into v_alias_target_count, v_alias_canonical_model_id
    from knowledge.make m
    join knowledge.model_alias a on a.make_id = m.id
    join knowledge.canonical_model cm
      on cm.id = a.canonical_model_id
     and cm.make_id = a.make_id
    where m.snapshot_id = 17
      and m.canonical_make_key = p_make_key
      and a.alias_key = p_model_key
      and a.enabled
      and cm.match_status = 'approved'
      and (a.valid_from_year is null or vehicle_year >= a.valid_from_year)
      and (a.valid_to_year is null or vehicle_year <= a.valid_to_year);

    if v_alias_target_count = 0 then
      outcome := 'limited';
      eligible_category_count := 0;
      top_areas := '[]'::jsonb;
      additional_historical_detail_available := false;
      return next;
      return;
    end if;

    if v_alias_target_count > 1 then
      outcome := 'ambiguous';
      eligible_category_count := 0;
      top_areas := '[]'::jsonb;
      additional_historical_detail_available := false;
      return next;
      return;
    end if;

    with alias_candidates as (
      select my.id
      from knowledge.source_model sm
      join knowledge.model_year my on my.source_model_id = sm.id
      where sm.canonical_model_id = v_alias_canonical_model_id
        and sm.mapping_status = 'mapped'
        and my.model_year = vehicle_year
        and my.quality_status = 'eligible'
    ), alias_populated as (
      select ac.id
      from alias_candidates ac
      where exists (
        select 1
        from knowledge.category_observation c
        where c.model_year_id = ac.id
          and c.display_status = 'eligible'
          and c.carcomplaints_complaint_count > 0
      )
    )
    select count(*)::integer, count(ap.id)::integer, min(ap.id)
      into v_direct_candidate_count, v_populated_candidates, v_selected_model_year_id
    from alias_candidates ac
    left join alias_populated ap on ap.id = ac.id;

    if v_populated_candidates = 0 then
      outcome := 'limited';
      eligible_category_count := 0;
      top_areas := '[]'::jsonb;
      additional_historical_detail_available := false;
      return next;
      return;
    end if;

    if v_populated_candidates > 1 then
      outcome := 'ambiguous';
      eligible_category_count := 0;
      top_areas := '[]'::jsonb;
      additional_historical_detail_available := false;
      return next;
      return;
    end if;
  end if;

  outcome := 'matched';
  select count(*)::integer
    into eligible_category_count
  from knowledge.category_observation category
  where category.model_year_id = v_selected_model_year_id
    and category.display_status = 'eligible';

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', area.source_category,
    'historicalComplaintCount', area.carcomplaints_complaint_count
  ) order by area.carcomplaints_complaint_count desc, area.source_category asc), '[]'::jsonb)
    into top_areas
  from (
    select category.source_category, category.carcomplaints_complaint_count
    from knowledge.category_observation category
    where category.model_year_id = v_selected_model_year_id
      and category.display_status = 'eligible'
      and category.carcomplaints_complaint_count > 0
    order by category.carcomplaints_complaint_count desc, category.source_category asc
    limit 3
  ) area;

  select exists (
    select 1
    from knowledge.category_observation category
    join knowledge.aggregate_problem problem on problem.category_id = category.id
    where category.model_year_id = v_selected_model_year_id
      and category.display_status = 'eligible'
      and problem.display_status = 'eligible'
  ) into additional_historical_detail_available;

  return next;
end;
$$;

revoke all on function public.free_quick_check_knowledge(uuid, uuid, text, text, bigint, char) from public, anon, authenticated;
grant execute on function public.free_quick_check_knowledge(uuid, uuid, text, text, bigint, char) to service_role;
