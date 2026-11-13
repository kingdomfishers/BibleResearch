// Preserve captured SQL contracts; replace only their immutable-source relations.
import fs from 'node:fs';
import crypto from 'node:crypto';
const functions=JSON.parse(fs.readFileSync('.artifacts/phase0/live-functions.json'));
const hashes=JSON.parse(fs.readFileSync('.artifacts/phase0/current-function-hashes.json'));
const names=['get_dlm_notes_for_verse_v1','get_notes_for_passage_v1','research_passage_lens_v1','research_word_bridge_v1','research_word_lens_v1','verify_dlm_lemma_occurrence_v1'];
const definitions=[];
for(const name of names){
 const f=functions.find(f=>f.schema==='public'&&f.name===name);
 const live=hashes.find(x=>x.schema===f.schema&&x.name===f.name&&x.identity_arguments===f.identity_arguments);
 if(!live||crypto.createHash('md5').update(f.definition).digest('hex')!==live.md5)throw Error('New deployed source must be reconciled: '+name);
 let sql=f.definition;
 if(name==='get_dlm_notes_for_verse_v1') sql=sql.replaceAll('public.word_form_lemmas wfl','bible_internal.word_form_lemmas_for_words_v1(v_word_ids) wfl');
 if(name==='verify_dlm_lemma_occurrence_v1')sql=sql.replaceAll('public.word_form_lemmas wfl','bible_internal.word_form_lemmas_for_words_v1(ARRAY[p_word_id]) wfl');
 if(name==='get_notes_for_passage_v1')sql=sql.replaceAll('public.word_form_lemmas wfl','bible_internal.word_form_lemmas_for_words_v1(ARRAY(SELECT word_id FROM passage_words)) wfl');
 if(name==='research_word_lens_v1'||name==='research_word_bridge_v1')sql=sql.replaceAll('public.verse_translation_sources','bible_internal.corpus_tokens').replaceAll('public.reader_english_verses','bible_internal.corpus_english_verses');
 if(name==='research_word_lens_v1'){
   // Select canonical witnesses before retrieving their source gloss/text.
   sql=sql.replace('t.source_english,re.text AS english_web','v.id AS source_verse_id');
   sql=sql.replace(/\s+LEFT JOIN bible_internal\.corpus_english_verses re ON re\.book=v\.book AND re\.chapter=v\.chapter\s+AND re\.verse_nr=v\.verse_nr AND re\.edition_id='webp-2026-11'/,'');
   sql=sql.replace("'word_gloss',b.source_english,'english_web',b.english_web","'word_gloss',bible_internal.corpus_source_gloss_v1(b.source_verse_id,b.word_position),'english_web',bible_internal.corpus_english_v1(b.book,b.chapter,b.verse_nr)");
 }
 if(name==='research_passage_lens_v1'){
   sql=sql.replace('DECLARE','DECLARE v_source jsonb;');
   const anchor=' language:=CASE';
   if(!sql.includes(anchor))throw Error('Passage lens source anchor changed');
   sql=sql.replace(anchor," v_source:=bible_internal.require_corpus_rpc_v1('get_passage_lens_source_v1',jsonb_build_object('p_book',p_book,'p_chapter',p_chapter,'p_verse',p_verse));\n"+anchor);
   sql=sql.replaceAll('FROM public.macula_hebrew_morphemes','FROM jsonb_populate_recordset(NULL::public.macula_hebrew_morphemes,v_source->\'hebrew\')');
   sql=sql.replaceAll('FROM public.macula_greek_tokens',"FROM jsonb_populate_recordset(NULL::public.macula_greek_tokens,(SELECT coalesce(jsonb_agg(x||jsonb_build_object('frame',x->'semantic_frame_source')),'[]'::jsonb) FROM jsonb_array_elements(v_source->'greek') x))");
   sql=sql.replaceAll('public.reader_english_verses','bible_internal.corpus_english_verses');
 }
 if(sql===f.definition)throw Error('Reader was not migrated: '+name);
 definitions.push(sql.trim()+';');
}
const metadata=`CREATE OR REPLACE FUNCTION public.get_static_corpus_manifest_meta_v1() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $fn$ SELECT bible_internal.require_corpus_rpc_v1('get_static_corpus_metadata_v1','{}'::jsonb)-'status' $fn$;`;
const gatewaySource=functions.find(f=>f.schema==='bible_internal'&&f.name==='call_corpus_rpc_v1');
const gateway=gatewaySource.definition.replace('  RETURN NULL;',`  IF p_operation IN ('audit_evidence_coverage_v1','verify_referential_integrity_v1','validate_syntax_tree_integrity_v1','get_hebrew_import_status_v1') THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'Required static corpus unavailable: %',p_operation USING ERRCODE='53300';`);
if(gateway===gatewaySource.definition)throw Error('Corpus gateway failure anchor changed');
fs.writeFileSync('.artifacts/phase0/strict-corpus-gateway.sql',gateway.trim()+';');
const target='supabase/migrations/20261111000133_phase0_cloudflare_active_readers.sql';
const expected=hashes.filter(f=>(f.schema==='public'&&[...names,'get_static_corpus_manifest_meta_v1'].includes(f.name))||(f.schema==='bible_internal'&&f.name==='call_corpus_rpc_v1'));
const guard=`-- BEGIN LIVE SOURCE GUARD
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset('${JSON.stringify(expected).replaceAll("'","''")}'::jsonb) e(schema text,name text,identity_arguments text,md5 text)
 LEFT JOIN pg_namespace n ON n.nspname=e.schema LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.name AND pg_get_function_identity_arguments(p.oid)=e.identity_arguments
 WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM e.md5)
 THEN RAISE EXCEPTION 'New deployed reader changes must be reconciled before Phase 0 migration'; END IF;
END $guard$;
-- END LIVE SOURCE GUARD\n`;
fs.writeFileSync(target,'-- Non-destructive reader migration. No table data is removed.\nBEGIN;\n'+guard+gateway.trim()+';\n'+fs.readFileSync('supabase/recovery/cloudflare-reader-helpers.sql','utf8')+'\n'+definitions.join('\n\n')+'\n'+metadata+'\nCOMMIT;\n');
console.log(JSON.stringify({generated:target,readers:7,strict_gateway:true}));
