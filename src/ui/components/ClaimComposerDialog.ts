// @file: src/ui/components/ClaimComposerDialog.ts
// @feature: research-graph
// @tables: rg_nodes | rg_claims | rg_claim_evidence | rg_claim_participants | rg_claim_links | note_connection_types

import '../styles-research-graph.css';
import type { NoteConnectionType } from '../../api/notes-types';
import type {
  RgBatchPayload,
  RgClaimKind,
  RgClaimSummary,
  RgEpistemicState,
  RgEvidenceClass,
  RgEvidenceKind,
  RgNodeKind,
  RgParticipantRole,
} from '../../api/research-graph-types';
import { BibleRPC } from '../../api/rpc';
import { action, el, status } from '../study-dom';
import { generateClientKey, generateRequestId } from './NoteEditorModel';

export type ClaimComposerMode = 'create' | 'edit' | 'challenge' | 'supersede';

export interface ClaimComposerPrefill {
  mode?: ClaimComposerMode;
  existingClaim?: RgClaimSummary;
  targetClaim?: {
    id: string;
    title: string;
    subject_ref?: string;
    predicate?: string;
    object_ref?: string;
  };
  subjectQuery?: string;
  subjectRef?: string;
  subjectLabel?: string;
  subjectKind?: RgNodeKind;
  subjectStrongs?: string;
  subjectVerseId?: number;
  subjectWordId?: number;
  objectQuery?: string;
  objectRef?: string;
  objectLabel?: string;
  predicate?: string;
  title?: string;
  assertionText?: string;
  evidenceClass?: RgEvidenceClass;
}

export interface ClaimComposerHandle {
  element: HTMLDialogElement;
  open: (prefill?: ClaimComposerPrefill) => void;
  close: () => void;
}

interface NodeDraftState {
  resolvedRef: string | null;
  resolvedLabel: string | null;
  createNew: boolean;
  nodeKind: RgNodeKind;
  label: string;
  aliasesText: string;
  summary: string;
}

interface EvidenceDraftState {
  polarity: 'supporting' | 'counterexample' | 'control' | 'limiting_case';
  evidence_kind: RgEvidenceKind;
  verse_id?: number;
  word_id?: number;
  lemma_id?: number;
  external_title: string;
  external_url: string;
  explanation: string;
}

interface ParticipantDraftState {
  role: RgParticipantRole;
  nodeRef: string;
  notes: string;
}

const CLAIM_KINDS: Array<{ value: RgClaimKind; label: string }> = [
  { value: 'textual_observation', label: 'Textual Observation' },
  { value: 'linguistic_finding', label: 'Linguistic Finding' },
  { value: 'explicit_symbol', label: 'Explicit Biblical Symbol' },
  { value: 'literary_pattern', label: 'Literary Pattern / Structure' },
  { value: 'physical_mechanism', label: 'Physical Mechanism / Process' },
  { value: 'relational_analogy', label: 'Cross-Domain Analogy' },
  { value: 'process_mapping', label: 'Multi-Participant Process Mapping' },
  { value: 'abstract_principle', label: 'Fundamental Principle' },
  { value: 'dlm_hypothesis', label: 'DLM Hypothesis' },
  { value: 'challenge_critique', label: 'Challenge / Critique' },
  { value: 'definition', label: 'Working Definition' },
  { value: 'unresolved_question', label: 'Unresolved Question' },
];

const EVIDENCE_CLASSES: RgEvidenceClass[] = [
  'TEXT_EXPLICIT',
  'TEXT_LINGUISTIC',
  'TEXT_INTERTEXTUAL',
  'TEXT_PATTERN',
  'SCIENCE_EMPIRICAL',
  'DLM_HYPOTHESIS',
  'DISPUTED',
  'OPEN',
];

const EPISTEMIC_STATES: RgEpistemicState[] = [
  'established_observation',
  'well_supported_interpretation',
  'plausible_hypothesis',
  'speculative',
  'disputed',
  'open',
];

const RESEARCH_NODE_KINDS: RgNodeKind[] = [
  'concept',
  'principle',
  'process',
  'mechanism',
  'physical_object',
  'component',
  'property',
  'mathematical_structure',
  'literary_structure',
  'pattern',
  'letter_or_formation',
  'discovery',
  'definition',
  'hypothesis',
  'question',
  'external_source',
];

const PARTICIPANT_ROLES: RgParticipantRole[] = [
  'agent', 'patient', 'instrument', 'source', 'destination',
  'condition', 'outcome', 'medium', 'context', 'slot_a', 'slot_b', 'unmatched', 'control',
];

