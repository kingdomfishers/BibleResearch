# Project navigation

Use this index to locate code, then search the relevant paths with rg. Read a file's header and @section anchors before expanding context. This is not an API inventory. Update only when a responsibility, location or important entry point changes.

## Application and Bible reader

| Responsibility | Entry points / navigation |
| --- | --- |
| Shell and feature wiring | [src/main.ts](src/main.ts): ui:main, logic:selection, logic:passage |
| Passage and URL state | [src/ui/state.ts](src/ui/state.ts): logic:passage, logic:store |
| Navigation and search | [NavSelector.ts](src/ui/components/NavSelector.ts), [StudySearch.ts](src/ui/components/StudySearch.ts) |
| Original-language tokens and passage rendering | [VerseReader.ts](src/ui/components/VerseReader.ts): ui:tokens, ui:main, logic:context |
| Occurrence translation selection | [TranslationChoice.ts](src/ui/components/TranslationChoice.ts): translationLabel, createTranslationChoice, logic:save; [WordRenderingRange.ts](src/ui/components/WordRenderingRange.ts); [design](WORD_TRANSLATION_DESIGN.md) |
| Reader context and comparison | [ContextPreview.ts](src/ui/components/ContextPreview.ts), [PassageComparison.ts](src/ui/components/PassageComparison.ts) |
| Styling | [styles.css](src/ui/styles.css) imports feature styles in src/ui/styles-*.css |

## Word inspector and research

| Responsibility | Entry points / navigation |
| --- | --- |
| Word focus and modal | [WordInspector.ts](src/ui/components/WordInspector.ts): createWordInspector, logic:inspect, logic:page; [WordModal.ts](src/ui/components/WordModal.ts) |
| Formation and lexical evidence | [WordFormation.ts](src/ui/components/WordFormation.ts); matching *-types.ts in [src/api/](src/api/) |
| Hydrated packets and research | [HydratedResearch.ts](src/ui/components/HydratedResearch.ts), [ResearchPanel.ts](src/ui/components/ResearchPanel.ts); [RESEARCH_API.md](RESEARCH_API.md) |
| Shared presentation | [utils.ts](src/ui/utils.ts), [study-dom.ts](src/ui/study-dom.ts); search before adding helpers |
| Prompt construction | [src/core/prompts.ts](src/core/prompts.ts), [src/core/types.ts](src/core/types.ts) |

## Notes

- State and safe markdown: [notes-state.ts](src/ui/notes-state.ts), [note-markdown.ts](src/ui/note-markdown.ts).
- Passage/word integration: [NotesPanel.ts](src/ui/components/NotesPanel.ts) (createNotesPanel, logic:load), [WordNotes.ts](src/ui/components/WordNotes.ts).
- Editing: [NoteEditor.ts](src/ui/components/NoteEditor.ts), [NoteEditorModel.ts](src/ui/components/NoteEditorModel.ts), [TargetPicker.ts](src/ui/components/TargetPicker.ts), [ConnectionBuilder.ts](src/ui/components/ConnectionBuilder.ts).
- Display and browsing: [NoteCard.ts](src/ui/components/NoteCard.ts), [NoteBlocks.ts](src/ui/components/NoteBlocks.ts), [NotesBrowser.ts](src/ui/components/NotesBrowser.ts).
- Transport/contracts: [notes-rpc.ts](src/api/notes-rpc.ts) (logic:transport, logic:writes), [notes-types.ts](src/api/notes-types.ts), [notes-api-types.ts](src/api/notes-api-types.ts). Detailed model: [DATA_MODEL.md](DATA_MODEL.md).
- Research Knowledge Graph: [research-graph-rpc.ts](src/api/research-graph-rpc.ts), [research-graph-types.ts](src/api/research-graph-types.ts), [ResearchGraphPanel.ts](src/ui/components/ResearchGraphPanel.ts), [ClaimComposerDialog.ts](src/ui/components/ClaimComposerDialog.ts), [styles-research-graph.css](src/ui/styles-research-graph.css); integrated in [DiscoveryGraph.ts](src/ui/components/DiscoveryGraph.ts), [WordInspector.ts](src/ui/components/WordInspector.ts), [QuickNoteComposer.ts](src/ui/components/QuickNoteComposer.ts), [src/main.ts](src/main.ts). Spec: [RESEARCH_KNOWLEDGE_GRAPH.md](RESEARCH_KNOWLEDGE_GRAPH.md).

