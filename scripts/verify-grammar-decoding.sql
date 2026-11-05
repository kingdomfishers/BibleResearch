-- Verify decode_grammar_v1 and H5869 polysemous candidate lexemes

select 
  code,
  public.decode_grammar_v1(code) as decoded
from unnest(array[
  'HVhrmsa',
  'HNcmpa',
  'HTd/Ncmsa',
  'HNcmsc/Sp3ms',
  'Hc/Vqw3ms',
  'HAamsa',
  'V-PAP-NSM',
  'V-AAI-3S',
  'N-ASF'
]) as code;

select 
  lexeme_key,
  base_strongs,
  original_lemma,
  primary_gloss,
  homograph_note
from public.lexemes
where base_strongs in ('H5869', 'H1254', 'H430')
order by lexeme_key;
