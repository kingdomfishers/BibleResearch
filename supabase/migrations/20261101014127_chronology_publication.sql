create table public.chronology_runs (
  id bigint generated always as identity primary key,
  model_id text not null references public.chronology_models(id),
  label text not null, created_at timestamptz not null default now(),
  published boolean not null default false,
  coverage jsonb not null default '{}'::jsonb,
  unique(id,model_id)
);
create index on public.chronology_runs(model_id,id);
create table public.chronology_active_runs (
  model_id text primary key references public.chronology_models(id),
  run_id bigint not null,
  foreign key(run_id,model_id) references public.chronology_runs(id,model_id)
);
create index on public.chronology_active_runs(run_id,model_id);
create table public.chronology_assignments (
  run_id bigint not null, model_id text not null,
  verse_id integer not null references public.verses(id),
  status text not null check(status in ('source_estimate','estimated','conflicting','unresolved')),
  primary key(run_id,verse_id), unique(run_id,verse_id,model_id),
  foreign key(run_id,model_id) references public.chronology_runs(id,model_id)
);
create index on public.chronology_assignments(verse_id,model_id);
create table public.chronology_assignment_assertions (
  run_id bigint not null, verse_id integer not null, model_id text not null,
  assertion_id bigint not null,
  primary key(run_id,verse_id,assertion_id),
  foreign key(run_id,verse_id,model_id) references public.chronology_assignments(run_id,verse_id,model_id),
  foreign key(assertion_id,model_id) references public.chronology_assertions(id,model_id)
);
create index on public.chronology_assignment_assertions(assertion_id,model_id);
create table public.chronology_revisions (
  id bigint generated always as identity primary key,
  proposal_key text not null, model_id text not null references public.chronology_models(id),
  parent_run_id bigint not null,
  action text not null check(action in ('proposed','approved','rejected')),
  actor text not null, created_at timestamptz not null default now(),
  payload jsonb not null,
  foreign key(parent_run_id,model_id) references public.chronology_runs(id,model_id),
  unique(proposal_key,action)
);
create index on public.chronology_revisions(model_id,parent_run_id);
alter table public.chronology_revisions enable row level security;
revoke all on public.chronology_revisions from public,anon,authenticated;
-- Candidate prompts and input material are private; RPC exposes published history only.
do $rls$
declare tab text;
begin
  foreach tab in array array['runs','active_runs','assignments','assignment_assertions'] loop
    execute format('alter table public.chronology_%I enable row level security',tab);
    execute format('revoke all on public.chronology_%I from public,anon,authenticated',tab);
    execute format('grant select on public.chronology_%I to anon,authenticated',tab);
  end loop;
end $rls$;
create policy published_read on public.chronology_runs for select to anon,authenticated using(published);
create policy published_read on public.chronology_active_runs for select to anon,authenticated
 using(exists(select 1 from public.chronology_runs r where r.id=run_id and r.published));
create policy published_read on public.chronology_assignments for select to anon,authenticated
 using(exists(select 1 from public.chronology_runs r where r.id=run_id and r.published));
create policy published_read on public.chronology_assignment_assertions for select to anon,authenticated
 using(exists(select 1 from public.chronology_runs r where r.id=run_id and r.published));

create function public.chronology_guard_immutable() returns trigger
language plpgsql security invoker set search_path='' as $guard$
begin
  if tg_table_name='chronology_revisions' then raise exception 'Revision history is append-only'; end if;
  if (to_jsonb(old)->>'published')::boolean then raise exception 'Published chronology rows are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $guard$;
revoke all on function public.chronology_guard_immutable() from public,anon,authenticated;
do $triggers$
declare tab text;
begin
  foreach tab in array array['sources','models','events','assertions','evidence','runs','revisions'] loop
    execute format('create trigger immutable before update or delete on public.chronology_%I for each row execute function public.chronology_guard_immutable()',tab);
  end loop;
end $triggers$;

create function public.chronology_guard_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $guard$
declare doc jsonb; frozen boolean;
begin
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
revoke all on function public.chronology_guard_snapshot() from public,anon,authenticated;
do $triggers$
declare tab text;
begin
  foreach tab in array array['assignments','assignment_assertions','assertion_evidence','event_links'] loop
    execute format('create trigger immutable before insert or update or delete on public.chronology_%I for each row execute function public.chronology_guard_snapshot()',tab);
  end loop;
end $triggers$;

-- Administrative publication only; every passage receives a status row atomically.
create function public.chronology_publish_run(p_model_id text,p_label text,p_activate boolean default true)
returns bigint language plpgsql security invoker set search_path='' as $publish$
declare rid bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('chronology:'||p_model_id,0));
  if not exists(select 1 from public.chronology_models where id=p_model_id and published) then
    raise exception 'Publish the model and all referenced content first';
  end if;
  if exists(select 1 from public.chronology_assertions a join public.chronology_sources s on s.id=a.source_id
    where a.model_id=p_model_id and a.published and not s.published) then
    raise exception 'An assertion source is unpublished';
  end if;
  insert into public.chronology_runs(model_id,label) values(p_model_id,p_label) returning id into rid;
  insert into public.chronology_assignments(run_id,model_id,verse_id,status)
  select rid,p_model_id,v.id,case
    when count(a.id) filter(where a.axis<>'mentioned_event')=0 then 'unresolved'
    when count(distinct (a.earliest_year,a.latest_year)) filter(where a.axis in ('setting','source_placement'))>1 then 'conflicting'
    when bool_or(a.review_status in ('model_assumption','reviewed')) then 'estimated'
    else 'source_estimate' end
  from public.verses v left join public.chronology_assertions a
    on a.verse_id=v.id and a.model_id=p_model_id and a.published
    and not exists(select 1 from public.chronology_assertions newer where newer.supersedes=a.id and newer.published and newer.model_id=p_model_id)
  group by v.id;
  insert into public.chronology_assignment_assertions(run_id,verse_id,model_id,assertion_id)
  select rid,a.verse_id,p_model_id,a.id from public.chronology_assertions a
  where a.model_id=p_model_id and a.published and a.verse_id is not null
    and not exists(select 1 from public.chronology_assertions newer where newer.supersedes=a.id and newer.published and newer.model_id=p_model_id);
  update public.chronology_runs set coverage=(select jsonb_build_object(
    'passages',count(*),'dated',count(*) filter(where status<>'unresolved'),
    'unresolved',count(*) filter(where status='unresolved'),'conflicting',count(*) filter(where status='conflicting'))
    from public.chronology_assignments where run_id=rid),published=true where id=rid;
  if p_activate then
    insert into public.chronology_active_runs(model_id,run_id) values(p_model_id,rid)
    on conflict(model_id) do update set run_id=excluded.run_id;
  end if;
  return rid;
end $publish$;
revoke all on function public.chronology_publish_run(text,text,boolean) from public,anon,authenticated;
grant execute on function public.chronology_publish_run(text,text,boolean) to service_role;
