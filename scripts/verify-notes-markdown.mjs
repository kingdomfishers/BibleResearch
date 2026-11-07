import esbuild from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== NOTE-17: Notes State & Safe Markdown Test ===\n');

// 1. Bundle note-markdown.ts and notes-state.ts using installed esbuild
const bundlePath = resolve('dist/verify-notes-markdown-bundle.mjs');
await esbuild.build({
  entryPoints: ['src/ui/note-markdown.ts', 'src/ui/notes-state.ts'],
  bundle: true,
  format: 'esm',
  outdir: 'dist',
  entryNames: '[name]-bundle',
  platform: 'neutral',
  target: 'es2022',
});

const mdModulePath = resolve('dist/note-markdown-bundle.js');
const stateModulePath = resolve('dist/notes-state-bundle.js');

const { parseMarkdown, parseInlines, isSafeHttpUrl, renderMarkdown } = await import(`file://${mdModulePath}`);
const {
  notesState,
  loadFilters,
  saveFilters,
  parseNoteHash,
  buildNoteHash,
  noteIdFromHash,
  DEFAULT_FILTERS,
} = await import(`file://${stateModulePath}`);

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

// Helper to collect all inline nodes recursively
function collectInlines(nodes) {
  const inlines = [];
  function walkInlines(arr) {
    for (const item of arr) {
      inlines.push(item);
      if (item.children) walkInlines(item.children);
    }
  }
  for (const block of nodes) {
    if (block.children && Array.isArray(block.children)) {
      if (block.type === 'blockquote') {
        inlines.push(...collectInlines(block.children));
      } else {
        walkInlines(block.children);
      }
    }
    if (block.type === 'list') {
      for (const item of block.items) {
        walkInlines(item);
      }
    }
  }
  return inlines;
}

console.log('1. Testing TP-XSS-1 Corpus (≥ 25 payloads)...');

