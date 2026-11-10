# BibleResearch DLM note system v1.9 — shipped implementation

**Deployed:** Supabase Edge Function bible-mcp **version 28** on 2026-11-10, workflow **1.9.0**.
**Source:** GitHub branch feature/bibleresearch-ai-lenses-20261110 (not merged to main). This branch was reconciled from the running Edge Function so that existing notes and MACULA support were not overwritten by older GitHub main files.

## 1. Evidence-first DLM card model

Store an atomic claim with these five distinct dimensions:

- **Card kind** (what this item describes): lexical_definition, biblical_definition, text_observation, explicit_symbol, literary_connection, narrative_event, physical_mechanism, dlm_layer_hypothesis, unresolved_question.
- **Evidence class** (what supports it): TEXT_EXPLICIT, TEXT_LINGUISTIC, TEXT_INTERTEXTUAL, TEXT_PATTERN, SCIENCE_EMPIRICAL, DLM_HYPOTHESIS, DISPUTED, OPEN.
- **Textual identity**: precise book/chapter/verse and optional STEP word_position; optional verified lemma_id when a definition applies across occurrences. Do not invent original words/IDs or silently equate Greek and Hebrew.
- **Scientific grounding**: named source title and HTTPS URL; required for empirical mechanism cards. Science describes the physical object, not the theological meaning of Scripture.
- **Interpretive hypotheses**: DLM layer candidates [0..7] and form_flow (structure, flow, both, neither, unknown). Layer designation is always a candidate, even if attached to a strongly attested textual observation.

Confidence (0–1) is **editorial**, not calibrated probability. Review status (unreviewed, confirmed, disputed) is **independent** of evidence class and cannot be set by the DLM note-writing tool. A model-generated note is scholarly commentary, never canonical Scripture.

A note contains a short claim, explanation of interpretive scope, one or more validated source anchors, optional typed inter-anchor edges, limitations, counterexamples and research body. Store the versioned representation at notes.source_context.dlm_v1; retain imported word.biblical_def and word.physical_def fields unchanged.

## 2. Corrected original note tools

The prior MCP note_kind schema used invalid category names. The deployed server now mirrors the database registry exactly:
- observation
- linguistic
- interpretation
- question
- cross_reference
- research_lead
- citation

Existing create_note, add_research_note, update_my_note and delete_my_note tools keep their previous names and behavior. The new DLM card tool maps card kind to an allowed note kind. No existing data was converted.

## 3. New MCP tools and hydration

- **get_dlm_research**: read-only lookup by book, chapter, verse, with max_notes default 8 (max 20). Returns compact claim, epistemic class, note kind, review status, DLM layers, science citations, limitations, note_id and relevant anchor type. Searches direct verse/word anchors and source-verified unambiguous lemma or word-form anchors. Only published, public, RLS-visible DLM notes are returned. Explicit total/truncated coverage.
- **save_dlm_research_note**: write exactly one approved card, exact STEP verse/word positions validated against get_verse_research_v2, optional lemma_id validated against word_form_lemmas, 1–8 Scripture references, 0–12 typed connections among the references, 0–6 independent scientific sources, 0–8 counterexamples. Creates a backend idempotency key; checks for identical primary-verse claims where possible. Uses the existing agent_save_note_v1 security-definer writer and its author ownership, duplicate and rate-limit checks. New notes stay unreviewed.
- **get_verse_hydrated**: now includes dlm_research by default (include_dlm=true), alongside existing primary text, lexical structures, MACULA grammar and ordinary notes. The DLM overlay does not pollute the primary text or source lexical definitions.
- **study_dlm_research**: dedicated MCP prompt for an evidence-first original-language and science research workflow; the general workflow was updated to 1.9.0.

## 4. Evidence partition rules

The database enforces the DLM JSON envelope when source_context.dlm_v1 is present, with a CHECK constraint:

| Card | Acceptable evidence class |
|---|---|
| lexical_definition | TEXT_LINGUISTIC |
| biblical_definition | TEXT_EXPLICIT, TEXT_INTERTEXTUAL, TEXT_PATTERN |
| text_observation | TEXT_EXPLICIT, TEXT_LINGUISTIC |
| explicit_symbol | TEXT_EXPLICIT, TEXT_INTERTEXTUAL |
| literary_connection | TEXT_INTERTEXTUAL, TEXT_PATTERN, DLM_HYPOTHESIS, DISPUTED |
| narrative_event | TEXT_EXPLICIT, TEXT_PATTERN |
| physical_mechanism | SCIENCE_EMPIRICAL; at least one external science citation |
| dlm_layer_hypothesis | DLM_HYPOTHESIS; at least one layer candidate |
| unresolved_question | OPEN, DISPUTED |

