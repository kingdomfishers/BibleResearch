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
import './ui/styles-connections.css';
import './ui/styles-discovery-graph.css';
import './ui/styles-research-graph.css';
import './ui/styles-context-tools.css';
import './ui/styles-literary.css';
import { DiscoverConnectionsPanel } from './ui/components/DiscoverConnections';
import { BibleRPC } from './api/rpc';
import type { ActivePassage } from './api/types';
import type { ConnectionPayload, TargetCandidateAnchor } from './api/notes-api-types';
import { appState } from './ui/state';
import { explorationState, type Anchor } from './ui/exploration-state';
import { createDragController } from './ui/drag-controller';
import { createResearchTrailHeader } from './ui/components/ResearchTrailHeader';
import { createWordHoverPreview } from './ui/components/WordHoverPreview';
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
import { createDiscoveryGraph } from './ui/components/DiscoveryGraph';
import { createClaimComposerDialog } from './ui/components/ClaimComposerDialog';
import { createResearchGraphPanel } from './ui/components/ResearchGraphPanel';
import { createPatternBoard } from './ui/components/PatternBoard';
import { createQuickNoteComposer } from './ui/components/QuickNoteComposer';
import { createSplitPaneResizer } from './ui/components/SplitPaneResizer';
import { createStudySearch } from './ui/components/StudySearch';
import { createNotesPanel } from './ui/components/NotesPanel';
import { createNoteEditor } from './ui/components/NoteEditor';
import { createNotesBrowser } from './ui/components/NotesBrowser';
import { createPassageCrossReferences } from './ui/components/PassageCrossReferences';
import { createContextToolDialog, detectContextTools, type ContextToolChip } from './ui/context-tools/ContextToolDialog';
import { loadBiblePlacesIndex } from './ui/context-tools/curated-media-manifest';
import { loadFullPeopleGraph, loadVersePersonIndex } from './ui/context-tools/people-data';
import { notesState, parseNoteHash } from './ui/notes-state';
import { formatVerseRef } from './ui/utils';

// === @section:ui:main ===
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<div id="trail-header-slot"></div>
<div class="study-toolbar">
 <div id="navigation"></div>
 <div class="passage-stepper"><button class="text-action" id="previous-passage" type="button">← Prev</button><button class="text-action" id="next-passage" type="button">Next →</button></div>
 <div id="study-search"></div>
</div>
<div class="workspace-split">
 <main class="workspace-main-pane">
  <div class="workspace-main-inner">
   <div id="notes-browser-slot"></div>
   <div id="reader"></div>
   <div id="discovery-graph-slot"></div>
   <div id="pattern-board-slot"></div>
   <div id="cross-references"></div>
   <div id="notes"></div>
   <div id="comparison"></div>
   <details class="study-advanced" id="discover-workbench-disclosure"><summary>Deep connection explorer &amp; multi-concept search</summary><div id="discover-connections"></div></details>
   <details class="study-advanced" id="research-graph-disclosure"><summary>Research Knowledge Graph (claims, dossiers, paths &amp; trails)</summary><div id="research-graph"></div></details>
   <div id="geography"></div>
   <details class="study-advanced" id="chronology-disclosure"><summary>Chronology models &amp; historical evidence</summary><div id="chronology"></div></details>
   <details class="study-advanced" id="research-disclosure"><summary>Advanced study, patterns &amp; exports</summary><div id="research-prompts"></div></details>
   <footer class="study-footer"><span>Original text &amp; lexical renderings: STEP Bible · CC BY 4.0</span><span>English: World English Bible · Public domain</span></footer>
  </div>
 </main>
 <div id="resizer-slot"></div>
 <aside class="workspace-inspector-pane" aria-label="Word Inspector"><div id="inspector"></div></aside>
