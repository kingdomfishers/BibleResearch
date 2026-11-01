begin;
insert into public.chronology_models(id,name,published) values('test-publication','Publication test',true);
do $test$
declare rid bigint; n integer; denied boolean:=false;
begin
  rid:=public.chronology_publish_run('test-publication','Rolled back verification');
  select count(*) into n from public.chronology_assignments where run_id=rid;
  if n<>(select count(*) from public.verses) then raise exception 'Incomplete passage coverage'; end if;
  if exists(select 1 from public.chronology_assignments where run_id=rid and status<>'unresolved') then
    raise exception 'Empty model must not invent dates';
  end if;
  begin update public.chronology_runs set label='invalid mutation' where id=rid;
  exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Published run is mutable'; end if;
  denied:=false;
  begin delete from public.chronology_assignments where run_id=rid;
  exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Published assignments are mutable'; end if;
  if has_function_privilege('anon','public.chronology_publish_run(text,text,boolean)','execute') then
    raise exception 'Public publication is forbidden';
  end if;
end $test$;
rollback;
