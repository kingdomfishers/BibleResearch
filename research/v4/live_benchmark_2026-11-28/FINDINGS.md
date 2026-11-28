# V4 live discovery benchmark — 2026-11-28

## Scope and headline result

Read-only independent ChatGPT test of the connected production MCP. V4 evidence IDs were observed; exact deployed commit was not independently pinned. All 190 distinct queries for the 239 frozen expectations were executed (215 positives, 24 negatives). 188 status ok, 2 partial (Leviticus 16:15 and Isaiah 26:19), no hard errors. X240 is an additional post-hoc diagnostic, not part of the historical comparison.

| Retrieval proxy | R13 (Nov 23) | Live V4 |
|---|---:|---:|
| At expected K | 124/186 (66.7%) | 128/186 (68.8%) |
| Top 10 | 115/186 | 114/186 |
| Top 25 | 137/186 | 139/186 |
| Absent top 25 | 49 | 47 |
| Linguistic at K | 32/52 | 30/52 |
| Direct intertext at K | 47/55 | 48/55 |
| Narrative/structural at K | 39/65 | 40/65 |
| Physical-world at K | 6/14 | 10/14 |

10 threshold gains, 6 losses. Modest target-retrieval improvement, not a demonstrated semantic-quality improvement. The 29 other positives were qualitatively screened: 7 supported candidates (including multiple-card support), 14 partial, 3 partial and late, 1 partial with semantic defect, 3 missing, 1 wrong entity. All 24 negatives ran; no obvious forbidden claim was detected in screened candidate cards, but **not 24 certified passes**.

## High-priority findings and reproduction

1. **P0 — False explicit identification.** get_Passage({passage:"Job 27:3",depth:10,word_depth:0,view:"evidence"}) returns rank 4 v4:eside:c1:13485:sp_1 as explicit_identification, "spirit + God = face". The clause is locative ("spirit of God is in my nostrils"), not identity. Audit the underlying clause predicate typing, not just this verse; retain well-supported identifications and distinguish locative, possessive, attributive, and predicative relations.
2. **P0 — Evidence retrieval.** research with operations op=evidence for v4:eside:c1:13485:sp_1, v4:eside:c5:rd:25359_25365:G4703 and v4:eside:c1:3247:cl2_0 returned not_found, release_id r11-v1.0. The last card is the new H1818 blood → life hit (rank 8). Check evidence/expand routing and release coherence; verify actual witnesses, not merely non-error responses.
3. **P0 — Resolver collision.** get_Word({word:"sun",mode:"bridge",connections:25,realworld:1,etymology:0,view:"evidence"}) selects G4862 σύν ("with") rather than the celestial object. H8121 resolves correctly. Prefer exact English meaning when ambiguous, preserve language/transliteration alternatives, and test other collisions without hardcoding.
4. **P0 — Sense contamination.** get_Word H5869, bridge mode, evidence view: rank 3 links spring sense to G4077 but source refs include Genesis 3:5–6 (eyes); rank 8/9 similarly use eye witnesses for well/water. Rank 4 correctly distinguishes senses. Propagate contextual sense IDs through candidate generation, witnesses and external properties; never infer physical identity from lemma identity.
5. **P0 — X240 mislabel.** research({query:"seed is the word of God",limit:25,view:"evidence"}) returns v4:eside:c5:rd:25359_25365:G4703 at rank 2 as orthographic_wordplay / attested_textual_wordplay. This is explicit parable interpretation (Luke 8:11), not wordplay. Correct explicit-identification cards exist at ranks 3/4; the presence of correct cards does not excuse a false label.
6. **P1 — Missing direct intertexts and ranking regressions.** Zechariah 12:10 → John 19:37 still absent in top 25; Exodus 12:13 → Hebrews 11:28 rank 6→13; Isaiah 53:4 → Matthew 8:17 rank 6→18. Jeremiah 31:31 → Hebrews 8:8 improved 22→2; Amos 9:11 → Acts 15:16 now rank 1 (range matching partly explains apparent gain). Preserve improvements while auditing candidate competition and deduplication.
7. **P1 — Structural/process discovery.** Genesis 11:9 → Acts 2:6 remains absent, and multiple resurrection/restoration parallels are missing. Menorah → oil → flame → smoke is only partial. Seek actual role/causal/sequence correspondences with evidence and uncertainty; do not promote inferred patterns to explicit text.
8. **Interface caveat.** Default get_Word clues view returned only 4 cards even with connections=25. Evidence view returned 25 where available. Evaluate effective research utility of default view separately from full ranking.

## Evaluation protocol and limitations

- Input source: [frozen expectations](https://github.com/kingdomfishers/BibleResearch/blob/e0c91b0c86f51328b6be311095124a8e3c321fc1/research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json). Baseline: [R13 evaluation](https://github.com/kingdomfishers/BibleResearch/blob/feat/r12-qa-fixes/research/r13/full_live_benchmark_2026-11-23_v54/EVALUATION_239.json).
- Original query/mode mapping retained. get_Word connections=25, etymology=0, realworld=0 for discover; mode=bridge and realworld=1 for bridge. get_Passage depth=25, word_depth=0, etymology=0, realworld=0. Explicit evidence view for both.
- Target-presence screen matches Strong IDs and canonical references in returned cards, including same-chapter verse-range containment. For historically assessable cases without explicit ID/ref target, uses non-source witness references. Weak aliases are diagnostic only. A match is not a semantic pass; the baseline matcher is not identical. The 186-case denominator is inherited for comparability.
- Per-case rows transcribed from live test batches, aggregate counts checked; raw full responses not retained. Semantic/provenance audit incomplete. The supplemental X240 is post-hoc; this public suite is not a blinded holdout.
- Use these findings as targeted regression probes within the active optimization loop, not instructions to restart or repeat the full suite after each change. Reproduce against current code before acting; fix general mechanisms, not benchmark cases. Focus on falsity, label correctness and evidence access before rank tuning. Final independent full benchmark remains separate.

## Files

- [JSON — 240 cases](BibleResearch_V4_Benchmark_240.json)
- [CSV — 240 cases](BibleResearch_V4_Benchmark_240.csv)

No algorithm, corpus, notes or deployment modified by this benchmark publication.