</div>`;

const splitContainer = app.querySelector<HTMLElement>('.workspace-split')!;
const inspectorReopenFab = document.createElement('button');
inspectorReopenFab.type = 'button';
inspectorReopenFab.className = 'inspector-reopen-fab';
inspectorReopenFab.textContent = 'Inspector ◂';
inspectorReopenFab.setAttribute('aria-label', 'Show word inspector');
inspectorReopenFab.hidden = true;

const INSPECTOR_OPEN_KEY = 'br-inspector-open';
let inspectorOpen = true;
try {
  if (localStorage.getItem(INSPECTOR_OPEN_KEY) === 'false') inspectorOpen = false;
} catch { /* Storage optional. */ }

let updateHeaderInspectorState: ((open: boolean) => void) | null = null;
function setInspectorOpen(open: boolean) {
  inspectorOpen = open;
  splitContainer.classList.toggle('is-inspector-closed', !open);
  inspectorReopenFab.hidden = open;
  updateHeaderInspectorState?.(open);
  try { localStorage.setItem(INSPECTOR_OPEN_KEY, String(open)); } catch { /* Storage optional. */ }
}
inspectorReopenFab.addEventListener('click', () => setInspectorOpen(true));

const navigate = (p: ActivePassage) => appState.setPassage(p);
const discoverDisclosure = app.querySelector<HTMLDetailsElement>('#discover-workbench-disclosure')!;

function openCompareWithTarget(target: ActivePassage) {
  const cur = appState.getPassage();
  const pins = explorationState.getSnapshot().pins;
  const source = pins.a?.passage ?? cur;
  if (!pins.a) explorationState.pinPassage('a', source);
  explorationState.pinPassage('b', target);
  void comparison.open(source, target);
}

function openHypothesisComposer(from: Anchor, to?: Anchor) {
  quickNoteComposer.open({
    passage: from.passage ?? appState.getPassage(),
    word: from.wordId
      ? {
          id: from.wordId,
          position: from.position,
          original: from.original,
          transliteration: from.transliteration,
          strongs: from.strongs,
          english: from.english,
        }
      : null,
    connectTo: to ?? null,
  });
}

const dragController = createDragController({
  getCurrentPassage: () => appState.getPassage(),
  onDropPinA: payload => {
    explorationState.pinPassage('a', payload.passage, payload.label, payload.wordPosition);
  },
  onDropCompareB: payload => {
    const cur = appState.getPassage();
    const pins = explorationState.getSnapshot().pins;
    const source = pins.a?.passage ?? cur;
    if (!pins.a) explorationState.pinPassage('a', source);
    explorationState.pinPassage('b', payload.passage, payload.label, payload.wordPosition);
    void comparison.open(source, payload.passage);
  },
  onDropQuickNote: payload => {
    quickNoteComposer.open({
      passage: payload.passage,
      word: payload.wordPosition
        ? {
            id: 0,
            position: payload.wordPosition,
            original: payload.original,
            strongs: payload.strongs,
            english: payload.label,
          }
        : null,
    });
  },
});

const quickNoteComposer = createQuickNoteComposer({
  onSaved: () => {
    notesPanel.refresh();
    notesBrowser.refresh();
  },
  onOpenFullEditor: target => {
    noteEditor.openNew({
      passage: target.passage,
      verseId: target.verseId,
      selectedPosition: target.word?.position ?? null,
    });
  },
  onOpenClaimComposer: target => {
    const ref = formatVerseRef(target.passage);
    claimComposer.open({
      mode: 'create',
      subjectQuery: target.word?.strongs || ref,
      subjectLabel: target.word ? `${target.word.original || ''} (${target.word.strongs || ''})`.trim() : ref,
      objectQuery: target.connectTo?.strongs || (target.connectTo?.passage ? formatVerseRef(target.connectTo.passage) : undefined),
      objectLabel: target.connectTo?.label,
      assertionText: target.initialText,
    });
  },
});

const claimComposer = createClaimComposerDialog({
  onSaved: () => {
    researchGraphPanel.refresh();
    discoveryGraph.reload?.();
  },
});

const preview = createContextPreview(
  navigate,
  openCompareWithTarget,
  {
    onPinA: p => {
      explorationState.pinPassage('a', p);
    },
    onQuickNote: p => {
      quickNoteComposer.open({ passage: p });
    },
  }
);

const comparison = createPassageComparison(navigate, {
  preview,
  onOpenPatternBoard: passages => {
    patternBoard.open(passages);
    patternBoard.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
  onAddNote: (a, b) => {
    const refA = formatVerseRef(a);
    const refB = formatVerseRef(b);
    void (async () => {
      const [resA, resB] = await Promise.all([
        BibleRPC.notes.searchTargets(refA, ['verse']),
        BibleRPC.notes.searchTargets(refB, ['verse']),
      ]);
      const ancA = resA.data?.groups?.[0]?.candidates?.[0]?.anchor;
      const ancB = resB.data?.groups?.[0]?.candidates?.[0]?.anchor;
      const anchors: Array<TargetCandidateAnchor & { client_key: string }> = [];
      const connections: ConnectionPayload[] = [];
      if (ancA) anchors.push({ ...ancA, client_key: 'anc_cmp_a' });
      if (ancB) anchors.push({ ...ancB, client_key: 'anc_cmp_b' });
      if (ancA && ancB) {
        connections.push({
          from: 'anc_cmp_a',
          to: 'anc_cmp_b',
          connection_type: 'comparison',
          direction: 'bidirectional',
          explanation: `User comparison note between ${refA} and ${refB}.`,
        });
      }
      if (!anchors.length) {
        noteEditor.openNew({ passage: a });
        return;
      }
      noteEditor.openNew({
        passage: a,
        prefill: {
          title: `Compare: ${refA} ↔ ${refB}`,
          body_md: `Comparing **${refA}** and **${refB}**:\n\n`,
          note_kind: 'cross_reference',
          anchors,
          connections,
          source_context: { comparison: [refA, refB] },
        },
      });
    })();
  },
});

const wordPreview = createWordHoverPreview();
const noteEditor = createNoteEditor({
  onSaved: note => {
    notesPanel.refresh();
    notesBrowser.refresh();
    notesState.setSelectedNoteId(note?.id ?? null);
  },
});

const discoverConnections = new DiscoverConnectionsPanel(
  app.querySelector<HTMLElement>('#discover-connections')!,
  {
    preview,
    onNavigatePassage: (book, chapter, verse) => {
      const target = { book, chapter, verse };
      explorationState.recordPassage(target);
      navigate(target);
      app.querySelector('#reader')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onInspectWordQuery: async (strongsOrLemma, passage) => {
      const cleanCode = strongsOrLemma.replace(/^lemma:/i, '').trim();
      const targetWordId = await BibleRPC.resolveWordId(cleanCode);
      if (passage) {
        explorationState.recordPassage({ book: passage.book, chapter: passage.chapter, verse: passage.verse });
        navigate({ book: passage.book, chapter: passage.chapter, verse: passage.verse });
      }
      if (targetWordId && targetWordId > 0) {
        selectWord(targetWordId);
        app.querySelector('#inspector')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },
    onReturnToOriginWord: (origin) => {
      const cur = appState.getPassage();
      if (cur.book !== origin.book || cur.chapter !== origin.chapter || cur.verse !== origin.verse) {
        selections.set(key(origin), { id: origin.word_id, position: origin.position, english: origin.english });
        navigate({ book: origin.book, chapter: origin.chapter, verse: origin.verse });
      } else {
        selectWord(origin.word_id, origin.position, origin.english, undefined, false);
      }
      app.querySelector('#reader')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
  }
);

const discoveryGraph = createDiscoveryGraph(
  {
    preview,
    onFollowPassage: (target, edge) => {
      explorationState.recordPassage(target, formatVerseRef(target), edge);
      navigate(target);
    },
    onComparePassage: openCompareWithTarget,
    onCreateHypothesis: openHypothesisComposer,
    onOpenClaimComposer: prefill => claimComposer.open(prefill),
    onRefreshResearchGraph: () => researchGraphPanel.refresh(),
  },
  {
    variant: 'full',
    defaultOpen: true,
    onRegisterDrag: dragController.registerHandle,
  }
);

const researchGraphPanel = createResearchGraphPanel({
  preview,
  navigate,
  onOpenComposer: prefill => claimComposer.open(prefill),
  onClaimsMutated: () => {
    discoveryGraph.reload?.();
  },
});

const patternBoard = createPatternBoard({
  preview,
  navigate,
  onSaveHypothesis: (from, to, summary) => {
    quickNoteComposer.open({
      passage: from.passage ?? appState.getPassage(),
      connectTo: to,
      initialText: summary,
    });
  },
  onOpenFullDiscovery: (query, mode) => {
    discoverDisclosure.open = true;
    discoverConnections.seedAndOpen(query, undefined, mode ?? 'discover');
  },
});

const inspector = createWordInspector(
  preview,
  navigate,
  data => quickNoteComposer.open({
    passage: appState.getPassage(),
    word: {
      id: data.word.id,
      position: data.position,
      original: data.word.original_word,
      transliteration: data.word.transliteration,
      strongs: data.word.strongs_nr,
      english: data.word.english_translations?.[0],
    },
  }),
  prefill => noteEditor.openNew({ passage: appState.getPassage(), prefill }),
  (term, origin) => {
    discoverDisclosure.open = true;
    discoverConnections.seedAndOpen(term, origin);
  },
  openCompareWithTarget,
  {
    onFollowPassage: (target, edge) => {
      explorationState.recordPassage(target, formatVerseRef(target), edge);
      navigate(target);
    },
    onCreateHypothesis: openHypothesisComposer,
    onExpandFullGraph: (query, p, label) => {
      discoveryGraph.expand();
      discoveryGraph.openForAnchor(query, p, label);
      discoveryGraph.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    onOpenContextTool: (kind, id, planId) => handleContextChipSelect({ kind, id, label: id, planId }),
    onOpenClaimComposer: prefill => claimComposer.open(prefill),
    onClose: () => setInspectorOpen(false),
  }
);

const passageXrefs = createPassageCrossReferences({
  onNavigate: navigate,
  onEvaluateRelationship: prefill => noteEditor.openNew({ passage: appState.getPassage(), prefill }),
});
const contextTools = createContextToolDialog({
  preview,
  onNavigate: navigate,
  onFocusMapPlace: key => geography.focusPlace(key),
  onInspectStrongs: async strongs => {
    const clean = strongs.trim();
    if (!clean) return;
    const tokMatch = latestTokens.find(t => t.strongs_nr.toUpperCase() === clean.toUpperCase());
    if (tokMatch) {
      selectWord(tokMatch.word_id, tokMatch.word_position, tokMatch.selected_english ?? tokMatch.source_english ?? '');
      return;
    }
    const wordId = await BibleRPC.resolveWordId(clean);
    if (wordId && wordId > 0) selectWord(wordId);
  },
});
function handleContextChipSelect(chip: ContextToolChip) {
  if (chip.kind === 'place') contextTools.openPlace(chip.id, geography.getCurrentPacket());
  else if (chip.kind === 'nations') contextTools.openNations(chip.id);
  else if (chip.kind === 'feast') contextTools.openFeasts(chip.id);
  else if (chip.kind === 'person') contextTools.openPerson(chip.id);
  else if (chip.kind === 'timeline') contextTools.openTimeline(appState.getPassage());
  else contextTools.openArchitecture(chip.planId, chip.id);
}
function refreshPassageContextChips(p: ActivePassage) {
  const chips = detectContextTools({
    passage: p,
    strongsList: latestTokens.map(t => t.strongs_nr).filter(Boolean),
    verseTokens: latestTokens,
    geographyPacket: geography.getCurrentPacket(),
  });
  timeline.setContextChips(chips, handleContextChipSelect);
}
const timeline = createEventTimeline(
  preview,
  key => contextTools.openPlace(key, geography.getCurrentPacket()),
  () => contextTools.openTimeline(appState.getPassage()),
);
const geography = createVerseMap(packet => {
  timeline.setGeography(packet);
  inspector.setVerseContext(latestTokens, packet);
  refreshPassageContextChips(appState.getPassage());
});
const reader = createVerseReader({
  context: timeline.element,
  preview,
  wordPreview,
  onWord: selectWord,
  onPlace: key => contextTools.openPlace(key, geography.getCurrentPacket()),
  onTokenNotes: pos => notesState.setSelectedTokenPosition(pos),
  onNavigate: navigate,
  onPinCompare: (p) => {
    const pins = explorationState.getSnapshot().pins;
    if (!pins.a) {
      explorationState.pinPassage('a', p);
      void comparison.open(p, pins.b?.passage ?? p);
    } else if (pins.a.passage.book === p.book && pins.a.passage.chapter === p.chapter && pins.a.passage.verse === p.verse) {
      void comparison.open(pins.a.passage, pins.b?.passage ?? p);
    } else {
      explorationState.pinPassage('b', p);
      void comparison.open(pins.a.passage, p);
    }
  },
  onRegisterDrag: dragController.registerHandle,
});

const notesPanel = createNotesPanel({
  onAdd: verseId => noteEditor.openNew({ passage: appState.getPassage(), verseId }),
  onEdit: note => noteEditor.openEdit(note),
  onDelete: async noteId => {
    await BibleRPC.notes.remove(noteId);
    notesPanel.refresh();
  },
  onReview: async (noteId, status) => {
    await BibleRPC.notes.setReview(noteId, status);
    notesPanel.refresh();
    notesBrowser.refresh();
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

// === @section:ui:notes-browser ===
const notesBrowser = createNotesBrowser({
  onNavigatePassage: navigate,
  onInspectWord: id => selectWord(id),
  onEditNote: note => noteEditor.openEdit(note),
  onDeleteNote: async id => {
    await BibleRPC.notes.remove(id);
    notesPanel.refresh();
  },
  onReviewNote: async (id, status) => {
    await BibleRPC.notes.setReview(id, status);
    notesPanel.refresh();
    notesBrowser.refresh();
  },
});

function setTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  trailHeader.setThemeLabel(theme);
}

const trailHeader = createResearchTrailHeader({
  onCompare: () => {
    comparison.openWithPins();
  },
  onToggleGraph: () => {
    discoveryGraph.expand();
    if (!discoveryGraph.isOpen()) {
      const p = appState.getPassage();
      discoveryGraph.openForAnchor(formatVerseRef(p), p);
    }
    discoveryGraph.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
  onTogglePatterns: () => {
    patternBoard.toggle();
    if (patternBoard.isOpen()) {
      patternBoard.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },
  onOpenMap: () => {
    geography.element.open = true;
    geography.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  onOpenNations: () => contextTools.openNations(),
  onOpenFeasts: () => contextTools.openFeasts(),
  onOpenPeople: () => contextTools.openPerson(),
  onOpenTimeline: () => contextTools.openTimeline(appState.getPassage()),
  onOpenArchitecture: () => contextTools.openArchitecture('tabernacle'),
  onQuickNote: () => {
    const cur = appState.getPassage();
    const sel = selections.get(key(cur));
    const tok = sel?.position != null
      ? latestTokens.find(t => t.word_position === sel.position)
      : undefined;
    quickNoteComposer.open({
      passage: cur,
      word: sel
        ? {
            id: sel.id,
            position: sel.position,
            original: tok?.original_word,
            transliteration: tok?.transliteration,
            strongs: tok?.strongs_nr,
            english: sel.english,
          }
        : null,
    });
  },
  onAllNotes: () => {
    if (notesBrowser.isOpen()) notesBrowser.close(); else notesBrowser.open();
  },
  onToggleInspector: () => {
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    if (isMobile) {
      const nextOpen = inspector.element.dataset.open !== 'true';
      inspector.element.dataset.open = String(nextOpen);
      setInspectorOpen(nextOpen);
      return;
    }
    setInspectorOpen(!inspectorOpen);
  },
  onToggleTheme: () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try { localStorage.setItem('bible-reading-theme', theme); } catch { /* Reading works without storage. */ }
  },
});
updateHeaderInspectorState = open => trailHeader.setInspectorOpen(open);
setInspectorOpen(inspectorOpen);

const splitPaneResizer = createSplitPaneResizer(splitContainer);

app.querySelector('#trail-header-slot')!.append(trailHeader.element);
app.querySelector('#resizer-slot')!.append(splitPaneResizer.element);
for (const [selector, element] of [
  ['#navigation', nav.element],
  ['#reader', reader.element],
  ['#discovery-graph-slot', discoveryGraph.element],
  ['#pattern-board-slot', patternBoard.element],
  ['#cross-references', passageXrefs.element],
  ['#notes', notesPanel.element],
  ['#inspector', inspector.element],
  ['#comparison', comparison.element],
  ['#geography', geography.element],
  ['#research-graph', researchGraphPanel.element],
  ['#chronology', chronology.element],
  ['#research-prompts', research.element],
  ['#study-search', search.element],
] as const) app.querySelector(selector)!.append(element);
app.querySelector('#notes-browser-slot')!.append(notesBrowser.returnBar, notesBrowser.element);
app.append(inspectorReopenFab, modal.element, preview.element, wordPreview.element, quickNoteComposer.element, noteEditor.element, claimComposer.element);

let overview: Awaited<ReturnType<typeof BibleRPC.getReaderOverview>>['data'] = null;
const previous = app.querySelector<HTMLButtonElement>('#previous-passage')!, next = app.querySelector<HTMLButtonElement>('#next-passage')!;
previous.addEventListener('click', () => { if (overview?.previous) navigate(overview.previous); });
next.addEventListener('click', () => { if (overview?.next) navigate(overview.next); });

try { setTheme(localStorage.getItem('bible-reading-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch { setTheme('dark'); }

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
let latestTokens: Awaited<ReturnType<typeof BibleRPC.getVerseTranslations>>['data'] = [];
function selectWord(
  id: number,
  position?: number,
  english?: string,
  rendering?: string,
  suggested = false,
  skipTrailRecord = false,
) {
  if (!suggested) setInspectorOpen(true);
  const curPassage = appState.getPassage();
  const selection = { id, position, english, rendering }; selections.set(key(curPassage), selection);
  reader.selectPosition(position ?? null); void inspector.inspect(id, { position, english, rendering, suggested });
  if (skipTrailRecord) return;
  const tok = latestTokens.find(t => t.word_id === id && (position === undefined || t.word_position === position));
  explorationState.recordWordFocus(curPassage, {
    id,
    position,
    english,
    original: tok?.original_word,
    transliteration: tok?.transliteration,
    strongs: tok?.strongs_nr,
  }, !suggested);
}

explorationState.onRestoreStep((step, info) => {
  if (info.passageChanged) return;
  const restoredWord = step.selectedWord ?? (step.anchor.wordId && step.anchor.wordId > 0
    ? { id: step.anchor.wordId, position: step.anchor.position, english: step.anchor.english }
    : null);
  if (restoredWord && restoredWord.id > 0) {
    selectWord(restoredWord.id, restoredWord.position, restoredWord.english, undefined, step.anchor.kind === 'verse', true);
  } else {
    reader.selectPosition(null);
    inspector.reset();
  }
});

// === @section:logic:passage ===
let request = 0;
appState.subscribe(p => {
  const current = ++request;
  modal.close(); preview.dismiss(); wordPreview.dismiss(); inspector.reset(); comparison.close(); timeline.reset();
  overview = null; previous.disabled = true; next.disabled = true;
  explorationState.recordPassage(p);
  nav.update(p); research.updatePassage(p); reader.setOverview(null); inspector.setOverview(null); reader.selectPosition(null);
  reader.setEnglish(null, 'Loading English verse…');
  reader.setNoteCounts([]);
  notesState.setSelectedTokenPosition(null);
  passageXrefs.setPassage(p);
  notesPanel.setPassage(p);
  const sample = BibleRPC.getSampleTranslations(p);
  latestTokens = sample;
  inspector.setVerseContext(sample, null);
  reader.render(p, { data: sample, source: sample.length ? 'sample' : 'unavailable', error: null }, !sample.length);
  void geography.load(p); void chronology.load(p); void timeline.load(p, timelineModel);
  const englishReq = BibleRPC.getReaderPassage(p).then(result => {
    if (current === request) reader.setEnglish(result.data, result.error);
  });
  const words = BibleRPC.getVerseTranslations(p).then(result => {
    if (current === request) {
      latestTokens = result.data;
      inspector.setVerseContext(latestTokens, geography.getCurrentPacket());
      reader.render(p, result);
      refreshPassageContextChips(p);
    }
    return result;
  });
  const context = BibleRPC.getReaderOverview(p).then(result => {
    if (current !== request) return;
    overview = result.data; reader.setOverview(overview); inspector.setOverview(overview);
    previous.disabled = !overview?.previous; next.disabled = !overview?.next;
  });
  void Promise.all([englishReq, words, context]).then(([, result]) => {
    if (current !== request) return;
    discoveryGraph.openForAnchor(formatVerseRef(p), p);
    if (result.source !== 'live') return;
    const currentStep = explorationState.getCurrentStep();
    const stepSnapshot = currentStep.selectedWord ?? (currentStep.anchor.wordId && currentStep.anchor.wordId > 0
      ? { id: currentStep.anchor.wordId, position: currentStep.anchor.position, english: currentStep.anchor.english }
      : null);
    if (stepSnapshot && stepSnapshot.id > 0) {
      selectWord(stepSnapshot.id, stepSnapshot.position, stepSnapshot.english, undefined, currentStep.anchor.kind === 'verse', true);
      return;
    }
    const remembered = selections.get(key(p));
    if (remembered) { selectWord(remembered.id, remembered.position, remembered.english, remembered.rendering, true); return; }
    const token = result.data.find(t => /N|V/.test(t.grammar_code ?? '')) ?? result.data[0];
    if (token) selectWord(token.word_id, token.word_position, token.selected_english ?? token.source_english ?? '', undefined, true);
  });
});

void Promise.all([loadFullPeopleGraph(), loadBiblePlacesIndex(), loadVersePersonIndex()]).then(() => {
  refreshPassageContextChips(appState.getPassage());
});
