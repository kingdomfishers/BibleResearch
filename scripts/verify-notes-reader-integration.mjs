import esbuild from 'esbuild';
import { resolve } from 'node:path';
import { mockRpcState } from './mock-notes-rpc.mjs';

console.log('=== NOTE-21: Reader Integration (Verse Notes & Token Badges) Test ===\n');

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
    if (!html) return;
    if (html.includes('class="word-grid"')) {
      const heading = new MockElement('div');
      heading.className = 'reader-heading';
      const h2 = new MockElement('h2');
      const langLabel = new MockElement('p');
      langLabel.className = 'language-label';
      const sourceBadge = new MockElement('span');
      sourceBadge.className = 'source-badge';
      heading.children.push(h2, langLabel, sourceBadge);

      const englishReading = new MockElement('div');
      englishReading.className = 'english-reading';
      const englishVerse = new MockElement('p');
      englishVerse.className = 'english-verse';
      englishReading.children.push(englishVerse);

      const caption = new MockElement('div');
      caption.className = 'interlinear-caption';

      const grid = new MockElement('div');
      grid.className = 'word-grid';

      const empty = new MockElement('p');
      empty.className = 'reader-empty';

      const notice = new MockElement('p');
      notice.className = 'translation-notice';

      const footer = new MockElement('div');
      footer.className = 'reader-footer';
      const readingDir = new MockElement('span');
      readingDir.className = 'reading-direction';
      const legendSpan = new MockElement('span');
      footer.children.push(readingDir, legendSpan);

      this.children.push(heading, englishReading, caption, grid, empty, notice, footer);
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
  append(...children) {
    for (const c of children) this.appendChild(c);
  }

  before(newSibling) {
    // Basic before stub
    return newSibling;
  }

  replaceChildren(...newChildren) {
    this.children = [];
    for (const c of newChildren) {
      this.appendChild(c);
    }
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] ?? this[k] ?? null;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  click() {
    if (this.eventListeners.click) {
      for (const listener of this.eventListeners.click) {
        listener({
          target: this,
          preventDefault: () => {},
          stopPropagation: () => {},
        });
      }
    }
  }

  closest(selector) {
    if (selector === 'details' && this.tagName === 'DETAILS') return this;
    return null;
  }

  scrollIntoView() {
    // DOM stub
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector.includes('>')) {
      const parts = selector.split('>').map((s) => s.trim().replace(/:last-child/, ''));
      let current = [this];
      for (const part of parts) {
        const next = [];
        for (const node of current) {
          next.push(...node.children.filter((c) => {
            if (part.startsWith('.')) return c.classList.contains(part.slice(1));
            return c.tagName === part.toUpperCase();
          }));
        }
        current = next;
      }
      return current;
    }
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
        } else if (part.startsWith('[data-position="')) {
          const val = part.match(/\[data-position="(.*?)"\]/)?.[1];
          if (el.dataset.position === val) matched = true;
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

// Bundle VerseReader, NotesPanel, and notes-state
const mockPlugin = {
  name: 'mock-rpc',
  setup(build) {
    build.onResolve({ filter: /\/rpc$/ }, () => ({
      path: resolve('scripts/mock-notes-rpc.mjs'),
    }));
  },
};

await esbuild.build({
  stdin: {
    contents: `
      export * from './src/ui/components/VerseReader';
      export * from './src/ui/components/NotesPanel';
      export * from './src/ui/notes-state';
    `,
    resolveDir: resolve('.'),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  outfile: resolve('dist/notes-reader-test-bundle.js'),
  platform: 'neutral',
  target: 'es2022',
  plugins: [mockPlugin],
});

const { createVerseReader, createNotesPanel, notesState } = await import(`file://${resolve('dist/notes-reader-test-bundle.js')}`);

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

console.log('Test Group 1: VerseReader Token Mount & Badge Rendering');
{
  const mockTokens = [
    {
      word_id: 101,
      word_position: 1,
      original_word: 'שֹׁפֵךְ',
      transliteration: 'šo·p̄êḵ',
      strongs_nr: 'H8210',
      source_english: 'Whoever sheds',
      english_translations: ['sheds'],
    },
    {
      word_id: 102,
      word_position: 2,
      original_word: 'דַּם',
      transliteration: 'dam',
      strongs_nr: 'H1818',
      source_english: 'blood',
      english_translations: ['blood'],
    },
    {
      word_id: 103,
      word_position: 3,
      original_word: 'הָאָדָם',
      transliteration: 'hā·’ā·ḏām',
      strongs_nr: 'H120',
      source_english: 'of man',
      english_translations: ['man'],
    },
  ];

  let tokenNotesClicked = null;
  const reader = createVerseReader({
    context: new MockElement('div'),
    preview: { dismiss: () => {} },
    onWord: () => {},
    onPlace: () => {},
    onTokenNotes: (pos) => { tokenNotesClicked = pos; },
  });

  reader.render({ book: 1, chapter: 9, verse: 6 }, { data: mockTokens, source: 'sample', error: null });

  const wordTokens = reader.element.querySelectorAll('.word-token');
  assert(wordTokens.length === 3, `Rendered 3 word tokens (actual: ${wordTokens.length})`);

  // Verify mounts exist
  const token2 = reader.element.querySelector('[data-position="2"]');
  const mount2 = token2?.querySelector('.token-notes-mount');
  assert(mount2 !== null, 'Token position 2 has .token-notes-mount container');

  // Test 1.1: Applying note counts
  reader.setNoteCounts([
    { word_position: 2, human: 1, ai: 0 },
    { word_position: 3, human: 2, ai: 1 },
  ]);

  // Position 2: 1 human note
  const badge2 = token2.querySelector('.token-notes-badge');
  assert(badge2 !== null, 'Token position 2 has notes badge button');
  assert(badge2.getAttribute('aria-label') === '1 human note', `Aria-label correct: ${badge2.getAttribute('aria-label')}`);
  const humanCount2 = badge2.querySelector('.token-notes-count--human');
  assert(humanCount2 !== null, 'Human count badge rendered for token 2');
  assert(humanCount2.textContent === '1', 'Human count displays 1');
  assert(badge2.querySelector('.token-notes-count--ai') === null, 'No AI count rendered for token 2');

  // Position 3: 2 human notes, 1 AI note
  const token3 = reader.element.querySelector('[data-position="3"]');
  const badge3 = token3.querySelector('.token-notes-badge');
  assert(badge3 !== null, 'Token position 3 has notes badge button');
  assert(badge3.getAttribute('aria-label') === '2 human notes, 1 AI note', `Aria-label composite: ${badge3.getAttribute('aria-label')}`);
  assert(badge3.querySelector('.token-notes-count--human')?.textContent === '2', 'Human count 2');
  assert(badge3.querySelector('.token-notes-count--ai')?.textContent === '1', 'AI count 1');

  // Position 1: 0 notes -> no badge rendered
  const token1 = reader.element.querySelector('[data-position="1"]');
  assert(token1.querySelector('.token-notes-badge') === null, 'Token 1 with 0 notes has no badge');

  // Test 1.2: Clicking badge triggers onTokenNotes callback
  badge2.click();
  assert(tokenNotesClicked === 2, `Clicking badge 2 triggered onTokenNotes with position 2 (got: ${tokenNotesClicked})`);

  // Test 1.3: Calling setNoteCounts([]) clears badges
  reader.setNoteCounts([]);
  assert(token2.querySelector('.token-notes-badge') === null, 'Token 2 badge cleared after setNoteCounts([])');
  assert(token3.querySelector('.token-notes-badge') === null, 'Token 3 badge cleared after setNoteCounts([])');
}

console.log('\nTest Group 2: End-to-End Single-Request Wiring & Highlight Interaction');
{
  const mockGen96Notes = {
    primary: [
      {
        id: 'n-adam-dam',
        author: { kind: 'human', user_id: 'u1', display_name: 'You' },
        note_kind: 'study',
        body_md: 'Wordplay connection: dam (blood) and adam (man)',
        anchors: [
          { kind: 'word_occurrence', passage_ref: 'Gen 9:6', word_position: 2, word_id: 102, verse_id: 236 },
          { kind: 'word_occurrence', passage_ref: 'Gen 9:6', word_position: 3, word_id: 103, verse_id: 236 },
        ],
        connections: [],
        review_status: 'accepted',
      },
    ],
    secondary: [],
    totals: { total: 1, human: 1, ai: 0 },
    truncated: { primary: false, secondary: false },
    token_note_counts: [
      { word_position: 2, human: 1, ai: 0 },
      { word_position: 3, human: 1, ai: 0 },
    ],
  };

  let rpcFetchCount = 0;
  mockRpcState.getForPassageHandler = async () => {
    rpcFetchCount++;
    return {
      data: mockGen96Notes,
      error: null,
      source: 'database',
    };
  };

  // Wire reader and notesPanel together as in main.ts
  const reader = createVerseReader({
    context: new MockElement('div'),
    preview: { dismiss: () => {} },
    onWord: () => {},
    onPlace: () => {},
    onTokenNotes: (pos) => notesState.setSelectedTokenPosition(pos),
  });

  const notesPanel = createNotesPanel({
    onTokenCounts: (counts) => reader.setNoteCounts(counts),
  });

  const mockTokens = [
    { word_id: 101, word_position: 1, original_word: 'שֹׁפֵךְ', transliteration: 'šo·p̄êḵ', strongs_nr: 'H8210', english_translations: ['sheds'] },
    { word_id: 102, word_position: 2, original_word: 'דַּם', transliteration: 'dam', strongs_nr: 'H1818', english_translations: ['blood'] },
    { word_id: 103, word_position: 3, original_word: 'הָאָדָם', transliteration: 'hā·’ā·ḏām', strongs_nr: 'H120', english_translations: ['man'] },
  ];

  reader.render({ book: 1, chapter: 9, verse: 6 }, { data: mockTokens, source: 'sample', error: null });
  notesPanel.setPassage({ book: 1, chapter: 9, verse: 6 });
  await new Promise((r) => setTimeout(r, 10));

  assert(rpcFetchCount === 1, `Exactly 1 RPC call made for passage (actual: ${rpcFetchCount})`);

  // Verify badges populated via callback
  const token2 = reader.element.querySelector('[data-position="2"]');
  const token3 = reader.element.querySelector('[data-position="3"]');
  assert(token2?.querySelector('.token-notes-badge') !== null, 'Token 2 (דַּם) received badge via single response');
  assert(token3?.querySelector('.token-notes-badge') !== null, 'Token 3 (הָאָדָם) received badge via single response');

  // Verify clicking badge on token 2 triggers notesState and highlights matching card in panel
  const badge2 = token2.querySelector('.token-notes-badge');
  badge2.click();
  await new Promise((r) => setTimeout(r, 5));

  assert(notesState.getSelectedTokenPosition() === 2, 'notesState selectedTokenPosition set to 2');
  const card = notesPanel.element.querySelector('.note-card');
  assert(card !== null, 'Note card rendered in panel');
  assert(card.classList.contains('is-token-matched'), 'Matching note card has is-token-matched highlight class');

  // Clear selection
  notesState.clearSelectedTokenPosition();
  await new Promise((r) => setTimeout(r, 5));
  assert(!card.classList.contains('is-token-matched'), 'Highlight removed when selectedTokenPosition is cleared');
}

console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
