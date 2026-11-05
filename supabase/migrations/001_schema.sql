-- Canonical schema matching the deployed Bible tables.
-- Apply to a fresh database before 002_rpc_prompts.sql and the STEP importer.
create table public.words (
  id integer primary key,
  strongs_nr varchar(10) not null,
  grammar_code varchar(30),
  original_word text not null,
  transliteration text not null,
  co_occurrences jsonb default '[]'::jsonb,
  biblical_def text,
  physical_def text,
  english_translations text[] default '{}',
  gematria integer
);
create index idx_words_strongs on public.words(strongs_nr);
create index idx_words_translit on public.words(transliteration);
create index idx_words_original on public.words(original_word);
create index idx_words_gematria on public.words(gematria);

create table public.verses (
  id serial primary key,
  book smallint not null,
  chapter smallint not null,
  verse_nr smallint not null,
  word_ids integer[] not null,
  millennium smallint check(millennium between 1 and 7),
  unique(book,chapter,verse_nr)
);
create index idx_verses_word_ids_gin on public.verses using gin(word_ids);
create index idx_verses_reference on public.verses(book,chapter,verse_nr);
alter table public.words enable row level security;
alter table public.verses enable row level security;
create policy "Allow public read on words" on public.words for select using(true);
create policy "Allow public read on verses" on public.verses for select using(true);
revoke all privileges on table public.words,public.verses from anon,authenticated;
grant select on table public.words,public.verses to anon,authenticated;
