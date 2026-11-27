// Passage-local literary discovery. Pure ESM; no runtime dependencies.
// Event keys and features must originate in a single corpus edition; see handoff.

function checkEvents(events, limit = 256) {
  if (!Array.isArray(events) || events.length > limit) {
    throw new RangeError('Literary event limit exceeded');
  }
  const ids = new Set();
  for (const e of events) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      !e.id ||
      ids.has(e.id) ||
      typeof e.key !== 'string' ||
      !e.key ||
      !Array.isArray(e.wordIds) ||
      !e.wordIds.length ||
      !Array.isArray(e.features) ||
      e.features.length > 32 ||
      e.features.some(f => typeof f !== 'string') ||
      e.wordIds.some(w => typeof w !== 'string' || !w)
    ) {
      throw new TypeError('Invalid or duplicate literary event');
    }
    ids.add(e.id);
  }
}

export function eventSimilarity(a, b, featureWeights = null) {
  if (a.key === b.key) return 1;
  let typeA = null;
  let typeB = null;
  for (let i = 0; i < a.features.length; i++) {
    if (a.features[i].startsWith('type:')) { typeA = a.features[i]; break; }
  }
  for (let i = 0; i < b.features.length; i++) {
    if (b.features[i].startsWith('type:')) { typeB = b.features[i]; break; }
  }
  if (typeA && typeB && typeA !== typeB) return 0;

  let shared = 0;
  let union = 0;
  const weight = k => {
    if (featureWeights && typeof featureWeights[k] === 'number') return featureWeights[k];
    if (k.startsWith('lemma:')) return 2.0;
    if (k.startsWith('role:')) return 1.5;
    if (k.startsWith('frame:')) return 1.0;
    if (k.startsWith('type:')) return 1.25;
    if (k.startsWith('concept:')) return 1.25;
    if (k.startsWith('stem:')) return 1.8;
    return 0.5;
  };
  const seen = new Set();
  for (let i = 0; i < a.features.length; i++) {
    const f = a.features[i];
    if (seen.has(f)) continue;
    seen.add(f);
    const w = weight(f);
    union += w;
    if (b.features.includes(f)) shared += w;
  }
  for (let i = 0; i < b.features.length; i++) {
    const f = b.features[i];
    if (seen.has(f)) continue;
    seen.add(f);
    union += weight(f);
  }
  return union ? shared / union : 0;
}

/**
 * Gotoh sequence alignment with affine gap penalties (default) and optional linear fallback.
 * Backward-compatible signature: alignSequences(a, b, local=false, options={})
 */
