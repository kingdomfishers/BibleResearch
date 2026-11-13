# DLM Research — Method and Knowledge Graph

**Design v1.0 · 2026-11-13 · Proposed, not implemented**

**Purpose.** Define how humans and AI investigate DLM questions, preserve discoveries, and explore recurring biblical structures. This is a focused design, not a replacement for `RELATIONSHIP_ARCHITECTURE.md` or the existing BibleResearch data/API documentation.

## 1. Research foundation

DLM begins with the premise that **physical reality is God's expression**: creation is fundamentally informational and semantic, progressively structured through divine order. The seven-layer sequence describes a recurring, nested process through which meaning is expressed and understood. Biblical narratives, physical processes, and recurring structures are investigated as potential manifestations of that order.

The current DLM sequence, preserving the names in `DLM_Research.md`, is:

**0** Unformed Potential → **1** Distinction → **2** State / Container → **3** Syntax, Law & Seed → **4** Sequence of Operations / Clock & Spirit-Fire → **5** Intention / Living Soul (*Nefesh*) → **6** Agency / Self-Reflective Choice → **7** High-Level Meaning / Rest (*Shabbat*).

A completed cycle may establish the conditions for another nested cycle. **Structure/Form** and **Flow/Vitality** are recurring dimensions. Research investigates where the sequence appears, how its stages depend on one another, and whether observations support, qualify, or revise the model.

## 2. Scientific research method

Every investigation follows eight functions, but may enter at a different point depending on the question.

1. **Frame.** State the question, scope, prior knowledge, and what a useful answer would reveal.
2. **Observe.** Retrieve the relevant original-language passages, linguistic relationships, historical context, and/or measured natural phenomena.
3. **Reconstruct.** Describe each process in terms of participants, initial state, operations, conditions, constraints, and resulting state.
4. **Discover patterns.** Search for recurring words, expressions, grammatical relationships, action sequences, and structures across passages or domains.
5. **Explain mechanisms.** Investigate what governs the transformation; use the appropriate scientific, linguistic, or historical framework.
6. **Synthesize.** Compare the observed structures with each other and with candidate DLM layers or nested sequences.
7. **Test and revise.** Examine contrasting cases, alternative explanations, predictions, and newly relevant evidence; improve or abandon inadequate models.
8. **Preserve and continue.** Save meaningful findings and open questions; select the next investigation with the greatest expected insight.

**Entry routes:** Bible-first (word/passage), physical-process-first, relationship-first (two connected things), expression/pattern-first, or DLM-hypothesis-first. The method remains the same; the evidence-retrieval order adapts to the question.

**Autonomous depth:** Continue while new evidence or a promising unresolved mechanism advances the stated question. Stop when results become repetitive or unproductive. Save interesting out-of-scope leads for the user's decision rather than silently changing the project.

**Interruption-safe progress:** After each meaningful finding or completed research branch, show a concise result in ChatGPT **and** store a durable checkpoint before proceeding. A checkpoint records the scope, newly accepted observations/proposals, explored paths, unresolved questions, current next action, and source links. Resume from the latest confirmed checkpoint. If writing fails, report the finding and the persistence failure before continuing; conversation text alone is not a confirmed database save.

## 3. Unified knowledge graph: five node families

The knowledge graph connects **what the text contains**, **what a passage refers to**, **what recurs**, and **what researchers discover**. It is a unified view over existing source records and research records, not a duplicate biblical corpus.

| Node | Identity and use |
|---|---|
| **Word** | An existing Hebrew/Aramaic/Greek **lemma** (preserving source identity and homograph distinctions); connects to all its occurrences, syntax, lexical evidence, and other lemmas. |
| **Referent / composite concept** | A distinct person, place, named entity, group, object, event, or idea not adequately identified by one word. E.g. historical **Jerusalem** versus **New Jerusalem**. |
| **Expression** | A reusable combination of words, with specific attested occurrences and variants. E.g. **lost sheep**, linked to its constituent lemmas and passages. |
| **Pattern** | A reusable structure of relationships or actions, possibly spanning clauses or containing smaller patterns. E.g. **perceive → judge desirable → take**. |
| **Discovery** | A human- or AI-authored research finding, hypothesis, question, mechanism, comparison, or revision, linked to supporting records and other discoveries. |

**Word identity rule:** Do not split one lemma into separate graph identities for its possible meanings. For example, רוּחַ (*ruach*) stays unified: wind, breath, spirit, and directional uses remain discoverable together through their passage-level evidence and optional search filters. Contextual interpretations can be recorded as discoveries without dividing the word node. Preserve genuine lexical homographs as distinguished by the source dataset.

**Referent linking:** A lexical occurrence may link to an identifiable person/place/thing when the referent is supported by context. When identification is unresolved, retain alternatives rather than selecting a referent automatically.

**Composite concepts:** Create these when an independently identifiable thing or recurring structure cannot be represented by a single lemma. A translation gloss alone is not a reason to create a concept.

### Expressions versus patterns

- **Lexical expression search:** Finds recurring lemmas and phrase constructions, including documented variants; retains the exact words, occurrence spans, edition, and syntax.
- **Structural pattern search:** Finds recurring *relations or event sequences*, even when vocabulary differs. A pattern can be specified by roles such as `observer → evaluates → acquires`, with optional conditions and consequences.
- **Nested patterns:** A pattern can contain other patterns and connect to proposed DLM-layer sequences. Occurrences remain separate: the reusable pattern defines the structure; each match records how that passage realizes it.

