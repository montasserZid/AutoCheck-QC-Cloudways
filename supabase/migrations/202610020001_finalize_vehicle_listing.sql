-- Atomically persists one reviewed intake. This RPC is service-role only.

alter table public.listings
  add column submission_key uuid;

create unique index listings_submission_key_unique_idx
  on public.listings (submission_key)
  where submission_key is not null;

create or replace function public.finalize_vehicle_listing(
  p_submission_key uuid,
  p_vehicle jsonb,
  p_listing jsonb
)
returns table(vehicle_id uuid, listing_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  selected_vehicle public.vehicles%rowtype;
  new_listing_id uuid;
  requested_make text := btrim(p_vehicle ->> 'make');
  requested_model text := btrim(p_vehicle ->> 'model');
  requested_year smallint := nullif(p_vehicle ->> 'model_year', '')::smallint;
  requested_trim text := nullif(btrim(p_vehicle ->> 'trim'), '');
  requested_vin text := nullif(upper(btrim(p_vehicle ->> 'vin')), '');
begin
  if p_submission_key is null or requested_make is null or requested_model is null then
    raise exception 'invalid finalization input';
  end if;

  -- Same-key calls serialize before looking up/inserting identity rows.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_submission_key::text, 0));
  select l.vehicle_id, l.id into vehicle_id, listing_id
    from public.listings l where l.submission_key = p_submission_key;
  if found then
    replayed := true;
    return next;
    return;
  end if;

  if requested_vin is not null then
    select * into selected_vehicle from public.vehicles v where v.vin = requested_vin for update;
    if found then
      -- Never mutate an established VIN identity. Only supplied, conflicting facts fail.
      if lower(selected_vehicle.make) <> lower(requested_make)
        or lower(selected_vehicle.model) <> lower(requested_model)
        or (requested_year is not null and selected_vehicle.model_year is not null and selected_vehicle.model_year <> requested_year)
        or (requested_trim is not null and selected_vehicle.trim is not null and lower(selected_vehicle.trim) <> lower(requested_trim)) then
        raise exception 'VIN identity conflict';
      end if;
      vehicle_id := selected_vehicle.id;
    else
      insert into public.vehicles (make, model, model_year, trim, vin)
      values (requested_make, requested_model, requested_year, requested_trim, requested_vin)
      returning id into vehicle_id;
    end if;
  else
    insert into public.vehicles (make, model, model_year, trim)
    values (requested_make, requested_model, requested_year, requested_trim)
    returning id into vehicle_id;
  end if;

  insert into public.listings (
    vehicle_id, submission_key, source_type, listing_url, raw_listing_text,
    photo_metadata, preferred_language, mileage_km, asking_price_cad, city,
    seller_type, accident_history_mentioned, rebuilt_status, maintenance_records,
    carfax_status, inspection_allowed, seller_description, normalization_status,
    normalization_metadata
  ) values (
    vehicle_id, p_submission_key, p_listing ->> 'source_type', nullif(p_listing ->> 'listing_url', ''),
    coalesce(p_listing ->> 'raw_listing_text', ''), coalesce(p_listing -> 'photo_metadata', '[]'::jsonb),
    p_listing ->> 'preferred_language', nullif(p_listing ->> 'mileage_km', '')::integer,
    nullif(p_listing ->> 'asking_price_cad', '')::numeric, nullif(p_listing ->> 'city', ''),
    p_listing ->> 'seller_type', p_listing ->> 'accident_history_mentioned', p_listing ->> 'rebuilt_status',
    p_listing ->> 'maintenance_records', p_listing ->> 'carfax_status', p_listing ->> 'inspection_allowed',
    coalesce(p_listing ->> 'seller_description', ''), 'submitted',
    coalesce(p_listing -> 'normalization_metadata', '{}'::jsonb)
  ) returning id into new_listing_id;

  listing_id := new_listing_id;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.finalize_vehicle_listing(uuid, jsonb, jsonb) from public;
grant execute on function public.finalize_vehicle_listing(uuid, jsonb, jsonb) to service_role;

comment on column public.listings.submission_key is
  'Client-generated UUID idempotency key for server-mediated finalized intake persistence.';
