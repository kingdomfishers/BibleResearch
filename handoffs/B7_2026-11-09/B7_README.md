# BibleResearch B7: guarded local rebuild and verification

## Verified live facts (2026-11-09)

- Supabase project: `ejoperxiwxlcbsqrkrvb`. The live Hebrew source tables already have explicit MT-to-canonical references for all 2,085 distinct shifted source verses examined.
- Macula Hebrew: 475,911 morphemes, none with `word_id` outside their current canonical verse; 694 are explicitly unmatched.
- MorphHB: 306,786 token records, none with linked `step_word_id` outside their current canonical verse; 1,636 unlinked.
- The production Cloudflare corpus **does not match** live source IDs `19AxB` (Psalm 3 heading) or `01SDx` (Gen 31:55). Database function `bible_internal.verify_b7_deployed_canaries_v1()` returns `FAIL` for both.
- Separate Swete check: 23,039 MT/LXX map records, including 498 without a Swete book counterpart and 45 with a Greek verse coordinate not present in the Swete token source. In the 45 absent targets, 31 are Nehemiah. **Present Greek verse text does not prove textual equivalence.**

## What this bundle changes and doesn't change

It provides a **guarded, local-only exporter patch** and a candidate verifier. It does not edit the local project automatically, cannot retrieve your actual `C:\Projects\BibleResearch` files remotely, and does not deploy Cloudflare or modify production data.

The patch is based on the GitHub `main` version of `scripts/export-static-corpus.py` inspected on 2026-11-09, **not assumed to match local files**. Its `--check` mode refuses mismatched source anchors. Do not force it onto a changed local version.

The patch:

1. Uses a private `SUPABASE_SERVICE_ROLE_KEY` for the export RPC (anonymous export access is now revoked). Keep this secret only in your local environment.
2. Builds into isolated `.artifacts/static-corpus-b7-candidate/` and `.artifacts/db-backup-b7-candidate/` rather than overwriting the current deployment's artifacts.
3. Disables three old-cache shortcuts: raw table export cache, compiled-shard metadata cache, and syntax-tree cache based only on old row/file counts.
4. Reparses **all 983 pinned Macula XML source files** against newly fetched canonical word mappings.
5. Checks all exported Hebrew/MorphHB source records against the explicit MT crosswalk and canonical word membership. Preserves unresolved records rather than forcing word IDs.
6. Removes restricted `semantic_frame` data from mapped/unmapped public syntax nodes and hydrated syntax-tree response payloads; adds `greekstrong` and related fields to the forbidden list.
7. Removes the unverified direct-reference fallback for Swete Greek verses.
8. Marks every LXX mapping with `b7_target_text_status` and keeps missing source targets separately in `hebrew_lxx_unresolved_mappings` in chapter JSON.
9. Uses the actual permitted `macula_gated_field_values` count instead of the old hardcoded 2,294.

## Safe local commands

1. Stop any concurrently editing agents; externally back up `.artifacts/static-corpus`, `.artifacts/db-backup`, the project source, and all secrets separately.
2. Copy `b7_patch_exporter.py` and `b7_verify_candidate.py` into a local `tools/` folder of the authoritative project. Do **not** edit GitHub first.
3. From the local project root, run `python tools/b7_patch_exporter.py --check`.
4. Review your local diff. If `--check` passes and the patch does not conflict with existing local work, run `python tools/b7_patch_exporter.py --apply`. It creates an original-file backup.
5. Supply a securely stored `SUPABASE_SERVICE_ROLE_KEY` in the local environment. **Never print, commit, or expose it in Vite public variables or frontend code.**
6. Run `python scripts/export-static-corpus.py`. It creates a separate candidate; refuses to merge into an existing nonempty candidate or backup directory.
7. Run `python tools/b7_verify_candidate.py`. This checks candidate checksums, every Macula Hebrew/MorphHB canonical reference and word membership, both canaries, LXX text-presence statuses, and exact source-token placement across generated chapter bundles.
8. Run the complete original XML hierarchy, licensing, security, search-index, API, regression, and full-data recovery verification suites. `b7_verify_candidate.py` is **not** sufficient for release sign-off by itself.
9. Reconcile the existing **live Cloudflare restricted-asset middleware** into the LOCAL `scripts/corpus-worker.mjs` before any deployment, or a normal GitHub deployment could undo the direct access block/redaction.
10. Only after complete checks pass, stage the candidate assets for deployment via the ordinary local → GitHub (backup/deployment) → Cloudflare pipeline, without publishing the service key or private backups.
11. Run `select bible_internal.verify_b7_deployed_canaries_v1();` again. It must return PASS, and the exhaustive live comparison must also pass before Stage G is even reconsidered.

## Limitations that still need independent review

- The current verified crosswalk and word-membership checks do **not** independently prove every homograph, morphology or token's correct **linguistic** identity. Validate verse reconstruction against pinned independent source texts and investigate the 694 Macula / 1,636 MorphHB unmatched/unlinked records.
- All 983 Macula XML source files and all tree-parent relationships need full source-level verification after rebuilding; this script only guarantees that stale syntax cache is not reused.
- The 45 missing Swete coordinates are flagged, **not remapped** to guessed alternatives. Identifying correct alternate coordinates requires source-text comparison.
- Greek New Testament editions and noncanonical textual variants require their own independent alignment audit.
- The database's 23 Stage G `BEFORE TRUNCATE` locks remain installed. Do not remove them or execute Stage G until backup, API equivalence, security and mapping gates all pass.
- If the authoritative local exporter differs from inspected GitHub source, have an agent manually merge the same changes rather than bypassing guards.

## Synthetic tests included

- `test_b7_patcher.py`: replacement contract and AST-valid generated candidate using synthetic source anchors.
- `test_b7_validators.py`: positive shifted MT references, negative stale-verse assignment, negative word-membership error.
- `test_b7_candidate.py`: end-to-end synthetic chapter placement and LXX presence/absence tests, including a deliberately broken chapter mapping.

All tests run offline without touching Supabase, Cloudflare, or local project files.