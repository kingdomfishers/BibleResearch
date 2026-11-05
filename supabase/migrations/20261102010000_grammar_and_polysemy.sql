-- Migration: 20261102010000_grammar_and_polysemy.sql
-- Server-side grammar decoding function and polysemous candidate lexemes for H5869.

create or replace function public.decode_grammar_v1(p_code text)
returns jsonb language plpgsql immutable parallel safe as $$
declare
  raw text := trim(p_code);
  res jsonb := '{}'::jsonb;
  parts text[];
  part text;
  main_part text := '';
  pfx text[] := array[]::text[];
  sfx jsonb := null;
  pos text; stem text; aspect text; person text; gender text;
  num text; state_val text; case_val text; tense_val text;
  voice_val text; mood_val text; noun_type text;
  g_parts text[];
  g_form text;
  g_decl text;
  c char;
begin
  if raw is null or raw = '' then return '{}'::jsonb; end if;

  -- Greek Robinson / STEP TEGMC style: contains '-' or known Greek invariable tokens
  if raw like '%-%' or raw in ('PREP','CONJ','ADV','PRT','INJ','HEB','ARAM') then
    g_parts := string_to_array(raw, '-');
    g_form := g_parts[1];
    case g_form
      when 'V' then pos := 'verb';
      when 'N' then pos := 'noun';
      when 'A' then pos := 'adjective';
      when 'T' then pos := 'article';
      when 'P', 'R', 'C', 'D', 'I', 'X', 'F', 'S', 'Q' then pos := 'pronoun';
      when 'PREP' then pos := 'preposition';
      when 'CONJ' then pos := 'conjunction';
      when 'ADV' then pos := 'adverb';
      when 'PRT' then pos := 'particle';
      when 'INJ' then pos := 'interjection';
      when 'HEB', 'ARAM' then pos := 'foreign';
      else pos := lower(g_form);
    end case;

    if pos = 'verb' and array_length(g_parts, 1) >= 2 then
      g_form := g_parts[2];
      if g_form like '2%' then
        c := substring(g_form from 2 for 1);
        g_form := substring(g_form from 3);
      else
        c := substring(g_form from 1 for 1);
        g_form := substring(g_form from 2);
      end if;
      case c
        when 'P' then tense_val := 'present';
        when 'I' then tense_val := 'imperfect';
        when 'F' then tense_val := 'future';
        when 'A' then tense_val := 'aorist';
        when 'X', 'R' then tense_val := 'perfect';
        when 'Y', 'L' then tense_val := 'pluperfect';
        else tense_val := null;
      end case;
      c := substring(g_form from 1 for 1);
      g_form := substring(g_form from 2);
      case c
        when 'A' then voice_val := 'active';
        when 'M' then voice_val := 'middle';
        when 'P' then voice_val := 'passive';
        when 'E' then voice_val := 'middle_or_passive';
        when 'D' then voice_val := 'deponent';
        else voice_val := null;
      end case;
      c := substring(g_form from 1 for 1);
      case c
        when 'I' then mood_val := 'indicative';
        when 'S' then mood_val := 'subjunctive';
        when 'O' then mood_val := 'optative';
        when 'M' then mood_val := 'imperative';
        when 'N' then mood_val := 'infinitive'; aspect := 'infinitive';
        when 'P' then mood_val := 'participle'; aspect := 'participle';
        else mood_val := null;
      end case;

      if array_length(g_parts, 1) >= 3 then
        g_decl := g_parts[3];
        if mood_val = 'participle' then
          case substring(g_decl from 1 for 1)
            when 'N' then case_val := 'nominative';
            when 'G' then case_val := 'genitive';
            when 'D' then case_val := 'dative';
            when 'A' then case_val := 'accusative';
            when 'V' then case_val := 'vocative';
            else case_val := null;
          end case;
          case substring(g_decl from 2 for 1)
            when 'S' then num := 'singular';
            when 'P' then num := 'plural';
            else num := null;
          end case;
          case substring(g_decl from 3 for 1)
            when 'M' then gender := 'masculine';
            when 'F' then gender := 'feminine';
            when 'N' then gender := 'neuter';
            else gender := null;
          end case;
        else
          case substring(g_decl from 1 for 1)
            when '1' then person := 'first';
            when '2' then person := 'second';
            when '3' then person := 'third';
            else person := null;
          end case;
          case substring(g_decl from 2 for 1)
            when 'S' then num := 'singular';
            when 'P' then num := 'plural';
            else num := null;
          end case;
        end if;
      end if;
    elsif pos in ('noun', 'adjective', 'article', 'pronoun') and array_length(g_parts, 1) >= 2 then
      g_decl := g_parts[2];
      case substring(g_decl from 1 for 1)
        when 'N' then case_val := 'nominative';
        when 'G' then case_val := 'genitive';
        when 'D' then case_val := 'dative';
        when 'A' then case_val := 'accusative';
        when 'V' then case_val := 'vocative';
        else case_val := null;
      end case;
      case substring(g_decl from 2 for 1)
        when 'S' then num := 'singular';
        when 'P' then num := 'plural';
        else num := null;
      end case;
      case substring(g_decl from 3 for 1)
        when 'M' then gender := 'masculine';
        when 'F' then gender := 'feminine';
        when 'N' then gender := 'neuter';
        else gender := null;
      end case;
    end if;

  else
    -- Hebrew / Aramaic (STEP TEHMC / ETCBC adapted)
    parts := string_to_array(raw, '/');
    for idx in 1..array_length(parts, 1) loop
      part := parts[idx];
      if part like 'Sp%' or part like 'HSp%' or part like 'ASp%' then
        part := regexp_replace(part, '^[HA]', '');
        sfx := jsonb_build_object(
          'type', 'pronominal',
          'person', case substring(part from 3 for 1) when '1' then 'first' when '2' then 'second' when '3' then 'third' else null end,
          'gender', case substring(part from 4 for 1) when 'm' then 'masculine' when 'f' then 'feminine' when 'c' then 'common' when 'b' then 'both' else null end,
          'number', case substring(part from 5 for 1) when 's' then 'singular' when 'p' then 'plural' when 'd' then 'dual' else null end
        );
      elsif part in ('Ta', 'HTa', 'ATa') then
        sfx := jsonb_build_object('type', 'emphatic_postpositive');
      elsif idx < array_length(parts, 1) and part in ('HTd', 'Td', 'd') then
        pfx := array_append(pfx, 'article');
      elsif idx < array_length(parts, 1) and part in ('HC', 'Hc', 'C', 'c', 'AC', 'Ac') then
        pfx := array_append(pfx, 'conjunction');
      elsif idx < array_length(parts, 1) and part in ('HR', 'Hr', 'R', 'r', 'AR', 'Ar') then
        pfx := array_append(pfx, 'preposition');
      elsif idx < array_length(parts, 1) and part in ('HRd', 'Rd') then
        pfx := array_append(pfx, 'preposition');
        pfx := array_append(pfx, 'article');
      elsif idx < array_length(parts, 1) and part in ('HTi', 'Ti') then
        pfx := array_append(pfx, 'interrogative');
      else
        main_part := part;
      end if;
    end loop;

    if main_part = '' then
      main_part := parts[array_length(parts, 1)];
      if array_length(pfx, 1) > 0 then
        pfx := pfx[1:array_length(pfx, 1) - 1];
      end if;
    end if;

    main_part := regexp_replace(main_part, '^[HA]', '');
    c := substring(main_part from 1 for 1);

    if c = 'V' then
      pos := 'verb';
      case substring(main_part from 2 for 1)
        when 'q' then stem := 'qal';
        when 'n' then stem := 'niphal';
        when 'p' then stem := 'piel';
        when 'P' then stem := 'pual';
        when 'h' then stem := 'hiphil';
        when 'H' then stem := 'hophal';
        when 't' then stem := 'hithpael';
        when 'o' then stem := 'polel';
        when 'O' then stem := 'polal';
        when 'r' then stem := 'hithpolel';
        when 'm' then stem := 'poel';
        when 'M' then stem := 'poal';
        when 'k' then stem := 'palpel';
        when 'K' then stem := 'polpal';
        else stem := null;
      end case;
      case substring(main_part from 3 for 1)
        when 'p' then aspect := 'perfect';
        when 'q' then aspect := 'weqatal';
        when 'i' then aspect := 'imperfect';
        when 'w' then aspect := 'wayyiqtol';
        when 'v' then aspect := 'imperative';
        when 'r' then aspect := 'participle';
        when 's' then aspect := 'passive_participle';
        when 'c' then aspect := 'infinitive_construct';
        when 'a' then aspect := 'infinitive_absolute';
        when 'j' then aspect := 'jussive';
        when 'e' then aspect := 'cohortative';
        else aspect := null;
      end case;

      if aspect in ('participle', 'passive_participle') then
        case substring(main_part from 4 for 1)
          when 'm' then gender := 'masculine';
          when 'f' then gender := 'feminine';
          when 'c', 'b' then gender := 'common';
          else gender := null;
        end case;
        case substring(main_part from 5 for 1)
          when 's' then num := 'singular';
          when 'p' then num := 'plural';
          when 'd' then num := 'dual';
          else num := null;
        end case;
        case substring(main_part from 6 for 1)
          when 'a' then state_val := 'absolute';
          when 'c' then state_val := 'construct';
          when 'e', 'd' then state_val := 'emphatic';
          else state_val := null;
        end case;
      elsif aspect in ('infinitive_construct', 'infinitive_absolute') then
        case substring(main_part from 4 for 1)
          when 'a' then state_val := 'absolute';
          when 'c' then state_val := 'construct';
          else state_val := null;
        end case;
      else
        case substring(main_part from 4 for 1)
          when '1' then person := 'first';
          when '2' then person := 'second';
          when '3' then person := 'third';
          else person := null;
        end case;
        case substring(main_part from 5 for 1)
          when 'm' then gender := 'masculine';
          when 'f' then gender := 'feminine';
          when 'c', 'b' then gender := 'common';
          else gender := null;
        end case;
        case substring(main_part from 6 for 1)
          when 's' then num := 'singular';
          when 'p' then num := 'plural';
          when 'd' then num := 'dual';
          else num := null;
        end case;
      end if;

    elsif c = 'N' then
      pos := 'noun';
      case substring(main_part from 2 for 1)
        when 'c' then noun_type := 'common';
        when 'p' then noun_type := 'proper';
        when 'g' then noun_type := 'gentilic';
        else noun_type := null;
      end case;
      case substring(main_part from 3 for 1)
        when 'm' then gender := 'masculine';
        when 'f' then gender := 'feminine';
        when 'c', 'b' then gender := 'common';
        when 'l' then noun_type := 'proper_location';
        else gender := null;
      end case;
      case substring(main_part from 4 for 1)
        when 's' then num := 'singular';
        when 'p' then num := 'plural';
        when 'd' then num := 'dual';
        else num := null;
      end case;
      case substring(main_part from 5 for 1)
        when 'a' then state_val := 'absolute';
        when 'c' then state_val := 'construct';
        when 'd', 'e' then state_val := 'emphatic';
        else state_val := null;
      end case;

    elsif c = 'A' then
      pos := 'adjective';
      case substring(main_part from 3 for 1)
        when 'm' then gender := 'masculine';
        when 'f' then gender := 'feminine';
        when 'c', 'b' then gender := 'common';
        else gender := null;
      end case;
      case substring(main_part from 4 for 1)
        when 's' then num := 'singular';
        when 'p' then num := 'plural';
        when 'd' then num := 'dual';
        else num := null;
      end case;
      case substring(main_part from 5 for 1)
        when 'a' then state_val := 'absolute';
        when 'c' then state_val := 'construct';
        when 'd', 'e' then state_val := 'emphatic';
        else state_val := null;
      end case;

    elsif c = 'P' then
      pos := 'pronoun';
    elsif c = 'R' then
      pos := 'preposition';
    elsif c = 'C' then
      pos := 'conjunction';
    elsif c = 'D' then
      pos := 'adverb';
    elsif c = 'T' then
      pos := 'particle';
    end if;

    if pos is null then
      if main_part in ('R', 'r') then pos := 'preposition';
      elsif main_part in ('C', 'c') then pos := 'conjunction';
      elsif main_part in ('D', 'd') then pos := 'adverb';
      elsif main_part in ('T', 't', 'To', 'Tn', 'Ti', 'Te', 'Td') then pos := 'particle';
      elsif main_part in ('P', 'p') then pos := 'pronoun';
      else pos := lower(main_part);
      end if;
    end if;
  end if;

  res := jsonb_strip_nulls(jsonb_build_object(
    'pos', pos,
    'stem', stem,
    'aspect', aspect,
    'tense', tense_val,
    'voice', voice_val,
    'mood', mood_val,
    'person', person,
    'gender', gender,
    'number', num,
    'state', state_val,
    'case', case_val,
    'type', noun_type,
    'prefixes', case when array_length(pfx, 1) > 0 then to_jsonb(pfx) else null end,
    'suffix', sfx
  ));
  return res;
