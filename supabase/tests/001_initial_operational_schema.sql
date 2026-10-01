-- Run after migrations with psql. The transaction always rolls back.
begin;

do $$
declare
  vehicle_one uuid;
  vehicle_two uuid;
  listing_one uuid;
  report_one uuid;
  original_updated_at timestamptz;
begin
  insert into public.vehicles (make, model, model_year, vin)
  values ('Honda', 'Civic', 2018, '2HGFB2F50FH123456')
  returning id, updated_at into vehicle_one, original_updated_at;

  insert into public.vehicles (make, model, model_year)
  values ('Toyota', 'Corolla', 2019)
  returning id into vehicle_two;

  insert into public.listings (
    vehicle_id,
    source_type,
    listing_url,
    raw_listing_text,
    mileage_km,
    asking_price_cad,
    city,
    seller_type,
    preferred_language,
    normalization_status
  ) values (
    vehicle_one,
    'text',
    'https://example.test/listing/1',
    '2018 Honda Civic EX',
    132500,
    14900,
    'Longueuil',
    'private',
    'en',
    'normalized'
  ) returning id into listing_one;

  insert into public.reports (
    listing_id,
    vehicle_id,
    report_status,
    report_package,
    structured_payload,
    generation_metadata,
    generated_at
  ) values (
    listing_one,
    vehicle_one,
    'completed',
    'full',
    '{"riskScore": 25}'::jsonb,
    '{"generator": "schema-verification"}'::jsonb,
    now()
  ) returning id into report_one;

  insert into public.inspection_requests (
    listing_id,
    vehicle_id,
    report_id,
    buyer_name,
    buyer_phone,
    buyer_email,
    seller_contact,
    vehicle_address,
    preferred_date,
    preferred_time,
    urgency
  ) values (
    listing_one,
    vehicle_one,
    report_one,
    'Schema Test',
    '514-555-0198',
    'schema-test@example.test',
    'Test Seller',
    'Longueuil, QC',
    current_date + 1,
    '14:30',
    '24_48_hours'
  );

  update public.vehicles set trim = 'EX' where id = vehicle_one;
  if (select updated_at <= original_updated_at from public.vehicles where id = vehicle_one) then
    raise exception 'updated_at trigger did not advance the timestamp';
  end if;

  begin
    insert into public.reports (
      listing_id, vehicle_id, report_status, report_package, report_version
    ) values (
      listing_one, vehicle_two, 'queued', 'free', 2
    );
    raise exception 'mismatched listing/vehicle relationship was accepted';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.vehicles (make, model, vin)
    values ('Honda', 'Civic', 'INVALID');
    raise exception 'invalid VIN was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

do $$
declare
  table_name text;
  policy_count integer;
begin
  foreach table_name in array array[
    'vehicles', 'listings', 'reports', 'inspection_requests', 'contact_messages'
  ] loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relrowsecurity
        and c.relforcerowsecurity
    ) then
      raise exception 'RLS is not enabled and forced for public.%', table_name;
    end if;

    select count(*) into policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename = table_name
      and policyname like '%deny_public';

    if policy_count <> 1 then
      raise exception 'expected one deny policy for public.%', table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT') then
      raise exception 'public API roles have unexpected privileges on public.%', table_name;
    end if;
  end loop;
end;
$$;

rollback;
