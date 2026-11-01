// Prepare a hash-checked, atomic import without changing the existing corpus.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { BOOKS, SOURCE_COMMIT, parseText, wordKey } from './stepbible-parser.mjs';
const dir = '.artifacts/stepbible';
const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'));
assert.equal(manifest.commit, SOURCE_COMMIT);
assert.equal(manifest.edition, 'NA28');
const sha = s => createHash('sha256').update(s).digest('hex');
const literal = s => `'${String(s).replaceAll("'", "''")}'`;
const sources = manifest.sources.filter(s => /^TAHOT|^TAGNT/.test(s.name));
const tokens = [];
for (const source of sources) {
  const bytes = await readFile(`${dir}/${source.name}.txt`);
  assert.equal(bytes.length, source.bytes);
  assert.equal(sha(bytes), source.sha256);
  tokens.push(...parseText(bytes.toString('utf8'), source.name, manifest.edition));
}
const forms = [...new Set(tokens.map(wordKey))].sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)));
const wordIds = new Map(forms.map((k,i) => [k,i+1]));
const verses = JSON.parse(await readFile(`${dir}/verses.json`, 'utf8'));
const passages = new Map(verses.map(v => [`${v.book}-${v.chapter}-${v.verse_nr}`,v]));
const ordinals = new Map();
const audit = tokens.map(t => {
  const key = `${t.book}-${t.chapter}-${t.verse}`;
  const v = passages.get(key);
  const position = (ordinals.get(key) || 0)+1;
  ordinals.set(key,position);
  const id = wordIds.get(wordKey(t));
  assert.equal(v.word_ids[position-1],id);
  return { verseId:v.id,position,id,t };
}).sort((a,b) => a.verseId-b.verseId || a.position-b.position);
assert.equal(audit.length,manifest.tokens);
assert.equal(forms.length,manifest.words);
for (const [key,v] of passages) assert.equal(ordinals.get(key),v.word_ids.length);
const expectedHash = sha(audit.map(({verseId,position,id,t}) =>
  [verseId,position,id,t.translation,t.grammar,t.sourceRef].join('\t')).join('\n'));

// Reuse the established SQL parser to retain exactly the corpus edition/order.
const original = await readFile('scripts/import-stepbible.sql','utf8');
const start = original.indexOf('create temporary table _step_tokens');
const end = original.indexOf('create temporary table _step_translations');
assert(start >= 0 && end > start);
let parser = original.slice(start,end);
assert(parser.includes('select name,n,array_position'));
parser = parser.replace('select name,n,array_position','select name,n,c[1] as source_ref,array_position')
  .replaceAll('{{BOOKS}}',BOOKS.map(literal).join(','))
  .replaceAll('{{EDITION}}',literal(manifest.edition));
const sourceRows = sources.map(s => `(${literal(s.name)},${literal(s.url)},${literal(s.sha256)},${s.bytes})`).join(',\n');
const sql = `begin;
set local statement_timeout = '360s';
set local lock_timeout = '5s';
create temporary table _translation_extension_state on commit drop as
  select exists(select 1 from pg_extension where extname='http') as existed;
create extension if not exists http with schema extensions;
select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
select extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','15000');
create temporary table _step_sources(name text primary key,body text) on commit drop;
do $download$ declare s record; r record; attempt integer; begin
  for s in select * from (values ${sourceRows}) sources(name,url,sha256,bytes) loop
    for attempt in 1..3 loop
      begin
        select * into r from extensions.http_get(s.url);
        exit;
      exception when others then
        if attempt = 3 then raise; end if;
      end;
    end loop;
    if r.status <> 200 or octet_length(r.content) <> s.bytes
      or encode(extensions.digest(convert_to(r.content,'UTF8'),'sha256'),'hex') <> s.sha256 then
      raise exception 'Source hash verification failed: %',s.name;
    end if;
    insert into _step_sources values(s.name,r.content);
  end loop;
end $download$;
${parser}
-- Match the offline plain() entity decoding and trimming after HTML removal.
update _step_tokens set translation = btrim(replace(replace(translation,
  '&nbsp;', ' '), '&amp;', '&'), E' \\t\\n\\r' || chr(160));
create temporary table _translation_forms on commit drop as
  select row_number() over(order by key collate "C")::integer id,key from _step_tokens group by key;
create unique index on _translation_forms(key);
create temporary table _translation_import on commit drop as
  select v.id verse_id,(row_number() over(partition by v.id order by t.n))::integer word_position,
    f.id word_id,t.translation source_english,t.grammar grammar_code,t.name source_name,
    t.source_ref,${literal(SOURCE_COMMIT)}::text source_commit,t.original,t.transliteration
  from _step_tokens t join _translation_forms f using(key)
  join public.verses v on v.book=t.book and v.chapter=t.chapter and v.verse_nr=t.verse_nr;
do $validate$ declare actual_hash text; begin
  if (select count(*) from _translation_import) <> ${manifest.tokens}
    or (select count(*) from _translation_forms) <> ${manifest.words}
    or (select count(distinct verse_id) from _translation_import) <> ${manifest.verses}
    or exists(select 1 from _translation_import i
      join public.verses v on v.id=i.verse_id left join public.words w on w.id=i.word_id
      where v.word_ids[i.word_position] is distinct from i.word_id
        or w.original_word is distinct from i.original
        or w.grammar_code is distinct from i.grammar_code
        or w.transliteration is distinct from i.transliteration) then
    raise exception 'Occurrence import disagrees with the canonical corpus';
  end if;
  select encode(extensions.digest(convert_to(string_agg(
    verse_id::text||E'\\t'||word_position||E'\\t'||word_id||E'\\t'||source_english||E'\\t'||grammar_code||E'\\t'||source_ref,
    E'\\n' order by verse_id,word_position),'UTF8'),'sha256'),'hex') into actual_hash from _translation_import;
  if actual_hash <> '${expectedHash}' then
    raise exception 'Source rendering hash % disagrees with offline audit %', actual_hash, '${expectedHash}';
  end if;
  if exists(select 1 from public.verse_translation_sources s full join _translation_import i
    using(verse_id,word_position) where s.verse_id is not null and
      (i.verse_id is null or (s.word_id,s.source_english,s.grammar_code,s.source_ref,s.source_commit,s.source_name)
        is distinct from (i.word_id,i.source_english,i.grammar_code,i.source_ref,i.source_commit,i.source_name))) then
    raise exception 'Refuse to overwrite different existing source renderings';
  end if;
end $validate$;
insert into public.verse_translation_sources
  (verse_id,word_position,word_id,source_english,grammar_code,source_name,source_ref,source_commit)
  select verse_id,word_position,word_id,source_english,grammar_code,source_name,source_ref,source_commit
  from _translation_import on conflict (verse_id,word_position) do nothing;
analyze public.verse_translation_sources;
do $cleanup$ begin
  if not (select existed from _translation_extension_state) then
    drop extension http;
  end if;
end $cleanup$;
select jsonb_build_object('tokens',(select count(*) from public.verse_translation_sources),
  'verses',(select count(distinct verse_id) from public.verse_translation_sources),
  'source_hash','${expectedHash}') as translation_import;
commit;`;
await writeFile(`${dir}/import-translations.sql`,sql);
await writeFile(`${dir}/translation-audit.json`,JSON.stringify({tokens:audit.length,verses:verses.length,sha256:expectedHash},null,2));
console.log(JSON.stringify({tokens:audit.length,verses:verses.length,sha256:expectedHash,sqlBytes:Buffer.byteLength(sql)}));
