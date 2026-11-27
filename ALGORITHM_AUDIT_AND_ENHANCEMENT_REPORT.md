# BibleResearch — Complete Algorithm Architecture, Unused Potential, & Enhancement Report

> **Workspace Authority:** `C:\Projects\BibleResearch-r10` (`feat/r12-qa-fixes`, Iteration 4 complete)  
> **Scope:** Exact runtime & offline architecture across `src/relationships/`, `scripts/`, `supabase/functions/bible-mcp/`, and `src/ui/`, plus Iteration 4 direct improvements, tailored online-research prompt (**ChatGPT**), and specialized algorithmic delegation prompt (**Gemini Carbon**).

---

## 1. How the Algorithm Currently Works

BibleResearch splits biblical research across **three cleanly separated execution planes**:
1. **Offline Graph & Index Compilers (`scripts/` & `research/r12/`):** Precompute immutable JSON/binary shards stored under `.artifacts-r12/staging-bundle/v2/` and `.artifacts/v2/literary/` (served via Cloudflare Static Assets, adhering to Free Tier limits: `<= 20,000` files, `< 25 MiB` max file size, zero runtime SQL on static corpus evidence).
2. **Cloudflare Corpus Worker (`scripts/corpus-worker.mjs` + `scripts/corpus-relationships-rpc.mjs`):** Runs stateless, CPU-bounded (`<= 10 ms` Free Tier target) discovery, subgraph Steiner search, pattern mining/comparison, literary analysis, and Swete LXX lookup via RPCs (`/v1/rpc/*`).
3. **Supabase Edge Function MCP Server (`supabase/functions/bible-mcp/`) & Website UI (`src/ui/`):** Orchestrates the **7-tool AI research interface** (`get_Passage`, `get_Word`, `get_Connection`, `follow_connectionchain`, `research`, `write_Note`, `get_prompt`), merges mutable Supabase notes/chains/geography with Cloudflare corpus RPCs, and renders interactive browser views.

### 1.1 Data & Knowledge Resources Used (and How)

| Resource / Dataset | Storage & Runtime Layer | How It Is Used |
|---|---|---|
| **STEPBible Hebrew/Greek Token & Lexicon Tables (`31,203` canonical verses incl. `116` Psalm `verse 0`, `19,566` `lemma-profiles`)** | Sharded into `488` `fast-verses/chunk-*.json.gz` (`r10-b64gz-1`) and `64` `fast-profiles/shard-*.json.gz` (`pack-r12-cpu-safe-assets.mjs`) | Powers token-level original script, `word_id` alignment, `lemma_key` homograph disambiguation, `all_vids` intersections, and `resolve_fast_lookup_v1` inverted key lookup (`lemma-lookup/`). |
| **MACULA Hebrew (WLC) & Greek (Nestle1904/SBLGNT) Syntax (`r8-v1.2`)** | `150,522` clause frames, `124,312` occurrence relations, `61,752` summaries (`chapter-lite/` + `frames` in `fast-verses`) | Provides typed syntactic dependencies (`grammatical_subject_of`, `grammatical_object_of`, `possessive_construction_with`, etc.), `compareStructuredRoleFrames` in `compare_patterns_v1`, and R8 clause role parallels (`structural-candidates.mjs`). |
| **Swete Septuagint (`b1.json.gz`–`b52.json.gz`) & CATSS/LXX Word Bridges** | `/v1/lxx/b*.json.gz`, `hebrew_lxx_verse_map`, `lxx_relations` inside `lemma-profiles`, and inline `lxx_verses` in `.artifacts/v2/literary/pack-*.bin` | Powers `lxx` (passage/compare/alignments/translations), cross-testament bipartite matching (`Algorithm D`), `compare_patterns_v1` / `get_Connection` LXX bridges, and `literary_structure(compare_lxx: true)`. |
| **CrossReferences.org (`305,628` links; excl. restricted `s21`)** | Top-20 bidirectional `xrefs` embedded per verse across `30,022` verses inside `fast-verses` | Treated strictly as Tier 4 `editorial_cross_reference` (`r11:xref:`); boosted only when corroborated by shared content lemmas or LXX bridges. |
| **OpenEnglishWordNet 2025 + Wikidata (`r12-external-pilot.json`)** | `64` external mappings (`wikidata_concepts`, `oewn_concepts`) and `384` `property_assertions` (`231` Wikidata `P*`, `134` OEWN, `19` derived physical) indexed over `61` unique anchors into `r12-pilot.json.gz` / `pilot_bridges` | Powers `r12:prop:` `EXTERNAL_WORLD` bridges (`realworld` mode / `mode: "bridge"`), explicitly tagged with `independent_biblical_support = 0`. |
| **Theographic Bible Data, OpenBible Ancient Places & Pleiades** | Supabase (`places`, `place_locations`, `verse_geography`, `chronology_assertions`), plus static `/data/bible-places-index.json` and `context-atlas.ts` | Powers `get_Passage.geography`, `geography_search`, `genealogy`, `table_of_nations`, `feasts_calendar`, and `sacred_architecture` (5 plans incl. `ezekiel_temple`). |
| **Literary Packs (`.artifacts/v2/literary/index.json` + `pack-00..63.bin`)** | 64 binary packs copied into `dist/v2/literary/` | Feeds `literary-engine.ts` identically in browser, Worker, and MCP without reopening chapter shards. |

