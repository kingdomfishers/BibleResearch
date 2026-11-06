-- @file: supabase/migrations/20261105233000_canonical_lookup_rpcs.sql
-- @feature: canonical-lexical-evidence-db
-- @description: Seven deterministic caller-RLS PostgreSQL lookup RPCs for word->lemma->senses, lemma->occurrences, lemma->root relatives, lemma->English glosses, passage->tokens/morphology/syntax, concept->external properties/links, and entity->documented relationships.

-- ============================================================================
-- 1. ORIGINAL WORD -> LEMMA -> AVAILABLE SENSES
-- ============================================================================
create or replace function public.lookup_word_to_lemma_senses_v1(
  p_word_id integer default null,
  p_query text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_norm_strongs text := case
    when v_q is not null and v_q ~* '^[HG][0-9]+[A-Za-z]?$'
      then upper(regexp_replace(v_q, '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    else null
  end;
  v_stripped text := case
    when v_q is not null
      then regexp_replace(normalize(v_q, NFKD), '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־/]', '', 'g')
    else null
  end;
  v_ids integer[];
  v_words jsonb;
begin
  if p_word_id is null and v_q is null then
    return jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_word_id or p_query (surface word form, transliteration, or Strong''s code).'
    );
  end if;

  if p_word_id is not null then
    select array_agg(w.id order by w.id)
    into v_ids
    from public.words w
    where w.id = p_word_id;
  else
    select array_agg(sub.id order by sub.rk, sub.id)
    into v_ids
    from (
      select
        w.id,
        case
          when w.original_word = v_q then 1
          when lower(w.transliteration) = lower(v_q) then 2
          else 3
        end as rk
      from public.words w
      where w.original_word = v_q
         or (v_norm_strongs is not null and w.strongs_nr = v_norm_strongs)
         or lower(w.transliteration) = lower(v_q)
      order by rk, w.id
      limit 10
    ) sub;

    if coalesce(cardinality(v_ids), 0) = 0 and v_stripped is not null and length(v_stripped) >= 2 then
      select array_agg(sub.id order by sub.id)
      into v_ids
      from (
        select w.id
        from public.words w
        where regexp_replace(normalize(w.original_word, NFKD), '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־/]', '', 'g') = v_stripped
        order by w.id
        limit 10
      ) sub;
    end if;
  end if;

  with matched_words as materialized (
    select w.id, w.original_word, w.transliteration, w.strongs_nr, w.grammar_code, w.gematria
    from public.words w
    where v_ids is not null and w.id = any(v_ids)
    order by array_position(v_ids, w.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'word_id', mw.id,
    'surface_form', mw.original_word,
    'transliteration', mw.transliteration,
    'base_strongs', mw.strongs_nr,
    'grammar_code', mw.grammar_code,
    'decoded_grammar', public.decode_grammar_v1(mw.grammar_code),
    'gematria', mw.gematria,
    'morpheme_lemma_links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'component_order', wfl.component_order,
        'morpheme_role', wfl.morpheme_role,
        'morpheme_surface', wfl.morpheme_surface,
        'dstrongs_tag', wfl.dstrongs_tag,
        'observed_token_count', wfl.observed_token_count,
        'is_context_ambiguous', wfl.is_context_ambiguous,
        'origin_mode', wfl.origin_mode,
        'derivation_method', wfl.derivation_method,
        'source_record_id', wfl.source_record_id,
        'lemma', jsonb_build_object(
          'lemma_id', lem.id,
          'lemma_key', lem.lemma_key,
          'language', lem.language,
          'lemma_script', lem.lemma_script,
          'transliteration', lem.transliteration,
          'primary_pos', lem.primary_pos,
          'homograph_tag', lem.homograph_tag,
          'base_strongs', lem.base_strongs,
          'source_record_id', lem.source_record_id
        ),
        'available_senses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sense_key', ls.sense_key,
            'sense_code', ls.sense_code,
            'sense_order', ls.sense_order,
            'short_gloss', ls.short_gloss,
            'definition_text', ls.definition_text,
            'usage_note', ls.usage_note,
            'scripture_refs', ls.scripture_refs,
            'source_attribution', ls.source_attribution,
            'source_edition_key', se.edition_key,
            'source_record_id', ls.source_record_id
          ) order by ls.sense_order, ls.id)
          from public.lexical_senses ls
          join public.source_editions se on se.id = ls.source_edition_id
          where ls.lemma_id = lem.id
        ), '[]'::jsonb)
      ) order by wfl.component_order, wfl.observed_token_count desc, wfl.id)
      from public.word_form_lemmas wfl
      join public.lemmas lem on lem.id = wfl.lemma_id
      where wfl.word_id = mw.id
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  into v_words
  from matched_words mw;

  return jsonb_build_object(
    'schema_version', 1,
    'status', case when jsonb_array_length(v_words) > 0 then 'ok' else 'not_found' end,
    'modeling_invariants', jsonb_build_object(
      'word_form_is_not_lemma', true,
      'sense_assignment_policy', 'catalog_only_no_ai_inference'
    ),
    'word_forms', v_words
  );
