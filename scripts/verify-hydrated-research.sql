-- Read-only/rollback-only checks; run against the deployed corpus.
begin;
set local role anon;
do $$
declare p jsonb; entry jsonb; expected bigint;
begin
  p := public.get_verse_research_v1('{"passages":[{"book":1,"chapter":1,"verse":1}],"occurrences":{"mode":"sample","limit":2}}');
  assert p->>'status'='ok';
  assert jsonb_array_length(p #> '{verses,0,words}')=7;
  assert p #>> '{coverage,private_translation_choices_included}'='false';
  assert p #>> '{lexical_entries,H1254,needs_disambiguation}'='true';
  entry := p #> '{lexical_entries,H7225,occurrences}';
  select sum(occurrence_count) into expected from public.prompt_word_occurrences('H7225');
  assert (entry->>'corpus_token_total')::bigint=expected;
  assert not (entry->>'complete')::boolean;
  assert jsonb_array_length(entry->'references')=2;
  assert public.get_verse_research_v1('null')->>'status'='invalid_request';
  assert not has_table_privilege('anon','public.words','UPDATE');
  assert not has_table_privilege('anon','public.verses','INSERT');
  assert has_function_privilege('anon','public.get_verse_research_v1(jsonb)','EXECUTE');
  assert not (select prosecdef from pg_proc where oid='public.get_verse_research_v1(jsonb)'::regprocedure);
  assert position('word_translation_choices' in pg_get_functiondef('public.get_verse_research_v1(jsonb)'::regprocedure))=0;
end $$;
rollback;

-- The occurrence query retains the existing indexed base-Strongs/GIN pathway.
explain (analyze,buffers) select * from public.prompt_word_occurrences('H7225');
