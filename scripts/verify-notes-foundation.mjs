// @file: scripts/verify-notes-foundation.mjs
// NOTE-03: Verification script for notes foundation tables, RLS policies, column grants, and helper security.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

export const CATALOG_AUDIT_SQL = `
select
  t.table_name,
  r.rolname,
  has_table_privilege(r.rolname, 'public.' || t.table_name, 'insert') as can_insert,
  has_table_privilege(r.rolname, 'public.' || t.table_name, 'update') as can_update,
  has_table_privilege(r.rolname, 'public.' || t.table_name, 'delete') as can_delete
from (values ('note_settings'), ('note_authors'), ('note_kinds')) as t(table_name)
cross join (values ('anon'), ('authenticated')) as r(rolname);

select
  f.proname,
  r.rolname,
  has_function_privilege(r.rolname, 'public.' || f.proname || '(' || f.args || ')', 'execute') as can_execute
from (values
  ('note_settings_v1', ''),
  ('note_assert_writes_enabled_v1', 'text'),
  ('note_resolve_human_author_v1', ''),
  ('note_resolve_agent_author_v1', 'jsonb')
) as f(proname, args)
cross join (values ('anon'), ('authenticated'), ('public')) as r(rolname);
`.trim();

if (process.argv.includes('--print-sql')) {
  console.log(CATALOG_AUDIT_SQL);
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

async function testTableDenials() {
  console.log('1. Testing TP-SEC-1: Direct write denials on note foundation tables (anon)...');
  const tables = ['note_settings', 'note_authors', 'note_kinds'];

  for (const t of tables) {
    // POST
    const postRes = await fetch(`${SUPABASE_URL}/rest/v1/${t}`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ dummy: 'test' }),
    });
    assert(!postRes.ok, `POST /rest/v1/${t} denied to anon (HTTP ${postRes.status})`);

    // PATCH
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.true`, {
      method: 'PATCH',
      headers: hdr,
      body: JSON.stringify({ dummy: 'test' }),
    });
    assert(!patchRes.ok, `PATCH /rest/v1/${t} denied to anon (HTTP ${patchRes.status})`);

    // DELETE
    const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.true`, {
      method: 'DELETE',
      headers: hdr,
    });
    assert(!deleteRes.ok, `DELETE /rest/v1/${t} denied to anon (HTTP ${deleteRes.status})`);
  }
}

async function testHelperSecurity() {
  console.log('\n2. Testing TP-SEC-2: Internal helper RPC execution denials (anon)...');
  const helpers = [
    { name: 'note_settings_v1', body: {} },
    { name: 'note_assert_writes_enabled_v1', body: { p_kind: 'human' } },
    { name: 'note_resolve_human_author_v1', body: {} },
    { name: 'note_resolve_agent_author_v1', body: { p_agent: { provider: 'test', model: 'test' } } },
  ];

  for (const h of helpers) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${h.name}`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify(h.body),
    });
    assert(!r.ok, `Calling /rest/v1/rpc/${h.name} denied to anon (HTTP ${r.status})`);
  }
}

async function testColumnGrantsAndReadability() {
  console.log('\n3. Testing column grants & data readability (anon)...');

  // Forbidden column: user_id
  const userIdRes = await fetch(`${SUPABASE_URL}/rest/v1/note_authors?select=user_id`, { headers: hdr });
  assert(!userIdRes.ok, `SELECT user_id from note_authors denied to anon (HTTP ${userIdRes.status})`);

  // Wildcard select includes user_id, must also be denied
  const wildcardRes = await fetch(`${SUPABASE_URL}/rest/v1/note_authors?select=*`, { headers: hdr });
  assert(!wildcardRes.ok, `SELECT * from note_authors denied to anon (HTTP ${wildcardRes.status})`);

  // Allowed columns: id, author_kind, display_name, created_at
  const authorsRes = await fetch(`${SUPABASE_URL}/rest/v1/note_authors?select=id,author_kind,display_name`, { headers: hdr });
  assert(authorsRes.ok, `SELECT allowed columns from note_authors succeeded (HTTP ${authorsRes.status})`);
  const authors = await authorsRes.json();
  const owner = authors.find(a => a.id === '00000000-0000-0000-0000-00000000a001');
  assert(owner && owner.display_name === 'You' && owner.author_kind === 'human', 'Seeded owner author "You" readable');

  // note_settings
  const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/note_settings?select=*`, { headers: hdr });
  assert(settingsRes.ok, `SELECT from note_settings succeeded (HTTP ${settingsRes.status})`);
  const settings = await settingsRes.json();
  assert(settings.length === 1 && settings[0].single_user_mode === true, 'Seeded note_settings row readable (single_user_mode = true)');

  // note_kinds
  const kindsRes = await fetch(`${SUPABASE_URL}/rest/v1/note_kinds?select=*`, { headers: hdr });
  assert(kindsRes.ok, `SELECT from note_kinds succeeded (HTTP ${kindsRes.status})`);
  const kinds = await kindsRes.json();
  assert(kinds.length === 7, `7 canonical note_kinds readable (got ${kinds.length})`);
  const expectedKinds = ['observation', 'linguistic', 'interpretation', 'question', 'cross_reference', 'research_lead', 'citation'];
  const actualKinds = kinds.map(k => k.note_kind).sort();
  assert(expectedKinds.every(k => actualKinds.includes(k)), 'All 7 expected note kinds present');
}

async function main() {
  console.log('=== NOTE-03 Verification: Notes Foundation ===');
  await testTableDenials();
  await testHelperSecurity();
  await testColumnGrantsAndReadability();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
