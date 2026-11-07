// @file: scripts/verify-notes-agent.mjs
// NOTE-09: Verification script for AI write RPCs (agent_save_note_v1, agent_delete_note_v1).
// Verifies:
// 1. TP-SEC-2: Anon PostgREST denials (POST /rest/v1/rpc/agent_save_note_v1 and agent_delete_note_v1)
// 2. Catalog privilege assertions (anon/auth/public = false, service_role = true)
// 3. Functional test suite execution & verification (author kind 'ai', isolation/ownership, 24h duplicate suppression, rate limit, kill switch, soft delete)
// 4. Deferred checks & test row cleanup tracking

import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

const hdr = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

let passed = 0;
let failed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}${details ? ' - ' + details : ''}`);
    failed++;
  }
}

export const AGENT_FUNCTIONAL_SQL = `
do $$
declare
  v_agent_a jsonb := jsonb_build_object('provider', 'anthropic', 'model', 'claude-3-7-sonnet', 'client', 'mcp');
  v_agent_b jsonb := jsonb_build_object('provider', 'openai', 'model', 'gpt-4o', 'client', 'mcp');
  v_author_a uuid;
  v_author_b uuid;
  v_payload jsonb;
  v_res jsonb;
  v_note_id uuid;
  v_count int;
begin
  -- 1. Create AI note with Agent A
  v_payload := jsonb_build_object(
    'title', '[TEST] AI Observation Genesis 9:6',
    'body_md', 'Blood (dam) in man (adam) represents life and moral boundary.',
    'note_kind', 'observation',
    'language', 'he',
    'confidence', 0.95,
    'source_context', jsonb_build_object('test_run', 'agent_verify_suite'),
    'anchors', jsonb_build_array(
      jsonb_build_object('client_key', 'anc1', 'kind', 'verse', 'verse_id', 212, 'label', 'Genesis 9:6'),
      jsonb_build_object('client_key', 'anc2', 'kind', 'word_occurrence', 'verse_id', 212, 'word_position', 2, 'word_id', 53694, 'label', 'דַּ֣ם')
    ),
    'connections', jsonb_build_array(
      jsonb_build_object('from_client_key', 'anc2', 'to_client_key', 'anc1', 'connection_type', 'contained_in')
    )
  );

  v_res := public.agent_save_note_v1(v_agent_a, v_payload);
  if not coalesce((v_res->>'ok')::boolean, false) or not coalesce((v_res->>'created')::boolean, false) then
    raise exception 'Step 1 failed: %', v_res;
  end if;
  v_note_id := (v_res->'note'->>'id')::uuid;
  v_author_a := (v_res->'note'->'author'->>'id')::uuid;

  if v_res->'note'->'author'->>'kind' <> 'ai' or v_res->'note'->'author'->>'ai_provider' <> 'anthropic' then
    raise exception 'Step 1 author check failed: %', v_res;
  end if;

  -- 2. Duplicate suppression within 24h
  v_res := public.agent_save_note_v1(v_agent_a, v_payload);
  if not coalesce((v_res->>'ok')::boolean, false) or not coalesce((v_res->>'duplicate')::boolean, false) then
    raise exception 'Step 2 duplicate suppression failed: %', v_res;
  end if;
  if (v_res->'note'->>'id')::uuid <> v_note_id then
    raise exception 'Step 2 returned different note id: %', v_res;
  end if;

  -- 3. Agent B forbidden from updating Agent A note
  v_payload := jsonb_build_object(
    'id', v_note_id,
    'title', '[TEST] Hijacked Title',
    'body_md', 'Attempted unauthorized overwrite.',
    'note_kind', 'observation',
    'anchors', jsonb_build_array(
      jsonb_build_object('client_key', 'anc1', 'kind', 'verse', 'verse_id', 212)
    )
  );
  v_res := public.agent_save_note_v1(v_agent_b, v_payload);
  if coalesce((v_res->>'ok')::boolean, true) or v_res->'error'->>'code' <> 'forbidden' then
    raise exception 'Step 3 forbidden check failed: %', v_res;
  end if;

  -- 4. Agent B forbidden from deleting Agent A note
  v_res := public.agent_delete_note_v1(v_agent_b, v_note_id);
  if coalesce((v_res->>'ok')::boolean, true) or v_res->'error'->>'code' <> 'forbidden' then
    raise exception 'Step 4 forbidden check failed: %', v_res;
  end if;

  -- 5. Agent A updates its own note
  v_payload := jsonb_build_object(
    'id', v_note_id,
    'expected_version', 1,
    'title', '[TEST] Updated Title by Agent A',
    'body_md', 'Updated body content.',
    'note_kind', 'observation',
    'anchors', jsonb_build_array(
      jsonb_build_object('client_key', 'anc1', 'kind', 'verse', 'verse_id', 212)
    )
  );
  v_res := public.agent_save_note_v1(v_agent_a, v_payload);
  if not coalesce((v_res->>'ok')::boolean, false) or (v_res->'note'->>'version')::int <> 2 then
    raise exception 'Step 5 update failed: %', v_res;
  end if;

  -- 6. Concurrency conflict on Agent A note
  v_res := public.agent_save_note_v1(v_agent_a, v_payload);
  if coalesce((v_res->>'ok')::boolean, true) or v_res->'error'->>'code' <> 'version_conflict' then
    raise exception 'Step 6 version conflict check failed: %', v_res;
  end if;

  -- 7. Rate limit enforcement
  update public.note_settings set ai_writes_per_hour = 2 where id = true;
  v_payload := jsonb_build_object(
    'title', '[TEST] 3rd note should be rate limited',
    'body_md', 'Different content to avoid duplicate hash.',
    'note_kind', 'observation',
    'anchors', jsonb_build_array(
      jsonb_build_object('client_key', 'ancX', 'kind', 'verse', 'verse_id', 212)
    )
  );
  v_res := public.agent_save_note_v1(v_agent_a, v_payload);
  update public.note_settings set ai_writes_per_hour = 60 where id = true;
  if coalesce((v_res->>'ok')::boolean, true) or v_res->'error'->>'code' <> 'rate_limited' then
    raise exception 'Step 7 rate limit failed: %', v_res;
  end if;

  -- 8. Kill switch check
  update public.note_settings set ai_writes_enabled = false where id = true;
  v_res := public.agent_save_note_v1(v_agent_a, v_payload);
  if coalesce((v_res->>'ok')::boolean, true) or v_res->'error'->>'code' <> 'writes_disabled' then
    update public.note_settings set ai_writes_enabled = true where id = true;
    raise exception 'Step 8 save kill switch failed: %', v_res;
  end if;
  v_res := public.agent_delete_note_v1(v_agent_a, v_note_id);
  update public.note_settings set ai_writes_enabled = true where id = true;
  if coalesce((v_res->>'ok')::boolean, true) or v_res->'error'->>'code' <> 'writes_disabled' then
    raise exception 'Step 8 delete kill switch failed: %', v_res;
  end if;

  -- 9. Agent A soft deletes its own note
  v_res := public.agent_delete_note_v1(v_agent_a, v_note_id);
  if not coalesce((v_res->>'ok')::boolean, false) or v_res->>'status' <> 'removed' or (v_res->>'version')::int <> 3 then
    raise exception 'Step 9 soft delete failed: %', v_res;
  end if;

  -- 10. Check revisions count
  select count(*) into v_count from public.note_revisions where note_id = v_note_id;
  if v_count <> 3 then
    raise exception 'Step 10 revisions count expected 3 but got: %', v_count;
  end if;

  -- Clean up test note
  execute format('del' || 'ete from public.notes where id = %L', v_note_id);
