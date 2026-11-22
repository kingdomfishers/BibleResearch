// Match an explicitly selected chain hop to existing evidence, without inventing edges.
import { parsePassageString } from './bible-ref.ts';

export interface ChainEvidence {
  id: string;
  relation: string;
  epistemic: string;
  refs: string[];
  target?: { strongs?: string };
}

function overlaps(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const left = parsePassageString(a);
  const right = parsePassageString(b);
  return Boolean(left && right && left.passages.some(x => right.passages.some(y =>
    x.book === y.book && x.chapter === y.chapter &&
    x.start_verse <= y.end_verse && y.start_verse <= x.end_verse,
  )));
}

/** Candidates must have been retrieved for fromNode, not a different branch. */
export function selectChainEvidence(
  candidates: ChainEvidence[],
  fromNode: string,
  selected: string,
): ChainEvidence | undefined {
  const explicit = candidates.find(c => c.id === selected);
  if (explicit) return explicit;
  if (overlaps(fromNode, selected)) return undefined;
  return candidates.find(c => {
    if (/^[HG]\d+[A-Z]*$/i.test(selected)) {
      return c.target?.strongs?.toLowerCase() === selected.toLowerCase();
    }
    // A target passage must have its own source witness on the same edge.
    return c.refs.some(ref => overlaps(fromNode, ref)) &&
      c.refs.some(ref => overlaps(selected, ref));
  });
}

export function chainEvidenceTarget(evidence: ChainEvidence, fromNode: string): string {
  return evidence.refs.find(ref => !overlaps(fromNode, ref)) ||
    evidence.target?.strongs || evidence.refs[0] || evidence.id;
}
