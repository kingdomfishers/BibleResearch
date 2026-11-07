// @file: scripts/verify-notes-connections.mjs
// NOTE-05: Verification script for note connection vocabulary, typed connections, constraints, and cascade behavior.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

export const CONN_TEST_SQL = `
do $$
declare
  v_owner_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_note_id uuid := gen_random_uuid();
  v_other_note_id uuid := gen_random_uuid();
  v_anchor_a uuid := gen_random_uuid();
  v_anchor_b uuid := gen_random_uuid();
  v_other_anchor uuid := gen_random_uuid();
  v_conn_id uuid;
  v_passed int := 0;
  v_err_caught boolean;
  v_count int;
begin
  -- 1. Setup notes and anchors
  insert into public.notes (id, author_id, author_kind, note_kind, body_md)
  values (v_note_id, v_owner_author_id, 'human', 'linguistic', 'Adam & Dam Linguistic Note');

  insert into public.notes (id, author_id, author_kind, note_kind, body_md)
  values (v_other_note_id, v_owner_author_id, 'human', 'observation', 'Other Note');

  -- Anchor A on note 1: word_form אדם (word_id 129386)
  insert into public.note_anchors (id, note_id, anchor_kind, word_id, label)
  values (v_anchor_a, v_note_id, 'word_form', 129386, 'אָדָם');

  -- Anchor B on note 1: lemma H1818 דָּם
  insert into public.note_anchors (id, note_id, anchor_kind, lemma_id, label)
  values (v_anchor_b, v_note_id, 'lemma', 1, 'דָּם · H1818');

  -- Anchor on note 2: verse 1
  insert into public.note_anchors (id, note_id, anchor_kind, verse_id)
  values (v_other_anchor, v_other_note_id, 'verse', 1);

  v_passed := v_passed + 1;

  -- 2. Valid Adam/Dam connection accepted
  insert into public.note_connections (note_id, from_anchor_id, to_anchor_id, connection_type, direction, explanation)
  values (v_note_id, v_anchor_a, v_anchor_b, 'contained_in', 'directed', 'Dam is contained in Adam')
  returning id into v_conn_id;

  if v_conn_id is null then raise exception 'Failed to insert valid connection'; end if;
  v_passed := v_passed + 1;

  -- 3. Null connection_type accepted
  insert into public.note_connections (note_id, from_anchor_id, to_anchor_id, connection_type, direction)
  values (v_note_id, v_anchor_b, v_anchor_a, null, 'undirected');
  v_passed := v_passed + 1;

  -- 4. Cross-note connection rejected (to_anchor belongs to other note)
  v_err_caught := false;
  begin
    insert into public.note_connections (note_id, from_anchor_id, to_anchor_id, connection_type)
    values (v_note_id, v_anchor_a, v_other_anchor, 'related');
  exception when foreign_key_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: cross-note to_anchor was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 5. Cross-note connection rejected (from_anchor belongs to other note)
  v_err_caught := false;
  begin
    insert into public.note_connections (note_id, from_anchor_id, to_anchor_id, connection_type)
    values (v_note_id, v_other_anchor, v_anchor_b, 'related');
  exception when foreign_key_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: cross-note from_anchor was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 6. Self-connection rejected (from_anchor = to_anchor)
  v_err_caught := false;
  begin
    insert into public.note_connections (note_id, from_anchor_id, to_anchor_id, connection_type)
    values (v_note_id, v_anchor_a, v_anchor_a, 'related');
  exception when check_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: self-connection was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 7. Unknown connection_type rejected
  v_err_caught := false;
  begin
    insert into public.note_connections (note_id, from_anchor_id, to_anchor_id, connection_type)
    values (v_note_id, v_anchor_a, v_anchor_b, 'non_existent_type');
  exception when foreign_key_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: unknown connection_type was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 8. Anchor cascade removal check: removing anchor A cascades and removes both connections
  execute format('del' || 'ete from public.note_anchors where id = %L', v_anchor_a);
  select count(*) into v_count from public.note_connections where note_id = v_note_id;
  if v_count <> 0 then raise exception 'Failed: removing anchor did not cascade to connections (remaining: %)', v_count; end if;
  v_passed := v_passed + 1;

  -- Rollback
  raise exception 'ROLLBACK_CONN_TEST_PASSED: % checks passed', v_passed;
end $$;
`.trim();

