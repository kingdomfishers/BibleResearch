// Passage-local Hebrew adapter and evidence-first motif discovery. No external services.
// Uses compact get_Passage output; MT only. See research/literary/HEBREW_HANDOFF.md.

function normalizeHebrew(s) {
  return String(s??'').normalize('NFD').replace(/\p{M}/gu,'').replace(/[ךםןףץ]/g,c=>({'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'})[c]).replace(/[^\u05d0-\u05ea]/g,'');
}

export function compactHebrewInput(response) {
  if(response.status!=='ok'||response.pagination?.has_more||!response.verses?.length)throw Error('Incomplete corpus response');
  return {passage:response.passage,edition:'MT:compact-reader',verses:response.verses.map(v=>({ref:v.ref,id:v.verse_id,words:v.words.map(w=>[w.pos,w.word_id,w.form,w.strongs,w.lemma??response.lexicon[w.strongs]?.lemma??'',w.lemma_key??response.lexicon[w.strongs]?.lemma_key??'',w.code??'',w.lemma_key?'occurrence':'lexicon_fallback'])}))};
}

export function tokenize(input) {
  if(input.edition!=='MT:compact-reader')throw Error('Expected MT reader input');
  const ids=new Set(),tokens=[];
  for(const v of input.verses){
    if(!Number.isSafeInteger(v.id)||!v.words.length)throw Error('Invalid verse');
    let previous=0;
    for(const [pos,wordId,form,strongs,lemma,lemmaKey,grammar,keySource] of v.words){
      if(!Number.isSafeInteger(pos)||pos!==previous+1||!Number.isSafeInteger(wordId)||!normalizeHebrew(form)||!/^H\d+$/.test(strongs))throw Error('Invalid/non-Hebrew or noncontiguous token');
      previous=pos;const id=`${input.edition}:${v.id}:${pos}`;if(ids.has(id))throw Error('Duplicate occurrence');ids.add(id);
      tokens.push({id,wordId,ref:v.ref,verseId:v.id,pos,form,strongs,lemma,lemmaKey,grammar,keySource,script:normalizeHebrew(lemma),end:pos===v.words.length,index:tokens.length});
    }
  }
  if(tokens.length>1200)throw Error('Passage limit: 1200 tokens; paginate explicitly');
  return tokens;
}

function keyOf(t,lane) {
  return lane==='strongs'?t.strongs:lane==='script'?(t.script?`script:${t.script}`:`unresolved:${t.id}`):(t.keySource==='occurrence'&&t.lemmaKey?t.lemmaKey:`unresolved:${t.id}`);
}

function minePhrases(tokens,lane='strongs',maxLength=7) {
  const found=new Map(),keys=tokens.map(t=>keyOf(t,lane));
  for(let i=0;i<tokens.length;i++)for(let n=2;n<=maxLength&&i+n<=tokens.length;n++){
    if(tokens[i].verseId!==tokens[i+n-1].verseId)break;
    const seq=keys.slice(i,i+n),k=JSON.stringify(seq);if(seq.some(x=>x.startsWith('unresolved:')))continue;
    const group=found.get(k)??{keys:seq,starts:[],length:n,lane};
    if(!group.starts.length||i>=group.starts.at(-1)+n)group.starts.push(i);
    found.set(k,group);
  }
  const ranked=[...found.values()].filter(g=>g.starts.length>=2).map(g=>({...g,score:(g.length-1)*(g.starts.length-1)})).sort((a,b)=>b.score-a.score||b.length-a.length||a.starts[0]-b.starts[0]);
  return ranked;
}

