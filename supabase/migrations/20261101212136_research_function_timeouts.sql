-- PostgREST reads per-function settings. Keep long research calls bounded without
-- changing anonymous/authenticated role timeouts for unrelated endpoints.
alter function public.get_verse_research_v1(jsonb) set statement_timeout = '10s';
-- The pattern workflow reuses this existing evidence endpoint; its published
-- read contract previously hit the anonymous 3-second default for concept text.
alter function public.research_relationships_v1(jsonb) set statement_timeout = '5s';
notify pgrst, 'reload schema';