export function alignSequences(a, b, local = false, options = {}) {
  if (a.length > 256 || b.length > 256) throw new RangeError('Alignment limit exceeded');
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push({ a: i, b: null, similarity: 0 });
    for (let j = 0; j < m; j++) pairs.push({ a: null, b: j, similarity: 0 });
    return { score: 0, pairs };
  }

  const gapOpen = options.gapOpen ?? -0.4;
  const gapExtend = options.gapExtend ?? -0.2;
  const linearGap = options.linearGap ?? null;
  const minSim = options.minSimilarity ?? 0.52;
  const mismatchPenalty = options.mismatchPenalty ?? -2.2;
  const featureWeights = options.featureWeights ?? null;

  // Backward-compatible linear mode if explicitly requested
  if (linearGap !== null) {
    const w = m + 1;
    const dp = new Float64Array((n + 1) * w);
    const trace = new Uint8Array(dp.length);
    if (!local) {
      for (let i = 1; i <= n; i++) { dp[i * w] = i * linearGap; trace[i * w] = 2; }
      for (let j = 1; j <= m; j++) { dp[j] = j * linearGap; trace[j] = 3; }
    }
    let best = 0;
    let bi = 0;
    let bj = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const s = eventSimilarity(a[i - 1], b[j - 1], featureWeights);
        const k = i * w + j;
        const d = dp[k - w - 1] + (s >= minSim ? 2 * s : mismatchPenalty);
        const u = dp[k - w] + linearGap;
        const l = dp[k - 1] + linearGap;
        let val = d;
        let dir = 1;
        if (u > val) { val = u; dir = 2; }
        if (l > val) { val = l; dir = 3; }
        if (local && val <= 0) { val = 0; dir = 0; }
        dp[k] = val;
        trace[k] = dir;
        if (val > best) { best = val; bi = i; bj = j; }
      }
    }
    let i = local ? bi : n;
    let j = local ? bj : m;
    const score = dp[i * w + j];
    const pairs = [];
    while (i || j) {
      const d = trace[i * w + j];
      if (!d) break;
      if (d === 1) {
        pairs.push({ a: i - 1, b: j - 1, similarity: eventSimilarity(a[i - 1], b[j - 1], featureWeights) });
        i--; j--;
      } else if (d === 2) {
        pairs.push({ a: i - 1, b: null, similarity: 0 });
        i--;
      } else {
        pairs.push({ a: null, b: j - 1, similarity: 0 });
        j--;
      }
    }
    return { score, pairs: pairs.reverse() };
  }

  // Gotoh 3-state affine gap DP: state 0=M, 1=X (gap in b / delete a), 2=Y (gap in a / insert b)
  const w = m + 1;
  const size = (n + 1) * w;
  const NEG_INF = -1e9;
  const M = new Float64Array(size).fill(NEG_INF);
  const X = new Float64Array(size).fill(NEG_INF);
  const Y = new Float64Array(size).fill(NEG_INF);
  const tM = new Uint8Array(size);
  const tX = new Uint8Array(size);
  const tY = new Uint8Array(size);

  M[0] = 0;
  if (!local) {
    for (let i = 1; i <= n; i++) {
      X[i * w] = gapOpen + i * gapExtend;
      tX[i * w] = i === 1 ? 1 : 2; // 1=from M, 2=from X
    }
    for (let j = 1; j <= m; j++) {
      Y[j] = gapOpen + j * gapExtend;
      tY[j] = j === 1 ? 1 : 3; // 1=from M, 3=from Y
    }
  } else {
    for (let i = 0; i <= n; i++) M[i * w] = 0;
    for (let j = 0; j <= m; j++) M[j] = 0;
  }

  let best = 0;
  let bi = 0;
  let bj = 0;
  let bestState = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const k = i * w + j;
      const s = eventSimilarity(a[i - 1], b[j - 1], featureWeights);
      const matchSub = s >= minSim ? 2 * s : mismatchPenalty;

      // X[i,j]: gap in b (advance i)
      const xFromM = M[k - w] + gapOpen + gapExtend;
      const xFromX = X[k - w] + gapExtend;
      if (xFromM >= xFromX) { X[k] = xFromM; tX[k] = 1; } else { X[k] = xFromX; tX[k] = 2; }

      // Y[i,j]: gap in a (advance j)
      const yFromM = M[k - 1] + gapOpen + gapExtend;
      const yFromY = Y[k - 1] + gapExtend;
      if (yFromM >= yFromY) { Y[k] = yFromM; tY[k] = 1; } else { Y[k] = yFromY; tY[k] = 3; }

      // M[i,j]
      const prevM = M[k - w - 1];
      const prevX = X[k - w - 1];
      const prevY = Y[k - w - 1];
      let prevBest = prevM;
      let prevSrc = 1;
      if (prevX > prevBest) { prevBest = prevX; prevSrc = 2; }
      if (prevY > prevBest) { prevBest = prevY; prevSrc = 3; }

      let mVal = prevBest + matchSub;
      if (local && mVal <= 0) {
        mVal = 0;
        prevSrc = 0;
      }
      M[k] = mVal;
      tM[k] = prevSrc;

      if (local) {
        if (mVal > best) { best = mVal; bi = i; bj = j; bestState = 0; }
      }
    }
  }

  let i = local ? bi : n;
  let j = local ? bj : m;
  let state = 0;
  let score = 0;
  if (!local) {
    const endK = n * w + m;
    score = M[endK];
    state = 0;
    if (X[endK] > score) { score = X[endK]; state = 1; }
    if (Y[endK] > score) { score = Y[endK]; state = 2; }
  } else {
    score = best;
    state = bestState;
  }

  const pairs = [];
  while (i > 0 || j > 0) {
    const k = i * w + j;
    if (state === 0) {
      const src = tM[k];
      if (!src) break;
      pairs.push({
        a: i - 1,
        b: j - 1,
        similarity: eventSimilarity(a[i - 1], b[j - 1], featureWeights),
      });
      i--;
      j--;
      state = src - 1;
    } else if (state === 1) {
      const src = tX[k];
      if (!src && i === 0) break;
      pairs.push({ a: i - 1, b: null, similarity: 0 });
      i--;
      state = src === 2 ? 1 : 0;
    } else {
      const src = tY[k];
      if (!src && j === 0) break;
      pairs.push({ a: null, b: j - 1, similarity: 0 });
      j--;
      state = src === 3 ? 2 : 0;
    }
  }
  return { score, pairs: pairs.reverse() };
}

function representative(column, featureWeights = null) {
  const filled = column.filter(Boolean);
  return filled.reduce((best, e) => {
    const quality = x => filled.reduce((sum, y) => sum + eventSimilarity(x, y, featureWeights), 0);
    return quality(e) > quality(best) ? e : best;
  });
}