## Relationships

- R12 local baseline: [verify-r12-discovery.mjs](scripts/verify-r12-discovery.mjs) (`--suite baseline`), [r12-evidence.mjs](scripts/r12-evidence.mjs) (streamed source inventory and validation); frozen inputs and run reports under `.artifacts-r12/`. No corpus generation or service access.
- R12 local Worker profiling: [verify-r12-worker.mjs](scripts/verify-r12-worker.mjs) (`--mode baseline`, synthetic `--mode self-test`, or candidate `--mode acceptance --phase d1`), opt-in request counters in [corpus-worker.mjs](scripts/corpus-worker.mjs). Uses read-only pinned assets and blocked outbound networking. Optional isolated runtime: `npm.cmd install --prefix .artifacts-r12/tooling --save-exact --ignore-scripts --no-audit --no-fund workerd@1.20261116.1`; the runner records the selected executable/lock hashes without changing shared dependencies. Invalid/missing CPU samples are retained as BLOCKED, never zero; concurrent CPU attribution remains BLOCKED.
- R12 candidate reliability: [verify-r12-discovery.mjs](scripts/verify-r12-discovery.mjs) `--suite reliability` delegates to [verify-r12-reliability.mjs](scripts/verify-r12-reliability.mjs). [prepare-r11-fast-assets.mjs](scripts/prepare-r11-fast-assets.mjs) requires `--input RELEASE_DIRECTORY --output NEW_CANDIDATE_DIRECTORY`; original releases stay intact, while the candidate replaces redundant derived layouts with bounded keyed pages. Passing parity publishes only a local candidate pointer; Worker CPU/resource acceptance remains a separate gate.
- Universal discovery: [DiscoverConnections.ts](src/ui/components/DiscoverConnections.ts), [r10-discovery.ts](src/relationships/r10-discovery.ts); derived lookup repair [repair-r11-lookup.mjs](scripts/repair-r11-lookup.mjs), fast runtime shards [prepare-r11-fast-assets.mjs](scripts/prepare-r11-fast-assets.mjs), deployment bundle [prepare-r10-asset-deploy.mjs](scripts/prepare-r10-asset-deploy.mjs). Recovery and verification: [R11_RECOVERY_STATUS.md](R11_RECOVERY_STATUS.md).
- UI: [RelationshipExplorer.ts](src/ui/components/RelationshipExplorer.ts), [LexicalRelationshipsSection.ts](src/ui/components/LexicalRelationshipsSection.ts), [GrammaticalRelationshipsPanel.ts](src/ui/components/GrammaticalRelationshipsPanel.ts), [PassageCrossReferences.ts](src/ui/components/PassageCrossReferences.ts).
- Gateway/identity: [relationships-rpc.ts](src/api/relationships-rpc.ts), [relationship-model.ts](src/api/relationship-model.ts) (logic:identity, logic:dedup-xrefs, logic:dedup-lexical), [relationship-notes-adapter.ts](src/api/relationship-notes-adapter.ts).
- Static operations: [corpus-relationships-rpc.mjs](scripts/corpus-relationships-rpc.mjs); R5 staging & verification: [stage-r5-relationship-graph.mjs](scripts/stage-r5-relationship-graph.mjs), [verify-r5-r6-e2e.mjs](scripts/verify-r5-r6-e2e.mjs); pilot generation: [build-relationship-slice.mjs](scripts/build-relationship-slice.mjs).
- Design versus implemented scope: [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md), [TASKS.md](TASKS.md). Do not infer deployment from a proposal.

## Corpus gateway, Supabase and Cloudflare

