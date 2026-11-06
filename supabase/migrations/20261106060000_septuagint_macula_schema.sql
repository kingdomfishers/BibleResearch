-- SEP-02: field license registry, MACULA Hebrew storage, Swete LXX storage, Hebrew-LXX verse map.
-- Purely additive: no constraint, table or policy is dropped or altered.
-- User decision 2026-11-06: MACULA `greek`/`greekstrong` are ENABLED although their upstream origin is unverified.
-- That status is recorded in field_license_registry and surfaced on every row returned by lookup RPCs.
-- The Swete edition uses versification_scheme 'not_applicable' because the existing CHECK has no LXX value;
-- its LXX numbering is documented in licensing_notes and in hebrew_lxx_verse_map.

insert into public.source_releases (release_key, dataset, commit_sha, license, attribution, version_label, source_url, licensing_constraints, epistemic_layer, sha256_manifest)
values
 ('macula-hebrew-47db250', 'Clear-Bible/macula-hebrew', '47db250bd55d0d8577f2a94fba114ef16c35b23c', 'CC BY 4.0',
  'MACULA Hebrew Linguistic Datasets, available at https://github.com/Clear-Bible/macula-hebrew/ (Biblica, Inc.); includes WLC (public domain), OSHB (CC BY 4.0), Groves Center syntax (CC BY 4.0), Cherith glosses (CC BY 4.0)',
  '2026-04-24 (47db250)', 'https://github.com/Clear-Bible/macula-hebrew',
  'UBS SDBH-derived fields (sdbh, lexdomain, coredomain, contextualdomain) are "used with permission" and are NOT imported. greek/greekstrong origin unverified (enabled by user decision). frame stored but disabled.',
  'primary_biblical', '{}'::jsonb),
 ('macula-greek-8423afe', 'Clear-Bible/macula-greek', '8423afe47b9e8f24b7772e808af45c7159a6fe7e', 'CC BY 4.0',
  'MACULA Greek Linguistic Datasets, available at https://github.com/Clear-Bible/macula-greek/ (Biblica, Inc.)',
  '2026-07-07 (8423afe)', 'https://github.com/Clear-Bible/macula-greek',
  'UBS MARBLE/Louw-Nida fields (domain, ln) are "used with permission" and are NOT imported.', 'primary_biblical', '{}'::jsonb),
 ('lxx-swete-26bad3e', 'nathans/lxx-swete', '26bad3eb42bba98471d154c954e36a6f30a0279d', 'CC BY-SA 4.0',
  'The Old Testament in Greek According to the Septuagint, ed. Henry Barclay Swete; derived from OpenGreekAndLatin First1KGreek tlg0527 (CC BY-SA 4.0). Share-alike applies to this text and annotations.',
  '2025-12-18 (26bad3e)', 'https://github.com/nathans/lxx-swete',
  'CC BY-SA 4.0: redistribution of this text (including API output) must credit the source and keep the same license. CATSS data is not used.', 'primary_biblical', '{}'::jsonb)
on conflict (release_key) do nothing;

insert into public.source_editions (edition_key, source_release_id, edition_kind, title, language, testament_scope, versification_scheme, license, licensing_notes, source_url)
select v.k, r.id, v.kind, v.title, v.lang, v.scope, v.vs, v.lic, v.note, r.source_url
from (values
 ('macula-hebrew-wlc', 'macula-hebrew-47db250', 'annotation_corpus', 'MACULA Hebrew treebank over WLC/OSHB', 'hbo', 'OT', 'masoretic_hebrew', 'CC BY 4.0', 'Masoretic references (MACULA ref field). Psalm superscriptions are verse 1.'),
 ('lxx-swete', 'lxx-swete-26bad3e', 'greek_text', 'Swete Septuagint (First1KGreek tlg0527)', 'grc', 'OT', 'not_applicable', 'CC BY-SA 4.0', 'LXX numbering (Psalms 1-151); lettered verses are Swete subdivisions. Plain text, no lemma/morphology.')
) as v(k, rel, kind, title, lang, scope, vs, lic, note)
join public.source_releases r on r.release_key = v.rel
on conflict (edition_key) do nothing;

-- Field-level license registry: the kill switch. RPCs consult field_is_enabled().
create table if not exists public.field_license_registry (
  id bigint generated always as identity primary key,
  dataset_key text not null,
  field_name text not null,
  field_group text not null,
  origin text not null,
  license text not null,
  status text not null check (status in ('enabled', 'enabled_origin_unverified', 'disabled_restricted', 'disabled_unverified')),
  decision_note text,
  decided_at timestamptz not null default now(),
  unique (dataset_key, field_name)
);

