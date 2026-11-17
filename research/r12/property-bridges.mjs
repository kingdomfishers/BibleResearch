/**
 * R12 OPTIONAL OFFLINE COMPILER HELPER, NOT A RUNTIME GRAPH ENGINE.
 * Generate bounded property-mediated research candidates using sourced assertions.
 * Input rows must already have biblical anchor identities and validated/candidate
 * external mappings. This never promotes external knowledge to biblical testimony.
 */
const sep = '\u001f';
const allowedMapping = new Set(['verified', 'candidate']);
const allowedClaims = new Set(['sourced', 'candidate']);
const genericKeys = new Set(['wikidata_id','pleiades_id','tipnr_id','modern_name','coordinates_lat_lon','identification_confidence']);
const required = ['anchor_id','property_key','value_id','source_id','provider','source_ref','license','release'];

function assertRow(row) {
  for (const key of required) {
    if (!row || typeof row[key] !== 'string' || !row[key]) {
      throw new TypeError('Missing assertion field: ' + key);
    }
  }
  if (!allowedMapping.has(row.mapping_status) || !allowedClaims.has(row.claim_status)) {
    throw new TypeError('Missing/invalid mapping_status or claim_status');
  }
  if (row.rights_status !== 'approved') throw new TypeError('Source rights must be explicitly approved');
  if (row.epistemic_layer && row.epistemic_layer !== 'EXTERNAL_WORLD') throw new TypeError('Expected EXTERNAL_WORLD');
  if (genericKeys.has(row.property_key)) return false;
  return true;
}
function propertyKey(row) {
  return row.property_key + sep + row.value_id;
}
function unpackPropertyKey(key) {
  const p = key.indexOf(sep);
  return {property_key:key.slice(0,p),value_id:key.slice(p+1)};
}
function scoreSource(row) {
  return (row.mapping_status === 'verified' ? 1 : 0.55) *
    (row.claim_status === 'sourced' ? 1 : 0.6);
}

export function buildPropertyIndex(assertions) {
  const byAnchor = new Map(), postings = new Map(), all = new Map();
  let accepted = 0, metadataSkipped = 0;
  for (const r of assertions) {
    if (!assertRow(r)) { metadataSkipped++; continue; }
    const key = propertyKey(r);
    const id = [r.anchor_id,key,r.provider,r.source_id].join(sep);
    if (all.has(id)) continue;
    const row = Object.freeze({...r, evidence_ids: Array.isArray(r.evidence_ids)?[...new Set(r.evidence_ids)]:[]});
    all.set(id,row);
    if (!byAnchor.has(r.anchor_id)) byAnchor.set(r.anchor_id,new Map());
    const ap = byAnchor.get(r.anchor_id);
    if (!ap.has(key)) ap.set(key,[]);
    ap.get(key).push(row);
    if (!postings.has(key)) postings.set(key,new Set());
    postings.get(key).add(r.anchor_id);
    accepted++;
  }
  return {byAnchor,postings,anchorCount:byAnchor.size,recordCount:accepted,metadataSkipped};
}

/**
 * Only a candidate lead, not proof. The same source claim seen from two exports
 * cannot be treated as independent biblical evidence. maxDfFraction suppresses
 * ubiquitous properties; tiny pilots can override maxDocumentFrequency.
 */
export function findPropertyBridges(index, anchorId, opts={}) {
  const features=index.byAnchor.get(anchorId);
  if (!features) return {anchor_id:anchorId,results:[],coverage:'unknown_anchor'};
  const maxPosting=opts.maxPosting??4000, maxCandidates=opts.maxCandidates??2000;
  const minShared=opts.minShared??1, limit=opts.limit??24;
  const dfLimit=opts.maxDocumentFrequency??Math.max(3,Math.ceil(index.anchorCount*(opts.maxDfFraction??0.05)));
  const matches=new Map();
  let denseSkipped=0, truncated=false;
  const seeds=[...features.keys()].sort((a,b)=>
    (index.postings.get(a)?.size??0)-(index.postings.get(b)?.size??0) || a.localeCompare(b));
  for(const key of seeds) {
    const targets=index.postings.get(key)??new Set();
    if(targets.size>dfLimit || targets.size>maxPosting){denseSkipped++;continue;}
    for(const id of [...targets].sort()) {
      if(id===anchorId) continue;
      if(!matches.has(id)&&matches.size>=maxCandidates){truncated=true;break;}
      if(!matches.has(id)) matches.set(id,new Set());
      matches.get(id).add(key);
    }
    if(truncated) break;
  }
  const results=[];
  for(const [targetId,keys] of matches) {
    if(keys.size<minShared)continue;
    const target=index.byAnchor.get(targetId);
    let weighted=0,weightLimit=0;
    const witnesses=[];
    for(const key of [...keys].sort()){
      const df=index.postings.get(key).size;
      const rarity=Math.min(6,1+Math.log((index.anchorCount+1)/(df+1)));
      const a=features.get(key),b=target.get(key);
      const left=Math.max(...a.map(scoreSource)),right=Math.max(...b.map(scoreSource));
      weighted+=rarity*Math.min(left,right);
      weightLimit+=rarity;
      // Do not combine opposite edge directions into a fabricated single source claim.
      witnesses.push({
        feature:unpackPropertyKey(key),rarity:Number(rarity.toFixed(6)),
        left:a.map(x=>({provider:x.provider,source_id:x.source_id,source_ref:x.source_ref,release:x.release,license:x.license,mapping_status:x.mapping_status,claim_status:x.claim_status,source_lineage:x.source_lineage??x.source_id})),
        right:b.map(x=>({provider:x.provider,source_id:x.source_id,source_ref:x.source_ref,release:x.release,license:x.license,mapping_status:x.mapping_status,claim_status:x.claim_status,source_lineage:x.source_lineage??x.source_id})),
      });
    }
    const score= Math.min(1,weighted/(weightLimit||1))*
      Math.min(1,0.5+0.2*keys.size); // uncalibrated interest heuristic, not probability
    results.push({
      anchor_id:anchorId,target_id:targetId,
      relation_type:'SHARES_EXTERNAL_PROPERTY',
      epistemic_layer:'HYPOTHESIS',
      independent_biblical_support:0,
      shared_features:witnesses,
      score:Number(score.toFixed(6)),
      limitation:'Shared externally sourced properties are research leads, not biblical identifications or authorial intent.',
    });
  }
  results.sort((a,b)=>b.score-a.score || b.shared_features.length-a.shared_features.length || a.target_id.localeCompare(b.target_id));
  return {anchor_id:anchorId,results:results.slice(0,limit),coverage:(denseSkipped||truncated||results.length>limit)?'bounded_partial':'complete_for_index',
    diagnostics:{indexed_anchors:index.anchorCount,indexed_claims:index.recordCount,metadata_skipped:index.metadataSkipped,posting_buckets_skipped:denseSkipped,candidate_targets:matches.size,matches_total:results.length,pool_truncated:truncated}};
}
