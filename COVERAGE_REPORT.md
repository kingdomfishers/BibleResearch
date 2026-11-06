# Biblical Evidence Coverage & Data Integrity Audit Report

> **Audited Target:** Bible Research Engine (`ejoperxiwxlcbsqrkrvb`)  
> **Audit Function:** `public.audit_evidence_coverage_v1()`  
> **Status:** ✅ PASS (Strict Determinism & Invariant Compliance Verified)  
> **Verification Command:** `node scripts/audit-evidence-coverage.mjs`

---

## 1. Executive Summary

This audit assesses the Bible Research Engine's database schema, data population, source provenance, and MCP tool access against the requirements of **complete, accurate, source-traceable original-language biblical evidence**.

### Core Findings
1. **Corpus-Wide Text & Lexicon (STEPBible):** 100% complete for all 66 canonical books (39 Hebrew/Aramaic OT and 27 Greek NT). All 31,203 verses, 443,524 tokens, 150,105 surface word forms, and 13,913 Strong's numbers are fully populated.
2. **Pilot Incompleteness Disambiguation:** 
   - **MACULA Hebrew:** Classified as **`import_incompleteness`**. The database contains 1,314 morphemes across 70 pilot verses (Genesis 1:1–31, Psalms 1:1–3:9, Isaiah 53:1–12), representing **0.3015%** of the 23,213 upstream OT verses. 36 of 39 OT books have zero morphemes imported.
   - **Swete Septuagint (LXX):** Classified as **`import_incompleteness`**. All 55 books are cataloged in metadata (`lxx_swete_books`), but only 70 verses and 1,422 words are ingested into `lxx_swete_words` (**0.2566%** token coverage). 52 books currently have zero text ingested.
   - **MACULA Greek:** Classified as **`import_incompleteness`** (0 dedicated morpheme rows; NT Greek is currently supplied via STEP TAGNT NA28).
   - **morphhb:** Classified as **`import_incompleteness`** (0 dedicated rows; morphology is integrated via STEP TAHOT / OSHB).
3. **Data Integrity & Foreign Keys:** **Zero orphaned records** across all 12 foreign key relationships. Zero duplicate primary keys, verses, or sense keys.
4. **License Isolation & Gating:** UBS SDBH semantic domains and unverified argument frames are strictly gated/disabled via `field_license_registry` and excluded from public RPC outputs.
5. **MCP Accessibility Surface:** 11 read-only tools are exposed via `bible-mcp`. However, **12 newly deployed PostgreSQL RPCs** (7 canonical lexical lookups, 4 Septuagint comparison RPCs, and 1 canonical books RPC) are accessible via PostgREST and OpenAPI 3.1.0, but **lack direct MCP tool bindings**.

---

## 2. Pinned Source Releases & Cryptographic Checksums

