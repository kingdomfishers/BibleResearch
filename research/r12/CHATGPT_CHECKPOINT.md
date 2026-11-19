# R12 Live Production Deployment & Verification — 2026-11-19 (`r12-discovery-2`)

## FOR CHATGPT — READY FOR INDEPENDENT `r12-discovery-2` / `r12-ranker-v2` EVALUATION (2026-11-19)

**Algorithm & provenance fixes deployed live.** Based on the complete 239-case audit in [R12_BENCHMARK_DIAGNOSIS.md](R12_BENCHMARK_DIAGNOSIS.md) and [CHATGPT_INDEPENDENT_DISCOVERY_AUDIT_2026-11-18.md](CHATGPT_INDEPENDENT_DISCOVERY_AUDIT_2026-11-18.md), `r12-discovery-2` / `r12-ranker-v2` is now live:

1. **Corpus Worker (`bibleresearch-corpus`):** Version ID `cce819e9-60d4-4e17-bb01-ed138af9a9a3` (`https://bibleresearch-corpus.kingdomfishers-custom.workers.dev`; `R12_RELEASE_ID: r12-discovery-2`, `R12_ASSET_SHA256: 7a08727be4d841e4aded1f0aeb5300c9d79e32769d30ba1968726d413f630a11`, `R12_SOURCE_COMMIT: d9940058651c83befa168a2f31e60fca0c691414`, `/__integrity/b7` HTTP `200` `PASS_CANARIES`, `/v1/catalog/metadata.json.gz` HTTP `403`). Rollback: `cf2182ed-b3fc-4ab6-99ab-5590e7e8a075`.
2. **Main MCP (`bible-mcp`):** **Version `44`** (`ACTIVE`, `verify_jwt: false`, `version: "1.8.0"`, `tools: 46`, `prompts: 22`, `writes: "enabled"`, `ezbr_sha256: 7560b097c4e5fc3fbfe94bf557f036e58a5ddbf6b8cc278c075731105adfac71` at `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`). Rollback: **Version `43`**.
3. **Website (`bibleresearch`):** Version ID `3d9482f4-7309-4fe5-babf-140041f5b42a` (`https://bibleresearch.kingdomfishers-custom.workers.dev`, HTTP `200`). Rollback: `d147114c-6a5c-4927-80ed-2a48877c2af4`.
4. **Summary of Changes & Full Re-Test Checklist:** See [R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md](R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md). Key verified improvements (via local regression suites and bounded live serial MCP probes; full 239-case re-run preserved for ChatGPT):
   - Path coherence `K` (`r12-ranker-v2`), endpoint-only `C`, pruned incoherent chains (`N001–N004`), honest multi-hop epistemic classes (`DIRECT_ENDPOINT_WITNESS` `2 Peter 1:19` for `G3088 → G5459`).
   - Cleaned Wikidata/OEWN external provenance (`384` assertions, `0` synthetic predicates), sense-keyed bridges (`H5869_eye` vs. `H5869_spring`), `minDistinctFamilies: 2` structural scenes (`717` scenes), and distinct-root co-occurring `r12:orth` (`1,994` pairs, `H0120↔H1818` live).
   - Embedded bidirectional xrefs (`30,022` verses, `392,281` links) and chronological events (`6,423` verses) in existing `fast-verses` chunks + single-token typology hijack guard (`Exodus 12:15`, `Hosea 6:2`, `Genesis 1:1`).
   - `22` modern English synonym/phrase keys (`+102` entries; `"yeast"` -> `status: "ok"`), compound-magnitude numeral guard (`N009` Gen 5:23 eliminated), `mode: "bridge"` boost, mechanism diversification, and `48 → 250` anchor expansion.

> **Action for ChatGPT:** Refresh the `@BibleResearch` MCP connector schema (`version: 1.8.0`), verify `verification_release.corpus_release === "r12-discovery-2"`, and run the independent 239-case benchmark serially using [R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md](R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md).

---

## FOR CHATGPT — HISTORICAL BASELINE VERIFICATION (`r12-discovery-1`, 2026-11-19)

*(Preserved prior checkpoint for comparison against `r12-discovery-2`.)*

**Infrastructure incident status: FIXED in full serial benchmark, not merely in smoke tests.** Frozen benchmark `research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json` was rerun through the connected production `@BibleResearch` MCP `discover_biblical_connections_v2` with exact case arguments. 239 cases (215 positive / 24 negative), 222 actual MCP network calls (190 different argument payloads); **238 `ok`, 1 `no_match` (“yeast” resolver coverage), 0 HTTP 503 / timeouts / transport errors**. Latency median 1062ms, P95 2617ms, maximum 3719ms. Source: Worker `cf2182ed-b3fc-4ab6-99ab-5590e7e8a075`, MCP v43, release `r12-discovery-1`.