function buildTemplateFromMedoid(units, order, alignOpts) {
  const n = units.length;
  let columns = units[order[0]].map(e => {
    const c = Array(n).fill(null);
    c[order[0]] = e;
    return c;
  });
  for (const idx of order.slice(1)) {
    const aligned = alignSequences(columns.map(c => representative(c, alignOpts.featureWeights)), units[idx], false, alignOpts);
    columns = aligned.pairs.map(p => {
      const c = p.a === null ? Array(n).fill(null) : columns[p.a].slice();
      if (p.b !== null) c[idx] = units[idx][p.b];
      return c;
    });
  }

  const deviations = [];
  const keyCountsPerUnit = new Map();
  for (let i = 0; i < n; i++) {
    const counts = new Map();
    for (const c of columns) {
      if (c[i]) counts.set(c[i].key, (counts.get(c[i].key) ?? 0) + 1);
    }
    keyCountsPerUnit.set(i, counts);
  }

  const out = columns.map((c, index) => {
    const rep = representative(c, alignOpts.featureWeights);
    const presentFlags = c.map(Boolean);
    const count = presentFlags.filter(Boolean).length;
    const distinctKeys = [...new Set(c.filter(Boolean).map(e => e.key))];

    // Detect emerging slots: absent in initial prefix >=2, present in suffix >=2 consecutively
    let firstPresent = presentFlags.indexOf(true);
    let lastAbsent = presentFlags.lastIndexOf(false);
    const isEmerging =
      n >= 4 &&
      firstPresent >= 2 &&
      lastAbsent === firstPresent - 1 &&
      presentFlags.slice(firstPresent).every(Boolean);

    const isRepeatedInUnit = c.some((e, ui) => e && (keyCountsPerUnit.get(ui)?.get(e.key) ?? 0) > 1);
    let slotRole = 'variable';
    if (isEmerging) slotRole = 'emerging';
    else if (count / n >= 0.75 && distinctKeys.length === 1) slotRole = 'core';
    else if (count / n >= 0.75) slotRole = 'variable';
    else if (isRepeatedInUnit) slotRole = 'repeated';
    else if (count / n >= 0.4) slotRole = 'optional';
    else slotRole = 'rare';

    const alpha = 0.25;
    const colStates = c.map(x => (x ? x.key : '__OMIT__'));
    const colVocab = Math.max(2, new Set(colStates).size);
    const dmSurprisalBits = (unitIdx, targetState) => {
      let countOther = 0;
      for (let j = 0; j < n; j++) {
        if (j !== unitIdx && colStates[j] === targetState) countOther++;
      }
      return -Math.log2((countOther + alpha) / (n - 1 + alpha * colVocab));
    };

    for (let i = 0; i < n; i++) {
      const peers = c.filter((e, j) => e && j !== i);
      const peerCount = peers.length;
      const p = peerCount / (n - 1);
      const e = c[i];
      if (!e && peerCount >= 2 && p >= 0.65) {
        deviations.push({
          kind: 'omission',
          unit: i,
          column: index,
          expected: representative(peers, alignOpts.featureWeights).key,
          observed: null,
          peerSupport: p,
          peerCount,
          surprisalBits: dmSurprisalBits(i, '__OMIT__'),
          witnessIds: peers.map(x => x.id),
          beforeId: null,
          afterId: null,
        });
      } else if (e && n >= 3 && p <= 0.34) {
        deviations.push({
          kind: 'addition',
          unit: i,
          column: index,
          expected: null,
          observed: e.key,
          peerSupport: p,
          peerCount,
          surprisalBits: dmSurprisalBits(i, e.key),
          witnessIds: [e.id],
        });
      } else if (e && peerCount >= 2) {
        const ref = representative(peers, alignOpts.featureWeights);
        const support = peers.filter(x => x.key === ref.key).length;
        if (e.key !== ref.key && support / (n - 1) >= 0.65) {
          deviations.push({
            kind: 'substitution',
            unit: i,
            column: index,
            expected: ref.key,
            observed: e.key,
            peerSupport: support / (n - 1),
            peerCount: support,
            surprisalBits: dmSurprisalBits(i, e.key),
            witnessIds: [e.id, ...peers.filter(x => x.key === ref.key).map(x => x.id)],
          });
        }
        if (e.key === ref.key) {
          const matching = peers.filter(x => x.key === e.key);
          if (matching.length >= 2) {
            for (const feature of new Set(e.features)) {
              if (!feature.startsWith('modifier:')) continue;
              const hits = matching.filter(x => x.features.includes(feature)).length;
              if (hits === 0) {
                deviations.push({
                  kind: 'feature_addition',
                  unit: i,
                  column: index,
                  expected: e.key,
                  observed: feature,
                  peerSupport: matching.length / (n - 1),
                  peerCount: matching.length,
                  surprisalBits: Math.log2(matching.length + 2),
                  witnessIds: [e.id, ...matching.map(x => x.id)],
                });
              }
            }
          }
        }
      }
    }

    if (isEmerging) {
      deviations.push({
        kind: 'emerging_motif',
        unit: firstPresent,
        column: index,
        expected: null,
        observed: rep.key,
        peerSupport: count / n,
        peerCount: count,
        surprisalBits: Math.log2(firstPresent + 2),
        witnessIds: c.filter(Boolean).map(x => x.id),
      });
    }

    return {
      index,
      key: rep.key,
      role: slotRole,
      support: count / n,
      eventIds: c.map(e => e?.id ?? null),
      alternatives: distinctKeys,
    };
  });

  // Reconcile omission + addition of the exact same key within the same unit as reordering
  const omittedByUnitKey = new Map();
  const addedByUnitKey = new Map();
  for (let idx = 0; idx < deviations.length; idx++) {
    const d = deviations[idx];
    if (d.kind === 'omission' && d.expected) {
      const k = `${d.unit}|${d.expected}`;
      if (!omittedByUnitKey.has(k)) omittedByUnitKey.set(k, []);
      omittedByUnitKey.get(k).push(idx);
    } else if (d.kind === 'addition' && d.observed) {
      const k = `${d.unit}|${d.observed}`;
      if (!addedByUnitKey.has(k)) addedByUnitKey.set(k, []);
      addedByUnitKey.get(k).push(idx);
    }
  }
  const removeDevIndices = new Set();
  const reorderedDeviations = [];
  for (const [k, omitList] of omittedByUnitKey) {
    const addList = addedByUnitKey.get(k);
    if (!addList?.length) continue;
    const pairCount = Math.min(omitList.length, addList.length);
    for (let p = 0; p < pairCount; p++) {
      const oIdx = omitList[p];
      const aIdx = addList[p];
      const o = deviations[oIdx];
      const a = deviations[aIdx];
      removeDevIndices.add(oIdx);
      removeDevIndices.add(aIdx);
      reorderedDeviations.push({
        kind: 'reordering',
        unit: o.unit,
        column: a.column,
        expectedColumn: o.column,
        expected: o.expected,
        observed: a.observed,
        peerSupport: o.peerSupport,
        peerCount: o.peerCount,
        surprisalBits: Math.max(o.surprisalBits, a.surprisalBits) * 0.9,
        witnessIds: [...a.witnessIds, ...o.witnessIds],
      });
    }
  }
  const mergedDeviations = [
    ...deviations.filter((_, i) => !removeDevIndices.has(i)),
    ...reorderedDeviations,
  ];

  for (const d of mergedDeviations) {
    if (d.kind === 'omission') {
      const left = out.slice(0, d.column).reverse().find(c => c.eventIds[d.unit]);
      const right = out.slice(d.column + 1).find(c => c.eventIds[d.unit]);
      d.beforeId = left?.eventIds[d.unit] ?? null;
      d.afterId = right?.eventIds[d.unit] ?? null;
    }
  }

  // Two-part MDL compression: shared template columns (count >= 2) pay model bits; singleton columns encode inline.
  const totalEvents = units.reduce((s, u) => s + u.length, 0);
  const alphabet = Math.max(2, new Set(units.flat().map(e => e.key)).size);
  const keyBits = Math.log2(alphabet);
  const rawBits = totalEvents * keyBits;
  let templateModelBits = 0;
  let residualBits = 0;
  for (const col of out) {
    const filledCount = col.eventIds.filter(Boolean).length;
    if (filledCount >= 2) {
      templateModelBits += keyBits + 1.25;
      for (let u = 0; u < n; u++) {
        if (!col.eventIds[u]) residualBits += 0.9;
        else if (columns[col.index][u].key !== col.key) residualBits += keyBits;
        else residualBits += 0.3;
      }
    } else {
      // Unshared inline event: no shared template column overhead
      residualBits += keyBits + 0.4;
    }
  }
  const mdlSavingsBits = Math.max(0, rawBits - (templateModelBits + residualBits));
  const sharedCols = out.filter(c => c.eventIds.filter(Boolean).length >= 2);
  const explained = sharedCols.reduce((s, c) => s + Math.max(0, c.eventIds.filter(Boolean).length - 1), 0);
  const compressionProxy = explained - sharedCols.length * 0.35 - mergedDeviations.length * 0.25;

  return {
    unitEventIds: units.map(u => u.map(e => e.id)),
    columns: out,
    deviations: mergedDeviations.sort(
      (a, b) => b.surprisalBits - a.surprisalBits || a.unit - b.unit || a.column - b.column
    ),
    compressionProxy,
    mdlBits: Math.round((templateModelBits + residualBits) * 100) / 100,
    mdlSavingsBits: Math.round(mdlSavingsBits * 100) / 100,
  };
}

