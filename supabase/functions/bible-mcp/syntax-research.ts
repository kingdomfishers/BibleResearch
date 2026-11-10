// @file: supabase/functions/bible-mcp/syntax-research.ts
// @feature: api
// @toc: evidence-policy | mapping | tools
// MACULA constituent syntax is primary annotated grammar, not an inferred semantic dependency graph.
// Never expose restricted MACULA Hebrew semantic_frame or licensed third-party semantic-domain fields.
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseReader } from './catalog.ts';

const asObject=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const asObjects=(x:unknown):Record<string,unknown>[]=>Array.isArray(x)?x.filter(y=>y&&typeof y==='object'&&!Array.isArray(y)) as Record<string,unknown>[]:[];
const scalar=(x:unknown)=>typeof x==='string'||typeof x==='number'||typeof x==='boolean'?x:null;
const pick=(o:Record<string,unknown>,keys:readonly string[])=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));
const nodeFields=[
 'id','node_key','parent_node_id','depth','sibling_order','node_type','class_label','rule_label','cl_type',
 'syntactic_role','is_head','is_terminal','terminal_xml_id','terminal_word_id',
 'terminal_mapping_status','surface_word','word_grammar','word_strongs','word_transliteration',
 'verse_id','end_verse_id','start_word_position','end_word_position','is_cross_verse'
] as const;
const edgeFields=[
 'id','source_node_id','target_node_id','relation_type','raw_relation_tag',
 'head_word_position','dependent_word_position'
] as const;
const roleNames:Record<string,string>={
 s:'grammatical subject',o:'grammatical object',io:'grammatical indirect object',
 v:'verbal constituent',adv:'adverbial constituent'
};
const text=(obj:unknown)=>[{type:'text' as const,text:JSON.stringify(obj)}];

