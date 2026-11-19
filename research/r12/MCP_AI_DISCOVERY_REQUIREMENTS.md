# BibleResearch — AI Discovery MCP Requirements and DLM Research Architecture

> **CURRENT INTERFACE DECISION — 2026-11-19 (v2):** The authoritative public API is the owner's **seven-function compact contract**: `get_Passage`, `get_Word`, `write_Note`, `get_Connection`, `research`, `follow_connectionchain`, and `get_prompt`. See [MCP_CODEMODE_DISCOVERY_STRATEGY.md](MCP_CODEMODE_DISCOVERY_STRATEGY.md) and the [updated Neon prompt](NEON_MCP_CODEMODE_IMPLEMENTATION_PROMPT.md). **The eight-read-tool design, tool names and roadmap below are historical supporting analysis, not current implementation instructions.** Retain its source-evidence, DLM, prophetic, ranking and evaluation requirements.

**Status:** Research and implementation specification; **no MCP code or deployment changed by this document**  
**Date:** 2026-11-19  
**Repository baseline:** inspected branch `feat/r12-qa-fixes`; live BibleResearch MCP catalog observed with **46 tools**.  
**Owner for future implementation:** BibleResearch orchestrator / architecture team.  
**Goal:** Give ChatGPT, Gemini and comparable language models the *smallest useful research interface* that makes them substantially more capable of discovering, testing, explaining and extending surprising biblical patterns — especially complex prophetic imagery and DLM hypotheses — than they are from general training alone.

## 1. Evidence-first principles (historical interface proposal superseded)

**Do not confuse more MCP tools with more research capability.** The project has substantial corpus evidence but exposes it through too many overlapping, specialized tool calls. The former recommendation to reduce the default catalog to **eight read tools plus one write tool has been superseded** by the owner’s seven-function compact interface; preserve the underlying source operations and legacy/expert access. The public AI interface should support iterative, evidence-driven research:

**Orient a question → read the whole passage → identify symbols/claims → retrieve candidate parallels → examine decisive witnesses → test alternatives and counterexamples → synthesize a carefully qualified interpretation → continue exploring.**

The AI is the comparative reasoner and hypothesis generator; the MCP server is the **precise, queryable memory and evidence-verification instrument**. Neither should impersonate the other.

**Priority correction:** A passage reference is not merely a bag of Strong's numbers. Passage-level meaning, image structure, speaker, event, discourse and literary reuse must organize ranking before isolated lexical associations.

**Important boundary:** The goal is not a machine that claims to have found *the* hidden meaning of Ezekiel, Zechariah or Revelation. It is a system that can reconstruct the strongest textually defensible interpretations, explain why they are persuasive, distinguish alternatives and test more speculative DLM layers without declaring them Scripture.

## 2. Grounded audit of the current interface

### 2.1 What is exposed today

The current connected MCP advertises **46 tools** (41 read-oriented, 5 note/DLM write-oriented). The implementation registers tools in:

- `supabase/functions/bible-mcp/catalog.ts`
- `supabase/functions/bible-mcp/research-lenses.ts`
- `supabase/functions/bible-mcp/relationships-v2.ts`
- `supabase/functions/bible-mcp/verse-hydrated.ts`
- `supabase/functions/bible-mcp/syntax-research.ts`
- `supabase/functions/bible-mcp/dlm-notes.ts`
- `supabase/functions/bible-mcp/notes-tools.ts` and `notes-write.ts`
- `supabase/functions/bible-mcp/workflow-contract.ts` and `research-workflow.ts`

The following overlap substantially *for normal AI use*, although their lower-level semantics and expert value differ:

| Current surface | Observed overlap or friction | Preferred AI-facing entry |
| --- | --- | --- |
| `get_verse_research`, `get_verse_hydrated`, `research_passage_lens`, `prompt_verse_words`, `research_macula_syntax`, `get_syntax_tree`, `get_passage_grammatical_frames_v2` | Many routes to one verse; some omit surrounding passage, others send excessive metadata; syntax requires manual stitching. | `study_passage` with selectable profiles/sections; preserve raw tree as expert drill-down. |
| `research_word_lens`, `resolve_word_id`, `get_word_details`, `lookup_lexical_semantics`, `inspect_word_formation`, `get_unified_word_relationships_v2`, other R9B relation tools | Resolution, sense, formations, occurrences, morphology and relationships split across many calls. | `study_concept` with disambiguated senses and progressive lexical details. |
| `discover_biblical_connections_v1`, `discover_biblical_connections_v2`, `discover_relationship_paths_v1`, `research_relationships`, `trace_biblical_bridge` | Similar user intent but incompatible expectations and versions; high-score lexical results can eclipse literary parallels. | `discover_connections` (v2-backed, passage-aware) plus `compare_passages`. |
| `get_connection_evidence_v1`, `expand_biblical_connection_v1` | Valuable but need stable identifiers, context, explanations and proof-path verification. | `inspect_evidence` and `expand_research`. |
| `get_verse_chronology_v1`, `get_verse_geography`, LXX retrieval/alignments, coverage tools | Valuable specialized data that should be included only when relevant, with source/version status. | Optional sections of `study_passage` / `compare_passages`; retain expert tools. |
| `get_dlm_research`, `get_notes`, `get_verse_hydrated` notes, and multiple note writers | Split read pathways; commentary, source claims and DLM hypotheses may be confused. | `read_research_notes` and one authorized `save_research_note`. |
| `get_research_prompt` and 22 templates | Workflow guidance is important but another tool call and many templates should not be necessary for every question. | Concise MCP server instructions, 3–4 research prompts and optional guidance resource. |

