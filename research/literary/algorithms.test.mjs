import test from 'node:test';
import assert from 'node:assert/strict';
import {alignSequences,induceTemplate,repeatedPhrases,discoverTemplates,discoverChiasms} from '../../src/relationships/literary-structure.mjs';

function fixture() {
  const rows=[['speech','fulfillment','evaluation','close'],['speech','fulfillment','close'],['speech','fulfillment','evaluation','evaluation','close'],['speech','fulfillment','evaluation','close'],['speech','fulfillment','evaluation','close'],['speech','fulfillment','evaluation+','close']];
  let id=0;return rows.map(row=>row.map(raw=>{const key=raw.replace('+','');return {id:`e${++id}`,key,wordIds:[`w${id}`],features:raw.endsWith('+')?['modifier:intensity']:[]};}));
}

function runCases(assert) {
  const units=fixture(),all=units.flat();
  assert('global alignment insertion',alignSequences(units[0],units[2]).pairs.some(p=>p.a===null));
  assert('local alignment',alignSequences([units[0][0],units[0][1]],[units[1][1]],true).score===2);
  const t=induceTemplate(units);
  assert('missing evaluation',t.deviations.some(d=>d.kind==='omission'&&d.unit===1&&d.expected==='evaluation'&&d.beforeId&&d.afterId));
  assert('double evaluation',t.deviations.some(d=>d.kind==='addition'&&d.unit===2&&d.observed==='evaluation'));
  assert('intensification',t.deviations.some(d=>d.kind==='feature_addition'&&d.unit===5&&d.observed==='modifier:intensity'));
  assert('repeat phrase',repeatedPhrases(all).some(p=>p.keys.join(',').includes('speech,fulfillment')));
  const candidates=discoverTemplates(all);
  assert('automatic template',candidates.some(x=>x.unitEventIds.length===6&&x.deviations.some(d=>d.kind==='omission'&&d.unit===1)));
  const events=keys=>keys.map((key,i)=>({id:`c${i}`,key,features:[],wordIds:[`w${i}`]}));
  assert('chiasm',discoverChiasms(events(['A','B','C','B','A'])).some(c=>c.pairs.length===2&&c.centerIds[0]==='c2'));
  assert('forward not chiasm',discoverChiasms(events(['A','B','C','A','B','C'])).length===0);
  assert('generic refrain not chiasm',discoverChiasms(events(['A','A','A','A','A'])).length===0);
  assert('nonrepeat no template',discoverTemplates(events(['a','b','c','d','e','f'])).length===0);
  let threw=false;try{repeatedPhrases([all[0],all[0]]);}catch{threw=true;}assert('duplicate evidence rejected',threw);
  return {template:t,auto:candidates.map(x=>({anchors:x.anchorKeys,side:x.anchorSide,score:x.score,units:x.unitEventIds.length,deviations:x.deviations.length}))};
}

test('literary algorithm core: deterministic fixture and negative controls',()=>runCases((name,condition)=>assert.ok(condition,name)));
