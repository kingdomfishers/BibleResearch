-- NOTE-10: Note read RPCs
-- Implements get_notes_for_passage_v1, get_notes_for_word_v1, get_note_v1,
-- list_notes_v1, and list_note_connection_types_v1.
-- All functions are SECURITY INVOKER, search_path='', statement_timeout '8s',
-- and granted only to anon, authenticated.

-- 1. Grant column-level select on note_revisions and create RLS policy for published public notes
grant select (note_id, version, action, editor_kind, created_at) on public.note_revisions to anon, authenticated;

create policy p_note_revisions_select on public.note_revisions
for select to anon, authenticated
using (
  exists (
    select 1 from public.notes n
    where n.id = note_revisions.note_id
      and n.status = 'published'
      and n.visibility = 'public'
  )
);

-- 2. list_note_connection_types_v1()
create or replace function public.list_note_connection_types_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
set jit = 'off'
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'connection_types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type_key', ct.type_key,
          'connection_type', ct.connection_type,
          'label', ct.label,
          'inverse_label', ct.inverse_label,
          'category', ct.category,
          'default_direction', ct.default_direction,
          'is_symmetric', ct.is_symmetric,
          'description', ct.description,
          'is_system', ct.is_system
        ) order by ct.category, ct.type_key
      )
      from public.note_connection_types ct
    ), '[]'::jsonb),
    'note_kinds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'note_kind', nk.note_kind,
          'label', nk.label,
          'description', nk.description
        ) order by nk.note_kind
      )
      from public.note_kinds nk
    ), '[]'::jsonb),
    'block_types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'block_type', bt.block_type,
          'label', bt.label,
          'renderer_status', bt.renderer_status,
          'is_enabled', bt.is_enabled,
          'required_keys', to_jsonb(bt.required_keys),
          'url_keys', to_jsonb(bt.url_keys),
          'max_bytes', bt.max_bytes,
          'description', bt.description
        ) order by bt.block_type
      )
      from public.note_block_types bt
    ), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_build_object(
        'single_user_mode', s.single_user_mode,
        'human_writes_enabled', s.human_writes_enabled,
        'ai_writes_enabled', s.ai_writes_enabled,
        'default_visibility', s.default_visibility,
        'max_title_chars', s.max_title_chars,
        'max_body_chars', s.max_body_chars,
        'max_anchors', s.max_anchors,
        'max_connections', s.max_connections,
        'max_blocks', s.max_blocks,
        'human_writes_per_hour', s.human_writes_per_hour,
        'ai_writes_per_hour', s.ai_writes_per_hour,
        'updated_at', s.updated_at
      )
      from public.note_settings s
      where s.id = true
    ), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.list_note_connection_types_v1() from public, anon, authenticated;
grant execute on function public.list_note_connection_types_v1() to anon, authenticated;


-- 3. get_note_v1(p_note_id uuid)
create or replace function public.get_note_v1(p_note_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
set jit = 'off'
as $$
declare
  v_note jsonb;
  v_backlinks jsonb;
  v_revisions jsonb;
begin
  if p_note_id is null then
    return null;
  end if;

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
  ) into v_note
  from public.notes n
  join public.note_authors a on a.id = n.author_id
  where n.id = p_note_id
    and n.status = 'published'
    and n.visibility = 'public';

  if v_note is null then
    return null;
  end if;

  -- Backlinks: notes anchored to this note via anchor_kind='note' and target_note_id = p_note_id
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', bn.id,
        'title', bn.title,
        'note_kind', bn.note_kind,
        'author', jsonb_build_object(
          'id', ba.id,
          'kind', ba.author_kind,
          'display_name', ba.display_name,
          'ai_model', ba.ai_model
        ),
        'status', bn.status,
        'created_at', bn.created_at
      ) order by bn.created_at desc, bn.id desc
    ),
    '[]'::jsonb
  ) into v_backlinks
  from public.note_anchors banc
  join public.notes bn on bn.id = banc.note_id
  join public.note_authors ba on ba.id = bn.author_id
  where banc.anchor_kind = 'note'
    and banc.target_note_id = p_note_id
    and bn.status = 'published'
    and bn.visibility = 'public';

  -- Revisions: summaries from note_revisions
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'version', r.version,
        'action', r.action,
        'editor_kind', r.editor_kind,
        'created_at', r.created_at
      ) order by r.version asc
    ),
    '[]'::jsonb
  ) into v_revisions
  from public.note_revisions r
  where r.note_id = p_note_id;

  v_note := v_note || jsonb_build_object('backlinks', v_backlinks, 'revisions', v_revisions);

  return v_note;
