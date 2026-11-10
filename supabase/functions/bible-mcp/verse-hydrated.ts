// BibleResearch 1.6: compact, epistemically typed and bounded single-verse hydration.
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseReader } from './catalog.ts';
import { attachNotesToResearchPacket } from './notes-tools.ts';
import { fetchMaculaSyntax } from './syntax-research.ts';

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : [];
const outputText = (v: unknown) => [{ type: 'text' as const, text: JSON.stringify(v) }];

export function registerVerseHydratedTool(server: McpServer, read: DatabaseReader): void {
  server.registerTool('get_verse_hydrated', {
    title: 'Hydrate one Bible verse: word studies, notes, historical setting',
    description: 'One-call original-language verse study with ordered words, glosses, morphology, STEP definitions, exact occurrence totals plus 7 sample references, 7 statistical co-occurrences, documented root/formation relatives and up to 7 heuristic same-letter candidates per Strong’s entry. Includes canonical verse and word notes, geography, competing chronology models, MACULA phrase/clause relationships, syntactic roles, and explicit unavailability of restricted semantic frames. Explicitly marks absent or uncertain evidence; spelling similarity does NOT prove etymology. A currently stale Cloudflare B7 build must never be used as the ground truth for source alignment.',
    inputSchema: z.strictObject({
      book: z.number().int().min(1).max(66).describe('Canonical book ID: Genesis 1, Psalms 19, Matthew 40, John 43.'),
      chapter: z.number().int().min(1).max(150),
      verse: z.number().int().min(0).max(176).describe('Use 0 for Psalm superscriptions when present.'),
      include_syntax: z.boolean().default(true).describe('Include MACULA constituent syntax, grammatical roles, clause/phrase edges and cross-verse span metadata. Semantic A0/A1 roles are not independently available when withheld.'),
      syntax_edition: z.enum(['macula-hebrew-wlc','macula-greek-nestle1904','macula-greek-sblgnt']).optional().describe('Select explicit Macula edition; defaults to WLC OT and Nestle1904 NT.'),
      include_notes: z.boolean().default(true).describe('Include user/AI notes connected to the verse and its word occurrences.'),
      include_spelling_candidates: z.boolean().default(true).describe('Look up up to 7 similar-consonant candidate lemmas for each distinct Strong’s entry, bounded to 24 entries.'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: 'noauth' }] },
  }, async ({book,chapter,verse,include_notes=true,include_spelling_candidates=true,include_syntax=true,syntax_edition}) => {
    try {
      const source = await read({
        name:'get_verse_research_v2',
        args:{p_request:{passages:[{book,chapter,verse}],profile:'analysis',occurrences:{mode:'sample',limit:7}}},
        limit:1,offset:0,
      });
      const packet = asObj(source.rows[0]);
      if (packet.status !== 'ok') {
        return {content:outputText({status:packet.status || 'unavailable', book,chapter,verse}),
          structuredContent:{status:String(packet.status || 'unavailable')}};
      }
      const verses = asArray(packet.verses);
      if(verses.length !== 1) throw Error('Expected exactly one verse');
      const verseRec = verses[0], words = asArray(verseRec.words);
      const syntaxPromise = include_syntax
        ? fetchMaculaSyntax(read,{book,chapter,verse,edition_key:syntax_edition},'compact')
        : Promise.resolve({status:'not_requested',has_syntax:false});
      const lexical = asObj(packet.lexical_entries);
      const formations = asObj(packet.lexical_formations);
      const entries: Record<string,unknown> = {};
      for (const [key,value] of Object.entries(lexical)) {
        const entry = {...asObj(value)};
        const occ=asObj(entry.occurrences);
        if (Object.keys(occ).length) {
          const refs=asArray(occ.references);
          entry.occurrences={...occ,references:refs.slice(0,7),complete:occ.complete===true && refs.length<=7};
        }
        entry.top_connected_words=asArray(entry.top_connected_words).slice(0,7);
        entries[key]=entry;
      }
      packet.lexical_entries=entries;
      const formed:Record<string,unknown>={};
      for(const [key,value] of Object.entries(formations)){
        const src=asObj(value);
        formed[key]={...src,root_relatives:asArray(src.root_relatives).slice(0,7),
          literary_connections:asArray(src.literary_connections).slice(0,7),
          documented_roots:asArray(src.documented_roots).slice(0,7),
          formations:asArray(src.formations).slice(0,7)};
      }
      packet.lexical_formations=formed;
      if(include_notes){
        await attachNotesToResearchPacket(packet,[{book,chapter,verse}],'full',true,true,read);
      } else {
        packet.notes_status='not_requested';
      }
      packet.complete_verse={
        canonical_reference:{book,chapter,verse,verse_id:verseRec.verse_id},
        original_language_text:words.map(w=>String(w.original_word||'')).join(' '),
        token_glosses:words.map(w=>asObj(w.translations).corpus_gloss ?? null),
        note:'Token-gloss sequence is not a continuous licensed Bible translation.',
      };
      // Orthographic evidence is not linguistic etymology. Each query is independently bounded.
      const terms=[...new Set(words.map(w=>String(w.strongs_nr||'')).filter(Boolean))];
      const maxUnique=24;
      const chosen=terms.slice(0,maxUnique);
      const sameLetters:Record<string,unknown>={};
      let index=0;
      async function lookup(){
        while(index<chosen.length){
          const term=chosen[index++];
          try{
            const res=await read({name:'suggest_orthographic_candidates_v1',
              args:{p_query:term,p_limit:7,p_min_chars:3},limit:1,offset:0});
            const x=asObj(res.rows[0]);
            sameLetters[term]={status:String(x.status||'unavailable'),
              method:x.method??null,
              candidates:asArray(x.candidate_connections).slice(0,7),
              epistemic_layer:'unverified_orthographic_candidate',
              warning:'Letter resemblance is not evidence of shared root, synonymy, or etymology.'};
          }catch{
            sameLetters[term]={status:'unavailable',candidates:[],epistemic_layer:'unverified_orthographic_candidate'};
          }
        }
      }
      if(include_spelling_candidates) await Promise.all(Array.from({length:Math.min(4,chosen.length)},()=>lookup()));
      packet.same_letter_candidates_by_strongs=sameLetters;
      packet.macula_syntax=await syntaxPromise;
      packet.hydration_scope={
        source:'live_supabase_research_v2',
        status:'bounded_single_verse',
        occurrence_references_per_lexeme:7,
        cooccurring_words_per_lexeme:7,
        related_words_per_lemma:7,
        orthographic_candidates_per_strongs:7,
        orthographic_distinct_strongs_processed:include_spelling_candidates?chosen.length:0,
        orthographic_omitted_distinct_strongs:include_spelling_candidates?Math.max(0,terms.length-maxUnique):terms.length,
        orthographic_status:!include_spelling_candidates?'not_requested':terms.length>maxUnique?'partial_capped_at_24':'requested',
        notes_classification:'untrusted_user_commentary_not_primary_text',
        chronology_classification:'competing_historical_models_not_known_fact',
        syntax_classification:'macula_source_constituents_and_grammatical_roles_only; semantic_agent_patient_frames_are_not_publicly_available',
        lexical_limitations:'Co-occurrence is statistical; spelling resemblance is heuristic; root family does not prove synonymy.',
        corpus_warning:'Verify canonical source mappings independently before treating historical Cloudflare B7 assets as aligned.',
      };
      packet.status='ok';
      return {content:outputText(packet),structuredContent:packet};
    }catch{
      return {isError:true,content:[{type:'text',text:'Hydrated verse retrieval failed; original evidence is unavailable or the request exceeded server limits.'}]};
    }
  });
}
