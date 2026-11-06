-- @file: supabase/migrations/20261105231500_canonical_corpus_population.sql
-- @feature: canonical-lexical-evidence-db
-- @description: Deterministic set-based population of source_releases, source_editions, edition_passages, versification_mappings, canonical lemmas, lexeme_identifiers, lexical_roots, lemma_root_links, primary/hierarchical lexical_senses, external concepts/properties/links, relation_types, canonical_entities, and entity_relationships.

-- ============================================================================
-- 1. SOURCE RELEASES & SOURCE EDITIONS
-- ============================================================================
update public.source_releases
set version_label = '2026-11 (commit be4191f)',
    source_url = 'https://github.com/STEPBible/STEPBible-Data/tree/be4191f0082aeedddb0eff0c02c966292b2bd641',
    sha256_manifest = jsonb_build_object(
      'TBESH', '464dccadd95fd8620dd05fa0d7a4caba58ec3c4d5db3ebf38e43d046ca25b591',
      'TBESG', '312f723d7b8ef263bbdfb0451c9b8057125804dfff390b6f8544cff2a84b57f4',
      'TAHOT Gen-Deu', 'e9b8546ee48fe0bfc57c3b70f5f40e98d96580e803526d19026224e31753368b',
      'TAHOT Jos-Est', '195fee1dc3653bab33701f170734eb894ed647c10cd08cc61749375fe8b73775',
      'TAHOT Job-Sng', 'bb508af3af07822fca84cc43a0eba79eb70eecf672aabc0245b8d8cecf329d96',
      'TAHOT Isa-Mal', 'f3ded203d2a74d6368932c97ae550d1d0754b271af491dc0dedf36fe3ba0bcc5',
      'TAGNT Mat-Jhn', 'ab8eaaeb68e17a1dcfa34e1e9350358f22f03bc2a97244d848750ad81044bc8e',
      'TAGNT Act-Rev', '524e32375361e6d3fa2f7ef00b87605fdc4317a762f395651a05fdc31ad031b7'
    ),
    licensing_constraints = 'CC BY 4.0 (Tyndale House Cambridge). Restricted Online Bible Meaning column (TBESH col 7) is strictly excluded.',
    epistemic_layer = 'primary_biblical'
where release_key = 'stepbible-2026-11';

update public.source_releases
set version_label = '2026-11',
    source_url = 'https://github.com/Clear-Bible/macula-hebrew',
    licensing_constraints = 'CC BY 4.0 (Clear Bible MACULA linguistic syntax/morphology)',
    epistemic_layer = 'lexical_reference'
where release_key = 'macula-2026-11';

update public.source_releases
set version_label = 'v1.0.0',
    source_url = 'https://github.com/STEPBible/STEPBible-Data',
    licensing_constraints = 'CC BY 4.0 (Reviewed literary/intertextual benchmark corpus with explicit counterexample controls)',
    epistemic_layer = 'reviewed_research'
where release_key = 'curated-motifs-v1';

insert into public.source_releases (
  release_key, dataset, commit_sha, license, attribution,
  version_label, source_url, sha256_manifest, licensing_constraints, epistemic_layer
)
values
  (
    'webp-2026-11',
    'World English Bible (Public Domain USFM)',
    'A93DF5571009FED56F77E3AC1D3CE71C9A3A3DF1486F7570CC7A8F823192FDBA',
    'Public Domain',
    'World English Bible / eBible.org',
    '2026-11',
    'https://ebible.org/Scriptures/engwebp_usfm.zip',
    jsonb_build_object('engwebp_usfm.zip', 'A93DF5571009FED56F77E3AC1D3CE71C9A3A3DF1486F7570CC7A8F823192FDBA'),
    'Public Domain continuous English translation; no English word-level alignment asserted.',
    'primary_biblical'
  ),
  (
    'openbible-pleiades-2026',
    'OpenBible Ancient/Modern Geocoding + Pleiades Gazetteer + STEP TIPNR',
    'pinned-2026-11',
    'CC BY 4.0',
    'OpenBible.info, Pleiades Ancient World Mapping Center, and STEPBible TIPNR',
    '2026-11',
    'https://github.com/openbibleinfo/Bible-Geocoding-Data',
    '{}'::jsonb,
    'CC BY 4.0 external historical/archaeological gazetteer data; separated from biblical text interpretation.',
    'external_factual'
  ),
  (
    'theographic-chronology-2026',
    'Theographic Bible Metadata & Published Chronology Models',
    'pinned-2026-11',
    'CC BY-SA 4.0',
    'Robert Rouse (Theographic) & BibleResearch Multi-Model Chronology',
    '2026-11',
    'https://github.com/robertrouse/theographic-bible-metadata',
    '{}'::jsonb,
    'CC BY-SA 4.0 external chronological models and event anchors.',
    'external_factual'
  )
on conflict (release_key) do update set
  version_label = excluded.version_label,
  source_url = excluded.source_url,
  sha256_manifest = excluded.sha256_manifest,
  licensing_constraints = excluded.licensing_constraints,
  epistemic_layer = excluded.epistemic_layer;

insert into public.source_editions (
  edition_key, source_release_id, edition_kind, title, language,
  testament_scope, versification_scheme, license, licensing_notes, source_url, file_metadata
)
select
  v.edition_key, sr.id, v.edition_kind, v.title, v.language,
  v.testament_scope, v.versification_scheme, v.license, v.licensing_notes, v.source_url, v.file_metadata::jsonb
