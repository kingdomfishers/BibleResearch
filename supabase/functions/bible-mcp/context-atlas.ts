// @file: supabase/functions/bible-mcp/context-atlas.ts
// Pure Web/Deno TypeScript module: epistemic-honest MCP Context Atlas queries
// for genealogy, Table of Nations / tribes, sacred architecture, biblical feasts,
// and corpus-backed places. Zero Node-only imports; explicit .ts extensions.

import { bookName, parsePassageString, type PassageSpan } from './bible-ref.ts';

// === @section:config-and-cache ===
const DEFAULT_CORPUS_BASE_URL = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const FETCH_TIMEOUT_MS = 8000;
const FAILURE_RETRY_MS = 5 * 60 * 1000;

export function getCorpusBaseUrl(override?: string): string {
  if (override && override.trim()) {
    return override.trim().replace(/\/+$/, '');
  }
  try {
    const denoObj = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno;
    const envUrl = denoObj?.env?.get?.('CORPUS_BASE_URL');
    if (envUrl && envUrl.trim()) {
      return envUrl.trim().replace(/\/+$/, '');
    }
  } catch {
    // Ignore when env access is restricted.
  }
  return DEFAULT_CORPUS_BASE_URL;
}

interface CacheEntry<T> {
  data: T | null;
  failedAt: number;
  inFlight: Promise<T | null> | null;
}

