import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const base = process.env.BASE_URL || 'http://localhost:3000';
const errors = [];
const checked = [];

const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on('pageerror', e => errors.push(e.message));

try {
  console.log('Testing Research Panel and Prompts UI in browser...');

  await page.goto(`${base}/#1-1-1`);
  await page.waitForSelector('.research-panel');

  // 1. Verify tabs
  const tabCount = await page.locator('.research-tab').count();
  assert.equal(tabCount, 5, 'Must have 5 research tabs');
  checked.push('Research panel mounted with 5 tabs');

  // 2. Test Prompt 1 (Verse Words)
  await page.locator('#tab-p1').click();
  await page.locator('#p1-form .run-btn').click();
  await page.waitForSelector('.p1-token-card');
  const tokenCount = await page.locator('.p1-token-card').count();
  assert.equal(tokenCount, 7, 'Genesis 1:1 has 7 tokens');
  checked.push('Prompt 1 (prompt_verse_words) rendered 7 ordered tokens');

  // 3. Test clicking token opens WordModal with Occurrences & Co-occurrences
  await page.locator('.p1-token-card').first().click();
  await page.waitForSelector('.word-modal[open]');
  await page.waitForFunction(() => document.querySelector('.word-modal')?.getAttribute('aria-busy') === 'false');
  assert.match(await page.locator('.word-modal').innerText(), /Prompt 2 · Word occurrences/);
  assert.match(await page.locator('.word-modal').innerText(), /Prompt 3 · Co-occurring words/);
  checked.push('WordModal opened from Prompt 1 token, showing Prompts 2 and 3');

  // 4. Test Prompt 4 comparison inside WordModal
  const compareBtn = page.locator('.related-compare-btn').first();
  if (await compareBtn.count() > 0) {
    await compareBtn.click();
    await page.waitForSelector('.modal-relationships .relationships-list');
    assert.match(await page.locator('.modal-relationships').innerText(), /Prompt 4 · Shared verses/);
    checked.push('WordModal inline Prompt 4 comparison executed and rendered');
  }

  // Close modal
  await page.locator('.modal-close').click();
  await page.waitForFunction(() => !document.querySelector('.word-modal')?.hasAttribute('open'));

  // 5. Test Prompt 2 (Word Occurrences)
  await page.locator('#tab-p2').click();
  await page.locator('#p2-form .run-btn').click();
  await page.waitForSelector('.p2-chip');
  const occCount = await page.locator('.p2-chip').count();
  assert(occCount > 0, 'Prompt 2 must return occurrence chips');
  checked.push(`Prompt 2 (prompt_word_occurrences) rendered ${occCount} passage chips`);

  // 6. Test Prompt 3 (Word Co-occurrences)
  await page.locator('#tab-p3').click();
  await page.locator('#p3-form .run-btn').click();
  await page.waitForSelector('.p3-item');
  const coCount = await page.locator('.p3-item').count();
  assert(coCount > 0, 'Prompt 3 must return co-occurrence items');
  checked.push(`Prompt 3 (prompt_word_cooccurrences) rendered ${coCount} lexical partners`);

  // 7. Test Prompt 4 (Multi-Word Relationships)
  await page.locator('#tab-p4').click();
  await page.locator('#p4-form .run-btn').click();
  await page.waitForSelector('.p4-item');
  const relCount = await page.locator('.p4-item').count();
  assert(relCount > 0, 'Prompt 4 must return shared verses');
  checked.push(`Prompt 4 (prompt_word_relationships) rendered ${relCount} shared verses with scores`);

  // 8. Test OpenAPI tab
  await page.locator('#tab-api').click();
  assert.match(await page.locator('.openapi-guide').innerText(), /OpenAPI 3.1.0 Specification/);
  assert.match(await page.locator('.prompt-table').innerText(), /prompt_verse_words/);
  assert.match(await page.locator('.prompt-table').innerText(), /prompt_word_relationships/);
  checked.push('OpenAPI 3.1.0 & AI Actions documentation tab rendered');

  assert.deepEqual(errors, [], 'No page errors allowed');
  console.log('\nAll Research UI checks PASSED:');
  checked.forEach(c => console.log(`  PASS: ${c}`));
} finally {
  await browser.close();
}
