-- Render with node scripts/seed-supabase.mjs, then execute with authenticated MCP.
-- A temporary HTTP extension and temporary staging tables are removed at commit.
begin;
set local statement_timeout = '240s';
set local lock_timeout = '5s';
do $guard$
begin
  if exists(select 1 from public.words) or exists(select 1 from public.verses) then
    raise exception 'Import requires empty Bible tables; existing data will not be overwritten';
  end if;
  if exists(select 1 from pg_extension where extname = 'http') then
    raise exception 'Temporary import expects http disabled; preserve an existing installation';
  end if;
end $guard$;
create extension http with schema extensions;
select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
create temporary table _step_sources(name text primary key, body text) on commit drop;
do $download$
declare s record; response record;
begin
  for s in select * from (values {{SOURCES}}) as sources(name,url,sha256,bytes) loop
    select * into response from extensions.http_get(s.url);
    if response.status <> 200 or octet_length(response.content) <> s.bytes
      or encode(extensions.digest(convert_to(response.content, 'UTF8'), 'sha256'), 'hex') <> s.sha256 then
      raise exception 'Source integrity check failed for % (HTTP %)', s.name, response.status;
    end if;
    insert into _step_sources values(s.name, response.content);
  end loop;
end $download$;

create temporary table _step_lex on commit drop as
with rows as (
  select s.name, n, string_to_array(line, E'\t') c
  from _step_sources s cross join lateral string_to_table(s.body, E'\n') with ordinality as l(line,n)
  where s.name in ('TBESH','TBESG') and line ~ '^[HG][0-9]{4,5}[A-Za-z]*\t'
), expanded as (
  select name,n,c, substring(c[2] from '^([HG][0-9]+[A-Za-z]*)') as root from rows
), aliases as (
  select root as tag,c,n,0 as priority from expanded where root is not null
  union all select c[1],c,n,1 from expanded
  union all select substring(c[1] from '^([HG][0-9]+)'),c,n,2 from expanded
)
select distinct on (tag) tag, c[4] as original, c[5] as transliteration,
  trim(regexp_replace(regexp_replace(replace(case when left(c[1],1)='H' then c[7] else c[8] end, '&nbsp;', ' '), '<[bB][rR][^>]*>', E'\n','g'), '<[^>]*>', '', 'g')) as definition
from aliases order by tag,priority,case when priority=0 then -n else n end;
create unique index on _step_lex(tag);

create temporary table _step_tokens on commit drop as
with rows as (
  select s.name,n,string_to_array(replace(line,E'\r',''),E'\t') c
  from _step_sources s cross join lateral string_to_table(s.body,E'\n') with ordinality as l(line,n)
  where s.name like 'TAHOT%' or s.name like 'TAGNT%'
), parsed as (
  select *, regexp_match(c[1], '^([1-3]?[A-Za-z]{2,3})\.([0-9]+)\.([0-9]+).*#([^=]+)=(.*)$') ref,
    regexp_match(c[2], '^(.*?)\s*\(([^()]*)\)\s*$') greek
  from rows where c[1] ~ '^([1-3]?[A-Za-z]{2,3})\.[0-9]+\.[0-9]+.*#'
), fields as (
  select name,n,array_position(array[{{BOOKS}}],ref[1])::smallint as book,
    ref[2]::smallint as chapter,ref[3]::smallint as verse_nr,
    case when name like 'TAHOT%' then coalesce(substring(c[5] from '\{(H[0-9]+[A-Za-z]*)'),substring(c[5] from '(H[0-9]+[A-Za-z]*)')) else substring(c[4] from '(G[0-9]+[A-Za-z]*)') end as root,
    case when name like 'TAHOT%' then replace(replace(c[2],'/',''),chr(92),'') else trim(greek[1]) end as original,
    case when name like 'TAHOT%' then replace(c[3],'/','') else greek[2] end as transliteration,
    case when name like 'TAHOT%' then c[6] else split_part(c[4],'=',-1) end as grammar,
    trim(regexp_replace(regexp_replace(case when name like 'TAHOT%' then c[4] else c[3] end, '<[bB][rR][^>]*>',E'\n','g'),'<[^>]*>','','g')) as translation
  from parsed where ref is not null and
    ((name like 'TAHOT%' and trim(c[2]) <> '') or (name like 'TAGNT%' and {{EDITION}}=any(regexp_split_to_array(c[6],'[+\s;,]+'))))
)
select *,root||E'\t'||original||E'\t'||grammar||E'\t'||transliteration as key from fields;

create temporary table _step_translations on commit drop as
select key,array_agg(translation order by frequency desc,translation collate "C") filter(where translation <> '') as translations
from (select key,translation,count(*) frequency from _step_tokens group by key,translation) counts group by key;
create unique index on _step_translations(key);
create temporary table _step_forms on commit drop as
select row_number() over(order by key collate "C")::integer id, key,
  min(root) root,min(original) original,min(transliteration) transliteration,min(grammar) grammar
from _step_tokens group by key;
create unique index on _step_forms(key);
analyze _step_forms;
analyze _step_tokens;
do $validate$
begin
  if (select count(*) from _step_tokens) <> {{TOKEN_COUNT}} or (select count(*) from _step_forms) <> {{WORD_COUNT}}
    or exists(select 1 from _step_tokens where root is null or book is null or original is null or transliteration is null or length(grammar)>30) then
    raise exception 'Database parser disagrees with offline audit';
  end if;
end $validate$;

insert into public.words(id,strongs_nr,grammar_code,original_word,transliteration,biblical_def,physical_def,english_translations,co_occurrences)
select f.id,left(f.root,1)||substring(f.root from '[0-9]+')::integer::text,f.grammar,f.original,f.transliteration,
  coalesce(nullif(exact.definition,''),nullif(base.definition,'')),null,coalesce(t.translations,'{}'::text[]),'[]'::jsonb
from _step_forms f left join _step_lex exact on exact.tag=f.root
left join _step_lex base on base.tag=regexp_replace(f.root,'[A-Za-z]+$','')
left join _step_translations t on t.key=f.key;
insert into public.verses(id,book,chapter,verse_nr,word_ids,millennium)
select row_number() over(order by book,chapter,verse_nr)::integer,book,chapter,verse_nr,array_agg(f.id order by n),null
from _step_tokens t join _step_forms f on f.key=t.key group by book,chapter,verse_nr;
do $complete$
begin
  if (select count(*) from public.verses) <> {{VERSE_COUNT}} or (select count(distinct book) from public.verses) <> 66 then
    raise exception 'Incomplete passage coverage';
  end if;
end $complete$;
select setval(pg_get_serial_sequence('public.verses','id'),(select max(id) from public.verses),true);
analyze public.words;
analyze public.verses;
drop extension http;
select jsonb_build_object('words',(select count(*) from public.words),'verses',(select count(*) from public.verses),'tokens',(select sum(cardinality(word_ids)) from public.verses),'books',(select count(distinct book) from public.verses)) as imported;
commit;
