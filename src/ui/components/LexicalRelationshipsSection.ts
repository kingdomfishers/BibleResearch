// @file: src/ui/components/LexicalRelationshipsSection.ts
// @feature: word-modal
// @tables: none
// @candidates: none
// @toc: imports | types | ui:edge-card | ui:render | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { RelationshipNotePrefill } from '../../api/relationship-notes-adapter';
import type {
  LexicalRelationshipEdge,
  LexicalRelationshipLookupResponse,
  Note,
  ResearcherRelationshipStance,
} from '../../api/types';
import { notesState } from '../notes-state';
import { action, el, status } from '../study-dom';
import { BOOK_NAMES } from '../utils';

// === @section:types ===
export interface LexicalRelationshipsSectionProps {
  onInspectTarget?: (wordId: number) => void;
  onEvaluateRelationship?: (prefill: RelationshipNotePrefill) => void;
}

export interface LexicalRelationshipsSectionHandle {
  element: HTMLElement;
  loadForWord: (wordId: number, strongsNr: string, notes?: Note[]) => Promise<void>;
  clear: () => void;
}

const BOOK_NAME_MAP: ReadonlyMap<number, string> = new Map(
  BOOK_NAMES.map((name: string, idx: number) => [idx + 1, name])
);

const TIER_LABELS: Record<string, string> = {
  attested_lexical_fact: 'Attested lexical fact',
  deterministic_computational: 'Deterministic computational',
  statistical_association: 'Statistical association',
  ai_hypothesis: 'AI hypothesis',
  human_reviewed_interpretation: 'Human-reviewed interpretation',
};

const LANG_LABELS: Record<string, string> = {
  hbo: 'Hebrew',
  arc: 'Aramaic',
  grc: 'Greek',
};

// === @section:ui:edge-card ===
function createLexicalEdgeCard(
  edge: LexicalRelationshipEdge,
  matchedNotes: Note[],
  props: LexicalRelationshipsSectionProps
): HTMLElement {
  const card = el('article', 'rel-card');
  const head = el('div', 'rel-card__head');

  const targetBdi = document.createElement('bdi');
  targetBdi.className = 'rel-card__lemma';
  targetBdi.dir = edge.target.language === 'grc' ? 'ltr' : 'rtl';
  const code = edge.target.disambiguated_strongs || edge.target.extended_strongs || edge.target.base_strongs || '';
  targetBdi.textContent = `${edge.target.lemma_text} (${edge.target.transliteration ?? ''}) [${code}]`;

  if (edge.target.word_id && edge.target.word_id > 0 && props.onInspectTarget) {
    const targetWordId = edge.target.word_id;
    const btn = action('', () => props.onInspectTarget?.(targetWordId), 'text-action rel-card__target-btn');
    btn.replaceChildren(targetBdi);
    head.append(btn);
  } else {
    head.append(targetBdi);
  }

  head.append(
    el('span', 'rel-badge', edge.category.replace(/_/g, ' ')),
    el('span', 'rel-badge rel-badge--tier', TIER_LABELS[edge.epistemic_tier] ?? edge.epistemic_tier),
    el('span', 'rel-badge', LANG_LABELS[edge.target.language] ?? edge.target.language)
  );
  card.append(head);

  card.append(el('p', 'rel-card__why', edge.explanation));
  if (edge.target.primary_gloss) {
    card.append(el('p', 'study-muted', `Target gloss: ${edge.target.primary_gloss}`));
  }

  const guardNote = !edge.guardrails.implies_synonymy && !edge.guardrails.implies_common_etymology
    ? ' · Non-etymological / non-synonymous'
    : !edge.guardrails.implies_synonymy
      ? ' · Does not imply synonymy'
      : ' · Source-attested synonymy';
  card.append(
    el('p', 'study-muted rel-card__prov', `Source: ${edge.provenance.source_title} (${edge.reused_source_table})${guardNote}`)
  );

  if (matchedNotes.length > 0) {
    const stances = matchedNotes
      .map(n => BibleRPC.relationships.extractRelationshipEvaluation(n)?.stance ?? 'noted')
      .join(', ');
    card.append(el('p', 'rel-card__notes-count', `Researcher notes (${matchedNotes.length}): ${stances.replace(/_/g, ' ')}`));
  }

  if (props.onEvaluateRelationship) {
    const actions = el('div', 'rel-card__actions');
    const stances: Array<[ResearcherRelationshipStance, string]> = [
      ['agree', 'Note: Agree'],
      ['disagree', 'Disagree'],
      ['alternative_interpretation', 'Alternative'],
    ];
    for (const [stance, text] of stances) {
      actions.append(
        action(text, () => {
          const selectedNoteId = notesState.getSelectedNoteId();
          const prefill = BibleRPC.relationships.buildNotePrefillFromLexicalEdge(edge, {
            stance,
            bookNamesById: BOOK_NAME_MAP,
            connectToNote: selectedNoteId ? { id: selectedNoteId } : null,
          });
          props.onEvaluateRelationship?.(prefill);
        }, 'editor-btn editor-btn--sm')
      );
    }
    card.append(actions);
  }
  return card;
}

