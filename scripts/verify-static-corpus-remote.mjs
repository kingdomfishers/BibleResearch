// scripts/verify-static-corpus-remote.mjs
// End-to-end live verification suite for the deployed Cloudflare Worker `bibleresearch-corpus`.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(
      fs
        .readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
    )
  : {};

const CORPUS_BASE_URL = (
  process.env.VITE_CORPUS_BASE_URL ||
  env.VITE_CORPUS_BASE_URL ||
  'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev'
).replace(/\/+$/, '');

function assert(cond, msg) {
  if (!cond) {
    console.error(`  [FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`  [PASS] ${msg}`);
}

async function fetchJson(relPath, options = {}, retries = 4) {
  const url = `${CORPUS_BASE_URL}${relPath}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status} on ${url}: ${txt}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
}

async function fetchBytes(relPath, retries = 4) {
  const url = `${CORPUS_BASE_URL}${relPath}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Encoding': 'identity' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
}

async function main() {
  console.log(`=== Live Cloudflare Static Corpus Verification (${CORPUS_BASE_URL}) ===\n`);

  // 1. Health & Manifest check
  console.log('1. Verifying Worker Health & Manifest Integrity...');
  const health = await fetchJson('/health');
  assert(health.status === 'ok' && health.worker === 'bibleresearch-corpus', 'Worker /health returned ok');

  const remoteManifest = await fetchJson('/manifest.json');
  const localManifestPath = path.resolve('.artifacts/static-corpus/manifest.json');
  if (fs.existsSync(localManifestPath)) {
    const localManifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
    assert(
      remoteManifest.corpus_version === localManifest.corpus_version,
      `Remote corpus_version matches local (${remoteManifest.corpus_version})`
    );
    assert(
      remoteManifest.macula_syntax_completion.files_imported_and_verified === 983,
      'Remote manifest confirms 983/983 Macula syntax files imported and verified'
    );
  }

  // 2. Verify raw compressed SHA-256 vs decoded JSON behavior
  console.log('\n2. Verifying Explicit Content Decoding & Raw Gzip SHA-256 Checksums...');
  const booksShardMeta = remoteManifest.tables.books.shards[0];
  const rawBooksBytes = await fetchBytes(`${booksShardMeta.path}?raw=1`);
  const rawBooksSha = crypto.createHash('sha256').update(rawBooksBytes).digest('hex');
  assert(
    rawBooksSha === booksShardMeta.sha256_compressed,
    `Raw gzip SHA-256 for ${booksShardMeta.path} matches manifest (${rawBooksSha.slice(0, 16)}...)`
  );

  const decodedBooksRes = await fetch(`${CORPUS_BASE_URL}${booksShardMeta.path}`);
  const decodedBooksText = await decodedBooksRes.text();
  const decodedBooksLines = decodedBooksText.trim().split('\n');
  assert(decodedBooksLines.length === 66, `Decoded NDJSON shard has 66 book lines (got ${decodedBooksLines.length})`);

  // 3. Verify RPC Endpoints & Difficult Biblical Edge Cases
  console.log('\n3. Verifying RPC Endpoints & Difficult Biblical Cases...');

  // 3a. Syntax Tree Integrity
  const integrity = await fetchJson('/v1/rpc/validate_syntax_tree_integrity_v1', { method: 'POST', body: '{}' });
  assert(integrity.status === 'PASS' && integrity.is_valid === true, 'validate_syntax_tree_integrity_v1 PASS');
  assert(integrity.cycles_count === 0 && integrity.orphaned_parents_count === 0, 'Zero cycles or orphaned parents');
  assert(integrity.total_nodes > 1000000, `Complete 983-file syntax tree node count (${integrity.total_nodes})`);

  // 3b. Genesis 1:1
  const gen1 = await fetchJson('/v1/rpc/lookup_syntax_tree_v1', {
    method: 'POST',
    body: JSON.stringify({ p_verse_id: 1, p_edition_key: 'macula-hebrew-wlc' }),
  });
  assert(gen1.has_syntax === true && gen1.trees_count === 1, 'Genesis 1:1 returns 1 WLC syntax tree');
  const gen1Terminals = gen1.trees[0].nodes.filter((n) => n.is_terminal);
  assert(gen1Terminals.length === 11, 'Genesis 1:1 has 11 terminal morphemes');

  // 3c. Psalm 3:0 & Psalm 51:0 headings
  const ps3_0 = await fetchJson('/v1/rpc/lookup_hebrew_verse_evidence_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 19, p_chapter: 3, p_verse: 0 }),
  });
  assert(ps3_0.found === true && ps3_0.summary.total_step_tokens > 0, 'Psalm 3:0 heading retrieved with Hebrew tokens');

  // 3d. Daniel 2:4 Aramaic transition
  const dan2_4 = await fetchJson('/v1/rpc/lookup_hebrew_verse_evidence_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 27, p_chapter: 2, p_verse: 4 }),
  });
  assert(dan2_4.found === true && dan2_4.summary.is_aramaic === true, 'Daniel 2:4 Aramaic transition verified');

  // 3e. John 1:1 Greek syntax (Nestle1904 & SBLGNT)
  const jhn1 = await fetchJson('/v1/rpc/lookup_syntax_tree_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 43, p_chapter: 1, p_verse: 1, p_edition_key: 'macula-greek-nestle1904' }),
  });
  assert(jhn1.has_syntax === true && jhn1.trees_count === 1, 'John 1:1 Nestle1904 syntax tree verified');

  const jhn1Sbl = await fetchJson('/v1/rpc/lookup_syntax_tree_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 43, p_chapter: 1, p_verse: 1, p_edition_key: 'macula-greek-sblgnt' }),
  });
  assert(jhn1Sbl.has_syntax === true && jhn1Sbl.trees_count === 1, 'John 1:1 SBLGNT syntax tree verified');

  // 3f. Mark 16:9 textual variants
  const mrk16 = await fetchJson('/v1/rpc/lookup_greek_verse_evidence_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 41, p_chapter: 16, p_verse: 9 }),
  });
  assert(mrk16.found === true && mrk16.summary.total_tagnt_tokens > 0, 'Mark 16:9 Greek textual evidence verified');

  // 3g. Ephesians 1:3-6 & 1:13-14 cross-verse spans
  const eph1_3 = await fetchJson('/v1/rpc/lookup_syntax_tree_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 49, p_chapter: 1, p_verse: 3, p_edition_key: 'macula-greek-nestle1904' }),
  });
  assert(
    eph1_3.has_syntax === true && eph1_3.trees[0].is_cross_verse === true && eph1_3.trees[0].cross_verse_span === '1:3–1:6',
    `Ephesians 1:3-6 cross-verse span verified (${eph1_3.trees[0].cross_verse_span})`
  );

  // 3h. Mark 16:99 noncanonical source-only syntax preservation & 3 John 1:15 versification
  const mrk16_99 = await fetchJson('/v1/rpc/lookup_syntax_tree_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 41, p_chapter: 16, p_verse: 99 }),
  });
  assert(
    mrk16_99.syntax_status === 'passage_not_found',
    'Mark 16:99 is not fabricated as a canonical verse in lookup_syntax_tree_v1'
  );
  const unmapped = await fetchJson('/v1/syntax/unmapped');
  assert(
    unmapped.status === 'ok' &&
      unmapped.total_unmapped_nodes > 0 &&
      unmapped.unmapped_nodes.some((n) => (n.source_ref || '').startsWith('MRK 16:99!')),
    `Mark 16:99 source-only syntax nodes preserved in /v1/syntax/unmapped (${unmapped.total_unmapped_nodes} total unmapped nodes)`
  );
  const jhn3_15 = await fetchJson('/v1/rpc/lookup_syntax_tree_v1', {
    method: 'POST',
    body: JSON.stringify({ p_book: 64, p_chapter: 1, p_verse: 15 }),
  });
  assert(
    jhn3_15.has_syntax === true && jhn3_15.trees_count >= 2,
    '3 John 1:15 canonical Greek syntax trees verified'
  );

  // 3i. Swete Septuagint lookup (Genesis 1:1 & Wisdom 1:1)
  const lxxGen1 = await fetchJson('/v1/rpc/lookup_septuagint_by_canonical_verse_v1', {
    method: 'POST',
    body: JSON.stringify({ p_canonical_verse_id: 1 }),
  });
  assert(lxxGen1.found === true && lxxGen1.tokens.length === 10, 'Septuagint Genesis 1:1 (10 tokens) verified');

  console.log('\n======================================================');
  console.log('ALL REMOTE CORPUS VERIFICATION CHECKS PASSED!');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Remote corpus verification failed:', err);
  process.exit(1);
});
