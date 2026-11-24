// Passage-local literary discovery. Pure ESM; no runtime dependencies.
// Event keys and features must originate in a single corpus edition; see handoff.

function checkEvents(events, limit=256) {
  if (!Array.isArray(events) || events.length > limit) throw new RangeError('Literary event limit exceeded');
  const ids=new Set();
  for (const e of events) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id) || typeof e.key !== 'string' || !e.key || !Array.isArray(e.wordIds) || !e.wordIds.length || !Array.isArray(e.features) || e.features.length>32 || e.features.some(f=>typeof f!=='string') || e.wordIds.some(w=>typeof w!=='string'||!w)) throw new TypeError('Invalid or duplicate literary event');
    ids.add(e.id);
  }
}

function similarity(a,b) {
  if(a.key===b.key) return 1;
  const A=new Set(a.features),B=new Set(b.features);
  let shared=0,union=0;
  const weight=k=>k.startsWith('frame:')?1:k.startsWith('lemma:')?2:k.startsWith('role:')?1.5:0.5;
  for(const x of new Set([...A,...B])) {const w=weight(x); union+=w; if(A.has(x)&&B.has(x))shared+=w;}
  return union?shared/union:0;
}

export function alignSequences(a,b,local=false) {
  if(a.length>256||b.length>256)throw new RangeError('Alignment limit exceeded');
  const n=a.length,m=b.length,w=m+1,dp=new Float64Array((n+1)*w),trace=new Uint8Array(dp.length);
  const gap=-0.75;
  if(!local){for(let i=1;i<=n;i++){dp[i*w]=i*gap;trace[i*w]=2;}for(let j=1;j<=m;j++){dp[j]=j*gap;trace[j]=3;}}
  let best=0,bi=0,bj=0;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){
    const s=similarity(a[i-1],b[j-1]),k=i*w+j;
    const d=dp[k-w-1]+(s>=0.55?2*s:-1.1),u=dp[k-w]+gap,l=dp[k-1]+gap;
    let val=d,dir=1;if(u>val){val=u;dir=2;}if(l>val){val=l;dir=3;}if(local&&val<=0){val=0;dir=0;}
    dp[k]=val;trace[k]=dir;if(val>best){best=val;bi=i;bj=j;}
  }
  let i=local?bi:n,j=local?bj:m;const score=dp[i*w+j],pairs=[];
  while(i||j){const d=trace[i*w+j];if(!d)break;if(d===1){pairs.push({a:i-1,b:j-1,similarity:similarity(a[i-1],b[j-1])});i--;j--;}else if(d===2){pairs.push({a:i-1,b:null,similarity:0});i--;}else{pairs.push({a:null,b:j-1,similarity:0});j--;}}
  return {score,pairs:pairs.reverse()};
}

function representative(column) {
  const filled=column.filter(Boolean);
  return filled.reduce((best,e)=>{const quality=x=>filled.reduce((sum,y)=>sum+similarity(x,y),0);return quality(e)>quality(best)?e:best;});
}