function createShardCache<T>(): Map<string, CacheEntry<T>> {
  return new Map<string, CacheEntry<T>>();
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function loadCachedShard<T>(
  cache: Map<string, CacheEntry<T>>,
  baseUrl: string,
  path: string,
): Promise<T | null> {
  const key = `${baseUrl}${path}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: null, failedAt: 0, inFlight: null };
    cache.set(key, entry);
  }
  if (entry.data !== null) return entry.data;
  if (entry.failedAt > 0 && Date.now() - entry.failedAt < FAILURE_RETRY_MS) {
    return null;
  }
  if (entry.inFlight) return entry.inFlight;

  entry.inFlight = fetchJsonWithTimeout<T>(key)
    .then((parsed) => {
      if (parsed !== null) {
        entry!.data = parsed;
        entry!.failedAt = 0;
      } else {
        entry!.failedAt = Date.now();
      }
      entry!.inFlight = null;
      return entry!.data;
    })
    .catch(() => {
      entry!.failedAt = Date.now();
      entry!.inFlight = null;
      return null;
    });

  return entry.inFlight;
}

export function normalizeStrongsCode(code?: string | null): string {
  if (!code) return '';
  const m = /^([HG])0*(\d+)([A-Z]?)$/i.exec(code.trim());
  if (!m) return code.trim().toUpperCase();
  return `${m[1].toUpperCase()}${Number(m[2])}${m[3].toUpperCase()}`;
}

function parseSimpleRef(book: number, chapter: number, verse: number): { label: string; passage: { book: number; chapter: number; verse: number } } {
  const bName = bookName(book) ?? `Book ${book}`;
  return {
    label: `${bName} ${chapter}:${verse}`,
    passage: { book, chapter, verse },
  };
}

function passageSpansMatchRef(
  spans: PassageSpan[],
  ref: { book: number; chapter: number; verse: number },
): number {
  let best = 0;
  for (const s of spans) {
    if (s.book !== ref.book) continue;
    if (s.chapter === ref.chapter) {
      if (ref.verse >= s.start_verse && ref.verse <= s.end_verse) {
        return 100;
      }
      best = Math.max(best, 30);
    } else {
      best = Math.max(best, 10);
    }
  }
  return best;
}

// === @section:genealogy ===
export type RelationshipKind =
  | 'father'
  | 'mother'
  | 'spouse'
  | 'sibling'
  | 'mentor_disciple'
  | 'covenant_friend'
  | 'successor'
  | 'adversary';

interface AtlasPersonRef {
  label: string;
  passage: { book: number; chapter: number; verse: number };
}

interface AtlasPerson {
  id: string;
  name: string;
  disambiguator?: string;
  hebrew?: string;
  greek?: string;
  transliteration?: string;
  strongs?: string[];
  sex?: string;
  tribe?: string;
  era?: string;
  lineageGroup?: string;
  summary: string;
  keyRefs: AtlasPersonRef[];
  homonymGroup?: string;
  competingGenealogyNote?: string;
}

interface AtlasRelationship {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipKind;
  category?: 'explicit' | 'inferred';
  typeLabel?: string;
  witnessRef: AtlasPersonRef;
  note?: string;
  competingModel?: string;
}

interface PeopleGraphShard {
  people?: AtlasPerson[];
  relationships?: AtlasRelationship[];
}

type PersonVersesShard =
  | { byPerson?: Record<string, string[]>; byVerse?: Record<string, string[]> }
  | Record<string, string[]>;

const TABLE_OF_NATIONS_NOTE =
  'Genesis 10 frames peoples and eponyms in a kinship/household idiom (father/son/brother); textual eponym chains must not be equated directly with modern genetic ancestry or fixed nation-state borders.';

const GOSPEL_GENEALOGY_NOTE =
  'Matthew 1 traces Joseph\'s Davidic royal/legal line through Solomon (with Jeconiah), whereas Luke 3:23-31 traces a distinct line through Nathan ("as was supposed, the son of Joseph, the son of Eli"). Scholarly proposals include levirate marriage (Africanus) or a maternal/legal line through Mary (post-Reformation harmonization), neither explicitly stated in the text.';

const CORE_PEOPLE: readonly AtlasPerson[] = [
  { id: 'adam', name: 'Adam', hebrew: 'אָדָם', transliteration: 'Adam', strongs: ['H120', 'H121', 'G76'], sex: 'male', era: 'Primeval', lineageGroup: 'creation_nations', summary: 'First human; husband of Eve and father of Cain, Abel, and Seth.', keyRefs: [parseSimpleRef(1, 2, 7), parseSimpleRef(1, 5, 1), parseSimpleRef(42, 3, 38)] },
  { id: 'eve', name: 'Eve', hebrew: 'חַוָּה', transliteration: 'Chawwah', strongs: ['H2332', 'G2096'], sex: 'female', era: 'Primeval', lineageGroup: 'creation_nations', summary: 'First woman, wife of Adam and mother of Cain, Abel, and Seth.', keyRefs: [parseSimpleRef(1, 3, 20), parseSimpleRef(1, 4, 1)] },
  { id: 'cain', name: 'Cain', hebrew: 'קַיִן', strongs: ['H7014'], sex: 'male', era: 'Primeval', lineageGroup: 'creation_nations', summary: 'Firstborn son of Adam and Eve.', keyRefs: [parseSimpleRef(1, 4, 1)] },
  { id: 'abel', name: 'Abel', hebrew: 'הֶבֶל', strongs: ['H1893'], sex: 'male', era: 'Primeval', lineageGroup: 'creation_nations', summary: 'Second son of Adam and Eve.', keyRefs: [parseSimpleRef(1, 4, 2)] },
  { id: 'seth', name: 'Seth', hebrew: 'שֵׁת', strongs: ['H8352'], sex: 'male', era: 'Primeval', lineageGroup: 'creation_nations', summary: 'Son of Adam and Eve in the line to Noah.', keyRefs: [parseSimpleRef(1, 4, 25), parseSimpleRef(1, 5, 3)] },
  { id: 'noah', name: 'Noah', hebrew: 'נֹחַ', strongs: ['H5146', 'G3575'], sex: 'male', era: 'Primeval / Flood', lineageGroup: 'creation_nations', summary: 'Righteous builder of the ark; father of Shem, Ham, and Japheth.', keyRefs: [parseSimpleRef(1, 5, 29), parseSimpleRef(1, 6, 9), parseSimpleRef(1, 9, 18)] },
  { id: 'shem', name: 'Shem', hebrew: 'שֵׁם', strongs: ['H8035', 'G4590'], sex: 'male', era: 'Post-Flood', lineageGroup: 'creation_nations', summary: 'Son of Noah; ancestor of Arpachshad, Eber, Elam, Asshur, and Aram.', keyRefs: [parseSimpleRef(1, 10, 21), parseSimpleRef(1, 11, 10)], competingGenealogyNote: TABLE_OF_NATIONS_NOTE },
  { id: 'ham', name: 'Ham', hebrew: 'חָם', strongs: ['H2526'], sex: 'male', era: 'Post-Flood', lineageGroup: 'creation_nations', summary: 'Son of Noah; father of Cush, Mizraim, Put, and Canaan.', keyRefs: [parseSimpleRef(1, 10, 6)], competingGenealogyNote: TABLE_OF_NATIONS_NOTE },
  { id: 'japheth', name: 'Japheth', hebrew: 'יֶפֶת', strongs: ['H3315'], sex: 'male', era: 'Post-Flood', lineageGroup: 'creation_nations', summary: 'Son of Noah; father of Gomer, Magog, Madai, Javan, Tubal, Meshech, and Tiras.', keyRefs: [parseSimpleRef(1, 10, 2)], competingGenealogyNote: TABLE_OF_NATIONS_NOTE },
  { id: 'canaan', name: 'Canaan', hebrew: 'כְּנַעַן', strongs: ['H3667'], sex: 'male', era: 'Table of Nations', lineageGroup: 'creation_nations', summary: 'Son of Ham; eponymous ancestor of Sidon, Heth, Jebusites, Amorites, Girgashites, and Hivites.', keyRefs: [parseSimpleRef(1, 10, 15), parseSimpleRef(1, 10, 16)], competingGenealogyNote: TABLE_OF_NATIONS_NOTE },
  { id: 'amor', name: 'Amor (Amorites eponym)', hebrew: 'אֱמֹרִי', strongs: ['H567'], era: 'Table of Nations', lineageGroup: 'creation_nations', summary: 'Eponymous Canaanite lineage ("the Amorite") listed as descended from Canaan son of Ham in Gen 10:16.', keyRefs: [parseSimpleRef(1, 10, 16), parseSimpleRef(1, 15, 16)], competingGenealogyNote: TABLE_OF_NATIONS_NOTE },
  { id: 'eber', name: 'Eber', hebrew: 'עֵבֶר', strongs: ['H5677'], sex: 'male', era: 'Table of Nations', lineageGroup: 'creation_nations', summary: 'Descendant of Shem via Arpachshad and Shelah; eponym linked with the Hebrews.', keyRefs: [parseSimpleRef(1, 10, 24), parseSimpleRef(1, 11, 14)] },
  { id: 'terah', name: 'Terah', hebrew: 'תֶּרַח', strongs: ['H8646'], sex: 'male', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Father of Abram (Abraham), Nahor, and Haran; migrated from Ur to Haran.', keyRefs: [parseSimpleRef(1, 11, 27), parseSimpleRef(1, 11, 31)] },
  { id: 'abraham', name: 'Abraham (Abram)', hebrew: 'אַבְרָהָם', greek: 'Ἀβραάμ', strongs: ['H85', 'H87', 'G11'], sex: 'male', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Covenant patriarch; husband of Sarah and father of Ishmael and Isaac.', keyRefs: [parseSimpleRef(1, 12, 1), parseSimpleRef(1, 17, 5), parseSimpleRef(1, 21, 3), parseSimpleRef(40, 1, 2)] },
  { id: 'sarah', name: 'Sarah (Sarai)', hebrew: 'שָׂרָה', strongs: ['H8283', 'H8297', 'G4564'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Wife of Abraham and mother of Isaac.', keyRefs: [parseSimpleRef(1, 17, 15), parseSimpleRef(1, 21, 2)] },
  { id: 'hagar', name: 'Hagar', hebrew: 'הָגָר', strongs: ['H1904'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Egyptian maidservant of Sarah; mother of Ishmael by Abraham.', keyRefs: [parseSimpleRef(1, 16, 15)] },
  { id: 'ishmael', name: 'Ishmael', hebrew: 'יִשְׁמָעֵאל', strongs: ['H3458'], sex: 'male', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Firstborn son of Abraham and Hagar.', keyRefs: [parseSimpleRef(1, 16, 15), parseSimpleRef(1, 25, 12)] },
  { id: 'isaac', name: 'Isaac', hebrew: 'יִצְחָק', greek: 'Ἰσαάκ', strongs: ['H3327', 'G2464'], sex: 'male', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Son of Abraham and Sarah; husband of Rebekah and father of Esau and Jacob.', keyRefs: [parseSimpleRef(1, 21, 3), parseSimpleRef(1, 25, 26)] },
  { id: 'rebekah', name: 'Rebekah', hebrew: 'רִבְקָה', strongs: ['H7259', 'G4479'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Wife of Isaac and mother of Esau and Jacob.', keyRefs: [parseSimpleRef(1, 24, 67), parseSimpleRef(1, 25, 21)] },
  { id: 'esau', name: 'Esau (Edom)', hebrew: 'עֵשָׂו', strongs: ['H6215', 'G2269'], sex: 'male', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Firstborn twin of Isaac and Rebekah; ancestor of Edom.', keyRefs: [parseSimpleRef(1, 25, 25), parseSimpleRef(1, 36, 1)] },
  { id: 'jacob', name: 'Jacob (Israel)', hebrew: 'יַעֲקֹב / יִשְׂרָאֵל', greek: 'Ἰακώβ', strongs: ['H3290', 'H3478', 'G2384'], sex: 'male', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Son of Isaac and Rebekah; renamed Israel; father of twelve sons and Dinah.', keyRefs: [parseSimpleRef(1, 25, 26), parseSimpleRef(1, 32, 28), parseSimpleRef(1, 35, 22)] },
  { id: 'leah', name: 'Leah', hebrew: 'לֵאָה', strongs: ['H3812'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'First wife of Jacob; mother of Reuben, Simeon, Levi, Judah, Issachar, Zebulun, and Dinah.', keyRefs: [parseSimpleRef(1, 29, 23), parseSimpleRef(1, 35, 23)] },
  { id: 'rachel', name: 'Rachel', hebrew: 'רָחֵל', strongs: ['H7354', 'G4478'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Wife of Jacob; mother of Joseph and Benjamin.', keyRefs: [parseSimpleRef(1, 29, 28), parseSimpleRef(1, 30, 24), parseSimpleRef(1, 35, 18)] },
  { id: 'bilhah', name: 'Bilhah', hebrew: 'בִּלְהָה', strongs: ['H1090'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Maidservant of Rachel; mother of Dan and Naphtali.', keyRefs: [parseSimpleRef(1, 30, 4), parseSimpleRef(1, 35, 25)] },
  { id: 'zilpah', name: 'Zilpah', hebrew: 'זִלְפָּה', strongs: ['H2153'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Maidservant of Leah; mother of Gad and Asher.', keyRefs: [parseSimpleRef(1, 30, 9), parseSimpleRef(1, 35, 26)] },
  { id: 'reuben', name: 'Reuben', hebrew: 'רְאוּבֵן', strongs: ['H7205'], sex: 'male', tribe: 'Reuben', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Firstborn son of Jacob and Leah.', keyRefs: [parseSimpleRef(1, 29, 32), parseSimpleRef(1, 49, 3)] },
  { id: 'simeon', name: 'Simeon', hebrew: 'שִׁמְעוֹן', strongs: ['H8095'], sex: 'male', tribe: 'Simeon', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Second son of Jacob and Leah.', keyRefs: [parseSimpleRef(1, 29, 33)] },
  { id: 'levi', name: 'Levi', hebrew: 'לֵוִי', strongs: ['H3878', 'G3017'], sex: 'male', tribe: 'Levi', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Third son of Jacob and Leah; ancestor of the Levitical priesthood (Moses and Aaron).', keyRefs: [parseSimpleRef(1, 29, 34), parseSimpleRef(2, 6, 16)] },
  { id: 'judah', name: 'Judah', hebrew: 'יְהוּדָה', greek: 'Ἰούδας', strongs: ['H3063', 'G2455'], sex: 'male', tribe: 'Judah', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Fourth son of Jacob and Leah; ancestor of Perez, David, and Jesus.', keyRefs: [parseSimpleRef(1, 29, 35), parseSimpleRef(1, 38, 29), parseSimpleRef(1, 49, 10), parseSimpleRef(40, 1, 2)] },
  { id: 'dan', name: 'Dan', hebrew: 'דָּן', strongs: ['H1835'], sex: 'male', tribe: 'Dan', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Fifth son of Jacob (by Bilhah).', keyRefs: [parseSimpleRef(1, 30, 6)] },
  { id: 'naphtali', name: 'Naphtali', hebrew: 'נַפְתָּלִי', strongs: ['H5321'], sex: 'male', tribe: 'Naphtali', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Sixth son of Jacob (by Bilhah).', keyRefs: [parseSimpleRef(1, 30, 8)] },
  { id: 'gad', name: 'Gad', hebrew: 'גָּד', strongs: ['H1410'], sex: 'male', tribe: 'Gad', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Seventh son of Jacob (by Zilpah).', keyRefs: [parseSimpleRef(1, 30, 11)] },
  { id: 'asher', name: 'Asher', hebrew: 'אָשֵׁר', strongs: ['H836'], sex: 'male', tribe: 'Asher', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Eighth son of Jacob (by Zilpah).', keyRefs: [parseSimpleRef(1, 30, 13)] },
  { id: 'issachar', name: 'Issachar', hebrew: 'יִשָּׂשכָר', strongs: ['H3485'], sex: 'male', tribe: 'Issachar', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Ninth son of Jacob (fifth by Leah).', keyRefs: [parseSimpleRef(1, 30, 18)] },
  { id: 'zebulun', name: 'Zebulun', hebrew: 'זְבוּלֻן', strongs: ['H2074'], sex: 'male', tribe: 'Zebulun', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Tenth son of Jacob (sixth by Leah).', keyRefs: [parseSimpleRef(1, 30, 20)] },
  { id: 'joseph_ot', name: 'Joseph', disambiguator: 'Son of Jacob & Rachel; ruler in Egypt (Gen 30–50)', hebrew: 'יוֹסֵף', strongs: ['H3130', 'G2501'], sex: 'male', tribe: 'Joseph', era: 'Patriarchs', lineageGroup: 'patriarchs', homonymGroup: 'joseph', summary: 'Eleventh son of Jacob (first by Rachel); sold into Egypt, vizier under Pharaoh, father of Manasseh and Ephraim.', keyRefs: [parseSimpleRef(1, 30, 24), parseSimpleRef(1, 37, 3), parseSimpleRef(1, 41, 45), parseSimpleRef(1, 45, 4)] },
  { id: 'benjamin', name: 'Benjamin', hebrew: 'בִּנְיָמִין', strongs: ['H1144', 'G958'], sex: 'male', tribe: 'Benjamin', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Twelfth son of Jacob (second by Rachel).', keyRefs: [parseSimpleRef(1, 35, 18)] },
  { id: 'dinah', name: 'Dinah', hebrew: 'דִּינָה', strongs: ['H1783'], sex: 'female', era: 'Patriarchs', lineageGroup: 'patriarchs', summary: 'Daughter of Jacob and Leah.', keyRefs: [parseSimpleRef(1, 30, 21), parseSimpleRef(1, 34, 1)] },
  { id: 'asenath', name: 'Asenath', hebrew: 'אָסְנַת', strongs: ['H621'], sex: 'female', era: 'Patriarchs / Egypt', lineageGroup: 'patriarchs', summary: 'Egyptian wife of Joseph; mother of Manasseh and Ephraim.', keyRefs: [parseSimpleRef(1, 41, 45)] },
  { id: 'manasseh', name: 'Manasseh', hebrew: 'מְנַשֶּׁה', strongs: ['H4519'], sex: 'male', tribe: 'Manasseh', era: 'Patriarchs / Egypt', lineageGroup: 'patriarchs', summary: 'Firstborn son of Joseph and Asenath; adopted as a tribal ancestor by Jacob.', keyRefs: [parseSimpleRef(1, 41, 51), parseSimpleRef(1, 48, 5)] },
  { id: 'ephraim', name: 'Ephraim', hebrew: 'אֶפְרַיִם', strongs: ['H669'], sex: 'male', tribe: 'Ephraim', era: 'Patriarchs / Egypt', lineageGroup: 'patriarchs', summary: 'Second son of Joseph and Asenath; blessed above Manasseh by Jacob.', keyRefs: [parseSimpleRef(1, 41, 52), parseSimpleRef(1, 48, 14)] },
  { id: 'amram', name: 'Amram', hebrew: 'עַמְרָם', strongs: ['H6019'], sex: 'male', tribe: 'Levi', era: 'Exodus', lineageGroup: 'exodus_priests', summary: 'Levite husband of Jochebed; father of Miriam, Aaron, and Moses.', keyRefs: [parseSimpleRef(2, 6, 20), parseSimpleRef(4, 26, 59)] },
  { id: 'jochebed', name: 'Jochebed', hebrew: 'יוֹכֶבֶד', strongs: ['H3115'], sex: 'female', tribe: 'Levi', era: 'Exodus', lineageGroup: 'exodus_priests', summary: 'Levite wife of Amram; mother of Miriam, Aaron, and Moses.', keyRefs: [parseSimpleRef(2, 6, 20), parseSimpleRef(4, 26, 59)] },
  { id: 'miriam', name: 'Miriam', hebrew: 'מִרְיָם', strongs: ['H4813'], sex: 'female', tribe: 'Levi', era: 'Exodus', lineageGroup: 'exodus_priests', summary: 'Prophetess; sister of Aaron and Moses.', keyRefs: [parseSimpleRef(2, 15, 20), parseSimpleRef(4, 26, 59)] },
  { id: 'aaron', name: 'Aaron', hebrew: 'אַהֲרֹן', strongs: ['H175', 'G2'], sex: 'male', tribe: 'Levi', era: 'Exodus', lineageGroup: 'exodus_priests', summary: 'First High Priest of Israel; elder brother of Moses.', keyRefs: [parseSimpleRef(2, 4, 14), parseSimpleRef(2, 28, 1)] },
  { id: 'moses', name: 'Moses', hebrew: 'מֹשֶׁה', greek: 'Μωϋσῆς', strongs: ['H4872', 'G3475'], sex: 'male', tribe: 'Levi', era: 'Exodus', lineageGroup: 'exodus_priests', summary: 'Prophet and lawgiver of Israel; son of Amram and Jochebed; husband of Zipporah.', keyRefs: [parseSimpleRef(2, 2, 10), parseSimpleRef(2, 3, 4), parseSimpleRef(5, 34, 10)] },
  { id: 'zipporah', name: 'Zipporah', hebrew: 'צִפֹּרָה', strongs: ['H6855'], sex: 'female', era: 'Exodus', lineageGroup: 'exodus_priests', summary: 'Midianite wife of Moses; mother of Gershom and Eliezer.', keyRefs: [parseSimpleRef(2, 2, 21)] },
  { id: 'eleazar', name: 'Eleazar', hebrew: 'אֶלְעָזָר', strongs: ['H499'], sex: 'male', tribe: 'Levi', era: 'Exodus / Conquest', lineageGroup: 'exodus_priests', summary: 'Son of Aaron; succeeded Aaron as High Priest.', keyRefs: [parseSimpleRef(4, 20, 28)] },
  { id: 'phinehas', name: 'Phinehas', hebrew: 'פִּינְחָס', strongs: ['H6372'], sex: 'male', tribe: 'Levi', era: 'Exodus / Judges', lineageGroup: 'exodus_priests', summary: 'Son of Eleazar; granted covenant of perpetual priesthood.', keyRefs: [parseSimpleRef(4, 25, 7), parseSimpleRef(4, 25, 13)] },
  { id: 'tamar', name: 'Tamar', hebrew: 'תָּמָר', strongs: ['H8559', 'G2283'], sex: 'female', era: 'Patriarchs', lineageGroup: 'davidic', summary: 'Mother of Perez and Zerah by Judah.', keyRefs: [parseSimpleRef(1, 38, 29), parseSimpleRef(40, 1, 3)] },
  { id: 'perez', name: 'Perez', hebrew: 'פֶּרֶץ', strongs: ['H6557', 'G5329'], sex: 'male', tribe: 'Judah', era: 'Patriarchs', lineageGroup: 'davidic', summary: 'Son of Judah and Tamar; ancestor of Boaz and David.', keyRefs: [parseSimpleRef(1, 38, 29), parseSimpleRef(8, 4, 18), parseSimpleRef(40, 1, 3)] },
  { id: 'boaz', name: 'Boaz', hebrew: 'בֹּעַז', strongs: ['H1162', 'G1003'], sex: 'male', tribe: 'Judah', era: 'Judges', lineageGroup: 'davidic', summary: 'Bethlehemite kinsman-redeemer; husband of Ruth and great-grandfather of David.', keyRefs: [parseSimpleRef(8, 4, 13), parseSimpleRef(40, 1, 5)] },
  { id: 'ruth', name: 'Ruth', hebrew: 'רוּת', strongs: ['H7327', 'G4503'], sex: 'female', era: 'Judges', lineageGroup: 'davidic', summary: 'Moabite wife of Boaz; great-grandmother of David.', keyRefs: [parseSimpleRef(8, 4, 13), parseSimpleRef(40, 1, 5)] },
  { id: 'obed', name: 'Obed', hebrew: 'עוֹבֵד', strongs: ['H5744', 'G5601'], sex: 'male', tribe: 'Judah', era: 'Judges', lineageGroup: 'davidic', summary: 'Son of Boaz and Ruth; father of Jesse.', keyRefs: [parseSimpleRef(8, 4, 17), parseSimpleRef(40, 1, 5)] },
  { id: 'jesse', name: 'Jesse', hebrew: 'יִשַׁי', strongs: ['H3448', 'G2421'], sex: 'male', tribe: 'Judah', era: 'United Monarchy', lineageGroup: 'davidic', summary: 'Son of Obed; Bethlehemite father of King David.', keyRefs: [parseSimpleRef(9, 16, 1), parseSimpleRef(40, 1, 5)] },
  { id: 'david', name: 'David', hebrew: 'דָּוִד', greek: 'Δαυίδ', strongs: ['H1732', 'G1138'], sex: 'male', tribe: 'Judah', era: 'United Monarchy', lineageGroup: 'davidic', summary: 'Son of Jesse; second king of Israel; father of Solomon and Nathan.', keyRefs: [parseSimpleRef(9, 16, 13), parseSimpleRef(10, 7, 12), parseSimpleRef(40, 1, 6), parseSimpleRef(42, 3, 31)] },
  { id: 'bathsheba', name: 'Bathsheba', hebrew: 'בַּת־שֶׁבַע', strongs: ['H1339'], sex: 'female', era: 'United Monarchy', lineageGroup: 'davidic', summary: 'Wife of David; mother of Solomon and Nathan.', keyRefs: [parseSimpleRef(10, 12, 24), parseSimpleRef(13, 3, 5)] },
  { id: 'solomon', name: 'Solomon', hebrew: 'שְׁלֹמֹה', greek: 'Σολομών', strongs: ['H8010', 'G4672'], sex: 'male', tribe: 'Judah', era: 'United Monarchy', lineageGroup: 'davidic', summary: 'Son of David and Bathsheba; builder of First Temple; listed in Matthew 1 royal line.', keyRefs: [parseSimpleRef(11, 6, 1), parseSimpleRef(40, 1, 6)], competingGenealogyNote: GOSPEL_GENEALOGY_NOTE },
  { id: 'nathan_david', name: 'Nathan (son of David)', hebrew: 'נָתָן', greek: 'Ναθάμ', strongs: ['H5416', 'G3481'], sex: 'male', tribe: 'Judah', era: 'United Monarchy', lineageGroup: 'davidic', summary: 'Son of David and Bathsheba listed in Luke 3:31 messianic genealogy.', keyRefs: [parseSimpleRef(10, 5, 14), parseSimpleRef(13, 3, 5), parseSimpleRef(42, 3, 31)], competingGenealogyNote: GOSPEL_GENEALOGY_NOTE },
  { id: 'rehoboam', name: 'Rehoboam', hebrew: 'רְחַבְעָם', strongs: ['H7346', 'G4497'], sex: 'male', tribe: 'Judah', era: 'Divided Monarchy', lineageGroup: 'davidic', summary: 'Son of Solomon; first king of Judah after division.', keyRefs: [parseSimpleRef(11, 11, 43), parseSimpleRef(40, 1, 7)] },
  { id: 'zerubbabel', name: 'Zerubbabel', hebrew: 'זְרֻבָּבֶל', strongs: ['H2216', 'G2216'], sex: 'male', tribe: 'Judah', era: 'Post-Exilic', lineageGroup: 'davidic', summary: 'Davidic governor who led the Second Temple rebuild; named in both Matt 1:12 and Luke 3:27.', keyRefs: [parseSimpleRef(15, 3, 2), parseSimpleRef(40, 1, 12), parseSimpleRef(42, 3, 27)], competingGenealogyNote: GOSPEL_GENEALOGY_NOTE },
  { id: 'joseph_nt', name: 'Joseph', disambiguator: 'Husband of Mary; legal father of Jesus (Matt 1, Luke 1–3)', greek: 'Ἰωσήφ', strongs: ['G2501'], sex: 'male', tribe: 'Judah', era: 'Gospels', lineageGroup: 'gospels_apostles', homonymGroup: 'joseph', summary: 'Nazareth carpenter of the house of David; betrothed/husband of Mary and legal father of Jesus.', keyRefs: [parseSimpleRef(40, 1, 16), parseSimpleRef(40, 1, 20), parseSimpleRef(42, 2, 4), parseSimpleRef(42, 3, 23)], competingGenealogyNote: GOSPEL_GENEALOGY_NOTE },
  { id: 'mary_jesus', name: 'Mary (mother of Jesus)', greek: 'Μαριάμ', strongs: ['G3137'], sex: 'female', era: 'Gospels', lineageGroup: 'gospels_apostles', summary: 'Virgin mother of Jesus in Bethlehem/Nazareth; wife of Joseph.', keyRefs: [parseSimpleRef(40, 1, 16), parseSimpleRef(42, 1, 27), parseSimpleRef(42, 2, 7)] },
  { id: 'jesus', name: 'Jesus', greek: 'Ἰησοῦς', strongs: ['G2424'], sex: 'male', tribe: 'Judah', era: 'Gospels', lineageGroup: 'gospels_apostles', summary: 'Jesus of Nazareth, Messiah and Son of God; Davidic legal lineage via Joseph (Matt 1) and Luke 3 genealogy.', keyRefs: [parseSimpleRef(40, 1, 1), parseSimpleRef(40, 1, 16), parseSimpleRef(42, 3, 23)], competingGenealogyNote: GOSPEL_GENEALOGY_NOTE },
];

const CORE_RELATIONSHIPS: readonly AtlasRelationship[] = [
  { id: 'adam_eve', fromId: 'adam', toId: 'eve', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(1, 3, 20) },
  { id: 'adam_cain', fromId: 'adam', toId: 'cain', type: 'father', category: 'inferred', witnessRef: parseSimpleRef(1, 4, 1) },
  { id: 'eve_cain', fromId: 'eve', toId: 'cain', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 4, 1) },
  { id: 'adam_abel', fromId: 'adam', toId: 'abel', type: 'father', category: 'inferred', witnessRef: parseSimpleRef(1, 4, 2) },
  { id: 'eve_abel', fromId: 'eve', toId: 'abel', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 4, 2) },
  { id: 'adam_seth', fromId: 'adam', toId: 'seth', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 5, 3) },
  { id: 'eve_seth', fromId: 'eve', toId: 'seth', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 4, 25) },
  { id: 'seth_noah_anc', fromId: 'seth', toId: 'noah', type: 'successor', typeLabel: 'Gen 5 lineage (via Enosh–Lamech)', category: 'explicit', witnessRef: parseSimpleRef(1, 5, 6) },
  { id: 'noah_shem', fromId: 'noah', toId: 'shem', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 5, 32) },
  { id: 'noah_ham', fromId: 'noah', toId: 'ham', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 5, 32) },
  { id: 'noah_japheth', fromId: 'noah', toId: 'japheth', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 5, 32) },
  { id: 'ham_canaan', fromId: 'ham', toId: 'canaan', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 10, 6) },
  { id: 'canaan_amor', fromId: 'canaan', toId: 'amor', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 10, 16), note: 'Table of Nations eponymous lineage ("Canaan fathered... the Amorite").' },
  { id: 'shem_eber', fromId: 'shem', toId: 'eber', type: 'successor', typeLabel: 'Shem -> Arpachshad -> Shelah -> Eber', category: 'explicit', witnessRef: parseSimpleRef(1, 10, 24) },
  { id: 'eber_terah', fromId: 'eber', toId: 'terah', type: 'successor', typeLabel: 'Gen 11:16–24 lineage (via Peleg–Nahor)', category: 'explicit', witnessRef: parseSimpleRef(1, 11, 16) },
  { id: 'terah_abraham', fromId: 'terah', toId: 'abraham', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 11, 27) },
  { id: 'abraham_sarah', fromId: 'abraham', toId: 'sarah', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(1, 11, 29) },
  { id: 'abraham_ishmael', fromId: 'abraham', toId: 'ishmael', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 16, 15) },
  { id: 'hagar_ishmael', fromId: 'hagar', toId: 'ishmael', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 16, 15) },
  { id: 'abraham_isaac', fromId: 'abraham', toId: 'isaac', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 21, 3) },
  { id: 'sarah_isaac', fromId: 'sarah', toId: 'isaac', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 21, 2) },
  { id: 'isaac_rebekah', fromId: 'isaac', toId: 'rebekah', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(1, 24, 67) },
  { id: 'isaac_esau', fromId: 'isaac', toId: 'esau', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 25, 25) },
  { id: 'rebekah_esau', fromId: 'rebekah', toId: 'esau', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 25, 25) },
  { id: 'isaac_jacob', fromId: 'isaac', toId: 'jacob', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 25, 26) },
  { id: 'rebekah_jacob', fromId: 'rebekah', toId: 'jacob', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 25, 26) },
  { id: 'esau_jacob_sib', fromId: 'esau', toId: 'jacob', type: 'sibling', category: 'explicit', witnessRef: parseSimpleRef(1, 25, 26) },
  { id: 'jacob_leah', fromId: 'jacob', toId: 'leah', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 23) },
  { id: 'jacob_rachel', fromId: 'jacob', toId: 'rachel', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 28) },
  { id: 'jacob_reuben', fromId: 'jacob', toId: 'reuben', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 32) },
  { id: 'leah_reuben', fromId: 'leah', toId: 'reuben', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 32) },
  { id: 'jacob_simeon', fromId: 'jacob', toId: 'simeon', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 33) },
  { id: 'leah_simeon', fromId: 'leah', toId: 'simeon', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 33) },
  { id: 'jacob_levi', fromId: 'jacob', toId: 'levi', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 34) },
  { id: 'leah_levi', fromId: 'leah', toId: 'levi', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 34) },
  { id: 'jacob_judah', fromId: 'jacob', toId: 'judah', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 35) },
  { id: 'leah_judah', fromId: 'leah', toId: 'judah', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 29, 35) },
  { id: 'jacob_dan', fromId: 'jacob', toId: 'dan', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 6) },
  { id: 'bilhah_dan', fromId: 'bilhah', toId: 'dan', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 6) },
  { id: 'jacob_naphtali', fromId: 'jacob', toId: 'naphtali', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 8) },
  { id: 'bilhah_naphtali', fromId: 'bilhah', toId: 'naphtali', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 8) },
  { id: 'jacob_gad', fromId: 'jacob', toId: 'gad', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 11) },
  { id: 'zilpah_gad', fromId: 'zilpah', toId: 'gad', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 11) },
  { id: 'jacob_asher', fromId: 'jacob', toId: 'asher', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 13) },
  { id: 'zilpah_asher', fromId: 'zilpah', toId: 'asher', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 13) },
  { id: 'jacob_issachar', fromId: 'jacob', toId: 'issachar', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 18) },
  { id: 'leah_issachar', fromId: 'leah', toId: 'issachar', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 18) },
  { id: 'jacob_zebulun', fromId: 'jacob', toId: 'zebulun', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 20) },
  { id: 'leah_zebulun', fromId: 'leah', toId: 'zebulun', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 20) },
  { id: 'jacob_dinah', fromId: 'jacob', toId: 'dinah', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 21) },
  { id: 'leah_dinah', fromId: 'leah', toId: 'dinah', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 21) },
  { id: 'jacob_joseph_ot', fromId: 'jacob', toId: 'joseph_ot', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 24) },
  { id: 'rachel_joseph_ot', fromId: 'rachel', toId: 'joseph_ot', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 30, 24) },
  { id: 'jacob_benjamin', fromId: 'jacob', toId: 'benjamin', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 35, 18) },
  { id: 'rachel_benjamin', fromId: 'rachel', toId: 'benjamin', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 35, 18) },
  { id: 'joseph_ot_benjamin', fromId: 'joseph_ot', toId: 'benjamin', type: 'sibling', category: 'explicit', witnessRef: parseSimpleRef(1, 43, 29) },
  { id: 'joseph_ot_asenath', fromId: 'joseph_ot', toId: 'asenath', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(1, 41, 45) },
  { id: 'joseph_ot_manasseh', fromId: 'joseph_ot', toId: 'manasseh', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 41, 51) },
  { id: 'asenath_manasseh', fromId: 'asenath', toId: 'manasseh', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 41, 51) },
  { id: 'joseph_ot_ephraim', fromId: 'joseph_ot', toId: 'ephraim', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 41, 52) },
  { id: 'asenath_ephraim', fromId: 'asenath', toId: 'ephraim', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 41, 52) },
  { id: 'levi_amram_anc', fromId: 'levi', toId: 'amram', type: 'successor', typeLabel: 'Levi -> Kohath -> Amram', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 16) },
  { id: 'amram_jochebed', fromId: 'amram', toId: 'jochebed', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 20) },
  { id: 'amram_miriam', fromId: 'amram', toId: 'miriam', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(4, 26, 59) },
  { id: 'jochebed_miriam', fromId: 'jochebed', toId: 'miriam', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(4, 26, 59) },
  { id: 'amram_aaron', fromId: 'amram', toId: 'aaron', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 20) },
  { id: 'jochebed_aaron', fromId: 'jochebed', toId: 'aaron', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 20) },
  { id: 'amram_moses', fromId: 'amram', toId: 'moses', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 20) },
  { id: 'jochebed_moses', fromId: 'jochebed', toId: 'moses', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 20) },
  { id: 'aaron_moses_sib', fromId: 'aaron', toId: 'moses', type: 'sibling', category: 'explicit', witnessRef: parseSimpleRef(2, 4, 14) },
  { id: 'moses_zipporah', fromId: 'moses', toId: 'zipporah', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(2, 2, 21) },
  { id: 'aaron_eleazar', fromId: 'aaron', toId: 'eleazar', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 23) },
  { id: 'eleazar_phinehas', fromId: 'eleazar', toId: 'phinehas', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(2, 6, 25) },
  { id: 'judah_perez', fromId: 'judah', toId: 'perez', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(1, 38, 29) },
  { id: 'tamar_perez', fromId: 'tamar', toId: 'perez', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(1, 38, 29) },
  { id: 'perez_boaz', fromId: 'perez', toId: 'boaz', type: 'successor', typeLabel: 'Ruth 4:18–21 lineage (via Hezron–Salmon)', category: 'explicit', witnessRef: parseSimpleRef(8, 4, 18) },
  { id: 'boaz_ruth', fromId: 'boaz', toId: 'ruth', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(8, 4, 13) },
  { id: 'boaz_obed', fromId: 'boaz', toId: 'obed', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(8, 4, 17) },
  { id: 'ruth_obed', fromId: 'ruth', toId: 'obed', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(8, 4, 17) },
  { id: 'obed_jesse', fromId: 'obed', toId: 'jesse', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(8, 4, 17) },
  { id: 'jesse_david', fromId: 'jesse', toId: 'david', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(8, 4, 22) },
  { id: 'david_bathsheba', fromId: 'david', toId: 'bathsheba', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(10, 12, 24) },
  { id: 'david_solomon', fromId: 'david', toId: 'solomon', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(10, 12, 24) },
  { id: 'bathsheba_solomon', fromId: 'bathsheba', toId: 'solomon', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(10, 12, 24) },
  { id: 'david_nathan', fromId: 'david', toId: 'nathan_david', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(10, 5, 14) },
  { id: 'bathsheba_nathan', fromId: 'bathsheba', toId: 'nathan_david', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(13, 3, 5) },
  { id: 'solomon_rehoboam', fromId: 'solomon', toId: 'rehoboam', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(11, 11, 43) },
  { id: 'rehoboam_zerubbabel', fromId: 'rehoboam', toId: 'zerubbabel', type: 'successor', typeLabel: 'Matt 1:7–12 royal line', category: 'explicit', witnessRef: parseSimpleRef(40, 1, 12), competingModel: GOSPEL_GENEALOGY_NOTE },
  { id: 'nathan_zerubbabel', fromId: 'nathan_david', toId: 'zerubbabel', type: 'successor', typeLabel: 'Luke 3:27–31 line', category: 'explicit', witnessRef: parseSimpleRef(42, 3, 27), competingModel: GOSPEL_GENEALOGY_NOTE },
  { id: 'zerubbabel_joseph_nt', fromId: 'zerubbabel', toId: 'joseph_nt', type: 'successor', typeLabel: 'Matt 1:13–16 (via Abiud–Jacob) / Luke 3:23–27 (via Rhesa–Eli)', category: 'explicit', witnessRef: parseSimpleRef(40, 1, 16), competingModel: GOSPEL_GENEALOGY_NOTE },
  { id: 'joseph_nt_mary', fromId: 'joseph_nt', toId: 'mary_jesus', type: 'spouse', category: 'explicit', witnessRef: parseSimpleRef(40, 1, 20) },
  { id: 'joseph_nt_jesus', fromId: 'joseph_nt', toId: 'jesus', type: 'father', category: 'explicit', witnessRef: parseSimpleRef(42, 3, 23), note: 'Legal/adoptive father in Davidic household.', competingModel: 'Luke 3:23 ("as was supposed, the son of Joseph") alongside Matt 1:16–20 virgin conception.' },
  { id: 'mary_jesus_mother', fromId: 'mary_jesus', toId: 'jesus', type: 'mother', category: 'explicit', witnessRef: parseSimpleRef(42, 2, 7) },
];

const UPSTREAM_TO_CURATED_ID: Record<string, string> = {
  Adam_1: 'adam', Eve_1: 'eve', Cain_1: 'cain', Abel_1: 'abel', Seth_1: 'seth',
  Noah_1: 'noah', Shem_1: 'shem', Ham_1: 'ham', Japheth_1: 'japheth', Canaan_1: 'canaan',
  Eber_1: 'eber', Terah_1: 'terah', Abram_1: 'abraham', Sarai_1: 'sarah', Hagar_1: 'hagar',
  Ishmael_1: 'ishmael', Isaac_1: 'isaac', Rebekah_1: 'rebekah', Esau_1: 'esau',
  Jacob_1: 'jacob', Leah_1: 'leah', Rachel_1: 'rachel', Bilhah_1: 'bilhah', Zilpah_1: 'zilpah',
  Reuben_1: 'reuben', Simeon_1: 'simeon', Levi_1: 'levi', Judah_1: 'judah',
  Dan_1: 'dan', Naphtali_1: 'naphtali', Gad_1: 'gad', Asher_1: 'asher',
  Issachar_1: 'issachar', Zebulun_1: 'zebulun', Joseph_1: 'joseph_ot', Benjamin_1: 'benjamin',
  Dinah_1: 'dinah', Asenath_1: 'asenath', Manasseh_1: 'manasseh', Ephraim_1: 'ephraim',
  Amram_1: 'amram', Jochebed_1: 'jochebed', Miriam_1: 'miriam', Aaron_1: 'aaron',
  Moses_1: 'moses', Zipporah_1: 'zipporah', Eleazar_1: 'eleazar', Phinehas_1: 'phinehas',
  Tamar_1: 'tamar', Perez_1: 'perez', Boaz_1: 'boaz', Ruth_1: 'ruth', Obed_1: 'obed',
  Jesse_1: 'jesse', David_1: 'david', Bathsheba_1: 'bathsheba', Solomon_1: 'solomon',
  Nathan_1: 'nathan_david', Rehoboam_1: 'rehoboam', Zerubbabel_2: 'zerubbabel',
  Joseph_6: 'joseph_nt', Mary_1: 'mary_jesus', Jesus_1: 'jesus',
};

const SYMMETRIC_EDGE_TYPES = new Set<RelationshipKind>(['spouse', 'sibling', 'covenant_friend']);
const peopleGraphCache = createShardCache<PeopleGraphShard>();
const personVersesCache = createShardCache<PersonVersesShard>();

interface CompiledPeopleGraph {
  people: AtlasPerson[];
  personById: Map<string, AtlasPerson>;
  adjById: Map<string, AtlasRelationship[]>;
  versesByPersonId: Map<string, string[]>;
  sourceMode: 'corpus_shard+fallback' | 'fallback_only';
}

function buildFallbackPeopleGraph(): CompiledPeopleGraph {
  const people = CORE_PEOPLE.map((p) => ({ ...p }));
  const personById = new Map<string, AtlasPerson>(people.map((p) => [p.id, p]));
  const adjById = new Map<string, AtlasRelationship[]>();
  for (const rel of CORE_RELATIONSHIPS) {
    if (!adjById.has(rel.fromId)) adjById.set(rel.fromId, []);
    adjById.get(rel.fromId)!.push(rel);
    if (rel.toId !== rel.fromId) {
      if (!adjById.has(rel.toId)) adjById.set(rel.toId, []);
      adjById.get(rel.toId)!.push(rel);
    }
  }
  return {
    people,
    personById,
    adjById,
    versesByPersonId: new Map(),
    sourceMode: 'fallback_only',
  };
}

function mergePeopleAndVerses(
  shard: PeopleGraphShard | null,
  versesShard: PersonVersesShard | null,
): CompiledPeopleGraph {
  if (!shard || !Array.isArray(shard.people) || shard.people.length === 0) {
    return buildFallbackPeopleGraph();
  }

  const curatedById = new Map<string, AtlasPerson>(
    CORE_PEOPLE.map((p) => [p.id, { ...p, strongs: p.strongs ? [...p.strongs] : undefined, keyRefs: [...p.keyRefs] }]),
  );
  const mergedPeople: AtlasPerson[] = [...curatedById.values()];
  const personById = new Map<string, AtlasPerson>();

  for (const raw of shard.people) {
    if (!raw || typeof raw.id !== 'string' || !raw.name) continue;
    const mappedId = UPSTREAM_TO_CURATED_ID[raw.id];
    if (mappedId && curatedById.has(mappedId)) {
      const curated = curatedById.get(mappedId)!;
      personById.set(raw.id, curated);
      if (!curated.hebrew && raw.hebrew) curated.hebrew = raw.hebrew;
      if (!curated.greek && raw.greek) curated.greek = raw.greek;
      if (!curated.transliteration && raw.transliteration) curated.transliteration = raw.transliteration;
      if (!curated.sex && raw.sex) curated.sex = raw.sex;
      if (!curated.tribe && raw.tribe) curated.tribe = raw.tribe;
      if (Array.isArray(raw.strongs) && raw.strongs.length > 0) {
        const set = new Set((curated.strongs ?? []).map((s) => normalizeStrongsCode(s)).filter(Boolean));
        for (const s of raw.strongs) {
          const norm = normalizeStrongsCode(s);
          if (norm) set.add(norm);
        }
        curated.strongs = [...set];
      }
      continue;
    }
    if (curatedById.has(raw.id)) continue;
    mergedPeople.push(raw);
  }

  for (const p of mergedPeople) {
    personById.set(p.id, p);
  }

  const edgeByKey = new Map<string, AtlasRelationship>();
  const edgeKey = (fromId: string, toId: string, type: RelationshipKind) =>
    SYMMETRIC_EDGE_TYPES.has(type) && fromId > toId
      ? `${toId}|${fromId}|${type}`
      : `${fromId}|${toId}|${type}`;

  for (const rel of CORE_RELATIONSHIPS) {
    edgeByKey.set(edgeKey(rel.fromId, rel.toId, rel.type), { ...rel });
  }
  for (const rawRel of shard.relationships ?? []) {
    if (!rawRel || !rawRel.fromId || !rawRel.toId || !rawRel.type) continue;
    const fromId = UPSTREAM_TO_CURATED_ID[rawRel.fromId] ?? rawRel.fromId;
    const toId = UPSTREAM_TO_CURATED_ID[rawRel.toId] ?? rawRel.toId;
    if (!fromId || !toId || fromId === toId) continue;
    const k = edgeKey(fromId, toId, rawRel.type);
    if (!edgeByKey.has(k)) {
      edgeByKey.set(k, {
        ...rawRel,
        fromId,
        toId,
        category: rawRel.category ?? 'inferred',
      });
    }
  }

  const adjById = new Map<string, AtlasRelationship[]>();
  for (const rel of edgeByKey.values()) {
    if (!adjById.has(rel.fromId)) adjById.set(rel.fromId, []);
    adjById.get(rel.fromId)!.push(rel);
    if (rel.toId !== rel.fromId) {
      if (!adjById.has(rel.toId)) adjById.set(rel.toId, []);
      adjById.get(rel.toId)!.push(rel);
    }
  }

  const versesByPersonId = new Map<string, string[]>();
  if (versesShard && typeof versesShard === 'object') {
    const asObj = versesShard as Record<string, unknown>;
    const byPersonRaw = (asObj.byPerson && typeof asObj.byPerson === 'object'
      ? asObj.byPerson
      : null) as Record<string, unknown> | null;
    const byVerseRaw = (asObj.byVerse && typeof asObj.byVerse === 'object'
      ? asObj.byVerse
      : null) as Record<string, unknown> | null;

    if (byPersonRaw) {
      for (const [pid, refs] of Object.entries(byPersonRaw)) {
        if (!Array.isArray(refs)) continue;
        const mapped = UPSTREAM_TO_CURATED_ID[pid] ?? pid;
        versesByPersonId.set(mapped, refs.map(String));
      }
    } else if (byVerseRaw) {
      for (const [vKey, pids] of Object.entries(byVerseRaw)) {
        if (!Array.isArray(pids)) continue;
        for (const pid of pids) {
          const mapped = UPSTREAM_TO_CURATED_ID[String(pid)] ?? String(pid);
          if (!versesByPersonId.has(mapped)) versesByPersonId.set(mapped, []);
          versesByPersonId.get(mapped)!.push(vKey);
        }
      }
    } else {
      for (const [key, val] of Object.entries(asObj)) {
        if (!Array.isArray(val)) continue;
        if (/^\d+:\d+:\d+$/.test(key)) {
          for (const pid of val) {
            const mapped = UPSTREAM_TO_CURATED_ID[String(pid)] ?? String(pid);
            if (!versesByPersonId.has(mapped)) versesByPersonId.set(mapped, []);
            versesByPersonId.get(mapped)!.push(key);
          }
        } else {
          const mapped = UPSTREAM_TO_CURATED_ID[key] ?? key;
          versesByPersonId.set(mapped, val.map(String));
        }
      }
    }
  }

  return {
    people: mergedPeople,
    personById,
    adjById,
    versesByPersonId,
    sourceMode: 'corpus_shard+fallback',
  };
}

function scoreVerseTagAgainstSpans(tag: string, spans: PassageSpan[]): number {
  const numeric = /^(\d{1,2}):(\d{1,3}):(\d{1,3})$/.exec(tag.trim());
  if (numeric) {
    return passageSpansMatchRef(spans, {
      book: Number(numeric[1]),
      chapter: Number(numeric[2]),
      verse: Number(numeric[3]),
    });
  }
  const parsed = parsePassageString(tag);
  if (parsed && parsed.passages.length > 0) {
    const first = parsed.passages[0];
    return passageSpansMatchRef(spans, {
      book: first.book,
      chapter: first.chapter,
      verse: first.start_verse,
    });
  }
  return 0;
}

function formatEdgeSummary(
  edge: AtlasRelationship,
  other: AtlasPerson,
  via?: string,
): Record<string, unknown> {
  return {
    id: other.id,
    name: other.name,
    ...(other.disambiguator ? { disambiguator: other.disambiguator } : {}),
    ...(other.strongs?.length ? { strongs: other.strongs } : {}),
    ...(via ? { via } : {}),
    relation: edge.type,
    ...(edge.typeLabel ? { relation_label: edge.typeLabel } : {}),
    evidence_category: edge.category ?? 'explicit',
    witness_ref: edge.witnessRef.label,
    ...(edge.note ? { note: edge.note } : {}),
    ...(edge.competingModel ? { competing_model: edge.competingModel } : {}),
  };
}

export async function queryMcpGenealogy(
  params: { person?: string; strongs?: string; passage?: string; generations?: number; limit?: number },
  corpusUrl?: string,
): Promise<Record<string, unknown>> {
  const baseUrl = getCorpusBaseUrl(corpusUrl);
  const [shard, versesShard] = await Promise.all([
    loadCachedShard<PeopleGraphShard>(peopleGraphCache, baseUrl, '/data/bible-people-graph.json'),
    loadCachedShard<PersonVersesShard>(personVersesCache, baseUrl, '/data/bible-person-verses.json'),
  ]);
  const graph = mergePeopleAndVerses(shard, versesShard);

  const queryText = (params.person ?? '').trim();
  const queryLower = queryText.toLowerCase();
  const normStrongs = normalizeStrongsCode(params.strongs);
  const parsedPassage = params.passage ? parsePassageString(params.passage) : null;
  if (params.passage && !parsedPassage) {
    return { status: 'invalid_request', error: `Could not parse passage: ${params.passage}` };
  }

  const limit = Math.max(1, Math.min(30, Math.trunc(params.limit ?? 10)));
  const generations: 1 | 2 = params.generations === 1 ? 1 : 2;
  const spans = parsedPassage?.passages ?? [];

  const scored: Array<{ person: AtlasPerson; score: number; passageScore: number; idx: number }> = [];

  graph.people.forEach((person, idx) => {
    let textScore = 0;
    if (queryLower) {
      const nameL = person.name.toLowerCase();
      if (nameL === queryLower || person.id.toLowerCase() === queryLower) textScore = 100;
      else if (nameL.startsWith(queryLower)) textScore = 70;
      else if (
        nameL.includes(queryLower) ||
        (person.disambiguator?.toLowerCase().includes(queryLower) ?? false) ||
        (person.transliteration?.toLowerCase().includes(queryLower) ?? false) ||
        (person.hebrew?.includes(queryText) ?? false) ||
        (person.greek?.includes(queryText) ?? false)
      ) {
        textScore = 45;
      }
      if (textScore === 0 && !normStrongs) return;
    }

    let strongsScore = 0;
    if (normStrongs) {
      const hasStrongs = (person.strongs ?? []).some((s) => normalizeStrongsCode(s) === normStrongs);
      if (hasStrongs) strongsScore = 95;
      else if (!queryLower) return;
    }

    let passageScore = 0;
    if (spans.length > 0) {
      for (const kr of person.keyRefs) {
        passageScore = Math.max(passageScore, passageSpansMatchRef(spans, kr.passage));
      }
      for (const edge of graph.adjById.get(person.id) ?? []) {
        passageScore = Math.max(passageScore, passageSpansMatchRef(spans, edge.witnessRef.passage));
      }
      for (const vTag of graph.versesByPersonId.get(person.id) ?? []) {
        passageScore = Math.max(passageScore, scoreVerseTagAgainstSpans(vTag, spans));
      }
      if (!queryLower && !normStrongs && passageScore === 0) return;
    }

    if (!queryLower && !normStrongs && spans.length === 0) {
      // Default browse starts with core figures
      if (idx >= limit) return;
      scored.push({ person, score: 10, passageScore: 0, idx });
      return;
    }

    const total = textScore + strongsScore + passageScore * 2;
    if (total > 0) {
      scored.push({ person, score: total, passageScore, idx });
    }
  });

  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : b.passageScore !== a.passageScore ? b.passageScore - a.passageScore : a.idx - b.idx,
  );

  if (scored.length === 0) {
    return {
      status: 'not_found',
      source: graph.sourceMode,
      query: { person: params.person ?? null, strongs: normStrongs || null, passage: parsedPassage?.normalized ?? null },
      matches: [],
      epistemic_note:
        'No biblical person matched the supplied filter. Explicit Scripture attestations and inferred relationships are tracked separately; nothing was fabricated.',
    };
  }

  const focus = scored[0].person;
  const focusEdges = graph.adjById.get(focus.id) ?? [];

  const parents: Record<string, unknown>[] = [];
  const parentIds = new Set<string>();
  const spouses: Record<string, unknown>[] = [];
  const spouseIds = new Set<string>();
  const siblings: Record<string, unknown>[] = [];
  const siblingIds = new Set<string>();
  const children: Record<string, unknown>[] = [];
  const childIds = new Set<string>();
  const otherLinks: Record<string, unknown>[] = [];
  const otherIds = new Set<string>();

  for (const edge of focusEdges) {
    if ((edge.type === 'father' || edge.type === 'mother') && edge.toId === focus.id) {
      const parent = graph.personById.get(edge.fromId);
      if (parent && !parentIds.has(parent.id)) {
        parentIds.add(parent.id);
        parents.push(formatEdgeSummary(edge, parent));
      }
    } else if ((edge.type === 'father' || edge.type === 'mother') && edge.fromId === focus.id) {
      const child = graph.personById.get(edge.toId);
      if (child && !childIds.has(child.id)) {
        childIds.add(child.id);
        children.push(formatEdgeSummary(edge, child));
      }
    } else if (edge.type === 'spouse') {
      const otherId = edge.fromId === focus.id ? edge.toId : edge.fromId;
      const other = graph.personById.get(otherId);
      if (other && !spouseIds.has(other.id)) {
        spouseIds.add(other.id);
        spouses.push(formatEdgeSummary(edge, other));
      }
    } else if (edge.type === 'sibling') {
      const otherId = edge.fromId === focus.id ? edge.toId : edge.fromId;
      const other = graph.personById.get(otherId);
      if (other && !siblingIds.has(other.id)) {
        siblingIds.add(other.id);
        siblings.push(formatEdgeSummary(edge, other));
      }
    } else {
      const otherId = edge.fromId === focus.id ? edge.toId : edge.fromId;
      const other = graph.personById.get(otherId);
      if (other && !otherIds.has(other.id)) {
        otherIds.add(other.id);
        otherLinks.push({
          ...formatEdgeSummary(edge, other),
          direction: edge.fromId === focus.id ? 'outgoing' : 'incoming',
        });
      }
    }
  }

  const grandparents: Record<string, unknown>[] = [];
  const grandchildren: Record<string, unknown>[] = [];

  if (generations === 2) {
    const gpSeen = new Set<string>();
    for (const pid of parentIds) {
      const pNode = graph.personById.get(pid);
      for (const edge of graph.adjById.get(pid) ?? []) {
        if ((edge.type === 'father' || edge.type === 'mother') && edge.toId === pid) {
          const gp = graph.personById.get(edge.fromId);
          if (gp && gp.id !== focus.id && !gpSeen.has(gp.id)) {
            gpSeen.add(gp.id);
            grandparents.push(formatEdgeSummary(edge, gp, pNode?.name));
          }
        }
      }
    }

    const gcSeen = new Set<string>();
    for (const cid of childIds) {
      const cNode = graph.personById.get(cid);
      for (const edge of graph.adjById.get(cid) ?? []) {
        if ((edge.type === 'father' || edge.type === 'mother') && edge.fromId === cid) {
          const gc = graph.personById.get(edge.toId);
          if (gc && gc.id !== focus.id && !gcSeen.has(gc.id)) {
            gcSeen.add(gc.id);
            grandchildren.push(formatEdgeSummary(edge, gc, cNode?.name));
          }
        }
      }
    }
  }

  const competingNotes = [
    ...(focus.competingGenealogyNote ? [focus.competingGenealogyNote] : []),
    ...focusEdges.map((e) => e.competingModel).filter((n): n is string => Boolean(n)),
  ];

  return {
    status: 'ok',
    source: graph.sourceMode,
    total_people_indexed: graph.people.length,
    query: {
      person: params.person ?? null,
      strongs: normStrongs || null,
      passage: parsedPassage?.normalized ?? null,
      generations,
    },
    focus: {
      id: focus.id,
      name: focus.name,
      disambiguator: focus.disambiguator ?? null,
      hebrew: focus.hebrew ?? null,
      greek: focus.greek ?? null,
      transliteration: focus.transliteration ?? null,
      strongs: focus.strongs ?? [],
      tribe: focus.tribe ?? null,
      era: focus.era ?? null,
      summary: focus.summary,
      key_refs: focus.keyRefs.map((k) => k.label),
    },
    traversal: {
      generations_traversed: generations,
      parents,
      ...(generations === 2 ? { grandparents } : {}),
      spouses,
      siblings: siblings.slice(0, 20),
      children: children.slice(0, 24),
      ...(generations === 2 ? { grandchildren: grandchildren.slice(0, 24) } : {}),
      other_links: otherLinks.slice(0, 15),
    },
    candidates: scored.slice(0, limit).map((item) => ({
      id: item.person.id,
      name: item.person.name,
      disambiguator: item.person.disambiguator ?? null,
      strongs: item.person.strongs ?? [],
      key_refs: item.person.keyRefs.slice(0, 4).map((k) => k.label),
      passage_match: item.passageScore > 0,
    })),
    competing_genealogy_notes: Array.from(new Set(competingNotes)),
    epistemic_note:
      'Scripture-attested relationships distinguish category="explicit" (directly stated in the cited verse) from category="inferred" (derived from textual kinship context). Genesis 10 eponyms and divergent Gospel lineages (Matt 1 vs Luke 3) are kept explicitly distinct.',
  };
}

// === @section:tribe-lineage ===
interface TribeLineageRecord {
  id: string;
  name: string;
  aliases: string[];
  hebrew?: string;
  greek?: string;
  transliteration?: string;
  strongs: string[];
  branch: 'shem' | 'ham' | 'japheth' | 'israel_tribe' | 'abrahamic_cousin' | 'post_exilic';
  noahic_chain: string[];
  scripture_attestation: {
    refs: string[];
    summary: string;
  };
  origin_coordinates: { lat: number; lon: number; label: string } | null;
  settlement_coordinates: { lat: number; lon: number; label: string }[];
  modern_area_proposal: {
    regions: string[];
    scholarly_notes: string;
    confidence: 'high' | 'moderate' | 'debated' | 'low';
  };
}

const TRIBE_LINEAGES: readonly TribeLineageRecord[] = [
  // Hamitic / Canaanite Table of Nations
  {
    id: 'canaanites',
    name: 'Canaanites',
    aliases: ['canaan', 'kenaani'],
    hebrew: 'כְּנַעֲנִי',
    transliteration: 'Kenaani',
    strongs: ['H3667', 'H3669'],
    branch: 'ham',
    noahic_chain: ['Noah', 'Ham', 'Canaan'],
    scripture_attestation: {
      refs: ['Gen 10:6', 'Gen 10:15-19', 'Gen 12:6', 'Josh 17:12'],
      summary: 'Son of Ham; ancestor of Sidon, Heth, Jebusites, Amorites, Girgashites, Hivites, and coastal/valley Levantine groups from Sidon to Gaza.',
    },
    origin_coordinates: { lat: 31.9, lon: 35.1, label: 'Southern Levant (Canaanite heartland)' },
    settlement_coordinates: [
      { lat: 33.56, lon: 35.37, label: 'Sidon' },
      { lat: 31.5, lon: 34.47, label: 'Gaza' },
      { lat: 32.58, lon: 35.18, label: 'Megiddo / Jezreel' },
    ],
    modern_area_proposal: {
      regions: ['Israel', 'Palestinian Territories', 'Lebanon', 'coastal Syria'],
      scholarly_notes: 'Bronze/Iron Age Northwest Semitic city-states of the Levant (Amarna Letters Kinahni/Kinahhu).',
      confidence: 'high',
    },
  },
  {
    id: 'amorites',
    name: 'Amorites',
    aliases: ['amor', 'emori'],
    hebrew: 'אֱמֹרִי',
    transliteration: 'Emori',
    strongs: ['H567'],
    branch: 'ham',
    noahic_chain: ['Noah', 'Ham', 'Canaan', 'Amor (Emori)'],
    scripture_attestation: {
      refs: ['Gen 10:16', 'Gen 14:7', 'Gen 15:16', 'Num 21:21-31', 'Deut 1:7', 'Amos 2:9'],
      summary: 'Listed among Canaan\'s descendants in Gen 10:16; dwelt in the hill country of Canaan and Transjordan (kingdoms of Sihon at Heshbon and Og in Bashan).',
    },
    origin_coordinates: { lat: 35.0, lon: 38.5, label: 'Syrian Steppe / Upper Euphrates (MAR.TU / Amurru)' },
    settlement_coordinates: [
      { lat: 31.8, lon: 35.8, label: 'Heshbon (Transjordan)' },
      { lat: 32.85, lon: 35.85, label: 'Bashan / Golan' },
      { lat: 31.53, lon: 35.1, label: 'Judean Hill Country (Hebron)' },
    ],
    modern_area_proposal: {
      regions: ['Syria', 'Jordan (Transjordan)', 'Israel / West Bank'],
      scholarly_notes: 'Correlated in ANE texts with Akkadian Amurru / Sumerian MAR.TU western Semitic populations across Syria and Transjordan.',
      confidence: 'high',
    },
  },
  {
    id: 'hittites',
    name: 'Hittites (Sons of Heth)',
    aliases: ['heth', 'chitti'],
    hebrew: 'חִתִּי',
    transliteration: 'Chitti',
    strongs: ['H2850', 'H2845'],
    branch: 'ham',
    noahic_chain: ['Noah', 'Ham', 'Canaan', 'Heth'],
    scripture_attestation: {
      refs: ['Gen 10:15', 'Gen 23:3-20', 'Josh 1:4', '1 Kgs 10:29', '2 Kgs 7:6'],
      summary: 'Descended from Heth, second named son of Canaan; attested both locally around Hebron (Ephron the Hittite) and as northern Syrian "kings of the Hittites."',
    },
    origin_coordinates: { lat: 40.02, lon: 34.61, label: 'Central Anatolia (Hattusa)' },
    settlement_coordinates: [
      { lat: 36.83, lon: 38.01, label: 'Carchemish (Neo-Hittite Syria)' },
      { lat: 31.52, lon: 35.11, label: 'Hebron (Biblical Sons of Heth)' },
    ],
    modern_area_proposal: {
      regions: ['Central Turkey (Anatolia)', 'Northern Syria', 'Southern Levant (local enclaves)'],
      scholarly_notes: 'Distinguish Bronze Age Anatolian Hatti Empire (Indo-European Nesili/Hattic) from Iron Age Syro-Hittite kingdoms and local Canaanite "Sons of Heth" in Genesis 23.',
      confidence: 'moderate',
    },
  },
  {
    id: 'jebusites',
    name: 'Jebusites',
    aliases: ['jebus', 'yevusi'],
    hebrew: 'יְבוּסִי',
    transliteration: 'Yevusi',
    strongs: ['H2983', 'H2982'],
    branch: 'ham',
    noahic_chain: ['Noah', 'Ham', 'Canaan', 'Jebus (Yevusi)'],
    scripture_attestation: {
      refs: ['Gen 10:16', 'Josh 15:63', 'Judg 19:10', '2 Sam 5:6-9'],
      summary: 'Listed under Canaan in Gen 10:16; fortified inhabitants of Jebus (Jerusalem) until David captured the stronghold of Zion.',
    },
    origin_coordinates: { lat: 31.774, lon: 35.236, label: 'Jebus / City of David ridge (Jerusalem)' },
    settlement_coordinates: [{ lat: 31.774, lon: 35.236, label: 'Jerusalem (City of David)' }],
    modern_area_proposal: {
      regions: ['Jerusalem (Israel / Palestinian Territories)'],
      scholarly_notes: 'Local Canaanite/highland urban population of Bronze/Iron Age Jerusalem (Urusalim in Amarna Letters); extra-biblical "Jebus" ethnonym is rare.',
      confidence: 'high',
    },
  },
  {
    id: 'philistines',
    name: 'Philistines',
    aliases: ['pelishti', 'caphtor', 'casluhim'],
    hebrew: 'פְּלִשְׁתִּי',
    transliteration: 'Pelishti',
    strongs: ['H6430', 'H6429'],
    branch: 'ham',
    noahic_chain: ['Noah', 'Ham', 'Mizraim', 'Casluhim / Caphtorim', 'Philistines'],
    scripture_attestation: {
      refs: ['Gen 10:14', 'Amos 9:7', 'Jer 47:4', '1 Sam 5:1-6:18'],
      summary: 'Gen 10:14 traces Philistines from Mizraim (via Casluhim, alongside Caphtorim), while Amos 9:7 and Jer 47:4 explicitly place their migration origin in Caphtor.',
    },
    origin_coordinates: { lat: 35.24, lon: 24.81, label: 'Aegean / Crete (Caphtor proposal)' },
    settlement_coordinates: [
      { lat: 31.5, lon: 34.47, label: 'Gaza' },
      { lat: 31.67, lon: 34.55, label: 'Ashkelon' },
      { lat: 31.8, lon: 34.65, label: 'Ashdod' },
      { lat: 31.78, lon: 34.85, label: 'Ekron (Tel Miqne)' },
      { lat: 31.7, lon: 34.84, label: 'Gath (Tell es-Safi)' },
    ],
    modern_area_proposal: {
      regions: ['Aegean / Crete (origin)', 'Southern Coastal Strip / Gaza & Shephelah (settlement)'],
      scholarly_notes: 'Aegean-origin Sea Peoples (Peleset in Egyptian Medinet Habu reliefs, c. 12th c. BCE) who settled the five-city coastal Pentapolis.',
      confidence: 'high',
    },
  },
  {
    id: 'cush',
    name: 'Cush (Nubia / Ethiopia)',
    aliases: ['cushites', 'nubia', 'ethiopia'],
    hebrew: 'כּוּשׁ',
    transliteration: 'Kush',
    strongs: ['H3568', 'H3569'],
    branch: 'ham',
    noahic_chain: ['Noah', 'Ham', 'Cush'],
    scripture_attestation: {
      refs: ['Gen 10:6-8', '2 Kgs 19:9', 'Isa 18:1', 'Acts 8:27'],
      summary: 'First listed son of Ham; associated both with Nile-valley Nubia south of Egypt (Tirhakah, Acts 8:27 Kandake) and via Nimrod with early Mesopotamian cities (Gen 10:8-12).',
    },
    origin_coordinates: { lat: 18.5, lon: 31.8, label: 'Upper Nile / Kingdom of Kush (Nubia)' },
    settlement_coordinates: [
      { lat: 18.53, lon: 31.83, label: 'Napata (Nubia)' },
      { lat: 16.94, lon: 33.75, label: 'Meroë' },
    ],
    modern_area_proposal: {
      regions: ['Northern Sudan (Nubia)', 'Southern Egypt', 'Horn of Africa (later usage)'],
      scholarly_notes: 'Primarily Egyptian Kꜣš (Nubia/Sudan); note scholarly discussion of whether Gen 2:13 / Gen 10:8 Nimrod also echoes Kassite (Kaššu) Mesopotamia.',
      confidence: 'high',
    },
  },
  {
    id: 'egypt',
    name: 'Egypt (Mizraim)',
    aliases: ['mizraim', 'mitsrayim', 'egyptians'],
    hebrew: 'מִצְרַיִם',
    greek: 'Αἴγυπτος',
    transliteration: 'Mitsrayim',
    strongs: ['H4714', 'H4713', 'G125'],
    branch: 'ham',
    noahic_chain: ['Noah', 'Ham', 'Mizraim (Egypt)'],
    scripture_attestation: {
      refs: ['Gen 10:6', 'Gen 10:13-14', 'Gen 12:10', 'Exod 1:1-14'],
      summary: 'Son of Ham in Gen 10:6 (dual form -ayim reflecting Upper & Lower Egypt); father of Ludim, Anamim, Lehabim, Naphtuhim, Pathrusim, Casluhim, and Caphtorim.',
    },
    origin_coordinates: { lat: 30.11, lon: 31.34, label: 'Nile Delta & Valley (Lower & Upper Egypt)' },
    settlement_coordinates: [
      { lat: 29.85, lon: 31.25, label: 'Memphis (Noph)' },
      { lat: 25.7, lon: 32.64, label: 'Thebes (No-Amon)' },
      { lat: 30.8, lon: 31.83, label: 'Goshen / Eastern Nile Delta' },
    ],
    modern_area_proposal: {
      regions: ['Egypt (Nile Valley & Delta)'],
      scholarly_notes: 'Directly corresponds to ancient Egypt (Akkadian Miṣri, Egyptian Ta-wy "Two Lands").',
      confidence: 'high',
    },
  },
  // Semitic Table of Nations
  {
    id: 'elam',
    name: 'Elam',
    aliases: ['elamites'],
    hebrew: 'עֵילָם',
    transliteration: 'Eilam',
    strongs: ['H5867'],
    branch: 'shem',
    noahic_chain: ['Noah', 'Shem', 'Elam'],
    scripture_attestation: {
      refs: ['Gen 10:22', 'Gen 14:1', 'Isa 21:2', 'Dan 8:2', 'Acts 2:9'],
      summary: 'First named son of Shem in Gen 10:22 (linked geographically rather than linguistically to Semites); kingdom of Chedorlaomer and site of Susa.',
    },
    origin_coordinates: { lat: 32.19, lon: 48.25, label: 'Susa / Khuzestan Plain' },
    settlement_coordinates: [{ lat: 32.19, lon: 48.25, label: 'Susa (Shushan)' }],
    modern_area_proposal: {
      regions: ['Southwestern Iran (Khuzestan & Fars highlands)'],
      scholarly_notes: 'Well-attested Elamite civilization (non-Semitic language isolate) centered at Susa and Anshan.',
      confidence: 'high',
    },
  },
  {
    id: 'asshur',
    name: 'Asshur (Assyria)',
    aliases: ['assyria', 'assyrians', 'ashur'],
    hebrew: 'אַשּׁוּר',
    transliteration: 'Ashur',
    strongs: ['H804'],
    branch: 'shem',
    noahic_chain: ['Noah', 'Shem', 'Asshur'],
    scripture_attestation: {
      refs: ['Gen 10:11', 'Gen 10:22', '2 Kgs 17:6', 'Isa 10:5', 'Nah 1:1'],
      summary: 'Son of Shem; also associated with the founding of Nineveh, Rehoboth-Ir, Calah, and Resen along the Tigris (Gen 10:11).',
    },
    origin_coordinates: { lat: 35.45, lon: 43.26, label: 'Ashur on the Tigris' },
    settlement_coordinates: [
      { lat: 35.45, lon: 43.26, label: 'Ashur (Qalat Sherqat)' },
      { lat: 36.36, lon: 43.15, label: 'Nineveh (Mosul)' },
      { lat: 36.1, lon: 43.33, label: 'Calah (Nimrud)' },
    ],
    modern_area_proposal: {
      regions: ['Northern Iraq (Upper Tigris)', 'Northeastern Syria'],
      scholarly_notes: 'Directly attested East Semitic Assyrian heartland centered at Ashur and Nineveh.',
      confidence: 'high',
    },
  },
  {
    id: 'eber',
    name: 'Eber (Hebrews)',
    aliases: ['hebrews', 'ivri'],
    hebrew: 'עֵבֶר',
    transliteration: 'Ever',
    strongs: ['H5677', 'H5680'],
    branch: 'shem',
    noahic_chain: ['Noah', 'Shem', 'Arpachshad', 'Shelah', 'Eber'],
    scripture_attestation: {
      refs: ['Gen 10:21', 'Gen 10:24-25', 'Gen 11:14-17', 'Gen 14:13', 'Num 24:24'],
      summary: 'Great-grandson of Shem; Gen 10:21 titles Shem "father of all the children of Eber"; ancestor of Peleg (Abrahamic line) and Joktan (Arabian peoples).',
    },
    origin_coordinates: { lat: 31.5, lon: 45.8, label: 'Lower / Middle Euphrates ("across the river")' },
    settlement_coordinates: [
      { lat: 30.96, lon: 46.1, label: 'Ur / Lower Euphrates' },
      { lat: 36.86, lon: 39.03, label: 'Harran (Upper Euphrates)' },
    ],
    modern_area_proposal: {
      regions: ['Mesopotamia (Euphrates basin)', 'Arabian Peninsula (Joktanite branch)', 'Levant (Abrahamic branch)'],
      scholarly_notes: 'Root ʿ-b-r means "to cross over / region beyond (the river)"; scholars debate linkage with 2nd-millennium ANE social term Habiru/Apiru.',
      confidence: 'moderate',
    },
  },
  {
    id: 'aram',
    name: 'Aram (Arameans / Syria)',
    aliases: ['arameans', 'syria', 'syrians'],
    hebrew: 'אֲרָם',
    transliteration: 'Aram',
    strongs: ['H758', 'H761'],
    branch: 'shem',
    noahic_chain: ['Noah', 'Shem', 'Aram'],
    scripture_attestation: {
      refs: ['Gen 10:22-23', 'Gen 25:20', 'Deut 26:5', '2 Sam 8:5', '2 Kgs 5:1'],
      summary: 'Son of Shem; father of Uz, Hul, Gether, and Mash; Aramean polities stretched from Aram-Naharaim (Upper Mesopotamia) to Aram-Damascus.',
    },
    origin_coordinates: { lat: 35.8, lon: 39.0, label: 'Aram-Naharaim (Upper Euphrates / Khabur)' },
    settlement_coordinates: [
      { lat: 33.51, lon: 36.29, label: 'Aram-Damascus' },
      { lat: 36.86, lon: 39.03, label: 'Paddan-Aram / Harran' },
    ],
    modern_area_proposal: {
      regions: ['Syria', 'Southeastern Turkey', 'Upper Iraq'],
      scholarly_notes: 'Northwest Semitic Aramean tribal states attested from the late 2nd–1st millennium BCE (Damascus, Hamath, Bit-Adini).',
      confidence: 'high',
    },
  },
  // Japhethite Table of Nations
  {
    id: 'javan',
    name: 'Javan (Ionia / Greece)',
    aliases: ['greece', 'ionia', 'yavan'],
    hebrew: 'יָוָן',
    transliteration: 'Yavan',
    strongs: ['H3120'],
    branch: 'japheth',
    noahic_chain: ['Noah', 'Japheth', 'Javan'],
    scripture_attestation: {
      refs: ['Gen 10:2', 'Gen 10:4-5', 'Isa 66:19', 'Ezek 27:13', 'Dan 8:21', 'Zech 9:13'],
      summary: 'Son of Japheth; father of Elishah, Tarshish, Kittim, and Dodanim/Rodanim across the Mediterranean "coastlands" (Gen 10:5).',
    },
    origin_coordinates: { lat: 38.0, lon: 25.0, label: 'Aegean Basin / Ionia & Greece' },
    settlement_coordinates: [
      { lat: 37.97, lon: 23.72, label: 'Athens / Mainland Greece' },
      { lat: 37.94, lon: 27.34, label: 'Ionian Coast (Western Anatolia)' },
    ],
    modern_area_proposal: {
      regions: ['Greece', 'Aegean Islands', 'Western Turkish Coast (Ionia)'],
      scholarly_notes: 'Directly cognate with Greek Iaones (Ionians), Old Persian Yauna, and Assyrian Yamanu.',
      confidence: 'high',
    },
  },
  {
    id: 'gomer',
    name: 'Gomer',
    aliases: ['cimmerians'],
    hebrew: 'גֹּמֶר',
    transliteration: 'Gomer',
    strongs: ['H1586'],
    branch: 'japheth',
    noahic_chain: ['Noah', 'Japheth', 'Gomer'],
    scripture_attestation: {
      refs: ['Gen 10:2-3', 'Ezek 38:6'],
      summary: 'First named son of Japheth; father of Ashkenaz, Riphath, and Togarmah; paired with Beth-togarmah from the "uttermost parts of the north" in Ezek 38:6.',
    },
    origin_coordinates: { lat: 45.0, lon: 34.0, label: 'Pontic Steppe / Northern Black Sea' },
    settlement_coordinates: [{ lat: 39.7, lon: 34.8, label: 'Central/Northern Anatolia (Iron Age raids)' }],
    modern_area_proposal: {
      regions: ['Crimea / Black Sea Steppe', 'Central & Eastern Turkey (Anatolia)'],
      scholarly_notes: 'Widely identified with Assyrian Gimirraya / Greek Kimmerioi (Cimmerians) who moved from north of the Caucasus into Anatolia in the 8th–7th c. BCE.',
      confidence: 'high',
    },
  },
  {
    id: 'magog',
    name: 'Magog',
    aliases: ['gog and magog'],
    hebrew: 'מָגוֹג',
    greek: 'Μαγώγ',
    transliteration: 'Magog',
    strongs: ['H4031', 'G3098'],
    branch: 'japheth',
    noahic_chain: ['Noah', 'Japheth', 'Magog'],
    scripture_attestation: {
      refs: ['Gen 10:2', 'Ezek 38:2', 'Ezek 39:6', 'Rev 20:8'],
      summary: 'Second named son of Japheth; appears in Ezekiel 38–39 as the northern territory associated with Gog ("of the land of Magog") and in Rev 20:8 symbolically.',
    },
    origin_coordinates: { lat: 42.5, lon: 43.0, label: 'Transcaucasia / Northern Steppe frontier (proposed)' },
    settlement_coordinates: [],
    modern_area_proposal: {
      regions: ['Northern Anatolia / Caucasus / Pontic-Caspian Steppe (debated)'],
      scholarly_notes: 'Proposals include Scythians north of the Black/Caucasus mountains (Josephus) or Lydia (Gugu/Gyges) in Anatolia; exact geographic identification remains debated.',
      confidence: 'debated',
    },
  },
  {
    id: 'madai',
    name: 'Madai (Medes / Media)',
    aliases: ['medes', 'media'],
    hebrew: 'מָדַי',
    transliteration: 'Madai',
    strongs: ['H4074'],
    branch: 'japheth',
    noahic_chain: ['Noah', 'Japheth', 'Madai'],
    scripture_attestation: {
      refs: ['Gen 10:2', '2 Kgs 17:6', 'Isa 13:17', 'Esth 1:3', 'Dan 5:28'],
      summary: 'Third named son of Japheth; ancestor/eponym of the Medes in northwestern Iran, where Israelite exiles were resettled and who later partnered with Persia.',
    },
    origin_coordinates: { lat: 34.8, lon: 48.51, label: 'Ecbatana / Zagros Highlands (Media)' },
    settlement_coordinates: [{ lat: 34.8, lon: 48.51, label: 'Ecbatana (Hamadan)' }],
    modern_area_proposal: {
      regions: ['Northwestern Iran (Hamadan, Zagros Mountains)'],
      scholarly_notes: 'Directly attested in Assyrian (Madaya) and Achaemenid Persian (Māda) inscriptions.',
      confidence: 'high',
    },
  },
  {
    id: 'tarshish',
    name: 'Tarshish',
    aliases: ['tartessos'],
    hebrew: 'תַּרְשִׁישׁ',
    transliteration: 'Tarshish',
    strongs: ['H8659'],
    branch: 'japheth',
    noahic_chain: ['Noah', 'Japheth', 'Javan', 'Tarshish'],
    scripture_attestation: {
      refs: ['Gen 10:4', '1 Kgs 10:22', 'Isa 23:1', 'Ezek 27:12', 'Jonah 1:3'],
      summary: 'Son of Javan; distant western maritime trading port famed for silver, iron, tin, and lead, and destination of Jonah\'s flight from Joppa.',
    },
    origin_coordinates: { lat: 36.8, lon: -6.35, label: 'Southern Iberia / Tartessos (primary proposal)' },
    settlement_coordinates: [
      { lat: 36.8, lon: -6.35, label: 'Tartessos (Guadalquivir / Huelva, Spain)' },
      { lat: 39.2, lon: 8.5, label: 'Sardinia (Tharros alternative)' },
    ],
    modern_area_proposal: {
      regions: ['Southern Spain (Andalusia / Tartessos)', 'Sardinia (Nora Stele)', 'Cilicia (Tarsus, less favored)'],
      scholarly_notes: 'Most historians favor Phoenician western Mediterranean silver-mining ports (Tartessos in Spain or Sardinia); "ships of Tarshish" also became a vessel class.',
      confidence: 'debated',
    },
  },
  {
    id: 'kittim',
    name: 'Kittim',
    aliases: ['chittim', 'cyprus', 'kition'],
    hebrew: 'כִּתִּים',
    transliteration: 'Kittim',
    strongs: ['H3794'],
    branch: 'japheth',
    noahic_chain: ['Noah', 'Japheth', 'Javan', 'Kittim'],
    scripture_attestation: {
      refs: ['Gen 10:4', 'Num 24:24', 'Isa 23:1', 'Ezek 27:6', 'Dan 11:30'],
      summary: 'Son of Javan; eastern Mediterranean maritime coastlands/islanders (later broadened in Daniel 11:30 and Qumran texts to western Mediterranean / Roman fleets).',
    },
    origin_coordinates: { lat: 34.92, lon: 33.63, label: 'Kition / Larnaca (Cyprus)' },
    settlement_coordinates: [{ lat: 34.92, lon: 33.63, label: 'Kition (Cyprus)' }],
    modern_area_proposal: {
      regions: ['Cyprus (originally Kition)', 'Later broader Mediterranean / Rome (Dan 11:30)'],
      scholarly_notes: 'Originally the Phoenician colony of Kition (modern Larnaca) on Cyprus; semantic range widened in Hellenistic-era literature.',
      confidence: 'high',
    },
  },
  // Twelve Tribes of Israel
  {
    id: 'reuben_tribe', name: 'Tribe of Reuben', aliases: ['reuben', 'reubenites'], hebrew: 'רְאוּבֵן', strongs: ['H7205', 'H7206'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Reuben'],
    scripture_attestation: { refs: ['Gen 29:32', 'Num 32:1-33', 'Josh 13:15-23'], summary: 'Firstborn son of Jacob & Leah; settled Transjordan plateau north of the Arnon.' },
    origin_coordinates: { lat: 31.65, lon: 35.75, label: 'Transjordan Plateau (Medeba / Heshbon)' },
    settlement_coordinates: [{ lat: 31.72, lon: 35.79, label: 'Medeba / Reubenite tableland' }],
    modern_area_proposal: { regions: ['Central Jordan (Madaba Governorate)'], scholarly_notes: 'Eastern Jordan valley and Moabite tableland north of Wadi Mujib (Arnon).', confidence: 'high' },
  },
  {
    id: 'simeon_tribe', name: 'Tribe of Simeon', aliases: ['simeon', 'simeonites'], hebrew: 'שִׁמְעוֹן', strongs: ['H8095', 'H8099'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Simeon'],
    scripture_attestation: { refs: ['Gen 29:33', 'Gen 49:5-7', 'Josh 19:1-9'], summary: 'Second son of Jacob & Leah; allotted towns within Judah\'s southern Negev inheritance (Beersheba).' },
    origin_coordinates: { lat: 31.24, lon: 34.84, label: 'Negev / Beersheba Basin' },
    settlement_coordinates: [{ lat: 31.245, lon: 34.84, label: 'Tel Beersheba' }],
    modern_area_proposal: { regions: ['Southern Israel (Northern Negev)'], scholarly_notes: 'Scattered within Judah\'s Negev perimeter per Gen 49:7 and Josh 19:1.', confidence: 'high' },
  },
  {
    id: 'levi_tribe', name: 'Tribe of Levi', aliases: ['levi', 'levites'], hebrew: 'לֵוִי', strongs: ['H3878', 'H3881'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Levi'],
    scripture_attestation: { refs: ['Gen 29:34', 'Num 3:5-13', 'Num 35:1-8', 'Josh 21:1-42'], summary: 'Third son of Jacob & Leah; set apart for sanctuary ministry with no contiguous territory, receiving 48 Levitical/refuge cities across Israel.' },
    origin_coordinates: { lat: 31.77, lon: 35.23, label: 'Dispersed across 48 Levitical cities & Sanctuary' },
    settlement_coordinates: [{ lat: 31.52, lon: 35.11, label: 'Hebron (Priestly/Refuge City)' }, { lat: 32.21, lon: 35.28, label: 'Shechem (Refuge City)' }],
    modern_area_proposal: { regions: ['Dispersed across Israel, West Bank, and Jordan'], scholarly_notes: 'Non-territorial priestly tribe distributed across all tribal allotments.', confidence: 'high' },
  },
  {
    id: 'judah_tribe', name: 'Tribe of Judah', aliases: ['judah', 'judea', 'judahites'], hebrew: 'יְהוּדָה', greek: 'Ἰούδας', strongs: ['H3063', 'G2455'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Judah'],
    scripture_attestation: { refs: ['Gen 29:35', 'Gen 49:8-12', 'Josh 15:1-63'], summary: 'Fourth son of Jacob & Leah; royal Davidic tribe occupying the Judean hills, Shephelah, wilderness, and Negev.' },
    origin_coordinates: { lat: 31.53, lon: 35.1, label: 'Judean Hill Country (Hebron – Bethlehem)' },
    settlement_coordinates: [{ lat: 31.52, lon: 35.11, label: 'Hebron' }, { lat: 31.71, lon: 35.2, label: 'Bethlehem' }],
    modern_area_proposal: { regions: ['Southern West Bank (Judean Hills)', 'Southern Israel'], scholarly_notes: 'Kingdom of Judah / Yehud / Judea.', confidence: 'high' },
  },
  {
    id: 'dan_tribe', name: 'Tribe of Dan', aliases: ['dan', 'danites'], hebrew: 'דָּן', strongs: ['H1835', 'H1839'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Dan'],
    scripture_attestation: { refs: ['Gen 30:6', 'Josh 19:40-48', 'Judg 18:1-31'], summary: 'Fifth son of Jacob (by Bilhah); originally allotted coastal plain near Joppa/Aijalon before migrating north to Laish/Dan.' },
    origin_coordinates: { lat: 31.84, lon: 34.99, label: 'Shephelah / Coastal Plain (Zorah & Eshtaol)' },
    settlement_coordinates: [{ lat: 33.25, lon: 35.65, label: 'Tel Dan (Laish, Upper Galilee)' }],
    modern_area_proposal: { regions: ['Central Coastal Israel (initial)', 'Upper Galilee / Tel Dan (later)'], scholarly_notes: 'Northern anchor of the proverbial phrase "from Dan to Beersheba."', confidence: 'high' },
  },
  {
    id: 'naphtali_tribe', name: 'Tribe of Naphtali', aliases: ['naphtali'], hebrew: 'נַפְתָּלִי', strongs: ['H5321'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Naphtali'],
    scripture_attestation: { refs: ['Gen 30:8', 'Josh 19:32-39', 'Isa 9:1', 'Matt 4:13-15'], summary: 'Sixth son of Jacob (by Bilhah); inherited eastern Upper/Lower Galilee along the western shore of the Sea of Galilee.' },
    origin_coordinates: { lat: 33.02, lon: 35.56, label: 'Eastern Galilee (Hazor / Kedesh)' },
    settlement_coordinates: [{ lat: 33.02, lon: 35.57, label: 'Hazor' }, { lat: 32.88, lon: 35.58, label: 'Capernaum' }],
    modern_area_proposal: { regions: ['Northern Israel (Eastern Galilee)'], scholarly_notes: 'Galilean highlands and northwest Kinneret shore.', confidence: 'high' },
  },
  {
    id: 'gad_tribe', name: 'Tribe of Gad', aliases: ['gad', 'gadites'], hebrew: 'גָּד', strongs: ['H1410', 'H1425'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Gad'],
    scripture_attestation: { refs: ['Gen 30:11', 'Num 32:1-36', 'Josh 13:24-28'], summary: 'Seventh son of Jacob (by Zilpah); settled Gilead and the eastern Jordan valley.' },
    origin_coordinates: { lat: 32.15, lon: 35.7, label: 'Central Gilead (East of Jordan)' },
    settlement_coordinates: [{ lat: 32.19, lon: 35.62, label: 'Succoth / Jabbok Valley' }],
    modern_area_proposal: { regions: ['Northwestern Jordan (Balqa & Ajloun / Gilead)'], scholarly_notes: 'Mentioned on the 9th-c. BCE Mesha Stele ("men of Gad dwelt in Ataroth from of old").', confidence: 'high' },
  },
  {
    id: 'asher_tribe', name: 'Tribe of Asher', aliases: ['asher', 'asherites'], hebrew: 'אָשֵׁר', strongs: ['H836', 'H843'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Asher'],
    scripture_attestation: { refs: ['Gen 30:13', 'Josh 19:24-31', 'Judg 5:17', 'Luke 2:36'], summary: 'Eighth son of Jacob (by Zilpah); inherited fertile Western Galilee coast from Carmel toward Tyre/Sidon.' },
    origin_coordinates: { lat: 32.92, lon: 35.08, label: 'Western Galilee Coast (Acco Plain)' },
    settlement_coordinates: [{ lat: 32.92, lon: 35.09, label: 'Acco / Akko' }],
    modern_area_proposal: { regions: ['Northwestern Israel (Western Galilee)', 'Southern Lebanon coast'], scholarly_notes: 'Mediterranean coastal strip north of Mount Carmel.', confidence: 'high' },
  },
  {
    id: 'issachar_tribe', name: 'Tribe of Issachar', aliases: ['issachar'], hebrew: 'יִשָּׂשכָר', strongs: ['H3485'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Issachar'],
    scripture_attestation: { refs: ['Gen 30:18', 'Josh 19:17-23', '1 Chr 12:32'], summary: 'Ninth son of Jacob (by Leah); held the eastern Jezreel Valley and Lower Galilee plateau toward the Jordan.' },
    origin_coordinates: { lat: 32.6, lon: 35.38, label: 'Eastern Jezreel Valley (Mount Tabor – Jezreel)' },
    settlement_coordinates: [{ lat: 32.69, lon: 35.39, label: 'Mount Tabor' }],
    modern_area_proposal: { regions: ['Northern Israel (Eastern Jezreel / Harod Valley)'], scholarly_notes: 'Fertile agricultural corridor between Mount Tabor and Beth-shean.', confidence: 'high' },
  },
  {
    id: 'zebulun_tribe', name: 'Tribe of Zebulun', aliases: ['zebulun'], hebrew: 'זְבוּלֻן', strongs: ['H2074'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Zebulun'],
    scripture_attestation: { refs: ['Gen 30:20', 'Josh 19:10-16', 'Isa 9:1', 'Matt 4:13-15'], summary: 'Tenth son of Jacob (by Leah); inherited Lower Galilee hills bordering the Jezreel Valley (Nazareth/Bethlehem of Galilee).' },
    origin_coordinates: { lat: 32.72, lon: 35.25, label: 'Lower Galilee (Nazareth / Rimmon)' },
    settlement_coordinates: [{ lat: 32.7, lon: 35.3, label: 'Nazareth ridge (Lower Galilee)' }],
    modern_area_proposal: { regions: ['Northern Israel (Lower Galilee)'], scholarly_notes: 'Lower Galilean valleys between Acco plain and Tabor.', confidence: 'high' },
  },
  {
    id: 'ephraim_tribe', name: 'Tribe of Ephraim (House of Joseph)', aliases: ['ephraim', 'joseph'], hebrew: 'אֶפְרַיִם', strongs: ['H669', 'H3130'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Joseph', 'Ephraim'],
    scripture_attestation: { refs: ['Gen 48:5-20', 'Josh 16:1-10', '1 Kgs 12:25'], summary: 'Younger son of Joseph elevated by Jacob; central Samarian hill country including Shiloh and Bethel.' },
    origin_coordinates: { lat: 32.05, lon: 35.29, label: 'Central Hill Country (Shiloh)' },
    settlement_coordinates: [{ lat: 32.055, lon: 35.29, label: 'Shiloh' }, { lat: 31.93, lon: 35.22, label: 'Bethel' }],
    modern_area_proposal: { regions: ['Central West Bank (Southern Samaria)'], scholarly_notes: 'Core of the Northern Kingdom (frequently used metonymically for all Israel in Hosea/Isaiah).', confidence: 'high' },
  },
  {
    id: 'manasseh_tribe', name: 'Tribe of Manasseh (House of Joseph)', aliases: ['manasseh', 'manassites'], hebrew: 'מְנַשֶּׁה', strongs: ['H4519'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Joseph', 'Manasseh'],
    scripture_attestation: { refs: ['Gen 48:5-20', 'Josh 17:1-18', 'Num 32:39-42'], summary: 'Firstborn son of Joseph; split across Cisjordan (Shechem/Samaria/Megiddo) and Transjordan (northern Gilead/Bashan).' },
    origin_coordinates: { lat: 32.27, lon: 35.19, label: 'Northern Samaria & Bashan' },
    settlement_coordinates: [{ lat: 32.27, lon: 35.19, label: 'Samaria' }, { lat: 32.85, lon: 35.85, label: 'Bashan (Transjordan half-tribe)' }],
    modern_area_proposal: { regions: ['Northern West Bank (Samaria)', 'Golan / Northern Jordan & Southern Syria'], scholarly_notes: 'Largest tribal territory spanning both sides of the Jordan.', confidence: 'high' },
  },
  {
    id: 'benjamin_tribe', name: 'Tribe of Benjamin', aliases: ['benjamin', 'benjaminites'], hebrew: 'בִּנְיָמִין', greek: 'Βενιαμίν', strongs: ['H1144', 'G958'], branch: 'israel_tribe',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Jacob (Israel)', 'Benjamin'],
    scripture_attestation: { refs: ['Gen 35:18', 'Josh 18:11-28', '1 Sam 9:1', 'Phil 3:5'], summary: 'Twelfth son of Jacob (by Rachel); strategic central highland corridor between Judah and Ephraim (Jericho, Bethel, Gibeon, Gibeah).' },
    origin_coordinates: { lat: 31.85, lon: 35.22, label: 'Benjaminite Plateau (Gibeah / Gibeon / Jericho)' },
    settlement_coordinates: [{ lat: 31.85, lon: 35.18, label: 'Gibeon' }, { lat: 31.87, lon: 35.44, label: 'Jericho' }],
    modern_area_proposal: { regions: ['Central West Bank / Northern Jerusalem corridor'], scholarly_notes: 'Tribe of King Saul and the Apostle Paul.', confidence: 'high' },
  },
  // Abrahamic Cousins & Post-Exilic
  {
    id: 'edom', name: 'Edom (Idumea)', aliases: ['edomites', 'esau', 'seir', 'idumea'], hebrew: 'אֱדוֹם', strongs: ['H123', 'H130'], branch: 'abrahamic_cousin',
    noahic_chain: ['Noah', 'Shem', 'Abraham', 'Isaac', 'Esau (Edom)'],
    scripture_attestation: { refs: ['Gen 25:30', 'Gen 36:1-43', 'Num 20:14-21', 'Obad 1:1'], summary: 'Descended from Jacob\'s twin brother Esau; settled Mount Seir south of the Dead Sea before later migrating into southern Judah (Idumea).' },
    origin_coordinates: { lat: 30.33, lon: 35.44, label: 'Mount Seir / Bozrah & Petra highlands' },
    settlement_coordinates: [{ lat: 30.8, lon: 35.61, label: 'Bozrah (Buseirah)' }, { lat: 30.33, lon: 35.44, label: 'Sela / Petra' }],
    modern_area_proposal: { regions: ['Southern Jordan (Shara mountains / Edom)', 'Northern Negev (Hellenistic Idumea)'], scholarly_notes: 'Iron Age kingdom of Edom attested in Assyrian records (Udumu) and excavations at Buseirah.', confidence: 'high' },
  },
  {
    id: 'moab', name: 'Moab', aliases: ['moabites'], hebrew: 'מוֹאָב', strongs: ['H4124', 'H4125'], branch: 'abrahamic_cousin',
    noahic_chain: ['Noah', 'Shem', 'Terah', 'Haran', 'Lot', 'Moab'],
    scripture_attestation: { refs: ['Gen 19:37', 'Num 22:1', 'Ruth 1:1-4', '2 Kgs 3:4-27'], summary: 'Descended from Abraham\'s nephew Lot; occupied the high plateau east of the Dead Sea.' },
    origin_coordinates: { lat: 31.35, lon: 35.75, label: 'Moabite Plateau (Dibon / Kir-hareseth)' },
    settlement_coordinates: [{ lat: 31.5, lon: 35.78, label: 'Dibon (Dhiban)' }, { lat: 31.18, lon: 35.7, label: 'Kir-hareseth (Karak)' }],
    modern_area_proposal: { regions: ['West-Central Jordan (Karak & Madaba)'], scholarly_notes: 'At length attested by the 9th-c. BCE Mesha Stele discovered at Dhiban (Dibon).', confidence: 'high' },
  },
  {
    id: 'ammon', name: 'Ammon', aliases: ['ammonites', 'ben-ammi'], hebrew: 'עַמּוֹן', strongs: ['H5983', 'H5984'], branch: 'abrahamic_cousin',
    noahic_chain: ['Noah', 'Shem', 'Terah', 'Haran', 'Lot', 'Ben-Ammi (Ammon)'],
    scripture_attestation: { refs: ['Gen 19:38', 'Deut 2:19', 'Judg 11:4-33', '2 Sam 10:1-14'], summary: 'Descended from Abraham\'s nephew Lot via Ben-Ammi; centered at Rabbah (Rabbath-ammon) along the upper Jabbok.' },
    origin_coordinates: { lat: 31.95, lon: 35.93, label: 'Rabbath-Ammon (Amman Citadel)' },
    settlement_coordinates: [{ lat: 31.954, lon: 35.935, label: 'Rabbah / Philadelphia (Amman)' }],
    modern_area_proposal: { regions: ['North-Central Jordan (Amman plateau)'], scholarly_notes: 'Assyrian Bit-Amman; Ammonite Citadel inscription and Tell Siran bottle confirm language & capital.', confidence: 'high' },
  },
  {
    id: 'samaritans', name: 'Samaritans', aliases: ['samaria', 'shomeronim'], hebrew: 'שֹׁמְרֹנִים', greek: 'Σαμαρίτης', strongs: ['H8115', 'H8111', 'G4541'], branch: 'post_exilic',
    noahic_chain: ['Northern Israelite remnants (Ephraim/Manasseh) & Assyrian-resettled peoples (2 Kgs 17:24)'],
    scripture_attestation: { refs: ['2 Kgs 17:24-41', 'Ezra 4:1-10', 'John 4:9-20', 'Luke 10:33', 'Acts 8:5'], summary: '2 Kgs 17 describes Assyrian deportation and foreign resettlement in Samaria; Samaritan tradition itself claims direct descent from Ephraim, Manasseh, and Levi centered on Mount Gerizim.' },
    origin_coordinates: { lat: 32.2, lon: 35.27, label: 'Mount Gerizim & Shechem (Samaria)' },
    settlement_coordinates: [{ lat: 32.2, lon: 35.27, label: 'Mount Gerizim' }, { lat: 32.27, lon: 35.19, label: 'Sebaste / Samaria' }],
    modern_area_proposal: { regions: ['Northern West Bank (Nablus / Mt. Gerizim) & Holon (Israel)'], scholarly_notes: 'Epistemic tension: Judean polemic (2 Kgs 17; Josephus) stresses foreign Cuthean origins, while archaeology at Mt. Gerizim and Samaritan Pentateuch attest Yahwistic northern continuity.', confidence: 'high' },
  },
];

export function queryMcpTribeLineage(params: {
  query?: string;
  strongs?: string;
  branch?: string;
  limit?: number;
}): Record<string, unknown> {
  const q = (params.query ?? '').trim().toLowerCase();
  const normStrongs = normalizeStrongsCode(params.strongs);
  const branchFilter = (params.branch ?? '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(30, Math.trunc(params.limit ?? 12)));

  const filtered = TRIBE_LINEAGES.filter((item) => {
    if (branchFilter) {
      const chainStr = item.noahic_chain.join(' ').toLowerCase();
      if (item.branch !== branchFilter && !item.branch.includes(branchFilter) && !chainStr.includes(branchFilter)) {
        return false;
      }
    }
    if (normStrongs) {
      const matchS = item.strongs.some((s) => normalizeStrongsCode(s) === normStrongs);
      if (!matchS) return false;
    }
    if (q) {
      const hit =
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (item.transliteration?.toLowerCase().includes(q) ?? false) ||
        (item.hebrew?.includes(params.query ?? '') ?? false) ||
        (item.greek?.includes(params.query ?? '') ?? false) ||
        item.noahic_chain.some((c) => c.toLowerCase().includes(q)) ||
        item.modern_area_proposal.regions.some((r) => r.toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  });

  return {
    status: filtered.length > 0 ? 'ok' : 'not_found',
    total_matches: filtered.length,
    matches: filtered.slice(0, limit),
    epistemic_note:
      'Scripture-attested facts (noahic_chain, scripture_attestation) are separated from modern_area_proposal. Genesis 10 uses ancient kinship idiom for peoples and eponyms; modern geographic proposals carry explicit scholarly confidence.',
  };
}

// === @section:sacred-architecture ===
export type ArchitecturePlanId = 'tabernacle' | 'first_temple' | 'second_temple' | 'jerusalem_gates' | 'ezekiel_temple';

interface ArchitectureElement {
  id: string;
  plan_id: ArchitecturePlanId;
  name: string;
  hebrew?: string;
  greek?: string;
  transliteration?: string;
  strongs: string[];
  zone: string;
  position: string;
  compass_orientation: string;
  dimensions_cubits: string;
  elevation_note?: string;
  summary: string;
  historical_note: string;
  scripture_refs: string[];
}

interface ArchitecturePlan {
  id: ArchitecturePlanId;
  title: string;
  era: string;
  orientation: string;
  epistemic_note: string;
  topographic_elevation_notes?: string;
  elements: ArchitectureElement[];
}

const ARCHITECTURE_PLANS: Record<ArchitecturePlanId, ArchitecturePlan> = {
  tabernacle: {
    id: 'tabernacle',
    title: 'Wilderness Tabernacle (Mishkan)',
    era: 'Exodus – Judges (Exod 25–40; Heb 9:1–5)',
    orientation: 'East-to-West sacred progression: Courtyard Gate (East) -> Altar -> Laver -> Holy Place -> Most Holy Place (West)',
    epistemic_note: 'Derived directly from Exodus 25–40 and Leviticus 16 (dimensions in ancient cubits, ≈ 45 cm).',
    elements: [
      { id: 'outer_courtyard', plan_id: 'tabernacle', name: 'Outer Courtyard', hebrew: 'חָצֵר', transliteration: 'Chatser', strongs: ['H2691'], zone: 'Outer Perimeter', position: 'Enclosing the Tent of Meeting', compass_orientation: 'Long axis East–West', dimensions_cubits: '100 × 50 cubits; linen curtains 5 cubits high', summary: 'Rectangular linen-fenced sacred enclosure around the Tabernacle.', historical_note: 'Portable bronze-socketed acacia pillar enclosure (Exod 27:9–18).', scripture_refs: ['Exod 27:9-18', 'Exod 38:9-20'] },
      { id: 'courtyard_gate', plan_id: 'tabernacle', name: 'Courtyard Gate (East Screen)', hebrew: 'שַׁעַר הֶחָצֵר', strongs: ['H8179', 'H4539'], zone: 'East Entrance', position: 'Center of eastern courtyard wall', compass_orientation: 'East', dimensions_cubits: '20 cubits wide × 5 cubits high', summary: 'Single embroidered entrance screen facing sunrise.', historical_note: 'Establishes the inward east-to-west approach.', scripture_refs: ['Exod 27:16', 'Exod 38:18'] },
      { id: 'bronze_altar', plan_id: 'tabernacle', name: 'Bronze Altar of Burnt Offering', hebrew: 'מִזְבַּח הָעֹלָה', strongs: ['H4196', 'H5178'], zone: 'East Courtyard', position: 'Inside the East gate before the Tent', compass_orientation: 'East of Laver & Tent', dimensions_cubits: '5 × 5 × 3 cubits', summary: 'Four-horned bronze-overlaid acacia altar for daily and festival sacrifices.', historical_note: 'Portable hollow frame with grating and carrying poles.', scripture_refs: ['Exod 27:1-8', 'Exod 38:1-7', 'Lev 1:5'] },
      { id: 'bronze_laver', plan_id: 'tabernacle', name: 'Bronze Laver', hebrew: 'כִּיּוֹר', strongs: ['H3595'], zone: 'Courtyard', position: 'Between Bronze Altar and Tent of Meeting', compass_orientation: 'Center axis', dimensions_cubits: 'No cubit dimensions recorded in Torah', summary: 'Ritual washbasin for priestly hand-and-foot washing before sanctuary entry.', historical_note: 'Cast from bronze mirrors of serving women (Exod 38:8).', scripture_refs: ['Exod 30:17-21', 'Exod 38:8', 'Exod 40:30'] },
      { id: 'tent_holy_place', plan_id: 'tabernacle', name: 'Holy Place (Tent of Meeting)', hebrew: 'קֹדֶשׁ / אֹהֶל מוֹעֵד', strongs: ['H6944', 'H168', 'H4908'], zone: 'Sanctuary Outer Chamber', position: 'Eastern 2/3 of the 30 × 10 cubit Tent', compass_orientation: 'Entered from East', dimensions_cubits: '20 × 10 × 10 cubits', summary: 'Gold-plated board chamber housing Showbread, Menorah, and Incense Altar.', historical_note: 'Covered by four textile/skin layers (Exod 26:1–14).', scripture_refs: ['Exod 26:33', 'Exod 40:22', 'Heb 9:2'] },
      { id: 'table_showbread', plan_id: 'tabernacle', name: 'Table of Showbread', hebrew: 'שֻׁלְחַן הַפָּנִים', strongs: ['H7979', 'H3899'], zone: 'Holy Place', position: 'North wall of Holy Place', compass_orientation: 'North', dimensions_cubits: '2 × 1 × 1.5 cubits', summary: 'Gold-overlaid acacia table bearing twelve loaves renewed each Sabbath.', historical_note: 'Illuminated across the room by the Menorah on the South.', scripture_refs: ['Exod 25:23-30', 'Exod 26:35', 'Lev 24:5-9'] },
      { id: 'menorah', plan_id: 'tabernacle', name: 'Golden Lampstand (Menorah)', hebrew: 'מְנוֹרָה', strongs: ['H4501'], zone: 'Holy Place', position: 'South wall opposite the Showbread table', compass_orientation: 'South', dimensions_cubits: '1 talent (~34 kg) hammered gold; no cubit height stated', summary: 'Seven-branched almond-blossom golden lampstand burning pure olive oil.', historical_note: 'Lamps positioned to shine northward across the Holy Place.', scripture_refs: ['Exod 25:31-40', 'Exod 37:17-24', 'Num 8:1-4'] },
      { id: 'incense_altar', plan_id: 'tabernacle', name: 'Golden Altar of Incense', hebrew: 'מִזְבַּח הַקְּטֹרֶת', strongs: ['H7004', 'H4196'], zone: 'Holy Place', position: 'Directly East of (before) the Inner Veil', compass_orientation: 'West end of Holy Place', dimensions_cubits: '1 × 1 × 2 cubits', summary: 'Horned golden altar for morning/evening sacred incense.', historical_note: 'No burnt offerings; horns received Yom Kippur blood once yearly.', scripture_refs: ['Exod 30:1-10', 'Lev 16:18'] },
      { id: 'veil', plan_id: 'tabernacle', name: 'Inner Veil (Parokhet)', hebrew: 'פָּרֹכֶת', strongs: ['H6532'], zone: 'Sanctuary Partition', position: 'Separating Holy Place and Most Holy Place', compass_orientation: 'North–South partition', dimensions_cubits: '10 × 10 cubits on 4 golden pillars', summary: 'Cherubim-woven curtain separating inner sanctuary.', historical_note: 'Crossed only by High Priest on Yom Kippur.', scripture_refs: ['Exod 26:31-33', 'Lev 16:2', 'Heb 9:3'] },
      { id: 'tent_most_holy', plan_id: 'tabernacle', name: 'Most Holy Place & Ark of the Covenant', hebrew: 'קֹדֶשׁ הַקֳּדָשִׁים / אֲרוֹן', strongs: ['H6944', 'H727', 'H3727'], zone: 'Innermost Cube', position: 'Westernmost end of Sanctuary', compass_orientation: 'West', dimensions_cubits: 'Chamber 10 × 10 × 10 cubits; Ark 2.5 × 1.5 × 1.5 cubits', summary: 'Cubic inner oracle housing the gold-overlaid Ark, Mercy Seat (Kapporet), and two cherubim.', historical_note: 'Ark held the Tablets of the Testimony.', scripture_refs: ['Exod 25:10-22', 'Exod 26:34', 'Lev 16:14-16', 'Heb 9:4'] },
    ],
  },
  first_temple: {
    id: 'first_temple',
    title: "Solomon's First Temple",
    era: 'c. 960–586 BCE (1 Kgs 6–8; 2 Chr 3–4)',
    orientation: 'East-to-West sanctuary axis (Ulam East -> Hekal -> Debir West) scaled 2× the Tabernacle footprint',
    epistemic_note: 'Textual reconstruction from 1 Kings 6–8 and 2 Chronicles 3–4; no direct excavation beneath the Temple Mount sanctuary footprint exists.',
    elements: [
      { id: 'ulam_porch', plan_id: 'first_temple', name: 'Porch / Vestibule (Ulam) & Pillars Jachin and Boaz', hebrew: 'אוּלָם / יָכִין וּבֹעַז', strongs: ['H197', 'H3199', 'H1162', 'H5982'], zone: 'East Facade', position: 'Eastern entrance of Temple building', compass_orientation: 'East (Jachin South, Boaz North)', dimensions_cubits: '20 cubits wide × 10 deep; pillars 18 cubits + 5-cubit capitals', summary: 'Monumental eastern porch flanked by freestanding bronze pillars Jachin and Boaz.', historical_note: '2 Chr 3:4 records 120 cubits height (tower/variant vs 1 Kgs 6:2–3).', scripture_refs: ['1 Kgs 6:3', '1 Kgs 7:15-22', '2 Chr 3:4', '2 Chr 3:17'] },
      { id: 'hekal', plan_id: 'first_temple', name: 'Main Hall (Hekal)', hebrew: 'הֵיכָל', strongs: ['H1964'], zone: 'Central Nave', position: 'Between Ulam and Debir', compass_orientation: 'East–West hall', dimensions_cubits: '40 × 20 × 30 cubits', summary: 'Cedar-paneled main hall housing ten lampstands (5 N, 5 S), ten tables (5 N, 5 S), and golden incense altar.', historical_note: 'Ten lampstands and ten tables distinguish Solomon\'s Hekal from the single Menorah/Table of the Tabernacle and Second Temple.', scripture_refs: ['1 Kgs 6:17', '1 Kgs 7:48-49', '2 Chr 4:7-8'] },
      { id: 'debir', plan_id: 'first_temple', name: 'Most Holy Place (Debir) & Monumental Cherubim', hebrew: 'דְּבִיר', strongs: ['H1687', 'H727', 'H3742'], zone: 'Western Oracle Cube', position: 'West end behind cedar/olivewood doors & veil', compass_orientation: 'West', dimensions_cubits: '20 × 20 × 20 cubits; two 10-cubit cherubim', summary: 'Windowless cubic inner sanctuary housing the Ark beneath two 10-cubit olivewood cherubim spanning 20 cubits.', historical_note: 'Destroyed by Babylon in 586 BCE (2 Kgs 25).', scripture_refs: ['1 Kgs 6:19-28', '1 Kgs 8:6-12', '2 Chr 3:8-14'] },
      { id: 'side_chambers', plan_id: 'first_temple', name: 'Three-Story Side Chambers', hebrew: 'צְלָעוֹת', strongs: ['H6763', 'H3326'], zone: 'Exterior Annex', position: 'North, West, and South outer walls', compass_orientation: 'N, W, S perimeter', dimensions_cubits: '3 stories: 5, 6, and 7 cubits wide × 5 cubits high each', summary: 'Stepped three-story priestly annex resting on wall ledges without piercing sanctuary stone.', historical_note: 'Linked by internal winding stairs.', scripture_refs: ['1 Kgs 6:5-10'] },
      { id: 'first_bronze_altar', plan_id: 'first_temple', name: 'Bronze Altar of Burnt Offering', hebrew: 'מִזְבַּח הַנְּחֹשֶׁת', strongs: ['H4196', 'H5178'], zone: 'Inner Court', position: 'Center of Inner Court east of Ulam', compass_orientation: 'East of Porch', dimensions_cubits: '20 × 20 × 10 cubits', summary: 'Monumental square bronze altar for state and festival sacrifices.', historical_note: 'Later relocated north by King Ahaz (2 Kgs 16:14).', scripture_refs: ['2 Chr 4:1', '1 Kgs 8:64'] },
      { id: 'molten_sea', plan_id: 'first_temple', name: 'Molten / Bronze Sea & Ten Lavers', hebrew: 'הַיָּם הַמּוּצָק', strongs: ['H3220', 'H3595'], zone: 'Inner Court', position: 'Molten Sea at Southeast corner; 10 wheeled lavers (5 N, 5 S)', compass_orientation: 'Southeast (Sea); N & S (Lavers)', dimensions_cubits: 'Sea: 10 cubits diameter × 5 deep × 30 circumference (2,000 baths); Lavers: 4 × 4 × 3 cubits', summary: 'Cast-bronze reservoir atop twelve outward-facing bronze oxen plus ten wheeled bronze lavers.', historical_note: 'Explicitly positioned "on the right side of the house eastward, toward the south" (1 Kgs 7:39).', scripture_refs: ['1 Kgs 7:23-39', '2 Chr 4:2-6'] },
    ],
  },
  second_temple: {
    id: 'second_temple',
    title: 'Second / Herodian Temple',
    era: 'c. 20 BCE – 70 CE (Gospels, Acts, Hebrews, Josephus, m. Middot)',
    orientation: 'Concentric holiness gradient moving inward East-to-West from Court of Gentiles to Most Holy Place',
    epistemic_note: 'Synthesizes NT texts with Josephus, Mishnah Middot, and Herodian retaining-wall archaeology. Distinct from Solomon\'s First Temple and Ezekiel\'s visionary temple (Ezek 40–48).',
    elements: [
      { id: 'court_of_gentiles', plan_id: 'second_temple', name: 'Court of the Gentiles & Royal Stoa', greek: 'ἱερόν / βασιλικὴ στοά', strongs: ['G2411', 'G4745'], zone: 'Outer Esplanade', position: 'Outer platform (Royal Stoa on South flank)', compass_orientation: 'Full perimeter; Stoa on South', dimensions_cubits: 'Herodian platform ~480 × 300 m (~960 × 600 cubits)', summary: 'Expansive outer esplanade (hieron) open to all nations; Royal Stoa housed civic/commercial activity.', historical_note: 'NT distinguishes hieron (entire complex, G2411) from naos (inner sanctuary, G3485).', scripture_refs: ['Matt 21:12', 'Mark 11:15', 'John 2:14'] },
      { id: 'solomons_portico', plan_id: 'second_temple', name: "Solomon's Portico", greek: 'στοὰ τοῦ Σολομῶνος', strongs: ['G4745', 'G4672'], zone: 'East Colonnade', position: 'Eastern flank overlooking Kidron Valley', compass_orientation: 'East', dimensions_cubits: 'Double colonnade along eastern length of platform', summary: 'Roofed eastern colonnade where Jesus walked in winter (Hanukkah) and the apostles taught.', historical_note: 'Named after Solomon due to tradition linking lower eastern masonry to First Temple era.', scripture_refs: ['John 10:23', 'Acts 3:11', 'Acts 5:12'] },
      { id: 'soreq_balustrade', plan_id: 'second_temple', name: 'Soreq Balustrade (Dividing Wall)', greek: 'μεσότοιχον', strongs: ['G3320'], zone: 'Inner Terrace Boundary', position: 'Encircling inner Chel terrace inside Court of Gentiles', compass_orientation: 'All 4 sides around inner courts', dimensions_cubits: '3 cubits high lattice stone barrier', summary: 'Warning barrier barring Gentiles from inner courts on pain of death (Eph 2:14 metaphor).', historical_note: 'Two surviving Greek warning stelae found in Jerusalem (1871 & 1935).', scripture_refs: ['Acts 21:28', 'Eph 2:14'] },
      { id: 'beautiful_gate', plan_id: 'second_temple', name: 'Beautiful Gate & Court of Women', greek: 'ἡ ὡραία πύλη', strongs: ['G5611', 'G2374', 'G4439'], zone: 'Eastern Inner Court', position: 'East entrance to 135 × 135 cubit Court of Women (Treasury)', compass_orientation: 'East', dimensions_cubits: 'Court of Women: 135 × 135 cubits', summary: 'Eastern portal where Peter & John healed the lame man; Women\'s Court housed 13 treasury receptacles.', historical_note: 'Ancient traditions debate identifying Beautiful Gate with the Shushan Gate vs Nicanor Gate.', scripture_refs: ['Mark 12:41-44', 'John 8:20', 'Acts 3:2-10'] },
      { id: 'nicanor_gate', plan_id: 'second_temple', name: 'Nicanor Gate & Court of Israel/Priests', greek: 'θύρα Νικάνωρ / θυσιαστήριον', strongs: ['G4439', 'G2379'], zone: 'Sacrificial Forecourt', position: '15 semicircular steps West of Women\'s Court -> 32 × 32 cubit stone altar', compass_orientation: 'East of Naos', dimensions_cubits: 'Doors 50 cubits high; stone altar 32 × 32 cubits (m. Middot)', summary: 'Corinthian-bronze doors opening to the Court of Israel and Priestly sacrificial altar.', historical_note: '15 steps associated with Psalms of Ascent (Pss 120–134).', scripture_refs: ['Matt 23:35', 'Luke 1:10', 'Acts 3:2'] },
      { id: 'second_sanctuary', plan_id: 'second_temple', name: 'Sanctuary (Naos), Veil & Most Holy Place', greek: 'ναός / καταπέτασμα / ἅγια ἁγίων', strongs: ['G3485', 'G2665', 'G39', 'G3087', 'G5132'], zone: 'Inner Sanctuary', position: 'Western apex: Single Menorah (S), Showbread (N), Incense Altar (W), Veil, Empty Holy of Holies', compass_orientation: 'West', dimensions_cubits: 'Facade 100 × 100 cubits; Most Holy Place 20 × 20 × 60 cubits tall', summary: 'Herodian white-stone sanctuary; Most Holy Place contained no Ark—only the exposed Foundation Stone.', historical_note: 'Josephus (War 5.219) and m. Yoma 5:2 confirm absence of the Ark in the Second Temple.', scripture_refs: ['Matt 24:1', 'Matt 27:51', 'Luke 1:9-11', 'Heb 9:2-7'] },
    ],
  },
  jerusalem_gates: {
    id: 'jerusalem_gates',
    title: 'Jerusalem Walls, Gates & Topography',
    era: 'Monarchy – Nehemiah – NT (Neh 3 & 12; John 5, 9, 18)',
    orientation: 'North up; Mount of Olives & Kidron Valley East; Hinnom Valley West & South; City of David spur descending South',
    epistemic_note: 'Follows Nehemiah 3\'s counterclockwise wall-repair circuit, Nehemiah 12\'s dual processions, and excavated First/Second Temple waterworks.',
    topographic_elevation_notes:
      'Topographic profile (West-to-East / North-to-South): Mount of Olives ridge rises to ~815m (peaks ~815–826m) directly east across the Kidron Valley (~640–670m), overlooking the Temple Mount platform (~743m), which sits north of the descending City of David spur (~700m dropping south toward ~635m at the Gihon Spring and Pool of Siloam).',
    elements: [
      { id: 'mount_of_olives', plan_id: 'jerusalem_gates', name: 'Mount of Olives', hebrew: 'הַר הַזֵּיתִים', greek: 'τὸ ὄρος τῶν ἐλαιῶν', strongs: ['H2132', 'G1636'], zone: 'Eastern Ridge', position: 'Directly East of Temple Mount across Kidron Valley', compass_orientation: 'East', dimensions_cubits: 'Ridge length ~2.5 km', elevation_note: '~815m above sea level (~72m higher than Temple Mount ~743m)', summary: 'Prominent eastern ridge overlooking the Temple precinct and East Gate; site of David\'s ascent, Gethsemane, Olivet Discourse, and Ascension.', historical_note: 'Commanding line-of-sight directly into the eastern Temple facade (Mark 13:3).', scripture_refs: ['2 Sam 15:30', 'Ezek 11:23', 'Zech 14:4', 'Mark 13:3', 'Luke 19:37', 'Acts 1:12'] },
      { id: 'temple_mount', plan_id: 'jerusalem_gates', name: 'Temple Mount (Mount Moriah)', hebrew: 'הַר הַמּוֹרִיָּה', strongs: ['H4179', 'H3389', 'G2414'], zone: 'Northeast Ridge', position: 'North of City of David spur, West of Kidron', compass_orientation: 'Northeast sector of ancient city', dimensions_cubits: 'Expanded Herodian platform ~480 × 300 m', elevation_note: '~743m above sea level (below Mount of Olives ~815m, above City of David & Kidron)', summary: 'Threshing floor of Araunah/Ornan purchased by David; site of First and Second Temples.', historical_note: 'Herod dramatically extended the natural Moriah summit on vaulted substructures.', scripture_refs: ['2 Sam 24:18-25', '2 Chr 3:1', 'Matt 24:1'] },
      { id: 'east_gate', plan_id: 'jerusalem_gates', name: 'East Gate (Sha\'ar HaMizrah)', hebrew: 'שַׁעַר הַמִּזְרָח', strongs: ['H8179', 'H4217', 'H6924'], zone: 'East Wall', position: 'Eastern Temple/city perimeter facing Kidron & Mount of Olives', compass_orientation: 'East', dimensions_cubits: 'Eastern gateway repaired by Shemaiah (Neh 3:29)', elevation_note: 'Eastern crest above Kidron (~730–740m plateau level)', summary: 'Biblical East Gate repaired under Nehemiah and central in Ezekiel\'s visionary Temple (Ezek 43:1–4; 44:1–3).', historical_note: 'CRITICAL DISTINCTION: The biblical East Gate (Neh 3:29; Ezek 43–44) must NOT be conflated with the currently visible Golden Gate (Bab al-Rahma), which is a later 6th–7th c. CE Umayyad/Byzantine structure built over earlier lower eastern arches and sealed by Ottoman Sultan Suleiman the Magnificent in 1541 CE.', scripture_refs: ['Neh 3:29', 'Ezek 10:19', 'Ezek 43:1-4', 'Ezek 44:1-3'] },
      { id: 'pool_of_bethesda', plan_id: 'jerusalem_gates', name: 'Pool of Bethesda', greek: 'Βηθεσδά', strongs: ['G964'], zone: 'North of Temple Mount', position: 'Just north of Temple wall near the Sheep Gate', compass_orientation: 'Northeast', dimensions_cubits: 'Twin rock-cut basins with five colonnaded porticoes', elevation_note: 'Beth-zetha valley north of Temple Mount (~735m)', summary: 'Double-basin pool complex with five porticoes where Jesus healed a man paralyzed 38 years.', historical_note: 'Excavated near St. Anne\'s Church; central dam dividing twin basins matches John 5:2\'s five porticoes.', scripture_refs: ['John 5:2-9'] },
      { id: 'pool_of_siloam', plan_id: 'jerusalem_gates', name: 'Pool of Siloam & Gihon Spring / Hezekiah\'s Tunnel', hebrew: 'בְּרֵכַת הַשֶּׁלַח / גִּיחוֹן', greek: 'Σιλωάμ', strongs: ['H7975', 'H1521', 'G4611'], zone: 'Southern Tip / City of David', position: 'Lower City of David (Gihon on East slope -> 533m tunnel -> Siloam at South tip)', compass_orientation: 'Southeast / South', dimensions_cubits: '~533m S-curved rock-cut tunnel; stepped limestone pool ~50m wide (2004 excavation)', elevation_note: 'Lower valley ~635m (lowest water-collection point inside southern walls)', summary: 'Water system channeling Gihon Spring inside the walls to Siloam; Sukkot water-libation source and healing of man born blind.', historical_note: 'Siloam Inscription (c. 701 BCE) attests Hezekiah\'s tunnel; stepped Second Temple pool unearthed in 2004.', scripture_refs: ['1 Kgs 1:33', '2 Kgs 20:20', '2 Chr 32:30', 'Neh 3:15', 'Isa 8:6', 'John 9:7'] },
      { id: 'sheep_gate', plan_id: 'jerusalem_gates', name: 'Sheep Gate', hebrew: 'שַׁעַר הַצֹּאן', greek: 'προβατική', strongs: ['H6629', 'G4262'], zone: 'Northeast Wall', position: 'North of Temple Mount near Bethesda', compass_orientation: 'Northeast', dimensions_cubits: 'First gate in Neh 3 circuit', summary: 'Gate rebuilt and consecrated by Eliashib the high priest for sacrificial flocks.', historical_note: 'Only gate explicitly said to be consecrated in Nehemiah 3.', scripture_refs: ['Neh 3:1', 'Neh 12:39', 'John 5:2'] },
      { id: 'water_fountain_dung_gates', plan_id: 'jerusalem_gates', name: 'Water, Fountain, Dung, Valley, Corner, Ephraim, Old & Fish Gates', hebrew: 'שַׁעַר הַמַּיִם / הָעַיִן / הָאַשְׁפֹּת / הַגַּיְא / הַדָּגִים', strongs: ['H4325', 'H5869', 'H830', 'H1516', 'H6438', 'H1709'], zone: 'City Perimeter Circuit', position: 'Counterclockwise from Sheep -> Fish -> Old -> Ephraim -> Corner -> Valley -> Dung -> Fountain -> Water -> Horse -> East -> Inspection', compass_orientation: 'Full city circuit (N, W, S, E)', dimensions_cubits: 'Valley-to-Dung span ~1,000 cubits (Neh 3:13); Corner-to-Ephraim ~400 cubits (2 Kgs 14:13)', summary: 'Remaining gates of Nehemiah\'s wall circuit framing the Water Gate plaza (Neh 8:1), Hinnom Valley western/southern walls, and northern Tyrian fish trade.', historical_note: 'Neh 3 and Neh 12 preserve the primary pre-Hellenistic gate sequence.', scripture_refs: ['Neh 2:13-15', 'Neh 3:1-32', 'Neh 8:1', 'Neh 12:31-39', 'Zeph 1:10'] },
    ],
  },
  ezekiel_temple: {
    id: 'ezekiel_temple',
    title: "Ezekiel's Visionary Temple & Living River (Ezek 40–48)",
    era: 'Exilic Vision, 573 BCE ("25th year of our exile", Ezek 40:1)',
    orientation: 'Concentric square sanctuary mountain (500 × 500 cubits / reeds) oriented East-to-West, with healing river issuing beneath the southern threshold eastward into the Arabah and Salt Sea',
    epistemic_note: 'Prophetic visionary architectural plan in Ezekiel 40–48 measured with a 6-cubit measuring reed (each long cubit = ordinary cubit + handbreadth, Ezek 40:5). Distinct from Solomon\'s Temple, Zerubbabel/Herod\'s Second Temple, and physical city topography.',
    elements: [
      { id: 'ezek_outer_east_gate', plan_id: 'ezekiel_temple', name: 'Outer East Gate & Glory Entry', hebrew: 'הַשַּׁעַר הַקָּדִים', strongs: ['H8179', 'H6921', 'H3519'], zone: 'Outer Wall East Perimeter', position: 'Outer eastern monumental gatehouse (50 × 25 cubits), shut for the prince alone after YHWH\'s glory enters', compass_orientation: 'East', dimensions_cubits: '50 cubits long × 25 cubits wide; 7 steps ascending to outer court', summary: 'Three-guardchamber eastern gatehouse through which the glory of the God of Israel returns from the east (Ezek 43:1–4).', historical_note: 'Remains shut to general traffic after YHWH enters (Ezek 44:1–3), parallel to the North and South outer gates of 50 × 25 cubits.', scripture_refs: ['Ezek 40:6-16', 'Ezek 43:1-4', 'Ezek 44:1-3'] },
      { id: 'ezek_inner_court_altar', plan_id: 'ezekiel_temple', name: 'Inner Court & Stepped Altar of Burnt Offering', hebrew: 'מִזְבֵּחַ / עֲזָרָה', strongs: ['H4196', 'H5835', 'H2025'], zone: 'Center of Inner Court', position: '100 × 100 cubit Inner Court elevated 8 steps above Outer Court, East of Temple porch', compass_orientation: 'Center axis East of Sanctuary', dimensions_cubits: 'Altar hearth (harel) 12 × 12 cubits rising in stepped ledges (16 × 16, 14 × 14, 12 × 12)', summary: 'Stepped four-horned stone/metal altar surrounded by Zadokite priestly chambers in the central 100 × 100 cubit court.', historical_note: 'Unlike Exod 20:26 (no steps to Tabernacle altar), Ezekiel\'s altar ascends eastward by steps (Ezek 43:17).', scripture_refs: ['Ezek 40:47', 'Ezek 43:13-17'] },
      { id: 'ezek_sanctuary_hekal_debir', plan_id: 'ezekiel_temple', name: 'Sanctuary Nave (Hekal) & Inner Cube (Debir)', hebrew: 'הֵיכָל / קֹדֶשׁ הַקֳּדָשִׁים', strongs: ['H1964', 'H6944', 'H4908'], zone: 'Western Temple House', position: '10 steps west above Inner Court: Porch (Ulam) 20 × 12, Nave (Hekal) 40 × 20, Most Holy 20 × 20', compass_orientation: 'East–West inward axis', dimensions_cubits: 'Ulam 20 × 12; Hekal 40 × 20; Most Holy Place 20 × 20; wooden table-altar 3 × 2 × 2', summary: 'Three-stage sanctuary carved with alternating cherubim (two faces: man and lion) and palm trees; no Ark or bronze veil-sea mentioned.', historical_note: 'Only the wooden altar ("table before YHWH", Ezek 41:22) is described inside the Hekal rather than lampstand/showbread vessels.', scripture_refs: ['Ezek 40:48-49', 'Ezek 41:1-26'] },
      { id: 'ezek_temple_threshold_river', plan_id: 'ezekiel_temple', name: 'Threshold Trickle & Four-Measured River', hebrew: 'מִפְתַּן / נַחַל', strongs: ['H4670', 'H5158', 'H4325'], zone: 'Temple South Flank -> Outer East Gate', position: 'Issuing eastward from beneath the Temple threshold south of the altar, passing south of the shut Outer East Gate', compass_orientation: 'Flowing Eastward', dimensions_cubits: '4 successive measurements × 1,000 cubits: ankles -> knees -> loins -> impassable swimming river (4,000 cubits = ~2 km)', summary: 'Supernaturally self-multiplying stream increasing from a threshold trickle to a deep river without tributaries.', historical_note: 'Typologically taken up in Joel 3:18, Zech 14:8, and Rev 22:1–2.', scripture_refs: ['Ezek 47:1-5', 'Joel 3:18', 'Zech 14:8', 'Rev 22:1'] },
      { id: 'ezek_healing_trees_salt_sea', plan_id: 'ezekiel_temple', name: 'Healing Riverbanks, Arabah, Salt Sea & En-gedi to En-eglaim', hebrew: 'הָעֲרָבָה / יָם הַמֶּלַח / עֵין גֶּדִי / עֵין עֶגְלַיִם', strongs: ['H6160', 'H3220', 'H4417', 'H5872', 'H5882', 'H6086'], zone: 'Eastern Descent to Dead Sea', position: 'Flowing down into the Arabah Rift and into the Salt (Dead) Sea, turning stagnant brine fresh', compass_orientation: 'East / Southeast into Dead Sea Basin', dimensions_cubits: 'Shoreline fishery spanning En-gedi to En-eglaim; two banks lined with diverse fruit trees', summary: 'Heals the lifeless Salt Sea so fishermen spread nets from En-gedi to En-eglaim; shoreline trees fruit every month with healing leaves; marshes (gēḇeʾ / biṣṣāh) preserved for salt.', historical_note: 'Preserves salt marshes intentionally for mineral/covenant salt supply alongside healed freshwater fisheries.', scripture_refs: ['Ezek 47:6-12', 'Rev 22:2'] },
      { id: 'ezek_priestly_chambers_allotment', plan_id: 'ezekiel_temple', name: 'Zadokite Priestly Chambers & Sacred District (Terumah)', hebrew: 'לִשְׁכוֹת / תְּרוּמָה', strongs: ['H3957', 'H8641', 'H6659'], zone: 'Outer/Inner Sanctuary Flanks & Holy District', position: 'Three-story northern and southern sacred chambers and surrounding 25,000 × 25,000 cubit/reed sacred district', compass_orientation: 'North & South flanks of Temple; central land allotment', dimensions_cubits: '500 × 500 cubit/reed Temple square within 25,000 × 10,000 Priestly portion', summary: 'Holy chambers where Zadokite priests eat most holy offerings and change sacred linen vestments before entering the outer court.', historical_note: 'Ezekiel 48 distributes tribal bands horizontally north-to-south around the central Sanctuary district.', scripture_refs: ['Ezek 42:1-14', 'Ezek 45:1-5', 'Ezek 48:8-22'] },
    ],
  },
};

function resolveArchitecturePlanId(rawPlan?: string, passage?: string): ArchitecturePlanId | null {
  if (rawPlan) {
    const p = rawPlan.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (p === 'tabernacle' || p.includes('mishkan') || p.includes('tent')) return 'tabernacle';
    if (p === 'first_temple' || p === '1st_temple' || p.includes('solomon')) return 'first_temple';
    if (p === 'second_temple' || p === '2nd_temple' || p.includes('herod') || p.includes('zerubbabel')) return 'second_temple';
    if (p === 'ezekiel_temple' || p.includes('ezekiel') || p.includes('ezek')) return 'ezekiel_temple';
    if (p === 'jerusalem_gates' || p.includes('jerusalem') || p.includes('gate') || p.includes('wall')) return 'jerusalem_gates';
  }
  if (passage) {
    const parsed = parsePassageString(passage);
    if (parsed && parsed.passages.length > 0) {
      const { book, chapter, start_verse } = parsed.passages[0];
      if (book === 2 || book === 3 || book === 4 || (book === 58 && chapter === 9 && start_verse <= 5)) return 'tabernacle';
      if (book === 11 || book === 12 || book === 13 || book === 14) return 'first_temple';
      if (book === 26 && chapter >= 40) return 'ezekiel_temple';
      if (book === 37 || book === 38) return 'second_temple';
      if (book === 15 || book === 16 || book === 36) return 'jerusalem_gates';
      if (book >= 40) return 'second_temple';
      return null;
    }
  }
  return null;
}

export function queryMcpSacredArchitecture(params: {
  plan?: string;
  element?: string;
  strongs?: string;
  passage?: string;
}): Record<string, unknown> {
  const planId = resolveArchitecturePlanId(params.plan, params.passage);
  const normStrongs = normalizeStrongsCode(params.strongs);
  const elemQ = (params.element ?? '').trim().toLowerCase();
  const parsedPassage = params.passage ? parsePassageString(params.passage) : null;
  if (params.passage && !parsedPassage) {
    return { status: 'invalid_request', error: `Could not parse passage: ${params.passage}` };
  }
  if (params.passage && !planId && !params.plan && !elemQ && !normStrongs) {
    return {
      status: 'no_matching_plan',
      query: {
        plan: null,
        element: null,
        strongs: null,
        passage: parsedPassage?.normalized ?? params.passage,
      },
      plans: [],
      elements: [],
      available_plans: Object.keys(ARCHITECTURE_PLANS),
      note: `No dedicated sacred-architecture blueprint maps directly to ${parsedPassage?.normalized ?? params.passage}. Specify plan ("tabernacle", "first_temple", "second_temple", "ezekiel_temple", "jerusalem_gates"), an element keyword, or a Strong's ID.`,
    };
  }

  const candidatePlans: ArchitecturePlan[] = planId
    ? [ARCHITECTURE_PLANS[planId]]
    : Object.values(ARCHITECTURE_PLANS);

  const scoredElements: Array<{ elem: ArchitectureElement; score: number }> = [];
  for (const plan of candidatePlans) {
    for (const elem of plan.elements) {
      if (normStrongs && !elem.strongs.some((s) => normalizeStrongsCode(s) === normStrongs)) {
        continue;
      }
      let score = 10;
      if (elemQ) {
        const idL = elem.id.toLowerCase();
        const nameL = elem.name.toLowerCase();
        if (idL === elemQ || nameL === elemQ) score = 100;
        else if (nameL.startsWith(elemQ) || nameL.includes(elemQ)) score = 75;
        else if (
          elem.zone.toLowerCase().includes(elemQ) ||
          (elem.transliteration?.toLowerCase().includes(elemQ) ?? false) ||
          (elem.hebrew?.includes(params.element ?? '') ?? false) ||
          (elem.greek?.includes(params.element ?? '') ?? false)
        ) {
          score = 50;
        } else if (
          elem.summary.toLowerCase().includes(elemQ) ||
          elem.historical_note.toLowerCase().includes(elemQ)
        ) {
          score = 25;
        } else {
          continue;
        }
      }
      scoredElements.push({ elem, score });
    }
  }
  if (elemQ) {
    scoredElements.sort((a, b) => b.score - a.score);
  }
  const matchedElements = scoredElements.map((s) => s.elem);

  const plansMeta = candidatePlans.map((p) => ({
    id: p.id,
    title: p.title,
    era: p.era,
    orientation: p.orientation,
    ...(p.topographic_elevation_notes ? { topographic_elevation_notes: p.topographic_elevation_notes } : {}),
    epistemic_note: p.epistemic_note,
  }));

  return {
    status: matchedElements.length > 0 ? 'ok' : 'not_found',
    query: {
      plan: planId ?? (params.plan || 'all'),
      element: params.element ?? null,
      strongs: normStrongs || null,
      passage: parsedPassage?.normalized ?? null,
    },
    plans: plansMeta,
    elements: matchedElements,
    epistemic_note:
      'Scripture citations (scripture_refs) and cubit measurements are distinguished from archaeological/historical reconstructions (historical_note). Notice Second Temple absence of the Ark and the distinction between the biblical East Gate (Neh 3:29; Ezek 43–44) and the later 6th–16th c. sealed Golden Gate.',
  };
}

