// @file: src/relationships/symbolic-patterns.ts
// Algorithm C: Scriptural self-interpretation extraction (with strict referent separation),
// MACULA/R8 structured role-frame matching, and symbolic/prophetic chain assembly.
// Pure TypeScript; zero hardcoded verse pairs.

export interface VerseTokenLite {
  wn?: number;
  sf?: string;
  lm?: string;
  s: string;
  g?: string;
  cl?: string;
}

export interface VerseInputLite {
  verse_id: number;
  book: number;
  chapter: number;
  verse: number;
  ref: string;
  en: string;
  toks: VerseTokenLite[];
}

export interface SelfInterpretationRecord {
  id: string;
  verse_id: number;
  ref: string;
  language: 'hbo' | 'grc';
  cue_kind:
    | 'greek_copula_identification'
    | 'greek_antitype_link'
    | 'hebrew_vision_qa_explanation'
    | 'hebrew_demonstrative_identification';
  symbol_strongs: string[];
  referent_strongs: string[];
  symbol_summary: string;
  referent_summary: string;
  witness_vids: number[];
  strict_referent_note: string;
}

const SKIP_CONTENT_STRONGS = new Set([
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834', 'H1931', 'H0859',
  'H0589', 'H2088', 'H2063', 'H0428', 'H1992', 'H3605', 'H3808', 'H3541', 'H3651', 'H4100',
  'H0559', 'H1696', 'H1961', 'H7200', 'H3190',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473', 'G4771', 'G3778',
  'G3739', 'G5100', 'G5101', 'G1438', 'G1510', 'G1063', 'G3361', 'G3756', 'G3761', 'G0235',
  'G1537', 'G0575', 'G2596', 'G3326', 'G4012', 'G4314', 'G5228', 'G5613', 'G3004', 'G1492',
  'G2400', 'G3568', 'G2531', 'G1163', 'G3767',
]);

const SKIP_POS = new Set([
  'conjunction', 'preposition', 'article', 'particle', 'pronoun', 'interjection', 'adverb',
  'cj', 'prep', 'ptcl', 'adv', 'rel', 'om', 'intj', 'pron', 'det',
]);

function isContentToken(tok: VerseTokenLite): boolean {
  if (!tok.s || /^H900/.test(tok.s) || SKIP_CONTENT_STRONGS.has(tok.s)) return false;
  const cl = (tok.cl || '').toLowerCase();
  return !SKIP_POS.has(cl);
}

function isNominalLike(tok: VerseTokenLite): boolean {
  if (!isContentToken(tok)) return false;
  const cl = (tok.cl || '').toLowerCase();
  if (!cl) return true;
  return cl === 'noun' || cl === 'adj' || cl === 'num' || cl === 'nmpr' || cl === 'subs' || cl === 'n';
}

function isSymbolicCandidateNoun(tok: VerseTokenLite, rareCutoff: number, dfMap?: ReadonlyMap<string, number>): boolean {
  if (!isNominalLike(tok)) return false;
  const df = dfMap?.get(tok.s) ?? 50;
  return df <= rareCutoff;
}

/**
 * Scan canonical verses for explicit biblical self-interpretation statements
 * (Greek demonstrative/relative + copula identifications, antitype declarations,
 * and Hebrew prophetic vision Q&A or "these are..." symbol explanations).
 * Preserves clause-local symbol -> referent separation.
 */
