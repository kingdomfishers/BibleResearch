// Offline/live integrity verification; uses only the configured public key.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = '.artifacts/stepbible';
const words = JSON.parse(await readFile(`${dir}/words.json`, 'utf8'));
const verses = JSON.parse(await readFile(`${dir}/verses.json`, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const wordHash = hash(words.map(w => [w.id,w.strongs_nr,w.original_word,w.transliteration,w.grammar_code].join('\t')).join('\n'));
const verseHash = hash(verses.map(v => [v.id,v.book,v.chapter,v.verse_nr,v.word_ids.join(',')].join('\t')).join('\n'));
const sql = `select jsonb_build_object(
 'word_identity_match', (select encode(extensions.digest(convert_to(string_agg(id::text||E'\\t'||strongs_nr||E'\\t'||original_word||E'\\t'||transliteration||E'\\t'||grammar_code,E'\\n' order by id),'UTF8'),'sha256'),'hex') from public.words)='${wordHash}',
 'verse_sequence_match', (select encode(extensions.digest(convert_to(string_agg(id::text||E'\\t'||book||E'\\t'||chapter||E'\\t'||verse_nr||E'\\t'||array_to_string(word_ids,','),E'\\n' order by id),'UTF8'),'sha256'),'hex') from public.verses)='${verseHash}') as corpus_integrity;`;
await writeFile(`${dir}/verify.sql`, sql);
console.log(JSON.stringify({ wordHash,verseHash,words:words.length,verses:verses.length }));
if (process.argv.includes('--offline')) process.exit(0);
const env = Object.fromEntries((await readFile('.env','utf8')).split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const base = env.VITE_SUPABASE_URL;
if (base !== 'https://ejoperxiwxlcbsqrkrvb.supabase.co') throw new Error('Unexpected project; refuse verification');
const headers = { apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${env.VITE_SUPABASE_ANON_KEY}`,'Content-Type':'application/json' };
const rpc = async (name,args) => {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
};
for (const [book,chapter,verse] of [[1,1,1],[19,23,1],[40,5,3],[43,1,1],[66,22,21]]) {
  const rows = await rpc('prompt_verse_words',{p_book:book,p_chapter:chapter,p_verse:verse});
  const expected = verses.find(v => v.book===book && v.chapter===chapter && v.verse_nr===verse);
  if (rows.length!==expected.word_ids.length || rows.some((t,i)=>t.word_id!==expected.word_ids[i])) throw new Error(`Passage mismatch ${book}-${chapter}-${verse}`);
  console.log(`${book}-${chapter}-${verse}: ${rows.length} ordered live tokens`);
}
const occurrences = await rpc('prompt_word_occurrences',{p_word_query:'H7225'});
if (occurrences.length!==49 || occurrences.reduce((n,v)=>n+v.occurrence_count,0)!==51) throw new Error('Incomplete Strong search');
const related = await rpc('prompt_word_cooccurrences',{p_word_query:'H7225'});
if (related.length!==15 || related.some(r=>!r.frequency || !r.avg_distance)) throw new Error('Missing co-occurrence cache');
const first = verses.find(v=>v.book===1&&v.chapter===1&&v.verse_nr===1);
const relationships = await rpc('prompt_word_relationships',{p_word_ids:first.word_ids.slice(0,2)});
if (!relationships.some(v=>v.book===1&&v.chapter===1&&v.verse_nr===1)) throw new Error('Missing lexical relationship');
const details = await fetch(`${base}/rest/v1/words?id=eq.${first.word_ids[0]}&select=id,biblical_def,physical_def`,{headers});
if (!details.ok || !(await details.json())[0]?.biblical_def) throw new Error('Word details unavailable');
console.log('All four RPC endpoints and word details passed with the public key.');
