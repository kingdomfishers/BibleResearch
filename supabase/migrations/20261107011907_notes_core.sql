-- NOTE-04 Notes, revisions, anchors + index/perf spike
-- Core notes storage, revision history, and typed anchor associations.

-- 1. notes table
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  author_kind text not null check (author_kind in ('human', 'ai')),
  note_kind text not null references public.note_kinds(note_kind),
  title text null,
  body_md text not null default '',
  language text null,
  visibility text not null default 'public' check (visibility in ('private', 'unlisted', 'public')),
  status text not null default 'published' check (status in ('draft', 'published', 'archived', 'removed')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'confirmed', 'disputed')),
  reviewed_at timestamptz null,
  confidence numeric null check (confidence >= 0 and confidence <= 1),
  created_via text not null default 'ui' check (created_via in ('ui', 'mcp', 'import')),
  source_context jsonb not null default '{}'::jsonb,
  supersedes_note_id uuid null references public.notes(id) on delete set null,
  version integer not null default 1 check (version >= 1),
  client_request_id text null,
  content_hash text null,
  tsv tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body_md, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_notes_author foreign key (author_id, author_kind)
    references public.note_authors(id, author_kind) on delete cascade
);

create unique index if not exists uq_notes_client_request on public.notes (author_id, client_request_id)
  where client_request_id is not null;

create index if not exists idx_notes_author_id on public.notes(author_id);
create index if not exists idx_notes_author_kind on public.notes(author_kind);
create index if not exists idx_notes_created_at_id on public.notes(created_at desc, id desc);
create index if not exists idx_notes_supersedes on public.notes(supersedes_note_id)
  where supersedes_note_id is not null;
create index if not exists idx_notes_tsv on public.notes using gin (tsv);

-- 2. note_revisions table
create table if not exists public.note_revisions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  version integer not null check (version >= 1),
  action text not null check (action in ('create', 'update', 'delete', 'review')),
  editor_author_id uuid not null references public.note_authors(id),
  editor_kind text not null check (editor_kind in ('human', 'ai')),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_note_revisions_note_id on public.note_revisions(note_id);
create index if not exists idx_note_revisions_editor on public.note_revisions(editor_author_id);
create index if not exists idx_note_revisions_editor_kind_created on public.note_revisions(editor_kind, created_at);
create index if not exists idx_note_revisions_note_version on public.note_revisions(note_id, version desc);

-- 3. note_anchors table
create table if not exists public.note_anchors (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  anchor_kind text not null check (anchor_kind in ('verse', 'verse_range', 'word_occurrence', 'word_form', 'lemma', 'concept', 'place', 'event', 'note', 'external')),
  role text not null default 'mention' check (role in ('subject', 'object', 'mention', 'evidence')),
  label text null,
  ordinal integer not null default 0,
  block_id uuid null,
  element_ref text null,
  verse_id integer null references public.verses(id),
  end_verse_id integer null references public.verses(id),
  word_position integer null check (word_position is null or word_position >= 1),
  word_id integer null references public.words(id),
  lemma_id bigint null references public.lemmas(id),
  concept_id bigint null references public.concepts(id),
  place_id bigint null references public.places(id),
  event_id bigint null references public.chronology_events(id),
  target_note_id uuid null references public.notes(id) on delete cascade,
  external_uri text null,
  constraint uq_note_anchors_id_note unique (id, note_id),
  constraint chk_note_anchor_kind_columns check (
    case anchor_kind
      when 'verse' then
        verse_id is not null and
        num_nonnulls(end_verse_id, word_position, word_id, lemma_id, concept_id, place_id, event_id, target_note_id, external_uri) = 0
      when 'verse_range' then
        verse_id is not null and end_verse_id is not null and end_verse_id >= verse_id and
        num_nonnulls(word_position, word_id, lemma_id, concept_id, place_id, event_id, target_note_id, external_uri) = 0
      when 'word_occurrence' then
        verse_id is not null and word_position is not null and word_position >= 1 and word_id is not null and
        num_nonnulls(end_verse_id, lemma_id, concept_id, place_id, event_id, target_note_id, external_uri) = 0
      when 'word_form' then
        word_id is not null and
        num_nonnulls(verse_id, end_verse_id, word_position, lemma_id, concept_id, place_id, event_id, target_note_id, external_uri) = 0
      when 'lemma' then
        lemma_id is not null and
        num_nonnulls(verse_id, end_verse_id, word_position, word_id, concept_id, place_id, event_id, target_note_id, external_uri) = 0
      when 'concept' then
        concept_id is not null and
        num_nonnulls(verse_id, end_verse_id, word_position, word_id, lemma_id, place_id, event_id, target_note_id, external_uri) = 0
      when 'place' then
        place_id is not null and
        num_nonnulls(verse_id, end_verse_id, word_position, word_id, lemma_id, concept_id, event_id, target_note_id, external_uri) = 0
      when 'event' then
        event_id is not null and
        num_nonnulls(verse_id, end_verse_id, word_position, word_id, lemma_id, concept_id, place_id, target_note_id, external_uri) = 0
      when 'note' then
        target_note_id is not null and
        num_nonnulls(verse_id, end_verse_id, word_position, word_id, lemma_id, concept_id, place_id, event_id, external_uri) = 0
      when 'external' then
        external_uri is not null and external_uri ~* '^https://[^\s<>"'']+$' and label is not null and length(trim(label)) > 0 and
        num_nonnulls(verse_id, end_verse_id, word_position, word_id, lemma_id, concept_id, place_id, event_id, target_note_id) = 0
      else false
    end
  )
);