const xssCorpus = [
  { name: 'script tag', payload: '<script>alert("xss")</script>' },
  { name: 'img onerror', payload: '<img src=x onerror=alert(1)>' },
  { name: 'javascript link', payload: '[click me](javascript:alert(1))' },
  { name: 'data link', payload: '[click me](data:text/html,<script>alert(1)</script>)' },
  { name: 'protocol-relative link', payload: '[click me](//evil.com/hack)' },
  { name: 'uppercase https link', payload: '[valid](HTTPS://ok.com/resource)', shouldBeLink: true },
  { name: 'standard http link', payload: '[valid](http://example.com?a=1&b=2)', shouldBeLink: true },
  { name: 'vbscript link', payload: '[click](vbscript:msgbox(1))' },
  { name: 'file link', payload: '[file](file:///etc/passwd)' },
  { name: 'newline javascript link', payload: '[click](javascript://%0aalert(1))' },
  { name: 'uppercase JAVASCRIPT scheme', payload: '[click](JAVASCRIPT:alert(1))' },
  { name: 'whitespace padded javascript link', payload: '[click](   javascript:alert(1)   )' },
  { name: 'svg onload', payload: '<svg onload=alert(1)>' },
  { name: 'body onload', payload: '<body onload=alert(1)>' },
  { name: 'iframe javascript', payload: '<iframe src="javascript:alert(1)">' },
  { name: 'html entities script', payload: '&lt;script&gt;alert(1)&lt;/script&gt;' },
  { name: 'unterminated link url', payload: '[unterminated](https://example.com' },
  { name: 'unterminated link text', payload: '[unterminated(https://example.com)' },
  { name: 'unterminated bold', payload: '**bold text without ending' },
  { name: 'unterminated italic', payload: '*italic text without ending' },
  { name: 'unterminated inline code', payload: '`inline code without ending' },
  { name: 'unterminated fenced code', payload: '```typescript\nconst x = 1;\nno ending fence' },
  { name: 'deeply nested quotes', payload: '> > > > > > > deeply nested blockquote' },
  { name: 'deeply nested list', payload: '- item 1\n- item 2\n- item 3' },
  { name: 'CRLF formatting', payload: '# Heading\r\nParagraph with CRLF\r\n- List item\r\n' },
  { name: 'Hebrew text', payload: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים' },
  { name: 'Greek text', payload: 'Ἐν ἀρχῇ ἦν ὁ λόγος' },
  { name: 'Mixed script and tags', payload: '<marquee>בָּרָא</marquee> [test](javascript:void(0))' },
];

assert(xssCorpus.length >= 25, `Corpus contains ${xssCorpus.length} payloads (>= 25 required)`);

for (const testCase of xssCorpus) {
  const ast = parseMarkdown(testCase.payload);
  const inlines = collectInlines(ast);
  const links = inlines.filter((n) => n.type === 'link');

  if (testCase.shouldBeLink) {
    assert(links.length === 1 && /^https?:\/\//i.test(links[0].url), `Payload "${testCase.name}" parsed valid http(s) link`);
  } else {
    assert(links.length === 0, `Payload "${testCase.name}" produces ZERO link nodes (no XSS scheme)`);
  }
}

console.log('\n2. Testing Pathological & Performance Constraints...');

// 100k char input
const largePayload = 'A'.repeat(100000);
const startPerf = performance.now();
const largeAst = parseMarkdown(largePayload);
const durationMs = performance.now() - startPerf;

assert(durationMs < 50, `100k-char payload parsed in ${durationMs.toFixed(2)} ms (< 50 ms required)`);
assert(largeAst.length === 1 && largeAst[0].type === 'paragraph', '100k-char payload parsed into single paragraph');
const largeText = largeAst[0].children[0].text;
assert(largeText.length === 20000, `Input capped at exactly 20,000 characters (got ${largeText.length})`);

// Idempotency
const sampleText = '# Title\n\n**Bold** and *italic* and `code`\n\n> Quote\n\n- Item 1\n- Item 2';
const parse1 = JSON.stringify(parseMarkdown(sampleText));
const parse2 = JSON.stringify(parseMarkdown(sampleText));
assert(parse1 === parse2, 'Repeated parse is 100% idempotent');

// Hebrew and Greek preservation
const hebrewInput = 'דַּם שֹׁפֵךְ דַּם הָאָדָם';
const hebrewAst = parseMarkdown(hebrewInput);
assert(
  hebrewAst[0]?.children?.[0]?.text === hebrewInput,
  'Hebrew consonants and niqqud preserved verbatim in AST'
);

const greekInput = 'Ἐν ἀρχῇ ἦν ὁ λόγος';
const greekAst = parseMarkdown(greekInput);
assert(
  greekAst[0]?.children?.[0]?.text === greekInput,
  'Greek polytonic accents and breathing marks preserved verbatim in AST'
);

console.log('\n3. Testing Mock DOM Rendering & BDI Isolation...');

// Create a minimal lightweight DOM mock to verify renderMarkdown without heavy browser dependencies
function createMockDoc() {
  class MockNode {
    constructor(nodeName) {
      this.nodeName = nodeName;
      this.children = [];
      this.attributes = {};
      this.textContent = '';
      this.className = '';
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  }

  class MockDocumentFragment extends MockNode {
    constructor() {
      super('#document-fragment');
    }
  }

  return {
    createElement(tag) {
      return new MockNode(tag.toUpperCase());
    },
    createTextNode(text) {
      const node = new MockNode('#text');
      node.textContent = text;
      return node;
    },
    createDocumentFragment() {
      return new MockDocumentFragment();
    },
  };
}

const mockDoc = createMockDoc();
const mixedText = 'Verse Genesis 9:6 contains דַּם and Greek λόγος in text.';
const mixedAst = parseMarkdown(mixedText);
const renderedFrag = renderMarkdown(mixedAst, mockDoc);

assert(renderedFrag.children.length === 1, 'Rendered fragment contains paragraph');
const pElement = renderedFrag.children[0];
assert(pElement.nodeName === 'P', 'Root element is P');

// Find all BDI nodes created
const bdiNodes = pElement.children.filter((n) => n.nodeName === 'BDI');
assert(bdiNodes.length === 2, `Hebrew and Greek segments wrapped in BDI elements (got ${bdiNodes.length})`);
assert(bdiNodes[0].textContent === 'דַּם', `First BDI element contains Hebrew "${bdiNodes[0].textContent}"`);
assert(bdiNodes[1].textContent === 'λόγος', `Second BDI element contains Greek "${bdiNodes[1].textContent}"`);

// Verify link rendering security attributes
const linkAst = parseMarkdown('[Safe Site](https://example.com/study)');
const linkFrag = renderMarkdown(linkAst, mockDoc);
const aElement = linkFrag.children[0].children[0];
assert(aElement.nodeName === 'A', 'Link rendered as A tag');
assert(aElement.attributes.href === 'https://example.com/study', 'Link has correct safe href');
assert(aElement.attributes.rel === 'noopener noreferrer nofollow', 'Link has rel="noopener noreferrer nofollow"');
assert(aElement.attributes.target === '_blank', 'Link has target="_blank"');

console.log('\n4. Testing Notes State & Hash Parsing...');

// Hash parsing
const validUuid = '12345678-1234-4234-8234-123456789abc';
assert(parseNoteHash(`#note=${validUuid}`) === validUuid, 'parseNoteHash parses lowercase valid UUID');
assert(parseNoteHash(`#note=${validUuid.toUpperCase()}`) === validUuid, 'parseNoteHash normalizes uppercase UUID to lowercase');
assert(buildNoteHash(validUuid) === `#note=${validUuid}`, 'buildNoteHash outputs #note=<uuid>');
assert(noteIdFromHash(`#note=${validUuid}`) === validUuid, 'noteIdFromHash parses note hash parameter');

// Legacy hash unaffected
assert(parseNoteHash('#1-1-1') === null, 'Legacy passage hash #1-1-1 returns null');
assert(parseNoteHash('#43-3-16') === null, 'Legacy passage hash #43-3-16 returns null');
assert(parseNoteHash('#') === null, 'Empty hash returns null');
assert(parseNoteHash('#invalid-note=abc') === null, 'Malformed note hash returns null');

// LocalStorage tolerance
globalThis.window = {
  localStorage: {
    data: {},
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, val) {
      this.data[key] = val;
    },
  },
};

// Default load
assert(loadFilters().author === 'all', 'loadFilters() returns default author "all"');

// Corrupt JSON tolerance
globalThis.window.localStorage.setItem('notes.filters.v1', '{corrupt json...');
const fallbackFilters = loadFilters();
assert(fallbackFilters.author === 'all', 'Corrupt localStorage JSON falls back to default author');
assert(fallbackFilters.kind === null, 'Corrupt localStorage JSON falls back to default kind');

// Valid persistence
saveFilters({ author: 'ai', kind: 'theological', connectionType: 'typology' });
const loaded = loadFilters();
assert(loaded.author === 'ai', 'Saved author "ai" correctly reloaded');
assert(loaded.kind === 'theological', 'Saved kind "theological" correctly reloaded');
assert(loaded.connectionType === 'typology', 'Saved connectionType "typology" correctly reloaded');

console.log(`\nResults: ${passed} passed, ${failed} failed`);

try {
  unlinkSync(mdModulePath);
  unlinkSync(stateModulePath);
} catch {
  // Ignore cleanup failure
}

if (failed > 0) {
  process.exitCode = 1;
}
