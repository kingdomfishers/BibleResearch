#!/usr/bin/env node
/**
 * Deterministic offline review matrix for R12 LIVE MCP snapshots.
 * Requires no network and performs NO biblical interpretation automatically.
 * Usage: node scripts/review-r12-live-mcp-snapshot.mjs
 *
 * Output: .review-matrix.json + .review-matrix.csv in the current snapshot dir.
 * The presence of an alias match is NEVER scored as a semantic PASS.
 */
import fs from "node:fs/promises";
import path from "node:path";

const benchmarkPath="research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json";
const directory=process.argv[2]||"research/r12/live_mcp_results_2026-11-18/current";
const [reference,manifest]=await Promise.all([
 fs.readFile(benchmarkPath,"utf8").then(JSON.parse),
 fs.readFile(path.join(directory,"manifest.json"),"utf8").then(JSON.parse)
]);
const observations=new Map();
const duplicates=[];
for(const file of manifest.batches||[]){
 const shard=JSON.parse(await fs.readFile(path.join(directory,file),"utf8"));
 for(const item of shard.results||[]){
  if(observations.has(item.case_id))duplicates.push(item.case_id);
  observations.set(item.case_id,item);
 }
}
const normalized=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
function literalAlias(value,haystack){
 const v=normalized(value);
 if(!v)return false;
 const h=normalized(haystack);
 // Unicode word boundaries: "dam" must NOT match inside "adamah".
 const esc=[...v].map(ch=>".*+?^$()[]{}|\\".includes(ch)?"\\"+ch:ch).join("");
 return new RegExp("(^|[^\\p{L}\\p{N}])"+esc+"(?=$|[^\\p{L}\\p{N}])","u").test(h);
}
function strictAliasMatches(c,ranked){
 const k=c.expected.top_k??c.expected.disallowed_rank_at_or_above??25;
 const al=c.expected.acceptable_target_terms||[];
 return ranked.filter(r=>r.rank<=k).flatMap(r=>{
  const fields=[
   ["title",r.title],["summary",r.summary],["target",r.target_node_id],
   ["evidence_id",r.evidence_id],
   ["matched_terms",(r.matched_terms||[]).join(" | ")],
   ["passage_refs",(r.passages||[]).map(p=>p.ref).join(" | ")]
  ];
  const hits=al.flatMap(alias=>fields.filter(([where,text])=>literalAlias(alias,text)).map(([where])=>({alias,where})));
  return hits.length?[{rank:r.rank,evidence_id:r.evidence_id,title:r.title,hits}]:[];
 });
}

const rows=reference.cases.map(c=>{
 const x=observations.get(c.id);
 const matches=x?strictAliasMatches(c,x.top25||[]):[];
 const first=matches[0];
 const ranked=x?.top25||[];
 const rank=first?.rank??null;
 const chosen=first?ranked.find(r=>r.evidence_id===first.evidence_id):null;
 const status=!x?"NOT_COLLECTED":x.status==="TOOL_ERROR"?"TRANSPORT_ERROR":x.status==="no_match"?"NO_QUERY_MATCH":x.status==="ok"?"RESPONSE_RECEIVED":"OTHER_SERVER_STATUS";
 return {
  case_id:c.id,polarity:c.polarity,category:c.category,difficulty:c.difficulty,
  query:c.mcp_call.arguments.query,
  expected_target:c.expected.relationship||"",
  forbidden_claim:c.expected.forbidden_claim||"",
  top_k:c.expected.top_k??c.expected.disallowed_rank_at_or_above,
  response_status:status,mcp_status:x?.status||"",
  alias_candidate_count:matches.length,
  first_alias_rank:rank,
  first_alias_evidence_id:chosen?.evidence_id||"",
  first_alias_title:chosen?.title||"",
  first_alias_hit_reasons:JSON.stringify(first?.hits||[]),
  first_alias_epistemic_class:chosen?.epistemic_class||"",
  first_alias_witness_refs:(chosen?.passages||[]).map(p=>p.ref).join("; "),
  first_alias_r12_interest:chosen?.r12_metadata?.interest??"",
  first_alias_final_score:chosen?.score_components?.final_score??"",
  rank_1_evidence_id:ranked[0]?.evidence_id||"",
  rank_1_title:ranked[0]?.title||"",
  server_release:x?.r12_discovery?.release_id||x?.release||"",
  attempts:x?.attempts??0,
  response_ms:x?.elapsed_ms??"",
  evidence_probe_status:x?.evidence_probe?.status||"",
  evidence_probe_source_ids:(x?.evidence_probe?.provenance?.source_record_ids||[]).join("; "),
  review_verdict:"UNREVIEWED",
  first_genuine_rank:"",
  evidence_validity:"",
  epistemic_accuracy:"",
  endpoint_coherence:"",
  external_source_validation:"",
  comments:""
 };
});
const counts={};
for(const row of rows){
 const k=row.response_status;
 counts[k]=(counts[k]||0)+1;
}
const byCategory={};
for(const row of rows){
 const k=row.category;
 if(!byCategory[k])byCategory[k]={total:0,responses:0,alias_candidates:0,errors:0};
 byCategory[k].total++;
 if(row.response_status==="RESPONSE_RECEIVED")byCategory[k].responses++;
 if(row.alias_candidate_count)byCategory[k].alias_candidates++;
 if(row.response_status==="TRANSPORT_ERROR")byCategory[k].errors++;
}
const report={
 schema:"r12-independent-review-matrix-v1",
 generated_at:new Date().toISOString(),
 collector_manifest:manifest,
 total_benchmark_cases:reference.cases.length,
 collected_case_count:observations.size,
 duplicate_ids:duplicates,
 status_counts:counts,
 by_category:byCategory,
 note:"Literal aliases use Unicode token boundaries to avoid substring false positives (e.g. dam inside adamah). No PASS or FAIL is inferred from text aliases alone. Review each case's evidence, provenance, semantic composition and epistemic scope before assigning a verdict.",
 manual_verdict_values:["PASS_AT_K","PARTIAL","FAIL_AT_K","PASS_NEG","FAIL_NEG","NOT_PRECOMPUTED","NO_QUERY_MATCH","TRANSPORT_ERROR","INCONCLUSIVE"],
 rows
};
const csvCells=Object.keys(rows[0]);
function csv(v){
 let s=String(v??"");
 // Defend against spreadsheet formula injection when importing the CSV.
 if(/^[=+@]/.test(s))s="'"+s;
 return '"'+s.replaceAll('"','""')+'"';
}
await fs.writeFile(path.join(directory,"review-matrix.json"),JSON.stringify(report,null,2)+"\n");
await fs.writeFile(path.join(directory,"review-matrix.csv"),[
 csvCells.map(csv).join(","),
 ...rows.map(r=>csvCells.map(k=>csv(r[k])).join(","))
].join("\n")+"\n");
console.log(JSON.stringify({
 total:rows.length,observed:observations.size,counts,duplicate_ids:duplicates,
 review_matrix_json:path.join(directory,"review-matrix.json"),
 review_matrix_csv:path.join(directory,"review-matrix.csv")
},null,2));
