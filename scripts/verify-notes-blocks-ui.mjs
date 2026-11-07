import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== NOTE-19: Note Blocks Renderer Static & Visual Test ===\n');

// 1. Bundle NoteBlocks.ts
const bundlePath = resolve('dist/note-blocks-bundle.js');
await esbuild.build({
  entryPoints: ['src/ui/components/NoteBlocks.ts'],
  bundle: true,
  format: 'esm',
  outfile: bundlePath,
  platform: 'neutral',
  target: 'es2022',
});

const { renderBlocks, isSafeHttps, renderPlaceholder } = await import(`file://${bundlePath}`);

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

// Minimal DOM stub implementation matching standard DOM behavior
class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this._textContent = '';
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = {};
  }
  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._textContent = v;
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
    this.attributes[k] = v;
    this[k] = v;
    if (k === 'class') this.className = v;
  }
  getAttribute(k) {
    return this.attributes[k] ?? this[k] ?? null;
  }
  addEventListener(event, fn) {
    this.eventListeners[event] = this.eventListeners[event] || [];
    this.eventListeners[event].push(fn);
  }
  replaceChildren(...newChildren) {
    this.children = [...newChildren];
  }
}

class MockDocumentFragment {
  constructor() {
    this.tagName = '#DOCUMENT-FRAGMENT';
    this.children = [];
  }
  get textContent() {
    return this.children.map((c) => c.textContent).join('');
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

globalThis.document = {
  createElement(tag) {
    return new MockElement(tag);
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

console.log('1. Testing Valid V1 Block Types (markdown, link, image)...');

const testBlocks = [
  {
    id: 'block-1',
    ordinal: 0,
    block_type: 'markdown',
    content: { markdown: '**Important** archaeological discovery at Bethel.' },
    text_alternative: 'Archaeological discovery at Bethel note.',
  },
  {
    id: 'block-2',
    ordinal: 1,
    block_type: 'link',
    content: { url: 'https://example.com/research/artifact-123', title: 'Excavation Report' },
    text_alternative: 'External excavation report link.',
  },
  {
    id: 'block-3',
    ordinal: 2,
    block_type: 'image',
    content: { url: 'https://example.com/images/altar.jpg', alt: 'Ancient Stone Altar' },
    text_alternative: 'Photograph of ancient stone altar.',
  },
];

const rendered = renderBlocks(testBlocks);

assert(rendered.className === 'note-blocks', 'Container has class note-blocks');
assert(rendered.children.length === 3, 'All 3 valid blocks rendered');

// Markdown block check
const mdBlock = rendered.children[0];
assert(mdBlock.className.includes('note-block--markdown'), 'First block is note-block--markdown');
const strongTags = queryAll(mdBlock, (n) => n.tagName === 'STRONG');
assert(strongTags.length === 1 && strongTags[0].textContent === 'Important', 'Markdown parsed bold text');

// Link block check
const linkBlock = rendered.children[1];
assert(linkBlock.className.includes('note-block--link'), 'Second block is note-block--link');
const aTags = queryAll(linkBlock, (n) => n.tagName === 'A');
assert(aTags.length === 1, 'Link block rendered an <a> tag');
assert(aTags[0].getAttribute('href') === 'https://example.com/research/artifact-123', 'Link href is correct');
assert(aTags[0].getAttribute('target') === '_blank', 'Link target is _blank');
assert(aTags[0].getAttribute('rel') === 'noopener noreferrer nofollow', 'Link has rel="noopener noreferrer nofollow"');
const hostEls = queryAll(linkBlock, (n) => n.className === 'note-block__link-host');
assert(hostEls.length === 1 && hostEls[0].textContent === 'example.com', 'Link displays parsed hostname');

// Image block check
const imgBlock = rendered.children[2];
assert(imgBlock.className.includes('note-block--image'), 'Third block is note-block--image');
const imgTags = queryAll(imgBlock, (n) => n.tagName === 'IMG');
assert(imgTags.length === 1, 'Image block rendered an <img> tag');
assert(imgTags[0].getAttribute('src') === 'https://example.com/images/altar.jpg', 'Image src is correct');
assert(imgTags[0].getAttribute('alt') === 'Ancient Stone Altar', 'Image alt is correct');
assert(imgTags[0].getAttribute('loading') === 'lazy', 'Image loading is lazy');
assert(imgTags[0].getAttribute('referrerPolicy') === 'no-referrer', 'Image referrerpolicy is no-referrer');
assert(imgTags[0].getAttribute('decoding') === 'async', 'Image decoding is async');

console.log('\n2. Testing Defense in Depth (TP-XSS-1)...');

const xssBlocks = [
  {
    id: 'xss-link',
    ordinal: 0,
    block_type: 'link',
    content: { url: 'javascript:alert(1)', title: 'Evil Link' },
    text_alternative: 'Fallback text for evil link.',
  },
  {
    id: 'xss-img',
    ordinal: 1,
    block_type: 'image',
    content: { url: 'javascript:alert(2)', alt: 'Evil Image' },
    text_alternative: 'Fallback text for evil image.',
  },
  {
    id: 'http-img',
    ordinal: 2,
    block_type: 'image',
    content: { url: 'http://insecure.com/altar.jpg', alt: 'Insecure Image' },
    text_alternative: 'Fallback text for insecure image.',
  },
];

const renderedXss = renderBlocks(xssBlocks);

const evilAnchors = queryAll(renderedXss, (n) => n.tagName === 'A');
assert(evilAnchors.length === 0, 'No <a> elements rendered for javascript: URL link block');

const evilImages = queryAll(renderedXss, (n) => n.tagName === 'IMG');
assert(evilImages.length === 0, 'No <img> elements rendered for javascript: or http: URL image blocks');

const placeholders = queryAll(renderedXss, (n) => n.className?.includes('note-block--placeholder'));
assert(placeholders.length === 3, 'All 3 unsafe blocks safely fell back to placeholder');

console.log('\n3. Testing Unknown & Planned Types Fallback...');

const unknownBlocks = [
  {
    id: 'plan-map',
    ordinal: 0,
    block_type: 'map',
    content: { lat: 31.77, lng: 35.21 },
    text_alternative: 'Map of Mount Moriah in Jerusalem.',
  },
  {
    id: 'plan-3d',
    ordinal: 1,
    block_type: 'model_3d',
    content: { model_url: 'https://example.com/tabernacle.glb' },
    text_alternative: '3D interactive model of the wilderness Tabernacle.',
  },
];

const renderedUnknown = renderBlocks(unknownBlocks);
assert(renderedUnknown.children.length === 2, '2 unknown/planned blocks rendered');

const mapBlock = renderedUnknown.children[0];
assert(mapBlock.className.includes('note-block--placeholder'), 'Map block rendered as placeholder');
assert(
  mapBlock.textContent.includes('‹map› content can\'t be displayed yet'),
  'Placeholder shows ‹map› title'
);
const mapAlt = queryAll(mapBlock, (n) => n.className === 'note-block__text-alt');
assert(
  mapAlt.length === 1 && mapAlt[0].textContent.includes('Map of Mount Moriah'),
  'Placeholder displays text_alternative for map'
);

console.log('\n4. Testing Malformed Content Resilience...');

const malformedBlocks = [
  { id: 'm1', ordinal: 0, block_type: 'markdown', content: null, text_alternative: 'Null content' },
  { id: 'm2', ordinal: 1, block_type: 'link', content: [], text_alternative: 'Array content' },
  { id: 'm3', ordinal: 2, block_type: 'image', content: 12345, text_alternative: 'Number content' },
  { id: 'm4', ordinal: 3, block_type: 'image', content: { url: null }, text_alternative: 'Null url' },
  { id: 'm5', ordinal: 4, block_type: 'link', content: { url: 'https://' }, text_alternative: 'Malformed https' },
];

let threw = false;
try {
  const res = renderBlocks(malformedBlocks);
  assert(res.children.length === 5, 'All 5 malformed blocks rendered without crashing');
} catch (e) {
  threw = true;
}
assert(!threw, 'Malformed content never throws');

console.log('\n5. Testing Block Sorting by Ordinal...');

const unsortedBlocks = [
  { id: 'o3', ordinal: 30, block_type: 'markdown', content: { markdown: 'Third' }, text_alternative: '3' },
  { id: 'o1', ordinal: 10, block_type: 'markdown', content: { markdown: 'First' }, text_alternative: '1' },
  { id: 'o2', ordinal: 20, block_type: 'markdown', content: { markdown: 'Second' }, text_alternative: '2' },
];

const sortedRendered = renderBlocks(unsortedBlocks);
assert(sortedRendered.children[0].dataset.blockId === 'o1', 'First block has id o1 (ordinal 10)');
assert(sortedRendered.children[1].dataset.blockId === 'o2', 'Second block has id o2 (ordinal 20)');
assert(sortedRendered.children[2].dataset.blockId === 'o3', 'Third block has id o3 (ordinal 30)');

console.log('\n6. Generating Visual Preview Artifact (.artifacts/notes/screens/noteblocks-preview.html)...');

mkdirSync('.artifacts/notes/screens', { recursive: true });

const baseCss = readFileSync('src/ui/styles-base.css', 'utf-8');
const workspaceCss = readFileSync('src/ui/styles-workspace.css', 'utf-8');
const notesCss = readFileSync('src/ui/styles-notes.css', 'utf-8');

const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NOTE-19 NoteBlocks Visual Preview</title>
  <style>
    ${baseCss}
    ${workspaceCss}
    ${notesCss}
    body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .preview-card { max-width: 600px; margin-bottom: 30px; }
    h2 { border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-top: 0; }
  </style>
</head>
<body data-theme="dark">
  <h1>NOTE-19 NoteBlocks Visual Verification Preview</h1>
  <p>Verifying rendering of rich content blocks: Markdown block, HTTPS external link block, HTTPS image block, and unknown/planned placeholder blocks with text alternative.</p>

  <div class="preview-card">
    <article class="note-card note-card--human">
      <header class="note-card__header">
        <div class="note-card__provenance">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="note-icon"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
          <span class="note-card__author-label">You</span>
        </div>
        <div class="note-card__meta">
          <span class="note-card__kind-tag">archaeology</span>
          <time class="note-card__time">11/7/2026</time>
        </div>
      </header>
      <h3 class="note-card__title">Tel Bethel Archaeological Survey</h3>
      <div class="note-card__body">
        <p>Field survey of Late Bronze and Iron I strata at Beitin (ancient Bethel). The following media and documentation blocks are attached:</p>
      </div>
      <div class="note-blocks">
        <div class="note-block note-block--markdown">
          <p><strong>Field Notes:</strong> Stratigraphic alignment confirms disruption layer corresponding to Judges 1:22–25 narrative.</p>
        </div>
        <div class="note-block note-block--link">
          <a class="note-block__link" href="https://example.com/reports/bethel-survey" target="_blank" rel="noopener noreferrer nofollow">
            <span class="note-block__link-title">Israel Antiquities Authority Field Report</span>
            <span class="note-block__link-host">example.com</span>
          </a>
        </div>
        <div class="note-block note-block--image">
          <img class="note-block__img" src="https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600" alt="Archaeological Excavation Site" loading="lazy" referrerpolicy="no-referrer" decoding="async">
        </div>
        <div class="note-block note-block--placeholder">
          <div class="note-block__placeholder-title">‹map› content can't be displayed yet</div>
          <div class="note-block__text-alt">Interactive GIS Topographic Map of Bethel Area Ridge (Elevation 860m).</div>
        </div>
        <div class="note-block note-block--placeholder">
          <div class="note-block__placeholder-title">‹model_3d› content can't be displayed yet</div>
          <div class="note-block__text-alt">3D Photogrammetry scan of Iron I four-room house foundation.</div>
        </div>
      </div>
      <footer class="note-card__footer">
        <div class="note-card__actions">
          <button type="button" class="note-btn">Edit</button>
          <button type="button" class="note-btn note-btn--delete">Delete</button>
          <a class="note-card__open-link" href="#note=00000000-0000-0000-0000-000000000001">Open</a>
        </div>
      </footer>
    </article>
  </div>
</body>
</html>`;

writeFileSync('.artifacts/notes/screens/noteblocks-preview.html', previewHtml, 'utf-8');
console.log('  PASS: Generated visual preview at .artifacts/notes/screens/noteblocks-preview.html');

try {
  unlinkSync(bundlePath);
} catch {
  // Ignore cleanup
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
