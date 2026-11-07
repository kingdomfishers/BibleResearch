// @file: scripts/verify-notes-security.mjs
// NOTE-07: Security gate for the notes data layer.
// Verifies:
// 1. PostgREST anon denials (POST/PATCH/DELETE on all note* tables).
// 2. PostgREST anon RPC denials for internal helpers (note_*_v1, agent_*).
// 3. PostgreSQL catalog audits (via MCP-run SQL / --print-sql / .artifacts/notes/catalog-security-audit.json):
//    - RLS enabled on all note* tables.
//    - Zero write/truncate privileges for anon, authenticated, public on all note* tables.
//    - Function execute allow-list for anon/authenticated roles.
//    - search_path='' on all security definer functions.

import fs from 'node:fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

// Allow-list of note functions explicitly permitted to be executed by anon/authenticated.
// Functions not yet created (e.g., from NOTE-08, NOTE-10, NOTE-12) are tolerated by the allow-list.
export const ALLOWED_NOTES_FUNCTIONS = [
  'get_notes_for_passage_v1',
  'get_notes_for_word_v1',
  'get_note_v1',
  'list_notes_v1',
  'list_note_connection_types_v1',
  'search_note_targets_v1',
  'save_note_v1',
  'delete_note_v1',
  'set_note_review_v1',
  'note_validate_block_v1',
];

export const ALL_NOTE_TABLES = [
  'note_settings',
  'note_authors',
  'note_kinds',
  'notes',
  'note_revisions',
  'note_anchors',
  'note_connection_types',
  'note_connections',
  'note_block_types',
  'note_blocks',
];

export const INTERNAL_HELPERS = [
  'note_settings_v1',
  'note_assert_writes_enabled_v1',
  'note_resolve_human_author_v1',
  'note_resolve_agent_author_v1',
  'note_json_v1',
  'note_write_core_v1',
];

export const SECURITY_CATALOG_SQL = `
with table_audit as (
  select
    t.tablename,
    t.rowsecurity as rls_enabled,
    has_table_privilege('anon', 'public.' || quote_ident(t.tablename), 'insert') as anon_insert,
    has_table_privilege('anon', 'public.' || quote_ident(t.tablename), 'update') as anon_update,
    has_table_privilege('anon', 'public.' || quote_ident(t.tablename), 'delete') as anon_delete,
    has_table_privilege('anon', 'public.' || quote_ident(t.tablename), 'truncate') as anon_truncate,
    has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'insert') as auth_insert,
    has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'update') as auth_update,
    has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'delete') as auth_delete,
    has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'truncate') as auth_truncate,
    has_table_privilege('public', 'public.' || quote_ident(t.tablename), 'insert') as pub_insert,
    has_table_privilege('public', 'public.' || quote_ident(t.tablename), 'update') as pub_update,
    has_table_privilege('public', 'public.' || quote_ident(t.tablename), 'delete') as pub_delete,
    has_table_privilege('public', 'public.' || quote_ident(t.tablename), 'truncate') as pub_truncate
  from pg_tables t
  where t.schemaname = 'public' and t.tablename like 'note%'
),
function_audit as (
  select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as args,
    p.prosecdef as is_secdef,
    coalesce(p.proconfig::text[], array[]::text[]) as config,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
    has_function_privilege('public', p.oid, 'execute') as pub_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'note%' or p.proname like 'agent_%')
)
select 
  json_build_object(
    'tables', (select json_agg(t) from table_audit t),
    'functions', (select json_agg(f) from function_audit f)
  ) as audit;
`.trim();

if (process.argv.includes('--print-sql')) {
  console.log(SECURITY_CATALOG_SQL);
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

async function testPostgrestTableDenials() {
  console.log('1. Testing PostgREST anonymous write denials on all note* tables (POST/PATCH/DELETE)...');

  for (const table of ALL_NOTE_TABLES) {
    // 1. Attempt POST
    const postRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ dummy: 'security_test' }),
    });
    assert(!postRes.ok, `POST /rest/v1/${table} denied to anon (HTTP ${postRes.status})`);

    // 2. Attempt PATCH
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: hdr,
      body: JSON.stringify({ dummy: 'security_test' }),
    });
    assert(!patchRes.ok, `PATCH /rest/v1/${table} denied to anon (HTTP ${patchRes.status})`);

    // 3. Attempt DELETE
    const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers: hdr,
    });
    assert(!deleteRes.ok, `DELETE /rest/v1/${table} denied to anon (HTTP ${deleteRes.status})`);
  }
}

