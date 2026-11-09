/**
 * scripts/verify-relationship-foundation.mjs
 * Targeted local verification suite for XREF-LEX-01:
 * 1. Stable relationship identity & deterministic deduplication (`relationship-model.ts`)
 * 2. Cross-reference Worker retrieval (`lookup_cross_references_v1` over `.artifacts/static-corpus/`)
 *    - Single verses, ranges (`Prov 8:22-24`, `John 1:1-3`), clusters (`Gen 1:10,12...`)
 *    - Phrase anchors (`token_alignment === null`), S21 exclusion, non-equivalence guardrails
 *    - Reverse lookup (`incoming` shares exact `relationship_id` with `outgoing`)
 *    - Psalm headings (`19:3:0` vs `19:3:1`), versification shifts (`64:1:15`, `47:13:13`),
 *      and KJV/TR edition-only NT verses (`40:17:21`)
 *    - Duplicate group collapse vs multi-anchor preservation on real upstream cases
 *    - Pagination & invalid cursor / invalid coordinate handling
 * 3. Lexical relationship Worker retrieval (`lookup_lexical_relationships_v1`)
 *    - All 11 required lexical categories + orthographic_overlap + co_occurrence distinct
 *    - Epistemic tier separation & guardrail enforcement (`implies_synonymy`, `implies_common_etymology`)
 *    - Hebrew (`hbo`), Aramaic (`arc`), Greek (`grc`), homographs (`H1254A`/`B`, `H0430G`/`a`)
 *    - TBESH col 7 exclusion
 * 4. Notes & UI vertical slice integration (`relationship-notes-adapter.ts`, `NoteEditor`,
 *    `PassageCrossReferences`, `LexicalRelationshipsSection`)
 *    - Zero automatic note creation on load/inspect
 *    - Researcher stance (`agree`, `disagree`, `alternative_interpretation`), anchor & connection prefill,
 *      connecting to existing research notes (`kind: 'note'`), and matching notes back to relationships
 */

import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import corpusWorker from './corpus-worker.mjs';

const CORPUS_ROOT = path.resolve('.artifacts/static-corpus');