end;
$$;

-- ============================================================================
-- 2. LEMMA -> ALL BIBLICAL OCCURRENCES (DETERMINISTICALLY PAGINATED)
-- ============================================================================
create or replace function public.lookup_lemma_occurrences_v1(
  p_lemma_query text,
  p_after_verse_id integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_q text := btrim(coalesce(p_lemma_query, ''));
  v_base_strongs text := case
    when v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      then upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    else null
  end;
  v_stripped text := regexp_replace(normalize(v_q, NFKD), '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־]', '', 'g');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_after int := greatest(coalesce(p_after_verse_id, 0), 0);
  v_lemma record;
  v_candidates jsonb;
  v_result jsonb;
begin
  if v_q = '' then
    return jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_lemma_query (e.g. "lemma:G3056", "H1254A", "G1510", or original headword).'
    );
  end if;

  with cands as (
    select
      lem.*,
      case
        when lower(lem.lemma_key) = lower(v_q) then 0
        when lower(lem.lemma_key) = 'lemma:' || lower(v_q) then 1
        when exists (
          select 1 from public.lexemes lx
          where lx.id = lem.primary_lexeme_id and upper(lx.extended_strongs) = upper(v_q)
        ) then 2
        when v_base_strongs is not null and upper(coalesce(lem.base_strongs, '')) = v_base_strongs then 3
        when lem.lemma_script = v_q then 4
        when lem.lemma_stripped = v_stripped then 5
        when lower(lem.transliteration) = lower(v_q) then 6
        else 9
      end as match_rank
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
    order by match_rank, lem.id
    limit 12
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'lemma_key', c.lemma_key,
      'language', c.language,
      'lemma_script', c.lemma_script,
      'transliteration', c.transliteration,
      'primary_pos', c.primary_pos,
      'homograph_tag', c.homograph_tag,
      'base_strongs', c.base_strongs
    ) order by c.match_rank, c.id), '[]'::jsonb)
  into v_candidates
  from cands c;

  if jsonb_array_length(v_candidates) = 0 then
    return jsonb_build_object('schema_version', 1, 'status', 'not_found', 'lemma_candidates', '[]'::jsonb);
  end if;

  select lem.*
  into v_lemma
  from public.lemmas lem
  where lem.lemma_key = (v_candidates->0->>'lemma_key');

  with lemma_forms as materialized (
    select distinct wfl.word_id, wfl.is_context_ambiguous, wfl.dstrongs_tag
    from public.word_form_lemmas wfl
    where wfl.lemma_id = v_lemma.id
      and wfl.morpheme_role = 'stem'
  ),
  all_occ as materialized (
    select
      s.verse_id,
      s.word_position,
      s.word_id,
      s.grammar_code,
      s.source_english,
      s.source_ref,
      lf.is_context_ambiguous,
      lf.dstrongs_tag
    from lemma_forms lf
    join public.verse_translation_sources s on s.word_id = lf.word_id
  ),
  paged as materialized (
    select
      ao.*,
      v.book,
      b.name as book_name,
      b.usfm,
      v.chapter,
      v.verse_nr,
      w.original_word as inflected_form,
      w.transliteration as inflected_transliteration
    from all_occ ao
    join public.verses v on v.id = ao.verse_id
    join public.books b on b.id = v.book
    join public.words w on w.id = ao.word_id
    where ao.verse_id > v_after
    order by ao.verse_id, ao.word_position
    limit v_limit
  )
  select jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'lemma', jsonb_build_object(
      'lemma_id', v_lemma.id,
      'lemma_key', v_lemma.lemma_key,
      'language', v_lemma.language,
      'lemma_script', v_lemma.lemma_script,
      'transliteration', v_lemma.transliteration,
      'primary_pos', v_lemma.primary_pos,
      'homograph_tag', v_lemma.homograph_tag,
      'base_strongs', v_lemma.base_strongs,
      'source_record_id', v_lemma.source_record_id
    ),
    'homograph_or_query_candidates', v_candidates,
    'totals', jsonb_build_object(
      'distinct_inflected_forms', (select count(distinct word_id) from lemma_forms),
      'total_tokens', (select count(*) from all_occ),
      'total_verses', (select count(distinct verse_id) from all_occ),
      'ambiguous_form_tokens', (select count(*) from all_occ where is_context_ambiguous)
    ),
    'pagination', jsonb_build_object(
      'after_verse_id', v_after,
      'limit', v_limit,
      'returned_count', (select count(*) from paged),
      'next_after_verse_id', case
        when exists (select 1 from all_occ where verse_id > coalesce((select max(verse_id) from paged), v_after))
          then (select max(verse_id) from paged)
        else null
      end
    ),
    'occurrences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'verse_id', p.verse_id,
        'book', p.book,
        'book_name', p.book_name,
        'usfm', p.usfm,
        'chapter', p.chapter,
        'verse', p.verse_nr,
        'word_position', p.word_position,
        'word_id', p.word_id,
        'inflected_form', p.inflected_form,
        'inflected_transliteration', p.inflected_transliteration,
        'grammar_code', p.grammar_code,
        'dstrongs_tag', p.dstrongs_tag,
        'attested_english_rendering', p.source_english,
        'source_ref', p.source_ref,
        'is_surface_form_homograph_ambiguous', p.is_context_ambiguous
      ) order by p.verse_id, p.word_position)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ============================================================================
