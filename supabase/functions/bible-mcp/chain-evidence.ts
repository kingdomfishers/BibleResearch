// Match an explicitly selected chain hop to existing evidence, without inventing edges.
import { parsePassageString } from './bible-ref.ts';

export interface ChainEvidence {
  id: string;
  relation: string;
  epistemic: string;
  refs: string[];
  title?: string;
  target?: { strongs?: string; script?: string; transliteration?: string; gloss?: string };
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

function padStrongsBase(raw: string): string {
  const m = /^([HG])0*(\d+)[A-Z]*$/i.exec(raw.trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : raw.trim().toUpperCase();
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const fromIsPassage = Boolean(parsePassageString(fromNode));
  const selectedIsPassage = Boolean(parsePassageString(selected));
  const selectedStrongs = /^[HG]0*\d+[A-Z]*$/i.test(selected.trim()) ? padStrongsBase(selected) : '';

  return candidates.find(c => {
    if (selectedStrongs) {
      const tStrongs = c.target?.strongs ? padStrongsBase(c.target.strongs) : '';
      if (tStrongs && tStrongs === selectedStrongs) return true;
      return new RegExp(`\\b${escapeRegExp(selectedStrongs)}\\b`, 'i').test(`${c.id} ${c.title || ''}`);
    }
    if (selectedIsPassage) {
      if (fromIsPassage) {
        return c.refs.some(ref => overlaps(fromNode, ref)) &&
          c.refs.some(ref => overlaps(selected, ref));
      }
      // fromNode is a word/concept/evidence: a neighbor candidate containing the target passage connects them.
      return c.refs.some(ref => overlaps(selected, ref));
    }
    const q = selected.trim().toLowerCase();
    if (!q) return false;
    const tScript = (c.target?.script || '').trim().toLowerCase();
    const tTranslit = (c.target?.transliteration || '').trim().toLowerCase();
    const tGloss = (c.target?.gloss || '').trim().toLowerCase();
    if (tScript === q || tTranslit === q || tGloss === q) return true;
    const tokRe = new RegExp(`(^|[^a-z0-9])${escapeRegExp(q)}([^a-z0-9]|$)`, 'i');
    return tokRe.test(tGloss) || tokRe.test(c.title || '');
  });
}

export function chainEvidenceTarget(evidence: ChainEvidence, fromNode: string): string {
  return evidence.refs.find(ref => !overlaps(fromNode, ref)) ||
    evidence.target?.strongs || evidence.refs[0] || evidence.id;
}
