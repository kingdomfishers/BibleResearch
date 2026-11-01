import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const executablePath = [process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => { if (req.url().includes('/rpc/get_verse_research_v1')) requests.push(req.postDataJSON()); });
await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: async text => { window.__researchClipboard = text; } },
}));
const output = '.artifacts/hydrated-ui'; await mkdir(output, { recursive: true });
try {
  await page.goto(`${process.env.BASE_URL || 'http://localhost:3000'}/#1-1-1`);
  await page.locator('#tab-p8').click();
  assert.equal(await page.locator('#hydrated-pattern option').count(), 10);
  assert.equal(await page.locator('#hydrated-mode').inputValue(), 'all');
  assert.equal(await page.locator('#hydrated-limit').isDisabled(), true);
  await page.locator('#hydrated-additional').fill('John 1:1');
  const pending = page.waitForResponse(r => r.url().includes('/rpc/get_verse_research_v1'));
  await page.locator('#hydrated-run').click();
  const response = await pending;
  assert.equal(response.status(), 200);
  const live = await response.json();
  assert.equal(live.status, 'ok');
  await page.waitForFunction(() => document.querySelector('#hydrated-status').textContent.includes('research ready'));
  assert.equal(requests.length, 1, 'Exactly one hydration request for both verses');
  assert.equal(live.verses.length, 2);
  assert.match(await page.locator('#hydrated-summary').innerText(), /All occurrence references included/);
  assert.match(await page.locator('#hydrated-preview').textContent(), /Preview shortened/);
  await page.locator('#hydrated-copy-json').click();
  const copied = await page.evaluate(() => JSON.parse(window.__researchClipboard));
  assert.deepEqual(copied, live);
  await page.locator('#hydrated-pattern').selectOption('challenge_pattern');
  await page.locator('#hydrated-subject').fill('Test whether the proposed link survives counterexamples.');
  await page.locator('#hydrated-copy-prompt').click();
  assert.ok(await page.evaluate(() => window.__researchClipboard.includes('falsifiable claim') &&
    window.__researchClipboard.includes('get_verse_research') && window.__researchClipboard.includes('"lexical_entries"')));
  const downloading = page.waitForEvent('download');
  await page.locator('#hydrated-download').click();
  const download = await downloading; const downloadPath = `${output}/verse-research.json`;
  await download.saveAs(downloadPath);
  assert.deepEqual(JSON.parse(await readFile(downloadPath, 'utf8')), live);
  console.log('PASS one-call live multi-verse hydration, ten templates, full JSON/prompt copy and download');

  await page.locator('#hydrated-mode').selectOption('sample');
  assert.equal(await page.locator('#hydrated-limit').isDisabled(), false);
  assert.equal(await page.locator('#hydrated-copy-json').isDisabled(), true);
  await page.locator('#hydrated-limit').fill('2');
  await page.locator('#hydrated-run').click();
  await page.waitForFunction(() => document.querySelector('#hydrated-status').textContent.includes('research ready'));
  assert.match(await page.locator('#hydrated-summary').innerText(), /Sample references; corpus totals are exact/);
  await page.locator('#hydrated-additional').fill('Genesis 1:1');
  const before = requests.length;
  await page.locator('#hydrated-run').click();
  assert.match(await page.locator('#hydrated-status').innerText(), /Remove duplicate/);
  assert.equal(requests.length, before);
  await page.locator('#hydrated-additional').fill('not a reference');
  await page.locator('#hydrated-run').click();
  assert.match(await page.locator('#hydrated-status').innerText(), /Use references/);
  await page.locator('#hydrated-additional').fill('');
  await page.route('**/rpc/get_verse_research_v1', route => route.abort('failed'));
  await page.locator('#hydrated-run').click();
  await page.waitForFunction(() => document.querySelector('#hydrated-status').textContent.includes('could not be loaded'));
  assert.equal(await page.locator('#hydrated-copy-json').isDisabled(), true);
  await page.unroute('**/rpc/get_verse_research_v1');
  console.log('PASS explicit samples, local reference validation and honest offline errors');

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/rpc/get_verse_research_v1', async route => {
    await gate; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(live) });
  });
  const request = page.waitForRequest(r => r.url().includes('/rpc/get_verse_research_v1'));
  await page.locator('#hydrated-run').click(); await request;
  await page.evaluate(() => { location.hash = '43-1-2'; });
  await page.waitForFunction(() => document.querySelector('#hydrated-book').value === '43');
  release(); await page.waitForResponse(r => r.url().includes('/rpc/get_verse_research_v1'));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#hydrated-copy-json').isDisabled(), true);
  assert.equal(await page.locator('#hydrated-preview').textContent(), '');
  assert.match(await page.locator('#hydrated-status').innerText(), /Passage changed/);
  await page.unroute('**/rpc/get_verse_research_v1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#hydrated-run').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#hydrated-status').textContent.includes('research ready'));
  await page.locator('#panel-p8').screenshot({ path: `${output}/mobile.png` });
  assert.ok(await page.locator('#hydrated-download').isEnabled());
  assert.deepEqual(errors, []);
  console.log('PASS stale-response protection, passage sync, keyboard submission and mobile rendering with no page errors');
} finally { await browser.close(); }
