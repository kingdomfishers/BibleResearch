#!/usr/bin/env node
/** Local-only R12 suite dispatcher. Unknown/unimplemented suites fail closed. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { freezeSourceInventory, validateInventory, inventoryRoot, fixtureLedger, hashFile } from './r12-evidence.mjs';

// Also preloaded in regression subprocesses before any application imports.
export async function blockNetwork() {
  const reject = () => { throw new Error('R12_OFFLINE: outbound network is forbidden'); };
  globalThis.fetch = reject;
  globalThis.WebSocket = class { constructor() { reject(); } };
  const net = (await import('node:net')).default;
  net.Socket.prototype.connect = reject;
  const dgram = (await import('node:dgram')).default;
  dgram.createSocket = reject;
  for (const name of ['node:http', 'node:https']) {
    const module = (await import(name)).default;
    module.request = reject;
    module.get = reject;
  }
  const dns = (await import('node:dns')).default;
  dns.lookup = reject;
  dns.resolve = reject;
  for (const method of Object.keys(dns.promises)) if (typeof dns.promises[method] === 'function') dns.promises[method] = reject;
  (await import('node:module')).syncBuiltinESMExports();
}

if (process.env.R12_REGRESSION === '1') {
  await blockNetwork();
  // The existing benchmark has one fixed report sink. Redirect only that sink;
  // never overwrite its previous holdout or change its assertions/source inputs.
  const oldDir = path.resolve('.artifacts-r10/benchmarks');
  const reportDir = process.env.R12_REPORT_DIR;
  for (const method of ['mkdirSync', 'writeFileSync']) {
    const original = fs[method];
    fs[method] = (file, ...args) => {
      const resolved = path.resolve(String(file));
      if (resolved === oldDir || resolved === path.join(oldDir, 'holdout.json')) {
        file = path.join(reportDir, path.relative(oldDir, resolved));
      }
      return original(file, ...args);
    };
  }
  (await import('node:module')).syncBuiltinESMExports();
}

async function harnessChecks(reportDir) {
  const sandbox = fs.mkdtempSync(path.join(reportDir, 'harness-'));
  const sample = path.join(sandbox, 'sample.json');
  fs.writeFileSync(sample, '{"value":1}');
  const source = await inventoryRoot(sample, 'test');
  await validateInventory({ sources: [source] });
  fs.writeFileSync(sample, '{"value":2}');
  await assert.rejects(validateInventory({ sources: [source] }), /Source changed/);
  const directory = await inventoryRoot(sandbox, 'test_directory');
  fs.writeFileSync(path.join(sandbox, 'added.json'), '{}');
  await assert.rejects(validateInventory({ sources: [directory] }), /Source membership changed/);
  await assert.rejects(inventoryRoot(path.join(sandbox, 'missing'), 'test'), /ENOENT/);
  const fixtures = { total_cases: 157, fixtures: Array.from({ length: 157 }, (_, i) => ({ id: `case-${i}`, observed_r11_local: null })) };
  assert.equal(fixtureLedger(fixtures).filter(r => r.status === 'not-run').length, 157);
  fixtures.fixtures[1].id = fixtures.fixtures[0].id;
  assert.throws(() => fixtureLedger(fixtures), /duplicate/);
  await assert.rejects(async () => fetch('https://example.invalid'), /R12_OFFLINE/);
  const http = await import('node:http');
  assert.throws(() => http.get('http://example.invalid'), /R12_OFFLINE/);
  const net = await import('node:net');
  assert.throws(() => net.connect(80, 'example.invalid'), /R12_OFFLINE/);
  return { status: 'pass', checks: ['hash validation', 'tampered hash rejected', 'added source rejected', 'missing source rejected', '157 not-run labels retained', 'duplicate fixture rejected', 'fetch blocked', 'HTTP blocked', 'socket blocked'] };
}

async function runRegression(script, reportDir) {
  const name = path.basename(script, '.mjs');
  const log = path.join(reportDir, `${name}.log`);
  const output = fs.openSync(log, 'w');
  console.log(`[R12 regression] ${name}`);
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(import.meta.filename).href, script], {
      cwd: process.cwd(), env: { ...process.env, R12_REGRESSION: '1', R12_REPORT_DIR: path.join(reportDir, 'legacy-benchmark') },
      stdio: ['ignore', output, output], windowsHide: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
    child.on('error', error => { clearTimeout(timer); resolve({ status: 'blocked', reason: error.message }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? 'blocked' : code === 0 ? 'pass' : 'fail', code, signal,
        reason: timedOut ? 'Local runtime exceeded 180s; dependent tasks blocked.' : code === 0 ? 'Existing local assertions passed.' : 'Pre-existing baseline regression; see complete log.' });
    });
  });
  fs.closeSync(output);
  const logged = fs.readFileSync(log, 'utf8');
  if (/R12_OFFLINE|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|ENOENT|SyntaxError:|Real R9B manifest must load/.test(logged)) {
    result.status = 'blocked';
    result.reason = 'Unavailable prerequisite/runtime or attempted network; see log. Dependent tasks blocked.';
  }
  return { script: path.resolve(script), script_sha256: await hashFile(script), log, log_sha256: await hashFile(log), ...result };
}

async function baseline() {
  await blockNetwork();
  const root = process.cwd();
  const reportDir = path.resolve('.artifacts-r12/reports', `baseline-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
  fs.mkdirSync(reportDir, { recursive: true });
  const report = { suite: 'baseline', status: 'blocked', report_dir: reportDir, network: 'blocked in parent and regression children' };
  const reportFile = path.join(reportDir, 'baseline.json');
  try {
    report.harness = await harnessChecks(reportDir);
    const inventory = await freezeSourceInventory(root);
    await validateInventory(inventory);
    assert.equal(inventory.fixture_ledger.length, 157);
    assert.equal(inventory.fixture_ledger.filter(r => r.historical_trace_available).length, 39);
    assert.equal(inventory.coverage.distinct_editions, 3);
    report.regressions = [];
    for (const script of ['scripts/verify-r8d-regressions.mjs', 'scripts/verify-r9c-multihop.mjs', 'scripts/verify-r11-discovery.mjs', 'scripts/verify-r11-benchmark.mjs']) {
      report.regressions.push(await runRegression(script, reportDir));
    }
    // Regression children are read-only except reports; detect source/fixture drift.
    await validateInventory(inventory);
    const blocked = report.regressions.some(r => r.status === 'blocked');
    report.status = blocked ? 'blocked' : 'pass';
    report.fixture_totals = { pass: 0, fail: 0, 'not-run': 157, historical_observations: 39 };
    report.reconciliation = inventory.coverage.reconciliation;
    report.limitations = ['A passing baseline means valid frozen inputs and recorded observations, not 157 semantic passes.',
      'Existing regression failures remain failures. Runtime/prerequisite blockers prevent dependent tasks.',
      'No Worker CPU or production parity measurement in D1.1.'];
    inventory.regressions = report.regressions;
    inventory.baseline_report = reportFile;
    inventory.status = report.status;
    fs.writeFileSync(path.join(reportDir, 'inputs.json'), JSON.stringify(inventory, null, 2));
    if (blocked) throw new Error('Regression runtime unavailable; dependent tasks blocked');
    // Publish the input pointer only after complete validation; retain previous runs.
    const target = path.resolve('.artifacts-r12/inputs.json');
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(reportDir, 'previous-inputs.json'));
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(inventory, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  } catch (error) {
    report.status = 'blocked';
    report.error = error.stack;
    throw error;
  } finally {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`[R12 baseline] ${report.status.toUpperCase()}: ${reportFile}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    assert.ok(process.argv.length === 4 && process.argv[2] === '--suite' && ['baseline','reliability'].includes(process.argv[3]), 'Usage: --suite baseline|reliability');
    if (process.argv[3] === 'reliability') await (await import('./verify-r12-reliability.mjs')).reliability(); else await baseline();
  } catch (error) { console.error(error); process.exitCode = 1; }
}
