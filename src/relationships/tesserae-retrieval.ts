// @file: src/relationships/tesserae-retrieval.ts
// @feature: relationships
// @tables: none
// @candidates: none
// @toc: types | logic:tesserae-scorer | logic:multichannel-rrf

// === @section:types ===

export type DiscoveryChannelName =
  | 'exact_lemma_rarity'
  | 'root_morphology'
  | 'wordplay_consonantal'
  | 'collocation_pmi'
  | 'structural_clause_frame'
  | 'symbolic_self_interpretation'
  | 'lxx_greek_bridge'
  | 'motif_cluster'
  | 'cross_reference'
  | 'genealogy_proper_noun';

export interface TesseraeTokenFeature {
  position: number;
  strongs: string;
  root_keys?: string[];
  lxx_targets?: string[];
  is_function_word?: boolean;
}

export interface TesseraeParallelScore {
  score: number;
  normalized_score: number;
  matched_features: Array<{
    feature_key: string;
    channel: 'lemma' | 'root' | 'lxx_bridge';
    source_strongs: string;
    target_strongs: string;
    df: number;
    idf_weight: number;
  }>;
  source_span_distance: number;
  target_span_distance: number;
  rare_match_count: number;
}

export interface MultichannelCandidateEntry {
  target_key: string;
  channel: DiscoveryChannelName;
  rank: number;
  raw_score: number;
  connection_id?: string;
}

export interface FusedMultichannelScore {
  target_key: string;
  rrf_score: number;
  synergy_bonus: number;
  independent_channels: DiscoveryChannelName[];
  channel_count: number;
  channel_ranks: Partial<Record<DiscoveryChannelName, number>>;
}

const STOP_STRONGS = new Set([
  'H0853', 'H3588', 'H0834', 'H3068', 'H0430', 'H0559', 'H1961', 'H0935', 'H5414', 'H6213',
  'H0376', 'H1121', 'H0776', 'H3117', 'H1697', 'H4428', 'H5971', 'H1004', 'H3478', 'H0413',
  'H5921', 'H4480', 'H3605', 'H3808', 'H2088', 'H1931', 'H1992', 'H0589', 'H0859',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473', 'G4771', 'G3778',
  'G3739', 'G1510', 'G3004', 'G2316', 'G2962', 'G0444', 'G1093', 'G3956', 'G2424', 'G5547',
]);

// === @section:logic:tesserae-scorer ===

/**
 * Tesserae V6 original-language intertextual parallel scorer.
 *
 * Adapts the classical Tesserae inverse-frequency + token-window distance formula
 * to original Hebrew/Aramaic/Greek lemmas, roots, and LXX translation bridges:
 *   score = ln( (sum_i(1 / freq(f_i)) + sum_i(idf(f_i))) / (dist_source + dist_target) )
 *
 * Requires at least 2 distinct non-stopword matching features so single generic words
 * cannot produce false intertextual parallels.
 */
