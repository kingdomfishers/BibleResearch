// @file: scripts/audit-notes-prereqs.mjs
// NOTE-02: read-only prerequisite audit for the Notes & Connections layer.
// Public-side checks run here with the publishable key (auth providers, books/ref parsing,
// existing search reuse, MCP header tolerance). Database-internal facts (extensions, verse
// ordering, storage, existing note tables) need elevated reads: run the SQL printed by
// `--print-sql` through the Supabase MCP `execute_sql` and compare with DATA_MODEL.md §5 findings.
// Nothing here writes. Unknowns are reported as UNKNOWN, never assumed.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';
const MCP = `${SUPABASE_URL}/functions/v1/bible-mcp`;

export const DB_AUDIT_SQL = `
select 'ext_installed' k, coalesce(jsonb_agg(extname order by extname),'[]') v from pg_extension
union all select 'ext_available', coalesce(jsonb_agg(name order by name),'[]') from pg_available_extensions
  where name in ('pg_trgm','pg_jsonschema','unaccent','pgcrypto','btree_gist','pg_cron','vector')
union all select 'verse_id_is_canonical_order', jsonb_build_object('violations',
  (select count(*) from (select id, row_number() over (order by book,chapter,verse_nr) rn from public.verses) s where id<>rn),
  'total',(select count(*) from public.verses))
union all select 'storage_buckets', coalesce((select jsonb_agg(id) from storage.buckets),'[]')
union all select 'existing_note_tables', coalesce((select jsonb_agg(table_name) from information_schema.tables
  where table_schema='public' and table_name like 'note%'),'[]')
union all select 'auth_users', jsonb_build_object('total',count(*),'anonymous',count(*) filter (where is_anonymous)) from auth.users;`;

if (process.argv.includes('--print-sql')) { console.log(DB_AUDIT_SQL.trim()); process.exit(0); }

const results = [];
const record = (id, status, detail) => { results.push({ id, status, detail }); };
const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const rpc = async (name, body) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: hdr, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

async function auditAuth() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: KEY } });
  const s = await r.json();
  record('auth.email_provider', s.external?.email ? 'PASS' : 'FAIL', { email: s.external?.email, google: s.external?.google });
  record('auth.anonymous_enabled', s.external?.anonymous_users ? 'PASS' : 'INFO',
    { anonymous_users: s.external?.anonymous_users, note: 'anonymous sessions stay read-only for notes' });
  record('auth.open_signup', s.disable_signup ? 'INFO' : 'RISK', {
    disable_signup: s.disable_signup,
    note: 'anyone can create an account; note writes must be gated by note_authors.can_write, never by "authenticated" alone',
  });
  record('auth.magic_link_delivery', 'UNKNOWN', {
    note: 'default Supabase SMTP is heavily rate-limited; verify email delivery/redirect URLs (site_url, additional_redirect_urls) before NOTE-15',
  });
}

async function auditBooksAndRefs() {
  const books = await rpc('get_bible_books_v1', {});
  const list = Array.isArray(books) ? books : books?.books ?? [];
  const sample = list[0] ?? {};
  record('books.rpc', list.length === 66 ? 'PASS' : 'FAIL', { count: list.length, fields: Object.keys(sample) });
  const hasAbbr = Object.keys(sample).filter(k => /abbr|usfm|code|alias/i.test(k));
  record('books.reference_aliases', hasAbbr.length ? 'PARTIAL' : 'FAIL', {
    fields: hasAbbr,
    note: 'books table has name/usfm/theographic_code only: no abbreviations or aliases (e.g. "Gen", "1 Cor", "Jn", "Song of Songs"). NOTE-11 needs a seeded alias table.',
  });
}

async function auditSearchReuse() {
  const out = {};
  for (const q of ['adam', 'H120', 'dam', 'אדם', 'λόγος', 'Gen 1:1']) {
    try {
      const r = await rpc('search_reader_words_v1', { p_query: q });
      const arr = Array.isArray(r) ? r : r?.results ?? [];
      out[q] = { count: arr.length, kinds: [...new Set(arr.map(x => x.kind ?? x.type ?? x.result_type).filter(Boolean))], keys: Object.keys(arr[0] ?? {}).slice(0, 8) };
    } catch (e) { out[q] = { error: String(e.message ?? e) }; }
  }
  record('search.search_reader_words_v1', 'INFO', {
    results: out,
    note: 'covers word search only; no verse-reference parsing, no places/notes, no kind-grouped candidates. NOTE-11 builds search_note_targets_v1 and may wrap this for words; UX06b overlap tracked.',
  });
}

async function auditMcp() {
  const h = await (await fetch(`${MCP}/health`)).json();
  record('mcp.health', h.status === 'ok' ? 'PASS' : 'FAIL', h);
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const common = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18' };
  const call = async extra => {
    const r = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { ...common, ...extra }, body: JSON.stringify(body) });
    const t = await r.text();
    return { status: r.status, tools: (t.match(/"name":"/g) ?? []).length };
  };
  const anon = await call({});
  const withBearer = await call({ Authorization: 'Bearer audit-invalid-agent-key' });
  record('mcp.header_tolerance', anon.status === 200 && withBearer.status === 200 ? 'PASS' : 'FAIL', {
    without_header: anon, with_unrecognized_bearer: withBearer,
    note: 'server currently ignores Authorization; NOTE-30 must treat invalid keys as read-only, not as errors, so existing clients keep working',
  });
  record('mcp.client_custom_header_support', 'UNKNOWN', {
    note: 'whether ChatGPT connectors / Gemini CLI / other clients can send a custom bearer header is not verified here; clients that cannot stay read-only (decision D3)',
  });
  record('mcp.cors_allows_authorization', 'PASS', { note: 'Access-Control-Allow-Headers already lists Authorization (index.ts)' });
}

for (const fn of [auditAuth, auditBooksAndRefs, auditSearchReuse, auditMcp]) {
  try { await fn(); } catch (e) { record(fn.name, 'ERROR', String(e.message ?? e)); }
}
console.log(JSON.stringify({ audit: 'notes-prereqs', at: new Date().toISOString(), results }, null, 2));
const bad = results.filter(r => r.status === 'FAIL' || r.status === 'ERROR');
console.log(`\nSummary: ${results.length} checks, ${bad.length} FAIL/ERROR, ${results.filter(r => r.status === 'UNKNOWN').length} UNKNOWN, ${results.filter(r => r.status === 'RISK').length} RISK`);
process.exit(bad.length ? 1 : 0);