**Important:** This is a *front-door consolidation proposal*, **not** authorization to delete low-level operations, data, tests, source mappings or compatibility endpoints. Some clients need expert access.

### 2.2 Small live investigation: three prophetic passages

On **2026-11-19**, the connected `research_passage_lens` returned valid original-language tokens and WEB verse text for Ezekiel 1:16, Zechariah 4:6 and Revelation 13:2. `get_dlm_research` for Zechariah 4:2 returned `status: no_dlm_notes` (this proves only that this scoped published-note lookup was empty, not that no DLM research exists). The R12 discovery endpoint returned `status: ok` for each of the three passage queries.

A bounded `discover_biblical_connections_v2` test, `mode=discover`, `max_hops=4`, `limit=12`, revealed:

| Query | Examples high in actual top 12 | Important contextual connection **not in observed top 12** |
| --- | --- | --- |
| **Ezekiel 1** | Chebar/river construct, captivity/utensil relation, general lamp bridge, unrelated word paths | Ezekiel 10's **explicit identification** of the living creatures as cherubim; Ezekiel/temple/throne imagery; possible links to Revelation 4 |
| **Zechariah 4** | Revelation 5:6 seven eyes, grammatical awakening relations, sleep LXX, generic lamp-word translation | Zechariah 4's own interpretation **Spirit / Zerubbabel / two olive trees**, and Revelation 11:4's unmistakable reuse of olive-tree/lampstand imagery |
| **Revelation 13** | Beast/worship grammatical relation, head/corner, horn lexical relatives, Sea/Galilee construct | The distinctive **leopard–bear–lion / sea-beast** composition of Daniel 7 |

These observations describe **top-12 ranking**, not absence of underlying evidence or deeper result pages. The response `release_id` for these passage searches was `r11-v1.0`; the complete response also exposes separate R12 fields. Future evaluation must verify which sub-engine produced each candidate, without treating a reported release label as proof of the underlying live deployment state.

**Diagnosis:** The system can retrieve useful fragments, but the top-level passage route is insufficiently organized around the literary unit, text-internal interpretations and distinctive combinations of motifs. A strong grammatical edge can be true yet far less relevant to the user's question than an intertextual reuse. **Ranking must respect question intent and evidence type.**

### 2.3 Existing assets to reuse, not rebuild

The architecture already has usable STEP Hebrew/Aramaic and Greek words, MACULA morphology/syntax, verified R3 grammatical frames where covered, R9B lexical/contextual/LXX layers, Swete LXX and versification bridges, R10 cross-references, R12 discovery/proof paths, chronology/geography, notes and public-domain WEB English. The 2026-11-19 R12 handoff reports embedded reciprocal xrefs and event context; inspect actual current release and coverage before relying on that detail.

**Missing semantic information is not licensed to be invented.** MACULA syntactic roles do not automatically supply agent/patient semantic roles; source licensing and unavailable frame fields remain real constraints.

## 3. What language models actually contribute — and what they cannot reliably do alone

| Model capability | Best use in BibleResearch | What the server must provide |
| --- | --- | --- |
| **Synthesis and analogy** | Notice analogies between visions, events, action sequences, symbols, institutions, themes and contrasts; propose interpretable hypotheses. | Bounded, diverse candidate retrieval across the *whole* corpus, not just examples remembered by the model. |
| **Contextual language interpretation** | Compare discourse, imagery, actor/recipient roles, metaphor, rhetorical structure and paraphrases. | Ordered original tokens, translations, syntax, surrounding context, source-specific senses and negation. |
| **Multi-step reasoning** | Trace a motif through earlier and later passages, ask whether transformation of an image matters. | Typed edges with independent witnesses, exact identity, intermediate nodes, scope and provenance. |
| **Generating useful questions** | Form rival interpretations, plausible implications, disconfirming searches, adjacent paths worth exploring. | Direct falsification/contrast queries and denominators; explicit lack-of-coverage signal. |
| **Explanatory writing** | Explain difficult research clearly, with parallel text and why each witness matters. | Readable *actual verses*, glosses/transliteration, exact word anchors, evidence IDs and defensible citations. |
| **Scientific/physical analogies in DLM** | Notice how physical processes might illuminate a metaphor and derive *testable* analogies. | Separately sourced empirical scientific facts, scope, physical mechanism, and a strict boundary between analogy and exegetical evidence. |

**Model weaknesses to compensate for:** inability to remember all 31,203 verses precisely; fabricated original-language etymologies; English-translation artifacts; preference for salient associations; confirmation bias; long-chain drift; inaccurate counts; unsupported manuscript or historical claims; tendency to interpret one symbol uniformly in every context; falsely confident theology; and treating generated patterns as verified facts. A large context window does not repair those weaknesses without structured retrieval and adversarial validation.

The optimal division of labor is:

- **Deterministic corpus engine:** identities, text, lexical disambiguation candidates, morphology, alignments, contextual counts, verified graph edges, cross-reference coverage, exact searches, licensing, validation, release pinning and caching.
- **Language model:** choose investigative direction, compare qualified evidence, propose thematic structure, explain ambiguity, design counter-tests and formulate a useful interpretation.
- **Review layer:** mark sources, competing traditions, independent corroboration, possible allusion versus explicit statement, and unknowns. The model never gets to silently upgrade a hypothesis to a source fact.

