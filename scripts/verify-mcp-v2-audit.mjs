// Explicit bounded live acceptance: read tools plus private chain sessions; never writes notes.
// Run: node scripts/verify-mcp-v2-audit.mjs --live
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.ok(process.argv.includes('--live'), 'Use --live to authorize bounded live read/session probes.');
const base=process.env.MCP_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp';
const archive=JSON.parse(fs.readFileSync(new URL('../research/r12/mcp_v2_live_audit_2026-11-20/RAW_CASES.json',import.meta.url)));
let id=0;
const report={date:new Date().toISOString(),endpoint:base,cases:[],checks:[]};
async function rpc(method,params) {
  const requestId=++id;
  const response=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,200);
  const raw=await response.text();
  const packet=response.headers.get('content-type')?.includes('event-stream')
    ? raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).find(p=>p.id===requestId)
    : JSON.parse(raw);
  assert.ok(!packet.error,JSON.stringify(packet.error));
  return packet.result;
}
async function call(name,args,allowError=false) {
  const result=await rpc('tools/call',{name,arguments:args});
  if(!allowError)assert.ok(!result.isError,JSON.stringify(result));
  let data=result.structuredContent;
  if(!data){try{data=JSON.parse(result.content[0].text);}catch{data={error:result.content[0].text};}}
  return {error:!!result.isError,data};
}
const names=(await rpc('tools/list',{})).tools.map(t=>t.name).sort();
assert.deepEqual(names,['get_Passage','get_Word','get_Connection','follow_connectionchain','research','write_Note','get_prompt'].sort());
const outputs=new Map();
for(const c of archive.cases){
  const started=Date.now(); const {data}=await call(c.tool,c.input);
  assert.ok(data.status==='ok'||c.tool==='get_prompt',c.id+': '+JSON.stringify(data));
  outputs.set(c.id,data);
  if (c.id==='C01'||c.id==='C02') assert.ok(data.connections.length>0 && data.items.every(i=>i.kind!=='passage'||i.verses_preview.length>0), c.id+': missing sources must not pass acceptance');
  const before=c.output==null?null:Buffer.byteLength(JSON.stringify(c.output));
  const entry={id:c.id,bytes_before:before,bytes_after:Buffer.byteLength(JSON.stringify(data)),ms:Date.now()-started};
  report.cases.push(entry);console.log(entry);
}
const passage=outputs.get('P05'), words=passage.verses[0].words;
assert.equal(words.length,24);
for(const [strongs,position,wordId,tr,code] of [['H4501',9,91302,'me.no.Rat','HNcfsc'],['H2091',10,59034,'za.Hav','HNcmsa'],['H5216',16,99243,'ne.ro.Tei.ha','HNcfpc/Sp3fs']]){
 const w=words.find(w=>w.strongs===strongs);assert.equal(w.pos,position);assert.equal(w.word_id,wordId);assert.equal(w.tr,tr);assert.equal(w.code,code);
}
const compared=outputs.get('R02').results[0].passages[0].verses[0].tokens;
for(const w of words){const t=compared.find(t=>t.position===w.pos);assert.equal(t.word_id,w.word_id);assert.equal(t.surface,w.form);if(w.tr)assert.equal(t.transliteration,w.tr);if(w.code)assert.equal(t.grammar_code,w.code);}
assert.equal(outputs.get('P04').verses.length,26);
assert.equal(outputs.get('P04').verses.at(-1).ref,'1 Corinthians 13:4');
assert.ok(outputs.get('P04').verses.every(v=>v.english&&v.original&&v.words.length));
assert.ok(outputs.get('P03').verses.length===14);
for(const p of ['Ps 45:0','Hosea 14:5','Ezekiel 1:10','Ezekiel 10:20']){
 const r=(await call('get_Passage',{passage:p,depth:0})).data;assert.equal(r.verses.length,1);assert.ok(r.verses[0].words.length);
}
const zero=(await call('get_Passage',{passage:'Genesis 6:14',depth:0,word_depth:0,etymology:0,realworld:0})).data;
assert.ok(!zero.passage_connections);assert.ok(!zero.verses[0].verse_connections);
assert.ok(Object.values(zero.lexicon).every(w=>!w.connections&&!w.etymology&&!w.realworld));
const wc=(await call('get_Connection',{items:['H3722','H3724'],connections:3})).data;
assert.equal(wc.items.filter(i=>i.kind==='word').length,2);
for(const item of wc.items) if(item.kind==='word'){
 assert.ok(Array.isArray(item.grammar_forms));assert.ok(item.occurrences);assert.ok((item.word.connections?.length??0)<=3);
}
const ruach=outputs.get('W01');assert.equal(ruach.word.gematria.value,214);assert.ok(ruach.word.senses.length>1);
assert.ok(ruach.occurrences.clusters.every(c=>c.count>0));
assert.equal(outputs.get('W02').word.gematria.value,300);
for(const r of await Promise.all(Array.from({length:3},()=>call('research',archive.cases.find(c=>c.id==='R01').input))))assert.equal(r.data.status,'ok');
const start=(await call('follow_connectionchain',{next:'Zechariah 4',limit:3})).data;
const chain=start.chain; assert.ok(chain);
const followed=(await call('follow_connectionchain',{chain,next:'Revelation 11:4',limit:3})).data;
assert.ok(followed.added_step.edge_id);assert.ok(followed.added_step.refs.includes('Revelation 11:4'));
assert.notEqual(followed.added_step.relation,'exploratory_step');
const inspect=(await call('follow_connectionchain',{chain,action:'inspect',limit:2})).data;assert.equal(inspect.current_node,'Revelation 11:4');
await call('follow_connectionchain',{chain,action:'branch',from_node:'Zechariah 4',limit:2});
await call('follow_connectionchain',{chain,action:'revisit',from_node:'Revelation 11:4',limit:2});
assert.ok((await call('follow_connectionchain',{chain:chain.slice(0,-4)+'aaaa',action:'inspect'},true)).error);
assert.ok((await call('write_Note',{action:'save_dlm',dlm:{invalid:true}},true)).error);
const corpus='https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const integrity=await fetch(corpus+'/__integrity/b7');assert.equal(integrity.status,200);report.integrity=await integrity.json();
assert.equal((await fetch(corpus+'/v1/catalog/metadata.json.gz')).status,403);
report.health=await (await fetch(base+'/health')).json();
report.checks=['seven-tool interface','Zech canonical word/surface/transliteration/grammar','passage/research parity','26 full Corinthians verses','heading and shifted verses','Ezekiel source identity','zero depth controls','word comparison full fields','Ruach senses/counts/gematria','three concurrent combined research calls','persisted evidenced chain with branch/revisit/tamper refusal','invalid note payload refusal without note writes','B7 and restricted asset protection'];
fs.mkdirSync('.artifacts-r12/mcp-fixes',{recursive:true});
fs.writeFileSync('.artifacts-r12/mcp-fixes/live-acceptance.json',JSON.stringify(report,null,2));
console.log('PASS bounded live audit:',report.checks.join('; '));
