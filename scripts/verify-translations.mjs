import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const env = Object.fromEntries((await readFile('.env','utf8')).split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{
  const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];
}));
const base=env.VITE_SUPABASE_URL;
assert.equal(base,'https://ejoperxiwxlcbsqrkrvb.supabase.co');
const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_ANON_KEY;
const headers={apikey:key,'Content-Type':'application/json'};
const rpc=async(name,args)=>{
  const r=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args)});
  assert(r.ok,`${name}: ${r.status}`); return r.json();
};
const verses=JSON.parse(await readFile('.artifacts/stepbible/verses.json','utf8'));
for(const [book,chapter,verse] of [[1,1,1],[1,1,2],[19,0,0],[19,3,0],[43,1,1],[66,22,21]]){
  const p={p_book:book,p_chapter:chapter,p_verse:verse};
  const rows=await rpc('get_verse_translations_v1',p);
  const expected=verses.find(v=>v.book===book&&v.chapter===chapter&&v.verse_nr===verse);
  assert.deepEqual(rows.map(t=>t.word_id),expected?.word_ids??[]);
  for(const t of rows){
    assert.equal(t.has_choice,false);
    assert.equal(t.primary_english,t.source_english);
    assert(t.english_translations.includes(t.source_english));
    assert(t.source_ref);
  }
  if(book===1&&verse===1){
    assert.equal(rows[1].primary_english,'he created');
    assert.equal(rows[3].primary_english,'');
    assert(rows[6].english_translations.includes('the/ land'));
  }
}
const denied=await fetch(`${base}/rest/v1/rpc/save_word_translation_v1`,{method:'POST',headers,
  body:JSON.stringify({p_book:1,p_chapter:1,p_verse:1,p_word_position:7,p_word_id:38401,p_english:'the/ land'})});
assert([401,403].includes(denied.status));
// Transactional fixture users and choices never survive this SQL verification.
const sql=`begin;
create temporary table _translation_test_users as select gen_random_uuid() a,gen_random_uuid() b;
grant select on _translation_test_users to authenticated;
insert into auth.users(id,is_anonymous) select a,true from _translation_test_users union all select b,true from _translation_test_users;
select set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true) from _translation_test_users;
set local role authenticated;
select public.save_word_translation_v1(1,1,1,7,38401,'the/ land');
do $test$ begin
  if not (select has_choice and primary_english='the/ land' from public.get_verse_translations_v1(1,1,1) where word_position=7) then
    raise exception 'Saved choice was not restored'; end if;
  begin
    perform public.save_word_translation_v1(1,1,1,7,38401,'invented translation');
    raise exception 'Invalid rendering accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_word_translation_v1(1,1,1,6,38401,'the/ land');
    raise exception 'Wrong word position accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.word_translation_choices set english='invented translation';
    raise exception 'Direct invalid update accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.word_translation_choices set owner_id=(select b from _translation_test_users);
    raise exception 'Owner reassignment accepted';
  exception when insufficient_privilege then null; end;
end $test$;
select set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true) from _translation_test_users;
do $test$ begin
  if exists(select 1 from public.word_translation_choices) or
    (select has_choice from public.get_verse_translations_v1(1,1,1) where word_position=7) then
    raise exception 'Private choice leaked to second reader'; end if;
  update public.word_translation_choices set english='the/ ground';
  if found then raise exception 'Second reader can overwrite choice'; end if;
  delete from public.word_translation_choices;
  if found then raise exception 'Second reader can delete choice'; end if;
end $test$;
select public.save_word_translation_v1(1,1,1,7,38401,'the/ ground');
select set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true) from _translation_test_users;
do $test$ begin
  if (select primary_english from public.get_verse_translations_v1(1,1,1) where word_position=7) <> 'the/ land' then
    raise exception 'Second reader changed first reader choice'; end if;
end $test$;
select public.reset_word_translation_v1(1,1,1,7,38401);
do $test$ begin
  if (select has_choice or primary_english<>'the/ earth' from public.get_verse_translations_v1(1,1,1) where word_position=7) then
    raise exception 'Reset did not restore source'; end if;
end $test$;
reset role;
rollback;
select 'private saving, reset, input validation, direct-write validation, and ownership isolation verified' result;`;
await writeFile('.artifacts/stepbible/verify-translation-ownership.sql',sql);
console.log('Passed public source/order/grammar and denied-write checks; prepared rollback-only ownership SQL.');