end;
$$;

revoke all on function public.get_note_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_note_v1(uuid) to anon, authenticated;


-- 4. get_notes_for_passage_v1
create or replace function public.get_notes_for_passage_v1(
  p_book int,
  p_chapter int,
  p_verse_start int,
  p_verse_end int default null,
  p_author_kind text default null,
  p_note_kind text default null,
  p_limit int default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
set jit = 'off'
as $$
declare
  v_verse_end int;
  v_limit int;
  v_verse_ids int[];
  v_min_vid int;
  v_max_vid int;
  v_primary_list jsonb;
  v_secondary_list jsonb;
  v_token_counts jsonb;
  v_primary_total int := 0;
  v_secondary_total int := 0;
  v_human_total int := 0;
  v_ai_total int := 0;
  v_result jsonb;
begin
  if p_book is null or p_chapter is null or p_verse_start is null or p_verse_start < 0 then
    return jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse_start', p_verse_start, 'verse_end', p_verse_end, 'verse_ids', '[]'::jsonb),
      'primary', '[]'::jsonb,
      'secondary', '[]'::jsonb,
      'totals', jsonb_build_object('primary', 0, 'secondary', 0, 'human', 0, 'ai', 0, 'total', 0),
      'truncated', jsonb_build_object('primary', false, 'secondary', false),
      'token_note_counts', '[]'::jsonb
    );
  end if;

  v_verse_end := greatest(p_verse_start, coalesce(p_verse_end, p_verse_start));
  if v_verse_end - p_verse_start + 1 > 100 then
    v_verse_end := p_verse_start + 99;
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  select array_agg(v.id order by v.id), min(v.id), max(v.id)
  into v_verse_ids, v_min_vid, v_max_vid
  from public.verses v
  where v.book = p_book
    and v.chapter = p_chapter
    and v.verse_nr between p_verse_start and v_verse_end;

  if v_verse_ids is null or array_length(v_verse_ids, 1) = 0 then
    return jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse_start', p_verse_start, 'verse_end', v_verse_end, 'verse_ids', '[]'::jsonb),
      'primary', '[]'::jsonb,
      'secondary', '[]'::jsonb,
      'totals', jsonb_build_object('primary', 0, 'secondary', 0, 'human', 0, 'ai', 0, 'total', 0),
      'truncated', jsonb_build_object('primary', false, 'secondary', false),
      'token_note_counts', '[]'::jsonb
    );
  end if;

  with passage_tokens as (
    select pv.id as verse_id, pos.ord::int as word_position, pos.val::int as word_id
    from public.verses pv,
    unnest(pv.word_ids) with ordinality as pos(val, ord)
    where pv.id = any(v_verse_ids)
  ),
  passage_words as (
    select distinct word_id from passage_tokens
  ),
  passage_lemmas as (
    select distinct wfl.lemma_id, wfl.word_id
    from public.word_form_lemmas wfl
    where wfl.word_id in (select word_id from passage_words)
  ),
  primary_matches as (
    select
      anc.note_id,
      case
        when anc.anchor_kind = 'verse' then 'verse:' || anc.verse_id::text
        when anc.anchor_kind = 'verse_range' then 'verse_range:' || anc.verse_id::text || '-' || anc.end_verse_id::text
        when anc.anchor_kind = 'word_occurrence' then 'word_occurrence:' || anc.verse_id::text || ':' || anc.word_position::text
      end as reason,
      anc.anchor_kind,
      anc.verse_id,
      anc.word_position,
      anc.word_id
    from public.note_anchors anc
    where (
      (anc.anchor_kind = 'verse' and anc.verse_id = any(v_verse_ids))
      or (anc.anchor_kind = 'verse_range' and anc.verse_id <= v_max_vid and anc.end_verse_id >= v_min_vid and exists (
            select 1 from unnest(v_verse_ids) x where x between anc.verse_id and anc.end_verse_id
          ))
      or (anc.anchor_kind = 'word_occurrence' and anc.verse_id = any(v_verse_ids))
    )
  ),
  primary_summary as (
    select
      pm.note_id,
      array_agg(distinct pm.reason) as reasons,
      coalesce(
        jsonb_agg(
          distinct jsonb_build_object(
            'verse_id', pm.verse_id,
            'word_position', pm.word_position,
            'word_id', pm.word_id
          )
        ) filter (where pm.anchor_kind = 'word_occurrence'),
        '[]'::jsonb
      ) as positions
    from primary_matches pm
    group by pm.note_id
  ),
  primary_all as (
    select
      n.id as note_id,
      n.author_kind,
      ps.reasons,
      ps.positions,
      n.created_at
    from primary_summary ps
    join public.notes n on n.id = ps.note_id
    where n.status = 'published'
      and n.visibility = 'public'
      and (p_author_kind is null or n.author_kind = p_author_kind)
      and (p_note_kind is null or n.note_kind = p_note_kind)
  ),
  secondary_matches as (
    select
      anc.note_id,
      'word_form:' || anc.word_id::text as reason,
      pt.verse_id,
      pt.word_position,
      pt.word_id
    from public.note_anchors anc
    join passage_tokens pt on pt.word_id = anc.word_id
    where anc.anchor_kind = 'word_form'
      and not exists (select 1 from primary_summary ps where ps.note_id = anc.note_id)

    union all

    select
      anc.note_id,
      'lemma:' || anc.lemma_id::text as reason,
      pt.verse_id,
      pt.word_position,
      pt.word_id
    from public.note_anchors anc
    join passage_lemmas pl on pl.lemma_id = anc.lemma_id
    join passage_tokens pt on pt.word_id = pl.word_id
    where anc.anchor_kind = 'lemma'
      and not exists (select 1 from primary_summary ps where ps.note_id = anc.note_id)
  ),
  secondary_summary as (
    select
      sm.note_id,
      array_agg(distinct sm.reason) as reasons,
      coalesce(
        jsonb_agg(
          distinct jsonb_build_object(
            'verse_id', sm.verse_id,
            'word_position', sm.word_position,
            'word_id', sm.word_id
          )
        ),
        '[]'::jsonb
      ) as positions
    from secondary_matches sm
    group by sm.note_id
  ),
  secondary_all as (
    select
      n.id as note_id,
      n.author_kind,
      ss.reasons,
      ss.positions,
      n.created_at
    from secondary_summary ss
    join public.notes n on n.id = ss.note_id
    where n.status = 'published'
      and n.visibility = 'public'
      and (p_author_kind is null or n.author_kind = p_author_kind)
      and (p_note_kind is null or n.note_kind = p_note_kind)
  ),
  token_counts_agg as (
    select
      anc.verse_id,
      anc.word_position,
      count(*) filter (where n.author_kind = 'human')::int as human,
      count(*) filter (where n.author_kind = 'ai')::int as ai
    from public.note_anchors anc
    join public.notes n on n.id = anc.note_id
    where anc.anchor_kind = 'word_occurrence'
      and anc.verse_id = any(v_verse_ids)
      and n.status = 'published'
      and n.visibility = 'public'
      and (p_author_kind is null or n.author_kind = p_author_kind)
      and (p_note_kind is null or n.note_kind = p_note_kind)
    group by anc.verse_id, anc.word_position
    order by anc.verse_id, anc.word_position
  )
  select
    (select count(*)::int from primary_all),
    (select count(*)::int from secondary_all),
    (select count(*)::int from (
       select pa.note_id from primary_all pa where pa.author_kind = 'human'
       union
       select sa.note_id from secondary_all sa where sa.author_kind = 'human'
     ) u),
    (select count(*)::int from (
       select pa.note_id from primary_all pa where pa.author_kind = 'ai'
       union
       select sa.note_id from secondary_all sa where sa.author_kind = 'ai'
     ) u),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'verse_id', tc.verse_id,
          'word_position', tc.word_position,
          'human', tc.human,
          'ai', tc.ai
        )
      ) from token_counts_agg tc
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
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
          ), '[]'::jsonb),
          'tier', 'primary',
          'reasons', to_jsonb(p_sub.reasons),
          'positions', p_sub.positions
        ) order by p_sub.created_at desc, p_sub.note_id desc
      )
      from (
        select pa.note_id, pa.reasons, pa.positions, pa.created_at
        from primary_all pa
        order by pa.created_at desc, pa.note_id desc
        limit v_limit
      ) p_sub
      join public.notes n on n.id = p_sub.note_id
      join public.note_authors a on a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
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
          ), '[]'::jsonb),
          'tier', 'secondary',
          'reasons', to_jsonb(s_sub.reasons),
          'positions', s_sub.positions
        ) order by s_sub.created_at desc, s_sub.note_id desc
      )
      from (
        select sa.note_id, sa.reasons, sa.positions, sa.created_at
        from secondary_all sa
        order by sa.created_at desc, sa.note_id desc
        limit v_limit
      ) s_sub
      join public.notes n on n.id = s_sub.note_id
      join public.note_authors a on a.id = n.author_id
    ), '[]'::jsonb)
  into
    v_primary_total,
    v_secondary_total,
    v_human_total,
    v_ai_total,
    v_token_counts,
    v_primary_list,
    v_secondary_list;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'passage', jsonb_build_object(
      'book', p_book,
      'chapter', p_chapter,
      'verse_start', p_verse_start,
      'verse_end', v_verse_end,
      'verse_ids', v_verse_ids
    ),
    'primary', v_primary_list,
    'secondary', v_secondary_list,
    'totals', jsonb_build_object(
      'primary', v_primary_total,
      'secondary', v_secondary_total,
      'human', v_human_total,
      'ai', v_ai_total,
      'total', v_primary_total + v_secondary_total
    ),
    'truncated', jsonb_build_object(
      'primary', v_primary_total > v_limit,
      'secondary', v_secondary_total > v_limit
    ),
    'token_note_counts', v_token_counts
  );

  return v_result;
