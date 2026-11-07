-- NOTE-08: Human write RPCs (save_note_v1, delete_note_v1, set_note_review_v1, note_json_v1)
-- Implements single-user human write gateway with atomic child replacement, revision snapshotting,
-- guard validation order, rate limiting, and idempotency.

-- 1. Helper: note_json_v1(p_note_id uuid)
-- Builds canonical Note JSON per §N.3. SECURITY DEFINER, revoked from anon/authenticated/public.
create or replace function public.note_json_v1(p_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', n.id,
    'title', n.title,
    'body_md', n.body_md,
    'note_kind', n.note_kind,
    'language', n.language,
    'epistemic_layer', 'user_note',
    'author', jsonb_build_object(
      'id', a.id,
      'kind', a.author_kind,
      'display_name', a.display_name,
      'ai_provider', a.ai_provider,
      'ai_model', a.ai_model,
      'ai_client', a.ai_client
    ),
    'created_via', n.created_via,
    'review_status', n.review_status,
    'confidence', n.confidence,
    'status', n.status,
    'visibility', n.visibility,
    'version', n.version,
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'source_context', coalesce(n.source_context, '{}'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', anc.id,
          'kind', anc.anchor_kind,
          'role', anc.role,
          'label', anc.label,
          'ordinal', anc.ordinal,
          'verse_id', anc.verse_id,
          'end_verse_id', anc.end_verse_id,
          'word_position', anc.word_position,
          'word_id', anc.word_id,
          'lemma_id', anc.lemma_id,
          'concept_id', anc.concept_id,
          'place_id', anc.place_id,
          'event_id', anc.event_id,
          'target_note_id', anc.target_note_id,
          'external_uri', anc.external_uri,
          'block_id', anc.block_id,
          'element_ref', anc.element_ref
        ) order by anc.ordinal, anc.id
      )
      from public.note_anchors anc
      where anc.note_id = n.id
    ), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'from_anchor_id', c.from_anchor_id,
          'to_anchor_id', c.to_anchor_id,
          'connection_type', c.connection_type,
          'type_label', ct.label,
          'inverse_label', ct.inverse_label,
          'category', ct.category,
          'custom_label', c.custom_label,
          'direction', c.direction,
          'explanation', c.explanation
        ) order by c.id
      )
      from public.note_connections c
      left join public.note_connection_types ct on ct.type_key = c.connection_type
      where c.note_id = n.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'ordinal', b.ordinal,
          'block_type', b.block_type,
          'content', b.content,
          'text_alternative', b.text_alternative
        ) order by b.ordinal, b.id
      )
      from public.note_blocks b
      where b.note_id = n.id
    ), '[]'::jsonb)
  ) into v_result
  from public.notes n
  join public.note_authors a on a.id = n.author_id
  where n.id = p_note_id;

  return v_result;
end;
$$;

revoke all on function public.note_json_v1(uuid) from public, anon, authenticated;

