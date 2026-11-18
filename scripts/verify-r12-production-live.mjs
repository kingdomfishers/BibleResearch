#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CORPUS_URL = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const WEBSITE_URL = 'https://bibleresearch.kingdomfishers-custom.workers.dev';
const MCP_BASE = 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp';
const MCP_URL = `${MCP_BASE}/mcp`;
const MCP_HEALTH_URL = `${MCP_BASE}/health`;

const PW_PATH = 'C:\\Projects\\BibleResearch\\.artifacts\\browser-tools\\node_modules\\playwright-core\\index.mjs';

function findChromiumExecutable() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const candidates = [
    path.join(root, 'chromium-1243', 'chrome-win64', 'chrome.exe'),
    path.join(root, 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root)) {
      const p1 = path.join(root, entry, 'chrome-win64', 'chrome.exe');
      const p2 = path.join(root, entry, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (fs.existsSync(p1)) return p1;
      if (fs.existsSync(p2)) return p2;
    }
  }
  throw new Error(`Chromium executable not found under ${root}`);
}

class McpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.sessionId = null;
    this.protocolVersion = '2025-03-26';
  }

  async send(method, params = {}, isNotification = false) {
    const body = {
      jsonrpc: '2.0',
      method,
      ...(isNotification ? {} : { id: this.nextId++ }),
      ...(params !== undefined ? { params } : {}),
    };
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Protocol-Version': this.protocolVersion,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const proto = res.headers.get('mcp-protocol-version');
    if (proto) this.protocolVersion = proto;

    if (isNotification) {
      await res.arrayBuffer().catch(() => {});
      return null;
    }

    assert.ok(res.ok, `MCP ${method} failed with HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    const raw = await res.text();
    let msg;
    if (ct.includes('text/event-stream')) {
      const dataLines = raw
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .filter(Boolean);
      const parsed = dataLines
        .map((d) => {
          try { return JSON.parse(d); } catch { return null; }
        })
        .filter((m) => m && ('result' in m || 'error' in m));
      assert.ok(parsed.length > 0, `No JSON-RPC result in SSE response for ${method}: ${raw.slice(0, 300)}`);
      msg = parsed[parsed.length - 1];
    } else {
      msg = JSON.parse(raw);
    }
    if (msg.error) {
      throw new Error(`MCP error in ${method}: ${JSON.stringify(msg.error)}`);
    }
    return msg.result;
  }

  async initialize() {
    const res = await this.send('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'verify-r12-production-live', version: '1.0.0' },
    });
    await this.send('notifications/initialized', {}, true);
    return res;
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const res = await this.send('tools/list', cursor ? { cursor } : {});
      tools.push(...(res.tools || []));
      cursor = res.nextCursor;
    } while (cursor);
    return tools;
  }

  async listPrompts() {
    const prompts = [];
    let cursor;
    do {
      const res = await this.send('prompts/list', cursor ? { cursor } : {});
      prompts.push(...(res.prompts || []));
      cursor = res.nextCursor;
    } while (cursor);
    return prompts;
  }

  async callTool(name, args = {}) {
    let res = await this.send('tools/call', { name, arguments: args });
    if (res.isError) {
      const msg = JSON.stringify(res);
      if (/HTTP 50[234]/.test(msg)) {
        await new Promise((r) => setTimeout(r, 800));
        res = await this.send('tools/call', { name, arguments: args });
      }
    }
    assert.ok(!res.isError, `Tool ${name} returned isError=true: ${JSON.stringify(res).slice(0, 500)}`);
    if (res.structuredContent && typeof res.structuredContent === 'object') {
      return res.structuredContent;
    }
    const text = res.content?.find((c) => c.type === 'text')?.text || '{}';
    return JSON.parse(text);
  }
}

async function runMcpChecks() {
  console.log('\n=== 1. MAIN MCP PRODUCTION ACCEPTANCE TESTS ===');
  const healthRes = await fetch(MCP_HEALTH_URL, { signal: AbortSignal.timeout(15000) });
  assert.equal(healthRes.status, 200, 'MCP /health HTTP 200');
  const health = await healthRes.json();
  console.log('MCP /health:', health);
  assert.equal(health.status, 'ok');
  assert.equal(health.corpus_target, 'production');
  assert.equal(health.corpus_url, CORPUS_URL);
  assert.equal(health.writes, 'enabled');
  assert.equal(health.tools, 46);
  assert.equal(health.prompts, 22);

  const client = new McpClient(MCP_URL);
  const init = await client.initialize();
  console.log('MCP initialize:', init.serverInfo);
  assert.equal(init.serverInfo?.name, 'BibleResearch');

  const tools = await client.listTools();
  const toolNames = new Set(tools.map((t) => t.name));
  console.log(`MCP tools/list: ${tools.length} tools`);
  assert.equal(tools.length, 46, `Expected 46 tools, got ${tools.length}`);

  const requiredTools = [
    'get_research_prompt',
    'get_verse_research',
    'get_verse_hydrated',
    'research_word_lens',
    'trace_biblical_bridge',
    'research_passage_lens',
    'get_dlm_research',
    'research_macula_syntax',
    'get_unified_word_relationships_v2',
    'get_word_relationships_v2',
    'get_relationship_coverage_v2',
    'resolve_research_concept_v1',
    'discover_relationship_paths_v1',
    'discover_biblical_connections_v2',
    'discover_biblical_connections_v1',
    'get_connection_evidence_v1',
    'expand_biblical_connection_v1',
    'get_septuagint_passage',
    'get_notes',
    'search_note_targets',
    'list_note_connection_types',
    'create_note',
    'update_my_note',
    'delete_my_note',
    'add_research_note',
    'save_dlm_research_note',
  ];
  for (const t of requiredTools) {
    assert.ok(toolNames.has(t), `Missing expected MCP tool: ${t}`);
  }

  // Verify occurrence-anchor schema fields are exposed on discovery tools
  const discV2Tool = tools.find((t) => t.name === 'discover_biblical_connections_v2');
  const discV2Props = Object.keys(discV2Tool?.inputSchema?.properties || {});
  for (const k of ['word_id', 'book', 'chapter', 'verse', 'position', 'edition_key']) {
    assert.ok(discV2Props.includes(k), `discover_biblical_connections_v2 missing schema property ${k}`);
  }

  const prompts = await client.listPrompts();
  console.log(`MCP prompts/list: ${prompts.length} prompts`);
  assert.equal(prompts.length, 22, `Expected 22 prompts, got ${prompts.length}`);

  // Check relationship coverage routing to production R12 corpus
  const cov = await client.callTool('get_relationship_coverage_v2', {});
  console.log('MCP coverage verification_release:', cov.verification_release);
  assert.equal(cov.verification_release?.corpus_target, 'production');
  assert.equal(cov.verification_release?.corpus_url, CORPUS_URL);
  assert.equal(cov.verification_release?.corpus_release, 'r12-witnesses-1');
  assert.equal(cov.release_version, 'r9b-v1.1');

  // Hebrew: Genesis 1:2, H7307, position 9 -> STEP ID 130555
  const heb = await client.callTool('get_unified_word_relationships_v2', {
    book: 1,
    chapter: 1,
    verse: 2,
    position: 9,
    query: 'H7307',
  });
  assert.equal(heb.status, 'ok');
  assert.equal(heb.resolved_occurrence?.word_id, 130555);
  assert.equal(heb.verification_release?.corpus_release, 'r12-witnesses-1');
  console.log('MCP Hebrew Gen 1:2 H7307 pos 9 -> word_id:', heb.resolved_occurrence?.word_id);

  // Occurrence-anchored discovery + mismatch control
  const hebDisc = await client.callTool('discover_biblical_connections_v2', {
    query: 'H7307',
    word_id: 130555,
    book: 1,
    chapter: 1,
    verse: 2,
    position: 9,
    limit: 6,
  });
  assert.equal(hebDisc.status, 'ok');
  assert.equal(hebDisc.selected_occurrence?.word_id, 130555);
  assert.equal(hebDisc.discovery_scope?.level, 'lemma_and_concept_index');
  assert.equal(hebDisc.discovery_scope?.occurrence_anchored, true);

  const mismatch = await client.callTool('discover_biblical_connections_v2', {
    word_id: 999999999,
    book: 1,
    chapter: 1,
    verse: 2,
    position: 9,
  });
  assert.equal(mismatch.status, 'selector_mismatch');
  console.log('MCP occurrence mismatch control -> status:', mismatch.status);

  // Greek: John 1:1, G3056, positions 5/8/17 -> IDs 15230/15229/15231
  const j5 = await client.callTool('get_unified_word_relationships_v2', { book: 43, chapter: 1, verse: 1, position: 5, query: 'G3056' });
  const j8 = await client.callTool('get_unified_word_relationships_v2', { book: 43, chapter: 1, verse: 1, position: 8, query: 'G3056' });
  const j17 = await client.callTool('get_unified_word_relationships_v2', { book: 43, chapter: 1, verse: 1, position: 17, query: 'G3056' });
  const greekIds = [j5.resolved_occurrence?.word_id, j8.resolved_occurrence?.word_id, j17.resolved_occurrence?.word_id];
  assert.deepEqual(greekIds, [15230, 15229, 15231]);
  console.log('MCP Greek John 1:1 G3056 pos 5/8/17 -> word_ids:', greekIds);

  // Discovery: "scarlet Tamar Rahab Matthew 1" -> real results & expandable evidence
  const scarlet = await client.callTool('discover_biblical_connections_v2', {
    query: 'scarlet Tamar Rahab Matthew 1',
    limit: 6,
  });
  assert.equal(scarlet.status, 'ok');
  assert.ok((scarlet.strongest_connections || []).length > 0, 'Expected non-empty strongest_connections for scarlet Tamar Rahab Matthew 1');
  const firstScarletEvId = scarlet.strongest_connections[0]?.evidence_id;
  assert.ok(firstScarletEvId, 'Expected evidence_id on first scarlet connection');
  const scarletEv = await client.callTool('get_connection_evidence_v1', { evidence_id: firstScarletEvId });
  assert.equal(scarletEv.status, 'ok');
  const clusterOrGram = scarlet.strongest_connections.find((c) =>
    String(c.evidence_id || '').startsWith('r11:cluster:') || String(c.evidence_id || '').startsWith('r11:gram:')
  );
  assert.ok(clusterOrGram?.evidence_id, 'Expected a cluster/grammatical connection on scarlet Tamar Rahab Matthew 1');
  const clusterEv = await client.callTool('get_connection_evidence_v1', { evidence_id: clusterOrGram.evidence_id });
  assert.equal(clusterEv.status, 'ok');
  console.log('MCP Discovery "scarlet Tamar Rahab Matthew 1":', scarlet.strongest_connections.length, 'connections, first evidence:', firstScarletEvId, '+ cluster/gram:', clusterOrGram.evidence_id);

  // Hebrew evidence: "r11:gram:H5397:possessive_construction_with:H7307"
  const evHeb = await client.callTool('get_connection_evidence_v1', {
    evidence_id: 'r11:gram:H5397:possessive_construction_with:H7307',
  });
  assert.equal(evHeb.status, 'ok');
  assert.ok(JSON.stringify(evHeb).includes('H5397') && JSON.stringify(evHeb).includes('H7307'));
  console.log('MCP Hebrew evidence r11:gram:H5397:possessive_construction_with:H7307 -> OK');

  // Greek evidence: "r11:gram:G3037:modifies:G5093"
  const evGrk = await client.callTool('get_connection_evidence_v1', {
    evidence_id: 'r11:gram:G3037:modifies:G5093',
  });
  assert.equal(evGrk.status, 'ok');
  assert.ok(JSON.stringify(evGrk).includes('G3037') && JSON.stringify(evGrk).includes('G5093'));
  console.log('MCP Greek evidence r11:gram:G3037:modifies:G5093 -> OK');

  // Connection expansion
  const exp = await client.callTool('expand_biblical_connection_v1', { node_id: 'lemma:H7307', limit: 6 });
  assert.equal(exp.status, 'ok');
  const expList = exp.connections || exp.neighbors || [];
  assert.ok(expList.length > 0, 'Expected connections/neighbors on expand_biblical_connection_v1(lemma:H7307)');
  console.log('MCP Expand lemma:H7307 ->', expList.length, 'connections');

  // Negative control: "spirit wind" must not fabricate two separate occurrences from one token
  const neg = await client.callTool('discover_biblical_connections_v2', { query: 'spirit wind', limit: 8 });
  assert.equal(neg.status, 'ok');
  assert.ok(!JSON.stringify(neg).includes('r11:intersect:verse:H7307:H7307:2'), 'Negative control emitted false H7307:H7307 self-intersection');
  console.log('MCP Negative control "spirit wind" -> OK (no self-intersection)');

  // Legacy/compatibility tools: get_verse_research, get_notes, get_septuagint_passage
  const vr = await client.callTool('get_verse_research', {
    profile: 'analysis',
    p_request: { passages: [{ book: 1, chapter: 1, verse: 2 }] },
  });
  assert.equal(vr.status, 'ok');
  assert.ok(vr.notes && typeof vr.notes === 'object', 'Expected notes field on get_verse_research');

  const notesRes = await client.callTool('get_notes', { book: 1, chapter: 1, verse_start: 2 });
  assert.equal(notesRes.epistemic_layer, 'user_note');

  const lxx = await client.callTool('get_septuagint_passage', { p_book_no: 1, p_chapter: 32, p_verse_nr: 1 });
  assert.equal(lxx.found, true);
  assert.equal(lxx.verification_release?.corpus_url, CORPUS_URL);
  console.log('MCP Compatibility checks (get_verse_research, get_notes, get_septuagint_passage) -> OK');

  return {
    health,
    toolsCount: tools.length,
    promptsCount: prompts.length,
    hebrewWordId: heb.resolved_occurrence?.word_id,
    greekWordIds: greekIds,
    firstScarletEvidenceId: firstScarletEvId,
  };
}

async function runCoreBrowserWorkflow(page, modeLabel, viewport) {
  console.log(`\n--- Browser workflow (${modeLabel} ${viewport.width}x${viewport.height}) ---`);
  const pageErrors = [];
  const consoleErrors = [];
  const onPageError = (err) => pageErrors.push(String(err));
  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  await page.setViewportSize(viewport);
  await page.goto(`${WEBSITE_URL}/#1-1-2`, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for Gen 1:2 H7307 token to render
  const tokenSel = '.word-token[data-strongs="H7307"] .word-inspect';
  await page.waitForSelector(tokenSel, { timeout: 20000 });
  await page.click(tokenSel);

  // Wait for Lexical / Relationships to load in inspector
  await page.waitForSelector('.word-inspector button:has-text("Discover Biblical Connections")', { timeout: 20000 });
  await page.waitForFunction(
    () => /Lex\s*\(\d/.test(document.querySelector('.lexical-rels > summary')?.textContent || '') ||
          Boolean(document.querySelector('.lex-rel-panel')),
    null,
    { timeout: 20000 },
  );

  // Click Discover Biblical Connections
  await page.click('.word-inspector button:has-text("Discover Biblical Connections")');
  await page.waitForSelector('.discover-origin-banner', { timeout: 20000 });

  const originText = await page.textContent('.discover-origin-banner');
  console.log(`[${modeLabel}] Origin banner:`, originText?.replace(/\s+/g, ' ').trim());
  assert.ok(originText?.includes('130555'), 'Origin banner should preserve exact STEP word_id 130555');
  assert.ok(originText?.includes('H7307'), 'Origin banner should include H7307');
  assert.ok(originText?.toLowerCase().includes('lemma'), 'Origin banner should explain lemma-level discovery scope');

  // Wait for real discovery result cards
  await page.waitForSelector('.discover-conn-card .js-toggle-evidence', { timeout: 25000 });
  const cardCount = await page.locator('.discover-conn-card').count();
  console.log(`[${modeLabel}] Discovery cards rendered:`, cardCount);
  assert.ok(cardCount > 0, 'Expected at least 1 discovery card');

  // Inspect exact evidence
  await page.locator('.discover-conn-card .js-toggle-evidence').first().click();
  await page.waitForSelector('.discover-evidence-drawer .js-nav-passage, .discover-evidence-drawer .discover-token-strip', { timeout: 25000 });
  const evText = await page.textContent('.discover-evidence-drawer');
  assert.ok(evText && evText.length > 40, 'Evidence drawer should display supporting evidence details');
  console.log(`[${modeLabel}] Evidence drawer opened (${evText.trim().slice(0, 120).replace(/\s+/g, ' ')}...)`);

  // Follow a passage reference inside evidence drawer or card (prefer a passage different from 1:1:2)
  const navLoc = page.locator('.discover-evidence-drawer .js-nav-passage, .discover-conn-card .js-nav-passage');
  await navLoc.first().waitFor({ state: 'visible', timeout: 10000 });
  const navCount = await navLoc.count();
  let chosenNav = navLoc.first();
  for (let i = 0; i < navCount; i++) {
    const candidate = navLoc.nth(i);
    const refKey = await candidate.evaluate((el) => `${el.getAttribute('data-book')}:${el.getAttribute('data-chapter')}:${el.getAttribute('data-verse')}`);
    if (refKey !== '1:1:2') {
      chosenNav = candidate;
      break;
    }
  }
  const targetRefLabel = (await chosenNav.textContent())?.trim();
  await chosenNav.click();

  await page.waitForSelector('.discover-return-bar .js-return-origin-selection', { timeout: 15000 });
  const hashAfterFollow = await page.evaluate(() => window.location.hash);
  console.log(`[${modeLabel}] Followed passage "${targetRefLabel}", hash now:`, hashAfterFollow);

  // Return to initial selection
  await page.click('.discover-return-bar .js-return-origin-selection');
  await page.waitForFunction(() => window.location.hash === '#1-1-2', null, { timeout: 15000 });
  await page.waitForSelector('.word-token.selected[data-strongs="H7307"], .word-inspector', { timeout: 15000 });
  console.log(`[${modeLabel}] Returned to initial selection #1-1-2`);

  // Check horizontal overflow (especially critical at 390px mobile width)
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflowPx: document.documentElement.scrollWidth - window.innerWidth,
  }));
  console.log(`[${modeLabel}] Layout width metrics:`, metrics);
  assert.ok(metrics.overflowPx <= 4, `Horizontal overflow too large at ${viewport.width}px: ${metrics.overflowPx}px`);

  // Desktop-only extra search verification: scarlet Tamar Rahab Matthew 1 & negative control spirit wind
  if (modeLabel === 'desktop') {
    await page.fill('.js-discover-input', 'scarlet Tamar Rahab Matthew 1');
    await page.click('.js-discover-submit');
    await page.waitForFunction(
      () => !(document.querySelector('.js-discover-submit')?.hasAttribute('disabled')) &&
            document.querySelectorAll('.discover-conn-card').length > 0 &&
            (document.querySelector('.discover-panel')?.textContent || '').toLowerCase().includes('scarlet'),
      null,
      { timeout: 25000 },
    );
    const scarletCards = await page.locator('.discover-conn-card').count();
    console.log('[desktop] Search "scarlet Tamar Rahab Matthew 1" cards:', scarletCards);
    assert.ok(scarletCards > 0, 'Expected discovery cards for scarlet Tamar Rahab Matthew 1');

    // Open evidence drawer on top scarlet connection (r11:intersect:pericope:...)
    await page.locator('.discover-conn-card .js-toggle-evidence').first().click();
    await page.waitForSelector('.discover-evidence-drawer .discover-token-strip, .discover-evidence-drawer .js-nav-passage', { timeout: 25000 });
    console.log('[desktop] First "scarlet Tamar Rahab Matthew 1" evidence drawer expanded cleanly');

    // Negative control: "spirit wind" must not produce false same-token H7307+H7307 intersection
    await page.fill('.js-discover-input', 'spirit wind');
    await page.click('.js-discover-submit');
    await page.waitForFunction(
      () => !(document.querySelector('.js-discover-submit')?.hasAttribute('disabled')) &&
            (document.querySelector('.discover-panel')?.textContent || '').toLowerCase().includes('spirit'),
      null,
      { timeout: 25000 },
    );
    const hasFalseSelf = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-evidence-id]')).some((el) =>
        (el.getAttribute('data-evidence-id') || '').includes('r11:intersect:verse:H7307:H7307:2')
      )
    );
    assert.equal(hasFalseSelf, false, 'UI rendered false same-token H7307:H7307 intersection on spirit wind');
    console.log('[desktop] Negative control "spirit wind" -> OK');
  }

  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  assert.equal(pageErrors.length, 0, `Uncaught page errors (${modeLabel}): ${pageErrors.join(' | ')}`);
  const fatalConsole = consoleErrors.filter((e) => !e.includes('favicon.ico'));
  assert.equal(fatalConsole.length, 0, `Console errors (${modeLabel}): ${fatalConsole.join(' | ')}`);
}

