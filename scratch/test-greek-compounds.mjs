import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const greekLemmas = [];
let lastId = 0;
while (true) {
  const { data } = await supabase
    .from('lemmas')
    .select('id,lemma_key,language,base_strongs,homograph_tag,lemma_script,lemma_stripped,transliteration,primary_pos,primary_lexeme_id')
    .eq('language', 'grc')
    .gt('id', lastId)
    .order('id', { ascending: true })
    .limit(1000);
  if (!data || data.length === 0) break;
  greekLemmas.push(...data);
  lastId = data[data.length - 1].id;
  if (data.length < 1000) break;
}
console.log(`Loaded ${greekLemmas.length} Greek lemmas.`);

function stripDiacritics(str) {
  return str.normalize('NFKD').replace(/[\u0300-\u036F\u1DC0-\u1DFF]/g, '').trim().toLowerCase();
}

const greekByStripped = new Map();
const greekByBase = new Map();
for (const l of greekLemmas) {
  const s = stripDiacritics(l.lemma_script.split(',')[0]);
  if (s && !greekByStripped.has(s)) greekByStripped.set(s, l);
  const arr = greekByBase.get(l.base_strongs) || [];
  arr.push(l);
  greekByBase.set(l.base_strongs, arr);
}

const tbesgRaw = fs.readFileSync('.artifacts/stepbible/TBESG.txt', 'utf8');
const greekCandidates = [];
const quarantinedGreek = [];

for (const line of tbesgRaw.split(/\r?\n/)) {
  const c = line.split('\t');
  if (!/^G\d{4,5}[a-zA-Z]*$/.test(c[0]) || c.length < 8) continue;
  const estrong = c[0];
  const dstrong = c[1]?.trim().split(/[\s=]/)[0];
  const rawHtml = c[7]?.trim() || '';
  if (!rawHtml) continue;

  const derivMatch = rawHtml.match(/<BR\s*\/?>\s*\(([^()<>]{2,100})\)/i);
  if (!derivMatch) continue;
  const inside = derivMatch[1].trim();
  const tokens = inside.match(/[\u0370-\u03FF\u1F00-\u1FFF]{2,}/g) || [];
  if (tokens.length < 2) continue;

  const baseStrongs = estrong.replace(/^G0*/, 'G');
  const hosts = greekByBase.get(baseStrongs) || [];
  if (hosts.length === 0) {
    quarantinedGreek.push({ estrong, reason: 'host_not_found', tokens });
    continue;
  }
  const hostLemma = hosts[0];

  const comps = [];
  let allFound = true;
  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    const targetComp = greekByStripped.get(stripDiacritics(t));
    if (!targetComp) {
      allFound = false;
      break;
    }
    comps.push({
      order: idx + 1,
      lemma: targetComp,
      surface: targetComp.lemma_script,
      role: (targetComp.primary_pos || '').startsWith('V') ? 'verbal_element' : 'nominal_element',
      semanticContribution: targetComp.transliteration,
    });
  }

  if (allFound && comps.length >= 2) {
    greekCandidates.push({
      hostLemma,
      strongsId: baseStrongs,
      formationType: 'compound',
      wholeGloss: c[6]?.trim() || null,
      evidenceNote: `Abbott-Smith documented Greek compound (${inside}) under ${dstrong}`,
      sourceTitle: `Abbott-Smith Manual Greek Lexicon (TBESG CC BY 4.0): ${dstrong}`,
      sourceUrl: `https://github.com/STEPBible/STEPBible-Data/blob/master/TBESG.txt#${dstrong}`,
      components: comps,
    });
  } else {
    quarantinedGreek.push({ estrong, reason: 'unmatched_greek_components', tokens });
  }
}

console.log(`Mapped ${greekCandidates.length} Greek compound formations!`);
console.log(`Quarantined Greek: ${quarantinedGreek.length}`);
console.log('Sample Greek candidate:', JSON.stringify(greekCandidates[0], null, 2));
