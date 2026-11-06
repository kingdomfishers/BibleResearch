// scripts/audit-unmapped-verse-map.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

async function main() {
  const query = `
    SELECT 
      m.id,
      m.canonical_verse_id,
      v.book,
      v.chapter as heb_ch,
      v.verse_nr as heb_v,
      m.lxx_book_no,
      m.lxx_chapter,
      m.lxx_verse_nr,
      m.mapping_kind,
      m.rule_citation
    FROM public.hebrew_lxx_verse_map m
    JOIN public.verses v ON v.id = m.canonical_verse_id
    LEFT JOIN public.lxx_swete_words w ON w.book_no = m.lxx_book_no
      AND w.chapter = m.lxx_chapter
      AND w.verse_nr = m.lxx_verse_nr
    WHERE w.id IS NULL AND m.lxx_book_no IS NOT NULL
    ORDER BY v.book, v.chapter, v.verse_nr;
  `;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_syntax_tree_v1`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_book: 1, p_chapter: 1, p_verse: 1 }),
  });
  console.log('Connected to Supabase.');
}

main().catch(console.error);
