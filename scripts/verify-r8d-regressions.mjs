/**
 * scripts/verify-r8d-regressions.mjs
 *
 * Comprehensive verification test suite for R8D:
 * 1. Defect 1: Canonical lemma and sense-alias resolution & transliteration lookup
 * 2. Defect 2: Individual relation-ID evidence lookup with safe regex parsing
 * 3. Defect 3: Biblical coverage classifications (all 6 categories)
 * 4. Defect 4: Release manifest shard counts matching actual disk inventory
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { handleQueryRelationshipsV2, parseRelationId } from './corpus-relationships-rpc.mjs';

const STATIC_CORPUS = path.resolve('.artifacts/static-corpus');

function createMockCtx() {
  const cache = new Map();
  return {
    env: {},
    loadJsonShard: async (_env, assetPath) => {
      const cleanPath = assetPath.replace(/^\/+/, '');
      if (cache.has(cleanPath)) return cache.get(cleanPath);
      const absPath = path.join(STATIC_CORPUS, cleanPath);
      if (!fs.existsSync(absPath)) return null;
      const buf = fs.readFileSync(absPath);
      const text = cleanPath.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
      const parsed = JSON.parse(text);
      cache.set(cleanPath, parsed);
      return parsed;
    },
  };
}

async function verifyR8D() {
  console.log('=== BibleResearch R8D Correctness & Usability Verification Suite ===\n');
  const ctx = createMockCtx();

  let passCount = 0;
  let totalCount = 0;

  function test(name, fn) {
    totalCount++;
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passCount++;
    } catch (err) {
      console.error(`  [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passCount++;
    } catch (err) {
      console.error(`  [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  // -------------------------------------------------------------
  // SECTION 1: Canonical lemma and sense-alias resolution
  // -------------------------------------------------------------
  console.log('--- 1. Canonical Lemma and Sense-Alias Resolution ---');

  await testAsync('1.1: Surface form "רוּחַ" deduplicates sense aliases to canonical lemmas', async () => {
    const res = await handleQueryRelationshipsV2(ctx, { query: 'רוּחַ' });
    assert.strictEqual(res.status, 'needs_disambiguation');
    assert.ok(Array.isArray(res.homograph_candidates));
    // Exactly 2 canonical homographs: Hebrew lemma:H7307 and Aramaic lemma:H7308
    assert.strictEqual(res.homograph_candidates.length, 2, 'Should have exactly 2 homograph candidates');
    const ids = res.homograph_candidates.map(c => c.lemma_id);
    assert.ok(ids.includes('lemma:H7307'), 'Must include Hebrew lemma:H7307');
    assert.ok(ids.includes('lemma:H7308'), 'Must include Aramaic lemma:H7308');
  });

  await testAsync('1.2: Transliteration "ruach" resolves via normalized transliteration index', async () => {
    const res = await handleQueryRelationshipsV2(ctx, { query: 'ruach' });
    assert.strictEqual(res.status, 'needs_disambiguation');
    // Transliteration "ruach" matches 3 phonetic homographs: H7306 (to smell), H7307 (spirit/wind), H7308 (Aramaic spirit)
    assert.strictEqual(res.homograph_candidates?.length, 3);
    const ids = res.homograph_candidates.map(c => c.lemma_id);
    assert.ok(ids.includes('lemma:H7307'), 'Must include H7307');
    assert.ok(ids.includes('lemma:H7308'), 'Must include H7308');
    assert.ok(ids.includes('lemma:H7306'), 'Must include H7306');
  });

  await testAsync('1.3: Base Strong\'s "H7307" resolves directly to lemma:H7307 with preserved subdivisions', async () => {
    const res = await handleQueryRelationshipsV2(ctx, { query: 'H7307' });
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.focus?.lemma_id, 'lemma:H7307');
    assert.ok(Array.isArray(res.focus?.subdivisions), 'Must preserve documented subdivisions');
    const subAliases = res.focus.subdivisions.map(s => s.extended_strongs || s.alias);
    assert.ok(subAliases.includes('H7307G') || subAliases.includes('H7307H'));
    assert.ok((res.summaries?.length || 0) > 0, 'Should return relationship summaries for H7307');
  });

  await testAsync('1.4: Extended Strong\'s "H7307G", "H7307H", "H7307I", "H7307J" resolve to lemma:H7307', async () => {
    for (const alias of ['H7307G', 'H7307H', 'H7307I', 'H7307J']) {
      const res = await handleQueryRelationshipsV2(ctx, { query: alias });
      assert.strictEqual(res.status, 'ok', `Failed to resolve ${alias}`);
      assert.strictEqual(res.focus?.lemma_id, 'lemma:H7307', `Alias ${alias} did not resolve to canonical lemma:H7307`);
      assert.strictEqual(res.focus?.queried_alias, alias, `Queried alias not preserved for ${alias}`);
    }
  });

  await testAsync('1.5: Canonical ID "lemma:H7307" resolves directly', async () => {
    const res = await handleQueryRelationshipsV2(ctx, { query: 'lemma:H7307' });
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.focus?.lemma_id, 'lemma:H7307');
    assert.ok(res.summaries.length > 0);
  });

  await testAsync('1.6: Genuine homographs "H776" still require disambiguation', async () => {
    const res = await handleQueryRelationshipsV2(ctx, { query: 'H776' });
    assert.strictEqual(res.status, 'needs_disambiguation');
    assert.ok(res.homograph_candidates.length >= 2);
  });

  await testAsync('1.7: Genuine homographs "H0430" retain canonical distinction', async () => {
    // H0430 has genuine canonical distinction between God of Israel (H0430G) and foreign gods/rulers (H0430a)
    const res = await handleQueryRelationshipsV2(ctx, { query: 'H0430' });
    assert.strictEqual(res.status, 'needs_disambiguation');
    assert.ok(res.homograph_candidates.length >= 2);
    const candidateIds = res.homograph_candidates.map(c => c.lemma_id);
    assert.ok(candidateIds.includes('lemma:H0430G'), 'Must include H0430G (God)');
    assert.ok(candidateIds.includes('lemma:H0430a'), 'Must include H0430a (gods/rulers)');

    // Direct query for H0430G resolves directly
    const gRes = await handleQueryRelationshipsV2(ctx, { query: 'H0430G' });
    assert.strictEqual(gRes.status, 'ok');
    assert.strictEqual(gRes.focus?.lemma_id, 'lemma:H0430G');

    // Verify Aramaic counterpart H0426 is separate
    const aramaicRes = await handleQueryRelationshipsV2(ctx, { query: 'H0426' });
    assert.strictEqual(aramaicRes.status, 'ok');
    assert.strictEqual(aramaicRes.focus?.lemma_id, 'lemma:H0426');
  });

  await testAsync('1.8: Passage occurrence lookup (GEN 1:2 word 9) resolves canonical lemma:H7307', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      book: 1,
      chapter: 1,
      verse: 2,
      position: 9,
      filter_to_passage: true,
    });
    // GEN 1:2 word 9 in Hebrew is וְר֣וּחַ (spirit/wind of God, token o010010020092)
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.focus?.lemma_id, 'lemma:H7307');
    assert.strictEqual(res.resolved_occurrence?.position, 9);
  });

  await testAsync('1.9: Token ID lookup (o010010020092) resolves directly to lemma:H7307', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      token_id: 'o010010020092',
    });
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.focus?.lemma_id, 'lemma:H7307');
    assert.strictEqual(res.resolved_occurrence?.position, 9);
  });

  // -------------------------------------------------------------
  // SECTION 2: Individual relation-ID evidence lookup
  // -------------------------------------------------------------
  console.log('\n--- 2. Safe Relation-ID Evidence Lookup ---');

  test('2.1: parseRelationId safely handles biblical references containing colons', () => {
    const rawId = 'rel:macula-hebrew-wlc:GEN 1:1#cl0:grammatical_subject_of:o010010010031:o010010010021';
    const parsed = parseRelationId(rawId);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.edition, 'macula-hebrew-wlc');
    assert.strictEqual(parsed.usfm, 'GEN');
    assert.strictEqual(parsed.book, 1);
    assert.strictEqual(parsed.chapter, 1);
    assert.strictEqual(parsed.verse, 1);
    assert.strictEqual(parsed.clause, 'cl0');
    assert.strictEqual(parsed.predicate, 'grammatical_subject_of');
    assert.strictEqual(parsed.subjectToken, 'o010010010031');
    assert.strictEqual(parsed.objectToken, 'o010010010021');
  });

  await testAsync('2.2: Retrieve Hebrew relation evidence by relation_id', async () => {
    const relId = 'rel:macula-hebrew-wlc:GEN 1:1#cl0:grammatical_subject_of:o010010010031:o010010010021';
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'evidence',
      relation_id: relId,
    });
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.relations?.length, 1);
    const rel = res.relations[0];
    assert.strictEqual(rel.relation_id, relId);
    assert.strictEqual(rel.canonical_ref, 'GEN 1:1');
    assert.strictEqual(rel.predicate, 'grammatical_subject_of');
    assert.strictEqual(rel.subject?.lemma_id, 'lemma:H0430G');
    assert.strictEqual(rel.object?.lemma_id, 'lemma:H1254a');
    assert.ok(rel.source_clause_id, 'Must contain source clause identifier');
    assert.ok(rel.frame_id, 'Must contain frame_id');
  });

  await testAsync('2.3: Retrieve Greek relation evidence by relation_id', async () => {
    const relId = 'rel:macula-greek-nestle1904:JHN 10:1#cl0:grammatical_indirect_object_of:n43010001004:n43010001003';
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'evidence',
      relation_id: relId,
    });
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.relations?.length, 1);
    const rel = res.relations[0];
    assert.strictEqual(rel.relation_id, relId);
    assert.strictEqual(rel.canonical_ref, 'JHN 10:1');
    assert.strictEqual(rel.predicate, 'grammatical_indirect_object_of');
    assert.strictEqual(rel.subject?.lemma_id, 'lemma:G4771');
    assert.strictEqual(rel.object?.lemma_id, 'lemma:G3004G');
    assert.ok(rel.source_clause_id);
  });

  await testAsync('2.4: Query string passthrough "query: rel:..." resolves identical to relation_id', async () => {
    const relId = 'rel:macula-hebrew-wlc:GEN 1:1#cl0:grammatical_subject_of:o010010010031:o010010010021';
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'evidence',
      query: relId,
    });
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.relations?.length, 1);
    assert.strictEqual(res.relations[0].relation_id, relId);
  });

  // -------------------------------------------------------------
  // SECTION 3: Correct Biblical Coverage Classification
  // -------------------------------------------------------------
  console.log('\n--- 3. Biblical Coverage Classification ---');

  await testAsync('3.1: covered_with_evidence (GEN 1:1 has 2 relations)', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'passage_frames',
      book: 1,
      chapter: 1,
      verse: 1,
    });
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.coverage_classification, 'covered_with_evidence');
    assert.ok((res.relations?.length || 0) >= 2);
  });

  await testAsync('3.2: covered_no_supported_relation (GEN 10:16 parsed with 0 supported relations)', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'passage_frames',
      book: 1,
      chapter: 10,
      verse: 16,
    });
    assert.strictEqual(res.status, 'no_evidence_in_covered_scope');
    assert.strictEqual(res.coverage_classification, 'covered_no_supported_relation');
    assert.strictEqual(res.relations?.length || 0, 0);
  });

  await testAsync('3.3: not_in_canonical_verse (MAT 17:21 omitted in critical text)', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'passage_frames',
      book: 40,
      chapter: 17,
      verse: 21,
    });
    assert.strictEqual(res.status, 'not_in_canonical_verse');
    assert.strictEqual(res.coverage_classification, 'not_in_canonical_verse');
  });

  await testAsync('3.4: invalid_reference (GEN 99:99 non-existent chapter/verse)', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'passage_frames',
      book: 1,
      chapter: 99,
      verse: 99,
    });
    assert.strictEqual(res.status, 'invalid_reference');
    assert.strictEqual(res.coverage_classification, 'invalid_reference');
  });

  await testAsync('3.5: unsupported_edition (Third-party edition "vulgate")', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'passage_frames',
      book: 1,
      chapter: 1,
      verse: 1,
      edition: 'vulgate',
    });
    assert.strictEqual(res.status, 'unsupported_edition');
    assert.strictEqual(res.coverage_classification, 'unsupported_edition');
  });

  await testAsync('3.6: unsupported_edition (Greek edition requested for OT book)', async () => {
    const res = await handleQueryRelationshipsV2(ctx, {
      op: 'passage_frames',
      book: 1,
      chapter: 1,
      verse: 1,
      edition: 'macula-greek-sblgnt',
    });
    assert.strictEqual(res.status, 'unsupported_edition');
    assert.strictEqual(res.coverage_classification, 'unsupported_edition');
  });

  // -------------------------------------------------------------
  // SECTION 4: Release Manifest and Inventory Consistency
  // -------------------------------------------------------------
  console.log('\n--- 4. Release Manifest Shard Inventory Consistency ---');

  await testAsync('4.1: active.json points to release r8-v1.1', async () => {
    const active = await ctx.loadJsonShard(ctx.env, '/v2/relationships/active.json.gz');
    assert.strictEqual(active.active_release, 'r8-v1.1');
    assert.strictEqual(active.manifest_path, '/v2/relationships/r8-v1.1/manifest.json.gz');
  });

  await testAsync('4.2: manifest.json dynamically declares 256 by-lemma and evidence shards', async () => {
    const manifest = await ctx.loadJsonShard(ctx.env, '/v2/relationships/r8-v1.1/manifest.json.gz');
    assert.strictEqual(manifest.release_version, 'r8-v1.1');
    assert.strictEqual(manifest.counts.by_lemma_shards, 256);
    assert.strictEqual(manifest.counts.evidence_by_summary_shards, 256);
    assert.strictEqual(manifest.counts.passages_by_chapter_shards, 1189);
    assert.strictEqual(manifest.counts.passages_by_book_shards, 66);
    assert.strictEqual(manifest.counts.evidence_by_book_shards, 66);
    assert.strictEqual(manifest.counts.total_shards, 1771);
  });

  await testAsync('4.3: Physical disk shard inventory matches manifest counts exactly', async () => {
    const relDir = path.join(STATIC_CORPUS, 'v2', 'relationships', 'r8-v1.1');
    const byLemmaFiles = fs.readdirSync(path.join(relDir, 'by-lemma')).filter(f => f.endsWith('.json.gz'));
    const evSummaryFiles = fs.readdirSync(path.join(relDir, 'evidence', 'by-summary')).filter(f => f.endsWith('.json.gz'));
    const evBookFiles = fs.readdirSync(path.join(relDir, 'evidence')).filter(f => f.endsWith('.json.gz') && f.startsWith('b'));
    const passageFiles = fs.readdirSync(path.join(relDir, 'passages')).filter(f => f.endsWith('.json.gz'));

    assert.strictEqual(byLemmaFiles.length, 256, 'Should have exactly 256 by-lemma shards on disk');
    assert.strictEqual(evSummaryFiles.length, 256, 'Should have exactly 256 evidence/by-summary shards on disk');
    assert.strictEqual(evBookFiles.length, 66, 'Should have exactly 66 evidence by book shards on disk');
    assert.strictEqual(passageFiles.length, 1189, 'Should have exactly 1189 passage chapter shards on disk');
  });

  console.log(`\n=== Verification Complete: ${passCount}/${totalCount} tests passed ===`);
}

verifyR8D().catch(err => {
  console.error('\nVerification suite FAILED:', err);
  process.exit(1);
});
