-- Source reconciliation only: preserves deployed definitions and execution grants.
BEGIN;
-- Captured live SHA-256: f6bbeb59242b21c60e5771dd10dd4ee58939e2bb86cc8f8b76ec0970fe883fca
CREATE OR REPLACE FUNCTION bible_internal.import_macula_syntax_batch_v1(p_limit integer DEFAULT 5, p_edition_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION bible_internal.import_macula_syntax_batch_v1(p_limit integer, p_edition_key text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bible_internal.import_macula_syntax_batch_v1(p_limit integer, p_edition_key text) TO postgres;

-- Captured live SHA-256: 594f795b8665da520c009a5ffe970aa6bd05be9b445ce83711557fe68beea7d2
CREATE OR REPLACE FUNCTION bible_internal.import_macula_syntax_file_v1(p_file_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION bible_internal.import_macula_syntax_file_v1(p_file_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bible_internal.import_macula_syntax_file_v1(p_file_id bigint) TO postgres;

-- Captured live SHA-256: d3d305badfe0dd30f000275e2ff0dd9b2f30ae010f7082a1946a896c1cc23d5d
CREATE OR REPLACE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'STAGE_G_LOCKED: % cannot be truncated until independent backup, compatibility and approval gates are verified; remove this guard only with explicit authorized release sign-off', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE='55000';
END $function$;
REVOKE ALL ON FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1() TO postgres;

-- Captured live SHA-256: a9f3c5bfc510a9fe073a5ba08529991bbc43b5ae365a498e868f8cd2ec545cb8
CREATE OR REPLACE FUNCTION bible_internal.verify_b7_deployed_canaries_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION bible_internal.verify_b7_deployed_canaries_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bible_internal.verify_b7_deployed_canaries_v1() TO postgres;
GRANT EXECUTE ON FUNCTION bible_internal.verify_b7_deployed_canaries_v1() TO service_role;

-- Captured live SHA-256: 90eb154f490d4e345ee0bf78d57888f64f074bd109b54c57b31eea1aad48d011
CREATE OR REPLACE FUNCTION bible_internal.verify_imported_macula_source_v1(p_file_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION bible_internal.verify_imported_macula_source_v1(p_file_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bible_internal.verify_imported_macula_source_v1(p_file_id bigint) TO postgres;

-- Captured live SHA-256: 2c22b132b83e985d5ffa0c5dc0737665e5a0cf3e3159b171d8e19def7524e0b5
CREATE OR REPLACE FUNCTION public.dlm_note_metadata_valid_v1(meta jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.dlm_note_metadata_valid_v1(meta jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dlm_note_metadata_valid_v1(meta jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.dlm_note_metadata_valid_v1(meta jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.dlm_note_metadata_valid_v1(meta jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dlm_note_metadata_valid_v1(meta jsonb) TO service_role;

-- Captured live SHA-256: 5182d2668e8e7152f39915bf5f47c5b1063ffbf971aa91324450c64e7938fcc6
CREATE OR REPLACE FUNCTION public.get_dlm_notes_for_verse_v1(p_book integer, p_chapter integer, p_verse integer, p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '8s'
AS $function$
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
         SELECT 1 FROM public.word_form_lemmas wfl
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
END $function$;
REVOKE ALL ON FUNCTION public.get_dlm_notes_for_verse_v1(p_book integer, p_chapter integer, p_verse integer, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dlm_notes_for_verse_v1(p_book integer, p_chapter integer, p_verse integer, p_limit integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_dlm_notes_for_verse_v1(p_book integer, p_chapter integer, p_verse integer, p_limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_dlm_notes_for_verse_v1(p_book integer, p_chapter integer, p_verse integer, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dlm_notes_for_verse_v1(p_book integer, p_chapter integer, p_verse integer, p_limit integer) TO service_role;

-- Captured live SHA-256: b7cb9b926235c241ec8de2e82ea05156f1b5a45c34dd988647c4795115e23376
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
END $function$;
REVOKE ALL ON FUNCTION public.research_passage_lens_v1(p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.research_passage_lens_v1(p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.research_passage_lens_v1(p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer) TO anon;
GRANT EXECUTE ON FUNCTION public.research_passage_lens_v1(p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.research_passage_lens_v1(p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer) TO service_role;

-- Captured live SHA-256: cae3d6cf663bb66c469484c6dbf6abb960a1cd472a1352f6938229e0b624b1ee
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
END $function$;
REVOKE ALL ON FUNCTION public.research_word_bridge_v1(p_left text, p_right text, p_limit integer, p_window integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.research_word_bridge_v1(p_left text, p_right text, p_limit integer, p_window integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.research_word_bridge_v1(p_left text, p_right text, p_limit integer, p_window integer) TO anon;
GRANT EXECUTE ON FUNCTION public.research_word_bridge_v1(p_left text, p_right text, p_limit integer, p_window integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.research_word_bridge_v1(p_left text, p_right text, p_limit integer, p_window integer) TO service_role;

-- Captured live SHA-256: 3bd4fc316a4d146ff100169e9281cf76462fe8672ca1d7c2bb7e339e36b219d8
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
END $function$;
REVOKE ALL ON FUNCTION public.research_word_lens_v1(p_query text, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.research_word_lens_v1(p_query text, p_limit integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.research_word_lens_v1(p_query text, p_limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.research_word_lens_v1(p_query text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.research_word_lens_v1(p_query text, p_limit integer) TO service_role;

-- Captured live SHA-256: 5f97067a669684dcf66b85847109a964ed23dacaf68e733d6be72590818f1e66
CREATE OR REPLACE FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '4s'
AS $function$
 SELECT EXISTS(
   SELECT 1 FROM public.word_form_lemmas wfl
   WHERE wfl.lemma_id=p_lemma_id AND wfl.word_id=p_word_id
     AND wfl.is_context_ambiguous IS FALSE
 )
$function$;
REVOKE ALL ON FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer) TO service_role;
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON bible_internal.macula_syntax_import_files FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON bible_internal.macula_syntax_unmapped_nodes FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON cross_token_mappings FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON edition_passages FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON hebrew_lxx_verse_map FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON hebrew_lxx_word_alignments FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON lexeme_identifiers FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON lxx_norm_word_summary FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON lxx_swete_words FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON macula_gated_field_values FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON macula_greek_tokens FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON macula_greekstrong_morphemes FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON macula_hebrew_morphemes FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON morphhb_tokens FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON reader_english_verses FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON reader_rendering_groups FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON syntax_edges FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON syntax_nodes FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON tagnt_tokens FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON token_morphemes FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON verse_translation_sources FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON versification_mappings FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
CREATE OR REPLACE TRIGGER stage_g_release_gate BEFORE TRUNCATE ON word_form_lemmas FOR EACH STATEMENT EXECUTE FUNCTION bible_internal.prevent_unapproved_stage_g_truncate_v1();
COMMIT;
