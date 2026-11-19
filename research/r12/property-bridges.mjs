/**
 * R12 OPTIONAL OFFLINE COMPILER HELPER, NOT A RUNTIME GRAPH ENGINE.
 * Generate bounded property-mediated research candidates using sourced assertions.
 * Input rows must already have biblical anchor identities and validated/candidate
 * external mappings. This never promotes external knowledge to biblical testimony.
 */
const sep = '\u001f';
const allowedMapping = new Set(['verified', 'candidate']);
const allowedClaims = new Set(['sourced', 'candidate']);
const genericKeys = new Set(['wikidata_id', 'pleiades_id', 'tipnr_id', 'modern_name', 'coordinates_lat_lon', 'identification_confidence']);
const required = ['anchor_id', 'property_key', 'value_id', 'source_id', 'provider', 'source_ref', 'license', 'release'];
const WD_PROP_RE = /^wd:P\d+$/;
const WD_GUID_RE = /^[Qq]\d+\$[0-9a-fA-F-]+$/;
const ORIGIN_PRIORITY = [
  'ORIGINAL_WIKIDATA_STATEMENT',
  'ORIGINAL_OEWN_RELATION',
  'DERIVED_OEWN_HYPERNYM_L2',
  'DERIVED_PHYSICAL_ASSERTION',
];

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
  if (row.provider === 'Wikidata') {
    if (!WD_PROP_RE.test(row.property_key)) {
      throw new TypeError(`Invalid Wikidata property_key: ${row.property_key}`);
    }
    if (!WD_GUID_RE.test(row.source_id)) {
      throw new TypeError(`Invalid Wikidata statement GUID source_id: ${row.source_id}`);
    }
  }
  return true;
}

function propertyKey(row) {
  return row.property_key + sep + row.value_id;
}

function unpackPropertyKey(key) {
  const p = key.indexOf(sep);
  return { property_key: key.slice(0, p), value_id: key.slice(p + 1) };
}

function scoreSource(row) {
  return (row.mapping_status === 'verified' ? 1 : 0.55) *
    (row.claim_status === 'sourced' ? 1 : 0.6);
}

function inferOrigin(row) {
  if (typeof row.assertion_origin === 'string' && row.assertion_origin) {
    return row.assertion_origin;
  }
  if (row.provider === 'Wikidata') return 'ORIGINAL_WIKIDATA_STATEMENT';
  if (row.provider === 'OpenEnglishWordNet') return 'ORIGINAL_OEWN_RELATION';
  return 'EXTERNAL_ASSERTION';
}

function packWitnessSide(x) {
  return {
    provider: x.provider,
    source_id: x.source_id,
    source_ref: x.source_ref,
    release: x.release,
    license: x.license,
    mapping_status: x.mapping_status,
    claim_status: x.claim_status,
    source_lineage: x.source_lineage ?? x.source_id,
    ...(x.external_id ? { external_id: x.external_id } : {}),
    ...(x.assertion_origin ? { assertion_origin: x.assertion_origin } : {}),
    ...(x.derivation_basis ? { derivation_basis: x.derivation_basis } : {}),
  };
}

export function buildPropertyIndex(assertions) {
  const bySense = new Map();
  const byAnchor = new Map();
  const senseToAnchor = new Map();
  const anchorToSenses = new Map();
  const postings = new Map();
  const all = new Map();
  let accepted = 0, metadataSkipped = 0;

  for (const r of assertions) {
    if (!assertRow(r)) { metadataSkipped++; continue; }
    const senseKey = r.sense_id || r.anchor_id;
    const key = propertyKey(r);
    const id = [r.anchor_id, senseKey, key, r.provider, r.source_id].join(sep);
    if (all.has(id)) continue;
    const row = Object.freeze({
      ...r,
      sense_key: senseKey,
      evidence_ids: Array.isArray(r.evidence_ids) ? [...new Set(r.evidence_ids)] : [],
    });
    all.set(id, row);

    if (!bySense.has(senseKey)) bySense.set(senseKey, new Map());
    const sp = bySense.get(senseKey);
    if (!sp.has(key)) sp.set(key, []);
    sp.get(key).push(row);

    senseToAnchor.set(senseKey, r.anchor_id);
    if (!anchorToSenses.has(r.anchor_id)) anchorToSenses.set(r.anchor_id, new Set());
    anchorToSenses.get(r.anchor_id).add(senseKey);

    if (!byAnchor.has(r.anchor_id)) byAnchor.set(r.anchor_id, new Map());
    const ap = byAnchor.get(r.anchor_id);
    if (!ap.has(key)) ap.set(key, []);
    ap.get(key).push(row);

    if (!postings.has(key)) postings.set(key, new Set());
    postings.get(key).add(senseKey);
    accepted++;
  }

  return {
    bySense,
    byAnchor,
    senseToAnchor,
    anchorToSenses,
    postings,
    anchorCount: bySense.size,
    senseCount: bySense.size,
    canonicalAnchorCount: byAnchor.size,
    recordCount: accepted,
    metadataSkipped,
  };
}

/**
 * Only a candidate lead, not proof. The same source claim seen from two exports
 * cannot be treated as independent biblical evidence. maxDfFraction suppresses
 * ubiquitous properties; tiny pilots can override maxDocumentFrequency.
 */