from (values
  (
    'step-tahot-wlc', 'stepbible-2026-11', 'hebrew_aramaic_text',
    'STEPBible TAHOT (Leningrad Codex / Qere Masoretic OT)', 'hbo',
    'OT', 'english_standard', 'CC BY 4.0',
    'Primary Leningrad/Qere readings with morphological prefix/stem/suffix slashes and Masoretic Hebrew parenthesized versification.',
    'https://github.com/STEPBible/STEPBible-Data', '{"parts":["Gen-Deu","Jos-Est","Job-Sng","Isa-Mal"]}'
  ),
  (
    'step-tagnt-na28', 'stepbible-2026-11', 'greek_text',
    'STEPBible TAGNT (NA28-equivalent Greek New Testament)', 'grc',
    'NT', 'greek_eclectic', 'CC BY 4.0',
    'Tokens attested in NA28 edition column with Conjoin-word syntax dependencies and KJV bracketed versification.',
    'https://github.com/STEPBible/STEPBible-Data', '{"parts":["Mat-Jhn","Act-Rev"],"edition_filter":"NA28"}'
  ),
  (
    'step-tbesh', 'stepbible-2026-11', 'lexicon',
    'Translators Brief Lexicon of Extended Strongs for Hebrew/Aramaic (TBESH)', 'hbo',
    'OT', 'not_applicable', 'CC BY 4.0',
    'Includes eStrong, dStrong, uStrong, Hebrew lemma, transliteration, morph, and STEP CC BY gloss. Excludes Online Bible Meaning column 7.',
    'https://github.com/STEPBible/STEPBible-Data', '{"entries":11682,"excluded_columns":["Meaning (col 7, Online Bible)"]}'
  ),
  (
    'step-tbesg', 'stepbible-2026-11', 'lexicon',
    'Translators Brief Lexicon of Extended Strongs for Greek (TBESG / Abbott-Smith / Middle Liddell)', 'grc',
    'NT', 'not_applicable', 'CC BY 4.0',
    'Includes eStrong, dStrong, uStrong, Greek headword, transliteration, morph, STEP gloss, and public-domain/CC-BY Abbott-Smith & Middle Liddell definitions.',
    'https://github.com/STEPBible/STEPBible-Data', '{"entries":11035}'
  ),
  (
    'mt-hebrew-versification', 'stepbible-2026-11', 'versification_system',
    'Masoretic Hebrew (BHS / Leningrad) Versification System', 'hbo',
    'OT', 'masoretic_hebrew', 'CC BY 4.0',
    'Recorded in TAHOT parenthesized chapter.verse locators, including 116 Psalm superscriptions numbered as verse 1 in MT.',
    'https://github.com/STEPBible/STEPBible-Data', '{}'
  ),
  (
    'kjv-tr-versification', 'stepbible-2026-11', 'versification_system',
    'Traditional KJV / Textus Receptus Bracketed Versification', 'grc',
    'NT', 'kjv_1769', 'CC BY 4.0',
    'Recorded in TAGNT bracketed [chapter.verse] locators where KJV/TR numbering differs from modern critical editions.',
    'https://github.com/STEPBible/STEPBible-Data', '{}'
  ),
  (
    'webp-2026-11', 'webp-2026-11', 'english_translation',
    'World English Bible (Public Domain Edition)', 'en',
    'Both', 'english_standard', 'Public Domain',
    'Continuous English verse text; separate edition from original-language corpus with explicit absent/extra verse mappings.',
    'https://ebible.org/Scriptures/engwebp_usfm.zip', '{"verses":31215}'
  ),
  (
    'openbible-pleiades-gazetteer', 'openbible-pleiades-2026', 'external_gazetteer',
    'OpenBible + Pleiades + STEP TIPNR Historical Gazetteer', 'mul',
    'Both', 'not_applicable', 'CC BY 4.0',
    'External geographical coordinates, ancient/modern identifications, Pleiades URIs, and Wikidata identifiers.',
    'https://github.com/openbibleinfo/Bible-Geocoding-Data', '{"places":1344}'
  ),
  (
    'theographic-chronology-v1', 'theographic-chronology-2026', 'chronology_dataset',
    'Published Multi-Model Biblical Chronology Dataset', 'en',
    'Both', 'not_applicable', 'CC BY-SA 4.0',
    'External historical/chronological event anchors and model intervals.',
    'https://github.com/robertrouse/theographic-bible-metadata', '{"events":450}'
  ),
  (
    'curated-motifs-edition-v1', 'curated-motifs-v1', 'annotation_corpus',
    'BibleResearch Reviewed Literary & Intertextual Benchmark Annotations', 'en',
    'Both', 'english_standard', 'CC BY 4.0',
    'Curated literary/intertextual assertions with explicit counterexample controls.',
    'https://github.com/STEPBible/STEPBible-Data', '{}'
  )
) as v(edition_key, rel_key, edition_kind, title, language, testament_scope, versification_scheme, license, licensing_notes, source_url, file_metadata)
join public.source_releases sr on sr.release_key = v.rel_key
on conflict (edition_key) do nothing;

-- ============================================================================
-- 2. EDITION PASSAGES & VERSIFICATION MAPPINGS
-- ============================================================================
-- 2a. Populate OT (step-tahot-wlc) & NT (step-tagnt-na28) edition passages
insert into public.edition_passages (
  edition_id, book, chapter, verse_nr, edition_ref,
  canonical_verse_id, token_count, witness_tag, source_record_id
)
select
  case when v.book <= 39 then tahot_ed.id else tagnt_ed.id end as edition_id,
  v.book,
  v.chapter,
  v.verse_nr,
  b.usfm || '.' || v.chapter || '.' || v.verse_nr as edition_ref,
  v.id as canonical_verse_id,
  cardinality(v.word_ids)::smallint as token_count,
  s_first.witness_tag,
  coalesce(s_first.source_ref, b.usfm || '.' || v.chapter || '.' || v.verse_nr)
from public.verses v
join public.books b on b.id = v.book
cross join (select id from public.source_editions where edition_key = 'step-tahot-wlc') tahot_ed
cross join (select id from public.source_editions where edition_key = 'step-tagnt-na28') tagnt_ed
left join lateral (
  select s.source_ref, split_part(s.source_ref, '=', 2) as witness_tag
  from public.verse_translation_sources s
  where s.verse_id = v.id and s.word_position = 1
  limit 1
) s_first on true
on conflict (edition_id, edition_ref) do nothing;

-- 2b. Populate World English Bible (webp-2026-11) edition passages
insert into public.edition_passages (
  edition_id, book, chapter, verse_nr, edition_ref,
  canonical_verse_id, token_count, witness_tag, source_record_id
)
select
  web_ed.id,
  rev.book,
  rev.chapter,
  rev.verse_nr,
  'WEB:' || b.usfm || '.' || rev.chapter || '.' || rev.verse_nr,
  v.id,
  null,
  'WEB',
  'webp-2026-11:' || b.usfm || '.' || rev.chapter || '.' || rev.verse_nr
from public.reader_english_verses rev
join public.books b on b.id = rev.book
cross join (select id from public.source_editions where edition_key = 'webp-2026-11') web_ed
left join public.verses v
  on v.book = rev.book and v.chapter = rev.chapter and v.verse_nr = rev.verse_nr
on conflict (edition_id, edition_ref) do nothing;

