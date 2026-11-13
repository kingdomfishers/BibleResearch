# BibleResearch — Deterministic Biblical Relationship Architecture (BibleOntology-informed)

**Design version:** 5.0 — 2026-11-11  
**Status:** Implementation specification; NOT a declaration that the new extractor, assets, UI, or MCP tools are deployed.  
**Primary objective:** Let someone click any biblical word, or query the MCP server, and discover **which other Hebrew and Greek words relate to it, how they relate, how often, and where the Bible demonstrates the relationship**—without an AI model generating the underlying relationships.  
**Primary implementation constraints:** Free datasets and software; low recurring cost; no new heavyweight graph database; no bulk immutable graph in Supabase; no AI-assisted corpus annotation; small independently testable implementation steps.

**Related project documents:** `ARCHITECTURE.md`, `PHASE_0_RECONCILIATION.md`, `RELATIONSHIP_IMPORT_HANDOFF_V3.md`, `TASKS.md`. **External reference implementation:** [Bible Ontology](https://github.com/bibleontology/bibleontology) (Apache-2.0 code, CC BY 4.0 graph/vocabularies with upstream attribution and field restrictions). This document supersedes the **design intent** of older `RELATIONSHIP_ARCHITECTURE.md` versions where they conflict. The source-controlled handoff, actual local project, live services, and corpus manifest must be rechecked before implementation. Existing interfaces and data are not automatically replaced by this specification.

---

## 0. Decisions already made — no need to re-ask

1. **Start with reliably extractable grammatical relations** (subject–verb, verb–object, indirect object, noun modification, possession), retaining existing lexical and proximity relations. Make adding new predicates and more precise rules easy.
2. **Include uncertain relationships, clearly marked** and filterable. High-precision relationships appear first. Unsupported ideas must not be presented as facts.
3. **Start with licensed, documented Hebrew–Greek lexical correspondences from the Septuagint**, not an expensive full token-by-token LXX alignment project.
4. **First UI is a grouped list of related words and evidence**, not a large graph visualization. Later views derive from the same data.
5. **Allow additional free linguistic datasets** when verified useful and legally compatible. Do not generate the foundational corpus with AI or require paid APIs.
6. **Compute offline** from existing original-language datasets. Serve compact precomputed results from Cloudflare. Retain Supabase for mutable research and permissions.
7. **Reuse BibleOntology’s proven deterministic MACULA structure builder selectively**, especially its source normalization, syntax role/head tables and clause/negation procedures. Treat its separately curated/AI-assisted claims as an **attributed external reference**, never native deterministic evidence by default.
8. **Do not let this project interrupt Phase 0** (Cloudflare corpus verification, 19-table Supabase reclamation, and preservation of newer deployed RPCs). Begin heavy graph work only against verified local/static corpus inputs; no destructive production SQL.

### 0.1 The MVP in one sentence

For a resolved lemma such as a Hebrew name for God, return: **verbs for which it is the grammatical subject, verbs for which it is an object, nouns it modifies or possesses, attested lexical relatives, attested LXX translation candidates, and simple contextual neighbors**—each separated by relation type, with source passages, counts, edition and uncertainty.

For two or more words, find **direct grammatical evidence** or **short, typed evidence paths**, without mistaking paths for a new theological statement.

### 0.2 What it is NOT

- Not a system that translates unknown biblical words perfectly from syntax alone.
- Not a claim that a grammatical subject is necessarily the physical agent of a completed action.
- Not a global ontology of every spiritual symbol or metaphor.
- Not a generative-AI pipeline that fills gaps with plausible-sounding edges.
- Not a forced seven-layer mapping of the Bible. DLM is a separate research overlay.
- Not a replacement for existing STEP lexical research, MACULA syntax research, or the current proximity score. It **adds typed evidence**.

---

## 1. Mental model: four evidence lanes and one query experience

The user sees one consistent *Related Words* tool, but the engine keeps four fundamentally different relationship lanes:

| Lane | What establishes a relationship | Example | Can it claim a direct grammatical relation? |
|---|---|---|---|
| **Grammatical** | A clause/tree links word occurrences with specified roles | God = subject of `create`; heavens = object of `create` in Gen 1:1 | Yes, at the specified **passage/role** scope |
| **Lexical** | Sourced lemma, root, morphology, lexical-sense or documented near-synonym relation | A lexeme derives from a documented root | No; etymology is not contextual action or synonymy |
| **Translation** | A sourced LXX lexical pair, with editions and counts | Hebrew lemma has Greek translation candidates | No; translation correspondence is not lexical identity |
| **Contextual** | Existing verse/clause/window co-occurrence counts | `A` and `B` often occur in the same verse | No; proximity has no direction or syntactic meaning |

A fifth **Textual/structural** lane may include precisely scoped source-based predications, comparisons, quotations and explicit identifications *only when a separately tested deterministic rule establishes them*. A sixth, opt-in **External attributed claims** lane can show selected BibleOntology exports, distinguished by provenance and voice; these may include editorial and AI-assisted judgments and are **not** part of our zero-AI generated evidence. A later **Research** lane overlays user/AI notes and hypotheses. Neither external claims nor private research are silently promoted to native grammatical fact.

**Crucial rule:** a ranking score can reorder results **within** a lane, but must never silently convert a weak lane into a stronger one. A high co-occurrence score cannot become `subject_of`, and an LXX correspondence cannot become `synonym_of`.

### 1.1 Two separate levels of grammatical information

- **Occurrence-level relation:** An exact source word at an exact passage occupies a role in an exact clause. Example: Genesis 1:1, token for God is the annotated subject of the creation verb. This is the authoritative extraction unit.
- **Lemma-level summary:** Group *compatible* occurrence-level relations by lexeme/lemma and count distinct supporting passages. Example: God → subject-of → create, supported by a specific set of passages.

Do **not** extract arbitrary word-to-word claims from a lemma summary. The actual subject, predicate and object in one statement must come from the **same clause/frame**, not from independently aggregated global word lists.

### 1.2 Grammatical facts versus semantic conclusions

`God grammatical_subject_of create` is a grammatical observation supported by annotation. `God created heavens and earth` can be rendered as a statement **at the scope of Genesis 1:1** if the clause structure supports all participants and context checks pass. `God is always the creator of anything called light` is not a grammatical consequence.

Always retain source voice and context where determinable. In ambiguous quotations, negatives, imperatives, passives, questions, predictions and figurative descriptions, prefer **an accurately limited grammatical edge** over a falsely certain world-level fact.

---

## 2. Baseline: existing project data and important gaps

**Read-only Supabase snapshot, 2026-11-10; values can change.**

| Data | Verified row count or status | Practical implication |
|---|---:|---|
| `canonical_entities` | 82,485 | Already contains stable registry for word form, lemma, lexeme, root, sense, passage, concept, place, chronology event and research node |
| `entity_relationships` | 15,642 | Primarily lexical-root and place associations; **not** the target action graph |
| `relation_types` | 22 | Existing predicate vocabulary; reuse for compatibility, avoid changing meanings silently |
| `assertions` | 7 | Small curated benchmark; not a whole-Bible semantic analysis |
| `macula_hebrew_morphemes` | 475,911 | Hebrew/Aramaic morphology and source references; **not** sufficient by itself for full clause parsing |
| `macula_greek_tokens` | 275,520 across Nestle1904 and SBLGNT | Two editions, **not** twice the number of independent NT occurrences |
| Nestle1904 tokens | 137,779 | One supported Greek analysis track |
| Nestle1904 Greek role annotations | 46,782 tokens | Useful grammatical clues; roles may occur on phrases rather than every token |
| Nestle1904 Greek `frame` field | 25,493 tokens nonempty | May help later; parse only when understood, licensed and tested |
| `syntax_nodes` | 125,010 | Imported nested syntax structure, not necessarily a complete original-source import |
| Distinct verses in `syntax_nodes` | 4,063 | ~13% of 31,203 canonical verses **in this table**, NOT verified source-file limit |
| `hebrew_lxx_word_alignments` | 9 | Existing curated **word-level** Hebrew–LXX alignments are extremely sparse |
| `verses` | 31,203 | Includes Psalm superscription/verse-zero conventions |

Other established sources include STEP forms/lexemes/senses, MACULA Hebrew trees, MACULA Greek trees, text editions, verse mappings, and a precomputed proximity score. **Existing `words` (150,105 historically) is a form inventory, not an individual-token occurrence table**; do not use form IDs as unique occurrence IDs.

### 2.1 Technical and deployment boundary

The project's current corpus delivery architecture uses **Cloudflare Workers Static Assets**, with an `ASSETS` binding; do not presume the production corpus is served from R2. Cloudflare holds published immutable source assets. Supabase holds mutable research, notes and permissions. In the current storage-reclamation workstream, 19 large Supabase tables are proposed for removal **only after** Cloudflare parity, dependency cutover and recovery are verified.

The following existing live SQL functions were identified as direct consumers of proposed removal tables and need preserved contracts/bridges as part of Phase 0:

- `research_passage_lens_v1`
- `research_word_lens_v1`
- `research_word_bridge_v1`
- `get_dlm_notes_for_verse_v1`
- `verify_dlm_lemma_occurrence_v1`

**Do not deploy the graph builder into production or drop those tables as a shortcut.** Build against local verified static inputs and keep new v2 functionality additive. Existing `research_relationships_v1` is live and is **not** the new API described below.

---

## 3. Free sources: exact use, limits, licensing and priority

All ingestion must be from a **pinned local download / verified corpus snapshot**; no paid services or live external API dependency at query time.

| Priority | Source / address | Use | Initial decision |
|---|---|---|---|
| **Required** | [MACULA Hebrew](https://github.com/Clear-Bible/macula-hebrew), `WLC/lowfat` or `WLC/nodes` | Hebrew/Aramaic syntax-tree clause/phrase/terminal roles, token source IDs, morphology, usable referents | Main Hebrew grammatical input; preserve exact source hierarchy |
| **Required** | [MACULA Greek](https://github.com/Clear-Bible/macula-greek) | NT syntax, roles, source token IDs, morphology, selected licensed frame fields | Main Greek input; choose **one** counted primary Greek edition and keep others independent |
| **Required** | [STEP Bible data](https://github.com/STEPBible/STEPBible-Data) | Lexeme/lemma/Strong's identity, original occurrences, lexical descriptions, documented word relations | Lexical foundation; reuse current verified imports and namespaces |
| **Already present** | Existing BibleResearch lexical roots/`entity_relationships` | Documented lexical relations | Reuse; do not regenerate all-pairs synonym cliques |
| **Candidate, cheap** | [BCV Hebrew Lexical References: `lxx_bridge.tsv`](https://huggingface.co/datasets/bcv-commons/hebrew-lexical-references/blob/main/lxx_bridge.tsv) | Hebrew–Greek **lexical translation candidates** with reported frequency | Audit file provenance and license, pilot import; does **not** provide verified token-by-token alignment |
| **Candidate, cheap** | Same [BCV dataset card](https://huggingface.co/datasets/bcv-commons/hebrew-lexical-references) (`bdb_roots`, `tomim_parallelism`, optionally `hwn_synsets`) | Additional documented roots, poetry parallelism; modern-Hebrew synsets only as labelled cross-domain suggestions | Import only if needed and source rights check passes; **never assume biblical synonymy** |
| **Optional validation only** | [UD Ancient Hebrew PTNK](https://universaldependencies.org/treebanks/hbo_ptnk/) | Reference dependency labels for selected Hebrew passages | CC BY-NC; exclude public/commercial derived export until license decision |
| **Optional validation only** | [UD Ancient Greek PROIEL](https://universaldependencies.org/treebanks/grc_proiel/) | Independently annotated Greek dependency relations | CC BY-NC-SA; license compatibility check before distribution |
| **Optional validation only** | [ETCBC/BHSA](https://github.com/ETCBC/bhsa) | Independent Hebrew clause/phrase annotation checks | License/attribution and actual coverage verification required |
| **Reuse-first (required audit)** | [BibleOntology repository](https://github.com/bibleontology/bibleontology): `tools/builder/`, `tools/builder/tables/` | Deterministic MACULA clause parsing, role/head rules, negation, selected discourse/reference handling, regression examples | Pin exact upstream commit; adapt **only validated modules**; code Apache-2.0. Do not automatically adopt generated entity claims. |
| **Optional attributed data** | BibleOntology `out/export/{claims.trig.gz,entities.ttl.gz,ties.trig.gz,card-words.trig.gz}` and `out/ns/*.ttl` | External reviewed/mixed-provenance claim examples, entities, word cards, relation vocabulary and schema validation ideas | Data CC BY 4.0 + upstream terms; opt-in *external attributed* lane, **not deterministic native edges**. Published export is not an authoritative lexical alignment. |
| **Not MVP** | New generic NLP/LLM parser, paid semantic APIs, vector embedding service, training a transformer, full Hebrew–LXX token alignment | These add cost or uncertainty without proving core value | Postpone indefinitely unless measured need |

**Free to download is not the same as freely redistributable or commercially reusable.** Before copying *any source field* into public assets, audit the pinned dataset's field-specific rights. Existing project exclusions include restricted STEP/TBESH `Meaning` material, MACULA SDBH/MARBLE / Louw-Nida-derived restricted domain data, uncleared `greekstrong`, and `s21` material from cross-reference sources. Exclude restricted values **before** cache, build output, tests and logs. Source labels can be retained only where their own rights permit. Use `field_license_registry` as source of truth, updating it only through reviewed migration.

**About the proposed LXX shortcut:** The BCV dataset card currently describes `lxx_bridge` as ~3,301 Hebrew–Greek Strong's pairs with count ≥3. That is a **publisher-supplied dataset claim**, not a validation performed in BibleResearch. Independently verify pair semantics, count denominators, Greek lexical normalization, source edition, alignment method and a few test cases. Import as `translation_candidate`, not `exact_word_alignment`. Drop or downrank demonstrably noisy pairs. If provenance cannot be verified, omit this optional dataset; the grammatical MVP still works.

### 3.1 No whole-Bible live API calls

The offline builder downloads/imports from pinned sources only when a release changes. The website and MCP query **our own static index**. No network call to external linguistic APIs is required for every user query. All source timestamps, hashes, licenses, attribution and transforms go into a manifest.

### 3.2 Choosing the primary Greek edition

Pick the edition used by the existing, verified STEP/MCP research path where possible; keep its mapping to MACULA explicit. MACULA provides `macula-greek-nestle1904` and `macula-greek-sblgnt`; **neither is silently identical to STEP's NA28-membership corpus**. Default initial graph extraction to `macula-greek-nestle1904`, with source-visible evidence; never silently project a word or grammatical role across variants. Do not count both Greek editions as two Bible occurrences in aggregated statistics.

---


### 3.3 BibleOntology reuse policy — what actually exists

**Verified repository reference, 2026-11-11:** [bibleontology/bibleontology](https://github.com/bibleontology/bibleontology). These paths are observed in the public repository; the **implementing agent must pin a commit and verify that exact snapshot** before adopting code. Avoid dynamically importing GitHub `main` during builds.

| Priority | Upstream component (source path) | Reuse decision | Guardrail |
|---|---|---|---|
| **P0** | `tools/builder/source.py` (S0) | Adapt canonicalized MACULA word/phrase input. The original normalizes Hebrew and Greek into one structure, preserves source XML IDs and morphology. | Keep our exact source editions, canonical mapping/version, raw strings and field allowlist; its Unicode lexical normalization is **for searching**, not lemma identity. |
| **P0** | `tools/builder/s1_clauses.py` (S1) | Adapt phrase/clause parsing and role assignments. It separates content, role fillers, clause complexes and coordination. | Recheck all source tree labels and head selection on pinned MACULA data. Unknown or unlisted head patterns become `candidate/unsupported`, **not** confident edges chosen by fallback first-child heuristics. |
| **P0** | `tools/builder/tables/hebrew/heads.json`, `tools/builder/tables/greek/heads.json` | Reuse the curated rule-to-phrase-head, coordination, prep and wrapper mappings. | Use the matching upstream code version. Preserve source-specific rules and `null` structural words; don't claim all possible phrase rules are covered. |
| **P1** | `tools/builder/s2_s3.py`, `tables/*/lexicon.json` | Select tested rules for negation, clause force, conditional/causal/contrast connectives. | Retain clause/verse scope; nonliteral causality and clause-link meaning stay uncertain. Hebrew waw does not always mean the same logical link. |
| **P1 optional** | `tools/builder/s4_s5.py` | Reuse **candidate** speech-turn and referent logic when validated. | Its own comments describe cases of wrong subject carryover. Do not silently accept implicit pronoun resolution, quotation boundaries or paragraph links as verified identity. |
| **Optional, separate** | `tools/builder/s6_readings.py` | Consider only for translation-specific disambiguation after a rights and precision audit. | Depends on BSB translation alignments. A translation reading is a **separate reading**, never an original-language grammatical annotation. Not needed for MVP. |
| **Reference only** | `tools/builder/build.py` | Use upstream sequencing as the reference pipeline. | Do **not** use upstream `--install` to replace BibleResearch data; emit our own deterministic intermediary and versioned assets. |
| **Reference only** | `out/ns/relation.ttl`, `out/ns/structure.ttl`, `out/ns/claim.ttl`, `out/ns/shapes.ttl` | Borrow a small, well-defined typed vocabulary and validation ideas. | A vocabulary name is not source evidence. Avoid a mandatory RDF/SPARQL server. Only add predicate types our extractor can actually support. |
| **Reference only** | `tests/test_assertion_policy.py`, `tests/test_export_shapes.py`, `tests/test_verse_structure.py` | Reproduce the **principles** of checking voice, typed endpoints, source spans and negative cases. | Upstream README reports a known red structure test suite; never claim upstream passes completely or inherit those failures as ours. |
| **P2 opt-in** | `out/export/claims.trig.gz`, `entities.ttl.gz`, `ties.trig.gz`, `card-words.trig.gz` | Evaluate as a **small external evidence/reference overlay** to improve concept discovery. | Many claims/readings have editorial or AI-assisted provenance, which violates our **native zero-AI corpus** rule. Preserve original credit/voice/certainty; default OFF in canonical evidence claims. |

**Two independent licenses:** BibleOntology's *code* is Apache-2.0; its published ontology, vocabularies, graph and text are CC BY 4.0. Reuse must retain the relevant license and notice, identify the upstream commit, attribute **Bible Ontology by Doug Egge (bibleontology.org)**, and separately obey the licenses and field restrictions of MACULA/STEP/WordNet/translation inputs. Reusing Apache code does **not** license all of the graph's underlying text. Do not copy restricted source fields from a published intermediary into public Cloudflare data without verification.

**Minimum viable adoption:** S0 + S1 + curated head tables, wrapped behind our canonical IDs. Add S2/S3 only if they improve test fixtures. Add S4/S5 only as candidate enrichment. Evaluate published RDF exports after the native grammatical search works, not as a prerequisite. Python is acceptable for the **offline** builder because the upstream code is Python and this saves implementation time; keep the runtime Worker/MCP in existing TypeScript. Do not translate hundreds of lines to TypeScript solely for code uniformity.

**Upstream reliability caveat:** The repository README reports some known failing structure regression tests. Run relevant upstream tests on the pinned commit, record failures, and add our own small passage fixtures. Neither its grammar builder nor its published claims provide guaranteed whole-Bible semantic correctness.

### 3.4 Precisely what we do **not** adopt

- No upstream runtime server, ~2 GB in-memory index, SPARQL server or Neo4j service. Our production runtime remains existing Cloudflare Static Assets/Worker plus Supabase's mutable data.
- No wholesale renaming of existing STEP/MACULA IDs, Supabase `canonical_entities`, source editions, note anchors, or verse mappings. Create a **crosswalk** instead.
- No direct ingestion of arbitrary BibleOntology `claims`/`ties` into `entity_relationships` as textually proven relations. Its curated graph is **not** identical to the deterministic grammar builder.
- No requirement to read AI-generated judgments, make model calls or create human/AI notes while building the native corpus.
- No dependency on a complete semantic-frames ontology, automatic whole-Bible pronoun resolution, or proof that every BibleOntology card/word connection expresses theological identity.

## 4. Data model: no extra large PostgreSQL tables

**Deployment:** one *logical* graph composed of immutable versioned Cloudflare graph files plus a small authorized Supabase research overlay. No new Neo4j, RDF server, paid database or duplicated massive PostgreSQL occurrence tables.

All v2 contracts are defined at the **asset/API level** first (TypeScript interfaces and validated JSON/JSONL schemas). Only introduce a new small Supabase table when a real mutable use case requires it. Never alter the meaning of current `relation_types` or `entity_relationships` rows to fit the new graph.

### 4.1 Core identity types

| Logical object | Required identity | Explanation |
|---|---|---|
| `source_release` | pinned dataset + file path + SHA-256 + edition | Exact attribution, license, extraction inputs |
| `passage` | source-edition local reference + canonical verse-map references | Preserve Psalm headings, shifted verses, split/combined ranges |
| `token_occurrence` | source edition + source token/XML ID **or** stable source token ordinal | Unique *occurrence* of a word in a passage; never use a word-form ID alone |
| `morpheme` | token ID + source component order | Hebrew prefixed articles/conjunctions etc. not silently collapsed |
| `lemma` / `lexeme` | existing canonical entity key + full source identifiers | Lexical item, including distinct homographs and original language |
| `lexical_sense` | source sense ID scoped to lexeme | Dictionary meaning candidate; **not automatically the sense used at each occurrence** |
| `syntax_node` | edition + original source tree/node ID | Clause/phrase hierarchy, role, span and head candidates |
| `grammatical_frame` | edition + source clause ID + rule version | Verb/predicate and its grammatical participant roles in **one clause** |
| `occurrence_relation` | frame ID + role + exact occurrence anchors + rule ID | Evidence that a word occupies a role with respect to another occurrence |
| `lexical_relation` | exact canonical lexeme/lemma endpoint keys + source type | Original-language root, derivation, cognate, gloss distinction etc. |
| `translation_relation` | Hebrew lexical identity + Greek lexical identity + source release | LXX lexical correspondence with counts and uncertainty |
| `context_stat` | versioned corpus + context definition + pair of lexical identities | Undirected proximity/statistical association; not syntax |
| `relation_summary` | source/target lexical IDs + predicate + edition/corpus + qualifier bucket | Grouping of *compatible* occurrence relations for fast lookup |
| `graph_manifest` | immutable graph release | Hashes, source versions, counts, excluded fields, coverage, rule versions |
| `structure_node` / `structure_edge` | original MACULA XML ID + BibleOntology builder stage + scoped edge ID | Optional intermediate for clause complexes, coordination, role/negation/voice extraction; exact upstream source reference and extractor version. |
| `external_claim` | namespaced BibleOntology claim URI / graph URI | **Optional** imported claim with original voice, provenance, source passages, review/certainty and external license; never a native grammatical claim. |
| `foreign_entity_crosswalk` | `(external_source, external_key, corpus_release)` | Exact/ambiguous/unmapped mapping to our lexical and concept registry. Never equate entities by English label alone. |
| `passage_association` | source passage + explicit relation/scene link | Source-backed same-passage association when direct syntax cannot connect two concepts; separate weak lane, not a semantic identity. |

The existing `canonical_entities` and `entity_relationships` remain valid **small relational registries**. High-volume occurrences, frames and relation summaries are published as Cloudflare shards, not inserted into `entity_relationships` in bulk.

### 4.2 Stable ID and normalization rules

- Prefer existing canonical `entity_key` for lemmas/lexemes/senses. Example of a new *logical key form* (not an asserted existing ID): `lemma:step-hbo:H0430G`.
- Occurrence: `tok:<edition>:<source-id>`; if no stable source token ID exists, use edition + exact source file + passage + position + component and record mapping quality.
- Frame: `frame:<edition>:<source-clause-id>:<extractor-rule-id>`; append a stable disambiguator if source clause keys collide.
- Relation occurrence: `rel:<frame-id>:<predicate>:<role-anchors>`; ensure source IDs are escaped unambiguously.
- **Identity is not a short hash.** Store full structured key and full SHA-256 of canonical serialized evidence; short hashes are indexes/filenames only, with collision detection.
- Preserve raw `H0430G`, `H0430`, uStrong and disambiguated STEP forms. User-friendly aliases (`H430`) are searches, not identity-merging keys.
- Keep `hbo`, `arc`, `grc` separate; English gloss text never acts as an unambiguous ID.
- PostgreSQL `bigint` IDs serialize as JSON strings. Preserve source attribution and source edition on all crosswalks.
- Unicode normalization applies to **lookup**, not destructive replacement of raw Hebrew vowel points, Greek accents or original source spelling.
- Unique token ID is edition-specific. A Nestle1904 token and an SBLGNT token remain two evidence tracks even when their visible forms match.

### 4.3 Schema specification: `GrammaticalFrameV2`

A frame is an annotation about one clause, not automatically a claim that the event happened.

```json
{
  "frame_id": "frame:macula-hebrew-wlc:Gen.1.1:clause-01:svov1",
  "schema_version": "2.0",
  "source": {
    "edition": "macula-hebrew-wlc",
    "source_release": "<pinned-release-id>",
    "source_file": "<actual-source-file>",
    "clause_node_id": "<actual-xml-node-id>",
    "reference": "Gen 1:1",
    "canonical_verse_ids": ["<actual-canonical-verse-id>"],
    "alignment_status": "native_source"
  },
  "predicate": {
    "token_id": "<actual-token-id>",
    "lemma_id": "<resolved-lemma-key>",
    "source_form": "בָּרָא"
  },
  "roles": [
    {"role": "grammatical_subject", "head_token_id": "<god-token>", "lemma_id": "<elohim-lemma>", "source_phrase_id": "<subject-node>", "state": "explicit"},
    {"role": "grammatical_object", "head_token_id": "<heaven-token>", "lemma_id": "<heavens-lemma>", "source_phrase_id": "<object-node>", "state": "explicit"},
    {"role": "grammatical_object", "head_token_id": "<earth-token>", "lemma_id": "<earth-lemma>", "source_phrase_id": "<object-node>", "state": "explicit"}
  ],
  "context": {"polarity": "uncertain", "modality": "assertive", "voice": "active", "speaker_scope": "narrator_candidate", "quotation": "unknown", "figurative_scope": "unknown"},
  "extraction": {"algorithm": "macula_clausal_roles", "rule_version": "1.0", "quality": "source_explicit", "warnings": []}
}
```

**The angle-bracket strings are placeholders, not verified IDs.** For a real extraction use the exact source clause/token ID; never invent these values. The example is a description of the expected output structure, not a claim that the release has already produced it.

**Important:** `uncertain` polarity is not a positive assertion, and `assertive` modality is not the same as `completed_action`. Do not infer actual creation events from a command/prediction or from an unreviewed clause status.

### 4.4 Schema specification: `OccurrenceRelationV2`

```json
{
  "relation_id": "<stable-relation-id>",
  "frame_id": "<stable-frame-id>",
  "subject_token_id": "<source-subject-token-id>",
  "subject_lemma_id": "<subject-lemma-id>",
  "predicate": "grammatical_subject_of",
  "object_token_id": "<source-verb-token-id>",
  "object_lemma_id": "<verb-lemma-id>",
  "evidence": {"edition": "<edition>", "reference": "Gen 1:1", "source_clause_id": "<clause-id>", "rule_id": "he_clause_s_v_v1"},
  "quality": "source_explicit",
  "qualifiers": {"polarity": "uncertain", "modality": "assertive", "voice": "active"}
}
```

Use the **grammatical** name `grammatical_subject_of` instead of `agent_of` by default. Passive voice, stative predicates and quoted claims show why grammatical subject and semantic agent are not equivalent.

### 4.5 Schema specification: `RelationSummaryV2`

```json
{
  "from_lemma_id": "<god-lemma-id>",
  "relation_type": "grammatical_subject_of",
  "to_lemma_id": "<create-lemma-id>",
  "scope": {"source_edition": "macula-hebrew-wlc", "language": "hbo"},
  "stats": {"occurrences": 0, "distinct_passages": 0, "distinct_books": 0},
  "quality_counts": {"source_explicit": 0, "rule_derived": 0, "candidate": 0},
  "context_counts": {"negated_or_uncertain": 0, "command_or_prediction": 0},
  "evidence_ids": ["<actual-evidence-id>"],
  "coverage": {"eligible_clause_count": 0, "processed_clause_count": 0},
  "source_release": "<graph-release>"
}
```

Count fields above are **schema examples**, not claims about actual occurrences. For each aggregate, compute counts from verified `OccurrenceRelationV2` records. Avoid shipping a `relation_summary` without a resolvable evidence index. Store *all* evidence IDs in paginated shards; only the first few in the default response.

### 4.6 Translation relations and lexical candidates

```json
{
  "from_lexeme_id": "<hebrew-scoped-id>",
  "predicate": "lxx_translation_candidate",
  "to_lexeme_id": "<greek-scoped-id>",
  "source": {"dataset": "bcv-lxx-bridge", "release": "<verified-pin>", "source_record": "<record-key>"},
  "published_pair_count": 0,
  "pair_count_unit": "publisher_reported_alignment_attestation",
  "evidence_level": "lexical_pair_reported",
  "word_level_source_alignment": false,
  "status": "candidate",
  "limitations": ["not synonymy", "not token alignment", "verify source methodology"]
}
```

Strong numbers in external pair data must resolve to **a candidate set** of local lemmas/lexemes. If multiple homographs resolve, retain ambiguity instead of arbitrarily selecting one. Counts from a published pair dataset are **not** counts verified against the local biblical text; label separately.

### 4.7 Optional small data definitions

In TypeScript define schemas, validators and a registry; do **not** first create a large set of SQL tables:

```
GraphNode = { id, kind, label, language?, source_ref?, aliases? }
GrammaticalFrame = { frame_id, source, predicate, roles[], context, extraction }
OccurrenceRelation = { relation_id, frame_id, from_token, predicate, to_token, evidence, quality, qualifiers }
RelationSummary = { from_lemma, predicate, to_lemma, scope, counts, quality_counts, evidence_ref }
TranslationPair = { from_lexeme, to_lexeme, source, reported_count, status, limitations }
CoverageRow = { edition, book, clauses_seen, clauses_eligible, frames_extracted, reasons_skipped, source_rights }
```

Keep JSON schema versions independently from extractor rule versions and corpus asset release IDs. Every manifest declares compatible versions. Backward-compatible additive fields are allowed; changes to semantics or roles require a new schema/rule version.

---


### 4.8 BibleOntology intermediate and crosswalk contracts

The canonical BibleResearch identities **remain authoritative**. The optional BibleOntology importer must never assume an upstream entity URI equals our canonical entity, even when labels match. Map on strong evidence in this order:

1. **Original-language occurrence:** exact MACULA XML ID **and** pinned edition/release; inspect source split/combined morpheme mapping. A matching verse number alone is insufficient.
2. **Lexical identity:** existing STEP lemma/lexeme/Strong's **including disambiguating suffix, original language and homograph**. Retain multiple candidates when the upstream identifier is coarser.
3. **Passage:** existing sourced versification/verse mapping, including Psalm headings/verse zero and source-only verses. Mark `exact`, `split`, `merged`, `edition_only` or `unmapped`.
4. **Named concept/entity:** a separately justified named-entity equivalence, never an English display-name match or shared translation gloss.

Suggested typed records (JSON/TypeScript contracts; **not SQL migrations**):

```json
{
  "external_key": "<upstream-entity-uri>",
  "external_source": "bibleontology",
  "source_commit": "<pinned-commit>",
  "mapping": {"target_entity_key": null, "status": "unmapped", "method": "none", "alternatives": []},
  "source_license": "CC-BY-4.0",
  "upstream_notice_required": true
}
```

```json
{
  "external_claim_id": "<full-upstream-claim-URI>",
  "external_source": "bibleontology",
  "voice": {"kind": "<narrator|character|editor|reader>", "speaker_ref": null},
  "statement": {"subject": "<external-id>", "predicate": "<external-predicate>", "object": "<external-id>"},
  "evidence": [{"upstream_reference": "<source-passage>", "local_mapping_status": "unmapped"}],
  "certainty": "<upstream-certainty>",
  "provenance_class": "external_mixed_method",
  "native_relation": false,
  "rights": {"license": "CC-BY-4.0", "attribution": "Bible Ontology by Doug Egge (bibleontology.org)"}
}
```

For upstream graph exports, RDF 1.1 `claims.trig.gz` keeps voices in named graphs; a plain triple under a character's graph **is not** a narrator assertion. Parse claims and their metadata, **not** unscoped default-graph unions. Keep editorial grouping, computational ties, reader interpretations and literal narrator claims separate. The optional importer should be a self-contained module with a feature flag and be disabled by default until this policy is tested.

**Source-level reproducibility:** `manifest.sources[]` must include both MACULA/STEP pins and `bibleontology` code commit, copied file checksums, notices, extracted ruleset version, and a field-level transformation list. A user can inspect the original MACULA verse even if the BibleOntology code later changes.

## 5. Extensible relationship vocabulary: **registry + separate extraction rules**

Define **one versioned predicate registry** in source control (for example `src/relationships/predicate-registry.ts` or a JSON schema loaded by it). Every extracted edge must use a registered predicate. Each predicate declares:

```json
{
  "id": "grammatical_subject_of",
  "lane": "grammatical",
  "description": "Source occurrence is grammatical subject of predicate occurrence in a specific clause",
  "from_kinds": ["token_occurrence"],
  "to_kinds": ["token_occurrence"],
  "direction": "directed",
  "inverse_label": "has_grammatical_subject",
  "evidence_requirements": ["source_clause", "role_annotation", "source_token_links"],
  "aggregation": "lemma_pair_with_qualifiers",
  "default_quality": "candidate",
  "transitive": false,
  "eligible_for_cross_claim_inference": false,
  "minimum_rule_version": "1.0"
}
```

The inverse **display** may be generated at query time; never store a duplicated reversed fact with a different claim ID. Semantic endpoint validation must be enforced in the compiler. `from_kinds`/`to_kinds` apply to **occurrence-level** relations; lemma-level summaries use derived lexical endpoints and retain evidence.

### 5.1 Initial grammatical predicates

| Predicate | Direction in occurrence graph | Requirement | Caveat |
|---|---|---|---|
| `grammatical_subject_of` | Subject → finite/nonfinite predicate | Same sourced clause, subject-role and verb/predicate head verified | Subject is not always agent; may be passive or stative |
| `grammatical_object_of` | Object → predicate | Same clause, unambiguous object-role and predicate | Does not mean the object undergoes a completed event |
| `grammatical_indirect_object_of` | Indirect object → predicate | Explicit `io` or documented equivalent | Recipient/beneficiary not always proven |
| `grammatical_second_object_of` | Second object/complement → predicate | Explicit `o2` or equivalent; preserve subtype | No automatic role coercion |
| `modifies` | Modifier → modified nominal/head | Sourced phrase head/attachment with accepted modifier structure | Adjectival modification ≠ universal property |
| `possessive_construction_with` | Possessive/genitive expression → possessed/head | Verified construct chain/genitive or source-based construction | Genitive often marks relationship other than ownership; show **grammatical genitive**, not legal possession |
| `grammatical_predicate_of` | Predicate nominal/adjective → subject | Source-attested copular or nonverbal predication | Does not make two lexemes globally identical |
| `attached_preposition_to` | Preposition phrase → head/predicate | Source phrase attachment + head known | Don't guess semantic role from preposition alone |

**MVP required:** first five, plus `possessive_construction_with` if reliable source rules are available. Others are incremental, registry-driven extensions. No requirement to finish all cases before the first useful release.

### 5.2 Existing lexical and contextual predicates

Keep existing imported relation names and semantics (for instance `derived_from_root`, `source_provided_lexical_equivalent`, `aramaic_cognate_of`, `spelling_or_form_variant_of`, `attested_at_place`, etc.). Present them under the **lexical/reference** lane. Do not rename database rows or reinterpret their epistemic status merely to make the UI consistent.

Preserve `cooccurs_in_verse`, `cooccurs_in_clause` (only where clause segmentation is known), and `near_in_tokens` as statistical results under the contextual lane. Preserve the existing score as `legacy_proximity_score` until replacement scoring is validated.

Add `same_passage_association` for independently confirmed occurrence spans **as a weak association, not an action/identity claim**; add `explicit_textual_identification` or `explicit_comparison` only when a narrowly tested syntactic/copular/analogy rule retains its full discourse scope. These may enable Spirit–lamp/eye exploration without interpreting every figurative relation.

Add `lxx_translation_candidate` only after the candidate dataset passes checks. A `word_alignment_verified` predicate is a **different, future** relation requiring exact source and target token evidence.

### 5.3 Future predicates are cheap to add if isolated correctly

Later rules may emit `explicit_comparison`, `negated_predication`, `temporal_before`, `purpose_clause`, `cause_clause`, `conditional_clause`, `explicit_symbol_identification`, `semantic_agent`, `semantic_patient`, `participant_reference`, `quotation_attribution`, etc.

**Adding a predicate should require only:** (1) registry entry; (2) source-field/role mapping; (3) targeted deterministic extractor; (4) positive, negative and ambiguous fixtures; (5) manifest version bump and incremental build. No redesign of IDs, storage schema, UI or MCP.

**Never assume:** a new predicate label means it can be reconstructed from existing data. Each rule explicitly declares what source annotation is sufficient and how missing evidence is reported.

---

## 6. Exact offline extraction algorithm — start small, scale safely


### 6.0 Reuse-first extraction plan (replace bespoke-parser work)

**Don't build a new syntactic parser from scratch.** Adapt BibleOntology's existing staged deterministic builder to emit BibleResearch `GrammaticalFrameV2` and `OccurrenceRelationV2` records:

- **S0 — input adaptation:** Read rights-cleared, pinned MACULA XML with upstream `source.py` normalization and preserve source IDs; remap only through our validated canonical crosswalk. Never assume upstream `data/macula-*` matches our release without comparing hashes.
- **S1 — main extractor:** Run/port `s1_clauses.py` and matching `tables/{hebrew,greek}/heads.json` to obtain clause nodes, source role fillers, phrase heads and composites. This is the **mandatory first milestone**. Keep the original clause hierarchy/coordination evidence in intermediate output; convert to one or more frames only after endpoints are verified.
- **S2/S3 — contextual corrections:** If pilot tests justify, apply `s2_s3.py` to label negation, imperatives, conditional/speech force and clause link types. Record the actual rule used, not a made-up semantic conclusion. In particular, a logical conjunction or sequence is not automatically causal.
- **S4/S5 — optional low-confidence resolution:** Use `s4_s5.py` for speech-turn segmentation and limited reference candidates only after negative fixtures demonstrate adequate precision. Upstream itself documents incorrect pronoun-subject carryover cases. Unresolved identities remain genuinely unresolved.
- **S6 — do not run in MVP:** Upstream `s6_readings.py` supplements from BSB-aligned English; its results are translation readings, not original-language grammatical facts.

**Implementation path:** Vendor or reference a minimal Apache-licensed snapshot in a project-approved `third_party/bibleontology_builder/` location (name illustrative), keep original header/NOTICE, and write a thin adapter that exports **our** normalized JSONL with exact source IDs, role relations, edition, rule/stage, confidence category and source-rights status. Run Python offline in CI/local build as needed; **do not run it per MCP request**. Do not import upstream output files named `out/placeholder-*` as stable contracts; upstream README says `out/` non-export files are runtime build artifacts, not stable APIs. Use the officially documented `out/export/` files only for the optional attributed reference import.

**Validation before adaptation:** Run upstream builder on one Hebrew and one Greek source fixture with its *matching* pinned MACULA files; compare source spans/role edges against our verified corpus. Identify any edits required for verse mapping or source differences. Prefer small adapter patches over rewriting grammar tables. Only replace a tested component with new code if the upstream rule is incorrect or incompatible with our version. Keep the original test alongside a regression for each patched rule.

**Automated provenance of every edge:**

`MACULA source release/file/XML ID → upstream stage/rule/head-table key → adapted source frame → original-language token/lemma crosswalk → emitted relation → Cloudflare graph shard`.

If any required link is missing, keep the relation as a source-local candidate or skip the canonical summary with a counted reason. Never fill missing links using English gloss proximity.

### 6.1 Overview

```text
Verified locally cached and rights-cleared source files
    ↓
Source/edition/token resolver (uses existing canonical mappings)
    ↓
MACULA XML source adapter (BibleOntology S0, pinned and license-checked)
    ↓
BibleOntology S1 clause/role/phrase-head rules (adapted + tested)
    ↓
Optional S2/S3 negation/force/links; optional candidate S4/S5 referents
    ↓
BibleResearch clause-frame adapter + strict canonical crosswalk
    ↓
Conservative role/link compiler + context/ambiguity guards
    ↓
Occurrence-level relation records + evidence references
    ↓
Deterministic aggregation (lemma/lexeme pair + role + scope)
    ↓
Lexical/reference edges + optional verified LXX lexical pairs + legacy proximity
    ↓
Compressed static Cloudflare indexes + coverage manifest
    ↓
Worker query API → website / MCP adapter
```

Use the repository's existing TypeScript runtime, **but Python is appropriate for this offline builder because BibleOntology already provides tested Python source**. Do not rewrite it merely for language uniformity. Use a streaming XML parser for large sources, not `JSON.stringify` of an entire corpus. Build indexes incrementally per book/edition, with deterministic sorting and atomic writes into a staging directory.

### 6.2 Preflight: make sure the real source files exist

1. Locate existing pinned local MACULA source files (especially Hebrew `WLC/lowfat` or `WLC/nodes` and Greek hierarchical XML) and the matching manifest. **Do not infer full syntax coverage from the 4,063 verses presently imported in PostgreSQL.**
2. List each file's edition, sha256, original source path, word/clause counts and license status. Compare to any existing Cloudflare-backed archive. If a source isn't locally available, use the project's existing reproducible downloader/exporter; do not guess a path or run unbounded HTTP loops.
3. Before a build, validate all original-reference mappings including Psalm verse 0, shifted verses, split/merged verses, Genesis 31:55, and known alignment exceptions. Use explicit status `matched`, `split`, `merged`, `edition_only`, `ambiguous`, `unmapped`.
4. Use source-local token references for extraction. Do **not** require a STEP-primary-token alignment to create a grammatical fact *within MACULA*. Align to STEP later if mapping is verified; unresolved STEP links remain explicitly unresolved.
5. Audit every source attribute against `field_license_registry`; remove forbidden values before persisting build artifacts.
6. Confirm the graph release is generated from the same compatible canonical mapping/corpus release as deployed or targeted; reject mismatched manifests.

### 6.3 Parse the syntax tree, not just the TSV role flags

The source tree contains nested `sentence → clause → phrase → terminal` (actual node labels vary by source/version). Hebrew role tags commonly include `s`, `v`, `o`, `io`, `o2`, `pp`, `p`, `adv`, etc.; Greek similarly contains roles such as `s`, `v`, `o`, `io`, `vc`, `p`, etc.

Interpret tags only using a **source-specific role dictionary**: a Greek `p` (predicate) and a Hebrew `p` must not be assigned a meaning by blind string equality. Preserve raw tags in evidence.

For each source clause:

1. Determine source clause ID and exact source-local token span. Cross-verse and discontinuous spans are allowed.
2. Find its **primary predicate** from the source-labelled verb/predicate phrase. If there are multiple predicates, identify separate frames or mark unresolved; never arbitrarily choose the first word.
3. Find grammatical-role **phrase nodes** attached to that clause (subject, object, indirect object, second object). Roles on a whole phrase take precedence over isolated terminal guesses.
4. For each phrase, identify its head using source `head`/`is_head` markers where present. If absent, use a **narrow tested language-specific head rule**. If two plausible heads remain, record `ambiguous_head` rather than generating a confident lemma edge.
5. Resolve each source token to its own source lemma/lexeme identity. Prefer exact source IDs; never use an English gloss substring or a base Strong's number as a unique disambiguator.
6. Preserve coordinated participants. Example Genesis 1:1 object phrase *heavens and earth*: store both object participants **only when the syntax shows coordination**. Otherwise emit the phrase as a whole and qualify the head selection.
7. Inspect available mood, voice, negation, condition, quote boundaries and referent fields. Mark `unknown` if not reliably determined.
8. Emit a frame with source roles and provenance; emit pairwise occurrence relations **linked back to that same frame**.
9. Record the reason whenever no frame is extracted. Unknown is coverage information, not an error to hide.

#### Pseudocode, normative execution order

```text
for edition in allowed_source_editions:
  for source_file in edition.sorted_files:
    verify_input_hash_and_rights(source_file)
    for clause in stream_syntax_clauses(source_file):
      inspect = validate_clause_tree(clause)
      if not inspect.valid:
        record_skip(clause, inspect.reason)
        continue
      predicates = find_source_predicates(clause)
      if predicates.empty:
        record_skip(clause, "no_resolved_predicate")
        continue
      for pred in predicates:
        participants = find_licensed_syntactic_roles_in_scope(clause, pred)
        heads = resolve_source_heads(participants)
        context = inspect_context_conservatively(clause, pred)
        frame = emit_frame(pred, heads, context, source_provenance)
        for role in heads:
          if role.has_unambiguous_lemma_and_attachment:
            emit_occurrence_relation(frame, role)
          else:
            emit_candidate_or_skip(frame, role, explicit_reason)
    write_sorted_book_or_edition_shards_atomically()
```

`find_source_predicates` must respect nested clauses and conjunctions; it cannot join the subject of one clause to the verb of another. `find_source_heads` must return a list for independently supported coordination and retain unresolved phrases otherwise.

### 6.4 Positive and negative extraction rules

**Rule R1 — explicit clause S–V:** When a source clause contains one clearly identified `v` predicate and one direct `s` role with a uniquely resolved head, emit `subject_token grammatical_subject_of verb_token`. No inference that the event happened outside the sentence's assertion context.

**Rule R2 — explicit V–O:** When the same clause contains a clearly attached `o` phrase with resolvable head(s), emit `object_token grammatical_object_of verb_token`. UI can render inverse phrasing `verb → has object → noun`. Keep frame ID linking S, V and O.

**Rule R3 — indirect/second object:** Only emit when source role is clearly labeled and attached to the same predicate; otherwise `unknown_argument_role`. Preserve `io` versus `o2`.

**Rule R4 — modifier:** Inside a verified nominal phrase, emit `modifier → modifies → head` only when the source grammar and phrase/head rule establish the attachment. Do not connect every adjective in a verse to every noun.

**Rule R5 — genitive/construct:** Emit a **grammatical** possessive/construct association where syntax supports it; display as `genitive / construct relation`, not automatic material ownership or derivation. Hebrew construct chains and Greek genitive case do not always signify ownership.

**Rule R6 — clause-internal coordination:** Expand coordinated subjects/objects into separate relations only if source structure clearly marks the coordination. Retain the shared phrase scope. Do not cross-expand unrelated phrases or multiple independent clauses.

**Rule R7 — contextual restrictions:** Preserve rather than discard negation, question, command, hypothetical, conditional, future/predicted, quotation and passive information. Mark `context_unresolved` if source doesn't establish scope. A *grammatical* edge may still be recorded, but a claim such as `God performed action X` must not be emitted when context prevents it.

**Rule R8 — pronoun/unexpressed subject:** Store occurrence roles of pronouns, person/number/gender features and source referent IDs. Only link the pronoun to an entity/lemma if the source reference resolves **uniquely** and edition mapping is valid. If not, return `pronoun_subject_unresolved`; don't force the last nearby noun to be the referent. Hebrew conjugational person is not by itself a resolvable lexical subject.

**Rule R9 — copular/nonverbal clause:** Where a sentence explicitly predicates noun/adjective Y of X, emit `grammatical_predicate_of` with the source clause and context; **never** a global lexeme `same_as`. E.g. Luke 8:11's seed/word relation is a context-scoped identification inside a parable; higher interpretation is an optional separate lane.

**Rule R10 — unsupported frame:** On broken syntax trees, unknown roles, unreliable token links, unsupported head rules or conflicting annotations, emit **no high-quality semantic edge**. If useful, return a labelled candidate with reason/trace.

### 6.5 Context model (cheap and honest)

Use these statuses per frame:

| Field | Values | Meaning |
|---|---|---|
| `polarity` | `positive`, `negative`, `uncertain` | Only `negative` when a tested source-scoped negative construction applies; absence of a detected marker is `uncertain` unless the whole relevant scope was checked |
| `modality` | `assertive`, `imperative`, `question`, `conditional`, `hypothetical`, `predicted`, `unknown` | Use morphosyntax and tested clause markers; avoid broad theological interpretations |
| `voice` | `active`, `passive`, `middle`, `stative`, `unknown` | Source morphological category; don't equate grammatical subject with agent for passives |
| `speaker_scope` | `narrator_candidate`, `quoted_character`, `divine_speech_candidate`, `unknown` | Only label when discourse boundaries are verified; default unknown |
| `figurative_scope` | `explicit_comparison`, `source_marked_parable`, `unknown` | **Do not auto-classify all metaphors from a dictionary** |
| `referent_status` | `explicit`, `source_linked`, `candidate`, `unresolved` | Participant/coreference resolution confidence |

Store raw source signals and rule version. If a field isn't supported, `unknown` is a legitimate correct output.

### 6.6 Quality model: avoid a fake probability

Use clear **evidence categories**, not a made-up universal truth probability:

- `source_explicit`: required grammatical role annotation and token links are present and valid; extraction rule succeeds.
- `rule_derived`: source syntax supports a small, published deterministic conversion rule, e.g. a tested phrase-head resolution.
- `candidate`: unresolved head, alignment ambiguity, uncertain cross-clause attachment or weak source mapping.
- `not_covered`: source tree or required licensed fields absent.
- `rejected`: deterministic validation detects an invalid or contradictory extraction.

A candidate can be shown to users if they enabled uncertain results, but must **not** be included in high-precision counts. Display separate counts. Later human or AI review can add a new overlay assessment without changing the original compiled evidence.

### 6.7 Aggregation without semantic mistakes

For each emitted occurrence relation:

1. Resolve endpoints to scoped canonical lexeme/lemma IDs; unresolved endpoints remain occurrence-only evidence.
2. Group by `(from_lemma, predicate, to_lemma, source_edition, language, relevant context bucket, rule version)`.
3. Count **distinct frame IDs**, source occurrences and **distinct canonical passages** separately.
4. Record high-quality versus candidate counts separately and maintain an evidence-id posting list.
5. Deduplicate identical source-tree aliases and duplicate import rows. Preserve distinct source editions but avoid counting the same NT verse in Nestle1904 and SBLGNT twice in the combined Bible-wide frequency.
6. Do not invent a relation between a subject and a noun that was an object of **another frame** with the same verb lemma.
7. Store rank/display metadata only after aggregation; preserve complete witness retrieval via pagination.

If `God` and `create` occur in three extracted frames, and `create` has four objects across unrelated frames, **do not** materialize twelve God–create–object triples. A triple requires a **single matching frame ID**.

### 6.8 Source tree coverage: two numbers, not one

Track **source availability** separately from **extraction coverage**:

```
source_verses_available
source_clauses_available
valid_clauses
clauses_with_resolved_predicate
clauses_with_explicit_subject
clauses_with_explicit_object
frames_emitted_high
frames_emitted_candidate
frames_skipped_by_reason
canonical_verses_mapped
unmapped_source_spans
```

Produce this per edition, book and language. A high token coverage percentage does not prove that dependency trees are complete or that subject/object relations were extracted. A low coverage number means **unknown/not analyzed**, not absence of biblical relationships.

---

## 7. Hebrew–Greek connections: feasible lexical LXX bridge first

### 7.1 Why this helps

The goal is to connect Old Testament Hebrew and New Testament Greek vocabulary through observed Greek translation choices in the Septuagint. This helps users discover semantic neighborhoods across languages without assuming that similar English translations guarantee lexical identity.

### 7.2 Exact first implementation

1. Download the candidate `lxx_bridge.tsv` from the pinned, audited source if rights and provenance checks succeed.
2. Validate header fields `hebrew_strong`, `greek_strong`, `count` against the actual release; reject malformed identifiers, nonpositive counts, duplicates with incompatible values and unexpected schemas.
3. Preserve original source H/G numbers exactly, including leading zeros. Convert to local lexeme candidates through existing identifier crosswalks.
4. Where one Strong's number represents multiple local lexemes/homographs, keep the full candidate set and label `identity_ambiguous`—do not choose a single lemma by default.
5. Materialize **one row per source-reported lexical pair** with source, published count, mapping ambiguity and license lineage.
6. Build both Hebrew→Greek and Greek→Hebrew adjacency indexes as **views of the same relation**, not two independent claims.
7. Show translation pairs in a separate UI category with a disclaimer that publisher-reported counts and pair meanings are not yet verified against your own LXX token alignments.
8. Verify at least: a frequent clear translation candidate, a highly polysemous Hebrew lemma, a polysemous Greek lemma, a misleading shared Strong's base, and a pair that has no local exact lexeme resolution.

**A lexical translation pair is not a token alignment.** Only the current nine verified local word alignments (or future independently validated additions) can support actual token-to-token evidence in specific verses. Hebrew–LXX **verse** mapping does not imply word alignment, and LXX translation choices do not prove exact conceptual identity with an NT usage.

### 7.3 Optional extension, not necessary for the MVP

If actual source-aligned LXX word pairs later become available under compatible rights, add a distinct `verified_translation_of` token-level predicate. For automatically computed alignment candidates, use `alignment_candidate` with edition, verse, occurrence positions, method, ambiguity and quality. Do not run a full word aligner initially; it is a larger, separate research project.

---

## 8. Statistical comparison: retain proximity, add grammatical frequency

### 8.1 Three independent statistics

For any pair of resolved lemmas:

- `grammatical_distinct_passages`: passages with a **specified direct role** supported by extracted clause/frame evidence.
- `translation_reported_count`: published LXX lexical-pair attestation count, labelled with dataset and methodology.
- `cooccurrence_distinct_passages` and `legacy_proximity_score`: earlier co-occurrence evidence with exact corpus, window and counting scheme.

These numbers have **different denominators**. Do not add them to produce a purported overall truth score.

### 8.2 Sorting inside each category

Start with a simple deterministic sort, cheapest to implement:

1. Evidence quality (`source_explicit` > `rule_derived` > `candidate`).
2. Distinct supporting canonical passages, descending.
3. Distinct supporting books, descending (for breadth; not independent proof).
4. Scoped lexeme ID to break ties consistently.

Optional later: calculate NPMI or a log-likelihood score **within one fixed corpus/context definition**, after enough support. This may help with unusual meaningful pairs but is not required for launch.

Definitions if implemented:

```
N    = count of independent chosen context units
nA   = units containing lemma A
nB   = units containing lemma B
nAB  = units containing both A and B
PMI  = ln(nAB * N / (nA * nB)) when nAB > 0
NPMI = PMI / -ln(nAB / N) when 0 < nAB < N
```

Never calculate NPMI for invalid denominators; use minimum support (configurable, e.g. 3 distinct contexts), genre/source filters and rare-pair guards. Co-occurrence is supplementary discovery evidence, **not** word meaning.

### 8.3 Ranking is not proof

Do not expose a scalar called `probability_this_relationship_is_true`. Instead return evidence type, actual counts, scope, annotation quality and source. A user may sort by frequency or choose `high precision only`.

---

## 9. Searching two or more words: evidence path retrieval

### 9.1 Direct pair query

Resolve both inputs to original-language lexical candidates. Return, in order:

1. Exact same-frame grammatical relationship(s), showing frame subject/predicate/object and context.
2. Direct lexical relationships (documented roots etc.).
3. Direct LXX translation candidates.
4. Co-occurrence statistics.
5. Only then, bounded **multi-step** paths.

If inputs are ambiguous (e.g. English `word` or Hebrew base Strong's), return candidates first or explicit separately labelled alternatives. Don't select the most common word silently.

### 9.2 Paths can traverse typed summaries but do not imply new facts

Example hypothetical path representation:

```text
Lemma A --[grammatical_subject_of | Gen 1:1]--> Verb B
Verb B <--[grammatical_object_of | Gen 1:1]-- Lemma C
```

Both edges use the **same frame ID**, so the UI may say that the passage connects A, B and C in one grammatical construction.

A different path might link distinct verses:

```text
Lemma A --[grammatical_subject_of | verse X]--> Verb B
Verb B <--[grammatical_object_of | verse Y]-- Lemma C
```

That is a *lexical graph path across passages*, **not evidence that A performs B upon C in one statement**. The UI and MCP must label whether a chain uses `same_frame`, `same_passage`, or `cross_passage` joins.

### 9.3 Minimal path algorithm

Use a bounded, deterministic breadth-first search over **precomputed lemma adjacency lists**. No graph database required.

- Default max hops 2; allow 3 on request. Hard limit 4 only if performance measured safe.
- Hard cap nodes visited, edge expansions and response bytes. Deduplicate cycles and redundant inverse edges.
- Filter edge types and uncertainty **before** traversal.
- Do not traverse into unreviewed interpretation or private research unless user explicitly selects an authorized overlay.
- Prefer stronger evidence lanes and fewer hops. Provide multiple genuinely distinct explanations rather than ten equivalent roots/spellings.
- Require same-frame frame IDs for any rendered subject–verb–object claim.
- Keep high-degree hubs (e.g. generic God/person/article) from dominating every result with per-node expansion budgets and optional stoplists.
- Return each step's source and qualifying context; no implicit transitive `same_as`, synonymy, prophecy or theological claim.

**For 3+ user words:** accept 2–5 resolved lexical IDs; find a connected subgraph or short linked paths that cover as many selected terms as possible, with `covered_terms`/`unconnected_terms`. Implement cheaply as pairwise bounded paths plus deduplicated edges, not an exact Steiner-tree solver. Never imply all selected terms occur in the same event unless one verified frame contains them.

---

### 9.4 Required cross-category discovery: Spirit, lamps, eyes, oil, water

**Problem:** A word-only grammar list can answer *Spirit — subject of → speaks*, but it cannot by itself answer *How is Spirit connected to lamps, eyes, oil or water?* Those links include explicit identification, figurative discourse, overlapping passages, material use and intertextual possibilities. **Avoid falsely promising that grammatical subject–object extraction alone will find them.** Add these research paths progressively, with separate provenance labels:

| Desired path | Primary evidence to inspect | What the algorithm may honestly return | Must NOT claim |
|---|---|---|---|
| Spirit ↔ seven lamps | Revelation 4:5 | A **scoped textual identification** if a tested predicative rule handles the construction; otherwise an exact same-passage candidate or **attributed BibleOntology claim**, if its source verifies | Every lamp is the Holy Spirit |
| Spirit ↔ seven eyes | Revelation 5:6; Zechariah 4:10 | Rev 5:6 scoped identification of seven eyes/seven spirits if rule supports it; Zech 4:10 as an independently cited textual witness/possible intertextual step | An unconditional literal eye = spirit identity |
| Spirit ↔ oil ↔ anointing | 1 Samuel 16:13; Isaiah 61:1; Acts 10:38; Zechariah 4 | Distinct local *anointed*, *oil*, *Spirit came upon* observations plus source-backed paths; co-passage link when grammatical evidence lacks the connection | Oil globally means Spirit or that all linked steps are one event |
| Spirit ↔ living water | John 7:37–39 | Passage-level link plus attributed explanation of Spirit/water if a verified explicit-text rule can read it; otherwise weak contextual/cross-reference edge | Every water reference means Spirit |
| Spirit ↔ lampstand vision | Zechariah 4:2–6,10 | Shared episode/passage context; reported vision and God's saying about Spirit, with separate predicates | Zechariah directly states lampstand = Spirit |

**Cheap implementation order:** (a) rely on our existing exact passage links and grammar S1 output; (b) add a **small, reusable, conservative** `explicit_identification` parser for supported copular/explanatory forms, always with speaker/figurative scope; (c) show known sourced cross-references/scene associations; (d) optionally display BibleOntology's correctly attributed curated claims in a **separate external lane**. Do **not** write hand-curated edges for each target word, call an AI extractor, or build a general-purpose metaphor classifier to make the Spirit demo pass.

**UI evidence-path output must be labeled:** `direct_textual_identification`, `grammatical`, `same_passage`, `editorial_cross_reference`, `external_attributed_claim`, `cross_passage_path`. Path traversals return an ordered **sequence of evidence**, never a synthesized fact that the endpoints are equivalent. A two-passage path should display the different passages at its individual steps, not pretend Scripture explicitly states a direct cross-passage equation.

**Coverage contract:** In a grammar-only release, display `not_supported_yet` for a requested symbolic relation when no extraction rule covers it, rather than misleadingly saying *Scripture contains no connection*. External claim overlays should be opt-in and never counted as native extraction coverage.

## 10. Static build artifacts, indexes, Cloudflare serving and releases

### 10.1 Build pipeline and proposed source layout

Use the existing corpus exporter/static asset publishing mechanism, not a parallel deployment. Suggested modules **only if equivalent modules do not already exist**:

```text
src/relationships/
  contracts.ts                 # Types / runtime validation schemas
  predicate-registry.ts        # Relation names, endpoint rules, inference prohibitions
  source-role-maps.ts          # Hebrew and Greek source-specific tags
  syntax-extractor.ts          # Pure function: parsed source clause -> frames/edges
  aggregate.ts                 # Occurrence evidence -> lemma summaries
  resolve-topic.ts             # Exact ID + disambiguated lexical candidate lookup
  query-paths.ts               # Bounded graph traversal
  query-response.ts            # Shared versioned API response validation
scripts/
  build-relationship-graph.mjs # Offline source -> staged assets
  verify-relationship-graph.mjs# Deterministic fixtures + manifest/integrity checks
```

Before creating these, inspect local files such as `src/api/relationship-types.ts`, `src/api/relationship-model.ts`, `src/api/relationships-rpc.ts`, `scripts/build-relationship-slice.mjs` and the existing corpus gateway. **Extend existing modules where sensible; do not create shadow implementations.** Maintain project file-length, `@toc`, section and test conventions.

### 10.2 Minimal asset design

Do not write one giant entire-Bible JSON file or store all occurrence edges in Supabase. Use gzip-compressed deterministic JSON/JSONL or another already-supported serialization. For the initial release:

```text
relationships/v2/<graph-release>/
  manifest.json
  lexicon/aliases-<partition>.json.gz
  lexicon/ids-<partition>.json.gz
  grammatical/by-lemma/<partition>.json.gz
  grammatical/evidence/<book-or-hash>.json.gz
  grammatical/by-passage/<book-or-hash>.json.gz
  translation/by-hebrew/<partition>.json.gz
  translation/by-greek/<partition>.json.gz
  contextual/by-lemma/<partition>.json.gz   # reuse existing score data if possible
  coverage/by-book.json.gz
  qa/summary.json
```

This is a **logical path design**, not a mandate to create a fixed number of files. Partition sizes must be measured with the actual Cloudflare Worker CPU, asset and latency constraints. Co-locate a lemma's top neighbors and summary metadata in one bounded shard; keep the full evidence list in separately fetched shards. Keep an inverse index for object-of and source-target reverse lookup.

**Do not bundle duplicated source text with every relation.** Store stable source span/verse IDs and a compact permitted excerpt where useful. Fetch complete original text through the existing corpus reader. If rights prohibit an excerpt, expose a reference/locator instead.

### 10.3 Manifest contract

```json
{
  "graph_schema": "2.0",
  "graph_release": "<immutable-build-identifier>",
  "corpus_release": "<compatible-existing-corpus-release>",
  "canonical_mapping_release": "<mapping-release>",
  "extractor_rules_version": "1.0",
  "source_releases": [{"dataset": "macula-hebrew", "edition": "wlc", "commit": "<pin>", "sha256": "<digest>"}],
  "datasets": {
    "grammatical": {"status": "complete_for_supported_rules", "index": "<path>", "sha256": "<digest>"},
    "translation": {"status": "optional_or_verified", "index": "<path>", "sha256": "<digest>"}
  },
  "rights_audit": "<rights-check-report-id>",
  "coverage_report": "<path>",
  "build_report": "<path>"
}
```

This is illustrative; the actual release manifest must list **each published shard**, its byte length and checksum, extraction coverage and source attribution. No unresolved source field may slip into a public shard. A graph query rejects a release if corpus/mapping hashes are incompatible.

### 10.4 Build/update strategy

1. Pin inputs, validate source manifest and source rights.
2. Process one source book/edition at a time, emitting immutable intermediate frames and evidence bundles into a staging directory.
3. Validate those output shards and aggregate only successfully mapped lexical identities.
4. Reuse unchanged book outputs by input+rule hash. New source files or extractor rule changes invalidate only affected partitions (and relevant aggregate indexes).
5. Rebuild global adjacency/alias indexes deterministically; measure size and memory before shipping.
6. Run deterministic integrity and golden fixture checks against staged assets.
7. Publish the *new* versioned release to Cloudflare; verify reads through the actual Worker API.
8. Activate release pointer only after validation; keep previous release for rollback.

**Never query Supabase to regenerate millions of immutable records if a verified local/static corpus source already exists.** Avoid uploading an entire corpus solely because one chapter's grammar rule changed. Never modify a live active shard in-place.

### 10.5 Gateway responsibilities

The existing Cloudflare Worker, or a thin dedicated route inside it, provides:

- Resolver: exact original-language IDs and namespace-aware aliases → candidate lexical identities.
- Neighbor lookup: fetch one small summary shard; apply relation-lane, quality, language, edition and book filters.
- Evidence lookup: fetch referenced source-frame/occurrence witnesses, bounded and paginated.
- Path search: bounded expansion of adjacency shards, with budget and cancellation/timeout.
- Coverage: return source/extractor coverage by request scope.

Cache immutable public assets by graph release/version. A static query **must not** contact Supabase. A dynamic notes overlay can be appended separately by an authorized API, with RLS/permission checks and **never** cached in a public shared response.

### 10.6 Budgets and error handling

Suggested defaults (measure and revise): 20 neighbors per lane, 3 evidence passages per relation, 2 path hops, max 8 paths, total response <=50 KiB; hard bound network shard fetches and graph expansions. Fetch more evidence by ID/page cursor. All cursors pin graph release, query filters and sort key; reject incompatible cursors.

**Never return `{ relationships: [] }` on asset timeout/hash mismatch and call that 'no relationship'.** Return a typed error such as `CORPUS_RELEASE_UNAVAILABLE`, `SHARD_INTEGRITY_ERROR` or `PARTIAL_COVERAGE`; distinguish **no evidence in covered scope** from **scope not covered**.

---

## 11. Public query API: exact endpoints, input and output examples

**Status: all `/v2/` paths and named operations below are proposed.** Preserve existing v1 API contracts until consumers migrate. The website and MCP must call the **same** query implementation so their answers cannot diverge.

Prefer **one gateway endpoint** with a small fixed `operation` allowlist, with typed backend dispatch and separately testable pure functions:

`POST /api/relationships/v2/query`

Common request fields:

```json
{
  "operation": "neighbors",
  "subject": {"text": "God", "language": "hbo"},
  "graph_release": "active",
  "filters": {
    "lanes": ["grammatical", "lexical", "translation", "contextual"],
    "qualities": ["source_explicit", "rule_derived", "candidate"],
    "book_range": null,
    "edition": null,
    "include_uncertain": true
  },
  "limit": 20,
  "cursor": null
}
```

`operation` values: `resolve`, `neighbors`, `passage`, `trace`, `evidence`, `coverage`. Optional (future) `concept_explore` reuses `neighbors` + `trace`, not a separate graph backend. `filters.source_classes` may contain `macula_source`, `step_lexical`, `lxx_translation`, `contextual_computed`, `bibleontology_external`. `bibleontology_external` requires `include_external_attributed: true` and is excluded by default. `filters.relation_families` may include `grammar`, `textual_identification`, `passage_association`, `lexical`, `translation`, `contextual`. Unknown operations, IDs, predicate names, or oversized limits return structured validation errors. Use `Content-Type: application/json`. The backend may also expose GET equivalents for simple public navigation, but they must share the same dispatcher and validation.

### 11.1 Resolve ambiguous original-language words

**Request**:

```json
{
  "operation": "resolve",
  "subject": {"text": "bread"},
  "limit": 10
}
```

**Representative response shape (labels illustrative, not exhaustive):**

```json
{
  "schema_version": "2.0",
  "graph_release": "<release>",
  "status": "needs_disambiguation",
  "resolution": {
    "query": "bread",
    "candidates": [
      {"lemma_key": "<exact-local-id-for-H3899>", "strongs_alias": "H3899", "language": "hbo", "label": "לֶחֶם", "match_kind": "licensed_gloss_candidate"},
      {"lemma_key": "<exact-local-id-for-G740>", "strongs_alias": "G740", "language": "grc", "label": "ἄρτος", "match_kind": "licensed_gloss_candidate"}
    ]
  },
  "coverage": {"source": "indexed_lexicon", "status": "partial_or_full_as_reported_by_manifest"}
}
```

Return **exact** ID candidates before ambiguous gloss candidates. No substring-gloss automatic identity choice. A base Strong's alias must expose all mapped homographs or request a more specific ID. H and G numeric portions never imply identity.

### 11.2 List relationships when the user clicks a word

**Request**:

```json
{
  "operation": "neighbors",
  "subject": {"lemma_key": "<resolved-god-lemma-id>"},
  "filters": {"lanes": ["grammatical", "lexical", "translation", "contextual"], "include_uncertain": true},
  "limit": 20
}
```

**Response** (short sample, counts intentionally placeholders until computed):

```json
{
  "schema_version": "2.0",
  "graph_release": "<release>",
  "subject": {"lemma_key": "<resolved-god-lemma-id>", "label": "אֱלֹהִים", "language": "hbo"},
  "groups": [
    {
      "lane": "grammatical",
      "relation_type": "grammatical_subject_of",
      "label": "Acts as the grammatical subject of",
      "items": [
        {
          "related": {"lemma_key": "<resolved-create-lemma-id>", "label": "בָּרָא"},
          "count": {"distinct_passages": "<computed>", "high_quality": "<computed>", "candidate": "<computed>"},
          "witnesses": [{"reference": "Gen 1:1", "frame_id": "<actual-id>", "evidence_id": "<actual-id>", "role": "subject", "context": "assertive"}],
          "quality": "source_explicit"
        }
      ]
    }
  ],
  "coverage": {"language": "hbo", "source_tree_status": "from_release", "extractor_rules_version": "1.0"},
  "pagination": {"has_more": false, "cursor": null},
  "limitations": ["Grammatical subject does not always imply semantic agent"]
}
```

In real JSON, `count` entries must be valid integer fields or explicit `null` with `count_status`; the `<computed>` strings here signify uncomputed examples **only**. Query responses must include the source edition and underlying IDs. Do not copy this fixture verbatim into production.

### 11.3 Show exact syntax relations for one passage

**Request**:

```json
{"operation":"passage","passage":{"book":1,"chapter":1,"verse":1},"filters":{"lanes":["grammatical"]}}
```

**Response contract:** returns one or more `GrammaticalFrameV2` records with source clause IDs, original-language predicate and participants, exact source token references, role labels, context qualifiers, mapping quality and coverage. If no syntax is imported for that edition, return `not_covered` instead of `{frames:[]}` without explanation. A cross-verse frame must return **its entire source span** or flag the missing part.

### 11.4 Explain connections between two words

**Request**:

```json
{
  "operation": "trace",
  "subjects": [
    {"strongs": "H0430", "language": "hbo"},
    {"strongs": "H1254", "language": "hbo"}
  ],
  "filters": {"lanes": ["grammatical", "lexical", "translation"], "include_uncertain": true},
  "limits": {"max_hops": 2, "max_paths": 6}
}
```

The resolver may report a needs-disambiguation result for either base Strong's, including relevant homographs. **Do not infer a unique H1254 sense from base number alone.** If exact candidates are chosen, return direct grammatical witness frames if present, then typed 1–2 hop paths with separate evidence for each step. Mark `join_scope` as `same_frame`, `same_passage`, or `cross_passage`. Never render a cross-passage path as one direct sentence claim.

**Three-word variant:** `subjects` accepts 2–5 items (resolved keys preferred). Return `covered_terms`, `unconnected_terms` and several small evidence paths; do not claim a semantic union not established by a single frame.

### 11.4a Example: exploratory Spirit query with transparent paths

```json
{
  "operation": "trace",
  "subjects": [{"text": "Spirit"}, {"text": "lamps"}],
  "filters": {"relation_families": ["grammar", "textual_identification", "passage_association", "lexical"], "include_uncertain": true, "include_external_attributed": false},
  "limits": {"max_hops": 3, "max_paths": 5}
}
```

**Required response shape:** resolve *Spirit* to candidate Hebrew/Greek lemmas **and** named referents (where supported) instead of silently treating them as one entity; return scoped verse-backed steps and `join_scope`, each step's `source_class`, `extraction_rule`, `edition`, `voice`, `mapping_status`, `quality`, `coverage`. If native textual-identification extraction is not yet implemented, the relationship can be shown as `same_passage` only when attested, or marked `not_supported_yet`. A later opt-in run with `include_external_attributed:true` may return BibleOntology-derived claims **visibly labeled external**, with original attribution and review provenance.

### 11.5 Inspect one evidence record

**Request**:

```json
{"operation":"evidence","evidence_id":"<actual-evidence-id>"}
```

Return exact edition, corpus release, source record location, original token strings where licensed, source roles, clause boundaries, canonical display verse(s), mapping status, extraction rule/version, source annotation type and any qualifiers. No AI explanation required.

### 11.6 Coverage query

**Request**:

```json
{"operation":"coverage","filters":{"edition":"macula-hebrew-wlc","book":1}}
```

Return `source_clauses`, `processed_clauses`, `frames_emitted_high`, `frames_emitted_candidate`, `unmapped`, `skipped_by_reason`, `supported_predicates`, `source_release`, `rules_version`. Never replace absent data with 100% or 0% without a measured denominator.

### 11.7 Error contract (shared by all operations)

```json
{
  "schema_version": "2.0",
  "status": "error",
  "error": {"code": "CORPUS_RELEASE_UNAVAILABLE", "message": "Required versioned graph assets could not be read"},
  "graph_release": "<requested-release>",
  "partial_results": null
}
```

Distinct codes: `INVALID_REQUEST`, `NEEDS_DISAMBIGUATION` (as status, not fatal), `UNKNOWN_LEMMA`, `UNSUPPORTED_PREDICATE`, `NOT_COVERED`, `CORPUS_RELEASE_UNAVAILABLE`, `SHARD_INTEGRITY_ERROR`, `QUERY_BUDGET_EXCEEDED`, `CURSOR_RELEASE_MISMATCH`, `SOURCE_RIGHTS_EXCLUDED`. Do not silently fall back to mutable Supabase tables during strict Cloudflare-only verification.

---

## 12. Website/UI: exact initial behavior, no diagram prerequisite

### 12.1 Entry points

- **Bible reader:** clicking a Hebrew or Greek token opens the existing word drawer; add a *Relationships* tab or section. Use the actual source token ID and precise lexeme candidates, never only the displayed English translation.
- **Lexicon page:** direct lemma/Strong's lookup opens the same relationship panel. If ambiguous, show the candidate list first.
- **Search box:** select one, two, or up to five exact word entries for the relationship explorer. Provide a source-aware **Concept / original-language word** selector so *Spirit* may resolve separately to `רוּחַ`, `πνεῦμα`, and a named *Holy Spirit* referent candidate; never equate them automatically.
- **Passage viewer:** optional toggle *Show grammar* highlights subjects, predicates and objects from exact extracted frames.

### 12.2 First screen layout

The result should be **a list grouped by how the words relate**, with original-language labels, translation glosses where allowed, counts and a few references. A straightforward layout:

```text
אֱלֹהִים   [Hebrew] [Exact lexeme/lemma identity] [Source edition]

Grammatical relationships
  Acts as subject of verbs
    בָּרָא (create)                 [computed count]  Gen 1:1 + more
    ...
  Acts as object of verbs
    ...
  Modifies / genitive constructions
    ...

Lexical relationships
  Documented roots / cognates / form variants
    ...

Septuagint translation candidates
  [Greek lemmas, publisher count, source label, caution]

Contextual associations / same-scene evidence
  [Existing proximity results and passage co-occurrence, both labelled as weaker evidence]

Explicit textual identifications / comparisons (when supported by tested rules)
  [Scoped witnesses, e.g., Revelation 4:5; no universal synonymy]

External attributed BibleOntology findings (optional, OFF by default)
  [Cited claims with original speaker / source / review provenance]

[Show candidates] [High precision only] [Hebrew / Greek] [Book filter]
[Compare with another word] [Show evidence] [View entire verse]
```

The sample is a **layout illustration**; no fabricated counts or links should appear in production.

### 12.3 Each relationship row shows

- **Related word:** original form, language, transliteration and licensed short gloss where available.
- **Relationship label:** e.g. `is grammatical subject of` / `is object of` / `documented root` / `LXX translation candidate` / `co-occurs near`.
- **Evidence count:** distinct canonical passages and, when relevant, number of frames/source records; no mixed denominators.
- **Evidence quality:** `Source explicit`, `Rule derived` or `Candidate` (use neutral status text, not a synthetic theological score).
- **Up to three references:** actual book/chapter/verse, expandable to original text with exact role highlights.
- **Edition + source:** MACULA Hebrew WLC / Greek Nestle1904 etc., documented lexical source, LXX publisher.
- **Expand/copy:** view all evidence (paginated); copy exact lexical ID; send two words to the relation explorer.

### 12.4 User interactions and filters

- Default ordering: grammatical → lexical → LXX translation → contextual; each category sorted by evidence quality/count.
- Candidate relationships are included by default but **visually distinguishable**; one-click `High precision only` removes them.
- Filter by grammatical role, source language/edition, book, uncertainty and specific lexeme/sense; do not expose an unsupported sense-level filter as if it is complete.
- Clicking evidence highlights **exact tokens and clause participants**. If the frame crosses verses, allow navigation across the whole span.
- Compare 2–5 selected words: show direct connection first, then short paths with each step's source; clearly mark cross-passage joins.
- `No high-precision relations in the covered scope` differs from `This book/edition has no imported syntax`, `This relation family is not yet implemented`, and `Cloudflare data unavailable`.
- *Spirit* exploration defaults to **all evidence categories visible as categories**, with BibleOntology external claims toggle initially OFF; permit filtering for strict original-language grammar versus wider scoped text/context links. The UI must not convert a *cross-passage path* to a theological definition.
- On mobile, textual evidence list remains fully usable without rendering a graph diagram.

### 12.5 UI note integration, but NOT part of graph extraction

A user may attach a **human research note** to a lexical entity, exact source passage, an extraction frame, or a graph evidence path. Existing `note_anchors`, `notes`, authorship and permissions must remain separate from immutable graph assets. AI-generated research is labelled independently. Private notes are fetched only through authorized Supabase calls; never included in public relation indexes or Worker caches. DLM layer/domain hypotheses remain notes/claims in a research workspace, not source grammar.

---

## 13. MCP functions and prompts: reuse the same Worker engine

### 13.1 Tool design principles

- The MCP adapter is **thin**: validate arguments; forward to versioned corpus gateway; enforce output caps; return typed JSON and links to exact evidence; no model calls or query-time AI tagging.
- MCP and website use identical resolver and graph release. Any optional BibleOntology graph import must share the same `include_external_attributed` authorization/filter behavior and return upstream licensing/voice; it must not be required for zero-AI output. Versioned APIs must not overwrite existing `research_relationships_v1`, `research_word_lens_v1`, `research_passage_lens_v1` or other deployed functions.
- Names below are **proposed v2 MCP tool names**, not a claim they are currently installed. Use a registry to avoid collisions with live tool/prompt names.
- A structured response must already be useful to an AI without requiring it to invent meanings; include IDs, relation types, counts, references, caveats and explicit coverage.

### 13.2 Proposed read-only tools

| Tool name | Key arguments | What it returns |
|---|---|---|
| `resolve_relationship_topic_v2` | `query`, `language?`, `edition?`, `limit?` | Exact source identities + lexeme/lemma/sense candidates; reports ambiguity |
| `get_word_relationships_v2` | `lemma_id` **or** `query`, `lanes?`, `relation_types?`, `include_uncertain?`, `book?`, `limit?`, `cursor?` | Grouped grammatical, lexical, translation and contextual neighbors with evidence |
| `get_passage_grammatical_frames_v2` | `book`, `chapter`, `verse`, `edition?`, `limit?` | Original-language predicate frames and source roles for the passage |
| `trace_word_relationships_v2` | `terms[]` (2–5), `lanes?`, `max_hops?`, `max_paths?`, `include_uncertain?` | Direct relations and bounded evidence paths, each step cited |
| `get_relationship_evidence_v2` | `evidence_id`, `graph_release?` | Full permitted original-language source witness/role trace |
| `get_relationship_coverage_v2` | `edition?`, `book?`, `predicate?` | Source availability, extraction coverage and unresolved reasons |
| `explore_biblical_connections_v2` **(optional alias)** | `query` or exact source identity, `relation_families?`, `max_hops?`, `include_external_attributed?` | Compact, typed grammatical + scoped textual + context discoveries. Implementation **delegates** to existing `neighbors`/`trace`, never runs separate semantic AI or RDF engine. |

All operations call the common gateway operation from §11; **do not** duplicate parsing, ranking or path algorithms inside MCP. Optional prompt `study_word_relationships_v2` can orchestrate these tools in the user's language but must not be required to retrieve any source-grounded relation.

### 13.3 MCP examples

**Query:** `get_word_relationships_v2({"query":"God","lanes":["grammatical"],"include_uncertain":false,"limit":10})`.

**Expected semantics:** first resolve God to exact language/lexeme candidates, then return source-backed grammatical relations. If ambiguity is material, return `needs_disambiguation` rather than pretending every word translated 'God' is identical.

**Query:** `get_word_relationships_v2({"query":"H3899","lanes":["grammatical","lexical","translation"]})`.

**Expected semantics:** distinguish H3899 from H3898 and other lexical entries, and show subject/object usages and LXX *candidate* mappings as separate sections.

**Query:** `trace_word_relationships_v2({"terms":[{"query":"seed"},{"query":"word"}],"max_hops":2})`.

**Expected semantics:** return lexical candidates first. A parable's scoped predication can be returned **only if the extracted grammatical construction and scope permit it**; otherwise the engine may return contextual evidence or unresolved status. Do not fabricate `seed means word` from a co-occurrence or ROOT match.

**Query:** `get_passage_grammatical_frames_v2({"book":1,"chapter":1,"verse":1})`.

**Expected semantics:** source roles for Genesis 1:1, with verb `בָּרָא`, subject `אֱלֹהִים`, coordinated object phrase, and exact source IDs. Return actual source edition and mapping quality.

**Query:** `trace_word_relationships_v2({"terms":[{"strongs":"H1254"},{"strongs":"G2936"}],"lanes":["translation","lexical","grammatical"],"max_hops":3})`.

**Expected semantics:** perform exact lexical resolution and check whether a **sourced** translation link exists. Do not assert that this hypothetical pair is attested, or that corresponding meanings are interchangeable, merely because both can be glossed 'create'.

### 13.4 MCP response compactness

Return up to 20 neighbor results by default, up to 3 evidence references per result, and a cursor/total coverage. Let AI request the exact evidence for a small number of interesting claims. This avoids huge verse-by-verse MCP payloads and unnecessary reasoning tokens.

---
## 14. Deterministic QA: precise fixtures, negative tests and measurable coverage

A successful build is **not** defined as extracting a high number of edges. The first objective is to extract **correctly typed, passage-grounded relations** for the constructions we claim to support.

### 14.1 Mandatory initial source fixtures

Create small fixtures (source clause IDs + expected role labels/heads + negative assertions). Do not fabricate XML IDs; record actual IDs after inspecting pinned source files. These are **verification cases**, not manual annotation of the corpus.

| Test | Required result | Must NOT happen |
|---|---|---|
| **Genesis 1:1** | Clause predicate `בָּרָא`, annotated subject `אֱלֹהִים`, object phrase containing heavens and earth; correct source token IDs | Cross-join words from other clauses; count `אֵת` as created object |
| **Genesis 1:11** | Source grammatical roles + **command** modality when supported | Treat the imperative as a completed human sowing event |
| **Luke 8:11** | Preserve `σπόρος` G4703 and `λόγος` G3056 in a scoped predicative construction; source role/genre trace | Claim G4690 `σπέρμα` is the token; global `seed same_as word` |
| **Deuteronomy 8:3** | Correct roles in the supplied Hebrew reading; contrast construction remains separate from grammatical SVO | Assert `bread = word` based on proximity |
| **Matthew 4:4** | Greek source roles and distinct local edition | Merge Greek with Hebrew tokens or identify quote as ordinary narrator event |
| **John 6:35** | Copular/predicate structure when attested, with speaker/quotation context or `unknown` | Every occurrence of Greek `ἄρτος` equals Jesus |
| **Genesis 3:4** | Quoted serpent utterance flagged as attributed or unresolved speaker context | Turn a character's claim into an unqualified fact |
| **Isaiah 55:10–11** | Sentence/verse spans and source roles; any cross-verse comparison is explicit future support | Materialize seed/bread/word as synonyms or one shared subject–object frame |
| **2 Corinthians 9:10** | Source event roles distinguish seed for sowing and bread for food | Conflate two roles because of proximity |
| **Hebrew H3899 vs H3898A/B** | Distinct lexical identities through the resolver | Claim shared spelling/root guarantees synonymy |
| **Hebrew H1697 subdivisions** | Return disambiguation candidates and source identity | Normalize to one meaning or concatenate unrelated senses |
| **Active/passive Greek clause** | Show grammatical subject as such; preserve voice | Re-label passive subject as semantic agent |
| **Explicit negation / question** | Preserve role evidence with correct or unknown context | Count it as a confirmed positive completed action |
| **Coordinated subject or object** | Expand only when phrase structure confirms each head | Cross-product independent clauses into invented triples |
| **Pronoun with unresolved reference** | Pronoun/source referent remains unresolved | Assign nearest `God`, `man` or `he` by heuristic guess |
| **Two Greek editions** | Separate edition evidence; default totals count intended corpus only once | Double all NT frequency counts |
| **Missing syntax tree** | `not_covered` with reason | Return `no relationship in Bible` |
| **LXX lexical pair** | Translation lane with source/published count | Claim token-to-token alignment or dictionary synonymy |
| **Root/cognate / co-occurrence** | Correctly typed lexical/contextual lane | Reclassify as direct grammatical or doctrinal relation |
| **Graph multi-hop across verses** | Every step separately cited and scope marked `cross_passage` | Compose a fabricated single-verse statement |

**Before publishing:** test every newly supported predicate on at least one positive case, one negative case and one ambiguous case. Keep fixtures bounded (dozens, not thousands of chat-rendered rows). Add comprehensive deterministic full-source invariant tests at build time.

### 14.2 Machine-verifiable invariants

- All emitted `token_id`, source-clause IDs and `lemma_id` references resolve within the declared source/release, or have explicit `unmapped` status.
- All relation endpoints satisfy predicate registry endpoint rules.
- All high-quality occurrence edges have **same-clause/frame evidence** and a resolvable source role.
- All canonical display references preserve a sourced versification mapping.
- All relationship groups have exact distinct-evidence counts and stable paginated evidence lookup.
- All inverse lookups lead to the same original relation/evidence ID.
- No source role or word is silently projected across unsupported editions.
- No exact token-to-token LXX alignments materialize from lexical-pair data alone.
- No forbidden field or value enters public assets, caches, fixtures or debug logs.
- Full static release manifests verify hash/byte size for all indexed assets.
- Re-running the builder on identical inputs yields identical canonical serialized graph data and manifest digests (excluding documented nondeterministic build timestamps).
- Querying an unsupported predicate/source returns `not_covered` or explicit errors, never a fabricated zero.

### 14.3 Quality measurement, not imaginary precision

Measure the system separately on Hebrew and Greek. Suggested metrics:

- `relation_precision_in_fixture_set` = correct expected high-quality edges / emitted high-quality edges for reviewed fixtures. Use exact expected outcomes, not AI evaluation.
- `false_high_precision_edges_in_negative_fixtures` should be **zero** for the mandatory critical cases.
- `supported_clause_coverage` = eligible parsed clauses / all source clauses examined.
- `high_quality_relation_coverage` = frames with at least one high-quality role relation / parsed eligible frames.
- `unmapped_token_rate`, `unsupported_structure_rate`, `disputed_role_rate`, `limited_rights_rate`.
- Query data: p50/p95 latency, number of fetched shards, serialized response size and worker CPU/memory using **actual** runtime measurements.

Do not claim the whole Bible is 100% parsed because a fixture suite passed. If a new rule increases recall but introduces systematic errors, keep it in `candidate` mode until fixed. A simple reliable subset is preferable to a misleading complete graph.

### 14.3a Additional tests for BibleOntology adoption and concept discovery

1. **Builder baseline:** On a pinned MACULA Genesis 1:1 tree, the adapted S0/S1 code returns one clause with verified `create` predicate, `God` subject, coordinated objects and exact source IDs. Reject a `first_child` fallback when source marks an incompatible head.
2. **Greek proof:** At least one verified active-voice S/V/O and one passive clause, with source editions visible; passive grammatical subject must not become semantic agent.
3. **Negation/force:** A denial, imperative and quoted claim do not become positive completed-action facts merely because they have S/V/O grammar.
4. **Pronoun candidate:** An unresolved referent stays unresolved even if upstream S5 proposes a likely link. Separate candidate count from source-explicit count.
5. **Crosswalk:** Unmatched BibleOntology entity IDs, same-label entities and mismatched MACULA releases are never merged into canonical identities.
6. **External graph voice:** If an optional RDF 1.1 file is imported, claims in a character's named graph remain that character's claims, editorial groupings stay editorial, and no external claim is automatically counted as native grammar.
7. **Spirit ↔ lamps/eyes:** Query surfaces Revelation 4:5 and Revelation 5:6 **only in the supported evidence category**; when explicit-identification extraction is absent, do not manufacture a direct semantic edge. Other words remain discoverable by their own distinct scene/cross-reference paths where indexed.
8. **Spirit ↔ oil/anointing/water:** Show complete paths, source passages, and weak/intertextual links as weak; no automatic literal Spirit = oil/water/eye claims.
9. **License test:** Vendored upstream Apache code and copied data preserve required notices. No restricted data field is emitted through the graph index or logs.
10. **Resource comparison:** Reuse prototype is measurably simpler/cheaper than bespoke parser. If a dependency fails build/check or costs more than it saves, drop that optional module and retain the small tested core.

Use compact deterministic fixtures checked against the original source text; do not run AI on thousands of verses for evaluation. The upstream README reports some existing structure-test failures, so record actual upstream test results separately from local adaptation tests.

### 14.4 Cheapest meaningful pilot

Build a **20–40-clause pilot**, deliberately including Hebrew and Greek S/V/O, coordination, genitive, negation, pronoun and passive. The target is a real deterministic response from the same API schema as production, using only a few pinned files. If the builder cannot reliably return Gen 1:1 and comparable Greek examples, **fix the source-role/head mapping before importing additional datasets**.

---

## 15. Step-by-step implementation plan for a mid-tier coding agent

**Global coding contract:** Before starting any step, read project `AGENTS.md`, current source/deployment notes, the relevant pre-/post-code skill and the **particular sections of this document for that step**. Do not ingest the whole 1,000+ line document into a new coding prompt repeatedly. Use bounded file reads. Inspect the actual workspace; never assume a proposed path already exists. Work on one atomic feature/one or two focused files at a time where feasible. Run only targeted tests during each step, broad tests at release gates. Never deploy over newer live ChatGPT/Supabase-plugin changes. **No production truncation or RLS changes are authorized by this architecture.**

### Step 0 — Finish/confirm Phase 0 preconditions

**Read:** §§2, 3, 10. **Change:** None in graph subsystem.

Verify the Cloudflare corpus and canonical mapping inputs to be used by the extractor are available from a reproducible local/static source, not from soon-to-be-removed PostgreSQL tables. Confirm the exact 19-table reclamation boundary and that current MCP/notes RPCs remain functional. Obtain a verified `corpus_release` and `canonical_mapping_release`. If this gate is not ready, do only isolated pilot work on local source files; **do not publish/alter production**.

**Done when:** source paths and hashes are recorded, the graph can be built without dependent production static tables, and no live integration is at risk.

### Step 1 — Inventory rights-cleared MACULA syntax and existing adapters

**Read:** §§3.3–3.4, 4, 6.0–6.2. **Implement:** A very small read-only inspection script, reusing existing scripts if possible. Pin BibleOntology commit, inspect `source.py`, `s1_clauses.py`, both `heads.json` rule tables, NOTICE/LICENSE and source release compatibility. Record upstream regression status.

Output one machine-readable inventory per edition/book: source XML/TSV paths, sha256, clause count, sample syntax roles, available source token IDs, licensed fields, current primary-token alignment coverage and whether a tree source is present. Detect actual source role tags; do **not** hardcode a source schema without inspecting it. Evaluate whether an existing MACULA/Universal Dependencies converter is appropriate as a library/reference; do not add a dependency without clear benefit.

**Done when:** pilot file inventory and field-license allowlist are verified; no source files silently missing; exact parser input format selected.

### Step 2 — Implement one reliable Hebrew and Greek clause extractor

**Read:** §§3.3–3.4, 4.3–4.8, 5, 6.0–6.6, 14. **Implement:** Adapt BibleOntology S0/S1 and head rule tables behind a small pure `extractClause` adapter; do not write a new parser if the existing one passes the fixtures.

Start with `grammatical_subject_of` and `grammatical_object_of` only. Preserve exact source clause and token identity. Add source-specific head rules **only** for constructions demonstrably supported by pinned examples. Emit `GrammaticalFrameV2` and `OccurrenceRelationV2` records. Keep all unresolved situations in skip/candidate counts.

**Done when:** Gen 1:1 and at least one simple Greek S/V/O clause pass; a negative/imperative/passive test does not produce a false agent claim; rerunning is deterministic.

### Step 3 — Add indirect object, modifier and construct/genitive rules

**Read:** §§5, 6.0, 6.4, 14. **Implement:** Separate independent rules and registry entries; reuse BibleOntology S1 phrase relations and optionally tested S2/S3 for negation/force. Do not rewrite the first two rules. Include coordination and phrase-level heads.

**Done when:** source-supported constructions produce the correct relation type; unsupported constructions are candidate/skipped; no cross-clause false triples.

### Step 4 — Compile lemma summaries and connect existing lexical lanes

**Read:** §§4, 6.7, 8. **Implement:** Deterministic aggregation; precise lexical resolver; edition-aware reverse indexes; read-compatible mapping to existing `entity_relationships` and proximity data.

Do not store new occurrence relations in PostgreSQL. Do not create token-token same-lemma cliques. Use the same `canonical_entities` source identity crosswalks; disambiguate Strong's aliases. Keep source/grammatical/contextual lanes distinct.

**Done when:** a word's direct grammatical neighbors appear with exact distinct-passage counts and evidence IDs, and existing lexical/proximity results still work.

### Step 5 — Try the cheap LXX lexical bridge

**Read:** §§3, 4.6, 7, 14. **Implement:** Small import/verifier only if the selected dataset's license and provenance pass audit; no full LXX word aligner.

**Done when:** a sourced Hebrew–Greek lexical candidate pair can be resolved in both directions; homograph ambiguity and publisher-reported count labels are preserved. If dataset fails verification, mark optional step BLOCKED and continue grammatical MVP.

### Step 6 — Publish versioned Cloudflare graph and query service

**Read:** §§10–11. **Implement:** Compact graph shard builder, release manifest, Worker shared query gateway, resolver, neighbors, evidence and coverage ops. Preserve existing static corpus serving. No Supabase large-table import.

**Done when:** a staged Worker returns exact fixture outputs from versioned published assets; all hashes verify, wrong release/corrupted shard fails loudly, previous release remains usable. Measure latency/bytes and adjust shards only when needed.

### Step 7 — Add the grouped website list

**Read:** §12. **Implement:** Relationships panel inside existing Bible word drawer or lexicon page; use common gateway; original-language IDs and links to source verses. Include uncertain filter and user-selectable language/source edition.

**Done when:** clicking a real token retrieves correct relation groups with exact citations; empty/unavailable/ambiguous statuses are distinct; mobile view is readable.

### Step 8 — Add MCP tools as thin wrappers

**Read:** §13. **Implement:** `resolve_relationship_topic_v2`, `get_word_relationships_v2`, `get_passage_grammatical_frames_v2`, `get_relationship_evidence_v2` and `get_relationship_coverage_v2`; use same gateway/validation and strict byte caps.

**Done when:** website and MCP return equivalent IDs, relation types, evidence and coverage for the same pinned release; existing v1 endpoints and prompts remain intact. No AI in server responses.

### Step 9 — Add pair/multi-word tracing

**Read:** §9, §9.4, §11.4, §13.3. **Implement:** Bounded bidirectional adjacency search with frame-aware scopes and 2–5 lexical inputs. Start with max 2 hops; increase only after measured performance.

**Done when:** a pair query distinguishes a direct same-frame relation from a cross-verse path, and cannot generate invalid transitive identity or inferred SVO triples.

### Step 10 — Broaden concept discovery only after grammatical MVP

**Read:** §§3.3–3.4, 4.8, 9.4, 11.4a, 14.3a. **Implement:** Add a limited `explicit_textual_identification`/comparison rule for documented constructions and a passage-association retrieval channel; use existing cross-references. Pilot *Spirit*, *lamps*, *eyes*, *oil*, *water* with directly cited witness paths. If valuable, optionally import a **small** BibleOntology RDF export subset into the separate attributed external lane using an exact-ID crosswalk, source voice and CC BY notices.

**Done when:** source-grounded direct and weak connections are both discoverable but never conflated. No claims from upstream editorial/AI readings enter the canonical grammar graph automatically. No general symbolic ontology required.

### Step 11 — Optional improvements, only based on measured failures

Possible priorities, individually gated:

- Broaden MACULA tree coverage from original files; first determine whether currently limited import is a data-pipeline issue.
- Add precise source-referent/coreference links where uniquely resolvable.
- Add specific semantic constructions such as comparison or explicit textual identification.
- Bring in free UD/PTNK/PROIEL/BHSA **only if** licenses and controlled validation use permit it, and tests show real improvements.
- Add stronger LXX word-level alignment if a reliable freely licensed resource exists; otherwise retain lexical pairs only.
- Add deterministic lexical/contextual ranking metrics beyond counts when they improve search quality on known test queries.

**Do not implement** a general semantic parser, AI ontology generator, event-world model, complicated PageRank service, or full seven-layer schema as prerequisites for the grammatical relationship engine.

### 15.1 Step completion message contract

Each coding step should report at most:

```
Step <number>: PASS / PARTIAL / BLOCKED
Changed: <paths>
Evidence: <tests and exact counts, one line>
Known limitation: <one line>
Next: <next atomic step>
```

Detailed diagnostics go to a file, not the assistant conversation. This reduces AI-token use and prevents context pollution. Commit focused steps to a reviewable branch. Run full checks at stage 6 (release) and stage 8–9 (integration), not after every small text edit.

---

## 16. Integration with future concept profiles and DLM research

This is **later work**, not a dependency of the grammatical MVP.

### 16.1 From lemma behavior to a biblical concept profile

A lexical entry tells us which senses a word can have; the grammatical relationship graph tells us what **uses and relationships are attested**. A future profile can deterministically display:

- The lexeme's source-backed lexical sense candidates.
- Verbs it is subject/object of (with counts/evidence).
- Modifiers and genitive/construct relations.
- LXX translation candidates and differences.
- Frequently co-occurring words, separately labelled.
- Coverage and examples where the source meaning remains ambiguous.

A *word* and a *concept* are not interchangeable. A theological concept such as divine speech may be expressed by multiple Hebrew/Greek lemmas; connecting those into one semantic identity requires evidence beyond a shared English gloss. Initially **a word profile is safer than an automatic unified concept ontology**. Add `concept_member_candidate` relations only when suitable source-backed mapping is available, with ambiguous senses preserved.

### 16.2 Research overlay boundaries

When ready, DLM and other research projects can attach notes and hypotheses to any of:

- Stable lemma/lexeme/sense IDs.
- Original-language occurrence IDs and verse ranges.
- Exact grammatical frame IDs.
- Relation-summary IDs plus their evidence IDs.
- User-created physical elements, processes, principles and questions.
- Sevenfold structured domains (creation days, appointed times, seven trumpets) and *proposed* layer alignments.

Mutable research content belongs in Supabase, with author provenance (`human`, `ai`, `ai_assisted`), future account/workspace privacy, revisions and review status. Static grammatical facts never inherit private workspace conclusions. Source-backed biblical evidence may inform a DLM hypothesis, but does not automatically prove that hypothesis.

### 16.3 No AI in graph generation; optional AI on top

The compiler uses original source annotations and deterministic rules. The user may later ask an AI assistant to interpret a relationship; the assistant receives **exact evidence from the same MCP** and may store its reasoning as a labelled research note, never overwrite a source edge. An AI model is not required to run a query or build a basic definition.

---

## 17. Deployment, security, compatibility and rollback

1. **Phase 0 first:** protect the existing 19-table Supabase reclamation work, Cloudflare source mapping parity, backup/recovery and deployed RPC preservation. No schema or asset cutover from this spec authorizes production data removal.
2. **Local/staged build first:** run extractor on verified cached MACULA/STEP files. The graph is published as a new versioned static namespace; no destructive database migrations.
3. **Licenses:** rights allowlist checked at source **field** level, not just repository README. No private/restricted metadata in public assets.
4. **Research permissions:** source grammar is public only if the specific dataset license permits. Private notes/workspaces remain in Supabase under verified authorization/RLS; neither the Worker nor MCP exposes others' data through public cached responses.
5. **Existing v1 APIs:** retain signatures, names and expected behavior, especially `research_relationships_v1`, `research_word_lens_v1`, `research_word_bridge_v1`, `research_passage_lens_v1` and note hydration. Implement new APIs additively and only route old clients deliberately.
6. **Deployment provenance:** compare local code, GitHub, live Supabase and Cloudflare before replacing anything. Source changes made through ChatGPT plugins must be recovered into source control, not overwritten with older Git snapshots.
7. **Release activation:** publish staged immutable corpus+graph, verify manifest/content, then atomically select active graph release; never publish incomplete asset mix. Keep last good release for instant rollback.
8. **Strict integrity errors:** corrupted or missing graph shard is an error, not empty evidence. If graph service is down, Bible reading and existing features must continue without silently false answers.
9. **No additional database cost:** run deterministic local/offline jobs and static assets. Benchmark Worker performance; if static asset constraints require revised partitions, change indexing, not platform architecture by default.
10. **Safe rollback:** point graph reads back to previous immutable release and disable only new UI/MCP v2 entrypoints; keep existing corpus, v1 RPCs and dynamic research untouched.

---

## 18. Definition of done (realistic first release)

The relationship system is MVP-ready when **all** are true:

- [ ] Source files/editions/rights and mapping versions are pinned and verified; no high-volume static PostgreSQL dependency is introduced.
- [ ] Hebrew and Greek grammatical S/V/O extraction works on the verified pilot and a defined supported subset; unsupported roles retain honest coverage reports.
- [ ] Subject, object, indirect-object, modifier and construct/genitive **where supported** produce distinct typed relations, not a single word-distance score.
- [ ] Every emitted high-quality relation can be traced to actual source-token positions, clause, exact edition, rule and passage reference.
- [ ] A lemma query returns grouped grammatical, lexical and contextual relations with **separate** counts and cited witnesses.
- [ ] The optional LXX lexical bridge is either verified and included in its separate lane **or** explicitly excluded without blocking the grammatical release.
- [ ] Known Hebrew homographs, Greek original-language editions, co-occurrence ambiguities and command/negative/passive tests pass.
- [ ] Multi-word paths never create fabricated single-frame claims from different passages.
- [ ] Cloudflare staged version serves bounded and hash-verified relationship queries; old data/interfaces remain functional.
- [ ] Website word click works and MCP returns matching v2 evidence from the same release.
- [ ] A re-run on identical sources yields the same graph data; full build reports measured coverage, skip reasons and byte size.
- [ ] The mandatory negative fixtures have zero falsely labelled `source_explicit` actions, and errors are visible rather than converted to empty results.

**Explicit non-goals for MVP:** Perfect morphological disambiguation; a full semantic ontology of God, light or love; complete pronoun resolution; assigning every verse a complete event graph; automatic theological symbolic interpretation; complete Hebrew–LXX word alignment; exhaustive biblical concept definitions; commercial licensing of restricted third-party corpora.

### 18.1 First demo queries that prove value

1. **`God` (Hebrew):** show `אֱלֹהִים` (and other exact lexical candidates), then source-backed *verbs it grammatically subjects*, with Genesis 1:1 among the witnesses where supported.
2. **`create` (Hebrew):** show subject lemmas and object lemmas from actual source frames, with occurrence counts and evidence (not paired by global co-occurrence).
3. **`love` (Hebrew/Greek):** keep `subject_of love` distinct from `object_of love`, with imperative/negation/context filters and unresolved pronouns clearly marked.
4. **`bread` (H3899):** show source lexical meaning candidates, grammatical uses, translation-pair candidates if verified, and proximity neighbors in distinct lanes.
5. **`seed` + `word`:** do not infer dictionary equality from the Luke 8:11 copular/parabolic statement. Display source-scoped grammatical/predicative evidence only if implemented, otherwise explain that it requires a later predicate rule.
6. **`God`, `create`, `heavens`:** if all chosen lexical entities co-occur in **one extracted frame**, show one supported S–V–O construction. Do not join across unrelated verses.
7. **Cross-language lookup:** when a sourced LXX lexical pairing is available, navigate Hebrew→Greek and Greek→Hebrew with reported counts, disambiguation, and source warnings.

---

## 19. Primary references and source verification checklist

**Official project/resource entrypoints; verify exact pinned versions and licenses before importing.** These are engineering references, not instructions to make external web calls at runtime:

- MACULA Hebrew: https://github.com/Clear-Bible/macula-hebrew — README documents `WLC/nodes`, `WLC/lowfat`, `WLC/tsv` and says morphology, syntax, semantic roles and referents are combined; field-level restrictions still apply.
- MACULA Greek: https://github.com/Clear-Bible/macula-greek — use edition-specific source data; audit frame/role fields and upstream permissions.
- STEP Bible data: https://github.com/STEPBible/STEPBible-Data — lexical identities, word forms, licensed lexical/reference descriptions, source editions.
- BCV lexical reference data: https://huggingface.co/datasets/bcv-commons/hebrew-lexical-references — optional downloadable `lxx_bridge.tsv`, documented root/parallelism resources, CC0/CC BY material and claimed lineage; **treat labels and reported pair counts as third-party provenance until independently validated**.
- Universal Dependencies Ancient Hebrew PTNK: https://universaldependencies.org/treebanks/hbo_ptnk/ — validation candidate, noncommercial licensing.
- Universal Dependencies Ancient Greek PROIEL: https://universaldependencies.org/treebanks/grc_proiel/ — validation candidate, noncommercial/sharealike licensing.
- ETCBC BHSA: https://github.com/ETCBC/bhsa — optional independent Hebrew annotation source, rights and edition alignment must be verified.
- MACULA syntax→dependency conversion reference (not mandatory library): https://mova.elamur.ai/free/en/docs/tools/macula/ — a rule-based converter is documented; inspect and license-audit source code before reuse.
- PostgreSQL/Supabase security: https://supabase.com/docs/guides/database/postgres/row-level-security — future dynamic workspace notes, not public immutable corpus processing.

**Pinning requirement:** If a project release manifest already records a verified source commit, use that exact hash; do not replace source pins with GitHub `main` automatically. For every imported resource store source URL, commit/hash, file digests, actual available columns/annotations, legal rights per output field, parser version, mapping version and extraction version.

**Required final development behavior:** Implement the smallest proven subset first. Add source files and predicate rules only after tests demonstrate value. Preserve known limitations. The system's scientific virtue is that users can follow every relationship back to the original text and the precise extraction method, instead of trusting a plausible label or an opaque score.

- BibleOntology upstream: https://github.com/bibleontology/bibleontology — inspect pinned `tools/builder/{source.py,s1_clauses.py,s2_s3.py,s4_s5.py,build.py}`, `tables/{hebrew,greek}/heads.json`, `README.md`, `LICENSING.md`, `NOTICE`, `SOURCES.md` and `tests/test_assertion_policy.py`. Code Apache-2.0, graph/vocabulary CC BY 4.0 with upstream source notices. **Do not treat the entire curated export as deterministic or narrator voice by default.**
