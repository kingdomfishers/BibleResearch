// @file: src/ui/components/NoteEditor.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | types | ui:dialog | ui:stance | ui:anchors | ui:blocks | ui:form | logic:save-handler | ui:main

// === @section:imports ===
import type { ActivePassage, Note, ResearcherRelationshipStance, WordRecord } from '../../api/types';
import type { NoteKind } from '../../api/notes-types';
import type { RelationshipNotePrefill } from '../../api/relationship-notes-adapter';
import { BibleRPC } from '../../api/rpc';
import { parseMarkdown, renderMarkdown } from '../note-markdown';
import { createTargetPicker, type TargetPickerComponent } from './TargetPicker';
import { createConnectionBuilder, type ConnectionBuilderComponent } from './ConnectionBuilder';
import {
  type EditorDraft,
  createEmptyDraft,
  buildNewDraftFromContext,
  setDraftRelationshipStance,
  noteToDraft,
  validateDraft,
  saveNoteDraft,
  generateClientKey,
  isValidHttps,
} from './NoteEditorModel';

// === @section:types ===
export interface NoteEditorProps {
  onSaved?: (note: Note) => void;
}

export interface NoteEditorContext {
  passage?: ActivePassage | null;
  verseId?: number | null;
  selectedWord?: WordRecord | null;
  selectedPosition?: number | null;
  prefill?: RelationshipNotePrefill | null;
}

export interface NoteEditorComponent {
  element: HTMLDialogElement;
  openNew: (ctx?: NoteEditorContext) => void;
  openEdit: (note: Note) => void;
  close: () => void;
}

