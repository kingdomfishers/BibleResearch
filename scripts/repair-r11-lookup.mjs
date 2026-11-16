/** Targeted repair of derived English lookup shards; preserves evidence/profile assets. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { computeBucketHex } from '../src/relationships/adjacency-loader.ts';
const root = path.resolve('.artifacts-r10/staging/v2/relationships/r11-v1.0');
const read = p => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.\-_'’"`]/g, '').trim();
const shards = Array.from({ length: 64 }, () => new Map());
const profiles = new Map();
for (let i = 0; i < 64; i++) {
  const hex = i.toString(16).padStart(2, '0');
  for (const [k, v] of Object.entries(read(path.join(root, `r10/lemma-profiles/shard-${hex}.json.gz`)).entries)) profiles.set(k, v);
  for (const [key, entries] of read(path.join(root, `r10/lemma-lookup/shard-${hex}.json.gz`)).entries) {
    shards[i].set(key, entries.map(e => {
      const clean = norm(e.gl.replace(/\([^)]*\)/g, ''));
      const tokens = clean.split(/[^a-z0-9]+/);
      // Parenthetical naming context is not a lexical definition.
      const rank = !tokens.includes(key) && norm(e.gl).includes(key) && /[()]/.test(e.gl) ? Math.min(25, e.match_rank) : e.match_rank;
      return { ...e, match_rank: rank };
    }));
  }
}
function rows(table) {
  const dir = path.resolve('.artifacts/static-corpus/tables', table);
  return fs.readdirSync(dir).filter(n => n.endsWith('.jsonl.gz')).sort().flatMap(n => zlib.gunzipSync(fs.readFileSync(path.join(dir, n))).toString().split('\n').filter(Boolean).map(JSON.parse));
}
const lemmas = new Map(rows('lemmas').map(l => [l.id, l]));
const stop = new Set(['the', 'of', 'and', 'to', 'a', 'an', 'in', 'for', 'with', 'from', 'one']);
function add(key, entry) {
  key = norm(key);
  if (key.length < 2 || stop.has(key)) return;
  const map = shards[parseInt(computeBucketHex('fnv1a64_mod64', 64, key), 16)];
  const list = map.get(key) || [];
  const old = list.findIndex(e => e.lk === entry.lk);
  if (old < 0) list.push(entry);
  else if (entry.match_rank > list[old].match_rank) list[old] = entry;
  map.set(key, list);
}
for (const sense of rows('lexical_senses')) {
  const l = lemmas.get(sense.lemma_id);
  if (!l || !sense.short_gloss) continue;
  const m = String(l.base_strongs || '').match(/^([HG])0*(\d+)/i);
  if (!m) continue;
  const bs = m[1].toUpperCase() + m[2].padStart(4, '0');
  const p = profiles.get(bs);
  const gloss = sense.short_gloss.replace(/\([^)]*\)/g, '').trim();
  const entry = { bs, lk: l.lemma_key, lang: l.language, sc: l.lemma_script, tr: l.transliteration, gl: sense.short_gloss,
    cnt: p?.total_verses || 0, is_prop: /-[LP]/.test(l.primary_pos || ''), vs: (p?.all_vids || []).slice(0, 12), match_rank: 95 };
  add(gloss, entry);
  for (const token of norm(gloss).split(/[^a-z0-9]+/)) add(token, { ...entry, match_rank: 85 });
}
const manifest = read(path.join(root, 'manifest.json.gz'));
for (let i = 0; i < 64; i++) {
  const hex = i.toString(16).padStart(2, '0');
  const entries = [...shards[i]].map(([key, list]) => [key, list.sort((a, b) => b.match_rank - a.match_rank || Number(b.cnt > 0) - Number(a.cnt > 0) || b.cnt - a.cnt).slice(0, 48)]);
  const raw = Buffer.from(JSON.stringify({ schema_version: 1, bucket: hex, entries }));
  const gz = zlib.gzipSync(raw, { level: 9 });
  const rel = `r10/lemma-lookup/shard-${hex}.json.gz`;
  // Atomic replacement avoids modifying hardlinked copies of old derived assets.
  fs.writeFileSync(path.join(root, rel + '.tmp'), gz);
  fs.renameSync(path.join(root, rel + '.tmp'), path.join(root, rel));
  Object.assign(manifest.files.find(f => f.path.endsWith('/' + rel)), { raw_bytes: raw.length, gz_bytes: gz.length,
    sha256_raw: crypto.createHash('sha256').update(raw).digest('hex'), sha256_gz: crypto.createHash('sha256').update(gz).digest('hex') });
}
manifest.lookup_repair = 'All licensed short glosses; parenthetical context downranked; no insertion-order exclusion; 48 candidates per token.';
for (const [name, bytes] of [['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))], ['manifest.json.gz', zlib.gzipSync(Buffer.from(JSON.stringify(manifest)), { level: 9 })]]) {
  fs.writeFileSync(path.join(root, name + '.tmp'), bytes);
  fs.renameSync(path.join(root, name + '.tmp'), path.join(root, name));
}
console.log('Repaired 64 lookup shards and manifest; preserved all source and evidence assets.');
