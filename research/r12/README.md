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


## 2026-11-17 extension — source-verified design and additional executable helpers

**New architecture / database documentation:**

- [R12_DB_DESIGN.md](R12_DB_DESIGN.md) — grounded in read-only inspection of existing Supabase tables and Cloudflare Workers metadata; **no new bulk Postgres graph**. Existing concept_properties and external links contain mostly geographical data and should not be misrepresented as physical-world scientific claims.
- [evidence-contract.schema.json](evidence-contract.schema.json) — versioned *illustrative* JSON Schema for external mappings, external source claims, evidence edges and stored discovery paths. Adapt field names to the latest local R12 types.
- [r12_schema_readonly_audit.sql](r12_schema_readonly_audit.sql) — SELECT-only diagnostic queries; no notes or user-data exports.
- [r12_review_schema_PROPOSAL.sql](r12_review_schema_PROPOSAL.sql) — **non-executed, optional** private review table. Do not apply unless user explicitly approves and the existing notes/review system proves insufficient.

**Additional algorithms:**

- [property-bridges.mjs](property-bridges.mjs), [tests](property-bridges.test.mjs) — a bounded inverted-index candidate generator for shared external/scientific properties, with license/source/rights/mapping-status checks, geographic metadata exclusion, and strict non-biblical-claim labeling.
- [proof-ranker.mjs](proof-ranker.mjs), [tests](proof-ranker.test.mjs) — independent evidence-group convergence, heuristic quality/interest factors, original typed steps and MMR diverse-destination selection. Accepts paths from **existing R9C**; it intentionally contains no second graph traversal.

All four algorithms are **standalone offline prototypes**, not deployed code. The new modules and tests were fetched back through GitHub and passed an in-session JavaScript smoke harness (26 assertions across their two tests). Re-run with Node in the authoritative local worktree before integration:

~~~sh
node --test research/r12/orthographic-candidates.test.mjs research/r12/structural-candidates.test.mjs research/r12/property-bridges.test.mjs research/r12/proof-ranker.test.mjs
~~~

**Implementation order:** first direct existing biblical neighbors in WordInspector/MCP, then offline existing-R9C multihop and proof expansion; next form/pattern and external-property helpers; finally selectively import licensed WordNet/Wikidata/ENVO etc. Do not let this research folder displace the local D1.3/D1.4 work or force a duplicate graph architecture.

**Safety:** No Supabase table or Worker was modified. No code was deployed. All newly created files are under research/r12 on GitHub main; local BibleResearch-r10 task statuses remain authoritative.
