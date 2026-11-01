-- Additive source renderings and private per-occurrence overrides.
create table public.verse_translation_sources (
  verse_id integer not null references public.verses(id),
  word_position integer not null check (word_position > 0),
  word_id integer not null references public.words(id),
  source_english text not null,
  grammar_code text not null,
  source_name text not null,
  source_ref text not null,
  source_commit text not null check (length(source_commit) = 40),
  primary key (verse_id, word_position),
  unique (verse_id, word_position, word_id)
);
create index verse_translation_sources_word on public.verse_translation_sources(word_id);
alter table public.verse_translation_sources enable row level security;
revoke all on public.verse_translation_sources from public, anon, authenticated;
grant select on public.verse_translation_sources to anon, authenticated;
create policy translation_sources_read on public.verse_translation_sources
  for select to anon, authenticated using (true);

create table public.word_translation_choices (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  verse_id integer not null,
  word_position integer not null,
  word_id integer not null,
  english text not null check (length(english) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, verse_id, word_position),
  foreign key (verse_id, word_position, word_id)
    references public.verse_translation_sources(verse_id, word_position, word_id)
);
create index word_translation_choices_occurrence
  on public.word_translation_choices(verse_id, word_position, word_id);
alter table public.word_translation_choices enable row level security;
revoke all on public.word_translation_choices from public, anon, authenticated;
-- Anonymous reads receive zero choice rows under RLS, allowing a public read RPC.
grant select on public.word_translation_choices to anon, authenticated;
grant insert, update, delete on public.word_translation_choices to authenticated;
create policy translation_choices_read on public.word_translation_choices
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy translation_choices_insert on public.word_translation_choices
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy translation_choices_update on public.word_translation_choices
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy translation_choices_delete on public.word_translation_choices
  for delete to authenticated using ((select auth.uid()) = owner_id);
