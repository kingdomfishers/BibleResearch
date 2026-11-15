// @file: src/relationships/concept-resolver.ts
// @feature: relationships-r9c
// Explicit concept -> candidate original-language lemmas resolution without auto-collapsing semantics.

import type {
  EnglishConceptsData,
  ResolverByKeyEntry,
  ResolverByKeyShardData,
  ResolverIndexData,
  ShardedAdjacencyLoader,
  UncoveredLemmasData,
} from './adjacency-loader.ts';
import { inferEntityKind, normalizeLang } from './adjacency-loader.ts';
import type {
  AdjacencyLoader,
  AssetBudgetContext,
  ConceptCandidate,
  ConceptResolutionResult,
} from './multihop-types.ts';

// === @section:logic:concept-types-and-helpers ===
export interface ConceptSearchOptions {
  language?: string;
  limit?: number;
  include_uncovered?: boolean;
  budget?: AssetBudgetContext;
}

type ResolverCapableLoader = AdjacencyLoader & {
  getResolverIndex?: (budget?: AssetBudgetContext) => Promise<ResolverIndexData | null>;
  getUncoveredLemmas?: (budget?: AssetBudgetContext) => Promise<UncoveredLemmasData | null>;
  hasShardedResolver?: (budget?: AssetBudgetContext) => Promise<boolean>;
  getResolverBucket?: (lookupKey: string, budget?: AssetBudgetContext) => Promise<ResolverByKeyShardData | null>;
  getEnglishConcepts?: (budget?: AssetBudgetContext) => Promise<EnglishConceptsData | null>;
};

export interface EntityKeyResolution {
  ok: boolean;
  entityKey: string | null;
  status: 'ok' | 'invalid_request' | 'unknown_entity' | 'incomplete_coverage';
  message?: string;
}

const GUARDRAILS: ConceptResolutionResult['guardrails'] = {
  english_concept_never_auto_picks_single_lemma: true,
  gloss_similarity_never_creates_graph_edges: true,
  homographs_preserved_distinct: true,
};

function normalizeStrongsToken(raw: string): { isStrongs: boolean; isBaseOnly: boolean; base: string; canonicalKey: string } {
  const m = /^([HG])(\d{1,4})([A-Za-z0-9]*)$/i.exec(raw.trim());
  if (!m) return { isStrongs: false, isBaseOnly: false, base: '', canonicalKey: '' };
  const prefix = m[1].toUpperCase();
  const num = m[2].padStart(4, '0');
  const suffix = m[3] || '';
  const base = `${prefix}${num}`;
  return {
    isStrongs: true,
    isBaseOnly: suffix.length === 0,
    base,
    canonicalKey: `lemma:${base}${suffix}`,
  };
}

function candidateFromResolverEntry(
  key: string,
  entry: NonNullable<ResolverIndexData['lemmas']>[string],
  matchKind: ConceptCandidate['match_kind'],
): ConceptCandidate {
  const canonicalKey = entry.canonical_lemma_id || entry.lemma_id || key;
  return {
    entity_key: canonicalKey,
    entity_kind: inferEntityKind(canonicalKey),
    language: normalizeLang(entry.language, canonicalKey),
    label: entry.lemma_form || canonicalKey.replace(/^lemma:/, ''),
    transliteration: entry.transliteration || null,
    gloss: entry.gloss || null,
    pos: entry.pos || null,
    strongs_base: entry.strongs_base || null,
    extended_strongs: entry.extended_strongs || canonicalKey.replace(/^lemma:/, ''),
    match_kind: matchKind,
    in_grammatical_graph: entry.in_graph !== false,
    grammatical_degree: (entry.outgoing_summary_count || 0) + (entry.incoming_summary_count || 0),
  };
}

function candidateFromUncoveredTuple(
  key: string,
  tuple: [string?, string?, string?, string?, string?],
  matchKind: ConceptCandidate['match_kind'],
): ConceptCandidate {
  return {
    entity_key: key,
    entity_kind: 'lemma',
    language: normalizeLang(null, key),
    label: tuple[0] || key.replace(/^lemma:/, ''),
    transliteration: tuple[1] || null,
    gloss: tuple[2] || null,
    pos: tuple[4] || null,
    strongs_base: tuple[3] || null,
    extended_strongs: key.replace(/^lemma:/, ''),
    match_kind: matchKind,
    in_grammatical_graph: false,
    grammatical_degree: 0,
  };
}