function boundaryCandidates(tokens,phrases) {
  const endOffsets=tokens.map(t=>0);let next=0;for(let i=tokens.length-1;i>=0;i--){if(tokens[i].end)next=i;endOffsets[i]=next-i;}
  const candidates=[];
  for(const p of phrases){
    if(p.starts.length<3)continue;
    const byOffset=new Map();
    for(const start of p.starts){const last=start+p.length-1,offset=endOffsets[last];if(offset>2)continue;const a=byOffset.get(offset)??[];a.push(last+offset+1);byOffset.set(offset,a);}
    for(const [offset,cuts] of byOffset){
      const distinct=[...new Set(cuts)];if(distinct.length<3)continue;
      let from=0;const units=[];for(const end of distinct){units.push({from,to:end,fromRef:tokens[from].ref,toRef:tokens[end-1].ref});from=end;}
      const coverage=from/tokens.length;
      candidates.push({keys:p.keys,lane:p.lane,offset,units,coverage,score:(p.length-1)*(distinct.length-1)*coverage,tail:from<tokens.length?{from,to:tokens.length,fromRef:tokens[from].ref,toRef:tokens.at(-1).ref}:null,anchorStarts:p.starts.filter(s=>endOffsets[s+p.length-1]===offset)});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||b.coverage-a.coverage||a.offset-b.offset);
  const seen=new Set();return candidates.filter(c=>{const k=c.units.map(u=>u.to).join(',');if(seen.has(k))return false;seen.add(k);return true;}).slice(0,5);
}

function gappedPatterns(tokens,phrases,units,lane='script') {
  const keys=tokens.map(t=>keyOf(t,lane)),groups=new Map(),unitAt=new Int32Array(tokens.length).fill(-1);
  units.forEach((u,i)=>{for(let j=u.from;j<u.to;j++)unitAt[j]=i;});
  for(const p of phrases){
    if(p.length!==2||p.starts.length<3)continue;
    for(const s of p.starts){
      if(unitAt[s]<0)continue;
      for(let t=s+2;t<Math.min(tokens.length,s+13);t++){
        if(tokens[t].verseId!==tokens[s].verseId||unitAt[t]!==unitAt[s])break;
        // Only lexical heads; exclude function-word targets using existing OSHB codes.
        if(!/(?:^H|\/)[NAV]/.test(tokens[t].grammar))continue;
        const id=JSON.stringify([...p.keys,keys[t]]),g=groups.get(id)??{keys:[...p.keys,keys[t]],lane,length:3,spans:[]};
        if(!g.spans.some(x=>x[0]===s))g.spans.push([s,t]);groups.set(id,g);
      }
    }
  }
  return [...groups.values()].filter(g=>new Set(g.spans.map(s=>unitAt[s[0]])).size>=3&&new Set(g.spans.map(([s,t])=>t-s)).size>=2);
}

function profileMotif(tokens,units,pattern) {
  const spans=pattern.spans??pattern.starts.map(s=>[s,s+pattern.length-1]);
  const matches=units.map(u=>spans.filter(([s,e])=>s>=u.from&&e<u.to));
  const counts=matches.map(a=>a.length),present=counts.filter(n=>n>0).length;
  if(present<Math.max(2,Math.ceil(units.length*.6)))return null;
  const sorted=counts.slice().sort((a,b)=>a-b),typical=sorted[Math.floor(sorted.length/2)];
  if(typical===0)return null;
  const evidence=matches.map(ms=>ms.map(([s,e])=>({ref:tokens[s].ref,start:tokens[s].pos,end:tokens[e].pos,wordIds:tokens.slice(s,e+1).map(t=>t.id),text:tokens.slice(s,e+1).map(t=>t.form).join(' '),next:tokens[e+1]?.verseId===tokens[e].verseId?{id:tokens[e+1].id,form:tokens[e+1].form,lemma:tokens[e+1].lemma}:null})));
  const deviations=[];
  for(let i=0;i<counts.length;i++){
    const peers=counts.filter((_,j)=>j!==i),support=peers.filter(n=>n===typical).length;
    if(counts[i]!==typical&&support>=2&&support/peers.length>=.6)deviations.push({unit:i,kind:counts[i]<typical?'count_omission':'count_addition',expected:typical,observed:counts[i],peerSupport:support/peers.length,surprisalBits:-Math.log2((peers.filter(n=>n===counts[i]).length+1)/(peers.length+3)),unitRange:[units[i].fromRef,units[i].toRef]});
  }
  const gapPenalty=pattern.spans?0.85:1;
  return {keys:pattern.keys,lane:pattern.lane,kind:pattern.spans?'bounded_gap':'contiguous',counts,typical,support:present/units.length,score:(pattern.length-1)*present*gapPenalty,deviations,evidence};
}

function reversePatterns(tokens) {
  const out=[];
  for(const lane of ['strict','strongs']){
    const keys=tokens.map(t=>keyOf(t,lane));
    for(let s=0;s<tokens.length;s++)for(let arm=2;arm<=8;arm++)for(let center=0;center<=2;center++){
      const end=s+2*arm+center;if(end>tokens.length||tokens[s].verseId!==tokens[end-1].verseId)continue;
      const left=keys.slice(s,s+arm),right=keys.slice(s+arm+center,end);
      if(new Set(left).size<2||left.some(k=>k.startsWith('unresolved:'))||!left.every((k,i)=>k===right[arm-1-i])||left.every((k,i)=>k===right[i]))continue;
      out.push({lane,kind:'candidate_literary_pattern',ref:tokens[s].ref,positions:[tokens[s].pos,tokens[end-1].pos],keys:left,pairs:left.map((k,i)=>({key:k,left:tokens[s+i].id,right:tokens[end-1-i].id})),text:tokens.slice(s,end).map(t=>t.form).join(' '),score:arm});
    }
  }
  return out.sort((a,b)=>b.score-a.score||Number(b.lane==='strict')-Number(a.lane==='strict')).slice(0,15);
}

function localWordplay(tokens) {
  const out=[],seen=new Set();
  const common=(a,b)=>{let best='';for(let i=0;i<a.length;i++)for(let j=i+2;j<=a.length;j++){const x=a.slice(i,j);if(x.length>best.length&&b.includes(x))best=x;}return best;};
  for(let i=0;i<tokens.length;i++)for(let j=i+1;j<Math.min(tokens.length,i+24);j++){
    const a=tokens[i],b=tokens[j];if(a.strongs===b.strongs||!a.script||!b.script||Math.min(a.script.length,b.script.length)<2||Math.max(a.script.length,b.script.length)>9)continue;
    if(!/(?:^H|\/)[NAV]/.test(a.grammar)||!/(?:^H|\/)[NAV]/.test(b.grammar))continue;
    const shared=common(a.script,b.script),ratio=shared.length/Math.max(a.script.length,b.script.length);
    if(shared.length<2||ratio<.65||Math.min(a.script.length,b.script.length)===2&&shared.length!==2)continue;
    const key=[a.strongs,b.strongs].sort().join('|');if(seen.has(key))continue;seen.add(key);
    out.push({kind:'orthographic_similarity_only',strongs:[a.strongs,b.strongs],lemmas:[a.lemma,b.lemma],shared,ids:[a.id,b.id],refs:[a.ref,b.ref],score:ratio+(a.script===b.script?1:0)-.01*(j-i)});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,20);
}

export function analyzeHebrewPassage(input) {
  const tokens=tokenize(input),broad=minePhrases(tokens,'strongs'),script=minePhrases(tokens,'script'),strict=minePhrases(tokens,'strict');
  const boundaries=boundaryCandidates(tokens,broad),best=boundaries[0]??null;
  const patterns=best?[...broad,...gappedPatterns(tokens,script,best.units)].map(p=>profileMotif(tokens,best.units,p)).filter(Boolean).sort((a,b)=>b.score-a.score):[];
  // Keep long forms plus divergent count profiles; avoid flooding output with nested ngrams.
  const selected=[];for(const p of patterns){if(selected.some(q=>q.lane===p.lane&&q.kind===p.kind&&q.keys.length>p.keys.length&&q.counts.join()===p.counts.join()&&q.keys.join('|').includes(p.keys.join('|'))))continue;selected.push(p);}
  const phrases=arr=>arr.slice(0,12).map(p=>({lane:p.lane,keys:p.keys,count:p.starts.length,text:tokens.slice(p.starts[0],p.starts[0]+p.length).map(t=>t.form).join(' '),refs:p.starts.map(i=>tokens[i].ref),occurrences:p.starts.map(i=>tokens.slice(i,i+p.length).map(t=>t.id))}));
  return {passage:input.passage,tokenCount:tokens.length,boundaries:boundaries.map(b=>({...b,anchorText:tokens.slice(b.anchorStarts[0],b.anchorStarts[0]+b.keys.length).map(t=>t.form).join(' ')})),motifs:selected.slice(0,35),phrases:phrases(broad),strictPhrases:phrases(strict),chiasms:reversePatterns(tokens),wordplay:localWordplay(tokens),limitations:['Strong’s matching is a broad lexical candidate, not homograph resolution.','Script matching is orthographic, not semantic equivalence.','Lexicon fallback is excluded from strict occurrence-key matching.','Unit boundaries use recurring near-verse-end phrases; unmatched tail is not automatically another unit.','Gapped candidates are within-verse and uncalibrated; no semantic/role frame extraction yet.']};
}
