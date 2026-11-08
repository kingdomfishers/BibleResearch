import esbuild from 'esbuild';
import { resolve } from 'node:path';
import { mockRpcState } from './mock-notes-rpc.mjs';

console.log('=== NOTE-22: Word Inspector Integration Test ===\n');

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this._textContent = '';
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = {};
    this.value = '';
    this.type = '';
    this.open = false;
    this.title = '';
    this.hidden = false;
  }

  get id() {
    return this.attributes.id || '';
  }
  set id(v) {
    this.attributes.id = String(v);
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._textContent = String(v);
    this.children = [];
  }

  get innerHTML() {
    return this.children.map((c) => `<${c.tagName.toLowerCase()}>${c.textContent}</${c.tagName.toLowerCase()}>`).join('');
  }
  set innerHTML(html) {
    this.children = [];
    this._textContent = '';
  }

  appendChild(child) {
    if (child) this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const textNode = new MockElement('#text');
        textNode.textContent = node;
        this.children.push(textNode);
      } else if (node) {
        this.children.push(node);
      }
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(event, handler) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(handler);
  }

  dispatchEvent(event) {
    const handlers = this.eventListeners[event.type || event] || [];
    for (const h of handlers) h(event);
    return true;
  }

  click() {
    if (this.onclick) this.onclick({ stopPropagation() {}, preventDefault() {} });
    this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const match = (el) => {
      let matches = true;
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (!el.className.split(/\s+/).includes(cls)) matches = false;
      } else if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (el.id !== id) matches = false;
      } else if (/^[a-z]+$/i.test(selector)) {
        if (el.tagName !== selector.toUpperCase()) matches = false;
      }
      if (matches && el !== this) results.push(el);
      for (const child of el.children) match(child);
    };
    match(this);
    return results;
  }

  get classList() {
    return {
      add: (...classes) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.forEach((c) => set.add(c));
        this.className = Array.from(set).join(' ');
      },
      remove: (...classes) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.forEach((c) => set.delete(c));
        this.className = Array.from(set).join(' ');
      },
      contains: (c) => this.className.split(/\s+/).includes(c),
      toggle: (c, force) => {
        const has = this.className.split(/\s+/).includes(c);
        const shouldAdd = force !== undefined ? force : !has;
        if (shouldAdd) this.classList.add(c);
        else this.classList.remove(c);
        return shouldAdd;
      },
    };
  }
}