function filterAndDedupeCandidates(candidates: ConceptCandidate[], langFilter?: string): ConceptCandidate[] {
  const normLang = langFilter ? normalizeLang(langFilter, '') || langFilter.toLowerCase() : null;
  const seen = new Map<string, ConceptCandidate>();
  for (const c of candidates) {
    if (normLang && c.language && c.language.toLowerCase() !== normLang) continue;
    const prev = seen.get(c.entity_key);
    if (!prev || (!prev.in_grammatical_graph && c.in_grammatical_graph)) {
      seen.set(c.entity_key, c);
    }
  }
  return Array.from(seen.values());
}

// === @section:logic:gloss-matching ===
function tokenizeEnglish(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2);
}

function scoreGlossMatch(gloss: string, rawQuery: string, queryTokens: string[]): number {
  const gLower = gloss.toLowerCase().trim();
  if (!gLower) return 0;
  const qLower = rawQuery.toLowerCase().trim();
  const segments = gLower.split(/[;,/()]+/).map((s) => s.trim()).filter(Boolean);
  if (gLower === qLower || segments.includes(qLower)) return 100;

  const glossWords = new Set(tokenizeEnglish(gLower));
  let exactTokenHits = 0;
  for (const qt of queryTokens) {
    if (glossWords.has(qt)) exactTokenHits += 1;
  }
  if (exactTokenHits === queryTokens.length && queryTokens.length > 0) {
    // Shorter glosses where the concept is primary rank higher than long multi-clause glosses.
    return 75 + Math.max(0, 15 - glossWords.size);
  }
  if (exactTokenHits > 0) {
    return 35 + exactTokenHits * 15;
  }
  // Substring stem check (e.g. "anoint" <-> "anointing", "create" <-> "created")
  let stemHits = 0;
  for (const qt of queryTokens) {
    const stem = qt.length >= 5 ? qt.slice(0, qt.length - 2) : qt;
    for (const gw of glossWords) {
      if (gw.startsWith(stem) || (gw.length >= 4 && qt.startsWith(gw))) {
        stemHits += 1;
        break;
      }
    }
  }
  return stemHits > 0 ? 15 + stemHits * 10 : 0;
}

function collectGlossCandidates(
  rawQuery: string,
  resolver: ResolverIndexData | null,
  uncovered: UncoveredLemmasData | null,
  includeUncovered: boolean,
): ConceptCandidate[] {
  const qTokens = tokenizeEnglish(rawQuery);
  if (!qTokens.length) return [];
  const scored: Array<{ score: number; candidate: ConceptCandidate }> = [];

  if (resolver?.lemmas) {
    for (const [key, entry] of Object.entries(resolver.lemmas)) {
      if (entry.canonical_lemma_id && entry.canonical_lemma_id !== key) continue;
      if (!entry.gloss) continue;
      const score = scoreGlossMatch(entry.gloss, rawQuery, qTokens);
      if (score > 0) {
        scored.push({ score, candidate: candidateFromResolverEntry(key, entry, 'licensed_gloss_candidate') });
      }
    }
  }
  if (includeUncovered && uncovered?.entries) {
    for (const [key, tuple] of Object.entries(uncovered.entries)) {
      if (resolver?.lemmas?.[key]) continue;
      const gloss = tuple[2];
      if (!gloss) continue;
      const score = scoreGlossMatch(gloss, rawQuery, qTokens);
      if (score > 0) {
        scored.push({ score: score - 5, candidate: candidateFromUncoveredTuple(key, tuple, 'licensed_gloss_candidate') });
      }
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.candidate.in_grammatical_graph !== a.candidate.in_grammatical_graph) {
      return Number(b.candidate.in_grammatical_graph) - Number(a.candidate.in_grammatical_graph);
    }
    if (b.candidate.grammatical_degree !== a.candidate.grammatical_degree) {
      return b.candidate.grammatical_degree - a.candidate.grammatical_degree;
    }
    return a.candidate.entity_key.localeCompare(b.candidate.entity_key);
  });
  return scored.map((s) => s.candidate);
}

function candidateFromByKeyEntry(
  item: ResolverByKeyEntry,
  matchKind: ConceptCandidate['match_kind'],
): ConceptCandidate | null {
  if (item.kind === 'lemma' && item.entry) {
    return candidateFromResolverEntry(item.entry.canonical_lemma_id || item.entry.lemma_id, item.entry, matchKind);
  }
  if (item.kind === 'uncovered' && item.key && item.tuple) {
    return candidateFromUncoveredTuple(item.key, item.tuple, matchKind);
  }
  return null;
}