export function extractScripturalInterpretations(
  verses: VerseInputLite[],
  dfMap?: ReadonlyMap<string, number>,
): SelfInterpretationRecord[] {
  const byVid = new Map<number, VerseInputLite>();
  for (const v of verses) byVid.set(v.verse_id, v);

  const out: SelfInterpretationRecord[] = [];
  const seenKey = new Set<string>();

  for (const v of verses) {
    const toks = v.toks || [];
    if (toks.length === 0) continue;
    const isNt = v.book >= 40;

    if (isNt) {
      // 1. Greek antitype explicit bridge (e.g., G0499 antitypon in 1 Pet 3:21 -> previous verse imagery)
      const antiIdx = toks.findIndex(t => t.s === 'G0499');
      if (antiIdx >= 0) {
        const afterNouns = toks.slice(antiIdx + 1).filter(t => isNominalLike(t)).slice(0, 3);
        const prevVerse = byVid.get(v.verse_id - 1);
        const contextNouns = [
          ...toks.slice(Math.max(0, antiIdx - 6), antiIdx).filter(t => isSymbolicCandidateNoun(t, 400, dfMap)),
          ...(prevVerse ? prevVerse.toks.filter(t => isSymbolicCandidateNoun(t, 160, dfMap)) : []),
        ].slice(0, 4);
        if (afterNouns.length > 0 && contextNouns.length > 0) {
          const id = `r13:interp:${v.verse_id}:anti`;
          if (!seenKey.has(id)) {
            seenKey.add(id);
            out.push({
              id,
              verse_id: v.verse_id,
              ref: v.ref,
              language: 'grc',
              cue_kind: 'greek_antitype_link',
              symbol_strongs: [...new Set(contextNouns.map(t => t.s))],
              referent_strongs: [...new Set(afterNouns.map(t => t.s))],
              symbol_summary: contextNouns.map(t => `${t.lm || t.sf || t.s} (${t.g || t.s})`).join(', '),
              referent_summary: afterNouns.map(t => `${t.lm || t.sf || t.s} (${t.g || t.s})`).join(', '),
              witness_vids: prevVerse ? [prevVerse.verse_id, v.verse_id] : [v.verse_id],
              strict_referent_note: `Explicit antitype statement in ${v.ref}; keep the antitype referent distinct from any other nearby typological details.`,
            });
          }
        }
      }

      // 2. Clause-local relative/demonstrative + copula (G3739/G3778 + G1510 "which are / these are / that is")
      const isPrepGoverned = (idx: number): boolean => {
        const p1 = idx > 0 ? toks[idx - 1] : null;
        const p2 = idx > 1 ? toks[idx - 2] : null;
        const isPrep = (t: VerseTokenLite | null) => Boolean(t && ((t.cl || '').toLowerCase() === 'prep' || SKIP_CONTENT_STRONGS.has(t.s) && /^G(?:1799|1722|1909|4314|5259|1537|0575|3326|2596)$/.test(t.s)));
        return isPrep(p1) || Boolean(p1 && (p1.cl || '').toLowerCase() === 'det' && isPrep(p2));
      };
      for (let i = 1; i < toks.length - 1; i++) {
        if (toks[i].s !== 'G1510') continue;
        const prevTok = toks[i - 1];
        const hasMarker =
          prevTok.s === 'G3739' ||
          prevTok.s === 'G3778' ||
          (i >= 2 && (toks[i - 2].s === 'G3739' || toks[i - 2].s === 'G3778')) ||
          toks[i + 1]?.s === 'G3778';
        if (!hasMarker) continue;

        // Walk backward within current clause boundary up to 10 tokens, skipping preposition-governed modifiers
        const leftCandidates: VerseTokenLite[] = [];
        for (let l = i - 1; l >= Math.max(0, i - 10); l--) {
          const lt = toks[l];
          if (l < i - 1 && (lt.s === 'G1510' || lt.s === 'G2532')) {
            if (leftCandidates.length > 0) break;
          }
          if (isPrepGoverned(l)) continue;
          if (isSymbolicCandidateNoun(lt, 450, dfMap)) {
            leftCandidates.unshift(lt);
            if (leftCandidates.length >= 3) break;
          }
        }

        const rightCandidates: VerseTokenLite[] = [];
        for (let r = i + 1; r < Math.min(toks.length, i + 9); r++) {
          const rt = toks[r];
          if (r > i + 1 && (rt.s === 'G1510' || rt.s === 'G2532') && rightCandidates.length >= 1) break;
          if (isNominalLike(rt)) {
            rightCandidates.push(rt);
            if (rightCandidates.length >= 3) break;
          }
        }

        if (leftCandidates.length === 0 || rightCandidates.length === 0) continue;
        // Require at least one rare or visionary/symbolic noun rather than trivial pronouns/generics
        const hasRareSymbol = leftCandidates.some(t => (dfMap?.get(t.s) ?? 999) <= 220);
        if (!hasRareSymbol) continue;

        const symStrongs = [...new Set(leftCandidates.map(t => t.s))];
        const refStrongs = [...new Set(rightCandidates.map(t => t.s))];
        if (symStrongs.every(s => refStrongs.includes(s))) continue;

        const id = `r13:interp:${v.verse_id}:${i}`;
        if (seenKey.has(id)) continue;
        seenKey.add(id);

        const symDesc = leftCandidates.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        const refDesc = rightCandidates.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        out.push({
          id,
          verse_id: v.verse_id,
          ref: v.ref,
          language: 'grc',
          cue_kind: 'greek_copula_identification',
          symbol_strongs: symStrongs,
          referent_strongs: refStrongs,
          symbol_summary: symDesc,
          referent_summary: refDesc,
          witness_vids: [v.verse_id],
          strict_referent_note: `${v.ref} specifically identifies ${symDesc} as ${refDesc}; preserve exact clause referent without merging across separate verses.`,
        });
      }

      // 3. Clause-final Greek equative copula (Subject NP + Predicate NP + G1510, e.g., Rev 1:20)
      for (let i = 3; i < toks.length; i++) {
        if (toks[i].s !== 'G1510') continue;
        const nearRel = toks[i - 1]?.s === 'G3739' || toks[i - 1]?.s === 'G3778' || toks[i - 2]?.s === 'G3739' || toks[i - 2]?.s === 'G3778';
        const clauseEnd = i === toks.length - 1 || toks[i + 1]?.s === 'G2532';
        if (nearRel || !clauseEnd) continue;

        const spanToks: VerseTokenLite[] = [];
        for (let l = i - 1; l >= Math.max(0, i - 9); l--) {
          const lt = toks[l];
          if (lt.s === 'G1510' || lt.s === 'G2532' || (lt.cl || '').toLowerCase() === 'verb') break;
          if (isPrepGoverned(l)) continue;
          spanToks.unshift(lt);
        }
        const spanNouns = spanToks.filter(t => isSymbolicCandidateNoun(t, 450, dfMap) && t.s !== 'G3466');
        if (spanNouns.length < 2) continue;
        const symToks = [spanNouns[0]];
        const refToks = spanNouns.slice(1);
        if ((dfMap?.get(symToks[0].s) ?? 999) > 220) continue;
        const symStrongs = [...new Set(symToks.map(t => t.s))];
        const refStrongs = [...new Set(refToks.map(t => t.s))];
        if (symStrongs.every(s => refStrongs.includes(s))) continue;

        const id = `r13:interp:${v.verse_id}:${i}`;
        if (seenKey.has(id)) continue;
        seenKey.add(id);

        const symDesc = symToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        const refDesc = refToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        out.push({
          id,
          verse_id: v.verse_id,
          ref: v.ref,
          language: 'grc',
          cue_kind: 'greek_copula_identification',
          symbol_strongs: symStrongs,
          referent_strongs: refStrongs,
          symbol_summary: symDesc,
          referent_summary: refDesc,
          witness_vids: [v.verse_id],
          strict_referent_note: `${v.ref} clause-final identification binds ${symDesc} to ${refDesc}; preserve exact referent without merging neighboring clauses.`,
        });
      }
    } else {
      // OT Prophetic vision Q&A ("What do you see?" / "What are these?" -> next 0..2 verses explanation)
      const strongsSet = new Set(toks.map(t => t.s));
      const hasVisionQ = strongsSet.has('H4100') && (strongsSet.has('H7200') || strongsSet.has('H0428'));
      const enLower = (v.en || '').toLowerCase();
      const isVisionIntro = hasVisionQ && /\b(what do you see|what are these|i see|behold)\b/.test(enLower);
      if (isVisionIntro) {
        const next1 = byVid.get(v.verse_id + 1);
        const next2 = byVid.get(v.verse_id + 2);
        const windowNext = [next1, next2].filter((x): x is VerseInputLite => Boolean(x && x.book === v.book));
        if (windowNext.length > 0) {
          const symToks = toks.filter(t => isSymbolicCandidateNoun(t, 260, dfMap)).slice(0, 4);
          const refToks = windowNext
            .flatMap(w => w.toks)
            .filter(t => isContentToken(t) && ((dfMap?.get(t.s) ?? 999) <= 320 || t.s === 'H3068'))
            .slice(0, 5);
          if (symToks.length > 0 && refToks.length > 0) {
            const id = `r13:interp:${v.verse_id}:vis`;
            if (!seenKey.has(id)) {
              seenKey.add(id);
              const symDesc = symToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(', ');
              const refDesc = refToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(', ');
              out.push({
                id,
                verse_id: v.verse_id,
                ref: v.ref,
                language: 'hbo',
                cue_kind: 'hebrew_vision_qa_explanation',
                symbol_strongs: [...new Set(symToks.map(t => t.s))],
                referent_strongs: [...new Set(refToks.map(t => t.s))],
                symbol_summary: symDesc,
                referent_summary: refDesc,
                witness_vids: [v.verse_id, ...windowNext.map(w => w.verse_id)],
                strict_referent_note: `Prophetic vision Q&A in ${v.ref}-${windowNext[windowNext.length - 1].verse}; verify wordplay/interpretation boundaries explicitly.`,
              });
            }
          }
        }
      }

      // OT Demonstrative explanation ("These/they are ..." with H0428/H1992 on rare symbolic entities, e.g., Zech 4:10, Ezek 37:11)
      const hasDem = strongsSet.has('H0428') || strongsSet.has('H1992');
      if (hasDem && /\b(?:these (?:seven |are|bones)|they are)\b/.test(enLower)) {
        const nouns = toks.filter(t => isSymbolicCandidateNoun(t, 350, dfMap) || t.s === 'H3068' || t.s === 'H7651');
        if (nouns.length >= 2) {
          const mid = Math.ceil(nouns.length / 2);
          const symToks = nouns.slice(0, mid);
          const refToks = nouns.slice(mid);
          const id = `r13:interp:${v.verse_id}:dem`;
          if (!seenKey.has(id) && symToks.some(t => (dfMap?.get(t.s) ?? 999) <= 220)) {
            seenKey.add(id);
            const symDesc = symToks.map(t => `${t.lm || t.sf || t.s} (${t.s})`).join(', ');
            const refDesc = refToks.map(t => `${t.lm || t.sf || t.s} (${t.s})`).join(', ');
            out.push({
              id,
              verse_id: v.verse_id,
              ref: v.ref,
              language: 'hbo',
              cue_kind: 'hebrew_demonstrative_identification',
              symbol_strongs: [...new Set(symToks.map(t => t.s))],
              referent_strongs: [...new Set(refToks.map(t => t.s))],
              symbol_summary: symDesc,
              referent_summary: refDesc,
              witness_vids: [v.verse_id],
              strict_referent_note: `Demonstrative symbol identification in ${v.ref}; keep distinct from similar imagery in other books unless explicitly linked.`,
            });
          }
        }
      }
    }
  }

  return out;
}

