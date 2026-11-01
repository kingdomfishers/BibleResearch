-- Verify geography schema constraints, RLS policies, and anonymous draft isolation inside a rolled-back transaction.
begin;
insert into public.geography_sources(source_key, dataset, version, locator, license, attribution, published)
values ('test:geo-source', 'Synthetic Geography Test', '1', 'https://example.org', 'CC BY 4.0', 'Verifier', true);

insert into public.places(place_key, biblical_name, place_type, primary_source_id, published)
select 'test:place-visible', 'Visible Place', 'settlement', id, true from public.geography_sources where source_key = 'test:geo-source';

insert into public.places(place_key, biblical_name, place_type, primary_source_id, published)
select 'test:place-draft', 'Draft Place', 'settlement', id, false from public.geography_sources where source_key = 'test:geo-source';

set local role anon;
do $check$
declare c integer;
begin
  select count(*) into c from public.places where place_key like 'test:%';
  if c <> 1 then
    raise exception 'Expected anon to see 1 published test place, saw %', c;
  end if;
end $check$;
reset role;
rollback;