### 1.2 Discovery & Graph Algorithms + Exact Scoring / Weighting Formulas

1. **Stage-1 Query Parsing & Concept Resolution (`src/relationships/r10-discovery.ts` & `scripts/corpus-relationships-rpc.mjs`):**
   - Resolves Strong's IDs (including suffixed homographs `H4417M`, `H1350A`), Hebrew/Greek script (NFKD + final-sigma normalization + Begadkefat transliteration variants), English tokens/bigrams/trigrams, number phrases (`normalizeNumberPhrases`), and modern synonyms (`QUERY_FALLBACK_ALIAS_MAP`).
   - Enforces sense verification (`verifyTermSenseInVerse`) so homographs do not cross-pollinate multi-concept intersections.
2. **Candidate Generation & R11–R13 Tier Scoring (`r10-discovery.ts`):**
   - Base tier table `TIER_BASE_SCORE` (`src/relationships/r10-discovery.ts:72`):
     - Tier 1 (`explicit_identification` / `direct_quotation` / `typological_interpretation`): **950**
     - Tier 2 (`explicit_comparison` / `documented_root_family`): **860**
     - Tier 3 (`verified_lexical_grammatical` / `cross_language_bridge`): **760**
     - Tier 4 (`cross_reference_witness` / `DIRECT_ENDPOINT_WITNESS`): **650**
     - Tier 5 (`multihop_proof_path` / `shared_external_property` / `motif`): **520**
     - Tier 6 (`structural_scene_parallel` / `orthographic_overlap`): **380**
     - Tier 7: **240**, Tier 8: **140**.
   - **7-Factor R13 Rescoring & Reciprocal Rank Fusion (`scoreCandidatesR13`, `src/relationships/r10-discovery.ts:1328–1421`):**
     Computes normalized `[0..1]` factors:
     - `E = clamp(1.05 - 0.11 * tier, 0.05, 1)` (Epistemic tier reliability)
     - `F` (`0.92` explicit/attested wordplay/structural, `0.85` cross-testament/symbolic chain/root, `0.78` motif/colloc/LXX, `0.52` shared consonantal, `0.55` default)
     - `P = clamp(0.35 + specificity_bonus / 350, 0.05, 1)`
     - `I = min(1, 0.2 + indCount * 0.25 + witness_bonus / 140)` (Independent corroboration)
     - `R` (`0.96` all_concepts, `0.74` meaningful_subset, `0.82` passage_intertext background, `0.48` other background)
     - `N = E >= 0.45 ? baseNovelty * (0.4 + 0.6 * E) : 0` (Novelty; capped at `0.25` for `proximate_wordplay_candidate`)
     - `U = min(1, (common_word_penalty + number_coincidence_penalty + orthographic_penalty) / 320)`
     Ranks all candidates along 3 axes: `eKey = 0.55*E + 0.45*F`, `pKey = 0.50*P + 0.30*I + 0.20*N`, `rKey = 0.70*R + 0.30*((E+I)/2)`, computes normalized 3-axis RRF (`k = 60`), and updates:
     $$\text{final\_score} = \max\big(10,\ \text{base\_final} + \text{round}(20\cdot I + 18\cdot N_{\text{eff}} + 15\cdot \text{rrf} - 35\cdot U)\big)$$
     Along with dual user-facing metrics:
     - `evidence_strength = clamp(0.45*E + 0.25*F + 0.15*P + 0.15*I - 0.25*U)`
     - `exploration_value = clamp(0.45*R + 0.35*N_eff + 0.20*rrf)`
   - **Diversification (`diversifyResultsR13`, lines 1423–1527):** Applies family bucket quotas (e.g. max 1–2 `wordplay`, 2–5 `xref_cross`) + greedy Jaccard passage-overlap MMR (`-28 * maxSim` and per-excess-item family penalty) within each query support stratum (`all_concepts`, `meaningful_subset`, `background`).