export interface CompactClauseFrame {
  pred: string;
  subj: string[];
  obj: string[];
  other: string[];
}

export interface FrameAlignmentResult {
  score: number;
  aligned_roles: Array<{ role: string; left: string; right: string }>;
}

/**
 * Compare grammatical role frames across two verses using optional LXX equivalent map
 * so scenes align predicates/agents/objects rather than raw bag-of-words overlap.
 */
export function compareStructuredRoleFrames(
  framesA: CompactClauseFrame[],
  framesB: CompactClauseFrame[],
  equivalentsByBs?: ReadonlyMap<string, ReadonlySet<string>>,
): FrameAlignmentResult {
  const shares = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (equivalentsByBs?.get(a)?.has(b)) return true;
    if (equivalentsByBs?.get(b)?.has(a)) return true;
    return false;
  };

  let bestScore = 0;
  let bestAligned: Array<{ role: string; left: string; right: string }> = [];

  for (const fa of framesA) {
    for (const fb of framesB) {
      const aligned: Array<{ role: string; left: string; right: string }> = [];
      let s = 0;
      if (shares(fa.pred, fb.pred)) {
        s += 0.4;
        aligned.push({ role: 'predicate', left: fa.pred, right: fb.pred });
      }
      for (const sa of fa.subj) {
        const hit = fb.subj.find(sb => shares(sa, sb));
        if (hit) {
          s += 0.3;
          aligned.push({ role: 'subject', left: sa, right: hit });
          break;
        }
      }
      for (const oa of fa.obj) {
        const hit = fb.obj.find(ob => shares(oa, ob));
        if (hit) {
          s += 0.3;
          aligned.push({ role: 'object', left: oa, right: hit });
          break;
        }
      }
      for (const xa of fa.other) {
        const hit = fb.other.find(xb => shares(xa, xb));
        if (hit) {
          s += 0.15;
          aligned.push({ role: 'adjunct', left: xa, right: hit });
          break;
        }
      }
      if (aligned.length >= 2 && s > bestScore) {
        bestScore = Math.min(1, Math.round(s * 1000) / 1000);
        bestAligned = aligned;
      }
    }
  }

  return { score: bestScore, aligned_roles: bestAligned };
}