async function runBrowserChecks() {
  console.log('\n=== 2. MAIN WEBSITE BROWSER ACCEPTANCE TESTS ===');
  const pw = await import(pathToFileURL(PW_PATH).href);
  const executablePath = findChromiumExecutable();
  console.log('Using Chromium:', executablePath);
  const browser = await pw.chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext();
    const corpusUrls = new Set();

    for (const [label, viewport] of [
      ['desktop', { width: 1280, height: 900 }],
      ['mobile', { width: 390, height: 844 }],
    ]) {
      const page = await context.newPage();
      page.on('request', (req) => {
        const u = req.url();
        if (u.includes('bibleresearch-corpus')) {
          corpusUrls.add(new URL(u).origin);
        }
      });
      try {
        await runCoreBrowserWorkflow(page, label, viewport);
      } finally {
        await page.close();
      }
    }

    console.log('Observed corpus origins from browser:', [...corpusUrls]);
    assert.ok(corpusUrls.has(CORPUS_URL), `Expected browser to call ${CORPUS_URL}`);
    assert.ok(!([...corpusUrls].some((u) => u.includes('staging'))), 'Browser must not call staging corpus');
  } finally {
    await browser.close();
  }
}

const mcpSummary = await runMcpChecks();
await runBrowserChecks();
console.log('\nALL PRODUCTION R12 ACCEPTANCE TESTS PASSED:', JSON.stringify(mcpSummary));
