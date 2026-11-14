// @file: supabase/functions/bible-mcp/relationships-v2.ts
// @feature: api
// @tables: none
// @candidates: none
// @toc: types | pilot-data | live-extractor | tools

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseReader } from './catalog.ts';

// === @section:types ===
export type R2PredicateId = 'grammatical_subject_of' | 'grammatical_object_of';
export type ExtractionQuality = 'source_explicit' | 'rule_derived' | 'candidate';

export interface GrammaticalFrameV2 {
  frame_id: string;
  schema_version: '2.0';
  source: {
    edition: string;
    source_release: string;
    source_file: string;
    clause_node_id: string;
    reference: string;
    canonical_verse_ids: string[];
    alignment_status: string;
  };
  predicate: { token_id: string | null; lemma_id: string | null; source_form: string | null } | null;
  roles: Array<{
    role: string;
    head_token_id: string | null;
    lemma_id: string | null;
    source_phrase_id: string | null;
    state: string;
    head_resolution?: string;
    reason?: string;
  }>;
  context: {
    polarity: string;
    modality: string;
    voice: string;
    speaker_scope: string;
    quotation: string;
    figurative_scope: string;
  };
  extraction: {
    algorithm: string;
    rule_version: string;
    quality: string;
    warnings: string[];
  };
}

export interface OccurrenceRelationV2 {
  relation_id: string;
  frame_id: string;
  subject_token_id: string;
  subject_lemma_id: string;
  predicate: R2PredicateId;
  object_token_id: string;
  object_lemma_id: string;
  evidence: {
    edition: string;
    reference: string;
    source_clause_id: string;
    rule_id: string;
  };
  quality: ExtractionQuality;
  qualifiers: {
    polarity: string;
    modality: string;
    voice: string;
    quotation: string;
  };
}

interface HeadRuleSet {
  coord: string[];
  head_first: Record<string, string | null>;
  head_last: Record<string, string | null>;
  prep: string[];
  wrap: string[];
}

interface SyntaxNode {
  id: number;
  node_key?: string | null;
  parent_node_id?: number | null;
  sibling_order?: number | null;
  node_type?: string | null;
  class_label?: string | null;
  rule_label?: string | null;
  cl_type?: string | null;
  syntactic_role?: string | null;
  is_head?: boolean | null;
  is_terminal?: boolean | null;
  terminal_xml_id?: string | null;
  terminal_word_id?: number | null;
  surface_word?: string | null;
  word_strongs?: string | null;
  word_grammar?: string | null;
  verse_id?: number | null;
}

interface ResolvedHead {
  tokenId: string | null;
  lemmaId: string | null;
  surfaceForm: string | null;
  headResolution: 'direct_role_word' | 'curated_head_rule' | 'unlisted_rule_fallback' | 'unresolved';
  state: 'explicit' | 'clausal' | 'unresolved';
  reason?: string;
  phraseId: string;
}

// === @section:pilot-data ===
const USFM_BY_BOOK: readonly string[] = [
  '',
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT',
  'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP',
  'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE',
  '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];

export const RESTRICTED_SOURCE_FIELDS: readonly string[] = [
  'sdbh', 'lexdomain', 'coredomain', 'contextualdomain', 'domain', 'ln', 'frame', 'semantic_frame', 'meaning',
];

const UPSTREAM_PIN = {
  bibleontology_repo: 'https://github.com/bibleontology/bibleontology',
  bibleontology_commit: '62d6bc0fba5f84dfad245e546e87c6212b35fa75',
  code_license: 'Apache-2.0',
  data_license: 'CC-BY-4.0',
  macula_hebrew_release: 'macula-hebrew-47db250',
  macula_greek_release: 'macula-greek-8423afe',
  rule_version: '1.0',
} as const;

/*__PILOT_DATA_START__*/
interface PilotBundle { pf: GrammaticalFrameV2[]; pr: OccurrenceRelationV2[]; pc: Record<string, unknown>; hr: { hebrew: HeadRuleSet; greek: HeadRuleSet }; }
const PILOT_B64 = "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";
let pilotCache: Promise<PilotBundle> | null = null;
function getPilotData(): Promise<PilotBundle> {
  if (!pilotCache) {
    pilotCache = (async () => {
      const bin = atob(PILOT_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return JSON.parse(await new Response(stream).text()) as PilotBundle;
    })();
  }
  return pilotCache;
}
/*__PILOT_DATA_END__*/

const readOnlyMeta = {
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: 'noauth' }] },
};
const asObj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const asArr = <T>(x: unknown): T[] => Array.isArray(x) ? x as T[] : [];
const jsonContent = (obj: unknown) => [{ type: 'text' as const, text: JSON.stringify(obj) }];

