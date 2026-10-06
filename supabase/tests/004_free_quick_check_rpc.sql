-- Run after all migrations with psql. The transaction always rolls back.
begin;

do $free_quick_check_rpc_security$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'free_quick_check_knowledge'
  ) then
    raise exception 'Free Quick Check RPC is missing';
  end if;

  if has_function_privilege('anon', 'public.free_quick_check_knowledge(uuid,uuid,text,text,bigint,char)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.free_quick_check_knowledge(uuid,uuid,text,text,bigint,char)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.free_quick_check_knowledge(uuid,uuid,text,text,bigint,char)', 'EXECUTE') then
    raise exception 'Free Quick Check RPC privileges are not service-role-only';
  end if;
end;
$free_quick_check_rpc_security$;

rollback;
