// @file: src/ui/components/ConnectionBuilder.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | logic:model | ui:controls | ui:row | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ConnectionDirection, NoteConnectionType } from '../../api/notes-types';
import type { ConnectionPayload } from '../../api/notes-api-types';
import { createConnectionChip } from './NoteCard';

export type BuilderDirection = 'directed' | 'reverse' | 'bidirectional' | 'undirected';

export interface ConnectionDraft {
  id: string;
  from_client_key: string;
  to_client_key: string;
  connection_type?: string | null;
  custom_label?: string | null;
  direction: BuilderDirection;
  explanation?: string | null;
}

export interface ConnectionAnchorItem {
  client_key: string;
  label?: string | null;
}

export interface ConnectionBuilderProps {
  getAnchors: () => ConnectionAnchorItem[];
  onChange?: (connections: ConnectionPayload[]) => void;
}

export interface ConnectionBuilderComponent {
  element: HTMLElement;
  setConnections: (list: Array<Partial<ConnectionDraft> | ConnectionPayload>) => void;
  getConnections: () => ConnectionPayload[];
  refreshAnchors: (confirmDrop?: (count: number) => boolean) => void;
}

// === @section:logic:model ===
export class ConnectionModel {
  types: NoteConnectionType[] = [];
  drafts: ConnectionDraft[] = [];
  private nextId = 1;

  async loadTypes(): Promise<NoteConnectionType[]> {
    if (this.types.length) return this.types;
    const res = await BibleRPC.notes.connectionTypes();
    this.types = res.data?.connection_types ?? [];
    return this.types;
  }

  findType(key?: string | null): NoteConnectionType | undefined {
    if (!key) return undefined;
    return this.types.find(t => t.type_key === key);
  }

  addDraft(anchors: ConnectionAnchorItem[]): ConnectionDraft | null {
    if (anchors.length < 2) return null;
    const draft: ConnectionDraft = {
      id: `conn_${this.nextId++}`,
      from_client_key: anchors[0].client_key,
      to_client_key: anchors[1].client_key,
      direction: 'directed',
    };
    this.drafts.push(draft);
    return draft;
  }

  removeDraft(id: string): void {
    this.drafts = this.drafts.filter(d => d.id !== id);
  }

  updateDraft(id: string, updates: Partial<ConnectionDraft>): void {
    const draft = this.drafts.find(d => d.id === id);
    if (!draft) return;
    Object.assign(draft, updates);
    if ('connection_type' in updates && updates.connection_type) {
      const t = this.findType(updates.connection_type);
      if (t?.default_direction) draft.direction = t.default_direction as BuilderDirection;
    }
  }

  validateDraft(draft: ConnectionDraft, anchors: ConnectionAnchorItem[]): { valid: boolean; error?: string } {
    const fromOk = anchors.some(a => a.client_key === draft.from_client_key);
    const toOk = anchors.some(a => a.client_key === draft.to_client_key);
    if (!fromOk || !toOk) return { valid: false, error: 'Endpoint anchor not found' };
    if (draft.from_client_key === draft.to_client_key) return { valid: false, error: 'Cannot connect anchor to itself' };
    const firstIdx = this.drafts.findIndex(d => d.from_client_key === draft.from_client_key && d.to_client_key === draft.to_client_key);
    const myIdx = this.drafts.findIndex(d => d.id === draft.id);
    if (firstIdx !== -1 && firstIdx < myIdx) return { valid: false, error: 'Duplicate connection between these anchors' };
    return { valid: true };
  }

  toPayloads(anchors: ConnectionAnchorItem[]): ConnectionPayload[] {
    const payloads: ConnectionPayload[] = [];
    for (const draft of this.drafts) {
      if (!this.validateDraft(draft, anchors).valid) continue;
      const isRev = draft.direction === 'reverse';
      payloads.push({
        from: isRev ? draft.to_client_key : draft.from_client_key,
        to: isRev ? draft.from_client_key : draft.to_client_key,
        direction: (isRev ? 'directed' : draft.direction) as ConnectionDirection,
        connection_type: draft.connection_type && draft.connection_type !== '__custom__' ? draft.connection_type : null,
        custom_label: draft.custom_label ? draft.custom_label.trim() : null,
        explanation: draft.explanation ? draft.explanation.trim().slice(0, 1000) : null,
      });
    }
    return payloads;
  }
}