end;
$$;

revoke all on function public.get_notes_for_passage_v1(int, int, int, int, text, text, int) from public, anon, authenticated;
grant execute on function public.get_notes_for_passage_v1(int, int, int, int, text, text, int) to anon, authenticated;


-- 5. get_notes_for_word_v1
create or replace function public.get_notes_for_word_v1(
  p_word_id int,
  p_verse_id int default null,
  p_word_position int default null,
  p_limit int default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
set jit = 'off'
as $$
declare
  v_limit int;
  v_lemmas jsonb;
  v_occurrence_list jsonb;
  v_form_list jsonb;
  v_lemma_list jsonb;
  v_occ_total int := 0;
  v_form_total int := 0;
  v_lemma_total int := 0;
  v_human_total int := 0;
  v_ai_total int := 0;
  v_result jsonb;
begin
  if p_word_id is null then
    return jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'groups', jsonb_build_object('occurrence', '[]'::jsonb, 'form', '[]'::jsonb, 'lemma', '[]'::jsonb),
      'totals', jsonb_build_object('occurrence', 0, 'form', 0, 'lemma', 0, 'human', 0, 'ai', 0, 'total', 0),
      'lemmas', '[]'::jsonb
    );
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  -- Fetch associated lemmas
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'lemma_id', l.id,
        'lemma_key', l.lemma_key
      ) order by l.id
    ),
    '[]'::jsonb
  ) into v_lemmas
  from (
    select distinct wfl.lemma_id
    from public.word_form_lemmas wfl
    where wfl.word_id = p_word_id
  ) wl
  join public.lemmas l on l.id = wl.lemma_id;

  with word_lemmas as (
    select distinct wfl.lemma_id
    from public.word_form_lemmas wfl
    where wfl.word_id = p_word_id
  ),
  candidate_anchors as (
    select
      anc.note_id,
      'occurrence' as scope
    from public.note_anchors anc
    where anc.anchor_kind = 'word_occurrence'
      and anc.word_id = p_word_id
      and (p_verse_id is null or anc.verse_id = p_verse_id)
      and (p_word_position is null or anc.word_position = p_word_position)

    union all

    select
      anc.note_id,
      'form' as scope
    from public.note_anchors anc
    where anc.anchor_kind = 'word_form'
      and anc.word_id = p_word_id

    union all

    select
      anc.note_id,
      'lemma' as scope
    from public.note_anchors anc
    where anc.anchor_kind = 'lemma'
      and anc.lemma_id in (select wl.lemma_id from word_lemmas wl)
  ),
  scoped_notes as (
    select
      ca.note_id,
      array_agg(distinct ca.scope) as scopes,
      case
        when 'occurrence' = any(array_agg(distinct ca.scope)) then 'occurrence'
        when 'form' = any(array_agg(distinct ca.scope)) then 'form'
        else 'lemma'
      end as assigned_group
    from candidate_anchors ca
    group by ca.note_id
  ),
  classified_notes as (
    select
      n.id as note_id,
      n.author_kind,
      sn.scopes,
      sn.assigned_group,
      n.created_at
    from scoped_notes sn
    join public.notes n on n.id = sn.note_id
    where n.status = 'published'
      and n.visibility = 'public'
  )
  select
    (select count(*)::int from classified_notes where assigned_group = 'occurrence'),
    (select count(*)::int from classified_notes where assigned_group = 'form'),
    (select count(*)::int from classified_notes where assigned_group = 'lemma'),
    (select count(*)::int from classified_notes where author_kind = 'human'),
    (select count(*)::int from classified_notes where author_kind = 'ai'),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
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
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) order by sub.created_at desc, sub.note_id desc
      )
      from (
        select cn.note_id, cn.scopes, cn.created_at
        from classified_notes cn
        where cn.assigned_group = 'occurrence'
        order by cn.created_at desc, cn.note_id desc
        limit v_limit
      ) sub
      join public.notes n on n.id = sub.note_id
      join public.note_authors a on a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
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
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) order by sub.created_at desc, sub.note_id desc
      )
      from (
        select cn.note_id, cn.scopes, cn.created_at
        from classified_notes cn
        where cn.assigned_group = 'form'
        order by cn.created_at desc, cn.note_id desc
        limit v_limit
      ) sub
      join public.notes n on n.id = sub.note_id
      join public.note_authors a on a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
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
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) order by sub.created_at desc, sub.note_id desc
      )
      from (
        select cn.note_id, cn.scopes, cn.created_at
        from classified_notes cn
        where cn.assigned_group = 'lemma'
        order by cn.created_at desc, cn.note_id desc
        limit v_limit
      ) sub
      join public.notes n on n.id = sub.note_id
      join public.note_authors a on a.id = n.author_id
    ), '[]'::jsonb)
  into
    v_occ_total,
    v_form_total,
    v_lemma_total,
    v_human_total,
    v_ai_total,
    v_occurrence_list,
    v_form_list,
    v_lemma_list;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'groups', jsonb_build_object(
      'occurrence', v_occurrence_list,
      'form', v_form_list,
      'lemma', v_lemma_list
    ),
    'totals', jsonb_build_object(
      'occurrence', v_occ_total,
      'form', v_form_total,
      'lemma', v_lemma_total,
      'human', v_human_total,
      'ai', v_ai_total,
      'total', v_occ_total + v_form_total + v_lemma_total
    ),
    'lemmas', v_lemmas
  );

  return v_result;