-- 2c. Populate Masoretic Hebrew versification shifts from TAHOT parenthesized refs
insert into public.versification_mappings (
  canonical_verse_id, from_edition_id, from_ref,
  to_edition_id, to_book, to_chapter, to_verse_nr, to_ref,
  mapping_kind, source_release_id, source_record_id,
  origin_mode, derivation_method
)
select
  v.id,
  tahot_ed.id,
  b.usfm || '.' || v.chapter || '.' || v.verse_nr,
  mt_ed.id,
  v.book,
  (regexp_match(split_part(s.source_ref, '#', 1), '\(([0-9]+)\.([0-9]+)\)$'))[1]::smallint as to_chapter,
  (regexp_match(split_part(s.source_ref, '#', 1), '\(([0-9]+)\.([0-9]+)\)$'))[2]::smallint as to_verse_nr,
  'MT:' || b.usfm || '.'
    || (regexp_match(split_part(s.source_ref, '#', 1), '\(([0-9]+)\.([0-9]+)\)$'))[1] || '.'
    || (regexp_match(split_part(s.source_ref, '#', 1), '\(([0-9]+)\.([0-9]+)\)$'))[2] as to_ref,
  case when v.book = 19 and v.verse_nr = 0 then 'psalm_superscription_shift' else 'chapter_verse_shift' end,
  sr.id,
  'TAHOT:' || s.source_ref,
  'directly_imported',
  'Parsed directly from STEP TAHOT column 0 Eng(Heb) parenthesized Masoretic locator'
from public.verses v
join public.books b on b.id = v.book
join public.verse_translation_sources s on s.verse_id = v.id and s.word_position = 1
cross join (select id from public.source_editions where edition_key = 'step-tahot-wlc') tahot_ed
cross join (select id from public.source_editions where edition_key = 'mt-hebrew-versification') mt_ed
cross join (select id from public.source_releases where release_key = 'stepbible-2026-11') sr
where split_part(s.source_ref, '#', 1) ~ '^[1-3]?[A-Za-z]{2,3}\.[0-9]+\.[0-9]+\([0-9]+\.[0-9]+\)$'
on conflict (canonical_verse_id, from_edition_id, to_edition_id, to_ref) do nothing;

-- 2d. Populate KJV/TR bracketed versification shifts from TAGNT
insert into public.versification_mappings (
  canonical_verse_id, from_edition_id, from_ref,
  to_edition_id, to_book, to_chapter, to_verse_nr, to_ref,
  mapping_kind, source_release_id, source_record_id,
  origin_mode, derivation_method
)
select distinct on (v.id, to_ref)
  v.id,
  tagnt_ed.id,
  b.usfm || '.' || v.chapter || '.' || v.verse_nr,
  kjv_ed.id,
  v.book,
  (regexp_match(split_part(s.source_ref, '#', 1), '\[([0-9]+)\.([0-9]+)\]$'))[1]::smallint,
  (regexp_match(split_part(s.source_ref, '#', 1), '\[([0-9]+)\.([0-9]+)\]$'))[2]::smallint,
  'KJV:' || b.usfm || '.'
    || (regexp_match(split_part(s.source_ref, '#', 1), '\[([0-9]+)\.([0-9]+)\]$'))[1] || '.'
    || (regexp_match(split_part(s.source_ref, '#', 1), '\[([0-9]+)\.([0-9]+)\]$'))[2] as to_ref,
  'kjv_bracket_shift',
  sr.id,
  'TAGNT:' || s.source_ref,
  'directly_imported',
  'Parsed directly from STEP TAGNT column 0 bracketed KJV/TR versification locator'
from public.verses v
join public.books b on b.id = v.book
join public.verse_translation_sources s on s.verse_id = v.id
cross join (select id from public.source_editions where edition_key = 'step-tagnt-na28') tagnt_ed
cross join (select id from public.source_editions where edition_key = 'kjv-tr-versification') kjv_ed
cross join (select id from public.source_releases where release_key = 'stepbible-2026-11') sr
where split_part(s.source_ref, '#', 1) ~ '^[1-3]?[A-Za-z]{2,3}\.[0-9]+\.[0-9]+\[[0-9]+\.[0-9]+\]$'
order by v.id, to_ref, s.word_position
on conflict (canonical_verse_id, from_edition_id, to_edition_id, to_ref) do nothing;

-- 2e. Record canonical original-language verses absent as standalone verse_nr in webp-2026-11 (e.g., Psalm 0 superscriptions)
insert into public.versification_mappings (
  canonical_verse_id, from_edition_id, from_ref,
  to_edition_id, to_book, to_chapter, to_verse_nr, to_ref,
  mapping_kind, source_release_id, source_record_id,
  origin_mode, derivation_method, algorithm_version
)
select
  v.id,
  case when v.book <= 39 then tahot_ed.id else tagnt_ed.id end,
  b.usfm || '.' || v.chapter || '.' || v.verse_nr,
  web_ed.id,
  v.book,
  v.chapter,
  v.verse_nr,
  'WEB:ABSENT:' || b.usfm || '.' || v.chapter || '.' || v.verse_nr,
  'absent_in_edition',
  web_sr.id,
  'webp-2026-11:diff:' || b.usfm || '.' || v.chapter || '.' || v.verse_nr,
  'algorithmically_calculated',
  'Exact (book, chapter, verse_nr) set difference between canonical verses and reader_english_verses',
  'versification-diff-v1.0'
from public.verses v
join public.books b on b.id = v.book
cross join (select id from public.source_editions where edition_key = 'step-tahot-wlc') tahot_ed
cross join (select id from public.source_editions where edition_key = 'step-tagnt-na28') tagnt_ed
cross join (select id from public.source_editions where edition_key = 'webp-2026-11') web_ed
cross join (select id from public.source_releases where release_key = 'webp-2026-11') web_sr
left join public.reader_english_verses rev
  on rev.edition_id = 'webp-2026-11'
  and rev.book = v.book and rev.chapter = v.chapter and rev.verse_nr = v.verse_nr
where rev.book is null
on conflict (canonical_verse_id, from_edition_id, to_edition_id, to_ref) do nothing;

-- ============================================================================
-- 3. CANONICAL LEMMAS, LEXEME METADATA & LEXEME IDENTIFIERS
-- ============================================================================
update public.lexemes l
set source_edition_id = case when l.language = 'grc' then tbesg.id else tbesh.id end,
    source_record_id = case when l.language = 'grc' then 'TBESG:' || l.extended_strongs else 'TBESH:' || l.extended_strongs end
from (select id from public.source_editions where edition_key = 'step-tbesh') tbesh,
     (select id from public.source_editions where edition_key = 'step-tbesg') tbesg
where l.source_edition_id is null;

