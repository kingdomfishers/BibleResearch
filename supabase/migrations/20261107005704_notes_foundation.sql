-- NOTE-03 Settings, authors, kinds, internal helpers
-- Foundation tables, RLS policies, column-level security, and internal security-definer helper routines.

-- 1. note_settings (single-row system settings)
create table if not exists public.note_settings (
  id boolean primary key default true check (id),
  single_user_mode boolean not null default true,
  human_writes_enabled boolean not null default true,
  ai_writes_enabled boolean not null default true,
  default_visibility text not null default 'public' check (default_visibility in ('public', 'unlisted', 'private')),
  max_title_chars integer not null default 200 check (max_title_chars > 0),
  max_body_chars integer not null default 20000 check (max_body_chars > 0),
  max_anchors integer not null default 50 check (max_anchors > 0),
  max_connections integer not null default 50 check (max_connections > 0),
  max_blocks integer not null default 20 check (max_blocks > 0),
  human_writes_per_hour integer not null default 600 check (human_writes_per_hour > 0),
  ai_writes_per_hour integer not null default 60 check (ai_writes_per_hour > 0),
  updated_at timestamptz not null default now()
);

insert into public.note_settings (id)
values (true)
on conflict (id) do nothing;

-- 2. note_authors (human & ai identity registry)
create table if not exists public.note_authors (
  id uuid primary key default gen_random_uuid(),
  author_kind text not null check (author_kind in ('human', 'ai')),
  display_name text not null check (length(trim(display_name)) > 0),
  ai_provider text null,
  ai_model text null,
  ai_client text null,
  user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_note_authors_id_kind unique (id, author_kind)
);

create unique index if not exists uq_note_authors_identity on public.note_authors (
  author_kind,
  display_name,
  coalesce(ai_provider, ''),
  coalesce(ai_model, ''),
  coalesce(ai_client, '')
);

create index if not exists idx_note_authors_user_id on public.note_authors(user_id) where user_id is not null;

-- Seed owner author: "You" (fixed UUID for single-user mode)
insert into public.note_authors (id, author_kind, display_name)
values ('00000000-0000-0000-0000-00000000a001'::uuid, 'human', 'You')
on conflict (id) do nothing;

-- 3. note_kinds (canonical note classification categories)
create table if not exists public.note_kinds (
  note_kind text primary key,
  label text not null,
  description text not null
);

insert into public.note_kinds (note_kind, label, description) values
  ('observation', 'Observation', 'Direct textual or contextual observation'),
  ('linguistic', 'Linguistic', 'Etymological, grammatical, or morphological insight'),
  ('interpretation', 'Interpretation', 'Theological, literary, or thematic interpretation'),
  ('question', 'Question', 'Open inquiry, ambiguity, or textual question'),
  ('cross_reference', 'Cross Reference', 'Thematic or verbal parallel across passages'),
  ('research_lead', 'Research Lead', 'Hypothesis, motif exploration, or study lead'),
  ('citation', 'Citation', 'Scholarly citation, historical commentary, or source quote')
on conflict (note_kind) do update set
  label = excluded.label,
  description = excluded.description;

-- 4. Enable RLS on all three tables
alter table public.note_settings enable row level security;
alter table public.note_authors enable row level security;
alter table public.note_kinds enable row level security;

-- 5. Public read-only policies
create policy p_note_settings_select on public.note_settings
  for select to anon, authenticated using (true);

create policy p_note_authors_select on public.note_authors
  for select to anon, authenticated using (true);

create policy p_note_kinds_select on public.note_kinds
  for select to anon, authenticated using (true);

-- 6. Revoke all privileges from anon, authenticated, and public
revoke all on table public.note_settings from anon, authenticated, public;
revoke all on table public.note_authors from anon, authenticated, public;
revoke all on table public.note_kinds from anon, authenticated, public;

-- 7. Grant SELECT privileges
grant select on table public.note_settings to anon, authenticated;
grant select on table public.note_kinds to anon, authenticated;

-- For note_authors: grant column-level select on every column except user_id
grant select (id, author_kind, display_name, ai_provider, ai_model, ai_client, created_at)
  on table public.note_authors to anon, authenticated;

-- 8. Internal Helpers (security definer, empty search_path, revoked from anon/auth/public)
create or replace function public.note_settings_v1()
returns public.note_settings
language sql
stable
security definer
set search_path = ''
set statement_timeout = '8s'
as $$
  select s from public.note_settings s where s.id = true;
$$;

create or replace function public.note_assert_writes_enabled_v1(p_kind text)
returns void
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  s public.note_settings;
begin
  select * into s from public.note_settings where id = true;
  if s is null then
    raise exception 'writes_disabled' using errcode = 'P0001';
  end if;
  if p_kind = 'human' then
    if not s.human_writes_enabled then
      raise exception 'writes_disabled' using errcode = 'P0001';
    end if;
  elsif p_kind = 'ai' then
    if not s.ai_writes_enabled then
      raise exception 'writes_disabled' using errcode = 'P0001';
    end if;
  else
    raise exception 'writes_disabled' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.note_resolve_human_author_v1()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  s public.note_settings;
begin
  select * into s from public.note_settings where id = true;
  if s is not null and s.single_user_mode then
    return '00000000-0000-0000-0000-00000000a001'::uuid;
  end if;
  raise exception 'auth_required' using errcode = 'P0001';
end;
$$;

create or replace function public.note_resolve_agent_author_v1(p_agent jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_provider text;
  v_model text;
  v_client text;
  v_display_name text;
  v_id uuid;
begin
  v_provider := trim(coalesce(p_agent->>'provider', ''));
  v_model := trim(coalesce(p_agent->>'model', ''));
  v_client := trim(coalesce(p_agent->>'client', ''));
  v_display_name := trim(coalesce(p_agent->>'display_name', ''));

  if v_provider = '' or v_model = '' then
    raise exception 'validation_failed: provider and model are required' using errcode = 'P0001';
  end if;

  if length(v_provider) > 80 or length(v_model) > 80 or length(v_client) > 80 then
    raise exception 'validation_failed: provider, model, and client must be <= 80 characters' using errcode = 'P0001';
  end if;

  if v_display_name = '' then
    v_display_name := v_provider || ' · ' || v_model;
  end if;

  if length(v_display_name) > 120 then
    v_display_name := substr(v_display_name, 1, 120);
  end if;

  insert into public.note_authors (
    author_kind,
    display_name,
    ai_provider,
    ai_model,
    ai_client
  ) values (
    'ai',
    v_display_name,
    v_provider,
    v_model,
    nullif(v_client, '')
  )
  on conflict (
    author_kind,
    display_name,
    coalesce(ai_provider, ''),
    coalesce(ai_model, ''),
    coalesce(ai_client, '')
  ) do update set
    display_name = excluded.display_name
  returning id into v_id;

  return v_id;
end;
$$;

-- Revoke all execute on new functions from public, anon, authenticated
revoke all on function public.note_settings_v1() from public, anon, authenticated;
revoke all on function public.note_assert_writes_enabled_v1(text) from public, anon, authenticated;
revoke all on function public.note_resolve_human_author_v1() from public, anon, authenticated;
revoke all on function public.note_resolve_agent_author_v1(jsonb) from public, anon, authenticated;
