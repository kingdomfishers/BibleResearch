/** Local D1.3 parity, page bounds, missing-coverage and shared-cache regression checks. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { prepareFastAssets } from './prepare-r11-fast-assets.mjs';
import { readJson, inventoryRoot, validateInventory, walkFiles, hashFile } from './r12-evidence.mjs';
import { readSelectiveKey, discoverBiblicalConnections, getConnectionEvidence } from '../src/relationships/r10-discovery.ts';
import { loadJsonShardWithBytes, shardCacheStats } from './corpus-worker.mjs';

export async function reliability() {
  const dir = path.resolve('.artifacts-r12/reports', `reliability-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);
  fs.mkdirSync(dir, { recursive: true });
  const report = { status: 'blocked', checks: [], report_dir: dir };
  try {
    const inputs = readJson('.artifacts-r12/inputs.json'); assert.equal(inputs.status, 'pass');
    const pin = inputs.sources.find(s => s.kind === 'combined_local_bundle'); await validateInventory({ sources: [pin] });
    const release = 'r11-v1.0', relative = `v2/relationships/${release}`;
    const input = path.join(inputs.roots.bundle, relative), bundle = process.env.R12_REUSE_CANDIDATE ? fs.realpathSync(process.env.R12_REUSE_CANDIDATE) : path.join(dir, 'candidate-bundle');
    assert.ok(bundle.toLowerCase().startsWith(path.resolve('.artifacts-r12/reports').toLowerCase() + path.sep), 'Candidate must stay inside R12 report artifacts');
    const output = path.join(bundle, relative);
    verifyPreparerGuards(input);
    report.checks.push('Preparer rejects existing and nested output directories before any writes');
    if (process.env.R12_REUSE_CANDIDATE) {
      assert.equal(readJson(path.join(output,'r10/fast-manifest.json.gz')).selective,true);
      report.preparation = { mode: 'resume local candidate; full content parity and source validation still required', bundle };
    } else report.preparation = prepareFastAssets(input, output);
    // Bounded parallel copying avoids serial Windows per-file latency. Completed
    // files may be resumed only after checking their pinned content hash.
    const copies = pin.files.filter(f => f.path !== input && !f.path.startsWith(input + path.sep));
    for (let offset=0;offset<copies.length;offset+=16) {
      await Promise.all(copies.slice(offset,offset+16).map(async file => {
        const target = path.join(bundle,path.relative(pin.root,file.path));
        if (fs.existsSync(target) && fs.statSync(target).size === file.bytes && await hashFile(target) === file.sha256) return;
        fs.mkdirSync(path.dirname(target),{recursive:true}); await fs.promises.copyFile(file.path,target);
      }));
      if (offset % 1024 === 0) console.log(`[R12 reliability] copied/verified ${Math.min(offset+16,copies.length)}/${copies.length} unchanged files`);
    }
    const files = [...walkFiles(bundle)];
    assert.ok(files.length <= 20000, `Combined free asset count ${files.length} >20000`);
    assert.ok(files.every(f => fs.statSync(f).size <= 25 * 1024 * 1024));
    report.combined_files = files.length;
    // Offline parity may retain one namespace; this is not the Worker cache.
    const memo = new Map();
    const reader = { async readJson(asset) {
      if (!memo.has(asset)) { const file = path.join(bundle, asset.replace(/^\//,''));
        memo.set(asset, fs.existsSync(file) ? { data: readJson(file), bytes: zlib.gunzipSync(fs.readFileSync(file)).length } : null); }
      const result = memo.get(asset);
      if (memo.size > 8192) memo.delete(memo.keys().next().value);
      return result;
    }};
    const budget = () => ({ used: 0, max: 1000, missing: [] });
    for (const [source,field,namespace] of [['lemma-lookup','entries','lookup'],['lemma-profiles','entries','profiles'],['evidence-passages','verses','verses']]) {
      let count = 0;
      for (const name of fs.readdirSync(path.join(input,'r10',source))) {
        const entries = readJson(path.join(input,'r10',source,name))[field];
        for (const [key,value] of Array.isArray(entries) ? entries : Object.entries(entries)) {
          assert.deepEqual(await readSelectiveKey(reader,release,namespace,key,budget()),value,`${namespace}:${key}`); count++;
          if (namespace === 'verses') assert.equal(await readSelectiveKey(reader,release,'refs',`${value.book}:${value.chapter}:${value.verse}`,budget()),key);
        }
      }
      memo.clear(); console.log(`[R12 reliability] ${namespace}: ${count} exact entries verified`);
      report.checks.push(`Exact ${namespace} parity: ${count} entries`);
    }
    for (const file of walkFiles(path.join(output,'r10/selective'))) {
      const max = /[\\/](lookup|refs)[\\/]/.test(file) ? 64 * 1024 : 128 * 1024;
      assert.ok(zlib.gunzipSync(fs.readFileSync(file)).length <= max, file);
    }
    report.checks.push('Every directory, leaf and continuation page within decoded bounds; combined bundle within free asset limits');
    report.checks.push(...await verifyCandidateHydration(bundle));
    const seen = [];
    const missingReader = { async readJson(asset) { seen.push(asset); return asset.includes('/selective/') ? null : reader.readJson(asset); }};
    const result = await discoverBiblicalConnections(missingReader,{ query: 'Genesis 1:1', release_id: release });
    assert.equal(result.search_metadata.completeness_state,'missing_source_coverage');
    assert.ok(!seen.some(p => p.includes('/evidence-passages/')));
    const evidence = await getConnectionEvidence(missingReader,'r11:cluster:H7799:temple_and_sanctuary_architecture',release);
    assert.equal(evidence.status,'not_found'); assert.equal(evidence.coverage.state,'missing_source_coverage'); assert.ok(!seen.some(p => p.includes('/evidence-passages/')));
    report.checks.push('Missing candidate pages surface incomplete discovery; no legacy book fallback');
    const b = { used: 0, max: 0, missing: [] };
    assert.equal(await readSelectiveKey(reader,release,'lookup','lily',b),null); assert.ok(b.missing[0].startsWith('budget:'));
    report.checks.push('Exhausted read budget never returns a partial continued record');
    await verifySharedCache();
    report.checks.push('Cache byte/entry bounds, LRU eviction, release isolation, eight-way request-local deduplication and failed-read cleanup');
    await validateInventory({sources:[pin]});
    report.candidate = await inventoryRoot(bundle,'r12_d1_candidate');
    report.status='pass';
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
    fs.writeFileSync('.artifacts-r12/d1-candidate.json.tmp',JSON.stringify({report:path.join(dir,'report.json')},null,2));
    fs.renameSync('.artifacts-r12/d1-candidate.json.tmp','.artifacts-r12/d1-candidate.json');
  } catch(error) { report.error=error.stack; throw error; }
  finally { fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2)); console.log(`[R12 reliability] ${report.status.toUpperCase()}: ${dir}`); }
}

export async function verifySharedCache() {
    let reads = 0;
    const env = { ASSETS: { async fetch() { reads++; await new Promise(resolve => setTimeout(resolve,1)); return new Response(zlib.gzipSync(JSON.stringify({ text: 'x'.repeat(300000) }))); } } };
    const key = `/v2/relationships/cache-${Date.now()}/`;
    const parallel = await Promise.all(Array.from({length:8},()=>loadJsonShardWithBytes(env,key+'shared')));
    assert.equal(reads,1); assert.equal(parallel.filter(r=>r.bytes>0).length,1);
    await loadJsonShardWithBytes(env,key+'shared'); assert.equal(reads,1);
    for (let i=0;i<70;i++) { await loadJsonShardWithBytes(env,key+i); const stats=shardCacheStats(); assert.ok(stats.entries<=64 && stats.decoded_bytes<=16*1024*1024); }
    assert.ok(shardCacheStats().entries < 64, 'Byte limit must evict before entry limit');
    await loadJsonShardWithBytes(env,key+'shared'); assert.equal(reads,72);
    await loadJsonShardWithBytes(env,key+'different-release/shared'); assert.equal(reads,73);
    let smallReads = 0;
    const small = { ASSETS: { async fetch() { smallReads++; return new Response(zlib.gzipSync('{}')); } } };
    for (let i=0;i<70;i++) await loadJsonShardWithBytes(small,key+'small'+i);
    assert.equal(shardCacheStats().entries,64);
    await loadJsonShardWithBytes(small,key+'small6'); // promote oldest surviving small entry
    await loadJsonShardWithBytes(small,key+'small70');
    await loadJsonShardWithBytes(small,key+'small6'); assert.equal(smallReads,71);
    await loadJsonShardWithBytes(small,key+'small7'); assert.equal(smallReads,72);
    let oversizedReads=0;
    const oversized={ASSETS:{async fetch(){oversizedReads++;return new Response(zlib.gzipSync(JSON.stringify('x'.repeat(16*1024*1024))));}}};
    await loadJsonShardWithBytes(oversized,key+'oversized'); await loadJsonShardWithBytes(oversized,key+'oversized');
    assert.equal(oversizedReads,2); assert.ok(shardCacheStats().decoded_bytes<=16*1024*1024);
    let attempts=0;
    const failing={ASSETS:{async fetch(){attempts++;throw new Error('fixture failure');}}};
    await assert.rejects(loadJsonShardWithBytes(failing,key+'failed')); await assert.rejects(loadJsonShardWithBytes(failing,key+'failed'));
    assert.equal(attempts,2); assert.equal(shardCacheStats().inflight,0);
}

export async function verifyCandidateHydration(bundle) {
  const release = 'r11-v1.0', paths = [];
  const reader = { async readJson(asset) {
    paths.push(asset); const file = path.join(bundle, asset.replace(/^\//,''));
    return fs.existsSync(file) ? { data: readJson(file), bytes: zlib.gunzipSync(fs.readFileSync(file)).length } : null;
  }};
  for (const query of ['Acts 19:16','Psalms 45:0']) {
    const result = await discoverBiblicalConnections(reader,{query,release_id:release});
    const passage = result.parsed_query.explicit_passages[0];
    assert.ok(passage.verse_id > 0 && passage.snippet, query);
    if (query.includes(':0')) assert.ok(passage.is_psalm_heading && passage.verse === 0);
  }
  const evidence = await getConnectionEvidence(reader,'r11:cluster:H7799:temple_and_sanctuary_architecture',release);
  assert.equal(evidence.status,'ok');
  assert.ok(evidence.passage_details.some(p => p.english_text && p.original_tokens.length));
  assert.ok(!paths.some(p => p.includes('/evidence-passages/') || p.includes('/fast-verses/')));
  const withoutManifest = { async readJson(asset) { return asset.endsWith('/fast-manifest.json.gz') ? null : reader.readJson(asset); }};
  const missingManifest = await discoverBiblicalConnections(withoutManifest,{query:'Acts 19:16',release_id:release});
  assert.ok(missingManifest.search_metadata.missing_assets.some(p => p.endsWith('/fast-manifest.json.gz')));
  assert.ok(!paths.some(p => p.includes('/evidence-passages/')));
  const root = path.join(bundle,'v2/relationships',release,'r10/selective/profiles');
  let continued;
  for (const file of walkFiles(root)) { const page = readJson(file); if (page.continuation) { continued = page.continuation; break; } }
  assert.ok(continued, 'Real oversized profile fixture required');
  const budget = { used: 0, max: 1, missing: [] };
  assert.equal(await readSelectiveKey(reader,release,'profiles',continued.key,budget),null);
  assert.ok(budget.missing.length);
  const missingPart = { async readJson(asset) { return asset.endsWith(continued.pages[0]) ? null : reader.readJson(asset); }};
  const missingBudget = { used: 0, max: 1000, missing: [] };
  assert.equal(await readSelectiveKey(missingPart,release,'profiles',continued.key,missingBudget),null);
  assert.ok(missingBudget.missing.some(p => p.endsWith(continued.pages[0])));
  return ['Explicit references including Psalm heading and evidence tokens hydrate without whole-book reads', 'Oversized-profile continuation rejects missing pages and exhausted budgets without returning partial JSON'];
}

export function verifyPreparerGuards(input) {
  assert.throws(() => prepareFastAssets(input,input), /must not already exist/);
  assert.throws(() => prepareFastAssets(input,path.join(input,'forbidden-r12-candidate')), /outside input/);
  assert.ok(!fs.existsSync(path.join(input,'forbidden-r12-candidate')));
}