| Dataset Identifier | Source Repository | Pinned Commit / Version | License | SHA-256 Checksums |
| :--- | :--- | :--- | :--- | :--- |
| **STEPBible** | [STEPBible-Data](https://github.com/STEPBible/STEPBible-Data) | `be4191f` (2026-11) | CC BY 4.0 | `TAHOT Gen-Deu`: `e9b8546e...`<br>`TAHOT Jos-Est`: `195fee1d...`<br>`TAHOT Job-Sng`: `bb508af3...`<br>`TAHOT Isa-Mal`: `f3ded203...`<br>`TAGNT Mat-Jhn`: `ab8eaaeb...`<br>`TAGNT Act-Rev`: `524e3237...`<br>`TBESH`: `464dccad...`<br>`TBESG`: `312f723d...` |
| **MACULA Hebrew** | [macula-hebrew](https://github.com/Clear-Bible/macula-hebrew) | `47db250` (2026-04-24) | CC BY 4.0 | `WLC/tsv/macula-hebrew.tsv`: `965cb0599beed2fe31283b615bcc369178141c0e718a66d97518d94309cfc124`<br>`LICENSE.md`: `08c8c36e37f245de517e3d536877aeffed86d5941e05510e5d45785b71c0590d` |
| **MACULA Greek** | [macula-greek](https://github.com/Clear-Bible/macula-greek) | `8423afe` (2026-07-07) | CC BY 4.0 | `Nestle1904.tsv`: `68e29d26d06b54aebb0660bf35ebcc62cd960919f64ce0d613d2ba7b589e5fe6`<br>`SBLGNT.tsv`: `a9f6ee958f8c3e73337c3db897637c61559ab80a39016249b7c59f3bf594567a` |
| **morphhb** | [morphhb](https://github.com/openscriptures/morphhb) | `3d15126` (2024-08-27) | CC BY 4.0 | `LICENSE.md`: `a3572c65155ce4fd7c482f635a7e3a903b69f28051961d1e9cc92aa8a657152c` |
| **Swete Septuagint** | [lxx-swete](https://github.com/nathans/lxx-swete) | `26bad3e` (2025-12-18) | CC BY-SA 4.0 | `README.md`: `212b1c4323bcdd10f4fe6cb9420dc8e2dcfd4850fa7120df0f81d1e70d4fcb4c`<br>`COPYING-Code`: `d50d03de77c13a0709bf0e380f7aa9588b394140a3be415668b55d7879e8ca37` |

---

## 3. Expected vs. Imported Evidence Metrics

| Dataset | Scope / License | Expected Books | Imported Books | Missing Books | Expected Verses | Imported Verses | Verse Coverage | Expected Tokens | Imported Tokens | Token Coverage | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **STEPBible (TAHOT/TAGNT/TBESH/TBESG)** | CC BY 4.0 | 66 | 66 | 0 | 31203 | 31203 | 100.00% | 443524 | 443524 | 100.00% | `complete_import` |
| **Clear-Bible MACULA Hebrew** | CC BY 4.0 (gated SDBH) | 39 | 3 | 36 | 23213 | 70 | 0.3016% | 426584 | 1314 | 0.3080% | `import_incompleteness` |
| **Clear-Bible MACULA Greek** | CC BY 4.0 (gated MARBLE) | 27 | 0 | 27 | 7957 | 0 | 0.00% | 137844 | 0 | 0.00% | `import_incompleteness` |
| **openscriptures/morphhb** | CC BY 4.0 | 39 | 0 | 39 | 23213 | 0 | 0.00% | 426584 | 0 | 0.00% | `import_incompleteness` |
| **nathans/lxx-swete (Septuagint)** | CC BY-SA 4.0 | 55 | 55 (metadata) / 3 (text) | 52 | 27872 | 70 | 0.2511% | 554086 | 1422 | 0.2566% | `import_incompleteness` |


> **Key Rule Enforced:** Under acceptance testing, the 70-verse pilot imports are strictly designated as **`import_incompleteness`**. They cannot be classified as complete because the declared upstream sources contain 23,213 Old Testament verses and 55 Septuagint books.

---

## 4. Data Integrity: Duplicates, Orphans, and Unrecognized Records

### A. Missing Records
- **MACULA Hebrew:** 36 OT books missing (Exodus through Malachi, excluding Gen, Psa, Isa); 23,143 verses unimported.
- **MACULA Greek:** 27 NT books missing from dedicated macula tables.
- **morphhb:** 39 OT books unimported into dedicated tables.
- **Swete Septuagint:** 52 books missing text; 27,802 verses unimported.

### B. Duplicate Checks (`public.audit_evidence_coverage_v1()`)
- **Canonical Verses (`book, chapter, verse_nr`):** `0` duplicates.
- **LXX Words (`book_no, chapter, verse_nr, suffix, ordinal`):** `0` duplicates.
- **MACULA Morphemes (`macula_id`):** `0` duplicates.
- **Lexical Senses (`sense_key`):** `0` duplicates.
- **Lemma-Root Links (`lemma_id, root_id`):** `5` records. *Note:* Distinct etymology types exist for the same root (e.g. Abbott-Smith `derived_from` vs STEP `spelling_variant_of`); `(lemma_id, root_id, etymology_type)` is 100% unique.
- **Entity Relationships (`subject, object, relation_type`):** `8` records. *Note:* Distinct derivation methods or dual verse attestations registered for the same entity pair.

### C. Foreign Key Orphan Checks (Anti-Join Queries)
All orphan queries are executed database-natively using `NOT EXISTS` checks:
- `word_form_lemmas -> words`: **0 orphans**
- `word_form_lemmas -> lemmas`: **0 orphans**
- `lemma_root_links -> lemmas`: **0 orphans**
- `lemma_root_links -> lexical_roots`: **0 orphans**
- `lexical_senses -> lemmas`: **0 orphans**
- `macula_hebrew_morphemes -> verses`: **0 orphans**
- `macula_gated_field_values -> macula_hebrew_morphemes`: **0 orphans**
- `hebrew_lxx_verse_map -> verses`: **0 orphans**
- `hebrew_lxx_verse_map -> lxx_swete_books`: **0 orphans**
- `lxx_swete_words -> lxx_swete_books`: **0 orphans**
- `entity_relationships -> canonical_entities (subject)`: **0 orphans**
- `entity_relationships -> canonical_entities (object)`: **0 orphans**

### D. Unrecognized & Malformed Records
- **Book IDs out of canonical range [1-66]:** `0`
- **Swete Book IDs out of range [1-55]:** `0`
- **Upstream Raw Malformed Lines:** `25 lines` identified in `nathans/lxx-swete/data` where line prefix does not conform to `<book>.<chapter>.<verse> <word>`.

---

## 5. Lexical, Morphological, and Syntactic Annotation Availability

| Linguistic Layer | Annotation Feature | Source Dataset | Populated Rows | Status in Database | Licensing / Access Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Lexical** | Base Strong's Lexemes & Homographs | STEP TBESH / TBESG | 22,719 | **Populated** | CC BY 4.0; homographs preserved |
| **Lexical** | Canonical Headword Lemmas | STEP + scholarly | 22,171 | **Populated** | CC BY 4.0 |
| **Lexical** | Surface Form to Lemma Links | STEP TAHOT/TAGNT | 270,447 | **Populated** | CC BY 4.0; 100% token coverage |
| **Lexical** | Documented Etymological Roots | STEP + Abbott-Smith | 2,637 roots / 6,504 links | **Populated** | `implies_synonymy = false` enforced |
| **Lexical** | Licensed Sense Definitions | STEP + Abbott-Smith | 26,179 | **Populated** | CC BY 4.0 |
| **Lexical** | Online Bible "Meaning" Column | STEP TBESH col 7 | 0 (Purged) | **Excluded** | Restricted license; permanently purged |
| **Lexical** | SDBH & MARBLE Semantic Domains | Clear-Bible / UBS | 0 | **Excluded** | UBS "Used with permission"; gated out |
| **Morphological** | Surface Token Parsing Codes | STEP (TAHOT/TAGNT) | 150,105 | **Populated** | CC BY 4.0 |
| **Morphological** | Server-Side Grammar Decoding | PostgreSQL native | `decode_grammar_v1` | **Active** | Decodes gender, number, tense, stem |
| **Morphological** | Sub-word Morpheme Segmentation | MACULA Hebrew | 1,314 | **Partial** | CC BY 4.0; pilot 70 verses |
| **Syntactic** | Conjoin Word Syntax Trees | STEP TAGNT | 3,425 nodes / 4,081 edges | **Populated** | CC BY 4.0 |
| **Syntactic** | Phrase / Clause Syntax Trees | MACULA Hebrew | 1,314 morphemes | **Partial** | Pilot 70 verses |
| **Syntactic** | Argument Frames (A0/A1) | MACULA Hebrew | 0 in RPCs | **Disabled** | Status `disabled_unverified` |
| **Semantic** | Participant / Subject References | MACULA Hebrew | 1,314 morphemes | **Partial** | Pilot 70 verses |
| **Alignment** | Hebrew-to-Greek Word Equivalents | MACULA Hebrew | 383 links | **Partial** | Status `enabled_origin_unverified` |
| **Alignment** | Septuagint Parallel Versification | Swete + manual audit | 70 mapped verses | **Partial** | CC BY-SA 4.0; Psalm shifts preserved |

---

## 6. MCP Capability & Tool Accessibility Surface

| Tool / Function Name | Domain Layer | Bound in `bible-mcp`? | PostgreSQL RPC / Backend | Access Scope |
| :--- | :--- | :--- | :--- | :--- |
| `prompt_verse_words` | Core Reader | **YES** | `prompt_verse_words` | Read original verse words |
| `prompt_word_occurrences` | Core Reader | **YES** | `prompt_word_occurrences` | Find word occurrences across inflections |
| `prompt_word_cooccurrences` | Core Reader | **YES** | `prompt_word_cooccurrences` | Find top 15 cached lexical partners |
| `prompt_word_relationships` | Core Reader | **YES** | `prompt_word_relationships` | Find shared passages by SQL density score |
| `resolve_word_id` | Core Reader | **YES** | `resolve_word_id` | Resolve query string to database word ID |
| `get_word_details` | Core Reader | **YES** | `public.words query` | Inspect word details, Strong's and grammar |
| `get_verse_chronology_v1` | Chronology | **YES** | `get_verse_chronology_v1` | Multi-model dating and archaeological evidence |
| `get_verse_geography` | Geography | **YES** | `get_verse_geography` | 5-tier context-aware biblical geography |
| `research_relationships` | Relationships | **YES** | `research_relationships_v1` | One-lookup evidence graph |
| `get_verse_research` | Hydration | **YES** | `get_verse_research_v1` | One-call deduplicated JSON evidence packet |
| `get_research_prompt` | Workflow Router | **YES** | `static catalog` | Workflow instructions for 17 prompts |
| `get_bible_books_v1` | Canon | ❌ NO | `get_bible_books_v1` | 66 canonical books metadata (PostgREST only) |
| `lookup_word_to_lemma_senses_v1` | Canonical Lexical | ❌ NO | `lookup_word_to_lemma_senses_v1` | Word -> Lemma -> Senses (PostgREST/OpenAPI only) |
| `lookup_lemma_occurrences_v1` | Canonical Lexical | ❌ NO | `lookup_lemma_occurrences_v1` | Lemma -> Keyset occurrences (PostgREST/OpenAPI only) |
| `lookup_lemma_root_relatives_v1` | Canonical Lexical | ❌ NO | `lookup_lemma_root_relatives_v1` | Lemma -> Documented roots (PostgREST/OpenAPI only) |
| `lookup_lemma_english_glosses_v1` | Canonical Lexical | ❌ NO | `lookup_lemma_english_glosses_v1` | Lemma -> Attested glosses (PostgREST/OpenAPI only) |
| `lookup_passage_tokens_syntax_v1` | Canonical Lexical | ❌ NO | `lookup_passage_tokens_syntax_v1` | Passage -> Syntax trees (PostgREST/OpenAPI only) |
| `lookup_concept_properties_v1` | Canonical Lexical | ❌ NO | `lookup_concept_properties_v1` | Concept -> External facts (PostgREST/OpenAPI only) |
| `lookup_entity_relationships_v1` | Canonical Lexical | ❌ NO | `lookup_entity_relationships_v1` | Entity -> Provenance links (PostgREST/OpenAPI only) |
| `lookup_hebrew_to_greek_alignments_v1` | Septuagint | ❌ NO | `lookup_hebrew_to_greek_alignments_v1` | Forward Hebrew->Greek search (PostgREST/OpenAPI only) |
| `lookup_greek_to_hebrew_alignments_v1` | Septuagint | ❌ NO | `lookup_greek_to_hebrew_alignments_v1` | Reverse Greek->Hebrew search (PostgREST/OpenAPI only) |
| `get_hebrew_septuagint_parallel_v1` | Septuagint | ❌ NO | `get_hebrew_septuagint_parallel_v1` | Side-by-side MT/LXX parallel (PostgREST/OpenAPI only) |
| `lookup_cross_testament_greek_v1` | Septuagint | ❌ NO | `lookup_cross_testament_greek_v1` | Cross-testament Greek trace (PostgREST/OpenAPI only) |


### MCP Accessibility Findings:
1. **Fully Covered MCP Domains:** Core verse reading, occurrence lookups, co-occurrence statistics, shared-verse density scoring, word details, multi-model chronology, 5-tier biblical geography, and hydrated research packets (up to 100 verses) are fully accessible via `bible-mcp`.
2. **Exposed via PostgREST / OpenAPI 3.1.0 but Missing in MCP Catalog:**
   - **Canonical Books:** `get_bible_books_v1`
   - **7 Canonical Lexical Lookups:** `lookup_word_to_lemma_senses_v1`, `lookup_lemma_occurrences_v1`, `lookup_lemma_root_relatives_v1`, `lookup_lemma_english_glosses_v1`, `lookup_passage_tokens_syntax_v1`, `lookup_concept_properties_v1`, `lookup_entity_relationships_v1`
   - **4 Septuagint Layer Functions:** `lookup_hebrew_to_greek_alignments_v1`, `lookup_greek_to_hebrew_alignments_v1`, `get_hebrew_septuagint_parallel_v1`, `lookup_cross_testament_greek_v1`
3. **Recommendation:** Register tools in `supabase/functions/bible-mcp/catalog.ts` for the canonical lookups and Septuagint comparison RPCs to achieve 100% parity between MCP and PostgREST.

---

## 7. Disambiguation: Source Incompleteness vs. Import Incompleteness

| Dataset | Observed Gap | Incompleteness Category | Root Cause & Evidence |
| :--- | :--- | :--- | :--- |
| **STEP TBESH** | Missing English definitions on some homographs; Meaning column null | **Source Incompleteness** | Online Bible proprietary license forbids commercial/open redistribution of column 7. STEP supplies glosses; theological exposition was intentionally excluded. |
| **MACULA Hebrew** | Only Genesis 1:1–31, Psalms 1:1–3:9, and Isaiah 53:1–12 present in DB | **Import Incompleteness** | Upstream repository contains full WLC text for all 39 OT books (426,584 morphemes). Only a 70-verse pilot batch was ingested into `macula_hebrew_morphemes`. |
| **MACULA Hebrew** | Greek equivalents absent on ~88% of tokens | **Source Incompleteness** | Upstream `WLC/tsv/macula-hebrew.tsv` contains values for `greek` and `greekstrong` on only 52,192 of 426,584 rows (12.23%). Origin is undocumented upstream. |
| **MACULA Hebrew** | SDBH Semantic Domains null in public views | **Licensing Policy (Source-Restricted)** | Clear-Bible notes SDBH is "Used with permission" from UBS. Gated out of public RPCs to prevent license infringement. |
| **Swete Septuagint** | Only 70 verses with Greek text in `lxx_swete_words` | **Import Incompleteness** | Upstream repository contains 554,086 words across 55 books. Database contains only 1,422 words from the pilot batch. |
| **Swete Septuagint** | Absence of New Testament Greek | **Source Incompleteness** | Swete's edition is exclusively an Old Testament and Apocrypha corpus. NT Greek must be retrieved from TAGNT or SBLGNT. |
| **Swete Septuagint** | Absence of morphological tags or lemmas | **Source Incompleteness** | Swete text files in `nathans/lxx-swete` provide only word tokens and punctuation; grammatical annotations must be joined from external lexicons. |

---

## 8. Reproducibility & Acceptance Test Suite

To reproduce every metric and table in this report, run:

```bash
# 1. Run deterministic evidence coverage audit (Node.js + PostgreSQL RPC)
node scripts/audit-evidence-coverage.mjs

# 2. Run Septuagint & Hebrew-Greek comparison verification suite
node scripts/verify-septuagint-layer.mjs

# 3. Run Canonical Lexical & Invariant verification suite
node scripts/verify-canonical-lexical-db.mjs

# 4. Verify OpenAPI 3.1.0 REST contract alignment
node scripts/verify-openapi.mjs
```

All queries are executed with `STABLE` caller-RLS database guarantees and produce byte-for-byte identical output on unchanged data.
