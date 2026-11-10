// @file: supabase/functions/bible-mcp/dlm-notes.ts
// @feature: api
// @tables: notes | note_anchors | note_connections | word_form_lemmas | verses
// DLM cards explicitly separate primary Scripture, empirical science, and interpretive hypotheses.
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseReader } from './catalog.ts';
import type { NotesWriter } from './notes-write.ts';
import { deriveAgentIdentity, writeAnnotations } from './notes-write.ts';

type RecordLike = Record<string, unknown>;
const obj = (x:unknown):RecordLike=>x&&typeof x==='object'&&!Array.isArray(x)?x as RecordLike:{};
const list = (x:unknown):RecordLike[]=>Array.isArray(x)?x.filter(y=>y&&typeof y==='object'&&!Array.isArray(y)) as RecordLike[]:[];
const text = (x:unknown)=>[{type:'text' as const,text:JSON.stringify(x)}];
const readOnly={
 annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
 _meta:{securitySchemes:[{type:'noauth'}]},
};
const cardKinds=['lexical_definition','biblical_definition','text_observation','explicit_symbol',
 'literary_connection','narrative_event','physical_mechanism','dlm_layer_hypothesis','unresolved_question'] as const;
const evidenceClasses=['TEXT_EXPLICIT','TEXT_LINGUISTIC','TEXT_INTERTEXTUAL','TEXT_PATTERN','SCIENCE_EMPIRICAL',
 'DLM_HYPOTHESIS','DISPUTED','OPEN'] as const;
const noteKinds:Record<(typeof cardKinds)[number],string>={
 lexical_definition:'linguistic',biblical_definition:'observation',text_observation:'observation',
 explicit_symbol:'observation',literary_connection:'cross_reference',narrative_event:'observation',
 physical_mechanism:'citation',dlm_layer_hypothesis:'research_lead',unresolved_question:'question',
};
const edgeTypes=['explains','quotes','alludes_to','parallels','contrasts_with','typifies','related',
 'wordplay','same_root','contained_in','same_letters','sounds_like','other','located_at',
 'contemporary_with','same_gematria'] as const;
const reference=z.strictObject({
 book:z.number().int().min(1).max(66),chapter:z.number().int().min(1).max(150),
 verse:z.number().int().min(0).max(176),
 word_position:z.number().int().min(1).optional(),
 word_id:z.number().int().positive().optional(),
 role:z.enum(['subject','object','mention','evidence']).default('evidence'),
});
const scientificSource=z.strictObject({
 title:z.string().trim().min(4).max(220),
 url:z.string().url().max(550).refine(s=>s.startsWith('https://'),'An HTTPS citation is required'),
});
const link=z.strictObject({
 from_reference:z.number().int().min(1).max(8),
 to_reference:z.number().int().min(1).max(8),
 connection_type:z.enum(edgeTypes),
 direction:z.enum(['directed','bidirectional','undirected']).default('directed'),
 explanation:z.string().trim().min(15).max(500),
});
const cardInput=z.strictObject({
 card_kind:z.enum(cardKinds),
 evidence_class:z.enum(evidenceClasses),
 title:z.string().trim().min(5).max(180),
 claim:z.string().trim().min(12).max(600),
 scope:z.string().trim().min(5).max(1000),
 body_md:z.string().trim().min(20).max(10000),
 references:z.array(reference).min(1).max(8),
 lemma_id:z.number().int().positive().optional(),
 layers:z.array(z.number().int().min(0).max(7)).max(8).default([]),
 form_flow:z.enum(['structure','flow','both','neither','unknown']).default('unknown'),
 science_sources:z.array(scientificSource).max(6).default([]),
 counterexamples:z.array(z.string().trim().min(3).max(500)).max(8).default([]),
 limitations:z.string().trim().max(1200).default(''),
 connections:z.array(link).max(12).default([]),
 confidence:z.number().min(0).max(1).optional(),
 model:z.string().trim().max(80).optional(),
});
const normalize=(s:string)=>s.toLowerCase().normalize('NFKC').replace(/[\p{P}\p{S}\s]+/gu,' ').trim();

