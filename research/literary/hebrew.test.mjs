import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeHebrewPassage} from '../../src/relationships/literary-hebrew.mjs';
const inputs=JSON.parse(readFileSync(new URL('./hebrew-fixtures.json',import.meta.url),'utf8'));
function checks(results) {
  const g=results[0],p=results[1],a=results[2],c=results[3],j=results[4],d=results[5],s=results[6];
  const tests=[];
  const check=(name,condition)=>tests.push({name,pass:Boolean(condition)});
  check('Genesis: six terminal-formula units',g.boundaries[0]?.units.length===6);
  check('Genesis: unassigned Sabbath tail',g.boundaries[0]?.tail?.fromRef==='Genesis 2:1');
  check('Genesis: evaluation formula count 1,0,2,1,1,2',g.motifs.some(m=>m.kind==='bounded_gap'&&m.keys.join('|')==='script:ראה|script:אלהימ|script:טוב'&&m.counts.join()==='1,0,2,1,1,2'));
  check('Genesis: missing day-two and extra day-three evaluation candidate',g.motifs.some(m=>m.keys.join('|')==='script:ראה|script:אלהימ|script:טוב'&&m.deviations.some(x=>x.unit===1&&x.kind==='count_omission')&&m.deviations.some(x=>x.unit===2&&x.kind==='count_addition')));
  check('Psalm 136: 12 repeated closing units',p.boundaries[0]?.units.length===12&&p.boundaries[0]?.keys.join()==='H3588,H5769,H2617');
  check('Amos 4: five recurring judgment endings',a.boundaries[0]?.units.length===5&&a.boundaries[0]?.keys.includes('H7725'));
  check('Genesis 9:6: three reversed pairs',c.chiasms.some(x=>x.score===3&&x.positions.join()==='1,6'));
  check('Jeremiah: almond/watch orthographic candidate',j.wordplay.some(x=>x.strongs.includes('H8247')&&x.strongs.includes('H8245')));
  check('Genesis 2:7: adam/adamah orthographic candidate',d.wordplay.some(x=>x.strongs.includes('H0120')&&x.strongs.includes('H0127')));
  check('Genesis 9:6: adam/dam orthographic candidate',c.wordplay.some(x=>x.strongs.includes('H0120')&&x.strongs.includes('H1818')));
  check('Psalm 107: thanksgiving refrain repeated four times',s.phrases.some(x=>x.count===4&&x.keys.includes('H3034')&&x.keys.includes('H2617')));
  return tests;
}
const results=inputs.map(analyzeHebrewPassage);
for(const c of checks(results))test(c.name,()=>assert.ok(c.pass));

import {linkedHebrewAnalysis} from '../../src/relationships/literary-hebrew-alignment.mjs';
const syntax=JSON.parse(readFileSync(new URL('./hebrew-macula-fixture.json',import.meta.url),'utf8'));
const aligned=inputs.map((p,i)=>linkedHebrewAnalysis(p,i===0?syntax:[]));
const gen=aligned[0];
test('shared core: six actual Hebrew units',()=>assert.equal(gen.motifTemplate?.unitEventIds.length,6));
test('shared core: second unit omits evaluation',()=>assert.ok(gen.motifTemplate?.deviations.some(d=>d.unit===1&&d.kind==='omission'&&d.expected.includes('script:טוב'))));
test('MACULA adjective-adverb syntax modifier',()=>assert.ok(gen.variants.some(x=>x.kind==='source_syntax_modifier'&&x.ref==='Genesis 1:31'&&x.motif.includes('script:טוב'))));
test('following verb person shift',()=>assert.ok(gen.variants.some(x=>x.kind==='unusual_following_verb_person'&&x.ref==='Genesis 1:26'&&x.person==='1cp')));
test('shared chiasm core',()=>assert.ok(aligned[3].chiasms.some(c=>c.pairs.length===3)));
test('shared core: Psalm 136',()=>assert.equal(aligned[1].motifTemplate?.unitEventIds.length,12));
test('shared core: Amos 4',()=>assert.equal(aligned[2].motifTemplate?.unitEventIds.length,5));
test('MACULA frame coverage',()=>assert.ok(gen.grammarTemplate!==null&&gen.grammarCoverage.completeForUnits));
