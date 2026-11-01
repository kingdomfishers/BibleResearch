// STEP Bible TSV parsing shared by the offline audit and import preparation.
export const BOOKS = 'Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng Isa Jer Lam Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col 1Th 2Th 1Ti 2Ti Tit Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev'.split(' ');
export const SOURCE_COMMIT = 'be4191f0082aeedddb0eff0c02c966292b2bd641';
export const SOURCE_FILES = [
  ...['TBESH', 'TBESG'].map(name => ({ name, path: `Lexicons/${name} - Translators Brief lexicon of Extended Strongs for ${name === 'TBESH' ? 'Hebrew' : 'Greek'} - STEPBible.org CC BY.txt` })),
  ...['Gen-Deu', 'Jos-Est', 'Job-Sng', 'Isa-Mal'].map(part => ({ name: `TAHOT ${part}`, path: `Translators Amalgamated OT+NT/TAHOT ${part} - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt` })),
  ...['Mat-Jhn', 'Act-Rev'].map(part => ({ name: `TAGNT ${part}`, path: `Translators Amalgamated OT+NT/TAGNT ${part} - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt` })),
];
export const sourceUrl = path => `https://raw.githubusercontent.com/STEPBible/STEPBible-Data/${SOURCE_COMMIT}/${path.split('/').map(encodeURIComponent).join('/')}`;
export const plain = value => value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
export const strong = root => {
  const match = root.match(/^([HG])(\d+)/);
  if (!match) throw new Error(`Unrecognized Strong tag: ${root}`);
  return match[1] + Number(match[2]);
};
export function parseLexicon(text, language) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t');
    if (!new RegExp(`^${language}\\d{4,5}[a-zA-Z]*$`).test(c[0]) || c.length < 8) continue;
    const dstrong = c[1].match(/^[HG]\d+[A-Za-z]*/)?.[0];
    const entry = { root: dstrong || c[0], original: c[3], transliteration: c[4], grammar: c[5], gloss: plain(c[6]), definition: language === 'H' ? plain(c[6]) : plain(c[7]) };
    if (dstrong) entries.set(dstrong, entry);
    if (!entries.has(c[0])) entries.set(c[0], entry);
    const base = c[0].match(/^[HG]\d+/)[0];
    if (!entries.has(base)) entries.set(base, entry);
  }
  return entries;
}
export function parseText(text, name, edition = 'NA28') {
  const tokens = [];
  const hebrew = name.startsWith('TAHOT');
  let lineNumber = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNumber++;
    const c = line.split('\t');
    const ref = c[0].match(/^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+).*#([^=]+)=(.*)$/);
    if (!ref) continue;
    const book = BOOKS.indexOf(ref[1]) + 1;
    if (!book) throw new Error(`Unknown book ${ref[1]}`);
    if (hebrew && !c[1].trim()) continue; // Qere can explicitly omit a Ketiv word.
    // Primary TAHOT rows include Qere/restorations; variants live in separate columns.
    // For Greek, select one edition to avoid concatenating alternative readings.
    if (!hebrew && !c[5].split(/[+\s;,]+/).includes(edition)) continue;
    const root = hebrew ? (c[4].match(/\{(H\d+[A-Za-z]*)/)?.[1] || c[4].match(/H\d+[A-Za-z]*/)?.[0]) : c[3].match(/G\d+[A-Za-z]*/)?.[0];
    const greek = !hebrew && c[1].match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!root || (!hebrew && !greek)) throw new Error(`Invalid token at ${name}:${lineNumber}: ${c[0]}`);
    const original = hebrew ? c[1].replace(/[\/\\]/g, '') : greek[1].trim();
    const transliteration = hebrew ? c[2].replace(/\//g, '') : greek[2];
    const grammar = hebrew ? c[5] : c[3].split('=').at(-1);
    if (!original || !transliteration || grammar.length > 30) throw new Error(`Invalid word fields at ${c[0]}`);
    tokens.push({ book, chapter: Number(ref[2]), verse: Number(ref[3]), position: ref[4], lineNumber, root, original, transliteration, grammar, translation: plain(hebrew ? c[3] : c[2]), source: name, sourceRef: c[0] });
  }
  return tokens;
}
export const wordKey = t => [t.root, t.original, t.grammar, t.transliteration].join('\t');
