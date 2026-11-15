/**
 * R10 Biblical Concept, Motif & Typology Discovery Runtime Engine
 * Runs identically in Cloudflare Workers (via AssetReader) and Node.js tests.
 * Two-stage bounded execution:
 *   Stage 1: Parse NL / concept lists / refs -> resolve original-language & motif/event candidates
 *   Stage 2: Score & verify evidence records, build subclusters + bridges, synthesize live
 *            xref/number/orthographic/motif witnesses, apply hierarchy & coincidence penalties,
 *            attach negative controls & alternative explanations.
 */

import { computeBucketHex } from './adjacency-loader.ts';
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
  R10EvidenceRecord,
  R10EvidenceTier,
  R10Node,
  R10NumberKind,
  R10OriginalWordRef,
  R10PassageRef,
  R10ResolvedConcept,
} from './r10-types.ts';

export const DEFAULT_R10_RELEASE = 'r10-v1.0';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_SUBREQUEST_BUDGET = 28;
const MAX_EVIDENCE_BOOKS = 6;

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

const CLUSTER_TOPICS: Array<{ id: string; label: string; summary: string; concepts: string[] }> = [
  {
    id: 'cluster:lampstand_vision',
    label: 'Sanctuary Lampstand, Seven Lamps & Seven Spirits Vision',
    summary: 'Prophetic & apocalyptic throne/sanctuary imagery linking menorah (מְנוֹרָה / λυχνία), seven lamps, olive oil, YHWH’s seven eyes, and the seven Spirits of God.',
    concepts: ['seven', 'lamps', 'lamp', 'menorah', 'lampstand', 'oil', 'eyes', 'eye', 'fire', 'revelation', 'zechariah', 'spirit', 'spirits', '7'],
  },
  {
    id: 'cluster:ruach_wind_water',
    label: 'Ruach / Pneuma: Spirit, Wind, Breath, Directions & Living Water',
    summary: 'Lexical and thematic connections across Hebrew רוּחַ and Greek πνεῦμα (Spirit, wind, breath, four winds/directions) interacting with creation and living water.',
    concepts: ['ruach', 'pneuma', 'spirit', 'spirits', 'wind', 'winds', 'breath', 'directions', 'direction', 'four', 'water', 'waters', 'river', 'rivers', 'creation', 'genesis'],
  },
  {
    id: 'cluster:exodus_typology',
    label: 'Exodus Deliverance & NT Typology (Red Sea / Passover / Baptism)',
    summary: 'Historical Exodus events explicitly interpreted by NT authors as typological comparisons (1 Cor 10:1–2; 1 Cor 5:7; John 19:36; 1 Pet 1:19).',
    concepts: ['red', 'sea', 'exodus', 'baptism', 'baptized', 'passover', 'lamb', 'blood', 'door', 'doorpost', 'doorposts', 'jesus', 'christ', 'cloud', 'moses'],
  },
  {
    id: 'cluster:orthographic_wordplay',
    label: 'Hebrew Consonantal Wordplay & Orthographic Analysis',
    summary: 'Evaluates shared consonantal sequences (אָדָם ↔ אֲדָמָה Gen 2:7 wordplay vs אָדָם ↔ דָּם non-etymological consonantal overlap) and homographs.',
    concepts: ['adam', 'dam', 'adamah', 'ground', 'blood', 'wordplay', 'root', 'ayin', 'spring', 'eye', 'אדם', 'דם', 'אדמה'],
  },
];

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

function confidenceFromRecord(r: R10EvidenceRecord): R10ConnectionSummary['confidence_label'] {
  if (r.predicate === 'explicit_identification' || r.predicate === 'explicit_comparison' || r.predicate === 'typological_interpretation' || r.predicate === 'direct_quotation' || r.predicate === 'authorial_interpretation') {
    return r.evidence_tier <= 2 ? 'explicit_textual' : 'strong_correspondence';
  }
  if (r.predicate === 'literary_correspondence' || r.predicate === 'cross_reference_witness') return 'strong_correspondence';
  if (r.predicate === 'verified_lexical_grammatical' || r.predicate === 'cross_language_bridge' || r.predicate === 'orthographic_wordplay') return 'lexical_reference';
  if (r.predicate === 'literary_pattern') return 'candidate_pattern';
  if (r.predicate === 'orthographic_overlap') return 'orthographic_only';
  if (r.predicate === 'interpretive_hypothesis') return 'interpretive';
  return 'moderate_motif';
}