create or replace function public.field_is_enabled(p_dataset text, p_field text)
returns boolean language sql stable security invoker set search_path = ''
as $$ select coalesce((select status in ('enabled', 'enabled_origin_unverified')
  from public.field_license_registry where dataset_key = p_dataset and field_name = p_field), false) $$;

insert into public.field_license_registry (dataset_key, field_name, field_group, origin, license, status, decision_note)
select 'macula-hebrew', f, g, o, l, s, n from (values
 ('text','text_morph','WLC (public domain) + OSHB','CC BY 4.0','enabled',null),
 ('after','text_morph','WLC/OSHB','CC BY 4.0','enabled',null),
 ('lemma','text_morph','OSHB','CC BY 4.0','enabled',null),
 ('morph','text_morph','OSHB','CC BY 4.0','enabled',null),
 ('strongnumberx','text_morph','OSHB','CC BY 4.0','enabled',null),
 ('class','syntax','Groves Center + Clear','CC BY 4.0','enabled',null),
 ('gloss','gloss','Cherith Analytics','CC BY 4.0','enabled',null),
 ('english','gloss','Cherith Analytics','CC BY 4.0','enabled',null),
 ('mandarin','gloss','Cherith Analytics','CC BY 4.0','enabled',null),
 ('sensenumber','clear_annotation','Clear Bible','CC BY 4.0 (dataset-level)','enabled',null),
 ('subjref','clear_annotation','Clear Bible','CC BY 4.0 (dataset-level)','enabled',null),
 ('participantref','clear_annotation','Clear Bible','CC BY 4.0 (dataset-level)','enabled',null),
 ('greek','greek_equivalent','Undocumented upstream alignment ("drawn from the Septuagint")','CC BY 4.0 dataset-level; origin unverified','enabled_origin_unverified','Enabled by explicit user decision 2026-11-06. Upstream source undocumented; CATSS-derived origin cannot be ruled out. Kill switch: set status = disabled_unverified.'),
 ('greekstrong','greek_equivalent','Undocumented upstream alignment','CC BY 4.0 dataset-level; origin unverified','enabled_origin_unverified','Same decision as greek.'),
 ('frame','frame_unverified','A0/A1 frames resemble SDBH frames; Clear vs UBS origin not stated','unverified','disabled_unverified','Stored, not exposed.'),
 ('sdbh','sdbh_domains','UBS Semantic Dictionary of Biblical Hebrew','"Used with permission"','disabled_restricted','NOT imported.'),
 ('lexdomain','sdbh_domains','UBS SDBH','"Used with permission"','disabled_restricted','NOT imported.'),
 ('coredomain','sdbh_domains','UBS SDBH','"Used with permission"','disabled_restricted','NOT imported.'),
 ('contextualdomain','sdbh_domains','UBS SDBH','"Used with permission"','disabled_restricted','NOT imported (empty upstream).')
) as t(f, g, o, l, s, n)
on conflict (dataset_key, field_name) do nothing;

insert into public.field_license_registry (dataset_key, field_name, field_group, origin, license, status, decision_note)
values ('lxx-swete', 'text', 'text', 'Swete via First1KGreek tlg0527', 'CC BY-SA 4.0', 'enabled', 'Share-alike; kept in dedicated tables.')
on conflict (dataset_key, field_name) do nothing;

-- Distinct cross-linguistic alignment evidence types (never conflated)
insert into public.relation_types (relation_type, category, is_symmetric, implies_synonymy, description)
values
  ('explicit_source_word_alignment', 'lexical', false, false, 'Explicit source-provided original-language word alignment (e.g. MACULA Hebrew to Septuagint Greek token tag).'),
  ('lexicon_translation_equivalent', 'lexical', false, false, 'Lexicon-documented cross-language translation equivalent without token-level alignment claim.'),
  ('verse_parallel_cooccurrence', 'textual_parallel', true, false, 'Words co-occurring in corresponding Hebrew and Greek verses without claiming token-level correspondence.')
on conflict (relation_type) do nothing;

