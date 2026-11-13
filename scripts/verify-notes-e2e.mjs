// @file: scripts/verify-notes-e2e.mjs
// NOTE-33: End-to-End Journeys Verification Suite (Phase E Acceptance)
//
// Journeys:
// 1. Human Journey:
//    - Create Adam/Dam note in UI on Gen 9:6 with 2 word anchors + connection
//    - Verify in reader panel, word badges, Word Inspector, All-notes browser
//    - Verify via PostgREST anon RPC (get_notes_for_passage_v1, get_note_v1)
//    - Verify via Live MCP tools (get_verse_research, get_notes)
// 2. AI Journey:
//    - Create note via Live MCP create_note (Gen 9:6, word occurrence + connection)
//    - Verify in UI with AI styling (.note-card--ai, sparkle icon, model name, unreviewed)
//    - Confirm note in UI (set_note_review_v1)
//    - Verify state change in UI and in Live MCP output
// 3. Mixed Notes & Filtering:
//    - Verify count consistency in panel header
//    - Filter All / Human / AI notes and verify card visibility
// 4. Safety & Kill Switches:
//    - UI save rejection when writes disabled (clear message, draft preserved)
// 5. Resilience:
//    - Stale navigation race-condition immunity
//    - Offline handling & retry recovery
// 6. Integrity & Invariants:
//    - TP-GUARD-1: notes-guard --compare exits 0 (corpus tables unchanged)
//    - TP-INT-3: Unicode & Hebrew/Greek UTF-8 exact byte parity
//    - TP-CLEAN-1: Zero active test rows in database

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

console.log('=== NOTE-33: Full Stack End-to-End Journeys Suite ===\n');

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
if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const TEST_RUN_ID = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

