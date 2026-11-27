// @file: src/ui/highlights.ts
// @feature: verse-reader

import type { ReaderOverview, VerseTranslationToken } from '../api/types';
import { el } from './study-dom';

export type HighlightMode = 'off' | 'repetitions' | 'grammar' | 'both';

export interface HighlightGroupSummary {
  strongs: string;
  original: string;
  gloss: string;
  count: number;
  paletteIdx: number;
}

export interface HighlightSummary {
  mode: HighlightMode;
  groups: HighlightGroupSummary[];
  roleCounts: { agent: number; action: number; object: number; neg: number };
}

type GrammarRole = keyof HighlightSummary['roleCounts'];

const PALETTE_SIZE = 8;
const REPETITION_STOPWORDS = new Set(['H853', 'G3588', 'G2532', 'G1161', 'G1722']);
const NEGATION_STRONGS = new Set(['H3808', 'H408', 'G3756', 'G3361']);
const GREEK_NOMINAL_POS = new Set(['N', 'T', 'A', 'P', 'R', 'C', 'D', 'I', 'X', 'F', 'S', 'Q']);

const ROLE_META: Record<GrammarRole, { cls: string; tagCls: string; tagText: string; label: string }> = {
  agent: { cls: 'hl-role-agent', tagCls: 'hl-tag--agent', tagText: 'agent', label: 'Subject / Agent' },
  action: { cls: 'hl-role-action', tagCls: 'hl-tag--action', tagText: 'action', label: 'Verb / Action' },
  object: { cls: 'hl-role-object', tagCls: 'hl-tag--object', tagText: 'object', label: 'Direct Object' },
  neg: { cls: 'hl-role-neg', tagCls: 'hl-tag--neg', tagText: 'not', label: 'Negation' },
};

const gridControllers = new WeakMap<HTMLElement, AbortController>();

function normalizeStrongs(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase().replace(/^([HG])0+(\d+)/, '$1$2');
}

function tokenGloss(token: VerseTranslationToken): string {
  return (token.selected_english ?? token.source_english ?? token.primary_english ?? '').trim();
}

function grammarValuesText(overview: ReaderOverview | null, position: number): string {
  const entry = overview?.grammar?.[String(position)] ?? overview?.grammar?.[position];
  if (!entry || typeof entry !== 'object') return '';
  const parts: string[] = [];
  for (const val of Object.values(entry)) {
    if (typeof val === 'string') {
      parts.push(val.toLowerCase());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') parts.push(item.toLowerCase());
        else if (item != null) parts.push(String(item).toLowerCase());
      }
    } else if (val != null && typeof val !== 'object') {
      parts.push(String(val).toLowerCase());
    }
  }
  return parts.join(' ');
}

function isHebrewToken(normStrongs: string, code: string): boolean {
  if (normStrongs.startsWith('H')) return true;
  if (normStrongs.startsWith('G')) return false;
  if (/^[HA][A-Za-z]/.test(code) || code.includes('/')) return true;
  return false;
}

function hebrewSegments(code: string): string[] {
  return code
    .split('/')
    .filter(Boolean)
    .map((seg, idx) => (idx === 0 ? seg.replace(/^[HA]/i, '') : seg));
}

function isHebrewObjectMarker(token: VerseTranslationToken): boolean {
  const norm = normalizeStrongs(token.strongs_nr);
  if (norm === 'H853') return true;
  const code = (token.grammar_code ?? '').trim();
  return isHebrewToken(norm, code) && hebrewSegments(code).some(seg => seg === 'To');
}

function greekCaseFromMorph(normStrongs: string, code: string, grammarText: string): 'nominative' | 'accusative' | null {
  if (/\baccusative\b/i.test(grammarText)) return 'accusative';
  if (/\bnominative\b/i.test(grammarText)) return 'nominative';
  if (normStrongs.startsWith('H')) return null;

  const dashIdx = code.indexOf('-');
  if (dashIdx <= 0) return null;
  const pos = code.slice(0, dashIdx).toUpperCase();
  const morph = code.slice(dashIdx + 1).toUpperCase();
  if (!GREEK_NOMINAL_POS.has(pos) || !morph) return null;

  // Robinson/MorphGNT nominal codes put case first, or after 1st/2nd person digit (e.g. P-1NS, P-2AS).
  if (/^(?:[12])?A/.test(morph)) return 'accusative';
  if (/^(?:[12])?N/.test(morph)) return 'nominative';
  return null;
}