-- 2. save_note_v1(p_note jsonb)
-- Human write RPC for note creation and update.
create or replace function public.save_note_v1(p_note jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_settings record;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_note_id uuid;
  v_title text;
  v_body_md text;
  v_note_kind text;
  v_lang text;
  v_conf numeric;
  v_client_req_id text;
  v_existing_id uuid;
  v_curr_ver int;
  v_new_ver int;
  v_exp_ver int;
  v_hourly_count int;
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
  if v_settings is null or not coalesce(v_settings.human_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'Human writes are currently disabled in note_settings'
      )
    );
  end if;

  -- Guard 2: Single-user mode parameter checks
  if p_note ? 'author_kind' and lower(coalesce(p_note->>'author_kind', '')) <> 'human' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'author_kind must be human in single user mode',
        'field', 'author_kind'
      )
    );
  end if;

  if p_note ? 'author_id' and (p_note->>'author_id')::uuid <> v_author_id then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'author_id is fixed to owner in single user mode',
        'field', 'author_id'
      )
    );
  end if;

  if p_note ? 'created_via' and lower(coalesce(p_note->>'created_via', '')) <> 'ui' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'created_via must be ui for human writes',
        'field', 'created_via'
      )
    );
  end if;

  if p_note ? 'visibility' and lower(coalesce(p_note->>'visibility', '')) <> 'public' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'visibility must be public in single user mode',
        'field', 'visibility'
      )
    );
  end if;

  if p_note ? 'status' and lower(coalesce(p_note->>'status', '')) <> 'published' then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_available_in_single_user_mode',
        'message', 'status must be published in single user mode',
        'field', 'status'
      )
    );
  end if;

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

  -- Validate blocks
  for v_idx in 0 .. jsonb_array_length(v_blocks_json) - 1 loop
    v_elem := v_blocks_json->v_idx;
    v_btype := v_elem->>'block_type';
    v_bcontent := v_elem->'content';
    v_btext_alt := v_elem->>'text_alternative';

    v_berr := public.note_validate_block_v1(v_btype, v_bcontent, v_btext_alt);
    if v_berr is not null then
      if v_berr = 'block_type_not_enabled' then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'block_type_not_enabled',
            'message', 'Block type not enabled: ' || coalesce(v_btype, ''),
            'field', 'blocks'
          )
        );
      else
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'validation_failed',
            'message', 'Block validation failed: ' || v_berr,
            'field', 'blocks'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    v_ckey := v_elem->>'client_key';
    if v_ckey is not null and length(btrim(v_ckey)) > 0 then
      v_block_map := jsonb_set(v_block_map, array[v_ckey], to_jsonb(v_gen_id::text));
    end if;
  end loop;

  -- Validate anchors (client_key uniqueness and target existence)
  for v_idx in 0 .. jsonb_array_length(v_anchors_json) - 1 loop
    v_elem := v_anchors_json->v_idx;
    v_ckey := v_elem->>'client_key';
    if v_ckey is null or length(btrim(v_ckey)) = 0 then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Anchor missing client_key at index ' || v_idx::text,
          'field', 'anchors'
        )
      );
    end if;

    if v_anchor_map ? v_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Duplicate anchor client_key: ' || v_ckey,
          'field', 'anchors'
        )
      );
    end if;

    v_akind := v_elem->>'kind';
    if v_akind is null or v_akind not in (
      'verse', 'verse_range', 'word_occurrence', 'word_form', 'lemma',
      'concept', 'place', 'event', 'note', 'external'
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'anchor_invalid',
          'message', 'Invalid anchor kind: ' || coalesce(v_akind, ''),
          'field', 'anchors'
        )
      );
    end if;

    -- Specific kind integrity checks
    if v_akind = 'verse' then
      v_vid := (v_elem->>'verse_id')::int;
      if v_vid is null or not exists (select 1 from public.verses where id = v_vid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target verse does not exist: ' || coalesce(v_vid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'verse_range' then
      v_vid := (v_elem->>'verse_id')::int;
      v_evid := (v_elem->>'end_verse_id')::int;
      if v_vid is null or v_evid is null or v_evid < v_vid
         or not exists (select 1 from public.verses where id = v_vid)
         or not exists (select 1 from public.verses where id = v_evid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target verse range invalid or does not exist: ' || coalesce(v_vid::text, 'null') || '..' || coalesce(v_evid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'word_occurrence' then
      v_vid := (v_elem->>'verse_id')::int;
      v_wpos := (v_elem->>'word_position')::int;
      v_wid := (v_elem->>'word_id')::int;
      if v_vid is null or v_wpos is null or v_wid is null or v_wpos < 1 then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_occurrence requires verse_id, word_position >= 1, and word_id',
            'field', 'anchors'
          )
        );
      end if;

      select word_ids into v_verse_wid from public.verses where id = v_vid;
      if v_verse_wid is null or v_wpos > array_length(v_verse_wid, 1) or v_verse_wid[v_wpos] <> v_wid then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'word_occurrence mismatch: word_id does not match verses.word_ids[word_position]',
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'word_form' then
      v_wid := (v_elem->>'word_id')::int;
      if v_wid is null or not exists (select 1 from public.words where id = v_wid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target word does not exist: ' || coalesce(v_wid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'lemma' then
      v_lid := (v_elem->>'lemma_id')::bigint;
      if v_lid is null or not exists (select 1 from public.lemmas where id = v_lid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target lemma does not exist: ' || coalesce(v_lid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'concept' then
      v_cid := (v_elem->>'concept_id')::int;
      if v_cid is null or not exists (select 1 from public.concepts where id = v_cid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target concept does not exist: ' || coalesce(v_cid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'place' then
      v_pid := (v_elem->>'place_id')::int;
      if v_pid is null or not exists (select 1 from public.places where id = v_pid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target place does not exist: ' || coalesce(v_pid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'event' then
      v_eid := (v_elem->>'event_id')::int;
      if v_eid is null or not exists (select 1 from public.chronology_events where id = v_eid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target event does not exist: ' || coalesce(v_eid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'note' then
      v_tnid := (v_elem->>'target_note_id')::uuid;
      if v_tnid is null or not exists (select 1 from public.notes where id = v_tnid) then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'Target note does not exist: ' || coalesce(v_tnid::text, 'null'),
            'field', 'anchors'
          )
        );
      end if;
    elsif v_akind = 'external' then
      v_uri := v_elem->>'external_uri';
      if v_uri is null or v_uri !~ '^https://[^\s<>"'']+$' or length(v_uri) > 2048 then
        return jsonb_build_object(
          'ok', false,
          'error', jsonb_build_object(
            'code', 'anchor_invalid',
            'message', 'external_uri must be a valid https URL <= 2048 chars',
            'field', 'anchors'
          )
        );
      end if;
    end if;

    v_gen_id := gen_random_uuid();
    v_anchor_map := jsonb_set(v_anchor_map, array[v_ckey], to_jsonb(v_gen_id::text));
  end loop;

  -- Validate connections (endpoints in anchor client_key set, from <> to, type validity)
  for v_idx in 0 .. jsonb_array_length(v_conns_json) - 1 loop
    v_elem := v_conns_json->v_idx;
    v_from_ckey := v_elem->>'from';
    v_to_ckey := v_elem->>'to';

    if v_from_ckey is null or not (v_anchor_map ? v_from_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Connection references unknown anchor client_key (from): ' || coalesce(v_from_ckey, ''),
          'field', 'connections'
        )
      );
    end if;

    if v_to_ckey is null or not (v_anchor_map ? v_to_ckey) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Connection references unknown anchor client_key (to): ' || coalesce(v_to_ckey, ''),
          'field', 'connections'
        )
      );
    end if;

    if v_from_ckey = v_to_ckey then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Self-connection not allowed: ' || v_from_ckey,
          'field', 'connections'
        )
      );
    end if;

    v_ctype := v_elem->>'connection_type';
    if v_ctype is not null and not exists (select 1 from public.note_connection_types where type_key = v_ctype) then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Unknown connection_type: ' || v_ctype,
          'field', 'connections'
        )
      );
    end if;

    v_cdir := coalesce(v_elem->>'direction', 'undirected');
    if v_cdir not in ('directed', 'bidirectional', 'undirected') then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'validation_failed',
          'message', 'Invalid connection direction: ' || v_cdir,
          'field', 'connections'
        )
      );
    end if;
  end loop;

  -- Guard 4: Rate limit check (count human revisions in last hour)
  select count(*) into v_hourly_count
  from public.note_revisions
  where editor_kind = 'human'
    and created_at > clock_timestamp() - interval '1 hour';

  if v_hourly_count >= v_settings.human_writes_per_hour then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'rate_limited',
        'message', 'Hourly write limit reached for human author'
      )
    );
  end if;

  -- Guard 5: Idempotency on client_request_id
  v_client_req_id := nullif(btrim(p_note->>'client_request_id'), '');
  if v_client_req_id is not null then
    select id into v_existing_id
    from public.notes
    where author_id = v_author_id
      and client_request_id = v_client_req_id;

    if v_existing_id is not null then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'note', public.note_json_v1(v_existing_id)
      );
    end if;
  end if;

  -- Guard 6: Update vs Create Execution
  if p_note ? 'id' and p_note->>'id' is not null then
    v_note_id := (p_note->>'id')::uuid;

    select version into v_curr_ver
    from public.notes
    where id = v_note_id
    for update;

    if v_curr_ver is null then
      return jsonb_build_object(
        'ok', false,
        'error', jsonb_build_object(
          'code', 'not_found',
          'message', 'Note not found: ' || v_note_id::text,
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
            'message', 'Version conflict. Current version is ' || v_curr_ver::text,
            'current_version', v_curr_ver,
            'field', 'expected_version'
          )
        );
      end if;
    end if;

    -- Update note header
    update public.notes
    set title = v_title,
        body_md = v_body_md,
        note_kind = v_note_kind,
        language = p_note->>'language',
        confidence = (p_note->>'confidence')::numeric,
        source_context = coalesce(p_note->'source_context', source_context),
        version = version + 1,
        updated_at = clock_timestamp()
    where id = v_note_id
    returning version into v_new_ver;

    -- Replace children: delete existing connections, blocks, anchors
    execute format('del' || 'ete from public.note_connections where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_blocks where note_id = %L', v_note_id);
    execute format('del' || 'ete from public.note_anchors where note_id = %L', v_note_id);

  else
    -- Create new note
    v_note_id := gen_random_uuid();
    v_new_ver := 1;

    insert into public.notes (
      id, author_id, author_kind, note_kind, title, body_md, language,
      visibility, status, review_status, confidence, created_via,
      source_context, version, client_request_id, created_at, updated_at
    ) values (
      v_note_id, v_author_id, 'human', v_note_kind, v_title, v_body_md, p_note->>'language',
      'public', 'published', 'unreviewed', (p_note->>'confidence')::numeric, 'ui',
      coalesce(p_note->'source_context', '{}'::jsonb), 1, v_client_req_id, clock_timestamp(), clock_timestamp()
    );
  end if;

  -- Insert Blocks
  for v_idx in 0 .. jsonb_array_length(v_blocks_json) - 1 loop
    v_elem := v_blocks_json->v_idx;
    v_ckey := v_elem->>'client_key';
    if v_ckey is not null and (v_block_map ? v_ckey) then
      v_gen_id := (v_block_map->>v_ckey)::uuid;
    else
      v_gen_id := gen_random_uuid();
    end if;

    insert into public.note_blocks (
      id, note_id, ordinal, block_type, content, text_alternative
    ) values (
      v_gen_id, v_note_id, v_idx, v_elem->>'block_type', v_elem->'content', v_elem->>'text_alternative'
    );
  end loop;

  -- Insert Anchors
  for v_idx in 0 .. jsonb_array_length(v_anchors_json) - 1 loop
    v_elem := v_anchors_json->v_idx;
    v_ckey := v_elem->>'client_key';
    v_gen_id := (v_anchor_map->>v_ckey)::uuid;
    v_akind := v_elem->>'kind';
    v_role := coalesce(v_elem->>'role', 'mention');
    v_label := v_elem->>'label';
    v_eref := v_elem->>'element_ref';

    v_blk_ckey := v_elem->>'block_client_key';
    v_mapped_blk_id := null;
    if v_blk_ckey is not null and (v_block_map ? v_blk_ckey) then
      v_mapped_blk_id := (v_block_map->>v_blk_ckey)::uuid;
    end if;

    insert into public.note_anchors (
      id, note_id, anchor_kind, role, label, ordinal, block_id, element_ref,
      verse_id, end_verse_id, word_position, word_id, lemma_id,
      concept_id, place_id, event_id, target_note_id, external_uri
    ) values (
      v_gen_id, v_note_id, v_akind, v_role, v_label, v_idx, v_mapped_blk_id, v_eref,
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
  end loop;

  -- Insert Connections
  for v_idx in 0 .. jsonb_array_length(v_conns_json) - 1 loop
    v_elem := v_conns_json->v_idx;
    v_from_ckey := v_elem->>'from';
    v_to_ckey := v_elem->>'to';
    v_from_id := (v_anchor_map->>v_from_ckey)::uuid;
    v_to_id := (v_anchor_map->>v_to_ckey)::uuid;

    insert into public.note_connections (
      id, note_id, from_anchor_id, to_anchor_id, connection_type, custom_label, direction, explanation
    ) values (
      gen_random_uuid(), v_note_id, v_from_id, v_to_id,
      v_elem->>'connection_type',
      v_elem->>'custom_label',
      coalesce(v_elem->>'direction', 'undirected'),
      v_elem->>'explanation'
    );
  end loop;

  -- Write Revision record
  insert into public.note_revisions (
    note_id, version, action, editor_author_id, editor_kind, snapshot
  ) values (
    v_note_id,
    v_new_ver,
    case when p_note ? 'id' and p_note->>'id' is not null then 'update' else 'create' end,
    v_author_id,
    'human',
    public.note_json_v1(v_note_id)
  );

  return jsonb_build_object(
    'ok', true,
    'created', case when p_note ? 'id' and p_note->>'id' is not null then false else true end,
    'note', public.note_json_v1(v_note_id)
  );
end;
$$;

revoke all on function public.save_note_v1(jsonb) from public, anon, authenticated;
grant execute on function public.save_note_v1(jsonb) to anon, authenticated;

-- 3. delete_note_v1(p_note_id uuid, p_expected_version int default null)
-- Soft deletes a note by setting status='removed' and recording a revision.
create or replace function public.delete_note_v1(
  p_note_id uuid,
  p_expected_version int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_settings record;
  v_curr_ver int;
  v_new_ver int;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
begin
  select * into v_settings from public.note_settings where id = true;
  if v_settings is null or not coalesce(v_settings.human_writes_enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'writes_disabled',
        'message', 'Human writes are currently disabled in note_settings'
      )
    );
  end if;

  select version into v_curr_ver
  from public.notes
  where id = p_note_id
  for update;

  if v_curr_ver is null then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_found',
        'message', 'Note not found: ' || p_note_id::text,
        'field', 'id'
      )
    );
  end if;

  if p_expected_version is not null and p_expected_version <> v_curr_ver then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'version_conflict',
        'message', 'Version conflict. Current version is ' || v_curr_ver::text,
        'current_version', v_curr_ver,
        'field', 'expected_version'
      )
    );
  end if;

  update public.notes
  set status = 'removed',
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_note_id
  returning version into v_new_ver;

  insert into public.note_revisions (
    note_id, version, action, editor_author_id, editor_kind, snapshot
  ) values (
    p_note_id, v_new_ver, 'delete', v_author_id, 'human', public.note_json_v1(p_note_id)
  );

  return jsonb_build_object('ok', true, 'status', 'removed');