// === @section:ui:dialog ===
export function createDialogShell(): {
  dialog: HTMLDialogElement;
  openDialog: () => void;
  closeDialog: () => void;
} {
  const dialog = document.createElement('dialog');
  dialog.className = 'note-editor-dialog';

  function openDialog(): void {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(): void {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  return { dialog, openDialog, closeDialog };
}

// === @section:ui:stance ===
export function createRelationshipStanceBar(
  getDraft: () => EditorDraft,
  onStanceChanged: () => void
): { section: HTMLElement; render: () => void } {
  const section = document.createElement('div');
  section.className = 'editor-section editor-section--stance';
  section.hidden = true;
  const label = document.createElement('p');
  label.className = 'editor-stance__summary';
  const btnGroup = document.createElement('div');
  btnGroup.className = 'editor-stance__buttons';
  btnGroup.setAttribute('role', 'group');
  btnGroup.setAttribute('aria-label', 'Researcher stance on external relationship');

  const options: Array<[ResearcherRelationshipStance, string]> = [
    ['agree', 'Agree'],
    ['disagree', 'Disagree'],
    ['alternative_interpretation', 'Alternative interpretation'],
  ];

  function render(): void {
    const ref = getDraft().source_context?.relationship_ref as Record<string, unknown> | undefined;
    if (!ref || typeof ref.relationship_id !== 'string') {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const active = (ref.stance as ResearcherRelationshipStance) || 'agree';
    label.textContent = `Evaluating ${String(ref.domain || '').replace('_', ' ')}: ${String(ref.subject_label || '')} → ${String(ref.target_label || '')}`;
    btnGroup.replaceChildren();
    for (const [val, text] of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `editor-btn editor-btn--sm editor-stance__btn${active === val ? ' is-active' : ''}`;
      btn.setAttribute('aria-pressed', active === val ? 'true' : 'false');
      btn.textContent = text;
      btn.addEventListener('click', () => {
        setDraftRelationshipStance(getDraft(), val);
        render();
        onStanceChanged();
      });
      btnGroup.append(btn);
    }
  }
  section.append(label, btnGroup);
  return { section, render };
}

// === @section:ui:anchors ===
export function createAnchorsView(
  getDraft: () => EditorDraft,
  targetPicker: TargetPickerComponent,
  connBuilder: ConnectionBuilderComponent,
  onDirty: () => void
): { section: HTMLElement; render: () => void } {
  const section = document.createElement('div');
  section.className = 'editor-section editor-section--anchors';
  const head = document.createElement('div'); head.className = 'editor-section__head';
  const title = document.createElement('span'); title.textContent = 'Anchors';
  const addBtn = document.createElement('button'); addBtn.type = 'button';
  addBtn.className = 'editor-btn editor-btn--sm'; addBtn.textContent = '+ Add anchor';
  head.append(title, addBtn);

  const list = document.createElement('div'); list.className = 'editor-anchors-list';
  const pickerWrap = document.createElement('div'); pickerWrap.className = 'editor-picker-wrap';
  pickerWrap.hidden = true; pickerWrap.append(targetPicker.element);

  addBtn.addEventListener('click', () => {
    pickerWrap.hidden = !pickerWrap.hidden;
    if (!pickerWrap.hidden) targetPicker.focus();
  });
  section.append(head, list, pickerWrap);

  function render(): void {
    list.replaceChildren();
    getDraft().anchors.forEach((anc, idx) => {
      const chip = document.createElement('span'); chip.className = 'note-chip';
      const bdi = document.createElement('bdi'); bdi.textContent = anc.label || `Anchor ${idx + 1}`;
      const rem = document.createElement('button'); rem.type = 'button'; rem.textContent = '×';
      rem.className = 'note-chip__remove'; rem.setAttribute('aria-label', `Remove ${anc.label}`);
      rem.addEventListener('click', () => {
        const draft = getDraft();
        draft.anchors = draft.anchors.filter(a => a.client_key !== anc.client_key);
        render(); connBuilder.refreshAnchors(); onDirty();
      });
      chip.append(bdi, rem); list.append(chip);
    });
  }

  return { section, render };
}

// === @section:ui:blocks ===
export function createBlocksView(
  getDraft: () => EditorDraft,
  onDirty: () => void
): { section: HTMLElement; render: () => void } {
  const section = document.createElement('div');
  section.className = 'editor-section editor-section--blocks';
  const head = document.createElement('div'); head.className = 'editor-section__head';
  const title = document.createElement('span'); title.textContent = 'Blocks';
  const addLinkBtn = document.createElement('button'); addLinkBtn.type = 'button';
  addLinkBtn.className = 'editor-btn editor-btn--sm'; addLinkBtn.textContent = '+ Link';
  const addImgBtn = document.createElement('button'); addImgBtn.type = 'button';
  addImgBtn.className = 'editor-btn editor-btn--sm'; addImgBtn.textContent = '+ Image';
  head.append(title, addLinkBtn, addImgBtn);

  const list = document.createElement('div'); list.className = 'editor-blocks-list';
  section.append(head, list);

  function addBlock(type: 'link' | 'image'): void {
    const url = window.prompt(`Enter ${type} URL (must start with https://):`);
    if (!url) return;
    if (!isValidHttps(url)) { window.alert('URL must begin with https://'); return; }
    const alt = type === 'image' ? (window.prompt('Enter image alt text:') || '') : '';
    const textAlt = window.prompt('Enter text alternative/description:') || '';
    getDraft().blocks.push({
      client_key: generateClientKey('blk'), block_type: type,
      content: type === 'image' ? { url, alt_text: alt } : { url },
      text_alternative: textAlt,
    });
    render(); onDirty();
  }
  addLinkBtn.addEventListener('click', () => addBlock('link'));
  addImgBtn.addEventListener('click', () => addBlock('image'));

  function render(): void {
    list.replaceChildren();
    getDraft().blocks.forEach(b => {
      const row = document.createElement('div'); row.className = 'editor-block-row';
      const info = document.createElement('span');
      if (b.block_type === 'link' || b.block_type === 'image') {
        info.textContent = `[${b.block_type}] ${b.content.url} (${b.text_alternative})`;
      } else if (b.block_type === 'markdown') {
        const mdPreview = String(b.content.markdown || '').slice(0, 35);
        info.textContent = `[markdown] ${mdPreview}... (${b.text_alternative})`;
      } else {
        info.textContent = `[${b.block_type}] (${b.text_alternative})`;
      }
      const rem = document.createElement('button'); rem.type = 'button'; rem.textContent = '×';
      rem.addEventListener('click', () => {
        const draft = getDraft();
        draft.blocks = draft.blocks.filter(x => x.client_key !== b.client_key);
        render(); onDirty();
      });
      row.append(info, rem); list.append(row);
    });
  }

  return { section, render };
}

// === @section:ui:form ===
export function createEditorForm(
  getDraft: () => EditorDraft,
  connBuilder: ConnectionBuilderComponent,
  onDirty: () => void
): { form: HTMLElement; titleInput: HTMLInputElement; bodyInput: HTMLTextAreaElement; update: () => void } {
  const form = document.createElement('div'); form.className = 'note-editor__form';
  const titleInput = document.createElement('input'); titleInput.type = 'text';
  titleInput.className = 'note-editor__title'; titleInput.placeholder = 'Note title (optional)...';
  titleInput.maxLength = 200;
  titleInput.addEventListener('input', () => { getDraft().title = titleInput.value; onDirty(); });

  const metaRow = document.createElement('div'); metaRow.className = 'note-editor__meta-row';
  const kindSelect = document.createElement('select'); kindSelect.className = 'note-editor__kind';
  const kinds: NoteKind[] = ['observation', 'linguistic', 'interpretation', 'question', 'cross_reference', 'research_lead', 'citation'];
  kinds.forEach(k => {
    const opt = document.createElement('option'); opt.value = k; opt.textContent = k.replace('_', ' ');
    kindSelect.append(opt);
  });
  kindSelect.addEventListener('change', () => { getDraft().note_kind = kindSelect.value as NoteKind; onDirty(); });

  const langSelect = document.createElement('select'); langSelect.className = 'note-editor__language';
  [['en', 'English'], ['he', 'Hebrew'], ['grc', 'Greek'], ['arc', 'Aramaic'], ['la', 'Latin']].forEach(([code, lbl]) => {
    const opt = document.createElement('option'); opt.value = code; opt.textContent = lbl;
    langSelect.append(opt);
  });
  langSelect.addEventListener('change', () => { getDraft().language = langSelect.value; onDirty(); });
  metaRow.append(kindSelect, langSelect);

  const tabs = document.createElement('div'); tabs.className = 'note-editor__tabs';
  const writeTab = document.createElement('button'); writeTab.type = 'button';
  writeTab.className = 'note-editor__tab is-active'; writeTab.textContent = 'Write';
  const prevTab = document.createElement('button'); prevTab.type = 'button';
  prevTab.className = 'note-editor__tab'; prevTab.textContent = 'Preview';
  tabs.append(writeTab, prevTab);

  const bodyInput = document.createElement('textarea'); bodyInput.className = 'note-editor__body';
  bodyInput.placeholder = 'Write note in markdown (up to 20,000 characters)...'; bodyInput.maxLength = 20000;
  const counter = document.createElement('div'); counter.className = 'note-editor__counter';
  const previewArea = document.createElement('div'); previewArea.className = 'note-editor__preview'; previewArea.hidden = true;

  bodyInput.addEventListener('input', () => {
    getDraft().body_md = bodyInput.value;
    counter.textContent = `${bodyInput.value.length} / 20,000`;
    onDirty();
  });
  writeTab.addEventListener('click', () => {
    writeTab.classList.add('is-active'); prevTab.classList.remove('is-active');
    bodyInput.hidden = false; previewArea.hidden = true;
  });
  prevTab.addEventListener('click', () => {
    prevTab.classList.add('is-active'); writeTab.classList.remove('is-active');
    bodyInput.hidden = true; previewArea.hidden = false;
    previewArea.replaceChildren(renderMarkdown(parseMarkdown(getDraft().body_md)));
  });

  form.append(titleInput, metaRow, tabs, bodyInput, counter, previewArea, connBuilder.element);
  function update(): void {
    const d = getDraft();
    titleInput.value = d.title; kindSelect.value = d.note_kind; langSelect.value = d.language || 'en';
    bodyInput.value = d.body_md; counter.textContent = `${d.body_md.length} / 20,000`;
  }
  return { form, titleInput, bodyInput, update };
}

// === @section:logic:save-handler ===
export function createSaveHandler(
  getDraft: () => EditorDraft,
  onReload: (freshNote: Note) => void,
  saveBtn: HTMLButtonElement,
  errBanner: HTMLElement,
  onSuccess: (note: Note) => void
): { handleSave: () => Promise<void>; getCopyBuffer: () => string } {
  let isPending = false;
  let copyBuffer = '';

  async function handleSave(): Promise<void> {
    if (isPending) return;
    const draft = getDraft();
    const val = validateDraft(draft);
    if (!val.valid) {
      errBanner.hidden = false;
      errBanner.textContent = Object.values(val.errors)[0] || 'Please fix form errors.';
      return;
    }
    isPending = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    errBanner.hidden = true;
    errBanner.replaceChildren();

    try {
      const res = await saveNoteDraft(draft);
      if (res.ok && res.note) {
        onSuccess(res.note);
      } else if (!res.ok && res.error?.code === 'version_conflict') {
        errBanner.hidden = false;
        copyBuffer = draft.body_md;
        const msg = document.createElement('span');
        msg.textContent = 'Conflict: note modified in another session. ';
        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button'; reloadBtn.className = 'editor-btn editor-btn--sm';
        reloadBtn.textContent = 'Reload note (preserves current text)';
        reloadBtn.addEventListener('click', async () => {
          if (draft.id) {
            const fresh = await BibleRPC.notes.getNote(draft.id);
            if (fresh.data) { onReload(fresh.data); errBanner.hidden = true; }
          }
        });
        errBanner.append(msg, reloadBtn);
      } else if (!res.ok) {
        errBanner.hidden = false;
        errBanner.textContent = res.error?.message || 'Save failed. Please retry.';
      }
    } catch (err: unknown) {
      errBanner.hidden = false;
      errBanner.textContent = err instanceof Error ? err.message : 'Network error saving note.';
    } finally {
      isPending = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Note';
    }
  }

  return { handleSave, getCopyBuffer: () => copyBuffer };
}

// === @section:ui:main ===
export function createNoteEditor(props: NoteEditorProps): NoteEditorComponent {
  let draft: EditorDraft = createEmptyDraft();
  let isDirty = false;
  const { dialog, openDialog, closeDialog } = createDialogShell();

  const connBuilder = createConnectionBuilder({
    getAnchors: () => draft.anchors.map(a => ({ client_key: a.client_key, label: a.label })),
    onChange: conns => { draft.connections = conns; isDirty = true; },
  });

  const targetPicker = createTargetPicker({
    onPick: candAnchor => {
      draft.anchors.push({ ...candAnchor, client_key: generateClientKey('anc') });
      anchorsView.render();
      connBuilder.refreshAnchors();
      targetPicker.reset();
      isDirty = true;
    },
  });

  const anchorsView = createAnchorsView(() => draft, targetPicker, connBuilder, () => { isDirty = true; });
  const blocksView = createBlocksView(() => draft, () => { isDirty = true; });
  const formView = createEditorForm(() => draft, connBuilder, () => { isDirty = true; });
  const stanceBar = createRelationshipStanceBar(() => draft, () => { formView.update(); isDirty = true; });

  const footer = document.createElement('div'); footer.className = 'note-editor__footer';
  const errBanner = document.createElement('div'); errBanner.className = 'note-editor__error-banner'; errBanner.hidden = true;
  const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'editor-btn'; cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'editor-btn editor-btn--primary'; saveBtn.textContent = 'Save Note';
  footer.append(cancelBtn, saveBtn);

  function syncViews(): void {
    stanceBar.render(); formView.update(); anchorsView.render(); blocksView.render();
    connBuilder.setConnections(draft.connections);
  }

  const { handleSave } = createSaveHandler(
    () => draft,
    freshNote => { draft = noteToDraft(freshNote); syncViews(); },
    saveBtn, errBanner,
    note => { isDirty = false; closeDialog(); props.onSaved?.(note); }
  );

  function handleClose(): void {
    if (isDirty && typeof window !== 'undefined' && window.confirm && !window.confirm('Discard unsaved changes?')) return;
    closeDialog();
  }
  cancelBtn.addEventListener('click', handleClose);
  dialog.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); handleClose(); } });
  saveBtn.addEventListener('click', () => void handleSave());

  dialog.append(errBanner, stanceBar.section, formView.form, anchorsView.section, blocksView.section, footer);

  function openNew(ctx?: NoteEditorContext): void {
    draft = buildNewDraftFromContext(ctx);
    syncViews(); isDirty = false;
    targetPicker.setContext(ctx || {});
    openDialog(); formView.titleInput.focus();
  }

  function openEdit(note: Note): void {
    draft = noteToDraft(note);
    syncViews(); isDirty = false;
    openDialog(); formView.titleInput.focus();
  }

  (dialog as any).__setSourceContext = (ctx: Record<string, unknown>) => {
    draft.source_context = { ...draft.source_context, ...ctx };
  };

  return { element: dialog, openNew, openEdit, close: handleClose };
}
