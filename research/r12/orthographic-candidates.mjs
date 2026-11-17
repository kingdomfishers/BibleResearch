/**
 * R12 optional offline helper: candidate *spelling* similarities, never etymologies.
 * Standalone, no dependencies or corpus reads. Integrate into existing R12 builder;
 * this is not a replacement discovery engine. All indexes are per language.
 */
const LANGUAGE = { hebrew: 'he', he: 'he', greek: 'grc', grc: 'grc' };

export function normalizeOriginalForm(form, language) {
  const lang = LANGUAGE[language];
  if (!lang || typeof form !== 'string') throw new TypeError('Expected Hebrew/Greek string');
  let s = form.normalize('NFD');
  if (lang === 'he') {
    return [...s].filter(c => /[\u05d0-\u05ea]/u.test(c)).join('');
  }
  s = s.replace(/\p{Mark}/gu, '').toLowerCase().replace(/ς/g, 'σ');
  return [...s].filter(c => /\p{Script=Greek}/u.test(c)).join('');
}

function bigrams(s) {
  const a = [...s];
  return new Set(a.slice(0, -1).map((c, i) => c + a[i + 1]));
}

function longestSharedSegment(a, b) {
  const x = [...a], y = [...b];
  let last = new Array(y.length + 1).fill(0), best = { length: 0, a_start: -1, b_start: -1 };
  for (let i = 1; i <= x.length; i++) {
    const next = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] !== y[j - 1]) continue;
      next[j] = last[j - 1] + 1;
      if (next[j] > best.length) best = { length: next[j], a_start: i - next[j], b_start: j - next[j] };
    }
    last = next;
  }
  return { ...best, text: best.length ? x.slice(best.a_start, best.a_start + best.length).join('') : '' };
}

export function buildOrthographicIndex(entries) {
  const byId = new Map(), postings = new Map();
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || byId.has(e.id)) throw new TypeError('Missing/duplicate form ID');
    const lang = LANGUAGE[e.language];
    const normalized = normalizeOriginalForm(e.form, e.language);
    if (!lang || [...normalized].length < 2) continue;
    const row = Object.freeze({ id: e.id, language: lang, original: e.form, normalized });
    byId.set(row.id, row);
    for (const gram of bigrams(normalized)) {
      const k = lang + '|' + gram;
      if (!postings.has(k)) postings.set(k, []);
      postings.get(k).push(row.id);
    }
  }
  for (const ids of postings.values()) ids.sort();
  return { byId, postings, count: byId.size };
}

export function findOrthographicCandidates(index, anchorId, options = {}) {
  const anchor = index.byId.get(anchorId);
  if (!anchor) return { anchor_id: anchorId, results: [], coverage: 'unknown_anchor' };
  const maxPostingSize = options.maxPostingSize ?? 4096;
  const maxCandidates = options.maxCandidates ?? 4096;
  const limit = options.limit ?? 24;
  const minScore = options.minScore ?? 0.5;
  const groups = [...bigrams(anchor.normalized)].map(g => ({
    gram: g, ids: index.postings.get(anchor.language + '|' + g) ?? [],
  })).sort((a, b) => a.ids.length - b.ids.length || a.gram.localeCompare(b.gram));
  const candidateIds = new Set();
  let densePostings = 0, truncatedPool = false;
  for (const group of groups) {
    if (group.ids.length > maxPostingSize) { densePostings++; continue; }
    for (const id of group.ids) {
      if (id === anchorId || candidateIds.has(id)) continue;
      if (candidateIds.size >= maxCandidates) { truncatedPool = true; break; }
      candidateIds.add(id);
    }
    if (truncatedPool) break;
  }
  const a = bigrams(anchor.normalized), output = [];
  for (const id of candidateIds) {
    const row = index.byId.get(id);
    if (!row || row.language !== anchor.language) continue;
    const common = longestSharedSegment(anchor.normalized, row.normalized);
    if (common.length < 2) continue;
    const b = bigrams(row.normalized);
    const shared = [...a].filter(g => b.has(g)).length;
    const jaccard = shared / (a.size + b.size - shared || 1);
    const shorter = Math.min([...anchor.normalized].length, [...row.normalized].length);
    const longer = Math.max([...anchor.normalized].length, [...row.normalized].length);
    const containment = common.length / shorter;
    const score = 0.6 * containment + 0.25 * jaccard + 0.15 * containment * shorter / longer;
    if (score < minScore) continue;
    output.push({
      anchor_id: anchor.id, target_id: row.id, target_form: row.original,
      relation_type: 'ORTHOGRAPHIC_SIMILARITY', epistemic_layer: 'HYPOTHESIS',
      normalization: anchor.language === 'he' ? 'hebrew_unpointed' : 'greek_unaccented',
      anchor_original: anchor.original, matched_normalized_text: common.text,
      anchor_start: common.a_start, target_start: common.b_start,
      normalized_form_equal: anchor.normalized === row.normalized,
      score: Number(score.toFixed(6)),
      limitation: 'Shared spelling does not establish root, etymology, meaning, or intentional wordplay.',
    });
  }
  output.sort((a, b) => b.score - a.score || a.target_id.localeCompare(b.target_id));
  return {
    anchor_id: anchor.id, results: output.slice(0, limit),
    coverage: (densePostings || truncatedPool || output.length > limit) ? 'bounded_partial' : 'complete_for_index',
    diagnostics: { indexed_forms: index.count, candidate_pool: candidateIds.size, dense_postings_skipped: densePostings, pool_truncated: truncatedPool, matching_results: output.length },
  };
}
