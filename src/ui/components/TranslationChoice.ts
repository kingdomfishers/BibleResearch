// @file: src/ui/components/TranslationChoice.ts
// @feature: verse-reader
// @tables: verse_translation_sources | word_translation_choices
// @candidates: translation-label
// @toc: imports | logic:translation-label | ui:main | logic:save

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, VerseTranslationToken } from '../../api/types';
import '../styles-translations.css';

// === @section:logic:translation-label ===
export function translationLabel(english: string, grammar: string | null): string {
  const text = english.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
  if (text) return text;
  return grammar?.split('/').some(part => /^(?:H|A)?To$/.test(part))
    ? '[object marker]' : '[untranslated]';
}

// === @section:ui:main ===
export function createTranslationChoice(p: ActivePassage, token: VerseTranslationToken, canSave: boolean) {
  const element = document.createElement('div');
  element.className = 'translation-choice'; element.dir = 'ltr'; element.lang = 'en';

  const source = token.source_english ?? token.primary_english ?? '';
  const label = (english: string) => translationLabel(english, token.grammar_code);
  let current = token.primary_english ?? source;
  let hasChoice = token.has_choice;
  let hasError = false;
  let editing = false;
  let saving = false;
  let suppressBlur = false;

  const glossRow = document.createElement('div');
  glossRow.className = 'here-gloss-row';
  const hereGloss = document.createElement('span');
  hereGloss.className = 'here-gloss';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'translation-edit-btn';
  editBtn.textContent = '✎';
  editBtn.title = 'Choose custom English rendering';
  editBtn.setAttribute('aria-label', `Choose custom English rendering for word ${token.word_position}`);
  editBtn.setAttribute('aria-expanded', 'false');
  glossRow.append(hereGloss, editBtn);

  const select = document.createElement('select');
  select.className = 'english-slot';
  select.setAttribute('aria-label', `English translation for word ${token.word_position}: ${token.original_word}`);
  for (const english of token.english_translations) {
    const option = document.createElement('option'); option.value = english;
    option.textContent = label(english); select.append(option);
  }
  select.disabled = !canSave;
  select.hidden = true;

  const actions = document.createElement('div'); actions.className = 'translation-actions';
  const status = document.createElement('span');
  status.className = 'translation-status'; status.setAttribute('role', 'status');
  status.textContent = hasChoice ? 'Saved' : token.word_id < 0 ? 'Sample' : 'Source';
  const reset = document.createElement('button'); reset.type = 'button';
  reset.className = 'translation-reset'; reset.textContent = 'Reset';
  reset.setAttribute('aria-label', `Reset translation for word ${token.word_position} to source`);
  reset.hidden = !hasChoice; reset.disabled = !canSave;
  actions.append(status, reset);
  element.append(glossRow, select, actions);

  function syncDisplay() {
    const currentLabel = label(current);
    const titleText = `${currentLabel} · ${token.grammar_code ?? 'Grammar unavailable'}`;
    hereGloss.textContent = currentLabel;
    hereGloss.title = titleText;
    select.value = current;
    select.title = titleText;
    element.classList.toggle('has-choice', hasChoice);
    actions.hidden = !(editing || saving || hasChoice || hasError);
  }

  function setEditing(next: boolean) {
    editing = next;
    element.classList.toggle('is-editing', editing);
    editBtn.setAttribute('aria-expanded', String(editing));
    select.hidden = !editing;
    syncDisplay();
    if (editing && !select.disabled) {
      select.focus();
    }
  }

  syncDisplay();

  editBtn.addEventListener('click', () => {
    setEditing(!editing);
  });

  element.addEventListener('pointerdown', (e) => {
    if ((e.target as Element | null)?.closest('button, select')) {
      suppressBlur = true;
      setTimeout(() => { suppressBlur = false; }, 0);
    }
  });

  element.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editing) {
      e.preventDefault();
      e.stopPropagation();
      select.value = current;
      setEditing(false);
      editBtn.focus();
    }
  });

  element.addEventListener('focusout', (e) => {
    if (!editing || saving || suppressBlur) return;
    const nextTarget = e.relatedTarget;
    if (nextTarget instanceof Node && element.contains(nextTarget)) return;
    setEditing(false);
  });

  select.addEventListener('change', () => { void save(select.value); });
  reset.addEventListener('click', () => { void save(null); });
  return element;

  // === @section:logic:save ===
  async function save(english: string | null) {
    const hadChoice = !reset.hidden;
    const hadFocusInside = element.contains(document.activeElement);
    saving = true;
    select.disabled = true; reset.disabled = true;
    status.textContent = 'Saving…'; status.classList.remove('save-error');
    hasError = false;
    actions.hidden = false;
    element.setAttribute('aria-busy', 'true');
    const response = await BibleRPC.saveTranslation(p, token, english);
    if (response.source === 'live' && response.data) {
      current = response.data.english;
      hasChoice = response.data.saved;
      reset.hidden = !hasChoice;
      status.textContent = hasChoice ? 'Saved' : 'Source restored';
    } else {
      hasChoice = hadChoice;
      hasError = true;
      reset.hidden = !hadChoice;
      status.textContent = response.error ?? 'Could not save. Please retry.';
      status.classList.add('save-error');
    }
    select.disabled = !canSave; reset.disabled = !canSave;
    element.setAttribute('aria-busy', 'false');
    saving = false;
    setEditing(false);
    if (hadFocusInside && document.activeElement === document.body) {
      editBtn.focus({ preventScroll: true });
    }
  }
}