function canonicalRef(book: number, chapter: number, verse: number): string {
  return `${USFM_BY_BOOK[book] ?? `B${book}`} ${chapter}:${verse}`;
}

function defaultEdition(book: number): 'macula-hebrew-wlc' | 'macula-greek-nestle1904' {
  return book <= 39 ? 'macula-hebrew-wlc' : 'macula-greek-nestle1904';
}

function formatStrongsLemmaId(strongsRaw: string | null | undefined): string | null {
  if (!strongsRaw) return null;
  const trimmed = String(strongsRaw).trim();
  const m = /^([HGhg])0*(\d{1,5})([a-zA-Z]*)$/.exec(trimmed);
  if (!m) return `lemma:${trimmed}`;
  return `lemma:${m[1].toUpperCase()}${m[2].padStart(4, '0')}${m[3]}`;
}

function parseStrongsQuery(query: string): { normalizedPrefix?: string; exactId?: string; raw: string } {
  const raw = query.trim();
  const m = /^(?:lemma:)?([HGhg])0*(\d{1,5})([a-zA-Z]*)$/.exec(raw);
  if (!m) return { raw };
  const lang = m[1].toUpperCase();
  const num = m[2].padStart(4, '0');
  const suffix = m[3];
  if (suffix) return { exactId: `lemma:${lang}${num}${suffix}`, raw };
  return { normalizedPrefix: `lemma:${lang}${num}`, raw };
}

function matchesLemmaQuery(lemmaId: string | null | undefined, parsed: ReturnType<typeof parseStrongsQuery>): boolean {
  if (!lemmaId) return false;
  if (parsed.exactId) return lemmaId.toLowerCase() === parsed.exactId.toLowerCase();
  if (parsed.normalizedPrefix) {
    if (lemmaId.toLowerCase() === parsed.normalizedPrefix.toLowerCase()) return true;
    const after = lemmaId.slice(parsed.normalizedPrefix.length);
    return lemmaId.toLowerCase().startsWith(parsed.normalizedPrefix.toLowerCase()) && /^[a-zA-Z]$/.test(after);
  }
  return lemmaId.toLowerCase() === parsed.raw.toLowerCase();
}

// === @section:live-extractor ===
function parseGreekGrammar(grammar: string | null | undefined): { modality: string; voice: string } {
  if (!grammar || !grammar.startsWith('V-')) return { modality: 'unknown', voice: 'unknown' };
  const parts = grammar.split('-');
  const tvpm = parts[1] ?? '';
  if (tvpm.length < 3) return { modality: 'unknown', voice: 'unknown' };
  const vChar = tvpm.length === 4 ? tvpm[2] : tvpm[1];
  const mChar = tvpm.length === 4 ? tvpm[3] : tvpm[2];
  const voiceMap: Record<string, string> = {
    A: 'active', P: 'passive', M: 'middle', E: 'middlepassive', D: 'middle', O: 'passive', N: 'middlepassive',
  };
  const moodMap: Record<string, string> = {
    I: 'indicative', S: 'subjunctive', M: 'imperative', O: 'optative', N: 'infinitive', P: 'participle',
  };
  return {
    voice: voiceMap[vChar] ?? 'unknown',
    modality: moodMap[mChar] ?? 'unknown',
  };
}

function parseHebrewGrammar(grammar: string | null | undefined, ruleLabel: string | null | undefined): { modality: string; voice: string } {
  if (ruleLabel === 'VerbX') return { modality: 'indicative', voice: 'unknown' };
  if (!grammar) return { modality: 'unknown', voice: 'unknown' };
  const morphParts = grammar.split('/');
  const vPart = morphParts.find(p => p.startsWith('HV') || p.startsWith('AV') || p.startsWith('V')) ?? '';
  if (!vPart) return { modality: 'unknown', voice: 'unknown' };
  const stem = vPart.startsWith('HV') || vPart.startsWith('AV') ? vPart[2] : vPart[1];
  const conj = vPart.startsWith('HV') || vPart.startsWith('AV') ? vPart[3] : vPart[2];
  const modalityMap: Record<string, string> = {
    p: 'indicative', q: 'indicative', i: 'indicative', w: 'indicative',
    v: 'imperative', j: 'jussive', h: 'cohortative', c: 'infinitive', a: 'infinitive', r: 'participle', s: 'participle',
  };
  const voice = stem === 'N' || stem === 'h' || stem === 'H' && vPart.includes('Hp') ? 'passive' : 'unknown';
  return { modality: modalityMap[conj] ?? 'unknown', voice };
}

