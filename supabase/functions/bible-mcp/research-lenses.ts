// @file: supabase/functions/bible-mcp/research-lenses.ts
// AI-efficient retrieval over indexed STEP and licensed MACULA evidence. Read-only, compact and bounded.
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseReader } from './catalog.ts';

const readOnly = {
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: 'noauth' }] },
};
const asObj = (x: unknown): Record<string, any> =>
  x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, any> : {};
const asList = (x: unknown): Record<string, any>[] => Array.isArray(x) ? x.filter(y => y && typeof y === 'object') : [];
const content = (x: unknown) => [{ type: 'text' as const, text: JSON.stringify(x) }];
const safeCount = (n: number, max: number) => Math.min(Math.max(n,1),max);

async function packet(read: DatabaseReader, name: 'research_word_lens_v1'|'research_word_bridge_v1'|'research_passage_lens_v1',
  args: Record<string, unknown>): Promise<Record<string,any>> {
 const res=await read({name,args,limit:1,offset:0});
 return asObj(res.rows[0]);
}
function compactWord(p:Record<string,any>, includePartners:boolean):Record<string,unknown> {
 return {
  schema_version:2,status:p.status,query:p.query,
  lexical_resolution:p.resolution_policy,candidates:asList(p.candidates).map(c=>({
    lemma:c.lemma_key,strongs:c.strongs,language:c.language,original:c.original,
    transliteration:c.transliteration,pos:c.pos,match_rank:c.resolution_rank,
    senses:asList(c.senses).map(s=>({label:s.sense,source:s.source,id:s.sense_id})),
    documented_root_links:asList(c.root_links).map(r=>({root:r.root_id,relation:r.relation,source:r.source})),
    attested_frequency:c.occurrence_counts,
    sampled_passages:asList(c.book_diverse_samples).map(v=>({book:v.book,chapter:v.chapter,verse:v.verse,
      position:v.word_position,original:v.word_original,step_gloss:v.word_gloss,english_web:v.english_web})),
    ...(includePartners?{statistical_associations:asList(c.statistical_partners).map(x=>({
       strongs:x.strongs,gloss:x.gloss,frequency:x.pair_frequency,distance:x.avg_distance,
       score_kind:'legacy_within_verse_frequency_over_distance',score:x.legacy_score}))}:{})
  })),
  coverage:{candidates_returned:p.match_count_returned,possible_more:p.truncated_candidates_possible,
    sampling:'one early occurrence per book; not an exhaustive usage survey'},
  evidence_rules:['Lexical sense is a dictionary category, not automatically a token-level reading.',
    'Root/form similarity never proves synonymy or historical derivation.',
    'Co-occurrence is a statistical lead, not a semantic or theological edge.',
    'Use original-language context to test candidate meanings, genre, negation and quotation.'],
  next_tool:'research_passage_lens on a decisive verse, then trace_biblical_bridge for a second lexical topic'
 };
}
function compactBridge(p:Record<string,any>):Record<string,unknown> {
 return {
  schema_version:2,status:p.status,query:{left:p.left_query,right:p.right_query},
  resolved_lexemes:{left:p.left_lexical_strongs,right:p.right_lexical_strongs},
  evidence_type:'same_or_nearby_verse_attestation_not_semantic_relation',
  witnesses:asList(p.matches).map(x=>({
    book:x.book,chapter:x.chapter,verse_left:x.left_verse,verse_right:x.right_verse,
    proximity:x.type,left_tokens:x.left_tokens,right_tokens:x.right_tokens,
    english_web_left:x.left_english_web,english_web_right:x.right_english_web
  })),
  coverage:{...asObj(p.limits),window:p.window_verses_within_chapter,
    selection:p.sampling,corpus:p.search_scope},
  epistemic_boundary:p.epistemic_warning,
  next_tool:'research_passage_lens on selected witnesses; find explicit predicate and check parallel/contrary cases'
 };
}
function compactPassage(p:Record<string,any>, mode:string):Record<string,unknown> {
 const toks=asList(p.tokens);
 return {
  schema_version:2,status:p.status,canonical_reference:p.reference,language:p.language,
  edition:p.macula_edition,english_web:p.english_web,
  original_language_tokens:toks.map(t=>({
    position:t.word,part:t.part??null,text:t.text,lemma:t.lemma,strongs_source:t.strongs_raw,
    morphology:t.morphology,grammar_role:t.grammatical_role??t.class??null,
    source_sense_tag:t.sense_annotation??null,frame_source:t.semantic_frame_source??null,
    subject_ref:t.subject_ref??null,participant_ref:t.participant_ref??t.referent??null,
    source_id:mode==='full'?t.source_id:undefined
  })),
  coverage:p.coverage,limits:p.epistemic_notes,
  research_instruction:'First parse word order and clause/phrase relation. Determine whether this is a narrative report, command, quotation, metaphor or explicit interpretation. A grammatical subject is not necessarily the semantic agent. Ground each relation in words and verse; do not claim source-gated semantics.',
  next_tool:'research_macula_syntax when a full constituency tree is required; get_verse_hydrated for deeper word senses/notes'
 };
}
export function registerResearchLenses(server:McpServer,read:DatabaseReader):void {
 server.registerTool('research_word_lens',{
  title:'Research an original-language biblical word — concise evidence lens',
  description:'One call resolves precise Hebrew/Greek lemmas, discrete STEP senses, documented roots, exact occurrence counts, book-diverse verse samples and optional top lexical proximity. Best first call for bread, seed, lechem, zera or G3056. Avoids full unfiltered database dumps; no semantic identities inferred.',
  inputSchema:z.strictObject({
    query:z.string().trim().min(1).max(96).describe('Exact Strong code (H3899, G4703), original Hebrew/Greek lemma, transliteration, or exact dictionary gloss'),
    max_candidates:z.number().int().min(1).max(8).default(4),
    include_associations:z.boolean().default(true),
  }),outputSchema:z.record(z.string(),z.unknown()),...readOnly,
 },async ({query,max_candidates=4,include_associations=true})=>{
  try {const p=await packet(read,'research_word_lens_v1',{p_query:query,p_limit:max_candidates});
    const result=compactWord(p,include_associations);return {content:content(result),structuredContent:result};}
  catch{return {isError:true,content:content({status:'unavailable',message:'Word lens data unavailable; existing word lookup tools remain usable.'})};}
 });
 server.registerTool('trace_biblical_bridge',{
  title:'Find direct textual witnesses linking two Bible words',
  description:'Search indexed canonical verses for pairs of original-language lemmas in one verse or neighboring verses. Returns token positions, Strong IDs and short WEB contexts, not theological conclusions. Best rapid first-pass test for seed -> word or bread -> word, before grammar inspection.',
  inputSchema:z.strictObject({
    left:z.string().trim().min(1).max(96).describe('Prefer Strong code, e.g. G4703 for the seed in Luke 8:11'),
    right:z.string().trim().min(1).max(96).describe('Prefer Strong code, e.g. G3056 for logos'),
    max_witnesses:z.number().int().min(1).max(12).default(8),
    nearby_verse_window:z.number().int().min(0).max(2).default(1).describe('0: same verse only; 1–2: nearby verses, same chapter only'),
  }),outputSchema:z.record(z.string(),z.unknown()),...readOnly,
 },async ({left,right,max_witnesses=8,nearby_verse_window=1})=>{
  try {const p=await packet(read,'research_word_bridge_v1',{p_left:left,p_right:right,p_limit:max_witnesses,p_window:nearby_verse_window});
   const result=compactBridge(p);return {content:content(result),structuredContent:result};}
  catch{return {isError:true,content:content({status:'unavailable',message:'Bible connection witness search unavailable.'})};}
 });
 server.registerTool('research_passage_lens',{
  title:'Read one original-language verse with MACULA grammar in compact form',
  description:'Fast precise STEP-indexed verse with source-specific MACULA Hebrew morphemes or Greek tokens, grammar, available source roles/frames, source IDs and WEB rendering. Removes redundant metadata and marks missing/legally gated semantic evidence. Default lean; full mode returns more source token identifiers.',
  inputSchema:z.strictObject({
    book:z.number().int().min(1).max(66),chapter:z.number().int().min(1).max(150),
    verse:z.number().int().min(0).max(176),
    profile:z.enum(['analysis','full']).default('analysis'),
  }),outputSchema:z.record(z.string(),z.unknown()),...readOnly,
 },async ({book,chapter,verse,profile='analysis'})=>{
  try {const p=await packet(read,'research_passage_lens_v1',{p_book:book,p_chapter:chapter,p_verse:verse,p_max_tokens:profile==='full'?120:55});
   const result=compactPassage(p,profile);return {content:content(result),structuredContent:result};}
  catch{return {isError:true,content:content({status:'unavailable',message:'Original-language passage lens unavailable.'})};}
 });
}