function classifyGrammarRole(
  token: VerseTranslationToken,
  prevToken: VerseTranslationToken | null,
  overview: ReaderOverview | null
): GrammarRole | null {
  const normStrongs = normalizeStrongs(token.strongs_nr);
  const code = (token.grammar_code ?? '').trim();
  const grammarText = grammarValuesText(overview, token.word_position);
  const hebrew = isHebrewToken(normStrongs, code);
  const hebSegs = hebrew ? hebrewSegments(code) : [];

  // 1. Negation
  if (
    NEGATION_STRONGS.has(normStrongs) ||
    grammarText.includes('neg') ||
    (hebrew && hebSegs.some(seg => seg === 'Tn'))
  ) {
    return 'neg';
  }

  // 2. Verb / Action (checked before case roles so participles remain actions)
  if (
    /^(?:H?V|A?V|V-)/i.test(code) ||
    (hebrew && hebSegs.some(seg => /^V/i.test(seg))) ||
    /\bverb\b/i.test(grammarText)
  ) {
    return 'action';
  }

  // 3. Direct Object (checked before agent so objects are never conflated with agents)
  const greekCase = greekCaseFromMorph(normStrongs, code, grammarText);
  if (greekCase === 'accusative') {
    return 'object';
  }
  if (prevToken && isHebrewObjectMarker(prevToken) && !isHebrewObjectMarker(token)) {
    return 'object';
  }

  // 4. Subject / Agent
  if (greekCase === 'nominative' || /\bsubject\b/i.test(grammarText)) {
    return 'agent';
  }
  if (hebrew && !isHebrewObjectMarker(token)) {
    const hasPrep =
      hebSegs.slice(0, -1).some(seg => seg.startsWith('R')) || /\bpreposition\b/i.test(grammarText);
    const lastSeg = hebSegs[hebSegs.length - 1] ?? '';
    const isNoun = /^N/i.test(lastSeg) || /\b(?:proper )?noun\b/i.test(grammarText);
    if (isNoun && !hasPrep) {
      return 'agent';
    }
  }

  return null;
}

function clearPreviousHighlights(grid: HTMLElement): Map<number, HTMLElement> {
  gridControllers.get(grid)?.abort();
  gridControllers.delete(grid);

  grid.querySelectorAll('.hl-tag, .hl-rep-count').forEach(node => node.remove());

  const nodeByPos = new Map<number, HTMLElement>();
  grid.querySelectorAll<HTMLElement>('.word-token').forEach(node => {
    for (const cls of Array.from(node.classList)) {
      if (
        cls.startsWith('hl-rep-') ||
        cls.startsWith('hl-role-') ||
        cls === 'hl-rep-overflow' ||
        cls === 'is-group-hover'
      ) {
        node.classList.remove(cls);
      }
    }
    const pos = Number(node.dataset.position);
    if (!Number.isNaN(pos)) {
      nodeByPos.set(pos, node);
    }
  });
  return nodeByPos;
}

/**
 * Applies orthogonal lexical-repetition (Channel A) and grammatical-role (Channel B)
 * highlights to `.word-token` elements inside `grid`.
 */
