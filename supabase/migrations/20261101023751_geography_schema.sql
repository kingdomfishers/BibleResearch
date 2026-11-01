-- Additive biblical geography schema: sources, places, place_locations, passage_geography, and verse_geography.
-- Reuses existing public.verses(id) and public.chronology_events(id) without altering original-language or chronology tables.

create table public.geography_sources (
  id bigint generated always as identity primary key,
  source_key text not null unique,
  dataset text not null,
  version text not null,
  locator text not null,
  sha256 text,
  license text not null,
  attribution text not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  published boolean not null default true
);

create table public.places (
  id bigint generated always as identity primary key,
  place_key text not null unique,
  biblical_name text not null,
  historical_names text[] not null default '{}',
  hebrew_name text,
  greek_name text,
  strongs_numbers text[] not null default '{}',
  place_type text not null,
  is_non_physical boolean not null default false,
  external_ids jsonb not null default '{}'::jsonb,
  primary_source_id bigint not null references public.geography_sources(id),
  source_info jsonb not null default '{}'::jsonb,
  published boolean not null default true
);
create index idx_places_biblical_name on public.places(biblical_name);
create index idx_places_primary_source on public.places(primary_source_id);
create index idx_places_strongs_gin on public.places using gin(strongs_numbers);
create index idx_places_external_ids_gin on public.places using gin(external_ids);

create table public.place_locations (
  id bigint generated always as identity primary key,
  location_key text not null unique,
  place_id bigint not null references public.places(id),
  rank_order smallint not null default 1 check (rank_order >= 1),
  modern_name text not null,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  geometry jsonb,
  bbox double precision[] check (bbox is null or cardinality(bbox) = 4),
  precision_kind text not null check (precision_kind in ('point', 'site_area', 'approximate_region', 'route', 'none')),
  location_status text not null check (location_status in ('established', 'probable', 'disputed', 'regional_only', 'unknown')),
  confidence_label text not null,
  raw_source_score jsonb not null default '{}'::jsonb,
  is_alternative boolean not null default false,
  evidence_summary text not null,
  source_citations jsonb not null default '[]'::jsonb,
  source_id bigint not null references public.geography_sources(id),
  published boolean not null default true
);
create index idx_place_locations_place_rank on public.place_locations(place_id, rank_order, id);
create index idx_place_locations_source on public.place_locations(source_id);

create table public.passage_geography (
  id bigint generated always as identity primary key,
  passage_key text not null unique,
  title text not null,
  book smallint not null check (book between 1 and 66),
  start_chapter smallint not null check (start_chapter between 1 and 150),
  start_verse smallint not null check (start_verse between 0 and 176),
  end_chapter smallint not null check (end_chapter between 1 and 150),
  end_verse smallint not null check (end_verse between 0 and 176),
  place_id bigint references public.places(id),
  relationship_type text not null check (relationship_type in ('event_location', 'contextual_location', 'mentioned_location', 'travel_origin', 'travel_destination', 'uncertain_location')),
  resolution_tier smallint not null check (resolution_tier between 2 and 4),
  confidence_level text not null check (confidence_level in ('established', 'probable', 'disputed', 'regional', 'symbolic_non_physical', 'unknown')),
  evidence_refs text not null,
  evidence_explanation text not null,
  chronology_event_id bigint references public.chronology_events(id),
  source_id bigint not null references public.geography_sources(id),
  published boolean not null default true,
  check ((start_chapter, start_verse) <= (end_chapter, end_verse))
);
create index idx_passage_geography_range on public.passage_geography(book, start_chapter, start_verse, end_chapter, end_verse);
create index idx_passage_geography_place on public.passage_geography(place_id);
create index idx_passage_geography_event on public.passage_geography(chronology_event_id);
create index idx_passage_geography_source on public.passage_geography(source_id);

create table public.verse_geography (
  id bigint generated always as identity primary key,
  verse_id integer not null references public.verses(id),
  place_id bigint not null references public.places(id),
  relationship_type text not null check (relationship_type in ('event_location', 'contextual_location', 'mentioned_location', 'travel_origin', 'travel_destination', 'uncertain_location')),
  resolution_tier smallint not null check (resolution_tier between 1 and 4),
  is_inferred boolean not null default false,
  confidence_level text not null check (confidence_level in ('established', 'probable', 'disputed', 'regional', 'symbolic_non_physical', 'unknown')),
  evidence_ref text not null,
  evidence_explanation text not null,
  establishing_passage_id bigint references public.passage_geography(id),
  chronology_event_id bigint references public.chronology_events(id),
  source_id bigint not null references public.geography_sources(id),
  verification_origin text not null default 'verified_source' check (verification_origin in ('verified_source', 'curated_passage', 'ai_candidate')),
  published boolean not null default true,
  check (not published or verification_origin <> 'ai_candidate'),
  unique (verse_id, place_id, relationship_type)
);
create index idx_verse_geography_verse_tier on public.verse_geography(verse_id, resolution_tier, id);
create index idx_verse_geography_place on public.verse_geography(place_id);
create index idx_verse_geography_passage on public.verse_geography(establishing_passage_id);
create index idx_verse_geography_event on public.verse_geography(chronology_event_id);
create index idx_verse_geography_source on public.verse_geography(source_id);

do $security$
declare tab text;
begin
  foreach tab in array array['geography_sources', 'places', 'place_locations', 'passage_geography', 'verse_geography'] loop
    execute format('alter table public.%I enable row level security', tab);
    execute format('revoke all on public.%I from public, anon, authenticated', tab);
    execute format('grant select on public.%I to anon, authenticated', tab);
    execute format('create policy published_read on public.%I for select to anon, authenticated using (published)', tab);
  end loop;
end $security$;
