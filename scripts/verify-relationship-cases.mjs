import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const raw = await fs.readFile('scripts/fixtures/relationship-cases.json', 'utf8');
const fixtures = JSON.parse(raw);

assert.equal(fixtures.version, '1.0.0');
assert.equal(fixtures.benchmarks.length, 2);

const well = fixtures.benchmarks.find(b => b.id === 'motif-well-marriage');
assert.ok(well, 'Missing well-marriage benchmark');
assert.equal(well.requiredEpisodes.length, 3, 'Well-marriage must require Genesis 24, Genesis 29, and Exodus 2:15-21');
assert.equal(well.requiredControls.length, 2, 'Well-marriage must include Genesis 21 and Genesis 26 non-marriage controls');
assert.equal(well.expectedCategory, 'interpretive');

const menorah = fixtures.benchmarks.find(b => b.id === 'motif-lampstand-seven-spirits');
assert.ok(menorah, 'Missing lampstand-seven-spirits benchmark');
assert.equal(menorah.requiredPassages.length, 4, 'Lampstand-spirits must cite Exodus 25, Zechariah 4, Revelation 4:5, and Revelation 5:6');
assert.ok(menorah.requiredControls.some(c => c.ref === 'Revelation 1:20'), 'Must include Revelation 1:20 seven churches distinction');
assert.equal(menorah.lexicalDistinctions.length, 1);

assert.equal(fixtures.controls.length, 2);
console.log('Relationship acceptance fixtures verified: well/marriage (3 episodes + 2 controls), menorah/seven spirits (4 passages + Rev 1:20 control + lamp/lampstand distinction), and homograph controls.');
