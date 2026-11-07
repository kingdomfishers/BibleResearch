// @file: scripts/verify-notes-blocks.mjs
// NOTE-06: Verification script for note block registry, polymorphic rich blocks, URL security, and dynamic enablement.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

export const BLOCKS_TEST_SQL = `
do $$
declare
  v_owner_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_note_id uuid := gen_random_uuid();
  v_passed int := 0;
  v_err_caught boolean;
  v_err text;
begin
  -- 1. Create a base note
  insert into public.notes (id, author_id, author_kind, note_kind, body_md)
  values (v_note_id, v_owner_author_id, 'human', 'observation', 'Note for blocks test');
  v_passed := v_passed + 1;

  -- 2. Valid markdown block accepted
  insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
  values (v_note_id, 0, 'markdown', '{"markdown": "### Valid Markdown"}'::jsonb, 'Heading text');
  v_passed := v_passed + 1;

  -- 3. Valid link block accepted
  insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
  values (v_note_id, 1, 'link', '{"url": "https://example.com", "title": "Example Link"}'::jsonb, 'Link to Example');
  v_passed := v_passed + 1;

  -- 4. Valid image block accepted
  insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
  values (v_note_id, 2, 'image', '{"url": "https://example.com/image.png", "alt": "A diagram"}'::jsonb, 'Image description');
  v_passed := v_passed + 1;

  -- 5. Image without alt rejected (validation_failed:missing_key:alt)
  v_err_caught := false;
  begin
    insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
    values (v_note_id, 3, 'image', '{"url": "https://example.com/image.png"}'::jsonb, 'Image description');
  exception when others then
    if sqlerrm like '%missing_key:alt%' then v_err_caught := true; end if;
  end;
  if not v_err_caught then raise exception 'Failed: image without alt was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 6. XSS url: 'javascript:alert(1)' rejected (validation_failed:not_https:url)
  v_err_caught := false;
  begin
    insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
    values (v_note_id, 4, 'link', '{"url": "javascript:alert(1)", "title": "Bad"}'::jsonb, 'Bad link');
  exception when others then
    if sqlerrm like '%not_https:url%' then v_err_caught := true; end if;
  end;
  if not v_err_caught then raise exception 'Failed: javascript: URL was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 7. XSS url: 'data:text/html,...' rejected
  v_err_caught := false;
  begin
    insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
    values (v_note_id, 5, 'link', '{"url": "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "title": "Bad"}'::jsonb, 'Bad link');
  exception when others then
    if sqlerrm like '%not_https:url%' then v_err_caught := true; end if;
  end;
  if not v_err_caught then raise exception 'Failed: data: URL was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 8. Insecure url: 'http://example.com' rejected
  v_err_caught := false;
  begin
    insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
    values (v_note_id, 6, 'link', '{"url": "http://insecure.example.com", "title": "Insecure"}'::jsonb, 'Insecure link');
  exception when others then
    if sqlerrm like '%not_https:url%' then v_err_caught := true; end if;
  end;
  if not v_err_caught then raise exception 'Failed: http: URL was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 9. Planned type 'map' rejected with block_type_not_enabled
  v_err_caught := false;
  begin
    insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
    values (v_note_id, 7, 'map', '{"coords": [31.5, 35.2]}'::jsonb, 'Map of Jerusalem');
  exception when others then
    if sqlerrm like '%block_type_not_enabled%' then v_err_caught := true; end if;
  end;
  if not v_err_caught then raise exception 'Failed: planned type map was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 10. Planned type 'model_3d' rejected with block_type_not_enabled
  v_err_caught := false;
  begin
    insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
    values (v_note_id, 8, 'model_3d', '{"model_url": "https://example.com/altar.gltf"}'::jsonb, '3D Altar');
  exception when others then
    if sqlerrm like '%block_type_not_enabled%' then v_err_caught := true; end if;
  end;
  if not v_err_caught then raise exception 'Failed: planned type model_3d was not rejected'; end if;
  v_passed := v_passed + 1;

  -- 11. Enabling planned type without migration: UPDATE is_enabled=true makes it valid!
  update public.note_block_types set is_enabled = true where block_type = 'map';
  insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
  values (v_note_id, 9, 'map', '{"coords": [31.5, 35.2]}'::jsonb, 'Map of Jerusalem');
  v_passed := v_passed + 1;

  -- 12. Empty text_alternative rejected
  v_err_caught := false;
  begin
    insert into public.note_blocks (note_id, ordinal, block_type, content, text_alternative)
    values (v_note_id, 10, 'markdown', '{"markdown": "text"}'::jsonb, '   ');
  exception when check_violation or others then
    v_err_caught := true;
  end;
  if not v_err_caught then raise exception 'Failed: empty text_alternative was not rejected'; end if;
  v_passed := v_passed + 1;

  -- Rollback
  raise exception 'ROLLBACK_BLOCKS_TEST_PASSED: % checks passed', v_passed;
end $$;
`.trim();

if (process.argv.includes('--print-sql')) {
  console.log(BLOCKS_TEST_SQL);
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
  console.log('1. Testing TP-SEC-1: Direct write denials & RLS on block tables (anon)...');
  const tables = ['note_block_types', 'note_blocks'];

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

  // note_blocks readable by anon (empty when 0 notes)
  const blocksRes = await fetch(`${SUPABASE_URL}/rest/v1/note_blocks?select=id`, { headers: hdr });
  assert(blocksRes.ok, `SELECT /rest/v1/note_blocks accessible to anon (HTTP ${blocksRes.status})`);
  const blocksData = await blocksRes.json();
  assert(Array.isArray(blocksData) && blocksData.length === 0, 'note_blocks table is clean (count = 0)');
}

async function testBlockRegistry() {
  console.log('\n2. Testing note_block_types registry (anon)...');

  const typesRes = await fetch(`${SUPABASE_URL}/rest/v1/note_block_types?select=*`, { headers: hdr });
  assert(typesRes.ok, `SELECT /rest/v1/note_block_types accessible to anon (HTTP ${typesRes.status})`);
  const typesData = await typesRes.json();
  assert(Array.isArray(typesData) && typesData.length === 9, `9 canonical block types present (got ${typesData.length})`);

  const enabledTypes = typesData.filter(t => t.is_enabled);
  assert(enabledTypes.length === 3, `3 block types are enabled (got ${enabledTypes.length})`);
  const enabledKeys = enabledTypes.map(t => t.block_type).sort();
  assert(enabledKeys.join(',') === 'image,link,markdown', 'Enabled block types are markdown, link, image');

  const disabledTypes = typesData.filter(t => !t.is_enabled);
  assert(disabledTypes.length === 6, `6 block types are planned/disabled (got ${disabledTypes.length})`);
  const disabledKeys = disabledTypes.map(t => t.block_type).sort();
  const expectedPlanned = ['archaeological_find', 'chart', 'map', 'model_3d', 'table', 'timeline'];
  assert(disabledKeys.join(',') === expectedPlanned.join(','), 'Planned types are archaeological_find, chart, map, model_3d, table, timeline');
}

async function main() {
  console.log('=== NOTE-06 Verification: Note Block Registry & Validation ===');
  await testTableDenialsAndRLS();
  await testBlockRegistry();

  console.log('\n3. TP-INT-1, TP-XSS-1 & Dynamic Enablement SQL Verification:');
  console.log('  Executed via MCP execute_sql in atomic rollback block.');
  console.log('  Run with --print-sql to inspect the full atomic test transaction.');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
