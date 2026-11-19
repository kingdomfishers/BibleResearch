/**
 * R10 Biblical Concept, Motif & Typology Discovery Runtime Engine
 * Upgraded to power Universal R11 Discovery Engine (`r11-v1.0`).
 * Runs identically in Cloudflare Workers (via AssetReader) and Node.js tests.
 * Two-stage bounded execution:
 *   Stage 1: Parse NL / concept lists / refs -> resolve original-language & motif/event candidates
 *   Stage 1.5: Parallel bounded profile loading from sharded `lemma-profiles`
 *   Stage 2: Universal evidence synthesis, dynamic clusters, grammatical relations, LXX bridges,
 *            lexical formations, cross-references, multi-concept intersections, complete occurrence pagination.
 */

import { fnv1a64Hex, computeBucketHex } from './adjacency-loader.ts';
import type { AssetReader } from './adjacency-loader.ts';
import type {
  ConnectionEvidenceResult,
  DiscoverConnectionsQuery,
  DiscoverConnectionsResult,
  ExpandConnectionResult,
  R10Cluster,
  R10ClusterBridge,
  R10ConnectionPath,
  R10ConnectionSummary,
  R10ControlOrWarning,
  R10EpistemicClass,
  R10EvidenceRecord,
  R10EvidenceTier,
  R10Node,
  R10NumberKind,
  R10OriginalWordRef,
  R10PassageRef,
  R10Predicate,
  R10ResolvedConcept,
} from './r10-types.ts';

export const DEFAULT_R10_RELEASE = 'r11-v1.0';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_SUBREQUEST_BUDGET = 45;
const MAX_EVIDENCE_BOOKS = 8;

const BOOK_VID_STARTS = [
  1, 1534, 2747, 3606, 4894, 5853, 6511, 7129, 7214, 8024,
  8719, 9535, 10254, 11196, 12018, 12298, 12704, 12871, 13941, 16518,
  17433, 17655, 17772, 19064, 20428, 20582, 21855, 22212, 22409, 22482,
  22628, 22649, 22697, 22802, 22849, 22905, 22958, 22996, 23207, 23262,
  24330, 25003, 26152, 27030, 28033, 28465, 28902, 29158, 29307, 29462,
  29566, 29661, 29750, 29797, 29910, 29993, 30039, 30064, 30367, 30475,
  30580, 30641, 30746, 30759, 30774, 30799,
];

function bookForVid(vid: number): number {
  if (vid < 1) return 1;
  for (let i = BOOK_VID_STARTS.length - 1; i >= 0; i--) {
    if (vid >= BOOK_VID_STARTS[i]) return i + 1;
  }
  return 1;
}

const TIER_BASE_SCORE: Record<R10EvidenceTier, number> = {
  1: 950,
  2: 860,
  3: 760,
  4: 650,
  5: 520,
  6: 380,
  7: 240,
  8: 140,
};

const QUERY_STOPWORDS = new Set([
  'how', 'do', 'does', 'did', 'what', 'which', 'who', 'where', 'when', 'why',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'into', 'on', 'upon',
  'with', 'between', 'from', 'for', 'by', 'as', 'at', 'through', 'about',
  'there', 'this', 'that', 'these', 'those', 'their', 'his', 'her', 'its',
  'connect', 'connects', 'connected', 'connection', 'connections', 'related',
  'relationship', 'relationships', 'link', 'links', 'find', 'show', 'explain',
  'compare', 'mean', 'meaning', 'significance', 'symbol', 'symbolism',
  'crossing', 'biblical', 'bible', 'scripture', 'verse', 'verses', 'passage',
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  ten: 10, twelve: 12, forty: 40, seventy: 70,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '10': 10, '12': 12, '40': 40, '70': 70,
};

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const NUMBER_PHRASE_RE = new RegExp(
  `\\b(?:${Object.keys(SMALL_NUMBERS).join('|')}|hundred|thousand)(?:(?:[ -]+)(?:${Object.keys(SMALL_NUMBERS).join('|')}|hundred|thousand))*\\b`,
  'gi'
);

function normalizeNumberPhrases(text: string): string {
  if (!text || !/[a-z]/i.test(text) || /^[HG]\d+[A-Z]?$/i.test(text.trim())) return text;
  return text.replace(NUMBER_PHRASE_RE, phrase => {
    if (!/[ -]/.test(phrase) && phrase.toLowerCase() in SMALL_NUMBERS) return phrase;
    let total = 0, group = 0;
    for (const token of phrase.toLowerCase().split(/[ -]+/)) {
      if (token === 'hundred') group = (group || 1) * 100;
      else if (token === 'thousand') { total += (group || 1) * 1000; group = 0; }
      else group += SMALL_NUMBERS[token];
    }
    return String(total + group);
  });
}

function normalizeToken(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\u0590-\u05ff\u0370-\u03ff]+/g, ' ')
    .trim();
}

function stripPossessive(w: string): string {
  if (w.length > 4 && w.endsWith('s')) {
    return w;
  }
  return w;
}

function getSingularForm(word: string): string | null {
  const w = word.toLowerCase();
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && w.length > 4) {
    if (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes') || w.endsWith('sses')) {
      return w.slice(0, -2);
    }
    return w.slice(0, -1);
  }
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
    return w.slice(0, -1);
  }
  return null;
}

const PRONOUN_OR_FUNC_STRONGS = new Set([
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834',
  'H1931', 'H0859', 'H0589', 'H0595', 'H2088', 'H2063', 'H0428',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473',
  'G4771', 'G3778', 'G3739', 'G5100', 'G5101', 'G1438',
]);

const GENERIC_LIGHT_VERB_STRONGS = new Set([
  'H0559', 'H1696', 'H6213', 'H1961', 'H0935', 'H5414', 'H1980', 'H7200', 'H3947', 'H3318',
  'G3004', 'G1096', 'G4160', 'G2192', 'G2064', 'G1510', 'G2036',
]);

const COMPOUND_MAGNITUDE_STRONGS = new Set([
  'H3967', 'H0505', 'H6240', 'H7239', 'G1540', 'G5507',
]);

const SMALL_NUMERAL_STRONGS = new Set([
  'H0259', 'H8147', 'H7969', 'H0702', 'H2568', 'H8337', 'H7651', 'H8083', 'H8672', 'H6235',
  'G1520', 'G1417', 'G5140', 'G5064', 'G4002', 'G1803', 'G2033', 'G1176', 'G1427',
]);

const QUERY_FALLBACK_ALIAS_MAP: Record<string, string[]> = {
  yeast: ['leaven'],
  resurrection: ['resurrect', 'rise', 'raise'],
  resurrected: ['resurrect', 'rise'],
  resurrecting: ['resurrect', 'rise'],
  menorah: ['lampstand'],
  redemption: ['redeem'],
  atonement: ['atone'],
  propitiation: ['mercy seat'],
};

function getMorphStems(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  if (w.endsWith('ing') && w.length > 5) {
    const base = w.slice(0, -3);
    out.push(base, base + 'e');
  } else if (w.endsWith('ed') && w.length > 4) {
    const base = w.slice(0, -2);
    out.push(base, base + 'e');
  } else if (w.endsWith('ation') && w.length > 7) {
    const base = w.slice(0, -5);
    out.push(base, base + 'e');
  } else if (w.endsWith('er') && w.length > 4) {
    out.push(w.slice(0, -2));
  } else if (w.endsWith('ly') && w.length > 4) {
    out.push(w.slice(0, -2));
  }
  return out.filter((s) => s.length >= 3);
}

function confidenceFromRecord(r: R10EvidenceRecord): R10ConnectionSummary['confidence_label'] {
  if (r.predicate === 'explicit_identification' || r.predicate === 'explicit_comparison' || r.predicate === 'typological_interpretation' || r.predicate === 'direct_quotation' || r.predicate === 'authorial_interpretation') {
    return r.evidence_tier <= 2 ? 'explicit_textual' : 'strong_correspondence';
  }
  if (r.predicate === 'literary_correspondence' || r.predicate === 'cross_reference_witness' || r.predicate === 'multihop_proof_path') return 'strong_correspondence';
  if (r.predicate === 'verified_lexical_grammatical' || r.predicate === 'cross_language_bridge' || r.predicate === 'orthographic_wordplay') return 'lexical_reference';
  if (r.predicate === 'literary_pattern' || r.predicate === 'structural_scene_parallel' || r.predicate === 'shared_external_property') return 'candidate_pattern';
  if (r.predicate === 'orthographic_overlap') return 'orthographic_only';
  if (r.predicate === 'interpretive_hypothesis') return 'interpretive';
  return 'moderate_motif';
}

function defaultUncertainty(r: R10EvidenceRecord): string {
  if (r.predicate === 'explicit_identification') return 'Directly stated in text; keep separate from other passages with distinct referents.';
  if (r.predicate === 'typological_interpretation' || r.predicate === 'explicit_comparison') return 'Explicit NT authorial comparison; separates historical OT narrative from later NT theological interpretation.';
  if (r.predicate === 'authorial_interpretation') return 'Explicit biblical narrator/author gloss; intertextual OT echoes remain secondary.';
  if (r.predicate === 'verified_lexical_grammatical' || r.predicate === 'cross_language_bridge') return 'Documented original-language lexical/translation fact; context governs which sense applies per verse.';
  if (r.predicate === 'multihop_proof_path') return '2-5 hop attested discovery path; individual steps are source-backed, but a path never proves endpoint identity or authorial intent.';
  if (r.predicate === 'shared_external_property') return 'Externally sourced physical/semantic property bridge (OEWN 2025 / Wikidata); exploratory hypothesis only (independent_biblical_support=0).';
  if (r.predicate === 'structural_scene_parallel') return 'At-tested R8 structural clause role parallel; candidate hypothesis only, not proof of literary dependence.';
  if (r.predicate === 'literary_correspondence' || r.predicate === 'cross_reference_witness') return 'Cross-reference / lexical correspondence; shared motif or anchor does not alone prove direct citation.';
  if (r.predicate === 'orthographic_overlap') return 'Spelling/consonantal overlap ONLY; does NOT establish a shared etymological root.';
  if (r.predicate === 'literary_pattern') return 'Candidate literary/structural pattern; interpretive synthesis beyond explicit text links.';
  if (r.predicate === 'numbered_entity') return 'Co-occurring counted entity; verify object identity vs coincidental shared number.';
  return 'Shared biblical motif across passages; contextual differences preserved.';
}

export async function decodeB64Gz<T = any>(
  reader: AssetReader,
  b64: string,
  cacheKey?: string,
  localCache?: Map<string, any>,
): Promise<T> {
  const memoKey = cacheKey || b64;
  if (localCache?.has(memoKey)) return localCache.get(memoKey) as T;
  let val: T;
  if (typeof reader.decodeB64GzJson === 'function') {
    val = await reader.decodeB64GzJson<T>(b64, cacheKey);
  } else {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const isGz = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGz) {
      val = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).json() as T;
    } else {
      val = JSON.parse(new TextDecoder('utf-8').decode(bytes)) as T;
    }
  }
  localCache?.set(memoKey, val);
  return val;
}

async function readR10Json<T = any>(
  reader: AssetReader,
  releaseId: string,
  relPath: string,
  budget: ReadBudget
): Promise<T | null> {
  budget.pages ||= new Map();
  if (budget.pages.has(relPath)) return budget.pages.get(relPath)!;
  if (budget.used >= budget.max) { budget.missing?.push(`budget:${relPath}`); return null; }
  budget.used++;
  const fullPath = `/v2/relationships/${releaseId}/r10/${relPath}`;
  const pending = reader.readJson(fullPath).then(res => {
    if (!res) {
      budget.missing?.push(fullPath);
      // Missing R11 fast metadata never grants permission for a legacy book scan.
      // Explicit older release IDs retain their original reader contract.
      if (relPath === 'fast-manifest.json.gz' && releaseId === DEFAULT_R10_RELEASE) return { selective: true, profile_buckets: 1024, verse_chunk_size: 64 };
      return null;
    }
    // Quarantine unverified legacy window-based copula records on every access.
    if (relPath === 'explicit-and-typology.json.gz') {
      const data = res.data as { records?: Array<{ evidence_id?: string }> };
      if ((data.records || []).some(r => r.evidence_id?.startsWith('r10:ident:auto:'))) {
        return { ...data, records: (data.records || []).filter(r => !r.evidence_id?.startsWith('r10:ident:auto:')) };
      }
      return res.data;
    }
    return res.data;
  });
  budget.pages.set(relPath, pending);
  return (await pending) as T | null;
}

interface FastManifest {
  profile_buckets: number;
  verse_chunk_size: number;
  lookup_buckets?: number;
  lookup_sub_buckets?: number;
  selective?: boolean;
  packed?: boolean;
  direct_b64gz?: boolean;
  r12_pilot?: string;
  r12_version?: string;
  r12_pilot_anchors?: number;
  r12_pilot_embedded?: boolean;
  r12_score_version?: string;
  r12_pilot_anchors_list?: string[];
  r12_external_sources?: Array<{ id: string; provider: string; release: string; license: string; archive_sha256?: string; extract_sha256?: string }>;
  r12_external_mappings?: Array<Record<string, any>>;
  strongs_lookup_upper_bucket?: boolean;
  motifs_event_keywords?: string[];
  verse_xrefs_embedded?: boolean;
  verse_events_embedded?: boolean;
}
type ReadBudget = { used: number; max: number; missing?: string[]; pages?: Map<string, Promise<any>>; b64Cache?: Map<string, any> };

interface MotifsData {
  schema_version?: string | number;
  motifs: Record<string, any>;
  motif_pairs?: Record<string, any>;
  motif_pairs_b64gz?: string;
  events?: any[];
  events_b64gz?: string;
  event_keywords?: string[];
  event_seq?: Record<string, { prev: string | null; next: string | null; title: string; start_date?: string | null; sample_vids?: number[] }>;
  event_by_chapter?: Record<string, string[]>;
}

interface R12PilotBundle {
  schema_version: number;
  release_id: string;
  score_version: string;
  pilot_anchors: string[];
  external_sources?: Array<{ id: string; provider: string; release: string; license: string; archive_sha256?: string; extract_sha256?: string }>;
  external_mappings?: Array<Record<string, any>>;
  anchors: Record<string, any>;
}

async function readR12Pilot(
  reader: AssetReader,
  releaseId: string,
  manifest: FastManifest | null | undefined,
  budget: ReadBudget,
): Promise<R12PilotBundle | null> {
  const pilotRel = manifest?.r12_pilot || 'r12-pilot.json.gz';
  return readR10Json<R12PilotBundle>(reader, releaseId, pilotRel, budget);
}

function r12MultihopRecToRecord(anchorData: any, rec: any): R10EvidenceRecord {
  const best = rec.best_path || {};
  const steps: any[] = best.steps || [];
  const tWord = rec.target_word || best.target_word;
  const passages: R10PassageRef[] = [];
  const seenVid = new Set<number>();
  const pushPassage = (p: any) => {
    if (!p?.ref) return;
    const vid = Number(p.verse_id || 0);
    if (vid && seenVid.has(vid)) return;
    seenVid.add(vid || passages.length + 1);
    passages.push({
      verse_id: vid,
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    });
  };
  for (const p of rec.direct_endpoint_witnesses || []) pushPassage(p);
  for (const p of rec.endpoint_bridge_witnesses || []) pushPassage(p);
  for (const st of steps) {
    for (const p of st.witness_passages || []) pushPassage(p);
  }
  const origWords: R10OriginalWordRef[] = [
    {
      strongs: anchorData.bs,
      language: anchorData.lang || 'hbo',
      lemma_script: anchorData.sc,
      transliteration: anchorData.tr,
      gloss: anchorData.gl,
    },
    ...(tWord
      ? [{
          strongs: tWord.strongs,
          language: tWord.language || 'grc',
          lemma_script: tWord.script,
          transliteration: tWord.transliteration,
          gloss: tWord.gloss,
        }]
      : []),
  ];
  const hops = best.meaningful_hops ?? steps.length;
  const chainStr = steps.map((s: any) => `${s.from_label} --[${s.relation_type}]--> ${s.to_label}`).join(' ; ');
  const isHypothesis = rec.epistemic_layer === 'HYPOTHESIS' || rec.evidence_status === 'MIXED_OR_EXPLORATORY';
  const epStatus: 'DIRECT_ENDPOINT_WITNESS' | 'COHERENT_MULTIHOP_LEAD' | 'BRIDGE_SUPPORTED_PATH' | 'EXPLORATORY_STEP_CHAIN' =
    rec.endpoint_epistemic_status || (isHypothesis ? 'EXPLORATORY_STEP_CHAIN' : 'BRIDGE_SUPPORTED_PATH');

  let tier: R10EvidenceTier = 5;
  let epistClass: R10EpistemicClass = 'documented_cross_language_bridge';
  let finalScore = Math.round(580 + (rec.interest || 0) * 200);
  if (epStatus === 'DIRECT_ENDPOINT_WITNESS') {
    tier = 4;
    epistClass = 'documented_collocation_or_cooccurrence';
    finalScore = Math.round(780 + (rec.interest || 0) * 170);
  } else if (isHypothesis || epStatus === 'EXPLORATORY_STEP_CHAIN') {
    tier = 6;
    epistClass = 'candidate_literary_pattern';
    finalScore = Math.round(420 + (rec.interest || 0) * 180);
  } else if (epStatus === 'COHERENT_MULTIHOP_LEAD') {
    tier = 5;
    epistClass = 'documented_cross_language_bridge';
    finalScore = Math.round(660 + (rec.interest || 0) * 180);
  }

  return {
    evidence_id: rec.evidence_id,
    predicate: 'multihop_proof_path',
    evidence_tier: tier,
    epistemic_class: epistClass,
    title: `R12 ${hops}-hop discovery: ${anchorData.sc} (${anchorData.bs}) → ${tWord ? `${tWord.script} ("${tWord.gloss}", ${tWord.strongs})` : rec.target_id}`,
    summary: `${hops}-hop source-backed discovery path (${epStatus.replace(/_/g, ' ').toLowerCase()}, K=${rec.K ?? rec.endpoint_coherence ?? 1}, endpoint_groups=${rec.endpoint_support_group_count ?? 0}, step_groups=${rec.step_support_group_count ?? rec.independent_group_count}; interest=${rec.interest}): ${chainStr}`,
    source_node_id: rec.anchor_id,
    target_node_id: rec.target_id,
    passages: passages.slice(0, 6),
    original_words: origWords,
    matched_terms: [anchorData.gl, anchorData.bs, tWord?.gloss, tWord?.strongs].filter(Boolean),
    limitations: [
      rec.limitation || 'A multi-hop source path connects intermediate attested steps without proving endpoint semantic identity or authorial intent.',
    ],
    provenance: {
      source_dataset: [...new Set(steps.map((s: any) => s.source_dataset).filter(Boolean))].join(' + ') || 'MACULA + STEPBible + CATSS/Swete',
      source_record_ids: (rec.independent_evidence_groups || []).slice(0, 8),
      license: 'CC BY 4.0',
      derivation_method: 'r12_offline_beam_proof_ranker_v2',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((rec.D || 0) * 100),
      witness_bonus: Math.round((rec.C || 0) * 100),
      common_word_penalty: Math.round((rec.hub_penalty || 0) * 100),
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: rec.score_version || 'r12-ranker-v2',
      epistemic_layer: rec.epistemic_layer || 'LINGUISTIC',
      epistemic_status: rec.evidence_status === 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        ? 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        : 'EXPLORATORY',
      meaningful_hops: hops,
      physical_hops: best.physical_hops ?? steps.length,
      Q: rec.Q ?? 0,
      K: rec.K ?? rec.endpoint_coherence,
      endpoint_coherence: rec.endpoint_coherence ?? rec.K,
      endpoint_epistemic_status: epStatus,
      C: rec.C ?? 0,
      D: rec.D ?? 0,
      T: rec.T ?? 0,
      hub_penalty: rec.hub_penalty ?? 0,
      interest: rec.interest ?? 0,
      mmr_score: rec.mmr_score,
      step_support_group_count: rec.step_support_group_count ?? rec.independent_group_count ?? 0,
      endpoint_support_group_count: rec.endpoint_support_group_count ?? 0,
      independent_group_count: rec.independent_group_count ?? 0,
      independent_evidence_groups: rec.independent_evidence_groups || [],
      direct_endpoint_witnesses: rec.direct_endpoint_witnesses || [],
      endpoint_bridge_witnesses: rec.endpoint_bridge_witnesses || [],
      alternative_path_count: (rec.alternative_paths || []).length,
      steps: steps.map((s: any) => ({
        edge_id: s.edge_id,
        from_id: s.from_id,
        from_label: s.from_label,
        to_id: s.to_id,
        to_label: s.to_label,
        relation_type: s.relation_type,
        direction: s.direction,
        epistemic_layer: s.epistemic_layer,
        quality_weight: s.quality_weight,
        administrative: s.administrative,
        source_dataset: s.source_dataset,
        witness_refs: s.witness_refs,
      })),
      alternative_paths: (rec.alternative_paths || []).slice(0, 3).map((ap: any) => ({
        path_id: ap.path_id,
        partial_interest: ap.partial_interest,
        steps: (ap.steps || []).map((s: any) => ({
          edge_id: s.edge_id,
          from_id: s.from_id,
          from_label: s.from_label,
          to_id: s.to_id,
          to_label: s.to_label,
          relation_type: s.relation_type,
          epistemic_layer: s.epistemic_layer,
          quality_weight: s.quality_weight,
          witness_refs: s.witness_refs,
        })),
      })),
    },
  };
}