-- 3. LEMMA -> DOCUMENTED ROOT RELATIVES (NON-SYNONYMOUS BY INVARIANT)
-- ============================================================================
create or replace function public.lookup_lemma_root_relatives_v1(
  p_lemma_query text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_q text := btrim(coalesce(p_lemma_query, ''));
  v_base_strongs text := case
    when v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      then upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    else null
  end;
  v_stripped text := regexp_replace(normalize(v_q, NFKD), '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־]', '', 'g');
  v_lemma record;
  v_roots jsonb;
  v_relatives jsonb;
begin
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

  with my_roots as materialized (
    select
      r.*,
      lrl.etymology_type as query_lemma_link_type,
      lrl.evidence_note as query_lemma_note,
      lrl.origin_mode,
      lrl.derivation_method,
      lrl.source_record_id as link_record_id
    from public.lemma_root_links lrl
    join public.lexical_roots r on r.id = lrl.root_id
    where lrl.lemma_id = v_lemma.id
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'root_key', mr.root_key,
        'language', mr.language,
        'root_script', mr.root_script,
        'transliteration', mr.transliteration,
        'root_kind', mr.root_kind,
        'lemma_to_root_relation', mr.query_lemma_link_type,
        'evidence_note', mr.query_lemma_note,
        'origin_mode', mr.origin_mode,
        'derivation_method', mr.derivation_method,
        'source_record_id', mr.link_record_id
      ) order by mr.root_key)
      from my_roots mr
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'root_key', mr.root_key,
        'relative_lemma_key', rel_lem.lemma_key,
        'language', rel_lem.language,
        'lemma_script', rel_lem.lemma_script,
        'transliteration', rel_lem.transliteration,
        'primary_pos', rel_lem.primary_pos,
        'base_strongs', rel_lem.base_strongs,
        'primary_lexeme_gloss', px.primary_gloss,
        'etymology_type', sib.etymology_type,
        'implies_synonymy', sib.implies_synonymy,
        'evidence_note', sib.evidence_note,
        'origin_mode', sib.origin_mode,
        'derivation_method', sib.derivation_method,
        'source_edition_key', se.edition_key,
        'source_record_id', sib.source_record_id
      ) order by mr.root_key, sib.etymology_type, rel_lem.lemma_key)
      from my_roots mr
      join public.lemma_root_links sib on sib.root_id = mr.id and sib.lemma_id <> v_lemma.id
      join public.lemmas rel_lem on rel_lem.id = sib.lemma_id
      left join public.lexemes px on px.id = rel_lem.primary_lexeme_id
      left join public.source_editions se on se.id = sib.source_edition_id
    ), '[]'::jsonb)
  into v_roots, v_relatives;

  return jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'modeling_invariants', jsonb_build_object(
      'lemma_is_not_necessarily_root', true,
      'root_is_not_a_meaning', true,
      'shared_root_implies_synonymy', false
    ),
    'lemma', jsonb_build_object(
      'lemma_key', v_lemma.lemma_key,
      'language', v_lemma.language,
      'lemma_script', v_lemma.lemma_script,
      'transliteration', v_lemma.transliteration,
      'primary_pos', v_lemma.primary_pos,
      'base_strongs', v_lemma.base_strongs
    ),
    'documented_roots', v_roots,
    'root_relatives', v_relatives
  );