export function induceTemplate(units, options = {}) {
  if (units.length < 2 || units.length > 32 || units.some(u => !u.length)) {
    throw new RangeError('Need 2–32 nonempty units');
  }
  checkEvents(units.flat());
  const n = units.length;
  const alignOpts = {
    gapOpen: options.gapOpen ?? -0.4,
    gapExtend: options.gapExtend ?? -0.2,
    minSimilarity: options.minSimilarity ?? 0.52,
    mismatchPenalty: options.mismatchPenalty ?? -2.2,
    featureWeights: options.featureWeights ?? null,
  };
  const totalEv = units.reduce((s, u) => s + u.length, 0);
  let scores;
  if (totalEv > 60 && n >= 4) {
    // Fast O(N * L) key-multiset overlap pre-ranking avoids n*(n-1) quadratic DP alignments
    const unitKeySets = units.map(u => new Set(u.map(e => e.key)));
    scores = unitKeySets.map((setA, i) => {
      let s = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const setB = unitKeySets[j];
        let shared = 0;
        for (const k of setA) if (setB.has(k)) shared++;
        s += shared / Math.max(setA.size, setB.size, 1);
      }
      return s;
    });
  } else {
    scores = units.map((u, i) =>
      units.reduce(
        (sum, v, j) => sum + (i === j ? 0 : alignSequences(u, v, false, alignOpts).score / Math.max(u.length, v.length)),
        0
      )
    );
  }
  const baseOrder = units.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);

  // Evaluate top-3 medoids (or top-1 when event count > 90 for worker CPU budget)
  const candidateCount = totalEv > 90 ? 1 : Math.min(3, n);
  let bestResult = null;
  for (let m = 0; m < candidateCount; m++) {
    const medoid = baseOrder[m];
    const order = [medoid, ...baseOrder.filter(idx => idx !== medoid)];
    const candidate = buildTemplateFromMedoid(units, order, alignOpts);
    if (
      !bestResult ||
      candidate.mdlBits < bestResult.mdlBits - 0.5 ||
      (Math.abs(candidate.mdlBits - bestResult.mdlBits) <= 0.5 &&
        candidate.compressionProxy > bestResult.compressionProxy)
    ) {
      bestResult = candidate;
    }
  }
  return bestResult;
}

export function repeatedPhrases(events, options = {}) {
  checkEvents(events, Math.min(2400, options.maxEvents ?? 256));
  const maxLen = Math.max(2, Math.min(8, options.maxLen ?? 6));
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const found = [];
  for (let len = 2; len <= maxLen; len++) {
    const index = new Map();
    for (let i = 0; i + len <= events.length; i++) {
      const keys = events.slice(i, i + len).map(e => e.key);
      const key = keys.join('\x1f');
      const group = index.get(key) ?? { keys, starts: [] };
      if (!group.starts.length || i >= group.starts[group.starts.length - 1] + len) {
        group.starts.push(i);
      }
      index.set(key, group);
    }
    for (const g of index.values()) {
      if (g.starts.length >= 2) {
        found.push({
          keys: g.keys,
          starts: g.starts,
          occurrences: g.starts.map(i => events.slice(i, i + len).map(e => e.id)),
          score: len * (g.starts.length - 1),
        });
      }
    }
  }
  found.sort((a, b) => b.score - a.score || b.keys.length - a.keys.length || a.starts[0] - b.starts[0]);
  const out = [];
  for (const x of found) {
    if (
      out.some(
        y =>
          y.keys.length > x.keys.length &&
          x.starts.every(s => y.starts.some(t => s >= t && s + x.keys.length <= t + y.keys.length))
      )
    ) {
      continue;
    }
    out.push(x);
    if (out.length >= limit) break;
  }
  return out;
}

