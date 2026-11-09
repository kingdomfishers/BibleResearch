# RELATIONSHIP_IMPORT_HANDOFF.md — Flash Bulk Import & Completion Guide

**Status:** Architectural foundation + vertical slice implemented and verified locally (`XREF-LEX-01`).  
**Target Executor:** Gemini Flash (High) — execute **one atomic step at a time** following `AGENTS.md`, `.agents/skills/pre-code/SKILL.md`, and `.agents/skills/post-code/SKILL.md`.  
**Authority Rule:** The **LOCAL workspace (`c:\Projects\BibleResearch`) is authoritative**. GitHub is used only for backup/version control and Cloudflare deployment. Do **not** interfere with ongoing `CORP-04` storage reclamation or run any destructive SQL in Supabase.

---

## 1. Architecture Decisions

### 1.1 Storage Boundary (Cloudflare Static Assets vs. Supabase)
- **Immutable Source Evidence → Cloudflare Static Assets (`bibleresearch-corpus`):**
  - All published cross-references (`CrossReferences.org`) and source/computational lexical relationships (`STEP Bible`, `HebrewLexicon`, corpus co-occurrences, shared English rendering statistics) live exclusively in gzipped JSON shards under `.artifacts/static-corpus/v1/relationships/`.
  - **Zero new tables or rows are added to Supabase** for immutable cross-references or lexical relationships.
  - Shard layout is bounded to **132 files total** (`manifest.json.gz`, 66 book shards `xrefs-b01.json.gz`..`xrefs-b66.json.gz`, `lexical-index.json.gz`, and 64 hash-bucketed lexical shards `lexical-00.json.gz`..`lexical-3f.json.gz`), adding `< 0.7%` to the Worker's 20,000-file asset limit and keeping every shard well under 2 MiB gzipped (limit: 25 MiB).
  - Single-passage and single-word lookups fetch **at most 1–2 shards (`O(1)`)** with Worker isolate LRU caching—zero runtime SQL joins and zero whole-corpus downloads.
- **Dynamic Research, Notes & Stances → Supabase (`public.notes`, `note_anchors`, `note_connections`):**
  - Human and AI notes, interpretations, review statuses (`unreviewed`, `confirmed`, `disputed`), and revision history (`note_revisions`) remain in Supabase behind existing `SECURITY DEFINER` write RPCs (`save_note_v1`, `agent_save_note_v1`, `set_note_review_v1`) and RLS policies.
  - External relationships are **never** auto-copied into `public.notes`. Notes are created **only** when a researcher explicitly saves a note in `NoteEditor` (or an agent calls `agent_save_note_v1`).
  - When a note evaluates an external relationship, `notes.source_context.relationship_ref` stores the stable `relationship_id`, `domain`, `relation_type`, `epistemic_tier`, `source_key`, `pinned_commit`, `locator`, and researcher `stance` (`'agree' | 'disagree' | 'alternative_interpretation'`).

### 1.2 Stable Relationship Identity
Implemented in `src/api/relationship-model.ts` and mirrored in `scripts/corpus-relationships-rpc.mjs` using deterministic 64-bit FNV-1a (`fnv1a64Hex`):
- **Cross-Reference ID:**
  ```text
  rel:v1:xref:<source_key>:<src_span_key>:s<subverse_sort>:a<anchor_sort>:<fnv64_prefix12>
  ```
  where `digest` hashes `xref|<source_key>|<src_span_key>|s<subverse_sort>|a<anchor_sort>|<target_cluster_key>`.
  - **Bidirectional ID Invariance:** Both the forward (`direction: 'outgoing'`) edge on the source passage and the pre-inverted reverse (`direction: 'incoming'`) edge on every target verse carry the **exact same `relationship_id`**.
- **Lexical Relationship ID:**
  ```text
  rel:v1:lex:<category>:<endpoint_a>:<endpoint_b>:<fnv64_prefix12>
  ```
  - Symmetric categories (`same_lemma`, `same_documented_root`, `semantic_overlap`, `synonymy`, `antonymy`, `related_translation`, `literary_wordplay`, `orthographic_overlap`, `co_occurrence`) sort `(subject.canonical_key, target.canonical_key)` lexicographically before hashing so `A ↔ B` and `B ↔ A` produce the **same `relationship_id`**.
  - Directed categories (`derivation`, `cognate`, `morphological_relationship`, `source_lexical_equivalence`) preserve `(subject -> target)` order in the canonical ID while emitting `direction: 'directed'` and `direction: 'inverse'` edges that share the same `relationship_id`.

