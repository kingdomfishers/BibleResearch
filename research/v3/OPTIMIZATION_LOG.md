# BibleResearch v3 — Research-Driven Optimization Log (`V3-Opt`)

Authority: `C:\Projects\BibleResearch-r10` (`feat/r12-qa-fixes`).  
All research sessions below used independent blind `mcp_researcher` subagents (`Model: "flash"`, `scripts/mcp-bench-cli.mjs --target local --no-supabase`) with zero source-code access. `H1`–`H6` (`frozen_holdout`) remained untouched and unread throughout Cycles 1–2b.

---

## Cycle 1 — Blind Development Baseline (`D1`–`D4`)

Prompts from [EVAL_SETS.json](EVAL_SETS.json) (`development_optimization`):
- **D1:** Distributed clues & typology (`Genesis 38`, `Ruth 4`, `Matthew 1:1–6`)
- **D2:** Naming reversals & prophetic restoration (`Hosea 1–2`, `Joshua 7`, `Romans 9:25–26`)
- **D3:** Ritual material analogies & purification (`Leviticus 14`, `Numbers 19`, `Psalm 51`, `Hebrews 9`)
- **D4:** Prophetic narrative reversals & cosmic motifs (`Jonah 1–4`, `Psalm 107`, `Matthew 12:38–42`)

