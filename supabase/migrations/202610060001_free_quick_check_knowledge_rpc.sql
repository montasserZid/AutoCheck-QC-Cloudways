-- Bounded, service-role-only read boundary for the Free Quick Check.
-- It deliberately returns no problem titles, URLs, source IDs, solutions, or repair details.

create function public.free_quick_check_knowledge(
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
  selected_model_year_id bigint;
  populated_candidates integer;
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

  with candidates as (
    select model_year.id
    from knowledge.make make
    join knowledge.source_model source_model on source_model.make_id = make.id
    join knowledge.model_year model_year on model_year.source_model_id = source_model.id
    where make.snapshot_id = 17
      and make.canonical_make_key = p_make_key
      and source_model.source_model_key = p_model_key
      and model_year.model_year = vehicle_year
      and model_year.quality_status = 'eligible'
  ), populated as (
    select candidates.id
    from candidates
    where exists (
      select 1
      from knowledge.category_observation category
      where category.model_year_id = candidates.id
        and category.display_status = 'eligible'
        and category.carcomplaints_complaint_count > 0
    )
  )
  select count(*), min(id)
    into populated_candidates, selected_model_year_id
  from populated;

  if populated_candidates = 0 then
    outcome := 'limited';
    eligible_category_count := 0;
    top_areas := '[]'::jsonb;
    additional_historical_detail_available := false;
    return next;
    return;
  end if;

  if populated_candidates > 1 then
    outcome := 'ambiguous';
    eligible_category_count := 0;
    top_areas := '[]'::jsonb;
    additional_historical_detail_available := false;
    return next;
    return;
  end if;

  outcome := 'matched';
  select count(*)::integer
    into eligible_category_count
  from knowledge.category_observation category
  where category.model_year_id = selected_model_year_id
    and category.display_status = 'eligible';

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', area.source_category,
    'historicalComplaintCount', area.carcomplaints_complaint_count
  ) order by area.carcomplaints_complaint_count desc, area.source_category asc), '[]'::jsonb)
    into top_areas
  from (
    select category.source_category, category.carcomplaints_complaint_count
    from knowledge.category_observation category
    where category.model_year_id = selected_model_year_id
      and category.display_status = 'eligible'
      and category.carcomplaints_complaint_count > 0
    order by category.carcomplaints_complaint_count desc, category.source_category asc
    limit 3
  ) area;

  select exists (
    select 1
    from knowledge.category_observation category
    join knowledge.aggregate_problem problem on problem.category_id = category.id
    where category.model_year_id = selected_model_year_id
      and category.display_status = 'eligible'
      and problem.display_status = 'eligible'
  ) into additional_historical_detail_available;

  return next;
end;
$$;

revoke all on function public.free_quick_check_knowledge(uuid, uuid, text, text, bigint, char) from public, anon, authenticated;
grant execute on function public.free_quick_check_knowledge(uuid, uuid, text, text, bigint, char) to service_role;
