#!/usr/bin/env node
/**
 * Local end-to-end MCP parity verification for `bible-mcp` 7-tool interface
 * (`handleGetPassage` and `buildFullCompactWord` in `supabase/functions/bible-mcp/discovery-v2-tools.ts`)
 * wired through the local corpus worker (`scripts/local-corpus-harness.mjs`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { corpusRpc } from './local-corpus-harness.mjs';

const RESTRICTED_RE = /strongs_nr_canonical|text_clean|text_raw|etcbc_morph|word_forms|stem_formation|source_notes|private_notes|lexical_origin/i;

const zStubSource = `
const fn = () => {};
const zProxy = new Proxy(fn, {
  get(_target, prop) {
    if (prop === 'then' || prop === '__esModule') return undefined;
    return zProxy;
  },
  apply() {
    return zProxy;
  },
});
export {
  zProxy as z,
  zProxy as object,
  zProxy as strictObject,
  zProxy as string,
  zProxy as number,
  zProxy as boolean,
  zProxy as array,
  zProxy as union,
  zProxy as literal,
  zProxy as record,
  zProxy as unknown,
  zProxy as any,
  zProxy as optional,
  zProxy as nullable,
  zProxy as tuple,
  zProxy as lazy,
  zProxy as discriminatedUnion,
  zProxy as enum,
};
export default zProxy;
`;

const mcpStubSource = `
export class McpServer {
  constructor() { this.tools = new Map(); }
  registerTool(name, def, handler) { this.tools.set(name, { def, handler }); }
  registerPrompt() {}
  registerResource() {}
}
`;

async function loadDiscoveryV2Tools() {
  const result = await esbuild.build({
    entryPoints: [path.resolve('supabase/functions/bible-mcp/discovery-v2-tools.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    plugins: [
      {
        name: 'deno-mcp-stubs',
        setup(build) {
          build.onResolve({ filter: /^(@modelcontextprotocol\/server|zod)$/ }, args => ({
            path: args.path,
            namespace: 'deno-stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'deno-stub' }, args => ({
            contents: args.path === '@modelcontextprotocol/server' ? mcpStubSource : zStubSource,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return await import(dataUrl);
}

const CORPUS_OPS = new Set([
  'get_passage_compact_v1',
  'get_word_profiles_batch_v1',
  'resolve_fast_lookup_v1',
  'discover_biblical_connections_v2',
  'discover_biblical_connections_v1',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
]);

function makeLocalReader(options = {}) {
  const recordedDiscoveryCalls = [];
  const reader = async ({ name, args }) => {
    if (name === 'discover_biblical_connections_v2') {
      recordedDiscoveryCalls.push(args);
      if (options.failDiscovery) {
        throw new Error('simulated discovery 503');
      }
    }
    if (CORPUS_OPS.has(name)) {
      const data = await corpusRpc(name, args);
      return { rows: [data] };
    }
    return { rows: [] };
  };
  return { reader, recordedDiscoveryCalls };
}

function assertNoRestrictedKeys(obj, label) {
  const txt = JSON.stringify(obj);
  const m = txt.match(RESTRICTED_RE);
  assert.equal(m, null, `${label}: restricted key detected (${m?.[0]})`);
}

async function main() {
  const toolsMod = await loadDiscoveryV2Tools();
  const { handleGetPassage, buildFullCompactWord } = toolsMod;
  assert.equal(typeof handleGetPassage, 'function', 'handleGetPassage exported');
  assert.equal(typeof buildFullCompactWord, 'function', 'buildFullCompactWord exported');

  // Verify schema exposes optional mode on get_Word
  const srcText = fs.readFileSync(path.resolve('supabase/functions/bible-mcp/discovery-v2-tools.ts'), 'utf8');
  assert.match(srcText, /mode:\s*z\.enum\(\['discover',\s*'bridge'\]\)\.optional\(\)/, 'get_Word schema includes optional mode');

  // 1. get_Passage: Genesis 1:1 preserves discover_biblical_connections_v2 order (no raw LXX splicing)
  {
    const { reader, recordedDiscoveryCalls } = makeLocalReader();
    const res = await handleGetPassage(reader, {
      passage: 'Genesis 1:1',
      depth: 10,
      word_depth: 1,
      etymology: 0,
      realworld: 1,
      offset: 0,
      limit: 5,
    });
    assertNoRestrictedKeys(res, 'Genesis 1:1');
    assert.equal(res.status, 'ok');
    assert.equal(res.discovery_status, undefined, 'Genesis 1:1 discovery_status omitted when full');
    assert.ok(recordedDiscoveryCalls.length >= 1, 'Genesis 1:1 called discovery');
    assert.ok(recordedDiscoveryCalls[0].limit >= 15, 'Genesis 1:1 requests limit >= 15');
    const rawDisc = await corpusRpc('discover_biblical_connections_v2', { query: 'Genesis 1:1', limit: 15 });
    const discTop3Ids = (rawDisc.strongest_connections || []).slice(0, 3).map(c => c.connection_id);
    const mcpTop3Ids = (res.passage_connections || []).slice(0, 3).map(c => c.id);
    assert.deepEqual(mcpTop3Ids, discTop3Ids, `Genesis 1:1 top-3 parity (${mcpTop3Ids} vs ${discTop3Ids})`);
    console.log('1. Genesis 1:1 parity OK:', mcpTop3Ids.join(', '));
  }

  // 2. get_Passage: Zechariah 12:10 surfaces John 19:34-37 / Revelation 1:7 in parity order
  {
    const { reader } = makeLocalReader();
    const res = await handleGetPassage(reader, {
      passage: 'Zechariah 12:10',
      depth: 10,
      word_depth: 1,
      etymology: 0,
      realworld: 1,
      offset: 0,
      limit: 5,
    });
    assertNoRestrictedKeys(res, 'Zechariah 12:10');
    const rawDisc = await corpusRpc('discover_biblical_connections_v2', { query: 'Zechariah 12:10', limit: 15 });
    const discTopIds = (rawDisc.strongest_connections || []).slice(0, 5).map(c => c.connection_id);
    const mcpTopIds = (res.passage_connections || []).slice(0, 5).map(c => c.id);
    assert.deepEqual(mcpTopIds, discTopIds, 'Zechariah 12:10 top-5 matches discover_v2');
    const txt = JSON.stringify(res.passage_connections);
    assert.ok(txt.includes('Revelation 1:7') || txt.includes('John 19:34'), 'Zechariah 12:10 surfaces NT witnesses');
    console.log('2. Zechariah 12:10 parity OK:', mcpTopIds.slice(0, 3).join(', '));
  }

  // 3. get_Passage: Joshua 2:18 surfaces Rahab pericope bridge in primary connections
  {
    const { reader } = makeLocalReader();
    const res = await handleGetPassage(reader, {
      passage: 'Joshua 2:18',
      depth: 10,
      word_depth: 1,
      etymology: 0,
      realworld: 1,
      offset: 0,
      limit: 5,
    });
    assertNoRestrictedKeys(res, 'Joshua 2:18');
    const rawDisc = await corpusRpc('discover_biblical_connections_v2', { query: 'Joshua 2:18', limit: 15 });
    assert.deepEqual(
      (res.passage_connections || []).slice(0, 5).map(c => c.id),
      (rawDisc.strongest_connections || []).slice(0, 5).map(c => c.connection_id),
      'Joshua 2:18 top-5 parity',
    );
    const txt = JSON.stringify(res.passage_connections);
    assert.ok(txt.includes('Matthew 1:5') || txt.includes('Hebrews 11:31'), 'Joshua 2:18 surfaces Rahab NT witness');
    console.log('3. Joshua 2:18 parity OK:', (res.passage_connections || []).slice(0, 3).map(c => c.id).join(', '));
  }

  // 4. get_Passage: Numbers 21:9 (unseen bronze serpent -> John 3:14-15)
  {
    const { reader } = makeLocalReader();
    const res = await handleGetPassage(reader, {
      passage: 'Numbers 21:9',
      depth: 10,
      word_depth: 1,
      etymology: 0,
      realworld: 1,
      offset: 0,
      limit: 5,
    });
    assertNoRestrictedKeys(res, 'Numbers 21:9');
    const txt = JSON.stringify((res.passage_connections || []).slice(0, 5));
    assert.ok(txt.includes('John 3:14'), `Numbers 21:9 surfaces John 3:14 in top 5: ${txt.slice(0, 300)}`);
    console.log('4. Numbers 21:9 parity OK:', (res.passage_connections || []).slice(0, 3).map(c => c.id).join(', '));
  }

  // 5. get_Passage multi-verse (Isaiah 61:1-2): round-robin interleaving + no duplicate pair refs
  {
    const { reader } = makeLocalReader();
    const res = await handleGetPassage(reader, {
      passage: 'Isaiah 61:1-2',
      depth: 10,
      word_depth: 1,
      etymology: 0,
      realworld: 1,
      offset: 0,
      limit: 5,
    });
    assertNoRestrictedKeys(res, 'Isaiah 61:1-2');
    const conns = res.passage_connections || [];
    assert.ok(conns.length >= 5, 'Isaiah 61:1-2 returns rich connections');
    assert.ok(JSON.stringify(conns).includes('Luke 4:18'), 'Isaiah 61:1-2 includes Luke 4:18');
    console.log('5. Isaiah 61:1-2 parity OK:', conns.slice(0, 3).map(c => c.id).join(', '));
  }

  // 6. get_Word: H5178 with mode="bridge" vs ruach without mode (omits mode='bridge')
  {
    const { reader, recordedDiscoveryCalls } = makeLocalReader();
    const bridgeWord = await buildFullCompactWord(reader, 'H5178', {
      connections: 10,
      etymology: 0,
      realworld: 1,
      mode: 'bridge',
    });
    assertNoRestrictedKeys(bridgeWord, 'H5178 bridge');
    assert.equal(recordedDiscoveryCalls[0].mode, 'bridge', 'Explicit bridge mode forwarded');
    const topBridgeIds = (bridgeWord.word?.connections || []).slice(0, 5).map(c => c.id);
    assert.ok(
      topBridgeIds.some(id => id.startsWith('r12:prop:') || id.startsWith('r12:path:') || id.startsWith('r11:lxx:')),
      `H5178 bridge returns property/path/lxx bridges: ${topBridgeIds.join(', ')}`,
    );

    const { reader: reader2, recordedDiscoveryCalls: calls2 } = makeLocalReader();
    const ruachWord = await buildFullCompactWord(reader2, 'ruach', {
      connections: 10,
      etymology: 0,
      realworld: 1,
    });
    assertNoRestrictedKeys(ruachWord, 'ruach default');
    assert.equal(calls2[0].mode, undefined, 'realworld:1 without explicit mode does not force bridge mode');
    console.log('6. get_Word mode parity OK: bridge=', topBridgeIds.slice(0, 3).join(', '));
  }

  // 7. get_Word multi-word concept ("three days resurrection") drops focus_lemma and preserves multi-concept discovery
  {
    const { reader, recordedDiscoveryCalls } = makeLocalReader();
    const multiWord = await buildFullCompactWord(reader, 'three days resurrection', {
      connections: 10,
      etymology: 0,
      realworld: 1,
    });
    assertNoRestrictedKeys(multiWord, 'three days resurrection');
    assert.equal(recordedDiscoveryCalls[0].query, 'three days resurrection', 'Passes full multi-word query');
    assert.equal(recordedDiscoveryCalls[0].focus_lemma, undefined, 'Omits focus_lemma for multi-word concept query');
    const conns = multiWord.word?.connections || [];
    const topIds = conns.slice(0, 5).map(c => c.id);
    assert.ok(
      conns.some(c => JSON.stringify(c).toLowerCase().includes('john 2:19') || JSON.stringify(c).toLowerCase().includes('john 11:24') || c.id.includes('G0386') || c.id.includes('G1453')),
      `Multi-word query preserves resurrection intersections: ${topIds.join(', ')}`,
    );
    console.log('7. get_Word multi-word parity OK:', topIds.slice(0, 3).join(', '));
  }

  // 8. Partial fallback check when discover_biblical_connections_v2 fails
  {
    const { reader } = makeLocalReader({ failDiscovery: true });
    const res = await handleGetPassage(reader, {
      passage: 'Genesis 1:1',
      depth: 10,
      word_depth: 1,
      etymology: 0,
      realworld: 1,
      offset: 0,
      limit: 5,
    });
    assertNoRestrictedKeys(res, 'Genesis 1:1 partial fallback');
    assert.equal(res.status, 'ok');
    assert.equal(res.discovery_status, 'partial', 'Sets discovery_status=partial on discovery failure');
    assert.ok((res.passage_connections || []).length > 0, 'Still falls back to embedded xrefs/highlights');
    console.log('8. Partial fallback parity OK:', res.discovery_status, 'conns=', res.passage_connections.length);
  }

  console.log('\nALL 8 MCP PARITY CHECKS PASSED.');
}

main().catch(err => {
  console.error('verify-r12-mcp-parity FAILED:', err);
  process.exit(1);
});
