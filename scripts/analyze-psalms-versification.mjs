// scripts/analyze-psalms-versification.mjs
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

async function postgrestSelectAll(endpoint) {
  let all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}${sep}limit=${limit}&offset=${offset}`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Fetch failed HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.length) break;
    all = all.concat(data);
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

async function main() {
  console.log('Fetching Swete Psalm verses...');
  const lxxWords = await postgrestSelectAll('lxx_swete_words?book_no=eq.27&ordinal=eq.1&select=chapter,verse_nr,word_text&order=chapter,verse_nr');
  const lxxVersesByCh = {};
  for (const w of lxxWords) {
    if (!lxxVersesByCh[w.chapter]) lxxVersesByCh[w.chapter] = [];
    lxxVersesByCh[w.chapter].push({ vnr: w.verse_nr, word: w.word_text });
  }

  console.log('Fetching MT Psalm verses...');
  const mtVerses = await postgrestSelectAll('verses?book=eq.19&select=id,chapter,verse_nr&order=chapter,verse_nr');
  const mtVersesByCh = {};
  for (const v of mtVerses) {
    if (!mtVersesByCh[v.chapter]) mtVersesByCh[v.chapter] = [];
    mtVersesByCh[v.chapter].push(v);
  }

  console.log(`LXX chapters: ${Object.keys(lxxVersesByCh).length}, MT chapters: ${Object.keys(mtVersesByCh).length}`);

  // Test mapping for each MT chapter
  let titleShiftChapters = 0;
  let exactChapters = 0;

  for (let ch = 1; ch <= 150; ch++) {
    let lxxCh = ch;
    if (ch >= 1 && ch <= 8) lxxCh = ch;
    else if (ch === 9 || ch === 10) lxxCh = 9;
    else if (ch >= 11 && ch <= 113) lxxCh = ch - 1;
    else if (ch === 114 || ch === 115) lxxCh = 113;
    else if (ch === 116) lxxCh = 114;
    else if (ch >= 117 && ch <= 146) lxxCh = ch - 1;
    else if (ch === 147) lxxCh = 146;
    else if (ch >= 148 && ch <= 150) lxxCh = ch;

    const mtList = mtVersesByCh[ch] || [];
    const lxxList = lxxVersesByCh[lxxCh] || [];

    const hasMtV0 = mtList.some(v => v.verse_nr === 0);
    const lxxV1 = lxxList.find(v => v.vnr === 1);
    const lxxMaxV = Math.max(...lxxList.map(v => v.vnr));
    const mtMaxV = Math.max(...mtList.map(v => v.verse_nr));

    const isTitleWord = lxxV1 && /^(Εἰς|Ψαλμὸς|ᾨδὴ|Τῷ|Προσευχὴ|Στηλογραφία|Συνέσεως)/i.test(lxxV1.word);

    console.log(`MT ${ch} (${mtList.length} v, max ${mtMaxV}, v0=${hasMtV0}) -> LXX ${lxxCh} (${lxxList.length} v, max ${lxxMaxV}, v1_word=${lxxV1?.word}, isTitle=${isTitleWord})`);
  }
}

main().catch(console.error);
