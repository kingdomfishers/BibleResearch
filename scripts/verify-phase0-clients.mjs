// Actual website gateways and MCP transport against the isolated SQL/Cloudflare bridge.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import esbuild from 'esbuild';
import {buildReclamationSchema,quoteRelation,quoteIdentifier} from './build-reclamation-backup-schema.mjs';
import {RECLAMATION_TABLES} from './phase0-storage-scope.mjs';

export async function verifyClients({db,sql,worker,env,report,functions}){
 // Add only retained-feature fixture schemas/data; never grant or populate a candidate table.
 await db.exec('RESET ROLE;');
 const catalog=JSON.parse(fs.readFileSync('supabase/recovery/reclamation-catalog.json'));
 for(const t of JSON.parse(fs.readFileSync('.artifacts/phase0/client-extra-relations.json')))if(!catalog.relations.some(x=>x.schema===t.schema&&x.name===t.name))catalog.relations.push(t);
 catalog.relations.push({schema:'auth',name:'users',columns:[{name:'id',type:'uuid',not_null:true}],constraints:[{name:'users_pkey',type:'p',definition:'PRIMARY KEY (id)'}],indexes:[],policies:[],grants:[]});
 const ddl=buildReclamationSchema(catalog).tables.replaceAll('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ').replaceAll('CREATE SEQUENCE ','CREATE SEQUENCE IF NOT EXISTS ');
 await db.exec(ddl);
 for(const file of ['note-config-fixtures.json','retained-client-fixtures.json'])for(const t of JSON.parse(fs.readFileSync('.artifacts/phase0/'+file))){
  if(!t.records.length)continue;
  const descriptor=catalog.relations.find(r=>r.schema==='public'&&r.name===t.relation)||JSON.parse(fs.readFileSync('.artifacts/phase0/test-extra-relations.json')).find(r=>r.schema==='public'&&r.name===t.relation);
  const names=Object.keys(t.records[0]).filter(k=>descriptor.columns.some(c=>c.name===k&&!c.generated));
  await db.query(`INSERT INTO public.${t.relation} (${names.map(quoteIdentifier)}) OVERRIDING SYSTEM VALUE SELECT ${names.map(k=>'x.'+quoteIdentifier(k))} FROM jsonb_populate_recordset(NULL::public.${t.relation},$1::jsonb)x ON CONFLICT DO NOTHING`,[JSON.stringify(t.records)]);
 }
 for(const t of catalog.relations){const n=`${t.schema}.${t.name}`;if(t.schema==='public'&&!RECLAMATION_TABLES.includes(n))await db.exec(`GRANT SELECT ON ${quoteRelation(n)} TO anon;`);}
 await db.exec('SET ROLE anon;');
 const out=path.resolve('.artifacts/phase0/client-test');fs.mkdirSync(out,{recursive:true});
 await esbuild.build({entryPoints:{site:path.resolve('src/api/rpc.ts'),notes:path.resolve('src/api/notes-rpc.ts'),mcp:path.resolve('supabase/functions/bible-mcp/index.ts')},outdir:out,bundle:true,format:'esm',platform:'node',nodePaths:[path.resolve('.artifacts/mcp-tools/node_modules')],define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'https://phase0-db.test',VITE_SUPABASE_ANON_KEY:'sb_publishable_test',VITE_CORPUS_BASE_URL:'https://corpus.test'}),'import.meta.main':'false'},banner:{js:'import {createRequire as phase0CreateRequire} from "node:module"; const require=phase0CreateRequire(import.meta.url);'},logLevel:'silent'});
 const originalFetch=globalThis.fetch;
 const outcomes=[];
 async function fetcher(input,init){
  const request=new Request(input,init),url=new URL(request.url);
  if(url.hostname==='corpus.test'||url.hostname==='bibleresearch-corpus.kingdomfishers-custom.workers.dev')return worker.fetch(request,env);
  if(url.hostname!=='phase0-db.test')throw Error('Unexpected network access in isolated test: '+url.hostname);
  try{
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const name=url.pathname.split('/').pop(),args=await request.json(),keys=Object.keys(args);
    if(!/^[a-z0-9_]+$/.test(name)||keys.some(k=>!/^[a-z0-9_]+$/.test(k)))throw Error('Invalid fixture RPC');
    const f=functions.find(f=>f.schema==='public'&&f.name===name);if(!f)throw Error('Unknown public SQL fixture contract: '+name);
    const many=/RETURNS (TABLE|SETOF)/i.test(f.definition);
    const call=`public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`;
    const result=await sql(many?`SELECT to_jsonb(r) AS value FROM ${call} r`:`SELECT ${call} AS value`,Object.values(args));
    return Response.json(many?result.rows.map(r=>r.value):result.rows[0]?.value??null);
   }
   const table=url.pathname.split('/').pop();
   if(!['words','verses','books'].includes(table))throw Error('Unexpected table read: '+table);
   const id=url.searchParams.get('id');
   const result=await sql(`SELECT to_jsonb(r) AS value FROM public.${table} r${id?' WHERE id=$1':''} ORDER BY id LIMIT 1000`,id?[Number(id.replace('eq.',''))]:[]);
   return Response.json(request.headers.get('accept')?.includes('object+json')?(result.rows[0]?.value??null):result.rows.map(r=>r.value));
  }catch(error){report.last_database_error={code:error.code,message:error.message};return Response.json({message:error.message,code:error.code??'fixture_error'},{status:500});}
 }
 globalThis.fetch=fetcher;
 try{
  const {BibleRPC}=await import(pathToFileURL(path.join(out,'site.js')).href);
  const cases=[
   ['reader',()=>BibleRPC.getReaderPassage({book:1,chapter:1,verse:1})],
   ['hebrew_heading',()=>BibleRPC.lookupHebrewVerseEvidence(19,3,0)],
   ['greek',()=>BibleRPC.lookupGreekVerseEvidence(43,1,1)],
   ['syntax',()=>BibleRPC.lookupSyntaxTree(1,'macula-hebrew-wlc')],
   ['septuagint',()=>BibleRPC.lookupSeptuagintPassage(1,1,1)],
   ['lexical',()=>BibleRPC.lookupLexicalSemantics('H1254','auto')],
   ['formation',()=>BibleRPC.lookupWordFormation('H7501')],
   ['word_inspector',()=>BibleRPC.getReaderWord(129386)],
   ['overview',()=>BibleRPC.getReaderOverview({book:1,chapter:1,verse:1})],
   ['geography',()=>BibleRPC.getVerseGeography({book:1,chapter:2,verse:14})],
   ['chronology',()=>BibleRPC.getVerseChronology({book:1,chapter:1,verse:1})],
  ];
  const retainedGoldens=JSON.parse(fs.readFileSync('.artifacts/phase0/retained-client-goldens.json'));
  for(const[name,call]of cases){const r=await call();assert.equal(r.source,'live','Website '+name+': '+r.error);assert.ok(r.data,'Website '+name+' returned no data');const golden=retainedGoldens.find(g=>g.name===name);if(golden)assert.deepEqual(r.data,golden.packet,'Retained '+name+' contract changed');outcomes.push({client:'website',operation:name,status:'PASS'});}
  const {NotesRPC}=await import(pathToFileURL(path.join(out,'notes.js')).href);
  const saved=await NotesRPC.save({title:'Phase 0 isolated accountless note',body_md:'בְּרֵאשִׁית — isolated recovery contract',note_kind:'observation',anchors:[{client_key:'verse',kind:'verse',verse_id:1,label:'Genesis 1:1'}],connections:[],blocks:[],source_context:{test_run:'phase0-isolation'}});
  assert.equal(saved.ok,true,'Accountless note write failed: '+JSON.stringify(saved.error));
  const noteId=saved.note_id??saved.id??saved.note?.id;assert.ok(noteId);
  const notes=await NotesRPC.getForPassage({book:1,chapter:1,verse:1});assert.equal(notes.source,'live');assert.ok(JSON.stringify(notes.data).includes(noteId));
  outcomes.push({client:'website',operation:'accountless_note_write_and_retrieval',status:'PASS'});
  const removed=await NotesRPC.remove(noteId,saved.version??saved.note?.version??1);assert.equal(removed.ok,true);
  const {createApp}=await import(pathToFileURL(path.join(out,'mcp.js')).href);
  const app=createApp({url:'https://phase0-db.test',publicKey:'sb_publishable_test',corpusUrl:'https://corpus.test'},fetcher);
  let id=0;
  async function rpc(method,params){const n=++id;const response=await app(new Request('https://mcp.test/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:n,method,params})}));const text=await response.text();const body=response.headers.get('content-type')?.includes('text/event-stream')?text.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).find(p=>p.id===n):JSON.parse(text);return body;}
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'phase0-isolation',version:'1'}});
  for(const[name,args]of [['research_word_lens',{query:'H1254A',max_candidates:3}],['trace_biblical_bridge',{left:'H120',right:'H1818',max_witnesses:4,nearby_verse_window:2}],['research_passage_lens',{book:19,chapter:3,verse:0}],['research_macula_syntax',{book:49,chapter:1,verse:3}],['get_dlm_research',{book:1,chapter:9,verse:6}]]){
   const r=await rpc('tools/call',{name,arguments:args});assert.ok(!r.error&&!r.result?.isError,'MCP '+name+': '+JSON.stringify(r.error??r.result?.content));outcomes.push({client:'mcp',operation:name,status:'PASS'});
  }
  report.client_contracts=outcomes;
 }finally{globalThis.fetch=originalFetch;report.client_contracts=outcomes;}
}
