/**
 * R12 offline ranking wrapper delegating to the single authoritative TypeScript ranker.
 * No graph traversal or Worker runtime search is implemented here.
 * Scores are heuristic discovery priority, NEVER theological probabilities.
 */
import {
  R12_SCORE_VERSION,
  scoreR12Path,
  rankR12DiscoveryDestinations,
} from '../../src/relationships/path-ranker.ts';

export { R12_SCORE_VERSION };

export function scorePath(path, opts = {}) {
  if (!path || typeof path !== 'object') {
    throw new TypeError('Nonempty path required');
  }
  return scoreR12Path(
    {
      ...path,
      anchor_id: path.anchor_id ?? '',
      target_id: path.target_id ?? '',
    },
    opts,
  );
}

export function rankDiscoveryDestinations(paths, opts = {}) {
  const out = rankR12DiscoveryDestinations(paths, opts);
  return {
    results: out.top,
    coverage: out.coverage,
    unreturned_destinations: out.unreturned_destinations,
    pruned_incoherent_count: out.pruned_incoherent_count,
    score_version: out.score_version,
  };
}
