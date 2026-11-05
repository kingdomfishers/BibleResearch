import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || new URL('../.artifacts/browser-tools/node_modules/playwright-core/index.mjs', import.meta.url).href);
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light' });
page.setDefaultTimeout(25000);
const base = process.env.BASE_URL || 'http://localhost:3000', output = '.artifacts/ux-refresh';
await mkdir(output, { recursive: true });
const errors = [], writes = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/\/rpc\/(save_word_translation|reset_word_translation)/.test(request.url())) writes.push(request.url()); });
const ready = async hash => {
  await page.goto(`${base}/#${hash}`);
  await page.waitForFunction(() => document.querySelector('.source-badge')?.textContent === 'Live database');
  await page.waitForFunction(() => document.querySelector('.word-rendering-range'));
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('.english-verse')?.textContent || 'Loading'));
};
try {
  await ready('1-1-2');
  assert.match(await page.locator('.english-verse').innerText(), /God’s Spirit/);
  const ruach = page.locator('.word-token[data-strongs="H7307"]');
  assert.deepEqual(await ruach.locator('.rendering-link').allTextContents(), ['spirit', 'wind', 'breath', 'direction / side']);
  assert.equal(await page.locator('.word-inspector[data-open="true"]').count(), 0);
  const breath = ruach.getByRole('button', { name: /^breath:/ });
  await breath.hover();
  await page.locator('.context-preview:not([hidden])').waitFor();
  await page.waitForFunction(() => !document.querySelector('.context-preview .preview-verse')?.textContent.includes('Loading'));
  assert.match(await page.locator('.context-preview').innerText(), /Genesis 6:17/);
  await page.locator('.context-preview').hover();
  assert.equal(await page.locator('.context-preview').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.context-preview').isVisible(), false);
  await breath.click();
  await page.locator('.inspector-occurrences h3').filter({ hasText: 'Rendered “breath”' }).waitFor();
  await page.locator('.evidence-row').first().waitFor();
  assert.match(await page.locator('.inspector-occurrences').innerText(), /38 tokens.*36 verses/s);
  assert.equal(writes.length, 0, 'Rendering exploration must not save a private translation');
  passed.push('Ruach ranges visible before selection; real full-verse hover; persistent preview; Escape; rendering evidence without writes');
  await page.screenshot({ path: `${output}/desktop-ruach.png`, fullPage: true });

  await page.locator('.evidence-row .reference-link').first().click();
  await page.locator('.study-preview-sheet[open] .preview-verse').waitFor();
  await page.getByRole('button', { name: 'Compare passages', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.comparison-english')].length === 2 &&
    [...document.querySelectorAll('.comparison-english')].every(n => !n.textContent.includes('Loading')));
  assert.equal(await page.locator('.comparison-passage').count(), 2);
  assert.equal(new URL(page.url()).hash, '#1-1-2');
  await page.getByRole('button', { name: 'Close comparison', exact: true }).click();
  passed.push('Pinned verse preview and side-by-side comparison preserve source passage');

  await ready('19-3-1');
  await page.locator('.timeline-active>strong').filter({ hasText: 'David flees Absalom' }).waitFor();
  assert.match(await page.locator('.context-time').innerText(), /Historical setting from superscription.*exact date unestablished/s);
  assert.match(await page.locator('.context-time').innerText(), /2 Samuel 15:13–37/);
  await page.screenshot({ path: `${output}/desktop-psalm3.png`, fullPage: true });
  await page.locator('.timeline-text-lane').getByRole('button', { name: '2 Samuel 15:13–37', exact: true }).click();
  await page.getByRole('button', { name: 'Open passage →', exact: true }).click();
  await page.waitForURL('**/#10-15-13');
  await page.goBack(); await page.waitForURL('**/#19-3-1');
  passed.push('Psalm/event cross-book association, honest date labels and Back navigation');

  await ready('43-4-7');
  await page.locator('.context-places .place-name-link').first().waitFor();
  await page.locator('.context-places .place-name-link').first().click();
  assert.equal(await page.locator('.verse-map-panel').evaluate(n => n.open), true);
  assert.equal(new URL(page.url()).hash, '#43-4-7');
  await page.locator('.maplibregl-canvas').waitFor();
  passed.push('Direct context place action opens existing map without changing the passage');

  await ready('43-1-1');
  assert.equal(await page.locator('.word-grid').getAttribute('dir'), 'ltr');
  const logos = page.locator('.word-token[data-strongs="G3056"]');
  assert.equal(await logos.count(), 3);
  await logos.first().locator('.word-inspect').click();
  const first = await page.locator('.word-token.is-selected').getAttribute('data-position');
  await logos.last().locator('.word-inspect').click();
  assert.notEqual(await page.locator('.word-token.is-selected').getAttribute('data-position'), first);
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#appearance').click(); assert.notEqual(await page.locator('html').getAttribute('data-theme'), theme);
  await page.reload(); assert.notEqual(await page.locator('html').getAttribute('data-theme'), theme);
  passed.push('Greek and repeated-token selection; light/dark preference persistence');

  for (const width of [320, 360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await ready('1-1-2');
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(dimensions.scroll <= dimensions.width + 1, `Horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
    await page.locator('.word-token[data-strongs="H7307"] .word-inspect').click();
    await page.locator('.word-inspector[data-open="true"] .inspector-close').waitFor();
    await page.getByRole('button', { name: 'Close word details', exact: true }).click();
    assert.equal(await page.locator('.word-inspector').getAttribute('data-open'), 'false');
    if (width === 390) await page.screenshot({ path: `${output}/mobile-ruach.png`, fullPage: true });
  }
  passed.push('320–768px reflow, visible ranges, touch detail sheet and reachable close');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await ready('1-1-1');
  await page.locator('#research-disclosure>summary').click();
  assert.equal(await page.locator('.research-tab').count(), 9);
  await page.locator('#tab-p8').click(); assert.equal(await page.locator('#hydrated-pattern option').count(), 10);
  passed.push('All nine advanced capabilities and ten research templates retained');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser-results.json`, JSON.stringify({ passed, errors, writes: writes.length }, null, 2));
  console.log(JSON.stringify({ passed, errors, writes: writes.length }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failed-browser.png`, fullPage: true }).catch(() => {});
  console.error('PAGE ERRORS', JSON.stringify(errors)); throw error;
} finally { await browser.close(); }