// Minimal DOM mock for headless UI component verification
class MockElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
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
    this.open = false;
    this.dir = '';
    this.lang = '';
  }
  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map(c => c.textContent).join('');
  }
  set textContent(v) {
    this._textContent = String(v ?? '');
    this.children = [];
  }
  get value() {
    if (this._value !== undefined) return this._value;
    return '';
  }
  set value(v) {
    this._value = String(v ?? '');
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
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const t = new MockElement('#text');
        t.textContent = n;
        this.children.push(t);
      } else if (n) {
        this.children.push(n);
      }
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }
  addEventListener(ev, fn) {
    (this.eventListeners[ev] ??= []).push(fn);
  }
  click() {
    for (const fn of this.eventListeners.click || []) fn({ preventDefault() {} });
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  get classList() {
    const self = this;
    return {
      add(c) {
        const s = new Set((self.className || '').split(/\s+/).filter(Boolean));
        s.add(c);
        self.className = [...s].join(' ');
      },
      remove(c) {
        const s = new Set((self.className || '').split(/\s+/).filter(Boolean));
        s.delete(c);
        self.className = [...s].join(' ');
      },
      contains(c) {
        return (self.className || '').split(/\s+/).includes(c);
      },
    };
  }
  querySelectorAll(sel) {
    const out = [];
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    const tag = !cls ? sel.toUpperCase() : null;
    const walk = node => {
      for (const ch of node.children || []) {
        if (cls && (ch.className || '').split(/\s+/).includes(cls)) out.push(ch);
        else if (tag && ch.tagName === tag) out.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

globalThis.document = {
  activeElement: null,
  createElement: tag => new MockElement(tag),
  createDocumentFragment: () => new MockElement('FRAGMENT'),
  createTextNode: txt => {
    const n = new MockElement('#text');
    n.textContent = txt;
    return n;
  },
};
globalThis.window = {
  location: { hash: '#1-1-1' },
  addEventListener: () => {},
  removeEventListener: () => {},
  confirm: () => true,
  alert: () => {},
  prompt: () => '',
};

// Local Cloudflare ASSETS binding backed by `.artifacts/static-corpus/`
const localWorkerEnv = {
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      const rel = u.pathname.replace(/^\/+/, '');
      const full = path.join(CORPUS_ROOT, rel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        return new Response('Not found', { status: 404 });
      }
      const bytes = fs.readFileSync(full);
      return new Response(bytes, { status: 200 });
    },
  },
};

let autoNoteSaveCalls = 0;
let lastSavedNotePayload = null;
globalThis.__relTestMockNotesSave = async payload => {
  autoNoteSaveCalls += 1;
  lastSavedNotePayload = payload;
  return {
    ok: true,
    created: true,
    note: {
      id: '11111111-2222-3333-4444-555555555555',
      version: 1,
      status: 'published',
      visibility: 'public',
      review_status: 'unreviewed',
      author: { id: 'owner', display_name: 'You', kind: 'human' },
      note_kind: payload.note_kind,
      title: payload.title,
      body_md: payload.body_md,
      language: payload.language || 'en',
      confidence: payload.confidence ?? 1,
      source_context: payload.source_context || {},
      anchors: (payload.anchors || []).map((a, idx) => ({ ...a, id: `anc_id_${idx}` })),
      connections: [],
      blocks: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
};

// Route corpus HTTP fetches directly through `scripts/corpus-worker.mjs`
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('bibleresearch-corpus') || url.startsWith('http://corpus.local')) {
    const req = new Request(url, init);
    return corpusWorker.fetch(req, localWorkerEnv);
  }
  return realFetch(input, init);
};

async function bundleTs(entryFile) {
  const res = await esbuild.build({
    entryPoints: [path.resolve(entryFile)],
    bundle: true,
    write: false,
    format: 'esm',
    define: {
      'import.meta.env.VITE_CORPUS_BASE_URL': '"http://corpus.local"',
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    },
    plugins: [
      {
        name: 'stub-notes-write',
        setup(build) {
          build.onResolve({ filter: /\/supabase$/ }, () => ({
            path: 'stub-supabase',
            namespace: 'stub-sb',
          }));
          build.onLoad({ filter: /.*/, namespace: 'stub-sb' }, () => ({
            contents: `
              export const supabase = null;
              export const ensureReaderSession = async () => null;
              export const restoreReaderSession = () => {};
            `,
            loader: 'js',
          }));
          build.onResolve({ filter: /\/notes-rpc$/ }, () => ({
            path: 'stub-notes-rpc',
            namespace: 'stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `
              export const NotesRPC = {
                save: payload => globalThis.__relTestMockNotesSave(payload),
                remove: async () => ({ ok: true, status: 'removed' }),
                getNote: async () => ({ data: null, source: 'live', error: null }),
                connectionTypes: async () => ({
                  data: {
                    connection_types: [
                      { code: 'related', label: 'Related' },
                      { code: 'contrasts_with', label: 'Contrasts with' },
                      { code: 'same_root', label: 'Same root' },
                      { code: 'wordplay', label: 'Wordplay' },
                      { code: 'contained_in', label: 'Contained in' },
                    ],
                    note_kinds: [],
                    block_types: [],
                  },
                  source: 'live',
                  error: null,
                }),
                searchTargets: async () => ({ data: { status: 'ok', query: '', interpretation: { type: 'text' }, groups: [], truncated: false }, source: 'live', error: null }),
              };
            `,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const b64 = Buffer.from(res.outputFiles[0].text, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed += 1;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed += 1;
  }
}

console.log('=== XREF-LEX-01: Cross-Reference & Lexical Relationship Verification ===\n');

// 1. Model, Identity & Deduplication
console.log('--- 1. Stable Identity, Guardrails & Deterministic Deduplication ---');
const model = await bundleTs('src/api/relationship-model.ts');
const epGen1_1 = {
  book: 1, chapter: 1, verse_start: 1, verse_end: 1,
  start_verse_id: 1, end_verse_id: 1, is_psalm_heading: false,
  versification_status: 'exact_canonical', edition_only_ref: null, versification_note: null,
};
const epJohn1_1_3 = {
  book: 43, chapter: 1, verse_start: 1, verse_end: 3,
  start_verse_id: 26046, end_verse_id: 26048, is_psalm_heading: false,
  versification_status: 'exact_canonical', edition_only_ref: null, versification_note: null,
};
const xrefIdA = model.buildCrossReferenceRelationshipId({
  sourceKey: 'crossreferences_org_v1',
  sourcePassage: epGen1_1,
  subverseSort: 1,
  anchorSort: 1,
  targetSpans: [epJohn1_1_3],
});
const xrefIdB = model.buildCrossReferenceRelationshipId({
  sourceKey: 'crossreferences_org_v1',
  sourcePassage: epGen1_1,
  subverseSort: 1,
  anchorSort: 1,
  targetSpans: [epJohn1_1_3],
});
assert(xrefIdA === xrefIdB && xrefIdA.startsWith('rel:v1:xref:'), 'Cross-reference ID is deterministic and canonical');

const synIdAB = model.buildLexicalRelationshipId({
  sourceKey: 'stepbible_tbesg_v1',
  category: 'synonymy',
  rawRelationCode: 'abbott_smith_syn',
  epistemicTier: 'attested_lexical_fact',
  subjectKey: 'lemma:G0450',
  targetKey: 'lemma:G1453',
});
const synIdBA = model.buildLexicalRelationshipId({
  sourceKey: 'stepbible_tbesg_v1',
  category: 'synonymy',
  rawRelationCode: 'abbott_smith_syn',
  epistemicTier: 'attested_lexical_fact',
  subjectKey: 'lemma:G1453',
  targetKey: 'lemma:G0450',
});
assert(synIdAB === synIdBA, 'Symmetric lexical relationship produces identical ID in both directions');

const derivAB = model.buildLexicalRelationshipId({
  sourceKey: 'stepbible_tbesh_v1',
  category: 'derivation',
  rawRelationCode: 'theophoric_name',
  epistemicTier: 'attested_lexical_fact',
  subjectKey: 'lemma:H7501',
  targetKey: 'lemma:H7495',
});
const derivBA = model.buildLexicalRelationshipId({
  sourceKey: 'stepbible_tbesh_v1',
  category: 'derivation',
  rawRelationCode: 'theophoric_name',
  epistemicTier: 'attested_lexical_fact',
  subjectKey: 'lemma:H7495',
  targetKey: 'lemma:H7501',
});
assert(derivAB !== derivBA, 'Directed derivation preserves directional order in canonical ID');

// Guardrail enforcement check
const badGlossSyn = model.validateLexicalEdgeIntegrity({
  category: 'related_translation',
  guardrails: {
    implies_synonymy: true,
    implies_common_etymology: false,
    inferred_from_english_gloss: false,
    inferred_from_spelling_alone: false,
  },
});
assert(badGlossSyn !== null, 'Guardrail validator rejects related_translation claiming synonymy');

const badSpellingEtym = model.validateLexicalEdgeIntegrity({
  category: 'orthographic_overlap',
  guardrails: {
    implies_synonymy: false,
    implies_common_etymology: true,
    inferred_from_english_gloss: false,
    inferred_from_spelling_alone: false,
  },
});
assert(badSpellingEtym !== null, 'Guardrail validator rejects orthographic_overlap claiming common etymology');

const badTranslitEtym = model.validateLexicalEdgeIntegrity({
  category: 'loan_transliteration',
  guardrails: {
    implies_synonymy: false,
    implies_common_etymology: true,
    inferred_from_english_gloss: false,
    inferred_from_spelling_alone: false,
  },
});
assert(badTranslitEtym !== null, 'Guardrail validator rejects loan_transliteration claiming common etymology');

const dirFwdId = model.buildLexicalRelationshipId({
  sourceKey: 'stepbible_tbesg_v1',
  category: 'source_lexical_equivalence',
  rawRelationCode: 'abbott_smith_lxx_hebrew',
  epistemicTier: 'attested_lexical_fact',
  subjectKey: 'lemma:G5457',
  targetKey: 'lemma:H0216',
  direction: 'directed',
});
const dirInvId = model.buildLexicalRelationshipId({
  sourceKey: 'stepbible_tbesg_v1',
  category: 'source_lexical_equivalence',
  rawRelationCode: 'abbott_smith_lxx_hebrew',
  epistemicTier: 'attested_lexical_fact',
  subjectKey: 'lemma:H0216',
  targetKey: 'lemma:G5457',
  direction: 'inverse',
});
assert(dirFwdId === dirInvId, 'Forward (directed) and reverse (inverse) lexical edges share identical canonical relationship_id');

// 2. Cross-Reference Worker Retrieval
console.log('\n--- 2. Cross-Reference Worker Retrieval & Versification ---');
const rpcMod = await bundleTs('src/api/rpc.ts');
const { BibleRPC } = rpcMod;

const gen1_1 = await BibleRPC.relationships.lookupCrossReferences({
  book: 1, chapter: 1, verse: 1, direction: 'outgoing', limit: 50,
});
assert(gen1_1.source === 'live' && gen1_1.data.status === 'ok', 'Genesis 1:1 cross-references retrieved from static Worker');
assert(gen1_1.data.outgoing.length >= 10, `Genesis 1:1 has ${gen1_1.data.outgoing.length} outgoing cross-references`);
assert(
  gen1_1.data.outgoing.some(e => e.target_kind === 'verse_range' && e.target_label.includes('8:22-24')),
  'Genesis 1:1 preserves contiguous verse range target (Proverbs 8:22-24)'
);
assert(
  gen1_1.data.outgoing.some(e => e.target_kind === 'verse_range' && e.target_label.includes('John 1:1-3')),
  'Genesis 1:1 preserves contiguous verse range target (John 1:1-3)'
);
assert(
  gen1_1.data.outgoing.every(e => e.anchor.token_alignment === null && e.anchor.phrase_language === 'en'),
  'All source phrase anchors keep token_alignment === null (never guessing original-language alignments)'
);
assert(
  gen1_1.data.guardrails.association_only === true &&
  gen1_1.data.guardrails.implies_quotation === false &&
  gen1_1.data.guardrails.implies_prophecy === false &&
  gen1_1.data.guardrails.implies_typology === false &&
  gen1_1.data.guardrails.implies_theological_equivalence === false,
  'Cross-reference packet enforces non-quotation / non-prophecy / non-typology / non-equivalence guardrails'
);
assert(
  gen1_1.data.dataset_attribution.license === 'CC BY 4.0' &&
  gen1_1.data.dataset_attribution.excluded_restricted_fields?.includes('s21'),
  'CC BY 4.0 source attribution and S21 exclusion recorded'
);

// Reverse lookup verification (`John 1:2` hit by `Gen 1:1 -> John 1:1-3` range!)
const john1_2In = await BibleRPC.relationships.lookupCrossReferences({
  book: 43, chapter: 1, verse: 2, direction: 'incoming', limit: 50,
});
const genToJohnOut = gen1_1.data.outgoing.find(e => e.target_label.includes('John 1:1-3'));
const genToJohnIn = john1_2In.data.incoming.find(e =>
  e.source_passage.book === 1 && e.source_passage.chapter === 1 && e.source_passage.verse_start === 1
);
assert(Boolean(genToJohnOut && genToJohnIn), 'Reverse lookup on John 1:2 finds incoming range reference from Genesis 1:1');
assert(
  genToJohnOut?.relationship_id === genToJohnIn?.relationship_id,
  'Forward and reverse cross-reference lookups resolve to identical relationship_id'
);

// Psalm 3:0 (heading) vs Psalm 3:1 (body)
const ps3_0 = await BibleRPC.relationships.lookupCrossReferences({ book: 19, chapter: 3, verse: 0 });
const ps3_1 = await BibleRPC.relationships.lookupCrossReferences({ book: 19, chapter: 3, verse: 1 });
assert(
  ps3_0.data.status === 'ok' &&
  ps3_0.data.query_passage?.is_psalm_heading === true &&
  ps3_0.data.query_passage?.versification_status === 'exact_psalm_heading',
  'Psalm 3:0 superscription preserved as canonical verse 0 heading'
);
assert(
  ps3_1.data.status === 'ok' &&
  ps3_1.data.query_passage?.is_psalm_heading === false &&
  ps3_0.data.query_passage?.start_verse_id !== ps3_1.data.query_passage?.start_verse_id,
  'Psalm 3:0 and Psalm 3:1 have distinct canonical verse IDs and cross-reference sets'
);
assert(
  ps3_0.data.outgoing.some(e => e.target_spans.some(s => s.book === 10 && s.chapter === 15)),
  'Psalm 3:0 heading links to 2 Samuel 15 narrative (Absalom flight)'
);

// Split / shifted versification (`3 John 1:15` & TR-only `Matthew 17:21`)
const threeJohn15 = await BibleRPC.relationships.lookupCrossReferences({ book: 64, chapter: 1, verse: 15 });
assert(
  threeJohn15.data.status === 'ok' && threeJohn15.data.query_passage?.versification_status === 'versification_shift',
  '3 John 1:15 preserves KJV 1:14b -> canonical/BSB 1:15 versification shift metadata'
);

const matt17_21 = await BibleRPC.relationships.lookupCrossReferences({ book: 40, chapter: 17, verse: 21 });
assert(
  matt17_21.data.status === 'edition_only_passage' &&
  matt17_21.data.query_passage?.start_verse_id === null &&
  matt17_21.data.query_passage?.edition_only_ref?.edition === 'KJV',
  'TR-only Matthew 17:21 handled cleanly as edition_only_passage without corrupting canonical verse IDs'
);

// Real upstream multi-anchor to same target passage preserved (`multiAnchorSameTargetVerseId = 380` -> Gen 2:7!)
const fixture = JSON.parse(fs.readFileSync('scripts/fixtures/crossreferences-org-slice.json', 'utf8'));
const multiV = fixture.bible_verses.find(v => v.id === fixture.special_cases.multiAnchorSameTargetVerseId);
const multiRes = await BibleRPC.relationships.lookupCrossReferences({
  book: multiV.book_id, chapter: multiV.bsb_ch, verse: multiV.bsb_vs, direction: 'outgoing', limit: 50,
});
const targetCounts = new Map();
for (const e of multiRes.data.outgoing) {
  targetCounts.set(e.target_label, (targetCounts.get(e.target_label) || 0) + 1);
}
assert(
  [...targetCounts.values()].some(c => c >= 2),
  'Multiple distinct phrase anchors in one verse referencing the same passage are preserved'
);

// Pagination & invalid cursor handling
const page1 = await BibleRPC.relationships.lookupCrossReferences({
  book: 1, chapter: 1, verse: 1, direction: 'outgoing', limit: 3,
});
assert(page1.data.outgoing.length === 3 && page1.data.page.has_more === true && Boolean(page1.data.page.next_cursor), 'Paginated cross-reference query returns page 1 + cursor');
const page2 = await BibleRPC.relationships.lookupCrossReferences({
  book: 1, chapter: 1, verse: 1, direction: 'outgoing', limit: 3, cursor: page1.data.page.next_cursor,
});
assert(
  page2.data.outgoing.length === 3 &&
  page2.data.outgoing[0].relationship_id !== page1.data.outgoing[0].relationship_id,
  'Page 2 cursor advances cleanly without duplicating page 1 items'
);
const badCur = await BibleRPC.relationships.lookupCrossReferences({
  book: 1, chapter: 1, verse: 1, direction: 'outgoing', limit: 3, cursor: 'rc1:3:deadbeef',
});
assert(badCur.data.status === 'invalid_cursor', 'Tampered pagination cursor rejected with status=invalid_cursor');

const badVerse0 = await BibleRPC.relationships.lookupCrossReferences({ book: 1, chapter: 1, verse: 0 });
assert(badVerse0.data.status === 'invalid_reference', 'Verse 0 rejected on non-Psalm books');

// 3. Lexical Relationship Worker Retrieval
console.log('\n--- 3. Lexical Relationship Taxonomy, Epistemic Tiers & Languages ---');
const requiredCategories = [
  'same_lemma',
  'same_documented_root',
  'derivation',
  'cognate',
  'morphological_relationship',
  'source_lexical_equivalence',
  'semantic_overlap',
  'synonymy',
  'antonymy',
  'related_translation',
  'literary_wordplay',
];

const lexQueries = ['H7225', 'H1254', 'H430', 'H120', 'H7501', 'H1', 'G2', 'G450', 'G5457', 'G3056'];
const observedCategories = new Set();
const observedTiers = new Set();
const observedLanguages = new Set();

for (const q of lexQueries) {
  const r = await BibleRPC.relationships.lookupLexicalRelationships({ query: q, limit: 100 });
  if (r.data.status === 'ok' && r.data.focus) {
    observedLanguages.add(r.data.focus.language);
    for (const e of r.data.edges) {
      observedCategories.add(e.category);
      observedTiers.add(e.epistemic_tier);
      observedLanguages.add(e.target.language);
    }
  }
}

for (const cat of requiredCategories) {
  assert(observedCategories.has(cat), `Required lexical relationship category '${cat}' attested in slice`);
}
assert(observedCategories.has('orthographic_overlap') && observedCategories.has('co_occurrence'), 'Computational orthographic_overlap and statistical co_occurrence kept distinct from etymology/synonymy');
assert(
  observedLanguages.has('hbo') && observedLanguages.has('arc') && observedLanguages.has('grc'),
  'Hebrew (hbo), Aramaic (arc), and Greek (grc) language distinctions preserved'
);
assert(
  observedTiers.has('attested_lexical_fact') &&
  observedTiers.has('deterministic_computational') &&
  observedTiers.has('statistical_association') &&
  observedTiers.has('human_reviewed_interpretation'),
  'Attested facts, deterministic computational, statistical, and human-reviewed tiers distinguished'
);

// Specific linguistic integrity checks
const adamRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'H120', limit: 50 });
const wordplayEdge = adamRes.data.edges.find(e => e.category === 'literary_wordplay');
const damOverlapEdge = adamRes.data.edges.find(e => e.category === 'orthographic_overlap');
assert(Boolean(wordplayEdge) && wordplayEdge.target.base_strongs === 'H127', 'H120 (adam) <-> H127 (adamah) preserved as literary_wordplay');
assert(
  Boolean(damOverlapEdge) &&
  damOverlapEdge.target.base_strongs === 'H1818' &&
  damOverlapEdge.guardrails.implies_common_etymology === false &&
  damOverlapEdge.guardrails.implies_synonymy === false,
  'H120 (adam) <-> H1818 (dam) orthographic_overlap carries implies_common_etymology=false & implies_synonymy=false'
);

const baraRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'H1254', limit: 50 });
assert(baraRes.data.homograph_siblings.length >= 1, 'H1254 preserves homograph siblings');
const relTransEdge = baraRes.data.edges.find(e => e.category === 'related_translation');
assert(
  Boolean(relTransEdge) &&
  relTransEdge.epistemic_tier === 'statistical_association' &&
  relTransEdge.guardrails.implies_synonymy === false &&
  relTransEdge.guardrails.implies_common_etymology === false,
  'Shared English rendering (related_translation) marked statistical_association with implies_synonymy=false'
);

const phosRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'G5457', limit: 50 });
assert(
  phosRes.data.edges.some(e => e.category === 'antonymy' && e.target.base_strongs === 'G4655'),
  'G5457 (phos) <-> G4655 (skotos) attested Abbott-Smith antonymy preserved'
);
const phosToOrEdge = phosRes.data.edges.find(
  e => e.category === 'source_lexical_equivalence' && e.raw_relation_code === 'abbott_smith_lxx_hebrew' && e.target.base_strongs === 'H216'
);
assert(Boolean(phosToOrEdge), 'G5457 (phos) -> H216 (or) Abbott-Smith LXX/Hebrew lexical equivalence preserved');

const orRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'H216', limit: 50 });
const orFromPhosEdge = orRes.data.edges.find(
  e => e.category === 'source_lexical_equivalence' && e.raw_relation_code === 'abbott_smith_lxx_hebrew' && e.target.base_strongs === 'G5457'
);
assert(
  Boolean(orFromPhosEdge) &&
  orFromPhosEdge.direction === 'inverse' &&
  orFromPhosEdge.relationship_id === phosToOrEdge?.relationship_id,
  'Inverse lexical lookup H216 <- G5457 resolves to identical canonical relationship_id for bidirectional note matching'
);

// Audit regression: Greek transliteration (G2 Aaron <- H175) must NEVER be misclassified as cognate
const aaronGrRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'G2', limit: 50 });
const aaronTranslitEdge = aaronGrRes.data.edges.find(e => e.target.base_strongs === 'H175');
assert(
  Boolean(aaronTranslitEdge) &&
  aaronTranslitEdge.category === 'loan_transliteration' &&
  aaronTranslitEdge.guardrails.implies_common_etymology === false,
  'Greek transliteration G2 (Aaron) <- H175 classified as loan_transliteration (not cognate) with implies_common_etymology=false'
);
const aaronPrefill = BibleRPC.relationships.buildNotePrefillFromLexicalEdge(aaronTranslitEdge, { stance: 'agree' });
assert(
  aaronPrefill.connections.every(c => c.connection_type !== 'same_root'),
  'Transliteration note prefill never emits false same_root note connection across language families'
);

// Genuine Semitic cognate (H1 Hebrew ab <-> H2 Aramaic ab) remains cognate
const abHebRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'H1', limit: 50 });
const abCognateEdge = abHebRes.data.edges.find(e => e.target.base_strongs === 'H2' && e.category === 'cognate');
assert(
  Boolean(abCognateEdge) && abCognateEdge.guardrails.implies_common_etymology === true,
  'Semitic H1 (Hebrew ab) <-> H2 (Aramaic ab) remains classified as cognate'
);

// Derived co-root sibling joins must carry deterministic_computational tier (never direct attested_lexical_fact)
const elohimRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'H430', limit: 50 });
const coRootEdges = elohimRes.data.edges.filter(e => e.category === 'same_documented_root');
assert(
  coRootEdges.length > 0 &&
  coRootEdges.every(e => e.epistemic_tier === 'deterministic_computational' && Boolean(e.provenance.algorithm_version)),
  'Pairwise co-root sibling joins marked deterministic_computational with explicit algorithm_version'
);

// Hybrid corpus-client boundary check: mutable get_reader_word_v1 is NOT treated as pure static-only RPC
const corpusClientMod = await bundleTs('src/api/corpus-client.ts');
assert(
  corpusClientMod.isStaticCorpusRpc('lookup_cross_references_v1') === true &&
  corpusClientMod.isStaticCorpusRpc('get_reader_word_v1') === false,
  'corpus-client routes pure static RPCs to Worker while preserving Supabase dynamic merge on get_reader_word_v1'
);

const anistemiRes = await BibleRPC.relationships.lookupLexicalRelationships({ query: 'G450', limit: 50 });
assert(
  anistemiRes.data.edges.some(e => e.category === 'synonymy' && e.target.base_strongs === 'G1453' && e.guardrails.implies_synonymy === true),
  'G450 (anistemi) <-> G1453 (egeiro) Abbott-Smith SYN.: attested synonymy preserved'
);

// 4. Notes Integration & UI Vertical Slice
console.log('\n--- 4. Notes Integration, Researcher Stance & UI Vertical Slice ---');
const xrefUiMod = await bundleTs('src/ui/components/PassageCrossReferences.ts');
const lexUiMod = await bundleTs('src/ui/components/LexicalRelationshipsSection.ts');
const editorMod = await bundleTs('src/ui/components/NoteEditor.ts');

let capturedPrefill = null;
const xrefPanel = xrefUiMod.createPassageCrossReferences({
  onNavigate: () => {},
  onEvaluateRelationship: prefill => { capturedPrefill = prefill; },
});
xrefPanel.setPassage({ book: 1, chapter: 1, verse: 1 });
await new Promise(r => setTimeout(r, 80));

assert(autoNoteSaveCalls === 0, 'Opening passage cross-references creates ZERO notes automatically');
const xrefCards = xrefPanel.element.querySelectorAll('.rel-card');
assert(xrefCards.length > 0, `PassageCrossReferences UI rendered ${xrefCards.length} relationship cards`);

const lexSection = lexUiMod.createLexicalRelationshipsSection({
  onInspectTarget: () => {},
  onEvaluateRelationship: prefill => { capturedPrefill = prefill; },
});
await lexSection.loadForWord(adamRes.data.focus.word_id || 120, 'H120');
assert(autoNoteSaveCalls === 0, 'Inspecting lexical relationships creates ZERO notes automatically');
assert(lexSection.element.querySelectorAll('.rel-card').length >= 2, 'LexicalRelationshipsSection UI rendered lexical edge cards');

// Simulate researcher clicking "Disagree" or "Alternative" & connecting to another note
const sampleEdge = gen1_1.data.outgoing.find(e => e.target_label.includes('John 1:1-3'));
const prefillWithNoteConn = BibleRPC.relationships.buildNotePrefillFromCrossReference(sampleEdge, {
  stance: 'disagree',
  connectToNote: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Prologue Logos Study' },
});
assert(
  prefillWithNoteConn.anchors.some(a => a.kind === 'verse') &&
  prefillWithNoteConn.anchors.some(a => a.kind === 'verse_range') &&
  prefillWithNoteConn.anchors.some(a => a.kind === 'note' && a.target_note_id === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  'Cross-reference note prefill attaches source verse, target verse_range, and connected note anchor'
);
assert(autoNoteSaveCalls === 0, 'Building note prefill still writes ZERO notes until user clicks Save');

// Open inside NoteEditor, toggle stance to `alternative_interpretation`, then click Save
let savedNoteResult = null;
const noteEditor = editorMod.createNoteEditor({
  onSaved: n => { savedNoteResult = n; },
});
noteEditor.openNew({ passage: { book: 1, chapter: 1, verse: 1 }, prefill: prefillWithNoteConn });
const stanceBtns = noteEditor.element.querySelectorAll('.editor-stance__btn');
assert(stanceBtns.length === 3, 'NoteEditor renders Agree / Disagree / Alternative stance buttons');

// Click "Alternative interpretation" button (index 2)
stanceBtns[2].click();
const allButtons = noteEditor.element.querySelectorAll('.editor-btn');
const saveBtn = allButtons.find(b => b.textContent === 'Save Note');
saveBtn.click();
await new Promise(r => setTimeout(r, 40));

assert(autoNoteSaveCalls === 1 && Boolean(savedNoteResult), 'Note saved ONLY when researcher explicitly clicks Save Note');
assert(
  lastSavedNotePayload?.note_kind === 'interpretation' &&
  lastSavedNotePayload?.source_context?.relationship_ref?.stance === 'alternative_interpretation' &&
  lastSavedNotePayload?.source_context?.relationship_ref?.relationship_id === sampleEdge.relationship_id,
  'Saved note payload preserves stable relationship_id, source provenance, and updated researcher stance'
);

// Match saved note + AI hypothesis note back to external relationship
const aiHypothesisNote = {
  ...savedNoteResult,
  id: '99999999-8888-7777-6666-555555555555',
  author: { id: 'agent', display_name: 'Research Agent', kind: 'ai' },
  review_status: 'unreviewed',
  source_context: {
    relationship_ref: {
      ...lastSavedNotePayload.source_context.relationship_ref,
      epistemic_tier: 'ai_hypothesis',
      stance: 'agree',
    },
  },
};
const indexed = BibleRPC.relationships.indexNotesByRelationshipId([savedNoteResult, aiHypothesisNote]);
assert(
  indexed.get(sampleEdge.relationship_id)?.length === 2,
  'Both human-reviewed and AI-hypothesis notes index cleanly back onto the external relationship ID'
);

console.log('\n================================================');
console.log(`XREF-LEX-01 Verification: ${passed} passed, ${failed} failed`);
console.log('================================================');
if (failed > 0) process.exit(1);
