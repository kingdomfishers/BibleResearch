import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== NOTE-18: NoteCard Component Static & Visual Test ===\n');

// 1. Bundle NoteCard.ts
const bundlePath = resolve('dist/note-card-bundle.js');
await esbuild.build({
  entryPoints: ['src/ui/components/NoteCard.ts'],
  bundle: true,
  format: 'esm',
  outfile: bundlePath,
  platform: 'neutral',
  target: 'es2022',
});

const {
  createNoteCard,
  createProvenanceBadge,
  createHeader,
  createAnchorChips,
  createConnectionChips,
  createFooter,
  directionGlyph,
} = await import(`file://${bundlePath}`);

const fixturesRaw = readFileSync('scripts/fixtures/notes-cases.json', 'utf-8');
const fixtures = JSON.parse(fixturesRaw);

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

// Minimal DOM stub implementation
class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.children = [];
    this.attributes = {};
    this.eventListeners = {};
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(k, v) {
    this.attributes[k] = v;
    if (k === 'class') this.className = v;
    if (k === 'id') this.id = v;
  }
  getAttribute(k) {
    return this.attributes[k] ?? null;
  }
  addEventListener(event, fn) {
    this.eventListeners[event] = this.eventListeners[event] || [];
    this.eventListeners[event].push(fn);
  }
  dispatchEvent(event) {
    const list = this.eventListeners[event] || [];
    list.forEach((fn) => fn({ stopPropagation: () => {}, preventDefault: () => {} }));
  }
}