**Example:** Genesis 3:6, Genesis 6:2, and Joshua 7:21 are candidates to investigate for a **seeing → evaluation/desire → taking** sequence. The engine displays the actual verbs, subjects, objects, order, and differences for each passage. A researcher can refine the pattern or reject a proposed match.

## 4. What a connection means

A graph **edge** links two nodes or an occurrence to a node. It always has a relationship type and an origin record. Useful families:

- **Textual:** grammatical role, modifies, quoted by, compared with, identified in a particular passage, co-occurs, cross-reference.
- **Compositional:** expression has constituent lemma; pattern has step; passage instantiates expression/pattern; pattern contains subpattern.
- **Process:** precedes, enables, constrains, transforms, produces, participates in.
- **Research:** supports, challenges, explains, extends, supersedes, proposes correspondence, relates to DLM layer.

Graph traversal composes these edges into paths **without storing every possible path**. A path displays each intermediate node, edge type, and its supporting passage or research record. Search results may be direct source relationships, algorithmic pattern candidates, or human/AI research connections; each retains its own provenance.

**Discoveries are navigable nodes.** Selecting one shows its claim, source anchors, connected concepts and patterns, related or conflicting discoveries, review decision, and revision history. Selecting a word shows the original-language evidence first and links outward to expressions, patterns, referents, and discoveries.

## 5. Research lifecycle and collaboration

- **Capture:** Both humans and AI can create and edit discoveries, expressions, patterns, matches, relationships, and source links using the same underlying operations. Authorship and revision history are retained.
- **Review:** AI-generated and human-created research proposals enter review. The user can approve, revise, reject, or revoke individual findings or a selected related group. Review history records the rationale.
- **Revisit:** Rejected or revoked findings remain searchable. Material new evidence may trigger a suggestion to reopen them, retaining the prior decision and reasons.
- **Checkpoint:** Research can be resumed after interruptions without repeating completed work. Only meaningful results, decisions, search coverage, and next actions are retained; raw repetitive tool output is not.

**ChatGPT** is the primary AI research interface. **BibleResearch's existing reader** displays discoveries at the associated words and passages. A **DLM graph page** supports manual exploration, node/edge creation, pattern matches, review queues, batch decisions, and directing future research.

## 6. Implementation fit with the current BibleResearch system

**Already present (confirmed in the live Supabase schema and GitHub source, 2026-11-13):** `lemmas`, `concepts`, `canonical_entities`, `entity_relationships`, `research_nodes`, `assertions`, `assertion_evidence`, `notes`, `note_anchors`, `note_connections`, `note_revisions`, and `note_authors`; the notes UI and MCP read/write functions also exist. The existing graph tables have limited node/relation vocabularies. `note_connections` connects two anchors **within the same note**, so it is not itself a complete cross-note graph.

**Proposed integration:**

1. **Reuse immutable biblical data.** Lexical, grammatical, and corpus relationships remain in the established Cloudflare evidence architecture, following `RELATIONSHIP_ARCHITECTURE.md`; do not copy all biblical words into new research tables.
2. **Reuse dynamic research records.** Use existing notes, anchors, connection types, authorship, and revisions for discovery content and manual research links. Treat a note as a discovery node with a stable ID.
3. **Provide a unified bounded graph API.** Resolve typed references to existing word/entity/note records; combine biblical edges, source matches, and note-anchor connections on retrieval. Return neighboring nodes, provenance, filters, and paginated expansion.
4. **Add only missing persistent structures.** Audit `research_nodes`/`assertions` and current note contracts before migrations; extend/reuse them where feasible for *expression definitions, pattern definitions, passage-specific matches, and cross-note/cross-type links*. Add the smallest compatible schema only where current constraints genuinely prevent this.
5. **Add research-session checkpoints and review history.** Extend current note review behavior to support approval, revocation, reopening, and batch decisions without discarding revisions.
6. **Expose identical operations to human UI and ChatGPT MCP.** Search/create/edit/link nodes; attach evidence; propose matches; explore neighbors; save and resume checkpoints; request or record user review decisions.

**Minimum first version:** Read-only interactive graph for lemmas, existing notes, and their connections; creation of an expression and a structural pattern; attach exact passage matches; navigate from a biblical word to those structures and back; save and resume a research session. Expand automation only after these work.

**Verification examples:** (a) רוּחַ remains one lemma node across diverse uses; (b) *New Jerusalem* and historical Jerusalem are distinct referents linked to textual evidence; (c) *lost sheep* opens its component words and attested contexts; (d) **seeing → evaluation/desire → taking** finds and displays candidate matches across differing vocabulary; (e) a discovery connects to a word, expression, pattern, and another discovery; (f) interrupted research resumes from its saved checkpoint; (g) rejection/revocation and later reconsideration preserve history.

**Scope of this document:** Scientific method, graph identities, relationship behavior, user workflow, and the minimal implementation path. Detailed schema, endpoint signatures, and component designs belong in the implementation plan after a focused compatibility audit.