end;
$$;

-- ============================================================================
-- 4. LEMMA -> ATTESTED ENGLISH GLOSSES (SEPARATED FROM LEXICAL SENSES)
-- ============================================================================
create or replace function public.lookup_lemma_english_glosses_v1(
  p_lemma_query text,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
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
begin
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
  grouped_glosses as (
    select
      o.raw_english as attested_gloss,
      public.reader_usage_label_v1(coalesce(v_lemma.base_strongs, ''), o.raw_english) as normalized_usage_group,
      count(*)::integer as token_count,
      count(distinct o.verse_id)::integer as verse_count,
      count(distinct o.word_id)::integer as inflected_form_count,
      min(o.verse_id) as sample_verse_id,
      min(o.source_ref) as sample_source_ref,
      min(o.source_name) as source_name,
      min(o.source_commit) as source_commit
    from occ o
    where o.raw_english <> ''
    group by o.raw_english
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
end;
$$;

-- ============================================================================
-- 5. PASSAGE -> TOKENS, MORPHOLOGY, VERSIFICATION & SYNTAX
-- ============================================================================
create or replace function public.lookup_passage_tokens_syntax_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer,
  p_edition_key text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_passage record;
  v_packet jsonb;
begin
  select v.id, v.book, v.chapter, v.verse_nr, b.name as book_name, b.usfm, b.original_language, b.testament
  into v_passage
  from public.verses v
  join public.books b on b.id = v.book
  where v.book = p_book and v.chapter = p_chapter and v.verse_nr = p_verse;

  if v_passage.id is null then
    return jsonb_build_object(
      'schema_version', 1,
      'status', 'passage_not_found',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
    );
  end if;

  select jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'passage', jsonb_build_object(
      'verse_id', v_passage.id,
      'book', v_passage.book,
      'book_name', v_passage.book_name,
      'usfm', v_passage.usfm,
      'chapter', v_passage.chapter,
      'verse', v_passage.verse_nr,
      'testament', v_passage.testament,
      'primary_language', v_passage.original_language
    ),
    'edition_passages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'edition_key', se.edition_key,
        'edition_title', se.title,
        'edition_ref', ep.edition_ref,
        'witness_tag', ep.witness_tag,
        'token_count', ep.token_count,
        'versification_scheme', se.versification_scheme,
        'source_record_id', ep.source_record_id
      ) order by se.id)
      from public.edition_passages ep
      join public.source_editions se on se.id = ep.edition_id
      where ep.canonical_verse_id = v_passage.id
        and (p_edition_key is null or se.edition_key = p_edition_key)
    ), '[]'::jsonb),
    'versification_mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from_edition_key', fe.edition_key,
        'from_ref', vm.from_ref,
        'to_edition_key', te.edition_key,
        'to_book', vm.to_book,
        'to_chapter', vm.to_chapter,
        'to_verse', vm.to_verse_nr,
        'to_ref', vm.to_ref,
        'mapping_kind', vm.mapping_kind,
        'origin_mode', vm.origin_mode,
        'derivation_method', vm.derivation_method,
        'source_record_id', vm.source_record_id
      ) order by vm.id)
      from public.versification_mappings vm
      join public.source_editions fe on fe.id = vm.from_edition_id
      join public.source_editions te on te.id = vm.to_edition_id
      where vm.canonical_verse_id = v_passage.id
    ), '[]'::jsonb),
    'english_editions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'edition_id', rev.edition_id,
        'text', rev.text,
        'alignment_note', ree.mapping_note
      ))
      from public.reader_english_verses rev
      join public.reader_english_editions ree on ree.id = rev.edition_id
      where rev.book = v_passage.book and rev.chapter = v_passage.chapter and rev.verse_nr = v_passage.verse_nr
    ), '[]'::jsonb),
    'tokens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'word_position', s.word_position,
        'word_id', s.word_id,
        'surface_form', w.original_word,
        'transliteration', w.transliteration,
        'base_strongs', w.strongs_nr,
        'grammar_code', s.grammar_code,
        'decoded_morphology', public.decode_grammar_v1(s.grammar_code),
        'attested_english_gloss', s.source_english,
        'source_name', s.source_name,
        'source_ref', s.source_ref,
        'source_commit', s.source_commit,
        'morphemes', case
          when exists (
            select 1 from public.token_morphemes tm
            where tm.verse_id = v_passage.id and tm.word_position = s.word_position
          ) then (
            select jsonb_agg(jsonb_build_object(
              'component_order', tm.component_order,
              'morpheme_role', tm.morpheme_role,
              'surface_form', tm.surface_form,
              'transliteration', tm.transliteration,
              'grammar_code', tm.grammar_code,
              'morpheme_gloss', tm.morpheme_gloss,
              'dstrongs_tag', tm.dstrongs_tag,
              'lemma_key', lem.lemma_key,
              'lemma_script', lem.lemma_script,
              'source_record_id', tm.source_record_id
            ) order by tm.component_order)
            from public.token_morphemes tm
            left join public.lemmas lem on lem.id = tm.lemma_id
            where tm.verse_id = v_passage.id and tm.word_position = s.word_position
          )
          else coalesce((
            select jsonb_agg(jsonb_build_object(
              'component_order', wfl.component_order,
              'morpheme_role', wfl.morpheme_role,
              'surface_form', wfl.morpheme_surface,
              'grammar_code', wfl.grammar_code,
              'dstrongs_tag', wfl.dstrongs_tag,
              'lemma_key', lem.lemma_key,
              'lemma_script', lem.lemma_script,
              'is_context_ambiguous', wfl.is_context_ambiguous,
              'source_record_id', wfl.source_record_id
            ) order by wfl.component_order, wfl.observed_token_count desc)
            from public.word_form_lemmas wfl
            left join public.lemmas lem on lem.id = wfl.lemma_id
            where wfl.word_id = s.word_id
          ), '[]'::jsonb)
        end
      ) order by s.word_position)
      from public.verse_translation_sources s
      join public.words w on w.id = s.word_id
      where s.verse_id = v_passage.id
    ), '[]'::jsonb),
    'syntax_nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'node_key', sn.node_key,
        'edition_key', se.edition_key,
        'node_type', sn.node_type,
        'start_word_position', sn.start_word_position,
        'end_word_position', sn.end_word_position,
        'head_word_position', sn.head_word_position,
        'syntactic_role', sn.syntactic_role,
        'grammar_summary', sn.grammar_summary,
        'source_record_id', sn.source_record_id
      ) order by sn.start_word_position, sn.id)
      from public.syntax_nodes sn
      join public.source_editions se on se.id = sn.edition_id
      where sn.verse_id = v_passage.id
        and (p_edition_key is null or se.edition_key = p_edition_key)
    ), '[]'::jsonb),
    'syntax_edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'edition_key', se.edition_key,
        'dependent_word_position', ed.dependent_word_position,
        'head_word_position', ed.head_word_position,
        'relation_type', ed.relation_type,
        'head_strongs', ed.head_strongs,
        'raw_relation_tag', ed.raw_relation_tag,
        'origin_mode', ed.origin_mode,
        'derivation_method', ed.derivation_method,
        'source_record_id', ed.source_record_id
      ) order by ed.dependent_word_position, ed.id)
      from public.syntax_edges ed
      join public.source_editions se on se.id = ed.edition_id
      where ed.verse_id = v_passage.id
        and (p_edition_key is null or se.edition_key = p_edition_key)
    ), '[]'::jsonb),
    'semantic_annotations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'edition_key', se.edition_key,
        'start_word_position', sa.start_word_position,
        'end_word_position', sa.end_word_position,
        'annotation_kind', sa.annotation_kind,
        'annotation_value', sa.annotation_value,
        'lemma_key', lem.lemma_key,
        'epistemic_layer', sa.epistemic_layer,
        'origin_mode', sa.origin_mode,
        'derivation_method', sa.derivation_method,
        'source_record_id', sa.source_record_id
      ) order by sa.start_word_position, sa.id)
      from public.semantic_annotations sa
      join public.source_editions se on se.id = sa.edition_id
      left join public.lemmas lem on lem.id = sa.lemma_id
      where sa.verse_id = v_passage.id
        and (p_edition_key is null or se.edition_key = p_edition_key)
    ), '[]'::jsonb)
  )
  into v_packet;

  return v_packet;
