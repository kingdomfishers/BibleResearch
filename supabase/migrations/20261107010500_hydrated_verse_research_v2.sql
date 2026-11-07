-- FORM-02: Additive v2 hydrated verse research with set-based lexical formation,
-- roots, relatives, literary connections, homograph disambiguation, and token morphology separation.
create or replace function public.get_verse_research_v2(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' set statement_timeout = '60s' as $$
declare
  refs jsonb; item jsonb; mode text; sample_limit integer := 20;
  model_id text; packet jsonb; byte_size integer;
  profile_preset text; max_passages integer := 5;
  total_expanded integer;
  invalid constant jsonb := '{"schema_version":2,"status":"invalid_request","message":"Provide 1-5 passages (or up to 100 in analysis profile / sample mode); occurrences.mode is all or sample (limit 1-100); use a published chronology model."}';
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then return invalid; end if;
  if exists (select 1 from jsonb_object_keys(p_request) k where k not in ('passages','occurrences','chronology_model_id','profile','include_formation')) then return invalid; end if;

  refs := p_request->'passages';
  if refs is null or jsonb_typeof(refs) <> 'array' or jsonb_array_length(refs) = 0 then return invalid; end if;
  if (select count(distinct value) from jsonb_array_elements(refs)) <> jsonb_array_length(refs) then return invalid; end if;

  profile_preset := coalesce(p_request->>'profile', 'full');
  if profile_preset not in ('analysis', 'full') then return invalid; end if;

  mode := coalesce(p_request #>> '{occurrences,mode}', case when profile_preset = 'analysis' then 'sample' else 'all' end);
  if profile_preset = 'analysis' and not (p_request ? 'occurrences') then
    sample_limit := 5;
  end if;

  if p_request ? 'occurrences' then
    item := p_request->'occurrences';
    if jsonb_typeof(item) <> 'object' then return invalid; end if;
    if exists(select 1 from jsonb_object_keys(item) k where k not in ('mode','limit')) then return invalid; end if;
    if item ? 'mode' and jsonb_typeof(item->'mode') <> 'string' then return invalid; end if;
    if item ? 'limit' then
      if jsonb_typeof(item->'limit') <> 'number' or item->>'limit' !~ '^[0-9]{1,3}$' then return invalid; end if;
      sample_limit := (item->>'limit')::int;
      if sample_limit not between 1 and 100 or mode <> 'sample' then return invalid; end if;
    end if;
  end if;
  if mode not in ('all','sample') then return invalid; end if;

  if profile_preset = 'analysis' or mode = 'sample' then
    max_passages := 100;
  else
    max_passages := 5;
  end if;

  if p_request ? 'chronology_model_id' and jsonb_typeof(p_request->'chronology_model_id') <> 'string' then return invalid; end if;
  model_id := coalesce(p_request->>'chronology_model_id', 'theographic-verse-v1');
  if not exists(select 1 from public.chronology_models where id = model_id and published) then return invalid; end if;

  for item in select value from jsonb_array_elements(refs) loop
    if jsonb_typeof(item) <> 'object' then return invalid; end if;
    if not (
      (item ? 'book' and item ? 'chapter' and item ? 'verse' and not exists(select 1 from jsonb_object_keys(item) k where k not in ('book','chapter','verse')))
      or
      (item ? 'book' and item ? 'chapter' and item ? 'start_verse' and item ? 'end_verse' and not exists(select 1 from jsonb_object_keys(item) k where k not in ('book','chapter','start_verse','end_verse')))
    ) then return invalid; end if;

    if jsonb_typeof(item->'book') is distinct from 'number'
      or jsonb_typeof(item->'chapter') is distinct from 'number' then return invalid; end if;
    if item->>'book' !~ '^[0-9]{1,2}$' or item->>'chapter' !~ '^[0-9]{1,3}$' then return invalid; end if;
    if (item->>'book')::int not between 1 and 66 or (item->>'chapter')::int not between 1 and 150 then return invalid; end if;

    if item ? 'verse' then
      if jsonb_typeof(item->'verse') is distinct from 'number' or item->>'verse' !~ '^[0-9]{1,3}$' then return invalid; end if;
      if (item->>'verse')::int not between 0 and 176 then return invalid; end if;
    else
      if jsonb_typeof(item->'start_verse') is distinct from 'number' or item->>'start_verse' !~ '^[0-9]{1,3}$' then return invalid; end if;
      if jsonb_typeof(item->'end_verse') is distinct from 'number' or item->>'end_verse' !~ '^[0-9]{1,3}$' then return invalid; end if;
      if (item->>'start_verse')::int not between 0 and 176 or (item->>'end_verse')::int not between 0 and 176 then return invalid; end if;
      if (item->>'start_verse')::int > (item->>'end_verse')::int then return invalid; end if;
    end if;
  end loop;

  select count(distinct (r.item->>'book')::int || ':' || (r.item->>'chapter')::int || ':' || g.v)
  into total_expanded
  from jsonb_array_elements(refs) with ordinality r(item, ord)
  cross join lateral (
    select generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) as v
  ) g;

  if total_expanded not between 1 and max_passages then return invalid; end if;

  if exists (
    select 1 from (
      select distinct
        (r.item->>'book')::int as book,
        (r.item->>'chapter')::int as chapter,
        g.v as verse
      from jsonb_array_elements(refs) with ordinality r(item, ord)
      cross join lateral (
        select generate_series(
          coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
          coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
        ) as v
      ) g
    ) req
    where not exists (
      select 1 from public.verses v
      where v.book = req.book and v.chapter = req.chapter and v.verse_nr = req.verse
    )
  ) then
    return jsonb_build_object('schema_version', 2, 'status', 'passage_not_found', 'requested_passages', refs);
  end if;

  with req_passages as materialized (
    select
      row_number() over (order by min(r.ord), (r.item->>'book')::int, (r.item->>'chapter')::int, g.v)::int as ord,
      (r.item->>'book')::int as book,
      (r.item->>'chapter')::int as chapter,
      g.v as verse
    from jsonb_array_elements(refs) with ordinality r(item, ord)
    cross join lateral (
      select generate_series(
        coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
        coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
      ) as v
    ) g
    group by (r.item->>'book')::int, (r.item->>'chapter')::int, g.v
  ), passages as materialized (
    select v.*, r.ord, (v.book || ':' || v.chapter || ':' || v.verse_nr) as verse_ref
    from req_passages r
    join public.verses v on v.book = r.book and v.chapter = r.chapter and v.verse_nr = r.verse
  ), tokens as materialized (
    select v.id verse_id, v.verse_ref, u.ord::integer word_position, w.*,
      s.source_english, s.source_ref, s.source_name, s.source_commit
    from passages v
    cross join lateral unnest(v.word_ids) with ordinality u(word_id, ord)
    join public.words w on w.id = u.word_id
    left join public.verse_translation_sources s on s.verse_id = v.id and s.word_position = u.ord and s.word_id = w.id
  ), targets as materialized (
    select distinct strongs_nr from tokens
  ), lexemes as materialized (
    select t.strongs_nr, coalesce(jsonb_agg(to_jsonb(l)-'id' order by l.lexeme_key)
      filter(where l.id is not null), '[]'::jsonb) candidates
    from targets t left join public.lexemes l on l.base_strongs = t.strongs_nr group by t.strongs_nr
  ), lexical as materialized (
    select t.strongs_nr, jsonb_build_object(
      'identity_scope', 'base_strongs',
      'strongs_nr', t.strongs_nr,
      'lexeme_candidates', l.candidates,
      'needs_disambiguation', jsonb_array_length(l.candidates) > 1,
      'sense_status', 'not_assigned_to_token',
      'semantic_annotation_status', case when jsonb_array_length(l.candidates) = 0 then 'unavailable' else 'candidate_lexemes_only' end,
      'occurrences', o.doc,
      'top_connected_words', c.doc,
      'connection_coverage', jsonb_build_object(
        'requested', 7, 'returned', jsonb_array_length(c.doc),
        'status', case when jsonb_array_length(c.doc) = 0 then 'no_cached_connections' else 'cached' end,
        'method', 'Cached within-verse base-Strongs token-pair associations; scores are not semantic equivalence.'
      ),
      'limitations', 'Base Strong''s groups inflections and may combine homographs. Multi-valence and paronomasia are preserved across contexts.'
    ) doc
    from targets t
    join lexemes l using(strongs_nr)
    cross join lateral (
      select jsonb_build_object(
        'counting_method', 'Sum of matching tokens per passage across base-Strongs inflections',
        'corpus_token_total', coalesce(sum(occurrence_count), 0),
        'distinct_passage_total', count(*),
        'returned_reference_count', count(*) filter(where mode = 'all' or rn <= sample_limit),
        'complete', mode = 'all' or count(*) <= sample_limit,
        'references', coalesce(jsonb_agg(jsonb_build_object(
          'book', q.book, 'chapter', q.chapter, 'verse', q.verse_nr, 'occurrence_count', q.occurrence_count
        ) order by q.book, q.chapter, q.verse_nr) filter(where mode = 'all' or rn <= sample_limit), '[]'::jsonb)
      ) doc
      from (
        select a.*, row_number() over(order by a.book, a.chapter, a.verse_nr) rn
        from public.prompt_word_occurrences(t.strongs_nr) a
      ) q
    ) o
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.rank), '[]'::jsonb) doc from (
        select row_number() over(order by a.score desc, a.word_id) rank, a.*,
          w.english_translations, w.biblical_def, w.physical_def, 'stepbible-2026-11'::text source_release_key
        from public.prompt_word_cooccurrences(t.strongs_nr) a
        join public.words w on w.id = a.word_id
        order by a.score desc, a.word_id limit 7
      ) q
    ) c
  ), token_morphology as materialized (
    select wfl.word_id,
      coalesce(jsonb_agg(jsonb_build_object(
        'order', wfl.component_order,
        'role', wfl.morpheme_role,
        'surface', wfl.morpheme_surface,
        'gloss', wfl.morpheme_gloss,
        'grammar_code', wfl.grammar_code,
        'lemma_key', l.lemma_key,
        'is_context_ambiguous', wfl.is_context_ambiguous
      ) order by wfl.component_order, wfl.id), '[]'::jsonb) as morphemes,
      array_agg(distinct l.lemma_key order by l.lemma_key) as lemma_keys,
      array_agg(distinct wfl.lemma_id) as lemma_ids
    from public.word_form_lemmas wfl
    join public.lemmas l on l.id = wfl.lemma_id
    where wfl.word_id in (select distinct id from tokens)
    group by wfl.word_id
  ), lemma_ids as materialized (
    select distinct unnest(lemma_ids) as id from token_morphology
    union
    select distinct l.id from public.lemmas l where l.base_strongs in (select distinct strongs_nr from targets)
  ), formations_agg as materialized (
    select f.lemma_id, jsonb_agg(jsonb_build_object(
      'formation_id', f.id, 'lemma_id', f.lemma_id, 'analysis_key', f.analysis_key,
      'formation_type', f.formation_type, 'whole_word_gloss', f.whole_word_gloss,
      'evidence_status', f.evidence_status, 'evidence_note', f.evidence_note,
      'origin_mode', f.origin_mode, 'review_status', f.review_status,
      'source', jsonb_build_object('title', f.source_title, 'url', f.source_url, 'record_id', f.source_record_id),
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'order', c.component_order, 'surface_text', c.surface_text,
          'role', c.component_role, 'semantic_contribution', c.semantic_contribution,
          'component_note', c.component_note,
          'lemma_id', cl.id, 'lemma_key', cl.lemma_key, 'base_strongs', cl.base_strongs,
          'original_lemma', cl.lemma_script, 'transliteration', cl.transliteration,
          'lexeme_id', cx.id, 'primary_gloss', cx.primary_gloss,
          'senses', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'sense_code', ss.sense_code, 'short_gloss', ss.short_gloss,
              'source_attribution', ss.source_attribution
            ) order by ss.sense_order, ss.id), '[]'::jsonb)
            from (select * from public.lexical_senses s where s.lemma_id = cl.id order by s.sense_order, s.id limit 5) ss
          )
        ) order by c.component_order)
        from public.lemma_components c
        left join public.lemmas cl on cl.id = c.component_lemma_id
        left join public.lexemes cx on cx.id = coalesce(c.component_lexeme_id, cl.primary_lexeme_id)
        where c.formation_id = f.id
      ), '[]'::jsonb)
    ) order by f.id) as formations
    from public.lexical_formations f
    where f.lemma_id in (select id from lemma_ids)
    group by f.lemma_id
  ), roots_agg as materialized (
    select rl.lemma_id, jsonb_agg(jsonb_build_object(
      'lemma_id', rl.lemma_id, 'lemma_key', l.lemma_key, 'root_id', r.id, 'root_key', r.root_key,
      'root_script', r.root_script, 'root_transliteration', r.transliteration,
      'root_kind', r.root_kind, 'relation_type', rl.etymology_type,
      'implies_synonymy', false, 'evidence_note', rl.evidence_note,
      'origin_mode', rl.origin_mode, 'derivation_method', rl.derivation_method,
      'source_record_id', rl.source_record_id, 'source_release_key', sr.release_key
    ) order by r.root_key) as roots
    from public.lemma_root_links rl
    join public.lemmas l on l.id = rl.lemma_id
    join public.lexical_roots r on r.id = rl.root_id
    left join public.source_releases sr on sr.id = rl.source_release_id
    where rl.lemma_id in (select id from lemma_ids)
    group by rl.lemma_id
  ), relatives_agg as materialized (
    select rel.source_lemma_id as lemma_id, jsonb_agg(rel.doc order by rel.relative_lemma_key) as relatives
    from (
      select roots.lemma_id as source_lemma_id, l.lemma_key as relative_lemma_key, jsonb_build_object(
        'root_key', r.root_key, 'relative_lemma_id', l.id, 'relative_lemma_key', l.lemma_key,
        'base_strongs', l.base_strongs, 'lemma_script', l.lemma_script,
        'transliteration', l.transliteration, 'primary_gloss', lx.primary_gloss,
        'relation_type', related.etymology_type, 'source_record_id', related.source_record_id
      ) as doc
      from (
        select distinct rl.lemma_id, rl.root_id from public.lemma_root_links rl
        where rl.lemma_id in (select id from lemma_ids)
      ) roots
      join public.lexical_roots r on r.id = roots.root_id
      join public.lemma_root_links related on related.root_id = r.id
      join public.lemmas l on l.id = related.lemma_id
      left join public.lexemes lx on lx.id = l.primary_lexeme_id
      where not (l.id in (select id from lemma_ids))
    ) rel
    group by rel.source_lemma_id
  ), connections_agg as materialized (
    select conn.lemma_id, jsonb_agg(conn.doc order by conn.connection_id) as connections
    from (
      select c.subject_lemma_id as lemma_id, c.id as connection_id, jsonb_build_object(
        'connection_id', c.id, 'source_lemma_id', c.subject_lemma_id, 'target_lemma_id', c.target_lemma_id,
        'source_lemma_key', sl.lemma_key, 'target_lemma_key', tl.lemma_key,
        'source_strongs', sl.base_strongs, 'target_strongs', tl.base_strongs,
        'relation_type', c.relation_type, 'evidence_status', c.evidence_status,
        'evidence_note', c.evidence_note, 'passage_reference', c.passage_reference,
        'source_title', c.source_title, 'source_url', c.source_url, 'derivation_method', c.derivation_method
      ) as doc
      from public.lexical_connections c
      join public.lemmas sl on sl.id = c.subject_lemma_id
      join public.lemmas tl on tl.id = c.target_lemma_id
      where c.subject_lemma_id in (select id from lemma_ids)
      union all
      select c.target_lemma_id as lemma_id, c.id as connection_id, jsonb_build_object(
        'connection_id', c.id, 'source_lemma_id', c.subject_lemma_id, 'target_lemma_id', c.target_lemma_id,
        'source_lemma_key', sl.lemma_key, 'target_lemma_key', tl.lemma_key,
        'source_strongs', sl.base_strongs, 'target_strongs', tl.base_strongs,
        'relation_type', c.relation_type, 'evidence_status', c.evidence_status,
        'evidence_note', c.evidence_note, 'passage_reference', c.passage_reference,
        'source_title', c.source_title, 'source_url', c.source_url, 'derivation_method', c.derivation_method
      ) as doc
      from public.lexical_connections c
      join public.lemmas sl on sl.id = c.subject_lemma_id
      join public.lemmas tl on tl.id = c.target_lemma_id
      where c.target_lemma_id in (select id from lemma_ids)
    ) conn
    group by conn.lemma_id
  ), hydrated_lemma_formations as materialized (
    select l.lemma_key, jsonb_build_object(
      'lemma_id', l.id,
      'lemma_key', l.lemma_key,
      'language', l.language,
      'lemma_script', l.lemma_script,
      'transliteration', l.transliteration,
      'base_strongs', l.base_strongs,
      'primary_pos', l.primary_pos,
      'homograph_tag', l.homograph_tag,
      'primary_gloss', lx.primary_gloss,
      'formations', coalesce(f.formations, '[]'::jsonb),
      'documented_roots', coalesce(r.roots, '[]'::jsonb),
      'root_relatives', coalesce(rel.relatives, '[]'::jsonb),
      'literary_connections', coalesce(conn.connections, '[]'::jsonb)
    ) as formation_entry
    from lemma_ids li
    join public.lemmas l on l.id = li.id
    left join public.lexemes lx on lx.id = l.primary_lexeme_id
    left join formations_agg f on f.lemma_id = l.id
    left join roots_agg r on r.lemma_id = l.id
    left join relatives_agg rel on rel.lemma_id = l.id
    left join connections_agg conn on conn.lemma_id = l.id
  ), semantic_paths as materialized (
    select a.id, a.subject_node_id, a.object_node_id,
      to_jsonb(a)-'id'-'subject_node_id'-'object_node_id' || jsonb_build_object(
        'subject', sn.display_label, 'object', ob.display_label,
        'evidence_spans', coalesce((
          select jsonb_agg(to_jsonb(e)-'id'-'assertion_id' order by e.step_order, e.id)
          from public.assertion_evidence e where e.assertion_id = a.id
        ), '[]'::jsonb)
      ) doc
    from public.assertions a
    join public.research_nodes sn on sn.id = a.subject_node_id
    join public.research_nodes ob on ob.id = a.object_node_id
    where a.review_status = 'reviewed'
  ), verse_packets as materialized (
    select v.ord, v.verse_ref, jsonb_build_object(
      'verse_id', v.id,
      'verse_ref', v.verse_ref,
      'passage', jsonb_build_object(
        'book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0
      ),
      'words', coalesce((
        select jsonb_agg(jsonb_build_object(
          'word_position', t.word_position, 'word_id', t.id, 'original_word', t.original_word,
          'transliteration', t.transliteration, 'strongs_nr', t.strongs_nr, 'lexical_entry_key', t.strongs_nr,
          'disambiguated_lemmas', coalesce(tm.lemma_keys, '{}'::text[]),
          'morphology', coalesce(tm.morphemes, '[]'::jsonb),
          'grammar', jsonb_build_object(
            'raw_code', t.grammar_code,
            'scheme', case when t.source_name like 'TAHOT%' then 'STEP TEHMC (ETCBC/OpenScriptures adapted)'
              when t.source_name like 'TAGNT%' then 'STEP TEGMC (Tauber adapted)' else null end,
            'decoded_grammar', public.decode_grammar_v1(t.grammar_code),
            'decoded_features', public.decode_grammar_v1(t.grammar_code),
            'unresolved_tags', case when t.grammar_code is null or public.decode_grammar_v1(t.grammar_code) = '{}'::jsonb
              then case when t.grammar_code is null then '[]'::jsonb else jsonb_build_array(t.grammar_code) end
              else '[]'::jsonb end
          ),
          'translations', jsonb_build_object(
            'source_english', t.source_english, 'source_ref', t.source_ref,
            'source_name', t.source_name, 'source_commit', t.source_commit,
            'corpus_gloss', t.english_translations[1],
            'available_renderings', public.translation_options_v1(t.id, t.source_english)
          ),
          'definitions', jsonb_build_object(
            'biblical', t.biblical_def, 'physical', t.physical_def,
            'source_release_key', 'stepbible-2026-11'
          ),
          'lexeme_candidates', (select candidates from lexemes l where l.strongs_nr = t.strongs_nr)
        ) order by t.word_position)
        from tokens t
        left join token_morphology tm on tm.word_id = t.id
        where t.verse_id = v.id
      ), '[]'::jsonb),
      'coverage', jsonb_build_object(
        'semantic_scope', 'Reviewed passage matches and lexically related concept candidates; not token-sense assignments',
        'grammar_decoding', 'Server-side structured decoding active via decode_grammar_v1',
        'semantic_domains', 'candidate_lexemes_only',
        'token_senses', 'unavailable'
      )
    ) doc from passages v
  ), top_chronology as materialized (
    select v.ord, v.verse_ref, public.get_verse_chronology_v1(v.book, v.chapter, v.verse_nr, model_id) doc
    from passages v
  ), top_geography as materialized (
    select v.ord, v.verse_ref, public.get_verse_geography(v.book, v.chapter, v.verse_nr) doc
    from passages v
  ), top_semantics as materialized (
    select v.ord, v.verse_ref, coalesce((
      select jsonb_agg(sp.doc order by sp.id)
      from semantic_paths sp
      where exists(
        select 1 from public.assertion_evidence e
        where e.assertion_id = sp.id and e.book = v.book
          and (v.chapter, v.verse_nr) >= (e.start_chapter, e.start_verse)
          and (v.chapter, v.verse_nr) <= (e.end_chapter, e.end_verse)
      ) or exists(
        select 1 from public.research_nodes n
        join public.concepts c on c.id = n.concept_id
        where n.id in (sp.subject_node_id, sp.object_node_id)
          and c.primary_strongs && array(select t.strongs_nr::text from tokens t where t.verse_id = v.id)
      )
    ), '[]'::jsonb) doc
    from passages v
  )
  select jsonb_build_object(
    'schema_version', 2,
    'status', 'ok',
    'verses', (select jsonb_agg(doc order by ord) from verse_packets),
    'chronology', (select jsonb_object_agg(verse_ref, doc order by ord) from top_chronology),
    'geography', (select jsonb_object_agg(verse_ref, doc order by ord) from top_geography),
    'semantic_evidence', (select jsonb_object_agg(verse_ref, doc order by ord) from top_semantics),
    'lexical_entries', (select jsonb_object_agg(strongs_nr, doc order by strongs_nr) from lexical),
    'lexical_formations', (select jsonb_object_agg(lemma_key, formation_entry order by lemma_key) from hydrated_lemma_formations),
    'sources', coalesce((select jsonb_agg(to_jsonb(s)-'id'-'created_at' order by s.release_key)
      from public.source_releases s where s.release_key in ('stepbible-2026-11','curated-motifs-v1')), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'corpus', 'primary STEP Hebrew/Aramaic OT and NA28-membership Greek NT',
      'requested_passage_count', jsonb_array_length(refs),
      'returned_passage_count', (select count(*) from passages),
      'lexical_entry_count', (select count(*) from targets),
      'occurrence_mode', mode,
      'occurrences_complete', (select bool_and((doc #>> '{occurrences,complete}')::boolean) from lexical),
      'chronology_evidence_complete', (select bool_and(coalesce((doc #>> '{status}') = 'ok', false)
        and not coalesce((doc #>> '{evidence_truncated}')::boolean, true)
        and not coalesce((doc #>> '{assertions_truncated}')::boolean, true)) from top_chronology),
      'component_statuses', (select jsonb_agg(jsonb_build_object(
        'verse_ref', v.verse_ref,
        'passage', jsonb_build_object('book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0),
        'chronology', c.doc #>> '{status}',
        'geography', g.doc #>> '{status}'
      ) order by v.ord) from passages v join top_chronology c using(verse_ref) join top_geography g using(verse_ref)),
      'max_passages', max_passages,
      'max_packet_bytes', 8388608,
      'semantic_coverage', 'Limited reviewed annotations; empty results do not establish absence of a relationship',
      'polysemy_homographs_preserved', true,
      'payload_deduplication', 'Hoisted top-level chronology, geography, semantic_evidence, and lexical_formations dictionaries',
      'lexical_formation_coverage', jsonb_build_object(
        'deduplicated_by', 'disambiguated_lemma_key',
        'homographs_preserved', true,
        'token_morphology_distinguished_from_composition', true,
        'spelling_similarity_not_proven_etymology', true,
        'roots_do_not_imply_synonymy', true,
        'missing_evidence_is_not_evidence_of_absence', true
      ),
      'private_translation_choices_included', false
    )
  ) into packet;

  byte_size := octet_length(packet::text);
  if byte_size > 8388608 then
    return jsonb_build_object(
      'schema_version', 2,
      'status', 'packet_limit_exceeded',
      'requested_passages', refs,
      'measured_bytes', byte_size,
      'max_packet_bytes', 8388608,
      'message', 'Request fewer passages or explicitly select occurrences.mode=sample. No partial packet was returned.'
    );
  end if;

  return packet;
end;
$$;

revoke all on function public.get_verse_research_v2(jsonb) from public;
grant execute on function public.get_verse_research_v2(jsonb) to anon,authenticated,service_role;
alter function public.get_verse_research_v2(jsonb) set statement_timeout = '60s';
notify pgrst, 'reload schema';