-- Canonical headword lemmas: every lexeme that is NOT a pure "= a Meaning of" sub-sense
-- of an existing parent lexeme becomes a canonical lemma (preserving homographs!).
insert into public.lemmas (
  lemma_key, language, lemma_script, lemma_stripped, transliteration,
  primary_pos, homograph_tag, base_strongs, primary_lexeme_id,
  source_release_id, source_edition_id, source_record_id
)
select
  'lemma:' || l.lexeme_key,
  l.language,
  l.original_lemma,
  regexp_replace(
    normalize(l.original_lemma, NFKD),
    '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF]',
    '',
    'g'
  ) as lemma_stripped,
  l.transliteration,
  l.pos,
  case
    when l.extended_strongs ~ '[A-Za-z]$' then right(l.extended_strongs, 1)
    else null
  end as homograph_tag,
  l.base_strongs,
  l.id,
  coalesce(l.source_release_id, sr.id),
  l.source_edition_id,
  coalesce(l.source_record_id, 'STEP:' || l.lexeme_key)
from public.lexemes l
cross join (select id from public.source_releases where release_key = 'stepbible-2026-11') sr
where not (
  coalesce(l.disambiguated_strongs, '') like '%= a Meaning of%'
  and l.unified_strongs is not null
  and l.unified_strongs <> l.extended_strongs
  and exists (
    select 1 from public.lexemes parent
    where parent.extended_strongs = l.unified_strongs
      and parent.id <> l.id
  )
)
on conflict (lemma_key) do nothing;

-- Link every lexeme (both primary headword lexemes and "= a Meaning of" sub-sense lexemes) to its canonical lemma
update public.lexemes l
set lemma_id = lem.id
from public.lemmas lem
where lem.primary_lexeme_id = l.id
  and l.lemma_id is null;

update public.lexemes l
set lemma_id = parent_lem.id
from public.lexemes parent
join public.lemmas parent_lem on parent_lem.primary_lexeme_id = parent.id
where l.lemma_id is null
  and coalesce(l.disambiguated_strongs, '') like '%= a Meaning of%'
  and parent.extended_strongs = l.unified_strongs;

-- Populate namespaced identifiers for all 22,719 lexemes
insert into public.lexeme_identifiers (
  lexeme_id, id_namespace, id_value, is_primary,
  source_release_id, source_edition_id, source_record_id
)
select
  l.id,
  ns.id_namespace,
  ns.id_value,
  ns.is_primary,
  coalesce(l.source_release_id, sr.id),
  l.source_edition_id,
  coalesce(l.source_record_id, 'STEP:' || l.lexeme_key)
from public.lexemes l
cross join (select id from public.source_releases where release_key = 'stepbible-2026-11') sr
cross join lateral (
  values
    ('step_lexeme_key', l.lexeme_key, true),
    ('base_strongs', l.base_strongs, false),
    ('extended_strongs', l.extended_strongs, true),
    ('disambiguated_strongs', nullif(btrim(coalesce(l.disambiguated_strongs, '')), ''), false),
    ('unified_strongs', nullif(btrim(coalesce(l.unified_strongs, '')), ''), false)
) as ns(id_namespace, id_value, is_primary)
where ns.id_value is not null
on conflict (lexeme_id, id_namespace, id_value) do nothing;

-- ============================================================================
-- 4. DOCUMENTED LEXICAL ROOTS & ETYMOLOGICAL LINKS (STEP TBESH/TBESG uStrong)
-- ============================================================================
-- Any target lexeme referenced via STEP directional markers (= in Aramaic of,
-- = in Hebrew of, = the Greek of, = a Part of, = combination of, = a group of,
-- = a Spelling of, = a form of, = a Name of) anchors a documented root/base node.
with etym_pairs as (
  select
    child.id as child_lexeme_id,
    child.lemma_id as child_lemma_id,
    target.id as target_lexeme_id,
    target.lemma_id as target_lemma_id,
    target.language as target_language,
    target.lexeme_key as target_lexeme_key,
    target.original_lemma as target_script,
    target.transliteration as target_translit,
    target.source_release_id,
    target.source_edition_id,
    target.source_record_id as target_record_id,
    child.source_record_id as child_record_id,
    child.disambiguated_strongs,
    case
      when child.disambiguated_strongs ilike '%= in Aramaic of%' then 'aramaic_cognate_of'
      when child.disambiguated_strongs ilike '%= in Hebrew of%' then 'hebrew_cognate_of'
      when child.disambiguated_strongs ilike '%= the Greek of%' then 'greek_loan_or_transliteration'
      when child.disambiguated_strongs ilike '%= a Part of%' then 'compound_part_of'
      when child.disambiguated_strongs ilike '%= combination of%' then 'combination_of'
      when child.disambiguated_strongs ilike '%= a group of%' or child.disambiguated_strongs ilike '%= a Group member of%' then 'group_member_of'
      when child.disambiguated_strongs ilike '%= a Spelling of%' then 'spelling_variant_of'
      when child.disambiguated_strongs ilike '%= a form of%' then 'form_of'
      when child.disambiguated_strongs ilike '%= a Name of%' then 'shared_name_base'
      else null
    end as etym_type
  from public.lexemes child
  join public.lexemes target
    on (target.extended_strongs = child.unified_strongs or target.lexeme_key = child.unified_strongs)
   and target.id <> child.id
  where child.lemma_id is not null
    and target.lemma_id is not null
)
insert into public.lexical_roots (
  root_key, language, root_script, root_stripped, transliteration,
  root_kind, anchor_lexeme_id, source_release_id, source_edition_id, source_record_id
)
select distinct on (ep.target_lexeme_key)
  'root:' || ep.target_lexeme_key,
  ep.target_language,
  ep.target_script,
  regexp_replace(
    normalize(ep.target_script, NFKD),
    '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF]',
    '',
    'g'
  ),
  ep.target_translit,
  case
    when ep.etym_type in ('aramaic_cognate_of', 'hebrew_cognate_of', 'greek_loan_or_transliteration')
      then 'semitic_cross_dialect_base'
    when ep.target_language = 'grc'
      then 'greek_etymological_stem'
    else 'documented_lexical_base'
  end,
  ep.target_lexeme_id,
  coalesce(ep.source_release_id, 1),
  ep.source_edition_id,
  coalesce(ep.target_record_id, 'STEP:' || ep.target_lexeme_key)
from etym_pairs ep
where ep.etym_type is not null
order by ep.target_lexeme_key
on conflict (root_key) do nothing;

-- Anchor each root's own base lemma + link all documented derived/cognate/variant lemmas
insert into public.lemma_root_links (
  lemma_id, root_id, etymology_type, implies_synonymy, evidence_note,
  source_release_id, source_edition_id, source_record_id,
  origin_mode, derivation_method
)
select
  ax.lemma_id,
  r.id,
  'base_root_anchor',
  false,
  'Base lexical headword anchoring documented STEP uStrong etymological/morphological family; shared root does not imply synonymy.',
  r.source_release_id,
  r.source_edition_id,
  r.source_record_id,
  'directly_imported',
  'Anchor headword referenced by STEP TBESH/TBESG uStrong column'
