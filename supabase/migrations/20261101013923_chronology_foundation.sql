-- Additive chronology metadata. Original-language tables and legacy RPCs are unchanged.
create table public.chronology_sources (
  id bigint generated always as identity primary key,
  source_key text not null unique,
  dataset text not null, version text not null, locator text not null,
  sha256 text, license text not null, attribution text not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  published boolean not null default false
);
create table public.chronology_models (
  id text primary key,
  name text not null, assumptions jsonb not null default '{}'::jsonb,
  adam_year integer, resurrection_year integer,
  published boolean not null default false
);
create table public.chronology_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  source_id bigint not null references public.chronology_sources(id),
  title text not null, start_year integer not null,
  original_date text not null, duration text, range_flag boolean not null default false,
  raw_metadata jsonb not null default '{}'::jsonb,
  published boolean not null default false
);
create index on public.chronology_events(source_id);
create table public.chronology_event_links (
  event_id bigint not null references public.chronology_events(id),
  verse_id integer not null references public.verses(id),
  relationship text not null check(relationship in ('setting','mention','retrospective','prophetic','uncertain')),
  mapping jsonb not null,
  primary key(event_id,verse_id)
);
create index on public.chronology_event_links(verse_id,event_id);
create table public.chronology_assertions (
  id bigint generated always as identity primary key,
  assertion_key text not null unique,
  model_id text not null references public.chronology_models(id),
  verse_id integer references public.verses(id),
  event_id bigint references public.chronology_events(id),
  source_id bigint not null references public.chronology_sources(id),
  axis text not null check(axis in ('source_placement','setting','composition','mentioned_event')),
  earliest_year integer not null, latest_year integer not null, preferred_year integer,
  precision text not null check(precision in ('source_year','approximate','range','source_calendar_day')),
  method text not null, rationale text not null, author text not null,
  review_status text not null check(review_status in ('source_import','model_assumption','reviewed','candidate')),
  published boolean not null default false,
  supersedes bigint references public.chronology_assertions(id),
  mapping jsonb not null default '{}'::jsonb,
  check(verse_id is not null or event_id is not null),
  check(earliest_year <= latest_year),
  check(preferred_year is null or preferred_year between earliest_year and latest_year),
  check(not published or review_status <> 'candidate'),
  unique(id,model_id)
);
create index on public.chronology_assertions(model_id,verse_id,id);
create index on public.chronology_assertions(verse_id,id);
create index on public.chronology_assertions(event_id);
create index on public.chronology_assertions(source_id);
create index on public.chronology_assertions(supersedes);
create table public.chronology_evidence (
  id bigint generated always as identity primary key,
  evidence_key text not null unique,
  source_id bigint not null references public.chronology_sources(id),
  category text not null check(category in ('textual','archaeological','model_premise','scholarly_interpretation')),
  title text not null, citation text not null, locator text not null,
  summary text not null, dating_method text not null, scope text not null,
  uncertainty text not null, provenance jsonb not null default '{}'::jsonb,
  object_year integer, event_year integer,
  review_status text not null check(review_status in ('source_import','model_assumption','reviewed','candidate')),
  published boolean not null default false,
  check(not published or review_status <> 'candidate')
);
create index on public.chronology_evidence(source_id);
create table public.chronology_assertion_evidence (
  assertion_id bigint not null references public.chronology_assertions(id),
  evidence_id bigint not null references public.chronology_evidence(id),
  relationship text not null check(relationship in ('supporting','challenging','contextual')),
  applicability text not null check(applicability in ('direct','inherited')),
  explanation text not null,
  primary key(assertion_id,evidence_id)
);
create index on public.chronology_assertion_evidence(evidence_id);

-- Published rows are readable; public clients receive no data modification rights.
do $security$
declare tab text;
begin
  foreach tab in array array['sources','models','events','assertions','evidence'] loop
    execute format('alter table public.chronology_%I enable row level security', tab);
    execute format('revoke all on public.chronology_%I from public, anon, authenticated', tab);
    execute format('grant select on public.chronology_%I to anon, authenticated', tab);
    execute format('create policy published_read on public.chronology_%I for select to anon, authenticated using (published)', tab);
  end loop;
end $security$;
alter table public.chronology_event_links enable row level security;
alter table public.chronology_assertion_evidence enable row level security;
revoke all on public.chronology_event_links, public.chronology_assertion_evidence from public, anon, authenticated;
grant select on public.chronology_event_links, public.chronology_assertion_evidence to anon, authenticated;
create policy published_read on public.chronology_event_links for select to anon, authenticated
 using(exists(select 1 from public.chronology_events e where e.id=event_id and e.published));
create policy published_read on public.chronology_assertion_evidence for select to anon, authenticated
 using(exists(select 1 from public.chronology_assertions a where a.id=assertion_id and a.published)
   and exists(select 1 from public.chronology_evidence e where e.id=evidence_id and e.published));
