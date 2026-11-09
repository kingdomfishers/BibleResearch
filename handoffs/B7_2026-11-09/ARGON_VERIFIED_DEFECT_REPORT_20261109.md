# BibleResearch — independently verified Argon findings and direct repairs
Date: 2026-11-09. Environment: Supabase `ejoperxiwxlcbsqrkrvb`, Cloudflare Worker `bibleresearch-corpus`.
The authoritative developer files remain LOCAL in `C:\Projects\BibleResearch`. This GitHub branch is a handoff, not an edit to the local workspace or production branch.

## Status and evidence
| Issue | Live evidence | Current status |
| --- | --- | --- |
| G1 Greek Macula syntax terminal identity | 956 mismatches across 14,926 same-edition/XML-ID matching terminal/token pairs, same canonical verse. 892 tokens with exact-form STEP mappings; 64 unmatched tokens. | **Fixed in Supabase**, migration `b7_reconcile_greek_syntax_terminals_to_source_xml_tokens_20261109` (20261109182111). 956 originals preserved in `bible_internal.b7_greek_terminal_repair_20261109`. Postcheck: 0 mismatches. DO NOT reapply blindly. Cloudflare and local static evidence not yet rebuilt. |
| G2 Hebrew Macula morphemes assigned to different STEP words inside the same source word | 1,917 groups keyed by `book,chapter_mt,verse_mt,word_no` have >1 nonnull word ID, involving 4,391 morpheme rows (4,387 with nonnull word IDs). Argon separately reported 2,286 mislinks. | **Confirmed inconsistency; exact 2,286 independent classification remains unproven.** Needs source-based word reconstruction and philological comparison, not majority-vote reassignment. |
| G3 Wrong canonical verse IDs on title/body split cases | Argon reported 777 wrong canonical verse IDs, e.g. short-heading Psalms. Current explicit MT crosswalk has 2,085 used shifted source references, with **zero** disagreement between current assignments and their registered mappings; 0 MT source groups currently assigned multiple canonical verse IDs. | **UNRESOLVED**: A consistent incorrect crosswalk can pass structural checks. Reconstruct original title/body word spans against STEP title/body evidence. Do not declare 777 proven/corrected merely from matching IDs. |
| G4 Cloudflare old B7 corpus | Production `/__integrity/b7` HTTP 503 FAIL: token `19AxB` expected Psalm 3:0 word 88044, and `01SDx` expected Genesis 31:55 word 138884; both absent from correct deployed verse. | **FAIL**. Worker code safeguards are deployed, but Static Assets were not rebuilt. |
| G5 Septuagint unavailable target units | `hebrew_lxx_verse_map` contains 45 target units missing from stored `lxx_swete_words`, including 31 Nehemiah/Esdras B. | **UNRESOLVED**. Distinguish genuinely unavailable source verses, wrong chapter offset, text variant, and mis-mapped source. |
| G6 Public note-writing RPCs | `save_note_v1`, `delete_note_v1`, `set_note_review_v1` are currently callable by `anon` and `authenticated`. | **INTENTIONAL TEMPORARY USER REQUIREMENT. DO NOT REVOKE.** User explicitly requested an unrestricted note system until account creation exists. This exposes edits/deletes to anyone who can call the endpoint; account-level ownership and abuse controls still needed later. |
| G7 One published test note | 1 published note with `[TEST]` in title/body among 4 published notes (198 total). | **UNTOUCHED** pending provenance review; do not delete user data automatically. |
| G8 Stage G recovery | 23 `stage_g_release_gate` TRUNCATE triggers remain; database size 1,513,024,659 bytes (~1,443 decimal MB); full 23-table isolated restore never independently demonstrated. | **FAIL; no production truncation or release-lock removal.** |

## Direct action performed in this turn
Applied Supabase migration `b7_reconcile_greek_syntax_terminals_to_source_xml_tokens_20261109` (migration version 20261109182111). Its exact SQL is stored in `B7_GREEK_TERMINAL_PRODUCTION_MIGRATION.sql`. Preflight required: exact source-edition/XML-ID match, same canonical verse, unique pairing, source status `exact_form` when word ID available or `unmatched` when null, and word membership in canonical verse. All 956 original node IDs and old/new values backed up before a single atomic update. Updated 892 supported links and cleared 64 unsupported stale links. Postcheck: 0 mismatches in 14,926 paired terminals. `70` source-matched Greek terminals now legitimately have NULL STEP word IDs.

This corrects a **source-record consistency defect**; it does not independently verify every textual association. Do not conflate absence of this mismatch with total linguistic correctness.

## Cloudflare state — deliberately unchanged in this turn
Sole deployed Worker version `dc01ca7e-34ee-424f-aff9-c453352a3d97`, deployment `abb2278a-8671-4839-96e6-69c16a529369`; raw-shard blocking, restricted-field sanitization, CORS handling, and B7 diagnostics remain. No static shard was overwritten or deployed because rebuilding from the pinned LOCAL source corpus is required. A secure Worker alone does not make stale B7 mappings correct.

## Do not regress
1. **Local is authoritative:** inspect `git status` and task-139 Antigravity output before any edits. This branch may be behind LOCAL edits.
2. Reconcile the Supabase migration into LOCAL migration history; avoid duplicate production changes. The private backup table permits targeted rollback if needed.
3. Preserve user's anonymous note-writing access until an account system is created, despite security risks. Warn user; do not silently revoke it.
4. No majority-vote Hebrew repairs or artificial word alignments. Prefer explicit `unresolved` when evidence is insufficient.
5. No Stage G deletion. Do not remove 23 table locks. Do not publish restricted fields or deploy an empty/partial corpus.
6. After a fully verified rebuild, test `/__integrity/b7` and all generated/deployed asset hashes; two canaries are necessary but not sufficient.

See `ARGON_FOCUSED_REPAIR_PROMPT.md` and `ARGON_UPDATED_READONLY_RECHECKS.sql`.