from public.lexical_roots r
join public.lexemes ax on ax.id = r.anchor_lexeme_id
where ax.lemma_id is not null
on conflict (lemma_id, root_id, etymology_type) do nothing;

insert into public.lemma_root_links (
  lemma_id, root_id, etymology_type, implies_synonymy, evidence_note,
  source_release_id, source_edition_id, source_record_id,
  origin_mode, derivation_method
)
select distinct on (child.lemma_id, r.id, etym_map.etym_type)
  child.lemma_id,
  r.id,
  etym_map.etym_type,
  false,
  'STEP dStrong marker "' || btrim(regexp_replace(child.disambiguated_strongs, '^[HG0-9A-Za-z]+\s*', '')) || ' ' || child.unified_strongs || '" (shared root/derivation does NOT imply synonymy).',
  coalesce(child.source_release_id, 1),
  child.source_edition_id,
  coalesce(child.source_record_id, 'STEP:' || child.lexeme_key),
  'directly_imported',
  'Parsed directly from STEP TBESH/TBESG dStrong -> uStrong directional relation column'
from public.lexemes child
join public.lexemes target
  on (target.extended_strongs = child.unified_strongs or target.lexeme_key = child.unified_strongs)
 and target.id <> child.id
join public.lexical_roots r on r.anchor_lexeme_id = target.id
cross join lateral (
  select case
    when child.disambiguated_strongs ilike '%= in Aramaic of%' then 'aramaic_cognate_of'
    when child.disambiguated_strongs ilike '%= in Hebrew of%' then 'hebrew_cognate_of'
    when child.disambiguated_strongs ilike '%= the Greek of%' then 'greek_loan_or_transliteration'
    when child.disambiguated_strongs ilike '%= a Part of%' then 'compound_part_of'
    when child.disambiguated_strongs ilike '%= combination of%' then 'combination_of'
    when child.disambiguated_strongs ilike '%= a group of%' or child.disambiguated_strongs ilike '%= a Group member of%' then 'group_member_of'
    when child.disambiguated_strongs ilike '%= a Spelling of%' then 'spelling_variant_of'
    when child.disambiguated_strongs ilike '%= a form of%' then 'form_of'
    when child.disambiguated_strongs ilike '%= a Name of%' then 'shared_name_base'
    else null
  end as etym_type
) etym_map
where child.lemma_id is not null
  and etym_map.etym_type is not null
order by child.lemma_id, r.id, etym_map.etym_type, child.id
on conflict (lemma_id, root_id, etymology_type) do nothing;

-- ============================================================================
-- 5. LEXICAL SENSES (LICENSED PRIMARY & HIERARCHICAL STEP SENSES)
-- ============================================================================
-- 5a. Primary lexicon sense per primary headword lexeme (strictly licensed:
--     TBESH uses STEP CC BY gloss + curated notes only; TBESG uses STEP + Abbott-Smith/ML)
insert into public.lexical_senses (
  sense_key, lemma_id, lexeme_id, parent_sense_id, sense_code, sense_order,
  short_gloss, definition_text, usage_note,
  source_attribution, source_release_id, source_edition_id, source_record_id
)
select
  'sense:' || l.lexeme_key || ':primary',
  l.lemma_id,
  l.id,
  null,
  'primary',
  1,
  l.primary_gloss,
  case
    when l.language = 'grc' and l.homograph_note is not null and length(btrim(l.homograph_note)) > 0
      then l.homograph_note
    when l.id <= 15 and l.homograph_note is not null
      then l.primary_gloss || ' — ' || l.homograph_note
    else l.primary_gloss
  end as definition_text,
  case when l.language in ('hbo', 'arc') and l.id > 15 then l.homograph_note else null end,
  case
    when l.language = 'grc' then 'STEPBible TBESG / Abbott-Smith / Middle Liddell (CC BY 4.0)'
    else 'STEPBible TBESH Extended Strongs Gloss (CC BY 4.0; Online Bible Meaning excluded)'
  end,
  coalesce(l.source_release_id, 1),
  l.source_edition_id,
  coalesce(l.source_record_id, 'STEP:' || l.lexeme_key)
from public.lexemes l
join public.lemmas lem on lem.primary_lexeme_id = l.id
where l.lemma_id is not null
  and l.source_edition_id is not null
on conflict (sense_key) do nothing;

-- 5b. Sub-senses from STEP "= a Meaning of" entries attached under their parent lemma's primary sense
insert into public.lexical_senses (
  sense_key, lemma_id, lexeme_id, parent_sense_id, sense_code, sense_order,
  short_gloss, definition_text, usage_note,
  source_attribution, source_release_id, source_edition_id, source_record_id
)
select
  'sense:' || sub.lexeme_key || ':sub',
  sub.lemma_id,
  sub.id,
  parent_sense.id,
  'sub:' || sub.extended_strongs,
  (1 + row_number() over (partition by sub.lemma_id order by sub.lexeme_key))::smallint,
  sub.primary_gloss,
  case
    when sub.language = 'grc' and sub.homograph_note is not null and length(btrim(sub.homograph_note)) > 0
      then sub.homograph_note
    else sub.primary_gloss
  end,
  'STEP disambiguated sub-sense (' || sub.extended_strongs || ' = a Meaning of ' || coalesce(sub.unified_strongs, '') || ')',
  case
    when sub.language = 'grc' then 'STEPBible TBESG Sub-sense (CC BY 4.0)'
    else 'STEPBible TBESH Sub-sense Gloss (CC BY 4.0; Online Bible Meaning excluded)'
  end,
  coalesce(sub.source_release_id, 1),
  sub.source_edition_id,
  coalesce(sub.source_record_id, 'STEP:' || sub.lexeme_key)
from public.lexemes sub
join public.lemmas lem on lem.id = sub.lemma_id and lem.primary_lexeme_id <> sub.id
left join public.lexical_senses parent_sense
  on parent_sense.lemma_id = lem.id and parent_sense.sense_code = 'primary'
where sub.source_edition_id is not null
on conflict (sense_key) do nothing;

-- ============================================================================
-- 6. EXTERNAL CONCEPTS, PROPERTIES & HYPERLINKS (PLACES, EVENTS & MOTIFS)
-- ============================================================================
update public.concepts c
set external_entity_type = 'literary_motif',
    epistemic_layer = 'reviewed_research',
    source_release_id = sr.id,
    source_edition_id = se.id,
    source_record_id = 'curated-motifs-v1:' || c.concept_key
from (select id from public.source_releases where release_key = 'curated-motifs-v1') sr,
     (select id from public.source_editions where edition_key = 'curated-motifs-edition-v1') se
