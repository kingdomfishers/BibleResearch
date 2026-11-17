#!/usr/bin/env node
/**
 * R12-01 read-only HTTP probe of a Corpus Worker (live or preview) for direct word evidence.
 * Posts the same query_relationships_v2 unified_lemma request the UI sends and prints the
 * returned source IDs, so results can be compared with the UI and with the MCP tool.
 * Usage: node scripts/verify-r12-live-direct.mjs [baseUrl]
 * No credentials are used or required; the endpoint is public corpus evidence only.
 */
import assert from 'node:assert/strict';

const base = (process.argv[2] || process.env.R12_CORPUS_URL || 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev').replace(/\/$/, '');
const cases = [
  { query: 'H7307', book: 1, chapter: 1, verse: 2, position: 9, expectLexicalPeers: ['H7308'] },
  { query: 'G3056', book: 43, chapter: 1, verse: 1, position: 5, expectLexicalPeers: [] },
];

let failed = 0;
for (const c of cases) {
  const { expectLexicalPeers, ...q } = c;
  const body = { op: 'unified_lemma', layers: ['lexical', 'contextual', 'lxx_translation'], lexical_direction: 'both', lexical_limit: 25, contextual_scope: 'all', contextual_limit: 5, lxx_limit: 25, release: 'r9b-v1.0', ...q };
  const t0 = Date.now();
  const res = await fetch(`${base}/v1/rpc/query_relationships_v2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => null);
  console.log(`\n== ${c.query} HTTP ${res.status} ${ms}ms status=${json?.status} focus=${json?.focus?.lemma_id} release=${json?.release_version ?? json?.release}`);
  try {
    assert.equal(res.status, 200);
    const lex = json.layers?.lexical;
    console.log(`lexical available=${lex?.available} total=${lex?.counts?.total_unfiltered}`);
    for (const it of lex?.items ?? []) {
      const p = it.peer ?? {};
      console.log(`  lex ${it.category} ${it.role} peer=${p.canonical_key ?? p.lemma_key ?? p.key} ext=${p.extended_strongs ?? ''} tier=${it.epistemic_tier} edge=${it.edge_id ?? it.relation_id ?? ''}`);
    }
    const ctx = json.layers?.contextual;
    console.log(`contextual total=${ctx?.counts?.total_neighbors}`, (ctx?.items ?? []).slice(0, 3).map(i => i.target_extended_strongs ?? i.target_lemma_key).join(','));
    const lxx = json.layers?.lxx_translation;
    console.log(`lxx candidates=${lxx?.counts?.candidate_count}`, (lxx?.items ?? []).map(i => (i.greek_lemma_keys ?? i.hebrew_lemma_keys ?? []).join('+') + `(${i.published_count})`).join(' '));
    const peers = (lex?.items ?? []).map(i => `${i.peer?.extended_strongs ?? ''} ${i.peer?.canonical_key ?? ''} ${i.peer?.lemma_key ?? ''}`).join(' ');
    for (const e of expectLexicalPeers) assert.ok(peers.includes(e), `expected lexical peer ${e}; got ${peers}`);
    assert.ok((lex?.counts?.total_unfiltered ?? 0) + (ctx?.counts?.total_neighbors ?? 0) > 0, 'no evidence at all');
    console.log('PASS');
  } catch (e) { failed++; console.log('FAIL', e.message); }
}
process.exit(failed ? 1 : 0);