function defaultUncertainty(r: R10EvidenceRecord): string {
  if (r.predicate === 'explicit_identification') return 'Directly stated in text; keep separate from other passages with distinct referents.';
  if (r.predicate === 'typological_interpretation' || r.predicate === 'explicit_comparison') return 'Explicit NT authorial comparison; separates historical OT narrative from later NT theological interpretation.';
  if (r.predicate === 'authorial_interpretation') return 'Explicit biblical narrator/author gloss; intertextual OT echoes remain secondary.';
  if (r.predicate === 'verified_lexical_grammatical' || r.predicate === 'cross_language_bridge') return 'Documented original-language lexical/translation fact; context governs which sense applies per verse.';
  if (r.predicate === 'literary_correspondence' || r.predicate === 'cross_reference_witness') return 'Cross-reference / lexical correspondence; shared motif or anchor does not alone prove direct citation.';
  if (r.predicate === 'orthographic_overlap') return 'Spelling/consonantal overlap ONLY; does NOT establish a shared etymological root.';
  if (r.predicate === 'literary_pattern') return 'Candidate literary/structural pattern; interpretive synthesis beyond explicit text links.';
  if (r.predicate === 'numbered_entity') return 'Co-occurring counted entity; verify object identity vs coincidental shared number.';
  return 'Shared biblical motif across passages; contextual differences preserved.';
}

