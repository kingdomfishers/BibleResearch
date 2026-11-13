// Full manifest digest comparison; this endpoint returns hashes, never source records.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from './corpus-worker.mjs';
const local=process.argv.includes('--local');
const base=process.env.VITE_CORPUS_BASE_URL||'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const manifestBytes=fs.readFileSync('.artifacts/static-corpus/manifest.json');
const manifest=JSON.parse(manifestBytes);
const expected=new Map([...Object.values(manifest.tables).flatMap(t=>t.shards||[]),...Object.values(manifest.v1_retrieval_shards)].map(e=>[e.path,e]));
expected.set('/manifest.json',{sha256_compressed:crypto.createHash('sha256').update(manifestBytes).digest('hex'),compressed_bytes:manifestBytes.length});
const env={ASSETS:{fetch:async request=>{const file=path.resolve('.artifacts/static-corpus',new URL(request.url).pathname.slice(1));return fs.existsSync(file)?new Response(fs.readFileSync(file)):new Response(null,{status:404});}}};
const report={status:'RUNNING',mode:local?'local':'deployed',verified:0,total:expected.size,mismatches:[]};
const seen=new Set();
async function request(url){const req=new Request(url);return local?worker.fetch(req,env):fetch(req,{signal:AbortSignal.timeout(30000)});}
try{
 assert.equal(expected.size,manifest.cloudflare_limits_check.total_asset_files);
 const offsets=Array.from({length:Math.ceil(expected.size/8)},(_,i)=>i*8);
 let next=0;
 await Promise.all(Array.from({length:local?1:3},async()=>{
  while(next<offsets.length){
   const offset=offsets[next++];
   const res=await request(`${base}/__integrity/chunks?offset=${offset}&limit=8`);
   if(!res.ok)throw Error(`Integrity endpoint HTTP ${res.status} at offset ${offset}`);
   const body=await res.json();
   assert.equal(body.status,'ok');assert.equal(body.total_assets,expected.size);assert.equal(body.offset,offset);
   assert.equal(body.checks.length,Math.min(8,expected.size-offset));
   for(const actual of body.checks){
    assert.ok(!seen.has(actual.path),'Repeated corpus verification path');seen.add(actual.path);
    const e=expected.get(actual.path);
    if(!e||e.sha256_compressed!==actual.sha256_compressed||e.compressed_bytes!==actual.compressed_bytes)report.mismatches.push({path:actual.path,expected_sha256:e?.sha256_compressed,actual_sha256:actual.sha256_compressed,status:actual.status});
    else report.verified++;
   }
  }
 }));
 assert.equal(report.mismatches.length,0,'Corpus digest mismatches');assert.equal(report.verified,expected.size);
 const denied=await request(base+'/tables/books/part-0000.jsonl.gz?raw=1');assert.equal(denied.status,403);
 report.raw_backups_public=false;report.status='PASS';
}catch(error){report.status='FAIL';report.message=error.message;process.exitCode=1;}
fs.writeFileSync(`.artifacts/phase0/${local?'local':'deployed'}-chunk-integrity.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,mode:report.mode,verified:report.verified,total:report.total,mismatches:report.mismatches.length,message:report.message}));
