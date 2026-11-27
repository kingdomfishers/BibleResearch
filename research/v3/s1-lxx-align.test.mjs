import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ALIGN_JSON = '.artifacts-r12/v3-build/lxx-alignment.json';
const ALIGN_DIR = '.artifacts-r12/staging-bundle/v3/align';

let cachedAlign;
function loadAlign() {
  if (!cachedAlign) {
    cachedAlign = JSON.parse(fs.readFileSync(ALIGN_JSON, 'utf8'));
  }
  return cachedAlign;
}

test('S1-A1: Strict CC BY 4.0 provenance, 60 non-auto lxx-morph files, and 40 align shards (< 10 MiB) with zero Swete BY-SA', () => {
  const align = loadAlign();
  assert.equal(align.provenance.license, 'CC BY 4.0');
  assert.equal(align.provenance.swete_included, false);
  assert.equal(align.provenance.isc_code_copied, false);
  assert.equal(align.provenance.lxx_morph_non_auto_files, 60);
  assert.equal(align.provenance.lxx_morph_book_files, 59);
  assert.match(align.provenance.lxx_morph_manifest_sha256, /^[0-9a-f]{64}$/);

  const files = fs.readdirSync(ALIGN_DIR).sort();
  assert.equal(files.length, 40, `Expected 32 mt-lxx shards + 8 rahlfs-concordance shards, got ${files.length}`);
  assert.ok(!files.includes('rahlfs-concordance.bin'), 'Unsharded >10 MiB rahlfs-concordance.bin must not stay in staging-bundle/v3/align/');
  for (let i = 0; i < 32; i++) {
    assert.ok(files.includes(`mt-lxx-${String(i).padStart(2, '0')}.bin`));
  }
  const mergedLemmas = {};
  for (let s = 0; s < 8; s++) {
    const name = `rahlfs-concordance-${String(s).padStart(2, '0')}.bin`;
    assert.ok(files.includes(name), `Missing ${name}`);
    const full = path.join(ALIGN_DIR, name);
    const sz = fs.statSync(full).size;
    assert.ok(sz < 10 * 1024 * 1024, `${name} exceeds 10 MiB (${sz} bytes)`);
    const concRaw = fs.readFileSync(full, 'utf8');
    assert.doesNotMatch(concRaw, /BY-SA|lxx_swete/i, 'v3/align must contain zero Swete CC BY-SA data');
    const conc = JSON.parse(concRaw);
    assert.equal(conc.total_books, 59);
    Object.assign(mergedLemmas, conc.lemmas);
  }
  assert.ok(mergedLemmas['ἀδόκιμος']?.total_occ >= 1);
  assert.ok(mergedLemmas['ἀκρογωνιαῖος']?.total_occ >= 1);
});

test('S1-A2: eval_300 AER <= 0.14 for both raw word_links and fused word_links + Psi(i,j)', () => {
  const align = loadAlign();
  const raw = align.eval_300.raw_word_links;
  const fused = align.eval_300.fused_psi_backoff;
  assert.ok(raw.aer <= 0.14, `Expected raw AER <= 0.14, got ${raw.aer}`);
  assert.ok(fused.aer <= 0.14, `Expected fused AER <= 0.14, got ${fused.aer}`);
  assert.ok(fused.f1 >= 0.85, `Expected fused F1 >= 0.85, got ${fused.f1}`);
  assert.ok(fused.recall >= raw.recall, 'Psi(i,j) backoff must not drop recall below raw');
});

test('S1-A3: Canonical versification mapping resolves Jeremiah, Psalms, 2 Esdras, Exodus, and Proverbs', () => {
  const align = loadAlign();
  assert.equal(align.stats.paired_verses, 23878);
  assert.ok(align.stats.matched_canonical_vids >= 23850);

  const byRef = new Map(align.verses.map(v => [`${v.grk_book}|${v.ref}`, v]));

  // Jeremiah transposition: MT Jer 31:32 <-> jeremiah-lxx 38:32
  const jer3132 = byRef.get('jeremiah-lxx|jeremiah 31:32');
  assert.ok(jer3132 && jer3132.vids.length === 1);
  assert.deepEqual(jer3132.grk_refs, ['38:32']);

  // Psalm superscription (3:1 = heading + v1) and offset (Ps 33:6 <-> psalms-lxx 32:6)
  const ps31 = byRef.get('psalms-lxx|psalms 3:1');
  assert.ok(ps31 && ps31.vids.length === 2, 'Psalms 3:1 must span heading vid + verse 1 vid');
  const ps336 = byRef.get('psalms-lxx|psalms 33:6');
  assert.ok(ps336 && ps336.grk_refs[0] === '32:6');

  // 2 Esdras = Ezra + Nehemiah
  const ezra11 = byRef.get('2-esdras|ezra 1:1');
  const neh11 = byRef.get('2-esdras|nehemiah 1:1');
  assert.ok(ezra11 && ezra11.grk_refs[0] === '1:1');
  assert.ok(neh11 && neh11.grk_refs[0] === '11:1');

  // Proverbs 25-31 offset
  const prov301 = byRef.get('proverbs|proverbs 30:1');
  assert.ok(prov301 && prov301.vids.length === 1);

  // Exodus 35-40 tabernacle reordering
  const ex3824 = byRef.get('exodus|exodus 38:24');
  assert.ok(ex3824 && ex3824.vids.length >= 1);
});

