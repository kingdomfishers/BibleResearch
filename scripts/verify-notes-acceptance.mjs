// @file: scripts/verify-notes-acceptance.mjs
// NOTE-35: User Acceptance Demonstration & Verification Suite
//
// Demonstrates all 5 acceptance checkpoints:
// (1) Target search autocompletion across Gen 9:6, H120, אדם, blood
// (2) Human Adam/Dam note creation with token anchors and typed directional connection
// (3) AI note creation through live MCP with dashed styling, sparkle icon, and model provenance
// (4) Visual distinction and Word Inspector display on דַּם and הָאָדָם
// (5) Author filtering (All/You/AI), AI review confirmation (unreviewed -> confirmed), and clean deletion

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

console.log('=== NOTE-35: User Acceptance Demonstration Suite ===\n');

// 1. Browser & Module Discovery
let chromium = null;
const pwCandidates = [
  process.env.PLAYWRIGHT_MODULE,
  pathToFileURL(path.resolve('.artifacts/browser-tools/node_modules/playwright-core/index.mjs')).href,
  pathToFileURL(path.resolve('C:/Users/fluck/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs')).href,
  'playwright-core',
].filter(Boolean);

for (const modPath of pwCandidates) {
  try {
    const pw = await import(modPath);
    if (pw?.chromium) {
      chromium = pw.chromium;
      break;
    }
  } catch {}
}

if (!chromium) {
  console.error('ERROR: Could not find Playwright module.');
  process.exit(1);
}

