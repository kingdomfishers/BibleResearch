-- Exact-form alternatives preserve the source's inflections and disambiguation.
create function public.translation_options_v1(p_word_id integer, p_source_english text)
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(option order by first_position), '{}'::text[])
  from (
    select option, min(position) as first_position
    from public.words w cross join lateral
      unnest(array_prepend(p_source_english, coalesce(w.english_translations, '{}')))
      with ordinality t(option, position)
    where w.id = p_word_id and option is not null group by option
  ) choices;
$$;

create function public.get_verse_translations_v1(p_book integer, p_chapter integer, p_verse integer)
returns table(word_position integer, word_id integer, original_word text,
  transliteration text, strongs_nr varchar, grammar_code varchar,
  primary_english text, millennium smallint, source_english text,
  english_translations text[], selected_english text, has_choice boolean, source_ref text)
language sql stable security invoker set search_path = '' as $$
  select u.ord::integer, w.id, w.original_word, w.transliteration, w.strongs_nr,
    w.grammar_code, coalesce(c.english, s.source_english, w.english_translations[1]),
    v.millennium, s.source_english,
    public.translation_options_v1(w.id, s.source_english), c.english,
    c.owner_id is not null, s.source_ref
  from public.verses v
  cross join lateral unnest(v.word_ids) with ordinality u(word_id, ord)
  join public.words w on w.id = u.word_id
  left join public.verse_translation_sources s
    on s.verse_id = v.id and s.word_position = u.ord and s.word_id = w.id
  left join public.word_translation_choices c
    on c.owner_id = (select auth.uid()) and c.verse_id = v.id
    and c.word_position = u.ord and c.word_id = w.id
  where v.book = p_book and v.chapter = p_chapter and v.verse_nr = p_verse
  order by u.ord;
$$;

-- This trigger also validates direct Data API writes; RPC checks alone are insufficient.
create function public.validate_word_translation_choice_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare source_text text;
begin
  select s.source_english into source_text from public.verse_translation_sources s
    join public.verses v on v.id = s.verse_id
    where s.verse_id = new.verse_id and s.word_position = new.word_position
      and s.word_id = new.word_id and v.word_ids[s.word_position] = new.word_id;
  if not found or not (new.english = any(public.translation_options_v1(new.word_id, source_text))) then
    raise exception 'Translation is not an available rendering for this occurrence' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger validate_word_translation_choice before insert or update
  on public.word_translation_choices for each row
  execute function public.validate_word_translation_choice_v1();

create function public.save_word_translation_v1(p_book integer, p_chapter integer,
  p_verse integer, p_word_position integer, p_word_id integer, p_english text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare target public.verse_translation_sources; owner uuid := auth.uid();
begin
  if owner is null then
    raise exception 'A reader session is required to save translations' using errcode = '42501';
  end if;
  select s.* into target from public.verse_translation_sources s
    join public.verses v on v.id = s.verse_id
    where v.book = p_book and v.chapter = p_chapter and v.verse_nr = p_verse
      and s.word_position = p_word_position and s.word_id = p_word_id
      and v.word_ids[s.word_position] = p_word_id;
  if not found then
    raise exception 'The verse occurrence does not match the requested word' using errcode = '22023';
  end if;
  if p_english is null then
    delete from public.word_translation_choices where owner_id = owner
      and verse_id = target.verse_id and word_position = p_word_position;
  else
    if not (p_english = any(public.translation_options_v1(p_word_id, target.source_english))) then
      raise exception 'Translation is not an available rendering for this occurrence' using errcode = '22023';
    end if;
    insert into public.word_translation_choices(owner_id, verse_id, word_position, word_id, english)
      values (owner, target.verse_id, p_word_position, p_word_id, p_english)
      on conflict (owner_id, verse_id, word_position) do update
        set english = excluded.english, word_id = excluded.word_id;
  end if;
  return jsonb_build_object('saved', p_english is not null,
    'english', coalesce(p_english, target.source_english), 'source_english', target.source_english);
end;
$$;

create function public.reset_word_translation_v1(p_book integer, p_chapter integer,
  p_verse integer, p_word_position integer, p_word_id integer)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select public.save_word_translation_v1(p_book,p_chapter,p_verse,p_word_position,p_word_id,null);
$$;

revoke all on function public.translation_options_v1(integer,text),
  public.get_verse_translations_v1(integer,integer,integer),
  public.validate_word_translation_choice_v1(),
  public.save_word_translation_v1(integer,integer,integer,integer,integer,text),
  public.reset_word_translation_v1(integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.translation_options_v1(integer,text),
  public.get_verse_translations_v1(integer,integer,integer) to anon, authenticated;
grant execute on function public.save_word_translation_v1(integer,integer,integer,integer,integer,text),
  public.reset_word_translation_v1(integer,integer,integer,integer,integer) to authenticated;
