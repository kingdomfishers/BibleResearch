# Pre-v3 Live MCP & No-MCP Research Baseline Summary (`B1`–`B6`)

**Recorded:** 2026-11-25 against live `bible-mcp` (`2.0.0`, `v2-discovery` at `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`) and `bibleresearch-corpus` (`r13-discovery-3`, `df1a9bf4-176b-4f26-a987-47539b745d28`), plus matched No-MCP control researchers (`inherit` model across both arms).

## 1. Quantitative Live v2 MCP Telemetry (`live_B1..B6.jsonl`)

| Session | Domain | Tool Calls | Errors | 2× `structuredContent` Dupes | Median Latency | Max Latency | Total Payload | Total Wire | Max Single Call Wire |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **B1** | Wordplay, names & contrasts (`Mic 1:10-15`, `Phlm 1:8-21`) | 14 | 0 | 14 / 14 | 3,269 ms | 7,875 ms | 534.7 KB | 1,134.3 KB | 273.8 KB |
| **B2** | Cross-testament `MT↔LXX↔NT` (`Isa 28:16`, `Isa 8:14`, `Ps 118:22`, `Hab 2:4`) | 13 | 1 | 12 / 12 | 4,065 ms | 9,152 ms | 455.5 KB | 968.6 KB | 168.4 KB |
| **B3** | Literary structure & de-creation (`Amos 1:3-2:16`, `Gen 1 ↔ Jer 4:23-26`) | 12 | 0 | 12 / 12 | 4,008 ms | 6,376 ms | 1,615.7 KB | 3,441.6 KB | 1,261.6 KB |
| **B4** | Physical processes: metallurgical refining | 13 | 0 | 13 / 13 | 4,493 ms | 9,059 ms | 474.9 KB | 1,003.2 KB | 145.6 KB |
| **B5** | Scene parallels & inversion (`Judg 19 ↔ Gen 18-19`, `Matt 4 ↔ Deut 6-8`) | 14 | 0 | 14 / 14 | 5,044 ms | 6,393 ms | 1,813.2 KB | 3,872.9 KB | 893.5 KB |
| **B6** | Obscure passage bridges (`2 Kgs 2:19-22`) | 12 | 0 | 12 / 12 | 4,309 ms | 14,077 ms | 652.3 KB | 1,366.8 KB | 460.3 KB |
| **TOTAL / MEDIAN** | **6 Open-Ended Research Sessions** | **78** | **1** | **77 / 77 (100%)** | **~4,187 ms** | **14,077 ms** | **5,546.3 KB** | **11,787.4 KB** | **1,261.6 KB** |

## 2. Qualitative Comparison & Key Architectural Bottlenecks Confirmed Live

### What Live v2 MCP Enabled Beyond No-MCP
- **Exact lexical/corpus intersections & distributions:** `B1` verified Micah toponyms via LXX semantic translations & STEP root anchors; `B3` proved `H0922` (`בֹהוּ`) occurs in exactly 3 OT verses (`Gen 1:2`, `Isa 34:11`, `Jer 4:23`); `B4` traced `סִיג ↔ ἀδόκιμον` & `כֶּסֶף נִמְאָס ↔ ἀποδεδοκιμασμένον` across Swete LXX; `B5` isolated `סָעַד+לֵב` (2 OT vv: `Gen 18:5; Judg 19:5`), `לוּן+רְחֹב` (3 OT vv), `בְּלִיַּעַל+עִיר` (3 OT vv: `Deut 13:13; Judg 19:22; 1 Kgs 21:13`), `לֶחֶם+מַיִם+אַרְבָּעִים` (3 OT vv); `B6` proved `צְלֹחִית` (`H6746`) is a hapax, `רָפָא+מַיִם` occurs in only 2 OT passages (`2 Kgs 2:21–22; Ezek 47:8–11`), and `שָׁלַךְ+מֶלַח` occurs only in `2 Kgs 2:21` and `Ezek 43:24`.

### Systemic Weaknesses Exposed Across `B1`–`B6`
1. **2× Wire Duplication & Payload Bloat:** `100%` of non-error calls duplicated JSON into `structuredContent`, inflating 6 sessions from `5.55 MB` payload to `11.79 MB` wire (up to `1.26 MB` in a single `B3` call). `get_Connection` in `B4` even emitted duplicate identical connection objects.
2. **Wordplay & Etymology Gaps (`B1`):** `literary_structure` mislabeled `Χριστοῦ ↔ ἄχρηστον/εὔχρηστον` as `documented_lexical_relationship`; `G3685` (`ὀνίνημι`), `G0890`, `G2173`, and `H8208` returned `etymology: unavailable`, missing `Ὀνήσιμος ↔ ὀναίμην` and `שָׁפִיר ↔ עֶרְיָה־בֹּשֶׁת`.
3. **MT↔LXX↔NT Alignment Gaps (`B1`, `B2`, `B3`, `B6`):** `lxx(compare)` misaligned `Isa 28:16` (`ἀκρογωνιαῖον ↔ בֹּחַן`, `πιστεύων ↔ מוּסָד`); `literary_structure(compare_lxx: true)` emitted `divergences: []` on `Mic 1:10–15` and `Isa 28 / Hab 2`; no 3-way `MT↔LXX↔NT` splice/attribution tool or Rahlfs Greek concordance (`lxx(alignments)` returned `0` for `G5201` in `B6`).
4. **False Chiasms & Missing Structural Sequence Alignment (`B3`, `B5`):** `literary_structure` flagged unit-level concentric chiasms centered on `Amos 1:11` (Edom) and `Gen 1:16` due to mechanical refrains; `compare_patterns` scored `structural_role_alignment: 0` on `Judg 19 ↔ Gen 18–19` and `passage_compare` failed on multi-chapter ranges.
5. **Missing Physical Process Bridges & Lookup Gaps (`B4`, `B6`):** `realworld=1` / `mode="bridge"` returned `unavailable` or empty physical properties for `H4417` (salt) and metallurgical terms (`H5509`, `H1253`, `H6884`); `"furnace"` locked onto Aramaic `H0861` only; `"pyroo"` returned `not_found`; `discover_patterns` emitted a corrupted `H0001` (`אָב` glossed `"silver"`).
6. **Multi-Hop `trace_evidence` & Passage-Window Gaps (`B5`, `B6`):** `trace_evidence` failed to bridge `2 Kgs 2:20 → Ezek 47:11` via passage references; `get_Connection` missed `1 Sam 11:7 ↔ Judg 19` and `H0922`/`H8414` in `verified_edges`; `intersect_words` returned `total_matches: 7` with `verses: []` on `H4161+H4325`.

## 3. Preserved Artifacts
- Logs: `research/v3/baseline/live_B1.jsonl` .. `live_B6.jsonl`
- Live MCP Reports: `research/v3/baseline/report_live_B1.md` .. `report_live_B6.md`
- No-MCP Reports: `research/v3/baseline/report_nomcp_B1.md` .. `report_nomcp_B6.md`
