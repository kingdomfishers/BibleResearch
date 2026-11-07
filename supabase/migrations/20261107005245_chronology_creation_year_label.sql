-- CHRON-01 Dual date display: BC/AD date and years after creation (Adam 0, Jesus death and resurrection 4000)
create or replace function public.chronology_year_label(y integer) returns text
language sql immutable strict security invoker set search_path='' as $$
 select case
   when y <= 0 then (1::bigint - y)::text || ' BC (Year ' || (y + 3970)::text || ')'
   else 'AD ' || y::text || ' (Year ' || (y + 3970)::text || ')'
 end
$$;

revoke all on function public.chronology_year_label(integer) from public;
grant execute on function public.chronology_year_label(integer) to anon,authenticated,service_role;

notify pgrst, 'reload schema';

-- ROLLBACK:
-- create or replace function public.chronology_year_label(y integer) returns text
-- language sql immutable strict security invoker set search_path='' as $$
--  select case when y<=0 then (1::bigint-y)::text||' BC' else 'AD '||y::text end
-- $$;
-- revoke all on function public.chronology_year_label(integer) from public;
-- grant execute on function public.chronology_year_label(integer) to anon,authenticated,service_role;
-- notify pgrst, 'reload schema';
