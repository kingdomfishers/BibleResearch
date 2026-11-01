-- Canonical research RPCs. Word forms share lexical identity through strongs_nr.
-- All functions run as the caller under RLS. Signatures match src/api/types.ts.
create or replace function public.resolve_word_id(p_query text)
returns integer language sql stable set search_path = '' as $$
  select coalesce(
    (select w.id from public.words w where w.id=case when p_query ~ '^[0-9]{1,9}$' then p_query::integer end),
    (select w.id from public.words w where w.strongs_nr=upper(regexp_replace(p_query,'^([HG])0+([0-9])','\1\2','i')) order by w.id limit 1),
    (select w.id from public.words w where w.original_word=p_query order by w.id limit 1),
    (select w.id from public.words w where w.transliteration ilike p_query order by w.id limit 1)
  );
$$;

create or replace function public.prompt_verse_words(p_book smallint,p_chapter smallint,p_verse smallint)
returns table(word_position integer,word_id integer,original_word text,transliteration text,strongs_nr varchar,grammar_code varchar,primary_english text,millennium smallint)
language sql stable set search_path = '' as $$
  select u.ord::integer,w.id,w.original_word,w.transliteration,w.strongs_nr,w.grammar_code,w.english_translations[1],v.millennium
  from public.verses v cross join lateral unnest(v.word_ids) with ordinality u(word_id,ord)
  join public.words w on w.id=u.word_id
  where v.book=p_book and v.chapter=p_chapter and v.verse_nr=p_verse order by u.ord;
$$;

create or replace function public.prompt_word_occurrences(p_word_query text)
returns table(book smallint,chapter smallint,verse_nr smallint,millennium smallint,occurrence_count integer)
language sql stable set search_path = '' as $$
  with target as materialized (
    select array_agg(w.id) as ids from public.words w
    where w.strongs_nr=(select r.strongs_nr from public.words r where r.id=public.resolve_word_id(p_word_query))
  )
  select v.book,v.chapter,v.verse_nr,v.millennium,
    (select count(*)::integer from unnest(v.word_ids) u(id) where u.id=any(t.ids))
  from target t join public.verses v on v.word_ids && t.ids order by v.book,v.chapter,v.verse_nr;
$$;

create or replace function public.prompt_word_cooccurrences(p_word_query text)
returns table(word_id integer,strongs_nr varchar,original_word text,transliteration text,primary_english text,score numeric,frequency integer,avg_distance numeric)
language sql stable set search_path = '' as $$
  with target as materialized (
    select w.co_occurrences from public.words w
    where w.strongs_nr=(select r.strongs_nr from public.words r where r.id=public.resolve_word_id(p_word_query))
    order by w.id limit 1
  )
  select w.id,w.strongs_nr,w.original_word,w.transliteration,w.english_translations[1],
    (c.elm->>'score')::numeric,(c.elm->>'freq')::integer,(c.elm->>'avg_dist')::numeric
  from target t cross join lateral jsonb_array_elements(t.co_occurrences) c(elm)
  join public.words w on w.id=(c.elm->>'word_id')::integer
  order by (c.elm->>'score')::numeric desc,w.id;
$$;

create or replace function public.prompt_word_relationships(p_word_ids integer[])
returns table(book smallint,chapter smallint,verse_nr smallint,millennium smallint,relationship_score numeric)
language sql stable set search_path = '' as $$
  with selected as materialized (
    select distinct w.strongs_nr from public.words w where w.id=any(p_word_ids)
  ), targets as materialized (
    select w.strongs_nr,array_agg(w.id) as ids from public.words w join selected s using(strongs_nr) group by w.strongs_nr
  ), anchor as (
    select t.ids from targets t order by cardinality(t.ids),t.strongs_nr limit 1
  )
  select v.book,v.chapter,v.verse_nr,v.millennium,
    round((select count(*)::numeric from selected)/greatest(cardinality(v.word_ids),1)::numeric*100,2)
  from anchor a join public.verses v on v.word_ids && a.ids
  where cardinality(p_word_ids)>0
    and not exists(select 1 from unnest(p_word_ids) q(id) where not exists(select 1 from public.words w where w.id=q.id))
    and not exists(select 1 from targets t where not(v.word_ids && t.ids))
  order by 5 desc,v.book,v.chapter,v.verse_nr;
$$;

grant execute on function public.resolve_word_id(text),public.prompt_verse_words(smallint,smallint,smallint),
  public.prompt_word_occurrences(text),public.prompt_word_cooccurrences(text),public.prompt_word_relationships(integer[]) to anon,authenticated;
