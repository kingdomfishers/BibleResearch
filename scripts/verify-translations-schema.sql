do $verify$
begin
  if not (select relrowsecurity from pg_class where oid='public.verse_translation_sources'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.word_translation_choices'::regclass) then
    raise exception 'Translation RLS is disabled';
  end if;
  if has_table_privilege('anon','public.word_translation_choices','insert,update,delete')
    or has_table_privilege('authenticated','public.verse_translation_sources','insert,update,delete') then
    raise exception 'Unexpected public write privilege';
  end if;
  if (select count(*) from pg_policies where schemaname='public'
    and tablename='word_translation_choices') <> 4 then
    raise exception 'Incomplete ownership policies';
  end if;
end $verify$;
select 'translation schema ownership and privileges verified' as result;
