-- Migration: 20261106103000_fix_gloss_reference_coupling_rpc.sql
-- Description: Fix gloss-reference coupling in lookup_lemma_english_glosses_v1 (F2)
-- Replaces independent min(verse_id) and min(source_ref) with coherent row-level pairing (first_occ).
-- Guarantees sample_passage.source_ref matches sample_passage.book, chapter, and verse 100% of the time.

CREATE OR REPLACE FUNCTION public.lookup_lemma_english_glosses_v1(
  p_lemma_query text,
  p_limit integer default 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET statement_timeout = '8s'
AS $$
DECLARE
  v_q text := btrim(coalesce(p_lemma_query, ''));
  v_base_strongs text := case
    when v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      then upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    else null
  end;
  v_stripped text := regexp_replace(normalize(v_q, NFKD), '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־]', '', 'g');
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_lemma record;
  v_packet jsonb;
BEGIN
  if v_q = '' then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'Provide p_lemma_query.');
  end if;

  select lem.*
  into v_lemma
  from public.lemmas lem
  where lower(lem.lemma_key) = lower(v_q)
     or lower(lem.lemma_key) = 'lemma:' || lower(v_q)
     or (v_base_strongs is not null and upper(coalesce(lem.base_strongs, '')) = v_base_strongs)
     or lem.lemma_script = v_q
     or (v_stripped <> '' and lem.lemma_stripped = v_stripped)
     or lower(lem.transliteration) = lower(v_q)
     or exists (
       select 1 from public.lexemes lx
       where lx.lemma_id = lem.id and upper(lx.extended_strongs) = upper(v_q)
     )
  order by
    case
      when lower(lem.lemma_key) = lower(v_q) or lower(lem.lemma_key) = 'lemma:' || lower(v_q) then 0
      when exists (select 1 from public.lexemes lx where lx.id = lem.primary_lexeme_id and upper(lx.extended_strongs) = upper(v_q)) then 1
      when v_base_strongs is not null and upper(coalesce(lem.base_strongs, '')) = v_base_strongs then 2
      else 3
    end,
    lem.id
  limit 1;

  if v_lemma.id is null then
    return jsonb_build_object('schema_version', 1, 'status', 'not_found');
  end if;

  with stem_forms as materialized (
    select distinct wfl.word_id
    from public.word_form_lemmas wfl
    where wfl.lemma_id = v_lemma.id and wfl.morpheme_role = 'stem'
  ),
  occ as materialized (
    select
      s.verse_id,
      s.word_id,
      btrim(s.source_english) as raw_english,
      s.source_name,
      s.source_commit,
      s.source_ref
    from stem_forms sf
    join public.verse_translation_sources s on s.word_id = sf.word_id
  ),
  first_occ as (
    -- Deterministic earliest occurrence per attested gloss (guarantees coherent verse and citation)
    select distinct on (o.raw_english)
      o.raw_english,
      o.verse_id,
      o.source_ref,
      o.source_name,
      o.source_commit
    from occ o
    where o.raw_english <> ''
    order by o.raw_english, o.verse_id, o.source_ref
  ),
  grouped_glosses as (
    select
      o.raw_english as attested_gloss,
      public.reader_usage_label_v1(coalesce(v_lemma.base_strongs, ''), o.raw_english) as normalized_usage_group,
      count(*)::integer as token_count,
      count(distinct o.verse_id)::integer as verse_count,
      count(distinct o.word_id)::integer as inflected_form_count,
      fo.verse_id as sample_verse_id,
      fo.source_ref as sample_source_ref,
      fo.source_name as source_name,
      fo.source_commit as source_commit
    from occ o
    join first_occ fo on fo.raw_english = o.raw_english
    where o.raw_english <> ''
    group by o.raw_english, fo.verse_id, fo.source_ref, fo.source_name, fo.source_commit
    order by count(*) desc, o.raw_english asc
    limit v_limit
  )
  select jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'modeling_invariants', jsonb_build_object(
      'lexical_sense_is_not_english_translation', true,
      'translation_is_not_word_for_word_alignment', true
    ),
    'lemma', jsonb_build_object(
      'lemma_key', v_lemma.lemma_key,
      'language', v_lemma.language,
      'lemma_script', v_lemma.lemma_script,
      'transliteration', v_lemma.transliteration,
      'primary_pos', v_lemma.primary_pos,
      'base_strongs', v_lemma.base_strongs
    ),
    'lexicon_sense_glosses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sense_key', ls.sense_key,
        'sense_code', ls.sense_code,
        'short_gloss', ls.short_gloss,
        'source_attribution', ls.source_attribution,
        'source_edition_key', se.edition_key,
        'source_record_id', ls.source_record_id
      ) order by ls.sense_order, ls.id)
      from public.lexical_senses ls
      join public.source_editions se on se.id = ls.source_edition_id
      where ls.lemma_id = v_lemma.id
    ), '[]'::jsonb),
    'corpus_rendering_summary', jsonb_build_object(
      'total_attested_tokens', (select count(*) from occ),
      'distinct_attested_english_strings', (select count(distinct raw_english) from occ where raw_english <> ''),
      'untranslated_grammatical_tokens', (select count(*) from occ where raw_english = '')
    ),
    'attested_english_glosses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attested_gloss', gg.attested_gloss,
        'usage_group', gg.normalized_usage_group,
        'token_count', gg.token_count,
        'verse_count', gg.verse_count,
        'inflected_form_count', gg.inflected_form_count,
        'sample_passage', jsonb_build_object(
          'book', v.book,
          'book_name', b.name,
          'chapter', v.chapter,
          'verse', v.verse_nr,
          'source_ref', gg.sample_source_ref
        ),
        'source_dataset', gg.source_name,
        'source_commit', gg.source_commit
      ) order by gg.token_count desc, gg.attested_gloss asc)
      from grouped_glosses gg
      join public.verses v on v.id = gg.sample_verse_id
      join public.books b on b.id = v.book
    ), '[]'::jsonb)
  )
  into v_packet;

  return v_packet;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_lemma_english_glosses_v1(text, integer) TO anon, authenticated;
