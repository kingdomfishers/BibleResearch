-- Read/privilege contract; data and ownership tests run after source import.
do $verify$
begin
  if (select count(*) from public.get_verse_translations_v1(1,1,1)) <> 7 then
    raise exception 'Translation read does not preserve verse token order';
  end if;
  if has_function_privilege('anon','public.save_word_translation_v1(integer,integer,integer,integer,integer,text)','execute')
    or has_function_privilege('anon','public.reset_word_translation_v1(integer,integer,integer,integer,integer)','execute') then
    raise exception 'Anonymous role can mutate choices';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_verse_translations_v1',
      'save_word_translation_v1','reset_word_translation_v1','validate_word_translation_choice_v1')
    and p.prosecdef) then
    raise exception 'Translation functions must respect caller RLS';
  end if;
end $verify$;
select 'translation RPC read and privileges verified' as result;