- Browser gateway: [rpc.ts](src/api/rpc.ts), especially logic:request, logic:reader, logic:corpus-lookups, logic:gateway. Shared contracts start at [types.ts](src/api/types.ts).
- Static routing/cache: [corpus-client.ts](src/api/corpus-client.ts), isStaticCorpusRpc, logic:registry, logic:client (routes heavy discovery/subgraph RPCs to Supabase Edge `DISCOVERY_BASE_URL` and fast/static/`*_v3` RPCs to `CORPUS_BASE_URL`).
- Supabase initialization/auth: [supabase.ts](src/api/supabase.ts). SQL contracts/history: [supabase/migrations/](supabase/migrations/); locate the latest relevant function definition with rg rather than loading every migration.
- REST contract: [supabase/openapi.json](supabase/openapi.json).
- Worker entry: [corpus-worker.mjs](scripts/corpus-worker.mjs); restricted fields: [corpus-security.mjs](scripts/corpus-security.mjs); config: [wrangler.corpus.jsonc](wrangler.corpus.jsonc).
- R12 staging increment: [prepare-r12-increment.mjs](scripts/prepare-r12-increment.mjs) attaches token-verified grammatical witnesses and packs derived records; [relationship-shard-codec.mjs](scripts/relationship-shard-codec.mjs) reads the compact layouts. [verify-r12-increment.mjs](scripts/verify-r12-increment.mjs) compares the frozen discovery baseline; [verify-r12-staging-live.mjs](scripts/verify-r12-staging-live.mjs) runs read-only concurrent staging and MCP checks.
- Boundary/runbook: [ARCHITECTURE.md](ARCHITECTURE.md), [STATIC_CORPUS_MIGRATION.md](STATIC_CORPUS_MIGRATION.md).

## MCP and integrations

- Transport/database reader & shared discovery HTTP RPC: [index.ts](supabase/functions/bible-mcp/index.ts), createApp, createDatabaseReader, logic:transport; Edge discovery compute host: [discovery-runtime.ts](supabase/functions/bible-mcp/discovery-runtime.ts) (synced `discovery/` modules via [build-research-plugin.mjs](scripts/build-research-plugin.mjs)).
- Isolated public staging MCP: [staging.ts](supabase/functions/bible-mcp/staging.ts), fixed corpus-only routing with no database or notes tools; boundary tests: [verify-r12-staging-mcp.test.ts](scripts/verify-r12-staging-mcp.test.ts).
- v2 discovery MCP (7 tools on /mcp; legacy on /legacy/mcp): [discovery-v2-tools.ts](supabase/functions/bible-mcp/discovery-v2-tools.ts), [word-model.ts](supabase/functions/bible-mcp/word-model.ts), [research-engine.ts](supabase/functions/bible-mcp/research-engine.ts), [bible-ref.ts](supabase/functions/bible-mcp/bible-ref.ts), [gematria.ts](supabase/functions/bible-mcp/gematria.ts), [chain-store.ts](supabase/functions/bible-mcp/chain-store.ts), [chain-evidence.ts](supabase/functions/bible-mcp/chain-evidence.ts) (match selected hops to retrieved evidence); tests: [verify-mcp-v2-local.mjs](scripts/verify-mcp-v2-local.mjs) (run with `--import ./scripts/mcp-deno-loader.mjs`), [verify-mcp-token-alignment.mjs](scripts/verify-mcp-token-alignment.mjs), [verify-mcp-v2-audit.mjs](scripts/verify-mcp-v2-audit.mjs) (`--live`, bounded audit without note writes).
- Tools/catalog: [catalog.ts](supabase/functions/bible-mcp/catalog.ts); workflow: [research-workflow.ts](supabase/functions/bible-mcp/research-workflow.ts), [workflow-contract.ts](supabase/functions/bible-mcp/workflow-contract.ts), [research-lenses.ts](supabase/functions/bible-mcp/research-lenses.ts).
- Research hydration/syntax: [verse-hydrated.ts](supabase/functions/bible-mcp/verse-hydrated.ts), [syntax-research.ts](supabase/functions/bible-mcp/syntax-research.ts).
- Notes & KG MCP: [notes-tools.ts](supabase/functions/bible-mcp/notes-tools.ts), [notes-write.ts](supabase/functions/bible-mcp/notes-write.ts), [dlm-notes.ts](supabase/functions/bible-mcp/dlm-notes.ts), [research-graph-tools.ts](supabase/functions/bible-mcp/research-graph-tools.ts).
- Setup: [MCP_SETUP.md](MCP_SETUP.md); client skill: [skills/bible-research/](skills/bible-research/); packaging: [build-research-plugin.mjs](scripts/build-research-plugin.mjs), [integrations/](integrations/).

## Chronology and geography

