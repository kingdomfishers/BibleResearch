// @file: scripts/verify-r5-r6-e2e.mjs
// End-to-end verification for R5 (Cloudflare R3 graph release) + R6 (bible-mcp & Website R6 parity).
import fs from 'node:fs';
import path from 'node:path';

const CORPUS_BASE = process.env.CORPUS_URL || 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const MCP_BASE = process.env.MCP_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp';
const SITE_BASE = process.env.SITE_URL || '';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const timings = [];
async function timedFetch(label, url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const bytes = Buffer.byteLength(text, 'utf8');
  timings.push({ label, ms, bytes, status: res.status });
  return { res, text, ms, bytes };
}

async function cfQuery(label, body, rpcPath = '/api/relationships/v2/query') {
  const { res, text } = await timedFetch(label, `${CORPUS_BASE}${rpcPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  assert(res.ok, `${label}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

let rpcSeq = 1;
async function mcpCall(label, name, args) {
  const { res, text } = await timedFetch(label, `${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcSeq++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  assert(res.ok, `${label}: MCP HTTP ${res.status} ${text.slice(0, 200)}`);
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  const rpc = JSON.parse(dataLine ? dataLine.slice(6) : text);
  assert(!rpc.error, `${label}: MCP JSON-RPC error ${JSON.stringify(rpc.error)}`);
  return rpc.result.structuredContent ?? JSON.parse(rpc.result.content[0].text);
}

async function main() {
  // 1. Verify R3 local source artifacts baseline
  const r3Dir = path.resolve('.artifacts/relationships-v2');
  const manifest = JSON.parse(fs.readFileSync(path.join(r3Dir, 'manifest.json'), 'utf8'));
  const framesCount = fs.readFileSync(path.join(r3Dir, 'frames.jsonl'), 'utf8').trim().split('\n').length;
  const relsCount = fs.readFileSync(path.join(r3Dir, 'occurrence-relations.jsonl'), 'utf8').trim().split('\n').length;
  const sumsCount = fs.readFileSync(path.join(r3Dir, 'summaries', 'lemma-relation-summaries.jsonl'), 'utf8').trim().split('\n').length;
  assert(framesCount === 460, `Expected 460 R3 frames, got ${framesCount}`);
  assert(relsCount === 398, `Expected 398 R3 relations, got ${relsCount}`);
  assert(sumsCount === 335, `Expected 335 R3 summaries, got ${sumsCount}`);
  assert(manifest.rule_version === '1.2', `Expected rule_version 1.2, got ${manifest.rule_version}`);

  // 2. Verify Cloudflare static routes & integrity
  const activeRes = await timedFetch('cf:active', `${CORPUS_BASE}/v2/relationships/active.json`);
  assert(activeRes.res.ok, 'CF active.json failed');
  const active = JSON.parse(activeRes.text);
  assert(active.active_release === 'r3-v1.2', `Unexpected active_release ${active.active_release}`);

  const cfManifestPath = String(active.manifest_path || '/v2/relationships/r3-v1.2/manifest.json').replace(/\.gz$/, '');
  const cfManifestRes = await timedFetch('cf:manifest', `${CORPUS_BASE}${cfManifestPath}`);
  assert(cfManifestRes.res.ok, 'CF manifest.json failed');
  const cfManifest = JSON.parse(cfManifestRes.text);
  assert(
    cfManifest.counts?.frames_emitted === 460 &&
      cfManifest.counts?.occurrence_relations_emitted === 398 &&
      cfManifest.counts?.relation_summaries_total === 335,
    'CF manifest counts mismatch'
  );

  const b7Res = await timedFetch('cf:b7', `${CORPUS_BASE}/__integrity/b7`);
  assert(b7Res.res.ok, 'CF b7 canary failed');
  const b7 = JSON.parse(b7Res.text);
  assert(b7.status === 'PASS_CANARIES', `Unexpected B7 status: ${b7.status}`);

  // 3. Verify live bible-mcp health & tool catalog
  const healthRes = await timedFetch('mcp:health', `${MCP_BASE}/health`);
  assert(healthRes.res.ok, 'MCP /health failed');
  const health = JSON.parse(healthRes.text);
  assert(health.status === 'ok' && health.tools === 36, `Unexpected MCP health: ${JSON.stringify(health)}`);

  const mcpCov = await mcpCall('mcp:coverage', 'get_relationship_coverage_v2', {});
  assert(mcpCov.status === 'ok' && mcpCov.release_version === 'r3-v1.2', 'MCP coverage mismatch');
  assert(Array.isArray(mcpCov.supported_predicates) && mcpCov.supported_predicates.length === 6, 'Expected 6 R3 predicates in MCP coverage');

  // 4. Genesis 1:1 בָּרָא (lemma:H1254a) via position, lemma_id, and CF vs MCP parity
  const cfBaraPos = await cfQuery('cf:gen1:1#2', { op: 'lemma_relationships', book: 1, chapter: 1, verse: 1, position: 2, include_uncertain: false });
  assert(cfBaraPos.status === 'ok' && cfBaraPos.focus?.lemma_id === 'lemma:H1254a', 'GEN 1:1#2 did not resolve to lemma:H1254a');
  assert(cfBaraPos.resolved_occurrence?.word_position === 2, 'Resolved occurrence word_position mismatch');

  const mcpBara = await mcpCall('mcp:H1254a', 'get_word_relationships_v2', { lemma_id: 'lemma:H1254a', include_uncertain: false });
  assert(mcpBara.status === 'ok' && mcpBara.counts?.summaries_total === cfBaraPos.counts?.summaries_total, 'CF vs MCP H1254a count mismatch');
  const baraSumId = mcpBara.summaries?.[0]?.summary_id;
  assert(Boolean(baraSumId), 'H1254a missing summary_id');

  const [cfEv, mcpEv] = await Promise.all([
    cfQuery('cf:evidence', { op: 'evidence', summary_id: baraSumId, include_uncertain: false, limit: 10 }),
    mcpCall('mcp:evidence', 'get_word_relationships_v2', { summary_id: baraSumId, include_uncertain: false, limit: 10 }),
  ]);
  assert(cfEv.status === 'ok' && mcpEv.status === 'ok', 'Evidence drill-down failed');
  assert(cfEv.relations.length === mcpEv.relations.length && cfEv.relations.length >= 1, 'CF vs MCP evidence parity mismatch');
  for (const rel of mcpEv.relations) {
    assert(Boolean(rel.source_clause_id) && Boolean(rel.canonical_ref) && Boolean(rel.coords?.book), 'Evidence relation missing clause_id or canonical coords');
  }

  // 5. Genesis 1:2 & Hebrew homograph preservation (H776 vs lemma:H0776G)
  const [cfH776, mcpH776] = await Promise.all([
    cfQuery('cf:H776', { op: 'lemma_relationships', query: 'H776' }, '/v1/rpc/query_relationships_v2'),
    mcpCall('mcp:H776', 'get_word_relationships_v2', { query: 'H776' }),
  ]);
  assert(cfH776.status === 'needs_disambiguation' && mcpH776.status === 'needs_disambiguation', 'H776 must require homograph disambiguation');
  const cands = (mcpH776.homograph_candidates || []).map(c => c.lemma_id);
  assert(cands.includes('lemma:H0776G') && cands.includes('lemma:H0776H'), `Missing Hebrew homograph candidates: ${cands.join(',')}`);

  const mcpH0776g = await mcpCall('mcp:H0776G', 'get_word_relationships_v2', { lemma_id: 'lemma:H0776G' });
  assert(mcpH0776g.status === 'ok' && mcpH0776g.focus?.lemma_id === 'lemma:H0776G', 'H0776G resolution failed');
  assert((mcpH0776g.homograph_siblings || []).length >= 2, 'H0776G missing homograph_siblings');

  const mcpGen12 = await mcpCall('mcp:gen1:2', 'get_passage_grammatical_frames_v2', { book: 1, chapter: 1, verse: 2 });
  assert(mcpGen12.status === 'ok', 'GEN 1:2 frames failed');
  const gen12Preds = new Set((mcpGen12.relations || []).map(r => r.predicate));
  assert(gen12Preds.has('possessive_construction_with'), 'GEN 1:2 missing possessive_construction_with');

  // 6. John 3:17 negative polarity & Greek grammar + edition override
  const mcpJhn317 = await mcpCall('mcp:jhn3:17', 'get_passage_grammatical_frames_v2', { book: 43, chapter: 3, verse: 17 });
  assert(mcpJhn317.status === 'ok', 'JHN 3:17 failed');
  assert((mcpJhn317.frames || []).some(f => f.context?.polarity === 'negative'), 'JHN 3:17 missing negative polarity');

  const [mcpJhnSblgnt, mcpMatSblgnt] = await Promise.all([
    mcpCall('mcp:jhn3:16:sblgnt', 'get_passage_grammatical_frames_v2', {
      book: 43, chapter: 3, verse: 16, edition_key: 'macula-greek-sblgnt',
    }),
    mcpCall('mcp:mat28:19:sblgnt', 'get_passage_grammatical_frames_v2', {
      book: 40, chapter: 28, verse: 19, edition_key: 'macula-greek-sblgnt',
    }),
  ]);
  assert(mcpJhnSblgnt.status === 'ok' && mcpJhnSblgnt.edition === 'macula-greek-sblgnt', 'JHN 3:16 SBLGNT edition override failed');
  assert(mcpMatSblgnt.status === 'not_covered' && mcpMatSblgnt.edition === 'macula-greek-sblgnt', 'MAT 28:19 SBLGNT must report not_covered');

  // 7. Spot-check all 6 R3 predicates across representative passages
  const predicatePassages = [
    { label: 'GEN 1:1', book: 1, chapter: 1, verse: 1, need: ['grammatical_subject_of', 'grammatical_object_of'] },
    { label: 'GEN 3:1', book: 1, chapter: 3, verse: 1, need: ['grammatical_indirect_object_of'] },
    { label: 'PSA 3:2', book: 19, chapter: 3, verse: 2, need: ['grammatical_indirect_object_of'] },
    { label: 'JHN 1:12', book: 43, chapter: 1, verse: 12, need: ['grammatical_indirect_object_of', 'possessive_construction_with'] },
    { label: 'JHN 4:42', book: 43, chapter: 4, verse: 42, need: ['grammatical_indirect_object_of'] },
    { label: 'GEN 1:27', book: 1, chapter: 1, verse: 27, need: ['grammatical_second_object_of'] },
    { label: 'GEN 3:20', book: 1, chapter: 3, verse: 20, need: ['grammatical_second_object_of'] },
    { label: 'JOS 17:14', book: 6, chapter: 17, verse: 14, need: ['grammatical_second_object_of'] },
    { label: 'JHN 2:16', book: 43, chapter: 2, verse: 16, need: ['grammatical_second_object_of'] },
    { label: 'GEN 1:21', book: 1, chapter: 1, verse: 21, need: ['modifies'] },
    { label: 'MAT 28:19', book: 40, chapter: 28, verse: 19, need: ['modifies', 'possessive_construction_with'] },
    { label: 'JHN 3:16', book: 43, chapter: 3, verse: 16, need: ['modifies'] },
    { label: 'LUK 8:15', book: 42, chapter: 8, verse: 15, need: ['modifies'] },
    { label: 'LUK 8:11', book: 42, chapter: 8, verse: 11, need: ['possessive_construction_with'] },
  ];
  for (const tc of predicatePassages) {
    const res = await cfQuery(`cf:${tc.label}`, { op: 'passage_frames', book: tc.book, chapter: tc.chapter, verse: tc.verse, include_candidates: true });
    assert(res.status === 'ok', `${tc.label}: unexpected status ${res.status}`);
    const preds = new Set((res.relations || []).map(r => r.predicate));
    for (const p of tc.need) {
      assert(preds.has(p), `${tc.label}: missing predicate ${p} (saw: ${[...preds].join(',')})`);
    }
  }

  // 8. Uncertainty toggle filter check & Uncovered passage (EXO 1:1)
  const [hqOnly, withCand] = await Promise.all([
    cfQuery('cf:G3100:hq', { op: 'lemma_relationships', query: 'G3100', include_uncertain: false }),
    cfQuery('cf:G3100:all', { op: 'lemma_relationships', query: 'G3100', include_uncertain: true }),
  ]);
  assert(withCand.counts.relations_total >= hqOnly.counts.relations_total, 'include_uncertain=true should be >= high_precision only');

  const [cfExo, mcpExo] = await Promise.all([
    cfQuery('cf:EXO1:1', { op: 'passage_frames', book: 2, chapter: 1, verse: 1 }),
    mcpCall('mcp:EXO1:1', 'get_passage_grammatical_frames_v2', { book: 2, chapter: 1, verse: 1 }),
  ]);
  assert(cfExo.status === 'not_covered' && mcpExo.status === 'not_covered', 'EXO 1:1 must return explicit not_covered');

  // 9. Optional live website deploy check
  if (SITE_BASE) {
    const siteRes = await timedFetch('site:index', SITE_BASE);
    assert(siteRes.res.ok && siteRes.text.includes('<!DOCTYPE html>') || siteRes.text.toLowerCase().includes('<html'), 'Website HTML failed');
    const jsMatch = siteRes.text.match(/assets\/index-[^"']+\.js/);
    assert(Boolean(jsMatch), 'Could not find built asset bundle reference in live site HTML');
    const jsRes = await timedFetch('site:bundle', `${SITE_BASE.replace(/\/+$/, '')}/${jsMatch[0]}`);
    assert(jsRes.res.ok && jsRes.text.includes('query_relationships_v2'), 'Live website bundle missing query_relationships_v2 integration');
  }

  console.log(JSON.stringify({
    status: 'PASS',
    r3_baseline: { frames: framesCount, relations: relsCount, summaries: sumsCount, rule_version: manifest.rule_version },
    checks_passed: timings.length,
    timings_ms_sample: timings.map(t => `${t.label}:${t.ms}ms/${t.bytes}B`),
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
