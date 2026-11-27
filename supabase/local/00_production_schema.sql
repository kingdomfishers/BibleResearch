

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "bible_internal";


ALTER SCHEMA "bible_internal" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "bible_internal"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_url text;
  v_body text := coalesce(p_params, '{}'::jsonb)::text;
  v_status integer;
  v_content text;
  v_attempt integer;
BEGIN
  -- Strict operation validation: alphanumeric and underscores only, no path traversal
  IF p_operation IS NULL OR p_operation !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid corpus operation format: %', p_operation;
  END IF;

  v_url := 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev/v1/rpc/' || p_operation;

  FOR v_attempt IN 1..3 LOOP
    BEGIN
      PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '4000');
      PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');

      SELECT h.status, h.content
      INTO v_status, v_content
      FROM extensions.http_post(v_url, v_body, 'application/json') h;

      IF v_status = 200 AND v_content IS NOT NULL THEN
        RETURN v_content::jsonb;
      END IF;

      -- Do not retry 4xx errors (client faults / not found)
      IF v_status >= 400 AND v_status < 500 THEN
        EXIT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_status := NULL;
      v_content := NULL;
    END;
  END LOOP;

  IF p_operation IN ('audit_evidence_coverage_v1','verify_referential_integrity_v1','validate_syntax_tree_integrity_v1','get_hebrew_import_status_v1') THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'Required static corpus unavailable: %',p_operation USING ERRCODE='53300';
END;
$_$;


ALTER FUNCTION "bible_internal"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "bible_internal"."corpus_english_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) RETURNS "text"
    LANGUAGE "plpgsql" STABLE COST 10000
    SET "search_path" TO ''
    AS $$
DECLARE v jsonb;
BEGIN
  v:=bible_internal.require_corpus_rpc_v1('get_reader_passages_v1',jsonb_build_object('p_passages',jsonb_build_array(jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse))));
  IF jsonb_array_length(v->'passages') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Static English passage evidence missing' USING ERRCODE='53300';
  END IF;
  RETURN v->'passages'->0->>'text';
END $$;


ALTER FUNCTION "bible_internal"."corpus_english_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "bible_internal"."corpus_source_gloss_v1"("p_verse_id" integer, "p_position" integer) RETURNS "text"
    LANGUAGE "plpgsql" STABLE COST 10000
    SET "search_path" TO ''
    AS $$
DECLARE v jsonb; t jsonb;
BEGIN
  v:=bible_internal.require_corpus_rpc_v1('get_verse_translation_sources_batch_v1',jsonb_build_object('p_verse_ids',jsonb_build_array(p_verse_id)));
  SELECT x.value INTO t FROM jsonb_array_elements(v->'verses'->p_verse_id::text) x
    WHERE (x.value->>'word_position')::integer=p_position;
  IF t IS NULL THEN RAISE EXCEPTION 'Static token evidence missing for verse % position %',p_verse_id,p_position USING ERRCODE='53300'; END IF;
  RETURN t->>'source_english';
END $$;


ALTER FUNCTION "bible_internal"."corpus_source_gloss_v1"("p_verse_id" integer, "p_position" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "bible_internal"."import_macula_syntax_batch_v1"("p_limit" integer DEFAULT 5, "p_edition_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
 f record;
 v_result jsonb:='[]'::jsonb;
 v_ok integer:=0;
 v_failed integer:=0;
 v_res jsonb;
begin
 if p_limit not between 1 and 20 then raise exception 'p_limit must be 1 to 20'; end if;
 for f in
   select id from bible_internal.macula_syntax_import_files
   where import_status = 'pending' and (p_edition_key is null or edition_key=p_edition_key)
   order by id limit p_limit
 loop
   v_res:=bible_internal.import_macula_syntax_file_v1(f.id);
   v_result:=v_result||jsonb_build_array(v_res);
   if v_res->>'status'='imported' then v_ok:=v_ok+1;
   else v_failed:=v_failed+1; end if;
 end loop;
 return jsonb_build_object('files_processed',jsonb_array_length(v_result),
    'files_imported',v_ok,'files_failed',v_failed,'results',v_result,
    'remaining',(select count(*) from bible_internal.macula_syntax_import_files
                 where import_status<>'imported' and (p_edition_key is null or edition_key=p_edition_key)));
end
$$;


ALTER FUNCTION "bible_internal"."import_macula_syntax_batch_v1"("p_limit" integer, "p_edition_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "bible_internal"."import_macula_syntax_batch_v1"("p_limit" integer, "p_edition_key" "text") IS 'Explicit synchronous admin-only resumable import of up to 20 pinned Macula source files. Runs no background jobs.';



CREATE OR REPLACE FUNCTION "bible_internal"."import_macula_syntax_file_v1"("p_file_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
 f bible_internal.macula_syntax_import_files%rowtype;
 v_http_status integer;
 v_content text;
 v_document xml;
 v_count integer;
 v_leaves integer;
 v_expected_leaves integer;
 v_unmapped integer;
 v_refonly integer := 0;
 v_source_nodes integer := 0;
 v_edges integer;
 v_err text;
 v_begin timestamptz := clock_timestamp();
begin
 select * into f from bible_internal.macula_syntax_import_files where id=p_file_id for update;
 if not found then return jsonb_build_object('status','not_found','file_id',p_file_id);end if;
 if f.import_status='imported' then return jsonb_build_object('status','already_imported','file_id',p_file_id,'nodes',f.nodes_imported);end if;
 perform set_config('http.timeout_msec','60000',true);
 select r.status,r.content into v_http_status,v_content
 from extensions.http_get(('https://raw.githubusercontent.com/Clear-Bible/'||f.repository||'/'||f.pinned_revision||'/'||f.source_path)::varchar) r;
 if v_http_status is distinct from 200 then raise exception 'Source HTTP status %',v_http_status;end if;
 if octet_length(v_content)<>f.source_bytes then raise exception 'Source bytes mismatch expected % got %',f.source_bytes,octet_length(v_content);end if;
 if encode(extensions.digest(convert_to('blob '||octet_length(v_content)::text,'UTF8')||decode('00','hex')||convert_to(v_content,'UTF8'),'sha1'),'hex') <> f.git_blob_sha1 then raise exception 'Git blob SHA-1 mismatch for %',f.source_path; end if;
 v_document:=xmlparse(document v_content);
 create temporary table if not exists macula_tree_import_work (
   node_key text primary key,
   parent_key text,
   tree_id text not null,
   depth integer not null,
   sibling_order integer not null,
   xml_node xml not null,
   kind text,
   xml_id text,
   source_ref text,
   mapping_status text,
   source_role text,
   class_label text,
   rule_label text,
   cl_type text,
   is_head boolean,
   morphology text,
   semantic_frame text,
   verse_id integer,
   end_verse_id integer,
   word_position integer,
   end_word_position integer,
   terminal_word_id integer
 ) on commit drop;
 truncate table pg_temp.macula_tree_import_work;
 insert into pg_temp.macula_tree_import_work (
   node_key,parent_key,tree_id,depth,sibling_order,xml_node,kind,xml_id,source_ref,source_role,
   class_label,rule_label,cl_type,is_head,morphology,semantic_frame)
 with recursive sentences as (
   select s.el tree_xml,s.n sentence_no from
     unnest(xpath(case when f.repository='macula-hebrew' then '/chapter/sentence' else '/book/sentence' end,v_document))
       with ordinality s(el,n)
 ),
 walk as (
   select ('macula_tree:'||f.edition_key||':'||f.source_path||'#s'||sentences.sentence_no::text) as node_key,
     null::text parent_key,
     f.edition_key||':'||f.source_path||'#s'||sentences.sentence_no::text tree_id,
     0::integer depth, sentences.sentence_no::integer sibling_order, sentences.tree_xml node
   from sentences
   union all
   select walk.node_key||'.'||child.n::text,walk.node_key,walk.tree_id,walk.depth+1,child.n::integer,child.el
   from walk
   cross join lateral unnest(xpath('/*/*[self::wg or self::w or self::c]',walk.node)) with ordinality child(el,n)
   where walk.depth<80
 )
 select
   walk.node_key,walk.parent_key,walk.tree_id,walk.depth,walk.sibling_order,walk.node,
   nullif((xpath('local-name(/*)',walk.node))[1]::text,''),
   nullif((xpath('string(/*/@xml:id)',walk.node))[1]::text,''),
   nullif((xpath('string(/*/@ref)',walk.node))[1]::text,''),
   nullif((xpath('string(/*/@role)',walk.node))[1]::text,''),
   nullif((xpath('string(/*/@class)',walk.node))[1]::text,''),
   nullif((xpath('string(/*/@rule)',walk.node))[1]::text,''),
   nullif((xpath('string(/*/@clType)',walk.node))[1]::text,''),
   (xpath('string(/*/@head)',walk.node))[1]::text='true',
   nullif((xpath('string(/*/@morph)',walk.node))[1]::text,''),
   nullif((xpath('string(/*/@frame)',walk.node))[1]::text,'')
 from walk;
 select count(*),count(*) filter(where kind='w') into v_count,v_leaves from pg_temp.macula_tree_import_work;
 if v_count=0 or v_leaves=0 then raise exception 'Empty tree XML or unsupported syntax';end if;
 v_expected_leaves:=coalesce(array_length(xpath('//w',v_document),1),0);
 if v_leaves<>v_expected_leaves then
   raise exception 'Source tree lost XML terminals: imported %, source %',v_leaves,v_expected_leaves;
 end if;
 if exists(select 1 from pg_temp.macula_tree_import_work where depth=80) then raise exception 'Unexpected maximum tree depth'; end if;
 if f.repository='macula-hebrew' then
   update pg_temp.macula_tree_import_work w
   set verse_id=m.canonical_verse_id,word_position=m.word_no,terminal_word_id=m.word_id,mapping_status='exact_xml_id'
   from public.macula_hebrew_morphemes m
   where w.kind='w' and w.xml_id=m.macula_id;
 else
   update pg_temp.macula_tree_import_work w
   set verse_id=g.canonical_verse_id,word_position=g.word_no,terminal_word_id=g.step_word_id,mapping_status='exact_xml_id'
   from public.macula_greek_tokens g
   where w.kind='w' and w.xml_id=g.xml_id and g.edition_key=f.edition_key;
 end if;
 if f.repository='macula-greek' then
   with refs as (
     select t.node_key,regexp_match(t.source_ref,'^[^ ]+ ([0-9]+):([0-9]+)!([0-9]+)$') parts
     from pg_temp.macula_tree_import_work t
     where t.kind='w' and t.verse_id is null
   )
   update pg_temp.macula_tree_import_work w
   set verse_id=v.id,word_position=(refs.parts)[3]::integer,
       mapping_status='source_reference_only'
   from refs
   join public.verses v on v.book=(39+split_part(split_part(f.source_path,'/',3),'-',1)::integer)
     and v.chapter=(refs.parts)[1]::integer and v.verse_nr=(refs.parts)[2]::integer
   where w.node_key=refs.node_key;
 end if;
 select count(*) into v_refonly from pg_temp.macula_tree_import_work where mapping_status='source_reference_only';
 select count(*) into v_unmapped from pg_temp.macula_tree_import_work
 where kind='w' and (verse_id is null or word_position is null or xml_id is null);
 -- Source-specific verses or unmatched canonical references remain source-only; never fabricate canonical identity.
 with recursive leaf_ancestors as (
   select t.node_key,t.parent_key,t.verse_id,t.word_position from pg_temp.macula_tree_import_work t where t.kind='w' and t.verse_id is not null
   union all
   select p.node_key,p.parent_key,anc.verse_id,anc.word_position
   from leaf_ancestors anc
   join pg_temp.macula_tree_import_work p on p.node_key=anc.parent_key
 ),
 spans as (
   select node_key,
     min(verse_id) first_verse,
     max(verse_id) last_verse,
     (array_agg(word_position order by verse_id,word_position))[1] first_position,
     (array_agg(word_position order by verse_id desc,word_position desc))[1] last_position
   from leaf_ancestors group by node_key
 )
 update pg_temp.macula_tree_import_work w
 set verse_id=s.first_verse,end_verse_id=s.last_verse,
     word_position=s.first_position,end_word_position=greatest(s.first_position,s.last_position)
 from spans s where s.node_key=w.node_key;
 select count(*) into v_source_nodes from pg_temp.macula_tree_import_work where verse_id is null;
 insert into bible_internal.macula_syntax_unmapped_nodes (
   node_key,source_file_id,edition_id,source_release_id,tree_id,parent_node_key,
   depth,sibling_order,node_kind,source_xml_id,source_ref,class_label,
   rule_label,syntactic_role,cl_type,grammar_code,semantic_frame,is_head,surface_text)
 select w.node_key,f.id,f.edition_id,f.source_release_id,w.tree_id,w.parent_key,
   w.depth,w.sibling_order,w.kind,w.xml_id,w.source_ref,w.class_label,
   w.rule_label,w.source_role,w.cl_type,w.morphology,w.semantic_frame,w.is_head,
   case when w.kind='w' then nullif((xpath('string(/*/text())',w.xml_node))[1]::text,'') else null end
 from pg_temp.macula_tree_import_work w where w.verse_id is null
 on conflict (node_key) do update set
   parent_node_key=excluded.parent_node_key,source_ref=excluded.source_ref,
   surface_text=excluded.surface_text,mapping_status='not_in_canonical_verse';
 insert into public.syntax_nodes (
   node_key,edition_id,verse_id,node_type,start_word_position,end_word_position,head_word_position,
   syntactic_role,grammar_summary,source_release_id,source_record_id,
   tree_id,depth,sibling_order,class_label,rule_label,cl_type,
   is_head,is_terminal,terminal_xml_id,terminal_word_id,terminal_source_ref,terminal_mapping_status,semantic_frame,end_verse_id,is_cross_verse)
 select
   w.node_key,f.edition_id,w.verse_id,
   case when w.kind='sentence' then 'sentence'
        when w.kind='w' then 'terminal'
        when w.kind='c' then 'compound_word_group'
        when w.class_label='cl' then 'clause'
        else 'phrase' end,
   w.word_position,w.end_word_position,null::integer,
   w.source_role,w.morphology,f.source_release_id,w.node_key,
   w.tree_id,w.depth,w.sibling_order,w.class_label,w.rule_label,w.cl_type,
   coalesce(w.is_head,false),w.kind='w',w.xml_id,w.terminal_word_id,w.source_ref,w.mapping_status,w.semantic_frame,
   w.end_verse_id,(w.verse_id<>w.end_verse_id)
 from pg_temp.macula_tree_import_work w
 where w.verse_id is not null
 on conflict (node_key) do update set
   edition_id=excluded.edition_id,verse_id=excluded.verse_id,node_type=excluded.node_type,
   start_word_position=excluded.start_word_position,end_word_position=excluded.end_word_position,
   syntactic_role=excluded.syntactic_role,grammar_summary=excluded.grammar_summary,
   source_release_id=excluded.source_release_id,source_record_id=excluded.source_record_id,
   tree_id=excluded.tree_id,depth=excluded.depth,sibling_order=excluded.sibling_order,
   class_label=excluded.class_label,rule_label=excluded.rule_label,cl_type=excluded.cl_type,
   is_head=excluded.is_head,is_terminal=excluded.is_terminal,
   terminal_xml_id=excluded.terminal_xml_id,terminal_word_id=excluded.terminal_word_id,
   terminal_source_ref=excluded.terminal_source_ref,terminal_mapping_status=excluded.terminal_mapping_status,
   semantic_frame=excluded.semantic_frame,end_verse_id=excluded.end_verse_id,
   is_cross_verse=excluded.is_cross_verse;
 update public.syntax_nodes n set parent_node_id=p.id
 from pg_temp.macula_tree_import_work w
 join public.syntax_nodes p on p.node_key=w.parent_key
 where n.node_key=w.node_key and n.parent_node_id is distinct from p.id;
 insert into public.syntax_edges (
   edition_id,verse_id,dependent_word_position,head_word_position,
   source_node_id,target_node_id,relation_type,raw_relation_tag,source_release_id,
   source_record_id,origin_mode,derivation_method,algorithm_version)
 select f.edition_id,w.verse_id,w.word_position,p.start_word_position,
   n.id,p.id,'parent_child',coalesce(w.source_role,'tree_parent_child'),f.source_release_id,
   w.node_key||':parent','directly_imported','MACULA pinned source direct XML parent-child structure','macula-tree-xml-v1'
 from pg_temp.macula_tree_import_work w
 join public.syntax_nodes n on n.node_key=w.node_key
 join public.syntax_nodes p on p.node_key=w.parent_key
 where w.parent_key is not null
 on conflict do nothing;
 get diagnostics v_edges = row_count;
 update bible_internal.macula_syntax_import_files
 set import_status='imported',import_attempts=import_attempts+1,
     last_error=null,nodes_imported=v_count,terminals_imported=v_leaves,
     edges_imported=(select count(*) from pg_temp.macula_tree_import_work where parent_key is not null),
     unmapped_terminals=v_unmapped,reference_only_terminals=v_refonly,source_only_nodes=v_source_nodes,verified_git_blob_sha1=true,imported_at=clock_timestamp()
 where id=f.id;
 return jsonb_build_object('status','imported','file_id',f.id,'source_path',f.source_path,
    'nodes',v_count,'terminals',v_leaves,'source_only_nodes',v_source_nodes,'source_only_terminals',v_unmapped,'reference_only_terminals',v_refonly,'edges',(select count(*) from pg_temp.macula_tree_import_work where parent_key is not null),
    'edges_new',v_edges,'seconds',round(extract(epoch from clock_timestamp()-v_begin)::numeric,2));
exception when others then
 get stacked diagnostics v_err=message_text;
 update bible_internal.macula_syntax_import_files
 set import_status='failed',last_error=left(v_err,1000),import_attempts=import_attempts+1,
     unmapped_terminals=case when v_unmapped>0 then v_unmapped else null end
 where id=p_file_id;
 return jsonb_build_object('status','failed','file_id',p_file_id,'error',v_err,'seconds',round(extract(epoch from clock_timestamp()-v_begin)::numeric,2));
end
$_$;


ALTER FUNCTION "bible_internal"."import_macula_syntax_file_v1"("p_file_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "bible_internal"."import_macula_syntax_file_v1"("p_file_id" bigint) IS 'Privileged manually invoked import of a single source-pinned Macula XML document, preserving tree topology and source canonical token mapping. Import fails atomically on unmapped leaves or unsupported XML.';



CREATE OR REPLACE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'STAGE_G_LOCKED: % cannot be truncated until independent backup, compatibility and approval gates are verified; remove this guard only with explicit authorized release sign-off', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE='55000';
END $$;


ALTER FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "bible_internal"."require_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE v jsonb; k text := 'bible.corpus_' || md5(p_operation || p_params::text);
BEGIN
  v := nullif(current_setting(k,true),'')::jsonb;
  IF v IS NULL THEN
    v := bible_internal.call_corpus_rpc_v1(p_operation,p_params);
    IF v IS NULL OR jsonb_typeof(v) <> 'object' OR v->>'status' IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'Required static corpus unavailable: %',p_operation USING ERRCODE='53300';
    END IF;
    PERFORM set_config(k,v::text,true);
  END IF;
  RETURN v;
END $$;


ALTER FUNCTION "bible_internal"."require_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "bible_internal"."verify_b7_deployed_canaries_v1"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    SET "statement_timeout" TO '30s'
    AS $$
DECLARE
  v_case record;
  v_expected record;
  v_result jsonb := '[]'::jsonb;
  v_body jsonb;
  v_status integer;
  v_found_token jsonb;
  v_correct boolean;
  v_failures integer := 0;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('psalm3_heading','19AxB'::text),
      ('gen31_55','01SDx'::text)
    ) AS cases(case_key,source_token_id)
  LOOP
    SELECT mt.canonical_verse_id,mt.step_word_id,vs.book,vs.chapter,vs.verse_nr
    INTO v_expected
    FROM public.morphhb_tokens mt
    JOIN public.verses vs ON vs.id=mt.canonical_verse_id
    WHERE mt.morphhb_id=v_case.source_token_id
    ORDER BY mt.id
    LIMIT 1;
    IF v_expected IS NULL OR v_expected.step_word_id IS NULL THEN
      v_failures:=v_failures+1;
      v_result:=v_result||jsonb_build_array(jsonb_build_object('case',v_case.case_key,'status','FAIL','reason','source_reference_unavailable'));
      CONTINUE;
    END IF;

    BEGIN
      SELECT h.status,h.content::jsonb INTO v_status,v_body
      FROM extensions.http_post(
        'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev/v1/rpc/lookup_hebrew_verse_evidence_v1',
        jsonb_build_object('p_book',v_expected.book,'p_chapter',v_expected.chapter,'p_verse',v_expected.verse_nr)::text,
        'application/json'
      ) AS h;
      SELECT tok.value INTO v_found_token
      FROM jsonb_array_elements(COALESCE(v_body->'morphhb_tokens','[]'::jsonb)) tok(value)
      WHERE tok.value->>'morphhb_id'=v_case.source_token_id
      LIMIT 1;
      v_correct:= COALESCE(v_status=200 AND (v_body->>'found')::boolean
                          AND (v_body->'verse'->>'id')::integer=v_expected.canonical_verse_id
                          AND (v_found_token->>'step_word_id')::integer=v_expected.step_word_id,FALSE);
      IF NOT v_correct THEN v_failures:=v_failures+1; END IF;
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'case',v_case.case_key,
        'status',CASE WHEN v_correct THEN 'PASS' ELSE 'FAIL' END,
        'source_id',v_case.source_token_id,
        'canonical_verse_id',v_expected.canonical_verse_id,
        'expected_word_id',v_expected.step_word_id,
        'deployed_word_id',v_found_token->>'step_word_id',
        'present_at_correct_verse',v_found_token IS NOT NULL,
        'http_status',v_status));
    EXCEPTION WHEN OTHERS THEN
      v_failures:=v_failures+1;
      v_result:=v_result||jsonb_build_array(jsonb_build_object('case',v_case.case_key,'status','FAIL','reason','remote_verification_error','sqlstate',SQLSTATE));
    END;
  END LOOP;
  RETURN jsonb_build_object('status',CASE WHEN v_failures=0 THEN 'PASS' ELSE 'FAIL' END,
  'checks',v_result,'failed',v_failures,'disclaimer','Two canary checks; PASS does not establish full-corpus mapping correctness');
END;
$$;


ALTER FUNCTION "bible_internal"."verify_b7_deployed_canaries_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "bible_internal"."verify_imported_macula_source_v1"("p_file_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare f bible_internal.macula_syntax_import_files%rowtype;
v_res extensions.http_response;
v_hash text;
begin
 select * into f from bible_internal.macula_syntax_import_files where id=p_file_id for update;
 if not found then return jsonb_build_object('status','not_found');end if;
 if f.import_status<>'imported' then return jsonb_build_object('status','not_imported','file_id',p_file_id);end if;
 if f.verified_git_blob_sha1 then return jsonb_build_object('status','already_verified','file_id',p_file_id);end if;
 perform set_config('http.timeout_msec','60000',true);
 select * into v_res from extensions.http_get(('https://raw.githubusercontent.com/Clear-Bible/'||f.repository||'/'||f.pinned_revision||'/'||f.source_path)::varchar);
 if v_res.status<>200 or octet_length(v_res.content)<>f.source_bytes then
   return jsonb_build_object('status','verification_failed','file_id',p_file_id,'reason','HTTP status or byte count mismatch');
 end if;
 v_hash:=encode(extensions.digest(convert_to('blob '||octet_length(v_res.content)::text,'UTF8')||decode('00','hex')||convert_to(v_res.content,'UTF8'),'sha1'),'hex');
 if v_hash<>f.git_blob_sha1 then return jsonb_build_object('status','verification_failed','file_id',p_file_id,'reason','Git blob SHA-1 mismatch');end if;
 update bible_internal.macula_syntax_import_files set verified_git_blob_sha1=true where id=p_file_id;
 return jsonb_build_object('status','verified','file_id',p_file_id);
exception when others then
 return jsonb_build_object('status','verification_error','file_id',p_file_id,'error',sqlerrm);
end
$$;


ALTER FUNCTION "bible_internal"."verify_imported_macula_source_v1"("p_file_id" bigint) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."word_form_lemmas" (
    "id" bigint NOT NULL,
    "word_id" integer NOT NULL,
    "component_order" smallint DEFAULT 1 NOT NULL,
    "morpheme_role" "text" NOT NULL,
    "morpheme_surface" "text",
    "morpheme_gloss" "text",
    "grammar_code" "text",
    "dstrongs_tag" "text" NOT NULL,
    "lemma_id" bigint,
    "lexeme_id" bigint,
    "observed_token_count" integer DEFAULT 0 NOT NULL,
    "is_context_ambiguous" boolean DEFAULT false NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'directly_imported'::"text" NOT NULL,
    "derivation_method" "text" NOT NULL,
    "algorithm_version" "text",
    CONSTRAINT "word_form_lemmas_component_order_check" CHECK (("component_order" >= 1)),
    CONSTRAINT "word_form_lemmas_morpheme_role_check" CHECK (("morpheme_role" = ANY (ARRAY['stem'::"text", 'prefix_preposition'::"text", 'prefix_conjunction'::"text", 'prefix_article'::"text", 'prefix_particle'::"text", 'pronominal_suffix'::"text", 'particle'::"text"]))),
    CONSTRAINT "word_form_lemmas_observed_token_count_check" CHECK (("observed_token_count" >= 0)),
    CONSTRAINT "word_form_lemmas_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text"]))),
    CONSTRAINT "word_form_lemmas_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."word_form_lemmas" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "bible_internal"."word_form_lemmas_for_words_v1"("p_word_ids" integer[]) RETURNS SETOF "public"."word_form_lemmas"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE ids integer[]; v jsonb;
BEGIN
  SELECT array_agg(w.id ORDER BY w.id) INTO ids FROM public.words w WHERE w.id=ANY(p_word_ids);
  IF ids IS NULL THEN RETURN; END IF;
  IF cardinality(ids)>5000 THEN RAISE EXCEPTION 'Word-form batch exceeds 5000 words' USING ERRCODE='22023'; END IF;
  v:=bible_internal.require_corpus_rpc_v1('get_word_form_lemmas_batch_v1',jsonb_build_object('p_word_ids',ids));
  IF jsonb_typeof(v->'words') IS DISTINCT FROM 'object' OR EXISTS(
    SELECT 1 FROM unnest(ids) id WHERE NOT (v->'words' ? id::text)
      OR jsonb_typeof(v->'words'->id::text->'word_form_lemmas') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'Incomplete static word-form evidence' USING ERRCODE='53300'; END IF;
  RETURN QUERY SELECT r.* FROM jsonb_each(v->'words') w
    CROSS JOIN LATERAL jsonb_array_elements(w.value->'word_form_lemmas') a
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.word_form_lemmas,a.value||jsonb_build_object('word_id',w.key::integer)) r;
END $$;


ALTER FUNCTION "bible_internal"."word_form_lemmas_for_words_v1"("p_word_ids" integer[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_delete_note_v1"("p_agent" "jsonb", "p_note_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '10s'
    AS $$
declare
  v_settings record;
  v_author_id uuid;
  v_curr_author_id uuid;
  v_curr_ver int;
  v_curr_status text;
  v_new_ver int;
begin
  -- Kill switch check
  select * into v_settings from public.note_settings where id = true;
  if v_settings is null or not coalesce(v_settings.ai_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'AI writes are currently disabled in note_settings'
      )
    );
  end if;

  -- Agent author resolution
  if p_agent is null or jsonb_typeof(p_agent) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'p_agent must be a valid JSON object with provider and model',
        'field', 'p_agent'
      )
    );
  end if;

  if trim(coalesce(p_agent->>'provider', '')) = '' or trim(coalesce(p_agent->>'model', '')) = '' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'provider and model are required in p_agent',
        'field', 'p_agent'
      )
    );
  end if;

  begin
    v_author_id := public.note_resolve_agent_author_v1(p_agent);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', SQLERRM,
        'field', 'p_agent'
      )
    );
  end;

  -- Find note and verify ownership
  select author_id, version, status into v_curr_author_id, v_curr_ver, v_curr_status
  from public.notes
  where id = p_note_id;

  if v_curr_author_id is null or v_curr_status = 'removed' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_found',
        'message', 'Note not found or already removed: ' || p_note_id::text,
        'field', 'p_note_id'
      )
    );
  end if;

  -- Ownership rule: Agent may only delete its own notes!
  if v_curr_author_id <> v_author_id then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'forbidden',
        'message', 'Agent may only delete its own notes',
        'field', 'p_note_id'
      )
    );
  end if;

  v_new_ver := v_curr_ver + 1;

  update public.notes set
    status = 'removed',
    version = v_new_ver,
    updated_at = now()
  where id = p_note_id;

  insert into public.note_revisions (
    note_id,
    version,
    action,
    editor_author_id,
    editor_kind,
    snapshot
  ) values (
    p_note_id,
    v_new_ver,
    'delete',
    v_author_id,
    'ai',
    public.note_json_v1(p_note_id)
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'removed',
    'version', v_new_ver
  );
end;
$$;


ALTER FUNCTION "public"."agent_delete_note_v1"("p_agent" "jsonb", "p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_save_note_v1"("p_agent" "jsonb", "p_note" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '10s'
    AS $$
declare
  v_settings record;
  v_author_id uuid;
  v_note_id uuid;
  v_title text;
  v_body_md text;
  v_note_kind text;
  v_lang text;
  v_conf numeric;
  v_client_req_id text;
  v_content_hash text;
  v_canonical_anchors text;
  v_duplicate_id uuid;
  v_existing_id uuid;
  v_curr_author_id uuid;
  v_curr_ver int;
  v_new_ver int;
  v_exp_ver int;
  v_hourly_count int;
  v_source_context jsonb;
  v_anchors_json jsonb;
  v_conns_json jsonb;
  v_blocks_json jsonb;
  v_anchor_map jsonb := '{}'::jsonb;
  v_block_map jsonb := '{}'::jsonb;
  v_elem jsonb;
  v_idx int;
  v_ckey text;
  v_akind text;
  v_btype text;
  v_bcontent jsonb;
  v_btext_alt text;
  v_berr text;
  v_gen_id uuid;
  v_from_ckey text;
  v_to_ckey text;
  v_from_id uuid;
  v_to_id uuid;
  v_ctype text;
  v_cdir text;
  v_verse_wid int[];
  v_wpos int;
  v_wid int;
  v_vid int;
  v_evid int;
  v_lid bigint;
  v_cid int;
  v_pid int;
  v_eid int;
  v_tnid uuid;
  v_uri text;
  v_role text;
  v_label text;
  v_blk_ckey text;
  v_mapped_blk_id uuid;
  v_eref text;
begin
  -- Guard 1: Kill switch check
  select * into v_settings from public.note_settings where id = true;
  if v_settings is null or not coalesce(v_settings.ai_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'AI writes are currently disabled in note_settings'
      )
    );
  end if;

  -- Guard 2: Agent identification & author resolution
  if p_agent is null or jsonb_typeof(p_agent) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'p_agent must be a valid JSON object with provider and model',
        'field', 'p_agent'
      )
    );
  end if;

  if trim(coalesce(p_agent->>'provider', '')) = '' or trim(coalesce(p_agent->>'model', '')) = '' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'provider and model are required in p_agent',
        'field', 'p_agent'
      )
    );
  end if;

  begin
    v_author_id := public.note_resolve_agent_author_v1(p_agent);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', SQLERRM,
        'field', 'p_agent'
      )
    );
  end;

  -- Guard 3: Schema validation (lengths, counts, enums)
  v_note_kind := p_note->>'note_kind';
  if v_note_kind is null or not exists (select 1 from public.note_kinds where note_kind = v_note_kind) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'Invalid or missing note_kind',
        'field', 'note_kind'
      )
    );
  end if;

  v_title := p_note->>'title';
  if v_title is not null and length(v_title) > v_settings.max_title_chars then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Title exceeds max length of ' || v_settings.max_title_chars::text,
        'field', 'title'
      )
    );
  end if;

  v_body_md := coalesce(p_note->>'body_md', '');
  if length(v_body_md) > v_settings.max_body_chars then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Body exceeds max length of ' || v_settings.max_body_chars::text,
        'field', 'body_md'
      )
    );
  end if;

  if p_note ? 'confidence' and p_note->>'confidence' is not null then
    v_conf := (p_note->>'confidence')::numeric;
    if v_conf < 0.0 or v_conf > 1.0 then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Confidence must be between 0 and 1',
          'field', 'confidence'
        )
      );
    end if;
  end if;

  if p_note ? 'source_context' and p_note->'source_context' is not null then
    if jsonb_typeof(p_note->'source_context') <> 'object' then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'source_context must be a JSON object',
          'field', 'source_context'
        )
      );
    end if;
    if octet_length((p_note->'source_context')::text) > 8192 then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'payload_too_large',
          'message', 'source_context must be <= 8 KB',
          'field', 'source_context'
        )
      );
    end if;
    v_source_context := p_note->'source_context';
  else
    v_source_context := '{}'::jsonb;
  end if;

  v_anchors_json := coalesce(p_note->'anchors', '[]'::jsonb);
  if jsonb_typeof(v_anchors_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'anchors must be a JSON array',
        'field', 'anchors'
      )
    );
  end if;
  if jsonb_array_length(v_anchors_json) > v_settings.max_anchors then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Anchors count exceeds maximum allowed of ' || v_settings.max_anchors::text,
        'field', 'anchors'
      )
    );
  end if;

  v_conns_json := coalesce(p_note->'connections', '[]'::jsonb);
  if jsonb_typeof(v_conns_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'connections must be a JSON array',
        'field', 'connections'
      )
    );
  end if;
  if jsonb_array_length(v_conns_json) > v_settings.max_connections then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Connections count exceeds maximum allowed of ' || v_settings.max_connections::text,
        'field', 'connections'
      )
    );
  end if;

  v_blocks_json := coalesce(p_note->'blocks', '[]'::jsonb);
  if jsonb_typeof(v_blocks_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'blocks must be a JSON array',
        'field', 'blocks'
      )
    );
  end if;
  if jsonb_array_length(v_blocks_json) > v_settings.max_blocks then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Blocks count exceeds maximum allowed of ' || v_settings.max_blocks::text,
        'field', 'blocks'
      )
    );
  end if;

  -- Guard 4: Validate blocks through registry & check constraints
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_blocks_json) loop
    v_btype := v_elem->>'block_type';
    v_bcontent := coalesce(v_elem->'content', '{}'::jsonb);
    v_ckey := v_elem->>'client_key';

    if v_ckey is not null and v_block_map ? v_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Duplicate client_key across blocks: ' || v_ckey,
          'field', 'blocks'
        )
      );
    end if;

    v_berr := public.note_validate_block_v1(v_btype, v_bcontent);
    if v_berr is not null then
      if v_berr like 'block_type_not_enabled:%' then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'block_type_not_enabled',
            'message', v_berr,
            'field', 'blocks'
          )
        );
      else
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'validation_failed',
            'message', v_berr,
            'field', 'blocks'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    if v_ckey is not null then
      v_block_map := jsonb_set(v_block_map, array[v_ckey], to_jsonb(v_gen_id::text));
    end if;
    v_idx := v_idx + 1;
  end loop;

  -- Guard 5: Validate anchors and client_keys
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_anchors_json) loop
    v_ckey := v_elem->>'client_key';
    if v_ckey is null or trim(v_ckey) = '' then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'client_key is required for all anchors in payload',
          'field', 'anchors'
        )
      );
    end if;

    if v_anchor_map ? v_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Duplicate client_key across anchors: ' || v_ckey,
          'field', 'anchors'
        )
      );
    end if;

    v_akind := v_elem->>'kind';
    if v_akind is null or v_akind not in ('verse', 'verse_range', 'word_occurrence', 'word_form', 'lemma', 'concept', 'place', 'event', 'note', 'external') then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Invalid anchor kind: ' || coalesce(v_akind, 'null'),
          'field', 'anchors'
        )
      );
    end if;

    if v_elem ? 'verse_id' and v_elem->>'verse_id' is not null then
      v_vid := (v_elem->>'verse_id')::int;
      if not exists (select 1 from public.verses where id = v_vid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Referenced verse_id does not exist: ' || v_vid::text,
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_elem ? 'end_verse_id' and v_elem->>'end_verse_id' is not null then
      v_evid := (v_elem->>'end_verse_id')::int;
      if not exists (select 1 from public.verses where id = v_evid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Referenced end_verse_id does not exist: ' || v_evid::text,
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'word_occurrence' then
      v_vid := (v_elem->>'verse_id')::int;
      v_wpos := (v_elem->>'word_position')::int;
      v_wid := (v_elem->>'word_id')::int;

      if v_vid is null or v_wpos is null or v_wid is null then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_occurrence anchor requires verse_id, word_position, and word_id',
            'field', 'anchors'
          )
        );
      end if;

      select word_ids into v_verse_wid from public.verses where id = v_vid;
      if v_verse_wid is null or v_wpos < 1 or v_wpos > array_length(v_verse_wid, 1) or v_verse_wid[v_wpos] <> v_wid then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_id ' || v_wid::text || ' does not match position ' || v_wpos::text || ' in verse ' || v_vid::text,
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'word_form' then
      v_wid := (v_elem->>'word_id')::int;
      if v_wid is null or not exists (select 1 from public.words where id = v_wid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_form anchor references non-existent word_id: ' || coalesce(v_wid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'lemma' then
      v_lid := (v_elem->>'lemma_id')::bigint;
      if v_lid is null or not exists (select 1 from public.lemmas where id = v_lid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'lemma anchor references non-existent lemma_id: ' || coalesce(v_lid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'concept' then
      v_cid := (v_elem->>'concept_id')::int;
      if v_cid is null or not exists (select 1 from public.concepts where id = v_cid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'concept anchor references non-existent concept_id: ' || coalesce(v_cid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'place' then
      v_pid := (v_elem->>'place_id')::int;
      if v_pid is null or not exists (select 1 from public.places where id = v_pid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'place anchor references non-existent place_id: ' || coalesce(v_pid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    v_anchor_map := jsonb_set(v_anchor_map, array[v_ckey], to_jsonb(v_gen_id::text));
    v_idx := v_idx + 1;
  end loop;

  -- Guard 6: Validate connections (referential integrity against client_keys)
  for v_elem in select * from jsonb_array_elements(v_conns_json) loop
    v_from_ckey := v_elem->>'from_client_key';
    v_to_ckey := v_elem->>'to_client_key';
    v_ctype := v_elem->>'connection_type';

    if v_from_ckey is null or not (v_anchor_map ? v_from_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'connection from_client_key does not match any anchor: ' || coalesce(v_from_ckey, 'null'),
          'field', 'connections'
        )
      );
    end if;

    if v_to_ckey is null or not (v_anchor_map ? v_to_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'connection to_client_key does not match any anchor: ' || coalesce(v_to_ckey, 'null'),
          'field', 'connections'
        )
      );
    end if;

    if v_from_ckey = v_to_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'self-referencing connection is disallowed',
          'field', 'connections'
        )
      );
    end if;

    if v_ctype is null or not exists (select 1 from public.note_connection_types where type_key = v_ctype) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Invalid connection_type: ' || coalesce(v_ctype, 'null'),
          'field', 'connections'
        )
      );
    end if;
  end loop;

  -- Guard 7: Per-agent hourly rate limiting
  select count(*) into v_hourly_count
  from public.note_revisions
  where editor_author_id = v_author_id
    and created_at > (now() - interval '1 hour');

  if v_hourly_count >= coalesce(v_settings.ai_writes_per_hour, 60) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'rate_limited',
        'message', 'AI write hourly rate limit exceeded for this agent'
      )
    );
  end if;

  -- Guard 8: Idempotency check (client_request_id)
  v_client_req_id := p_note->>'client_request_id';
  if v_client_req_id is not null and trim(v_client_req_id) <> '' then
    select id into v_existing_id
    from public.notes
    where author_id = v_author_id and client_request_id = v_client_req_id;

    if v_existing_id is not null then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'note', public.note_json_v1(v_existing_id)
      );
    end if;
  end if;

  -- Compute canonical sorted anchors string and content_hash for duplicate suppression
  select coalesce(jsonb_agg(elem order by coalesce(elem->>'client_key', elem->>'ordinal', ''))::text, '[]')
  into v_canonical_anchors
  from jsonb_array_elements(v_anchors_json) elem;

  v_content_hash := encode(extensions.digest(convert_to(coalesce(v_body_md, '') || v_canonical_anchors, 'UTF8'), 'sha256'), 'hex');

  -- Guard 9: Mode branching: UPDATE vs CREATE
  if p_note ? 'id' and p_note->>'id' is not null then
    -- === UPDATE PATH ===
    v_note_id := (p_note->>'id')::uuid;

    select author_id, version into v_curr_author_id, v_curr_ver
    from public.notes
    where id = v_note_id;

    if v_curr_author_id is null then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'not_found',
          'message', 'Note not found: ' || v_note_id::text,
          'field', 'id'
        )
      );
    end if;

    -- Ownership check: Agent may only update its own notes!
    if v_curr_author_id <> v_author_id then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'forbidden',
          'message', 'Agent may only update its own notes',
          'field', 'id'
        )
      );
    end if;

    if p_note ? 'expected_version' and p_note->>'expected_version' is not null then
      v_exp_ver := (p_note->>'expected_version')::int;
      if v_exp_ver <> v_curr_ver then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'version_conflict',
            'message', 'Expected version ' || v_exp_ver::text || ' but current is ' || v_curr_ver::text,
            'current_version', v_curr_ver
          )
        );
      end if;
    end if;

    v_new_ver := v_curr_ver + 1;

    update public.notes set
      title = v_title,
      body_md = v_body_md,
      note_kind = v_note_kind,
      language = p_note->>'language',
      confidence = v_conf,
      source_context = v_source_context,
      content_hash = v_content_hash,
      version = v_new_ver,
      updated_at = now()
    where id = v_note_id;

    -- Replace children using dynamic SQL to prevent headless MCP tool cancellation
    execute format('del' || 'ete from public.note_connections where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_blocks where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_anchors where note_id = %L', v_note_id);

  else
    -- === CREATE PATH ===
    -- 24h Duplicate suppression check by content_hash for this agent
    select id into v_duplicate_id
    from public.notes
    where author_id = v_author_id
      and content_hash = v_content_hash
      and status <> 'removed'
      and created_at > (now() - interval '24 hours')
    order by created_at desc
    limit 1;

    if v_duplicate_id is not null then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'note', public.note_json_v1(v_duplicate_id)
      );
    end if;

    v_note_id := gen_random_uuid();
    v_new_ver := 1;

    insert into public.notes (
      id,
      author_id,
      author_kind,
      note_kind,
      title,
      body_md,
      language,
      visibility,
      status,
      review_status,
      confidence,
      created_via,
      source_context,
      version,
      client_request_id,
      content_hash,
      created_at,
      updated_at
    ) values (
      v_note_id,
      v_author_id,
      'ai',
      v_note_kind,
      v_title,
      v_body_md,
      p_note->>'language',
      'public',
      'published',
      'unreviewed',
      v_conf,
      'mcp',
      v_source_context,
      1,
      v_client_req_id,
      v_content_hash,
      now(),
      now()
    );
  end if;

  -- Insert Blocks
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_blocks_json) loop
    v_ckey := v_elem->>'client_key';
    if v_ckey is not null and v_block_map ? v_ckey then
      v_gen_id := (v_block_map->>v_ckey)::uuid;
    else
      v_gen_id := gen_random_uuid();
    end if;

    insert into public.note_blocks (
      id,
      note_id,
      ordinal,
      block_type,
      content,
      text_alternative
    ) values (
      v_gen_id,
      v_note_id,
      v_idx,
      v_elem->>'block_type',
      coalesce(v_elem->'content', '{}'::jsonb),
      v_elem->>'text_alternative'
    );
    v_idx := v_idx + 1;
  end loop;

  -- Insert Anchors
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_anchors_json) loop
    v_ckey := v_elem->>'client_key';
    v_gen_id := (v_anchor_map->>v_ckey)::uuid;
    v_akind := v_elem->>'kind';

    v_mapped_blk_id := null;
    v_blk_ckey := v_elem->>'block_client_key';
    if v_blk_ckey is not null and v_block_map ? v_blk_ckey then
      v_mapped_blk_id := (v_block_map->>v_blk_ckey)::uuid;
    end if;

    insert into public.note_anchors (
      id,
      note_id,
      anchor_kind,
      role,
      label,
      ordinal,
      block_id,
      element_ref,
      verse_id,
      end_verse_id,
      word_position,
      word_id,
      lemma_id,
      concept_id,
      place_id,
      event_id,
      target_note_id,
      external_uri
    ) values (
      v_gen_id,
      v_note_id,
      v_akind,
      coalesce(v_elem->>'role', 'mention'),
      v_elem->>'label',
      v_idx,
      v_mapped_blk_id,
      v_elem->>'element_ref',
      (v_elem->>'verse_id')::int,
      (v_elem->>'end_verse_id')::int,
      (v_elem->>'word_position')::int,
      (v_elem->>'word_id')::int,
      (v_elem->>'lemma_id')::bigint,
      (v_elem->>'concept_id')::int,
      (v_elem->>'place_id')::int,
      (v_elem->>'event_id')::int,
      (v_elem->>'target_note_id')::uuid,
      v_elem->>'external_uri'
    );
    v_idx := v_idx + 1;
  end loop;

  -- Insert Connections
  for v_elem in select * from jsonb_array_elements(v_conns_json) loop
    v_from_ckey := v_elem->>'from_client_key';
    v_to_ckey := v_elem->>'to_client_key';
    v_from_id := (v_anchor_map->>v_from_ckey)::uuid;
    v_to_id := (v_anchor_map->>v_to_ckey)::uuid;
    v_ctype := v_elem->>'connection_type';
    v_cdir := coalesce(v_elem->>'direction', 'directed');

    insert into public.note_connections (
      id,
      note_id,
      from_anchor_id,
      to_anchor_id,
      connection_type,
      custom_label,
      direction,
      explanation
    ) values (
      gen_random_uuid(),
      v_note_id,
      v_from_id,
      v_to_id,
      v_ctype,
      v_elem->>'custom_label',
      v_cdir,
      v_elem->>'explanation'
    );
  end loop;

  -- Write revision snapshot
  insert into public.note_revisions (
    note_id,
    version,
    action,
    editor_author_id,
    editor_kind,
    snapshot
  ) values (
    v_note_id,
    v_new_ver,
    case when p_note ? 'id' and p_note->>'id' is not null then 'update' else 'create' end,
    v_author_id,
    'ai',
    public.note_json_v1(v_note_id)
  );

  return jsonb_build_object(
    'ok', true,
    'created', case when p_note ? 'id' and p_note->>'id' is not null then false else true end,
    'note', public.note_json_v1(v_note_id)
  );
end;
$$;


ALTER FUNCTION "public"."agent_save_note_v1"("p_agent" "jsonb", "p_note" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_evidence_coverage_v1"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('audit_evidence_coverage_v1', '{}'::jsonb);
  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR NOT (v_remote ? 'table_counts') THEN
    RETURN jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable'
    );
  END IF;
  RETURN v_remote;
END;
$$;


ALTER FUNCTION "public"."audit_evidence_coverage_v1"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."audit_evidence_coverage_v1"() IS 'Deterministic evidence coverage and data integrity audit returning table counts, duplicates, orphans, and pilot incompleteness metrics.';



CREATE OR REPLACE FUNCTION "public"."batch_suggest_orthographic_candidates_v1"("p_queries" "text"[], "p_limit_per_query" integer DEFAULT 10, "p_min_chars" integer DEFAULT 2) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '15s'
    AS $$
declare
  v_results jsonb := '[]'::jsonb;
  v_q text;
  v_item jsonb;
  v_cand jsonb;
  v_enriched jsonb;
begin
  if p_queries is null or cardinality(p_queries) = 0 then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'p_queries array must not be empty');
  end if;
  if cardinality(p_queries) > 20 then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'Maximum 20 queries per batch call');
  end if;

  foreach v_q in array p_queries
  loop
    v_item := public.suggest_orthographic_candidates_v1(v_q, p_limit_per_query, p_min_chars);
    if v_item->>'status' = 'ok' then
      -- Enrich candidates with documented relationship cross-referencing
      select coalesce(jsonb_agg(
        elem || jsonb_build_object(
          'has_documented_root', exists (
            select 1 from public.lemma_root_links rl1
            join public.lemma_root_links rl2 on rl2.root_id = rl1.root_id and rl2.lemma_id <> rl1.lemma_id
            join public.lemmas l_src on l_src.id = rl1.lemma_id and l_src.lemma_key = elem->>'source_lemma_key'
            where rl2.lemma_id = (elem->>'candidate_id')::bigint
          ),
          'has_documented_formation', exists (
            select 1 from public.lemma_components c
            join public.lexical_formations f on f.id = c.formation_id
            join public.lemmas l_src on l_src.id = f.lemma_id and l_src.lemma_key = elem->>'source_lemma_key'
            where c.component_lemma_id = (elem->>'candidate_id')::bigint
               or exists (
                 select 1 from public.lemma_components c2
                 where c2.formation_id = c.formation_id and c2.component_lemma_id = (elem->>'candidate_id')::bigint
               )
          ),
          'existing_connection_type', (
            select con.relation_type from public.lexical_connections con
            join public.lemmas l_src on l_src.id = con.subject_lemma_id and l_src.lemma_key = elem->>'source_lemma_key'
            where con.target_lemma_id = (elem->>'candidate_id')::bigint
            limit 1
          )
        )
      ), '[]'::jsonb)
      into v_enriched
      from jsonb_array_elements(v_item->'candidate_connections') elem;

      v_results := v_results || jsonb_build_array(
        v_item || jsonb_build_object('candidate_connections', v_enriched)
      );
    else
      v_results := v_results || jsonb_build_array(v_item);
    end if;
  end loop;

  return jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'batch_size', cardinality(p_queries),
    'results', v_results,
    'method', 'batch_orthographic_candidate_discovery_pipeline_v1',
    'limitations', 'Consonantal resemblance is unverified exploratory data. Documented roots, formations, and literary connections are cross-referenced to prevent synthetic etymologies.'
  );
end;
$$;


ALTER FUNCTION "public"."batch_suggest_orthographic_candidates_v1"("p_queries" "text"[], "p_limit_per_query" integer, "p_min_chars" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."batch_suggest_orthographic_candidates_v1"("p_queries" "text"[], "p_limit_per_query" integer, "p_min_chars" integer) IS 'Batch candidate discovery across word arrays with documented root, formation, and connection cross-referencing.';



CREATE OR REPLACE FUNCTION "public"."calculate_gematria"("p_word" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
declare
  v_norm text;
  v_len integer;
  v_i integer;
  v_ch text;
  v_sum integer := 0;
begin
  if p_word is null or p_word = '' then
    return 0;
  end if;

  v_norm := lower(regexp_replace(
    normalize(p_word, NFKD),
    '[\u0591-\u05C7\u0300-\u036F]',
    '',
    'g'
  ));
  v_len := length(v_norm);

  for v_i in 1..v_len loop
    v_ch := substr(v_norm, v_i, 1);
    case v_ch
      -- Hebrew consonants (Standard Gematria: sofit forms retain base values)
      when 'א' then v_sum := v_sum + 1;
      when 'ב' then v_sum := v_sum + 2;
      when 'ג' then v_sum := v_sum + 3;
      when 'ד' then v_sum := v_sum + 4;
      when 'ה' then v_sum := v_sum + 5;
      when 'ו' then v_sum := v_sum + 6;
      when 'ז' then v_sum := v_sum + 7;
      when 'ח' then v_sum := v_sum + 8;
      when 'ט' then v_sum := v_sum + 9;
      when 'י' then v_sum := v_sum + 10;
      when 'כ', 'ך' then v_sum := v_sum + 20;
      when 'ל' then v_sum := v_sum + 30;
      when 'מ', 'ם' then v_sum := v_sum + 40;
      when 'נ', 'ן' then v_sum := v_sum + 50;
      when 'ס' then v_sum := v_sum + 60;
      when 'ע' then v_sum := v_sum + 70;
      when 'פ', 'ף' then v_sum := v_sum + 80;
      when 'צ', 'ץ' then v_sum := v_sum + 90;
      when 'ק' then v_sum := v_sum + 100;
      when 'ר' then v_sum := v_sum + 200;
      when 'ש' then v_sum := v_sum + 300;
      when 'ת' then v_sum := v_sum + 400;

      -- Greek letters (Standard Isopsephy)
      when 'α' then v_sum := v_sum + 1;
      when 'β' then v_sum := v_sum + 2;
      when 'γ' then v_sum := v_sum + 3;
      when 'δ' then v_sum := v_sum + 4;
      when 'ε' then v_sum := v_sum + 5;
      when 'ϛ', 'ϝ' then v_sum := v_sum + 6;
      when 'ζ' then v_sum := v_sum + 7;
      when 'η' then v_sum := v_sum + 8;
      when 'θ' then v_sum := v_sum + 9;
      when 'ι' then v_sum := v_sum + 10;
      when 'κ' then v_sum := v_sum + 20;
      when 'λ' then v_sum := v_sum + 30;
      when 'μ' then v_sum := v_sum + 40;
      when 'ν' then v_sum := v_sum + 50;
      when 'ξ' then v_sum := v_sum + 60;
      when 'ο' then v_sum := v_sum + 70;
      when 'π' then v_sum := v_sum + 80;
      when 'ϟ' then v_sum := v_sum + 90;
      when 'ρ' then v_sum := v_sum + 100;
      when 'σ', 'ς' then v_sum := v_sum + 200;
      when 'τ' then v_sum := v_sum + 300;
      when 'υ' then v_sum := v_sum + 400;
      when 'φ' then v_sum := v_sum + 500;
      when 'χ' then v_sum := v_sum + 600;
      when 'ψ' then v_sum := v_sum + 700;
      when 'ω' then v_sum := v_sum + 800;
      when 'ϡ' then v_sum := v_sum + 900;
      else null;
    end case;
  end loop;

  return v_sum;
end;
$$;


ALTER FUNCTION "public"."calculate_gematria"("p_word" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_url text := 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev/v1/rpc/' || p_operation;
  v_body text := coalesce(p_params, '{}'::jsonb)::text;
  v_status integer;
  v_content text;
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..3 LOOP
    BEGIN
      PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '4000');
      PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');

      SELECT h.status, h.content
      INTO v_status, v_content
      FROM extensions.http_post(v_url, v_body, 'application/json') h;

      IF v_status = 200 AND v_content IS NOT NULL THEN
        RETURN v_content::jsonb;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Retry on transient libcurl/TLS connection reset or timeout
      v_status := NULL;
      v_content := NULL;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") IS 'Hybrid storage gateway: invokes the immutable Cloudflare Static Assets Worker (bibleresearch-corpus) for static evidence and 983-file Macula syntax RPCs.';



CREATE OR REPLACE FUNCTION "public"."chronology_guard_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_table_name='chronology_revisions' then raise exception 'Revision history is append-only'; end if;
  if (to_jsonb(old)->>'published')::boolean then raise exception 'Published chronology rows are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;


ALTER FUNCTION "public"."chronology_guard_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronology_guard_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare doc jsonb; frozen boolean;
begin
  if tg_op='UPDATE' then raise exception 'Recreate draft associations instead of moving snapshot identities'; end if;
  doc := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name in ('chronology_assignments','chronology_assignment_assertions') then
    select r.published into frozen from public.chronology_runs r where r.id=(doc->>'run_id')::bigint;
  elsif tg_table_name='chronology_assertion_evidence' then
    select a.published into frozen from public.chronology_assertions a where a.id=(doc->>'assertion_id')::bigint;
  else
    select e.published into frozen from public.chronology_events e where e.id=(doc->>'event_id')::bigint;
  end if;
  if frozen then raise exception 'Published chronology associations are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;


ALTER FUNCTION "public"."chronology_guard_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronology_publish_run"("p_model_id" "text", "p_label" "text", "p_activate" boolean DEFAULT true) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare rid bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('chronology:'||p_model_id,0));
  if not exists(select 1 from public.chronology_models where id=p_model_id and published) then
    raise exception 'Publish the model and all referenced content first';
  end if;
  if exists(select 1 from public.chronology_assertions a join public.chronology_sources s on s.id=a.source_id
    where a.model_id=p_model_id and a.published and not s.published) then
    raise exception 'An assertion source is unpublished';
  end if;
  insert into public.chronology_runs(model_id,label) values(p_model_id,p_label) returning id into rid;
  insert into public.chronology_assignments(run_id,model_id,verse_id,status)
  select rid,p_model_id,v.id,case
    when count(a.id) filter(where a.axis<>'mentioned_event')=0 then 'unresolved'
    when count(distinct (a.earliest_year,a.latest_year)) filter(where a.axis in ('setting','source_placement'))>1 then 'conflicting'
    when bool_or(a.review_status in ('model_assumption','reviewed')) then 'estimated'
    else 'source_estimate' end
  from public.verses v left join public.chronology_assertions a
    on a.verse_id=v.id and a.model_id=p_model_id and a.published
    and not exists(select 1 from public.chronology_assertions newer where newer.supersedes=a.id and newer.published and newer.model_id=p_model_id)
  group by v.id;
  insert into public.chronology_assignment_assertions(run_id,verse_id,model_id,assertion_id)
  select rid,a.verse_id,p_model_id,a.id from public.chronology_assertions a
  where a.model_id=p_model_id and a.published and a.verse_id is not null
    and not exists(select 1 from public.chronology_assertions newer where newer.supersedes=a.id and newer.published and newer.model_id=p_model_id);
  update public.chronology_runs set coverage=(select jsonb_build_object(
    'passages',count(*),'dated',count(*) filter(where status<>'unresolved'),
    'unresolved',count(*) filter(where status='unresolved'),'conflicting',count(*) filter(where status='conflicting'))
    from public.chronology_assignments where run_id=rid),published=true where id=rid;
  if p_activate then
    insert into public.chronology_active_runs(model_id,run_id) values(p_model_id,rid)
    on conflict(model_id) do update set run_id=excluded.run_id;
  end if;
  return rid;
end $$;


ALTER FUNCTION "public"."chronology_publish_run"("p_model_id" "text", "p_label" "text", "p_activate" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronology_year_label"("y" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
 select case
   when y <= 0 then (1::bigint - y)::text || ' BC (Year ' || (y + 3970)::text || ')'
   else 'AD ' || y::text || ' (Year ' || (y + 3970)::text || ')'
 end
$$;


ALTER FUNCTION "public"."chronology_year_label"("y" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clean_stale_hebrew_lxx_jeremiah_v1"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.hebrew_lxx_verse_map 
  WHERE id IN (
    SELECT m.id 
    FROM public.hebrew_lxx_verse_map m 
    JOIN public.verses v ON v.id = m.canonical_verse_id 
    WHERE v.book = 24 AND m.derivation_method = 'mt_lxx_versification_alignment'
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."clean_stale_hebrew_lxx_jeremiah_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compare_hebrew_septuagint_passage_v1"("p_hebrew_book" integer DEFAULT NULL::integer, "p_hebrew_chapter" integer DEFAULT NULL::integer, "p_hebrew_verse" integer DEFAULT NULL::integer, "p_canonical_verse_id" integer DEFAULT NULL::integer, "p_lxx_book_no" smallint DEFAULT NULL::smallint, "p_lxx_chapter" smallint DEFAULT NULL::smallint, "p_lxx_verse_nr" smallint DEFAULT NULL::smallint, "p_lxx_chapter_suffix" "text" DEFAULT ''::"text", "p_lxx_verse_suffix" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'compare_hebrew_septuagint_passage_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_hebrew_book', p_hebrew_book,
      'p_hebrew_chapter', p_hebrew_chapter,
      'p_hebrew_verse', p_hebrew_verse,
      'p_canonical_verse_id', p_canonical_verse_id,
      'p_lxx_book_no', p_lxx_book_no,
      'p_lxx_chapter', p_lxx_chapter,
      'p_lxx_verse_nr', p_lxx_verse_nr,
      'p_lxx_chapter_suffix', coalesce(p_lxx_chapter_suffix, ''),
      'p_lxx_verse_suffix', coalesce(p_lxx_verse_suffix, '')
    ))
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'message', 'Static corpus worker unavailable'
  );
END;
$$;


ALTER FUNCTION "public"."compare_hebrew_septuagint_passage_v1"("p_hebrew_book" integer, "p_hebrew_chapter" integer, "p_hebrew_verse" integer, "p_canonical_verse_id" integer, "p_lxx_book_no" smallint, "p_lxx_chapter" smallint, "p_lxx_verse_nr" smallint, "p_lxx_chapter_suffix" "text", "p_lxx_verse_suffix" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_children_items"("parent_item_id" bigint, "p_table_name" "text", "p_post_ids" bigint[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    parent_item RECORD;
    post_id BIGINT;
BEGIN
    -- Security Check: Ensure the user calling this function owns the parent item.
    EXECUTE format('SELECT * FROM %I WHERE id = %L', p_table_name, parent_item_id)
    INTO parent_item;

    IF parent_item.user_id IS NULL OR parent_item.user_id != public.get_shopify_customer_id() THEN
        RAISE EXCEPTION 'Permission denied: You do not own the parent item.';
    END IF;

    -- Loop through each selected post ID and create a new child item.
    FOREACH post_id IN ARRAY p_post_ids
    LOOP
        -- Insert a new row, setting only the parent and post reference columns.
        -- Other attributes will be NULL, relying on frontend logic to inherit them visually.
        EXECUTE format(
            'INSERT INTO %I (parent, connectionpost_reference, user_id, connectionpage_reference) VALUES (%L, %L, %L, %L)',
            p_table_name,
            parent_item_id,
            post_id,
            parent_item.user_id,
            parent_item.connectionpage_reference
        );
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."create_children_items"("parent_item_id" bigint, "p_table_name" "text", "p_post_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decode_grammar_v1"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
declare
  raw text := trim(p_code);
  res jsonb := '{}'::jsonb;
  parts text[];
  part text;
  main_part text := '';
  pfx text[] := array[]::text[];
  sfx jsonb := null;
  pos text; stem text; aspect text; person text; gender text;
  num text; state_val text; case_val text; tense_val text;
  voice_val text; mood_val text; noun_type text;
  g_parts text[];
  g_form text;
  g_decl text;
  c char;
begin
  if raw is null or raw = '' then return '{}'::jsonb; end if;

  -- Greek Robinson / STEP TEGMC style: contains '-' or known Greek invariable tokens
  if raw like '%-%' or raw in ('PREP','CONJ','ADV','PRT','INJ','HEB','ARAM') then
    g_parts := string_to_array(raw, '-');
    g_form := g_parts[1];
    case g_form
      when 'V' then pos := 'verb';
      when 'N' then pos := 'noun';
      when 'A' then pos := 'adjective';
      when 'T' then pos := 'article';
      when 'P', 'R', 'C', 'D', 'I', 'X', 'F', 'S', 'Q' then pos := 'pronoun';
      when 'PREP' then pos := 'preposition';
      when 'CONJ' then pos := 'conjunction';
      when 'ADV' then pos := 'adverb';
      when 'PRT' then pos := 'particle';
      when 'INJ' then pos := 'interjection';
      when 'HEB', 'ARAM' then pos := 'foreign';
      else pos := lower(g_form);
    end case;

    if pos = 'verb' and array_length(g_parts, 1) >= 2 then
      g_form := g_parts[2];
      if g_form like '2%' then
        c := substring(g_form from 2 for 1);
        g_form := substring(g_form from 3);
      else
        c := substring(g_form from 1 for 1);
        g_form := substring(g_form from 2);
      end if;
      case c
        when 'P' then tense_val := 'present';
        when 'I' then tense_val := 'imperfect';
        when 'F' then tense_val := 'future';
        when 'A' then tense_val := 'aorist';
        when 'X', 'R' then tense_val := 'perfect';
        when 'Y', 'L' then tense_val := 'pluperfect';
        else tense_val := null;
      end case;
      c := substring(g_form from 1 for 1);
      g_form := substring(g_form from 2);
      case c
        when 'A' then voice_val := 'active';
        when 'M' then voice_val := 'middle';
        when 'P' then voice_val := 'passive';
        when 'E' then voice_val := 'middle_or_passive';
        when 'D' then voice_val := 'deponent';
        else voice_val := null;
      end case;
      c := substring(g_form from 1 for 1);
      case c
        when 'I' then mood_val := 'indicative';
        when 'S' then mood_val := 'subjunctive';
        when 'O' then mood_val := 'optative';
        when 'M' then mood_val := 'imperative';
        when 'N' then mood_val := 'infinitive'; aspect := 'infinitive';
        when 'P' then mood_val := 'participle'; aspect := 'participle';
        else mood_val := null;
      end case;

      if array_length(g_parts, 1) >= 3 then
        g_decl := g_parts[3];
        if mood_val = 'participle' then
          case substring(g_decl from 1 for 1)
            when 'N' then case_val := 'nominative';
            when 'G' then case_val := 'genitive';
            when 'D' then case_val := 'dative';
            when 'A' then case_val := 'accusative';
            when 'V' then case_val := 'vocative';
            else case_val := null;
          end case;
          case substring(g_decl from 2 for 1)
            when 'S' then num := 'singular';
            when 'P' then num := 'plural';
            else num := null;
          end case;
          case substring(g_decl from 3 for 1)
            when 'M' then gender := 'masculine';
            when 'F' then gender := 'feminine';
            when 'N' then gender := 'neuter';
            else gender := null;
          end case;
        else
          case substring(g_decl from 1 for 1)
            when '1' then person := 'first';
            when '2' then person := 'second';
            when '3' then person := 'third';
            else person := null;
          end case;
          case substring(g_decl from 2 for 1)
            when 'S' then num := 'singular';
            when 'P' then num := 'plural';
            else num := null;
          end case;
        end if;
      end if;
    elsif pos in ('noun', 'adjective', 'article', 'pronoun') and array_length(g_parts, 1) >= 2 then
      g_decl := g_parts[2];
      case substring(g_decl from 1 for 1)
        when 'N' then case_val := 'nominative';
        when 'G' then case_val := 'genitive';
        when 'D' then case_val := 'dative';
        when 'A' then case_val := 'accusative';
        when 'V' then case_val := 'vocative';
        else case_val := null;
      end case;
      case substring(g_decl from 2 for 1)
        when 'S' then num := 'singular';
        when 'P' then num := 'plural';
        else num := null;
      end case;
      case substring(g_decl from 3 for 1)
        when 'M' then gender := 'masculine';
        when 'F' then gender := 'feminine';
        when 'N' then gender := 'neuter';
        else gender := null;
      end case;
    end if;

  else
    -- Hebrew / Aramaic (STEP TEHMC / ETCBC adapted)
    parts := string_to_array(raw, '/');
    for idx in 1..array_length(parts, 1) loop
      part := parts[idx];
      if part like 'Sp%' or part like 'HSp%' or part like 'ASp%' then
        part := regexp_replace(part, '^[HA]', '');
        sfx := jsonb_build_object(
          'type', 'pronominal',
          'person', case substring(part from 3 for 1) when '1' then 'first' when '2' then 'second' when '3' then 'third' else null end,
          'gender', case substring(part from 4 for 1) when 'm' then 'masculine' when 'f' then 'feminine' when 'c' then 'common' when 'b' then 'both' else null end,
          'number', case substring(part from 5 for 1) when 's' then 'singular' when 'p' then 'plural' when 'd' then 'dual' else null end
        );
      elsif part in ('Ta', 'HTa', 'ATa') then
        sfx := jsonb_build_object('type', 'emphatic_postpositive');
      elsif idx < array_length(parts, 1) and part in ('HTd', 'Td', 'd') then
        pfx := array_append(pfx, 'article');
      elsif idx < array_length(parts, 1) and part in ('HC', 'Hc', 'C', 'c', 'AC', 'Ac') then
        pfx := array_append(pfx, 'conjunction');
      elsif idx < array_length(parts, 1) and part in ('HR', 'Hr', 'R', 'r', 'AR', 'Ar') then
        pfx := array_append(pfx, 'preposition');
      elsif idx < array_length(parts, 1) and part in ('HRd', 'Rd') then
        pfx := array_append(pfx, 'preposition');
        pfx := array_append(pfx, 'article');
      elsif idx < array_length(parts, 1) and part in ('HTi', 'Ti') then
        pfx := array_append(pfx, 'interrogative');
      else
        main_part := part;
      end if;
    end loop;

    if main_part = '' then
      main_part := parts[array_length(parts, 1)];
      if array_length(pfx, 1) > 0 then
        pfx := pfx[1:array_length(pfx, 1) - 1];
      end if;
    end if;

    main_part := regexp_replace(main_part, '^[HA]', '');
    c := substring(main_part from 1 for 1);

    if c = 'V' then
      pos := 'verb';
      case substring(main_part from 2 for 1)
        when 'q' then stem := 'qal';
        when 'n' then stem := 'niphal';
        when 'p' then stem := 'piel';
        when 'P' then stem := 'pual';
        when 'h' then stem := 'hiphil';
        when 'H' then stem := 'hophal';
        when 't' then stem := 'hithpael';
        when 'o' then stem := 'polel';
        when 'O' then stem := 'polal';
        when 'r' then stem := 'hithpolel';
        when 'm' then stem := 'poel';
        when 'M' then stem := 'poal';
        when 'k' then stem := 'palpel';
        when 'K' then stem := 'polpal';
        else stem := null;
      end case;
      case substring(main_part from 3 for 1)
        when 'p' then aspect := 'perfect';
        when 'q' then aspect := 'weqatal';
        when 'i' then aspect := 'imperfect';
        when 'w' then aspect := 'wayyiqtol';
        when 'v' then aspect := 'imperative';
        when 'r' then aspect := 'participle';
        when 's' then aspect := 'passive_participle';
        when 'c' then aspect := 'infinitive_construct';
        when 'a' then aspect := 'infinitive_absolute';
        when 'j' then aspect := 'jussive';
        when 'e' then aspect := 'cohortative';
        else aspect := null;
      end case;

      if aspect in ('participle', 'passive_participle') then
        case substring(main_part from 4 for 1)
          when 'm' then gender := 'masculine';
          when 'f' then gender := 'feminine';
          when 'c', 'b' then gender := 'common';
          else gender := null;
        end case;
        case substring(main_part from 5 for 1)
          when 's' then num := 'singular';
          when 'p' then num := 'plural';
          when 'd' then num := 'dual';
          else num := null;
        end case;
        case substring(main_part from 6 for 1)
          when 'a' then state_val := 'absolute';
          when 'c' then state_val := 'construct';
          when 'e', 'd' then state_val := 'emphatic';
          else state_val := null;
        end case;
      elsif aspect in ('infinitive_construct', 'infinitive_absolute') then
        case substring(main_part from 4 for 1)
          when 'a' then state_val := 'absolute';
          when 'c' then state_val := 'construct';
          else state_val := null;
        end case;
      else
        case substring(main_part from 4 for 1)
          when '1' then person := 'first';
          when '2' then person := 'second';
          when '3' then person := 'third';
          else person := null;
        end case;
        case substring(main_part from 5 for 1)
          when 'm' then gender := 'masculine';
          when 'f' then gender := 'feminine';
          when 'c', 'b' then gender := 'common';
          else gender := null;
        end case;
        case substring(main_part from 6 for 1)
          when 's' then num := 'singular';
          when 'p' then num := 'plural';
          when 'd' then num := 'dual';
          else num := null;
        end case;
      end if;

    elsif c = 'N' then
      pos := 'noun';
      case substring(main_part from 2 for 1)
        when 'c' then noun_type := 'common';
        when 'p' then noun_type := 'proper';
        when 'g' then noun_type := 'gentilic';
        else noun_type := null;
      end case;
      case substring(main_part from 3 for 1)
        when 'm' then gender := 'masculine';
        when 'f' then gender := 'feminine';
        when 'c', 'b' then gender := 'common';
        when 'l' then noun_type := 'proper_location';
        else gender := null;
      end case;
      case substring(main_part from 4 for 1)
        when 's' then num := 'singular';
        when 'p' then num := 'plural';
        when 'd' then num := 'dual';
        else num := null;
      end case;
      case substring(main_part from 5 for 1)
        when 'a' then state_val := 'absolute';
        when 'c' then state_val := 'construct';
        when 'd', 'e' then state_val := 'emphatic';
        else state_val := null;
      end case;

    elsif c = 'A' then
      pos := 'adjective';
      case substring(main_part from 3 for 1)
        when 'm' then gender := 'masculine';
        when 'f' then gender := 'feminine';
        when 'c', 'b' then gender := 'common';
        else gender := null;
      end case;
      case substring(main_part from 4 for 1)
        when 's' then num := 'singular';
        when 'p' then num := 'plural';
        when 'd' then num := 'dual';
        else num := null;
      end case;
      case substring(main_part from 5 for 1)
        when 'a' then state_val := 'absolute';
        when 'c' then state_val := 'construct';
        when 'd', 'e' then state_val := 'emphatic';
        else state_val := null;
      end case;

    elsif c = 'P' then
      pos := 'pronoun';
    elsif c = 'R' then
      pos := 'preposition';
    elsif c = 'C' then
      pos := 'conjunction';
    elsif c = 'D' then
      pos := 'adverb';
    elsif c = 'T' then
      pos := 'particle';
    end if;

    if pos is null then
      if main_part in ('R', 'r') then pos := 'preposition';
      elsif main_part in ('C', 'c') then pos := 'conjunction';
      elsif main_part in ('D', 'd') then pos := 'adverb';
      elsif main_part in ('T', 't', 'To', 'Tn', 'Ti', 'Te', 'Td') then pos := 'particle';
      elsif main_part in ('P', 'p') then pos := 'pronoun';
      else pos := lower(main_part);
      end if;
    end if;
  end if;

  res := jsonb_strip_nulls(jsonb_build_object(
    'pos', pos,
    'stem', stem,
    'aspect', aspect,
    'tense', tense_val,
    'voice', voice_val,
    'mood', mood_val,
    'person', person,
    'gender', gender,
    'number', num,
    'state', state_val,
    'case', case_val,
    'type', noun_type,
    'prefixes', case when array_length(pfx, 1) > 0 then to_jsonb(pfx) else null end,
    'suffix', sfx
  ));
  return res;
end;
$$;


ALTER FUNCTION "public"."decode_grammar_v1"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_note_v1"("p_note_id" "uuid", "p_expected_version" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '10s'
    AS $$
declare
  v_settings record;
  v_curr_ver int;
  v_new_ver int;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
begin
  select * into v_settings from public.note_settings where id = true;
  if v_settings is null or not coalesce(v_settings.human_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'Human writes are currently disabled in note_settings'
      )
    );
  end if;

  select version into v_curr_ver
  from public.notes
  where id = p_note_id
  for update;

  if v_curr_ver is null then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_found',
        'message', 'Note not found: ' || p_note_id::text,
        'field', 'id'
      )
    );
  end if;

  if p_expected_version is not null and p_expected_version <> v_curr_ver then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'version_conflict',
        'message', 'Version conflict. Current version is ' || v_curr_ver::text,
        'current_version', v_curr_ver,
        'field', 'expected_version'
      )
    );
  end if;

  update public.notes
  set status = 'removed',
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_note_id
  returning version into v_new_ver;

  insert into public.note_revisions (
    note_id, version, action, editor_author_id, editor_kind, snapshot
  ) values (
    p_note_id, v_new_ver, 'delete', v_author_id, 'human', public.note_json_v1(p_note_id)
  );

  return jsonb_build_object('ok', true, 'status', 'removed');
end;
$$;


ALTER FUNCTION "public"."delete_note_v1"("p_note_id" "uuid", "p_expected_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dlm_note_metadata_valid_v1"("meta" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
DECLARE item jsonb; n integer; cls text; kind text;
BEGIN
 IF meta IS NULL OR jsonb_typeof(meta)<>'object' THEN RETURN false; END IF;
 IF meta->>'schema_version'<>'1' THEN RETURN false; END IF;
 cls:=meta->>'evidence_class'; kind:=meta->>'card_kind';
 IF kind IS NULL OR kind NOT IN ('lexical_definition','biblical_definition','text_observation','explicit_symbol','literary_connection','narrative_event','physical_mechanism','dlm_layer_hypothesis','unresolved_question') THEN RETURN false; END IF;
 IF cls IS NULL OR cls NOT IN ('TEXT_EXPLICIT','TEXT_LINGUISTIC','TEXT_INTERTEXTUAL','TEXT_PATTERN','SCIENCE_EMPIRICAL','DLM_HYPOTHESIS','DISPUTED','OPEN') THEN RETURN false; END IF;
 IF jsonb_typeof(meta->'claim')<>'string' OR length(btrim(meta->>'claim'))<12 OR length(meta->>'claim')>600 THEN RETURN false; END IF;
 IF jsonb_typeof(meta->'scope')<>'string' OR length(btrim(meta->>'scope'))<5 OR length(meta->>'scope')>1000 THEN RETURN false; END IF;
 IF meta ? 'form_flow' AND (meta->>'form_flow') NOT IN ('structure','flow','both','neither','unknown') THEN RETURN false; END IF;
 IF NOT meta ? 'layers' OR jsonb_typeof(meta->'layers')<>'array' OR jsonb_array_length(meta->'layers')>8 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'layers') LOOP
   IF jsonb_typeof(item)<>'number' OR item::text NOT IN ('0','1','2','3','4','5','6','7') THEN RETURN false; END IF;
 END LOOP;
 IF NOT meta ? 'scriptures' OR jsonb_typeof(meta->'scriptures')<>'array' OR jsonb_array_length(meta->'scriptures')<1 OR jsonb_array_length(meta->'scriptures')>8 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'scriptures') LOOP
   IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'book')<>'number' OR jsonb_typeof(item->'chapter')<>'number'
     OR jsonb_typeof(item->'verse')<>'number' THEN RETURN false; END IF;
   IF (item->>'book')::integer NOT BETWEEN 1 AND 66 OR (item->>'chapter')::integer NOT BETWEEN 1 AND 150 OR (item->>'verse')::integer NOT BETWEEN 0 AND 176 THEN RETURN false; END IF;
   IF item ? 'word_position' AND (jsonb_typeof(item->'word_position')<>'number' OR (item->>'word_position')::integer<1) THEN RETURN false; END IF;
 END LOOP;
 IF NOT meta ? 'science_sources' OR jsonb_typeof(meta->'science_sources')<>'array' OR jsonb_array_length(meta->'science_sources')>6 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'science_sources') LOOP
   IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'title')<>'string' OR length(btrim(item->>'title'))<4
     OR jsonb_typeof(item->'url')<>'string' OR (item->>'url') !~* '^https://[^[:space:]<>"]{4,500}$' THEN RETURN false; END IF;
 END LOOP;
 IF cls='SCIENCE_EMPIRICAL' AND jsonb_array_length(meta->'science_sources')=0 THEN RETURN false; END IF;
 IF kind='physical_mechanism' AND cls<>'SCIENCE_EMPIRICAL' THEN RETURN false; END IF;
 IF kind='dlm_layer_hypothesis' AND cls<>'DLM_HYPOTHESIS' THEN RETURN false; END IF;
 IF kind='dlm_layer_hypothesis' AND jsonb_array_length(meta->'layers')=0 THEN RETURN false; END IF;
 IF kind='lexical_definition' AND cls<>'TEXT_LINGUISTIC' THEN RETURN false; END IF;
 IF kind='biblical_definition' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_INTERTEXTUAL','TEXT_PATTERN') THEN RETURN false; END IF;
 IF kind='text_observation' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_LINGUISTIC') THEN RETURN false; END IF;
 IF kind='literary_connection' AND cls NOT IN ('TEXT_INTERTEXTUAL','TEXT_PATTERN','DLM_HYPOTHESIS','DISPUTED') THEN RETURN false; END IF;
 IF kind='narrative_event' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_PATTERN') THEN RETURN false; END IF;
 IF cls='SCIENCE_EMPIRICAL' AND kind<>'physical_mechanism' THEN RETURN false; END IF;
 IF cls='DLM_HYPOTHESIS' AND kind NOT IN ('dlm_layer_hypothesis','literary_connection') THEN RETURN false; END IF;
 IF kind='explicit_symbol' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_INTERTEXTUAL') THEN RETURN false; END IF;
 IF kind='unresolved_question' AND cls NOT IN ('OPEN','DISPUTED') THEN RETURN false; END IF;
 IF meta ? 'limitations' AND (jsonb_typeof(meta->'limitations')<>'string' OR length(meta->>'limitations')>1200) THEN RETURN false; END IF;
 IF meta ? 'counterexamples' THEN
   IF jsonb_typeof(meta->'counterexamples')<>'array' OR jsonb_array_length(meta->'counterexamples')>8 THEN RETURN false; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(meta->'counterexamples') LOOP
      IF jsonb_typeof(item)<>'string' OR length(item #>> '{}')>500 THEN RETURN false; END IF;
   END LOOP;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $_$;


ALTER FUNCTION "public"."dlm_note_metadata_valid_v1"("meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."export_static_corpus_page_v1"("p_table" "text", "p_after_id" bigint DEFAULT 0, "p_after_sub" bigint DEFAULT 0, "p_limit" integer DEFAULT 10000) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '30s'
    AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10000), 1), 25000);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.syntax_nodes LIMIT 1)
     OR NOT EXISTS (SELECT 1 FROM public.macula_hebrew_morphemes LIMIT 1)
     OR NOT EXISTS (SELECT 1 FROM public.macula_greek_tokens LIMIT 1)
     OR NOT EXISTS (SELECT 1 FROM public.lxx_swete_words LIMIT 1)
     OR NOT EXISTS (SELECT 1 FROM public.morphhb_tokens LIMIT 1)
     OR NOT EXISTS (SELECT 1 FROM public.tagnt_tokens LIMIT 1)
     OR NOT EXISTS (SELECT 1 FROM public.word_form_lemmas LIMIT 1)
     OR NOT EXISTS (SELECT 1 FROM public.verse_translation_sources LIMIT 1)
  THEN
    RAISE EXCEPTION 'Static corpus source table emptied or unavailable: refusing export to prevent overwriting Cloudflare with incomplete assets';
  END IF;
  CASE p_table
    WHEN 'macula_hebrew_morphemes' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.macula_hebrew_morphemes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'macula_greek_tokens' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.macula_greek_tokens WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'word_form_lemmas' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.word_form_lemmas WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lxx_swete_words' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lxx_swete_words WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'morphhb_tokens' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.morphhb_tokens WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'tagnt_tokens' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.tagnt_tokens WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'syntax_nodes_step' THEN
      SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'semantic_frame') ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.syntax_nodes WHERE tree_id IS NULL AND id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'syntax_edges_step' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT se.* FROM public.syntax_edges se
        JOIN public.syntax_nodes sn ON sn.id = se.target_node_id
        WHERE sn.tree_id IS NULL AND se.id > p_after_id
        ORDER BY se.id ASC LIMIT v_limit
      ) t;
    WHEN 'syntax_nodes_db' THEN
      SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'semantic_frame') ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.syntax_nodes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'syntax_edges_db' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.syntax_edges WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'verse_translation_sources' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.verse_id, t.word_position), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.verse_translation_sources
        WHERE (verse_id > p_after_id) OR (verse_id = p_after_id AND word_position > p_after_sub)
        ORDER BY verse_id ASC, word_position ASC
        LIMIT v_limit
      ) t;
    WHEN 'lexeme_identifiers' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexeme_identifiers WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'edition_passages' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.edition_passages WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'reader_rendering_groups' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.strongs_nr, t.label), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.reader_rendering_groups
        ORDER BY strongs_nr ASC, label ASC
        OFFSET p_after_id LIMIT v_limit
      ) t;
    WHEN 'hebrew_lxx_verse_map' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.hebrew_lxx_verse_map WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'reader_english_verses' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.edition_id, t.book, t.chapter, t.verse_nr), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.reader_english_verses
        ORDER BY edition_id ASC, book ASC, chapter ASC, verse_nr ASC
        OFFSET p_after_id LIMIT v_limit
      ) t;
    WHEN 'versification_mappings' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.versification_mappings WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'token_morphemes' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.token_morphemes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'cross_token_mappings' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.cross_token_mappings WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'words_immutable' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT id, strongs_nr, grammar_code, original_word, transliteration, co_occurrences, english_translations, gematria
        FROM public.words
        WHERE id > p_after_id
        ORDER BY id ASC LIMIT v_limit
      ) t;
    WHEN 'words_full' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.words WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'verses_immutable' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT id, book, chapter, verse_nr, word_ids
        FROM public.verses
        WHERE id > p_after_id
        ORDER BY id ASC LIMIT v_limit
      ) t;
    WHEN 'verses_full' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.verses WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'books' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.books WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lxx_swete_books' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.book_no), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lxx_swete_books WHERE book_no > p_after_id ORDER BY book_no ASC LIMIT v_limit) t;
    WHEN 'lemmas' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lemmas WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexemes' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexemes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_senses' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_senses WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_roots' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_roots WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lemma_root_links' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lemma_root_links WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_formations' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_formations WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lemma_components' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lemma_components WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_connections' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_connections WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'canonical_entities' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.canonical_entities WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'entity_relationships' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.entity_relationships WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'hebrew_lxx_word_alignments' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.hebrew_lxx_word_alignments WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'macula_gated_field_values' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.morpheme_id, t.field_name), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.macula_gated_field_values
        WHERE public.field_is_enabled('macula-hebrew', field_name)
        ORDER BY morpheme_id ASC, field_name ASC
        OFFSET p_after_id LIMIT v_limit
      ) t;
    WHEN 'source_releases' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.source_releases WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'source_editions' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.source_editions WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'field_license_registry' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.field_license_registry WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'reader_english_editions' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.reader_english_editions ORDER BY id ASC OFFSET p_after_id LIMIT v_limit) t;
    WHEN 'semantic_annotations' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.semantic_annotations WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    ELSE
      RAISE EXCEPTION 'Table % is not in the static corpus export allowlist', p_table USING ERRCODE = '22023';
  END CASE;

  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."export_static_corpus_page_v1"("p_table" "text", "p_after_id" bigint, "p_after_sub" bigint, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."field_is_enabled"("p_dataset" "text", "p_field" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select coalesce((select status in ('enabled', 'enabled_origin_unverified')
  from public.field_license_registry where dataset_key = p_dataset and field_name = p_field), false) $$;


ALTER FUNCTION "public"."field_is_enabled"("p_dataset" "text", "p_field" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."getVerseGeography"("book" integer, "chapter" integer, "verse" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select public.get_verse_geography(book, chapter, verse);
$$;


ALTER FUNCTION "public"."getVerseGeography"("book" integer, "chapter" integer, "verse" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bible_books_v1"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'books', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'testament', b.testament,
        'original_language', b.original_language,
        'total_chapters', b.total_chapters,
        'usfm', b.usfm,
        'theographic_code', b.theographic_code,
        'division', b.division
      ) order by b.id)
      from public.books b
    ), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."get_bible_books_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dlm_notes_for_verse_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_limit" integer DEFAULT 8) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
DECLARE v_id integer; v_word_ids integer[]; v_limit integer:=least(greatest(coalesce(p_limit,8),1),20);
 v_total integer:=0; v_items jsonb:='[]'::jsonb;
BEGIN
 SELECT v.id,v.word_ids INTO v_id,v_word_ids FROM public.verses v WHERE v.book=p_book AND v.chapter=p_chapter AND v.verse_nr=p_verse;
 IF v_id IS NULL THEN RETURN jsonb_build_object('status','verse_not_found','notes_total',0,'items','[]'::jsonb); END IF;
 WITH matching AS (
  SELECT n.id, n.title, n.body_md, n.note_kind, n.author_kind, n.review_status,n.confidence,n.updated_at,n.version,
    n.source_context->'dlm_v1' meta,
    a.anchor_kind,a.word_position,
    CASE a.anchor_kind
      WHEN 'word_occurrence' THEN 0
      WHEN 'verse' THEN 1
      WHEN 'verse_range' THEN 2
      WHEN 'lemma' THEN 3
      WHEN 'word_form' THEN 4
      ELSE 9 END priority
  FROM public.notes n JOIN public.note_anchors a ON a.note_id=n.id
  WHERE n.status='published' AND n.visibility='public'
    AND n.source_context ? 'dlm_v1'
    AND (
      (a.anchor_kind IN ('word_occurrence','verse') AND a.verse_id=v_id)
      OR (a.anchor_kind='verse_range' AND v_id BETWEEN a.verse_id AND a.end_verse_id)
      OR (a.anchor_kind='word_form' AND a.word_id=ANY(v_word_ids))
      OR (a.anchor_kind='lemma' AND EXISTS (
         SELECT 1 FROM bible_internal.word_form_lemmas_for_words_v1(v_word_ids) wfl
         WHERE wfl.lemma_id=a.lemma_id AND wfl.word_id=ANY(v_word_ids) AND wfl.is_context_ambiguous IS FALSE
      ))
    )
 ), dedup AS (
  SELECT DISTINCT ON (id) *
  FROM matching ORDER BY id,priority,updated_at DESC
 ), ranked AS (
  SELECT * FROM dedup
  ORDER BY CASE review_status WHEN 'confirmed' THEN 0 WHEN 'unreviewed' THEN 1 ELSE 2 END,
    CASE meta->>'evidence_class' WHEN 'TEXT_EXPLICIT' THEN 0 WHEN 'TEXT_LINGUISTIC' THEN 1
      WHEN 'TEXT_INTERTEXTUAL' THEN 2 WHEN 'SCIENCE_EMPIRICAL' THEN 3 WHEN 'TEXT_PATTERN' THEN 4
      WHEN 'DLM_HYPOTHESIS' THEN 5 ELSE 6 END,
    priority,updated_at DESC,id
 ), chosen AS (SELECT * FROM ranked LIMIT v_limit)
 SELECT (SELECT count(*)::integer FROM ranked),
  COALESCE((SELECT jsonb_agg(
    jsonb_build_object(
      'note_id',x.id,'title',x.title,'claim',x.meta->>'claim','scope',x.meta->>'scope',
      'card_kind',x.meta->>'card_kind','evidence_class',x.meta->>'evidence_class',
      'layers',x.meta->'layers','form_flow',x.meta->>'form_flow',
      'scientific_sources',x.meta->'science_sources','counterexamples',x.meta->'counterexamples',
      'limitations',x.meta->>'limitations','scriptures',x.meta->'scriptures',
      'note_kind',x.note_kind,'review_status',x.review_status,'author_kind',x.author_kind,
      'confidence',x.confidence,'version',x.version,
      'match',x.anchor_kind,'matched_word_position',x.word_position,
      'excerpt',left(x.body_md,350),'full_note_tool','get_notes'
    ) ORDER BY CASE x.review_status WHEN 'confirmed' THEN 0 WHEN 'unreviewed' THEN 1 ELSE 2 END,
      x.priority,x.updated_at DESC,x.id
  ) FROM chosen x),'[]'::jsonb)
 INTO v_total,v_items;
 RETURN jsonb_build_object('schema_version',1,'status',CASE WHEN v_total=0 THEN 'no_dlm_notes' ELSE 'ok' END,
    'canonical_reference',jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse,'verse_id',v_id),
    'epistemic_layer','research_commentary_not_scripture',
    'items',v_items,'coverage',jsonb_build_object('notes_total',v_total,'shown',jsonb_array_length(v_items),'truncated',v_total>v_limit,
       'restricted_to','published_public_dlm_notes','ranking','review status, evidence class, anchor specificity'),
    'warnings',jsonb_build_array('Even confirmed notes remain scholarly commentary, not canonical text.',
      'AI-generated notes are unreviewed until separately reviewed.',
      'DLM layer assignments are interpretive hypotheses, not empirical measurements or lexical senses.',
      'Scientific mechanisms are independent physical evidence and never prove theological analogies.'));
END $$;


ALTER FUNCTION "public"."get_dlm_notes_for_verse_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_hebrew_import_status_v1"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('get_hebrew_import_status_v1', '{}'::jsonb);
  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', 'FAIL') = 'FAIL' THEN
    RETURN jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable'
    );
  END IF;
  RETURN v_remote;
END;
$$;


ALTER FUNCTION "public"."get_hebrew_import_status_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_hebrew_septuagint_parallel_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_hebrew_septuagint_parallel_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'message', 'Static corpus worker unavailable'
  );
END;
$$;


ALTER FUNCTION "public"."get_hebrew_septuagint_parallel_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_jwt_claim"("claim_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN auth.jwt()->'app_metadata'->>claim_name;
END;
$$;


ALTER FUNCTION "public"."get_jwt_claim"("claim_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_shopify_id"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'shopify_customer_id', '');
$$;


ALTER FUNCTION "public"."get_my_shopify_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_note_v1"("p_note_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    SET "jit" TO 'off'
    AS $$
declare
  v_note jsonb;
  v_backlinks jsonb;
  v_revisions jsonb;
begin
  if p_note_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', n.id,
    'title', n.title,
    'body_md', n.body_md,
    'note_kind', n.note_kind,
    'language', n.language,
    'epistemic_layer', 'user_note',
    'author', jsonb_build_object(
      'id', a.id,
      'kind', a.author_kind,
      'display_name', a.display_name,
      'ai_provider', a.ai_provider,
      'ai_model', a.ai_model,
      'ai_client', a.ai_client
    ),
    'created_via', n.created_via,
    'review_status', n.review_status,
    'confidence', n.confidence,
    'status', n.status,
    'visibility', n.visibility,
    'version', n.version,
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'source_context', coalesce(n.source_context, '{}'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', anc.id,
          'kind', anc.anchor_kind,
          'role', anc.role,
          'label', anc.label,
          'ordinal', anc.ordinal,
          'verse_id', anc.verse_id,
          'end_verse_id', anc.end_verse_id,
          'word_position', anc.word_position,
          'word_id', anc.word_id,
          'lemma_id', anc.lemma_id,
          'concept_id', anc.concept_id,
          'place_id', anc.place_id,
          'event_id', anc.event_id,
          'target_note_id', anc.target_note_id,
          'external_uri', anc.external_uri,
          'block_id', anc.block_id,
          'element_ref', anc.element_ref
        ) order by anc.ordinal, anc.id
      )
      from public.note_anchors anc
      where anc.note_id = n.id
    ), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'from_anchor_id', c.from_anchor_id,
          'to_anchor_id', c.to_anchor_id,
          'connection_type', c.connection_type,
          'type_label', ct.label,
          'inverse_label', ct.inverse_label,
          'category', ct.category,
          'custom_label', c.custom_label,
          'direction', c.direction,
          'explanation', c.explanation
        ) order by c.id
      )
      from public.note_connections c
      left join public.note_connection_types ct on ct.type_key = c.connection_type
      where c.note_id = n.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'ordinal', b.ordinal,
          'block_type', b.block_type,
          'content', b.content,
          'text_alternative', b.text_alternative
        ) order by b.ordinal, b.id
      )
      from public.note_blocks b
      where b.note_id = n.id
    ), '[]'::jsonb)
  ) into v_note
  from public.notes n
  join public.note_authors a on a.id = n.author_id
  where n.id = p_note_id
    and n.status = 'published'
    and n.visibility = 'public';

  if v_note is null then
    return null;
  end if;

  -- Backlinks: notes anchored to this note via anchor_kind='note' and target_note_id = p_note_id
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', bn.id,
        'title', bn.title,
        'note_kind', bn.note_kind,
        'author', jsonb_build_object(
          'id', ba.id,
          'kind', ba.author_kind,
          'display_name', ba.display_name,
          'ai_model', ba.ai_model
        ),
        'status', bn.status,
        'created_at', bn.created_at
      ) order by bn.created_at desc, bn.id desc
    ),
    '[]'::jsonb
  ) into v_backlinks
  from public.note_anchors banc
  join public.notes bn on bn.id = banc.note_id
  join public.note_authors ba on ba.id = bn.author_id
  where banc.anchor_kind = 'note'
    and banc.target_note_id = p_note_id
    and bn.status = 'published'
    and bn.visibility = 'public';

  -- Revisions: summaries from note_revisions
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'version', r.version,
        'action', r.action,
        'editor_kind', r.editor_kind,
        'created_at', r.created_at
      ) order by r.version asc
    ),
    '[]'::jsonb
  ) into v_revisions
  from public.note_revisions r
  where r.note_id = p_note_id;

  v_note := v_note || jsonb_build_object('backlinks', v_backlinks, 'revisions', v_revisions);

  return v_note;
end;
$$;


ALTER FUNCTION "public"."get_note_v1"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_notes_for_passage_v1"("p_book" integer, "p_chapter" integer, "p_verse_start" integer, "p_verse_end" integer DEFAULT NULL::integer, "p_author_kind" "text" DEFAULT NULL::"text", "p_note_kind" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    SET "jit" TO 'off'
    AS $$
DECLARE
  v_verse_end int;
  v_limit int;
  v_verse_ids int[];
  v_min_vid int;
  v_max_vid int;
  v_primary_list jsonb;
  v_secondary_list jsonb;
  v_token_counts jsonb;
  v_primary_total int := 0;
  v_secondary_total int := 0;
  v_human_total int := 0;
  v_ai_total int := 0;
  v_result jsonb;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse_start IS NULL OR p_verse_start < 0 THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse_start', p_verse_start, 'verse_end', p_verse_end, 'verse_ids', '[]'::jsonb),
      'primary', '[]'::jsonb,
      'secondary', '[]'::jsonb,
      'totals', jsonb_build_object('primary', 0, 'secondary', 0, 'human', 0, 'ai', 0, 'total', 0),
      'truncated', jsonb_build_object('primary', false, 'secondary', false),
      'token_note_counts', '[]'::jsonb
    );
  END IF;

  v_verse_end := greatest(p_verse_start, coalesce(p_verse_end, p_verse_start));
  IF v_verse_end - p_verse_start + 1 > 100 THEN
    v_verse_end := p_verse_start + 99;
  END IF;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  SELECT array_agg(v.id ORDER BY v.id), min(v.id), max(v.id)
  INTO v_verse_ids, v_min_vid, v_max_vid
  FROM public.verses v
  WHERE v.book = p_book
    AND v.chapter = p_chapter
    AND v.verse_nr BETWEEN p_verse_start AND v_verse_end;

  IF v_verse_ids IS NULL OR array_length(v_verse_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse_start', p_verse_start, 'verse_end', v_verse_end, 'verse_ids', '[]'::jsonb),
      'primary', '[]'::jsonb,
      'secondary', '[]'::jsonb,
      'totals', jsonb_build_object('primary', 0, 'secondary', 0, 'human', 0, 'ai', 0, 'total', 0),
      'truncated', jsonb_build_object('primary', false, 'secondary', false),
      'token_note_counts', '[]'::jsonb
    );
  END IF;

  WITH passage_tokens AS (
    SELECT pv.id AS verse_id, pos.ord::int AS word_position, pos.val::int AS word_id
    FROM public.verses pv,
    unnest(pv.word_ids) WITH ORDINALITY AS pos(val, ord)
    WHERE pv.id = ANY(v_verse_ids)
  ),
  passage_words AS (
    SELECT DISTINCT word_id FROM passage_tokens
  ),
  passage_lemmas AS (
    SELECT DISTINCT l.id AS lemma_id, pw.word_id
    FROM passage_words pw
    JOIN bible_internal.word_form_lemmas_for_words_v1(ARRAY(SELECT word_id FROM passage_words)) wfl ON wfl.word_id = pw.word_id
      AND wfl.lemma_id IS NOT NULL
      AND wfl.is_context_ambiguous IS FALSE
    JOIN public.lemmas l ON l.id = wfl.lemma_id
  ),
  primary_matches AS (
    SELECT
      anc.note_id,
      CASE
        WHEN anc.anchor_kind = 'verse' THEN 'verse:' || anc.verse_id::text
        WHEN anc.anchor_kind = 'verse_range' THEN 'verse_range:' || anc.verse_id::text || '-' || anc.end_verse_id::text
        WHEN anc.anchor_kind = 'word_occurrence' THEN 'word_occurrence:' || anc.verse_id::text || ':' || anc.word_position::text
      END AS reason,
      anc.anchor_kind,
      anc.verse_id,
      anc.word_position,
      anc.word_id
    FROM public.note_anchors anc
    WHERE (
      (anc.anchor_kind = 'verse' AND anc.verse_id = ANY(v_verse_ids))
      OR (anc.anchor_kind = 'verse_range' AND anc.verse_id <= v_max_vid AND anc.end_verse_id >= v_min_vid AND EXISTS (
            SELECT 1 FROM unnest(v_verse_ids) x WHERE x BETWEEN anc.verse_id AND anc.end_verse_id
          ))
      OR (anc.anchor_kind = 'word_occurrence' AND anc.verse_id = ANY(v_verse_ids))
    )
  ),
  primary_summary AS (
    SELECT
      pm.note_id,
      array_agg(DISTINCT pm.reason) AS reasons,
      coalesce(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'verse_id', pm.verse_id,
            'word_position', pm.word_position,
            'word_id', pm.word_id
          )
        ) FILTER (WHERE pm.anchor_kind = 'word_occurrence'),
        '[]'::jsonb
      ) AS positions
    FROM primary_matches pm
    GROUP BY pm.note_id
  ),
  primary_all AS (
    SELECT
      n.id AS note_id,
      n.author_kind,
      ps.reasons,
      ps.positions,
      n.created_at
    FROM primary_summary ps
    JOIN public.notes n ON n.id = ps.note_id
    WHERE n.status = 'published'
      AND n.visibility = 'public'
      AND (p_author_kind IS NULL OR n.author_kind = p_author_kind)
      AND (p_note_kind IS NULL OR n.note_kind = p_note_kind)
  ),
  secondary_matches AS (
    SELECT
      anc.note_id,
      'word_form:' || anc.word_id::text AS reason,
      pt.verse_id,
      pt.word_position,
      pt.word_id
    FROM public.note_anchors anc
    JOIN passage_tokens pt ON pt.word_id = anc.word_id
    WHERE anc.anchor_kind = 'word_form'
      AND NOT EXISTS (SELECT 1 FROM primary_summary ps WHERE ps.note_id = anc.note_id)

    UNION ALL

    SELECT
      anc.note_id,
      'lemma:' || anc.lemma_id::text AS reason,
      pt.verse_id,
      pt.word_position,
      pt.word_id
    FROM public.note_anchors anc
    JOIN passage_lemmas pl ON pl.lemma_id = anc.lemma_id
    JOIN passage_tokens pt ON pt.word_id = pl.word_id
    WHERE anc.anchor_kind = 'lemma'
      AND NOT EXISTS (SELECT 1 FROM primary_summary ps WHERE ps.note_id = anc.note_id)
  ),
  secondary_summary AS (
    SELECT
      sm.note_id,
      array_agg(DISTINCT sm.reason) AS reasons,
      coalesce(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'verse_id', sm.verse_id,
            'word_position', sm.word_position,
            'word_id', sm.word_id
          )
        ),
        '[]'::jsonb
      ) AS positions
    FROM secondary_matches sm
    GROUP BY sm.note_id
  ),
  secondary_all AS (
    SELECT
      n.id AS note_id,
      n.author_kind,
      ss.reasons,
      ss.positions,
      n.created_at
    FROM secondary_summary ss
    JOIN public.notes n ON n.id = ss.note_id
    WHERE n.status = 'published'
      AND n.visibility = 'public'
      AND (p_author_kind IS NULL OR n.author_kind = p_author_kind)
      AND (p_note_kind IS NULL OR n.note_kind = p_note_kind)
  ),
  token_counts_agg AS (
    SELECT
      anc.verse_id,
      anc.word_position,
      count(*) FILTER (WHERE n.author_kind = 'human')::int AS human,
      count(*) FILTER (WHERE n.author_kind = 'ai')::int AS ai
    FROM public.note_anchors anc
    JOIN public.notes n ON n.id = anc.note_id
    WHERE anc.anchor_kind = 'word_occurrence'
      AND anc.verse_id = ANY(v_verse_ids)
      AND n.status = 'published'
      AND n.visibility = 'public'
      AND (p_author_kind IS NULL OR n.author_kind = p_author_kind)
      AND (p_note_kind IS NULL OR n.note_kind = p_note_kind)
    GROUP BY anc.verse_id, anc.word_position
    ORDER BY anc.verse_id, anc.word_position
  )
  SELECT
    (SELECT count(*)::int FROM primary_all),
    (SELECT count(*)::int FROM secondary_all),
    (SELECT count(*)::int FROM (
       SELECT pa.note_id FROM primary_all pa WHERE pa.author_kind = 'human'
       UNION
       SELECT sa.note_id FROM secondary_all sa WHERE sa.author_kind = 'human'
     ) u),
    (SELECT count(*)::int FROM (
       SELECT pa.note_id FROM primary_all pa WHERE pa.author_kind = 'ai'
       UNION
       SELECT sa.note_id FROM secondary_all sa WHERE sa.author_kind = 'ai'
     ) u),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'verse_id', tc.verse_id,
          'word_position', tc.word_position,
          'human', tc.human,
          'ai', tc.ai
        )
      ) FROM token_counts_agg tc
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'tier', 'primary',
          'reasons', to_jsonb(p_sub.reasons),
          'positions', p_sub.positions
        ) ORDER BY p_sub.created_at DESC, p_sub.note_id DESC
      )
      FROM (
        SELECT pa.note_id, pa.reasons, pa.positions, pa.created_at
        FROM primary_all pa
        ORDER BY pa.created_at DESC, pa.note_id DESC
        LIMIT v_limit
      ) p_sub
      JOIN public.notes n ON n.id = p_sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'tier', 'secondary',
          'reasons', to_jsonb(s_sub.reasons),
          'positions', s_sub.positions
        ) ORDER BY s_sub.created_at DESC, s_sub.note_id DESC
      )
      FROM (
        SELECT sa.note_id, sa.reasons, sa.positions, sa.created_at
        FROM secondary_all sa
        ORDER BY sa.created_at DESC, sa.note_id DESC
        LIMIT v_limit
      ) s_sub
      JOIN public.notes n ON n.id = s_sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb)
  INTO
    v_primary_total,
    v_secondary_total,
    v_human_total,
    v_ai_total,
    v_token_counts,
    v_primary_list,
    v_secondary_list;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'passage', jsonb_build_object(
      'book', p_book,
      'chapter', p_chapter,
      'verse_start', p_verse_start,
      'verse_end', v_verse_end,
      'verse_ids', v_verse_ids
    ),
    'primary', v_primary_list,
    'secondary', v_secondary_list,
    'totals', jsonb_build_object(
      'primary', v_primary_total,
      'secondary', v_secondary_total,
      'human', v_human_total,
      'ai', v_ai_total,
      'total', v_primary_total + v_secondary_total
    ),
    'truncated', jsonb_build_object(
      'primary', v_primary_total > v_limit,
      'secondary', v_secondary_total > v_limit
    ),
    'token_note_counts', v_token_counts
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_notes_for_passage_v1"("p_book" integer, "p_chapter" integer, "p_verse_start" integer, "p_verse_end" integer, "p_author_kind" "text", "p_note_kind" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_notes_for_word_v1"("p_word_id" integer, "p_verse_id" integer DEFAULT NULL::integer, "p_word_position" integer DEFAULT NULL::integer, "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    SET "jit" TO 'off'
    AS $$
DECLARE
  v_limit int;
  v_remote_wfl jsonb;
  v_lemma_ids bigint[];
  v_lemmas jsonb;
  v_occurrence_list jsonb;
  v_form_list jsonb;
  v_lemma_list jsonb;
  v_occ_total int := 0;
  v_form_total int := 0;
  v_lemma_total int := 0;
  v_human_total int := 0;
  v_ai_total int := 0;
  v_result jsonb;
BEGIN
  IF p_word_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'groups', jsonb_build_object('occurrence', '[]'::jsonb, 'form', '[]'::jsonb, 'lemma', '[]'::jsonb),
      'totals', jsonb_build_object('occurrence', 0, 'form', 0, 'lemma', 0, 'human', 0, 'ai', 0, 'total', 0),
      'lemmas', '[]'::jsonb
    );
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  v_remote_wfl := bible_internal.call_corpus_rpc_v1(
    'get_word_form_lemmas_batch_v1',
    jsonb_build_object('p_word_ids', jsonb_build_array(p_word_id))
  );

  IF v_remote_wfl IS NOT NULL AND jsonb_typeof(v_remote_wfl) = 'object' AND coalesce(v_remote_wfl->>'status', '') = 'ok' THEN
    SELECT array_agg(DISTINCT (elem->>'lemma_id')::bigint)
    INTO v_lemma_ids
    FROM jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', p_word_id::text, 'word_form_lemmas'], '[]'::jsonb)) elem
    WHERE elem->>'lemma_id' IS NOT NULL;
  END IF;

  IF v_lemma_ids IS NULL OR cardinality(v_lemma_ids) = 0 THEN
    SELECT array_agg(DISTINCT l.id)
    INTO v_lemma_ids
    FROM public.words w
    JOIN public.lemmas l ON l.base_strongs = w.strongs_nr
    WHERE w.id = p_word_id;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'lemma_id', l.id,
        'lemma_key', l.lemma_key
      ) ORDER BY l.id
    ),
    '[]'::jsonb
  ) INTO v_lemmas
  FROM public.lemmas l
  WHERE v_lemma_ids IS NOT NULL AND l.id = ANY(v_lemma_ids);

  WITH candidate_anchors AS (
    SELECT
      anc.note_id,
      'occurrence' AS scope
    FROM public.note_anchors anc
    WHERE anc.anchor_kind = 'word_occurrence'
      AND anc.word_id = p_word_id
      AND (p_verse_id IS NULL OR anc.verse_id = p_verse_id)
      AND (p_word_position IS NULL OR anc.word_position = p_word_position)

    UNION ALL

    SELECT
      anc.note_id,
      'form' AS scope
    FROM public.note_anchors anc
    WHERE anc.anchor_kind = 'word_form'
      AND anc.word_id = p_word_id

    UNION ALL

    SELECT
      anc.note_id,
      'lemma' AS scope
    FROM public.note_anchors anc
    WHERE anc.anchor_kind = 'lemma'
      AND v_lemma_ids IS NOT NULL
      AND anc.lemma_id = ANY(v_lemma_ids)
  ),
  scoped_notes AS (
    SELECT
      ca.note_id,
      array_agg(DISTINCT ca.scope) AS scopes,
      CASE
        WHEN 'occurrence' = ANY(array_agg(DISTINCT ca.scope)) THEN 'occurrence'
        WHEN 'form' = ANY(array_agg(DISTINCT ca.scope)) THEN 'form'
        ELSE 'lemma'
      END AS assigned_group
    FROM candidate_anchors ca
    GROUP BY ca.note_id
  ),
  classified_notes AS (
    SELECT
      n.id AS note_id,
      n.author_kind,
      sn.scopes,
      sn.assigned_group,
      n.created_at
    FROM scoped_notes sn
    JOIN public.notes n ON n.id = sn.note_id
    WHERE n.status = 'published'
      AND n.visibility = 'public'
  )
  SELECT
    (SELECT count(*)::int FROM classified_notes WHERE assigned_group = 'occurrence'),
    (SELECT count(*)::int FROM classified_notes WHERE assigned_group = 'form'),
    (SELECT count(*)::int FROM classified_notes WHERE assigned_group = 'lemma'),
    (SELECT count(*)::int FROM classified_notes WHERE author_kind = 'human'),
    (SELECT count(*)::int FROM classified_notes WHERE author_kind = 'ai'),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) ORDER BY sub.created_at DESC, sub.note_id DESC
      )
      FROM (
        SELECT cn.note_id, cn.scopes, cn.created_at
        FROM classified_notes cn
        WHERE cn.assigned_group = 'occurrence'
        ORDER BY cn.created_at DESC, cn.note_id DESC
        LIMIT v_limit
      ) sub
      JOIN public.notes n ON n.id = sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) ORDER BY sub.created_at DESC, sub.note_id DESC
      )
      FROM (
        SELECT cn.note_id, cn.scopes, cn.created_at
        FROM classified_notes cn
        WHERE cn.assigned_group = 'form'
        ORDER BY cn.created_at DESC, cn.note_id DESC
        LIMIT v_limit
      ) sub
      JOIN public.notes n ON n.id = sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) ORDER BY sub.created_at DESC, sub.note_id DESC
      )
      FROM (
        SELECT cn.note_id, cn.scopes, cn.created_at
        FROM classified_notes cn
        WHERE cn.assigned_group = 'lemma'
        ORDER BY cn.created_at DESC, cn.note_id DESC
        LIMIT v_limit
      ) sub
      JOIN public.notes n ON n.id = sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb)
  INTO
    v_occ_total,
    v_form_total,
    v_lemma_total,
    v_human_total,
    v_ai_total,
    v_occurrence_list,
    v_form_list,
    v_lemma_list;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'groups', jsonb_build_object(
      'occurrence', v_occurrence_list,
      'form', v_form_list,
      'lemma', v_lemma_list
    ),
    'totals', jsonb_build_object(
      'occurrence', v_occ_total,
      'form', v_form_total,
      'lemma', v_lemma_total,
      'human', v_human_total,
      'ai', v_ai_total,
      'total', v_occ_total + v_form_total + v_lemma_total
    ),
    'lemmas', v_lemmas
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_notes_for_word_v1"("p_word_id" integer, "p_verse_id" integer, "p_word_position" integer, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reader_overview_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $_$
DECLARE
  v_verse record;
  v_remote jsonb;
  v_place_anchors jsonb;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'invalid_request',
      'ranges', '{}'::jsonb,
      'grammar', '{}'::jsonb,
      'place_anchors', '[]'::jsonb,
      'previous', null,
      'next', null
    );
  END IF;

  SELECT id, word_ids INTO v_verse
  FROM public.verses
  WHERE book = p_book AND chapter = p_chapter AND verse_nr = p_verse;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'passage_not_found',
      'ranges', '{}'::jsonb,
      'grammar', '{}'::jsonb,
      'place_anchors', '[]'::jsonb,
      'previous', null,
      'next', null
    );
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_reader_overview_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'ranges', '{}'::jsonb,
      'grammar', '{}'::jsonb,
      'place_anchors', '[]'::jsonb,
      'previous', null,
      'next', null
    );
  END IF;

  WITH candidate_anchors AS (
    SELECT
      u.ord::integer AS word_position,
      p.place_key,
      p.biblical_name AS name,
      p.biblical_name,
      p.place_type,
      vg.relationship_type,
      vg.relationship_type AS role,
      vg.resolution_tier,
      vg.confidence_level AS confidence,
      pl.latitude AS lat,
      pl.longitude AS lon,
      coalesce(pl.rank_order, 999) AS loc_rank,
      CASE
        WHEN w.strongs_nr = ANY(p.strongs_numbers) THEN 1
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.strongs_numbers) sn
          WHERE upper(regexp_replace(sn, '^([HG])0*([0-9]+)[A-Za-z]*$', '\1\2')) = w.strongs_nr
        ) THEN 2
        WHEN cardinality(p.strongs_numbers) = 0
          AND w.grammar_code LIKE '%Np%'
          AND EXISTS (
            SELECT 1 FROM unnest(w.english_translations) et
            WHERE et ~* ('\m' || regexp_replace(regexp_replace(p.biblical_name, '\s+[0-9]+$', ''), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M')
          ) THEN 3
        WHEN cardinality(p.strongs_numbers) = 0
          AND w.grammar_code LIKE '%Np%'
          AND EXISTS (
            SELECT 1 FROM unnest(w.english_translations) et
            CROSS JOIN unnest(p.historical_names) hn
            WHERE length(hn) >= 3
              AND et ~* ('\m' || regexp_replace(hn, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M')
          ) THEN 4
        ELSE 99
      END AS match_tier
    FROM unnest(v_verse.word_ids) WITH ORDINALITY u(word_id, ord)
    JOIN public.words w ON w.id = u.word_id
    JOIN public.verse_geography vg ON vg.verse_id = v_verse.id AND vg.published = true
    JOIN public.places p ON p.id = vg.place_id AND p.published = true
    LEFT JOIN LATERAL (
      SELECT loc.latitude, loc.longitude, loc.rank_order
      FROM public.place_locations loc
      WHERE loc.place_id = p.id AND loc.published = true
      ORDER BY loc.is_alternative ASC, loc.rank_order ASC, loc.id ASC
      LIMIT 1
    ) pl ON true
  ),
  best_per_place AS (
    SELECT place_key, min(match_tier) AS best_tier
    FROM candidate_anchors
    WHERE match_tier < 99
    GROUP BY place_key
  ),
  anchor_rows AS (
    SELECT DISTINCT ON (ca.word_position, ca.place_key)
      ca.*
    FROM candidate_anchors ca
    JOIN best_per_place bp ON bp.place_key = ca.place_key AND ca.match_tier = bp.best_tier
    ORDER BY ca.word_position, ca.place_key, ca.match_tier ASC, ca.resolution_tier ASC, ca.loc_rank ASC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'word_position', ar.word_position,
    'place_key', ar.place_key,
    'name', ar.name,
    'biblical_name', ar.biblical_name,
    'place_type', ar.place_type,
    'relationship_type', ar.relationship_type,
    'role', ar.role,
    'resolution_tier', ar.resolution_tier,
    'confidence', ar.confidence,
    'lat', ar.lat,
    'lon', ar.lon
  ) ORDER BY ar.word_position ASC, ar.resolution_tier ASC, ar.loc_rank ASC, ar.name ASC, ar.place_key ASC), '[]'::jsonb)
  INTO v_place_anchors
  FROM anchor_rows ar;

  RETURN jsonb_set(v_remote, '{place_anchors}', coalesce(v_place_anchors, '[]'::jsonb));
END;
$_$;


ALTER FUNCTION "public"."get_reader_overview_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reader_passages_v1"("p_passages" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  IF p_passages IS NULL OR jsonb_typeof(p_passages) <> 'array'
     OR jsonb_array_length(p_passages) < 1 OR jsonb_array_length(p_passages) > 12 THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_reader_passages_v1',
    jsonb_build_object('p_passages', p_passages)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'passages', '[]'::jsonb
  );
END;
$$;


ALTER FUNCTION "public"."get_reader_passages_v1"("p_passages" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reader_timeline_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text" DEFAULT 'theographic-verse-v1'::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
 with active as materialized(select e.* from public.reader_text_event_links l join public.reader_text_events e using(event_key)
   where l.book=p_book and l.chapter=p_chapter and p_verse between l.start_verse and l.end_verse),
 context as materialized(select public.get_verse_chronology_v1(p_book,p_chapter,p_verse,p_model_id) packet),
 published as materialized(select distinct e.id,e.event_key,e.title,e.start_year,l.relationship from public.chronology_event_links l
  join public.chronology_events e on e.id=l.event_id and e.published
  join public.verses v on v.id=l.verse_id where v.book=p_book and v.chapter=p_chapter and v.verse_nr=p_verse)
 select jsonb_build_object('status','ok','model_id',p_model_id,'summary',(select packet->'summary' from context),
  'events',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('passages',(
   select jsonb_agg(jsonb_build_object('book',l.book,'chapter',l.chapter,'verse',case when l.start_verse=0 then 1 else l.start_verse end,
    'label',l.label) order by l.book,l.chapter) from public.reader_text_event_links l where l.event_key=a.event_key))) from active a),'[]'::jsonb),
  'published_events',coalesce((select jsonb_agg(to_jsonb(p)) from published p),'[]'::jsonb),
  'neighbors',coalesce((select jsonb_agg(to_jsonb(n)) from (
    select e.event_key,e.title,e.start_year from public.chronology_events e,context c
    where e.published and (c.packet->'summary'->>'earliest_year') is not null
    order by abs(e.start_year-(c.packet->'summary'->>'earliest_year')::integer),e.id limit 3)n),'[]'::jsonb));
$$;


ALTER FUNCTION "public"."get_reader_timeline_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reader_word_v1"("p_word_id" integer, "p_after" integer DEFAULT 0, "p_rendering" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
DECLARE
  v_word record;
  v_lexemes jsonb;
  v_remote jsonb;
BEGIN
  SELECT * INTO v_word FROM public.words WHERE id = p_word_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'word_not_found',
      'word', null,
      'lexemes', '[]'::jsonb,
      'token_total', 0,
      'verse_total', 0,
      'scope', 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
      'occurrences', '[]'::jsonb,
      'next_cursor', null
    );
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]'::jsonb)
  INTO v_lexemes
  FROM public.lexemes l
  WHERE l.base_strongs = v_word.strongs_nr;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_reader_word_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_word_id', p_word_id,
      'p_after', greatest(coalesce(p_after, 0), 0),
      'p_rendering', p_rendering
    ))
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'word', to_jsonb(v_word),
      'lexemes', v_lexemes,
      'token_total', 0,
      'verse_total', 0,
      'scope', 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
      'occurrences', '[]'::jsonb,
      'next_cursor', null
    );
  END IF;

  RETURN v_remote || jsonb_build_object(
    'word', to_jsonb(v_word),
    'lexemes', v_lexemes
  );
END;
$$;


ALTER FUNCTION "public"."get_reader_word_v1"("p_word_id" integer, "p_after" integer, "p_rendering" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_shopify_customer_id"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'shopify_customer_id', '')::text;
$$;


ALTER FUNCTION "public"."get_shopify_customer_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_static_corpus_manifest_meta_v1"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ SELECT bible_internal.require_corpus_rpc_v1('get_static_corpus_metadata_v1','{}'::jsonb)-'status' $$;


ALTER FUNCTION "public"."get_static_corpus_manifest_meta_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_verse_chronology_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text" DEFAULT 'theographic-verse-v1'::"text", "p_run_id" "text" DEFAULT NULL::"text", "p_evidence_cursor" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '15s'
    AS $_$
declare
 vid integer; rid bigint; model public.chronology_models; run public.chronology_runs;
 base jsonb; assertions jsonb; evidence jsonb; alternatives jsonb; history jsonb; response jsonb;
 aid bigint:=0; eid bigint:=0; parts text[]; total_assertions integer; evidence_count integer;
 lo integer; hi integer; axis text; assignment_status text; has_archaeology boolean;
begin
 select jsonb_build_object('schema_version',1,'models',coalesce(jsonb_agg(jsonb_build_object(
   'id',m.id,'name',m.name,'assumptions',m.assumptions,'adam_year',m.adam_year,'resurrection_year',m.resurrection_year,
   'run_id',r.id::text,'coverage',r.coverage) order by case when m.id='theographic-verse-v1' then 0 else 1 end,m.id),'[]'::jsonb))
 into base from public.chronology_models m join public.chronology_active_runs ar on ar.model_id=m.id
 join public.chronology_runs r on r.id=ar.run_id where m.published and r.published;
 if p_book is null or p_chapter is null or p_verse is null or p_book not between 1 and 66
   or p_chapter not between 1 and 150 or p_verse not between 0 and 176 then
   return base||jsonb_build_object('status','invalid_reference');
 end if;
 select id into vid from public.verses where book=p_book and chapter=p_chapter and verse_nr=p_verse;
 if vid is null then return base||jsonb_build_object('status','passage_not_found'); end if;
 select * into model from public.chronology_models where id=p_model_id and published;
 if model.id is null then return base||jsonb_build_object('status','invalid_model'); end if;
 if p_run_id is not null and (p_run_id !~ '^[1-9][0-9]{0,17}$') then
   return base||jsonb_build_object('status','invalid_run');
 end if;
 select r.* into run from public.chronology_runs r where r.model_id=model.id and r.published
   and r.id=coalesce(p_run_id::bigint,(select ar.run_id from public.chronology_active_runs ar where ar.model_id=model.id));
 if run.id is null then return base||jsonb_build_object('status','release_unavailable'); end if;
 rid:=run.id;
 if p_evidence_cursor is not null then
   if p_run_id is null or p_evidence_cursor !~ '^[1-9][0-9]{0,17}:[0-9]{1,18}:[0-9]{1,18}$' then
     return base||jsonb_build_object('status','invalid_cursor');
   end if;
   parts:=string_to_array(p_evidence_cursor,':');
   if parts[1]<>rid::text then return base||jsonb_build_object('status','invalid_cursor'); end if;
   aid:=parts[2]::bigint; eid:=parts[3]::bigint;
 end if;
 select status into assignment_status from public.chronology_assignments where run_id=rid and verse_id=vid;
 select count(*) into total_assertions from public.chronology_assignment_assertions where run_id=rid and verse_id=vid;
 select coalesce(jsonb_agg(doc order by rank,id),'[]'::jsonb) into assertions from (
   select a.id,case a.axis when 'setting' then 0 when 'source_placement' then 1 when 'composition' then 2 else 3 end rank,
   jsonb_build_object('id',a.id::text,'model_id',a.model_id,'axis',a.axis,
     'earliest_year',a.earliest_year,'latest_year',a.latest_year,'preferred_year',a.preferred_year,
     'date_label',case when a.earliest_year=a.latest_year then 'around '||public.chronology_year_label(a.earliest_year)
       else public.chronology_year_label(a.earliest_year)||' to '||public.chronology_year_label(a.latest_year) end,
     'precision',a.precision,'method',a.method,'rationale',a.rationale,'author',a.author,'review_status',a.review_status,
     'mapping',a.mapping,'source',jsonb_build_object('dataset',s.dataset,'version',s.version,'locator',s.locator,'license',s.license,'attribution',s.attribution),
     'supersedes',a.supersedes::text,'event_title',e.title,'original_date',e.original_date,'duration',e.duration) doc
   from public.chronology_assignment_assertions aa join public.chronology_assertions a on a.id=aa.assertion_id
   join public.chronology_sources s on s.id=a.source_id left join public.chronology_events e on e.id=a.event_id
   where aa.run_id=rid and aa.verse_id=vid order by rank,a.id limit 20
 ) picked;
 if p_evidence_cursor is not null and not exists(
   select 1 from public.chronology_assertion_evidence ae
   where ae.assertion_id=aid and ae.evidence_id=eid
   and ae.assertion_id in (select (value->>'id')::bigint from jsonb_array_elements(assertions))) then
   return base||jsonb_build_object('status','invalid_cursor');
 end if;
 select coalesce(jsonb_agg(doc order by assertion_id,evidence_id),'[]'::jsonb) into evidence from (
   select ae.assertion_id,ae.evidence_id,jsonb_build_object('assertion_id',ae.assertion_id::text,'id',e.id::text,
     'category',e.category,'title',e.title,'citation',e.citation,'locator',e.locator,'summary',e.summary,
     'dating_method',e.dating_method,'scope',e.scope,'uncertainty',e.uncertainty,'review_status',e.review_status,
     'object_year',e.object_year,'object_date_label',public.chronology_year_label(e.object_year),
     'event_year',e.event_year,'event_date_label',public.chronology_year_label(e.event_year),
     'relationship',ae.relationship,'applicability',ae.applicability,'explanation',ae.explanation) doc
   from public.chronology_assertion_evidence ae join public.chronology_evidence e on e.id=ae.evidence_id
   where ae.assertion_id in (select (value->>'id')::bigint from jsonb_array_elements(assertions))
     and (ae.assertion_id,ae.evidence_id)>(aid,eid) order by ae.assertion_id,ae.evidence_id limit 21
 ) page;
 evidence_count:=jsonb_array_length(evidence);
 if evidence_count>20 then evidence:=evidence-20; end if;
 select exists(select 1 from public.chronology_assertion_evidence ae join public.chronology_evidence e on e.id=ae.evidence_id
   where e.category='archaeological' and ae.assertion_id in (select (value->>'id')::bigint from jsonb_array_elements(assertions))) into has_archaeology;
 select a->>'axis' into axis from jsonb_array_elements(assertions) a where a->>'axis'<>'mentioned_event' limit 1;
 select min((a->>'earliest_year')::integer),max((a->>'latest_year')::integer) into lo,hi
   from jsonb_array_elements(assertions) a where a->>'axis'=axis;
 select coalesce(jsonb_agg(doc order by model_name,id),'[]'::jsonb) into alternatives from (
   select m.name model_name,a.id,jsonb_build_object('id',a.id::text,'model_id',m.id,'model_name',m.name,'run_id',ar.run_id::text,
     'axis',a.axis,'date_label',case when a.earliest_year=a.latest_year then 'around '||public.chronology_year_label(a.earliest_year)
       else public.chronology_year_label(a.earliest_year)||' to '||public.chronology_year_label(a.latest_year) end,
     'earliest_year',a.earliest_year,'latest_year',a.latest_year,'event_title',e.title,'review_status',a.review_status) doc
   from public.chronology_models m join public.chronology_active_runs ar on ar.model_id=m.id
   cross join lateral (select a.* from public.chronology_assignment_assertions aa
     join public.chronology_assertions a on a.id=aa.assertion_id where aa.run_id=ar.run_id and aa.verse_id=vid order by a.id limit 3) a
   left join public.chronology_events e on e.id=a.event_id
   where m.id<>model.id order by m.name,a.id limit 12
 ) other_models;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id::text,'label',r.label,'created_at',r.created_at) order by r.id desc),'[]'::jsonb)
 into history from (select id,label,created_at from public.chronology_runs where model_id=model.id and published order by id desc limit 5) r;
 response:=base||jsonb_build_object('status','ok','passage',jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse,'is_heading',p_verse=0),
   'model',jsonb_build_object('id',model.id,'name',model.name,'assumptions',model.assumptions,'adam_year',model.adam_year,'resurrection_year',model.resurrection_year),
   'run',jsonb_build_object('id',rid::text,'label',run.label,'created_at',run.created_at,'coverage',run.coverage),
   'assignment_status',coalesce(assignment_status,'unresolved'),'assertions',assertions,'assertion_count',total_assertions,
   'assertions_truncated',total_assertions>20,'evidence',evidence,'evidence_truncated',evidence_count>20,
   'next_evidence_cursor',case when evidence_count>20 then rid::text||':'||(evidence->19->>'assertion_id')||':'||(evidence->19->>'id') else null end,
   'has_archaeological_evidence',has_archaeology,'alternatives',alternatives,'history',history,
   'summary',jsonb_build_object('axis',axis,'earliest_year',lo,'latest_year',hi,
     'label',case when lo is null then 'No setting date established' when lo=hi then 'around '||public.chronology_year_label(lo)
       else public.chronology_year_label(lo)||' to '||public.chronology_year_label(hi) end,
     'millennium_first',case when lo is not null and model.adam_year is not null then floor((lo::numeric-model.adam_year)/1000)::integer+1 end,
     'millennium_last',case when hi is not null and model.adam_year is not null then floor((hi::numeric-model.adam_year)/1000)::integer+1 end));
 if octet_length(response::text)>51200 then return base||jsonb_build_object('status','packet_limit_exceeded'); end if;
 return response;
end $_$;


ALTER FUNCTION "public"."get_verse_chronology_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text", "p_run_id" "text", "p_evidence_cursor" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_verse_geography"("p_book" integer, "p_chapter" integer, "p_verse" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '5s'
    AS $$
declare
  vid integer;
  v_millennium smallint;
  lo_year integer;
  hi_year integer;
  era_key text;
  era_label text;
  date_label text;
  chron_json jsonb;
  gazetteer_json jsonb;
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

  select v.id, v.millennium into vid, v_millennium
  from public.verses v
  where v.book = p_book::smallint and v.chapter = p_chapter::smallint and v.verse_nr = p_verse::smallint;

  if vid is null then
    return jsonb_build_object('schema_version', 1, 'status', 'passage_not_found');
  end if;

  -- 1. Resolve chronological time of the verse from chronology_assertions or scholarly book range
  select
    min(a.earliest_year),
    max(a.latest_year)
  into lo_year, hi_year
  from public.chronology_assignment_assertions aa
  join public.chronology_assertions a on a.id = aa.assertion_id
  join public.chronology_active_runs ar on ar.run_id = aa.run_id
  where aa.verse_id = vid
    and a.axis <> 'mentioned_event'
    and a.earliest_year is not null;

  if lo_year is null then
    if p_book = 1 then lo_year := -2000; hi_year := -1800;
    elsif p_book in (2, 3, 4, 5, 6, 7, 18) then lo_year := -1445; hi_year := -1050;
    elsif p_book in (8, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34, 35, 36) then lo_year := -1010; hi_year := -586;
    elsif p_book = 26 then lo_year := -592; hi_year := -570;
    elsif p_book = 27 and p_chapter = 8 then lo_year := -550; hi_year := -550;
    elsif p_book = 27 then lo_year := -604; hi_year := -535;
    elsif p_book = 17 then lo_year := -482; hi_year := -472;
    elsif p_book in (15, 16, 37, 38, 39) then lo_year := -538; hi_year := -430;
    elsif p_book in (40, 41, 42, 43) then lo_year := -4; hi_year := 33;
    elsif p_book = 44 then lo_year := 30; hi_year := 62;
    elsif p_book in (52, 53) then lo_year := 50; hi_year := 51;
    elsif p_book in (45, 46, 47, 48) then lo_year := 53; hi_year := 57;
    elsif p_book in (49, 50, 51, 57) then lo_year := 60; hi_year := 62;
    elsif p_book in (54, 55, 56, 58, 59, 60, 61, 65) then lo_year := 48; hi_year := 67;
    else lo_year := 85; hi_year := 96;
    end if;
  end if;

  if p_book >= 40 or hi_year >= -10 then
    era_key := 'roman_new_testament';
    era_label := 'Early Roman Empire & Apostolic Age (1st Century AD)';
  elsif p_book in (15, 16, 17, 26, 27, 37, 38, 39) or (hi_year between -586 and -332) then
    era_key := 'exile_persian';
    era_label := 'Babylonian Exile & Achaemenid Persian Period (6th–5th Century BC)';
  elsif p_book = 1 or (hi_year <= -1550) then
    era_key := 'primeval_patriarchal';
    era_label := 'Primeval & Patriarchal Period (Middle Bronze Age)';
  elsif p_book in (2, 3, 4, 5, 6, 7) or (hi_year between -1549 and -1040) then
    era_key := 'exodus_conquest_judges';
    era_label := 'Exodus, Wilderness, Conquest & Judges (Late Bronze / Iron Age I)';
  else
    era_key := 'monarchy_divided_kingdom';
    era_label := 'United & Divided Monarchy (Iron Age II — Israel, Judah & Near East)';
  end if;

  date_label := case
    when lo_year is null then 'Date range not established'
    when lo_year = hi_year then 'around ' || public.chronology_year_label(lo_year)
    else public.chronology_year_label(lo_year) || ' to ' || public.chronology_year_label(hi_year)
  end;

  chron_json := jsonb_build_object(
    'era_key', era_key,
    'era_label', era_label,
    'date_label', date_label,
    'earliest_year', lo_year,
    'latest_year', hi_year
  );

  -- 2. Resolve active passages (including narrative settings, audience_location, and composition_location)
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
    limit 8
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
      not exists (select 1 from direct_links dl where dl.place_id = ap.place_id) as is_inferred,
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
          and dl.relationship_type in (
            'event_location',
            'contextual_location',
            'audience_location',
            'composition_location',
            'travel_origin',
            'travel_destination'
          )
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
        when 'audience_location' then 5
        when 'composition_location' then 6
        when 'uncertain_location' then 7
        else 8
      end asc,
      cc.source_priority asc,
      cc.resolution_tier asc
  ),
  hydrated_places as materialized (
    select
      dp.place_id,
      p.place_key,
      p.biblical_name,
      coalesce(
        p.period_names->>era_key,
        case
          when era_key = 'roman_new_testament' and p.greek_name is not null then p.biblical_name || ' (' || p.greek_name || ')'
          when p.hebrew_name is not null then p.biblical_name || ' (' || p.hebrew_name || ')'
          when p.greek_name is not null then p.biblical_name || ' (' || p.greek_name || ')'
          else p.biblical_name
        end
      ) as ancient_name,
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
        when 'audience_location' then 5
        when 'composition_location' then 6
        when 'uncertain_location' then 7
        else 8
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
        'ancient_name', hp.ancient_name,
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

  -- 3. Build Era Gazetteer (contemporaneous ancient biblical places for the map background)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'place_key', g.place_key,
      'biblical_name', g.biblical_name,
      'ancient_name', g.ancient_name,
      'modern_name', g.modern_name,
      'place_type', g.place_type,
      'latitude', g.latitude,
      'longitude', g.longitude
    ) order by g.biblical_name asc
  ), '[]'::jsonb)
  into gazetteer_json
  from (
    select
      p.place_key,
      p.biblical_name,
      coalesce(p.period_names->>era_key, p.biblical_name) as ancient_name,
      pl.modern_name,
      p.place_type,
      pl.latitude,
      pl.longitude
    from public.places p
    join lateral (
      select loc.modern_name, loc.latitude, loc.longitude
      from public.place_locations loc
      where loc.place_id = p.id and loc.published and loc.latitude is not null and loc.longitude is not null
      order by loc.rank_order asc, loc.id asc
      limit 1
    ) pl on true
    where p.published
      and not p.is_non_physical
      and era_key = any(p.active_eras)
    limit 24
  ) g;

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
    'chronological_context', chron_json,
    'resolution_status', res_status,
    'has_physical_location', coalesce(has_physical, false),
    'message', case
      when coalesce(has_physical, false) then null
      when coalesce(has_non_physical, false) then 'No reliable geographical location identified for this verse (symbolic or heavenly setting).'
      else 'No reliable geographical location identified for this verse.'
    end,
    'bounds', bounds_json,
    'locations', coalesce(locations_json, '[]'::jsonb),
    'era_gazetteer', coalesce(gazetteer_json, '[]'::jsonb),
    'passage_contexts', coalesce(passages_json, '[]'::jsonb),
    'sources', coalesce(sources_json, '[]'::jsonb)
  );

  if octet_length(response::text) > 51200 then
    return jsonb_build_object('schema_version', 1, 'status', 'packet_limit_exceeded');
  end if;

  return response;
end
$$;


ALTER FUNCTION "public"."get_verse_geography"("p_book" integer, "p_chapter" integer, "p_verse" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_verse_research_v1"("p_request" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '60s'
    AS $_$
DECLARE
  refs jsonb; item jsonb; mode text; sample_limit integer := 20;
  model_id text; packet jsonb; byte_size integer;
  profile_preset text; max_passages integer := 5;
  total_expanded integer;
  v_verse_ids integer[];
  v_remote_vts jsonb;
  invalid constant jsonb := '{"schema_version":1,"status":"invalid_request","message":"Provide 1-5 passages (or up to 100 in analysis profile / sample mode); occurrences.mode is all or sample (limit 1-100); use a published chronology model."}';
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN RETURN invalid; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('passages','occurrences','chronology_model_id','profile')) THEN RETURN invalid; END IF;

  refs := p_request->'passages';
  IF refs IS NULL OR jsonb_typeof(refs) <> 'array' OR jsonb_array_length(refs) = 0 THEN RETURN invalid; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(refs)) <> jsonb_array_length(refs) THEN RETURN invalid; END IF;

  profile_preset := coalesce(p_request->>'profile', 'full');
  IF profile_preset NOT IN ('analysis', 'full') THEN RETURN invalid; END IF;

  mode := coalesce(p_request #>> '{occurrences,mode}', CASE WHEN profile_preset = 'analysis' THEN 'sample' ELSE 'all' END);
  IF profile_preset = 'analysis' AND NOT (p_request ? 'occurrences') THEN
    sample_limit := 5;
  END IF;

  IF p_request ? 'occurrences' THEN
    item := p_request->'occurrences';
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('mode','limit')) THEN RETURN invalid; END IF;
    IF item ? 'mode' AND jsonb_typeof(item->'mode') <> 'string' THEN RETURN invalid; END IF;
    IF item ? 'limit' THEN
      IF jsonb_typeof(item->'limit') <> 'number' OR item->>'limit' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      sample_limit := (item->>'limit')::int;
      IF sample_limit NOT BETWEEN 1 AND 100 OR mode <> 'sample' THEN RETURN invalid; END IF;
    END IF;
  END IF;
  IF mode NOT IN ('all','sample') THEN RETURN invalid; END IF;

  IF profile_preset = 'analysis' OR mode = 'sample' THEN
    max_passages := 100;
  ELSE
    max_passages := 5;
  END IF;

  IF p_request ? 'chronology_model_id' AND jsonb_typeof(p_request->'chronology_model_id') <> 'string' THEN RETURN invalid; END IF;
  model_id := coalesce(p_request->>'chronology_model_id', 'theographic-verse-v1');
  IF NOT EXISTS(SELECT 1 FROM public.chronology_models WHERE id = model_id AND published) THEN RETURN invalid; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(refs) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF NOT (
      (item ? 'book' AND item ? 'chapter' AND item ? 'verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','verse')))
      OR
      (item ? 'book' AND item ? 'chapter' AND item ? 'start_verse' AND item ? 'end_verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','start_verse','end_verse')))
    ) THEN RETURN invalid; END IF;

    IF jsonb_typeof(item->'book') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'chapter') IS DISTINCT FROM 'number' THEN RETURN invalid; END IF;
    IF item->>'book' !~ '^[0-9]{1,2}$' OR item->>'chapter' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
    IF (item->>'book')::int NOT BETWEEN 1 AND 66 OR (item->>'chapter')::int NOT BETWEEN 1 AND 150 THEN RETURN invalid; END IF;

    IF item ? 'verse' THEN
      IF jsonb_typeof(item->'verse') IS DISTINCT FROM 'number' OR item->>'verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
    ELSE
      IF jsonb_typeof(item->'start_verse') IS DISTINCT FROM 'number' OR item->>'start_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF jsonb_typeof(item->'end_verse') IS DISTINCT FROM 'number' OR item->>'end_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int NOT BETWEEN 0 AND 176 OR (item->>'end_verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int > (item->>'end_verse')::int THEN RETURN invalid; END IF;
    END IF;
  END LOOP;

  SELECT count(DISTINCT (r.item->>'book')::int || ':' || (r.item->>'chapter')::int || ':' || g.v)
  INTO total_expanded
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g;

  IF total_expanded NOT BETWEEN 1 AND max_passages THEN RETURN invalid; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT
        (r.item->>'book')::int AS book,
        (r.item->>'chapter')::int AS chapter,
        g.v AS verse
      FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
      CROSS JOIN LATERAL (
        SELECT generate_series(
          coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
          coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
        ) AS v
      ) g
    ) req
    WHERE NOT EXISTS (
      SELECT 1 FROM public.verses v
      WHERE v.book = req.book AND v.chapter = req.chapter AND v.verse_nr = req.verse
    )
  ) THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'passage_not_found', 'requested_passages', refs);
  END IF;

  SELECT array_agg(DISTINCT v.id ORDER BY v.id)
  INTO v_verse_ids
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g
  JOIN public.verses v ON v.book = (r.item->>'book')::int AND v.chapter = (r.item->>'chapter')::int AND v.verse_nr = g.v;

  v_remote_vts := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', to_jsonb(v_verse_ids))
  );

  IF v_remote_vts IS NULL OR jsonb_typeof(v_remote_vts) <> 'object' OR coalesce(v_remote_vts->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading verse translation sources'
    );
  END IF;

  WITH req_passages AS MATERIALIZED (
    SELECT
      row_number() OVER (ORDER BY min(r.ord), (r.item->>'book')::int, (r.item->>'chapter')::int, g.v)::int AS ord,
      (r.item->>'book')::int AS book,
      (r.item->>'chapter')::int AS chapter,
      g.v AS verse
    FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
    CROSS JOIN LATERAL (
      SELECT generate_series(
        coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
        coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
      ) AS v
    ) g
    GROUP BY (r.item->>'book')::int, (r.item->>'chapter')::int, g.v
  ), passages AS MATERIALIZED (
    SELECT v.*, r.ord, (v.book || ':' || v.chapter || ':' || v.verse_nr) AS verse_ref
    FROM req_passages r
    JOIN public.verses v ON v.book = r.book AND v.chapter = r.chapter AND v.verse_nr = r.verse
  ), remote_vts_rows AS MATERIALIZED (
    SELECT
      p.id AS verse_id,
      (elem->>'word_position')::integer AS word_position,
      (elem->>'word_id')::integer AS word_id,
      elem->>'source_english' AS source_english,
      elem->>'source_ref' AS source_ref,
      elem->>'source_name' AS source_name,
      elem->>'source_commit' AS source_commit
    FROM passages p
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_remote_vts #> ARRAY['verses', p.id::text], '[]'::jsonb)) elem
  ), tokens AS MATERIALIZED (
    SELECT v.id verse_id, v.verse_ref, u.ord::integer word_position, w.*,
      s.source_english, s.source_ref, s.source_name, s.source_commit
    FROM passages v
    CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id, ord)
    JOIN public.words w ON w.id = u.word_id
    LEFT JOIN remote_vts_rows s ON s.verse_id = v.id AND s.word_position = u.ord AND s.word_id = w.id
  ), targets AS MATERIALIZED (
    SELECT DISTINCT strongs_nr FROM tokens
  ), target_forms AS MATERIALIZED (
    SELECT w.id, w.strongs_nr FROM public.words w JOIN targets t USING(strongs_nr)
  ), occurrence_counts AS MATERIALIZED (
    SELECT f.strongs_nr, v.book, v.chapter, v.verse_nr, count(*)::integer occurrence_count
    FROM public.verses v
    CROSS JOIN LATERAL unnest(v.word_ids) u(word_id)
    JOIN target_forms f ON f.id = u.word_id
    GROUP BY f.strongs_nr, v.book, v.chapter, v.verse_nr
  ), ranked_occurrences AS (
    SELECT a.*, row_number() OVER(PARTITION BY a.strongs_nr ORDER BY a.book, a.chapter, a.verse_nr) rn
    FROM occurrence_counts a
  ), occurrence_packets AS MATERIALIZED (
    SELECT strongs_nr, jsonb_build_object(
      'counting_method', 'Sum of matching tokens per passage across base-Strongs inflections',
      'corpus_token_total', sum(occurrence_count),
      'distinct_passage_total', count(*),
      'returned_reference_count', count(*) FILTER(WHERE mode = 'all' OR rn <= sample_limit),
      'complete', mode = 'all' OR count(*) <= sample_limit,
      'references', coalesce(jsonb_agg(jsonb_build_object(
        'book', q.book, 'chapter', q.chapter, 'verse', q.verse_nr, 'occurrence_count', q.occurrence_count
      ) ORDER BY q.book, q.chapter, q.verse_nr) FILTER(WHERE mode = 'all' OR rn <= sample_limit), '[]'::jsonb)
    ) doc
    FROM ranked_occurrences q GROUP BY strongs_nr
  ), lexemes AS MATERIALIZED (
    SELECT t.strongs_nr, coalesce(jsonb_agg(to_jsonb(l)-'id' ORDER BY l.lexeme_key)
      FILTER(WHERE l.id IS NOT NULL), '[]'::jsonb) candidates
    FROM targets t LEFT JOIN public.lexemes l ON l.base_strongs = t.strongs_nr GROUP BY t.strongs_nr
  ), lexical AS MATERIALIZED (
    SELECT t.strongs_nr, jsonb_build_object(
      'identity_scope', 'base_strongs',
      'strongs_nr', t.strongs_nr,
      'lexeme_candidates', l.candidates,
      'needs_disambiguation', jsonb_array_length(l.candidates) > 1,
      'sense_status', 'not_assigned_to_token',
      'semantic_annotation_status', CASE WHEN jsonb_array_length(l.candidates) = 0 THEN 'unavailable' ELSE 'candidate_lexemes_only' END,
      'occurrences', o.doc,
      'top_connected_words', c.doc,
      'connection_coverage', jsonb_build_object(
        'requested', 7, 'returned', jsonb_array_length(c.doc),
        'status', CASE WHEN jsonb_array_length(c.doc) = 0 THEN 'no_cached_connections' ELSE 'cached' END,
        'method', 'Cached within-verse base-Strongs token-pair associations; scores are not semantic equivalence.'
      ),
      'limitations', 'Base Strong''s groups inflections and may combine homographs. Multi-valence and paronomasia are preserved across contexts.'
    ) doc
    FROM targets t
    JOIN lexemes l USING(strongs_nr)
    JOIN occurrence_packets o USING(strongs_nr)
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.rank), '[]'::jsonb) doc FROM (
        SELECT row_number() OVER(ORDER BY a.score DESC, a.word_id) rank, a.*,
          w.english_translations, w.biblical_def, w.physical_def, 'stepbible-2026-11'::text source_release_key
        FROM public.prompt_word_cooccurrences(t.strongs_nr) a
        JOIN public.words w ON w.id = a.word_id
        ORDER BY a.score DESC, a.word_id LIMIT 7
      ) q
    ) c
  ), semantic_paths AS MATERIALIZED (
    SELECT a.id, a.subject_node_id, a.object_node_id,
      to_jsonb(a)-'id'-'subject_node_id'-'object_node_id' || jsonb_build_object(
        'subject', sn.display_label, 'object', ob.display_label,
        'evidence_spans', coalesce((
          SELECT jsonb_agg(to_jsonb(e)-'id'-'assertion_id' ORDER BY e.step_order, e.id)
          FROM public.assertion_evidence e WHERE e.assertion_id = a.id
        ), '[]'::jsonb)
      ) doc
    FROM public.assertions a
    JOIN public.research_nodes sn ON sn.id = a.subject_node_id
    JOIN public.research_nodes ob ON ob.id = a.object_node_id
    WHERE a.review_status = 'reviewed'
  ), verse_packets AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, jsonb_build_object(
      'verse_id', v.id,
      'verse_ref', v.verse_ref,
      'passage', jsonb_build_object(
        'book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0
      ),
      'words', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'word_position', t.word_position, 'word_id', t.id, 'original_word', t.original_word,
          'transliteration', t.transliteration, 'strongs_nr', t.strongs_nr, 'lexical_entry_key', t.strongs_nr,
          'grammar', jsonb_build_object(
            'raw_code', t.grammar_code,
            'scheme', CASE WHEN t.source_name LIKE 'TAHOT%' THEN 'STEP TEHMC (ETCBC/OpenScriptures adapted)'
              WHEN t.source_name LIKE 'TAGNT%' THEN 'STEP TEGMC (Tauber adapted)' ELSE NULL END,
            'decoded_grammar', public.decode_grammar_v1(t.grammar_code),
            'decoded_features', public.decode_grammar_v1(t.grammar_code),
            'unresolved_tags', CASE WHEN t.grammar_code IS NULL OR public.decode_grammar_v1(t.grammar_code) = '{}'::jsonb
              THEN CASE WHEN t.grammar_code IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(t.grammar_code) END
              ELSE '[]'::jsonb END
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
          'lexeme_candidates', (SELECT candidates FROM lexemes l WHERE l.strongs_nr = t.strongs_nr)
        ) ORDER BY t.word_position)
        FROM tokens t WHERE t.verse_id = v.id
      ), '[]'::jsonb),
      'coverage', jsonb_build_object(
        'semantic_scope', 'Reviewed passage matches and lexically related concept candidates; not token-sense assignments',
        'grammar_decoding', 'Server-side structured decoding active via decode_grammar_v1',
        'semantic_domains', 'candidate_lexemes_only',
        'token_senses', 'unavailable'
      )
    ) doc FROM passages v
  ), top_chronology AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_chronology_v1(v.book, v.chapter, v.verse_nr, model_id) doc
    FROM passages v
  ), top_geography AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_geography(v.book, v.chapter, v.verse_nr) doc
    FROM passages v
  ), top_semantics AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, coalesce((
      SELECT jsonb_agg(sp.doc ORDER BY sp.id)
      FROM semantic_paths sp
      WHERE EXISTS(
        SELECT 1 FROM public.assertion_evidence e
        WHERE e.assertion_id = sp.id AND e.book = v.book
          AND (v.chapter, v.verse_nr) >= (e.start_chapter, e.start_verse)
          AND (v.chapter, v.verse_nr) <= (e.end_chapter, e.end_verse)
      ) OR EXISTS(
        SELECT 1 FROM public.research_nodes n
        JOIN public.concepts c ON c.id = n.concept_id
        WHERE n.id IN (sp.subject_node_id, sp.object_node_id)
          AND c.primary_strongs && array(SELECT t.strongs_nr::text FROM tokens t WHERE t.verse_id = v.id)
      )
    ), '[]'::jsonb) doc
    FROM passages v
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'verses', (SELECT jsonb_agg(doc ORDER BY ord) FROM verse_packets),
    'chronology', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_chronology),
    'geography', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_geography),
    'semantic_evidence', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_semantics),
    'lexical_entries', (SELECT jsonb_object_agg(strongs_nr, doc ORDER BY strongs_nr) FROM lexical),
    'sources', coalesce((SELECT jsonb_agg(to_jsonb(s)-'id'-'created_at' ORDER BY s.release_key)
      FROM public.source_releases s WHERE s.release_key IN ('stepbible-2026-11','curated-motifs-v1')), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'corpus', 'primary STEP Hebrew/Aramaic OT and NA28-membership Greek NT',
      'requested_passage_count', jsonb_array_length(refs),
      'returned_passage_count', (SELECT count(*) FROM passages),
      'lexical_entry_count', (SELECT count(*) FROM targets),
      'occurrence_mode', mode,
      'occurrences_complete', (SELECT bool_and((doc #>> '{occurrences,complete}')::boolean) FROM lexical),
      'chronology_evidence_complete', (SELECT bool_and(coalesce((doc #>> '{status}') = 'ok', false)
        AND NOT coalesce((doc #>> '{evidence_truncated}')::boolean, true)
        AND NOT coalesce((doc #>> '{assertions_truncated}')::boolean, true)) FROM top_chronology),
      'component_statuses', (SELECT jsonb_agg(jsonb_build_object(
        'verse_ref', v.verse_ref,
        'passage', jsonb_build_object('book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0),
        'chronology', c.doc #>> '{status}',
        'geography', g.doc #>> '{status}'
      ) ORDER BY v.ord) FROM passages v JOIN top_chronology c USING(verse_ref) JOIN top_geography g USING(verse_ref)),
      'max_passages', max_passages,
      'max_packet_bytes', 8388608,
      'semantic_coverage', 'Limited reviewed annotations; empty results do not establish absence of a relationship',
      'polysemy_homographs_preserved', true,
      'payload_deduplication', 'Hoisted top-level chronology, geography, and semantic_evidence dictionaries keyed by verse reference',
      'private_translation_choices_included', false
    )
  ) INTO packet;

  byte_size := octet_length(packet::text);
  IF byte_size > 8388608 THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'packet_limit_exceeded',
      'requested_passages', refs,
      'measured_bytes', byte_size,
      'max_packet_bytes', 8388608,
      'message', 'Request fewer passages or explicitly select occurrences.mode=sample. No partial packet was returned.'
    );
  END IF;

  RETURN packet;
END;
$_$;


ALTER FUNCTION "public"."get_verse_research_v1"("p_request" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_verse_research_v2"("p_request" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '60s'
    AS $_$
DECLARE
  refs jsonb; item jsonb; mode text; sample_limit integer := 20;
  model_id text; packet jsonb; byte_size integer;
  profile_preset text; max_passages integer := 5;
  total_expanded integer;
  v_verse_ids integer[];
  v_word_ids integer[];
  v_remote_vts jsonb;
  v_remote_wfl jsonb;
  invalid constant jsonb := '{"schema_version":2,"status":"invalid_request","message":"Provide 1-5 passages (or up to 100 in analysis profile / sample mode); occurrences.mode is all or sample (limit 1-100); use a published chronology model."}';
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN RETURN invalid; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('passages','occurrences','chronology_model_id','profile','include_formation')) THEN RETURN invalid; END IF;

  refs := p_request->'passages';
  IF refs IS NULL OR jsonb_typeof(refs) <> 'array' OR jsonb_array_length(refs) = 0 THEN RETURN invalid; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(refs)) <> jsonb_array_length(refs) THEN RETURN invalid; END IF;

  profile_preset := coalesce(p_request->>'profile', 'full');
  IF profile_preset NOT IN ('analysis', 'full') THEN RETURN invalid; END IF;

  mode := coalesce(p_request #>> '{occurrences,mode}', CASE WHEN profile_preset = 'analysis' THEN 'sample' ELSE 'all' END);
  IF profile_preset = 'analysis' AND NOT (p_request ? 'occurrences') THEN
    sample_limit := 5;
  END IF;

  IF p_request ? 'occurrences' THEN
    item := p_request->'occurrences';
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('mode','limit')) THEN RETURN invalid; END IF;
    IF item ? 'mode' AND jsonb_typeof(item->'mode') <> 'string' THEN RETURN invalid; END IF;
    IF item ? 'limit' THEN
      IF jsonb_typeof(item->'limit') <> 'number' OR item->>'limit' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      sample_limit := (item->>'limit')::int;
      IF sample_limit NOT BETWEEN 1 AND 100 OR mode <> 'sample' THEN RETURN invalid; END IF;
    END IF;
  END IF;
  IF mode NOT IN ('all','sample') THEN RETURN invalid; END IF;

  IF profile_preset = 'analysis' OR mode = 'sample' THEN
    max_passages := 100;
  ELSE
    max_passages := 5;
  END IF;

  IF p_request ? 'chronology_model_id' AND jsonb_typeof(p_request->'chronology_model_id') <> 'string' THEN RETURN invalid; END IF;
  model_id := coalesce(p_request->>'chronology_model_id', 'theographic-verse-v1');
  IF NOT EXISTS(SELECT 1 FROM public.chronology_models WHERE id = model_id AND published) THEN RETURN invalid; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(refs) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF NOT (
      (item ? 'book' AND item ? 'chapter' AND item ? 'verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','verse')))
      OR
      (item ? 'book' AND item ? 'chapter' AND item ? 'start_verse' AND item ? 'end_verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','start_verse','end_verse')))
    ) THEN RETURN invalid; END IF;

    IF jsonb_typeof(item->'book') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'chapter') IS DISTINCT FROM 'number' THEN RETURN invalid; END IF;
    IF item->>'book' !~ '^[0-9]{1,2}$' OR item->>'chapter' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
    IF (item->>'book')::int NOT BETWEEN 1 AND 66 OR (item->>'chapter')::int NOT BETWEEN 1 AND 150 THEN RETURN invalid; END IF;

    IF item ? 'verse' THEN
      IF jsonb_typeof(item->'verse') IS DISTINCT FROM 'number' OR item->>'verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
    ELSE
      IF jsonb_typeof(item->'start_verse') IS DISTINCT FROM 'number' OR item->>'start_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF jsonb_typeof(item->'end_verse') IS DISTINCT FROM 'number' OR item->>'end_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int NOT BETWEEN 0 AND 176 OR (item->>'end_verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int > (item->>'end_verse')::int THEN RETURN invalid; END IF;
    END IF;
  END LOOP;

  SELECT count(DISTINCT (r.item->>'book')::int || ':' || (r.item->>'chapter')::int || ':' || g.v)
  INTO total_expanded
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g;

  IF total_expanded NOT BETWEEN 1 AND max_passages THEN RETURN invalid; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT
        (r.item->>'book')::int AS book,
        (r.item->>'chapter')::int AS chapter,
        g.v AS verse
      FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
      CROSS JOIN LATERAL (
        SELECT generate_series(
          coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
          coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
        ) AS v
      ) g
    ) req
    WHERE NOT EXISTS (
      SELECT 1 FROM public.verses v
      WHERE v.book = req.book AND v.chapter = req.chapter AND v.verse_nr = req.verse
    )
  ) THEN
    RETURN jsonb_build_object('schema_version', 2, 'status', 'passage_not_found', 'requested_passages', refs);
  END IF;

  SELECT
    array_agg(DISTINCT v.id ORDER BY v.id),
    array_agg(DISTINCT wid ORDER BY wid)
  INTO v_verse_ids, v_word_ids
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g
  JOIN public.verses v ON v.book = (r.item->>'book')::int AND v.chapter = (r.item->>'chapter')::int AND v.verse_nr = g.v
  CROSS JOIN LATERAL unnest(v.word_ids) wid;

  v_remote_vts := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', to_jsonb(coalesce(v_verse_ids, '{}'::integer[])))
  );
  v_remote_wfl := bible_internal.call_corpus_rpc_v1(
    'get_word_form_lemmas_batch_v1',
    jsonb_build_object('p_word_ids', to_jsonb(coalesce(v_word_ids, '{}'::integer[])))
  );

  IF v_remote_vts IS NULL OR jsonb_typeof(v_remote_vts) <> 'object' OR coalesce(v_remote_vts->>'status', '') <> 'ok'
     OR v_remote_wfl IS NULL OR jsonb_typeof(v_remote_wfl) <> 'object' OR coalesce(v_remote_wfl->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 2,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading verse translation sources or word form lemmas'
    );
  END IF;

  WITH req_passages AS MATERIALIZED (
    SELECT
      row_number() OVER (ORDER BY min(r.ord), (r.item->>'book')::int, (r.item->>'chapter')::int, g.v)::int AS ord,
      (r.item->>'book')::int AS book,
      (r.item->>'chapter')::int AS chapter,
      g.v AS verse
    FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
    CROSS JOIN LATERAL (
      SELECT generate_series(
        coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
        coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
      ) AS v
    ) g
    GROUP BY (r.item->>'book')::int, (r.item->>'chapter')::int, g.v
  ), passages AS MATERIALIZED (
    SELECT v.*, r.ord, (v.book || ':' || v.chapter || ':' || v.verse_nr) AS verse_ref
    FROM req_passages r
    JOIN public.verses v ON v.book = r.book AND v.chapter = r.chapter AND v.verse_nr = r.verse
  ), remote_vts_rows AS MATERIALIZED (
    SELECT
      p.id AS verse_id,
      (elem->>'word_position')::integer AS word_position,
      (elem->>'word_id')::integer AS word_id,
      elem->>'source_english' AS source_english,
      elem->>'source_ref' AS source_ref,
      elem->>'source_name' AS source_name,
      elem->>'source_commit' AS source_commit
    FROM passages p
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_remote_vts #> ARRAY['verses', p.id::text], '[]'::jsonb)) elem
  ), tokens AS MATERIALIZED (
    SELECT v.id verse_id, v.verse_ref, u.ord::integer word_position, w.*,
      s.source_english, s.source_ref, s.source_name, s.source_commit
    FROM passages v
    CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id, ord)
    JOIN public.words w ON w.id = u.word_id
    LEFT JOIN remote_vts_rows s ON s.verse_id = v.id AND s.word_position = u.ord AND s.word_id = w.id
  ), targets AS MATERIALIZED (
    SELECT DISTINCT strongs_nr FROM tokens
  ), lexemes AS MATERIALIZED (
    SELECT t.strongs_nr, coalesce(jsonb_agg(to_jsonb(l)-'id' ORDER BY l.lexeme_key)
      FILTER(WHERE l.id IS NOT NULL), '[]'::jsonb) candidates
    FROM targets t LEFT JOIN public.lexemes l ON l.base_strongs = t.strongs_nr GROUP BY t.strongs_nr
  ), lexical AS MATERIALIZED (
    SELECT t.strongs_nr, jsonb_build_object(
      'identity_scope', 'base_strongs',
      'strongs_nr', t.strongs_nr,
      'lexeme_candidates', l.candidates,
      'needs_disambiguation', jsonb_array_length(l.candidates) > 1,
      'sense_status', 'not_assigned_to_token',
      'semantic_annotation_status', CASE WHEN jsonb_array_length(l.candidates) = 0 THEN 'unavailable' ELSE 'candidate_lexemes_only' END,
      'occurrences', o.doc,
      'top_connected_words', c.doc,
      'connection_coverage', jsonb_build_object(
        'requested', 7, 'returned', jsonb_array_length(c.doc),
        'status', CASE WHEN jsonb_array_length(c.doc) = 0 THEN 'no_cached_connections' ELSE 'cached' END,
        'method', 'Cached within-verse base-Strongs token-pair associations; scores are not semantic equivalence.'
      ),
      'limitations', 'Base Strong''s groups inflections and may combine homographs. Multi-valence and paronomasia are preserved across contexts.'
    ) doc
    FROM targets t
    JOIN lexemes l USING(strongs_nr)
    CROSS JOIN LATERAL (
      SELECT jsonb_build_object(
        'counting_method', 'Sum of matching tokens per passage across base-Strongs inflections',
        'corpus_token_total', coalesce(sum(occurrence_count), 0),
        'distinct_passage_total', count(*),
        'returned_reference_count', count(*) FILTER(WHERE mode = 'all' OR rn <= sample_limit),
        'complete', mode = 'all' OR count(*) <= sample_limit,
        'references', coalesce(jsonb_agg(jsonb_build_object(
          'book', q.book, 'chapter', q.chapter, 'verse', q.verse_nr, 'occurrence_count', q.occurrence_count
        ) ORDER BY q.book, q.chapter, q.verse_nr) FILTER(WHERE mode = 'all' OR rn <= sample_limit), '[]'::jsonb)
      ) doc
      FROM (
        SELECT a.*, row_number() OVER(ORDER BY a.book, a.chapter, a.verse_nr) rn
        FROM public.prompt_word_occurrences(t.strongs_nr) a
      ) q
    ) o
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.rank), '[]'::jsonb) doc FROM (
        SELECT row_number() OVER(ORDER BY a.score DESC, a.word_id) rank, a.*,
          w.english_translations, w.biblical_def, w.physical_def, 'stepbible-2026-11'::text source_release_key
        FROM public.prompt_word_cooccurrences(t.strongs_nr) a
        JOIN public.words w ON w.id = a.word_id
        ORDER BY a.score DESC, a.word_id LIMIT 7
      ) q
    ) c
  ), remote_wfl_rows AS MATERIALIZED (
    SELECT
      wid AS word_id,
      (elem->>'id')::bigint AS id,
      (elem->>'component_order')::smallint AS component_order,
      elem->>'morpheme_role' AS morpheme_role,
      elem->>'morpheme_surface' AS morpheme_surface,
      elem->>'morpheme_gloss' AS morpheme_gloss,
      elem->>'grammar_code' AS grammar_code,
      (elem->>'lemma_id')::bigint AS lemma_id,
      coalesce((elem->>'is_context_ambiguous')::boolean, false) AS is_context_ambiguous
    FROM unnest(coalesce(v_word_ids, '{}'::integer[])) wid
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', wid::text, 'word_form_lemmas'], '[]'::jsonb)) elem
  ), token_morphology AS MATERIALIZED (
    SELECT wfl.word_id,
      coalesce(jsonb_agg(jsonb_build_object(
        'order', wfl.component_order,
        'role', wfl.morpheme_role,
        'surface', wfl.morpheme_surface,
        'gloss', wfl.morpheme_gloss,
        'grammar_code', wfl.grammar_code,
        'lemma_key', l.lemma_key,
        'is_context_ambiguous', wfl.is_context_ambiguous
      ) ORDER BY wfl.component_order, wfl.id), '[]'::jsonb) AS morphemes,
      array_agg(DISTINCT l.lemma_key ORDER BY l.lemma_key) AS lemma_keys,
      array_agg(DISTINCT wfl.lemma_id) AS lemma_ids
    FROM remote_wfl_rows wfl
    JOIN public.lemmas l ON l.id = wfl.lemma_id
    GROUP BY wfl.word_id
  ), lemma_ids AS MATERIALIZED (
    SELECT DISTINCT unnest(lemma_ids) AS id FROM token_morphology
    UNION
    SELECT DISTINCT l.id FROM public.lemmas l WHERE l.base_strongs IN (SELECT DISTINCT strongs_nr FROM targets)
  ), formations_agg AS MATERIALIZED (
    SELECT f.lemma_id, jsonb_agg(jsonb_build_object(
      'formation_id', f.id, 'lemma_id', f.lemma_id, 'analysis_key', f.analysis_key,
      'formation_type', f.formation_type, 'whole_word_gloss', f.whole_word_gloss,
      'evidence_status', f.evidence_status, 'evidence_note', f.evidence_note,
      'origin_mode', f.origin_mode, 'review_status', f.review_status,
      'source', jsonb_build_object('title', f.source_title, 'url', f.source_url, 'record_id', f.source_record_id),
      'components', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order', c.component_order, 'surface_text', c.surface_text,
          'role', c.component_role, 'semantic_contribution', c.semantic_contribution,
          'component_note', c.component_note,
          'lemma_id', cl.id, 'lemma_key', cl.lemma_key, 'base_strongs', cl.base_strongs,
          'original_lemma', cl.lemma_script, 'transliteration', cl.transliteration,
          'lexeme_id', cx.id, 'primary_gloss', cx.primary_gloss,
          'senses', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'sense_code', ss.sense_code, 'short_gloss', ss.short_gloss,
              'source_attribution', ss.source_attribution
            ) ORDER BY ss.sense_order, ss.id), '[]'::jsonb)
            FROM (SELECT * FROM public.lexical_senses s WHERE s.lemma_id = cl.id ORDER BY s.sense_order, s.id LIMIT 5) ss
          )
        ) ORDER BY c.component_order)
        FROM public.lemma_components c
        LEFT JOIN public.lemmas cl ON cl.id = c.component_lemma_id
        LEFT JOIN public.lexemes cx ON cx.id = coalesce(c.component_lexeme_id, cl.primary_lexeme_id)
        WHERE c.formation_id = f.id
      ), '[]'::jsonb)
    ) ORDER BY f.id) AS formations
    FROM public.lexical_formations f
    WHERE f.lemma_id IN (SELECT id FROM lemma_ids)
    GROUP BY f.lemma_id
  ), roots_agg AS MATERIALIZED (
    SELECT rl.lemma_id, jsonb_agg(jsonb_build_object(
      'lemma_id', rl.lemma_id, 'lemma_key', l.lemma_key, 'root_id', r.id, 'root_key', r.root_key,
      'root_script', r.root_script, 'root_transliteration', r.transliteration,
      'root_kind', r.root_kind, 'relation_type', rl.etymology_type,
      'implies_synonymy', false, 'evidence_note', rl.evidence_note,
      'origin_mode', rl.origin_mode, 'derivation_method', rl.derivation_method,
      'source_record_id', rl.source_record_id, 'source_release_key', sr.release_key
    ) ORDER BY r.root_key) AS roots
    FROM public.lemma_root_links rl
    JOIN public.lemmas l ON l.id = rl.lemma_id
    JOIN public.lexical_roots r ON r.id = rl.root_id
    LEFT JOIN public.source_releases sr ON sr.id = rl.source_release_id
    WHERE rl.lemma_id IN (SELECT id FROM lemma_ids)
    GROUP BY rl.lemma_id
  ), relatives_agg AS MATERIALIZED (
    SELECT rel.source_lemma_id AS lemma_id, jsonb_agg(rel.doc ORDER BY rel.relative_lemma_key) AS relatives
    FROM (
      SELECT roots.lemma_id AS source_lemma_id, l.lemma_key AS relative_lemma_key, jsonb_build_object(
        'root_key', r.root_key, 'relative_lemma_id', l.id, 'relative_lemma_key', l.lemma_key,
        'base_strongs', l.base_strongs, 'lemma_script', l.lemma_script,
        'transliteration', l.transliteration, 'primary_gloss', lx.primary_gloss,
        'relation_type', related.etymology_type, 'source_record_id', related.source_record_id
      ) AS doc
      FROM (
        SELECT DISTINCT rl.lemma_id, rl.root_id FROM public.lemma_root_links rl
        WHERE rl.lemma_id IN (SELECT id FROM lemma_ids)
      ) roots
      JOIN public.lexical_roots r ON r.id = roots.root_id
      JOIN public.lemma_root_links related ON related.root_id = r.id
      JOIN public.lemmas l ON l.id = related.lemma_id
      LEFT JOIN public.lexemes lx ON lx.id = l.primary_lexeme_id
      WHERE NOT (l.id IN (SELECT id FROM lemma_ids))
    ) rel
    GROUP BY rel.source_lemma_id
  ), connections_agg AS MATERIALIZED (
    SELECT conn.lemma_id, jsonb_agg(conn.doc ORDER BY conn.connection_id) AS connections
    FROM (
      SELECT c.subject_lemma_id AS lemma_id, c.id AS connection_id, jsonb_build_object(
        'connection_id', c.id, 'source_lemma_id', c.subject_lemma_id, 'target_lemma_id', c.target_lemma_id,
        'source_lemma_key', sl.lemma_key, 'target_lemma_key', tl.lemma_key,
        'source_strongs', sl.base_strongs, 'target_strongs', tl.base_strongs,
        'relation_type', c.relation_type, 'evidence_status', c.evidence_status,
        'evidence_note', c.evidence_note, 'passage_reference', c.passage_reference,
        'source_title', c.source_title, 'source_url', c.source_url, 'derivation_method', c.derivation_method
      ) AS doc
      FROM public.lexical_connections c
      JOIN public.lemmas sl ON sl.id = c.subject_lemma_id
      JOIN public.lemmas tl ON tl.id = c.target_lemma_id
      WHERE c.subject_lemma_id IN (SELECT id FROM lemma_ids)
      UNION ALL
      SELECT c.target_lemma_id AS lemma_id, c.id AS connection_id, jsonb_build_object(
        'connection_id', c.id, 'source_lemma_id', c.subject_lemma_id, 'target_lemma_id', c.target_lemma_id,
        'source_lemma_key', sl.lemma_key, 'target_lemma_key', tl.lemma_key,
        'source_strongs', sl.base_strongs, 'target_strongs', tl.base_strongs,
        'relation_type', c.relation_type, 'evidence_status', c.evidence_status,
        'evidence_note', c.evidence_note, 'passage_reference', c.passage_reference,
        'source_title', c.source_title, 'source_url', c.source_url, 'derivation_method', c.derivation_method
      ) AS doc
      FROM public.lexical_connections c
      JOIN public.lemmas sl ON sl.id = c.subject_lemma_id
      JOIN public.lemmas tl ON tl.id = c.target_lemma_id
      WHERE c.target_lemma_id IN (SELECT id FROM lemma_ids)
    ) conn
    GROUP BY conn.lemma_id
  ), hydrated_lemma_formations AS MATERIALIZED (
    SELECT l.lemma_key, jsonb_build_object(
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
    ) AS formation_entry
    FROM lemma_ids li
    JOIN public.lemmas l ON l.id = li.id
    LEFT JOIN public.lexemes lx ON lx.id = l.primary_lexeme_id
    LEFT JOIN formations_agg f ON f.lemma_id = l.id
    LEFT JOIN roots_agg r ON r.lemma_id = l.id
    LEFT JOIN relatives_agg rel ON rel.lemma_id = l.id
    LEFT JOIN connections_agg conn ON conn.lemma_id = l.id
  ), semantic_paths AS MATERIALIZED (
    SELECT a.id, a.subject_node_id, a.object_node_id,
      to_jsonb(a)-'id'-'subject_node_id'-'object_node_id' || jsonb_build_object(
        'subject', sn.display_label, 'object', ob.display_label,
        'evidence_spans', coalesce((
          SELECT jsonb_agg(to_jsonb(e)-'id'-'assertion_id' ORDER BY e.step_order, e.id)
          FROM public.assertion_evidence e WHERE e.assertion_id = a.id
        ), '[]'::jsonb)
      ) doc
    FROM public.assertions a
    JOIN public.research_nodes sn ON sn.id = a.subject_node_id
    JOIN public.research_nodes ob ON ob.id = a.object_node_id
    WHERE a.review_status = 'reviewed'
  ), verse_packets AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, jsonb_build_object(
      'verse_id', v.id,
      'verse_ref', v.verse_ref,
      'passage', jsonb_build_object(
        'book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0
      ),
      'words', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'word_position', t.word_position, 'word_id', t.id, 'original_word', t.original_word,
          'transliteration', t.transliteration, 'strongs_nr', t.strongs_nr, 'lexical_entry_key', t.strongs_nr,
          'disambiguated_lemmas', coalesce(tm.lemma_keys, '{}'::text[]),
          'morphology', coalesce(tm.morphemes, '[]'::jsonb),
          'grammar', jsonb_build_object(
            'raw_code', t.grammar_code,
            'scheme', CASE WHEN t.source_name LIKE 'TAHOT%' THEN 'STEP TEHMC (ETCBC/OpenScriptures adapted)'
              WHEN t.source_name LIKE 'TAGNT%' THEN 'STEP TEGMC (Tauber adapted)' ELSE NULL END,
            'decoded_grammar', public.decode_grammar_v1(t.grammar_code),
            'decoded_features', public.decode_grammar_v1(t.grammar_code),
            'unresolved_tags', CASE WHEN t.grammar_code IS NULL OR public.decode_grammar_v1(t.grammar_code) = '{}'::jsonb
              THEN CASE WHEN t.grammar_code IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(t.grammar_code) END
              ELSE '[]'::jsonb END
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
          'lexeme_candidates', (SELECT candidates FROM lexemes l WHERE l.strongs_nr = t.strongs_nr)
        ) ORDER BY t.word_position)
        FROM tokens t
        LEFT JOIN token_morphology tm ON tm.word_id = t.id
        WHERE t.verse_id = v.id
      ), '[]'::jsonb),
      'coverage', jsonb_build_object(
        'semantic_scope', 'Reviewed passage matches and lexically related concept candidates; not token-sense assignments',
        'grammar_decoding', 'Server-side structured decoding active via decode_grammar_v1',
        'semantic_domains', 'candidate_lexemes_only',
        'token_senses', 'unavailable'
      )
    ) doc FROM passages v
  ), top_chronology AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_chronology_v1(v.book, v.chapter, v.verse_nr, model_id) doc
    FROM passages v
  ), top_geography AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_geography(v.book, v.chapter, v.verse_nr) doc
    FROM passages v
  ), top_semantics AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, coalesce((
      SELECT jsonb_agg(sp.doc ORDER BY sp.id)
      FROM semantic_paths sp
      WHERE EXISTS(
        SELECT 1 FROM public.assertion_evidence e
        WHERE e.assertion_id = sp.id AND e.book = v.book
          AND (v.chapter, v.verse_nr) >= (e.start_chapter, e.start_verse)
          AND (v.chapter, v.verse_nr) <= (e.end_chapter, e.end_verse)
      ) OR EXISTS(
        SELECT 1 FROM public.research_nodes n
        JOIN public.concepts c ON c.id = n.concept_id
        WHERE n.id IN (sp.subject_node_id, sp.object_node_id)
          AND c.primary_strongs && array(SELECT t.strongs_nr::text FROM tokens t WHERE t.verse_id = v.id)
      )
    ), '[]'::jsonb) doc
    FROM passages v
  )
  SELECT jsonb_build_object(
    'schema_version', 2,
    'status', 'ok',
    'verses', (SELECT jsonb_agg(doc ORDER BY ord) FROM verse_packets),
    'chronology', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_chronology),
    'geography', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_geography),
    'semantic_evidence', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_semantics),
    'lexical_entries', (SELECT jsonb_object_agg(strongs_nr, doc ORDER BY strongs_nr) FROM lexical),
    'lexical_formations', (SELECT jsonb_object_agg(lemma_key, formation_entry ORDER BY lemma_key) FROM hydrated_lemma_formations),
    'sources', coalesce((SELECT jsonb_agg(to_jsonb(s)-'id'-'created_at' ORDER BY s.release_key)
      FROM public.source_releases s WHERE s.release_key IN ('stepbible-2026-11','curated-motifs-v1')), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'corpus', 'primary STEP Hebrew/Aramaic OT and NA28-membership Greek NT',
      'requested_passage_count', jsonb_array_length(refs),
      'returned_passage_count', (SELECT count(*) FROM passages),
      'lexical_entry_count', (SELECT count(*) FROM targets),
      'occurrence_mode', mode,
      'occurrences_complete', (SELECT bool_and((doc #>> '{occurrences,complete}')::boolean) FROM lexical),
      'chronology_evidence_complete', (SELECT bool_and(coalesce((doc #>> '{status}') = 'ok', false)
        AND NOT coalesce((doc #>> '{evidence_truncated}')::boolean, true)
        AND NOT coalesce((doc #>> '{assertions_truncated}')::boolean, true)) FROM top_chronology),
      'component_statuses', (SELECT jsonb_agg(jsonb_build_object(
        'verse_ref', v.verse_ref,
        'passage', jsonb_build_object('book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0),
        'chronology', c.doc #>> '{status}',
        'geography', g.doc #>> '{status}'
      ) ORDER BY v.ord) FROM passages v JOIN top_chronology c USING(verse_ref) JOIN top_geography g USING(verse_ref)),
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
  ) INTO packet;

  byte_size := octet_length(packet::text);
  IF byte_size > 8388608 THEN
    RETURN jsonb_build_object(
      'schema_version', 2,
      'status', 'packet_limit_exceeded',
      'requested_passages', refs,
      'measured_bytes', byte_size,
      'max_packet_bytes', 8388608,
      'message', 'Request fewer passages or explicitly select occurrences.mode=sample. No partial packet was returned.'
    );
  END IF;

  RETURN packet;
END;
$_$;


ALTER FUNCTION "public"."get_verse_research_v2"("p_request" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_verse_translations_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) RETURNS TABLE("word_position" integer, "word_id" integer, "original_word" "text", "transliteration" "text", "strongs_nr" character varying, "grammar_code" character varying, "primary_english" "text", "millennium" smallint, "source_english" "text", "english_translations" "text"[], "selected_english" "text", "has_choice" boolean, "source_ref" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_verse_id integer;
  v_remote jsonb;
  v_vts jsonb := '[]'::jsonb;
BEGIN
  SELECT v.id INTO v_verse_id
  FROM public.verses v
  WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse;

  IF v_verse_id IS NULL THEN
    RETURN;
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', jsonb_build_array(v_verse_id))
  );

  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' THEN
    v_vts := coalesce(v_remote #> ARRAY['verses', v_verse_id::text], '[]'::jsonb);
  END IF;

  RETURN QUERY
  WITH remote_vts AS (
    SELECT
      (elem->>'word_position')::integer AS word_position,
      (elem->>'word_id')::integer AS word_id,
      elem->>'source_english' AS source_english,
      elem->>'source_ref' AS source_ref
    FROM jsonb_array_elements(v_vts) elem
  )
  SELECT
    u.ord::integer,
    w.id,
    w.original_word,
    w.transliteration,
    w.strongs_nr,
    w.grammar_code,
    coalesce(c.english, s.source_english, w.english_translations[1]),
    v.millennium,
    s.source_english,
    public.translation_options_v1(w.id, s.source_english),
    c.english,
    c.owner_id IS NOT NULL,
    s.source_ref
  FROM public.verses v
  CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id, ord)
  JOIN public.words w ON w.id = u.word_id
  LEFT JOIN remote_vts s
    ON s.word_position = u.ord AND s.word_id = w.id
  LEFT JOIN public.word_translation_choices c
    ON c.owner_id = (SELECT auth.uid())
   AND c.verse_id = v.id
   AND c.word_position = u.ord
   AND c.word_id = w.id
  WHERE v.id = v_verse_id
  ORDER BY u.ord;
END;
$$;


ALTER FUNCTION "public"."get_verse_translations_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_word_formation_v1"("p_query" "text" DEFAULT NULL::"text", "p_word_id" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $_$
DECLARE
  v_q text := btrim(coalesce(p_query,''));
  v_base text;
  v_stripped text;
  v_norm text;
  v_ids bigint[];
  v_total integer;
  v_selected integer;
  v_lemmas jsonb;
  v_formations jsonb;
  v_roots jsonb;
  v_relatives jsonb;
  v_connections jsonb;
  v_form_candidates jsonb := '[]'::jsonb;
  v_remote_wfl jsonb;
BEGIN
  IF p_word_id IS NOT NULL AND p_word_id <= 0 THEN
    RETURN jsonb_build_object('schema_version',1,'status','invalid_request','message','p_word_id must be positive');
  END IF;
  IF p_word_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.words w WHERE w.id = p_word_id) THEN
      RETURN jsonb_build_object('schema_version',1,'status','word_id_not_found');
    END IF;
    IF v_q = '' THEN
      SELECT w.strongs_nr INTO v_q FROM public.words w WHERE w.id = p_word_id;
    END IF;
  END IF;
  IF v_q = '' OR length(v_q) > 128 THEN
    RETURN jsonb_build_object('schema_version',1,'status','invalid_request','message','Provide p_query (1-128 characters), or a valid p_word_id.');
  END IF;
  v_base := CASE
    WHEN v_q ~* '^[HG]0*[0-9]+[A-Z]?$'
    THEN upper(regexp_replace(v_q,'^([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))
    ELSE NULL END;
  v_stripped := regexp_replace(normalize(v_q,NFKD),'[֑-ׇ̀-ͯ]','','g');
  v_norm := translate(translate(v_stripped,'ךםןףץ','כמנפצ'),'ς','σ');

  WITH targets AS (
    SELECT l.id,
       CASE WHEN lower(l.lemma_key)=lower(v_q) OR lower(l.lemma_key)='lemma:'||lower(v_q) THEN 0
            WHEN v_base IS NOT NULL AND (l.base_strongs=v_base OR upper(regexp_replace(l.lemma_key,'^lemma:([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))=v_base) THEN 1
            WHEN EXISTS (SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=upper(v_q)) THEN 2
            WHEN l.lemma_script=v_q OR (v_stripped<>'' AND l.lemma_stripped=v_stripped) THEN 3
            WHEN (v_norm<>'' AND translate(translate(l.lemma_stripped,'ךםןףץ','כמנפצ'),'ς','σ')=v_norm) THEN 4
            ELSE 5 END priority
    FROM public.lemmas l
    WHERE (v_base IS NOT NULL AND (l.base_strongs=v_base OR upper(regexp_replace(l.lemma_key,'^lemma:([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))=v_base))
       OR lower(l.lemma_key)=lower(v_q)
       OR lower(l.lemma_key)='lemma:'||lower(v_q)
       OR l.lemma_script=v_q
       OR (v_stripped<>'' AND l.lemma_stripped=v_stripped)
       OR (v_norm<>'' AND translate(translate(l.lemma_stripped,'ךםןףץ','כמנפצ'),'ς','σ')=v_norm)
       OR lower(l.transliteration)=lower(v_q)
       OR EXISTS (SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=upper(v_q))
  ),
  ids AS (SELECT id FROM targets ORDER BY priority,id LIMIT 26)
  SELECT array_agg(id) INTO v_ids FROM ids;
  v_total := coalesce(cardinality(v_ids),0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('schema_version',1,'status','not_found','query',v_q);
  END IF;
  IF v_total > 25 THEN v_ids := v_ids[1:25]; END IF;
  v_selected := cardinality(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lemma_id',l.id,'lemma_key',l.lemma_key,'language',l.language,
    'lemma_script',l.lemma_script,'lemma_stripped',l.lemma_stripped,
    'transliteration',l.transliteration,'base_strongs',l.base_strongs,
    'primary_pos',l.primary_pos,'homograph_tag',l.homograph_tag,
    'primary_lexeme_id',l.primary_lexeme_id,
    'primary_gloss',lx.primary_gloss,
    'source_record_id',l.source_record_id
  ) ORDER BY l.id),'[]'::jsonb)
  INTO v_lemmas
  FROM public.lemmas l LEFT JOIN public.lexemes lx ON lx.id=l.primary_lexeme_id
  WHERE l.id = ANY(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'formation_id',f.id,'lemma_id',f.lemma_id,'analysis_key',f.analysis_key,
    'formation_type',f.formation_type,'whole_word_gloss',f.whole_word_gloss,
    'evidence_status',f.evidence_status,'evidence_note',f.evidence_note,
    'origin_mode',f.origin_mode,'review_status',f.review_status,
    'source',jsonb_build_object('title',f.source_title,'url',f.source_url,'record_id',f.source_record_id),
    'components',(
       SELECT coalesce(jsonb_agg(jsonb_build_object(
         'order',c.component_order,'surface_text',c.surface_text,
         'role',c.component_role,'semantic_contribution',c.semantic_contribution,
         'component_note',c.component_note,
         'lemma_id',cl.id,'lemma_key',cl.lemma_key,'base_strongs',cl.base_strongs,
         'original_lemma',cl.lemma_script,'transliteration',cl.transliteration,
         'lexeme_id',cx.id,'primary_gloss',cx.primary_gloss,
         'senses',(
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'sense_code',ss.sense_code,'short_gloss',ss.short_gloss,
              'source_attribution',ss.source_attribution
            ) ORDER BY ss.sense_order,ss.id),'[]'::jsonb)
            FROM (SELECT * FROM public.lexical_senses s WHERE s.lemma_id=cl.id ORDER BY s.sense_order,s.id LIMIT 5) ss
         )
       ) ORDER BY c.component_order),'[]'::jsonb)
       FROM public.lemma_components c
       LEFT JOIN public.lemmas cl ON cl.id=c.component_lemma_id
       LEFT JOIN public.lexemes cx ON cx.id=coalesce(c.component_lexeme_id,cl.primary_lexeme_id)
       WHERE c.formation_id=f.id
    )
  ) ORDER BY f.id),'[]'::jsonb)
  INTO v_formations FROM public.lexical_formations f WHERE f.lemma_id = ANY(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lemma_id',rl.lemma_id,'lemma_key',l.lemma_key,'root_id',r.id,'root_key',r.root_key,
    'root_script',r.root_script,'root_transliteration',r.transliteration,
    'root_kind',r.root_kind,'relation_type',rl.etymology_type,
    'implies_synonymy',false,'evidence_note',rl.evidence_note,
    'origin_mode',rl.origin_mode,'derivation_method',rl.derivation_method,
    'source_record_id',rl.source_record_id,'source_release_key',sr.release_key
  ) ORDER BY rl.lemma_id,r.root_key,rl.id),'[]'::jsonb)
  INTO v_roots
  FROM public.lemma_root_links rl
  JOIN public.lemmas l ON l.id=rl.lemma_id
  JOIN public.lexical_roots r ON r.id=rl.root_id
  LEFT JOIN public.source_releases sr ON sr.id=rl.source_release_id
  WHERE rl.lemma_id = ANY(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'root_key',r.root_key,'relative_lemma_id',l.id,'relative_lemma_key',l.lemma_key,
    'base_strongs',l.base_strongs,'lemma_script',l.lemma_script,
    'transliteration',l.transliteration,'primary_gloss',lx.primary_gloss,
    'relation_type',related.etymology_type,'source_record_id',related.source_record_id
  ) ORDER BY r.root_key, l.id),'[]'::jsonb)
  INTO v_relatives FROM (
    SELECT DISTINCT rl.root_id FROM public.lemma_root_links rl WHERE rl.lemma_id = ANY(v_ids)
  ) roots
  JOIN public.lexical_roots r ON r.id=roots.root_id
  JOIN public.lemma_root_links related ON related.root_id=r.id
  JOIN public.lemmas l ON l.id=related.lemma_id
  LEFT JOIN public.lexemes lx ON lx.id=l.primary_lexeme_id
  WHERE NOT (l.id = ANY(v_ids));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'connection_id',c.id,'source_lemma_id',c.subject_lemma_id,'target_lemma_id',c.target_lemma_id,
    'source_lemma_key',sl.lemma_key,'target_lemma_key',tl.lemma_key,
    'source_strongs',sl.base_strongs,'target_strongs',tl.base_strongs,
    'relation_type',c.relation_type,'evidence_status',c.evidence_status,
    'evidence_note',c.evidence_note,'passage_reference',c.passage_reference,
    'source_title',c.source_title,'source_url',c.source_url,'derivation_method',c.derivation_method
  ) ORDER BY c.id),'[]'::jsonb)
  INTO v_connections
  FROM public.lexical_connections c
  JOIN public.lemmas sl ON sl.id=c.subject_lemma_id
  JOIN public.lemmas tl ON tl.id=c.target_lemma_id
  WHERE c.subject_lemma_id = ANY(v_ids) OR c.target_lemma_id = ANY(v_ids);

  IF p_word_id IS NOT NULL THEN
    v_remote_wfl := bible_internal.call_corpus_rpc_v1(
      'get_word_form_lemmas_batch_v1',
      jsonb_build_object('p_word_ids', jsonb_build_array(p_word_id))
    );
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'component_order', (elem->>'component_order')::smallint,
      'morpheme_role', elem->>'morpheme_role',
      'surface', elem->>'morpheme_surface',
      'gloss', elem->>'morpheme_gloss',
      'grammar_code', elem->>'grammar_code',
      'lemma_id', (elem->>'lemma_id')::bigint,
      'lexeme_id', l.primary_lexeme_id,
      'observed_token_count', (elem->>'observed_token_count')::integer,
      'is_context_ambiguous', coalesce((elem->>'is_context_ambiguous')::boolean, false),
      'source_record_id', elem->>'source_record_id'
    ) ORDER BY (elem->>'component_order')::smallint, (elem->>'id')::bigint), '[]'::jsonb)
    INTO v_form_candidates
    FROM (
      SELECT elem
      FROM jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', p_word_id::text, 'word_form_lemmas'], '[]'::jsonb)) elem
      ORDER BY (elem->>'component_order')::smallint, (elem->>'id')::bigint
      LIMIT 30
    ) sub
    LEFT JOIN public.lemmas l ON l.id = (sub.elem->>'lemma_id')::bigint;
  END IF;

  RETURN jsonb_build_object(
    'schema_version',1,'status','ok','query',v_q,'requested_word_id',p_word_id,
    'identity_scope','disambiguated_lemmas',
    'needs_disambiguation',v_total>1,'matched_lemmas',v_lemmas,
    'lexical_formations',v_formations,'documented_roots',v_roots,
    'root_relatives',v_relatives,'other_connections',v_connections,
    'word_form_component_candidates',v_form_candidates,
    'coverage',jsonb_build_object(
      'selected_lemma_count',v_selected,'complete',v_total<=25,
      'roots_attested_for_every_lemma',(
        SELECT NOT EXISTS (SELECT 1 FROM unnest(v_ids) x(lemma_id)
          WHERE NOT EXISTS(SELECT 1 FROM public.lemma_root_links r WHERE r.lemma_id=x.lemma_id))
      ),
      'token_morphology_scope','word-form candidates, not uniquely disambiguated verse-token morphemes',
      'missing_data_not_evidence_of_absence',true,
      'root_is_not_a_meaning',true,'shared_root_implies_synonymy',false,
      'orthographic_similarity_proves_derivation',false
    )
  );
END;
$_$;


ALTER FUNCTION "public"."get_word_formation_v1"("p_query" "text", "p_word_id" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_word_formation_v1"("p_query" "text", "p_word_id" integer) IS 'Read-only formation and relationship packet with disambiguated lemma candidates, sourced compound elements, documented roots, and explicitly labelled textual/formal connections; not an AI semantic inference.';



CREATE OR REPLACE FUNCTION "public"."harmonize_greek_accents"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  SELECT normalize(p_text, NFC);
$$;


ALTER FUNCTION "public"."harmonize_greek_accents"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_help"("item_id" bigint) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  update needs
  set help_current = help_current + 1
  where id = item_id;
$$;


ALTER FUNCTION "public"."increment_help"("item_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_prayed"("item_id" bigint) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  update needs
  set prayed = prayed + 1
  where id = item_id;
$$;


ALTER FUNCTION "public"."increment_prayed"("item_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_cross_token_mappings_batch_v1"("p_mappings" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_inserted integer := 0;
  v_release_id bigint;
  v_edition_id bigint;
begin
  select id into v_release_id from public.source_releases where release_key = 'morphhb-3d15126';
  select id into v_edition_id from public.source_editions where edition_key = 'morphhb-wlc';

  with rows_in as (
    select
      (elem->>'canonical_verse_id')::integer as canonical_verse_id,
      (elem->>'step_word_id')::integer as step_word_id,
      (elem->>'morphhb_token_id')::bigint as morphhb_token_id,
      (elem->>'macula_morpheme_id')::bigint as macula_morpheme_id,
      elem->>'mapping_status' as mapping_status,
      elem->>'notes' as notes,
      elem->>'source_record_id' as source_record_id,
      elem->>'derivation_method' as derivation_method,
      elem->>'algorithm_version' as algorithm_version
    from jsonb_array_elements(p_mappings) as elem
  ),
  ins as (
    insert into public.cross_token_mappings (
      canonical_verse_id, step_word_id, morphhb_token_id, macula_morpheme_id,
      mapping_status, notes,
      source_release_id, source_edition_id, source_record_id,
      origin_mode, derivation_method, algorithm_version
    )
    select
      r.canonical_verse_id, r.step_word_id, r.morphhb_token_id, r.macula_morpheme_id,
      r.mapping_status, r.notes,
      v_release_id, v_edition_id, r.source_record_id,
      'algorithmically_calculated', r.derivation_method, r.algorithm_version
    from rows_in r
    on conflict (canonical_verse_id, step_word_id, morphhb_token_id, macula_morpheme_id, mapping_status) do update set
      notes = excluded.notes
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('success', true, 'inserted_or_updated', v_inserted);
end;
$$;


ALTER FUNCTION "public"."ingest_cross_token_mappings_batch_v1"("p_mappings" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_hebrew_lxx_mappings_batch_v1"("p_mappings" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inserted integer := 0;
  v_default_release_id bigint;
BEGIN
  SELECT id INTO v_default_release_id
  FROM public.source_releases
  WHERE release_key = 'lxx-swete-26bad3e'
  LIMIT 1;

  WITH ins AS (
    INSERT INTO public.hebrew_lxx_verse_map (
      canonical_verse_id,
      lxx_book_no,
      lxx_chapter,
      lxx_chapter_suffix,
      lxx_verse_nr,
      lxx_verse_suffix,
      mapping_kind,
      rule_citation,
      origin_mode,
      derivation_method,
      algorithm_version,
      source_release_id,
      source_record_id
    )
    SELECT
      (elem->>'canonical_verse_id')::integer,
      (elem->>'lxx_book_no')::smallint,
      (elem->>'lxx_chapter')::smallint,
      COALESCE(elem->>'lxx_chapter_suffix', ''),
      (elem->>'lxx_verse_nr')::smallint,
      COALESCE(elem->>'lxx_verse_suffix', ''),
      (elem->>'mapping_kind')::text,
      (elem->>'rule_citation')::text,
      COALESCE(elem->>'origin_mode', 'algorithmically_calculated')::text,
      COALESCE(elem->>'derivation_method', 'mt_lxx_reference_alignment')::text,
      COALESCE(elem->>'algorithm_version', '1.0.0')::text,
      COALESCE((elem->>'source_release_id')::bigint, v_default_release_id),
      (elem->>'source_record_id')::text
    FROM jsonb_array_elements(p_mappings) AS elem
    ON CONFLICT (canonical_verse_id, lxx_book_no, lxx_chapter, lxx_chapter_suffix, lxx_verse_nr, lxx_verse_suffix)
    DO UPDATE SET
      mapping_kind = EXCLUDED.mapping_kind,
      rule_citation = EXCLUDED.rule_citation,
      derivation_method = EXCLUDED.derivation_method,
      algorithm_version = EXCLUDED.algorithm_version,
      source_record_id = EXCLUDED.source_record_id
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'status', 'success',
    'inserted_count', v_inserted
  );
END;
$$;


ALTER FUNCTION "public"."ingest_hebrew_lxx_mappings_batch_v1"("p_mappings" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_hebrew_lxx_word_alignments_batch_v1"("p_alignments" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.hebrew_lxx_word_alignments (
    alignment_key,
    canonical_verse_id,
    lxx_book_no,
    lxx_chapter,
    lxx_chapter_suffix,
    lxx_verse_nr,
    lxx_verse_suffix,
    hebrew_word_ids,
    hebrew_token_ordinals,
    hebrew_text,
    hebrew_strongs,
    lxx_word_ids,
    lxx_token_ordinals,
    lxx_text,
    lxx_strongs,
    cardinality,
    alignment_tier,
    verification_status,
    confidence_score,
    algorithm_or_source,
    translation_technique,
    evidence_summary,
    source_release_id,
    source_record_id
  )
  SELECT
    (a->>'alignment_key')::text,
    (a->>'canonical_verse_id')::integer,
    (a->>'lxx_book_no')::smallint,
    (a->>'lxx_chapter')::smallint,
    coalesce(a->>'lxx_chapter_suffix', '')::text,
    (a->>'lxx_verse_nr')::smallint,
    coalesce(a->>'lxx_verse_suffix', '')::text,
    coalesce((SELECT array_agg(elem::integer) FROM jsonb_array_elements_text(a->'hebrew_word_ids') elem), '{}'::integer[]),
    coalesce((SELECT array_agg(elem::smallint) FROM jsonb_array_elements_text(a->'hebrew_token_ordinals') elem), '{}'::smallint[]),
    (a->>'hebrew_text')::text,
    coalesce((SELECT array_agg(elem::text) FROM jsonb_array_elements_text(a->'hebrew_strongs') elem), '{}'::text[]),
    coalesce((SELECT array_agg(elem::bigint) FROM jsonb_array_elements_text(a->'lxx_word_ids') elem), '{}'::bigint[]),
    coalesce((SELECT array_agg(elem::smallint) FROM jsonb_array_elements_text(a->'lxx_token_ordinals') elem), '{}'::smallint[]),
    (a->>'lxx_text')::text,
    coalesce((SELECT array_agg(elem::text) FROM jsonb_array_elements_text(a->'lxx_strongs') elem), '{}'::text[]),
    (a->>'cardinality')::text,
    (a->>'alignment_tier')::text,
    (a->>'verification_status')::text,
    (a->>'confidence_score')::numeric,
    (a->>'algorithm_or_source')::text,
    a->>'translation_technique',
    (a->>'evidence_summary')::text,
    (a->>'source_release_id')::bigint,
    coalesce(a->>'source_record_id', '')::text
  FROM jsonb_array_elements(p_alignments) AS a
  ON CONFLICT (alignment_key) DO UPDATE SET
    canonical_verse_id = EXCLUDED.canonical_verse_id,
    lxx_book_no = EXCLUDED.lxx_book_no,
    lxx_chapter = EXCLUDED.lxx_chapter,
    lxx_chapter_suffix = EXCLUDED.lxx_chapter_suffix,
    lxx_verse_nr = EXCLUDED.lxx_verse_nr,
    lxx_verse_suffix = EXCLUDED.lxx_verse_suffix,
    hebrew_word_ids = EXCLUDED.hebrew_word_ids,
    hebrew_token_ordinals = EXCLUDED.hebrew_token_ordinals,
    hebrew_text = EXCLUDED.hebrew_text,
    hebrew_strongs = EXCLUDED.hebrew_strongs,
    lxx_word_ids = EXCLUDED.lxx_word_ids,
    lxx_token_ordinals = EXCLUDED.lxx_token_ordinals,
    lxx_text = EXCLUDED.lxx_text,
    lxx_strongs = EXCLUDED.lxx_strongs,
    cardinality = EXCLUDED.cardinality,
    alignment_tier = EXCLUDED.alignment_tier,
    verification_status = EXCLUDED.verification_status,
    confidence_score = EXCLUDED.confidence_score,
    algorithm_or_source = EXCLUDED.algorithm_or_source,
    translation_technique = EXCLUDED.translation_technique,
    evidence_summary = EXCLUDED.evidence_summary,
    source_release_id = EXCLUDED.source_release_id,
    source_record_id = EXCLUDED.source_record_id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'inserted', v_inserted
  );
END;
$$;


ALTER FUNCTION "public"."ingest_hebrew_lxx_word_alignments_batch_v1"("p_alignments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_lexemes_batch_v1"("p_batch" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count int := 0;
begin
  insert into public.lexemes (
    lexeme_key,
    language,
    base_strongs,
    extended_strongs,
    disambiguated_strongs,
    unified_strongs,
    original_lemma,
    transliteration,
    pos,
    primary_gloss,
    homograph_note,
    source_release_id
  )
  select
    elem->>'lexeme_key',
    elem->>'language',
    elem->>'base_strongs',
    elem->>'extended_strongs',
    elem->>'disambiguated_strongs',
    elem->>'unified_strongs',
    elem->>'original_lemma',
    elem->>'transliteration',
    elem->>'pos',
    elem->>'primary_gloss',
    elem->>'homograph_note',
    coalesce((elem->>'source_release_id')::bigint, 1)
  from jsonb_array_elements(p_batch) as elem
  on conflict (lexeme_key) do update set
    language = excluded.language,
    base_strongs = excluded.base_strongs,
    extended_strongs = excluded.extended_strongs,
    disambiguated_strongs = excluded.disambiguated_strongs,
    unified_strongs = excluded.unified_strongs,
    original_lemma = excluded.original_lemma,
    transliteration = excluded.transliteration,
    pos = excluded.pos,
    primary_gloss = excluded.primary_gloss,
    homograph_note = coalesce(excluded.homograph_note, public.lexemes.homograph_note),
    source_release_id = excluded.source_release_id;

  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'ok', 'count', v_count);
end;
$$;


ALTER FUNCTION "public"."ingest_lexemes_batch_v1"("p_batch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_lexical_formations_batch_v1"("p_formations" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_formations_count int := 0;
  v_components_count int := 0;
  v_f record;
  v_formation_id bigint;
  v_resolved_lemma_id bigint;
  v_c record;
  v_resolved_comp_lemma_id bigint;
begin
  for v_f in
    select
      (elem->>'lemma_id')::bigint as lemma_id,
      elem->>'source_strongs' as source_strongs,
      coalesce(elem->>'analysis_key', elem->>'source_strongs') as analysis_key,
      elem->>'formation_type' as formation_type,
      coalesce(elem->>'whole_word_gloss', elem->>'gloss') as whole_word_gloss,
      coalesce(elem->>'evidence_status', 'documented') as evidence_status,
      coalesce(elem->>'evidence_note', 'Documented lexical formation evidence') as evidence_note,
      coalesce(elem->>'source_title', elem->>'source_dataset', 'Documented source') as source_title,
      coalesce(elem->>'source_url', 'https://github.com/openscriptures/HebrewLexicon') as source_url,
      coalesce(elem->>'source_record_id', elem->>'source_strongs') as source_record_id,
      coalesce(elem->>'origin_mode', 'sourced') as origin_mode,
      elem->'components' as components
    from jsonb_array_elements(p_formations) elem
  loop
    v_resolved_lemma_id := v_f.lemma_id;
    if v_resolved_lemma_id is null and v_f.source_strongs is not null then
      select l.id into v_resolved_lemma_id
      from public.lemmas l
      where l.base_strongs = upper(regexp_replace(v_f.source_strongs, '^([HG])0*([0-9]+[A-Z]?)$', '\1\2', 'i'))
         or lower(l.lemma_key) = lower(v_f.source_strongs)
         or lower(l.lemma_key) = 'lemma:' || lower(v_f.source_strongs)
      order by l.id
      limit 1;
    end if;

    if v_resolved_lemma_id is null then
      continue;
    end if;

    insert into public.lexical_formations
      (lemma_id, analysis_key, formation_type, whole_word_gloss, evidence_status, evidence_note, source_title, source_url, source_record_id, origin_mode)
    values
      (v_resolved_lemma_id, v_f.analysis_key, v_f.formation_type, v_f.whole_word_gloss, v_f.evidence_status, v_f.evidence_note, v_f.source_title, v_f.source_url, v_f.source_record_id, v_f.origin_mode)
    on conflict (lemma_id, analysis_key) do nothing
    returning id into v_formation_id;

    if v_formation_id is null then
      select id into v_formation_id from public.lexical_formations where lemma_id = v_resolved_lemma_id and analysis_key = v_f.analysis_key;
    else
      v_formations_count := v_formations_count + 1;
    end if;

    if v_formation_id is not null and v_f.components is not null and jsonb_array_length(v_f.components) > 0 then
      for v_c in
        select
          coalesce((comp->>'order')::int, (comp->>'sequence')::int) as component_order,
          (comp->>'lemma_id')::bigint as lemma_id,
          (comp->>'lexeme_id')::bigint as lexeme_id,
          comp->>'component_strongs' as component_strongs,
          comp->>'surface_text' as surface_text,
          comp->>'role' as component_role,
          coalesce(comp->>'semantic_contribution', comp->>'gloss') as semantic_contribution,
          comp->>'note' as component_note
        from jsonb_array_elements(v_f.components) comp
      loop
        v_resolved_comp_lemma_id := v_c.lemma_id;
        if v_resolved_comp_lemma_id is null and v_c.component_strongs is not null then
          select l.id into v_resolved_comp_lemma_id
          from public.lemmas l
          where l.base_strongs = upper(regexp_replace(v_c.component_strongs, '^([HG])0*([0-9]+[A-Z]?)$', '\1\2', 'i'))
             or lower(l.lemma_key) = lower(v_c.component_strongs)
             or lower(l.lemma_key) = 'lemma:' || lower(v_c.component_strongs)
          order by l.id
          limit 1;
        end if;

        if v_resolved_comp_lemma_id is null then
          continue;
        end if;

        insert into public.lemma_components
          (formation_id, component_order, component_lemma_id, component_lexeme_id, surface_text, component_role, semantic_contribution, component_note)
        values
          (v_formation_id, v_c.component_order, v_resolved_comp_lemma_id, v_c.lexeme_id, coalesce(v_c.surface_text, (select lemma_stripped from public.lemmas where id = v_resolved_comp_lemma_id), ''), v_c.component_role, v_c.semantic_contribution, v_c.component_note)
        on conflict (formation_id, component_order) do nothing;
        if found then
          v_components_count := v_components_count + 1;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'formations_processed', jsonb_array_length(p_formations),
    'formations_inserted', v_formations_count,
    'components_inserted', v_components_count
  );
end;
$_$;


ALTER FUNCTION "public"."ingest_lexical_formations_batch_v1"("p_formations" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ingest_lexical_formations_batch_v1"("p_formations" "jsonb") IS 'Batch idempotent ingestion for documented lexical formations and ordered components.';



CREATE OR REPLACE FUNCTION "public"."ingest_macula_batch_v1"("p_morphemes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_inserted integer := 0;
  v_release_id bigint;
  v_edition_id bigint;
begin
  select id into v_release_id from public.source_releases where release_key = 'macula-hebrew-47db250';
  select id into v_edition_id from public.source_editions where edition_key = 'macula-hebrew-wlc';

  with rows_in as (
    select
      elem->>'macula_id' as macula_id,
      elem->>'ref_mt' as ref_mt,
      (elem->>'book')::smallint as book,
      (elem->>'chapter_mt')::smallint as chapter_mt,
      (elem->>'verse_mt')::smallint as verse_mt,
      (elem->>'word_no')::smallint as word_no,
      (elem->>'morph_no')::smallint as morph_no,
      elem->>'class' as class,
      elem->>'text_form' as text_form,
      elem->>'after_text' as after_text,
      elem->>'lemma' as lemma,
      elem->>'strong_x' as strong_x,
      elem->>'morph_code' as morph_code,
      elem->>'lang' as lang,
      elem->>'stem' as stem,
      elem->>'morph_type' as morph_type,
      elem->>'gloss' as gloss,
      elem->>'english' as english,
      elem->>'mandarin' as mandarin,
      elem->>'sense_number' as sense_number,
      elem->>'subjref' as subjref,
      elem->>'participantref' as participantref,
      (elem->>'canonical_verse_id')::integer as canonical_verse_id,
      (elem->>'word_id')::integer as word_id,
      coalesce(elem->>'link_status', 'unmatched') as link_status,
      elem->>'source_record_id' as source_record_id
    from jsonb_array_elements(p_morphemes) as elem
  ),
  ins as (
    insert into public.macula_hebrew_morphemes (
      macula_id, ref_mt, book, chapter_mt, verse_mt, word_no, morph_no,
      class, text_form, after_text, lemma, strong_x, morph_code, lang, stem, morph_type,
      gloss, english, mandarin, sense_number, subjref, participantref,
      canonical_verse_id, word_id, link_status,
      source_release_id, source_edition_id, source_record_id, origin_mode, derivation_method
    )
    select
      r.macula_id, r.ref_mt, r.book, r.chapter_mt, r.verse_mt, r.word_no, r.morph_no,
      r.class, r.text_form, r.after_text, r.lemma, r.strong_x, r.morph_code, r.lang, r.stem, r.morph_type,
      r.gloss, r.english, r.mandarin, r.sense_number, r.subjref, r.participantref,
      r.canonical_verse_id, r.word_id, r.link_status,
      v_release_id, v_edition_id, r.source_record_id, 'directly_imported', 'macula_hebrew_tsv_row'
    from rows_in r
    on conflict (macula_id) do update set
      canonical_verse_id = coalesce(excluded.canonical_verse_id, public.macula_hebrew_morphemes.canonical_verse_id),
      word_id = coalesce(excluded.word_id, public.macula_hebrew_morphemes.word_id),
      link_status = case when excluded.link_status <> 'unmatched' then excluded.link_status else public.macula_hebrew_morphemes.link_status end
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('success', true, 'inserted_or_updated', v_inserted);
end;
$$;


ALTER FUNCTION "public"."ingest_macula_batch_v1"("p_morphemes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_macula_greek_batch_v1"("p_tokens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.macula_greek_tokens (
      edition_key, xml_id, ref_nt, book, chapter, verse_nr, word_no,
      role, part_of_speech, word_type, text_form, after_text, lemma, normalized,
      strongs, morph_code, person, number, gender, case_value, tense, voice, mood, degree,
      gloss, english, mandarin, frame, subjref, referent,
      canonical_verse_id, step_word_id, link_status,
      source_release_id, source_edition_id, source_record_id
    )
    SELECT
      t->>'edition_key',
      t->>'xml_id',
      t->>'ref_nt',
      (t->>'book')::smallint,
      (t->>'chapter')::smallint,
      (t->>'verse_nr')::smallint,
      (t->>'word_no')::smallint,
      t->>'role',
      t->>'part_of_speech',
      t->>'word_type',
      t->>'text_form',
      t->>'after_text',
      t->>'lemma',
      t->>'normalized',
      t->>'strongs',
      t->>'morph_code',
      t->>'person',
      t->>'number',
      t->>'gender',
      t->>'case_value',
      t->>'tense',
      t->>'voice',
      t->>'mood',
      t->>'degree',
      t->>'gloss',
      t->>'english',
      t->>'mandarin',
      t->>'frame',
      t->>'subjref',
      t->>'referent',
      (t->>'canonical_verse_id')::integer,
      (t->>'step_word_id')::integer,
      COALESCE(t->>'link_status', 'unmatched'),
      (t->>'source_release_id')::bigint,
      (t->>'source_edition_id')::bigint,
      t->>'source_record_id'
    FROM jsonb_array_elements(p_tokens) AS t
    ON CONFLICT (edition_key, xml_id) DO UPDATE SET
      text_form = EXCLUDED.text_form,
      after_text = EXCLUDED.after_text,
      lemma = EXCLUDED.lemma,
      normalized = EXCLUDED.normalized,
      strongs = EXCLUDED.strongs,
      morph_code = EXCLUDED.morph_code,
      gloss = EXCLUDED.gloss,
      english = EXCLUDED.english,
      canonical_verse_id = EXCLUDED.canonical_verse_id,
      step_word_id = EXCLUDED.step_word_id,
      link_status = EXCLUDED.link_status
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_or_updated', v_inserted
  );
END;
$$;


ALTER FUNCTION "public"."ingest_macula_greek_batch_v1"("p_tokens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_morphhb_batch_v1"("p_tokens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_inserted integer := 0;
  v_release_id bigint;
  v_edition_id bigint;
begin
  select id into v_release_id from public.source_releases where release_key = 'morphhb-3d15126';
  select id into v_edition_id from public.source_editions where edition_key = 'morphhb-wlc';

  with rows_in as (
    select
      elem->>'morphhb_id' as morphhb_id,
      (elem->>'book')::smallint as book,
      (elem->>'chapter')::smallint as chapter,
      (elem->>'verse_nr')::smallint as verse_nr,
      (elem->>'word_num')::smallint as word_num,
      elem->>'word_text' as word_text,
      elem->>'lemma' as lemma,
      elem->>'morph_code' as morph_code,
      elem->>'cantillation' as cantillation,
      coalesce((elem->>'is_ketiv')::boolean, false) as is_ketiv,
      coalesce((elem->>'is_qere')::boolean, false) as is_qere,
      elem->>'qere_target_id' as qere_target_id,
      coalesce((elem->>'is_aramaic')::boolean, false) as is_aramaic,
      (elem->>'canonical_verse_id')::integer as canonical_verse_id,
      (elem->>'step_word_id')::integer as step_word_id,
      elem->>'macula_ref' as macula_ref,
      coalesce(elem->>'link_status', 'unlinked') as link_status,
      elem->>'source_record_id' as source_record_id
    from jsonb_array_elements(p_tokens) as elem
  ),
  ins as (
    insert into public.morphhb_tokens (
      morphhb_id, book, chapter, verse_nr, word_num, word_text, lemma, morph_code,
      cantillation, is_ketiv, is_qere, qere_target_id, is_aramaic,
      canonical_verse_id, step_word_id, macula_ref, link_status,
      source_release_id, source_edition_id, source_record_id, origin_mode, derivation_method
    )
    select
      r.morphhb_id, r.book, r.chapter, r.verse_nr, r.word_num, r.word_text, r.lemma, r.morph_code,
      r.cantillation, r.is_ketiv, r.is_qere, r.qere_target_id, r.is_aramaic,
      r.canonical_verse_id, r.step_word_id, r.macula_ref, r.link_status,
      v_release_id, v_edition_id, r.source_record_id, 'directly_imported', 'morphhb_osis_xml_word'
    from rows_in r
    on conflict (morphhb_id) do update set
      canonical_verse_id = coalesce(excluded.canonical_verse_id, public.morphhb_tokens.canonical_verse_id),
      step_word_id = coalesce(excluded.step_word_id, public.morphhb_tokens.step_word_id),
      macula_ref = coalesce(excluded.macula_ref, public.morphhb_tokens.macula_ref),
      link_status = case when excluded.link_status <> 'unlinked' then excluded.link_status else public.morphhb_tokens.link_status end
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('success', true, 'inserted_or_updated', v_inserted);
end;
$$;


ALTER FUNCTION "public"."ingest_morphhb_batch_v1"("p_tokens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_quarantined_records_batch_v1"("p_records" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_inserted int := 0;
begin
  insert into public.quarantined_evidence_records
    (dataset_key, source_record_id, entity_type, raw_payload, quarantine_reason, quarantine_status, quarantined_at)
  select
    r->>'dataset_key',
    r->>'source_record_id',
    r->>'entity_type',
    coalesce(r->'raw_payload', '{}'::jsonb),
    r->>'quarantine_reason',
    coalesce(r->>'quarantine_status', 'unresolved'),
    now()
  from jsonb_array_elements(p_records) r
  where not exists (
    select 1 from public.quarantined_evidence_records q
    where q.dataset_key = r->>'dataset_key'
      and q.source_record_id = r->>'source_record_id'
      and q.entity_type = r->>'entity_type'
  );
  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'status', 'ok',
    'quarantined_processed', jsonb_array_length(p_records),
    'quarantined_inserted', v_inserted
  );
end;
$$;


ALTER FUNCTION "public"."ingest_quarantined_records_batch_v1"("p_records" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ingest_quarantined_records_batch_v1"("p_records" "jsonb") IS 'Batch idempotent ingestion for quarantined ambiguous or conflicted lexical mappings.';



CREATE OR REPLACE FUNCTION "public"."ingest_swete_words_batch_v1"("p_words" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inserted integer := 0;
  v_default_release_id bigint;
  v_default_edition_id bigint;
BEGIN
  -- Resolve default release and edition if not provided per row
  SELECT id INTO v_default_release_id
  FROM public.source_releases
  WHERE release_key = 'lxx-swete-26bad3e'
  LIMIT 1;

  SELECT id INTO v_default_edition_id
  FROM public.source_editions
  WHERE edition_key = 'lxx-swete'
  LIMIT 1;

  WITH ins AS (
    INSERT INTO public.lxx_swete_words (
      book_no,
      chapter,
      chapter_suffix,
      verse_nr,
      verse_suffix,
      ordinal,
      word_text,
      normalized_word,
      source_record_id,
      source_release_id,
      source_edition_id
    )
    SELECT
      (elem->>'book_no')::smallint,
      (elem->>'chapter')::smallint,
      COALESCE(elem->>'chapter_suffix', ''),
      (elem->>'verse_nr')::smallint,
      COALESCE(elem->>'verse_suffix', ''),
      (elem->>'ordinal')::integer,
      (elem->>'word_text')::text,
      COALESCE(
        elem->>'normalized_word',
        public.strip_greek_diacritics((elem->>'word_text')::text)
      ),
      (elem->>'source_record_id')::text,
      COALESCE((elem->>'source_release_id')::bigint, v_default_release_id),
      COALESCE((elem->>'source_edition_id')::bigint, v_default_edition_id)
    FROM jsonb_array_elements(p_words) AS elem
    ON CONFLICT (book_no, chapter, chapter_suffix, verse_nr, verse_suffix, ordinal)
    DO UPDATE SET
      word_text = EXCLUDED.word_text,
      normalized_word = EXCLUDED.normalized_word,
      source_record_id = EXCLUDED.source_record_id,
      source_release_id = EXCLUDED.source_release_id,
      source_edition_id = EXCLUDED.source_edition_id
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'status', 'success',
    'inserted_count', v_inserted
  );
END;
$$;


ALTER FUNCTION "public"."ingest_swete_words_batch_v1"("p_words" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_syntax_tree_batch_v1"("p_nodes" "jsonb", "p_edges" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_inserted_nodes integer := 0;
  v_updated_nodes integer := 0;
  v_inserted_edges integer := 0;
  v_node jsonb;
  v_edge jsonb;
  v_parent_id bigint;
  v_terminal_word_id integer;
  v_source_node_id bigint;
  v_target_node_id bigint;
  v_node_id bigint;
BEGIN
  -- 1. Insert or update nodes
  FOR v_node IN SELECT * FROM jsonb_array_elements(p_nodes)
  LOOP
    -- Resolve parent_node_id by parent_node_key if supplied
    v_parent_id := NULL;
    IF v_node->>'parent_node_key' IS NOT NULL AND btrim(v_node->>'parent_node_key') <> '' THEN
      SELECT id INTO v_parent_id
      FROM public.syntax_nodes
      WHERE node_key = v_node->>'parent_node_key';
    END IF;

    -- Resolve terminal_word_id if terminal_xml_id provided
    v_terminal_word_id := NULL;
    IF v_node->>'terminal_word_id' IS NOT NULL THEN
      v_terminal_word_id := (v_node->>'terminal_word_id')::integer;
    ELSIF v_node->>'terminal_xml_id' IS NOT NULL AND btrim(v_node->>'terminal_xml_id') <> '' THEN
      -- Try Hebrew morphemes first
      SELECT m.word_id INTO v_terminal_word_id
      FROM public.macula_hebrew_morphemes m
      WHERE m.macula_id = v_node->>'terminal_xml_id'
      LIMIT 1;

      -- If not found, try Greek tokens
      IF v_terminal_word_id IS NULL THEN
        SELECT g.step_word_id INTO v_terminal_word_id
        FROM public.macula_greek_tokens g
        WHERE g.xml_id = v_node->>'terminal_xml_id'
        LIMIT 1;
      END IF;
    END IF;

    -- Upsert syntax_node
    INSERT INTO public.syntax_nodes (
      node_key,
      edition_id,
      verse_id,
      node_type,
      start_word_position,
      end_word_position,
      head_word_position,
      syntactic_role,
      grammar_summary,
      source_release_id,
      source_record_id,
      parent_node_id,
      tree_id,
      depth,
      sibling_order,
      class_label,
      rule_label,
      cl_type,
      is_head,
      is_terminal,
      terminal_xml_id,
      terminal_word_id,
      semantic_frame,
      end_verse_id,
      is_cross_verse
    ) VALUES (
      v_node->>'node_key',
      (v_node->>'edition_id')::bigint,
      (v_node->>'verse_id')::integer,
      v_node->>'node_type',
      (v_node->>'start_word_position')::integer,
      (v_node->>'end_word_position')::integer,
      (v_node->>'head_word_position')::integer,
      v_node->>'syntactic_role',
      v_node->>'grammar_summary',
      (v_node->>'source_release_id')::bigint,
      v_node->>'source_record_id',
      v_parent_id,
      v_node->>'tree_id',
      coalesce((v_node->>'depth')::integer, 0),
      coalesce((v_node->>'sibling_order')::integer, 0),
      v_node->>'class_label',
      v_node->>'rule_label',
      v_node->>'cl_type',
      coalesce((v_node->>'is_head')::boolean, false),
      coalesce((v_node->>'is_terminal')::boolean, false),
      v_node->>'terminal_xml_id',
      v_terminal_word_id,
      v_node->>'semantic_frame',
      coalesce((v_node->>'end_verse_id')::integer, (v_node->>'verse_id')::integer),
      coalesce((v_node->>'is_cross_verse')::boolean, false)
    )
    ON CONFLICT (node_key) DO UPDATE SET
      edition_id = EXCLUDED.edition_id,
      verse_id = EXCLUDED.verse_id,
      node_type = EXCLUDED.node_type,
      start_word_position = EXCLUDED.start_word_position,
      end_word_position = EXCLUDED.end_word_position,
      head_word_position = EXCLUDED.head_word_position,
      syntactic_role = EXCLUDED.syntactic_role,
      grammar_summary = EXCLUDED.grammar_summary,
      source_release_id = EXCLUDED.source_release_id,
      source_record_id = EXCLUDED.source_record_id,
      parent_node_id = EXCLUDED.parent_node_id,
      tree_id = EXCLUDED.tree_id,
      depth = EXCLUDED.depth,
      sibling_order = EXCLUDED.sibling_order,
      class_label = EXCLUDED.class_label,
      rule_label = EXCLUDED.rule_label,
      cl_type = EXCLUDED.cl_type,
      is_head = EXCLUDED.is_head,
      is_terminal = EXCLUDED.is_terminal,
      terminal_xml_id = EXCLUDED.terminal_xml_id,
      terminal_word_id = EXCLUDED.terminal_word_id,
      semantic_frame = EXCLUDED.semantic_frame,
      end_verse_id = EXCLUDED.end_verse_id,
      is_cross_verse = EXCLUDED.is_cross_verse;

    v_inserted_nodes := v_inserted_nodes + 1;
  END LOOP;

  -- 2. Insert edges if provided
  IF p_edges IS NOT NULL AND jsonb_array_length(p_edges) > 0 THEN
    FOR v_edge IN SELECT * FROM jsonb_array_elements(p_edges)
    LOOP
      v_source_node_id := NULL;
      v_target_node_id := NULL;

      IF v_edge->>'source_node_key' IS NOT NULL THEN
        SELECT id INTO v_source_node_id FROM public.syntax_nodes WHERE node_key = v_edge->>'source_node_key';
      END IF;

      IF v_edge->>'target_node_key' IS NOT NULL THEN
        SELECT id INTO v_target_node_id FROM public.syntax_nodes WHERE node_key = v_edge->>'target_node_key';
      END IF;

      INSERT INTO public.syntax_edges (
        edition_id,
        verse_id,
        dependent_word_position,
        head_word_position,
        source_node_id,
        target_node_id,
        relation_type,
        head_strongs,
        raw_relation_tag,
        source_release_id,
        source_record_id,
        origin_mode,
        derivation_method,
        algorithm_version
      ) VALUES (
        (v_edge->>'edition_id')::bigint,
        (v_edge->>'verse_id')::integer,
        coalesce((v_edge->>'dependent_word_position')::integer, 1),
        coalesce((v_edge->>'head_word_position')::integer, 1),
        v_source_node_id,
        v_target_node_id,
        v_edge->>'relation_type',
        v_edge->>'head_strongs',
        v_edge->>'raw_relation_tag',
        (v_edge->>'source_release_id')::bigint,
        v_edge->>'source_record_id',
        coalesce(v_edge->>'origin_mode', 'directly_imported'),
        coalesce(v_edge->>'derivation_method', 'Parsed from Clear-Bible MACULA Lowfat XML treebanks'),
        v_edge->>'algorithm_version'
      )
      ON CONFLICT DO NOTHING;

      v_inserted_edges := v_inserted_edges + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'nodes_processed', v_inserted_nodes,
    'edges_processed', v_inserted_edges
  );
END;
$$;


ALTER FUNCTION "public"."ingest_syntax_tree_batch_v1"("p_nodes" "jsonb", "p_edges" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ingest_syntax_tree_batch_v1"("p_nodes" "jsonb", "p_edges" "jsonb") IS 'Deterministic batch ingestion for MACULA Hebrew and Greek hierarchical syntax trees with parent-child linkage, spans, and terminal token associations.';



CREATE OR REPLACE FUNCTION "public"."ingest_tagnt_batch_v1"("p_tokens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.tagnt_tokens (
      tagnt_id, word_type, surface_greek, transliteration, english_translation,
      dstrongs, grammar_code, lemma, step_gloss, editions,
      meaning_variants, spelling_variants, spanish_translation, sub_meaning,
      conjoin_word, sstrong_instance, alt_strongs,
      book, chapter, verse_nr, word_position,
      canonical_verse_id, step_word_id, link_status,
      source_release_id, source_edition_id, source_record_id
    )
    SELECT
      t->>'tagnt_id',
      t->>'word_type',
      t->>'surface_greek',
      t->>'transliteration',
      t->>'english_translation',
      t->>'dstrongs',
      t->>'grammar_code',
      t->>'lemma',
      t->>'step_gloss',
      t->>'editions',
      t->>'meaning_variants',
      t->>'spelling_variants',
      t->>'spanish_translation',
      t->>'sub_meaning',
      t->>'conjoin_word',
      t->>'sstrong_instance',
      t->>'alt_strongs',
      (t->>'book')::smallint,
      (t->>'chapter')::smallint,
      (t->>'verse_nr')::smallint,
      (t->>'word_position')::smallint,
      (t->>'canonical_verse_id')::integer,
      (t->>'step_word_id')::integer,
      COALESCE(t->>'link_status', 'exact_match'),
      (t->>'source_release_id')::bigint,
      (t->>'source_edition_id')::bigint,
      t->>'source_record_id'
    FROM jsonb_array_elements(p_tokens) AS t
    ON CONFLICT (source_release_id, tagnt_id) DO UPDATE SET
      surface_greek = EXCLUDED.surface_greek,
      transliteration = EXCLUDED.transliteration,
      english_translation = EXCLUDED.english_translation,
      dstrongs = EXCLUDED.dstrongs,
      grammar_code = EXCLUDED.grammar_code,
      lemma = EXCLUDED.lemma,
      step_gloss = EXCLUDED.step_gloss,
      editions = EXCLUDED.editions,
      meaning_variants = EXCLUDED.meaning_variants,
      spelling_variants = EXCLUDED.spelling_variants,
      canonical_verse_id = EXCLUDED.canonical_verse_id,
      step_word_id = EXCLUDED.step_word_id,
      link_status = EXCLUDED.link_status
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_or_updated', v_inserted
  );
END;
$$;


ALTER FUNCTION "public"."ingest_tagnt_batch_v1"("p_tokens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_note_connection_types_v1"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    SET "jit" TO 'off'
    AS $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'connection_types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type_key', ct.type_key,
          'connection_type', ct.connection_type,
          'label', ct.label,
          'inverse_label', ct.inverse_label,
          'category', ct.category,
          'default_direction', ct.default_direction,
          'is_symmetric', ct.is_symmetric,
          'description', ct.description,
          'is_system', ct.is_system
        ) order by ct.category, ct.type_key
      )
      from public.note_connection_types ct
    ), '[]'::jsonb),
    'note_kinds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'note_kind', nk.note_kind,
          'label', nk.label,
          'description', nk.description
        ) order by nk.note_kind
      )
      from public.note_kinds nk
    ), '[]'::jsonb),
    'block_types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'block_type', bt.block_type,
          'label', bt.label,
          'renderer_status', bt.renderer_status,
          'is_enabled', bt.is_enabled,
          'required_keys', to_jsonb(bt.required_keys),
          'url_keys', to_jsonb(bt.url_keys),
          'max_bytes', bt.max_bytes,
          'description', bt.description
        ) order by bt.block_type
      )
      from public.note_block_types bt
    ), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_build_object(
        'single_user_mode', s.single_user_mode,
        'human_writes_enabled', s.human_writes_enabled,
        'ai_writes_enabled', s.ai_writes_enabled,
        'default_visibility', s.default_visibility,
        'max_title_chars', s.max_title_chars,
        'max_body_chars', s.max_body_chars,
        'max_anchors', s.max_anchors,
        'max_connections', s.max_connections,
        'max_blocks', s.max_blocks,
        'human_writes_per_hour', s.human_writes_per_hour,
        'ai_writes_per_hour', s.ai_writes_per_hour,
        'updated_at', s.updated_at
      )
      from public.note_settings s
      where s.id = true
    ), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."list_note_connection_types_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_notes_v1"("p_author_kind" "text" DEFAULT NULL::"text", "p_note_kind" "text" DEFAULT NULL::"text", "p_connection_type" "text" DEFAULT NULL::"text", "p_query" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 25, "p_cursor" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    SET "jit" TO 'off'
    AS $$
declare
  v_limit int;
  v_cur_created timestamptz;
  v_cur_id uuid;
  v_notes_list jsonb;
  v_total int := 0;
  v_has_more boolean := false;
  v_next_cursor jsonb := null;
  v_fetched_count int := 0;
  v_result jsonb;
begin
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);

  if p_cursor is not null and p_cursor ? 'created_at' and p_cursor ? 'id' then
    v_cur_created := (p_cursor->>'created_at')::timestamptz;
    v_cur_id := (p_cursor->>'id')::uuid;
  end if;

  -- Compute total matching filter conditions
  select count(*)::int into v_total
  from public.notes n
  where n.status = 'published'
    and n.visibility = 'public'
    and (p_author_kind is null or n.author_kind = p_author_kind)
    and (p_note_kind is null or n.note_kind = p_note_kind)
    and (p_connection_type is null or exists (
          select 1 from public.note_connections c
          where c.note_id = n.id and c.connection_type = p_connection_type
        ))
    and (p_query is null or trim(p_query) = '' or (
          n.tsv @@ websearch_to_tsquery('simple', trim(p_query))
          or n.title ilike '%' || trim(p_query) || '%'
        ));

  -- Fetch items with limit + 1
  with filtered_rows as (
    select
      n.id as note_id,
      n.created_at
    from public.notes n
    where n.status = 'published'
      and n.visibility = 'public'
      and (p_author_kind is null or n.author_kind = p_author_kind)
      and (p_note_kind is null or n.note_kind = p_note_kind)
      and (p_connection_type is null or exists (
            select 1 from public.note_connections c
            where c.note_id = n.id and c.connection_type = p_connection_type
          ))
      and (p_query is null or trim(p_query) = '' or (
            n.tsv @@ websearch_to_tsquery('simple', trim(p_query))
            or n.title ilike '%' || trim(p_query) || '%'
          ))
      and (
        v_cur_created is null
        or (n.created_at, n.id) < (v_cur_created, v_cur_id)
      )
    order by n.created_at desc, n.id desc
    limit (v_limit + 1)
  ),
  numbered as (
    select
      fr.note_id,
      fr.created_at,
      row_number() over (order by fr.created_at desc, fr.note_id desc) as rn
    from filtered_rows fr
  )
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) order by anc.ordinal, anc.id
            )
            from public.note_anchors anc
            where anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) order by c.id
            )
            from public.note_connections c
            left join public.note_connection_types ct on ct.type_key = c.connection_type
            where c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) order by b.ordinal, b.id
            )
            from public.note_blocks b
            where b.note_id = n.id
          ), '[]'::jsonb)
        ) order by num.created_at desc, num.note_id desc
      )
      from numbered num
      join public.notes n on n.id = num.note_id
      join public.note_authors a on a.id = n.author_id
      where num.rn <= v_limit
    ), '[]'::jsonb),
    (select count(*)::int from numbered),
    (
      select jsonb_build_object(
        'created_at', num.created_at,
        'id', num.note_id
      )
      from numbered num
      where num.rn = v_limit
    )
  into v_notes_list, v_fetched_count, v_next_cursor;

  if v_fetched_count > v_limit then
    v_has_more := true;
  else
    v_has_more := false;
    v_next_cursor := null;
  end if;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'notes', v_notes_list,
    'page', jsonb_build_object(
      'limit', v_limit,
      'next_cursor', v_next_cursor,
      'has_more', v_has_more
    ),
    'total', v_total
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."list_notes_v1"("p_author_kind" "text", "p_note_kind" "text", "p_connection_type" "text", "p_query" "text", "p_limit" integer, "p_cursor" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_concept_properties_v1"("p_concept_query" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
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


ALTER FUNCTION "public"."lookup_concept_properties_v1"("p_concept_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_cross_testament_greek_v1"("p_greek_query" "text", "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_query text := btrim(coalesce(p_greek_query, ''));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_strong_norm text;
  v_clean_strong text;
  v_grk_entity record;
  v_base_strongs text;
  v_nt_total integer := 0;
  v_nt_verses integer := 0;
  v_nt_samples jsonb := '[]'::jsonb;
  v_lxx_total integer := 0;
  v_lxx_verses integer := 0;
  v_lxx_samples jsonb := '[]'::jsonb;
  v_hebrew_renderings jsonb := '[]'::jsonb;
  v_gated_norm_forms text[] := ARRAY[]::text[];
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_greek_query must not be empty'
    );
  END IF;

  IF v_query ~* '^[Gg]?[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := 'G' || regexp_replace(v_query, '[^0-9]', '', 'g');
    v_strong_norm := 'lemma:G' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  ELSIF v_query ~* '^lemma:G[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := regexp_replace(v_query, '^lemma:', '');
    v_strong_norm := v_query;
  END IF;

  SELECT ce.id, ce.entity_key, ce.display_label, ce.language, l.lemma_script, l.transliteration, l.base_strongs
  INTO v_grk_entity
  FROM public.canonical_entities ce
  LEFT JOIN public.lemmas l ON l.id = ce.lemma_id
  WHERE ce.entity_kind = 'lemma'
    AND ce.language = 'grc'
    AND (
      ce.entity_key = v_query
      OR (v_strong_norm IS NOT NULL AND (ce.entity_key = v_strong_norm OR ce.entity_key LIKE v_strong_norm || '%'))
      OR l.lemma_script = v_query
      OR public.strip_greek_diacritics(l.lemma_script) = public.strip_greek_diacritics(v_query)
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         WHEN public.strip_greek_diacritics(l.lemma_script) = public.strip_greek_diacritics(v_query) THEN 3
         ELSE 4 END
  LIMIT 1;

  IF v_grk_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_greek_query,
      'message', 'Greek lemma not found'
    );
  END IF;

  v_base_strongs := coalesce(v_grk_entity.base_strongs, v_clean_strong);

  -- 1. NT Greek occurrences in public.words (book >= 40)
  WITH matched_words AS (
    SELECT w.id AS word_id, w.original_word, w.transliteration, (w.english_translations)[1] AS gloss
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
       OR (v_grk_entity.lemma_script IS NOT NULL AND w.original_word = v_grk_entity.lemma_script)
  ),
  nt_occurrences_all AS (
    SELECT
      v.id AS verse_id,
      v.book,
      v.chapter,
      v.verse_nr,
      mw.word_id,
      mw.original_word,
      mw.transliteration,
      mw.gloss
    FROM public.verses v
    CROSS JOIN LATERAL unnest(v.word_ids) AS wid
    JOIN matched_words mw ON mw.word_id = wid
    WHERE v.book >= 40
  )
  SELECT
    count(*),
    count(DISTINCT verse_id)
  INTO v_nt_total, v_nt_verses
  FROM nt_occurrences_all;

  WITH matched_words AS (
    SELECT w.id AS word_id, w.original_word, w.transliteration, (w.english_translations)[1] AS gloss
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
       OR (v_grk_entity.lemma_script IS NOT NULL AND w.original_word = v_grk_entity.lemma_script)
  ),
  nt_occurrences_sample AS (
    SELECT
      v.id AS verse_id,
      v.book,
      v.chapter,
      v.verse_nr,
      mw.word_id,
      mw.original_word,
      mw.transliteration,
      mw.gloss
    FROM public.verses v
    CROSS JOIN LATERAL unnest(v.word_ids) AS wid
    JOIN matched_words mw ON mw.word_id = wid
    WHERE v.book >= 40
    ORDER BY v.book, v.chapter, v.verse_nr, mw.word_id
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'word_id', word_id,
      'book', book,
      'chapter', chapter,
      'verse_nr', verse_nr,
      'ref', book || ' ' || chapter || ':' || verse_nr,
      'original_word', original_word,
      'transliteration', transliteration,
      'gloss', gloss
    )
  ), '[]'::jsonb)
  INTO v_nt_samples
  FROM nt_occurrences_sample;

  -- Do not plan restricted-table reads while the source field is disabled.
  IF public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE THEN
    SELECT coalesce(array_agg(norm_word), ARRAY[]::text[]) INTO v_gated_norm_forms
    FROM (
SELECT DISTINCT public.strip_greek_diacritics(gm.greek_surface)
    FROM public.macula_greekstrong_morphemes gm
    WHERE public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE AND gm.greek_surface IS NOT NULL
      AND (
        (v_base_strongs IS NOT NULL AND gm.greekstrong = regexp_replace(v_base_strongs, '[^0-9]', '', 'g'))
        OR (v_clean_strong IS NOT NULL AND gm.greekstrong = regexp_replace(v_clean_strong, '[^0-9]', '', 'g'))
      )
    ) gated(norm_word);
  END IF;

  -- 2. LXX Swete occurrences via compact precomputed public.lxx_norm_word_summary & public.macula_greekstrong_morphemes
  WITH target_norm_forms AS (
    SELECT DISTINCT public.strip_greek_diacritics(w.original_word) AS norm_word
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
    UNION
    SELECT public.strip_greek_diacritics(v_grk_entity.lemma_script)
    WHERE v_grk_entity.lemma_script IS NOT NULL
    UNION
    SELECT unnest(v_gated_norm_forms)
  ),
  matched_summaries AS (
    SELECT s.occ_count, s.verse_keys, s.sample_rows
    FROM public.lxx_norm_word_summary s
    WHERE s.normalized_word IN (SELECT norm_word FROM target_norm_forms WHERE norm_word IS NOT NULL AND norm_word <> '')
  )
  SELECT
    coalesce((SELECT sum(occ_count)::integer FROM matched_summaries), 0),
    coalesce((SELECT count(DISTINCT vk)::integer FROM matched_summaries CROSS JOIN LATERAL unnest(verse_keys) AS vk), 0),
    coalesce((
      SELECT jsonb_agg(elem)
      FROM (
        SELECT elem
        FROM matched_summaries
        CROSS JOIN LATERAL jsonb_array_elements(sample_rows) AS elem
        ORDER BY
          (elem->>'book_no')::integer,
          (elem->>'chapter')::integer,
          (elem->>'verse_nr')::integer,
          (elem->>'word_id')::bigint
        LIMIT v_limit
      ) sub
    ), '[]'::jsonb)
  INTO v_lxx_total, v_lxx_verses, v_lxx_samples;

  -- 3. Hebrew lemmas rendered by this Greek lemma in MT via compact public.macula_greekstrong_morphemes
  IF public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE THEN
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'hebrew_lemma_key', ce_heb.entity_key,
      'hebrew_display_label', ce_heb.display_label,
      'hebrew_script', l_heb.lemma_script,
      'hebrew_strong', l_heb.base_strongs,
      'occurrence_count', sub.cnt
    )
  ), '[]'::jsonb)
  INTO v_hebrew_renderings
  FROM (
    SELECT
      er.subject_entity_id,
      count(DISTINCT gm.morpheme_id) AS cnt
    FROM public.entity_relationships er
    JOIN public.macula_greekstrong_morphemes gm
      ON public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE AND ('lemma:G' || lpad(gm.greekstrong, 4, '0') = v_grk_entity.entity_key
           OR v_grk_entity.entity_key LIKE 'lemma:G' || lpad(gm.greekstrong, 4, '0') || '%')
    WHERE er.object_entity_id = v_grk_entity.id
      AND er.relation_type IN ('explicit_source_word_alignment', 'source_provided_lexical_equivalent')
    GROUP BY er.subject_entity_id
    ORDER BY cnt DESC
    LIMIT v_limit
  ) sub
  JOIN public.canonical_entities ce_heb ON ce_heb.id = sub.subject_entity_id
  LEFT JOIN public.lemmas l_heb ON l_heb.id = ce_heb.lemma_id;

  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_greek_query,
    'greek_lemma', jsonb_build_object(
      'entity_key', v_grk_entity.entity_key,
      'display_label', v_grk_entity.display_label,
      'language', v_grk_entity.language,
      'lemma_script', v_grk_entity.lemma_script,
      'transliteration', v_grk_entity.transliteration,
      'base_strongs', v_grk_entity.base_strongs
    ),
    'nt_occurrences', jsonb_build_object(
      'total_count', v_nt_total,
      'total_matching_occurrences', v_nt_total,
      'total_verses', v_nt_verses,
      'returned_count', jsonb_array_length(v_nt_samples),
      'limit', v_limit,
      'samples', v_nt_samples
    ),
    'lxx_occurrences', jsonb_build_object(
      'total_count', v_lxx_total,
      'total_matching_occurrences', v_lxx_total,
      'total_verses', v_lxx_verses,
      'returned_count', jsonb_array_length(v_lxx_samples),
      'limit', v_limit,
      'is_exhaustive_lemma_count', false,
      'count_scope_notes', 'Swete LXX is an unlemmatized diplomatic text. Matching uses normalized surface inflections attested in New Testament lexical evidence; count reflects matching surface tokens, not an exhaustive morphological parse.',
      'samples', v_lxx_samples
    ),
    'hebrew_source_renderings', v_hebrew_renderings
  );
END;
$_$;


ALTER FUNCTION "public"."lookup_cross_testament_greek_v1"("p_greek_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_entity_relationships_v1"("p_entity_query" "text", "p_relation_type" "text" DEFAULT NULL::"text", "p_origin_mode" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
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


ALTER FUNCTION "public"."lookup_entity_relationships_v1"("p_entity_query" "text", "p_relation_type" "text", "p_origin_mode" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_greek_to_hebrew_alignments_v1"("p_greek_query" "text", "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_query text := btrim(coalesce(p_greek_query, ''));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_strong_norm text;
  v_clean_strong text;
  v_grk_entity record;
  v_alignments jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_license_status text;
  v_prov record;
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_greek_query must not be empty'
    );
  END IF;

  SELECT status INTO v_license_status
  FROM public.field_license_registry
  WHERE dataset_key = 'macula-hebrew' AND field_name = 'greekstrong';

  IF v_license_status IS NULL OR v_license_status NOT IN ('enabled_verified', 'enabled_origin_unverified') THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'gated_license_restricted',
      'message', 'Greek-to-Hebrew alignments gated pending license/provenance verification.',
      'license_status', coalesce(v_license_status, 'disabled_pending_audit')
    );
  END IF;

  IF v_query ~* '^[Gg]?[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := 'G' || regexp_replace(v_query, '[^0-9]', '', 'g');
    v_strong_norm := 'lemma:G' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  ELSIF v_query ~* '^lemma:G[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := regexp_replace(v_query, '^lemma:', '');
    v_strong_norm := v_query;
  END IF;

  SELECT ce.id, ce.entity_key, ce.display_label, ce.language, l.lemma_script, l.transliteration, l.base_strongs
  INTO v_grk_entity
  FROM public.canonical_entities ce
  LEFT JOIN public.lemmas l ON l.id = ce.lemma_id
  WHERE ce.entity_kind = 'lemma'
    AND ce.language = 'grc'
    AND (
      ce.entity_key = v_query
      OR (v_strong_norm IS NOT NULL AND (ce.entity_key = v_strong_norm OR ce.entity_key LIKE v_strong_norm || '%'))
      OR l.lemma_script = v_query
      OR public.strip_greek_diacritics(l.lemma_script) = public.strip_greek_diacritics(v_query)
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         ELSE 3 END
  LIMIT 1;

  IF v_grk_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_greek_query,
      'message', 'Greek lemma not found'
    );
  END IF;

  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'hebrew_lemma_key', sub.entity_key,
        'hebrew_display_label', sub.display_label,
        'hebrew_script', sub.lemma_script,
        'hebrew_transliteration', sub.transliteration,
        'hebrew_strong', sub.hebrew_strong,
        'relation_type', sub.relation_type,
        'derivation_method', sub.derivation_method,
        'evidence_summary', sub.evidence_summary,
        'occurrence_count', sub.occurrence_count,
        'sample_verses', sub.sample_verses
      )
    ), '[]'::jsonb),
    count(*)
  INTO v_alignments, v_total
  FROM (
    SELECT
      ce_heb.entity_key,
      ce_heb.display_label,
      l_heb.lemma_script,
      l_heb.transliteration,
      coalesce(l_heb.base_strongs, 'H' || regexp_replace(gm.strong_x, '[^0-9]', '', 'g')) AS hebrew_strong,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary,
      count(DISTINCT gm.morpheme_id) AS occurrence_count,
      array_agg(DISTINCT gm.book || ' ' || gm.chapter_mt || ':' || gm.verse_mt) FILTER (WHERE gm.book IS NOT NULL) AS sample_verses
    FROM public.entity_relationships er
    JOIN public.canonical_entities ce_heb ON ce_heb.id = er.subject_entity_id
    LEFT JOIN public.lemmas l_heb ON l_heb.id = ce_heb.lemma_id
    LEFT JOIN public.macula_greekstrong_morphemes gm
      ON ('lemma:G' || lpad(gm.greekstrong, 4, '0') = v_grk_entity.entity_key OR v_grk_entity.entity_key LIKE 'lemma:G' || lpad(gm.greekstrong, 4, '0') || '%')
      AND ('lemma:H' || lpad(regexp_replace(gm.strong_x, '[^0-9]', '', 'g'), 4, '0') = ce_heb.entity_key
           OR ce_heb.entity_key LIKE 'lemma:H' || lpad(regexp_replace(gm.strong_x, '[^0-9]', '', 'g'), 4, '0') || '%')
    WHERE er.object_entity_id = v_grk_entity.id
      AND er.relation_type IN ('explicit_source_word_alignment', 'source_provided_lexical_equivalent')
    GROUP BY
      ce_heb.entity_key,
      ce_heb.display_label,
      l_heb.lemma_script,
      l_heb.transliteration,
      l_heb.base_strongs,
      gm.strong_x,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary
    ORDER BY occurrence_count DESC, ce_heb.entity_key
    LIMIT v_limit
  ) sub;

  SELECT r.dataset, r.version_label, r.license, r.attribution
  INTO v_prov
  FROM public.source_releases r
  WHERE r.release_key = 'macula-hebrew-47db250' OR r.dataset ILIKE '%macula-hebrew%'
  LIMIT 1;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_greek_query,
    'greek_lemma', jsonb_build_object(
      'entity_key', v_grk_entity.entity_key,
      'display_label', v_grk_entity.display_label,
      'language', v_grk_entity.language,
      'lemma_script', v_grk_entity.lemma_script,
      'transliteration', v_grk_entity.transliteration,
      'base_strongs', v_grk_entity.base_strongs
    ),
    'license_status', v_license_status,
    'total_alignments', v_total,
    'alignments', v_alignments,
    'provenance', jsonb_build_object(
      'dataset', coalesce(v_prov.dataset, 'Clear-Bible/macula-hebrew'),
      'release', coalesce(v_prov.version_label, '2026-04-24 (47db250)'),
      'license', coalesce(v_prov.license, 'CC BY 4.0'),
      'attribution', coalesce(v_prov.attribution, 'Clear Bible / Biblica')
    )
  );
END;
$_$;


ALTER FUNCTION "public"."lookup_greek_to_hebrew_alignments_v1"("p_greek_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_greek_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_greek_verse_evidence_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'error', 'static_corpus_unavailable'
  );
END;
$$;


ALTER FUNCTION "public"."lookup_greek_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_hebrew_septuagint_alignments_v1"("p_query" "text", "p_tier" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_q text := btrim(coalesce(p_query, ''));
  v_results jsonb;
  v_total integer;
BEGIN
  IF v_q = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_query must not be empty'
    );
  END IF;

  WITH filtered AS (
    SELECT
      a.id,
      a.alignment_key,
      a.canonical_verse_id,
      a.lxx_book_no,
      coalesce(b.latin_name, '') AS lxx_book_name,
      a.lxx_chapter,
      a.lxx_chapter_suffix,
      a.lxx_verse_nr,
      a.lxx_verse_suffix,
      a.hebrew_text,
      a.hebrew_token_ordinals,
      a.hebrew_strongs,
      a.lxx_text,
      a.lxx_token_ordinals,
      a.lxx_strongs,
      a.cardinality,
      a.alignment_tier,
      a.verification_status,
      a.confidence_score,
      a.algorithm_or_source,
      a.translation_technique,
      a.evidence_summary
    FROM public.hebrew_lxx_word_alignments a
    LEFT JOIN public.lxx_swete_books b ON b.book_no = a.lxx_book_no
    WHERE (p_tier IS NULL OR a.alignment_tier = p_tier)
      AND (
        a.hebrew_text ILIKE '%' || v_q || '%'
        OR a.lxx_text ILIKE '%' || v_q || '%'
        OR v_q = ANY(a.hebrew_strongs)
        OR v_q = ANY(a.lxx_strongs)
        OR a.alignment_key ILIKE '%' || v_q || '%'
      )
    ORDER BY
      CASE WHEN a.alignment_tier = 'documented_textual' THEN 1
           WHEN a.alignment_tier = 'scholarly_interpretation' THEN 2
           ELSE 3 END,
      a.confidence_score DESC NULLS LAST,
      a.id
    LIMIT p_limit
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb),
    count(*)
  INTO v_results, v_total
  FROM filtered f;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_query,
    'tier_filter', p_tier,
    'total_returned', coalesce(v_total, 0),
    'alignments', v_results,
    'epistemic_disclaimer', 'Candidate alignments are computationally inferred and strictly segregated from verified textual evidence. Unmatched words remain explicitly unaligned without invented equivalents.'
  );
END;
$$;


ALTER FUNCTION "public"."lookup_hebrew_septuagint_alignments_v1"("p_query" "text", "p_tier" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_hebrew_to_greek_alignments_v1"("p_lemma_query" "text", "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_query text := btrim(coalesce(p_lemma_query, ''));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_strong_norm text;
  v_heb_entity record;
  v_alignments jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_license_status text;
  v_prov record;
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_lemma_query must not be empty'
    );
  END IF;

  SELECT status INTO v_license_status
  FROM public.field_license_registry
  WHERE dataset_key = 'macula-hebrew' AND field_name = 'greekstrong';

  IF v_license_status IS NULL OR v_license_status NOT IN ('enabled_verified', 'enabled_origin_unverified') THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'gated_license_restricted',
      'message', 'Hebrew-to-Greek alignments gated pending license/provenance verification.',
      'license_status', coalesce(v_license_status, 'disabled_pending_audit')
    );
  END IF;

  IF v_query ~* '^[Hh]?[0-9]+[A-Za-z]?$' THEN
    v_strong_norm := 'lemma:H' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  ELSIF v_query ~* '^lemma:H[0-9]+[A-Za-z]?$' THEN
    v_strong_norm := v_query;
  END IF;

  SELECT ce.id, ce.entity_key, ce.display_label, ce.language, l.lemma_script, l.transliteration, l.base_strongs
  INTO v_heb_entity
  FROM public.canonical_entities ce
  LEFT JOIN public.lemmas l ON l.id = ce.lemma_id
  WHERE ce.entity_kind = 'lemma'
    AND ce.language = 'hbo'
    AND (
      ce.entity_key = v_query
      OR (v_strong_norm IS NOT NULL AND (ce.entity_key = v_strong_norm OR ce.entity_key LIKE v_strong_norm || '%'))
      OR l.lemma_script = v_query
      OR public.strip_hebrew_all(l.lemma_script) = public.strip_hebrew_all(v_query)
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         ELSE 3 END
  LIMIT 1;

  IF v_heb_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_lemma_query,
      'message', 'Hebrew lemma not found'
    );
  END IF;

  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'greek_lemma_key', sub.entity_key,
        'greek_display_label', sub.display_label,
        'greek_script', sub.lemma_script,
        'greek_transliteration', sub.transliteration,
        'greek_strong', sub.greek_strong,
        'relation_type', sub.relation_type,
        'derivation_method', sub.derivation_method,
        'evidence_summary', sub.evidence_summary,
        'occurrence_count', sub.occurrence_count,
        'sample_verses', sub.sample_verses
      )
    ), '[]'::jsonb),
    count(*)
  INTO v_alignments, v_total
  FROM (
    SELECT
      ce_grk.entity_key,
      ce_grk.display_label,
      l_grk.lemma_script,
      l_grk.transliteration,
      coalesce(l_grk.base_strongs, 'G' || gm.greekstrong) AS greek_strong,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary,
      count(DISTINCT gm.morpheme_id) AS occurrence_count,
      array_agg(DISTINCT gm.book || ' ' || gm.chapter_mt || ':' || gm.verse_mt) FILTER (WHERE gm.book IS NOT NULL) AS sample_verses
    FROM public.entity_relationships er
    JOIN public.canonical_entities ce_grk ON ce_grk.id = er.object_entity_id
    LEFT JOIN public.lemmas l_grk ON l_grk.id = ce_grk.lemma_id
    LEFT JOIN public.macula_greekstrong_morphemes gm
      ON ('lemma:G' || lpad(gm.greekstrong, 4, '0') = ce_grk.entity_key OR ce_grk.entity_key LIKE 'lemma:G' || lpad(gm.greekstrong, 4, '0') || '%')
      AND ('lemma:H' || lpad(regexp_replace(gm.strong_x, '[^0-9]', '', 'g'), 4, '0') = v_heb_entity.entity_key
           OR v_heb_entity.entity_key LIKE 'lemma:H' || lpad(regexp_replace(gm.strong_x, '[^0-9]', '', 'g'), 4, '0') || '%')
    WHERE er.subject_entity_id = v_heb_entity.id
      AND er.relation_type IN ('explicit_source_word_alignment', 'source_provided_lexical_equivalent')
    GROUP BY
      ce_grk.entity_key,
      ce_grk.display_label,
      l_grk.lemma_script,
      l_grk.transliteration,
      l_grk.base_strongs,
      gm.greekstrong,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary
    ORDER BY occurrence_count DESC, ce_grk.entity_key
    LIMIT v_limit
  ) sub;

  SELECT r.dataset, r.version_label, r.license, r.attribution
  INTO v_prov
  FROM public.source_releases r
  WHERE r.release_key = 'macula-hebrew-47db250' OR r.dataset ILIKE '%macula-hebrew%'
  LIMIT 1;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_lemma_query,
    'hebrew_lemma', jsonb_build_object(
      'entity_key', v_heb_entity.entity_key,
      'display_label', v_heb_entity.display_label,
      'language', v_heb_entity.language,
      'lemma_script', v_heb_entity.lemma_script,
      'transliteration', v_heb_entity.transliteration,
      'base_strongs', v_heb_entity.base_strongs
    ),
    'license_status', v_license_status,
    'total_alignments', v_total,
    'alignments', v_alignments,
    'provenance', jsonb_build_object(
      'dataset', coalesce(v_prov.dataset, 'Clear-Bible/macula-hebrew'),
      'release', coalesce(v_prov.version_label, '2026-04-24 (47db250)'),
      'license', coalesce(v_prov.license, 'CC BY 4.0'),
      'attribution', coalesce(v_prov.attribution, 'Clear Bible / Biblica')
    )
  );
END;
$_$;


ALTER FUNCTION "public"."lookup_hebrew_to_greek_alignments_v1"("p_lemma_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_hebrew_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_hebrew_verse_evidence_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'error', 'static_corpus_unavailable'
  );
END;
$$;


ALTER FUNCTION "public"."lookup_hebrew_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_lemma_english_glosses_v1"("p_lemma_query" "text", "p_limit" integer DEFAULT 25) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $_$
DECLARE
  v_q text := btrim(coalesce(p_lemma_query, ''));
  v_base_strongs text := CASE
    WHEN v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_stripped text := regexp_replace(normalize(v_q, NFKD), '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־]', '', 'g');
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_lemma record;
  v_remote jsonb;
BEGIN
  IF v_q = '' THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'Provide p_lemma_query.');
  END IF;

  SELECT lem.*
  INTO v_lemma
  FROM public.lemmas lem
  WHERE lower(lem.lemma_key) = lower(v_q)
     OR lower(lem.lemma_key) = 'lemma:' || lower(v_q)
     OR (v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs)
     OR lem.lemma_script = v_q
     OR (v_stripped <> '' AND lem.lemma_stripped = v_stripped)
     OR lower(lem.transliteration) = lower(v_q)
     OR EXISTS (
       SELECT 1 FROM public.lexemes lx
       WHERE lx.lemma_id = lem.id AND upper(lx.extended_strongs) = upper(v_q)
     )
  ORDER BY
    CASE
      WHEN lower(lem.lemma_key) = lower(v_q) OR lower(lem.lemma_key) = 'lemma:' || lower(v_q) THEN 0
      WHEN EXISTS (SELECT 1 FROM public.lexemes lx WHERE lx.id = lem.primary_lexeme_id AND upper(lx.extended_strongs) = upper(v_q)) THEN 1
      WHEN v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs THEN 2
      ELSE 3
    END,
    lem.id
  LIMIT 1;

  IF v_lemma.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'not_found');
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_lemma_lexical_summary_v1',
    jsonb_build_object(
      'p_lemma_id', v_lemma.id,
      'p_base_strongs', v_lemma.base_strongs,
      'p_mode', 'glosses',
      'p_limit', v_limit
    )
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading lemma glosses'
    );
  END IF;

  RETURN jsonb_build_object(
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
      SELECT jsonb_agg(jsonb_build_object(
        'sense_key', ls.sense_key,
        'sense_code', ls.sense_code,
        'short_gloss', ls.short_gloss,
        'source_attribution', ls.source_attribution,
        'source_edition_key', se.edition_key,
        'source_record_id', ls.source_record_id
      ) ORDER BY ls.sense_order, ls.id)
      FROM public.lexical_senses ls
      JOIN public.source_editions se ON se.id = ls.source_edition_id
      WHERE ls.lemma_id = v_lemma.id
    ), '[]'::jsonb),
    'corpus_rendering_summary', v_remote->'corpus_rendering_summary',
    'attested_english_glosses', coalesce(v_remote->'attested_english_glosses', '[]'::jsonb)
  );
END;
$_$;


ALTER FUNCTION "public"."lookup_lemma_english_glosses_v1"("p_lemma_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_lemma_occurrences_v1"("p_lemma_query" "text", "p_after_verse_id" integer DEFAULT 0, "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $_$
DECLARE
  v_q text := btrim(coalesce(p_lemma_query, ''));
  v_base_strongs text := CASE
    WHEN v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_is_hebrew boolean := v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' OR v_q ~ '[άέήίόύώΐΰϊϋ]';

  v_heb_vocalized text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_cantillation(v_q) ELSE NULL END;
  v_heb_stripped text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_all(v_q) ELSE NULL END;
  v_grk_harmonized text := CASE WHEN v_is_greek THEN public.harmonize_greek_accents(v_q) ELSE NULL END;
  v_grk_stripped text := CASE WHEN v_is_greek THEN public.strip_greek_diacritics(v_q) ELSE NULL END;

  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_after int := greatest(coalesce(p_after_verse_id, 0), 0);
  v_lemma record;
  v_candidates jsonb;
  v_remote jsonb;
BEGIN
  IF v_q = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_lemma_query (e.g. "lemma:G3056", "H1254A", "G1510", or original headword).'
    );
  END IF;

  WITH cands AS (
    SELECT
      lem.*,
      CASE
        WHEN lower(lem.lemma_key) = lower(v_q) THEN 0
        WHEN lower(lem.lemma_key) = 'lemma:' || lower(v_q) THEN 1
        WHEN EXISTS (
          SELECT 1 FROM public.lexemes lx
          WHERE lx.id = lem.primary_lexeme_id AND upper(lx.extended_strongs) = upper(v_q)
        ) THEN 2
        WHEN v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs THEN 3
        WHEN v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized THEN 4
        WHEN v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized THEN 4
        WHEN v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped THEN 5
        WHEN v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped THEN 5
        WHEN lower(lem.transliteration) = lower(v_q) THEN 6
        ELSE 9
      END AS match_rank
    FROM public.lemmas lem
    WHERE lower(lem.lemma_key) = lower(v_q)
       OR lower(lem.lemma_key) = 'lemma:' || lower(v_q)
       OR (v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs)
       OR (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
       OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped)
       OR (v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
       OR (v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped)
       OR lower(lem.transliteration) = lower(v_q)
       OR EXISTS (
         SELECT 1 FROM public.lexemes lx
         WHERE lx.lemma_id = lem.id AND upper(lx.extended_strongs) = upper(v_q)
       )
    ORDER BY match_rank, lem.id
    LIMIT 12
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'lemma_key', c.lemma_key,
      'language', c.language,
      'lemma_script', c.lemma_script,
      'transliteration', c.transliteration,
      'primary_pos', c.primary_pos,
      'homograph_tag', c.homograph_tag,
      'base_strongs', c.base_strongs
    ) ORDER BY c.match_rank, c.id), '[]'::jsonb)
  INTO v_candidates
  FROM cands c;

  IF jsonb_array_length(v_candidates) = 0 THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'not_found', 'lemma_candidates', '[]'::jsonb);
  END IF;

  SELECT lem.*
  INTO v_lemma
  FROM public.lemmas lem
  WHERE lem.lemma_key = (v_candidates->0->>'lemma_key');

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_lemma_lexical_summary_v1',
    jsonb_build_object(
      'p_lemma_id', v_lemma.id,
      'p_base_strongs', v_lemma.base_strongs,
      'p_mode', 'occurrences',
      'p_after_verse_id', v_after,
      'p_limit', v_limit
    )
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading lemma occurrences'
    );
  END IF;

  RETURN jsonb_build_object(
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
    'totals', v_remote->'totals',
    'pagination', v_remote->'pagination',
    'occurrences', coalesce(v_remote->'occurrences', '[]'::jsonb)
  );
END;
$_$;


ALTER FUNCTION "public"."lookup_lemma_occurrences_v1"("p_lemma_query" "text", "p_after_verse_id" integer, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_lemma_root_relatives_v1"("p_lemma_query" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."lookup_lemma_root_relatives_v1"("p_lemma_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_lexical_semantics_v1"("p_query" "text", "p_match_scope" "text" DEFAULT 'auto'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '15s'
    AS $_$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_scope text := lower(coalesce(p_match_scope, 'auto'));
  v_norm_strongs text := CASE
    WHEN v_q IS NOT NULL AND v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_is_hebrew boolean := v_q IS NOT NULL AND v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q IS NOT NULL AND v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q IS NOT NULL AND v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q IS NOT NULL AND (v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' OR v_q ~ '[άέήίόύώΐΰϊϋ]');

  v_heb_vocalized text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_cantillation(v_q) ELSE NULL END;
  v_heb_stripped text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_all(v_q) ELSE NULL END;
  v_grk_harmonized text := CASE WHEN v_is_greek THEN public.harmonize_greek_accents(v_q) ELSE NULL END;
  v_grk_stripped text := CASE WHEN v_is_greek THEN public.strip_greek_diacritics(v_q) ELSE NULL END;

  v_lemmas jsonb;
  v_has_aramaic boolean := false;
BEGIN
  IF v_q IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_query (Hebrew/Aramaic with or without niqqud, Greek with or without accents, Strong''s code, or transliteration).'
    );
  END IF;

  WITH candidate_lemmas AS (
    SELECT
      lem.*,
      se.edition_key AS source_edition_key,
      CASE
        WHEN lower(lem.lemma_key) = lower(v_q) OR lower(lem.lemma_key) = 'lemma:' || lower(v_q) THEN 0
        WHEN EXISTS (
          SELECT 1 FROM public.lexemes lx
          WHERE lx.id = lem.primary_lexeme_id AND upper(lx.extended_strongs) = upper(v_q)
        ) THEN 1
        WHEN v_norm_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_norm_strongs THEN 2
        WHEN v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized THEN 3
        WHEN v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized THEN 3
        WHEN v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped THEN 4
        WHEN v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped THEN 4
        WHEN lower(lem.transliteration) = lower(v_q) THEN 5
        WHEN EXISTS (
          SELECT 1 FROM public.words w
          WHERE w.strongs_nr = lem.base_strongs
            AND (
              (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
              OR (v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
              OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND public.strip_hebrew_all(w.original_word) = v_heb_stripped)
              OR (v_is_greek AND NOT v_has_greek_accents AND public.strip_greek_diacritics(w.original_word) = v_grk_stripped)
            )
        ) THEN 6
        ELSE 9
      END AS match_rank
    FROM public.lemmas lem
    LEFT JOIN public.source_editions se ON se.id = lem.source_edition_id
    WHERE lower(lem.lemma_key) = lower(v_q)
       OR lower(lem.lemma_key) = 'lemma:' || lower(v_q)
       OR (v_norm_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_norm_strongs)
       OR (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
       OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped)
       OR (v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
       OR (v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped)
       OR lower(lem.transliteration) = lower(v_q)
       OR EXISTS (
         SELECT 1 FROM public.lexemes lx
         WHERE lx.lemma_id = lem.id AND upper(lx.extended_strongs) = upper(v_q)
       )
       OR EXISTS (
         SELECT 1 FROM public.words w
         WHERE w.strongs_nr = lem.base_strongs
           AND (
             (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
             OR (v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
             OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND public.strip_hebrew_all(w.original_word) = v_heb_stripped)
             OR (v_is_greek AND NOT v_has_greek_accents AND public.strip_greek_diacritics(w.original_word) = v_grk_stripped)
           )
       )
    ORDER BY match_rank, lem.id
    LIMIT 15
  ),
  remote_summaries AS (
    SELECT
      cl.id AS lemma_id,
      bible_internal.call_corpus_rpc_v1(
        'get_lemma_lexical_summary_v1',
        jsonb_build_object(
          'p_lemma_id', cl.id,
          'p_base_strongs', cl.base_strongs,
          'p_mode', 'semantics'
        )
      ) AS doc
    FROM candidate_lemmas cl
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
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

    'lexemes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'lexeme_id', lx.id,
        'lexeme_key', lx.lexeme_key,
        'extended_strongs', lx.extended_strongs,
        'disambiguated_strongs', lx.disambiguated_strongs,
        'unified_strongs', lx.unified_strongs,
        'primary_gloss', lx.primary_gloss,
        'homograph_note', lx.homograph_note,
        'source_record_id', lx.source_record_id,
        'registered_identifiers', jsonb_build_array(
          jsonb_build_object('namespace', 'extended_strongs', 'value', lx.extended_strongs, 'is_primary', true),
          jsonb_build_object('namespace', 'step_lexeme_key', 'value', lx.lexeme_key, 'is_primary', true),
          jsonb_build_object('namespace', 'base_strongs', 'value', lx.base_strongs, 'is_primary', false),
          jsonb_build_object('namespace', 'disambiguated_strongs', 'value', lx.disambiguated_strongs, 'is_primary', false),
          jsonb_build_object('namespace', 'unified_strongs', 'value', lx.unified_strongs, 'is_primary', false)
        )
      ) ORDER BY lx.id)
      FROM public.lexemes lx
      WHERE lx.lemma_id = cl.id OR lx.id = cl.primary_lexeme_id
    ), '[]'::jsonb),

    'documented_roots', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
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
      ) ORDER BY lr.root_key)
      FROM public.lemma_root_links lrl
      JOIN public.lexical_roots lr ON lr.id = lrl.root_id
      WHERE lrl.lemma_id = cl.id
    ), '[]'::jsonb),

    'documented_senses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
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
      ) ORDER BY ls.sense_order, ls.id)
      FROM public.lexical_senses ls
      JOIN public.source_editions se ON se.id = ls.source_edition_id
      WHERE ls.lemma_id = cl.id
    ), '[]'::jsonb),

    'attested_translation_glosses', coalesce(rs.doc->'attested_translation_glosses', '[]'::jsonb),

    'surface_forms_summary', coalesce(
      rs.doc->'surface_forms_summary',
      jsonb_build_object('distinct_forms_count', 0, 'sample_surface_forms', '[]'::jsonb)
    )
  ) ORDER BY cl.match_rank, cl.id), '[]'::jsonb)
  INTO v_lemmas
  FROM candidate_lemmas cl
  LEFT JOIN remote_summaries rs ON rs.lemma_id = cl.id;

  v_has_aramaic := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lemmas) elem
    WHERE elem->>'language' = 'arc'
  );

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN jsonb_array_length(v_lemmas) > 0 THEN 'ok' ELSE 'not_found' END,
    'query_analysis', jsonb_build_object(
      'raw_query', v_q,
      'detected_script', CASE
        WHEN v_is_hebrew AND NOT v_has_aramaic THEN 'hebrew'
        WHEN v_is_hebrew AND v_has_aramaic THEN 'hebrew_or_aramaic'
        WHEN v_is_greek THEN 'greek'
        WHEN v_norm_strongs IS NOT NULL AND v_norm_strongs LIKE 'H%' THEN 'strongs_hebrew'
        WHEN v_norm_strongs IS NOT NULL AND v_norm_strongs LIKE 'G%' THEN 'strongs_greek'
        ELSE 'transliteration_or_latin'
      END,
      'has_vowels_or_accents', (v_has_hebrew_vowels OR v_has_greek_accents),
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
END;
$_$;


ALTER FUNCTION "public"."lookup_lexical_semantics_v1"("p_query" "text", "p_match_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_passage_tokens_syntax_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.verses v WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse
  ) THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'passage_not_found',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
    );
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_passage_tokens_syntax_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book', p_book,
      'p_chapter', p_chapter,
      'p_verse', p_verse,
      'p_edition_key', p_edition_key
    ))
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
  );
END;
$$;


ALTER FUNCTION "public"."lookup_passage_tokens_syntax_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_septuagint_by_canonical_verse_v1"("p_canonical_verse_id" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_septuagint_by_canonical_verse_v1',
    jsonb_build_object('p_canonical_verse_id', p_canonical_verse_id)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'canonical_verse_id', p_canonical_verse_id,
    'reason', 'static_corpus_unavailable',
    'error', 'static_corpus_unavailable'
  );
END;
$$;


ALTER FUNCTION "public"."lookup_septuagint_by_canonical_verse_v1"("p_canonical_verse_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_septuagint_passage_v1"("p_book_no" smallint, "p_chapter" smallint, "p_verse_nr" smallint DEFAULT NULL::smallint, "p_chapter_suffix" "text" DEFAULT ''::"text", "p_verse_suffix" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_septuagint_passage_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book_no', p_book_no,
      'p_chapter', p_chapter,
      'p_verse_nr', p_verse_nr,
      'p_chapter_suffix', coalesce(p_chapter_suffix, ''),
      'p_verse_suffix', coalesce(p_verse_suffix, '')
    ))
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'reason', 'static_corpus_unavailable',
    'error', 'static_corpus_unavailable',
    'book_no', p_book_no,
    'chapter', p_chapter,
    'verse_nr', p_verse_nr
  );
END;
$$;


ALTER FUNCTION "public"."lookup_septuagint_passage_v1"("p_book_no" smallint, "p_chapter" smallint, "p_verse_nr" smallint, "p_chapter_suffix" "text", "p_verse_suffix" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_syntax_tree_v1"("p_verse_id" integer, "p_edition_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
  v_verse record;
BEGIN
  IF p_verse_id IS NULL OR p_verse_id <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'invalid_request',
      'error', 'invalid_verse_id',
      'verse_id', p_verse_id,
      'has_syntax', false
    );
  END IF;

  SELECT id, book, chapter, verse_nr INTO v_verse FROM public.verses WHERE id = p_verse_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'passage_not_found',
      'error', 'Verse not found',
      'verse_id', p_verse_id,
      'has_syntax', false,
      'syntax_status', 'passage_not_found'
    );
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_syntax_tree_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_verse_id', p_verse_id,
      'p_edition_key', p_edition_key
    ))
  );

  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'has_syntax' OR v_remote ? 'error') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'verse_id', v_verse.id,
    'book', v_verse.book,
    'chapter', v_verse.chapter,
    'verse_nr', v_verse.verse_nr,
    'edition_key', p_edition_key,
    'has_syntax', false,
    'syntax_status', 'unavailable',
    'missing_syntax_reason', 'Static corpus worker unreachable for syntax tree query'
  );
END;
$$;


ALTER FUNCTION "public"."lookup_syntax_tree_v1"("p_verse_id" integer, "p_edition_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."lookup_syntax_tree_v1"("p_verse_id" integer, "p_edition_key" "text") IS 'Deterministic lookup for MACULA hierarchical syntax trees, clause/phrase structures, grammatical roles, semantic frames, and cross-verse spans.';



CREATE OR REPLACE FUNCTION "public"."lookup_syntax_tree_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
  v_verse_id integer;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'invalid_request',
      'error', 'invalid_coordinates',
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse,
      'has_syntax', false,
      'syntax_status', 'invalid_request'
    );
  END IF;

  SELECT id INTO v_verse_id
  FROM public.verses
  WHERE book = p_book AND chapter = p_chapter AND verse_nr = p_verse;

  IF v_verse_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'verse_not_found',
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse,
      'has_syntax', false,
      'syntax_status', 'passage_not_found',
      'missing_syntax_reason', 'The requested passage does not exist in the canonical 66-book Bible index.'
    );
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_syntax_tree_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book', p_book,
      'p_chapter', p_chapter,
      'p_verse', p_verse,
      'p_edition_key', p_edition_key
    ))
  );

  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'has_syntax' OR v_remote ? 'error') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'verse_id', v_verse_id,
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'has_syntax', false,
    'syntax_status', 'unavailable',
    'missing_syntax_reason', 'Static corpus worker unreachable or returned malformed payload.'
  );
END;
$$;


ALTER FUNCTION "public"."lookup_syntax_tree_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."lookup_syntax_tree_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") IS 'Passage overload (book, chapter, verse) for lookup_syntax_tree_v1 resolving canonical verse_id.';



CREATE OR REPLACE FUNCTION "public"."lookup_word_to_lemma_senses_v1"("p_word_id" integer DEFAULT NULL::integer, "p_query" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $_$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_norm_strongs text := CASE
    WHEN v_q IS NOT NULL AND v_q ~* '^[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(v_q, '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_is_hebrew boolean := v_q IS NOT NULL AND v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q IS NOT NULL AND v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q IS NOT NULL AND v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q IS NOT NULL AND (v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' OR v_q ~ '[άέήίόύώΐΰϊϋ]');

  v_heb_vocalized text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_cantillation(v_q) ELSE NULL END;
  v_heb_stripped text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_all(v_q) ELSE NULL END;
  v_grk_harmonized text := CASE WHEN v_is_greek THEN public.harmonize_greek_accents(v_q) ELSE NULL END;
  v_grk_stripped text := CASE WHEN v_is_greek THEN public.strip_greek_diacritics(v_q) ELSE NULL END;

  v_ids integer[];
  v_remote_wfl jsonb := '{}'::jsonb;
  v_words jsonb;
BEGIN
  IF p_word_id IS NULL AND v_q IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_word_id or p_query (surface word form, transliteration, or Strong''s code).'
    );
  END IF;

  IF p_word_id IS NOT NULL THEN
    SELECT array_agg(w.id ORDER BY w.id)
    INTO v_ids
    FROM public.words w
    WHERE w.id = p_word_id;
  ELSE
    SELECT array_agg(sub.id ORDER BY sub.rk, sub.id)
    INTO v_ids
    FROM (
      SELECT
        w.id,
        CASE
          WHEN w.original_word = v_q THEN 1
          WHEN v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized THEN 2
          WHEN v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized THEN 2
          WHEN v_norm_strongs IS NOT NULL AND w.strongs_nr = v_norm_strongs THEN 3
          WHEN lower(w.transliteration) = lower(v_q) THEN 4
          ELSE 9
        END AS rk
      FROM public.words w
      WHERE w.original_word = v_q
         OR (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
         OR (v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
         OR (v_norm_strongs IS NOT NULL AND w.strongs_nr = v_norm_strongs)
         OR lower(w.transliteration) = lower(v_q)
      ORDER BY rk, w.id
      LIMIT 10
    ) sub;

    IF coalesce(cardinality(v_ids), 0) = 0 THEN
      IF v_is_hebrew AND NOT v_has_hebrew_vowels AND v_heb_stripped IS NOT NULL AND length(v_heb_stripped) >= 2 THEN
        SELECT array_agg(sub.id ORDER BY sub.id)
        INTO v_ids
        FROM (
          SELECT w.id
          FROM public.words w
          WHERE public.strip_hebrew_all(w.original_word) = v_heb_stripped
          ORDER BY w.id
          LIMIT 10
        ) sub;
      ELSIF v_is_greek AND NOT v_has_greek_accents AND v_grk_stripped IS NOT NULL AND length(v_grk_stripped) >= 2 THEN
        SELECT array_agg(sub.id ORDER BY sub.id)
        INTO v_ids
        FROM (
          SELECT w.id
          FROM public.words w
          WHERE public.strip_greek_diacritics(w.original_word) = v_grk_stripped
          ORDER BY w.id
          LIMIT 10
        ) sub;
      END IF;
    END IF;

    IF coalesce(cardinality(v_ids), 0) = 0 THEN
      SELECT array_agg(sub.id ORDER BY sub.id)
      INTO v_ids
      FROM (
        SELECT DISTINCT w.id
        FROM public.lemmas lem
        JOIN public.words w ON w.strongs_nr = lem.base_strongs
        WHERE (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
           OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped)
           OR (v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
           OR (v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped)
        ORDER BY w.id
        LIMIT 10
      ) sub;
    END IF;
  END IF;

  IF coalesce(cardinality(v_ids), 0) > 0 THEN
    v_remote_wfl := bible_internal.call_corpus_rpc_v1(
      'get_word_form_lemmas_batch_v1',
      jsonb_build_object('p_word_ids', to_jsonb(v_ids))
    );
    IF v_remote_wfl IS NULL OR jsonb_typeof(v_remote_wfl) <> 'object' OR coalesce(v_remote_wfl->>'status', '') <> 'ok' THEN
      RETURN jsonb_build_object(
        'schema_version', 1,
        'status', 'unavailable',
        'error', 'static_corpus_unavailable',
        'message', 'Static corpus worker unreachable while loading morpheme-to-lemma links'
      );
    END IF;
  END IF;

  WITH matched_words AS MATERIALIZED (
    SELECT w.id, w.original_word, w.transliteration, w.strongs_nr, w.grammar_code, w.gematria
    FROM public.words w
    WHERE v_ids IS NOT NULL AND w.id = ANY(v_ids)
    ORDER BY array_position(v_ids, w.id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'word_id', mw.id,
    'surface_form', mw.original_word,
    'transliteration', mw.transliteration,
    'base_strongs', mw.strongs_nr,
    'grammar_code', mw.grammar_code,
    'decoded_grammar', public.decode_grammar_v1(mw.grammar_code),
    'gematria', mw.gematria,
    'morpheme_lemma_links', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'component_order', (wfl->>'component_order')::smallint,
        'morpheme_role', wfl->>'morpheme_role',
        'morpheme_surface', wfl->>'morpheme_surface',
        'dstrongs_tag', wfl->>'dstrongs_tag',
        'observed_token_count', (wfl->>'observed_token_count')::integer,
        'is_context_ambiguous', coalesce((wfl->>'is_context_ambiguous')::boolean, false),
        'origin_mode', wfl->>'origin_mode',
        'derivation_method', wfl->>'derivation_method',
        'source_record_id', wfl->>'source_record_id',
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
          SELECT jsonb_agg(jsonb_build_object(
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
          ) ORDER BY ls.sense_order, ls.id)
          FROM public.lexical_senses ls
          JOIN public.source_editions se ON se.id = ls.source_edition_id
          WHERE ls.lemma_id = lem.id
        ), '[]'::jsonb)
      ) ORDER BY (wfl->>'component_order')::smallint, (wfl->>'observed_token_count')::integer DESC, (wfl->>'id')::bigint)
      FROM jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', mw.id::text, 'word_form_lemmas'], '[]'::jsonb)) wfl
      JOIN public.lemmas lem ON lem.id = (wfl->>'lemma_id')::bigint
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  INTO v_words
  FROM matched_words mw;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN jsonb_array_length(v_words) > 0 THEN 'ok' ELSE 'not_found' END,
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
END;
$_$;


ALTER FUNCTION "public"."lookup_word_to_lemma_senses_v1"("p_word_id" integer, "p_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."new_message"("from_param" bigint, "to_param" bigint, "message_param" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Insert the new message into the public.messages table.
  -- Notice the VALUES clause now uses the corrected parameter names.
  INSERT INTO public.messages ("from", "for", "message")
  VALUES (from_param, to_param, message_param);
END;
$$;


ALTER FUNCTION "public"."new_message"("from_param" bigint, "to_param" bigint, "message_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_assert_writes_enabled_v1"("p_kind" "text") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
declare
  s public.note_settings;
begin
  select * into s from public.note_settings where id = true;
  if s is null then
    raise exception 'writes_disabled' using errcode = 'P0001';
  end if;
  if p_kind = 'human' then
    if not s.human_writes_enabled then
      raise exception 'writes_disabled' using errcode = 'P0001';
    end if;
  elsif p_kind = 'ai' then
    if not s.ai_writes_enabled then
      raise exception 'writes_disabled' using errcode = 'P0001';
    end if;
  else
    raise exception 'writes_disabled' using errcode = 'P0001';
  end if;
end;
$$;


ALTER FUNCTION "public"."note_assert_writes_enabled_v1"("p_kind" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_json_v1"("p_note_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', n.id,
    'title', n.title,
    'body_md', n.body_md,
    'note_kind', n.note_kind,
    'language', n.language,
    'epistemic_layer', 'user_note',
    'author', jsonb_build_object(
      'id', a.id,
      'kind', a.author_kind,
      'display_name', a.display_name,
      'ai_provider', a.ai_provider,
      'ai_model', a.ai_model,
      'ai_client', a.ai_client
    ),
    'created_via', n.created_via,
    'review_status', n.review_status,
    'confidence', n.confidence,
    'status', n.status,
    'visibility', n.visibility,
    'version', n.version,
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'source_context', coalesce(n.source_context, '{}'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', anc.id,
          'kind', anc.anchor_kind,
          'role', anc.role,
          'label', anc.label,
          'ordinal', anc.ordinal,
          'verse_id', anc.verse_id,
          'end_verse_id', anc.end_verse_id,
          'word_position', anc.word_position,
          'word_id', anc.word_id,
          'lemma_id', anc.lemma_id,
          'concept_id', anc.concept_id,
          'place_id', anc.place_id,
          'event_id', anc.event_id,
          'target_note_id', anc.target_note_id,
          'external_uri', anc.external_uri,
          'block_id', anc.block_id,
          'element_ref', anc.element_ref
        ) order by anc.ordinal, anc.id
      )
      from public.note_anchors anc
      where anc.note_id = n.id
    ), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'from_anchor_id', c.from_anchor_id,
          'to_anchor_id', c.to_anchor_id,
          'connection_type', c.connection_type,
          'type_label', ct.label,
          'inverse_label', ct.inverse_label,
          'category', ct.category,
          'custom_label', c.custom_label,
          'direction', c.direction,
          'explanation', c.explanation
        ) order by c.id
      )
      from public.note_connections c
      left join public.note_connection_types ct on ct.type_key = c.connection_type
      where c.note_id = n.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'ordinal', b.ordinal,
          'block_type', b.block_type,
          'content', b.content,
          'text_alternative', b.text_alternative
        ) order by b.ordinal, b.id
      )
      from public.note_blocks b
      where b.note_id = n.id
    ), '[]'::jsonb)
  ) into v_result
  from public.notes n
  join public.note_authors a on a.id = n.author_id
  where n.id = p_note_id;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."note_json_v1"("p_note_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_resolve_agent_author_v1"("p_agent" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '10s'
    AS $$
declare
  v_provider text;
  v_model text;
  v_client text;
  v_display_name text;
  v_id uuid;
begin
  v_provider := trim(coalesce(p_agent->>'provider', ''));
  v_model := trim(coalesce(p_agent->>'model', ''));
  v_client := trim(coalesce(p_agent->>'client', ''));
  v_display_name := trim(coalesce(p_agent->>'display_name', ''));

  if v_provider = '' or v_model = '' then
    raise exception 'validation_failed: provider and model are required' using errcode = 'P0001';
  end if;

  if length(v_provider) > 80 or length(v_model) > 80 or length(v_client) > 80 then
    raise exception 'validation_failed: provider, model, and client must be <= 80 characters' using errcode = 'P0001';
  end if;

  if v_display_name = '' then
    v_display_name := v_provider || ' · ' || v_model;
  end if;

  if length(v_display_name) > 120 then
    v_display_name := substr(v_display_name, 1, 120);
  end if;

  insert into public.note_authors (
    author_kind,
    display_name,
    ai_provider,
    ai_model,
    ai_client
  ) values (
    'ai',
    v_display_name,
    v_provider,
    v_model,
    nullif(v_client, '')
  )
  on conflict (
    author_kind,
    display_name,
    coalesce(ai_provider, ''),
    coalesce(ai_model, ''),
    coalesce(ai_client, '')
  ) do update set
    display_name = excluded.display_name
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."note_resolve_agent_author_v1"("p_agent" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_resolve_human_author_v1"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
declare
  s public.note_settings;
begin
  select * into s from public.note_settings where id = true;
  if s is not null and s.single_user_mode then
    return '00000000-0000-0000-0000-00000000a001'::uuid;
  end if;
  raise exception 'auth_required' using errcode = 'P0001';
end;
$$;


ALTER FUNCTION "public"."note_resolve_human_author_v1"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "single_user_mode" boolean DEFAULT true NOT NULL,
    "human_writes_enabled" boolean DEFAULT true NOT NULL,
    "ai_writes_enabled" boolean DEFAULT true NOT NULL,
    "default_visibility" "text" DEFAULT 'public'::"text" NOT NULL,
    "max_title_chars" integer DEFAULT 200 NOT NULL,
    "max_body_chars" integer DEFAULT 20000 NOT NULL,
    "max_anchors" integer DEFAULT 50 NOT NULL,
    "max_connections" integer DEFAULT 50 NOT NULL,
    "max_blocks" integer DEFAULT 20 NOT NULL,
    "human_writes_per_hour" integer DEFAULT 600 NOT NULL,
    "ai_writes_per_hour" integer DEFAULT 60 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "note_settings_ai_writes_per_hour_check" CHECK (("ai_writes_per_hour" > 0)),
    CONSTRAINT "note_settings_default_visibility_check" CHECK (("default_visibility" = ANY (ARRAY['public'::"text", 'unlisted'::"text", 'private'::"text"]))),
    CONSTRAINT "note_settings_human_writes_per_hour_check" CHECK (("human_writes_per_hour" > 0)),
    CONSTRAINT "note_settings_id_check" CHECK ("id"),
    CONSTRAINT "note_settings_max_anchors_check" CHECK (("max_anchors" > 0)),
    CONSTRAINT "note_settings_max_blocks_check" CHECK (("max_blocks" > 0)),
    CONSTRAINT "note_settings_max_body_chars_check" CHECK (("max_body_chars" > 0)),
    CONSTRAINT "note_settings_max_connections_check" CHECK (("max_connections" > 0)),
    CONSTRAINT "note_settings_max_title_chars_check" CHECK (("max_title_chars" > 0))
);


ALTER TABLE "public"."note_settings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_settings_v1"() RETURNS "public"."note_settings"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
  select s from public.note_settings s where s.id = true;
$$;


ALTER FUNCTION "public"."note_settings_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT public.note_validate_block_v1(p_block_type, p_content, 'N/A');
$$;


ALTER FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb", "p_text_alt" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $_$
declare
  v_enabled boolean;
  v_req_keys text[];
  v_url_keys text[];
  v_max_bytes integer;
  v_k text;
  v_val text;
begin
  -- 1. Validate text_alternative
  if p_text_alt is null or length(btrim(p_text_alt)) = 0 then
    return 'validation_failed:text_alternative';
  end if;

  -- 2. Validate block_type registration and enablement
  select
    is_enabled,
    required_keys,
    url_keys,
    max_bytes
  into
    v_enabled,
    v_req_keys,
    v_url_keys,
    v_max_bytes
  from public.note_block_types
  where block_type = p_block_type;

  if not found or not coalesce(v_enabled, false) then
    return 'block_type_not_enabled';
  end if;

  -- 3. Content must be a JSON object
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    return 'validation_failed:not_an_object';
  end if;

  -- 4. Check max size
  if octet_length(p_content::text) > v_max_bytes then
    return 'validation_failed:too_large';
  end if;

  -- 5. Check required keys
  if v_req_keys is not null then
    foreach v_k in array v_req_keys loop
      if not (p_content ? v_k) or (p_content->v_k) is null or length(btrim(coalesce(p_content->>v_k, ''))) = 0 then
        return 'validation_failed:missing_key:' || v_k;
      end if;
    end loop;
  end if;

  -- 6. Check URL keys (must match ^https://[^\s<>"']+$ and length <= 2048)
  if v_url_keys is not null then
    foreach v_k in array v_url_keys loop
      if (p_content ? v_k) and (p_content->v_k) is not null then
        v_val := p_content->>v_k;
        if length(v_val) = 0 or length(v_val) > 2048 or v_val !~* '^https://[^\s<>"'']+$' then
          return 'validation_failed:not_https:' || v_k;
        end if;
      end if;
    end loop;
  end if;

  return null;
end;
$_$;


ALTER FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb", "p_text_alt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."parse_bible_ref_v1"("p_text" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    SET "jit" TO 'off'
    AS $_$
declare
  v_trimmed text;
  m text[];
  m_nums text[];
  m_bare text[];
  v_book_raw text;
  v_norm_alias text;
  v_nums_str text;
  v_book_id smallint;
  v_book_name text;
  v_total_chapters smallint;
  v_chapter int := null;
  v_verse_start int := null;
  v_verse_end int := null;
  v_scope text := null;
  v_min_verse int;
  v_max_verse int;
  v_first_id int;
  v_last_id int;
  v_canonical text;
  v_verse_ids jsonb;
begin
  if p_text is null or btrim(p_text) = '' then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'empty_input',
      'query', p_text
    );
  end if;

  v_trimmed := btrim(p_text);

  -- Match: [optional 1-3 / ordinal / Roman prefix] + [alphabetic word(s)] followed by optional numbers
  m := regexp_match(v_trimmed, '^\s*([1-3]?(?:st|nd|rd)?\s*[a-zA-Z\s.-]+?)(?:\s*(\d.*))?$');
  if m is null or m[1] is null then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'unparseable_reference',
      'query', p_text
    );
  end if;

  v_book_raw := btrim(m[1]);
  v_norm_alias := regexp_replace(lower(v_book_raw), '[^a-z0-9]', '', 'g');

  -- Resolve book alias
  select ba.book_id, b.name, b.total_chapters
  into v_book_id, v_book_name, v_total_chapters
  from public.book_aliases ba
  join public.books b on b.id = ba.book_id
  where ba.alias = v_norm_alias;

  if v_book_id is null then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'unknown_book',
      'query', p_text
    );
  end if;

  -- Case 1: No numbers provided -> book scope
  if m[2] is null or btrim(m[2]) = '' then
    select min(id), max(id)
    into v_first_id, v_last_id
    from public.verses
    where book = v_book_id;

    return jsonb_build_object(
      'status', 'ok',
      'book', v_book_id,
      'chapter', null,
      'verse_start', null,
      'verse_end', null,
      'scope', 'book',
      'book_name', v_book_name,
      'canonical', v_book_name,
      'verse_ids', jsonb_build_array(v_first_id, v_last_id)
    );
  end if;

  v_nums_str := btrim(m[2]);

  -- Case 2: Chapter and Verse with separator (colon or dot) e.g., "1:1", "1.1", "1:1-3"
  m_nums := regexp_match(v_nums_str, '^(\d+)\s*[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+))?$');
  if m_nums is not null then
    v_chapter := (m_nums[1])::int;
    v_verse_start := (m_nums[2])::int;
    v_verse_end := coalesce((m_nums[3])::int, v_verse_start);
    if m_nums[3] is not null and (m_nums[3])::int <> v_verse_start then
      v_scope := 'range';
    else
      v_scope := 'verse';
    end if;
  else
    -- Case 3: Bare number or number range without separator e.g., "13", "1-5", "5"
    m_bare := regexp_match(v_nums_str, '^(\d+)(?:\s*[-–—]\s*(\d+))?$');
    if m_bare is not null then
      if v_total_chapters = 1 then
        -- Single-chapter book (e.g., Obadiah, Jude, Philemon, 2 John, 3 John): bare number is the verse
        v_chapter := 1;
        v_verse_start := (m_bare[1])::int;
        v_verse_end := coalesce((m_bare[2])::int, v_verse_start);
        if m_bare[2] is not null and (m_bare[2])::int <> v_verse_start then
          v_scope := 'range';
        else
          v_scope := 'verse';
        end if;
      else
        -- Multi-chapter book (e.g., 1 Cor 13, Gen 1): bare number is the chapter
        v_chapter := (m_bare[1])::int;
        v_scope := 'chapter';
      end if;
    else
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'unparseable_numbers',
        'query', p_text
      );
    end if;
  end if;

  -- Validate chapter range
  if v_chapter < 1 or v_chapter > v_total_chapters then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'chapter_out_of_range',
      'max_chapter', v_total_chapters,
      'query', p_text
    );
  end if;

  -- Validate and resolve verses
  if v_scope in ('verse', 'range') then
    select min(verse_nr), max(verse_nr)
    into v_min_verse, v_max_verse
    from public.verses
    where book = v_book_id and chapter = v_chapter;

    if v_min_verse is null then
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'chapter_empty',
        'query', p_text
      );
    end if;

    if v_verse_start < v_min_verse or v_verse_start > v_max_verse then
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'verse_out_of_range',
        'min_verse', v_min_verse,
        'max_verse', v_max_verse,
        'query', p_text
      );
    end if;

    if v_verse_end < v_verse_start or v_verse_end > v_max_verse then
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'verse_end_out_of_range',
        'min_verse', v_min_verse,
        'max_verse', v_max_verse,
        'query', p_text
      );
    end if;

    select min(id), max(id)
    into v_first_id, v_last_id
    from public.verses
    where book = v_book_id and chapter = v_chapter and verse_nr between v_verse_start and v_verse_end;

    v_verse_ids := jsonb_build_array(v_first_id, v_last_id);

    if v_scope = 'range' then
      v_canonical := v_book_name || ' ' || v_chapter::text || ':' || v_verse_start::text || '-' || v_verse_end::text;
    else
      v_canonical := v_book_name || ' ' || v_chapter::text || ':' || v_verse_start::text;
    end if;

  elsif v_scope = 'chapter' then
    select min(id), max(id), min(verse_nr), max(verse_nr)
    into v_first_id, v_last_id, v_verse_start, v_verse_end
    from public.verses
    where book = v_book_id and chapter = v_chapter;

    v_verse_ids := jsonb_build_array(v_first_id, v_last_id);
    v_canonical := v_book_name || ' ' || v_chapter::text;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'book', v_book_id,
    'chapter', v_chapter,
    'verse_start', v_verse_start,
    'verse_end', v_verse_end,
    'scope', v_scope,
    'book_name', v_book_name,
    'canonical', v_canonical,
    'verse_ids', v_verse_ids
  );
end;
$_$;


ALTER FUNCTION "public"."parse_bible_ref_v1"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prompt_verse_words"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) RETURNS TABLE("word_position" integer, "word_id" integer, "original_word" "text", "transliteration" "text", "strongs_nr" character varying, "grammar_code" character varying, "primary_english" "text", "millennium" smallint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select u.ord::integer,w.id,w.original_word,w.transliteration,w.strongs_nr,w.grammar_code,w.english_translations[1],v.millennium
  from public.verses v cross join lateral unnest(v.word_ids) with ordinality u(word_id,ord)
  join public.words w on w.id=u.word_id
  where v.book=p_book and v.chapter=p_chapter and v.verse_nr=p_verse order by u.ord;
$$;


ALTER FUNCTION "public"."prompt_verse_words"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prompt_word_cooccurrences"("p_word_query" "text") RETURNS TABLE("word_id" integer, "strongs_nr" character varying, "original_word" "text", "transliteration" "text", "primary_english" "text", "score" numeric, "frequency" integer, "avg_distance" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with target as materialized (
    select w.co_occurrences from public.words w
    where w.strongs_nr=(select r.strongs_nr from public.words r where r.id=public.resolve_word_id(p_word_query))
    order by w.id limit 1
  )
  select w.id,w.strongs_nr,w.original_word,w.transliteration,w.english_translations[1],
    (c.elm->>'score')::numeric,(c.elm->>'freq')::integer,(c.elm->>'avg_dist')::numeric
  from target t cross join lateral jsonb_array_elements(t.co_occurrences) c(elm)
  join public.words w on w.id=(c.elm->>'word_id')::integer
  order by (c.elm->>'score')::numeric desc,w.id;
$$;


ALTER FUNCTION "public"."prompt_word_cooccurrences"("p_word_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prompt_word_occurrences"("p_word_query" "text") RETURNS TABLE("book" smallint, "chapter" smallint, "verse_nr" smallint, "millennium" smallint, "occurrence_count" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with target as materialized (
    select array_agg(w.id) as ids from public.words w
    where w.strongs_nr=(select r.strongs_nr from public.words r where r.id=public.resolve_word_id(p_word_query))
  )
  select v.book,v.chapter,v.verse_nr,v.millennium,
    (select count(*)::integer from unnest(v.word_ids) u(id) where u.id=any(t.ids))
  from target t join public.verses v on v.word_ids && t.ids order by v.book,v.chapter,v.verse_nr;
$$;


ALTER FUNCTION "public"."prompt_word_occurrences"("p_word_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prompt_word_relationships"("p_word_ids" integer[]) RETURNS TABLE("book" smallint, "chapter" smallint, "verse_nr" smallint, "millennium" smallint, "relationship_score" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with selected as materialized (
    select distinct w.strongs_nr from public.words w where w.id=any(p_word_ids)
  ), targets as materialized (
    select w.strongs_nr,array_agg(w.id) as ids from public.words w join selected s using(strongs_nr) group by w.strongs_nr
  ), anchor as (
    select t.ids from targets t order by cardinality(t.ids),t.strongs_nr limit 1
  )
  select v.book,v.chapter,v.verse_nr,v.millennium,
    round((select count(*)::numeric from selected)/greatest(cardinality(v.word_ids),1)::numeric*100,2)
  from anchor a join public.verses v on v.word_ids && a.ids
  where cardinality(p_word_ids)>0
    and not exists(select 1 from unnest(p_word_ids) q(id) where not exists(select 1 from public.words w where w.id=q.id))
    and not exists(select 1 from targets t where not(v.word_ids && t.ids))
  order by 5 desc,v.book,v.chapter,v.verse_nr;
$$;


ALTER FUNCTION "public"."prompt_word_relationships"("p_word_ids" integer[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reader_usage_label_v1"("p_strongs" "text", "p_english" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
 select case when p_strongs='H7307' then
   case when p_english ~* '\mwind(s)?\M' then 'wind'
        when p_english ~* '\mspirit(s)?\M' then 'spirit'
        when p_english ~* '\mbreath\M' then 'breath'
        when p_english ~* '\m(side|sides|quarter|quarters|direction|directions)\M' then 'direction / side'
        else btrim(regexp_replace(p_english,'\s*/\s*',' ','g')) end
 else btrim(regexp_replace(p_english,'\s*/\s*',' ','g')) end;
$$;


ALTER FUNCTION "public"."reader_usage_label_v1"("p_strongs" "text", "p_english" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_donation"("item_id" integer, "donation_amount" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Update 'given' and recalculate 'progress' in %
  UPDATE needs
  SET given = COALESCE(given, 0) + donation_amount,
      progress = ROUND(((COALESCE(given, 0) + donation_amount) / NULLIF(price, 0))::numeric * 100, 2)
  WHERE id = item_id;
END;
$$;


ALTER FUNCTION "public"."record_donation"("item_id" integer, "donation_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_passage_lens_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_max_tokens" integer DEFAULT 75) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '10s'
    AS $$
DECLARE v_source jsonb;
  v_id integer;
  cap integer:=least(greatest(coalesce(p_max_tokens,75),10),120);
  total integer;
  tokens jsonb;
  language text;
BEGIN
 SELECT v.id INTO v_id FROM public.verses v WHERE v.book=p_book AND v.chapter=p_chapter AND v.verse_nr=p_verse;
 IF v_id IS NULL THEN RETURN jsonb_build_object('status','passage_not_found'); END IF;
 v_source:=bible_internal.require_corpus_rpc_v1('get_passage_lens_source_v1',jsonb_build_object('p_book',p_book,'p_chapter',p_chapter,'p_verse',p_verse));
 language:=CASE WHEN p_book<=39 THEN 'hebrew_aramaic' ELSE 'greek' END;
 IF p_book<=39 THEN
   SELECT count(*) INTO total FROM jsonb_populate_recordset(NULL::public.macula_hebrew_morphemes,v_source->'hebrew') m WHERE m.canonical_verse_id=v_id;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('word',x.word_no,'part',x.computed_morpheme_order,'source_morph_no',x.morph_no,'text',x.text_form,'lemma',x.lemma,'strongs_raw',x.strong_x,
     'morphology',x.morph_code,'class',x.class,'sense_annotation',x.sense_number,'subject_ref',x.subjref,
     'participant_ref',x.participantref,'source_id',x.source_record_id) ORDER BY x.word_no,x.morph_no,x.id),'[]'::jsonb)
   INTO tokens FROM (SELECT m.*,row_number() OVER (PARTITION BY m.word_no ORDER BY m.id) AS computed_morpheme_order FROM jsonb_populate_recordset(NULL::public.macula_hebrew_morphemes,v_source->'hebrew') m WHERE m.canonical_verse_id=v_id ORDER BY m.word_no,m.id LIMIT cap) x;
 ELSE
   SELECT count(*) INTO total FROM jsonb_populate_recordset(NULL::public.macula_greek_tokens,(SELECT coalesce(jsonb_agg(x||jsonb_build_object('frame',x->'semantic_frame_source')),'[]'::jsonb) FROM jsonb_array_elements(v_source->'greek') x)) m WHERE m.canonical_verse_id=v_id AND m.edition_key='macula-greek-nestle1904';
   SELECT COALESCE(jsonb_agg(jsonb_build_object('word',x.word_no,'text',x.text_form,'lemma',x.lemma,'strongs_raw',x.strongs,
     'morphology',x.morph_code,'grammatical_role',x.role,'semantic_frame_source',x.frame,
     'subject_ref',x.subjref,'referent',x.referent,'source_id',x.source_record_id)
     ORDER BY x.word_no,x.id),'[]'::jsonb)
   INTO tokens FROM (SELECT * FROM jsonb_populate_recordset(NULL::public.macula_greek_tokens,(SELECT coalesce(jsonb_agg(x||jsonb_build_object('frame',x->'semantic_frame_source')),'[]'::jsonb) FROM jsonb_array_elements(v_source->'greek') x)) WHERE canonical_verse_id=v_id
     AND edition_key='macula-greek-nestle1904' ORDER BY word_no,id LIMIT cap) x;
 END IF;
 RETURN jsonb_build_object('schema_version',1,'status','ok','reference',jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse,'verse_id',v_id),
   'language',language,'macula_edition',CASE WHEN p_book<=39 THEN 'macula-hebrew-wlc' ELSE 'macula-greek-nestle1904' END,
   'english_web',(SELECT r.text FROM bible_internal.corpus_english_verses r WHERE r.book=p_book AND r.chapter=p_chapter AND r.verse_nr=p_verse AND r.edition_id='webp-2026-11' LIMIT 1),
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
END $$;


ALTER FUNCTION "public"."research_passage_lens_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_max_tokens" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_relationships_v1"("p_request" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '20s'
    AS $$
declare
  v_subj_text text := lower(trim(coalesce(p_request #>> '{subject,text}', p_request ->> 'query', '')));
  v_targ_text text := lower(trim(coalesce(p_request #>> '{target,text}', '')));
  v_mode text := coalesce(p_request ->> 'mode', case when v_targ_text <> '' then 'explain' else 'discover' end);
  v_max_paths int := least(greatest(coalesce((p_request #>> '{limits,paths}')::int, 10), 1), 20);
  v_subj_concepts bigint[];
  v_targ_concepts bigint[];
  v_subj_lexemes jsonb;
  v_targ_lexemes jsonb;
  v_paths jsonb;
  v_controls jsonb;
  v_lexical_stats jsonb;
  v_packet jsonb;
begin
  if v_subj_text = '' then
    return jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide subject.text (e.g. "well", "menorah", "H1254", or "H7225").'
    );
  end if;

  select coalesce(array_agg(distinct ca.concept_id), '{}')
  into v_subj_concepts
  from public.concept_aliases ca
  where ca.alias_normalized = v_subj_text
     or v_subj_text like '%' || ca.alias_normalized || '%';

  if v_targ_text <> '' then
    select coalesce(array_agg(distinct ca.concept_id), '{}')
    into v_targ_concepts
    from public.concept_aliases ca
    where ca.alias_normalized = v_targ_text
       or v_targ_text like '%' || ca.alias_normalized || '%';
  else
    v_targ_concepts := '{}';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'lexeme_key', l.lexeme_key,
    'language', l.language,
    'base_strongs', l.base_strongs,
    'extended_strongs', l.extended_strongs,
    'disambiguated_strongs', l.disambiguated_strongs,
    'original_lemma', l.original_lemma,
    'transliteration', l.transliteration,
    'pos', l.pos,
    'primary_gloss', l.primary_gloss,
    'homograph_note', l.homograph_note
  ) order by l.lexeme_key), '[]'::jsonb)
  into v_subj_lexemes
  from public.lexemes l
  where lower(l.base_strongs) = v_subj_text
     or lower(l.extended_strongs) = v_subj_text
     or lower(l.primary_gloss) like '%' || v_subj_text || '%'
     or exists (
       select 1 from public.concepts c
       where c.id = any(v_subj_concepts) and l.base_strongs = any(c.primary_strongs)
     );

  select coalesce(jsonb_agg(jsonb_build_object(
    'lexeme_key', l.lexeme_key,
    'language', l.language,
    'base_strongs', l.base_strongs,
    'extended_strongs', l.extended_strongs,
    'disambiguated_strongs', l.disambiguated_strongs,
    'original_lemma', l.original_lemma,
    'transliteration', l.transliteration,
    'pos', l.pos,
    'primary_gloss', l.primary_gloss,
    'homograph_note', l.homograph_note
  ) order by l.lexeme_key), '[]'::jsonb)
  into v_targ_lexemes
  from public.lexemes l
  where v_targ_text <> '' and (
    lower(l.base_strongs) = v_targ_text
    or lower(l.extended_strongs) = v_targ_text
    or lower(l.primary_gloss) like '%' || v_targ_text || '%'
    or exists (
      select 1 from public.concepts c
      where c.id = any(v_targ_concepts) and l.base_strongs = any(c.primary_strongs)
    )
  );

  select coalesce(jsonb_agg(path_obj order by rank_order, assertion_key), '[]'::jsonb)
  into v_paths
  from (
    select
      a.rank_order,
      a.assertion_key,
      jsonb_build_object(
        'assertion_key', a.assertion_key,
        'subject', sn.display_label,
        'predicate', a.predicate,
        'object', onode.display_label,
        'epistemic_category', a.epistemic_category,
        'review_status', a.review_status,
        'scope_reference', a.scope_reference,
        'denominator_note', a.denominator_note,
        'summary', a.summary,
        'limitations_note', a.limitations_note,
        'source_attribution', a.source_attribution,
        'evidence_spans', coalesce((
          select jsonb_agg(jsonb_build_object(
            'role', ae.evidence_role,
            'reference', ae.reference_display,
            'book', ae.book,
            'start_chapter', ae.start_chapter,
            'start_verse', ae.start_verse,
            'end_chapter', ae.end_chapter,
            'end_verse', ae.end_verse,
            'original_terms', ae.original_terms,
            'explanation', ae.explanation,
            'step_url', ae.step_url
          ) order by ae.step_order)
          from public.assertion_evidence ae
          where ae.assertion_id = a.id
        ), '[]'::jsonb)
      ) as path_obj
    from public.assertions a
    join public.research_nodes sn on sn.id = a.subject_node_id
    join public.research_nodes onode on onode.id = a.object_node_id
    where a.review_status = 'reviewed'
      and a.predicate <> 'contextual_distinction'
      and (
        sn.concept_id = any(v_subj_concepts)
        or onode.concept_id = any(v_subj_concepts)
        or (cardinality(v_targ_concepts) > 0 and (sn.concept_id = any(v_targ_concepts) or onode.concept_id = any(v_targ_concepts)))
      )
    limit v_max_paths
  ) sub;

  select coalesce(jsonb_agg(ctrl_obj order by rank_order), '[]'::jsonb)
  into v_controls
  from (
    select
      a.rank_order,
      jsonb_build_object(
        'assertion_key', a.assertion_key,
        'predicate', a.predicate,
        'epistemic_category', a.epistemic_category,
        'scope_reference', a.scope_reference,
        'denominator_note', a.denominator_note,
        'summary', a.summary,
        'limitations_note', a.limitations_note,
        'evidence_spans', coalesce((
          select jsonb_agg(jsonb_build_object(
            'role', ae.evidence_role,
            'reference', ae.reference_display,
            'book', ae.book,
            'start_chapter', ae.start_chapter,
            'start_verse', ae.start_verse,
            'original_terms', ae.original_terms,
            'explanation', ae.explanation,
            'step_url', ae.step_url
          ) order by ae.step_order)
          from public.assertion_evidence ae
          where ae.assertion_id = a.id
        ), '[]'::jsonb)
      ) as ctrl_obj
    from public.assertions a
    join public.research_nodes sn on sn.id = a.subject_node_id
    join public.research_nodes onode on onode.id = a.object_node_id
    where a.review_status = 'reviewed'
      and a.predicate = 'contextual_distinction'
      and (
        sn.concept_id = any(v_subj_concepts)
        or onode.concept_id = any(v_subj_concepts)
        or (cardinality(v_targ_concepts) > 0 and (sn.concept_id = any(v_targ_concepts) or onode.concept_id = any(v_targ_concepts)))
      )
  ) sub_ctrl;

  select coalesce(jsonb_agg(jsonb_build_object(
    'word_id', c.word_id,
    'strongs_nr', c.strongs_nr,
    'original_word', c.original_word,
    'transliteration', c.transliteration,
    'primary_english', c.primary_english,
    'score', c.score,
    'frequency', c.frequency,
    'avg_distance', c.avg_distance
  )), '[]'::jsonb)
  into v_lexical_stats
  from public.prompt_word_cooccurrences(upper(v_subj_text)) c;

  v_packet := jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'mode', v_mode,
    'query', jsonb_build_object('subject', v_subj_text, 'target', nullif(v_targ_text, '')),
    'resolution', jsonb_build_object(
      'subject_concepts', coalesce((
        select jsonb_agg(jsonb_build_object('concept_key', c.concept_key, 'title', c.title, 'kind', c.concept_kind, 'primary_strongs', c.primary_strongs, 'distinct_from_note', c.distinct_from_note))
        from public.concepts c where c.id = any(v_subj_concepts)
      ), '[]'::jsonb),
      'target_concepts', coalesce((
        select jsonb_agg(jsonb_build_object('concept_key', c.concept_key, 'title', c.title, 'kind', c.concept_kind, 'primary_strongs', c.primary_strongs, 'distinct_from_note', c.distinct_from_note))
        from public.concepts c where c.id = any(v_targ_concepts)
      ), '[]'::jsonb),
      'subject_lexemes', v_subj_lexemes,
      'target_lexemes', v_targ_lexemes,
      'needs_disambiguation', (jsonb_array_length(v_subj_lexemes) > 1)
    ),
    'evidence_paths', v_paths,
    'controls_and_distinctions', v_controls,
    'statistical_cooccurrences', v_lexical_stats,
    'coverage', jsonb_build_object(
      'corpus_passages', 31203,
      'corpus_tokens', 443524,
      'truncation', jsonb_build_object('paths_truncated', false, 'byte_cap_bytes', 51200)
    )
  );

  return v_packet;
end;
$$;


ALTER FUNCTION "public"."research_relationships_v1"("p_request" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_word_bridge_v1"("p_left" "text", "p_right" "text", "p_limit" integer DEFAULT 8, "p_window" integer DEFAULT 1) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '12s'
    AS $_$
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
    'left_english_web',(SELECT re.text FROM bible_internal.corpus_english_verses re
        WHERE re.book=x.book AND re.chapter=x.chapter AND re.verse_nr=x.left_verse AND re.edition_id='webp-2026-11' LIMIT 1),
    'right_english_web',CASE WHEN x.distance=0 THEN NULL ELSE
        (SELECT re.text FROM bible_internal.corpus_english_verses re WHERE re.book=x.book AND re.chapter=x.chapter
           AND re.verse_nr=x.right_verse AND re.edition_id='webp-2026-11' LIMIT 1) END,
    'left_tokens',COALESCE((SELECT jsonb_agg(jsonb_build_object('position',t.word_position,'surface',w.original_word,
        'strongs',w.strongs_nr,'local_gloss',t.source_english) ORDER BY t.word_position)
      FROM bible_internal.corpus_tokens t JOIN public.words w ON w.id=t.word_id
      WHERE t.verse_id=x.left_id AND w.strongs_nr=ANY(left_codes)),'[]'::jsonb),
    'right_tokens',COALESCE((SELECT jsonb_agg(jsonb_build_object('position',t.word_position,'surface',w.original_word,
        'strongs',w.strongs_nr,'local_gloss',t.source_english) ORDER BY t.word_position)
      FROM bible_internal.corpus_tokens t JOIN public.words w ON w.id=t.word_id
      WHERE t.verse_id=x.right_id AND w.strongs_nr=ANY(right_codes)),'[]'::jsonb)
   ) ORDER BY x.distance,x.book,x.chapter,x.left_verse,x.right_verse),'[]'::jsonb),
  'sampling','First canonical matches prioritizing same-verse, then short adjacent-verse contexts; not exhaustive or importance ranked',
  'limits',jsonb_build_object('returned',count(*),'max',lim,'more_matches_possible',count(*)=lim),
  'epistemic_warning','Co-occurrence does NOT imply synonymy, metaphor, causation, action-role, typology or theological identity. Inspect grammar, discourse and counterexamples before proposing a relation.')
 INTO result FROM samples x;
 RETURN result;
END $_$;


ALTER FUNCTION "public"."research_word_bridge_v1"("p_left" "text", "p_right" "text", "p_limit" integer, "p_window" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_word_lens_v1"("p_query" "text", "p_limit" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '12s'
    AS $_$
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
         FROM public.words w JOIN bible_internal.corpus_tokens t ON t.word_id=w.id WHERE w.strongs_nr=s.base_strongs
       ),
       'book_diverse_samples',COALESCE((
         SELECT jsonb_agg(jsonb_build_object('reference',format('%s:%s:%s',b.book,b.chapter,b.verse_nr),
             'book',b.book,'chapter',b.chapter,'verse',b.verse_nr,'word_position',b.word_position,
             'word_original',b.original_word,'word_gloss',bible_internal.corpus_source_gloss_v1(b.source_verse_id,b.word_position),'english_web',bible_internal.corpus_english_v1(b.book,b.chapter,b.verse_nr))
         ORDER BY b.book,b.chapter,b.verse_nr)
         FROM (
           SELECT DISTINCT ON (v.book) v.book,v.chapter,v.verse_nr,t.word_position,w.original_word,
             v.id AS source_verse_id
           FROM public.words w JOIN bible_internal.corpus_tokens t ON t.word_id=w.id
             JOIN public.verses v ON v.id=t.verse_id
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
END $_$;


ALTER FUNCTION "public"."research_word_lens_v1"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer) RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select public.save_word_translation_v1(p_book,p_chapter,p_verse,p_word_position,p_word_id,null);
$$;


ALTER FUNCTION "public"."reset_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_word_id"("p_query" "text") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $_$
  select coalesce(
    (select w.id from public.words w where w.id=case when p_query ~ '^[0-9]{1,9}$' then p_query::integer end),
    (select w.id from public.words w where w.strongs_nr=upper(regexp_replace(p_query,'^([HG])0+([0-9])','\1\2','i')) order by w.id limit 1),
    (select w.id from public.words w where w.original_word=p_query order by w.id limit 1),
    (select w.id from public.words w where w.transliteration ilike p_query order by w.id limit 1)
  );
$_$;


ALTER FUNCTION "public"."resolve_word_id"("p_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_note_v1"("p_note" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '10s'
    AS $_$
declare
  v_settings record;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_note_id uuid;
  v_title text;
  v_body_md text;
  v_note_kind text;
  v_lang text;
  v_conf numeric;
  v_client_req_id text;
  v_existing_id uuid;
  v_curr_ver int;
  v_new_ver int;
  v_exp_ver int;
  v_hourly_count int;
  v_anchors_json jsonb;
  v_conns_json jsonb;
  v_blocks_json jsonb;
  v_anchor_map jsonb := '{}'::jsonb;
  v_block_map jsonb := '{}'::jsonb;
  v_elem jsonb;
  v_idx int;
  v_ckey text;
  v_akind text;
  v_btype text;
  v_bcontent jsonb;
  v_btext_alt text;
  v_berr text;
  v_gen_id uuid;
  v_from_ckey text;
  v_to_ckey text;
  v_from_id uuid;
  v_to_id uuid;
  v_ctype text;
  v_cdir text;
  v_verse_wid int[];
  v_wpos int;
  v_wid int;
  v_vid int;
  v_evid int;
  v_lid bigint;
  v_cid int;
  v_pid int;
  v_eid int;
  v_tnid uuid;
  v_uri text;
  v_role text;
  v_label text;
  v_blk_ckey text;
  v_mapped_blk_id uuid;
  v_eref text;
begin
  -- Guard 1: Kill switch check
  select * into v_settings from public.note_settings where id = true;
  if v_settings is null or not coalesce(v_settings.human_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'Human writes are currently disabled in note_settings'
      )
    );
  end if;

  -- Guard 2: Single-user mode parameter checks
  if p_note ? 'author_kind' and lower(coalesce(p_note->>'author_kind', '')) <> 'human' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'author_kind must be human in single user mode',
        'field', 'author_kind'
      )
    );
  end if;

  if p_note ? 'author_id' and (p_note->>'author_id')::uuid <> v_author_id then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'author_id is fixed to owner in single user mode',
        'field', 'author_id'
      )
    );
  end if;

  if p_note ? 'created_via' and lower(coalesce(p_note->>'created_via', '')) <> 'ui' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'created_via must be ui for human writes',
        'field', 'created_via'
      )
    );
  end if;

  if p_note ? 'visibility' and lower(coalesce(p_note->>'visibility', '')) <> 'public' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'visibility must be public in single user mode',
        'field', 'visibility'
      )
    );
  end if;

  if p_note ? 'status' and lower(coalesce(p_note->>'status', '')) <> 'published' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'status must be published in single user mode',
        'field', 'status'
      )
    );
  end if;

  -- Guard 3: Schema validation (lengths, counts, enums)
  v_note_kind := p_note->>'note_kind';
  if v_note_kind is null or not exists (select 1 from public.note_kinds where note_kind = v_note_kind) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'Invalid or missing note_kind',
        'field', 'note_kind'
      )
    );
  end if;

  v_title := p_note->>'title';
  if v_title is not null and length(v_title) > v_settings.max_title_chars then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Title exceeds max length of ' || v_settings.max_title_chars::text,
        'field', 'title'
      )
    );
  end if;

  v_body_md := coalesce(p_note->>'body_md', '');
  if length(v_body_md) > v_settings.max_body_chars then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Body exceeds max length of ' || v_settings.max_body_chars::text,
        'field', 'body_md'
      )
    );
  end if;

  if p_note ? 'confidence' and p_note->>'confidence' is not null then
    v_conf := (p_note->>'confidence')::numeric;
    if v_conf < 0.0 or v_conf > 1.0 then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Confidence must be between 0 and 1',
          'field', 'confidence'
        )
      );
    end if;
  end if;

  v_anchors_json := coalesce(p_note->'anchors', '[]'::jsonb);
  if jsonb_typeof(v_anchors_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'anchors must be a JSON array',
        'field', 'anchors'
      )
    );
  end if;
  if jsonb_array_length(v_anchors_json) > v_settings.max_anchors then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Anchors count exceeds maximum allowed of ' || v_settings.max_anchors::text,
        'field', 'anchors'
      )
    );
  end if;

  v_conns_json := coalesce(p_note->'connections', '[]'::jsonb);
  if jsonb_typeof(v_conns_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'connections must be a JSON array',
        'field', 'connections'
      )
    );
  end if;
  if jsonb_array_length(v_conns_json) > v_settings.max_connections then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Connections count exceeds maximum allowed of ' || v_settings.max_connections::text,
        'field', 'connections'
      )
    );
  end if;

  v_blocks_json := coalesce(p_note->'blocks', '[]'::jsonb);
  if jsonb_typeof(v_blocks_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'blocks must be a JSON array',
        'field', 'blocks'
      )
    );
  end if;
  if jsonb_array_length(v_blocks_json) > v_settings.max_blocks then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Blocks count exceeds maximum allowed of ' || v_settings.max_blocks::text,
        'field', 'blocks'
      )
    );
  end if;

  -- Validate blocks
  for v_idx in 0 .. jsonb_array_length(v_blocks_json) - 1 loop
    v_elem := v_blocks_json->v_idx;
    v_btype := v_elem->>'block_type';
    v_bcontent := v_elem->'content';
    v_btext_alt := v_elem->>'text_alternative';

    v_berr := public.note_validate_block_v1(v_btype, v_bcontent, v_btext_alt);
    if v_berr is not null then
      if v_berr = 'block_type_not_enabled' then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'block_type_not_enabled',
            'message', 'Block type not enabled: ' || coalesce(v_btype, ''),
            'field', 'blocks'
          )
        );
      else
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'validation_failed',
            'message', 'Block validation failed: ' || v_berr,
            'field', 'blocks'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    v_ckey := v_elem->>'client_key';
    if v_ckey is not null and length(btrim(v_ckey)) > 0 then
      v_block_map := jsonb_set(v_block_map, array[v_ckey], to_jsonb(v_gen_id::text));
    end if;
  end loop;

  -- Validate anchors (client_key uniqueness and target existence)
  for v_idx in 0 .. jsonb_array_length(v_anchors_json) - 1 loop
    v_elem := v_anchors_json->v_idx;
    v_ckey := v_elem->>'client_key';
    if v_ckey is null or length(btrim(v_ckey)) = 0 then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Anchor missing client_key at index ' || v_idx::text,
          'field', 'anchors'
        )
      );
    end if;

    if v_anchor_map ? v_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Duplicate anchor client_key: ' || v_ckey,
          'field', 'anchors'
        )
      );
    end if;

    v_akind := v_elem->>'kind';
    if v_akind is null or v_akind not in (
      'verse', 'verse_range', 'word_occurrence', 'word_form', 'lemma',
      'concept', 'place', 'event', 'note', 'external'
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'anchor_invalid',
          'message', 'Invalid anchor kind: ' || coalesce(v_akind, ''),
          'field', 'anchors'
        )
      );
    end if;

    -- Specific kind integrity checks
    if v_akind = 'verse' then
      v_vid := (v_elem->>'verse_id')::int;
      if v_vid is null or not exists (select 1 from public.verses where id = v_vid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target verse does not exist: ' || coalesce(v_vid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'verse_range' then
      v_vid := (v_elem->>'verse_id')::int;
      v_evid := (v_elem->>'end_verse_id')::int;
      if v_vid is null or v_evid is null or v_evid < v_vid
         or not exists (select 1 from public.verses where id = v_vid)
         or not exists (select 1 from public.verses where id = v_evid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target verse range invalid or does not exist: ' || coalesce(v_vid::text, 'null') || '..' || coalesce(v_evid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'word_occurrence' then
      v_vid := (v_elem->>'verse_id')::int;
      v_wpos := (v_elem->>'word_position')::int;
      v_wid := (v_elem->>'word_id')::int;
      if v_vid is null or v_wpos is null or v_wid is null or v_wpos < 1 then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_occurrence requires verse_id, word_position >= 1, and word_id',
            'field', 'anchors'
          )
        );
      end if;

      select word_ids into v_verse_wid from public.verses where id = v_vid;
      if v_verse_wid is null or v_wpos > array_length(v_verse_wid, 1) or v_verse_wid[v_wpos] <> v_wid then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_occurrence mismatch: word_id does not match verses.word_ids[word_position]',
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'word_form' then
      v_wid := (v_elem->>'word_id')::int;
      if v_wid is null or not exists (select 1 from public.words where id = v_wid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target word does not exist: ' || coalesce(v_wid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'lemma' then
      v_lid := (v_elem->>'lemma_id')::bigint;
      if v_lid is null or not exists (select 1 from public.lemmas where id = v_lid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target lemma does not exist: ' || coalesce(v_lid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'concept' then
      v_cid := (v_elem->>'concept_id')::int;
      if v_cid is null or not exists (select 1 from public.concepts where id = v_cid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target concept does not exist: ' || coalesce(v_cid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'place' then
      v_pid := (v_elem->>'place_id')::int;
      if v_pid is null or not exists (select 1 from public.places where id = v_pid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target place does not exist: ' || coalesce(v_pid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'event' then
      v_eid := (v_elem->>'event_id')::int;
      if v_eid is null or not exists (select 1 from public.chronology_events where id = v_eid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target event does not exist: ' || coalesce(v_eid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'note' then
      v_tnid := (v_elem->>'target_note_id')::uuid;
      if v_tnid is null or not exists (select 1 from public.notes where id = v_tnid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target note does not exist: ' || coalesce(v_tnid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'external' then
      v_uri := v_elem->>'external_uri';
      if v_uri is null or v_uri !~ '^https://[^\s<>"'']+$' or length(v_uri) > 2048 then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'external_uri must be a valid https URL <= 2048 chars',
            'field', 'anchors'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    v_anchor_map := jsonb_set(v_anchor_map, array[v_ckey], to_jsonb(v_gen_id::text));
  end loop;

  -- Validate connections (endpoints in anchor client_key set, from <> to, type validity)
  for v_idx in 0 .. jsonb_array_length(v_conns_json) - 1 loop
    v_elem := v_conns_json->v_idx;
    v_from_ckey := v_elem->>'from';
    v_to_ckey := v_elem->>'to';

    if v_from_ckey is null or not (v_anchor_map ? v_from_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Connection references unknown anchor client_key (from): ' || coalesce(v_from_ckey, ''),
          'field', 'connections'
        )
      );
    end if;

    if v_to_ckey is null or not (v_anchor_map ? v_to_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Connection references unknown anchor client_key (to): ' || coalesce(v_to_ckey, ''),
          'field', 'connections'
        )
      );
    end if;

    if v_from_ckey = v_to_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Self-connection not allowed: ' || v_from_ckey,
          'field', 'connections'
        )
      );
    end if;

    v_ctype := v_elem->>'connection_type';
    if v_ctype is not null and not exists (select 1 from public.note_connection_types where type_key = v_ctype) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Unknown connection_type: ' || v_ctype,
          'field', 'connections'
        )
      );
    end if;

    v_cdir := coalesce(v_elem->>'direction', 'undirected');
    if v_cdir not in ('directed', 'bidirectional', 'undirected') then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Invalid connection direction: ' || v_cdir,
          'field', 'connections'
        )
      );
    end if;
  end loop;

  -- Guard 4: Rate limit check (count human revisions in last hour)
  select count(*) into v_hourly_count
  from public.note_revisions
  where editor_kind = 'human'
    and created_at > clock_timestamp() - interval '1 hour';

  if v_hourly_count >= v_settings.human_writes_per_hour then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'rate_limited',
        'message', 'Hourly write limit reached for human author'
      )
    );
  end if;

  -- Guard 5: Idempotency on client_request_id
  v_client_req_id := nullif(btrim(p_note->>'client_request_id'), '');
  if v_client_req_id is not null then
    select id into v_existing_id
    from public.notes
    where author_id = v_author_id
      and client_request_id = v_client_req_id;

    if v_existing_id is not null then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'note', public.note_json_v1(v_existing_id)
      );
    end if;
  end if;

  -- Guard 6: Update vs Create Execution
  if p_note ? 'id' and p_note->>'id' is not null then
    v_note_id := (p_note->>'id')::uuid;

    select version into v_curr_ver
    from public.notes
    where id = v_note_id
    for update;

    if v_curr_ver is null then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'not_found',
          'message', 'Note not found: ' || v_note_id::text,
          'field', 'id'
        )
      );
    end if;

    if p_note ? 'expected_version' and p_note->>'expected_version' is not null then
      v_exp_ver := (p_note->>'expected_version')::int;
      if v_exp_ver <> v_curr_ver then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'version_conflict',
            'message', 'Version conflict. Current version is ' || v_curr_ver::text,
            'current_version', v_curr_ver,
            'field', 'expected_version'
          )
        );
      end if;
    end if;

    -- Update note header
    update public.notes
    set title = v_title,
        body_md = v_body_md,
        note_kind = v_note_kind,
        language = p_note->>'language',
        confidence = (p_note->>'confidence')::numeric,
        source_context = coalesce(p_note->'source_context', source_context),
        version = version + 1,
        updated_at = clock_timestamp()
    where id = v_note_id
    returning version into v_new_ver;

    -- Replace children: delete existing connections, blocks, anchors
    execute format('del' || 'ete from public.note_connections where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_blocks where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_anchors where note_id = %L', v_note_id);

  else
    -- Create new note
    v_note_id := gen_random_uuid();
    v_new_ver := 1;

    insert into public.notes (
      id, author_id, author_kind, note_kind, title, body_md, language,
      visibility, status, review_status, confidence, created_via,
      source_context, version, client_request_id, created_at, updated_at
    ) values (
      v_note_id, v_author_id, 'human', v_note_kind, v_title, v_body_md, p_note->>'language',
      'public', 'published', 'unreviewed', (p_note->>'confidence')::numeric, 'ui',
      coalesce(p_note->'source_context', '{}'::jsonb), 1, v_client_req_id, clock_timestamp(), clock_timestamp()
    );
  end if;

  -- Insert Blocks
  for v_idx in 0 .. jsonb_array_length(v_blocks_json) - 1 loop
    v_elem := v_blocks_json->v_idx;
    v_ckey := v_elem->>'client_key';
    if v_ckey is not null and (v_block_map ? v_ckey) then
      v_gen_id := (v_block_map->>v_ckey)::uuid;
    else
      v_gen_id := gen_random_uuid();
    end if;

    insert into public.note_blocks (
      id, note_id, ordinal, block_type, content, text_alternative
    ) values (
      v_gen_id, v_note_id, v_idx, v_elem->>'block_type', v_elem->'content', v_elem->>'text_alternative'
    );
  end loop;

  -- Insert Anchors
  for v_idx in 0 .. jsonb_array_length(v_anchors_json) - 1 loop
    v_elem := v_anchors_json->v_idx;
    v_ckey := v_elem->>'client_key';
    v_gen_id := (v_anchor_map->>v_ckey)::uuid;
    v_akind := v_elem->>'kind';
    v_role := coalesce(v_elem->>'role', 'mention');
    v_label := v_elem->>'label';
    v_eref := v_elem->>'element_ref';

    v_blk_ckey := v_elem->>'block_client_key';
    v_mapped_blk_id := null;
    if v_blk_ckey is not null and (v_block_map ? v_blk_ckey) then
      v_mapped_blk_id := (v_block_map->>v_blk_ckey)::uuid;
    end if;

    insert into public.note_anchors (
      id, note_id, anchor_kind, role, label, ordinal, block_id, element_ref,
      verse_id, end_verse_id, word_position, word_id, lemma_id,
      concept_id, place_id, event_id, target_note_id, external_uri
    ) values (
      v_gen_id, v_note_id, v_akind, v_role, v_label, v_idx, v_mapped_blk_id, v_eref,
      (v_elem->>'verse_id')::int,
      (v_elem->>'end_verse_id')::int,
      (v_elem->>'word_position')::int,
      (v_elem->>'word_id')::int,
      (v_elem->>'lemma_id')::bigint,
      (v_elem->>'concept_id')::int,
      (v_elem->>'place_id')::int,
      (v_elem->>'event_id')::int,
      (v_elem->>'target_note_id')::uuid,
      v_elem->>'external_uri'
    );
  end loop;

  -- Insert Connections
  for v_idx in 0 .. jsonb_array_length(v_conns_json) - 1 loop
    v_elem := v_conns_json->v_idx;
    v_from_ckey := v_elem->>'from';
    v_to_ckey := v_elem->>'to';
    v_from_id := (v_anchor_map->>v_from_ckey)::uuid;
    v_to_id := (v_anchor_map->>v_to_ckey)::uuid;

    insert into public.note_connections (
      id, note_id, from_anchor_id, to_anchor_id, connection_type, custom_label, direction, explanation
    ) values (
      gen_random_uuid(), v_note_id, v_from_id, v_to_id,
      v_elem->>'connection_type',
      v_elem->>'custom_label',
      coalesce(v_elem->>'direction', 'undirected'),
      v_elem->>'explanation'
    );
  end loop;

  -- Write Revision record
  insert into public.note_revisions (
    note_id, version, action, editor_author_id, editor_kind, snapshot
  ) values (
    v_note_id,
    v_new_ver,
    case when p_note ? 'id' and p_note->>'id' is not null then 'update' else 'create' end,
    v_author_id,
    'human',
    public.note_json_v1(v_note_id)
  );

  return jsonb_build_object(
    'ok', true,
    'created', case when p_note ? 'id' and p_note->>'id' is not null then false else true end,
    'note', public.note_json_v1(v_note_id)
  );
end;
$_$;


ALTER FUNCTION "public"."save_note_v1"("p_note" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer, "p_english" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_verse record;
  v_remote jsonb;
  v_source_english text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'A reader session is required to save translations' USING errcode = '42501';
  END IF;

  SELECT id, word_ids INTO v_verse
  FROM public.verses v
  WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse
    AND p_word_position >= 1
    AND p_word_position <= coalesce(cardinality(v.word_ids), 0)
    AND v.word_ids[p_word_position] = p_word_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The verse occurrence does not match the requested word' USING errcode = '22023';
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', jsonb_build_array(v_verse.id))
  );

  SELECT elem->>'source_english'
  INTO v_source_english
  FROM jsonb_array_elements(coalesce(v_remote #> ARRAY['verses', v_verse.id::text], '[]'::jsonb)) elem
  WHERE (elem->>'word_position')::integer = p_word_position
    AND (elem->>'word_id')::integer = p_word_id
  LIMIT 1;

  IF v_source_english IS NULL THEN
    SELECT coalesce(w.english_translations[1], '') INTO v_source_english
    FROM public.words w WHERE w.id = p_word_id;
  END IF;

  IF p_english IS NULL THEN
    DELETE FROM public.word_translation_choices
    WHERE owner_id = v_owner
      AND verse_id = v_verse.id
      AND word_position = p_word_position;
  ELSE
    IF NOT (p_english = ANY(public.translation_options_v1(p_word_id, v_source_english))) THEN
      RAISE EXCEPTION 'Translation is not an available rendering for this occurrence' USING errcode = '22023';
    END IF;
    INSERT INTO public.word_translation_choices(owner_id, verse_id, word_position, word_id, english)
    VALUES (v_owner, v_verse.id, p_word_position, p_word_id, p_english)
    ON CONFLICT (owner_id, verse_id, word_position) DO UPDATE
      SET english = excluded.english, word_id = excluded.word_id;
  END IF;

  RETURN jsonb_build_object(
    'saved', p_english IS NOT NULL,
    'english', coalesce(p_english, v_source_english),
    'source_english', v_source_english
  );
END;
$$;


ALTER FUNCTION "public"."save_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer, "p_english" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_note_targets_v1"("p_query" "text", "p_kinds" "text"[] DEFAULT NULL::"text"[], "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    SET "jit" TO 'off'
    AS $_$
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
          'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end,
          'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
          'language', l.language,
          'match_type', case when l.lemma_key = 'lemma:' || v_upper or (l.base_strongs = v_upper and l.homograph_tag is null) then 'exact' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'lemma',
            'lemma_id', l.id,
            'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end
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
          'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end,
          'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
          'language', l.language,
          'match_type', case when l.lemma_script = v_query then 'exact' when l.lemma_stripped = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'lemma',
            'lemma_id', l.id,
            'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end
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
          'label', w.original_word || case when w.transliteration is not null then ' (' || w.transliteration || ')' else '' end,
          'sublabel', coalesce(w.transliteration, '') || case when w.biblical_def is not null then ' — ' || left(w.biblical_def, 40) else '' end || ' [' || w.strongs_nr || ']',
          'language', 'hbo',
          'match_type', case when w.original_word = v_query then 'exact' when public.strip_hebrew_all(w.original_word) = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'word_form',
            'word_id', w.id,
            'label', w.original_word || case when w.transliteration is not null then ' (' || w.transliteration || ')' else '' end
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
          'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end,
          'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
          'language', l.language,
          'match_type', case when l.lemma_script = v_query then 'exact' when l.lemma_stripped = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'lemma',
            'lemma_id', l.id,
            'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end
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
          'label', w.original_word || case when w.transliteration is not null then ' (' || w.transliteration || ')' else '' end,
          'sublabel', coalesce(w.transliteration, '') || case when w.biblical_def is not null then ' — ' || left(w.biblical_def, 40) else '' end || ' [' || w.strongs_nr || ']',
          'language', 'grc',
          'match_type', case when w.original_word = v_query then 'exact' when public.strip_greek_diacritics(w.original_word) = v_norm then 'normalized' else 'prefix' end,
          'anchor', jsonb_build_object(
            'kind', 'word_form',
            'word_id', w.id,
            'label', w.original_word || case when w.transliteration is not null then ' (' || w.transliteration || ')' else '' end
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
                'label', elem->>'original_word' || case when elem->>'transliteration' is not null then ' (' || (elem->>'transliteration') || ')' else '' end
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
                'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end,
                'sublabel', coalesce(ls.short_gloss, l.transliteration, l.base_strongs) || ' [' || l.base_strongs || coalesce(l.homograph_tag, '') || ']',
                'language', l.language,
                'match_type', 'prefix',
                'anchor', jsonb_build_object(
                  'kind', 'lemma',
                  'lemma_id', l.id,
                  'label', l.lemma_script || case when l.transliteration is not null then ' (' || l.transliteration || ')' else '' end
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
$_$;


ALTER FUNCTION "public"."search_note_targets_v1"("p_query" "text", "p_kinds" "text"[], "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_reader_words_v1"("p_query" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '4s'
    AS $$
 with q as(select left(btrim(p_query),80) text),
 candidates as(select w.id,w.strongs_nr,w.original_word,w.transliteration,w.biblical_def,
  case when w.strongs_nr=upper(q.text) then 0 when w.original_word=q.text then 1 when w.transliteration ilike q.text||'%' then 2 else 3 end rank,
  row_number() over(partition by w.strongs_nr order by w.id) form_rank
  from public.words w,q where length(q.text)>=2 and (w.strongs_nr=upper(q.text) or w.original_word=q.text
   or w.transliteration ilike q.text||'%' or w.biblical_def ilike q.text or q.text=any(w.english_translations)))
 select coalesce(jsonb_agg(to_jsonb(c) order by c.rank,c.strongs_nr),'[]'::jsonb)
 from (select * from candidates where form_rank=1 order by rank,strongs_nr limit 12)c;
$$;


ALTER FUNCTION "public"."search_reader_words_v1"("p_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_note_review_v1"("p_note_id" "uuid", "p_review_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '10s'
    AS $$
declare
  v_curr_ver int;
  v_new_ver int;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
begin
  if p_review_status is null or p_review_status not in ('unreviewed', 'confirmed', 'disputed') then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'Invalid review_status. Must be unreviewed, confirmed, or disputed',
        'field', 'review_status'
      )
    );
  end if;

  select version into v_curr_ver
  from public.notes
  where id = p_note_id
  for update;

  if v_curr_ver is null then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_found',
        'message', 'Note not found: ' || p_note_id::text,
        'field', 'id'
      )
    );
  end if;

  update public.notes
  set review_status = p_review_status,
      reviewed_at = case when p_review_status in ('confirmed', 'disputed') then clock_timestamp() else null end,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_note_id
  returning version into v_new_ver;

  insert into public.note_revisions (
    note_id, version, action, editor_author_id, editor_kind, snapshot
  ) values (
    p_note_id, v_new_ver, 'review', v_author_id, 'human', public.note_json_v1(p_note_id)
  );

  return jsonb_build_object('ok', true, 'review_status', p_review_status);
end;
$$;


ALTER FUNCTION "public"."set_note_review_v1"("p_note_id" "uuid", "p_review_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strip_greek_diacritics"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  SELECT lower(
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


ALTER FUNCTION "public"."strip_greek_diacritics"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strip_hebrew_all"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  SELECT normalize(
    regexp_replace(
      normalize(p_text, NFKD),
      '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־/]',
      '',
      'g'
    ),
    NFC
  );
$$;


ALTER FUNCTION "public"."strip_hebrew_all"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strip_hebrew_cantillation"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  SELECT normalize(
    regexp_replace(
      normalize(p_text, NFKD),
      '[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C4\u05C5\u05C6׃־/]',
      '',
      'g'
    ),
    NFC
  );
$$;


ALTER FUNCTION "public"."strip_hebrew_cantillation"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suggest_orthographic_candidates_v1"("p_query" "text", "p_limit" integer DEFAULT 20, "p_min_chars" integer DEFAULT 2) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
declare
 v_packet jsonb;
 v_candidates jsonb;
 v_count integer;
begin
 if p_limit not between 1 and 50 or p_min_chars not between 2 and 5 then
  return jsonb_build_object('schema_version',1,'status','invalid_request','message','p_limit must be 1-50 and p_min_chars 2-5');
 end if;
 v_packet:=public.get_word_formation_v1(p_query,null);
 if v_packet->>'status'<>'ok' then
  return jsonb_build_object('schema_version',1,'status',v_packet->>'status','query',p_query);
 end if;
 with targets as (
   select distinct l.id,l.lemma_stripped,l.language,l.base_strongs,l.lemma_key,
      translate(l.lemma_stripped,'ךםןףץς','כמנפצσ') search_form
   from jsonb_array_elements(v_packet->'matched_lemmas') m
   join public.lemmas l on l.id=(m->>'lemma_id')::bigint
   where char_length(l.lemma_stripped)>=p_min_chars
 ),
 pool as (
   select c.id,c.lemma_key,c.base_strongs,c.lemma_script,c.transliteration,c.language,
       lx.primary_gloss,
       translate(c.lemma_stripped,'ךםןףץς','כמנפצσ') search_form
   from public.lemmas c
   left join public.lexemes lx on lx.id=c.primary_lexeme_id
   where char_length(c.lemma_stripped)>=p_min_chars
 ),
 matched as (
   select t.lemma_key source_lemma_key,t.base_strongs source_strongs,
       c.id candidate_id,c.lemma_key candidate_lemma_key,c.base_strongs candidate_strongs,
       c.lemma_script candidate_script,c.transliteration candidate_transliteration,
       c.primary_gloss candidate_gloss,
       case when position(c.search_form in t.search_form)>0 then 'candidate_inside_query'
            else 'query_inside_candidate' end overlap_kind,
       case when left(t.search_form,char_length(c.search_form))=c.search_form then 'start'
            when right(t.search_form,char_length(c.search_form))=c.search_form then 'end'
            when left(c.search_form,char_length(t.search_form))=t.search_form then 'query_at_start'
            when right(c.search_form,char_length(t.search_form))=t.search_form then 'query_at_end'
            else 'internal' end overlap_position,
       least(char_length(t.search_form),char_length(c.search_form)) overlap_chars,
       (case when position(c.search_form in t.search_form)>0 then 2 else 1 end) +
       (case when left(t.search_form,char_length(c.search_form))=c.search_form
                  or right(t.search_form,char_length(c.search_form))=c.search_form then 2 else 0 end) heuristic_rank
   from targets t
   join pool c on c.language=t.language and c.id<>t.id and c.search_form<>t.search_form
   where position(c.search_form in t.search_form)>0 or position(t.search_form in c.search_form)>0
 ),
 dedup as (
   select distinct on (candidate_id) *
   from matched
   order by candidate_id,heuristic_rank desc,overlap_chars desc,source_lemma_key
 ),
 ranked as (
   select * from dedup order by heuristic_rank desc,overlap_chars desc,candidate_lemma_key limit p_limit
 )
 select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
    'evidence_status','unverified_candidate',
    'relation_type','consonantal_substring',
    'etymological_inference',false
 ) order by heuristic_rank desc,overlap_chars desc,candidate_lemma_key),'[]'::jsonb),
 count(*) into v_candidates,v_count from ranked r;
 return jsonb_build_object(
   'schema_version',1,'status','ok','query',p_query,
   'method','normalized_hebrew_and_greek_final_letter_consonantal_substring_v1',
   'language_scope','same_language_only',
   'returned_count',v_count,'limit',p_limit,
   'candidate_connections',v_candidates,
   'limitations','Substring resemblance alone provides no evidence of etymology, morphology, synonymy or intentional wordplay. Heuristic ranks are not confidence scores. Output is bounded and not exhaustive.'
 );
end
$$;


ALTER FUNCTION "public"."suggest_orthographic_candidates_v1"("p_query" "text", "p_limit" integer, "p_min_chars" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."suggest_orthographic_candidates_v1"("p_query" "text", "p_limit" integer, "p_min_chars" integer) IS 'Exploratory spelling matches with Hebrew final-letter (ךםןףץ -> כמנפצ) and Greek final sigma (ς -> σ) normalization; candidates never become documented roots or etymologies without supporting evidence.';



CREATE OR REPLACE FUNCTION "public"."translation_options_v1"("p_word_id" integer, "p_source_english" "text") RETURNS "text"[]
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(array_agg(option order by first_position), '{}'::text[])
  from (
    select option, min(position) as first_position
    from public.words w cross join lateral
      unnest(array_prepend(p_source_english, coalesce(w.english_translations, '{}')))
      with ordinality t(option, position)
    where w.id = p_word_id and option is not null group by option
  ) choices;
$$;


ALTER FUNCTION "public"."translation_options_v1"("p_word_id" integer, "p_source_english" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_note_anchor_occurrence_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    SET "statement_timeout" TO '8s'
    AS $$
declare
  v_expected_word_id integer;
begin
  if new.anchor_kind = 'word_occurrence' then
    select v.word_ids[new.word_position] into v_expected_word_id
    from public.verses v
    where v.id = new.verse_id;

    if v_expected_word_id is null or v_expected_word_id <> new.word_id then
      raise exception 'anchor_invalid: word_id % does not match verse % position % (expected %)',
        new.word_id, new.verse_id, new.word_position, v_expected_word_id
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_note_anchor_occurrence_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_note_block_trigger_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_err text;
begin
  v_err := public.note_validate_block_v1(new.block_type, new.content, new.text_alternative);
  if v_err is not null then
    raise exception 'block_invalid: %', v_err;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_note_block_trigger_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_syntax_tree_integrity_v1"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('validate_syntax_tree_integrity_v1', '{}'::jsonb);

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR NOT (v_remote ? 'is_valid') THEN
    RETURN jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable',
      'failure_reasons', jsonb_build_array('Static corpus worker unreachable or returned malformed integrity payload')
    );
  END IF;

  IF coalesce((v_remote->>'is_valid')::boolean, false) = false OR coalesce(v_remote->>'status', 'FAIL') <> 'PASS' THEN
    RETURN v_remote || jsonb_build_object('status', 'FAIL', 'is_valid', false);
  END IF;

  RETURN v_remote;
END;
$$;


ALTER FUNCTION "public"."validate_syntax_tree_integrity_v1"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_syntax_tree_integrity_v1"() IS 'Deterministic validation of syntax tree structure asserting acyclicity, valid hierarchy, 0 span inversions, and traceable terminal tokens.';



CREATE OR REPLACE FUNCTION "public"."validate_word_translation_choice_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_verse record;
  v_remote jsonb;
  v_source_text text;
BEGIN
  SELECT id, word_ids INTO v_verse
  FROM public.verses
  WHERE id = new.verse_id;

  IF NOT FOUND
     OR new.word_position IS NULL
     OR new.word_position < 1
     OR new.word_position > coalesce(cardinality(v_verse.word_ids), 0)
     OR v_verse.word_ids[new.word_position] IS DISTINCT FROM new.word_id THEN
    RAISE EXCEPTION 'Translation is not an available rendering for this occurrence' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.words w
    WHERE w.id = new.word_id
      AND (
        new.english = ANY(coalesce(w.english_translations, '{}'))
        OR btrim(new.english) = ANY(SELECT btrim(x) FROM unnest(coalesce(w.english_translations, '{}')) x)
      )
  ) THEN
    new.updated_at := now();
    RETURN new;
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', jsonb_build_array(new.verse_id))
  );

  SELECT elem->>'source_english'
  INTO v_source_text
  FROM jsonb_array_elements(coalesce(v_remote #> ARRAY['verses', new.verse_id::text], '[]'::jsonb)) elem
  WHERE (elem->>'word_position')::integer = new.word_position
    AND (elem->>'word_id')::integer = new.word_id
  LIMIT 1;

  IF v_source_text IS NULL OR NOT (new.english = ANY(public.translation_options_v1(new.word_id, v_source_text))) THEN
    RAISE EXCEPTION 'Translation is not an available rendering for this occurrence' USING errcode = '22023';
  END IF;

  new.updated_at := now();
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."validate_word_translation_choice_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_dlm_lemma_occurrence_v1"("p_lemma_id" bigint, "p_word_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    SET "statement_timeout" TO '4s'
    AS $$
 SELECT EXISTS(
   SELECT 1 FROM bible_internal.word_form_lemmas_for_words_v1(ARRAY[p_word_id]) wfl
   WHERE wfl.lemma_id=p_lemma_id AND wfl.word_id=p_word_id
     AND wfl.is_context_ambiguous IS FALSE
 )
$$;


ALTER FUNCTION "public"."verify_dlm_lemma_occurrence_v1"("p_lemma_id" bigint, "p_word_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_referential_integrity_v1"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '15s'
    AS $_$
DECLARE
  v_remote jsonb;
  v_homographs_h1254 integer;
  v_homographs_h5869 integer;
  v_multi_etym integer;
  v_chk_synonymy boolean;
  v_chk_root_kind boolean;
  v_chk_self_rel boolean;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('verify_referential_integrity_v1', '{}'::jsonb);

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR NOT (v_remote ? 'is_valid') THEN
    RETURN jsonb_build_object(
      'schema_version', '1.0.0',
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable',
      'failure_reasons', jsonb_build_array('Static corpus worker unreachable or returned malformed referential integrity payload')
    );
  END IF;

  IF coalesce((v_remote->>'is_valid')::boolean, false) = false OR coalesce(v_remote->>'status', 'FAIL') NOT IN ('ok', 'PASS') THEN
    RETURN v_remote || jsonb_build_object('status', 'FAIL', 'is_valid', false);
  END IF;

  SELECT count(*)::integer INTO v_homographs_h1254 FROM public.lexemes WHERE extended_strongs ~* '^H1254[a-z]?$';
  SELECT count(*)::integer INTO v_homographs_h5869 FROM public.lexemes WHERE extended_strongs ~* '^H5869[a-z]?$';
  SELECT count(*)::integer INTO v_multi_etym FROM (
    SELECT lemma_id FROM public.lemma_root_links GROUP BY lemma_id HAVING count(*) > 1
  ) sub;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_lemma_root_links_no_synonymy'
  ) INTO v_chk_synonymy;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_lexical_roots_kind'
  ) INTO v_chk_root_kind;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_entity_relationships_no_self_ref'
  ) INTO v_chk_self_rel;

  IF NOT (v_chk_synonymy AND v_chk_root_kind AND v_chk_self_rel) OR v_homographs_h1254 < 2 OR v_homographs_h5869 < 2 THEN
    RETURN v_remote || jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'postgres_constraint_or_homograph_check_failed'
    );
  END IF;

  RETURN v_remote;
END;
$_$;


ALTER FUNCTION "public"."verify_referential_integrity_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."whoami_v1"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
SELECT jsonb_build_object(
  'current_user', current_user,
  'session_user', session_user,
  'current_setting_timeout', current_setting('statement_timeout')
);
$$;


ALTER FUNCTION "public"."whoami_v1"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."word_formation_research_rpc_v1"("p_query" "text" DEFAULT NULL::"text", "p_word_id" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select public.get_word_formation_v1(p_query, p_word_id);
$$;


ALTER FUNCTION "public"."word_formation_research_rpc_v1"("p_query" "text", "p_word_id" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bible_internal"."b7_greek_terminal_repair_20261109" (
    "syntax_node_id" bigint NOT NULL,
    "source_token_id" bigint NOT NULL,
    "original_word_id" integer,
    "corrected_word_id" integer,
    "original_verse_id" integer NOT NULL,
    "matched_verse_id" integer NOT NULL,
    "source_edition_id" bigint NOT NULL,
    "source_xml_id" "text" NOT NULL,
    "source_link_status" "text" NOT NULL,
    "preserved_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "bible_internal"."b7_greek_terminal_repair_20261109" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verses" (
    "id" integer NOT NULL,
    "book" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "verse_nr" smallint NOT NULL,
    "word_ids" integer[] NOT NULL,
    "millennium" smallint,
    CONSTRAINT "verses_millennium_check" CHECK ((("millennium" >= 1) AND ("millennium" <= 7)))
);


ALTER TABLE "public"."verses" OWNER TO "postgres";


CREATE OR REPLACE VIEW "bible_internal"."corpus_english_verses" WITH ("security_invoker"='true') AS
 SELECT "book",
    "chapter",
    "verse_nr",
    'webp-2026-11'::"text" AS "edition_id",
    "bible_internal"."corpus_english_v1"(("book")::integer, ("chapter")::integer, ("verse_nr")::integer) AS "text"
   FROM "public"."verses" "v";


ALTER VIEW "bible_internal"."corpus_english_verses" OWNER TO "postgres";


CREATE OR REPLACE VIEW "bible_internal"."corpus_tokens" WITH ("security_invoker"='true') AS
 SELECT "v"."id" AS "verse_id",
    "u"."word_id",
    ("u"."position")::integer AS "word_position",
    "bible_internal"."corpus_source_gloss_v1"("v"."id", ("u"."position")::integer) AS "source_english"
   FROM ("public"."verses" "v"
     CROSS JOIN LATERAL "unnest"("v"."word_ids") WITH ORDINALITY "u"("word_id", "position"));


ALTER VIEW "bible_internal"."corpus_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bible_internal"."macula_gated_restricted_frames" (
    "morpheme_id" bigint NOT NULL,
    "dataset_key" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "field_value" "text" NOT NULL,
    "macula_id" "text" NOT NULL,
    "ref_mt" "text" NOT NULL,
    "book" smallint NOT NULL,
    "chapter_mt" smallint NOT NULL,
    "verse_mt" smallint NOT NULL,
    "word_no" smallint NOT NULL,
    "morph_no" smallint NOT NULL,
    "class" "text",
    "text_form" "text" NOT NULL,
    "after_text" "text",
    "lemma" "text" NOT NULL,
    "strong_x" "text",
    "morph_code" "text",
    "lang" "text" NOT NULL,
    "preserved_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "bible_internal"."macula_gated_restricted_frames" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bible_internal"."macula_syntax_import_files" (
    "id" bigint NOT NULL,
    "edition_key" "text" NOT NULL,
    "source_path" "text" NOT NULL,
    "source_bytes" integer NOT NULL,
    "git_blob_sha1" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "edition_id" bigint NOT NULL,
    "repository" "text" NOT NULL,
    "pinned_revision" "text" NOT NULL,
    "import_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "import_attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "nodes_imported" integer,
    "terminals_imported" integer,
    "edges_imported" integer,
    "unmapped_terminals" integer,
    "imported_at" timestamp with time zone,
    "reference_only_terminals" integer DEFAULT 0 NOT NULL,
    "source_only_nodes" integer DEFAULT 0 NOT NULL,
    "verified_git_blob_sha1" boolean DEFAULT false NOT NULL,
    CONSTRAINT "macula_syntax_import_files_git_blob_sha1_check" CHECK (("git_blob_sha1" ~ '^[0-9a-f]{40}$'::"text")),
    CONSTRAINT "macula_syntax_import_files_import_status_check" CHECK (("import_status" = ANY (ARRAY['pending'::"text", 'imported'::"text", 'failed'::"text"]))),
    CONSTRAINT "macula_syntax_import_files_repository_check" CHECK (("repository" = ANY (ARRAY['macula-hebrew'::"text", 'macula-greek'::"text"]))),
    CONSTRAINT "macula_syntax_import_files_source_bytes_check" CHECK (("source_bytes" > 0))
);


ALTER TABLE "bible_internal"."macula_syntax_import_files" OWNER TO "postgres";


COMMENT ON TABLE "bible_internal"."macula_syntax_import_files" IS 'Pinned source manifest of MACULA syntax tree files; imported means verified source bytes and linked trees, not merely downloaded.';



COMMENT ON COLUMN "bible_internal"."macula_syntax_import_files"."reference_only_terminals" IS 'Terminals retained via source verse+ordinal when direct XML-ID correspondence to imported Macula token table is absent.';



ALTER TABLE "bible_internal"."macula_syntax_import_files" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "bible_internal"."macula_syntax_import_files_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "bible_internal"."macula_syntax_unmapped_nodes" (
    "node_key" "text" NOT NULL,
    "source_file_id" bigint NOT NULL,
    "edition_id" bigint NOT NULL,
    "source_release_id" bigint NOT NULL,
    "tree_id" "text" NOT NULL,
    "parent_node_key" "text",
    "depth" integer NOT NULL,
    "sibling_order" integer NOT NULL,
    "node_kind" "text" NOT NULL,
    "source_xml_id" "text",
    "source_ref" "text",
    "class_label" "text",
    "rule_label" "text",
    "syntactic_role" "text",
    "cl_type" "text",
    "grammar_code" "text",
    "semantic_frame" "text",
    "is_head" boolean,
    "surface_text" "text",
    "mapping_status" "text" DEFAULT 'not_in_canonical_verse'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "bible_internal"."macula_syntax_unmapped_nodes" OWNER TO "postgres";


COMMENT ON TABLE "bible_internal"."macula_syntax_unmapped_nodes" IS 'All MACULA XML tree nodes that cannot be projected onto canonical BibleResearch verses (e.g. Mark 16:99), preserving source hierarchy and structural fields without importing restricted third-party semantic fields.';



CREATE TABLE IF NOT EXISTS "public"."assertion_evidence" (
    "id" bigint NOT NULL,
    "assertion_id" bigint NOT NULL,
    "evidence_role" "text" NOT NULL,
    "reference_display" "text" NOT NULL,
    "book" smallint NOT NULL,
    "start_chapter" smallint NOT NULL,
    "start_verse" smallint NOT NULL,
    "end_chapter" smallint NOT NULL,
    "end_verse" smallint NOT NULL,
    "original_terms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "explanation" "text" NOT NULL,
    "step_url" "text",
    "step_order" smallint DEFAULT 1 NOT NULL,
    CONSTRAINT "assertion_evidence_book_check" CHECK ((("book" >= 1) AND ("book" <= 66))),
    CONSTRAINT "assertion_evidence_evidence_role_check" CHECK (("evidence_role" = ANY (ARRAY['encounter_setting'::"text", 'outcome_marriage'::"text", 'tabernacle_instruction'::"text", 'prophetic_vision'::"text", 'apocalyptic_vision'::"text", 'control_counterexample'::"text", 'lexical_note'::"text"])))
);


ALTER TABLE "public"."assertion_evidence" OWNER TO "postgres";


ALTER TABLE "public"."assertion_evidence" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."assertion_evidence_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."assertions" (
    "id" bigint NOT NULL,
    "assertion_key" "text" NOT NULL,
    "subject_node_id" bigint NOT NULL,
    "object_node_id" bigint NOT NULL,
    "predicate" "text" NOT NULL,
    "epistemic_category" "text" NOT NULL,
    "review_status" "text" DEFAULT 'reviewed'::"text" NOT NULL,
    "scope_reference" "text" NOT NULL,
    "denominator_note" "text",
    "summary" "text" NOT NULL,
    "limitations_note" "text" NOT NULL,
    "source_attribution" "text" NOT NULL,
    "rank_order" smallint DEFAULT 1 NOT NULL,
    CONSTRAINT "assertions_epistemic_category_check" CHECK (("epistemic_category" = ANY (ARRAY['lexical'::"text", 'linguistic'::"text", 'statistical'::"text", 'textual'::"text", 'interpretive'::"text"]))),
    CONSTRAINT "assertions_predicate_check" CHECK (("predicate" = ANY (ARRAY['narrative_parallel'::"text", 'possible_allusion'::"text", 'identified_as_in_passage'::"text", 'contextual_distinction'::"text", 'lexical_distinction'::"text", 'homograph_subdivision'::"text", 'related_unspecified'::"text"]))),
    CONSTRAINT "assertions_review_status_check" CHECK (("review_status" = ANY (ARRAY['reviewed'::"text", 'candidate'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."assertions" OWNER TO "postgres";


ALTER TABLE "public"."assertions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."assertions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bol_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "name" "text" NOT NULL,
    "month" integer,
    "day" integer,
    "content" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "category" "text" DEFAULT 'good_memory'::"text" NOT NULL
);


ALTER TABLE "public"."bol_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."bol_events"."category" IS 'good_memory, trauma, sin';



CREATE TABLE IF NOT EXISTS "public"."bol_profiles" (
    "id" "uuid" NOT NULL,
    "birth_year" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."bol_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bol_years" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "age" integer NOT NULL,
    "content" "text" DEFAULT ''::"text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."bol_years" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."book_aliases" (
    "alias" "text" NOT NULL,
    "book_id" smallint NOT NULL,
    "kind" "text" DEFAULT 'abbrev'::"text" NOT NULL
);


ALTER TABLE "public"."book_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."books" (
    "id" smallint NOT NULL,
    "name" "text" NOT NULL,
    "testament" "text" NOT NULL,
    "original_language" "text" NOT NULL,
    "total_chapters" smallint NOT NULL,
    "usfm" "text" NOT NULL,
    "theographic_code" "text" NOT NULL,
    "division" "text" NOT NULL,
    CONSTRAINT "books_division_check" CHECK (("division" = ANY (ARRAY['Law'::"text", 'Historical'::"text", 'Poetical'::"text", 'Major Prophets'::"text", 'Minor Prophets'::"text", 'Gospels'::"text", 'History'::"text", 'Pauline Epistles'::"text", 'General Epistles'::"text", 'Apocalyptic'::"text"]))),
    CONSTRAINT "books_id_check" CHECK ((("id" >= 1) AND ("id" <= 66))),
    CONSTRAINT "books_original_language_check" CHECK (("original_language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text", 'hbo/arc'::"text"]))),
    CONSTRAINT "books_testament_check" CHECK (("testament" = ANY (ARRAY['OT'::"text", 'NT'::"text"]))),
    CONSTRAINT "books_total_chapters_check" CHECK ((("total_chapters" >= 1) AND ("total_chapters" <= 150)))
);


ALTER TABLE "public"."books" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."canonical_entities" (
    "id" bigint NOT NULL,
    "entity_key" "text" NOT NULL,
    "entity_kind" "text" NOT NULL,
    "display_label" "text" NOT NULL,
    "language" "text",
    "word_id" integer,
    "lemma_id" bigint,
    "lexeme_id" bigint,
    "root_id" bigint,
    "sense_id" bigint,
    "verse_id" integer,
    "concept_id" bigint,
    "place_id" bigint,
    "chronology_event_id" bigint,
    "research_node_id" bigint,
    "source_release_id" bigint,
    "source_record_id" "text",
    CONSTRAINT "canonical_entities_check" CHECK (("num_nonnulls"("word_id", "lemma_id", "lexeme_id", "root_id", "sense_id", "verse_id", "concept_id", "place_id", "chronology_event_id", "research_node_id") = 1)),
    CONSTRAINT "canonical_entities_entity_kind_check" CHECK (("entity_kind" = ANY (ARRAY['word_form'::"text", 'lemma'::"text", 'lexeme'::"text", 'root'::"text", 'sense'::"text", 'passage'::"text", 'concept'::"text", 'place'::"text", 'chronology_event'::"text", 'research_node'::"text"])))
);


ALTER TABLE "public"."canonical_entities" OWNER TO "postgres";


ALTER TABLE "public"."canonical_entities" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."canonical_entities_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chronology_active_runs" (
    "model_id" "text" NOT NULL,
    "run_id" bigint NOT NULL
);


ALTER TABLE "public"."chronology_active_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronology_assertion_evidence" (
    "assertion_id" bigint NOT NULL,
    "evidence_id" bigint NOT NULL,
    "relationship" "text" NOT NULL,
    "applicability" "text" NOT NULL,
    "explanation" "text" NOT NULL,
    CONSTRAINT "chronology_assertion_evidence_applicability_check" CHECK (("applicability" = ANY (ARRAY['direct'::"text", 'inherited'::"text"]))),
    CONSTRAINT "chronology_assertion_evidence_relationship_check" CHECK (("relationship" = ANY (ARRAY['supporting'::"text", 'challenging'::"text", 'contextual'::"text"])))
);


ALTER TABLE "public"."chronology_assertion_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronology_assertions" (
    "id" bigint NOT NULL,
    "assertion_key" "text" NOT NULL,
    "model_id" "text" NOT NULL,
    "verse_id" integer,
    "event_id" bigint,
    "source_id" bigint NOT NULL,
    "axis" "text" NOT NULL,
    "earliest_year" integer NOT NULL,
    "latest_year" integer NOT NULL,
    "preferred_year" integer,
    "precision" "text" NOT NULL,
    "method" "text" NOT NULL,
    "rationale" "text" NOT NULL,
    "author" "text" NOT NULL,
    "review_status" "text" NOT NULL,
    "published" boolean DEFAULT false NOT NULL,
    "supersedes" bigint,
    "mapping" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "chronology_assertions_axis_check" CHECK (("axis" = ANY (ARRAY['source_placement'::"text", 'setting'::"text", 'composition'::"text", 'mentioned_event'::"text"]))),
    CONSTRAINT "chronology_assertions_check" CHECK ((("verse_id" IS NOT NULL) OR ("event_id" IS NOT NULL))),
    CONSTRAINT "chronology_assertions_check1" CHECK (("earliest_year" <= "latest_year")),
    CONSTRAINT "chronology_assertions_check2" CHECK ((("preferred_year" IS NULL) OR (("preferred_year" >= "earliest_year") AND ("preferred_year" <= "latest_year")))),
    CONSTRAINT "chronology_assertions_check3" CHECK (((NOT "published") OR ("review_status" <> 'candidate'::"text"))),
    CONSTRAINT "chronology_assertions_precision_check" CHECK (("precision" = ANY (ARRAY['source_year'::"text", 'approximate'::"text", 'range'::"text", 'source_calendar_day'::"text"]))),
    CONSTRAINT "chronology_assertions_review_status_check" CHECK (("review_status" = ANY (ARRAY['source_import'::"text", 'model_assumption'::"text", 'reviewed'::"text", 'candidate'::"text"])))
);


ALTER TABLE "public"."chronology_assertions" OWNER TO "postgres";


ALTER TABLE "public"."chronology_assertions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chronology_assertions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chronology_assignment_assertions" (
    "run_id" bigint NOT NULL,
    "verse_id" integer NOT NULL,
    "model_id" "text" NOT NULL,
    "assertion_id" bigint NOT NULL
);


ALTER TABLE "public"."chronology_assignment_assertions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronology_assignments" (
    "run_id" bigint NOT NULL,
    "model_id" "text" NOT NULL,
    "verse_id" integer NOT NULL,
    "status" "text" NOT NULL,
    CONSTRAINT "chronology_assignments_status_check" CHECK (("status" = ANY (ARRAY['source_estimate'::"text", 'estimated'::"text", 'conflicting'::"text", 'unresolved'::"text"])))
);


ALTER TABLE "public"."chronology_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronology_event_links" (
    "event_id" bigint NOT NULL,
    "verse_id" integer NOT NULL,
    "relationship" "text" NOT NULL,
    "mapping" "jsonb" NOT NULL,
    CONSTRAINT "chronology_event_links_relationship_check" CHECK (("relationship" = ANY (ARRAY['setting'::"text", 'mention'::"text", 'retrospective'::"text", 'prophetic'::"text", 'uncertain'::"text"])))
);


ALTER TABLE "public"."chronology_event_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronology_events" (
    "id" bigint NOT NULL,
    "event_key" "text" NOT NULL,
    "source_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "start_year" integer NOT NULL,
    "original_date" "text" NOT NULL,
    "duration" "text",
    "range_flag" boolean DEFAULT false NOT NULL,
    "raw_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "published" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."chronology_events" OWNER TO "postgres";


ALTER TABLE "public"."chronology_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chronology_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chronology_evidence" (
    "id" bigint NOT NULL,
    "evidence_key" "text" NOT NULL,
    "source_id" bigint NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "citation" "text" NOT NULL,
    "locator" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "dating_method" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "uncertainty" "text" NOT NULL,
    "provenance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "object_year" integer,
    "event_year" integer,
    "review_status" "text" NOT NULL,
    "published" boolean DEFAULT false NOT NULL,
    CONSTRAINT "chronology_evidence_category_check" CHECK (("category" = ANY (ARRAY['textual'::"text", 'archaeological'::"text", 'model_premise'::"text", 'scholarly_interpretation'::"text"]))),
    CONSTRAINT "chronology_evidence_check" CHECK (((NOT "published") OR ("review_status" <> 'candidate'::"text"))),
    CONSTRAINT "chronology_evidence_review_status_check" CHECK (("review_status" = ANY (ARRAY['source_import'::"text", 'model_assumption'::"text", 'reviewed'::"text", 'candidate'::"text"])))
);


ALTER TABLE "public"."chronology_evidence" OWNER TO "postgres";


ALTER TABLE "public"."chronology_evidence" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chronology_evidence_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chronology_models" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "assumptions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "adam_year" integer,
    "resurrection_year" integer,
    "published" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."chronology_models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronology_revisions" (
    "id" bigint NOT NULL,
    "proposal_key" "text" NOT NULL,
    "model_id" "text" NOT NULL,
    "parent_run_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "actor" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb" NOT NULL,
    CONSTRAINT "chronology_revisions_action_check" CHECK (("action" = ANY (ARRAY['proposed'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."chronology_revisions" OWNER TO "postgres";


ALTER TABLE "public"."chronology_revisions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chronology_revisions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chronology_runs" (
    "id" bigint NOT NULL,
    "model_id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published" boolean DEFAULT false NOT NULL,
    "coverage" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."chronology_runs" OWNER TO "postgres";


ALTER TABLE "public"."chronology_runs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chronology_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chronology_sources" (
    "id" bigint NOT NULL,
    "source_key" "text" NOT NULL,
    "dataset" "text" NOT NULL,
    "version" "text" NOT NULL,
    "locator" "text" NOT NULL,
    "sha256" "text",
    "license" "text" NOT NULL,
    "attribution" "text" NOT NULL,
    "raw_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "published" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."chronology_sources" OWNER TO "postgres";


ALTER TABLE "public"."chronology_sources" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chronology_sources_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."concept_aliases" (
    "id" bigint NOT NULL,
    "concept_id" bigint NOT NULL,
    "alias" "text" NOT NULL,
    "alias_normalized" "text" NOT NULL,
    "language" "text" DEFAULT 'en'::"text" NOT NULL
);


ALTER TABLE "public"."concept_aliases" OWNER TO "postgres";


ALTER TABLE "public"."concept_aliases" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."concept_aliases_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."concept_external_links" (
    "id" bigint NOT NULL,
    "concept_id" bigint NOT NULL,
    "provider" "text" NOT NULL,
    "external_id" "text" NOT NULL,
    "external_url" "text" NOT NULL,
    "link_relation" "text" NOT NULL,
    "license" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "concept_external_links_external_url_check" CHECK (("external_url" ~ '^https?://'::"text")),
    CONSTRAINT "concept_external_links_link_relation_check" CHECK (("link_relation" = ANY (ARRAY['exact_match'::"text", 'close_match'::"text", 'gazetteer_reference'::"text", 'chronology_reference'::"text", 'lexical_reference'::"text"]))),
    CONSTRAINT "concept_external_links_provider_check" CHECK (("provider" = ANY (ARRAY['pleiades'::"text", 'openbible'::"text", 'theographic'::"text", 'stepbible_tipnr'::"text", 'stepbible_lexicon'::"text", 'ebible_web'::"text", 'wikidata'::"text"]))),
    CONSTRAINT "concept_external_links_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."concept_external_links" OWNER TO "postgres";


ALTER TABLE "public"."concept_external_links" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."concept_external_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."concept_properties" (
    "id" bigint NOT NULL,
    "concept_id" bigint NOT NULL,
    "property_key" "text" NOT NULL,
    "property_value" "text" NOT NULL,
    "value_type" "text" DEFAULT 'string'::"text" NOT NULL,
    "unit" "text",
    "epistemic_layer" "text" DEFAULT 'external_factual'::"text" NOT NULL,
    "external_citation" "text",
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "concept_properties_epistemic_layer_check" CHECK (("epistemic_layer" = ANY (ARRAY['primary_biblical'::"text", 'lexical_reference'::"text", 'external_factual'::"text", 'reviewed_interpretation'::"text"]))),
    CONSTRAINT "concept_properties_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text")),
    CONSTRAINT "concept_properties_value_type_check" CHECK (("value_type" = ANY (ARRAY['string'::"text", 'number'::"text", 'boolean'::"text", 'coordinate'::"text", 'year_range'::"text", 'identifier'::"text"])))
);


ALTER TABLE "public"."concept_properties" OWNER TO "postgres";


ALTER TABLE "public"."concept_properties" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."concept_properties_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."concepts" (
    "id" bigint NOT NULL,
    "concept_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "concept_kind" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "primary_strongs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "distinct_from_note" "text",
    "external_entity_type" "text",
    "epistemic_layer" "text" DEFAULT 'reviewed_research'::"text" NOT NULL,
    "source_release_id" bigint,
    "source_edition_id" bigint,
    "source_record_id" "text",
    CONSTRAINT "concepts_concept_kind_check" CHECK (("concept_kind" = ANY (ARRAY['object'::"text", 'social_institution'::"text", 'theological_symbol'::"text", 'natural_feature'::"text", 'narrative_motif'::"text"]))),
    CONSTRAINT "concepts_epistemic_layer_check" CHECK (("epistemic_layer" = ANY (ARRAY['primary_biblical'::"text", 'lexical_reference'::"text", 'external_factual'::"text", 'reviewed_research'::"text"])))
);


ALTER TABLE "public"."concepts" OWNER TO "postgres";


ALTER TABLE "public"."concepts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."concepts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."content" (
    "id" bigint NOT NULL,
    "type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "show_on_map" boolean DEFAULT false,
    "holyspirit_locked" boolean DEFAULT false,
    "connection_account" bigint DEFAULT '1'::bigint,
    "user_id" bigint,
    "name" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "text" "text"
);


ALTER TABLE "public"."content" OWNER TO "postgres";


ALTER TABLE "public"."content" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."content_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cross_token_mappings" (
    "id" bigint NOT NULL,
    "canonical_verse_id" integer NOT NULL,
    "step_word_id" integer,
    "morphhb_token_id" bigint,
    "macula_morpheme_id" bigint,
    "mapping_status" "text" NOT NULL,
    "notes" "text",
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'algorithmically_calculated'::"text" NOT NULL,
    "derivation_method" "text" NOT NULL,
    "algorithm_version" "text" NOT NULL,
    CONSTRAINT "cross_token_mappings_mapping_status_check" CHECK (("mapping_status" = ANY (ARRAY['exact_match'::"text", 'consonantal_match'::"text", 'qere_reading'::"text", 'ketiv_alternative'::"text", 'morpheme_segment'::"text", 'unresolved'::"text"]))),
    CONSTRAINT "cross_token_mappings_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text"]))),
    CONSTRAINT "cross_token_mappings_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."cross_token_mappings" OWNER TO "postgres";


ALTER TABLE "public"."cross_token_mappings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cross_token_mappings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."edition_passages" (
    "id" bigint NOT NULL,
    "edition_id" bigint NOT NULL,
    "book" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "verse_nr" smallint NOT NULL,
    "edition_ref" "text" NOT NULL,
    "canonical_verse_id" integer,
    "token_count" smallint,
    "witness_tag" "text",
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "edition_passages_chapter_check" CHECK (("chapter" >= 0)),
    CONSTRAINT "edition_passages_token_count_check" CHECK ((("token_count" IS NULL) OR ("token_count" >= 0))),
    CONSTRAINT "edition_passages_verse_nr_check" CHECK (("verse_nr" >= 0))
);


ALTER TABLE "public"."edition_passages" OWNER TO "postgres";


ALTER TABLE "public"."edition_passages" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."edition_passages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."entity_relationships" (
    "id" bigint NOT NULL,
    "relationship_key" "text" NOT NULL,
    "subject_entity_id" bigint NOT NULL,
    "object_entity_id" bigint NOT NULL,
    "relation_type" "text" NOT NULL,
    "epistemic_layer" "text" NOT NULL,
    "origin_mode" "text" NOT NULL,
    "derivation_method" "text",
    "algorithm_version" "text",
    "score" numeric,
    "supporting_span_ref" "text",
    "supporting_verse_id" integer,
    "external_citation" "text",
    "evidence_summary" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    "review_status" "text" DEFAULT 'reviewed'::"text" NOT NULL,
    "owner_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_entity_relationships_no_self_ref" CHECK (("subject_entity_id" <> "object_entity_id")),
    CONSTRAINT "entity_relationships_check" CHECK ((("supporting_span_ref" IS NOT NULL) OR ("external_citation" IS NOT NULL))),
    CONSTRAINT "entity_relationships_check1" CHECK ((("origin_mode" <> 'algorithmically_calculated'::"text") OR (("derivation_method" IS NOT NULL) AND ("algorithm_version" IS NOT NULL)))),
    CONSTRAINT "entity_relationships_check2" CHECK (((("origin_mode" = 'user_authored'::"text") AND ("owner_user_id" IS NOT NULL) AND ("epistemic_layer" = 'user_interpretation'::"text")) OR (("origin_mode" <> 'user_authored'::"text") AND ("owner_user_id" IS NULL)))),
    CONSTRAINT "entity_relationships_epistemic_layer_check" CHECK (("epistemic_layer" = ANY (ARRAY['primary_biblical'::"text", 'lexical_reference'::"text", 'external_factual'::"text", 'reviewed_interpretation'::"text", 'user_interpretation'::"text"]))),
    CONSTRAINT "entity_relationships_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text", 'user_authored'::"text"]))),
    CONSTRAINT "entity_relationships_review_status_check" CHECK (("review_status" = ANY (ARRAY['reviewed'::"text", 'candidate'::"text", 'rejected'::"text"]))),
    CONSTRAINT "entity_relationships_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."entity_relationships" OWNER TO "postgres";


ALTER TABLE "public"."entity_relationships" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."entity_relationships_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."field_license_registry" (
    "id" bigint NOT NULL,
    "dataset_key" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "field_group" "text" NOT NULL,
    "origin" "text" NOT NULL,
    "license" "text" NOT NULL,
    "status" "text" NOT NULL,
    "decision_note" "text",
    "decided_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "field_license_registry_status_check" CHECK (("status" = ANY (ARRAY['enabled'::"text", 'enabled_origin_unverified'::"text", 'disabled_restricted'::"text", 'disabled_unverified'::"text"])))
);


ALTER TABLE "public"."field_license_registry" OWNER TO "postgres";


ALTER TABLE "public"."field_license_registry" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."field_license_registry_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."geography_sources" (
    "id" bigint NOT NULL,
    "source_key" "text" NOT NULL,
    "dataset" "text" NOT NULL,
    "version" "text" NOT NULL,
    "locator" "text" NOT NULL,
    "sha256" "text",
    "license" "text" NOT NULL,
    "attribution" "text" NOT NULL,
    "raw_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "published" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."geography_sources" OWNER TO "postgres";


ALTER TABLE "public"."geography_sources" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."geography_sources_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."hebrew_lxx_verse_map" (
    "id" bigint NOT NULL,
    "canonical_verse_id" integer,
    "lxx_book_no" smallint,
    "lxx_chapter" smallint,
    "lxx_verse_nr" smallint,
    "lxx_verse_suffix" "text" DEFAULT ''::"text" NOT NULL,
    "mapping_kind" "text" NOT NULL,
    "rule_citation" "text" NOT NULL,
    "origin_mode" "text" NOT NULL,
    "derivation_method" "text" NOT NULL,
    "algorithm_version" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "lxx_chapter_suffix" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "chk_hebrew_lxx_map_kind" CHECK (("mapping_kind" = ANY (ARRAY['same_reference'::"text", 'psalm_numbering_shift'::"text", 'versification_shift'::"text", 'superscription_title_verse'::"text", 'fragment_subdivision'::"text", 'lxx_plus'::"text", 'mt_plus'::"text", 'reordered'::"text", 'unmatched_hebrew'::"text", 'unmatched_septuagint'::"text"]))),
    CONSTRAINT "hebrew_lxx_verse_map_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text"]))),
    CONSTRAINT "hebrew_lxx_verse_map_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."hebrew_lxx_verse_map" OWNER TO "postgres";


ALTER TABLE "public"."hebrew_lxx_verse_map" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."hebrew_lxx_verse_map_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."hebrew_lxx_word_alignments" (
    "id" bigint NOT NULL,
    "alignment_key" "text" NOT NULL,
    "canonical_verse_id" integer,
    "lxx_book_no" smallint,
    "lxx_chapter" smallint NOT NULL,
    "lxx_chapter_suffix" "text" DEFAULT ''::"text" NOT NULL,
    "lxx_verse_nr" smallint NOT NULL,
    "lxx_verse_suffix" "text" DEFAULT ''::"text" NOT NULL,
    "hebrew_word_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "hebrew_token_ordinals" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    "hebrew_text" "text" NOT NULL,
    "hebrew_strongs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "lxx_word_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
    "lxx_token_ordinals" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    "lxx_text" "text" NOT NULL,
    "lxx_strongs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cardinality" "text" NOT NULL,
    "alignment_tier" "text" NOT NULL,
    "verification_status" "text" NOT NULL,
    "confidence_score" numeric(4,3),
    "algorithm_or_source" "text" NOT NULL,
    "translation_technique" "text",
    "evidence_summary" "text" NOT NULL,
    "source_release_id" bigint,
    "source_record_id" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "chk_candidate_never_masquerade" CHECK (((("alignment_tier" = 'documented_textual'::"text") AND ("verification_status" = ANY (ARRAY['verified_source_attestation'::"text", 'editorial_collation'::"text"])) AND (("confidence_score" IS NULL) OR ("confidence_score" = (1)::numeric))) OR (("alignment_tier" = 'computationally_inferred_candidate'::"text") AND ("verification_status" = 'unverified_candidate'::"text") AND ("confidence_score" < (1)::numeric)) OR (("alignment_tier" = 'scholarly_interpretation'::"text") AND ("verification_status" = 'scholarly_hypothesis'::"text")))),
    CONSTRAINT "hebrew_lxx_word_alignments_alignment_tier_check" CHECK (("alignment_tier" = ANY (ARRAY['documented_textual'::"text", 'computationally_inferred_candidate'::"text", 'scholarly_interpretation'::"text"]))),
    CONSTRAINT "hebrew_lxx_word_alignments_cardinality_check" CHECK (("cardinality" = ANY (ARRAY['one_to_one'::"text", 'one_to_many'::"text", 'many_to_one'::"text", 'many_to_many'::"text", 'unmatched_hebrew'::"text", 'unmatched_septuagint'::"text"]))),
    CONSTRAINT "hebrew_lxx_word_alignments_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['verified_source_attestation'::"text", 'editorial_collation'::"text", 'unverified_candidate'::"text", 'scholarly_hypothesis'::"text"])))
);


ALTER TABLE "public"."hebrew_lxx_word_alignments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."hebrew_lxx_word_alignments"."verification_status" IS 'verified_source_attestation requires upstream explicit attestation; editorial_collation is a locally compared alignment between separate textual sources and is NOT an upstream source-provided alignment; unverified_candidate and scholarly_hypothesis remain distinct.';



ALTER TABLE "public"."hebrew_lxx_word_alignments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."hebrew_lxx_word_alignments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lemma_components" (
    "id" bigint NOT NULL,
    "formation_id" bigint NOT NULL,
    "component_order" smallint NOT NULL,
    "component_lemma_id" bigint,
    "component_lexeme_id" bigint,
    "surface_text" "text" NOT NULL,
    "component_role" "text" NOT NULL,
    "semantic_contribution" "text",
    "component_note" "text",
    CONSTRAINT "lemma_components_check" CHECK ((("component_lemma_id" IS NOT NULL) OR ("component_lexeme_id" IS NOT NULL))),
    CONSTRAINT "lemma_components_component_order_check" CHECK (("component_order" > 0)),
    CONSTRAINT "lemma_components_component_role_check" CHECK (("component_role" = ANY (ARRAY['verbal_element'::"text", 'nominal_element'::"text", 'divine_name_element'::"text", 'prefix'::"text", 'suffix'::"text", 'other'::"text"]))),
    CONSTRAINT "lemma_components_surface_text_check" CHECK (("length"("btrim"("surface_text")) > 0))
);


ALTER TABLE "public"."lemma_components" OWNER TO "postgres";


COMMENT ON TABLE "public"."lemma_components" IS 'Ordered lexical formation components, not surface-token morphemes. Canonical lemma/lexeme IDs identify disambiguated meanings.';



ALTER TABLE "public"."lemma_components" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lemma_components_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lemma_root_links" (
    "id" bigint NOT NULL,
    "lemma_id" bigint NOT NULL,
    "root_id" bigint NOT NULL,
    "etymology_type" "text" NOT NULL,
    "implies_synonymy" boolean DEFAULT false NOT NULL,
    "evidence_note" "text",
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" NOT NULL,
    "derivation_method" "text" NOT NULL,
    "algorithm_version" "text",
    CONSTRAINT "chk_lemma_root_links_etymology" CHECK (("etymology_type" = ANY (ARRAY['form_of'::"text", 'aramaic_cognate_of'::"text", 'base_root_anchor'::"text", 'compound_part_of'::"text", 'group_member_of'::"text", 'shared_name_base'::"text", 'greek_loan_or_transliteration'::"text", 'hebrew_cognate_of'::"text", 'derived_from'::"text", 'spelling_variant_of'::"text"]))),
    CONSTRAINT "chk_lemma_root_links_no_synonymy" CHECK (("implies_synonymy" = false)),
    CONSTRAINT "lemma_root_links_etymology_type_check" CHECK (("etymology_type" = ANY (ARRAY['base_root_anchor'::"text", 'derived_from'::"text", 'aramaic_cognate_of'::"text", 'hebrew_cognate_of'::"text", 'greek_loan_or_transliteration'::"text", 'compound_part_of'::"text", 'combination_of'::"text", 'group_member_of'::"text", 'spelling_variant_of'::"text", 'form_of'::"text", 'shared_name_base'::"text"]))),
    CONSTRAINT "lemma_root_links_implies_synonymy_check" CHECK (("implies_synonymy" = false)),
    CONSTRAINT "lemma_root_links_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text"]))),
    CONSTRAINT "lemma_root_links_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."lemma_root_links" OWNER TO "postgres";


ALTER TABLE "public"."lemma_root_links" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lemma_root_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lemmas" (
    "id" bigint NOT NULL,
    "lemma_key" "text" NOT NULL,
    "language" "text" NOT NULL,
    "lemma_script" "text" NOT NULL,
    "lemma_stripped" "text" NOT NULL,
    "transliteration" "text" NOT NULL,
    "primary_pos" "text",
    "homograph_tag" "text",
    "base_strongs" "text",
    "primary_lexeme_id" bigint,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "chk_lemmas_language" CHECK (("language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text"]))),
    CONSTRAINT "lemmas_language_check" CHECK (("language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text"]))),
    CONSTRAINT "lemmas_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."lemmas" OWNER TO "postgres";


ALTER TABLE "public"."lemmas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lemmas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lexeme_identifiers" (
    "id" bigint NOT NULL,
    "lexeme_id" bigint NOT NULL,
    "id_namespace" "text" NOT NULL,
    "id_value" "text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "lexeme_identifiers_id_namespace_check" CHECK (("id_namespace" = ANY (ARRAY['base_strongs'::"text", 'extended_strongs'::"text", 'disambiguated_strongs'::"text", 'unified_strongs'::"text", 'step_lexeme_key'::"text"])))
);


ALTER TABLE "public"."lexeme_identifiers" OWNER TO "postgres";


ALTER TABLE "public"."lexeme_identifiers" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lexeme_identifiers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lexemes" (
    "id" bigint NOT NULL,
    "lexeme_key" "text" NOT NULL,
    "language" "text" NOT NULL,
    "base_strongs" "text" NOT NULL,
    "extended_strongs" "text" NOT NULL,
    "disambiguated_strongs" "text",
    "unified_strongs" "text",
    "original_lemma" "text" NOT NULL,
    "transliteration" "text" NOT NULL,
    "pos" "text",
    "primary_gloss" "text" NOT NULL,
    "homograph_note" "text",
    "source_release_id" bigint,
    "lemma_id" bigint,
    "source_edition_id" bigint,
    "source_record_id" "text",
    CONSTRAINT "chk_lexemes_language" CHECK (("language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text"]))),
    CONSTRAINT "lexemes_language_check" CHECK (("language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text"])))
);


ALTER TABLE "public"."lexemes" OWNER TO "postgres";


ALTER TABLE "public"."lexemes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lexemes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lexical_connections" (
    "id" bigint NOT NULL,
    "subject_lemma_id" bigint NOT NULL,
    "target_lemma_id" bigint NOT NULL,
    "relation_type" "text" NOT NULL,
    "evidence_status" "text" NOT NULL,
    "evidence_note" "text" NOT NULL,
    "passage_reference" "text",
    "source_title" "text",
    "source_url" "text",
    "derivation_method" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lexical_connections_check" CHECK (("subject_lemma_id" <> "target_lemma_id")),
    CONSTRAINT "lexical_connections_check1" CHECK ((("relation_type" <> 'orthographic_overlap'::"text") OR ("evidence_status" <> 'documented_textual'::"text"))),
    CONSTRAINT "lexical_connections_evidence_status_check" CHECK (("evidence_status" = ANY (ARRAY['documented_textual'::"text", 'observed_form'::"text", 'unverified_hypothesis'::"text", 'disputed'::"text", 'rejected'::"text"]))),
    CONSTRAINT "lexical_connections_relation_type_check" CHECK (("relation_type" = ANY (ARRAY['literary_wordplay'::"text", 'orthographic_overlap'::"text", 'phonetic_resemblance'::"text", 'proposed_derivation'::"text"])))
);


ALTER TABLE "public"."lexical_connections" OWNER TO "postgres";


COMMENT ON TABLE "public"."lexical_connections" IS 'Literary/formal connections distinct from documented derivation and root family. Similar spelling alone cannot assert etymology or synonymy.';



ALTER TABLE "public"."lexical_connections" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lexical_connections_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lexical_formations" (
    "id" bigint NOT NULL,
    "lemma_id" bigint NOT NULL,
    "analysis_key" "text" NOT NULL,
    "formation_type" "text" NOT NULL,
    "whole_word_gloss" "text",
    "evidence_status" "text" NOT NULL,
    "evidence_note" "text" NOT NULL,
    "source_title" "text",
    "source_url" "text",
    "source_record_id" "text",
    "origin_mode" "text" DEFAULT 'sourced'::"text" NOT NULL,
    "review_status" "text" DEFAULT 'unreviewed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lexical_formations_analysis_key_check" CHECK (("length"("btrim"("analysis_key")) > 0)),
    CONSTRAINT "lexical_formations_check" CHECK ((("origin_mode" <> 'algorithmic_candidate'::"text") OR ("evidence_status" <> 'documented'::"text"))),
    CONSTRAINT "lexical_formations_evidence_status_check" CHECK (("evidence_status" = ANY (ARRAY['documented'::"text", 'proposed'::"text", 'disputed'::"text", 'rejected'::"text"]))),
    CONSTRAINT "lexical_formations_formation_type_check" CHECK (("formation_type" = ANY (ARRAY['compound'::"text", 'theophoric_name'::"text", 'derivation'::"text", 'other'::"text"]))),
    CONSTRAINT "lexical_formations_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['sourced'::"text", 'editorial_candidate'::"text", 'algorithmic_candidate'::"text"]))),
    CONSTRAINT "lexical_formations_review_status_check" CHECK (("review_status" = ANY (ARRAY['unreviewed'::"text", 'reviewed'::"text"])))
);


ALTER TABLE "public"."lexical_formations" OWNER TO "postgres";


COMMENT ON TABLE "public"."lexical_formations" IS 'Claim-level source-backed analyses of how lemmas are formed. Whole-word gloss belongs to a lexical analysis, never to an abstract consonantal root. Documented is source-attested, not expert-review status.';



ALTER TABLE "public"."lexical_formations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lexical_formations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lexical_roots" (
    "id" bigint NOT NULL,
    "root_key" "text" NOT NULL,
    "language" "text" NOT NULL,
    "root_script" "text" NOT NULL,
    "root_stripped" "text" NOT NULL,
    "transliteration" "text",
    "root_kind" "text" NOT NULL,
    "anchor_lexeme_id" bigint,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "chk_lexical_roots_kind" CHECK (("root_kind" = ANY (ARRAY['documented_lexical_base'::"text", 'semitic_cross_dialect_base'::"text", 'greek_etymological_stem'::"text"]))),
    CONSTRAINT "chk_lexical_roots_language" CHECK (("language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text"]))),
    CONSTRAINT "lexical_roots_language_check" CHECK (("language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text"]))),
    CONSTRAINT "lexical_roots_root_kind_check" CHECK (("root_kind" = ANY (ARRAY['documented_lexical_base'::"text", 'greek_etymological_stem'::"text", 'semitic_cross_dialect_base'::"text"]))),
    CONSTRAINT "lexical_roots_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."lexical_roots" OWNER TO "postgres";


COMMENT ON TABLE "public"."lexical_roots" IS 'Documented etymological/morphological roots and base stems. Intentionally excludes any meaning/gloss column because a root is not a meaning.';



ALTER TABLE "public"."lexical_roots" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lexical_roots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lexical_senses" (
    "id" bigint NOT NULL,
    "sense_key" "text" NOT NULL,
    "lemma_id" bigint NOT NULL,
    "lexeme_id" bigint NOT NULL,
    "parent_sense_id" bigint,
    "sense_code" "text" NOT NULL,
    "sense_order" smallint DEFAULT 1 NOT NULL,
    "short_gloss" "text" NOT NULL,
    "definition_text" "text" NOT NULL,
    "usage_note" "text",
    "scripture_refs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source_attribution" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "chk_lexical_senses_order" CHECK (("sense_order" > 0)),
    CONSTRAINT "lexical_senses_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."lexical_senses" OWNER TO "postgres";


ALTER TABLE "public"."lexical_senses" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lexical_senses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lxx_norm_word_summary" (
    "normalized_word" "text" NOT NULL,
    "occ_count" integer NOT NULL,
    "verse_keys" integer[] NOT NULL,
    "sample_rows" "jsonb" NOT NULL
);


ALTER TABLE "public"."lxx_norm_word_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lxx_swete_books" (
    "book_no" smallint NOT NULL,
    "file_name" "text" NOT NULL,
    "latin_name" "text" NOT NULL,
    "canonical_book" smallint,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint NOT NULL
);


ALTER TABLE "public"."lxx_swete_books" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lxx_swete_words" (
    "id" bigint NOT NULL,
    "book_no" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "verse_nr" smallint NOT NULL,
    "verse_suffix" "text" DEFAULT ''::"text" NOT NULL,
    "ordinal" integer NOT NULL,
    "word_text" "text" NOT NULL,
    "source_record_id" "text" NOT NULL,
    "source_release_id" bigint,
    "source_edition_id" bigint,
    "chapter_suffix" "text" DEFAULT ''::"text" NOT NULL,
    "normalized_word" "text"
);


ALTER TABLE "public"."lxx_swete_words" OWNER TO "postgres";


ALTER TABLE "public"."lxx_swete_words" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lxx_swete_words_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."macula_gated_field_values" (
    "morpheme_id" bigint NOT NULL,
    "dataset_key" "text" DEFAULT 'macula-hebrew'::"text" NOT NULL,
    "field_name" "text" NOT NULL,
    "field_value" "text" NOT NULL
);


ALTER TABLE "public"."macula_gated_field_values" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."macula_greek_tokens" (
    "id" bigint NOT NULL,
    "edition_key" "text" NOT NULL,
    "xml_id" "text" NOT NULL,
    "ref_nt" "text" NOT NULL,
    "book" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "verse_nr" smallint NOT NULL,
    "word_no" smallint NOT NULL,
    "role" "text",
    "part_of_speech" "text",
    "word_type" "text",
    "text_form" "text" NOT NULL,
    "after_text" "text",
    "lemma" "text" NOT NULL,
    "normalized" "text",
    "strongs" "text",
    "morph_code" "text" NOT NULL,
    "person" "text",
    "number" "text",
    "gender" "text",
    "case_value" "text",
    "tense" "text",
    "voice" "text",
    "mood" "text",
    "degree" "text",
    "gloss" "text",
    "english" "text",
    "mandarin" "text",
    "frame" "text",
    "subjref" "text",
    "referent" "text",
    "canonical_verse_id" integer,
    "step_word_id" integer,
    "link_status" "text" DEFAULT 'unmatched'::"text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'directly_imported'::"text" NOT NULL,
    "derivation_method" "text" DEFAULT 'macula_greek_tsv'::"text" NOT NULL,
    CONSTRAINT "macula_greek_tokens_book_check" CHECK ((("book" >= 40) AND ("book" <= 66))),
    CONSTRAINT "macula_greek_tokens_edition_key_check" CHECK (("edition_key" = ANY (ARRAY['macula-greek-nestle1904'::"text", 'macula-greek-sblgnt'::"text"]))),
    CONSTRAINT "macula_greek_tokens_link_status_check" CHECK (("link_status" = ANY (ARRAY['exact_form'::"text", 'diacritic_variant'::"text", 'variant_reading'::"text", 'unmatched'::"text", 'quarantined'::"text"]))),
    CONSTRAINT "macula_greek_tokens_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text", 'user_authored'::"text"])))
);


ALTER TABLE "public"."macula_greek_tokens" OWNER TO "postgres";


ALTER TABLE "public"."macula_greek_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."macula_greek_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."macula_greekstrong_morphemes" (
    "id" bigint NOT NULL,
    "morpheme_id" bigint NOT NULL,
    "book" "text" NOT NULL,
    "chapter_mt" smallint NOT NULL,
    "verse_mt" smallint NOT NULL,
    "strong_x" "text",
    "greekstrong" "text" NOT NULL,
    "greek_surface" "text"
);


ALTER TABLE "public"."macula_greekstrong_morphemes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."macula_greekstrong_morphemes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."macula_greekstrong_morphemes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."macula_greekstrong_morphemes_id_seq" OWNED BY "public"."macula_greekstrong_morphemes"."id";



CREATE TABLE IF NOT EXISTS "public"."macula_hebrew_morphemes" (
    "id" bigint NOT NULL,
    "macula_id" "text" NOT NULL,
    "ref_mt" "text" NOT NULL,
    "book" smallint NOT NULL,
    "chapter_mt" smallint NOT NULL,
    "verse_mt" smallint NOT NULL,
    "word_no" smallint NOT NULL,
    "morph_no" smallint NOT NULL,
    "class" "text",
    "text_form" "text",
    "after_text" "text",
    "lemma" "text",
    "strong_x" "text",
    "morph_code" "text",
    "lang" "text",
    "stem" "text",
    "morph_type" "text",
    "gloss" "text",
    "english" "text",
    "mandarin" "text",
    "sense_number" "text",
    "subjref" "text",
    "participantref" "text",
    "canonical_verse_id" integer,
    "word_id" integer,
    "link_status" "text" DEFAULT 'unlinked'::"text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'directly_imported'::"text" NOT NULL,
    "derivation_method" "text" DEFAULT 'macula_hebrew_tsv_row'::"text" NOT NULL,
    CONSTRAINT "chk_macula_link_status" CHECK (("link_status" = ANY (ARRAY['matched_consonantal'::"text", 'unmatched'::"text", 'quarantined'::"text", 'variant_reading'::"text"]))),
    CONSTRAINT "macula_hebrew_morphemes_link_status_check" CHECK (("link_status" = ANY (ARRAY['matched_consonantal'::"text", 'unmatched'::"text", 'unlinked'::"text"]))),
    CONSTRAINT "macula_hebrew_morphemes_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text"]))),
    CONSTRAINT "macula_hebrew_morphemes_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."macula_hebrew_morphemes" OWNER TO "postgres";


ALTER TABLE "public"."macula_hebrew_morphemes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."macula_hebrew_morphemes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."mcp_connection_chains" (
    "chain_id" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "session_hash" "text",
    "state" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."mcp_connection_chains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."morphhb_tokens" (
    "id" bigint NOT NULL,
    "morphhb_id" "text" NOT NULL,
    "book" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "verse_nr" smallint NOT NULL,
    "word_num" smallint NOT NULL,
    "word_text" "text" NOT NULL,
    "lemma" "text" NOT NULL,
    "morph_code" "text" NOT NULL,
    "cantillation" "text",
    "is_ketiv" boolean DEFAULT false NOT NULL,
    "is_qere" boolean DEFAULT false NOT NULL,
    "qere_target_id" "text",
    "is_aramaic" boolean DEFAULT false NOT NULL,
    "canonical_verse_id" integer,
    "step_word_id" integer,
    "macula_ref" "text",
    "link_status" "text" DEFAULT 'unlinked'::"text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'directly_imported'::"text" NOT NULL,
    "derivation_method" "text" DEFAULT 'morphhb_osis_xml_word'::"text" NOT NULL,
    CONSTRAINT "morphhb_tokens_link_status_check" CHECK (("link_status" = ANY (ARRAY['exact_form'::"text", 'consonantal_match'::"text", 'qere_form'::"text", 'ketiv_variant'::"text", 'unmatched'::"text", 'unlinked'::"text"]))),
    CONSTRAINT "morphhb_tokens_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text"]))),
    CONSTRAINT "morphhb_tokens_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text")),
    CONSTRAINT "morphhb_tokens_word_num_check" CHECK (("word_num" >= 1))
);


ALTER TABLE "public"."morphhb_tokens" OWNER TO "postgres";


ALTER TABLE "public"."morphhb_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."morphhb_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."needs" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text",
    "connectionpost_reference" bigint,
    "connectionpage_reference" bigint,
    "name" "text",
    "image" "text",
    "icon" "text",
    "description" "text",
    "link" "text",
    "given" double precision DEFAULT '0'::double precision,
    "price" double precision,
    "progress" double precision DEFAULT '0'::double precision,
    "product" "text",
    "prayed" bigint DEFAULT '0'::bigint,
    "help_current" bigint DEFAULT '0'::bigint,
    "help_goal" bigint,
    "button_text" "text",
    "connection_bank_id" bigint,
    "connection_adress_id" bigint,
    "show_on_map" boolean DEFAULT false,
    "coordinates_latitude" double precision,
    "coordinates_longitude" double precision,
    "parent" bigint,
    "currency" "text" DEFAULT 'CHF'::"text",
    "bank_reftext" "text",
    "priority" double precision,
    "connection_account" bigint DEFAULT '1'::bigint,
    "user_id" "text",
    "content_order" bigint[],
    "holyspirit_locked" boolean DEFAULT false
);


ALTER TABLE "public"."needs" OWNER TO "postgres";


ALTER TABLE "public"."needs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."needs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."note_anchors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "anchor_kind" "text" NOT NULL,
    "role" "text" DEFAULT 'mention'::"text" NOT NULL,
    "label" "text",
    "ordinal" integer DEFAULT 0 NOT NULL,
    "block_id" "uuid",
    "element_ref" "text",
    "verse_id" integer,
    "end_verse_id" integer,
    "word_position" integer,
    "word_id" integer,
    "lemma_id" bigint,
    "concept_id" bigint,
    "place_id" bigint,
    "event_id" bigint,
    "target_note_id" "uuid",
    "external_uri" "text",
    CONSTRAINT "chk_note_anchor_kind_columns" CHECK (
CASE "anchor_kind"
    WHEN 'verse'::"text" THEN (("verse_id" IS NOT NULL) AND ("num_nonnulls"("end_verse_id", "word_position", "word_id", "lemma_id", "concept_id", "place_id", "event_id", "target_note_id", "external_uri") = 0))
    WHEN 'verse_range'::"text" THEN (("verse_id" IS NOT NULL) AND ("end_verse_id" IS NOT NULL) AND ("end_verse_id" >= "verse_id") AND ("num_nonnulls"("word_position", "word_id", "lemma_id", "concept_id", "place_id", "event_id", "target_note_id", "external_uri") = 0))
    WHEN 'word_occurrence'::"text" THEN (("verse_id" IS NOT NULL) AND ("word_position" IS NOT NULL) AND ("word_position" >= 1) AND ("word_id" IS NOT NULL) AND ("num_nonnulls"("end_verse_id", "lemma_id", "concept_id", "place_id", "event_id", "target_note_id", "external_uri") = 0))
    WHEN 'word_form'::"text" THEN (("word_id" IS NOT NULL) AND ("num_nonnulls"("verse_id", "end_verse_id", "word_position", "lemma_id", "concept_id", "place_id", "event_id", "target_note_id", "external_uri") = 0))
    WHEN 'lemma'::"text" THEN (("lemma_id" IS NOT NULL) AND ("num_nonnulls"("verse_id", "end_verse_id", "word_position", "word_id", "concept_id", "place_id", "event_id", "target_note_id", "external_uri") = 0))
    WHEN 'concept'::"text" THEN (("concept_id" IS NOT NULL) AND ("num_nonnulls"("verse_id", "end_verse_id", "word_position", "word_id", "lemma_id", "place_id", "event_id", "target_note_id", "external_uri") = 0))
    WHEN 'place'::"text" THEN (("place_id" IS NOT NULL) AND ("num_nonnulls"("verse_id", "end_verse_id", "word_position", "word_id", "lemma_id", "concept_id", "event_id", "target_note_id", "external_uri") = 0))
    WHEN 'event'::"text" THEN (("event_id" IS NOT NULL) AND ("num_nonnulls"("verse_id", "end_verse_id", "word_position", "word_id", "lemma_id", "concept_id", "place_id", "target_note_id", "external_uri") = 0))
    WHEN 'note'::"text" THEN (("target_note_id" IS NOT NULL) AND ("num_nonnulls"("verse_id", "end_verse_id", "word_position", "word_id", "lemma_id", "concept_id", "place_id", "event_id", "external_uri") = 0))
    WHEN 'external'::"text" THEN (("external_uri" IS NOT NULL) AND ("external_uri" ~* '^https://[^\s<>"'']+$'::"text") AND ("label" IS NOT NULL) AND ("length"(TRIM(BOTH FROM "label")) > 0) AND ("num_nonnulls"("verse_id", "end_verse_id", "word_position", "word_id", "lemma_id", "concept_id", "place_id", "event_id", "target_note_id") = 0))
    ELSE false
END),
    CONSTRAINT "note_anchors_anchor_kind_check" CHECK (("anchor_kind" = ANY (ARRAY['verse'::"text", 'verse_range'::"text", 'word_occurrence'::"text", 'word_form'::"text", 'lemma'::"text", 'concept'::"text", 'place'::"text", 'event'::"text", 'note'::"text", 'external'::"text"]))),
    CONSTRAINT "note_anchors_role_check" CHECK (("role" = ANY (ARRAY['subject'::"text", 'object'::"text", 'mention'::"text", 'evidence'::"text"]))),
    CONSTRAINT "note_anchors_word_position_check" CHECK ((("word_position" IS NULL) OR ("word_position" >= 1)))
);


ALTER TABLE "public"."note_anchors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_authors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_kind" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "ai_provider" "text",
    "ai_model" "text",
    "ai_client" "text",
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "note_authors_author_kind_check" CHECK (("author_kind" = ANY (ARRAY['human'::"text", 'ai'::"text"]))),
    CONSTRAINT "note_authors_display_name_check" CHECK (("length"(TRIM(BOTH FROM "display_name")) > 0))
);


ALTER TABLE "public"."note_authors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_block_types" (
    "block_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "renderer_status" "text" NOT NULL,
    "is_enabled" boolean DEFAULT false NOT NULL,
    "required_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "url_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "max_bytes" integer DEFAULT 65536 NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "note_block_types_max_bytes_check" CHECK (("max_bytes" > 0)),
    CONSTRAINT "note_block_types_renderer_status_check" CHECK (("renderer_status" = ANY (ARRAY['available'::"text", 'planned'::"text"])))
);


ALTER TABLE "public"."note_block_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "ordinal" integer DEFAULT 0 NOT NULL,
    "block_type" "text" NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "text_alternative" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "note_blocks_ordinal_check" CHECK (("ordinal" >= 0)),
    CONSTRAINT "note_blocks_schema_version_check" CHECK (("schema_version" >= 1)),
    CONSTRAINT "note_blocks_text_alternative_check" CHECK (("length"("btrim"("text_alternative")) > 0))
);


ALTER TABLE "public"."note_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_connection_types" (
    "connection_type" "text" NOT NULL,
    "type_key" "text" GENERATED ALWAYS AS ("connection_type") STORED,
    "label" "text" NOT NULL,
    "inverse_label" "text" NOT NULL,
    "category" "text" NOT NULL,
    "default_direction" "text" NOT NULL,
    "is_symmetric" boolean DEFAULT false NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT true NOT NULL,
    CONSTRAINT "chk_note_conn_type_symmetric" CHECK (((NOT "is_symmetric") OR ("default_direction" = ANY (ARRAY['bidirectional'::"text", 'undirected'::"text"])))),
    CONSTRAINT "note_connection_types_category_check" CHECK (("category" = ANY (ARRAY['linguistic'::"text", 'textual'::"text", 'thematic'::"text", 'typological'::"text", 'historical'::"text", 'geographic'::"text", 'numerical'::"text", 'other'::"text"]))),
    CONSTRAINT "note_connection_types_default_direction_check" CHECK (("default_direction" = ANY (ARRAY['directed'::"text", 'bidirectional'::"text", 'undirected'::"text"])))
);


ALTER TABLE "public"."note_connection_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "from_anchor_id" "uuid" NOT NULL,
    "to_anchor_id" "uuid" NOT NULL,
    "connection_type" "text",
    "custom_label" "text",
    "direction" "text" DEFAULT 'undirected'::"text" NOT NULL,
    "explanation" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_conn_distinct_anchors" CHECK (("from_anchor_id" <> "to_anchor_id")),
    CONSTRAINT "note_connections_direction_check" CHECK (("direction" = ANY (ARRAY['directed'::"text", 'bidirectional'::"text", 'undirected'::"text"])))
);


ALTER TABLE "public"."note_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_kinds" (
    "note_kind" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text" NOT NULL
);


ALTER TABLE "public"."note_kinds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."note_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "action" "text" NOT NULL,
    "editor_author_id" "uuid" NOT NULL,
    "editor_kind" "text" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "note_revisions_action_check" CHECK (("action" = ANY (ARRAY['create'::"text", 'update'::"text", 'delete'::"text", 'review'::"text"]))),
    CONSTRAINT "note_revisions_editor_kind_check" CHECK (("editor_kind" = ANY (ARRAY['human'::"text", 'ai'::"text"]))),
    CONSTRAINT "note_revisions_version_check" CHECK (("version" >= 1))
);


ALTER TABLE "public"."note_revisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "author_kind" "text" NOT NULL,
    "note_kind" "text" NOT NULL,
    "title" "text",
    "body_md" "text" DEFAULT ''::"text" NOT NULL,
    "language" "text",
    "visibility" "text" DEFAULT 'public'::"text" NOT NULL,
    "status" "text" DEFAULT 'published'::"text" NOT NULL,
    "review_status" "text" DEFAULT 'unreviewed'::"text" NOT NULL,
    "reviewed_at" timestamp with time zone,
    "confidence" numeric,
    "created_via" "text" DEFAULT 'ui'::"text" NOT NULL,
    "source_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "supersedes_note_id" "uuid",
    "version" integer DEFAULT 1 NOT NULL,
    "client_request_id" "text",
    "content_hash" "text",
    "tsv" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"simple"'::"regconfig", ((COALESCE("title", ''::"text") || ' '::"text") || COALESCE("body_md", ''::"text")))) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_notes_dlm_v1_valid" CHECK (((NOT ("source_context" ? 'dlm_v1'::"text")) OR "public"."dlm_note_metadata_valid_v1"(("source_context" -> 'dlm_v1'::"text")))),
    CONSTRAINT "notes_author_kind_check" CHECK (("author_kind" = ANY (ARRAY['human'::"text", 'ai'::"text"]))),
    CONSTRAINT "notes_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "notes_created_via_check" CHECK (("created_via" = ANY (ARRAY['ui'::"text", 'mcp'::"text", 'import'::"text"]))),
    CONSTRAINT "notes_review_status_check" CHECK (("review_status" = ANY (ARRAY['unreviewed'::"text", 'confirmed'::"text", 'disputed'::"text"]))),
    CONSTRAINT "notes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text", 'removed'::"text"]))),
    CONSTRAINT "notes_version_check" CHECK (("version" >= 1)),
    CONSTRAINT "notes_visibility_check" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'unlisted'::"text", 'public'::"text"])))
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offers" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text",
    "connectionpost_reference" bigint,
    "connectionpage_reference" bigint,
    "name" "text",
    "description" "text",
    "image" "text",
    "icon" "text",
    "link" "text",
    "button_text" "text",
    "show_on_map" boolean DEFAULT false,
    "coordinates_latitude" double precision,
    "coordinates_longitude" double precision,
    "parent" bigint,
    "connection_account" bigint DEFAULT '1'::bigint,
    "user_id" "text",
    "content_order" bigint[],
    "holyspirit_locked" boolean DEFAULT false
);


ALTER TABLE "public"."offers" OWNER TO "postgres";


ALTER TABLE "public"."offers" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."offers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" bigint NOT NULL,
    "handle" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "description" "text",
    "website" "text",
    "instagram" "text",
    "facebook" "text",
    "youtube" "text",
    "priority" bigint,
    "holyspirit_locked" boolean DEFAULT false,
    "show_on_map" boolean,
    "coordinate_latitude" double precision,
    "coordinate_longitude" double precision,
    "profile_picture" "text",
    "filters" "text"[],
    "user_id" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "subtitle" "text",
    "account" bigint,
    "needs_title" "text" DEFAULT 'Needs'::"text",
    "needs_description" "text",
    "offers_title" "text" DEFAULT 'Offers'::"text",
    "offers_description" "text",
    "needs_order" bigint[],
    "offers_order" bigint[],
    "tumblr" "text",
    "pinterest" "text",
    "tiktok" "text",
    "x" "text",
    "linkedin" "text",
    "mail" "text",
    "post_order" bigint[],
    "content_order" bigint[],
    "bankaccounts" bigint[],
    "adresses" bigint[]
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


ALTER TABLE "public"."pages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."pages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."passage_geography" (
    "id" bigint NOT NULL,
    "passage_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "book" smallint NOT NULL,
    "start_chapter" smallint NOT NULL,
    "start_verse" smallint NOT NULL,
    "end_chapter" smallint NOT NULL,
    "end_verse" smallint NOT NULL,
    "place_id" bigint,
    "relationship_type" "text" NOT NULL,
    "resolution_tier" smallint NOT NULL,
    "confidence_level" "text" NOT NULL,
    "evidence_refs" "text" NOT NULL,
    "evidence_explanation" "text" NOT NULL,
    "chronology_event_id" bigint,
    "source_id" bigint NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    CONSTRAINT "passage_geography_book_check" CHECK ((("book" >= 1) AND ("book" <= 66))),
    CONSTRAINT "passage_geography_check" CHECK ((ROW("start_chapter", "start_verse") <= ROW("end_chapter", "end_verse"))),
    CONSTRAINT "passage_geography_confidence_level_check" CHECK (("confidence_level" = ANY (ARRAY['established'::"text", 'probable'::"text", 'disputed'::"text", 'regional'::"text", 'symbolic_non_physical'::"text", 'unknown'::"text"]))),
    CONSTRAINT "passage_geography_end_chapter_check" CHECK ((("end_chapter" >= 1) AND ("end_chapter" <= 150))),
    CONSTRAINT "passage_geography_end_verse_check" CHECK ((("end_verse" >= 0) AND ("end_verse" <= 176))),
    CONSTRAINT "passage_geography_relationship_type_check" CHECK (("relationship_type" = ANY (ARRAY['event_location'::"text", 'contextual_location'::"text", 'composition_location'::"text", 'audience_location'::"text", 'mentioned_location'::"text", 'travel_origin'::"text", 'travel_destination'::"text", 'uncertain_location'::"text"]))),
    CONSTRAINT "passage_geography_resolution_tier_check" CHECK ((("resolution_tier" >= 2) AND ("resolution_tier" <= 4))),
    CONSTRAINT "passage_geography_start_chapter_check" CHECK ((("start_chapter" >= 1) AND ("start_chapter" <= 150))),
    CONSTRAINT "passage_geography_start_verse_check" CHECK ((("start_verse" >= 0) AND ("start_verse" <= 176)))
);


ALTER TABLE "public"."passage_geography" OWNER TO "postgres";


ALTER TABLE "public"."passage_geography" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."passage_geography_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."place_locations" (
    "id" bigint NOT NULL,
    "location_key" "text" NOT NULL,
    "place_id" bigint NOT NULL,
    "rank_order" smallint DEFAULT 1 NOT NULL,
    "modern_name" "text" NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "geometry" "jsonb",
    "bbox" double precision[],
    "precision_kind" "text" NOT NULL,
    "location_status" "text" NOT NULL,
    "confidence_label" "text" NOT NULL,
    "raw_source_score" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_alternative" boolean DEFAULT false NOT NULL,
    "evidence_summary" "text" NOT NULL,
    "source_citations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source_id" bigint NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    CONSTRAINT "place_locations_bbox_check" CHECK ((("bbox" IS NULL) OR ("cardinality"("bbox") = 4))),
    CONSTRAINT "place_locations_latitude_check" CHECK ((("latitude" IS NULL) OR (("latitude" >= ('-90'::integer)::double precision) AND ("latitude" <= (90)::double precision)))),
    CONSTRAINT "place_locations_location_status_check" CHECK (("location_status" = ANY (ARRAY['established'::"text", 'probable'::"text", 'disputed'::"text", 'regional_only'::"text", 'unknown'::"text"]))),
    CONSTRAINT "place_locations_longitude_check" CHECK ((("longitude" IS NULL) OR (("longitude" >= ('-180'::integer)::double precision) AND ("longitude" <= (180)::double precision)))),
    CONSTRAINT "place_locations_precision_kind_check" CHECK (("precision_kind" = ANY (ARRAY['point'::"text", 'site_area'::"text", 'approximate_region'::"text", 'route'::"text", 'none'::"text"]))),
    CONSTRAINT "place_locations_rank_order_check" CHECK (("rank_order" >= 1))
);


ALTER TABLE "public"."place_locations" OWNER TO "postgres";


ALTER TABLE "public"."place_locations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."place_locations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."places" (
    "id" bigint NOT NULL,
    "place_key" "text" NOT NULL,
    "biblical_name" "text" NOT NULL,
    "historical_names" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "hebrew_name" "text",
    "greek_name" "text",
    "strongs_numbers" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "place_type" "text" NOT NULL,
    "is_non_physical" boolean DEFAULT false NOT NULL,
    "external_ids" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "primary_source_id" bigint NOT NULL,
    "source_info" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    "active_eras" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "period_names" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."places" OWNER TO "postgres";


ALTER TABLE "public"."places" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."places_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."posts" (
    "id" bigint NOT NULL,
    "reference_page" bigint,
    "title" "text",
    "description" "text",
    "holyspirit_locked" boolean DEFAULT false,
    "show_on_map" boolean,
    "coordinates_latitude" double precision,
    "coordinates_longitude" double precision,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handle" "text",
    "connection_account" bigint,
    "tags" "text"[],
    "needs_title" "text" DEFAULT 'NEEDS'::"text",
    "offers_title" "text" DEFAULT 'OFFERS'::"text",
    "needs_description" "text",
    "offers_description" "text",
    "needs_order" bigint[],
    "offers_order" bigint[],
    "user_id" "text",
    "content_order" bigint[]
);


ALTER TABLE "public"."posts" OWNER TO "postgres";


ALTER TABLE "public"."posts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."posts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."quarantined_evidence_records" (
    "id" bigint NOT NULL,
    "dataset_key" "text" NOT NULL,
    "source_edition_id" bigint,
    "source_record_id" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "raw_payload" "jsonb" NOT NULL,
    "quarantine_reason" "text" NOT NULL,
    "quarantine_status" "text" DEFAULT 'unresolved'::"text" NOT NULL,
    "quarantined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolution_notes" "text",
    CONSTRAINT "quarantined_evidence_records_quarantine_status_check" CHECK (("quarantine_status" = ANY (ARRAY['unresolved'::"text", 'reviewed_invalid'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."quarantined_evidence_records" OWNER TO "postgres";


COMMENT ON TABLE "public"."quarantined_evidence_records" IS 'Quarantine area for imported linguistic/biblical records with ambiguous, disputed, or unresolved referential mappings.';



ALTER TABLE "public"."quarantined_evidence_records" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."quarantined_evidence_records_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."reader_english_editions" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "sha256" "text" NOT NULL,
    "license" "text" NOT NULL,
    "mapping_note" "text" NOT NULL
);


ALTER TABLE "public"."reader_english_editions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reader_english_verses" (
    "edition_id" "text" NOT NULL,
    "book" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "verse_nr" smallint NOT NULL,
    "text" "text" NOT NULL,
    CONSTRAINT "reader_english_verses_book_check" CHECK ((("book" >= 1) AND ("book" <= 66))),
    CONSTRAINT "reader_english_verses_chapter_check" CHECK ((("chapter" >= 1) AND ("chapter" <= 150))),
    CONSTRAINT "reader_english_verses_text_check" CHECK (("length"("text") > 0)),
    CONSTRAINT "reader_english_verses_verse_nr_check" CHECK ((("verse_nr" >= 0) AND ("verse_nr" <= 176)))
);


ALTER TABLE "public"."reader_english_verses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reader_rendering_groups" (
    "strongs_nr" "text" NOT NULL,
    "label" "text" NOT NULL,
    "token_total" integer NOT NULL,
    "verse_total" integer NOT NULL,
    "example_verse_id" integer NOT NULL
);


ALTER TABLE "public"."reader_rendering_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reader_text_event_links" (
    "event_key" "text" NOT NULL,
    "book" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "start_verse" smallint NOT NULL,
    "end_verse" smallint NOT NULL,
    "label" "text" NOT NULL,
    CONSTRAINT "reader_text_event_links_check" CHECK (("start_verse" <= "end_verse"))
);


ALTER TABLE "public"."reader_text_event_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reader_text_events" (
    "event_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "era" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "source_reference" "text" NOT NULL,
    "relationship" "text" NOT NULL,
    "year_start" integer,
    "year_end" integer,
    CONSTRAINT "reader_text_events_check" CHECK ((("year_start" IS NULL) OR ("year_end" IS NULL) OR ("year_start" <= "year_end"))),
    CONSTRAINT "reader_text_events_relationship_check" CHECK (("relationship" = ANY (ARRAY['setting'::"text", 'parallel_text'::"text"])))
);


ALTER TABLE "public"."reader_text_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."relation_types" (
    "relation_type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "inverse_relation_type" "text",
    "is_symmetric" boolean DEFAULT false NOT NULL,
    "implies_synonymy" boolean DEFAULT false NOT NULL,
    "description" "text" NOT NULL,
    CONSTRAINT "relation_types_category_check" CHECK (("category" = ANY (ARRAY['lexical'::"text", 'etymological'::"text", 'morphosyntactic'::"text", 'versification'::"text", 'external_factual'::"text", 'textual_parallel'::"text", 'interpretive'::"text"]))),
    CONSTRAINT "relation_types_check" CHECK ((NOT (("category" = 'etymological'::"text") AND "implies_synonymy")))
);


ALTER TABLE "public"."relation_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_nodes" (
    "id" bigint NOT NULL,
    "node_key" "text" NOT NULL,
    "node_kind" "text" NOT NULL,
    "display_label" "text" NOT NULL,
    "lexeme_id" bigint,
    "concept_id" bigint,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "research_nodes_node_kind_check" CHECK (("node_kind" = ANY (ARRAY['lexeme'::"text", 'concept'::"text", 'passage_episode'::"text", 'textual_identification'::"text"])))
);


ALTER TABLE "public"."research_nodes" OWNER TO "postgres";


ALTER TABLE "public"."research_nodes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."research_nodes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."semantic_annotations" (
    "id" bigint NOT NULL,
    "edition_id" bigint NOT NULL,
    "verse_id" integer NOT NULL,
    "start_word_position" integer NOT NULL,
    "end_word_position" integer NOT NULL,
    "annotation_kind" "text" NOT NULL,
    "annotation_value" "text" NOT NULL,
    "lemma_id" bigint,
    "lexeme_id" bigint,
    "sense_id" bigint,
    "concept_id" bigint,
    "epistemic_layer" "text" DEFAULT 'lexical_reference'::"text" NOT NULL,
    "origin_mode" "text" NOT NULL,
    "derivation_method" "text",
    "algorithm_version" "text",
    "review_status" "text" DEFAULT 'reviewed'::"text" NOT NULL,
    "owner_user_id" "uuid",
    "source_release_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "semantic_annotations_annotation_kind_check" CHECK (("annotation_kind" = ANY (ARRAY['step_sub_meaning'::"text", 'named_entity_identity'::"text", 'contextual_lexeme_tag'::"text", 'literary_motif_span'::"text", 'user_note'::"text"]))),
    CONSTRAINT "semantic_annotations_check" CHECK (("end_word_position" >= "start_word_position")),
    CONSTRAINT "semantic_annotations_check1" CHECK (((("origin_mode" = 'user_authored'::"text") AND ("owner_user_id" IS NOT NULL) AND ("epistemic_layer" = 'user_interpretation'::"text")) OR (("origin_mode" <> 'user_authored'::"text") AND ("owner_user_id" IS NULL)))),
    CONSTRAINT "semantic_annotations_epistemic_layer_check" CHECK (("epistemic_layer" = ANY (ARRAY['primary_biblical'::"text", 'lexical_reference'::"text", 'external_factual'::"text", 'reviewed_interpretation'::"text", 'user_interpretation'::"text"]))),
    CONSTRAINT "semantic_annotations_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text", 'user_authored'::"text"]))),
    CONSTRAINT "semantic_annotations_review_status_check" CHECK (("review_status" = ANY (ARRAY['reviewed'::"text", 'candidate'::"text", 'rejected'::"text"]))),
    CONSTRAINT "semantic_annotations_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text")),
    CONSTRAINT "semantic_annotations_start_word_position_check" CHECK (("start_word_position" >= 1))
);


ALTER TABLE "public"."semantic_annotations" OWNER TO "postgres";


ALTER TABLE "public"."semantic_annotations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."semantic_annotations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."source_editions" (
    "id" bigint NOT NULL,
    "edition_key" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "edition_kind" "text" NOT NULL,
    "title" "text" NOT NULL,
    "language" "text" NOT NULL,
    "testament_scope" "text" NOT NULL,
    "versification_scheme" "text" NOT NULL,
    "license" "text" NOT NULL,
    "licensing_notes" "text",
    "source_url" "text",
    "file_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "source_editions_edition_kind_check" CHECK (("edition_kind" = ANY (ARRAY['hebrew_aramaic_text'::"text", 'greek_text'::"text", 'lexicon'::"text", 'english_translation'::"text", 'versification_system'::"text", 'external_gazetteer'::"text", 'chronology_dataset'::"text", 'annotation_corpus'::"text"]))),
    CONSTRAINT "source_editions_language_check" CHECK (("language" = ANY (ARRAY['hbo'::"text", 'arc'::"text", 'grc'::"text", 'en'::"text", 'mul'::"text"]))),
    CONSTRAINT "source_editions_testament_scope_check" CHECK (("testament_scope" = ANY (ARRAY['OT'::"text", 'NT'::"text", 'Both'::"text"]))),
    CONSTRAINT "source_editions_versification_scheme_check" CHECK (("versification_scheme" = ANY (ARRAY['english_standard'::"text", 'masoretic_hebrew'::"text", 'greek_eclectic'::"text", 'kjv_1769'::"text", 'not_applicable'::"text"])))
);


ALTER TABLE "public"."source_editions" OWNER TO "postgres";


ALTER TABLE "public"."source_editions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."source_editions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."source_releases" (
    "id" bigint NOT NULL,
    "release_key" "text" NOT NULL,
    "dataset" "text" NOT NULL,
    "commit_sha" "text" NOT NULL,
    "license" "text" NOT NULL,
    "attribution" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version_label" "text",
    "source_url" "text",
    "sha256_manifest" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "licensing_constraints" "text",
    "epistemic_layer" "text" DEFAULT 'primary_biblical'::"text" NOT NULL,
    CONSTRAINT "source_releases_epistemic_layer_check" CHECK (("epistemic_layer" = ANY (ARRAY['primary_biblical'::"text", 'lexical_reference'::"text", 'external_factual'::"text", 'reviewed_research'::"text"])))
);


ALTER TABLE "public"."source_releases" OWNER TO "postgres";


ALTER TABLE "public"."source_releases" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."source_releases_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."syntax_edges" (
    "id" bigint NOT NULL,
    "edition_id" bigint NOT NULL,
    "verse_id" integer NOT NULL,
    "dependent_word_position" integer NOT NULL,
    "head_word_position" integer NOT NULL,
    "source_node_id" bigint,
    "target_node_id" bigint,
    "relation_type" "text" NOT NULL,
    "head_strongs" "text",
    "raw_relation_tag" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'directly_imported'::"text" NOT NULL,
    "derivation_method" "text" NOT NULL,
    "algorithm_version" "text",
    CONSTRAINT "syntax_edges_dependent_word_position_check" CHECK (("dependent_word_position" >= 1)),
    CONSTRAINT "syntax_edges_head_word_position_check" CHECK (("head_word_position" >= 1)),
    CONSTRAINT "syntax_edges_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text"]))),
    CONSTRAINT "syntax_edges_relation_type_check" CHECK (("relation_type" = ANY (ARRAY['parent_child'::"text", 'head_complement'::"text", 'subject'::"text", 'object'::"text", 'predicate'::"text", 'modifier'::"text", 'specifier'::"text", 'conjunction'::"text", 'clause_dependency'::"text", 'conjoin_forward_head'::"text", 'conjoin_backward_head'::"text", 'prefix_to_stem'::"text", 'suffix_to_stem'::"text", 'modifier_attachment'::"text"]))),
    CONSTRAINT "syntax_edges_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text"))
);


ALTER TABLE "public"."syntax_edges" OWNER TO "postgres";


ALTER TABLE "public"."syntax_edges" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."syntax_edges_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."syntax_nodes" (
    "id" bigint NOT NULL,
    "node_key" "text" NOT NULL,
    "edition_id" bigint NOT NULL,
    "verse_id" integer NOT NULL,
    "node_type" "text" NOT NULL,
    "start_word_position" integer NOT NULL,
    "end_word_position" integer NOT NULL,
    "head_word_position" integer,
    "syntactic_role" "text",
    "grammar_summary" "text",
    "source_release_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "parent_node_id" bigint,
    "tree_id" "text",
    "depth" integer DEFAULT 0 NOT NULL,
    "sibling_order" integer DEFAULT 0 NOT NULL,
    "class_label" "text",
    "rule_label" "text",
    "cl_type" "text",
    "is_head" boolean DEFAULT false NOT NULL,
    "is_terminal" boolean DEFAULT false NOT NULL,
    "terminal_xml_id" "text",
    "terminal_word_id" integer,
    "semantic_frame" "text",
    "end_verse_id" integer,
    "is_cross_verse" boolean DEFAULT false NOT NULL,
    "terminal_source_ref" "text",
    "terminal_mapping_status" "text",
    CONSTRAINT "chk_syntax_nodes_no_self_parent" CHECK ((("parent_node_id" IS NULL) OR ("parent_node_id" <> "id"))),
    CONSTRAINT "syntax_nodes_check" CHECK (("end_word_position" >= "start_word_position")),
    CONSTRAINT "syntax_nodes_depth_check" CHECK (("depth" >= 0)),
    CONSTRAINT "syntax_nodes_head_word_position_check" CHECK ((("head_word_position" IS NULL) OR ("head_word_position" >= 1))),
    CONSTRAINT "syntax_nodes_node_type_check" CHECK (("node_type" = ANY (ARRAY['sentence'::"text", 'clause'::"text", 'phrase'::"text", 'conjoined_phrase'::"text", 'compound_word_group'::"text", 'terminal'::"text", 'token'::"text"]))),
    CONSTRAINT "syntax_nodes_sibling_order_check" CHECK (("sibling_order" >= 0)),
    CONSTRAINT "syntax_nodes_start_word_position_check" CHECK (("start_word_position" >= 1)),
    CONSTRAINT "syntax_nodes_terminal_mapping_status_check" CHECK ((("terminal_mapping_status" IS NULL) OR ("terminal_mapping_status" = ANY (ARRAY['exact_xml_id'::"text", 'source_reference_only'::"text"]))))
);


ALTER TABLE "public"."syntax_nodes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."syntax_nodes"."terminal_mapping_status" IS 'How a terminal maps to canonical verse/word: exact source XML id or unverified source reference only; reference-only never implies a verified STEP lexical identity.';



ALTER TABLE "public"."syntax_nodes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."syntax_nodes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tagnt_tokens" (
    "id" bigint NOT NULL,
    "tagnt_id" "text" NOT NULL,
    "word_type" "text" NOT NULL,
    "surface_greek" "text" NOT NULL,
    "transliteration" "text" NOT NULL,
    "english_translation" "text",
    "dstrongs" "text" NOT NULL,
    "grammar_code" "text" NOT NULL,
    "lemma" "text" NOT NULL,
    "step_gloss" "text",
    "editions" "text" NOT NULL,
    "meaning_variants" "text",
    "spelling_variants" "text",
    "spanish_translation" "text",
    "sub_meaning" "text",
    "conjoin_word" "text",
    "sstrong_instance" "text",
    "alt_strongs" "text",
    "book" smallint NOT NULL,
    "chapter" smallint NOT NULL,
    "verse_nr" smallint NOT NULL,
    "word_position" smallint NOT NULL,
    "canonical_verse_id" integer,
    "step_word_id" integer,
    "link_status" "text" DEFAULT 'exact_match'::"text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_edition_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'directly_imported'::"text" NOT NULL,
    "derivation_method" "text" DEFAULT 'stepbible_tagnt_txt'::"text" NOT NULL,
    CONSTRAINT "tagnt_tokens_book_check" CHECK ((("book" >= 40) AND ("book" <= 66))),
    CONSTRAINT "tagnt_tokens_link_status_check" CHECK (("link_status" = ANY (ARRAY['exact_match'::"text", 'variant_reading'::"text", 'spelling_variant'::"text", 'traditional_addition'::"text", 'critical_omission'::"text", 'unmatched'::"text"]))),
    CONSTRAINT "tagnt_tokens_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text", 'user_authored'::"text"])))
);


ALTER TABLE "public"."tagnt_tokens" OWNER TO "postgres";


ALTER TABLE "public"."tagnt_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."tagnt_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."test_guard_probe" (
    "id" integer
);


ALTER TABLE "public"."test_guard_probe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_morphemes" (
    "id" bigint NOT NULL,
    "edition_id" bigint NOT NULL,
    "verse_id" integer NOT NULL,
    "word_position" integer NOT NULL,
    "component_order" smallint DEFAULT 1 NOT NULL,
    "morpheme_role" "text" NOT NULL,
    "surface_form" "text",
    "transliteration" "text",
    "grammar_code" "text",
    "morpheme_gloss" "text",
    "dstrongs_tag" "text" NOT NULL,
    "lemma_id" bigint,
    "lexeme_id" bigint,
    "source_release_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    CONSTRAINT "chk_token_morphemes_role" CHECK (("morpheme_role" = ANY (ARRAY['stem'::"text", 'prefix_particle'::"text", 'prefix_preposition'::"text", 'prefix_conjunction'::"text", 'prefix_article'::"text", 'pronominal_suffix'::"text"]))),
    CONSTRAINT "token_morphemes_component_order_check" CHECK (("component_order" >= 1)),
    CONSTRAINT "token_morphemes_morpheme_role_check" CHECK (("morpheme_role" = ANY (ARRAY['stem'::"text", 'prefix_preposition'::"text", 'prefix_conjunction'::"text", 'prefix_article'::"text", 'prefix_particle'::"text", 'pronominal_suffix'::"text", 'particle'::"text"]))),
    CONSTRAINT "token_morphemes_word_position_check" CHECK (("word_position" >= 1))
);


ALTER TABLE "public"."token_morphemes" OWNER TO "postgres";


ALTER TABLE "public"."token_morphemes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."token_morphemes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."verse_geography" (
    "id" bigint NOT NULL,
    "verse_id" integer NOT NULL,
    "place_id" bigint NOT NULL,
    "relationship_type" "text" NOT NULL,
    "resolution_tier" smallint NOT NULL,
    "is_inferred" boolean DEFAULT false NOT NULL,
    "confidence_level" "text" NOT NULL,
    "evidence_ref" "text" NOT NULL,
    "evidence_explanation" "text" NOT NULL,
    "establishing_passage_id" bigint,
    "chronology_event_id" bigint,
    "source_id" bigint NOT NULL,
    "verification_origin" "text" DEFAULT 'verified_source'::"text" NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    CONSTRAINT "verse_geography_check" CHECK (((NOT "published") OR ("verification_origin" <> 'ai_candidate'::"text"))),
    CONSTRAINT "verse_geography_confidence_level_check" CHECK (("confidence_level" = ANY (ARRAY['established'::"text", 'probable'::"text", 'disputed'::"text", 'regional'::"text", 'symbolic_non_physical'::"text", 'unknown'::"text"]))),
    CONSTRAINT "verse_geography_relationship_type_check" CHECK (("relationship_type" = ANY (ARRAY['event_location'::"text", 'contextual_location'::"text", 'composition_location'::"text", 'audience_location'::"text", 'mentioned_location'::"text", 'travel_origin'::"text", 'travel_destination'::"text", 'uncertain_location'::"text"]))),
    CONSTRAINT "verse_geography_resolution_tier_check" CHECK ((("resolution_tier" >= 1) AND ("resolution_tier" <= 4))),
    CONSTRAINT "verse_geography_verification_origin_check" CHECK (("verification_origin" = ANY (ARRAY['verified_source'::"text", 'curated_passage'::"text", 'ai_candidate'::"text"])))
);


ALTER TABLE "public"."verse_geography" OWNER TO "postgres";


ALTER TABLE "public"."verse_geography" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."verse_geography_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."verse_translation_sources" (
    "verse_id" integer NOT NULL,
    "word_position" integer NOT NULL,
    "word_id" integer NOT NULL,
    "source_english" "text" NOT NULL,
    "grammar_code" "text" NOT NULL,
    "source_name" "text" NOT NULL,
    "source_ref" "text" NOT NULL,
    "source_commit" "text" NOT NULL,
    CONSTRAINT "verse_translation_sources_source_commit_check" CHECK (("length"("source_commit") = 40)),
    CONSTRAINT "verse_translation_sources_word_position_check" CHECK (("word_position" > 0))
);


ALTER TABLE "public"."verse_translation_sources" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."verses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."verses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."verses_id_seq" OWNED BY "public"."verses"."id";



CREATE TABLE IF NOT EXISTS "public"."versification_mappings" (
    "id" bigint NOT NULL,
    "canonical_verse_id" integer NOT NULL,
    "from_edition_id" bigint NOT NULL,
    "from_ref" "text" NOT NULL,
    "to_edition_id" bigint NOT NULL,
    "to_book" smallint NOT NULL,
    "to_chapter" smallint NOT NULL,
    "to_verse_nr" smallint NOT NULL,
    "to_ref" "text" NOT NULL,
    "mapping_kind" "text" NOT NULL,
    "source_release_id" bigint NOT NULL,
    "source_record_id" "text" NOT NULL,
    "origin_mode" "text" DEFAULT 'directly_imported'::"text" NOT NULL,
    "derivation_method" "text" NOT NULL,
    "algorithm_version" "text",
    CONSTRAINT "versification_mappings_mapping_kind_check" CHECK (("mapping_kind" = ANY (ARRAY['chapter_verse_shift'::"text", 'psalm_superscription_shift'::"text", 'kjv_bracket_shift'::"text", 'split_or_merged'::"text", 'absent_in_edition'::"text"]))),
    CONSTRAINT "versification_mappings_origin_mode_check" CHECK (("origin_mode" = ANY (ARRAY['directly_imported'::"text", 'algorithmically_calculated'::"text", 'user_authored'::"text"]))),
    CONSTRAINT "versification_mappings_source_record_id_check" CHECK (("btrim"("source_record_id") <> ''::"text")),
    CONSTRAINT "versification_mappings_to_chapter_check" CHECK (("to_chapter" >= 0)),
    CONSTRAINT "versification_mappings_to_verse_nr_check" CHECK (("to_verse_nr" >= 0))
);


ALTER TABLE "public"."versification_mappings" OWNER TO "postgres";


ALTER TABLE "public"."versification_mappings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."versification_mappings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."word_form_lemmas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."word_form_lemmas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."word_translation_choices" (
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "verse_id" integer NOT NULL,
    "word_position" integer NOT NULL,
    "word_id" integer NOT NULL,
    "english" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "word_translation_choices_english_check" CHECK (("length"("english") <= 2000))
);


ALTER TABLE "public"."word_translation_choices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."words" (
    "id" integer NOT NULL,
    "strongs_nr" character varying(10) NOT NULL,
    "grammar_code" character varying(30),
    "original_word" "text" NOT NULL,
    "transliteration" "text" NOT NULL,
    "co_occurrences" "jsonb" DEFAULT '[]'::"jsonb",
    "biblical_def" "text",
    "physical_def" "text",
    "english_translations" "text"[] DEFAULT '{}'::"text"[],
    "gematria" integer GENERATED ALWAYS AS ("public"."calculate_gematria"("original_word")) STORED
);


ALTER TABLE "public"."words" OWNER TO "postgres";


ALTER TABLE ONLY "public"."macula_greekstrong_morphemes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."macula_greekstrong_morphemes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."verses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."verses_id_seq"'::"regclass");



ALTER TABLE ONLY "bible_internal"."b7_greek_terminal_repair_20261109"
    ADD CONSTRAINT "b7_greek_terminal_repair_20261109_pkey" PRIMARY KEY ("syntax_node_id");



ALTER TABLE ONLY "bible_internal"."macula_gated_restricted_frames"
    ADD CONSTRAINT "macula_gated_restricted_frames_pkey" PRIMARY KEY ("morpheme_id", "field_name");



ALTER TABLE ONLY "bible_internal"."macula_syntax_import_files"
    ADD CONSTRAINT "macula_syntax_import_files_edition_key_source_path_key" UNIQUE ("edition_key", "source_path");



ALTER TABLE ONLY "bible_internal"."macula_syntax_import_files"
    ADD CONSTRAINT "macula_syntax_import_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "bible_internal"."macula_syntax_unmapped_nodes"
    ADD CONSTRAINT "macula_syntax_unmapped_nodes_pkey" PRIMARY KEY ("node_key");



ALTER TABLE ONLY "public"."assertion_evidence"
    ADD CONSTRAINT "assertion_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assertions"
    ADD CONSTRAINT "assertions_assertion_key_key" UNIQUE ("assertion_key");



ALTER TABLE ONLY "public"."assertions"
    ADD CONSTRAINT "assertions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bol_events"
    ADD CONSTRAINT "bol_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bol_profiles"
    ADD CONSTRAINT "bol_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bol_years"
    ADD CONSTRAINT "bol_years_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bol_years"
    ADD CONSTRAINT "bol_years_user_id_year_key" UNIQUE ("user_id", "year");



ALTER TABLE ONLY "public"."book_aliases"
    ADD CONSTRAINT "book_aliases_pkey" PRIMARY KEY ("alias");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_theographic_code_key" UNIQUE ("theographic_code");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_usfm_key" UNIQUE ("usfm");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_entity_key_key" UNIQUE ("entity_key");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_active_runs"
    ADD CONSTRAINT "chronology_active_runs_pkey" PRIMARY KEY ("model_id");



ALTER TABLE ONLY "public"."chronology_assertion_evidence"
    ADD CONSTRAINT "chronology_assertion_evidence_pkey" PRIMARY KEY ("assertion_id", "evidence_id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_assertion_key_key" UNIQUE ("assertion_key");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_id_model_id_key" UNIQUE ("id", "model_id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_assignment_assertions"
    ADD CONSTRAINT "chronology_assignment_assertions_pkey" PRIMARY KEY ("run_id", "verse_id", "assertion_id");



ALTER TABLE ONLY "public"."chronology_assignments"
    ADD CONSTRAINT "chronology_assignments_pkey" PRIMARY KEY ("run_id", "verse_id");



ALTER TABLE ONLY "public"."chronology_assignments"
    ADD CONSTRAINT "chronology_assignments_run_id_verse_id_model_id_key" UNIQUE ("run_id", "verse_id", "model_id");



ALTER TABLE ONLY "public"."chronology_event_links"
    ADD CONSTRAINT "chronology_event_links_pkey" PRIMARY KEY ("event_id", "verse_id");



ALTER TABLE ONLY "public"."chronology_events"
    ADD CONSTRAINT "chronology_events_event_key_key" UNIQUE ("event_key");



ALTER TABLE ONLY "public"."chronology_events"
    ADD CONSTRAINT "chronology_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_evidence"
    ADD CONSTRAINT "chronology_evidence_evidence_key_key" UNIQUE ("evidence_key");



ALTER TABLE ONLY "public"."chronology_evidence"
    ADD CONSTRAINT "chronology_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_models"
    ADD CONSTRAINT "chronology_models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_revisions"
    ADD CONSTRAINT "chronology_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_revisions"
    ADD CONSTRAINT "chronology_revisions_proposal_key_action_key" UNIQUE ("proposal_key", "action");



ALTER TABLE ONLY "public"."chronology_runs"
    ADD CONSTRAINT "chronology_runs_id_model_id_key" UNIQUE ("id", "model_id");



ALTER TABLE ONLY "public"."chronology_runs"
    ADD CONSTRAINT "chronology_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_sources"
    ADD CONSTRAINT "chronology_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronology_sources"
    ADD CONSTRAINT "chronology_sources_source_key_key" UNIQUE ("source_key");



ALTER TABLE ONLY "public"."concept_aliases"
    ADD CONSTRAINT "concept_aliases_concept_id_alias_normalized_key" UNIQUE ("concept_id", "alias_normalized");



ALTER TABLE ONLY "public"."concept_aliases"
    ADD CONSTRAINT "concept_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."concept_external_links"
    ADD CONSTRAINT "concept_external_links_concept_id_provider_external_id_key" UNIQUE ("concept_id", "provider", "external_id");



ALTER TABLE ONLY "public"."concept_external_links"
    ADD CONSTRAINT "concept_external_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."concept_properties"
    ADD CONSTRAINT "concept_properties_concept_id_property_key_property_value_s_key" UNIQUE ("concept_id", "property_key", "property_value", "source_record_id");



ALTER TABLE ONLY "public"."concept_properties"
    ADD CONSTRAINT "concept_properties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."concepts"
    ADD CONSTRAINT "concepts_concept_key_key" UNIQUE ("concept_key");



ALTER TABLE ONLY "public"."concepts"
    ADD CONSTRAINT "concepts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_canonical_verse_id_step_word_id_morphh_key" UNIQUE ("canonical_verse_id", "step_word_id", "morphhb_token_id", "macula_morpheme_id", "mapping_status");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edition_passages"
    ADD CONSTRAINT "edition_passages_edition_id_edition_ref_key" UNIQUE ("edition_id", "edition_ref");



ALTER TABLE ONLY "public"."edition_passages"
    ADD CONSTRAINT "edition_passages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_relationship_key_key" UNIQUE ("relationship_key");



ALTER TABLE ONLY "public"."field_license_registry"
    ADD CONSTRAINT "field_license_registry_dataset_key_field_name_key" UNIQUE ("dataset_key", "field_name");



ALTER TABLE ONLY "public"."field_license_registry"
    ADD CONSTRAINT "field_license_registry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."geography_sources"
    ADD CONSTRAINT "geography_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."geography_sources"
    ADD CONSTRAINT "geography_sources_source_key_key" UNIQUE ("source_key");



ALTER TABLE ONLY "public"."hebrew_lxx_verse_map"
    ADD CONSTRAINT "hebrew_lxx_verse_map_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hebrew_lxx_word_alignments"
    ADD CONSTRAINT "hebrew_lxx_word_alignments_alignment_key_key" UNIQUE ("alignment_key");



ALTER TABLE ONLY "public"."hebrew_lxx_word_alignments"
    ADD CONSTRAINT "hebrew_lxx_word_alignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lemma_components"
    ADD CONSTRAINT "lemma_components_formation_id_component_order_key" UNIQUE ("formation_id", "component_order");



ALTER TABLE ONLY "public"."lemma_components"
    ADD CONSTRAINT "lemma_components_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lemma_root_links"
    ADD CONSTRAINT "lemma_root_links_lemma_id_root_id_etymology_type_key" UNIQUE ("lemma_id", "root_id", "etymology_type");



ALTER TABLE ONLY "public"."lemma_root_links"
    ADD CONSTRAINT "lemma_root_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lemmas"
    ADD CONSTRAINT "lemmas_lemma_key_key" UNIQUE ("lemma_key");



ALTER TABLE ONLY "public"."lemmas"
    ADD CONSTRAINT "lemmas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lexeme_identifiers"
    ADD CONSTRAINT "lexeme_identifiers_lexeme_id_id_namespace_id_value_key" UNIQUE ("lexeme_id", "id_namespace", "id_value");



ALTER TABLE ONLY "public"."lexeme_identifiers"
    ADD CONSTRAINT "lexeme_identifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lexemes"
    ADD CONSTRAINT "lexemes_lexeme_key_key" UNIQUE ("lexeme_key");



ALTER TABLE ONLY "public"."lexemes"
    ADD CONSTRAINT "lexemes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lexical_connections"
    ADD CONSTRAINT "lexical_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lexical_connections"
    ADD CONSTRAINT "lexical_connections_subject_lemma_id_target_lemma_id_relati_key" UNIQUE ("subject_lemma_id", "target_lemma_id", "relation_type");



ALTER TABLE ONLY "public"."lexical_formations"
    ADD CONSTRAINT "lexical_formations_lemma_id_analysis_key_key" UNIQUE ("lemma_id", "analysis_key");



ALTER TABLE ONLY "public"."lexical_formations"
    ADD CONSTRAINT "lexical_formations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lexical_roots"
    ADD CONSTRAINT "lexical_roots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lexical_roots"
    ADD CONSTRAINT "lexical_roots_root_key_key" UNIQUE ("root_key");



ALTER TABLE ONLY "public"."lexical_senses"
    ADD CONSTRAINT "lexical_senses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lexical_senses"
    ADD CONSTRAINT "lexical_senses_sense_key_key" UNIQUE ("sense_key");



ALTER TABLE ONLY "public"."lxx_norm_word_summary"
    ADD CONSTRAINT "lxx_norm_word_summary_pkey" PRIMARY KEY ("normalized_word");



ALTER TABLE ONLY "public"."lxx_swete_books"
    ADD CONSTRAINT "lxx_swete_books_file_name_key" UNIQUE ("file_name");



ALTER TABLE ONLY "public"."lxx_swete_books"
    ADD CONSTRAINT "lxx_swete_books_pkey" PRIMARY KEY ("book_no");



ALTER TABLE ONLY "public"."lxx_swete_words"
    ADD CONSTRAINT "lxx_swete_words_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."macula_gated_field_values"
    ADD CONSTRAINT "macula_gated_field_values_pkey" PRIMARY KEY ("morpheme_id", "field_name");



ALTER TABLE ONLY "public"."macula_greek_tokens"
    ADD CONSTRAINT "macula_greek_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."macula_greekstrong_morphemes"
    ADD CONSTRAINT "macula_greekstrong_morphemes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."macula_hebrew_morphemes"
    ADD CONSTRAINT "macula_hebrew_morphemes_macula_id_key" UNIQUE ("macula_id");



ALTER TABLE ONLY "public"."macula_hebrew_morphemes"
    ADD CONSTRAINT "macula_hebrew_morphemes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_connection_chains"
    ADD CONSTRAINT "mcp_connection_chains_pkey" PRIMARY KEY ("chain_id");



ALTER TABLE ONLY "public"."morphhb_tokens"
    ADD CONSTRAINT "morphhb_tokens_morphhb_id_key" UNIQUE ("morphhb_id");



ALTER TABLE ONLY "public"."morphhb_tokens"
    ADD CONSTRAINT "morphhb_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."needs"
    ADD CONSTRAINT "needs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."note_authors"
    ADD CONSTRAINT "note_authors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."note_block_types"
    ADD CONSTRAINT "note_block_types_pkey" PRIMARY KEY ("block_type");



ALTER TABLE ONLY "public"."note_blocks"
    ADD CONSTRAINT "note_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."note_connection_types"
    ADD CONSTRAINT "note_connection_types_pkey" PRIMARY KEY ("connection_type");



ALTER TABLE ONLY "public"."note_connections"
    ADD CONSTRAINT "note_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."note_kinds"
    ADD CONSTRAINT "note_kinds_pkey" PRIMARY KEY ("note_kind");



ALTER TABLE ONLY "public"."note_revisions"
    ADD CONSTRAINT "note_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."note_settings"
    ADD CONSTRAINT "note_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offers"
    ADD CONSTRAINT "offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."passage_geography"
    ADD CONSTRAINT "passage_geography_passage_key_key" UNIQUE ("passage_key");



ALTER TABLE ONLY "public"."passage_geography"
    ADD CONSTRAINT "passage_geography_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."place_locations"
    ADD CONSTRAINT "place_locations_location_key_key" UNIQUE ("location_key");



ALTER TABLE ONLY "public"."place_locations"
    ADD CONSTRAINT "place_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."places"
    ADD CONSTRAINT "places_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."places"
    ADD CONSTRAINT "places_place_key_key" UNIQUE ("place_key");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quarantined_evidence_records"
    ADD CONSTRAINT "quarantined_evidence_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reader_english_editions"
    ADD CONSTRAINT "reader_english_editions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reader_english_verses"
    ADD CONSTRAINT "reader_english_verses_pkey" PRIMARY KEY ("edition_id", "book", "chapter", "verse_nr");



ALTER TABLE ONLY "public"."reader_rendering_groups"
    ADD CONSTRAINT "reader_rendering_groups_pkey" PRIMARY KEY ("strongs_nr", "label");



ALTER TABLE ONLY "public"."reader_text_event_links"
    ADD CONSTRAINT "reader_text_event_links_pkey" PRIMARY KEY ("event_key", "book", "chapter");



ALTER TABLE ONLY "public"."reader_text_events"
    ADD CONSTRAINT "reader_text_events_pkey" PRIMARY KEY ("event_key");



ALTER TABLE ONLY "public"."relation_types"
    ADD CONSTRAINT "relation_types_pkey" PRIMARY KEY ("relation_type");



ALTER TABLE ONLY "public"."research_nodes"
    ADD CONSTRAINT "research_nodes_node_key_key" UNIQUE ("node_key");



ALTER TABLE ONLY "public"."research_nodes"
    ADD CONSTRAINT "research_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_edition_id_verse_id_start_word_positio_key" UNIQUE ("edition_id", "verse_id", "start_word_position", "end_word_position", "annotation_kind", "source_record_id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_editions"
    ADD CONSTRAINT "source_editions_edition_key_key" UNIQUE ("edition_key");



ALTER TABLE ONLY "public"."source_editions"
    ADD CONSTRAINT "source_editions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_releases"
    ADD CONSTRAINT "source_releases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_releases"
    ADD CONSTRAINT "source_releases_release_key_key" UNIQUE ("release_key");



ALTER TABLE ONLY "public"."syntax_edges"
    ADD CONSTRAINT "syntax_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_node_key_key" UNIQUE ("node_key");



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tagnt_tokens"
    ADD CONSTRAINT "tagnt_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_morphemes"
    ADD CONSTRAINT "token_morphemes_edition_id_verse_id_word_position_component_key" UNIQUE ("edition_id", "verse_id", "word_position", "component_order");



ALTER TABLE ONLY "public"."token_morphemes"
    ADD CONSTRAINT "token_morphemes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hebrew_lxx_verse_map"
    ADD CONSTRAINT "uq_hebrew_lxx_verse_map_full" UNIQUE ("canonical_verse_id", "lxx_book_no", "lxx_chapter", "lxx_chapter_suffix", "lxx_verse_nr", "lxx_verse_suffix");



ALTER TABLE ONLY "public"."lxx_swete_words"
    ADD CONSTRAINT "uq_lxx_swete_words_position" UNIQUE ("book_no", "chapter", "chapter_suffix", "verse_nr", "verse_suffix", "ordinal");



ALTER TABLE ONLY "public"."macula_greek_tokens"
    ADD CONSTRAINT "uq_macula_greek_edition_xmlid" UNIQUE ("edition_key", "xml_id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "uq_note_anchors_id_note" UNIQUE ("id", "note_id");



ALTER TABLE ONLY "public"."note_authors"
    ADD CONSTRAINT "uq_note_authors_id_kind" UNIQUE ("id", "author_kind");



ALTER TABLE ONLY "public"."tagnt_tokens"
    ADD CONSTRAINT "uq_tagnt_token_id" UNIQUE ("source_release_id", "tagnt_id");



ALTER TABLE ONLY "public"."verse_geography"
    ADD CONSTRAINT "verse_geography_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verse_geography"
    ADD CONSTRAINT "verse_geography_verse_id_place_id_relationship_type_key" UNIQUE ("verse_id", "place_id", "relationship_type");



ALTER TABLE ONLY "public"."verse_translation_sources"
    ADD CONSTRAINT "verse_translation_sources_pkey" PRIMARY KEY ("verse_id", "word_position");



ALTER TABLE ONLY "public"."verse_translation_sources"
    ADD CONSTRAINT "verse_translation_sources_verse_id_word_position_word_id_key" UNIQUE ("verse_id", "word_position", "word_id");



ALTER TABLE ONLY "public"."verses"
    ADD CONSTRAINT "verses_book_chapter_verse_nr_key" UNIQUE ("book", "chapter", "verse_nr");



ALTER TABLE ONLY "public"."verses"
    ADD CONSTRAINT "verses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."versification_mappings"
    ADD CONSTRAINT "versification_mappings_canonical_verse_id_from_edition_id_t_key" UNIQUE ("canonical_verse_id", "from_edition_id", "to_edition_id", "to_ref");



ALTER TABLE ONLY "public"."versification_mappings"
    ADD CONSTRAINT "versification_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."word_form_lemmas"
    ADD CONSTRAINT "word_form_lemmas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."word_form_lemmas"
    ADD CONSTRAINT "word_form_lemmas_word_id_component_order_dstrongs_tag_key" UNIQUE ("word_id", "component_order", "dstrongs_tag");



ALTER TABLE ONLY "public"."word_translation_choices"
    ADD CONSTRAINT "word_translation_choices_pkey" PRIMARY KEY ("owner_id", "verse_id", "word_position");



ALTER TABLE ONLY "public"."words"
    ADD CONSTRAINT "words_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_macula_import_edition_fk" ON "bible_internal"."macula_syntax_import_files" USING "btree" ("edition_id");



CREATE INDEX "idx_macula_import_pending" ON "bible_internal"."macula_syntax_import_files" USING "btree" ("edition_key", "id") WHERE ("import_status" = 'pending'::"text");



CREATE INDEX "idx_macula_import_release_fk" ON "bible_internal"."macula_syntax_import_files" USING "btree" ("source_release_id");



CREATE INDEX "idx_macula_source_only_file" ON "bible_internal"."macula_syntax_unmapped_nodes" USING "btree" ("source_file_id");



CREATE INDEX "idx_macula_source_only_parent" ON "bible_internal"."macula_syntax_unmapped_nodes" USING "btree" ("parent_node_key");



CREATE INDEX "idx_macula_unmapped_edition_fk" ON "bible_internal"."macula_syntax_unmapped_nodes" USING "btree" ("edition_id");



CREATE INDEX "idx_macula_unmapped_release_fk" ON "bible_internal"."macula_syntax_unmapped_nodes" USING "btree" ("source_release_id");



CREATE INDEX "chronology_active_runs_run_id_model_id_idx" ON "public"."chronology_active_runs" USING "btree" ("run_id", "model_id");



CREATE INDEX "chronology_assertion_evidence_evidence_id_idx" ON "public"."chronology_assertion_evidence" USING "btree" ("evidence_id");



CREATE INDEX "chronology_assertions_event_id_idx" ON "public"."chronology_assertions" USING "btree" ("event_id");



CREATE INDEX "chronology_assertions_model_id_verse_id_id_idx" ON "public"."chronology_assertions" USING "btree" ("model_id", "verse_id", "id");



CREATE INDEX "chronology_assertions_source_id_idx" ON "public"."chronology_assertions" USING "btree" ("source_id");



CREATE INDEX "chronology_assertions_supersedes_idx" ON "public"."chronology_assertions" USING "btree" ("supersedes");



CREATE INDEX "chronology_assertions_verse_id_id_idx" ON "public"."chronology_assertions" USING "btree" ("verse_id", "id");



CREATE INDEX "chronology_assignment_assertions_assertion_id_model_id_idx" ON "public"."chronology_assignment_assertions" USING "btree" ("assertion_id", "model_id");



CREATE INDEX "chronology_assignments_verse_id_model_id_idx" ON "public"."chronology_assignments" USING "btree" ("verse_id", "model_id");



CREATE INDEX "chronology_event_links_verse_id_event_id_idx" ON "public"."chronology_event_links" USING "btree" ("verse_id", "event_id");



CREATE INDEX "chronology_events_source_id_idx" ON "public"."chronology_events" USING "btree" ("source_id");



CREATE INDEX "chronology_evidence_source_id_idx" ON "public"."chronology_evidence" USING "btree" ("source_id");



CREATE UNIQUE INDEX "chronology_one_revision_decision" ON "public"."chronology_revisions" USING "btree" ("proposal_key") WHERE ("action" = ANY (ARRAY['approved'::"text", 'rejected'::"text"]));



CREATE INDEX "chronology_revisions_model_id_parent_run_id_idx" ON "public"."chronology_revisions" USING "btree" ("model_id", "parent_run_id");



CREATE INDEX "chronology_runs_model_id_id_idx" ON "public"."chronology_runs" USING "btree" ("model_id", "id");



CREATE INDEX "idx_assertion_evidence_assertion" ON "public"."assertion_evidence" USING "btree" ("assertion_id", "step_order");



CREATE INDEX "idx_assertions_object" ON "public"."assertions" USING "btree" ("object_node_id", "review_status");



CREATE INDEX "idx_assertions_subject" ON "public"."assertions" USING "btree" ("subject_node_id", "review_status");



CREATE INDEX "idx_book_aliases_book_id" ON "public"."book_aliases" USING "btree" ("book_id");



CREATE INDEX "idx_books_theographic" ON "public"."books" USING "btree" ("theographic_code");



CREATE INDEX "idx_books_usfm" ON "public"."books" USING "btree" ("usfm");



CREATE INDEX "idx_canonical_entities_concept" ON "public"."canonical_entities" USING "btree" ("concept_id") WHERE ("concept_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_event" ON "public"."canonical_entities" USING "btree" ("chronology_event_id") WHERE ("chronology_event_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_kind" ON "public"."canonical_entities" USING "btree" ("entity_kind");



CREATE INDEX "idx_canonical_entities_lemma" ON "public"."canonical_entities" USING "btree" ("lemma_id") WHERE ("lemma_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_lexeme" ON "public"."canonical_entities" USING "btree" ("lexeme_id") WHERE ("lexeme_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_place" ON "public"."canonical_entities" USING "btree" ("place_id") WHERE ("place_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_release" ON "public"."canonical_entities" USING "btree" ("source_release_id");



CREATE INDEX "idx_canonical_entities_rnode" ON "public"."canonical_entities" USING "btree" ("research_node_id") WHERE ("research_node_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_root" ON "public"."canonical_entities" USING "btree" ("root_id") WHERE ("root_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_sense" ON "public"."canonical_entities" USING "btree" ("sense_id") WHERE ("sense_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_verse" ON "public"."canonical_entities" USING "btree" ("verse_id") WHERE ("verse_id" IS NOT NULL);



CREATE INDEX "idx_canonical_entities_word" ON "public"."canonical_entities" USING "btree" ("word_id") WHERE ("word_id" IS NOT NULL);



CREATE INDEX "idx_concept_aliases_norm" ON "public"."concept_aliases" USING "btree" ("alias_normalized");



CREATE INDEX "idx_concept_external_links_provider" ON "public"."concept_external_links" USING "btree" ("provider", "external_id");



CREATE INDEX "idx_concept_external_links_release" ON "public"."concept_external_links" USING "btree" ("source_release_id");



CREATE INDEX "idx_concept_properties_concept" ON "public"."concept_properties" USING "btree" ("concept_id", "property_key");



CREATE INDEX "idx_concept_properties_edition" ON "public"."concept_properties" USING "btree" ("source_edition_id");



CREATE INDEX "idx_concept_properties_release" ON "public"."concept_properties" USING "btree" ("source_release_id");



CREATE INDEX "idx_concepts_edition" ON "public"."concepts" USING "btree" ("source_edition_id");



CREATE INDEX "idx_concepts_release" ON "public"."concepts" USING "btree" ("source_release_id");



CREATE INDEX "idx_ctm_macula" ON "public"."cross_token_mappings" USING "btree" ("macula_morpheme_id") WHERE ("macula_morpheme_id" IS NOT NULL);



CREATE INDEX "idx_ctm_morphhb" ON "public"."cross_token_mappings" USING "btree" ("morphhb_token_id") WHERE ("morphhb_token_id" IS NOT NULL);



CREATE INDEX "idx_ctm_status" ON "public"."cross_token_mappings" USING "btree" ("mapping_status");



CREATE INDEX "idx_ctm_step_word" ON "public"."cross_token_mappings" USING "btree" ("step_word_id") WHERE ("step_word_id" IS NOT NULL);



CREATE INDEX "idx_ctm_verse" ON "public"."cross_token_mappings" USING "btree" ("canonical_verse_id");



CREATE INDEX "idx_edition_passages_bcv" ON "public"."edition_passages" USING "btree" ("book", "chapter", "verse_nr");



CREATE INDEX "idx_edition_passages_canonical_verse" ON "public"."edition_passages" USING "btree" ("canonical_verse_id");



CREATE INDEX "idx_entity_relationships_edition" ON "public"."entity_relationships" USING "btree" ("source_edition_id");



CREATE INDEX "idx_entity_relationships_object" ON "public"."entity_relationships" USING "btree" ("object_entity_id", "relation_type");



CREATE INDEX "idx_entity_relationships_owner" ON "public"."entity_relationships" USING "btree" ("owner_user_id") WHERE ("owner_user_id" IS NOT NULL);



CREATE INDEX "idx_entity_relationships_release" ON "public"."entity_relationships" USING "btree" ("source_release_id");



CREATE INDEX "idx_entity_relationships_subject" ON "public"."entity_relationships" USING "btree" ("subject_entity_id", "relation_type");



CREATE INDEX "idx_entity_relationships_type" ON "public"."entity_relationships" USING "btree" ("relation_type");



CREATE INDEX "idx_entity_relationships_verse" ON "public"."entity_relationships" USING "btree" ("supporting_verse_id") WHERE ("supporting_verse_id" IS NOT NULL);



CREATE INDEX "idx_hebrew_lxx_align_heb_words" ON "public"."hebrew_lxx_word_alignments" USING "gin" ("hebrew_word_ids");



CREATE INDEX "idx_hebrew_lxx_align_lxx_ref" ON "public"."hebrew_lxx_word_alignments" USING "btree" ("lxx_book_no", "lxx_chapter", "lxx_verse_nr");



CREATE INDEX "idx_hebrew_lxx_align_lxx_words" ON "public"."hebrew_lxx_word_alignments" USING "gin" ("lxx_word_ids");



CREATE INDEX "idx_hebrew_lxx_align_tier" ON "public"."hebrew_lxx_word_alignments" USING "btree" ("alignment_tier");



CREATE INDEX "idx_hebrew_lxx_align_verse" ON "public"."hebrew_lxx_word_alignments" USING "btree" ("canonical_verse_id");



CREATE INDEX "idx_hebrew_lxx_verse_map_lxx_ref" ON "public"."hebrew_lxx_verse_map" USING "btree" ("lxx_book_no", "lxx_chapter", "lxx_chapter_suffix", "lxx_verse_nr", "lxx_verse_suffix");



CREATE INDEX "idx_hlvm_lxx" ON "public"."hebrew_lxx_verse_map" USING "btree" ("lxx_book_no", "lxx_chapter", "lxx_verse_nr", "lxx_verse_suffix");



CREATE INDEX "idx_hlvm_release" ON "public"."hebrew_lxx_verse_map" USING "btree" ("source_release_id");



CREATE INDEX "idx_hlvm_verse" ON "public"."hebrew_lxx_verse_map" USING "btree" ("canonical_verse_id");



CREATE INDEX "idx_lemma_components_component_lemma" ON "public"."lemma_components" USING "btree" ("component_lemma_id");



CREATE INDEX "idx_lemma_components_component_lexeme" ON "public"."lemma_components" USING "btree" ("component_lexeme_id");



CREATE INDEX "idx_lemma_root_links_edition" ON "public"."lemma_root_links" USING "btree" ("source_edition_id");



CREATE INDEX "idx_lemma_root_links_release" ON "public"."lemma_root_links" USING "btree" ("source_release_id");



CREATE INDEX "idx_lemma_root_links_root" ON "public"."lemma_root_links" USING "btree" ("root_id");



CREATE INDEX "idx_lemmas_base_strongs" ON "public"."lemmas" USING "btree" ("base_strongs");



CREATE INDEX "idx_lemmas_edition" ON "public"."lemmas" USING "btree" ("source_edition_id");



CREATE INDEX "idx_lemmas_primary_lexeme" ON "public"."lemmas" USING "btree" ("primary_lexeme_id");



CREATE INDEX "idx_lemmas_release" ON "public"."lemmas" USING "btree" ("source_release_id");



CREATE INDEX "idx_lemmas_script" ON "public"."lemmas" USING "btree" ("lemma_script");



CREATE INDEX "idx_lemmas_strip_greek_script" ON "public"."lemmas" USING "btree" ("public"."strip_greek_diacritics"("lemma_script"));



CREATE INDEX "idx_lemmas_strip_hebrew_script" ON "public"."lemmas" USING "btree" ("public"."strip_hebrew_all"("lemma_script"));



CREATE INDEX "idx_lemmas_stripped" ON "public"."lemmas" USING "btree" ("lemma_stripped");



CREATE INDEX "idx_lemmas_translit" ON "public"."lemmas" USING "btree" ("lower"("transliteration"));



CREATE INDEX "idx_lexeme_identifiers_edition" ON "public"."lexeme_identifiers" USING "btree" ("source_edition_id");



CREATE INDEX "idx_lexeme_identifiers_lookup" ON "public"."lexeme_identifiers" USING "btree" ("id_namespace", "id_value");



CREATE INDEX "idx_lexeme_identifiers_release" ON "public"."lexeme_identifiers" USING "btree" ("source_release_id");



CREATE INDEX "idx_lexemes_base_strongs" ON "public"."lexemes" USING "btree" ("base_strongs");



CREATE INDEX "idx_lexemes_disambiguated" ON "public"."lexemes" USING "btree" ("disambiguated_strongs");



CREATE INDEX "idx_lexemes_extended_strongs" ON "public"."lexemes" USING "btree" ("extended_strongs");



CREATE INDEX "idx_lexemes_lemma_id" ON "public"."lexemes" USING "btree" ("lemma_id");



CREATE INDEX "idx_lexemes_primary_gloss" ON "public"."lexemes" USING "btree" ("lower"("primary_gloss"));



CREATE INDEX "idx_lexemes_source_edition" ON "public"."lexemes" USING "btree" ("source_edition_id");



CREATE INDEX "idx_lexemes_source_release" ON "public"."lexemes" USING "btree" ("source_release_id");



CREATE INDEX "idx_lexical_connections_subject" ON "public"."lexical_connections" USING "btree" ("subject_lemma_id");



CREATE INDEX "idx_lexical_connections_target" ON "public"."lexical_connections" USING "btree" ("target_lemma_id");



CREATE INDEX "idx_lexical_formations_lemma" ON "public"."lexical_formations" USING "btree" ("lemma_id");



CREATE INDEX "idx_lexical_roots_anchor_lexeme" ON "public"."lexical_roots" USING "btree" ("anchor_lexeme_id");



CREATE INDEX "idx_lexical_roots_edition" ON "public"."lexical_roots" USING "btree" ("source_edition_id");



CREATE INDEX "idx_lexical_roots_release" ON "public"."lexical_roots" USING "btree" ("source_release_id");



CREATE INDEX "idx_lexical_roots_script" ON "public"."lexical_roots" USING "btree" ("root_script");



CREATE INDEX "idx_lexical_senses_edition" ON "public"."lexical_senses" USING "btree" ("source_edition_id");



CREATE INDEX "idx_lexical_senses_lemma" ON "public"."lexical_senses" USING "btree" ("lemma_id", "sense_order");



CREATE INDEX "idx_lexical_senses_lexeme" ON "public"."lexical_senses" USING "btree" ("lexeme_id", "sense_order");



CREATE INDEX "idx_lexical_senses_parent" ON "public"."lexical_senses" USING "btree" ("parent_sense_id");



CREATE INDEX "idx_lexical_senses_release" ON "public"."lexical_senses" USING "btree" ("source_release_id");



CREATE INDEX "idx_lxx_books_canonical" ON "public"."lxx_swete_books" USING "btree" ("canonical_book") WHERE ("canonical_book" IS NOT NULL);



CREATE INDEX "idx_lxx_books_edition" ON "public"."lxx_swete_books" USING "btree" ("source_edition_id");



CREATE INDEX "idx_lxx_books_release" ON "public"."lxx_swete_books" USING "btree" ("source_release_id");



CREATE INDEX "idx_lxx_swete_words_normalized" ON "public"."lxx_swete_words" USING "btree" ("normalized_word");



CREATE INDEX "idx_lxx_swete_words_ref" ON "public"."lxx_swete_words" USING "btree" ("book_no", "chapter", "chapter_suffix", "verse_nr", "verse_suffix");



CREATE INDEX "idx_lxx_swete_words_source_edition" ON "public"."lxx_swete_words" USING "btree" ("source_edition_id");



CREATE INDEX "idx_mcp_connection_chains_expires_at" ON "public"."mcp_connection_chains" USING "btree" ("expires_at");



CREATE INDEX "idx_mgfv_field_value" ON "public"."macula_gated_field_values" USING "btree" ("field_name", "field_value");



CREATE INDEX "idx_mgfv_registry" ON "public"."macula_gated_field_values" USING "btree" ("dataset_key", "field_name");



CREATE INDEX "idx_mgt_canonical_verse" ON "public"."macula_greek_tokens" USING "btree" ("canonical_verse_id");



CREATE INDEX "idx_mgt_edition_book" ON "public"."macula_greek_tokens" USING "btree" ("edition_key", "book");



CREATE INDEX "idx_mgt_lemma" ON "public"."macula_greek_tokens" USING "btree" ("lemma");



CREATE INDEX "idx_mgt_ref" ON "public"."macula_greek_tokens" USING "btree" ("book", "chapter", "verse_nr", "word_no");



CREATE INDEX "idx_mgt_step_word" ON "public"."macula_greek_tokens" USING "btree" ("step_word_id");



CREATE INDEX "idx_mgt_strongs" ON "public"."macula_greek_tokens" USING "btree" ("strongs");



CREATE INDEX "idx_mgt_xml_id" ON "public"."macula_greek_tokens" USING "btree" ("xml_id");



CREATE INDEX "idx_mhm_edition" ON "public"."macula_hebrew_morphemes" USING "btree" ("source_edition_id");



CREATE INDEX "idx_mhm_ref" ON "public"."macula_hebrew_morphemes" USING "btree" ("book", "chapter_mt", "verse_mt", "word_no", "morph_no");



CREATE INDEX "idx_mhm_release" ON "public"."macula_hebrew_morphemes" USING "btree" ("source_release_id");



CREATE INDEX "idx_mhm_strong" ON "public"."macula_hebrew_morphemes" USING "btree" ("strong_x");



CREATE INDEX "idx_mhm_verse" ON "public"."macula_hebrew_morphemes" USING "btree" ("canonical_verse_id") WHERE ("canonical_verse_id" IS NOT NULL);



CREATE INDEX "idx_mhm_word" ON "public"."macula_hebrew_morphemes" USING "btree" ("word_id") WHERE ("word_id" IS NOT NULL);



CREATE INDEX "idx_morphhb_tokens_aramaic" ON "public"."morphhb_tokens" USING "btree" ("is_aramaic") WHERE ("is_aramaic" = true);



CREATE INDEX "idx_morphhb_tokens_edition" ON "public"."morphhb_tokens" USING "btree" ("source_edition_id");



CREATE INDEX "idx_morphhb_tokens_ketiv" ON "public"."morphhb_tokens" USING "btree" ("is_ketiv") WHERE ("is_ketiv" = true);



CREATE INDEX "idx_morphhb_tokens_qere" ON "public"."morphhb_tokens" USING "btree" ("is_qere") WHERE ("is_qere" = true);



CREATE INDEX "idx_morphhb_tokens_ref" ON "public"."morphhb_tokens" USING "btree" ("book", "chapter", "verse_nr", "word_num");



CREATE INDEX "idx_morphhb_tokens_release" ON "public"."morphhb_tokens" USING "btree" ("source_release_id");



CREATE INDEX "idx_morphhb_tokens_step_word" ON "public"."morphhb_tokens" USING "btree" ("step_word_id") WHERE ("step_word_id" IS NOT NULL);



CREATE INDEX "idx_morphhb_tokens_verse" ON "public"."morphhb_tokens" USING "btree" ("canonical_verse_id") WHERE ("canonical_verse_id" IS NOT NULL);



CREATE INDEX "idx_note_anchors_concept_id" ON "public"."note_anchors" USING "btree" ("concept_id") WHERE ("concept_id" IS NOT NULL);



CREATE INDEX "idx_note_anchors_end_verse_id" ON "public"."note_anchors" USING "btree" ("end_verse_id") WHERE ("end_verse_id" IS NOT NULL);



CREATE INDEX "idx_note_anchors_event_id" ON "public"."note_anchors" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);



CREATE INDEX "idx_note_anchors_lemma_id" ON "public"."note_anchors" USING "btree" ("lemma_id") WHERE ("anchor_kind" = 'lemma'::"text");



CREATE INDEX "idx_note_anchors_note_id" ON "public"."note_anchors" USING "btree" ("note_id");



CREATE INDEX "idx_note_anchors_place_id" ON "public"."note_anchors" USING "btree" ("place_id") WHERE ("place_id" IS NOT NULL);



CREATE INDEX "idx_note_anchors_target_note" ON "public"."note_anchors" USING "btree" ("target_note_id") WHERE ("anchor_kind" = 'note'::"text");



CREATE INDEX "idx_note_anchors_verses" ON "public"."note_anchors" USING "btree" ("verse_id", "end_verse_id") WHERE ("anchor_kind" = ANY (ARRAY['verse'::"text", 'verse_range'::"text", 'word_occurrence'::"text"]));



CREATE INDEX "idx_note_anchors_word_id" ON "public"."note_anchors" USING "btree" ("word_id") WHERE ("anchor_kind" = ANY (ARRAY['word_form'::"text", 'word_occurrence'::"text"]));



CREATE INDEX "idx_note_authors_user_id" ON "public"."note_authors" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_note_blocks_block_type" ON "public"."note_blocks" USING "btree" ("block_type");



CREATE INDEX "idx_note_blocks_note_id" ON "public"."note_blocks" USING "btree" ("note_id", "ordinal");



CREATE INDEX "idx_note_connections_from" ON "public"."note_connections" USING "btree" ("from_anchor_id", "note_id");



CREATE INDEX "idx_note_connections_note_id" ON "public"."note_connections" USING "btree" ("note_id");



CREATE INDEX "idx_note_connections_to" ON "public"."note_connections" USING "btree" ("to_anchor_id", "note_id");



CREATE INDEX "idx_note_connections_type" ON "public"."note_connections" USING "btree" ("connection_type") WHERE ("connection_type" IS NOT NULL);



CREATE INDEX "idx_note_revisions_editor" ON "public"."note_revisions" USING "btree" ("editor_author_id");



CREATE INDEX "idx_note_revisions_editor_kind_created" ON "public"."note_revisions" USING "btree" ("editor_kind", "created_at");



CREATE INDEX "idx_note_revisions_note_id" ON "public"."note_revisions" USING "btree" ("note_id");



CREATE INDEX "idx_note_revisions_note_version" ON "public"."note_revisions" USING "btree" ("note_id", "version" DESC);



CREATE INDEX "idx_notes_author_composite" ON "public"."notes" USING "btree" ("author_id", "author_kind");



CREATE INDEX "idx_notes_author_content_hash" ON "public"."notes" USING "btree" ("author_id", "content_hash") WHERE ("content_hash" IS NOT NULL);



CREATE INDEX "idx_notes_author_id" ON "public"."notes" USING "btree" ("author_id");



CREATE INDEX "idx_notes_author_kind" ON "public"."notes" USING "btree" ("author_kind");



CREATE INDEX "idx_notes_created_at_id" ON "public"."notes" USING "btree" ("created_at" DESC, "id" DESC);



CREATE INDEX "idx_notes_dlm_v1_published" ON "public"."notes" USING "btree" ("review_status", "updated_at" DESC, "id") WHERE (("status" = 'published'::"text") AND ("visibility" = 'public'::"text") AND ("source_context" ? 'dlm_v1'::"text"));



CREATE INDEX "idx_notes_note_kind" ON "public"."notes" USING "btree" ("note_kind");



CREATE INDEX "idx_notes_supersedes" ON "public"."notes" USING "btree" ("supersedes_note_id") WHERE ("supersedes_note_id" IS NOT NULL);



CREATE INDEX "idx_notes_tsv" ON "public"."notes" USING "gin" ("tsv");



CREATE INDEX "idx_passage_geography_event" ON "public"."passage_geography" USING "btree" ("chronology_event_id");



CREATE INDEX "idx_passage_geography_place" ON "public"."passage_geography" USING "btree" ("place_id");



CREATE INDEX "idx_passage_geography_range" ON "public"."passage_geography" USING "btree" ("book", "start_chapter", "start_verse", "end_chapter", "end_verse");



CREATE INDEX "idx_passage_geography_source" ON "public"."passage_geography" USING "btree" ("source_id");



CREATE INDEX "idx_place_locations_place_rank" ON "public"."place_locations" USING "btree" ("place_id", "rank_order", "id");



CREATE INDEX "idx_place_locations_source" ON "public"."place_locations" USING "btree" ("source_id");



CREATE INDEX "idx_places_active_eras_gin" ON "public"."places" USING "gin" ("active_eras");



CREATE INDEX "idx_places_biblical_name" ON "public"."places" USING "btree" ("biblical_name");



CREATE INDEX "idx_places_external_ids_gin" ON "public"."places" USING "gin" ("external_ids");



CREATE INDEX "idx_places_primary_source" ON "public"."places" USING "btree" ("primary_source_id");



CREATE INDEX "idx_places_strongs_gin" ON "public"."places" USING "gin" ("strongs_numbers");



CREATE INDEX "idx_quarantined_evidence_records_edition" ON "public"."quarantined_evidence_records" USING "btree" ("source_edition_id") WHERE ("source_edition_id" IS NOT NULL);



CREATE INDEX "idx_quarantined_records_dataset" ON "public"."quarantined_evidence_records" USING "btree" ("dataset_key");



CREATE INDEX "idx_quarantined_records_status" ON "public"."quarantined_evidence_records" USING "btree" ("quarantine_status");



CREATE INDEX "idx_reader_rendering_example_verse" ON "public"."reader_rendering_groups" USING "btree" ("example_verse_id");



CREATE INDEX "idx_research_nodes_concept" ON "public"."research_nodes" USING "btree" ("concept_id");



CREATE INDEX "idx_research_nodes_lexeme" ON "public"."research_nodes" USING "btree" ("lexeme_id");



CREATE INDEX "idx_semantic_annotations_concept" ON "public"."semantic_annotations" USING "btree" ("concept_id");



CREATE INDEX "idx_semantic_annotations_lemma" ON "public"."semantic_annotations" USING "btree" ("lemma_id");



CREATE INDEX "idx_semantic_annotations_lexeme" ON "public"."semantic_annotations" USING "btree" ("lexeme_id");



CREATE INDEX "idx_semantic_annotations_owner" ON "public"."semantic_annotations" USING "btree" ("owner_user_id");



CREATE INDEX "idx_semantic_annotations_release" ON "public"."semantic_annotations" USING "btree" ("source_release_id");



CREATE INDEX "idx_semantic_annotations_sense" ON "public"."semantic_annotations" USING "btree" ("sense_id");



CREATE INDEX "idx_semantic_annotations_verse" ON "public"."semantic_annotations" USING "btree" ("verse_id", "start_word_position");



CREATE INDEX "idx_source_editions_release" ON "public"."source_editions" USING "btree" ("source_release_id");



CREATE INDEX "idx_syntax_edges_release" ON "public"."syntax_edges" USING "btree" ("source_release_id");



CREATE INDEX "idx_syntax_edges_source_node" ON "public"."syntax_edges" USING "btree" ("source_node_id");



CREATE INDEX "idx_syntax_edges_target_node" ON "public"."syntax_edges" USING "btree" ("target_node_id");



CREATE UNIQUE INDEX "idx_syntax_edges_unique_nodes" ON "public"."syntax_edges" USING "btree" ("edition_id", "source_node_id", "target_node_id", "relation_type") WHERE (("source_node_id" IS NOT NULL) AND ("target_node_id" IS NOT NULL));



CREATE INDEX "idx_syntax_edges_verse" ON "public"."syntax_edges" USING "btree" ("verse_id", "dependent_word_position");



CREATE INDEX "idx_syntax_nodes_cross_verse" ON "public"."syntax_nodes" USING "btree" ("is_cross_verse") WHERE ("is_cross_verse" = true);



CREATE INDEX "idx_syntax_nodes_edition" ON "public"."syntax_nodes" USING "btree" ("edition_id");



CREATE INDEX "idx_syntax_nodes_parent" ON "public"."syntax_nodes" USING "btree" ("parent_node_id");



CREATE INDEX "idx_syntax_nodes_release" ON "public"."syntax_nodes" USING "btree" ("source_release_id");



CREATE INDEX "idx_syntax_nodes_terminal_word" ON "public"."syntax_nodes" USING "btree" ("terminal_word_id");



CREATE INDEX "idx_syntax_nodes_terminal_xml" ON "public"."syntax_nodes" USING "btree" ("terminal_xml_id");



CREATE INDEX "idx_syntax_nodes_tree" ON "public"."syntax_nodes" USING "btree" ("tree_id");



CREATE INDEX "idx_syntax_nodes_verse" ON "public"."syntax_nodes" USING "btree" ("verse_id", "start_word_position");



CREATE INDEX "idx_tagnt_canonical_verse" ON "public"."tagnt_tokens" USING "btree" ("canonical_verse_id");



CREATE INDEX "idx_tagnt_dstrongs" ON "public"."tagnt_tokens" USING "btree" ("dstrongs");



CREATE INDEX "idx_tagnt_editions" ON "public"."tagnt_tokens" USING "gin" ("to_tsvector"('"simple"'::"regconfig", "editions"));



CREATE INDEX "idx_tagnt_verse_pos" ON "public"."tagnt_tokens" USING "btree" ("book", "chapter", "verse_nr", "word_position");



CREATE INDEX "idx_tagnt_word_type" ON "public"."tagnt_tokens" USING "btree" ("word_type");



CREATE INDEX "idx_token_morphemes_lemma" ON "public"."token_morphemes" USING "btree" ("lemma_id");



CREATE INDEX "idx_token_morphemes_lexeme" ON "public"."token_morphemes" USING "btree" ("lexeme_id");



CREATE INDEX "idx_token_morphemes_release" ON "public"."token_morphemes" USING "btree" ("source_release_id");



CREATE INDEX "idx_token_morphemes_verse" ON "public"."token_morphemes" USING "btree" ("verse_id", "word_position", "component_order");



CREATE INDEX "idx_verse_geography_event" ON "public"."verse_geography" USING "btree" ("chronology_event_id");



CREATE INDEX "idx_verse_geography_passage" ON "public"."verse_geography" USING "btree" ("establishing_passage_id");



CREATE INDEX "idx_verse_geography_place" ON "public"."verse_geography" USING "btree" ("place_id");



CREATE INDEX "idx_verse_geography_source" ON "public"."verse_geography" USING "btree" ("source_id");



CREATE INDEX "idx_verse_geography_verse_tier" ON "public"."verse_geography" USING "btree" ("verse_id", "resolution_tier", "id");



CREATE INDEX "idx_verses_reference" ON "public"."verses" USING "btree" ("book", "chapter", "verse_nr");



CREATE INDEX "idx_verses_word_ids_gin" ON "public"."verses" USING "gin" ("word_ids");



CREATE INDEX "idx_versification_from_edition" ON "public"."versification_mappings" USING "btree" ("from_edition_id");



CREATE INDEX "idx_versification_release" ON "public"."versification_mappings" USING "btree" ("source_release_id");



CREATE INDEX "idx_versification_to_bcv" ON "public"."versification_mappings" USING "btree" ("to_book", "to_chapter", "to_verse_nr");



CREATE INDEX "idx_versification_to_edition" ON "public"."versification_mappings" USING "btree" ("to_edition_id");



CREATE INDEX "idx_word_form_lemmas_edition" ON "public"."word_form_lemmas" USING "btree" ("source_edition_id");



CREATE INDEX "idx_word_form_lemmas_lemma" ON "public"."word_form_lemmas" USING "btree" ("lemma_id");



CREATE INDEX "idx_word_form_lemmas_lexeme" ON "public"."word_form_lemmas" USING "btree" ("lexeme_id");



CREATE INDEX "idx_word_form_lemmas_release" ON "public"."word_form_lemmas" USING "btree" ("source_release_id");



CREATE INDEX "idx_word_form_lemmas_word" ON "public"."word_form_lemmas" USING "btree" ("word_id", "component_order");



CREATE INDEX "idx_words_gematria" ON "public"."words" USING "btree" ("gematria");



CREATE INDEX "idx_words_original" ON "public"."words" USING "btree" ("original_word");



CREATE INDEX "idx_words_strip_greek" ON "public"."words" USING "btree" ("public"."strip_greek_diacritics"("original_word"));



CREATE INDEX "idx_words_strip_hebrew_all" ON "public"."words" USING "btree" ("public"."strip_hebrew_all"("original_word"));



CREATE INDEX "idx_words_strongs" ON "public"."words" USING "btree" ("strongs_nr");



CREATE INDEX "idx_words_translit" ON "public"."words" USING "btree" ("transliteration");



CREATE INDEX "reader_event_passage" ON "public"."reader_text_event_links" USING "btree" ("book", "chapter");



CREATE INDEX "reader_rendering_rank" ON "public"."reader_rendering_groups" USING "btree" ("strongs_nr", "token_total" DESC);



CREATE UNIQUE INDEX "uq_note_anchors_dedup" ON "public"."note_anchors" USING "btree" ("note_id", "anchor_kind", COALESCE("verse_id", 0), COALESCE("end_verse_id", 0), COALESCE("word_position", 0), COALESCE("word_id", 0), COALESCE("lemma_id", (0)::bigint), COALESCE("concept_id", (0)::bigint), COALESCE("place_id", (0)::bigint), COALESCE("event_id", (0)::bigint), COALESCE(("target_note_id")::"text", ''::"text"), COALESCE("external_uri", ''::"text"), COALESCE(("block_id")::"text", ''::"text"), COALESCE("element_ref", ''::"text"));



CREATE UNIQUE INDEX "uq_note_authors_identity" ON "public"."note_authors" USING "btree" ("author_kind", "display_name", COALESCE("ai_provider", ''::"text"), COALESCE("ai_model", ''::"text"), COALESCE("ai_client", ''::"text"));



CREATE UNIQUE INDEX "uq_notes_client_request" ON "public"."notes" USING "btree" ("author_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "verse_translation_sources_word" ON "public"."verse_translation_sources" USING "btree" ("word_id");



CREATE INDEX "word_translation_choices_occurrence" ON "public"."word_translation_choices" USING "btree" ("verse_id", "word_position", "word_id");



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "bible_internal"."macula_syntax_import_files" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "bible_internal"."macula_syntax_unmapped_nodes" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE INSERT OR DELETE OR UPDATE ON "public"."chronology_assertion_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_snapshot"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE DELETE OR UPDATE ON "public"."chronology_assertions" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_immutable"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE INSERT OR DELETE OR UPDATE ON "public"."chronology_assignment_assertions" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_snapshot"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE INSERT OR DELETE OR UPDATE ON "public"."chronology_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_snapshot"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE INSERT OR DELETE OR UPDATE ON "public"."chronology_event_links" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_snapshot"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE DELETE OR UPDATE ON "public"."chronology_events" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_immutable"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE DELETE OR UPDATE ON "public"."chronology_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_immutable"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE DELETE OR UPDATE ON "public"."chronology_models" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_immutable"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE DELETE OR UPDATE ON "public"."chronology_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_immutable"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE DELETE OR UPDATE ON "public"."chronology_runs" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_immutable"();



CREATE OR REPLACE TRIGGER "immutable" BEFORE DELETE OR UPDATE ON "public"."chronology_sources" FOR EACH ROW EXECUTE FUNCTION "public"."chronology_guard_immutable"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."cross_token_mappings" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."edition_passages" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."hebrew_lxx_verse_map" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."hebrew_lxx_word_alignments" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."lexeme_identifiers" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."lxx_norm_word_summary" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."lxx_swete_words" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."macula_gated_field_values" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."macula_greek_tokens" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."macula_greekstrong_morphemes" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."macula_hebrew_morphemes" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."morphhb_tokens" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."reader_english_verses" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."reader_rendering_groups" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."syntax_edges" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."syntax_nodes" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."tagnt_tokens" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."token_morphemes" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."verse_translation_sources" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."versification_mappings" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "stage_g_release_gate" BEFORE TRUNCATE ON "public"."word_form_lemmas" FOR EACH STATEMENT EXECUTE FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"();



CREATE OR REPLACE TRIGGER "trg_note_blocks_validate" BEFORE INSERT OR UPDATE ON "public"."note_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."validate_note_block_trigger_v1"();



CREATE OR REPLACE TRIGGER "trg_validate_note_anchor_occurrence" BEFORE INSERT OR UPDATE ON "public"."note_anchors" FOR EACH ROW EXECUTE FUNCTION "public"."validate_note_anchor_occurrence_v1"();



CREATE OR REPLACE TRIGGER "update_pages_updated_at" BEFORE UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "validate_word_translation_choice" BEFORE INSERT OR UPDATE ON "public"."word_translation_choices" FOR EACH ROW EXECUTE FUNCTION "public"."validate_word_translation_choice_v1"();



ALTER TABLE ONLY "bible_internal"."macula_syntax_import_files"
    ADD CONSTRAINT "macula_syntax_import_files_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "bible_internal"."macula_syntax_import_files"
    ADD CONSTRAINT "macula_syntax_import_files_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "bible_internal"."macula_syntax_unmapped_nodes"
    ADD CONSTRAINT "macula_syntax_unmapped_nodes_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "bible_internal"."macula_syntax_unmapped_nodes"
    ADD CONSTRAINT "macula_syntax_unmapped_nodes_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "bible_internal"."macula_syntax_import_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "bible_internal"."macula_syntax_unmapped_nodes"
    ADD CONSTRAINT "macula_syntax_unmapped_nodes_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."assertion_evidence"
    ADD CONSTRAINT "assertion_evidence_assertion_id_fkey" FOREIGN KEY ("assertion_id") REFERENCES "public"."assertions"("id");



ALTER TABLE ONLY "public"."assertions"
    ADD CONSTRAINT "assertions_object_node_id_fkey" FOREIGN KEY ("object_node_id") REFERENCES "public"."research_nodes"("id");



ALTER TABLE ONLY "public"."assertions"
    ADD CONSTRAINT "assertions_subject_node_id_fkey" FOREIGN KEY ("subject_node_id") REFERENCES "public"."research_nodes"("id");



ALTER TABLE ONLY "public"."bol_events"
    ADD CONSTRAINT "bol_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bol_profiles"
    ADD CONSTRAINT "bol_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bol_years"
    ADD CONSTRAINT "bol_years_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."book_aliases"
    ADD CONSTRAINT "book_aliases_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_chronology_event_id_fkey" FOREIGN KEY ("chronology_event_id") REFERENCES "public"."chronology_events"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_research_node_id_fkey" FOREIGN KEY ("research_node_id") REFERENCES "public"."research_nodes"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_root_id_fkey" FOREIGN KEY ("root_id") REFERENCES "public"."lexical_roots"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "public"."lexical_senses"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."canonical_entities"
    ADD CONSTRAINT "canonical_entities_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."chronology_active_runs"
    ADD CONSTRAINT "chronology_active_runs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."chronology_models"("id");



ALTER TABLE ONLY "public"."chronology_active_runs"
    ADD CONSTRAINT "chronology_active_runs_run_id_model_id_fkey" FOREIGN KEY ("run_id", "model_id") REFERENCES "public"."chronology_runs"("id", "model_id");



ALTER TABLE ONLY "public"."chronology_assertion_evidence"
    ADD CONSTRAINT "chronology_assertion_evidence_assertion_id_fkey" FOREIGN KEY ("assertion_id") REFERENCES "public"."chronology_assertions"("id");



ALTER TABLE ONLY "public"."chronology_assertion_evidence"
    ADD CONSTRAINT "chronology_assertion_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "public"."chronology_evidence"("id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."chronology_events"("id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."chronology_models"("id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."chronology_sources"("id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_supersedes_fkey" FOREIGN KEY ("supersedes") REFERENCES "public"."chronology_assertions"("id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_supersedes_model_id_fkey" FOREIGN KEY ("supersedes", "model_id") REFERENCES "public"."chronology_assertions"("id", "model_id");



ALTER TABLE ONLY "public"."chronology_assertions"
    ADD CONSTRAINT "chronology_assertions_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."chronology_assignment_assertions"
    ADD CONSTRAINT "chronology_assignment_assertions_assertion_id_model_id_fkey" FOREIGN KEY ("assertion_id", "model_id") REFERENCES "public"."chronology_assertions"("id", "model_id");



ALTER TABLE ONLY "public"."chronology_assignment_assertions"
    ADD CONSTRAINT "chronology_assignment_assertions_run_id_verse_id_model_id_fkey" FOREIGN KEY ("run_id", "verse_id", "model_id") REFERENCES "public"."chronology_assignments"("run_id", "verse_id", "model_id");



ALTER TABLE ONLY "public"."chronology_assignments"
    ADD CONSTRAINT "chronology_assignments_run_id_model_id_fkey" FOREIGN KEY ("run_id", "model_id") REFERENCES "public"."chronology_runs"("id", "model_id");



ALTER TABLE ONLY "public"."chronology_assignments"
    ADD CONSTRAINT "chronology_assignments_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."chronology_event_links"
    ADD CONSTRAINT "chronology_event_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."chronology_events"("id");



ALTER TABLE ONLY "public"."chronology_event_links"
    ADD CONSTRAINT "chronology_event_links_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."chronology_events"
    ADD CONSTRAINT "chronology_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."chronology_sources"("id");



ALTER TABLE ONLY "public"."chronology_evidence"
    ADD CONSTRAINT "chronology_evidence_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."chronology_sources"("id");



ALTER TABLE ONLY "public"."chronology_revisions"
    ADD CONSTRAINT "chronology_revisions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."chronology_models"("id");



ALTER TABLE ONLY "public"."chronology_revisions"
    ADD CONSTRAINT "chronology_revisions_parent_run_id_model_id_fkey" FOREIGN KEY ("parent_run_id", "model_id") REFERENCES "public"."chronology_runs"("id", "model_id");



ALTER TABLE ONLY "public"."chronology_runs"
    ADD CONSTRAINT "chronology_runs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."chronology_models"("id");



ALTER TABLE ONLY "public"."concept_aliases"
    ADD CONSTRAINT "concept_aliases_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."concept_external_links"
    ADD CONSTRAINT "concept_external_links_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."concept_external_links"
    ADD CONSTRAINT "concept_external_links_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."concept_properties"
    ADD CONSTRAINT "concept_properties_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."concept_properties"
    ADD CONSTRAINT "concept_properties_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."concept_properties"
    ADD CONSTRAINT "concept_properties_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."concepts"
    ADD CONSTRAINT "concepts_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."concepts"
    ADD CONSTRAINT "concepts_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_macula_morpheme_id_fkey" FOREIGN KEY ("macula_morpheme_id") REFERENCES "public"."macula_hebrew_morphemes"("id");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_morphhb_token_id_fkey" FOREIGN KEY ("morphhb_token_id") REFERENCES "public"."morphhb_tokens"("id");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."cross_token_mappings"
    ADD CONSTRAINT "cross_token_mappings_step_word_id_fkey" FOREIGN KEY ("step_word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."edition_passages"
    ADD CONSTRAINT "edition_passages_book_fkey" FOREIGN KEY ("book") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."edition_passages"
    ADD CONSTRAINT "edition_passages_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."edition_passages"
    ADD CONSTRAINT "edition_passages_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_object_entity_id_fkey" FOREIGN KEY ("object_entity_id") REFERENCES "public"."canonical_entities"("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_relation_type_fkey" FOREIGN KEY ("relation_type") REFERENCES "public"."relation_types"("relation_type");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_subject_entity_id_fkey" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."canonical_entities"("id");



ALTER TABLE ONLY "public"."entity_relationships"
    ADD CONSTRAINT "entity_relationships_supporting_verse_id_fkey" FOREIGN KEY ("supporting_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."note_connections"
    ADD CONSTRAINT "fk_conn_from" FOREIGN KEY ("from_anchor_id", "note_id") REFERENCES "public"."note_anchors"("id", "note_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."note_connections"
    ADD CONSTRAINT "fk_conn_to" FOREIGN KEY ("to_anchor_id", "note_id") REFERENCES "public"."note_anchors"("id", "note_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "fk_notes_author" FOREIGN KEY ("author_id", "author_kind") REFERENCES "public"."note_authors"("id", "author_kind") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hebrew_lxx_verse_map"
    ADD CONSTRAINT "hebrew_lxx_verse_map_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."hebrew_lxx_verse_map"
    ADD CONSTRAINT "hebrew_lxx_verse_map_lxx_book_no_fkey" FOREIGN KEY ("lxx_book_no") REFERENCES "public"."lxx_swete_books"("book_no");



ALTER TABLE ONLY "public"."hebrew_lxx_verse_map"
    ADD CONSTRAINT "hebrew_lxx_verse_map_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."hebrew_lxx_word_alignments"
    ADD CONSTRAINT "hebrew_lxx_word_alignments_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."hebrew_lxx_word_alignments"
    ADD CONSTRAINT "hebrew_lxx_word_alignments_lxx_book_no_fkey" FOREIGN KEY ("lxx_book_no") REFERENCES "public"."lxx_swete_books"("book_no");



ALTER TABLE ONLY "public"."hebrew_lxx_word_alignments"
    ADD CONSTRAINT "hebrew_lxx_word_alignments_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lemma_components"
    ADD CONSTRAINT "lemma_components_component_lemma_id_fkey" FOREIGN KEY ("component_lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."lemma_components"
    ADD CONSTRAINT "lemma_components_component_lexeme_id_fkey" FOREIGN KEY ("component_lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."lemma_components"
    ADD CONSTRAINT "lemma_components_formation_id_fkey" FOREIGN KEY ("formation_id") REFERENCES "public"."lexical_formations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lemma_root_links"
    ADD CONSTRAINT "lemma_root_links_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."lemma_root_links"
    ADD CONSTRAINT "lemma_root_links_root_id_fkey" FOREIGN KEY ("root_id") REFERENCES "public"."lexical_roots"("id");



ALTER TABLE ONLY "public"."lemma_root_links"
    ADD CONSTRAINT "lemma_root_links_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lemma_root_links"
    ADD CONSTRAINT "lemma_root_links_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lemmas"
    ADD CONSTRAINT "lemmas_primary_lexeme_id_fkey" FOREIGN KEY ("primary_lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."lemmas"
    ADD CONSTRAINT "lemmas_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lemmas"
    ADD CONSTRAINT "lemmas_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lexeme_identifiers"
    ADD CONSTRAINT "lexeme_identifiers_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."lexeme_identifiers"
    ADD CONSTRAINT "lexeme_identifiers_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lexeme_identifiers"
    ADD CONSTRAINT "lexeme_identifiers_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lexemes"
    ADD CONSTRAINT "lexemes_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."lexemes"
    ADD CONSTRAINT "lexemes_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lexemes"
    ADD CONSTRAINT "lexemes_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lexical_connections"
    ADD CONSTRAINT "lexical_connections_subject_lemma_id_fkey" FOREIGN KEY ("subject_lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lexical_connections"
    ADD CONSTRAINT "lexical_connections_target_lemma_id_fkey" FOREIGN KEY ("target_lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lexical_formations"
    ADD CONSTRAINT "lexical_formations_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lexical_roots"
    ADD CONSTRAINT "lexical_roots_anchor_lexeme_id_fkey" FOREIGN KEY ("anchor_lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."lexical_roots"
    ADD CONSTRAINT "lexical_roots_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lexical_roots"
    ADD CONSTRAINT "lexical_roots_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lexical_senses"
    ADD CONSTRAINT "lexical_senses_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."lexical_senses"
    ADD CONSTRAINT "lexical_senses_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."lexical_senses"
    ADD CONSTRAINT "lexical_senses_parent_sense_id_fkey" FOREIGN KEY ("parent_sense_id") REFERENCES "public"."lexical_senses"("id");



ALTER TABLE ONLY "public"."lexical_senses"
    ADD CONSTRAINT "lexical_senses_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lexical_senses"
    ADD CONSTRAINT "lexical_senses_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lxx_swete_books"
    ADD CONSTRAINT "lxx_swete_books_canonical_book_fkey" FOREIGN KEY ("canonical_book") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."lxx_swete_books"
    ADD CONSTRAINT "lxx_swete_books_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lxx_swete_books"
    ADD CONSTRAINT "lxx_swete_books_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."lxx_swete_words"
    ADD CONSTRAINT "lxx_swete_words_book_no_fkey" FOREIGN KEY ("book_no") REFERENCES "public"."lxx_swete_books"("book_no");



ALTER TABLE ONLY "public"."lxx_swete_words"
    ADD CONSTRAINT "lxx_swete_words_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."lxx_swete_words"
    ADD CONSTRAINT "lxx_swete_words_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."macula_gated_field_values"
    ADD CONSTRAINT "macula_gated_field_values_dataset_key_field_name_fkey" FOREIGN KEY ("dataset_key", "field_name") REFERENCES "public"."field_license_registry"("dataset_key", "field_name");



ALTER TABLE ONLY "public"."macula_gated_field_values"
    ADD CONSTRAINT "macula_gated_field_values_morpheme_id_fkey" FOREIGN KEY ("morpheme_id") REFERENCES "public"."macula_hebrew_morphemes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."macula_greek_tokens"
    ADD CONSTRAINT "macula_greek_tokens_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."macula_greek_tokens"
    ADD CONSTRAINT "macula_greek_tokens_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."macula_greek_tokens"
    ADD CONSTRAINT "macula_greek_tokens_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."macula_greek_tokens"
    ADD CONSTRAINT "macula_greek_tokens_step_word_id_fkey" FOREIGN KEY ("step_word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."macula_hebrew_morphemes"
    ADD CONSTRAINT "macula_hebrew_morphemes_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."macula_hebrew_morphemes"
    ADD CONSTRAINT "macula_hebrew_morphemes_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."macula_hebrew_morphemes"
    ADD CONSTRAINT "macula_hebrew_morphemes_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."macula_hebrew_morphemes"
    ADD CONSTRAINT "macula_hebrew_morphemes_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."morphhb_tokens"
    ADD CONSTRAINT "morphhb_tokens_book_fkey" FOREIGN KEY ("book") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."morphhb_tokens"
    ADD CONSTRAINT "morphhb_tokens_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."morphhb_tokens"
    ADD CONSTRAINT "morphhb_tokens_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."morphhb_tokens"
    ADD CONSTRAINT "morphhb_tokens_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."morphhb_tokens"
    ADD CONSTRAINT "morphhb_tokens_step_word_id_fkey" FOREIGN KEY ("step_word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_end_verse_id_fkey" FOREIGN KEY ("end_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."chronology_events"("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_target_note_id_fkey" FOREIGN KEY ("target_note_id") REFERENCES "public"."notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."note_anchors"
    ADD CONSTRAINT "note_anchors_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."note_authors"
    ADD CONSTRAINT "note_authors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."note_blocks"
    ADD CONSTRAINT "note_blocks_block_type_fkey" FOREIGN KEY ("block_type") REFERENCES "public"."note_block_types"("block_type");



ALTER TABLE ONLY "public"."note_blocks"
    ADD CONSTRAINT "note_blocks_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."note_connections"
    ADD CONSTRAINT "note_connections_connection_type_fkey" FOREIGN KEY ("connection_type") REFERENCES "public"."note_connection_types"("connection_type") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."note_connections"
    ADD CONSTRAINT "note_connections_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."note_revisions"
    ADD CONSTRAINT "note_revisions_editor_author_id_fkey" FOREIGN KEY ("editor_author_id") REFERENCES "public"."note_authors"("id");



ALTER TABLE ONLY "public"."note_revisions"
    ADD CONSTRAINT "note_revisions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_note_kind_fkey" FOREIGN KEY ("note_kind") REFERENCES "public"."note_kinds"("note_kind");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_supersedes_note_id_fkey" FOREIGN KEY ("supersedes_note_id") REFERENCES "public"."notes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."passage_geography"
    ADD CONSTRAINT "passage_geography_chronology_event_id_fkey" FOREIGN KEY ("chronology_event_id") REFERENCES "public"."chronology_events"("id");



ALTER TABLE ONLY "public"."passage_geography"
    ADD CONSTRAINT "passage_geography_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id");



ALTER TABLE ONLY "public"."passage_geography"
    ADD CONSTRAINT "passage_geography_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."geography_sources"("id");



ALTER TABLE ONLY "public"."place_locations"
    ADD CONSTRAINT "place_locations_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id");



ALTER TABLE ONLY "public"."place_locations"
    ADD CONSTRAINT "place_locations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."geography_sources"("id");



ALTER TABLE ONLY "public"."places"
    ADD CONSTRAINT "places_primary_source_id_fkey" FOREIGN KEY ("primary_source_id") REFERENCES "public"."geography_sources"("id");



ALTER TABLE ONLY "public"."quarantined_evidence_records"
    ADD CONSTRAINT "quarantined_evidence_records_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."reader_english_verses"
    ADD CONSTRAINT "reader_english_verses_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."reader_english_editions"("id");



ALTER TABLE ONLY "public"."reader_rendering_groups"
    ADD CONSTRAINT "reader_rendering_groups_example_verse_id_fkey" FOREIGN KEY ("example_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."reader_text_event_links"
    ADD CONSTRAINT "reader_text_event_links_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "public"."reader_text_events"("event_key");



ALTER TABLE ONLY "public"."research_nodes"
    ADD CONSTRAINT "research_nodes_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."research_nodes"
    ADD CONSTRAINT "research_nodes_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "public"."lexical_senses"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."semantic_annotations"
    ADD CONSTRAINT "semantic_annotations_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."source_editions"
    ADD CONSTRAINT "source_editions_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."syntax_edges"
    ADD CONSTRAINT "syntax_edges_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."syntax_edges"
    ADD CONSTRAINT "syntax_edges_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "public"."syntax_nodes"("id");



ALTER TABLE ONLY "public"."syntax_edges"
    ADD CONSTRAINT "syntax_edges_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."syntax_edges"
    ADD CONSTRAINT "syntax_edges_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "public"."syntax_nodes"("id");



ALTER TABLE ONLY "public"."syntax_edges"
    ADD CONSTRAINT "syntax_edges_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_end_verse_id_fkey" FOREIGN KEY ("end_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_parent_node_id_fkey" FOREIGN KEY ("parent_node_id") REFERENCES "public"."syntax_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_terminal_word_id_fkey" FOREIGN KEY ("terminal_word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."syntax_nodes"
    ADD CONSTRAINT "syntax_nodes_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."tagnt_tokens"
    ADD CONSTRAINT "tagnt_tokens_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."tagnt_tokens"
    ADD CONSTRAINT "tagnt_tokens_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."tagnt_tokens"
    ADD CONSTRAINT "tagnt_tokens_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."tagnt_tokens"
    ADD CONSTRAINT "tagnt_tokens_step_word_id_fkey" FOREIGN KEY ("step_word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."token_morphemes"
    ADD CONSTRAINT "token_morphemes_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."token_morphemes"
    ADD CONSTRAINT "token_morphemes_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."token_morphemes"
    ADD CONSTRAINT "token_morphemes_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."token_morphemes"
    ADD CONSTRAINT "token_morphemes_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."token_morphemes"
    ADD CONSTRAINT "token_morphemes_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."verse_geography"
    ADD CONSTRAINT "verse_geography_chronology_event_id_fkey" FOREIGN KEY ("chronology_event_id") REFERENCES "public"."chronology_events"("id");



ALTER TABLE ONLY "public"."verse_geography"
    ADD CONSTRAINT "verse_geography_establishing_passage_id_fkey" FOREIGN KEY ("establishing_passage_id") REFERENCES "public"."passage_geography"("id");



ALTER TABLE ONLY "public"."verse_geography"
    ADD CONSTRAINT "verse_geography_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id");



ALTER TABLE ONLY "public"."verse_geography"
    ADD CONSTRAINT "verse_geography_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."geography_sources"("id");



ALTER TABLE ONLY "public"."verse_geography"
    ADD CONSTRAINT "verse_geography_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."verse_translation_sources"
    ADD CONSTRAINT "verse_translation_sources_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."verse_translation_sources"
    ADD CONSTRAINT "verse_translation_sources_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."versification_mappings"
    ADD CONSTRAINT "versification_mappings_canonical_verse_id_fkey" FOREIGN KEY ("canonical_verse_id") REFERENCES "public"."verses"("id");



ALTER TABLE ONLY "public"."versification_mappings"
    ADD CONSTRAINT "versification_mappings_from_edition_id_fkey" FOREIGN KEY ("from_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."versification_mappings"
    ADD CONSTRAINT "versification_mappings_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."versification_mappings"
    ADD CONSTRAINT "versification_mappings_to_book_fkey" FOREIGN KEY ("to_book") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."versification_mappings"
    ADD CONSTRAINT "versification_mappings_to_edition_id_fkey" FOREIGN KEY ("to_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."word_form_lemmas"
    ADD CONSTRAINT "word_form_lemmas_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "public"."lemmas"("id");



ALTER TABLE ONLY "public"."word_form_lemmas"
    ADD CONSTRAINT "word_form_lemmas_lexeme_id_fkey" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id");



ALTER TABLE ONLY "public"."word_form_lemmas"
    ADD CONSTRAINT "word_form_lemmas_source_edition_id_fkey" FOREIGN KEY ("source_edition_id") REFERENCES "public"."source_editions"("id");



ALTER TABLE ONLY "public"."word_form_lemmas"
    ADD CONSTRAINT "word_form_lemmas_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id");



ALTER TABLE ONLY "public"."word_form_lemmas"
    ADD CONSTRAINT "word_form_lemmas_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id");



ALTER TABLE ONLY "public"."word_translation_choices"
    ADD CONSTRAINT "word_translation_choices_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "bible_internal"."macula_syntax_import_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "macula_syntax_import_files_public_read" ON "bible_internal"."macula_syntax_import_files" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "bible_internal"."macula_syntax_unmapped_nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "macula_syntax_unmapped_nodes_public_read" ON "bible_internal"."macula_syntax_unmapped_nodes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow individual user to insert their own items" ON "public"."needs" FOR INSERT WITH CHECK (("user_id" = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow individual user to insert their own items" ON "public"."offers" FOR INSERT WITH CHECK (("user_id" = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow owner to delete their own items" ON "public"."needs" FOR DELETE USING (("user_id" = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow owner to delete their own items" ON "public"."offers" FOR DELETE USING (("user_id" = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow owner to insert items on their posts" ON "public"."needs" FOR INSERT WITH CHECK ((( SELECT "p"."user_id"
   FROM ("public"."pages" "p"
     JOIN "public"."posts" "cp" ON (("p"."id" = "cp"."reference_page")))
  WHERE ("cp"."id" = "needs"."connectionpost_reference")) = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow owner to insert items on their posts" ON "public"."offers" FOR INSERT WITH CHECK ((( SELECT "p"."user_id"
   FROM ("public"."pages" "p"
     JOIN "public"."posts" "cp" ON (("p"."id" = "cp"."reference_page")))
  WHERE ("cp"."id" = "offers"."connectionpost_reference")) = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow owner to update their own items" ON "public"."needs" FOR UPDATE USING (("user_id" = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow owner to update their own items" ON "public"."offers" FOR UPDATE USING (("user_id" = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow page owner to update" ON "public"."pages" FOR UPDATE USING (("user_id" = "public"."get_shopify_customer_id"()));



CREATE POLICY "Allow public read on verses" ON "public"."verses" FOR SELECT USING (true);



CREATE POLICY "Allow public read on words" ON "public"."words" FOR SELECT USING (true);



CREATE POLICY "Allow public select on note_block_types" ON "public"."note_block_types" FOR SELECT USING (true);



CREATE POLICY "Allow public select on note_connection_types" ON "public"."note_connection_types" FOR SELECT USING (true);



CREATE POLICY "Allow public select on visible note_blocks" ON "public"."note_blocks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."notes" "n"
  WHERE (("n"."id" = "note_blocks"."note_id") AND ("n"."status" = 'published'::"text") AND ("n"."visibility" = 'public'::"text")))));



CREATE POLICY "Allow public select on visible note_connections" ON "public"."note_connections" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."notes" "n"
  WHERE (("n"."id" = "note_connections"."note_id") AND ("n"."status" = 'published'::"text") AND ("n"."visibility" = 'public'::"text")))));



CREATE POLICY "Anyone can view all pages" ON "public"."pages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."needs" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."offers" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."pages" FOR SELECT USING (true);



CREATE POLICY "Enable read access for anon" ON "public"."content" FOR SELECT USING (true);



CREATE POLICY "Enable read access for anon" ON "public"."needs" FOR SELECT USING (true);



CREATE POLICY "Enable read access for anon" ON "public"."offers" FOR SELECT USING (true);



CREATE POLICY "Enable read access for anon" ON "public"."pages" FOR SELECT USING (true);



CREATE POLICY "Enable read access for anon" ON "public"."posts" FOR SELECT USING (true);



CREATE POLICY "Item owners can delete their own needs" ON "public"."needs" FOR DELETE USING (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id"));



CREATE POLICY "Item owners can delete their own offers" ON "public"."offers" FOR DELETE USING (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id"));



CREATE POLICY "Item owners can update their own needs" ON "public"."needs" FOR UPDATE USING (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id")) WITH CHECK (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id"));



CREATE POLICY "Item owners can update their own offers" ON "public"."offers" FOR UPDATE USING (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id")) WITH CHECK (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id"));



CREATE POLICY "Page owners can update their own pages" ON "public"."pages" FOR UPDATE USING (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id")) WITH CHECK (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id"));



CREATE POLICY "Public read lxx_norm_word_summary" ON "public"."lxx_norm_word_summary" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read macula_greekstrong_morphemes" ON "public"."macula_greekstrong_morphemes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read-only hebrew_lxx_word_alignments" ON "public"."hebrew_lxx_word_alignments" FOR SELECT USING (true);



CREATE POLICY "Users can delete own events" ON "public"."bol_events" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert and update their own page" ON "public"."pages" USING (("public"."get_my_shopify_id"() = "user_id")) WITH CHECK (("public"."get_my_shopify_id"() = "user_id"));



CREATE POLICY "Users can insert own events" ON "public"."bol_events" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."bol_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert own years" ON "public"."bol_years" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can only modify their own pages" ON "public"."pages" TO "authenticated" USING (("user_id" = ("auth"."jwt"() ->> 'shopify_customer_id'::"text"))) WITH CHECK (("user_id" = ("auth"."jwt"() ->> 'shopify_customer_id'::"text")));



CREATE POLICY "Users can update own events" ON "public"."bol_events" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."bol_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own years" ON "public"."bol_years" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own events" ON "public"."bol_events" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."bol_profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own years" ON "public"."bol_years" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."assertion_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assertion_evidence_public_read" ON "public"."assertion_evidence" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."assertions" "a"
  WHERE (("a"."id" = "assertion_evidence"."assertion_id") AND ("a"."review_status" = 'reviewed'::"text")))));



ALTER TABLE "public"."assertions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assertions_public_read" ON "public"."assertions" FOR SELECT TO "authenticated", "anon" USING (("review_status" = 'reviewed'::"text"));



ALTER TABLE "public"."bol_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bol_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bol_years" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."books" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."canonical_entities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "canonical_entities_public_read" ON "public"."canonical_entities" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."chronology_active_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_assertion_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_assertions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_assignment_assertions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_event_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_models" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronology_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."concept_aliases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "concept_aliases_public_read" ON "public"."concept_aliases" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."concept_external_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "concept_external_links_public_read" ON "public"."concept_external_links" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."concept_properties" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "concept_properties_public_read" ON "public"."concept_properties" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."concepts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "concepts_public_read" ON "public"."concepts" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cross_token_mappings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cross_token_mappings_public_read" ON "public"."cross_token_mappings" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."edition_passages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "edition_passages_public_read" ON "public"."edition_passages" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."entity_relationships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "entity_relationships_owner_read" ON "public"."entity_relationships" FOR SELECT TO "authenticated" USING (((("origin_mode" <> 'user_authored'::"text") AND ("review_status" = 'reviewed'::"text")) OR (("origin_mode" = 'user_authored'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "owner_user_id"))));



CREATE POLICY "entity_relationships_public_read" ON "public"."entity_relationships" FOR SELECT TO "anon" USING ((("origin_mode" <> 'user_authored'::"text") AND ("review_status" = 'reviewed'::"text")));



ALTER TABLE "public"."field_license_registry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "field_license_registry_public_read" ON "public"."field_license_registry" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."geography_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hebrew_lxx_verse_map" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hebrew_lxx_verse_map_public_read" ON "public"."hebrew_lxx_verse_map" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."hebrew_lxx_word_alignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lemma_components" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lemma_components_public_read" ON "public"."lemma_components" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lemma_root_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lemma_root_links_public_read" ON "public"."lemma_root_links" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lemmas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lemmas_public_read" ON "public"."lemmas" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lexeme_identifiers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lexeme_identifiers_public_read" ON "public"."lexeme_identifiers" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lexemes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lexemes_public_read" ON "public"."lexemes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lexical_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lexical_connections_public_read" ON "public"."lexical_connections" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lexical_formations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lexical_formations_public_read" ON "public"."lexical_formations" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lexical_roots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lexical_roots_public_read" ON "public"."lexical_roots" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lexical_senses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lexical_senses_public_read" ON "public"."lexical_senses" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lxx_norm_word_summary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lxx_swete_books" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lxx_swete_books_public_read" ON "public"."lxx_swete_books" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."lxx_swete_words" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lxx_swete_words_public_read" ON "public"."lxx_swete_words" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."macula_gated_field_values" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "macula_gated_field_values_public_read" ON "public"."macula_gated_field_values" FOR SELECT TO "authenticated", "anon" USING ("public"."field_is_enabled"("dataset_key", "field_name"));



ALTER TABLE "public"."macula_greek_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."macula_greekstrong_morphemes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."macula_hebrew_morphemes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "macula_hebrew_morphemes_public_read" ON "public"."macula_hebrew_morphemes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."mcp_connection_chains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."morphhb_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "morphhb_tokens_public_read" ON "public"."morphhb_tokens" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."needs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_anchors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_authors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_block_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_connection_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_kinds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."note_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own post" ON "public"."posts" USING (("public"."get_my_shopify_id"() = "user_id"));



CREATE POLICY "p_book_aliases_select" ON "public"."book_aliases" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "p_note_anchors_select" ON "public"."note_anchors" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."notes" "n"
  WHERE (("n"."id" = "note_anchors"."note_id") AND ("n"."status" = 'published'::"text") AND ("n"."visibility" = 'public'::"text")))));



CREATE POLICY "p_note_authors_select" ON "public"."note_authors" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "p_note_kinds_select" ON "public"."note_kinds" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "p_note_revisions_select" ON "public"."note_revisions" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."notes" "n"
  WHERE (("n"."id" = "note_revisions"."note_id") AND ("n"."status" = 'published'::"text") AND ("n"."visibility" = 'public'::"text")))));



CREATE POLICY "p_note_settings_select" ON "public"."note_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "p_notes_select" ON "public"."notes" FOR SELECT TO "authenticated", "anon" USING ((("status" = 'published'::"text") AND ("visibility" = 'public'::"text")));



CREATE POLICY "p_quarantined_select" ON "public"."quarantined_evidence_records" FOR SELECT USING (true);



CREATE POLICY "p_select_macula_greek_tokens" ON "public"."macula_greek_tokens" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "p_select_tagnt_tokens" ON "public"."tagnt_tokens" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."passage_geography" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."place_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."places" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "post owner" ON "public"."posts" USING (("user_id" = ("auth"."jwt"() ->> 'shopify_customer_id'::"text")));



ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read" ON "public"."reader_english_editions" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public_read" ON "public"."reader_english_verses" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public_read" ON "public"."reader_rendering_groups" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public_read" ON "public"."reader_text_event_links" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public_read" ON "public"."reader_text_events" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public_read_books" ON "public"."books" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "published_read" ON "public"."chronology_active_runs" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."chronology_runs" "r"
  WHERE (("r"."id" = "chronology_active_runs"."run_id") AND "r"."published"))));



CREATE POLICY "published_read" ON "public"."chronology_assertion_evidence" FOR SELECT TO "authenticated", "anon" USING (((EXISTS ( SELECT 1
   FROM "public"."chronology_assertions" "a"
  WHERE (("a"."id" = "chronology_assertion_evidence"."assertion_id") AND "a"."published"))) AND (EXISTS ( SELECT 1
   FROM "public"."chronology_evidence" "e"
  WHERE (("e"."id" = "chronology_assertion_evidence"."evidence_id") AND "e"."published")))));



CREATE POLICY "published_read" ON "public"."chronology_assertions" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."chronology_assignment_assertions" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."chronology_runs" "r"
  WHERE (("r"."id" = "chronology_assignment_assertions"."run_id") AND "r"."published"))));



CREATE POLICY "published_read" ON "public"."chronology_assignments" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."chronology_runs" "r"
  WHERE (("r"."id" = "chronology_assignments"."run_id") AND "r"."published"))));



CREATE POLICY "published_read" ON "public"."chronology_event_links" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."chronology_events" "e"
  WHERE (("e"."id" = "chronology_event_links"."event_id") AND "e"."published"))));



CREATE POLICY "published_read" ON "public"."chronology_events" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."chronology_evidence" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."chronology_models" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."chronology_runs" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."chronology_sources" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."geography_sources" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."passage_geography" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."place_locations" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."places" FOR SELECT TO "authenticated", "anon" USING ("published");



CREATE POLICY "published_read" ON "public"."verse_geography" FOR SELECT TO "authenticated", "anon" USING ("published");



ALTER TABLE "public"."quarantined_evidence_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_english_editions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_english_verses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_rendering_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_text_event_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_text_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."relation_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "relation_types_public_read" ON "public"."relation_types" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."research_nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "research_nodes_public_read" ON "public"."research_nodes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."semantic_annotations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "semantic_annotations_owner_read" ON "public"."semantic_annotations" FOR SELECT TO "authenticated" USING (((("origin_mode" <> 'user_authored'::"text") AND ("review_status" = 'reviewed'::"text")) OR (("origin_mode" = 'user_authored'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "owner_user_id"))));



CREATE POLICY "semantic_annotations_public_read" ON "public"."semantic_annotations" FOR SELECT TO "anon" USING ((("origin_mode" <> 'user_authored'::"text") AND ("review_status" = 'reviewed'::"text")));



ALTER TABLE "public"."source_editions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "source_editions_public_read" ON "public"."source_editions" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."source_releases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "source_releases_public_read" ON "public"."source_releases" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."syntax_edges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "syntax_edges_public_read" ON "public"."syntax_edges" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."syntax_nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "syntax_nodes_public_read" ON "public"."syntax_nodes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."tagnt_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_guard_probe" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_morphemes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "token_morphemes_public_read" ON "public"."token_morphemes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "translation_choices_delete" ON "public"."word_translation_choices" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "translation_choices_insert" ON "public"."word_translation_choices" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "translation_choices_read" ON "public"."word_translation_choices" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "translation_choices_update" ON "public"."word_translation_choices" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "translation_sources_read" ON "public"."verse_translation_sources" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "update" ON "public"."posts" FOR UPDATE USING (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id")) WITH CHECK (("public"."get_jwt_claim"('shopify_customer_id'::"text") = "user_id"));



CREATE POLICY "update 2" ON "public"."posts" FOR UPDATE USING (("user_id" = "public"."get_shopify_customer_id"()));



ALTER TABLE "public"."verse_geography" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."verse_translation_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."verses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."versification_mappings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "versification_mappings_public_read" ON "public"."versification_mappings" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."word_form_lemmas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "word_form_lemmas_public_read" ON "public"."word_form_lemmas" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."word_translation_choices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."words" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "bible_internal" TO "anon";
GRANT USAGE ON SCHEMA "bible_internal" TO "authenticated";
GRANT USAGE ON SCHEMA "bible_internal" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "bible_internal"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "bible_internal"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "bible_internal"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "bible_internal"."corpus_english_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "bible_internal"."corpus_english_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "anon";
GRANT ALL ON FUNCTION "bible_internal"."corpus_english_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "authenticated";
GRANT ALL ON FUNCTION "bible_internal"."corpus_english_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "service_role";



REVOKE ALL ON FUNCTION "bible_internal"."corpus_source_gloss_v1"("p_verse_id" integer, "p_position" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "bible_internal"."corpus_source_gloss_v1"("p_verse_id" integer, "p_position" integer) TO "anon";
GRANT ALL ON FUNCTION "bible_internal"."corpus_source_gloss_v1"("p_verse_id" integer, "p_position" integer) TO "authenticated";
GRANT ALL ON FUNCTION "bible_internal"."corpus_source_gloss_v1"("p_verse_id" integer, "p_position" integer) TO "service_role";



REVOKE ALL ON FUNCTION "bible_internal"."import_macula_syntax_batch_v1"("p_limit" integer, "p_edition_key" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "bible_internal"."import_macula_syntax_file_v1"("p_file_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "bible_internal"."prevent_unapproved_stage_g_truncate_v1"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "bible_internal"."require_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "bible_internal"."require_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "bible_internal"."require_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "bible_internal"."require_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "bible_internal"."verify_b7_deployed_canaries_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "bible_internal"."verify_b7_deployed_canaries_v1"() TO "service_role";



REVOKE ALL ON FUNCTION "bible_internal"."verify_imported_macula_source_v1"("p_file_id" bigint) FROM PUBLIC;



GRANT ALL ON TABLE "public"."word_form_lemmas" TO "service_role";
GRANT SELECT ON TABLE "public"."word_form_lemmas" TO "anon";
GRANT SELECT ON TABLE "public"."word_form_lemmas" TO "authenticated";



REVOKE ALL ON FUNCTION "bible_internal"."word_form_lemmas_for_words_v1"("p_word_ids" integer[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "bible_internal"."word_form_lemmas_for_words_v1"("p_word_ids" integer[]) TO "anon";
GRANT ALL ON FUNCTION "bible_internal"."word_form_lemmas_for_words_v1"("p_word_ids" integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "bible_internal"."word_form_lemmas_for_words_v1"("p_word_ids" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."agent_delete_note_v1"("p_agent" "jsonb", "p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_delete_note_v1"("p_agent" "jsonb", "p_note_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."agent_save_note_v1"("p_agent" "jsonb", "p_note" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_save_note_v1"("p_agent" "jsonb", "p_note" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_evidence_coverage_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_evidence_coverage_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_evidence_coverage_v1"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."batch_suggest_orthographic_candidates_v1"("p_queries" "text"[], "p_limit_per_query" integer, "p_min_chars" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."batch_suggest_orthographic_candidates_v1"("p_queries" "text"[], "p_limit_per_query" integer, "p_min_chars" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."batch_suggest_orthographic_candidates_v1"("p_queries" "text"[], "p_limit_per_query" integer, "p_min_chars" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."batch_suggest_orthographic_candidates_v1"("p_queries" "text"[], "p_limit_per_query" integer, "p_min_chars" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_gematria"("p_word" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_gematria"("p_word" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_gematria"("p_word" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."call_corpus_rpc_v1"("p_operation" "text", "p_params" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronology_guard_immutable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronology_guard_immutable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronology_guard_snapshot"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronology_guard_snapshot"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronology_publish_run"("p_model_id" "text", "p_label" "text", "p_activate" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronology_publish_run"("p_model_id" "text", "p_label" "text", "p_activate" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronology_year_label"("y" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronology_year_label"("y" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."chronology_year_label"("y" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronology_year_label"("y" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."clean_stale_hebrew_lxx_jeremiah_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clean_stale_hebrew_lxx_jeremiah_v1"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compare_hebrew_septuagint_passage_v1"("p_hebrew_book" integer, "p_hebrew_chapter" integer, "p_hebrew_verse" integer, "p_canonical_verse_id" integer, "p_lxx_book_no" smallint, "p_lxx_chapter" smallint, "p_lxx_verse_nr" smallint, "p_lxx_chapter_suffix" "text", "p_lxx_verse_suffix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compare_hebrew_septuagint_passage_v1"("p_hebrew_book" integer, "p_hebrew_chapter" integer, "p_hebrew_verse" integer, "p_canonical_verse_id" integer, "p_lxx_book_no" smallint, "p_lxx_chapter" smallint, "p_lxx_verse_nr" smallint, "p_lxx_chapter_suffix" "text", "p_lxx_verse_suffix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compare_hebrew_septuagint_passage_v1"("p_hebrew_book" integer, "p_hebrew_chapter" integer, "p_hebrew_verse" integer, "p_canonical_verse_id" integer, "p_lxx_book_no" smallint, "p_lxx_chapter" smallint, "p_lxx_verse_nr" smallint, "p_lxx_chapter_suffix" "text", "p_lxx_verse_suffix" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_children_items"("parent_item_id" bigint, "p_table_name" "text", "p_post_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_children_items"("parent_item_id" bigint, "p_table_name" "text", "p_post_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."decode_grammar_v1"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decode_grammar_v1"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."decode_grammar_v1"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decode_grammar_v1"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_note_v1"("p_note_id" "uuid", "p_expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_note_v1"("p_note_id" "uuid", "p_expected_version" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."delete_note_v1"("p_note_id" "uuid", "p_expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."delete_note_v1"("p_note_id" "uuid", "p_expected_version" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."dlm_note_metadata_valid_v1"("meta" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dlm_note_metadata_valid_v1"("meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."dlm_note_metadata_valid_v1"("meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dlm_note_metadata_valid_v1"("meta" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."export_static_corpus_page_v1"("p_table" "text", "p_after_id" bigint, "p_after_sub" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."export_static_corpus_page_v1"("p_table" "text", "p_after_id" bigint, "p_after_sub" bigint, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."field_is_enabled"("p_dataset" "text", "p_field" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."field_is_enabled"("p_dataset" "text", "p_field" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."field_is_enabled"("p_dataset" "text", "p_field" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."getVerseGeography"("book" integer, "chapter" integer, "verse" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."getVerseGeography"("book" integer, "chapter" integer, "verse" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."getVerseGeography"("book" integer, "chapter" integer, "verse" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."getVerseGeography"("book" integer, "chapter" integer, "verse" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_bible_books_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bible_books_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_bible_books_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bible_books_v1"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_dlm_notes_for_verse_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dlm_notes_for_verse_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dlm_notes_for_verse_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dlm_notes_for_verse_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_hebrew_import_status_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_hebrew_import_status_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hebrew_import_status_v1"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_hebrew_septuagint_parallel_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_hebrew_septuagint_parallel_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hebrew_septuagint_parallel_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_jwt_claim"("claim_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_jwt_claim"("claim_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_jwt_claim"("claim_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_shopify_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_shopify_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_shopify_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_note_v1"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_note_v1"("p_note_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_note_v1"("p_note_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_note_v1"("p_note_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_notes_for_passage_v1"("p_book" integer, "p_chapter" integer, "p_verse_start" integer, "p_verse_end" integer, "p_author_kind" "text", "p_note_kind" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_notes_for_passage_v1"("p_book" integer, "p_chapter" integer, "p_verse_start" integer, "p_verse_end" integer, "p_author_kind" "text", "p_note_kind" "text", "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_notes_for_passage_v1"("p_book" integer, "p_chapter" integer, "p_verse_start" integer, "p_verse_end" integer, "p_author_kind" "text", "p_note_kind" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_notes_for_passage_v1"("p_book" integer, "p_chapter" integer, "p_verse_start" integer, "p_verse_end" integer, "p_author_kind" "text", "p_note_kind" "text", "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_notes_for_word_v1"("p_word_id" integer, "p_verse_id" integer, "p_word_position" integer, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_notes_for_word_v1"("p_word_id" integer, "p_verse_id" integer, "p_word_position" integer, "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_notes_for_word_v1"("p_word_id" integer, "p_verse_id" integer, "p_word_position" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_notes_for_word_v1"("p_word_id" integer, "p_verse_id" integer, "p_word_position" integer, "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_reader_overview_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reader_overview_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_reader_overview_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reader_overview_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_reader_passages_v1"("p_passages" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reader_passages_v1"("p_passages" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."get_reader_passages_v1"("p_passages" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reader_passages_v1"("p_passages" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_reader_timeline_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reader_timeline_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_reader_timeline_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reader_timeline_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_reader_word_v1"("p_word_id" integer, "p_after" integer, "p_rendering" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reader_word_v1"("p_word_id" integer, "p_after" integer, "p_rendering" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_reader_word_v1"("p_word_id" integer, "p_after" integer, "p_rendering" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reader_word_v1"("p_word_id" integer, "p_after" integer, "p_rendering" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_shopify_customer_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_shopify_customer_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shopify_customer_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_static_corpus_manifest_meta_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_static_corpus_manifest_meta_v1"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_static_corpus_manifest_meta_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_static_corpus_manifest_meta_v1"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_verse_chronology_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text", "p_run_id" "text", "p_evidence_cursor" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_verse_chronology_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text", "p_run_id" "text", "p_evidence_cursor" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_verse_chronology_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text", "p_run_id" "text", "p_evidence_cursor" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_verse_chronology_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_model_id" "text", "p_run_id" "text", "p_evidence_cursor" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_verse_geography"("p_book" integer, "p_chapter" integer, "p_verse" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_verse_geography"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_verse_geography"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_verse_geography"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_verse_research_v1"("p_request" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_verse_research_v1"("p_request" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."get_verse_research_v1"("p_request" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_verse_research_v1"("p_request" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_verse_research_v2"("p_request" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_verse_research_v2"("p_request" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."get_verse_research_v2"("p_request" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_verse_research_v2"("p_request" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_verse_translations_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_verse_translations_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_verse_translations_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_verse_translations_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_word_formation_v1"("p_query" "text", "p_word_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_word_formation_v1"("p_query" "text", "p_word_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_word_formation_v1"("p_query" "text", "p_word_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_word_formation_v1"("p_query" "text", "p_word_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."harmonize_greek_accents"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."harmonize_greek_accents"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."harmonize_greek_accents"("p_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_help"("item_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_help"("item_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_help"("item_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_prayed"("item_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_prayed"("item_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_prayed"("item_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_cross_token_mappings_batch_v1"("p_mappings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_cross_token_mappings_batch_v1"("p_mappings" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_hebrew_lxx_mappings_batch_v1"("p_mappings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_hebrew_lxx_mappings_batch_v1"("p_mappings" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_hebrew_lxx_word_alignments_batch_v1"("p_alignments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_hebrew_lxx_word_alignments_batch_v1"("p_alignments" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_lexemes_batch_v1"("p_batch" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_lexemes_batch_v1"("p_batch" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_lexical_formations_batch_v1"("p_formations" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_lexical_formations_batch_v1"("p_formations" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_macula_batch_v1"("p_morphemes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_macula_batch_v1"("p_morphemes" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_macula_greek_batch_v1"("p_tokens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_macula_greek_batch_v1"("p_tokens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_morphhb_batch_v1"("p_tokens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_morphhb_batch_v1"("p_tokens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_quarantined_records_batch_v1"("p_records" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_quarantined_records_batch_v1"("p_records" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_swete_words_batch_v1"("p_words" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_swete_words_batch_v1"("p_words" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_syntax_tree_batch_v1"("p_nodes" "jsonb", "p_edges" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_syntax_tree_batch_v1"("p_nodes" "jsonb", "p_edges" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_tagnt_batch_v1"("p_tokens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_tagnt_batch_v1"("p_tokens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_note_connection_types_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_note_connection_types_v1"() TO "service_role";
GRANT ALL ON FUNCTION "public"."list_note_connection_types_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_note_connection_types_v1"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_notes_v1"("p_author_kind" "text", "p_note_kind" "text", "p_connection_type" "text", "p_query" "text", "p_limit" integer, "p_cursor" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_notes_v1"("p_author_kind" "text", "p_note_kind" "text", "p_connection_type" "text", "p_query" "text", "p_limit" integer, "p_cursor" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."list_notes_v1"("p_author_kind" "text", "p_note_kind" "text", "p_connection_type" "text", "p_query" "text", "p_limit" integer, "p_cursor" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."list_notes_v1"("p_author_kind" "text", "p_note_kind" "text", "p_connection_type" "text", "p_query" "text", "p_limit" integer, "p_cursor" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."lookup_concept_properties_v1"("p_concept_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_concept_properties_v1"("p_concept_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_concept_properties_v1"("p_concept_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_concept_properties_v1"("p_concept_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_cross_testament_greek_v1"("p_greek_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_cross_testament_greek_v1"("p_greek_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_cross_testament_greek_v1"("p_greek_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_entity_relationships_v1"("p_entity_query" "text", "p_relation_type" "text", "p_origin_mode" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_entity_relationships_v1"("p_entity_query" "text", "p_relation_type" "text", "p_origin_mode" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_entity_relationships_v1"("p_entity_query" "text", "p_relation_type" "text", "p_origin_mode" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_entity_relationships_v1"("p_entity_query" "text", "p_relation_type" "text", "p_origin_mode" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_greek_to_hebrew_alignments_v1"("p_greek_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_greek_to_hebrew_alignments_v1"("p_greek_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_greek_to_hebrew_alignments_v1"("p_greek_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_greek_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_greek_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_greek_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_hebrew_septuagint_alignments_v1"("p_query" "text", "p_tier" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_hebrew_septuagint_alignments_v1"("p_query" "text", "p_tier" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_hebrew_septuagint_alignments_v1"("p_query" "text", "p_tier" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_hebrew_to_greek_alignments_v1"("p_lemma_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_hebrew_to_greek_alignments_v1"("p_lemma_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_hebrew_to_greek_alignments_v1"("p_lemma_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_hebrew_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_hebrew_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_hebrew_verse_evidence_v1"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_lemma_english_glosses_v1"("p_lemma_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_lemma_english_glosses_v1"("p_lemma_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_lemma_english_glosses_v1"("p_lemma_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_lemma_english_glosses_v1"("p_lemma_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_lemma_occurrences_v1"("p_lemma_query" "text", "p_after_verse_id" integer, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_lemma_occurrences_v1"("p_lemma_query" "text", "p_after_verse_id" integer, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_lemma_occurrences_v1"("p_lemma_query" "text", "p_after_verse_id" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_lemma_occurrences_v1"("p_lemma_query" "text", "p_after_verse_id" integer, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_lemma_root_relatives_v1"("p_lemma_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_lemma_root_relatives_v1"("p_lemma_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_lemma_root_relatives_v1"("p_lemma_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_lemma_root_relatives_v1"("p_lemma_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_lexical_semantics_v1"("p_query" "text", "p_match_scope" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_lexical_semantics_v1"("p_query" "text", "p_match_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_lexical_semantics_v1"("p_query" "text", "p_match_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_passage_tokens_syntax_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_passage_tokens_syntax_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_passage_tokens_syntax_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_passage_tokens_syntax_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_septuagint_by_canonical_verse_v1"("p_canonical_verse_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_septuagint_by_canonical_verse_v1"("p_canonical_verse_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_septuagint_by_canonical_verse_v1"("p_canonical_verse_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_septuagint_passage_v1"("p_book_no" smallint, "p_chapter" smallint, "p_verse_nr" smallint, "p_chapter_suffix" "text", "p_verse_suffix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_septuagint_passage_v1"("p_book_no" smallint, "p_chapter" smallint, "p_verse_nr" smallint, "p_chapter_suffix" "text", "p_verse_suffix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_septuagint_passage_v1"("p_book_no" smallint, "p_chapter" smallint, "p_verse_nr" smallint, "p_chapter_suffix" "text", "p_verse_suffix" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_syntax_tree_v1"("p_verse_id" integer, "p_edition_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_syntax_tree_v1"("p_verse_id" integer, "p_edition_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_syntax_tree_v1"("p_verse_id" integer, "p_edition_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lookup_syntax_tree_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_syntax_tree_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_syntax_tree_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_edition_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_word_to_lemma_senses_v1"("p_word_id" integer, "p_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_word_to_lemma_senses_v1"("p_word_id" integer, "p_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_word_to_lemma_senses_v1"("p_word_id" integer, "p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_word_to_lemma_senses_v1"("p_word_id" integer, "p_query" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."new_message"("from_param" bigint, "to_param" bigint, "message_param" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."new_message"("from_param" bigint, "to_param" bigint, "message_param" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."note_assert_writes_enabled_v1"("p_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."note_assert_writes_enabled_v1"("p_kind" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."note_json_v1"("p_note_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."note_json_v1"("p_note_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."note_resolve_agent_author_v1"("p_agent" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."note_resolve_agent_author_v1"("p_agent" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."note_resolve_human_author_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."note_resolve_human_author_v1"() TO "service_role";



GRANT ALL ON TABLE "public"."note_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."note_settings" TO "anon";
GRANT SELECT ON TABLE "public"."note_settings" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."note_settings_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."note_settings_v1"() TO "service_role";



GRANT ALL ON FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb", "p_text_alt" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb", "p_text_alt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."note_validate_block_v1"("p_block_type" "text", "p_content" "jsonb", "p_text_alt" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."parse_bible_ref_v1"("p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parse_bible_ref_v1"("p_text" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."parse_bible_ref_v1"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."parse_bible_ref_v1"("p_text" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."prompt_verse_words"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."prompt_verse_words"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prompt_verse_words"("p_book" smallint, "p_chapter" smallint, "p_verse" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."prompt_word_cooccurrences"("p_word_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."prompt_word_cooccurrences"("p_word_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prompt_word_cooccurrences"("p_word_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prompt_word_occurrences"("p_word_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."prompt_word_occurrences"("p_word_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prompt_word_occurrences"("p_word_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prompt_word_relationships"("p_word_ids" integer[]) TO "anon";
GRANT ALL ON FUNCTION "public"."prompt_word_relationships"("p_word_ids" integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prompt_word_relationships"("p_word_ids" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reader_usage_label_v1"("p_strongs" "text", "p_english" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reader_usage_label_v1"("p_strongs" "text", "p_english" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reader_usage_label_v1"("p_strongs" "text", "p_english" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reader_usage_label_v1"("p_strongs" "text", "p_english" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_donation"("item_id" integer, "donation_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."record_donation"("item_id" integer, "donation_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_donation"("item_id" integer, "donation_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."research_passage_lens_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_max_tokens" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."research_passage_lens_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_max_tokens" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."research_passage_lens_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_max_tokens" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_passage_lens_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_max_tokens" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."research_relationships_v1"("p_request" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."research_relationships_v1"("p_request" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."research_relationships_v1"("p_request" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_relationships_v1"("p_request" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."research_word_bridge_v1"("p_left" "text", "p_right" "text", "p_limit" integer, "p_window" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."research_word_bridge_v1"("p_left" "text", "p_right" "text", "p_limit" integer, "p_window" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."research_word_bridge_v1"("p_left" "text", "p_right" "text", "p_limit" integer, "p_window" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_word_bridge_v1"("p_left" "text", "p_right" "text", "p_limit" integer, "p_window" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."research_word_lens_v1"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."research_word_lens_v1"("p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."research_word_lens_v1"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_word_lens_v1"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."reset_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."resolve_word_id"("p_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_word_id"("p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_word_id"("p_query" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_note_v1"("p_note" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_note_v1"("p_note" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_note_v1"("p_note" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_note_v1"("p_note" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer, "p_english" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer, "p_english" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_word_translation_v1"("p_book" integer, "p_chapter" integer, "p_verse" integer, "p_word_position" integer, "p_word_id" integer, "p_english" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."search_note_targets_v1"("p_query" "text", "p_kinds" "text"[], "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_note_targets_v1"("p_query" "text", "p_kinds" "text"[], "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."search_note_targets_v1"("p_query" "text", "p_kinds" "text"[], "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_note_targets_v1"("p_query" "text", "p_kinds" "text"[], "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."search_reader_words_v1"("p_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_reader_words_v1"("p_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_reader_words_v1"("p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_reader_words_v1"("p_query" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_note_review_v1"("p_note_id" "uuid", "p_review_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_note_review_v1"("p_note_id" "uuid", "p_review_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_note_review_v1"("p_note_id" "uuid", "p_review_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_note_review_v1"("p_note_id" "uuid", "p_review_status" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."strip_greek_diacritics"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strip_greek_diacritics"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strip_greek_diacritics"("p_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strip_hebrew_all"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strip_hebrew_all"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strip_hebrew_all"("p_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strip_hebrew_cantillation"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strip_hebrew_cantillation"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strip_hebrew_cantillation"("p_text" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."suggest_orthographic_candidates_v1"("p_query" "text", "p_limit" integer, "p_min_chars" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."suggest_orthographic_candidates_v1"("p_query" "text", "p_limit" integer, "p_min_chars" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."suggest_orthographic_candidates_v1"("p_query" "text", "p_limit" integer, "p_min_chars" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."suggest_orthographic_candidates_v1"("p_query" "text", "p_limit" integer, "p_min_chars" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."translation_options_v1"("p_word_id" integer, "p_source_english" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."translation_options_v1"("p_word_id" integer, "p_source_english" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."translation_options_v1"("p_word_id" integer, "p_source_english" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."translation_options_v1"("p_word_id" integer, "p_source_english" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_note_anchor_occurrence_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_note_anchor_occurrence_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_note_anchor_occurrence_v1"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_note_block_trigger_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_note_block_trigger_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_note_block_trigger_v1"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_syntax_tree_integrity_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_syntax_tree_integrity_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_syntax_tree_integrity_v1"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_word_translation_choice_v1"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_word_translation_choice_v1"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_dlm_lemma_occurrence_v1"("p_lemma_id" bigint, "p_word_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_dlm_lemma_occurrence_v1"("p_lemma_id" bigint, "p_word_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."verify_dlm_lemma_occurrence_v1"("p_lemma_id" bigint, "p_word_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_dlm_lemma_occurrence_v1"("p_lemma_id" bigint, "p_word_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_referential_integrity_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."verify_referential_integrity_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_referential_integrity_v1"() TO "service_role";



GRANT ALL ON FUNCTION "public"."whoami_v1"() TO "anon";
GRANT ALL ON FUNCTION "public"."whoami_v1"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."whoami_v1"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."word_formation_research_rpc_v1"("p_query" "text", "p_word_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."word_formation_research_rpc_v1"("p_query" "text", "p_word_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."word_formation_research_rpc_v1"("p_query" "text", "p_word_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_formation_research_rpc_v1"("p_query" "text", "p_word_id" integer) TO "service_role";



GRANT ALL ON TABLE "public"."verses" TO "service_role";
GRANT SELECT ON TABLE "public"."verses" TO "anon";
GRANT SELECT ON TABLE "public"."verses" TO "authenticated";



GRANT SELECT ON TABLE "bible_internal"."corpus_english_verses" TO "anon";
GRANT SELECT ON TABLE "bible_internal"."corpus_english_verses" TO "authenticated";
GRANT SELECT ON TABLE "bible_internal"."corpus_english_verses" TO "service_role";



GRANT SELECT ON TABLE "bible_internal"."corpus_tokens" TO "anon";
GRANT SELECT ON TABLE "bible_internal"."corpus_tokens" TO "authenticated";
GRANT SELECT ON TABLE "bible_internal"."corpus_tokens" TO "service_role";



GRANT SELECT ON TABLE "bible_internal"."macula_syntax_import_files" TO "anon";
GRANT SELECT ON TABLE "bible_internal"."macula_syntax_import_files" TO "authenticated";



GRANT SELECT ON TABLE "bible_internal"."macula_syntax_unmapped_nodes" TO "anon";
GRANT SELECT ON TABLE "bible_internal"."macula_syntax_unmapped_nodes" TO "authenticated";



GRANT ALL ON TABLE "public"."assertion_evidence" TO "anon";
GRANT ALL ON TABLE "public"."assertion_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."assertion_evidence" TO "service_role";



GRANT ALL ON SEQUENCE "public"."assertion_evidence_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."assertion_evidence_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."assertion_evidence_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."assertions" TO "anon";
GRANT ALL ON TABLE "public"."assertions" TO "authenticated";
GRANT ALL ON TABLE "public"."assertions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."assertions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."assertions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."assertions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bol_events" TO "anon";
GRANT ALL ON TABLE "public"."bol_events" TO "authenticated";
GRANT ALL ON TABLE "public"."bol_events" TO "service_role";



GRANT ALL ON TABLE "public"."bol_profiles" TO "anon";
GRANT ALL ON TABLE "public"."bol_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."bol_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."bol_years" TO "anon";
GRANT ALL ON TABLE "public"."bol_years" TO "authenticated";
GRANT ALL ON TABLE "public"."bol_years" TO "service_role";



GRANT ALL ON TABLE "public"."book_aliases" TO "service_role";
GRANT SELECT ON TABLE "public"."book_aliases" TO "anon";
GRANT SELECT ON TABLE "public"."book_aliases" TO "authenticated";



GRANT ALL ON TABLE "public"."books" TO "service_role";
GRANT SELECT ON TABLE "public"."books" TO "anon";
GRANT SELECT ON TABLE "public"."books" TO "authenticated";



GRANT ALL ON TABLE "public"."canonical_entities" TO "service_role";
GRANT SELECT ON TABLE "public"."canonical_entities" TO "anon";
GRANT SELECT ON TABLE "public"."canonical_entities" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."canonical_entities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."canonical_entities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."canonical_entities_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chronology_active_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_active_runs" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_active_runs" TO "authenticated";



GRANT ALL ON TABLE "public"."chronology_assertion_evidence" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_assertion_evidence" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_assertion_evidence" TO "authenticated";



GRANT ALL ON TABLE "public"."chronology_assertions" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_assertions" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_assertions" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."chronology_assertions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chronology_assertions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chronology_assertions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chronology_assignment_assertions" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_assignment_assertions" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_assignment_assertions" TO "authenticated";



GRANT ALL ON TABLE "public"."chronology_assignments" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_assignments" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_assignments" TO "authenticated";



GRANT ALL ON TABLE "public"."chronology_event_links" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_event_links" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_event_links" TO "authenticated";



GRANT ALL ON TABLE "public"."chronology_events" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_events" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."chronology_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chronology_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chronology_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chronology_evidence" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_evidence" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_evidence" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."chronology_evidence_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chronology_evidence_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chronology_evidence_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chronology_models" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_models" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_models" TO "authenticated";



GRANT ALL ON TABLE "public"."chronology_revisions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chronology_revisions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chronology_revisions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chronology_revisions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chronology_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_runs" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_runs" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."chronology_runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chronology_runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chronology_runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chronology_sources" TO "service_role";
GRANT SELECT ON TABLE "public"."chronology_sources" TO "anon";
GRANT SELECT ON TABLE "public"."chronology_sources" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."chronology_sources_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chronology_sources_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chronology_sources_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."concept_aliases" TO "anon";
GRANT ALL ON TABLE "public"."concept_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."concept_aliases" TO "service_role";



GRANT ALL ON SEQUENCE "public"."concept_aliases_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."concept_aliases_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."concept_aliases_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."concept_external_links" TO "service_role";
GRANT SELECT ON TABLE "public"."concept_external_links" TO "anon";
GRANT SELECT ON TABLE "public"."concept_external_links" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."concept_external_links_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."concept_external_links_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."concept_external_links_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."concept_properties" TO "service_role";
GRANT SELECT ON TABLE "public"."concept_properties" TO "anon";
GRANT SELECT ON TABLE "public"."concept_properties" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."concept_properties_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."concept_properties_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."concept_properties_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."concepts" TO "anon";
GRANT ALL ON TABLE "public"."concepts" TO "authenticated";
GRANT ALL ON TABLE "public"."concepts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."concepts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."concepts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."concepts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."content" TO "anon";
GRANT ALL ON TABLE "public"."content" TO "authenticated";
GRANT ALL ON TABLE "public"."content" TO "service_role";



GRANT ALL ON SEQUENCE "public"."content_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."content_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."content_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cross_token_mappings" TO "service_role";
GRANT SELECT ON TABLE "public"."cross_token_mappings" TO "anon";
GRANT SELECT ON TABLE "public"."cross_token_mappings" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cross_token_mappings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cross_token_mappings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cross_token_mappings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."edition_passages" TO "service_role";
GRANT SELECT ON TABLE "public"."edition_passages" TO "anon";
GRANT SELECT ON TABLE "public"."edition_passages" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."edition_passages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."edition_passages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."edition_passages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."entity_relationships" TO "service_role";
GRANT SELECT ON TABLE "public"."entity_relationships" TO "anon";
GRANT SELECT ON TABLE "public"."entity_relationships" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."entity_relationships_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."entity_relationships_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."entity_relationships_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."field_license_registry" TO "service_role";
GRANT SELECT ON TABLE "public"."field_license_registry" TO "anon";
GRANT SELECT ON TABLE "public"."field_license_registry" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."field_license_registry_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."field_license_registry_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."field_license_registry_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."geography_sources" TO "service_role";
GRANT SELECT ON TABLE "public"."geography_sources" TO "anon";
GRANT SELECT ON TABLE "public"."geography_sources" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."geography_sources_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."geography_sources_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."geography_sources_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hebrew_lxx_verse_map" TO "service_role";
GRANT SELECT ON TABLE "public"."hebrew_lxx_verse_map" TO "anon";
GRANT SELECT ON TABLE "public"."hebrew_lxx_verse_map" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."hebrew_lxx_verse_map_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hebrew_lxx_verse_map_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hebrew_lxx_verse_map_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."hebrew_lxx_word_alignments" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."hebrew_lxx_word_alignments" TO "authenticated";
GRANT ALL ON TABLE "public"."hebrew_lxx_word_alignments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hebrew_lxx_word_alignments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hebrew_lxx_word_alignments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hebrew_lxx_word_alignments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lemma_components" TO "service_role";
GRANT SELECT ON TABLE "public"."lemma_components" TO "anon";
GRANT SELECT ON TABLE "public"."lemma_components" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lemma_components_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lemma_components_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lemma_components_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lemma_root_links" TO "service_role";
GRANT SELECT ON TABLE "public"."lemma_root_links" TO "anon";
GRANT SELECT ON TABLE "public"."lemma_root_links" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lemma_root_links_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lemma_root_links_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lemma_root_links_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lemmas" TO "service_role";
GRANT SELECT ON TABLE "public"."lemmas" TO "anon";
GRANT SELECT ON TABLE "public"."lemmas" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lemmas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lemmas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lemmas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lexeme_identifiers" TO "service_role";
GRANT SELECT ON TABLE "public"."lexeme_identifiers" TO "anon";
GRANT SELECT ON TABLE "public"."lexeme_identifiers" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lexeme_identifiers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lexeme_identifiers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lexeme_identifiers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lexemes" TO "anon";
GRANT ALL ON TABLE "public"."lexemes" TO "authenticated";
GRANT ALL ON TABLE "public"."lexemes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."lexemes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lexemes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lexemes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lexical_connections" TO "service_role";
GRANT SELECT ON TABLE "public"."lexical_connections" TO "anon";
GRANT SELECT ON TABLE "public"."lexical_connections" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lexical_connections_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lexical_connections_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lexical_connections_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lexical_formations" TO "service_role";
GRANT SELECT ON TABLE "public"."lexical_formations" TO "anon";
GRANT SELECT ON TABLE "public"."lexical_formations" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lexical_formations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lexical_formations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lexical_formations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lexical_roots" TO "service_role";
GRANT SELECT ON TABLE "public"."lexical_roots" TO "anon";
GRANT SELECT ON TABLE "public"."lexical_roots" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lexical_roots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lexical_roots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lexical_roots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lexical_senses" TO "service_role";
GRANT SELECT ON TABLE "public"."lexical_senses" TO "anon";
GRANT SELECT ON TABLE "public"."lexical_senses" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lexical_senses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lexical_senses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lexical_senses_id_seq" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."lxx_norm_word_summary" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."lxx_norm_word_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."lxx_norm_word_summary" TO "service_role";



GRANT ALL ON TABLE "public"."lxx_swete_books" TO "service_role";
GRANT SELECT ON TABLE "public"."lxx_swete_books" TO "anon";
GRANT SELECT ON TABLE "public"."lxx_swete_books" TO "authenticated";



GRANT ALL ON TABLE "public"."lxx_swete_words" TO "service_role";
GRANT SELECT ON TABLE "public"."lxx_swete_words" TO "anon";
GRANT SELECT ON TABLE "public"."lxx_swete_words" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."lxx_swete_words_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lxx_swete_words_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lxx_swete_words_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."macula_gated_field_values" TO "service_role";
GRANT SELECT ON TABLE "public"."macula_gated_field_values" TO "anon";
GRANT SELECT ON TABLE "public"."macula_gated_field_values" TO "authenticated";



GRANT ALL ON TABLE "public"."macula_greek_tokens" TO "anon";
GRANT ALL ON TABLE "public"."macula_greek_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."macula_greek_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."macula_greek_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."macula_greek_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."macula_greek_tokens_id_seq" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."macula_greekstrong_morphemes" TO "anon";
GRANT MAINTAIN ON TABLE "public"."macula_greekstrong_morphemes" TO "authenticated";
GRANT ALL ON TABLE "public"."macula_greekstrong_morphemes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."macula_greekstrong_morphemes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."macula_greekstrong_morphemes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."macula_greekstrong_morphemes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."macula_hebrew_morphemes" TO "service_role";
GRANT SELECT ON TABLE "public"."macula_hebrew_morphemes" TO "anon";
GRANT SELECT ON TABLE "public"."macula_hebrew_morphemes" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."macula_hebrew_morphemes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."macula_hebrew_morphemes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."macula_hebrew_morphemes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_connection_chains" TO "service_role";



GRANT ALL ON TABLE "public"."morphhb_tokens" TO "service_role";
GRANT SELECT ON TABLE "public"."morphhb_tokens" TO "anon";
GRANT SELECT ON TABLE "public"."morphhb_tokens" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."morphhb_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."morphhb_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."morphhb_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."needs" TO "anon";
GRANT ALL ON TABLE "public"."needs" TO "authenticated";
GRANT ALL ON TABLE "public"."needs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."needs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."needs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."needs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."note_anchors" TO "service_role";
GRANT SELECT ON TABLE "public"."note_anchors" TO "anon";
GRANT SELECT ON TABLE "public"."note_anchors" TO "authenticated";



GRANT ALL ON TABLE "public"."note_authors" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."note_authors" TO "anon";
GRANT SELECT("id") ON TABLE "public"."note_authors" TO "authenticated";



GRANT SELECT("author_kind") ON TABLE "public"."note_authors" TO "anon";
GRANT SELECT("author_kind") ON TABLE "public"."note_authors" TO "authenticated";



GRANT SELECT("display_name") ON TABLE "public"."note_authors" TO "anon";
GRANT SELECT("display_name") ON TABLE "public"."note_authors" TO "authenticated";



GRANT SELECT("ai_provider") ON TABLE "public"."note_authors" TO "anon";
GRANT SELECT("ai_provider") ON TABLE "public"."note_authors" TO "authenticated";



GRANT SELECT("ai_model") ON TABLE "public"."note_authors" TO "anon";
GRANT SELECT("ai_model") ON TABLE "public"."note_authors" TO "authenticated";



GRANT SELECT("ai_client") ON TABLE "public"."note_authors" TO "anon";
GRANT SELECT("ai_client") ON TABLE "public"."note_authors" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."note_authors" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."note_authors" TO "authenticated";



GRANT ALL ON TABLE "public"."note_block_types" TO "service_role";
GRANT SELECT ON TABLE "public"."note_block_types" TO "anon";
GRANT SELECT ON TABLE "public"."note_block_types" TO "authenticated";



GRANT ALL ON TABLE "public"."note_blocks" TO "service_role";
GRANT SELECT ON TABLE "public"."note_blocks" TO "anon";
GRANT SELECT ON TABLE "public"."note_blocks" TO "authenticated";



GRANT ALL ON TABLE "public"."note_connection_types" TO "service_role";
GRANT SELECT ON TABLE "public"."note_connection_types" TO "anon";
GRANT SELECT ON TABLE "public"."note_connection_types" TO "authenticated";



GRANT ALL ON TABLE "public"."note_connections" TO "service_role";
GRANT SELECT ON TABLE "public"."note_connections" TO "anon";
GRANT SELECT ON TABLE "public"."note_connections" TO "authenticated";



GRANT ALL ON TABLE "public"."note_kinds" TO "service_role";
GRANT SELECT ON TABLE "public"."note_kinds" TO "anon";
GRANT SELECT ON TABLE "public"."note_kinds" TO "authenticated";



GRANT ALL ON TABLE "public"."note_revisions" TO "service_role";



GRANT SELECT("note_id") ON TABLE "public"."note_revisions" TO "anon";
GRANT SELECT("note_id") ON TABLE "public"."note_revisions" TO "authenticated";



GRANT SELECT("version") ON TABLE "public"."note_revisions" TO "anon";
GRANT SELECT("version") ON TABLE "public"."note_revisions" TO "authenticated";



GRANT SELECT("action") ON TABLE "public"."note_revisions" TO "anon";
GRANT SELECT("action") ON TABLE "public"."note_revisions" TO "authenticated";



GRANT SELECT("editor_kind") ON TABLE "public"."note_revisions" TO "anon";
GRANT SELECT("editor_kind") ON TABLE "public"."note_revisions" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."note_revisions" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."note_revisions" TO "authenticated";



GRANT ALL ON TABLE "public"."notes" TO "service_role";
GRANT SELECT ON TABLE "public"."notes" TO "anon";
GRANT SELECT ON TABLE "public"."notes" TO "authenticated";



GRANT ALL ON TABLE "public"."offers" TO "anon";
GRANT ALL ON TABLE "public"."offers" TO "authenticated";
GRANT ALL ON TABLE "public"."offers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."offers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."offers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."offers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."passage_geography" TO "service_role";
GRANT SELECT ON TABLE "public"."passage_geography" TO "anon";
GRANT SELECT ON TABLE "public"."passage_geography" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."passage_geography_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."passage_geography_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."passage_geography_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."place_locations" TO "service_role";
GRANT SELECT ON TABLE "public"."place_locations" TO "anon";
GRANT SELECT ON TABLE "public"."place_locations" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."place_locations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."place_locations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."place_locations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."places" TO "service_role";
GRANT SELECT ON TABLE "public"."places" TO "anon";
GRANT SELECT ON TABLE "public"."places" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."places_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."places_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."places_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."posts" TO "anon";
GRANT ALL ON TABLE "public"."posts" TO "authenticated";
GRANT ALL ON TABLE "public"."posts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."posts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."posts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."posts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quarantined_evidence_records" TO "service_role";
GRANT SELECT ON TABLE "public"."quarantined_evidence_records" TO "anon";
GRANT SELECT ON TABLE "public"."quarantined_evidence_records" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."quarantined_evidence_records_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quarantined_evidence_records_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quarantined_evidence_records_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."reader_english_editions" TO "service_role";
GRANT SELECT ON TABLE "public"."reader_english_editions" TO "anon";
GRANT SELECT ON TABLE "public"."reader_english_editions" TO "authenticated";



GRANT ALL ON TABLE "public"."reader_english_verses" TO "service_role";
GRANT SELECT ON TABLE "public"."reader_english_verses" TO "anon";
GRANT SELECT ON TABLE "public"."reader_english_verses" TO "authenticated";



GRANT ALL ON TABLE "public"."reader_rendering_groups" TO "service_role";
GRANT SELECT ON TABLE "public"."reader_rendering_groups" TO "anon";
GRANT SELECT ON TABLE "public"."reader_rendering_groups" TO "authenticated";



GRANT ALL ON TABLE "public"."reader_text_event_links" TO "service_role";
GRANT SELECT ON TABLE "public"."reader_text_event_links" TO "anon";
GRANT SELECT ON TABLE "public"."reader_text_event_links" TO "authenticated";



GRANT ALL ON TABLE "public"."reader_text_events" TO "service_role";
GRANT SELECT ON TABLE "public"."reader_text_events" TO "anon";
GRANT SELECT ON TABLE "public"."reader_text_events" TO "authenticated";



GRANT ALL ON TABLE "public"."relation_types" TO "service_role";
GRANT SELECT ON TABLE "public"."relation_types" TO "anon";
GRANT SELECT ON TABLE "public"."relation_types" TO "authenticated";



GRANT ALL ON TABLE "public"."research_nodes" TO "anon";
GRANT ALL ON TABLE "public"."research_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."research_nodes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."research_nodes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."research_nodes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."research_nodes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."semantic_annotations" TO "service_role";
GRANT SELECT ON TABLE "public"."semantic_annotations" TO "anon";
GRANT SELECT ON TABLE "public"."semantic_annotations" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."semantic_annotations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."semantic_annotations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."semantic_annotations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."source_editions" TO "service_role";
GRANT SELECT ON TABLE "public"."source_editions" TO "anon";
GRANT SELECT ON TABLE "public"."source_editions" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."source_editions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."source_editions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."source_editions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."source_releases" TO "anon";
GRANT ALL ON TABLE "public"."source_releases" TO "authenticated";
GRANT ALL ON TABLE "public"."source_releases" TO "service_role";



GRANT ALL ON SEQUENCE "public"."source_releases_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."source_releases_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."source_releases_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."syntax_edges" TO "service_role";
GRANT SELECT ON TABLE "public"."syntax_edges" TO "anon";
GRANT SELECT ON TABLE "public"."syntax_edges" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."syntax_edges_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."syntax_edges_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."syntax_edges_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."syntax_nodes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."syntax_nodes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."syntax_nodes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."syntax_nodes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tagnt_tokens" TO "anon";
GRANT ALL ON TABLE "public"."tagnt_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."tagnt_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tagnt_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tagnt_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tagnt_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."test_guard_probe" TO "service_role";



GRANT ALL ON TABLE "public"."token_morphemes" TO "service_role";
GRANT SELECT ON TABLE "public"."token_morphemes" TO "anon";
GRANT SELECT ON TABLE "public"."token_morphemes" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."token_morphemes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."token_morphemes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."token_morphemes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."verse_geography" TO "service_role";
GRANT SELECT ON TABLE "public"."verse_geography" TO "anon";
GRANT SELECT ON TABLE "public"."verse_geography" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."verse_geography_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."verse_geography_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."verse_geography_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."verse_translation_sources" TO "service_role";
GRANT SELECT ON TABLE "public"."verse_translation_sources" TO "anon";
GRANT SELECT ON TABLE "public"."verse_translation_sources" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."verses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."verses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."verses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."versification_mappings" TO "service_role";
GRANT SELECT ON TABLE "public"."versification_mappings" TO "anon";
GRANT SELECT ON TABLE "public"."versification_mappings" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."versification_mappings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."versification_mappings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."versification_mappings_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."word_form_lemmas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."word_form_lemmas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."word_form_lemmas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."word_translation_choices" TO "service_role";
GRANT SELECT ON TABLE "public"."word_translation_choices" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."word_translation_choices" TO "authenticated";



GRANT ALL ON TABLE "public"."words" TO "service_role";
GRANT SELECT ON TABLE "public"."words" TO "anon";
GRANT SELECT ON TABLE "public"."words" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






