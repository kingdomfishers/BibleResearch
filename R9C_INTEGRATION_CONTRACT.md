# R9C Offline Integration Contract for R9B Relationship Gateway

Status: Offline implementation contract (no production Worker, R2/KV, Supabase MCP, or UI changes made in R9C).

## 1. Module Surface

New reusable TypeScript modules under `src/relationships/` (zero external runtime dependencies, ES2022 + bundler/Node ESM compatible):

- `src/relationships/multihop-types.ts` — Canonical request, normalized 4-layer edge, path, ranking, concept-candidate, coverage, and `AdjacencyLoader` contracts.
- `src/relationships/adjacency-loader.ts` — Manifest-driven bounded sharded reader (`ShardedAdjacencyLoader`), `AssetReader` abstraction (`createNodeFsAssetReader`, `createInMemoryAssetReader`), and dual hash routing (`fnv1a64_mod256` and `fnv1a64_hi32_mod64`).
- `src/relationships/concept-resolver.ts` — Explicit `resolveResearchConcept(loader, query, options)` resolving canonical keys, extended/base Strong's homographs, surface forms, transliterations, and licensed English gloss candidate sets without inventing lexical edges or collapsing English concepts to one lemma.
- `src/relationships/path-ranker.ts` — Deterministic evidence-weighted scorer (`scoreAndExplainPath`), configurable hub/function-word penalties (`DEFAULT_HUB_PENALTY_CONFIG`), and anti-false-discovery explanation synthesis.
- `src/relationships/multihop-search.ts` — Bounded `discoverMultiHopPaths(loader, query)` supporting 1–3 hops, bidirectional meet-in-the-middle target search, bounded open-ended discovery, lazy full-summary witness verification (`getSummaryEvidence`), deterministic cursor pagination (`mh1:<offset>:<sig8>`), cycle prevention, and search completeness reporting.

## 2. Gateway / Worker `AdjacencyLoader` Adapter Contract

To wire R9C behind a future Cloudflare Worker RPC or MCP endpoint without changing core traversal logic, implement `AssetReader` backed by the Worker's R2 / KV / static fetch cache:

```ts
export interface AssetReader {
  readJson(assetPath: string): Promise<{ data: unknown; bytes: number } | null>;
}
```

Or implement `AdjacencyLoader` directly over existing R9B gateway helpers:

- `getReleaseVersion(): Promise<string>`
- `getEntityProfile(entityKey: string): Promise<GraphEntityRef | null>`
- `getNeighbors(entityKey: string, options?: NeighborLoadOptions): Promise<NeighborLoadResult>`
- `getSummaryEvidence(summaryId: string): Promise<HopEvidenceWitness[]>`
- `getManifestSummary(): Promise<Record<string, unknown> | null>`

### Required Read-Only Asset Paths & Hash Routing

Derived strictly from `/v2/relationships/<release_version>/manifest.json.gz` (`schema_version: "3.0"`):

| Layer | Hash Algorithm | Buckets | Shard Path Pattern (relative to layer `base_dir`) |
| --- | --- | --- | --- |
| Grammatical (`r8-v1.1`) | `fnv1a64_mod256` | `256` | `by-lemma/shard-{hex2}.json.gz`, `evidence/by-summary/shard-{hex2}.json.gz`, `resolver-index.json.gz`, `uncovered-lemmas.json.gz` |
| Lexical (`r9a-v1.0-dev`) | `fnv1a64_hi32_mod64` | `64` | `edges/sharded-edges/shard-{hex2}.json.gz` |
| Contextual (`r9a-v1.0-dev`) | `fnv1a64_hi32_mod64` | `64` | `sharded-contextual/shard-{hex2}.json.gz` + `overflow_pages[].path` |
| LXX Translation (`r4-lxx-v1.0`) | `fnv1a64_hi32_mod64` | `64` | `by-hebrew-lemma/shard-{hex2}.json.gz`, `by-greek-lemma/shard-{hex2}.json.gz` |

**Important routing detail:** Both hash algorithms operate over UTF-16 `charCodeAt` 64-bit FNV-1a (matching `scripts/corpus-relationships-rpc.mjs`):
- `fnv1a64_mod256`: `BigInt('0x' + hex64) % 256n`
- `fnv1a64_hi32_mod64`: `BigInt('0x' + hex64.slice(0, 8)) % 64n`

## 3. Request Schema (`MultiHopQuery`)

