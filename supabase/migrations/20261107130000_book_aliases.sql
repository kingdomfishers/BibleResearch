-- NOTE-11: Book aliases and reference parser
-- Implements public.book_aliases table and public.parse_bible_ref_v1 function.

-- 1. Table public.book_aliases
create table if not exists public.book_aliases (
  alias text primary key,
  book_id smallint not null references public.books(id),
  kind text not null default 'abbrev'
);

alter table public.book_aliases enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'book_aliases' and policyname = 'p_book_aliases_select'
  ) then
    create policy p_book_aliases_select on public.book_aliases
      for select to anon, authenticated
      using (true);
  end if;
end $$;

revoke all on table public.book_aliases from public, anon, authenticated;
grant select on table public.book_aliases to anon, authenticated;

-- 2. Seed official names and USFM codes from public.books
insert into public.book_aliases (alias, book_id, kind)
select regexp_replace(lower(name), '[^a-z0-9]', '', 'g'), id, 'name'
from public.books
on conflict (alias) do nothing;

insert into public.book_aliases (alias, book_id, kind)
select regexp_replace(lower(usfm), '[^a-z0-9]', '', 'g'), id, 'usfm'
from public.books
on conflict (alias) do nothing;

-- 3. Seed comprehensive abbreviations, roman numerals, and spelling variants
insert into public.book_aliases (alias, book_id, kind)
values
  -- Genesis (1)
  ('gen', 1, 'abbrev'), ('gn', 1, 'abbrev'), ('ge', 1, 'abbrev'),
  -- Exodus (2)
  ('exod', 2, 'abbrev'), ('ex', 2, 'abbrev'), ('exo', 2, 'abbrev'),
  -- Leviticus (3)
  ('lev', 3, 'abbrev'), ('le', 3, 'abbrev'), ('lv', 3, 'abbrev'),
  -- Numbers (4)
  ('num', 4, 'abbrev'), ('nu', 4, 'abbrev'), ('nm', 4, 'abbrev'), ('nb', 4, 'abbrev'),
  -- Deuteronomy (5)
  ('deut', 5, 'abbrev'), ('dt', 5, 'abbrev'), ('de', 5, 'abbrev'),
  -- Joshua (6)
  ('josh', 6, 'abbrev'), ('jos', 6, 'abbrev'), ('jsh', 6, 'abbrev'),
  -- Judges (7)
  ('judg', 7, 'abbrev'), ('jdg', 7, 'abbrev'), ('jg', 7, 'abbrev'), ('jdgs', 7, 'abbrev'),
  -- Ruth (8)
  ('ruth', 8, 'abbrev'), ('rut', 8, 'abbrev'), ('rth', 8, 'abbrev'), ('ru', 8, 'abbrev'),
  -- 1 Samuel (9)
  ('1sam', 9, 'abbrev'), ('1sa', 9, 'abbrev'), ('1s', 9, 'abbrev'), ('1samuel', 9, 'abbrev'),
  ('isam', 9, 'abbrev'), ('firstsamuel', 9, 'abbrev'), ('1stsamuel', 9, 'abbrev'), ('1stsam', 9, 'abbrev'),
  -- 2 Samuel (10)
  ('2sam', 10, 'abbrev'), ('2sa', 10, 'abbrev'), ('2s', 10, 'abbrev'), ('2samuel', 10, 'abbrev'),
  ('iisam', 10, 'abbrev'), ('iisa', 10, 'abbrev'), ('iis', 10, 'abbrev'), ('iisamuel', 10, 'abbrev'),
  ('secondsamuel', 10, 'abbrev'), ('2ndsamuel', 10, 'abbrev'), ('2ndsam', 10, 'abbrev'),
  -- 1 Kings (11)
  ('1kgs', 11, 'abbrev'), ('1ki', 11, 'abbrev'), ('1k', 11, 'abbrev'), ('1kings', 11, 'abbrev'), ('1king', 11, 'abbrev'),
  ('ikgs', 11, 'abbrev'), ('iki', 11, 'abbrev'), ('ikings', 11, 'abbrev'), ('firstkings', 11, 'abbrev'), ('1stkings', 11, 'abbrev'),
  -- 2 Kings (12)
  ('2kgs', 12, 'abbrev'), ('2ki', 12, 'abbrev'), ('2k', 12, 'abbrev'), ('2kings', 12, 'abbrev'), ('2king', 12, 'abbrev'),
  ('iikgs', 12, 'abbrev'), ('iiki', 12, 'abbrev'), ('iik', 12, 'abbrev'), ('iikings', 12, 'abbrev'),
  ('secondkings', 12, 'abbrev'), ('2ndkings', 12, 'abbrev'), ('2ndkgs', 12, 'abbrev'),
  -- 1 Chronicles (13)
  ('1chr', 13, 'abbrev'), ('1ch', 13, 'abbrev'), ('1chron', 13, 'abbrev'), ('1chronicles', 13, 'abbrev'),
  ('ichr', 13, 'abbrev'), ('ich', 13, 'abbrev'), ('ichron', 13, 'abbrev'), ('ichronicles', 13, 'abbrev'),
  ('firstchronicles', 13, 'abbrev'), ('1stchronicles', 13, 'abbrev'), ('1stchr', 13, 'abbrev'),
  -- 2 Chronicles (14)
  ('2chr', 14, 'abbrev'), ('2ch', 14, 'abbrev'), ('2chron', 14, 'abbrev'), ('2chronicles', 14, 'abbrev'),
  ('iichr', 14, 'abbrev'), ('iich', 14, 'abbrev'), ('iichron', 14, 'abbrev'), ('iichronicles', 14, 'abbrev'),
  ('secondchronicles', 14, 'abbrev'), ('2ndchronicles', 14, 'abbrev'), ('2ndchr', 14, 'abbrev'),
  -- Ezra (15)
  ('ezra', 15, 'abbrev'), ('ezr', 15, 'abbrev'), ('ez', 15, 'abbrev'),
  -- Nehemiah (16)
  ('neh', 16, 'abbrev'), ('ne', 16, 'abbrev'),
  -- Esther (17)
  ('esth', 17, 'abbrev'), ('est', 17, 'abbrev'), ('es', 17, 'abbrev'),
  -- Job (18)
  ('job', 18, 'abbrev'), ('jb', 18, 'abbrev'),
  -- Psalms (19)
  ('ps', 19, 'abbrev'), ('pss', 19, 'abbrev'), ('psalm', 19, 'abbrev'), ('psalms', 19, 'abbrev'), ('psa', 19, 'abbrev'),
  -- Proverbs (20)
  ('prov', 20, 'abbrev'), ('pro', 20, 'abbrev'), ('pr', 20, 'abbrev'), ('prv', 20, 'abbrev'),
  -- Ecclesiastes (21)
  ('eccl', 21, 'abbrev'), ('ecc', 21, 'abbrev'), ('ec', 21, 'abbrev'), ('eccle', 21, 'abbrev'),
  ('qoh', 21, 'abbrev'), ('qohelet', 21, 'abbrev'), ('qoheleth', 21, 'abbrev'),
  -- Song of Solomon (22)
  ('song', 22, 'abbrev'), ('songofsongs', 22, 'abbrev'), ('songofsolomon', 22, 'abbrev'),
  ('sos', 22, 'abbrev'), ('canticles', 22, 'abbrev'), ('canticle', 22, 'abbrev'), ('sng', 22, 'abbrev'), ('cant', 22, 'abbrev'),
  -- Isaiah (23)
  ('isa', 23, 'abbrev'), ('is', 23, 'abbrev'), ('isaiah', 23, 'abbrev'),
  -- Jeremiah (24)
  ('jer', 24, 'abbrev'), ('je', 24, 'abbrev'), ('jrm', 24, 'abbrev'),
  -- Lamentations (25)
  ('lam', 25, 'abbrev'), ('la', 25, 'abbrev'),
  -- Ezekiel (26)
  ('ezek', 26, 'abbrev'), ('ezk', 26, 'abbrev'), ('eze', 26, 'abbrev'),
  -- Daniel (27)
  ('dan', 27, 'abbrev'), ('da', 27, 'abbrev'), ('dn', 27, 'abbrev'),
  -- Hosea (28)
  ('hos', 28, 'abbrev'), ('ho', 28, 'abbrev'),
  -- Joel (29)
  ('joel', 29, 'abbrev'), ('jol', 29, 'abbrev'), ('joe', 29, 'abbrev'), ('jl', 29, 'abbrev'),
  -- Amos (30)
  ('amos', 30, 'abbrev'), ('amo', 30, 'abbrev'), ('am', 30, 'abbrev'),
  -- Obadiah (31)
  ('obad', 31, 'abbrev'), ('oba', 31, 'abbrev'), ('ob', 31, 'abbrev'),
  -- Jonah (32)
  ('jonah', 32, 'abbrev'), ('jon', 32, 'abbrev'), ('jnh', 32, 'abbrev'),
  -- Micah (33)
  ('mic', 33, 'abbrev'), ('mc', 33, 'abbrev'),
  -- Nahum (34)
  ('nah', 34, 'abbrev'), ('nam', 34, 'abbrev'), ('na', 34, 'abbrev'),
  -- Habakkuk (35)
  ('hab', 35, 'abbrev'), ('habakkuk', 35, 'abbrev'),
  -- Zephaniah (36)
  ('zeph', 36, 'abbrev'), ('zep', 36, 'abbrev'), ('zp', 36, 'abbrev'),
  -- Haggai (37)
  ('hag', 37, 'abbrev'), ('hg', 37, 'abbrev'),
  -- Zechariah (38)
  ('zech', 38, 'abbrev'), ('zec', 38, 'abbrev'), ('zc', 38, 'abbrev'),
  -- Malachi (39)
  ('mal', 39, 'abbrev'), ('ml', 39, 'abbrev'),
  -- Matthew (40)
  ('matt', 40, 'abbrev'), ('mt', 40, 'abbrev'), ('mat', 40, 'abbrev'),
  -- Mark (41)
  ('mark', 41, 'abbrev'), ('mk', 41, 'abbrev'), ('mrk', 41, 'abbrev'), ('mr', 41, 'abbrev'),
  -- Luke (42)
  ('luke', 42, 'abbrev'), ('lk', 42, 'abbrev'), ('luk', 42, 'abbrev'), ('lu', 42, 'abbrev'),
  -- John (43)
  ('john', 43, 'abbrev'), ('jn', 43, 'abbrev'), ('jhn', 43, 'abbrev'),
  -- Acts (44)
  ('acts', 44, 'abbrev'), ('act', 44, 'abbrev'), ('ac', 44, 'abbrev'),
  -- Romans (45)
  ('rom', 45, 'abbrev'), ('ro', 45, 'abbrev'), ('rm', 45, 'abbrev'),
  -- 1 Corinthians (46)
  ('1cor', 46, 'abbrev'), ('1co', 46, 'abbrev'), ('1corinthians', 46, 'abbrev'),
  ('icor', 46, 'abbrev'), ('ico', 46, 'abbrev'), ('icorinthians', 46, 'abbrev'),
  ('firstcorinthians', 46, 'abbrev'), ('1stcorinthians', 46, 'abbrev'), ('1stcor', 46, 'abbrev'),
  -- 2 Corinthians (47)
  ('2cor', 47, 'abbrev'), ('2co', 47, 'abbrev'), ('2corinthians', 47, 'abbrev'),
  ('iicor', 47, 'abbrev'), ('iico', 47, 'abbrev'), ('iicorinthians', 47, 'abbrev'),
  ('secondcorinthians', 47, 'abbrev'), ('2ndcorinthians', 47, 'abbrev'), ('2ndcor', 47, 'abbrev'),
  -- Galatians (48)
  ('gal', 48, 'abbrev'), ('ga', 48, 'abbrev'),
  -- Ephesians (49)
  ('eph', 49, 'abbrev'), ('ep', 49, 'abbrev'),
  -- Philippians (50)
  ('phil', 50, 'abbrev'), ('php', 50, 'abbrev'), ('pp', 50, 'abbrev'),
  -- Colossians (51)
  ('col', 51, 'abbrev'), ('co', 51, 'abbrev'),
  -- 1 Thessalonians (52)
  ('1thess', 52, 'abbrev'), ('1th', 52, 'abbrev'), ('1thes', 52, 'abbrev'), ('1thessalonians', 52, 'abbrev'),
  ('ithess', 52, 'abbrev'), ('ith', 52, 'abbrev'), ('ithes', 52, 'abbrev'), ('ithessalonians', 52, 'abbrev'),
  ('firstthessalonians', 52, 'abbrev'), ('1stthessalonians', 52, 'abbrev'), ('1stthess', 52, 'abbrev'),
  -- 2 Thessalonians (53)
  ('2thess', 53, 'abbrev'), ('2th', 53, 'abbrev'), ('2thes', 53, 'abbrev'), ('2thessalonians', 53, 'abbrev'),
  ('iithess', 53, 'abbrev'), ('iith', 53, 'abbrev'), ('iithes', 53, 'abbrev'), ('iithessalonians', 53, 'abbrev'),
  ('secondthessalonians', 53, 'abbrev'), ('2ndthessalonians', 53, 'abbrev'), ('2ndthess', 53, 'abbrev'),
  -- 1 Timothy (54)
  ('1tim', 54, 'abbrev'), ('1ti', 54, 'abbrev'), ('1timothy', 54, 'abbrev'),
  ('itim', 54, 'abbrev'), ('iti', 54, 'abbrev'), ('itimothy', 54, 'abbrev'),
  ('firsttimothy', 54, 'abbrev'), ('1sttimothy', 54, 'abbrev'), ('1sttim', 54, 'abbrev'),
  -- 2 Timothy (55)
  ('2tim', 55, 'abbrev'), ('2ti', 55, 'abbrev'), ('2timothy', 55, 'abbrev'),
  ('iitim', 55, 'abbrev'), ('iiti', 55, 'abbrev'), ('iitimothy', 55, 'abbrev'),
  ('secondtimothy', 55, 'abbrev'), ('2ndtimothy', 55, 'abbrev'), ('2ndtim', 55, 'abbrev'),
  -- Titus (56)
  ('titus', 56, 'abbrev'), ('tit', 56, 'abbrev'), ('ti', 56, 'abbrev'),
  -- Philemon (57)
  ('phlm', 57, 'abbrev'), ('phm', 57, 'abbrev'), ('philem', 57, 'abbrev'),
  -- Hebrews (58)
  ('heb', 58, 'abbrev'), ('he', 58, 'abbrev'),
  -- James (59)
  ('jas', 59, 'abbrev'), ('jm', 59, 'abbrev'),
  -- 1 Peter (60)
  ('1pet', 60, 'abbrev'), ('1pe', 60, 'abbrev'), ('1pt', 60, 'abbrev'), ('1p', 60, 'abbrev'), ('1peter', 60, 'abbrev'),
  ('ipet', 60, 'abbrev'), ('ipe', 60, 'abbrev'), ('ipt', 60, 'abbrev'), ('ip', 60, 'abbrev'), ('ipeter', 60, 'abbrev'),
  ('firstpeter', 60, 'abbrev'), ('1stpeter', 60, 'abbrev'), ('1stpet', 60, 'abbrev'),
  -- 2 Peter (61)
  ('2pet', 61, 'abbrev'), ('2pe', 61, 'abbrev'), ('2pt', 61, 'abbrev'), ('2p', 61, 'abbrev'), ('2peter', 61, 'abbrev'),
  ('iipet', 61, 'abbrev'), ('iipe', 61, 'abbrev'), ('iipt', 61, 'abbrev'), ('iip', 61, 'abbrev'), ('iipeter', 61, 'abbrev'),
  ('secondpeter', 61, 'abbrev'), ('2ndpeter', 61, 'abbrev'), ('2ndpet', 61, 'abbrev'),
  -- 1 John (62)
  ('1john', 62, 'abbrev'), ('1jn', 62, 'abbrev'), ('1jhn', 62, 'abbrev'), ('1j', 62, 'abbrev'), ('1jo', 62, 'abbrev'),
  ('ijohn', 62, 'abbrev'), ('ijn', 62, 'abbrev'), ('ijhn', 62, 'abbrev'), ('ij', 62, 'abbrev'), ('ijo', 62, 'abbrev'),
  ('firstjohn', 62, 'abbrev'), ('1stjohn', 62, 'abbrev'), ('1stjn', 62, 'abbrev'),
  -- 2 John (63)
  ('2john', 63, 'abbrev'), ('2jn', 63, 'abbrev'), ('2jhn', 63, 'abbrev'), ('2j', 63, 'abbrev'), ('2jo', 63, 'abbrev'),
  ('iijohn', 63, 'abbrev'), ('iijn', 63, 'abbrev'), ('iijhn', 63, 'abbrev'), ('iij', 63, 'abbrev'), ('iijo', 63, 'abbrev'),
  ('secondjohn', 63, 'abbrev'), ('2ndjohn', 63, 'abbrev'), ('2ndjn', 63, 'abbrev'),
  -- 3 John (64)
  ('3john', 64, 'abbrev'), ('3jn', 64, 'abbrev'), ('3jhn', 64, 'abbrev'), ('3j', 64, 'abbrev'), ('3jo', 64, 'abbrev'),
  ('iiijohn', 64, 'abbrev'), ('iiijn', 64, 'abbrev'), ('iiijhn', 64, 'abbrev'), ('iiij', 64, 'abbrev'), ('iiijo', 64, 'abbrev'),
  ('thirdjohn', 64, 'abbrev'), ('3rdjohn', 64, 'abbrev'), ('3rdjn', 64, 'abbrev'),
  -- Jude (65)
  ('jude', 65, 'abbrev'), ('jde', 65, 'abbrev'), ('jud', 65, 'abbrev'), ('jd', 65, 'abbrev'),
  -- Revelation (66)
  ('rev', 66, 'abbrev'), ('rv', 66, 'abbrev'), ('apocalypse', 66, 'abbrev'), ('apoc', 66, 'abbrev'),
  ('revelation', 66, 'abbrev'), ('revelations', 66, 'abbrev')
