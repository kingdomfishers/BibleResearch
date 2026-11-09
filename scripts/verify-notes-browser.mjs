// scripts/verify-notes-browser.mjs
import esbuild from 'esbuild';
import { resolve } from 'node:path';
import { mockRpcState } from './mock-notes-rpc.mjs';

console.log('=== NOTE-26: Notes Browser Integration Test ===\n');

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this._textContent = '';
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = {};
    this._value = undefined;
    this.type = '';
    this.hidden = false;
    this.disabled = false;
    this.placeholder = '';
  }

  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') {
      const selected = this.querySelectorAll('option').find(o => o.selected);
      return selected ? selected.value : (this.children[0]?.value || '');
    }
    return '';
  }
  set value(v) {
    this._value = String(v);
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

  appendChild(child) {
    if (child) {
      if (child.tagName === 'DOCUMENT-FRAGMENT') {
        this.children.push(...child.children);
      } else {
        this.children.push(child);
      }
    }
    return child;
  }

  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const textNode = new MockElement('SPAN');
        textNode._textContent = n;
        this.children.push(textNode);
      } else if (n) {
        if (n.tagName === 'DOCUMENT-FRAGMENT') {
          this.children.push(...n.children);
        } else {
          this.children.push(n);
        }
      }
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] ?? null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }

  get classList() {
    const self = this;
    return {
      contains(c) {
        return self.className.split(/\s+/).includes(c);
      },
      add(c) {
        if (!this.contains(c)) self.className = `${self.className} ${c}`.trim();
      },
      remove(c) {
        self.className = self.className.split(/\s+/).filter((x) => x !== c).join(' ');
      },
      toggle(c, force) {
        if (force === true) this.add(c);
        else if (force === false) this.remove(c);
        else if (this.contains(c)) this.remove(c);
        else this.add(c);
      },
    };
  }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  dispatchEvent(evt) {
    const list = this.eventListeners[evt.type] || [];
    for (const fn of list) fn(evt);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false, preventDefault() {}, stopPropagation() {} });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    function match(node) {
      const parts = selector.trim().split(/\s+/);
      const sel = parts[parts.length - 1];
      let matches = false;
      if (sel.startsWith('.')) {
        matches = node.classList.contains(sel.slice(1));
      } else if (sel.startsWith('#')) {
        matches = node.id === sel.slice(1);
      } else if (sel.toLowerCase() === node.tagName.toLowerCase()) {
        matches = true;
      }
      if (matches) results.push(node);
      for (const child of node.children) match(child);
    }
    for (const child of this.children) match(child);
    return results;
  }
}

globalThis.document = {
  createElement: (tag) => new MockElement(tag),
  createElementNS: (_, tag) => new MockElement(tag),
  createDocumentFragment: () => new MockElement('DOCUMENT-FRAGMENT'),
  createTextNode: (text) => {
    const el = new MockElement('SPAN');
    el._textContent = text;
    return el;
  },
  activeElement: null,
};