async function readR10Json<T = any>(
  reader: AssetReader,
  releaseId: string,
  relPath: string,
  budget: { used: number; max: number }
): Promise<T | null> {
  if (budget.used >= budget.max) return null;
  budget.used++;
  const fullPath = `/v2/relationships/${releaseId}/r10/${relPath}`;
  const res = await reader.readJson(fullPath);
  return (res?.data as T) ?? null;
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
    const vs = m[3] ? Number(m[3]) : null;
    const endVs = m[4] ? Number(m[4]) : undefined;
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
  const cleaned = String(query.query || '')
    .replace(/([A-Za-z]+)'s\b/g, '$1')
    .replace(/[?,;()[\]{}"]/g, ' ');
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

export async function discoverBiblicalConnections(
  reader: AssetReader,
  query: DiscoverConnectionsQuery,
  releaseId: string = query.release_id || DEFAULT_R10_RELEASE
): Promise<DiscoverConnectionsResult> {
  const tStart = Date.now();
  const budget = { used: 0, max: MAX_SUBREQUEST_BUDGET };
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(query.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Number.parseInt(String(query.cursor || '0'), 10) || 0);

  const [conceptIdx, explicitData, motifsData, numbersData] = await Promise.all([
    readR10Json(reader, releaseId, 'concept-index.json.gz', budget) as Promise<ConceptIndexData | null>,
    readR10Json(reader, releaseId, 'explicit-and-typology.json.gz', budget) as Promise<{ records: any[] } | null>,
    readR10Json(reader, releaseId, 'motifs-and-patterns.json.gz', budget) as Promise<{ motifs: Record<string, any>; motif_pairs: Record<string, any>; events: any[] } | null>,
    readR10Json(reader, releaseId, 'numbers-index.json.gz', budget) as Promise<{ by_value: Record<string, any> } | null>,
  ]);

  if (!conceptIdx || !explicitData || !motifsData) {
    throw new Error(`R10 release indexes missing for release_id=${releaseId}`);
  }

  const extractedTerms = tokenizeTerms(query);
  const parsedRefs = parsePassageReferences(query.query || '', conceptIdx.book_names || []);
  const explicitPassages: R10PassageRef[] = parsedRefs.map(pr => {
    const bk = conceptIdx.book_names.find(b => b.id === pr.book);
    return {
      verse_id: 0,
      ref: `${bk?.name || `Book ${pr.book}`} ${pr.chapter}${pr.verse ? `:${pr.verse}` : ''}`,
      book: pr.book,
      chapter: pr.chapter,
      verse: pr.verse ?? 1,
      end_verse: pr.endVerse,
      testament: pr.book <= 39 ? 'OT' : 'NT',
    };
  });

  // Resolve concepts via hot concept-index + events + bounded sharded lemma-lookup
  const resolvedConcepts: R10ResolvedConcept[] = [];
  const missingConcepts: string[] = [];
  const matchedStrongs = new Set<string>();
  const matchedMotifs = new Set<string>();
  const matchedNumbers = new Set<number>();
  const matchedEvents: any[] = [];
  const lemmaCache = new Map<string, any>();

  // Skip chapter/verse numbers that belonged to explicit passage refs (like "10", "1", "2" in "1 Cor 10:1-2")
  const refTokensToIgnore = new Set<string>();
  for (const pr of parsedRefs) {
    refTokensToIgnore.add(String(pr.chapter));
    if (pr.verse) refTokensToIgnore.add(String(pr.verse));
    if (pr.endVerse) refTokensToIgnore.add(String(pr.endVerse));
  }

  const shardMemo = new Map<string, Map<string, any[]>>();
  async function lookupShardToken(tok: string): Promise<any[]> {
    const normKey = tok.toLowerCase();
    const bHex = computeBucketHex('fnv1a64_mod64', 64, normKey);
    if (!shardMemo.has(bHex)) {
      const shard = await readR10Json(reader, releaseId, `lemma-lookup/shard-${bHex}.json.gz`, budget);
      const map = new Map<string, any[]>();
      if (shard?.entries) {
        for (const [k, arr] of shard.entries) map.set(k, arr);
      }
      shardMemo.set(bHex, map);
    }
    return shardMemo.get(bHex)?.get(normKey) || [];
  }

  for (const term of extractedTerms) {
    if (/^\d+$/.test(term) && refTokensToIgnore.has(term) && !NUMBER_WORDS[term]) continue;
    const lower = term.toLowerCase();
    const alias = conceptIdx.aliases[lower];
    const numVal = NUMBER_WORDS[lower];
    const evHits = (motifsData.events || []).filter(e =>
      e.keywords?.includes(lower) && (lower.length >= 4 || ['red', 'sea'].includes(lower))
    ).slice(0, 4);

    if (alias || numVal !== undefined) {
      const lemmas: R10OriginalWordRef[] = (alias?.original_words || []).map(w => ({ ...w }));
      const nodes: R10Node[] = [];
      for (const s of alias?.strongs || []) matchedStrongs.add(s);
      for (const m of alias?.motifs || []) {
        matchedMotifs.add(m);
        const mInfo = motifsData.motifs[m];
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
        lemmaCache.set(w.strongs || '', w);
        nodes.push({
          id: `lemma:${w.strongs}`,
          kind: 'lemma',
          label: `${w.lemma_script} (${w.transliteration})`,
          subtitle: w.gloss,
          language: w.language,
          strongs: w.strongs,
          lemma_key: w.lemma_key,
          lemma_script: w.lemma_script,
          transliteration: w.transliteration,
          gloss: w.gloss,
          epistemic_class: 'documented_lexical_relationship',
          grounding_source: 'STEPBible',
        });
      }
      resolvedConcepts.push({
        input_token: term,
        normalized: lower,
        matched: true,
        resolution_kind: numVal !== undefined ? 'number' : (alias?.motifs?.length ? 'motif' : 'english_concept'),
        candidate_nodes: nodes,
        lemmas,
        ambiguity_note: alias?.note,
      });
      continue;
    }

    // Fallback: look up in sharded lemma-lookup within subrequest budget
    const hits = await lookupShardToken(/^[HG]\d+$/i.test(term) ? term.toUpperCase() : lower);
    if (hits.length > 0 || evHits.length > 0) {
      const lemmas: R10OriginalWordRef[] = hits.slice(0, 5).map(h => {
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
        return ow;
      });
      const nodes: R10Node[] = lemmas.map(w => ({
        id: `lemma:${w.strongs}`,
        kind: 'lemma',
        label: `${w.lemma_script} (${w.transliteration})`,
        subtitle: w.gloss,
        language: w.language,
        strongs: w.strongs,
        lemma_key: w.lemma_key,
        lemma_script: w.lemma_script,
        transliteration: w.transliteration,
        gloss: w.gloss,
        epistemic_class: 'documented_lexical_relationship',
        grounding_source: 'STEPBible + MACULA',
      }));
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
      resolvedConcepts.push({
        input_token: term,
        normalized: lower,
        matched: true,
        resolution_kind: /^[HG]\d+$/i.test(term) ? 'strongs' : (hits.length ? 'english_concept' : 'event'),
        candidate_nodes: nodes,
        lemmas,
        ambiguity_note: hits.length > 3 ? `Multiple original-language candidates (${hits.slice(0, 3).map(h => h.sc).join(', ')}...)` : undefined,
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

  // Stage 2: Score & gather candidate evidence records
  const allCandidates: R10EvidenceRecord[] = [];
  const queryTermSet = new Set(extractedTerms.map(t => t.toLowerCase()));
  const multiConcept = extractedTerms.filter(t => !refTokensToIgnore.has(t)).length >= 2 || parsedRefs.length >= 2;

  for (const rec of explicitData.records || []) {
    const recTerms = new Set((rec.matched_terms || []).map((t: string) => t.toLowerCase()));
    const matchedQueryTerms: string[] = [];
    for (const qt of queryTermSet) {
      if (recTerms.has(qt)) matchedQueryTerms.push(qt);
    }
    // Also match on Strong's IDs or explicit passage books/chapters
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
    // If single query hit and it's only a generic single word on a massive explicit comparison, require stronger relevance unless it's a control or passage match
    if (multiConcept && matchedQueryTerms.length < 1 && strongsOverlap < 1 && passageOverlap === 0) continue;
    // Auto-extracted copula hits in multi-concept queries must match at least 2 distinct query concepts or an explicit passage ref
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

  // Synthesize dynamic motif pair evidence (for general motif discovery across all 31k verses)
  const motifArray = [...matchedMotifs];
  for (let i = 0; i < motifArray.length; i++) {
    for (let j = i + 1; j < motifArray.length; j++) {
      const [a, b] = [motifArray[i], motifArray[j]].sort();
      const pair = motifsData.motif_pairs?.[`${a}|${b}`];
      if (!pair || !pair.passages?.length) continue;
      const mA = motifsData.motifs[a];
      const mB = motifsData.motifs[b];
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

  // Dynamic Number Entity checks (bounded) when numbers are queried
  if (matchedNumbers.size > 0 && numbersData?.by_value) {
    for (const nVal of matchedNumbers) {
      const bucket = numbersData.by_value[String(nVal)];
      if (!bucket) continue;
      // Find groups relevant to query lemmas or top symbolic groups
      const relevantGroups = (bucket.groups || []).filter((g: any) =>
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

  // Dynamic Orthographic shard lookup when Hebrew lemmas appear
  const hebStrongs = [...matchedStrongs].filter(s => s.startsWith('H')).slice(0, 3);
  const orthDetails: any[] = [];
  for (const hs of hebStrongs) {
    const bHex = computeBucketHex('fnv1a64_mod64', 64, hs);
    const orthShard = await readR10Json(reader, releaseId, `orthographic/shard-${bHex}.json.gz`, budget);
    const entry = orthShard?.entries?.[hs];
    if (entry) orthDetails.push(entry);
  }

  // Dynamic CrossReferences.org lookup for explicit parsed passage refs (or top anchors)
  const crossReferencesOut: DiscoverConnectionsResult['related_discoveries']['cross_references'] = [];
  const xrefBooksToCheck = [...new Set(parsedRefs.map(p => p.book))].slice(0, 3);
  for (const bk of xrefBooksToCheck) {
    const pad = String(bk).padStart(2, '0');
    const xData = await readR10Json(reader, releaseId, `xrefs/book-${pad}.json.gz`, budget);
    if (!xData?.by_verse) continue;
    const reqPr = parsedRefs.find(p => p.book === bk);
    for (const vData of Object.values(xData.by_verse) as any[]) {
      for (const o of vData.out || []) {
        for (const t of (o.targets || []).slice(0, 4)) {
          if (reqPr && !t.to_ref.includes(String(reqPr.chapter))) {
            // keep cross-book refs first
          }
          if (crossReferencesOut.length < 18) {
            const p0 = explicitPassages.find(p => p.book === bk);
            crossReferencesOut.push({
              from_ref: p0?.ref || `Book ${bk}`,
              to_ref: t.to_ref,
              anchor_phrase: o.phrase,
              from_passage: p0 || { verse_id: 0, ref: `Book ${bk}`, book: bk, chapter: reqPr?.chapter || 1, verse: reqPr?.verse || 1, testament: bk <= 39 ? 'OT' : 'NT' },
              to_passage: { verse_id: t.to_vid, ref: t.to_ref, book: t.to_b, chapter: t.to_c, verse: t.to_v, end_verse: t.to_end_v, testament: t.to_b <= 39 ? 'OT' : 'NT' },
            });
          }
        }
      }
    }
  }
  // Also attach curated cross-references from matched passages when no passage ref was typed
  if (crossReferencesOut.length === 0) {
    for (const c of allCandidates.slice(0, 3)) {
      const p0 = c.passages[0];
      const p1 = c.passages[1];
      if (p0 && p1) {
        crossReferencesOut.push({
          from_ref: p0.ref,
          to_ref: p1.ref,
          anchor_phrase: c.predicate.replace(/_/g, ' '),
          from_passage: p0,
          to_passage: p1,
        });
      }
    }
  }

  // Apply query filters
  const filters = query.filters || {};
  let filtered = allCandidates.filter(c => {
    if (filters.predicates?.length && !filters.predicates.includes(c.predicate)) return false;
    if (filters.max_tier && c.evidence_tier > filters.max_tier) return false;
    if (filters.include_orthographic === false && (c.predicate === 'orthographic_overlap' || c.predicate === 'orthographic_wordplay')) return false;
    if (filters.include_candidate_patterns === false && c.predicate === 'literary_pattern') return false;
    if (filters.include_interpretive === false && c.predicate === 'interpretive_hypothesis') return false;
    if (filters.testaments?.length && !c.passages.some(p => filters.testaments!.includes(p.testament))) return false;
    return true;
  });

  filtered.sort((a, b) => b.score_components.final_score - a.score_components.final_score || a.evidence_tier - b.evidence_tier);

  // Deduplicate by evidence_id
  const uniqueMap = new Map<string, R10EvidenceRecord>();
  for (const item of filtered) {
    if (!uniqueMap.has(item.evidence_id)) uniqueMap.set(item.evidence_id, item);
  }
  const rankedAll = [...uniqueMap.values()];
  const pagedRecords = rankedAll.slice(offset, offset + limit);

  const summaries: R10ConnectionSummary[] = pagedRecords.map(r => {
    const penalties: string[] = [];
    if (r.score_components.common_word_penalty > 0) penalties.push(`common_word_penalty(-${r.score_components.common_word_penalty})`);
    if (r.score_components.number_coincidence_penalty > 0) penalties.push(`number_coincidence_penalty(-${r.score_components.number_coincidence_penalty})`);
    if (r.score_components.orthographic_penalty > 0) penalties.push(`orthographic_penalty(-${r.score_components.orthographic_penalty})`);
    return {
      connection_id: r.evidence_id,
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
    };
  });

  // Build non-linear Subclusters + Bridges for multi-concept queries
  const clusters: R10Cluster[] = [];
  const bridges: R10ClusterBridge[] = [];
  for (const topic of CLUSTER_TOPICS) {
    const overlap = extractedTerms.filter(t => topic.concepts.includes(t.toLowerCase()));
    if (overlap.length === 0) continue;
    const clConnIds = summaries.filter(s => s.matched_concepts.some(c => topic.concepts.includes(c)) || overlap.some(o => s.title.toLowerCase().includes(o))).map(s => s.connection_id);
    if (clConnIds.length === 0) continue;
    const anchorNodes: R10Node[] = [];
    const seenNode = new Set<string>();
    for (const s of summaries.filter(x => clConnIds.includes(x.connection_id)).slice(0, 4)) {
      for (const w of s.original_words.slice(0, 2)) {
        const nid = `lemma:${w.strongs}`;
        if (!seenNode.has(nid)) {
          seenNode.add(nid);
          anchorNodes.push({
            id: nid, kind: 'lemma', label: `${w.lemma_script} (${w.gloss})`,
            strongs: w.strongs, lemma_key: w.lemma_key, language: w.language,
            epistemic_class: s.epistemic_class, grounding_source: 'STEPBible',
          });
        }
      }
      if (s.passages[0] && !seenNode.has(`passage:${s.passages[0].ref}`)) {
        seenNode.add(`passage:${s.passages[0].ref}`);
        anchorNodes.push({
          id: `passage:${s.passages[0].ref}`, kind: 'passage', label: s.passages[0].ref,
          passage: s.passages[0], epistemic_class: s.epistemic_class, grounding_source: 'MACULA',
        });
      }
    }
    clusters.push({
      cluster_id: topic.id,
      label: topic.label,
      concepts: overlap,
      anchor_nodes: anchorNodes.slice(0, 6),
      connection_ids: clConnIds,
      summary: topic.summary,
    });
  }

  if (clusters.length >= 2) {
    // Identify shared bridging node (e.g. Spirit H7307 / G4151 between Lampstand Vision and Ruach/Wind/Water)
    for (let i = 0; i < clusters.length - 1; i++) {
      const cA = clusters[i];
      const cB = clusters[i + 1];
      const bridgeNode = cA.anchor_nodes.find(n => ['lemma:H7307', 'lemma:G4151', 'lemma:H4325', 'lemma:G5204'].includes(n.id)) ||
        cB.anchor_nodes.find(n => ['lemma:H7307', 'lemma:G4151', 'lemma:H4325', 'lemma:G5204'].includes(n.id)) ||
        cA.anchor_nodes[0];
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

  // Construct bounded Connection Paths from top evidence records
  const connectionPaths: R10ConnectionPath[] = pagedRecords.slice(0, 6).map(r => {
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

  // Negative Controls & Alternative Explanations
  const controls: R10ControlOrWarning[] = [];
  if (matchedMotifs.has('lampstand') || matchedMotifs.has('lamp') || queryTermSet.has('seven')) {
    controls.push({
      control_id: 'ctrl:rev1_20_vs_rev4_5',
      kind: 'distinct_context_warning',
      title: 'Distinct imagery control: Rev 1:20 lampstands (λυχνίαι = churches) vs Rev 4:5 lamps (λαμπάδες = Spirits)',
      explanation: 'Revelation explicitly gives different referents for the seven lampstands (Rev 1:20 = seven churches) and the seven burning lamps (Rev 4:5 = seven Spirits of God). Do not merge all "seven + lamp" references into one meaning.',
      passages: rankedAll.find(r => r.evidence_id === 'r10:ident:rev1_20_lampstands_churches_control')?.passages,
    });
  }
  if (queryTermSet.has('seven') || queryTermSet.has('7') || queryTermSet.has('four') || queryTermSet.has('4')) {
    controls.push({
      control_id: 'ctrl:number_coincidence_guard',
      kind: 'number_coincidence_warning',
      title: 'Number coincidence guard: shared numeral alone does not prove theological connection',
      explanation: 'Ordinal occurrences (e.g., 7th day), temporal durations (7 days), and unrelated ordinary counts are separated from symbolic vision counts (Zech 4:2/10; Rev 4:5; Rev 5:6) and penalized when context differs.',
    });
  }
  if (queryTermSet.has('baptism') || queryTermSet.has('sea') || queryTermSet.has('exodus')) {
    controls.push({
      control_id: 'ctrl:exod14_event_vs_paul_typology',
      kind: 'alternative_explanation',
      title: 'Historical event vs later NT typology (Exodus 14 vs 1 Corinthians 10:1–2)',
      explanation: 'Exodus 14 narrates Israel’s historical deliverance without baptism vocabulary; Paul in 1 Cor 10:1–2 explicitly introduces the typological lens ("baptized into Moses in the cloud and in the sea"). Avoid reading later baptismal symbolism into every Exodus 14 detail.',
    });
  }
  if (queryTermSet.has('adam') && queryTermSet.has('dam') || hebStrongs.some(s => s === 'H0120' || s === 'H1818')) {
    controls.push({
      control_id: 'ctrl:adam_dam_not_etymology',
      kind: 'orthographic_false_positive_warning',
      title: 'Orthographic false-etymology guard: אָדָם (adam) vs דָּם (dam)',
      explanation: 'While אָדָם (ʾ-d-m) orthographically contains the letters ד-ם (d-m, blood), STEPBible/BDB treat them as distinct lexical entries with NO proven common historical root. Contrast this weak spelling overlap with the explicit Hebrew wordplay אָדָם ↔ אֲדָמָה (ground) in Gen 2:7.',
    });
  }
  if (queryTermSet.has('eye') || queryTermSet.has('eyes') || queryTermSet.has('ayin') || queryTermSet.has('well')) {
    controls.push({
      control_id: 'ctrl:homograph_ayin_or_well',
      kind: 'homograph_disambiguation',
      title: 'Homograph & type-scene control: עַיִן (eye vs spring) and well narratives (Gen 21:19)',
      explanation: 'Hebrew עַיִן (H5869) serves as both "eye" (Zech 4:10) and "spring/well" (Gen 24:13). Likewise, well episodes like Gen 21:19 (Hagar) are survival/covenant scenes, not betrothal type-scenes.',
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

  // Additional discovered orthography warnings from shards
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
        label: motifsData.motifs[mId]?.label || mId,
        summary: `Verified original-language motif occurrences across ${motifsData.motifs[mId]?.total_verses || 0} verses.`,
        passage_count: motifsData.motifs[mId]?.total_verses || 0,
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
      exhaustive: !hasMore && budget.used < budget.max,
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
      ],
    },
  };
}

export async function getConnectionEvidence(
  reader: AssetReader,
  evidenceId: string,
  releaseId: string = DEFAULT_R10_RELEASE
): Promise<ConnectionEvidenceResult> {
  const budget = { used: 0, max: MAX_SUBREQUEST_BUDGET };
  const explicitData = await readR10Json(reader, releaseId, 'explicit-and-typology.json.gz', budget) as { records: any[] } | null;
  let record: R10EvidenceRecord | null = (explicitData?.records || []).find((r: any) => r.evidence_id === evidenceId) || null;

  // Support synthesized evidence IDs (motifpair or number entities)
  if (!record && evidenceId.startsWith('r10:synth:motifpair:')) {
    const parts = evidenceId.split(':');
    const a = parts[3], b = parts[4];
    const motifsData = await readR10Json(reader, releaseId, 'motifs-and-patterns.json.gz', budget) as any;
    const pair = motifsData?.motif_pairs?.[`${a}|${b}`];
    if (pair) {
      const mA = motifsData.motifs[a], mB = motifsData.motifs[b];
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
    const numbersData = await readR10Json(reader, releaseId, 'numbers-index.json.gz', budget) as any;
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
    return { schema_version: 1, status: 'not_found', release_id: releaseId, evidence: null, passage_details: [] };
  }

  const targetStrongs = new Set((record.original_words || []).map(w => w.strongs).filter(Boolean));
  const booksNeeded = [...new Set((record.passages || []).map(p => p.book))].slice(0, MAX_EVIDENCE_BOOKS);
  const bookCache = new Map<number, any>();
  await Promise.all(booksNeeded.map(async b => {
    const pad = String(b).padStart(2, '0');
    const data = await readR10Json(reader, releaseId, `evidence-passages/book-${pad}.json.gz`, budget);
    if (data?.verses) bookCache.set(b, data.verses);
  }));

  const passageDetails = (record.passages || []).slice(0, 6).map(p => {
    const bVerses = bookCache.get(p.book);
    const vData = bVerses?.[String(p.verse_id)] || Object.values(bVerses || {}).find((v: any) => v.chapter === p.chapter && v.verse === p.verse);
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
      passage: p,
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
  const seedQuery = nodeId
    .replace(/^(motif:|lemma:|passage:|event:|concept:|number:)/, '')
    .replace(/_/g, ' ');
  const discovery = await discoverBiblicalConnections(reader, {
    query: seedQuery,
    limit: options.limit ?? 8,
    cursor: options.cursor ?? null,
    release_id: releaseId,
  }, releaseId);

  const centerNode: R10Node = {
    id: nodeId,
    kind: nodeId.startsWith('motif:') ? 'motif' : nodeId.startsWith('lemma:') ? 'lemma' : nodeId.startsWith('passage:') ? 'passage' : 'concept',
    label: seedQuery,
    epistemic_class: 'direct_textual_evidence',
    grounding_source: 'R10 index expansion',
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