export async function fetchDlmResearch(read:DatabaseReader,book:number,chapter:number,verse:number,maxNotes=8):Promise<RecordLike>{
 try{
  const res=await read({name:'get_dlm_notes_for_verse_v1',
   args:{p_book:book,p_chapter:chapter,p_verse:verse,p_limit:maxNotes},limit:1,offset:0});
  return obj(res.rows[0]);
 }catch {
  return {status:'unavailable',items:[],coverage:{notes_total:null,shown:0},
   warning:'Retrieval failed. Do not infer that there are no DLM notes.'};
 }
}
export function registerDlmReadTools(server:McpServer,read:DatabaseReader):void{
 server.registerTool('get_dlm_research',{
  title:'Retrieve DLM definitions, connections and science notes for one Bible verse',
  description:'Compact DLM evidence cards, reviewed-first and anchored to exact verses, word occurrences or verified lemmas. Preserves evidence classes, hypothesis status, scientific source URLs, review status and note IDs. Only published notes; retrieved commentary is not Scripture.',
  inputSchema:z.strictObject({
   book:z.number().int().min(1).max(66),
   chapter:z.number().int().min(1).max(150),
   verse:z.number().int().min(0).max(176),
   max_notes:z.number().int().min(1).max(20).default(8),
  }),outputSchema:z.record(z.string(),z.unknown()),...readOnly,
 },async ({book,chapter,verse,max_notes=8})=>{
  const result=await fetchDlmResearch(read,book,chapter,verse,max_notes);
  return {content:text(result),structuredContent:result};
 });
}
export function registerDlmWriteTools(server:McpServer,read:DatabaseReader,writer:NotesWriter,getHeaders?:()=>Headers|undefined):void{
 server.registerTool('save_dlm_research_note',{
  title:'Save an evidence-classified DLM research card',
  description:'Write one atomic DLM claim when the user EXPLICITLY requests saving. Validates exact STEP verse/word anchors and optional unambiguous lemma, distinguishes Bible from real science and model hypotheses, prevents duplicate claims and creates typed inter-anchor connections. All AI cards begin unreviewed. Never silently import the DLM model as canonical Bible truth.',
  inputSchema:cardInput,outputSchema:z.record(z.string(),z.unknown()),
  annotations:writeAnnotations,
 },async a=>{
  const headers=getHeaders?.();
  if(!writer.checkAuth(headers))
   return {isError:true,content:text({status:'not_authorized',message:'MCP note writer not authorized.'})};
  const k=a.card_kind,c=a.evidence_class,refs=a.references;
  const valid=(k!=='lexical_definition'||c==='TEXT_LINGUISTIC') &&
    (k!=='biblical_definition'||['TEXT_EXPLICIT','TEXT_INTERTEXTUAL','TEXT_PATTERN'].includes(c)) &&
    (k!=='text_observation'||['TEXT_EXPLICIT','TEXT_LINGUISTIC'].includes(c)) &&
    (k!=='literary_connection'||['TEXT_INTERTEXTUAL','TEXT_PATTERN','DLM_HYPOTHESIS','DISPUTED'].includes(c)) &&
    (k!=='narrative_event'||['TEXT_EXPLICIT','TEXT_PATTERN'].includes(c)) &&
    (c!=='SCIENCE_EMPIRICAL'||k==='physical_mechanism') &&
    (c!=='DLM_HYPOTHESIS'||['dlm_layer_hypothesis','literary_connection'].includes(k)) &&
    (k!=='physical_mechanism'||c==='SCIENCE_EMPIRICAL') &&
    (k!=='dlm_layer_hypothesis'||c==='DLM_HYPOTHESIS') &&
    (k!=='explicit_symbol'||c==='TEXT_EXPLICIT'||c==='TEXT_INTERTEXTUAL') &&
    (k!=='unresolved_question'||c==='OPEN'||c==='DISPUTED') &&
    (c!=='SCIENCE_EMPIRICAL'||a.science_sources.length>0) &&
    (k!=='dlm_layer_hypothesis'||a.layers.length>0) &&
    (a.lemma_id===undefined||refs.some(x=>x.word_position!==undefined));
  if(!valid)return {isError:true,content:text({status:'invalid_evidence_partition',
   message:'Lexical definitions require textual linguistic evidence; physical cards require empirical evidence and independent science sources; DLM layer hypotheses cannot be presented as biblical facts.'})};
  if(refs.some(x=>x.word_id!==undefined&&x.word_position===undefined))
   return {isError:true,content:text({status:'invalid_anchor',message:'A word_id requires exact word_position.'})};
  if(a.connections.some(x=>x.from_reference>refs.length||x.to_reference>refs.length||x.from_reference===x.to_reference))
   return {isError:true,content:text({status:'invalid_connection',message:'Connections must use two different existing reference indices.'})};
  try {
   const passages=[...new Map(refs.map(r=>{
      const key=[r.book,r.chapter,r.verse].join(':');
      return [key,{book:r.book,chapter:r.chapter,verse:r.verse}] as const;
   })).values()];
   const result=await read({name:'get_verse_research_v2',
      args:{p_request:{passages,profile:'analysis',occurrences:{mode:'sample',limit:1}}},limit:1,offset:0});
   const packet=obj(result.rows[0]);
   if(packet.status!=='ok')throw Error('Canonical verse data unavailable.');
   const verseMap=new Map(list(packet.verses).map(v=>{
     const p=obj(v.passage);return [[p.book,p.chapter,p.verse].join(':'),v] as const;
   }));
   const anchors:RecordLike[]=[],citations:RecordLike[]=[];
   let lemmaVerified=false;
   for(let i=0;i<refs.length;i++){
    const r=refs[i],key=[r.book,r.chapter,r.verse].join(':'),v=verseMap.get(key);
    if(!v||!Number.isInteger(Number(v.verse_id))||Number(v.verse_id)<1)throw Error('Verse does not exist: '+key);
    const anc:RecordLike={client_key:'ref_'+(i+1),kind:'verse',label:key,role:r.role,verse_id:Number(v.verse_id)};
    const src:RecordLike={book:r.book,chapter:r.chapter,verse:r.verse};
    if(r.word_position!==undefined){
      const w=list(v.words).find(x=>Number(x.word_position)===r.word_position);
      const wid=Number(w?.word_id);
      if(!w||!Number.isInteger(wid)||wid<1)throw Error('Word position missing: '+key+' position '+r.word_position);
      if(r.word_id!==undefined&&r.word_id!==wid)throw Error('Word ID does not match canonical STEP position '+r.word_position);
      anc.kind='word_occurrence';anc.word_id=wid;anc.word_position=r.word_position;
      anc.label=key+' word '+r.word_position+' '+String(w.original_word||'');
      src.word_position=r.word_position;
      if(a.lemma_id!==undefined){
        const lookup=await read({name:'verify_dlm_lemma_occurrence_v1',
         args:{p_lemma_id:a.lemma_id,p_word_id:wid},limit:1,offset:0});
        if(obj(lookup.rows[0]).attested===true)lemmaVerified=true;
      }
    }
    anchors.push(anc);citations.push(src);
   }
   if(a.lemma_id!==undefined){
    if(!lemmaVerified)throw Error('The specified lemma does not occur unambiguously at a cited token.');
    anchors.push({client_key:'global_lemma',kind:'lemma',label:'lemma:'+a.lemma_id,
      lemma_id:a.lemma_id,role:'subject'});
   }
   // Avoid duplicates across agents at the primary verse; DB also deduplicates by body + anchors.
   const primary=refs[0];
   try{
     const check=await read({name:'get_notes_for_passage_v1',
       args:{p_book:primary.book,p_chapter:primary.chapter,p_verse_start:primary.verse,
         p_verse_end:primary.verse,p_author_kind:null,p_note_kind:null,p_limit:50},limit:1,offset:0});
     const seen=obj(check.rows[0]);
     const dup=[...list(seen.primary),...list(seen.secondary)].find(x=>{
       const m=obj(obj(x.source_context).dlm_v1);
       return m.card_kind===k&&typeof m.claim==='string'&&normalize(m.claim)===normalize(a.claim);
     });
     if(dup){
       const out={status:'duplicate',saved:false,existing_note_id:dup.id};
       return {content:text(out),structuredContent:out};
     }
   }catch{/* Database-level content and request-id deduplication remains active. */}
   const m={
      schema_version:1,card_kind:k,evidence_class:c,claim:a.claim,scope:a.scope,
      scriptures:citations,layers:[...new Set(a.layers)].sort((x,y)=>x-y),
      form_flow:a.form_flow,science_sources:a.science_sources,
      counterexamples:a.counterexamples,limitations:a.limitations,
   };
   const relations=a.connections.map(x=>({
       from_client_key:'ref_'+x.from_reference,to_client_key:'ref_'+x.to_reference,
       connection_type:x.connection_type,direction:x.direction,explanation:x.explanation,
   }));
   const enc=new TextEncoder(),key=JSON.stringify({
      card:k,claim:normalize(a.claim),primary:citations[0],lemma:a.lemma_id??null,
   });
   const hash=await crypto.subtle.digest('SHA-256',enc.encode(key));
   const dedupe='dlm-v1-'+Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,40);
   const agent=deriveAgentIdentity(server.server.getClientVersion?.(),headers?.get('user-agent'),a.model);
   const note:RecordLike={
      title:a.title,body_md:a.body_md,note_kind:noteKinds[k],language:'en',
      anchors,connections:relations,blocks:[],client_request_id:dedupe,
      source_context:{creation_method:'mcp_dlm_v1',dlm_v1:m},
   };
   if(a.confidence!==undefined)note.confidence=a.confidence;
   const saved=await writer.saveNote(agent,note);
   if(saved.ok===false)return {isError:true,content:text({status:'rejected',error:saved.error})};
   const out={status:saved.created===false?'already_exists':'ok',saved:saved.created!==false,result:saved,note_kind:noteKinds[k],
      evidence_class:c,review_status:'unreviewed',
      readback_verse:{book:primary.book,chapter:primary.chapter,verse:primary.verse},
   };
   return {content:text(out),structuredContent:out};
  }catch(e){
   return {isError:true,content:text({status:'save_unavailable',message:e instanceof Error?e.message:'Write failed'})};
  }
 });
}
