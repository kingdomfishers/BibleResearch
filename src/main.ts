// @file: src/main.ts
// @feature: app-shell
// @tables: words | verses | reader_english_verses | reader_rendering_groups | reader_text_events | places | chronology_models
// @candidates: none
// @toc: imports | ui:main | ui:notes-browser | logic:selection | logic:passage

// === @section:imports ===
import './ui/styles.css';
import './ui/styles-mobile.css';
import './ui/styles-workspace.css';
import './ui/styles-notes.css';
import { BibleRPC } from './api/rpc';
import type { ActivePassage } from './api/types';
import { appState } from './ui/state';
import { createNavSelector } from './ui/components/NavSelector';
import { createVerseReader } from './ui/components/VerseReader';
import { createWordModal } from './ui/components/WordModal';
import { createVerseMap } from './ui/components/VerseMap';
import { createChronologyPanel } from './ui/components/ChronologyPanel';
import { createResearchPanel } from './ui/components/ResearchPanel';
import { createContextPreview } from './ui/components/ContextPreview';
import { createWordInspector } from './ui/components/WordInspector';
import { createEventTimeline } from './ui/components/EventTimeline';
import { createPassageComparison } from './ui/components/PassageComparison';
import { createStudySearch } from './ui/components/StudySearch';
import { createNotesPanel } from './ui/components/NotesPanel';
import { createNoteEditor } from './ui/components/NoteEditor';
import { createNotesBrowser } from './ui/components/NotesBrowser';
import { createPassageCrossReferences } from './ui/components/PassageCrossReferences';
import { notesState, parseNoteHash } from './ui/notes-state';