function detectNegationAndQuestion(
  terminals: SyntaxNode[],
  isHebrew: boolean,
): { polarity: string; hasQuestion: boolean } {
  const hebrewNeg = new Set(['H3808', 'H0408', 'H1115', 'H0369', 'H6435']);
  const hebrewQ = new Set(['H4100', 'H4310', 'H0349', 'H0335', 'H4069']);
  const greekNeg = new Set(['G3756', 'G3361', 'G3761', 'G3366', 'G3762', 'G3764', 'G3367']);
  const greekQ = new Set(['G5101', 'G4459', 'G4226', 'G4225', 'G1223']);
  let negated = false;
  let hasQuestion = false;
  for (const t of terminals) {
    const code = (t.word_strongs ?? '').replace(/^lemma:/, '').replace(/[a-zA-Z]+$/, '');
    const padded = /^[HG]\d+$/i.test(code) ? `${code[0].toUpperCase()}${code.slice(1).padStart(4, '0')}` : code;
    if (isHebrew) {
      if (hebrewNeg.has(padded) || /\/\w*Ti\b/.test(t.word_grammar ?? '')) {
        if (hebrewNeg.has(padded)) negated = true;
      }
      if (hebrewQ.has(padded) || /(?:^|\/)HTi/.test(t.word_grammar ?? '')) hasQuestion = true;
    } else {
      if (greekNeg.has(padded)) negated = true;
      if (greekQ.has(padded)) hasQuestion = true;
    }
  }
  return { polarity: negated ? 'negative' : 'affirmative_candidate', hasQuestion };
}

function collectNonClauseTerminals(
  nodeId: number,
  childrenMap: Map<number, SyntaxNode[]>,
  nodeById: Map<number, SyntaxNode>,
  out: SyntaxNode[],
): void {
  const node = nodeById.get(nodeId);
  if (!node) return;
  if (node.is_terminal) {
    out.push(node);
    return;
  }
  for (const ch of childrenMap.get(nodeId) ?? []) {
    if (ch.node_type === 'clause' || ch.class_label === 'cl') continue;
    collectNonClauseTerminals(ch.id, childrenMap, nodeById, out);
  }
}

function isClauseLike(node: SyntaxNode, childrenMap: Map<number, SyntaxNode[]>): boolean {
  if (node.node_type === 'clause' || node.class_label === 'cl') return true;
  if (node.rule_label && (node.rule_label === 'CL2NP' || node.rule_label === 'CL2Adjp' || node.rule_label === 'Np2CL')) {
    return true;
  }
  const kids = childrenMap.get(node.id) ?? [];
  return kids.length === 1 && (kids[0].node_type === 'clause' || kids[0].class_label === 'cl');
}

function expandCoordHeads(
  node: SyntaxNode,
  childrenMap: Map<number, SyntaxNode[]>,
  rules: HeadRuleSet,
  clauseNodeId: string,
  roleTag: string,
): ResolvedHead[] {
  const kids = childrenMap.get(node.id) ?? [];
  const rule = node.rule_label ?? '';
  if (rules.coord.includes(rule)) {
    const out: ResolvedHead[] = [];
    for (const ch of kids) {
      if (ch.class_label === 'conj' || ch.class_label === 'cj' || (ch.word_grammar ?? '').includes('CONJ')) continue;
      if (rules.coord.includes(ch.rule_label ?? '')) {
        out.push(...expandCoordHeads(ch, childrenMap, rules, clauseNodeId, roleTag));
      } else {
        out.push(resolvePhraseHead(ch, childrenMap, rules, clauseNodeId, roleTag, true));
      }
    }
    return out.length > 0 ? out : [{
      tokenId: null, lemmaId: null, surfaceForm: null,
      headResolution: 'unresolved', state: 'unresolved', reason: 'empty_coordination',
      phraseId: `${clauseNodeId}:${roleTag}`,
    }];
  }
  return [resolvePhraseHead(node, childrenMap, rules, clauseNodeId, roleTag, false)];
}

