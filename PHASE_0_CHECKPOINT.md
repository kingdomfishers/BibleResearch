# Phase 0 checkpoint — 2026-11-13

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

[Backup verification](scripts/verify-phase0-backup-records.mjs) checked the captured **3,083,555** typed records without inserting the full datasets. All 19 row counts match. Initially 17 table hashes matched; `public.syntax_nodes` and `public.reader_rendering_groups` differed. A focused PostgreSQL-ordering recheck is recorded in `.artifacts/phase0/backup-record-verification.json`; do not treat matching counts as complete recoverability.

The three historical encrypted archives decrypt and match their plaintext digests. Their historical key risk is explicitly accepted by the user; no new encryption system or full restoration is required. Internal recovery data is selected from the actual encrypted 983-file/60-unmapped-row archives, rather than the expanded public synthetic metadata.

The authenticated SQL connector is unavailable in the current session. Anonymous requests correctly deny raw target-table reads. If digest differences persist after the ordering recheck, authenticated, bounded live comparisons are required to identify and recover changed records; do not loosen permissions or bypass this gate.

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