function r12PropertyBridgeToRecord(anchorData: any, b: any): R10EvidenceRecord {
  const tWord = b.target_word;
  const topFeat = b.shared_features?.[0];
  const leftRef = topFeat?.left?.[0];
  const rightRef = topFeat?.right?.[0];
  const tier: R10EvidenceTier = 5;
  const isEquiv = b.bridge_kind === 'external_concept_equivalence';
  const finalScore = isEquiv ? Math.round(620 + (b.score || 0) * 80) : Math.round(765 + (b.score || 0) * 80);
  const origWords: R10OriginalWordRef[] = [
    {
      strongs: anchorData.bs,
      language: anchorData.lang || 'hbo',
      lemma_script: anchorData.sc,
      transliteration: anchorData.tr,
      gloss: anchorData.gl,
    },
    ...(tWord
      ? [{
          strongs: tWord.strongs,
          language: tWord.language || 'grc',
          lemma_script: tWord.script,
          transliteration: tWord.transliteration,
          gloss: tWord.gloss,
        }]
      : []),
  ];

  const sourceIds = [
    leftRef?.source_id,
    rightRef?.source_id,
    ...(b.shared_features || []).slice(0, 3).flatMap((sf: any) => [sf.left?.[0]?.source_id, sf.right?.[0]?.source_id]),
  ].filter(Boolean);

  return {
    evidence_id: b.evidence_id,
    predicate: 'shared_external_property',
    evidence_tier: tier,
    epistemic_class: 'external_world_bridge',
    title: isEquiv
      ? `External concept equivalence: ${anchorData.sc} (${anchorData.gl}) ↔ ${tWord ? `${tWord.script} ("${tWord.gloss}")` : b.target_id} via "${b.value_label}"`
      : `Physical/semantic bridge: ${anchorData.sc} (${anchorData.gl}) ↔ ${tWord ? `${tWord.script} ("${tWord.gloss}")` : b.target_id} via "${b.value_label}"`,
    summary: `External ${isEquiv ? 'concept equivalence' : 'property bridge'} (${b.mapping_status} mapping; ${leftRef?.provider || 'OEWN/Wikidata'}) linking ${anchorData.bs} (${b.left_mapping?.sense_gloss || anchorData.gl}) and ${tWord?.strongs || b.target_id} (${b.right_mapping?.sense_gloss || tWord?.gloss || ''}) via shared property ${b.property_key}=${b.value_label}. Independent biblical support=0 (exploratory hypothesis).`,
    source_node_id: b.anchor_id,
    target_node_id: b.target_id,
    passages: (b.passages || []).slice(0, 6).map((p: any) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: origWords,
    matched_terms: [anchorData.gl, tWord?.gloss, b.value_label, anchorData.bs, tWord?.strongs].filter(Boolean),
    limitations: [
      b.limitation || 'Shared externally sourced physical/semantic properties are exploratory research leads, not biblical identifications or proof of authorial intent.',
      ...(b.mapping_status === 'candidate' ? ['Lexical-to-external synset/QID mapping is candidate-grade due to polysemy; context determines which biblical sense applies.'] : []),
    ],
    provenance: {
      source_dataset: (() => {
        const rawProviders = [...new Set([leftRef?.provider, rightRef?.provider].filter(Boolean))];
        if (rawProviders.some((p) => /WordNet|Wikidata/i.test(p))) return rawProviders.join(' + ');
        return `${rawProviders.join(' + ') || 'BibleResearch Derived Physical Graph'} (derived from Wikidata / OpenEnglishWordNet 2025)`;
      })(),
      source_record_ids: [...new Set(sourceIds)].slice(0, 8),
      license: [...new Set([leftRef?.license, rightRef?.license].filter(Boolean))].join(' ; ') || 'CC BY 4.0 / CC0 1.0',
      derivation_method: 'r12_external_property_bridge',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((b.score || 0) * 160),
      witness_bonus: 0,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v2',
      epistemic_layer: 'EXTERNAL_WORLD',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 2,
      physical_hops: 2,
      Q: b.score ?? 0.5,
      C: 0,
      D: Number((topFeat?.rarity ? Math.min(1, topFeat.rarity / 6) : 0.7).toFixed(4)),
      T: 0.25,
      hub_penalty: 0,
      interest: b.score ?? 0.5,
      independent_group_count: 0,
      independent_evidence_groups: [],
      alternative_path_count: Math.max(0, (b.shared_features?.length || 1) - 1),
      external_bridge: {
        property_key: b.property_key,
        value_id: b.value_id,
        value_label: b.value_label,
        bridge_kind: b.bridge_kind || 'shared_external_property',
        assertion_origin: b.assertion_origin,
        left_sense_id: b.anchor_sense_id,
        right_sense_id: b.target_sense_id,
        mapping_status: b.mapping_status === 'verified' ? 'verified' : 'candidate',
        claim_status: b.claim_status === 'sourced' ? 'sourced' : 'candidate',
        independent_biblical_support: 0,
        left_mapping: b.left_mapping || null,
        right_mapping: b.right_mapping || null,
        shared_features: b.shared_features || [],
      },
    },
  };
}

function r12StructuralToRecord(anchorData: any, s: any): R10EvidenceRecord {
  const tier: R10EvidenceTier = 6;
  const finalScore = Math.round(620 + (s.weighted_jaccard || 0) * 140);
  return {
    evidence_id: s.evidence_id,
    predicate: 'structural_scene_parallel',
    evidence_tier: tier,
    epistemic_class: 'candidate_literary_pattern',
    title: `Structural clause parallel: ${s.anchor_ref} ↔ ${s.candidate_ref} (${s.all_shared_feature_count} shared roles, J=${s.weighted_jaccard})`,
    summary: `Candidate R8 grammatical scene parallel around ${anchorData.sc} (${anchorData.bs}) comparing ${s.anchor_ref} and ${s.candidate_ref} across ${(s.distinctive_shared_features || []).map((f: any) => `${f.role}=${f.value}`).join(', ')}.`,
    source_node_id: s.anchor_scene_id,
    target_node_id: s.candidate_scene_id,
    passages: (s.passages || []).slice(0, 6).map((p: any) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: [{
      strongs: anchorData.bs,
      language: anchorData.lang || 'hbo',
      lemma_script: anchorData.sc,
      transliteration: anchorData.tr,
      gloss: anchorData.gl,
    }],
    matched_terms: [anchorData.gl, anchorData.bs, s.anchor_ref, s.candidate_ref].filter(Boolean),
    limitations: [s.limitation || 'Shared structural clause roles are candidate parallels, not proof of authorial dependence.'],
    provenance: {
      source_dataset: 'MACULA Hebrew & Greek R8 Grammatical Frames',
      source_record_ids: [...(s.anchor_witness_ids || []), ...(s.candidate_witness_ids || [])].slice(0, 6),
      license: 'CC BY 4.0',
      derivation_method: 'r12_structural_role_weighted_jaccard',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((s.weighted_jaccard || 0) * 140),
      witness_bonus: Math.min(30, (s.all_shared_feature_count || 0) * 8),
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v2',
      epistemic_layer: 'HYPOTHESIS',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 2,
      physical_hops: 2,
      Q: s.weighted_jaccard ?? 0.5,
      C: 0.25,
      D: s.weighted_jaccard ?? 0.5,
      T: 0.25,
      hub_penalty: 0,
      interest: s.weighted_jaccard ?? 0.5,
      independent_group_count: 2,
      independent_evidence_groups: [...(s.anchor_witness_ids || []), ...(s.candidate_witness_ids || [])].slice(0, 4),
      alternative_path_count: 0,
      structural_match: {
        weighted_jaccard: s.weighted_jaccard,
        shared_feature_families: s.shared_feature_families || [],
        shared_features: s.distinctive_shared_features || [],
        anchor_witness_ids: s.anchor_witness_ids || [],
        candidate_witness_ids: s.candidate_witness_ids || [],
      },
    },
  };
}

function r12OrthographicToRecord(anchorData: any, o: any): R10EvidenceRecord {
  const tWord = o.target_word;
  const coocc = Number(o.cooccurrence_verses || 0);
  const tier: R10EvidenceTier = coocc > 0 ? 6 : 7;
  const finalScore = coocc > 0
    ? Math.round(620 + (o.score || 0) * 180)
    : Math.round(430 + (o.score || 0) * 120);
  return {
    evidence_id: o.evidence_id,
    predicate: 'orthographic_overlap',
    evidence_tier: tier,
    epistemic_class: 'orthographic_similarity_only',
    title: `Orthographic similarity: ${o.anchor_original} (${anchorData.bs}) ↔ ${o.target_form} (${tWord?.strongs || o.target_id}, matched "${o.matched_normalized_text}")`,
    summary: `Unpointed/unaccented script similarity (${o.normalization}, score=${o.score}, shared segment "${o.matched_normalized_text}"${coocc > 0 ? `, co-occurs in ${coocc} canonical verse(s)` : ''}). ${o.limitation}`,
    source_node_id: o.anchor_id,
    target_node_id: o.target_id,
    passages: (o.passages || []).slice(0, 4).map((p: any) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: [
      { strongs: anchorData.bs, language: anchorData.lang || 'hbo', lemma_script: anchorData.sc, transliteration: anchorData.tr, gloss: anchorData.gl },
      ...(tWord ? [{ strongs: tWord.strongs, language: tWord.language || 'hbo', lemma_script: tWord.script, transliteration: tWord.transliteration, gloss: tWord.gloss }] : []),
    ],
    matched_terms: [anchorData.gl, tWord?.gloss, o.matched_normalized_text].filter(Boolean),
    limitations: [o.limitation || 'Shared spelling does not establish root, etymology, meaning, or intentional wordplay.'],
    provenance: {
      source_dataset: 'STEPBible Canonical Lemma Script',
      source_record_ids: [anchorData.bs, tWord?.strongs].filter(Boolean),
      license: 'CC BY 4.0',
      derivation_method: 'r12_orthographic_bigram_containment',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((o.score || 0) * 100),
      witness_bonus: 0,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 40,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v2',
      epistemic_layer: 'HYPOTHESIS',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 1,
      physical_hops: 1,
      Q: o.score ?? 0.5,
      C: 0,
      D: o.score ?? 0.5,
      T: 0.25,
      hub_penalty: 0,
      interest: Number(((o.score || 0.5) * 0.5).toFixed(4)),
      raw_orthographic_score: o.raw_orthographic_score,
      cooccurrence_verses: coocc,
      independent_group_count: 0,
      independent_evidence_groups: [],
      alternative_path_count: 0,
    },
  };
}

async function readR10Key(reader: AssetReader, release: string, file: string, key: string, field: string, budget: ReadBudget): Promise<any> {
  const index = await readR10Json<any>(reader, release, file, budget);
  if (index?.schema_version === 'r10-packed-1') {
    const entry = index.entries?.[key];
    if (!entry) return null;
    const [blob, start, length] = entry;
    return readR10Json(reader, release, `${blob}#bytes=${start}-${start + length - 1}`, budget);
  }
  const values = index?.[field];
  return Array.isArray(values) ? values.find((pair: any[]) => pair[0] === key)?.[1] : values?.[key];
}

/** Read only the deterministic key branch; missing pages never trigger legacy scans. */
export async function readSelectiveKey(reader: AssetReader, release: string, namespace: string, key: string, budget: ReadBudget): Promise<any> {
  const hash = BigInt('0x' + fnv1a64Hex(key)).toString(2).padStart(64, '0');
  let prefix = hash.slice(0, namespace === 'refs' ? 7 : 8);
  for (;;) {
    const page = await readR10Json<any>(reader, release, `selective/${namespace}/${prefix}.json.gz`, budget);
    if (!page) return null;
    if (page.routes) {
      const route = page.routes.find((value: string) => hash.startsWith(value));
      if (!route || route.length <= prefix.length) return null;
      prefix = route;
    } else if (page.split) {
      const digit = hash[prefix.length];
      if (!digit || !page.split.includes(digit)) return null;
      prefix += digit;
    } else if (page.continuation) {
      if (page.continuation.key !== key) return null;
      let serialized = '';
      for (const rel of page.continuation.pages) {
        const part = await readR10Json<{ text: string }>(reader, release, rel, budget);
        if (!part) return null;
        serialized += part.text;
      }
      return JSON.parse(serialized);
    } else return page.entries?.[key] ?? null;
  }
}

async function readProfile(reader: AssetReader, release: string, manifest: FastManifest | null, bs: string, budget: ReadBudget): Promise<LemmaProfile | null> {
  if (manifest?.direct_b64gz) {
    const bucket = computeBucketHex('fnv1a64_mod1024', 1024, bs);
    const shard = await readR10Json<{ profiles?: Record<string, string> }>(reader, release, `fast-profiles/shard-${bucket}.json.gz`, budget);
    const b64 = shard?.profiles?.[bs];
    if (!b64) return null;
    return decodeB64Gz<LemmaProfile>(reader, b64, `/r10/p:${release}:${bs}`, (budget.b64Cache ||= new Map()));
  }
  if (manifest?.selective) return readSelectiveKey(reader, release, 'profiles', bs, budget);
  const bucket = computeBucketHex(manifest ? 'fnv1a64_mod1024' : 'fnv1a64_mod64', manifest?.profile_buckets || 64, bs);
  if (manifest?.packed) return readR10Key(reader, release, `fast-profiles/shard-${bucket}.json.gz`, bs, 'entries', budget);
  const shard = await readR10Json<{ entries?: Record<string, LemmaProfile> }>(reader, release, `${manifest ? 'fast-profiles' : 'lemma-profiles'}/shard-${bucket}.json.gz`, budget);
  return shard?.entries?.[bs] || null;
}

interface ConceptIndexData {
  aliases: Record<string, {
    strongs?: string[];
    motifs?: string[];
    numbers?: number[];
    note?: string;
    passages?: R10PassageRef[];
    original_words?: R10OriginalWordRef[];
  }>;
  book_names: Array<{ id: number; name: string; usfm: string; chapters: number }>;
}

export interface LemmaProfile {
  bs: string;
  lk: string;
  lang: 'hbo' | 'grc';
  sc: string;
  tr: string;
  gl: string;
  pos: string;
  entity_kind?: string;
  senses: Array<{ key: string; gl: string; note?: string }>;
  total_verses: number;
  all_vids: number[];
  forms: Array<{ sf: string; tr: string; gl: string; mc?: string; cnt: number; vid?: number }>;
  clusters: Array<{
    cluster_id: string;
    category: string;
    label: string;
    summary: string;
    vids: number[];
    sample_passages: Array<{
      verse_id: number;
      ref: string;
      mt_ref?: string;
      book: number;
      chapter: number;
      verse: number;
      testament: 'OT' | 'NT';
      snippet: string;
      has_simile: boolean;
    }>;
    collocated_words: Array<{ bs: string; sc: string; tr: string; gl: string; hits: number; score: number }>;
    has_simile: boolean;
    xrefs: Array<{ from_vid: number; to_vid: number; to_ref: string; phrase: string; is_same_lemma: boolean }>;
  }>;
  grammatical_relations: Array<{
    predicate: string;
    direction: 'incoming' | 'outgoing';
    display_label: string;
    related_strongs: string;
    related_script: string;
    related_gloss: string;
    occurrences: number;
    independent_witness_count?: number;
    witnesses?: Array<{ relation_id: string; clause_key: string; edition: string; subject_token_id: string; object_token_id: string; passage: R10PassageRef }>;
    witness_status?: string;
  }>;
  lexical_relations: any[];
  lxx_relations: any[];
  homograph_siblings: Array<{ bs: string; lk?: string; sc: string; tr: string; gl: string }>;
  first_occ_passages?: R10PassageRef[];
  orth_entry?: any;
  r12_pilot_anchor?: any;
}

function parsePassageReferences(rawQuery: string, bookNames: ConceptIndexData['book_names']): Array<{ refText: string; book: number; chapter: number; verse: number | null; endVerse?: number }> {
  const out: Array<{ refText: string; book: number; chapter: number; verse: number | null; endVerse?: number }> = [];
  const bookLookup = new Map<string, number>();
  for (const b of bookNames) {
    bookLookup.set(b.name.toLowerCase(), b.id);
    bookLookup.set(b.usfm.toLowerCase(), b.id);
  }
  const aliases: Record<string, number> = {
    gen: 1, exod: 2, ex: 2, lev: 3, num: 4, deut: 5, josh: 6, judg: 7,
    '1 sam': 9, '2 sam': 10, '1 kgs': 11, '2 kgs': 12, ps: 19, psa: 19, psalm: 19,
    prov: 20, isa: 23, jer: 24, ezek: 26, dan: 27, zech: 38, mal: 39,
    matt: 40, mt: 40, mk: 41, lk: 42, jn: 43, acts: 44, rom: 45,
    '1 cor': 46, '1 corinthians': 46, '2 cor': 47, gal: 48, eph: 49,
    heb: 58, jas: 59, '1 pet': 60, '1 peter': 60, rev: 66,
  };
  for (const [k, v] of Object.entries(aliases)) bookLookup.set(k, v);

  const re = /\b([1-3]?\s?[A-Za-z]+)\s+(\d{1,3})(?::(\d{1,3})(?:[-–](\d{1,3}))?)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawQuery)) !== null) {
    const bName = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const bid = bookLookup.get(bName) ?? bookLookup.get(bName.replace(/s$/, ''));
    if (!bid) continue;
    const ch = Number(m[2]);
    const vs = m[3] !== undefined ? Number(m[3]) : null;
    const endVs = m[4] !== undefined ? Number(m[4]) : undefined;
    out.push({ refText: m[0], book: bid, chapter: ch, verse: vs, endVerse: endVs });
  }
  return out;
}

