# R12 offline candidate helpers — verified prototypes

These **research prototypes are not wired into the active BibleResearch application**. They are intentionally dependency-free and read no corpus files. Their only role is to save Astra/Terra implementation effort when adapting generic candidate generation to the newer, authoritative local worktree.

## Included

- [orthographic-candidates.mjs](orthographic-candidates.mjs) — normalized Hebrew/Greek bigram index and bounded same-language word-form candidate retrieval; returns matched character span, score, diagnostics and explicit *not etymology* limitation.
- [orthographic-candidates.test.mjs](orthographic-candidates.test.mjs) — Adam/dam, pointed/unpointed Hebrew, Greek diacritic stripping, nonmatches, homograph caution and duplicate-ID controls.
- [structural-candidates.mjs](structural-candidates.mjs) — sparse scene-feature inverted index, rarity threshold, weighted Jaccard score, distinct-witness filtering and bounded candidate output.
- [structural-candidates.test.mjs](structural-candidates.test.mjs) — independent Hagar-like scenes, duplicate-annotation exclusion, unknown/generic negatives and result labeling.

Run the current files from this directory with:

```sh
node --test ./*.test.mjs
```

The tests were originally executed locally with Node 22 and passed (**18 source-level assertions across two test files**). The current GitHub files should be retested after checkout; there is no claim of integration or full-corpus benchmark.

## Integration — minimal adaptation

1. **Do not import as an independent engine.** Move the pure helper functions into the existing `scripts/r12-evidence.mjs` compilation passes or call the standalone modules from an adapter in `scripts/build-r10-discovery-index.mjs`.
2. Feed actual canonical lexeme/sense/occurrence records with edition-specific identities, not English labels or arbitrary Strong's-only IDs. For orthography use lemma/form identity and preserve original spelling. For scene signatures feed verified R8/MACULA statement roles and source statement IDs.
3. Normalized-form matches become `ORTHOGRAPHIC_SIMILARITY` **candidate** edges; a common substring is not `DERIVED_FROM`, not the same sense and not a theological conclusion. Deduplicate repeated inflections before aggregating lexeme candidates.
4. Scene matches become `SHARES_STRUCTURAL_PATTERN` candidate edges with feature matches, source witnesses, context/speaker/negation and source lineage. The prototype only accepts already-extracted features; it does not parse MACULA syntax or resolve biblical referents.
5. Add real-source validation tests with withheld passages. Tests use illustrative names and scenes, not a manually curated output table or production rule.
6. Measure counts, common-posting truncation, false positives and runtime/heap usage on a representative slice before full corpus generation.

## Known limitations / tasks for Astra

- Bigram generation misses noncontiguous letter permutations and some phonological wordplay; evaluate whether adding *indexed* deletion signatures and n-gram variants improves recall without flooding the ranking with spurious similarities.
- Hebrew final forms are deliberately **not** collapsed in the basic normalization; add a separately labeled comparison mode if desired.
- Structural matching compares already-validated features and does not synthesize participant identity or scene boundaries. Upstream task owns that extraction.
- Small-sample rarity cutoff is a heuristic; benchmark/adjust thresholds on real Hebrew/Greek scene populations.
- Index objects are in-memory offline helpers. Production compilation needs stable JSONL serialization and deterministic immutable bucketed assets using existing R9B conventions.
- These scripts do not use any licensed external dataset or establish claims about authorial intent.

See the overarching [R12_Plan.md](../../R12_Plan.md), especially the source mapping, provenance and MCP/UI sections.

## Status

- Algorithm prototypes and isolated tests: **complete locally**.
- GitHub publication: complete.
- Adaptation to local BibleResearch-r10 code: **not performed**.
- Corpus-wide or Cloudflare live tests: **not performed**.