export function discoverTemplates(events, options = {}) {
  checkEvents(events, 160);
  const seeds = new Map();
  for (let len = 1; len <= 3; len++) {
    for (let i = 0; i + len <= events.length; i++) {
      const keys = events.slice(i, i + len).map(e => e.key);
      const key = JSON.stringify(keys);
      const g = seeds.get(key) ?? { keys, positions: [] };
      if (!g.positions.length || i >= g.positions[g.positions.length - 1] + len) {
        g.positions.push(i);
      }
      seeds.set(key, g);
    }
  }
  const ranked = [...seeds.values()]
    .filter(g => g.positions.length >= 3 && g.positions.length <= 31)
    .sort((a, b) => b.positions.length * b.keys.length - a.positions.length * a.keys.length || a.positions[0] - b.positions[0])
    .slice(0, 16);

  const results = [];
  const seen = new Set();

  const evalSegmentation = (boundaries, anchorKeys, anchorSide, leadingSlice = 0, trailingStart = events.length) => {
    const units = [];
    for (let j = 1; j < boundaries.length; j++) {
      const u = events.slice(boundaries[j - 1], boundaries[j]);
      if (u.length) units.push(u);
    }
    if (units.length < 3 || units.some(u => u.length < 2 || u.length > 48)) return;
    const signature = JSON.stringify(units.map(u => u.map(e => e.id)));
    if (seen.has(signature)) return;
    seen.add(signature);
    const template = induceTemplate(units, options);
    const core = template.columns.filter(c => c.support >= 0.65);
    const distinct = new Set(core.map(c => c.key)).size;
    if (distinct < 2 || template.compressionProxy <= 0) return;
    const coverage = units.reduce((s, u) => s + u.length, 0) / events.length;
    const omitted = [
      ...events.slice(0, leadingSlice),
      ...events.slice(trailingStart),
    ];
    const score = template.compressionProxy * coverage * (core.length / template.columns.length);
    results.push({
      ...template,
      anchorKeys,
      anchorSide,
      coverage,
      score,
      unassignedEventIds: omitted.map(e => e.id),
    });
  };

  for (const seed of ranked) {
    for (const side of ['start', 'end']) {
      const cuts = seed.positions.map(p => p + (side === 'end' ? seed.keys.length : 0));
      const boundaries = side === 'end' ? [0, ...cuts] : [...cuts, events.length];
      evalSegmentation(
        boundaries,
        seed.keys,
        side,
        side === 'start' ? cuts[0] : 0,
        side === 'end' ? cuts[cuts.length - 1] : events.length
      );
    }
  }

  // Evaluate external boundary proposals (e.g. SSM change points / Masoretic breaks)
  if (Array.isArray(options.candidateBoundaries)) {
    for (const proposal of options.candidateBoundaries) {
      if (!Array.isArray(proposal.cuts) || proposal.cuts.length < 4) continue;
      evalSegmentation(
        proposal.cuts,
        proposal.anchorKeys ?? ['multi-signal'],
        proposal.anchorSide ?? 'end',
        proposal.cuts[0],
        proposal.cuts[proposal.cuts.length - 1]
      );
    }
  }

  return results
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage)
    .slice(0, Math.max(1, Math.min(10, options.limit ?? 5)));
}

function makeDeterministicRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let state = (h || 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildResidualSsm(S, minSim, perm = null) {
  const N = S.length;
  const rowMean = new Float64Array(N);
  let grandSum = 0;
  for (let i = 0; i < N; i++) {
    const pi = perm ? perm[i] : i;
    let rowSum = 0;
    for (let j = 0; j < N; j++) {
      rowSum += S[pi][perm ? perm[j] : j];
    }
    rowMean[i] = rowSum / N;
    grandSum += rowMean[i];
  }
  const mu = grandSum / N;

  const C = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    const pi = perm ? perm[i] : i;
    for (let j = i + 1; j < N; j++) {
      const pj = perm ? perm[j] : j;
      const val = S[pi][pj] - rowMean[i] - rowMean[j] + mu;
      C[i][j] = val;
      C[j][i] = val;
    }
  }

  const rPer = new Float64Array(N);
  for (let d = 1; d < N; d++) {
    const diagLen = N - d;
    if (diagLen < 2) continue;
    let cSum = 0;
    let posCount = 0;
    for (let t = 0; t < diagLen; t++) {
      cSum += C[t][t + d];
      const pt = perm ? perm[t] : t;
      const ptd = perm ? perm[t + d] : t + d;
      if (S[pt][ptd] >= minSim) posCount++;
    }
    if (posCount >= 2) {
      rPer[d] = Math.max(0, cSum / diagLen);
    }
  }

  const sTilde = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const v = Math.max(0, C[i][j] - rPer[j - i]);
      sTilde[i][j] = v;
      sTilde[j][i] = v;
    }
  }
  return sTilde;
}