function resolvePhraseHead(
  node: SyntaxNode,
  childrenMap: Map<number, SyntaxNode[]>,
  rules: HeadRuleSet,
  clauseNodeId: string,
  roleTag: string,
  fromCuratedParent: boolean,
): ResolvedHead {
  const phraseId = node.node_key ? `${clauseNodeId}:${roleTag}:${node.node_key.split('#')[1] ?? node.id}` : `${clauseNodeId}:${roleTag}:${node.id}`;
  if (node.is_terminal) {
    return {
      tokenId: node.terminal_xml_id ?? (node.terminal_word_id ? String(node.terminal_word_id) : null),
      lemmaId: formatStrongsLemmaId(node.word_strongs),
      surfaceForm: node.surface_word ?? null,
      headResolution: fromCuratedParent ? 'curated_head_rule' : 'direct_role_word',
      state: node.terminal_xml_id && node.word_strongs ? 'explicit' : 'unresolved',
      phraseId,
    };
  }
  if (isClauseLike(node, childrenMap)) {
    return {
      tokenId: null, lemmaId: null, surfaceForm: null,
      headResolution: 'unresolved', state: 'clausal', reason: 'clausal_constituent', phraseId,
    };
  }
  const kids = childrenMap.get(node.id) ?? [];
  if (kids.length === 0) {
    return {
      tokenId: null, lemmaId: null, surfaceForm: null,
      headResolution: 'unresolved', state: 'unresolved', reason: 'empty_phrase', phraseId,
    };
  }

  const rule = node.rule_label ?? '';
  let chosen: SyntaxNode | undefined;
  let usedFallback = false;

  if (rules.wrap.includes(rule) || kids.length === 1) {
    chosen = kids[0];
  } else if (rule in rules.head_first) {
    chosen = kids[0];
  } else if (rule in rules.head_last) {
    chosen = kids[kids.length - 1];
  } else if (rules.prep.includes(rule)) {
    chosen = kids.find(k => k.class_label !== 'prep' && k.class_label !== 'pp') ?? kids[kids.length - 1];
  } else {
    chosen = kids.find(k => k.is_head === true) ?? kids[0];
    usedFallback = true;
  }

  const nested = resolvePhraseHead(chosen, childrenMap, rules, clauseNodeId, roleTag, !usedFallback);
  return {
    ...nested,
    headResolution: usedFallback ? 'unlisted_rule_fallback' : (nested.headResolution === 'unlisted_rule_fallback' ? 'unlisted_rule_fallback' : 'curated_head_rule'),
    phraseId,
  };
}