function collectEnglishRowCandidates(
  rawQuery: string,
  eng: EnglishConceptsData | null,
  includeUncovered: boolean,
): ConceptCandidate[] {
  const qTokens = tokenizeEnglish(rawQuery);
  if (!qTokens.length || !eng?.rows) return [];
  const scored: Array<{ score: number; candidate: ConceptCandidate }> = [];
  for (const row of eng.rows) {
    const [key, gloss, lemmaForm, translit, lang, pos, strongsBase, extStrongs, inGraphFlag, deg, isUncFlag] = row;
    if (!includeUncovered && isUncFlag) continue;
    if (!gloss) continue;
    const score = scoreGlossMatch(gloss, rawQuery, qTokens);
    if (score > 0) {
      scored.push({
        score: isUncFlag ? score - 5 : score,
        candidate: {
          entity_key: key,
          entity_kind: inferEntityKind(key),
          language: normalizeLang(lang, key),
          label: lemmaForm || key.replace(/^lemma:/, ''),
          transliteration: translit || null,
          gloss,
          pos: pos || null,
          strongs_base: strongsBase || null,
          extended_strongs: extStrongs || key.replace(/^lemma:/, ''),
          match_kind: 'licensed_gloss_candidate',
          in_grammatical_graph: Boolean(inGraphFlag),
          grammatical_degree: Number(deg || 0),
        },
      });
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.candidate.grammatical_degree !== a.candidate.grammatical_degree) {
      return b.candidate.grammatical_degree - a.candidate.grammatical_degree;
    }
    return a.candidate.entity_key.localeCompare(b.candidate.entity_key);
  });
  return scored.map((s) => s.candidate);
}

// === @section:logic:concept-resolution-entrypoint ===
function lookupExactEntry(
  key: string,
  resolver: ResolverIndexData | null,
  uncovered: UncoveredLemmasData | null,
  matchKind: ConceptCandidate['match_kind'],
): ConceptCandidate | null {
  const direct = resolver?.lemmas?.[key];
  if (direct) return candidateFromResolverEntry(key, direct, matchKind);
  if (resolver?.lemmas) {
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(resolver.lemmas)) {
      if (k.toLowerCase() === lower || v.canonical_lemma_id?.toLowerCase() === lower) {
        return candidateFromResolverEntry(k, v, matchKind);
      }
    }
  }
  const unc = uncovered?.entries?.[key];
  if (unc) return candidateFromUncoveredTuple(key, unc, matchKind);
  return null;
}

