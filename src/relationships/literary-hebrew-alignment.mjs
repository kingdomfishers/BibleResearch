import {induceTemplate,discoverChiasms} from './literary-structure.mjs';
import {analyzeHebrewPassage,tokenize} from './literary-hebrew.mjs';

// Uses shared algorithm core on real MT motif and verified MACULA predicate streams.
export function linkedHebrewAnalysis(input,syntax=[]) {
  const base=analyzeHebrewPassage(input),tokens=tokenize(input),lookup=new Map(tokens.map(t=>[t.id,t])),index=new Map(tokens.map(t=>[`${t.verseId}:${t.pos}`,t])),best=base.boundaries[0];
  const frameEvents=[],modifierMap=new Map(),validSyntax=new Set();
  for(const s of syntax){
    if(s.sourceEdition!=='macula-hebrew-wlc')continue;
    if(!tokens.some(t=>t.verseId===s.verseId))continue;
    validSyntax.add(s.verseId);
    for(const m of s.modifiers){
      const h=index.get(`${s.verseId}:${m.headPos}`),v=index.get(`${s.verseId}:${m.modifierPos}`);
      if(h?.wordId===m.headWordId&&v?.wordId===m.modifierWordId&&h&&v)modifierMap.set(h.id,{token:v,node:m.node,sourceTokenId:m.modifierTokenId});
    }
    for(const f of s.frames){
      if(f.source?.canonical_verse_ids?.length!==1||String(f.source.canonical_verse_ids[0])!==String(s.verseId))continue;
      const p=index.get(`${s.verseId}:${f.predicate.pos}`);
      if(!p||p.wordId!==f.predicate.wordId||!f.predicate.lemma||!f.predicate.tokenId)continue;
      const roles=f.roles.map(ro=>({ro,t:index.get(`${s.verseId}:${ro.pos}`)})).filter(({ro,t})=>t&&t.wordId===ro.wordId&&ro.lemma);
      frameEvents.push({id:f.id,key:f.predicate.lemma,wordIds:[...new Set([p.id,...roles.map(x=>x.t.id)])],features:[`lemma:${f.predicate.lemma}`,...roles.map(({ro})=>`role:${ro.role}=${ro.lemma}`),`frame:${f.context?.modality??'unknown'}`,`frame:${f.context?.quotation??'unknown'}`],index:p.index,source:f.source});
    }
  }
  frameEvents.sort((a,b)=>a.index-b.index||a.id.localeCompare(b.id));
  const uniqueFrames=[...new Map(frameEvents.map(e=>[e.id,e])).values()];
  const variants=[],motifEvents=[],motifUnits=[];
  if(best){
    for(const m of base.motifs){
      const key=JSON.stringify([m.lane,...m.keys]);
      const all=m.evidence.flat();
      for(let u=0;u<m.evidence.length;u++)for(const hit of m.evidence[u]){
        const end=lookup.get(hit.wordIds.at(-1)),next=lookup.get(hit.next?.id),mod=modifierMap.get(end?.id);
        const followingPerson=t=>t?.grammar.match(/(?:^H|\/)V[a-zA-Z][a-zA-Z]([123][mfc][spd])/)?.[1]??null;
        const person=followingPerson(next),peerPersons=all.filter(x=>x!==hit).map(x=>followingPerson(lookup.get(x.next?.id))).filter(Boolean);
        const features=[],ids=hit.wordIds.slice();
        if(mod){features.push(`modifier:${mod.token.strongs}`);ids.push(mod.token.id);variants.push({kind:'source_syntax_modifier',motif:m.keys,ref:hit.ref,head:end.id,modifier:mod.token.id,form:mod.token.form,lemma:mod.token.lemma,sourceNode:mod.node});}
        if(person){features.push(`modifier:following_verb_person=${person}`);if(peerPersons.length>=3&&!peerPersons.includes(person))variants.push({kind:'unusual_following_verb_person',motif:m.keys,ref:hit.ref,occurrence:next.id,form:next.form,person,peerPersons});}
        motifEvents.push({id:`motif:${key}:${hit.wordIds[0]}`,key,wordIds:ids,features,index:lookup.get(hit.wordIds[0]).index,endIndex:end.index,unit:u,priority:10*m.support+m.keys.length-(end.index-lookup.get(hit.wordIds[0]).index)*.03});
      }
    }
    for(let i=0;i<best.units.length;i++){
      const chosen=[];
      for(const event of motifEvents.filter(e=>e.unit===i).sort((a,b)=>b.priority-a.priority||a.index-b.index)){
        if(chosen.some(x=>event.index<=x.endIndex&&x.index<=event.endIndex))continue;
        chosen.push(event);
      }
      motifUnits.push(chosen.sort((a,b)=>a.index-b.index));
    }
  }
  const eligible=units=>units.length>=2&&units.length<=32&&units.every(u=>u.length>0)&&units.flat().length<=256;
  const motifTemplate=eligible(motifUnits)?induceTemplate(motifUnits):null;
  const frameUnits=best?best.units.map(u=>uniqueFrames.filter(e=>e.index>=u.from&&e.index<u.to)):[];
  const syntaxComplete=best?best.units.every(u=>tokens.slice(u.from,u.to).every(t=>validSyntax.has(t.verseId))):false;
  const grammarTemplate=syntaxComplete&&eligible(frameUnits)?induceTemplate(frameUnits):null;
  const chiasms=[];
  for(const v of input.verses){
    const stream=tokens.filter(t=>t.verseId===v.id).map(t=>({id:t.id,key:t.strongs,features:[],wordIds:[t.id]}));
    if(stream.length<=160)chiasms.push(...discoverChiasms(stream).map(x=>({...x,ref:v.ref,lane:'strongs_candidate'})));
  }
  return {passage:input.passage,motifTemplate,grammarTemplate,grammarCoverage:{verses:validSyntax.size,frames:uniqueFrames.length,completeForUnits:syntaxComplete},motifEvents:motifUnits.flat(),frameEvents:uniqueFrames,variants,chiasms:chiasms.sort((a,b)=>b.score-a.score).slice(0,20)};
}