end;
$$;

revoke all on function public.decode_grammar_v1(text) from public;
grant execute on function public.decode_grammar_v1(text) to anon,authenticated;

-- Polysemy and homograph preservation: insert distinct lexeme candidates for H5869 ('ayin)
insert into public.lexemes 
  (lexeme_key, language, base_strongs, extended_strongs, disambiguated_strongs, unified_strongs, original_lemma, transliteration, pos, primary_gloss, homograph_note, source_release_id)
select v.lexeme_key, v.language, v.base_strongs, v.extended_strongs, v.disambiguated_strongs, v.unified_strongs, v.original_lemma, v.transliteration, v.pos, v.primary_gloss, v.homograph_note, sr.id
from (values
  ('H5869a', 'hbo', 'H5869', 'H5869A', 'H5869A=עַיִן_1', 'H5869a', 'עַיִן', 'a.yin', 'Noun Feminine', 'eye / sight / appearance', 'Sense I: physical eye, gaze, understanding, or surface appearance. Shared root/paronomasia with spring (fountain).', 'stepbible-2026-11'),
  ('H5869b', 'hbo', 'H5869', 'H5869B', 'H5869B=עַיִן_2', 'H5869b', 'עַיִן', 'a.yin', 'Noun Feminine', 'spring / fountain of water', 'Sense II: natural water source or spring (e.g. Gen 16:7, 24:16, 24:43). Shared consonantal root with eye/sight (conceptual stacking of the eye of the earth yielding tears/waters).', 'stepbible-2026-11')
) as v(lexeme_key, language, base_strongs, extended_strongs, disambiguated_strongs, unified_strongs, original_lemma, transliteration, pos, primary_gloss, homograph_note, rel_key)
join public.source_releases sr on sr.release_key = v.rel_key
on conflict (lexeme_key) do update set
  homograph_note = excluded.homograph_note,
  primary_gloss = excluded.primary_gloss;
