import esbuild from 'esbuild';
import { resolve } from 'node:path';
import { mockRpcState } from './mock-notes-rpc.mjs';

console.log('=== NOTE-24: Connection Builder Integration Test ===\n');

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

// Bundle ConnectionBuilder with esbuild
const bundleResult = await esbuild.build({
  entryPoints: [resolve('src/ui/components/ConnectionBuilder.ts')],
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
const blobUrl = `data:text/javascript;base64,${Buffer.from(bundledCode).toString('base64')}`;
const { createConnectionBuilder, ConnectionModel } = await import(blobUrl);

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
// Test 1: Model Operations, Reverse Swapping, and Type Defaults
// ---------------------------------------------------------------------------
console.log('Test 1: Model Operations, Reverse Swapping, and Type Defaults');
{
  const model = new ConnectionModel();
  await model.loadTypes();

  assert(model.types.length >= 3, 'Connection types loaded from RPC');
  const containedIn = model.findType('contained_in');
  assert(containedIn !== undefined, 'Found contained_in connection type');
  assert(containedIn.default_direction === 'directed', 'contained_in default_direction is directed');

  const anchors = [
    { client_key: 'a_dam', label: 'דַּם (dam)' },
    { client_key: 'a_adam', label: 'הָאָדָם (ha·\'a·dam)' },
    { client_key: 'a_verse', label: 'Genesis 9:6' },
  ];

  // Add draft
  const draft1 = model.addDraft(anchors);
  assert(draft1 !== null, 'Draft 1 created');
  assert(draft1.from_client_key === 'a_dam', 'Default from anchor is first anchor');
  assert(draft1.to_client_key === 'a_adam', 'Default to anchor is second anchor');
  assert(draft1.direction === 'directed', 'Default direction is directed');

  // Change type to parallels -> defaults follow type (bidirectional)
  model.updateDraft(draft1.id, { connection_type: 'parallels' });
  assert(draft1.direction === 'bidirectional', 'Setting type to parallels defaults direction to bidirectional');

  // Change type to contained_in -> defaults to directed
  model.updateDraft(draft1.id, { connection_type: 'contained_in' });
  assert(draft1.direction === 'directed', 'Setting type to contained_in defaults direction to directed');

  // Set direction to reverse
  model.updateDraft(draft1.id, { direction: 'reverse' });
  assert(draft1.direction === 'reverse', 'Draft direction updated to reverse');

  // Test reverse direction swaps endpoints on toPayloads
  const payloads1 = model.toPayloads(anchors);
  assert(payloads1.length === 1, 'Generates 1 payload');
  assert(payloads1[0].from === 'a_adam', 'Reverse direction swapped from to a_adam');
  assert(payloads1[0].to === 'a_dam', 'Reverse direction swapped to to a_dam');
  assert(payloads1[0].direction === 'directed', 'Reverse direction converted to directed on save');
  assert(payloads1[0].connection_type === 'contained_in', 'Payload preserves connection_type');

  // Reset to directed
  model.updateDraft(draft1.id, { direction: 'directed' });
  const payloadsDirected = model.toPayloads(anchors);
  assert(payloadsDirected[0].from === 'a_dam', 'Directed keeps from as a_dam');
  assert(payloadsDirected[0].to === 'a_adam', 'Directed keeps to as a_adam');
}

// ---------------------------------------------------------------------------
// Test 2: Validation (Self and Duplicate Rejection)
// ---------------------------------------------------------------------------
console.log('\nTest 2: Validation (Self and Duplicate Rejection)');
{
  const model = new ConnectionModel();
  await model.loadTypes();

  const anchors = [
    { client_key: 'a_dam', label: 'דַּם (dam)' },
    { client_key: 'a_adam', label: 'הָאָדָם (ha·\'a·dam)' },
  ];

  const draft1 = model.addDraft(anchors);
  assert(model.validateDraft(draft1, anchors).valid, 'Valid draft passes validation');

  // Self connection rejected
  model.updateDraft(draft1.id, { to_client_key: 'a_dam' });
  const selfVal = model.validateDraft(draft1, anchors);
  assert(!selfVal.valid, 'Self connection (from === to) is invalid');
  assert(selfVal.error.includes('itself'), 'Error message mentions itself');
  assert(model.toPayloads(anchors).length === 0, 'Invalid self connection excluded from payloads');

  // Restore valid endpoints
  model.updateDraft(draft1.id, { to_client_key: 'a_adam' });
  assert(model.toPayloads(anchors).length === 1, 'Valid draft produces 1 payload');

  // Add duplicate connection
  const draft2 = model.addDraft(anchors);
  const dupVal = model.validateDraft(draft2, anchors);
  assert(!dupVal.valid, 'Duplicate connection between same anchors is invalid');
  assert(dupVal.error.includes('Duplicate'), 'Error message mentions Duplicate');
  assert(model.toPayloads(anchors).length === 1, 'Duplicate connection excluded from payloads');

  // Remove duplicate
  model.removeDraft(draft2.id);
  assert(model.drafts.length === 1, 'Duplicate draft removed');
}

// ---------------------------------------------------------------------------
// Test 3: Anchor Drops Cascade Behavior
// ---------------------------------------------------------------------------
console.log('\nTest 3: Anchor Drops Cascade Behavior');
{
  let currentAnchors = [
    { client_key: 'a_dam', label: 'דַּם (dam)' },
    { client_key: 'a_adam', label: 'הָאָדָם (ha·\'a·dam)' },
  ];
  let changeFired = 0;

  const builder = createConnectionBuilder({
    getAnchors: () => currentAnchors,
    onChange: () => { changeFired++; },
  });
  await sleep(50);

  // Set 1 connection
  builder.setConnections([
    { from: 'a_dam', to: 'a_adam', connection_type: 'contained_in', direction: 'directed' },
  ]);
  assert(builder.getConnections().length === 1, '1 connection restored');

  // Now remove 'a_adam' anchor
  currentAnchors = [{ client_key: 'a_dam', label: 'דַּם (dam)' }];
  builder.refreshAnchors();

  assert(builder.getConnections().length === 0, 'Connection referencing dropped anchor was dropped');
}

// ---------------------------------------------------------------------------
// Test 4: UI Rows, Live Preview Chip, and BIDI Arrow (TP-BIDI-1)
// ---------------------------------------------------------------------------
console.log('\nTest 4: UI Rows, Live Preview Chip, and BIDI Arrow (TP-BIDI-1)');
{
  const anchors = [
    { client_key: 'a_dam', label: 'דַּם' },
    { client_key: 'a_adam', label: 'הָאָדָם' },
  ];

  let lastPayloads = [];
  const builder = createConnectionBuilder({
    getAnchors: () => anchors,
    onChange: (p) => { lastPayloads = p; },
  });
  await sleep(50);

  const addBtn = builder.element.querySelector('button.connection-add-btn');
  assert(addBtn !== null, '+ Add connection button exists');
  assert(!addBtn.disabled, '+ Add connection button enabled when >= 2 anchors');

  // Click Add connection
  addBtn.click();
  await sleep(20);

  const row = builder.element.querySelector('.connection-row');
  assert(row !== null, 'Connection row element created in DOM');

  // Verify preview chip
  const chip = row.querySelector('.note-connection-chip');
  assert(chip !== null, 'Connection row has .note-connection-chip preview');
  assert(chip.getAttribute('dir') === 'ltr', 'Preview chip has dir="ltr" wrapper');

  const endpoints = chip.querySelectorAll('.note-connection-chip__endpoint');
  assert(endpoints.length === 2, 'Preview chip has 2 endpoints');
  assert(endpoints[0].querySelector('bdi').textContent === 'דַּם', 'Source endpoint is דַּם wrapped in bdi');
  assert(endpoints[1].querySelector('bdi').textContent === 'הָאָדָם', 'Target endpoint is הָאָדָם wrapped in bdi');

  const arrow = chip.querySelector('.note-connection-chip__arrow');
  assert(arrow !== null, 'Preview chip arrow exists');
  assert(arrow.textContent === '→', 'Directed arrow displays →');

  // Change connection type to contained_in
  const typeSel = row.querySelector('.connection-select--type');
  assert(typeSel !== null, 'Type select exists');
  typeSel.value = 'contained_in';
  typeSel.dispatchEvent({ type: 'change' });
  await sleep(20);

  const row2 = builder.element.querySelector('.connection-row');
  const chip2 = row2.querySelector('.note-connection-chip');
  const chipLabel = chip2.querySelector('.note-connection-chip__label');
  assert(chipLabel.textContent === 'is contained in', 'Preview label updated to "is contained in"');

  // Verify preview chip represents "דַּם —is contained in→ הָאָדָם"
  assert(chip2.textContent.includes('דַּם'), 'Chip contains דַּם');
  assert(chip2.textContent.includes('הָאָדָם'), 'Chip contains הָאָדָם');
  assert(chip2.textContent.includes('is contained in'), 'Chip contains is contained in');

  // Custom label mode
  const typeSel2 = row2.querySelector('.connection-select--type');
  typeSel2.value = '__custom__';
  typeSel2.dispatchEvent({ type: 'change' });
  await sleep(20);

  const row3 = builder.element.querySelector('.connection-row');
  const chip3 = row3.querySelector('.note-connection-chip');
  const customInput = row3.querySelector('.connection-input--custom');
  assert(!customInput.hidden, 'Custom label input is visible when __custom__ is selected');
  customInput.value = 'wordplay on';
  customInput.dispatchEvent({ type: 'input' });
  await sleep(20);

  const row4 = builder.element.querySelector('.connection-row');
  const chip4 = row4.querySelector('.note-connection-chip');
  assert(chip4.querySelector('.note-connection-chip__label').textContent === 'wordplay on', 'Preview label displays custom label');

  // Test reverse direction button in UI
  const dirBtns = row4.querySelectorAll('.connection-direction__btn');
  assert(dirBtns.length === 4, '4 direction buttons (→, ←, ↔, —)');
  const revBtn = dirBtns[1]; // ←
  revBtn.click();
  await sleep(20);

  const row5 = builder.element.querySelector('.connection-row');
  const chip5 = row5.querySelector('.note-connection-chip');
  // In preview, direction is reverse (displays ←)
  assert(chip5.querySelector('.note-connection-chip__arrow').textContent === '←', 'Reverse preview displays ←');

  // In payload, endpoints are swapped to a_adam -> a_dam with direction directed
  const connections = builder.getConnections();
  assert(connections.length === 1, '1 connection in payload');
  assert(connections[0].from === 'a_adam', 'Payload swapped from to a_adam');
  assert(connections[0].to === 'a_dam', 'Payload swapped to to a_dam');
  assert(connections[0].direction === 'directed', 'Payload direction is directed');
  assert(connections[0].custom_label === 'wordplay on', 'Payload contains custom_label');

  // Explanation textarea
  const exp = row5.querySelector('.connection-textarea');
  assert(exp !== null, 'Explanation textarea exists');
  exp.value = 'Dam (blood) is consonantly contained within Adam (man).';
  exp.dispatchEvent({ type: 'input' });
  await sleep(20);

  const updatedConn = builder.getConnections()[0];
  assert(updatedConn.explanation.includes('Dam (blood) is consonantly contained'), 'Explanation saved in payload');

  // Delete row
  const row6 = builder.element.querySelector('.connection-row');
  const delBtn = row6.querySelector('.connection-row__remove');
  assert(delBtn !== null, 'Remove button exists');
  delBtn.click();
  await sleep(20);

  assert(builder.getConnections().length === 0, 'Connection removed on click delete');
  assert(builder.element.querySelectorAll('.connection-row').length === 0, 'Row removed from DOM');
}

console.log(`\nAll ${assertionsPassed} assertions passed successfully!`);
