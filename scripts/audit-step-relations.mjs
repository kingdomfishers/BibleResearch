import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const dir = '.artifacts/stepbible';
const manifest = JSON.parse((await fs.readFile(`${dir}/manifest.json`, 'utf8')).replace(/^\uFEFF/, ''));
const words = JSON.parse((await fs.readFile(`${dir}/words.json`, 'utf8')).replace(/^\uFEFF/, ''));

const strongsSet = new Set(words.map(w => w.strongs_nr).filter(Boolean));
const hebrewCount = [...strongsSet].filter(s => s.startsWith('H')).length;
const greekCount = [...strongsSet].filter(s => s.startsWith('G')).length;
const withCooccurrences = words.filter(w => Array.isArray(w.co_occurrences) && w.co_occurrences.length > 0).length;

const report = {
  sourceCommit: manifest.commit || 'be4191f0082aeedddb0eff0c02c966292b2bd641',
  totalWordForms: words.length,
  distinctBaseStrongs: strongsSet.size,
  hebrewStrongs: hebrewCount,
  greekStrongs: greekCount,
  formsWithCachedCooccurrences: withCooccurrences,
  restrictedColumnsExcluded: ['TBESH.Meaning (Online Bible restricted column)'],
  unavailableSourcesNotRequired: ['TBCWG (forthcoming AI concept groups)'],
  mappingNamespaces: ['base_strongs', 'extended_strongs', 'disambiguated_dstrongs', 'unified_ustrongs'],
};

assert.equal(words.length, 150105);
assert.equal(strongsSet.size, 13913);
await fs.mkdir('.artifacts/relationship-audit', { recursive: true });
await fs.writeFile('.artifacts/relationship-audit/step-relations.json', JSON.stringify(report, null, 2));
console.log('STEP related-word audit passed:', JSON.stringify(report));