export function induceTemplate(units) {
  if(units.length<2||units.length>32||units.some(u=>!u.length))throw new RangeError('Need 2–32 nonempty units');
  checkEvents(units.flat());
  const n=units.length;
  const scores=units.map((u,i)=>units.reduce((sum,v,j)=>sum+(i===j?0:alignSequences(u,v).score/Math.max(u.length,v.length)),0));
  const order=units.map((_,i)=>i).sort((a,b)=>scores[b]-scores[a]||a-b);
  let columns=units[order[0]].map(e=>{const c=Array(n).fill(null);c[order[0]]=e;return c;});
  for(const idx of order.slice(1)){
    const aligned=alignSequences(columns.map(representative),units[idx]);
    columns=aligned.pairs.map(p=>{const c=p.a===null?Array(n).fill(null):columns[p.a].slice();if(p.b!==null)c[idx]=units[idx][p.b];return c;});
  }
  const deviations=[],out=columns.map((c,index)=>{
    const rep=representative(c),count=c.filter(Boolean).length;
    for(let i=0;i<n;i++){
      const peers=c.filter((e,j)=>e&&j!==i),peerCount=peers.length,p=peerCount/(n-1),e=c[i];
      if(!e&&peerCount>=2&&p>=0.65)deviations.push({kind:'omission',unit:i,column:index,expected:representative(peers).key,observed:null,peerSupport:p,peerCount,surprisalBits:-Math.log2((n-peerCount)/(n+1)),witnessIds:peers.map(x=>x.id),beforeId:null});
      else if(e&&n>=3&&p<=0.34)deviations.push({kind:'addition',unit:i,column:index,expected:null,observed:e.key,peerSupport:p,peerCount,surprisalBits:-Math.log2((peerCount+1)/(n+1)),witnessIds:[e.id]});
      else if(e&&peerCount>=2){
        const ref=representative(peers),support=peers.filter(x=>x.key===ref.key).length;
        if(e.key!==ref.key&&support/(n-1)>=0.65)deviations.push({kind:'substitution',unit:i,column:index,expected:ref.key,observed:e.key,peerSupport:support/(n-1),peerCount:support,surprisalBits:-Math.log2((peers.filter(x=>x.key===e.key).length+1)/(n+1)),witnessIds:[e.id,...peers.filter(x=>x.key===ref.key).map(x=>x.id)]});
        if(e.key===ref.key){
          const matching=peers.filter(x=>x.key===e.key);
          if(matching.length>=2)for(const feature of new Set(e.features)){
            if(!feature.startsWith('modifier:'))continue;
            const hits=matching.filter(x=>x.features.includes(feature)).length;
            if(hits===0)deviations.push({kind:'feature_addition',unit:i,column:index,expected:e.key,observed:feature,peerSupport:matching.length/(n-1),peerCount:matching.length,surprisalBits:Math.log2(matching.length+2),witnessIds:[e.id,...matching.map(x=>x.id)]});
          }
        }
      }
    }
    return {index,key:rep.key,support:count/n,eventIds:c.map(e=>e?.id??null),alternatives:[...new Set(c.filter(Boolean).map(e=>e.key))]};
  });
  for(const d of deviations){if(d.kind==='omission'){const left=out.slice(0,d.column).reverse().find(c=>c.eventIds[d.unit]);const right=out.slice(d.column+1).find(c=>c.eventIds[d.unit]);d.beforeId=left?.eventIds[d.unit]??null;d.afterId=right?.eventIds[d.unit]??null;}}
  // A simple compression proxy, not a statistically calibrated MDL code.
  const explained=out.reduce((s,c)=>s+Math.max(0,c.eventIds.filter(Boolean).length-1),0);
  const gain=explained-out.length*0.35-deviations.length*0.5;
  return {unitEventIds:units.map(u=>u.map(e=>e.id)),columns:out,deviations:deviations.sort((a,b)=>b.surprisalBits-a.surprisalBits||a.unit-b.unit||a.column-b.column),compressionProxy:gain};
}

export function repeatedPhrases(events,options={}) {
  checkEvents(events);
  const maxLen=Math.max(2,Math.min(8,options.maxLen??6)),limit=Math.max(1,Math.min(100,options.limit??20)),found=[];
  for(let len=2;len<=maxLen;len++){
    const index=new Map();
    for(let i=0;i+len<=events.length;i++){
      const keys=events.slice(i,i+len).map(e=>e.key),key=JSON.stringify(keys);
      const group=index.get(key)??{keys,starts:[]};
      if(!group.starts.length||i>=group.starts[group.starts.length-1]+len)group.starts.push(i);
      index.set(key,group);
    }
    for(const g of index.values())if(g.starts.length>=2)found.push({keys:g.keys,starts:g.starts,occurrences:g.starts.map(i=>events.slice(i,i+len).map(e=>e.id)),score:len*(g.starts.length-1)});
  }
  found.sort((a,b)=>b.score-a.score||b.keys.length-a.keys.length||a.starts[0]-b.starts[0]);
  const out=[];
  for(const x of found){
    if(out.some(y=>y.keys.length>x.keys.length&&x.starts.every(s=>y.starts.some(t=>s>=t&&s+x.keys.length<=t+y.keys.length))))continue;
    out.push(x);if(out.length>=limit)break;
  }
  return out;
}