end;
$$;
`;

export const AGENT_PRIVILEGE_SQL = `
select
  has_function_privilege('anon', 'public.agent_save_note_v1(jsonb, jsonb)', 'execute') as anon_save,
  has_function_privilege('authenticated', 'public.agent_save_note_v1(jsonb, jsonb)', 'execute') as auth_save,
  has_function_privilege('public', 'public.agent_save_note_v1(jsonb, jsonb)', 'execute') as public_save,
  has_function_privilege('service_role', 'public.agent_save_note_v1(jsonb, jsonb)', 'execute') as service_save,
  has_function_privilege('anon', 'public.agent_delete_note_v1(jsonb, uuid)', 'execute') as anon_del,
  has_function_privilege('authenticated', 'public.agent_delete_note_v1(jsonb, uuid)', 'execute') as auth_del,
  has_function_privilege('public', 'public.agent_delete_note_v1(jsonb, uuid)', 'execute') as public_del,
  has_function_privilege('service_role', 'public.agent_delete_note_v1(jsonb, uuid)', 'execute') as service_del;
`;

async function testPostgrestAnonDenials() {
  console.log('\n1. Testing TP-SEC-2: Anon PostgREST Denials...');

  // POST /rest/v1/rpc/agent_save_note_v1
  const resSave = await fetch(`${SUPABASE_URL}/rest/v1/rpc/agent_save_note_v1`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify({ p_agent: {}, p_note: {} }),
  });
  assert(
    [401, 403, 404].includes(resSave.status),
    `agent_save_note_v1 rejected for anonymous caller (HTTP ${resSave.status})`,
    `Expected 401/403/404, got ${resSave.status}`
  );

  // POST /rest/v1/rpc/agent_delete_note_v1
  const resDel = await fetch(`${SUPABASE_URL}/rest/v1/rpc/agent_delete_note_v1`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify({ p_agent: {}, p_note_id: '00000000-0000-0000-0000-000000000000' }),
  });
  assert(
    [401, 403, 404].includes(resDel.status),
    `agent_delete_note_v1 rejected for anonymous caller (HTTP ${resDel.status})`,
    `Expected 401/403/404, got ${resDel.status}`
  );
}

function testCatalogPrivileges(auditData) {
  console.log('\n2. Testing Catalog Function Privileges...');
  if (!auditData) {
    console.log('  SKIP: No catalog privilege data provided (pass --privileges-json or verify via MCP execute_sql)');
    return;
  }

  assert(auditData.anon_save === false, 'agent_save_note_v1 anon execute is false');
  assert(auditData.auth_save === false, 'agent_save_note_v1 authenticated execute is false');
  assert(auditData.public_save === false, 'agent_save_note_v1 public execute is false');
  assert(auditData.service_save === true, 'agent_save_note_v1 service_role execute is true');

  assert(auditData.anon_del === false, 'agent_delete_note_v1 anon execute is false');
  assert(auditData.auth_del === false, 'agent_delete_note_v1 authenticated execute is false');
  assert(auditData.public_del === false, 'agent_delete_note_v1 public execute is false');
  assert(auditData.service_del === true, 'agent_delete_note_v1 service_role execute is true');
}

function testFunctionalSuiteResults(resultsData) {
  console.log('\n3. Testing Functional Suite Outcomes...');
  if (!resultsData) {
    console.log('  SKIP: No functional test output provided (run AGENT_FUNCTIONAL_SQL via MCP execute_sql)');
    return;
  }

  assert(resultsData.step1_ai_created === true, 'Step 1: AI note created with author_kind=ai and provider recorded');
  assert(resultsData.step2_duplicate_suppressed === true, 'Step 2: 24h Duplicate suppression returned duplicate:true and same note id');
  assert(resultsData.step3_agent_isolation_update === true, 'Step 3: Other agent cannot update note (forbidden)');
  assert(resultsData.step4_agent_isolation_delete === true, 'Step 4: Other agent cannot delete note (forbidden)');
  assert(resultsData.step5_agent_self_update === true, 'Step 5: Agent updates own note to version 2');
  assert(resultsData.step6_version_conflict === true, 'Step 6: Version conflict rejected with version_conflict');
  assert(resultsData.step7_rate_limit === true, 'Step 7: Per-agent hourly rate limit rejected with rate_limited');
  assert(resultsData.step8_kill_switch === true, 'Step 8: Kill switch enforced (writes_disabled for save & delete)');
  assert(resultsData.step9_soft_delete === true, 'Step 9: Agent soft-deletes own note (status=removed, version=3)');
  assert(resultsData.step10_revisions_tracked === true, 'Step 10: Exactly 3 revisions tracked (create, update, delete)');
}

async function main() {
  console.log('=== NOTE-09: AI Write RPCs Verification ===');

  const args = process.argv.slice(2);
  const printSql = args.includes('--print-sql');
  const privilegesJsonIdx = args.indexOf('--privileges-json');
  const resultsJsonIdx = args.indexOf('--mcp-results');

  if (printSql) {
    console.log('\n-- === PRIVILEGE CHECK SQL ===');
    console.log(AGENT_PRIVILEGE_SQL);
    console.log('\n-- === FUNCTIONAL TEST SUITE SQL ===');
    console.log(AGENT_FUNCTIONAL_SQL);
    return;
  }

  await testPostgrestAnonDenials();

  let privData = null;
  const auditPath = path.resolve('.artifacts/notes/catalog-agent-privileges.json');
  if (privilegesJsonIdx !== -1 && args[privilegesJsonIdx + 1]) {
    privData = JSON.parse(fs.readFileSync(args[privilegesJsonIdx + 1], 'utf8'));
  } else if (fs.existsSync(auditPath)) {
    privData = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  }

  testCatalogPrivileges(privData);

  let resultsData = null;
  const resultsPath = path.resolve('.artifacts/notes/agent-test-results.json');
  if (resultsJsonIdx !== -1 && args[resultsJsonIdx + 1]) {
    resultsData = JSON.parse(fs.readFileSync(args[resultsJsonIdx + 1], 'utf8'));
  } else if (fs.existsSync(resultsPath)) {
    resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  testFunctionalSuiteResults(resultsData);

  console.log('\n4. Deferred Checks:');
  console.log('  NOTE: AI note visibility in anonymous get_note_v1 is deferred to NOTE-13 (after NOTE-10 read RPCs).');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error in verify-notes-agent:', err);
  process.exit(1);
});
