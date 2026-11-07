-- NOTE-05 Connection vocabulary and connections
-- Typed directional connections between anchors of the same note.

-- 1. note_connection_types table
create table if not exists public.note_connection_types (
  connection_type text primary key,
  type_key text generated always as (connection_type) stored,
  label text not null,
  inverse_label text not null,
  category text not null check (category in ('linguistic', 'textual', 'thematic', 'typological', 'historical', 'geographic', 'numerical', 'other')),
  default_direction text not null check (default_direction in ('directed', 'bidirectional', 'undirected')),
  is_symmetric boolean not null default false,
  description text null,
  is_system boolean not null default true,
  constraint chk_note_conn_type_symmetric check (
    not is_symmetric or default_direction in ('bidirectional', 'undirected')
  )
);

-- 2. Seed 16 canonical connection types
insert into public.note_connection_types (connection_type, label, inverse_label, category, default_direction, is_symmetric, description)
values
  ('contained_in', 'is contained in', 'contains', 'linguistic', 'directed', false, 'One word or element is morphologically or phonetically contained in another.'),
  ('same_root', 'shares a root with', 'shares a root with', 'linguistic', 'bidirectional', true, 'Shares a common consonantal or etymological root without asserting direct synonymy.'),
  ('wordplay', 'plays on', 'is played on by', 'linguistic', 'directed', false, 'Paronomasia, pun, or intentional phonological play between terms.'),
  ('same_letters', 'has the same letters as', 'has the same letters as', 'linguistic', 'bidirectional', true, 'Anagrammatic or identical consonantal orthography.'),
  ('sounds_like', 'sounds like', 'sounds like', 'linguistic', 'bidirectional', true, 'Phonological resemblance or alliteration.'),
  ('quotes', 'quotes', 'is quoted by', 'textual', 'directed', false, 'Direct or near-verbatim textual citation across passages.'),
  ('alludes_to', 'alludes to', 'is alluded to by', 'textual', 'directed', false, 'Literary allusion or motif echo without full formal quotation.'),
  ('parallels', 'parallels', 'parallels', 'textual', 'bidirectional', true, 'Structural, thematic, or poetic parallelism.'),
  ('contrasts_with', 'contrasts with', 'contrasts with', 'thematic', 'bidirectional', true, 'Antithesis, thematic inversion, or intentional literary contrast.'),
  ('explains', 'explains', 'is explained by', 'thematic', 'directed', false, 'One passage, term, or entity glosses, interprets, or explains another.'),
  ('related', 'is related to', 'is related to', 'thematic', 'bidirectional', true, 'General conceptual, thematic, or semantic association.'),
  ('typifies', 'foreshadows', 'is fulfilled in', 'typological', 'directed', false, 'Typological pattern, prophetic figure, or antitype fulfillment.'),
  ('contemporary_with', 'is contemporary with', 'is contemporary with', 'historical', 'bidirectional', true, 'Historical synchronism or overlapping biblical era/event.'),
  ('located_at', 'is located at', 'is the location of', 'geographic', 'directed', false, 'Geographical association between an event/entity and a site.'),
  ('same_gematria', 'has the same gematria as', 'has the same gematria as', 'numerical', 'bidirectional', true, 'Numerical equivalence in biblical alphanumeric calculation.'),
  ('other', 'is connected to', 'is connected to', 'other', 'undirected', true, 'Custom, miscellaneous, or unclassified connection.')
on conflict (connection_type) do update set
  label = excluded.label,
  inverse_label = excluded.inverse_label,
  category = excluded.category,
  default_direction = excluded.default_direction,
  is_symmetric = excluded.is_symmetric,
  description = excluded.description;

-- 3. Ensure composite unique on note_anchors(id, note_id)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_note_anchors_id_note' and conrelid = 'public.note_anchors'::regclass
  ) then
    alter table public.note_anchors add constraint uq_note_anchors_id_note unique (id, note_id);
  end if;
end $$;

-- 4. note_connections table
create table if not exists public.note_connections (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  from_anchor_id uuid not null,
  to_anchor_id uuid not null,
  connection_type text null references public.note_connection_types(connection_type) on delete set null,
  custom_label text null,
  direction text not null default 'undirected' check (direction in ('directed', 'bidirectional', 'undirected')),
  explanation text null,
  created_at timestamptz not null default now(),
  constraint fk_conn_from foreign key (from_anchor_id, note_id)
    references public.note_anchors(id, note_id) on delete cascade,
  constraint fk_conn_to foreign key (to_anchor_id, note_id)
    references public.note_anchors(id, note_id) on delete cascade,
  constraint chk_conn_distinct_anchors check (from_anchor_id <> to_anchor_id)
);

create index if not exists idx_note_connections_note_id on public.note_connections(note_id);
create index if not exists idx_note_connections_from on public.note_connections(from_anchor_id, note_id);
create index if not exists idx_note_connections_to on public.note_connections(to_anchor_id, note_id);
create index if not exists idx_note_connections_type on public.note_connections(connection_type)
  where connection_type is not null;

-- 5. RLS
alter table public.note_connection_types enable row level security;
alter table public.note_connections enable row level security;

create policy "Allow public select on note_connection_types"
  on public.note_connection_types
  for select
  to public
  using (true);

create policy "Allow public select on visible note_connections"
  on public.note_connections
  for select
  to public
  using (
    exists (
      select 1 from public.notes n
      where n.id = note_connections.note_id
        and n.status = 'published'
        and n.visibility = 'public'
    )
  );

-- 6. Permissions
revoke all on public.note_connection_types from public, anon, authenticated;
grant select on public.note_connection_types to anon, authenticated;

revoke all on public.note_connections from public, anon, authenticated;
grant select on public.note_connections to anon, authenticated;
