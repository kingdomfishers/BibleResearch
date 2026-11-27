// Match an explicitly selected chain hop to existing evidence, without inventing edges.
import { parsePassageString } from './bible-ref.ts';

export type AxisFilter = 'lexical' | 'lxx' | 'wordplay' | 'structure' | 'concept_proc' | 'xref';

export interface ChainEvidence {
  id: string;
  expand_id?: string;
  relation: string;
  epistemic: string;
  refs: string[];
  axes?: string[];
  e_perp?: { bits: number; p_null?: number; register?: string };
  title?: string;
  target?: { strongs?: string; script?: string; transliteration?: string; gloss?: string };
}

/** Classify whether a candidate edge belongs to the requested progressive research axis. */
export function matchesAxisFilter(evidence: ChainEvidence, axisFilter?: AxisFilter): boolean {
  if (!axisFilter) return true;
  const id = (evidence.id || '').toLowerCase();
  const rel = (evidence.relation || '').toLowerCase();
  const ep = (evidence.epistemic || '').toLowerCase();
  const axes = (evidence.axes || []).map(a => a.toLowerCase());

  switch (axisFilter) {
    case 'xref':
      return id.startsWith('r11:xref:') || id.startsWith('xref:') || rel.includes('cross_reference');
    case 'lxx':
      return id.startsWith('lxx') || id.startsWith('r11:lxx:') || id.startsWith('passage_lxx:') ||
        rel.includes('lxx') || ep.includes('cross_language') || axes.some(a => a.startsWith('lxx:'));
    case 'wordplay':
      return id.startsWith('r13:wp:') || id.startsWith('r10:wordplay:') || id.startsWith('passage_root_wordplay:') ||
        rel.includes('wordplay') || rel.includes('talion') || rel.includes('onomastic') ||
        axes.some(a => a.includes('wordplay') || a.startsWith('wp:'));
    case 'structure':
      return id.startsWith('r13:interp:') || id.startsWith('r13:motif:') || id.startsWith('r12:scene:') ||
        id.startsWith('v3:seq:') || id.startsWith('r10:typo:') || id.startsWith('r10:ident:') ||
        rel.includes('sequence') || rel.includes('typolog') || rel.includes('motif') || rel.includes('chiasm') ||
        axes.some(a => a.includes('sequence') || a.includes('typology'));
    case 'concept_proc':
      return id.startsWith('prop:') || id.startsWith('r12:prop:') || ep.includes('external_world') ||
        rel.includes('property') || axes.some(a => a.startsWith('concept:') || a.startsWith('phys:'));
    case 'lexical':
      return id.startsWith('lex:') || id.startsWith('r11:lex:') || id.startsWith('gram:') ||
        id.startsWith('shared_lemma') || id.startsWith('direct_in_passage:') ||
        id.startsWith('passage_lex_bridge:') || id.startsWith('passage_root_bridge:') ||
        id.startsWith('passage_lexeme:') || id.startsWith('rare:') || id.startsWith('first_occ:') ||
        rel.includes('root') || rel.includes('lexical') || rel.includes('lemma') ||
        axes.some(a => a.startsWith('lemma:'));
  }
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
  const explicit = candidates.find(c => c.id === selected || (c.expand_id && c.expand_id === selected));
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
  const fromIsPassage = Boolean(parsePassageString(fromNode));
  const tStrongs = evidence.target?.strongs?.trim();
  const isPassageToPassage = /^(r13:motif:|r12:scene:|r10:ident:|r10:typo:|r11:xref:|xref:|shared_lemma|passage_)/.test(evidence.id || '');
  if (!fromIsPassage && tStrongs && !isPassageToPassage && padStrongsBase(tStrongs) !== padStrongsBase(fromNode)) {
    return tStrongs;
  }
  return evidence.refs.find(ref => !overlaps(fromNode, ref)) ||
    tStrongs || evidence.refs[0] || evidence.id;
}
