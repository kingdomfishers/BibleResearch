# Phase 0 reconciliation and proposed delivery plan

Date: 2026-11-10. Workspace: `C:/Projects/BibleResearch`.
Supabase project: `ejoperxiwxlcbsqrkrvb`.

**NOT READY for production storage reclamation. Phase 0 remains incomplete.**

This report supersedes readiness claims in [STAGE_G_FINAL_APPROVAL.md](STAGE_G_FINAL_APPROVAL.md) and storage/dependency assumptions in the earlier [independent audit](ARCHITECTURE_INDEPENDENT_AUDIT.md). Historical results are not current acceptance evidence.

## Measured state

| Item | Observed result | Meaning |
| --- | --- | --- |
| Live database | 1,513,352,339 bytes / 1,443.25 MiB | Above the documented 500 MB Free-plan allowance |
| Current SQL reclamation scope | 19 tables; 1,132,150,784 bytes / 1,079.70 MiB | Exact current `TRUNCATE TABLE` list measured with `pg_total_relation_size` |
| Arithmetic remainder | 381,201,555 bytes / 363.54 MiB | Projection only; residual allocation and subsequent growth require final measurement |
| Local typecheck, size/manifest checks, production build | PASS | Current working tree compiles; existing large map chunk warning remains |
| Mandatory biblical mapping regression | 46 passed, 0 failed | Tested local Hebrew, Greek, Aramaic, Psalm heading, LXX and cross-verse syntax cases pass |
| Python static-corpus suite | 4 tests PASS, 151.9 seconds | Existing local verifier and Unicode, license-gating, syntax and LXX assertions pass; does not prove full remote integrity or restore |
| Deployed Worker health and manifest | Initial verifier checks PASS | Worker reachable; version matches local; manifest declares 983 imported Macula files |
| Deployed raw backup shard verification | FAIL: HTTP 403 at `/tables/books/part-0000.jsonl.gz?raw=1` | Full remote digest verification did not complete |
| Two previously exposed ingest functions | `anon` execution denied | Emergency revocation confirmed; not a complete security certification |

Storage was measured using `pg_database_size(current_database())` and the exact 19 relations in [reclaim-supabase-storage.sql](scripts/reclaim-supabase-storage.sql). Decimal MB and binary MiB must remain distinct. A conservative final target is below 400,000,000 bytes, with platform-reported database usage also below the Free-plan quota.

## Reconciled architecture and scope

The current SQL lists 17 public tables plus two internal Macula manifest/unmapped-node tables. It does **not** truncate `hebrew_lxx_word_alignments`, `versification_mappings`, `lxx_norm_word_summary`, or `macula_greekstrong_morphemes`. AUDIT-03/05/07 and the earlier independent audit assume a different, 23-table scope.

Proposed default: retain those four relations. The 19-table projection already meets the storage goal. The original four alignment/cross-testament RPCs still require regression tests, but references to retained tables are not proof that the current truncation breaks them. Do not expand destructive scope without separate backup/dependency evidence.

[wrangler.corpus.jsonc](wrangler.corpus.jsonc) configures **Cloudflare Workers Static Assets**, using an `ASSETS` binding. This inspection does not establish an R2 deployment. Preserve the existing static-assets architecture unless a measured requirement justifies R2. Mutable notes, private translations, scholarly assertions and application state remain in PostgreSQL.

## Newly identified live dependencies

Read-only `pg_proc` inspection found these public functions with `anon` execution enabled and direct SQL reads of reclamation targets. Repository search found no definitions in local migrations:

| Live function | Direct reads requiring preservation |
| --- | --- |
| `research_passage_lens_v1` | `macula_hebrew_morphemes`, `macula_greek_tokens`, `reader_english_verses` |
| `research_word_lens_v1` | `verse_translation_sources`, `reader_english_verses` |
| `research_word_bridge_v1` | `verse_translation_sources`, `reader_english_verses` |
| `get_dlm_notes_for_verse_v1` | `word_form_lemmas` |
| `verify_dlm_lemma_occurrence_v1` | `word_form_lemmas` |

These expand the feature-preservation work beyond AUDIT-03. Capture canonical definitions and pre-change fixtures before replacing reads. Preserve signatures, ordering, count scope, homograph identity and callers. Keep relational computation in PostgreSQL with bounded static gateway inputs. Corpus failure must not become empty scholarly evidence.

Other source-text dependency candidates include existing hybrid RPCs and service-only import/export helpers. A text match alone does not establish an active dependency: inspect bodies, distinguish comments/helper payload keys, and test relevant contracts against an isolated reclaimed-state fixture.

## Confirmed recovery and reproducibility gaps

