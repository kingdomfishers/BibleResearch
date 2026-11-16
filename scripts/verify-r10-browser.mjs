#!/usr/bin/env node
/**
 * Local Playwright E2E verification for R10 Discover Connections UI.
 * Serves built `./dist` via `vite preview` and routes Worker RPCs directly
 * through local `scripts/corpus-worker.mjs` against `.artifacts-r10/deploy-bundle`.
 */

import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import worker from '../scripts/corpus-worker.mjs';

const PW_PATH = 'C:\\Projects\\BibleResearch\\.artifacts\\browser-tools\\node_modules\\playwright-core\\index.mjs';
const BUNDLE_ROOT = path.resolve('.artifacts-r10/deploy-bundle');
const SHOTS_DIR = path.resolve('.artifacts-r10/screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const workerEnv = {
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const full = path.join(BUNDLE_ROOT, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return new Response(fs.readFileSync(full), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    },
  },
};

function startPreviewServer(port = 4173) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cmd.exe', ['/c', `npx.cmd vite preview --host 127.0.0.1 --port ${port} --strictPort`], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    const onData = chunk => {
      const text = chunk.toString();
      if (!started && text.includes(String(port))) {
        started = true;
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    setTimeout(() => {
      if (!started) resolve(proc);
    }, 3500);
    proc.on('error', reject);
  });
}

function findChromiumExe() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  for (const sub of ['chromium-1243\\chrome-win64\\chrome.exe', 'chromium_headless_shell-1243\\chrome-headless-shell-win64\\chrome-headless-shell.exe']) {
    const p = path.join(base, sub);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function runBrowserTests() {
  const { chromium } = await import(pathToFileURL(PW_PATH).href);
  const liveUrl = process.env.R10_TEST_URL;
  const server = liveUrl ? null : await startPreviewServer(4173);
  const exe = findChromiumExe();
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });

  const consoleErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', err => consoleErrors.push(String(err)));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', res => {
      if (res.status() >= 400) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
    });

    if (!liveUrl) {
      await page.route('https://bibleresearch-corpus.kingdomfishers-custom.workers.dev/**', async route => {
        const req = route.request();
        const postBody = req.postData();
        const workerReq = new Request(req.url(), {
          method: req.method(),
          headers: req.headers(),
          body: req.method() === 'POST' ? (postBody || '{}') : undefined,
        });
        const resp = await worker.fetch(workerReq, workerEnv, {});
        const body = Buffer.from(await resp.arrayBuffer());
        const headers = Object.fromEntries(resp.headers.entries());
        await route.fulfill({ status: resp.status, headers, body });
      });
    }

    const baseUrl = liveUrl || 'http://127.0.0.1:4173';
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    // 1. Verify Discover Connections panel is visible prominently
    await page.waitForSelector('.discover-panel .js-discover-input');

    // 2. Test A: Multi-concept query + subclusters + bridges + SVG map toggle
    console.log('Browser Test A...');
    await page.fill('.js-discover-input', 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions');
    await page.click('.js-discover-form button[type="submit"]');
    await page.waitForSelector('.discover-conn-card');
    const textA = await page.textContent('.discover-panel');
    assert.ok(textA.includes('Concept Subclusters & Evidence Clusters'), 'Expected subclusters section in Test A');
    assert.ok(textA.includes('Bridge:'), 'Expected bridge banner in Test A');
    assert.ok(textA.includes('Revelation 4:5'), 'Expected Revelation 4:5 in Test A');
    assert.ok(textA.includes('Zechariah 4:2'), 'Expected Zechariah 4:2 in Test A');
    assert.ok(textA.includes('Ezekiel 37:9'), 'Expected Ezekiel 37:9 in Test A');
    await page.click('.js-toggle-view');
    await page.waitForSelector('.discover-map-svg-wrap svg');
    await page.screenshot({ path: path.join(SHOTS_DIR, 'desktop-testA.png'), fullPage: false });

    // 3. Test B: Red Sea baptism + Evidence drawer + Reader click-through + Return to discovery
    console.log('Browser Test B...');
    await page.fill('.js-discover-input', 'Red Sea baptism');
    await page.click('.js-discover-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('.discover-conn-card.tier-1')?.textContent?.includes('1 Corinthians 10'));
    await page.click('.discover-conn-card.tier-1 .js-toggle-evidence');
    await page.waitForSelector('.discover-evidence-drawer .discover-token-chip');
    const drawerText = await page.textContent('.discover-evidence-drawer');
    assert.ok(drawerText.includes('G0907') || drawerText.includes('H3220'), `Evidence drawer must display Strongs original tokens, got: ${drawerText?.slice(0, 300)}`);

    // Click passage to navigate Reader, then return to discovery
    await page.click('.discover-conn-card.tier-1 .js-nav-passage');
    await page.waitForSelector('.discover-return-bar');
    await page.waitForFunction(() => document.body.innerText.includes('1 Corinthians 10') || document.body.innerText.includes('Exodus 14'));
    await page.click('.js-return-discovery');

    // 4. Test C: Adam and dam
    console.log('Browser Test C...');
    await page.fill('.js-discover-input', 'Adam dam');
    await page.click('.js-discover-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('.discover-panel')?.textContent?.includes('Gen 2:7') || document.querySelector('.discover-panel')?.textContent?.includes('Genesis 2:5'));
    const textC = await page.textContent('.discover-panel');
    assert.ok(textC.includes('NO proven') || textC.includes('no proven'), 'Expected orthographic false-etymology guard');

    // 5. Inspect word in Reader -> WordInspector -> Discover Biblical Connections button
    console.log('Browser Test Inspector Integration...');
    await page.waitForSelector('.word-token .word-inspect');
    await page.click('.word-token .word-inspect');
    await page.waitForFunction(() => document.querySelector('.word-inspector')?.textContent?.includes('Discover Biblical Connections'));
    await page.screenshot({ path: path.join(SHOTS_DIR, 'desktop-inspector.png'), fullPage: false });
    await page.click('.word-inspector button:has-text("Discover Biblical Connections")');
    await page.waitForSelector('.discover-conn-card, .discover-status-banner');

    // 6. Mobile viewport check (390x844 older Android phone)
    console.log('Browser Mobile 390x844 Check...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.fill('.js-discover-input', 'Red Sea baptism');
    await page.click('.js-discover-form button[type="submit"]');
    await page.waitForSelector('.discover-conn-card.tier-1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 8, `Horizontal overflow on 390px mobile viewport: ${overflow}px`);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'mobile-testB.png'), fullPage: false });

    const criticalErrors = consoleErrors.filter(e => !e.includes('favicon'));
    assert.equal(criticalErrors.length, 0, `Console/page errors detected: ${criticalErrors.join(' | ')}`);
    console.log('ALL PLAYWRIGHT DESKTOP & MOBILE R10 UI CHECKS PASSED CLEANLY.');
  } finally {
    await browser.close();
    if (server?.pid) {
      try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' }); } catch { /* noop */ }
    }
  }
}

runBrowserTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Playwright R10 check failed:', err);
    process.exit(1);
  });
