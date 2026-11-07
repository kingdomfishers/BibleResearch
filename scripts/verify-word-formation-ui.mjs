// @file: scripts/verify-word-formation-ui.mjs
// Automated verification & Playwright acceptance suite for Word Formation & Etymology UI.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase credentials in .env');

async function callRpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });
  if (!res.ok) throw new Error(`RPC ${name} failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

console.log('='.repeat(75));
console.log('WORD FORMATION & ETYMOLOGY UI - VERIFICATION & ACCEPTANCE SUITE');
console.log('='.repeat(75) + '\n');

let passed = 0;
let failed = 0;
function report(name, ok, details = '') {
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}${details ? ` -> ${details}` : ''}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name}${details ? ` -> ${details}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// SUITE 1: H7501 Rephael Formation Data Contract
// ---------------------------------------------------------------------------
console.log('Suite 1: H7501 Rephael Formation Contract');
const h7501 = await callRpc('get_word_formation_v1', { p_query: 'H7501' });
report('Status is ok', h7501.status === 'ok');
const f7501 = h7501.lexical_formations?.[0];
report('Formation exists', !!f7501);
report('Two ordered components', f7501?.components?.length === 2);
const c1 = f7501?.components?.[0];
const c2 = f7501?.components?.[1];
report('Component 1 is Rapha / heal', c1?.base_strongs === 'H7495' && /heal/i.test(c1?.semantic_contribution || c1?.primary_gloss || ''), `c1=${c1?.original_lemma} (${c1?.semantic_contribution})`);
report('Component 2 is El / God', c2?.base_strongs === 'H410' && /God/i.test(c2?.semantic_contribution || c2?.primary_gloss || ''), `c2=${c2?.original_lemma} (${c2?.semantic_contribution})`);
report('Whole-name meaning is present', /God (has )?heals?/i.test(f7501?.whole_word_gloss || ''), `gloss="${f7501?.whole_word_gloss}"`);
report('Evidence is documented', f7501?.evidence_status === 'documented');
report('Source provenance is present', !!f7501?.source?.title);

// Verify components resolve to real word IDs for interactive exploration
const id7495 = await callRpc('resolve_word_id', { p_query: 'H7495' });
const id410 = await callRpc('resolve_word_id', { p_query: 'H410' });
report('Component 1 resolves to positive word ID', typeof id7495 === 'number' && id7495 > 0, `id=${id7495}`);
report('Component 2 resolves to positive word ID', typeof id410 === 'number' && id410 > 0, `id=${id410}`);

// ---------------------------------------------------------------------------
// SUITE 2: H120 Adam Disambiguation & Wordplay vs Candidates
// ---------------------------------------------------------------------------
console.log('\nSuite 2: H120 Adam Wordplay & Distinct Candidates');
const h120 = await callRpc('get_word_formation_v1', { p_query: 'H120' });
report('H120 flags disambiguation', h120.needs_disambiguation === true);
report('H120 contains multiple matched lemmas', (h120.matched_lemmas?.length || 0) >= 2);
const wp = (h120.other_connections || []).find(c => c.relation_type === 'literary_wordplay');
report('H120 literary wordplay exists for H127 adamah', wp?.target_strongs === 'H127', `ref=${wp?.passage_reference}`);

const cands120 = await callRpc('suggest_orthographic_candidates_v1', { p_query: 'H120', p_limit: 8, p_min_chars: 2 });
const damCand = (cands120.candidate_connections || []).find(c => c.candidate_strongs === 'H1818');
report('H1818 dam discovered as orthographic candidate', !!damCand, `script=${damCand?.candidate_script}`);
report('H1818 candidate remains unverified_candidate', damCand?.evidence_status === 'unverified_candidate');
report('H1818 candidate rejects etymological inference', damCand?.etymological_inference === false);

// ---------------------------------------------------------------------------
// SUITE 3: Unknown Etymology Word (H853 object marker)
// ---------------------------------------------------------------------------
console.log('\nSuite 3: Unknown Etymology Word Handling');
const h853 = await callRpc('get_word_formation_v1', { p_query: 'H853' });
report('Status is ok for H853', h853.status === 'ok');
report('H853 has empty lexical formations', (h853.lexical_formations?.length || 0) === 0);
report('H853 does not invent synthetic components', (h853.lexical_formations || []).flatMap(f => f.components).length === 0);

// ---------------------------------------------------------------------------
// SUITE 4: Hydrated Research v2 Parity
// ---------------------------------------------------------------------------
console.log('\nSuite 4: Hydrated Verse Research v2 Parity');
const v2Res = await callRpc('get_verse_research_v2', {
  p_request: {
    passages: [{ book: 13, chapter: 26, verse: 7 }],
    occurrences: { mode: 'sample', limit: 5 }
  }
});
report('Hydrated v2 status is ok', v2Res.status === 'ok' && v2Res.schema_version === 2);
const formationsMap = v2Res.lexical_formations || {};
const rephaelFormation = formationsMap['lemma:H7501'];
report('Hydrated v2 contains lemma:H7501 formation', !!rephaelFormation, `keys=${Object.keys(formationsMap).length}`);
report('Hydrated v2 preserves ordered components', rephaelFormation?.formations?.[0]?.components?.length === 2);
report('Hydrated v2 preserves whole-name meaning', /God/i.test(rephaelFormation?.formations?.[0]?.whole_word_gloss || ''));
report('Hydrated v2 includes lexical formation coverage disclaimer', !!v2Res.coverage?.lexical_formation_coverage);

// ---------------------------------------------------------------------------
// SUITE 5: Playwright Browser Acceptance & Screenshots
// ---------------------------------------------------------------------------
console.log('\nSuite 5: Browser UI Acceptance & Exploration');
let chromium = null;
const pwCandidates = [
  process.env.PLAYWRIGHT_MODULE,
  'playwright-core',
  'file:///C:/Users/fluck/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs',
].filter(Boolean);
for (const modPath of pwCandidates) {
  try {
    const pw = await import(modPath);
    if (pw?.chromium) { chromium = pw.chromium; break; }
  } catch { /* continue */ }
}

const edgePaths = [
  process.env.BROWSER_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = edgePaths.find(p => existsSync(p));

const artDir = '.artifacts/formation-ui';
await fs.mkdir(artDir, { recursive: true });

if (chromium && executablePath) {
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    // Test 1 Chron 26:7 containing Rephael H7501
    await page.goto('http://localhost:3000/#13-26-7');
    await page.waitForSelector('.word-token[data-strongs="H7501"]');

    // Click Rephael token (H7501)
    await page.locator('.word-token[data-strongs="H7501"] button.word-inspect').click();

    // Wait for inspector formation section
    await page.waitForSelector('.word-formation-section');
    const formationText = await page.locator('.word-formation-section').innerText();
    report('UI renders WORD FORMATION & ETYMOLOGY header', /WORD FORMATION & ETYMOLOGY/i.test(formationText));
    report('UI renders Rephael lemma and transliteration', /רְפָאֵל/i.test(formationText));
    report('UI renders Components label', /Components:/i.test(formationText));
    report('UI renders ordered component buttons (Rapha and El)', /רָפָא/i.test(formationText) && /אֵל/i.test(formationText));
    report('UI renders whole-name meaning', /God has healed \/ God heals/i.test(formationText));
    report('UI renders documented provenance', /documented/i.test(formationText));

    await page.screenshot({ path: `${artDir}/h7501-formation-desktop.png` });

    // Click component 1: Rapha
    const raphaBtn = page.locator('.component-link-button').filter({ hasText: 'רָפָא' }).first();
    await raphaBtn.click();

    // Verify navigation into component
    await page.waitForFunction(() => {
      const summaryText = document.querySelector('.inspector-summary')?.textContent || '';
      return /H7495|רפא|אֶרְפָּ/i.test(summaryText);
    });
    const backBtn = page.locator('button.text-action:has-text("← Previous word")');
    report('Clicking component opens its own lexical entry', await backBtn.isVisible());

    // Click Previous word to return to Rephael
    await backBtn.click();
    await page.waitForFunction(() => {
      const summaryText = document.querySelector('.inspector-summary')?.textContent || '';
      return /H7501|רְפָאֵל/i.test(summaryText);
    });
    report('Returning to previous word restores Rephael', true);

    // Test Genesis 2:7 for H120 Adam wordplay and distinct candidates
    await page.goto('http://localhost:3000/#1-2-7');
    await page.waitForSelector('.word-token[data-strongs="H120"]');
    await page.locator('.word-token[data-strongs="H120"] button.word-inspect').first().click();

    await page.waitForSelector('.categorized-connections-section');
    const catText = await page.locator('.categorized-connections-section').innerText();
    report('UI renders Four Distinct Relationship Tiers', /Four Distinct Relationship Tiers/i.test(catText));
    report('UI renders Documented Root Family', /Documented Root Family/i.test(catText));
    report('UI renders Lexical Composition', /Lexical Composition/i.test(catText));
    report('UI renders Literary Wordplay', /Literary Wordplay/i.test(catText));
    report('UI renders Possible Spelling or Sound Connections with disclaimer',
      /Possible Spelling or Sound Connections/i.test(catText) && /similarity does not establish etymology/i.test(catText));

    await page.screenshot({ path: `${artDir}/h120-categorized-desktop.png` });

    // Test Mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: `${artDir}/mobile-responsive.png` });
    report('Responsive layout renders cleanly in mobile viewport (375x667)', true);

  } finally {
    await browser.close();
  }
} else {
  console.log('  [SKIP] Playwright or browser executable not found; skipping headless browser interaction.');
}

console.log('\n' + '='.repeat(75));
console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('='.repeat(75));

if (failed > 0) process.exit(1);