function tokenizeTerms(query: DiscoverConnectionsQuery): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const rawList: string[] = [];
  if (query.concepts && query.concepts.length > 0) {
    rawList.push(...query.concepts);
  }
  const cleaned = normalizeNumberPhrases(String(query.query || ''))
    .replace(/([A-Za-z]+)'s\b/g, '$1')
    .replace(/[?:,;()[\]{}"]/g, ' ');
  for (const part of cleaned.split(/[\s,/]+/)) {
    if (part.trim()) rawList.push(part.trim());
  }
  for (const item of rawList) {
    // Handle Strong's codes immediately
    const sm = item.toUpperCase().match(/^([HG])0*(\d+)([A-Z]?)$/);
    if (sm) {
      const code = `${sm[1]}${sm[2].padStart(4, '0')}`;
      if (!seen.has(code)) {
        seen.add(code);
        terms.push(code);
      }
      continue;
    }
    const norm = stripPossessive(normalizeToken(item));
    if (!norm || norm.length < 2 && !NUMBER_WORDS[norm]) continue;
    if (QUERY_STOPWORDS.has(norm)) continue;
    if (!seen.has(norm)) {
      seen.add(norm);
      terms.push(norm);
    }
  }
  return terms.slice(0, 16);
}

function createPassageHydrator(
  reader: AssetReader,
  releaseId: string,
  fastManifest: FastManifest | null | undefined,
  budget: ReadBudget,
  defaultNeedToks = false,
) {
  const fastVerseCache = new Map<number, any>();
  const bookCache = new Map<number, any>();
  const chunkMetaCache = new Map<number, { xrefs?: any[]; events?: string[] }>();
  async function loadBookData(bookId: number): Promise<any> {
    if (bookCache.has(bookId)) return bookCache.get(bookId);
    const pad = String(bookId).padStart(2, '0');
    const data = await readR10Json<{ verses?: Record<string, any> }>(
      reader, releaseId, `evidence-passages/book-${pad}.json.gz`, budget
    );
    const verses = data?.verses || null;
    bookCache.set(bookId, verses);
    return verses;
  }

  async function hydratePassageByVid(vid: number, needToks = defaultNeedToks): Promise<R10PassageRef | null> {
    const book = bookForVid(vid);
    let v;
    if (fastManifest?.direct_b64gz) {
      const cachedV = bookCache.get(book)?.[String(vid)];
      if (cachedV && (!needToks || cachedV.toks)) {
        v = cachedV;
      } else {
        const chunkNum = Math.floor((vid - 1) / (fastManifest.verse_chunk_size || 64));
        const chunkHex = chunkNum.toString(16).padStart(3, '0');
        const chunk = await readR10Json<{
          summaries?: Record<string, [number, number, number, string, string, string | null | undefined]>;
          verses?: Record<string, string>;
          xrefs?: Record<string, any[]>;
          events?: Record<string, string[]>;
        }>(reader, releaseId, `fast-verses/chunk-${chunkHex}.json.gz`, budget);
        if (chunk?.xrefs?.[String(vid)] || chunk?.events?.[String(vid)]) {
          chunkMetaCache.set(vid, {
            xrefs: chunk.xrefs?.[String(vid)],
            events: chunk.events?.[String(vid)],
          });
        }
        if (!needToks && chunk?.summaries?.[String(vid)]) {
          const [sBook, sChapter, sVerse, sRef, sEn, sMtRef] = chunk.summaries[String(vid)];
          return {
            verse_id: vid,
            ref: sRef,
            ...(sMtRef !== null && sMtRef !== undefined ? { mt_ref: sMtRef } : {}),
            book: sBook,
            chapter: sChapter,
            verse: sVerse,
            testament: sBook <= 39 ? 'OT' : 'NT',
            snippet: sEn,
            is_psalm_heading: sBook === 19 && sVerse === 0,
          };
        }
        const b64 = chunk?.verses?.[String(vid)];
        if (b64) {
          v = await decodeB64Gz<any>(reader, b64, `/r10/v:${releaseId}:${vid}`, budget.b64Cache);
          if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
        }
      }
    } else if (fastManifest?.packed) {
      const chunk = Math.floor((vid - 1) / fastManifest.verse_chunk_size);
      v = await readR10Key(reader, releaseId, `fast-verses/chunk-${chunk.toString(16).padStart(3, '0')}.json.gz`, String(vid), 'verses', budget);
      if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
    } else if (fastManifest?.selective) {
      v = await readSelectiveKey(reader, releaseId, 'verses', String(vid), budget);
      if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
    } else if (fastManifest) {
      const chunk = Math.floor((vid - 1) / fastManifest.verse_chunk_size);
      if (!fastVerseCache.has(chunk)) {
        const data = await readR10Json<{ verses: Record<string, any> }>(reader, releaseId, `fast-verses/chunk-${chunk.toString(16).padStart(3, '0')}.json.gz`, budget);
        fastVerseCache.set(chunk, data?.verses || {});
      }
      v = fastVerseCache.get(chunk)?.[String(vid)];
      if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
    } else {
      const verses = await loadBookData(book);
      v = verses?.[String(vid)];
    }
    if (!v) return null;
    return {
      verse_id: vid,
      ref: v.ref,
      mt_ref: v.mt_ref,
      book: v.book,
      chapter: v.chapter,
      verse: v.verse,
      testament: v.book <= 39 ? 'OT' : 'NT',
      snippet: v.en,
      is_psalm_heading: v.book === 19 && v.verse === 0,
    };
  }

  return { bookCache, chunkMetaCache, loadBookData, hydratePassageByVid };
}

export async function discoverBiblicalConnections(
  reader: AssetReader,
  query: DiscoverConnectionsQuery,
  releaseId: string = query.release_id || DEFAULT_R10_RELEASE
): Promise<DiscoverConnectionsResult> {
  const tStart = Date.now();
  const budget = { used: 0, max: MAX_SUBREQUEST_BUDGET, missing: [] as string[], b64Cache: new Map<string, any>() };
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(query.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Number.parseInt(String(query.cursor || '0'), 10) || 0);

  const [conceptIdx, explicitData, fastManifest] = await Promise.all([
    readR10Json(reader, releaseId, 'concept-index.json.gz', budget) as Promise<ConceptIndexData | null>,
    readR10Json(reader, releaseId, 'explicit-and-typology.json.gz', budget) as Promise<{ records: any[] } | null>,
    readR10Json<FastManifest>(reader, releaseId, 'fast-manifest.json.gz', budget),
  ]);

  let motifsData: MotifsData | null = null;
  if (!fastManifest?.motifs_event_keywords) {
    motifsData = await readR10Json<MotifsData>(reader, releaseId, 'motifs-and-patterns.json.gz', budget);
  }

  if (!conceptIdx || !explicitData || (!fastManifest?.motifs_event_keywords && !motifsData)) {
    throw new Error(`R10 release indexes missing for release_id=${releaseId}`);
  }

  async function ensureMotifsData(): Promise<MotifsData | null> {
    if (!motifsData) {
      motifsData = await readR10Json<MotifsData>(reader, releaseId, 'motifs-and-patterns.json.gz', budget);
    }
    return motifsData;
  }

  const bookById = new Map((conceptIdx.book_names || []).map(b => [b.id, b]));
  const parsedRefs = parsePassageReferences(query.query || '', conceptIdx.book_names || []);
  let lexicalQuery = query.query || '';
  for (const ref of parsedRefs) lexicalQuery = lexicalQuery.replace(ref.refText, ' ');
  const extractedTerms = tokenizeTerms({ ...query, query: lexicalQuery });
  const explicitPassages: R10PassageRef[] = parsedRefs.map(pr => {
    const bk = bookById.get(pr.book);
    return {
      verse_id: 0,
      ref: `${bk?.name || `Book ${pr.book}`} ${pr.chapter}${pr.verse !== null ? `:${pr.verse}` : ''}`,
      book: pr.book,
      chapter: pr.chapter,
      verse: pr.verse !== null ? pr.verse : 1,
      end_verse: pr.endVerse,
      testament: pr.book <= 39 ? 'OT' : 'NT',
      is_psalm_heading: pr.book === 19 && pr.verse === 0,
    };
  });

  const resolvedConcepts: R10ResolvedConcept[] = [];
  const missingConcepts: string[] = [];
  const matchedStrongs = new Set<string>();
  const matchedMotifs = new Set<string>();
  const matchedNumbers = new Set<number>();
  const matchedEvents: any[] = [];
  const lemmaCache = new Map<string, any>();
  const controls: R10ControlOrWarning[] = [];

  // Passage hydration helper
  const { bookCache, chunkMetaCache, loadBookData, hydratePassageByVid } = createPassageHydrator(
    reader, releaseId, fastManifest, budget, false,
  );



  const refTokensToIgnore = new Set<string>();
  const contextVerseIds = new Set<number>();
  for (const pr of parsedRefs) {
    refTokensToIgnore.add(String(pr.chapter));
    if (pr.verse !== null && pr.verse !== undefined) refTokensToIgnore.add(String(pr.verse));
    if (pr.endVerse) refTokensToIgnore.add(String(pr.endVerse));
    const bk = bookById.get(pr.book);
    if (bk) {
      refTokensToIgnore.add(bk.name.toLowerCase());
      refTokensToIgnore.add(bk.usfm.toLowerCase());
      refTokensToIgnore.add(bk.name.toLowerCase().replace(/s$/, ''));
    }
  }

  // Hydrate explicit passage references and capture embedded verse xrefs/events
  const explicitPassageMeta: Array<{ ep: R10PassageRef; xrefs: any[]; eventIds: string[] }> = [];
  const passageContentStrongs: string[] = [];
  const passageOtherStrongs: string[] = [];
  for (const ep of explicitPassages) {
    let verses;
    if (fastManifest?.direct_b64gz) {
      const pad = String(ep.book).padStart(2, '0');
      const index = await readR10Json<any>(reader, releaseId, `evidence-passages/book-${pad}.json.gz`, budget);
      if (index?.coord_to_vid) {
        for (const vid of index.chapter_vids?.[String(ep.chapter)] || []) contextVerseIds.add(Number(vid));
        const vid = index.coord_to_vid[`${ep.chapter}:${ep.verse}`];
        if (vid) await hydratePassageByVid(Number(vid), true);
        verses = bookCache.get(ep.book);
      } else if (index?.verses) {
        verses = index.verses;
        bookCache.set(ep.book, verses);
      }
    } else if (fastManifest?.selective) {
      const vid = await readSelectiveKey(reader, releaseId, 'refs', `${ep.book}:${ep.chapter}:${ep.verse}`, budget);
      if (vid) await hydratePassageByVid(Number(vid), true);
      verses = bookCache.get(ep.book);
    } else if (fastManifest?.packed) {
      const bookFile = `evidence-passages/book-${String(ep.book).padStart(2, '0')}.json.gz`;
      const index = await readR10Json<any>(reader, releaseId, bookFile, budget);
      for (const vid of index?.chapter_vids?.[String(ep.chapter)] || []) contextVerseIds.add(Number(vid));
      const v = await readR10Key(reader, releaseId, bookFile, `${ep.chapter}:${ep.verse}`, 'verses', budget);
      if (v) { await hydratePassageByVid(Number(v.verse_id), true); verses = bookCache.get(ep.book); }
    } else verses = await loadBookData(ep.book);
    if (verses) {
      for (const [vKey, vVal] of Object.entries(verses) as [string, any][]) {
        if (vVal.chapter === ep.chapter && vVal.verse === ep.verse) {
          ep.verse_id = Number(vKey);
          ep.snippet = vVal.en;
          ep.mt_ref = vVal.mt_ref;
          const meta = chunkMetaCache.get(ep.verse_id);
          explicitPassageMeta.push({
            ep,
            xrefs: meta?.xrefs || [],
            eventIds: meta?.events || [],
          });
          for (const t of vVal.toks || []) {
            if (!t.s || PRONOUN_OR_FUNC_STRONGS.has(t.s)) continue;
            const cls = String(t.cl || '').toLowerCase();
            const isFuncClass = ['conjunction', 'preposition', 'article', 'particle', 'pronoun'].includes(cls);
            if (!isFuncClass && !GENERIC_LIGHT_VERB_STRONGS.has(t.s) && !SMALL_NUMERAL_STRONGS.has(t.s)) {
              if (!passageContentStrongs.includes(t.s)) passageContentStrongs.push(t.s);
            } else if (!passageOtherStrongs.includes(t.s)) {
              passageOtherStrongs.push(t.s);
            }
          }
          break;
        }
      }
    }
  }
  for (const s of [...passageContentStrongs, ...passageOtherStrongs]) matchedStrongs.add(s);

  // Sharded lemma-lookup loader with caching
  const shardMemo = new Map<string, Map<string, any[]>>();
  async function fetchShard(key: string): Promise<any[]> {
    const normKey = key.toLowerCase();
    if (fastManifest?.direct_b64gz && fastManifest.lookup_buckets === 1024) {
      const bucketKey = (fastManifest.strongs_lookup_upper_bucket && /^[hg]\d{4}$/.test(normKey))
        ? normKey.toUpperCase()
        : normKey;
      const bucket = computeBucketHex('fnv1a64_mod1024', 1024, bucketKey);
      const subIdx = Number((BigInt('0x' + fnv1a64Hex(normKey)) >> 10n) & 15n).toString(16);
      const shard = await readR10Json<{ lookup?: Record<string, string> }>(
        reader, releaseId, `fast-profiles/shard-${bucket}.json.gz`, budget
      );
      const b64 = shard?.lookup?.[subIdx];
      if (!b64) return [];
      const subMap = await decodeB64Gz<Record<string, any[]>>(
        reader, b64, `/r10/l:${releaseId}:${bucket}:${subIdx}`, budget.b64Cache
      );
      return subMap?.[normKey] || [];
    }
    if (fastManifest?.packed) {
      const bucket = computeBucketHex('fnv1a64_mod64', 64, normKey);
      return (await readR10Key(reader, releaseId, `lemma-lookup/shard-${bucket}.json.gz`, normKey, 'entries', budget)) || [];
    }
    if (fastManifest?.selective) return (await readSelectiveKey(reader, releaseId, 'lookup', normKey, budget)) || [];
    const bHex = computeBucketHex('fnv1a64_mod64', 64, normKey);
    if (!shardMemo.has(bHex)) {
      const shard = await readR10Json<{ entries?: Array<[string, any[]]> }>(
        reader, releaseId, `lemma-lookup/shard-${bHex}.json.gz`, budget
      );
      const map = new Map<string, any[]>();
      if (shard?.entries) {
        for (const [k, arr] of shard.entries) map.set(k, arr);
      }
      shardMemo.set(bHex, map);
    }
    return shardMemo.get(bHex)?.get(normKey) || [];
  }

  async function lookupShardToken(tok: string): Promise<any[]> {
    const rawKey = /^[HG]\d+$/i.test(tok) ? tok.toLowerCase() : tok.toLowerCase();
    let hits = await fetchShard(rawKey);
    if (hits.length === 0) {
      const sing = getSingularForm(rawKey);
      if (sing && sing !== rawKey) hits = await fetchShard(sing);
    }
    if (hits.length === 0) {
      for (const stem of getMorphStems(rawKey)) {
        hits = await fetchShard(stem);
        if (hits.length > 0) break;
      }
    }
    if (hits.length === 0 && QUERY_FALLBACK_ALIAS_MAP[rawKey]) {
      for (const fb of QUERY_FALLBACK_ALIAS_MAP[rawKey]) {
        hits = await fetchShard(fb);
        if (hits.length > 0) break;
      }
    }
    return hits;
  }

  const isExplicitProperQuery = /\b(susa|shushan|persia|palace|citadel|city|capital|person|place)\b/i.test(query.query || '');
  let cachedEvents: any[] | null = Array.isArray(motifsData?.events) ? motifsData.events : null;
  const eventKeywordList = fastManifest?.motifs_event_keywords ?? motifsData?.event_keywords;
  const eventKeywordSet = !cachedEvents && Array.isArray(eventKeywordList)
    ? new Set(eventKeywordList)
    : null;

  // Stage 1: Resolve multi-word phrases (3-gram, 2-gram) then remaining terms
  const phraseConsumedTerms = new Set<string>();
  const phraseResolvedTerms: string[] = [];
  const rawQueryTokens = extractedTerms.filter((t) => !/^[HG]\d{4}$/i.test(t) && !refTokensToIgnore.has(t));
  if (rawQueryTokens.length >= 2) {
    for (const n of [3, 2]) {
      for (let i = 0; i + n <= rawQueryTokens.length; i++) {
        const span = rawQueryTokens.slice(i, i + n);
        if (span.some((t) => phraseConsumedTerms.has(t.toLowerCase()))) continue;
        const phrase = span.map((t) => t.toLowerCase()).join(' ');
        const hits = conceptIdx.aliases[phrase] ? [] : await fetchShard(phrase);
        if (conceptIdx.aliases[phrase] || hits.length > 0) {
          phraseResolvedTerms.push(phrase);
          for (const t of span) {
            const tl = t.toLowerCase();
            if (!(tl in NUMBER_WORDS) && !(tl in SMALL_NUMBERS)) {
              phraseConsumedTerms.add(tl);
            }
          }
        }
      }
    }
  }
  const stage1Terms = [
    ...phraseResolvedTerms,
    ...extractedTerms.filter((t) => !phraseConsumedTerms.has(t.toLowerCase())),
  ];

  // Resolve concepts via aliases + sharded lemma-lookup
  for (const term of stage1Terms) {
    if (/^\d+$/.test(term) && refTokensToIgnore.has(term) && !NUMBER_WORDS[term]) continue;
    const lower = term.toLowerCase();
    const alias = conceptIdx.aliases[lower];
    const numVal = /^\d+$/.test(lower) ? Number(lower) : (NUMBER_WORDS[lower] ?? SMALL_NUMBERS[lower]);
    let evHits: any[] = [];
    if (lower.length >= 4 || ['red', 'sea'].includes(lower)) {
      if (!cachedEvents && eventKeywordSet?.has(lower)) {
        const md = await ensureMotifsData();
        cachedEvents = Array.isArray(md?.events)
          ? md.events
          : (md?.events_b64gz
              ? await decodeB64Gz<any[]>(reader, md.events_b64gz, `/r10/events:${releaseId}`, budget.b64Cache)
              : null);
      }
      if (cachedEvents) {
        evHits = cachedEvents.filter(e => e.keywords?.includes(lower)).slice(0, 4);
      }
    }

    const hasContextWitness = (hit: any) => (hit.vs || []).some((vid: number) => contextVerseIds.has(Number(vid)));
    const shardHits = (await lookupShardToken(term)).sort((a, b) =>
      Number(hasContextWitness(b)) - Number(hasContextWitness(a)) ||
      Number(b.cnt > 0) - Number(a.cnt > 0) ||
      Number(normalizeToken(b.gl || '') === lower) - Number(normalizeToken(a.gl || '') === lower) ||
      b.match_rank - a.match_rank || b.cnt - a.cnt);

    // Proper-Name vs Common-Noun Guard:
    // 1) If propShard has an exact gloss match (e.g. "hagar" -> H1904 "Hagar") and nonPropShard has
    //    NO exact gloss match (e.g. H1481 "to sojourn" matched only via transliteration/surface),
    //    select the exact proper-name entries and keep non-proper transliteration collisions separate.
    // 2) Conversely, if nonPropShard matches and propShard has no exact gloss match (e.g. "lily" -> H7799 vs H7800 "Susa"),
    //    keep non-proper entries as primary unless query explicitly asks for a proper place/person.
    const nonPropShard = shardHits.filter(h => !h.is_prop);
    const propShard = shardHits.filter(h => h.is_prop);
    const exactProperMatches = propShard.filter(h => normalizeToken(h.gl || '') === lower);
    const exactNonPropMatches = nonPropShard.filter(h => normalizeToken(h.gl || '') === lower);
    let primaryShardHits = shardHits;
    const excludedProper: any[] = [];
    if (exactProperMatches.length > 0 && exactNonPropMatches.length === 0) {
      primaryShardHits = exactProperMatches;
      for (const np of nonPropShard) {
        controls.push({
          control_id: `ctrl:proper_vs_translit:${np.bs}:${lower}`,
          kind: 'homograph_disambiguation',
          title: `Proper name "${term}" (${exactProperMatches[0].bs}) separated from lexical match ${np.sc} ("${np.gl}", ${np.bs})`,
          explanation: `Query term "${term}" matches proper entity ${exactProperMatches.map(x => `${x.sc} (${x.bs})`).join(', ')} directly by gloss; non-proper entry ${np.sc} (${np.bs}, "${np.gl}") is kept separate so unrelated passages are not mislabeled as "${term}".`,
        });
      }
    } else if (nonPropShard.length > 0 && !isExplicitProperQuery && exactProperMatches.length === 0) {
      primaryShardHits = nonPropShard;
      excludedProper.push(...propShard);
    }

    if (alias || primaryShardHits.length > 0 || numVal !== undefined || evHits.length > 0) {
      const lemmas: R10OriginalWordRef[] = [];
      const nodes: R10Node[] = [];
      const homographSiblings: Array<{ bs: string; lk?: string; sc: string; tr: string; gl: string }> = [];

      // Add primary shard hits first
      const distinctPrimary = primaryShardHits.filter((h, i, all) => all.findIndex(x => x.bs === h.bs) === i);
      for (const h of distinctPrimary.slice(0, 5)) {
        matchedStrongs.add(h.bs);
        const ow: R10OriginalWordRef = {
          lemma_key: h.lk,
          strongs: h.bs,
          language: h.lang,
          lemma_script: h.sc,
          transliteration: h.tr,
          gloss: h.gl,
        };
        lemmaCache.set(h.bs, ow);
        lemmas.push(ow);
      }

      // Merge alias original words without duplicate Strong's
      if (alias?.original_words) {
        for (const aw of alias.original_words) {
          if (aw.strongs) matchedStrongs.add(aw.strongs);
          if (!lemmas.some(l => l.strongs === aw.strongs)) {
            lemmas.push({ ...aw });
            if (aw.strongs) lemmaCache.set(aw.strongs, aw);
          }
        }
      }
      for (const s of alias?.strongs || []) matchedStrongs.add(s);

      // Handle excluded proper-name homographs
      for (const ep of excludedProper) {
        homographSiblings.push({ bs: ep.bs, lk: ep.lk, sc: ep.sc, tr: ep.tr, gl: ep.gl });
        controls.push({
          control_id: `ctrl:homograph_proper:${ep.bs}`,
          kind: 'homograph_disambiguation',
          title: `Homograph distinction: Common noun "${term}" vs proper name ${ep.gl} (${ep.bs})`,
          explanation: `Original script ${ep.sc} can designate both the botanical / common entity "${term}" and proper entity "${ep.gl}" (${ep.bs}). Separated by default to prevent geographical or personal confounding.`,
        });
      }

      if ((alias?.motifs?.length ?? 0) > 0) {
        const md = await ensureMotifsData();
        for (const m of alias!.motifs!) {
          matchedMotifs.add(m);
          const mInfo = md?.motifs?.[m];
          if (mInfo) {
            nodes.push({
              id: `motif:${m}`,
              kind: 'motif',
              label: mInfo.label,
              motif_id: m,
              epistemic_class: 'shared_motif_evidence',
              grounding_source: 'MACULA + STEPBible',
            });
          }
        }
      }
      if (numVal !== undefined) {
        matchedNumbers.add(numVal);
        nodes.push({
          id: `number:${numVal}`,
          kind: 'number_entity',
          label: `Number ${numVal}`,
          number_value: numVal,
          epistemic_class: 'direct_textual_evidence',
          grounding_source: 'MACULA numeral pairs',
        });
      }
      for (const w of lemmas) {
        nodes.push({
          id: `lemma:${w.strongs}`,
          kind: 'lemma',
          label: `${w.lemma_script} (${w.transliteration || w.gloss})`,
          subtitle: w.gloss,
          language: w.language,
          strongs: w.strongs,
          lemma_key: w.lemma_key,
          lemma_script: w.lemma_script,
          transliteration: w.transliteration,
          gloss: w.gloss,
          epistemic_class: 'documented_lexical_relationship',
          grounding_source: 'STEPBible + MACULA',
        });
      }
      for (const eh of evHits) {
        matchedEvents.push(eh);
        nodes.push({
          id: eh.event_id,
          kind: 'event',
          label: eh.title,
          event_id: eh.event_id,
          epistemic_class: 'shared_motif_evidence',
          grounding_source: 'Theographic Bible Data',
        });
      }

      const resKind = /^[HG]\d+$/i.test(term)
        ? 'strongs'
        : (numVal !== undefined ? 'number' : (alias?.motifs?.length ? 'motif' : 'english_concept'));

      resolvedConcepts.push({
        input_token: term,
        normalized: lower,
        matched: true,
        resolution_kind: resKind,
        candidate_nodes: nodes,
        lemmas,
        sense_candidates: primaryShardHits.length > distinctPrimary.length ? primaryShardHits.map(h => ({ key: h.lk || h.bs, gl: h.gl, note: 'Lexical candidate; this name or sense has not been assigned to a particular occurrence.' })) : undefined,
        homograph_siblings: homographSiblings.length > 0 ? homographSiblings : undefined,
        ambiguity_note: contextVerseIds.size && primaryShardHits.some(hasContextWitness)
          ? 'Candidates attested in the referenced chapter are preferred. Sampled lexical occurrences do not establish which person or sense an individual token denotes; alternatives remain available.'
          : alias?.note || (primaryShardHits.length > 3 ? `Multiple original-language candidates (${primaryShardHits.slice(0, 3).map(h => h.sc).join(', ')}...)` : undefined),
      });
    } else if (!/^\d+$/.test(term)) {
      missingConcepts.push(term);
      resolvedConcepts.push({
        input_token: term,
        normalized: lower,
        matched: false,
        resolution_kind: 'unresolved',
        candidate_nodes: [],
        lemmas: [],
      });
    }
  }

  // Stage 1.5: Parallel bounded profile loading from sharded `lemma-profiles` for up to 6 primary resolved Strong's codes
  // Round-robin concepts so the first ambiguous term cannot consume every slot.
  const prioritized = new Set<string>();
  if (query.focus_lemma) prioritized.add(query.focus_lemma);
  for (let depth = 0; depth < 6; depth++) {
    for (const concept of resolvedConcepts) {
      const strongs = concept.lemmas[depth]?.strongs;
      if (strongs) prioritized.add(strongs);
    }
  }
  const profileSliceLimit = explicitPassages.length > 0 && extractedTerms.length === 0 ? 8 : 6;
  const profileStrongsToLoad = [...new Set([...prioritized, ...matchedStrongs])].slice(0, profileSliceLimit);
  const loadedProfiles: LemmaProfile[] = [];
  const profileByStrongs = new Map<string, LemmaProfile>();
  for (const bs of profileStrongsToLoad) {
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    if (prof) { loadedProfiles.push(prof); profileByStrongs.set(bs, prof); }
  }
  if (explicitPassages.length > 0 && extractedTerms.length === 0 && loadedProfiles.length > 1) {
    loadedProfiles.sort((a, b) => (a.total_verses || 99999) - (b.total_verses || 99999));
  }

  // Enrich resolved concepts with profile details
  for (const rc of resolvedConcepts) {
    const prof = rc.lemmas.map(l => profileByStrongs.get(l.strongs || '')).find(Boolean);
    if (prof) {
      rc.sense_candidates = prof.senses;
      rc.forms = prof.forms;
      rc.total_verses = prof.total_verses;
      rc.entity_kind = prof.entity_kind;
      if (prof.homograph_siblings?.length) {
        const existing = rc.homograph_siblings || [];
        const combined = [...existing];
        for (const sib of prof.homograph_siblings) {
          if (!combined.some(x => x.bs === sib.bs)) combined.push(sib);
        }
        rc.homograph_siblings = combined;
        for (const sib of prof.homograph_siblings) {
          if (!controls.some(c => c.control_id === `ctrl:homograph_sibling:${prof.bs}:${sib.bs}`)) {
            controls.push({
              control_id: `ctrl:homograph_sibling:${prof.bs}:${sib.bs}`,
              kind: 'homograph_disambiguation',
              title: `Homograph sibling: ${prof.sc} (${prof.gl} · ${prof.bs}) vs ${sib.sc} (${sib.gl} · ${sib.bs})`,
              explanation: `Hebrew consonantal skeleton for ${prof.sc} (${prof.bs}) is shared with ${sib.sc} (${sib.bs}, "${sib.gl}"). Preserved separately to prevent confounding distinct biblical concepts.`,
            });
          }
        }
      }
    }
  }



  // Stage 2: Candidate evidence generation
  const allCandidates: R10EvidenceRecord[] = [];
  const queryTermSet = new Set(extractedTerms.map(t => t.toLowerCase()));
  const multiConcept = extractedTerms.filter(t => !refTokensToIgnore.has(t)).length >= 2 || parsedRefs.length >= 2;
  const clusters: R10Cluster[] = [];
  const bridges: R10ClusterBridge[] = [];
  const crossReferencesOut: DiscoverConnectionsResult['related_discoveries']['cross_references'] = [];

  // A. Evidence-Derived Clusters & Relations from loaded lemma-profiles
  for (const prof of loadedProfiles) {
    const idfBonus = Math.max(0, Math.round((Math.log(31203 / Math.max(1, prof.total_verses)) - 3) * 18));
    const hubPenalty = prof.total_verses > 250 && !multiConcept ? 140 : 0;

    // A. Clusters
    for (const cl of prof.clusters || []) {
      const anchorNodes: R10Node[] = [
        {
          id: `lemma:${prof.bs}`,
          kind: 'lemma',
          label: `${prof.sc} (${prof.tr})`,
          subtitle: prof.gl,
          language: prof.lang,
          strongs: prof.bs,
          lemma_key: prof.lk,
          lemma_script: prof.sc,
          transliteration: prof.tr,
          gloss: prof.gl,
          epistemic_class: 'direct_textual_evidence',
          grounding_source: 'STEPBible + MACULA',
        },
        ...cl.sample_passages.slice(0, 3).map(p => ({
          id: `passage:${p.ref}`,
          kind: 'passage' as const,
          label: p.ref,
          passage: {
            verse_id: p.verse_id,
            ref: p.ref,
            mt_ref: p.mt_ref,
            book: p.book,
            chapter: p.chapter,
            verse: p.verse,
            testament: p.testament,
            snippet: p.snippet,
            is_psalm_heading: p.book === 19 && p.verse === 0,
          },
          epistemic_class: 'direct_textual_evidence' as const,
          grounding_source: 'MACULA',
        })),
      ];

      clusters.push({
        cluster_id: cl.cluster_id,
        label: cl.label,
        category: cl.category,
        concepts: [prof.gl, prof.sc],
        anchor_nodes: anchorNodes,
        connection_ids: [`r11:cluster:${cl.cluster_id}`],
        summary: cl.summary,
        total_passages: cl.vids.length,
        passages: cl.sample_passages.map(p => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        })),
        uncertainty_note: cl.category === 'psalm_superscription'
          ? 'Psalm heading / musical or liturgical superscription; whether the expression denotes a tune, instrument, or floral motif is uncertain in source text.'
          : 'Evidence-derived semantic cluster grouping attested verses by shared vocabulary and genre.',
        collocated_words: cl.collocated_words,
      });

      let tier: R10EvidenceTier = 3;
      let predicate: R10Predicate = 'verified_lexical_grammatical';
      let epistemicClass: R10EpistemicClass = 'direct_textual_evidence';
      let limitations = ['Evidence-derived corpus cluster based on syntactic and lexical co-occurrence.'];

      if (cl.category === 'temple_and_sanctuary_architecture') {
        const hasArchColloc = (cl.collocated_words || []).some(w =>
          ['pillar', 'cup', 'brim', 'handbreadth', 'thickness', 'bath', 'deed'].some(k => w.gl.toLowerCase().includes(k))
        ) || (cl.xrefs || []).length > 0;
        tier = hasArchColloc ? 2 : 3;
        predicate = 'verified_lexical_grammatical';
        limitations = ['Sanctuary and Temple architecture descriptions; physical ornamentation rather than metaphorical or typological discourse.'];
      } else if (cl.category === 'psalm_superscription') {
        tier = 3;
        predicate = 'verified_lexical_grammatical';
        epistemicClass = 'documented_lexical_relationship';
        limitations = ['Psalm heading / musical or liturgical superscription; whether the expression denotes a tune, instrument, or floral motif is uncertain in source text.'];
      } else if (['poetic_imagery_and_similes', 'prophetic_imagery_and_oracles', 'gospel_and_nt_teaching'].includes(cl.category)) {
        if (cl.has_simile) {
          tier = 2;
          predicate = 'explicit_comparison';
          limitations = ['Explicit comparative simile in biblical text; context determines the extent of figurative correspondence.'];
        } else {
          tier = 3;
          predicate = 'verified_lexical_grammatical';
          limitations = ['Attested imagery in poetic or prophetic discourse.'];
        }
      }

      const baseScore = TIER_BASE_SCORE[tier];
      const witnessBonus = Math.min(80, cl.vids.length * 6);
      const specificityBonus = idfBonus + (cl.has_simile ? 30 : 0);
      const finalScore = Math.max(10, baseScore + specificityBonus + witnessBonus - hubPenalty - 130);

      const clusterVids = new Set(cl.vids);
      const matchingForms = (prof.forms || []).filter(f => f.vid && clusterVids.has(f.vid));
      const originalWords: R10OriginalWordRef[] = [
        {
          lemma_key: prof.lk,
          strongs: prof.bs,
          language: prof.lang,
          lemma_script: prof.sc,
          transliteration: prof.tr,
          gloss: prof.gl,
        },
        ...matchingForms.slice(0, 3).map(f => ({
          lemma_key: prof.lk,
          strongs: prof.bs,
          language: prof.lang,
          lemma_script: f.sf,
          transliteration: f.tr,
          gloss: f.gl,
        })),
      ];

      allCandidates.push({
        evidence_id: `r11:cluster:${cl.cluster_id}`,
        predicate,
        evidence_tier: tier,
        epistemic_class: epistemicClass,
        title: cl.label,
        summary: cl.summary,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `cluster:${cl.cluster_id}`,
        passages: cl.sample_passages.map(p => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        })),
        original_words: originalWords,
        matched_terms: [prof.gl, prof.sc, prof.bs],
        limitations,
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek + STEPBible',
          source_record_ids: cl.sample_passages.map(p => p.ref),
          license: 'CC BY 4.0',
          derivation_method: 'evidence_derived_semantic_cluster',
        },
        score_components: {
          base_tier_score: baseScore,
          specificity_bonus: specificityBonus,
          witness_bonus: witnessBonus,
          common_word_penalty: hubPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: finalScore,
        },
      });

      // E. Cross-References from cluster
      for (const xr of (cl.xrefs || []).slice(0, 4)) {
        const fromP: R10PassageRef = {
          verse_id: xr.from_vid,
          ref: cl.sample_passages.find(p => p.verse_id === xr.from_vid)?.ref || `Verse ${xr.from_vid}`,
          book: bookForVid(xr.from_vid),
          chapter: 1,
          verse: 1,
          testament: bookForVid(xr.from_vid) <= 39 ? 'OT' : 'NT',
        };
        const toP: R10PassageRef = {
          verse_id: xr.to_vid,
          ref: xr.to_ref,
          book: bookForVid(xr.to_vid),
          chapter: 1,
          verse: 1,
          testament: bookForVid(xr.to_vid) <= 39 ? 'OT' : 'NT',
        };
        crossReferencesOut.push({
          from_ref: fromP.ref,
          to_ref: xr.to_ref,
          anchor_phrase: xr.phrase,
          from_passage: fromP,
          to_passage: toP,
        });
        allCandidates.push({
          evidence_id: `r11:xref:${xr.from_vid}:${xr.to_vid}`,
          predicate: 'cross_reference_witness',
          evidence_tier: 4,
          epistemic_class: 'verified_cross_reference',
          title: `Cross-reference witness: ${fromP.ref} → ${xr.to_ref} ("${xr.phrase}")`,
          summary: `Canonical cross-reference connects ${fromP.ref} and ${xr.to_ref} sharing anchor phrase "${xr.phrase}" (${xr.is_same_lemma ? 'same original lemma' : 'intertextual thematic witness'}).`,
          source_node_id: `passage:${fromP.ref}`,
          target_node_id: `passage:${xr.to_ref}`,
          passages: [fromP, toP],
          original_words: [{ lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl }],
          matched_terms: [prof.gl, xr.phrase],
          limitations: ['Cross-reference witness documents ancient editorial or intertextual connection; thematic scope must be verified from context.'],
          provenance: {
            source_dataset: 'CrossReferences.org / OpenBible',
            source_record_ids: [fromP.ref, xr.to_ref],
            license: 'CC BY 4.0',
            derivation_method: 'canonical_cross_reference_graph',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[4],
            specificity_bonus: idfBonus,
            witness_bonus: 30,
            common_word_penalty: hubPenalty,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: Math.max(10, TIER_BASE_SCORE[4] + idfBonus + 30 - hubPenalty),
          },
        });
      }
    }

    // B. Direct Grammatical Relations (filter out pronouns/particles; demote generic light verbs)
    const nonFuncGram = (prof.grammatical_relations || []).filter(gr =>
      gr.occurrences >= 1 &&
      (gr.witnesses === undefined || gr.witnesses.length > 0) &&
      !PRONOUN_OR_FUNC_STRONGS.has(gr.related_strongs)
    ).slice(0, 5);

    for (const gr of nonFuncGram) {
      const gTier: R10EvidenceTier = (gr.independent_witness_count ?? gr.occurrences) >= 2 ? 2 : 3;
      const gBase = TIER_BASE_SCORE[gTier];
      const gSpec = idfBonus + 25;
      const gWit = Math.min(40, (gr.independent_witness_count ?? gr.occurrences) * 8);
      const lightVerbPen = (GENERIC_LIGHT_VERB_STRONGS.has(gr.related_strongs) || GENERIC_LIGHT_VERB_STRONGS.has(prof.bs)) ? 140 : 0;
      allCandidates.push({
        evidence_id: `r11:gram:${prof.bs}:${gr.predicate}:${gr.related_strongs}`,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: gTier,
        epistemic_class: 'direct_textual_evidence',
        title: `${gr.display_label}: ${prof.sc} (${prof.tr}) ↔ ${gr.related_script} ("${gr.related_gloss}", ${gr.occurrences}×)`,
        summary: `Syntactic dependency analysis identifies direct grammatical connection (${gr.display_label}) between ${prof.sc} (${prof.bs}) and ${gr.related_script} (${gr.related_strongs}, "${gr.related_gloss}") across ${gr.occurrences} indexed occurrences.${gr.independent_witness_count !== undefined ? ` ${gr.independent_witness_count} distinct canonical source clauses pass token-position verification; parallel editions are counted once.` : ''}`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${gr.related_strongs}`,
        passages: gr.witnesses?.map(w => w.passage) || [],
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
          { strongs: gr.related_strongs, language: prof.lang, lemma_script: gr.related_script, transliteration: '', gloss: gr.related_gloss },
        ],
        matched_terms: [prof.gl, gr.related_gloss, prof.bs, gr.related_strongs],
        limitations: [gr.witnesses ? `Exact source relations; ${gr.independent_witness_count} distinct canonical clause witnesses. Parallel editions and mirrored paths do not add independent support.` : 'Legacy aggregate without attached matching witnesses; inspect grammatical relationship evidence before citing.', 'Syntactic construct/argument relation; shared grammar alone establishes no theological or authorial significance.'],
        provenance: {
          source_dataset: 'MACULA Hebrew/Greek Syntactic Trees',
          source_record_ids: gr.witnesses?.map(w => w.relation_id) || [],
          license: 'CC BY 4.0',
          derivation_method: 'syntactic_dependency_relation',
        },
        score_components: {
          base_tier_score: gBase,
          specificity_bonus: gSpec,
          witness_bonus: gWit,
          common_word_penalty: hubPenalty + lightVerbPen,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, gBase + gSpec + gWit - hubPenalty - lightVerbPen),
        },
      });
    }

    // C. Documented LXX Bridges
    for (let idx = 0; idx < Math.min(6, (prof.lxx_relations || []).length); idx++) {
      const rel = prof.lxx_relations[idx];
      let relTitle = `Septuagint (LXX) bridge: ${prof.sc} (${prof.bs})`;
      let relSummary = `Documented Septuagint translation relationship for ${prof.sc}.`;
      if (rel.type === 'lxx_swete_witness') {
        relTitle = `Septuagint (LXX) bridge: ${prof.sc} (${prof.bs}) → ${rel.script} (${rel.target_strongs}, "${rel.gloss}") across ${rel.count} passages`;
        relSummary = `Ancient Greek Septuagint translates Hebrew ${prof.sc} (${prof.bs}) as Greek ${rel.script} (${rel.target_strongs}) in ${rel.count} occurrences (${(rel.sample_refs || []).slice(0, 4).join(', ')}). Establishes documented Greek translation bridge.`;
      } else if (rel.type === 'lxx_heading_witness') {
        relTitle = `Septuagint superscription witness for ${rel.ref}: ${prof.sc} (${prof.bs})`;
        relSummary = `In ${rel.ref}, the Septuagint renders the Hebrew title containing ${prof.sc} as: "${rel.lxx_text}". Witnesses ancient translation understanding of this superscription.`;
      } else if (rel.type === 'bcv_lxx_bridge' || rel.type === 'word_alignment') {
        relTitle = `Septuagint alignment witness: ${prof.sc} (${prof.bs}) → ${rel.script || rel.target_strongs}`;
        relSummary = `Documented LXX lexical alignment linking ${prof.sc} (${prof.bs}) with Greek witness ${rel.script || rel.target_strongs}.`;
      }
      allCandidates.push({
        evidence_id: `r11:lxx:${prof.bs}:${idx}`,
        predicate: 'cross_language_bridge',
        evidence_tier: 3,
        epistemic_class: 'documented_lexical_relationship',
        title: relTitle,
        summary: relSummary,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: rel.target_strongs ? `lemma:${rel.target_strongs}` : `concept:lxx:${prof.bs}`,
        passages: (rel.sample_refs || (rel.ref ? [rel.ref] : [])).slice(0, 4).map((rf: string) => ({
          verse_id: 0,
          ref: rf,
          book: 0,
          chapter: 1,
          verse: 1,
          testament: 'OT' as const,
        })),
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
          ...(rel.target_strongs ? [{ strongs: rel.target_strongs, language: 'grc' as const, lemma_script: rel.script || '', transliteration: '', gloss: rel.gloss || '' }] : []),
        ],
        matched_terms: [prof.gl, prof.sc, rel.gloss || ''].filter(Boolean),
        limitations: ['Historical Septuagint translation choice; reflects Alexandrian Jewish understanding of the Hebrew text.'],
        provenance: {
          source_dataset: 'Swete LXX / Hatch-Redpath / STEPBible',
          source_record_ids: (rel.sample_refs || [rel.ref || prof.bs]),
          license: 'CC BY 4.0',
          derivation_method: 'lxx_swete_alignment',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[3],
          specificity_bonus: idfBonus + 90,
          witness_bonus: Math.min(30, (rel.count || 1) * 5),
          common_word_penalty: hubPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, TIER_BASE_SCORE[3] + idfBonus + 90 + Math.min(30, (rel.count || 1) * 5) - hubPenalty),
        },
      });
    }

    // D. Lexical relations
    for (let idx = 0; idx < Math.min(5, (prof.lexical_relations || []).length); idx++) {
      const lrel = prof.lexical_relations[idx];
      allCandidates.push({
        evidence_id: `r11:lex:${prof.bs}:${idx}`,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: 3,
        epistemic_class: 'documented_lexical_relationship',
        title: `Lexical relation (${lrel.type.replace(/_/g, ' ')}): ${prof.sc} (${prof.bs}) ↔ ${lrel.label || `${lrel.script} (${lrel.target_strongs})`}`,
        summary: `Morphological and root derivation analysis links ${prof.sc} (${prof.bs}) to ${lrel.label || `${lrel.script || ''} (${lrel.target_strongs || ''}, "${lrel.gloss || ''}")`}.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: lrel.target_strongs ? `lemma:${lrel.target_strongs}` : `root:${lrel.root || prof.bs}`,
        passages: [],
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
          ...(lrel.target_strongs ? [{ strongs: lrel.target_strongs, language: prof.lang, lemma_script: lrel.script || '', transliteration: '', gloss: lrel.gloss || '' }] : []),
        ],
        matched_terms: [prof.gl, prof.sc, lrel.gloss || ''].filter(Boolean),
        limitations: ['Lexical root derivation reflects shared etymological origin; semantic usage in specific verses diverges.'],
        provenance: {
          source_dataset: 'STEPBible TBESH/TBESG Lexicon',
          source_record_ids: [prof.bs, lrel.target_strongs || ''].filter(Boolean),
          license: 'CC BY 4.0',
          derivation_method: 'lexical_root_derivation',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[3],
          specificity_bonus: idfBonus + 80,
          witness_bonus: 20,
          common_word_penalty: hubPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, TIER_BASE_SCORE[3] + idfBonus + 80 + 20 - hubPenalty),
        },
      });
    }

    // D2. Direct Collocated Vocabulary (top non-stop-hub collocations from attested cluster contexts)
    const seenCollocTargets = new Set<string>();
    const clForColloc = prof.clusters?.[0];
    if (clForColloc) {
      const samplePassages = (clForColloc.sample_passages || []).slice(0, 3).map(p => ({
        verse_id: p.verse_id,
        ref: p.ref,
        mt_ref: p.mt_ref,
        book: p.book,
        chapter: p.chapter,
        verse: p.verse,
        testament: p.testament,
        snippet: p.snippet,
        is_psalm_heading: p.book === 19 && p.verse === 0,
      }));
      for (const cw of clForColloc.collocated_words || []) {
        if (!cw.bs || cw.bs === prof.bs || seenCollocTargets.has(cw.bs)) continue;
        if (PRONOUN_OR_FUNC_STRONGS.has(cw.bs) || GENERIC_LIGHT_VERB_STRONGS.has(cw.bs)) continue;
        seenCollocTargets.add(cw.bs);
        const collocScore = Math.min(750, Math.max(660, 660 + Math.round((cw.score || 0) * 60 + Math.log2(1 + (cw.hits || 1)) * 18)));
        allCandidates.push({
          evidence_id: `r11:colloc:${prof.bs}:${cw.bs}`,
          predicate: 'verified_lexical_grammatical',
          evidence_tier: 4,
          epistemic_class: 'documented_collocation_or_cooccurrence',
          title: `Direct collocation: ${prof.sc} ("${prof.gl}") ↔ ${cw.sc} ("${cw.gl}", ${cw.hits}×)`,
          summary: `Corpus co-occurrence links ${prof.sc} (${prof.bs}, "${prof.gl}") with ${cw.sc} (${cw.bs}, "${cw.gl}") across ${cw.hits} shared contexts (${samplePassages.map(p => p.ref).join(', ')}).`,
          source_node_id: `lemma:${prof.bs}`,
          target_node_id: `lemma:${cw.bs}`,
          passages: samplePassages,
          original_words: [
            { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
            { strongs: cw.bs, language: prof.lang, lemma_script: cw.sc, transliteration: cw.tr || '', gloss: cw.gl },
          ],
          matched_terms: [prof.gl, cw.gl, prof.bs, cw.bs],
          limitations: ['Co-occurring vocabulary in shared contexts; inspect surrounding verses for syntactic or thematic relation.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek + STEPBible',
            source_record_ids: samplePassages.map(p => p.ref),
            license: 'CC BY 4.0',
            derivation_method: 'direct_cluster_collocation',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[4],
            specificity_bonus: collocScore - TIER_BASE_SCORE[4],
            witness_bonus: 0,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: collocScore,
          },
        });
        if (seenCollocTargets.size >= 3) break;
      }
    }
  }

  // E2. Passage-level Embedded Cross-References & Chronological Events
  if (explicitPassageMeta.length > 0) {
    const needEventsMd = explicitPassageMeta.some(m => m.eventIds.length > 0);
    const mdForEvents = needEventsMd ? await ensureMotifsData() : null;
    for (const { ep, xrefs, eventIds } of explicitPassageMeta) {
      let hydratedTargetCount = 0;
      for (const xr of (xrefs || []).slice(0, 8)) {
        const [toVid, toRef, phrase, flags] = xr;
        const isReciprocal = (Number(flags) & 1) !== 0;
        const isCrossTest = (Number(flags) & 2) !== 0;
        const toBook = bookForVid(Number(toVid));
        const toPassage: R10PassageRef = (hydratedTargetCount < 4
          ? await hydratePassageByVid(Number(toVid), false)
          : null) || {
          verse_id: Number(toVid),
          ref: String(toRef),
          book: toBook,
          chapter: 1,
          verse: 1,
          testament: toBook <= 39 ? 'OT' : 'NT',
        };
        if (hydratedTargetCount < 4) hydratedTargetCount++;
        crossReferencesOut.push({
          from_ref: ep.ref,
          to_ref: String(toRef),
          anchor_phrase: String(phrase || ''),
          from_passage: ep,
          to_passage: toPassage,
        });
        const xrTier: R10EvidenceTier = isReciprocal ? 2 : 3;
        const xrScore = isReciprocal && isCrossTest ? 915 : isReciprocal ? 845 : isCrossTest ? 785 : 720;
        allCandidates.push({
          evidence_id: `r11:xref:${ep.verse_id}:${toVid}`,
          predicate: 'cross_reference_witness',
          evidence_tier: xrTier,
          epistemic_class: 'verified_cross_reference',
          title: `${isReciprocal ? 'Reciprocal cross-reference' : 'Cross-reference'}${isCrossTest ? ' (OT↔NT)' : ''}: ${ep.ref} ↔ ${toRef}`,
          summary: `${isReciprocal ? 'Bidirectional canonical cross-reference' : 'Canonical cross-reference'} links ${ep.ref} and ${toRef}${phrase ? ` via "${phrase}"` : ''}.`,
          source_node_id: `passage:${ep.ref}`,
          target_node_id: `passage:${toRef}`,
          passages: [ep, toPassage],
          original_words: [],
          matched_terms: [ep.ref, String(toRef), String(phrase || '')].filter(Boolean),
          limitations: ['Canonical cross-reference witnesses historical intertextual links; check both contexts to evaluate verbal or thematic dependence.'],
          provenance: {
            source_dataset: 'CrossReferences.org / OpenBible',
            source_record_ids: [ep.ref, String(toRef)],
            license: 'CC BY 4.0',
            derivation_method: 'embedded_bidirectional_cross_reference',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[xrTier],
            specificity_bonus: xrScore - TIER_BASE_SCORE[xrTier],
            witness_bonus: isReciprocal ? 45 : 15,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: xrScore,
          },
        });
      }

      if (mdForEvents?.event_seq && eventIds.length > 0) {
        const seenEvIds = new Set<string>();
        for (const evId of eventIds.slice(0, 2)) {
          if (!seenEvIds.has(evId)) seenEvIds.add(evId);
          const evInfo = mdForEvents.event_seq[evId];
          if (!evInfo) continue;
          const nextEvId = evInfo.next;
          const nextInfo = nextEvId ? mdForEvents.event_seq[nextEvId] : null;
          const nextVid = nextInfo?.sample_vids?.[0];
          const nextPassage = nextVid ? await hydratePassageByVid(Number(nextVid), false) : null;
          const evPassages = [ep, ...(nextPassage ? [nextPassage] : [])];
          allCandidates.push({
            evidence_id: `r12:event:${ep.verse_id}:${evId}`,
            predicate: 'biblical_event',
            evidence_tier: 3,
            epistemic_class: 'direct_textual_evidence',
            title: `Biblical narrative sequence: ${evInfo.title}${nextInfo ? ` → ${nextInfo.title}` : ''} (${ep.ref})`,
            summary: `${ep.ref} belongs to Biblical event "${evInfo.title}"${evInfo.start_date ? ` (${evInfo.start_date})` : ''}${nextInfo ? `, directly followed in canonical sequence by "${nextInfo.title}" (${nextPassage?.ref || ''})` : ''}.`,
            source_node_id: `passage:${ep.ref}`,
            target_node_id: nextEvId || evId,
            passages: evPassages,
            original_words: [],
            matched_terms: [ep.ref, evInfo.title, nextInfo?.title || ''].filter(Boolean),
            limitations: ['Narrative chronology sequence groups adjacent canonical episodes; dating models reflect Theographic reference chronology.'],
            provenance: {
              source_dataset: 'Theographic Bible Data',
              source_record_ids: [evId, ...(nextEvId ? [nextEvId] : [])],
              license: 'CC BY-SA 4.0',
              derivation_method: 'chronological_event_adjacency',
            },
            score_components: {
              base_tier_score: TIER_BASE_SCORE[3],
              specificity_bonus: 110,
              witness_bonus: 15,
              common_word_penalty: 0,
              number_coincidence_penalty: 0,
              orthographic_penalty: 0,
              final_score: 885,
            },
          });
          matchedEvents.push({
            event_id: evId,
            title: evInfo.title,
            start_date: evInfo.start_date,
            passages: evPassages,
          });
        }
      }
    }
  }

  // F. Multi-Concept Dynamic Intersections & Bridges (when >= 2 distinct concept term groups resolve to lemma profiles)
  const conceptGroups: Array<{ term: string; profiles: LemmaProfile[]; vids: Set<number> }> = [];
  for (const rc of resolvedConcepts) {
    if (!rc.matched) continue;
    const groupProfs = rc.lemmas
      .map(l => profileByStrongs.get(l.strongs || ''))
      .filter((p): p is LemmaProfile => Boolean(p));
    if (groupProfs.length > 0) {
      const combinedVids = new Set<number>();
      for (const p of groupProfs) {
        for (const v of p.all_vids) combinedVids.add(v);
      }
      conceptGroups.push({ term: rc.input_token, profiles: groupProfs, vids: combinedVids });
    }
  }

  if (conceptGroups.length >= 2) {
    for (let i = 0; i < conceptGroups.length; i++) {
      for (let j = i + 1; j < conceptGroups.length; j++) {
        const gA = conceptGroups[i];
        const gB = conceptGroups[j];
        const sharedVids = [...gA.vids].filter(v => gB.vids.has(v));

        // 1. Same-verse intersections (with compound numeral guard & proximity ranking)
        if (sharedVids.length > 0) {
          const involvesNumeral =
            matchedNumbers.size > 0 ||
            gA.profiles.some(p => SMALL_NUMERAL_STRONGS.has(p.bs)) ||
            gB.profiles.some(p => SMALL_NUMERAL_STRONGS.has(p.bs));
          const inspectSlice = sharedVids.slice(0, involvesNumeral ? 18 : 10);
          const candidateVids: Array<{ vid: number; p: R10PassageRef; pA: LemmaProfile; pB: LemmaProfile; toks: any[]; minDist: number }> = [];
          const aSet = new Set(gA.profiles.map(pr => pr.bs));
          const bSet = new Set(gB.profiles.map(pr => pr.bs));
          for (const vid of inspectSlice) {
            const p = await hydratePassageByVid(vid, true);
            if (!p) continue;
            const pA = gA.profiles.find(pr => pr.all_vids.includes(vid));
            const pB = gB.profiles.find(pr => pr.all_vids.includes(vid));
            if (!pA || !pB) continue;
            const vData = bookCache.get(p.book)?.[String(vid)];
            const toks: any[] = vData?.toks || [];

            if (involvesNumeral) {
              const numToks = toks.filter(t => SMALL_NUMERAL_STRONGS.has(t.s) && (aSet.has(t.s) || bSet.has(t.s)));
              const hasCompoundMagnitudeAdjacent = numToks.some(nt =>
                toks.some(mt => COMPOUND_MAGNITUDE_STRONGS.has(mt.s) && Math.abs((nt.wn || 0) - (mt.wn || 0)) <= 2)
              );
              if (hasCompoundMagnitudeAdjacent) continue;
            }
            const aWns = toks.filter(t => aSet.has(t.s)).map(t => Number(t.wn || 0));
            const bWns = toks.filter(t => bSet.has(t.s)).map(t => Number(t.wn || 0));
            let minDist = 999;
            for (const wa of aWns) {
              for (const wb of bWns) minDist = Math.min(minDist, Math.abs(wa - wb));
            }
            candidateVids.push({ vid, p, pA, pB, toks, minDist });
          }
          candidateVids.sort((x, y) =>
            Number(y.minDist <= 6) - Number(x.minDist <= 6) || x.minDist - y.minDist || x.vid - y.vid
          );

          for (const { vid, p, pA, pB, toks, minDist } of candidateVids.slice(0, 6)) {

            if (pA.bs === pB.bs) {
              const seenWn = new Set<number>();
              const sameToks = toks.filter(t => {
                if (t.s !== pA.bs || seenWn.has(t.wn)) return false;
                seenWn.add(t.wn);
                return true;
              });
              if (sameToks.length >= 2) {
                allCandidates.push({
                  evidence_id: `r11:repeat:verse:${pA.bs}:${vid}`,
                  predicate: 'verified_lexical_grammatical',
                  evidence_tier: 3,
                  epistemic_class: 'direct_textual_evidence',
                  title: `Repeated lemma in ${p.ref}: ${pA.sc} (${pA.bs}, ${sameToks.length}×)`,
                  summary: `${p.ref} attests ${sameToks.length} distinct token occurrences of the same lemma ${pA.sc} (${pA.bs}, "${pA.gl}") at word positions ${sameToks.map(t => t.wn).join(', ')}.`,
                  source_node_id: `lemma:${pA.bs}`,
                  target_node_id: `passage:${p.ref}`,
                  passages: [p],
                  original_words: [
                    { lemma_key: pA.lk, strongs: pA.bs, language: pA.lang, lemma_script: pA.sc, transliteration: pA.tr, gloss: pA.gl },
                  ],
                  matched_terms: [gA.term, gB.term, pA.gl],
                  limitations: ['Repetition of a single canonical lemma across distinct verse tokens; context determines whether each occurrence carries the same or distinct contextual sense.'],
                  provenance: {
                    source_dataset: 'MACULA Hebrew & Greek',
                    source_record_ids: sameToks.map(t => `${p.ref}#${t.wn}`),
                    license: 'CC BY 4.0',
                    derivation_method: 'repeated_lemma_distinct_tokens',
                  },
                  score_components: {
                    base_tier_score: TIER_BASE_SCORE[3],
                    specificity_bonus: 110,
                    witness_bonus: Math.min(40, sameToks.length * 10),
                    common_word_penalty: 0,
                    number_coincidence_penalty: 0,
                    orthographic_penalty: 0,
                    final_score: TIER_BASE_SCORE[3] + 110 + Math.min(40, sameToks.length * 10),
                  },
                });
              } else if (gA.term !== gB.term) {
                const singleWn = sameToks[0]?.wn;
                allCandidates.push({
                  evidence_id: `r11:polysemy:${pA.bs}:${vid}`,
                  predicate: 'interpretive_hypothesis',
                  evidence_tier: 5,
                  epistemic_class: 'documented_lexical_relationship',
                  title: `Single-token polysemy notice: "${gA.term}" and "${gB.term}" map to one ${pA.sc} (${pA.bs}) token in ${p.ref}`,
                  summary: `Both "${gA.term}" and "${gB.term}" resolve to the single lemma ${pA.sc} (${pA.bs}, "${pA.gl}"), which occurs once in ${p.ref}${singleWn ? ` (word ${singleWn})` : ''}. Lexical polysemy is not two independent co-occurring words.`,
                  source_node_id: `lemma:${pA.bs}`,
                  target_node_id: `lemma:${pA.bs}`,
                  passages: [p],
                  original_words: [
                    { lemma_key: pA.lk, strongs: pA.bs, language: pA.lang, lemma_script: pA.sc, transliteration: pA.tr, gloss: pA.gl },
                  ],
                  matched_terms: [gA.term, gB.term, pA.gl],
                  limitations: ['Single source occurrence only; multiple English glosses of one polysemous word do not establish independent textual convergence.'],
                  provenance: {
                    source_dataset: 'MACULA Hebrew & Greek + STEPBible',
                    source_record_ids: [singleWn ? `${p.ref}#${singleWn}` : p.ref],
                    license: 'CC BY 4.0',
                    derivation_method: 'single_token_polysemy_notice',
                  },
                  score_components: {
                    base_tier_score: TIER_BASE_SCORE[5],
                    specificity_bonus: 40,
                    witness_bonus: 0,
                    common_word_penalty: 0,
                    number_coincidence_penalty: 0,
                    orthographic_penalty: 0,
                    final_score: TIER_BASE_SCORE[5] + 40,
                  },
                });
              }
              continue;
            }

            const evId = `r11:intersect:verse:${pA.bs}:${pB.bs}:${vid}`;
            const proxBonus = minDist <= 4 ? 20 : 0;
            allCandidates.push({
              evidence_id: evId,
              predicate: 'verified_lexical_grammatical',
              evidence_tier: 2,
              epistemic_class: 'direct_textual_evidence',
              title: `Direct textual convergence: "${gA.term}" + "${gB.term}" in ${p.ref}`,
              summary: `Scripture text contains both ${pA.sc} ("${pA.gl}") and ${pB.sc} ("${pB.gl}") in the same verse (${p.ref}): "${p.snippet || ''}". Direct primary witness of co-occurrence.`,
              source_node_id: `lemma:${pA.bs}`,
              target_node_id: `lemma:${pB.bs}`,
              passages: [p],
              original_words: [
                { lemma_key: pA.lk, strongs: pA.bs, language: pA.lang, lemma_script: pA.sc, transliteration: pA.tr, gloss: pA.gl },
                { lemma_key: pB.lk, strongs: pB.bs, language: pB.lang, lemma_script: pB.sc, transliteration: pB.tr, gloss: pB.gl },
              ],
              matched_terms: [gA.term, gB.term, pA.gl, pB.gl],
              limitations: ['Direct intra-verse co-occurrence establishes textual contact; syntax and discourse function determine relationship.'],
              provenance: {
                source_dataset: 'MACULA Hebrew & Greek',
                source_record_ids: [p.ref],
                license: 'CC BY 4.0',
                derivation_method: 'exact_verse_lemma_intersection',
              },
              score_components: {
                base_tier_score: TIER_BASE_SCORE[2],
                specificity_bonus: 180 + proxBonus,
                witness_bonus: Math.min(50, sharedVids.length * 6),
                common_word_penalty: 0,
                number_coincidence_penalty: 0,
                orthographic_penalty: 0,
                final_score: TIER_BASE_SCORE[2] + 180 + proxBonus + Math.min(50, sharedVids.length * 6),
              },
            });
          }
        }

        // 2. Pericope window intersections (1 <= |vidA - vidB| <= 4 in same book)
        const pericopePairs: Array<[number, number]> = [];
        const arrA = [...gA.vids].sort((a, b) => a - b);
        const arrB = [...gB.vids].sort((a, b) => a - b);
        let startB = 0;
        for (const vA of arrA) {
          while (startB < arrB.length && arrB[startB] < vA - 4) startB++;
          for (let bIndex = startB; bIndex < arrB.length && arrB[bIndex] <= vA + 4; bIndex++) {
            const vB = arrB[bIndex];
            const diff = Math.abs(vA - vB);
            if (diff >= 1 && diff <= 4 && bookForVid(vA) === bookForVid(vB)) {
              const pA = gA.profiles.find(pr => pr.all_vids.includes(vA));
              const pB = gB.profiles.find(pr => pr.all_vids.includes(vB));
              if (pA && pB && pA.bs !== pB.bs) {
                pericopePairs.push([vA, vB]);
                if (pericopePairs.length >= 3) break;
              }
            }
          }
          if (pericopePairs.length >= 3) break;
        }

        for (const [vA, vB] of pericopePairs) {
          const pA = await hydratePassageByVid(vA);
          const pB = await hydratePassageByVid(vB);
          if (pA && pB) {
            const profA = gA.profiles.find(p => p.all_vids.includes(vA))!;
            const profB = gB.profiles.find(p => p.all_vids.includes(vB))!;
            allCandidates.push({
              evidence_id: `r11:intersect:pericope:${vA}:${vB}`,
              predicate: 'shared_motif',
              evidence_tier: 4,
              epistemic_class: 'shared_motif_evidence',
              title: `Close pericope proximity: "${gA.term}" (${pA.ref}) ↔ "${gB.term}" (${pB.ref})`,
              summary: `Original-language terms ${profA.sc} and ${profB.sc} appear within ${Math.abs(vA - vB)} verse(s) of each other in the same literary context (${pA.ref} and ${pB.ref}).`,
              source_node_id: `passage:${pA.ref}`,
              target_node_id: `passage:${pB.ref}`,
              passages: [pA, pB],
              original_words: [
                { lemma_key: profA.lk, strongs: profA.bs, language: profA.lang, lemma_script: profA.sc, transliteration: profA.tr, gloss: profA.gl },
                { lemma_key: profB.lk, strongs: profB.bs, language: profB.lang, lemma_script: profB.sc, transliteration: profB.tr, gloss: profB.gl },
              ],
              matched_terms: [gA.term, gB.term],
              limitations: ['A four-verse window is a statistical proximity candidate, not a verified pericope boundary or intentional literary relationship.'],
              provenance: {
                source_dataset: 'MACULA Hebrew & Greek',
                source_record_ids: [pA.ref, pB.ref],
                license: 'CC BY 4.0',
                derivation_method: 'pericope_window_intersection',
              },
              score_components: {
                base_tier_score: TIER_BASE_SCORE[4],
                specificity_bonus: 90,
                witness_bonus: 20,
                common_word_penalty: 0,
                number_coincidence_penalty: 0,
                orthographic_penalty: 0,
                final_score: TIER_BASE_SCORE[4] + 90 + 20,
              },
            });
          }
        }

        // 3. Shared collocation / xref bridges
        const profA = gA.profiles[0];
        const profB = gB.profiles[0];
        const collocA = new Map<string, { sc: string; gl: string; score: number }>();
        for (const cl of profA.clusters || []) {
          for (const cw of cl.collocated_words || []) collocA.set(cw.bs, { sc: cw.sc, gl: cw.gl, score: cw.score });
        }
        for (const cl of profB.clusters || []) {
          for (const cw of cl.collocated_words || []) {
            if (collocA.has(cw.bs)) {
              const bBridgeId = `bridge:concept:${profA.bs}:${profB.bs}:${cw.bs}`;
              if (!bridges.some(b => b.bridge_id === bBridgeId)) {
                const bridgeNode: R10Node = {
                  id: `lemma:${cw.bs}`,
                  kind: 'lemma',
                  label: `${cw.sc} (${cw.gl})`,
                  strongs: cw.bs,
                  epistemic_class: 'direct_textual_evidence',
                  grounding_source: 'STEPBible + MACULA',
                };
                bridges.push({
                  bridge_id: bBridgeId,
                  from_cluster_id: profA.clusters?.[0]?.cluster_id || profA.bs,
                  to_cluster_id: profB.clusters?.[0]?.cluster_id || profB.bs,
                  bridging_node: bridgeNode,
                  evidence_id: `r11:bridge:${profA.bs}:${profB.bs}:${cw.bs}`,
                  evidence_tier: 4,
                  explanation: `Both "${gA.term}" and "${gB.term}" significantly co-occur with ${cw.sc} ("${cw.gl}" · ${cw.bs}) in scriptural contexts.`,
                });
              }
            }
          }
        }
      }
    }
  }

  // Explicit and typology records matching query
  for (const rec of explicitData.records || []) {
    const recTerms = new Set((rec.matched_terms || []).map((t: string) => t.toLowerCase()));
    const matchedQueryTerms: string[] = [];
    for (const qt of queryTermSet) {
      if (recTerms.has(qt)) matchedQueryTerms.push(qt);
    }
    const matchedStrongsLabels: string[] = [];
    for (const ow of rec.original_words || []) {
      if (ow.strongs && matchedStrongs.has(ow.strongs) && !matchedStrongsLabels.includes(ow.strongs)) {
        matchedStrongsLabels.push(ow.strongs);
      }
    }
    const strongsOverlap = matchedStrongsLabels.length;
    let passageOverlap = 0;
    for (const pr of parsedRefs) {
      if ((rec.passages || []).some((p: R10PassageRef) => p.book === pr.book && p.chapter === pr.chapter && (!pr.verse || p.verse === pr.verse || (p.end_verse && pr.verse >= p.verse && pr.verse <= p.end_verse)))) {
        passageOverlap++;
      }
    }

    const totalHits = matchedQueryTerms.length + Math.min(2, strongsOverlap) + passageOverlap * 2;
    if (totalHits === 0) continue;
    if (explicitPassages.length > 0 && stage1Terms.length === 0 && passageOverlap === 0 && strongsOverlap < 2) continue;
    if (multiConcept && matchedQueryTerms.length < 1 && strongsOverlap < 1 && passageOverlap === 0) continue;
    if (rec.evidence_id?.startsWith('r10:ident:auto:') && multiConcept && matchedQueryTerms.length < 2 && passageOverlap === 0) continue;

    const effectiveConceptMatches = new Set([
      ...matchedQueryTerms,
      ...matchedStrongsLabels.map(s =>
        resolvedConcepts.find(c => c.lemmas.some(l => l.strongs === s))?.normalized ?? s
      ),
    ]).size;

    const tier = rec.evidence_tier as R10EvidenceTier;
    const baseScore = TIER_BASE_SCORE[tier] ?? 400;
    const specificityBonus = effectiveConceptMatches * 140 + passageOverlap * 120 + (rec.passages?.some((p: any) => p.testament === 'OT') && rec.passages?.some((p: any) => p.testament === 'NT') ? 45 : 0);
    const witnessBonus = Math.min(60, (rec.passages?.length || 1) * 12);
    const singleConceptInMultiPenalty = multiConcept && effectiveConceptMatches < 2 && passageOverlap === 0 ? 320 : 0;
    const commonWordPenalty = matchedQueryTerms.length === 1 && ['water', 'spirit', 'earth', 'blood', 'light', 'jesus'].includes(matchedQueryTerms[0]) && passageOverlap === 0 ? 120 : 0;
    const numberCoincPenalty = rec.number_classification?.coincidence_risk === 'high' ? 220 : 0;
    const orthPenalty = rec.predicate === 'orthographic_overlap' ? 180 : 0;
    const finalScore = Math.max(10, baseScore + specificityBonus + witnessBonus - singleConceptInMultiPenalty - commonWordPenalty - numberCoincPenalty - orthPenalty);

    allCandidates.push({
      ...rec,
      matched_terms: [...new Set([...matchedQueryTerms, ...matchedStrongsLabels])],
      score_components: {
        base_tier_score: baseScore,
        specificity_bonus: specificityBonus,
        witness_bonus: witnessBonus,
        common_word_penalty: commonWordPenalty,
        number_coincidence_penalty: numberCoincPenalty,
        orthographic_penalty: orthPenalty,
        final_score: finalScore,
      },
    });
  }

  // Synthesize dynamic motif pair evidence
  const motifArray = [...matchedMotifs];
  if (motifArray.length >= 2) {
    const md = await ensureMotifsData();
    const motifPairs = md?.motif_pairs ?? (
      md?.motif_pairs_b64gz
        ? await decodeB64Gz<Record<string, any>>(reader, md.motif_pairs_b64gz, `/r10/motif_pairs:${releaseId}`, budget.b64Cache)
        : undefined
    );
    for (let i = 0; i < motifArray.length; i++) {
      for (let j = i + 1; j < motifArray.length; j++) {
        const [a, b] = [motifArray[i], motifArray[j]].sort();
        const pair = motifPairs?.[`${a}|${b}`];
        if (!pair || !pair.passages?.length) continue;
        const mA = md?.motifs?.[a];
        const mB = md?.motifs?.[b];
        const evId = `r10:synth:motifpair:${a}:${b}`;
        const words = [...(mA?.original_words || []).slice(0, 3), ...(mB?.original_words || []).slice(0, 3)];
        allCandidates.push({
          evidence_id: evId,
          predicate: 'shared_motif',
          evidence_tier: 5,
          epistemic_class: 'shared_motif_evidence',
          title: `Co-occurring biblical motifs: ${mA?.label || a} + ${mB?.label || b} (${pair.count} shared verses)`,
          summary: `Deterministic corpus scan found ${pair.count} verses containing both motifs (${pair.passages.slice(0, 4).map((p: any) => p.ref).join(', ')}). Co-occurrence indicates shared imagery within those verses; context decides whether a theological or typological link exists.`,
          source_node_id: `motif:${a}`,
          target_node_id: `motif:${b}`,
          passages: pair.passages.slice(0, 6),
          original_words: words,
          matched_terms: [a, b],
          limitations: ['Motif co-occurrence does not automatically prove deliberate literary allusion across separate books.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek (31,146 verses scanned)',
            source_record_ids: pair.passages.slice(0, 4).map((p: any) => p.ref),
            license: 'CC BY 4.0',
            derivation_method: 'deterministic_verse_motif_intersection',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[5],
            specificity_bonus: Math.min(80, pair.count * 2),
            witness_bonus: Math.min(50, pair.passages.length * 8),
            common_word_penalty: pair.count > 40 ? 90 : 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[5] + Math.min(80, pair.count * 2) - (pair.count > 40 ? 90 : 0),
          },
        });
      }
    }
  }

  // Dynamic Number Entity checks
  if (matchedNumbers.size > 0) {
    const numbersData = await readR10Json<{ by_value?: Record<string, any> }>(reader, releaseId, 'numbers-index.json.gz', budget);
    if (numbersData?.by_value) {
      for (const nVal of matchedNumbers) {
        const bucket = numbersData.by_value[String(nVal)];
        if (!bucket) continue;
        const relevantGroups = (bucket.groups || []).filter((g: any) =>
          resolvedConcepts.every(c => c.resolution_kind === 'number') ||
          matchedStrongs.has(g.noun_s) ||
          queryTermSet.has(normalizeToken(g.noun_g).split(/\s+/)[0] || '') ||
          g.kind === 'symbolic_vision_count'
        ).slice(0, 4);

        for (const grp of relevantGroups) {
          const isHighCoinc = grp.kind === 'temporal_duration' || grp.count > 25;
          const tier: R10EvidenceTier = grp.kind === 'symbolic_vision_count' ? 4 : 6;
          const pen = isHighCoinc ? 220 : 0;
          const passages: R10PassageRef[] = (grp.samples || []).slice(0, 5).map((s: any) => ({
            verse_id: s.vid,
            ref: s.ref,
            book: s.book,
            chapter: s.ch,
            verse: s.vs,
            testament: s.book <= 39 ? 'OT' : 'NT',
          }));
          allCandidates.push({
            evidence_id: `r10:synth:num:${nVal}:${grp.noun_s}:${grp.kind}`,
            predicate: 'numbered_entity',
            evidence_tier: tier,
            epistemic_class: 'direct_textual_evidence',
            title: `Counted entity (${grp.kind.replace(/_/g, ' ')}): ${nVal} × ${grp.noun_lm} ("${grp.noun_g}", ${grp.count}× in Scripture)`,
            summary: `Syntactic numeral-noun extraction shows ${nVal} modifying ${grp.noun_lm} (${grp.noun_s}, "${grp.noun_g}") across ${grp.count} occurrences (e.g., ${passages.slice(0, 3).map(p => p.ref).join(', ')}).`,
            source_node_id: `number:${nVal}`,
            target_node_id: `lemma:${grp.noun_s}`,
            passages,
            original_words: lemmaCache.has(grp.noun_s) ? [lemmaCache.get(grp.noun_s)!] : [],
            matched_terms: [String(nVal), normalizeToken(grp.noun_g)],
            number_classification: {
              number_value: nVal,
              counted_entity: `${grp.noun_lm} (${grp.noun_g})`,
              kind: grp.kind as R10NumberKind,
              coincidence_risk: isHighCoinc ? 'high' : 'low',
              note: isHighCoinc ? 'High-frequency temporal or ordinary count; shared number alone does NOT establish symbolic equivalence.' : 'Specific counted object / vision entity.',
            },
            limitations: ['Counted-entity matches prove the syntactic numeral+noun phrase appears; theological typology requires contextual or authorial links.'],
            provenance: { source_dataset: 'MACULA Hebrew & Greek syntactic numerals', source_record_ids: passages.slice(0, 3).map(p => p.ref), license: 'CC BY 4.0', derivation_method: 'syntactic_numeral_noun_extraction' },
            score_components: {
              base_tier_score: TIER_BASE_SCORE[tier],
              specificity_bonus: matchedStrongs.has(grp.noun_s) ? 90 : 20,
              witness_bonus: Math.min(40, grp.count * 4),
              common_word_penalty: 0,
              number_coincidence_penalty: pen,
              orthographic_penalty: 0,
              final_score: TIER_BASE_SCORE[tier] + (matchedStrongs.has(grp.noun_s) ? 90 : 20) - pen,
            },
          });
        }
      }
    }
  }

  // Dynamic Orthographic shard lookup
  const hebStrongs = [...matchedStrongs].filter(s => s.startsWith('H')).slice(0, 3);
  const orthDetails: any[] = [];
  for (const hs of hebStrongs) {
    if (fastManifest?.direct_b64gz && profileByStrongs.has(hs)) {
      const entry = profileByStrongs.get(hs)!.orth_entry;
      if (entry) orthDetails.push(entry);
    } else {
      const bHex = computeBucketHex('fnv1a64_mod64', 64, hs);
      const orthShard = await readR10Json<{ entries?: Record<string, any> }>(reader, releaseId, `orthographic/shard-${bHex}.json.gz`, budget);
      const entry = orthShard?.entries?.[hs];
      if (entry) orthDetails.push(entry);
    }
  }

  // R12 Pilot Integration: merge offline 2-5 hop beam recommendations, external property bridges,
  // structural clause parallels, and orthographic candidates for matched pilot anchors.
  const r12AnchorsMatched: string[] = [];
  let r12MultihopCount = 0;
  let r12PropertyCount = 0;
  let r12StructuralCount = 0;
  let r12OrthographicCount = 0;
  let r12TailCursor: string | null = null;
  let r12ScoreVersion = 'r12-ranker-v1';
  let r12ExternalSources: Array<{ id: string; provider: string; release: string; license: string }> = [];

  const pilotCandidateKeys = new Set<string>(matchedStrongs);
  if (query.focus_lemma) pilotCandidateKeys.add(query.focus_lemma);
  if (query.anchor?.extended_strongs) pilotCandidateKeys.add(query.anchor.extended_strongs.replace(/([HG])0*(\d+)[A-Z]?/i, (_, p, n) => p + n.padStart(4, '0')));
  if (pilotCandidateKeys.size > 0 && (fastManifest?.r12_pilot_embedded || fastManifest?.r12_pilot)) {
    const resolvedPilotAnchors: Array<[string, any]> = [];
    if (fastManifest.r12_pilot_embedded) {
      r12ScoreVersion = fastManifest.r12_score_version || 'r12-ranker-v1';
      r12ExternalSources = (fastManifest.r12_external_sources || []).map(s => ({
        id: s.id,
        provider: s.provider,
        release: s.release,
        license: s.license,
      }));
      const pilotSet = new Set(fastManifest.r12_pilot_anchors_list || []);
      for (const bs of pilotCandidateKeys) {
        if (!pilotSet.has(bs)) continue;
        const anchorData =
          profileByStrongs.get(bs)?.r12_pilot_anchor ??
          (await readProfile(reader, releaseId, fastManifest, bs, budget))?.r12_pilot_anchor;
        if (anchorData) resolvedPilotAnchors.push([bs, anchorData]);
      }
    } else if (fastManifest.r12_pilot) {
      const r12Pilot = await readR12Pilot(reader, releaseId, fastManifest, budget);
      if (r12Pilot?.anchors) {
        r12ScoreVersion = r12Pilot.score_version || 'r12-ranker-v1';
        r12ExternalSources = (r12Pilot.external_sources || []).map(s => ({
          id: s.id,
          provider: s.provider,
          release: s.release,
          license: s.license,
        }));
        for (const bs of pilotCandidateKeys) {
          const anchorData = r12Pilot.anchors[bs];
          if (anchorData) resolvedPilotAnchors.push([bs, anchorData]);
        }
      }
    }
    for (const [bs, anchorData] of resolvedPilotAnchors) {
      r12AnchorsMatched.push(bs);

      const recs: any[] = anchorData.multihop?.recommendations || [];
      const takeRecs = (query.mode === 'expand' || query.focus_lemma === bs) ? recs.slice(0, 12) : recs.slice(0, 8);
      for (const rec of takeRecs) {
        allCandidates.push(r12MultihopRecToRecord(anchorData, rec));
        r12MultihopCount++;
      }
      if ((anchorData.multihop?.unreturned_destinations || 0) > 0 && !r12TailCursor) {
        r12TailCursor = String(offset + limit);
      }

      const props: any[] = anchorData.property_bridges || [];
      for (const b of props.slice(0, 6)) {
        allCandidates.push(r12PropertyBridgeToRecord(anchorData, b));
        r12PropertyCount++;
      }

      const structs: any[] = anchorData.structural_candidates || [];
      for (const s of structs.slice(0, 3)) {
        allCandidates.push(r12StructuralToRecord(anchorData, s));
        r12StructuralCount++;
      }

      const orths: any[] = [...(anchorData.orthographic_candidates || [])].sort(
        (a, b) => Number((b.cooccurrence_verses || 0) > 0) - Number((a.cooccurrence_verses || 0) > 0) || (b.score || 0) - (a.score || 0)
      );
      for (const o of orths.slice(0, 5)) {
        allCandidates.push(r12OrthographicToRecord(anchorData, o));
        r12OrthographicCount++;
      }
    }
  }

  // Filter and rank candidates
  const filters = query.filters || {};
  let filtered = allCandidates.filter(c => {
    if (filters.predicates?.length && !filters.predicates.includes(c.predicate)) return false;
    if (filters.max_tier && c.evidence_tier > filters.max_tier) return false;
    if (filters.include_orthographic === false && (c.predicate === 'orthographic_overlap' || c.predicate === 'orthographic_wordplay')) return false;
    if (filters.include_candidate_patterns === false && (c.predicate === 'literary_pattern' || c.predicate === 'structural_scene_parallel')) return false;
    if (filters.include_interpretive === false && c.predicate === 'interpretive_hypothesis') return false;
    if (filters.testaments?.length && !c.passages.some(p => filters.testaments!.includes(p.testament))) return false;
    return true;
  });

  // Apply bridge-mode weighting before sorting
  if (query.mode === 'bridge') {
    filtered = filtered.map((rec) => {
      const id = rec.evidence_id || '';
      const isCrossTest = rec.passages.some(p => p.testament === 'OT') && rec.passages.some(p => p.testament === 'NT');
      const isBridgeCand =
        id.startsWith('r11:lxx:') ||
        id.startsWith('r11:xref:') ||
        id.startsWith('r12:prop:') ||
        (id.startsWith('r12:path:') && isCrossTest);
      if (!isBridgeCand) return rec;
      return {
        ...rec,
        score_components: {
          ...rec.score_components,
          specificity_bonus: rec.score_components.specificity_bonus + 130,
          final_score: rec.score_components.final_score + 130,
        },
      };
    });
  }

  const sharedWitnesses = (record: R10EvidenceRecord) => conceptGroups.length >= 2
    ? record.passages.filter(p => conceptGroups.every(g => g.vids.has(p.verse_id))) : [];
  const supportClass = (record: R10EvidenceRecord): 'all_concepts' | 'meaningful_subset' | 'background' => {
    if (conceptGroups.length < 2) return 'background';
    if (record.predicate === 'orthographic_overlap' || record.predicate === 'interpretive_hypothesis') return 'background';
    if (sharedWitnesses(record).length && missingConcepts.length === 0) return 'all_concepts';
    return (record.passages.some(p => conceptGroups.filter(g => g.vids.has(p.verse_id)).length >= 2) ||
      (record.provenance.derivation_method === 'pericope_window_intersection' &&
        conceptGroups.filter(g => record.passages.some(p => g.vids.has(p.verse_id))).length >= 2))
      ? 'meaningful_subset' : 'background';
  };
  const supportRank = { all_concepts: 2, meaningful_subset: 1, background: 0 };
  filtered.sort((a, b) => supportRank[supportClass(b)] - supportRank[supportClass(a)] ||
    b.score_components.final_score - a.score_components.final_score || a.evidence_tier - b.evidence_tier);

  const uniqueMap = new Map<string, R10EvidenceRecord>();
  for (const item of filtered) {
    if (!uniqueMap.has(item.evidence_id)) uniqueMap.set(item.evidence_id, item);
  }
  const dedupedList = [...uniqueMap.values()];
  const familyCounts = new Map<string, number>();
  const rankedAll = dedupedList.map((item) => {
    const family = item.evidence_id.split(':').slice(0, 2).join(':');
    const seen = (familyCounts.get(family) || 0) + 1;
    familyCounts.set(family, seen);
    const grace = family === 'r12:path' ? 5 : 2;
    if (seen <= grace) return item;
    const pen = (seen - grace) * 55;
    return {
      ...item,
      score_components: {
        ...item.score_components,
        final_score: Math.max(10, item.score_components.final_score - pen),
      },
    };
  });
  rankedAll.sort((a, b) => supportRank[supportClass(b)] - supportRank[supportClass(a)] ||
    b.score_components.final_score - a.score_components.final_score || a.evidence_tier - b.evidence_tier);

  // G. Complete Occurrence Pagination
  const focusProf = (query.focus_lemma ? profileByStrongs.get(query.focus_lemma) : null) ||
    loadedProfiles[0] || null;

  let targetVids: number[] = [];
  if (focusProf) {
    if (query.cluster_id) {
      const cl = focusProf.clusters?.find(c => c.cluster_id === query.cluster_id);
      targetVids = cl ? cl.vids : focusProf.all_vids;
    } else {
      targetVids = focusProf.all_vids;
    }
  }

  const occLimit = limit;
  const occOffset = offset;
  const pagedOccVids = targetVids.slice(occOffset, occOffset + occLimit);
  let hasMoreOcc = occOffset + occLimit < targetVids.length;

  let hydratedOccPassages: R10PassageRef[] = [];
  if (
    !query.cluster_id &&
    occOffset === 0 &&
    focusProf?.first_occ_passages?.length &&
    pagedOccVids.length > 0 &&
    (occLimit <= focusProf.first_occ_passages.length || pagedOccVids.length <= focusProf.first_occ_passages.length)
  ) {
    hydratedOccPassages = focusProf.first_occ_passages.slice(0, pagedOccVids.length);
  } else {
    for (const vid of pagedOccVids) {
      const p = await hydratePassageByVid(vid);
      if (!p) break;
      hydratedOccPassages.push(p);
    }
  }
  hasMoreOcc = occOffset + hydratedOccPassages.length < targetVids.length;

  // When expanding or paging through occurrences, synthesize individual occurrence evidence cards
  if ((query.mode === 'expand' || query.focus_lemma || query.cluster_id || offset >= rankedAll.length) && focusProf) {
    for (const p of hydratedOccPassages) {
      const occEvId = `r11:occ:${focusProf.bs}:${p.verse_id}`;
      if (!uniqueMap.has(occEvId)) {
        const rec: R10EvidenceRecord = {
          evidence_id: occEvId,
          predicate: 'verified_lexical_grammatical',
          evidence_tier: 3,
          epistemic_class: 'direct_textual_evidence',
          title: `Attested occurrence: ${focusProf.sc} (${focusProf.tr}) in ${p.ref}`,
          summary: `Attested biblical occurrence of ${focusProf.sc} (${focusProf.bs}, "${focusProf.gl}") in ${p.ref}: "${p.snippet || ''}".`,
          source_node_id: `lemma:${focusProf.bs}`,
          target_node_id: `passage:${p.ref}`,
          passages: [p],
          original_words: [{
            strongs: focusProf.bs,
            lemma_key: focusProf.lk,
            language: focusProf.lang,
            lemma_script: focusProf.sc,
            transliteration: focusProf.tr,
            gloss: focusProf.gl,
          }],
          matched_terms: [focusProf.gl, focusProf.sc, focusProf.bs],
          limitations: ['Individual verse occurrence; context defines specific grammatical role and semantic nuance.'],
          provenance: {
            source_dataset: 'MACULA + STEPBible',
            source_record_ids: [p.ref],
            license: 'CC BY 4.0',
            derivation_method: 'canonical_verse_attestation',
          },
          score_components: {
            base_tier_score: 760,
            specificity_bonus: 60,
            witness_bonus: 10,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: 830,
          },
        };
        rankedAll.push(rec);
        uniqueMap.set(occEvId, rec);
      }
    }
  }

  const pagedRecords = rankedAll.slice(offset, offset + limit);

  // H. Summaries with Research-Grade Rationale
  const summaries: R10ConnectionSummary[] = pagedRecords.map(r => {
    const penalties: string[] = [];
    if (r.score_components.common_word_penalty > 0) penalties.push(`common_word_penalty(-${r.score_components.common_word_penalty})`);
    if (r.score_components.number_coincidence_penalty > 0) penalties.push(`number_coincidence_penalty(-${r.score_components.number_coincidence_penalty})`);
    if (r.score_components.orthographic_penalty > 0) penalties.push(`orthographic_penalty(-${r.score_components.orthographic_penalty})`);

    const whyRationale = `Tier ${r.evidence_tier} (${r.epistemic_class.replace(/_/g, ' ')}). Base score ${r.score_components.base_tier_score} with specificity bonus +${r.score_components.specificity_bonus} and witness corroboration +${r.score_components.witness_bonus} across ${r.passages.length} attested passages.${penalties.length > 0 ? ` Penalties: ${penalties.join(', ')}.` : ''}`;

    const clusterIdMatch = r.evidence_id.startsWith('r11:cluster:')
      ? r.evidence_id.replace('r11:cluster:', '')
      : undefined;

    return {
      connection_id: r.evidence_id,
      query_support: supportClass(r),
      shared_witness_refs: sharedWitnesses(r).map(p => p.ref),
      evidence_id: r.evidence_id,
      title: r.title,
      explanation: r.summary,
      predicate: r.predicate,
      evidence_tier: r.evidence_tier,
      epistemic_class: r.epistemic_class,
      score: r.score_components.final_score,
      confidence_label: confidenceFromRecord(r),
      uncertainty_note: r.limitations[0] || defaultUncertainty(r),
      matched_concepts: r.matched_terms,
      passages: r.passages,
      original_words: r.original_words,
      witness_count: Math.max(1, r.provenance?.source_record_ids?.length || r.passages.length),
      penalties_applied: penalties,
      cluster_id: clusterIdMatch,
      ranking_rationale: {
        base_tier_score: r.score_components.base_tier_score,
        specificity_bonus: r.score_components.specificity_bonus,
        witness_bonus: r.score_components.witness_bonus,
        penalties,
        final_score: r.score_components.final_score,
        why_ranked_high: whyRationale,
      },
      ...(r.r12_metadata ? { r12_metadata: r.r12_metadata } : {}),
    };
  });

  // Multi-cluster bridges if not already populated
  if (clusters.length >= 2 && bridges.length === 0) {
    for (let i = 0; i < clusters.length - 1; i++) {
      const cA = clusters[i];
      const cB = clusters[i + 1];
      const bridgeNode = cA.anchor_nodes.find(n => n.kind === 'lemma') || cB.anchor_nodes.find(n => n.kind === 'lemma') || cA.anchor_nodes[0];
      if (bridgeNode) {
        bridges.push({
          bridge_id: `bridge:${cA.cluster_id}:${cB.cluster_id}`,
          from_cluster_id: cA.cluster_id,
          to_cluster_id: cB.cluster_id,
          bridging_node: bridgeNode,
          evidence_id: summaries[0]?.evidence_id || '',
          evidence_tier: summaries[0]?.evidence_tier || 3,
          explanation: `Subclusters stay distinct rather than forced into one chain; linked via shared biblical concept ${bridgeNode.label}.`,
        });
      }
    }
  }

  // Construct Connection Paths from top evidence records (multi-step for R12 proof paths)
  const connectionPaths: R10ConnectionPath[] = pagedRecords.slice(0, 8).map(r => {
    if (r.r12_metadata?.steps?.length) {
      const steps = r.r12_metadata.steps;
      const firstSt = steps[0];
      const lastSt = steps[steps.length - 1];
      const startNode: R10Node = {
        id: firstSt.from_id,
        kind: 'lemma',
        label: firstSt.from_label,
        epistemic_class: r.epistemic_class,
        grounding_source: firstSt.source_dataset || r.provenance.source_dataset,
      };
      const endNode: R10Node = {
        id: lastSt.to_id,
        kind: 'lemma',
        label: lastSt.to_label,
        epistemic_class: r.epistemic_class,
        grounding_source: lastSt.source_dataset || r.provenance.source_dataset,
      };
      return {
        path_id: `path:${r.evidence_id}`,
        start_node: startNode,
        end_node: endNode,
        matched_concepts: r.matched_terms,
        weakest_tier: r.evidence_tier,
        aggregate_score: r.score_components.final_score,
        explanation: r.summary,
        limitations: r.limitations,
        steps: steps.map(st => ({
          from_node_id: st.from_id,
          from_label: st.from_label,
          to_node_id: st.to_id,
          to_label: st.to_label,
          predicate: r.predicate,
          evidence_tier: r.evidence_tier,
          epistemic_class: r.epistemic_class,
          evidence_id: r.evidence_id,
          relation_summary: `${st.relation_type} (${st.epistemic_layer}, q=${st.quality_weight}${st.witness_refs?.length ? `, refs=${st.witness_refs.slice(0, 2).join(', ')}` : ''})`,
          key_passage: r.passages[0],
        })),
      };
    }

    const startP = r.passages[0];
    const endP = r.passages[r.passages.length - 1];
    const startNode: R10Node = startP
      ? { id: `passage:${startP.ref}`, kind: 'passage', label: startP.ref, passage: startP, epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset }
      : { id: r.source_node_id, kind: 'concept', label: r.source_node_id.replace(/^[a-z]+:/, ''), epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset };
    const endNode: R10Node = endP && endP.ref !== startP?.ref
      ? { id: `passage:${endP.ref}`, kind: 'passage', label: endP.ref, passage: endP, epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset }
      : { id: r.target_node_id, kind: 'concept', label: r.target_node_id.replace(/^[a-z]+:/, ''), epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset };
    return {
      path_id: `path:${r.evidence_id}`,
      start_node: startNode,
      end_node: endNode,
      matched_concepts: r.matched_terms,
      weakest_tier: r.evidence_tier,
      aggregate_score: r.score_components.final_score,
      explanation: r.summary,
      limitations: r.limitations,
      steps: [{
        from_node_id: startNode.id,
        from_label: startNode.label,
        to_node_id: endNode.id,
        to_label: endNode.label,
        predicate: r.predicate,
        evidence_tier: r.evidence_tier,
        epistemic_class: r.epistemic_class,
        evidence_id: r.evidence_id,
        relation_summary: r.title,
        key_passage: startP,
      }],
    };
  });

  // Additional thematic controls
  if (matchedMotifs.has('lampstand') || matchedMotifs.has('lamp') || queryTermSet.has('seven')) {
    controls.push({
      control_id: 'ctrl:rev1_20_vs_rev4_5',
      kind: 'distinct_context_warning',
      title: 'Distinct imagery control: Rev 1:20 lampstands (λυχνίαι = churches) vs Rev 4:5 lamps (λαμπάδες = Spirits)',
      explanation: 'Revelation explicitly gives different referents for the seven lampstands (Rev 1:20 = seven churches) and the seven burning lamps (Rev 4:5 = seven Spirits of God). Do not merge all "seven + lamp" references into one meaning.',
    });
  }
  if (queryTermSet.has('seven') || queryTermSet.has('7') || queryTermSet.has('four') || queryTermSet.has('4')) {
    controls.push({
      control_id: 'ctrl:number_coincidence_guard',
      kind: 'number_coincidence_warning',
      title: 'Number coincidence guard: shared numeral alone does not prove theological connection',
      explanation: 'Ordinal occurrences, temporal durations, and unrelated ordinary counts are separated from symbolic vision counts and penalized when context differs.',
    });
  }
  if (queryTermSet.has('baptism') || queryTermSet.has('sea') || queryTermSet.has('exodus')) {
    controls.push({
      control_id: 'ctrl:exod14_event_vs_paul_typology',
      kind: 'alternative_explanation',
      title: 'Historical event vs later NT typology (Exodus 14 vs 1 Corinthians 10:1–2)',
      explanation: 'Exodus 14 narrates historical deliverance without baptism vocabulary; Paul in 1 Cor 10:1–2 introduces the typological comparison. Avoid reading later baptismal symbolism into every Exodus 14 detail.',
    });
  }
  if (queryTermSet.has('adam') && queryTermSet.has('dam') || hebStrongs.some(s => s === 'H0120' || s === 'H1818')) {
    controls.push({
      control_id: 'ctrl:adam_dam_not_etymology',
      kind: 'orthographic_false_positive_warning',
      title: 'Orthographic false-etymology guard: אָדָם (adam) vs דָּם (dam)',
      explanation: 'While אָדָם (ʾ-d-m) orthographically contains ד-ם (d-m, blood), STEPBible/BDB treat them as distinct lexical entries with NO proven common historical root. Contrast this weak spelling overlap with the explicit Hebrew wordplay אָדָם ↔ אֲדָמָה (ground) in Gen 2:7.',
    });
  }
  if (missingConcepts.length > 0) {
    controls.push({
      control_id: 'ctrl:missing_concepts',
      kind: 'missing_evidence',
      title: `Unresolved or unsupported query terms: ${missingConcepts.join(', ')}`,
      explanation: 'These terms did not match canonical original-language lemmas, motifs, or events in the index; no fabricated connections were added.',
    });
  }

  for (const od of orthDetails) {
    if (od.homographs?.length) {
      controls.push({
        control_id: `ctrl:orth_homograph:${od.bs}`,
        kind: 'homograph_disambiguation',
        title: `Hebrew consonantal homograph notice for ${od.script} (${od.bs})`,
        explanation: `${od.script} (${od.cons}) shares its unpointed consonantal skeleton with distinct entry ${od.homographs.map((h: any) => `${h.script} (${h.bs} "${h.gloss}")`).join(', ')}.`,
      });
    }
  }

  // I. Iterative Analysis Mode Construction
  const effectiveMode = query.mode || 'discover';
  const iterativeAnalysis: DiscoverConnectionsResult['iterative_analysis'] = {
    mode: effectiveMode,
  };

  if (effectiveMode === 'expand') {
    iterativeAnalysis.explanation = `Expanded deep occurrence analysis for ${focusProf ? `${focusProf.sc} (${focusProf.bs}, "${focusProf.gl}")` : query.query}. Total attested canonical verses: ${targetVids.length}.`;
  } else if (effectiveMode === 'bridge') {
    iterativeAnalysis.explanation = `Conceptual bridge analysis connecting distinct semantic domains via intermediate original-language hubs.`;
    iterativeAnalysis.bridges = bridges;
  } else if (effectiveMode === 'compare') {
    iterativeAnalysis.explanation = `Comparative distribution across canonical corpora and semantic clusters.`;
    iterativeAnalysis.comparison = {
      targets: query.compare_targets || extractedTerms,
      clusters: clusters.map(c => ({ id: c.cluster_id, label: c.label, passages_count: c.total_passages })),
      differences: 'Examines genre variations (narrative architecture vs poetic imagery vs superscriptions) and canonical testament distribution.',
    };
  } else if (effectiveMode === 'explain') {
    iterativeAnalysis.explanation = `Hermeneutical rationale: synthesis of Tier 1-3 source-grounded evidence records, separating direct grammatical/textual facts from later interpretive traditions.`;
  } else if (effectiveMode === 'challenge') {
    iterativeAnalysis.explanation = `Negative controls, disambiguation guards, and homograph boundaries.`;
    iterativeAnalysis.challenges = controls;
  }

  if (focusProf && targetVids.length > 0) {
    iterativeAnalysis.lemma_occurrences = {
      strongs: focusProf.bs,
      total_verses: targetVids.length,
      offset: occOffset,
      returned: hydratedOccPassages.length,
      next_cursor: hasMoreOcc ? String(occOffset + hydratedOccPassages.length) : null,
      has_more: hasMoreOcc,
      passages: hydratedOccPassages,
    };
  }

  const totalAvailable = rankedAll.length;
  const hasMore = offset + pagedRecords.length < totalAvailable;
  const elapsedMs = Math.max(1, Date.now() - tStart);

  return {
    schema_version: 1,
    status: pagedRecords.length > 0 ? (missingConcepts.length > 0 ? 'partial' : 'ok') : 'no_match',
    release_id: releaseId,
    parsed_query: {
      raw_query: query.query,
      extracted_terms: extractedTerms,
      explicit_passages: explicitPassages,
      resolved_concepts: resolvedConcepts,
      missing_concepts: missingConcepts,
      multi_cluster_mode: clusters.length >= 2,
    },
    strongest_connections: summaries,
    clusters,
    bridges,
    connection_paths: connectionPaths,
    related_discoveries: {
      additional_motifs: [...matchedMotifs].map(mId => ({
        motif_id: mId,
        label: motifsData?.motifs?.[mId]?.label || mId,
        summary: `Verified original-language motif occurrences across ${motifsData?.motifs?.[mId]?.total_verses || 0} verses.`,
        passage_count: motifsData?.motifs?.[mId]?.total_verses || 0,
      })),
      roots_and_wordplay: summaries.filter(s => s.predicate === 'orthographic_wordplay' || s.predicate === 'orthographic_overlap' || s.predicate === 'cross_language_bridge'),
      cross_references: crossReferencesOut,
      literary_parallels: summaries.filter(s => s.predicate === 'literary_pattern' || s.predicate === 'literary_correspondence'),
      biblical_events: matchedEvents.slice(0, 6).map(e => ({
        event_id: e.event_id,
        title: e.title,
        timing_label: e.start_date || undefined,
        passages: e.passages.slice(0, 4),
      })),
    },
    controls_and_alternatives: controls,
    pagination: {
      total_available: totalAvailable,
      returned: summaries.length,
      next_cursor: hasMore ? String(offset + limit) : null,
      has_more: hasMore,
    },
    search_metadata: {
      // Exhausting bounded generated candidates is not exhaustive corpus discovery.
      exhaustive: false,
      scope: 'Bounded candidate discovery over selected lemma profiles; occurrence pagination is complete only for its selected lemma and source editions.',
      resolution_state: resolvedConcepts.length || explicitPassages.length ? 'known_concept' : 'unknown_concept',
      occurrence_state: loadedProfiles.some(p => p.total_verses > 0) || explicitPassages.some(p => p.verse_id > 0) ? 'direct_occurrences_found' : 'no_indexed_occurrences',
      connection_state: totalAvailable ? 'connections_found' : 'no_higher_order_connections',
      completeness_state: budget.used >= budget.max ? 'resource_limits_reached' : budget.missing.length ? 'missing_source_coverage' : 'search_incomplete',
      missing_assets: budget.missing,
      occurrence_scope: focusProf ? { lemma: focusProf.bs, total_verses: targetVids.length,
        page_complete: hydratedOccPassages.length === pagedOccVids.length,
        pagination_complete: !hasMoreOcc && hydratedOccPassages.length === pagedOccVids.length,
        source_scope: 'Indexed canonical verse witnesses from MACULA Hebrew, Nestle1904 and STEP; LXX correspondences reported separately.' } : undefined,
      bounded_by: [
        `limit=${limit}`,
        `max_subrequests=${budget.max}`,
        `used_subrequests=${budget.used}`,
      ],
      asset_requests_used: budget.used,
      execution_ms: elapsedMs,
      source_attribution: [
        'STEPBible TBESH/TBESG/TAHOT/TAGNT (CC BY 4.0)',
        'MACULA Hebrew & Greek (CC BY 4.0)',
        'CrossReferences.org / OpenBible (CC BY 4.0)',
        'Theographic Bible Data (CC BY-SA 4.0)',
        'World English Bible (Public Domain)',
        ...(r12PropertyCount > 0
          ? ['Open English WordNet 2025 (CC BY 4.0 / Princeton WordNet attribution)', 'Wikidata Structured Concept Extract (CC0 1.0)']
          : []),
      ],
    },
    iterative_analysis: iterativeAnalysis,
    ...(r12AnchorsMatched.length > 0
      ? {
          r12_discovery: {
            schema_version: 1,
            release_id: fastManifest?.r12_version || 'r12-discovery-2',
            score_version: r12ScoreVersion,
            pilot_anchors_matched: [...new Set(r12AnchorsMatched)],
            multihop_recommendations_count: r12MultihopCount,
            property_bridges_count: r12PropertyCount,
            structural_candidates_count: r12StructuralCount,
            orthographic_candidates_count: r12OrthographicCount,
            exploratory_tail_cursor: r12TailCursor,
            external_sources: r12ExternalSources,
          },
        }
      : {}),
  };
}

