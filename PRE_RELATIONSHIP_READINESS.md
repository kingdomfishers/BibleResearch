# Pre-relationship readiness

2026-11-13; branch phase0/reconcile-and-verify; Supabase ejoperxiwxlcbsqrkrvb. Two focused improvements completed. No table/column deletion, merge, RLS change, breaking API change or Cloudflare deployment.

## 1. Current architecture and boundaries

**Phase 0 is complete:** live database 382,364,819 bytes / 364.65 MiB; all 19 reclaimed relations empty; 23 release guards enabled. Five protected content hashes match [the checkpoint](PHASE_0_CHECKPOINT.md). Recovery assets and schemas remain intact; reclamation/restore was not repeated.

Cloudflare owns immutable public source evidence and deterministic indexes. Supabase owns mutable notes/preferences/reviews, research models and retained canonical lookups. SQL corpus schemas remain for recovery and compatibility; static export does not make them disposable. Keep grammatical facts separate from human/AI interpretations, restricted source fields and mutable review overlays.

Reuse native books/verses/words, disambiguated lemmas/lexemes/senses and edition/source IDs. canonical_entities has 82,485 typed wrappers, exactly one native FK each, zero unresolved wrappers and zero duplicate typed targets in this audit. Reuse these identities; spelling/base Strong's alone is not an identity. Homograph conceptual grouping must preserve distinct senses.

Use indexed relational endpoints for searchable mutable relationships; bounded JSONB for variable metadata. Do not copy the entire static grammatical graph into new SQL tables. [ARCHITECTURE.md](ARCHITECTURE.md), agent instructions and skills remain unchanged; [PROJECTMAP.md](PROJECTMAP.md) gained only the registry-test link. [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md) remains the implementation authority.

## 2. Prioritized problems and resolutions