export interface SymbolicChainLink {
  stage: 'wordplay' | 'artifact_motif' | 'prophetic_vision' | 'explicit_self_interpretation';
  from_node: string;
  to_node: string;
  evidence_id: string;
  refs: string[];
  summary: string;
  strict_note?: string;
}

export interface AssembledSymbolicChain {
  chain_id: string;
  seed: string;
  links: SymbolicChainLink[];
  covered_refs: string[];
  referent_separations: string[];
  score: number;
}

/**
 * Assemble multi-stage symbolic & prophetic progression chains cleanly from
 * wordplay edges -> shared ritual/artifact collocations -> prophetic vision / NT self-interpretations,
 * enforcing strict referent separation when multiple NT identifications exist.
 */
export function assembleSymbolicChains(params: {
  seedStrongOrVid: string;
  wordplayTargets: Array<{ source_bs: string; target_bs: string; witness_refs: string[]; score: number; detail: string }>;
  collocNeighborsByBs: ReadonlyMap<string, Array<{ target_bs: string; shared_count: number; npmi: number; sample_refs: string[] }>>;
  lxxEquivalentsByBs: ReadonlyMap<string, string[]>;
  selfInterpretations: SelfInterpretationRecord[];
  verseRefByVid?: ReadonlyMap<number, string>;
}): AssembledSymbolicChain[] {
  const {
    seedStrongOrVid,
    wordplayTargets,
    collocNeighborsByBs,
    lxxEquivalentsByBs,
    selfInterpretations,
  } = params;

  const interpBySymbolBs = new Map<string, SelfInterpretationRecord[]>();
  for (const si of selfInterpretations) {
    for (const s of si.symbol_strongs) {
      let arr = interpBySymbolBs.get(s);
      if (!arr) { arr = []; interpBySymbolBs.set(s, arr); }
      arr.push(si);
    }
  }

  const links: SymbolicChainLink[] = [];
  const reachedNodes = new Set<string>();
  const refSet = new Set<string>();
  const refSeparations = new Set<string>();

  for (const wp of wordplayTargets.slice(0, 4)) {
    links.push({
      stage: 'wordplay',
      from_node: wp.source_bs,
      to_node: wp.target_bs,
      evidence_id: `r13:wp:${wp.source_bs}:${wp.target_bs}`,
      refs: wp.witness_refs.slice(0, 3),
      summary: wp.detail,
    });
    reachedNodes.add(wp.source_bs);
    reachedNodes.add(wp.target_bs);
    for (const r of wp.witness_refs) refSet.add(r);
  }

  // Expand 1-2 ritual/artifact collocation hops from seed + wordplay derivatives
  const frontier = [...reachedNodes];
  if (frontier.length === 0 && /^[HG]\d+$/i.test(seedStrongOrVid)) frontier.push(seedStrongOrVid.toUpperCase());

  const secondTierNodes: string[] = [...frontier];
  for (const u of frontier) {
    for (const col of (collocNeighborsByBs.get(u) || []).slice(0, 3)) {
      if (reachedNodes.has(col.target_bs)) continue;
      links.push({
        stage: 'artifact_motif',
        from_node: u,
        to_node: col.target_bs,
        evidence_id: `r13:colloc:${u}:${col.target_bs}`,
        refs: col.sample_refs.slice(0, 3),
        summary: `Shared co-occurrence (${col.shared_count}v, NPMI=${col.npmi})`,
      });
      reachedNodes.add(col.target_bs);
      secondTierNodes.push(col.target_bs);
      for (const r of col.sample_refs) refSet.add(r);
    }
  }

  // Attach self-interpretations reached directly or via LXX equivalent from secondTierNodes
  const attachedInterpIds = new Set<string>();
  for (const nodeBs of secondTierNodes) {
    const candidateSyms = new Set([nodeBs, ...(lxxEquivalentsByBs.get(nodeBs) || [])]);
    // Also follow 1 further high-NPMI hop (e.g. lampstand -> lamp -> eye) to reach prophetic/apocalyptic self-interpretations
    for (const col of (collocNeighborsByBs.get(nodeBs) || []).slice(0, 3)) {
      candidateSyms.add(col.target_bs);
      for (const lx of lxxEquivalentsByBs.get(col.target_bs) || []) candidateSyms.add(lx);
    }

    for (const symBs of candidateSyms) {
      for (const si of interpBySymbolBs.get(symBs) || []) {
        if (attachedInterpIds.has(si.id)) continue;
        attachedInterpIds.add(si.id);
        links.push({
          stage: si.language === 'hbo' ? 'prophetic_vision' : 'explicit_self_interpretation',
          from_node: nodeBs,
          to_node: si.referent_strongs.join('+'),
          evidence_id: si.id,
          refs: [si.ref],
          summary: `${si.ref}: ${si.symbol_summary} -> ${si.referent_summary}`,
          strict_note: si.strict_referent_note,
        });
        refSet.add(si.ref);
        refSeparations.add(si.strict_referent_note);
      }
    }
  }

  if (links.length < 2) return [];
  return [{
    chain_id: `r13:symchain:${seedStrongOrVid}`,
    seed: seedStrongOrVid,
    links: links.slice(0, 12),
    covered_refs: [...refSet].slice(0, 12),
    referent_separations: [...refSeparations].slice(0, 6),
    score: Math.round((links.length * 120 + attachedInterpIds.size * 180) * 100) / 100,
  }];
}
