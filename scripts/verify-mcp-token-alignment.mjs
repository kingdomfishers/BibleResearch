// Offline source-identity regressions; no service calls or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeTokenList} from './corpus-relationships-rpc.mjs';
import {verifyWordRowAlignment} from '../supabase/functions/bible-mcp/word-model.ts';
const {fixtures}=JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-token-alignment.json',import.meta.url)));
let checked=0,partial=0;
for(const fixture of fixtures){
 const tokens=normalizeTokenList(fixture.lite,fixture.fast);
 assert.equal(tokens.length,fixture.lite.t.length,fixture.ref);
 const byId=new Map(fixture.words.map(w=>[w.id,w]));
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i],row=fixture.lite.t[i];
  assert.equal(token.position,row[0]);assert.equal(token.word_id,row[1]);
  const meta=byId.get(token.word_id);
  if(verifyWordRowAlignment(token,meta))checked++;else partial++;
  const base=key=>key.replace(/^lemma:/,'').match(/^([HG])0*(\d+)/)?.slice(1).join(':');
  if(token.lemma_key)assert.equal(base(token.lemma_key),base(token.strongs),fixture.ref);
  for(const key of token.lemma_candidates||[])assert.equal(base(key),base(token.strongs));
 }
 if(fixture.ref==='Zechariah 4:2'){
  const menorah=tokens.find(t=>t.strongs==='H4501'),gold=tokens.find(t=>t.strongs==='H2091'),lamps=tokens.find(t=>t.strongs==='H5216');
  for(const [t,tr,code] of [[menorah,'me.no.Rat','HNcfsc'],[gold,'za.Hav','HNcmsa'],[lamps,'ne.ro.Tei.ha','HNcfpc/Sp3fs']]){
   assert.ok(verifyWordRowAlignment(t,byId.get(t.word_id)));assert.equal(byId.get(t.word_id).transliteration,tr);assert.equal(byId.get(t.word_id).grammar_code,code);
  }
  assert.equal(menorah.position,9);assert.equal(menorah.word_id,91302);
  assert.ok(!verifyWordRowAlignment(menorah,{...byId.get(gold.word_id),id:menorah.word_id}));
 }
}
// Matching Strong's alone cannot verify another inflected form. Matching letters alone cannot verify a homograph.
const t={word_id:1,surface:'רוּחַ',strongs:'H7307'};
assert.ok(!verifyWordRowAlignment(t,{id:1,original_word:'רוחות',strongs_nr:'H7307'}));
assert.ok(!verifyWordRowAlignment(t,{id:1,original_word:'רוּחַ',strongs_nr:'H7308'}));
assert.ok(!verifyWordRowAlignment({...t,word_id:null},{id:1,original_word:'רוּחַ',strongs_nr:'H7307'}));
assert.ok(!verifyWordRowAlignment({word_id:1,surface:'כָּתַב',strongs:'H3789'},{id:1,original_word:'כְּתֹב',strongs_nr:'H3789'}), 'Vowels distinguish forms even with the same consonants and Strong\'s');
const ambiguous=normalizeTokenList({t:[[1,1,'כפר','H3724',[['stem','lemma:H3724A'],['stem','lemma:H3724D']]]]}, {toks:[{sf:'כפר',s:'H3724',lm:'כפר',g:'pitch'}]})[0];
assert.equal(ambiguous.lemma_key,'lemma:H3724');assert.equal(ambiguous.lemma_candidates.length,2);
const missing=normalizeTokenList(null,fixtures[0].fast);assert.ok(missing.every(t=>t.word_id===null&&t.alignment==='fast_verse_only'));
const repeated=normalizeTokenList({t:[[1,1,'אב','H0001'],[2,2,'גד','H0002'],[3,1,'אב','H0001']]},
 {toks:[{sf:'גד',s:'H0002',g:'middle'},{sf:'אב',s:'H0001',g:'last'}]});
assert.equal(repeated[0].gloss,null);assert.equal(repeated[1].gloss,'middle');assert.equal(repeated[2].gloss,'last');
const ambiguousRepeat=normalizeTokenList({t:[[1,1,'אב','H0001'],[2,1,'אב','H0001']]},
 {toks:[{sf:'אב',s:'H0001',g:'uncertain'}]});
assert.ok(ambiguousRepeat.every(t=>t.gloss===null&&t.alignment==='canonical_only'));
console.log('PASS source alignment:',fixtures.length,'Hebrew/Greek/morphology/heading/shifted/Ezekiel fixtures;',checked,'verified word forms;',partial,'explicit partial forms');