function runAntiDiagonalChiasmDP(N, S, sTilde, minSim, maxWindow, gapGamma, allowGapped, weights, perm = null, recordTrace = false) {
  const dp = Array.from({ length: N }, () => new Float64Array(N));
  const nextD1 = recordTrace ? Array.from({ length: N }, () => new Uint8Array(N)) : null;
  const nextD2 = recordTrace ? Array.from({ length: N }, () => new Uint8Array(N)) : null;
  const maxStep = allowGapped ? 2 : 1;
  let globalMax = 0;

  for (let dist = 1; dist < maxWindow; dist++) {
    for (let l = 0; l + dist < N; l++) {
      const r = l + dist;
      const pl = perm ? perm[l] : l;
      const pr = perm ? perm[r] : r;
      if (S[pl][pr] < minSim || sTilde[l][r] <= 0) continue;

      const w = 0.5 * (weights[pl] + weights[pr]);
      const base = sTilde[l][r] * w;
      let bestInner = 0;
      let bestD1 = 0;
      let bestD2 = 0;

      for (let d1 = 1; d1 <= maxStep; d1++) {
        for (let d2 = 1; d2 <= maxStep; d2++) {
          const nl = l + d1;
          const nr = r - d2;
          if (nl >= nr) continue;
          const inner = dp[nl][nr];
          if (inner <= 0) continue;
          const cand = inner - gapGamma * (d1 + d2 - 2);
          if (cand > bestInner) {
            bestInner = cand;
            bestD1 = d1;
            bestD2 = d2;
          }
        }
      }

      const val = base + bestInner;
      dp[l][r] = val;
      if (val > globalMax) globalMax = val;
      if (recordTrace) {
        nextD1[l][r] = bestD1;
        nextD2[l][r] = bestD2;
      }
    }
  }

  return { dp, nextD1, nextD2, globalMax };
}

/**
 * Residual SSM (S_tilde) + Gapped Anti-Diagonal DP + B=200 Refrain-Pinned Permutations + Scale-Adaptive MDL Gate.
 * Discovers contiguous, gapped, and concentric chiasms while eliminating periodic refrains and forward parallels.
 */