export function discoverTemplates(events,options={}) {
  checkEvents(events,160);
  const seeds=new Map();
  for(let len=1;len<=3;len++)for(let i=0;i+len<=events.length;i++){
    const keys=events.slice(i,i+len).map(e=>e.key),key=JSON.stringify(keys),g=seeds.get(key)??{keys,positions:[]};
    if(!g.positions.length||i>=g.positions[g.positions.length-1]+len)g.positions.push(i);
    seeds.set(key,g);
  }
  const ranked=[...seeds.values()].filter(g=>g.positions.length>=3&&g.positions.length<=31).sort((a,b)=>b.positions.length*b.keys.length-a.positions.length*a.keys.length||a.positions[0]-b.positions[0]).slice(0,16);
  const results=[],seen=new Set();
  for(const seed of ranked)for(const side of ['start','end']){
    const cuts=seed.positions.map(p=>p+(side==='end'?seed.keys.length:0));
    const boundaries=side==='end'?[0,...cuts]:[...cuts,events.length];
    const units=[];for(let j=1;j<boundaries.length;j++){const u=events.slice(boundaries[j-1],boundaries[j]);if(u.length)units.push(u);}
    if(units.length<3||units.some(u=>u.length<2||u.length>48))continue;
    const signature=JSON.stringify(units.map(u=>u.map(e=>e.id)));if(seen.has(signature))continue;seen.add(signature);
    const template=induceTemplate(units),core=template.columns.filter(c=>c.support>=0.65),distinct=new Set(core.map(c=>c.key)).size;
    if(distinct<2||template.compressionProxy<=0)continue;
    const coverage=units.reduce((s,u)=>s+u.length,0)/events.length;
    const omitted=side==='end'?events.slice(cuts[cuts.length-1]):events.slice(0,cuts[0]);
    const score=template.compressionProxy*coverage*(core.length/template.columns.length);
    results.push({...template,anchorKeys:seed.keys,anchorSide:side,coverage,score,unassignedEventIds:omitted.map(e=>e.id)});
  }
  return results.sort((a,b)=>b.score-a.score||b.coverage-a.coverage).slice(0,Math.max(1,Math.min(10,options.limit??5)));
}

export function discoverChiasms(events,options={}) {
  checkEvents(events,160);
  const out=[],minArm=2,maxArm=Math.max(2,Math.min(12,options.maxArm??8)),limit=Math.max(1,Math.min(50,options.limit??10));
  for(let start=0;start<events.length;start++)for(let arm=minArm;arm<=maxArm;arm++)for(let center=0;center<=2;center++){
    const right=start+arm+center,end=right+arm;if(end>events.length)continue;
    const pairs=[];let sum=0,forward=0;const distinct=new Set();
    for(let i=0;i<arm;i++){
      const a=events[start+i],b=events[end-1-i],s=similarity(a,b);
      if(s<0.55)break;
      pairs.push({leftId:a.id,rightId:b.id,similarity:s});sum+=s;forward+=similarity(a,events[right+i]);distinct.add(a.key);
    }
    if(pairs.length!==arm||distinct.size<2||sum-forward<0.5)continue;
    out.push({kind:'candidate_literary_pattern',start,endExclusive:end,pairs,centerIds:events.slice(start+arm,right).map(e=>e.id),reverseMean:sum/arm,forwardMean:forward/arm,score:sum-forward+arm*0.25});
  }
  return out.sort((a,b)=>b.score-a.score||a.start-b.start).slice(0,limit);
}
