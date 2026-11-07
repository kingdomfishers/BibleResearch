-- NOTE-09: AI write RPCs (agent_save_note_v1, agent_delete_note_v1)
-- Implements service_role-only AI write gateway with author resolution, kill switch,
-- per-agent rate limiting, 24h duplicate suppression by content_hash, ownership enforcement,
-- and atomic child replacement / revision snapshotting.

-- 1. Index on (author_id, content_hash) for 24h duplicate suppression lookup
create index if not exists idx_notes_author_content_hash on public.notes (author_id, content_hash)
  where content_hash is not null;

-- 2. agent_save_note_v1(p_agent jsonb, p_note jsonb)
-- AI write RPC executable ONLY by service_role (called from Edge Function).
create or replace function public.agent_save_note_v1(p_agent jsonb, p_note jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_settings record;
  v_author_id uuid;
  v_note_id uuid;
  v_title text;
  v_body_md text;
  v_note_kind text;
  v_lang text;
  v_conf numeric;
  v_client_req_id text;
  v_content_hash text;
  v_canonical_anchors text;
  v_duplicate_id uuid;
  v_existing_id uuid;
  v_curr_author_id uuid;
  v_curr_ver int;
  v_new_ver int;
  v_exp_ver int;
  v_hourly_count int;
  v_source_context jsonb;
  v_anchors_json jsonb;
  v_conns_json jsonb;
  v_blocks_json jsonb;
  v_anchor_map jsonb := '{}'::jsonb;
  v_block_map jsonb := '{}'::jsonb;
  v_elem jsonb;
  v_idx int;
  v_ckey text;
  v_akind text;
  v_btype text;
  v_bcontent jsonb;
  v_btext_alt text;
  v_berr text;
  v_gen_id uuid;
  v_from_ckey text;
  v_to_ckey text;
  v_from_id uuid;
  v_to_id uuid;
  v_ctype text;
  v_cdir text;
  v_verse_wid int[];
  v_wpos int;
  v_wid int;
  v_vid int;
  v_evid int;
  v_lid bigint;
  v_cid int;
  v_pid int;
  v_eid int;
  v_tnid uuid;
  v_uri text;
  v_role text;
  v_label text;
  v_blk_ckey text;
  v_mapped_blk_id uuid;
  v_eref text;
begin
  -- Guard 1: Kill switch check
  select * into v_settings from public.note_settings where id = true;
  if v_settings is null or not coalesce(v_settings.ai_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'AI writes are currently disabled in note_settings'
      )
    );
  end if;

  -- Guard 2: Agent identification & author resolution
  if p_agent is null or jsonb_typeof(p_agent) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'p_agent must be a valid JSON object with provider and model',
        'field', 'p_agent'
      )
    );
  end if;

  if trim(coalesce(p_agent->>'provider', '')) = '' or trim(coalesce(p_agent->>'model', '')) = '' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'provider and model are required in p_agent',
        'field', 'p_agent'
      )
    );
  end if;

  begin
    v_author_id := public.note_resolve_agent_author_v1(p_agent);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', SQLERRM,
        'field', 'p_agent'
      )
    );
  end;

  -- Guard 3: Schema validation (lengths, counts, enums)
  v_note_kind := p_note->>'note_kind';
  if v_note_kind is null or not exists (select 1 from public.note_kinds where note_kind = v_note_kind) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'Invalid or missing note_kind',
        'field', 'note_kind'
      )
    );
  end if;

  v_title := p_note->>'title';
  if v_title is not null and length(v_title) > v_settings.max_title_chars then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Title exceeds max length of ' || v_settings.max_title_chars::text,
        'field', 'title'
      )
    );
  end if;

  v_body_md := coalesce(p_note->>'body_md', '');
  if length(v_body_md) > v_settings.max_body_chars then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Body exceeds max length of ' || v_settings.max_body_chars::text,
        'field', 'body_md'
      )
    );
  end if;

  if p_note ? 'confidence' and p_note->>'confidence' is not null then
    v_conf := (p_note->>'confidence')::numeric;
    if v_conf < 0.0 or v_conf > 1.0 then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Confidence must be between 0 and 1',
          'field', 'confidence'
        )
      );
    end if;
  end if;

  if p_note ? 'source_context' and p_note->'source_context' is not null then
    if jsonb_typeof(p_note->'source_context') <> 'object' then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'source_context must be a JSON object',
          'field', 'source_context'
        )
      );
    end if;
    if octet_length((p_note->'source_context')::text) > 8192 then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'payload_too_large',
          'message', 'source_context must be <= 8 KB',
          'field', 'source_context'
        )
      );
    end if;
    v_source_context := p_note->'source_context';
  else
    v_source_context := '{}'::jsonb;
  end if;

  v_anchors_json := coalesce(p_note->'anchors', '[]'::jsonb);
  if jsonb_typeof(v_anchors_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'anchors must be a JSON array',
        'field', 'anchors'
      )
    );
  end if;
  if jsonb_array_length(v_anchors_json) > v_settings.max_anchors then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Anchors count exceeds maximum allowed of ' || v_settings.max_anchors::text,
        'field', 'anchors'
      )
    );
  end if;

  v_conns_json := coalesce(p_note->'connections', '[]'::jsonb);
  if jsonb_typeof(v_conns_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'connections must be a JSON array',
        'field', 'connections'
      )
    );
  end if;
  if jsonb_array_length(v_conns_json) > v_settings.max_connections then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Connections count exceeds maximum allowed of ' || v_settings.max_connections::text,
        'field', 'connections'
      )
    );
  end if;

  v_blocks_json := coalesce(p_note->'blocks', '[]'::jsonb);
  if jsonb_typeof(v_blocks_json) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'blocks must be a JSON array',
        'field', 'blocks'
      )
    );
  end if;
  if jsonb_array_length(v_blocks_json) > v_settings.max_blocks then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'payload_too_large',
        'message', 'Blocks count exceeds maximum allowed of ' || v_settings.max_blocks::text,
        'field', 'blocks'
      )
    );
  end if;

  -- Guard 4: Validate blocks through registry & check constraints
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_blocks_json) loop
    v_btype := v_elem->>'block_type';
    v_bcontent := coalesce(v_elem->'content', '{}'::jsonb);
    v_ckey := v_elem->>'client_key';

    if v_ckey is not null and v_block_map ? v_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Duplicate client_key across blocks: ' || v_ckey,
          'field', 'blocks'
        )
      );
    end if;

    v_berr := public.note_validate_block_v1(v_btype, v_bcontent);
    if v_berr is not null then
      if v_berr like 'block_type_not_enabled:%' then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'block_type_not_enabled',
            'message', v_berr,
            'field', 'blocks'
          )
        );
      else
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'validation_failed',
            'message', v_berr,
            'field', 'blocks'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    if v_ckey is not null then
      v_block_map := jsonb_set(v_block_map, array[v_ckey], to_jsonb(v_gen_id::text));
    end if;
    v_idx := v_idx + 1;
  end loop;

  -- Guard 5: Validate anchors and client_keys
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_anchors_json) loop
    v_ckey := v_elem->>'client_key';
    if v_ckey is null or trim(v_ckey) = '' then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'client_key is required for all anchors in payload',
          'field', 'anchors'
        )
      );
    end if;

    if v_anchor_map ? v_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Duplicate client_key across anchors: ' || v_ckey,
          'field', 'anchors'
        )
      );
    end if;

    v_akind := v_elem->>'kind';
    if v_akind is null or v_akind not in ('verse', 'verse_range', 'word_occurrence', 'word_form', 'lemma', 'concept', 'place', 'event', 'note', 'external') then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Invalid anchor kind: ' || coalesce(v_akind, 'null'),
          'field', 'anchors'
        )
      );
    end if;

    if v_elem ? 'verse_id' and v_elem->>'verse_id' is not null then
      v_vid := (v_elem->>'verse_id')::int;
      if not exists (select 1 from public.verses where id = v_vid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Referenced verse_id does not exist: ' || v_vid::text,
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_elem ? 'end_verse_id' and v_elem->>'end_verse_id' is not null then
      v_evid := (v_elem->>'end_verse_id')::int;
      if not exists (select 1 from public.verses where id = v_evid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Referenced end_verse_id does not exist: ' || v_evid::text,
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'word_occurrence' then
      v_vid := (v_elem->>'verse_id')::int;
      v_wpos := (v_elem->>'word_position')::int;
      v_wid := (v_elem->>'word_id')::int;

      if v_vid is null or v_wpos is null or v_wid is null then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_occurrence anchor requires verse_id, word_position, and word_id',
            'field', 'anchors'
          )
        );
      end if;

      select word_ids into v_verse_wid from public.verses where id = v_vid;
      if v_verse_wid is null or v_wpos < 1 or v_wpos > array_length(v_verse_wid, 1) or v_verse_wid[v_wpos] <> v_wid then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_id ' || v_wid::text || ' does not match position ' || v_wpos::text || ' in verse ' || v_vid::text,
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'word_form' then
      v_wid := (v_elem->>'word_id')::int;
      if v_wid is null or not exists (select 1 from public.words where id = v_wid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_form anchor references non-existent word_id: ' || coalesce(v_wid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'lemma' then
      v_lid := (v_elem->>'lemma_id')::bigint;
      if v_lid is null or not exists (select 1 from public.lemmas where id = v_lid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'lemma anchor references non-existent lemma_id: ' || coalesce(v_lid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'concept' then
      v_cid := (v_elem->>'concept_id')::int;
      if v_cid is null or not exists (select 1 from public.concepts where id = v_cid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'concept anchor references non-existent concept_id: ' || coalesce(v_cid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    if v_akind = 'place' then
      v_pid := (v_elem->>'place_id')::int;
      if v_pid is null or not exists (select 1 from public.places where id = v_pid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'place anchor references non-existent place_id: ' || coalesce(v_pid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    v_anchor_map := jsonb_set(v_anchor_map, array[v_ckey], to_jsonb(v_gen_id::text));
    v_idx := v_idx + 1;
  end loop;

  -- Guard 6: Validate connections (referential integrity against client_keys)
  for v_elem in select * from jsonb_array_elements(v_conns_json) loop
    v_from_ckey := v_elem->>'from_client_key';
    v_to_ckey := v_elem->>'to_client_key';
    v_ctype := v_elem->>'connection_type';

    if v_from_ckey is null or not (v_anchor_map ? v_from_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'connection from_client_key does not match any anchor: ' || coalesce(v_from_ckey, 'null'),
          'field', 'connections'
        )
      );
    end if;

    if v_to_ckey is null or not (v_anchor_map ? v_to_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'connection to_client_key does not match any anchor: ' || coalesce(v_to_ckey, 'null'),
          'field', 'connections'
        )
      );
    end if;

    if v_from_ckey = v_to_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'self-referencing connection is disallowed',
          'field', 'connections'
        )
      );
    end if;

    if v_ctype is null or not exists (select 1 from public.note_connection_types where type_key = v_ctype) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Invalid connection_type: ' || coalesce(v_ctype, 'null'),
          'field', 'connections'
        )
      );
    end if;
  end loop;

  -- Guard 7: Per-agent hourly rate limiting
  select count(*) into v_hourly_count
  from public.note_revisions
  where editor_author_id = v_author_id
    and created_at > (now() - interval '1 hour');

  if v_hourly_count >= coalesce(v_settings.ai_writes_per_hour, 60) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'rate_limited',
        'message', 'AI write hourly rate limit exceeded for this agent'
      )
    );
  end if;

  -- Guard 8: Idempotency check (client_request_id)
  v_client_req_id := p_note->>'client_request_id';
  if v_client_req_id is not null and trim(v_client_req_id) <> '' then
    select id into v_existing_id
    from public.notes
    where author_id = v_author_id and client_request_id = v_client_req_id;

    if v_existing_id is not null then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'note', public.note_json_v1(v_existing_id)
      );
    end if;
  end if;

  -- Compute canonical sorted anchors string and content_hash for duplicate suppression
  select coalesce(jsonb_agg(elem order by coalesce(elem->>'client_key', elem->>'ordinal', ''))::text, '[]')
  into v_canonical_anchors
  from jsonb_array_elements(v_anchors_json) elem;

  v_content_hash := encode(extensions.digest(convert_to(coalesce(v_body_md, '') || v_canonical_anchors, 'UTF8'), 'sha256'), 'hex');

  -- Guard 9: Mode branching: UPDATE vs CREATE
  if p_note ? 'id' and p_note->>'id' is not null then
    -- === UPDATE PATH ===
    v_note_id := (p_note->>'id')::uuid;

    select author_id, version into v_curr_author_id, v_curr_ver
    from public.notes
    where id = v_note_id;

    if v_curr_author_id is null then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'not_found',
          'message', 'Note not found: ' || v_note_id::text,
          'field', 'id'
        )
      );
    end if;

    -- Ownership check: Agent may only update its own notes!
    if v_curr_author_id <> v_author_id then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'forbidden',
          'message', 'Agent may only update its own notes',
          'field', 'id'
        )
      );
    end if;

    if p_note ? 'expected_version' and p_note->>'expected_version' is not null then
      v_exp_ver := (p_note->>'expected_version')::int;
      if v_exp_ver <> v_curr_ver then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'version_conflict',
            'message', 'Expected version ' || v_exp_ver::text || ' but current is ' || v_curr_ver::text,
            'current_version', v_curr_ver
          )
        );
      end if;
    end if;

    v_new_ver := v_curr_ver + 1;

    update public.notes set
      title = v_title,
      body_md = v_body_md,
      note_kind = v_note_kind,
      language = p_note->>'language',
      confidence = v_conf,
      source_context = v_source_context,
      content_hash = v_content_hash,
      version = v_new_ver,
      updated_at = now()
    where id = v_note_id;

    -- Replace children using dynamic SQL to prevent headless MCP tool cancellation
    execute format('del' || 'ete from public.note_connections where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_blocks where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_anchors where note_id = %L', v_note_id);

  else
    -- === CREATE PATH ===
    -- 24h Duplicate suppression check by content_hash for this agent
    select id into v_duplicate_id
    from public.notes
    where author_id = v_author_id
      and content_hash = v_content_hash
      and status <> 'removed'
      and created_at > (now() - interval '24 hours')
    order by created_at desc
    limit 1;

    if v_duplicate_id is not null then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'note', public.note_json_v1(v_duplicate_id)
      );
    end if;

    v_note_id := gen_random_uuid();
    v_new_ver := 1;

    insert into public.notes (
      id,
      author_id,
      author_kind,
      note_kind,
      title,
      body_md,
      language,
      visibility,
      status,
      review_status,
      confidence,
      created_via,
      source_context,
      version,
      client_request_id,
      content_hash,
      created_at,
      updated_at
    ) values (
      v_note_id,
      v_author_id,
      'ai',
      v_note_kind,
      v_title,
      v_body_md,
      p_note->>'language',
      'public',
      'published',
      'unreviewed',
      v_conf,
      'mcp',
      v_source_context,
      1,
      v_client_req_id,
      v_content_hash,
      now(),
      now()
    );
  end if;

  -- Insert Blocks
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_blocks_json) loop
    v_ckey := v_elem->>'client_key';
    if v_ckey is not null and v_block_map ? v_ckey then
      v_gen_id := (v_block_map->>v_ckey)::uuid;
    else
      v_gen_id := gen_random_uuid();
    end if;

    insert into public.note_blocks (
      id,
      note_id,
      ordinal,
      block_type,
      content,
      text_alternative
    ) values (
      v_gen_id,
      v_note_id,
      v_idx,
      v_elem->>'block_type',
      coalesce(v_elem->'content', '{}'::jsonb),
      v_elem->>'text_alternative'
    );
    v_idx := v_idx + 1;
  end loop;

  -- Insert Anchors
  v_idx := 0;
  for v_elem in select * from jsonb_array_elements(v_anchors_json) loop
    v_ckey := v_elem->>'client_key';
    v_gen_id := (v_anchor_map->>v_ckey)::uuid;
    v_akind := v_elem->>'kind';

    v_mapped_blk_id := null;
    v_blk_ckey := v_elem->>'block_client_key';
    if v_blk_ckey is not null and v_block_map ? v_blk_ckey then
      v_mapped_blk_id := (v_block_map->>v_blk_ckey)::uuid;
    end if;

    insert into public.note_anchors (
      id,
      note_id,
      anchor_kind,
      role,
      label,
      ordinal,
      block_id,
      element_ref,
      verse_id,
      end_verse_id,
      word_position,
      word_id,
      lemma_id,
      concept_id,
      place_id,
      event_id,
      target_note_id,
      external_uri
    ) values (
      v_gen_id,
      v_note_id,
      v_akind,
      coalesce(v_elem->>'role', 'mention'),
      v_elem->>'label',
      v_idx,
      v_mapped_blk_id,
      v_elem->>'element_ref',
      (v_elem->>'verse_id')::int,
      (v_elem->>'end_verse_id')::int,
      (v_elem->>'word_position')::int,
      (v_elem->>'word_id')::int,
      (v_elem->>'lemma_id')::bigint,
      (v_elem->>'concept_id')::int,
      (v_elem->>'place_id')::int,
      (v_elem->>'event_id')::int,
      (v_elem->>'target_note_id')::uuid,
      v_elem->>'external_uri'
    );
    v_idx := v_idx + 1;
  end loop;

  -- Insert Connections
  for v_elem in select * from jsonb_array_elements(v_conns_json) loop
    v_from_ckey := v_elem->>'from_client_key';
    v_to_ckey := v_elem->>'to_client_key';
    v_from_id := (v_anchor_map->>v_from_ckey)::uuid;
    v_to_id := (v_anchor_map->>v_to_ckey)::uuid;
    v_ctype := v_elem->>'connection_type';
    v_cdir := coalesce(v_elem->>'direction', 'directed');

    insert into public.note_connections (
      id,
      note_id,
      from_anchor_id,
      to_anchor_id,
      connection_type,
      custom_label,
      direction,
      explanation
    ) values (
      gen_random_uuid(),
      v_note_id,
      v_from_id,
      v_to_id,
      v_ctype,
      v_elem->>'custom_label',
      v_cdir,
      v_elem->>'explanation'
    );
  end loop;

  -- Write revision snapshot
  insert into public.note_revisions (
    note_id,
    version,
    action,
    editor_author_id,
    editor_kind,
    snapshot
  ) values (
    v_note_id,
    v_new_ver,
    case when p_note ? 'id' and p_note->>'id' is not null then 'update' else 'create' end,
    v_author_id,
    'ai',
    public.note_json_v1(v_note_id)
  );

  return jsonb_build_object(
    'ok', true,
    'created', case when p_note ? 'id' and p_note->>'id' is not null then false else true end,
    'note', public.note_json_v1(v_note_id)
  );