- `source`: string — Canonical ID (`lemma:H7307`, `root:H7307`, `sense:H7307H:sub`) or unique extended Strong's (`H1697G`, `H1254a`). Bare base Strong's with multiple homographs (`H1697`, `H1254`) and English concepts (`spirit`) are rejected with `invalid_request` and must first pass through `resolveResearchConcept`.
- `target?: string | null` / `targets?: string[]` — Optional target entity or candidate target set (uses bidirectional meet-in-the-middle for 2–3 hops).
- `max_hops?: number` — Default `2`, hard max `3`.
- `layers?: ('grammatical' | 'lexical' | 'contextual' | 'lxx_translation')[]`
- `predicates?: string[]`
- `direction?: 'both' | 'outgoing' | 'incoming'` (default `'both'`; never fabricates reverse claims for directed predicates).
- `min_quality?: 'all' | 'exclude_candidate' | 'high_precision_only'`
- `languages?: string[]` (`hbo`, `arc`, `grc` normalized)
- `editions?: string[]` (e.g. `macula-hebrew-wlc`, `macula-greek-sblgnt`, `macula-greek-nestle1904`)
- `contextual_scope?: 'all' | 'same_clause' | 'collocation' | 'same_verse'`, `min_same_verse`, `min_same_clause`, `min_collocation`
- `allow_cycles?: boolean` (default `false`)
- `hub_penalty?: Partial<HubPenaltyConfig>` (configurable function-word & degree threshold penalties; `allow_function_word_intermediates` defaults `true` with heavy down-ranking `-28` unless explicitly disallowed)
- `limits?: Partial<SearchLimits>` — Defaults tuned for edge-Worker memory/subrequest safety (`max_nodes_expanded: 45`, `max_edges_examined: 3000`, `max_paths_returned: 20`, `max_per_node_edges: 150`, `max_contextual_pages_per_node: 4`; bounded hard ceilings `500 / 25000 / 100 / 5000 / 100`).
- `limit`, `offset`, `cursor` — Deterministic pagination (`mh1:<offset>:<sig8>`).

## 4. Response Schema (`MultiHopResult`) & Guardrails

Every response returns:
- `status`: `'ok' | 'no_supported_path' | 'invalid_request' | 'unknown_entity' | 'incomplete_coverage'`
- `paths[]`: ordered `entities` (with `entity_kind: 'lemma' | 'root' | 'sense'`), `steps` (exact `source_relationship_id`, `canonical_source_entity`, `canonical_target_entity`, `direction`, `traversal_direction`, `layer`, `epistemic_class`, `editions`, `evidence_summary`, `provenance`, `uncertainty`, `guardrails`), `ranking` (`score`, `score_kind: 'heuristic_evidence_relevance_not_truth_probability'`, transparent `factors`, `why_ranked`), and `explanation` (`establishes`, `does_not_establish[]`, `join_scope: 'direct' | 'same_frame' | 'same_passage' | 'cross_passage' | 'lexical_or_translation_bridge'`, `shared_frame_ids`, `shared_references`).
- `coverage`: `exhaustive`, `search_stopped_by_limits`, `limits_reached[]`, `source_coverage_incomplete`, `incomplete_reasons[]`, `missing_shards[]`, `truncated_contextual_entities[]`, `nodes_expanded`, `edges_examined`, `shards_read`, `bytes_read`, `contextual_pages_loaded`, `total_paths_found`, `paths_returned`.
- `guardrails`: machine-readable assertions enforcing epistemic separation, canonical homograph preservation, and non-equivalence of statistical/LXX/cross-testament hops.

## 5. Recommended RPC Method Names (Future Gateway Wiring)

Not wired in R9C (left untouched per isolation rules):
- `discover_relationship_paths_v1` -> `discoverMultiHopPaths(loader, query)`
- `resolve_research_concept_v1` -> `resolveResearchConcept(loader, query, options)`

## 6. Compatibility & Operational Notes

1. `H1254A` vs `H1254a`: `resolver-index.json.gz` contains alias entries carrying `canonical_lemma_id`; `concept-resolver.ts` normalizes aliases to canonical shard keys while keeping true homographs (`H1697G`/`H1697O`, `H1254a`/`H1254b`) distinct.
2. Contextual truncation recovery: R9A's top-50 ceiling is overcome via `overflow_pages` in `r9b-v1.0`; any query whose `max_contextual_pages_per_node` stops short of all eligible overflow pages flags `truncated_contextual_entities` and `exhaustive: false`.
3. Edge subrequest budgeting: When porting to Cloudflare Workers, pass Worker `waitUntil`/request-scoped in-memory LRU caching on the `AssetReader` and honor Cloudflare's 50-subrequest per-invocation limit on Free/Unbound tiers by calibrating `max_nodes_expanded` and `max_contextual_pages_per_node`.