### 1.3 Epistemic Tiers & Anti-Conflation Guardrails
Five epistemic tiers (`RelationshipEpistemicTier`) are strictly separated across APIs and UI:
1. `'attested_lexical_fact'` — Explicitly published in a pinned primary source (`CrossReferences.org` passage association, `TBESH` cols 0–6, `TBESG` cols 0–7, `TAHOT`/`TAGNT` tags).
2. `'deterministic_computational'` — Rule-based projections with pinned `algorithm_version` (`same_lemma` via `word_form_lemmas`, reverse cross-reference index `xref_reverse_index_v1`, consonantal `orthographic_overlap`).
3. `'statistical_association'` — Empirical corpus distributions (`co_occurrence` proximity scores, `related_translation` shared English rendering counts).
4. `'ai_hypothesis'` — Unreviewed AI-authored notes (`author.kind === 'ai'`, `epistemic_layer === 'user_note'`).
5. `'human_reviewed_interpretation'` — Curated scholarly annotations (`lexical_connections` `literary_wordplay`, `assertions`) and human researcher evaluations.

**Hard Guardrails Enforced (`validateLexicalEdgeIntegrity` & `CROSS_REFERENCE_GUARDRAILS`):**
- Every cross-reference carries `{ association_only: true, implies_quotation: false, implies_prophecy: false, implies_typology: false, implies_theological_equivalence: false }`.
- English cross-reference anchor phrases (`bsb`, `kjv`) **always** set `token_alignment: null` and `phrase_language: 'en'`. Never guess Hebrew/Aramaic/Greek token alignments from English phrases.
- Only source-attested `synonymy` (e.g. Abbott-Smith `SYN.:`) may set `implies_synonymy: true`. `same_documented_root`, `related_translation`, `semantic_overlap`, `orthographic_overlap`, and `co_occurrence` **must** set `implies_synonymy: false`.
- `orthographic_overlap` and `related_translation` **must** set `implies_common_etymology: false`.

### 1.4 Reuse of Existing Corpus Tables (No Duplication)
The lexical builder reuses already-exported static corpus tables in `.artifacts/static-corpus/tables/` rather than re-inventing them:
- `lemma_root_links` + `lexical_roots` → `same_documented_root`, `derivation`, `cognate`, `morphological_relationship`
- `entity_relationships` + `canonical_entities` → `cognate` (`greek_transliteration_of`, `aramaic_cognate_of`, `hebrew_cognate_of`), `source_lexical_equivalence` (`source_provided_lexical_equivalent`)
- `lexical_formations` + `lemma_components` → compound/theophoric `derivation`
- `lexical_connections` → `literary_wordplay` vs `orthographic_overlap`
- `word_form_lemmas` → `same_lemma` & paradigm `morphological_relationship`
- `v1/lexical/words-*.json.gz` → `co_occurrence` & `related_translation`

---

## 2. Source URLs and Pinned Revisions

| Dataset | Repository / URL | Pinned Commit SHA / Version | Role |
| :--- | :--- | :--- | :--- |
| **CrossReferences.org** | `https://github.com/CrossReferences-org/bible-cross-references` | `671bbf73b1e5155e31b209442dc5be3f5b3c1a41` | Canonical cross-references, BSB/KJV anchor phrases, versification table |
| **STEP Bible Data** | `https://github.com/STEPBible/STEPBible-Data` | `be4191f0082aeedddb0eff0c02c966292b2bd641` | Local `.artifacts/stepbible/{TBESH.txt,TBESG.txt,TAHOT*,TAGNT*}` |
| **OpenScriptures HebrewLexicon** | `https://github.com/openscriptures/HebrewLexicon` | `21c9add13bc727d3a951361778e97e3ff7afd1ce` | Local `.artifacts/sources/HebrewLexicon/HebrewStrong.xml` |
| **Clear-Bible MACULA Hebrew** | `https://github.com/Clear-Bible/macula-hebrew` | `47db250bd55d0d8577f2a94fba114ef16c35b23c` | Local `.artifacts/sources/macula-hebrew` (`greekstrong` license-gated!) |