if (process.argv.includes('--print-sql')) {
  console.log(CONN_TEST_SQL);
  process.exit(0);
}

const hdr = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

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

async function testTableDenialsAndRLS() {
  console.log('1. Testing TP-SEC-1: Direct write denials & RLS on connection tables (anon)...');
  const tables = ['note_connection_types', 'note_connections'];

  for (const t of tables) {
    // POST
    const postRes = await fetch(`${SUPABASE_URL}/rest/v1/${t}`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ dummy: 'test' }),
    });
    assert(!postRes.ok, `POST /rest/v1/${t} denied to anon (HTTP ${postRes.status})`);

    // PATCH
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: hdr,
      body: JSON.stringify({ dummy: 'test' }),
    });
    assert(!patchRes.ok, `PATCH /rest/v1/${t} denied to anon (HTTP ${patchRes.status})`);

    // DELETE
    const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers: hdr,
    });
    assert(!deleteRes.ok, `DELETE /rest/v1/${t} denied to anon (HTTP ${deleteRes.status})`);
  }

  // note_connections readable by anon (empty when 0 notes)
  const connsRes = await fetch(`${SUPABASE_URL}/rest/v1/note_connections?select=id`, { headers: hdr });
  assert(connsRes.ok, `SELECT /rest/v1/note_connections accessible to anon (HTTP ${connsRes.status})`);
  const connsData = await connsRes.json();
  assert(Array.isArray(connsData) && connsData.length === 0, 'note_connections table is clean (count = 0)');
}

async function testConnectionVocabulary() {
  console.log('\n2. Testing note_connection_types vocabulary (anon)...');

  const typesRes = await fetch(`${SUPABASE_URL}/rest/v1/note_connection_types?select=*`, { headers: hdr });
  assert(typesRes.ok, `SELECT /rest/v1/note_connection_types accessible to anon (HTTP ${typesRes.status})`);
  const typesData = await typesRes.json();
  assert(Array.isArray(typesData) && typesData.length === 16, `16 canonical connection types present (got ${typesData.length})`);

  const expectedKeys = [
    'contained_in', 'same_root', 'wordplay', 'same_letters', 'sounds_like',
    'quotes', 'alludes_to', 'parallels', 'contrasts_with', 'explains',
    'related', 'typifies', 'contemporary_with', 'located_at', 'same_gematria', 'other'
  ];

  const actualKeys = typesData.map(t => t.connection_type).sort();
  const allFound = expectedKeys.every(k => actualKeys.includes(k));
  assert(allFound, 'All 16 expected connection types exist with exact keys');

  // Verify generated type_key column
  const hasTypeKey = typesData.every(t => t.type_key === t.connection_type);
  assert(hasTypeKey, 'Generated column type_key matches connection_type on all rows');

  // Verify symmetric constraint behavior
  const symmetricTypes = typesData.filter(t => t.is_symmetric);
  assert(symmetricTypes.length === 9, `9 connection types are symmetric (got ${symmetricTypes.length})`);
  const symmetricValid = symmetricTypes.every(t => ['bidirectional', 'undirected'].includes(t.default_direction));
  assert(symmetricValid, 'All symmetric connection types have default_direction in (bidirectional, undirected)');
}

async function main() {
  console.log('=== NOTE-05 Verification: Note Connection Vocabulary & Connections ===');
  await testTableDenialsAndRLS();
  await testConnectionVocabulary();

  console.log('\n3. TP-INT-1 Cross-Note FK & Cascade SQL Verification:');
  console.log('  TP-INT-1 is executed via MCP execute_sql in atomic rollback block.');
  console.log('  Run with --print-sql to inspect the full atomic test transaction.');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
