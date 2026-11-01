begin;
do $test$
declare t text;
begin
  foreach t in array array['chronology_sources','chronology_models','chronology_events',
    'chronology_event_links','chronology_assertions','chronology_evidence','chronology_assertion_evidence'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then
      raise exception 'RLS disabled on %',t;
    end if;
    if not has_table_privilege('anon','public.'||t,'select')
      or has_table_privilege('anon','public.'||t,'insert,update,delete')
      or has_table_privilege('authenticated','public.'||t,'insert,update,delete') then
      raise exception 'Incorrect public grants on %',t;
    end if;
  end loop;
end $test$;
insert into public.chronology_models(id,name) values ('test-private','Hidden verification fixture');
set local role anon;
do $test$
begin
  if exists(select 1 from public.chronology_models where id='test-private') then
    raise exception 'Draft model exposed to anonymous reader';
  end if;
end $test$;
reset role;
rollback;
