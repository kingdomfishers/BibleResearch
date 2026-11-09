// REFERENCE ONLY: Compiled middleware extracted from live Cloudflare Worker.
// Merge the protections into LOCAL scripts/corpus-worker.mjs.
// Do not paste this compiled bundle verbatim or overwrite local source.
// Version-preview URLs must remain disabled.

const __restrictedKeys = new Set(['semantic_frame','frame','greekstrong','sdbh','lexdomain','coredomain','contextualdomain','domain','ln']);
const __b7Expected = [
 {label:'psalm3_heading',sourceId:'19AxB',book:19,chapter:3,verse:0,expectedVerseId:13959,expectedWordId:88044},
 {label:'genesis31_55',sourceId:'01SDx',book:1,chapter:31,verse:55,expectedVerseId:929,expectedWordId:138884}
];
async function __b7LiveCheck(request,env,ctx){
 const results=await Promise.all(__b7Expected.map(async t=>{
   try {
     const url=new URL('/v1/rpc/lookup_hebrew_verse_evidence_v1',request.url);
     const query={p_book:t.book,p_chapter:t.chapter,p_verse:t.verse};
     const response=await __originalBibleResearchWorker.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(query)}),env,ctx);
     if(response.status!==200)return {case:t.label,status:'FAIL',http_status:response.status};
     const payload=await response.json();
     const token=(payload.morphhb_tokens||[]).find(x=>x.morphhb_id===t.sourceId);
     const pass=payload.found===true && Number(payload.verse?.id)===t.expectedVerseId && Number(token?.step_word_id)===t.expectedWordId;
     return {case:t.label,status:pass?'PASS':'FAIL',expected_verse_id:t.expectedVerseId,expected_word_id:t.expectedWordId,observed_word_id:token?.step_word_id??null};
   }catch(e){return {case:t.label,status:'FAIL',error:'canary_request_failed'};}
 }));
 const ok=results.every(x=>x.status==='PASS');
 return new Response(JSON.stringify({
   status:ok?'PASS_CANARIES':'FAIL',
   complete_corpus_verified:false,
   test_scope:'two known B7 reference/word alignment regressions only',
   release_approved:false,
   checks:results
 }),{status:ok?200:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Robots-Tag':'noindex','Access-Control-Allow-Origin':'*'}});
}
const __originalBibleResearchWorker = corpus_worker_default;
const __restrictedAssetPrefixes = ['/tables/','/v1/chapters/','/v1/lexical/','/v1/lxx/','/v1/syntax/','/v1/catalog/'];
function __stripRestrictedFields(value, depth=0){
  if(depth>70) throw Error('Corpus response exceeds safe recursion depth');
  if(Array.isArray(value)) return value.filter(x=> !(x && typeof x==='object' && __restrictedKeys.has(x.field_name))).map(x=>__stripRestrictedFields(x,depth+1));
  if(value!==null && typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(__restrictedKeys.has(k))continue;
      out[k]=__stripRestrictedFields(v,depth+1);
    }
    return out;
  }
  return value;
}
export default {
 async fetch(request,env,ctx){
   const path=new URL(request.url).pathname;
   if(path==='/__integrity/b7') return __b7LiveCheck(request,env,ctx);
   if(__restrictedAssetPrefixes.some(p=>path.startsWith(p) && (path !== '/v1/syntax/unmapped'))){
     return new Response(JSON.stringify({error:'raw_corpus_asset_access_disabled',message:'Use the public versioned read-only RPC instead.'}),{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-BibleResearch-Corpus-Security':'semantic-frame-redaction-v1'}});
   }
   const res=await __originalBibleResearchWorker.fetch(request,env,ctx);
   if(!path.startsWith('/v1/rpc/') && path !== '/v1/syntax/unmapped')return res;
   const ct=res.headers.get('Content-Type')||'';
   if(!ct.includes('application/json'))return new Response(JSON.stringify({error:'unexpected_api_content_type'}),{status:502,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
   try{
     const data=await res.json();
     const headers=new Headers(res.headers);
     headers.delete('Content-Length');
     headers.set('Cache-Control','no-store');
     headers.set('X-BibleResearch-Corpus-Security','semantic-frame-redaction-v1');
     return new Response(JSON.stringify(__stripRestrictedFields(data)),{status:res.status,statusText:res.statusText,headers});
   }catch(e){
     return new Response(JSON.stringify({error:'corpus_response_redaction_failed'}),{status:502,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
   }
 }
};
 