// === @section:ui:main ===
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<header class="study-header"><a class="study-brand" href="#1-1-1"><span class="study-brand-symbol" aria-hidden="true">א</span><span>BIBLE RESEARCH<small>WORDS. PLACES. CONNECTIONS.</small></span></a>
 <button class="study-button" id="all-notes-btn" type="button">All notes</button><button class="study-button" id="appearance" type="button">Appearance</button></header>
 <main class="study-main"><div class="study-intro"><div><p class="eyebrow">A CLOSER READING OF SCRIPTURE</p><h1>Ancient words. New connections.</h1></div><div id="study-search"></div></div>
 <div id="navigation"></div><div class="passage-stepper"><button class="text-action" id="previous-passage" type="button">← Previous verse</button><span>Read the English. Notice the original. Follow a connection.</span><button class="text-action" id="next-passage" type="button">Next verse →</button></div>
 <div id="notes-browser-slot"></div>
 <div class="study-workspace"><div><div id="reader"></div><div id="cross-references"></div><div id="notes"></div></div><div id="inspector"></div></div><div id="comparison"></div>
 <div id="geography"></div><details class="study-advanced" id="chronology-disclosure"><summary>Chronology models & historical evidence</summary><div id="chronology"></div></details>
 <details class="study-advanced" id="research-disclosure"><summary>Advanced study, patterns & exports</summary><div id="research-prompts"></div></details>
 <footer class="study-footer"><span>Original text & lexical renderings: STEP Bible · CC BY 4.0</span><span>English: World English Bible · Public domain</span></footer></main>`;
const navigate = (p: ActivePassage) => appState.setPassage(p);
const comparison = createPassageComparison(navigate);
const preview = createContextPreview(navigate, target => { void comparison.open(appState.getPassage(), target); });
const noteEditor = createNoteEditor({
  onSaved: note => {
    notesPanel.refresh();
    notesBrowser.refresh();
    notesState.setSelectedNoteId(note?.id ?? null);
  },
});
const inspector = createWordInspector(
  preview, navigate,
  data => noteEditor.openNew({ passage: appState.getPassage(), selectedWord: data.word, selectedPosition: data.position }),
  prefill => noteEditor.openNew({ passage: appState.getPassage(), prefill })
);
const passageXrefs = createPassageCrossReferences({
  onNavigate: navigate,
  onEvaluateRelationship: prefill => noteEditor.openNew({ passage: appState.getPassage(), prefill }),
});
const timeline = createEventTimeline(preview, key => geography.focusPlace(key));
const geography = createVerseMap(packet => timeline.setGeography(packet));
const reader = createVerseReader({
  context: timeline.element, preview, onWord: selectWord, onPlace: key => geography.focusPlace(key),
  onTokenNotes: pos => notesState.setSelectedTokenPosition(pos),
});
const notesPanel = createNotesPanel({
  onAdd: () => noteEditor.openNew({ passage: appState.getPassage() }),
  onEdit: note => noteEditor.openEdit(note),
  onDelete: async noteId => {
    await BibleRPC.notes.remove(noteId);
    notesPanel.refresh();
  },
  onTokenCounts: counts => reader.setNoteCounts(counts),
});
const nav = createNavSelector(navigate);
const modal = createWordModal(navigate);
let timelineModel = 'theographic-verse-v1';
const chronology = createChronologyPanel(summary => nav.updateChronology(summary), packet => {
  if (packet.model.id !== timelineModel) { timelineModel = packet.model.id; void timeline.load(appState.getPassage(), timelineModel); }
});
const research = createResearchPanel({ onSelectPassage: navigate, onInspectWord: id => { void modal.openWordModal(id); } });
const search = createStudySearch(navigate, id => selectWord(id));
for (const [selector, element] of [['#navigation', nav.element], ['#reader', reader.element], ['#cross-references', passageXrefs.element], ['#notes', notesPanel.element],
  ['#inspector', inspector.element], ['#comparison', comparison.element], ['#geography', geography.element],
  ['#chronology', chronology.element], ['#research-prompts', research.element], ['#study-search', search.element]] as const) app.querySelector(selector)!.append(element);
app.append(modal.element, preview.element, noteEditor.element);
let overview: Awaited<ReturnType<typeof BibleRPC.getReaderOverview>>['data'] = null;
const previous = app.querySelector<HTMLButtonElement>('#previous-passage')!, next = app.querySelector<HTMLButtonElement>('#next-passage')!;
previous.addEventListener('click', () => { if (overview?.previous) navigate(overview.previous); });
next.addEventListener('click', () => { if (overview?.next) navigate(overview.next); });
const appearance = app.querySelector<HTMLButtonElement>('#appearance')!;
function setTheme(theme: string) {
  document.documentElement.dataset.theme = theme; appearance.textContent = theme === 'dark' ? 'Light appearance' : 'Dark appearance';
}
try { setTheme(localStorage.getItem('bible-reading-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch { setTheme('dark'); }
appearance.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(theme);
  try { localStorage.setItem('bible-reading-theme', theme); } catch { /* Reading works without storage. */ }
});

// === @section:ui:notes-browser ===
const notesBrowser = createNotesBrowser({
  onNavigatePassage: navigate,
  onInspectWord: id => selectWord(id),
  onEditNote: note => noteEditor.openEdit(note),
  onDeleteNote: async id => {
    await BibleRPC.notes.remove(id);
    notesPanel.refresh();
  },
});
app.querySelector('#notes-browser-slot')!.append(notesBrowser.returnBar, notesBrowser.element);
app.querySelector<HTMLButtonElement>('#all-notes-btn')!.addEventListener('click', () => {
  if (notesBrowser.isOpen()) notesBrowser.close(); else notesBrowser.open();
});
function checkHash() {
  const noteId = parseNoteHash(location.hash);
  if (noteId) {
    void notesBrowser.openDeepLink(noteId);
  } else if (location.hash === '#notes') {
    notesBrowser.open();
  }
}
window.addEventListener('hashchange', checkHash);
checkHash();

// === @section:logic:selection ===
const selections = new Map<string, { id: number; position?: number; english?: string; rendering?: string }>();
const key = (p: ActivePassage) => `${p.book}-${p.chapter}-${p.verse}`;
function selectWord(id: number, position?: number, english?: string, rendering?: string, suggested = false) {
  const selection = { id, position, english, rendering }; selections.set(key(appState.getPassage()), selection);
  reader.selectPosition(position ?? null); void inspector.inspect(id, { position, english, rendering, suggested });
}

// === @section:logic:passage ===
let request = 0;
appState.subscribe(p => {
  const current = ++request;
  modal.close(); preview.dismiss(); inspector.reset(); comparison.close(); timeline.reset();
  overview = null; previous.disabled = true; next.disabled = true;
  nav.update(p); research.updatePassage(p); reader.setOverview(null); inspector.setOverview(null); reader.selectPosition(null);
  reader.setEnglish(null, 'Loading English verse…');
  reader.setNoteCounts([]);
  notesState.setSelectedTokenPosition(null);
  passageXrefs.setPassage(p);
  notesPanel.setPassage(p);
  const sample = BibleRPC.getSampleTranslations(p);
  reader.render(p, { data: sample, source: sample.length ? 'sample' : 'unavailable', error: null }, !sample.length);
  void geography.load(p); void chronology.load(p); void timeline.load(p, timelineModel);
  void BibleRPC.getReaderPassage(p).then(result => { if (current === request) reader.setEnglish(result.data, result.error); });
  const words = BibleRPC.getVerseTranslations(p).then(result => {
    if (current === request) reader.render(p, result); return result;
  });
  const context = BibleRPC.getReaderOverview(p).then(result => {
    if (current !== request) return;
    overview = result.data; reader.setOverview(overview); inspector.setOverview(overview);
    previous.disabled = !overview?.previous; next.disabled = !overview?.next;
  });
  void Promise.all([words, context]).then(([result]) => {
    if (current !== request || result.source !== 'live') return;
    const remembered = selections.get(key(p));
    if (remembered) { selectWord(remembered.id, remembered.position, remembered.english, remembered.rendering, true); return; }
    const token = result.data.find(t => /N|V/.test(t.grammar_code ?? '')) ?? result.data[0];
    if (token) selectWord(token.word_id, token.word_position, token.selected_english ?? token.source_english ?? '', undefined, true);
  });
});