// === @section:ui:controls ===
export function createEndpointSelect(
  anchors: ConnectionAnchorItem[], selectedKey: string, ariaLabel: string, onChange: (val: string) => void
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'connection-select'; sel.setAttribute('aria-label', ariaLabel);
  anchors.forEach(a => {
    const o = document.createElement('option'); o.value = a.client_key; o.textContent = a.label || a.client_key;
    if (a.client_key === selectedKey) o.selected = true;
    sel.append(o);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function createDirectionControl(current: BuilderDirection, onChange: (dir: BuilderDirection) => void): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'connection-direction';
  const dirs: Array<{ val: BuilderDirection; icon: string; title: string }> = [
    { val: 'directed', icon: '→', title: 'Directed' },
    { val: 'reverse', icon: '←', title: 'Reverse' },
    { val: 'bidirectional', icon: '↔', title: 'Bidirectional' },
    { val: 'undirected', icon: '—', title: 'Undirected' },
  ];
  dirs.forEach(d => {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'connection-direction__btn' + (current === d.val ? ' is-active' : '');
    btn.textContent = d.icon; btn.title = d.title;
    btn.addEventListener('click', () => onChange(d.val));
    wrap.append(btn);
  });
  return wrap;
}

export function createTypeControls(
  types: NoteConnectionType[], currentType: string | null | undefined, currentCustom: string | null | undefined,
  onTypeChange: (typeKey: string, customLabel: string | null) => void, onCustomInput: (customLabel: string) => void
): { select: HTMLSelectElement; customInput: HTMLInputElement } {
  const sel = document.createElement('select'); sel.className = 'connection-select connection-select--type';
  const optNone = document.createElement('option'); optNone.value = ''; optNone.textContent = 'No type';
  if (!currentType) optNone.selected = true;
  sel.append(optNone);

  const cats = Array.from(new Set(types.map(t => t.category).filter(Boolean)));
  cats.forEach(cat => {
    const grp = document.createElement('optgroup'); grp.label = cat;
    types.filter(t => t.category === cat).forEach(t => {
      const o = document.createElement('option'); o.value = t.type_key; o.textContent = t.label;
      if (currentType === t.type_key) o.selected = true;
      grp.append(o);
    });
    sel.append(grp);
  });
  const optCust = document.createElement('option'); optCust.value = '__custom__'; optCust.textContent = 'Custom label…';
  const isCustom = currentType === '__custom__' || Boolean(currentCustom);
  if (isCustom) optCust.selected = true;
  sel.append(optCust);

  const customInput = document.createElement('input');
  customInput.type = 'text'; customInput.className = 'connection-input connection-input--custom';
  customInput.placeholder = 'Custom relation label...'; customInput.maxLength = 60;
  customInput.value = currentCustom || ''; customInput.hidden = !isCustom;

  sel.addEventListener('change', () => {
    const isC = sel.value === '__custom__';
    customInput.hidden = !isC;
    onTypeChange(sel.value, isC ? customInput.value : null);
  });
  customInput.addEventListener('input', () => onCustomInput(customInput.value));
  return { select: sel, customInput };
}

// === @section:ui:row ===
export function createConnectionRow(
  draft: ConnectionDraft,
  anchors: ConnectionAnchorItem[],
  types: NoteConnectionType[],
  model: ConnectionModel,
  onUpdate: () => void,
  onRemove: () => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'connection-row';
  const val = model.validateDraft(draft, anchors);
  if (!val.valid) row.classList.add('has-error');

  const top = document.createElement('div'); top.className = 'connection-row__top';
  const fromA = anchors.find(a => a.client_key === draft.from_client_key);
  const toA = anchors.find(a => a.client_key === draft.to_client_key);
  const typeInfo = model.findType(draft.connection_type);
  const typeLbl = draft.custom_label || typeInfo?.label || draft.connection_type || 'related';

  const preview = createConnectionChip({
    from_label: fromA?.label || draft.from_client_key,
    to_label: toA?.label || draft.to_client_key,
    direction: draft.direction,
    type_label: typeLbl,
    category: typeInfo?.category,
  });
  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.className = 'connection-row__remove';
  delBtn.textContent = '×'; delBtn.setAttribute('aria-label', 'Remove connection');
  delBtn.addEventListener('click', onRemove);
  top.append(preview, delBtn);

  const form = document.createElement('div'); form.className = 'connection-row__form';
  const fromSel = createEndpointSelect(anchors, draft.from_client_key, 'From anchor', v => {
    model.updateDraft(draft.id, { from_client_key: v }); onUpdate();
  });
  const dirCtrl = createDirectionControl(draft.direction, d => {
    model.updateDraft(draft.id, { direction: d }); onUpdate();
  });
  const toSel = createEndpointSelect(anchors, draft.to_client_key, 'To anchor', v => {
    model.updateDraft(draft.id, { to_client_key: v }); onUpdate();
  });
  const { select: typeSel, customInput } = createTypeControls(types, draft.connection_type, draft.custom_label, (t, c) => {
    model.updateDraft(draft.id, { connection_type: t, custom_label: c }); onUpdate();
  }, c => {
    model.updateDraft(draft.id, { custom_label: c }); onUpdate();
  });

  const exp = document.createElement('textarea'); exp.className = 'connection-textarea';
  exp.placeholder = 'Explanation (optional, max 1000 chars)...'; exp.maxLength = 1000;
  exp.value = draft.explanation || '';
  exp.addEventListener('input', () => { model.updateDraft(draft.id, { explanation: exp.value }); onUpdate(); });

  form.append(fromSel, dirCtrl, toSel, typeSel, customInput, exp);
  if (!val.valid && val.error) {
    const err = document.createElement('div'); err.className = 'connection-row__error';
    err.textContent = val.error; form.append(err);
  }
  row.append(top, form);
  return row;
}

// === @section:ui:main ===
export function createConnectionBuilder(props: ConnectionBuilderProps): ConnectionBuilderComponent {
  const element = document.createElement('div'); element.className = 'connection-builder';
  const model = new ConnectionModel();
  void model.loadTypes().then(() => render());

  const header = document.createElement('div'); header.className = 'connection-builder__header';
  const title = document.createElement('span'); title.className = 'connection-builder__title';
  title.textContent = 'Connections';
  const addBtn = document.createElement('button'); addBtn.type = 'button';
  addBtn.className = 'connection-add-btn'; addBtn.textContent = '+ Add connection';
  header.append(title, addBtn);

  const notice = document.createElement('div'); notice.className = 'connection-builder__notice';
  notice.textContent = 'At least 2 anchors are required to create connections.';
  const listEl = document.createElement('div'); listEl.className = 'connection-builder__list';

  const notify = () => props.onChange?.(model.toPayloads(props.getAnchors()));

  function render(): void {
    const anchors = props.getAnchors();
    const canAdd = anchors.length >= 2;
    notice.hidden = canAdd; addBtn.disabled = !canAdd;
    listEl.replaceChildren();
    model.drafts.forEach(draft => {
      listEl.append(createConnectionRow(draft, anchors, model.types, model, () => {
        render(); notify();
      }, () => {
        model.removeDraft(draft.id); render(); notify();
      }));
    });
  }

  addBtn.addEventListener('click', () => {
    if (model.addDraft(props.getAnchors())) { render(); notify(); }
  });

  function setConnections(list: Array<Partial<ConnectionDraft> | ConnectionPayload>): void {
    model.drafts = list.map((item, idx) => ({
      id: `conn_${idx + 1}`,
      from_client_key: 'from_client_key' in item ? item.from_client_key! : (item as ConnectionPayload).from,
      to_client_key: 'to_client_key' in item ? item.to_client_key! : (item as ConnectionPayload).to,
      connection_type: item.connection_type || null,
      custom_label: item.custom_label || null,
      direction: ((item.direction as BuilderDirection) || 'directed'),
      explanation: item.explanation || null,
    }));
    render(); notify();
  }

  function refreshAnchors(confirmDrop?: (count: number) => boolean): void {
    const keys = new Set(props.getAnchors().map(a => a.client_key));
    const dropped = model.drafts.filter(d => !keys.has(d.from_client_key) || !keys.has(d.to_client_key));
    if (dropped.length > 0 && (!confirmDrop || confirmDrop(dropped.length))) {
      model.drafts = model.drafts.filter(d => keys.has(d.from_client_key) && keys.has(d.to_client_key));
    }
    render(); notify();
  }

  element.append(header, notice, listEl);
  return { element, setConnections, getConnections: () => model.toPayloads(props.getAnchors()), refreshAnchors };
}