-- MACULA Hebrew morphemes (one row per upstream xml:id). Original text preserved byte-for-byte.
create table if not exists public.macula_hebrew_morphemes (
  id bigint generated always as identity primary key,
  macula_id text not null unique,
  ref_mt text not null,
  book smallint not null,
  chapter_mt smallint not null,
  verse_mt smallint not null,
  word_no smallint not null,
  morph_no smallint not null,
  class text,
  text_form text,
  after_text text,
  lemma text,
  strong_x text,
  morph_code text,
  lang text,
  stem text,
  morph_type text,
  gloss text,
  english text,
  mandarin text,
  sense_number text,
  subjref text,
  participantref text,
  canonical_verse_id integer references public.verses (id),
  word_id integer references public.words (id),
  link_status text not null default 'unlinked' check (link_status in ('matched_consonantal', 'unmatched', 'unlinked')),
  source_release_id bigint not null references public.source_releases (id),
  source_edition_id bigint not null references public.source_editions (id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  origin_mode text not null default 'directly_imported' check (origin_mode in ('directly_imported', 'algorithmically_calculated')),
  derivation_method text not null default 'macula_hebrew_tsv_row'
);
create index if not exists idx_mhm_ref on public.macula_hebrew_morphemes (book, chapter_mt, verse_mt, word_no, morph_no);
create index if not exists idx_mhm_strong on public.macula_hebrew_morphemes (strong_x);
create index if not exists idx_mhm_verse on public.macula_hebrew_morphemes (canonical_verse_id) where canonical_verse_id is not null;
create index if not exists idx_mhm_word on public.macula_hebrew_morphemes (word_id) where word_id is not null;
create index if not exists idx_mhm_release on public.macula_hebrew_morphemes (source_release_id);
create index if not exists idx_mhm_edition on public.macula_hebrew_morphemes (source_edition_id);

-- Registry-gated per-field values (greek, greekstrong, frame). Field status controls exposure.
create table if not exists public.macula_gated_field_values (
  morpheme_id bigint not null references public.macula_hebrew_morphemes (id) on delete cascade,
  dataset_key text not null default 'macula-hebrew',
  field_name text not null,
  field_value text not null,
  primary key (morpheme_id, field_name),
  foreign key (dataset_key, field_name) references public.field_license_registry (dataset_key, field_name)
);
create index if not exists idx_mgfv_field_value on public.macula_gated_field_values (field_name, field_value);
create index if not exists idx_mgfv_registry on public.macula_gated_field_values (dataset_key, field_name);

-- Swete LXX storage (CC BY-SA 4.0): books and word-ordered text. Verse labels keep Swete letters (e.g. 59a).
create table if not exists public.lxx_swete_books (
  book_no smallint primary key,
  file_name text not null unique,
  latin_name text not null,
  canonical_book smallint references public.books (id),
  source_release_id bigint not null references public.source_releases (id),
  source_edition_id bigint not null references public.source_editions (id)
);
create index if not exists idx_lxx_books_canonical on public.lxx_swete_books (canonical_book) where canonical_book is not null;
create index if not exists idx_lxx_books_release on public.lxx_swete_books (source_release_id);
create index if not exists idx_lxx_books_edition on public.lxx_swete_books (source_edition_id);

create table if not exists public.lxx_swete_words (
  id bigint generated always as identity primary key,
  book_no smallint not null references public.lxx_swete_books (book_no),
  chapter smallint not null,
  verse_nr smallint not null,
  verse_suffix text not null default '',
  ordinal integer not null,
  word_text text not null,
  source_record_id text not null,
  unique (book_no, chapter, verse_nr, verse_suffix, ordinal)
);

-- Hebrew (MT) <-> LXX verse correspondence. Reference-level only; never a word alignment.
create table if not exists public.hebrew_lxx_verse_map (
  id bigint generated always as identity primary key,
  canonical_verse_id integer not null references public.verses (id),
  lxx_book_no smallint not null references public.lxx_swete_books (book_no),
  lxx_chapter smallint not null,
  lxx_verse_nr smallint not null,
  lxx_verse_suffix text not null default '',
  mapping_kind text not null check (mapping_kind in ('same_reference', 'psalm_numbering_shift', 'versification_shift', 'lxx_plus', 'mt_plus', 'reordered')),
  rule_citation text not null,
  origin_mode text not null check (origin_mode in ('directly_imported', 'algorithmically_calculated')),
  derivation_method text not null,
  algorithm_version text not null,
  source_release_id bigint not null references public.source_releases (id),
  source_record_id text not null check (btrim(source_record_id) <> '')
);
create index if not exists idx_hlvm_verse on public.hebrew_lxx_verse_map (canonical_verse_id);
create index if not exists idx_hlvm_lxx on public.hebrew_lxx_verse_map (lxx_book_no, lxx_chapter, lxx_verse_nr, lxx_verse_suffix);
create index if not exists idx_hlvm_release on public.hebrew_lxx_verse_map (source_release_id);

-- Public read-only access (RLS enabled; no write grants).
do $$
declare t text;
begin
  foreach t in array array['field_license_registry','macula_hebrew_morphemes','macula_gated_field_values','lxx_swete_books','lxx_swete_words','hebrew_lxx_verse_map'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_public_read') then
      if t = 'macula_gated_field_values' then
        -- Kill switch applies to direct REST reads too: rows are visible only while the registry enables the field.
        execute format('create policy %I on public.%I for select to anon, authenticated using (public.field_is_enabled(dataset_key, field_name))', t||'_public_read', t);
      else
        execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t||'_public_read', t);
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
