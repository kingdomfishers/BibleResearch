import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import worker from './corpus-worker.mjs';
const env={ASSETS:{fetch:async request=>{const p=path.resolve('.artifacts/static-corpus',new URL(request.url).pathname.slice(1));return fs.existsSync(p)?new Response(fs.readFileSync(p)):new Response(null,{status:404});}}};
const deployed=process.argv.includes('--deployed');
const cases=[['get_passage_lens_source_v1',{p_book:19,p_chapter:3,p_verse:0}],['get_passage_lens_source_v1',{p_book:43,p_chapter:1,p_verse:1}],['get_static_corpus_metadata_v1',{}]];
let passed=0;
for(const[op,args]of cases){const request=new Request((deployed?'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev':'https://corpus.test')+'/v1/rpc/'+op,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const response=deployed?await fetch(request):await worker.fetch(request,env);const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,'ok');if(op==='get_static_corpus_metadata_v1'){assert.equal(body.macula_syntax_import_files.length,983);assert.ok(Object.keys(body.decode_grammar_catalog).length>=1000);}else{assert.ok((body.hebrew.length+body.greek.length)>0);assert.ok(!JSON.stringify(body).includes('"gated_fields"'));}passed++;}
console.log(JSON.stringify({status:'PASS',source_rpc_cases:passed}));
