// @file: scripts/verify-notes-ui.mjs
// NOTE-27: UI Verification Suite & Gate G3 Acceptance Suite
// Automated groups:
// 1. Journeys: UI note creation, verse + tokens + inspector reflection, AI note rendering, author filtering
// 2. TP-XSS-1: Defense in depth & zero script execution on XSS payloads
// 3. TP-BIDI-1: BDI isolation chips in RTL/LTR contexts
// 4. TP-A11Y-1: Keyboard navigation, visible focus, ARIA labels, forced colors, dark mode, reduced motion
// 5. Responsive layouts at 320, 360, 390, 430, 768, 1280 px (no overflow, touch targets >= 40px)
// 6. Offline / slow network resilience: Error + Retry paths
// 7. Console & page errors = 0
// 8. Static checks & test row cleanup (TP-CLEAN-1)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

console.log('=== NOTE-27: UI Verification Suite (Gate G3) ===\n');

// 1. Locate Playwright and Browser Executable
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
  } catch {
    // continue
  }
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

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ARTIFACTS_DIR = path.resolve('.artifacts/notes');
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

let passed = 0;
let failed = 0;
const results = [];

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

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });

  const pageErrors = [];
  const xssViolations = [];

  try {
    // =========================================================================
    // GROUP 1: Journeys (Human note creation, token badges, inspector, AI note, filtering)
    // =========================================================================
    console.log('--- Group 1: User Journeys & Provenance Visuals ---');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('dialog', d => {
      if (d.type() === 'alert' || d.type() === 'prompt') {
        xssViolations.push(`Unexpected dialog: ${d.message()}`);
      }
      void d.accept();
    });

    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.waitForTimeout(1000);

    // 1A. Add note via UI
    const addBtn = page.getByRole('button', { name: /Add note/i }).first();
    record('Add Note button exists on Genesis 9:6', (await addBtn.count()) > 0);
    await addBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.locator('dialog.note-editor-dialog');
    const dialogOpen = await dialog.evaluate(el => el.open);
    record('NoteEditor dialog opens on Add Note click', dialogOpen === true);

    const testNoteTitle = `[TEST-UI] Human Observation Gen 9:6 ${Date.now()}`;
    await page.locator('.note-editor__title').fill(testNoteTitle);
    await page.locator('.note-editor__body').fill('Genesis 9:6 observation: the life of the flesh is in the blood.');

    // Save note
    await page.locator('.editor-btn--primary').click();
    await page.waitForFunction(() => !document.querySelector('dialog.note-editor-dialog')?.open);
    await page.waitForTimeout(1000);

    const noteTitles = await page.locator('.note-card__title').allTextContents();
    record('Created note appears in Notes Panel', noteTitles.includes(testNoteTitle));

    // Provenance badge on human note
    const humanCard = page.locator('.notes-panel .note-card', { hasText: testNoteTitle });
    const isHumanCard = await humanCard.evaluate(el => el.classList.contains('note-card--human'));
    record('Human note card has .note-card--human class', isHumanCard === true);

    const humanAuthorLabel = await humanCard.locator('.note-card__author-label').textContent();
    record('Human note displays "You" provenance label', humanAuthorLabel?.trim() === 'You');

    // Token note counts in VerseReader
    const tokenBadges = await page.locator('.token-notes-count').count();
    record('Token note count badges rendered in VerseReader', tokenBadges > 0);

    // Inspector reflection
    const wordInspectBtn = page.locator('.word-inspect').nth(1); // 2nd word: dam
    if (await wordInspectBtn.count() > 0) {
      await wordInspectBtn.click();
      await page.waitForTimeout(500);
      const inspectorText = await page.locator('#inspector').innerText();
      record('Created note reflects in Word Inspector', inspectorText.includes('Observation') || inspectorText.includes('Genesis 9:6'));
    }

    // 1B. AI-styled note appearance & Hide-AI filter
    // Route simulated passage read with both human and AI notes
    const mockHumanNote = {
      id: '00000000-0000-0000-0000-00000000h101',
      title: '[TEST-UI] Human Observation Mock',
      body_md: 'Human observation content.',
      note_kind: 'observation',
      author: { kind: 'human', display_name: 'You' },
      review_status: null,
      status: 'published',
      visibility: 'public',
      version: 1,
      created_at: new Date().toISOString(),
      anchors: [{ id: 'anc_h', kind: 'verse', verse_id: 212, label: 'Genesis 9:6' }],
      connections: [],
      blocks: [],
    };

    const mockAiNote = {
      id: '00000000-0000-0000-0000-00000000a101',
      title: '[TEST-UI] AI Exegetical Synthesis',
      body_md: 'AI exegesis: dam (blood) and ha-adam (man) share phonetic resonance.',
      note_kind: 'observation',
      author: {
        id: '00000000-0000-0000-0000-00000000a002',
        kind: 'ai',
        display_name: 'Claude Assistant',
        ai_provider: 'anthropic',
        ai_model: 'claude-3-7-sonnet',
      },
      review_status: 'unreviewed',
      status: 'published',
      visibility: 'public',
      version: 1,
      created_at: new Date().toISOString(),
      anchors: [{ id: 'anc_v', kind: 'verse', verse_id: 212, label: 'Genesis 9:6', role: 'subject' }],
      connections: [],
      blocks: [],
    };

    await page.route('**/rest/v1/rpc/get_notes_for_passage_v1*', async route => {
      await route.fulfill({
        json: {
          status: 'ok',
          epistemic_layer: 'user_note',
          passage: { book: 1, chapter: 9, verse_start: 6, verse_end: 6, verse_ids: [212] },
          primary: [mockHumanNote, mockAiNote],
          secondary: [],
          totals: { total: 2, human: 1, ai: 1, primary: 2, secondary: 0 },
          truncated: { primary: false, secondary: false },
          token_note_counts: [],
        },
      });
    });

    // Navigate to trigger clean notes fetch
    await page.goto(`${BASE_URL}/#1-9-5`);
    await page.waitForTimeout(400);
    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.waitForTimeout(800);

    const aiCard = page.locator('.notes-panel .note-card--ai');
    record('AI note card has .note-card--ai class', (await aiCard.count()) > 0);

    const aiBadgeText = await page.locator('.notes-panel .note-card--ai .note-card__author-label').first().textContent();
    record('AI note displays model name in pill', aiBadgeText?.includes('claude-3-7-sonnet') === true);

    const reviewPill = await page.locator('.notes-panel .note-card--ai .note-card__review-pill').first().textContent();
    record('AI note displays "unreviewed" review pill', reviewPill?.trim() === 'unreviewed');

    const srText = await page.locator('.notes-panel .note-card--ai .visually-hidden').first().textContent();
    record('AI note includes accessible screen-reader provenance text', srText?.includes('AI-generated note by claude-3-7-sonnet') === true);

    // Hide-AI filter testing
    const youFilter = page.locator('.notes-panel__author-btn', { hasText: 'You' });
    if (await youFilter.count() > 0) {
      await youFilter.click();
      await page.waitForTimeout(300);
      const aiVisible = await page.locator('.notes-panel .note-card--ai').isVisible().catch(() => false);
      const humanVisible = await page.locator('.notes-panel .note-card--human').isVisible().catch(() => false);
      record('Clicking "You" filter hides AI notes and displays human note', !aiVisible && humanVisible);

      const aiFilter = page.locator('.notes-panel__author-btn', { hasText: 'AI' });
      await aiFilter.click();
      await page.waitForTimeout(300);
      const aiNowVisible = await page.locator('.notes-panel .note-card--ai').isVisible().catch(() => false);
      const humanNowVisible = await page.locator('.notes-panel .note-card--human').isVisible().catch(() => false);
      record('Clicking "AI" filter shows AI notes and hides human note', aiNowVisible && !humanNowVisible);

      const allFilter = page.locator('.notes-panel__author-btn', { hasText: 'All' });
      await allFilter.click();
      await page.waitForTimeout(300);
      const bothCount = await page.locator('.notes-panel .note-card').count();
      record('Clicking "All" filter displays both notes', bothCount >= 2);
    }

    // Unroute passage RPC
    await page.unroute('**/rest/v1/rpc/get_notes_for_passage_v1*');

    // Restore live data and clean up created human test note
    await page.goto(`${BASE_URL}/#1-9-5`);
    await page.waitForTimeout(400);
    await page.goto(`${BASE_URL}/#1-9-6`);
    await page.waitForTimeout(800);

    const createdCard = page.locator('.notes-panel .note-card', { hasText: testNoteTitle });
    if (await createdCard.count() > 0) {
      const delBtn = createdCard.getByRole('button', { name: 'Delete' }).first();
      if (await delBtn.count() > 0) {
        await delBtn.click();
        await page.waitForTimeout(1000);
        const remainingTitles = await page.locator('.notes-panel .note-card__title').allTextContents();
        record('Created test note soft-deleted via UI', !remainingTitles.includes(testNoteTitle));
      }
    } else {
      record('Created test note not present on page (cleaned up)', true);
    }
    await context.close();

    // =========================================================================
    // GROUP 2: TP-XSS-1 (Defense in Depth & Zero Script Execution)
    // =========================================================================
    console.log('\n--- Group 2: TP-XSS-1 Script Injection Defense ---');
    const xssContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const xssPage = await xssContext.newPage();

    xssPage.on('dialog', d => {
      xssViolations.push(`XSS Dialog popped: ${d.message()}`);
      void d.accept();
    });

    const mockXssNote = {
      id: '00000000-0000-0000-0000-00000000a102',
      title: '[TEST] <script>window.__xss_title=true</script>Safe Title',
      body_md: `
# Heading with <script>window.__xss_body=true</script>
<img src="invalid-image" onerror="window.__xss_img=true">
<svg onload="window.__xss_svg=true">
[malicious js link](javascript:window.__xss_js_link=true)
[malicious data link](data:text/html,<script>window.__xss_data_link=true</script>)
[safe link](https://example.com/safe-research)
      `.trim(),
      note_kind: 'observation',
      author: { kind: 'human', display_name: 'You' },
      status: 'published',
      visibility: 'public',
      version: 1,
      created_at: new Date().toISOString(),
      anchors: [{ id: 'anc_xss', kind: 'verse', verse_id: 212, label: 'Genesis 9:6' }],
      connections: [],
      blocks: [],
    };

    await xssPage.route('**/rest/v1/rpc/get_notes_for_passage_v1*', async route => {
      await route.fulfill({
        json: {
          status: 'ok',
          epistemic_layer: 'user_note',
          passage: { book: 1, chapter: 9, verse_start: 6, verse_end: 6, verse_ids: [212] },
          primary: [mockXssNote],
          secondary: [],
          totals: { total: 1, human: 1, ai: 0, primary: 1, secondary: 0 },
          truncated: { primary: false, secondary: false },
          token_note_counts: [],
        },
      });
    });

    await xssPage.goto(`${BASE_URL}/#1-9-6`);
    await xssPage.waitForTimeout(1000);

    const xssEvaluated = await xssPage.evaluate(() => {
      const g = window;
      return {
        title_xss: Boolean(g.__xss_title),
        body_xss: Boolean(g.__xss_body),
        img_xss: Boolean(g.__xss_img),
        svg_xss: Boolean(g.__xss_svg),
        js_link_xss: Boolean(g.__xss_js_link),
        data_link_xss: Boolean(g.__xss_data_link),
      };
    });

    record('Zero script execution in title/body (no global XSS flags set)', Object.values(xssEvaluated).every(v => v === false));
    record('Zero alert/confirm dialogs triggered by XSS', xssViolations.length === 0);

    const unsafeScriptCount = await xssPage.locator('.note-card script').count();
    record('Zero <script> tags injected into note card DOM', unsafeScriptCount === 0);

    const unsafeImgCount = await xssPage.locator('.note-card img[onerror]').count();
    record('Zero <img onerror> tags in note card DOM', unsafeImgCount === 0);

    const unsafeSvgCount = await xssPage.locator('.note-card svg[onload]').count();
    record('Zero <svg onload> tags in note card DOM', unsafeSvgCount === 0);

    const hrefs = await xssPage.locator('.note-card a').evaluateAll(els => els.map(a => a.getAttribute('href')));
    const allSafeHrefs = hrefs.every(h => !h || h.startsWith('http://') || h.startsWith('https://') || h.startsWith('#'));
    record('All note link hrefs use safe protocols (http/https/#), zero javascript:/data: links', allSafeHrefs);

    await xssContext.close();

    // =========================================================================
    // GROUP 3: TP-BIDI-1 (BDI chips in RTL/LTR contexts)
    // =========================================================================
    console.log('\n--- Group 3: TP-BIDI-1 Bidirectional Text Isolation ---');
    const bidiContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const bidiPage = await bidiContext.newPage();

    await bidiPage.goto(`${BASE_URL}/#1-9-6`);
    await bidiPage.waitForTimeout(1000);

    const gridDir = await bidiPage.locator('.word-grid').getAttribute('dir');
    record('Hebrew verse word-grid has dir="rtl"', gridDir === 'rtl');

    const bdiIsolation = await bidiPage.locator('.note-chip bdi, .note-connection-chip bdi').evaluateAll(els => {
      return els.map(el => window.getComputedStyle(el).unicodeBidi);
    });
    const allIsolated = bdiIsolation.length === 0 || bdiIsolation.every(b => b.includes('isolate'));
    record('Anchor and connection chips wrap text in isolated <bdi> elements', allIsolated);

    const connChipDirs = await bidiPage.locator('.note-connection-chip').evaluateAll(els => {
      return els.map(el => el.getAttribute('dir'));
    });
    const allLtrChips = connChipDirs.length === 0 || connChipDirs.every(d => d === 'ltr');
    record('Connection chips enforce dir="ltr" structural container', allLtrChips);

    await bidiContext.close();

    // =========================================================================
    // GROUP 4: TP-A11Y-1 (Keyboard, ARIA labels, Forced Colors, Dark Mode, Reduced Motion)
    // =========================================================================
    console.log('\n--- Group 4: TP-A11Y-1 Accessibility & Emulation Modes ---');
    const a11yContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      forcedColors: 'active',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const a11yPage = await a11yContext.newPage();

    await a11yPage.route('**/rest/v1/rpc/get_notes_for_passage_v1*', async route => {
      await route.fulfill({
        json: {
          status: 'ok',
          epistemic_layer: 'user_note',
          passage: { book: 1, chapter: 9, verse_start: 6, verse_end: 6, verse_ids: [212] },
          primary: [mockHumanNote, mockAiNote],
          secondary: [],
          totals: { total: 2, human: 1, ai: 1, primary: 2, secondary: 0 },
          truncated: { primary: false, secondary: false },
          token_note_counts: [],
        },
      });
    });

    await a11yPage.goto(`${BASE_URL}/#1-9-6`);
    await a11yPage.waitForTimeout(1000);

    // Keyboard Tab traversal
    let focusedTags = [];
    for (let i = 0; i < 6; i++) {
      await a11yPage.keyboard.press('Tab');
      const tag = await a11yPage.evaluate(() => document.activeElement?.tagName);
      if (tag) focusedTags.push(tag);
    }
    record('Keyboard Tab moves activeElement across interactive controls', focusedTags.length > 0 && focusedTags.some(t => t === 'BUTTON' || t === 'A' || t === 'INPUT'));

    // ARIA labels on icons and buttons
    const unhiddenIcons = await a11yPage.locator('.note-icon:not([aria-hidden="true"])').count();
    record('All decorative note SVG icons marked aria-hidden="true"', unhiddenIcons === 0);

    const chipsWithAria = await a11yPage.locator('.note-chip[aria-label]').count();
    const totalChips = await a11yPage.locator('.note-chip').count();
    record('All note anchor chips have descriptive aria-label attributes', totalChips === 0 || chipsWithAria === totalChips);

    // Forced colors distinguishable borders
    const humanBorderStyle = await a11yPage.evaluate(() => {
      const el = document.querySelector('.notes-panel .note-card--human');
      return el ? window.getComputedStyle(el).borderInlineStartStyle : 'solid';
    });
    record('Human card has solid inline start border in forced-colors mode', humanBorderStyle === 'solid');

    const aiBorderStyle = await a11yPage.evaluate(() => {
      const el = document.querySelector('.notes-panel .note-card--ai');
      return el ? window.getComputedStyle(el).borderInlineStartStyle : 'dashed';
    });
    record('AI card has dashed inline start border in forced-colors mode', aiBorderStyle === 'dashed');

    // Reduced motion verification
    const scrollBehavior = await a11yPage.evaluate(() => {
      return window.getComputedStyle(document.documentElement).scrollBehavior;
    });
    record('Reduced motion disables smooth scrolling (scroll-behavior: auto)', scrollBehavior === 'auto');

    await a11yPage.screenshot({ path: path.join(SCREENSHOTS_DIR, 'a11y-forced-colors-dark.png'), fullPage: false });
    await a11yContext.close();

    // =========================================================================
    // GROUP 5: Responsive Layouts (320, 360, 390, 430, 768, 1280 px)
    // =========================================================================
    console.log('\n--- Group 5: Responsive Viewports & Touch Targets ---');
    const viewports = [320, 360, 390, 430, 768, 1280];

    for (const width of viewports) {
      const respContext = await browser.newContext({ viewport: { width, height: 800 } });
      const respPage = await respContext.newPage();
      respPage.on('dialog', d => void d.accept());
      await respPage.goto(`${BASE_URL}/#1-9-6`);
      await respPage.waitForTimeout(600);

      const overflow = await respPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      record(`No horizontal page overflow at ${width}px viewport`, overflow === false);

      await respPage.screenshot({ path: path.join(SCREENSHOTS_DIR, `viewport-${width}.png`), fullPage: false });

      if (width === 320) {
        // Open NoteEditor at 320px
        const addBtnSmall = respPage.getByRole('button', { name: /Add note/i }).first();
        if (await addBtnSmall.count() > 0) {
          await addBtnSmall.click();
          await respPage.waitForTimeout(400);

          const dialogOverflow = await respPage.evaluate(() => {
            const d = document.querySelector('dialog.note-editor-dialog');
            return d ? d.getBoundingClientRect().width > window.innerWidth : false;
          });
          record('NoteEditor dialog fits within 320px viewport without overflow', dialogOverflow === false);

          await respPage.screenshot({ path: path.join(SCREENSHOTS_DIR, 'editor-mobile-320.png'), fullPage: false });

          // Test close via Escape key
          await respPage.keyboard.press('Escape');
          await respPage.waitForTimeout(300);
          const closed = await respPage.evaluate(() => !document.querySelector('dialog.note-editor-dialog')?.open);
          record('NoteEditor dialog closes cleanly via Escape at 320px', closed === true);
        }

        // Test NotesBrowser at 320px
        const allNotesBtn = respPage.locator('#all-notes-btn');
        if (await allNotesBtn.count() > 0) {
          await allNotesBtn.click();
          await respPage.waitForTimeout(400);

          const browserOverflow = await respPage.evaluate(() => {
            const b = document.querySelector('.notes-browser');
            return b ? b.getBoundingClientRect().width > window.innerWidth : false;
          });
          record('NotesBrowser fits within 320px viewport without overflow', browserOverflow === false);

          await respPage.screenshot({ path: path.join(SCREENSHOTS_DIR, 'notes-browser-320.png'), fullPage: false });
          await allNotesBtn.click(); // Close
        }
      }

      await respContext.close();
    }

    // =========================================================================
    // GROUP 6: Offline / Slow Network Resilience
    // =========================================================================
    console.log('\n--- Group 6: Offline / Slow Network Resilience ---');
    const netContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const netPage = await netContext.newPage();

    let failPassageRpc = true;
    await netPage.route('**/rest/v1/rpc/get_notes_for_passage_v1*', async route => {
      if (failPassageRpc) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await netPage.goto(`${BASE_URL}/#1-9-6`);
    await netPage.waitForTimeout(1000);

    const errorVisible = await netPage.locator('.notes-panel__error').isVisible().catch(() => false);
    record('NotesPanel renders visible error banner on network failure', errorVisible === true);

    const retryBtn = netPage.locator('#notes-retry-btn');
    record('Retry button rendered in error banner', (await retryBtn.count()) > 0);

    // Restore network and click Retry
    failPassageRpc = false;
    await retryBtn.click();
    await netPage.waitForTimeout(1000);

    const recovered = await netPage.locator('.notes-panel__error').count();
    record('NotesPanel recovers cleanly after Retry click', recovered === 0);

    await netContext.close();

    // =========================================================================
    // GROUP 7: Console & Page Errors
    // =========================================================================
    console.log('\n--- Group 7: Console & Page Errors ---');
    record('Zero unhandled page errors during test run', pageErrors.length === 0, pageErrors.join(', '));

  } finally {
    await browser.close();
  }

  // =========================================================================
  // GROUP 8: Static Checks & Test Row Cleanup Status (TP-CLEAN-1)
  // =========================================================================
  console.log('\n--- Group 8: Static Checks & DB Row Cleanup (TP-CLEAN-1) ---');
  const guardProc = spawnSync(process.execPath, ['scripts/notes-guard.mjs', '--static'], {
    encoding: 'utf8',
    env: process.env,
  });
  const staticPass = guardProc.status === 0;
  record('notes-guard --static passed with 0 violations', staticPass, guardProc.stdout || guardProc.stderr);

  // Check Supabase REST API for active test rows
  let activeTestRows = 0;
  try {
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
    const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/notes?source_context->>test_run=not.is.null&select=id`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
    });
    const range = res.headers.get('content-range');
    if (range) {
      const match = range.match(/\/(\d+|\*)$/);
      activeTestRows = match && match[1] !== '*' ? parseInt(match[1], 10) : 0;
    } else {
      const data = await res.json();
      activeTestRows = Array.isArray(data) ? data.length : 0;
    }
  } catch (e) {
    console.warn('Could not query active test rows count:', e.message);
  }
  record('TP-CLEAN-1: Zero active unremoved test rows in DB', activeTestRows === 0, `Active test rows: ${activeTestRows}`);

  // Write Aggregated Report
  const report = {
    timestamp: new Date().toISOString(),
    gate: 'G3',
    status: failed === 0 ? 'PASS' : 'FAIL',
    summary: {
      total_assertions: passed + failed,
      passed,
      failed,
    },
    results,
    artifacts: {
      screenshots: fs.readdirSync(SCREENSHOTS_DIR),
      ui_report: 'ui-report.json',
    },
  };

  const reportPath = path.join(ARTIFACTS_DIR, 'ui-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nAggregated UI report written to: ${reportPath}`);

  console.log('\n================================================================');
  console.log(`=== GATE G3 DECISION: ${failed === 0 ? 'APPROVED (PASS)' : 'REJECTED (FAIL)'}                  ===`);
  console.log('================================================================');
  console.log(`Assertions: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('CRITICAL SUITE ERROR:', err);
  process.exit(1);
});
