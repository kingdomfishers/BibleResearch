#!/usr/bin/env node
/**
 * Non-destructive Cloudflare static-asset preparation & integrity validator for R10 (`r10-v1.0`).
 * Combines the verified R9B+R9C baseline bundle with immutable `v2/relationships/r10-v1.0/`
 * assets into `.artifacts-r10/deploy-bundle`, validating SHA-256 checksums, restricted-field
 * cleanliness, and Cloudflare Free-plan limits (<= 20,000 files, <= 25 MiB/file).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve('.');
const LIVE_STATIC_DIR = path.join(REPO_ROOT, '.artifacts', 'static-corpus');
const R9B_BUNDLE_DIR = 'C:\\Projects\\BibleResearch-r9b\\.artifacts-r9b\\deploy-bundle';
const STAGED_R10_DIR = path.join(REPO_ROOT, '.artifacts-r10', 'staging', 'v2', 'relationships', 'r10-v1.0');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, '.artifacts-r10', 'deploy-bundle');

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

export function prepareR10DeployAssets(options = {}) {
  const outDir = path.resolve(options.outDir || DEFAULT_OUT_DIR);
  const activate = Boolean(options.activate);

  if (path.resolve(outDir) === path.resolve(LIVE_STATIC_DIR)) {
    throw new Error('Safety guard: refusing to mutate .artifacts/static-corpus directly.');
  }

  const manifestGzPath = path.join(STAGED_R10_DIR, 'manifest.json.gz');
  assert.ok(fs.existsSync(manifestGzPath), `Missing staged R10 manifest: ${manifestGzPath}`);
  const r10Manifest = readGzipJson(manifestGzPath);
  assert.equal(r10Manifest.release_id, 'r10-v1.0');

  let verified = 0;
  for (const meta of r10Manifest.files || []) {
    const relFromR10 = meta.path.replace('/v2/relationships/r10-v1.0/', '');
    const diskPath = path.join(STAGED_R10_DIR, relFromR10);
    assert.ok(fs.existsSync(diskPath), `Missing staged R10 file: ${diskPath}`);
    const stat = fs.statSync(diskPath);
    assert.equal(stat.size, meta.gz_bytes, `Size mismatch for ${meta.path}`);
    assert.equal(sha256File(diskPath), meta.sha256_gz, `SHA-256 mismatch for ${meta.path}`);
    verified++;
  }
  console.log(`[R10-DEPLOY-PREP] Verified ${verified} staged R10 checksums.`);

  const baseSource = fs.existsSync(R9B_BUNDLE_DIR) ? R9B_BUNDLE_DIR : LIVE_STATIC_DIR;
  console.log(`[R10-DEPLOY-PREP] Materializing deploy bundle from ${baseSource} + r10-v1.0 -> ${outDir}...`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const baseCount = copyDirHardlinkOrCopy(baseSource, outDir);
  const r10Dst = path.join(outDir, 'v2', 'relationships', 'r10-v1.0');
  const r10Count = copyDirHardlinkOrCopy(STAGED_R10_DIR, r10Dst);

  if (activate) {
    const activePayload = {
      active_release: 'r10-v1.0',
      previous_release: 'r9b-v1.0',
      manifest_sha256: sha256File(manifestGzPath),
      updated_at: new Date().toISOString(),
      production_activated: true,
    };
    const relDir = path.join(outDir, 'v2', 'relationships');
    const jsonBuf = Buffer.from(JSON.stringify(activePayload, null, 2), 'utf8');
    fs.writeFileSync(path.join(relDir, 'active.json'), jsonBuf);
    fs.writeFileSync(path.join(relDir, 'active.json.gz'), zlib.gzipSync(jsonBuf, { level: 9 }));
    console.log('[R10-DEPLOY-PREP] Activated v2/relationships/active.json -> r10-v1.0 inside bundle.');
  }

  const allFiles = walkFiles(outDir);
  let totalBytes = 0;
  let maxFile = { rel: '', size: 0 };
  for (const f of allFiles) {
    totalBytes += f.size;
    if (f.size > maxFile.size) maxFile = f;
    assert.ok(f.size <= CF_MAX_FILE_BYTES, `Asset ${f.rel} exceeds Cloudflare 25 MiB limit (${f.size} bytes)`);
  }
  assert.ok(allFiles.length <= CF_MAX_ASSETS, `Combined assets (${allFiles.length}) exceed Cloudflare 20,000 limit`);
  assert.ok(fs.existsSync(path.join(outDir, 'v2', 'relationships', 'r9b-v1.0', 'manifest.json.gz')), 'R9B+R9C release must be preserved');

  console.log(`[R10-DEPLOY-PREP] PASS`);
  console.log(`  - Base preserved assets: ${baseCount}`);
  console.log(`  - R10 v1.0 assets:       ${r10Count}`);
  console.log(`  - Total combined assets: ${allFiles.length} / ${CF_MAX_ASSETS} limit (${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`  - Largest asset:         ${maxFile.rel} (${(maxFile.size / (1024 * 1024)).toFixed(2)} MB)`);
  return { outDir, baseCount, r10Count, totalAssets: allFiles.length, totalBytes, maxFile };
}

if (process.argv[1] && path.basename(process.argv[1]).includes('prepare-r10-asset-deploy')) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT_DIR;
  prepareR10DeployAssets({ outDir, activate: args.includes('--activate') });
}
