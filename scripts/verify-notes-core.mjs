// @file: scripts/verify-notes-core.mjs
// NOTE-04: Verification script for notes core tables, RLS policies, trigger integrity, and perf spike.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

export const INT_TEST_SQL = `
do $$
declare
  v_note_id uuid := gen_random_uuid();
  v_target_note_id uuid := gen_random_uuid();
  v_owner_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_passed int := 0;
  v_err_caught boolean;
begin
  -- 1. Insert valid base notes (human author)
  insert into public.notes (id, author_id, author_kind, note_kind, body_md)
  values (v_note_id, v_owner_author_id, 'human', 'observation', 'Test note 1');
  
  insert into public.notes (id, author_id, author_kind, note_kind, body_md)
  values (v_target_note_id, v_owner_author_id, 'human', 'observation', 'Target note');
  v_passed := v_passed + 1;

  -- 2. Insert valid anchors for all 10 kinds
  -- 2.1 verse
  insert into public.note_anchors (note_id, anchor_kind, verse_id)
  values (v_note_id, 'verse', 1);
  v_passed := v_passed + 1;

  -- 2.2 verse_range
  insert into public.note_anchors (note_id, anchor_kind, verse_id, end_verse_id)
  values (v_note_id, 'verse_range', 1, 5);
  v_passed := v_passed + 1;

  -- 2.3 word_occurrence (Gen 1:1 position 1 has word_id 129386)
  insert into public.note_anchors (note_id, anchor_kind, verse_id, word_position, word_id)
  values (v_note_id, 'word_occurrence', 1, 1, 129386);
  v_passed := v_passed + 1;

  -- 2.4 word_form
  insert into public.note_anchors (note_id, anchor_kind, word_id)
  values (v_note_id, 'word_form', 129386);
  v_passed := v_passed + 1;

  -- 2.5 lemma
  insert into public.note_anchors (note_id, anchor_kind, lemma_id)
  values (v_note_id, 'lemma', 1);
  v_passed := v_passed + 1;

  -- 2.6 concept
  insert into public.note_anchors (note_id, anchor_kind, concept_id)
  values (v_note_id, 'concept', 1);
  v_passed := v_passed + 1;

  -- 2.7 place
  insert into public.note_anchors (note_id, anchor_kind, place_id)
  values (v_note_id, 'place', 572);
  v_passed := v_passed + 1;

  -- 2.8 event
  insert into public.note_anchors (note_id, anchor_kind, event_id)
  values (v_note_id, 'event', 131);
  v_passed := v_passed + 1;

  -- 2.9 target_note
  insert into public.note_anchors (note_id, anchor_kind, target_note_id)
  values (v_note_id, 'note', v_target_note_id);
  v_passed := v_passed + 1;

  -- 2.10 external
  insert into public.note_anchors (note_id, anchor_kind, external_uri, label)
  values (v_note_id, 'external', 'https://example.com/study', 'External Study');
  v_passed := v_passed + 1;

  -- 3. Assert invalid shapes are rejected:
  -- 3.1 verse without verse_id
  v_err_caught := false;
  begin
    insert into public.note_anchors (note_id, anchor_kind)
    values (v_note_id, 'verse');
  exception when check_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: verse without verse_id was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 3.2 range with end < start
  v_err_caught := false;
  begin
    insert into public.note_anchors (note_id, anchor_kind, verse_id, end_verse_id)
    values (v_note_id, 'verse_range', 5, 2);
  exception when check_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: range with end < start was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 3.3 word_occurrence with wrong word_id for Gen 1:1 position 1
  v_err_caught := false;
  begin
    insert into public.note_anchors (note_id, anchor_kind, verse_id, word_position, word_id)
    values (v_note_id, 'word_occurrence', 1, 1, 999999);
  exception when others then
    if sqlerrm like '%anchor_invalid%' then
      v_err_caught := true;
    else
      raise exception 'Unexpected error on wrong word_id: %', sqlerrm;
    end if;
  end;
  if not v_err_caught then raise exception 'Failed: word_occurrence with wrong word_id was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 3.4 lemma + verse mixed
  v_err_caught := false;
  begin
    insert into public.note_anchors (note_id, anchor_kind, lemma_id, verse_id)
    values (v_note_id, 'lemma', 1, 1);
  exception when check_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: lemma + verse mixed was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 3.5 external with http:// URI
  v_err_caught := false;
  begin
    insert into public.note_anchors (note_id, anchor_kind, external_uri, label)
    values (v_note_id, 'external', 'http://insecure.example.com', 'Insecure');
  exception when check_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: external with http:// was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 3.6 ai author with human kind mismatch
  v_err_caught := false;
  begin
    insert into public.notes (author_id, author_kind, note_kind, body_md)
    values (v_owner_author_id, 'ai', 'observation', 'Mismatch author kind');
  exception when foreign_key_violation then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: ai author with human kind mismatch was not rejected'; end if;
  v_passed := v_passed + 1;

  -- Always rollback
  raise exception 'ROLLBACK_INT_TEST_PASSED: % checks passed', v_passed;
end $$;
`.trim();

