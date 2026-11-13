# BibleResearch development contract

## Scope and safety

Work from the local checkout. Inspect Git status and branch first; preserve unrelated work. Make one cohesive change at a time. Aim for 1?5 implementation files including relevant tests. Before exceeding about eight files, check for unnecessary refactoring, formatting, generated tests, or documentation churn. Explain genuine dependencies and keep the larger scope justified.

Never deploy, change production data, or execute recovery/reclamation operations without explicit authorization. Applied migrations, source datasets, recovery archives, provenance and license notices are protected. Do not treat an old filename as evidence that a file is disposable.

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

There is no generic test:run command. Inspect a relevant script's runtime, prerequisites and side effects before running it directly. Some verification scripts access or mutate live services. Run local targeted checks first; broader tests require interface/risk justification. Update documentation only when its content changes, PROJECTMAP only for responsibility/location/entry-point changes, and the queue only for relevant progress. Stage explicit intended paths; never use broad staging in a dirty checkout.