export async function resolveResearchConcept(
  loader: AdjacencyLoader | ShardedAdjacencyLoader,
  rawQuery: string,
  options: ConceptSearchOptions = {},
): Promise<ConceptResolutionResult> {
  const query = String(rawQuery || '').trim();
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  if (!query) {
    return {
      schema_version: '1.0',
      query: rawQuery,
      status: 'invalid_request',
      requires_explicit_selection: false,
      candidates: [],
      guardrails: GUARDRAILS,
      guidance: 'Provide an English research concept, Strong\'s ID, canonical lemma/root/sense ID, or original-language form.',
    };
  }

  const cap = loader as ResolverCapableLoader;
  const useSharded = Boolean(cap.hasShardedResolver && (await cap.hasShardedResolver(options.budget)));
  let resolver: ResolverIndexData | null = null;
  let uncovered: UncoveredLemmasData | null = null;

  if (!useSharded) {
    resolver = (cap.getResolverIndex ? await cap.getResolverIndex(options.budget) : null) as ResolverIndexData | null;
    uncovered = (cap.getUncoveredLemmas ? await cap.getUncoveredLemmas(options.budget) : null) as UncoveredLemmasData | null;

    if (!resolver) {
      return {
        schema_version: '1.0',
        query,
        status: 'incomplete_coverage',
        requires_explicit_selection: false,
        candidates: [],
        guardrails: GUARDRAILS,
        guidance: options.budget?.budget_exceeded
          ? `Concept resolution stopped by resource budget (${options.budget.exceeded_reason}).`
          : 'Relationship resolver index is unavailable; cannot verify canonical entities.',
      };
    }
  } else if (options.budget?.budget_exceeded) {
    return {
      schema_version: '1.0',
      query,
      status: 'incomplete_coverage',
      requires_explicit_selection: false,
      candidates: [],
      guardrails: GUARDRAILS,
      guidance: `Concept resolution stopped by resource budget (${options.budget.exceeded_reason}).`,
    };
  }

  // 1. Canonical entity key (lemma:*, root:*, sense:*)
  if (/^(lemma|root|sense):/i.test(query)) {
    const kind = inferEntityKind(query);
    if (kind === 'lemma') {
      let hit: ConceptCandidate | null = null;
      if (useSharded) {
        const bucket = await cap.getResolverBucket!(query, options.budget);
        if (options.budget?.budget_exceeded && !bucket) {
          return {
            schema_version: '1.0', query, status: 'incomplete_coverage', requires_explicit_selection: false,
            candidates: [], guardrails: GUARDRAILS,
            guidance: `Concept resolution stopped by resource budget (${options.budget.exceeded_reason}).`,
          };
        }
        hit = lookupExactEntry(query, bucket ? { lemmas: bucket.lemmas } : null, bucket ? { entries: bucket.uncovered } : null, 'exact_id');
      } else {
        hit = lookupExactEntry(query, resolver, uncovered, 'exact_id');
      }
      if (hit) {
        return {
          schema_version: '1.0', query, status: 'resolved', requires_explicit_selection: false,
          candidates: [hit], guardrails: GUARDRAILS,
          guidance: `Exact canonical lemma resolved: ${hit.entity_key}.`,
        };
      }
      const stripped = query.replace(/^lemma:/i, '');
      const baseMatch = /^([HG]\d{1,4})$/i.exec(stripped);
      if (baseMatch) {
        const strongsBase = `${baseMatch[1][0].toUpperCase()}${baseMatch[1].slice(1).padStart(4, '0')}`;
        const baseCandidates: ConceptCandidate[] = [];
        if (useSharded) {
          const baseShard = await cap.getResolverBucket!(strongsBase, options.budget);
          for (const item of baseShard?.by_strongs_base?.[strongsBase] || []) {
            const c = candidateFromByKeyEntry(item, 'base_strongs_candidate');
            if (c) baseCandidates.push(c);
          }
        } else {
          const baseIds = resolver?.by_strongs_base?.[strongsBase] || [];
          for (const id of baseIds) {
            const entry = resolver?.lemmas?.[id];
            if (entry) baseCandidates.push(candidateFromResolverEntry(id, entry, 'base_strongs_candidate'));
          }
        }
        const deduped = filterAndDedupeCandidates(baseCandidates, options.language).slice(0, limit);
        if (deduped.length === 1) {
          return {
            schema_version: '1.0', query, status: 'resolved', requires_explicit_selection: false,
            candidates: deduped, guardrails: GUARDRAILS,
            guidance: `Unique Strong's candidate resolved: ${deduped[0].entity_key}.`,
          };
        }
        if (deduped.length > 1) {
          return {
            schema_version: '1.0', query, status: 'needs_disambiguation', requires_explicit_selection: true,
            candidates: deduped, guardrails: GUARDRAILS,
            guidance: `Strong's base ${strongsBase} maps to ${deduped.length} distinct homograph/canonical lemmas; explicit selection is required.`,
          };
        }
      }
    } else {
      const profile = await loader.getEntityProfile(query, options.budget);
      const lexProbe = await loader.getNeighbors(query, { layers: ['lexical'], max_edges_per_node: 2, budget: options.budget });
      if (lexProbe.missing_shards.length > 0 && lexProbe.edges.length === 0) {
        return {
          schema_version: '1.0', query, status: 'incomplete_coverage', requires_explicit_selection: false,
          candidates: [], guardrails: GUARDRAILS,
          guidance: `Lexical shards unavailable while verifying ${query}.`,
        };
      }
      if (profile && lexProbe.edges.length > 0) {
        return {
          schema_version: '1.0', query, status: 'resolved', requires_explicit_selection: false,
          candidates: [{
            entity_key: query, entity_kind: kind, language: profile.language,
            label: profile.label, transliteration: null, gloss: null, pos: null,
            strongs_base: null, extended_strongs: null, match_kind: 'exact_id',
            in_grammatical_graph: false, grammatical_degree: 0,
          }],
          guardrails: GUARDRAILS,
          guidance: `Exact ${kind} entity resolved: ${query}. Note that ${kind} entities are typed lexical nodes, not independent lemmas.`,
        };
      }
    }
    return {
      schema_version: '1.0', query, status: 'not_found', requires_explicit_selection: false,
      candidates: [], guardrails: GUARDRAILS,
      guidance: `Entity "${query}" was not found in the local relationship indexes.`,
    };
  }

  // 2. Strong's ID (extended or base)
  const strongs = normalizeStrongsToken(query);
  if (strongs.isStrongs) {
    if (!strongs.isBaseOnly) {
      const rawExt = strongs.canonicalKey.replace(/^lemma:/, '');
      let hit: ConceptCandidate | null = null;
      if (useSharded) {
        const extShard = await cap.getResolverBucket!(rawExt, options.budget);
        const mapped = extShard?.by_strongs_extended?.[rawExt];
        if (mapped) hit = candidateFromByKeyEntry(mapped, 'extended_strongs');
        if (!hit) {
          const directShard = await cap.getResolverBucket!(strongs.canonicalKey, options.budget);
          hit = lookupExactEntry(strongs.canonicalKey, directShard ? { lemmas: directShard.lemmas } : null, directShard ? { entries: directShard.uncovered } : null, 'extended_strongs');
        }
      } else {
        const extKey = resolver?.by_strongs_extended?.[rawExt] || strongs.canonicalKey;
        hit = lookupExactEntry(extKey, resolver, uncovered, 'extended_strongs');
      }
      if (hit) {
        return {
          schema_version: '1.0', query, status: 'resolved', requires_explicit_selection: false,
          candidates: [hit], guardrails: GUARDRAILS,
          guidance: `Extended Strong's resolved to ${hit.entity_key}.`,
        };
      }
    }
    const baseCandidates: ConceptCandidate[] = [];
    if (useSharded) {
      const baseShard = await cap.getResolverBucket!(strongs.base, options.budget);
      for (const item of baseShard?.by_strongs_base?.[strongs.base] || []) {
        const c = candidateFromByKeyEntry(item, 'base_strongs_candidate');
        if (c) baseCandidates.push(c);
      }
      if (baseCandidates.length === 0) {
        const directShard = await cap.getResolverBucket!(`lemma:${strongs.base}`, options.budget);
        const directBase = lookupExactEntry(`lemma:${strongs.base}`, directShard ? { lemmas: directShard.lemmas } : null, directShard ? { entries: directShard.uncovered } : null, 'base_strongs_candidate');
        if (directBase) baseCandidates.push(directBase);
      }
    } else {
      const baseIds = resolver?.by_strongs_base?.[strongs.base] || [];
      for (const id of baseIds) {
        const entry = resolver?.lemmas?.[id];
        if (entry) baseCandidates.push(candidateFromResolverEntry(id, entry, 'base_strongs_candidate'));
      }
      const directBase = lookupExactEntry(`lemma:${strongs.base}`, resolver, uncovered, 'base_strongs_candidate');
      if (directBase) baseCandidates.push(directBase);
    }
    const deduped = filterAndDedupeCandidates(baseCandidates, options.language).slice(0, limit);
    if (deduped.length === 1) {
      return {
        schema_version: '1.0', query, status: 'resolved', requires_explicit_selection: false,
        candidates: deduped, guardrails: GUARDRAILS,
        guidance: `Unique Strong's candidate resolved: ${deduped[0].entity_key}.`,
      };
    }
    if (deduped.length > 1) {
      return {
        schema_version: '1.0', query, status: 'needs_disambiguation', requires_explicit_selection: true,
        candidates: deduped, guardrails: GUARDRAILS,
        guidance: `Strong's base ${strongs.base} maps to ${deduped.length} distinct homograph/canonical lemmas; explicit selection is required.`,
      };
    }
  }

  // === @section:logic:surface-and-english-concept ===
  // 3. Surface form or transliteration
  if (useSharded) {
    const surfShard = await cap.getResolverBucket!(query, options.budget);
    const surfEntries = surfShard?.by_surface_form?.[query] || surfShard?.by_transliteration?.[query.toLowerCase()] || [];
    if (surfEntries.length > 0) {
      const matchKind = surfShard?.by_surface_form?.[query] ? 'surface_form' : 'transliteration';
      const raw = surfEntries.map((entry) => candidateFromResolverEntry(entry.canonical_lemma_id || entry.lemma_id, entry, matchKind));
      const deduped = filterAndDedupeCandidates(raw, options.language).slice(0, limit);
      if (deduped.length > 0) {
        const needsChoice = deduped.length > 1;
        return {
          schema_version: '1.0', query,
          status: needsChoice ? 'needs_disambiguation' : 'resolved',
          requires_explicit_selection: needsChoice,
          candidates: deduped, guardrails: GUARDRAILS,
          guidance: needsChoice
            ? `Multiple lemmas match "${query}"; select explicit canonical entity_key values before graph traversal.`
            : `Resolved "${query}" to ${deduped[0].entity_key}.`,
        };
      }
    }
  } else {
    const surfMatches = resolver?.by_surface_form?.[query] || resolver?.by_transliteration?.[query.toLowerCase()] || [];
    if (surfMatches.length > 0) {
      const matchKind = resolver?.by_surface_form?.[query] ? 'surface_form' : 'transliteration';
      const raw = surfMatches
        .map((id) => (resolver?.lemmas?.[id] ? candidateFromResolverEntry(id, resolver.lemmas[id], matchKind) : null))
        .filter((x): x is ConceptCandidate => x !== null);
      const deduped = filterAndDedupeCandidates(raw, options.language).slice(0, limit);
      if (deduped.length > 0) {
        const needsChoice = deduped.length > 1;
        return {
          schema_version: '1.0', query,
          status: needsChoice ? 'needs_disambiguation' : 'resolved',
          requires_explicit_selection: needsChoice,
          candidates: deduped, guardrails: GUARDRAILS,
          guidance: needsChoice
            ? `Multiple lemmas match "${query}"; select explicit canonical entity_key values before graph traversal.`
            : `Resolved "${query}" to ${deduped[0].entity_key}.`,
        };
      }
    }
  }

  // 4. English research concept -> candidate lemmas ONLY (never auto-select single lemma)
  let glossRaw: ConceptCandidate[] = [];
  if (useSharded) {
    const eng = await cap.getEnglishConcepts!(options.budget);
    if (!eng) {
      return {
        schema_version: '1.0',
        query,
        status: 'incomplete_coverage',
        requires_explicit_selection: false,
        candidates: [],
        guardrails: GUARDRAILS,
        guidance: options.budget?.budget_exceeded
          ? `Concept resolution stopped by resource budget (${options.budget.exceeded_reason}).`
          : 'English concept index unavailable; cannot resolve gloss candidates.',
      };
    }
    glossRaw = collectEnglishRowCandidates(query, eng, options.include_uncovered !== false);
  } else {
    glossRaw = collectGlossCandidates(query, resolver, uncovered, options.include_uncovered !== false);
  }
  const glossCandidates = filterAndDedupeCandidates(glossRaw, options.language).slice(0, limit);
  if (glossCandidates.length === 0) {
    return {
      schema_version: '1.0', query, status: 'not_found', requires_explicit_selection: false,
      candidates: [], guardrails: GUARDRAILS,
      guidance: `No candidate lemmas found for concept "${query}" in licensed gloss indexes.`,
    };
  }
  return {
    schema_version: '1.0',
    query,
    status: 'needs_disambiguation',
    requires_explicit_selection: true,
    candidates: glossCandidates,
    guardrails: GUARDRAILS,
    guidance: `English concept "${query}" yielded ${glossCandidates.length} candidate lemma(s) from licensed glosses. Select one or more entity_key values explicitly; gloss similarity never implies lexical equivalence.`,
  };
}

export async function resolveEntityKeyDetailed(
  loader: AdjacencyLoader,
  input: string,
  budget?: AssetBudgetContext,
): Promise<EntityKeyResolution> {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return { ok: false, entityKey: null, status: 'invalid_request', message: 'Entity identifier must be non-empty.' };
  }
  const res = await resolveResearchConcept(loader, trimmed, { limit: 10, budget });
  if (res.status === 'resolved' && res.candidates.length === 1) {
    return { ok: true, entityKey: res.candidates[0].entity_key, status: 'ok' };
  }
  if (res.status === 'incomplete_coverage') {
    return { ok: false, entityKey: null, status: 'incomplete_coverage', message: res.guidance };
  }
  if (res.status === 'needs_disambiguation') {
    return { ok: false, entityKey: null, status: 'invalid_request', message: res.guidance };
  }
  if (res.status === 'not_found') {
    return { ok: false, entityKey: null, status: 'unknown_entity', message: res.guidance };
  }
  return { ok: false, entityKey: null, status: 'invalid_request', message: res.guidance };
}

export async function resolveEntityKey(loader: AdjacencyLoader, input: string): Promise<string | null> {
  const r = await resolveEntityKeyDetailed(loader, input);
  return r.entityKey;
}
