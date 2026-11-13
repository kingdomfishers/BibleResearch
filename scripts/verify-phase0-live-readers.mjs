import fs from 'node:fs';
import assert from 'node:assert/strict';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const fixtures=JSON.parse(fs.readFileSync('.artifacts/phase0/live-contract-baselines.json'));
const results=[];
for(const f of fixtures){
 const start=Date.now();
 try{
  const r=await fetch(env.VITE_SUPABASE_URL+'/rest/v1/rpc/'+f.name,{method:'POST',headers:{apikey:env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(f.args),signal:AbortSignal.timeout(30000)});
  const actual=await r.json();
  if(!r.ok)throw Error(`HTTP ${r.status}: ${actual.code??''} ${actual.message??''}`);
  try{assert.deepEqual(actual,f.packet);}catch{fs.writeFileSync(`.artifacts/phase0/live-reader-mismatch-${f.name}.json`,JSON.stringify({expected:f.packet,actual},null,2));throw Error('Captured contract mismatch');}
  results.push({name:f.name,status:'PASS',elapsed_ms:Date.now()-start});
 }catch(error){results.push({name:f.name,status:'FAIL',message:error.message,elapsed_ms:Date.now()-start});}
}
fs.writeFileSync('.artifacts/phase0/live-reader-verification.json',JSON.stringify({results},null,2));
console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,total:results.length,failures:results.filter(r=>r.status!=='PASS')}));
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