## 4. Minimum information needed for deep, passage-wide discovery

The most important new product is a **compact, source-grounded research dossier** for a pericope, not another single-verse word dump.

Every deep passage dossier should offer *progressive retrieval* of the following:

1. **Passage identity and scope:** full requested verses, book/chapter, nearby literary unit, speaker, audience, narrative/vision setting, translation edition, source version and explicit boundaries. Return WEB or other rights-cleared English text, not just references.
2. **Ordered original text:** exact Hebrew/Aramaic/Greek tokens, transliteration, readable gloss, occurrence anchor, lemma candidates and morphology; optional phrase/constituent structure, clause role and negation. Surface only decisive words in the initial summary; allow full expansion.
3. **Vision object and role inventory:** each entity, person, creature, material, color, number, motion, body part, object and *relation* (e.g. **living creature → beside wheel → moves with spirit → beneath throne**). Preserve the original verse anchors. Do not pretend image inventory alone determines symbolic meaning.
4. **Biblical self-interpretation:** search first for an explicit local explanation, an angel's explanation, a later explicit identification, quotations, named antecedents and text-stated metaphors. Preserve *scope* of the explanation; a lampstand identified as churches in Revelation 1:20 does not mean every lampstand in Zechariah has the same referent.
5. **Literary structure and repeated combinations:** distinctive sequences, rare multiword motifs, sevenfold patterns, narrative role similarities, event progression, opposing imagery, temple/covenant/throne contexts, speaker changes and parallel vision scenes. Count genuine independent witnesses, not replicated index edges.
6. **Intertextual candidates:** whole-text quotations, marked echoes, possible allusions, reused scene structure, thematic analogies and editorial cross-references in **separate categories**. Include both passages in real English and original-language anchors, similarity *and dissimilarity*, evidence source, probable chronological direction and alternative explanations.
7. **Source-language and textual controls:** Hebrew/Aramaic versus Greek, Swete LXX when applicable, real MT–LXX versification mapping, edition identity, variants or source gaps when available. Translation-equivalence candidates are not semantic identities. Avoid implying the Swete text is necessarily the exact Vorlage an NT writer used.
8. **Historical, geographical and genre setting:** exile/temple reconstruction/imperial contexts; original audience; composition and event dating as distinct axes; disputed alternatives; ancient iconography or social context only when independently sourced. Symbolic locations must not acquire fabricated GPS coordinates.
9. **Lexical breadth and controls:** observed frequency/denominators, representative usage across books, sense diversity, explicit metaphor, grammar, co-occurrence separated from causal or semantic relations, plus counterexamples and mismatching contexts.
10. **Research state:** covered vs uncovered fields, withheld licensed data, negative findings vs search gaps, candidate IDs, source SHA/release, pagination cursor and recommended *next precise question*. The model can branch from any image/word/verse/evidence record.

**Novel key requirement: biblical symbol-sense registry.** Represent symbols with **occurrence-specific meaning assignments**: symbol surface, agent/action/object, passage, explicit/interpreted referent, source of interpretation, confidence class, historical context and known counterexamples. Do **not** create a single global definition of "eye," "horn," "oil," "water," "dragon," "beast" or "seven." Distinct symbol occurrences may mean different things. Unreviewed inferred mappings must remain candidate hypotheses.

## 5. Historical eight-read-tool interface (superseded; capability inventory only)

**This earlier eight-read-tool table is archived as an inventory of capabilities, not a build instruction.** The binding interface is seven named functions in [MCP_CODEMODE_DISCOVERY_STRATEGY.md](MCP_CODEMODE_DISCOVERY_STRATEGY.md): two compact frequent reads; connection comparison; persistent chain; composable research; prompt; authorized notes write. Names below are not current endpoint commitments.

