-- Verification script for word gematria database calculation and words column.
do $verify$
declare
  v_gematria integer;
  v_null_count integer;
begin
  -- 1. Test Genesis 1:1 Hebrew words
  if public.calculate_gematria('בְּרֵאשִׁית') <> 913 then
    raise exception 'Genesis 1:1 word 1 gematria mismatch: expected 913, got %', public.calculate_gematria('בְּרֵאשִׁית');
  end if;
  if public.calculate_gematria('בָּרָא') <> 203 then
    raise exception 'Genesis 1:1 word 2 gematria mismatch: expected 203, got %', public.calculate_gematria('בָּרָא');
  end if;
  if public.calculate_gematria('אֱלֹהִים') <> 86 then
    raise exception 'Genesis 1:1 word 3 gematria mismatch: expected 86, got %', public.calculate_gematria('אֱלֹהִים');
  end if;
  if public.calculate_gematria('אֵת') <> 401 then
    raise exception 'Genesis 1:1 word 4 gematria mismatch: expected 401, got %', public.calculate_gematria('אֵת');
  end if;
  if public.calculate_gematria('הַשָּׁמַיִם') <> 395 then
    raise exception 'Genesis 1:1 word 5 gematria mismatch: expected 395, got %', public.calculate_gematria('הַשָּׁמַיִם');
  end if;
  if public.calculate_gematria('וְאֵת') <> 407 then
    raise exception 'Genesis 1:1 word 6 gematria mismatch: expected 407, got %', public.calculate_gematria('וְאֵת');
  end if;
  if public.calculate_gematria('הָאָרֶץ') <> 296 then
    raise exception 'Genesis 1:1 word 7 gematria mismatch: expected 296, got %', public.calculate_gematria('הָאָרֶץ');
  end if;

  -- 2. Test John 1:1 Greek words & Jesus
  if public.calculate_gematria('Ἐν') <> 55 then
    raise exception 'John 1:1 word 1 gematria mismatch: expected 55, got %', public.calculate_gematria('Ἐν');
  end if;
  if public.calculate_gematria('ἀρχῇ') <> 709 then
    raise exception 'John 1:1 word 2 gematria mismatch: expected 709, got %', public.calculate_gematria('ἀρχῇ');
  end if;
  if public.calculate_gematria('λόγος') <> 373 then
    raise exception 'John 1:1 word 5 gematria mismatch: expected 373, got %', public.calculate_gematria('λόγος');
  end if;
  if public.calculate_gematria('Ἰησοῦς') <> 888 then
    raise exception 'Jesus isopsephy mismatch: expected 888, got %', public.calculate_gematria('Ἰησοῦς');
  end if;

  -- 3. Verify public.words.gematria column exists and is populated
  select count(*) into v_null_count from public.words where gematria is null;
  if v_null_count > 0 then
    raise exception 'words.gematria contains % null values', v_null_count;
  end if;

  -- 4. Verify privileges
  if not has_function_privilege('anon', 'public.calculate_gematria(text)', 'execute')
    or not has_function_privilege('authenticated', 'public.calculate_gematria(text)', 'execute') then
    raise exception 'calculate_gematria lacks execute grant for anon/authenticated';
  end if;

  -- 5. Verify index
  if not exists (select 1 from pg_indexes where tablename = 'words' and indexname = 'idx_words_gematria') then
    raise exception 'idx_words_gematria index is missing';
  end if;
end $verify$;
select 'Gematria calculation and schema verified successfully' as result;
