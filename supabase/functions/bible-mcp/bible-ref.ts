// Canonical 66-book Bible passage parser, validator, formatter, and expander.
// Pure Web/Deno TypeScript with zero Node-only imports.

export interface CanonicalBook {
  readonly id: number;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly chapter_max_verses: readonly number[];
}

export interface PassageSpan {
  book: number;
  chapter: number;
  start_verse: number;
  end_verse: number;
}

export interface VerseRef {
  book: number;
  chapter: number;
  verse: number;
}

export interface ParsedPassage {
  passages: PassageSpan[];
  normalized: string;
  verse_count: number;
}

export const CANONICAL_BOOKS: readonly CanonicalBook[] = [
  {
    id: 1,
    name: 'Genesis',
    aliases: ['genesis', 'gen', 'ge', 'gn'],
    chapter_max_verses: [31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67, 34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22, 33, 26],
  },
  {
    id: 2,
    name: 'Exodus',
    aliases: ['exodus', 'exod', 'ex', 'exo'],
    chapter_max_verses: [22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38],
  },
  {
    id: 3,
    name: 'Leviticus',
    aliases: ['leviticus', 'lev', 'le', 'lv'],
    chapter_max_verses: [17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34],
  },
  {
    id: 4,
    name: 'Numbers',
    aliases: ['numbers', 'num', 'nu', 'nm', 'nb'],
    chapter_max_verses: [54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30, 25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13],
  },
  {
    id: 5,
    name: 'Deuteronomy',
    aliases: ['deuteronomy', 'deut', 'de', 'dt'],
    chapter_max_verses: [46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25, 22, 19, 19, 26, 68, 29, 20, 30, 52, 29, 12],
  },
  {
    id: 6,
    name: 'Joshua',
    aliases: ['joshua', 'josh', 'jos', 'jsh'],
    chapter_max_verses: [18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33],
  },
  {
    id: 7,
    name: 'Judges',
    aliases: ['judges', 'judg', 'jdg', 'jg', 'jdgs'],
    chapter_max_verses: [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
  },
  {
    id: 8,
    name: 'Ruth',
    aliases: ['ruth', 'rut', 'rth', 'ru'],
    chapter_max_verses: [22, 23, 18, 22],
  },
  {
    id: 9,
    name: '1 Samuel',
    aliases: ['1samuel', '1sam', '1sa', '1sm', '1s', 'isamuel', 'isam'],
    chapter_max_verses: [28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29, 22, 44, 25, 12, 25, 11, 31, 13],
  },
  {
    id: 10,
    name: '2 Samuel',
    aliases: ['2samuel', '2sam', '2sa', '2sm', '2s', 'iisamuel', 'iisam'],
    chapter_max_verses: [27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39, 25],
  },
  {
    id: 11,
    name: '1 Kings',
    aliases: ['1kings', '1kgs', '1ki', '1kg', '1k', 'ikings', 'ikgs'],
    chapter_max_verses: [53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53],
  },
  {
    id: 12,
    name: '2 Kings',
    aliases: ['2kings', '2kgs', '2ki', '2kg', '2k', 'iikings', 'iikgs'],
    chapter_max_verses: [18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 21, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37, 20, 30],
  },
  {
    id: 13,
    name: '1 Chronicles',
    aliases: ['1chronicles', '1chron', '1chr', '1ch', 'ichronicles', 'ichr'],
    chapter_max_verses: [54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31, 31, 32, 34, 21, 30],
  },
  {
    id: 14,
    name: '2 Chronicles',
    aliases: ['2chronicles', '2chron', '2chr', '2ch', 'iichronicles', 'iichr'],
    chapter_max_verses: [17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23],
  },
  {
    id: 15,
    name: 'Ezra',
    aliases: ['ezra', 'ezr'],
    chapter_max_verses: [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
  },
  {
    id: 16,
    name: 'Nehemiah',
    aliases: ['nehemiah', 'neh', 'ne'],
    chapter_max_verses: [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
  },
  {
    id: 17,
    name: 'Esther',
    aliases: ['esther', 'esth', 'est', 'es'],
    chapter_max_verses: [22, 23, 15, 17, 14, 14, 10, 17, 32, 3],
  },
  {
    id: 18,
    name: 'Job',
    aliases: ['job', 'jb'],
    chapter_max_verses: [22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 24, 34, 17],
  },
  {
    id: 19,
    name: 'Psalms',
    aliases: ['psalms', 'psalm', 'psa', 'ps', 'pss', 'psm'],
    chapter_max_verses: [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6],
  },
  {
    id: 20,
    name: 'Proverbs',
    aliases: ['proverbs', 'prov', 'pro', 'prv', 'pr'],
    chapter_max_verses: [33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35, 34, 28, 28, 27, 28, 27, 33, 31],
  },
  {
    id: 21,
    name: 'Ecclesiastes',
    aliases: ['ecclesiastes', 'eccl', 'ecc', 'ec', 'qoh', 'qoheleth'],
    chapter_max_verses: [18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
  },
  {
    id: 22,
    name: 'Song of Solomon',
    aliases: ['songofsolomon', 'songofsongs', 'song', 'sos', 'sng', 'cant', 'canticles', 'so'],
    chapter_max_verses: [17, 17, 11, 16, 16, 13, 13, 14],
  },
  {
    id: 23,
    name: 'Isaiah',
    aliases: ['isaiah', 'isa', 'is'],
    chapter_max_verses: [31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24],
  },
  {
    id: 24,
    name: 'Jeremiah',
    aliases: ['jeremiah', 'jer', 'je', 'jr'],
    chapter_max_verses: [19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47, 39, 46, 64, 34],
  },
  {
    id: 25,
    name: 'Lamentations',
    aliases: ['lamentations', 'lam', 'la'],
    chapter_max_verses: [22, 22, 66, 22, 22],
  },
  {
    id: 26,
    name: 'Ezekiel',
    aliases: ['ezekiel', 'ezek', 'ezk', 'eze'],
    chapter_max_verses: [28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 32, 31, 49, 27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24, 23, 35],
  },
  {
    id: 27,
    name: 'Daniel',
    aliases: ['daniel', 'dan', 'da', 'dn'],
    chapter_max_verses: [21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],
  },
  {
    id: 28,
    name: 'Hosea',
    aliases: ['hosea', 'hos', 'ho'],
    chapter_max_verses: [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
  },
  {
    id: 29,
    name: 'Joel',
    aliases: ['joel', 'jol', 'jl'],
    chapter_max_verses: [20, 32, 21],
  },
  {
    id: 30,
    name: 'Amos',
    aliases: ['amos', 'amo', 'am'],
    chapter_max_verses: [15, 16, 15, 13, 27, 14, 17, 14, 15],
  },
  {
    id: 31,
    name: 'Obadiah',
    aliases: ['obadiah', 'obad', 'oba', 'ob'],
    chapter_max_verses: [21],
  },
  {
    id: 32,
    name: 'Jonah',
    aliases: ['jonah', 'jon', 'jnh'],
    chapter_max_verses: [17, 10, 10, 11],
  },
  {
    id: 33,
    name: 'Micah',
    aliases: ['micah', 'mic', 'mc'],
    chapter_max_verses: [16, 13, 12, 13, 15, 16, 20],
  },
  {
    id: 34,
    name: 'Nahum',
    aliases: ['nahum', 'nah', 'nam', 'na'],
    chapter_max_verses: [15, 13, 19],
  },
  {
    id: 35,
    name: 'Habakkuk',
    aliases: ['habakkuk', 'hab', 'hb'],
    chapter_max_verses: [17, 20, 19],
  },
  {
    id: 36,
    name: 'Zephaniah',
    aliases: ['zephaniah', 'zeph', 'zep', 'zp'],
    chapter_max_verses: [18, 15, 20],
  },
  {
    id: 37,
    name: 'Haggai',
    aliases: ['haggai', 'hag', 'hg'],
    chapter_max_verses: [15, 23],
  },
  {
    id: 38,
    name: 'Zechariah',
    aliases: ['zechariah', 'zech', 'zec', 'zc'],
    chapter_max_verses: [21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
  },
  {
    id: 39,
    name: 'Malachi',
    aliases: ['malachi', 'mal', 'ml'],
    chapter_max_verses: [14, 17, 18, 6],
  },
  {
    id: 40,
    name: 'Matthew',
    aliases: ['matthew', 'matt', 'mat', 'mt'],
    chapter_max_verses: [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20],
  },
  {
    id: 41,
    name: 'Mark',
    aliases: ['mark', 'mrk', 'mk', 'mr'],
    chapter_max_verses: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
  },
  {
    id: 42,
    name: 'Luke',
    aliases: ['luke', 'luk', 'lk', 'lu'],
    chapter_max_verses: [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
  },
  {
    id: 43,
    name: 'John',
    aliases: ['john', 'jhn', 'jn', 'joh'],
    chapter_max_verses: [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  },
  {
    id: 44,
    name: 'Acts',
    aliases: ['acts', 'act', 'ac'],
    chapter_max_verses: [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31],
  },
  {
    id: 45,
    name: 'Romans',
    aliases: ['romans', 'rom', 'ro', 'rm'],
    chapter_max_verses: [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
  },
  {
    id: 46,
    name: '1 Corinthians',
    aliases: ['1corinthians', '1cor', '1co', 'icorinthians', 'icor'],
    chapter_max_verses: [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
  },
  {
    id: 47,
    name: '2 Corinthians',
    aliases: ['2corinthians', '2cor', '2co', 'iicorinthians', 'iicor'],
    chapter_max_verses: [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 13],
  },
  {
    id: 48,
    name: 'Galatians',
    aliases: ['galatians', 'gal', 'ga'],
    chapter_max_verses: [24, 21, 29, 31, 26, 18],
  },
  {
    id: 49,
    name: 'Ephesians',
    aliases: ['ephesians', 'ephes', 'eph'],
    chapter_max_verses: [23, 22, 21, 32, 33, 24],
  },
  {
    id: 50,
    name: 'Philippians',
    aliases: ['philippians', 'phil', 'php', 'pp'],
    chapter_max_verses: [30, 30, 21, 23],
  },
  {
    id: 51,
    name: 'Colossians',
    aliases: ['colossians', 'col', 'co'],
    chapter_max_verses: [29, 23, 25, 18],
  },
  {
    id: 52,
    name: '1 Thessalonians',
    aliases: ['1thessalonians', '1thess', '1thes', '1th', 'ithessalonians', 'ithess'],
    chapter_max_verses: [10, 20, 13, 18, 28],
  },
  {
    id: 53,
    name: '2 Thessalonians',
    aliases: ['2thessalonians', '2thess', '2thes', '2th', 'iithessalonians', 'iithess'],
    chapter_max_verses: [12, 17, 18],
  },
  {
    id: 54,
    name: '1 Timothy',
    aliases: ['1timothy', '1tim', '1ti', '1tm', 'itimothy', 'itim'],
    chapter_max_verses: [20, 15, 16, 16, 25, 21],
  },
  {
    id: 55,
    name: '2 Timothy',
    aliases: ['2timothy', '2tim', '2ti', '2tm', 'iitimothy', 'iitim'],
    chapter_max_verses: [18, 26, 17, 22],
  },
  {
    id: 56,
    name: 'Titus',
    aliases: ['titus', 'tit', 'ti'],
    chapter_max_verses: [16, 15, 15],
  },
  {
    id: 57,
    name: 'Philemon',
    aliases: ['philemon', 'philem', 'phlm', 'phm'],
    chapter_max_verses: [25],
  },
  {
    id: 58,
    name: 'Hebrews',
    aliases: ['hebrews', 'heb', 'he'],
    chapter_max_verses: [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
  },
  {
    id: 59,
    name: 'James',
    aliases: ['james', 'jas', 'jam', 'jm'],
    chapter_max_verses: [27, 26, 18, 17, 20],
  },
  {
    id: 60,
    name: '1 Peter',
    aliases: ['1peter', '1pet', '1pe', '1pt', '1p', 'ipeter', 'ipet'],
    chapter_max_verses: [25, 25, 22, 19, 14],
  },
  {
    id: 61,
    name: '2 Peter',
    aliases: ['2peter', '2pet', '2pe', '2pt', '2p', 'iipeter', 'iipet'],
    chapter_max_verses: [21, 22, 18],
  },
  {
    id: 62,
    name: '1 John',
    aliases: ['1john', '1jhn', '1jn', '1jo', '1j', 'ijohn', 'ijn'],
    chapter_max_verses: [10, 29, 24, 21, 21],
  },
  {
    id: 63,
    name: '2 John',
    aliases: ['2john', '2jhn', '2jn', '2jo', '2j', 'iijohn', 'iijn'],
    chapter_max_verses: [13],
  },
  {
    id: 64,
    name: '3 John',
    aliases: ['3john', '3jhn', '3jn', '3jo', '3j', 'iiijohn', 'iiijn'],
    chapter_max_verses: [15],
  },
  {
    id: 65,
    name: 'Jude',
    aliases: ['jude', 'jud', 'jd'],
    chapter_max_verses: [25],
  },
  {
    id: 66,
    name: 'Revelation',
    aliases: ['revelation', 'revelations', 'rev', 're', 'rv', 'apocalypse'],
    chapter_max_verses: [20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 18, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21],
  },
];

const BOOK_BY_ID = new Map<number, CanonicalBook>();
const BOOK_BY_ALIAS = new Map<string, CanonicalBook>();

for (const book of CANONICAL_BOOKS) {
  BOOK_BY_ID.set(book.id, book);
  for (const alias of book.aliases) {
    BOOK_BY_ALIAS.set(alias, book);
  }
}

function normalizeBookKey(raw: string): string {
  return raw.toLowerCase().replace(/[\s.]+/g, '');
}

function resolveBookByName(raw: string): CanonicalBook | null {
  const key = normalizeBookKey(raw);
  if (!key) return null;
  return BOOK_BY_ALIAS.get(key) ?? null;
}

function isValidVerse(book: CanonicalBook, chapter: number, verse: number): boolean {
  if (!Number.isInteger(chapter) || !Number.isInteger(verse)) return false;
  if (chapter < 1 || chapter > book.chapter_max_verses.length) return false;
  const maxVerse = book.chapter_max_verses[chapter - 1];
  const minVerse = book.id === 19 ? 0 : 1; // Preserve verse === 0 for Psalm headings
  return verse >= minVerse && verse <= maxVerse;
}

function isValidChapter(book: CanonicalBook, chapter: number): boolean {
  return Number.isInteger(chapter) && chapter >= 1 && chapter <= book.chapter_max_verses.length;
}

export function bookName(book: number): string | null {
  return BOOK_BY_ID.get(book)?.name ?? null;
}

export function formatRef(book: number, chapter: number, verse: number, endVerse?: number): string {
  const name = bookName(book) ?? `Book ${book}`;
  if (endVerse !== undefined && endVerse !== verse) {
    return `${name} ${chapter}:${verse}-${endVerse}`;
  }
  return `${name} ${chapter}:${verse}`;
}

export function expandPassageRefs(spans: PassageSpan[]): VerseRef[] {
  const refs: VerseRef[] = [];
  const seen = new Set<string>();

  for (const span of spans) {
    const book = BOOK_BY_ID.get(span.book);
    if (!book || !isValidChapter(book, span.chapter)) continue;
    const maxVerse = book.chapter_max_verses[span.chapter - 1];
    const minVerse = book.id === 19 ? 0 : 1;
    const start = Math.max(minVerse, span.start_verse);
    const end = Math.min(maxVerse, span.end_verse);
    if (start > end) continue;

    for (let verse = start; verse <= end; verse++) {
      const key = `${span.book}:${span.chapter}:${verse}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ book: span.book, chapter: span.chapter, verse });
      }
    }
  }

  return refs;
}

interface Endpoint {
  book: CanonicalBook;
  chapter: number;
  verse: number | null; // null means whole chapter
}

interface ParseContext {
  book: CanonicalBook;
  chapter: number;
  hadVerse: boolean;
}

function parseFullEndpoint(raw: string): Endpoint | null {
  const s = raw.trim();
  if (!s) return null;

  // Numeric book:chapter:verse (e.g. "1:6:14")
  const numMatch = s.match(/^(\d{1,2})\s*:\s*(\d+)\s*:\s*(\d+)$/);
  if (numMatch) {
    const bookId = Number(numMatch[1]);
    const chapter = Number(numMatch[2]);
    const verse = Number(numMatch[3]);
    const book = BOOK_BY_ID.get(bookId);
    if (!book || !isValidVerse(book, chapter, verse)) return null;
    return { book, chapter, verse };
  }

  // Named book + chapter(:verse)? (space optional, e.g. "1COR12:10", "Gen 6:14", "Jude 5")
  const namedMatch = s.match(/^(.+?)\s*(\d+(?:\s*:\s*\d+)?)$/);
  if (!namedMatch) return null;

  const bookPart = namedMatch[1].trim();
  if (!/[a-zA-Z]/.test(bookPart)) return null;

  const book = resolveBookByName(bookPart);
  if (!book) return null;

  const numPart = namedMatch[2].replace(/\s+/g, '');
  const colonIdx = numPart.indexOf(':');
  if (colonIdx !== -1) {
    const chapter = Number(numPart.slice(0, colonIdx));
    const verse = Number(numPart.slice(colonIdx + 1));
    if (!isValidVerse(book, chapter, verse)) return null;
    return { book, chapter, verse };
  }

  const n = Number(numPart);
  // Single-chapter books: "Jude 5", "Obadiah 1" refer to verse n of chapter 1
  if (book.chapter_max_verses.length === 1) {
    if (!isValidVerse(book, 1, n)) return null;
    return { book, chapter: 1, verse: n };
  }

  if (!isValidChapter(book, n)) return null;
  return { book, chapter: n, verse: null };
}

function parseLhsWithContext(
  raw: string,
  context: ParseContext | null,
  fromSemicolon: boolean
): Endpoint | null {
  const s = raw.trim();
  if (!s) return null;

  const full = parseFullEndpoint(s);
  if (full) return full;

  if (!context) return null;

  // Continuation "chapter:verse" using previous book
  const cvMatch = s.match(/^(\d+)\s*:\s*(\d+)$/);
  if (cvMatch) {
    const chapter = Number(cvMatch[1]);
    const verse = Number(cvMatch[2]);
    if (!isValidVerse(context.book, chapter, verse)) return null;
    return { book: context.book, chapter, verse };
  }

  // Continuation bare number
  const bareMatch = s.match(/^(\d+)$/);
  if (bareMatch) {
    const n = Number(bareMatch[1]);
    if (!fromSemicolon && context.hadVerse) {
      // Comma-separated verse in same book & chapter (e.g. "Gen 6:14, 16")
      if (!isValidVerse(context.book, context.chapter, n)) return null;
      return { book: context.book, chapter: context.chapter, verse: n };
    }
    if (!context.hadVerse) {
      // Whole-chapter list (e.g. "Gen 1, 3" or "Gen 1; 3")
      if (context.book.chapter_max_verses.length === 1) {
        if (!isValidVerse(context.book, 1, n)) return null;
        return { book: context.book, chapter: 1, verse: n };
      }
      if (!isValidChapter(context.book, n)) return null;
      return { book: context.book, chapter: n, verse: null };
    }
  }

  return null;
}

function buildRangeSpans(lhs: Endpoint, rhsRaw: string): PassageSpan[] | null {
  const s = rhsRaw.trim();
  if (!s) return null;

  const rhsFull = parseFullEndpoint(s);
  if (rhsFull) {
    if (rhsFull.book.id !== lhs.book.id) return null;
    return expandRangeEndpoints(lhs, rhsFull);
  }

  // RHS "chapter:verse" without book (e.g. "1 Cor 12:10-13:4")
  const cvMatch = s.match(/^(\d+)\s*:\s*(\d+)$/);
  if (cvMatch) {
    const chapter = Number(cvMatch[1]);
    const verse = Number(cvMatch[2]);
    if (!isValidVerse(lhs.book, chapter, verse)) return null;
    return expandRangeEndpoints(lhs, { book: lhs.book, chapter, verse });
  }

  // RHS bare number (verse if lhs had verse, else end chapter)
  const bareMatch = s.match(/^(\d+)$/);
  if (bareMatch) {
    const n = Number(bareMatch[1]);
    if (lhs.verse !== null) {
      if (!isValidVerse(lhs.book, lhs.chapter, n)) return null;
      return expandRangeEndpoints(lhs, { book: lhs.book, chapter: lhs.chapter, verse: n });
    }
    if (!isValidChapter(lhs.book, n)) return null;
    return expandRangeEndpoints(lhs, { book: lhs.book, chapter: n, verse: null });
  }

  return null;
}

function expandRangeEndpoints(lhs: Endpoint, rhs: Endpoint): PassageSpan[] | null {
  const book = lhs.book;
  const startCh = lhs.chapter;
  const endCh = rhs.chapter;
  if (startCh > endCh) return null;

  const startVerse = lhs.verse ?? 1;
  const endVerse = rhs.verse ?? book.chapter_max_verses[endCh - 1];

  if (startCh === endCh) {
    if (startVerse > endVerse) return null;
    return [{ book: book.id, chapter: startCh, start_verse: startVerse, end_verse: endVerse }];
  }

  const spans: PassageSpan[] = [];
  for (let ch = startCh; ch <= endCh; ch++) {
    const chMax = book.chapter_max_verses[ch - 1];
    const sv = ch === startCh ? startVerse : 1;
    const ev = ch === endCh ? endVerse : chMax;
    if (sv > ev) return null;
    spans.push({ book: book.id, chapter: ch, start_verse: sv, end_verse: ev });
  }
  return spans;
}

function formatNormalizedSpans(spans: PassageSpan[]): string {
  const parts: string[] = [];
  let i = 0;

  while (i < spans.length) {
    const first = spans[i];
    const book = BOOK_BY_ID.get(first.book)!;

    // Group contiguous cross-chapter spans within the same book
    let j = i;
    while (j + 1 < spans.length) {
      const curr = spans[j];
      const next = spans[j + 1];
      const currMax = book.chapter_max_verses[curr.chapter - 1];
      if (
        next.book === curr.book &&
        next.chapter === curr.chapter + 1 &&
        curr.end_verse === currMax &&
        next.start_verse === 1
      ) {
        j++;
      } else {
        break;
      }
    }

    const last = spans[j];
    if (j > i) {
      const firstIsFull = first.start_verse === 1;
      const lastMax = book.chapter_max_verses[last.chapter - 1];
      const lastIsFull = last.end_verse === lastMax;
      if (firstIsFull && lastIsFull && book.chapter_max_verses.length > 1) {
        parts.push(`${book.name} ${first.chapter}-${last.chapter}`);
      } else {
        parts.push(`${book.name} ${first.chapter}:${first.start_verse}-${last.chapter}:${last.end_verse}`);
      }
      i = j + 1;
      continue;
    }

    const chMax = book.chapter_max_verses[first.chapter - 1];
    if (first.start_verse === first.end_verse) {
      parts.push(`${book.name} ${first.chapter}:${first.start_verse}`);
    } else if (
      book.chapter_max_verses.length > 1 &&
      first.start_verse === 1 &&
      first.end_verse === chMax
    ) {
      parts.push(`${book.name} ${first.chapter}`);
    } else {
      parts.push(`${book.name} ${first.chapter}:${first.start_verse}-${first.end_verse}`);
    }
    i++;
  }

  return parts.join('; ');
}

export function parsePassageString(input: string): ParsedPassage | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[–—−]/g, '-').replace(/\s+/g, ' ');
  if (!cleaned) return null;

  const semiClauses = cleaned.split(';');
  const spans: PassageSpan[] = [];
  let context: ParseContext | null = null;

  for (const rawSemi of semiClauses) {
    const semiTrimmed = rawSemi.trim();
    if (!semiTrimmed) return null;

    const commaClauses = semiTrimmed.split(',');
    for (let idx = 0; idx < commaClauses.length; idx++) {
      const clause = commaClauses[idx].trim();
      if (!clause) return null;

      const fromSemicolon = idx === 0;
      const dashParts = clause.split('-');
      if (dashParts.length > 2) return null;

      if (dashParts.length === 1) {
        const ep = parseLhsWithContext(dashParts[0], context, fromSemicolon);
        if (!ep) return null;

        const maxVerse = ep.book.chapter_max_verses[ep.chapter - 1];
        spans.push({
          book: ep.book.id,
          chapter: ep.chapter,
          start_verse: ep.verse ?? 1,
          end_verse: ep.verse ?? maxVerse,
        });
        context = {
          book: ep.book,
          chapter: ep.chapter,
          hadVerse: ep.verse !== null,
        };
      } else {
        const lhs = parseLhsWithContext(dashParts[0], context, fromSemicolon);
        if (!lhs) return null;

        const rangeSpans = buildRangeSpans(lhs, dashParts[1]);
        if (!rangeSpans || rangeSpans.length === 0) return null;

        spans.push(...rangeSpans);
        const last = rangeSpans[rangeSpans.length - 1];
        context = {
          book: lhs.book,
          chapter: last.chapter,
          hadVerse: lhs.verse !== null || dashParts[1].includes(':'),
        };
      }
    }
  }

  if (spans.length === 0) return null;

  let verse_count = 0;
  for (const span of spans) {
    verse_count += span.end_verse - span.start_verse + 1;
  }

  return {
    passages: spans,
    normalized: formatNormalizedSpans(spans),
    verse_count,
  };
}

export function isPassageLike(input: string): boolean {
  return parsePassageString(input) !== null;
}
