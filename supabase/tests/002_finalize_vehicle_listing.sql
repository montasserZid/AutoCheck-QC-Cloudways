-- Run after all migrations with psql. The transaction always rolls back.
begin;

do $$
declare
  vin text := '2HGFB2F50FH123456';
  first_vehicle uuid;
  first_listing uuid;
  replay_vehicle uuid;
  replay_listing uuid;
  second_listing uuid;
begin
  if has_function_privilege('anon', 'public.finalize_vehicle_listing(uuid, jsonb, jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finalize_vehicle_listing(uuid, jsonb, jsonb)', 'EXECUTE') then
    raise exception 'browser roles can execute finalization RPC';
  end if;
  select vehicle_id, listing_id into first_vehicle, first_listing
  from public.finalize_vehicle_listing(
    '550e8400-e29b-41d4-a716-446655440000',
    '{"make":"Honda","model":"Civic","model_year":2018,"trim":"EX","vin":"2HGFB2F50FH123456"}'::jsonb,
    '{"source_type":"url","listing_url":"https://example.test/one","raw_listing_text":"Honda","photo_metadata":[],"preferred_language":"en","mileage_km":120000,"asking_price_cad":12000,"city":"Montreal","seller_type":"private","accident_history_mentioned":"unknown","rebuilt_status":"unknown","maintenance_records":"unknown","carfax_status":"unknown","inspection_allowed":"unknown","seller_description":"","normalization_metadata":{}}'::jsonb
  );
  if first_vehicle is null or first_listing is null then raise exception 'finalization did not return IDs'; end if;

  select vehicle_id, listing_id into replay_vehicle, replay_listing
  from public.finalize_vehicle_listing(
    '550e8400-e29b-41d4-a716-446655440000',
    '{"make":"Honda","model":"Civic","vin":"2HGFB2F50FH123456"}'::jsonb,
    '{}'::jsonb
  );
  if replay_vehicle <> first_vehicle or replay_listing <> first_listing then raise exception 'idempotent replay changed IDs'; end if;

  select listing_id into second_listing from public.finalize_vehicle_listing(
    '550e8400-e29b-41d4-a716-446655440001',
    '{"make":"Honda","model":"Civic","model_year":2018,"vin":"2HGFB2F50FH123456"}'::jsonb,
    '{"source_type":"manual","raw_listing_text":"second","photo_metadata":[],"preferred_language":"en","seller_type":"unknown","accident_history_mentioned":"unknown","rebuilt_status":"unknown","maintenance_records":"unknown","carfax_status":"unknown","inspection_allowed":"unknown","seller_description":"","normalization_metadata":{}}'::jsonb
  );
  if second_listing is null or (select count(*) from public.listings where vehicle_id = first_vehicle) <> 2 then raise exception 'same VIN did not support distinct listings'; end if;

  begin
    perform public.finalize_vehicle_listing('550e8400-e29b-41d4-a716-446655440002', '{"make":"Toyota","model":"Corolla","vin":"2HGFB2F50FH123456"}'::jsonb, '{}'::jsonb);
    raise exception 'conflicting VIN identity was accepted';
  exception when raise_exception then
    if sqlerrm <> 'VIN identity conflict' then raise; end if;
  end;

  begin
    perform public.finalize_vehicle_listing('550e8400-e29b-41d4-a716-446655440003', '{"make":"Mazda","model":"Mazda3"}'::jsonb, '{"source_type":"invalid","raw_listing_text":"bad","photo_metadata":[],"preferred_language":"en","seller_type":"unknown","accident_history_mentioned":"unknown","rebuilt_status":"unknown","maintenance_records":"unknown","carfax_status":"unknown","inspection_allowed":"unknown","seller_description":"","normalization_metadata":{}}'::jsonb);
    raise exception 'invalid listing was accepted';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.vehicles where make = 'Mazda' and model = 'Mazda3') then raise exception 'listing failure left a partial vehicle'; end if;
end;
$$;

rollback;
