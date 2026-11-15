// @file: src/relationships/adjacency-loader.ts
// @feature: relationships-r9c
// Bounded, lazy, manifest-driven 4-layer adjacency loader for R8D/R9B shards.

import type {
  AdjacencyLoader,
  AssetBudgetContext,
  EdgeStats,
  EntityKind,
  EpistemicClass,
  GraphEdge,
  GraphEntityRef,
  GraphLayer,
  HopEvidenceWitness,
  NeighborLoadOptions,
  NeighborLoadResult,
} from './multihop-types.ts';

// === @section:logic:hashing ===
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64Hex(input: string): string {
  let hash = FNV_OFFSET_64;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function computeBucketHex(hashAlgorithm: string, bucketsNum: number, key: string): string {
  const buckets = BigInt(bucketsNum);
  const hex64 = fnv1a64Hex(key);
  let idx: number;
  if (/^fnv1a64_mod\d*$/.test(hashAlgorithm)) {
    idx = Number(BigInt('0x' + hex64) % buckets);
  } else if (/^fnv1a64_hi32_mod\d*$/.test(hashAlgorithm)) {
    idx = Number(BigInt('0x' + hex64.slice(0, 8)) % buckets);
  } else {
    throw new Error(`Unsupported hash algorithm: ${hashAlgorithm}`);
  }
  const padLen = Math.max(2, Math.ceil(Math.log2(Math.max(2, bucketsNum)) / 4));
  return idx.toString(16).padStart(padLen, '0');
}

export function inferEntityKind(entityKey: string): EntityKind {
  if (entityKey.startsWith('root:')) return 'root';
  if (entityKey.startsWith('sense:')) return 'sense';
  return 'lemma';
}

export function isFunctionWordPos(pos: string | null | undefined): boolean {
  if (!pos) return false;
  const p = pos.toUpperCase();
  return (
    p === 'H:ART' || p === 'H:T' || p === 'G:T' ||
    p.startsWith('H:PREP') || p.startsWith('A:PREP') || p.startsWith('G:PREP') ||
    p.startsWith('H:CONJ') || p.startsWith('A:CONJ') || p.startsWith('G:CONJ') ||
    p.startsWith('H:PART') || p.startsWith('A:PART') || p.startsWith('G:PART') ||
    p.startsWith('H:PRON') || p.startsWith('A:PRON') || p.startsWith('G:P') ||
    p.startsWith('H:REL') || p.startsWith('A:REL') || p === 'G:R' ||
    p === 'OP1C' || p.startsWith('H:R') || p === 'H:TD'
  );
}

// === @section:logic:asset-readers ===
export interface AssetReadResult {
  data: unknown;
  bytes: number;
}

export interface AssetReader {
  readJson(assetPath: string): Promise<AssetReadResult | null>;
}

async function importNodeBuiltin<T>(specifier: string): Promise<T> {
  return (await import(/* @vite-ignore */ specifier)) as T;
}

export async function createNodeFsAssetReader(roots: string[]): Promise<AssetReader> {
  const fs = await importNodeBuiltin<{ readFile: (p: string) => Promise<Uint8Array> }>('node:fs/promises');
  const path = await importNodeBuiltin<{ join: (...parts: string[]) => string }>('node:path');
  const zlib = await importNodeBuiltin<{ gunzipSync: (buf: Uint8Array) => { toString: (enc: string) => string } }>('node:zlib');

  return {
    async readJson(assetPath: string): Promise<AssetReadResult | null> {
      const rel = assetPath.replace(/^\/+/, '');
      for (const root of roots) {
        const candidates = [path.join(root, rel)];
        if (rel.endsWith('.json.gz')) {
          candidates.push(path.join(root, rel.slice(0, -3)));
        }
        for (const filePath of candidates) {
          try {
            const raw = await fs.readFile(filePath);
            const isGz = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
            const text = (isGz ? zlib.gunzipSync(raw) : raw).toString('utf8');
            return { data: JSON.parse(text), bytes: raw.length };
          } catch {
            // Try next candidate or root
          }
        }
      }
      return null;
    },
  };
}

export function createInMemoryAssetReader(files: Record<string, unknown>): AssetReader {
  return {
    async readJson(assetPath: string): Promise<AssetReadResult | null> {
      const norm = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
      const hit = files[norm] ?? files[norm.replace(/^\/+/, '')];
      if (hit === undefined) return null;
      return { data: hit, bytes: JSON.stringify(hit).length };
    },
  };
}

// === @section:logic:entity-helpers ===
interface ResolverLemmaEntry {
  lemma_id: string;
  canonical_lemma_id?: string;
  language?: string;
  lemma_form?: string;
  transliteration?: string;
  gloss?: string;
  strongs_base?: string;
  extended_strongs?: string;
  homograph_tag?: string;
  pos?: string;
  in_graph?: boolean;
  editions?: string[];
  outgoing_summary_count?: number;
  incoming_summary_count?: number;
}

export interface ResolverIndexData {
  lemmas?: Record<string, ResolverLemmaEntry>;
  by_strongs_base?: Record<string, string[]>;
  by_strongs_extended?: Record<string, string>;
  by_surface_form?: Record<string, string[]>;
  by_transliteration?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface UncoveredLemmasData {
  entries?: Record<string, [string?, string?, string?, string?, string?]>;
}

export interface CompactMetaData {
  lemmas?: Record<string, [string | null, number, string | null, string | null]>;
  uncovered?: Record<string, [string | null, string | null]>;
}

export interface EnglishConceptsData {
  rows?: Array<[string, string, string | null, string | null, string | null, string | null, string | null, string | null, number, number, number]>;
}

export interface ResolverByKeyEntry {
  kind: 'lemma' | 'uncovered';
  entry?: ResolverLemmaEntry;
  key?: string;
  tuple?: [string?, string?, string?, string?, string?];
}

export interface ResolverByKeyShardData {
  lemmas?: Record<string, ResolverLemmaEntry>;
  uncovered?: Record<string, [string?, string?, string?, string?, string?]>;
  by_strongs_base?: Record<string, ResolverByKeyEntry[]>;
  by_strongs_extended?: Record<string, ResolverByKeyEntry>;
  by_surface_form?: Record<string, ResolverLemmaEntry[]>;
  by_transliteration?: Record<string, ResolverLemmaEntry[]>;
}

const LANG_NORM: Record<string, string> = {
  hebrew: 'hbo', aramaic: 'arc', greek: 'grc', hbo: 'hbo', arc: 'arc', grc: 'grc',
};

export function normalizeLang(raw: string | null | undefined, entityKey: string): string | null {
  if (raw && LANG_NORM[raw.toLowerCase()]) return LANG_NORM[raw.toLowerCase()];
  if (entityKey.startsWith('lemma:G')) return 'grc';
  if (entityKey.startsWith('lemma:H')) return 'hbo';
  return raw ?? null;
}

function profileFromResolver(
  entityKey: string,
  resolver: ResolverIndexData | null,
  uncovered: UncoveredLemmasData | null,
): GraphEntityRef | null {
  const kind = inferEntityKind(entityKey);
  if (kind !== 'lemma') {
    return {
      entity_key: entityKey,
      entity_kind: kind,
      label: entityKey.replace(/^(root|sense):/, ''),
      transliteration: null,
      gloss: null,
      language: entityKey.includes(':G') ? 'grc' : 'hbo',
      pos: null,
      strongs_base: null,
      homograph_tag: null,
      degree_hint: null,
    };
  }
  const p = resolver?.lemmas?.[entityKey];
  if (p) {
    return {
      entity_key: p.canonical_lemma_id || entityKey,
      entity_kind: 'lemma',
      label: p.lemma_form || entityKey.replace(/^lemma:/, ''),
      transliteration: p.transliteration || null,
      gloss: p.gloss || null,
      language: normalizeLang(p.language, entityKey),
      pos: p.pos || null,
      strongs_base: p.strongs_base || null,
      homograph_tag: p.homograph_tag || null,
      degree_hint: (p.outgoing_summary_count || 0) + (p.incoming_summary_count || 0),
    };
  }
  const unc = uncovered?.entries?.[entityKey];
  if (unc) {
    return {
      entity_key: entityKey,
      entity_kind: 'lemma',
      label: unc[0] || entityKey.replace(/^lemma:/, ''),
      transliteration: unc[1] || null,
      gloss: unc[2] || null,
      language: normalizeLang(null, entityKey),
      pos: unc[4] || null,
      strongs_base: unc[3] || null,
      homograph_tag: null,
      degree_hint: 0,
    };
  }
  return null;
}

function entityFromEndpoint(ep: Record<string, unknown> | null | undefined, fallbackKey: string): GraphEntityRef {
  const key = String(ep?.canonical_key || ep?.lemma_id || fallbackKey);
  const kind = (ep?.entity_kind as EntityKind) || inferEntityKind(key);
  return {
    entity_key: key,
    entity_kind: kind,
    label: String(ep?.lemma_script || ep?.lemma_form || ep?.original_script || key.replace(/^(lemma|root|sense):/, '')),
    transliteration: (ep?.transliteration as string) || null,
    gloss: (ep?.primary_gloss as string) || (ep?.gloss as string) || null,
    language: normalizeLang(ep?.language as string, key),
    pos: (ep?.primary_pos as string) || (ep?.pos as string) || null,
    strongs_base: (ep?.base_strongs as string) || (ep?.strongs_base as string) || null,
    homograph_tag: (ep?.homograph_tag as string) || null,
    degree_hint: null,
  };
}

function enrichEntityRef(
  ref: GraphEntityRef,
  resolver: ResolverIndexData | null,
  compactMeta?: CompactMetaData | null,
): GraphEntityRef {
  if (ref.entity_kind !== 'lemma') return ref;
  const prof = resolver ? profileFromResolver(ref.entity_key, resolver, null) : null;
  if (prof) {
    return {
      ...ref,
      label: ref.label || prof.label,
      transliteration: ref.transliteration ?? prof.transliteration,
      gloss: ref.gloss ?? prof.gloss,
      language: ref.language ?? prof.language,
      pos: ref.pos ?? prof.pos,
      strongs_base: ref.strongs_base ?? prof.strongs_base,
      homograph_tag: ref.homograph_tag ?? prof.homograph_tag,
      degree_hint: prof.degree_hint,
    };
  }
  const cMeta = compactMeta?.lemmas?.[ref.entity_key];
  if (cMeta) {
    return {
      ...ref,
      pos: ref.pos ?? cMeta[0] ?? null,
      degree_hint: Number(cMeta[1] || 0),
      gloss: ref.gloss ?? cMeta[2] ?? null,
      homograph_tag: ref.homograph_tag ?? cMeta[3] ?? null,
    };
  }
  const uMeta = compactMeta?.uncovered?.[ref.entity_key];
  if (uMeta) {
    return {
      ...ref,
      pos: ref.pos ?? uMeta[0] ?? null,
      gloss: ref.gloss ?? uMeta[1] ?? null,
      degree_hint: 0,
    };
  }
  return ref;
}

// === @section:logic:layer-grammatical-lexical ===
const LEXICAL_INVERSE_PREDICATES: Record<string, string> = {
  sense_subdivision_of: 'has_sense_subdivision',
  base_root_anchor: 'root_anchored_by',
  derived_from_root_anchor: 'root_anchor_of_derivation',
  greek_loan_or_transliteration: 'loan_source_of',
  compound_formation_component: 'component_of_formation',
};

interface LayerContext {
  entityKey: string;
  selfRef: GraphEntityRef;
  resolver: ResolverIndexData | null;
  compactMeta: CompactMetaData | null;
  options: NeighborLoadOptions;
  predicateSet: Set<string> | null;
  langSet: Set<string> | null;
  editionSet: Set<string> | null;
  readShard: (path: string) => Promise<unknown | null>;
}

async function loadGrammaticalEdges(ctx: LayerContext, gMeta: Record<string, unknown>): Promise<{ edges: GraphEdge[]; uncovered: boolean }> {
  const ws = gMeta.worker_shards as Record<string, unknown> | undefined;
  const gPath = ws?.base_dir && ws?.path
    ? `${String(ws.base_dir)}/${String(ws.path).replace('{hex3}', computeBucketHex(String(ws.hash_algorithm || 'fnv1a64_mod1024'), Number(ws.buckets || 1024), ctx.entityKey)).replace('{hex2}', computeBucketHex(String(ws.hash_algorithm || 'fnv1a64_mod1024'), Number(ws.buckets || 1024), ctx.entityKey))}`
    : `${gMeta.base_dir}/by-lemma/shard-${computeBucketHex(String(gMeta.hash_algorithm || 'fnv1a64_mod256'), Number(gMeta.buckets || 256), ctx.entityKey)}.json.gz`;
  const gramShard = (await ctx.readShard(gPath)) as {
    entries?: Record<string, Record<string, unknown>>;
  } | null;
  const gEntry = gramShard?.entries?.[ctx.entityKey];
  if (!gEntry) return { edges: [], uncovered: true };

  const directionFilter = ctx.options.direction ?? 'both';
  const minQuality = ctx.options.min_quality ?? 'all';
  const summaries: Array<Record<string, unknown>> = [];
  if (directionFilter !== 'incoming') summaries.push(...((gEntry.outgoing_summaries as Array<Record<string, unknown>>) || []));
  if (directionFilter !== 'outgoing') summaries.push(...((gEntry.incoming_summaries as Array<Record<string, unknown>>) || []));

  const edges: GraphEdge[] = [];
  for (const s of summaries) {
    const predicate = String(s.predicate || '');
    const isCandidateTier = s.quality_tier === 'candidate_only';
    if ((minQuality === 'high_precision_only' || minQuality === 'exclude_candidate') && isCandidateTier) continue;
    if (ctx.predicateSet && !ctx.predicateSet.has(predicate) && !ctx.predicateSet.has(String(s.display_predicate || ''))) continue;
    const ed = String(s.source_edition || '');
    if (ctx.editionSet && !ctx.editionSet.has(ed)) continue;

    const isOutgoing = s.direction === 'outgoing';
    const peerRef = enrichEntityRef(entityFromEndpoint((s.related_lemma as Record<string, unknown>) || {}, String(s.related_lemma_id || '')), ctx.resolver, ctx.compactMeta);
    if (ctx.langSet && peerRef.language && !ctx.langSet.has(peerRef.language)) continue;

    const sStats = (s.stats as Record<string, number>) || {};
    const qualityLabel = isCandidateTier ? 'candidate' : (sStats.source_explicit || 0) > 0 ? 'source_explicit' : 'rule_derived';
    const epistemicClass: EpistemicClass = isCandidateTier ? 'candidate_textual_evidence' : 'direct_textual_evidence';
    const sampleRels = (s.sample_relations as Array<Record<string, unknown>>) || [];
    const witnesses: HopEvidenceWitness[] = sampleRels.map((r) => ({
      relation_id: String(r.relation_id || ''),
      frame_id: String(r.frame_id || ''),
      source_clause_id: String(r.source_clause_id || ''),
      reference: String(r.canonical_ref || ''),
      edition: String(r.edition || ed),
      rule_id: String(r.rule_id || ''),
      quality: String(r.quality || qualityLabel),
      qualifiers: (r.qualifiers as Record<string, string>) || undefined,
    }));

    edges.push({
      edge_id: `${String(s.summary_id)}::${isOutgoing ? 'fwd' : 'rev'}`,
      source_relationship_id: String(s.summary_id),
      layer: 'grammatical',
      predicate,
      display_predicate: String(s.display_predicate || predicate),
      display_label: String(s.display_label || predicate),
      edge_direction: 'directed',
      traversal_direction: isOutgoing ? 'forward' : 'reverse',
      canonical_source: isOutgoing ? ctx.selfRef : peerRef,
      canonical_target: isOutgoing ? peerRef : ctx.selfRef,
      from_entity: ctx.selfRef,
      to_entity: peerRef,
      epistemic_class: epistemicClass,
      quality: qualityLabel,
      editions: ed ? [ed] : [],
      language: ctx.selfRef.language,
      uncertainty: {
        is_uncertain: isCandidateTier,
        mapping_status: 'exact',
        homograph_ambiguity: false,
        notes: isCandidateTier ? ['Grammatical candidate extraction; verify source clause before asserting role.'] : [],
      },
      stats: {
        distinct_passages: sStats.distinct_passages || 0,
        distinct_books: sStats.distinct_books || 0,
        occurrences: sStats.occurrences || 0,
        candidate_occurrences: sStats.candidate || 0,
      },
      sample_references: [...new Set(witnesses.map((w) => w.reference).filter(Boolean))],
      sample_witnesses: witnesses,
      provenance: { dataset: `MACULA (${ed || 'wlc/nestle1904'})`, license: 'CC BY 4.0', rule_version: String(s.rule_version || '1.2') },
      guardrails: [String(s.guardrail || 'Syntactic clause role; grammatical subject/object is not automatic theological proof.')],
    });
  }
  return { edges, uncovered: false };
}

async function loadLexicalEdges(ctx: LayerContext, lMeta: Record<string, unknown>): Promise<GraphEdge[]> {
  const ws = lMeta.worker_shards as Record<string, unknown> | undefined;
  const lPath = ws?.base_dir && ws?.path
    ? `${String(ws.base_dir)}/${String(ws.path).replace('{hex3}', computeBucketHex(String(ws.hash_algorithm || 'fnv1a64_mod1024'), Number(ws.buckets || 1024), ctx.entityKey)).replace('{hex2}', computeBucketHex(String(ws.hash_algorithm || 'fnv1a64_mod1024'), Number(ws.buckets || 1024), ctx.entityKey))}`
    : `${lMeta.base_dir}/edges/sharded-edges/shard-${computeBucketHex(String(lMeta.hash_algorithm || 'fnv1a64_hi32_mod64'), Number(lMeta.buckets || 64), ctx.entityKey)}.json.gz`;
  const edgeShard = (await ctx.readShard(lPath)) as {
    endpoint_index?: Record<string, Array<Record<string, unknown>>>;
    edges_by_id?: Record<string, Record<string, unknown>>;
  } | null;
  const links = edgeShard?.endpoint_index?.[ctx.entityKey] || [];
  const edgesById = edgeShard?.edges_by_id || {};
  const directionFilter = ctx.options.direction ?? 'both';
  const minQuality = ctx.options.min_quality ?? 'all';
  const edges: GraphEdge[] = [];

  for (const link of links) {
    const edge = edgesById[String(link.relationship_id)];
    if (!edge) continue;
    const role = String(link.role || 'symmetric');
    if (directionFilter === 'outgoing' && role === 'incoming') continue;
    if (directionFilter === 'incoming' && role === 'outgoing') continue;

    const predicate = String(edge.raw_relation_code || edge.category || 'lexical_relation');
    if (ctx.predicateSet && !ctx.predicateSet.has(predicate) && !ctx.predicateSet.has(String(edge.category || ''))) continue;

    const subjRef = enrichEntityRef(entityFromEndpoint(edge.subject as Record<string, unknown>, ctx.entityKey), ctx.resolver, ctx.compactMeta);
    const tgtRef = enrichEntityRef(entityFromEndpoint(edge.target as Record<string, unknown>, String(link.peer_key || '')), ctx.resolver, ctx.compactMeta);
    const toRef = role === 'incoming' ? subjRef : role === 'outgoing' ? tgtRef : (subjRef.entity_key === ctx.entityKey ? tgtRef : subjRef);
    if (ctx.langSet && toRef.language && !ctx.langSet.has(toRef.language)) continue;

    const isComp = edge.epistemic_tier === 'deterministic_computational' || edge.category === 'orthographic_overlap';
    if (minQuality === 'high_precision_only' && isComp) continue;

    const edgeDir = edge.direction === 'symmetric' ? 'symmetric' : 'directed';
    const travDir = edgeDir === 'symmetric' ? 'symmetric' : role === 'incoming' ? 'reverse' : 'forward';
    const prov = (edge.provenance as Record<string, unknown>) || {};

    edges.push({
      edge_id: `${String(edge.relationship_id)}::${travDir}`,
      source_relationship_id: String(edge.relationship_id),
      layer: 'lexical',
      predicate,
      display_predicate: travDir === 'reverse' ? (LEXICAL_INVERSE_PREDICATES[predicate] || `inverse_${predicate}`) : predicate,
      display_label: String(edge.category || predicate).replace(/_/g, ' '),
      edge_direction: edgeDir,
      traversal_direction: travDir,
      canonical_source: subjRef,
      canonical_target: tgtRef,
      from_entity: ctx.selfRef,
      to_entity: toRef,
      epistemic_class: 'documented_lexical_relationship',
      quality: String(edge.epistemic_tier || 'attested_lexical_fact'),
      editions: ['STEPBible-TBESH-TBESG'],
      language: subjRef.language,
      uncertainty: {
        is_uncertain: isComp,
        mapping_status: 'exact',
        homograph_ambiguity: false,
        notes: edge.category === 'orthographic_overlap' ? ['Orthographic/spelling similarity only; does not establish shared etymology or meaning.'] : [],
      },
      stats: { distinct_passages: Array.isArray(edge.evidence_verses) ? edge.evidence_verses.length : 0 },
      sample_references: [],
      sample_witnesses: [],
      provenance: {
        dataset: String(prov.source_title || 'STEPBible Lexicon (R9A)'),
        license: String(prov.license || 'CC BY 4.0'),
        locator: prov.locator ? String(prov.locator) : undefined,
      },
      guardrails: [String(edge.explanation || ''), 'Documented lexical/root/cognate link never proves synonymy.'].filter(Boolean),
    });
  }
  return edges;
}

// === @section:logic:layer-contextual-lxx ===
async function loadContextualEdges(ctx: LayerContext, cMeta: Record<string, unknown>): Promise<{
  edges: GraphEdge[];
  totalNeighbors: number;
  pagesLoaded: number;
  pagesSkipped: number;
  truncated: boolean;
  incompleteReason: string | null;
}> {
  const targetSet = new Set<string>(ctx.options.target_hints || []);
  if (ctx.options.target_hint) targetSet.add(ctx.options.target_hint);
  const selfIsGreek = ctx.entityKey.startsWith('lemma:G');
  const selfIsHebrew = ctx.entityKey.startsWith('lemma:H');
  const remainingTargets = new Set<string>();
  for (const t of targetSet) {
    if (selfIsGreek && t.startsWith('lemma:H')) continue;
    if (selfIsHebrew && t.startsWith('lemma:G')) continue;
    remainingTargets.add(t);
  }
  if (targetSet.size > 0 && remainingTargets.size === 0) {
    return { edges: [], totalNeighbors: 0, pagesLoaded: 0, pagesSkipped: 0, truncated: false, incompleteReason: null };
  }

  const hex = computeBucketHex(String(cMeta.hash_algorithm || 'fnv1a64_hi32_mod64'), Number(cMeta.buckets || 64), ctx.entityKey);
  const ctxShard = (await ctx.readShard(`${cMeta.base_dir}/sharded-contextual/shard-${hex}.json.gz`)) as Record<string, Record<string, unknown>> | null;
  const cEntry = ctxShard?.[ctx.entityKey];
  if (!cEntry) return { edges: [], totalNeighbors: 0, pagesLoaded: 0, pagesSkipped: 0, truncated: false, incompleteReason: null };

  const totalNeighbors = Number(cEntry.total_neighbors || 0);
  const topItems = (cEntry.neighbors as Array<Record<string, unknown>>) || [];
  const overflowPages = (cEntry.overflow_pages as Array<Record<string, unknown>>) || [];
  const scope = ctx.options.contextual_scope || 'all';
  const minVerse = Math.max(ctx.options.min_same_verse ?? 1, 1);
  const minClause = Math.max(ctx.options.min_same_clause ?? (scope === 'same_clause' ? 1 : 0), 0);
  const minColloc = Math.max(ctx.options.min_collocation ?? (scope === 'collocation' ? 1 : 0), 0);
  const maxPages = ctx.options.max_contextual_pages ?? 2;
  for (const it of topItems) {
    remainingTargets.delete(String(it.target_lemma_key || ''));
  }

  const collectedItems: Array<Record<string, unknown>> = [...topItems];
  const allFoundInTop = targetSet.size > 0 && remainingTargets.size === 0;
  let pagesLoaded = 0;
  let pagesSkipped = 0;
  let truncated = false;
  let incompleteReason: string | null = null;

  if (!allFoundInTop && overflowPages.length > 0 && maxPages > 0) {
    const eligible = overflowPages.filter(
      (p) => Number(p.max_same_verse ?? 999999) >= minVerse && Number(p.max_same_clause ?? 999999) >= minClause && Number(p.max_collocation ?? 999999) >= minColloc,
    );
    pagesSkipped = overflowPages.length - eligible.length;
    for (const pMeta of eligible) {
      if (pagesLoaded >= maxPages) {
        truncated = true;
        incompleteReason = `Contextual adjacency for ${ctx.entityKey} truncated after ${pagesLoaded}/${eligible.length} eligible overflow pages (${totalNeighbors} total neighbors).`;
        break;
      }
      if (ctx.options.budget?.budget_exceeded) {
        truncated = true;
        incompleteReason = `Contextual adjacency for ${ctx.entityKey} stopped by resource budget (${ctx.options.budget.exceeded_reason || 'budget'}).`;
        break;
      }
      const relPath = String(pMeta.path || '').replace(/^contextual\//, '');
      const pageData = (await ctx.readShard(`${cMeta.base_dir}/${relPath}`)) as { entries?: Record<string, Array<{ offset_start: number; items: Array<Record<string, unknown>> }>> } | null;
      if (!pageData && ctx.options.budget?.budget_exceeded) {
        truncated = true;
        incompleteReason = `Contextual adjacency for ${ctx.entityKey} stopped by resource budget (${ctx.options.budget.exceeded_reason || 'budget'}).`;
        break;
      }
      pagesLoaded += 1;
      const seg = (pageData?.entries?.[ctx.entityKey] || []).find((s) => s.offset_start === pMeta.offset_start);
      if (seg?.items) {
        collectedItems.push(...seg.items);
        if (targetSet.size > 0) {
          for (const it of seg.items) remainingTargets.delete(String(it.target_lemma_key || ''));
          if (remainingTargets.size === 0) break;
        }
      }
    }
  } else if (!allFoundInTop && overflowPages.length > 0 && maxPages <= 0) {
    truncated = true;
    incompleteReason = `Contextual overflow pages not loaded for ${ctx.entityKey} (page budget 0; ${totalNeighbors} total neighbors).`;
  }

  const minQuality = ctx.options.min_quality ?? 'all';
  const edges: GraphEdge[] = [];
  for (const item of collectedItems) {
    const counts = (item.counts as Record<string, number>) || {};
    const sameVerse = Number(counts.same_verse || 0);
    const sameClause = Number(counts.same_clause || 0);
    const colloc = Number(counts.collocation_distance_le_3 || 0);
    if (sameVerse < minVerse || sameClause < minClause || colloc < minColloc) continue;
    const ctxPred = colloc > 0 ? 'collocates_in_clause' : sameClause > 0 ? 'cooccurs_in_clause' : 'cooccurs_in_verse';
    if (ctx.predicateSet) {
      const ok = (ctx.predicateSet.has('cooccurs_in_verse') && sameVerse > 0) || (ctx.predicateSet.has('cooccurs_in_clause') && sameClause > 0) || (ctx.predicateSet.has('collocates_in_clause') && colloc > 0);
      if (!ok) continue;
    }
    const targetKey = String(item.target_lemma_key || '');
    if (!targetKey) continue;
    const peerRef = enrichEntityRef(entityFromEndpoint({
      canonical_key: targetKey,
      entity_kind: 'lemma',
      lemma_script: item.target_lemma_script,
      transliteration: item.target_transliteration,
      language: item.target_language,
      base_strongs: item.target_base_strongs,
    }, targetKey), ctx.resolver, ctx.compactMeta);
    if (ctx.langSet && peerRef.language && !ctx.langSet.has(peerRef.language)) continue;
    if (minQuality === 'high_precision_only' && sameClause === 0) continue;

    const sortedPair = [ctx.entityKey, targetKey].sort();
    const samples = ((item.sample_passages as Array<Record<string, unknown>>) || []).map((sp) => ({
      reference: String(sp.ref || ''),
      in_same_clause: Boolean(sp.in_same_clause),
      is_collocation: Boolean(sp.is_collocation),
    }));
    edges.push({
      edge_id: `ctx:${sortedPair[0]}<->${sortedPair[1]}`,
      source_relationship_id: `ctx:${sortedPair[0]}<->${sortedPair[1]}`,
      layer: 'contextual',
      predicate: ctxPred,
      display_predicate: ctxPred,
      display_label: colloc > 0 ? 'Clause collocation (dist<=3)' : sameClause > 0 ? 'Same-clause co-occurrence' : 'Same-verse co-occurrence',
      edge_direction: 'symmetric',
      traversal_direction: 'symmetric',
      canonical_source: ctx.selfRef,
      canonical_target: peerRef,
      from_entity: ctx.selfRef,
      to_entity: peerRef,
      epistemic_class: 'statistical_association',
      quality: 'statistical_association',
      editions: [ctx.selfRef.language === 'grc' ? 'macula-greek-nestle1904' : 'macula-hebrew-wlc'],
      language: ctx.selfRef.language,
      uncertainty: { is_uncertain: false, mapping_status: 'exact', homograph_ambiguity: false, notes: [] },
      stats: {
        distinct_passages: sameVerse,
        same_verse: sameVerse,
        same_clause: sameClause,
        collocation_distance_le_3: colloc,
        near_verse_window_distance_le_3: Number(counts.near_verse_window_distance_le_3 || 0),
      } as EdgeStats,
      sample_references: samples.map((s) => s.reference).filter(Boolean),
      sample_witnesses: samples,
      provenance: { dataset: 'MACULA Tree Leaf Clauses (R9A/R9B lossless index)', license: 'CC BY 4.0' },
      guardrails: ['Statistical co-occurrence only; never proves synonymy, grammar, or causality.'],
    });
  }
  return { edges, totalNeighbors, pagesLoaded, pagesSkipped, truncated, incompleteReason };
}

async function loadLxxEdges(ctx: LayerContext, lxxMeta: Record<string, unknown>): Promise<GraphEdge[]> {
  const isGreek = ctx.entityKey.startsWith('lemma:G');
  const directionFilter = ctx.options.direction ?? 'both';
  if (isGreek && directionFilter === 'outgoing') return [];
  if (!isGreek && directionFilter === 'incoming') return [];
  if (ctx.predicateSet && !ctx.predicateSet.has('lxx_translation_candidate') && !ctx.predicateSet.has('lxx_rendered_from')) return [];

  const formatKey = isGreek ? 'by-greek-lemma' : 'by-hebrew-lemma';
  const hex = computeBucketHex(String(lxxMeta.hash_algorithm || 'fnv1a64_hi32_mod64'), Number(lxxMeta.buckets || 64), ctx.entityKey);
  const lxxShard = (await ctx.readShard(`${lxxMeta.base_dir}/${formatKey}/shard-${hex}.json.gz`)) as { entries?: Record<string, { candidates?: Array<Record<string, unknown>> }> } | null;
  const lxxEntry = lxxShard?.entries?.[ctx.entityKey];
  const minQuality = ctx.options.min_quality ?? 'all';
  const edges: GraphEdge[] = [];

  for (const cand of lxxEntry?.candidates || []) {
    const isAmbiguous = Boolean(cand.homograph_ambiguity);
    const mappingStatus = String(cand.mapping_status || 'exact');
    if (minQuality === 'high_precision_only' && isAmbiguous) continue;
    const peerList = isGreek ? ((cand.hebrew_candidates as Array<Record<string, unknown>>) || []) : ((cand.greek_candidates as Array<Record<string, unknown>>) || []);
    for (const pCand of peerList) {
      const peerKey = String(pCand.lemma_key || '');
      if (!peerKey) continue;
      const peerRef = enrichEntityRef(entityFromEndpoint({ ...pCand, canonical_key: peerKey, entity_kind: 'lemma', language: isGreek ? 'hbo' : 'grc' }, peerKey), ctx.resolver, ctx.compactMeta);
      if (ctx.langSet && peerRef.language && !ctx.langSet.has(peerRef.language)) continue;
      edges.push({
        edge_id: `${String(cand.edge_id)}::${ctx.entityKey}->${peerKey}`,
        source_relationship_id: String(cand.edge_id),
        layer: 'lxx_translation',
        predicate: 'lxx_translation_candidate',
        display_predicate: isGreek ? 'lxx_rendered_from' : 'lxx_translation_candidate',
        display_label: isGreek ? 'LXX renders Hebrew candidate' : 'LXX translation candidate',
        edge_direction: 'directed',
        traversal_direction: isGreek ? 'reverse' : 'forward',
        canonical_source: isGreek ? peerRef : ctx.selfRef,
        canonical_target: isGreek ? ctx.selfRef : peerRef,
        from_entity: ctx.selfRef,
        to_entity: peerRef,
        epistemic_class: 'translation_correspondence',
        quality: isAmbiguous ? 'candidate' : 'translation_candidate',
        editions: ['bcv-lxx-bridge'],
        language: ctx.selfRef.language,
        uncertainty: {
          is_uncertain: isAmbiguous,
          mapping_status: mappingStatus,
          homograph_ambiguity: isAmbiguous,
          notes: isAmbiguous ? [`Canonical homograph ambiguity (${mappingStatus}): BCV Strong's base maps to multiple lemmas; candidate set preserved.`] : [],
        },
        stats: { published_count: Number(cand.published_count || 0), translation_share: Number(cand.translation_share || 0) },
        sample_references: [],
        sample_witnesses: [],
        provenance: { dataset: 'bcv-commons/hebrew-lexical-references (R4 LXX Bridge)', license: 'CC BY 4.0' },
        guardrails: ['Published Septuagint translation candidate only; not token alignment, semantic synonymy, or NT theological identity.'],
      });
    }
  }
  return edges;
}

// === @section:logic:loader-class ===
export interface ShardLoaderConfig {
  releaseVersion?: string;
  maxCachedShards?: number;
}

export class ShardedAdjacencyLoader implements AdjacencyLoader {
  private readonly reader: AssetReader;
  private readonly releaseVersion: string;
  private readonly maxCachedShards: number;
  private readonly lru = new Map<string, { data: unknown; bytes: number }>();
  private manifestPromise: Promise<Record<string, unknown> | null> | null = null;
  private resolverPromise: Promise<ResolverIndexData | null> | null = null;
  private uncoveredPromise: Promise<UncoveredLemmasData | null> | null = null;
  private compactMetaPromise: Promise<CompactMetaData | null> | null = null;
  private englishConceptsPromise: Promise<EnglishConceptsData | null> | null = null;

  constructor(reader: AssetReader, config: ShardLoaderConfig = {}) {
    this.reader = reader;
    this.releaseVersion = config.releaseVersion || 'r9b-v1.0';
    this.maxCachedShards = Math.max(8, config.maxCachedShards ?? 64);
  }

  private async readShard(
    assetPath: string,
    trackStats?: { shardsRead: number; bytesRead: number; missingShards: string[] },
    budget?: AssetBudgetContext,
  ): Promise<unknown | null> {
    const cached = this.lru.get(assetPath);
    if (cached) {
      this.lru.delete(assetPath);
      this.lru.set(assetPath, cached);
      return cached.data;
    }
    if (budget) {
      if (budget.asset_requests >= budget.max_asset_requests) {
        budget.budget_exceeded = true;
        budget.exceeded_reason = budget.exceeded_reason || 'max_asset_requests';
        return null;
      }
      if (budget.bytes_read >= budget.max_bytes_read) {
        budget.budget_exceeded = true;
        budget.exceeded_reason = budget.exceeded_reason || 'max_bytes_read';
        return null;
      }
      budget.asset_requests += 1;
    }
    const res = await this.reader.readJson(assetPath);
    if (!res) {
      if (trackStats) trackStats.missingShards.push(assetPath);
      return null;
    }
    if (trackStats) {
      trackStats.shardsRead += 1;
      trackStats.bytesRead += res.bytes;
    }
    if (budget) {
      budget.shards_read += 1;
      budget.bytes_read += res.bytes;
      if (budget.bytes_read > budget.max_bytes_read) {
        budget.budget_exceeded = true;
        budget.exceeded_reason = budget.exceeded_reason || 'max_bytes_read';
      }
    }
    this.lru.set(assetPath, res);
    if (this.lru.size > this.maxCachedShards) {
      const oldest = this.lru.keys().next().value;
      if (oldest !== undefined) this.lru.delete(oldest);
    }
    return res.data;
  }

  async getManifestSummary(budget?: AssetBudgetContext): Promise<Record<string, unknown> | null> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.readShard(`/v2/relationships/${this.releaseVersion}/manifest.json.gz`, undefined, budget) as Promise<Record<string, unknown> | null>;
    }
    const res = await this.manifestPromise;
    if (!res) this.manifestPromise = null;
    return res;
  }

  async getReleaseVersion(budget?: AssetBudgetContext): Promise<string> {
    const m = await this.getManifestSummary(budget);
    return String(m?.release_version || this.releaseVersion);
  }

  async getResolverIndex(budget?: AssetBudgetContext): Promise<ResolverIndexData | null> {
    if (!this.resolverPromise) {
      this.resolverPromise = (async () => {
        const m = await this.getManifestSummary(budget);
        if (!m) return null;
        const gramBase = String((m?.layers as Record<string, Record<string, unknown>>)?.grammatical?.base_dir || `/v2/relationships/${this.releaseVersion}`);
        return this.readShard(`${gramBase}/resolver-index.json.gz`, undefined, budget) as Promise<ResolverIndexData | null>;
      })();
    }
    const res = await this.resolverPromise;
    if (!res) this.resolverPromise = null;
    return res;
  }

  async getUncoveredLemmas(budget?: AssetBudgetContext): Promise<UncoveredLemmasData | null> {
    if (!this.uncoveredPromise) {
      this.uncoveredPromise = (async () => {
        const m = await this.getManifestSummary(budget);
        if (!m) return null;
        const gramBase = String((m?.layers as Record<string, Record<string, unknown>>)?.grammatical?.base_dir || `/v2/relationships/${this.releaseVersion}`);
        return this.readShard(`${gramBase}/uncovered-lemmas.json.gz`, undefined, budget) as Promise<UncoveredLemmasData | null>;
      })();
    }
    const res = await this.uncoveredPromise;
    if (!res) this.uncoveredPromise = null;
    return res;
  }

  async hasShardedResolver(budget?: AssetBudgetContext): Promise<boolean> {
    const m = await this.getManifestSummary(budget);
    const resLayer = (m?.layers as Record<string, Record<string, unknown>> | undefined)?.resolver;
    return Boolean(resLayer?.base_dir);
  }

  async getCompactMeta(budget?: AssetBudgetContext): Promise<CompactMetaData | null> {
    if (!this.compactMetaPromise) {
      this.compactMetaPromise = (async () => {
        const m = await this.getManifestSummary(budget);
        const resLayer = (m?.layers as Record<string, Record<string, unknown>> | undefined)?.resolver;
        if (!resLayer?.base_dir) return null;
        const fmtMap = (resLayer.shard_path_formats as Record<string, string> | undefined);
        const fmt = fmtMap?.search_hints || fmtMap?.compact_meta || 'compact-meta.json.gz';
        return this.readShard(`${resLayer.base_dir}/${fmt}`, undefined, budget) as Promise<CompactMetaData | null>;
      })();
    }
    const res = await this.compactMetaPromise;
    if (!res) this.compactMetaPromise = null;
    return res;
  }

  async getResolverBucket(lookupKey: string, budget?: AssetBudgetContext): Promise<ResolverByKeyShardData | null> {
    const m = await this.getManifestSummary(budget);
    const resLayer = (m?.layers as Record<string, Record<string, unknown>> | undefined)?.resolver;
    if (!resLayer?.base_dir) return null;
    const normKey = String(lookupKey || '').trim().toLowerCase();
    const hex = computeBucketHex(String(resLayer.hash_algorithm || 'fnv1a64_mod256'), Number(resLayer.buckets || 256), normKey);
    const fmt = String((resLayer.shard_path_formats as Record<string, string> | undefined)?.by_key || 'by-key/shard-{hex2}.json.gz').replace('{hex2}', hex);
    return this.readShard(`${resLayer.base_dir}/${fmt}`, undefined, budget) as Promise<ResolverByKeyShardData | null>;
  }

  async getEnglishConcepts(budget?: AssetBudgetContext): Promise<EnglishConceptsData | null> {
    if (!this.englishConceptsPromise) {
      this.englishConceptsPromise = (async () => {
        const m = await this.getManifestSummary(budget);
        const resLayer = (m?.layers as Record<string, Record<string, unknown>> | undefined)?.resolver;
        if (!resLayer?.base_dir) return null;
        const fmt = (resLayer.shard_path_formats as Record<string, string> | undefined)?.english_concepts || 'english-concepts.json.gz';
        return this.readShard(`${resLayer.base_dir}/${fmt}`, undefined, budget) as Promise<EnglishConceptsData | null>;
      })();
    }
    const res = await this.englishConceptsPromise;
    if (!res) this.englishConceptsPromise = null;
    return res;
  }

  async getEntityProfile(entityKey: string, budget?: AssetBudgetContext): Promise<GraphEntityRef | null> {
    if (inferEntityKind(entityKey) !== 'lemma') {
      return profileFromResolver(entityKey, null, null);
    }
    if (await this.hasShardedResolver(budget)) {
      const shard = await this.getResolverBucket(entityKey, budget);
      if (shard?.lemmas?.[entityKey]) {
        return profileFromResolver(entityKey, { lemmas: shard.lemmas }, null);
      }
      if (shard?.lemmas) {
        const lower = entityKey.toLowerCase();
        for (const [k, v] of Object.entries(shard.lemmas)) {
          if (k.toLowerCase() === lower || v.canonical_lemma_id?.toLowerCase() === lower) {
            return profileFromResolver(k, { lemmas: { [k]: v } }, null);
          }
        }
      }
      if (shard?.uncovered?.[entityKey]) {
        return profileFromResolver(entityKey, null, { entries: shard.uncovered });
      }
      return null;
    }
    const resolver = await this.getResolverIndex(budget);
    if (resolver?.lemmas?.[entityKey]) return profileFromResolver(entityKey, resolver, null);
    const uncovered = await this.getUncoveredLemmas(budget);
    return profileFromResolver(entityKey, resolver, uncovered);
  }

  async getSummaryEvidence(summaryId: string, budget?: AssetBudgetContext): Promise<HopEvidenceWitness[]> {
    const manifest = await this.getManifestSummary(budget);
    if (!manifest) return [];
    const gramLayer = ((manifest?.layers || {}) as Record<string, Record<string, unknown>>).grammatical;
    const gramBase = String(gramLayer?.base_dir || `/v2/relationships/${this.releaseVersion}`);
    const hex = computeBucketHex(String(gramLayer?.hash_algorithm || 'fnv1a64_mod256'), Number(gramLayer?.buckets || 256), summaryId);
    const evShard = (await this.readShard(`${gramBase}/evidence/by-summary/shard-${hex}.json.gz`, undefined, budget)) as {
      entries?: Record<string, Array<Record<string, unknown>>>;
    } | null;
    return (evShard?.entries?.[summaryId] || []).map((r) => ({
      relation_id: String(r.relation_id || ''),
      frame_id: String(r.frame_id || ''),
      source_clause_id: String(r.source_clause_id || ''),
      reference: String(r.canonical_ref || ''),
      edition: String(r.edition || ''),
      rule_id: String(r.rule_id || ''),
      quality: String(r.quality || ''),
      qualifiers: (r.qualifiers as Record<string, string>) || undefined,
    }));
  }

  async getNeighbors(entityKey: string, options: NeighborLoadOptions = {}): Promise<NeighborLoadResult> {
    const budget = options.budget;
    const manifest = await this.getManifestSummary(budget);
    const stats = { shardsRead: 0, bytesRead: 0, missingShards: [] as string[] };
    const incompleteReasons: string[] = [];

    if (!manifest) {
      return {
        entity: null, edges: [], total_available_edges: 0, contextual_total_neighbors: 0,
        contextual_pages_loaded: 0, contextual_pages_skipped: 0, contextual_truncated: false,
        shards_read: 0, bytes_read: 0,
        missing_shards: budget?.budget_exceeded ? [] : [`/v2/relationships/${this.releaseVersion}/manifest.json.gz`],
        uncovered_in_grammatical: false,
        incomplete_reasons: [budget?.budget_exceeded ? `Stopped by resource budget (${budget.exceeded_reason}).` : 'Relationship release manifest unavailable.'],
      };
    }

    let resolver: ResolverIndexData | null = null;
    let compactMeta: CompactMetaData | null = null;
    let entity: GraphEntityRef | null = null;
    if (await this.hasShardedResolver(budget)) {
      [entity, compactMeta] = await Promise.all([
        this.getEntityProfile(entityKey, budget),
        this.getCompactMeta(budget),
      ]);
    } else {
      resolver = await this.getResolverIndex(budget);
      const uncovered = resolver?.lemmas?.[entityKey] ? null : await this.getUncoveredLemmas(budget);
      entity = profileFromResolver(entityKey, resolver, uncovered);
    }

    const requestedLayers = new Set<GraphLayer>(options.layers?.length ? options.layers : ['grammatical', 'lexical', 'contextual', 'lxx_translation']);
    const selfRef = entity || enrichEntityRef({
      entity_key: entityKey, entity_kind: inferEntityKind(entityKey), label: entityKey.replace(/^(lemma|root|sense):/, ''),
      transliteration: null, gloss: null, language: normalizeLang(null, entityKey), pos: null, strongs_base: null, homograph_tag: null,
    }, resolver, compactMeta);
    const ctx: LayerContext = {
      entityKey, selfRef, resolver, compactMeta, options,
      predicateSet: options.predicates?.length ? new Set(options.predicates) : null,
      langSet: options.languages?.length ? new Set(options.languages.map((l) => normalizeLang(l, '') || l.toLowerCase())) : null,
      editionSet: options.editions?.length ? new Set(options.editions) : null,
      readShard: (p) => this.readShard(p, stats, budget),
    };
    const layersMeta = (manifest.layers || {}) as Record<string, Record<string, unknown>>;
    const isLemma = inferEntityKind(entityKey) === 'lemma';
    const [gramRes, lexEdges, ctxRes, lxxEdges] = await Promise.all([
      requestedLayers.has('grammatical') && isLemma && layersMeta.grammatical ? loadGrammaticalEdges(ctx, layersMeta.grammatical) : Promise.resolve({ edges: [], uncovered: false }),
      requestedLayers.has('lexical') && layersMeta.lexical ? loadLexicalEdges(ctx, layersMeta.lexical) : Promise.resolve([]),
      requestedLayers.has('contextual') && isLemma && layersMeta.contextual ? loadContextualEdges(ctx, layersMeta.contextual) : Promise.resolve({ edges: [], totalNeighbors: 0, pagesLoaded: 0, pagesSkipped: 0, truncated: false, incompleteReason: null }),
      requestedLayers.has('lxx_translation') && isLemma && layersMeta.lxx_translation ? loadLxxEdges(ctx, layersMeta.lxx_translation) : Promise.resolve([]),
    ]);
    if (ctxRes.incompleteReason) incompleteReasons.push(ctxRes.incompleteReason);
    const allEdges = [...gramRes.edges, ...lexEdges, ...ctxRes.edges, ...lxxEdges];
    return {
      entity, edges: allEdges, total_available_edges: allEdges.length,
      contextual_total_neighbors: ctxRes.totalNeighbors, contextual_pages_loaded: ctxRes.pagesLoaded,
      contextual_pages_skipped: ctxRes.pagesSkipped, contextual_truncated: ctxRes.truncated,
      shards_read: stats.shardsRead, bytes_read: stats.bytesRead, missing_shards: stats.missingShards,
      uncovered_in_grammatical: gramRes.uncovered, incomplete_reasons: incompleteReasons,
    };
  }
}