| Tool | Core responsibility | Modes / mandatory contract |
| --- | --- | --- |
| **1. `study_passage`** | Read bounded verse, paragraph, chapter or pericope with actual original and English text and optional grammatical, symbol, context, intertext and DLM sections. | `reference` or exact coordinates; `profile=quick|analysis|prophetic|full`; `sections[]`; `edition`; `budget`; `cursor`. The *prophetic* profile must include text-internal vision interpretation, object/action inventory and strongest intertexts, not every occurrence. |
| **2. `study_concept`** | Resolve ambiguous words/symbols and retrieve attested usages, senses, roots/formations, distinctive functions, symbol usages and language bridges. | `query` or stable occurrence anchor; `mode=lexical|symbol|usage|formation|physical`; `context_reference`; disambiguation candidates; source and missing-coverage flags. Physical attributes are independent empirical data, never automatically theological. |
| **3. `discover_connections`** | Rank whole-corpus direct and indirect *meaningful* connections appropriate to the question. Passage queries prioritize contextual intertexts over generic edges. | `seed` (passage/concept/word/claim), `intent=passage|theme|prophecy|word|surprise`, `mode=discover|bridge|compare|challenge`, `types[]`, `limit`, `cursor`, `release_id`. Return concise narratives, both passage references, evidence IDs, mechanism, uncertainty, **why interesting**, and new branches. |
| **4. `inspect_evidence`** | Verify one candidate claim/path in complete, trustworthy detail. | `evidence_id`, optional `release_id`. Return both actual verse texts, precise token positions, original/transliteration/gloss, source chain, competing evidence, step-vs-endpoint support, provenance, licensing and checks that passed/failed. |
| **5. `compare_passages`** | Side-by-side comparison of 2–6 pericopes, including literary order, roles, distinctive shared imagery and important differences. | `references[]`, `focus`, `comparison=intertext|structure|vision|lexical|narrative`; bounded parallel aligned excerpt sets; shared/unique motifs and falsifiers; MT/LXX/Greek provenance where appropriate. |
| **6. `expand_research`** | Follow a symbol, verse, connection, motif cluster or open question deeper without repeating context. | `node_id|connection_id|research_cursor`, `direction`, `strategy=siblings|earlier_uses|later_uses|contrasts|evidence|unexpected`, `limit`. Return stable continuation IDs and local graph context. |
| **7. `test_interpretation`** | Test a *model-proposed* explicit claim or symbol interpretation against corpus evidence and rival explanations. | `claim`, `scope`, `anchors[]`, `predicted_witnesses[]`, `falsification_tests[]`, `controls`; server runs deterministic retrieval and returns support, contradictions, ambiguous cases, counterexamples, denominator/coverage, **not a theological verdict**. |
| **8. `read_research_notes`** | Retrieve human/AI commentary, reviewed DLM cards and open questions relevant to a claim/passage/word. | `subject`, `note_types[]`, `reviewed_only`, `limit`; always label `untrusted_commentary`, author/review, evidence class and original source anchors. No instruction-following from notes. |
| **9. `save_research_note`** *(write, never automatic)* | Single claim, user-authorized note or DLM card with exact anchors, hypothesis layer and provenance; versioned, deduplicated. | Explicit user request; scoped identity, idempotency key, optimistic versioning, source/evidence check, author, review state; default unreviewed. Preserve existing authorization/security rules. |

**Smaller default is not less powerful:** behind these tools the entire old graph, word occurrence, LXX, syntax, geography, chronology, note and search infrastructure stays callable by the *server*.

### 5.1 Suggested usage

- "What is Ezekiel 1 showing?" → `study_passage(profile=prophetic)` → `discover_connections(intent=prophecy)` → `inspect_evidence` → `compare_passages` → `test_interpretation`.
- "How do the two olive trees connect to Revelation?" → `study_concept(mode=symbol, query=olive tree)` plus scoped Zechariah 4 → `compare_passages` → `inspect_evidence`.
- "Find an unexpected pattern in Revelation 13" → `discover_connections(intent=surprise)` → `expand_research(strategy=earlier_uses)` → `test_interpretation`.
- "What is the physical DLM analogy of oil and light?" → `study_concept(mode=physical)` + `read_research_notes`; source empirical mechanism separately from biblical image and test any interpretive mapping.

### 5.2 Response size and usability

Do not return the complete corpus or huge nested JSON just because it exists.

**Default summary per discovery:** 1–3 sentences explaining mechanism; 1–3 strongest *actual verses* in readable English; selective original words with transliteration and gloss; evidence ID; relation category; validity/coverage warning; top next exploration routes. Expand on demand. A user should see Scripture immediately, not a list of reference numbers.

**Budget profiles** should be deterministic and documented (e.g. quick ~2–4 KB, analysis ~8–20 KB, deep pericope ~20–50 KB; hard limits/cursors). These are design targets, not verified current response sizes. Avoid silently dropping requested passages or missing critical caveats. Hoist repeated metadata and reuse source packet IDs.

Use stable machine-readable IDs and an evidence chain, not prose alone. All tools should include schema version, query normalization, exact data release, response completeness, `is_exhaustive`, coverage per layer, deterministic sort tie-breakers, pagination where needed, and errors distinguishing "not found", "not covered", "ambiguous", "restricted" and "runtime failure".

## 6. Prophetic-vision research: required reasoning pipeline

For prophetic passages the model must be able to answer **"What does the vision depict, how does the text itself interpret it, how is its imagery reused, and which claims remain interpretive?"**

1. **Read the whole unit first.** Visions frequently contain questions and explanations later in the chapter. Reading one vivid verse alone invites false symbol assignments.
2. **Extract a vision scene graph.** Nodes: seer, speaker, angel, living beings, artifacts, numbers, motions, throne/temple, actions and attributes. Edges: sees, speaks, carries, moves with, stands before, resembles, receives authority, worships, interprets.
3. **Search explicit interpretive statements first:** "these are…", "the meaning is…", "he said to me…", contextual referents, later identification by the same book. Attach verse and *the exact symbol occurrence*.
4. **Retrieve intertexts by distinctive image combinations**, not merely identical English words. A compound of *sea + four beasts + leopard/bear/lion + political dominion* is much more diagnostic than a one-word "beast" hit.
5. **Compare literary transformations.** Which roles, counts, actions or referents are retained, merged, reversed, intensified or omitted? A transformation is often the interesting finding.
6. **Test context and direction:** original audience, covenant/temple/exile/empire and composition setting; Hebrew↔LXX↔Greek textual differences, with no unsupported assumptions about an author's exact Greek Vorlage.
7. **Challenge the inference:** alternative antecedents, unrelated occurrences of the imagery, other meanings in context, counterexamples, source limitations and rival interpretive traditions.
8. **Output a layered conclusion:** what the passage explicitly says; strongly supported reuse; plausible theological/literary inference; debated interpretation; novel speculative DLM questions. Offer exact next passages to examine.

A computer can index and score candidate structures. An AI must compare them, but needs source evidence, exclusions and limitations at every hop.

## 7. Three acceptance examples (not predetermined theological answers)