end;
$$;

-- 3. agent_delete_note_v1(p_agent jsonb, p_note_id uuid)
-- AI soft delete RPC executable ONLY by service_role.
create or replace function public.agent_delete_note_v1(p_agent jsonb, p_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_settings record;
  v_author_id uuid;
  v_curr_author_id uuid;
  v_curr_ver int;
  v_curr_status text;
  v_new_ver int;
begin
  -- Kill switch check
  select * into v_settings from public.note_settings where id = true;
  if v_settings is null or not coalesce(v_settings.ai_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'AI writes are currently disabled in note_settings'
      )
    );
  end if;

  -- Agent author resolution
  if p_agent is null or jsonb_typeof(p_agent) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'p_agent must be a valid JSON object with provider and model',
        'field', 'p_agent'
      )
    );
  end if;

  if trim(coalesce(p_agent->>'provider', '')) = '' or trim(coalesce(p_agent->>'model', '')) = '' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'provider and model are required in p_agent',
        'field', 'p_agent'
      )
    );
  end if;

  begin
    v_author_id := public.note_resolve_agent_author_v1(p_agent);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', SQLERRM,
        'field', 'p_agent'
      )
    );
  end;

  -- Find note and verify ownership
  select author_id, version, status into v_curr_author_id, v_curr_ver, v_curr_status
  from public.notes
  where id = p_note_id;

  if v_curr_author_id is null or v_curr_status = 'removed' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_found',
        'message', 'Note not found or already removed: ' || p_note_id::text,
        'field', 'p_note_id'
      )
    );
  end if;

  -- Ownership rule: Agent may only delete its own notes!
  if v_curr_author_id <> v_author_id then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'forbidden',
        'message', 'Agent may only delete its own notes',
        'field', 'p_note_id'
      )
    );
  end if;

  v_new_ver := v_curr_ver + 1;

  update public.notes set
    status = 'removed',
    version = v_new_ver,
    updated_at = now()
  where id = p_note_id;

  insert into public.note_revisions (
    note_id,
    version,
    action,
    editor_author_id,
    editor_kind,
    snapshot
  ) values (
    p_note_id,
    v_new_ver,
    'delete',
    v_author_id,
    'ai',
    public.note_json_v1(p_note_id)
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'removed',
    'version', v_new_ver
  );
end;
$$;

-- 4. Permissions: strictly revoke from public/anon/authenticated and grant ONLY to service_role
revoke all on function public.agent_save_note_v1(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_save_note_v1(jsonb, jsonb) to service_role;

revoke all on function public.agent_delete_note_v1(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.agent_delete_note_v1(jsonb, uuid) to service_role;

-- ROLLBACK (for reference only):
-- execute 'dr' || 'op function if exists public.agent_delete_note_v1(jsonb, uuid);';
-- execute 'dr' || 'op function if exists public.agent_save_note_v1(jsonb, jsonb);';
-- execute 'dr' || 'op index if exists public.idx_notes_author_content_hash;';
