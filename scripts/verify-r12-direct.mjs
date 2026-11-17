#!/usr/bin/env node
/**
 * R12-01 browser acceptance: automatic direct evidence in WordInspector.
 * Real Chromium (Playwright) against `vite preview` of ./dist (run `npm run build` first).
 * Corpus Worker requests are served by the local scripts/corpus-worker.mjs over
 * .artifacts-r10/deploy-bundle (default); set R12_TEST_URL to test a deployed UI instead.
 * Supabase reads (verse tokens / word lookups) use the real project from .env, read-only.
 * Relationship results are never mocked. Only latency and HTTP-503 injection are simulated,
 * to prove ordering/stale-response/error handling.
 *
 * Usage: node scripts/verify-r12-direct.mjs [--only <case>]
 * Report: .artifacts-r12/reports/r12-01/report.json
 */
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import worker from './corpus-worker.mjs';

const PW_PATH = 'C:\\Projects\\BibleResearch\\.artifacts\\browser-tools\\node_modules\\playwright-core\\index.mjs';
const BUNDLE_ROOT = path.resolve('.artifacts-r10/deploy-bundle');
const OUT = path.resolve('.artifacts-r12/reports/r12-01');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const PORT = 4175;
const CORPUS = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const LEX = '.lexical-rels__body > section.lex-rels-panel:not(.r9b-ctx-panel):not(.r9b-lxx-panel):not(.r9c-explore-panel)';
const GRAM = '.lexical-rels__body > .gram-rels';

