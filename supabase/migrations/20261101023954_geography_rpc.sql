-- Context-aware biblical geography RPCs: public.get_verse_geography and compatibility wrapper public."getVerseGeography".
-- Executes 5-tier deterministic geographical context resolution natively in PostgreSQL under RLS.

create or replace function public.get_verse_geography(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '5s'
as $rpc$
declare
  vid integer;
  locations_json jsonb;
  passages_json jsonb;
  sources_json jsonb;
  bounds_json jsonb;
  res_status text;
  top_tier smallint;
  has_physical boolean;
  has_non_physical boolean;
  response jsonb;
begin
  if p_book is null or p_chapter is null or p_verse is null
     or p_book not between 1 and 66
     or p_chapter not between 1 and 150
     or p_verse not between 0 and 176 then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_reference');
  end if;

  select v.id into vid
  from public.verses v
  where v.book = p_book::smallint and v.chapter = p_chapter::smallint and v.verse_nr = p_verse::smallint;

  if vid is null then
    return jsonb_build_object('schema_version', 1, 'status', 'passage_not_found');
  end if;

  with active_passages as materialized (
    select
      pg.id as passage_id,
      pg.passage_key,
      pg.title,
      pg.book,
      pg.start_chapter,
      pg.start_verse,
      pg.end_chapter,
      pg.end_verse,
      pg.place_id,
      pg.relationship_type,
      pg.resolution_tier,
      pg.confidence_level,
      pg.evidence_refs,
      pg.evidence_explanation,
      pg.source_id,
      ((pg.end_chapter - pg.start_chapter) * 200 + (pg.end_verse - pg.start_verse)) as span_length
    from public.passage_geography pg
    where pg.published
      and pg.book = p_book::smallint
      and (pg.start_chapter, pg.start_verse) <= (p_chapter::smallint, p_verse::smallint)
      and (p_chapter::smallint, p_verse::smallint) <= (pg.end_chapter, pg.end_verse)
    order by pg.resolution_tier asc, span_length asc, pg.id asc
    limit 6
  ),
  direct_links as materialized (
    select
      vg.id as link_id,
      vg.place_id,
      vg.relationship_type,
      vg.resolution_tier,
      vg.is_inferred,
      vg.confidence_level,
      vg.evidence_ref,
      vg.evidence_explanation,
      coalesce(vg.establishing_passage_id, ap.passage_id) as passage_id,
      coalesce(ap.title, null) as passage_title,
      coalesce(ap.evidence_refs, vg.evidence_ref) as establishing_refs,
      vg.source_id,
      1 as source_priority
    from public.verse_geography vg
    left join active_passages ap on ap.place_id = vg.place_id
    where vg.verse_id = vid and vg.published
  ),
  inherited_links as materialized (
    select
      null::bigint as link_id,
      ap.place_id,
      ap.relationship_type,
      ap.resolution_tier,
      true as is_inferred,
      ap.confidence_level,
      ap.evidence_refs as evidence_ref,
      ap.evidence_explanation,
      ap.passage_id,
      ap.title as passage_title,
      ap.evidence_refs as establishing_refs,
      ap.source_id,
      2 as source_priority
    from active_passages ap
    where ap.place_id is not null
      and not exists (
        select 1 from direct_links dl
        where dl.place_id = ap.place_id
          and dl.relationship_type in ('event_location', 'contextual_location', 'travel_origin', 'travel_destination')
      )
  ),
  combined_candidates as materialized (
    select * from direct_links
    union all
    select * from inherited_links
  ),
  deduped_places as materialized (
    select distinct on (cc.place_id)
      cc.place_id,
      cc.relationship_type,
      cc.resolution_tier,
      cc.is_inferred,
      cc.confidence_level,
      cc.evidence_ref,
      cc.evidence_explanation,
      cc.passage_id,
      cc.passage_title,
      cc.establishing_refs,
      cc.source_id
    from combined_candidates cc
    order by
      cc.place_id,
      case cc.relationship_type
        when 'travel_origin' then 1
        when 'travel_destination' then 2
        when 'event_location' then 3
        when 'contextual_location' then 4
        when 'uncertain_location' then 5
        else 6
      end asc,
      cc.source_priority asc,
      cc.resolution_tier asc
  ),
  hydrated_places as materialized (
    select
      dp.place_id,
      p.place_key,
      p.biblical_name,
      p.historical_names,
      p.hebrew_name,
      p.greek_name,
      p.strongs_numbers,
      p.place_type,
      p.is_non_physical,
      p.external_ids,
      dp.relationship_type,
      dp.resolution_tier,
      dp.is_inferred,
      dp.confidence_level,
      dp.evidence_ref,
      dp.evidence_explanation,
      dp.passage_title,
      dp.establishing_refs,
      gs.dataset as source_dataset,
      gs.license as source_license,
      gs.attribution as source_attribution,
      primary_loc.id as primary_location_id,
      primary_loc.modern_name,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.latitude end as latitude,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.longitude end as longitude,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.geometry end as geometry,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.bbox end as bbox,
      case
        when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then 'none'
        when dp.confidence_level = 'regional' then 'approximate_region'
        else coalesce(primary_loc.precision_kind, 'none')
      end as precision_kind,
      case
        when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then 'unknown'
        when dp.confidence_level = 'regional' and primary_loc.location_status = 'established' then 'regional_only'
        else coalesce(primary_loc.location_status, 'unknown')
      end as location_status,
      coalesce(primary_loc.confidence_label, 'Symbolic or unknown location') as confidence_label,
      coalesce(primary_loc.raw_source_score, '{}'::jsonb) as raw_source_score,
      coalesce(primary_loc.evidence_summary, dp.evidence_explanation) as identification_evidence,
      coalesce(primary_loc.source_citations, '[]'::jsonb) as source_citations,
      coalesce(alts.alternatives, '[]'::jsonb) as alternative_locations,
      case dp.relationship_type
        when 'event_location' then 1
        when 'contextual_location' then 2
        when 'travel_origin' then 3
        when 'travel_destination' then 4
        when 'uncertain_location' then 5
        else 6
      end as role_rank
    from deduped_places dp
    join public.places p on p.id = dp.place_id and p.published
    join public.geography_sources gs on gs.id = dp.source_id and gs.published
    left join lateral (
      select pl.*
      from public.place_locations pl
      where pl.place_id = p.id and pl.published
      order by pl.rank_order asc, pl.id asc
      limit 1
    ) primary_loc on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', pl.id::text,
          'rank_order', pl.rank_order,
          'modern_name', pl.modern_name,
          'latitude', pl.latitude,
          'longitude', pl.longitude,
          'geometry', pl.geometry,
          'bbox', pl.bbox,
          'precision_kind', pl.precision_kind,
          'location_status', pl.location_status,
          'confidence_label', pl.confidence_label,
          'raw_source_score', pl.raw_source_score,
          'is_alternative', pl.is_alternative,
          'evidence_summary', pl.evidence_summary,
          'source_citations', pl.source_citations
        ) order by pl.rank_order asc, pl.id asc
      ) as alternatives
      from public.place_locations pl
      where pl.place_id = p.id and pl.published and pl.rank_order > 1
    ) alts on true
    order by role_rank asc, dp.resolution_tier asc, p.biblical_name asc
    limit 12
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'place_id', hp.place_id::text,
        'place_key', hp.place_key,
        'biblical_name', hp.biblical_name,
        'historical_names', hp.historical_names,
        'hebrew_name', hp.hebrew_name,
        'greek_name', hp.greek_name,
        'strongs_numbers', hp.strongs_numbers,
        'place_type', hp.place_type,
        'is_non_physical', hp.is_non_physical,
        'modern_name', hp.modern_name,
        'latitude', hp.latitude,
        'longitude', hp.longitude,
        'geometry', hp.geometry,
        'bbox', hp.bbox,
        'precision_kind', hp.precision_kind,
        'relationship_type', hp.relationship_type,
        'resolution_tier', hp.resolution_tier,
        'is_inferred', hp.is_inferred,
        'confidence_level', hp.confidence_level,
        'location_status', hp.location_status,
        'confidence_label', hp.confidence_label,
        'raw_source_score', hp.raw_source_score,
        'evidence_ref', hp.evidence_ref,
        'establishing_refs', hp.establishing_refs,
        'passage_title', hp.passage_title,
        'evidence_explanation', hp.evidence_explanation,
        'identification_evidence', hp.identification_evidence,
        'external_ids', hp.external_ids,
        'source_citations', hp.source_citations,
        'source', jsonb_build_object(
          'dataset', hp.source_dataset,
          'license', hp.source_license,
          'attribution', hp.source_attribution
        ),
        'alternative_locations', hp.alternative_locations
      ) order by hp.role_rank asc, hp.resolution_tier asc, hp.biblical_name asc
    ), '[]'::jsonb),
    coalesce(min(hp.resolution_tier) filter (where hp.relationship_type <> 'mentioned_location'), min(hp.resolution_tier)),
    bool_or(not hp.is_non_physical and (hp.latitude is not null or hp.geometry is not null)),
    bool_or(hp.is_non_physical or hp.confidence_level = 'symbolic_non_physical'),
    case
      when count(*) filter (where not hp.is_non_physical and hp.latitude is not null and hp.longitude is not null) > 0 then
        jsonb_build_array(
          min(coalesce(hp.bbox[1], hp.longitude)) filter (where not hp.is_non_physical and hp.longitude is not null),
          min(coalesce(hp.bbox[2], hp.latitude)) filter (where not hp.is_non_physical and hp.latitude is not null),
          max(coalesce(hp.bbox[3], hp.longitude)) filter (where not hp.is_non_physical and hp.longitude is not null),
          max(coalesce(hp.bbox[4], hp.latitude)) filter (where not hp.is_non_physical and hp.latitude is not null)
        )
      else null
    end
  into locations_json, top_tier, has_physical, has_non_physical, bounds_json
  from hydrated_places hp;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'passage_key', pg.passage_key,
      'title', pg.title,
      'book', pg.book,
      'start_chapter', pg.start_chapter,
      'start_verse', pg.start_verse,
      'end_chapter', pg.end_chapter,
      'end_verse', pg.end_verse,
      'relationship_type', pg.relationship_type,
      'resolution_tier', pg.resolution_tier,
      'confidence_level', pg.confidence_level,
      'evidence_refs', pg.evidence_refs,
      'evidence_explanation', pg.evidence_explanation
    ) order by pg.resolution_tier asc, pg.id asc
  ), '[]'::jsonb)
  into passages_json
  from public.passage_geography pg
  where pg.published
    and pg.book = p_book::smallint
    and (pg.start_chapter, pg.start_verse) <= (p_chapter::smallint, p_verse::smallint)
    and (p_chapter::smallint, p_verse::smallint) <= (pg.end_chapter, pg.end_verse);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'source_key', gs.source_key,
      'dataset', gs.dataset,
      'version', gs.version,
      'license', gs.license,
      'attribution', gs.attribution,
      'locator', gs.locator
    ) order by gs.id asc
  ), '[]'::jsonb)
  into sources_json
  from public.geography_sources gs
  where gs.published;

  res_status := case
    when coalesce(has_physical, false) then
      case top_tier
        when 1 then 'direct_event_location'
        when 2 then 'passage_context'
        when 3 then 'event_metadata'
        else 'regional_context'
      end
    when coalesce(has_non_physical, false) then 'symbolic_non_physical'
    else 'unknown'
  end;

  response := jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'passage', jsonb_build_object(
      'book', p_book,
      'chapter', p_chapter,
      'verse', p_verse,
      'is_heading', p_verse = 0
    ),
    'resolution_status', res_status,
    'has_physical_location', coalesce(has_physical, false),
    'message', case
      when coalesce(has_physical, false) then null
      when coalesce(has_non_physical, false) then 'No reliable geographical location identified for this verse (symbolic or heavenly setting).'
      else 'No reliable geographical location identified for this verse.'
    end,
    'bounds', bounds_json,
    'locations', coalesce(locations_json, '[]'::jsonb),
    'passage_contexts', coalesce(passages_json, '[]'::jsonb),
    'sources', coalesce(sources_json, '[]'::jsonb)
  );

  if octet_length(response::text) > 51200 then
    return jsonb_build_object('schema_version', 1, 'status', 'packet_limit_exceeded');
  end if;

  return response;
end
$rpc$;

create or replace function public."getVerseGeography"(
  book integer,
  chapter integer,
  verse integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.get_verse_geography(book, chapter, verse);
$$;

revoke all on function public.get_verse_geography(integer, integer, integer) from public;
revoke all on function public."getVerseGeography"(integer, integer, integer) from public;
grant execute on function public.get_verse_geography(integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public."getVerseGeography"(integer, integer, integer) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
