-- Correct Hebrew lexical-component ordering in the AI passage lens.
-- Imported morph_no is not a reliable intra-word ordinal; retain it as source_morph_no
-- and number the source record stream in stable ID order within each word.
CREATE OR REPLACE FUNCTION public.research_passage_lens_v1(p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer DEFAULT 75)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_id integer;
  cap integer:=least(greatest(coalesce(p_max_tokens,75),10),120);
  total integer;
  tokens jsonb;
  language text;
BEGIN
 SELECT v.id INTO v_id FROM public.verses v WHERE v.book=p_book AND v.chapter=p_chapter AND v.verse_nr=p_verse;
 IF v_id IS NULL THEN RETURN jsonb_build_object('status','passage_not_found'); END IF;
 language:=CASE WHEN p_book<=39 THEN 'hebrew_aramaic' ELSE 'greek' END;
 IF p_book<=39 THEN
   SELECT count(*) INTO total FROM public.macula_hebrew_morphemes m WHERE m.canonical_verse_id=v_id;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('word',x.word_no,'part',x.computed_morpheme_order,'source_morph_no',x.morph_no,'text',x.text_form,'lemma',x.lemma,'strongs_raw',x.strong_x,
     'morphology',x.morph_code,'class',x.class,'sense_annotation',x.sense_number,'subject_ref',x.subjref,
     'participant_ref',x.participantref,'source_id',x.source_record_id) ORDER BY x.word_no,x.morph_no,x.id),'[]'::jsonb)
   INTO tokens FROM (SELECT m.*,row_number() OVER (PARTITION BY m.word_no ORDER BY m.id) AS computed_morpheme_order FROM public.macula_hebrew_morphemes m WHERE m.canonical_verse_id=v_id ORDER BY m.word_no,m.id LIMIT cap) x;
 ELSE
   SELECT count(*) INTO total FROM public.macula_greek_tokens m WHERE m.canonical_verse_id=v_id AND m.edition_key='macula-greek-nestle1904';
   SELECT COALESCE(jsonb_agg(jsonb_build_object('word',x.word_no,'text',x.text_form,'lemma',x.lemma,'strongs_raw',x.strongs,
     'morphology',x.morph_code,'grammatical_role',x.role,'semantic_frame_source',x.frame,
     'subject_ref',x.subjref,'referent',x.referent,'source_id',x.source_record_id)
     ORDER BY x.word_no,x.id),'[]'::jsonb)
   INTO tokens FROM (SELECT * FROM public.macula_greek_tokens WHERE canonical_verse_id=v_id
     AND edition_key='macula-greek-nestle1904' ORDER BY word_no,id LIMIT cap) x;
 END IF;
 RETURN jsonb_build_object('schema_version',1,'status','ok','reference',jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse,'verse_id',v_id),
   'language',language,'macula_edition',CASE WHEN p_book<=39 THEN 'macula-hebrew-wlc' ELSE 'macula-greek-nestle1904' END,
   'english_web',(SELECT r.text FROM public.reader_english_verses r WHERE r.book=p_book AND r.chapter=p_chapter AND r.verse_nr=p_verse AND r.edition_id='webp-2026-11' LIMIT 1),
   'tokens',tokens,'coverage',jsonb_build_object('source_token_rows',total,'returned',jsonb_array_length(tokens),'truncated',total>cap),
   'epistemic_notes',CASE WHEN p_book<=39 THEN jsonb_build_array(
      'MACULA Hebrew morphology and source sense/participant references, not automatically a verified lexical sense or semantic agent.',
      'Restricted SDBH semantic domains and unverified Hebrew frame are excluded.',
      'MACULA verse text may differ from the primary STEP reading; raw IDs are source-specific.')
    ELSE jsonb_build_array(
      'MACULA Greek role is grammatical; frame and discourse references are source annotations, not a verified theological claim.',
      'Edition Nestle1904 is not identical to NA28; do not merge its tokens by ordinal.',
      'Restricted Louw-Nida/MARBLE domains are excluded.') END,
   'next_step','Investigate exact token and phrase scope with get_verse_hydrated or research_macula_syntax. Detect negation, quoted voice and genre before interpretation.');
END $function$
;
