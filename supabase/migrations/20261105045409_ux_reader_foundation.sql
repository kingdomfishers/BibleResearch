-- Additive reading workspace. All joins, lexical grouping and pagination stay in SQL.
create table public.reader_english_editions (
  id text primary key, name text not null, source_url text not null,
  sha256 text not null, license text not null, mapping_note text not null
);
create table public.reader_english_verses (
  edition_id text not null references public.reader_english_editions(id),
  book smallint not null check(book between 1 and 66),
  chapter smallint not null check(chapter between 1 and 150),
  verse_nr smallint not null check(verse_nr between 0 and 176),
  text text not null check(length(text)>0),
  primary key(edition_id,book,chapter,verse_nr)
);
insert into public.reader_english_editions values (
 'webp-2026-11','World English Bible','https://ebible.org/Scriptures/engwebp_usfm.zip',
 'A93DF5571009FED56F77E3AC1D3CE71C9A3A3DF1486F7570CC7A8F823192FDBA',
 'Public domain','Same reference, separate edition; no English token alignment claimed.'
);

-- Labels describe observed renderings, not assigned token senses.
create function public.reader_usage_label_v1(p_strongs text,p_english text)
returns text language sql immutable set search_path='' as $$
 select case when p_strongs='H7307' then
   case when p_english ~* '\mwind(s)?\M' then 'wind'
        when p_english ~* '\mspirit(s)?\M' then 'spirit'
        when p_english ~* '\mbreath\M' then 'breath'
        when p_english ~* '\m(side|sides|quarter|quarters|direction|directions)\M' then 'direction / side'
        else btrim(regexp_replace(p_english,'\s*/\s*',' ','g')) end
 else btrim(regexp_replace(p_english,'\s*/\s*',' ','g')) end;
$$;
create table public.reader_rendering_groups (
  strongs_nr text not null, label text not null,
  token_total integer not null, verse_total integer not null,
  example_verse_id integer not null references public.verses(id),
  primary key(strongs_nr,label)
);
insert into public.reader_rendering_groups
 select w.strongs_nr,public.reader_usage_label_v1(w.strongs_nr,s.source_english),
 count(*)::integer,count(distinct s.verse_id)::integer,min(s.verse_id)
 from public.verse_translation_sources s join public.words w on w.id=s.word_id
 where nullif(btrim(s.source_english),'') is not null
 group by w.strongs_nr,public.reader_usage_label_v1(w.strongs_nr,s.source_english);
create index reader_rendering_rank on public.reader_rendering_groups(strongs_nr,token_total desc);

-- Audited textual associations. Dates intentionally absent when not established.
create table public.reader_text_events (
  event_key text primary key, title text not null, era text not null,
  reason text not null, source_url text not null, source_reference text not null,
  relationship text not null check(relationship in ('setting','parallel_text')),
  year_start integer, year_end integer,
  check(year_start is null or year_end is null or year_start<=year_end)
);
create table public.reader_text_event_links (
  event_key text not null references public.reader_text_events(event_key),
  book smallint not null, chapter smallint not null,
  start_verse smallint not null, end_verse smallint not null,
  label text not null,
  primary key(event_key,book,chapter), check(start_verse<=end_verse)
);
create index reader_event_passage on public.reader_text_event_links(book,chapter);
insert into public.reader_text_events(event_key,title,era,reason,source_url,source_reference,relationship) values
 ('david-flees-absalom','David flees Absalom','David’s reign',
 'Psalm 3’s superscription names David’s flight from Absalom; 2 Samuel 15 narrates the flight. This is an association of historical setting, not a proven composition year.',
 'https://ebible.org/engwebp/PSA003.htm','Psalm 3 superscription; 2 Samuel 15:13–37','setting'),
 ('david-nathan','Nathan confronts David','David’s reign',
 'Psalm 51’s superscription names Nathan’s visit after David went in to Bathsheba; 2 Samuel 12 narrates Nathan’s confrontation. No exact composition date is asserted.',
 'https://ebible.org/engwebp/PSA051.htm','Psalm 51 superscription; 2 Samuel 12:1–14','setting'),
 ('david-deliverance-song','David’s song of deliverance','David’s reign',
 'Psalm 18 and 2 Samuel 22 preserve parallel songs of deliverance. A parallel text does not establish an exact composition date.',
 'https://ebible.org/engwebp/PSA018.htm','Psalm 18; 2 Samuel 22','parallel_text');
