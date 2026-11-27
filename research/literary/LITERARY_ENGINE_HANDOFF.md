# Literary Structure Discovery Engine — Integration & Optimization Handoff

## 1. Architecture & Evidence Channels

The Literary Structure Discovery Engine shares a single deterministic Pure-TypeScript/ESM core across **Browser UI**, **Supabase MCP (`bible-mcp`)**, and **Static Precomputation**:

- **Core Algorithms ([literary-structure.mjs](file:///C:/Projects/BibleResearch-r10/src/relationships/literary-structure.mjs), [literary-structure.d.mts](file:///C:/Projects/BibleResearch-r10/src/relationships/literary-structure.d.mts))**
  - **Sequence Alignment**: Gotoh 3-state affine-gap alignment (`gapOpen = -0.4`, `gapExtend = -0.2`, `mismatchPenalty = -2.2`, `type:` slot incompatibility gating, backward-compatible linear-gap fallback).
  - **Multi-Medoid MDL Template Induction**: Top-3 fast key-multiset medoid evaluation ranked by two-part Minimum Description Length (MDL) savings, classifying slots as `core`, `optional`, `variable`, `repeated`, `emerging`, or `rare`, and reconciling paired `omission` + `addition` deviations into `reordering` shifts.
  - **Global Non-Crossing Chiasm & Symmetry DP**: Single global $O(N \cdot W^2)$ non-crossing dynamic program (`maxWindow = 32`), comparing reverse symmetry against forward parallelism and filtering by IDF content salience (`>= 2` keys with `IDF >= 0.5`).
  - **Self-Similarity Novelty Change-Point Detection**: Checkerboard-kernel novelty curve over sliding token windows (`detectNoveltyBoundaries`).
- **Multi-Edition Discovery Engine ([literary-engine.ts](file:///C:/Projects/BibleResearch-r10/src/relationships/literary-engine.ts), [literary-types.ts](file:///C:/Projects/BibleResearch-r10/src/relationships/literary-types.ts))**
  - Supports **STEP Hebrew/Aramaic OT (`hbo`)**, **Greek NT (`grc_nt`)**, and **Swete LXX comparison** (`hebrew_lxx_verse_map` + embedded `lxx_verses` / `lxxWords`).
  - Preserves exact occurrence IDs (`${edition}:${verseId}:${pos}`), STEP disambiguated `lemma_key` vs explicit `strongs_fallback` (never collapsing homographs), `morphhb_tokens.cantillation`, Masoretic `פ`/`ס` breaks, and MACULA syntax predicate–role frames & modifier pairs without accessing or exposing any restricted fields.
  - Combines **multi-signal segmentation** (terminal formulas, Hebrew `פ`/`ס` and Greek `¶` paragraph markers, opening-formula and connective-skipping anaphora alignment, proposal merging for `opening_closing_agreement` and `opening_paragraph_agreement`, `phase_shifted_cycle` for internal-motif refrains such as Psalm 107:4–32, `partial_opening_refinement` for antithetical/opening series such as Matthew 5:21–48, SSM novelty change-points, and un-anchored prose penalization) with **introduction / unit sequence (with nested subunits) / conclusion transformation**.
  - Induces **typed variable slots** (`slot:var:proper_noun`, `slot:var:number`) and filters connective clutter (`H3588`, `H518`, `G3754`, `G1063`) so genealogies (Genesis 5) and tribal inventories (Numbers 7) separate constant structural formulas from variable names/numbers without mis-segmenting exceptions (such as Enoch in Gen 5:21–24).
  - Detects **deviations** (`omission` with token-level reconciliation against partial MACULA coverage, `addition`, `substitution`, contiguous multi-unit `reordering` regime shifts via medoid-invariant signature-motif ordering, stricter root-matched head+modifier `intensification`, `person_shift` across direct speech, `emerging_motif`, `conclusion_transformation`) separated from loose-list suppression.
  - Discovers **command → fulfillment** pairs, **cross-unit correspondences** (residual TF-IDF cosine, e.g., Genesis Days 1↔4, 2↔5, 3↔6), **relational & analogical frames** (`Analogical comparison`, `Paired opposing series`, `Shared role`, `Root family`), **symmetries** (`chiasm` with non-adjacent/rare-token/distinct-key gating, `concentric`, `inclusio`, `forward_parallelism`, `antithetical_parallelism`, multi-link `progressive_parallelism`), **R13 wordplay** ([wordplay-engine.ts](file:///C:/Projects/BibleResearch-r10/src/relationships/wordplay-engine.ts)) with Hebrew Q&A/prophetic echo & geographical paronomasia cues and UTF-16 `matchedCharIndices` letter highlights, **acrostics** (verse-initial, 2/8-verse stanza, cantillation half-verse/atnach), **Leitwörter** & observed notable counts, **speaker shifts**, **thematic clusters**, and engine-owned **`patternFamilies`** (`LiteraryPatternFamily[]` with continuous phrase/clause spans and `defaultVisible` curation).
  - Maintains explicit epistemic separation across `exact_form`, `resolved_lemma`, `broad_strongs`, `orthographic`, `grammatical`, `semantic`, and `interpretive_hypothesis`.
- **Cloudflare Workers Free-Tier Resolution ([build-literary-chunks.mjs](file:///C:/Projects/BibleResearch-r10/scripts/build-literary-chunks.mjs), [literary-pack-loader.ts](file:///C:/Projects/BibleResearch-r10/src/relationships/literary-pack-loader.ts))**
  - Precomputes `64` gzipped per-chapter packed blobs (`pack-00.bin`..`pack-3f.bin`) + `index.json` (`1,189` chapters, `31,203` verses, `31,145` with MACULA clauses; max record `79.4 KB` gz; max pack `544.5 KB`; total `23.97 MB`; zero restricted keys).
  - Hosted under `dist/v2/literary/` on `bibleresearch` (`81` total static assets vs Cloudflare Free Tier's `20,000`-asset cap on `bibleresearch-corpus`, `0 ms` Worker CPU), allowing Browser JS ([rpc.ts](file:///C:/Projects/BibleResearch-r10/src/api/rpc.ts)) and Supabase Edge `bible-mcp` ([research-engine.ts](file:///C:/Projects/BibleResearch-r10/supabase/functions/bible-mcp/research-engine.ts)) to run the full engine directly at zero Worker CPU cost.

---

## 2. Benchmark, Tests, and Ablations

### Unit & Integration Suites
- `node --test research/literary/algorithms.test.mjs research/literary/hebrew.test.mjs research/literary/engine.test.mjs`: **27/27 pass** (`0` fail, `0` skipped; `7739.07 ms`), covering Genesis 1:1–2:3 (intro, 6 days, Sabbath transformation, deviations, correspondences, LXX Gen 1:8), Acrostics (Ps 111, Prov 31, Ps 119), NT (Matt 5:3–12, John 1:1–18), Chiasms & Wordplay letter highlights, Revelation 2–3 (7 churches + `opening_closing_agreement` + Smyrna/Philadelphia `G3340` omissions + `G3775`/`G3528` 3+4 flip), Diverse templates (Matt 23, Deut 27, Ps 42–43, Num 7, Isa 5), and **Genealogies, phase-shifted cycles, analogies, paronomasia, and `patternFamilies` spans**.

### Development, Held-Out, and Negative Control Benchmark ([benchmark.mjs](file:///C:/Projects/BibleResearch-r10/research/literary/benchmark.mjs))
- **DEV (21/21 pass)**: Genesis 1:1–2:3, Psalm 136:1–12, Amos 4:6–11, Genesis 9:6, Jeremiah 1:11–12, Genesis 2:7, Psalm 119:1–24, Matthew 5:3–12.
- **HELDOUT (37/37 pass)**: Genesis 11:1–9, Psalm 111:1–10, Proverbs 31:10–31, Isaiah 6:10, Amos 1:3–2:6, Psalm 23:1–6, John 1:1–18, 1 Corinthians 13:1–13, Psalm 1:1–6, **Revelation 2:1–3:22** (`7` churches), **Revelation 16:1–21** (`16:1` intro + `7` bowls), **Deuteronomy 27:15–26** (`12` curses), **Psalm 42:1–43:5** (`3` refrain stanzas), **Numbers 7:12–35** (`4` tribal days), **Isaiah 5:8–23** (`6` woes), **Matthew 23:13–33** (`7` woes), **Genesis 5:1–32** (`9` genealogical units + Enoch deviation), **Psalm 107:4–32** (`4` phase-shifted deliverance cycles), **Matthew 5:21–48** (`6` antithetical teachings), Isaiah 55:1–13, Ecclesiastes 3:1–8, Amos 8:1–2 (prophetic Q&A wordplay), Micah 1:10–15 (geographical paronomasia), Mark 2:27 (reversal), Lamentations 1:1–22 (acrostic + stanzas), Psalm 19:1–14, Romans 8:31–39 (rhetorical Q&A).
- **NEGATIVE CONTROLS (6/6 pass)**: Genesis 5:1–20, Numbers 33:1–15, Romans 16:3–15.
- **Runtime**: Full **64-check** benchmark (`21` DEV + `37` HELDOUT + `6` NEGATIVE): **`64/64 pass`**, median `74.33 ms`, max `705.56 ms` (Genesis 1:1–2:3 `705.56 ms`, Revelation 2:1–3:22 `619.99 ms`).

---

## 3. Website & MCP Integration

- **Website UI ([LiteraryStructurePanel.ts](file:///C:/Projects/BibleResearch-r10/src/ui/components/LiteraryStructurePanel.ts), [VerseReader.ts](file:///C:/Projects/BibleResearch-r10/src/ui/components/VerseReader.ts), [styles-literary.css](file:///C:/Projects/BibleResearch-r10/src/ui/styles-literary.css))**:
  - **Pattern-Family-First Highlighting**: Highlights meaningful recurring phrases, clauses, and literary functions as continuous spans (`.lit-span--start` / `mid` / `end`) driven by engine-owned `patternFamilies`, rather than noisy per-word keyword badges. Individual `Repeated keywords` and `Exploratory` toggles live inside a collapsed `<details class="lit-settings">` drawer and default to **OFF**.
  - **Visual Hierarchy & Accessibility**: Uses subtle `color-mix(in oklab, ...)` tinted bands paired with non-color deviation glyphs (`✦`, `∅`, `⇄`), nested subunit indicators, `@media (forced-colors: active)` system fallbacks, compact capped deviation gap pills (max `1` high-surprisal `>= 1.5` pill per chapter verse row, wrapped cleanly below full-width `.lit-chap-tokens`), and letter-level `<mark class="lit-wp-char">` wordplay highlights.
  - **Interactive Exploration**: Compact **Pattern Family Legend** supports hover dimming (emphasizing all corresponding occurrences across the passage) and click isolation; clicking any highlighted span, gap pill, template cell, or chiasm arm opens the **Pattern Inspector** with clickable unit occurrences, literary function summary, deviations, and supporting linguistic evidence.
- **MCP Integration ([discovery-v2-tools.ts](file:///C:/Projects/BibleResearch-r10/supabase/functions/bible-mcp/discovery-v2-tools.ts), [research-engine.ts](file:///C:/Projects/BibleResearch-r10/supabase/functions/bible-mcp/research-engine.ts), [SKILL.md](file:///C:/Projects/BibleResearch-r10/skills/bible-research/SKILL.md))**:
  - Extended `get_Passage` with integer `literary?: 0 | 1 | 2` (flat `type: "integer"`, avoiding `anyOf`/`const` for strict JSON Schema connector compatibility; default `1` compact summary, `0` omit, `2` standard cells & alternatives) executed concurrently with compact passage & graph lookups.
  - Added `research` operation `op: "literary_structure"` backed by a flat `ResearchOpInputSchema` (`type: "object"`, zero top-level `oneOf`/`anyOf`/`allOf`), returning curated `pattern_families` alongside `detail: "compact" | "standard" | "deep"`, `categories`, `compare_lxx`, `include_alternatives`, and `min_strength`.
  - Updated [SKILL.md](file:///C:/Projects/BibleResearch-r10/skills/bible-research/SKILL.md), [tool-contracts.md](file:///C:/Projects/BibleResearch-r10/skills/bible-research/references/tool-contracts.md), and regenerated [research-workflow.ts](file:///C:/Projects/BibleResearch-r10/supabase/functions/bible-mcp/research-workflow.ts) via `scripts/build-research-plugin.mjs`.

---

## 4. Deployments, Live Verification, and Remaining Limitations

| Target | Live URL / Project | Deployed Version / Notes |
|---|---|---|
| Website (`bibleresearch`) + `/v2/literary/` CDN | `https://bibleresearch.kingdomfishers-custom.workers.dev` | Version ID `dd70c1f9-1afb-4db4-9b41-13ecda578c3c` (`81` static assets) |
| Corpus Worker (`bibleresearch-corpus`) | `https://bibleresearch-corpus.kingdomfishers-custom.workers.dev` | Version ID `b4a23c24-6e57-4489-b41c-3e8fa170df03` (`20,000` static assets) |
| MCP Server (`bible-mcp`) | `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp` | Project `ejoperxiwxlcbsqrkrvb` (`tools=7` on `/mcp`, `prompts=1`) |

### Verified Live Checks
- CDN pack `/v2/literary/index.json` (`1,189` chapters) and live Website `/` return HTTP `200`, serving `/assets/index-D-wok4sW.js` and `/assets/index-CoTJrPo0.css`.
- Live Browser Visual Verification (`dd70c1f9-1afb-4db4-9b41-13ecda578c3c` on `https://bibleresearch.kingdomfishers-custom.workers.dev`):
  - **Desktop (`1280×800`, Revelation 2:1)**: Full-width `.lit-chap-tokens` (`743–746 px` inside `762 px` row) cleanly stacked beneath English verse text; `.lit-chap-gap-pill` chips single-line (`20 px` height, `153–209 px` width, clean ellipsis); Pattern Legend + click-to-inspect Pattern Inspector + collapsed Settings (`Keywords` OFF by default).
  - **Mobile (`390×844`, Genesis 1:1)**: Zero horizontal overflow (`375 px <= 390 px`), full-width RTL Hebrew continuous phrase bands (`303–306 px` inside `322.61 px` row), unclipped single-line deviation chips (`20 px` height, e.g., `∅ omission: H8064` `102.68 px`, `⇄ reordering: יוֹם (day, H3117) → עֶ֫ר…` `185.53 px`), collapsed Settings.
- Live MCP (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`):
  - `tools/list` schema verified clean (`get_Passage.literary` `type: "integer"`, `research.operations.items` flat `type: "object"`, zero `oneOf`).
  - Live `research` `op: "literary_structure"` verified HTTP `200`, `status: "ok"`, exact unit boundaries, `pattern_families`, and zero restricted MACULA keys across 9 passages (`Genesis 1:1-2:3`, `Genesis 5:1-32`, `Psalm 107:4-32`, `Matthew 5:21-48`, `Amos 8:1-2`, `Micah 1:10-15`, `Ecclesiastes 3:1-8`, `Romans 8:31-39`, `Revelation 2:1-3:22`), plus `get_Passage` (`Gen 1:1-2:3` `literary: 1`, `Rev 2:1-29` `literary: 2`).

### Remaining Limitations
1. Direct calls to `bibleresearch-corpus.kingdomfishers-custom.workers.dev/v1/rpc/get_literary_source_v1` or `analyze_literary_structure_v1` hit HTTP `500` because Cloudflare blocks subrequests from one `*.workers.dev` Worker to another same-account `*.workers.dev` hostname (`bibleresearch`), and Cloudflare Free Tier limits (`20,000` static assets / `10 ms` Worker CPU) prevent co-locating `v2/literary/` or parsing full legacy `3.25 MB` chapter shards inside `bibleresearch-corpus`. Adding a custom domain or Cloudflare Service Binding to `bibleresearch` resolves this cleanly whenever needed; both Website and MCP (`bible-mcp`) bypass `bibleresearch-corpus` and load directly from `bibleresearch/v2/literary/`.
2. Verse ranges across multiple chapters are capped at `55` verses (`176` verses for single-chapter ranges) with explicit `coverage.truncated = true` signaling.

---

## 5. Example MCP Queries (`POST https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`)

Headers: `Content-Type: application/json`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2025-11-25`

### 1) Compact passage read with inline literary summary (`get_Passage`)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_Passage",
    "arguments": {
      "passage": "Gen 1:1-2:3",
      "literary": 1,
      "depth": 2
    }
  }
}
```

### 2) Deep literary structure + MT vs Swete LXX comparison (`research`)
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "research",
    "arguments": {
      "operations": [
        {
          "op": "literary_structure",
          "passage": "Genesis 1:1-2:3",
          "detail": "standard",
          "compare_lxx": true,
          "include_alternatives": true
        }
      ]
    }
  }
}
```

### 3) Multi-passage batch: Chiasm + Wordplay + Acrostic + NT Template (`research`)
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "research",
    "arguments": {
      "operations": [
        { "op": "literary_structure", "passage": "Genesis 9:6", "detail": "standard" },
        { "op": "literary_structure", "passage": "Psalm 111:1-10", "detail": "standard" },
        { "op": "literary_structure", "passage": "Matthew 5:3-12", "detail": "standard" }
      ]
    }
  }
}
```