These are **minimum capability demonstrations**, not a command to hardcode expected results or declare all proposed associations true.

### 7.1 Ezekiel 1 — living creatures, wheels, spirit and throne

**Starting passage:** Ezekiel 1:1–28; include the original context and the spoken/visual descriptions, not just wheels and gemstones.

**High-value retrieval paths:**
- **Ezekiel 1 ↔ Ezekiel 10:15–22:** Ezekiel 10 identifies the earlier living creatures as **cherubim**; this is an unusually important **explicit same-book interpretive anchor**.
- **Ezekiel 1 / Ezekiel 10 ↔ Revelation 4:6–8:** compare living creatures, throne, wings, eyes and doxology as a possible/reasonable literary convergence; **do not assert identical creatures or identical configurations** without qualification.
- **Ezekiel 1 ↔ Exodus 25 and 1 Kings 6–8:** examine the ark, throne, cherubim and temple imagery as bounded thematic comparisons; keep each object and function distinct.
- Analyze who/what moves, the repeated "spirit" clauses, throne position and how divine presence is represented. Do not map wheels to modern machines without independent textual evidence.

**Expected AI product:** scene/role diagram in text, explicit identification, ranked intertexts with original-language witnesses, a plausible interpretation of the throne-vision in its exilic setting, and a set of unresolved questions. Generic "wheel ↔ wheel" similarities must not dominate.

### 7.2 Zechariah 4 — lampstand, oil, eyes, Spirit and two olive trees

**Starting passage:** Zechariah 4:1–14, including Zerubbabel and the temple-rebuilding context.

**High-value retrieval paths:**
- **Zechariah 4:6:** the text explicitly says **"not by might ... but by my Spirit"**; it is part of the vision's explanation, not an optional lexical tangent.
- **Zechariah 4:10, 14:** seven eyes and two olive trees/anointed ones in their own discourse and historical setting.
- **Zechariah 4 ↔ Revelation 11:3–4:** compare two olive trees and lampstands. This is a **strong textual reuse** with changed framing; explain *similarity and transformation*.
- **Zechariah 4 ↔ Revelation 1:20; 4:5; 5:6:** distinguish each later image's **locally stated** meaning; avoid silently equating all lamps, eyes and sevenfold images.
- Explore the agency of oil, light, Spirit, supply, witness and rebuilding as a *candidate motif family*, with support classes.

**Expected AI product:** passage-first interpretation, mapping of all important vision entities and explanatory statements, side-by-side English/Greek/Hebrew support, continuity and differences into Revelation, and explicit uncertainty.

### 7.3 Revelation 13 — beasts, authority, worship, image, number and mark

**Starting passage:** Revelation 12:1–13:18 (read enough of the prior chapter for the dragon; optionally include Revelation 14 and 17–18 for later explanation/contrast).

**High-value retrieval paths:**
- **Revelation 13:1–2 ↔ Daniel 7:2–8, 17, 23–27:** compare sea, leopard, bear, lion, horns, dominion, persecuting power, heavenly court and kingdoms. **Whole-image composition beats isolated "horn" etymology.**
- **Revelation 12:9 ↔ 13:2:** the preceding chapter explicitly identifies the dragon; retain narrative scope and distinguish dragon from beast.
- **Revelation 13:14–15 ↔ Daniel 3:** image and coerced worship is a plausible structural analogy; compare actors, political setting and the direction of worship before classifying it.
- **Revelation 13:16–17 ↔ Revelation 7:3; 14:1; Exodus 13:9,16; Deuteronomy 6:6–8:** test mark/seal and hand/forehead as an intertextual **hypothesis** with rival explanations; do not automatically label it an explicit quotation or identity.
- **Revelation 13:18:** evaluate number interpretation as a bounded textual/historical question; manuscript variants such as 616 require properly sourced textual-variant evidence if available, never assumed coverage.

**Expected AI product:** interpretation of political/imperial and religious worship images in literary context, direct reuse versus hypothesis table, primary verses readable in English plus Greek, strongest negative controls, and fair distinction between preterist, historicist, futurist, idealist and mixed interpretations where relevant. No forced prediction of current people, technologies or dates.

**Minimum measurable success:** For each passage, the distinctive canonical links above should be retrievable and their relevant *verse texts* inspectable with only 2–5 ordinary AI-facing read calls; no new canonical or theological "facts" need to be generated by the server.

## 8. DLM-specific research contract: hypothesis layers and physical analogies

The present implementation's `study_dlm_research` prompt refers to **interpretive candidate layers 0–7**. `dlm-notes.ts` distinguishes `TEXT_EXPLICIT`, `TEXT_LINGUISTIC`, `TEXT_INTERTEXTUAL`, `TEXT_PATTERN`, `SCIENCE_EMPIRICAL`, `DLM_HYPOTHESIS`, `DISPUTED`, `OPEN`; it supports atomic note claims and separate empirical source URLs.

**Do not invent the definitions of layers 0–7.** The exact authoritative layer semantics are **not established by the inspected public files**. Before implementing layer-specific ranking or interpretation, obtain the user's authoritative DLM framework (including any local-only `DLM_Research.md`) and store a versioned layer registry. A layer number alone is not a scientific measurement, canonical textual sense, or confidence score.

### 8.1 Research chain for DLM

For a proposed DLM claim, capture **four explicitly distinct objects**:

1. **Textual observation:** exact biblical verse, language, word positions, action, narrator/quoted-speaker scope, what the Bible actually states, and source edition.
2. **Biblical connection:** other verses with an explicit identification, structural/thematic allusion, repeated word or interpretive comparison; textual evidence for each link; competing explanations.
3. **Physical/empirical mechanism:** what is actually known about oil combustion, optics, water, plant growth, vision, sound, movement, information transmission, etc.; scientific source, conditions, evidence strength and any known caveats. A physical property of the named object is **not proof** that a biblical writer intended an analogous physical theory.
4. **DLM interpretive mapping:** an explicitly labeled, revisable hypothesis connecting textual images to a DLM layer; what the mapping illuminates, what would disconfirm it, alternative mappings, scope and whether it depends on anachronistic knowledge.

Keep separate provenance and IDs for the four objects. The last depends on the others but cannot promote them into stronger claims.

### 8.2 Structured DLM card specification

Suggested required fields:

- `claim_id`, `claim_text`, `card_kind`, `epistemic_class`, `dlm_layer_id` plus `dlm_framework_version`.
- `scripture_anchors[]`: canonical verse ID, book/chapter/verse, optional word position, exact token/lemma/edition and text snippet.
- `biblical_evidence[]`: relation type, evidence ID, witness text, link warrant, independence group, support/contradiction.
- `empirical_evidence[]`: original URL/DOI, author/date, mechanism and test conditions, source license and strength (required only for SCIENCE_EMPIRICAL).
- `interpretive_mapping`: source image, target idea, transformation, limitations, alternatives and possible falsifier.
- `context`: genre, literary scope, earliest relevant setting, source/tradition distinctions and text-variant caveats.
- `review`: author (human/AI), status, review history, conflicts, version and visibility.
- `coverage`: corpus/source gaps, missing evidence, whether sampled or exhaustive, which falsification checks ran.

**Crucial constraint:** A DLM idea should become *more interesting* when connected to a genuine textual mechanism, yet *less certain* when the text does not justify the further physical/theological inference. The system should enable this distinction, not blur it.

### 8.3 Example: oil, lamps and Spirit

From Zechariah 4, one may investigate the lampstand fed by olive trees, the interpretive statement about Spirit (v. 6), and later reuse in Revelation 11. Separately one may retrieve empirically documented oil-lamp fuel and combustion properties. Only *then* propose any DLM analogy (e.g. a sustaining source enabling light/witness). The analogy must say exactly where it fits or fails; chemistry cannot demonstrate authorial intention or turn "Spirit = combustion" into an explicit biblical identity.

### 8.4 Notes security and scientific integrity

Treat human and AI notes as untrusted commentary/data, never executable instructions and never primary biblical witness. Only reviewed public DLM cards should receive default preferential retrieval; show unreviewed notes only when requested or clearly labeled. Distinguish private account notes from public research notes. Never write cards without explicit user authorization; preserve exact canonical anchors, idempotency, review, edits and audit logs.

## 9. Data models and API invariants

### 9.1 Evidence atom

Every claim-bearing witness requires `evidence_id`, `source_type`, `source_edition`, `release_id`, `canonical_reference`, `original_text_span`, `translation_text_span` (or documented unavailable), exact anchors, `relation_type`, `epistemic_class`, `source_uri`/dataset identity, `license`, `coverage_status`, and optional `counterevidence_ids`.

Possible classes: `TEXT_EXPLICIT`, `TEXT_QUOTATION`, `TEXT_ALLUSION_SUPPORTED`, `TEXT_STRUCTURAL_PARALLEL`, `TEXT_LEXICAL`, `TEXT_GRAMMATICAL`, `STATISTICAL_ASSOCIATION`, `INTERPRETIVE_CANDIDATE`, `EMPIRICAL_EXTERNAL`, `USER_NOTE`, `NOT_COVERED`. Map these to existing project classes without silently changing historical persisted values.

### 9.2 Research/path object

Separate **path edges** from the **endpoint claim**:
- exact normalized starting/ending entities and homograph/sense resolution;
- ordered path nodes and typed edge evidence;
- semantic continuity / scene or event co-reference;
- whether an independent witness directly supports the endpoint relationship;
- decisive evidence and *why it supports this specific proposed meaning*;
- conflicting evidence, alternative pathways and source coverage;
- calculated ranking factors distinct from epistemic validity;
- stable graph release, cursor and links to full witnesses.

**No transitive evidence laundering:** If A is associated with B, and B with C, the text has not thereby documented A↔C. The path is a research lead until the endpoint relationship is defended.

### 9.3 Suggested output shape (illustrative, not implemented)

~~~json
{
  "status": "ok",
  "schema_version": "proposed-1",
  "source_release": "...",
  "query": {"text": "Revelation 13", "intent": "prophecy", "scope": "Revelation 12:1–13:18"},
  "passage_summary": {"english_excerpt": "...", "source": "WEB", "coverage": "bounded"},
  "top_connections": [{
    "title": "Composite beasts and kingdoms in Daniel 7",
    "interesting_because": "The later vision combines several distinctive earlier beast images.",
    "relation": "supported_literary_reuse",
    "evidence_ids": ["real-server-evidence-id"],
    "witnesses": [{"reference": "Revelation 13:2", "text": "...", "tokens": []},
                  {"reference": "Daniel 7:3–7", "text": "...", "tokens": []}],
    "supports": ["shared specific imagery"],
    "differences": ["earlier text has multiple beasts; later vision merges characteristics"],
    "not_proven": ["identical application in every era"],
    "next_nodes": ["Daniel 7:17", "Revelation 17:9–14"]
  }],
  "coverage": {"text": "complete_for_requested_unit", "intertexts": "ranked_candidates"},
  "cursor": null
}
~~~