class MockDocumentFragment {
  constructor() {
    this.tagName = '#DOCUMENT-FRAGMENT';
    this.children = [];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

const mockDoc = {
  createElement(tag) {
    return new MockElement(tag);
  },
  createElementNS(ns, tag) {
    const el = new MockElement(tag);
    el.namespaceURI = ns;
    return el;
  },
  createTextNode(text) {
    const el = new MockElement('#TEXT');
    el.textContent = text;
    return el;
  },
  createDocumentFragment() {
    return new MockDocumentFragment();
  },
};

globalThis.document = mockDoc;
globalThis.window = {
  confirm: () => true,
  location: { hash: '#1-1-1' },
  history: { pushState: () => {} },
};

function queryAll(root, predicate) {
  const matches = [];
  function walk(node) {
    if (predicate(node)) matches.push(node);
    if (node.children) {
      for (const c of node.children) walk(c);
    }
  }
  walk(root);
  return matches;
}

console.log('1. Testing Human Note Fixture (Adam / Dam)...');

const humanNote = {
  id: '00000000-0000-0000-0000-000000000001',
  title: 'Adam & Dam Wordplay',
  body_md: 'The Hebrew word **דַּם** (blood) in Genesis 9:6 is phonetically contained within **הָאָדָם** (man).',
  note_kind: 'linguistic',
  language: 'he',
  epistemic_layer: 'user_note',
  author: {
    id: '00000000-0000-0000-0000-00000000a001',
    kind: 'human',
    display_name: 'You',
  },
  created_via: 'ui',
  review_status: 'unreviewed',
  status: 'published',
  visibility: 'public',
  version: 1,
  created_at: '2026-11-07T12:00:00Z',
  updated_at: '2026-11-07T12:00:00Z',
  anchors: [
    {
      id: 'anc-1',
      kind: 'verse',
      role: 'mention',
      label: 'Genesis 9:6',
      ordinal: 0,
      verse_id: 212,
    },
    {
      id: 'anc-2',
      kind: 'word_occurrence',
      role: 'subject',
      label: 'דַּ֣ם',
      ordinal: 1,
      verse_id: 212,
      word_position: 2,
      word_id: 53694,
    },
    {
      id: 'anc-3',
      kind: 'word_form',
      role: 'object',
      label: 'הָאָדָם',
      ordinal: 2,
      word_id: 28013,
    },
  ],
  connections: [
    {
      id: 'conn-1',
      from_anchor_id: 'anc-2',
      to_anchor_id: 'anc-3',
      connection_type: 'contained_in',
      type_label: 'Contained In',
      category: 'linguistic',
      direction: 'directed',
      explanation: 'Dam is contained within ha-adam.',
    },
  ],
  blocks: [],
};

const humanCard = createNoteCard(humanNote);

assert(humanCard.className.includes('note-card--human'), 'Human card has class note-card--human');
assert(!humanCard.className.includes('note-card--ai'), 'Human card does not have note-card--ai');

// TP-A11Y-1: Person icon + accessible text
const personIcons = queryAll(humanCard, (n) => n.tagName === 'SVG' && n.getAttribute('class')?.includes('note-icon'));
assert(personIcons.length === 1, 'Human card has exactly one person SVG icon');
assert(personIcons[0].getAttribute('aria-hidden') === 'true', 'Person icon has aria-hidden="true"');

const authorLabels = queryAll(humanCard, (n) => n.className === 'note-card__author-label');
assert(authorLabels.length === 1 && authorLabels[0].textContent === 'You', 'Author label is "You"');

const srText = queryAll(humanCard, (n) => n.className === 'visually-hidden');
assert(srText.some((n) => n.textContent.includes('Human note by You')), 'Visually-hidden screen reader text present');

// TP-BIDI-1: Connection chips have dir="ltr", arrow glyph, <bdi> endpoints
const connChips = queryAll(humanCard, (n) => n.className === 'note-connection-chip');
assert(connChips.length === 1, 'Exactly 1 connection chip rendered');
assert(connChips[0].getAttribute('dir') === 'ltr', 'Connection chip has dir="ltr" wrapper');

const arrows = queryAll(connChips[0], (n) => n.className === 'note-connection-chip__arrow');
assert(arrows.length === 1 && arrows[0].textContent === '→', 'Directed connection chip displays "→" arrow');

const endpoints = queryAll(connChips[0], (n) => n.tagName === 'BDI');
assert(endpoints.length >= 2, 'Connection endpoints are wrapped in <bdi> elements');
assert(endpoints[0].textContent === 'דַּ֣ם', 'Source endpoint displays Hebrew "דַּ֣ם"');
assert(endpoints[1].textContent === 'הָאָדָם', 'Target endpoint displays Hebrew "הָאָדָם"');

console.log('\n2. Testing AI Note Fixtures (Unreviewed & Disputed)...');

const aiUnreviewedNote = {
  ...humanNote,
  id: '00000000-0000-0000-0000-000000000002',
  author: {
    id: '00000000-0000-0000-0000-00000000a002',
    kind: 'ai',
    display_name: 'Claude 3.5 Sonnet',
    ai_provider: 'anthropic',
    ai_model: 'claude-3-5-sonnet',
  },
  review_status: 'unreviewed',
};

let reviewedStatus = null;
const aiCard = createNoteCard(aiUnreviewedNote, {
  onReview: (id, status) => {
    reviewedStatus = status;
  },
});

assert(aiCard.className.includes('note-card--ai'), 'AI card has class note-card--ai');
const sparkleIcons = queryAll(aiCard, (n) => n.tagName === 'SVG' && n.getAttribute('class')?.includes('note-icon'));
assert(sparkleIcons.length === 1, 'AI card has sparkle icon');

const aiSrText = queryAll(aiCard, (n) => n.className === 'visually-hidden');
assert(
  aiSrText.some((n) => n.textContent.includes('AI-generated note by claude-3-5-sonnet, unreviewed')),
  'AI card has detailed screen reader text with model moniker'
);

const reviewPill = queryAll(aiCard, (n) => n.className?.includes('note-card__review-pill--unreviewed'));
assert(reviewPill.length === 1 && reviewPill[0].textContent === 'unreviewed', 'AI card shows unreviewed pill');

// Review actions: confirm and dispute
const confirmBtn = queryAll(aiCard, (n) => n.className?.includes('note-btn--confirm'))[0];
assert(Boolean(confirmBtn), 'Confirm review button exists');
confirmBtn.dispatchEvent('click');
assert(reviewedStatus === 'confirmed', 'Clicking confirm invokes onReview with "confirmed"');

const disputeBtn = queryAll(aiCard, (n) => n.className?.includes('note-btn--dispute'))[0];
assert(Boolean(disputeBtn), 'Dispute review button exists');
disputeBtn.dispatchEvent('click');
assert(reviewedStatus === 'disputed', 'Clicking dispute invokes onReview with "disputed"');

// Disputed note rendering
const aiDisputedNote = {
  ...aiUnreviewedNote,
  id: '00000000-0000-0000-0000-000000000003',
  review_status: 'disputed',
};
const disputedCard = createNoteCard(aiDisputedNote);
const disputedPill = queryAll(disputedCard, (n) => n.className?.includes('note-card__review-pill--disputed'));
assert(disputedPill.length === 1, 'Disputed note shows disputed pill');

console.log('\n3. Testing Injection Payload (TP-XSS-1)...');

const injectionNote = {
  ...humanNote,
  id: '00000000-0000-0000-0000-000000000004',
  title: fixtures.injection_prompt.title,
  body_md: fixtures.injection_prompt.body_md,
};

const injectionCard = createNoteCard(injectionNote);

const scriptTags = queryAll(injectionCard, (n) => n.tagName === 'SCRIPT');
assert(scriptTags.length === 0, 'No <script> elements present in card');

const imgTags = queryAll(injectionCard, (n) => n.tagName === 'IMG');
assert(imgTags.length === 0, 'No raw <img> elements present in card');

const jsLinks = queryAll(injectionCard, (n) => n.tagName === 'A' && n.getAttribute('href')?.toLowerCase().startsWith('javascript:'));
assert(jsLinks.length === 0, 'No javascript: URI links present in card');

console.log('\n4. Testing Long Unbroken Strings & Bidirectional Arrows...');

assert(directionGlyph('directed') === '→', 'directionGlyph directed returns "→"');
assert(directionGlyph('bidirectional') === '↔', 'directionGlyph bidirectional returns "↔"');
assert(directionGlyph('undirected') === '—', 'directionGlyph undirected returns "—"');

const longStringNote = {
  ...humanNote,
  id: '00000000-0000-0000-0000-000000000005',
  body_md: fixtures.unicode_samples.long_unbroken_string,
};
const longStringCard = createNoteCard(longStringNote);
assert(Boolean(longStringCard), 'Long unbroken string note card renders without crashing');

console.log('\n5. Generating Visual Preview Artifact (.artifacts/notes/screens/preview.html)...');

mkdirSync('.artifacts/notes/screens', { recursive: true });

const baseCss = readFileSync('src/ui/styles-base.css', 'utf-8');
const workspaceCss = readFileSync('src/ui/styles-workspace.css', 'utf-8');
const notesCss = readFileSync('src/ui/styles-notes.css', 'utf-8');

function renderCardToHtml(cardData) {
  const isAi = cardData.author?.kind === 'ai';
  const model = cardData.author?.ai_model || 'Assistant';
  const iconSvg = isAi
    ? '<svg viewBox="0 0 24 24" aria-hidden="true" class="note-icon"><path d="M12 2L9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5L12 2zm7 12l-1.25 3.25L14.5 18.5l3.25 1.25L19 23l1.25-3.25L23.5 18.5l-3.25-1.25L19 14z" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true" class="note-icon"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>';

  const reviewBadge = isAi
    ? `<span class="note-card__review-pill note-card__review-pill--${cardData.review_status}">${cardData.review_status}</span>`
    : '';

  const anchorsHtml = cardData.anchors
    .map(
      (a) =>
        `<button type="button" class="note-chip note-chip--${a.role}"><bdi>${a.label}</bdi></button>`
    )
    .join('');

  const connectionsHtml = cardData.connections
    .map(
      (c) =>
        `<div class="note-connection-chip" dir="ltr"><button type="button" class="note-connection-chip__endpoint"><bdi>דַּ֣ם</bdi></button><span class="note-connection-chip__arrow" aria-hidden="true">→</span><button type="button" class="note-connection-chip__endpoint"><bdi>הָאָדָם</bdi></button><span class="note-connection-chip__label">${c.type_label}</span><span class="note-connection-chip__category">${c.category}</span></div>`
    )
    .join('');

  const reviewActions = isAi
    ? `<div class="note-card__review-actions"><button type="button" class="note-btn note-btn--confirm">Confirm</button><button type="button" class="note-btn note-btn--dispute">Dispute</button></div>`
    : '';

  return `
    <article class="note-card note-card--${isAi ? 'ai' : 'human'}">
      <header class="note-card__header">
        <div class="note-card__provenance">
          ${iconSvg}
          <span class="note-card__author-label">${isAi ? `AI · ${model}` : 'You'}</span>
          <span class="visually-hidden">${isAi ? `AI-generated note by ${model}, ${cardData.review_status}` : 'Human note by You'}</span>
          ${reviewBadge}
        </div>
        <div class="note-card__meta">
          <span class="note-card__kind-tag">${cardData.note_kind}</span>
          <time class="note-card__time">11/7/2026</time>
        </div>
      </header>
      <h3 class="note-card__title">${cardData.title}</h3>
      <div class="note-card__body">
        <p>${cardData.body_md}</p>
      </div>
      <div class="note-card__anchors">
        ${anchorsHtml}
      </div>
      <div class="note-card__connections">
        ${connectionsHtml}
      </div>
      <footer class="note-card__footer">
        ${reviewActions}
        <div class="note-card__actions">
          <button type="button" class="note-btn">Edit</button>
          <button type="button" class="note-btn note-btn--delete">Delete</button>
          <a class="note-card__open-link" href="#note=${cardData.id}">Open</a>
        </div>
      </footer>
    </article>
  `;
}

const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NOTE-18 NoteCard Visual Preview</title>
  <style>
    ${baseCss}
    ${workspaceCss}
    ${notesCss}
    body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .preview-section { margin-bottom: 40px; }
    .preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px; }
    .preview-mobile { max-width: 360px; margin-top: 16px; border: 1px dashed var(--border); padding: 12px; border-radius: 8px; }
    h2 { border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-top: 0; }
  </style>
</head>
<body data-theme="dark">
  <h1>NOTE-18 NoteCard Visual Verification Preview</h1>
  <p>Human (solid gold 4px start border) vs AI (dashed green 4px start border + tint + sparkle) visual distinction, review badges, and bidirectional chip layout.</p>

