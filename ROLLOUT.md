# ROLLOUT.md — Additive Migration, Cutover & Rollback Runbook

Updated: 2026-11-01.

## 1. Additive Rollout Invariants

1. **Zero Destructive Overwrites:** `public.words` (`150,105` forms) and `public.verses` (`31,203` passages, `443,524` ordered tokens) remain untouched and hash-verified via `node scripts/verify-bible-import.mjs`.
2. **Legacy Prompt Compatibility:** `prompt_verse_words`, `prompt_word_occurrences`, `prompt_word_cooccurrences`, `prompt_word_relationships`, and `resolve_word_id` preserve their exact parameter names, return table schemas, and base-Strong's grouping behavior.
3. **Versioned Context & Research RPCs:**
   - Chronology: `public.get_verse_chronology_v1` (pinned-run snapshots via `chronology_runs`).
   - Geography: `public.get_verse_geography` and alias `public."getVerseGeography"`.
   - Relationship Research: `public.research_relationships_v1` (reviewed-only RLS via `review_status = 'reviewed'`).

## 2. Verification & Shadow Comparison Suite

Run the full verification pipeline before and after any schema, RPC, or Edge Function update:

```powershell
node scripts/verify-bible-import.mjs
node scripts/verify-chronology-rollout.mjs
node scripts/verify-geography-rpc.mjs
node scripts/verify-research-rpc.mjs
node scripts/verify-openapi.mjs
node scripts/verify-bible-mcp.mjs
npm.cmd run check:types
npm.cmd run check:size
npm.cmd run build
```

## 3. Rollback Procedures

- **Chronology Model Run Rollback:** Re-point `chronology_models.active_run_id` to the prior immutable `chronology_runs.id` snapshot; previous cursors remain valid.
- **Relationship Assertions Rollback:** Set `assertions.review_status = 'candidate'` or `'rejected'` on any newly promoted assertion key; RLS immediately hides non-`reviewed` rows from `anon` and `authenticated` callers.
- **Edge Function Rollback:** Redeploy `bible-mcp` via `supabase_mcp` `deploy_edge_function` with `verify_jwt: false`.