// === @section:ui:render ===
function renderLexicalPacket(
  body: HTMLElement,
  summaryEl: HTMLElement,
  packet: LexicalRelationshipLookupResponse,
  notes: Note[],
  props: LexicalRelationshipsSectionProps
): void {
  body.replaceChildren();
  if (packet.status !== 'ok') {
    summaryEl.textContent = 'Lexical relationship graph';
    body.append(status(packet.error_message ?? 'No extended lexical graph slice entry for this word.'));
    return;
  }

  summaryEl.textContent = `Lexical relationship graph (${packet.page.total_available})`;
  body.append(
    el(
      'p',
      'study-muted rel-disclaimer',
      'Categories and epistemic tiers are strictly separated: shared English translations or spelling overlap never imply synonymy or common etymology.'
    )
  );

  if (packet.homograph_siblings.length > 0) {
    const homoRow = el('p', 'study-muted');
    const codes = packet.homograph_siblings
      .map(h => `${h.disambiguated_strongs || h.extended_strongs} (${h.primary_gloss ?? ''})`)
      .join(' · ');
    homoRow.textContent = `Homograph siblings preserved: ${codes}`;
    body.append(homoRow);
  }

  const notesMap = BibleRPC.relationships.indexNotesByRelationshipId(notes);
  const list = el('div', 'rel-list');
  for (const edge of packet.edges) {
    list.append(createLexicalEdgeCard(edge, notesMap.get(edge.relationship_id) ?? [], props));
  }
  if (!packet.edges.length) {
    body.append(status('No lexical relationships recorded for this word.'));
  } else {
    body.append(list);
  }
}

// === @section:ui:main ===
export function createLexicalRelationshipsSection(
  props: LexicalRelationshipsSectionProps
): LexicalRelationshipsSectionHandle {
  const details = el('details', 'study-disclosure lexical-rels');
  const summaryEl = el('summary', '', 'Lexical relationship graph');
  const body = el('div', 'lexical-rels__body');
  details.append(summaryEl, body);
  let reqCounter = 0;

  return {
    element: details,
    async loadForWord(wordId: number, strongsNr: string, notes: Note[] = []): Promise<void> {
      const current = ++reqCounter;
      summaryEl.textContent = 'Lexical relationship graph';
      body.replaceChildren(status('Loading lexical relationships…'));
      const res = await BibleRPC.relationships.lookupLexicalRelationships({
        word_id: wordId,
        query: strongsNr,
        include_statistical: true,
        limit: 30,
      });
      if (current !== reqCounter) return;
      renderLexicalPacket(body, summaryEl, res.data, notes, props);
    },
    clear(): void {
      reqCounter++;
      summaryEl.textContent = 'Lexical relationship graph';
      body.replaceChildren();
    },
  };
}
