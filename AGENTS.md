# BibleResearch development contract

## Scope and safety

Work from the local checkout. Inspect Git status and branch first; preserve unrelated work. Make one cohesive change at a time. Aim for 1?5 implementation files including relevant tests. Before exceeding about eight files, check for unnecessary refactoring, formatting, generated tests, or documentation churn. Explain genuine dependencies and keep the larger scope justified.

**Direct Live Development Policy:** BibleResearch uses direct live development. Ordinary changes follow this cycle:
1. Implement.
2. Run focused tests.
3. Deploy directly to the main Cloudflare Worker (`bibleresearch-corpus`, `bibleresearch`) and/or main MCP (`bible-mcp`).
4. Verify the actual live functionality.
5. Commit, push and record the deployment.
6. Continue development.

No mandatory staging cycle, extensive release ceremony, or exhaustive benchmark is required before every deployment. Routine production deployments are authorized; historical no-deployment restrictions are superseded for ordinary development. Still require separate explicit authorization for destructive database operations, deletion of unique data, recovery/reclamation operations, security/permission changes, or paid infrastructure modifications. Applied migrations, existing notes, source datasets, recovery archives, provenance, license notices, and previous deployment versions remain protected. Do not treat an old filename as evidence that a file is disposable.

## Find ? Understand ? Change

Read and apply [pre-code](.agents/skills/pre-code/SKILL.md) before edits in src/ or supabase/. Use [PROJECTMAP](PROJECTMAP.md) only to locate relevant files. Read headers, section anchors and immediate dependencies; search for existing functionality before adding it. Load [architecture](ARCHITECTURE.md) or specialized designs only when relevant. Consult [TASKS](TASKS.md) when working on its active objective; small requests need no new queue entries.

Use Context7 for current library, SDK, API, CLI or cloud-service documentation: resolve the library ID, then query the specific concept. General programming, business logic, code review and refactoring do not require library documentation.

## Boundaries

Vanilla TypeScript + Vite and CSS; MapLibre for maps. UI uses BibleRPC through src/api/rpc.ts and its existing adapters. Only src/api/supabase.ts initializes/imports the Supabase client. Components communicate through state or explicit callbacks.

Cloudflare serves immutable public corpus evidence and precomputed indexes; Supabase owns dynamic notes, private preferences, research/review state and retained canonical lookups. Follow the existing operation routing in src/api/corpus-client.ts, the Worker and MCP adapter. Corpus retrieval/computation belongs in the appropriate gateway, Worker, build pipeline or SQL RPC, not full-corpus browser scans. Dynamic validation, permissions and writes remain server-enforced. Do not move all corpus computation to PostgreSQL.

Preserve original-language identities, canonical/edition mappings, provenance, restricted-field controls and recovery guarantees. Keep source evidence distinct from interpretations and heuristic candidates.

## Navigation and module size

Keep useful existing @section anchors; use targeted rg searches. Six-line manifests, @tables, @candidates and exact @toc synchronization are optional legacy metadata. Keep metadata accurate if maintained; do not touch other files to refresh it. New modules need a clear responsibility, not a metadata template. No hard file/section line caps: prefer cohesion; split only when it improves comprehension or reuse. A second use alone does not require extraction.

## Verify ? Record ? Finish

Apply [post-code](.agents/skills/post-code/SKILL.md). Available commands: npm run dev, npm run check:types, npm run build, npm run check:size (advisory structure review); check:lines is an alias. On Windows use npm.cmd if PowerShell blocks npm.ps1.

There is no generic test:run command. Inspect a relevant script's runtime, prerequisites and side effects before running it directly. Some verification scripts access or mutate live services. Run focused local checks (`npm.cmd run check:types`, `npm.cmd run build`, targeted verifiers) first, then deploy ordinary changes directly to the main production services (`bibleresearch-corpus`, `bibleresearch`, `bible-mcp`), verify the actual live endpoints, and commit, push, and record the deployment. Update documentation only when its content changes, PROJECTMAP only for responsibility/location/entry-point changes, and the queue only for relevant progress. Stage explicit intended paths; never use broad staging in a dirty checkout.

## Local & Production Supabase Workflow

- **Why legacy migrations are bypassed locally:** Pre-`20261126` files in `supabase/migrations/` contain out-of-order historical timestamps and pre-Cloudflare reclamation DDL drift. Never modify, delete, or reorder already-applied production migration files, and never run `supabase db push` blindly against historical drift.
- **Reproducible local database (`supabase/local/`):** `supabase/config.toml` sets `[db.migrations] enabled = false` and uses `[db.seed]` to load `supabase/local/00_extensions.sql`, `supabase/local/00_production_schema.sql` (production DDL snapshot, zero corpus data), `supabase/local/01_minimal_seed.sql` (lightweight reference tables + ~49 representative test passages), and `./migrations/20261126*.sql`.
- **Daily schema workflow:** Author additive, reversible SQL migrations as `supabase/migrations/20261126HHMMSS_<name>.sql` -> test locally with `npx.cmd supabase db reset --local` (or `npx.cmd supabase start`) -> run RLS/security checks and `npx.cmd supabase db advisors --local` -> apply verified non-destructive migrations to production (`ejoperxiwxlcbsqrkrvb`) via Supabase MCP `apply_migration`.