The example ID is a *placeholder*; never synthesize IDs in production. A claim with no real evidence ID must report `unverified`.

## 10. Candidate generation and ranking that matches AI research

**Query intent matters.** For passage-oriented and prophetic questions, do not globally rank all heterogeneous edge types on one numeric scale. Use a **hierarchical retrieval/ranking policy**:

1. **Mandatory local-context tier:** passage text, narrator/angel explanation, explicit referents, same-book continuation and direct later identification.
2. **Strong intertext tier:** explicit quotation, unusually distinctive composite imagery or strong literary reuse with contextual agreement, canonical witness evidence and supported chronological direction.
3. **Structural/interpretive tier:** parallel action/actor/object structures, contrast/reversal, literary transformation, independently recurring motifs. Keep interpretive status visible.
4. **Exploratory tier:** candidate multihop paths, rare correlations, etymological hypotheses and physical analogies. Never falsely label as source-established.
5. **Lexical background tier:** ordinary co-occurrences, generic grammatical edges and root neighbors unless *directly central* to the asked passage. Valuable for drill-down, but should not displace #1–3.

Within each tier prefer source specificity, meaningfulness, explanatory reach, independent witnesses, coherent semantics, originality and diversity. Penalize generic hubs, repetitive/duplicated witnesses, long disjoint edges, accidental surface overlap and evidence gaps. A high numerical graph score must **not** override a low evidence class or negate the user's passage intent.

Introduce a **research-value** ranking feature, separately from textual proof:
- **Relevance:** actually explains part of the requested passage.
- **Surprise:** nontrivial and not obvious from a one-word match (not a source of truth).
- **Explanatory power:** connects several distinctive features under one coherent mechanism.
- **Checkability:** can inspect *specific actual verses and original text*.
- **Independence:** not three rephrasings of the same source.
- **Generativity:** opens a useful next research question.
- **Epistemic honesty:** notes what is and is not established.

Never assign these subjective qualities fictitious probability percentages without calibration. Use ranking weights for *discovery priority*, not as theological certainty.

## 11. MCP protocol, cost and compatibility

- Expose a **small core catalog** at the normal ChatGPT/Gemini connection, and an **expert/compatibility catalog** at a separate documented endpoint or supported capability profile. Avoid relying on unimplemented dynamic hide/show behavior in clients. Preserve old tool names behind expert access until logs/tests confirm safe migration.
- Support MCP **tools**, **resources** (read-only schema guides, provenance/coverage manifests, DLM layer registry), and a few **prompts** (deep passage study; intertext comparison; DLM hypothesis challenge). Do not surface 22 similar templates to routine clients.
- Follow the current applicable official MCP specification and SDK implementation; protocol features and progressive discovery support vary by host. Prefer deterministic `tools/list`, compact descriptions, accurate read-only/destructive annotations, stable schemas and no credential exposure.
- Each core tool must have sharp selection guidance: *when to call it*, *when not*, expected result length, input disambiguation and a clear named next step.
- Keep versioned compatibility for older clients, tool schema regression tests, corpus routing controls, security boundaries and request-bounded Cloudflare CPU/response budgets.
- Use one server-side *composition layer* that assembles packets from existing indexed shards. Do not rebuild the entire corpus, transfer bulk immutable assets back to Supabase, or introduce paid model calls to perform deterministic retrieval.
- Cache immutable evidence per release; carry source SHA/edition into returned metadata; paginate large searches and permit explicit narrow hydration of selected witnesses.
- Preserve rights: original text licenses, translation licenses, restricted annotation omissions and external scientific source attribution. User-facing English text must be legally renderable.
- Never merge public read access with public unauthenticated write access as a side effect of tool consolidation; maintain explicit authorization and scoped write controls.

**Deployment note:** `MCP_SETUP.md` may have stale deployed-version wording relative to later release handoffs. Verify actual active MCP/corpus release before implementing or shipping.

## 12. Historical implementation roadmap (superseded by v2 Neon prompt)

**P0 — Measure before refactor (small):**
1. Snapshot actual `tools/list`, source registration, tool aliases, schema, current calls used by UI and scripts, deployed versions and note security.
2. Run the three prophetic cases on the current interface with saved top-K and compare with a baseline *model-only* answer; log missing verse content, redundant calls, failure attribution, wall-clock time and output size.
3. Build a route/migration table from every one of the 46 current functions to core tool, expert mode, internal operation or deprecated-after-verification. Do not delete anything prematurely.

**P1 — Build passage-centered retrieval first:**
1. `study_passage(profile=prophetic)` with pericope assembly, actual verse texts, scene inventory, explicit interpretation and ranked contextual cross-references.
2. `compare_passages` with exact source texts, literature/roles/structure and differences.
3. Add named symbol occurrences and source-scoped explicit interpretations. Avoid global forced symbol identities.

**P2 — Consolidate the research interface:**
1. Implement other six core read tools as thin, bounded adapters over existing R8/R9/R10/R12/SQL/Worker primitives, especially real evidence IDs.
2. Add `test_interpretation` retrieval and negative controls.
3. Compose DLM notes/physical sources with strict source class separation.
4. Offer separate core and expert MCP connection profiles, plus migration instructions and old-client compatibility.

