// @file: scripts/benchmark-r9c-multihop.mjs
// Benchmarks R9C multi-hop traversal across 1-hop, 2-hop, 3-hop, high-degree, cross-language, and disconnected queries.
// Local Node filesystem measurements do NOT prove production Cloudflare Worker latency or CPU budgets.

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createNodeFsAssetReader, ShardedAdjacencyLoader } from '../src/relationships/adjacency-loader.ts';
import { discoverMultiHopPaths } from '../src/relationships/multihop-search.ts';

const R9B_STAGING = 'C:\\Projects\\BibleResearch-r9b\\.artifacts-r9b\\staging';
const R8D_CORPUS = 'C:\\Projects\\BibleResearch\\.artifacts\\static-corpus';
const OUT_DIR = path.resolve('.artifacts-r9c');
const OUT_FILE = path.join(OUT_DIR, 'benchmark-report.json');

const SCENARIOS = [
  { name: 'one_hop_grammatical_target', category: 'one_hop', query: { source: 'lemma:H7307', target: 'lemma:H7363B', max_hops: 1, layers: ['grammatical'] } },
  { name: 'one_hop_open_discovery', category: 'one_hop', query: { source: 'lemma:H7307', max_hops: 1, limit: 20 } },
  { name: 'two_hop_same_frame_target', category: 'two_hop', query: { source: 'lemma:H0430G', target: 'lemma:H8064', max_hops: 2, layers: ['grammatical'], limit: 10 } },
  { name: 'two_hop_open_discovery', category: 'two_hop', query: { source: 'lemma:H7307', max_hops: 2, limit: 20 } },
  { name: 'three_hop_target_cognate_to_greek', category: 'three_hop', query: { source: 'lemma:H7308', target: 'lemma:G4151', max_hops: 3, limit: 10 } },
  { name: 'three_hop_open_bounded', category: 'three_hop', query: { source: 'lemma:H7307', max_hops: 3, limits: { max_nodes_expanded: 15, max_edges_examined: 2500 }, limit: 15 } },
  { name: 'high_degree_content_H0430G', category: 'high_degree', query: { source: 'lemma:H0430G', max_hops: 2, limit: 15 } },
  { name: 'high_degree_function_H0853', category: 'high_degree', query: { source: 'lemma:H0853', max_hops: 2, limit: 15 } },
  { name: 'cross_language_H1697G_G3056', category: 'cross_language', query: { source: 'lemma:H1697G', target: 'lemma:G3056', max_hops: 2, limit: 10 } },
  { name: 'cross_language_H1254a_G2936', category: 'cross_language', query: { source: 'lemma:H1254a', target: 'lemma:G2936', max_hops: 2, limit: 10 } },
  { name: 'disconnected_gram_only_H7307_G3056', category: 'disconnected', query: { source: 'lemma:H7307', target: 'lemma:G3056', max_hops: 2, layers: ['grammatical'] } },
];

async function measureScenario(reader, scenario) {
  // Cold run (fresh LRU cache per loader)
  const coldLoader = new ShardedAdjacencyLoader(reader, { releaseVersion: 'r9b-v1.0', maxCachedShards: 128 });
  await coldLoader.getManifestSummary();
  await coldLoader.getResolverIndex();

  const memBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const coldRes = await discoverMultiHopPaths(coldLoader, scenario.query);
  const coldLatency = performance.now() - t0;
  const memAfter = process.memoryUsage().heapUsed;

  // Warm run (reusing cached shards on same loader)
  const t1 = performance.now();
  await discoverMultiHopPaths(coldLoader, scenario.query);
  const warmLatency = performance.now() - t1;

  const responseBytes = Buffer.byteLength(JSON.stringify(coldRes), 'utf8');
  return {
    name: scenario.name,
    category: scenario.category,
    status: coldRes.status,
    paths_found: coldRes.coverage.total_paths_found,
    paths_returned: coldRes.coverage.paths_returned,
    exhaustive: coldRes.coverage.exhaustive,
    search_stopped_by_limits: coldRes.coverage.search_stopped_by_limits,
    nodes_expanded: coldRes.coverage.nodes_expanded,
    edges_examined: coldRes.coverage.edges_examined,
    shards_read: coldRes.coverage.shards_read,
    shard_bytes_read: coldRes.coverage.bytes_read,
    contextual_pages_loaded: coldRes.coverage.contextual_pages_loaded,
    cold_latency_ms: Math.round(coldLatency * 100) / 100,
    warm_latency_ms: Math.round(warmLatency * 100) / 100,
    heap_delta_kb: Math.round(((memAfter - memBefore) / 1024) * 100) / 100,
    response_bytes: responseBytes,
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const reader = await createNodeFsAssetReader([R9B_STAGING, R8D_CORPUS]);

  const rows = [];
  for (const sc of SCENARIOS) {
    rows.push(await measureScenario(reader, sc));
  }

  const report = {
    generated_at: new Date().toISOString(),
    environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      caveat: 'Local Node.js filesystem/zlib benchmarks do NOT prove production Cloudflare Worker CPU limits, subrequest quotas, or R2/KV network latency.',
    },
    benchmarks: rows,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Saved benchmark report to ${OUT_FILE}`);
  console.table(
    rows.map((r) => ({
      name: r.name,
      status: r.status,
      paths: r.paths_found,
      nodes: r.nodes_expanded,
      edges: r.edges_examined,
      shards: r.shards_read,
      cold_ms: r.cold_latency_ms,
      warm_ms: r.warm_latency_ms,
      resp_kb: Math.round((r.response_bytes / 1024) * 10) / 10,
    })),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