Raw CrossReferences.org download URLs for bulk ETL caching (cache into `.artifacts/sources/crossreferences-org/`, which is git-ignored):
- `https://raw.githubusercontent.com/CrossReferences-org/bible-cross-references/671bbf73b1e5155e31b209442dc5be3f5b3c1a41/json/bible_books.json`
- `https://raw.githubusercontent.com/CrossReferences-org/bible-cross-references/671bbf73b1e5155e31b209442dc5be3f5b3c1a41/json/bible_verses.json`
- `https://raw.githubusercontent.com/CrossReferences-org/bible-cross-references/671bbf73b1e5155e31b209442dc5be3f5b3c1a41/json/cross_references.json`

---

## 3. Actual Source Fields

### 3.1 CrossReferences.org (`json/*.json`)
1. `json/bible_books.json` (66 rows):
   - `id` (`1..66`, matches `public.books.id` 1:1), `name_eng`, `abbreviation_eng` (plus `_fra`, `_afr`).
2. `json/bible_verses.json` (31,217 rows):
   - `id` (integer UID spaced by 10, e.g., `10` = Gen 1:1, with intermediate UIDs like `270905` on split verses)
   - `book_id` (`1..66`)
   - `kjv_ch`, `kjv_vs`, `kjv_sort`, `kjv_text`
   - `bsb_ch`, `bsb_vs`, `bsb_sort`, `bsb_text`
   - `aov_ch`, `aov_vs`, `aov_sort`, `aov_text`
3. `json/cross_references.json`:
   - `verse_id` (FK → `bible_verses.id`)
   - `sort` (1-based sequential phrase order within `verse_id`)
   - `kjv` (Public Domain English KJV anchor phrase; `""` on ~0.6% whole-verse links)
   - `bsb` (Public Domain / CC0 English BSB anchor phrase; `""` when unanchored or KJV/TR-only)
   - `aov` (Afrikaans 1933/1953 phrase — omit from English/original-language shards)
   - `s21` (**RESTRICTED** French Segond 21 phrase — **MUST STRIP ON INGEST; NEVER WRITE TO DISK OR SHARDS**)
   - `refs` (`number[][]` — array of target reference groups; each inner `number[]` is a list of `bible_verses.id` UIDs forming one cohesive single-verse, contiguous-range, or discontiguous-cluster reference).