- [build-reclamation-backup-schema.mjs](scripts/build-reclamation-backup-schema.mjs) reads hardcoded paths in a prior agent's scratch directory; schema generation is not portable.
- [test-isolated-pg-restore.mjs](scripts/test-isolated-pg-restore.mjs) inserts two internal datasets but reads samples or reports backup counts for other targets. Its success message does not prove a complete 19-table restore. It also expects plaintext private-frame JSON.
- [restore-supabase-storage.mjs](scripts/restore-supabase-storage.mjs) invokes the isolated verifier; it lacks a production database restore transport.
- [export-static-corpus.py](scripts/export-static-corpus.py) already has cache/local-shard fallback and a minimum-row guard, partially superseding the earlier audit. It still starts with a network metadata request and lacks an explicit, independently verified offline-source mode.
- [publish-static-corpus.yml](.github/workflows/publish-static-corpus.yml) starts clean-checkout exports from live Supabase. Ignored local caches/backups are not reproducible CI inputs.
- [preflight-storage-reclamation.mjs](scripts/preflight-storage-reclamation.mjs) accepts twelve sampled remote assets as its integrity threshold; full deployment completeness remains unproved.
- Investigate the remote HTTP 403 without exposing private/restricted backups to satisfy the verifier. Public asset and authenticated backup verification need separate contracts.

## Proposed execution sequence

Execute one atomic task at a time. Split each workstream into one- or two-file tasks when locking it; use pre-code/post-code for application and migration edits. Preserve existing uncommitted changes and unrelated task statuses.

| Order | Deliverable | Acceptance evidence |
| --- | --- | --- |
| 1 | Confirm 19-table scope and correct stale AUDIT requirements | One target inventory shared by backup, restore and reclamation checks; retained relations explicit |
| 2 | Reconcile the five additional live RPC definitions and record contract fixtures | Local/live signatures accounted for; pre-change representative outputs captured |
| 3 | Complete hybrid RPC and lemma-note preservation, including new dependencies | SQL/REST/MCP parity where exposed; strict homographs; explicit outage errors; reclaimed-state tests pass |
| 4 | Establish offline rebuild and durable CI source inputs | Clean staging-directory build with network disabled; source hashes verified; no empty overwrite; equivalent digests |
| 5 | Implement portable DDL, complete backup verification and actual restore | Every shard digest/JSONL record verified; every target restored in isolated PostgreSQL/PGlite; exact counts/IDs, FK/constraint/sequence checks; restricted backup decryption without plaintext dumps |
| 6 | Repair deployed verification and replace sampled/constant audit claims | Full public manifest verified; authorized backup verification; remote code/content identity; corrupt/missing shards fail |
| 7 | Run security and feature acceptance | Reader, lexical/homograph evidence, syntax, LXX, research lenses, chronology, geography, private translations, notes and MCP pass; no secrets/restricted fields published |
| 8 | Produce fresh Stage G approval report | Restore, dependencies, remote hashes, regressions and fresh storage projection all pass before asking for destructive approval |
| 9 | Only after explicit final approval: reclaim atomically and measure | Transactional pre/postconditions; actual database and platform usage below quota; post-change parity; executable recovery path |

AUDIT-06 relationship-dataset expansion remains its own queue item. Preserve existing relationship features for Phase 0 and report actual coverage; do not imply an unexecuted full import is complete.

## Verification and limits

Executed against the existing working tree:

```powershell
npm.cmd run check:types
npm.cmd run check:size
npm.cmd run build
node scripts/verify-all-mandatory-regressions.mjs
node scripts/verify-static-corpus-remote.mjs --all
.\.artifacts\skill-validation\python\python.exe scripts/test-static-corpus.py -v
```

The first four commands and all four Python tests passed. The remote command required network permission after sandbox `EACCES`, then failed on the raw backup shard with HTTP 403. `--all` does not imply the script reached full-corpus verification. Browser acceptance, full remote digests, full isolated restore and reclaimed-state feature parity are not established by these checks.

The live security advisor flags a mutable search path on `note_validate_block_v1`. Human notes write RPCs are intentionally public in the approved single-user architecture; review their advisor findings against that policy rather than blanket-revoking access. No production mutations, deployments or removals were performed during reconciliation.

## Approval boundary

The mandatory [pre-code skill](.agents/skills/pre-code/SKILL.md), Step 0, says: "Complex Feature (> 3 sub-tasks OR requires DB schema / ARCHITECTURE.md changes): Explain the plan simply, highlight SQL/architectural changes, and wait for user approval before coding."

Approve this expanded Phase 0 sequence and proposed 19-table scope before implementation. This does not authorize production truncation; that remains a separate final checkpoint after acceptance evidence passes.
