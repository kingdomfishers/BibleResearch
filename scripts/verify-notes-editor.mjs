// scripts/verify-notes-editor.mjs
import esbuild from 'esbuild';
import { resolve } from 'node:path';
import { mockRpcState } from './mock-notes-rpc.mjs';

console.log('=== NOTE-25: Note Editor Integration Test ===\n');

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
    this.maxLength = 0;
    this.title = '';
    this.open = false;
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
    if (child) this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const textNode = new MockElement('SPAN');
        textNode.textContent = node;
        this.children.push(textNode);
      } else if (node) {
        if (node.tagName === 'DOCUMENT_FRAGMENT') {
          this.children.push(...node.children);
        } else {
          this.children.push(node);
        }
      }
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'open') this.open = true;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'open') this.open = false;
  }

  showModal() {
    this.open = true;
    this.setAttribute('open', '');
  }

  close() {
    this.open = false;
    this.removeAttribute('open');
  }

  focus() {
    globalThis.document.activeElement = this;
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

      let isMatch = true;
      const classMatch = sel.match(/\.([a-zA-Z0-9_-]+)/g);
      const tagMatch = sel.match(/^([a-zA-Z0-9_-]+)/);

      if (tagMatch && node.tagName !== tagMatch[1].toUpperCase()) {
        isMatch = false;
      }
      if (classMatch) {
        const classes = classMatch.map(c => c.slice(1));
        const nodeClasses = (node.className || '').split(/\s+/);
        if (!classes.every(c => nodeClasses.includes(c))) isMatch = false;
      }
      if (!tagMatch && !classMatch) isMatch = false;

      if (isMatch) results.push(node);
      for (const child of node.children) match(child);
    }
    for (const child of this.children) match(child);
    return results;
  }

  get classList() {
    const self = this;
    return {
      add(cls) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        set.add(cls);
        self.className = Array.from(set).join(' ');
      },
      remove(cls) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        set.delete(cls);
        self.className = Array.from(set).join(' ');
      },
      contains(cls) {
        return (self.className || '').split(/\s+/).includes(cls);
      },
      toggle(cls, force) {
        if (force === undefined) {
          if (this.contains(cls)) this.remove(cls);
          else this.add(cls);
        } else if (force) {
          this.add(cls);
        } else {
          this.remove(cls);
        }
      },
    };
  }
}

// Global DOM setup
globalThis.document = {
  activeElement: null,
  createElement(tag) {
    return new MockElement(tag);
  },
  createDocumentFragment() {
    return new MockElement('DOCUMENT_FRAGMENT');
  },
  createTextNode(text) {
    const node = new MockElement('#text');
    node.textContent = text;
    return node;
  },
};
globalThis.window = {
  location: { hash: '' },
  addEventListener: () => {},
  removeEventListener: () => {},
  promptVal: '',
  promptList: [],
  confirmResult: true,
  alertMsg: '',
  prompt(msg) {
    if (this.promptList && this.promptList.length > 0) {
      return this.promptList.shift();
    }
    return this.promptVal;
  },
  alert(msg) {
    this.alertMsg = msg;
  },
  confirm(msg) {
    return this.confirmResult;
  },
};