where c.source_release_id is null;

-- Register published biblical places as external factual concepts (without polluting short motif aliases)
insert into public.concepts (
  concept_key, title, concept_kind, summary, primary_strongs,
  distinct_from_note, external_entity_type, epistemic_layer,
  source_release_id, source_edition_id, source_record_id
)
select
  'PLACE:' || p.place_key,
  p.biblical_name,
  case when p.place_type in ('river', 'mountain', 'sea', 'valley', 'spring', 'region', 'island', 'body of water')
       then 'natural_feature' else 'object' end,
  coalesce(
    loc.evidence_summary,
    p.biblical_name || ' (' || p.place_type || case when p.is_non_physical then ', symbolic/non-physical' else '' end || ').'
  ),
  coalesce(p.strongs_numbers, '{}'::text[]),
  'External geographical/archaeological identification from OpenBible/Pleiades/TIPNR; external factual data is distinct from biblical theological interpretation.',
  'biblical_place',
  'external_factual',
  sr.id,
  se.id,
  'places:' || p.place_key
from public.places p
cross join (select id from public.source_releases where release_key = 'openbible-pleiades-2026') sr
cross join (select id from public.source_editions where edition_key = 'openbible-pleiades-gazetteer') se
left join lateral (
  select l.evidence_summary
  from public.place_locations l
  where l.place_id = p.id and l.published
  order by l.rank_order asc, l.id asc
  limit 1
) loc on true
where p.published
on conflict (concept_key) do nothing;

-- Populate external factual properties for places (place_type, coordinates, modern_name, confidence, active_eras)
insert into public.concept_properties (
  concept_id, property_key, property_value, value_type, unit,
  epistemic_layer, external_citation, source_release_id, source_edition_id, source_record_id
)
select
  c.id,
  prop.property_key,
  prop.property_value,
  prop.value_type,
  prop.unit,
  'external_factual',
  coalesce(p.external_ids->>'openbible_url', p.external_ids->>'pleiades_url', 'OpenBible/Pleiades Gazetteer'),
  sr.id,
  se.id,
  'places:' || p.place_key || ':' || prop.property_key
from public.places p
join public.concepts c on c.concept_key = 'PLACE:' || p.place_key
cross join (select id from public.source_releases where release_key = 'openbible-pleiades-2026') sr
cross join (select id from public.source_editions where edition_key = 'openbible-pleiades-gazetteer') se
left join lateral (
  select l.modern_name, l.latitude, l.longitude, l.confidence_label, l.location_status
  from public.place_locations l
  where l.place_id = p.id and l.published and not l.is_alternative
  order by l.rank_order asc, l.id asc
  limit 1
) loc on true
cross join lateral (
  values
    ('place_type', p.place_type, 'string', null),
    ('is_non_physical', p.is_non_physical::text, 'boolean', null),
    ('modern_name', nullif(btrim(coalesce(loc.modern_name, '')), ''), 'string', null),
    ('coordinates_lat_lon', case when loc.latitude is not null and loc.longitude is not null then loc.latitude::text || ',' || loc.longitude::text else null end, 'coordinate', 'WGS84_deg'),
    ('identification_confidence', loc.confidence_label, 'string', null),
    ('tipnr_id', p.external_ids->>'tipnr_id', 'identifier', null),
    ('pleiades_id', p.external_ids->>'pleiades_id', 'identifier', null),
    ('wikidata_id', p.external_ids->>'wikidata_id', 'identifier', null),
    ('active_eras', case when cardinality(p.active_eras) > 0 then array_to_string(p.active_eras, ', ') else null end, 'string', null)
) as prop(property_key, property_value, value_type, unit)
where prop.property_value is not null
on conflict (concept_id, property_key, property_value, source_record_id) do nothing;

-- Populate verified external hyperlinks (Pleiades, Wikidata, OpenBible) for place concepts
insert into public.concept_external_links (
  concept_id, provider, external_id, external_url, link_relation,
  license, source_release_id, source_record_id
)
select
  c.id,
  lnk.provider,
  lnk.external_id,
  lnk.external_url,
  lnk.link_relation,
  lnk.license,
  sr.id,
  'places:' || p.place_key || ':' || lnk.provider
from public.places p
join public.concepts c on c.concept_key = 'PLACE:' || p.place_key
cross join (select id from public.source_releases where release_key = 'openbible-pleiades-2026') sr
cross join lateral (
  values
    ('pleiades', p.external_ids->>'pleiades_id', p.external_ids->>'pleiades_url', 'gazetteer_reference', 'CC BY 3.0 (Pleiades)'),
    ('wikidata', p.external_ids->>'wikidata_id', p.external_ids->>'wikidata_url', 'exact_match', 'CC0 1.0 (Wikidata)'),
    ('openbible', p.external_ids->>'openbible_id', p.external_ids->>'openbible_url', 'gazetteer_reference', 'CC BY 4.0 (OpenBible.info)')
) as lnk(provider, external_id, external_url, link_relation, license)
where lnk.external_id is not null
  and lnk.external_url is not null
  and lnk.external_url ~ '^https?://'
on conflict (concept_id, provider, external_id) do nothing;

