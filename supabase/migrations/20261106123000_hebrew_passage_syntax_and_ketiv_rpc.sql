-- Migration: 20261106123000_hebrew_passage_syntax_and_ketiv_rpc.sql
-- Description: Deterministic lookup RPC for Hebrew verse evidence, Ketiv/Qere variants, morphemes, syntax trees, and cross-source token mappings (F3)

create or replace function public.lookup_hebrew_verse_evidence_v1(
  p_book smallint,
  p_chapter smallint,
  p_verse smallint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_verse_id integer;
  v_result jsonb;
begin
  select id into v_verse_id
  from public.verses
  where book = p_book and chapter = p_chapter and verse_nr = p_verse;

  if v_verse_id is null then
    return jsonb_build_object(
      'found', false,
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse,
      'error', 'Verse not found in canonical corpus'
    );
  end if;

  with
  -- 1. Canonical verse info
  verse_info as (
    select
      v.id,
      v.book,
      b.name as book_name,
      b.usfm as book_usfm,
      v.chapter,
      v.verse_nr,
      v.word_ids
    from public.verses v
    join public.books b on b.id = v.book
    where v.id = v_verse_id
  ),
  -- 2. STEP surface words
  step_words as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'word_id', w.id,
          'position', ord.pos,
          'original_word', w.original_word,
          'transliteration', w.transliteration,
          'strongs_nr', w.strongs_nr,
          'grammar_code', w.grammar_code,
          'gematria', w.gematria
        ) order by ord.pos
      ), '[]'::jsonb) as words_json
    from verse_info vi
    cross join lateral unnest(vi.word_ids) with ordinality as ord(wid, pos)
    join public.words w on w.id = ord.wid
  ),
  -- 3. morphhb tokens with Ketiv/Qere and Aramaic tagging
  morph_tokens as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', mt.id,
          'morphhb_id', mt.morphhb_id,
          'word_num', mt.word_num,
          'word_text', mt.word_text,
          'lemma', mt.lemma,
          'morph_code', mt.morph_code,
          'cantillation', mt.cantillation,
          'is_ketiv', mt.is_ketiv,
          'is_qere', mt.is_qere,
          'qere_target_id', mt.qere_target_id,
          'is_aramaic', mt.is_aramaic,
          'step_word_id', mt.step_word_id,
          'link_status', mt.link_status,
          'source_record_id', mt.source_record_id
        ) order by mt.word_num, mt.is_ketiv desc, mt.id
      ), '[]'::jsonb) as morphhb_json,
      count(*) filter (where mt.is_ketiv) as ketiv_count,
      count(*) filter (where mt.is_qere) as qere_count,
      bool_or(mt.is_aramaic) as has_aramaic
    from public.morphhb_tokens mt
    where mt.canonical_verse_id = v_verse_id and mt.morphhb_id not like 'test%'
  ),
  -- 4. MACULA Hebrew morphemes
  mac_morphemes as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'macula_id', m.macula_id,
          'ref_mt', m.ref_mt,
          'word_no', m.word_no,
          'morph_no', m.morph_no,
          'class', m.class,
          'text_form', m.text_form,
          'after_text', m.after_text,
          'lemma', m.lemma,
          'strong_x', m.strong_x,
          'morph_code', m.morph_code,
          'lang', m.lang,
          'stem', m.stem,
          'morph_type', m.morph_type,
          'gloss', m.gloss,
          'english', m.english,
          'sense_number', m.sense_number,
          'subjref', m.subjref,
          'participantref', m.participantref,
          'word_id', m.word_id,
          'link_status', m.link_status
        ) order by m.word_no, m.morph_no, m.id
      ), '[]'::jsonb) as macula_json,
      bool_or(m.lang = 'A') as has_macula_aramaic
    from public.macula_hebrew_morphemes m
    where m.canonical_verse_id = v_verse_id
  ),
  -- 5. Syntax hierarchy (nodes & edges)
  syntax_nodes_data as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', sn.id,
          'node_key', sn.node_key,
          'node_type', sn.node_type,
          'start_word_position', sn.start_word_position,
          'end_word_position', sn.end_word_position,
          'head_word_position', sn.head_word_position,
          'syntactic_role', sn.syntactic_role,
          'grammar_summary', sn.grammar_summary
        ) order by sn.start_word_position, sn.id
      ), '[]'::jsonb) as syntax_nodes_json
    from public.syntax_nodes sn
    where sn.verse_id = v_verse_id
  ),
  syntax_edges_data as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', se.id,
          'source_node_id', se.source_node_id,
          'target_node_id', se.target_node_id,
          'relation_type', se.relation_type,
          'raw_relation_tag', se.raw_relation_tag,
          'dependent_word_position', se.dependent_word_position,
          'head_word_position', se.head_word_position
        ) order by se.id
      ), '[]'::jsonb) as syntax_edges_json
    from public.syntax_edges se
    where se.verse_id = v_verse_id
  ),
  -- 6. Cross-source explicit mappings
  cross_maps as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', ctm.id,
          'step_word_id', ctm.step_word_id,
          'morphhb_token_id', ctm.morphhb_token_id,
          'macula_morpheme_id', ctm.macula_morpheme_id,
          'mapping_status', ctm.mapping_status,
          'notes', ctm.notes,
          'derivation_method', ctm.derivation_method
        ) order by ctm.id
      ), '[]'::jsonb) as cross_mappings_json
    from public.cross_token_mappings ctm
    where ctm.canonical_verse_id = v_verse_id and (ctm.notes is null or ctm.notes not like '%בְּדִיקָה%')
  )
  select jsonb_build_object(
    'found', true,
    'verse', (select row_to_json(vi.*) from verse_info vi),
    'step_tokens', sw.words_json,
    'morphhb_tokens', mt.morphhb_json,
    'macula_morphemes', mm.macula_json,
    'syntax_nodes', snd.syntax_nodes_json,
    'syntax_edges', sed.syntax_edges_json,
    'cross_token_mappings', cm.cross_mappings_json,
    'summary', jsonb_build_object(
      'total_step_tokens', coalesce(jsonb_array_length(sw.words_json), 0),
      'total_morphhb_tokens', coalesce(jsonb_array_length(mt.morphhb_json), 0),
      'total_macula_morphemes', coalesce(jsonb_array_length(mm.macula_json), 0),
      'ketiv_count', coalesce(mt.ketiv_count, 0),
      'qere_count', coalesce(mt.qere_count, 0),
      'is_aramaic', coalesce(mt.has_aramaic, false) or coalesce(mm.has_macula_aramaic, false),
      'has_syntax_hierarchy', coalesce(jsonb_array_length(snd.syntax_nodes_json), 0) > 0,
      'syntax_edges_count', coalesce(jsonb_array_length(sed.syntax_edges_json), 0),
      'cross_mappings_count', coalesce(jsonb_array_length(cm.cross_mappings_json), 0)
    )
  )
  into v_result
  from verse_info vi
  cross join step_words sw
  cross join morph_tokens mt
  cross join mac_morphemes mm
  cross join syntax_nodes_data snd
  cross join syntax_edges_data sed
  cross join cross_maps cm;

  return v_result;
end;
$$;

grant execute on function public.lookup_hebrew_verse_evidence_v1(smallint, smallint, smallint) to anon, authenticated;
notify pgrst, 'reload schema';