export function findPropertyBridges(index, anchorOrSenseId, opts = {}) {
  let senseKeys;
  let queryAnchorId;
  if (index.bySense?.has(anchorOrSenseId)) {
    senseKeys = [anchorOrSenseId];
    queryAnchorId = index.senseToAnchor.get(anchorOrSenseId) ?? anchorOrSenseId;
  } else if (index.anchorToSenses?.has(anchorOrSenseId)) {
    senseKeys = [...index.anchorToSenses.get(anchorOrSenseId)].sort();
    queryAnchorId = anchorOrSenseId;
  } else {
    return { anchor_id: anchorOrSenseId, results: [], coverage: 'unknown_anchor' };
  }

  const maxPosting = opts.maxPosting ?? 4000;
  const maxCandidates = opts.maxCandidates ?? 2000;
  const minShared = opts.minShared ?? 1;
  const limit = opts.limit ?? 24;
  const dfLimit = opts.maxDocumentFrequency ?? Math.max(3, Math.ceil(index.anchorCount * (opts.maxDfFraction ?? 0.05)));

  const results = [];
  const seenPairs = new Set();
  const allCandidateTargets = new Set();
  let denseSkipped = 0;
  let truncated = false;

  for (const anchorSenseId of senseKeys) {
    const features = index.bySense.get(anchorSenseId);
    if (!features) continue;
    const canonicalAnchorId = index.senseToAnchor.get(anchorSenseId) ?? queryAnchorId;
    const matches = new Map();

    const seeds = [...features.keys()].sort((a, b) =>
      (index.postings.get(a)?.size ?? 0) - (index.postings.get(b)?.size ?? 0) || a.localeCompare(b));

    for (const key of seeds) {
      const targets = index.postings.get(key) ?? new Set();
      if (targets.size > dfLimit || targets.size > maxPosting) { denseSkipped++; continue; }
      for (const targetSenseId of [...targets].sort()) {
        if (targetSenseId === anchorSenseId) continue;
        const targetAnchorId = index.senseToAnchor.get(targetSenseId) ?? targetSenseId;
        if (targetAnchorId === canonicalAnchorId) continue;
        if (!matches.has(targetSenseId) && matches.size >= maxCandidates) { truncated = true; break; }
        if (!matches.has(targetSenseId)) matches.set(targetSenseId, new Set());
        matches.get(targetSenseId).add(key);
        allCandidateTargets.add(targetSenseId);
      }
      if (truncated) break;
    }

    for (const [targetSenseId, keys] of matches) {
      if (keys.size < minShared) continue;
      const pairKey = anchorSenseId + sep + targetSenseId;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const targetAnchorId = index.senseToAnchor.get(targetSenseId) ?? targetSenseId;
      const target = index.bySense.get(targetSenseId);
      let weighted = 0, weightLimit = 0;
      let hasConceptEquivalence = false;
      const originSet = new Set();
      const witnesses = [];

      for (const key of [...keys].sort()) {
        const df = index.postings.get(key).size;
        const rarity = Math.min(6, 1 + Math.log((index.anchorCount + 1) / (df + 1)));
        const a = features.get(key);
        const b = target.get(key);
        const left = Math.max(...a.map(scoreSource));
        const right = Math.max(...b.map(scoreSource));
        weighted += rarity * Math.min(left, right);
        weightLimit += rarity;

        for (const x of a) {
          originSet.add(inferOrigin(x));
          if (x.external_id && b.some((y) => y.external_id && y.external_id === x.external_id)) {
            hasConceptEquivalence = true;
          }
        }
        for (const y of b) {
          originSet.add(inferOrigin(y));
        }

        // Do not combine opposite edge directions into a fabricated single source claim.
        witnesses.push({
          feature: unpackPropertyKey(key),
          rarity: Number(rarity.toFixed(6)),
          left: a.map(packWitnessSide),
          right: b.map(packWitnessSide),
        });
      }

      const origins = [...originSet].sort((x, y) => {
        const ix = ORIGIN_PRIORITY.indexOf(x);
        const iy = ORIGIN_PRIORITY.indexOf(y);
        return (ix === -1 ? 999 : ix) - (iy === -1 ? 999 : iy) || x.localeCompare(y);
      });
      const score = Math.min(1, weighted / (weightLimit || 1)) *
        Math.min(1, 0.5 + 0.2 * keys.size); // uncalibrated interest heuristic, not probability

      results.push({
        anchor_id: canonicalAnchorId,
        anchor_sense_id: anchorSenseId,
        target_id: targetAnchorId,
        target_sense_id: targetSenseId,
        relation_type: 'SHARES_EXTERNAL_PROPERTY',
        bridge_kind: hasConceptEquivalence ? 'external_concept_equivalence' : 'shared_external_property',
        assertion_origin: origins[0] || 'EXTERNAL_ASSERTION',
        assertion_origins: origins,
        epistemic_layer: 'HYPOTHESIS',
        independent_biblical_support: 0,
        shared_features: witnesses,
        score: Number(score.toFixed(6)),
        limitation: 'Shared externally sourced properties are research leads, not biblical identifications or authorial intent.',
      });
    }
  }

  results.sort((a, b) =>
    b.score - a.score ||
    b.shared_features.length - a.shared_features.length ||
    a.target_id.localeCompare(b.target_id) ||
    a.anchor_sense_id.localeCompare(b.anchor_sense_id) ||
    a.target_sense_id.localeCompare(b.target_sense_id));

  return {
    anchor_id: queryAnchorId,
    results: results.slice(0, limit),
    coverage: (denseSkipped || truncated || results.length > limit) ? 'bounded_partial' : 'complete_for_index',
    diagnostics: {
      indexed_anchors: index.anchorCount,
      indexed_claims: index.recordCount,
      metadata_skipped: index.metadataSkipped,
      posting_buckets_skipped: denseSkipped,
      candidate_targets: allCandidateTargets.size,
      matches_total: results.length,
      pool_truncated: truncated,
    },
  };
}
