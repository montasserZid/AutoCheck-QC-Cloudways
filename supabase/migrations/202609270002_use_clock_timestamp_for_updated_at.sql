-- clock_timestamp() advances even when a database client batches statements.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
