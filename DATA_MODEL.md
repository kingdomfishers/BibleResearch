# DATA_MODEL.md — Canonical Biblical Lexical & Evidence Schema

Updated: 2026-11-06. Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md), [PROVENANCE.md](PROVENANCE.md), [DATA_SOURCES.md](DATA_SOURCES.md).

## 1. Non-Negotiable Modeling Invariants

The schema enforces strict relational boundaries so linguistic, textual, external factual, and interpretive claims are never conflated:

1. **Surface Word Form $\neq$ Canonical Lemma:** `public.words` (`150,105` inflected surface forms + grammar codes) links to `public.lemmas` (`22,171` dictionary headwords) through `public.word_form_lemmas` (`270,447` ordered morpheme-to-lemma links covering prefixes, stems, and suffixes).
2. **Lemma $\neq$ Root & Root $\neq$ Meaning:** `public.lexical_roots` (`2,637` documented bases/stems) contains zero meaning or gloss columns. `public.lemma_root_links` (`6,504` links) enforces `CHECK (implies_synonymy = false)` and `public.relation_types` enforces `CHECK (NOT (category = 'etymological' AND implies_synonymy))`—two words sharing a root are never automatically marked synonymous.
3. **Homograph & Polysemy Preservation:** Distinct homographs sharing a base Strong's number (e.g., `lemma:H1254a` / `lemma:H1254b` / `lemma:H1254c`; `lemma:H5869a` *eye* vs `lemma:H5869b` *spring*) remain separate rows in `public.lemmas` and `public.lexemes`. Zero AI contextual sense assignment is performed.
4. **Lexical Sense $\neq$ English Translation $\neq$ Word Alignment:** `public.lexical_senses` (`26,179` source-attributed lexicon senses) is stored separately from attested interlinear occurrence strings (`public.verse_translation_sources`) and continuous English verse editions (`public.reader_english_verses`), which carry explicit non-alignment disclosures.
5. **Epistemic Layer Separation:** Every concept property and evidence relationship records `epistemic_layer`:
   - `'primary_biblical'` — Direct textual/morphosyntactic observation in an edition.
   - `'lexical_reference'` — Cataloged dictionary/etymological entry from a pinned lexicon.
   - `'external_factual'` — Geographic coordinates, Pleiades/Wikidata identifiers, or historical/archaeological metadata.
   - `'reviewed_research'` / `'reviewed_interpretation'` — Curated literary parallels, typological motifs, or user-authored private notes (isolated by RLS).

---

## 2. Normalized Entity Tables (`supabase/migrations/20261105230000_canonical_lexical_and_evidence_schema.sql`)

| Domain | Table | Primary / Typed Key | Live Rows | Responsibility |
| :--- | :--- | :--- | ---: | :--- |
| **Editions & Versification** | `public.source_editions` | `edition_key` (`tahot-2026-11`, `tagnt-na28-2026-11`, `tbesh-2026-11`, `tbesg-2026-11`, `abbott-smith-1922`, `webp-2026-11`, ...) | 10 | Pinned textual, lexical, geographical, and chronological editions linked to `public.source_releases` |
| | `public.edition_passages` | `(edition_id, edition_ref)` | 62,418 | Edition-specific passage identifiers and witness metadata |
| | `public.versification_mappings` | `(from_edition_id, from_ref, to_edition_id, to_ref)` | 2,131 | Explicit Masoretic Hebrew (`Eng(Heb)`), Psalm superscription (`verse 0` $\leftrightarrow$ `verse 1`), and KJV bracket shifts |
| **Forms, Lemmas & Roots** | `public.lemmas` | `lemma_key` (`lemma:H0430G`, `lemma:H1254a`, `lemma:G3056`) | 22,171 | Canonical Hebrew (`hbo`), Aramaic (`arc`), and Greek (`grc`) headwords |
| | `public.lexeme_identifiers` | `(lexeme_id, id_namespace, id_value)` | 113,595 | Cross-system identifiers (`base_strongs`, `extended_strongs`, `disambiguated_strongs`, `unified_strongs`) |
| | `public.word_form_lemmas` | `(word_id, component_order, dstrongs_tag)` | 270,447 | 100% deterministic mapping of all `150,105` `public.words` forms into prefix/stem/particle lemmas |
| | `public.lexical_roots` | `root_key` (`root:H0430`, `root:G3056`) | 2,637 | Documented lexical bases and Greek etymological stems (no gloss/meaning columns) |
| | `public.lemma_root_links` | `(lemma_id, root_id, etymology_type)` | 6,504 | Provenance-tracked etymological links (`implies_synonymy = false`) |
| **Senses & Glosses** | `public.lexical_senses` | `sense_key` (`sense:G3056:primary`, ...) | 26,179 | Licensed sense definitions (`TBESG` + Abbott-Smith + `TBESH` CC BY glosses; restricted Online Bible `Meaning` excluded) |
| **Morphology & Syntax** | `public.token_morphemes` | `(verse_id, word_position, morpheme_order)` | 2,321 | Sub-word morpheme segmentations with surface, grammar, lemma, and gloss |
| | `public.syntax_nodes` | `node_key` | 3,425 | Token, phrase, and clause-span nodes anchored to passages and editions |
| | `public.syntax_edges` | `(verse_id, source_token_pos, target_token_pos, relation_role, source_edition_id)` | 4,081 | Grammatical dependency and `TAGNT` `Conjoin word` links |
| | `public.semantic_annotations` | `annotation_key` | 911 | Source-tagged sub-meaning/literary annotations (`reviewed` public vs `user_authored` owner-RLS) |
| **External Concepts** | `public.concept_properties` | `(concept_id, property_key, property_value, source_release_id)` | 8,864 | Structured external factual properties (coordinates, ISO dates, person/place attributes) |
| | `public.concept_external_links` | `(concept_id, provider, external_id)` | 2,119 | Verified external authority URIs (`Wikidata`, `Pleiades`, `OpenBible`, `Theographic`) |
| **Evidence Graph** | `public.relation_types` | `relation_type` | 18 | Controlled relation vocabulary with category and `implies_synonymy` constraints |
| | `public.canonical_entities` | `entity_key` | 82,485 | Polymorphic single-target anchor (`CHECK (num_nonnulls(...) = 1)`) across forms, lemmas, roots, senses, passages, concepts, places, and events |
| | `public.entity_relationships` | `relationship_key` | 15,259 | Unified evidence edges preserving dataset, edition, record ID, span/citation, `origin_mode`, and `derivation_method` |

