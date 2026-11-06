-- F3-01: Schema migration for morphhb tokens, cross-dataset token mappings, and Hebrew syntax linkage.
-- Purely additive: preserves all existing tables, foreign keys, and indexes.

-- 1. Register morphhb source release
insert into public.source_releases (
  release_key, dataset, commit_sha, license, attribution, version_label, source_url, licensing_constraints, epistemic_layer, sha256_manifest
) values (
  'morphhb-3d15126',
  'openscriptures/morphhb',
  '3d15126fb1ef74867fc1434be1942e837932691f',
  'CC BY 4.0',
  'Open Scriptures Hebrew Bible (OSHB) based on WLC; includes token-level morphology, lemma references, and explicit Ketiv/Qere variants',
  '2018-12-14 (3d15126)',
  'https://github.com/openscriptures/morphhb',
  'CC BY 4.0 over public-domain WLC. No restrictive clauses.',
  'primary_biblical',
  '{}'::jsonb
) on conflict (release_key) do nothing;

-- 2. Register morphhb source edition
insert into public.source_editions (
  edition_key, source_release_id, edition_kind, title, language, testament_scope, versification_scheme, license, licensing_notes, source_url
)
select
  'morphhb-wlc',
  r.id,
  'hebrew_aramaic_text',
  'Open Scriptures Hebrew Bible (morphhb / WLC 4.20)',
  'hbo',
  'OT',
  'masoretic_hebrew',
  'CC BY 4.0',
  'Preserves exact OSIS IDs, morpheme segmentation slashes, cantillation levels, and explicit x-ketiv / x-qere variant readings.',
  r.source_url
from public.source_releases r
where r.release_key = 'morphhb-3d15126'
on conflict (edition_key) do nothing;

-- 3. Register field licenses in public.field_license_registry
insert into public.field_license_registry (dataset_key, field_name, field_group, origin, license, status, decision_note)
values
  ('morphhb', 'word_text', 'text_morph', 'OSHB / WLC', 'CC BY 4.0', 'enabled', null),
  ('morphhb', 'lemma', 'text_morph', 'OSHB', 'CC BY 4.0', 'enabled', null),
  ('morphhb', 'morph', 'text_morph', 'OSHB', 'CC BY 4.0', 'enabled', null),
  ('morphhb', 'cantillation', 'text_morph', 'WLC', 'public_domain', 'enabled', null),
  ('morphhb', 'ketiv_qere', 'text_variants', 'WLC / Masorah', 'public_domain', 'enabled', null)
on conflict (dataset_key, field_name) do nothing;

-- 4. morphhb tokens table (one row per <w> in morphhb OSIS XML)
create table if not exists public.morphhb_tokens (
  id bigint generated always as identity primary key,
  morphhb_id text not null unique,
  book smallint not null references public.books(id),
  chapter smallint not null,
  verse_nr smallint not null,
  word_num smallint not null check (word_num >= 1),
  word_text text not null,
  lemma text not null,
  morph_code text not null,
  cantillation text,
  is_ketiv boolean not null default false,
  is_qere boolean not null default false,
  qere_target_id text,
  is_aramaic boolean not null default false,
  canonical_verse_id integer references public.verses(id),
  step_word_id integer references public.words(id),
  macula_ref text,
  link_status text not null default 'unlinked' check (link_status in (
    'exact_form',
    'consonantal_match',
    'qere_form',
    'ketiv_variant',
    'unmatched',
    'unlinked'
  )),
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint not null references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  origin_mode text not null default 'directly_imported' check (origin_mode in ('directly_imported', 'algorithmically_calculated')),
  derivation_method text not null default 'morphhb_osis_xml_word'
);

create index if not exists idx_morphhb_tokens_ref on public.morphhb_tokens (book, chapter, verse_nr, word_num);
create index if not exists idx_morphhb_tokens_verse on public.morphhb_tokens (canonical_verse_id) where canonical_verse_id is not null;
create index if not exists idx_morphhb_tokens_step_word on public.morphhb_tokens (step_word_id) where step_word_id is not null;
create index if not exists idx_morphhb_tokens_ketiv on public.morphhb_tokens (is_ketiv) where is_ketiv = true;
create index if not exists idx_morphhb_tokens_qere on public.morphhb_tokens (is_qere) where is_qere = true;
create index if not exists idx_morphhb_tokens_aramaic on public.morphhb_tokens (is_aramaic) where is_aramaic = true;
create index if not exists idx_morphhb_tokens_release on public.morphhb_tokens (source_release_id);
create index if not exists idx_morphhb_tokens_edition on public.morphhb_tokens (source_edition_id);

-- 5. Cross-dataset explicit token mappings
create table if not exists public.cross_token_mappings (
  id bigint generated always as identity primary key,
  canonical_verse_id integer not null references public.verses(id),
  step_word_id integer references public.words(id),
  morphhb_token_id bigint references public.morphhb_tokens(id),
  macula_morpheme_id bigint references public.macula_hebrew_morphemes(id),
  mapping_status text not null check (mapping_status in (
    'exact_match',
    'consonantal_match',
    'qere_reading',
    'ketiv_alternative',
    'morpheme_segment',
    'unresolved'
  )),
  notes text,
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint not null references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  origin_mode text not null default 'algorithmically_calculated' check (origin_mode in ('directly_imported', 'algorithmically_calculated')),
  derivation_method text not null,
  algorithm_version text not null,
  unique (canonical_verse_id, step_word_id, morphhb_token_id, macula_morpheme_id, mapping_status)
);

create index if not exists idx_ctm_verse on public.cross_token_mappings (canonical_verse_id);
create index if not exists idx_ctm_step_word on public.cross_token_mappings (step_word_id) where step_word_id is not null;
create index if not exists idx_ctm_morphhb on public.cross_token_mappings (morphhb_token_id) where morphhb_token_id is not null;
create index if not exists idx_ctm_macula on public.cross_token_mappings (macula_morpheme_id) where macula_morpheme_id is not null;
create index if not exists idx_ctm_status on public.cross_token_mappings (mapping_status);

-- 6. Read-only RLS
alter table public.morphhb_tokens enable row level security;
revoke all on public.morphhb_tokens from public, anon, authenticated;
grant select on public.morphhb_tokens to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'morphhb_tokens' and policyname = 'morphhb_tokens_public_read') then
    create policy morphhb_tokens_public_read on public.morphhb_tokens for select to anon, authenticated using (true);
  end if;
end $$;

alter table public.cross_token_mappings enable row level security;
revoke all on public.cross_token_mappings from public, anon, authenticated;
grant select on public.cross_token_mappings to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cross_token_mappings' and policyname = 'cross_token_mappings_public_read') then
    create policy cross_token_mappings_public_read on public.cross_token_mappings for select to anon, authenticated using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