**Complete independent results:** [R12 full report](https://github.com/kingdomfishers/BibleResearch/blob/feat/r12-qa-fixes/research/r12/live_mcp_retest_2026-11-19/R12_MCP_RETEST_REPORT.md) and [all 239 cases matrix](https://github.com/kingdomfishers/BibleResearch/blob/feat/r12-qa-fixes/research/r12/live_mcp_retest_2026-11-19/R12_MCP_RETEST_ALL_239.json); full ranked top-25 stored in 16 separate `research/r12/live_mcp_retest_2026-11-19/batch_*.json` files. Keyword alias matches are unverified, **not pass counts**; among 24 negative controls, `N001–N004` remain source-inspected false endpoint relationship labels (Hagar→ostrich, eye→angel, logos→kidney, covenant→wheel). `S018` third-day Hosea/Jesus and `S001` unleavened bread/Red Sea remain unmet in top results. **Fix algorithmic relevance next, not the old CPU incident.**

---


## FOR CHATGPT — INDEPENDENT ALGORITHM TESTING

### 1–5. Live Deployment Identifiers & Provenance

Current production services are deployed directly under the **Direct Live Development Policy** (`AGENTS.md`, `ARCHITECTURE.md`, `TASKS.md` / `R12TASKS.md` SHA-256 `0DE08D4ED5FDC54983B58F0D5EC89395E2B270074543539FBE0418C2A41FFB12`):

1. **Deployed Corpus Worker (`bibleresearch-corpus`) Version ID:** `7f51d378-ecef-4022-bcbc-94123397c6ec` (`https://bibleresearch-corpus.kingdomfishers-custom.workers.dev`; supersedes `574aa5a1-b50f-471e-a1e3-3d319bddee67`).
2. **Deployed Main MCP (`bible-mcp`) Version:** **42** (`ACTIVE`, `verify_jwt: false`, server `1.7.0`, `ezbr_sha256: ea4402c37a32def3db2728972dbb5b7232d78b7915ce032667e30dbf3d4d331b`, rollback `v41`, `writes: "enabled"`, **46 tools** & **22 prompts** preserved at `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`).
3. **Deployed Main Website (`bibleresearch`) Version ID:** `d147114c-6a5c-4927-80ed-2a48877c2af4` (`https://bibleresearch.kingdomfishers-custom.workers.dev`, bundle `assets/index-oRYXrj0W.js`; supersedes `f68e7b8d-9a78-45be-9025-765ff2ad85a5`).
4. **Active R12 Release / Asset Revision:** `r12-discovery-1`, full static bundle SHA-256 `c23272125b34f179237e1c61381ec0b3b9b7329ef8b92e282f6ae496194bf994`, `20,000` files total (all R3–R11 releases intact), serving compiled offline pilot `/v2/relationships/r11-v1.0/r10/r12-pilot.json.gz` (`1,113,145` bytes) referenced by `fast-manifest.json.gz` (`r12_pilot_anchors: 48`).
5. **Git Branch & Code Commit SHA:** Branch `feat/r12-qa-fixes`, commit `6ea3b6802d73724ffad6a54c3185a4076f7be90f` (base packed corpus source commit `712d3627b881b137fe11da6fc97d0871600c568c`).

### 6. Summary of R12 Algorithm Changes Integrated Live

- **Offline 2–5 Meaningful-Hop Beam Discovery (`src/relationships/multihop-search.ts` — `runR12BeamSearch`, `offline_mode: 'r12'`):** Beam width `64`, up to `16` diversified outgoing edges per expansion (`layerBalancedSlice`), max `10` physical graph transitions, cycle and redundant-identity suppression, administrative identity joins consuming physical steps (`0` meaningful semantic hops, never establishing token-specific interpretation on their own), hub and function-word penalties, alternative proof preservation. Legacy 1–3 hop online traversal remains unchanged when `offline_mode` is omitted.
- **Unified Authoritative Proof Ranker (`src/relationships/path-ranker.ts`, `R12_SCORE_VERSION = 'r12-ranker-v1'`):** Ported `research/r12/proof-ranker.mjs` into the single authoritative TypeScript ranker (`scoreR12Path`, `rankR12DiscoveryDestinations`). Computes step quality, path quality $Q = \text{geometric\_mean}(\text{step\_quality}) \times 0.95^{\max(0, \text{meaningful\_hops} - 2)}$, independent biblical convergence $C = \min(1, \log_2(\max(1, \text{independent\_biblical\_source\_groups})) / 3)$ (collapsing mirrored edges and parallel editions; `EXTERNAL_WORLD` statements contribute `0` to `C`), IDF distinctiveness $D$, relationship diversity $T$, `interest_score`, and MMR reranking. Weakest-step epistemic status cannot improve via convergence.
- **Offline Pilot Compiler & Lazy Runtime Loader (`scripts/build-r12-pilot.mjs`, `src/relationships/r10-discovery.ts`):** Compiled `48` pilot anchors (`24` Hebrew, `24` Greek) into `r12-pilot.json.gz`: `48/48` with multihop paths (`1,152` recommendations), `32/48` with external property bridges, `40/48` with R8 structural clause scene parallels across `906` eligible R8 scenes, and `48/48` with orthographic form candidates. `discoverBiblicalConnections`, `getConnectionEvidence`, and `expandBiblicalConnection` hydrate `r12:path:`, `r12:prop:`, `r12:struct:`, and `r12:orth:` IDs and support `sense:`, `ext:wd:` / `wd:`, and `ext:oewn:` / `oewn:` node expansion.
- **Discovery UI & MCP Schema Updates:** `src/ui/components/DiscoverConnections.ts` renders R12 badges (`R12 TEXTUAL` / `R12 EXTERNAL BRIDGE` / `R12 PATTERN`), `Q/C/D/T/MMR` metrics, `independent biblical support=0` warnings, alternative routes, and clickable step-by-step intermediate node expansion. `supabase/functions/bible-mcp/relationships-v2.ts` enables `max_hops` 1–5 on `discover_biblical_connections_v2` and documents `sense:`, `wd:`, and `oewn:` expansion on `expand_biblical_connection_v1`.

### 7. External Datasets Integrated (Licensed & Pinned)

Extracted by `scripts/acquire-r12-external-pilot.mjs` into `scripts/fixtures/r12-external-pilot.json` with zero ontology-closure or geographic-coordinate imports:

- **Open English WordNet (OEWN) 2025:** Downloaded local release `english-wordnet-2025-json.zip` (`9,986,555` bytes, SHA-256 prefix `7d749f6e2c39e697`), **CC BY 4.0** (with Princeton WordNet attribution). Used in pilot: **30 synsets**.
- **Wikidata Structured Claims (`wbgetentities` pinned extract):** Extract SHA-256 prefix `a4ad6620dc0fd15a`, **CC0 1.0**. Filtered to exclude Wikidata ontology meta-classes (such as `Q112826905`, `Q103812529`, `Q103907369`). Used in pilot: **37 QIDs** ($\le 50$ non-geographic concept cap), **37 biblical lemma/sense mappings**, and **291 sourced property assertions**.
- **Polysemy Separation Examples:** `H5869_eye` (`verified`) kept separate from `H5869_spring` (`candidate`); `H7307_wind` / `H7307_breath` (`candidate`, weaker weight) kept separate while `H7307` as `spirit` stays unmapped to physical air.

### 8. Verified Textual vs. Candidate / Exploratory Classification

| Mechanism / ID Prefix | Epistemic Class | Biblical Convergence (`C`) | Exploratory? |
|---|---|---|---|
| Direct grammatical, lexical, LXX, same-verse/clause (`r11:*`, `r10:ident:*`) | `TEXT_DIRECT` / `LEXICAL_BRIDGE` | Contributes when backed by independent biblical clause/statement groups | No (verified textual/lexical scope noted) |
| R12 2–5 hop proof paths (`r12:path:...`) | `weakest_layer` propagated across step layers (weakest-step ceiling; path synthesis does not establish endpoint equivalence) | `independent_biblical_groups` grouped by source clause/statement lineage | Path synthesis is candidate; individual steps carry witness citations |
| Physical-property bridges (`r12:prop:...`) | `EXTERNAL_WORLD` (`external_world_bridge`) | **Always `0`** (`independent_biblical_support: 0`) | **Yes** — modern/external semantic bridge, never biblical proof |
| Structural clause scene parallels (`r12:struct:...`) | `STRUCTURAL_PATTERN` | Pattern score via IDF-weighted feature Jaccard ($\ge 2$ features) | **Yes** — candidate structural parallel |
| Orthographic consonantal form overlaps (`r12:orth:...`) | `HYPOTHESIS` | N/A | **Yes** — non-etymological superficial form similarity |

### 9. Ten Concrete MCP Calls for Independent Testing

Endpoint: `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp` (remember to refresh the ChatGPT connector schema if testing new `max_hops=5` or updated tool descriptions).

1. **Verify live release, worker, and corpus provenance:**
   - Tool: `get_relationship_coverage_v2`
   - Arguments: `{}`
   - Expect: `verification_release.worker_version === "7f51d378-ecef-4022-bcbc-94123397c6ec"`, `verification_release.corpus_release === "r12-discovery-1"`.
2. **Hebrew polysemous anchor discovery (`H5869` `עַיִן` eye / spring):**
   - Tool: `discover_biblical_connections_v2`
   - Arguments: `{"query": "H5869", "limit": 10}`
   - Inspect `r12_discovery`, `r12:path:H5869:...`, `r12:prop:H5869:...`, and separation of `eye` vs `spring`.
3. **Greek oil-lamp anchor discovery (`G3088` `λύχνος`):**
   - Tool: `discover_biblical_connections_v2`
   - Arguments: `{"query": "G3088", "limit": 10}`
   - Inspect 2-hop paths (`r12:path:G3088:G5459`) and cross-testament property bridges (`r12:prop:G3088:H5216`, `r12:prop:G3088:H4501`, `r12:prop:G3088:H8081`).
4. **Occurrence-anchored Hebrew discovery (`Gen 1:2` `H7307` pos `9`):**
   - Tool: `discover_biblical_connections_v2`
   - Arguments: `{"query": "H7307", "word_id": 130555, "book": 1, "chapter": 1, "verse": 2, "position": 9, "max_hops": 5, "limit": 10}`
   - Verify `selected_occurrence.word_id === 130555`, `discovery_scope.occurrence_anchored === true`, and `H7307` candidate `wind`/`breath` bridges (`r12:prop:H7307:G4151`, `r12:prop:H7307:H5397`) without mapping `spirit` to physical air.
5. **Inspect a 3-hop R12 proof path:**
   - Tool: `get_connection_evidence_v1`
   - Arguments: `{"evidence_id": "r12:path:H5869:G0457"}`
   - Inspect `evidence.r12_metadata` (`score_version: "r12-ranker-v1"`, `meaningful_hops: 3`, `Q/C/D/T/MMR`, `steps`, `alternative_paths`) and `passage_details`.
6. **Inspect a live OEWN + Wikidata external physical-property bridge:**
   - Tool: `get_connection_evidence_v1`
   - Arguments: `{"evidence_id": "r12:prop:G3088:H5216"}`
   - Confirm `evidence.epistemic_class === "external_world_bridge"`, `evidence.r12_metadata.external_bridge.independent_biblical_support === 0`, OEWN `03641539-n` (CC BY 4.0), Wikidata `Q821952$93d8b419-49e4-a052-6120-aa9f432d1517` (CC0 1.0), and distinct sense glosses (`G3088_lamp`, `H5216_lamp`).
7. **Inspect an R8 structural clause scene parallel:**
   - Tool: `get_connection_evidence_v1`
   - Arguments: `{"evidence_id": "r12:struct:G3088:LUK_11:33:LUK_15:8"}`
   - Evaluate whether the shared R8 grammatical/clause features support a meaningful structural comparison or over-match syntactic frames.
8. **Inspect an orthographic form candidate:**
   - Tool: `get_connection_evidence_v1`
   - Arguments: `{"evidence_id": "r12:orth:H5869:H5770"}`
   - Verify explicit non-etymology exploratory warning and consonantal offset details.
9. **Expand an external Wikidata / sense node:**
   - Tool: `expand_biblical_connection_v1`
   - Arguments: `{"node_id": "wd:Q821952"}`
   - Follow up with `{"node_id": "sense:H5869_spring"}` and check cross-lemma expansion fidelity.
10. **Regression + write/notes compatibility + negative control check:**
    - Discovery negative control: `discover_biblical_connections_v2({"query": "spirit wind"})` (verify NO `r11:intersect:verse:H7307:H7307:2`).
    - Contradictory selector control: `discover_biblical_connections_v2({"word_id": 999999999, "book": 1, "chapter": 1, "verse": 2, "position": 9})` (verify `status: "selector_mismatch"`).
    - Legacy/notes regression: `get_verse_research` on `Gen 1:2` (`notes` present with `epistemic_layer: "user_note"`) and `tools/list` (`46` tools including note write tools).

### 10. Five Concrete Website User Flows to Test

Target URL: `https://bibleresearch.kingdomfishers-custom.workers.dev` (HTML loads `assets/index-oRYXrj0W.js`).

1. **Gen 1:2 -> `H7307` -> Discover -> Origin Banner & Multi-Hop Exploration:** Open `#1-1-2`, click `וְרוּחַ` (`H7307`, pos 9, STEP `130555`), click `Discover Biblical Connections →`, inspect R12 proof badges and `r12:path:H7307:*` cards, and open an evidence drawer.
2. **Search `G3088` (`lamp`) -> Filter & Inspect Cross-Testament Property Bridge:** Search `G3088` in Discover, verify R12 multihop (`r12:path:G3088:G5459`) and external bridge (`r12:prop:G3088:H5216`), check `independent biblical support=0` warning inside the card and drawer, and verify OEWN/Wikidata attribution renders cleanly.
3. **Click Intermediate Step Expansion inside Evidence Drawer:** Expand any R12 multi-hop card (`r12:path:H5869:G0457` or `r12:path:G3088:G5459`), click an intermediate node button inside the step chain (`connection_paths` or drawer), verify re-anchored discovery loads without stale overwrite, then click `← Previous discovery`.
4. **Follow Biblical Passage & Return to Initial Word (Desktop 1280px & Mobile 390px):** From any opened R12 evidence drawer, click a passage button to jump to the reader verse, verify `↩ Return to initial word` restores the original verse/word selection with `0px` horizontal overflow and zero console/page errors.
5. **Non-Pilot Anchor Fallback Query:** Search an un-compiled concept or lemma (e.g., `"scarlet Tamar Rahab Matthew 1"` or `"hyssop"`) and confirm full R11/R10 corpus discovery, evidence drawers, and filters continue working cleanly even when `r12-pilot.json.gz` does not precompute that anchor.

### 11. Expected Evidence Fields & Epistemic Labels

- On `discover_biblical_connections_v2` responses matching a pilot anchor:
  - `r12_discovery`: `{ schema_version: 1, release_id: "r12-discovery-1", score_version: "r12-ranker-v1", pilot_anchors_matched: string[], multihop_recommendations_count, property_bridges_count, structural_candidates_count, orthographic_candidates_count, exploratory_tail_cursor, external_sources: [{ id, provider, release, license }] }`.
  - Per connection item in `strongest_connections`: `evidence_id` (`r12:path:*`, `r12:prop:*`, `r12:struct:*`, `r12:orth:*`), `epistemic_class` (incl. `external_world_bridge`), `r12_metadata`.
- Inside `get_connection_evidence_v1` response:
  - `evidence.r12_metadata`: `score_version`, `meaningful_hops`, `physical_steps`, `path_quality_q`, `convergence_c`, `distinctiveness_d`, `diversity_t`, `interest_score`, `mmr_score`, `independent_biblical_groups`, `weakest_layer`, `steps` (with per-step `layer`, `predicate`, `source_ref` / provenance, `meaningful_hop`), `alternative_paths`.
  - On `r12:prop:*` bridges: `evidence.r12_metadata.external_bridge` (`property_key`, `value_id`, `value_label`, `mapping_status`, `claim_status`, `independent_biblical_support: 0`, `left_mapping`, `right_mapping`, `shared_features` with OEWN/Wikidata `source_id`, `source_ref`, `license`, `release`).

### 12. Negative Controls (Must NOT Produce False Claims)

1. `discover_biblical_connections_v2({ query: "spirit wind" })` must **NOT** emit false self-intersection `r11:intersect:verse:H7307:H7307:2`.
2. `H5869` senses (`H5869_eye` vs `H5869_spring`) must stay separated; neither sense may silently transfer external anatomy/spring properties onto the other.
3. `H7307` (`ruach`) `wind`/`breath` candidate bridges remain `candidate` (`independent_biblical_support: 0`) and must **NOT** claim `spirit` has physical air/wind properties or divine-wind theological identity.
4. `Hagar seeing eyes spring` must resolve Hagar to `H1904` (never `H1481` "to sojourn").
5. Contradictory occurrence selector (`word_id: 999999999, book: 1, chapter: 1, verse: 2, position: 9`) must return `status: "selector_mismatch"` rather than silently substituting a lemma.
6. External property bridges (`r12:prop:*`) must always preserve `independent_biblical_support === 0` (`weakest_layer: "EXTERNAL_WORLD"`).

### 13. Known Coverage Limits

- `r12-pilot.json.gz` currently precomputes offline R12 discovery (`r12:path:*`, `r12:prop:*`, `r12:struct:*`, `r12:orth:*`) for **48 pilot anchors** (`24` Hebrew, `24` Greek); whole-corpus incremental precomputation (`R12-12`) is not yet built.
- External mappings in `r12-external-pilot.json` are a bounded pilot (`30` OEWN synsets, `37` non-geographic Wikidata QIDs, `37` mappings, `291` assertions); unmapped biblical lemmas/senses will not produce `r12:prop:*` bridges yet.
- Cloudflare Workers Free Tier (`10 ms` CPU limit per request) can still produce rare cold-isolate HTTP 503 (`Error 1102`) bursts when first fetching/gunzipping the `1.11 MiB` pilot asset alongside shard indices, though warmed isolates succeed cleanly (live `discover_biblical_connections_v2("H5869")` measured `3845 ms`, subsequent `get_connection_evidence_v1` `1405 ms` via MCP).

### 14. Top Diagnostic Questions for ChatGPT to Evaluate

1. **2–5 Hop Signal vs. Noise:** For Hebrew/Greek pilot anchors (`H5869`, `G3088`, `H7307`, `H2091`, `H4501`, `G5457`), do top-ranked `r12:path:*` results surface genuinely illuminating intermediate biblical connections, or do high-frequency co-occurrence / generic LXX bridges still crowd out sharper 2–4 hop routes?
2. **Convergence & MMR Calibration:** Check whether `C` (independent source grouping) successfully avoids double-counting mirrored edges or parallel editions, and whether the MMR redundancy penalty (`0.35`) gives useful variety across top 10–24 results without pushing the strongest direct path too low.
3. **Polysemy & Sense Guarding:** On `H5869` (eye/spring), `H7307` (wind/breath/spirit), and `H5178` (bronze/serpent/fetters), does sense separation cleanly prevent cross-sense contamination in both `r12:prop:*` bridges and downstream `expand_biblical_connection_v1` hops?
4. **Property Bridge Realism (`OEWN` + `Wikidata`):** Are the surfaced shared physical features (e.g., `G3088`/`H5216` oil lamp -> `wd:combustion_fuel_agent` olive oil, `H2091`/`H5178` gold/bronze) concrete and helpful as clearly labeled `EXTERNAL_WORLD` exploratory hypotheses, and are any Wikidata ontology meta-classes leaking into bridges?
5. **Structural Scene & Orthographic Utility:** Do `r12:struct:*` R8 clause parallels capture recognizable parallel narrative/discourse scenes without trivial grammatical over-matching, and are `r12:orth:*` consonantal form candidates helpful while staying strictly quarantined from etymology claims?
6. **Live Latency & Missing-Coverage Honesty:** Across diverse unseen and pilot queries, report exact response latencies, any cold `503`/`Signal timed out.` occurrences, and whether UI + MCP honestly disclose `pilot` boundaries vs full-corpus R11/R10 fallback.

---

## Prior R12-Witnesses Baseline — 2026-11-18 (superseded above)

Historical baseline prior to `r12-discovery-1` cutover (`TASKS.md` / `R12TASKS.md` SHA-256 `26E9FCF45095D31460B6586DFDABFE7A145CB741A32AF514A3881A4E5DE4F570`, `bible-mcp` v41, `bibleresearch-corpus` `574aa5a1`, `bibleresearch` `f68e7b8d`):

- **Branch / Implementation Commit:** `feat/r12-qa-fixes` · commit `249de9f7801bba7eecc056c2b7d44d1435427b78` (packed corpus source commit `712d3627b881b137fe11da6fc97d0871600c568c`)
- **Production Corpus Worker (`bibleresearch-corpus`):** `https://bibleresearch-corpus.kingdomfishers-custom.workers.dev`
  - **Version ID:** `574aa5a1-b50f-471e-a1e3-3d319bddee67` (superseding `69d85126-59cd-4711-ba39-23589f59af01` and initial R12 cutover `f9241946-17f8-492e-ae75-111e2fcd1f70`)
  - **Release / Defaults:** `r12-witnesses-1`, defaults `r9b-v1.1` / `r8-v1.2`, asset fingerprint `5d26a11510359b5200a7169c77b73578a7be57fcc95f15764142cc46a5f42eb9` (`19,999` assets; all R3–R11 releases preserved)
  - **Fixes live in production:** Occurrence-anchor validation & scope disclosure in `discover_biblical_connections_v1`/`v2` (`scripts/corpus-relationships-rpc.mjs`) plus `r11:intersect:pericope:`, `r11:lex:`, and `r11:bridge:` handlers in `getConnectionEvidence` (`src/relationships/r10-discovery.ts`)
- **Production Website Worker (`bibleresearch`):** `https://bibleresearch.kingdomfishers-custom.workers.dev`
  - **Version ID:** `f68e7b8d-9a78-45be-9025-765ff2ad85a5` (superseding `60eefd79-a256-4ed8-b117-8fc89922a326` and `3dd0c5eb-d310-4920-8995-f6bc22eb31d8`)
  - **UI workflow wired:** Read → Select word → `Discover Biblical Connections →` (passing `{word_id, book, chapter, verse, position}` and defaulting to `r9b-v1.1` / `discover_biblical_connections_v2`) → Origin banner with honest lemma-scope explanation → Verified vs Candidate evidence labels → Evidence drawer (`source_record_ids`, limitations, passage preview, clickable tokens) → Follow passage → `↩ Return to initial word`
- **Main Production MCP (`bible-mcp`):** `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`
  - **Function Version:** **41** (`ACTIVE`, `verify_jwt: false`, server `1.7.0`, `ezbr_sha256: 60dc5cbeeb332e3b009fe9bd60ee198a88c35d140e2527687f94e81c20d2fba7`, rollback `v40`, `writes: "enabled"`)
  - **Tools preserved & updated:** All **46 tools** (`41` read-only + `5` write tools: `create_note`, `update_my_note`, `delete_my_note`, `add_research_note`, `save_dlm_research_note`) and **22 prompts** preserved (no replacement with the 14-tool staging MCP). Updated existing tool contracts to add optional occurrence-anchor inputs `{word_id, book, chapter, verse, position, edition_key?}` on `discover_biblical_connections_v2` / `v1`, expose `word_id` / `extended_strongs` / `release` on `get_word_relationships_v2`, default `UPSTREAM_PIN` to `r9b-v1.1` / `r8-v1.2`, and attach `verification_release` provenance on production corpus responses.

### Live Production Acceptance Results (`node scripts/verify-r12-production-live.mjs` — PASS exit 0)

- **Main MCP HTTP transport (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`):**
  - `/health`: `200`, `name: "BibleResearch"`, `version: "1.7.0"`, `corpus_target: "production"`, `corpus_url: "https://bibleresearch-corpus.kingdomfishers-custom.workers.dev"`, `writes: "enabled"`, `tools: 46`, `prompts: 22`
  - `initialize`, `tools/list` (`46` tools; confirmed `word_id`, `book`, `chapter`, `verse`, `position`, `edition_key` present on `discover_biblical_connections_v2`), `prompts/list` (`22` prompts)
  - `get_relationship_coverage_v2`: `release_version: "r9b-v1.1"`, `verification_release.corpus_release: "r12-witnesses-1"`, `worker_version: "574aa5a1-b50f-471e-a1e3-3d319bddee67"`
  - Hebrew Gen 1:2 `H7307` pos `9` → `word_id: 130555`; occurrence-anchored `discover_biblical_connections_v2` preserves `selected_occurrence.word_id: 130555` and `discovery_scope.occurrence_anchored: true`; contradictory `word_id: 999999999` → `status: "selector_mismatch"`
  - Greek John 1:1 `G3056` pos `5 / 8 / 17` → `word_ids: [15230, 15229, 15231]`
  - Discovery `"scarlet Tamar Rahab Matthew 1"` → `6` connections; `get_connection_evidence_v1` PASS (`status: "ok"`) for both `r11:intersect:pericope:1148:1144` and `r11:cluster:H8144:temple_and_sanctuary_architecture`
  - Hebrew evidence `r11:gram:H5397:possessive_construction_with:H7307` → `status: "ok"` (`H5397`, `H7307`)
  - Greek evidence `r11:gram:G3037:modifies:G5093` → `status: "ok"` (`G3037`, `G5093`)
  - `expand_biblical_connection_v1("lemma:H7307")` → `status: "ok"`, `6` connections
  - Negative control `"spirit wind"` → `status: "ok"`, no `r11:intersect:verse:H7307:H7307:2`
  - Legacy compatibility: `get_verse_research` (Gen 1:2 with `notes`), `get_notes` (`epistemic_layer: "user_note"`), `get_septuagint_passage(1, 32, 1)` (`found: true`, production corpus routing) → PASS
- **Main Website Playwright E2E (`https://bibleresearch.kingdomfishers-custom.workers.dev`):**
  - **Desktop (`1280x900`):** `#1-1-2` → clicked `H7307` → `Discover Biblical Connections →` → verified origin banner (`GEN 1:2 position 9`, `STEP word_id 130555`, `lemma:H7307`, corpus-wide lemma-scope explanation) → `10` cards → opened evidence drawer (`HEBREW_LXX_WORD_ALIGNMENTS + STEPBible`) → followed `"Ezekiel 37:9 (OT)"` (`#26-37-9`) → clicked `↩ Return to initial word` back to `#1-1-2` with `H7307` selected (`scrollWidth: 1280`, `overflowPx: 0`). Also searched `"scarlet Tamar Rahab Matthew 1"` (`10` cards + expanded first evidence drawer `r11:intersect:pericope:1148:1144`) and `"spirit wind"` negative control → PASS, zero page/console errors.
  - **Mobile (`390x844`):** Fresh session `#1-1-2` → `H7307` → `Discover` → origin banner → `10` cards → opened evidence drawer → followed `"Ezekiel 37:9 (OT)"` (`#26-37-9`) → clicked `↩ Return to initial word` back to `#1-1-2` (`scrollWidth: 390`, `innerWidth: 390`, `overflowPx: 0`, zero page/console errors).
  - **Corpus origin check:** Only `https://bibleresearch-corpus.kingdomfishers-custom.workers.dev` requested (zero staging traffic).

### ChatGPT Connector Refresh Status

- **Server-side:** Production MCP `bible-mcp` v41 is deployed and live-verified at `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`. All 46 tool names and the connector URL are preserved, so existing ChatGPT tool calls immediately route to the production R12 corpus (`r12-witnesses-1`).
- **ChatGPT account-side refresh recommended:** Server deployment alone does not prove ChatGPT has refreshed its cached tool catalog. To pick up the updated R12 tool descriptions and new optional `{word_id, book, chapter, verse, position, edition_key?}` schema parameters on `discover_biblical_connections_v2` / `v1` and `get_word_relationships_v2`, open the existing **BibleResearch** connector/plugin in ChatGPT settings, trigger a manual **Refresh** / schema update, and start a **new conversation**.

### Remaining Limitations

- Corpus discovery currently indexes lemma/concept-level connections (`r11-v1.0` / `r12-witnesses-1`); occurrence anchors are validated and preserved with explicit scope disclosure rather than claiming occurrence-exclusive discovery edges across the entire corpus.
- Cloudflare Workers Free-tier CPU/isolate limits can still produce rare transient HTTP 503 (`Error 1102`) bursts under heavy back-to-back cold requests; `bible-mcp` retries transient `500/502/503/504` twice with jittered backoff, and `verify-r12-production-live.mjs` retries a transient `502/503/504` once after 800 ms.
- Algorithmic R12 milestones `R12-02` through `R12-14` remain open and will iterate via direct live experimentation.

---

# Historical R12 staging increment — 2026-11-18 (superseded by production cutover above)

## FOR CHATGPT — INDEPENDENT TESTING

This partial preview supersedes the historical deployment tables below. Production is unchanged. Full runtime/discovery acceptance remains open.

### Published release

- Branch `feat/r12-qa-fixes`; source commit `712d3627b881b137fe11da6fc97d0871600c568c`.
- Corpus: https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev — Worker `713d40b0-5e2e-4d6d-9597-da02b51424e3`, release `r12-witnesses-1`.
- Application: https://bibleresearch-staging.kingdomfishers-custom.workers.dev — retained version `dedf634a-ce72-4a71-9442-79b647b18dc3`; not redeployed.
- MCP: https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp-staging/mcp — function version **2**, ACTIVE; deployment artifact SHA-256 `62fe10759482d4f20aa3ea471511d9697f81e7b51dcf8062252bef4d02ca7268`.
- Asset revision `5d26a11510359b5200a7169c77b73578a7be57fcc95f15764142cc46a5f42eb9`: manifest fingerprint combining base bundle hash and chapter-index hashes, not a direct digest of the final tree. Inventory **19,999 assets**, 20 packed blobs, each asset within 25 MiB. Generated corpus assets are not committed.

### Implemented and narrowly verified

R8/R11 packed indexes load individual compressed records through validated byte ranges. Packed loader fix in `scripts/corpus-worker.mjs`: bounded streaming extraction (`readPackedRange` via BYOB reader / `readAtLeast` slices), early stream cancellation of unread suffixes, native `gunzipSync` decoding, request-local promise inflight cache, and completed-record caching. This prevents buffering whole packed blobs on HTTP 200 responses. Verified in Node (`scripts/verify-r12-packed-loading.mjs`) and the actual Cloudflare Workers runtime (`workerd`).

Redundant summary relations were removed while original evidence, counts and pagination remain available. Secondary resolution avoids unnecessary uncovered-lemma loading. Atomic replacement prevents writes through source hardlinks; affected local derived copies were restored against pinned hashes.

Grammatical discovery now validates both original-language token identities/coordinates against exact source witnesses and counts independent clauses across mirrored edges/editions. Chapter context prioritizes attested lexical candidates, deduplicates base Strong’s candidates, and retains alternatives without example-specific person mappings.

The separate staging MCP exposes **14 read-only corpus tools**, no notes/writes, and no production fallback. Additive `verification_release` identifies `mcp_release`, `corpus_target`, `corpus_url`, `corpus_release`, `worker_version`, `source_commit`, and `asset_sha256`. Discovery provenance uses exact `rel:...` IDs; alternatives remain in `sense_candidates`.

Type-check, build, loader regression, and workerd runtime tests passed. Deployment smoke: Worker version `713d40b0-5e2e-4d6d-9597-da02b51424e3`; health/backend HTTP 200; 12/12 cold and warm concurrent resource probes HTTP 200 with 0 HTTP 503s (`scripts/verify-r12-staging-resources.mjs`); Greek evidence (`r11:gram:G3037:modifies:G5093`), Hebrew evidence (`r11:gram:H5397:possessive_construction_with:H7307`), and discovery (`discover_biblical_connections_v2` for `scarlet Tamar Rahab Matthew 1`) verified live. Earlier local grammatical comparison improved matching displayed witnesses from **39/220 to 193/193** over 16 queries; this preceded final packaging/context ordering and is preliminary. Full postdeployment load/CPU acceptance remains open for independent testing.

### Independent cases (use published tool schemas for argument names)

1. `tools/list`: exactly 14 read-only tools, no notes/writes. `/health`: writes disabled, staging backend. Every research response must identify the release tuple above.
2. `get_unified_word_relationships_v2`: Genesis 1:2 H7307 position 9 → 130555; H6440 positions 7/13 → 118734/118736. John 1:1 G3056 positions 5/8/17 → 15230/15229/15231. Contradictory H7307 / word 130555 / Genesis 1:2 position 2 → `selector_mismatch`.
3. `discover_biblical_connections_v2`, `{"query":"scarlet Tamar Rahab Matthew 1"}`: Matthew-attested G2283/G4477 should be preferred while alternatives remain. Compare unseen `Lot Genesis 19` and `Mary John 20`; chapter attestation must not assert individual identity by itself.
4. `get_connection_evidence_v1`, `{"evidence_id":"r11:gram:G3037:modifies:G5093"}`: λίθος / τίμιος witnesses are 1 Corinthians 3:12, Revelation 17:4 and 18:16. Exact source: `rel:macula-greek-nestle1904:1CO 3:12#cl1:modifies:n46003012011:n46003012010`.
5. Same tool, `{"evidence_id":"r11:gram:H5397:possessive_construction_with:H7307"}`: נְשָׁמָה / רוּחַ witnesses include 2 Samuel 22:16, Genesis 7:22 and Psalm 18:15. Source: `rel:macula-hebrew-wlc:GEN 7:22#cl1:possessive_construction_with:o010070220041:o010070220031`. Genesis 2:7 must not be a both-term witness.
6. Same tool, `{"evidence_id":"r11:gram:H0231:grammatical_object_of:H3947"}`: אֵזוֹב / לָקַח witnesses include Leviticus 14:4, 14:49 and 14:51. Source: `rel:macula-hebrew-wlc:LEV 14:4#cl1:grammatical_object_of:o030140040132:o030140040032`. These three recurrences do not establish theological or authorial equivalence.
7. Negative controls: `r11:gram:G3037:modifies:H7307` → not_found; discovery `zzr12noattestation` → no connections. `spirit wind` must not emit false same-token evidence `r11:intersect:verse:H7307:H7307:2`. Hagar → H1904, not H1481.
8. `get_septuagint_passage`, book 1/chapter 32/verse 1: Swete returns `εἰς` preserving raw `XXXIIεἰς`. Same-clause/contextual results must provide witnesses supporting the exact pair and clause.
9. Compare top ten results for scarlet, well, seed, breath, lamp, Hagar seeing eyes spring and unseen Hebrew/Greek queries: identity, witness precision, false positives, dependent evidence and diversity. Local baseline artifacts remain in `.artifacts-r12/continuation/`. Cord/hope wordplay remains a hypothesis, without asserted etymology or intention.
10. Independently exercise reader/lexical/grammar/contextual/discovery operations with bounded cold/warm concurrency. Record Error 1102/503 and release IDs. CPU acceptance is **pending**; response bytes/wall time do not establish CPU compliance.

### Separate ChatGPT connection

Codex verified HTTP MCP transport; connection inside the user's ChatGPT account is **not confirmed**. Existing production connector is unchanged.

Follow [OpenAI connection instructions](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt): https://chatgpt.com/plugins → plus → **Add custom MCP server** → name **BibleResearch R12 staging** → exact staging `/mcp` URL above → authentication **None** → review/continue → **Create as a plugin** → review 14 tools → install. Start a new conversation and select staging using @. Account/workspace policy may restrict custom servers. Refresh metadata for an existing staging connection, then use a new conversation. Run case 4 and independently verify the full release tuple.

Known limits: cold/concurrent Error 1102 elimination remains unproven. Chapter attestation uses sampled passages; not every homograph, shared name or eye/spring sense is resolved. No new literary/theological derivation is established. Independent holdout acceptance remains open.

---

# Historical checkpoint (deployment details superseded above)

# R12 QA Fixes, Staging Release & Continuation Checkpoint

Written: 2026-11-17  
Authoritative workspace: `C:\Projects\BibleResearch-r10`  
GitHub branch: `feat/r12-qa-fixes` (`origin/feat/r12-qa-fixes`, initial QA fix commit `bb125a4ad2b82c9d93350f4072e026884e672053`, followed by the `chapter-lite` + `by-lemma` compaction commit on top)  
Synchronized queues: `TASKS.md` and `R12TASKS.md` (verified SHA-256 `166847cda457f17b2d8dcba2480af3a54afb3a9217e5b973344fcb311105309a`)

---

## 1. Production Safety Verification (Unchanged)

Production infrastructure was **NOT modified**:
- `bibleresearch` (production web): active Version ID `60eefd79-a256-4ed8-b117-8fc89922a326` (unchanged)
- `bibleresearch-corpus` (production corpus): active Version ID `69d85126-59cd-4711-ba39-23589f59af01` (unchanged)
- `bible-mcp` (production Supabase Edge Function): active `version: 40`, `verify_jwt: false` (unchanged)
- Existing R3/R8/R9B/R10/R11 static releases (`r3-v1.2`, `r8-v1.0`, `r8-v1.1`, `r9b-v1.0`, `r10-v1.0`, `r11-v1.0`) remain intact inside `.artifacts-r12/staging-bundle`.

---

## 2. Deployed Staging Environment & Current Live Status

Isolated staging services deployed (with an important caveat — see §4 on **Cloudflare Error 1102 / HTTP 503**):

| Service | Target URL | Version / State | Notes |
|---|---|---|---|
| Staging Corpus Worker | `https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev` | Version ID `e1bc3d5f-687f-464f-a4a7-806cfc1ecb46` (`19,979 / 20,000` files, rebuilt bundle) | **Live & verified:** 15/15 sequential Corpus RPC probes + 8/8 direct QA checks returned HTTP 200 (0 HTTP 503s). Concurrent browser requests on cold isolates can still intermittently hit Error 1102 under Free-tier 10ms CPU when `by-lemma` (1.9 MiB) + `uncovered-lemmas` (797 KiB) load together. |
| Staging Web UI | `https://bibleresearch-staging.kingdomfishers-custom.workers.dev` | Version ID `dedf634a-ce72-4a71-9442-79b647b18dc3` | Built with `VITE_CORPUS_BASE_URL=https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev`. Renders `H7307` (`Lex (5) · Ctx (1,097) · LXX (3)`), though concurrent initial page RPCs can still trigger intermittent Error 1102/CORS on cold isolates. |
| Staging Supabase MCP | `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp-staging/mcp` (`/health`) | `version: 1`, `ACTIVE`, `verify_jwt: false`, `corpus_target: "staging"`, 46 tools, 22 prompts | **Live & verified:** All QA-01..QA-12 checks passed end-to-end through `bible-mcp-staging` against `bibleresearch-corpus-staging` with 0 HTTP 503s. |

---

## 3. QA-01 through QA-12 Fixes & Verification Results

All QA defects from `research/r12/CHATGPT_LIVE_QA_2026-11-17.md` were root-caused, fixed, and verified:

| QA ID | Defect & Root Cause | Fix Implemented | Observed Verification |
|---|---|---|---|
| **QA-01, QA-04, QA-10** (P0) | `stage-r8-relationship-graph.mjs` stamped lemma-level `primary_word_id` (`wids[0]`, smallest `word_id` across the Bible) onto every R8 occurrence, and `r8-v1.1` parsed `slice(8,11)` yielding positions `100/200/201`. | Built versioned `r8-v1.2` (`scripts/build-r12-staging-assets.mjs`, ported to `scripts/stage-r8-relationship-graph.mjs`) mapping exact MACULA/canonical coordinates to STEP `word_id`, 1-based canonical `word_position`, `surface_form`, distinct `source_token_id`, and `word_id_status`, plus 64-bucket `word-id-index`. | **Local `staging-bundle` + Live `bible-mcp-staging` PASS:** GEN 1:2 pos 2 `H1961=55675` (`הָיְתָ֥ה`), pos 7 `H6440=118734` (`פְּנֵ֣י`), pos 9 `H7307=130555` (`וְר֣וּחַ`), pos 13 `H6440=118736` (`פְּנֵ֥י`); no `200/201` positions in `passage_frames`. |
| **QA-06, QA-07** (P0) | `resolveLemmaV2` only scanned R8 `pEntry.relations`, failing when a passage had 0 R8 relations (John 1:1) or predicate-only frames (Psalm 3:0). | `resolveLemmaV2` (`scripts/corpus-relationships-rpc.mjs`) resolves canonical passage tokens (from `chapter-lite` / `/v1/chapters`) alongside R8 frames & relations, returning verified occurrence identity while preserving `no_evidence_in_covered_scope`. | **Local + Live `bible-mcp-staging` PASS:** `JHN 1:1` `G3056` pos 5=`15230` (`λόγος,`), pos 8=`15229` (`λόγος`), pos 17=`15231` (`λόγος.`); `PSA 3:0` pos 2 `H1732=53063`. |
| **QA-05** (P0) | `resolveLemmaV2` short-circuited on first selector and silently switched lemmas (e.g. `H7307` -> `H1961`). | Added cross-selector consistency validation (`query`, `lemma_id`, `extended_strongs`, `word_id`, `token_id`, `position`, `edition_key`). Mismatches return `status: "selector_mismatch"` with `mismatch.conflicting_fields` and zero silent substitution. | **Local + Live `bible-mcp-staging` PASS:** `query="H7307", word_id=130555, GEN 1:2 pos=2` returns `status: "selector_mismatch"`, `conflicting_fields: ["word_id", "position"]`, citing actual `word_id=55675` (`lemma:H1961`). |
| **QA-02, QA-09** (P0) | `discoverBiblicalConnections` treated two senses of one `H7307` token (`spirit` + `wind`) as `r11:intersect:verse:H7307:H7307:2` (`direct_textual_evidence`). | Updated `src/relationships/r10-discovery.ts` (`discoverBiblicalConnections`, `getConnectionEvidence`): when `pA.bs === pB.bs`, emit `r11:repeat:verse:*` only with `>= 2` distinct `wn` positions; otherwise emit `r11:polysemy:*` exploratory notice (`evidence_tier: 5`). Avoided dropping distinct-lemma prefix+noun co-occurrences (e.g. `H4728 + H4480`). | **Local + Live `bible-mcp-staging` PASS:** `spirit wind` does NOT emit `r11:intersect:verse:H7307:H7307:2`; `verify-r11-benchmark.mjs` PASS; `verify-r11-discovery.mjs` `14/14` PASS. |
| **QA-03, QA-08** (P0) | `r10-discovery.ts` skipped `is_prop` matches when any `non_prop` gloss matched `"hagar"`, elevating `H1481` ("to sojourn") in Job 19:15 as Hagar. | Preserved exact-gloss proper-noun matches (`H1904` "Hagar") in `src/relationships/r10-discovery.ts` while retaining legitimate `H1481`/`H5869` evidence unmislabeled. | **Local + Live `bible-mcp-staging` PASS:** `Hagar seeing eyes spring` returns `r11:intersect:verse:H1904:H5869:386` (Gen 16:4), `H1904` grammar (`Gen 16/21/25`), zero `H1481` Hagar mislabels. |
| **QA-11** (P1) | `sample_passages` stored only the first 5 co-occurring verses regardless of `in_same_clause` or `is_collocation`. | Built `r9b-v1.1/contextual` (`same_clause_samples` for 252,358 pairs, `collocation_samples` for 189,216 pairs) and prioritized matching samples (or explicit `witness_status: "matching_witness_not_returned"`) in `scripts/corpus-relationships-rpc.mjs`. | **Local + Live `bible-mcp-staging` PASS:** `H7307` `same_clause` (`25/25` items carry `in_same_clause: true` witness) and `collocation` (`25/25` items carry `is_collocation: true` witness). |
| **QA-12** (P1) | Raw Swete LXX concatenated Roman chapter headings at chapter boundaries (`XXXIIεἰς` in Gen 32:1 #1). | Cleaned 41 chapter-boundary prefixed/suffixed tokens and flagged 61 standalone Roman markers in `v1/lxx/b*.json.gz`, ported to `scripts/import-lxx-swete.mjs` and filtered `!w.is_chapter_heading_marker` in `scripts/corpus-worker.mjs`. Kept `Mωσῆ` / `Xανανείς` untouched. | **Local + Live `bible-mcp-staging` PASS:** `get_septuagint_passage(1, 32, 1)` returns `tokens[0].word_text = "εἰς"`, `normalized_word = "εις"`, `raw_source_word_text = "XXXIIεἰς"`, `chapter_heading_marker = "XXXII"`. |

---

## 4. P1 HTTP 503 Investigation — Root Cause Found & Partial Optimization

1. **Confirmed root cause:** Direct `POST` probes to `https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev/v1/rpc/query_relationships_v2` returned **HTTP 503 (`Content-Length: 4805`, HTML error page without CORS headers)** reading:
   `Error 1102: Worker exceeded resource limits`.
2. **Telemetry from local `workerd` (`X-R12-Trace: 1`):**
   - Before optimization, cold requests decoded & parsed huge JSON assets per request:
     - `get_reader_passages_v1` (Gen 1): `4.48 MiB` (`1.15 MiB` unused `metadata.json.gz` + `3.33 MiB` `b1-c1.json.gz`)
     - `unified_lemma` `H7307` (Gen 1:2): `7.70–8.07 MiB` (`3.33 MiB` `b1-c1` + `2.30 MiB` `by-lemma/shard-1a` + `0.80 MiB` `uncovered-lemmas` + ...)
     - `unified_lemma` `G3056` (John 1:1): `10.88–11.41 MiB` (`7.61 MiB` `b43-c1` + `1.73 MiB` `by-lemma/shard-10` + `1.09 MiB` `passages/b43-c1`)
   - On Cloudflare Workers Free Plan (**10 ms CPU limit per request**), cold decompression + `JSON.parse()` of 4.5–11.4 MiB exceeds 10 ms CPU and triggers Error 1102 (no CORS headers), explaining both ChatGPT's intermittent 503s (cold vs warm isolate) and Playwright's CORS failures.
3. **Optimization deployed to `bibleresearch-corpus-staging` (`e1bc3d5f-687f-464f-a4a7-806cfc1ecb46`):**
   - Added 64-bucket `r8-v1.2/chapter-lite/shard-XX.json.gz` (compact WEB text + token coordinates), removed unused `ensureCatalog(env)` from `handleGetReaderPassagesV1`, avoided loading `uncovered-lemmas.json.gz` for secondary prefix morphemes, and compacted `r8-v1.2/by-lemma` summary duplicates (`scripts/build-r12-staging-assets.mjs`, `scripts/corpus-worker.mjs`, `scripts/corpus-relationships-rpc.mjs`).
   - `.artifacts-r12/staging-bundle`: `19,979 / 20,000 files` (`980.3 MiB`).
   - Measured in local `workerd`: `get_reader_passages_v1` `4.48 MiB -> 0.80 MiB`, `H7307` `8.07 MiB -> 4.14 MiB`, `G3056` `11.41 MiB -> 4.38 MiB`.
   - **Live verification after deploy (`e1bc3d5f`):**
     - `bibleresearch-corpus-staging`: 8/8 direct QA RPCs + 15/15 sequential sweep returned HTTP 200 (0 HTTP 503s).
     - `bible-mcp-staging`: All end-to-end MCP QA-01..QA-12 checks passed (`0` HTTP 503s).
     - Local regressions re-run & passing: `verify-r12-qa-fixes.mjs` `11/11`, `verify-r8d-regressions.mjs` `29/29`, `verify-r9c-multihop.mjs` `19/19`, `verify-r12-direct.mjs --only follow-related-word-and-evidence` `1/1`.
     - **Remaining limitation:** Concurrent cold browser requests on `bibleresearch-staging` (`#1-1-2`) can still hit intermittent Error 1102 when `by-lemma` (`1.90 MiB`) + `chapter-lite` (`0.84 MiB`) + `uncovered-lemmas` (`0.80 MiB`, still triggered via `word_id` prefix resolution for secondary morphemes like `H9002`) run in parallel on a cold Free-tier isolate (`Summary: Relationships · Gram (0) · Lex (5) · Ctx (1,097) · LXX (3)`).

---

## 5. Next Follow-up Optimizations (for Next Session)

1. Skip `loadUncovered()` (`797 KiB`) for secondary morphemes in the `word_id` selector branch of `resolveLemmaV2`, and further trim `r8-v1.2/by-lemma` (remove `sample_relations` copy from `by-lemma` summaries since `evidence/by-summary` serves the drawer) so cold isolate decoded bytes drop below ~1.2 MiB for concurrent browser traffic.
2. Re-run full `check:types`, `build`, `verify-r12-direct.mjs` (both local and live `R12_TEST_URL`), and deploy the slimmer bundle to `bibleresearch-corpus-staging`.

---

## 6. Copyable Prompt for ChatGPT Independent Verification (Staging MCP)

Connect ChatGPT to the staging MCP URL (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp-staging/mcp`) once the continuation agent finishes redeploying `bibleresearch-corpus-staging`:

```text
Verify the BibleResearch staging MCP server tools and report exact returned JSON fields, word IDs, surface forms, and statuses (do not guess or fill from memory):

1. GEN 1:2 occurrence identity (get_unified_word_relationships_v2):
   - query="H1961", book=1, chapter=1, verse=2, position=2 (expect word_id=55675, not 55544)
   - query="H6440", book=1, chapter=1, verse=2, position=7 (expect word_id=118734, not 118259)
   - query="H7307", book=1, chapter=1, verse=2, position=9 (expect word_id=130555, not 130527)
   - query="H6440", book=1, chapter=1, verse=2, position=13 (expect word_id=118736, not 118259)

2. John 1:1 & Psalm 3:0 occurrence identity (get_unified_word_relationships_v2):
   - query="G3056", book=43, chapter=1, verse=1 at positions 5, 8, and 17 (expect 15230, 15229, 15231 and explicit no_evidence_in_covered_scope on grammar)
   - query="H1732", book=19, chapter=3, verse=0, position=2 (expect word_id=53063)

3. Contradictory selector rejection:
   - query="H7307", word_id=130555, book=1, chapter=1, verse=2, position=2 (expect status="selector_mismatch" with conflicting_fields=["word_id","position"], never switching to H1961)

4. Discovery accuracy (discover_biblical_connections_v2):
   - query="spirit wind" (confirm NO r11:intersect:verse:H7307:H7307:2 direct_textual_evidence claim)
   - query="Hagar seeing eyes spring" (confirm H1904 Hagar resolves cleanly and H1481 Job 19:15 is never labeled Hagar)

5. Contextual witnesses & Swete LXX:
   - page_contextual_neighbors_v2 query="H7307", contextual_scope="same_clause" and "collocation" (confirm every returned item includes a matching witness with in_same_clause=true / is_collocation=true)
   - get_septuagint_passage p_book_no=1, p_chapter=32, p_verse_nr=1 (confirm tokens[0].word_text="εἰς" and raw_source_word_text="XXXIIεἰς")
   - Check p_book_no=1 for 30:1, 31:1, 33:1 and p_book_no=2 (Exodus) 32:1, plus H0430 disambiguation and Psalm 3:0->LXX 3:1 controls.
```

---

## FOR CHATGPT — CLOUDFLARE 503 / CPU RECOVERY

**Fix Commit SHA (`feat/r12-qa-fixes`):** `579cd49a720ee69f01f85cb7c334918d64f71ea2`
**Website Worker (`bibleresearch`):** Unchanged (`d147114c-6a5c-4927-80ed-2a48877c2af4`, not redeployed).

### 1. Root Cause of Production HTTP 503 / `exceededCpu`

The frozen 239-case MCP benchmark (`research/r12/live_mcp_results_2026-11-18/current/manifest.json`) completed 44/60 attempted cases before hitting 16 failures (rows 41–60: 16/20 failed) and 164/168 sampled discovery Worker events reporting HTTP 503 (`exceededCpu` at the Cloudflare Free Plan **10 ms CPU limit**). Local V8 `workerd` profiling (`X-R12-Trace: 1` + `.cpuprofile`) identified five compound runtime causes:

1. **Monolithic pilot load:** Cold requests fetched, gunzipped, and parsed the entire `r12-pilot.json.gz` (`1,113,145` B gz -> `10,099,953` B = `9.63 MiB` raw JSON) on every request, even for non-pilot queries (`~185–317 ms` CPU on local i7-8650U).
2. **`readPackedRange` full-blob streaming (`207–418 MiB`/req):** Stage G hydrated up to 25 verses from `packed-discovery-0..7.bin` (`~21.6 MiB` blobs, offsets up to `19.3 MiB`). Because Cloudflare Workers `env.ASSETS.fetch` ignores HTTP `Range` headers and returns HTTP `200`, each lookup streamed and discarded tens of megabytes of prefix bytes in JS.
3. **Cold `lemma-lookup` thrashing & unaligned buckets:** `lemma-lookup/shard-*.json.gz` (`~370 KiB` raw, `7,135` entries each) mixed with `MAX_LRU_SHARDS = 64` evicted shards across lookups; lowercase Strong's lookup keys (`"h0120"`) and uppercase profile keys (`"H0120"`) mapped to different 1024-buckets, forcing two `fast-profiles` shard reads per Strong's query.
4. **Double-JSON + recursive deep-clone security wrapper (`15–28 ms` on warm/cold):** `withCorpusSecurity` (`scripts/corpus-security.mjs`) re-parsed `corpusWorker`'s already-stringified JSON via `await res.json()`, recursively cloned every object/array in `__stripRestrictedFields()`, and called `JSON.stringify()` a second time — costing `~15 ms` even on 0-read warm cache hits.
5. **Retry amplification (`bible-mcp`):** Retrying HTTP `503`/`500` twice in `supabase/functions/bible-mcp/index.ts` turned single `exceededCpu` failures into `3x` Upstream Worker load alongside benchmark client retries (`164/168` sampled Worker events).

Rows 1–40 survived only because 11 consecutive duplicate queries and small-occurrence lemmas (`G1953`, `H0231`, `G3088`) gave Cloudflare's isolate burst bucket intermittent recovery room; rows 41–60 had no consecutive duplicates and repeatedly hit the 10 ms hard cap.

### 2. Offline Repacking & Runtime Changes Deployed (Zero Algorithm Changes)

Discovery ranking weights, graph edges, candidate generation, semantic-hop rules, provenance, restrictions, and external semantic datasets were **NOT** modified.

- **Idempotent offline asset repacking (`scripts/pack-r12-cpu-safe-assets.mjs` on `.artifacts-r12/staging-bundle`):**
  - Preserved exact `20,000 / 20,000` static files (`max_individual_file_bytes = 22,131,013 <= 25 MiB`) and kept all existing R3–R11 files (`packed-discovery-0..7.bin`, `lemma-lookup/*`, `lemma-profiles/*`, `orthographic/*`, `r12-pilot.json.gz`) intact on disk.
  - Enriched each of the `19,566` `LemmaProfile`s with pre-hydrated `first_occ_passages` (up to 25), `orth_entry` (`3,898`), and compacted `r12_pilot_anchor` (`48` anchors; verified `pilot_compaction_parity: PASS` across `1,152` multihop paths, `68` bridges, `239` structural parallels, `276` orthographic candidates).
  - Repacked `1,024` `fast-profiles/shard-*.json.gz` as `r10-b64gz-1` co-locating Strong's `/^[hg]\d{4}$/` lookup keys into their uppercase profile bucket (`strongs_lookup_upper_bucket: true`, `16,384` sub-buckets across `456,129` entries), `488` `fast-verses/chunk-*.json.gz` (`31,203` summary tuples + base64-gz full verses), and `66` `evidence-passages/book-*.json.gz` (`r10-book-index-1`).
  - Filtered `explicit-and-typology.json.gz` (`169 -> 24` records, `22,076` B gz), repacked `motifs-and-patterns.json.gz` as `r10-lazy-motifs-1`, and embedded `motifs_event_keywords` (`524` entries) + `r12_pilot_embedded: true` in `fast-manifest.json.gz` (`6,314` B gz).
- **Runtime & Worker caching (`src/relationships/r10-discovery.ts`, `src/relationships/adjacency-loader.ts`, `scripts/corpus-worker.mjs`, `scripts/corpus-relationships-rpc.mjs`):**
  - Added `direct_b64gz` per-entry decoding with native `Buffer.from(b64, 'base64')` + `gunzipSync`, pinned the immutable R10 metadata files in `pinnedBaseCache`, raised `MAX_LRU_SHARDS` to `256` (`16 MiB`), skipped `motifs-and-patterns.json.gz` unless a motif/event keyword matches, and fast-pathed `normalizeNumberPhrases`.
- **Zero-copy security pass-through (`scripts/corpus-security.mjs`):**
  - Registered `jsonResponse()` text via `registerFastJsonText` and bypassed double `JSON.parse` + recursive `__stripRestrictedFields` when `!__restrictedKeyPattern.test(rawText)`, while still parsing & redacting any response containing restricted keys (`semantic_frame`, `frame`, `greekstrong`, `sdbh`, `lexdomain`, `coredomain`, `contextualdomain`, `domain`, `ln`, `field_name`) or `\u00` escapes.
- **MCP gateway retry policy (`supabase/functions/bible-mcp/index.ts`):**
  - Removed HTTP `503` and `500` retries for `discover_biblical_connections_v1` and `discover_biblical_connections_v2` (`retryableCorpusStatuses = [502, 504]`), eliminating retry amplification while preserving all `46` tools (including all note tools), `22` prompts, auth, and `writes: "enabled"`.

### 3. Live Deployment Identifiers

| Service | Previous Baseline | New Live Production | Notes |
|---|---|---|---|
| **Corpus Worker (`bibleresearch-corpus`)** | Version `7f51d378-ecef-4022-bcbc-94123397c6ec` | Version **`cf2182ed-b3fc-4ab6-99ab-5590e7e8a075`** | `https://bibleresearch-corpus.kingdomfishers-custom.workers.dev`; release `r12-discovery-1`; `20,000` files |
| **Static Bundle (`R12_ASSET_SHA256`)** | `c23272125b34f179237e1c61381ec0b3b92e282f6ae496194bf994` | **`a0715c17a2641b6acf0053695dd9aeb2c153400c71d730ee00201e4a06ccd17b`** | `packed_full_responses=0` across all 44 baseline cases |
| **Main MCP (`bible-mcp`)** | Version **`42`** (`ea4402c3...`) | Version **`43`** (`ezbr_sha256: 55efd6c339b458fa2ca146cc991005c703518a561d2aad3e605cfd9392ae3824`) | `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`; `ACTIVE`, `verify_jwt: false`, `46` tools, `22` prompts, `writes: "enabled"` |

### 4. Local Parity, Security & `workerd` Verification

- `npm.cmd run check:types`: **PASS** (`exit 0`) | `npm.cmd run build`: **PASS** (`exit 0`, 104 modules) | `verify-r12-smoke.mjs`: **PASS** (`5/5`) | `verify-r12-packed-loading.mjs`: **PASS**.
- **44/44 Regression Parity (`scripts/verify-r12-cpu-parity.mjs`, `.artifacts-r12/reports/cpu-parity-2026-11-18T22-51-34-053Z/report.json`):** **`44/44` PASS (`0` diffs)** against `batch_001_020.json`, `batch_021_040.json`, `batch_041_060.json`; `packed_full_responses_total = 0`; `packed_stream_bytes_total = 0`.
- **Security Redaction Regression (`security_check.passed`):** **`PASS`** (`clean_registered_bypass`, `registered_restricted_redaction`, `unregistered_escaped_redaction`).
- **Local `workerd` `1.20261116.1` CPU/IO (Intel Core i7-8650U @ 1.90 GHz with `50 us` V8 Inspector sampling overhead):**
  - Cold isolates: Strong's (`H0120`, `G3088`, `H5869`, `H1285`) dropped to **`4` reads** (`414–506 KiB`, `motifs_skipped: true`; `47.2–175.4 ms` laptop sampled CPU, `48.7–184.8 ms` wall); `Genesis 1:1` `10` reads (`1,215 KiB`, `216.9 ms` CPU), `Exodus 12:15` `11` reads (`1,314 KiB`, `162.1 ms` CPU).
  - Warm isolate / unseen queries (warmed only with `H0120`): unseen Strong's (`G3088`, `H5869`, `H1285`) did **`1` read** (`299–392 KiB`, `31.3–46.9 ms` sampled CPU, `35.1–50.8 ms` wall); `Genesis 1:1` `7` reads (`107.1 ms` CPU), `Exodus 12:15` `8` reads (`76.8 ms` CPU).
  - Warm repeat (`0` reads, `0` decoded B): `7.1–38.8 ms` sampled CPU (includes GC / Inspector overhead; unprofiled repeat wall `11.9–29.6 ms` on Strong's, `19.1–23.7 ms` on `Gen 1:1`/`Exod 12:15`; `__stripRestrictedFields` `0 ms`).

### 5. Live Production Smoke Test & Parity (Serial, Concurrency 1)

- **Worker Security & Integrity:** `/__integrity/b7` HTTP `200` (`PASS_CANARIES`, `worker_version: cf2182ed-b3fc-4ab6-99ab-5590e7e8a075`, `asset_sha256: a0715c17a2641b6acf0053695dd9aeb2c153400c71d730ee00201e4a06ccd17b`); `/v1/catalog/metadata.json.gz` HTTP `403` (`raw_corpus_asset_access_disabled`).
- **MCP `/health` & `tools/list`:** HTTP `200`, `46` tools registered (note tools & `discover_biblical_connections_v2` present), `22` prompts, `writes: "enabled"`, `corpus_target: "production"`.
- **Pass 1 Direct Corpus Worker (`discover_biblical_connections_v2`, `{ limit: 25, max_hops: 5, mode: "discover" }`):**
  - `H0120`: HTTP `200` (`761.5 ms`, `25` returned / `49` total)
  - `G3088`: HTTP `200` (`566.4 ms`, `25` / `31`)
  - `H5869`: HTTP `200` (`463.9 ms`, `25` / `57`)
  - `H1285`: HTTP `200` (`228.9 ms`, `25` / `43`)
  - `Genesis 1:1`: HTTP `200` (`1577.5 ms`, `25` / `177`)
  - `Exodus 12:15`: HTTP `200` (`1651.2 ms`, `25` / `196`)
- **Pass 1 Live MCP `tools/call` (`discover_biblical_connections_v2`):**
  - `H0120` `200` (`377.3 ms`), `G3088` `200` (`181.4 ms`), `H5869` `200` (`125.1 ms`), `H1285` `200` (`124.7 ms`), `Genesis 1:1` `200` (`225.3 ms`), `Exodus 12:15` `200` (`244.6 ms`).
- **Evidence Checks (`get_connection_evidence_v1` via live MCP):**
  - `r12:path:H5869:G0457`: HTTP `200` (`726.3 ms`, `status: "ok"`, `predicate: "multihop_proof_path"`, passages returned)
  - `r12:prop:G3088:H5216`: HTTP `200` (`694.3 ms`, `status: "ok"`, `predicate: "shared_external_property"`, passages returned)
- **Live Parity (`H0120` `L001`, `G3088` `L027`, `H5869` `L011`, `H1285` `L006`):** **`4/4` exact match (`0` diffs)** against `research/r12/live_mcp_results_2026-11-18/current/batch_*.json`.
- **Pass 2 Second Serial Live MCP Sample:**
  - `H0120` `200` (`124.2 ms`), `G3088` `200` (`94.5 ms`), `H5869` `200` (`129.0 ms`), `H1285` `200` (`222.7 ms`), `Genesis 1:1` `200` (`102.3 ms`), `Exodus 12:15` `200` (`115.7 ms`).
  - **Result:** `0` HTTP `503`, `0` HTTP `500`, `0` `exceededCpu`, `0` timeouts across all 22 live requests.

### 6. Honest Remaining Limitations & Benchmark Resumption

- This short serial live smoke test verifies end-to-end live recovery on the 6 smoke queries and 2 evidence lookups, **not** an exhaustive 239-query guarantee under Cloudflare Workers Free Plan's **10 ms hard CPU limit**: cold multi-lemma passage queries (such as `Genesis 1:1` / `Exodus 12:15`, which read `10–11` compressed shards on a fresh isolate) still consume more CPU on cold misses than single-Strong's queries (`4` cold reads / `1` warm-unseen read). If long serial batches encounter isolated cold `exceededCpu` events under Free-tier throttling, further splitting `fast-profiles` lookup sub-buckets or upgrading the Worker CPU tier may still be warranted.
- **For ChatGPT — Resume the Frozen 239-Case Benchmark:**
  - Definition file: `research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json`
  - Existing partial baseline (`60` attempted: `44` saved observations + `16` prior `TOOL_ERROR` + `179` untested): `research/r12/live_mcp_results_2026-11-18/current/` (`manifest.json`, `batch_001_020.json`, `batch_021_040.json`, `batch_041_060.json`, `review-matrix.csv`, `review-matrix.json`).
  - Resume serially (`concurrency: 1`) against `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp` for the 16 prior `TOOL_ERROR` cases and 179 `NOT_RUN_CPU_BLOCK` cases while keeping all benchmark definitions frozen.
