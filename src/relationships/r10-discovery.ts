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

function normalizeNumberPhrases(text: string): string {
  const words = Object.keys(SMALL_NUMBERS).join('|');
  return text.replace(new RegExp(`\\b(?:${words}|hundred|thousand)(?:(?:[ -]+)(?:${words}|hundred|thousand))*\\b`, 'gi'), phrase => {
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
  budget: { used: number; max: number; missing?: string[] }
): Promise<T | null> {
  if (budget.used >= budget.max) return null;
  budget.used++;
  const fullPath = `/v2/relationships/${releaseId}/r10/${relPath}`;
  const res = await reader.readJson(fullPath);
  if (!res) budget.missing?.push(fullPath);
  // Legacy window-based copula extraction cannot establish identity: relative
  // clauses may describe location, possession, marriage, or numerical attributes.
  // Quarantine the entire unverified family, including evidence-by-ID access.
  if (relPath === 'explicit-and-typology.json.gz' && res?.data) {
    const data = res.data as { records?: Array<{ evidence_id?: string }> };
    return { ...data, records: (data.records || []).filter(r => !r.evidence_id?.startsWith('r10:ident:auto:')) } as T;
  }
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
  }>;
  lexical_relations: any[];
  lxx_relations: any[];
  homograph_siblings: Array<{ bs: string; lk?: string; sc: string; tr: string; gl: string }>;
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

export async function discoverBiblicalConnections(
  reader: AssetReader,
  query: DiscoverConnectionsQuery,
  releaseId: string = query.release_id || DEFAULT_R10_RELEASE
): Promise<DiscoverConnectionsResult> {
  const tStart = Date.now();
  const budget = { used: 0, max: MAX_SUBREQUEST_BUDGET, missing: [] as string[] };
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

  const parsedRefs = parsePassageReferences(query.query || '', conceptIdx.book_names || []);
  let lexicalQuery = query.query || '';
  for (const ref of parsedRefs) lexicalQuery = lexicalQuery.replace(ref.refText, ' ');
  const extractedTerms = tokenizeTerms({ ...query, query: lexicalQuery });
  const explicitPassages: R10PassageRef[] = parsedRefs.map(pr => {
    const bk = conceptIdx.book_names.find(b => b.id === pr.book);
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
  const bookCache = new Map<number, any>();
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

  async function hydratePassageByVid(vid: number): Promise<R10PassageRef | null> {
    const book = bookForVid(vid);
    const verses = await loadBookData(book);
    const v = verses?.[String(vid)];
    if (!v) {
      const bkName = conceptIdx?.book_names?.find(b => b.id === book)?.name || `Book ${book}`;
      return {
        verse_id: vid,
        ref: `${bkName} (vid ${vid})`,
        book,
        chapter: 1,
        verse: 1,
        testament: book <= 39 ? 'OT' : 'NT',
      };
    }
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



  const refTokensToIgnore = new Set<string>();
  for (const pr of parsedRefs) {
    refTokensToIgnore.add(String(pr.chapter));
    if (pr.verse !== null && pr.verse !== undefined) refTokensToIgnore.add(String(pr.verse));
    if (pr.endVerse) refTokensToIgnore.add(String(pr.endVerse));
    const bk = conceptIdx.book_names.find(b => b.id === pr.book);
    if (bk) {
      refTokensToIgnore.add(bk.name.toLowerCase());
      refTokensToIgnore.add(bk.usfm.toLowerCase());
      refTokensToIgnore.add(bk.name.toLowerCase().replace(/s$/, ''));
    }
  }

  // Hydrate explicit passage references
  for (const ep of explicitPassages) {
    const verses = await loadBookData(ep.book);
    if (verses) {
      for (const [vKey, vVal] of Object.entries(verses) as [string, any][]) {
        if (vVal.chapter === ep.chapter && vVal.verse === ep.verse) {
          ep.verse_id = Number(vKey);
          ep.snippet = vVal.en;
          ep.mt_ref = vVal.mt_ref;
          for (const t of vVal.toks || []) {
            if (t.s && !['H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588'].includes(t.s)) {
              matchedStrongs.add(t.s);
            }
          }
          break;
        }
      }
    }
  }

  // Sharded lemma-lookup loader with caching
  const shardMemo = new Map<string, Map<string, any[]>>();
  async function fetchShard(key: string): Promise<any[]> {
    const normKey = key.toLowerCase();
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
      if (sing && sing !== rawKey) {
        hits = await fetchShard(sing);
      }
    }
    return hits;
  }

  const isExplicitProperQuery = /\b(susa|shushan|persia|palace|citadel|city|capital|person|place)\b/i.test(query.query || '');

  // Stage 1: Resolve concepts via aliases + sharded lemma-lookup
  for (const term of extractedTerms) {
    if (/^\d+$/.test(term) && refTokensToIgnore.has(term) && !NUMBER_WORDS[term]) continue;
    const lower = term.toLowerCase();
    const alias = conceptIdx.aliases[lower];
    const numVal = /^\d+$/.test(lower) ? Number(lower) : (NUMBER_WORDS[lower] ?? SMALL_NUMBERS[lower]);
    const evHits = (motifsData.events || []).filter(e =>
      e.keywords?.includes(lower) && (lower.length >= 4 || ['red', 'sea'].includes(lower))
    ).slice(0, 4);

    const shardHits = (await lookupShardToken(term)).sort((a, b) =>
      Number(b.cnt > 0) - Number(a.cnt > 0) ||
      Number(normalizeToken(b.gl || '') === lower) - Number(normalizeToken(a.gl || '') === lower) ||
      b.match_rank - a.match_rank || b.cnt - a.cnt);

    // Proper-Name vs Common-Noun Guard:
    // If English concept matches both common nouns (!h.is_prop) and proper places/persons (h.is_prop),
    // keep non-proper entries as primary resolved lemmas unless query explicitly names a proper place/person.
    const nonPropShard = shardHits.filter(h => !h.is_prop);
    const propShard = shardHits.filter(h => h.is_prop);
    let primaryShardHits = shardHits;
    const excludedProper: any[] = [];
    if (nonPropShard.length > 0 && !isExplicitProperQuery) {
      primaryShardHits = nonPropShard;
      excludedProper.push(...propShard);
    }

    if (alias || primaryShardHits.length > 0 || numVal !== undefined || evHits.length > 0) {
      const lemmas: R10OriginalWordRef[] = [];
      const nodes: R10Node[] = [];
      const homographSiblings: Array<{ bs: string; lk?: string; sc: string; tr: string; gl: string }> = [];

      // Add primary shard hits first
      for (const h of primaryShardHits.slice(0, 5)) {
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
        homograph_siblings: homographSiblings.length > 0 ? homographSiblings : undefined,
        ambiguity_note: alias?.note || (primaryShardHits.length > 3 ? `Multiple original-language candidates (${primaryShardHits.slice(0, 3).map(h => h.sc).join(', ')}...)` : undefined),
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
  const profileStrongsToLoad = [...new Set([...prioritized, ...matchedStrongs])].slice(0, 6);
  const profileBuckets = new Map<string, string[]>();
  for (const bs of profileStrongsToLoad) {
    const bHex = computeBucketHex('fnv1a64_mod64', 64, bs);
    if (!profileBuckets.has(bHex)) profileBuckets.set(bHex, []);
    profileBuckets.get(bHex)!.push(bs);
  }

  const profileShardMemo = new Map<string, Record<string, LemmaProfile>>();
  await Promise.all(
    [...profileBuckets.keys()].map(async bHex => {
      const shard = await readR10Json<{ entries?: Record<string, LemmaProfile> }>(
        reader, releaseId, `lemma-profiles/shard-${bHex}.json.gz`, budget
      );
      if (shard?.entries) {
        profileShardMemo.set(bHex, shard.entries);
      }
    })
  );

  const loadedProfiles: LemmaProfile[] = [];
  const profileByStrongs = new Map<string, LemmaProfile>();
  for (const bs of profileStrongsToLoad) {
    const bHex = computeBucketHex('fnv1a64_mod64', 64, bs);
    const prof = profileShardMemo.get(bHex)?.[bs];
    if (prof) {
      loadedProfiles.push(prof);
      profileByStrongs.set(bs, prof);
    }
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
      const finalScore = Math.max(10, baseScore + specificityBonus + witnessBonus - hubPenalty);

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

    // B. Direct Grammatical Relations
    const nonFuncGram = (prof.grammatical_relations || []).filter(gr =>
      gr.occurrences >= 1 && !['H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588'].includes(gr.related_strongs)
    ).slice(0, 5);

    for (const gr of nonFuncGram) {
      const gTier: R10EvidenceTier = gr.occurrences >= 2 ? 2 : 3;
      const gBase = TIER_BASE_SCORE[gTier];
      const gSpec = idfBonus + 25;
      const gWit = Math.min(40, gr.occurrences * 8);
      allCandidates.push({
        evidence_id: `r11:gram:${prof.bs}:${gr.predicate}:${gr.related_strongs}`,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: gTier,
        epistemic_class: 'direct_textual_evidence',
        title: `${gr.display_label}: ${prof.sc} (${prof.tr}) ↔ ${gr.related_script} ("${gr.related_gloss}", ${gr.occurrences}×)`,
        summary: `Syntactic dependency analysis identifies direct grammatical connection (${gr.display_label}) between ${prof.sc} (${prof.bs}) and ${gr.related_script} (${gr.related_strongs}, "${gr.related_gloss}") across ${gr.occurrences} occurrences.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${gr.related_strongs}`,
        passages: prof.clusters?.[0]?.sample_passages?.slice(0, 3).map(p => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        })) || [],
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
          { strongs: gr.related_strongs, language: prof.lang, lemma_script: gr.related_script, transliteration: '', gloss: gr.related_gloss },
        ],
        matched_terms: [prof.gl, gr.related_gloss, prof.bs, gr.related_strongs],
        limitations: ['Syntactic construct/argument relation; contextual meaning varies by passage.'],
        provenance: {
          source_dataset: 'MACULA Hebrew/Greek Syntactic Trees',
          source_record_ids: [prof.bs, gr.related_strongs],
          license: 'CC BY 4.0',
          derivation_method: 'syntactic_dependency_relation',
        },
        score_components: {
          base_tier_score: gBase,
          specificity_bonus: gSpec,
          witness_bonus: gWit,
          common_word_penalty: hubPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, gBase + gSpec + gWit - hubPenalty),
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
          specificity_bonus: idfBonus + 20,
          witness_bonus: Math.min(30, (rel.count || 1) * 5),
          common_word_penalty: hubPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, TIER_BASE_SCORE[3] + idfBonus + 20 + Math.min(30, (rel.count || 1) * 5) - hubPenalty),
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
          specificity_bonus: idfBonus + 15,
          witness_bonus: 20,
          common_word_penalty: hubPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, TIER_BASE_SCORE[3] + idfBonus + 15 + 20 - hubPenalty),
        },
      });
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

        // 1. Same-verse intersections
        if (sharedVids.length > 0) {
          for (const vid of sharedVids.slice(0, 6)) {
            const p = await hydratePassageByVid(vid);
            if (!p) continue;
            const pA = gA.profiles.find(p => p.all_vids.includes(vid))!;
            const pB = gB.profiles.find(p => p.all_vids.includes(vid))!;
            const evId = `r11:intersect:verse:${pA.bs}:${pB.bs}:${vid}`;
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
                specificity_bonus: 180,
                witness_bonus: Math.min(50, sharedVids.length * 6),
                common_word_penalty: 0,
                number_coincidence_penalty: 0,
                orthographic_penalty: 0,
                final_score: TIER_BASE_SCORE[2] + 180 + Math.min(50, sharedVids.length * 6),
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
              pericopePairs.push([vA, vB]);
              if (pericopePairs.length >= 3) break;
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

  // Dynamic Number Entity checks
  if (matchedNumbers.size > 0 && numbersData?.by_value) {
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

  // Dynamic Orthographic shard lookup
  const hebStrongs = [...matchedStrongs].filter(s => s.startsWith('H')).slice(0, 3);
  const orthDetails: any[] = [];
  for (const hs of hebStrongs) {
    const bHex = computeBucketHex('fnv1a64_mod64', 64, hs);
    const orthShard = await readR10Json<{ entries?: Record<string, any> }>(reader, releaseId, `orthographic/shard-${bHex}.json.gz`, budget);
    const entry = orthShard?.entries?.[hs];
    if (entry) orthDetails.push(entry);
  }

  // Filter and rank candidates
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
  const rankedAll = [...uniqueMap.values()];

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
  const hasMoreOcc = occOffset + occLimit < targetVids.length;

  const hydratedOccPassages: R10PassageRef[] = [];
  for (const vid of pagedOccVids) {
    const p = await hydratePassageByVid(vid);
    if (p) hydratedOccPassages.push(p);
  }

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

  // Construct Connection Paths from top evidence records
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
      next_cursor: hasMoreOcc ? String(occOffset + occLimit) : null,
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
      // Exhausting bounded generated candidates is not exhaustive corpus discovery.
      exhaustive: false,
      scope: 'Bounded candidate discovery over selected lemma profiles; occurrence pagination is complete only for its selected lemma and source editions.',
      resolution_state: resolvedConcepts.length || explicitPassages.length ? 'known_concept' : 'unknown_concept',
      occurrence_state: loadedProfiles.some(p => p.total_verses > 0) || explicitPassages.some(p => p.verse_id > 0) ? 'direct_occurrences_found' : 'no_indexed_occurrences',
      connection_state: totalAvailable ? 'connections_found' : 'no_higher_order_connections',
      completeness_state: budget.used >= budget.max ? 'resource_limits_reached' : budget.missing.length ? 'missing_source_coverage' : 'search_incomplete',
      missing_assets: budget.missing,
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
    iterative_analysis: iterativeAnalysis,
  };
}

export async function getConnectionEvidence(
  reader: AssetReader,
  evidenceId: string,
  releaseId: string = DEFAULT_R10_RELEASE
): Promise<ConnectionEvidenceResult> {
  const budget = { used: 0, max: MAX_SUBREQUEST_BUDGET };
  let record: R10EvidenceRecord | null = null;
  const targetStrongs = new Set<string>();

  const bookCache = new Map<number, any>();
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

  async function hydratePassageByVid(vid: number): Promise<R10PassageRef | null> {
    const book = bookForVid(vid);
    const verses = await loadBookData(book);
    const v = verses?.[String(vid)];
    if (!v) {
      return {
        verse_id: vid,
        ref: `Verse ${vid}`,
        book,
        chapter: 1,
        verse: 1,
        testament: book <= 39 ? 'OT' : 'NT',
      };
    }
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

  // Handle R11 synthesized dynamic evidence IDs
  if (evidenceId.startsWith('r11:cluster:')) {
    const clId = evidenceId.replace('r11:cluster:', '');
    const bs = clId.split(':')[0];
    targetStrongs.add(bs);
    const bHex = computeBucketHex('fnv1a64_mod64', 64, bs);
    const shard = await readR10Json<{ entries?: Record<string, LemmaProfile> }>(
      reader, releaseId, `lemma-profiles/shard-${bHex}.json.gz`, budget
    );
    const prof = shard?.entries?.[bs];
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
    const bHex = computeBucketHex('fnv1a64_mod64', 64, bs);
    const shard = await readR10Json<{ entries?: Record<string, LemmaProfile> }>(
      reader, releaseId, `lemma-profiles/shard-${bHex}.json.gz`, budget
    );
    const prof = shard?.entries?.[bs];
    const gr = prof?.grammatical_relations?.find((g: any) => g.predicate === pred && g.related_strongs === relStrongs);
    if (prof && gr) {
      const gTier: R10EvidenceTier = gr.occurrences >= 2 ? 2 : 3;
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: gTier,
        epistemic_class: 'direct_textual_evidence',
        title: `${gr.display_label}: ${prof.sc} (${prof.tr}) ↔ ${gr.related_script} ("${gr.related_gloss}", ${gr.occurrences}×)`,
        summary: `Syntactic dependency analysis identifies direct grammatical connection (${gr.display_label}) between ${prof.sc} (${prof.bs}) and ${gr.related_script} (${gr.related_strongs}, "${gr.related_gloss}") across ${gr.occurrences} occurrences.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${gr.related_strongs}`,
        passages: prof.clusters?.[0]?.sample_passages?.slice(0, 3).map((p: any) => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        })) || [],
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
          { strongs: gr.related_strongs, language: prof.lang, lemma_script: gr.related_script, transliteration: '', gloss: gr.related_gloss },
        ],
        matched_terms: [prof.gl, gr.related_gloss, prof.bs, gr.related_strongs],
        limitations: ['Syntactic construct/argument relation; contextual meaning varies by passage.'],
        provenance: {
          source_dataset: 'MACULA Hebrew/Greek Syntactic Trees',
          source_record_ids: [prof.bs, gr.related_strongs],
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
    const bHex = computeBucketHex('fnv1a64_mod64', 64, bs);
    const shard = await readR10Json<{ entries?: Record<string, LemmaProfile> }>(
      reader, releaseId, `lemma-profiles/shard-${bHex}.json.gz`, budget
    );
    const prof = shard?.entries?.[bs];
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
  } else if (evidenceId.startsWith('r11:lxx:')) {
    const [, , bs, idxStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const bHex = computeBucketHex('fnv1a64_mod64', 64, bs);
    const shard = await readR10Json<{ entries?: Record<string, LemmaProfile> }>(
      reader, releaseId, `lemma-profiles/shard-${bHex}.json.gz`, budget
    );
    const prof = shard?.entries?.[bs];
    const rel = prof?.lxx_relations?.[Number(idxStr)];
    if (prof && rel) {
      if (rel.target_strongs) targetStrongs.add(rel.target_strongs);
      record = {
        evidence_id: evidenceId,
        predicate: 'cross_language_bridge',
        evidence_tier: 3,
        epistemic_class: 'documented_lexical_relationship',
        title: rel.type === 'lxx_heading_witness' ? `Septuagint superscription witness for ${rel.ref}: ${prof.sc}` : `Septuagint (LXX) bridge: ${prof.sc} (${prof.bs}) → ${rel.script || ''} (${rel.target_strongs || ''})`,
        summary: rel.type === 'lxx_heading_witness' ? `In ${rel.ref}, the Septuagint renders the Hebrew title containing ${prof.sc} as: "${rel.lxx_text}".` : `Septuagint translates Hebrew ${prof.sc} as Greek ${rel.script} across ${rel.count || 1} passages.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: rel.target_strongs ? `lemma:${rel.target_strongs}` : `concept:lxx:${prof.bs}`,
        passages: [],
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
    const p1 = await hydratePassageByVid(fVid);
    const p2 = await hydratePassageByVid(tVid);
    if (p1 && p2) {
      record = {
        evidence_id: evidenceId,
        predicate: 'cross_reference_witness',
        evidence_tier: 4,
        epistemic_class: 'verified_cross_reference',
        title: `Cross-reference witness: ${p1.ref} → ${p2.ref}`,
        summary: `Canonical cross-reference connects ${p1.ref} and ${p2.ref}.`,
        source_node_id: `passage:${p1.ref}`,
        target_node_id: `passage:${p2.ref}`,
        passages: [p1, p2],
        original_words: [],
        matched_terms: [p1.ref, p2.ref],
        limitations: ['Cross-reference witness documents ancient editorial or intertextual connection.'],
        provenance: {
          source_dataset: 'CrossReferences.org / OpenBible',
          source_record_ids: [p1.ref, p2.ref],
          license: 'CC BY 4.0',
          derivation_method: 'canonical_cross_reference_graph',
        },
        score_components: {
          base_tier_score: 650,
          specificity_bonus: 40,
          witness_bonus: 20,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: 710,
        },
      };
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
    const motifsData = await readR10Json<{ motif_pairs?: Record<string, any>; motifs?: Record<string, any> }>(
      reader, releaseId, 'motifs-and-patterns.json.gz', budget
    );
    const pair = motifsData?.motif_pairs?.[`${a}|${b}`];
    if (pair) {
      const mA = motifsData.motifs?.[a], mB = motifsData.motifs?.[b];
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
    return { schema_version: 1, status: 'not_found', release_id: releaseId, evidence: null, passage_details: [] };
  }

  for (const ow of record.original_words || []) {
    if (ow.strongs) targetStrongs.add(ow.strongs);
  }

  const booksNeeded = [...new Set((record.passages || []).map(p => p.book).filter(b => b > 0))].slice(0, MAX_EVIDENCE_BOOKS);
  await Promise.all(booksNeeded.map(async b => {
    await loadBookData(b);
  }));

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