- [ChronologyPanel.ts](src/ui/components/ChronologyPanel.ts), [EventTimeline.ts](src/ui/components/EventTimeline.ts); [CHRONOLOGY_ARCHITECTURE.md](CHRONOLOGY_ARCHITECTURE.md), [CHRONOLOGY_API.md](CHRONOLOGY_API.md).
- [VerseMap.ts](src/ui/components/VerseMap.ts), [VerseMapCanvas.ts](src/ui/components/VerseMapCanvas.ts); evidence inputs under [data/](data/).

## Import/build pipeline and recovery

- Export: [export-static-corpus.py](scripts/export-static-corpus.py); local integrity: [verify-static-corpus.py](scripts/verify-static-corpus.py), [test-static-corpus.py](scripts/test-static-corpus.py).
- Published pipeline: [.github/workflows/publish-static-corpus.yml](.github/workflows/publish-static-corpus.yml). Inspect it before changing asset generation.
- Import families: search scripts/import-* and scripts/etl-* by source; source rights and pins: [DATA_SOURCES.md](DATA_SOURCES.md), [PROVENANCE.md](PROVENANCE.md).
- Recovery and current gates: [PHASE_0_CHECKPOINT.md](PHASE_0_CHECKPOINT.md), [STAGE_G_FINAL_APPROVAL.md](STAGE_G_FINAL_APPROVAL.md), [MIGRATION_HANDOFF.md](MIGRATION_HANDOFF.md); [restore-supabase-storage.mjs](scripts/restore-supabase-storage.mjs), [test-isolated-pg-restore.mjs](scripts/test-isolated-pg-restore.mjs). These are operational procedures, not routine tests.

## Testing

Pre-relationship audit, source-of-truth boundaries and R1/R2 decision: [PRE_RELATIONSHIP_READINESS.md](PRE_RELATIONSHIP_READINESS.md).

[package.json](package.json) lists actual commands. Typecheck: npm run check:types; bundle: npm run build; advisory navigation/size: npm run check:size. No generic test runner exists.

Find targeted checks with rg --files scripts and inspect prerequisites/side effects before execution. Matching names do not imply redundant coverage or safe local execution.

| Area | Starting points |
| --- | --- |
| Reader/translations | [verify-translations-ui.mjs](scripts/verify-translations-ui.mjs), [verify-ui.mjs](scripts/verify-ui.mjs) |
| Notes & KG | [verify-notes-markdown.mjs](scripts/verify-notes-markdown.mjs), [verify-notes-security.mjs](scripts/verify-notes-security.mjs), [verify-notes-connection-types.mjs](scripts/verify-notes-connection-types.mjs) (request sharing/retry/cancellation), [verify-notes-e2e.mjs](scripts/verify-notes-e2e.mjs), [verify-notes-acceptance.mjs](scripts/verify-notes-acceptance.mjs), [verify-research-graph.mjs](scripts/verify-research-graph.mjs), [fixtures/notes-cases.json](scripts/fixtures/notes-cases.json) |
| Relationships | [verify-relationship-cases.mjs](scripts/verify-relationship-cases.mjs), [fixtures/relationship-cases.json](scripts/fixtures/relationship-cases.json) |
| BibleResearch v3 | [v3-binary-index.ts](src/relationships/v3-binary-index.ts), [v3-scorer.ts](src/relationships/v3-scorer.ts), [v3-verifiers.ts](src/relationships/v3-verifiers.ts), [v3-runtime-adapter.ts](src/relationships/v3-runtime-adapter.ts), `scripts/v3/`, `research/v3/`, [eval-adversarial-50.mjs](research/v3/eval-adversarial-50.mjs), [NEXT_GENERATION_EVALUATION_REPORT.md](NEXT_GENERATION_EVALUATION_REPORT.md) |
| Corpus and licensing | [verify-corpus-integrity.mjs](scripts/verify-corpus-integrity.mjs), [verify-corpus-security.mjs](scripts/verify-corpus-security.mjs), [verify-alignment-provenance.mjs](scripts/verify-alignment-provenance.mjs) |
| MCP | [verify-bible-mcp-local.mjs](scripts/verify-bible-mcp-local.mjs), [verify-openapi.mjs](scripts/verify-openapi.mjs) |
| Recovery | [verify-phase0-backup-records.mjs](scripts/verify-phase0-backup-records.mjs), [verify-reclamation-preservation.mjs](scripts/verify-reclamation-preservation.mjs) |

Use existing @section anchors for finer navigation. For runtime or service requirements, read the selected test; do not automatically run a whole family.
