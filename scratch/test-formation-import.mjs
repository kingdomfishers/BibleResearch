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

// Fetch all lemmas
const lemmas = [];
let lastId = 0;
while (true) {
  const { data, error } = await supabase
    .from('lemmas')
    .select('id,lemma_key,language,base_strongs,homograph_tag,lemma_script,lemma_stripped,transliteration,primary_pos,primary_lexeme_id')
    .gt('id', lastId)
    .order('id', { ascending: true })
    .limit(1000);
  if (error) throw error;
  if (!data || data.length === 0) break;
  lemmas.push(...data);
  lastId = data[data.length - 1].id;
  if (data.length < 1000) break;
}
console.log(`Loaded ${lemmas.length} lemmas.`);

const lemmasByBase = new Map();
const lemmaById = new Map();
const lemmaByKey = new Map();
for (const l of lemmas) {
  lemmaById.set(l.id, l);
  lemmaByKey.set(l.lemma_key.toLowerCase(), l);
  const arr = lemmasByBase.get(l.base_strongs) || [];
  arr.push(l);
  lemmasByBase.set(l.base_strongs, arr);
}

// Read HebrewStrong.xml
const hs = fs.readFileSync('.artifacts/sources/HebrewLexicon/HebrewStrong.xml', 'utf8');
const entryRe = /<entry id="([^"]+)">([\s\S]*?)<\/entry>/g;

const candidates = [];
const quarantined = [];

let m;
while ((m = entryRe.exec(hs)) !== null) {
  const strongsId = m[1]; // e.g. H7501
  const body = m[2];
  const sourceM = body.match(/<source>([\s\S]*?)<\/source>/);
  if (!sourceM) continue;
  const src = sourceM[1];
  const refs = [...src.matchAll(/<w src="([^"]+)">([^<]+)<\/w>/g)].map(x => ({ src: x[1], text: x[2] }));
  if (refs.length < 2 || !/\band\b/i.test(src)) continue;

  const wMatch = body.match(/<w pos="([^"]*)"[^>]*>([^<]+)<\/w>/);
  const pos = wMatch ? wMatch[1] : '';
  const surface = wMatch ? wMatch[2] : '';
  const defM = src.match(/<def>([^<]+)<\/def>/);
  const wholeGloss = defM ? defM[1] : null;

  const hosts = lemmasByBase.get(strongsId) || [];
  if (hosts.length === 0) {
    quarantined.push({
      strongsId,
      reason: 'host_lemma_not_found',
      refs,
    });
    continue;
  }

  // Resolve host: if 1 lemma, perfect. If multiple: check if there is an exact base without homograph tag or check pos
  let hostLemma = null;
  if (hosts.length === 1) {
    hostLemma = hosts[0];
  } else {
    // Check if one has homograph_tag = null or 'G' (primary in STEP)
    const primaryHost = hosts.find(h => h.homograph_tag === null || h.homograph_tag === 'G');
    // If hosts are identical proper names (same pos, same script, just separate person entities H0022G, H0022H),
    // we can either map to the primary or quarantine if ambiguous
    if (primaryHost && hosts.filter(h => h.homograph_tag === null || h.homograph_tag === 'G').length === 1) {
      hostLemma = primaryHost;
    } else {
      quarantined.push({
        strongsId,
        reason: 'ambiguous_homograph_host_mapping',
        candidates: hosts.map(h => h.lemma_key),
      });
      continue;
    }
  }

  // Resolve components
  const resolvedComps = [];
  let compError = null;

  for (let idx = 0; idx < refs.length; idx++) {
    const ref = refs[idx];
    const compLemmas = lemmasByBase.get(ref.src) || [];
    if (compLemmas.length === 0) {
      compError = `component_not_found:${ref.src}`;
      break;
    }

    let targetComp = null;
    if (compLemmas.length === 1) {
      targetComp = compLemmas[0];
    } else if (ref.src === 'H410') {
      targetComp = compLemmas.find(l => l.lemma_key === 'lemma:H0410G') || compLemmas[0];
    } else if (ref.src === 'H3050') {
      targetComp = compLemmas.find(l => l.lemma_key === 'lemma:H3050') || compLemmas[0];
    } else if (ref.src === 'H3068') {
      targetComp = compLemmas.find(l => l.lemma_key === 'lemma:H3068') || compLemmas[0];
    } else {
      // Find primary ('G' or null)
      const primary = compLemmas.find(l => l.homograph_tag === null || l.homograph_tag === 'G');
      if (primary && compLemmas.filter(l => l.homograph_tag === null || l.homograph_tag === 'G').length === 1) {
        targetComp = primary;
      } else {
        compError = `ambiguous_component:${ref.src}`;
        break;
      }
    }

    // Determine role
    let role = 'other';
    const cPos = (targetComp.primary_pos || '').toLowerCase();
    if (ref.src === 'H410' || ref.src === 'H3050' || ref.src === 'H3068' || ref.src === 'H7706') {
      role = 'divine_name_element';
    } else if (cPos.startsWith('v') || cPos.includes(':v')) {
      role = 'verbal_element';
    } else if (cPos.startsWith('n') || cPos.includes(':n') || cPos.startsWith('a') || cPos.includes(':a')) {
      role = 'nominal_element';
    }

    resolvedComps.push({
      order: idx + 1,
      lemma: targetComp,
      surface: targetComp.lemma_stripped || targetComp.lemma_script,
      role,
      semanticContribution: targetComp.transliteration,
    });
  }

  if (compError) {
    quarantined.push({
      strongsId,
      reason: compError,
      refs,
    });
    continue;
  }

  const isTheophoric = resolvedComps.some(c => c.role === 'divine_name_element');
  candidates.push({
    hostLemma,
    strongsId,
    formationType: isTheophoric ? 'theophoric_name' : 'compound',
    wholeGloss,
    evidenceNote: `OpenScriptures HebrewStrong ${strongsId} explicitly identifies components: ${src.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}`,
    sourceTitle: `OpenScriptures HebrewStrong: ${strongsId}`,
    sourceUrl: `https://github.com/openscriptures/HebrewLexicon/blob/master/HebrewStrong.xml#${strongsId}`,
    components: resolvedComps,
  });
}

console.log(`Successfully mapped ${candidates.length} compounds!`);
console.log(`Quarantined: ${quarantined.length}`);
console.log('Sample candidate:', JSON.stringify(candidates[0], null, 2));
console.log('Sample H7501:', candidates.find(c => c.strongsId === 'H7501'));