-- ============================================================================
-- 7. RELATION TYPES, CANONICAL ENTITIES & ENTITY RELATIONSHIPS
-- ============================================================================
insert into public.relation_types (
  relation_type, category, inverse_relation_type, is_symmetric, implies_synonymy, description
)
values
  ('has_lexical_sense', 'lexical', 'sense_of_lemma', false, false, 'Links a canonical lemma to one of its documented lexical senses.'),
  ('lexeme_realizes_lemma', 'lexical', 'has_lexeme_entry', false, false, 'Links a lexicon entry (TBESH/TBESG) to its canonical headword lemma.'),
  ('derived_from_root', 'etymological', 'root_has_derivative', false, false, 'Documented etymological or morphological derivation from a lexical root; never implies synonymy.'),
  ('aramaic_cognate_of', 'etymological', 'hebrew_cognate_of', false, false, 'Documented STEP Aramaic-to-Hebrew cognate relationship; never implies synonymy.'),
  ('hebrew_cognate_of', 'etymological', 'aramaic_cognate_of', false, false, 'Documented STEP Hebrew-to-Aramaic cognate relationship; never implies synonymy.'),
  ('greek_transliteration_of', 'etymological', 'transliterated_into_greek', false, false, 'Documented STEP Greek loanword or proper-name transliteration of a Semitic entry.'),
  ('compound_part_of', 'etymological', 'has_compound_part', false, false, 'Documented compound component relation in STEP lexicon.'),
  ('spelling_or_form_variant_of', 'lexical', 'has_spelling_or_form_variant', false, false, 'Documented orthographic spelling or stem variant in STEP lexicon.'),
  ('abbott_smith_synonym_note', 'lexical', 'abbott_smith_synonym_note', true, false, 'Explicitly discussed near-synonym comparison in Abbott-Smith (distinguishing nuances rather than asserting full interchangeability).'),
  ('versification_equivalent', 'versification', 'versification_equivalent', true, false, 'Documented passage numbering shift across Masoretic, English, or KJV/TR versification schemes.'),
  ('attested_at_place', 'external_factual', 'place_attested_in_passage', false, false, 'Documented geographical reference linking a biblical passage to a gazetteer place.'),
  ('associated_with_event', 'external_factual', 'event_associated_with_passage', false, false, 'Audited historical setting or chronological event association.'),
  ('parallel_passage_text', 'textual_parallel', 'parallel_passage_text', true, false, 'Audited textual parallel across biblical books (e.g., Psalm 18 and 2 Samuel 22).'),
  ('narrative_parallel', 'interpretive', 'narrative_parallel', true, false, 'Reviewed literary type-scene or narrative parallel with explicit scope and controls.'),
  ('possible_allusion', 'interpretive', 'alluded_to_by', false, false, 'Reviewed intertextual allusion with explicit textual span evidence.'),
  ('identified_as_in_passage', 'textual_parallel', 'identifies_symbol', false, false, 'Explicit intra-textual identification stated within a biblical passage (e.g., Rev 1:20).'),
  ('lexical_distinction', 'lexical', 'lexical_distinction', true, false, 'Explicit distinction preventing conflation of distinct lexemes or homographs.'),
  ('homograph_subdivision', 'lexical', 'homograph_subdivision', true, false, 'Explicit separation of numbered homographs sharing an unpointed or base Strong''s code.')
on conflict (relation_type) do nothing;

-- Register canonical entities for lemmas, roots, senses, concepts, places, chronology_events, and existing research_nodes
insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, lemma_id, source_release_id, source_record_id
)
select
  lem.lemma_key, 'lemma',
  lem.lemma_script || ' (' || lem.transliteration || coalesce(' · ' || lem.base_strongs, '') || ')',
  lem.language, lem.id, lem.source_release_id, lem.source_record_id
from public.lemmas lem
on conflict (entity_key) do nothing;

insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, lexeme_id, source_release_id, source_record_id
)
select
  'lexeme:' || l.lexeme_key, 'lexeme',
  l.original_lemma || ' (' || l.extended_strongs || ' · ' || l.primary_gloss || ')',
  l.language, l.id, coalesce(l.source_release_id, 1), coalesce(l.source_record_id, 'STEP:' || l.lexeme_key)
from public.lexemes l
on conflict (entity_key) do nothing;

insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, root_id, source_release_id, source_record_id
)
select
  r.root_key, 'root',
  r.root_script || coalesce(' (' || r.transliteration || ')', ''),
  r.language, r.id, r.source_release_id, r.source_record_id
from public.lexical_roots r
on conflict (entity_key) do nothing;

insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, sense_id, source_release_id, source_record_id
)
select
  s.sense_key, 'sense',
  s.short_gloss || ' [' || s.sense_code || ']',
  lem.language, s.id, s.source_release_id, s.source_record_id
from public.lexical_senses s
join public.lemmas lem on lem.id = s.lemma_id
on conflict (entity_key) do nothing;

insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, concept_id, source_release_id, source_record_id
)
select
  'concept:' || c.concept_key, 'concept',
  c.title, 'en', c.id, c.source_release_id, c.source_record_id
from public.concepts c
on conflict (entity_key) do nothing;

insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, place_id, source_release_id, source_record_id
)
select
  'place:' || p.place_key, 'place',
  p.biblical_name || ' (' || p.place_type || ')',
  'en', p.id, sr.id, 'places:' || p.place_key
from public.places p
cross join (select id from public.source_releases where release_key = 'openbible-pleiades-2026') sr
where p.published
on conflict (entity_key) do nothing;

insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, chronology_event_id, source_release_id, source_record_id
)
select
  'event:' || e.event_key, 'chronology_event',
  e.title || ' (' || e.original_date || ')',
  'en', e.id, sr.id, 'chronology_events:' || e.event_key
from public.chronology_events e
cross join (select id from public.source_releases where release_key = 'theographic-chronology-2026') sr
where e.published
on conflict (entity_key) do nothing;

insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, research_node_id, source_release_id, source_record_id
)
select
  'rnode:' || rn.node_key, 'research_node',
  rn.display_label, 'en', rn.id, sr.id, 'research_nodes:' || rn.node_key
from public.research_nodes rn
cross join (select id from public.source_releases where release_key = 'curated-motifs-v1') sr
on conflict (entity_key) do nothing;

-- Register canonical passage entities for verses participating in events, parallel texts, or benchmark assertions
insert into public.canonical_entities (
  entity_key, entity_kind, display_label, language, verse_id, source_release_id, source_record_id
)
select
  'passage:' || b.usfm || '.' || v.chapter || '.' || v.verse_nr,
  'passage',
  b.name || ' ' || v.chapter || ':' || v.verse_nr,
  b.original_language,
  v.id,
  sr.id,
  b.usfm || '.' || v.chapter || '.' || v.verse_nr
from public.verses v
join public.books b on b.id = v.book
cross join (select id from public.source_releases where release_key = 'stepbible-2026-11') sr
where exists (
  select 1 from public.reader_text_event_links l
  where l.book = v.book and l.chapter = v.chapter and v.verse_nr = l.start_verse
)
or exists (
  select 1 from public.verse_geography vg where vg.verse_id = v.id and vg.published
)
on conflict (entity_key) do nothing;

-- 7a. Populate etymological entity_relationships from lemma_root_links (with full provenance)
insert into public.entity_relationships (
  relationship_key, subject_entity_id, object_entity_id, relation_type,
  epistemic_layer, origin_mode, derivation_method, algorithm_version,
  external_citation, evidence_summary,
  source_release_id, source_edition_id, source_record_id, review_status
)
select
  'rel:etym:' || lrl.id,
  ce_lem.id,
  ce_root.id,
  case
    when lrl.etymology_type = 'aramaic_cognate_of' then 'aramaic_cognate_of'
    when lrl.etymology_type = 'hebrew_cognate_of' then 'hebrew_cognate_of'
    when lrl.etymology_type = 'greek_loan_or_transliteration' then 'greek_transliteration_of'
    when lrl.etymology_type = 'compound_part_of' then 'compound_part_of'
    when lrl.etymology_type in ('spelling_variant_of', 'form_of') then 'spelling_or_form_variant_of'
    else 'derived_from_root'
  end,
  'lexical_reference',
  lrl.origin_mode,
  lrl.derivation_method,
  lrl.algorithm_version,
  'STEPBible Lexicon (' || lrl.source_record_id || ')',
  coalesce(lrl.evidence_note, 'Documented STEP etymological/morphological relationship.'),
  lrl.source_release_id,
  lrl.source_edition_id,
  lrl.source_record_id,
  'reviewed'