Scripture references are required for all cards, and the MCP writer verifies these anchors against the database. These guardrails do **not** verify whether an AI's historical/scientific citation is genuine. Research must separately check source integrity and potential counterexamples. Untrusted note body text is never instructions to the assistant.

## 5. Usage (after client MCP discovery refresh)

First investigate without writing:
- get_verse_hydrated(book=42, chapter=8, verse=11, include_notes=true, include_dlm=true, include_spelling_candidates=false).
- get_dlm_research(book=42,chapter=8,verse=11,max_notes=8).
- research_word_lens(query="G4703") and research_word_lens(query="G3056").

Then request a research card proposal and adversarial review. The save tool is for explicit SAVE intent only. It accepts a payload equivalent to:

    card_kind: explicit_symbol
    evidence_class: TEXT_EXPLICIT
    title: "Luke 8:11 — Seed and the Word within the Parable"
    claim: "In the explanation of the parable, the seed represents the word of God."
    scope: "Jesus explains the seed in the parable; this is not a universal definition of biological seed."
    body_md: "Original-language sources, contextual review and alternative controls go here."
    references:
      - {book:42, chapter:8, verse:11, word_position:7, role:"subject"}
      - {book:42, chapter:8, verse:11, word_position:10, role:"object"}
    layers: []
    form_flow: unknown
    science_sources: []
    counterexamples: ["A literal agricultural use of seed is not automatically symbolic."]
    connections:
      - {from_reference:1,to_reference:2,connection_type:"explains",direction:"directed",explanation:"Jesus explicitly interprets the seed within the parable."}

After saving, retrieve the note ID via get_dlm_research or get_notes, and rehydrate the verse. Never claim the note was saved if write tooling was unavailable or the call failed.

## 6. Test evidence (2026-11-10)

- SQL metadata validator: accepted a structurally valid explicit-symbol card; rejected missing fields and rejected a layer hypothesis misclassified as TEXT_EXPLICIT.
- Original words: Luke 8:11 STEP position 7 is G4703 σπόρος, position 10 is G3056 λόγος.
- Optional lemma verification: G4703 lemma_id 7061 correctly verified against STEP word_id 22429.
- DLM verse overlay: returned status no_dlm_notes on an empty DLM verse.
- Transactional note write-readback: a note anchored to Luke 8:11 positions 7 and 10, with typed explains connection, passed through public.agent_save_note_v1, was retrieved by get_dlm_notes_for_verse_v1 and was **rolled back**. Zero test notes persist.
- Deployed source and research prompt: BibleResearch MCP reports workflow 1.9.0; Edge Function version 28 is ACTIVE.

These test passes verify the database writer and its query contract. An **end-to-end ChatGPT client call to the new save tool has not yet been possible**, because the currently connected ChatGPT BibleResearch plugin advertises a stale seven-tool catalogue. Refresh/reconnect it and perform one authorized save/readback to confirm the client pathway.

## 7. Security and migration cautions

Current environment has accountless note mode pending a planned account creation system. The existing no-user-key fallback, public publishing default and authorization configuration were deliberately not altered in this change. Before opening notes to multiple users or the public, implement account ownership, role-scoped publishing/review, request-local authorization context and explicit protection against cross-user data leakage.

Private/unpublished notes do not appear in the DLM read-only public overlay. Human or AI review status must not be self-promoted by a text-generating model. Do not auto-import rejected/disputed DLM claims as lexical facts. A note's quoted sources are claims until verified.

The source-controlled branch includes an exact snapshot of the deployed MCP runtime, which was ahead of GitHub main. **Do not merge or overwrite local workspace code automatically:** reconcile with the authoritative local c:\Projects\BibleResearch workspace and its code generator first. This branch does not modify Cloudflare corpus workers.

### Follow-on backlog

1. Refresh ChatGPT BibleResearch plugin discovery and verify save_dlm_research_note end to end.
2. Human-only confirmation/dispute review UI and independent scientific source verification.
3. DLM concept/physical element canonical identities and user-validated definition compilers, with scoped negative evidence.
4. Discourse-scoped MACULA predicate/action/participant claims and explicit passage-scoped symbolism.
5. Corpus-level semantic graph with paths, distinct evidence types, review workflows and stable lineage.