// === @section:feasts-calendar ===
export type HebrewTradition = 'israel' | 'diaspora';
export type OmerCountingRule = 'rabbinic_nisan_16' | 'boethusian_sunday';

const HEBREW_EPOCH = -1373427;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const HEBREW_MONTH_NAMES: Readonly<Record<number, string>> = {
  1: 'Nisan', 2: 'Iyar', 3: 'Sivan', 4: 'Tammuz', 5: 'Av', 6: 'Elul',
  7: 'Tishrei', 8: 'Cheshvan', 9: 'Kislev', 10: 'Tevet', 11: 'Shevat', 12: 'Adar', 13: 'Adar II',
};

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function isGregorianLeapYear(gy: number): boolean {
  return mod(gy, 4) === 0 && (mod(gy, 100) !== 0 || mod(gy, 400) === 0);
}

function isHebrewLeapYear(hy: number): boolean {
  return mod(7 * hy + 1, 19) < 7;
}

function gregorianToAbsolute(gy: number, gm: number, gd: number): number {
  const y = gy - 1;
  let rd =
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) +
    Math.floor((367 * gm - 362) / 12) +
    gd;
  if (gm > 2) rd += isGregorianLeapYear(gy) ? -1 : -2;
  return rd;
}

function absoluteToGregorian(abs: number): { year: number; month: number; day: number } {
  const d0 = abs - 1;
  const n400 = Math.floor(d0 / 146097);
  const d1 = mod(d0, 146097);
  const n100 = Math.floor(d1 / 36524);
  const d2 = mod(d1, 36524);
  const n4 = Math.floor(d2 / 1461);
  const d3 = mod(d2, 1461);
  const n1 = Math.floor(d3 / 365);
  let year = 400 * n400 + 100 * n100 + 4 * n4 + n1;
  if (n100 !== 4 && n1 !== 4) year += 1;
  const priorDays = abs - gregorianToAbsolute(year, 1, 1);
  const correction = abs < gregorianToAbsolute(year, 3, 1) ? 0 : isGregorianLeapYear(year) ? 1 : 2;
  const month = Math.floor((12 * (priorDays + correction) + 373) / 367);
  const day = abs - gregorianToAbsolute(year, month, 1) + 1;
  return { year, month, day };
}