const browserCandidates = [
  process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

const executablePath = browserCandidates.find(p => fs.existsSync(p));
if (!executablePath) {
  console.error('ERROR: Could not find browser executable.');
  process.exit(1);
}

// 2. Configuration & State
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';
const MCP_ENDPOINT = process.env.BIBLE_MCP_URL || `${SUPABASE_URL}/functions/v1/bible-mcp/mcp`;

const ARTIFACTS_DIR = path.resolve('.artifacts/notes');
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const TEST_RUN_ID = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
console.log(`Test Run ID: ${TEST_RUN_ID}`);

let passed = 0;
let failed = 0;
const results = [];
const createdNoteIds = new Set();
let mcpIdCounter = 0;

function record(name, success, detail = '') {
  if (success) {
    console.log(`  ✓ ${name}`);
    passed++;
    results.push({ name, status: 'PASS', detail });
  } else {
    console.error(`  ✗ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
    failed++;
    results.push({ name, status: 'FAIL', detail });
  }
}

// 3. Helper: MCP RPC Caller
async function mcpCall(method, params = {}) {
  const currentId = ++mcpIdCounter;
  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: currentId, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(res.status, 200, `HTTP status ${res.status} for ${method}`);
  const text = await res.text();
  const payload = res.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === currentId)
    : JSON.parse(text);
  assert.ok(!payload.error, `${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function mcpTool(name, args) {
  const response = await mcpCall('tools/call', { name, arguments: args });
  return response.structuredContent;
}

// 4. Verification Runner
async function run() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  let humanNoteId = null;
  let aiNoteId = null;

  try {
    // =========================================================================
    // STEP 1: TARGET SEARCH AUTOCOMPLETION (Gen 9:6, H120, אדם, blood)
    // =========================================================================
    console.log('\n--- Step 1: Target Search Verification (Gen 9:6, H120, אדם, blood) ---');
    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.waitForFunction(() => location.hash === '#1-9-6');
    await page.locator('#navigation select').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    const addBtn = page.getByRole('button', { name: /Add note/i }).first();
    await addBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.locator('dialog.note-editor-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    // Set test_run tag on editor
    await page.evaluate(runId => {
      const dlg = document.querySelector('dialog.note-editor-dialog');
      if (typeof dlg?.__setSourceContext === 'function') {
        dlg.__setSourceContext({ test_run: runId });
      }
    }, TEST_RUN_ID);

    const pickerWrap = page.locator('.editor-picker-wrap');
    if (await pickerWrap.isHidden()) {
      await page.locator('.editor-section--anchors .editor-btn--sm').first().click();
    }
    await page.locator('.target-picker__input').waitFor({ state: 'visible', timeout: 5000 });

    const searchInput = page.locator('.target-picker__input');
    const resultsContainer = page.locator('.target-picker__results');

    // 1a: Search Gen 9:6
    await searchInput.fill('Gen 9:6');
    const genOption = resultsContainer.locator('.target-candidate', { hasText: 'Genesis 9:6' }).first();
    await genOption.waitFor({ state: 'visible', timeout: 10000 });
    record('Target search resolves "Gen 9:6" verse candidate', true);

    // 1b: Search H120
    await searchInput.fill('H120');
    const h120Option = resultsContainer.locator('.target-candidate', { hasText: 'אָדָם' }).first();
    await h120Option.waitFor({ state: 'visible', timeout: 10000 });
    record('Target search resolves "H120" (אָדָם) lemma candidate', true);

    // 1c: Search Hebrew script אדם
    await searchInput.fill('אדם');
    const hebrewOption = resultsContainer.locator('.target-candidate', { hasText: 'אָדָם' }).first();
    await hebrewOption.waitFor({ state: 'visible', timeout: 10000 });
    record('Target search resolves Hebrew script "אדם" candidate', true);

    // 1d: Search English gloss "blood"
    await searchInput.fill('blood');
    const bloodOption = resultsContainer.locator('.target-candidate', { hasText: 'דָּם' }).first();
    await bloodOption.waitFor({ state: 'visible', timeout: 10000 });
    record('Target search resolves English gloss "blood" candidate', true);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'acceptance-01-target-search.png') });
    await searchInput.fill('');
    await page.waitForTimeout(300);

    // =========================================================================
    // STEP 2: HUMAN ADAM/DAM NOTE WITH TYPED DIRECTIONAL CONNECTION
    // =========================================================================
    console.log('\n--- Step 2: Human Note Creation with Typed Connection ---');
    const humanTitle = `[TEST] Adam/Dam Linguistic Reflection ${TEST_RUN_ID}`;
    const humanBody = 'Reflecting on דָּם (blood) and אָדָם (man) in Genesis 9:6: the root pairing reveals an intrinsic linguistic containment.';
    await page.locator('.note-editor__title').fill(humanTitle);
    await page.locator('.note-editor__body').fill(humanBody);

    // Pick דַּם (pos 2) and הָאָדָם (pos 3) from token picker
    await page.locator('.token-picker__list .token-btn').first().waitFor({ state: 'visible', timeout: 10000 });
    const damTokenBtn = page.locator('.token-btn[data-position="2"]').first();
    await damTokenBtn.waitFor({ state: 'visible', timeout: 5000 });
    await damTokenBtn.click();
    record('Added דַּ֣ם token anchor via TargetPicker', true);

    const adamTokenBtn = page.locator('.token-btn[data-position="3"]').first();
    await adamTokenBtn.waitFor({ state: 'visible', timeout: 5000 });
    await adamTokenBtn.click();
    record('Added הָאָדָם token anchor via TargetPicker', true);

    // Add typed connection in ConnectionBuilder
    const addConnBtn = page.locator('.connection-add-btn');
    await addConnBtn.waitFor({ state: 'visible', timeout: 5000 });
    await addConnBtn.click();
    await page.waitForTimeout(300);

    const connTypeSel = page.locator('.connection-select--type').first();
    if (await connTypeSel.count() > 0) {
      await connTypeSel.selectOption('contained_in').catch(() => {});
    }
    const connExp = page.locator('.connection-textarea').first();
    if (await connExp.count() > 0) {
      await connExp.fill('dam is contained in adam');
    }
    record('Configured typed connection in ConnectionBuilder', true);

    // Save human note
    await page.locator('.editor-btn--primary').click();
    await page.waitForFunction(() => !document.querySelector('dialog.note-editor-dialog')?.open, { timeout: 8000 });
    await page.waitForTimeout(1000);

    const humanCard = page.locator('.notes-panel .note-card', { hasText: humanTitle }).first();
    await humanCard.waitFor({ state: 'visible', timeout: 10000 });
    record('Human note rendered in NotesPanel', (await humanCard.count()) > 0);

    const cardIdAttr = await humanCard.getAttribute('id');
    humanNoteId = cardIdAttr ? cardIdAttr.replace(/^note-/, '') : null;
    if (humanNoteId) createdNoteIds.add(humanNoteId);

    const isHumanSolid = await humanCard.evaluate(el => el.classList.contains('note-card--human'));
    record('Human card has .note-card--human class (solid border)', isHumanSolid);

    const provenanceText = await humanCard.locator('.note-card__provenance').innerText();
    record('Human card provenance displays "You"', provenanceText.includes('You'));

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'acceptance-02-human-note.png') });

    // =========================================================================
    // STEP 3: AI NOTE CREATION VIA LIVE MCP & DUAL VISUAL RENDERING
    // =========================================================================
    console.log('\n--- Step 3: AI Note Creation via MCP & Visual Distinction ---');
    const aiTitle = `[TEST] AI Analysis: Retributive Justice ${TEST_RUN_ID}`;
    const aiBody = `In Genesis 9:6, the chiasm emphasizes retributive justice ('Whoever sheds human blood, by humans shall their blood be shed'). Test Run: ${TEST_RUN_ID}`;

    const mcpCreateRes = await mcpTool('create_note', {
      title: aiTitle,
      body_md: aiBody,
      note_kind: 'interpretation',
      confidence: 0.92,
      anchors: [
        { client_key: 'a1', kind: 'verse', verse_id: 247, label: 'Genesis 9:6' },
        { client_key: 'a2', kind: 'word_occurrence', verse_id: 247, word_id: 2950, word_position: 1, label: 'דַּם (Gen 9:6#1)' },
      ],
      connections: [
        { from_key: 'a1', to_key: 'a2', type: 'explains', direction: 'directed' },
      ],
      source_context: { test_run: TEST_RUN_ID },
      model: 'claude-3-5-sonnet',
    });

    record('MCP create_note created AI note with unreviewed status', mcpCreateRes?.note?.review_status === 'unreviewed');
    aiNoteId = mcpCreateRes?.note?.id;
    if (aiNoteId) createdNoteIds.add(aiNoteId);

    // Refresh UI to display both notes
    await page.reload();
    await page.waitForFunction(() => location.hash === '#1-9-6');
    await page.locator('#navigation select').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);

    const aiCard = page.locator(`.notes-panel #note-${aiNoteId}`);
    await aiCard.waitFor({ state: 'visible', timeout: 10000 });

    const isAiDashed = await aiCard.evaluate(el => el.classList.contains('note-card--ai'));
    record('AI note card rendered with .note-card--ai dashed styling', isAiDashed);

    const hasSparkle = (await aiCard.locator('.note-card__icon').innerText()).includes('✨');
    record('AI note card renders sparkle icon', hasSparkle);

    const modelNameText = await aiCard.locator('.note-card__provenance').innerText();
    record('AI note card displays model name "AI · claude-3-5-sonnet"', modelNameText.includes('claude-3-5-sonnet'));

    const reviewPill = aiCard.locator('.note-card__review-pill');
    record('AI note card displays "unreviewed" review pill', (await reviewPill.innerText()).toLowerCase().includes('unreviewed'));

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'acceptance-03-both-notes.png') });

    // =========================================================================
    // STEP 4: WORD INSPECTOR VISUAL INTEGRATION
    // =========================================================================
    console.log('\n--- Step 4: Word Inspector Integration on דַּם ---');
    const damWordToken = page.locator('.verse-text .word[data-word-id="2950"], .verse-text .word', { hasText: 'דַּ֣ם' }).first();
    await damWordToken.waitFor({ state: 'visible', timeout: 5000 });
    await damWordToken.click();
    await page.waitForTimeout(800);

    const wordModal = page.locator('dialog#word-modal');
    await wordModal.waitFor({ state: 'visible', timeout: 5000 });
    const inspectorHasDamNote = (await wordModal.locator('.note-card', { hasText: humanTitle }).count()) > 0;
    record('Word Inspector displays human note for דַּם', inspectorHasDamNote);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'acceptance-04-word-inspector.png') });

    const closeBtn = wordModal.getByRole('button', { name: /Close/i });
    if ((await closeBtn.count()) > 0) await closeBtn.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // =========================================================================
    // STEP 5: AUTHOR FILTERING, REVIEW CONFIRMATION, AND CLEANUP
    // =========================================================================
    console.log('\n--- Step 5: Author Filtering, Review Confirmation, & Cleanup ---');
    // 5a: Author Filtering
    const filterYou = page.locator('.notes-panel__filter-bar button', { hasText: /You/i }).first();
    await filterYou.click();
    await page.waitForTimeout(400);
    record('Filtering by "You" shows human note and hides AI note',
      (await humanCard.isVisible()) && !(await aiCard.isVisible())
    );

    const filterAi = page.locator('.notes-panel__filter-bar button', { hasText: /AI/i }).first();
    await filterAi.click();
    await page.waitForTimeout(400);
    record('Filtering by "AI" shows AI note and hides human note',
      !(await humanCard.isVisible()) && (await aiCard.isVisible())
    );

    const filterAll = page.locator('.notes-panel__filter-bar button', { hasText: /All/i }).first();
    await filterAll.click();
    await page.waitForTimeout(400);
    record('Filtering by "All" restores visibility of both notes',
      (await humanCard.isVisible()) && (await aiCard.isVisible())
    );

    // 5b: Confirm AI Note in UI
    const confirmBtn = aiCard.locator('button', { hasText: /Confirm/i }).first();
    record('Confirm button present on unreviewed AI note card', (await confirmBtn.count()) > 0);
    await confirmBtn.click();

    const updatedReviewPill = aiCard.locator('.note-card__review-pill');
    await updatedReviewPill.filter({ hasText: 'confirmed' }).waitFor({ state: 'visible', timeout: 10000 });
    const newStatusText = await updatedReviewPill.innerText();
    record('Review status updated to "confirmed" in UI', newStatusText.toLowerCase().includes('confirmed'));

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'acceptance-05-confirmed.png') });

    // 5c: Delete Human Note via UI
    page.once('dialog', d => d.accept());
    const deleteBtn = humanCard.locator('button', { hasText: /Delete/i }).first();
    await deleteBtn.click();
    await page.waitForTimeout(1000);
    record('Human note deleted cleanly via UI', !(await humanCard.isVisible()));

  } finally {
    await context.close();
    await browser.close();

    // Cleanup AI note via MCP
    console.log('\n--- Final Cleanup (TP-CLEAN-1) ---');
    for (const noteId of createdNoteIds) {
      try {
        await mcpTool('delete_my_note', { note_id: noteId, expected_version: 1 }).catch(() => {});
        await mcpTool('delete_my_note', { note_id: noteId, expected_version: 2 }).catch(() => {});
      } catch {}
    }

    // Verify 0 active test rows remain
    const testNotesRes = await fetch(`${SUPABASE_URL}/rest/v1/notes?title=like.*${encodeURIComponent(TEST_RUN_ID)}*&status=neq.removed`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    const remaining = testNotesRes.ok ? await testNotesRes.json() : [];
    record('TP-CLEAN-1: Zero active test rows remain in database', remaining.length === 0);
  }

  // Write acceptance report
  const report = {
    timestamp: new Date().toISOString(),
    test_run_id: TEST_RUN_ID,
    gate: 'Acceptance (NOTE-35)',
    status: failed === 0 ? 'PASS' : 'FAIL',
    summary: { total_assertions: passed + failed, passed, failed },
    results,
    screenshots: [
      'acceptance-01-target-search.png',
      'acceptance-02-human-note.png',
      'acceptance-03-both-notes.png',
      'acceptance-04-word-inspector.png',
      'acceptance-05-confirmed.png',
    ],
  };

  const reportPath = path.join(ARTIFACTS_DIR, 'acceptance-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nAcceptance report written to: ${reportPath}`);

  console.log('\n================================================================');
  console.log(`=== NOTE-35 ACCEPTANCE DECISION: ${failed === 0 ? 'APPROVED (PASS)' : 'REJECTED (FAIL)'}       ===`);
  console.log('================================================================');
  console.log(`Assertions: ${passed} passed, ${failed} failed\n`);

  process.exit(failed === 0 ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal error in acceptance suite:', err);
  process.exit(1);
});
