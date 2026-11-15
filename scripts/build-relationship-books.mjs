// @file: scripts/build-relationship-books.mjs
// Reproducible offline runner for book-partitioned Hebrew/Greek relationship extraction.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePythonBinary } from './build-relationship-pilot.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export function runBooksBuild(options = {}) {
  const pythonBin = resolvePythonBinary();
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'extract_relationship_pilot.py');
  const outDir = options.outDir || path.join(REPO_ROOT, '.artifacts', 'relationships-scaled');

  const args = [scriptPath, outDir];
  if (options.books) {
    args.push('--book', Array.isArray(options.books) ? options.books.join(',') : options.books);
  }
  if (options.testament) {
    args.push('--testament', options.testament);
  }
  if (options.edition) {
    args.push('--edition', options.edition);
  }
  if (options.all) {
    args.push('--all');
  }
  if (options.forceRebuild) {
    args.push('--force-rebuild');
  }
  if (options.noAggregate) {
    args.push('--no-aggregate');
  }
  if (options.aggregateAll) {
    args.push('--aggregate-all');
  }

  const stdout = execFileSync(pythonBin, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024,
  });

  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`Extraction failed to return JSON output:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(jsonStart).trim());
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  const rawArgs = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--testament' && rawArgs[i + 1]) {
      options.testament = rawArgs[++i];
    } else if (a === '--book' && rawArgs[i + 1]) {
      options.books = rawArgs[++i];
    } else if (a === '--edition' && rawArgs[i + 1]) {
      options.edition = rawArgs[++i];
    } else if (a === '--out-dir' && rawArgs[i + 1]) {
      options.outDir = rawArgs[++i];
    } else if (a === '--all') {
      options.all = true;
    } else if (a === '--force-rebuild') {
      options.forceRebuild = true;
    } else if (a === '--no-aggregate') {
      options.noAggregate = true;
    } else if (a === '--aggregate-all') {
      options.aggregateAll = true;
    } else if (!a.startsWith('-')) {
      options.books = a;
    }
  }
  if (!options.books && !options.testament && !options.all && !options.aggregateAll) {
    options.books = 'RUT,PHP';
  }
  const result = runBooksBuild(options);
  console.log(JSON.stringify(result, null, 2));
}
