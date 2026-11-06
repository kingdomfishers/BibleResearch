-- Migration: 20261106140000_lexical_semantics_unicode_and_matching_rpc.sql
-- Feature: F5 — Establish Reliable Lexical Semantics
-- Description: Multi-tier Unicode normalization (Hebrew with/without niqqud, Greek monotonic/polytonic),
--              explicit linguistic boundaries (surface form vs lemma vs lexeme vs root vs sense vs gloss),
--              homograph preservation, source-specific identifiers, and non-synonymous root invariant.

-- ============================================================================
-- 1. IMMUTABLE UNICODE HELPER FUNCTIONS
-- ============================================================================

-- 1a. Strip Hebrew cantillation (te'amim), meteg, rafe, paseq, and punctuation,
--     PRESERVING all vowel points (niqqud) and shin/sin dots.
create or replace function public.strip_hebrew_cantillation(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select normalize(
    regexp_replace(
      normalize(p_text, NFKD),
      '[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C4\u05C5\u05C6׃־/]',
      '',
      'g'
    ),
    NFC
  );
$$;

-- 1b. Strip all Hebrew cantillation, vowel points, dots, combining marks, and punctuation.
create or replace function public.strip_hebrew_all(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select normalize(
    regexp_replace(
      normalize(p_text, NFKD),
      '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־/]',
      '',
      'g'
    ),
    NFC
  );
$$;

-- 1c. Harmonize Greek accents to canonical NFC (unifying polytonic oxia/varia with monotonic tonos).
create or replace function public.harmonize_greek_accents(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select normalize(p_text, NFC);
$$;

-- 1d. Strip Greek accents, breathing marks, diaeresis, and iota subscripts (returns lowercase base letters).
create or replace function public.strip_greek_diacritics(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(
    normalize(
      regexp_replace(
        normalize(p_text, NFKD),
        '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF.,;:·"᾽᾿῀῁]',
        '',
        'g'
      ),
      NFC
    )
  );
$$;

-- Grant permissions on Unicode helpers
grant execute on function public.strip_hebrew_cantillation(text) to anon, authenticated, service_role, postgres;
grant execute on function public.strip_hebrew_all(text) to anon, authenticated, service_role, postgres;
grant execute on function public.harmonize_greek_accents(text) to anon, authenticated, service_role, postgres;
grant execute on function public.strip_greek_diacritics(text) to anon, authenticated, service_role, postgres;

-- Functional indexes for fast Unicode search
create index if not exists idx_words_strip_hebrew_all on public.words (public.strip_hebrew_all(original_word));
create index if not exists idx_words_strip_greek on public.words (public.strip_greek_diacritics(original_word));
create index if not exists idx_lemmas_strip_hebrew_script on public.lemmas (public.strip_hebrew_all(lemma_script));
create index if not exists idx_lemmas_strip_greek_script on public.lemmas (public.strip_greek_diacritics(lemma_script));

-- ============================================================================
-- 2. HARDENED ORIGINAL WORD -> LEMMA -> AVAILABLE SENSES RPC
-- ============================================================================
-- Multi-tier matching:
--   Tier 0: Exact word ID or exact surface word
--   Tier 1: Hebrew with vowels (cantillation stripped) OR Greek with accents (NFC)
--   Tier 2: Strong's code (e.g. H7307, G3056)
--   Tier 3: Transliteration
--   Tier 4: Stripped consonants / base letters (with homographs preserved)
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
  v_is_hebrew boolean := v_q is not null and v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q is not null and v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q is not null and v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q is not null and (v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' or v_q ~ '[άέήίόύώΐΰϊϋ]');

  v_heb_vocalized text := case when v_is_hebrew then public.strip_hebrew_cantillation(v_q) else null end;
  v_heb_stripped text := case when v_is_hebrew then public.strip_hebrew_all(v_q) else null end;
  v_grk_harmonized text := case when v_is_greek then public.harmonize_greek_accents(v_q) else null end;
  v_grk_stripped text := case when v_is_greek then public.strip_greek_diacritics(v_q) else null end;

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
    -- Multi-tier matching priority:
    -- 1. Exact original_word
    -- 2. Hebrew with vowels (cantillation stripped)
    -- 3. Greek with accents (NFC)
    -- 4. Strong's number
    -- 5. Transliteration
    select array_agg(sub.id order by sub.rk, sub.id)
    into v_ids
    from (
      select
        w.id,
        case
          when w.original_word = v_q then 1
          when v_has_hebrew_vowels and public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized then 2
          when v_has_greek_accents and public.harmonize_greek_accents(w.original_word) = v_grk_harmonized then 2
          when v_norm_strongs is not null and w.strongs_nr = v_norm_strongs then 3
          when lower(w.transliteration) = lower(v_q) then 4
          else 9
        end as rk
      from public.words w
      where w.original_word = v_q
         or (v_has_hebrew_vowels and public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
         or (v_has_greek_accents and public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
         or (v_norm_strongs is not null and w.strongs_nr = v_norm_strongs)
         or lower(w.transliteration) = lower(v_q)
      order by rk, w.id
      limit 10
    ) sub;

    -- Fallback for unpointed/unaccented queries (strictly when vowels/accents were omitted)
    if coalesce(cardinality(v_ids), 0) = 0 then
      if v_is_hebrew and not v_has_hebrew_vowels and v_heb_stripped is not null and length(v_heb_stripped) >= 2 then
        select array_agg(sub.id order by sub.id)
        into v_ids
        from (
          select w.id
          from public.words w
          where public.strip_hebrew_all(w.original_word) = v_heb_stripped
          order by w.id
          limit 10
        ) sub;
      elsif v_is_greek and not v_has_greek_accents and v_grk_stripped is not null and length(v_grk_stripped) >= 2 then
        select array_agg(sub.id order by sub.id)
        into v_ids
        from (
          select w.id
          from public.words w
          where public.strip_greek_diacritics(w.original_word) = v_grk_stripped
          order by w.id
          limit 10
        ) sub;
      end if;
    end if;

    -- Secondary fallback: If the query matches a citation lemma (e.g., כָּפַר or דָבַר) whose
    -- 3ms qal perfect surface form is not directly in public.words, retrieve words linked via word_form_lemmas
    if coalesce(cardinality(v_ids), 0) = 0 then
      select array_agg(sub.id order by sub.id)
      into v_ids
      from (
        select distinct wfl.word_id as id
        from public.lemmas lem
        join public.word_form_lemmas wfl on wfl.lemma_id = lem.id
        where (v_has_hebrew_vowels and public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
           or (v_is_hebrew and not v_has_hebrew_vowels and lem.lemma_stripped = v_heb_stripped)
           or (v_has_greek_accents and public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
           or (v_is_greek and not v_has_greek_accents and lem.lemma_stripped = v_grk_stripped)
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
      'sense_assignment_policy', 'catalog_only_no_ai_inference',
      'unicode_aware_search', true
    ),
    'query_analysis', jsonb_build_object(
      'raw_query', v_q,
      'is_hebrew', v_is_hebrew,
      'has_hebrew_vowels', v_has_hebrew_vowels,
      'is_greek', v_is_greek,
      'has_greek_accents', v_has_greek_accents
    ),
    'word_forms', v_words
  );
end;
$$;

-- ============================================================================
-- 3. HARDENED LEMMA -> ALL BIBLICAL OCCURRENCES RPC
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
  v_is_hebrew boolean := v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' or v_q ~ '[άέήίόύώΐΰϊϋ]';

  v_heb_vocalized text := case when v_is_hebrew then public.strip_hebrew_cantillation(v_q) else null end;
  v_heb_stripped text := case when v_is_hebrew then public.strip_hebrew_all(v_q) else null end;
  v_grk_harmonized text := case when v_is_greek then public.harmonize_greek_accents(v_q) else null end;
  v_grk_stripped text := case when v_is_greek then public.strip_greek_diacritics(v_q) else null end;

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
        -- Explicit key match
        when lower(lem.lemma_key) = lower(v_q) then 0
        when lower(lem.lemma_key) = 'lemma:' || lower(v_q) then 1
        when exists (
          select 1 from public.lexemes lx
          where lx.id = lem.primary_lexeme_id and upper(lx.extended_strongs) = upper(v_q)
        ) then 2
        -- Strong's number
        when v_base_strongs is not null and upper(coalesce(lem.base_strongs, '')) = v_base_strongs then 3
        -- Hebrew with vowels exact vocalization
        when v_has_hebrew_vowels and public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized then 4
        -- Greek with accents exact harmonized NFC
        when v_has_greek_accents and public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized then 4
        -- Stripped forms (consonants / base letters)
        when v_is_hebrew and not v_has_hebrew_vowels and lem.lemma_stripped = v_heb_stripped then 5
        when v_is_greek and not v_has_greek_accents and lem.lemma_stripped = v_grk_stripped then 5
        when lower(lem.transliteration) = lower(v_q) then 6
        else 9
      end as match_rank
    from public.lemmas lem
    where lower(lem.lemma_key) = lower(v_q)
       or lower(lem.lemma_key) = 'lemma:' || lower(v_q)
       or (v_base_strongs is not null and upper(coalesce(lem.base_strongs, '')) = v_base_strongs)
       or (v_has_hebrew_vowels and public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
       or (v_is_hebrew and not v_has_hebrew_vowels and lem.lemma_stripped = v_heb_stripped)
       or (v_has_greek_accents and public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
       or (v_is_greek and not v_has_greek_accents and lem.lemma_stripped = v_grk_stripped)
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
-- 4. AUTHORITATIVE LEXICAL SEMANTICS LOOKUP RPC (F5)
-- ============================================================================
-- Comprehensive multi-tier lexical semantics resolving:
--   1. Matched Canonical Lemmas (preserving homographs)
--   2. Associated Lexemes & Source Identifiers (dStrong, uStrong, STEP, Abbott-Smith)
--   3. Documented Roots & Etymological Links (non-synonymous invariant)
--   4. Documented Lexical Senses (with definitions, citations, source attribution)
--   5. Attested Translation Glosses (with token counts and sample passages, caveats)
--   6. Surface Form Occurrence Counts and Contextual Form Samples
create or replace function public.lookup_lexical_semantics_v1(
  p_query text,
  p_match_scope text default 'auto'
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
  v_scope text := lower(coalesce(p_match_scope, 'auto'));
  v_norm_strongs text := case
    when v_q is not null and v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      then upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    else null
  end;
  v_is_hebrew boolean := v_q is not null and v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q is not null and v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q is not null and v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q is not null and (v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' or v_q ~ '[άέήίόύώΐΰϊϋ]');

  v_heb_vocalized text := case when v_is_hebrew then public.strip_hebrew_cantillation(v_q) else null end;
  v_heb_stripped text := case when v_is_hebrew then public.strip_hebrew_all(v_q) else null end;
  v_grk_harmonized text := case when v_is_greek then public.harmonize_greek_accents(v_q) else null end;
  v_grk_stripped text := case when v_is_greek then public.strip_greek_diacritics(v_q) else null end;

  v_lemmas jsonb;
  v_has_aramaic boolean := false;
begin
  if v_q is null then
    return jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_query (Hebrew/Aramaic with or without niqqud, Greek with or without accents, Strong''s code, or transliteration).'
    );
  end if;

  with candidate_lemmas as (
    select
      lem.*,
      se.edition_key as source_edition_key,
      case
        when lower(lem.lemma_key) = lower(v_q) or lower(lem.lemma_key) = 'lemma:' || lower(v_q) then 0
        when exists (
          select 1 from public.lexemes lx
          where lx.id = lem.primary_lexeme_id and upper(lx.extended_strongs) = upper(v_q)
        ) then 1
        when v_norm_strongs is not null and upper(coalesce(lem.base_strongs, '')) = v_norm_strongs then 2
        when v_has_hebrew_vowels and public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized then 3
        when v_has_greek_accents and public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized then 3
        when v_is_hebrew and not v_has_hebrew_vowels and lem.lemma_stripped = v_heb_stripped then 4
        when v_is_greek and not v_has_greek_accents and lem.lemma_stripped = v_grk_stripped then 4
        when lower(lem.transliteration) = lower(v_q) then 5
        -- Also match if query matches a known surface form pointing to this lemma
        when exists (
          select 1 from public.words w
          join public.word_form_lemmas wfl on wfl.word_id = w.id
          where wfl.lemma_id = lem.id
            and (
              (v_has_hebrew_vowels and public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
              or (v_has_greek_accents and public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
              or (v_is_hebrew and not v_has_hebrew_vowels and public.strip_hebrew_all(w.original_word) = v_heb_stripped)
              or (v_is_greek and not v_has_greek_accents and public.strip_greek_diacritics(w.original_word) = v_grk_stripped)
            )
        ) then 6
        else 9
      end as match_rank
    from public.lemmas lem
    left join public.source_editions se on se.id = lem.source_edition_id
    where lower(lem.lemma_key) = lower(v_q)
       or lower(lem.lemma_key) = 'lemma:' || lower(v_q)
       or (v_norm_strongs is not null and upper(coalesce(lem.base_strongs, '')) = v_norm_strongs)
       or (v_has_hebrew_vowels and public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
       or (v_is_hebrew and not v_has_hebrew_vowels and lem.lemma_stripped = v_heb_stripped)
       or (v_has_greek_accents and public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
       or (v_is_greek and not v_has_greek_accents and lem.lemma_stripped = v_grk_stripped)
       or lower(lem.transliteration) = lower(v_q)
       or exists (
         select 1 from public.lexemes lx
         where lx.lemma_id = lem.id and upper(lx.extended_strongs) = upper(v_q)
       )
       or exists (
         select 1 from public.words w
         join public.word_form_lemmas wfl on wfl.word_id = w.id
         where wfl.lemma_id = lem.id
           and (
             (v_has_hebrew_vowels and public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
             or (v_has_greek_accents and public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
             or (v_is_hebrew and not v_has_hebrew_vowels and public.strip_hebrew_all(w.original_word) = v_heb_stripped)
             or (v_is_greek and not v_has_greek_accents and public.strip_greek_diacritics(w.original_word) = v_grk_stripped)
           )
       )
    order by match_rank, lem.id
    limit 15
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'lemma_id', cl.id,
    'lemma_key', cl.lemma_key,
    'language', cl.language,
    'lemma_script', cl.lemma_script,
    'lemma_stripped', cl.lemma_stripped,
    'transliteration', cl.transliteration,
    'primary_pos', cl.primary_pos,
    'homograph_tag', cl.homograph_tag,
    'base_strongs', cl.base_strongs,
    'source_edition_key', cl.source_edition_key,
    'source_record_id', cl.source_record_id,

    -- 1. Distinct Lexemes and Identifiers (dStrong, uStrong, STEP, Abbott-Smith)
    'lexemes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lexeme_id', lx.id,
        'lexeme_key', lx.lexeme_key,
        'extended_strongs', lx.extended_strongs,
        'disambiguated_strongs', lx.disambiguated_strongs,
        'unified_strongs', lx.unified_strongs,
        'primary_gloss', lx.primary_gloss,
        'homograph_note', lx.homograph_note,
        'source_record_id', lx.source_record_id,
        'registered_identifiers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'namespace', li.id_namespace,
            'value', li.id_value,
            'is_primary', li.is_primary
          ) order by li.is_primary desc, li.id_namespace)
          from public.lexeme_identifiers li
          where li.lexeme_id = lx.id
        ), '[]'::jsonb)
      ) order by lx.id)
      from public.lexemes lx
      where lx.lemma_id = cl.id or lx.id = cl.primary_lexeme_id
    ), '[]'::jsonb),

    -- 2. Documented Roots & Etymology (Non-synonymous invariant enforced)
    'documented_roots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'root_key', lr.root_key,
        'language', lr.language,
        'root_script', lr.root_script,
        'transliteration', lr.transliteration,
        'root_kind', lr.root_kind,
        'etymology_type', lrl.etymology_type,
        'implies_synonymy', lrl.implies_synonymy,
        'evidence_note', lrl.evidence_note,
        'origin_mode', lrl.origin_mode,
        'derivation_method', lrl.derivation_method,
        'source_record_id', lrl.source_record_id
      ) order by lr.root_key)
      from public.lemma_root_links lrl
      join public.lexical_roots lr on lr.id = lrl.root_id
      where lrl.lemma_id = cl.id
    ), '[]'::jsonb),

    -- 3. Documented Lexical Senses (Separated from translation glosses)
    'documented_senses', coalesce((
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
      where ls.lemma_id = cl.id
    ), '[]'::jsonb),

    -- 4. Attested Translation Glosses (with frequency, earliest citation, and explicit caveat)
    'attested_translation_glosses', coalesce((
      with stem_words as (
        select distinct wfl.word_id
        from public.word_form_lemmas wfl
        where wfl.lemma_id = cl.id and wfl.morpheme_role = 'stem'
      ),
      all_trans as (
        select
          btrim(s.source_english) as raw_english,
          s.verse_id,
          s.source_ref,
          s.source_name,
          s.source_commit
        from stem_words sw
        join public.verse_translation_sources s on s.word_id = sw.word_id
        where btrim(s.source_english) <> ''
      ),
      first_occ as (
        select distinct on (t.raw_english)
          t.raw_english,
          t.verse_id,
          t.source_ref,
          t.source_name,
          t.source_commit
        from all_trans t
        order by t.raw_english, t.verse_id, t.source_ref
      ),
      grouped_glosses as (
        select
          fo.raw_english,
          count(*)::integer as token_count,
          count(distinct t.verse_id)::integer as verse_count,
          fo.verse_id,
          fo.source_ref,
          fo.source_name,
          fo.source_commit,
          v.book,
          b.name as book_name,
          v.chapter,
          v.verse_nr
        from all_trans t
        join first_occ fo on fo.raw_english = t.raw_english
        join public.verses v on v.id = fo.verse_id
        join public.books b on b.id = v.book
        group by fo.raw_english, fo.verse_id, fo.source_ref, fo.source_name, fo.source_commit, v.book, b.name, v.chapter, v.verse_nr
        order by count(*) desc, fo.raw_english
        limit 12
      )
      select jsonb_agg(jsonb_build_object(
        'attested_gloss', gg.raw_english,
        'token_count', gg.token_count,
        'verse_count', gg.verse_count,
        'sample_passage', jsonb_build_object(
          'verse_id', gg.verse_id,
          'source_ref', gg.source_ref,
          'book', gg.book,
          'book_name', gg.book_name,
          'chapter', gg.chapter,
          'verse', gg.verse_nr
        ),
        'source_attribution', gg.source_name || ' (' || substring(gg.source_commit from 1 for 7) || ')',
        'caveat', 'Attested rendering from translation sources; contextual equivalence only, does not constitute a dictionary definition.'
      ))
      from grouped_glosses gg
    ), '[]'::jsonb),

    -- 5. Contextual Surface Forms Summary
    'surface_forms_summary', jsonb_build_object(
      'distinct_forms_count', (
        select count(distinct wfl.word_id)
        from public.word_form_lemmas wfl
        where wfl.lemma_id = cl.id and wfl.morpheme_role = 'stem'
      ),
      'sample_surface_forms', coalesce((
        select jsonb_agg(jsonb_build_object(
          'word_id', w.id,
          'surface_form', w.original_word,
          'transliteration', w.transliteration,
          'grammar_code', w.grammar_code,
          'observed_count', s_forms.observed_token_count
        ) order by s_forms.observed_token_count desc, w.id)
        from (
          select distinct on (wfl.word_id) wfl.word_id, wfl.observed_token_count
          from public.word_form_lemmas wfl
          where wfl.lemma_id = cl.id and wfl.morpheme_role = 'stem'
          order by wfl.word_id, wfl.observed_token_count desc
          limit 6
        ) s_forms
        join public.words w on w.id = s_forms.word_id
      ), '[]'::jsonb)
    )
  ) order by cl.match_rank, cl.id), '[]'::jsonb)
  into v_lemmas
  from candidate_lemmas cl;

  v_has_aramaic := exists (
    select 1 from jsonb_array_elements(v_lemmas) elem
    where elem->>'language' = 'arc'
  );

  return jsonb_build_object(
    'schema_version', 1,
    'status', case when jsonb_array_length(v_lemmas) > 0 then 'ok' else 'not_found' end,
    'query_analysis', jsonb_build_object(
      'raw_query', v_q,
      'detected_script', case
        when v_is_hebrew and not v_has_aramaic then 'hebrew'
        when v_is_hebrew and v_has_aramaic then 'hebrew_or_aramaic'
        when v_is_greek then 'greek'
        when v_norm_strongs is not null and v_norm_strongs like 'H%' then 'strongs_hebrew'
        when v_norm_strongs is not null and v_norm_strongs like 'G%' then 'strongs_greek'
        else 'transliteration_or_latin'
      end,
      'has_vowels_or_accents', (v_has_hebrew_vowels or v_has_greek_accents),
      'cantillation_stripped', v_heb_vocalized,
      'accent_harmonized', v_grk_harmonized,
      'consonants_or_base_letters', coalesce(v_heb_stripped, v_grk_stripped)
    ),
    'epistemic_invariants', jsonb_build_object(
      'surface_form_is_not_lemma', 'A surface form (public.words) is the contextual inflected word in a biblical verse. A lemma (public.lemmas) is the dictionary citation headword.',
      'lemma_is_not_root', 'A lemma is a distinct lexical unit. A root (public.lexical_roots) is an etymological base. Words sharing a common root do NOT imply synonymy.',
      'shared_root_implies_synonymy', false,
      'strongs_identifies_contextual_sense', false,
      'sense_is_not_translation_gloss', 'A lexical sense (public.lexical_senses) is a documented dictionary definition with scope and citations. A translation gloss is a translation choice for a specific passage and cannot be treated as a definitive contextual sense without supporting evidence.'
    ),
    'total_matching_lemmas', jsonb_array_length(v_lemmas),
    'lemmas', v_lemmas
  );
end;
$$;

grant execute on function public.lookup_lexical_semantics_v1(text, text) to anon, authenticated, service_role, postgres;