const DEFAULT_CONNECTION_TYPES: Array<Pick<NoteConnectionType, 'type_key' | 'label' | 'inverse_label' | 'category' | 'default_direction' | 'is_symmetric' | 'discouraged'>> = [
  { type_key: 'parallels', label: 'Parallels', inverse_label: 'Paralleled by', category: 'rhetoric', default_direction: 'bidirectional', is_symmetric: true, discouraged: false },
  { type_key: 'contrasts_with', label: 'Contrasts with', inverse_label: 'Contrasted by', category: 'semantic', default_direction: 'bidirectional', is_symmetric: true, discouraged: false },
  { type_key: 'symbolizes_explicitly', label: 'Symbolizes explicitly', inverse_label: 'Explicitly symbolized by', category: 'thematic', default_direction: 'directed', is_symmetric: false, discouraged: false },
  { type_key: 'analogous_to', label: 'Analogous to', inverse_label: 'Analogous to', category: 'analogy', default_direction: 'bidirectional', is_symmetric: true, discouraged: false },
  { type_key: 'hypothesized_to_express', label: 'Hypothesized to express', inverse_label: 'Expressed in hypothesis by', category: 'hypothesis', default_direction: 'directed', is_symmetric: false, discouraged: false },
  { type_key: 'performs_function', label: 'Performs function', inverse_label: 'Function performed by', category: 'process', default_direction: 'directed', is_symmetric: false, discouraged: false },
  { type_key: 'produces', label: 'Produces', inverse_label: 'Produced by', category: 'process', default_direction: 'directed', is_symmetric: false, discouraged: false },
  { type_key: 'requires', label: 'Requires', inverse_label: 'Required by', category: 'process', default_direction: 'directed', is_symmetric: false, discouraged: false },
  { type_key: 'challenges', label: 'Challenges', inverse_label: 'Challenged by', category: 'epistemic', default_direction: 'directed', is_symmetric: false, discouraged: false },
  { type_key: 'supports', label: 'Supports', inverse_label: 'Supported by', category: 'epistemic', default_direction: 'directed', is_symmetric: false, discouraged: false },
  { type_key: 'depends_on', label: 'Depends on', inverse_label: 'Depended on by', category: 'epistemic', default_direction: 'directed', is_symmetric: false, discouraged: false },
];

