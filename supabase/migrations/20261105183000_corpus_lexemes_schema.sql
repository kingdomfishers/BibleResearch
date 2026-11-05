-- Migration: 20261105183000_corpus_lexemes_schema.sql
-- Optimizations and batch ingestion RPC for corpus-wide STEP lexemes (TBESH + TBESG).

create index if not exists idx_lexemes_disambiguated on public.lexemes (disambiguated_strongs);

create or replace function public.ingest_lexemes_batch_v1(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  insert into public.lexemes (
    lexeme_key,
    language,
    base_strongs,
    extended_strongs,
    disambiguated_strongs,
    unified_strongs,
    original_lemma,
    transliteration,
    pos,
    primary_gloss,
    homograph_note,
    source_release_id
  )
  select
    elem->>'lexeme_key',
    elem->>'language',
    elem->>'base_strongs',
    elem->>'extended_strongs',
    elem->>'disambiguated_strongs',
    elem->>'unified_strongs',
    elem->>'original_lemma',
    elem->>'transliteration',
    elem->>'pos',
    elem->>'primary_gloss',
    elem->>'homograph_note',
    coalesce((elem->>'source_release_id')::bigint, 1)
  from jsonb_array_elements(p_batch) as elem
  on conflict (lexeme_key) do update set
    language = excluded.language,
    base_strongs = excluded.base_strongs,
    extended_strongs = excluded.extended_strongs,
    disambiguated_strongs = excluded.disambiguated_strongs,
    unified_strongs = excluded.unified_strongs,
    original_lemma = excluded.original_lemma,
    transliteration = excluded.transliteration,
    pos = excluded.pos,
    primary_gloss = excluded.primary_gloss,
    homograph_note = coalesce(excluded.homograph_note, public.lexemes.homograph_note),
    source_release_id = excluded.source_release_id;

  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'ok', 'count', v_count);
end;
$$;

revoke all on function public.ingest_lexemes_batch_v1(jsonb) from public;
grant execute on function public.ingest_lexemes_batch_v1(jsonb) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