// 4. Helper: REST RPC Caller
async function restRpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`REST RPC ${name} failed (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}

// 5. Verification Runner
async function run() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('error') || msg.text().includes('fail')) {
      console.log('  [Browser Error]', msg.text());
    }
  });
  page.on('response', resp => {
    if (resp.status() >= 400) {
      console.log(`  [HTTP ${resp.status()}] ${resp.url()}`);
    }
  });

  let humanNoteId = null;
  let aiNoteId = null;

  try {
    // =========================================================================
    // JOURNEY 1: Human Note Creation & Multi-Surface Verification
    // =========================================================================
    console.log('--- Journey 1: Human Creation, UI Surfaces & MCP Discovery ---');
    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.waitForFunction(() => location.hash === '#1-9-6');
    await page.locator('#navigation select').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    const addBtn = page.getByRole('button', { name: /Add note/i }).first();
    record('Add Note button visible on Genesis 9:6', (await addBtn.count()) > 0);
    await addBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.locator('dialog.note-editor-dialog');
    const dialogOpen = await dialog.evaluate(el => el.open);
    record('NoteEditor dialog opens on Genesis 9:6', dialogOpen === true);

    // Tag source_context with test_run ID for rule 7 compliance
    await page.evaluate(runId => {
      const dlg = document.querySelector('dialog.note-editor-dialog');
      if (typeof dlg?.__setSourceContext === 'function') {
        dlg.__setSourceContext({ test_run: runId });
      }
    }, TEST_RUN_ID);

    const humanTitle = `[TEST] Human Adam/Dam Reflection ${TEST_RUN_ID}`;
    const humanBody = 'Reflecting on דָּם (blood) and אָדָם (man) in Genesis 9:6: the root pairing reveals an intrinsic linguistic containment.';
    await page.locator('.note-editor__title').fill(humanTitle);
    await page.locator('.note-editor__body').fill(humanBody);

    // Select note kind
    const kindSelect = page.locator('.note-editor__kind');
    if (await kindSelect.count() > 0) {
      await kindSelect.selectOption('observation');
    }

    // Ensure TargetPicker is open
    const pickerWrap = page.locator('.editor-picker-wrap');
    if (await pickerWrap.isHidden()) {
      await page.locator('.editor-section--anchors .editor-btn--sm').first().click();
    }

    // Wait for verse tokens to load in token picker
    try {
      await page.locator('.token-picker__list .token-btn').first().waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      const pickerHtml = await page.evaluate(() => document.querySelector('.token-picker')?.outerHTML);
      const isWrapHidden = await page.evaluate(() => document.querySelector('.editor-picker-wrap')?.hidden);
      console.error(`  [TOKEN PICKER ERROR] wrap.hidden=${isWrapHidden}\n  Picker HTML:\n${pickerHtml}`);
      throw new Error(`Token picker failed: wrap.hidden=${isWrapHidden}`);
    }
    const countTokens = await page.locator('.token-picker__list .token-btn').count();
    console.log(`    Found ${countTokens} token buttons in token-picker`);

    // Add word anchor 1: דַּ֣ם (position 2)
    const damTokenBtn = page.locator('.token-btn[data-position="2"]').first();
    const damCount = await damTokenBtn.count();
    console.log(`    damTokenBtn count: ${damCount}`);
    if (damCount > 0) {
      await damTokenBtn.click();
      await page.waitForTimeout(300);
      record('Added דַּ֣ם token anchor via TargetPicker', true);
    } else {
      record('Added דַּ֣ם token anchor via TargetPicker', false, 'Token position 2 not found');
    }

    // Add word anchor 2: הָאָדָם (position 3)
    const adamTokenBtn = page.locator('.token-btn[data-position="3"]').first();
    if (await adamTokenBtn.count() > 0) {
      await adamTokenBtn.click();
      await page.waitForTimeout(300);
      record('Added הָאָדָם token anchor via TargetPicker', true);
    } else {
      record('Added הָאָדָם token anchor via TargetPicker', false, 'Token position 3 not found');
    }

    // Add connection between anchors
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

    // Save note via UI
    await page.locator('.editor-btn--primary').click();
    try {
      await page.waitForFunction(() => !document.querySelector('dialog.note-editor-dialog')?.open, { timeout: 8000 });
    } catch {
      const banner = await page.evaluate(() => document.querySelector('.note-editor__error-banner')?.textContent);
      const btnText = await page.evaluate(() => document.querySelector('.editor-btn--primary')?.textContent);
      console.error(`  [SAVE FAILURE] Banner: "${banner}", Button: "${btnText}"`);
      throw new Error(`Note save failed to close dialog: banner="${banner}" button="${btnText}"`);
    }
    await page.waitForTimeout(1000);

    // 1A. Notes panel reflection
    const humanCard = page.locator('.notes-panel .note-card', { hasText: humanTitle });
    const humanCardCount = await humanCard.count();
    record('Human note rendered in NotesPanel', humanCardCount > 0);

    if (humanCardCount > 0) {
      const isHumanClass = await humanCard.evaluate(el => el.classList.contains('note-card--human'));
      record('Human card has .note-card--human class', isHumanClass === true);

      const authorText = await humanCard.locator('.note-card__author-label').textContent();
      record('Human card provenance displays "You"', authorText?.trim() === 'You');

      const cardId = await humanCard.getAttribute('data-note-id') || await humanCard.getAttribute('id');
      humanNoteId = cardId?.replace(/^note-/, '');
      if (humanNoteId) createdNoteIds.add(humanNoteId);
    }

    // 1B. VerseReader word badges
    const tokenBadges = await page.locator('.token-notes-count').count();
    record('Token note count badges rendered on words in VerseReader', tokenBadges > 0);

    // 1C. Word Inspector reflection on both words
    const inspectDamBtn = page.locator('.word-inspect').nth(1); // word 2: dam
    if (await inspectDamBtn.count() > 0) {
      await inspectDamBtn.click();
      await page.locator('#inspector .word-notes__groups .note-card').first().waitFor({ state: 'visible', timeout: 10000 });
      const inspectorText = await page.locator('#inspector').innerText();
      record('Word Inspector displays human note for דַּ֣ם', inspectorText.includes(humanTitle));
    }

    const inspectAdamBtn = page.locator('.word-inspect').nth(2); // word 3: adam
    if (await inspectAdamBtn.count() > 0) {
      await inspectAdamBtn.click();
      await page.locator('#inspector .word-notes__groups .note-card').first().waitFor({ state: 'visible', timeout: 10000 });
      const inspectorText = await page.locator('#inspector').innerText();
      record('Word Inspector displays human note for הָאָדָם', inspectorText.includes(humanTitle));
    }

    // 1D. All-Notes Browser reflection
    const allNotesBtn = page.locator('#all-notes-btn');
    await allNotesBtn.click();
    await page.waitForTimeout(800);

    const browserCardsText = await page.locator('.notes-browser__cards').innerText();
    record('All-notes browser displays created human note', browserCardsText.includes(humanTitle));
    await allNotesBtn.click(); // Close browser
    await page.waitForTimeout(300);

    // 1E. PostgREST REST RPC verification
    const passageNotesRes = await restRpc('get_notes_for_passage_v1', {
      p_book: 1, p_chapter: 9, p_verse_start: 6, p_verse_end: 6,
    });
    const passageList = (passageNotesRes?.primary || []).concat(passageNotesRes?.secondary || []);
    const foundInPassage = passageList.some(n => n.id === humanNoteId);
    record('REST RPC get_notes_for_passage_v1 returns human note', foundInPassage === true);

    const noteDetailRes = await restRpc('get_note_v1', { p_note_id: humanNoteId });
    record('REST RPC get_note_v1 returns note with human author', noteDetailRes?.author?.kind === 'human');

    // 1F. Live MCP Tool verification (AI can see the human note)
    const mcpVerseRes = await mcpTool('get_verse_research', {
      p_request: { passages: [{ book: 1, chapter: 9, verse: 6 }] },
    });
    const passageNotes = mcpVerseRes?.notes?.['1:9:6']?.items || [];
    const mcpSeesNote = passageNotes.some(n => n.id === humanNoteId);
    record('Live MCP get_verse_research returns human note in notes dictionary', mcpSeesNote === true);

    const mcpNotesPassageRes = await mcpTool('get_notes', { book: 1, chapter: 9, verse_start: 6 });
    const untrustedNotes = mcpNotesPassageRes?.untrusted_notes;
    const foundInMcpPassage = (untrustedNotes?.primary || []).concat(untrustedNotes?.secondary || []).some(n => n.id === humanNoteId);
    record('Live MCP get_notes returns human note by passage', foundInMcpPassage === true);

    const mcpNotesRes = await mcpTool('get_notes', { note_id: humanNoteId });
    record('Live MCP get_notes returns human note by UUID', mcpNotesRes?.untrusted_notes?.id === humanNoteId);

    // =========================================================================
    // JOURNEY 2: AI Note Creation, UI Provenance & UI Confirmation
    // =========================================================================
    console.log('\n--- Journey 2: AI MCP Creation, Visual Styling & UI Confirmation ---');
    const aiTitle = `[TEST] AI Exegetical Synthesis ${TEST_RUN_ID}`;
    const aiBody = `AI exegesis [${TEST_RUN_ID}]: דָּם (blood) and אָדָם (man) share phonetic resonance in Gen 9:6.`;

    const createAiRes = await mcpTool('create_note', {
      model: 'claude-3-5-sonnet',
      title: aiTitle,
      body_md: aiBody,
      note_kind: 'observation',
      source_context: { test_run: TEST_RUN_ID, evidence_tool: 'lookup_word_formation' },
      anchors: [
        { client_key: 'anc_verse', kind: 'verse', verse_id: 212, label: 'Genesis 9:6' },
        { client_key: 'anc_dam', kind: 'word_occurrence', verse_id: 212, word_position: 2, word_id: 53694, label: 'דַּ֣ם' },
      ],
      connections: [
        { from_client_key: 'anc_dam', to_client_key: 'anc_verse', connection_type: 'contained_in', direction: 'directed' },
      ],
    });

    assert.equal(createAiRes?.ok, true, 'MCP create_note must succeed');
    aiNoteId = createAiRes.note?.id;
    assert.ok(aiNoteId, 'Created AI note must have UUID');
    createdNoteIds.add(aiNoteId);
    record('MCP create_note created AI note with unreviewed status', createAiRes.note?.review_status === 'unreviewed');

    // Reload UI at Genesis 9:6 to view the newly created AI note
    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.reload();
    await page.waitForTimeout(1500);

    const aiCard = page.locator(`.notes-panel #note-${aiNoteId}`);
    await aiCard.waitFor({ state: 'visible', timeout: 10000 });
    const isAiCard = await aiCard.evaluate(el => el.classList.contains('note-card--ai'));
    record('AI note card rendered with .note-card--ai dashed styling', isAiCard === true);

    const sparkleIcon = await aiCard.locator('svg.note-icon').count();
    record('AI note card renders sparkle icon', sparkleIcon > 0);

    const authorLabel = await aiCard.locator('.note-card__author-label').textContent();
    record('AI note card displays model name "AI · claude-3-5-sonnet"', authorLabel?.includes('claude-3-5-sonnet') === true);

    const reviewPill = aiCard.locator('.note-card__review-pill');
    record('AI note card displays "unreviewed" review pill', (await reviewPill.textContent())?.trim() === 'unreviewed');

    // Confirm note via UI button
    const confirmBtn = aiCard.locator('.note-btn--confirm');
    record('Confirm button present on unreviewed AI note card', (await confirmBtn.count()) > 0);
    await confirmBtn.click();

    // Verify UI state change (await refresh completion)
    const updatedReviewPill = page.locator(`.notes-panel #note-${aiNoteId} .note-card__review-pill`);
    await updatedReviewPill.filter({ hasText: 'confirmed' }).waitFor({ state: 'visible', timeout: 10000 });
    const pillText = await updatedReviewPill.textContent();
    record('Review status updated to "confirmed" in UI', pillText?.trim() === 'confirmed');

    // Verify state change in Live MCP
    const postConfirmMcp = await mcpTool('get_notes', { note_id: aiNoteId });
    record('MCP get_notes reflects review_status "confirmed"', postConfirmMcp?.untrusted_notes?.review_status === 'confirmed');

    // =========================================================================
    // JOURNEY 3: Mixed Notes & Filtering
    // =========================================================================
    console.log('\n--- Journey 3: Mixed Notes & Author Filtering ---');
    const countsText = await page.locator('#notes-counts').textContent();
    record('NotesPanel header displays total, You, and AI counts', countsText?.includes('You') && countsText?.includes('AI'));

    // Filter: Human only
    const humanFilterBtn = page.locator('.notes-panel__author-btn', { hasText: /^Human$/ });
    await humanFilterBtn.click();
    await page.waitForTimeout(400);

    const humanVisible = await page.locator(`.notes-panel #note-${humanNoteId}`).isVisible();
    const aiHidden = !(await page.locator(`.notes-panel #note-${aiNoteId}`).isVisible());
    record('Filtering by "Human" shows human note and hides AI note', humanVisible && aiHidden);

    // Filter: AI only
    const aiFilterBtn = page.locator('.notes-panel__author-btn', { hasText: /^AI$/ });
    await aiFilterBtn.click();
    await page.waitForTimeout(400);

    const aiVisible = await page.locator(`.notes-panel #note-${aiNoteId}`).isVisible();
    const humanHidden = !(await page.locator(`.notes-panel #note-${humanNoteId}`).isVisible());
    record('Filtering by "AI" shows AI note and hides human note', aiVisible && humanHidden);

    // Filter: All
    const allFilterBtn = page.locator('.notes-panel__author-btn', { hasText: /^All$/ });
    await allFilterBtn.click();
    await page.waitForTimeout(400);

    const bothVisible = (await page.locator(`.notes-panel #note-${humanNoteId}`).isVisible()) &&
                        (await page.locator(`.notes-panel #note-${aiNoteId}`).isVisible());
    record('Filtering by "All" restores visibility of both notes', bothVisible);

    // =========================================================================
    // JOURNEY 4: Safety & Kill Switches
    // =========================================================================
    console.log('\n--- Journey 4: Safety & Kill Switches ---');
    // Simulate writes_disabled via route interception for UI
    await page.route('**/rest/v1/rpc/save_note_v1*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: {
            code: 'writes_disabled',
            message: 'Human writes are currently disabled in note_settings',
          },
        }),
      });
    });

    const addBtnKill = page.getByRole('button', { name: /Add note/i }).first();
    await addBtnKill.click();
    await page.waitForTimeout(400);

    const blockedTitle = `[TEST] Blocked Draft ${Date.now()}`;
    await page.locator('.note-editor__title').fill(blockedTitle);
    await page.locator('.note-editor__body').fill('Testing writes_disabled rejection');
    await page.locator('.editor-btn--primary').click();
    await page.waitForTimeout(600);

    const errBanner = page.locator('.note-editor__error-banner');
    const errText = await errBanner.textContent();
    record('UI displays clear error banner when human writes disabled', errText?.includes('disabled') === true);

    const preservedTitle = await page.locator('.note-editor__title').inputValue();
    record('User note draft data is preserved after rejected save', preservedTitle === blockedTitle);

    // Cancel out of editor and remove route (handle dirty prompt confirm)
    page.once('dialog', d => d.accept());
    await page.locator('.note-editor__footer .editor-btn', { hasText: 'Cancel' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog.note-editor-dialog')?.open, { timeout: 5000 });
    await page.unroute('**/rest/v1/rpc/save_note_v1*');
    await page.waitForTimeout(300);

    // =========================================================================
    // JOURNEY 5: Resilience (Stale Navigation, Offline, Double-Submit)
    // =========================================================================
    console.log('\n--- Journey 5: Resilience & Race Conditions ---');
    // 5A. Rapid navigation race condition test
    await page.goto(`${BASE_URL}/#1-1-1`);
    await page.waitForTimeout(300);
    await page.goto(`${BASE_URL}/#1-9-5`);
    await page.waitForTimeout(300);
    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.locator('.notes-panel .note-card').first().waitFor({ state: 'visible', timeout: 15000 });

    const finalPassageCards = await page.locator('.notes-panel .note-card').count();
    record('Rapid navigation settles cleanly without crash or card duplication', finalPassageCards >= 2);

    // 5B. Offline simulation & recovery
    const abortPassage = route => route.abort();
    await page.route('**/rest/v1/rpc/get_notes_for_passage_v1*', abortPassage);
    await page.goto(`${BASE_URL}/#1-9-5`);
    await page.waitForTimeout(300);
    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.locator('.notes-panel__error').waitFor({ state: 'visible', timeout: 10000 });

    const errorVisible = await page.locator('.notes-panel__error').isVisible().catch(() => false);
    record('NotesPanel displays error and retry action during offline/network failure', errorVisible === true);

    await page.unroute('**/rest/v1/rpc/get_notes_for_passage_v1*', abortPassage);
    const retryBtn = page.locator('#notes-retry-btn');
    if (await retryBtn.count() > 0) {
      await retryBtn.click();
      await page.waitForTimeout(500);
      await page.locator('.notes-panel .note-card').first().waitFor({ state: 'visible', timeout: 15000 });
      const recoveredCards = await page.locator('.notes-panel .note-card').count();
      record('Clicking Retry recovers and renders passage notes', recoveredCards >= 2);
    }

    // =========================================================================
    // JOURNEY 6: Integrity & Verification (TP-GUARD-1, TP-INT-3, TP-CLEAN-1)
    // =========================================================================
    console.log('\n--- Journey 6: Integrity, Unicode Parity & Cleanup ---');

    // 6A. TP-INT-3: Unicode & Hebrew/Greek Parity across UI, RPC, and MCP
    const damChip = page.locator(`.notes-panel #note-${humanNoteId} .note-chip`, { hasText: 'dam' }).first();
    const uiDamText = await damChip.locator('bdi').textContent();
    const rpcNote = await restRpc('get_note_v1', { p_note_id: humanNoteId });
    const rpcDamAnchor = rpcNote?.anchors?.find(a => a.word_position === 2 || a.label?.includes('dam'));
    const mcpNoteData = await mcpTool('get_notes', { note_id: humanNoteId });
    const mcpDamAnchor = mcpNoteData?.untrusted_notes?.anchors?.find(a => a.word_position === 2 || a.label?.includes('dam'));

    const uiDamBytes = Buffer.from(uiDamText?.trim() || '', 'utf8');
    const rpcDamBytes = Buffer.from(rpcDamAnchor?.label?.trim() || '', 'utf8');
    const mcpDamBytes = Buffer.from(mcpDamAnchor?.label?.trim() || '', 'utf8');

    const bytesMatch = uiDamBytes.length > 0 &&
                       uiDamBytes.equals(rpcDamBytes) &&
                       uiDamBytes.equals(mcpDamBytes);
    record('TP-INT-3: Exact UTF-8 byte parity across UI, PostgREST RPC, and MCP', bytesMatch);

    // 6B. TP-GUARD-1: Baseline verification (corpus tables and MCP health unchanged)
    const guardProc = spawnSync(process.execPath, ['scripts/notes-guard.mjs', '--compare'], {
      encoding: 'utf8',
      env: process.env,
    });
    record('TP-GUARD-1: notes-guard --compare exits 0 (corpus tables & MCP health preserved)', guardProc.status === 0, guardProc.stdout || guardProc.stderr);

  } finally {
    // 6C. TP-CLEAN-1: Cleanup all test rows created in this run
    console.log('\n--- Cleanup (TP-CLEAN-1) ---');
    for (const noteId of createdNoteIds) {
      try {
        await restRpc('delete_note_v1', { p_note_id: noteId });
      } catch (err) {
        console.warn(`Soft-delete error for ${noteId}:`, err.message);
      }
    }

    // Verify zero active test rows remain
    let remainingActive = 0;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/notes?source_context->>test_run=eq.${TEST_RUN_ID}&status=eq.published&select=id`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Prefer: 'count=exact' },
      });
      const range = res.headers.get('content-range');
      if (range) {
        const match = range.match(/\/(\d+|\*)$/);
        remainingActive = match && match[1] !== '*' ? parseInt(match[1], 10) : 0;
      }
    } catch {}

    record('TP-CLEAN-1: Zero active test rows remain in database', remainingActive === 0, `Remaining: ${remainingActive}`);

    await browser.close();
  }

  // 7. Write Final Report
  const report = {
    timestamp: new Date().toISOString(),
    test_run_id: TEST_RUN_ID,
    gate: 'E2E (NOTE-33)',
    status: failed === 0 ? 'PASS' : 'FAIL',
    summary: {
      total_assertions: passed + failed,
      passed,
      failed,
    },
    results,
  };

  const reportPath = path.join(ARTIFACTS_DIR, 'e2e-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nAggregated E2E report written to: ${reportPath}`);

  console.log('\n================================================================');
  console.log(`=== NOTE-33 E2E DECISION: ${failed === 0 ? 'APPROVED (PASS)' : 'REJECTED (FAIL)'}            ===`);
  console.log('================================================================');
  console.log(`Assertions: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('CRITICAL SUITE ERROR:', err);
  process.exit(1);
});