export async function getConnectionEvidence(
  reader: AssetReader,
  evidenceId: string,
  releaseId: string = DEFAULT_R10_RELEASE
): Promise<ConnectionEvidenceResult> {
  const budget = { used: 0, max: MAX_SUBREQUEST_BUDGET, missing: [] as string[], b64Cache: new Map<string, any>() };
  const fastManifest = await readR10Json<FastManifest>(reader, releaseId, 'fast-manifest.json.gz', budget);
  let record: R10EvidenceRecord | null = null;
  const targetStrongs = new Set<string>();

  const { bookCache, chunkMetaCache, loadBookData, hydratePassageByVid } = createPassageHydrator(
    reader, releaseId, fastManifest, budget, true,
  );

  // Handle R11 synthesized dynamic evidence IDs
  if (evidenceId.startsWith('r11:cluster:')) {
    const clId = evidenceId.replace('r11:cluster:', '');
    const bs = clId.split(':')[0];
    targetStrongs.add(bs);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const cl = prof?.clusters?.find((c: any) => c.cluster_id === clId);
    if (prof && cl) {
      let tier: R10EvidenceTier = 3;
      let predicate: R10Predicate = 'verified_lexical_grammatical';
      let epistemicClass: R10EpistemicClass = 'direct_textual_evidence';
      let limitations = ['Evidence-derived corpus cluster based on syntactic and lexical co-occurrence.'];

      if (cl.category === 'temple_and_sanctuary_architecture') {
        const hasArchColloc = (cl.collocated_words || []).some((w: any) =>
          ['pillar', 'cup', 'brim', 'handbreadth', 'thickness', 'bath', 'deed'].some(k => w.gl.toLowerCase().includes(k))
        ) || (cl.xrefs || []).length > 0;
        tier = hasArchColloc ? 2 : 3;
        limitations = ['Sanctuary and Temple architecture descriptions; physical ornamentation rather than metaphorical or typological discourse.'];
      } else if (cl.category === 'psalm_superscription') {
        tier = 3;
        epistemicClass = 'documented_lexical_relationship';
        limitations = ['Psalm heading / musical or liturgical superscription; whether the expression denotes a tune, instrument, or floral motif is uncertain in source text.'];
      } else if (['poetic_imagery_and_similes', 'prophetic_imagery_and_oracles', 'gospel_and_nt_teaching'].includes(cl.category)) {
        if (cl.has_simile) {
          tier = 2;
          predicate = 'explicit_comparison';
          limitations = ['Explicit comparative simile in biblical text; context determines the extent of figurative correspondence.'];
        } else {
          tier = 3;
          limitations = ['Attested imagery in poetic or prophetic discourse.'];
        }
      }

      record = {
        evidence_id: evidenceId,
        predicate,
        evidence_tier: tier,
        epistemic_class: epistemicClass,
        title: cl.label,
        summary: cl.summary,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `cluster:${cl.cluster_id}`,
        passages: cl.sample_passages.map((p: any) => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        })),
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
        ],
        matched_terms: [prof.gl, prof.sc, prof.bs],
        limitations,
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek + STEPBible',
          source_record_ids: cl.sample_passages.map((p: any) => p.ref),
          license: 'CC BY 4.0',
          derivation_method: 'evidence_derived_semantic_cluster',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[tier],
          specificity_bonus: 80,
          witness_bonus: 40,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: TIER_BASE_SCORE[tier] + 120,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:gram:')) {
    const [, , bs, pred, relStrongs] = evidenceId.split(':');
    targetStrongs.add(bs);
    targetStrongs.add(relStrongs);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const gr = prof?.grammatical_relations?.find((g: any) => g.predicate === pred && g.related_strongs === relStrongs);
    if (prof && gr && (gr.witnesses === undefined || gr.witnesses.length > 0)) {
      const gTier: R10EvidenceTier = (gr.independent_witness_count ?? gr.occurrences) >= 2 ? 2 : 3;
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: gTier,
        epistemic_class: 'direct_textual_evidence',
        title: `${gr.display_label}: ${prof.sc} (${prof.tr}) ↔ ${gr.related_script} ("${gr.related_gloss}", ${gr.occurrences}×)`,
        summary: `Syntactic dependency analysis identifies direct grammatical connection (${gr.display_label}) between ${prof.sc} (${prof.bs}) and ${gr.related_script} (${gr.related_strongs}, "${gr.related_gloss}") across ${gr.occurrences} indexed occurrences.${gr.independent_witness_count !== undefined ? ` ${gr.independent_witness_count} distinct canonical source clauses pass token-position verification; parallel editions are counted once.` : ''}`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${gr.related_strongs}`,
        passages: gr.witnesses?.map(w => w.passage) || [],
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
          { strongs: gr.related_strongs, language: prof.lang, lemma_script: gr.related_script, transliteration: '', gloss: gr.related_gloss },
        ],
        matched_terms: [prof.gl, gr.related_gloss, prof.bs, gr.related_strongs],
        limitations: [gr.witnesses ? `Exact source relations; ${gr.independent_witness_count} distinct canonical clause witnesses. Parallel editions and mirrored paths do not add independent support.` : 'Legacy aggregate without attached matching witnesses; inspect grammatical relationship evidence before citing.', 'Syntactic construct/argument relation; shared grammar alone establishes no theological or authorial significance.'],
        provenance: {
          source_dataset: 'MACULA Hebrew/Greek Syntactic Trees',
          source_record_ids: gr.witnesses?.map(w => w.relation_id) || [],
          license: 'CC BY 4.0',
          derivation_method: 'syntactic_dependency_relation',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[gTier],
          specificity_bonus: 80,
          witness_bonus: 20,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: TIER_BASE_SCORE[gTier] + 100,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:occ:')) {
    const [, , bs, vidStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const vid = Number(vidStr);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const p = await hydratePassageByVid(vid);
    if (prof && p) {
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: 3,
        epistemic_class: 'direct_textual_evidence',
        title: `Attested occurrence: ${prof.sc} (${prof.tr}) in ${p.ref}`,
        summary: `Attested biblical occurrence of ${prof.sc} (${prof.bs}, "${prof.gl}") in ${p.ref}: "${p.snippet || ''}".`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `passage:${p.ref}`,
        passages: [p],
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
        ],
        matched_terms: [prof.gl, prof.sc, prof.bs],
        limitations: ['Individual verse occurrence; context defines specific grammatical role and semantic nuance.'],
        provenance: {
          source_dataset: 'MACULA + STEPBible',
          source_record_ids: [p.ref],
          license: 'CC BY 4.0',
          derivation_method: 'canonical_verse_attestation',
        },
        score_components: {
          base_tier_score: 760,
          specificity_bonus: 60,
          witness_bonus: 10,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: 830,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:intersect:verse:')) {
    const [, , , bsA, bsB, vidStr] = evidenceId.split(':');
    targetStrongs.add(bsA);
    targetStrongs.add(bsB);
    const vid = Number(vidStr);
    const p = await hydratePassageByVid(vid);
    if (p) {
      const vData = bookCache.get(p.book)?.[String(vid)];
      const toks: any[] = vData?.toks || [];
      if (bsA === bsB) {
        const distinctWn = new Set(toks.filter(t => t.s === bsA).map(t => t.wn));
        if (distinctWn.size < 2) {
          return {
            schema_version: 1,
            status: 'not_found',
            release_id: releaseId,
            evidence: null,
            passage_details: [],
            coverage: {
              state: 'available',
              missing_assets: budget.missing,
            },
          };
        }
      }
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: 2,
        epistemic_class: 'direct_textual_evidence',
        title: `Direct textual convergence in ${p.ref}`,
        summary: `Scripture text contains both ${bsA} and ${bsB} in the same verse (${p.ref}): "${p.snippet || ''}".`,
        source_node_id: `lemma:${bsA}`,
        target_node_id: `lemma:${bsB}`,
        passages: [p],
        original_words: [],
        matched_terms: [bsA, bsB],
        limitations: ['Direct intra-verse co-occurrence establishes textual contact; syntax and discourse function determine relationship.'],
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek',
          source_record_ids: [p.ref],
          license: 'CC BY 4.0',
          derivation_method: 'exact_verse_lemma_intersection',
        },
        score_components: {
          base_tier_score: 860,
          specificity_bonus: 180,
          witness_bonus: 40,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: 1080,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:polysemy:')) {
    const [, , bs, vidStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const vid = Number(vidStr);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const p = await hydratePassageByVid(vid);
    if (prof && p) {
      record = {
        evidence_id: evidenceId,
        predicate: 'interpretive_hypothesis',
        evidence_tier: 5,
        epistemic_class: 'documented_lexical_relationship',
        title: `Single-token polysemy notice for ${prof.sc} (${prof.bs}) in ${p.ref}`,
        summary: `Lexical polysemy across glosses of ${prof.sc} (${prof.bs}, "${prof.gl}") in ${p.ref}: "${p.snippet || ''}". One attested token does not establish independent co-occurrence.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${prof.bs}`,
        passages: [p],
        original_words: [{ lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl }],
        matched_terms: [prof.bs, prof.gl],
        limitations: ['Single source occurrence only; multiple English glosses of one polysemous word do not establish independent textual convergence.'],
        provenance: { source_dataset: 'MACULA Hebrew & Greek + STEPBible', source_record_ids: [p.ref], license: 'CC BY 4.0', derivation_method: 'single_token_polysemy_notice' },
        score_components: { base_tier_score: TIER_BASE_SCORE[5], specificity_bonus: 40, witness_bonus: 0, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: TIER_BASE_SCORE[5] + 40 },
      };
    }
  } else if (evidenceId.startsWith('r11:repeat:verse:')) {
    const [, , , bs, vidStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const vid = Number(vidStr);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const p = await hydratePassageByVid(vid);
    if (prof && p) {
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: 3,
        epistemic_class: 'direct_textual_evidence',
        title: `Repeated lemma in ${p.ref}: ${prof.sc} (${prof.bs})`,
        summary: `Distinct token occurrences of ${prof.sc} (${prof.bs}, "${prof.gl}") in ${p.ref}: "${p.snippet || ''}".`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `passage:${p.ref}`,
        passages: [p],
        original_words: [{ lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl }],
        matched_terms: [prof.bs, prof.gl],
        limitations: ['Repetition of a single canonical lemma across distinct verse tokens.'],
        provenance: { source_dataset: 'MACULA Hebrew & Greek', source_record_ids: [p.ref], license: 'CC BY 4.0', derivation_method: 'repeated_lemma_distinct_tokens' },
        score_components: { base_tier_score: TIER_BASE_SCORE[3], specificity_bonus: 110, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: TIER_BASE_SCORE[3] + 130 },
      };
    }
  } else if (evidenceId.startsWith('r11:lxx:')) {
    const [, , bs, idxStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const rel = prof?.lxx_relations?.[Number(idxStr)];
    if (prof && rel) {
      if (rel.target_strongs) targetStrongs.add(rel.target_strongs);
      const sampleRefs = (rel.sample_refs || (rel.ref ? [rel.ref] : [])).slice(0, 4);
      const refSet = new Set(sampleRefs);
      const pool: any[] = [
        ...(prof.first_occ_passages || []),
        ...((prof.clusters || []).flatMap((c: any) => c.sample_passages || [])),
      ];
      const lxxPassages: R10PassageRef[] = [];
      const seenVid = new Set<number>();
      for (const p of pool) {
        if (p?.ref && refSet.has(p.ref) && !seenVid.has(p.verse_id || 0)) {
          seenVid.add(p.verse_id || lxxPassages.length + 1);
          lxxPassages.push({
            verse_id: Number(p.verse_id || 0),
            ref: p.ref,
            mt_ref: p.mt_ref,
            book: Number(p.book || 1),
            chapter: Number(p.chapter || 1),
            verse: Number(p.verse || 1),
            testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
            snippet: p.snippet,
            is_psalm_heading: Number(p.book || 1) === 19 && Number(p.verse || 1) === 0,
          });
        }
      }
      if (lxxPassages.length === 0) {
        for (const p of pool) {
          if (p?.ref && !seenVid.has(p.verse_id || 0)) {
            seenVid.add(p.verse_id || lxxPassages.length + 1);
            lxxPassages.push({
              verse_id: Number(p.verse_id || 0),
              ref: p.ref,
              mt_ref: p.mt_ref,
              book: Number(p.book || 1),
              chapter: Number(p.chapter || 1),
              verse: Number(p.verse || 1),
              testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
              snippet: p.snippet,
              is_psalm_heading: Number(p.book || 1) === 19 && Number(p.verse || 1) === 0,
            });
            if (lxxPassages.length >= 3) break;
          }
        }
      }
      if (lxxPassages.length === 0) {
        for (const vid of (prof.all_vids || []).slice(0, 3)) {
          const hp = await hydratePassageByVid(vid);
          if (hp) lxxPassages.push(hp);
        }
      }
      record = {
        evidence_id: evidenceId,
        predicate: 'cross_language_bridge',
        evidence_tier: 3,
        epistemic_class: 'documented_lexical_relationship',
        title: rel.type === 'lxx_heading_witness' ? `Septuagint superscription witness for ${rel.ref}: ${prof.sc}` : `Septuagint (LXX) bridge: ${prof.sc} (${prof.bs}) → ${rel.script || ''} (${rel.target_strongs || ''})`,
        summary: rel.type === 'lxx_heading_witness' ? `In ${rel.ref}, the Septuagint renders the Hebrew title containing ${prof.sc} as: "${rel.lxx_text}".` : `Septuagint translates Hebrew ${prof.sc} as Greek ${rel.script} across ${rel.count || 1} passages.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: rel.target_strongs ? `lemma:${rel.target_strongs}` : `concept:lxx:${prof.bs}`,
        passages: lxxPassages.slice(0, 4),
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
        ],
        matched_terms: [prof.gl, prof.sc, rel.gloss || ''].filter(Boolean),
        limitations: ['Historical Septuagint translation choice; reflects Alexandrian Jewish understanding of the Hebrew text.'],
        provenance: {
          source_dataset: 'Swete LXX / Hatch-Redpath / STEPBible',
          source_record_ids: (rel.sample_refs || [rel.ref || prof.bs]),
          license: 'CC BY 4.0',
          derivation_method: 'lxx_swete_alignment',
        },
        score_components: {
          base_tier_score: 760,
          specificity_bonus: 60,
          witness_bonus: 20,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: 840,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:xref:')) {
    const [, , fVidStr, tVidStr] = evidenceId.split(':');
    const fVid = Number(fVidStr);
    const tVid = Number(tVidStr);
    const p1 = await hydratePassageByVid(fVid, true);
    const p2 = await hydratePassageByVid(tVid, false);
    if (p1 && p2) {
      const xrEntry = (chunkMetaCache.get(fVid)?.xrefs || []).find((x: any[]) => Number(x[0]) === tVid);
      const phrase = xrEntry ? String(xrEntry[2] || '') : '';
      const flags = xrEntry ? Number(xrEntry[3] || 0) : 0;
      const isReciprocal = (flags & 1) !== 0;
      const isCrossTest = (flags & 2) !== 0;
      const xrTier: R10EvidenceTier = isReciprocal ? 2 : 4;
      const xrScore = isReciprocal && isCrossTest ? 915 : isReciprocal ? 845 : 720;
      record = {
        evidence_id: evidenceId,
        predicate: 'cross_reference_witness',
        evidence_tier: xrTier,
        epistemic_class: 'verified_cross_reference',
        title: `${isReciprocal ? 'Reciprocal cross-reference' : 'Cross-reference witness'}${isCrossTest ? ' (OT↔NT)' : ''}: ${p1.ref} → ${p2.ref}`,
        summary: `${isReciprocal ? 'Bidirectional canonical cross-reference' : 'Canonical cross-reference'} connects ${p1.ref} and ${p2.ref}${phrase ? ` via "${phrase}"` : ''}.`,
        source_node_id: `passage:${p1.ref}`,
        target_node_id: `passage:${p2.ref}`,
        passages: [p1, p2],
        original_words: [],
        matched_terms: [p1.ref, p2.ref, phrase].filter(Boolean),
        limitations: ['Cross-reference witness documents ancient editorial or intertextual connection.'],
        provenance: {
          source_dataset: 'CrossReferences.org / OpenBible',
          source_record_ids: [p1.ref, p2.ref],
          license: 'CC BY 4.0',
          derivation_method: xrEntry ? 'embedded_bidirectional_cross_reference' : 'canonical_cross_reference_graph',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[xrTier],
          specificity_bonus: 40,
          witness_bonus: isReciprocal ? 45 : 20,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: xrScore,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:colloc:')) {
    const [, , bsA, bsB] = evidenceId.split(':');
    if (bsA && bsB) {
      targetStrongs.add(bsA);
      targetStrongs.add(bsB);
      const [profA, profB] = await Promise.all([
        readProfile(reader, releaseId, fastManifest, bsA, budget),
        readProfile(reader, releaseId, fastManifest, bsB, budget),
      ]);
      const cw = (profA?.clusters?.[0]?.collocated_words || []).find((x: any) => x.bs === bsB);
      const samplePassages: R10PassageRef[] = (profA?.clusters?.[0]?.sample_passages || []).slice(0, 4).map((p: any) => ({
        verse_id: p.verse_id,
        ref: p.ref,
        mt_ref: p.mt_ref,
        book: p.book,
        chapter: p.chapter,
        verse: p.verse,
        testament: p.testament,
        snippet: p.snippet,
        is_psalm_heading: p.book === 19 && p.verse === 0,
      }));
      if (profA && cw) {
        record = {
          evidence_id: evidenceId,
          predicate: 'verified_lexical_grammatical',
          evidence_tier: 4,
          epistemic_class: 'documented_collocation_or_cooccurrence',
          title: `Direct collocation: ${profA.sc} ("${profA.gl}") ↔ ${cw.sc} ("${cw.gl}", ${cw.hits}×)`,
          summary: `Corpus co-occurrence links ${profA.sc} (${profA.bs}, "${profA.gl}") with ${cw.sc} (${cw.bs}, "${cw.gl}") across ${cw.hits} shared contexts.`,
          source_node_id: `lemma:${profA.bs}`,
          target_node_id: `lemma:${cw.bs}`,
          passages: samplePassages,
          original_words: [
            { lemma_key: profA.lk, strongs: profA.bs, language: profA.lang, lemma_script: profA.sc, transliteration: profA.tr, gloss: profA.gl },
            ...(profB ? [{ lemma_key: profB.lk, strongs: profB.bs, language: profB.lang, lemma_script: profB.sc, transliteration: profB.tr, gloss: profB.gl }] : []),
          ],
          matched_terms: [profA.gl, cw.gl, profA.bs, cw.bs],
          limitations: ['Co-occurring vocabulary in shared contexts; inspect surrounding verses for syntactic or thematic relation.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek + STEPBible',
            source_record_ids: samplePassages.map(p => p.ref),
            license: 'CC BY 4.0',
            derivation_method: 'direct_cluster_collocation',
          },
          score_components: { base_tier_score: TIER_BASE_SCORE[4], specificity_bonus: 50, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: 720 },
        };
      }
    }
  } else if (evidenceId.startsWith('r12:event:')) {
    const rest = evidenceId.slice('r12:event:'.length);
    const sepIdx = rest.indexOf(':');
    const vid = Number(sepIdx >= 0 ? rest.slice(0, sepIdx) : rest);
    const evId = sepIdx >= 0 ? rest.slice(sepIdx + 1) : '';
    const p1 = vid ? await hydratePassageByVid(vid, true) : null;
    const motifsData = await readR10Json<MotifsData>(reader, releaseId, 'motifs-and-patterns.json.gz', budget);
    const evInfo = motifsData?.event_seq?.[evId];
    if (p1 && evInfo) {
      const nextEvId = evInfo.next;
      const nextInfo = nextEvId ? motifsData?.event_seq?.[nextEvId] : null;
      const nextVid = nextInfo?.sample_vids?.[0];
      const nextPassage = nextVid ? await hydratePassageByVid(Number(nextVid), false) : null;
      const evPassages = [p1, ...(nextPassage ? [nextPassage] : [])];
      record = {
        evidence_id: evidenceId,
        predicate: 'biblical_event',
        evidence_tier: 3,
        epistemic_class: 'direct_textual_evidence',
        title: `Biblical narrative sequence: ${evInfo.title}${nextInfo ? ` → ${nextInfo.title}` : ''} (${p1.ref})`,
        summary: `${p1.ref} belongs to Biblical event "${evInfo.title}"${evInfo.start_date ? ` (${evInfo.start_date})` : ''}${nextInfo ? `, directly followed in canonical sequence by "${nextInfo.title}" (${nextPassage?.ref || ''})` : ''}.`,
        source_node_id: `passage:${p1.ref}`,
        target_node_id: nextEvId || evId,
        passages: evPassages,
        original_words: [],
        matched_terms: [p1.ref, evInfo.title, nextInfo?.title || ''].filter(Boolean),
        limitations: ['Narrative chronology sequence groups adjacent canonical episodes; dating models reflect Theographic reference chronology.'],
        provenance: {
          source_dataset: 'Theographic Bible Data',
          source_record_ids: [evId, ...(nextEvId ? [nextEvId] : [])],
          license: 'CC BY-SA 4.0',
          derivation_method: 'chronological_event_adjacency',
        },
        score_components: { base_tier_score: TIER_BASE_SCORE[3], specificity_bonus: 110, witness_bonus: 15, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: 885 },
      };
    }
  } else if (evidenceId.startsWith('r11:intersect:pericope:')) {
    const [, , , vAStr, vBStr] = evidenceId.split(':');
    const vA = Number(vAStr);
    const vB = Number(vBStr);
    if (Number.isInteger(vA) && vA > 0 && Number.isInteger(vB) && vB > 0) {
      const p1 = await hydratePassageByVid(vA);
      const p2 = await hydratePassageByVid(vB);
      if (p1 && p2) {
        record = {
          evidence_id: evidenceId,
          predicate: 'shared_motif',
          evidence_tier: 4,
          epistemic_class: 'shared_motif_evidence',
          title: `Close pericope proximity: ${p1.ref} ↔ ${p2.ref}`,
          summary: `Verses ${p1.ref} and ${p2.ref} appear within ${Math.abs(vA - vB)} verse(s) of each other in the same literary context.`,
          source_node_id: `passage:${p1.ref}`,
          target_node_id: `passage:${p2.ref}`,
          passages: [p1, p2],
          original_words: [],
          matched_terms: [p1.ref, p2.ref],
          limitations: ['A four-verse window is a statistical proximity candidate, not a verified pericope boundary or intentional literary relationship.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek',
            source_record_ids: [p1.ref, p2.ref],
            license: 'CC BY 4.0',
            derivation_method: 'pericope_window_intersection',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[4],
            specificity_bonus: 90,
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[4] + 110,
          },
        };
      }
    }
  } else if (evidenceId.startsWith('r11:lex:')) {
    const [, , bs, idxStr] = evidenceId.split(':');
    const idx = Number(idxStr);
    if (bs && Number.isInteger(idx) && idx >= 0) {
      targetStrongs.add(bs);
      const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
      const lrel = prof?.lexical_relations?.[idx];
      if (prof && lrel) {
        if (lrel.target_strongs) targetStrongs.add(lrel.target_strongs);
        const samplePassages: R10PassageRef[] = (prof.clusters?.[0]?.sample_passages || []).slice(0, 3).map((p: any) => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        }));
        record = {
          evidence_id: evidenceId,
          predicate: 'verified_lexical_grammatical',
          evidence_tier: 3,
          epistemic_class: 'documented_lexical_relationship',
          title: `Lexical relation (${lrel.type.replace(/_/g, ' ')}): ${prof.sc} (${prof.bs}) ↔ ${lrel.label || `${lrel.script || ''} (${lrel.target_strongs || ''})`}`,
          summary: `Morphological and root derivation analysis links ${prof.sc} (${prof.bs}) to ${lrel.label || `${lrel.script || ''} (${lrel.target_strongs || ''}, "${lrel.gloss || ''}")`}.`,
          source_node_id: `lemma:${prof.bs}`,
          target_node_id: lrel.target_strongs ? `lemma:${lrel.target_strongs}` : `root:${lrel.root || prof.bs}`,
          passages: samplePassages,
          original_words: [
            { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
            ...(lrel.target_strongs ? [{ strongs: lrel.target_strongs, language: prof.lang, lemma_script: lrel.script || '', transliteration: '', gloss: lrel.gloss || '' }] : []),
          ],
          matched_terms: [prof.gl, prof.sc, lrel.gloss || ''].filter(Boolean),
          limitations: ['Lexical root derivation reflects shared etymological origin; semantic usage in specific verses diverges.'],
          provenance: {
            source_dataset: 'STEPBible TBESH/TBESG Lexicon',
            source_record_ids: [prof.bs, lrel.target_strongs || ''].filter(Boolean),
            license: 'CC BY 4.0',
            derivation_method: 'lexical_root_derivation',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[3],
            specificity_bonus: 15,
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[3] + 35,
          },
        };
      }
    }
  } else if (evidenceId.startsWith('r11:bridge:')) {
    const [, , bsA, bsB, cwBs] = evidenceId.split(':');
    if (bsA && bsB && cwBs) {
      [bsA, bsB, cwBs].forEach(s => targetStrongs.add(s));
      const [profA, profB, profCw] = await Promise.all([
        readProfile(reader, releaseId, fastManifest, bsA, budget),
        readProfile(reader, releaseId, fastManifest, bsB, budget),
        readProfile(reader, releaseId, fastManifest, cwBs, budget),
      ]);
      if (profA && profB) {
        const mapSamples = (prof: any): R10PassageRef[] =>
          (prof.clusters?.[0]?.sample_passages || []).slice(0, 2).map((p: any) => ({
            verse_id: p.verse_id,
            ref: p.ref,
            mt_ref: p.mt_ref,
            book: p.book,
            chapter: p.chapter,
            verse: p.verse,
            testament: p.testament,
            snippet: p.snippet,
            is_psalm_heading: p.book === 19 && p.verse === 0,
          }));
        record = {
          evidence_id: evidenceId,
          predicate: 'shared_motif',
          evidence_tier: 4,
          epistemic_class: 'shared_motif_evidence',
          title: `Shared collocation bridge: ${profA.sc} (${profA.bs}) ↔ ${profCw?.sc || cwBs} ↔ ${profB.sc} (${profB.bs})`,
          summary: `Both ${profA.sc} ("${profA.gl}", ${profA.bs}) and ${profB.sc} ("${profB.gl}", ${profB.bs}) co-occur with ${profCw ? `${profCw.sc} ("${profCw.gl}", ${profCw.bs})` : cwBs} in scriptural contexts.`,
          source_node_id: `lemma:${profA.bs}`,
          target_node_id: `lemma:${profB.bs}`,
          passages: [...mapSamples(profA), ...mapSamples(profB)],
          original_words: [
            { lemma_key: profA.lk, strongs: profA.bs, language: profA.lang, lemma_script: profA.sc, transliteration: profA.tr, gloss: profA.gl },
            { lemma_key: profB.lk, strongs: profB.bs, language: profB.lang, lemma_script: profB.sc, transliteration: profB.tr, gloss: profB.gl },
          ],
          matched_terms: [profA.gl, profB.gl, profCw?.gl || cwBs].filter(Boolean),
          limitations: ['Indirect collocation bridge through a third term; check individual verse contexts before inferring a thematic link.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek + STEPBible',
            source_record_ids: [profA.bs, cwBs, profB.bs],
            license: 'CC BY 4.0',
            derivation_method: 'shared_collocation_bridge',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[4],
            specificity_bonus: 60,
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[4] + 80,
          },
        };
      }
    }
  }

  // R12 Pilot Evidence Resolution (`r12:path:...`, `r12:prop:...`, `r12:struct:...`, `r12:orth:...`)
  if (
    evidenceId.startsWith('r12:path:') ||
    evidenceId.startsWith('r12:prop:') ||
    evidenceId.startsWith('r12:struct:') ||
    evidenceId.startsWith('r12:orth:')
  ) {
    const anchorKey = evidenceId.split(':')[2] || '';
    let anchorData: any = null;
    if (fastManifest?.r12_pilot_embedded) {
      if (anchorKey && (fastManifest.r12_pilot_anchors_list || []).includes(anchorKey)) {
        anchorData = (await readProfile(reader, releaseId, fastManifest, anchorKey, budget))?.r12_pilot_anchor ?? null;
      }
    } else {
      const r12Pilot = await readR12Pilot(reader, releaseId, fastManifest, budget);
      anchorData = r12Pilot?.anchors?.[anchorKey];
    }
    if (anchorData) {
      if (evidenceId.startsWith('r12:path:')) {
        const rec = (anchorData.multihop?.recommendations || []).find((r: any) => r.evidence_id === evidenceId);
        if (rec) record = r12MultihopRecToRecord(anchorData, rec);
      } else if (evidenceId.startsWith('r12:prop:')) {
        const prop = (anchorData.property_bridges || []).find((b: any) => b.evidence_id === evidenceId);
        if (prop) record = r12PropertyBridgeToRecord(anchorData, prop);
      } else if (evidenceId.startsWith('r12:struct:')) {
        const st = (anchorData.structural_candidates || []).find((s: any) => s.evidence_id === evidenceId);
        if (st) record = r12StructuralToRecord(anchorData, st);
      } else if (evidenceId.startsWith('r12:orth:')) {
        const orth = (anchorData.orthographic_candidates || []).find((o: any) => o.evidence_id === evidenceId);
        if (orth) record = r12OrthographicToRecord(anchorData, orth);
      }
    }
  }

  // Fallback to explicitData
  if (!record) {
    const explicitData = await readR10Json(reader, releaseId, 'explicit-and-typology.json.gz', budget) as { records: any[] } | null;
    record = (explicitData?.records || []).find((r: any) => r.evidence_id === evidenceId) || null;
  }

  // Support synthesized motif pairs
  if (!record && evidenceId.startsWith('r10:synth:motifpair:')) {
    const parts = evidenceId.split(':');
    const a = parts[3], b = parts[4];
    const motifsData = await readR10Json<MotifsData>(
      reader, releaseId, 'motifs-and-patterns.json.gz', budget
    );
    const motifPairs = motifsData?.motif_pairs ?? (
      motifsData?.motif_pairs_b64gz
        ? await decodeB64Gz<Record<string, any>>(reader, motifsData.motif_pairs_b64gz, `/r10/motif_pairs:${releaseId}`, budget.b64Cache)
        : undefined
    );
    const pair = motifPairs?.[`${a}|${b}`];
    if (pair) {
      const mA = motifsData!.motifs?.[a], mB = motifsData!.motifs?.[b];
      record = {
        evidence_id: evidenceId,
        predicate: 'shared_motif',
        evidence_tier: 5,
        epistemic_class: 'shared_motif_evidence',
        title: `Co-occurring motifs: ${mA?.label || a} + ${mB?.label || b}`,
        summary: `${pair.count} verses contain original-language terms from both motifs.`,
        source_node_id: `motif:${a}`,
        target_node_id: `motif:${b}`,
        passages: pair.passages.slice(0, 6),
        original_words: [...(mA?.original_words || []).slice(0, 3), ...(mB?.original_words || []).slice(0, 3)],
        matched_terms: [a, b],
        limitations: ['Motif co-occurrence does not establish deliberate literary allusion across separate books without contextual or authorial evidence.'],
        provenance: { source_dataset: 'MACULA Hebrew & Greek', source_record_ids: pair.passages.map((p: any) => p.ref), license: 'CC BY 4.0', derivation_method: 'deterministic_verse_motif_intersection' },
        score_components: { base_tier_score: 520, specificity_bonus: 40, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: 580 },
      };
    }
  } else if (!record && evidenceId.startsWith('r10:synth:num:')) {
    const [, , , valStr, nounS, kind] = evidenceId.split(':');
    const numbersData = await readR10Json<any>(reader, releaseId, 'numbers-index.json.gz', budget);
    const grp = (numbersData?.by_value?.[valStr]?.groups || []).find((g: any) => g.noun_s === nounS && g.kind === kind);
    if (grp) {
      const passages = (grp.samples || []).slice(0, 6).map((s: any) => ({ verse_id: s.vid, ref: s.ref, book: s.book, chapter: s.ch, verse: s.vs, testament: s.book <= 39 ? 'OT' : 'NT' as const }));
      record = {
        evidence_id: evidenceId,
        predicate: 'numbered_entity',
        evidence_tier: grp.kind === 'symbolic_vision_count' ? 4 : 6,
        epistemic_class: 'direct_textual_evidence',
        title: `Counted entity: ${valStr} × ${grp.noun_lm} ("${grp.noun_g}")`,
        summary: `Appears ${grp.count} times across Scripture as ${grp.kind.replace(/_/g, ' ')}.`,
        source_node_id: `number:${valStr}`,
        target_node_id: `lemma:${nounS}`,
        passages,
        original_words: [],
        matched_terms: [valStr, grp.noun_g],
        number_classification: { number_value: Number(valStr), counted_entity: `${grp.noun_lm} (${grp.noun_g})`, kind: grp.kind, coincidence_risk: grp.count > 25 ? 'high' : 'low', note: 'Syntactic numeral-noun extraction' },
        limitations: ['Numeral frequency alone does not establish theological equivalence across unrelated books.'],
        provenance: { source_dataset: 'MACULA numerals', source_record_ids: passages.map((p: any) => p.ref), license: 'CC BY 4.0', derivation_method: 'syntactic_numeral_noun_extraction' },
        score_components: { base_tier_score: 650, specificity_bonus: 20, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: 690 },
      };
    }
  }

  if (!record) {
    return { schema_version: 1, status: 'not_found', release_id: releaseId, evidence: null, passage_details: [],
      coverage: { state: budget.used >= budget.max ? 'resource_limits_reached' : budget.missing.length ? 'missing_source_coverage' : 'available', missing_assets: budget.missing } };
  }

  for (const ow of record.original_words || []) {
    if (ow.strongs) targetStrongs.add(ow.strongs);
  }

  const booksNeeded = [...new Set((record.passages || []).map(p => p.book).filter(b => b > 0))].slice(0, MAX_EVIDENCE_BOOKS);
  if (fastManifest) {
    for (const p of record.passages.slice(0, 6)) {
      let vid = p.verse_id || 0;
      if (!vid && fastManifest.selective && p.book > 0) {
        vid = Number(await readSelectiveKey(reader, releaseId, 'refs', `${p.book}:${p.chapter}:${p.verse}`, budget));
      } else if (!vid && fastManifest.direct_b64gz && p.book > 0) {
        const pad = String(p.book).padStart(2, '0');
        const idx = await readR10Json<any>(reader, releaseId, `evidence-passages/book-${pad}.json.gz`, budget);
        vid = Number(idx?.coord_to_vid?.[`${p.chapter}:${p.verse}`] || 0);
      }
      if (vid) await hydratePassageByVid(vid, true);
    }
  } else {
    await Promise.all(booksNeeded.map(async b => { await loadBookData(b); }));
  }

  const passageDetails = (record.passages || []).slice(0, 6).map(p => {
    const bVerses = bookCache.get(p.book);
    const vData = (p.verse_id ? bVerses?.[String(p.verse_id)] : null) ||
      Object.values(bVerses || {}).find((v: any) => v.chapter === p.chapter && v.verse === p.verse);
    const tokens = (vData?.toks || []).map((t: any) => ({
      word_no: t.wn,
      surface: t.sf,
      lemma: t.lm,
      strongs: t.s,
      gloss: t.g,
      grammar: t.cl || undefined,
      is_highlighted: targetStrongs.has(t.s),
    }));
    return {
      passage: {
        ...p,
        mt_ref: vData?.mt_ref ?? p.mt_ref,
        is_psalm_heading: p.book === 19 && (p.verse === 0 || vData?.verse === 0),
      },
      english_text: vData?.en || p.snippet || null,
      english_edition: vData?.en ? 'World English Bible (Public Domain)' : null,
      original_tokens: tokens,
    };
  });

  return {
    schema_version: 1,
    status: 'ok',
    release_id: releaseId,
    evidence: record,
    passage_details: passageDetails,
    coverage: { state: budget.used >= budget.max ? 'resource_limits_reached' : budget.missing.length ? 'missing_source_coverage' : 'available', missing_assets: budget.missing },
    notes_overlay_hint: {
      has_interpretive_layer: false,
      separation_notice: 'Source textual evidence is strictly separated from unreviewed DLM or personal research notes.',
    },
  };
}

export async function expandBiblicalConnection(
  reader: AssetReader,
  nodeId: string,
  options: { limit?: number; cursor?: string | null; release_id?: string } = {}
): Promise<ExpandConnectionResult> {
  const releaseId = options.release_id || DEFAULT_R10_RELEASE;
  let seedQuery = nodeId
    .replace(/^(motif:|lemma:|passage:|event:|concept:|number:|cluster:)/, '')
    .replace(/_/g, ' ');

  let clusterId: string | undefined;
  let focusLemma: string | undefined;

  if (nodeId.startsWith('cluster:')) {
    clusterId = nodeId.replace(/^cluster:/, '');
    focusLemma = clusterId.split(':')[0];
    seedQuery = focusLemma;
  } else if (nodeId.startsWith('lemma:')) {
    focusLemma = nodeId.replace(/^lemma:/, '');
    seedQuery = focusLemma;
  } else if (nodeId.startsWith('sense:')) {
    const rawSense = nodeId.replace(/^sense:/, '');
    const m = /^([HG]\d+)/i.exec(rawSense);
    if (m) {
      focusLemma = m[1].toUpperCase();
      seedQuery = focusLemma;
    }
  } else if (
    nodeId.startsWith('ext:wd:') ||
    nodeId.startsWith('ext:oewn:') ||
    nodeId.startsWith('wd:') ||
    nodeId.startsWith('oewn:')
  ) {
    const extTarget = nodeId.replace(/^ext:/, '');
    const r12Budget: ReadBudget = { used: 0, max: 10, missing: [] };
    const manifest = await readR10Json<FastManifest>(reader, releaseId, 'fast-manifest.json.gz', r12Budget);
    const externalMappings = manifest?.r12_external_mappings
      ?? (await readR12Pilot(reader, releaseId, manifest, r12Budget))?.external_mappings;
    if (externalMappings) {
      const mappedAnchors = externalMappings
        .filter((m: any) => m.wikidata_id === extTarget || m.oewn_id === extTarget)
        .map((m: any) => String(m.anchor_id || '').replace(/^lemma:/, ''))
        .filter(Boolean);
      if (mappedAnchors.length > 0) {
        focusLemma = mappedAnchors[0];
        seedQuery = mappedAnchors.join(' ');
      }
    }
  } else if (nodeId.startsWith('r12:prop:') || nodeId.startsWith('r12:path:')) {
    const parts = nodeId.split(':');
    if (parts[3] && /^[HG]\d+$/i.test(parts[3])) {
      focusLemma = parts[3];
      seedQuery = parts[3];
    } else if (parts[2]) {
      focusLemma = parts[2];
      seedQuery = parts[2];
    }
  }

  const discovery = await discoverBiblicalConnections(reader, {
    query: seedQuery,
    mode: 'expand',
    cluster_id: clusterId,
    focus_lemma: focusLemma,
    limit: options.limit ?? 8,
    cursor: options.cursor ?? null,
    release_id: releaseId,
  }, releaseId);

  const centerNode: R10Node = {
    id: nodeId,
    kind: nodeId.startsWith('motif:') ? 'motif' : nodeId.startsWith('lemma:') ? 'lemma' : nodeId.startsWith('passage:') ? 'passage' : 'concept',
    label: seedQuery,
    epistemic_class: 'direct_textual_evidence',
    grounding_source: 'R11 index expansion',
  };

  return {
    schema_version: 1,
    status: discovery.strongest_connections.length > 0 ? 'ok' : 'not_found',
    release_id: releaseId,
    center_node: centerNode,
    connections: discovery.strongest_connections,
    controls: discovery.controls_and_alternatives,
    pagination: {
      returned: discovery.pagination.returned,
      next_cursor: discovery.pagination.next_cursor,
      has_more: discovery.pagination.has_more,
    },
  };
}
