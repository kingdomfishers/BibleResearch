# Phase 0 checkpoint — 2026-11-13

## Current verified update — supersedes the historical checkpoint below

**Reclamation has not been executed. Phase 0 is not complete. Separate confirmation “Execute the verified TRUNCATE.” remains mandatory.**

- Supabase OAuth is authenticated. Fresh local Codex processes successfully listed tables and executed read-only SQL. Other remote environments need their own configured/authenticated connection.
- **Backup verification: PASS, all 19 tables / 3,083,555 rows**, against fresh production counts and canonical SHA-256 digests. Row hashes include all typed columns and primary keys; sorting hexadecimal row hashes avoids locale differences. The rendering-group discrepancy was ICU/en-US versus C ordering. Syntax copies were corrected from authenticated production: 8,014 semantic-frame records and 7,710 records with stale verse/word/mapping-status fields. Original shards and all three encrypted archives are preserved. Production was not changed.
- Representative restoration remains PASS: 23 records / 14 relations, with FK, index, sequence and retrieval checks. No full-data restoration was required or performed.
- Current-branch isolated integration is PASS: all 19 tables empty/SELECT-denied; five exact SQL contracts, 12 website gateway operations including accountless note writes, five actual MCP tools, geography/chronology baseline comparisons and explicit corpus-outage errors. Five production research RPC baselines passed on retry; an earlier word-lens timeout is recorded rather than counted as a pass.
- Worker `21e402c0-3da7-49b3-b3cd-f7703cca8f18` remains at 100% traffic. The existing 1,890/1,890 asset hash/size evidence is reused because deployment is unchanged. No raw backup endpoint was opened. Live research definitions have no drift from reconciled sources.
- Final pre-approval size: **1,513,426,067 bytes / 1,443.32 MiB**. Target allocation: **1,132,150,784 bytes**. Projected remainder: **381,275,283 bytes / 363.61 MiB**; actual reduction has not occurred.
- All 19 current counts were checked. Only the stale `hebrew_lxx_verse_map` SQL guard changed: **22,633 → 23,039**. [The exact scope](scripts/phase0-storage-scope.mjs) explicitly excludes the five protected tables and retains the four alignment/summary relations.
- All 13 individual production preflight assertions, the combined read-only preflight and the rollback-only preservation-wrapper dry-run passed. The wrapper pinned the five baselines and fingerprinted **116 retained tables**, then ROLLBACK completed. The dry-run contained no TRUNCATE or trigger-disabling statements. Earlier transient transport and audit failures are retained in the work history; none was counted as a pass.
- A detached clean Git checkout at `a20896a` successfully compiled the Worker using Wrangler `--dry-run` with existing verified assets and the dependency cache. No Supabase source reads, dataset regeneration, dataset copies or deployment occurred. All 1,890 core assets have modification times preceding the passing integrity verification.
- Typecheck, size/manifest checks and production build passed. Preservation-guard tests detect content, column, constraint, index, trigger, RLS, policy and privilege changes and verify rollback.

### Fresh protected baseline

Schema definitions, columns, indexes, constraints, triggers, RLS policies and privileges are captured in `.artifacts/phase0/protected-five-baseline.json`. The generated approval SQL pins both content and complete schema metadata; post-reclamation preservation is pending execution.

| Relation | Rows | Content SHA-256 |
| --- | ---: | --- |
| public.bol_events | 5 | `18e1434fae8c039147dbf87430f6dd9c19c51ffc17e48c36e21d452c773d4f76` |
| public.bol_profiles | 1 | `1b922818d209b19a07f93683464baf113269b5964d262001bdca360416b3c822` |
| public.bol_years | 4 | `72ecb663453422dde710c4c902bfab52f9d6f0d5043e8b2c42538ddcecac8972` |
| public.content | 66 | `849f46c9065fb833d5425ab223ce7f31b93578839bbc5165a199d8caefdb4450` |
| public.pages | 5 | `274a84809491aedcae6084497e5161e41e8fc81c0455888d169be72eb02ac192` |

### Reviewed operation and recovery

[build-reclamation-approval.mjs](scripts/build-reclamation-approval.mjs) requires complete verified backups and emits `.artifacts/phase0/reclamation-approval.sql` without executing it. The wrapper pins the five baselines, checks deployed release-guard definitions, and locks/fingerprints every retained regular/partitioned table outside PostgreSQL system/temporary schemas, including auth, storage, realtime and vault. Service-owned tables use ACCESS SHARE where the role lacks stronger lock permissions; strict before/after equality remains mandatory. It compares full content and schema before COMMIT. Release guards are disabled only for the exact 19 targets inside the approved transaction and re-enabled before postchecks. Existing count/research/size assertions and timeouts remain. No DROP TABLE, CASCADE, reset or broad deletion is used.

Any pre-COMMIT failure rolls back the entire operation, including TRUNCATE and guard changes. If a regression occurs after COMMIT, restore only the 19 targets from the verified inventory, corrected syntax shards and original encrypted archives using an authorized PostgreSQL transaction. Stage JSONL as temporary JSONB, insert typed records with original IDs (`jsonb_populate_record`, `OVERRIDING SYSTEM VALUE`), load FK parents first and all syntax nodes in one INSERT for self-references. Retained canonical/dynamic tables must not be replaced. TRUNCATE preserves sequences; verify all 19 counts/digests, retrieval contracts and retained fingerprints before committing recovery. The representative restore verifies this typed/FK/retrieval procedure, not full production duration.

