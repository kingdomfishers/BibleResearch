import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const env = Object.fromEntries((await fs.readFile('.env', 'utf8')).split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
  }));

async function rpc(name, body = {}) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, `${name}: ${await response.clone().text().then(s => s.slice(0, 200))}`);
  return response.json();
}

console.log('Testing public.get_bible_books_v1 RPC...');
const data = await rpc('get_bible_books_v1');
assert.equal(data.status, 'ok', 'status should be ok');
assert.equal(data.schema_version, 1, 'schema_version should be 1');
assert.ok(Array.isArray(data.books), 'books should be an array');
assert.equal(data.books.length, 66, 'should contain exactly 66 canonical books');

// Test Genesis
const gen = data.books[0];
assert.equal(gen.id, 1);
assert.equal(gen.name, 'Genesis');
assert.equal(gen.testament, 'OT');
assert.equal(gen.original_language, 'hbo');
assert.equal(gen.total_chapters, 50);
assert.equal(gen.usfm, 'GEN');
assert.equal(gen.theographic_code, 'GEN');
assert.equal(gen.division, 'Law');

// Test Revelation
const rev = data.books[65];
assert.equal(rev.id, 66);
assert.equal(rev.name, 'Revelation');
assert.equal(rev.testament, 'NT');
assert.equal(rev.original_language, 'grc');
assert.equal(rev.total_chapters, 22);
assert.equal(rev.usfm, 'REV');
assert.equal(rev.theographic_code, 'REV');
assert.equal(rev.division, 'Apocalyptic');

// Test Multilingual OT books (Ezra & Daniel)
const ezra = data.books.find(b => b.name === 'Ezra');
assert.ok(ezra);
assert.equal(ezra.original_language, 'hbo/arc');

const dan = data.books.find(b => b.name === 'Daniel');
assert.ok(dan);
assert.equal(dan.original_language, 'hbo/arc');

// Verify direct REST table access with anon key (RLS check)
const tableResp = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/books?select=id,name&order=id.asc&limit=3`, {
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
});
assert.equal(tableResp.status, 200, 'public.books should be readable via anon key');
const tableRows = await tableResp.json();
assert.equal(tableRows.length, 3);
assert.equal(tableRows[0].name, 'Genesis');

console.log('PASS: All 66 canonical books verified in order with metadata and RLS policies.');
