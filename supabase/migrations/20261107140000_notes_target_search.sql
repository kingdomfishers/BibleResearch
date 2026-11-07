-- NOTE-12: Target search RPC
-- Implements public.search_note_targets_v1 for target picker autocompletion.
-- Callable by anon, authenticated with security invoker, search_path='', statement_timeout '8s', jit 'off'.

create or replace function public.search_note_targets_v1(
  p_query text,
  p_kinds text[] default null,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
set jit = 'off'
as $$
declare
  v_query text;
  v_limit int;
  v_interp text;
  v_ref_parsed jsonb;
  v_norm text;
  v_upper text;
  v_strongs_prefix text;
  v_strongs_num text;
  v_strongs_letter text;
  m_id text[];
  v_groups jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_passage_cands jsonb := '[]'::jsonb;
  v_lemma_cands jsonb := '[]'::jsonb;
  v_word_cands jsonb := '[]'::jsonb;
  v_concept_cands jsonb := '[]'::jsonb;
  v_place_cands jsonb := '[]'::jsonb;
  v_note_cands jsonb := '[]'::jsonb;
  v_reader_words jsonb;
  v_item jsonb;
  v_strongs_list text[] := '{}'::text[];
  v_filter_passage boolean := true;
  v_filter_lemma boolean := true;
  v_filter_word boolean := true;
  v_filter_concept boolean := true;
  v_filter_place boolean := true;
  v_filter_note boolean := true;
begin
  if p_query is null or btrim(p_query) = '' then
    return jsonb_build_object(
      'status', 'ok',
      'query', coalesce(p_query, ''),
      'interpretation', jsonb_build_object('type', 'text'),
      'groups', '[]'::jsonb,
      'truncated', false
    );
  end if;

  v_query := left(btrim(p_query), 100);
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  -- Set up kind filters if provided
  if p_kinds is not null and array_length(p_kinds, 1) > 0 then
    v_filter_passage := ('passage' = any(p_kinds) or 'verse' = any(p_kinds) or 'verse_range' = any(p_kinds));
    v_filter_lemma := ('lemma' = any(p_kinds));
    v_filter_word := ('word_form' = any(p_kinds) or 'word' = any(p_kinds));
    v_filter_concept := ('concept' = any(p_kinds));
    v_filter_place := ('place' = any(p_kinds));
    v_filter_note := ('note' = any(p_kinds));
  end if;

  -- 1. Determine interpretation type
  v_ref_parsed := public.parse_bible_ref_v1(v_query);
  if (v_ref_parsed->>'status') = 'ok' then
    v_interp := 'reference';
  elsif v_query ~* '^[HG]\d{1,5}[a-z]?$' then
    v_interp := 'identifier';
  elsif v_query ~ '[\u0590-\u05FF\uFB1D-\uFB4F]' then
    v_interp := 'hebrew';
  elsif v_query ~ '[\u0370-\u03FF\u1F00-\u1FFF]' then
    v_interp := 'greek';
  else
    v_interp := 'text';
  end if;

  -- 2. Generate candidates based on interpretation
  if v_interp = 'reference' then
    if v_filter_passage then
      if (v_ref_parsed->>'scope') = 'verse' then
        v_passage_cands := jsonb_build_array(
          jsonb_build_object(
            'kind', 'verse',
            'id', (v_ref_parsed->'verse_ids'->0)::int,
            'label', v_ref_parsed->>'canonical',
            'sublabel', 'Verse target (id: ' || (v_ref_parsed->'verse_ids'->0)::text || ')',
            'language', null,
            'match_type', 'exact',
            'anchor', jsonb_build_object(
              'kind', 'verse',
              'verse_id', (v_ref_parsed->'verse_ids'->0)::int,
              'label', v_ref_parsed->>'canonical'
            )
          )
        );
      else
        v_passage_cands := jsonb_build_array(
          jsonb_build_object(
            'kind', 'verse_range',
            'id', (v_ref_parsed->'verse_ids'->0)::int,
            'label', v_ref_parsed->>'canonical',
            'sublabel', initcap(v_ref_parsed->>'scope') || ' range (' || ((v_ref_parsed->'verse_ids'->1)::int - (v_ref_parsed->'verse_ids'->0)::int + 1)::text || ' verses)',
            'language', null,
            'match_type', 'exact',
            'anchor', jsonb_build_object(
              'kind', 'verse_range',
              'verse_id', (v_ref_parsed->'verse_ids'->0)::int,
              'end_verse_id', (v_ref_parsed->'verse_ids'->1)::int,
              'label', v_ref_parsed->>'canonical'
            )
          )
        );
      end if;
    end if;

  elsif v_interp = 'identifier' then
    if v_filter_lemma then
      v_upper := upper(v_query);
      m_id := regexp_match(v_upper, '^([HG])(\d{1,5})([A-Z])?$');
      v_strongs_prefix := m_id[1];
      v_strongs_num := m_id[2];
      v_strongs_letter := m_id[3];

      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'lemma',
          'id', l.id,
          'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, ''),
          'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
          'language', l.language,
          'match_type', case when l.lemma_key = 'lemma:' || v_upper or (l.base_strongs = v_upper and l.homograph_tag is null) then 'exact' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'lemma',
            'lemma_id', l.id,
            'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, '')
          )
        ) order by
          case when l.lemma_key = 'lemma:' || v_upper or (l.base_strongs = v_upper and l.homograph_tag is null) then 1 else 2 end,
          l.homograph_tag nulls first,
          l.id
      ), '[]'::jsonb)
      into v_lemma_cands
      from public.lemmas l
      left join lateral (
        select short_gloss from public.lexical_senses where lemma_id = l.id order by sense_order asc limit 1
      ) ls on true
      where (
        (v_strongs_letter is not null and l.base_strongs = (v_strongs_prefix || v_strongs_num::int::text) and (l.homograph_tag = v_strongs_letter or l.lemma_key ilike '%:' || v_upper || '%'))
        or (v_strongs_letter is null and l.base_strongs = (v_strongs_prefix || v_strongs_num::int::text))
      );
    end if;

  elsif v_interp = 'hebrew' then
    v_norm := public.strip_hebrew_all(v_query);

    -- Hebrew Lemmas
    if v_filter_lemma then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'lemma',
          'id', l.id,
          'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, ''),
          'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
          'language', l.language,
          'match_type', case when l.lemma_script = v_query then 'exact' when l.lemma_stripped = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'lemma',
            'lemma_id', l.id,
            'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, '')
          )
        ) order by
          case when l.lemma_script = v_query then 1 when l.lemma_stripped = v_norm then 2 else 3 end,
          l.homograph_tag nulls first,
          l.id
      ), '[]'::jsonb)
      into v_lemma_cands
      from (
        select distinct on (l.id) l.*
        from public.lemmas l
        where l.lemma_stripped = v_norm or l.lemma_script = v_query or public.strip_hebrew_all(l.lemma_script) = v_norm
        limit v_limit
      ) l
      left join lateral (
        select short_gloss from public.lexical_senses where lemma_id = l.id order by sense_order asc limit 1
      ) ls on true;
    end if;

    -- Hebrew Word Forms
    if v_filter_word then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'word_form',
          'id', w.id,
          'label', w.original_word,
          'sublabel', coalesce(w.transliteration, '') || case when w.biblical_def is not null then ' — ' || left(w.biblical_def, 40) else '' end || ' [' || w.strongs_nr || ']',
          'language', 'hbo',
          'match_type', case when w.original_word = v_query then 'exact' when public.strip_hebrew_all(w.original_word) = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'word_form',
            'word_id', w.id,
            'label', w.original_word
          )
        ) order by
          case when w.original_word = v_query then 1 when public.strip_hebrew_all(w.original_word) = v_norm then 2 else 3 end,
          w.id
      ), '[]'::jsonb)
      into v_word_cands
      from (
        select distinct on (w.original_word) w.id, w.original_word, w.transliteration, w.biblical_def, w.strongs_nr
        from public.words w
        where w.original_word = v_query or public.strip_hebrew_all(w.original_word) = v_norm
        limit v_limit
      ) w;
    end if;

  elsif v_interp = 'greek' then
    v_norm := public.strip_greek_diacritics(v_query);

    -- Greek Lemmas
    if v_filter_lemma then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'lemma',
          'id', l.id,
          'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, ''),
          'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
          'language', l.language,
          'match_type', case when l.lemma_script = v_query then 'exact' when l.lemma_stripped = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'lemma',
            'lemma_id', l.id,
            'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, '')
          )
        ) order by
          case when l.lemma_script = v_query then 1 when l.lemma_stripped = v_norm then 2 else 3 end,
          l.homograph_tag nulls first,
          l.id
      ), '[]'::jsonb)
      into v_lemma_cands
      from (
        select distinct on (l.id) l.*
        from public.lemmas l
        where l.lemma_stripped = v_norm or l.lemma_script = v_query or public.strip_greek_diacritics(l.lemma_script) = v_norm
        limit v_limit
      ) l
      left join lateral (
        select short_gloss from public.lexical_senses where lemma_id = l.id order by sense_order asc limit 1
      ) ls on true;
    end if;

    -- Greek Word Forms
    if v_filter_word then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'word_form',
          'id', w.id,
          'label', w.original_word,
          'sublabel', coalesce(w.transliteration, '') || case when w.biblical_def is not null then ' — ' || left(w.biblical_def, 40) else '' end || ' [' || w.strongs_nr || ']',
          'language', 'grc',
          'match_type', case when w.original_word = v_query then 'exact' when public.strip_greek_diacritics(w.original_word) = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'word_form',
            'word_id', w.id,
            'label', w.original_word
          )
        ) order by
          case when w.original_word = v_query then 1 when public.strip_greek_diacritics(w.original_word) = v_norm then 2 else 3 end,
          w.id
      ), '[]'::jsonb)
      into v_word_cands
      from (
        select distinct on (w.original_word) w.id, w.original_word, w.transliteration, w.biblical_def, w.strongs_nr
        from public.words w
        where w.original_word = v_query or public.strip_greek_diacritics(w.original_word) = v_norm
        limit v_limit
      ) w;
    end if;

  else
    -- Interpretation is 'text' (transliteration / English / generic)
    -- (1) Words via existing search_reader_words_v1
    if v_filter_word or v_filter_lemma then
      v_reader_words := public.search_reader_words_v1(v_query);
      if v_reader_words is not null and jsonb_array_length(v_reader_words) > 0 then
        if v_filter_word then
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'kind', 'word_form',
              'id', (elem->>'id')::int,
              'label', elem->>'original_word' || case when elem->>'transliteration' is not null then ' (' || (elem->>'transliteration') || ')' else '' end,
              'sublabel', left(coalesce(elem->>'biblical_def', elem->>'strongs_nr', ''), 60),
              'language', null,
              'match_type', case when (elem->>'rank')::int <= 1 then 'exact' when (elem->>'rank')::int = 2 then 'prefix' else 'fuzzy' end,
              'anchor', jsonb_build_object(
                'kind', 'word_form',
                'word_id', (elem->>'id')::int,
                'label', elem->>'original_word'
              )
            ) order by (elem->>'rank')::int, (elem->>'id')::int
          ), '[]'::jsonb)
          into v_word_cands
          from jsonb_array_elements(v_reader_words) as elem;
        end if;

        if v_filter_lemma then
          select array_agg(distinct elem->>'strongs_nr')
          into v_strongs_list
          from jsonb_array_elements(v_reader_words) as elem
          where elem->>'strongs_nr' is not null;

          if v_strongs_list is not null and array_length(v_strongs_list, 1) > 0 then
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'kind', 'lemma',
                'id', l.id,
                'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, ''),
                'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
                'language', l.language,
                'match_type', 'prefix',
                'anchor', jsonb_build_object(
                  'kind', 'lemma',
                  'lemma_id', l.id,
                  'label', l.lemma_script || ' · ' || l.base_strongs || coalesce(l.homograph_tag, '')
                )
              ) order by l.base_strongs, l.homograph_tag nulls first, l.id
            ), '[]'::jsonb)
            into v_lemma_cands
            from public.lemmas l
            left join lateral (
              select short_gloss from public.lexical_senses where lemma_id = l.id order by sense_order asc limit 1
            ) ls on true
            where l.base_strongs = any(v_strongs_list)
            limit v_limit;
          end if;
        end if;
      end if;
    end if;

    -- (2) Concepts
    if v_filter_concept then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'concept',
          'id', c.id,
          'label', c.title,
          'sublabel', 'Concept · ' || coalesce(c.concept_kind, 'theological'),
          'language', null,
          'match_type', case when lower(c.title) = lower(v_query) then 'exact' when lower(c.title) like lower(v_query) || '%' then 'prefix' else 'fuzzy' end,
          'anchor', jsonb_build_object(
            'kind', 'concept',
            'concept_id', c.id,
            'label', c.title
          )
        ) order by
          case when lower(c.title) = lower(v_query) then 1 when lower(c.title) like lower(v_query) || '%' then 2 else 3 end,
          c.id
      ), '[]'::jsonb)
      into v_concept_cands
      from (
        select *
        from public.concepts
        where title ilike '%' || v_query || '%' or concept_key ilike '%' || v_query || '%'
        limit v_limit
      ) c;
    end if;

    -- (3) Places
    if v_filter_place then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'place',
          'id', p.id,
          'label', p.biblical_name,
          'sublabel', 'Place · ' || coalesce(p.place_type, 'geographic'),
          'language', null,
          'match_type', case when lower(p.biblical_name) = lower(v_query) then 'exact' when lower(p.biblical_name) like lower(v_query) || '%' then 'prefix' else 'fuzzy' end,
          'anchor', jsonb_build_object(
            'kind', 'place',
            'place_id', p.id,
            'label', p.biblical_name
          )
        ) order by
          case when lower(p.biblical_name) = lower(v_query) then 1 when lower(p.biblical_name) like lower(v_query) || '%' then 2 else 3 end,
          p.id
      ), '[]'::jsonb)
      into v_place_cands
      from (
        select *
        from public.places
        where biblical_name ilike '%' || v_query || '%'
        limit v_limit
      ) p;
    end if;

    -- (4) Existing Notes
    if v_filter_note then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', 'note',
          'id', n.id,
          'label', coalesce(n.title, 'Note #' || left(n.id::text, 8)),
          'sublabel', 'Note · ' || n.note_kind || ' (' || left(n.body_md, 40) || ')',
          'language', n.language,
          'match_type', case when lower(n.title) = lower(v_query) then 'exact' else 'fuzzy' end,
          'anchor', jsonb_build_object(
            'kind', 'note',
            'target_note_id', n.id,
            'label', coalesce(n.title, 'Note #' || left(n.id::text, 8))
          )
        ) order by n.created_at desc, n.id desc
      ), '[]'::jsonb)
      into v_note_cands
      from (
        select *
        from public.notes
        where status = 'published'
          and visibility = 'public'
          and (
            title ilike '%' || v_query || '%'
            or (length(v_query) >= 3 and tsv @@ websearch_to_tsquery('simple', v_query))
          )
        limit v_limit
      ) n;
    end if;

  end if;

  -- 3. Assemble output groups
  if v_passage_cands is not null and jsonb_array_length(v_passage_cands) > 0 then
    v_groups := v_groups || jsonb_build_array(
      jsonb_build_object(
        'kind', 'passage',
        'label', 'Passages (Verses & Ranges)',
        'candidates', v_passage_cands
      )
    );
  end if;

  if v_lemma_cands is not null and jsonb_array_length(v_lemma_cands) > 0 then
    v_groups := v_groups || jsonb_build_array(
      jsonb_build_object(
        'kind', 'lemma',
        'label', 'Lemmas (Lexical roots & headwords)',
        'candidates', v_lemma_cands
      )
    );
  end if;

  if v_word_cands is not null and jsonb_array_length(v_word_cands) > 0 then
    v_groups := v_groups || jsonb_build_array(
      jsonb_build_object(
        'kind', 'word_form',
        'label', 'Word Forms (Inflected surface tokens)',
        'candidates', v_word_cands
      )
    );
  end if;

  if v_concept_cands is not null and jsonb_array_length(v_concept_cands) > 0 then
    v_groups := v_groups || jsonb_build_array(
      jsonb_build_object(
        'kind', 'concept',
        'label', 'Theological Concepts',
        'candidates', v_concept_cands
      )
    );
  end if;

  if v_place_cands is not null and jsonb_array_length(v_place_cands) > 0 then
    v_groups := v_groups || jsonb_build_array(
      jsonb_build_object(
        'kind', 'place',
        'label', 'Biblical Places',
        'candidates', v_place_cands
      )
    );
  end if;

  if v_note_cands is not null and jsonb_array_length(v_note_cands) > 0 then
    v_groups := v_groups || jsonb_build_array(
      jsonb_build_object(
        'kind', 'note',
        'label', 'Existing Notes',
        'candidates', v_note_cands
      )
    );
  end if;

  v_truncated := (
    coalesce(jsonb_array_length(v_passage_cands), 0) >= v_limit or
    coalesce(jsonb_array_length(v_lemma_cands), 0) >= v_limit or
    coalesce(jsonb_array_length(v_word_cands), 0) >= v_limit or
    coalesce(jsonb_array_length(v_concept_cands), 0) >= v_limit or
    coalesce(jsonb_array_length(v_place_cands), 0) >= v_limit or
    coalesce(jsonb_array_length(v_note_cands), 0) >= v_limit
  );

  return jsonb_build_object(
    'status', 'ok',
    'query', v_query,
    'interpretation', jsonb_build_object('type', v_interp),
    'groups', v_groups,
    'truncated', v_truncated
  );
end;
$$;

revoke all on function public.search_note_targets_v1(text, text[], int) from public, anon, authenticated;
grant execute on function public.search_note_targets_v1(text, text[], int) to anon, authenticated;
