create or replace function public.chronology_guard_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $guard$
declare doc jsonb; frozen boolean;
begin
  if tg_op='UPDATE' then raise exception 'Recreate draft associations instead of moving snapshot identities'; end if;
  doc := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name in ('chronology_assignments','chronology_assignment_assertions') then
    select r.published into frozen from public.chronology_runs r where r.id=(doc->>'run_id')::bigint;
  elsif tg_table_name='chronology_assertion_evidence' then
    select a.published into frozen from public.chronology_assertions a where a.id=(doc->>'assertion_id')::bigint;
  else
    select e.published into frozen from public.chronology_events e where e.id=(doc->>'event_id')::bigint;
  end if;
  if frozen then raise exception 'Published chronology associations are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $guard$;
create unique index chronology_one_revision_decision on public.chronology_revisions(proposal_key)
  where action in ('approved','rejected');
alter table public.chronology_assertions add foreign key(supersedes,model_id)
  references public.chronology_assertions(id,model_id);
