/**
 * R12 optional offline helper: scene similarity via typed rare-feature postings.
 * Candidate patterns are *not* authorial intentions or identity claims.
 * Standalone; integrate as a pass of the existing offline builder.
 */
const UNKNOWN = new Set(['', 'UNKNOWN', 'UNRESOLVED', '?']);
function keyOf(f) {
  if (!f || typeof f.role !== 'string' || typeof f.value !== 'string' || UNKNOWN.has(f.value)) return null;
  return f.role + '\u0000' + f.value;
}
function readable(key) {
  const [role, value] = key.split('\u0000');
  return { role, value };
}
export function buildStructuralIndex(scenes) {
  const byId = new Map(), posting = new Map();
  for (const scene of scenes) {
    if (!scene?.id || byId.has(scene.id) || !Array.isArray(scene.features)) throw new TypeError('Scene needs unique ID and features');
    const features = new Set(scene.features.map(keyOf).filter(Boolean));
    const row = {
      id: scene.id, lineage_id: scene.lineage_id ?? scene.id,
      witness_ids: Array.isArray(scene.witness_ids) ? scene.witness_ids.slice() : [], features,
    };
    byId.set(row.id, row);
    for (const f of features) {
      if (!posting.has(f)) posting.set(f, []);
      posting.get(f).push(scene.id);
    }
  }
  for (const ids of posting.values()) ids.sort();
  return { byId, posting, count: byId.size };
}
function featureWeight(index, key) {
  const df = index.posting.get(key)?.length ?? 0;
  return Math.min(6, 1 + Math.log((index.count + 1) / (df + 1)));
}
export function findStructuralCandidates(index, anchorId, options = {}) {
  const anchor = index.byId.get(anchorId);
  if (!anchor) return { anchor_id: anchorId, results: [], coverage: 'unknown_anchor' };
  const maxPostingSize = options.maxPostingSize ?? 4000;
  const maxCandidates = options.maxCandidates ?? 4000;
  const maxPerScene = options.maxPerScene ?? 64;
  const minSharedFeatures = options.minSharedFeatures ?? 2;
  const minWeightedJaccard = options.minWeightedJaccard ?? 0.25;
  // Small pilot allowance; in a large corpus this is a 5% nominal frequency ceiling.
  const informativeDfCutoff = Math.max(3, Math.ceil(index.count * (options.maxDfFraction ?? 0.05)));
  const groups = [...anchor.features].map(key => ({ key, ids: index.posting.get(key) ?? [] }))
    .filter(g => g.ids.length <= informativeDfCutoff)
    .sort((a, b) => a.ids.length - b.ids.length || a.key.localeCompare(b.key));
  const shared = new Map();
  let skippedDense = 0, truncatedPool = false;
  for (const group of groups) {
    if (group.ids.length > maxPostingSize) { skippedDense++; continue; }
    for (const id of group.ids) {
      if (id === anchorId) continue;
      const row = index.byId.get(id);
      if (!row || row.lineage_id === anchor.lineage_id) continue;
      if (!shared.has(id) && shared.size >= maxCandidates) { truncatedPool = true; break; }
      if (!shared.has(id)) shared.set(id, new Set());
      shared.get(id).add(group.key);
    }
    if (truncatedPool) break;
  }
  const results = [];
  for (const [id, commonKeys] of shared) {
    if (commonKeys.size < minSharedFeatures) continue;
    const row = index.byId.get(id);
    const union = new Set([...anchor.features, ...row.features]);
    const intersection = new Set([...anchor.features].filter(k => row.features.has(k)));
    const num = [...intersection].reduce((s, k) => s + featureWeight(index, k), 0);
    const den = [...union].reduce((s, k) => s + featureWeight(index, k), 0);
    const score = den > 0 ? num / den : 0;
    if (score < minWeightedJaccard) continue;
    results.push({
      anchor_scene_id: anchorId, candidate_scene_id: id,
      relation_type: 'SHARES_STRUCTURAL_PATTERN', epistemic_layer: 'HYPOTHESIS',
      weighted_jaccard: Number(score.toFixed(6)),
      distinctive_shared_features: [...commonKeys].sort().map(readable),
      all_shared_feature_count: intersection.size,
      anchor_witness_ids: anchor.witness_ids,
      candidate_witness_ids: row.witness_ids,
      limitation: 'Similar scene roles are candidate parallels, not proof of authorial intention or shared referents.',
    });
  }
  results.sort((a, b) => b.weighted_jaccard - a.weighted_jaccard || a.candidate_scene_id.localeCompare(b.candidate_scene_id));
  return {
    anchor_id: anchorId, results: results.slice(0, maxPerScene),
    coverage: (skippedDense || truncatedPool || results.length > maxPerScene) ? 'bounded_partial' : 'complete_for_index',
    diagnostics: { indexed_scenes: index.count, informative_features: groups.length, candidate_pool: shared.size, skipped_dense_postings: skippedDense, pool_truncated: truncatedPool, matching_results: results.length },
  };
}
