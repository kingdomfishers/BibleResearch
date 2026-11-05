-- Additive migration for word gematria computation and column.
-- Calculates standard Hebrew Gematria and Greek Isopsephy from original_word,
-- stripping vowels, accents, cantillation, diacritics, and punctuation.

create or replace function public.calculate_gematria(p_word text)
returns integer
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_norm text;
  v_len integer;
  v_i integer;
  v_ch text;
  v_sum integer := 0;
begin
  if p_word is null or p_word = '' then
    return 0;
  end if;

  v_norm := lower(regexp_replace(
    normalize(p_word, NFKD),
    '[\u0591-\u05C7\u0300-\u036F]',
    '',
    'g'
  ));
  v_len := length(v_norm);

  for v_i in 1..v_len loop
    v_ch := substr(v_norm, v_i, 1);
    case v_ch
      -- Hebrew consonants (Standard Gematria: sofit forms retain base values)
      when 'א' then v_sum := v_sum + 1;
      when 'ב' then v_sum := v_sum + 2;
      when 'ג' then v_sum := v_sum + 3;
      when 'ד' then v_sum := v_sum + 4;
      when 'ה' then v_sum := v_sum + 5;
      when 'ו' then v_sum := v_sum + 6;
      when 'ז' then v_sum := v_sum + 7;
      when 'ח' then v_sum := v_sum + 8;
      when 'ט' then v_sum := v_sum + 9;
      when 'י' then v_sum := v_sum + 10;
      when 'כ', 'ך' then v_sum := v_sum + 20;
      when 'ל' then v_sum := v_sum + 30;
      when 'מ', 'ם' then v_sum := v_sum + 40;
      when 'נ', 'ן' then v_sum := v_sum + 50;
      when 'ס' then v_sum := v_sum + 60;
      when 'ע' then v_sum := v_sum + 70;
      when 'פ', 'ף' then v_sum := v_sum + 80;
      when 'צ', 'ץ' then v_sum := v_sum + 90;
      when 'ק' then v_sum := v_sum + 100;
      when 'ר' then v_sum := v_sum + 200;
      when 'ש' then v_sum := v_sum + 300;
      when 'ת' then v_sum := v_sum + 400;

      -- Greek letters (Standard Isopsephy)
      when 'α' then v_sum := v_sum + 1;
      when 'β' then v_sum := v_sum + 2;
      when 'γ' then v_sum := v_sum + 3;
      when 'δ' then v_sum := v_sum + 4;
      when 'ε' then v_sum := v_sum + 5;
      when 'ϛ', 'ϝ' then v_sum := v_sum + 6;
      when 'ζ' then v_sum := v_sum + 7;
      when 'η' then v_sum := v_sum + 8;
      when 'θ' then v_sum := v_sum + 9;
      when 'ι' then v_sum := v_sum + 10;
      when 'κ' then v_sum := v_sum + 20;
      when 'λ' then v_sum := v_sum + 30;
      when 'μ' then v_sum := v_sum + 40;
      when 'ν' then v_sum := v_sum + 50;
      when 'ξ' then v_sum := v_sum + 60;
      when 'ο' then v_sum := v_sum + 70;
      when 'π' then v_sum := v_sum + 80;
      when 'ϟ' then v_sum := v_sum + 90;
      when 'ρ' then v_sum := v_sum + 100;
      when 'σ', 'ς' then v_sum := v_sum + 200;
      when 'τ' then v_sum := v_sum + 300;
      when 'υ' then v_sum := v_sum + 400;
      when 'φ' then v_sum := v_sum + 500;
      when 'χ' then v_sum := v_sum + 600;
      when 'ψ' then v_sum := v_sum + 700;
      when 'ω' then v_sum := v_sum + 800;
      when 'ϡ' then v_sum := v_sum + 900;
      else null;
    end case;
  end loop;

  return v_sum;
end;
$$;

alter table public.words add column if not exists gematria integer generated always as (public.calculate_gematria(original_word)) stored;
create index if not exists idx_words_gematria on public.words(gematria);
grant execute on function public.calculate_gematria(text) to anon, authenticated;