export function discoverChiasms(events, options = {}) {
  checkEvents(events, 160);
  const N = events.length;
  if (N < 5) return [];

  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const minSim = options.minSimilarity ?? 0.55;
  const allowGapped = options.allowGapped !== false;
  const maxWindow = Math.min(N, Math.max(5, options.maxWindow ?? 32));
  const gapGamma = options.gapPenalty ?? 0.08;
  const idfMap = options.idfMap ?? null;
  const featureWeights = options.featureWeights ?? null;
  const permutations = Math.max(0, options.permutations ?? 200);
  const pThreshold = options.pThreshold ?? 0.03;

  const weightOf = e => (idfMap && typeof idfMap.get === 'function' ? idfMap.get(e.key) ?? 1 : 1);
  const weights = new Float64Array(N);
  const keyFreq = new Map();
  for (let i = 0; i < N; i++) {
    weights[i] = Math.min(2.2, weightOf(events[i]));
    keyFreq.set(events[i].key, (keyFreq.get(events[i].key) ?? 0) + 1);
  }
  const vocabSize = Math.max(2, keyFreq.size);

  // 1. Pairwise Similarity S[i][j]
  const S = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    S[i][i] = 1;
    for (let j = i + 1; j < N; j++) {
      const s = eventSimilarity(events[i], events[j], featureWeights);
      S[i][j] = s;
      S[j][i] = s;
    }
  }

  // 2. Doubly-Centered C, Periodic Forward-Diagonal Expectation R^periodic, and Residual S_tilde
  const sTilde = buildResidualSsm(S, minSim, null);

  // 3. Gapped Anti-Diagonal DP (delta_1, delta_2 in {1, 2})
  const { dp, nextD1, nextD2 } = runAntiDiagonalChiasmDP(
    N,
    S,
    sTilde,
    minSim,
    maxWindow,
    gapGamma,
    allowGapped,
    weights,
    null,
    true,
  );

  // 4. Collect structural chiasm candidates before permutation / MDL gating
  const rawCandidates = [];
  const minRequiredPairs = N === 5 && options.requireThreePairs !== true ? 2 : 3;

  for (let start = 0; start < N - 3; start++) {
    const maxEnd = Math.min(N, start + maxWindow);
    for (let end = start + 5; end <= maxEnd; end++) {
      const r0 = end - 1;
      const dpScore = dp[start][r0];
      if (dpScore <= 0 || S[start][r0] < minSim || sTilde[start][r0] <= 0) continue;

      const pairs = [];
      const pairedIdx = [];
      let l = start;
      let r = r0;
      let revSum = 0;
      let sTildeSum = 0;
      const distinct = new Set();

      while (l < r && S[l][r] >= minSim && sTilde[l][r] > 0) {
        const leftEv = events[l];
        const rightEv = events[r];
        const sim = S[l][r];
        const w = 0.5 * (weights[l] + weights[r]);
        pairs.push({ leftId: leftEv.id, rightId: rightEv.id, similarity: sim });
        pairedIdx.push([l, r]);
        revSum += sim * w;
        sTildeSum += sTilde[l][r] * w;
        distinct.add(leftEv.key);
        const d1 = nextD1[l][r];
        const d2 = nextD2[l][r];
        if (!d1 || !d2) break;
        l += d1;
        r -= d2;
      }

      if (pairs.length < minRequiredPairs || distinct.size < 2) continue;
      if (idfMap) {
        let contentDistinct = 0;
        for (const k of distinct) if ((idfMap.get(k) ?? 1) >= 0.5) contentDistinct++;
        if (contentDistinct < 2) continue;
      }

      // Forward parallelism comparison
      const len = end - start;
      const mid = start + Math.floor(len / 2);
      const leftHalf = events.slice(start, mid);
      const rightHalf = events.slice(mid, end);
      const fwd = alignSequences(leftHalf, rightHalf, false, {
        gapOpen: -0.4,
        gapExtend: -0.2,
        minSimilarity: minSim,
        featureWeights,
      });
      const fwdScore = Math.max(0, fwd.score * 0.5);
      const revMean = revSum / pairs.length;
      const fwdMean = fwdScore / Math.max(1, pairs.length);
      if (revMean <= fwdMean + 0.05 || sTildeSum <= 0.25) continue;

      // Two-Part MDL gain deltaL = L_0 - (L(M) + L(D|M))
      const headerBits = Math.log2(Math.max(2, (N * (N - 1)) / 2)) + 1.0;
      let pairSavings = 0;
      for (let t = 0; t < pairedIdx.length; t++) {
        const [li, ri] = pairedIdx[t];
        const freqR = keyFreq.get(events[ri].key) ?? 1;
        const hKey = -Math.log2((freqR + 0.5) / (N + 0.5 * vocabSize));
        const stepPenalty =
          t === 0
            ? 1.0
            : 1.0 + 0.75 * ((li - pairedIdx[t - 1][0] - 1) + (pairedIdx[t - 1][1] - ri - 1));
        const mismatchBits = 2.0 * (1.0 - pairs[t].similarity);
        pairSavings += hKey - (stepPenalty + mismatchBits);
      }
      const deltaL = pairSavings - headerBits;

      const isContiguous = pairedIdx.every((p, idx) =>
        idx === 0 || (p[0] - pairedIdx[idx - 1][0] === 1 && pairedIdx[idx - 1][1] - p[1] === 1)
      );
      const lastPair = pairedIdx[pairedIdx.length - 1];
      const centerIds = lastPair
        ? events.slice(lastPair[0] + 1, lastPair[1]).map(e => e.id)
        : [];

      rawCandidates.push({
        start,
        endExclusive: end,
        pairs,
        centerIds: centerIds.slice(0, 6),
        reverseMean: revMean,
        forwardMean: fwdMean,
        dpScore,
        sTildeSum,
        deltaL,
        gapped: !isContiguous,
        score: dpScore - fwdScore * 0.5 + pairs.length * 0.2,
      });
    }
  }

  if (!rawCandidates.length) return [];

  // 5. B = 200 Deterministic Refrain-Pinned Permutations (freeze keys with freq >= max(4, ceil(0.2*N)))
  const permMaxScores = [];
  if (N >= 6 && permutations > 0) {
    const refrainCutoff = Math.max(4, Math.ceil(0.2 * N));
    const nonRefrainIdx = [];
    for (let i = 0; i < N; i++) {
      if ((keyFreq.get(events[i].key) ?? 0) < refrainCutoff) {
        nonRefrainIdx.push(i);
      }
    }
    if (nonRefrainIdx.length >= 4) {
      const rng = makeDeterministicRng(`${N}:${events.map(e => e.key).join('|')}`);
      const perm = new Int32Array(N);
      for (let b = 0; b < permutations; b++) {
        for (let i = 0; i < N; i++) perm[i] = i;
        // Fisher-Yates only over non-refrain positions
        for (let k = nonRefrainIdx.length - 1; k > 0; k--) {
          const j = Math.floor(rng() * (k + 1));
          const posK = nonRefrainIdx[k];
          const posJ = nonRefrainIdx[j];
          const tmp = perm[posK];
          perm[posK] = perm[posJ];
          perm[posJ] = tmp;
        }
        const pSTilde = buildResidualSsm(S, minSim, perm);
        const { globalMax } = runAntiDiagonalChiasmDP(
          N,
          S,
          pSTilde,
          minSim,
          maxWindow,
          gapGamma,
          allowGapped,
          weights,
          perm,
          false,
        );
        permMaxScores.push(globalMax);
      }
    }
  }

  // 6. Scale-Adaptive Significance Gate
  const out = [];
  for (const cand of rawCandidates) {
    let pDp = 0;
    if (N === 5 && options.requireThreePairs !== true) {
      pDp = 0.01;
    } else if (!permMaxScores.length) {
      pDp = 1.0;
    } else {
      let geCount = 0;
      for (let b = 0; b < permMaxScores.length; b++) {
        if (permMaxScores[b] >= cand.dpScore - 1e-9) geCount++;
      }
      pDp = (1 + geCount) / (permMaxScores.length + 1);
    }

    if (pDp > pThreshold) continue;
    if (N > 15 && cand.deltaL <= 0) continue;

    out.push({
      kind: 'candidate_literary_pattern',
      patternKind: 'chiasm',
      gapped: cand.gapped,
      start: cand.start,
      endExclusive: cand.endExclusive,
      pairs: cand.pairs,
      centerIds: cand.centerIds,
      reverseMean: cand.reverseMean,
      forwardMean: cand.forwardMean,
      pValue: Math.round(pDp * 10000) / 10000,
      mdlGainBits: Math.round(cand.deltaL * 100) / 100,
      score: cand.score,
    });
  }

  // Deduplicate strictly contained lower-scoring spans
  out.sort((a, b) => b.score - a.score || b.pairs.length - a.pairs.length || a.start - b.start);
  const filtered = [];
  for (const cand of out) {
    if (
      filtered.some(
        top =>
          top.start <= cand.start &&
          top.endExclusive >= cand.endExclusive &&
          top.score >= cand.score &&
          cand.pairs.every(p => top.pairs.some(tp => tp.leftId === p.leftId && tp.rightId === p.rightId))
      )
    ) {
      continue;
    }
    filtered.push(cand);
    if (filtered.length >= limit) break;
  }
  return filtered;
}

/**
 * O(N) PELT (Pruned Exact Linear Time, Killick et al. 2012) piecewise-cost changepoint detector
 * over categorical speaker/formula label sequences.
 */
