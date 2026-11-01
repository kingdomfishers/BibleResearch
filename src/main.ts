// @file: src/main.ts
// @feature: app-shell
// @tables: words | verses | verse_translation_sources | word_translation_choices | chronology_models | chronology_runs | chronology_assertions | chronology_evidence | places | place_locations | verse_geography | passage_geography | geography_sources
// @candidates: none
// @toc: imports | ui:main | logic:passage

// === @section:imports ===
import './ui/styles.css';
import { BibleRPC } from './api/rpc';
import { appState } from './ui/state';
import { createNavSelector } from './ui/components/NavSelector';
import { createVerseReader } from './ui/components/VerseReader';
import { createWordModal } from './ui/components/WordModal';
import { createVerseMap } from './ui/components/VerseMap';
import { createChronologyPanel } from './ui/components/ChronologyPanel';
import { createResearchPanel } from './ui/components/ResearchPanel';

// === @section:ui:main ===
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<header class="site-header"><a class="brand" href="#1-1-1" aria-label="Bible Research home">
  <span class="brand-mark" aria-hidden="true">א</span><span>BIBLE<span class="brand-sub">RESEARCH</span></span></a>
  <span class="header-note">A closer reading of Scripture</span><span class="language-pill">HEBREW <span> / </span> GREEK</span></header>
  <main><section class="intro"><p class="eyebrow"><span class="gold-line"></span> THE ORIGINAL LANGUAGE EXPLORER</p>
  <h1>Scripture, <em>word by word.</em></h1><p>Read the original. Follow a word. Discover its meaning.</p></section>
  <div id="navigation"></div><div class="workspace-heading"><span class="eyebrow">INTERLINEAR READER</span>
  <span class="click-hint">Original: inspect · English: choose translation <span aria-hidden="true">↗</span></span></div>
  <div id="reader"></div><div id="geography"></div><div id="chronology"></div><div id="research-prompts"></div><aside class="sample-strip" aria-label="Available sample passages"><div><span class="status-dot"></span>
  <strong>Start with a sample</strong><span class="sample-description">Ready to explore, even before the database is populated.</span></div>
  <div class="sample-links"><a href="#1-1-1">Genesis 1:1 <span>א</span></a><a href="#43-1-1">John 1:1 <span>α</span></a></div></aside>
  <section class="study-guide" aria-label="How to study"><article><span>01</span><h3>Choose a passage</h3><p>Navigate the 66 books with the book, chapter, and verse selectors.</p></article>
  <article><span>02</span><h3>Read the original</h3><p>Hebrew reads right to left; Greek reads left to right. Transliteration follows each word.</p></article>
  <article><span>03</span><h3>Look a little closer</h3><p>Open a word to see its grammar, definitions, and connections.</p></article></section>
  <footer class="site-footer"><span>BIBLE RESEARCH</span><span>Ancient words. A closer understanding.</span></footer></main>`;
const nav = createNavSelector(p => appState.setPassage(p));
const geography = createVerseMap();
const chronology = createChronologyPanel(summary => nav.updateChronology(summary));
const modal = createWordModal(p => appState.setPassage(p));
const reader = createVerseReader(id => { void modal.openWordModal(id); });
const research = createResearchPanel({
  onSelectPassage: p => appState.setPassage(p),
  onInspectWord: id => { void modal.openWordModal(id); },
});
app.append(modal.element);
app.querySelector('#navigation')!.append(nav.element);
app.querySelector('#reader')!.append(reader.element);
app.querySelector('#geography')!.append(geography.element);
app.querySelector('#chronology')!.append(chronology.element);
app.querySelector('#research-prompts')!.append(research.element);

// === @section:logic:passage ===
let request = 0;
appState.subscribe(async p => {
  const current = ++request;
  modal.close();
  nav.update(p);
  research.updatePassage(p);
  void geography.load(p);
  void chronology.load(p);
  const sample = BibleRPC.getSampleTranslations(p);
  reader.render(p, { data: sample, source: sample.length ? 'sample' : 'unavailable', error: null }, !sample.length);
  const result = await BibleRPC.getVerseTranslations(p);
  if (current !== request) return;
  reader.render(p, result);
});