globalThis.window = {
  confirm: () => true,
  localStorage: {
    getItem() { return null; },
    setItem() {},
  },
  location: { hash: '' },
  history: {
    pushState(_, __, h) { globalThis.window.location.hash = h; },
    replaceState(_, __, h) { globalThis.window.location.hash = h; },
  },
  addEventListener() {},
};

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function run() {
  const result = await esbuild.build({
    entryPoints: [resolve('src/ui/components/NotesBrowser.ts')],
    bundle: true,
    write: false,
    format: 'esm',
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

  const code = result.outputFiles[0].text;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

  console.log('--- 1. Testing parseAnchorPassage & NotesListManager ---');
  const p1 = mod.parseAnchorPassage('Genesis 9:6');
  assert(p1 && p1.book === 1 && p1.chapter === 9 && p1.verse === 6, 'Genesis 9:6 parsed correctly');

  const p2 = mod.parseAnchorPassage('Psalm 23:1');
  assert(p2 && p2.book === 19 && p2.chapter === 23 && p2.verse === 1, 'Psalm 23:1 parsed correctly');

  const p3 = mod.parseAnchorPassage('invalid anchor label');
  assert(p3 === null, 'Invalid anchor label returns null');

  const mgr = new mod.NotesListManager();
  assert(mgr.notes.length === 0, 'Manager initial notes empty');
  assert(mgr.cursor === null, 'Manager initial cursor null');

  const sampleNote1 = {
    id: '00000000-0000-0000-0000-000000000001',
    title: 'Note 1',
    body_md: 'Body 1',
    note_kind: 'study',
    author: { kind: 'human' },
    anchors: [{ kind: 'verse', verse_id: 212, label: 'Genesis 9:6' }],
    connections: [],
    blocks: [],
  };
  const sampleNote2 = {
    id: '00000000-0000-0000-0000-000000000002',
    title: 'Note 2',
    body_md: 'Body 2',
    note_kind: 'study',
    author: { kind: 'ai' },
    anchors: [],
    connections: [],
    blocks: [],
  };

  mgr.append({
    notes: [sampleNote1, sampleNote2],
    page: { limit: 20, next_cursor: { created_at: '2026-11-09', id: '2' }, has_more: true },
    total: 2,
  });
  assert(mgr.notes.length === 2, '2 notes appended');
  assert(mgr.hasMore === true, 'hasMore is true');
  assert(mgr.cursor?.id === '2', 'next_cursor stored');

  // Keyset pagination deduplication check
  mgr.append({
    notes: [sampleNote2, { ...sampleNote1, id: '00000000-0000-0000-0000-000000000003', title: 'Note 3' }],
    page: { limit: 20, next_cursor: null, has_more: false },
    total: 3,
  });
  assert(mgr.notes.length === 3, 'Duplicate Note 2 ignored during keyset pagination (3 notes total)');
  assert(mgr.hasMore === false, 'hasMore updated to false');

  mgr.reset();
  assert(mgr.notes.length === 0, 'Reset cleared notes');
  assert(mgr.seenIds.size === 0, 'Reset cleared seen IDs');

  console.log('\n--- 2. Testing NotesBrowser UI Component ---');
  let navigatedPassage = null;
  let editedNote = null;
  const browser = mod.createNotesBrowser({
    onNavigatePassage: (p) => { navigatedPassage = p; },
    onEditNote: (n) => { editedNote = n; },
  });

  assert(browser.element.classList.contains('notes-browser'), 'Root element has .notes-browser class');
  assert(browser.element.hidden === true, 'Browser hidden initially');
  assert(browser.isOpen() === false, 'isOpen returns false initially');

  // Open browser
  browser.open();
  assert(browser.element.hidden === false, 'Browser visible on open()');
  assert(browser.isOpen() === true, 'isOpen returns true');

  // Close browser
  browser.close();
  assert(browser.element.hidden === true, 'Browser hidden on close()');
  assert(browser.isOpen() === false, 'isOpen returns false');

  console.log('\n--- 3. Testing Keyset Pagination & Search ---');
  let listCalls = [];
  mockRpcState.listHandler = async (filters, cursor, opts) => {
    listCalls.push({ filters, cursor, opts });
    if (!cursor) {
      return {
        data: {
          notes: [sampleNote1],
          page: { limit: 20, next_cursor: { created_at: '2026-11-09', id: sampleNote1.id }, has_more: true },
          total: 2,
        },
        error: null,
      };
    } else {
      return {
        data: {
          notes: [sampleNote2],
          page: { limit: 20, next_cursor: null, has_more: false },
          total: 2,
        },
        error: null,
      };
    }
  };

  browser.open();
  await new Promise(r => setTimeout(r, 50));

  assert(listCalls.length === 1, 'Initial page fetched');
  assert(browser.getManager().notes.length === 1, 'Page 1 note rendered');

  const loadMoreBtn = browser.element.querySelector('.notes-browser__load-more');
  assert(loadMoreBtn && !loadMoreBtn.hidden, 'Load more button is visible when hasMore is true');

  loadMoreBtn.click();
  await new Promise(r => setTimeout(r, 50));

  assert(listCalls.length === 2, 'Page 2 fetched on load more click');
  assert(browser.getManager().notes.length === 2, 'Both notes present after pagination');
  assert(loadMoreBtn.hidden === true, 'Load more button hidden when hasMore becomes false');

  console.log('\n--- 4. Testing Anchor Click & Back to Notes Return Bar ---');
  const anchorChip = browser.element.querySelector('.note-card__anchors .note-chip');
  assert(anchorChip !== null, 'Anchor chip found on rendered note card');

  anchorChip.click();
  assert(navigatedPassage && navigatedPassage.book === 1 && navigatedPassage.chapter === 9 && navigatedPassage.verse === 6, 'Passage navigation invoked for Genesis 9:6');
  assert(browser.element.hidden === true, 'Browser closed on anchor navigation');
  assert(browser.returnBar.hidden === false, 'Return bar visible on anchor navigation');

  // Click "← Back to notes"
  const returnBtn = browser.returnBar.querySelector('.notes-browser-return__btn');
  assert(returnBtn !== null, 'Return button found in return bar');
  returnBtn.click();

  assert(browser.element.hidden === false, 'Browser reopened after clicking Return');
  assert(browser.returnBar.hidden === true, 'Return bar hidden after clicking Return');
  assert(browser.getManager().notes.length === 2, 'Notes state and pagination preserved when returning');

  console.log('\n--- 5. Testing Deep Link (#note=<id>) ---');
  mockRpcState.overrideGetNote = async (id) => {
    if (id === sampleNote1.id) {
      return { data: sampleNote1, error: null };
    }
    return { data: null, error: 'Not found' };
  };

  const validDeepLink = await browser.openDeepLink(sampleNote1.id);
  assert(validDeepLink === true, 'openDeepLink returns true for valid note ID');
  assert(editedNote?.id === sampleNote1.id, 'onEditNote invoked for deep linked note');

  const banner = browser.element.querySelector('.notes-browser__banner');
  assert(banner.hidden === true, 'Error banner hidden for valid deep link');

  const invalidDeepLink = await browser.openDeepLink('00000000-0000-0000-0000-00000000dead');
  assert(invalidDeepLink === false, 'openDeepLink returns false for invalid note ID');
  assert(banner.hidden === false, 'Banner shown for invalid note ID');
  assert(banner.textContent.includes('Note not found'), 'Friendly message displayed in banner');

  console.log(`\n================================`);
  console.log(`NOTE-26 Tests: ${passed} passed, ${failed} failed`);
  console.log(`================================`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error('ERROR OCCURRED:', e.name, e.message);
  console.error((e.stack || '').replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<base64-module>'));
  process.exit(1);
});