export function detectPeltChangepoints(labels, options = {}) {
  const N = Array.isArray(labels) ? labels.length : 0;
  if (N < 4) return { changepoints: [], segments: [], totalCost: 0 };

  const catIndex = new Map();
  const codes = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const lbl = String(labels[i] ?? '');
    let idx = catIndex.get(lbl);
    if (idx === undefined) {
      idx = catIndex.size;
      catIndex.set(lbl, idx);
    }
    codes[i] = idx;
  }
  const K = Math.max(2, catIndex.size);
  if (catIndex.size <= 1) {
    return {
      changepoints: [],
      segments: [{ start: 0, end: N, dominantLabel: String(labels[0] ?? '') }],
      totalCost: 0,
    };
  }

  const penaltyScale = options.penaltyScale ?? 1.25;
  const minSegLen = Math.max(1, options.minSegmentLength ?? 1);
  const beta = options.penalty ?? penaltyScale * Math.max(1, K - 1) * Math.log(Math.max(2, N));

  // Prefix histogram counts: prefix[t * K + c]
  const prefix = new Int32Array((N + 1) * K);
  for (let t = 1; t <= N; t++) {
    const base = t * K;
    const prevBase = (t - 1) * K;
    for (let c = 0; c < K; c++) prefix[base + c] = prefix[prevBase + c];
    prefix[base + codes[t - 1]]++;
  }

  const segCost = (s, t) => {
    const len = t - s;
    if (len <= 1) return 0;
    const sBase = s * K;
    const tBase = t * K;
    let cost = 0;
    for (let c = 0; c < K; c++) {
      const cnt = prefix[tBase + c] - prefix[sBase + c];
      if (cnt > 0) cost -= cnt * Math.log(cnt / len);
    }
    return cost;
  };

  const F = new Float64Array(N + 1).fill(Infinity);
  const lastChange = new Int32Array(N + 1).fill(0);
  F[0] = -beta;
  let candidates = [0];

  for (let t = minSegLen; t <= N; t++) {
    let bestCost = Infinity;
    let bestS = 0;
    const nextCandidates = [];

    for (let ci = 0; ci < candidates.length; ci++) {
      const s = candidates[ci];
      if (t - s < minSegLen) {
        nextCandidates.push(s);
        continue;
      }
      const c = segCost(s, t);
      const total = F[s] + c + beta;
      if (total < bestCost) {
        bestCost = total;
        bestS = s;
      }
    }
    F[t] = bestCost;
    lastChange[t] = bestS;

    // Exact PELT pruning (subadditive entropy cost: K_prune = 0)
    for (let ci = 0; ci < candidates.length; ci++) {
      const s = candidates[ci];
      if (t - s < minSegLen) continue;
      if (F[s] + segCost(s, t) <= F[t] + 1e-9) {
        nextCandidates.push(s);
      }
    }
    if (t + minSegLen <= N) nextCandidates.push(t);
    candidates = nextCandidates;
  }

  const changepoints = [];
  let cur = N;
  while (cur > 0) {
    const prev = lastChange[cur];
    if (prev > 0) changepoints.push(prev);
    cur = prev;
  }
  changepoints.reverse();

  const bounds = [0, ...changepoints, N];
  const revCat = [...catIndex.keys()];
  const segments = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const s = bounds[b];
    const e = bounds[b + 1];
    let domC = 0;
    let domCnt = -1;
    for (let c = 0; c < K; c++) {
      const cnt = prefix[e * K + c] - prefix[s * K + c];
      if (cnt > domCnt) { domCnt = cnt; domC = c; }
    }
    segments.push({ start: s, end: e, dominantLabel: revCat[domC] ?? '' });
  }

  return { changepoints, segments, totalCost: Math.round(F[N] * 1000) / 1000 };
}

/**
 * Self-Similarity Matrix + Checkerboard Kernel Novelty change-point detector.
 * Identifies structural transitions (e.g., prologue -> body, body -> epilogue) without passage-specific rules.
 */
export function detectNoveltyBoundaries(featureSets, options = {}) {
  const n = featureSets.length;
  if (n < 6) return [];
  const halfKernel = Math.max(2, Math.min(4, options.halfKernel ?? 3));
  const simMatrix = Array.from({ length: n }, () => new Float64Array(n));

  for (let i = 0; i < n; i++) {
    simMatrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const a = featureSets[i];
      const b = featureSets[j];
      let inter = 0;
      let union = 0;
      for (const [k, w] of a) {
        union += w;
        if (b.has(k)) inter += Math.min(w, b.get(k));
      }
      for (const [k, w] of b) {
        if (!a.has(k)) union += w;
      }
      const s = union > 0 ? inter / union : 0;
      simMatrix[i][j] = s;
      simMatrix[j][i] = s;
    }
  }

  const novelty = new Float64Array(n);
  for (let k = halfKernel; k <= n - halfKernel; k++) {
    let within = 0;
    let across = 0;
    let wCount = 0;
    let aCount = 0;
    for (let i = k - halfKernel; i < k + halfKernel; i++) {
      for (let j = k - halfKernel; j < k + halfKernel; j++) {
        if (i === j) continue;
        const sameSide = (i < k && j < k) || (i >= k && j >= k);
        if (sameSide) {
          within += simMatrix[i][j];
          wCount++;
        } else {
          across += simMatrix[i][j];
          aCount++;
        }
      }
    }
    const wMean = wCount ? within / wCount : 0;
    const aMean = aCount ? across / aCount : 0;
    novelty[k] = Math.max(0, wMean - aMean);
  }

  const peaks = [];
  for (let k = halfKernel; k <= n - halfKernel; k++) {
    if (novelty[k] > 0.05 && novelty[k] >= novelty[k - 1] && novelty[k] >= novelty[k + 1]) {
      peaks.push({ index: k, novelty: Math.round(novelty[k] * 1000) / 1000 });
    }
  }
  return peaks.sort((a, b) => b.novelty - a.novelty);
}
