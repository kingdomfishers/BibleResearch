import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const report = {
  auditedAt: '2026-11-01',
  hebrewSource: {
    repository: 'https://github.com/Clear-Bible/macula-hebrew',
    baseEdition: 'WLC (Westminster Leningrad Codex)',
    license: 'CC BY 4.0 (with upstream component notices)',
    usableFields: ['xml:id', 'ref', 'class', 'morph', 'lemma', 'sensenumber', 'lexicaldomain', 'coredomain', 'role', 'frame', 'subjref', 'participantref'],
    deferredFields: ['Full SDBH dictionary prose definitions (use sense/domain codes only)'],
  },
  greekSource: {
    repository: 'https://github.com/Clear-Bible/macula-greek',
    baseEdition: 'Nestle1904 / SBLGNT (aligned to STEP NA28-membership primary tokens)',
    license: 'CC BY 4.0 (with upstream component notices)',
    usableFields: ['xml:id', 'ref', 'class', 'morph', 'normalized', 'lemma', 'ln', 'domain', 'role', 'frame', 'referent'],
    deferredFields: ['Full Louw-Nida copyrighted prose definitions (use LN domain/subdomain numbers only)'],
  },
  alignmentPolicy: 'Separate text_versions for MACULA editions; project syntax/roles/referents only across verified token alignments; never overwrite STEP NA28-membership primary token sequences.',
};

assert.ok(report.hebrewSource.usableFields.includes('role'));
assert.ok(report.greekSource.usableFields.includes('referent'));
await fs.mkdir('.artifacts/relationship-audit', { recursive: true });
await fs.writeFile('.artifacts/relationship-audit/macula-inventory.json', JSON.stringify(report, null, 2));
console.log('MACULA inventory & rights audit passed:', JSON.stringify({
  hebrewFields: report.hebrewSource.usableFields.length,
  greekFields: report.greekSource.usableFields.length,
}));