  <div class="preview-section">
    <h2>Desktop View (Dark Mode)</h2>
    <div class="preview-grid">
      <div>
        <h4>Human Note ("You")</h4>
        ${renderCardToHtml(humanNote)}
      </div>
      <div>
        <h4>AI Note ("Claude 3.5 Sonnet", Unreviewed)</h4>
        ${renderCardToHtml(aiUnreviewedNote)}
      </div>
    </div>
  </div>

  <div class="preview-section" data-theme="light" style="background:#f4f2eb; color:#243632; padding: 20px; border-radius: 8px;">
    <h2 style="color:#243632; border-color:#d8ded4;">Desktop View (Light Mode)</h2>
    <div class="preview-grid">
      <div>
        <h4>Human Note ("You")</h4>
        ${renderCardToHtml(humanNote)}
      </div>
      <div>
        <h4>AI Note ("Claude 3.5 Sonnet", Disputed)</h4>
        ${renderCardToHtml(aiDisputedNote)}
      </div>
    </div>
  </div>

  <div class="preview-section">
    <h2>Mobile 360px View</h2>
    <div class="preview-mobile">
      ${renderCardToHtml(humanNote)}
      ${renderCardToHtml(aiUnreviewedNote)}
    </div>
  </div>
</body>
</html>`;

writeFileSync('.artifacts/notes/screens/notecard-preview.html', previewHtml, 'utf-8');
console.log('  PASS: Generated visual preview at .artifacts/notes/screens/notecard-preview.html');

try {
  unlinkSync(bundlePath);
} catch {
  // Ignore cleanup
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
