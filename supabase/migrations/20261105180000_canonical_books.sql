-- Migration: 20261105180000_canonical_books.sql
-- Canonical public.books metadata table and get_bible_books_v1 RPC.

create table if not exists public.books (
  id smallint primary key check (id between 1 and 66),
  name text not null unique,
  testament text not null check (testament in ('OT', 'NT')),
  original_language text not null check (original_language in ('hbo', 'arc', 'grc', 'hbo/arc')),
  total_chapters smallint not null check (total_chapters between 1 and 150),
  usfm text not null unique,
  theographic_code text not null unique,
  division text not null check (division in (
    'Law', 'Historical', 'Poetical', 'Major Prophets', 'Minor Prophets',
    'Gospels', 'History', 'Pauline Epistles', 'General Epistles', 'Apocalyptic'
  ))
);

create index if not exists idx_books_usfm on public.books(usfm);
create index if not exists idx_books_theographic on public.books(theographic_code);

alter table public.books enable row level security;
revoke all on public.books from public, anon, authenticated;
grant select on public.books to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'books' and policyname = 'public_read_books') then
    create policy "public_read_books" on public.books for select to anon, authenticated using (true);
  end if;
end $$;

insert into public.books (id, name, testament, original_language, total_chapters, usfm, theographic_code, division)
values
  (1, 'Genesis', 'OT', 'hbo', 50, 'GEN', 'GEN', 'Law'),
  (2, 'Exodus', 'OT', 'hbo', 40, 'EXO', 'EXO', 'Law'),
  (3, 'Leviticus', 'OT', 'hbo', 27, 'LEV', 'LEV', 'Law'),
  (4, 'Numbers', 'OT', 'hbo', 36, 'NUM', 'NUM', 'Law'),
  (5, 'Deuteronomy', 'OT', 'hbo', 34, 'DEU', 'DEU', 'Law'),
  (6, 'Joshua', 'OT', 'hbo', 24, 'JOS', 'JOS', 'Historical'),
  (7, 'Judges', 'OT', 'hbo', 21, 'JDG', 'JDG', 'Historical'),
  (8, 'Ruth', 'OT', 'hbo', 4, 'RUT', 'RUT', 'Historical'),
  (9, '1 Samuel', 'OT', 'hbo', 31, '1SA', '1SA', 'Historical'),
  (10, '2 Samuel', 'OT', 'hbo', 24, '2SA', '2SA', 'Historical'),
  (11, '1 Kings', 'OT', 'hbo', 22, '1KI', '1KI', 'Historical'),
  (12, '2 Kings', 'OT', 'hbo', 25, '2KI', '2KI', 'Historical'),
  (13, '1 Chronicles', 'OT', 'hbo', 29, '1CH', '1CH', 'Historical'),
  (14, '2 Chronicles', 'OT', 'hbo', 36, '2CH', '2CH', 'Historical'),
  (15, 'Ezra', 'OT', 'hbo/arc', 10, 'EZR', 'EZR', 'Historical'),
  (16, 'Nehemiah', 'OT', 'hbo', 13, 'NEH', 'NEH', 'Historical'),
  (17, 'Esther', 'OT', 'hbo', 10, 'EST', 'EST', 'Historical'),
  (18, 'Job', 'OT', 'hbo', 42, 'JOB', 'JOB', 'Poetical'),
  (19, 'Psalms', 'OT', 'hbo', 150, 'PSA', 'PSA', 'Poetical'),
  (20, 'Proverbs', 'OT', 'hbo', 31, 'PRO', 'PRO', 'Poetical'),
  (21, 'Ecclesiastes', 'OT', 'hbo', 12, 'ECC', 'ECC', 'Poetical'),
  (22, 'Song of Solomon', 'OT', 'hbo', 8, 'SNG', 'SNG', 'Poetical'),
  (23, 'Isaiah', 'OT', 'hbo', 66, 'ISA', 'ISA', 'Major Prophets'),
  (24, 'Jeremiah', 'OT', 'hbo', 52, 'JER', 'JER', 'Major Prophets'),
  (25, 'Lamentations', 'OT', 'hbo', 5, 'LAM', 'LAM', 'Major Prophets'),
  (26, 'Ezekiel', 'OT', 'hbo', 48, 'EZK', 'EZK', 'Major Prophets'),
  (27, 'Daniel', 'OT', 'hbo/arc', 12, 'DAN', 'DAN', 'Major Prophets'),
  (28, 'Hosea', 'OT', 'hbo', 14, 'HOS', 'HOS', 'Minor Prophets'),
  (29, 'Joel', 'OT', 'hbo', 3, 'JOL', 'JOL', 'Minor Prophets'),
  (30, 'Amos', 'OT', 'hbo', 9, 'AMO', 'AMO', 'Minor Prophets'),
  (31, 'Obadiah', 'OT', 'hbo', 1, 'OBA', 'OBA', 'Minor Prophets'),
  (32, 'Jonah', 'OT', 'hbo', 4, 'JON', 'JON', 'Minor Prophets'),
  (33, 'Micah', 'OT', 'hbo', 7, 'MIC', 'MIC', 'Minor Prophets'),
  (34, 'Nahum', 'OT', 'hbo', 3, 'NAM', 'NAM', 'Minor Prophets'),
  (35, 'Habakkuk', 'OT', 'hbo', 3, 'HAB', 'HAB', 'Minor Prophets'),
  (36, 'Zephaniah', 'OT', 'hbo', 3, 'ZEP', 'ZEP', 'Minor Prophets'),
  (37, 'Haggai', 'OT', 'hbo', 2, 'HAG', 'HAG', 'Minor Prophets'),
  (38, 'Zechariah', 'OT', 'hbo', 14, 'ZEC', 'ZEC', 'Minor Prophets'),
  (39, 'Malachi', 'OT', 'hbo', 4, 'MAL', 'MAL', 'Minor Prophets'),
  (40, 'Matthew', 'NT', 'grc', 28, 'MAT', 'MAT', 'Gospels'),
  (41, 'Mark', 'NT', 'grc', 16, 'MRK', 'MRK', 'Gospels'),
  (42, 'Luke', 'NT', 'grc', 24, 'LUK', 'LUK', 'Gospels'),
  (43, 'John', 'NT', 'grc', 21, 'JHN', 'JHN', 'Gospels'),
  (44, 'Acts', 'NT', 'grc', 28, 'ACT', 'ACT', 'History'),
  (45, 'Romans', 'NT', 'grc', 16, 'ROM', 'ROM', 'Pauline Epistles'),
  (46, '1 Corinthians', 'NT', 'grc', 16, '1CO', '1CO', 'Pauline Epistles'),
  (47, '2 Corinthians', 'NT', 'grc', 13, '2CO', '2CO', 'Pauline Epistles'),
  (48, 'Galatians', 'NT', 'grc', 6, 'GAL', 'GAL', 'Pauline Epistles'),
  (49, 'Ephesians', 'NT', 'grc', 6, 'EPH', 'EPH', 'Pauline Epistles'),
  (50, 'Philippians', 'NT', 'grc', 4, 'PHP', 'PHP', 'Pauline Epistles'),
  (51, 'Colossians', 'NT', 'grc', 4, 'COL', 'COL', 'Pauline Epistles'),
  (52, '1 Thessalonians', 'NT', 'grc', 5, '1TH', '1TH', 'Pauline Epistles'),
  (53, '2 Thessalonians', 'NT', 'grc', 3, '2TH', '2TH', 'Pauline Epistles'),
  (54, '1 Timothy', 'NT', 'grc', 6, '1TI', '1TI', 'Pauline Epistles'),
  (55, '2 Timothy', 'NT', 'grc', 4, '2TI', '2TI', 'Pauline Epistles'),
  (56, 'Titus', 'NT', 'grc', 3, 'TIT', 'TIT', 'Pauline Epistles'),
  (57, 'Philemon', 'NT', 'grc', 1, 'PHM', 'PHM', 'Pauline Epistles'),
  (58, 'Hebrews', 'NT', 'grc', 13, 'HEB', 'HEB', 'General Epistles'),
  (59, 'James', 'NT', 'grc', 5, 'JAS', 'JAS', 'General Epistles'),
  (60, '1 Peter', 'NT', 'grc', 5, '1PE', '1PE', 'General Epistles'),
  (61, '2 Peter', 'NT', 'grc', 3, '2PE', '2PE', 'General Epistles'),
  (62, '1 John', 'NT', 'grc', 5, '1JN', '1JN', 'General Epistles'),
  (63, '2 John', 'NT', 'grc', 1, '2JN', '2JN', 'General Epistles'),
  (64, '3 John', 'NT', 'grc', 1, '3JN', '3JN', 'General Epistles'),
  (65, 'Jude', 'NT', 'grc', 1, 'JDE', 'JDE', 'General Epistles'),
  (66, 'Revelation', 'NT', 'grc', 22, 'REV', 'REV', 'Apocalyptic')
on conflict (id) do nothing;

create or replace function public.get_bible_books_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'books', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'testament', b.testament,
        'original_language', b.original_language,
        'total_chapters', b.total_chapters,
        'usfm', b.usfm,
        'theographic_code', b.theographic_code,
        'division', b.division
      ) order by b.id)
      from public.books b
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_bible_books_v1() from public;
grant execute on function public.get_bible_books_v1() to anon, authenticated;
notify pgrst, 'reload schema';