**P3 — Independent tests and release:**
1. Make contract/integration/evidence-security tests deterministic.
2. Run a **small** internal smoke suite; reserve expensive 239-case independent R12 benchmarking for ChatGPT after deployment.
3. Publish all source and contracts in GitHub; deploy core endpoint carefully with rollback and refresh instructions.

**Avoid:** migrating the large corpus, expensive full benchmark loops, AI-generated source edges, wholesale tool deletion, unreviewed note promotion and breaking existing app integrations.

## 13. Evaluation protocol: does this make the model more insightful?

Evaluate **model without MCP vs current 46-tool MCP vs proposed core MCP** on the same unseen tasks, source permissions, model settings and time/token budget. Refrain from using only pre-known benchmark cases.

Measure:

| Dimension | What to observe |
| --- | --- |
| **Discovery quality** | How many strong, non-obvious *passage-relevant* connections appear in top 5–10, confirmed by human/independent blind evidence review? |
| **Grounding** | Percent of substantive claims with inspectable correct verse/word anchors and accurate textual scope; negative controls against invented links. |
| **Prophetic depth** | Finds explicit internal explanations before speculative parallels; correctly recovers Ezek 1↔10, Zech 4↔Rev 11 and Rev 13↔Dan 7, with differences and alternatives. |
| **DLM epistemic discipline** | No science→theology proof leap, no wrong physical claims, no unreviewed notes promoted as Scripture; hypotheses falsifiable and layer-versioned. |
| **Exploration effectiveness** | Can a model expand a promising symbol into 2–3 genuinely useful next branches without repeated full-context downloads? |
| **Completeness & honesty** | Explicit distinction of not covered vs no match; no claims of exhaustive study on sampled evidence. |
| **Efficiency** | Tools advertised, average tool calls, payload bytes/tokens, wall time, error/503 rate, cache hit rate and total model cost per *accepted* connection. |
| **Breadth** | Same performance on low-frequency motifs, ordinary verses, obscure prophets, homographs, MT/LXX variants, and non-vision narratives — not just the three showcase passages. |

Success is **not** a higher raw connection count. Success is an AI that finds, verifies and explains materially better discoveries with fewer actions and fewer false certainties. Add adversarial foils with superficial common vocabulary and ask the model to reject them.

## 14. Historical next actions (use v2 prompt for current plan)

1. Authoritatively define the 0–7 DLM layer registry with the project owner (source document, semantics and evidence criteria); *do not fill it by guesswork*.
2. Implement and unit-test `study_passage(profile=prophetic)` and `compare_passages` before rewriting every other tool.
3. Verify top-10 literary relevance for the three vision cases; require **readable actual verse texts** plus original-language anchors for decisive comparisons.
4. Expose coherent direct/indirect relationship classes; keep a candidate path from claiming undocumented endpoint fact.
5. Verify a new user can start with one ordinary-language question, get a meaningful insight, inspect the evidence and continue exploring in 2–5 ordinary calls.
6. Only then consolidate the remaining 46 → core/expert surfaces, preserving compatibility and permissions.
7. Deploy to existing free-tier infrastructure, provide rollback, and let independent ChatGPT perform full follow-up benchmark.

## 15. References and provenance

### Internal, inspected source
- [MCP tool registration](../../supabase/functions/bible-mcp/catalog.ts)
- [Research workflow / tool catalog](../../supabase/functions/bible-mcp/workflow-contract.ts)
- [R12/R9 relationship and universal discovery tools](../../supabase/functions/bible-mcp/relationships-v2.ts)
- [DLM evidence classes and note validation](../../supabase/functions/bible-mcp/dlm-notes.ts)
- [MCP setup and current architecture notes](../../MCP_SETUP.md)
- [Latest R12 independent evaluation handoff](R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md)
- [R12 benchmark diagnosis](R12_BENCHMARK_DIAGNOSIS.md)
- [Relationship evidence architecture](../../RELATIONSHIP_ARCHITECTURE.md)

### External background (not imported as canonical corpus)
- [MCP official specification — tools](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx) and [MCP server concepts](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/learn/server-concepts.mdx).
- [MCP roadmap: progressive discovery and toolset complexity](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/blog/content/posts/2026-08-22-mcp-roadmap.md).
- [USCCB Ezekiel 10](https://bible.usccb.org/bible/ezekiel/10), [Zechariah 4](https://bible.usccb.org/bible/zechariah/4), [Revelation 11](https://bible.usccb.org/bible/revelation/11), [Revelation 13](https://bible.usccb.org/bible/revelation/13), [Daniel 7](https://bible.usccb.org/bible/daniel/7): illustrative primary passages and annotated cross-references; their explanatory notes are commentary, not primary corpus proof.
- [G. V. Allen, "Textual Pluriformity and Allusion in the Book of Revelation: The Text of Zechariah 4 in the Apocalypse" (2015)](https://repository.up.ac.za/items/e1a028b8-bfd0-4872-b023-89a73d03667b): why textual plurality matters when comparing OT visions with Revelation.

**Bottom line (still valid):** Give an AI fewer, clearer research instruments — but each one must reveal *more of the right context and more checkable evidence*. The owner's current seven-function API controls what is returned, especially z passage/verse connections, x word connections, y etymology/similar spelling candidates, and optional real-world enrichment. For DLM and prophecy, optimize for **interpretable discoveries with explicit warrant**, not vocabulary matches, mystery claims or maximal tool count.
