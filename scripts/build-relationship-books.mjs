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
  const booksArg = process.argv[2] || 'RUT,PHP';
  const forceRebuild = process.argv.includes('--force-rebuild');
  const result = runBooksBuild({ books: booksArg, forceRebuild });
  console.log(JSON.stringify(result, null, 2));
}