export function scoreTesseraeParallel(
  sourceTokens: TesseraeTokenFeature[],
  targetTokens: TesseraeTokenFeature[],
  dfMap: ReadonlyMap<string, number>,
  totalVerses = 31203,
): TesseraeParallelScore {
  const srcContent = sourceTokens.filter(
    (t) => t.strongs && !t.is_function_word && !STOP_STRONGS.has(t.strongs),
  );
  const tgtContent = targetTokens.filter(
    (t) => t.strongs && !t.is_function_word && !STOP_STRONGS.has(t.strongs),
  );
  if (srcContent.length < 2 || tgtContent.length < 2) {
    return {
      score: 0,
      normalized_score: 0,
      matched_features: [],
      source_span_distance: 0,
      target_span_distance: 0,
      rare_match_count: 0,
    };
  }

  const matchedFeatures: TesseraeParallelScore['matched_features'] = [];
  const usedSrcIdx = new Set<number>();
  const usedTgtIdx = new Set<number>();
  const matchedSrcPos: number[] = [];
  const matchedTgtPos: number[] = [];

  // Pass 1: Exact lemma matches
  for (let i = 0; i < srcContent.length; i++) {
    const sTok = srcContent[i];
    const df = Math.max(1, dfMap.get(sTok.strongs) ?? 400);
    if (df > 850) continue;
    for (let j = 0; j < tgtContent.length; j++) {
      if (usedTgtIdx.has(j)) continue;
      const tTok = tgtContent[j];
      if (sTok.strongs === tTok.strongs) {
        usedSrcIdx.add(i);
        usedTgtIdx.add(j);
        matchedSrcPos.push(sTok.position);
        matchedTgtPos.push(tTok.position);
        const idfWeight = Math.max(0.8, Math.log(totalVerses / df));
        matchedFeatures.push({
          feature_key: `lemma:${sTok.strongs}`,
          channel: 'lemma',
          source_strongs: sTok.strongs,
          target_strongs: tTok.strongs,
          df,
          idf_weight: Math.round(idfWeight * 1000) / 1000,
        });
        break;
      }
    }
  }

  // Pass 2: Shared root or LXX bridge matches on remaining content tokens
  for (let i = 0; i < srcContent.length; i++) {
    if (usedSrcIdx.has(i)) continue;
    const sTok = srcContent[i];
    const sRoots = new Set(sTok.root_keys || []);
    const sLxx = new Set(sTok.lxx_targets || []);
    if (sRoots.size === 0 && sLxx.size === 0) continue;
    const sDf = Math.max(1, dfMap.get(sTok.strongs) ?? 400);
    if (sDf > 700) continue;

    for (let j = 0; j < tgtContent.length; j++) {
      if (usedTgtIdx.has(j)) continue;
      const tTok = tgtContent[j];
      const tDf = Math.max(1, dfMap.get(tTok.strongs) ?? 400);
      if (tDf > 700) continue;

      let matchedChannel: 'root' | 'lxx_bridge' | null = null;
      let featureKey = '';
      if (sLxx.has(tTok.strongs) || (tTok.lxx_targets || []).includes(sTok.strongs)) {
        matchedChannel = 'lxx_bridge';
        featureKey = `lxx:${sTok.strongs}:${tTok.strongs}`;
      } else if (sRoots.size > 0 && (tTok.root_keys || []).some((rk) => sRoots.has(rk))) {
        const rk = (tTok.root_keys || []).find((r) => sRoots.has(r))!;
        matchedChannel = 'root';
        featureKey = `root:${rk}`;
      }

      if (matchedChannel) {
        usedSrcIdx.add(i);
        usedTgtIdx.add(j);
        matchedSrcPos.push(sTok.position);
        matchedTgtPos.push(tTok.position);
        const effDf = Math.max(1, Math.min(sDf, tDf));
        const idfWeight = Math.max(0.6, Math.log(totalVerses / effDf) * (matchedChannel === 'lxx_bridge' ? 0.92 : 0.85));
        matchedFeatures.push({
          feature_key: featureKey,
          channel: matchedChannel,
          source_strongs: sTok.strongs,
          target_strongs: tTok.strongs,
          df: effDf,
          idf_weight: Math.round(idfWeight * 1000) / 1000,
        });
        break;
      }
    }
  }

  // Deduplicate by feature_key
  const uniqueByFeature = new Map<string, TesseraeParallelScore['matched_features'][0]>();
  for (const mf of matchedFeatures) {
    const prev = uniqueByFeature.get(mf.feature_key);
    if (!prev || mf.idf_weight > prev.idf_weight) uniqueByFeature.set(mf.feature_key, mf);
  }
  const deduped = [...uniqueByFeature.values()];
  if (deduped.length < 2) {
    return {
      score: 0,
      normalized_score: 0,
      matched_features: deduped,
      source_span_distance: 0,
      target_span_distance: 0,
      rare_match_count: deduped.filter((f) => f.df <= 90).length,
    };
  }

  const minSrc = Math.min(...matchedSrcPos);
  const maxSrc = Math.max(...matchedSrcPos);
  const minTgt = Math.min(...matchedTgtPos);
  const maxTgt = Math.max(...matchedTgtPos);
  const srcDist = Math.max(1, maxSrc - minSrc);
  const tgtDist = Math.max(1, maxTgt - minTgt);

  let freqNumer = 0;
  let rareMatchCount = 0;
  for (const mf of deduped) {
    const invFreq = 120 / Math.max(2, mf.df);
    freqNumer += mf.idf_weight * 2.2 + invFreq;
    if (mf.df <= 90) rareMatchCount++;
  }

  const distPenalty = Math.pow(srcDist + tgtDist, 0.35);
  const countMultiplier = 1 + (deduped.length - 2) * 0.38 + rareMatchCount * 0.25;
  const rawScore = (freqNumer * countMultiplier) / Math.max(1, distPenalty);
  const normalizedScore = Math.min(1, Math.round((rawScore / 42) * 1000) / 1000);

  return {
    score: Math.round(rawScore * 100) / 100,
    normalized_score: normalizedScore,
    matched_features: deduped,
    source_span_distance: srcDist,
    target_span_distance: tgtDist,
    rare_match_count: rareMatchCount,
  };
}

// === @section:logic:multichannel-rrf ===

/**
 * Reciprocal Rank Fusion (RRF) across the 10 original-language discovery channels.
 *
 * Rewards targets corroborated by >= 2 independent channels (e.g. shared rare lemma +
 * consonantal wordplay, or LXX bridge + explicit self-interpretation) with a bounded
 * synergy bonus while never penalizing high-precision single-channel evidence.
 */
export function fuseMultichannelCandidatesRrf(
  entries: MultichannelCandidateEntry[],
  k = 60,
): Map<string, FusedMultichannelScore> {
  const byTarget = new Map<
    string,
    {
      rrf: number;
      channels: Set<DiscoveryChannelName>;
      ranks: Partial<Record<DiscoveryChannelName, number>>;
    }
  >();

  for (const e of entries) {
    if (!e.target_key) continue;
    let acc = byTarget.get(e.target_key);
    if (!acc) {
      acc = { rrf: 0, channels: new Set(), ranks: {} };
      byTarget.set(e.target_key, acc);
    }
    const prevRank = acc.ranks[e.channel];
    const effRank = Math.max(1, e.rank);
    if (prevRank === undefined || effRank < prevRank) {
      if (prevRank !== undefined) {
        acc.rrf -= 1 / (k + prevRank);
      }
      acc.ranks[e.channel] = effRank;
      acc.rrf += 1 / (k + effRank);
      acc.channels.add(e.channel);
    }
  }

  const result = new Map<string, FusedMultichannelScore>();
  for (const [targetKey, acc] of byTarget) {
    const independentChannels = [...acc.channels];
    const channelCount = independentChannels.length;
    // Bounded multi-channel synergy bonus (0 for 1 channel, +12..+36 for 2..4+ independent channels)
    const synergyBonus =
      channelCount >= 2
        ? Math.min(36, Math.round((channelCount - 1) * 11 + acc.rrf * 260))
        : 0;
    result.set(targetKey, {
      target_key: targetKey,
      rrf_score: Math.round(acc.rrf * 10000) / 10000,
      synergy_bonus: synergyBonus,
      independent_channels: independentChannels,
      channel_count: channelCount,
      channel_ranks: acc.ranks,
    });
  }
  return result;
}
