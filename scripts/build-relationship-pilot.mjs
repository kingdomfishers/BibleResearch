// @file: scripts/build-relationship-pilot.mjs
// Reproducible offline runner for the R1+R2 Hebrew/Greek relationship pilot extractor.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export function resolvePythonBinary() {
  const candidates = [];
  if (process.env.PYTHON_BIN) candidates.push(process.env.PYTHON_BIN);
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      candidates.push(
        path.join(
          localAppData,
          'Google',
          'Cloud SDK',
          'google-cloud-sdk',
          'platform',
          'bundledpython',
          'python.exe',
        ),
      );
    }
    candidates.push('python', 'python3');
  } else {
    candidates.push('python3', 'python');
  }

  for (const bin of candidates) {
    try {
      const check = spawnSync(bin, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (check.status === 0 && (check.stdout || check.stderr).includes('Python 3')) {
        return bin;
      }
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    'No working Python 3 executable found. Set PYTHON_BIN to a Python 3 binary.',
  );
}

export function runPilotBuild(outDir = path.join(REPO_ROOT, '.artifacts', 'relationships-v2')) {
  const pythonBin = resolvePythonBinary();
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'extract_relationship_pilot.py');
  const stdout = execFileSync(pythonBin, [scriptPath, outDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  const customOutDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(REPO_ROOT, '.artifacts', 'relationships-v2');
  const result = runPilotBuild(customOutDir);
  console.log(JSON.stringify(result, null, 2));
}