export function applyTokenHighlights(
  grid: HTMLElement,
  tokens: VerseTranslationToken[],
  overview: ReaderOverview | null,
  mode: HighlightMode,
  opts?: { includeStopwords?: boolean; onGroupClick?: (strongs: string) => void }
): HighlightSummary {
  const nodeByPos = clearPreviousHighlights(grid);
  const summary: HighlightSummary = {
    mode,
    groups: [],
    roleCounts: { agent: 0, action: 0, object: 0, neg: 0 },
  };

  if (mode === 'off') return summary;

  // Channel A: Lexical repetition
  if (mode === 'repetitions' || mode === 'both') {
    const grouped = new Map<string, { strongs: string; original: string; gloss: string; tokens: VerseTranslationToken[] }>();
    for (const token of tokens) {
      const strongs = normalizeStrongs(token.strongs_nr);
      if (!strongs) continue;
      if (!opts?.includeStopwords && REPETITION_STOPWORDS.has(strongs)) continue;

      const existing = grouped.get(strongs);
      if (existing) {
        existing.tokens.push(token);
        if (!existing.gloss) existing.gloss = tokenGloss(token);
      } else {
        grouped.set(strongs, {
          strongs,
          original: token.original_word,
          gloss: tokenGloss(token),
          tokens: [token],
        });
      }
    }

    const repeated = Array.from(grouped.values()).filter(g => g.tokens.length >= 2);
    if (repeated.length > 0) {
      const controller = new AbortController();
      gridControllers.set(grid, controller);
      const { signal } = controller;

      repeated.forEach((group, idx) => {
        const repClass = idx < PALETTE_SIZE ? `hl-rep-${idx}` : 'hl-rep-overflow';
        const count = group.tokens.length;
        summary.groups.push({
          strongs: group.strongs,
          original: group.original,
          gloss: group.gloss,
          count,
          paletteIdx: idx,
        });

        const groupNodes: HTMLElement[] = [];
        for (const token of group.tokens) {
          const node = nodeByPos.get(token.word_position);
          if (!node) continue;
          node.classList.add(repClass);
          const badge = el('span', 'hl-rep-count', `×${count}`);
          if (opts?.onGroupClick) {
            const onGroupClick = opts.onGroupClick;
            badge.addEventListener('click', event => {
              event.stopPropagation();
              onGroupClick(group.strongs);
            }, { signal });
          }
          node.append(badge);
          groupNodes.push(node);
        }

        const setGroupHover = (active: boolean) => {
          for (const peer of groupNodes) {
            peer.classList.toggle('is-group-hover', active);
          }
        };

        for (const node of groupNodes) {
          node.addEventListener('pointerenter', () => setGroupHover(true), { signal });
          node.addEventListener('pointerleave', () => setGroupHover(false), { signal });
          node.addEventListener('focusin', () => setGroupHover(true), { signal });
          node.addEventListener('focusout', event => {
            const next = event.relatedTarget as Node | null;
            if (next && node.contains(next)) return;
            setGroupHover(false);
          }, { signal });
        }
      });
    }
  }

  // Channel B: Structural grammar roles
  if (mode === 'grammar' || mode === 'both') {
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!;
      const prevToken = i > 0 ? tokens[i - 1]! : null;
      const role = classifyGrammarRole(token, prevToken, overview);
      if (!role) continue;

      const node = nodeByPos.get(token.word_position);
      if (!node) continue;

      const meta = ROLE_META[role];
      node.classList.add(meta.cls);
      node.append(el('span', `hl-tag ${meta.tagCls}`, meta.tagText));
      summary.roleCounts[role] += 1;
    }
  }

  return summary;
}

/**
 * Builds a concise `.highlight-legend` element explaining active repetition groups,
 * grammar role tags, and the non-interpretive evidence guardrail.
 */
export function createHighlightLegend(mode: HighlightMode, summary: HighlightSummary): HTMLElement {
  const root = el('div', 'highlight-legend');
  root.dataset.mode = mode;
  root.hidden = mode === 'off';

  if (mode === 'repetitions' || mode === 'both') {
    if (summary.groups.length > 0) {
      const row = el('div', 'highlight-legend__groups');
      row.append(el('span', 'highlight-legend__label', 'Repeated words:'));
      for (const group of summary.groups) {
        const repClass = group.paletteIdx < PALETTE_SIZE ? `hl-rep-${group.paletteIdx}` : 'hl-rep-overflow';
        const chip = el('span', `highlight-legend__chip ${repClass}`);
        chip.append(el('span', 'highlight-legend__orig', group.original));
        const suffix = group.gloss ? ` ${group.gloss} (${group.strongs}) ×${group.count}` : ` (${group.strongs}) ×${group.count}`;
        chip.append(el('span', 'highlight-legend__meta', suffix));
        row.append(chip);
      }
      root.append(row);
    } else {
      root.append(el('p', 'highlight-legend__empty', 'No repeated content words (2+ occurrences) in this verse.'));
    }
  }

  if (mode === 'grammar' || mode === 'both') {
    const row = el('div', 'highlight-legend__roles');
    row.append(el('span', 'highlight-legend__label', 'Grammar roles:'));
    (['agent', 'action', 'object', 'neg'] as const).forEach(role => {
      const meta = ROLE_META[role];
      const item = el('span', 'highlight-legend__role');
      item.append(
        el('span', `hl-tag ${meta.tagCls}`, meta.tagText),
        el('span', 'highlight-legend__role-label', ` ${meta.label} (${summary.roleCounts[role]})`)
      );
      row.append(item);
    });
    root.append(row);
  }

  root.append(
    el('p', 'highlight-legend__disclaimer', 'Marks observed lexical repetition or attested morphology, not interpretive certainty.')
  );
  return root;
}
