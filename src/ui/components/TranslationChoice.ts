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
  const select = document.createElement('select');
  select.className = 'english-slot';
  select.setAttribute('aria-label', `English translation for word ${token.word_position}: ${token.original_word}`);
  const source = token.source_english ?? token.primary_english ?? '';
  const label = (english: string) => translationLabel(english, token.grammar_code);
  for (const english of token.english_translations) {
    const option = document.createElement('option'); option.value = english;
    option.textContent = label(english); select.append(option);
  }
  let current = token.primary_english ?? source;
  select.value = current;
  select.title = `${label(current)} · ${token.grammar_code ?? 'Grammar unavailable'}`;
  select.disabled = !canSave;
  const actions = document.createElement('div'); actions.className = 'translation-actions';
  const status = document.createElement('span');
  status.className = 'translation-status'; status.setAttribute('role', 'status');
  status.textContent = token.has_choice ? 'Saved' : token.word_id < 0 ? 'Sample' : 'Source';
  const reset = document.createElement('button'); reset.type = 'button';
  reset.className = 'translation-reset'; reset.textContent = 'Reset';
  reset.setAttribute('aria-label', `Reset translation for word ${token.word_position} to source`);
  reset.hidden = !token.has_choice; reset.disabled = !canSave;
  actions.append(status, reset); element.append(select, actions);
  select.addEventListener('change', () => { void save(select.value); });
  reset.addEventListener('click', () => { void save(null); });
  return element;

  // === @section:logic:save ===
  async function save(english: string | null) {
    const hadChoice = !reset.hidden;
    select.disabled = true; reset.disabled = true;
    status.textContent = 'Saving…'; status.classList.remove('save-error');
    element.setAttribute('aria-busy', 'true');
    const response = await BibleRPC.saveTranslation(p, token, english);
    if (response.source === 'live' && response.data) {
      current = response.data.english;
      reset.hidden = !response.data.saved;
      status.textContent = response.data.saved ? 'Saved' : 'Source restored';
    } else {
      reset.hidden = !hadChoice;
      status.textContent = response.error ?? 'Could not save. Please retry.';
      status.classList.add('save-error');
    }
    select.value = current;
    select.title = `${label(current)} · ${token.grammar_code ?? 'Grammar unavailable'}`;
    select.disabled = !canSave; reset.disabled = !canSave;
    element.setAttribute('aria-busy', 'false');
  }
}
