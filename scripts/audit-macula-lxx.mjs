// Read-only audit of pinned MACULA / morphhb / lxx-swete sources.
// Clone first:  git clone --depth 1 <repo> .artifacts/sources/<name>
// Output: .artifacts/sources/audit-report.json (+ console summary). No database access.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';

const ROOT = resolve('.artifacts/sources');
const REPOS = {
  'macula-hebrew': 'https://github.com/Clear-Bible/macula-hebrew',
  'macula-greek': 'https://github.com/Clear-Bible/macula-greek',
  morphhb: 'https://github.com/openscriptures/morphhb',
  'lxx-swete': 'https://github.com/nathans/lxx-swete',
};

// Field-level license classification. status: enabled | disabled_restricted | disabled_unverified
// Rules: dataset-level CC BY 4.0 is NOT assumed to cover embedded third-party components.
const FIELD_REGISTRY = {
  'macula-hebrew': {
    text_morph: { fields: ['text', 'after', 'lemma', 'pos', 'morph', 'stem', 'person', 'gender', 'number', 'state', 'type', 'lang', 'strongnumberx', 'stronglemma', 'transliteration', 'ref'],
      origin: 'WLC (public domain) + OpenScriptures Hebrew Bible', license: 'CC BY 4.0', status: 'enabled' },
    syntax: { fields: ['class', 'extends'], origin: 'Groves Center Westminster syntax + Clear', license: 'CC BY 4.0', status: 'enabled' },
    gloss: { fields: ['gloss', 'english', 'mandarin'], origin: 'Cherith Analytics glosses (Andi Wu)', license: 'CC BY 4.0', status: 'enabled' },
    clear_annotation: { fields: ['sensenumber', 'subjref', 'participantref'], origin: 'Clear Bible (Biblica) own annotations', license: 'CC BY 4.0 (dataset-level, Clear-listed)', status: 'enabled' },
    frame_unverified: { fields: ['frame'], origin: 'A0/A1 argument frames match SDBH dictionary frame structure; Clear-original vs UBS-derived not stated', license: 'unverified', status: 'disabled_unverified' },
    sdbh_domains: { fields: ['lexdomain', 'contextualdomain', 'coredomain', 'sdbh'], origin: 'UBS Semantic Dictionary of Biblical Hebrew', license: '"Used with permission" (not CC BY)', status: 'disabled_restricted' },
    greek_equivalent: { fields: ['greek', 'greekstrong'], origin: 'Undocumented in repo ("drawn from the Septuagint"); underlying alignment source not stated', license: 'CC BY 4.0 dataset-level only; origin unverified', status: 'disabled_unverified' },
  },
  'macula-greek': {
    text_morph: { fields: ['text', 'after', 'lemma', 'normalized', 'strong', 'morph', 'person', 'number', 'gender', 'case', 'tense', 'voice', 'mood', 'degree', 'ref'],
      origin: 'Nestle1904 (biblicalhumanities) / SBLGNT (Logos, CC BY 4.0)', license: 'per-source; Nestle1904 morphology terms to verify', status: 'disabled_unverified' },
    syntax: { fields: ['role', 'class', 'type'], origin: 'Clear Bible trees', license: 'CC BY 4.0', status: 'enabled' },
    gloss: { fields: ['english', 'mandarin'], origin: 'Cherith Analytics', license: 'CC BY 4.0', status: 'enabled' },
    berean_gloss: { fields: ['gloss'], origin: 'Berean Interlinear Bible (public domain since 2023-04-30)', license: 'Public domain', status: 'enabled' },
    clear_annotation: { fields: ['frame', 'subjref', 'referent'], origin: 'Clear Bible own annotations', license: 'CC BY 4.0', status: 'enabled' },
    marble_domains: { fields: ['domain', 'ln'], origin: 'UBS MARBLE / SDBG (Louw-Nida)', license: '"Used with permission" (not CC BY)', status: 'disabled_restricted' },
  },
  morphhb: { oshb: { fields: ['*'], origin: 'Westminster Leningrad Codex (PD) + OSHB morphology', license: 'CC BY 4.0', status: 'enabled' } },
  'lxx-swete': {
    text: { fields: ['text'], origin: 'Swete via OpenGreekAndLatin First1KGreek tlg0527', license: 'CC BY-SA 4.0 (share-alike; keep in separate attributed tables)', status: 'enabled' },
    code: { fields: ['utils/*'], origin: 'build scripts', license: 'MIT', status: 'not_imported' },
  },
};

const sha256 = f => new Promise((res, rej) => {
  const h = createHash('sha256');
  createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
});
const git = (repo, ...args) => execFileSync('git', ['-C', join(ROOT, repo), ...args], { encoding: 'utf8' }).trim();