### 3.2 STEP Bible Local Lexica (`.artifacts/stepbible/`)
1. `TBESH.txt` (tab-separated; **read columns `0..6` ONLY**):
   - Col `0`: `eStrong#` (`H0001`, `H0430G`, `H1254A`)
   - Col `1`: `dStrong` (`H0430G =`, `H0430H = a Meaning of`, `H0002 = in Aramaic of`, `= a Name of`, `= a Spelling of`, `= a group of`, `= a Part of`, `= a form of`, `= combination of`, `= in Hebrew of`)
   - Col `2`: `uStrong` (unified Strong's family headword)
   - Col `3`: `Hebrew` (pointed script)
   - Col `4`: `Transliteration`
   - Col `5`: `Morph` (`H:...` Hebrew, `A:...` Aramaic, `N:...` proper noun)
   - Col `6`: `Gloss` (Tyndale brief gloss, CC BY 4.0)
   - Col `7`: **`Meaning` (Online Bible — RESTRICTED; NEVER READ OR EXPORT COL 7)**.
2. `TBESG.txt` (tab-separated; **columns `0..7` are all CC BY 4.0**):
   - Cols `0..6`: `eStrong`, `dStrong` (`= the Greek of`, `= a Form of`, `= a Spelling of`, `= a Meaning of`, `= a Name of`, `= a Combination of`, `= a Group member of`, `= a Part of`), `uStrong`, `Greek`, `Transliteration`, `Morph`, `Gloss`.
   - Col `7`: `Abbott-Smith / edited Middle LSJ` — contains explicit `SYN.: ...` synonym lists, `opposite to ...` antonym markers, and `[in LXX chiefly for <Hebrew> ;]` / `Heb. <Hebrew>` cross-language lexical equivalences.

### 3.3 Local Static Corpus Tables (`.artifacts/static-corpus/tables/<table>/part-*.jsonl.gz`)
Note exact physical column names (read **all** `part-*.jsonl.gz` files per directory):
- `lemmas`: `id`, `language` (`hbo`|`arc`|`grc`), `lemma_key` (`lemma:H0430G`), `primary_pos`, `base_strongs` (compact, e.g. `H430`, `G450`), `lemma_script`, `homograph_tag`, `lemma_stripped`, `transliteration`, `primary_lexeme_id`.
- `lexemes` (2 parts): `id`, `lemma_id`, `lexeme_key`, `base_strongs`, `primary_gloss`, `homograph_note`, `original_lemma`, `transliteration`, `unified_strongs`, `extended_strongs`, `disambiguated_strongs`.
- `lemma_root_links`: `id`, `root_id`, `lemma_id`, `etymology_type`, `evidence_note`, `implies_synonymy`.
- `lexical_roots`: `id`, `root_key`, `root_script`, `transliteration`.
- `entity_relationships` (2 parts): `id`, `relation_type`, `subject_entity_id`, `object_entity_id`, `evidence_summary`, `review_status`.
- `canonical_entities` (5 parts): `id`, `entity_key`, `entity_kind`, `lemma_id`, `word_id`.
- `lexical_formations` & `lemma_components`: `id`, `lemma_id`, `formation_type`, `evidence_note` / `formation_id`, `component_lemma_id`, `component_role`, `surface_text`.
- `lexical_connections`: `id`, `relation_type` (`literary_wordplay` | `orthographic_overlap`), `subject_lemma_id`, `target_lemma_id`, `evidence_note`.
- `word_form_lemmas` (22 parts): `word_id`, `lemma_id`, `lexeme_id`, `grammar_code`, `dstrongs_tag`.

---

## 4. Import Mapping Rules

### 4.1 Cross-Reference Versification Mapping (`bible_verses.json` → Canonical `verses_compact`)
Canonical `v1/catalog/metadata.json.gz` contains **31,203** verses across books `1..66`, including **116 Psalm headings (`verse_nr = 0`)**. `bible_verses.json` contains **31,217** rows. Map every `bible_verses.id` deterministically using the 5 rules already implemented in `scripts/build-relationship-slice.mjs`:
1. **63 Two-Row Superscription Psalms (`book_id === 19 && bsb_vs === 1 && count(19:ch:1) === 2`):**
   - `kjv_sort === 1` (`aov_vs === 1`) → canonical `19:<ch>:0` (`is_psalm_heading: true`, `versification_status: 'exact_psalm_heading'`).
   - `kjv_sort === 2` (`aov_vs === 2`) → canonical `19:<ch>:1` (`is_psalm_heading: false`, `versification_status: 'exact_canonical'`).
2. **53 Single-Row Short-Heading Psalms (`book_id === 19 && bsb_vs === 1 && count(19:ch:1) === 1 && canonicalHas(19:ch:0)`):**
   - Psalms `11, 14, 15, 16, 17, 23, 24, 25, 26, 27, 28, 29, 32, 35, 37, 50, 66, 72, 73, 74, 78, 79, 82, 86, 87, 90, 98, 100, 101, 103, 109, 110, 120..134, 138, 139, 141, 143, 144, 145`.
   - Map to `19:<ch>:1` with `versification_status: 'combined_heading_and_verse1'` AND mirror outgoing references onto `19:<ch>:0` with `versification_note` explaining that the source combines short superscription and verse 1.
3. **48 Non-Psalm Multi-Record / Split Verses (e.g., `Gen 2:4`, `Acts 3:19-20`, `Rev 12:18`, `3 John 1:14-15`):**
   - **Chapter-tail Greek/NA28 split (`3 John 1:14-15`, rows `307480` & `307490`):** Where English KJV and BSB both end a non-Psalm chapter one verse earlier than canonical NA28 (`count(b:ch:bsb_vs) === 2`, `bsb_vs === maxBsbVs(b, ch)`, `maxCanonicalVs(b, ch) === bsb_vs + 1`), map `bsb_sort === 1` (`307480`, `aov_vs = 14`) to canonical `64:1:14` (`exact_canonical`) and `bsb_sort === 2` (`307490`, `aov_vs = 15`) to canonical `64:1:15` (`versification_status: 'versification_shift'`, `versification_note` recording `KJV/BSB 1:14b -> canonical Greek/NA28 1:15`). Do **not** apply `aov_vs` shifting mid-chapter (e.g. `2 Cor 5:14`, `id: 289675`), where Afrikaans AOV splits mid-chapter while BSB/NA28 chapter totals match.
   - Otherwise match via `(book_id, bsb_ch, bsb_vs)` to canonical `verses_compact`.
   - When `kjv_ch !== bsb_ch || kjv_vs !== bsb_vs` (e.g. `Rev 12:18` where KJV is `13:1, kjv_sort=1`), set `versification_status: 'versification_shift'`.
   - When multiple source rows still share `(book_id, bsb_ch, bsb_vs)` (`bsb_sort = 1, 2`), preserve `anchor.source_subverse_sort = bsb_sort` (`versification_status: 'sub_verse_part'`) so anchor ordering and IDs never collide!
4. **2 Corinthians 13:14 (`id: 291330`, `bsb: 13:14`, `aov: 13:13`):**
   - Canonical Greek NA28 ends at `47:13:13`. Map `291330` to canonical `47:13:13` (`subverseSort: 2`, `versification_status: 'versification_shift'`) and register `47:13:14` in `edition_only_by_coord` forwarding to `47:13:13`.
5. **16 Textus Receptus / KJV-Only NT Verses (`bsb_text === ""` and absent from NA28):**
   - Exact 16 coordinates: `Matt 17:21 (237950)`, `Matt 18:11 (238120)`, `Matt 23:14 (240060)`, `Mark 7:16 (245530)`, `Mark 9:44 (246560)`, `Mark 9:46 (246580)`, `Mark 11:26 (247400)`, `Mark 15:28 (249280)`, `Luke 17:36 (257610)`, `Luke 23:17 (260260)`, `John 5:4 (262890)`, `Acts 8:37 (272880)`, `Acts 15:34 (275510)`, `Acts 24:7 (278510)`, `Acts 28:29 (280030)`, `Rom 16:24 (284360)`.
   - Never drop silently and never force onto adjacent verses: emit `versification_status: 'edition_only_non_canonical'`, `start_verse_id: null`, `edition_only_ref: { edition: 'KJV', book, chapter, verse, source_verse_uid }`.

### 4.2 Deduplication & Target Span Collapsing
- Collapse consecutive verses within a `refs` inner group (same book & chapter, `cur.verse_start === prev.verse_end + 1`, non-heading) into a single `CanonicalPassageEndpoint` (`verse_range`). Keep discontiguous groups as `verse_cluster`.
- Deduplicate accidental duplicate target groups **within the same `(verse_id, sort)`** (e.g. `verse_id = 13070` in upstream QA report), retaining lowest `group_ordinal`.
- **Never** deduplicate across distinct `sort` anchors in the same verse (e.g. `verse_id = 380` where two distinct phrases in the same verse cite the same target passage).

### 4.3 Lexical Mapping Rules across All 14 Categories
| Category | Source / Input | Epistemic Tier | Guardrails |
| :--- | :--- | :--- | :--- |
| `same_lemma` | `word_form_lemmas` (`word_id ↔ lemma_id`) | `deterministic_computational` | `implies_synonymy: false`, `implies_common_etymology: true` |
| `same_documented_root` | `lemma_root_links` pairwise sibling join on shared `root_id` (`co_root_peer_join_v1`, untruncated symmetric emission; never broadcast one lemma's `etymology_type` onto sibling peers) | `deterministic_computational` | `implies_synonymy: false`, `implies_common_etymology: true` |
| `derivation` | `lemma_root_links` (`derived_from` → `base_root_anchor`), `TBESH`/`TBESG` `= a Name/Part/Combination of`, `lexical_formations` + `lemma_components` | `attested_lexical_fact` | `implies_synonymy: false`, `implies_common_etymology: true` |
| `cognate` | Same-family (`hbo` ↔ `arc`) `lemma_root_links` / `entity_relationships` (`aramaic_cognate_of`, `hebrew_cognate_of`), `TBESH` `= in Aramaic/Hebrew of` | `attested_lexical_fact` | Preserves `hbo` / `arc`; `implies_synonymy: false`, `implies_common_etymology: true` |
| `loan_transliteration` | Cross-family (`hbo`/`arc` ↔ `grc`) `entity_relationships` (`greek_transliteration_of`), `TBESG` `= the Greek of`, `TBESH` `= in Greek of` (e.g. `G2` `Ἀαρών` ← `H175` `אַהֲרֹן`, `G5` `Ἀββᾶ` ← `H2` `אַב`) | `attested_lexical_fact` | Preserves language codes; `implies_synonymy: false`, `implies_common_etymology: false` (never classify transliteration as `cognate` or `same_root`) |
| `morphological_relationship` | `lemma_root_links` (`form_of`, `spelling_variant_of`), multi-form `word_form_lemmas` paradigm | `attested_lexical_fact` / `deterministic_computational` | `implies_synonymy: false`, `implies_common_etymology: true` |
| `source_lexical_equivalence` | `entity_relationships` (`source_provided_lexical_equivalent`), `TBESG` `[in LXX chiefly for <Heb>]` (exact vocalized + POS-unambiguous match only; quarantine ambiguous homograph sets rather than slicing) | `attested_lexical_fact` | `implies_synonymy: false`, `implies_common_etymology: false` |
| `semantic_overlap` | `lexemes.unified_strongs` / `TBESH` & `TBESG` `= a Meaning of` sub-meaning siblings | `attested_lexical_fact` | `implies_synonymy: false`, `implies_common_etymology: false` |
| `synonymy` | **Only** explicit lexicon synonym blocks (`TBESG` Abbott-Smith `SYN.:`, matched via exact polytonic Greek or explicit Strong's citation—never bare NFD accent-stripped matching across distinct words like `ἄλλος`/`ἀλλός`) | `attested_lexical_fact` | `implies_synonymy: true`, `implies_common_etymology: false` |
| `antonymy` | **Only** explicit lexicon opposite markers (`TBESG` Abbott-Smith `opposite to` / `Opp. to`, matched via exact polytonic Greek or explicit Strong's citation) | `attested_lexical_fact` | `implies_synonymy: false`, `implies_common_etymology: false` |
| `related_translation` | Shared observed English renderings across distinct lemmas (`verse_translation_sources` / `words.english_translations`) | `statistical_association` | `implies_synonymy: false`, `implies_common_etymology: false` |
| `literary_wordplay` | `lexical_connections` (`relation_type = 'literary_wordplay'`) | `human_reviewed_interpretation` | `implies_synonymy: false`, `implies_common_etymology: false` |
| `orthographic_overlap` | `lexical_connections` (`relation_type = 'orthographic_overlap'`) | `deterministic_computational` | `implies_synonymy: false`, `implies_common_etymology: false` |
| `co_occurrence` | `words.co_occurrences` (`freq / (1 + avg_dist)`) | `statistical_association` | `implies_synonymy: false`, `implies_common_etymology: false` |

**Canonical ID & Lookup Invariants:**
- `buildLexicalRelationshipId`: When `direction === 'inverse'`, hash `(targetKey, subjectKey)` in canonical forward order so `A -> B` (`directed`) and `B <- A` (`inverse`) emit the **exact same `relationship_id`** for bidirectional note indexing.
- `key_by_lookup[base_strongs]`: Resolve deterministically via `pickPrimaryLemma` (`homograph_tag === 'G'` > lowest non-null `homograph_tag` > untagged) without map-iteration overwrites.

---

## 5. Exact Local Files and Interfaces

| File | Purpose |
| :--- | :--- |
| `src/api/relationship-types.ts` | Canonical TypeScript contracts (`CrossReferenceEdge`, `LexicalRelationshipEdge`, `RelationshipEpistemicTier`, `LexicalRelationshipCategory`, request/response packets, guardrails). |
| `src/api/relationship-model.ts` | Deterministic FNV-1a hashing, `buildCrossReferenceRelationshipId`, `buildLexicalRelationshipId`, `deduplicateCrossReferenceEdges`, `deduplicateLexicalEdges`, `validateLexicalEdgeIntegrity`, cursor pagination. |
| `src/api/relationship-notes-adapter.ts` | `buildNotePrefillFromCrossReference`, `buildNotePrefillFromLexicalEdge`, `extractRelationshipEvaluation`, `indexNotesByRelationshipId` (connects relationships to `public.notes` without auto-creating notes). |
| `src/api/relationships-rpc.ts` | `RelationshipsRPC` client gateway (`lookupCrossReferences`, `lookupLexicalRelationships`, note adapters). |
| `src/api/corpus-client.ts` | Registers `lookup_cross_references_v1` and `lookup_lexical_relationships_v1` in `CORPUS_RO_OPS`. |
| `src/api/rpc.ts` & `src/api/types.ts` | Exposes `BibleRPC.relationships` and re-exports relationship types. |
| `src/ui/components/NoteEditorModel.ts` & `NoteEditor.ts` | Preserves `source_context`, supports `prefill` context, and renders accessible **Agree / Disagree / Alternative interpretation** stance bar. |
| `src/ui/components/PassageCrossReferences.ts` | Collapsible passage cross-reference disclosure (`Outgoing` + `Referenced by`, phrase provenance, stance note actions). |
| `src/ui/components/LexicalRelationshipsSection.ts` | Collapsible word-inspector lexical relationship graph disclosure with tier/language/category badges and stance note actions. |
| `scripts/corpus-relationships-rpc.mjs` & `scripts/corpus-worker.mjs` | Cloudflare Worker RPC handlers for `/v1/rpc/lookup_cross_references_v1` and `/v1/rpc/lookup_lexical_relationships_v1`. |
| `scripts/build-relationship-slice.mjs` & `scripts/fixtures/crossreferences-org-slice.json` | Offline deterministic vertical-slice shard builder writing `.artifacts/static-corpus/v1/relationships/*.json.gz`. |
| `scripts/verify-relationship-foundation.mjs` | 63-assertion local end-to-end verification suite across model, Worker, versification, lexical taxonomy, and UI/notes integration. |

---

## 6. Required Verification Commands

Run in Windows PowerShell (`npm.cmd` and `node`; **never** rewrite files with PowerShell `Set-Content` or `Out-File`):

```powershell
# 1. Build static vertical slice shards
node scripts/build-relationship-slice.mjs

# 2. Verify file/section size limits (<= 450 lines/file, <= 80 lines/@section, exact @toc)
npm.cmd run check:size

# 3. Verify TypeScript types & production bundle
npm.cmd run check:types
npm.cmd run build

# 4. Run static security/DOM guard (no innerHTML in notes/relationship UI, no direct supabase imports)
node scripts/notes-guard.mjs --static

# 5. Run NoteEditor regression suite (73 assertions) and XREF-LEX-01 suite (63 assertions)
node scripts/verify-notes-editor.mjs
node scripts/verify-relationship-foundation.mjs
```

---

## 7. Remaining Implementation Steps (For Flash)

Execute one atomic task at a time and record progress in `TASKS.md`:

1. **`XREF-LEX-02` — Full CrossReferences.org Bulk Shard Exporter (`--mode=full`):**
   - Download pinned `bible_books.json`, `bible_verses.json`, and `cross_references.json` (`671bbf73b1e5155e31b209442dc5be3f5b3c1a41`) into git-ignored `.artifacts/sources/crossreferences-org/`, stripping `s21` immediately upon download.
   - Extend `scripts/build-relationship-slice.mjs` (or add `scripts/build-relationships-full.mjs` sharing helpers) so `--mode=full` processes all 31,217 `bible_verses` rows and all `cross_references` rows into the 66 `xrefs-b01.json.gz .. xrefs-b66.json.gz` shards with `coverage: 'full'`.
   - Verify total canonical mapped verses = `31,203` (including `63` exact Psalm `v.0` rows + `53` combined Psalm `v.0/v.1` rows) and `edition_only_verses` = `17` (`16` TR-only NT rows + `2 Cor 13:14`).
2. **`XREF-LEX-03` — Full Lexical Graph Shard Exporter (`--mode=full`):**
   - Run the lexical builder across **all `22,171` canonical `lemmas`** (removing the `TARGET_BASES` filter) into the 64 `lexical-00.json.gz .. lexical-3f.json.gz` shards (`~346` lemmas/shard).
   - For `related_translation`, compute bounded top-$K$ (`K <= 15`, minimum shared count $\ge 3$, excluding stop-glosses like `"the"`, `"of"`, `"and"`, `"to"`, `"in"`) from `.artifacts/static-corpus/v1/chapters/` or `words-*.json.gz` so noisy function-word overlap never pollutes lexical results.
   - Update `.artifacts/static-corpus/manifest.json` (`scripts/build-static-corpus.mjs`) to include SHA-256 digests of `/v1/relationships/*.json.gz`.
3. **`XREF-LEX-04` — Public `bible-mcp` & OpenAPI 3.1.0 Read-Tool Exposure:**
   - Register read-only tools `lookup_cross_references` and `lookup_lexical_relationships` in `supabase/functions/bible-mcp/catalog.ts` & `index.ts` forwarding to `bibleresearch-corpus` `/v1/rpc/lookup_cross_references_v1` and `/v1/rpc/lookup_lexical_relationships_v1`, plus sync `supabase/openapi.json` and `skills/bible-research/references/tool-contracts.md`.
4. **`XREF-LEX-05` — Staged Cloudflare Corpus Publish (After `CORP-04` Coordination):**
   - Run full offline verification first; then publish `bibleresearch-corpus` via Wrangler (`npx.cmd wrangler deploy --config wrangler.corpus.jsonc`) **only** when all local verifiers pass and `CORP-04` status permits deployment.

---

## 8. Required Tests and Expected Outputs

Before marking bulk import complete, Flash must verify and log:
1. `node scripts/check-size.mjs` → `PASS: check:size verified successfully.`
2. `npm.cmd run check:types` → exit code `0` (`0` errors).
3. `node scripts/notes-guard.mjs --static` → `PASS: Static checks passed`.
4. `node scripts/verify-notes-editor.mjs` → `NOTE-25 Tests: 73 passed, 0 failed`.
5. `node scripts/verify-relationship-foundation.mjs` → `XREF-LEX-01 Verification: 63 passed, 0 failed`.
6. **Bulk-Import Invariants (`XREF-LEX-02` & `XREF-LEX-03`):**
   - Every `/v1/relationships/*.json.gz` shard is `< 5 MiB` compressed (Cloudflare limit: `25 MiB`).
   - Total static asset file count in `.artifacts/static-corpus/` remains `< 2,500` (Cloudflare limit: `20,000`).
   - `grep` / scan across all `/v1/relationships/*.json.gz` confirms **0 occurrences** of French `s21` text and **0 occurrences** of restricted `TBESH` col 7 (`Online Bible`) text.
   - Every `LexicalRelationshipEdge` in all 64 shards passes `validateLexicalEdgeIntegrity(edge) === null`.
   - `SELECT count(*) FROM public.notes WHERE source_context ? 'test_run'` in Supabase remains `0` (zero stray test rows, zero auto-created notes).

---

## 9. Licensing Requirements

1. **CrossReferences.org (`CC BY 4.0`):**
   - Attribute `"CrossReferences.org (https://github.com/CrossReferences-org/bible-cross-references), licensed under CC BY 4.0"` in API `dataset_attribution` and documentation (`DATA_SOURCES.md`).
   - **Mandatory Exclusion (`s21`):** Upstream `README.md` states French `Segond 21` (`s21`) anchor fragments are `© Société Biblique de Genève, used with permission` (not public domain). Strip `s21` during ingestion; retain only `bsb` and `kjv` English anchor phrases (Public Domain / CC0).
2. **STEP Bible (`TBESH.txt`, `TBESG.txt`, `TAHOT`, `TAGNT` — `CC BY 4.0`):**
   - Attribute `"STEP Bible (www.STEPBible.org), Tyndale House Cambridge, CC BY 4.0"` (and Abbott-Smith *Manual Greek Lexicon of the New Testament* for `TBESG` col 7).
   - **Mandatory Exclusion (`TBESH` col 7):** Column 7 (`Meaning`) of `TBESH.txt` derives from *Online Bible* under restricted permission. Always `.split('\t').slice(0, 7)` when reading `TBESH.txt`.
3. **Clear-Bible MACULA Hebrew (`macula-hebrew.greekstrong` License Gate):**
   - Per `public.field_license_registry` (`supabase/migrations/20261105230000_canonical_lexical_and_evidence_schema.sql`), `macula-hebrew.greekstrong` is gated (`export_allowed = false`) pending upstream license verification. Do **not** export `macula-hebrew.greekstrong` into public static shards; derive cross-language equivalences only from CC BY 4.0 `TBESG` (`Abbott-Smith`) and Swete LXX alignments (`hebrew_lxx_word_alignments`).
