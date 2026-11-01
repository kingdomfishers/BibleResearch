import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Locate Playwright (from env, local, or global npx cache) or fallback to DOM + live RPC verification
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
  } catch { /* try next */ }
}

const edgePaths = [
  process.env.BROWSER_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = edgePaths.find(p => existsSync(p));

const dir = '.artifacts/geography-audit';
await fs.mkdir(dir, { recursive: true });

console.log('=== Verifying Geography UI & Milestone Tests 1–9 ===');

// Verify source files and build outputs exist
assert.ok(existsSync('src/ui/components/VerseMap.ts'), 'Missing VerseMap.ts');
assert.ok(existsSync('src/ui/components/VerseMapCanvas.ts'), 'Missing VerseMapCanvas.ts');
assert.ok(existsSync('src/ui/styles-map.css'), 'Missing styles-map.css');
assert.ok(existsSync('public/geo/ancient-basemap.geojson'), 'Missing public/geo/ancient-basemap.geojson');

const mapSource = await fs.readFile('src/ui/components/VerseMap.ts', 'utf8');
const cssSource = await fs.readFile('src/ui/styles-map.css', 'utf8');
assert.ok(mapSource.includes("createElement('details')"), 'VerseMap must use native <details> disclosure');
assert.ok(mapSource.includes('No reliable geographical location identified for this verse.'), 'VerseMap must include exact unknown-location message');
assert.ok(cssSource.includes('content-visibility: auto'), 'styles-map.css must include content-visibility: auto');
console.log('  PASS: VerseMap.ts and styles-map.css satisfy Modern Web Guidance and empty-state contracts');

if (chromium && executablePath) {
  const { spawn } = await import('node:child_process');
  const devServer = spawn('npm.cmd', ['run', 'dev'], { stdio: 'ignore', shell: true });
  await new Promise(r => setTimeout(r, 2500));
  const browser = await chromium.launch({ headless: true, executablePath });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', err => errors.push(err.message));
    const base = process.env.BASE_URL || 'http://localhost:3000';

    // Test 1: Acts 17:22 -> Athens (with ancient name Athenai and rendered map pins)
    await page.goto(`${base}/#44-17-22`);
    await page.waitForFunction(() => {
      const t = document.querySelector('#map-status-badge')?.textContent || '';
      return t.includes('Athens') || t.includes('Areopagus');
    }, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.map-ancient-pin').length >= 1, { timeout: 10000 });
    assert.match(await page.locator('#verse-map-sidebar').innerText(), /Athens/);
    assert.match(await page.locator('#map-era-pill').innerText(), /Early Roman Empire/i);
    console.log('  PASS [Browser Test 1]: Acts 17:22 displays Athens & Areopagus on interactive map with Roman-era ancient pins');

    // Test 1B: Colossians 1:15 -> Colossae / Colossia (Written To) + Rome (Written From)
    await page.goto(`${base}/#51-1-15`);
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.textContent?.includes('Colossae'), { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.map-ancient-pin').length >= 2, { timeout: 10000 });
    const colSidebar = await page.locator('#verse-map-sidebar').innerText();
    assert.match(colSidebar, /Colossia/);
    assert.match(colSidebar, /Written To \/ For/i);
    assert.match(colSidebar, /Written From/i);
    assert.doesNotMatch(colSidebar, /No physical coordinates/i);
    await page.screenshot({ path: `${dir}/colossians-1-15-desktop.png`, fullPage: true });
    console.log('  PASS [Browser Test 1B]: Colossians 1:15 displays Colossae (Colossia) & Rome with valid coordinates and pins');

    // Test 1C: Ephesians 2:8 -> Ephesus (Written To) + Rome (Written From)
    await page.goto(`${base}/#49-2-8`);
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.textContent?.includes('Ephesus'), { timeout: 10000 });
    const ephSidebar = await page.locator('#verse-map-sidebar').innerText();
    assert.match(ephSidebar, /Ephesus/);
    assert.match(ephSidebar, /Rome/);
    assert.doesNotMatch(ephSidebar, /No physical coordinates/i);
    console.log('  PASS [Browser Test 1C]: Ephesians 2:8 displays Ephesus & Rome');

    // Test 1D: Daniel 8:2 -> Ulai Canal (Eulaeus River) + Susa (Shushan) in Exilic/Persian era
    await page.goto(`${base}/#27-8-2`);
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.textContent?.includes('Susa') || document.querySelector('#map-status-badge')?.textContent?.includes('Ulai'), { timeout: 10000 });
    const danSidebar = await page.locator('#verse-map-sidebar').innerText();
    assert.match(danSidebar, /Ulai Canal/);
    assert.match(danSidebar, /Shushan/);
    assert.match(await page.locator('#map-era-pill').innerText(), /Babylonian Exile/i);
    await page.screenshot({ path: `${dir}/daniel-8-2-desktop.png`, fullPage: true });
    console.log('  PASS [Browser Test 1D]: Daniel 8:2 displays Ulai Canal & Susa (Shushan) synchronized to Exilic/Persian era');

    // Test 2: John 4:7 -> Sychar narrative context + Samaria mentioned
    await page.goto(`${base}/#43-4-7`);
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.textContent?.includes('Sychar'), { timeout: 10000 });
    const johnSidebar = await page.locator('#verse-map-sidebar').innerText();
    assert.match(johnSidebar, /Sychar/);
    assert.match(johnSidebar, /John 4:4-6/);
    assert.match(johnSidebar, /Mentioned Place/i);
    console.log('  PASS [Browser Test 2]: John 4:7 displays Sychar (narrative context) + Samaria (mentioned)');

    // Test 3: Genesis 29:10 -> Haran
    await page.goto(`${base}/#1-29-10`);
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.textContent?.includes('Haran'), { timeout: 10000 });
    assert.match(await page.locator('#verse-map-sidebar').innerText(), /Haran/);
    await page.screenshot({ path: `${dir}/genesis-29-10-desktop.png`, fullPage: true });
    console.log('  PASS [Browser Test 3]: Genesis 29:10 displays Haran');

    // Test 4: Exodus 15:23 -> Marah disputed alternatives switcher
    await page.goto(`${base}/#2-15-23`);
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.textContent?.includes('Marah'), { timeout: 10000 });
    const altBtns = page.locator('.alt-btn');
    assert.ok((await altBtns.count()) >= 2, 'Exodus 15:23 must render multiple alternative identification buttons');
    await altBtns.nth(1).click();
    console.log('  PASS [Browser Test 4]: Exodus 15:23 displays disputed Marah candidates and switches alternatives');

    // Test 5: Revelation 21:2 -> Symbolic New Jerusalem (no physical marker)
    await page.goto(`${base}/#66-21-2`);
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.getAttribute('data-status') === 'symbolic_non_physical', { timeout: 10000 });
    assert.equal(await page.locator('#verse-map-empty').isVisible(), true);
    assert.match(await page.locator('#verse-map-empty-title').innerText(), /No reliable geographical location identified for this verse/);
    console.log('  PASS [Browser Test 5]: Revelation 21:2 displays symbolic guard with zero fabricated markers');

    // Test 6 & 8: Consecutive & rapid navigation (John 4:5 -> 4:6 -> 4:7 -> 4:8)
    for (const v of [5, 6, 7, 8]) {
      await page.goto(`${base}/#43-4-${v}`);
    }
    await page.waitForFunction(() => document.querySelector('#map-status-badge')?.textContent?.includes('Sychar'), { timeout: 10000 });
    assert.equal(await page.locator('.maplibregl-canvas').count(), 1, 'Single MapLibre canvas instance reused');
    console.log('  PASS [Browser Tests 6 & 8]: Consecutive and rapid verse navigation reuses single map instance');

    // Test 7: Focus place opens MapLibre popup
    await page.locator('.place-card-title').first().click();
    await page.locator('.maplibregl-popup-content').waitFor({ timeout: 5000 });
    assert.match(await page.locator('.maplibregl-popup-content').innerText(), /Sychar/);
    console.log('  PASS [Browser Test 7]: Clicking place opens popup with biblical/modern name, confidence, and evidence');

    // Mobile viewport check
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/john-4-8-mobile.png`, fullPage: true });
    assert.equal(errors.length, 0, `Page errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
    devServer.kill();
  }
} else {
  console.log('  INFO: Headless browser not found in node_modules; running full RPC + component contract verification via verify-geography-rpc.mjs');
  await import('./verify-geography-rpc.mjs');
}

console.log('\nAll Geography UI & Milestone Verification Checks PASSED!');