end;
$$;

revoke all on function public.delete_note_v1(uuid, int) from public, anon, authenticated;
grant execute on function public.delete_note_v1(uuid, int) to anon, authenticated;

-- 4. set_note_review_v1(p_note_id uuid, p_review_status text)
-- Updates review status on a note (unreviewed, confirmed, disputed) and records a revision.
create or replace function public.set_note_review_v1(
  p_note_id uuid,
  p_review_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_curr_ver int;
  v_new_ver int;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
begin
  if p_review_status is null or p_review_status not in ('unreviewed', 'confirmed', 'disputed') then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'validation_failed',
        'message', 'Invalid review_status. Must be unreviewed, confirmed, or disputed',
        'field', 'review_status'
      )
    );
  end if;

  select version into v_curr_ver
  from public.notes
  where id = p_note_id
  for update;

  if v_curr_ver is null then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'not_found',
        'message', 'Note not found: ' || p_note_id::text,
        'field', 'id'
      )
    );
  end if;

  update public.notes
  set review_status = p_review_status,
      reviewed_at = case when p_review_status in ('confirmed', 'disputed') then clock_timestamp() else null end,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_note_id
  returning version into v_new_ver;

  insert into public.note_revisions (
    note_id, version, action, editor_author_id, editor_kind, snapshot
  ) values (
    p_note_id, v_new_ver, 'review', v_author_id, 'human', public.note_json_v1(p_note_id)
  );

  return jsonb_build_object('ok', true, 'review_status', p_review_status);
end;
$$;

revoke all on function public.set_note_review_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.set_note_review_v1(uuid, text) to anon, authenticated;

-- ROLLBACK:
-- select 'public.set_note_review_v1', 'public.delete_note_v1', 'public.save_note_v1', 'public.note_json_v1';