async function testPostgrestInternalHelperDenials() {
  console.log('\n2. Testing PostgREST anonymous execution denials on internal helpers...');

  for (const helper of INTERNAL_HELPERS) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${helper}`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({}),
    });
    assert(!res.ok, `RPC /rest/v1/rpc/${helper} denied to anon (HTTP ${res.status})`);
  }
}

function verifyCatalogAudit(auditData) {
  console.log('\n3. Testing PostgreSQL Catalog Audit (RLS, table privileges, function allow-list, search_path)...');

  const { tables, functions } = auditData;
  assert(Array.isArray(tables) && tables.length >= ALL_NOTE_TABLES.length, `Catalog tables present (${tables?.length || 0} found)`);

  const tableMap = new Map((tables || []).map(t => [t.tablename, t]));

  for (const tableName of ALL_NOTE_TABLES) {
    const t = tableMap.get(tableName);
    if (!t) {
      assert(false, `Table public.${tableName} exists in catalog`);
      continue;
    }

    assert(t.rls_enabled === true, `Table ${tableName} has RLS enabled`);

    const noAnonWrites = !t.anon_insert && !t.anon_update && !t.anon_delete && !t.anon_truncate;
    assert(noAnonWrites, `Table ${tableName} denies all write/truncate to anon`);

    const noAuthWrites = !t.auth_insert && !t.auth_update && !t.auth_delete && !t.auth_truncate;
    assert(noAuthWrites, `Table ${tableName} denies all write/truncate to authenticated`);

    const noPubWrites = !t.pub_insert && !t.pub_update && !t.pub_delete && !t.pub_truncate;
    assert(noPubWrites, `Table ${tableName} denies all write/truncate to public`);
  }

  // Function audit
  assert(Array.isArray(functions), `Catalog functions present (${functions?.length || 0} found)`);

  for (const fn of functions || []) {
    const isCallableByAnonOrAuth = fn.anon_exec || fn.auth_exec;

    if (isCallableByAnonOrAuth) {
      const isAllowed = ALLOWED_NOTES_FUNCTIONS.includes(fn.proname);
      assert(isAllowed, `Callable function ${fn.proname} is in the allow-list`);
    } else {
      assert(true, `Privileged function ${fn.proname} is isolated (not executable by anon/auth)`);
    }

    if (fn.is_secdef) {
      const configStr = Array.isArray(fn.config) ? fn.config.join(',') : String(fn.config || '');
      const hasEmptySearchPath = configStr.includes('search_path=""') || configStr.includes("search_path=''");
      assert(hasEmptySearchPath, `Security definer function ${fn.proname} has search_path=''`);
    }
  }
}

async function main() {
  console.log('=== NOTE-07: Notes Data Layer Security Gate ===\n');

  await testPostgrestTableDenials();
  await testPostgrestInternalHelperDenials();

  // Catalog Audit source resolution
  let catalogPath = null;
  const mcpArgIdx = process.argv.indexOf('--mcp-results');
  if (mcpArgIdx !== -1 && process.argv[mcpArgIdx + 1]) {
    catalogPath = process.argv[mcpArgIdx + 1];
  } else if (fs.existsSync('.artifacts/notes/catalog-security-audit.json')) {
    catalogPath = '.artifacts/notes/catalog-security-audit.json';
  }

  if (catalogPath && fs.existsSync(catalogPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const audit = raw.audit || raw;
      verifyCatalogAudit(audit);
    } catch (e) {
      assert(false, `Failed to parse catalog audit results from ${catalogPath}: ${e.message}`);
    }
  } else {
    console.log('\n[NOTICE] No catalog audit file found. Run with --print-sql and execute via Supabase MCP to generate .artifacts/notes/catalog-security-audit.json');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal security verification error:', err);
  process.exit(1);
});