end;
$$;

revoke all on function public.get_notes_for_word_v1(int, int, int, int) from public, anon, authenticated;
grant execute on function public.get_notes_for_word_v1(int, int, int, int) to anon, authenticated;


-- 6. list_notes_v1
create or replace function public.list_notes_v1(
  p_author_kind text default null,
  p_note_kind text default null,
  p_connection_type text default null,
  p_query text default null,
  p_limit int default 25,
  p_cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '8s'
set jit = 'off'
as $$
declare
  v_limit int;
  v_cur_created timestamptz;
  v_cur_id uuid;
  v_notes_list jsonb;
  v_total int := 0;
  v_has_more boolean := false;
  v_next_cursor jsonb := null;
  v_fetched_count int := 0;
  v_result jsonb;
begin
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);

  if p_cursor is not null and p_cursor ? 'created_at' and p_cursor ? 'id' then
    v_cur_created := (p_cursor->>'created_at')::timestamptz;
    v_cur_id := (p_cursor->>'id')::uuid;
  end if;

  -- Compute total matching filter conditions
  select count(*)::int into v_total
  from public.notes n
  where n.status = 'published'
    and n.visibility = 'public'
    and (p_author_kind is null or n.author_kind = p_author_kind)
    and (p_note_kind is null or n.note_kind = p_note_kind)
    and (p_connection_type is null or exists (
          select 1 from public.note_connections c
          where c.note_id = n.id and c.connection_type = p_connection_type
        ))
    and (p_query is null or trim(p_query) = '' or (
          n.tsv @@ websearch_to_tsquery('simple', trim(p_query))
          or n.title ilike '%' || trim(p_query) || '%'
        ));

  -- Fetch items with limit + 1
  with filtered_rows as (
    select
      n.id as note_id,
      n.created_at
    from public.notes n
    where n.status = 'published'
      and n.visibility = 'public'
      and (p_author_kind is null or n.author_kind = p_author_kind)
      and (p_note_kind is null or n.note_kind = p_note_kind)
      and (p_connection_type is null or exists (
            select 1 from public.note_connections c
            where c.note_id = n.id and c.connection_type = p_connection_type
          ))
      and (p_query is null or trim(p_query) = '' or (
            n.tsv @@ websearch_to_tsquery('simple', trim(p_query))
            or n.title ilike '%' || trim(p_query) || '%'
          ))
      and (
        v_cur_created is null
        or (n.created_at, n.id) < (v_cur_created, v_cur_id)
      )
    order by n.created_at desc, n.id desc
    limit (v_limit + 1)
  ),
  numbered as (
    select
      fr.note_id,
      fr.created_at,
      row_number() over (order by fr.created_at desc, fr.note_id desc) as rn
    from filtered_rows fr
  )
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
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
        ) order by num.created_at desc, num.note_id desc
      )
      from numbered num
      join public.notes n on n.id = num.note_id
      join public.note_authors a on a.id = n.author_id
      where num.rn <= v_limit
    ), '[]'::jsonb),
    (select count(*)::int from numbered),
    (
      select jsonb_build_object(
        'created_at', num.created_at,
        'id', num.note_id
      )
      from numbered num
      where num.rn = v_limit
    )
  into v_notes_list, v_fetched_count, v_next_cursor;

  if v_fetched_count > v_limit then
    v_has_more := true;
  else
    v_has_more := false;
    v_next_cursor := null;
  end if;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'notes', v_notes_list,
    'page', jsonb_build_object(
      'limit', v_limit,
      'next_cursor', v_next_cursor,
      'has_more', v_has_more
    ),
    'total', v_total
  );

  return v_result;
end;
$$;

revoke all on function public.list_notes_v1(text, text, text, text, int, jsonb) from public, anon, authenticated;
grant execute on function public.list_notes_v1(text, text, text, text, int, jsonb) to anon, authenticated;