export const PERF_TEST_SQL = `
do $$
declare
  v_plan_word json;
  v_plan_verse json;
  v_plan_lemma json;
  v_text text;
  v_t0 timestamptz := clock_timestamp();
  v_t_insert timestamptz;
  v_summary jsonb;
begin
  -- 1. Insert 20,000 synthetic notes with 2 anchors each
  with note_data as (
    select
      gen_random_uuid() as id,
      i as rn
    from generate_series(1, 20000) as i
  ),
  ins_notes as (
    insert into public.notes (id, author_id, author_kind, note_kind, body_md)
    select
      d.id,
      '00000000-0000-0000-0000-00000000a001'::uuid,
      'human',
      'observation',
      'Synthetic perf note ' || d.rn
    from note_data d
  ),
  ins_a1 as (
    insert into public.note_anchors (note_id, anchor_kind, verse_id, end_verse_id)
    select
      d.id,
      case when d.rn % 2 = 1 then 'verse' else 'verse_range' end,
      (1 + (d.rn % 31000))::int,
      case when d.rn % 2 = 1 then null else (1 + (d.rn % 31000) + 2)::int end
    from note_data d
  ),
  ins_a2 as (
    insert into public.note_anchors (note_id, anchor_kind, word_id, lemma_id)
    select
      d.id,
      case when d.rn % 2 = 1 then 'word_form' else 'lemma' end,
      case when d.rn % 2 = 1 then (1 + (d.rn % 150000))::int else null end,
      case when d.rn % 2 = 1 then null else (1 + (d.rn % 22000))::bigint end
    from note_data d
  )
  select clock_timestamp() into v_t_insert;

  -- 2. Analyze
  execute 'analyze public.notes';
  execute 'analyze public.note_anchors';

  -- 3. Explain plans
  -- Word ID plan
  execute 'explain (analyze, format json) select * from public.note_anchors where word_id = 500 and anchor_kind in (''word_form'', ''word_occurrence'')'
  into v_text;
  v_plan_word := v_text::json;

  -- Verse range plan
  execute 'explain (analyze, format json) select * from public.note_anchors where verse_id between 1000 and 1010 and anchor_kind in (''verse'', ''verse_range'', ''word_occurrence'')'
  into v_text;
  v_plan_verse := v_text::json;

  -- Lemma ID plan
  execute 'explain (analyze, format json) select * from public.note_anchors where lemma_id = 100 and anchor_kind = ''lemma'''
  into v_text;
  v_plan_lemma := v_text::json;

  v_summary := jsonb_build_object(
    'insert_ms', round(extract(epoch from (v_t_insert - v_t0)) * 1000),
    'plan_word_node', v_plan_word->0->'Plan'->'Node Type',
    'plan_word_index', v_plan_word->0->'Plan'->'Index Name',
    'word_exec_ms', v_plan_word->0->'Execution Time',
    'plan_verse_node', v_plan_verse->0->'Plan'->'Node Type',
    'plan_verse_index', v_plan_verse->0->'Plan'->'Index Name',
    'verse_exec_ms', v_plan_verse->0->'Execution Time',
    'plan_lemma_node', v_plan_lemma->0->'Plan'->'Node Type',
    'plan_lemma_index', v_plan_lemma->0->'Plan'->'Index Name',
    'lemma_exec_ms', v_plan_lemma->0->'Execution Time'
  );

  raise exception 'ROLLBACK_PERF %', v_summary::text;
end $$;
`.trim();

if (process.argv.includes('--print-sql')) {
  console.log('--- TP-INT-1 SQL ---');
  console.log(INT_TEST_SQL);
  console.log('\n--- TP-PERF-1 SQL ---');
  console.log(PERF_TEST_SQL);
  process.exit(0);
}

if (process.argv.includes('--print-sql-int')) {
  console.log(INT_TEST_SQL);
  process.exit(0);
}

if (process.argv.includes('--print-sql-perf')) {
  console.log(PERF_TEST_SQL);
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
  console.log('1. Testing TP-SEC-1: Direct write denials & RLS on notes core tables (anon)...');
  const tables = ['notes', 'note_anchors', 'note_revisions'];

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

  // note_revisions must be unreadable by anon (no policy / denied)
  const revRes = await fetch(`${SUPABASE_URL}/rest/v1/note_revisions?select=*`, { headers: hdr });
  assert(!revRes.ok, `SELECT /rest/v1/note_revisions denied to anon (HTTP ${revRes.status})`);

  // notes and note_anchors readable (returns empty list)
  const notesRes = await fetch(`${SUPABASE_URL}/rest/v1/notes?select=id`, { headers: hdr });
  assert(notesRes.ok, `SELECT /rest/v1/notes accessible to anon (HTTP ${notesRes.status})`);
  const notesData = await notesRes.json();
  assert(Array.isArray(notesData) && notesData.length === 0, `notes table is clean (count = 0)`);

  const anchorsRes = await fetch(`${SUPABASE_URL}/rest/v1/note_anchors?select=id`, { headers: hdr });
  assert(anchorsRes.ok, `SELECT /rest/v1/note_anchors accessible to anon (HTTP ${anchorsRes.status})`);
  const anchorsData = await anchorsRes.json();
  assert(Array.isArray(anchorsData) && anchorsData.length === 0, `note_anchors table is clean (count = 0)`);
}

async function main() {
  console.log('=== NOTE-04 Verification: Notes Core Tables & Anchors ===');
  await testTableDenialsAndRLS();

  console.log('\n2. TP-INT-1 & TP-PERF-1 SQL Verification:');
  console.log('  TP-INT-1 and TP-PERF-1 are executed via MCP execute_sql in atomic rollback blocks.');
  console.log('  Run with --print-sql to extract the exact SQL payloads.');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