function tishrei1Absolute(hy: number): number {
  const monthsElapsed = Math.floor((235 * hy - 234) / 19);
  const parts = 5 * 1080 + 204 + 13753 * monthsElapsed;
  let day = 29 * monthsElapsed + Math.floor(parts / 25920);
  const remParts = mod(parts, 25920);
  const moladWeekday = mod(day + 1, 7);
  if (remParts >= 18 * 1080) {
    day += 1;
  } else if (!isHebrewLeapYear(hy) && moladWeekday === 2 && remParts >= 9 * 1080 + 204) {
    day += 2;
  } else if (isHebrewLeapYear(hy - 1) && moladWeekday === 1 && remParts >= 15 * 1080 + 589) {
    day += 1;
  }
  const weekday = mod(day + 1, 7);
  if (weekday === 0 || weekday === 3 || weekday === 5) day += 1;
  return HEBREW_EPOCH + day;
}

function hebrewDaysInYear(hy: number): number {
  return tishrei1Absolute(hy + 1) - tishrei1Absolute(hy);
}

function lastDayOfHebrewMonth(hy: number, hm: number): number {
  if (hm === 2 || hm === 4 || hm === 6 || hm === 10 || hm === 13) return 29;
  if (hm === 12) return isHebrewLeapYear(hy) ? 30 : 29;
  if (hm === 8) return mod(hebrewDaysInYear(hy), 10) === 5 ? 30 : 29;
  if (hm === 9) return mod(hebrewDaysInYear(hy), 10) === 3 ? 29 : 30;
  return 30;
}