test('S1-A4: Golden MT<->LXX alignments and typed LxxTranslationShift records', () => {
  const align = loadAlign();
  const byRef = new Map(align.verses.map(v => [`${v.grk_book}|${v.ref}`, v]));

  // 1. Isa 28:16: πιστεύων -> הַמַּאֲמִין (H0539), ἀκρογωνιαῖον -> פִּנַּת (H6438), καταισχυνθῇ -> יָחִישׁ (H2363)
  const isa2816 = byRef.get('isaiah|isaiah 28:16');
  assert.ok(isa2816);
  const link2816 = (gLem, hBs) => isa2816.links.some(l => l.g_lemma === gLem && l.h_bs === hBs);
  assert.ok(link2816('πιστεύω', 'H0539'), 'Isa 28:16 must align πιστεύων -> H0539');
  assert.ok(link2816('ἀκρογωνιαῖος', 'H6438'), 'Isa 28:16 must align ἀκρογωνιαῖον -> H6438 (פִּנַּת)');
  assert.ok(link2816('καταισχύνω', 'H2363'), 'Isa 28:16 must align καταισχυνθῇ -> H2363 (חוּשׁ)');

  // 2. Isa 1:22: סִיג (H5509) -> ἀδόκιμος
  const isa122 = byRef.get('isaiah|isaiah 1:22');
  assert.ok(isa122);
  assert.ok(isa122.links.some(l => l.g_lemma === 'ἀδόκιμος' && l.h_bs === 'H5509'), 'Isa 1:22 must align סִיג -> ἀδόκιμος');
  assert.ok(isa122.shifts.length >= 1, 'Isa 1:22 must extract translation shifts (2fs->2pl / lxx_plus)');

  // 3. Hab 2:4: 3ms -> 1cs μου pronoun_person_shift
  const hab24 = byRef.get('habakkuk|habakkuk 2:4');
  assert.ok(hab24);
  assert.ok(
    hab24.shifts.some(s => s.type === 'pronoun_person_shift' && s.h_sfx?.startsWith('3') && s.g_surface === 'μου'),
    `Hab 2:4 must detect 3ms -> 1cs μου pronoun_person_shift, got ${JSON.stringify(hab24.shifts)}`,
  );

  // 4. Jer 31:32: בָּעַל (H1166) -> ἀμελέω
  const jer3132 = byRef.get('jeremiah-lxx|jeremiah 31:32');
  assert.ok(jer3132.links.some(l => l.g_lemma === 'ἀμελέω' && l.h_bs === 'H1166'), 'Jer 31:32 must align בָּעַל -> ἀμελέω');
  assert.ok(jer3132.shifts.some(s => s.type === 'lexical_theological_shift' && s.g_lemma === 'ἀμελέω'));

  // 5. Isa 40:5: + τὸ σωτήριον τοῦ θεοῦ (lxx_plus_expansion)
  const isa405 = byRef.get('isaiah|isaiah 40:5');
  assert.ok(
    isa405.shifts.some(s => s.type === 'lxx_plus_expansion' && /σωτήριον/.test(s.text) && /θεοῦ/.test(s.text)),
    `Isa 40:5 must extract + τὸ σωτήριον τοῦ θεοῦ, got ${JSON.stringify(isa405.shifts)}`,
  );

  // 6. Ps 33:6: aligned λόγος <-> H1697, πνεῦμα <-> H7307
  const ps336 = byRef.get('psalms-lxx|psalms 33:6');
  assert.ok(ps336.links.some(l => l.g_lemma === 'λόγος' && l.h_bs === 'H1697'));
  assert.ok(ps336.links.some(l => l.g_lemma === 'πνεῦμα' && l.h_bs === 'H7307'));
});