async function tsvCoverage(file) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let header = null, rows = 0;
  const nonEmpty = {}, distinct = {};
  const track = new Set(['greek', 'greekstrong', 'sensenumber', 'frame', 'subjref', 'participantref', 'referent', 'ln', 'domain', 'lexdomain', 'sdbh', 'class', 'role', 'type', 'lang']);
  for await (const line of rl) {
    if (!header) { header = line.split('\t'); header.forEach(h => { nonEmpty[h] = 0; if (track.has(h)) distinct[h] = new Set(); }); continue; }
    const p = line.split('\t'); rows++;
    header.forEach((h, i) => { const v = (p[i] ?? '').trim(); if (v) { nonEmpty[h]++; if (distinct[h] && distinct[h].size < 5000) distinct[h].add(v); } });
  }
  return { rows, header, nonEmpty, distinctValues: Object.fromEntries(Object.entries(distinct).map(([k, s]) => [k, s.size])), sampleValues: Object.fromEntries(['class', 'role', 'type', 'lang'].filter(k => distinct[k]).map(k => [k, [...distinct[k]].slice(0, 25)])) };
}

function lxxCoverage() {
  const dir = join(ROOT, 'lxx-swete/data');
  const books = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.txt')).sort()) {
    const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean);
    const verses = new Set(), chapters = new Set(), lettered = new Set(); let malformed = 0, maxC = 0;
    for (const l of lines) {
      // Swete format: <book>.<chapter>.<verse[letter]> <word>; letters mark Swete-only subdivided verses
      const m = /^(\d+)\.(\d+)\.(\d+)([a-z]*) (.+)$/.exec(l);
      if (!m) { malformed++; continue; }
      chapters.add(+m[2]); verses.add(`${m[2]}.${m[3]}${m[4]}`); maxC = Math.max(maxC, +m[2]);
      if (m[4]) lettered.add(`${m[2]}.${m[3]}${m[4]}`);
    }
    books.push({ file: f, lines: lines.length, chapters: chapters.size, maxChapter: maxC, verses: verses.size, letteredVerses: lettered.size, malformed });
  }
  return books;
}

const report = { generated_at: new Date().toISOString(), repos: {}, field_registry: FIELD_REGISTRY, coverage: {}, errors: [] };
for (const [name, url] of Object.entries(REPOS)) {
  if (!existsSync(join(ROOT, name))) { report.errors.push(`missing clone: ${name}`); continue; }
  report.repos[name] = { url, commit: git(name, 'rev-parse', 'HEAD'), commit_date: git(name, 'log', '-1', '--format=%cI') };
}
const files = {
  'macula-hebrew': ['WLC/tsv/macula-hebrew.tsv', 'LICENSE.md'],
  'macula-greek': ['Nestle1904/tsv/macula-greek-Nestle1904.tsv', 'SBLGNT/tsv/macula-greek-SBLGNT.tsv', 'LICENSE.md', 'sources/Clear/wordsense/greek-wordsenses.tsv', 'sources/Clear/annotations/annotations.xml'],
  morphhb: ['LICENSE.md'],
  'lxx-swete': ['COPYING-Code', 'README.md'],
};
for (const [repo, list] of Object.entries(files)) {
  if (!report.repos[repo]) continue;
  report.repos[repo].files = {};
  for (const rel of list) {
    const p = join(ROOT, repo, rel);
    if (!existsSync(p)) { report.errors.push(`missing file ${repo}/${rel}`); continue; }
    report.repos[repo].files[rel] = { bytes: statSync(p).size, sha256: await sha256(p) };
  }
}
if (report.repos['macula-hebrew']) report.coverage.macula_hebrew = await tsvCoverage(join(ROOT, 'macula-hebrew/WLC/tsv/macula-hebrew.tsv'));
if (report.repos['macula-greek']) {
  report.coverage.macula_greek_nestle1904 = await tsvCoverage(join(ROOT, 'macula-greek/Nestle1904/tsv/macula-greek-Nestle1904.tsv'));
  report.coverage.macula_greek_sblgnt = await tsvCoverage(join(ROOT, 'macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv'));
}
if (report.repos['lxx-swete']) {
  const books = lxxCoverage();
  report.coverage.lxx_swete = { books: books.length, totalLines: books.reduce((a, b) => a + b.lines, 0), malformed: books.reduce((a, b) => a + b.malformed, 0), perBook: books };
}
writeFileSync(join(ROOT, 'audit-report.json'), JSON.stringify(report, null, 2));
console.log('Pins:'); for (const [n, r] of Object.entries(report.repos)) console.log(`  ${n}: ${r.commit} (${r.commit_date})`);
for (const [k, c] of Object.entries(report.coverage)) {
  if (c.rows) { console.log(`\n${k}: ${c.rows} rows`); for (const h of c.header) console.log(`  ${h.padEnd(18)} ${String(c.nonEmpty[h]).padStart(8)} ${(100 * c.nonEmpty[h] / c.rows).toFixed(1)}%`); console.log('  distinct:', JSON.stringify(c.distinctValues)); }
  else console.log(`\n${k}: ${c.books} books, ${c.totalLines} lines, ${c.malformed} malformed`);
}
if (report.errors.length) { console.error('ERRORS:', report.errors); process.exitCode = 1; }
