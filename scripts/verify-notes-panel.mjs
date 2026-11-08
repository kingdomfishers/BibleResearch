import esbuild from 'esbuild';
import { resolve } from 'node:path';
import { mockRpcState, BibleRPC } from './mock-notes-rpc.mjs';

console.log('=== NOTE-20: NotesPanel Tiers & Filters Verification ===\n');

// 1. Setup DOM Stubs before importing bundled code
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
    this.selected = false;
    this.open = false;
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
    if (!html) return;
    // Simple parser for basic templates used in NotesPanel
    if (html.includes('<button') && html.includes('id="notes-retry-btn"')) {
      const errDiv = new MockElement('div');
      errDiv.className = 'notes-panel__error';
      const errP = new MockElement('p');
      const match = html.match(/<p>(.*?)<\/p>/s);
      if (match) errP.textContent = match[1];
      const retryBtn = new MockElement('button');
      retryBtn.attributes.id = 'notes-retry-btn';
      retryBtn.attributes.type = 'button';
      retryBtn.className = 'study-button';
      retryBtn.textContent = 'Retry';
      errDiv.children.push(errP, retryBtn);
      this.children.push(errDiv);
    } else if (html.includes('id="notes-counts"')) {
      const titleWrap = new MockElement('div');
      titleWrap.className = 'notes-panel__title-wrap';
      const h2 = new MockElement('h2');
      h2.className = 'notes-panel__title';
      h2.textContent = 'Notes';
      const countsSpan = new MockElement('span');
      countsSpan.className = 'notes-panel__counts';
      countsSpan.attributes.id = 'notes-counts';
      titleWrap.children.push(h2, countsSpan);
      this.children.push(titleWrap);
    } else if (html.includes('notes-panel__loading')) {
      const loadDiv = new MockElement('div');
      loadDiv.className = 'notes-panel__loading';
      loadDiv.textContent = 'Loading notes...';
      this.children.push(loadDiv);
    }
  }

  get id() {
    return this.attributes.id || '';
  }
  set id(v) {
    this.attributes.id = String(v);
  }

  replaceChildren(...newChildren) {
    this.children = [];
    for (const c of newChildren) {
      this.appendChild(c);
    }
  }

  get classList() {
    const el = this;
    return {
      add(cls) {
        const classes = new Set(el.className.split(' ').filter(Boolean));
        classes.add(cls);
        el.className = Array.from(classes).join(' ');
      },
      remove(cls) {
        const classes = new Set(el.className.split(' ').filter(Boolean));
        classes.delete(cls);
        el.className = Array.from(classes).join(' ');
      },
      contains(cls) {
        return el.className.split(' ').includes(cls);
      },
      toggle(cls, force) {
        const has = el.classList.contains(cls);
        const shouldHave = force !== undefined ? Boolean(force) : !has;
        if (shouldHave) {
          el.classList.add(cls);
        } else {
          el.classList.remove(cls);
        }
        return shouldHave;
      },
    };
  }

  appendChild(child) {
    if (child && child.tagName === '#DOCUMENT-FRAGMENT') {
      this.children.push(...child.children);
      return child;
    }
    this.children.push(child);
    return child;
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    if (k in this.attributes) return this.attributes[k];
    if (k in this) return this[k];
    return null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  click() {
    if (this.eventListeners.click) {
      for (const listener of this.eventListeners.click) {
        listener({ target: this, preventDefault: () => {} });
      }
    }
  }

  dispatchEvent(event) {
    if (this.eventListeners[event.type]) {
      for (const listener of this.eventListeners[event.type]) {
        listener(event);
      }
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    if (parts.length === 1) {
      const part = parts[0];
      const results = [];
      const match = (el) => {
        let matched = false;
        if (part.startsWith('#')) {
          if (el.attributes.id === part.slice(1)) matched = true;
        } else if (part.startsWith('.')) {
          if (el.classList.contains(part.slice(1))) matched = true;
        } else if (part.toUpperCase() === el.tagName) {
          matched = true;
        }
        if (matched) results.push(el);
        for (const child of el.children) match(child);
      };
      for (const child of this.children) match(child);
      return results;
    }
    let current = [this];
    for (const part of parts) {
      const next = [];
      for (const node of current) {
        next.push(...node.querySelectorAll(part));
      }
      current = next;
    }
    return current;
  }
}

globalThis.document = {
  createElement: (tag) => new MockElement(tag),
  createElementNS: (_ns, tag) => new MockElement(tag),
  createTextNode: (text) => {
    const el = new MockElement('#TEXT');
    el.textContent = text;
    return el;
  },
  createDocumentFragment: () => new MockElement('#document-fragment'),
};

globalThis.window = {
  location: { hash: '' },
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.localStorage = globalThis.window.localStorage;

// 2. Bundle NotesPanel.ts with mock-notes-rpc
const bundlePath = resolve('dist/notes-panel-bundle.js');
await esbuild.build({
  entryPoints: ['src/ui/components/NotesPanel.ts'],
  bundle: true,
  format: 'esm',
  outfile: bundlePath,
  platform: 'neutral',
  target: 'es2022',
  plugins: [
    {
      name: 'mock-rpc',
      setup(build) {
        build.onResolve({ filter: /\/rpc$/ }, () => ({
          path: resolve('scripts/mock-notes-rpc.mjs'),
        }));
      },
    },
  ],
});

const {
  createNotesPanel,
  NotesDataLoader,
  filterNotes,
  renderTiers,
  createFilterBar,
  createNotesPanelHeader,
} = await import(`file://${bundlePath}`);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// 3. Tests
console.log('Test Group 1: NotesDataLoader basic and connection types');
{
  const loader = new NotesDataLoader();
  const types = await loader.loadConnectionTypes();
  assert(types !== null, 'loadConnectionTypes returns types data');
  assert(types.note_kinds.length === 3, 'Returns 3 note kinds');
  assert(types.connection_types.length === 2, 'Returns 2 connection types');
}

console.log('\nTest Group 2: filterNotes logic');
{
  const testNotes = [
    {
      id: 'n1',
      author: { kind: 'human', user_id: 'u1' },
      note_kind: 'study',
      connections: [{ connection_type: 'cross_reference' }],
    },
    {
      id: 'n2',
      author: { kind: 'ai', agent_id: 'a1' },
      note_kind: 'translation_note',
      connections: [{ connection_type: 'thematic' }],
    },
    {
      id: 'n3',
      author: { kind: 'ai', agent_id: 'a2' },
      note_kind: 'study',
      connections: [],
    },
  ];

  // Test 2.1: Default filters (All)
  const allRes = filterNotes(testNotes);
  assert(allRes.list.length === 3, 'Default filter keeps all notes');
  assert(allRes.hiddenAi === 0, '0 AI notes hidden under "all"');
}

console.log('\nTest Group 3: createNotesPanel construction & initial state');
{
  let addClicked = false;
  let tokenCountsReceived = null;
  const panel = createNotesPanel({
    onAdd: () => { addClicked = true; },
    onTokenCounts: (counts) => { tokenCountsReceived = counts; },
  });

  assert(panel.element !== null, 'NotesPanel element created');
  assert(panel.element.getAttribute('aria-label') === 'Notes and Connections', 'Has aria-label');
  assert(panel.element.classList.contains('notes-panel'), 'Has .notes-panel class');

  const addBtn = panel.element.querySelector('.notes-panel__header button');
  assert(addBtn !== null, '+ Add note button exists in header');
  addBtn.click();
  assert(addClicked === true, '+ Add note button click triggers onAdd callback');
}

console.log('\nTest Group 4: Passage load, header counts, primary & secondary tiers');
{
  const mockPassageNotes = {
    primary: [
      {
        id: 'p1',
        author: { kind: 'human', user_id: 'u1', display_name: 'You' },
        note_kind: 'study',
        body_md: 'Primary note 1 text',
        anchors: [{ anchor_type: 'verse', passage_ref: 'Gen 1:1' }],
        connections: [],
        review_status: 'accepted',
      },
    ],
    secondary: [
      {
        id: 's1',
        author: { kind: 'ai', agent_id: 'a1', display_name: 'Claude' },
        note_kind: 'translation_note',
        body_md: 'Secondary note on word',
        anchors: [{ anchor_type: 'word_occurrence', passage_ref: 'Gen 1:1', word_position: 2 }],
        connections: [],
        review_status: 'unreviewed',
      },
    ],
    totals: { total: 2, human: 1, ai: 1 },
    truncated: { primary: false, secondary: false },
    token_note_counts: [{ word_position: 2, human: 0, ai: 1 }],
  };

  mockRpcState.getForPassageHandler = async () => ({
    data: mockPassageNotes,
    error: null,
    source: 'database',
  });

  let tokenCounts = null;
  const panel = createNotesPanel({
    onTokenCounts: (counts) => { tokenCounts = counts; },
  });

  panel.setPassage({ book: 1, chapter: 1, verse: 1 });
  // Wait microtasks for async handler
  await new Promise((r) => setTimeout(r, 10));

  const countsEl = panel.element.querySelector('#notes-counts');
  assert(countsEl !== null, 'notes-counts element found');
  assert(countsEl.textContent === '(2 · 1 You · 1 AI)', `Header counts display expected: ${countsEl.textContent}`);

  const primaryWrap = panel.element.querySelector('.notes-panel__primary-list');
  if (!primaryWrap) {
    console.log('DEBUG error message:', panel.element.querySelector('.notes-panel__content p')?.textContent);
  }
  assert(primaryWrap !== null, 'Primary list wrapper exists');
  assert(primaryWrap.children.length === 1, `Primary list rendered 1 note (actual: ${primaryWrap.children.length})`);

  const detailsEl = panel.element.querySelector('.notes-panel__secondary-details');
  assert(detailsEl !== null, 'Secondary details element exists');
  assert(detailsEl.open === false, 'Secondary details is collapsed by default');

  const summary = detailsEl.children.find((c) => c.tagName === 'SUMMARY');
  assert(summary !== null, 'Summary element in details exists');
  assert(summary.textContent.includes('Also tagged on words in this verse (1)'), `Summary text correct: ${summary.textContent}`);

  assert(tokenCounts !== null, 'onTokenCounts invoked with token counts');
  assert(tokenCounts[0].word_position === 2, 'Token count for position 2 passed');
}

console.log('\nTest Group 5: Empty state and Error state');
{
  // Test 5.1: Empty state
  mockRpcState.getForPassageHandler = async () => ({
    data: {
      primary: [],
      secondary: [],
      totals: { total: 0, human: 0, ai: 0 },
      truncated: { primary: false, secondary: false },
      token_note_counts: [],
    },
    error: null,
    source: 'database',
  });

  let emptyAddClicked = false;
  const emptyPanel = createNotesPanel({
    onAdd: () => { emptyAddClicked = true; },
  });
  emptyPanel.setPassage({ book: 1, chapter: 1, verse: 1 });
  await new Promise((r) => setTimeout(r, 10));

  const emptyEl = emptyPanel.element.querySelector('.notes-panel__empty');
  assert(emptyEl !== null, 'Empty state element rendered');
  assert(emptyEl.textContent.includes('No notes for this passage yet.'), 'Empty state text correct');
  const addBtn = emptyEl.querySelector('button');
  assert(addBtn !== null, 'Add note button rendered in empty state');
  addBtn.click();
  assert(emptyAddClicked === true, 'Empty state Add note button triggers onAdd');

  // Test 5.2: Error state & Retry button
  let retryTriggered = false;
  let callCount = 0;
  mockRpcState.getForPassageHandler = async () => {
    callCount++;
    if (callCount === 1) {
      return {
        data: null,
        error: 'Network timeout connecting to Supabase',
        source: 'unavailable',
      };
    }
    retryTriggered = true;
    return {
      data: {
        primary: [],
        secondary: [],
        totals: { total: 0, human: 0, ai: 0 },
        truncated: { primary: false, secondary: false },
      },
      error: null,
      source: 'database',
    };
  };

  const errPanel = createNotesPanel();
  errPanel.setPassage({ book: 1, chapter: 1, verse: 2 });
  await new Promise((r) => setTimeout(r, 10));

  const errEl = errPanel.element.querySelector('.notes-panel__error');
  assert(errEl !== null, 'Error state rendered on unavailable source');
  assert(errEl.textContent.includes('Network timeout'), 'Error message displayed');
  const retryBtn = errPanel.element.querySelector('#notes-retry-btn');
  assert(retryBtn !== null, 'Retry button rendered');
  retryBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert(retryTriggered === true, 'Retry button click re-fetches notes');
}

console.log('\nTest Group 6: TP-RACE-1 Stale response & AbortController protection');
{
  mockRpcState.abortedRequests = [];
  let resolveReqA = null;
  let resolveReqB = null;

  mockRpcState.getForPassageHandler = async (passage) => {
    if (passage.verse === 10) {
      return new Promise((resolve) => {
        resolveReqA = () => resolve({
          data: {
            primary: [{
              id: 'stale-a',
              author: { kind: 'human', user_id: 'u1' },
              note_kind: 'study',
              body_md: 'Old verse 10 note',
              anchors: [],
              connections: [],
            }],
            secondary: [],
            totals: { total: 1, human: 1, ai: 0 },
            truncated: { primary: false, secondary: false },
          },
          error: null,
          source: 'database',
        });
      });
    } else if (passage.verse === 20) {
      return new Promise((resolve) => {
        resolveReqB = () => resolve({
          data: {
            primary: [{
              id: 'fresh-b',
              author: { kind: 'human', user_id: 'u1' },
              note_kind: 'study',
              body_md: 'Target verse 20 note',
              anchors: [],
              connections: [],
            }],
            secondary: [],
            totals: { total: 1, human: 1, ai: 0 },
            truncated: { primary: false, secondary: false },
          },
          error: null,
          source: 'database',
        });
      });
    }
  };

  const racePanel = createNotesPanel();

  // 1. User navigates to verse 10
  racePanel.setPassage({ book: 1, chapter: 1, verse: 10 });
  await new Promise((r) => setTimeout(r, 5));

  // 2. User quickly navigates to verse 20 before req A returns
  racePanel.setPassage({ book: 1, chapter: 1, verse: 20 });
  await new Promise((r) => setTimeout(r, 5));

  assert(mockRpcState.abortedRequests.length === 1, 'Previous request signal received abort event');
  assert(mockRpcState.abortedRequests[0].verse === 10, 'Aborted request was verse 10');

  // 3. Req B resolves first
  resolveReqB();
  await new Promise((r) => setTimeout(r, 10));

  const primaryWrapB = racePanel.element.querySelector('.notes-panel__primary-list');
  assert(primaryWrapB.children.length === 1, 'Primary list shows 1 note for verse 20');
  assert(primaryWrapB.textContent.includes('Target verse 20 note'), 'Shows fresh note from verse 20');

  // 4. Stale Req A resolves late
  resolveReqA();
  await new Promise((r) => setTimeout(r, 10));

  // Assert stale A was discarded and verse 20 note is STILL the one rendered!
  assert(primaryWrapB.textContent.includes('Target verse 20 note'), 'Stale response discarded: still showing verse 20 note');
  assert(!primaryWrapB.textContent.includes('Old verse 10 note'), 'Old verse 10 note was never rendered into DOM');
}

console.log('\nTest Group 7: Truncated notice rendering');
{
  const truncData = {
    primary: [],
    secondary: [],
    totals: { total: 100, human: 50, ai: 50 },
    truncated: { primary: true, secondary: false },
  };

  const container = new MockElement('div');
  renderTiers(truncData, {}, container);
  const truncNotice = container.querySelector('.notes-panel__truncated-hint');
  assert(truncNotice !== null, 'Truncated hint notice is rendered when truncated.primary is true');
  assert(truncNotice.textContent.includes('Note limit reached'), 'Truncated hint message is descriptive');
}

console.log('\nTest Group 8: Filter controls interaction (Author, Kind, Connection)');
{
  const mixedPassageNotes = {
    primary: [
      {
        id: 'n-human-study',
        author: { kind: 'human', user_id: 'u1' },
        note_kind: 'study',
        body_md: 'Human study note',
        anchors: [],
        connections: [{ connection_type: 'cross_reference' }],
      },
      {
        id: 'n-ai-trans',
        author: { kind: 'ai', agent_id: 'a1' },
        note_kind: 'translation_note',
        body_md: 'AI translation note',
        anchors: [],
        connections: [{ connection_type: 'thematic' }],
      },
    ],
    secondary: [],
    totals: { total: 2, human: 1, ai: 1 },
    truncated: { primary: false, secondary: false },
  };

  mockRpcState.getForPassageHandler = async () => ({
    data: mixedPassageNotes,
    error: null,
    source: 'database',
  });

  const filterPanel = createNotesPanel();
  filterPanel.setPassage({ book: 1, chapter: 1, verse: 1 });
  await new Promise((r) => setTimeout(r, 10));

  // 8.1: Test author filter = 'human'
  const filterBtns = filterPanel.element.querySelectorAll('.notes-panel__author-btn');
  const humanBtn = filterBtns.find((b) => b.textContent === 'Human');
  assert(humanBtn !== null, 'Human filter button exists');
  humanBtn.click();
  await new Promise((r) => setTimeout(r, 10));

  let hiddenNotice = filterPanel.element.querySelector('.notes-panel__hidden-ai-notice');
  assert(hiddenNotice !== null, 'Hidden AI notice rendered when author=human');
  assert(hiddenNotice.textContent.includes('1 AI note hidden'), 'Notice text says "1 AI note hidden"');

  const primaryWrapHuman = filterPanel.element.querySelector('.notes-panel__primary-list');
  assert(primaryWrapHuman.textContent.includes('Human study note'), 'Human note is visible');
  assert(!primaryWrapHuman.textContent.includes('AI translation note'), 'AI note is hidden');

  // 8.2: Test author filter = 'all' restores all notes and hides notice
  const allBtn = filterBtns.find((b) => b.textContent === 'All');
  allBtn.click();
  await new Promise((r) => setTimeout(r, 10));

  hiddenNotice = filterPanel.element.querySelector('.notes-panel__hidden-ai-notice');
  assert(hiddenNotice === null, 'Hidden AI notice removed when author=all');
  const primaryWrapAll = filterPanel.element.querySelector('.notes-panel__primary-list');
  assert(primaryWrapAll.textContent.includes('Human study note') && primaryWrapAll.textContent.includes('AI translation note'), 'Both notes visible under all');
}

console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