on conflict (alias) do nothing;


-- 4. Function public.parse_bible_ref_v1(p_text text)
create or replace function public.parse_bible_ref_v1(p_text text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
set jit = 'off'
as $$
declare
  v_trimmed text;
  m text[];
  m_nums text[];
  m_bare text[];
  v_book_raw text;
  v_norm_alias text;
  v_nums_str text;
  v_book_id smallint;
  v_book_name text;
  v_total_chapters smallint;
  v_chapter int := null;
  v_verse_start int := null;
  v_verse_end int := null;
  v_scope text := null;
  v_min_verse int;
  v_max_verse int;
  v_first_id int;
  v_last_id int;
  v_canonical text;
  v_verse_ids jsonb;
begin
  if p_text is null or btrim(p_text) = '' then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'empty_input',
      'query', p_text
    );
  end if;

  v_trimmed := btrim(p_text);

  -- Match: [optional 1-3 / ordinal / Roman prefix] + [alphabetic word(s)] followed by optional numbers
  m := regexp_match(v_trimmed, '^\s*([1-3]?(?:st|nd|rd)?\s*[a-zA-Z\s.-]+?)(?:\s*(\d.*))?$');
  if m is null or m[1] is null then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'unparseable_reference',
      'query', p_text
    );
  end if;

  v_book_raw := btrim(m[1]);
  v_norm_alias := regexp_replace(lower(v_book_raw), '[^a-z0-9]', '', 'g');

  -- Resolve book alias
  select ba.book_id, b.name, b.total_chapters
  into v_book_id, v_book_name, v_total_chapters
  from public.book_aliases ba
  join public.books b on b.id = ba.book_id
  where ba.alias = v_norm_alias;

  if v_book_id is null then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'unknown_book',
      'query', p_text
    );
  end if;

  -- Case 1: No numbers provided -> book scope
  if m[2] is null or btrim(m[2]) = '' then
    select min(id), max(id)
    into v_first_id, v_last_id
    from public.verses
    where book = v_book_id;

    return jsonb_build_object(
      'status', 'ok',
      'book', v_book_id,
      'chapter', null,
      'verse_start', null,
      'verse_end', null,
      'scope', 'book',
      'book_name', v_book_name,
      'canonical', v_book_name,
      'verse_ids', jsonb_build_array(v_first_id, v_last_id)
    );
  end if;

  v_nums_str := btrim(m[2]);

  -- Case 2: Chapter and Verse with separator (colon or dot) e.g., "1:1", "1.1", "1:1-3"
  m_nums := regexp_match(v_nums_str, '^(\d+)\s*[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+))?$');
  if m_nums is not null then
    v_chapter := (m_nums[1])::int;
    v_verse_start := (m_nums[2])::int;
    v_verse_end := coalesce((m_nums[3])::int, v_verse_start);
    if m_nums[3] is not null and (m_nums[3])::int <> v_verse_start then
      v_scope := 'range';
    else
      v_scope := 'verse';
    end if;
  else
    -- Case 3: Bare number or number range without separator e.g., "13", "1-5", "5"
    m_bare := regexp_match(v_nums_str, '^(\d+)(?:\s*[-–—]\s*(\d+))?$');
    if m_bare is not null then
      if v_total_chapters = 1 then
        -- Single-chapter book (e.g., Obadiah, Jude, Philemon, 2 John, 3 John): bare number is the verse
        v_chapter := 1;
        v_verse_start := (m_bare[1])::int;
        v_verse_end := coalesce((m_bare[2])::int, v_verse_start);
        if m_bare[2] is not null and (m_bare[2])::int <> v_verse_start then
          v_scope := 'range';
        else
          v_scope := 'verse';
        end if;
      else
        -- Multi-chapter book (e.g., 1 Cor 13, Gen 1): bare number is the chapter
        v_chapter := (m_bare[1])::int;
        v_scope := 'chapter';
      end if;
    else
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'unparseable_numbers',
        'query', p_text
      );
    end if;
  end if;

  -- Validate chapter range
  if v_chapter < 1 or v_chapter > v_total_chapters then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'chapter_out_of_range',
      'max_chapter', v_total_chapters,
      'query', p_text
    );
  end if;

  -- Validate and resolve verses
  if v_scope in ('verse', 'range') then
    select min(verse_nr), max(verse_nr)
    into v_min_verse, v_max_verse
    from public.verses
    where book = v_book_id and chapter = v_chapter;

    if v_min_verse is null then
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'chapter_empty',
        'query', p_text
      );
    end if;

    if v_verse_start < v_min_verse or v_verse_start > v_max_verse then
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'verse_out_of_range',
        'min_verse', v_min_verse,
        'max_verse', v_max_verse,
        'query', p_text
      );
    end if;

    if v_verse_end < v_verse_start or v_verse_end > v_max_verse then
      return jsonb_build_object(
        'status', 'invalid',
        'reason', 'verse_end_out_of_range',
        'min_verse', v_min_verse,
        'max_verse', v_max_verse,
        'query', p_text
      );
    end if;

    select min(id), max(id)
    into v_first_id, v_last_id
    from public.verses
    where book = v_book_id and chapter = v_chapter and verse_nr between v_verse_start and v_verse_end;

    v_verse_ids := jsonb_build_array(v_first_id, v_last_id);

    if v_scope = 'range' then
      v_canonical := v_book_name || ' ' || v_chapter::text || ':' || v_verse_start::text || '-' || v_verse_end::text;
    else
      v_canonical := v_book_name || ' ' || v_chapter::text || ':' || v_verse_start::text;
    end if;

  elsif v_scope = 'chapter' then
    select min(id), max(id), min(verse_nr), max(verse_nr)
    into v_first_id, v_last_id, v_verse_start, v_verse_end
    from public.verses
    where book = v_book_id and chapter = v_chapter;

    v_verse_ids := jsonb_build_array(v_first_id, v_last_id);
    v_canonical := v_book_name || ' ' || v_chapter::text;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'book', v_book_id,
    'chapter', v_chapter,
    'verse_start', v_verse_start,
    'verse_end', v_verse_end,
    'scope', v_scope,
    'book_name', v_book_name,
    'canonical', v_canonical,
    'verse_ids', v_verse_ids
  );
end;
$$;

revoke all on function public.parse_bible_ref_v1(text) from public, anon, authenticated;
grant execute on function public.parse_bible_ref_v1(text) to anon, authenticated;
