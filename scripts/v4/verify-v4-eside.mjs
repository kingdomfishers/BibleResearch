#!/usr/bin/env node
/**
 * Gate V4-1b: Verification Suite for ESIDE C1-C8 Compiler & Order-Flexible Splice DP
 *
 * Verifies:
 *   - >= 95% recall on 29 canonical gold witnesses across C1-C8
 *   - Direct unit checks on alignTriTextualQuoteV4 (Rom 9:33 dual frame-splice, Heb 10:37-38 inverted splice, specificity gate)
 *   - 0 false Judg 15:19 "the day" (H3117)
 *   - 0 Rev 1:20 / 4:5 / 5:6 symbol-referent conflation
 *   - 0 restricted UBS keys across all packed payloads & interp-edges.bin
 *   - Pack sizes < 4.8 MiB and interp-edges.bin < 400 KiB
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  NUM_VERSES,
  lookupPackedInt,
  lookupPackedKey,
  parsePackedIntIndex,
  parsePackedKeyIndex,
} from '../../src/relationships/v3-binary-index.ts';
import { alignTriTextualQuoteV4 } from '../../src/relationships/v3-verifiers.ts';
import { isLxxFunctionEquivalent } from '../../src/relationships/epistemic-taxonomy.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_R12 = path.join(ROOT, '.artifacts-r12');
const BUILD_ESIDE = path.join(ARTIFACTS_R12, 'v4-build/v4/eside');
const STAGING_ESIDE = path.join(ARTIFACTS_R12, 'staging-bundle/v4/eside');

const RESTRICTED_KEYS = new Set([
  'gated_fields',
  'semantic_frame',
  'frame',
  'greekstrong',
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
  'field_name',
]);

function checkNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) checkNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (RESTRICTED_KEYS.has(k)) {
        throw new Error(`Restricted UBS key "${k}" at ${p}.${k}`);
      }
      if (v && typeof v === 'object') checkNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

function loadCatalogRefLookup() {
  const metaPath = path.join(ARTIFACTS_R12, 'staging-bundle/v1/catalog/metadata.json.gz');
  const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(metaPath)).toString('utf8'));
  const byId = new Map(meta.books.map((b) => [b.id, b]));
  const refToVid = new Map();
  for (const [vid, b, c, v] of meta.verses_compact) {
    const bk = byId.get(b);
    refToVid.set(`${bk.usfm} ${c}:${v}`, vid);
  }
  return refToVid;
}

function openEsideStore(dir) {
  const vidIdx = parsePackedIntIndex(fs.readFileSync(path.join(dir, 'eside-vid.idx')));
  const bsIdx = parsePackedKeyIndex(fs.readFileSync(path.join(dir, 'eside-bs.idx')));
  const packs = new Map();
  const readPack = (fileIdx) => {
    let buf = packs.get(fileIdx);
    if (!buf) {
      const p = path.join(dir, `pack-${String(fileIdx).padStart(2, '0')}.bin`);
      buf = fs.readFileSync(p);
      packs.set(fileIdx, buf);
    }
    return buf;
  };
  const getVid = (vid) => {
    const loc = lookupPackedInt(vidIdx, vid);
    if (!loc) return null;
    const pBuf = readPack(loc.fileIdx);
    return JSON.parse(zlib.gunzipSync(pBuf.subarray(loc.start, loc.start + loc.length)).toString('utf8'));
  };
  const getBs = (bs) => {
    const loc = lookupPackedKey(bsIdx, bs);
    if (!loc) return null;
    const pBuf = readPack(loc.fileIdx);
    return JSON.parse(zlib.gunzipSync(pBuf.subarray(loc.start, loc.start + loc.length)).toString('utf8'));
  };
  return { vidIdx, bsIdx, getVid, getBs };
}

function main() {
  // 1. Check both output directories & size caps
  for (const dir of [BUILD_ESIDE, STAGING_ESIDE]) {
    assert.ok(fs.existsSync(path.join(dir, 'eside-vid.idx')), `Missing eside-vid.idx in ${dir}`);
    assert.ok(fs.existsSync(path.join(dir, 'eside-bs.idx')), `Missing eside-bs.idx in ${dir}`);
    assert.ok(fs.existsSync(path.join(dir, 'pack-00.bin')), `Missing pack-00.bin in ${dir}`);
    assert.ok(fs.existsSync(path.join(dir, 'interp-edges.bin')), `Missing interp-edges.bin in ${dir}`);
    for (const f of fs.readdirSync(dir)) {
      const sz = fs.statSync(path.join(dir, f)).size;
      if (/^pack-\d+\.bin$/.test(f)) {
        assert.ok(sz < 4_800_000, `${dir}/${f} size ${sz} exceeds 4.8 MiB`);
      }
    }
    const edgeSz = fs.statSync(path.join(dir, 'interp-edges.bin')).size;
    assert.ok(edgeSz < 400 * 1024, `${dir}/interp-edges.bin size ${edgeSz} exceeds 400 KiB`);
  }

  // Parity check between build and staging
  for (const f of fs.readdirSync(STAGING_ESIDE)) {
    const b1 = fs.readFileSync(path.join(BUILD_ESIDE, f));
    const b2 = fs.readFileSync(path.join(STAGING_ESIDE, f));
    assert.equal(Buffer.compare(b1, b2), 0, `Build vs Staging mismatch for ${f}`);
  }

  // 2. Scan ALL packed records & interp-edges.bin for 0 restricted UBS keys
  const store = openEsideStore(STAGING_ESIDE);
  let totalVidPayloads = 0;
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    const rec = store.getVid(vid);
    if (rec) {
      totalVidPayloads++;
      checkNoRestrictedKeys(rec, `vid:${vid}`);
    }
  }
  const rawEdgesFile = fs.readFileSync(path.join(STAGING_ESIDE, 'interp-edges.bin'));
  const edgesJson = JSON.parse(
    (rawEdgesFile[0] === 0x1f && rawEdgesFile[1] === 0x8b
      ? zlib.gunzipSync(rawEdgesFile)
      : rawEdgesFile).toString('utf8'),
  );
  checkNoRestrictedKeys(edgesJson, 'interp-edges.bin');
  assert.ok(edgesJson.edge_count > 500, `Expected >500 directed interp edges, got ${edgesJson.edge_count}`);

  // Also test bs index lookup
  const rockRec = store.getBs('G4073');
  assert.ok(rockRec && rockRec.records.length > 0, 'BRV3KIDX lookup for G4073 succeeds');

  const refToVid = loadCatalogRefLookup();
  const recsAt = (usfmRef) => {
    const vid = refToVid.get(usfmRef);
    assert.ok(vid, `Unknown USFM ref ${usfmRef}`);
    return store.getVid(vid)?.records || [];
  };
  const recsAcross = (refs) => {
    const seen = new Set();
    const out = [];
    for (const r of refs) {
      for (const rec of recsAt(r)) {
        if (!seen.has(rec.id)) { seen.add(rec.id); out.push(rec); }
      }
    }
    return out;
  };
  const hasStrongs = (rec, arr) => {
    const all = new Set([
      ...(rec.symbol_strongs || []),
      ...(rec.referent_strongs || []),
      ...(rec.tenor_strongs || []),
      ...(rec.vehicle_strongs || []),
    ]);
    return arr.every((s) => all.has(s));
  };

  // 3. Gold Witness Recall Suite (29 canonical witnesses across C1-C8)
  const goldChecks = [
    ['Zech 3:4 (garments/iniquity discourse)', () => recsAt('ZEC 3:4').some((r) => hasStrongs(r, ['H0899', 'H5771', 'H5674']))],
    ['Exod 17:7 (Massah/Meribah etiology)', () => recsAt('EXO 17:7').some((r) => r.eside_class === 'C6' && (hasStrongs(r, ['H4532', 'H5254']) || hasStrongs(r, ['H4809', 'H7379'])))],
    ['1 Cor 10:4 (C1 rock=Christ)', () => recsAt('1CO 10:4').some((r) => r.eside_class === 'C1' && hasStrongs(r, ['G4073', 'G5547']))],
    ['1 Cor 10:4 -> Exod 17:6 (C7 link)', () => recsAt('1CO 10:4').some((r) => r.eside_class === 'C7' && (r.target_vids || []).includes(refToVid.get('EXO 17:6')))],
    ['Dan 5:25-28 (C2 Pesar MENE/TEKEL/PERES)', () => recsAcross(['DAN 5:25', 'DAN 5:26', 'DAN 5:27', 'DAN 5:28']).some((r) => r.eside_class === 'C2' && hasStrongs(r, ['H4484', 'H8625', 'H6537']))],
    ['Amos 8:1-2 (C5 summer fruit / end)', () => recsAcross(['AMO 8:1', 'AMO 8:2']).some((r) => r.eside_class === 'C5' && hasStrongs(r, ['H7019', 'H7093']))],
    ['Isa 61:10 (garments of salvation / righteousness)', () => recsAt('ISA 61:10').some((r) => hasStrongs(r, ['H0899', 'H3468']) || hasStrongs(r, ['H4598', 'H6666']))],
    ['Rev 19:8 (C1 fine linen = righteous deeds)', () => recsAt('REV 19:8').some((r) => r.eside_class === 'C1' && hasStrongs(r, ['G1039', 'G1345']))],
    ['Luke 8:11 (C1 seed = word of God)', () => recsAt('LUK 8:11').some((r) => r.eside_class === 'C1' && hasStrongs(r, ['G4703', 'G3056']))],
    ['Isa 55:10-11 (C3 correlative rain/snow <-> word)', () => recsAcross(['ISA 55:10', 'ISA 55:11']).some((r) => r.eside_class === 'C3' && hasStrongs(r, ['H1653', 'H1697']))],
    ['John 3:14 (C3 correlative serpent <-> Son of Man)', () => recsAt('JHN 3:14').some((r) => r.eside_class === 'C3' && hasStrongs(r, ['G3789', 'G5207']))],
    ['Gal 4:24-25 (C1/C2 allegory Hagar=Sinai)', () => recsAcross(['GAL 4:24', 'GAL 4:25']).some((r) => (r.eside_class === 'C1' || r.eside_class === 'C2') && hasStrongs(r, ['G0028', 'G4614']))],
    ['Ezek 10:20 -> Ezek 1 (C4 cross-chapter ID)', () => recsAt('EZK 10:20').some((r) => r.eside_class === 'C4' && hasStrongs(r, ['H2416', 'H3742']) && (r.target_vids || []).some((tv) => tv <= refToVid.get('EZK 1:28')))],
    ['Heb 7:2 (C4 Melchizedek gloss)', () => recsAt('HEB 7:2').some((r) => r.eside_class === 'C4' && hasStrongs(r, ['G0935', 'G1343', 'G1515']))],
    ['Rom 9:33 (C7 dual frame-splice Isa 28:16 + Isa 8:14)', () => recsAt('ROM 9:33').some((r) => r.eside_class === 'C7' && (r.target_vids || []).includes(refToVid.get('ISA 28:16')) && (r.target_vids || []).includes(refToVid.get('ISA 8:14')) && (r.splices?.length || 0) >= 3)],
    ['Heb 10:37-38 (C7 Isa 26:20 + inverted Hab 2:3-4)', () => recsAcross(['HEB 10:37', 'HEB 10:38']).some((r) => r.eside_class === 'C7' && (r.target_vids || []).includes(refToVid.get('ISA 26:20'))) && recsAcross(['HEB 10:37', 'HEB 10:38']).some((r) => r.eside_class === 'C7' && (r.target_vids || []).includes(refToVid.get('HAB 2:4')))],
    ['Heb 3:7-11 (C7 Ps 95:7-11)', () => recsAcross(['HEB 3:7', 'HEB 3:8', 'HEB 3:9', 'HEB 3:10', 'HEB 3:11']).some((r) => r.eside_class === 'C7' && (r.target_vids || []).some((tv) => tv >= refToVid.get('PSA 95:7') && tv <= refToVid.get('PSA 95:11')))],
    ['Heb 4:1-11 (C7 Ps 95:11 / Gen 2:2)', () => recsAcross(['HEB 4:3', 'HEB 4:4', 'HEB 4:5', 'HEB 4:7']).some((r) => r.eside_class === 'C7' && ((r.target_vids || []).includes(refToVid.get('PSA 95:11')) || (r.target_vids || []).includes(refToVid.get('GEN 2:2'))))],
    ['Gen 41:26 (C1/C5 7 cows = 7 years)', () => recsAt('GEN 41:26').some((r) => (r.eside_class === 'C1' || r.eside_class === 'C5') && hasStrongs(r, ['H6510', 'H8141']))],
    ['Gen 21:3-6 (C6 Isaac naming etiology)', () => recsAcross(['GEN 21:3', 'GEN 21:6']).some((r) => r.eside_class === 'C6' && hasStrongs(r, ['H3327']))],
    ['Gen 29:32 (C6 compound Reuben etiology)', () => recsAt('GEN 29:32').some((r) => r.eside_class === 'C6' && hasStrongs(r, ['H7205', 'H7200', 'H1121']))],
    ['Matt 1:21 (C6 Jesus <-> save)', () => recsAt('MAT 1:21').some((r) => r.eside_class === 'C6' && hasStrongs(r, ['G2424', 'G4982']))],
    ['Rom 5:14 (C2 Adam typos)', () => recsAt('ROM 5:14').some((r) => r.eside_class === 'C2' && hasStrongs(r, ['G0076']))],
    ['1 Pet 3:21 (C2 antitype)', () => recsAt('1PE 3:21').some((r) => r.eside_class === 'C2' && r.trigger_strongs === 'G0499')],
    ['John 2:21 (C4 temple = body)', () => recsAt('JHN 2:21').some((r) => r.eside_class === 'C4' && hasStrongs(r, ['G3485', 'G4983']))],
    ['John 7:39 (C4 narrator comment Spirit)', () => recsAt('JHN 7:39').some((r) => r.eside_class === 'C4' && hasStrongs(r, ['G4151']))],
    ['Matt 13:38 (C1 field = world)', () => recsAt('MAT 13:38').some((r) => r.eside_class === 'C1' && hasStrongs(r, ['G0068', 'G2889']))],
    ['Ezek 37:11 (C1 bones = house of Israel)', () => recsAt('EZK 37:11').some((r) => r.eside_class === 'C1' && hasStrongs(r, ['H6106', 'H3478']))],
    ['Isa 53:7 (C8 Hebrew simile tuple)', () => recsAt('ISA 53:7').some((r) => r.eside_class === 'C8' && (hasStrongs(r, ['H7716']) || hasStrongs(r, ['H7353'])))],
    ['Matt 10:16 (C8 Greek simile tuple)', () => recsAt('MAT 10:16').some((r) => r.eside_class === 'C8' && (hasStrongs(r, ['G4263', 'G3074']) || hasStrongs(r, ['G3789', 'G4058'])))],
  ];

  const results = goldChecks.map(([name, fn]) => ({ name, passed: Boolean(fn()) }));
  const passedCount = results.filter((r) => r.passed).length;
  const recall = passedCount / results.length;

  // 4. Negative Controls
  // 4a. Judg 15:19 zero false "the day" (H3117)
  const jdgRecs = recsAt('JDG 15:19');
  const falseJudgDay = jdgRecs.some((r) =>
    [...(r.symbol_strongs || []), ...(r.referent_strongs || [])].includes('H3117'),
  );
  assert.equal(falseJudgDay, false, 'Judg 15:19 must have 0 false H3117 ("the day") records');

  // 4b. Rev 1:20 / 4:5 / 5:6 strict clause-local isolation (0 cross-verse/cross-clause conflation)
  const rev120C1 = recsAt('REV 1:20').filter((r) => r.eside_class === 'C1');
  const rev45C1 = recsAt('REV 4:5').filter((r) => r.eside_class === 'C1');
  const rev56C1 = recsAt('REV 5:6').filter((r) => r.eside_class === 'C1');
  assert.ok(rev120C1.some((r) => r.symbol_strongs.includes('G0792') && r.referent_strongs.includes('G0032') && !r.symbol_strongs.includes('G3087')), 'Rev 1:20 stars -> angels clause isolated');
  assert.ok(rev120C1.some((r) => r.symbol_strongs.includes('G3087') && r.referent_strongs.includes('G1577') && !r.symbol_strongs.includes('G0792')), 'Rev 1:20 lampstands -> churches clause isolated');
  assert.equal(rev120C1.some((r) => hasStrongs(r, ['G2985']) || hasStrongs(r, ['G2768'])), false, 'Rev 1:20 must not conflate Rev 4:5 lamps or Rev 5:6 horns');
  assert.equal(rev45C1.some((r) => hasStrongs(r, ['G3087']) || hasStrongs(r, ['G2768'])), false, 'Rev 4:5 must not conflate Rev 1:20 lampstands or Rev 5:6 horns');
  assert.equal(rev56C1.some((r) => hasStrongs(r, ['G2985']) || hasStrongs(r, ['G3087'])), false, 'Rev 5:6 must not conflate Rev 4:5 lamps or Rev 1:20 lampstands');

  // 5. Direct Unit Tests on alignTriTextualQuoteV4 (specificity gate, Rom 9:33 frame-splice, Heb 10:38 inversion)
  // 5a. Reject single low-IDF verb false splice
  const falseSingleVerb = alignTriTextualQuoteV4(
    [
      { idx: 0, surface: 'ἀγαπῶ', lemma: 'ἀγαπάω', strongs: 'G0025', isFunction: false },
      { idx: 1, surface: 'τόν', lemma: 'ὁ', strongs: 'G3588', isFunction: true },
    ],
    [
      {
        ref: 'Deuteronomy 30:16',
        vid: 5718,
        slots: [
          { lxxIdx: 0, lxxSurface: 'ἀγαπᾶν', lxxLemma: 'ἀγαπάω', lxxIdf: 6.2, isFunction: false, mtIdx: 0 },
          { lxxIdx: 1, lxxSurface: 'κύριον', lxxLemma: 'κύριος', lxxIdf: 2.5, isFunction: false, mtIdx: 1 },
        ],
      },
    ],
    { hasCitationFormula: false },
  );
  assert.equal(falseSingleVerb, null, 'Single medium-IDF verb without citation formula must be rejected');

  // 5b. Accept single ultra-rare (idf >= 8.5) when hasCitationFormula === true
  const rareWithFormula = alignTriTextualQuoteV4(
    [
      { idx: 0, surface: 'γέγραπται', lemma: 'γράφω', isFunction: false },
      { idx: 1, surface: 'σκάνδαλον', lemma: 'σκάνδαλον', isFunction: false },
    ],
    [
      {
        ref: 'Isaiah 8:14',
        vid: 17938,
        slots: [{ lxxIdx: 0, lxxSurface: 'σκάνδαλον', lxxLemma: 'σκάνδαλον', lxxIdf: 9.5, isFunction: false, mtIdx: 0 }],
      },
    ],
    { hasCitationFormula: true },
  );
  assert.ok(rareWithFormula && rareWithFormula.splices.length === 1, 'Single ultra-rare idf>=8.5 accepted when hasCitationFormula=true');

  // 5c. Clause inversion unit test (Heb 10:38 vs Hab 2:4)
  const hab24Slots = ['ἐάν', 'ὑποστέλλω', 'οὐ', 'εὐδοκέω', 'ψυχή', 'δέ', 'δίκαιος', 'ἐκ', 'πίστις', 'ζάω'].map((l, idx) => ({
    lxxIdx: idx,
    lxxSurface: l,
    lxxLemma: l,
    lxxIdf: ['ἐάν', 'οὐ', 'δέ', 'ἐκ'].includes(l) ? 0.6 : 7.5,
    isFunction: ['ἐάν', 'οὐ', 'δέ', 'ἐκ'].includes(l),
    mtIdx: idx,
  }));
  const heb1038Toks = ['ὁ', 'δέ', 'δίκαιος', 'ἐκ', 'πίστις', 'ζάω', 'καί', 'ἐάν', 'ὑποστέλλω', 'οὐ', 'εὐδοκέω', 'ψυχή'].map((l, idx) => ({
    idx,
    surface: l,
    lemma: l,
    isFunction: ['ὁ', 'δέ', 'ἐκ', 'καί', 'ἐάν', 'οὐ'].includes(l),
  }));
  const invRes = alignTriTextualQuoteV4(heb1038Toks, [{ ref: 'Habakkuk 2:4', vid: 22869, slots: hab24Slots }], { hasCitationFormula: false });
  assert.ok(invRes && invRes.splices.length === 2 && invRes.splices.some((s) => s.isInversion), 'Heb 10:38 recovers both inverted clauses of Hab 2:4');

  assert.ok(recall >= 0.95, `Gate V4-1b recall ${(recall * 100).toFixed(1)}% < 95% (${passedCount}/${results.length})`);

  console.log(
    JSON.stringify(
      {
        gate: 'V4-1b',
        status: 'PASS',
        gold_passed: passedCount,
        gold_total: results.length,
        recall_pct: Number((recall * 100).toFixed(2)),
        failed_witnesses: results.filter((r) => !r.passed).map((r) => r.name),
        total_vid_payloads: totalVidPayloads,
        interp_edges_count: edgesJson.edge_count,
        judg_15_19_false_day: falseJudgDay,
        rev_conflation: false,
        restricted_ubs_keys: 0,
      },
      null,
      2,
    ),
  );
}

main();
