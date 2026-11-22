// Local-only word identity, homograph, LXX and evidence compaction regressions.
import assert from 'node:assert/strict';
import { compactWordFromData, buildWordEtymology, normalizeDiscoveryConnection, verifyWordRowAlignment } from '../supabase/functions/bible-mcp/word-model.ts';
import { computeGematria } from '../supabase/functions/bible-mcp/gematria.ts';

const token = { word_id: 10, surface: 'מְנוֹרַת֩', lemma: 'מְנוֹרָה', strongs: 'H4501', lemma_key: 'lemma:H4501', transliteration: 'me.no.Rat', grammar: 'HNcfsc', gloss: 'lampstand' };
const aligned = { id: 10, original_word: 'מְנוֹרַת֩', strongs_nr: 'H4501' };
assert.equal(verifyWordRowAlignment(token, aligned), true);
for (const row of [null, { ...aligned, id: 11 }, { ...aligned, original_word: 'זָהָב' }, { ...aligned, strongs_nr: 'H2091' }, { ...aligned, lemma_key: 'lemma:H2091' }]) assert.equal(verifyWordRowAlignment(token, row), false);
assert.equal(verifyWordRowAlignment({ ...token, surface: 'כפר', strongs: 'H3724B' }, { ...aligned, original_word: 'כפר', strongs_nr: 'H3724A' }), false, 'Extended Strong homographs cannot be merged');
const greekToken = { word_id: 11, surface: 'πνεύματος', strongs: 'G4151' };
assert.equal(verifyWordRowAlignment(greekToken, { id: 11, original_word: 'πνεύματος', strongs_nr: 'G4151' }), true);
assert.equal(verifyWordRowAlignment(greekToken, { id: 11, original_word: 'πνεῦμα', strongs_nr: 'G4151' }), false, 'Greek occurrence forms remain distinct');

const unrelated = { sc: 'זָהָב', lk: 'lemma:H2091', tr: 'za.hav', grammar: 'WRONG' };
const anchored = compactWordFromData({ token, profile: unrelated });
assert.equal(anchored.lemma, token.lemma);
assert.equal(anchored.lemma_key, token.lemma_key);
assert.equal(anchored.transliteration, token.transliteration);
assert.equal(anchored.grammar, token.grammar);
const noTranslit = compactWordFromData({ token: { ...token, transliteration: '' }, profile: { sc: token.lemma, tr: 'LEMMA_ONLY' } });
assert.notEqual(noTranslit.transliteration, 'LEMMA_ONLY', 'An occurrence cannot inherit a lemma transliteration');
const missingLemma = compactWordFromData({ token: { surface: 'כפר', lemma_key: 'lemma:H3724B' }, profile: unrelated });
assert.equal(missingLemma.lemma, '', 'Missing occurrence lemma is not invented from another profile or surface');
const lexical = compactWordFromData({ profile: { sc: 'רוּחַ', tr: 'ru.ach', bs: 'H7307' }, wordRow: { original_word: 'וְרוּחַ', grammar_code: 'sample-only', transliteration: 've.ru.ach' } });
assert.equal(lexical.form, undefined);
assert.equal(lexical.grammar, undefined);
assert.equal(lexical.transliteration, 'ru.ach');

const profile = { sc: 'כֹּפֶר', bs: 'H3724', lk: 'lemma:H3724A', senses: [{ key: 'sense:H3724A', short_gloss: 'ransom' }], homograph_siblings: [{ bs: 'H3724', lk: 'lemma:H3724B', gl: 'pitch' }, { bs: 'H3724', lk: 'lemma:H3724C', gl: 'henna' }, { bs: 'H3722', lk: 'lemma:H3722A', gl: 'atone' }], lxx_relations: [{ target_strongs: 'G417', script: 'ἄνεμος', count: 3 }, { greek_strongs: 'G0417', script: 'ἄνεμος', gloss: 'wind', count: 5 }] };
const word = compactWordFromData({ profile });
assert.deepEqual(word.senses.map(s => s.gloss), ['ransom', 'pitch', 'henna']);
assert.equal(word.lxx.length, 1);
assert.equal(word.lxx[0].gloss, 'wind');
assert.equal(word.lxx[0].count, 5, 'Duplicate evidence sources are not summed as independent counts');
assert.equal(word.lxx[0].direction, 'greek_rendering_of_this_hebrew');
const reverse = compactWordFromData({ profile: { bs: 'G4151', sc: 'πνεῦμα', lxx: [{ strongs: 'H7307', hebrew: 'רוּחַ', gloss: 'spirit' }] } });
assert.equal(reverse.lxx[0].direction, 'hebrew_source_rendered_by_this_greek');
assert.equal(reverse.lxx[0].script, 'רוּחַ');