3. **R9c / R12 Multi-Hop Path Ranker (`src/relationships/path-ranker.ts`, `r12-ranker-v2`):**
   - Runtime multi-hop (`discover_relationship_paths_v1`, `maxHops <= 3`) computes additive factor scores (`evidence_strength + directness_bonus + passage_support + distinctiveness + provenance_quality + same_frame_bonus - hop_penalty - uncertainty_penalty - hub_penalty`), while `scoreR12Path` + `rankR12DiscoveryDestinations` compute the multiplicative coherence score used by `build-r12-pilot.mjs`:
     $$\text{interest} = \text{clamp}_{[0,1]}\big(K \cdot (0.45\,Q + 0.25\,C + 0.15\,D + 0.15\,T) - \text{hub\_penalty}\big)$$
     where `Q` is the length-decayed (`0.90^(hops-2)`) geometric mean of step quality weights, `C = min(1, log2(1 + endpointSupportGroups) / 3)` (strictly excluding `EXTERNAL_WORLD` assertions!), `D` is normalized feature IDF, `T = min(1, distinct_relation_types / 4)`, and `K ∈ [0.04, 1.0]` penalizes chapter/book jumps (`0.86` chapter, `0.65` same book, `0.28` cross-book), generic hubs (`degree >= 25 && !proper`), role reversals (`0.75`), and unwitnessed LXX steps (`0.50`), pruning paths with `K < 0.25 && endpoint_support_group_count === 0`. Final top-N selection uses MMR (`interest - 0.35 * maxOverlap`).
4. **Steiner Subgraph Engine (`src/relationships/subgraph-engine.ts`):**
   - Used by `discover_subgraph_v1` (live in `get_Connection` & UI `DiscoveryGraph.ts`). Connects `2–6` anchors using bounded multi-layer BFS (`<= 3` hops), rejects generic hubs (`total_verses > 450`), runs Kou–Markowsky–Berman metric-closure MST / Steiner tree assembly, closes triangles/cycles, and tracks `all_endpoints_connected` via BFS.
5. **Wordplay Engine (`Algorithm A`, `src/relationships/wordplay-engine.ts`):**
   - Normalizes Hebrew/Greek into four forms: `consonantal` (final forms mapped to medial), `skeletonNoMatres` (collapses medial `ו/י` and trailing weak `ה`), `strippedAffixStem`, and `phoneticClass` (6 guttural/sibilant/velar/dental/labial/liquid groups). Computes IDF-weighted n-gram overlap, longest common substring, consonantal metathesis, and phonetic-weighted Levenshtein distance (`0.45` same phonetic class, `1.0` otherwise).
   - Scans same-verse and `±1` adjacent verses (`buildCorpusWordplayIndex`) looking for explicit biblical cues (`prophetic_vision_qa` e.g. `H4100+H7200`, `naming_etiological_formula`, `creation_formation_cue`, `greek_interpretation_formula`, `G0499`/`G1510`). Strictly classifies edges into `attested_textual_wordplay` (direct textual evidence), `proximate_wordplay_candidate` (candidate), `documented_root_family`/`morphological_derivation`, or `shared_consonantal_pattern`/`phonetic_similarity` (`orthographic_similarity_only`).
6. **Literary Structure Engine (`src/relationships/literary-engine.ts` + `literary-structure.mjs`):**
   - **Segmentation:** Combines DP syntactic novelty boundary detection (`detectNoveltyBoundaries`) with MDL-scored template induction (`induceTemplate`) to segment chapters into recurring pericope/verse templates and isolate intentional deviations (`slot_omission`, `reordering`, `person_shift`, `polarity_flip`, etc. with surprisal bits).
   - **Symmetry (`discoverChiasms`):** Evaluates lemma/role cosine & Jaccard similarity across window pairs to distinguish `chiasm`/`concentric`/`inclusio` (`reverseMean`) from `forward_parallelism`/`progressive_parallelism` (`forwardMean`).
   - **Acrostics:** Checks 22-letter `א..ת` sequence in verse-initial, half-verse atnach, and 2-/8-verse stanza modes (Ps 111, Prov 31, Ps 119).
   - **Wordplay & LXX (`compareMtAndLxx`):** Applies strict cognate vs. weak-overlap guards (`discoverWordplays`) and compares MT verses against Swete LXX token counts, evaluation formulas, and notable lexical/theological shifts (upgraded in Iteration 4 to detect `H7160 קרן → δοξάζω`, `H6780 צמח → Ἀνατολή`, `H1350 גאל → λυτρόω/ἀγχιστεύς`).
