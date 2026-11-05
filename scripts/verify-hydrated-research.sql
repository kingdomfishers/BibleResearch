-- Verify optimized hydrated verse research RPC

-- 1. Test single verse (Genesis 1:1)
select 
  (packet->>'schema_version')::int as schema_version,
  packet->>'status' as status,
  jsonb_array_length(packet->'verses') as verse_count,
  jsonb_object_keys(packet->'chronology') as sample_chronology_key,
  jsonb_object_keys(packet->'geography') as sample_geography_key,
  (packet->'verses'->0->'words'->0->'grammar'->'decoded_grammar') as first_word_decoded_grammar
from public.get_verse_research_v1(jsonb_build_object(
  'passages', jsonb_build_array(jsonb_build_object('book', 1, 'chapter', 1, 'verse', 1)),
  'profile', 'analysis'
)) as packet;

-- 2. Test contiguous range (Zechariah 4:1-14 pericope)
select 
  (packet->>'schema_version')::int as schema_version,
  packet->>'status' as status,
  jsonb_array_length(packet->'verses') as verse_count,
  (packet->'coverage'->>'returned_passage_count')::int as returned_passages,
  (packet->'coverage'->>'lexical_entry_count')::int as lexical_count,
  (packet->'coverage'->>'max_passages')::int as max_passages,
  octet_length(packet::text) as packet_bytes
from public.get_verse_research_v1(jsonb_build_object(
  'passages', jsonb_build_array(jsonb_build_object('book', 38, 'chapter', 4, 'start_verse', 1, 'end_verse', 14)),
  'profile', 'analysis'
)) as packet;

-- 3. Test polysemy preservation for H5869 ('ayin in Genesis 24:16)
select 
  packet->'lexical_entries'->'H5869'->>'needs_disambiguation' as needs_disambig,
  jsonb_array_length(packet->'lexical_entries'->'H5869'->'lexeme_candidates') as candidates_count,
  packet->'lexical_entries'->'H5869'->'lexeme_candidates' as candidates
from public.get_verse_research_v1(jsonb_build_object(
  'passages', jsonb_build_array(jsonb_build_object('book', 1, 'chapter', 24, 'verse', 16)),
  'profile', 'analysis'
)) as packet;