async function bundleModule(sourcePath) {
  const result = await esbuild.build({
    entryPoints: [sourcePath],
    bundle: true,
    write: false,
    format: 'esm',
    plugins: [
      {
        name: 'mock-supabase',
        setup(build) {
          build.onResolve({ filter: /rpc$/ }, args => ({
            path: resolve('scripts/mock-notes-rpc.mjs'),
          }));
          build.onResolve({ filter: /supabase$/ }, args => ({
            path: resolve('scripts/mock-notes-rpc.mjs'),
          }));
        },
      },
    ],
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

async function run() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  console.log('--- 1. Testing NoteEditorModel (pure logic & validation) ---');
  const modelModule = await bundleModule(resolve('src/ui/components/NoteEditorModel.ts'));
  const {
    createEmptyDraft,
    noteToDraft,
    validateDraft,
    isValidHttps,
    draftToPayload,
    generateClientKey,
    generateRequestId,
  } = modelModule;

  // 1.1 isValidHttps
  assert(isValidHttps('https://example.com/image.jpg') === true, 'Valid https URL accepted');
  assert(isValidHttps('http://insecure.com') === false, 'Plain http URL rejected');
  assert(isValidHttps('javascript:alert(1)') === false, 'javascript: URI rejected');
  assert(isValidHttps('not a url') === false, 'Malformed URL rejected');

  // 1.2 createEmptyDraft
  const emptyDraft = createEmptyDraft({ book: 1, chapter: 9, verse: 6 }, 100);
  assert(emptyDraft.note_kind === 'observation', 'Default note_kind is observation');
  assert(emptyDraft.language === 'en', 'Default language is en');
  assert(typeof emptyDraft.client_request_id === 'string' && emptyDraft.client_request_id.length > 5, 'client_request_id generated');
  assert(emptyDraft.anchors.length === 1, 'Passage anchor added to empty draft');
  assert(emptyDraft.anchors[0].kind === 'verse', 'Passage anchor is kind verse');
  assert(emptyDraft.anchors[0].verse_id === 100, 'Passage anchor has correct verse_id');

  // 1.3 validateDraft checks
  const validDraft = {
    ...emptyDraft,
    title: 'Short valid title',
    body_md: 'A detailed research observation about blood and life.',
  };
  const valResult = validateDraft(validDraft);
  assert(valResult.valid === true, 'Valid draft passes validation');

  // Title limit > 200
  const longTitleDraft = { ...validDraft, title: 'a'.repeat(201) };
  assert(validateDraft(longTitleDraft).valid === false, 'Title > 200 chars fails validation');
  assert(Boolean(validateDraft(longTitleDraft).errors.title), 'Title error present');

  // Empty body
  const emptyBodyDraft = { ...validDraft, body_md: '   ' };
  assert(validateDraft(emptyBodyDraft).valid === false, 'Empty body fails validation');

  // Body limit > 20,000
  const longBodyDraft = { ...validDraft, body_md: 'a'.repeat(20001) };
  assert(validateDraft(longBodyDraft).valid === false, 'Body > 20,000 chars fails validation');

  // Insecure block URL
  const badBlockDraft = {
    ...validDraft,
    blocks: [
      {
        client_key: 'b1',
        block_type: 'link',
        content: { url: 'http://insecure.com' },
        text_alternative: 'Link text',
      },
    ],
  };
  assert(validateDraft(badBlockDraft).valid === false, 'Insecure block URL fails validation');

  // Image block missing alt text
  const missingAltDraft = {
    ...validDraft,
    blocks: [
      {
        client_key: 'b2',
        block_type: 'image',
        content: { url: 'https://example.com/img.png', alt_text: '' },
        text_alternative: 'Some text',
      },
    ],
  };
  assert(validateDraft(missingAltDraft).valid === false, 'Image block with empty alt text fails validation');

  // Block missing text_alternative
  const missingTextAltDraft = {
    ...validDraft,
    blocks: [
      {
        client_key: 'b3',
        block_type: 'link',
        content: { url: 'https://example.com/test' },
        text_alternative: '',
      },
    ],
  };
  assert(validateDraft(missingTextAltDraft).valid === false, 'Block without text_alternative fails validation');

  // Markdown block validation (must NOT require content.url)
  const markdownBlockDraft = {
    ...validDraft,
    blocks: [
      {
        client_key: 'b4',
        block_type: 'markdown',
        content: { markdown: '### Wordplay Observation\nembedded directly.' },
        text_alternative: 'Wordplay note summary',
      },
    ],
  };
  assert(validateDraft(markdownBlockDraft).valid === true, 'Markdown block passes validation without url');

  // 1.4 draftToPayload conversion
  const payload = draftToPayload(validDraft);
  assert(payload.title === 'Short valid title', 'payload title matches');
  assert(payload.body_md === validDraft.body_md, 'payload body_md matches');
  assert(payload.client_request_id === validDraft.client_request_id, 'client_request_id preserved in payload');

  console.log('\n--- 2. Testing NoteEditor Component (UI lifecycle, wiring & controls) ---');
  const editorModule = await bundleModule(resolve('src/ui/components/NoteEditor.ts'));
  const { createNoteEditor } = editorModule;

  let savedNote = null;
  const editor = createNoteEditor({
    onSaved: note => {
      savedNote = note;
    },
  });

  assert(editor.element.tagName === 'DIALOG', 'NoteEditor root element is a DIALOG');
  assert(editor.element.classList.contains('note-editor-dialog'), 'Has note-editor-dialog class');

  // 2.1 openNew with tagged word context
  editor.openNew({
    passage: { book: 1, chapter: 9, verse: 6 },
    verseId: 42,
    selectedWord: { id: 1818, original_word: 'דַּם', transliteration: 'dam' },
    selectedPosition: 6,
  });

  assert(editor.element.open === true, 'Dialog opens on openNew');
  const anchorChips = editor.element.querySelectorAll('.note-chip');
  assert(anchorChips.length >= 3, 'Verse + Occurrence + WordForm anchors generated (3 chips)');

  // Tagged word representation check: Hebrew + transliteration with NO Strong's number
  const anchorLabels = anchorChips.map(c => c.querySelector('bdi')?.textContent || '');
  const wordAnchor = anchorLabels.find(l => l.includes('דַּם'));
  assert(Boolean(wordAnchor), 'Word anchor contains Hebrew text דַּם');
  assert(wordAnchor.includes('(dam)'), 'Word anchor contains transliteration (dam)');
  assert(!wordAnchor.includes('H1818') && !wordAnchor.includes('1818'), 'Word anchor has NO Strongs number');

  // 2.2 Form inputs & character counter
  const titleInput = editor.element.querySelector('.note-editor__title');
  const kindSelect = editor.element.querySelector('.note-editor__kind');
  const bodyTextarea = editor.element.querySelector('.note-editor__body');
  const counter = editor.element.querySelector('.note-editor__counter');

  assert(Boolean(titleInput), 'Title input present');
  assert(Boolean(kindSelect), 'Kind select present');
  assert(Boolean(bodyTextarea), 'Body textarea present');
  assert(Boolean(counter), 'Character counter present');

  titleInput.value = 'Genesis 9:6 Dam Connection';
  titleInput.dispatchEvent({ type: 'input' });
  bodyTextarea.value = 'Observation regarding **dam** and covenant blood.';
  bodyTextarea.dispatchEvent({ type: 'input' });

  assert(counter.textContent.includes(String(bodyTextarea.value.length)), 'Counter updates with input length');

  // 2.3 Write / Preview tabs & Markdown XSS inertness
  const tabs = editor.element.querySelectorAll('.note-editor__tab');
  const writeTab = tabs[0];
  const prevTab = tabs[1];
  const previewArea = editor.element.querySelector('.note-editor__preview');

  assert(writeTab && prevTab, 'Write and Preview tabs found');
  assert(previewArea.hidden === true, 'Preview area hidden initially');

  // Set XSS payload in textarea
  const xssPayload = '<script>alert("xss")</script><img src="x" onerror="alert(1)"># Heading\nBold **text**';
  bodyTextarea.value = xssPayload;
  bodyTextarea.dispatchEvent({ type: 'input' });

  // Click Preview tab
  prevTab.click();
  assert(writeTab.classList.contains('is-active') === false, 'Write tab inactive');
  assert(prevTab.classList.contains('is-active') === true, 'Preview tab active');
  assert(bodyTextarea.hidden === true, 'Textarea hidden in preview mode');
  assert(previewArea.hidden === false, 'Preview area visible');

  // Assert script execution nodes are absent and text is rendered inertly
  const scripts = previewArea.querySelectorAll('script');
  assert(scripts.length === 0, 'No script nodes rendered in preview');
  assert(previewArea.textContent.includes('alert("xss")') || previewArea.textContent.includes('Heading'), 'Content rendered safely');

  // Return to write tab
  writeTab.click();
  assert(bodyTextarea.hidden === false, 'Textarea visible again in write mode');

  // 2.4 Adding Blocks (Link & Image)
  const addLinkBtn = editor.element.querySelectorAll('.editor-btn--sm').find(b => b.textContent.includes('Link'));
  const addImgBtn = editor.element.querySelectorAll('.editor-btn--sm').find(b => b.textContent.includes('Image'));
  assert(Boolean(addLinkBtn), 'Add Link button present');
  assert(Boolean(addImgBtn), 'Add Image button present');

  // Insecure URL prompt
  globalThis.window.promptList = ['http://insecure.com'];
  addLinkBtn.click();
  assert(globalThis.window.alertMsg.includes('https://'), 'Insecure URL shows https alert');

  // Valid Link prompt
  globalThis.window.promptList = ['https://example.com/reference', 'Study reference page'];
  addLinkBtn.click();
  let blockRows = editor.element.querySelectorAll('.editor-block-row');
  assert(blockRows.length === 1, 'Link block row added');
  assert(blockRows[0].textContent.includes('https://example.com/reference'), 'Link URL in block row');

  // Remove block
  const blockRemBtn = blockRows[0].querySelector('button');
  blockRemBtn.click();
  blockRows = editor.element.querySelectorAll('.editor-block-row');
  assert(blockRows.length === 0, 'Block removed on remove click');

  // 2.5 Removing an Anchor chip
  const initialChipsCount = editor.element.querySelectorAll('.note-chip').length;
  const firstChipRem = editor.element.querySelector('.note-chip__remove');
  firstChipRem.click();
  const updatedChipsCount = editor.element.querySelectorAll('.note-chip').length;
  assert(updatedChipsCount === initialChipsCount - 1, 'Anchor removed from chip list');

  // 2.6 Save Validation Failure (empty body)
  const errBanner = editor.element.querySelector('.note-editor__error-banner');
  const saveBtn = editor.element.querySelector('.editor-btn--primary');
  assert(Boolean(errBanner), 'Error banner element exists');
  assert(errBanner.hidden === true, 'Error banner hidden initially');

  bodyTextarea.value = '';
  bodyTextarea.dispatchEvent({ type: 'input' });
  saveBtn.click();

  assert(errBanner.hidden === false, 'Error banner shown on validation failure');
  assert(errBanner.textContent.includes('empty'), 'Error banner mentions empty note body');

  // 2.7 Successful Save with Idempotency
  bodyTextarea.value = 'Valid research observation for Adam and Dam.';
  bodyTextarea.dispatchEvent({ type: 'input' });

  let saveCalled = false;
  let sentRequestId = '';
  mockRpcState.overrideSave = async (payload) => {
    saveCalled = true;
    sentRequestId = payload.client_request_id;
    return {
      ok: true,
      note: {
        id: 'note_test_123',
        title: payload.title,
        body_md: payload.body_md,
        version: 1,
        anchors: [],
      },
    };
  };

  await saveBtn.click();
  // Allow async save handler to resolve
  await new Promise(r => setTimeout(r, 20));

  assert(saveCalled === true, 'Save RPC called');
  assert(Boolean(sentRequestId) && sentRequestId.length > 5, 'client_request_id passed in save payload');
  assert(savedNote && savedNote.id === 'note_test_123', 'onSaved callback invoked with saved note');
  assert(editor.element.open === false, 'Dialog closed on successful save');

  // 2.7b Edit existing note with markdown block (Gen 9:6 case)
  editor.openEdit({
    id: '11c1dde6-9e70-4537-9090-e3e09e1fb778',
    title: 'Adam/Dam Connection',
    body_md: 'Wordplay connection: **דַּ֣ם** (blood) is embedded in **אָדָם** (humanity).',
    note_kind: 'linguistic',
    version: 1,
    anchors: [],
    connections: [],
    blocks: [
      {
        id: '7161b1a8-3c45-4ea6-a3df-22b2c1d622df',
        block_type: 'markdown',
        content: { markdown: '### Wordplay Observation\nThe Hebrew root for blood (*dam*) is embedded directly.' },
        text_alternative: 'Wordplay note summary',
      },
    ],
  });
  saveCalled = false;
  await saveBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert(saveCalled === true, 'Existing note with markdown block saved successfully without URL error');
  assert(errBanner.hidden === true, 'Error banner hidden when saving note with markdown block');

  // 2.7c TargetPicker search and click candidate adds anchor
  const addAnchorBtn = editor.element.querySelectorAll('.editor-btn--sm').find(b => b.textContent.includes('anchor'));
  addAnchorBtn.click();
  const searchInput = editor.element.querySelector('.target-picker__input');
  assert(Boolean(searchInput), 'TargetPicker search input visible in editor');
  searchInput.value = 'dam';
  searchInput.dispatchEvent({ type: 'input' });
  await new Promise(r => setTimeout(r, 300));
  const candidate = editor.element.querySelector('.target-candidate');
  assert(Boolean(candidate), 'Search result candidate rendered for transliteration query');
  const countBeforePick = editor.element.querySelectorAll('.note-chip').length;
  candidate.click();
  const countAfterPick = editor.element.querySelectorAll('.note-chip').length;
  assert(countAfterPick === countBeforePick + 1, 'Clicking transliteration candidate adds anchor chip');

  // 2.8 Version Conflict Handling & Copy Buffer Preservation
  editor.openNew();
  bodyTextarea.value = 'Text written by user before conflict';
  bodyTextarea.dispatchEvent({ type: 'input' });

  mockRpcState.overrideSave = async () => ({
    ok: false,
    error: {
      code: 'version_conflict',
      message: 'Note modified in another session',
    },
  });

  await saveBtn.click();
  await new Promise(r => setTimeout(r, 20));

  assert(errBanner.hidden === false, 'Error banner visible on version conflict');
  assert(errBanner.textContent.includes('Conflict'), 'Error banner displays conflict explanation');
  const reloadBtn = errBanner.querySelector('button');
  assert(Boolean(reloadBtn), 'Reload note button offered on version conflict');
  assert(bodyTextarea.value === 'Text written by user before conflict', 'User input preserved during conflict');

  // 2.9 Network Error & Retry without Data Loss
  mockRpcState.overrideSave = async () => {
    throw new Error('Connection failed: Network timeout');
  };

  await saveBtn.click();
  await new Promise(r => setTimeout(r, 20));

  assert(errBanner.hidden === false, 'Error banner visible on network error');
  assert(errBanner.textContent.includes('Connection failed'), 'Network error message displayed');
  assert(bodyTextarea.value === 'Text written by user before conflict', 'User text preserved on network failure');
  assert(saveBtn.disabled === false, 'Save button re-enabled for retry');

  // 2.10 Escape Key Confirmation when Dirty
  // User rejects discard
  globalThis.window.confirmResult = false;
  editor.element.dispatchEvent({ type: 'keydown', key: 'Escape', defaultPrevented: false, preventDefault() {} });
  assert(editor.element.open === true, 'Dialog remains open when user cancels discard prompt');

  // User accepts discard
  globalThis.window.confirmResult = true;
  editor.element.dispatchEvent({ type: 'keydown', key: 'Escape', defaultPrevented: false, preventDefault() {} });
  assert(editor.element.open === false, 'Dialog closes when user confirms discard');

  // Clean up mock override
  mockRpcState.overrideSave = null;

  console.log(`\n================================`);
  console.log(`NOTE-25 Tests: ${passed} passed, ${failed} failed`);
  console.log(`================================\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