7. **Patterns, Motifs & Cross-Testament Bipartite Scoring (`motif-discovery.ts`, `symbolic-patterns.ts`, `evidence-synthesis.ts`, `tesserae-retrieval.ts`):**
   - **Algorithm B (`motif-discovery.ts`):** Mines corpus-wide `NPMI` collocations (`maxDf = 2500`, `npmi >= 0.08`) and offline `triangle`/`chain` motifs scored by `meanWeight * modalityBonus * convergenceBonus / log2(4 + maxDf*0.03)`, plus runtime `beamSearchMotifPaths` (`maxHops = 3`, `beamWidth = 10`).
   - **Algorithm C (`symbolic-patterns.ts`):** Extracts `826` self-interpretation statements (Greek copula `G3739/G3778 + G1510`, `G0499` antitype, Hebrew vision Q&A, demonstrative identification, compound/birth-attribute naming etiologies) while keeping clause-local symbol and referent strictly unmerged, plus MACULA R8 role-frame scene comparison (`compareStructuredRoleFrames`).
   - **Algorithms D & E (`evidence-synthesis.ts`):** Greedy bipartite IDF matching between OT and NT tokens via LXX equivalence (`scoreCrossTestamentPair`, base scores `920/820/760/660 + min(180, idf*18)`) and connected-component synthesis (`synthesizeEvidencePatterns`) for `discover_patterns_v1`.
   - **Tesserae V6 + Multi-Channel RRF (`tesserae-retrieval.ts`):** `fuseMultichannelCandidatesRrf` is used by `r10-discovery.ts`; `scoreTesseraeParallel` (`ln(freq_sum / dist^0.35)`) was wired in Iteration 4 into `compare_patterns_v1` (`scripts/corpus-relationships-rpc.mjs`).