const formationPacket = { matched_lemmas: [{ lemma_key: 'lemma:H3724A', primary_gloss: 'ransom' }, { lemma_key: 'lemma:H3724D', primary_gloss: 'village' }], documented_roots: [{ lemma_key: 'lemma:H3724D', root_key: 'lemma:H3723H', root_script: 'כפר', relation_type: 'spelling_variant' }], root_relatives: [{ root_key: 'lemma:H3723H', lemma_key: 'lemma:H3723H', primary_gloss: 'village' }], lexical_formations: [], word_form_component_candidates: [{ lemma_key: 'lemma:H3724A', surface: 'ב', morpheme_role: 'prefix', is_context_ambiguous: true }] };
const reader = async ({ name }) => ({ rows: [name === 'get_word_formation_v1' ? formationPacket : { candidates: [{ bs: 'H3722', sc: 'כפר', gl: 'atone' }] }] });
const etym = await buildWordEtymology(reader, 'H3724', profile, 2, { activeLemmaKey: 'lemma:H3724A', wordId: 10 });
assert.equal(etym.status, 'unavailable');
assert.equal(etym.roots, undefined);
assert.equal(etym.relatives, undefined);
assert.equal(etym.morphological_components, undefined, 'Ambiguous components are not definitive token morphology');
assert.equal(etym.other_homograph_roots[0].lemma_key, 'lemma:H3724D');
assert.ok(etym.spelling_suggestions[0].note.includes('does NOT establish'));
const ambiguous = await buildWordEtymology(reader, 'H3724', null, 2, { contextualGloss: 'ransom village' });
assert.equal(ambiguous.lemma_key, undefined, 'A gloss substring or first result cannot choose a lemma');
assert.equal(ambiguous.roots, undefined);
const ruach = computeGematria('רוּחַ');
assert.equal(ruach.value, 214);
assert.equal(ruach.method, 'standard_hebrew_mispar_hechrechi');
assert.equal(ruach.normalized, 'רוח');
assert.equal(computeGematria('כֹּפֶר').value, 300);

const raw = { evidence_id: 'r12:path:H7307:H5375', relation: 'multihop_proof_path', epistemic: 'documented_collocation_or_cooccurrence', title: 'R12 3-hop discovery: spirit → lift', explanation: '3-hop source-backed discovery path (direct endpoint witness, K=0.95, endpoint_groups=6, step_groups=6; interest=0.72266): spirit --[lxx_translation_bridge]--> breath ; breath --[gram_grammatical_subject_of]--> bear ; bear --[lex_source_provided_lexical_equivalent]--> lift', refs: ['Genesis 45:27'] };
const compact = normalizeDiscoveryConnection(raw);
assert.equal(compact.id, raw.evidence_id);
assert.equal(compact.relation, raw.relation);
assert.equal(compact.epistemic, raw.epistemic);
assert.ok(compact.why.endsWith('lift'));
assert.ok(compact.why.includes('direct endpoint witness'));
assert.ok(compact.why.includes('source lexical equivalent'));
assert.ok(!compact.why.includes('interest='));
const sizes = {};
if (process.argv.includes('--local-corpus')) {
  const { fetchCompactPassage } = await import('../supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const { corpusRpc } = await import('./local-corpus-harness.mjs');
  for (const passage of [{book:38,chapter:4,start_verse:1,end_verse:14},{book:46,chapter:12,start_verse:10,end_verse:31}]) {
    const args={passages:[passage],max_verses:30,include_profiles:true,profile_limit:24};
    const direct=await corpusRpc('get_passage_compact_v1',args);
    const deferred=await fetchCompactPassage(async q=>({rows:[await corpusRpc(q.name,q.args)]}),args);
    assert.deepEqual(deferred,direct,'CPU-bounded hydration preserves every profile, candidate and ordering');
  }
  const data = await corpusRpc('get_word_profiles_batch_v1', { strongs: ['H7307', 'H3724'], include_forms: true, include_orth: true });
  const ruachWord = compactWordFromData({ profile: data.profiles.H7307 });
  assert.ok(ruachWord.senses.some(s => s.gloss === 'spirit: temper'));
  assert.equal(ruachWord.lxx.length, 3);
  assert.ok(compactWordFromData({ profile: data.profiles.H3724 }).senses.some(s => s.gloss === 'pitch'));
  const discovery = await corpusRpc('discover_biblical_connections_v2', { query: 'H7307', focus_lemma: 'H7307', limit: 10 });
  const cards = discovery.strongest_connections.map(normalizeDiscoveryConnection).filter(Boolean);
  assert.deepEqual(cards.map(c => c.id), discovery.strongest_connections.map(c => c.evidence_id ?? c.id));
  const oldText = (v, n) => { const s = v.replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 3).trimEnd() + '...'; };
  const before = cards.map((c, i) => ({ ...c, title: oldText(discovery.strongest_connections[i].title, 140), why: oldText(discovery.strongest_connections[i].explanation ?? discovery.strongest_connections[i].why, 240) }));
  sizes.connection_cards_before_bytes = Buffer.byteLength(JSON.stringify(before));
  sizes.connection_cards_after_bytes = Buffer.byteLength(JSON.stringify(cards));
}
console.log(JSON.stringify({ passed: true, coverage: 'Hebrew/Greek strict identity; extended homographs; anchored metadata; partial lemma; senses; LXX dedup/direction; etymology scope; ambiguous morphology; gematria; lossless boilerplate compaction', ...sizes }));
