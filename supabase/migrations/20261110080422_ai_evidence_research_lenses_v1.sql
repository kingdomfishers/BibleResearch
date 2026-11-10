-- Additive deployed BibleResearch AI evidence lenses, 2026-11-10.
-- Generated from verified live function definitions. Each is SECURITY INVOKER; public corpus only.

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
   SELECT COALESCE(jsonb_agg(jsonb_build_object('word',x.word_no,'part',x.morph_no,'text',x.text_form,'lemma',x.lemma,'strongs_raw',x.strong_x,
     'morphology',x.morph_code,'class',x.class,'sense_annotation',x.sense_number,'subject_ref',x.subjref,
     'participant_ref',x.participantref,'source_id',x.source_record_id) ORDER BY x.word_no,x.morph_no,x.id),'[]'::jsonb)
   INTO tokens FROM (SELECT * FROM public.macula_hebrew_morphemes WHERE canonical_verse_id=v_id ORDER BY word_no,morph_no,id LIMIT cap) x;
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

CREATE OR REPLACE FUNCTION public.research_word_bridge_v1(p_left text, p_right text, p_limit integer DEFAULT 8, p_window integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '12s'
AS $function$
DECLARE
 ql text := lower(btrim(coalesce(p_left,'')));
 qr text := lower(btrim(coalesce(p_right,'')));
 cl text;
 cr text;
 bl text;
 br text;
 left_codes text[];
 right_codes text[];
 left_ids integer[];
 right_ids integer[];
 lim integer:=least(greatest(coalesce(p_limit,8),1),12);
 win integer:=least(greatest(coalesce(p_window,1),0),2);
 result jsonb;
BEGIN
 IF length(ql)<1 OR length(qr)<1 OR length(ql)>96 OR length(qr)>96 THEN
   RETURN jsonb_build_object('status','invalid_query','message','Provide two valid 1-96 character terms.');
 END IF;
 cl:=upper(regexp_replace(ql,'^([hg])0*([0-9]+)([a-z]?)$','\1\2\3','i'));
 cr:=upper(regexp_replace(qr,'^([hg])0*([0-9]+)([a-z]?)$','\1\2\3','i'));
 bl:=regexp_replace(cl,'^([HG][0-9]+)[A-Z]$','\1');
 br:=regexp_replace(cr,'^([HG][0-9]+)[A-Z]$','\1');
 SELECT COALESCE(array_agg(DISTINCT s.base_strongs),'{}'::text[]) INTO left_codes
 FROM (
   SELECT l.base_strongs,
      CASE WHEN lower(l.lemma_key)=ql OR EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=cl) THEN 0
           WHEN l.base_strongs=bl AND ql ~ '^[hg][0-9]+[a-z]?$' THEN 1
           WHEN lower(l.lemma_script)=ql OR lower(l.transliteration)=ql THEN 2
           WHEN EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND lower(btrim(x.primary_gloss))=ql) THEN 3
           WHEN EXISTS(SELECT 1 FROM public.lexical_senses x WHERE x.lemma_id=l.id AND
              (lower(btrim(x.short_gloss))=ql OR lower(btrim(split_part(x.short_gloss,':',2)))=ql)) THEN 4
           ELSE 99 END rank
   FROM public.lemmas l
 ) s WHERE s.rank<99 AND s.rank<=4;
 SELECT COALESCE(array_agg(DISTINCT s.base_strongs),'{}'::text[]) INTO right_codes
 FROM (
   SELECT l.base_strongs,
      CASE WHEN lower(l.lemma_key)=qr OR EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=cr) THEN 0
           WHEN l.base_strongs=br AND qr ~ '^[hg][0-9]+[a-z]?$' THEN 1
           WHEN lower(l.lemma_script)=qr OR lower(l.transliteration)=qr THEN 2
           WHEN EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND lower(btrim(x.primary_gloss))=qr) THEN 3
           WHEN EXISTS(SELECT 1 FROM public.lexical_senses x WHERE x.lemma_id=l.id AND
              (lower(btrim(x.short_gloss))=qr OR lower(btrim(split_part(x.short_gloss,':',2)))=qr)) THEN 4
           ELSE 99 END rank
   FROM public.lemmas l
 ) s WHERE s.rank<99 AND s.rank<=4;
 IF cardinality(left_codes)=0 OR cardinality(right_codes)=0 THEN
   RETURN jsonb_build_object('status','unresolved','left_codes',left_codes,'right_codes',right_codes,
      'message','One or both terms do not resolve by exact lexical identity/gloss; try Strong codes.');
 END IF;
 SELECT array_agg(id) INTO left_ids FROM public.words WHERE strongs_nr=ANY(left_codes);
 SELECT array_agg(id) INTO right_ids FROM public.words WHERE strongs_nr=ANY(right_codes);
 IF left_ids IS NULL OR right_ids IS NULL THEN
   RETURN jsonb_build_object('status','no_attested_tokens','left_codes',left_codes,'right_codes',right_codes);
 END IF;
 WITH left_verses AS (
   SELECT v.id,v.book,v.chapter,v.verse_nr FROM public.verses v WHERE v.word_ids && left_ids
 ), related AS (
   SELECT a.id AS left_id,a.book,a.chapter,a.verse_nr AS left_verse,b.id AS right_id,b.verse_nr AS right_verse,
     abs(b.verse_nr-a.verse_nr) AS distance
   FROM left_verses a JOIN public.verses b ON b.book=a.book AND b.chapter=a.chapter
     AND b.verse_nr BETWEEN a.verse_nr-win AND a.verse_nr+win
     AND b.word_ids && right_ids
 ), representatives AS (
   SELECT DISTINCT ON (book,chapter,left_verse,right_verse)
     * FROM related ORDER BY book,chapter,left_verse,right_verse,distance
 ), samples AS (
   SELECT * FROM representatives ORDER BY distance,book,chapter,left_verse,right_verse LIMIT lim
 )
 SELECT jsonb_build_object('schema_version',1,'status','ok','left_query',p_left,'right_query',p_right,
  'left_lexical_strongs',to_jsonb(left_codes),'right_lexical_strongs',to_jsonb(right_codes),
  'window_verses_within_chapter',win,'search_scope','canonical STEP verse word_ids; no across-chapter joins; text editions not double-counted',
  'relation_class','statistical_passage_proximity_only',
  'matches',COALESCE(jsonb_agg(jsonb_build_object(
    'type',CASE WHEN x.distance=0 THEN 'same_verse' ELSE 'adjacent_verse' END,
    'book',x.book,'chapter',x.chapter,'left_verse',x.left_verse,'right_verse',x.right_verse,
    'left_english_web',(SELECT re.text FROM public.reader_english_verses re
        WHERE re.book=x.book AND re.chapter=x.chapter AND re.verse_nr=x.left_verse AND re.edition_id='webp-2026-11' LIMIT 1),
    'right_english_web',CASE WHEN x.distance=0 THEN NULL ELSE
        (SELECT re.text FROM public.reader_english_verses re WHERE re.book=x.book AND re.chapter=x.chapter
           AND re.verse_nr=x.right_verse AND re.edition_id='webp-2026-11' LIMIT 1) END,
    'left_tokens',COALESCE((SELECT jsonb_agg(jsonb_build_object('position',t.word_position,'surface',w.original_word,
        'strongs',w.strongs_nr,'local_gloss',t.source_english) ORDER BY t.word_position)
      FROM public.verse_translation_sources t JOIN public.words w ON w.id=t.word_id
      WHERE t.verse_id=x.left_id AND w.strongs_nr=ANY(left_codes)),'[]'::jsonb),
    'right_tokens',COALESCE((SELECT jsonb_agg(jsonb_build_object('position',t.word_position,'surface',w.original_word,
        'strongs',w.strongs_nr,'local_gloss',t.source_english) ORDER BY t.word_position)
      FROM public.verse_translation_sources t JOIN public.words w ON w.id=t.word_id
      WHERE t.verse_id=x.right_id AND w.strongs_nr=ANY(right_codes)),'[]'::jsonb)
   ) ORDER BY x.distance,x.book,x.chapter,x.left_verse,x.right_verse),'[]'::jsonb),
  'sampling','First canonical matches prioritizing same-verse, then short adjacent-verse contexts; not exhaustive or importance ranked',
  'limits',jsonb_build_object('returned',count(*),'max',lim,'more_matches_possible',count(*)=lim),
  'epistemic_warning','Co-occurrence does NOT imply synonymy, metaphor, causation, action-role, typology or theological identity. Inspect grammar, discourse and counterexamples before proposing a relation.')
 INTO result FROM samples x;
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.research_word_lens_v1(p_query text, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '12s'
AS $function$
DECLARE
  q text := lower(btrim(coalesce(p_query,'')));
  code text;
  base_code text;
  lim integer := least(greatest(coalesce(p_limit,5),1),8);
  result jsonb;
BEGIN
 IF length(q)<1 OR length(q)>96 THEN
  RETURN jsonb_build_object('status','invalid_query','message','Provide a 1-96 character Strong code, original lemma, transliteration, or exact lexical gloss.');
 END IF;
 code := upper(regexp_replace(q,'^([hg])0*([0-9]+)([a-z]?)$','\1\2\3','i'));
 base_code := regexp_replace(code,'^([HG][0-9]+)[A-Z]$','\1');
 WITH candidates AS (
   SELECT l.id,l.base_strongs,l.lemma_key,l.language,l.lemma_script,l.transliteration,l.primary_pos,
     CASE
       WHEN lower(l.lemma_key)=q OR EXISTS(SELECT 1 FROM public.lexemes lx WHERE lx.lemma_id=l.id AND upper(lx.extended_strongs)=code) THEN 0
       WHEN l.base_strongs=base_code AND q ~ '^h[0-9]+[a-z]?$|^g[0-9]+[a-z]?$' THEN 1
       WHEN lower(l.lemma_script)=q THEN 2
       WHEN lower(l.transliteration)=q THEN 3
       WHEN EXISTS(SELECT 1 FROM public.lexemes lx WHERE lx.lemma_id=l.id AND lower(btrim(lx.primary_gloss))=q) THEN 4
       WHEN EXISTS(SELECT 1 FROM public.lexical_senses s WHERE s.lemma_id=l.id AND
            (lower(btrim(s.short_gloss))=q OR lower(btrim(split_part(s.short_gloss,':',2)))=q)) THEN 5
       ELSE 99 END AS rank
   FROM public.lemmas l
 ), selected AS (
   SELECT * FROM candidates WHERE rank<99 ORDER BY rank,base_strongs,lemma_key LIMIT lim
 )
 SELECT jsonb_build_object('schema_version',1,'status',CASE WHEN count(*)>0 THEN 'ok' ELSE 'no_exact_lexical_match' END,
    'query',p_query,'resolution_policy','Exact Strong, original lemma, transliteration or lexicon gloss; no English substring search or automatic sense merge',
    'match_count_returned',count(*),'truncated_candidates_possible',count(*)=lim,
    'candidates',COALESCE(jsonb_agg(
      jsonb_build_object('lemma_id',s.id::text,'lemma_key',s.lemma_key,'strongs',s.base_strongs,
       'language',s.language,'original',s.lemma_script,'transliteration',s.transliteration,'pos',s.primary_pos,'resolution_rank',s.rank,
       'senses',COALESCE((
        SELECT jsonb_agg(jsonb_build_object('sense_id',z.id::text,'sense',z.short_gloss,'source',z.source_attribution)
           ORDER BY z.sense_order) FROM (
             SELECT * FROM public.lexical_senses ls WHERE ls.lemma_id=s.id ORDER BY ls.sense_order LIMIT 7
           ) z
       ),'[]'::jsonb),
       'root_links',COALESCE((
         SELECT jsonb_agg(jsonb_build_object('root_id',r.root_id::text,'relation',r.etymology_type,'source',r.source_record_id))
         FROM (SELECT * FROM public.lemma_root_links WHERE lemma_id=s.id LIMIT 5) r
       ),'[]'::jsonb),
       'occurrence_counts',(
         SELECT jsonb_build_object('tokens',count(*),'distinct_verses',count(DISTINCT t.verse_id),'source','STEP ordered word positions')
         FROM public.words w JOIN public.verse_translation_sources t ON t.word_id=w.id WHERE w.strongs_nr=s.base_strongs
       ),
       'book_diverse_samples',COALESCE((
         SELECT jsonb_agg(jsonb_build_object('reference',format('%s:%s:%s',b.book,b.chapter,b.verse_nr),
             'book',b.book,'chapter',b.chapter,'verse',b.verse_nr,'word_position',b.word_position,
             'word_original',b.original_word,'word_gloss',b.source_english,'english_web',b.english_web)
         ORDER BY b.book,b.chapter,b.verse_nr)
         FROM (
           SELECT DISTINCT ON (v.book) v.book,v.chapter,v.verse_nr,t.word_position,w.original_word,
             t.source_english,re.text AS english_web
           FROM public.words w JOIN public.verse_translation_sources t ON t.word_id=w.id
             JOIN public.verses v ON v.id=t.verse_id
             LEFT JOIN public.reader_english_verses re ON re.book=v.book AND re.chapter=v.chapter
               AND re.verse_nr=v.verse_nr AND re.edition_id='webp-2026-11'
           WHERE w.strongs_nr=s.base_strongs
           ORDER BY v.book,v.chapter,v.verse_nr,t.word_position LIMIT lim
         ) b
       ),'[]'::jsonb),
       'statistical_partners',COALESCE((
        SELECT jsonb_agg(jsonb_build_object('strongs',z.strongs_nr,'form',z.original_word,
         'gloss',z.primary_english,'pair_frequency',z.frequency,'avg_distance',z.avg_distance,'legacy_score',z.score))
        FROM (SELECT * FROM public.prompt_word_cooccurrences(s.base_strongs) LIMIT 5) z
       ),'[]'::jsonb)
      ) ORDER BY s.rank,s.base_strongs),'[]'::jsonb),
    'epistemic_notes',jsonb_build_array('A lemma is not a concept or a token-level sense assignment.',
      'Root membership is not synonymy or meaning.',
      'Book-diverse samples are not all occurrences nor proof of typical usage.',
      'Statistical partners are lexical proximity, not a theological relation.',
      'WEB is an independent English rendering, not an aligned gloss.'),
    'next_step','Inspect actual context with research_passage_lens or get_verse_hydrated; test semantic links with research_word_bridge.')
 INTO result FROM selected s;
 RETURN result;
END $function$
;

REVOKE ALL ON FUNCTION public.research_passage_lens_v1(integer,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.research_passage_lens_v1(integer,integer,integer,integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.research_word_bridge_v1(text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.research_word_bridge_v1(text,text,integer,integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.research_word_lens_v1(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.research_word_lens_v1(text,integer) TO anon, authenticated, service_role;