export interface SyntaxTarget {book:number;chapter:number;verse:number;edition_key?:string;word_position?:number}
export function defaultMaculaEdition(book:number){return book<=39?'macula-hebrew-wlc':'macula-greek-nestle1904';}
export async function fetchMaculaSyntax(
 read:DatabaseReader,target:SyntaxTarget,mode:'compact'|'complete'='compact',
):Promise<Record<string,unknown>>{
 const edition=target.edition_key||defaultMaculaEdition(target.book);
 if((target.book<=39)!==edition.startsWith('macula-hebrew-')){
   return {status:'invalid_edition_for_testament',has_syntax:false,edition_key:edition,trees:[],edges:[]};
 }
 try{
   const reply=await read({name:'lookup_syntax_tree_v1',args:{
     p_book:target.book,p_chapter:target.chapter,p_verse:target.verse,p_edition_key:edition,
   },limit:1,offset:0});
   const raw=asObject(reply.rows[0]);
   if(raw.has_syntax!==true){
     return {
       status:String(raw.syntax_status||'unavailable'),has_syntax:false,
       edition_key:edition,canonical_reference:{book:target.book,chapter:target.chapter,verse:target.verse},
       reason:raw.missing_syntax_reason??'Syntax evidence not returned by source',
       semantics:{status:'not_publicly_available',semantic_frames:[],note:'No attested public agent/patient annotations; do not infer them from grammatical labels.'},
     };
   }
   const sourceTrees=asObjects(raw.trees);
   const rawEdges=asObjects(raw.edges);
   const allNodes=sourceTrees.flatMap(t=>asObjects(t.nodes));
   const selectedNodes=mode==='complete'?allNodes.slice(0,2500):allNodes.slice(0,240);
   const selectedEdges=mode==='complete'?rawEdges.slice(0,3000):rawEdges.slice(0,400);
   const nodes=selectedNodes.map(n=>pick(n,nodeFields));
   const edges=selectedEdges.map(e=>pick(e,edgeFields));
   const roleSpans=allNodes.filter(n=>typeof n.syntactic_role==='string'&&n.syntactic_role)
     .slice(0,mode==='complete'?1000:150)
     .map(n=>({
       node_id:n.id,raw_role:n.syntactic_role,
       common_grammatical_label:roleNames[String(n.syntactic_role)]||null,
       node_type:n.node_type,
       class_label:n.class_label??null,
       start_word_position:n.start_word_position??null,
       end_word_position:n.end_word_position??null,
       verse_id:n.verse_id??null,
       end_verse_id:n.end_verse_id??null,
       source:'macula_syntax_tree',
       role_class:'syntactic_not_semantic'
     }));
   const chosen=target.word_position===undefined?[]:allNodes.filter(n=>{
     const lo=Number(n.start_word_position),hi=Number(n.end_word_position);
     return Number.isInteger(lo)&&Number.isInteger(hi)&&lo<=target.word_position!&&target.word_position!<=hi;
   }).map(n=>scalar(n.id)).filter(x=>x!==null);
   const treeSummaries=sourceTrees.map(t=>({
     ...pick(t,['tree_id','tree_key','root_node_id','source_file','source_edition','is_cross_verse']),
     node_count:asObjects(t.nodes).length,
   }));
   const spans=asObjects(raw.cross_verse_spans).map(s=>pick(s,[
     'source_verse_id','end_verse_id','start_verse_id','start_word_position',
     'end_word_position','tree_id','node_id','node_key','span_type'
   ]));
   return {
     status:String(raw.syntax_status||'annotated_in_source'),
     has_syntax:true,edition_key:edition,
     canonical_reference:{book:target.book,chapter:target.chapter,verse:target.verse,verse_id:raw.verse_id??null},
     source_tree_count:sourceTrees.length, source_node_count:allNodes.length,source_edge_count:rawEdges.length,
     trees:treeSummaries,nodes,edges,syntactic_role_spans:roleSpans,
     cross_verse_spans:spans,
     focus_word_position:target.word_position??null,
     focus_ancestor_and_spanning_node_ids:chosen,
     completeness:{
       nodes_complete:allNodes.length<=nodes.length,
       edges_complete:rawEdges.length<=edges.length,
       role_spans_complete:allNodes.filter(n=>Boolean(n.syntactic_role)).length<=roleSpans.length,
       source_graph_status:'source_annotations_with_position_mapping; do not infer unprovided edges'
     },
     semantics:{
       status:'not_publicly_available',
       semantic_frames:[],
       note:'MACULA semantic-frame A0/A1 annotations are not present in the publicly released syntax response. Hebrew frames are license-unverified; public wrapper also redacts frame keys. Source syntactic roles are NOT agent/patient roles.',
       related_lexical_semantics:'Use lookup_lexical_semantics independently for lexeme-level evidence; it is not clause-level participant labeling.',
     },
     evidence_status:{
       type:'macula_annotated_constituent_syntax',
       cross_verse_preserved:spans.length>0,
       mapping_review:'B7 verse/token alignment and Cloudflare shard release verification remain separate; unverified historical assets may be stale.'
     },
   };
 }catch{
   return {status:'unavailable',has_syntax:false,edition_key:edition,
     reason:'MACULA syntax RPC unreachable or returned invalid evidence',
     semantics:{status:'not_publicly_available',semantic_frames:[]}};
 }
}

export function registerMaculaSyntaxTool(server:McpServer,read:DatabaseReader):void{
 server.registerTool('research_macula_syntax',{
   title:'Research Macula clause structure, phrase relations and grammatical roles',
   description:'Return a complete bounded syntax tree for a verse: constituent nodes, parent-child edges, grammatical role spans (subject/object/predicate), terminal/source-word identifiers, and cross-verse spans. Distinguishes syntactic roles from semantic agent/patient roles; restricted or missing semantic frames are not guessed. Optional word_position highlights spanning constituents. Set edition_key for a specific Macula WLC, Nestle1904 or SBLGNT source.',
   inputSchema:z.strictObject({
     book:z.number().int().min(1).max(66),
     chapter:z.number().int().min(1).max(150),
     verse:z.number().int().min(0).max(176),
     edition_key:z.enum(['macula-hebrew-wlc','macula-greek-nestle1904','macula-greek-sblgnt']).optional(),
     word_position:z.number().int().min(1).max(300).optional(),
   }),
   outputSchema:z.record(z.string(),z.unknown()),
   annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
   _meta:{securitySchemes:[{type:'noauth'}]},
 },async ({book,chapter,verse,edition_key,word_position})=>{
   const payload=await fetchMaculaSyntax(read,{book,chapter,verse,edition_key,word_position},'complete');
   return {content:text(payload),structuredContent:payload};
 });
}
