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
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error('Missing VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

async function rpcAnon(name, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('=== VERIFYING GREEK OCCURRENCE STATISTICS (CORR-03) ===\n');
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failCount++;
    }
  }

  // 1. G4151 (πνεῦμα) with limit = 5
  let g4151_lim5;
  {
    const { ok, data } = await rpcAnon('lookup_cross_testament_greek_v1', {
      p_greek_query: 'G4151',
      p_limit: 5
    });
    assert(ok && data?.status === 'ok', 'G4151 lookup (limit=5) succeeds');
    assert(data?.nt_occurrences?.total_count === 379,
      `G4151 NT total_count is exactly 379 with limit=5 (got ${data?.nt_occurrences?.total_count})`);
    assert(data?.nt_occurrences?.total_matching_occurrences === 379,
      `G4151 NT total_matching_occurrences is 379 with limit=5`);
    assert(data?.nt_occurrences?.returned_count === 5,
      `G4151 NT returned_count is 5 with limit=5 (got ${data?.nt_occurrences?.returned_count})`);
    assert(data?.nt_occurrences?.samples?.length === 5,
      `G4151 NT samples array length matches limit=5`);
    assert(data?.lxx_occurrences?.total_count === 329,
      `G4151 LXX total_count is exactly 329 with limit=5 (got ${data?.lxx_occurrences?.total_count})`);
    assert(data?.lxx_occurrences?.returned_count === 5,
      `G4151 LXX returned_count is 5 with limit=5`);
    assert(data?.lxx_occurrences?.is_exhaustive_lemma_count === false,
      `G4151 LXX reports is_exhaustive_lemma_count: false`);
    assert(typeof data?.lxx_occurrences?.count_scope_notes === 'string' && data?.lxx_occurrences?.count_scope_notes.length > 20,
      `G4151 LXX provides clear count_scope_notes explaining diplomatic text limitations`);
    g4151_lim5 = data;
  }

  // 2. G4151 (πνεῦμα) with limit = 30 (must have IDENTICAL total counts)
  {
    const { ok, data } = await rpcAnon('lookup_cross_testament_greek_v1', {
      p_greek_query: 'G4151',
      p_limit: 30
    });
    assert(ok && data?.status === 'ok', 'G4151 lookup (limit=30) succeeds');
    assert(data?.nt_occurrences?.total_count === 379,
      `G4151 NT total_count remains 379 when limit changes from 5 to 30 (got ${data?.nt_occurrences?.total_count})`);
    assert(data?.nt_occurrences?.returned_count === 30,
      `G4151 NT returned_count is 30 when limit=30`);
    assert(data?.lxx_occurrences?.total_count === 329,
      `G4151 LXX total_count remains 329 when limit changes from 5 to 30`);
    assert(data?.lxx_occurrences?.returned_count === 30,
      `G4151 LXX returned_count is 30 when limit=30`);
  }

  // 3. G3056 (λόγος) with limit = 10
  {
    const { ok, data } = await rpcAnon('lookup_cross_testament_greek_v1', {
      p_greek_query: 'G3056',
      p_limit: 10
    });
    assert(ok && data?.status === 'ok', 'G3056 (λόγος) lookup succeeds');
    assert(data?.nt_occurrences?.total_count === 330,
      `G3056 NT total_count is exactly 330 (got ${data?.nt_occurrences?.total_count})`);
    assert(data?.nt_occurrences?.returned_count === 10,
      `G3056 NT returned_count is 10`);
    assert(data?.lxx_occurrences?.total_count === 1162,
      `G3056 LXX total_count is 1162 (got ${data?.lxx_occurrences?.total_count})`);
    assert(data?.lxx_occurrences?.returned_count === 10,
      `G3056 LXX returned_count is 10`);
  }

  // 4. Unicode search: accented 'πνεῦμα' vs unaccented 'πνευμα'
  {
    const { ok: okAcc, data: dataAcc } = await rpcAnon('lookup_cross_testament_greek_v1', {
      p_greek_query: 'πνεῦμα',
      p_limit: 5
    });
    assert(okAcc && dataAcc?.status === 'ok', "Lookup by accented Greek 'πνεῦμα' succeeds");
    assert(dataAcc?.nt_occurrences?.total_count === 379,
      "Accented 'πνεῦμα' NT total_count is 379");

    const { ok: okUnacc, data: dataUnacc } = await rpcAnon('lookup_cross_testament_greek_v1', {
      p_greek_query: 'πνευμα',
      p_limit: 5
    });
    assert(okUnacc && dataUnacc?.status === 'ok', "Lookup by unaccented Greek 'πνευμα' succeeds");
    assert(dataUnacc?.nt_occurrences?.total_count === 379,
      "Unaccented 'πνευμα' NT total_count matches accented total (379)");
  }

  // 5. Verify no duplicate verse occurrences in sample results
  {
    const sampleOccurrences = g4151_lim5?.nt_occurrences?.samples?.map(s => `${s.ref}:${s.word_id}`) || [];
    const uniqueOccurrences = new Set(sampleOccurrences);
    assert(sampleOccurrences.length === uniqueOccurrences.size,
      `No duplicate occurrences in NT sample results (${uniqueOccurrences.size}/${sampleOccurrences.length})`);
  }

  console.log(`\nTests Completed: ${passCount} PASSED, ${failCount} FAILED.`);
  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