end;
$$;

-- ============================================================================
-- 6. CONCEPT -> DOCUMENTED EXTERNAL PROPERTIES & HYPERLINKS
-- ============================================================================
create or replace function public.lookup_concept_properties_v1(
  p_concept_query text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_q text := btrim(coalesce(p_concept_query, ''));
  v_concepts jsonb;
begin
  if v_q = '' then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'Provide p_concept_query.');
  end if;

  with matched as materialized (
    select
      c.*,
      case
        when lower(c.concept_key) = lower(v_q) then 0
        when lower(c.title) = lower(v_q) then 1
        when exists (
          select 1 from public.concept_aliases ca
          where ca.concept_id = c.id and ca.alias_normalized = lower(v_q)
        ) then 2
        when c.title ilike v_q || '%' then 3
        else 4
      end as rk
    from public.concepts c
    where lower(c.concept_key) = lower(v_q)
       or lower(c.title) = lower(v_q)
       or c.title ilike '%' || v_q || '%'
       or upper(v_q) = any(c.primary_strongs)
       or exists (
         select 1 from public.concept_aliases ca
         where ca.concept_id = c.id and ca.alias_normalized = lower(v_q)
       )
    order by rk, c.id
    limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'concept_key', m.concept_key,
    'title', m.title,
    'concept_kind', m.concept_kind,
    'external_entity_type', m.external_entity_type,
    'epistemic_layer', m.epistemic_layer,
    'summary', m.summary,
    'distinct_from_note', m.distinct_from_note,
    'primary_strongs', m.primary_strongs,
    'source_release_key', sr.release_key,
    'source_edition_key', se.edition_key,
    'source_record_id', m.source_record_id,
    'aliases', coalesce((
      select jsonb_agg(ca.alias order by ca.alias)
      from public.concept_aliases ca
      where ca.concept_id = m.id
    ), '[]'::jsonb),
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'property_key', cp.property_key,
        'property_value', cp.property_value,
        'value_type', cp.value_type,
        'unit', cp.unit,
        'epistemic_layer', cp.epistemic_layer,
        'external_citation', cp.external_citation,
        'source_release_key', psr.release_key,
        'source_edition_key', pse.edition_key,
        'source_record_id', cp.source_record_id
      ) order by cp.property_key, cp.id)
      from public.concept_properties cp
      join public.source_releases psr on psr.id = cp.source_release_id
      left join public.source_editions pse on pse.id = cp.source_edition_id
      where cp.concept_id = m.id
    ), '[]'::jsonb),
    'external_links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', cl.provider,
        'external_id', cl.external_id,
        'external_url', cl.external_url,
        'link_relation', cl.link_relation,
        'license', cl.license,
        'source_record_id', cl.source_record_id
      ) order by cl.provider, cl.id)
      from public.concept_external_links cl
      where cl.concept_id = m.id
    ), '[]'::jsonb)
  ) order by m.rk, m.id), '[]'::jsonb)
  into v_concepts
  from matched m
  left join public.source_releases sr on sr.id = m.source_release_id
  left join public.source_editions se on se.id = m.source_edition_id;

  return jsonb_build_object(
    'schema_version', 1,
    'status', case when jsonb_array_length(v_concepts) > 0 then 'ok' else 'not_found' end,
    'modeling_invariants', jsonb_build_object(
      'external_observation_is_not_biblical_interpretation', true
    ),
    'concepts', v_concepts
  );
