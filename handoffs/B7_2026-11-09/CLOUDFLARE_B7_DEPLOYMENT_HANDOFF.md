# Cloudflare production B7 security and integrity handoff — 2026-11-09

**LOCAL workspace is authoritative.** This GitHub branch is a transfer-only artifact for Gemini Flash; do not merge it blindly or treat GitHub as a live local edit.

## Verified live deployment

- Worker: `bibleresearch-corpus`
- Active Worker version: `3f53b796-5b56-4fb1-a30e-545b001afb9b`, **100% traffic, sole version**.
- Deployment: `dfe26609-d8fa-4622-adc2-751d0d32bc98`.
- Previous recovery version retained by Cloudflare history: `1a9ee4cb-f567-4b0e-9962-cc5333a36183` (not in active deployment).
- Version preview URLs: disabled.
- Existing uploaded Static Assets: kept; NO corpus rebuild or modification was performed through this Cloudflare change.

## Protections applied

1. Original security wrapper continues blocking raw corpus assets under `/tables/`, `/v1/chapters/`, `/v1/lexical/`, `/v1/lxx/`, `/v1/syntax/` (except the supported `/v1/syntax/unmapped` endpoint), and `/v1/catalog/`.
2. All JSON RPC and `/v1/syntax/unmapped` responses are sanitized for the restricted field keys `semantic_frame`, `frame`, `greekstrong`, `sdbh`, `lexdomain`, `coredomain`, `contextualdomain`, `domain`, and `ln`. Objects in field-value arrays named with these labels are removed.
3. GET `/__integrity/b7` independently calls the existing Worker RPC twice to check exact source/word placement:
   - MorphHB `19AxB` -> Psalm 3:0, canonical verse 13959, word 88044.
   - MorphHB `01SDx` -> Genesis 31:55, canonical verse 929, word 138884.
   It returns HTTP **503 / FAIL** while the old static corpus is deployed, and HTTP **200 / PASS_CANARIES** if both pass. In either case `complete_corpus_verified: false` and `release_approved: false`. Passing these TWO canaries is never a full-corpus verification.
4. **Only the current safe version remains in the active deployment.** Do not leave older versions at 0% in a live deployment: a client can use the `Cloudflare-Workers-Version-Overrides` header to invoke a 0% version.
5. Ordinary research RPCs remain available. Neither existing source tables nor any Static Assets were changed.

## Tested live after staging (0% + version override) and deployment

- `/health`: HTTP 200.
- `/tables/syntax_nodes/part-0000.jsonl.gz`: HTTP 403.
- `lookup_syntax_tree_v1`: HTTP 200, Genesis syntax exists, restricted fields not present.
- `lookup_hebrew_verse_evidence_v1`: HTTP 200, no restricted fields in inspected response.
- `lookup_septuagint_passage_v1`: HTTP 200, Genesis 1:1 10 Greek tokens.
- `/__integrity/b7`: HTTP 503 and both case checks FAIL as expected.
- Earlier version URL: HTTP 404 while previews are disabled.

## Important next steps for Gemini

1. Read `B7_README.md`, `b7_patch_exporter.py`, and `b7_verify_candidate.py` in this directory. Verify local exporter compatibility BEFORE applying the patch.
2. Preserve this **live security wrapper** from `CLOUDFLARE_B7_LIVE_MIDDLEWARE_REFERENCE.js` when rebuilding the LOCAL `scripts/corpus-worker.mjs`; the reference comes from Cloudflare's *compiled* bundle and must be adapted into local source, **not pasted verbatim**.
3. Rebuild the entire corpus from corrected source records without stale caches; run exhaustive source/word, syntax, license, checksum, and data integrity checks. Include full Swete source-target text checks; 45 mapping targets currently have absent Greek source units.
4. Deploy a new version only after a complete verified candidate build, preserving restricted-field rules and version-preview restrictions. Perform a 0%-traffic version-override smoke test; then promote to 100% with **no older version remaining in the active deployment**.
5. Validate `GET /__integrity/b7` and the privileged Supabase `bible_internal.verify_b7_deployed_canaries_v1()` canaries. Both must PASS, along with the exhaustive verification suite.
6. Do not run Stage G deletion or remove the 23 `BEFORE TRUNCATE` release locks. Full backup/restore verification and complete API regression still need independent approval.