from public.lemma_root_links lrl
join public.canonical_entities ce_lem on ce_lem.lemma_id = lrl.lemma_id
join public.canonical_entities ce_root on ce_root.root_id = lrl.root_id
where lrl.etymology_type <> 'base_root_anchor'
on conflict (relationship_key) do nothing;

-- 7b. Populate reviewed benchmark assertions into entity_relationships with exact span citations
insert into public.entity_relationships (
  relationship_key, subject_entity_id, object_entity_id, relation_type,
  epistemic_layer, origin_mode, derivation_method,
  supporting_span_ref, external_citation, evidence_summary,
  source_release_id, source_edition_id, source_record_id, review_status
)
select
  'rel:assertion:' || a.assertion_key,
  coalesce(ce_subj_concept.id, ce_subj_lex.id, ce_subj_rn.id),
  coalesce(ce_obj_concept.id, ce_obj_lex.id, ce_obj_rn.id),
  case
    when a.predicate in ('narrative_parallel', 'possible_allusion', 'identified_as_in_passage', 'lexical_distinction', 'homograph_subdivision')
      then a.predicate
    else 'lexical_distinction'
  end,
  case
    when a.epistemic_category in ('lexical', 'linguistic') then 'lexical_reference'
    when a.epistemic_category = 'textual' then 'primary_biblical'
    else 'reviewed_interpretation'
  end,
  'directly_imported',
  'Imported from reviewed benchmark assertions table with explicit scope and counterexample controls',
  a.scope_reference,
  a.source_attribution,
  a.summary || ' [Limitations: ' || a.limitations_note || ']',
  sr.id,
  se.id,
  'assertions:' || a.assertion_key,
  a.review_status
from public.assertions a
join public.research_nodes sn on sn.id = a.subject_node_id
join public.research_nodes onode on onode.id = a.object_node_id
left join public.canonical_entities ce_subj_concept on sn.concept_id is not null and ce_subj_concept.concept_id = sn.concept_id
left join public.canonical_entities ce_subj_lex on sn.lexeme_id is not null and ce_subj_lex.lexeme_id = sn.lexeme_id
left join public.canonical_entities ce_subj_rn on ce_subj_rn.research_node_id = sn.id
left join public.canonical_entities ce_obj_concept on onode.concept_id is not null and ce_obj_concept.concept_id = onode.concept_id
left join public.canonical_entities ce_obj_lex on onode.lexeme_id is not null and ce_obj_lex.lexeme_id = onode.lexeme_id
left join public.canonical_entities ce_obj_rn on ce_obj_rn.research_node_id = onode.id
cross join (select id from public.source_releases where release_key = 'curated-motifs-v1') sr
cross join (select id from public.source_editions where edition_key = 'curated-motifs-edition-v1') se
on conflict (relationship_key) do nothing;

-- 7c. Populate audited cross-book textual setting/parallel links (Psalm 3 <-> 2 Sam 15, Psalm 51 <-> 2 Sam 12, Psalm 18 <-> 2 Sam 22)
insert into public.entity_relationships (
  relationship_key, subject_entity_id, object_entity_id, relation_type,
  epistemic_layer, origin_mode, derivation_method,
  supporting_span_ref, supporting_verse_id, external_citation, evidence_summary,
  source_release_id, source_edition_id, source_record_id, review_status
)
select
  'rel:text-event:' || e.event_key,
  ce_p1.id,
  ce_p2.id,
  case when e.relationship = 'parallel_text' then 'parallel_passage_text' else 'associated_with_event' end,
  'primary_biblical',
  'directly_imported',
  'Audited superscription / parallel-song link from reader_text_events',
  e.source_reference,
  v1.id,
  e.source_url,
  e.reason,
  sr.id,
  se.id,
  'reader_text_events:' || e.event_key,
  'reviewed'
from public.reader_text_events e
join public.reader_text_event_links l1 on l1.event_key = e.event_key and l1.book = 19
join public.reader_text_event_links l2 on l2.event_key = e.event_key and l2.book <> 19
join public.verses v1 on v1.book = l1.book and v1.chapter = l1.chapter and v1.verse_nr = l1.start_verse
join public.verses v2 on v2.book = l2.book and v2.chapter = l2.chapter and v2.verse_nr = l2.start_verse
join public.canonical_entities ce_p1 on ce_p1.verse_id = v1.id
join public.canonical_entities ce_p2 on ce_p2.verse_id = v2.id
cross join (select id from public.source_releases where release_key = 'webp-2026-11') sr
cross join (select id from public.source_editions where edition_key = 'webp-2026-11') se
on conflict (relationship_key) do nothing;

-- 7d. Populate passage -> place factual attestations (verse_geography)
insert into public.entity_relationships (
  relationship_key, subject_entity_id, object_entity_id, relation_type,
  epistemic_layer, origin_mode, derivation_method,
  supporting_span_ref, supporting_verse_id, external_citation, evidence_summary,
  source_release_id, source_edition_id, source_record_id, review_status
)
select
  'rel:vgeo:' || vg.id,
  ce_v.id,
  ce_pl.id,
  'attested_at_place',
  'external_factual',
  'directly_imported',
  'Imported from published verse_geography gazetteer links',
  b.name || ' ' || v.chapter || ':' || v.verse_nr,
  v.id,
  'OpenBible / STEP TIPNR Gazetteer',
  coalesce(vg.evidence_explanation, 'Geographical attestation (' || vg.relationship_type || ') linking ' || b.name || ' ' || v.chapter || ':' || v.verse_nr || ' to ' || p.biblical_name || '.'),
  sr.id,
  se.id,
  'verse_geography:' || vg.id,
  'reviewed'
from public.verse_geography vg
join public.verses v on v.id = vg.verse_id
join public.books b on b.id = v.book
join public.places p on p.id = vg.place_id
join public.canonical_entities ce_v on ce_v.verse_id = v.id
join public.canonical_entities ce_pl on ce_pl.place_id = p.id
cross join (select id from public.source_releases where release_key = 'openbible-pleiades-2026') sr
cross join (select id from public.source_editions where edition_key = 'openbible-pleiades-gazetteer') se
where vg.published and p.published
on conflict (relationship_key) do nothing;