export function createClaimComposerDialog(opts?: { onSaved?: (result: Record<string, unknown>) => void }): ClaimComposerHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'rg-claim-dialog';
  dialog.setAttribute('closedby', 'closerequest');

  const titleId = `rg-composer-title-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute('aria-labelledby', titleId);

  let mode: ClaimComposerMode = 'create';
  let currentPrefill: ClaimComposerPrefill = {};
  let connectionTypes: Array<Pick<NoteConnectionType, 'type_key' | 'label' | 'inverse_label' | 'category' | 'default_direction' | 'is_symmetric' | 'discouraged'>> = DEFAULT_CONNECTION_TYPES;
  let subjectDraft: NodeDraftState = emptyNodeDraft();
  let objectDraft: NodeDraftState = emptyNodeDraft();
  let evidenceList: EvidenceDraftState[] = [];
  let participantList: ParticipantDraftState[] = [];
  let saving = false;

  const head = el('header', 'rg-dialog__head');
  const titleEl = el('h2', 'rg-dialog__title', 'New Research Knowledge Claim');
  titleEl.id = titleId;
  const closeHeadBtn = action('✕', () => dialog.close('cancel'), 'study-button');
  closeHeadBtn.setAttribute('aria-label', 'Close claim composer');
  head.append(titleEl, closeHeadBtn);

  const body = el('div', 'rg-dialog__body');
  const errorBox = el('div', 'rg-warning-box');
  errorBox.hidden = true;
  errorBox.setAttribute('role', 'alert');

  const formWrap = el('div', 'rg-form-grid');
  body.append(errorBox, formWrap);

  const foot = el('footer', 'rg-dialog__foot');
  const footLeft = el('span', 'study-muted', 'Human notes/claims stay separate from Scripture & algorithmic discovery.');
  const footBtns = el('div', 'rg-actions-row');
  const cancelBtn = action('Cancel', () => dialog.close('cancel'), 'study-button');
  const saveBtn = action('Save to Knowledge Graph', () => void submitClaim(), 'study-button primary');
  footBtns.append(cancelBtn, saveBtn);
  foot.append(footLeft, footBtns);

  dialog.append(head, body, foot);

  dialog.addEventListener('close', () => {
    dialog.returnValue = '';
    saving = false;
  });

  // Form controls created once and updated via renderForm()
  const claimTitleInput = document.createElement('input');
  claimTitleInput.className = 'rg-input';
  claimTitleInput.placeholder = 'Concise descriptive title…';
  claimTitleInput.maxLength = 240;

  const assertionInput = document.createElement('textarea');
  assertionInput.className = 'rg-textarea';
  assertionInput.rows = 3;
  assertionInput.placeholder = 'State the precise claim cleanly…';

  const scopeInput = document.createElement('input');
  scopeInput.className = 'rg-input';
  scopeInput.placeholder = 'e.g. Gen 1:11–12 & Mat 13 (corpus/domain scope)';

  const limitationsInput = document.createElement('textarea');
  limitationsInput.className = 'rg-textarea';
  limitationsInput.rows = 2;
  limitationsInput.placeholder = 'Document caveats, non-equivalences, or boundary conditions…';

  const questionsInput = document.createElement('input');
  questionsInput.className = 'rg-input';
  questionsInput.placeholder = 'Open questions separated by semicolons (;)…';

  const predicateSelect = document.createElement('select');
  predicateSelect.className = 'rg-select';

  const claimKindSelect = document.createElement('select');
  claimKindSelect.className = 'rg-select';
  for (const ck of CLAIM_KINDS) {
    const o = document.createElement('option');
    o.value = ck.value;
    o.textContent = ck.label;
    claimKindSelect.append(o);
  }

  const evidenceClassSelect = document.createElement('select');
  evidenceClassSelect.className = 'rg-select';
  for (const ec of EVIDENCE_CLASSES) {
    const o = document.createElement('option');
    o.value = ec;
    o.textContent = ec;
    evidenceClassSelect.append(o);
  }

  const epistemicSelect = document.createElement('select');
  epistemicSelect.className = 'rg-select';
  for (const es of EPISTEMIC_STATES) {
    const o = document.createElement('option');
    o.value = es;
    o.textContent = es.replace(/_/g, ' ');
    epistemicSelect.append(o);
  }

  const confidenceInput = document.createElement('input');
  confidenceInput.type = 'number';
  confidenceInput.min = '0';
  confidenceInput.max = '1';
  confidenceInput.step = '0.05';
  confidenceInput.value = '0.75';
  confidenceInput.className = 'rg-input';

  const visibilitySelect = document.createElement('select');
  visibilitySelect.className = 'rg-select';
  for (const vis of ['public', 'private'] as const) {
    const o = document.createElement('option');
    o.value = vis;
    o.textContent = vis === 'public' ? 'Public (shared research graph)' : 'Private (requires sign-in)';
    visibilitySelect.append(o);
  }

  const linkNoteInput = document.createElement('input');
  linkNoteInput.className = 'rg-input';
  linkNoteInput.placeholder = 'Optional link explanation (e.g. counterexample or revision reason)…';

  const subjectBox = el('div', 'rg-row-card');
  const objectBox = el('div', 'rg-row-card');
  const participantsBox = el('div', 'rg-row-card');
  const evidenceBox = el('div', 'rg-row-card');

  function emptyNodeDraft(): NodeDraftState {
    return {
      resolvedRef: null,
      resolvedLabel: null,
      createNew: false,
      nodeKind: 'concept',
      label: '',
      aliasesText: '',
      summary: '',
    };
  }

  function showError(msg: string | null) {
    if (!msg) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    } else {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    }
  }

  function populatePredicateOptions(selected?: string) {
    predicateSelect.replaceChildren();
    const sorted = [...connectionTypes].sort((a, b) => Number(Boolean(a.discouraged)) - Number(Boolean(b.discouraged)));
    for (const ct of sorted) {
      const opt = document.createElement('option');
      opt.value = ct.type_key;
      opt.textContent = ct.discouraged ? `${ct.label} [broad/discouraged]` : `${ct.label} (${ct.category})`;
      predicateSelect.append(opt);
    }
    if (selected && sorted.some(s => s.type_key === selected)) {
      predicateSelect.value = selected;
    } else if (sorted.some(s => s.type_key === 'parallels')) {
      predicateSelect.value = 'parallels';
    }
  }

  async function ensureConnectionTypes() {
    const res = await BibleRPC.notes.connectionTypes();
    if (res.data?.connection_types?.length) {
      connectionTypes = res.data.connection_types;
      populatePredicateOptions(predicateSelect.value || currentPrefill.predicate);
    }
  }

  function renderNodeSelector(container: HTMLElement, roleTitle: string, draft: NodeDraftState) {
    container.replaceChildren();
    const headRow = el('div', 'rg-actions-row');
    headRow.append(el('span', 'rg-field__label', roleTitle));

    const toggleNewBtn = action(
      draft.createNew ? 'Search existing entity instead' : '+ New research concept/process node',
      () => {
        draft.createNew = !draft.createNew;
        renderNodeSelector(container, roleTitle, draft);
      },
      'text-action',
    );
    headRow.append(toggleNewBtn);
    container.append(headRow);

    if (draft.resolvedRef) {
      const pill = el('div', 'rg-actions-row');
      pill.append(
        el('span', 'rg-badge rg-badge--confirmed', `Selected: ${draft.resolvedLabel ?? draft.resolvedRef} (${draft.resolvedRef})`),
        action('Clear', () => {
          draft.resolvedRef = null;
          draft.resolvedLabel = null;
          renderNodeSelector(container, roleTitle, draft);
        }, 'text-action'),
      );
      container.append(pill);
    }

    if (!draft.createNew) {
      const searchRow = el('div', 'rg-actions-row');
      const queryInput = document.createElement('input');
      queryInput.className = 'rg-input rg-input--grow';
      queryInput.placeholder = 'Search Strongs (H2233), Gen 1:11, lemma, person, or RG node…';
      queryInput.value = draft.label;
      const resultsWrap = el('div', 'rg-actions-row');
      const searchBtn = action('Resolve', async () => {
        const q = queryInput.value.trim();
        if (!q) return;
        draft.label = q;
        resultsWrap.replaceChildren(status('Searching…'));
        const res = await BibleRPC.graph.resolveEntity(q, null, 8);
        resultsWrap.replaceChildren();
        const items: Array<{ ref: string; label: string; kind: string }> = [];
        for (const n of res.data?.rg_nodes ?? []) {
          items.push({ ref: n.node_key, label: n.label, kind: `RG:${n.node_kind}` });
        }
        for (const c of res.data?.canonical_candidates ?? []) {
          items.push({ ref: c.suggested_node_key, label: `${c.label} ${c.strongs_code ?? ''}`.trim(), kind: `Canonical:${c.node_kind}` });
        }
        if (items.length === 0) {
          resultsWrap.append(el('span', 'study-muted', `No existing node matched "${q}". Switch to "+ New research node" if creating an abstract/scientific node.`));
          return;
        }
        for (const it of items.slice(0, 6)) {
          resultsWrap.append(
            action(`${it.label} [${it.kind}]`, () => {
              draft.resolvedRef = it.ref;
              draft.resolvedLabel = it.label;
              renderNodeSelector(container, roleTitle, draft);
            }, 'study-button'),
          );
        }
      }, 'study-button');
      searchRow.append(queryInput, searchBtn);
      container.append(searchRow, resultsWrap);
    } else {
      const kindSel = document.createElement('select');
      kindSel.className = 'rg-select';
      for (const nk of RESEARCH_NODE_KINDS) {
        const o = document.createElement('option');
        o.value = nk;
        o.textContent = nk.replace(/_/g, ' ');
        kindSel.append(o);
      }
      kindSel.value = draft.nodeKind;
      kindSel.addEventListener('change', () => {
        draft.nodeKind = kindSel.value as RgNodeKind;
      });

      const labelIn = document.createElement('input');
      labelIn.className = 'rg-input';
      labelIn.placeholder = 'Concept / process / external source label…';
      labelIn.value = draft.label;
      labelIn.addEventListener('input', () => {
        draft.label = labelIn.value;
      });

      const aliasesIn = document.createElement('input');
      aliasesIn.className = 'rg-input';
      aliasesIn.placeholder = 'Aliases (comma-separated)…';
      aliasesIn.value = draft.aliasesText;
      aliasesIn.addEventListener('input', () => {
        draft.aliasesText = aliasesIn.value;
      });

      const summaryIn = document.createElement('input');
      summaryIn.className = 'rg-input';
      summaryIn.placeholder = 'Working definition / disambiguation note…';
      summaryIn.value = draft.summary;
      summaryIn.addEventListener('input', () => {
        draft.summary = summaryIn.value;
      });

      container.append(kindSel, labelIn, aliasesIn, summaryIn);
    }
  }

  function renderEvidenceSection() {
    evidenceBox.replaceChildren();
    const headRow = el('div', 'rg-actions-row');
    headRow.append(
      el('span', 'rg-field__label', 'Evidence & Counterexamples'),
      action('+ Scripture Verse ID', () => {
        evidenceList.push({ polarity: 'supporting', evidence_kind: 'scripture_verse', external_title: '', external_url: '', explanation: '' });
        renderEvidenceSection();
      }, 'study-button'),
      action('+ External HTTPS Source', () => {
        evidenceList.push({ polarity: 'supporting', evidence_kind: 'external_source', external_title: '', external_url: '', explanation: '' });
        renderEvidenceSection();
      }, 'study-button'),
      action('+ Counterexample', () => {
        evidenceList.push({ polarity: 'counterexample', evidence_kind: 'scripture_verse', external_title: '', external_url: '', explanation: '' });
        renderEvidenceSection();
      }, 'study-button'),
    );
    evidenceBox.append(headRow);

    if (evidenceList.length === 0) {
      evidenceBox.append(el('p', 'study-muted', 'Attach Scripture verse/word/lemma witnesses or HTTPS scientific sources. Do NOT fabricate biblical anchors for external scientific claims.'));
    }

    evidenceList.forEach((ev, idx) => {
      const row = el('div', 'rg-row-card');
      const top = el('div', 'rg-actions-row');
      const polSel = document.createElement('select');
      polSel.className = 'rg-select';
      for (const p of ['supporting', 'counterexample', 'control', 'limiting_case'] as const) {
        const o = document.createElement('option');
        o.value = p;
        o.textContent = p;
        polSel.append(o);
      }
      polSel.value = ev.polarity;
      polSel.addEventListener('change', () => { ev.polarity = polSel.value as EvidenceDraftState['polarity']; });

      const kindSel = document.createElement('select');
      kindSel.className = 'rg-select';
      for (const k of ['scripture_verse', 'word_occurrence', 'lemma', 'external_source', 'prior_claim', 'algorithm_edge'] as RgEvidenceKind[]) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = k;
        kindSel.append(o);
      }
      kindSel.value = ev.evidence_kind;
      kindSel.addEventListener('change', () => {
        ev.evidence_kind = kindSel.value as RgEvidenceKind;
        renderEvidenceSection();
      });

      const removeBtn = action('Remove', () => {
        evidenceList.splice(idx, 1);
        renderEvidenceSection();
      }, 'text-action');
      top.append(polSel, kindSel, removeBtn);
      row.append(top);

      if (ev.evidence_kind === 'external_source') {
        const titleIn = document.createElement('input');
        titleIn.className = 'rg-input';
        titleIn.placeholder = 'Source title (e.g. DOI / journal article / historical source)…';
        titleIn.value = ev.external_title;
        titleIn.addEventListener('input', () => { ev.external_title = titleIn.value; });

        const urlIn = document.createElement('input');
        urlIn.className = 'rg-input';
        urlIn.placeholder = 'https://…';
        urlIn.value = ev.external_url;
        urlIn.addEventListener('input', () => { ev.external_url = urlIn.value; });
        row.append(titleIn, urlIn);
      } else {
        const refInput = document.createElement('input');
        refInput.className = 'rg-input';
        refInput.placeholder = ev.evidence_kind === 'scripture_verse'
          ? 'Verse ref (e.g. Gen 1:11) or numeric verse_id'
          : ev.evidence_kind === 'word_occurrence' || ev.evidence_kind === 'lemma'
            ? 'Numeric word_id or lemma_id'
            : 'Target key or ID';
        refInput.value = ev.verse_id ? String(ev.verse_id) : ev.word_id ? String(ev.word_id) : ev.external_title;
        const resolveHint = el('span', 'study-muted');
        refInput.addEventListener('change', async () => {
          const v = refInput.value.trim();
          if (/^\d+$/.test(v)) {
            if (ev.evidence_kind === 'lemma') ev.lemma_id = Number(v);
            else if (ev.evidence_kind === 'word_occurrence') ev.word_id = Number(v);
            else ev.verse_id = Number(v);
            return;
          }
          if (v && ev.evidence_kind === 'scripture_verse') {
            const res = await BibleRPC.graph.resolveEntity(v, ['passage'], 3);
            const first = res.data?.canonical_candidates?.find(c => c.verse_id);
            if (first?.verse_id) {
              ev.verse_id = first.verse_id;
              resolveHint.textContent = `Resolved verse_id=${first.verse_id} (${first.label})`;
            }
          }
        });
        row.append(refInput, resolveHint);
      }

      const expIn = document.createElement('input');
      expIn.className = 'rg-input';
      expIn.placeholder = 'Why this witness supports / limits / challenges the claim…';
      expIn.value = ev.explanation;
      expIn.addEventListener('input', () => { ev.explanation = expIn.value; });
      row.append(expIn);
      evidenceBox.append(row);
    });
  }

  function renderParticipantsSection() {
    participantsBox.replaceChildren();
    const headRow = el('div', 'rg-actions-row');
    headRow.append(
      el('span', 'rg-field__label', 'Ordered N-ary Participants (optional — for multi-role processes & Gentner mappings)'),
      action('+ Add Participant', () => {
        participantList.push({ role: 'instrument', nodeRef: '', notes: '' });
        renderParticipantsSection();
      }, 'study-button'),
    );
    participantsBox.append(headRow);
    participantList.forEach((p, idx) => {
      const row = el('div', 'rg-actions-row');
      const roleSel = document.createElement('select');
      roleSel.className = 'rg-select';
      for (const r of PARTICIPANT_ROLES) {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = r;
        roleSel.append(o);
      }
      roleSel.value = p.role;
      roleSel.addEventListener('change', () => { p.role = roleSel.value as RgParticipantRole; });

      const refIn = document.createElement('input');
      refIn.className = 'rg-input rg-input--grow';
      refIn.placeholder = 'Node key (e.g. lemma:H2233 or concept:seed_info)';
      refIn.value = p.nodeRef;
      refIn.addEventListener('input', () => { p.nodeRef = refIn.value; });

      row.append(roleSel, refIn, action('×', () => {
        participantList.splice(idx, 1);
        renderParticipantsSection();
      }, 'text-action'));
      participantsBox.append(row);
    });
  }

  function renderForm() {
    formWrap.replaceChildren();
    const wrapField = (labelText: string, control: HTMLElement, full = false) => {
      const f = el('div', `rg-field${full ? ' rg-field--full' : ''}`);
      f.append(el('label', 'rg-field__label', labelText), control);
      return f;
    };

    if (mode === 'challenge' || mode === 'supersede') {
      const notice = el('div', 'rg-warning-box',
        mode === 'challenge'
          ? `Challenging existing claim: "${currentPrefill.targetClaim?.title ?? ''}". This creates an independent critique claim linked via challenges.`
          : `Superseding existing claim: "${currentPrefill.targetClaim?.title ?? ''}". The prior claim will be marked superseded while preserving revision history.`);
      notice.classList.add('rg-field--full');
      formWrap.append(notice);
    }

    const subjWrap = el('div', 'rg-field rg-field--full');
    subjWrap.append(subjectBox);
    const objWrap = el('div', 'rg-field rg-field--full');
    objWrap.append(objectBox);
    const partWrap = el('div', 'rg-field rg-field--full');
    partWrap.append(participantsBox);
    const evWrap = el('div', 'rg-field rg-field--full');
    evWrap.append(evidenceBox);

    formWrap.append(
      subjWrap,
      wrapField('Predicate (controlled relational vocabulary)', predicateSelect),
      wrapField('Claim Kind', claimKindSelect),
      objWrap,
      wrapField('Claim Title', claimTitleInput, true),
      wrapField('Assertion Statement', assertionInput, true),
      wrapField('Evidence Class (DLM Partition)', evidenceClassSelect),
      wrapField('Epistemic State', epistemicSelect),
      wrapField('Contextual Scope', scopeInput),
      wrapField('Confidence (0.0 – 1.0)', confidenceInput),
      wrapField('Limitations & Non-Equivalences', limitationsInput, true),
      wrapField('Unresolved Questions (;-separated)', questionsInput, true),
      partWrap,
      evWrap,
      wrapField('Visibility', visibilitySelect),
      ...(mode === 'challenge' || mode === 'supersede'
        ? [wrapField('Critique / Supersession Rationale', linkNoteInput)]
        : []),
    );

    renderNodeSelector(subjectBox, 'Subject Node (required)', subjectDraft);
    renderNodeSelector(objectBox, 'Object / Target Node (optional for single-entity definitions/questions)', objectDraft);
    renderParticipantsSection();
    renderEvidenceSection();
  }

  async function submitClaim() {
    if (saving) return;
    showError(null);
    const title = claimTitleInput.value.trim();
    const assertionText = assertionInput.value.trim();
    if (title.length < 3 || assertionText.length < 3) {
      showError('Provide both a claim title and an assertion statement.');
      return;
    }
    if (!subjectDraft.resolvedRef && !(subjectDraft.createNew && subjectDraft.label.trim().length >= 2)) {
      showError('Select or define a valid Subject node.');
      return;
    }

    const nodes: RgBatchPayload['nodes'] = [];
    let subjectRef = subjectDraft.resolvedRef;
    if (!subjectRef && subjectDraft.createNew) {
      const ckey = generateClientKey('node');
      nodes.push({
        client_key: ckey,
        node_kind: subjectDraft.nodeKind,
        label: subjectDraft.label.trim(),
        aliases: subjectDraft.aliasesText.split(',').map(s => s.trim()).filter(Boolean),
        summary: subjectDraft.summary.trim() || undefined,
        visibility: visibilitySelect.value as 'public' | 'private',
      });
      subjectRef = ckey;
    }

    let objectRef = objectDraft.resolvedRef;
    if (!objectRef && objectDraft.createNew && objectDraft.label.trim().length >= 2) {
      const ckey = generateClientKey('node');
      nodes.push({
        client_key: ckey,
        node_kind: objectDraft.nodeKind,
        label: objectDraft.label.trim(),
        aliases: objectDraft.aliasesText.split(',').map(s => s.trim()).filter(Boolean),
        summary: objectDraft.summary.trim() || undefined,
        visibility: visibilitySelect.value as 'public' | 'private',
      });
      objectRef = ckey;
    }

    const evClass = evidenceClassSelect.value as RgEvidenceClass;
    const validEvidence = evidenceList
      .filter(ev =>
        (ev.evidence_kind === 'external_source' && ev.external_url.trim().startsWith('https://') && ev.external_title.trim().length >= 3) ||
        (ev.evidence_kind !== 'external_source' && (ev.verse_id || ev.word_id || ev.lemma_id || ev.external_title.trim())),
      )
      .map(ev => ({
        polarity: ev.polarity,
        evidence_kind: ev.evidence_kind,
        verse_id: ev.verse_id,
        word_id: ev.word_id,
        lemma_id: ev.lemma_id,
        external_title: ev.external_title.trim() || undefined,
        external_url: ev.external_url.trim() || undefined,
        explanation: ev.explanation.trim() || 'Recorded supporting/limiting evidence',
        is_primary_source: ev.evidence_kind !== 'prior_claim',
      }));

    if (evClass === 'SCIENCE_EMPIRICAL' && !validEvidence.some(e => e.evidence_kind === 'external_source')) {
      showError('SCIENCE_EMPIRICAL requires at least one External HTTPS Source with a title and https:// URL.');
      return;
    }
    if (evClass === 'TEXT_EXPLICIT' && !validEvidence.some(e => e.verse_id || e.word_id || e.lemma_id)) {
      showError('TEXT_EXPLICIT requires at least one biblical Scripture/word/lemma witness.');
      return;
    }

    const claimClientKey = generateClientKey('claim');
    const existingId = mode === 'edit' ? currentPrefill.existingClaim?.id : undefined;
    const links: RgBatchPayload['links'] = [];
    if ((mode === 'challenge' || mode === 'supersede') && currentPrefill.targetClaim?.id) {
      links.push({
        from_claim_ref: claimClientKey,
        to_claim_ref: currentPrefill.targetClaim.id,
        link_type: mode === 'challenge' ? 'challenges' : 'supersedes',
        explanation: linkNoteInput.value.trim() || `${mode} submitted via UI`,
      });
    }

    const payload: RgBatchPayload = {
      nodes,
      claims: [
        {
          ...(existingId ? { id: existingId, expected_version: currentPrefill.existingClaim?.version } : {}),
          client_key: claimClientKey,
          client_request_id: generateRequestId(),
          claim_kind: claimKindSelect.value as RgClaimKind,
          subject_ref: subjectRef ?? undefined,
          predicate: predicateSelect.value,
          object_ref: objectRef ?? undefined,
          title,
          assertion_text: assertionText,
          contextual_scope: scopeInput.value.trim() || 'Cross-corpus research scope',
          limitations: limitationsInput.value.trim(),
          unresolved_questions: questionsInput.value.split(';').map(s => s.trim()).filter(Boolean),
          evidence_class: evClass,
          epistemic_state: epistemicSelect.value as RgEpistemicState,
          confidence: Number(confidenceInput.value) || 0.75,
          visibility: visibilitySelect.value as 'public' | 'private',
          ...(mode === 'supersede' && currentPrefill.targetClaim?.id ? { supersedes_claim_id: currentPrefill.targetClaim.id } : {}),
          participants: participantList
            .filter(p => p.nodeRef.trim())
            .map((p, idx) => ({ role: p.role, node_ref: p.nodeRef.trim(), ordinal: idx + 1, notes: p.notes || undefined })),
          evidence: validEvidence,
        },
      ],
      links,
    };

    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const res = await BibleRPC.graph.saveBatch(payload);
      if (res.ok === true) {
        dialog.close('saved');
        opts?.onSaved?.(res);
      } else {
        const err = res.error as { message?: string } | undefined;
        showError(err?.message || 'Unable to save claim.');
      }
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save to Knowledge Graph';
    }
  }

  function open(prefill: ClaimComposerPrefill = {}) {
    currentPrefill = prefill;
    mode = prefill.mode ?? 'create';
    showError(null);

    subjectDraft = emptyNodeDraft();
    objectDraft = emptyNodeDraft();
    evidenceList = [];
    participantList = [];

    if (prefill.existingClaim && mode === 'edit') {
      const c = prefill.existingClaim;
      titleEl.textContent = 'Edit Research Claim';
      subjectDraft.resolvedRef = c.subject?.node_key ?? null;
      subjectDraft.resolvedLabel = c.subject?.label ?? null;
      objectDraft.resolvedRef = c.object?.node_key ?? null;
      objectDraft.resolvedLabel = c.object?.label ?? null;
      claimTitleInput.value = c.title;
      assertionInput.value = c.assertion_text;
      scopeInput.value = c.contextual_scope || '';
      limitationsInput.value = c.limitations || '';
      questionsInput.value = (c.unresolved_questions ?? []).join('; ');
      claimKindSelect.value = c.claim_kind;
      evidenceClassSelect.value = c.evidence_class;
      epistemicSelect.value = c.epistemic_state;
      confidenceInput.value = c.confidence != null ? String(c.confidence) : '0.75';
      visibilitySelect.value = c.visibility ?? 'public';
      populatePredicateOptions(c.predicate);
      evidenceList = (c.evidence ?? []).map(ev => ({
        polarity: ev.polarity,
        evidence_kind: ev.evidence_kind,
        verse_id: ev.verse_id ?? undefined,
        word_id: ev.word_id ?? undefined,
        lemma_id: ev.lemma_id ?? undefined,
        external_title: ev.external_title ?? '',
        external_url: ev.external_url ?? '',
        explanation: ev.explanation ?? '',
      }));
      participantList = (c.participants ?? []).map(p => ({
        role: p.role,
        nodeRef: p.node_key,
        notes: p.notes ?? '',
      }));
    } else {
      titleEl.textContent =
        mode === 'challenge'
          ? 'Challenge Research Claim'
          : mode === 'supersede'
            ? 'Supersede Research Claim'
            : 'New Research Knowledge Claim';
      subjectDraft.resolvedRef = prefill.subjectRef ?? prefill.targetClaim?.subject_ref ?? null;
      subjectDraft.resolvedLabel = prefill.subjectLabel ?? prefill.subjectRef ?? prefill.targetClaim?.subject_ref ?? null;
      subjectDraft.label = prefill.subjectQuery ?? '';
      objectDraft.resolvedRef = prefill.objectRef ?? prefill.targetClaim?.object_ref ?? null;
      objectDraft.resolvedLabel = prefill.objectLabel ?? prefill.objectRef ?? prefill.targetClaim?.object_ref ?? null;
      objectDraft.label = prefill.objectQuery ?? '';
      claimTitleInput.value = prefill.title ?? (mode === 'challenge' && prefill.targetClaim ? `Challenge: ${prefill.targetClaim.title}` : '');
      assertionInput.value = prefill.assertionText ?? '';
      scopeInput.value = '';
      limitationsInput.value = '';
      questionsInput.value = '';
      linkNoteInput.value = '';
      claimKindSelect.value = mode === 'challenge' ? 'challenge_critique' : 'dlm_hypothesis';
      evidenceClassSelect.value = prefill.evidenceClass ?? 'DLM_HYPOTHESIS';
      epistemicSelect.value = mode === 'challenge' ? 'disputed' : 'plausible_hypothesis';
      confidenceInput.value = '0.75';
      visibilitySelect.value = 'public';
      populatePredicateOptions(mode === 'challenge' ? 'challenges' : prefill.predicate);
      if (prefill.subjectVerseId) {
        evidenceList.push({
          polarity: 'supporting',
          evidence_kind: 'scripture_verse',
          verse_id: prefill.subjectVerseId,
          external_title: prefill.subjectLabel ?? '',
          external_url: '',
          explanation: 'Anchored passage under investigation',
        });
      }
    }

    renderForm();
    void ensureConnectionTypes();
    if (!dialog.open) dialog.showModal();
  }

  return {
    element: dialog,
    open,
    close: () => dialog.close('cancel'),
  };
}
