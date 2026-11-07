// @file: scripts/generate-orthographic-candidates.mjs
// Batch orthographic candidate generation pipeline using consonantal matching,
// documented morphology, and existing lexical relationships.
//
// Guarantees:
// - Candidates remain unverified exploratory proposals (evidence_status: 'unverified_candidate')
// - Zero synthetic historical etymologies created
// - Cross-references documented roots, compound formations, and literary connections
// - Normalizes Hebrew final letters (ךםןףץ -> כמנפצ) and Greek final sigma (ς -> σ)

import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const env = Object.fromEntries(
  (await fs.readFile('.env', 'utf8'))
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
assert.ok(SUPABASE_URL && ANON_KEY, 'Missing Supabase credentials in .env');

async function callRpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`RPC ${name} failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function runBatchDiscovery(queries, limitPerQuery = 5, minChars = 3) {
  console.log(`Running batch orthographic candidate discovery for ${queries.length} queries...`);
  console.log(`Queries: ${queries.join(', ')}`);
  console.log(`Limit per query: ${limitPerQuery}, Min chars: ${minChars}\n`);

  const response = await callRpc('batch_suggest_orthographic_candidates_v1', {
    p_queries: queries,
    p_limit_per_query: limitPerQuery,
    p_min_chars: minChars
  });

  assert.equal(response.status, 'ok', 'Batch discovery RPC returned non-ok status');

  console.log('='.repeat(70));
  console.log('BATCH CANDIDATE DISCOVERY REPORT');
  console.log('Method: ' + response.method);
  console.log('Limitations: ' + response.limitations);
  console.log('='.repeat(70));

  let totalCandidates = 0;
  let documentedCrossReferences = 0;

  for (const item of response.results) {
    console.log(`\n[Query: "${item.query}"] (Status: ${item.status})`);
    if (item.status !== 'ok') {
      console.log(`  No candidate records found or invalid query format.`);
      continue;
    }

    const cands = item.candidate_connections || [];
    console.log(`  Returned: ${cands.length} candidate connections`);
    for (const c of cands) {
      totalCandidates++;
      const docTags = [];
      if (c.has_documented_formation) docTags.push('DOCUMENTED_FORMATION');
      if (c.has_documented_root) docTags.push('DOCUMENTED_ROOT');
      if (c.existing_connection_type) docTags.push(`CONNECTION:${c.existing_connection_type}`);
      if (docTags.length > 0) documentedCrossReferences++;

      const docStr = docTags.length > 0 ? ` [${docTags.join(' | ')}]` : '';
      console.log(
        `  -> ${c.candidate_strongs.padEnd(7)} (${c.candidate_script} / ${c.candidate_transliteration || '?'})` +
        ` "${c.candidate_gloss}" | overlap: ${c.overlap_chars} chars (${c.overlap_kind}, ${c.overlap_position})` +
        ` | status: ${c.evidence_status} (etymology: ${c.etymological_inference})${docStr}`
      );
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Summary: Processed ${response.batch_size} queries, found ${totalCandidates} candidates, ${documentedCrossReferences} cross-referenced documented relationships.`);
  console.log('Epistemic boundary preserved: Candidates remain unverified exploratory proposals.');
  console.log('='.repeat(70) + '\n');

  // Save report to .artifacts
  const outPath = path.join('.artifacts', 'lexical-formation', 'orthographic-candidates-sample.json');
  await fs.writeFile(outPath, JSON.stringify(response, null, 2), 'utf8');
  console.log(`Saved detailed candidate batch payload to ${outPath}`);

  return response;
}

// Parse simple CLI flags
const rawArgs = process.argv.slice(2);
let minChars = 3;
let limit = 5;
const queries = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--min-chars' && rawArgs[i + 1]) {
    minChars = parseInt(rawArgs[++i], 10);
  } else if (rawArgs[i] === '--limit' && rawArgs[i + 1]) {
    limit = parseInt(rawArgs[++i], 10);
  } else {
    queries.push(rawArgs[i]);
  }
}

const finalQueries = queries.length > 0 ? queries : ['H7501', 'H120', 'H1818', 'G3056', 'שלם'];
// If H1818 is among the queries and default minChars was 3, adapt minChars to 2 so 2-consonant words can match
if (finalQueries.includes('H1818') && minChars === 3) {
  minChars = 2;
}

await runBatchDiscovery(finalQueries, limit, minChars);
