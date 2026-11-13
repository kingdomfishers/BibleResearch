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

## Relationships

- UI: [RelationshipExplorer.ts](src/ui/components/RelationshipExplorer.ts), [LexicalRelationshipsSection.ts](src/ui/components/LexicalRelationshipsSection.ts), [PassageCrossReferences.ts](src/ui/components/PassageCrossReferences.ts).
- Gateway/identity: [relationships-rpc.ts](src/api/relationships-rpc.ts), [relationship-model.ts](src/api/relationship-model.ts) (logic:identity, logic:dedup-xrefs, logic:dedup-lexical), [relationship-notes-adapter.ts](src/api/relationship-notes-adapter.ts).
- Static operations: [corpus-relationships-rpc.mjs](scripts/corpus-relationships-rpc.mjs); pilot generation: [build-relationship-slice.mjs](scripts/build-relationship-slice.mjs).
- Design versus implemented scope: [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md), [TASKS.md](TASKS.md). Do not infer deployment from a proposal.

## Corpus gateway, Supabase and Cloudflare

- Browser gateway: [rpc.ts](src/api/rpc.ts), especially logic:request, logic:reader, logic:corpus-lookups, logic:gateway. Shared contracts start at [types.ts](src/api/types.ts).
- Static routing/cache: [corpus-client.ts](src/api/corpus-client.ts), isStaticCorpusRpc, logic:registry, logic:client.
- Supabase initialization/auth: [supabase.ts](src/api/supabase.ts). SQL contracts/history: [supabase/migrations/](supabase/migrations/); locate the latest relevant function definition with rg rather than loading every migration.
- REST contract: [supabase/openapi.json](supabase/openapi.json).
- Worker entry: [corpus-worker.mjs](scripts/corpus-worker.mjs); restricted fields: [corpus-security.mjs](scripts/corpus-security.mjs); config: [wrangler.corpus.jsonc](wrangler.corpus.jsonc).
- Boundary/runbook: [ARCHITECTURE.md](ARCHITECTURE.md), [STATIC_CORPUS_MIGRATION.md](STATIC_CORPUS_MIGRATION.md).

## MCP and integrations

- Transport/database reader: [index.ts](supabase/functions/bible-mcp/index.ts), createApp, createDatabaseReader, logic:transport.
- Tools/catalog: [catalog.ts](supabase/functions/bible-mcp/catalog.ts); workflow: [research-workflow.ts](supabase/functions/bible-mcp/research-workflow.ts), [workflow-contract.ts](supabase/functions/bible-mcp/workflow-contract.ts), [research-lenses.ts](supabase/functions/bible-mcp/research-lenses.ts).
- Research hydration/syntax: [verse-hydrated.ts](supabase/functions/bible-mcp/verse-hydrated.ts), [syntax-research.ts](supabase/functions/bible-mcp/syntax-research.ts).
- Notes: [notes-tools.ts](supabase/functions/bible-mcp/notes-tools.ts), [notes-write.ts](supabase/functions/bible-mcp/notes-write.ts), [dlm-notes.ts](supabase/functions/bible-mcp/dlm-notes.ts).
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

[package.json](package.json) lists actual commands. Typecheck: npm run check:types; bundle: npm run build; advisory navigation/size: npm run check:size. No generic test runner exists.

Find targeted checks with rg --files scripts and inspect prerequisites/side effects before execution. Matching names do not imply redundant coverage or safe local execution.

| Area | Starting points |
| --- | --- |
| Reader/translations | [verify-translations-ui.mjs](scripts/verify-translations-ui.mjs), [verify-ui.mjs](scripts/verify-ui.mjs) |
| Notes | [verify-notes-markdown.mjs](scripts/verify-notes-markdown.mjs), [verify-notes-security.mjs](scripts/verify-notes-security.mjs), [verify-notes-connection-types.mjs](scripts/verify-notes-connection-types.mjs) (request sharing/retry/cancellation), [fixtures/notes-cases.json](scripts/fixtures/notes-cases.json) |
| Relationships | [verify-relationship-cases.mjs](scripts/verify-relationship-cases.mjs), [fixtures/relationship-cases.json](scripts/fixtures/relationship-cases.json) |
| Corpus and licensing | [verify-corpus-integrity.mjs](scripts/verify-corpus-integrity.mjs), [verify-corpus-security.mjs](scripts/verify-corpus-security.mjs), [verify-alignment-provenance.mjs](scripts/verify-alignment-provenance.mjs) |
| MCP | [verify-bible-mcp-local.mjs](scripts/verify-bible-mcp-local.mjs), [verify-openapi.mjs](scripts/verify-openapi.mjs) |
| Recovery | [verify-phase0-backup-records.mjs](scripts/verify-phase0-backup-records.mjs), [verify-reclamation-preservation.mjs](scripts/verify-reclamation-preservation.mjs) |

Use existing @section anchors for finer navigation. For runtime or service requirements, read the selected test; do not automatically run a whole family.
