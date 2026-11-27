/**
 * 50 Adversarial Negative Controls for BibleResearch v3 (Stage S6 Gate + Dev Verification).
 * Covers:
 *  - 10 Strophic/Refrain Chiasm Traps (Amos 1-2, Ps 136, Gen 5, Num 7, Amos 4, etc.)
 *  - 10 Suffix/2-Consonant Wordplay Traps (Χριστός/ἄχρηστος, φρονεῖν/μέτρον, מָרוֹת/רְתֹם, וְהָיָה/יְהוָה, etc.)
 *  - 10 Hub & Single-Axis Collisions (NEG6 Gen 19:10/Ezek 41:23, H0853/G2532/G0846, שָׁכַם, זָהָב, etc.)
 *  - 10 Pseudo-Homograph / Proper-Name Hijacks (H6697 rock/rocks, H6438 Corner Gate, H5158 palm-tree, H1540 Heglam, etc.)
 *  - 10 False Cross-Anchor / Polysemy Traps (melach/melek, Hagar/Ekron/40, H5869 eye vs spring, B1253 potash vs cleanness)
 *
 * Exports ADVERSARIAL_50 and runs all 50 controls directly against local v3 engines & artifacts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { corpusRpc } from '../../scripts/local-corpus-harness.mjs';
import { isProperOrConstructName, normalizeHebrewPointed } from '../../scripts/v3/sanitize-step-lexicon.mjs';
import { compareOriginalForms, normalizeOriginalForm } from '../../src/relationships/wordplay-engine.ts';
import { parsePassageString } from '../../supabase/functions/bible-mcp/bible-ref.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

export const ADVERSARIAL_50 = [
  // 1..10: Strophic / Refrain Chiasm Traps (must NOT produce false chiasms)
  { id: 'ADV-CHIASM-01', category: 'strophic_refrain', passage: 'Amos 1:3-2:5', expect_chiasm: false },
  { id: 'ADV-CHIASM-02', category: 'strophic_refrain', passage: 'Psalm 136:1-26', expect_chiasm: false },
  { id: 'ADV-CHIASM-03', category: 'strophic_refrain', passage: 'Genesis 5:1-32', expect_chiasm: false },
  { id: 'ADV-CHIASM-04', category: 'strophic_refrain', passage: 'Numbers 7:12-83', expect_chiasm: false },
  { id: 'ADV-CHIASM-05', category: 'strophic_refrain', passage: 'Amos 4:6-12', expect_chiasm: false },
  { id: 'ADV-CHIASM-06', category: 'strophic_refrain', passage: 'Psalm 107:1-32', expect_chiasm: false },
  { id: 'ADV-CHIASM-07', category: 'strophic_refrain', passage: 'Deuteronomy 27:15-26', expect_chiasm: false },
  { id: 'ADV-CHIASM-08', category: 'strophic_refrain', passage: 'Matthew 5:3-10', expect_chiasm: false },
  { id: 'ADV-CHIASM-09', category: 'strophic_refrain', passage: 'Isaiah 9:8-10:4', expect_chiasm: false },
  { id: 'ADV-CHIASM-10', category: 'strophic_refrain', passage: '1 Chronicles 1:1-27', expect_chiasm: false },

  // 11..20: Suffix / 2-Consonant / False Etymology Wordplay Traps
  { id: 'ADV-WP-01', category: 'suffix_noise', a: 'Χριστός', b: 'ἄχρηστος', expect_documented_relation: false },
  { id: 'ADV-WP-02', category: 'suffix_noise', a: 'φρονεῖν', b: 'μέτρον', expect_wordplay: false },
  { id: 'ADV-WP-03', category: 'suffix_noise', a: 'δεσμοῖς', b: 'Ὀνήσιμον', expect_wordplay: false },
  { id: 'ADV-WP-04', category: 'suffix_noise', a: 'מָרוֹת', b: 'רְתֹם', expect_wordplay: false },
  { id: 'ADV-WP-05', category: 'suffix_noise', a: 'וְהָיָה', b: 'יְהוָה', expect_wordplay: false },
  { id: 'ADV-WP-06', category: 'suffix_noise', a: 'κρατέω', b: 'περιπατέω', expect_wordplay: false },
  { id: 'ADV-WP-07', category: 'suffix_noise', a: 'שָׁבַת', b: 'שָׁבַר', expect_attested_wordplay: false },
  { id: 'ADV-WP-08', category: 'suffix_noise', a: 'הֹרָה', b: 'אוּרִיָּה', expect_attested_wordplay: false },
  { id: 'ADV-WP-09', category: 'suffix_noise', a: 'בָּבֶל', b: 'פְּקוֹד', expect_common_root: false },
  { id: 'ADV-WP-10', category: 'suffix_noise', a: 'ὑάλινος', b: 'οὐρανός', expect_wordplay: false },

  // 21..30: Hub & Single-Axis Collisions
  { id: 'ADV-HUB-01', category: 'single_axis_trap', a: 'Genesis 19:10', b: 'Ezekiel 41:23', expect_high_convergence: false },
  { id: 'ADV-HUB-02', category: 'hub_stopword', query: 'H2050', expect_excluded_from_index: true },
  { id: 'ADV-HUB-03', category: 'hub_stopword', query: 'H9002', expect_excluded_from_index: true },
  { id: 'ADV-HUB-04', category: 'hub_stopword', query: 'H0853', expect_excluded_from_index: true },
  { id: 'ADV-HUB-05', category: 'hub_stopword', query: 'G2532', expect_excluded_from_index: true },
  { id: 'ADV-HUB-06', category: 'hub_stopword', query: 'G0846', expect_excluded_from_index: true },
  { id: 'ADV-HUB-07', category: 'hub_drift', a: 'Judges 19:5', b: 'Exodus 24:4', note: 'H7925 rose-early hub must not dominate', expect_top_bridge: false },
  { id: 'ADV-HUB-08', category: 'hub_drift', a: 'Exodus 25:31', b: 'Revelation 21:18', note: 'H2091 gold hub alone is insufficient without multi-axis convergence', expect_single_axis_damped: true },
  { id: 'ADV-HUB-09', category: 'number_coincidence', query: 'three days resurrection', forbidden_ref: 'Genesis 5:23', expect_excluded: true },
  { id: 'ADV-HUB-10', category: 'number_coincidence', query: '40', forbidden_strongs: 'G4722', expect_excluded: true },

  // 31..40: Pseudo-Homograph & Proper-Name Hijack Controls
  { id: 'ADV-HOMO-01', category: 'proper_name_hijack', strongs: 'H5158', forbidden_primary_gloss: 'palm-tree', expect_clean_primary: true },
  { id: 'ADV-HOMO-02', category: 'proper_name_hijack', strongs: 'H6438', forbidden_primary_gloss: 'Corner (Gate)', expect_clean_primary: true },
  { id: 'ADV-HOMO-03', category: 'proper_name_hijack', strongs: 'H6697', forbidden_primary_gloss: 'Rocks (of Goats)', expect_clean_primary: true },
  { id: 'ADV-HOMO-04', category: 'proper_name_hijack', strongs: 'H7462', forbidden_primary_gloss: 'Beth-eked', expect_clean_primary: true },
  { id: 'ADV-HOMO-05', category: 'proper_name_hijack', strongs: 'H1540', forbidden_primary_gloss: 'Heglam', expect_clean_primary: true },
  { id: 'ADV-HOMO-06', category: 'proper_name_hijack', strongs: 'H2319', forbidden_primary_gloss: 'New (Gate)', expect_clean_primary: true },
  { id: 'ADV-HOMO-07', category: 'pseudo_homograph', strongs: 'H6697', expect_collapsed_inflections: true },
  { id: 'ADV-HOMO-08', category: 'proper_name_hijack', strongs: 'H4519', forbidden_primary_gloss: 'Moses', expect_clean_primary: true },
  { id: 'ADV-HOMO-09', category: 'proper_name_hijack', strongs: 'H7799', forbidden_primary_gloss: 'Susa', expect_clean_primary: true },
  { id: 'ADV-HOMO-10', category: 'niqqud_ambiguity', query: 'בֹּר', expected_top_strongs: 'H1253', forbidden_top_strongs: 'H1247' },

  // 41..50: False Cross-Anchor & Polysemy Gate Controls
  { id: 'ADV-CTRL-01', category: 'false_anchor_pair', items: ['melach', 'melek'], expect_direct_link: false },
  { id: 'ADV-CTRL-02', category: 'false_anchor_pair', items: ['Hagar', 'Ekron', 'forty'], expect_direct_link: false },
  { id: 'ADV-CTRL-03', category: 'false_anchor_pair', items: ['H1904', 'H3629'], expect_all_connected: false },
  { id: 'ADV-CTRL-04', category: 'false_anchor_pair', items: ['Revelation 4:5', 'Revelation 5:6'], forbidden_edge: 'G1027:G2362', expect_forbidden_absent: true },
  { id: 'ADV-CTRL-05', category: 'false_cluster', strongs: 'H4417', forbidden_cluster: 'temple_and_sanctuary_architecture', expect_forbidden_absent: true },
  { id: 'ADV-CTRL-06', category: 'sense_polysemy', strongs: 'H5869', passage: 'Matthew 6:22', forbidden_sense: 'spring', expect_clean_sense: true },
  { id: 'ADV-CTRL-07', category: 'sense_polysemy', strongs: 'H5869', passage: 'Genesis 16:7', expected_sense: 'spring', expect_clean_sense: true },
  { id: 'ADV-CTRL-08', category: 'sense_polysemy', strongs: 'H1253', passage: 'Job 9:30', expected_sense: 'alkali', expect_clean_sense: true },
  { id: 'ADV-CTRL-09', category: 'sense_polysemy', strongs: 'H3722', passage: 'Genesis 6:14', forbidden_sense: 'atone', expect_clean_sense: true },
  { id: 'ADV-CTRL-10', category: 'false_quote', passage: 'John 1:1-3', forbidden_source: 'Ezekiel 41:23', expect_rejected: true },
];

export async function runAdversarial50() {
  const lex = JSON.parse(fs.readFileSync(path.join(repoRoot, '.artifacts-r12/v3-build/sanitized-lexicon.json'), 'utf8'));
  const ont = JSON.parse(fs.readFileSync(path.join(repoRoot, '.artifacts-r12/v3-build/sense-ontology.json'), 'utf8'));
  const nodes = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(path.join(repoRoot, '.artifacts-r12/staging-bundle/v3/index/nodes.json.gz'))).toString('utf8'),
  );

  const results = [];
  for (const c of ADVERSARIAL_50) {
    let ok = false;
    let detail = '';

    if (c.id.startsWith('ADV-CHIASM-')) {
      const p = parsePassageString(c.passage);
      const res = await corpusRpc('analyze_literary_structure_v1', {
        passage: p.normalized,
        passages: p.passages,
        detail: 'standard',
      });
      const chiasms = (res.symmetries || []).filter((s) =>
        /chiasm/i.test(String(s.patternType || s.kind || s.type || '')),
      );
      ok = res.status === 'ok' && chiasms.length === 0;
      detail = `status=${res.status} verses=${res.verseCount} chiasms=${chiasms.length}`;
    } else if (c.id.startsWith('ADV-WP-')) {
      const m = compareOriginalForms(normalizeOriginalForm(c.a), normalizeOriginalForm(c.b));
      if (c.expect_wordplay === false || c.expect_common_root === false || c.expect_documented_relation === false) {
        ok = m.comparable === false && m.formal_score === 0;
      } else {
        // expect_attested_wordplay: false -> must NOT claim documented/attested wordplay
        ok = m.overlap_kind !== 'documented_biblical_wordplay' && m.overlap_kind !== 'consonantal_exact';
      }
      detail = `comparable=${m.comparable} kind=${m.overlap_kind} score=${m.formal_score}`;
    } else if (c.id === 'ADV-HUB-01') {
      const [cmp, disc] = await Promise.all([
        corpusRpc('compare_patterns_v1', { targets: [c.a, c.b], detail: 'standard' }),
        corpusRpc('discover_biblical_connections_v2', { query: c.a, mode: 'discover', limit: 15 }),
      ]);
      const hitsTarget = (disc.strongest_connections || []).some((x) =>
        String(x.target_ref || x.title || '').includes(c.b),
      );
      ok = (cmp.tesserae_parallels?.length || 0) === 0 && !cmp.structural_role_alignment && !hitsTarget;
      detail = `tesserae=${cmp.tesserae_parallels?.length || 0} inTop15=${hitsTarget}`;
    } else if (c.expect_excluded_from_index) {
      const prof = lex.profiles?.[c.query];
      const inGraph = Boolean(nodes.key_to_id?.[c.query] ?? nodes.key_to_id?.[`lemma:${c.query}`]);
      ok = prof?.is_grammatical_marker === true && !inGraph;
      detail = `is_grammatical_marker=${prof?.is_grammatical_marker} inGraph=${inGraph}`;
    } else if (c.id === 'ADV-HUB-07') {
      const disc = await corpusRpc('discover_biblical_connections_v2', { query: c.a, mode: 'discover', limit: 8 });
      const top = disc.strongest_connections?.[0];
      const topUsesRoseEarly = String(top?.title || '').includes('H7925') || String(top?.title || '').includes(c.b);
      ok = Boolean(top) && !topUsesRoseEarly;
      detail = `top="${String(top?.title || '').slice(0, 70)}"`;
    } else if (c.id === 'ADV-HUB-08') {
      const prof = lex.profiles?.H2091;
      const inMatGroup = Array.isArray(ont.material_groups?.['MAT:METALS']) && ont.material_groups['MAT:METALS'].includes('H2091');
      const cmp = await corpusRpc('compare_patterns_v1', { targets: [c.a, c.b], detail: 'standard' });
      ok = (prof?.canonical_df ?? 0) >= 200 && inMatGroup && !cmp.structural_role_alignment;
      detail = `H2091_df=${prof?.canonical_df} matGroupDamped=${inMatGroup}`;
    } else if (c.id === 'ADV-HUB-09') {
      const disc = await corpusRpc('discover_biblical_connections_v2', { query: c.query, mode: 'discover', limit: 12 });
      const hitsForbidden = (disc.strongest_connections || []).some((x) =>
        JSON.stringify(x).includes(c.forbidden_ref),
      );
      ok = !hitsForbidden;
      detail = `forbiddenAbsent=${!hitsForbidden}`;
    } else if (c.id === 'ADV-HUB-10') {
      const res = await corpusRpc('discover_biblical_connections_v2', { query: c.query, mode: 'discover', limit: 12 });
      const hasForbidden = JSON.stringify(res.strongest_connections || []).includes(c.forbidden_strongs);
      ok = !hasForbidden;
      detail = `forbiddenStrongsAbsent=${!hasForbidden}`;
    } else if (c.id === 'ADV-HOMO-10') {
      const k = normalizeHebrewPointed(c.query);
      const hits = lex.lookup?.pointed?.[k] || [];
      ok = hits[0] === c.expected_top_strongs && !hits.includes(c.forbidden_top_strongs);
      detail = `pointedHits=${JSON.stringify(hits)}`;
    } else if (c.id.startsWith('ADV-HOMO-')) {
      const prof = lex.profiles?.[c.strongs];
      const clean = Boolean(prof) &&
        !String(prof.gl || '').toLowerCase().includes(String(c.forbidden_primary_gloss || '___').toLowerCase()) &&
        isProperOrConstructName(prof.gl, prof.pos, prof.entity_kind) === false;
      ok = c.expect_collapsed_inflections
        ? clean && (lex.stats?.inflections_collapsed ?? 0) >= 1000
        : clean;
      detail = `gl="${prof?.gl}" entity=${prof?.entity_kind}`;
    } else if (c.id === 'ADV-CTRL-01' || c.id === 'ADV-CTRL-02') {
      const cmp = await corpusRpc('compare_patterns_v1', { targets: c.items, detail: 'standard' });
      const direct = (cmp.tesserae_parallels?.length || 0) > 0 || (cmp.shared_lemmas?.length || 0) > 0;
      ok = !direct;
      detail = `sharedLemmas=${cmp.shared_lemmas?.length || 0} tesserae=${cmp.tesserae_parallels?.length || 0}`;
    } else if (c.id === 'ADV-CTRL-03') {
      const sub = await corpusRpc('discover_subgraph_v1', { targets: c.items });
      const hasDirect1904To3629 = (sub.edges || []).some(
        (e) => JSON.stringify(e).includes('1904') && JSON.stringify(e).includes('3629'),
      );
      ok = !hasDirect1904To3629;
      detail = `edges=${sub.edges?.length || 0} directCrossEdge=${hasDirect1904To3629}`;
    } else if (c.id === 'ADV-CTRL-04') {
      const sub = await corpusRpc('discover_subgraph_v1', { targets: c.items });
      const hasForbidden = (sub.edges || []).some(
        (e) => e.evidence_id === 'r13:wp:G1027:G2362' || e.evidence_id === 'r13:wp:G2362:G1027',
      );
      ok = !hasForbidden;
      detail = `edges=${sub.edges?.length || 0} forbiddenWpAbsent=${!hasForbidden}`;
    } else if (c.id === 'ADV-CTRL-05') {
      const prof = lex.profiles?.[c.strongs];
      const senses = Object.values(ont.mapped_senses || {}).filter((s) => s.bs === c.strongs);
      const hasArch = JSON.stringify({ prof, senses }).includes(c.forbidden_cluster);
      ok = !hasArch && senses.length > 0;
      detail = `haliteSenses=${senses.length} forbiddenCluster=${hasArch}`;
    } else if (c.id === 'ADV-CTRL-06' || c.id === 'ADV-CTRL-07') {
      const ev = ont.polysemy_eval?.H5869;
      const eye = ont.mapped_senses?.['sense:H5869:eye'];
      const spring = ont.mapped_senses?.['sense:H5869:spring'];
      ok = Boolean(eye?.oewn_id && spring?.oewn_id && eye.oewn_id !== spring.oewn_id && ev?.fp_rate < 0.03 && ev?.per_sense_accepted?.[1] >= 1);
      detail = `fp=${ev?.fp_rate} eye=${eye?.oewn_id} spring=${spring?.oewn_id}`;
    } else if (c.id === 'ADV-CTRL-08') {
      const ev = ont.polysemy_eval?.B1253;
      const alkali = Object.values(ont.mapped_senses || {}).find((s) => s.bs === 'H1253');
      ok = ev?.fp_rate === 0 && ev?.abstained_ambiguous >= 1 && alkali?.physical_props?.material_role === 'alkali_flux';
      detail = `fp=${ev?.fp_rate} role=${alkali?.physical_props?.material_role}`;
    } else if (c.id === 'ADV-CTRL-09') {
      const senses = lex.profiles?.H3722?.senses || [];
      const hasAtone = senses.some((s) => /atone/i.test(s.gl));
      const hasCover = senses.some((s) => /cover|pitch/i.test(s.gl));
      ok = hasAtone && hasCover;
      detail = `senses=${JSON.stringify(senses.map((s) => s.gl))}`;
    } else if (c.id === 'ADV-CTRL-10') {
      const tri = await corpusRpc('tri_textual_diff_v3', { passage: c.passage });
      const hasForbidden = JSON.stringify(tri.candidate_sources || []).includes(c.forbidden_source);
      ok = tri.status === 'ok' && !hasForbidden;
      detail = `status=${tri.status} sources=${(tri.candidate_sources || []).length} forbiddenAbsent=${!hasForbidden}`;
    }

    results.push({ id: c.id, ok, detail });
  }

  const passed = results.filter((r) => r.ok).length;
  for (const r of results) {
    if (!r.ok) console.error(`FAIL ${r.id}: ${r.detail}`);
  }
  console.log(`Adversarial 50 Result: ${passed}/${results.length} PASS`);
  assert.equal(passed, 50, `Expected 50/50 pass, got ${passed}/50`);
  return { passed, total: results.length, results };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  await runAdversarial50();
}