function hebrewToAbsolute(hy: number, hm: number, hd: number): number {
  let abs = tishrei1Absolute(hy) + hd - 1;
  const months = isHebrewLeapYear(hy) ? 13 : 12;
  if (hm < 7) {
    for (let m = 7; m <= months; m += 1) abs += lastDayOfHebrewMonth(hy, m);
    for (let m = 1; m < hm; m += 1) abs += lastDayOfHebrewMonth(hy, m);
  } else {
    for (let m = 7; m < hm; m += 1) abs += lastDayOfHebrewMonth(hy, m);
  }
  return abs;
}

function absoluteToHebrew(abs: number): { year: number; month: number; day: number } {
  let hy = Math.floor((abs - HEBREW_EPOCH) / 365.2468222) + 1;
  while (tishrei1Absolute(hy + 1) <= abs) hy += 1;
  while (tishrei1Absolute(hy) > abs) hy -= 1;
  let hm = abs < hebrewToAbsolute(hy, 1, 1) ? 7 : 1;
  while (abs > hebrewToAbsolute(hy, hm, lastDayOfHebrewMonth(hy, hm))) hm += 1;
  const hd = abs - hebrewToAbsolute(hy, hm, 1) + 1;
  return { year: hy, month: hm, day: hd };
}

function formatIsoDate(abs: number): string {
  const { year, month, day } = absoluteToGregorian(abs);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatShortAbs(abs: number, includeYear = false): string {
  const { year, month, day } = absoluteToGregorian(abs);
  const base = `${SHORT_MONTHS[month - 1]} ${day}`;
  return includeYear ? `${base}, ${year}` : base;
}

function formatEveRange(eveAbs: number, dayAbs: number, endAbs: number): string {
  const eve = absoluteToGregorian(eveAbs);
  const day = absoluteToGregorian(dayAbs);
  const end = absoluteToGregorian(endAbs);
  if (dayAbs === endAbs) {
    if (eve.year === end.year && eve.month === end.month) {
      return `Eve ${SHORT_MONTHS[eve.month - 1]} ${eve.day} – ${end.day}, ${end.year}`;
    }
    return `Eve ${formatShortAbs(eveAbs, eve.year !== end.year)} – ${formatShortAbs(endAbs, true)}`;
  }
  if (eve.year === end.year && eve.month === end.month) {
    return `Eve ${SHORT_MONTHS[eve.month - 1]} ${eve.day} (${SHORT_MONTHS[day.month - 1]} ${day.day}–${end.day}), ${end.year}`;
  }
  if (eve.year === end.year) {
    return `Eve ${formatShortAbs(eveAbs)} (${formatShortAbs(dayAbs)}–${formatShortAbs(endAbs)}), ${end.year}`;
  }
  return `Eve ${formatShortAbs(eveAbs, true)} – ${formatShortAbs(endAbs, true)}`;
}

interface FeastDefinition {
  id: string;
  name: string;
  aliases: string[];
  hebrew: string;
  transliteration: string;
  greek?: string;
  strongs: string[];
  season: 'spring' | 'fall' | 'winter';
  tier: 'torah_moed' | 'second_temple';
  hebrew_date_rule: string;
  torah_rule: string;
  second_temple_practice: string;
  agricultural_tie: string;
  scripture_refs: string[];
}

const FEAST_DEFINITIONS: readonly FeastDefinition[] = [
  {
    id: 'pesach',
    name: 'Passover',
    aliases: ['passover', 'pesach', 'pascha'],
    hebrew: 'פֶּסַח',
    transliteration: 'Pesach',
    greek: 'πάσχα (Pascha)',
    strongs: ['H6453', 'G3957'],
    season: 'spring',
    tier: 'torah_moed',
    hebrew_date_rule: 'Nisan 14 (slaughter between evenings) / Seder night of Nisan 15',
    torah_rule: 'Slaughter unblemished year-old lamb on 14th of 1st month (Abib/Nisan) at twilight, eat roasted that night with unleavened bread and bitter herbs (Exod 12:1–14; Lev 23:5; Deut 16:1–7).',
    second_temple_practice: 'Lambs slaughtered in Temple courtyard shifts; Seder meal eaten inside Jerusalem after sunset (Nisan 15 begins). Post-70 CE rabbinic Seder preserves Haggadah without altar.',
    agricultural_tie: 'Chodesh HaAviv ("Month of Young Barley Ears"): aligns spring lambing and early barley harvest.',
    scripture_refs: ['Exod 12:6', 'Lev 23:5', 'Num 28:16', 'Deut 16:1', 'Luke 22:7', '1 Cor 5:7'],
  },
  {
    id: 'unleavened',
    name: 'Feast of Unleavened Bread',
    aliases: ['unleavened bread', 'matzot', 'matzah', 'chag hamatzot'],
    hebrew: 'חַג הַמַּצּוֹת',
    transliteration: 'Chag HaMatzot',
    greek: 'ἑορτὴ τῶν ἀζύμων',
    strongs: ['H4682', 'H2282', 'G106'],
    season: 'spring',
    tier: 'torah_moed',
    hebrew_date_rule: 'Nisan 15–21 (Nisan 15–22 in Diaspora)',
    torah_rule: 'Seven days without leaven; sacred assemblies with cessation from work on Nisan 15 and Nisan 21 (Exod 12:15–20; Lev 23:6–8; Num 28:17–25).',
    second_temple_practice: 'Paired with Passover as one spring pilgrimage festival (Luke 22:1; Josephus); Diaspora adds an 8th day (Nisan 22).',
    agricultural_tie: 'Marks transition from old-year sourdough starter to the new spring grain cycle.',
    scripture_refs: ['Exod 12:15', 'Lev 23:6', 'Num 28:17', 'Deut 16:3', '1 Cor 5:8'],
  },
  {
    id: 'firstfruits',
    name: 'Firstfruits (Wave Sheaf / Omer)',
    aliases: ['firstfruits', 'omer', 'wave sheaf', 'bikkurim'],
    hebrew: 'רֵאשִׁית קְצִירְכֶם / עֹמֶר',
    transliteration: 'Reshit Qetzirchem / Omer',
    greek: 'ἀπαρχή (Aparche)',
    strongs: ['H1061', 'H6016', 'H7225', 'G536'],
    season: 'spring',
    tier: 'torah_moed',
    hebrew_date_rule: 'Nisan 16 (rabbinic) or Sunday inside Nisan 15–21 (Boethusian/Sadducean)',
    torah_rule: 'Priest waves an omer sheaf of the first barley harvest "on the day after the Sabbath" (Lev 23:11) before new-crop grain may be eaten.',
    second_temple_practice: 'Pharisees anchored on Nisan 16 (reading "Sabbath" as Nisan 15 Yom Tov); Boethusians/Sadducees anchored on the Sunday strictly after the weekly Saturday Sabbath in Nisan 15–21.',
    agricultural_tie: 'Ceremonial opening of the spring barley harvest in Canaan.',
    scripture_refs: ['Lev 23:10-14', 'Josh 5:10-11', '1 Cor 15:20'],
  },
  {
    id: 'shavuot',
    name: 'Feast of Weeks (Pentecost)',
    aliases: ['shavuot', 'pentecost', 'weeks', 'harvest'],
    hebrew: 'שָׁבֻעֹת',
    transliteration: 'Shavuot',
    greek: 'πεντηκοστή (Pentekoste)',
    strongs: ['H7620', 'H1061', 'G4005'],
    season: 'spring',
    tier: 'torah_moed',
    hebrew_date_rule: '50th day (49 days after Firstfruits anchor; Sivan 6 under rabbinic Nisan 16)',
    torah_rule: 'Count seven complete weeks (49 days) from wave-sheaf and celebrate the 50th day with two leavened wheat loaves (Lev 23:15–21; Deut 16:9–12).',
    second_temple_practice: 'Called Pentekoste in Greek Judaism & Acts 2:1; rabbinic tradition links Sivan 6 with the giving of the Torah at Sinai; Diaspora adds Sivan 7.',
    agricultural_tie: 'Chag HaKatzir ("Feast of Harvest"): marks completion of the grain harvest and wheat firstfruits.',
    scripture_refs: ['Exod 23:16', 'Exod 34:22', 'Lev 23:15-21', 'Num 28:26', 'Deut 16:9', 'Acts 2:1'],
  },
  {
    id: 'teruah',
    name: 'Day of Acclamation / Trumpets (Rosh Hashanah)',
    aliases: ['teruah', 'yom teruah', 'trumpets', 'rosh hashanah'],
    hebrew: 'יוֹם תְּרוּעָה',
    transliteration: 'Yom Teruah / Rosh Hashanah',
    greek: 'ἡμέρα σαλπίγγων',
    strongs: ['H8643', 'H7782', 'G4536'],
    season: 'fall',
    tier: 'torah_moed',
    hebrew_date_rule: 'Tishrei 1 (7th month; 2 days in later rabbinic practice)',
    torah_rule: 'First day of seventh month observed with solemn rest, sacred assembly, and memorial of horn-blast / acclamation (Lev 23:24; Num 29:1).',
    second_temple_practice: 'Became Rosh Hashanah civil/sabbatical new year in Mishnaic Judaism with shofar liturgy and Ten Days of Repentance.',
    agricultural_tie: 'Turn of the agricultural year after late-summer grape/olive harvests before autumn rains.',
    scripture_refs: ['Lev 23:24', 'Num 29:1', 'Neh 8:2', 'Ps 81:3'],
  },
  {
    id: 'yom_kippur',
    name: 'Day of Atonement (Yom Kippur)',
    aliases: ['yom kippur', 'atonement', 'the fast'],
    hebrew: 'יוֹם הַכִּפֻּרִים',
    transliteration: 'Yom HaKippurim',
    greek: 'ἡμέρα ἐξιλασμοῦ',
    strongs: ['H3725', 'H3722', 'G2434', 'G2435'],
    season: 'fall',
    tier: 'torah_moed',
    hebrew_date_rule: 'Tishrei 10 (eve of Tishrei 9 to eve of 10)',
    torah_rule: 'Complete Sabbath rest and self-denial/fasting; sole day the High Priest enters the Holy of Holies with blood and incense (Lev 16; Lev 23:26–32).',
    second_temple_practice: 'Referred to as "the Fast" (Acts 27:9); central typological backdrop of Hebrews 9.',
    agricultural_tie: 'Solemn spiritual reset before winter sowing; Jubilee trumpet sounded every 50th year (Lev 25:9).',
    scripture_refs: ['Lev 16:29', 'Lev 23:27', 'Num 29:7', 'Acts 27:9', 'Heb 9:7'],
  },
  {
    id: 'sukkot',
    name: 'Feast of Booths / Tabernacles (Sukkot)',
    aliases: ['sukkot', 'booths', 'tabernacles', 'ingathering'],
    hebrew: 'חַג הַסֻּכּוֹת',
    transliteration: 'Chag HaSukkot',
    greek: 'σκηνοπηγία (Skenopegia)',
    strongs: ['H5521', 'H2282', 'G4634'],
    season: 'fall',
    tier: 'torah_moed',
    hebrew_date_rule: 'Tishrei 15–21 (7 days)',
    torah_rule: 'Dwell seven days in temporary booths with palm, thick tree, and willow branches, rejoicing before YHWH (Lev 23:33–43; Num 29:12–34; Deut 16:13–15).',
    second_temple_practice: 'Featured daily Water Libation from Siloam and Temple court torch illumination (backdrop of John 7:37–38).',
    agricultural_tie: 'Chag HaAsif ("Feast of Ingathering"): celebrates completed vintage/olive harvests and prays for winter rain (Zech 14:16–17).',
    scripture_refs: ['Lev 23:34', 'Num 29:12', 'Deut 16:13', 'Neh 8:14', 'Zech 14:16', 'John 7:2'],
  },
  {
    id: 'shemini_atzeret',
    name: 'Eighth-Day Sacred Assembly (Shemini Atzeret)',
    aliases: ['shemini atzeret', 'simchat torah', 'eighth day', 'atzeret'],
    hebrew: 'שְׁמִינִי עֲצֶרֶת',
    transliteration: 'Shemini Atzeret',
    greek: 'ἡμέρα ὀγδόη',
    strongs: ['H6116', 'H8066'],
    season: 'fall',
    tier: 'torah_moed',
    hebrew_date_rule: 'Tishrei 22 (Tishrei 22–23 in Diaspora)',
    torah_rule: 'Solemn closing assembly on the 8th day after Sukkot with cessation from labor and distinct single-bull sacrifice (Lev 23:36; Num 29:35–38).',
    second_temple_practice: 'Treated as a distinct festival day featuring Prayer for Rain; Israel combines Simchat Torah on Tishrei 22, Diaspora on Tishrei 23.',
    agricultural_tie: 'Marks onset of early yoreh autumn rains for winter plowing.',
    scripture_refs: ['Lev 23:36', 'Num 29:35', '1 Kgs 8:66', 'John 7:37'],
  },
  {
    id: 'purim',
    name: 'Purim',
    aliases: ['purim', 'lots'],
    hebrew: 'פּוּרִים',
    transliteration: 'Purim',
    greek: 'Φρουραί',
    strongs: ['H6332', 'H6331'],
    season: 'winter',
    tier: 'second_temple',
    hebrew_date_rule: 'Adar 14 (Adar II 14 in leap years; Adar 15 in walled cities / Shushan Purim)',
    torah_rule: 'Post-exilic ordinance (not in Leviticus 23 Torah moedim) instituted by Mordecai and Esther in Esther 9:17–32.',
    second_temple_practice: 'Public reading of Megillat Esther, sending food portions, and charity to the poor; observed in Adar II during 13-month leap years.',
    agricultural_tie: 'Late winter (Feb–Mar) at almond blossom season before Nisan.',
    scripture_refs: ['Esth 3:7', 'Esth 9:26-28'],
  },
  {
    id: 'hanukkah',
    name: 'Hanukkah (Feast of Dedication)',
    aliases: ['hanukkah', 'chanukkah', 'dedication', 'lights', 'enkainia'],
    hebrew: 'חֲנֻכָּה',
    transliteration: 'Chanukkah',
    greek: 'τὰ ἐγκαίνια (Ta Enkainia)',
    strongs: ['H2598', 'G1456'],
    season: 'winter',
    tier: 'second_temple',
    hebrew_date_rule: 'Kislev 25 – Tevet 2/3 (8 days)',
    torah_rule: 'Second Temple / intertestamental festival (not in Leviticus 23 Torah moedim) instituted in 164 BCE by Judas Maccabeus (1 Macc 4:52–59; 2 Macc 10:1–8).',
    second_temple_practice: 'Attested in John 10:22 as "Feast of Dedication (Enkainia) in winter"; Josephus calls it "Festival of Lights"; rabbinic liturgy lights an 8-branch chanukkiyah.',
    agricultural_tie: 'Mid-winter solstice season when fresh autumn olive oil pressing is available.',
    scripture_refs: ['John 10:22', 'Ezra 6:16', 'Num 7:10'],
  },
];

function computeFeastSchedule(
  gregorianYear: number,
  tradition: HebrewTradition,
  omerRule: OmerCountingRule,
): {
  spring_year: { hebrew_year_am: number; is_leap: boolean; days: number };
  fall_year: { hebrew_year_am: number; is_leap: boolean; days: number; rosh_hashanah: string };
  dates_by_id: Record<string, Record<string, unknown>>;
} {
  const hySpring = gregorianYear + 3760;
  const hyFall = gregorianYear + 3761;
  const springLeap = isHebrewLeapYear(hySpring);
  const fallLeap = isHebrewLeapYear(hyFall);
  const springDays = hebrewDaysInYear(hySpring);
  const fallDays = hebrewDaysInYear(hyFall);

  const purimMonth = springLeap ? 13 : 12;
  const purimAbs = hebrewToAbsolute(hySpring, purimMonth, 14);
  const purimMonthLabel = springLeap ? 'Adar II' : 'Adar';

  const nisan14Abs = hebrewToAbsolute(hySpring, 1, 14);
  const nisan15Abs = nisan14Abs + 1;
  const pesachEndAbs = tradition === 'diaspora' ? nisan15Abs + 1 : nisan15Abs;
  const unleavenedEndAbs = hebrewToAbsolute(hySpring, 1, tradition === 'diaspora' ? 22 : 21);

  let firstfruitsAbs = hebrewToAbsolute(hySpring, 1, 16);
  let firstfruitsHebText = 'Nisan 16';
  let firstfruitsRule = 'Rabbinic Nisan 16 anchor';
  if (omerRule === 'boethusian_sunday') {
    const nisan21Abs = hebrewToAbsolute(hySpring, 1, 21);
    for (let abs = nisan15Abs; abs <= nisan21Abs; abs += 1) {
      if (mod(abs, 7) === 6) {
        firstfruitsAbs = abs + 1;
        break;
      }
    }
    const ffHeb = absoluteToHebrew(firstfruitsAbs);
    firstfruitsHebText = `Nisan ${ffHeb.day} (Sunday)`;
    firstfruitsRule = 'Boethusian/Sadducean Sunday strictly after weekly Sabbath in Nisan 15–21';
  }

  const shavuotAbs = firstfruitsAbs + 49;
  const shavuotHeb = absoluteToHebrew(shavuotAbs);
  const shavuotTwoDays = tradition === 'diaspora' && omerRule === 'rabbinic_nisan_16';
  const shavuotEndAbs = shavuotTwoDays ? shavuotAbs + 1 : shavuotAbs;
  const shavuotMonthName = shavuotHeb.month === 12 && springLeap ? 'Adar I' : (HEBREW_MONTH_NAMES[shavuotHeb.month] ?? `Month ${shavuotHeb.month}`);
  const shavuotHebText = shavuotTwoDays
    ? `${shavuotMonthName} ${shavuotHeb.day}–${shavuotHeb.day + 1}`
    : `${shavuotMonthName} ${shavuotHeb.day}`;

  const tishrei1Abs = hebrewToAbsolute(hyFall, 7, 1);
  const teruahEndAbs = tradition === 'diaspora' ? tishrei1Abs + 1 : tishrei1Abs;
  const yomKippurAbs = tishrei1Abs + 9;
  const sukkotStartAbs = tishrei1Abs + 14;
  const sukkotEndAbs = tishrei1Abs + 20;
  const sheminiAbs = tishrei1Abs + 21;
  const sheminiEndAbs = tradition === 'diaspora' ? sheminiAbs + 1 : sheminiAbs;
  const hanukkahStartAbs = hebrewToAbsolute(hyFall, 9, 25);
  const hanukkahEndAbs = hanukkahStartAbs + 7;
  const hanukkahEndHeb = absoluteToHebrew(hanukkahEndAbs);

  const pack = (hy: number, hebText: string, eveAbs: number, dayAbs: number, endAbs: number, note: string) => ({
    gregorian_year: gregorianYear,
    hebrew_year_am: hy,
    hebrew_date_text: hebText,
    eve_begins: formatIsoDate(eveAbs),
    day_begins: formatIsoDate(dayAbs),
    ends_evening: formatIsoDate(endAbs),
    formatted_range: formatEveRange(eveAbs, dayAbs, endAbs),
    note,
  });

  return {
    spring_year: { hebrew_year_am: hySpring, is_leap: springLeap, days: springDays },
    fall_year: { hebrew_year_am: hyFall, is_leap: fallLeap, days: fallDays, rosh_hashanah: formatIsoDate(tishrei1Abs) },
    dates_by_id: {
      purim: pack(hySpring, `${purimMonthLabel} 14`, purimAbs - 1, purimAbs, purimAbs, `AM ${hySpring}; Shushan Purim on ${purimMonthLabel} 15`),
      pesach: pack(hySpring, tradition === 'diaspora' ? 'Nisan 14 (eve) – 16' : 'Nisan 14 (eve) – 15', nisan14Abs, nisan15Abs, pesachEndAbs, `AM ${hySpring}; lamb slain Nisan 14 afternoon, Seder after sunset`),
      unleavened: pack(hySpring, tradition === 'diaspora' ? 'Nisan 15–22' : 'Nisan 15–21', nisan14Abs, nisan15Abs, unleavenedEndAbs, `AM ${hySpring}; ${tradition === 'diaspora' ? '8-day Diaspora' : '7-day Torah'} observance`),
      firstfruits: pack(hySpring, firstfruitsHebText, firstfruitsAbs - 1, firstfruitsAbs, firstfruitsAbs, `AM ${hySpring}; ${firstfruitsRule}`),
      shavuot: pack(hySpring, shavuotHebText, shavuotAbs - 1, shavuotAbs, shavuotEndAbs, `AM ${hySpring}; 50th day (+49 from Firstfruits)`),
      teruah: pack(hyFall, tradition === 'diaspora' ? 'Tishrei 1–2' : 'Tishrei 1', tishrei1Abs - 1, tishrei1Abs, teruahEndAbs, `AM ${hyFall}; Torah sets Tishrei 1`),
      yom_kippur: pack(hyFall, 'Tishrei 10', yomKippurAbs - 1, yomKippurAbs, yomKippurAbs, `AM ${hyFall}; fast begins before sunset Tishrei 9`),
      sukkot: pack(hyFall, 'Tishrei 15–21', sukkotStartAbs - 1, sukkotStartAbs, sukkotEndAbs, `AM ${hyFall}; 7-day pilgrimage festival`),
      shemini_atzeret: pack(hyFall, tradition === 'diaspora' ? 'Tishrei 22–23' : 'Tishrei 22', sheminiAbs - 1, sheminiAbs, sheminiEndAbs, `AM ${hyFall}; 8th-day closing assembly`),
      hanukkah: pack(hyFall, `Kislev 25 – Tevet ${hanukkahEndHeb.day}`, hanukkahStartAbs - 1, hanukkahStartAbs, hanukkahEndAbs, `AM ${hyFall}; Kislev has ${lastDayOfHebrewMonth(hyFall, 9)} days`),
    },
  };
}

export function queryMcpFeastsCalendar(params: {
  feast?: string;
  strongs?: string;
  gregorian_year?: number;
  tradition?: 'israel' | 'diaspora';
  omer_rule?: 'rabbinic_nisan_16' | 'boethusian_sunday';
}): Record<string, unknown> {
  const year = typeof params.gregorian_year === 'number' && Number.isFinite(params.gregorian_year)
    ? Math.max(1900, Math.min(2200, Math.trunc(params.gregorian_year)))
    : new Date().getUTCFullYear();
  const tradition: HebrewTradition = params.tradition === 'diaspora' ? 'diaspora' : 'israel';
  const omerRule: OmerCountingRule = params.omer_rule === 'boethusian_sunday' ? 'boethusian_sunday' : 'rabbinic_nisan_16';

  const schedule = computeFeastSchedule(year, tradition, omerRule);
  const normStrongs = normalizeStrongsCode(params.strongs);
  const q = (params.feast ?? '').trim().toLowerCase();

  const matches = FEAST_DEFINITIONS.filter((f) => {
    if (normStrongs && !f.strongs.some((s) => normalizeStrongsCode(s) === normStrongs)) {
      return false;
    }
    if (q) {
      const hit =
        f.id.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.aliases.some((a) => a.toLowerCase().includes(q)) ||
        f.transliteration.toLowerCase().includes(q) ||
        f.hebrew.includes(params.feast ?? '') ||
        (f.greek?.toLowerCase().includes(q) ?? false);
      if (!hit) return false;
    }
    return true;
  }).map((f) => ({
    ...f,
    computed_dates: schedule.dates_by_id[f.id],
  }));

  return {
    status: matches.length > 0 ? 'ok' : 'not_found',
    calendar_model: 'Hillel II / Dershowitz-Reingold fixed arithmetic Hebrew calendar',
    parameters: {
      gregorian_year: year,
      tradition,
      omer_rule: omerRule,
      spring_hebrew_year: schedule.spring_year,
      fall_hebrew_year: schedule.fall_year,
    },
    feasts: matches,
    uncertainty_note:
      'Observational historical-model uncertainty: The deterministic Hillel II fixed arithmetic calendar was standardized in late antiquity (4th–9th c. CE). Biblical and Second Temple practice relied on visual lunar-crescent sighting in Jerusalem and agricultural barley (aviv) intercalation, so historical 1st-century or OT dates could differ by 1–2 days or 1 intercalary lunar month. Remember Hebrew calendar days run sunset-to-sunset.',
  };
}

// === @section:places ===
interface AtlasPlaceEntry {
  placeLookup: string;
  displayTitle: string;
  aliases: string[];
  featureType: string | null;
  precision: string | null;
  latitude: number | null;
  longitude: number | null;
  verseCount: number;
  openBibleUri: string | null;
  pleiadesUri: string | null;
  strongs?: string[];
  hebrew?: string;
  greek?: string;
}

interface PlacesIndexShard {
  sources?: string[];
  places?: AtlasPlaceEntry[];
}

const CORE_PLACES_FALLBACK: readonly AtlasPlaceEntry[] = [
  { placeLookup: 'jerusalem_636', displayTitle: 'Jerusalem', aliases: ['Zion', 'Jebus', 'Salem', 'City of God'], featureType: 'City', precision: 'Precise', latitude: 31.777189, longitude: 35.234978, verseCount: 754, openBibleUri: 'https://www.openbible.info/geo/ancient/a15257a', pleiadesUri: 'https://pleiades.stoa.org/places/687928', strongs: ['H3389', 'H8004', 'G2419', 'G2414', 'G4532'], hebrew: 'יְרוּשָׁלַיִם / שָׁלֵם', greek: 'Ἰερουσαλήμ / Σαλήμ' },
  { placeLookup: 'united-kingdom-of-israel_1301', displayTitle: 'Israel', aliases: ['United Kingdom of Israel', 'Northern Kingdom of Israel', 'Land of Israel'], featureType: 'Region', precision: null, latitude: 31.95, longitude: 35.2, verseCount: 9, openBibleUri: null, pleiadesUri: null, strongs: ['H3478', 'G2474'], hebrew: 'יִשְׂרָאֵל', greek: 'Ἰσραήλ' },
  { placeLookup: 'capernaum_274', displayTitle: 'Capernaum', aliases: ['Kefar Nahum'], featureType: 'City', precision: 'Precise', latitude: 32.880887, longitude: 35.575891, verseCount: 16, openBibleUri: 'https://www.openbible.info/geo/ancient/af2161c', pleiadesUri: 'https://pleiades.stoa.org/places/678231', strongs: ['G2584'], greek: 'Καφαρναούμ' },
  { placeLookup: 'jericho_634', displayTitle: 'Jericho', aliases: ['Tell es-Sultan'], featureType: 'City', precision: 'Precise', latitude: 31.871017, longitude: 35.444142, verseCount: 58, openBibleUri: 'https://www.openbible.info/geo/ancient/a231f80', pleiadesUri: 'https://pleiades.stoa.org/places/687917', strongs: ['H3405', 'G2410'], hebrew: 'יְרִיחוֹ', greek: 'Ἰεριχώ' },
  { placeLookup: 'bethlehem_218', displayTitle: 'Bethlehem', aliases: ['Bethlehem Ephrathah', 'City of David'], featureType: 'City', precision: 'Precise', latitude: 31.706999, longitude: 35.203153, verseCount: 32, openBibleUri: 'https://www.openbible.info/geo/ancient/a112427', pleiadesUri: 'https://pleiades.stoa.org/places/687856', strongs: ['H1035', 'H672', 'G965'], hebrew: 'בֵּית לֶחֶם', greek: 'Βηθλέεμ' },
  { placeLookup: 'ur_1189', displayTitle: 'Ur of the Chaldees', aliases: ['Ur', 'Tell el-Muqayyar'], featureType: 'City', precision: 'Precise', latitude: 30.962052, longitude: 46.103742, verseCount: 4, openBibleUri: 'https://www.openbible.info/geo/ancient/a6cf75c', pleiadesUri: null, strongs: ['H218'], hebrew: 'אוּר' },
  { placeLookup: 'egypt_362', displayTitle: 'Egypt', aliases: ['Mizraim'], featureType: 'Region', precision: 'Related-Surrounding', latitude: 30.108086, longitude: 31.33822, verseCount: 564, openBibleUri: 'https://www.openbible.info/geo/ancient/af301ca', pleiadesUri: 'https://pleiades.stoa.org/places/981503', strongs: ['H4714', 'G125'], hebrew: 'מִצְרַיִם', greek: 'Αἴγυπτος' },
  { placeLookup: 'babylon_151', displayTitle: 'Babylon', aliases: ['Babel', 'Babil'], featureType: 'City', precision: 'Center', latitude: 32.537297, longitude: 44.424978, verseCount: 255, openBibleUri: 'https://www.openbible.info/geo/ancient/ab8fdbc', pleiadesUri: 'https://pleiades.stoa.org/places/893951', strongs: ['H894', 'G897'], hebrew: 'בָּבֶל', greek: 'Βαβυλών' },
  { placeLookup: 'athens_118', displayTitle: 'Athens', aliases: [], featureType: 'City', precision: 'Precise', latitude: 37.971647, longitude: 23.723955, verseCount: 5, openBibleUri: 'https://www.openbible.info/geo/ancient/a1fe6e7', pleiadesUri: 'https://pleiades.stoa.org/places/579885', strongs: ['G116'], greek: 'Ἀθῆναι' },
  { placeLookup: 'ephesus_400', displayTitle: 'Ephesus', aliases: [], featureType: 'City', precision: 'Precise', latitude: 37.940164, longitude: 27.342403, verseCount: 17, openBibleUri: 'https://www.openbible.info/geo/ancient/a5feb15', pleiadesUri: 'https://pleiades.stoa.org/places/599612', strongs: ['G2181'], greek: 'Ἔφεσος' },
  { placeLookup: 'corinth_306', displayTitle: 'Corinth', aliases: [], featureType: 'City', precision: 'Precise', latitude: 37.905642, longitude: 22.878614, verseCount: 6, openBibleUri: 'https://www.openbible.info/geo/ancient/a6f437a', pleiadesUri: 'https://pleiades.stoa.org/places/570182', strongs: ['G2882'], greek: 'Κόρινθος' },
  { placeLookup: 'rome_1013', displayTitle: 'Rome', aliases: [], featureType: 'City', precision: 'Precise', latitude: 41.9, longitude: 12.483333, verseCount: 9, openBibleUri: 'https://www.openbible.info/geo/ancient/afc8e7a', pleiadesUri: 'https://pleiades.stoa.org/places/423025', strongs: ['G4516'], greek: 'Ῥώμη' },
];

const placesCache = createShardCache<PlacesIndexShard>();

export async function queryMcpPlaces(
  params: { query?: string; strongs?: string; limit?: number },
  corpusUrl?: string,
): Promise<Record<string, unknown>> {
  const baseUrl = getCorpusBaseUrl(corpusUrl);
  const shard = await loadCachedShard<PlacesIndexShard>(placesCache, baseUrl, '/data/bible-places-index.json');
  const usingShard = Boolean(shard && Array.isArray(shard.places) && shard.places.length > 0);

  const byLookup = new Map<string, AtlasPlaceEntry>();
  if (usingShard) {
    for (const p of shard!.places!) {
      if (p && p.placeLookup) byLookup.set(p.placeLookup, p);
    }
  }
  for (const fb of CORE_PLACES_FALLBACK) {
    const existing = byLookup.get(fb.placeLookup);
    if (!existing) {
      byLookup.set(fb.placeLookup, fb);
    } else {
      // Enrich shard entry with fallback Strong's / precision if absent
      const mergedStrongs = Array.from(new Set([...(existing.strongs ?? []), ...(fb.strongs ?? [])].map(normalizeStrongsCode).filter(Boolean)));
      byLookup.set(fb.placeLookup, {
        ...existing,
        ...(mergedStrongs.length > 0 ? { strongs: mergedStrongs } : {}),
        precision: existing.precision ?? fb.precision,
      });
    }
  }

  const allPlaces = [...byLookup.values()];
  const rawQ = (params.query ?? '').trim();
  const normalizePlaceText = (raw: string): string =>
    String(raw || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s\-_''`]+/g, '');
  const q = rawQ.toLowerCase();
  const qNorm = normalizePlaceText(rawQ);
  const normStrongs = normalizeStrongsCode(params.strongs || (/^[hg]0*\d+[a-z]?$/i.test(rawQ) ? rawQ : ''));
  const limit = Math.max(1, Math.min(30, Math.trunc(params.limit ?? 10)));

  const scored: Array<{ place: AtlasPlaceEntry; score: number }> = [];

  for (const place of allPlaces) {
    let score = 0;
    if (normStrongs) {
      const strongsHit = (place.strongs ?? []).some((s) => normalizeStrongsCode(s) === normStrongs);
      if (strongsHit) score += 100;
    }
    if (q && !(/^[hg]0*\d+[a-z]?$/i.test(q) && score > 0)) {
      const titleL = place.displayTitle.toLowerCase();
      const titleNorm = normalizePlaceText(place.displayTitle);
      const lookupL = place.placeLookup.toLowerCase();
      const lookupNorm = normalizePlaceText(place.placeLookup);
      const aliasHit = place.aliases.some((a) => a.toLowerCase() === q || (qNorm.length >= 2 && normalizePlaceText(a) === qNorm));
      const aliasPartial = !aliasHit && place.aliases.some((a) => a.toLowerCase().includes(q) || (qNorm.length >= 2 && normalizePlaceText(a).includes(qNorm)));
      if (titleL === q || lookupL === q || (qNorm.length >= 2 && (titleNorm === qNorm || lookupNorm === qNorm))) score += 100;
      else if (aliasHit) score += 85;
      else if (titleL.startsWith(q) || (qNorm.length >= 2 && titleNorm.startsWith(qNorm))) score += 65;
      else if (
        titleL.includes(q) ||
        (qNorm.length >= 2 && (titleNorm.includes(qNorm) || lookupNorm.includes(qNorm))) ||
        aliasPartial ||
        lookupL.includes(q) ||
        (place.hebrew?.includes(rawQ) ?? false) ||
        (place.greek?.includes(rawQ) ?? false)
      ) {
        score += 40;
      }
    }
    if (!q && !normStrongs) {
      score = 10 + Math.min(50, place.verseCount);
    }
    if (score > 0) {
      const boost = place.latitude !== null && place.longitude !== null ? 5 : 0;
      const countBoost = Math.min(20, Math.floor((place.verseCount ?? 0) / 25));
      scored.push({ place, score: score + boost + countBoost });
    }
  }

  scored.sort((a, b) => b.score - a.score || (b.place.verseCount ?? 0) - (a.place.verseCount ?? 0));

  const results = scored.slice(0, limit).map(({ place }) => ({
    place_lookup: place.placeLookup,
    name: place.displayTitle,
    aliases: place.aliases,
    feature_type: place.featureType,
    precision: place.precision,
    latitude: place.latitude,
    longitude: place.longitude,
    verse_count: place.verseCount,
    strongs: place.strongs ?? [],
    hebrew: place.hebrew ?? null,
    greek: place.greek ?? null,
    provenance: {
      open_bible_uri: place.openBibleUri,
      pleiades_uri: place.pleiadesUri,
    },
  }));

  return {
    status: results.length > 0 ? 'ok' : 'not_found',
    source: usingShard ? 'corpus_shard+fallback' : 'fallback_only',
    total_matches: scored.length,
    places: results,
    provenance_sources: shard?.sources ?? [
      'robertrouse/theographic-bible-metadata (CC BY-SA 4.0)',
      'BradyStephenson/bible-data (CC BY 4.0)',
      'OpenBible.info Ancient Places (CC BY 4.0)',
    ],
    epistemic_note:
      'Coordinates reflect scholarly/archaeological identifications (OpenBible.info & Pleiades). Unlocated or symbolic places intentionally retain null coordinates.',
  };
}
