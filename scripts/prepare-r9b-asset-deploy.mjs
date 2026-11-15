/**
 * @file: scripts/prepare-r9b-asset-deploy.mjs
 * @feature: relationships-r9b
 * @description: Deterministic, non-destructive Cloudflare static-asset preparation
 * & integrity validator for deploying `r9b-v1.0` alongside existing live `r8-v1.1`.
 *
 * Guarantees:
 *   1. Verifies every staged `r9b-v1.0` SHA-256 checksum in `manifest.json.gz`.
 *   2. Verifies existing `.artifacts/static-corpus` (`r8-v1.1`) & `active.json.gz`.
 *   3. Materializes or syncs ONLY the immutable `v2/relationships/r9b-v1.0/` subtree
 *      into a target deploy asset root while preserving EVERY existing corpus file
 *      and keeping `active.json.gz` pointing at `r8-v1.1` unless `--activate` is passed.
 *   4. Validates Cloudflare static-asset limits (<= 20,000 files, <= 25 MiB/file)
 *      and verifies R8D `r8-v1.1` remains intact and readable before exit.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve('.');
const LIVE_STATIC_DIR = path.join(REPO_ROOT, '.artifacts', 'static-corpus');
const STAGE_ROOT = path.join(REPO_ROOT, '.artifacts-r9b', 'staging');
const STAGED_REL_DIR = path.join(STAGE_ROOT, 'v2', 'relationships', 'r9b-v1.0');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, '.artifacts-r9b', 'deploy-bundle');

const CF_MAX_ASSETS = 20_000;
const CF_MAX_FILE_BYTES = 25 * 1024 * 1024;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readGzipJson(filePath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, base));
    } else {
      out.push({
        full,
        rel: path.relative(base, full).replace(/\\/g, '/'),
        size: fs.statSync(full).size,
      });
    }
  }
  return out;
}

function verifyStagedChecksums() {
  const stagedActivePath = path.join(STAGE_ROOT, 'v2', 'relationships', 'active.json.gz');
  const stagedManifestGzPath = path.join(STAGED_REL_DIR, 'manifest.json.gz');
  assert.ok(fs.existsSync(stagedActivePath), `Missing staged pointer: ${stagedActivePath}`);
  assert.ok(fs.existsSync(stagedManifestGzPath), `Missing staged manifest: ${stagedManifestGzPath}`);

  const stagedActive = readGzipJson(stagedActivePath);
  assert.equal(stagedActive.active_release, 'r9b-v1.0');
  assert.equal(stagedActive.production_activated, false, 'Staged active pointer must not mark production_activated=true');
  assert.equal(sha256File(stagedManifestGzPath), stagedActive.manifest_sha256, 'Staged manifest SHA-256 mismatch');

  const manifest = readGzipJson(stagedManifestGzPath);
  const entries = Object.entries(manifest.artifact_checksums || {});
  assert.ok(entries.length >= 1900, `Expected >=1900 checksummed artifacts, got ${entries.length}`);

  let verified = 0;
  for (const [relKey, meta] of entries) {
    if (relKey === 'upstream/r8-v1.1/manifest.json.gz') {
      const r8ManifestPath = path.join(LIVE_STATIC_DIR, 'v2', 'relationships', 'r8-v1.1', 'manifest.json.gz');
      assert.ok(fs.existsSync(r8ManifestPath), 'Missing upstream R8D manifest.json.gz');
      assert.equal(sha256File(r8ManifestPath), meta.sha256, 'Upstream R8D manifest SHA-256 changed unexpectedly');
      verified++;
      continue;
    }
    const diskPath = path.join(STAGED_REL_DIR, relKey);
    assert.ok(fs.existsSync(diskPath), `Missing staged asset: ${diskPath}`);
    const stat = fs.statSync(diskPath);
    assert.equal(stat.size, meta.bytes, `Byte size mismatch on staged ${relKey}`);
    assert.equal(sha256File(diskPath), meta.sha256, `SHA-256 mismatch on staged ${relKey}`);
    verified++;
  }
  return { manifest, verified };
}

function verifyLiveBaseCorpus(rootDir, expectedActive = 'r8-v1.1') {
  const activePath = path.join(rootDir, 'v2', 'relationships', 'active.json.gz');
  const r8ManifestPath = path.join(rootDir, 'v2', 'relationships', 'r8-v1.1', 'manifest.json.gz');
  const v1ManifestPath = path.join(rootDir, 'manifest.json');
  assert.ok(fs.existsSync(activePath), `Missing active.json.gz in ${rootDir}`);
  assert.ok(fs.existsSync(r8ManifestPath), `Missing R8D manifest.json.gz in ${rootDir}`);
  assert.ok(fs.existsSync(v1ManifestPath), `Missing v1 /manifest.json in ${rootDir}`);

  const active = readGzipJson(activePath);
  assert.equal(active.active_release, expectedActive, `Refusing deploy: active.json.gz points to ${active.active_release} instead of ${expectedActive}`);
  const r8Manifest = readGzipJson(r8ManifestPath);
  assert.equal(r8Manifest.release_version, 'r8-v1.1');
  assert.equal(r8Manifest.sharding?.by_lemma_buckets, 256);

  // Spot-check critical R8D shards so we refuse deployment if R8D would break
  for (const rel of [
    'v2/relationships/r8-v1.1/resolver-index.json.gz',
    'v2/relationships/r8-v1.1/by-lemma/shard-00.json.gz',
    'v2/relationships/r8-v1.1/by-lemma/shard-ff.json.gz',
    'v2/relationships/r8-v1.1/passages/b1-c1.json.gz',
    'v2/relationships/r8-v1.1/passages/b66-c22.json.gz',
  ]) {
    assert.ok(fs.existsSync(path.join(rootDir, rel)), `Refusing deploy: critical R8D asset missing (${rel})`);
  }
}

function copyDirHardlinkOrCopy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      count += copyDirHardlinkOrCopy(s, d);
    } else {
      if (fs.existsSync(d)) fs.unlinkSync(d);
      try {
        fs.linkSync(s, d);
      } catch {
        fs.copyFileSync(s, d);
      }
      count++;
    }
  }
  return count;
}

export function prepareR9bDeployAssets(options = {}) {
  const outDir = path.resolve(options.outDir || DEFAULT_OUT_DIR);
  const activate = Boolean(options.activate);

  if (path.resolve(outDir) === path.resolve(LIVE_STATIC_DIR) && !options.allowLiveOverwrite) {
    throw new Error('Safety guard: refusing to mutate .artifacts/static-corpus directly without --allow-live-overwrite (use a separate --out bundle first).');
  }

  console.log('[R9B-DEPLOY-PREP] 1. Verifying live base corpus & R8D integrity...');
  verifyLiveBaseCorpus(LIVE_STATIC_DIR, 'r8-v1.1');

  console.log('[R9B-DEPLOY-PREP] 2. Verifying all staged R9B asset SHA-256 checksums...');
  const { manifest: r9bManifest, verified } = verifyStagedChecksums();
  console.log(`  Verified ${verified} staged checksums cleanly.`);

  console.log(`[R9B-DEPLOY-PREP] 3. Materializing combined asset tree at ${outDir}...`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const baseCount = copyDirHardlinkOrCopy(LIVE_STATIC_DIR, outDir);

  // Copy ONLY the immutable R9B subtree; do NOT copy staged active.json.gz unless explicitly activating
  const r9bDstDir = path.join(outDir, 'v2', 'relationships', 'r9b-v1.0');
  const r9bCount = copyDirHardlinkOrCopy(STAGED_REL_DIR, r9bDstDir);

  if (activate) {
    throw new Error('Safety guard: automatic production activation via prepare-r9b-asset-deploy is disabled in R9B-P1; upload immutable assets first.');
  }

  console.log('[R9B-DEPLOY-PREP] 4. Validating combined asset inventory & Cloudflare plan limits...');
  verifyLiveBaseCorpus(outDir, 'r8-v1.1');

  // Verify staged active.json.gz did NOT leak into outDir
  const deployedActive = readGzipJson(path.join(outDir, 'v2', 'relationships', 'active.json.gz'));
  assert.equal(deployedActive.active_release, 'r8-v1.1', 'Live active pointer must remain r8-v1.1 during asset upload!');

  const allFiles = walkFiles(outDir);
  let totalBytes = 0;
  let maxFile = { rel: '', size: 0 };
  for (const f of allFiles) {
    totalBytes += f.size;
    if (f.size > maxFile.size) maxFile = f;
    assert.ok(f.size <= CF_MAX_FILE_BYTES, `Asset ${f.rel} exceeds Cloudflare 25 MiB limit (${f.size} bytes)`);
  }
  assert.ok(allFiles.length <= CF_MAX_ASSETS, `Combined assets (${allFiles.length}) exceed Cloudflare 20,000 limit`);
  assert.equal(allFiles.length, baseCount + r9bCount);

  console.log(`[R9B-DEPLOY-PREP] PASS: Combined bundle validated cleanly.`);
  console.log(`  - Preserved live R8/v1 assets: ${baseCount} files (active_release: ${deployedActive.active_release})`);
  console.log(`  - Immutable R9B v1.0 assets: ${r9bCount} files (manifest: ${r9bManifest.release_version})`);
  console.log(`  - Total combined assets:     ${allFiles.length} / ${CF_MAX_ASSETS} limit (${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`  - Largest single asset:      ${maxFile.rel} (${(maxFile.size / (1024 * 1024)).toFixed(2)} MB / 25 MB limit)`);
  return { outDir, baseCount, r9bCount, totalAssets: allFiles.length, totalBytes, maxFile, activeRelease: deployedActive.active_release };
}

if (process.argv[1] && path.basename(process.argv[1]).includes('prepare-r9b-asset-deploy')) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT_DIR;
  prepareR9bDeployAssets({
    outDir,
    activate: args.includes('--activate'),
    allowLiveOverwrite: args.includes('--allow-live-overwrite'),
  });
}