globalThis.document = {
  createElement: (tag) => new MockElement(tag),
  createElementNS: (_ns, tag) => new MockElement(tag),
  createTextNode: (text) => {
    const el = new MockElement('#text');
    el.textContent = text;
    return el;
  },
  createDocumentFragment: () => new MockElement('#fragment'),
};
globalThis.window = {
  location: { hash: '' },
  confirm: () => true,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const bundle = await esbuild.build({
  entryPoints: [resolve('src/ui/components/WordNotes.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'mock-rpc',
      setup(build) {
        build.onResolve({ filter: /rpc$/ }, () => ({
          path: resolve('scripts/mock-notes-rpc.mjs'),
        }));
      },
    },
  ],
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`;
const { createWordNotes } = await import(moduleUrl);

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// Prepare fixture note
const adamDamNote = {
  id: '11c1dde6-9e70-4537-9090-e3e09e1fb778',
  title: 'Adam/Dam Connection',
  note_kind: 'linguistic',
  body_md: 'Wordplay connection: **דַּ֣ם** (blood) is contained in **הָֽאָדָ֔ם** (man) in Genesis 9:6.',
  author: { id: '00000000-0000-0000-0000-00000000a001', kind: 'human', display_name: 'You' },
  anchors: [
    { id: 'anc_verse_212', kind: 'verse', verse_id: 212, label: 'Genesis 9:6' },
    { id: 'anc_dam', kind: 'word_occurrence', word_id: 53694, verse_id: 212, word_position: 2, label: 'דַּ֣ם · H1818' },
    { id: 'anc_adam', kind: 'word_occurrence', word_id: 28013, verse_id: 212, word_position: 3, label: 'הָֽאָדָ֔ם · H120' },
    { id: 'anc_lemma_dam', kind: 'lemma', lemma_id: 7230, label: 'דָּם · H1818' },
  ],
  connections: [
    {
      id: 'conn_1',
      from_anchor_id: 'anc_dam',
      to_anchor_id: 'anc_adam',
      connection_type: 'contained_in',
      type_label: 'is contained in',
      direction: 'directed',
    },
  ],
};

// Setup mock RPC responses
mockRpcState.getForWordHandler = async (wordId, verseId, position) => {
    // If inspecting dam in Gen 9:6 at position 2
    if (wordId === 53694 && verseId === 212 && position === 2) {
      return {
        source: 'live',
        data: {
          status: 'ok',
          groups: { occurrence: [adamDamNote], form: [], lemma: [] },
          totals: { occurrence: 1, form: 0, lemma: 0, human: 1, ai: 0, total: 1 },
          lemmas: [{ lemma_id: 7230, lemma_key: 'lemma:H1818' }],
        },
      };
    }
    // If inspecting adam in Gen 9:6 at position 3
    if (wordId === 28013 && verseId === 212 && position === 3) {
      return {
        source: 'live',
        data: {
          status: 'ok',
          groups: { occurrence: [adamDamNote], form: [], lemma: [] },
          totals: { occurrence: 1, form: 0, lemma: 0, human: 1, ai: 0, total: 1 },
          lemmas: [{ lemma_id: 164, lemma_key: 'lemma:H0120G' }],
        },
      };
    }
    // If inspecting dam in another verse (e.g. verse_id: 90)
    if (wordId === 53694 && verseId === 90) {
      return {
        source: 'live',
        data: {
          status: 'ok',
          groups: { occurrence: [], form: [], lemma: [adamDamNote] },
          totals: { occurrence: 0, form: 0, lemma: 1, human: 1, ai: 0, total: 1 },
          lemmas: [{ lemma_id: 7230, lemma_key: 'lemma:H1818' }],
        },
      };
    }
    // Fallback: empty notes
    return {
      source: 'live',
      data: {
        status: 'ok',
        groups: { occurrence: [], form: [], lemma: [] },
        totals: { occurrence: 0, form: 0, lemma: 0, human: 0, ai: 0, total: 0 },
        lemmas: [],
      },
    };
  };

console.log('--- Test Suite 1: Component Initialization and Empty State ---');
let inspectedWordTarget = null;
const comp = createWordNotes({
  onInspectWord: (targetId) => {
    inspectedWordTarget = targetId;
  },
});
assert(comp.element instanceof MockElement, 'WordNotes root element created');
assert(comp.element.className.includes('word-notes'), 'WordNotes root has .word-notes class');
const statusP = comp.element.querySelector('.word-notes__status');
assert(statusP && statusP.textContent.includes('Select a word'), 'Initial state prompts user to select a word');

console.log('\n--- Test Suite 2: Inspect דַּם in Gen 9:6 (Occurrence Match) ---');
await comp.setWord(53694, 212, 2);
const groups = comp.element.querySelectorAll('.word-notes__group');
assert(groups.length === 3, 'Renders 3 group details elements');

const occGroup = groups[0];
assert(occGroup.open === true, 'Occurrence group is open when it contains notes');
const occBadge = occGroup.querySelector('.word-notes__badge');
assert(occBadge?.textContent === '1', 'Occurrence group badge displays 1 note');

const formGroup = groups[1];
assert(formGroup.open === false, 'Word form group is collapsed when empty');

const lemmaGroup = groups[2];
assert(lemmaGroup.open === false, 'Lemma group is collapsed when empty');

console.log('\n--- Test Suite 3: Connection Highlighting and Bidirectional Target ---');
const chip = occGroup.querySelector('.note-connection-chip');
assert(chip !== null, 'Connection chip is rendered inside occurrence note card');

const endpoints = chip.querySelectorAll('.note-connection-chip__endpoint');
assert(endpoints.length === 2, 'Connection chip has source and target endpoints');

const fromBtn = endpoints[0];
const toBtn = endpoints[1];
assert(fromBtn.classList.contains('is-inspected'), 'Source endpoint (דַּם) is highlighted with .is-inspected');
assert(fromBtn.getAttribute('aria-current') === 'true', 'Source endpoint has aria-current="true"');
assert(!toBtn.classList.contains('is-inspected'), 'Target endpoint (הָֽאָדָ֔ם) is not marked as inspected');

inspectedWordTarget = null;
toBtn.click();
assert(inspectedWordTarget === 28013, 'Clicking target endpoint triggers onInspectWord with target word ID 28013 (Adam)');

console.log('\n--- Test Suite 4: Reverse Inspection from הָֽאָדָ֔ם ---');
await comp.setWord(28013, 212, 3);
const revChip = comp.element.querySelector('.note-connection-chip');
const revEndpoints = revChip.querySelectorAll('.note-connection-chip__endpoint');
const revFromBtn = revEndpoints[0];
const revToBtn = revEndpoints[1];
assert(revToBtn.classList.contains('is-inspected'), 'Target endpoint (הָֽאָדָ֔ם) is highlighted with .is-inspected when inspected');
assert(!revFromBtn.classList.contains('is-inspected'), 'Source endpoint (דַּם) is not marked as inspected');

inspectedWordTarget = null;
revFromBtn.click();
assert(inspectedWordTarget === 53694, 'Clicking source endpoint triggers onInspectWord with source word ID 53694 (Dam)');

console.log('\n--- Test Suite 5: Inspect Same Lemma in Another Verse (Gen 4:10) ---');
await comp.setWord(53694, 90, 1);
const otherGroups = comp.element.querySelectorAll('.word-notes__group');
const otherOccGroup = otherGroups[0];
assert(otherOccGroup.open === false, 'Occurrence group is collapsed in another verse');
assert(otherOccGroup.querySelector('.word-notes__badge')?.textContent === '0', 'Occurrence badge is 0');

const otherLemmaGroup = otherGroups[2];
assert(otherLemmaGroup.open === true, 'Lemma group is open in another verse');
assert(otherLemmaGroup.querySelector('.word-notes__badge')?.textContent === '1', 'Lemma badge is 1');
assert(otherLemmaGroup.querySelector('.note-card') !== null, 'Lemma group contains the note card');

console.log('\n--- Test Suite 6: Rapid Word Switching (TP-RACE-1 Protection) ---');
let slowResolved = false;
let fastResolved = false;
mockRpcState.getForWordHandler = async (wordId) => {
  if (wordId === 999) {
    await new Promise((r) => setTimeout(r, 80));
    slowResolved = true;
    return {
      source: 'live',
      data: {
        status: 'ok',
        groups: { occurrence: [{ ...adamDamNote, id: 'stale-slow-note' }], form: [], lemma: [] },
        totals: { occurrence: 1, form: 0, lemma: 0, human: 1, ai: 0, total: 1 },
        lemmas: [],
      },
    };
  }
  await new Promise((r) => setTimeout(r, 10));
  fastResolved = true;
  return {
    source: 'live',
    data: {
      status: 'ok',
      groups: { occurrence: [{ ...adamDamNote, id: 'fast-note' }], form: [], lemma: [] },
      totals: { occurrence: 1, form: 0, lemma: 0, human: 1, ai: 0, total: 1 },
      lemmas: [],
    },
  };
};

const p1 = comp.setWord(999, 1, 1);
const p2 = comp.setWord(888, 1, 1);
await Promise.all([p1, p2]);

assert(slowResolved && fastResolved, 'Both mock calls completed');
const finalCard = comp.element.querySelector('.note-card');
assert(finalCard && finalCard.id === 'note-fast-note', 'Rapid switching: late-resolving superseded word is discarded (TP-RACE-1)');

console.log('\n--- Test Suite 7: Clear Selection ---');
comp.clear();
const clearedStatus = comp.element.querySelector('.word-notes__status');
assert(clearedStatus && !clearedStatus.hidden, 'Status message shown after clear');
assert(comp.element.querySelector('.note-card') === null, 'All note cards removed on clear');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
