# BibleResearch: static corpus / mutable research separation

## State and safety boundary

This change prepares **a new, separate Cloudflare Workers Static Assets service** (`bibleresearch-corpus`) for *immutable public source-evidence tables*. It **does not** replace the existing `bibleresearch` website, switch any existing RPC, delete any Supabase table, or claim that a migration is complete. The GitHub workflow is **manual only** and needs secrets configured before it can run. Never remove a database table based only on successful static export.

**Keep in Supabase:** identities and authentication; private notes; changing lexical definitions and translations; scholarly interpretations and edits; chronology models, runs and assertions; sourced relationship assertions, review states, custom mappings, and every table still required by an active SQL function. Do not export private or writable tables.

**Export as read-only static data (initial approved evidence allowlist):** `macula_hebrew_morphemes`, `macula_greek_tokens`, `morphhb_tokens`, `lxx_swete_words`, `tagnt_tokens`, `syntax_nodes`, `syntax_edges`, `verse_translation_sources`, `word_form_lemmas`. These datasets are public reference material, not user content. Check the `DATA_SOURCES.md` redistribution notices whenever expanding the allowlist; preserve the accompanying upstream notices. Greek Macula `domain`/`ln` full copyrighted dictionary prose is **not** included as a new field in this export. Do not export unreviewed or restricted data by adding another table name.

## Data model and distribution

The exporter produces `manifest.json` and `*.jsonl.gz` files under the git-ignored `.artifacts/static-corpus/` directory. The manifest records full table column types and primary keys, row and shard counts, chunk boundaries (book/chapter where available), compressed/uncompressed SHA-256 hashes, and source notices. It serializes unmodified PostgreSQL `row_to_json(t)` for every record, preserving original identifiers and explicit nulls. SQL reads use a server-side cursor; large tables are not materialized in process RAM. Files are capped at 8 MiB uncompressed, well under Cloudflare's 25 MiB per-file allowance. The verifier checks the hashes, row counts, JSON validity, paths and unexpected files.

A page request to a corpus shard is an immutable public file read. This **does not implement SQL joins, inference, research writes, search ranking, user authentication, or the existing Supabase RPCs**. Cloudflare Static Assets is not a PostgreSQL replacement. Future indexed, bounded read endpoints must be implemented and contract-tested before database reference tables can be dropped.

## Deployment: opt-in, isolated from production

1. Configure `SUPABASE_DATABASE_URL` as an Actions repository secret containing a **read-only-capable PostgreSQL connection URI**, preferably a dedicated SELECT-only database role; its use inside the export transaction is explicitly READ ONLY. Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets, scoped to the separate corpus Worker and deployment as narrowly as practical. **Do not commit connection secrets or add them to `VITE_` variables.**
2. Merge the implementation PR after review. Run the **Publish read-only BibleResearch corpus (isolated Worker)** workflow manually (`workflow_dispatch`). It streams and verifies each whitelisted public table and deploys **only** `wrangler.corpus.jsonc`, creating/updating `bibleresearch-corpus`, not `bibleresearch`.
3. Verify `https://<your-corpus-worker>.workers.dev/manifest.json` returns the expected corpus manifest. Run `CORPUS_PUBLIC_URL=https://<your-corpus-worker>.workers.dev node scripts/verify-static-corpus-remote.mjs --all` using the local export to verify **every** remote shard. The lighter version without `--all` checks one shard per table.
4. Record the exact manifest hash and release identity. Confirm the worker's `/manifest.json`, sample book/chapter shards, and unknown-path 404 responses. Ensure generated assets are excluded from the source repository and that the Workers deployment stays within Free limits: at most 20,000 assets per Worker version and at most 25 MiB each. The exporter refuses more than 19,000 shards.

### Required cutover gates before removing Supabase data

- Classify all SQL, PostgREST, MCP, reader and Edge Function dependents for **each** candidate source table; add bounded static corpus query indexes and versioned APIs that reproduce their responses, including provenance, edition identity, cross-verse syntax links and pagination.
- Migrate every caller, including `bible-mcp`, not just the browser UI. Keep mutable overlays and definitions in Supabase; layer them on top of static source evidence by stable, versioned IDs. When queries need relationships between immutable data and mutable records, implement those joins explicitly in the read service and test against the old RPC.
- Verify per-book/edition coverage, all 983 Macula source files (only 94 had been imported at the time of this plan), missing/noncanonical source nodes, source-hash reproducibility and no fabricated verse mappings. An exported copy of a **partial** tree import remains partial.
- Build replayable golden-case comparison tests for verse rendering, morphology, Greek/Hebrew alignments, complete syntax hierarchy and cross-verse spans, lexical relationships, translations, chronology, notes and authorization. Validate zero mismatches **before** deleting a table.
- Take an independent, restorable database backup and demonstrate restore. Disable obsolete ingestion jobs before cutover. Drop migrated tables only after the app, MCP, and research workflows are independently verified on the new backend and you can roll back.
- After database cleanup, measure `pg_database_size(current_database())`; target **under 400 MB**, with enough headroom under Supabase's 500 MB Free database size cap. Deleting row contents may not immediately reclaim disk; plan safe actual reclamation separately.

## Developer quick checks

```
python scripts/test-static-corpus.py -v
python -m pip install 'psycopg[binary]>=3,<4'
export SUPABASE_DATABASE_URL='postgresql://...'
python scripts/export-static-corpus.py
python scripts/verify-static-corpus.py
npx wrangler deploy --dry-run --config wrangler.corpus.jsonc
npx wrangler deploy --config wrangler.corpus.jsonc
export CORPUS_PUBLIC_URL='https://...workers.dev'
node scripts/verify-static-corpus-remote.mjs --all
```

The initial workflow does **not** claim to free Supabase space: this requires the next, separately verified read-path cutover and removal. It ensures there is a reproducible, checksum-verified public corpus distribution to build that migration against.