function extractLiveFromSyntaxPayload(
  raw: Record<string, unknown>,
  book: number,
  chapter: number,
  verse: number,
  edition: string,
  headRules: { hebrew: HeadRuleSet; greek: HeadRuleSet },
): { frames: GrammaticalFrameV2[]; relations: OccurrenceRelationV2[] } {
  const isHebrew = edition.startsWith('macula-hebrew-');
  const rules = isHebrew ? headRules.hebrew : headRules.greek;
  const trees = asArr<Record<string, unknown>>(raw.trees);
  const targetVerseId = raw.verse_id !== undefined && raw.verse_id !== null ? String(raw.verse_id) : null;
  const ref = canonicalRef(book, chapter, verse);
  const frames: GrammaticalFrameV2[] = [];
  const relations: OccurrenceRelationV2[] = [];

  for (let ti = 0; ti < trees.length; ti++) {
    const t = trees[ti];
    const nodes = asArr<SyntaxNode>(t.nodes);
    const nodeById = new Map<number, SyntaxNode>();
    const childrenMap = new Map<number, SyntaxNode[]>();
    for (const n of nodes) {
      nodeById.set(n.id, n);
      if (n.parent_node_id !== null && n.parent_node_id !== undefined) {
        const list = childrenMap.get(n.parent_node_id) ?? [];
        list.push(n);
        childrenMap.set(n.parent_node_id, list);
      }
    }
    for (const list of childrenMap.values()) {
      list.sort((a, b) => (a.sibling_order ?? 0) - (b.sibling_order ?? 0) || a.id - b.id);
    }

    const clauses = nodes
      .filter(n => n.node_type === 'clause' || n.class_label === 'cl')
      .filter(n => !targetVerseId || String(n.verse_id ?? '') === targetVerseId)
      .sort((a, b) => a.id - b.id);

    for (let ci = 0; ci < clauses.length; ci++) {
      const cl = clauses[ci];
      const clauseNodeId = `${ref}#cl${frames.length}`;
      const frameId = `frame:${edition}:${clauseNodeId}:svov1`;
      const children = childrenMap.get(cl.id) ?? [];
      const clTerminals: SyntaxNode[] = [];
      collectNonClauseTerminals(cl.id, childrenMap, nodeById, clTerminals);
      const { polarity, hasQuestion } = detectNegationAndQuestion(clTerminals, isHebrew);

      const vcNode = children.find(k => k.syntactic_role === 'vc');
      const vNode = children.find(k => k.syntactic_role === 'v');
      if (vcNode || !vNode) {
        const skipKind = vcNode ? 'copular' : (isHebrew ? 'verbless' : 'other_role_clause');
        frames.push({
          frame_id: frameId,
          schema_version: '2.0',
          source: {
            edition,
            source_release: String(t.source_commit ?? (isHebrew ? UPSTREAM_PIN.macula_hebrew_release : UPSTREAM_PIN.macula_greek_release)),
            source_file: String(t.source_file ?? 'live_lookup_syntax_tree_v1'),
            clause_node_id: clauseNodeId,
            reference: ref,
            canonical_verse_ids: targetVerseId ? [targetVerseId] : [],
            alignment_status: 'native_source',
          },
          predicate: null,
          roles: [],
          context: {
            polarity,
            modality: hasQuestion ? 'interrogative' : 'unknown',
            voice: 'unknown',
            speaker_scope: 'unknown',
            quotation: 'none',
            figurative_scope: 'unknown',
          },
          extraction: {
            algorithm: 'bibleontology_s0_s1_s2_r2_svov1_live',
            rule_version: UPSTREAM_PIN.rule_version,
            quality: 'candidate',
            warnings: [`non_verbal_clause:${skipKind}`],
          },
        });
        continue;
      }

      const vHead = resolvePhraseHead(vNode, childrenMap, rules, clauseNodeId, 'v', false);
      const vTerm = nodes.find(n => n.is_terminal && n.terminal_xml_id === vHead.tokenId);
      const grammarInfo = isHebrew
        ? parseHebrewGrammar(vTerm?.word_grammar, vNode.rule_label)
        : parseGreekGrammar(vTerm?.word_grammar);
      const modality = hasQuestion && grammarInfo.modality === 'indicative' ? 'interrogative' : grammarInfo.modality;
      const warnings: string[] = ['live_base_strongs_only'];
      if (vHead.headResolution === 'unlisted_rule_fallback') warnings.push('unlisted_rule_fallback:v');

      const roles: GrammaticalFrameV2['roles'] = [];
      let frameQuality: ExtractionQuality = vHead.headResolution === 'direct_role_word' ? 'source_explicit' : 'rule_derived';
      if (vHead.headResolution === 'unlisted_rule_fallback' || vHead.state !== 'explicit') frameQuality = 'candidate';

      const subjNodes = children.filter(k => k.syntactic_role === 's');
      const objNodes = children.filter(k => k.syntactic_role === 'o');

      const handleRoleList = (roleNodes: SyntaxNode[], roleCode: 's' | 'o', roleName: string, predName: R2PredicateId) => {
        for (let ri = 0; ri < roleNodes.length; ri++) {
          const rn = roleNodes[ri];
          const resolvedList = expandCoordHeads(rn, childrenMap, rules, clauseNodeId, roleCode);
          for (const item of resolvedList) {
            roles.push({
              role: roleName,
              head_token_id: item.tokenId,
              lemma_id: item.lemmaId,
              source_phrase_id: item.phraseId,
              state: item.state,
              head_resolution: item.headResolution,
              ...(item.reason ? { reason: item.reason } : {}),
            });
            if (
              item.state === 'explicit' && item.tokenId && item.lemmaId &&
              vHead.state === 'explicit' && vHead.tokenId && vHead.lemmaId
            ) {
              const isFallback = item.headResolution === 'unlisted_rule_fallback' || vHead.headResolution === 'unlisted_rule_fallback';
              if (isFallback) warnings.push(`unlisted_rule_fallback:${roleCode}`);
              const quality: ExtractionQuality = isFallback
                ? 'candidate'
                : (item.headResolution === 'direct_role_word' && vHead.headResolution === 'direct_role_word' ? 'source_explicit' : 'rule_derived');
              if (quality === 'candidate') frameQuality = 'candidate';
              else if (frameQuality === 'source_explicit' && quality === 'rule_derived') frameQuality = 'rule_derived';
              relations.push({
                relation_id: `rel:${edition}:${clauseNodeId}:${predName}:${item.tokenId}:${vHead.tokenId}`,
                frame_id: frameId,
                subject_token_id: item.tokenId,
                subject_lemma_id: item.lemmaId,
                predicate: predName,
                object_token_id: vHead.tokenId,
                object_lemma_id: vHead.lemmaId,
                evidence: {
                  edition,
                  reference: ref,
                  source_clause_id: clauseNodeId,
                  rule_id: `${isHebrew ? 'hb' : 'gr'}_live_clause_${roleCode}_v_v1`,
                },
                quality,
                qualifiers: { polarity, modality, voice: grammarInfo.voice, quotation: 'none' },
              });
            }
          }
        }
      };

      handleRoleList(subjNodes, 's', 'grammatical_subject', 'grammatical_subject_of');
      handleRoleList(objNodes, 'o', 'grammatical_object', 'grammatical_object_of');

      frames.push({
        frame_id: frameId,
        schema_version: '2.0',
        source: {
          edition,
          source_release: String(t.source_commit ?? (isHebrew ? UPSTREAM_PIN.macula_hebrew_release : UPSTREAM_PIN.macula_greek_release)),
          source_file: String(t.source_file ?? 'live_lookup_syntax_tree_v1'),
          clause_node_id: clauseNodeId,
          reference: ref,
          canonical_verse_ids: targetVerseId ? [targetVerseId] : [],
          alignment_status: 'native_source',
        },
        predicate: { token_id: vHead.tokenId, lemma_id: vHead.lemmaId, source_form: vHead.surfaceForm },
        roles,
        context: {
          polarity,
          modality,
          voice: grammarInfo.voice,
          speaker_scope: 'unknown',
          quotation: 'none',
          figurative_scope: 'unknown',
        },
        extraction: {
          algorithm: 'bibleontology_s0_s1_s2_r2_svov1_live',
          rule_version: UPSTREAM_PIN.rule_version,
          quality: frameQuality,
          warnings: [...new Set(warnings)],
        },
      });
    }
  }

  return { frames, relations };
}