create unique index if not exists uq_note_anchors_dedup on public.note_anchors (
  note_id,
  anchor_kind,
  coalesce(verse_id, 0),
  coalesce(end_verse_id, 0),
  coalesce(word_position, 0),
  coalesce(word_id, 0),
  coalesce(lemma_id, 0),
  coalesce(concept_id, 0),
  coalesce(place_id, 0),
  coalesce(event_id, 0),
  coalesce(target_note_id::text, ''),
  coalesce(external_uri, ''),
  coalesce(block_id::text, ''),
  coalesce(element_ref, '')
);

create index if not exists idx_note_anchors_note_id on public.note_anchors(note_id);
create index if not exists idx_note_anchors_word_id on public.note_anchors(word_id)
  where anchor_kind in ('word_form', 'word_occurrence');
create index if not exists idx_note_anchors_lemma_id on public.note_anchors(lemma_id)
  where anchor_kind = 'lemma';
create index if not exists idx_note_anchors_verses on public.note_anchors(verse_id, end_verse_id)
  where anchor_kind in ('verse', 'verse_range', 'word_occurrence');
create index if not exists idx_note_anchors_target_note on public.note_anchors(target_note_id)
  where anchor_kind = 'note';

-- 4. Trigger: occurrence integrity
create or replace function public.validate_note_anchor_occurrence_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_expected_word_id integer;
begin
  if new.anchor_kind = 'word_occurrence' then
    select v.word_ids[new.word_position] into v_expected_word_id
    from public.verses v
    where v.id = new.verse_id;

    if v_expected_word_id is null or v_expected_word_id <> new.word_id then
      raise exception 'anchor_invalid: word_id % does not match verse % position % (expected %)',
        new.word_id, new.verse_id, new.word_position, v_expected_word_id
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_validate_note_anchor_occurrence
  before insert or update on public.note_anchors
  for each row
  execute function public.validate_note_anchor_occurrence_v1();

-- 5. Enable RLS on all three tables
alter table public.notes enable row level security;
alter table public.note_revisions enable row level security;
alter table public.note_anchors enable row level security;

-- 6. Public SELECT policies
create policy p_notes_select on public.notes
  for select to anon, authenticated
  using (status = 'published' and visibility = 'public');

create policy p_note_anchors_select on public.note_anchors
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.notes n
      where n.id = note_anchors.note_id
        and n.status = 'published'
        and n.visibility = 'public'
    )
  );

-- Note: note_revisions has RLS enabled with NO policy, keeping it private to service_role / security definer routines.

-- 7. Privileges
revoke all on table public.notes from anon, authenticated, public;
grant select on table public.notes to anon, authenticated;

revoke all on table public.note_anchors from anon, authenticated, public;
grant select on table public.note_anchors to anon, authenticated;

revoke all on table public.note_revisions from anon, authenticated, public;