insert into public.reader_text_event_links values
 ('david-flees-absalom',19,3,0,8,'Psalm 3'),('david-flees-absalom',10,15,13,37,'2 Samuel 15:13–37'),
 ('david-nathan',19,51,0,19,'Psalm 51'),('david-nathan',10,12,1,14,'2 Samuel 12:1–14'),
 ('david-deliverance-song',19,18,0,50,'Psalm 18'),('david-deliverance-song',10,22,1,51,'2 Samuel 22');

do $$ declare t text; begin
 foreach t in array array['reader_english_editions','reader_english_verses','reader_rendering_groups','reader_text_events','reader_text_event_links'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('grant select on public.%I to anon,authenticated',t);
   execute format('create policy public_read on public.%I for select to anon,authenticated using(true)',t);
 end loop;
end $$;

create function public.get_reader_passages_v1(p_passages jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_passages) is distinct from 'array' then return jsonb_build_object('status','invalid_request'); end if;
 if jsonb_array_length(p_passages)>12 or jsonb_array_length(p_passages)<1 then return jsonb_build_object('status','invalid_request'); end if;
 if exists(select 1 from jsonb_array_elements(p_passages) p where
   coalesce(p->>'book','') !~ '^[0-9]{1,2}$' or coalesce(p->>'chapter','') !~ '^[0-9]{1,3}$'
   or coalesce(p->>'verse','') !~ '^[0-9]{1,3}$') then return jsonb_build_object('status','invalid_request'); end if;
 return jsonb_build_object('status','ok','passages',(
  select jsonb_agg(jsonb_build_object('passage',p,'text',e.text,'edition','World English Bible',
   'edition_id','webp-2026-11','mapping_status',case when e.text is null then 'unavailable' else 'same_reference' end) order by ord)
  from jsonb_array_elements(p_passages) with ordinality q(p,ord)
  left join public.reader_english_verses e on e.edition_id='webp-2026-11'
   and e.book=(p->>'book')::integer and e.chapter=(p->>'chapter')::integer and e.verse_nr=(p->>'verse')::integer
 ));
end $$;

create function public.get_reader_overview_v1(p_book integer,p_chapter integer,p_verse integer)
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' as $$
 with passage as materialized (select * from public.verses where book=p_book and chapter=p_chapter and verse_nr=p_verse),
 tokens as materialized (select w.*,u.ord from passage v cross join lateral unnest(v.word_ids) with ordinality u(id,ord) join public.words w on w.id=u.id),
 ranges as (select distinct t.strongs_nr from tokens t)
 select jsonb_build_object('status',case when exists(select 1 from passage) then 'ok' else 'passage_not_found' end,
  'ranges',coalesce((select jsonb_object_agg(r.strongs_nr,(
   select coalesce(jsonb_agg(to_jsonb(g) order by g.rank), '[]'::jsonb) from (
    select rg.label,rg.token_total,rg.verse_total,v.book,v.chapter,v.verse_nr as verse,
      row_number() over(order by case when r.strongs_nr='H7307' and rg.label in ('wind','spirit','breath','direction / side') then 0 else 1 end,rg.token_total desc,rg.label) rank
    from public.reader_rendering_groups rg join public.verses v on v.id=rg.example_verse_id
    where rg.strongs_nr=r.strongs_nr order by rank limit 4
   )g)) from ranges r),'{}'::jsonb),
  'grammar',coalesce((select jsonb_object_agg(t.ord,public.decode_grammar_v1(t.grammar_code)) from tokens t),'{}'::jsonb),
  'place_anchors',coalesce((select jsonb_agg(distinct jsonb_build_object('word_position',t.ord,'place_key',p.place_key,'name',p.biblical_name))
   from tokens t join public.places p on t.strongs_nr=any(p.strongs_numbers) and p.published
   join public.verse_geography vg on vg.place_id=p.id and vg.verse_id=(select id from passage) and vg.published),'[]'::jsonb),
  'previous',(select jsonb_build_object('book',v.book,'chapter',v.chapter,'verse',v.verse_nr) from public.verses v,passage p where v.id<p.id order by v.id desc limit 1),
  'next',(select jsonb_build_object('book',v.book,'chapter',v.chapter,'verse',v.verse_nr) from public.verses v,passage p where v.id>p.id order by v.id limit 1));
$$;

create function public.get_reader_word_v1(p_word_id integer,p_after integer default 0,p_rendering text default null)
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' as $$
 with target as materialized(select * from public.words where id=p_word_id),
 matched as materialized(
  select s.verse_id,s.word_position,s.word_id,s.source_english from target t
   join public.words w on w.strongs_nr=t.strongs_nr
   join public.verse_translation_sources s on s.word_id=w.id
  where p_rendering is null or public.reader_usage_label_v1(t.strongs_nr,s.source_english)=p_rendering
 ), grouped as materialized(select verse_id,count(*)::integer occurrence_count,min(source_english) source_english from matched group by verse_id),
 paged as (select g.*,v.book,v.chapter,v.verse_nr as verse from grouped g join public.verses v on v.id=g.verse_id where g.verse_id>greatest(p_after,0) order by g.verse_id limit 12)
 select jsonb_build_object('status',case when exists(select 1 from target) then 'ok' else 'word_not_found' end,
  'word',(select to_jsonb(t) from target t),
  'lexemes',coalesce((select jsonb_agg(to_jsonb(l)) from public.lexemes l join target t on l.base_strongs=t.strongs_nr),'[]'::jsonb),
  'token_total',(select count(*) from matched),'verse_total',(select count(*) from grouped),
  'scope','Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
  'occurrences',coalesce((select jsonb_agg(to_jsonb(p) order by p.verse_id) from paged p),'[]'::jsonb),
  'next_cursor',case when exists(select 1 from grouped where verse_id>(select max(verse_id) from paged)) then (select max(verse_id) from paged) end);
$$;

create function public.search_reader_words_v1(p_query text)
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='4s' as $$
 with q as(select left(btrim(p_query),80) text),
 candidates as(select w.id,w.strongs_nr,w.original_word,w.transliteration,w.biblical_def,
  case when w.strongs_nr=upper(q.text) then 0 when w.original_word=q.text then 1 when w.transliteration ilike q.text||'%' then 2 else 3 end rank,
  row_number() over(partition by w.strongs_nr order by w.id) form_rank
  from public.words w,q where length(q.text)>=2 and (w.strongs_nr=upper(q.text) or w.original_word=q.text
   or w.transliteration ilike q.text||'%' or w.biblical_def ilike q.text or q.text=any(w.english_translations)))
 select coalesce(jsonb_agg(to_jsonb(c) order by c.rank,c.strongs_nr),'[]'::jsonb)
 from (select * from candidates where form_rank=1 order by rank,strongs_nr limit 12)c;
$$;

create function public.get_reader_timeline_v1(p_book integer,p_chapter integer,p_verse integer,p_model_id text default 'theographic-verse-v1')
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' as $$
 with active as materialized(select e.* from public.reader_text_event_links l join public.reader_text_events e using(event_key)
   where l.book=p_book and l.chapter=p_chapter and p_verse between l.start_verse and l.end_verse),
 context as materialized(select public.get_verse_chronology_v1(p_book,p_chapter,p_verse,p_model_id) packet),
 published as materialized(select distinct e.id,e.event_key,e.title,e.start_year,l.relationship from public.chronology_event_links l
  join public.chronology_events e on e.id=l.event_id and e.published
  join public.verses v on v.id=l.verse_id where v.book=p_book and v.chapter=p_chapter and v.verse_nr=p_verse)
 select jsonb_build_object('status','ok','model_id',p_model_id,'summary',(select packet->'summary' from context),
  'events',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('passages',(
   select jsonb_agg(jsonb_build_object('book',l.book,'chapter',l.chapter,'verse',case when l.start_verse=0 then 1 else l.start_verse end,
    'label',l.label) order by l.book,l.chapter) from public.reader_text_event_links l where l.event_key=a.event_key))) from active a),'[]'::jsonb),
  'published_events',coalesce((select jsonb_agg(to_jsonb(p)) from published p),'[]'::jsonb),
  'neighbors',coalesce((select jsonb_agg(to_jsonb(n)) from (
    select e.event_key,e.title,e.start_year from public.chronology_events e,context c
    where e.published and (c.packet->'summary'->>'earliest_year') is not null
    order by abs(e.start_year-(c.packet->'summary'->>'earliest_year')::integer),e.id limit 3)n),'[]'::jsonb));
$$;

revoke all on function public.reader_usage_label_v1(text,text),public.get_reader_passages_v1(jsonb),
 public.get_reader_overview_v1(integer,integer,integer),public.get_reader_word_v1(integer,integer,text),
 public.search_reader_words_v1(text),public.get_reader_timeline_v1(integer,integer,integer,text) from public;
grant execute on function public.reader_usage_label_v1(text,text),public.get_reader_passages_v1(jsonb),
 public.get_reader_overview_v1(integer,integer,integer),public.get_reader_word_v1(integer,integer,text),
 public.search_reader_words_v1(text),public.get_reader_timeline_v1(integer,integer,integer,text) to anon,authenticated;
