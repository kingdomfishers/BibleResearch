import esbuild from 'esbuild';
import { resolve } from 'node:path';
import { mockRpcState } from './mock-notes-rpc.mjs';

console.log('=== NOTE-23: Target Picker Integration Test ===\n');

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
    this.hidden = false;
    this.placeholder = '';
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
    this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} });
  }

  focus() {
    this.dispatchEvent({ type: 'focus', stopPropagation() {}, preventDefault() {} });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const match = (el) => {
      if (el === this) {
        for (const child of el.children) match(child);
        return;
      }
      let matches = true;
      let s = selector;
      const tagMatch = s.match(/^([a-z0-9]+)/i);
      if (tagMatch) {
        if (el.tagName !== tagMatch[1].toUpperCase()) matches = false;
        s = s.slice(tagMatch[1].length);
      }
      const classMatches = s.match(/\.([a-z0-9_-]+)/gi);
      if (classMatches) {
        for (const cm of classMatches) {
          const cls = cm.slice(1);
          if (!el.className.split(/\s+/).includes(cls)) matches = false;
        }
      }
      const idMatch = s.match(/#([a-z0-9_-]+)/i);
      if (idMatch) {
        if (el.id !== idMatch[1]) matches = false;
      }
      if (matches) results.push(el);
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
  createDocumentFragment: () => new MockElement('#fragment'),
  body: new MockElement('body'),
  addEventListener: () => {},
  removeEventListener: () => {},
};

globalThis.window = {
  location: { hash: '' },
  addEventListener: () => {},
  removeEventListener: () => {},
};

// Bundle TargetPicker with esbuild
const bundleResult = await esbuild.build({
  entryPoints: [resolve('src/ui/components/TargetPicker.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'mock-rpc-plugin',
      setup(build) {
        build.onResolve({ filter: /rpc$/ }, () => ({
          path: resolve('scripts/mock-notes-rpc.mjs'),
        }));
      },
    },
  ],
});

const bundledCode = bundleResult.outputFiles[0].text;
const blob = new Blob([bundledCode], { type: 'application/javascript' });
const blobUrl = `data:text/javascript;base64,${Buffer.from(bundledCode).toString('base64')}`;
const { createTargetPicker, TargetSearchManager } = await import(blobUrl);

let assertionsPassed = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  PASS: ${message}`);
  assertionsPassed++;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Test 1: Search Manager Unit & Stale Protection
// ---------------------------------------------------------------------------
console.log('Test 1: Search Manager Unit & Stale Protection');
{
  let notified = 0;
  const mgr = new TargetSearchManager(() => {
    notified++;
  });

  assert(mgr.state === 'idle', 'Initial state is idle');
  assert(mgr.flatCandidates.length === 0, 'No initial candidates');

  // Fast typing (stale-search cancellation)
  mgr.search('G', 50);
  mgr.search('Ge', 50);
  mgr.search('Gen 9:6', 50);
  await sleep(150);

  assert(mgr.state === 'success', 'State becomes success after debounced search');
  assert(mgr.groups.length === 1, 'Found 1 group for Gen 9:6');
  assert(mgr.groups[0].candidates[0].label === 'Genesis 9:6', 'Passage candidate label is Genesis 9:6');
  assert(mgr.flatCandidates.length === 1, 'Flat candidates contains 1 item');
  assert(mgr.activeIndex === 0, 'First candidate is active');

  // Arrow navigation
  mgr.moveActive(1);
  assert(mgr.activeIndex === 0, 'Cycles to 0 for single item');

  mgr.reset();
  assert(mgr.state === 'idle', 'Reset returns to idle');
}

// ---------------------------------------------------------------------------
// Test 2: Search queries Gen 9:6, H120, אדם, logos
// ---------------------------------------------------------------------------
console.log('\nTest 2: Search queries Gen 9:6, H120, אדם, logos');
{
  const picked = [];
  const picker = createTargetPicker({
    onPick: (anchor) => picked.push(anchor),
  });

  const input = picker.element.querySelector('input.target-picker__input');
  assert(input !== null, 'Search input exists');

  // Query: Gen 9:6
  input.value = 'Gen 9:6';
  input.dispatchEvent({ type: 'input' });
  await sleep(350);

  const results = picker.element.querySelector('.target-picker__results');
  const candGen = results.querySelector('.target-candidate');
  assert(candGen !== null, 'Candidate found for Gen 9:6');
  assert(candGen.textContent.includes('Genesis 9:6'), 'Displays Genesis 9:6');

  // Query: H120
  input.value = 'H120';
  input.dispatchEvent({ type: 'input' });
  await sleep(350);

  const candH120 = results.querySelector('.target-candidate');
  assert(candH120 !== null, 'Candidate found for H120');
  assert(candH120.textContent.includes('אָדָם (adam)'), 'Displays אָדָם (adam)');
  assert(!candH120.querySelector('.target-candidate__label').textContent.includes('H120'), 'Label does NOT include Strongs number');

  // Query: אדם
  input.value = 'אדם';
  input.dispatchEvent({ type: 'input' });
  await sleep(350);

  const groups = results.querySelectorAll('.target-picker__group');
  assert(groups.length === 2, 'Found 2 groups (lemma + word_form) for אדם');
  const lemmaGroup = groups[0];
  const wordGroup = groups[1];
  assert(lemmaGroup.getAttribute('aria-label').includes('Lemmas'), 'First group is Lemmas');
  assert(wordGroup.getAttribute('aria-label').includes('Word Forms'), 'Second group is Word Forms');
  assert(wordGroup.textContent.includes('הָֽאָדָ֔ם (ha·\'a·Dam)'), 'Word form candidate has Hebrew + transliteration');

  // Query: logos
  input.value = 'logos';
  input.dispatchEvent({ type: 'input' });
  await sleep(350);

  const candLogos = results.querySelector('.target-candidate');
  assert(candLogos !== null, 'Candidate found for logos');
  assert(candLogos.textContent.includes('λόγος (logos)'), 'Displays Greek lemma λόגος (logos)');
}

// ---------------------------------------------------------------------------
// Test 3: Keyboard-only selection
// ---------------------------------------------------------------------------
console.log('\nTest 3: Keyboard-only selection');
{
  const picked = [];
  const picker = createTargetPicker({
    onPick: (anchor) => picked.push(anchor),
  });

  const input = picker.element.querySelector('input.target-picker__input');
  input.value = 'אדם';
  input.dispatchEvent({ type: 'input' });
  await sleep(350);

  // Initial active descendant should be opt-0
  assert(input.getAttribute('aria-activedescendant') === 'target-opt-0', 'Active is opt-0 initially');

  // ArrowDown to opt-1
  input.dispatchEvent({
    type: 'keydown',
    key: 'ArrowDown',
    preventDefault() {},
  });
  assert(input.getAttribute('aria-activedescendant') === 'target-opt-1', 'Active moved to opt-1 on ArrowDown');

  // Press Enter to pick opt-1
  input.dispatchEvent({
    type: 'keydown',
    key: 'Enter',
    preventDefault() {},
  });
  assert(picked.length === 1, 'One target picked on Enter');
  assert(picked[0].kind === 'word_form', 'Picked anchor kind is word_form');
  assert(picked[0].word_id === 1050, 'Picked anchor word_id is 1050');
  assert(picked[0].label === 'הָֽאָדָ֔ם (ha·\'a·Dam)', 'Picked anchor label is Hebrew + transliteration');
  assert(!picked[0].label.includes('H120'), 'Picked anchor label contains NO Strongs number');
}

// ---------------------------------------------------------------------------
// Test 4: Token picker on Gen 9:6
// ---------------------------------------------------------------------------
console.log('\nTest 4: Token picker on Gen 9:6');
{
  const picked = [];
  const picker = createTargetPicker({
    onPick: (anchor) => picked.push(anchor),
  });

  // Set context to Genesis 9:6 with verseId 212
  picker.setContext({
    passage: { book: 1, chapter: 9, verse: 6 },
    verseId: 212,
  });
  await sleep(100);

  const tokenPickerEl = picker.element.querySelector('.token-picker');
  assert(tokenPickerEl !== null, 'Token picker element exists');
  const tokenBtns = tokenPickerEl.querySelectorAll('.token-btn');
  assert(tokenBtns.length === 6, 'Genesis 9:6 rendered 6 token buttons');

  // Token 2: דַּם (position 2, word_id 1818)
  const tokDam = tokenBtns[1];
  assert(tokDam.getAttribute('data-position') === '2', 'Token 2 position is 2');
  assert(tokDam.getAttribute('data-word-id') === '1818', 'Token 2 word_id is 1818');
  assert(tokDam.querySelector('.token-btn__original').textContent === 'דַּם', 'Token 2 original is דַּם');
  assert(tokDam.querySelector('.token-btn__transliteration').textContent === 'dam', 'Token 2 transliteration is dam');

  // Click Token 2 (דַּם)
  tokDam.click();
  assert(picked.length === 1, 'First token click emitted anchor');
  assert(picked[0].kind === 'word_occurrence', 'Emitted anchor is word_occurrence');
  assert(picked[0].verse_id === 212, 'Emitted anchor verse_id is 212');
  assert(picked[0].word_position === 2, 'Emitted anchor word_position is 2');
  assert(picked[0].word_id === 1818, 'Emitted anchor word_id is 1818');
  assert(picked[0].label === 'דַּם (dam)', 'Emitted anchor label is Hebrew + transliteration');
  assert(!picked[0].label.includes('H1818'), 'Emitted anchor label contains NO Strongs number');
  assert(tokDam.classList.contains('is-selected'), 'Token button is-selected toggled');

  // Token 3: הָאָדָם (position 3, word_id 120)
  const tokAdam = tokenBtns[2];
  assert(tokAdam.getAttribute('data-position') === '3', 'Token 3 position is 3');
  assert(tokAdam.getAttribute('data-word-id') === '120', 'Token 3 word_id is 120');

  // Click Token 3 (הָאָדָם)
  tokAdam.click();
  assert(picked.length === 2, 'Second token click emitted anchor');
  assert(picked[1].kind === 'word_occurrence', 'Second anchor is word_occurrence');
  assert(picked[1].verse_id === 212, 'Second anchor verse_id is 212');
  assert(picked[1].word_position === 3, 'Second anchor word_position is 3');
  assert(picked[1].word_id === 120, 'Second anchor word_id is 120');
  assert(picked[1].label === 'הָאָדָם (ha·\'a·dam)', 'Second anchor label is Hebrew + transliteration');
  assert(!picked[1].label.includes('H120'), 'Second anchor label contains NO Strongs number');
}

// ---------------------------------------------------------------------------
// Test 5: "Tag current selection" Quick Buttons
// ---------------------------------------------------------------------------
console.log('\nTest 5: "Tag current selection" Quick Buttons');
{
  const picked = [];
  const picker = createTargetPicker({
    onPick: (anchor) => picked.push(anchor),
  });

  // Provide passage and selectedWord
  picker.setContext({
    passage: { book: 1, chapter: 9, verse: 6 },
    verseId: 212,
    selectedPosition: 2,
    selectedWord: {
      id: 1818,
      original_word: 'דַּם',
      transliteration: 'dam',
      strongs_nr: 'H1818',
    },
    lemmaId: 1818,
    lemmaLabel: 'דָּם (dam)',
  });

  const quick = picker.element.querySelector('.target-picker__quick');
  const quickBtns = quick.querySelectorAll('.target-picker__quick-btn');
  assert(quickBtns.length === 4, '4 quick buttons rendered (verse, occurrence, form, lemma)');

  // 1. Tag Verse
  assert(quickBtns[0].textContent.includes('Tag verse (Genesis 9:6)'), 'Quick button 0 is Tag verse');
  quickBtns[0].click();
  assert(picked[0].kind === 'verse', 'Picked verse anchor');
  assert(picked[0].verse_id === 212, 'Verse id is 212');
  assert(picked[0].label === 'Genesis 9:6', 'Verse label is Genesis 9:6');

  // 2. Tag Occurrence
  assert(quickBtns[1].textContent.includes('Tag occurrence: דַּם (dam)'), 'Quick button 1 is Tag occurrence');
  quickBtns[1].click();
  assert(picked[1].kind === 'word_occurrence', 'Picked word_occurrence');
  assert(picked[1].word_position === 2, 'Occurrence position is 2');
  assert(picked[1].label === 'דַּם (dam)', 'Occurrence label is דַּם (dam)');

  // 3. Tag Word Form
  assert(quickBtns[2].textContent.includes('Tag word form: דַּם (dam)'), 'Quick button 2 is Tag word form');
  quickBtns[2].click();
  assert(picked[2].kind === 'word_form', 'Picked word_form');
  assert(picked[2].word_id === 1818, 'Form word_id is 1818');
  assert(picked[2].label === 'דַּם (dam)', 'Form label is דַּם (dam)');

  // 4. Tag Lemma
  assert(quickBtns[3].textContent.includes('Tag lemma: דָּם (dam)'), 'Quick button 3 is Tag lemma');
  quickBtns[3].click();
  assert(picked[3].kind === 'lemma', 'Picked lemma');
  assert(picked[3].lemma_id === 1818, 'Lemma id is 1818');
  assert(picked[3].label === 'דָּם (dam)', 'Lemma label is Hebrew + transliteration');
  assert(!picked[3].label.includes('H1818'), 'Lemma label contains NO Strongs number');
}

// ---------------------------------------------------------------------------
// Test 6: Empty and Error States with Retry
// ---------------------------------------------------------------------------
console.log('\nTest 6: Empty and Error States with Retry');
{
  const picker = createTargetPicker({ onPick: () => {} });
  const input = picker.element.querySelector('input.target-picker__input');

  // Unknown query -> empty state
  input.value = 'nonexistentxyz';
  input.dispatchEvent({ type: 'input' });
  await sleep(350);

  const results = picker.element.querySelector('.target-picker__results');
  assert(results.textContent.includes('No targets found'), 'Shows empty state for nonexistent target');

  // Trigger error state
  mockRpcState.searchTargetsHandler = async () => ({
    data: null,
    error: 'Simulated network timeout',
    source: 'unavailable',
  });

  input.value = 'errorquery';
  input.dispatchEvent({ type: 'input' });
  await sleep(350);

  const errEl = results.querySelector('.target-picker__status--error');
  assert(errEl !== null, 'Shows error element');
  assert(errEl.textContent.includes('Simulated network timeout'), 'Displays error message');
  const retryBtn = errEl.querySelector('.target-picker__retry-btn');
  assert(retryBtn !== null, 'Retry button is present');

  // Reset handler and click retry
  mockRpcState.searchTargetsHandler = null;
  retryBtn.click();
  await sleep(100);

  assert(!results.textContent.includes('Simulated network timeout'), 'Retry cleared previous error');
}

console.log(`\nAll ${assertionsPassed} assertions passed successfully!`);
