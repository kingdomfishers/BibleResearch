// scripts/build-psalms-mapping.mjs
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
  const lxxWords = await postgrestSelectAll(
    'lxx_swete_words?book_no=eq.27&ordinal=lte.5&select=chapter,verse_nr,ordinal,word_text&order=chapter,verse_nr,ordinal'
  );
  const lxxVersesByCh = {};
  for (const w of lxxWords) {
    if (!lxxVersesByCh[w.chapter]) lxxVersesByCh[w.chapter] = {};
    if (!lxxVersesByCh[w.chapter][w.verse_nr]) lxxVersesByCh[w.chapter][w.verse_nr] = [];
    lxxVersesByCh[w.chapter][w.verse_nr].push(w.word_text);
  }

  const mtVerses = await postgrestSelectAll(
    'verses?book=eq.19&select=id,chapter,verse_nr&order=chapter,verse_nr'
  );
  const mtVersesByCh = {};
  for (const v of mtVerses) {
    if (!mtVersesByCh[v.chapter]) mtVersesByCh[v.chapter] = [];
    mtVersesByCh[v.chapter].push(v);
  }

  let totalMapped = 0;
  let unmappedVerses = [];

  for (let mtCh = 1; mtCh <= 150; mtCh++) {
    const mtList = mtVersesByCh[mtCh] || [];
    const hasMtV0 = mtList.some(v => v.verse_nr === 0);

    for (const v of mtList) {
      let lxxCh = mtCh;
      let targetVnr = null;
      let mappingKind = 'same_reference';
      let rule = '';

      // Special Psalm mappings
      if (mtCh === 9) {
        lxxCh = 9;
        if (v.verse_nr === 0) { targetVnr = 1; mappingKind = 'superscription_title_verse'; }
        else { targetVnr = v.verse_nr + 1; mappingKind = 'psalm_numbering_shift'; }
      } else if (mtCh === 10) {
        lxxCh = 9;
        targetVnr = v.verse_nr + 21; // MT 10:1..18 -> LXX 9:22..39
        mappingKind = 'psalm_numbering_shift';
      } else if (mtCh === 114) {
        lxxCh = 113;
        targetVnr = v.verse_nr; // MT 114:1..8 -> LXX 113:1..8
        mappingKind = 'psalm_numbering_shift';
      } else if (mtCh === 115) {
        lxxCh = 113;
        targetVnr = v.verse_nr + 8; // MT 115:1..18 -> LXX 113:9..26
        mappingKind = 'psalm_numbering_shift';
      } else if (mtCh === 116) {
        if (v.verse_nr <= 9) {
          lxxCh = 114;
          targetVnr = v.verse_nr;
          mappingKind = 'psalm_numbering_shift';
        } else {
          lxxCh = 115;
          targetVnr = v.verse_nr - 9;
          mappingKind = 'psalm_numbering_shift';
        }
      } else if (mtCh === 147) {
        if (v.verse_nr <= 11) {
          lxxCh = 146;
          targetVnr = v.verse_nr;
          mappingKind = 'psalm_numbering_shift';
        } else {
          lxxCh = 147;
          targetVnr = v.verse_nr - 11;
          mappingKind = 'psalm_numbering_shift';
        }
      } else {
        // General chapter shift
        if (mtCh >= 1 && mtCh <= 8) lxxCh = mtCh;
        else if (mtCh >= 11 && mtCh <= 113) lxxCh = mtCh - 1;
        else if (mtCh >= 117 && mtCh <= 146) lxxCh = mtCh - 1;
        else if (mtCh >= 148 && mtCh <= 150) lxxCh = mtCh;

        const lxxMap = lxxVersesByCh[lxxCh] || {};
        const lxxV1Words = lxxMap[1] || [];
        const lxxV1Text = lxxV1Words.join(' ');
        const isLxxV1Title = /^(Εἰς|Ψαλμὸς|ᾨδὴ|Τῷ|Προσευχὴ|Στηλογραφία|Συνέσεως|Αἴνεσις|Ἐξομολόγησις)/i.test(lxxV1Text)
          && !/^Κύριος ποιμαίνει/i.test(lxxV1Text)
          && !/^Μακάριος/i.test(lxxV1Text)
          && !/^Ἵνα τί/i.test(lxxV1Text);

        if (v.verse_nr === 0) {
          if (isLxxV1Title) {
            targetVnr = 1;
            mappingKind = 'superscription_title_verse';
          } else if (lxxMap[32]) {
            targetVnr = 32;
            mappingKind = 'superscription_title_verse';
          } else {
            targetVnr = null;
            mappingKind = 'unmatched_hebrew';
          }
        } else {
          if (isLxxV1Title) {
            targetVnr = v.verse_nr + 1;
            mappingKind = (lxxCh === mtCh) ? 'versification_shift' : 'psalm_numbering_shift';
          } else {
            targetVnr = v.verse_nr;
            mappingKind = (lxxCh === mtCh) ? 'same_reference' : 'psalm_numbering_shift';
          }
        }
      }

      const lxxMap = lxxVersesByCh[lxxCh] || {};
      if (targetVnr !== null && lxxMap[targetVnr]) {
        totalMapped++;
      } else {
        unmappedVerses.push({
          mt: `${mtCh}:${v.verse_nr}`,
          lxx: `${lxxCh}:${targetVnr}`,
          kind: mappingKind,
          reason: targetVnr ? 'Target verse not in Swete' : 'No title verse in Swete',
        });
      }
    }
  }

  console.log(`Total mapped: ${totalMapped}, unmapped: ${unmappedVerses.length}`);
  if (unmappedVerses.length > 0) {
    console.log('Sample unmapped:', unmappedVerses.slice(0, 15));
  }
}

main().catch(console.error);