| Priority | Evidence | Resolution |
| --- | --- | --- |
| Security | Two-argument note_validate_block_v1 lacked pinned search_path | Applied [migration](supabase/migrations/20261113170900_harden_note_block_wrapper_search_path.sql). Both overloads now pin empty search_path; body, signature, volatility, invoker security and grants unchanged. Advisor warning removed |
| Security: unresolved platform maintenance | Supabase flags security patches outstanding on Postgres 17.4.1.069 | Separate owner-approved [upgrade](https://supabase.com/docs/guides/platform/upgrading) with backup/extension review; no engine upgrade attempted |
| Security: owner review | Leaked-password protection disabled | Review [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) for every application sharing this project; authentication behavior unchanged |
| High value | Browser observed three concurrent note connection-registry requests | [notes-rpc.ts](src/api/notes-rpc.ts) shares in-flight reads without an explicit abort signal. Browser result: three calls to one; retry and independent cancellation verified |
| Investigated | Five retained BibleResearch FK-index warnings | Four already use indexes; fifth scans nine rows. No new indexes justified |
| Optional / separate ownership | 12 auth init-plan and 72 overlapping-policy findings | Findings are on protected bol_* / pages and unrelated posts / needs / offers. No notes/chronology policy duplication reported. No policy merging without separate evidence and approval |

Public save/delete/review SECURITY DEFINER note RPCs are intentional in the accountless model; do not revoke grants merely to silence warnings. Multi-user isolation remains separate work. RLS-without-policy on chronology_revisions and test_guard_probe intentionally denies public access.

## 3. Database and performance evidence

The local [per-table inventory](.artifacts/readiness/database-audit.json) covers **135 persistent relations: 116 retained plus 19 reclaimed-empty schemas**. Each entry records exact count, storage, columns/null statistics, FKs, indexes/usage, policies, triggers, source locations, reference candidates and a retention decision. Fifteen populated source-linked tables were joined to actual release metadata. [Detailed measurements/plans](.artifacts/readiness/results.json) are ignored local receipts, not mandatory agent context.

Static references are candidates, not proof of execution: dynamic SQL and external consumers can evade them. Supabase-managed schemas and unrelated application readers/writers remain under their existing owners. No absent-reference assumption authorized deletion.

Largest public allocations: words 86.2 MB, chronology_assertions 75.4 MB, chronology_assignments 34.1 MB, lexemes 28.9 MB, canonical_entities 21.2 MB (decimal). Their identity, snapshot and evidence roles differ. Storage remained **382,364,819 bytes before/after** this task's database change. Phase 0's earlier 1,131,061,248-byte reduction is not credited here.

**Indexes:** equality probes used the existing supersedes index, assignment-assertion PK prefix, assignments unique index and revisions reverse-order composite index in 0.09–0.11 ms. Some probes returned no rows; these are not bulk-deletion/cascade benchmarks. The nine-row alignment source-release scan took 0.08 ms. Other FK warnings include protected/reclaimed tables; no index churn there.

The advisor reports 80 [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). No exact structural duplicates were found. Preserve uniqueness, recovery, import, infrequent-search and publication indexes. Zero scans alone is insufficient; the per-index statistics window is unestablished, while statement statistics include pre-Phase-0 work (reset July 9).

**Empty fields/tables:** exact non-null counts are zero for canonical_entities.word_id, chronology_assertions.supersedes, words.physical_def, verses.millennium, notes.supersedes_note_id and entity_relationships.owner_user_id. Retain their identity/contract/history/ownership semantics. NULL occupancy alone proves neither redundancy nor meaningful storage savings. test_guard_probe is empty with RLS and no public grants/policies. chronology_revisions reserves history. Private b7_greek_terminal_repair_20261109 contains **956 original/corrected identity records**, postgres-only ACL; preserve provenance.

| Workflow | Trace and measurement |
| --- | --- |
| Open passage | Bounded reader, notes, map, chronology and timeline requests. Browser renders seven Hebrew tokens and expected badge; registry calls 3 to 1 |
| Inspect word | SQL reader-word merges static evidence with editable definitions; formation, heuristic candidates, lexical edges and note reads remain separate/bounded |
| Hydrated research | SQL v1 uses one translation-source batch; v2 uses translation and word-form-lemma batches, then mutable SQL hydration. Valid Genesis 1:1 analysis: v1 1,216.668 ms / 54,527 bytes; v2 6,110.723 ms / 85,551 bytes |
| Syntax | Direct Worker: Genesis Hebrew 200 / 236 ms; Ephesians Greek cross-verse tree 200 / 149 ms. Avoid a SQL detour |
| Create/retrieve notes | Existing UI/MCP adapters call validated/versioned SQL writes and passage/word/detail reads. Validator tested locally/live read-only; no real note created/deleted. Prior Phase 0 isolated accountless-write evidence reused |
| Cross-references | Direct static Worker lookup, HTTP 200 observed; evaluations stay in notes |
| Chronology/geography | Initial chronology 2,610.389 ms; later 65.914–72.593 ms. Explicit JIT on/off: identical digest, 65.914/68.891 ms; no JIT tuning justified. Geography 778.305 ms |

Timings are observations, not claimed improvements. SQL → Cloudflare → SQL hydration merges mutable preferences/definitions/research while preserving contracts; not every round trip is redundant. Two v2 batches could combine only through a new Worker operation/deployment. No such migration was justified here.

Timeline and detailed panel both compute chronology, but deferring the panel naively changes the visible badge and remembered model. Keep until a shared-packet change has behavior tests. Two reader-passage requests can serve different preview/prefetch scopes; counts alone do not prove identical payloads. Import/lookup/display normalization serves different boundaries and was not blindly consolidated.

## 4. Remaining improvements

- Schedule platform security patching separately; it is not cosmetic cleanup. Review password protection with shared-project owners.
- Profile valid multi-verse research with stable inputs, current role, provider latency and cold/warm state separated. Cumulative RPC means mix historical deployments/parameters.
- Consider shared chronology packets or a combined source batch only if measured benefit justifies coordination. Review index drops across a representative import/publication/recovery/search window, then request explicit approval.
- No table/column/graph merging or broad RLS change is recommended before R1/R2. Further cosmetic consolidation has diminishing returns.

## 5. Tables and interfaces to reuse

| Existing layer | Relationship-engine use |
| --- | --- |
| canonical_entities (82,485), lemmas (22,171), lexemes (22,719), lexical_senses (26,179), books/verses/words | Stable typed IDs plus source/edition/canonical mappings; no competing identity catalog |
| concepts (1,349), aliases/properties/external links | Conceptual grouping; not a substitute for exact lexical identity |
| research_nodes (18), assertions (7), assertion_evidence | Research lenses/reviewed claims; bridge through canonical identities, separate from grammatical facts |
| entity_relationships (15,642), relation_types | Typed source/curated edges, inverse/symmetry semantics, origin/review/provenance; preserve static-source versus mutable-overlay ownership |
| notes (204), anchors/connections/revisions | Human/AI evaluations and history; existing native anchor kinds and stable relationship references in metadata |
| [relationship builder](scripts/build-relationship-slice.mjs), [Worker gateway](scripts/corpus-relationships-rpc.mjs), [RelationshipsRPC](src/api/relationships-rpc.ts) | Versioned deterministic assets and bounded queries; extend existing interfaces |

## 6. Verification and limits

- Pass: isolated validator parity under changed caller search_path; live anonymous valid/invalid/unsafe-URL results unchanged; both overloads pinned, ACL unchanged, warning gone.
- Pass: five-table content SHA-256 and fresh column/constraint/index/trigger/RLS/policy/privilege snapshots unchanged before/after; content matches Phase 0 baseline. No other application rows modified by optimization.
- Pass: [registry regression](scripts/verify-notes-connection-types.mjs): concurrency, cache, outage retry and cancellation independence; browser confirms 3 to 1 requests, expected tokens/badge, no page errors.
- Pass: typecheck, build, advisory structure review and intended diff/link checks. Existing MapLibre large-chunk warning remains. No obsolete workflow rules restored.
- Pass: Worker health, raw-asset denial (403), Hebrew/Greek syntax; deployed MCP v29 ACTIVE. Full 1,890-asset/recovery evidence reused from unchanged Phase 0, not freshly rerun. No write-contract/body change requiring full live write journeys.
- Performance figures use valid read-only requests. An exploratory v2 include_notes request was rejected as invalid and is excluded. No speculative server-setting change followed the cold/warm timing difference.
- Existing port 3000 failed to mount in a fresh browser trace; separate current-checkout Vite on 3101 passed. MCP Playwright lacked Chrome; installed Edge/playwright-core supplied verification. No install or unrelated server shutdown.

## 7. GO / NO-GO

**GO for R1 reuse/licensing audit and the offline R2 extractor pilot.** Phase 0, canonical identity integrity, graph reuse and evidence/interpretation boundaries are established. Pin upstream rights and exact Macula edition/source IDs; retain roadmap negative controls and uncertainty rules.

**Not a production-release approval.** Outstanding platform security patches need a separate maintenance decision. No destructive schema, major RLS, authentication or breaking API change is authorized. Optimization stops here.
