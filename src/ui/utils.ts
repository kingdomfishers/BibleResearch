// @file: src/ui/utils.ts
// @feature: nav-selector
// @tables: none
// @candidates: none
// @toc: imports | logic:books | logic:reference | logic:gematria

// === @section:imports ===
import type { ActivePassage } from '../api/types';

// === @section:logic:books ===
export const BIBLE_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
  '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];
export const BOOK_NAMES = BIBLE_BOOKS;
export const BOOK_CHAPTERS = [
  50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,
  14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22,
];

// === @section:logic:reference ===
export const formatVerseRef = (p: ActivePassage) => `${BIBLE_BOOKS[p.book - 1]} ${p.chapter}:${p.verse}`;

export function parseAnchorPassage(label: string | null): ActivePassage | null {
  if (!label) return null;
  const match = /^([1-3]?\s*[a-zA-Z]+)\s+(\d+)[:\s]+(\d+)$/.exec(label.trim());
  if (!match) return null;
  const rawBook = match[1]!.toLowerCase();
  const bookIdx = BIBLE_BOOKS.findIndex(b => {
    const l = b.toLowerCase();
    return l === rawBook || l.replace('psalms', 'psalm') === rawBook;
  });
  if (bookIdx < 0) return null;
  return { book: bookIdx + 1, chapter: Number(match[2]), verse: Number(match[3]) };
}

// === @section:logic:gematria ===
const GEMATRIA_MAP: Record<string, number> = {
  // Hebrew consonants (Standard Mispar Hechrechi)
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50,
  'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90, 'ק': 100, 'ר': 200,
  'ש': 300, 'ת': 400,
  // Greek letters (Standard Isopsephy)
  'α': 1, 'β': 2, 'γ': 3, 'δ': 4, 'ε': 5, 'ϛ': 6, 'ϝ': 6, 'ζ': 7, 'η': 8, 'θ': 9,
  'ι': 10, 'κ': 20, 'λ': 30, 'μ': 40, 'ν': 50, 'ξ': 60, 'ο': 70, 'π': 80,
  'ϟ': 90, 'ρ': 100, 'σ': 200, 'ς': 200, 'τ': 300, 'υ': 400, 'φ': 500,
  'χ': 600, 'ψ': 700, 'ω': 800, 'ϡ': 900,
};

export function calculateGematria(word: string): number {
  if (!word) return 0;
  const norm = word.normalize('NFKD').toLowerCase().replace(/[\u0591-\u05C7\u0300-\u036F]/g, '');
  let sum = 0;
  for (const ch of norm) {
    sum += GEMATRIA_MAP[ch] ?? 0;
  }
  return sum;
}
