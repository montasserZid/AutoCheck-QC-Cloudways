-- AutoCheck QC operational schema.
-- Customer-facing access is intentionally server-mediated until authentication exists.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  make text not null check (char_length(btrim(make)) between 1 and 100),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  model_year smallint check (model_year between 1980 and 2100),
  trim text check (trim is null or char_length(btrim(trim)) between 1 and 100),
  vin text check (
    vin is null
    or (
      vin = upper(vin)
      and vin ~ '^[A-HJ-NPR-Z0-9]{17}$'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vehicles_vin_unique_idx
  on public.vehicles (vin)
  where vin is not null;

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles (id) on delete set null,
  source_type text not null default 'unknown'
    check (source_type in ('text', 'url', 'images', 'manual', 'unknown')),
  listing_url text check (
    listing_url is null
    or (
      char_length(listing_url) <= 2048
      and listing_url ~* '^https?://'
    )
  ),
  raw_listing_text text not null default '',
  photo_metadata jsonb not null default '[]'::jsonb
    check (jsonb_typeof(photo_metadata) = 'array'),
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'fr')),
  mileage_km integer check (mileage_km between 0 and 2000000),
  asking_price_cad numeric(12, 2)
    check (asking_price_cad > 0 and asking_price_cad <= 10000000),
  city text check (city is null or char_length(city) <= 150),
  seller_type text not null default 'unknown'
    check (seller_type in ('private', 'dealer', 'unknown')),
  accident_history_mentioned text not null default 'unknown'
    check (accident_history_mentioned in ('yes', 'no', 'unknown')),
  rebuilt_status text not null default 'unknown'
    check (rebuilt_status in ('yes', 'no', 'unknown')),
  maintenance_records text not null default 'unknown'
    check (maintenance_records in ('yes', 'no', 'unknown')),
  carfax_status text not null default 'unknown'
    check (carfax_status in ('available', 'not_available', 'unknown')),
  inspection_allowed text not null default 'unknown'
    check (inspection_allowed in ('yes', 'no', 'unknown')),
  seller_description text not null default ''
    check (char_length(seller_description) <= 4000),
  normalization_status text not null default 'submitted'
    check (normalization_status in ('submitted', 'normalized', 'failed')),
  normalization_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(normalization_metadata) = 'object'),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, vehicle_id)
);

create index listings_vehicle_id_idx on public.listings (vehicle_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  vehicle_id uuid not null,
  external_reference text unique
    check (external_reference is null or char_length(external_reference) between 1 and 100),
  report_status text not null default 'queued'
    check (report_status in ('queued', 'generating', 'completed', 'failed', 'review_required', 'superseded')),
  report_package text not null check (report_package in ('free', 'full')),
  report_version integer not null default 1 check (report_version > 0),
  structured_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_payload) = 'object'),
  generation_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(generation_metadata) = 'object'),
  generated_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_listing_vehicle_fk
    foreign key (listing_id, vehicle_id)
    references public.listings (id, vehicle_id)
    on delete restrict,
  constraint reports_completed_has_timestamp_check
    check (report_status <> 'completed' or generated_at is not null),
  unique (listing_id, report_version),
  unique (id, listing_id, vehicle_id)
);

create index reports_vehicle_id_idx on public.reports (vehicle_id);
create index reports_status_created_at_idx
  on public.reports (report_status, created_at)
  where report_status in ('queued', 'generating', 'review_required');

create table public.inspection_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  vehicle_id uuid not null,
  report_id uuid,
  external_reference text unique
    check (external_reference is null or char_length(external_reference) between 1 and 100),
  request_status text not null default 'received'
    check (request_status in ('received', 'reviewing', 'scheduling', 'confirmed', 'completed', 'cancelled', 'unavailable')),
  buyer_name text not null check (char_length(btrim(buyer_name)) between 1 and 100),
  buyer_phone text not null check (char_length(btrim(buyer_phone)) between 7 and 30),
  buyer_email text not null check (char_length(btrim(buyer_email)) between 3 and 320),
  seller_contact text not null check (char_length(btrim(seller_contact)) between 1 and 500),
  vehicle_address text not null check (char_length(btrim(vehicle_address)) between 1 and 500),
  preferred_date date not null,
  preferred_time time not null,
  urgency text not null
    check (urgency in ('today', '24_48_hours', 'this_week', 'flexible')),
  notes text not null default '' check (char_length(notes) <= 4000),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_requests_listing_vehicle_fk
    foreign key (listing_id, vehicle_id)
    references public.listings (id, vehicle_id)
    on delete restrict,
  constraint inspection_requests_report_context_fk
    foreign key (report_id, listing_id, vehicle_id)
    references public.reports (id, listing_id, vehicle_id)
    on delete set null (report_id)
);

create index inspection_requests_listing_id_idx
  on public.inspection_requests (listing_id);
create index inspection_requests_vehicle_id_idx
  on public.inspection_requests (vehicle_id);
create index inspection_requests_report_id_idx
  on public.inspection_requests (report_id)
  where report_id is not null;
create index inspection_requests_status_created_at_idx
  on public.inspection_requests (request_status, created_at)
  where request_status not in ('completed', 'cancelled', 'unavailable');

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (char_length(btrim(topic)) between 1 and 150),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 100),
  customer_email text not null check (char_length(btrim(customer_email)) between 3 and 320),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  message_status text not null default 'new'
    check (message_status in ('new', 'in_progress', 'resolved', 'spam')),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contact_messages_open_created_at_idx
  on public.contact_messages (created_at)
  where message_status in ('new', 'in_progress');

create trigger vehicles_set_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

create trigger listings_set_updated_at
before update on public.listings
for each row execute function public.set_updated_at();

create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create trigger inspection_requests_set_updated_at
before update on public.inspection_requests
for each row execute function public.set_updated_at();

create trigger contact_messages_set_updated_at
before update on public.contact_messages
for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;
alter table public.vehicles force row level security;
alter table public.listings enable row level security;
alter table public.listings force row level security;
alter table public.reports enable row level security;
alter table public.reports force row level security;
alter table public.inspection_requests enable row level security;
alter table public.inspection_requests force row level security;
alter table public.contact_messages enable row level security;
alter table public.contact_messages force row level security;

-- Explicit deny policies document the no-auth posture. PostgreSQL combines
-- permissive policies with OR, so future access must be added deliberately.
create policy vehicles_deny_public
  on public.vehicles as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy listings_deny_public
  on public.listings as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy reports_deny_public
  on public.reports as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy inspection_requests_deny_public
  on public.inspection_requests as restrictive for all to anon, authenticated
  using (false) with check (false);
create policy contact_messages_deny_public
  on public.contact_messages as restrictive for all to anon, authenticated
  using (false) with check (false);

revoke all on table
  public.vehicles,
  public.listings,
  public.reports,
  public.inspection_requests,
  public.contact_messages
from anon, authenticated;

grant all on table
  public.vehicles,
  public.listings,
  public.reports,
  public.inspection_requests,
  public.contact_messages
to service_role;

comment on table public.vehicles is
  'Normalized vehicle identity; separate from future scraped vehicle-knowledge data.';
comment on table public.listings is
  'Submitted listing content, seller claims, listing-specific facts, and normalization state.';
comment on table public.reports is
  'Versioned canonical structured reports for reuse across web, PDF, email, and review.';
comment on table public.inspection_requests is
  'Sensitive customer requests for optional vehicle inspections.';
comment on table public.contact_messages is
  'Sensitive customer support/contact messages.';