---

## 3. Deterministic Lookup RPCs (`supabase/migrations/20261105233000_canonical_lookup_rpcs.sql`)

All seven functions execute in PostgreSQL with `SECURITY INVOKER`, `SET search_path = ''`, and `SET statement_timeout = '8s'`, exposed via `BibleRPC` (`src/api/rpc.ts`) and OpenAPI 3.1.0 (`supabase/openapi.json`):

1. `public.lookup_word_to_lemma_senses_v1(p_word_id, p_query)` — Surface word form $\to$ ordered morpheme-lemma links $\to$ cataloged lexical senses.
2. `public.lookup_lemma_occurrences_v1(p_lemma_query, p_after_verse_id, p_limit)` — Canonical lemma $\to$ homograph candidates, corpus totals across inflected forms, and keyset-paginated occurrences.
3. `public.lookup_lemma_root_relatives_v1(p_lemma_query)` — Canonical lemma $\to$ documented lexical roots and non-synonymous root relatives.
4. `public.lookup_lemma_english_glosses_v1(p_lemma_query, p_limit)` — Canonical lemma $\to$ lexicon sense glosses separated from aggregated corpus occurrence renderings.
5. `public.lookup_passage_tokens_syntax_v1(p_book, p_chapter, p_verse, p_edition_key)` — Passage $\to$ edition references, versification shifts, tokens, morphemes, syntax nodes/edges, and semantic annotations.
6. `public.lookup_concept_properties_v1(p_concept_query)` — Concept $\to$ definitions, aliases, documented `external_factual` properties, and external authority links.
7. `public.lookup_entity_relationships_v1(p_entity_query, p_relation_type, p_origin_mode, p_limit)` — Canonical entity $\to$ incoming and outgoing provenance-complete relationships.

---

## 4. Septuagint & Hebrew–Greek Comparison Layer (`supabase/migrations/20261106060000_septuagint_macula_schema.sql` & `20261106063000_septuagint_comparison_rpcs.sql`)

Enables original-language comparison between the Hebrew Masoretic Text (MT), the Septuagint Greek Old Testament (Swete edition), and the Greek New Testament.

| Domain | Table | Primary / Key | Live Rows | Responsibility |
| :--- | :--- | :--- | ---: | :--- |
| **License Gating** | `public.field_license_registry` | `(dataset_key, field_name)` | 20 | Field-level provenance and license registry with dynamic kill-switch (`enabled_verified`, `enabled_origin_unverified`, `disabled_unverified`) |
| **LXX Corpus** | `public.lxx_swete_books` | `book_no` | 55 | 55 books of Swete's Septuagint linked to canonical book numbers and releases |
| | `public.hebrew_lxx_verse_map` | `canonical_verse_id` | 70 | Hebrew MT to LXX Swete verse correspondence, handling Psalms title shifts (Psalm 3:0 MT $\to$ LXX 27:3:1) |
| | `public.lxx_swete_words` | `id` | 1,422 | Swete Septuagint Greek token corpus (CC BY-SA 4.0; First1KGreek / nathans) |
| **MACULA Hebrew** | `public.macula_hebrew_morphemes` | `macula_id` | 1,314 | Morphological segmentation, Strong's, glosses, and syntactic roles (CC BY 4.0) |
| | `public.macula_gated_field_values` | `(morpheme_id, field_name)` | 2,294 | Gated field values (`greekstrong`, `greek`, `frame`), dynamically controlled by license registry |

### Comparison RPCs:
1. `public.lookup_hebrew_to_greek_alignments_v1(p_lemma_query, p_limit)` — Forward search: Hebrew lemma $\to$ explicit source Greek translation equivalents from MACULA with frequency distributions and sample verses.
2. `public.lookup_greek_to_hebrew_alignments_v1(p_greek_query, p_limit)` — Reverse search: Greek lemma $\to$ underlying Hebrew lemmas rendered in the MT.
3. `public.get_hebrew_septuagint_parallel_v1(p_book, p_chapter, p_verse)` — Side-by-side MT Hebrew and Swete LXX Greek parallel text, handling versification shifts and displaying morpheme-level alignments with explicit licensing disclosures.
4. `public.lookup_cross_testament_greek_v1(p_greek_query, p_limit)` — Cross-testament vocabulary tracing across LXX Swete and NT Greek, with underlying Hebrew source renderings (e.g. Isaiah 53:7 $\leftrightarrow$ Acts 8:32).