### Quantitative Telemetry (Cycle 1 Pre-Fix)
| Session | Calls | Errors | Duplicate Payloads | Total Wire (KB) | Max Call Wire (KB) | Max Call Latency (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `D1` | 18 | 1 | 1 (`get_prompt`) | 753.0 | 310.4 | 230,924 |
| `D2` | 16 | 1 | 1 (`get_prompt`) | 1,138.1 | 288.6 | 92,604 |
| `D3` | 22 | 1 | 1 (`get_prompt`) | 484.1 | 84.0 | 77,581 |
| `D4` | 17 | 2 | 1 (`get_prompt`) | 1,229.9 | 220.9 | 159,243 |
| **Total / Max** | **73** | **5** | **4** | **3,605.1** | **310.4** | **230,924** |

### Systemic Root Causes Diagnosed
1. **Stateless `follow_connectionchain` failure (`D1`, `D2`, `D4`):** Every CLI call spawned a fresh process without Supabase chain persistence, causing hop-1 `chain_not_found`.
2. **Schema strictness & clue ID gaps (`D1`, `D2`, `D4`):** Zod rejected `"limit"` on `research` ops and `"occurrences"` on `get_Word`; `expand_clue` returned `not_found` on `passage_lex_bridge:*` and `ctrl:*`; `trace_evidence` returned `ctrl:missing_concepts` on verse refs.
3. **`tri_textual_diff_v3` candidate retrieval & range truncation (`D1`, `D2`, `D3`, `D4`):** Capped NT range at 4 verses (`Matt 1:1–6` truncated at v.4); single high-df lemma matches crowded out genuine composite/OT sources (`Rom 9:25–26 -> Deut 30:16` over `Hos 2:23`; `Heb 9:19` missed `Exod 24:6–8`; `Matt 12:39–42` missed `Jonah 1:17` & `1 Kgs 10:1`).
4. **`get_Connection` early cycle termination & hub elevation (`D2`, `D3`):** Stopped after one spanning cycle, omitting `H0231`/`G5301` (`hyssop`) and `H5911` (`Valley of Achor`) while elevating formulaic `Moses`/`Aaron` hubs.
5. **Chapter/range `get_Passage` bloat & Worker CPU (`D1`–`D4` + `workerd` profile):** Range `get_Passage` bypassed `view="clues"` compaction (`30–160 KB`), `genealogy`/`literary_structure`/`occurrences` bloated batches to `230–310 KB`, `sequence_parallels_v3` emitted opaque `a_idx`/`b_idx` indices, `H6030` misglossed `"to dwell"`, `realworld=1` exposed raw `oewn:*` IDs, `lxx_concordance` silently truncated, and `workerd` CPU spikes hit `125.9 ms` (`sequence_parallels_v3`), `182.5 ms` (`discover_subgraph_v1`), and `37.1 ms` (`discover_biblical_connections_v2`).

---

## Cycle 1 Generalisable Fixes & Worker CPU Hardening

- **Stateless chain continuation & schema ergonomics (`discovery-v2-tools.ts`, `research-engine.ts`):** Added encoded `~v3c:` fallback handles on `follow_connectionchain`; removed duplicate payload on `get_prompt`; accepted `limit`/`occurrences`/`view`/`detail` across `get_Word` & `research`; enforced range `view="clues"` compaction (`Genesis 38`: `56.5 KB -> 12.4 KB`).
- **Precomputed sequence matrices & runtime caching (`v3-verifiers.ts`, `v3-binary-index.ts`, `v3-runtime-adapter.ts`, `r10-discovery.ts`, `subgraph-engine.ts`):** Integer-encoded clause tokens + precomputed float matrices before the 64-permutation loop (`sequence_parallels_v3` `125.95 ms -> 9.84 ms`); `WeakMap` shard caches & `EXP_Q16_LUT`; capped subgraph per-anchor fan-out (`discover_subgraph_v1` `182.47 ms -> 35.44 ms`, `discover_biblical_connections_v2` `37.07 ms -> 13.64 ms`).
- **Discovery & readability (`corpus-relationships-rpc.mjs`, `word-model.ts`):** Expanded `tri_textual_diff` to 16 verses with multi-lemma BMW + CSR XREF/LXX union + readable `ref_a`/`ref_b` in `sequence_parallels_v3`; paginated `lxx_concordance`; expanded `expand_clue` for `passage_lex_bridge:*` / `ctrl:*`; human-readable OEWN `realworld` labels; `H6030` `"to sing"` gloss fix.

---

## Cycle 2A — Matched Blind Retest (`D1`–`D4`)

| Session | Calls | Errors | Duplicate Payloads | Total Wire (KB) | Max Call Wire (KB) | Max Call Latency (ms) | Delta vs. Cycle 1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `D1` | 17 | 0 | 0 | 551.6 | 247.4 | 22,888 | `-1` err, `-26.7%` bytes, `-90.1%` max lat |
| `D2` | 17 | 0 | 0 | 805.9 | 316.8 | 16,614 | `-1` err, `-29.2%` bytes, `-82.1%` max lat |
| `D3` | 18 | 0 | 0 | 394.8 | 123.1 | 16,617 | `-1` err, `-18.4%` bytes, `-78.6%` max lat |
| `D4` | 18 | 0 | 0 | 808.9 | 188.3 | 19,043 | `-2` err, `-34.2%` bytes, `-88.0%` max lat |
| **Total / Max** | **70** | **0** | **0** | **2,561.2** | **316.8** | **22,888** | **`5 -> 0` err, `4 -> 0` dup, `-29.0%` wire** |

Key qualitative recoveries: stateless `~v3c:` 2-hop chains succeeded on every prompt; `tri_textual_diff` recovered `Exod 24:6–8 + Lev 14:51` on `Heb 9:19` (`D3`), `Jonah 2:1` on `Matt 12:40` (`D4`), and `1 Chr 2:3–4 + Ruth 4:12,19` on `Matt 1:3` (`D1`); `get_Connection` proved the `H5911` `Valley of Achor` triangle (`Hos 1–2 <-> Josh 7 <-> Rom 9:25–26`) and 4-passage `Lev 14/Num 19/Ps 51/Heb 9` cycle; `realworld=1` displayed human-readable labels.

---

## Cycle 2B — Fresh Cross-Domain Validation (`V1`–`V4`)

Untested fresh prompts from [VALIDATION_PROMPTS.json](opt-cycle2/VALIDATION_PROMPTS.json) (never `H1`–`H6`):
- **V1:** Structural decreation inversion (`Jeremiah 4:23–26`, `Genesis 1:1–2:3`, `Isaiah 24:1–12`)
- **V2:** Greek & Hebrew wordplay/status reversal (`Philemon 1:8–21`, `Genesis 27:30–40`, `Isaiah 62:1–5`)
- **V3:** Botanical process metaphors (`Romans 11:16–24`, `Isaiah 5:1–7`, `Jeremiah 11:16–19`, `Psalm 80:8–16`)
- **V4:** Distributed shepherd-king pattern (`Ezekiel 34:1–16`, `Zechariah 11:4–17`, `Micah 5:1–6`, `John 10:1–18`)

| Session | Calls | Errors | Duplicate Payloads | Total Wire (KB) | Max Call Wire (KB) | Max Call Latency (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `V1` | 19 | 1 | 0 | 468.9 | 115.2 | 12,306 |
| `V2` | 18 | 0 | 0 | 601.4 | 193.2 | 20,718 |
| `V3` | 18 | 0 | 0 | 432.0 | 165.5 | 20,657 |
| `V4` | 18 | 1 | 0 | 1,280.4 | 573.9 | 31,349 |

### Generalization Wins & Residual Systemic Findings (Resolved in Cycle 2b)
- **Wins:** Recovered rare cross-book intersections (`בֹהוּ` `H0922` 3 OT vv + `Ezek 38:20` + `Hos 4:3` `14.37 bits` on `V1`; `Ὀνήσιμος`/`ἄχρηστος`/`εὔχρηστος`/`ὀναίμην`, `בְּעוּלָה`/`תִּבָּעֵל`, `H2657` on `V2`; `Num 15:20` + `Jer 11:16` `הֲמוּלָּה -> περιτομή` on `V3`; unique `H7462+H7495+H7665` `Ezek 34:4 & Zech 11:16` + `Jer 19 -> πολυάνδριον -> Matt 27` on `V4`).
- **Residual systemic issues resolved in Cycle 2b:**
  1. `expand_clue` extended for `passage_lxx:*`, `shared_lemma:*`, `r13:proof:*`, `r13:subgraph:path:*`, `lxx:*`, `lex:*`, etc. (0 `not_found` handles).
  2. `lxx_concordance_v3`: added `G...` NT Strong's resolution (`G0890 -> ἄχρηστος`, `G4166 -> ποιμήν`, `G1461 -> ἐγκεντρίζω`), filtered Greek conjunction stopwords (`H5137 -> ῥαίνω`, fixing `καί`), raised range cap `12 -> 24..30` with explicit `{ total_verses, returned_verses, truncated, remaining_refs }`.
  3. `tri_textual_diff_v3`: diacritic-aware BMW proper names (`Βηθλεεμ`, `Ιουδα`), copula `G1510 εἰμί` stopwording + rare-particle weighting (`ὡσεί`) fixing `Matt 2:6 -> Mic 5:2`, `Matt 27:9–10 -> Zech 11:13`, `Matt 9:36 -> Num 27:17`; removed `no_alignment` bloat; added monotone `repairV3VerseToks` fixing `1 Pet 5:2` `ἐπισκοποῦντες` NT token shift.
  4. MCP schema & compacting: `ref`/`strongs` parameter aliases, `wordplay_scan` `a`/`b` passage validation, default `"clues"` array caps on `literary_structure`/`trace_evidence`/`lxx_concordance`, whole-range TF-IDF anchor selection for multi-verse `follow_connectionchain("Ezekiel 34:1-16")`.
  5. Lexicon hygiene: `H7462` (`רָעָה`) restored against leaked `בֵּית־עֵ֫קֶד הָרֹעִים`, filtered Swete `G0065 <-> H6501/H6171` artifact, and downweighted `count <= 4` `H7462 -> γινώσκω` homograph noise.

### Post-Cycle-2b Plateau Verification
- `npm.cmd run check:types`: **PASS (exit 0)**
- `npm.cmd run build`: **PASS (exit 0, `1.29s`)**
- `node --test research/v3/s4-discovery-verifiers.test.mjs research/v3/s5-mcp-v3.test.mjs`: **11/11 PASS** (`G4.1`–`G4.4`, `M1`–`M7`)
- `node scripts/eval-r13-discovery.mjs`: **32/32 PASS** (`MRR: 0.9712`, `recall: 1`, `negative_control_rejection_rate: 1`)
- `node scripts/verify-r12-worker.mjs --mode v3`: **PASS (exit 0)** (`0` HTTP errors, `0` HTTP `1102`; `v3_cpu_handler_per_req_p50_ms: 2.585 ms`, `p95: 8.294 ms`)
- `node scripts/verify-corpus-security.mjs`: **PASS (`19` assertions, `0` restricted keys)**
