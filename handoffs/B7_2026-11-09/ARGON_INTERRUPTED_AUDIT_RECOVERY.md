## STATUS UPDATE 2026-11-09 (supersedes historical counts below)

The earlier snapshot below is **historical** and is superseded by [ARGON_VERIFIED_DEFECT_REPORT_20261109.md](ARGON_VERIFIED_DEFECT_REPORT_20261109.md). Since that snapshot, the user explicitly instructed that note-writing remain anonymously accessible until accounts exist; anonymous permissions have been restored. Also, a guarded Supabase migration repaired all 956 Greek syntax vs source-token mismatches (892 exact-form links updated, 64 unsupported links cleared; 956 old links privately backed up). Current Greek cross-table mismatches: **0**. Do not follow the older recommendation below to revoke note access or expect 956 live Greek mismatches.

# Argon interruption recovery checkpoint — 2026-11-09

## Purpose

Gemini Argon High ran out of quota and halted while waiting for its background verification `task-139`. Preserve its LOCAL workspace changes, Antigravity conversation history, task logs, terminal outputs, and temporary artifacts before starting a new agent. GitHub remains a handoff/backup copy; **the local working directory `C:\Projects\BibleResearch` remains authoritative.**

## Claims in Argon's last message and independently rechecked live Supabase findings

| Claim | Result |
|---|---|
| 956 stale Greek syntax terminals | **CONFIRMED EXACTLY**: 956/14,926 Macula Greek syntax terminals differ from matching `macula_greek_tokens.step_word_id` on `edition_id + terminal_xml_id`: 823 unequal non-null word IDs, 69 syntax NULL/source non-NULL, 64 syntax non-NULL/source NULL. Canonical verse IDs agree in the joined rows. |
| Mis-linked sibling Hebrew morphemes (Argon: 2,286) | **ISSUE CONFIRMED, EXACT COUNT NOT YET REPRODUCED.** Group by `book,chapter_mt,verse_mt,word_no`: 1,917 groups have more than one non-null `word_id`, involving 4,391 morphemes (4,387 with non-null IDs). This is suspicious, but each group still needs an evidence-based alignment check; do NOT choose the plurality mechanically. |
| 777 wrong canonical verse IDs on multi-target MT verses | **NOT YET INDEPENDENTLY REPRODUCED.** Basic grouping of Macula `book,chapter_mt,verse_mt` has no group with multiple current canonical IDs, which does not disprove incorrect IDs on verse splits/short Psalm headings. Need Argon's original SQL and source-based oracle. |
| Anonymous `SECURITY DEFINER` RPCs | **CONFIRMED, NOW RE-RESTRICTED**: functions `save_note_v1(jsonb)`, `delete_note_v1(uuid,integer)`, `set_note_review_v1(uuid,text)` were again granted EXECUTE to `anon` and `authenticated`. Applied migration `resecure_legacy_note_authorization_after_argon_acl_regression_20261109`. Verified `anon=false`, `authenticated=false`, `service_role=true` on each. Do not regrant until a verified owner-auth mechanism exists. |
| Orphaned published `[TEST]` note | **CONFIRMED one published test-labeled note** among 198 total notes, 4 published. Not deleted or modified; requires authorization-aware cleanup after checking note anchors, history, and provenance. |
| Deployed B7 canonical mapping | **FAIL**: Supabase `bible_internal.verify_b7_deployed_canaries_v1()` still fails `19AxB` Psalm 3:0 and `01SDx` Genesis 31:55. |
| Cloudflare version | Sole live Worker version `dc01ca7e-34ee-424f-aff9-c453352a3d97`, deployment `abb2278a-8671-4839-96e6-69c16a529369`. It contains B7 canaries, restricted-field sanitization and CORS fix, but the static corpus assets still have stale alignment. |
| GitHub `main` | Still `57ec14f5019706942d6722995b3d3d708930ed88` at time of audit. Argon's local modifications have NOT been verified against the local filesystem; do NOT assume they were pushed. |
| Supabase database size | Approx 1,443 MB; Stage G still NOT cleared for deletion. |

### Important caveat

Independent checks based on foreign keys, exact source identifiers, and normalized text have different evidentiary strengths. The Greek mismatch check is a clear inconsistency between two live representations but does not prove which of the two word IDs is historically correct. Fixes must be derived from the independent pinned corpus, not copied blindly.

### Recover the halted Antigravity work without credits

1. Open the original **BibleResearch** workspace and Argon conversation in Agent Manager or Antigravity's conversation history/search. Do not delete the conversation or clear workspace state.
2. Inspect the background agent/task list for `task-139`. Open its saved logs/output, even if it stopped. The task was assigned MorphHB, TAGNT, Macula Greek, and Swete verification. This output is the highest-value missing evidence.
3. Preserve local `git status --short`, `git diff --stat`, relevant modified files, scripts, query logs, and task/artifact files. Antigravity session state and local uncommitted files are separate from GitHub.
4. If available, export or copy the original Argon conversation's command outputs/SQL into a local report; do not ask another model to rerun all 4 source audits blindly.
5. Use `ARGON_READONLY_RECHECKS.sql` from this folder for focused, deterministic remote rechecks. No production database mutation.

### Before resuming with an AI agent

- First locate Argon's original verification scripts and SQL; do not infer its method solely from the last paragraph.
- Distinguish *confirmed discrepancies* from *possible error counts*.
- Stage corrections in the authoritative local checkout and independent isolated test data; never mass-update production IDs using majority vote or self-validation.
- Keep all 23 production TRUNCATE locks and verified backups; do not execute Stage G.
- After a mapping rebuild, independently verify all assets and the live `/__integrity/b7` response. `PASS_CANARIES` is necessary but not sufficient.

This checkpoint was produced from direct read-only queries of the live Supabase project, not from the unavailable local task-139 log.