8. **Real-World Concept Connections (`property-bridges.mjs` + `r12-external-pilot.json` + `word-model.ts`):**
   - Offline `build-r12-pilot.mjs` loads `r12-external-pilot.json` (`64` mappings across `61` Strong's anchors; `384` assertions from Wikidata `wd:P*` GUIDs and OEWN 2025), builds an inverted property posting index by `sense_id`, suppresses dense properties (`df > 5%` / `4000`), and computes `rarity = min(6, 1 + log((N+1)/(df+1)))` and `score = min(1, weighted/weightLimit) * min(1, 0.5 + 0.2*keys.size)`, tagging `external_concept_equivalence` vs. `shared_external_property`.
   - At runtime, `r10-discovery.ts` converts `r12:prop:` records into Tier 5 `external_world_bridge` cards (`C = 0`, `independent_biblical_support = 0`), and `word-model.ts` merges DB `physical_def` with `pilot_bridges`.

---

## 2. Unused Potential, Duplications & Redundant Code Audit

Measured across `src/`, `scripts/`, and `supabase/functions/bible-mcp/` (automated recursive import scan + manual inspection):

### 2.1 Unused / Underused Algorithmic & Dataset Potential

1. **Microscopic External Ontology Coverage (`61 / 19,566` lemmas = `0.31%`):**
   - `scripts/fixtures/r12-external-pilot.json` holds only `64` sense mappings and `384` assertions (`research/r12/data-sources.json` catalogs 11 rich ontologies—**ENVO**, **ChEBI**, **Uberon**, **PATO**, **Pleiades**, **ConceptNet**, **Wiktionary**, **BHSA**, **Sefaria**, plus full **OEWN 2025** and **Wikidata**—almost all marked exploratory/unbuilt!). As a result, physical objects like light (`H0216`), lamp (`H5216`/`G3088`), wine, fire, olive, rock, water, eye-anatomy vs. spring-hydrology have zero or sparse physical properties.
2. **Pre-Baked R12 Pilot Ceiling (`250 / 19,566` anchors = `1.28%`):**
   - `build-r12-pilot.mjs` compiles offline multi-hop paths and structural candidates for only `250` anchors (`48` core + `202` auto). Outside those 250 lemmas, multi-hop relies on runtime `discoverMultiHopPaths` or `beamSearchMotifPaths` (`max 10` paths, `<= 45` shard budget).
3. **`scoreTesseraeParallel` (`src/relationships/tesserae-retrieval.ts`, 9.5 KB) — *Activated in Iteration 4*:**
   - Before Iteration 4, `scoreTesseraeParallel` had **0 external callers** across the entire codebase (`1` hit total, inside its own file). It is now wired into `compare_patterns_v1` in `scripts/corpus-relationships-rpc.mjs` and surfaced in `PatternBoard.ts` and `PassageComparison.ts`.
4. **Unused UI Discovery Components & RPC Wrappers:**
   - **Dead / Orphaned Components (`0` active app imports):**
     - `src/ui/components/PassageDiscoveryStrip.ts` (`21.9 KB`, `0` imports anywhere in `src/`)
     - Legacy/superseded `RelationshipExplorer.ts` (`6.6 KB`, only inside collapsible `ResearchPanel.ts`) and `ExploreConnectionsPanel.ts` (`16.8 KB`, inside `LexicalRelationshipsSection.ts`) coexist alongside `DiscoverConnections.ts` (`65.9 KB`), `DiscoveryGraph.ts` (`86.0 KB`), and `PatternBoard.ts` (`40.6 KB`).
   - **Frontend RPC wrappers unused until Iteration 4:** `comparePatternsRpc` and `traceEvidenceRpc` in `src/api/r10-rpc.ts` had **0 UI callers** before Iteration 4 (`discoverPatternsRpc` in `src/api/r10-rpc.ts` still has 0 UI callers).

### 2.2 Duplications & Legacy/Redundant Code

| Area | Duplicated / Redundant Modules | Details & Impact |
|---|---|---|
| **Hebrew Literary Prototypes** | `src/relationships/literary-hebrew.mjs` (`10.5 KB`, `0` prod callers) & `src/relationships/literary-hebrew-alignment.mjs` (`4.7 KB`, `0` callers) | Legacy split prototype superseded by unified `literary-engine.ts` (`155 KB`) + `literary-structure.mjs` (`32.7 KB`). Note `supabase/functions/bible-mcp/literary/` duplicates `literary-engine.ts` by design for Deno deployment (synced via `build-research-plugin.mjs`). |
| **MCP Dual Surface & Legacy Modules** | `supabase/functions/bible-mcp/catalog.ts` (`45.6 KB`), `relationships-v2.ts` (`37.4 KB`), `research-lenses.ts` (`9.2 KB`), `verse-hydrated.ts` (`10.0 KB`), `syntax-research.ts` (`8.2 KB`), `staging.ts` (`5.0 KB`), `pattern-prompts.ts` (`6.3 KB`) | Preserved for `/legacy/mcp` (`46` tools, `22` prompts) and V1 parity checks (`v2` runs cleanly on `discovery-v2-tools.ts`, `research-engine.ts`, `word-model.ts`, `context-atlas.ts`, `bible-ref.ts`). Zero runtime overhead on `/mcp`, though maintenance burden is doubled when shared types/RPCs evolve. |
| **Book Alias Tables Triplicated in UI & Backend** | `CANONICAL_BOOK_ALIASES` in `src/relationships/path-ranker.ts`, `BOOK_ALIASES` in `src/ui/components/PassageComparison.ts`, `BOOK_ALIASES` in `src/ui/components/PatternBoard.ts`, `BOOK_ABBREV_MAP` in `src/ui/context-tools/ContextToolDialog.ts`, plus `supabase/functions/bible-mcp/bible-ref.ts` | At least **5 separate copies** of 66-book alias dictionaries and passage parsers exist across UI and backend. (`parseAnchorPassage` in `src/ui/utils.ts` should be the single frontend parser.) |
| **Consonantal / Function-Word Helpers Duplicated** | `stripHebrewConsonants` in `wordplay-engine.ts` vs. `hebrewConsonants` / `hebrewNoMatresStem` in `symbolic-patterns.ts` vs. `stripHebrew` in `literary-engine.ts`; `PRONOUN_OR_FUNC_STRONGS` / `SKIP_CONTENT_STRONGS` / `STOP_HUB_STRONGS` / `FUNCTION_STRONGS` across `r10-discovery.ts`, `symbolic-patterns.ts`, `motif-discovery.ts`, `tesserae-retrieval.ts`, `word-model.ts`, `literary-engine.ts` | Slight divergence caused real bugs (e.g., `H9033`/`H9036` clitic leaks fixed in Iteration 3 because 5 regexes existed across files). |
| **Offline Proof-Ranker Shim** | `research/r12/proof-ranker.mjs` (`1 KB`) | Wrapper kept solely for historical R12 tests; delegates to `src/relationships/path-ranker.ts`. |
| **Context Tools vs. Atlas Overlap** | `src/ui/context-tools/sacred-architecture.ts` (`2,373` lines) vs. `supabase/functions/bible-mcp/context-atlas.ts` | Sacred architecture plans exist independently in UI SVG definitions and MCP atlas data (in Iteration 4 `ezekiel_temple` was added to MCP `context-atlas.ts`, leaving UI SVG rendering of Ezekiel's Temple as future work). |

---

## 3. Where the Algorithm Still Struggles & Missing Tools

Grounded in Iteration 1–3 Blind Sessions (**R1–R7**) and Frozen Held-Out Tasks (**H1–H3**):

1. **Swete LXX Word-Level & Morphological Index Gaps:**
   - Swete source shards contain occasional OCR/token clipping (`Lev 17:11` `"ἑ"`, `"λάσεται"`, `Deut 32:43`, `Job 33:4` `"αντοκράτορος"`).
   - `lxx_relations` in `lemma-profiles` is asymmetric/incomplete on rare verbs & NT nouns (`G1841` `ἔξοδος`, `H7160` `קָרַן`), and lacks lemma-lemmatized Swete full-text search across the Septuagint independent of MT alignment (e.g., finding every LXX occurrence of `ἀνατολή`, `δόξα`, `ἐγκαίνια`, or compound verbs like `μετεκάλεσα` in `Hos 11:1`).
   - `word.lxx` counts (merged Swete + CATSS) still diverge from `r11:lxx:` connection counts (`H216`: `94` vs `63`; `H3519`: `168` vs `113`).
2. **Static Real-World / Physical Property Sparse Graph:**
   - Only `61` Strong's lemmas have OEWN/Wikidata mappings (`0.31%` coverage). Light (`H0216`), eye (`H5869`), lamp (`H5216`/`G3088`), seal, salt, fire, wind, seed lack structured sensory/material properties (opacity, refraction, combustion, salinity, botanical lifecycle) grounded in real lexical/encyclopedic sources.
3. **Full-Chapter Payload Size & Cloudflare 10 ms CPU Ceiling:**
   - Without `compact: true`, full `get_Passage` packets remain heavy (`100–240 KB`), and runtime multi-hop/pattern mining is tightly capped by Cloudflare Free Tier's `10 ms` CPU wall, forcing narrow Top-K truncations (`max 24` profiles, `max 3` hops, `<= 32` verses in `compare_patterns`).
4. **Prophetic / Apocalyptic Symbolic & Temple Spatial Models:**
   - While Iteration 4 added `ezekiel_temple` to `context-atlas.ts`, cross-book typological geometry (matching architectural transitions across Exodus 25–40 -> 1 Kings 6–8 -> Ezekiel 40–48 -> Revelation 11 & 21–22 by structural zone/ratio) does not yet exist as a structured queryable graph.
5. **Missing Tools on `/mcp`:**
   - **`lxx_Concordance` / Swete Greek Morphological Search:** Search the Septuagint directly by Greek lemma/root (not just via Hebrew pivot or individual verse lookup) to spot NT authors quoting distinctly LXX wording (like `Heb 8:9` `ἠμέλησα` for `Jer 31:32`).
   - **`clause_Role_Query` (Syntactic Argument Explorer):** Direct query of MACULA frames by `(predicate, agent/patient/instrument/location)` across the corpus (e.g., "every clause where `ruach` is Agent vs. Instrument", or "every object of `qaran`/`galah`"), instead of only aggregated lemma counts.
   - **`semantic_Domain_Lookup` (Louw-Nida / BDB Semantic Domains):** Group and traverse synonyms/antonyms within a semantic domain without conflating senses or relying on English gloss string matching.
   - **`intertextual_Matrix` (Multi-Passage Structural & Lexical Diff Matrix):** Aligned token-by-token parallel synopsis across MT, Swete LXX, and NT quotations (highlighting insertions, omissions, and word-order swaps cleanly).