Current evidence: `backup-canonical-verification.json`, `protected-five-baseline.json`, `reader-isolation-report.json`, `preservation-guard-test.json`, `split-production-preflight.json`, and `representative-restore-report.json` under ignored `.artifacts/phase0/`. Merge into main only after approved reclamation and production verification pass; preserve unrelated work and do not force-push.

## Historical checkpoint — retained for context, superseded above

**Production reclamation is blocked. No production rows have been removed.** This checkpoint updates the historical reports; it does not authorize the reclamation SQL.

## Implemented and verified

- Dedicated branch: `phase0/reconcile-and-verify`. Original deployed MCP v29, five missing research RPC contracts and deployed Worker security controls were reconciled before changes.
- Applied [active-reader migration](supabase/migrations/20261111000133_phase0_cloudflare_active_readers.sql). Five research RPCs, passage-note lemma retrieval and corpus manifest metadata now retrieve immutable data through Cloudflare. Signatures and ACLs are preserved. The five production RPC results match captured baseline JSON exactly.
- Published Worker version `21e402c0-3da7-49b3-b3cd-f7703cca8f18`. All **1,890** deployed corpus assets match local SHA-256 and byte counts. Raw backup paths remain forbidden; verification returns hashes only. Preview URLs are disabled. Missing required source data raises an explicit error.
- An isolated PostgreSQL fixture has all **19 target tables empty and SELECT denied**. Five exact research RPC comparisons, 12 website gateway operations (including accountless note save/read/delete), five actual MCP transport tools, and required-corpus outage behavior passed. Geography and chronology also match captured live baseline JSON exactly after adding their retained fixture records. Final status: `PASS_READERS_WEBSITE_MCP_ISOLATED`.
- Current live-definition audit found **zero direct public research readers** of target data. Remaining references belong to administrative import/export, cleanup and old verification routines, not website/MCP research calls. Composite row types still exist: this is a **TRUNCATE** migration, not a DROP-table migration.
- Portable schema replay previously passed for all 19 targets and ten FK parents, including 204 constraints. A representative recovery rehearsal passed: **23 records / 14 relations**, Hebrew/Greek/LXX, encrypted restricted data and an unmapped-node source reference, with all schema foreign keys validated, indexes recreated and sequences reset. No full-data restore was performed.
- Typecheck, file size/manifest checks and production build passed. The existing large map bundle warning remains.

## Recovery blocker

[Backup verification](scripts/verify-phase0-backup-records.mjs) checked the captured **3,083,555** typed records without inserting the full datasets. All 19 row counts match. **17 table hashes match; `public.syntax_nodes` (125,010 rows) and `public.reader_rendering_groups` (98,133 rows) differ.** A focused recheck using PostgreSQL primary-key ordering confirmed both mismatches: `BACKUP_MISMATCH` in `.artifacts/phase0/backup-record-verification.json`. This rules out the initial JavaScript sorting implementation as the cause in the isolated engine; live collation and changed records still require authenticated comparison. Do not treat matching counts as complete recoverability.

The three historical encrypted archives decrypt and match their plaintext digests. Their historical key risk is explicitly accepted by the user; no new encryption system or full restoration is required. Internal recovery data is selected from the actual encrypted 983-file/60-unmapped-row archives, rather than the expanded public synthetic metadata.

The authenticated SQL connector is unavailable in the current session. Anonymous requests correctly deny raw target-table reads. Authenticated, bounded live comparisons are required to identify the cause and recover changed records where necessary; do not loosen permissions or bypass this gate.

Implementation commit `da44e41` and isolated-verification report commit `d6dd87f` are published on [the dedicated GitHub branch](https://github.com/kingdomfishers/BibleResearch/tree/phase0/reconcile-and-verify). Unrelated working-tree changes were not included.

## Scope, size and production proposal

The exact 19-table scope is exported by [phase0-storage-scope.mjs](scripts/phase0-storage-scope.mjs) and checked against [reclaim-supabase-storage.sql](scripts/reclaim-supabase-storage.sql). Retain `hebrew_lxx_word_alignments`, `versification_mappings`, `lxx_norm_word_summary`, and `macula_greekstrong_morphemes`.

Last captured size: **1,513,352,339 bytes (1,443.25 MiB)**. Target relations: **1,132,150,784 bytes (1,079.70 MiB)**. Arithmetic remainder: **381,201,555 bytes (363.54 MiB)**, a projection requiring a fresh final measurement. No storage reduction has been performed.

Proposed production operation, only after all gates pass and separate explicit approval: review and run the guarded, transactional `TRUNCATE TABLE` statement in [reclaim-supabase-storage.sql](scripts/reclaim-supabase-storage.sql), preserving schemas, canonical/dynamic tables and the four excluded relations. Current safety guards must not be bypassed. Measure actual database size and smoke-test readers afterward. Phase 0 remains incomplete until that approved operation has actually succeeded and been measured.

## Local evidence and focused commands

Detailed evidence is kept outside Git under `.artifacts/phase0/`: `deployed-chunk-integrity.json`, `live-reader-verification.json`, `reader-isolation-report.json`, `migrated-reader-audit.json`, `backup-record-verification.json`, and `representative-restore-report.json`.

These commands require the already verified source artifacts, captured schema/function definitions and local retained-data fixtures; no scratch-directory paths or production write credentials are used:

```powershell
node scripts/verify-phase0-reader-isolation.mjs --clients
node scripts/verify-phase0-backup-records.mjs --failed-only
node scripts/verify-phase0-representative-restore.mjs
```

Do not repeat successful full corpus scans or schema tests without changed inputs. Do not run the obsolete full-restoration scaffold as an additional acceptance requirement.
