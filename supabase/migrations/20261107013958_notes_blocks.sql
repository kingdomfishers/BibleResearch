-- NOTE-06 Block registry and blocks
-- Extensible block registry and validated polymorphic rich blocks.

-- 1. note_block_types registry
create table if not exists public.note_block_types (
  block_type text primary key,
  label text not null,
  renderer_status text not null check (renderer_status in ('available', 'planned')),
  is_enabled boolean not null default false,
  required_keys text[] not null default '{}'::text[],
  url_keys text[] not null default '{}'::text[],
  max_bytes integer not null default 65536 check (max_bytes > 0),
  description text null,
  created_at timestamptz not null default now()
);

-- 2. Seeds: 3 available & enabled, 6 planned & disabled
insert into public.note_block_types (block_type, label, renderer_status, is_enabled, required_keys, url_keys, max_bytes, description)
values
  ('markdown', 'Markdown', 'available', true, array['markdown'], array[]::text[], 65536, 'Safe CommonMark-compatible rich text formatted with in-house safe parser.'),
  ('link', 'External Link', 'available', true, array['url', 'title'], array['url'], 8192, 'Verified HTTPS link with title and optional description.'),
  ('image', 'Image Reference', 'available', true, array['url', 'alt'], array['url'], 8192, 'External HTTPS image reference with required non-empty alt text.'),
  ('map', 'Interactive Map', 'planned', false, array[]::text[], array[]::text[], 65536, 'Interactive geographic/topographical map visualization (planned).'),
  ('timeline', 'Chronological Timeline', 'planned', false, array[]::text[], array[]::text[], 65536, 'Historical era and event timeline visualization (planned).'),
  ('model_3d', '3D Artifact Model', 'planned', false, array[]::text[], array[]::text[], 65536, '3D archaeological artifact or architectural model (planned).'),
  ('archaeological_find', 'Archaeological Find', 'planned', false, array[]::text[], array[]::text[], 65536, 'Cataloged excavation record, inscription, or artifact dossier (planned).'),
  ('table', 'Data Table', 'planned', false, array[]::text[], array[]::text[], 65536, 'Structured tabular data comparison (planned).'),
  ('chart', 'Data Chart', 'planned', false, array[]::text[], array[]::text[], 65536, 'Statistical or frequency distribution chart (planned).')
on conflict (block_type) do update set
  label = excluded.label,
  renderer_status = excluded.renderer_status,
  is_enabled = excluded.is_enabled,
  required_keys = excluded.required_keys,
  url_keys = excluded.url_keys,
  max_bytes = excluded.max_bytes,
  description = excluded.description;

-- 3. Validation function: note_validate_block_v1
create or replace function public.note_validate_block_v1(
  p_block_type text,
  p_content jsonb,
  p_text_alt text
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_req_keys text[];
  v_url_keys text[];
  v_max_bytes integer;
  v_k text;
  v_val text;
begin
  -- 1. Validate text_alternative
  if p_text_alt is null or length(btrim(p_text_alt)) = 0 then
    return 'validation_failed:text_alternative';
  end if;

  -- 2. Validate block_type registration and enablement
  select
    is_enabled,
    required_keys,
    url_keys,
    max_bytes
  into
    v_enabled,
    v_req_keys,
    v_url_keys,
    v_max_bytes
  from public.note_block_types
  where block_type = p_block_type;

  if not found or not coalesce(v_enabled, false) then
    return 'block_type_not_enabled';
  end if;

  -- 3. Content must be a JSON object
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    return 'validation_failed:not_an_object';
  end if;

  -- 4. Check max size
  if octet_length(p_content::text) > v_max_bytes then
    return 'validation_failed:too_large';
  end if;

  -- 5. Check required keys
  if v_req_keys is not null then
    foreach v_k in array v_req_keys loop
      if not (p_content ? v_k) or (p_content->v_k) is null or length(btrim(coalesce(p_content->>v_k, ''))) = 0 then
        return 'validation_failed:missing_key:' || v_k;
      end if;
    end loop;
  end if;

  -- 6. Check URL keys (must match ^https://[^\s<>"']+$ and length <= 2048)
  if v_url_keys is not null then
    foreach v_k in array v_url_keys loop
      if (p_content ? v_k) and (p_content->v_k) is not null then
        v_val := p_content->>v_k;
        if length(v_val) = 0 or length(v_val) > 2048 or v_val !~* '^https://[^\s<>"'']+$' then
          return 'validation_failed:not_https:' || v_k;
        end if;
      end if;
    end loop;
  end if;

  return null;
end;
$$;

-- 4. note_blocks table
create table if not exists public.note_blocks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  ordinal integer not null default 0 check (ordinal >= 0),
  block_type text not null references public.note_block_types(block_type),
  content jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1 check (schema_version >= 1),
  text_alternative text not null check (length(btrim(text_alternative)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_note_blocks_note_id on public.note_blocks(note_id, ordinal);
create index if not exists idx_note_blocks_block_type on public.note_blocks(block_type);

-- 5. Trigger calling validator
create or replace function public.validate_note_block_trigger_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_err text;
begin
  v_err := public.note_validate_block_v1(new.block_type, new.content, new.text_alternative);
  if v_err is not null then
    raise exception 'block_invalid: %', v_err;
  end if;
  return new;
end;
$$;

create or replace trigger trg_note_blocks_validate
  before insert or update on public.note_blocks
  for each row
  execute function public.validate_note_block_trigger_v1();

-- 6. RLS
alter table public.note_block_types enable row level security;
alter table public.note_blocks enable row level security;

create policy "Allow public select on note_block_types"
  on public.note_block_types
  for select
  to public
  using (true);

create policy "Allow public select on visible note_blocks"
  on public.note_blocks
  for select
  to public
  using (
    exists (
      select 1 from public.notes n
      where n.id = note_blocks.note_id
        and n.status = 'published'
        and n.visibility = 'public'
    )
  );

-- 7. Permissions
revoke all on public.note_block_types from public, anon, authenticated;
grant select on public.note_block_types to anon, authenticated;

revoke all on public.note_blocks from public, anon, authenticated;
grant select on public.note_blocks to anon, authenticated;

grant execute on function public.note_validate_block_v1(text, jsonb, text) to anon, authenticated, public;