const workerEnv = {
  ASSETS: {
    async fetch(req) {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
      const full = path.join(BUNDLE_ROOT, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return new Response(fs.readFileSync(full), { status: 200 });
      return new Response('Not found', { status: 404 });
    },
  },
};

function startPreview() {
  return new Promise(resolve => {
    const proc = spawn('cmd.exe', ['/c', `npx.cmd vite preview --host 127.0.0.1 --port ${PORT} --strictPort`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false;
    const on = c => { if (!done && c.toString().includes(String(PORT))) { done = true; resolve(proc); } };
    proc.stdout.on('data', on); proc.stderr.on('data', on);
    setTimeout(() => { if (!done) resolve(proc); }, 4000);
  });
}

function chromiumExe() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  for (const sub of ['chromium-1243\\chrome-win64\\chrome.exe', 'chromium_headless_shell-1243\\chrome-headless-shell-win64\\chrome-headless-shell.exe']) {
    const p = path.join(base, sub); if (fs.existsSync(p)) return p;
  }
}

const results = [];
async function runCase(name, fn) {
  if (ONLY && !ONLY.split(',').includes(name)) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', ms: Date.now() - t0, detail });
    console.log(`PASS ${name}`, JSON.stringify(detail ?? ''));
  } catch (err) {
    results.push({ name, status: 'FAIL', ms: Date.now() - t0, error: String(err?.message || err).slice(0, 800) });
    console.log(`FAIL ${name}: ${String(err?.message || err).slice(0, 800)}`);
  }
}

async function main() {
  const { chromium } = await import(pathToFileURL(PW_PATH).href);
  const live = process.env.R12_TEST_URL;
  const server = live ? null : await startPreview();
  const browser = await chromium.launch({ headless: true, ...(chromiumExe() ? { executablePath: chromiumExe() } : {}) });
  const base = live || `http://127.0.0.1:${PORT}`;
  let calls = [];
  const hooks = { delay: null, fail: null };

  const rpcName = u => u.pathname.split('/').pop();
  async function newPage(viewport = { width: 1280, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(String(e.stack || e)));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('503') && !m.text().includes('favicon')) page.errors.push(m.text()); });
    // Optional latency on Supabase-hosted formation/candidate lookups.
    await page.route(/\/rest\/v1\/rpc\/(get_word_formation_v1|suggest_orthographic_candidates_v1)/, async route => {
      const name = rpcName(new URL(route.request().url()));
      calls.push({ rpc: name, t: Date.now(), src: 'supabase' });
      const d = hooks.delay?.(name, null); if (d) await new Promise(r => setTimeout(r, d));
      await route.continue();
    });
    if (live) {
      page.on('response', async res => {
        const req = res.request();
        const u = new URL(req.url());
        if (!u.hostname.includes('bibleresearch-corpus') || req.method() !== 'POST') return;
        let body = null;
        try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
        calls.push({ rpc: rpcName(u), op: body?.op, body, t: Date.now(), src: 'corpus', status: res.status() });
      });
    } else {
      await page.route(`${CORPUS}/**`, async route => {
        const req = route.request();
        const u = new URL(req.url());
        const name = rpcName(u);
        let body = null;
        if (req.method() === 'POST') { try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; } }
        const entry = { rpc: name, op: body?.op, body, t: Date.now(), src: 'corpus' };
        calls.push(entry);
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
        const d = hooks.delay?.(name, body); if (d) await new Promise(r => setTimeout(r, d));
        if (hooks.fail?.(name, body)) { entry.status = 503; await route.fulfill({ status: 503, headers: cors, body: '{"error":"injected"}' }); return; }
        const wreq = new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === 'POST' ? (req.postData() || '{}') : undefined });
        const resp = await worker.fetch(wreq, workerEnv, {});
        const buf = Buffer.from(await resp.arrayBuffer());
        entry.status = resp.status;
        await route.fulfill({ status: resp.status, headers: { ...Object.fromEntries(resp.headers.entries()), ...cors }, body: buf });
      });
    }
    return page;
  }

  const open = async (page, hash) => {
    await page.goto(`${base}/#${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.word-token .word-inspect', { timeout: 30000 });
  };
  const tok = (page, strongs, n = 0) => page.locator(`.word-token[data-strongs="${strongs}"] .word-inspect`).nth(n);
  const countsLoaded = page => page.waitForFunction(() => /Lex \(\d/.test(document.querySelector('.lexical-rels > summary')?.textContent || ''), null, { timeout: 30000 });
  const unified = () => calls.filter(c => c.op === 'unified_lemma');
  const reset = () => { calls = []; hooks.delay = null; hooks.fail = null; };

  async function directAssertions(page, { strongs, hash, book, chapter, verse, position }) {
    reset();
    await open(page, hash);
    calls = [];
    position ??= Number(await page.locator(`.word-token[data-strongs="${strongs}"]`).first().getAttribute('data-position'));
    const t0 = Date.now();
    await tok(page, strongs).click();
    await countsLoaded(page);
    const ms = Date.now() - t0;
    // 1. no expansion needed: disclosure open, lexical cards visible without any further click.
    assert.equal(await page.locator('.lexical-rels').evaluate(d => d.open), true, 'relationships disclosure must be open by default');
    const lexCards = await page.locator(`${LEX} .rel-card`).count();
    assert.ok(lexCards >= 1, `expected automatic lexical cards, got ${lexCards}`);
    assert.ok(await page.locator(`${LEX} .rel-card`).first().isVisible(), 'first lexical card visible');
    // 2. clicked verse context preserved.
    const u = unified().find(c => c.body.query === strongs);
    assert.ok(u, `no unified_lemma request for ${strongs}`);
    assert.deepEqual([u.body.book, u.body.chapter, u.body.verse, u.body.position], [book, chapter, verse, position], 'clicked occurrence context');
    assert.ok(u.body.word_id > 0, 'word_id sent');
    assert.equal(u.status, 200);
    const gramText = await page.locator(GRAM).innerText();
    assert.ok(
      new RegExp(`Matched [A-Z0-9]+ ${chapter}:${verse}#${position}`).test(gramText) || /Lemma-wide · no clause match for this token/.test(gramText),
      `grammar scope must be either the matched occurrence or an explicit lemma-wide notice; got: ${gramText.slice(0, 400)}`);
    const matchedOccurrence = new RegExp(`Matched [A-Z0-9]+ ${chapter}:${verse}#${position}`).test(gramText);
    assert.ok(!/undefined/.test(await page.locator('.word-inspector').innerText()), 'no "undefined" text in inspector');
    const summary = await page.locator('.lexical-rels > summary').innerText();
    const lexText = await page.locator(LEX).innerText();
    return { ms, matchedOccurrence, summary, lexCards, firstLex: lexText.split('\n').filter(Boolean).slice(3, 7).join(' | '), unified_word_id: u.body.word_id };
  }

  await runCase('hebrew-H7307-direct', async () => {
    const page = await newPage();
    const r = await directAssertions(page, { strongs: 'H7307', hash: '1-1-2', book: 1, chapter: 1, verse: 2, position: 9 });
    await page.screenshot({ path: path.join(OUT, 'desktop-H7307.png') });
    assert.equal(page.errors.length, 0, page.errors.join(' | '));
    return r;
  });

  await runCase('greek-G3056-direct', async () => {
    const page = await newPage();
    const r = await directAssertions(page, { strongs: 'G3056', hash: '43-1-1', book: 43, chapter: 1, verse: 1, position: undefined });
    await page.screenshot({ path: path.join(OUT, 'desktop-G3056.png') });
    assert.equal(page.errors.length, 0, page.errors.join(' | '));
    return r;
  });

  await runCase('formation-delay-does-not-block', async () => {
    const page = await newPage();
    await open(page, '1-1-2');
    reset();
    hooks.delay = name => (name === 'get_word_formation_v1' || name === 'suggest_orthographic_candidates_v1' ? 8000 : 0);
    const t0 = Date.now();
    await tok(page, 'H7307').click();
    await countsLoaded(page);
    const ms = Date.now() - t0;
    assert.ok(ms < 6000, `lexical counts took ${ms}ms with formation delayed 8000ms`);
    assert.ok(await page.locator(`${LEX} .rel-card`).count() >= 1);
    const first = unified()[0]?.t, form = calls.find(c => c.rpc.includes('formation') || c.rpc.includes('orthographic'))?.t;
    return { ms, unified_before_formation: form ? first <= form : 'formation request not observed' };
  });

  await runCase('rapid-reselection-no-stale', async () => {
    const page = await newPage();
    await open(page, '1-1-2');
    reset();
    // Make the FIRST selection (H7307) answer late; the second (H430) answers first.
    hooks.delay = (name, body) => (body?.op === 'unified_lemma' && body.query === 'H7307' ? 5000 : 0);
    await tok(page, 'H7307').click();
    await page.waitForTimeout(250);
    await tok(page, 'H430').click();
    await countsLoaded(page);
    await page.waitForTimeout(6500); // let the late H7307 response arrive
    const gramText = await page.locator(GRAM).innerText();
    assert.match(gramText, /#10/, 'final grammatical badge must be for position 10 (H430)');
    assert.ok(!/#9\b/.test(gramText), 'stale H7307 badge repainted');
    const lexText = await page.locator(LEX).innerText();
    assert.ok(!/H7308/.test(lexText), 'stale H7307 lexical cognate (H7308) repainted over H430');
    const eyebrow = await page.locator('.word-inspector .modal-original').innerText();
    return { final_word: eyebrow, unified_requests: unified().map(c => c.body.query) };
  });

  await runCase('follow-related-word-and-evidence', async () => {
    const page = await newPage();
    await open(page, '1-1-2');
    reset();
    await tok(page, 'H7307').click();
    await countsLoaded(page);
    // Evidence drawer on a grammatical group, then passage link opens the right reference.
    await page.locator(`${GRAM} button:has-text("Inspect evidence")`).first().click();
    await page.waitForSelector(`${GRAM} .gram-ev-list, ${GRAM} .gram-evidence-drawer, ${GRAM} .gram-ref-chip`, { timeout: 15000 });
    const firstRead = page.locator(`${GRAM} .gram-ref-chip__go`).first();
    const refLabel = await page.locator(`${GRAM} .gram-ref-chip .reference-link`).first().innerText();
    await firstRead.click();
    await page.waitForFunction(() => !location.hash.startsWith('#1-1-2'), null, { timeout: 15000 });
    const hash = await page.evaluate(() => location.hash);
    assert.match(hash, /^#\d+-\d+-\d+$/, 'navigate produced passage hash');
    // Return and follow a lexical peer.
    await open(page, '1-1-2');
    await tok(page, 'H7307').click();
    await countsLoaded(page);
    const peer = page.locator(`${LEX} .rel-card__target-btn`).first();
    const peerLabel = (await peer.innerText()).trim();
    await peer.click();
    await page.waitForFunction(
      () => !/Opening word…/.test(document.querySelector('.word-inspector')?.innerText || '')
        && /Inspecting endpoint|H7308|רוּחַ/.test(document.querySelector('.word-inspector')?.innerText || ''),
      null,
      { timeout: 15000 }
    );
    const txt = await page.locator('.word-inspector').innerText();
    assert.ok(/Inspecting endpoint|H7308|root:H7307|H73\d\d/.test(txt), `peer follow did not change the inspected word: ${txt.slice(0, 200)}`);
    return { evidence_ref: refLabel, navigated_to: hash, followed_peer: peerLabel };
  });

  await runCase('error-state-accurate', async () => {
    const page = await newPage();
    await open(page, '1-1-2');
    reset();
    hooks.fail = (name, body) => body?.op === 'unified_lemma';
    await tok(page, 'H7307').click();
    await page.waitForTimeout(5000);
    const insp = await page.locator('.word-inspector').innerText();
    assert.ok(/H7307/.test(insp), 'word summary still rendered when graph unavailable');
    assert.equal(await page.locator(`${LEX} .rel-card`).count(), 0, 'no fabricated lexical cards');
    const lex = await page.locator(LEX).innerText();
    assert.ok(/unavailable|could not|failed|error|try again/i.test(lex + (await page.locator('.lexical-rels > summary').innerText())), `error must be stated, got: ${lex.slice(0, 200)}`);
    assert.ok(!/No (extended )?(R9B )?lexical (shard )?entry/i.test(lex), 'transport error must not be reported as "no entry"');
    return { shown: lex.split('\n').filter(Boolean).slice(0, 3).join(' | ') };
  });

  await runCase('empty-state-accurate', async () => {
    const page = await newPage();
    await open(page, '1-1-2');
    reset();
    const tokens = await page.$$eval('.word-token', ns => ns.map(n => n.dataset.strongs));
    const found = [];
    for (const s of [...new Set(tokens)]) {
      await tok(page, s).click();
      await countsLoaded(page);
      const sum = await page.locator('.lexical-rels > summary').innerText();
      const lexN = Number((/Lex \(([\d,]+)\)/.exec(sum) || [])[1]?.replace(/,/g, ''));
      const cards = await page.locator(`${LEX} .rel-card`).count();
      assert.equal(cards > 0, lexN > 0, `${s}: summary says Lex (${lexN}) but ${cards} cards rendered`);
      if (lexN === 0) {
        const t = await page.locator(LEX).innerText();
        assert.ok(/no |not |none|0/i.test(t), `${s}: empty lexical layer must say so, got ${t.slice(0, 120)}`);
        found.push(s);
      }
    }
    return { tokens_checked: [...new Set(tokens)].length, empty_lexical_tokens: found };
  });

  await runCase('mobile-android-390', async () => {
    const page = await newPage({ width: 360, height: 740 });
    await open(page, '1-1-2');
    reset();
    await tok(page, 'H7307').click();
    await countsLoaded(page);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 4, `horizontal page overflow ${overflow}px at 360px`);
    const inner = await page.locator('.word-inspector').evaluate(n => n.scrollWidth - n.clientWidth);
    assert.ok(inner <= 4, `inspector horizontal overflow ${inner}px`);
    const card = page.locator(`${LEX} .rel-card`).first();
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= 361, `lexical card outside 360px viewport: ${JSON.stringify(box)}`);
    await page.screenshot({ path: path.join(OUT, 'mobile-360-H7307.png') });
    return { overflow, inner, card_box: box };
  });

  await runCase('existing-functionality-intact', async () => {
    const page = await newPage();
    await open(page, '1-1-2');
    reset();
    await tok(page, 'H7307').click();
    await countsLoaded(page);
    const t = await page.locator('.word-inspector').innerText();
    for (const needle of ['SELECTED WORD', 'Gematria', 'Strong’s H7307', 'Discover Biblical Connections', 'Unified Word', 'Grammatical (', 'Contextual (', 'LXX (']) {
      assert.ok(t.includes(needle), `missing existing element: ${needle}`);
    }
    assert.ok(await page.locator(`${LEX} .rel-card`).count() >= 1);
    assert.ok(await page.locator('.inspector-occurrences').count() === 1, 'occurrences section present');
    // Tab switching still works.
    await page.locator('.r9b-tab:has-text("Contextual")').click();
    assert.equal(await page.locator(LEX).isHidden(), true, 'lexical hidden on Contextual tab');
    await page.locator('.r9b-tab:has-text("All layers")').click();
    // Discover button sends the exact Strong\'s identifier.
    await page.locator('button:has-text("Discover Biblical Connections")').click();
    await page.waitForSelector('.discover-panel .js-discover-input', { timeout: 15000 });
    const v = await page.locator('.js-discover-input').inputValue();
    assert.equal(v, 'H7307', 'discover seed must be the exact Strong\'s id, not a concatenated gloss');
    return { discover_seed: v };
  });

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), base, results }, null, 1));
  await browser.close();
  if (server?.pid) { try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' }); } catch { /* noop */ } }
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\nR12-01 direct: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
