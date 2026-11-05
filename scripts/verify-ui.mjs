import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Run against the dev server. PLAYWRIGHT_MODULE may point to an existing installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const base = process.env.BASE_URL || 'http://localhost:3000';
const output = '.artifacts';
await mkdir(output, { recursive: true });
const errors = [];
const checked = [];
const makePage = async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  return page;
};
const settle = page => page.waitForFunction(() => document.querySelector('.reader-card')?.getAttribute('aria-busy') === 'false');
try {
  const page = await makePage();
  // A configured database that returns no rows must still show the fixture.
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.goto(`${base}/#1-1-1`);
  await settle(page);
  assert.equal(await page.locator('.word-token').count(), 7);
  assert.equal(await page.locator('.word-grid').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('[name="book"] option').count(), 66);
  assert.equal(await page.locator('.source-badge').innerText(), 'Built-in sample');
  const geometry = await page.locator('.word-token').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().x));
  assert(geometry[0] > geometry[6], 'Hebrew must begin at the right');
  await page.locator('.word-inspect').first().click();
  await page.locator('.strongs').waitFor();
  assert.match(await page.locator('dialog').innerText(), /H7225/);
  assert.match(await page.locator('dialog').innerText(), /Gematria 913/);
  assert.match(await page.locator('dialog').innerText(), /Frequency 1/);
  await page.screenshot({ path: `${output}/word-inspector.png`, fullPage: true });
  await page.locator('.related-words button').first().click();
  await page.waitForFunction(() => document.querySelector('.strongs')?.textContent?.includes('H1254'));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
  checked.push('Hebrew direction, 66 books, word inspector, related word, Escape');

  await page.locator('.sample-links a[href="#43-1-1"]').click();
  await page.waitForFunction(() => document.querySelector('.word-grid')?.getAttribute('dir') === 'ltr');
  assert.equal(await page.locator('.word-token').count(), 17);
  assert.equal(await page.locator('[name="book"]').inputValue(), '43');
  assert.equal(await page.locator('.millennium strong').innerText(), 'Not mapped');
  await page.locator('.word-inspect').nth(4).click();
  await page.locator('.strongs').waitFor();
  assert.match(await page.locator('dialog').innerText(), /G3056/);
  assert.match(await page.locator('dialog').innerText(), /Gematria 373/);
  await page.getByRole('button', { name: 'Close word inspector' }).click();
  await page.screenshot({ path: `${output}/john-desktop.png`, fullPage: true });
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.word-grid')?.getAttribute('dir') === 'rtl');
  checked.push('Greek tokens, grammar popup, sample navigation, browser Back');

  await page.getByLabel('Book', { exact: true }).selectOption('19');
  await settle(page);
  assert.match(await page.locator('.reader-empty').innerText(), /not been imported/);
  assert.equal(await page.locator('.word-token').count(), 0);
  await page.locator('.passage-nav').getByLabel('Chapter', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Read passage' }).click();
  assert.match(page.url(), /#19-2-1$/);
  await page.goto(`${base}/#999-0-0`);
  await page.locator('.word-token').first().waitFor();
  assert.match(page.url(), /#1-1-1$/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout must not overflow');
  await page.locator('.word-inspect').first().click();
  await page.locator('.strongs').waitFor();
  await page.screenshot({ path: `${output}/word-inspector-mobile.png`, fullPage: true });
  await page.mouse.click(4, 4);
  assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
  await page.screenshot({ path: `${output}/genesis-mobile.png`, fullPage: true });
  checked.push('Empty passage, selector submission, malformed hash, mobile layout, backdrop close');

  const offline = await makePage();
  await offline.route('**/src/api/supabase.ts*', route => route.fulfill({
    contentType: 'application/javascript', body: 'export const supabase = null; export const restoreReaderSession = async () => null; export const ensureReaderSession = async () => {};',
  }));
  await offline.goto(`${base}/#43-1-1`);
  await settle(offline);
  assert.equal(await offline.locator('.word-token').count(), 17);
  await offline.context().setOffline(true);
  await offline.locator('.sample-links a[href="#1-1-1"]').click();
  await offline.locator('.word-inspect').first().click();
  await offline.locator('.strongs').waitFor();
  assert.match(await offline.locator('dialog').innerText(), /H7225/);
  checked.push('Missing credentials and offline sample navigation/inspection');

  const live = await makePage();
  const word = { id: 123, original_word: 'λόγος', transliteration: 'logos', strongs_nr: 'G3056',
    grammar_code: 'N-NSM', biblical_def: 'Test live definition', physical_def: null,
    english_translations: ['word'], co_occurrences: [] };
  await live.route('**/rest/v1/**', route => {
    const url = route.request().url();
    if (url.includes('get_verse_translations_v1')) return route.fulfill({ json: [{ ...word,
      word_id: word.id, word_position: 1, primary_english: 'word', millennium: 4,
      source_english: 'word', selected_english: null, has_choice: false, source_ref: 'Jhn.1.1#05' }] });
    if (url.includes('/words?')) return route.fulfill({ json: word });
    return route.fulfill({ json: [] });
  });
  await live.goto(`${base}/#43-1-1`);
  await live.waitForFunction(() => document.querySelector('.source-badge')?.textContent === 'Live database');
  assert.equal(await live.locator('.word-token').count(), 1);
  await live.locator('.word-inspect').click();
  await live.locator('.strongs').waitFor();
  assert.match(await live.locator('dialog').innerText(), /Test live definition/);
  checked.push('Mock live data overrides sample; positive word ID opens live details');

  const failed = await makePage();
  await failed.route('**/rest/v1/**', route => route.abort('failed'));
  await failed.goto(`${base}/#1-1-1`);
  await settle(failed);
  assert.equal(await failed.locator('.word-token').count(), 7);
  assert.equal(await failed.locator('.source-badge').innerText(), 'Built-in sample');
  checked.push('Failed network falls back to the correct sample');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checked, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