end;
$$;

-- ============================================================================
-- 7. ENTITY -> DIRECTLY DOCUMENTED RELATIONSHIPS (WITH COMPLETE PROVENANCE)
-- ============================================================================
create or replace function public.lookup_entity_relationships_v1(
  p_entity_query text,
  p_relation_type text default null,
  p_origin_mode text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_q text := btrim(coalesce(p_entity_query, ''));
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_entity record;
  v_edges jsonb;
begin
  if v_q = '' then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'Provide p_entity_query.');
  end if;

  select ce.*
  into v_entity
  from public.canonical_entities ce
  where lower(ce.entity_key) = lower(v_q)
     or lower(ce.entity_key) in (
       'lemma:' || lower(v_q),
       'lexeme:' || lower(v_q),
       'root:' || lower(v_q),
       'concept:' || lower(v_q),
       'passage:' || lower(v_q),
       'place:' || lower(v_q),
       'event:' || lower(v_q)
     )
     or lower(ce.display_label) = lower(v_q)
     or ce.display_label ilike v_q || ' (%'
     or (
       ce.concept_id is not null and exists (
         select 1 from public.concept_aliases ca
         where ca.concept_id = ce.concept_id
           and ca.alias_normalized = lower(regexp_replace(v_q, '^concept:', '', 'i'))
       )
     )
  order by
    case
      when lower(ce.entity_key) = lower(v_q) then 0
      when lower(ce.entity_key) like '%:' || lower(v_q) then 1
      else 2
    end,
    ce.id
  limit 1;

  if v_entity.id is null then
    return jsonb_build_object('schema_version', 1, 'status', 'not_found');
  end if;

  with matched_edges as (
    select
      er.id,
      er.relationship_key,
      case when er.subject_entity_id = v_entity.id then 'outgoing' else 'incoming' end as direction,
      subj.entity_key as subject_key,
      subj.entity_kind as subject_kind,
      subj.display_label as subject_label,
      er.relation_type,
      rt.category as relation_category,
      rt.implies_synonymy,
      obj.entity_key as object_key,
      obj.entity_kind as object_kind,
      obj.display_label as object_label,
      er.epistemic_layer,
      er.origin_mode,
      er.derivation_method,
      er.algorithm_version,
      er.score,
      er.supporting_span_ref,
      er.external_citation,
      er.evidence_summary,
      sr.release_key as source_release_key,
      sr.dataset as source_dataset,
      sr.commit_sha as source_commit_sha,
      sr.license as source_license,
      se.edition_key as source_edition_key,
      er.source_record_id
    from public.entity_relationships er
    join public.relation_types rt on rt.relation_type = er.relation_type
    join public.canonical_entities subj on subj.id = er.subject_entity_id
    join public.canonical_entities obj on obj.id = er.object_entity_id
    join public.source_releases sr on sr.id = er.source_release_id
    left join public.source_editions se on se.id = er.source_edition_id
    where (er.subject_entity_id = v_entity.id or er.object_entity_id = v_entity.id)
      and (p_relation_type is null or er.relation_type = p_relation_type)
      and (p_origin_mode is null or er.origin_mode = p_origin_mode)
    order by er.id
    limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(me)), '[]'::jsonb)
  into v_edges
  from matched_edges me;

  return jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'entity', jsonb_build_object(
      'entity_key', v_entity.entity_key,
      'entity_kind', v_entity.entity_kind,
      'display_label', v_entity.display_label,
      'language', v_entity.language,
      'source_record_id', v_entity.source_record_id
    ),
    'returned_count', jsonb_array_length(v_edges),
    'relationships', v_edges
  );
end;
$$;

revoke all on function
  public.lookup_word_to_lemma_senses_v1(integer, text),
  public.lookup_lemma_occurrences_v1(text, integer, integer),
  public.lookup_lemma_root_relatives_v1(text),
  public.lookup_lemma_english_glosses_v1(text, integer),
  public.lookup_passage_tokens_syntax_v1(integer, integer, integer, text),
  public.lookup_concept_properties_v1(text),
  public.lookup_entity_relationships_v1(text, text, text, integer)
from public;

grant execute on function
  public.lookup_word_to_lemma_senses_v1(integer, text),
  public.lookup_lemma_occurrences_v1(text, integer, integer),
  public.lookup_lemma_root_relatives_v1(text),
  public.lookup_lemma_english_glosses_v1(text, integer),
  public.lookup_passage_tokens_syntax_v1(integer, integer, integer, text),
  public.lookup_concept_properties_v1(text),
  public.lookup_entity_relationships_v1(text, text, text, integer)
to anon, authenticated;

notify pgrst, 'reload schema';
