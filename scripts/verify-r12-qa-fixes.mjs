#!/usr/bin/env node
/**
 * Focused regression suite for ChatGPT Live QA 2026-11-17 (QA-01 through QA-12).
 * Runs in-process against scripts/corpus-worker.mjs over a specified asset bundle
 * (default: .artifacts-r10/deploy-bundle or --bundle <dir>).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import worker from './corpus-worker.mjs';

const args = process.argv.slice(2);
const bIdx = args.indexOf('--bundle');
const BUNDLE_DIR = path.resolve(bIdx >= 0 ? args[bIdx + 1] : '.artifacts-r10/deploy-bundle');

function createBundleEnv(bundleDir) {
  return {
    ASSETS: {
      async fetch(req) {
        const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
        const full = path.join(bundleDir, rel);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return new Response(fs.readFileSync(full), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      },
    },
  };
}

const env = createBundleEnv(BUNDLE_DIR);

async function rpc(op, body = {}) {
  const req = new Request(`https://corpus.internal/v1/rpc/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, data: json };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`PASS: ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err.message });
    console.log(`FAIL: ${name} -> ${err.message}`);
  }
}

async function main() {
  console.log(`Running QA regression checks against bundle: ${BUNDLE_DIR}\n`);

  // QA-01 / QA-04 / QA-10: Genesis 1:2 exact occurrence identities & R8 frames
  await check('QA-01/04: GEN 1:2 pos 9 H7307 resolves word_id=130555 and surface וְר֣וּחַ', async () => {
    const r = await rpc('query_relationships_v2', {
      op: 'unified_lemma',
      query: 'H7307',
      word_id: 130555,
      book: 1,
      chapter: 1,
      verse: 2,
      position: 9,
      layers: ['grammatical', 'lexical'],
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'ok');
    assert.equal(r.data.resolved_occurrence?.word_id, 130555);
    assert.equal(r.data.resolved_occurrence?.position, 9);
    assert.equal(r.data.resolved_occurrence?.surface_form, 'וְר֣וּחַ');
    assert.equal(r.data.resolved_occurrence?.source_token_id, 'o010010020092');
  });

  await check('QA-04: GEN 1:2 pos 2 (H1961=55675), pos 7 (H6440=118734), pos 13 (H6440=118736)', async () => {
    const cases = [
      { query: 'H1961', pos: 2, wid: 55675 },
      { query: 'H6440', pos: 7, wid: 118734 },
      { query: 'H6440', pos: 13, wid: 118736 },
    ];
    for (const c of cases) {
      const r = await rpc('query_relationships_v2', {
        op: 'unified_lemma',
        query: c.query,
        book: 1,
        chapter: 1,
        verse: 2,
        position: c.pos,
        layers: ['grammatical', 'lexical'],
      });
      assert.equal(r.data.status, 'ok', `${c.query}@${c.pos}`);
      assert.equal(r.data.resolved_occurrence?.word_id, c.wid, `${c.query}@${c.pos} word_id`);
      assert.equal(r.data.resolved_occurrence?.position, c.pos, `${c.query}@${c.pos} position`);
    }
  });

  await check('QA-10: GEN 1:2 R8 passage_frames have exact STEP word_ids and 1-based positions (no 200/201)', async () => {
    const r = await rpc('query_relationships_v2', {
      op: 'passage_frames',
      book: 1,
      chapter: 1,
      verse: 2,
    });
    assert.equal(r.data.status, 'ok');
    const rels = r.data.relations || [];
    const h7307 = rels.find(x => x.subject?.token_id === 'o010010020092');
    assert.ok(h7307, 'H7307 subject relation present');
    assert.equal(h7307.subject.word_id, 130555);
    assert.equal(h7307.subject.word_position, 9);
    const h6440pos7 = rels.find(x => x.object?.token_id === 'o010010020071');
    const h6440pos13 = rels.find(x => x.object?.token_id === 'o010010020131');
    assert.equal(h6440pos7?.object?.word_id, 118734);
    assert.equal(h6440pos7?.object?.word_position, 7);
    assert.equal(h6440pos13?.object?.word_id, 118736);
    assert.equal(h6440pos13?.object?.word_position, 13);
    for (const fr of r.data.frames || []) {
      if (fr.predicate?.word_position != null) {
        assert.ok(fr.predicate.word_position >= 1 && fr.predicate.word_position <= 20, `bad frame predicate pos ${fr.predicate.word_position}`);
      }
      for (const role of fr.roles || []) {
        if (role.word_position != null) {
          assert.ok(role.word_position >= 1 && role.word_position <= 20, `bad role pos ${role.word_position}`);
        }
      }
    }
  });

  await check('QA-06: JHN 1:1 G3056 positions 5 (15230), 8 (15229), 17 (15231) resolve occurrence while preserving grammatical no_evidence_in_covered_scope', async () => {
    const cases = [
      { pos: 5, wid: 15230 },
      { pos: 8, wid: 15229 },
      { pos: 17, wid: 15231 },
    ];
    for (const c of cases) {
      const r = await rpc('query_relationships_v2', {
        op: 'unified_lemma',
        query: 'G3056',
        word_id: c.wid,
        book: 43,
        chapter: 1,
        verse: 1,
        position: c.pos,
      });
      assert.equal(r.data.status, 'ok');
      assert.equal(r.data.resolved_occurrence?.word_id, c.wid, `JHN 1:1 pos ${c.pos}`);
      assert.equal(r.data.resolved_occurrence?.position, c.pos);

      const scoped = await rpc('query_relationships_v2', {
        op: 'unified_lemma',
        query: 'G3056',
        word_id: c.wid,
        book: 43,
        chapter: 1,
        verse: 1,
        position: c.pos,
        filter_to_passage: true,
      });
      assert.equal(scoped.data.layers?.grammatical?.status, 'no_evidence_in_covered_scope');
    }
  });

  await check('QA-07: PSA 3:0 pos 2 H1732 resolves word_id=53063 in unified_lemma and passage_frames', async () => {
    const u = await rpc('query_relationships_v2', {
      op: 'unified_lemma',
      query: 'H1732',
      word_id: 53063,
      book: 19,
      chapter: 3,
      verse: 0,
      position: 2,
      layers: ['lexical'],
    });
    assert.equal(u.data.status, 'ok');
    assert.equal(u.data.resolved_occurrence?.word_id, 53063);
    assert.equal(u.data.resolved_occurrence?.position, 2);
    assert.equal(u.data.resolved_occurrence?.reference, 'PSA 3:0');

    const pf = await rpc('query_relationships_v2', {
      op: 'passage_frames',
      book: 19,
      chapter: 3,
      verse: 0,
    });
    assert.equal(pf.data.status, 'ok');
    const davidRole = (pf.data.frames || []).flatMap(f => f.roles || []).find(r => r.head_token_id === 'o190030010022');
    assert.equal(davidRole?.word_id, 53063);
    assert.equal(davidRole?.word_position, 2);
  });

  // QA-05: Reject contradictory selectors
  await check('QA-05: Contradictory query/word_id/position returns selector_mismatch without switching to H1961', async () => {
    const r1 = await rpc('query_relationships_v2', {
      op: 'unified_lemma',
      query: 'H7307',
      word_id: 130555,
      book: 1,
      chapter: 1,
      verse: 2,
      position: 2,
      layers: ['lexical'],
    });
    assert.equal(r1.data.status, 'selector_mismatch');
    assert.equal(r1.data.focus, null);
    assert.ok(r1.data.mismatch?.conflicting_fields?.length >= 2);

    const r2 = await rpc('query_relationships_v2', {
      op: 'unified_lemma',
      word_id: 130555,
      book: 1,
      chapter: 1,
      verse: 2,
      position: 2,
      layers: ['lexical'],
    });
    assert.equal(r2.data.status, 'selector_mismatch');
    assert.equal(r2.data.focus, null);

    const r3 = await rpc('query_relationships_v2', {
      op: 'unified_lemma',
      query: 'H7307',
      word_id: 55675,
      layers: ['lexical'],
    });
    assert.equal(r3.data.status, 'selector_mismatch');

    const r4 = await rpc('query_relationships_v2', {
      op: 'unified_lemma',
      query: 'H7307',
      lemma_id: 'lemma:H1961',
      layers: ['lexical'],
    });
    assert.equal(r4.data.status, 'selector_mismatch');

    // Lemma-wide control (no position) must still succeed
    const okCtrl = await rpc('query_relationships_v2', {
      op: 'unified_lemma',
      query: 'G3056',
      book: 43,
      chapter: 1,
      verse: 1,
      layers: ['grammatical', 'lexical'],
    });
    assert.equal(okCtrl.data.status, 'ok');
    assert.equal(okCtrl.data.resolved_occurrence, null);
  });

  // QA-02 / QA-09: Spirit/wind self-intersection
  await check('QA-02/09: spirit+wind query does not emit single-token direct textual convergence r11:intersect:verse:H7307:H7307:2', async () => {
    const r = await rpc('discover_biblical_connections_v1', {
      query: 'spirit wind seven lamps seven eyes',
      limit: 10,
      max_hops: 2,
    });
    assert.equal(r.status, 200);
    const selfDirect = (r.data.strongest_connections || []).filter(
      c => c.evidence_id === 'r11:intersect:verse:H7307:H7307:2' ||
        (c.epistemic_class === 'direct_textual_evidence' && /r11:intersect:verse:(H\d+|G\d+):\1:/.test(c.evidence_id || ''))
    );
    assert.equal(selfDirect.length, 0, `Found false self-intersection: ${selfDirect.map(x => x.evidence_id).join(',')}`);

    const ev = await rpc('get_connection_evidence_v1', {
      evidence_id: 'r11:intersect:verse:H7307:H7307:2',
      release_id: 'r11-v1.0',
    });
    assert.notEqual(ev.data.evidence?.epistemic_class, 'direct_textual_evidence');
  });

  // QA-03 / QA-08: Hagar H1904 vs H1481
  await check('QA-03/08: Hagar query resolves H1904 and never labels H1481 Job 19:15 as Hagar', async () => {
    const r = await rpc('discover_biblical_connections_v1', {
      query: 'Hagar seeing spring well eyes Genesis 16 Genesis 21',
      limit: 8,
    });
    assert.equal(r.status, 200);
    const hagarConcept = (r.data.parsed_query?.resolved_concepts || []).find(c => c.normalized === 'hagar');
    assert.ok(hagarConcept, 'hagar concept resolved');
    assert.ok(hagarConcept.lemmas.some(l => l.strongs === 'H1904'), 'hagar must resolve to H1904');
    assert.ok(!hagarConcept.lemmas.some(l => l.strongs === 'H1481'), 'hagar must NOT resolve to H1481');
    const badHit = (r.data.strongest_connections || []).find(c => c.evidence_id === 'r11:intersect:verse:H1481:H5869:13313');
    assert.equal(badHit, undefined, 'Must not return H1481:H5869 as a Hagar hit');

    // Positive preservation control for H1481 + H5869
    const sojourn = await rpc('discover_biblical_connections_v1', {
      query: 'sojourn eyes',
      limit: 5,
    });
    assert.ok((sojourn.data.parsed_query?.resolved_concepts || []).some(c => c.lemmas?.some(l => l.strongs === 'H1481')));
  });

  // QA-11: same_clause & collocation contextual witnesses
  await check('QA-11: contextual_neighbors same_clause and collocation return matching sample witnesses', async () => {
    for (const q of ['H7307', 'G3056']) {
      const rClause = await rpc('query_relationships_v2', {
        op: 'contextual_neighbors',
        query: q,
        contextual_scope: 'same_clause',
        limit: 100,
        offset: 0,
      });
      assert.equal(rClause.data.status, 'ok');
      const items = rClause.data.contextual?.items || [];
      assert.equal(items.length, 100);
      const lacking = items.filter(it => (it.counts?.same_clause || 0) > 0 && !(it.sample_passages || []).some(p => p.in_same_clause === true));
      assert.equal(lacking.length, 0, `${q} same_clause lacking witness on ${lacking.length} items (e.g. ${lacking[0]?.target_lemma_key})`);

      const rColloc = await rpc('query_relationships_v2', {
        op: 'contextual_neighbors',
        query: q,
        contextual_scope: 'collocation',
        limit: 100,
        offset: 0,
      });
      assert.equal(rColloc.data.status, 'ok');
      const cItems = rColloc.data.contextual?.items || [];
      const cLacking = cItems.filter(it => (it.counts?.collocation_distance_le_3 || 0) > 0 && !(it.sample_passages || []).some(p => p.is_collocation === true));
      assert.equal(cLacking.length, 0, `${q} collocation lacking witness on ${cLacking.length} items`);
    }
  });

  // QA-12: Swete LXX tokenization
  await check('QA-12: Swete LXX Gen 32:1 token #1 separates XXXII chapter heading from εἰς without altering controls', async () => {
    const g32 = await rpc('lookup_septuagint_passage_v1', { p_book_no: 1, p_chapter: 32, p_verse_nr: 1 });
    assert.equal(g32.data.found, true);
    const t1 = g32.data.tokens[0];
    assert.equal(t1.source_record_id, 'SWETE:1.32.1#1');
    assert.equal(t1.word_text, 'εἰς');
    assert.equal(t1.normalized_word, 'εις');
    assert.equal(t1.raw_source_word_text, 'XXXIIεἰς');
    assert.equal(t1.chapter_heading_marker, 'XXXII');

    const comp = await rpc('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 1,
      p_hebrew_chapter: 32,
      p_hebrew_verse: 1,
    });
    assert.equal(comp.data.septuagint_passage?.words?.[0]?.word_text, 'εἰς');
    assert.equal(comp.data.septuagint_passage?.words?.[0]?.normalized_word, 'εις');

    // Controls: Gen 30:1, 31:1, 33:1, Exod 32:1, and Psalm 3:0 -> LXX 3:1
    for (const [b, c, v] of [[1, 30, 1], [1, 31, 1], [1, 33, 1], [2, 32, 1]]) {
      const ctrl = await rpc('lookup_septuagint_passage_v1', { p_book_no: b, p_chapter: c, p_verse_nr: v });
      assert.equal(ctrl.data.found, true, `control ${b}:${c}:${v}`);
      assert.ok(!/^[IVXLCDM]+/.test(ctrl.data.tokens[0].word_text), `unexpected Roman prefix on ${b}:${c}:${v}`);
    }
    // Negative control: Exod 33:8 Mωσῆ (not chapter 33 Roman numeral) must NOT be stripped
    const ex33 = await rpc('lookup_septuagint_passage_v1', { p_book_no: 2, p_chapter: 33, p_verse_nr: 8 });
    assert.ok(ex33.data.tokens.some(t => t.word_text === 'Mωσῆ'), 'Exod 33:8 Mωσῆ preserved');

    // Psalm 3:0 -> LXX 3:1 title preserved
    const ps3 = await rpc('compare_hebrew_septuagint_passage_v1', { p_hebrew_book: 19, p_hebrew_chapter: 3, p_hebrew_verse: 0 });
    assert.equal(ps3.data.septuagint_passage?.chapter, 3);
    assert.equal(ps3.data.septuagint_passage?.verse_nr, 1);
  });

  // Backward compatibility & preserved controls
  await check('Controls: H0430 disambiguation, reverse root:H7307, invalid release, missing GEN 1:0', async () => {
    const h430 = await rpc('query_relationships_v2', { op: 'unified_lemma', query: 'H430' });
    assert.equal(h430.data.status, 'needs_disambiguation');
    assert.ok((h430.data.homograph_candidates || []).length >= 4);

    const root = await rpc('query_relationships_v2', { op: 'lexical_relations', endpoint_key: 'root:H7307' });
    assert.equal(root.data.status, 'ok');
    assert.ok((root.data.lexical?.items || []).some(i => i.subject?.canonical_key === 'lemma:H7307'));

    const badRel = await rpc('query_relationships_v2', { op: 'coverage', release: 'r9b-does-not-exist' });
    assert.equal(badRel.data.status, 'release_not_found');

    const miss = await rpc('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 0 });
    assert.equal((miss.data.words || []).length, 0);
  });

  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