async function resolvePassageFramesAndRelations(
  read: DatabaseReader,
  book: number,
  chapter: number,
  verse: number,
  editionKey?: string,
): Promise<{
  status: string;
  reference: string;
  edition: string;
  source_mode: 'r2_verified_pilot' | 'live_syntax_fallback' | 'unavailable';
  frames: GrammaticalFrameV2[];
  relations: OccurrenceRelationV2[];
  note?: string;
}> {
  const edition = editionKey ?? defaultEdition(book);
  const ref = canonicalRef(book, chapter, verse);
  if ((book <= 39) !== edition.startsWith('macula-hebrew-')) {
    return {
      status: 'invalid_edition_for_testament',
      reference: ref,
      edition,
      source_mode: 'unavailable',
      frames: [],
      relations: [],
      note: 'Books 1-39 use macula-hebrew-wlc; books 40-66 use macula-greek-nestle1904 or macula-greek-sblgnt.',
    };
  }

  const pilot = await getPilotData();
  const pilotFrames = pilot.pf.filter(f => f.source.reference === ref && f.source.edition === edition);
  if (pilotFrames.length > 0) {
    const frameIds = new Set(pilotFrames.map(f => f.frame_id));
    const pilotRelations = pilot.pr.filter(r => frameIds.has(r.frame_id));
    return {
      status: 'ok',
      reference: ref,
      edition,
      source_mode: 'r2_verified_pilot',
      frames: pilotFrames,
      relations: pilotRelations,
    };
  }

  try {
    const reply = await read({
      name: 'lookup_syntax_tree_v1',
      args: { p_book: book, p_chapter: chapter, p_verse: verse, p_edition_key: edition },
      limit: 1,
      offset: 0,
    });
    const raw = asObj(reply.rows[0]);
    if (raw.has_syntax !== true) {
      return {
        status: String(raw.syntax_status ?? 'unannotated_in_source'),
        reference: ref,
        edition,
        source_mode: 'live_syntax_fallback',
        frames: [],
        relations: [],
        note: String(raw.missing_syntax_reason ?? 'No source syntax annotations exist for this passage/edition.'),
      };
    }
    const { frames, relations } = extractLiveFromSyntaxPayload(raw, book, chapter, verse, edition, pilot.hr);
    return {
      status: 'ok',
      reference: ref,
      edition,
      source_mode: 'live_syntax_fallback',
      frames,
      relations,
      note: 'Live lookup_syntax_tree_v1 R2 extraction uses base Strongs when offline token_morphemes homograph suffixes are absent.',
    };
  } catch {
    return {
      status: 'unavailable',
      reference: ref,
      edition,
      source_mode: 'unavailable',
      frames: [],
      relations: [],
      note: 'Syntax source RPC is temporarily unavailable.',
    };
  }
}

