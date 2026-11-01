-- Database-native lexical co-occurrence cache. No browser joins or scoring.
-- One cache per Strong's number, stored on its lowest-ID representative form.
begin;
set local statement_timeout = '240s';
create temporary table _step_roots on commit drop as
select strongs_nr,min(id) as word_id from public.words group by strongs_nr;
create unique index on _step_roots(strongs_nr);
create temporary table _step_positions on commit drop as
select v.id as verse_id,u.ord as position,r.word_id
from public.verses v cross join lateral unnest(v.word_ids) with ordinality u(word_id,ord)
join public.words w on w.id=u.word_id join _step_roots r on r.strongs_nr=w.strongs_nr;
create index on _step_positions(verse_id);
analyze _step_positions;
create temporary table _step_pairs on commit drop as
select a.word_id as word_a,b.word_id as word_b,count(*)::integer as freq,
  avg(abs(a.position-b.position)) as avg_dist
from _step_positions a join _step_positions b on b.verse_id=a.verse_id and a.word_id<b.word_id
group by a.word_id,b.word_id;
with directed as (
  select word_a as word_id,word_b as other_id,freq,avg_dist from _step_pairs
  union all select word_b,word_a,freq,avg_dist from _step_pairs
), ranked as (
  select *,freq::numeric/(1+avg_dist) as score,
    row_number() over(partition by word_id order by freq::numeric/(1+avg_dist) desc,other_id) as rank
  from directed
), caches as (
  select word_id,jsonb_agg(jsonb_build_object('word_id',other_id,'freq',freq,'avg_dist',round(avg_dist,2),'score',round(score,6)) order by rank) as data
  from ranked where rank<=15 group by word_id
)
update public.words w set co_occurrences=c.data from caches c where w.id=c.word_id;
analyze public.words;
select jsonb_build_object('cached_strongs',(select count(*) from public.words where jsonb_array_length(co_occurrences)>0),'pairs',(select count(*) from _step_pairs)) as cooccurrences;
commit;
