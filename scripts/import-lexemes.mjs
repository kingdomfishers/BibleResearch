import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const env = Object.fromEntries((await fs.readFile('.env', 'utf8')).split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
  }));

const url = env.VITE_SUPABASE_URL;
const readKey = env.VITE_SUPABASE_ANON_KEY;
const writeKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run') || !writeKey;

console.log('Fetching existing curated lexemes to preserve existing keys & notes...');
const existingResp = await fetch(`${url}/rest/v1/lexemes?select=*&id=lte.15&order=id.asc`, {
  headers: { apikey: readKey },
});
assert.equal(existingResp.status, 200, 'Could not fetch existing lexemes');
const existingRows = await existingResp.json();
console.log(`Found ${existingRows.length} curated lexemes in public.lexemes.`);

const existingByExt = new Map(existingRows.map(r => [r.extended_strongs, r]));
const existingByKey = new Map(existingRows.map(r => [r.lexeme_key, r]));

function getBaseStrongs(estrong) {
  const m = estrong.match(/^([HG])0*(\d+)/i);
  if (!m) return estrong;
  return m[1].toUpperCase() + m[2];
}

function parseFile(fn, isGreek) {
  const lines = fn.split(/\r?\n/).filter(l => /^[HG]\d/.test(l));
  const results = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const parts = lines[idx].split('\t');
    const estrong = parts[0]?.trim() || '';
    const dstrongRaw = parts[1]?.trim() || '';
    const dstrongCode = dstrongRaw.split(/[\s=]/)[0];
    const ustrong = parts[2]?.trim() || null;
    let lemma = parts[3]?.trim() || '';
    let translit = parts[4]?.trim() || '';
    const morph = parts[5]?.trim() || '';
    let gloss = parts[6]?.trim() || '';
    // Licensing rule (DATA_SOURCES.md): TBESH col 7 ("Meaning") derives from Online Bible
    // and MUST NOT be imported. TBESG col 7 (Abbott-Smith / Middle Liddell / STEP) is CC BY 4.0.
    const meaning = isGreek ? (parts[7]?.trim() || null) : null;

    if (!lemma) {
      const m = meaning?.match(/<b>([^<]+)<\/b>/);
      lemma = m ? m[1].split(',')[0].trim() : translit || estrong;
    }
    if (!gloss) {
      const m = meaning?.match(/<b>=\s*[^,]+,\s*([^<]+)<\/b>/);
      gloss = m ? m[1].trim() : translit || 'untranslated';
    }

    const base_strongs = getBaseStrongs(estrong);
    let language = 'hbo';
    if (isGreek) {
      language = 'grc';
    } else if (morph.startsWith('A:') || morph === 'A') {
      language = 'arc';
    }

    // Preserve existing curated row's lexeme_key, primary_gloss, and homograph_note if matched
    const existing = existingByExt.get(dstrongCode) || existingByKey.get(dstrongCode);
    const lexeme_key = existing ? existing.lexeme_key : dstrongCode;
    const primary_gloss = existing ? existing.primary_gloss : gloss;
    const stepRelMarker = !isGreek && dstrongRaw && /=\s+[A-Za-z]/.test(dstrongRaw)
      ? `STEP dStrong relation: ${dstrongRaw.replace(/^[HG0-9A-Za-z]+\s*/, '')}${ustrong ? ` ${ustrong}` : ''}`
      : null;
    const homograph_note = existing?.homograph_note ?? (
      isGreek && meaning
        ? meaning.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
        : stepRelMarker
    );

    results.push({
      lexeme_key,
      language,
      base_strongs,
      extended_strongs: dstrongCode,
      disambiguated_strongs: dstrongRaw || null,
      unified_strongs: ustrong,
      original_lemma: lemma,
      transliteration: translit || lemma,
      pos: morph || null,
      primary_gloss,
      homograph_note,
      source_release_id: 1,
    });
  }
  return results;
}

console.log('Reading STEP TBESH and TBESG lexicon files...');
const tbeshRaw = await fs.readFile('.artifacts/stepbible/TBESH.txt', 'utf8');
const tbesgRaw = await fs.readFile('.artifacts/stepbible/TBESG.txt', 'utf8');

const hebrewLexemes = parseFile(tbeshRaw, false);
const greekLexemes = parseFile(tbesgRaw, true);
console.log(`Parsed ${hebrewLexemes.length} Hebrew/Aramaic lexemes and ${greekLexemes.length} Greek lexemes.`);

// Combine and deduplicate by lexeme_key if any duplicate appears
const allLexemes = [];
const seenKeys = new Set();
for (const item of [...hebrewLexemes, ...greekLexemes]) {
  if (!seenKeys.has(item.lexeme_key)) {
    seenKeys.add(item.lexeme_key);
    allLexemes.push(item);
  }
}
console.log(`Total unique lexemes to ingest: ${allLexemes.length}`);
if (dryRun) {
  console.log('Dry-run complete (set SUPABASE_SERVICE_ROLE_KEY to execute privileged batch RPC).');
  process.exit(0);
}

// Ingest in batches of 200 with retry
const BATCH_SIZE = 200;
let totalIngested = 0;
const startedAt = performance.now();

async function postBatch(batch, batchNum) {
  let attempt = 0;
  while (attempt < 4) {
    try {
      const resp = await fetch(`${url}/rest/v1/rpc/ingest_lexemes_batch_v1`, {
        method: 'POST',
        headers: {
          apikey: writeKey,
          Authorization: `Bearer ${writeKey}`,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
        body: JSON.stringify({ p_batch: batch }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status} - ${errText}`);
      }

      const res = await resp.json();
      return res.count;
    } catch (err) {
      attempt++;
      if (attempt >= 4) throw err;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

for (let i = 0; i < allLexemes.length; i += BATCH_SIZE) {
  const batch = allLexemes.slice(i, i + BATCH_SIZE);
  const count = await postBatch(batch, i / BATCH_SIZE + 1);
  totalIngested += count;

  if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= allLexemes.length) {
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
    console.log(`Ingested ${Math.min(i + BATCH_SIZE, allLexemes.length)} / ${allLexemes.length} lexemes (${elapsed}s)...`);
  }
}

const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
console.log(`PASS: Ingested all ${allLexemes.length} STEP lexemes in ${duration}s.`);
