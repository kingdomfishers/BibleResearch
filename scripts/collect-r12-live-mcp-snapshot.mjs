#!/usr/bin/env node
// Snapshot ALL 239 benchmark queries from the LIVE BibleResearch Streamable HTTP MCP.
// Stores ordered top-25 results, epistemic labels, evidence IDs, witnesses, scores,
// verifiable errors, and optional evidence followup. NEVER equate alias hits to PASS.
import fs from "node:fs/promises";
import cp from "node:child_process";
import crypto from "node:crypto";

const B="research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json";
const O="research/r12/live_mcp_results_2026-11-18/current";
const URL=process.env.BIBLERESEARCH_MCP_URL||"https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp";
const CONCURRENCY=Math.max(1,Math.min(3,Number(process.env.MCP_CONCURRENCY||2)));
const BATCH=Math.max(5,Math.min(25,Number(process.env.MCP_BATCH||20)));
const ATTEMPTS=Math.max(1,Math.min(4,Number(process.env.MCP_ATTEMPTS||3)));
const EVIDENCE=process.env.MCP_EVIDENCE!=="0";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
let rpcid=1;
async function call(name,args){
 const id=rpcid++;
 const start=Date.now();
 const resp=await fetch(URL,{method:"POST",headers:{"content-type":"application/json","accept":"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}}),signal:AbortSignal.timeout(30000)});
 const raw=await resp.text();
 if(!resp.ok)throw Error("HTTP "+resp.status+" "+raw.slice(0,240));
 let message;
 if((resp.headers.get("content-type")||"").includes("event-stream")){
  for(const line of raw.split(/\r?\n/)){if(!line.startsWith("data: "))continue;try{const v=JSON.parse(line.slice(6));if(String(v.id)===String(id)){message=v;break;}}catch{}}
 }else message=JSON.parse(raw);
 if(!message)throw Error("No matching MCP JSON-RPC response");
 if(message.error)throw Error("MCP "+JSON.stringify(message.error).slice(0,280));
 const result=message.result||{};
 if(result.isError)throw Error("MCP tool error "+JSON.stringify(result.content).slice(0,300));
 const d=result.structuredContent?.status?result.structuredContent:JSON.parse((result.content||[]).find(v=>v.type==="text")?.text||"{}");
 return {data:d,ms:Date.now()-start};
}
async function retry(name,args){
 const errors=[];
 for(let attempt=1;attempt<=ATTEMPTS;attempt++){
  try{return {...await call(name,args),attempt,previous_errors:errors};}
  catch(e){errors.push(String(e).slice(0,450));if(attempt<ATTEMPTS)await sleep(900*attempt);}
 }
 return {data:null,attempt:ATTEMPTS,previous_errors:errors};
}
function rank(r,i){
 const m=r.r12_metadata||{};
 return {
  rank:i+1,evidence_id:r.evidence_id,title:r.title,summary:r.summary,
  predicate:r.predicate,epistemic_class:r.epistemic_class,evidence_tier:r.evidence_tier,
  source_node_id:r.source_node_id,target_node_id:r.target_node_id,
  passages:(r.passages||[]).slice(0,12).map(p=>({ref:p.ref,verse_id:p.verse_id,snippet:(p.snippet||"").slice(0,180)})),
  original_words:(r.original_words||[]).slice(0,8).map(w=>({strongs:w.strongs,gloss:w.gloss})),
  matched_terms:r.matched_terms,limitations:r.limitations,provenance:r.provenance,score_components:r.score_components,
  r12_metadata:Object.keys(m).length?{
   score_version:m.score_version,epistemic_status:m.epistemic_status,epistemic_layer:m.epistemic_layer,
   Q:m.Q,C:m.C,D:m.D,T:m.T,interest:m.interest,mmr_score:m.mmr_score,
   independent_group_count:m.independent_group_count,independent_evidence_groups:m.independent_evidence_groups,
   meaningful_hops:m.meaningful_hops,
   steps:(m.steps||[]).map(s=>({edge_id:s.edge_id,from_id:s.from_id,to_id:s.to_id,relation_type:s.relation_type,witness_refs:s.witness_refs,epistemic_layer:s.epistemic_layer})),
   external_bridge:m.external_bridge
  }:null
 };
}
function candidates(c,top){
 const k=c.expected.top_k??c.expected.disallowed_rank_at_or_above??25;
 const aliases=(c.expected.acceptable_target_terms||[]).map(norm);
 return top.filter(r=>r.rank<=k&&aliases.some(a=>a&&norm([r.title,r.summary,r.evidence_id,r.target_node_id,...(r.matched_terms||[]),...(r.passages||[]).map(p=>p.ref)].join(" ")).includes(a)))
   .slice(0,5).map(r=>({rank:r.rank,evidence_id:r.evidence_id,title:r.title}));
}
async function one(c){
 const began=Date.now();
 const row={case_id:c.id,category:c.category,difficulty:c.difficulty,polarity:c.polarity,query:c.mcp_call.arguments,expected_target:c.expected.relationship??null,forbidden_claim:c.expected.forbidden_claim??null,top_k:c.expected.top_k??c.expected.disallowed_rank_at_or_above,observed_at:new Date().toISOString(),tool:"discover_biblical_connections_v2",review_status:"UNREVIEWED"};
 const r=await retry("discover_biblical_connections_v2",c.mcp_call.arguments);
 row.attempts=r.attempt;row.previous_errors=r.previous_errors;row.elapsed_ms=Date.now()-began;
 if(!r.data){
  row.status="TOOL_ERROR";row.error=r.previous_errors.at(-1);row.top25=[];row.triage="NOT_EVALUABLE";
  return row;
 }
 const d=r.data;
 row.status=d.status;row.release=d.release_id;row.verification_release=d.verification_release;row.r12_discovery=d.r12_discovery;row.pagination=d.pagination;
 row.top25=(d.strongest_connections||[]).slice(0,25).map(rank);
 row.target_candidates=candidates(c,row.top25);
 row.triage=c.polarity==="negative"?(row.target_candidates.length?"POSSIBLE_OVERCLAIM_REVIEW":"NO_ALIAS_TRIGGER"):
  (row.target_candidates.length?"POSSIBLE_MATCH_REQUIRES_SOURCE_REVIEW":"NO_ALIAS_MATCH_AT_K");
 if(EVIDENCE&&row.target_candidates.length){
  const e=await retry("get_connection_evidence_v1",{evidence_id:row.target_candidates[0].evidence_id});
  if(e.data){
   const v=e.data.evidence||{};
   row.evidence_probe={status:e.data.status,evidence_id:row.target_candidates[0].evidence_id,title:v.title,summary:v.summary,epistemic_class:v.epistemic_class,passages:(v.passages||[]).map(p=>p.ref),limitations:v.limitations,provenance:v.provenance,r12_metadata:v.r12_metadata?.external_bridge?{external_bridge:v.r12_metadata.external_bridge}:undefined};
  }else row.evidence_probe={status:"TOOL_ERROR",errors:e.previous_errors};
 }
 row.elapsed_ms=Date.now()-began;
 return row;
}
async function group(cs){
 let pointer=0;const output=Array(cs.length);
 await Promise.all(Array.from({length:CONCURRENCY},async()=>{
  while(pointer<cs.length){
   const i=pointer++;
   output[i]=await one(cs[i]);
   console.error(cs[i].id+" "+output[i].status+" "+output[i].triage);
   await sleep(250);
  }
 }));
 return output;
}
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const git=(...a)=>cp.execFileSync("git",a,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
function push(){
 if(process.env.GITHUB_ACTIONS!=="true")return;
 git("add",O);
 try{git("commit","-m","test(r12): save actual live MCP ranked benchmark responses");}catch(e){if(!String(e).includes("nothing to commit"))throw e;}
 const branch=process.env.GITHUB_REF_NAME||"feat/r12-qa-fixes";
 for(let i=0;i<3;i++){try{git("push","origin","HEAD:"+branch);return;}catch(e){if(i===2)throw e;git("pull","--rebase","origin",branch);}}
}
const bytes=await fs.readFile(B);const bench=JSON.parse(bytes);
await fs.mkdir(O,{recursive:true});
const meta={schema:"r12-real-mcp-snapshot-v1",created_at:new Date().toISOString(),source:"LIVE BibleResearch MCP tools/call, NOT a corpus Worker shortcut",endpoint:URL,benchmark:B,benchmark_sha256:sha(bytes),expected:bench.cases.length,concurrency:CONCURRENCY,batch_size:BATCH,attempts:ATTEMPTS,evidence_probe_enabled:EVIDENCE,status:"RUNNING",completed:0,success:0,errors:0,possible_matches:0,batches:[],notice:"Every result is an observed top-K retrieval, not an independently verified PASS. Missing data after TOOL_ERROR is transport failure, not a negative discovery result."};
for(let offset=0;offset<bench.cases.length;offset+=BATCH){
 const cs=bench.cases.slice(offset,offset+BATCH);
 const result=await group(cs);
 const name="batch_"+String(offset+1).padStart(3,"0")+"_"+String(offset+cs.length).padStart(3,"0")+".json";
 await fs.writeFile(O+"/"+name,JSON.stringify({schema:"r12-ranked-mcp-results-v1",benchmark_sha256:meta.benchmark_sha256,from:offset+1,to:offset+cs.length,results:result},null,2)+"\n");
 meta.completed+=result.length;meta.success+=result.filter(x=>x.status==="ok").length;
 meta.errors+=result.filter(x=>x.status==="TOOL_ERROR").length;
 meta.possible_matches+=result.filter(x=>x.target_candidates?.length).length;
 meta.batches.push(name);
 await fs.writeFile(O+"/manifest.json",JSON.stringify(meta,null,2)+"\n");
 push();console.error("CHECKPOINT "+meta.completed+"/"+meta.expected+" errors="+meta.errors);
}
meta.status="COMPLETE";meta.finished_at=new Date().toISOString();
await fs.writeFile(O+"/manifest.json",JSON.stringify(meta,null,2)+"\n");push();
console.log(JSON.stringify({completed:meta.completed,success:meta.success,errors:meta.errors,possible_matches:meta.possible_matches,manifest:O+"/manifest.json"}));
