// Source-reference parser, not a textual alignment or historical date inference.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BOOKS } from './stepbible-parser.mjs';

const policy = JSON.parse(await fs.readFile('data/chronology/reference-mappings.json', 'utf8'));
const source = JSON.parse(await fs.readFile('.artifacts/chronology-audit/verses.json', 'utf8'));
const target = JSON.parse(await fs.readFile('.artifacts/stepbible/verses.json', 'utf8'));
const stepManifest = JSON.parse(await fs.readFile('.artifacts/stepbible/manifest.json', 'utf8'));
assert.equal(stepManifest.commit, policy.stepCommit);
const key = (b, c, v) => `${b}-${c}-${v}`;
const sourceKey = row => key(+row.fields.verseID.slice(0, 2), +row.fields.verseID.slice(2, 5), +row.fields.verseID.slice(5));
const sources = new Map(source.map(row => [sourceKey(row), row.id]));
const nt = new Map();
for (const name of ['TAGNT Mat-Jhn', 'TAGNT Act-Rev']) {
  const text = await fs.readFile(`.artifacts/stepbible/${name}.txt`, 'utf8');
  const pinned = stepManifest.sources.find(source => source.name === name);
  assert.equal(createHash('sha256').update(text).digest('hex'), pinned.sha256, `${name}: STEP source integrity`);
  assert.match(text, /Versification as used by NRSV/);
  for (const line of text.split(/\r?\n/)) {
    const columns = line.split('\t');
    const ref = columns[0].match(/^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+)([^#]*)#.+=/);
    if (!ref || !columns[5]?.split(/[+\s;,]+/).includes('NA28')) continue;
    const book = BOOKS.indexOf(ref[1]) + 1;
    const targetKey = key(book, +ref[2], +ref[3]);
    const kjv = ref[4].match(/\[(\d+)\.(\d+)\]/);
    const sourceAddress = key(book, +(kjv?.[1] ?? ref[2]), +(kjv?.[2] ?? ref[3]));
    const group = nt.get(targetKey) ?? new Set();
    group.add(sourceAddress);
    nt.set(targetKey, group);
  }
}
const countChapters = (rows, getKey) => {
  const counts = new Map();
  for (const row of rows) {
    const [b, c, v] = getKey(row).split('-').map(Number);
    if (v > 0) counts.set(`${b}-${c}`, (counts.get(`${b}-${c}`) ?? 0) + 1);
  }
  return counts;
};
const sc = countChapters(source, sourceKey);
const tc = countChapters(target, row => key(row.book, row.chapter, row.verse_nr));
const mappings = target.map(row => {
  const address = key(row.book, row.chapter, row.verse_nr);
  let sourceAddresses = row.book >= 40 ? [...(nt.get(address) ?? [])] : [address];
  let method = row.book >= 40 ? 'STEP token KJV reference annotations' : 'standard English reference; chapter boundary counts agree';
  if (row.verse_nr === 0) { sourceAddresses = []; method = 'heading without KJV numbered counterpart'; }
  if (row.book < 40 && sc.get(`${row.book}-${row.chapter}`) !== tc.get(`${row.book}-${row.chapter}`)) {
    sourceAddresses = []; method = 'unverified chapter boundary difference';
  }
  const missing = sourceAddresses.filter(ref => !sources.has(ref));
  return { book: row.book, chapter: row.chapter, verse: row.verse_nr,
    sourceIds: sourceAddresses.filter(ref => sources.has(ref)).map(ref => sources.get(ref)),
    sourceAddresses, method, status: !sourceAddresses.length || missing.length ? 'unresolved' : 'reference_mapped',
    correspondence: sourceAddresses.length > 1 ? 'partial_multiple' : 'reference_only' };
});
assert.equal(mappings.length, 31203);
assert.equal(new Set(mappings.map(row => key(row.book, row.chapter, row.verse))).size, mappings.length);
for (const fixture of policy.dateFixtures) assert.equal(fixture.year <= 0 ? `${1 - fixture.year} BC` : `AD ${fixture.year}`, fixture.label);
for (const fixture of policy.anchorFixtures) assert.equal(fixture.resurrectionYear - fixture.offsetYears, fixture.adamYear);
assert.equal(mappings.find(row => key(row.book, row.chapter, row.verse) === '64-1-15').sourceAddresses[0], '64-1-14');
assert.equal(mappings.find(row => key(row.book, row.chapter, row.verse) === '47-13-13').sourceAddresses[0], '47-13-14');
assert.equal(mappings.filter(row => row.verse === 0 && row.status !== 'unresolved').length, 0);
const report = { policyVersion: policy.version, target: mappings.length,
  mapped: mappings.filter(row => row.status === 'reference_mapped').length,
  unresolved: mappings.filter(row => row.status === 'unresolved').length,
  partial: mappings.filter(row => row.correspondence === 'partial_multiple').length,
  caveat: 'Reference-level projection of source estimates; does not assert exact textual correspondence.' };
await fs.writeFile('.artifacts/chronology-audit/mappings.json', JSON.stringify(mappings));
await fs.writeFile('.artifacts/chronology-audit/reference-report.json', JSON.stringify(report, null, 2));
console.log(report);