// === @section:tools ===
export function registerRelationshipV2Tools(server: McpServer, read: DatabaseReader): void {
  server.registerTool('get_passage_grammatical_frames_v2', {
    title: 'Inspect R2 grammatical frames & SVO relations for a passage',
    description: 'Return verified R2 GrammaticalFrameV2 and OccurrenceRelationV2 records (grammatical_subject_of and grammatical_object_of) for a passage. Uses the reviewed deterministic Hebrew/Greek pilot where covered and falls back to live MACULA tree extraction otherwise. Never equates grammatical subject with semantic agent or infers missing copular/verbless relations.',
    inputSchema: z.strictObject({
      book: z.number().int().min(1).max(66).describe('Canonical book ID: Genesis=1, Psalms=19, Luke=42, John=43.'),
      chapter: z.number().int().min(1).max(150),
      verse: z.number().int().min(0).max(176).describe('Verse number (0 for Psalm heading).'),
      edition_key: z.enum(['macula-hebrew-wlc', 'macula-greek-nestle1904', 'macula-greek-sblgnt']).optional(),
      include_candidates: z.boolean().default(true).describe('Include candidate-quality frames/relations (e.g. unlisted head-rule fallbacks).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ book, chapter, verse, edition_key, include_candidates = true }) => {
    const res = await resolvePassageFramesAndRelations(read, book, chapter, verse, edition_key);
    const relations = include_candidates ? res.relations : res.relations.filter(r => r.quality !== 'candidate');
    const frames = include_candidates ? res.frames : res.frames.filter(f => f.extraction.quality !== 'candidate');
    const payload = {
      schema_version: '2.0',
      status: res.status,
      source_mode: res.source_mode,
      canonical_reference: { book, chapter, verse, ref: res.reference },
      edition: res.edition,
      supported_predicates: ['grammatical_subject_of', 'grammatical_object_of'],
      counts: {
        frames: frames.length,
        relations: relations.length,
        candidate_relations: res.relations.filter(r => r.quality === 'candidate').length,
      },
      frames,
      relations,
      ...(res.note ? { note: res.note } : {}),
    };
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('get_word_relationships_v2', {
    title: 'Query R2 grammatical word relationships',
    description: 'Search verified R2 grammatical relationships (grammatical_subject_of, grammatical_object_of) by Strongs ID (e.g. H0430, H1254, G2316, G0649), exact lemma ID (lemma:H1254a), source token ID, or surface verb form. Optionally supply book/chapter/verse to also extract from a live verse tree. Preserves Hebrew homograph suffixes and distinguishes quality levels.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(128).describe('Base Strongs (H0430, G2316), disambiguated lemma_id (lemma:H0430G), token_id (o010010010031), or original form.'),
      relation_types: z.array(z.enum(['grammatical_subject_of', 'grammatical_object_of'])).optional(),
      include_uncertain: z.boolean().default(true).describe('Include candidate-quality relations.'),
      book: z.number().int().min(1).max(66).optional(),
      chapter: z.number().int().min(1).max(150).optional(),
      verse: z.number().int().min(0).max(176).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ query, relation_types, include_uncertain = true, book, chapter, verse, limit = 20 }) => {
    const parsed = parseStrongsQuery(query);
    const pilot = await getPilotData();
    let poolRelations: OccurrenceRelationV2[] = [...pilot.pr];
    let poolFrames: GrammaticalFrameV2[] = [...pilot.pf];
    let liveSourceMode: string | undefined;

    if (book !== undefined && chapter !== undefined && verse !== undefined) {
      const live = await resolvePassageFramesAndRelations(read, book, chapter, verse);
      liveSourceMode = live.source_mode;
      if (live.source_mode === 'live_syntax_fallback') {
        poolRelations = [...poolRelations, ...live.relations];
        poolFrames = [...poolFrames, ...live.frames];
      } else {
        poolRelations = live.relations;
        poolFrames = live.frames;
      }
    }

    const predicateTokenMatches = new Set(
      poolFrames
        .filter(f => f.predicate && (
          f.predicate.token_id === parsed.raw ||
          f.predicate.source_form === parsed.raw ||
          matchesLemmaQuery(f.predicate.lemma_id, parsed)
        ))
        .map(f => f.predicate!.token_id!),
    );

    const matchedLemmaIds = new Set<string>();
    const asGrammaticalSubject: OccurrenceRelationV2[] = [];
    const asGrammaticalObject: OccurrenceRelationV2[] = [];
    const asPredicate: OccurrenceRelationV2[] = [];

    for (const rel of poolRelations) {
      if (!include_uncertain && rel.quality === 'candidate') continue;
      if (relation_types && !relation_types.includes(rel.predicate)) continue;
      if (book !== undefined && chapter !== undefined && verse !== undefined) {
        if (rel.evidence.reference !== canonicalRef(book, chapter, verse)) continue;
      }

      const subjMatch = rel.subject_token_id === parsed.raw || matchesLemmaQuery(rel.subject_lemma_id, parsed);
      const objMatch = rel.object_token_id === parsed.raw || predicateTokenMatches.has(rel.object_token_id) || matchesLemmaQuery(rel.object_lemma_id, parsed);
      if (!subjMatch && !objMatch) continue;

      if (subjMatch) {
        matchedLemmaIds.add(rel.subject_lemma_id);
        if (rel.predicate === 'grammatical_subject_of') asGrammaticalSubject.push(rel);
        else asGrammaticalObject.push(rel);
      }
      if (objMatch) {
        matchedLemmaIds.add(rel.object_lemma_id);
        asPredicate.push(rel);
      }
    }

    const lemmas = [...matchedLemmaIds].sort();
    const payload = {
      schema_version: '2.0',
      status: 'ok',
      query: parsed.raw,
      ...(liveSourceMode ? { passage_source_mode: liveSourceMode } : {}),
      matched_lemma_ids: lemmas,
      homograph_distinction_notice: lemmas.length > 1
        ? 'Multiple distinct lemma identities matched this query; homographs and senses are kept distinct.'
        : null,
      groups: {
        as_grammatical_subject: asGrammaticalSubject.slice(0, limit),
        as_grammatical_object: asGrammaticalObject.slice(0, limit),
        as_predicate: asPredicate.slice(0, limit),
      },
      totals: {
        as_grammatical_subject: asGrammaticalSubject.length,
        as_grammatical_object: asGrammaticalObject.length,
        as_predicate: asPredicate.length,
      },
      coverage: {
        pilot_only: book === undefined,
        pilot_passages: ['GEN 1:1', 'GEN 1:11', 'GEN 3:4', 'GEN 9:19', 'JOS 17:15', 'PSA 3:1', 'MRK 16:99', 'LUK 8:11', 'JHN 3:17', 'JHN 4:41', 'JHN 6:35', 'JHN 6:67'],
        tip: 'Provide book, chapter, and verse to also run R2 SVO extraction against any annotated chapter on demand.',
      },
    };
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('get_relationship_coverage_v2', {
    title: 'Inspect R1/R2 grammatical relationship extractor coverage',
    description: 'Return pinned upstream provenance (BibleOntology S0/S1/S2 + MACULA commits), supported R2 predicates, and measured Hebrew/Greek pilot clause/relation/skip counts.',
    inputSchema: z.strictObject({
      edition_key: z.enum(['macula-hebrew-wlc', 'macula-greek-nestle1904', 'macula-greek-sblgnt']).optional(),
      predicate: z.enum(['grammatical_subject_of', 'grammatical_object_of']).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ edition_key, predicate }) => {
    const pilot = await getPilotData();
    const filteredRels = pilot.pr.filter(r =>
      (!edition_key || r.evidence.edition === edition_key) &&
      (!predicate || r.predicate === predicate)
    );
    const payload = {
      schema_version: '2.0',
      status: 'ok',
      phase: 'R1+R2',
      provenance: UPSTREAM_PIN,
      supported_predicates: predicate ? [predicate] : ['grammatical_subject_of', 'grammatical_object_of'],
      pilot_coverage: pilot.pc,
      filtered_counts: {
        edition_key: edition_key ?? 'all',
        predicate: predicate ?? 'all',
        relations: filteredRels.length,
        by_quality: {
          source_explicit: filteredRels.filter(r => r.quality === 'source_explicit').length,
          rule_derived: filteredRels.filter(r => r.quality === 'rule_derived').length,
          candidate: filteredRels.filter(r => r.quality === 'candidate').length,
        },
      },
      live_fallback: 'get_passage_grammatical_frames_v2 supports any canonical verse via lookup_syntax_tree_v1 in addition to the 41 reviewed pilot clauses.',
    };
    return { content: jsonContent(payload), structuredContent: payload };
  });
}
