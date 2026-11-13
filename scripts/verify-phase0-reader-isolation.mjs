// Executes real SQL readers with every reclamation table empty and denied to anon.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import worker from './corpus-worker.mjs';
import { buildReclamationSchema, quoteRelation, quoteIdentifier } from './build-reclamation-backup-schema.mjs';
import { RECLAMATION_TABLES } from './phase0-storage-scope.mjs';

const root='.artifacts/phase0';
const functions=JSON.parse(fs.readFileSync(`${root}/live-functions.json`));
const catalog=JSON.parse(fs.readFileSync('supabase/recovery/reclamation-catalog.json'));
for(const t of JSON.parse(fs.readFileSync(`${root}/test-extra-relations.json`)))if(!catalog.relations.some(x=>x.schema===t.schema&&x.name===t.name))catalog.relations.push(t);
const expressions=catalog.relations.flatMap(t=>[...t.columns.map(c=>c.default??''),...(t.constraints??[]).filter(c=>c.type!=='f').map(c=>c.definition)]).join('\n');
for(const f of functions)if(new RegExp('\\b'+f.name+'\\s*\\(','i').test(expressions)&&!catalog.helpers.some(h=>h.schema===f.schema&&h.name===f.name&&h.identity_arguments===f.identity_arguments))catalog.helpers.push(f);
const fixtures=JSON.parse(fs.readFileSync(`${root}/live-contract-baselines.json`));
const report={status:'RUNNING',tables_unavailable:[],contracts:[],corpus_calls:[],required_outage_explicit:false};
fs.writeFileSync(`${root}/reader-isolation-report.json`,JSON.stringify(report));
let db,stage='initialize',failCorpus=false;
const env={ASSETS:{fetch:async request=>{
 const p=decodeURIComponent(new URL(request.url).pathname).replace(/^\//,'');
 const location=path.resolve('.artifacts/static-corpus',p);
 if(!location.startsWith(path.resolve('.artifacts/static-corpus')+path.sep)||!fs.existsSync(location))return new Response(null,{status:404});
 return new Response(fs.readFileSync(location));
}}};
async function insertRows(relation,rows){
 if(!rows.length)return;
 const columns=catalog.relations.find(t=>`${t.schema}.${t.name}`===relation).columns;
 const names=Object.keys(rows[0]).filter(k=>columns.some(c=>c.name===k&&!c.generated));
 await db.query(`INSERT INTO ${quoteRelation(relation)} (${names.map(quoteIdentifier)}) OVERRIDING SYSTEM VALUE SELECT ${names.map(k=>'x.'+quoteIdentifier(k))} FROM jsonb_populate_recordset(NULL::${quoteRelation(relation)},$1::jsonb)x`,[JSON.stringify(rows)]);
}
async function loadFixture(name){
 const key=['words','verses'].includes(name)?name+'_full':name;
 const dir=[`.artifacts/db-backup/tables/${key}`,`.artifacts/static-corpus/tables/${key}`].find(d=>fs.existsSync(d));
 if(!dir)throw Error('Missing retained-table fixture: '+name);
 let rows=[],count=0;
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl.gz')).sort()){
  for await(const line of createInterface({input:fs.createReadStream(path.join(dir,file)).pipe(createGunzip()),crlfDelay:Infinity}))if(line.trim()){
   rows.push(JSON.parse(line));if(rows.length===1000){count+=rows.length;await insertRows('public.'+name,rows);rows=[];}
  }
 }
 count+=rows.length;await insertRows('public.'+name,rows);
 fs.writeFileSync(`${root}/reader-isolation-progress.json`,JSON.stringify({stage:'retained fixture loaded',table:name,rows:count}));
}
async function sql(query,args=[]){
 for(let attempt=0;attempt<150;attempt++){
  try{return await db.query(query,args);}
  catch(error){
   if(!error.message.startsWith('CORPUS_FIXTURE_REQUIRED:'))throw error;
   const request=JSON.parse(error.message.slice('CORPUS_FIXTURE_REQUIRED:'.length));
   const response=failCorpus?new Response(null,{status:503}):await worker.fetch(new Request('https://corpus.test/v1/rpc/'+request.operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.params)}),env);
   if(!response.ok)throw Error(`Required corpus request failed: ${request.operation}, HTTP ${response.status}`);
   const body=await response.json();
   if(body.status!=='ok')throw Error(`Required corpus request invalid: ${request.operation}, ${body.status}`);
   await db.exec('RESET ROLE;');
   await db.query('INSERT INTO bible_internal.test_corpus_responses(operation,params,payload) VALUES($1,$2::jsonb,$3::jsonb) ON CONFLICT(operation,params) DO UPDATE SET payload=excluded.payload',[request.operation,JSON.stringify(request.params),JSON.stringify(body)]);
   report.corpus_calls.push({operation:request.operation,params_sha256:crypto.createHash('sha256').update(JSON.stringify(request.params)).digest('hex')});
   fs.writeFileSync(`${root}/reader-isolation-progress.json`,JSON.stringify({stage,corpus_requests:report.corpus_calls.length,operation:request.operation}));
   await db.exec('SET ROLE anon;');
  }
 }
 throw Error('Corpus request budget exceeded');
}
try{
 const inputs=crypto.createHash('sha256').update(JSON.stringify(catalog)).update(JSON.stringify(functions)).digest('hex');
 const cacheFile=`${root}/reader-fixture-cache.json`;
 const cached=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile)):null;
 const reuse=cached?.inputs===inputs&&fs.existsSync(cached.dataDir);
 const dataDir=reuse?cached.dataDir:path.resolve(root,'reader-fixture-'+crypto.randomUUID());
 db=await PGlite.create(dataDir,{extensions:{pg_trgm}});
 if(!reuse){
 await db.exec("CREATE EXTENSION pg_trgm; CREATE SCHEMA IF NOT EXISTS bible_internal; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS extensions; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; SET check_function_bodies=off; SET TIME ZONE 'UTC';");
 await db.exec("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
 stage='recovery schema';await db.exec(buildReclamationSchema(catalog).tables);
 stage='captured functions';for(const f of functions)await db.exec(f.definition.trim()+';');
 stage='retained fixtures';
 for(const name of ['books','source_releases','source_editions','reader_english_editions','words','verses','lemmas','lexemes','lexical_roots','lemma_root_links','lexical_senses','field_license_registry','canonical_entities','entity_relationships','lexical_formations','lemma_components','lexical_connections'])await loadFixture(name);
 fs.writeFileSync(cacheFile,JSON.stringify({inputs,dataDir}));
 }
 report.reused_retained_fixtures=Boolean(reuse);
 // The live guard protects production source; a reused fixture already contains migrated definitions.
 stage='migration';await db.exec(fs.readFileSync('supabase/migrations/20261111000133_phase0_cloudflare_active_readers.sql','utf8').replace(/-- BEGIN LIVE SOURCE GUARD[\s\S]*?-- END LIVE SOURCE GUARD/,''));
 stage='corpus test transport';
 await db.exec(`CREATE TABLE IF NOT EXISTS bible_internal.test_corpus_responses(operation text,params jsonb,payload jsonb,PRIMARY KEY(operation,params)); DELETE FROM bible_internal.test_corpus_responses;
 CREATE OR REPLACE FUNCTION bible_internal.call_corpus_rpc_v1(p_operation text,p_params jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 DECLARE v jsonb;BEGIN SELECT payload INTO v FROM bible_internal.test_corpus_responses WHERE operation=p_operation AND params=p_params;
 IF v IS NULL THEN RAISE EXCEPTION 'CORPUS_FIXTURE_REQUIRED:%',jsonb_build_object('operation',p_operation,'params',p_params);END IF;RETURN v;END $fn$;
 GRANT USAGE ON SCHEMA public,bible_internal,auth TO anon;
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,bible_internal,auth TO anon;`);
 for(const table of RECLAMATION_TABLES){
  assert.equal(Number((await db.query(`SELECT count(*) AS n FROM ${quoteRelation(table)}`)).rows[0].n),0);
  await db.exec(`REVOKE ALL ON TABLE ${quoteRelation(table)} FROM PUBLIC,anon,authenticated,service_role;`);
 }
 await db.exec('SET ROLE anon;');
 for(const table of RECLAMATION_TABLES){await assert.rejects(()=>db.query(`SELECT 1 FROM ${quoteRelation(table)} LIMIT 1`),e=>e.code==='42501');report.tables_unavailable.push(table);}
 stage='golden contract comparison';
 for(const fixture of fixtures){
  fs.writeFileSync(`${root}/reader-isolation-progress.json`,JSON.stringify({stage,contract:fixture.name,corpus_requests:report.corpus_calls.length}));
  const keys=Object.keys(fixture.args),args=Object.values(fixture.args);
  const result=await sql(`SELECT public.${fixture.name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) AS packet`,args);
  const actual=result.rows[0].packet;
  try{assert.deepEqual(actual,fixture.packet);}catch{
   fs.writeFileSync(`${root}/reader-mismatch-${fixture.name}.json`,JSON.stringify({expected:fixture.packet,actual},null,2));
   throw Error('Contract mismatch: '+fixture.name);
  }
  report.contracts.push({name:fixture.name,status:'PASS'});
 }
 if(process.argv.includes('--clients')){stage='website and MCP clients';const {verifyClients}=await import('./verify-phase0-clients.mjs');await verifyClients({db,sql,worker,env,report,functions});}
 stage='required corpus outage';
 await db.exec('RESET ROLE; DELETE FROM bible_internal.test_corpus_responses;');
 // A NULL upstream response must be a resource error, never successful empty research.
 await db.exec("CREATE OR REPLACE FUNCTION bible_internal.call_corpus_rpc_v1(p_operation text,p_params jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$; SET ROLE anon;");
 await assert.rejects(()=>db.query("SELECT public.research_passage_lens_v1(19,3,0,55)"),e=>e.code==='53300');
 report.required_outage_explicit=true;report.status=process.argv.includes('--clients')?'PASS_READERS_WEBSITE_MCP_ISOLATED':'PASS_FIVE_READERS_ISOLATED';
 console.log(JSON.stringify({status:report.status,denied_tables:report.tables_unavailable.length,contracts:report.contracts.length,corpus_requests:report.corpus_calls.length,required_outage_explicit:true}));
}catch(error){report.status='FAIL';report.stage=stage;report.code=error.code;report.message=error.message;console.log(JSON.stringify({status:'FAIL',stage,code:error.code,message:error.message}));process.exitCode=1;}
finally{fs.writeFileSync(`${root}/reader-isolation-report.json`,JSON.stringify(report,null,2));if(db)await db.close();}
