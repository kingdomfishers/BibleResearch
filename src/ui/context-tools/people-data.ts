// @file: src/ui/context-tools/people-data.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: imports | types | data:people | data:relationships | logic:lookup | logic:neighborhood

// === @section:imports ===
import type { ActivePassage } from '../../api/types';

// === @section:types ===
export type LineageGroup =
  | 'creation_nations'
  | 'patriarchs'
  | 'exodus_priests'
  | 'davidic'
  | 'kings_prophets'
  | 'gospels_apostles';

export type RelationshipKind =
  | 'father'
  | 'mother'
  | 'spouse'
  | 'sibling'
  | 'mentor_disciple'
  | 'covenant_friend'
  | 'successor'
  | 'adversary';

export interface BiblicalPerson {
  id: string;
  name: string;
  disambiguator?: string;
  hebrew?: string;
  greek?: string;
  transliteration?: string;
  strongs?: string[];
  sex?: string;
  tribe?: string;
  era: string;
  lineageGroup: LineageGroup;
  summary: string;
  keyRefs: { label: string; passage: ActivePassage }[];
  homonymGroup?: string;
  competingGenealogyNote?: string;
}

export interface PersonRelationship {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipKind;
  category?: 'explicit' | 'inferred';
  typeLabel?: string;
  witnessRef: { label: string; passage: ActivePassage };
  note?: string;
  competingModel?: string;
}

export interface PeopleGraphStats {
  peopleCount: number;
  relationshipCount: number;
  explicitEdges: number;
  inferredEdges: number;
  loaded: boolean;
}

export interface FamilyNeighborhood {
  focus: BiblicalPerson;
  parents: { person: BiblicalPerson; edge: PersonRelationship }[];
  grandparents: { person: BiblicalPerson; via: string; edge: PersonRelationship }[];
  spouses: { person: BiblicalPerson; edge: PersonRelationship }[];
  siblings: { person: BiblicalPerson; edge: PersonRelationship }[];
  children: { person: BiblicalPerson; edge: PersonRelationship }[];
  grandchildren: { person: BiblicalPerson; via: string; edge: PersonRelationship }[];
  socialLinks: { person: BiblicalPerson; edge: PersonRelationship; roleText: string }[];
  nodeCount: number;
  truncated: boolean;
}

/**
 * Edge direction convention (strictly enforced across PERSON_RELATIONSHIPS):
 * - Parent edges (`father`, `mother`): `fromId` = parent, `toId` = child.
 *   (Parents of X are incoming edges where `toId === X`; children of X are outgoing edges where `fromId === X`.)
 * - Symmetric edges (`spouse`, `sibling`, `covenant_friend`): undirected in semantics;
 *   matched in both directions (`fromId === X` or `toId === X`).
 * - Asymmetric relational edges:
 *   - `mentor_disciple`: `fromId` = mentor/teacher, `toId` = disciple/student.
 *   - `successor`: `fromId` = predecessor, `toId` = successor.
 */

const ref = (label: string, book: number, chapter: number, verse: number): { label: string; passage: ActivePassage } => ({
  label,
  passage: { book, chapter, verse },
});

const TABLE_OF_NATIONS_NOTE =
  'Genesis 10 Table of Nations frames peoples and eponyms in a kinship/household idiom (father/son/brother); these textual genealogies must not be equated directly with modern archaeological ethnography or fixed GPS nation-state boundaries.';

// === @section:data:people ===
export const BIBLICAL_PEOPLE: readonly BiblicalPerson[] = [
  // --- Creation & Table of Nations (13) ---
  {
    id: 'adam',
    name: 'Adam',
    hebrew: 'אָדָם',
    transliteration: 'ʾĀḏām',
    strongs: ['H120', 'H121'],
    era: 'Primeval',
    lineageGroup: 'creation_nations',
    summary: 'First human formed from the dust of the ground; husband of Eve and father of Cain, Abel, and Seth.',
    keyRefs: [ref('Gen 2:7', 1, 2, 7), ref('Gen 5:1', 1, 5, 1), ref('Luke 3:38', 42, 3, 38)],
  },
  {
    id: 'eve',
    name: 'Eve',
    hebrew: 'חַוָּה',
    transliteration: 'Ḥawwāh',
    strongs: ['H2332'],
    era: 'Primeval',
    lineageGroup: 'creation_nations',
    summary: 'First woman and mother of all living; wife of Adam and mother of Cain, Abel, and Seth.',
    keyRefs: [ref('Gen 3:20', 1, 3, 20), ref('Gen 4:1', 1, 4, 1), ref('Gen 4:25', 1, 4, 25)],
  },
  {
    id: 'cain',
    name: 'Cain',
    hebrew: 'קַיִן',
    transliteration: 'Qayin',
    strongs: ['H7014'],
    era: 'Primeval',
    lineageGroup: 'creation_nations',
    summary: 'Firstborn son of Adam and Eve; tiller of the ground who slew his brother Abel.',
    keyRefs: [ref('Gen 4:1', 1, 4, 1), ref('Gen 4:8', 1, 4, 8), ref('Gen 4:17', 1, 4, 17)],
  },
  {
    id: 'abel',
    name: 'Abel',
    hebrew: 'הֶבֶל',
    transliteration: 'Heḇel',
    strongs: ['H1893'],
    era: 'Primeval',
    lineageGroup: 'creation_nations',
    summary: 'Second son of Adam and Eve; keeper of sheep whose offering was regarded by the LORD.',
    keyRefs: [ref('Gen 4:2', 1, 4, 2), ref('Gen 4:4', 1, 4, 4), ref('Heb 11:4', 58, 11, 4)],
  },
  {
    id: 'seth',
    name: 'Seth',
    hebrew: 'שֵׁת',
    transliteration: 'Šēṯ',
    strongs: ['H8352'],
    era: 'Primeval',
    lineageGroup: 'creation_nations',
    summary: 'Third named son of Adam and Eve, appointed after Abel; ancestor of the Genesis 5 line to Noah.',
    keyRefs: [ref('Gen 4:25', 1, 4, 25), ref('Gen 5:3', 1, 5, 3), ref('Luke 3:38', 42, 3, 38)],
  },
  {
    id: 'noah',
    name: 'Noah',
    hebrew: 'נֹחַ',
    transliteration: 'Nōaḥ',
    strongs: ['H5146'],
    era: 'Flood & Post-Flood',
    lineageGroup: 'creation_nations',
    summary: 'Tenth-generation descendant of Seth via Lamech; builder of the ark and father of Shem, Ham, and Japheth.',
    keyRefs: [ref('Gen 5:29', 1, 5, 29), ref('Gen 6:9', 1, 6, 9), ref('Gen 9:18', 1, 9, 18)],
  },
  {
    id: 'shem',
    name: 'Shem',
    hebrew: 'שֵׁם',
    transliteration: 'Šēm',
    strongs: ['H8035'],
    era: 'Post-Flood / Nations',
    lineageGroup: 'creation_nations',
    summary: 'Son of Noah; placed in Genesis 10–11 as ancestor of Arpachshad, Eber, and the line leading to Terah.',
    keyRefs: [ref('Gen 5:32', 1, 5, 32), ref('Gen 10:21', 1, 10, 21), ref('Gen 11:10', 1, 11, 10)],
    competingGenealogyNote: TABLE_OF_NATIONS_NOTE,
  },
  {
    id: 'ham',
    name: 'Ham',
    hebrew: 'חָם',
    transliteration: 'Ḥām',
    strongs: ['H2526'],
    era: 'Post-Flood / Nations',
    lineageGroup: 'creation_nations',
    summary: 'Son of Noah; father of Cush, Mizraim, Put, and Canaan in the Genesis 10 Table of Nations.',
    keyRefs: [ref('Gen 5:32', 1, 5, 32), ref('Gen 9:18', 1, 9, 18), ref('Gen 10:6', 1, 10, 6)],
    competingGenealogyNote: TABLE_OF_NATIONS_NOTE,
  },
  {
    id: 'japheth',
    name: 'Japheth',
    hebrew: 'יֶפֶת',
    transliteration: 'Yep̄eṯ',
    strongs: ['H3315'],
    era: 'Post-Flood / Nations',
    lineageGroup: 'creation_nations',
    summary: 'Son of Noah; associated in Genesis 10:2–5 with northern and coastland peoples.',
    keyRefs: [ref('Gen 5:32', 1, 5, 32), ref('Gen 9:27', 1, 9, 27), ref('Gen 10:2', 1, 10, 2)],
    competingGenealogyNote: TABLE_OF_NATIONS_NOTE,
  },
  {
    id: 'cush',
    name: 'Cush',
    hebrew: 'כּוּשׁ',
    transliteration: 'Kūš',
    strongs: ['H3568'],
    era: 'Table of Nations',
    lineageGroup: 'creation_nations',
    summary: 'Listed as firstborn of Ham in Genesis 10:6 and father of Nimrod in Genesis 10:8.',
    keyRefs: [ref('Gen 10:6', 1, 10, 6), ref('Gen 10:8', 1, 10, 8), ref('1 Chr 1:8', 13, 1, 8)],
    competingGenealogyNote: TABLE_OF_NATIONS_NOTE,
  },
  {
    id: 'mizraim',
    name: 'Mizraim',
    hebrew: 'מִצְרַיִם',
    transliteration: 'Miṣrayim',
    strongs: ['H4714'],
    era: 'Table of Nations',
    lineageGroup: 'creation_nations',
    summary: 'Listed as a son of Ham in Genesis 10:6; the Hebrew dual form also serves as the common name for Egypt.',
    keyRefs: [ref('Gen 10:6', 1, 10, 6), ref('Gen 10:13', 1, 10, 13), ref('1 Chr 1:11', 13, 1, 11)],
    competingGenealogyNote: `${TABLE_OF_NATIONS_NOTE} Note also the grammatical dual suffix (-ayim) functioning as a collective/eponymous designation.`,
  },
  {
    id: 'canaan',
    name: 'Canaan',
    hebrew: 'כְּנַעַן',
    transliteration: 'Kənaʿan',
    strongs: ['H3667'],
    era: 'Table of Nations',
    lineageGroup: 'creation_nations',
    summary: 'Son of Ham in Genesis 9:18 and 10:6; eponymous ancestor of Sidon, Heth, and Levantine peoples in Genesis 10:15–19.',
    keyRefs: [ref('Gen 9:18', 1, 9, 18), ref('Gen 10:6', 1, 10, 6), ref('Gen 10:15', 1, 10, 15)],
    competingGenealogyNote: TABLE_OF_NATIONS_NOTE,
  },
  {
    id: 'eber',
    name: 'Eber',
    hebrew: 'עֵבֶר',
    transliteration: 'ʿĒḇer',
    strongs: ['H5677'],
    era: 'Table of Nations',
    lineageGroup: 'creation_nations',
    summary: 'Great-grandson of Shem via Arpachshad and Shelah; father of Peleg and Joktan, bridging Shem to Abraham.',
    keyRefs: [ref('Gen 10:21', 1, 10, 21), ref('Gen 10:24', 1, 10, 24), ref('Gen 11:14', 1, 11, 14)],
    competingGenealogyNote: `${TABLE_OF_NATIONS_NOTE} Genesis 10:21 calls Shem "father of all the children of Eber," while Gen 10:24 and 11:10–16 trace two intermediate generations (Arpachshad -> Shelah -> Eber).`,
  },

  // --- Patriarchs (23) ---
  {
    id: 'terah',
    name: 'Terah',
    hebrew: 'תֶּרַח',
    transliteration: 'Teraḥ',
    strongs: ['H8646'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Father of Abram (Abraham), Nahor, and Haran; departed Ur of the Chaldeans and settled in Haran.',
    keyRefs: [ref('Gen 11:24', 1, 11, 24), ref('Gen 11:26', 1, 11, 26), ref('Gen 11:31', 1, 11, 31)],
  },
  {
    id: 'abraham',
    name: 'Abraham (Abram)',
    hebrew: 'אַבְרָהָם',
    transliteration: 'ʾAḇrāhām',
    strongs: ['H85', 'H87'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Son of Terah, called from Ur/Haran to Canaan; covenant patriarch and father of Ishmael and Isaac.',
    keyRefs: [ref('Gen 11:26', 1, 11, 26), ref('Gen 12:1', 1, 12, 1), ref('Gen 17:5', 1, 17, 5)],
  },
  {
    id: 'sarah',
    name: 'Sarah (Sarai)',
    hebrew: 'שָׂרָה',
    transliteration: 'Śārāh',
    strongs: ['H8283', 'H8297'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Wife of Abraham and mother of Isaac; renamed from Sarai in Genesis 17:15.',
    keyRefs: [ref('Gen 11:29', 1, 11, 29), ref('Gen 17:15', 1, 17, 15), ref('Gen 21:3', 1, 21, 3)],
    competingGenealogyNote: 'Genesis 20:12 records Abraham stating Sarah is the daughter of his father Terah by another mother; Genesis 11:29 introduces her as Abram’s wife without naming her parents directly.',
  },
  {
    id: 'hagar',
    name: 'Hagar',
    hebrew: 'הָגָר',
    transliteration: 'Hāḡār',
    strongs: ['H1904'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Egyptian servant of Sarah given to Abram as a wife; mother of Ishmael.',
    keyRefs: [ref('Gen 16:1', 1, 16, 1), ref('Gen 16:15', 1, 16, 15), ref('Gen 21:14', 1, 21, 14)],
  },
  {
    id: 'nahor',
    name: 'Nahor',
    disambiguator: 'Son of Terah, brother of Abraham',
    hebrew: 'נָחוֹר',
    transliteration: 'Nāḥōr',
    strongs: ['H5152'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Brother of Abraham and Haran; paternal grandfather of Rebekah via Bethuel.',
    keyRefs: [ref('Gen 11:26', 1, 11, 26), ref('Gen 22:20', 1, 22, 20), ref('Gen 24:15', 1, 24, 15)],
    competingGenealogyNote: 'Distinguished in Genesis 11 from his paternal grandfather Nahor (son of Serug, Gen 11:22–24).',
  },
  {
    id: 'lot',
    name: 'Lot',
    hebrew: 'לוֹט',
    transliteration: 'Lōṭ',
    strongs: ['H3876'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Son of Abraham’s brother Haran; journeyed with Abram from Ur and Haran to Canaan and settled near Sodom.',
    keyRefs: [ref('Gen 11:27', 1, 11, 27), ref('Gen 13:8', 1, 13, 8), ref('Gen 19:1', 1, 19, 1)],
  },
  {
    id: 'ishmael',
    name: 'Ishmael',
    hebrew: 'יִשְׁמָעֵאל',
    transliteration: 'Yišmāʿēʾl',
    strongs: ['H3458'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Firstborn son of Abraham through Hagar; half-brother of Isaac and father of twelve princes.',
    keyRefs: [ref('Gen 16:15', 1, 16, 15), ref('Gen 21:9', 1, 21, 9), ref('Gen 25:12', 1, 25, 12)],
  },
  {
    id: 'isaac',
    name: 'Isaac',
    hebrew: 'יִצְחָק',
    transliteration: 'Yiṣḥāq',
    strongs: ['H3327'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Son of Abraham and Sarah; husband of Rebekah and father of twins Esau and Jacob.',
    keyRefs: [ref('Gen 21:3', 1, 21, 3), ref('Gen 24:67', 1, 24, 67), ref('Gen 25:19', 1, 25, 19)],
  },
  {
    id: 'rebekah',
    name: 'Rebekah',
    hebrew: 'רִבְקָה',
    transliteration: 'Riḇqāh',
    strongs: ['H7259'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Daughter of Bethuel (son of Nahor), sister of Laban; wife of Isaac and mother of Esau and Jacob.',
    keyRefs: [ref('Gen 24:15', 1, 24, 15), ref('Gen 24:67', 1, 24, 67), ref('Gen 25:21', 1, 25, 21)],
  },
  {
    id: 'esau',
    name: 'Esau',
    hebrew: 'עֵשָׂו',
    transliteration: 'ʿĒśāw',
    strongs: ['H6215'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Firstborn twin son of Isaac and Rebekah; twin brother of Jacob and ancestor of Edom.',
    keyRefs: [ref('Gen 25:25', 1, 25, 25), ref('Gen 25:30', 1, 25, 30), ref('Gen 36:1', 1, 36, 1)],
  },
  {
    id: 'jacob',
    name: 'Jacob (Israel)',
    hebrew: 'יַעֲקֹב',
    transliteration: 'Yaʿăqōḇ',
    strongs: ['H3290', 'G2384', 'H3478', 'G2474'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Son of Isaac and Rebekah; renamed Israel, husband of Leah and Rachel, and father of the twelve tribes.',
    keyRefs: [ref('Gen 25:26', 1, 25, 26), ref('Gen 32:28', 1, 32, 28), ref('Gen 35:22', 1, 35, 22)],
  },
  {
    id: 'leah',
    name: 'Leah',
    hebrew: 'לֵאָה',
    transliteration: 'Lēʾāh',
    strongs: ['H3812'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Elder daughter of Laban and sister of Rachel; first wife of Jacob and mother of Reuben, Simeon, Levi, Judah, Issachar, Zebulun, and Dinah.',
    keyRefs: [ref('Gen 29:16', 1, 29, 16), ref('Gen 29:23', 1, 29, 23), ref('Gen 29:32', 1, 29, 32)],
  },
  {
    id: 'rachel',
    name: 'Rachel',
    hebrew: 'רָחֵל',
    transliteration: 'Rāḥēl',
    strongs: ['H7354'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Younger daughter of Laban and sister of Leah; wife of Jacob and mother of Joseph and Benjamin.',
    keyRefs: [ref('Gen 29:16', 1, 29, 16), ref('Gen 30:22', 1, 30, 22), ref('Gen 35:18', 1, 35, 18)],
  },
  {
    id: 'reuben',
    name: 'Reuben',
    hebrew: 'רְאוּבֵן',
    transliteration: 'Rəʾūḇēn',
    strongs: ['H7205'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Firstborn son of Jacob and Leah.',
    keyRefs: [ref('Gen 29:32', 1, 29, 32), ref('Gen 37:21', 1, 37, 21), ref('Gen 49:3', 1, 49, 3)],
  },
  {
    id: 'levi',
    name: 'Levi',
    hebrew: 'לֵוִי',
    transliteration: 'Lēwî',
    strongs: ['H3878'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Third son of Jacob and Leah; ancestor of the Levitical and Aaronic priesthood via Kohath and Jochebed.',
    keyRefs: [ref('Gen 29:34', 1, 29, 34), ref('Exod 6:16', 2, 6, 16), ref('Num 26:59', 4, 26, 59)],
  },
  {
    id: 'judah',
    name: 'Judah',
    hebrew: 'יְהוּדָה',
    transliteration: 'Yəhūḏāh',
    strongs: ['H3063'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Fourth son of Jacob and Leah; father of Perez by Tamar and royal ancestor of the Davidic tribe.',
    keyRefs: [ref('Gen 29:35', 1, 29, 35), ref('Gen 38:29', 1, 38, 29), ref('Gen 49:8', 1, 49, 8)],
  },
  {
    id: 'joseph_ot',
    name: 'Joseph',
    disambiguator: 'Son of Jacob & Rachel (OT)',
    hebrew: 'יוֹסֵף',
    transliteration: 'Yôsēp̄',
    strongs: ['H3130'],
    era: 'Patriarchal / Egypt',
    lineageGroup: 'patriarchs',
    homonymGroup: 'joseph',
    summary: 'Firstborn son of Jacob and Rachel; sold into Egypt, elevated under Pharaoh, husband of Asenath, and father of Manasseh and Ephraim.',
    keyRefs: [ref('Gen 30:24', 1, 30, 24), ref('Gen 41:45', 1, 41, 45), ref('Gen 50:20', 1, 50, 20)],
  },
  {
    id: 'benjamin',
    name: 'Benjamin',
    hebrew: 'בִּנְיָמִין',
    transliteration: 'Binyāmîn',
    strongs: ['H1144'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Youngest son of Jacob and second son of Rachel; full brother of Joseph.',
    keyRefs: [ref('Gen 35:18', 1, 35, 18), ref('Gen 43:29', 1, 43, 29), ref('Gen 49:27', 1, 49, 27)],
  },
  {
    id: 'tamar',
    name: 'Tamar',
    disambiguator: 'Daughter-in-law of Judah (Gen 38)',
    hebrew: 'תָּמָר',
    transliteration: 'Tāmār',
    strongs: ['H8559'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Widow of Judah’s sons Er and Onan; mother of Perez and Zerah by Judah, named in Matthew’s genealogy.',
    keyRefs: [ref('Gen 38:6', 1, 38, 6), ref('Gen 38:29', 1, 38, 29), ref('Matt 1:3', 40, 1, 3)],
  },
  {
    id: 'perez',
    name: 'Perez',
    hebrew: 'פֶּרֶץ',
    transliteration: 'Pereṣ',
    strongs: ['H6557'],
    era: 'Patriarchal',
    lineageGroup: 'patriarchs',
    summary: 'Twin son of Judah and Tamar; ancestor of Boaz and the Davidic line in Ruth 4:18–22 and Matthew 1:3.',
    keyRefs: [ref('Gen 38:29', 1, 38, 29), ref('Ruth 4:18', 8, 4, 18), ref('Matt 1:3', 40, 1, 3)],
  },
  {
    id: 'asenath',
    name: 'Asenath',
    hebrew: 'אָסְנַת',
    transliteration: 'ʾĀsənaṯ',
    strongs: ['H621'],
    era: 'Patriarchal / Egypt',
    lineageGroup: 'patriarchs',
    summary: 'Daughter of Potiphera priest of On; Egyptian wife of Joseph and mother of Manasseh and Ephraim.',
    keyRefs: [ref('Gen 41:45', 1, 41, 45), ref('Gen 41:50', 1, 41, 50), ref('Gen 46:20', 1, 46, 20)],
  },
  {
    id: 'ephraim',
    name: 'Ephraim',
    hebrew: 'אֶפְרַיִם',
    transliteration: 'ʾEp̄rayim',
    strongs: ['H669'],
    era: 'Patriarchal / Egypt',
    lineageGroup: 'patriarchs',
    summary: 'Younger son of Joseph and Asenath born in Egypt; received the primary right-hand blessing from Jacob.',
    keyRefs: [ref('Gen 41:52', 1, 41, 52), ref('Gen 48:14', 1, 48, 14), ref('Gen 48:20', 1, 48, 20)],
  },
  {
    id: 'manasseh',
    name: 'Manasseh',
    disambiguator: 'Son of Joseph & Asenath',
    hebrew: 'מְנַשֶּׁה',
    transliteration: 'Mənaššeh',
    strongs: ['H4519'],
    era: 'Patriarchal / Egypt',
    lineageGroup: 'patriarchs',
    summary: 'Firstborn son of Joseph and Asenath born in Egypt; adopted with Ephraim among Israel’s tribes.',
    keyRefs: [ref('Gen 41:51', 1, 41, 51), ref('Gen 48:1', 1, 48, 1), ref('Gen 48:5', 1, 48, 5)],
  },

  // --- Exodus & Priests (10) ---
  {
    id: 'amram',
    name: 'Amram',
    hebrew: 'עַמְרָם',
    transliteration: 'ʿAmrām',
    strongs: ['H6019'],
    era: 'Sojourn in Egypt',
    lineageGroup: 'exodus_priests',
    summary: 'Son of Kohath (grandson of Levi); husband of Jochebed and father of Miriam, Aaron, and Moses.',
    keyRefs: [ref('Exod 6:18', 2, 6, 18), ref('Exod 6:20', 2, 6, 20), ref('Num 26:59', 4, 26, 59)],
  },
  {
    id: 'jochebed',
    name: 'Jochebed',
    hebrew: 'יוֹכֶבֶד',
    transliteration: 'Yôḵeḇeḏ',
    strongs: ['H3115'],
    era: 'Sojourn in Egypt',
    lineageGroup: 'exodus_priests',
    summary: 'Daughter of Levi (born in Egypt, Num 26:59); wife of Amram and mother of Miriam, Aaron, and Moses.',
    keyRefs: [ref('Exod 6:20', 2, 6, 20), ref('Num 26:59', 4, 26, 59)],
    competingGenealogyNote: 'Exodus 6:20 calls Jochebed Amram’s father’s sister (aunt), while Numbers 26:59 describes her as a daughter of Levi born to Levi in Egypt; some interpreters read "daughter" in a broader clan sense across the Egyptian sojourn.',
  },
  {
    id: 'miriam',
    name: 'Miriam',
    hebrew: 'מִרְיָם',
    transliteration: 'Miryām',
    strongs: ['H4813'],
    era: 'Exodus & Wilderness',
    lineageGroup: 'exodus_priests',
    summary: 'Prophetess and sister of Aaron and Moses; led Israel’s song at the Sea of Reeds.',
    keyRefs: [ref('Exod 15:20', 2, 15, 20), ref('Num 26:59', 4, 26, 59), ref('Mic 6:4', 33, 6, 4)],
  },
  {
    id: 'aaron',
    name: 'Aaron',
    hebrew: 'אַהֲרֹן',
    transliteration: 'ʾAhărōn',
    strongs: ['H175'],
    era: 'Exodus & Wilderness',
    lineageGroup: 'exodus_priests',
    summary: 'Elder brother of Moses and Israel’s first High Priest; father of Eleazar and ancestor of the priestly line.',
    keyRefs: [ref('Exod 4:14', 2, 4, 14), ref('Exod 28:1', 2, 28, 1), ref('Num 20:26', 4, 20, 26)],
  },
  {
    id: 'moses',
    name: 'Moses',
    hebrew: 'מֹשֶׁה',
    transliteration: 'Mōšeh',
    strongs: ['H4872'],
    era: 'Exodus & Wilderness',
    lineageGroup: 'exodus_priests',
    summary: 'Son of Amram and Jochebed; prophet and deliverer of Israel from Egypt, husband of Zipporah, and mentor of Joshua.',
    keyRefs: [ref('Exod 2:10', 2, 2, 10), ref('Exod 33:11', 2, 33, 11), ref('Deut 34:5', 5, 34, 5)],
  },
  {
    id: 'zipporah',
    name: 'Zipporah',
    hebrew: 'צִפֹּרָה',
    transliteration: 'Ṣippōrāh',
    strongs: ['H6855'],
    era: 'Exodus & Wilderness',
    lineageGroup: 'exodus_priests',
    summary: 'Daughter of Reuel/Jethro priest of Midian; wife of Moses and mother of Gershom and Eliezer.',
    keyRefs: [ref('Exod 2:21', 2, 2, 21), ref('Exod 4:25', 2, 4, 25), ref('Exod 18:2', 2, 18, 2)],
  },
  {
    id: 'eleazar',
    name: 'Eleazar',
    disambiguator: 'Son of Aaron, High Priest',
    hebrew: 'אֶלְעָזָר',
    transliteration: 'ʾElʿāzār',
    strongs: ['H499'],
    era: 'Wilderness & Conquest',
    lineageGroup: 'exodus_priests',
    summary: 'Third son of Aaron; succeeded Aaron as High Priest at Mount Hor and served alongside Joshua.',
    keyRefs: [ref('Exod 6:23', 2, 6, 23), ref('Num 20:28', 4, 20, 28), ref('Josh 14:1', 6, 14, 1)],
  },
  {
    id: 'phinehas',
    name: 'Phinehas',
    disambiguator: 'Son of Eleazar, Priest',
    hebrew: 'פִּינְחָס',
    transliteration: 'Pînəḥās',
    strongs: ['H6372'],
    era: 'Wilderness & Conquest',
    lineageGroup: 'exodus_priests',
    summary: 'Son of Eleazar and grandson of Aaron; granted a covenant of perpetual priesthood in Numbers 25.',
    keyRefs: [ref('Exod 6:25', 2, 6, 25), ref('Num 25:7', 4, 25, 7), ref('Num 25:11', 4, 25, 11)],
  },
  {
    id: 'joshua',
    name: 'Joshua',
    hebrew: 'יְהוֹשֻׁעַ',
    transliteration: 'Yəhôšūaʿ',
    strongs: ['H3091'],
    era: 'Wilderness & Conquest',
    lineageGroup: 'exodus_priests',
    summary: 'Son of Nun of Ephraim; aide/disciple to Moses and his commissioned successor leading Israel into Canaan.',
    keyRefs: [ref('Exod 24:13', 2, 24, 13), ref('Deut 34:9', 5, 34, 9), ref('Josh 1:1', 6, 1, 1)],
  },
  {
    id: 'caleb',
    name: 'Caleb',
    hebrew: 'כָּלֵב',
    transliteration: 'Kālēḇ',
    strongs: ['H3612'],
    era: 'Wilderness & Conquest',
    lineageGroup: 'exodus_priests',
    summary: 'Son of Jephunneh of Judah; stood alongside Joshua in trusting the LORD during the spy report and inherited Hebron.',
    keyRefs: [ref('Num 13:6', 4, 13, 6), ref('Num 14:6', 4, 14, 6), ref('Josh 14:14', 6, 14, 14)],
  },

  // --- Davidic Line & Monarchy (14) ---
  {
    id: 'boaz',
    name: 'Boaz',
    hebrew: 'בֹּעַז',
    transliteration: 'Bōʿaz',
    strongs: ['H1162'],
    era: 'Judges',
    lineageGroup: 'davidic',
    summary: 'Kinsman-redeemer of Bethlehem in Judah; husband of Ruth and father of Obed.',
    keyRefs: [ref('Ruth 2:1', 8, 2, 1), ref('Ruth 4:13', 8, 4, 13), ref('Ruth 4:21', 8, 4, 21)],
  },
  {
    id: 'ruth',
    name: 'Ruth',
    hebrew: 'רוּת',
    transliteration: 'Rūṯ',
    strongs: ['H7327'],
    era: 'Judges',
    lineageGroup: 'davidic',
    summary: 'Moabite widow who clave to Naomi and Israel’s God; wife of Boaz and great-grandmother of David.',
    keyRefs: [ref('Ruth 1:16', 8, 1, 16), ref('Ruth 4:13', 8, 4, 13), ref('Matt 1:5', 40, 1, 5)],
  },
  {
    id: 'obed',
    name: 'Obed',
    hebrew: 'עוֹבֵד',
    transliteration: 'ʿÔḇēḏ',
    strongs: ['H5744'],
    era: 'Judges',
    lineageGroup: 'davidic',
    summary: 'Son of Boaz and Ruth; father of Jesse and grandfather of King David.',
    keyRefs: [ref('Ruth 4:17', 8, 4, 17), ref('Ruth 4:21', 8, 4, 21), ref('Matt 1:5', 40, 1, 5)],
  },
  {
    id: 'jesse',
    name: 'Jesse',
    hebrew: 'יִשַׁי',
    transliteration: 'Yišay',
    strongs: ['H3448'],
    era: 'Early Monarchy',
    lineageGroup: 'davidic',
    summary: 'Bethlehemite son of Obed and father of eight sons, the youngest being David.',
    keyRefs: [ref('Ruth 4:22', 8, 4, 22), ref('1 Sam 16:1', 9, 16, 1), ref('Isa 11:1', 23, 11, 1)],
  },
  {
    id: 'saul',
    name: 'Saul',
    disambiguator: 'King of Israel, son of Kish',
    hebrew: 'שָׁאוּל',
    transliteration: 'Šāʾūl',
    strongs: ['H7586'],
    era: 'United Monarchy',
    lineageGroup: 'davidic',
    homonymGroup: 'saul',
    summary: 'Benjamite son of Kish and first king of Israel; father of Jonathan and predecessor of David.',
    keyRefs: [ref('1 Sam 9:1', 9, 9, 1), ref('1 Sam 10:1', 9, 10, 1), ref('1 Sam 31:2', 9, 31, 2)],
  },
  {
    id: 'jonathan_saul',
    name: 'Jonathan',
    disambiguator: 'Son of King Saul',
    hebrew: 'יְהוֹנָתָן',
    transliteration: 'Yəhônāṯān',
    strongs: ['H3083'],
    era: 'United Monarchy',
    lineageGroup: 'davidic',
    summary: 'Eldest son of King Saul; bound in a lifelong covenant of friendship with David.',
    keyRefs: [ref('1 Sam 14:1', 9, 14, 1), ref('1 Sam 18:3', 9, 18, 3), ref('2 Sam 1:26', 10, 1, 26)],
  },
  {
    id: 'david',
    name: 'David',
    hebrew: 'דָּוִד',
    transliteration: 'Dāwiḏ',
    strongs: ['H1732'],
    era: 'United Monarchy',
    lineageGroup: 'davidic',
    summary: 'Youngest son of Jesse of Bethlehem; covenant friend of Jonathan, king of Israel, and ancestor of both Solomon and Nathan.',
    keyRefs: [ref('1 Sam 16:13', 9, 16, 13), ref('2 Sam 5:4', 10, 5, 4), ref('2 Sam 7:12', 10, 7, 12)],
    competingGenealogyNote: 'NT genealogies diverge at David’s sons: Matthew 1:6 traces the royal line through Solomon (david_solomon), whereas Luke 3:31 traces through Nathan (david_nathan).',
  },
  {
    id: 'bathsheba',
    name: 'Bathsheba',
    hebrew: 'בַּת־שֶׁבַע',
    transliteration: 'Baṯ-Šeḇaʿ',
    strongs: ['H1339'],
    era: 'United Monarchy',
    lineageGroup: 'davidic',
    summary: 'Daughter of Eliam (Ammiel); wife of David and mother of Solomon and Nathan (1 Chr 3:5).',
    keyRefs: [ref('2 Sam 11:3', 10, 11, 3), ref('2 Sam 12:24', 10, 12, 24), ref('1 Chr 3:5', 13, 3, 5)],
  },
  {
    id: 'solomon',
    name: 'Solomon',
    hebrew: 'שְׁלֹמֹה',
    transliteration: 'Šəlōmōh',
    strongs: ['H8010'],
    era: 'United Monarchy',
    lineageGroup: 'davidic',
    summary: 'Son of David and Bathsheba; third king of Israel, builder of the Jerusalem temple, and Matthew 1 link in the Davidic line.',
    keyRefs: [ref('2 Sam 12:24', 10, 12, 24), ref('1 Kgs 2:12', 11, 2, 12), ref('Matt 1:6', 40, 1, 6)],
    competingGenealogyNote: 'Matthew 1:6–7 traces the Davidic royal genealogy through Solomon and Rehoboam; Luke 3:31 instead traces through Solomon’s brother Nathan.',
  },
  {
    id: 'nathan_david',
    name: 'Nathan',
    disambiguator: 'Son of David & Bathsheba (distinct from Nathan the prophet)',
    hebrew: 'נָתָן',
    transliteration: 'Nāṯān',
    strongs: ['H5416'],
    era: 'United Monarchy',
    lineageGroup: 'davidic',
    summary: 'Son of David and Bathsheba born in Jerusalem (2 Sam 5:14; 1 Chr 3:5); cited in Luke 3:31 as ancestor of Jesus.',
    keyRefs: [ref('2 Sam 5:14', 10, 5, 14), ref('1 Chr 3:5', 13, 3, 5), ref('Luke 3:31', 42, 3, 31)],
    competingGenealogyNote: 'Luke 3:31 traces Jesus’ genealogy from David through Nathan rather than through Solomon as in Matthew 1:6.',
  },
  {
    id: 'rehoboam',
    name: 'Rehoboam',
    hebrew: 'רְחַבְעָם',
    transliteration: 'Rəḥaḇʿām',
    strongs: ['H7346'],
    era: 'Divided Monarchy',
    lineageGroup: 'davidic',
    summary: 'Son and successor of Solomon; king when the northern tribes separated from the house of David.',
    keyRefs: [ref('1 Kgs 11:43', 11, 11, 43), ref('1 Kgs 12:1', 11, 12, 1), ref('Matt 1:7', 40, 1, 7)],
  },
  {
    id: 'hezekiah',
    name: 'Hezekiah',
    hebrew: 'חִזְקִיָּהוּ',
    transliteration: 'Ḥizqiyyāhū',
    strongs: ['H2396'],
    era: 'Divided Monarchy (Judah)',
    lineageGroup: 'davidic',
    summary: 'Reforming Davidic king of Judah (son of Ahaz, Matt 1:9); preserved Jerusalem under Assyrian siege.',
    keyRefs: [ref('2 Kgs 18:1', 12, 18, 1), ref('2 Kgs 18:5', 12, 18, 5), ref('Matt 1:9', 40, 1, 9)],
  },
  {
    id: 'josiah',
    name: 'Josiah',
    hebrew: 'יֹאשִׁיָּהוּ',
    transliteration: 'Yōʾšiyyāhū',
    strongs: ['H2977'],
    era: 'Late Monarchy (Judah)',
    lineageGroup: 'davidic',
    summary: 'Reforming Davidic king of Judah (son of Amon); renewed the covenant upon rediscovering the Book of the Law.',
    keyRefs: [ref('2 Kgs 22:1', 12, 22, 1), ref('2 Kgs 23:25', 12, 23, 25), ref('Matt 1:10', 40, 1, 10)],
  },
  {
    id: 'zerubbabel',
    name: 'Zerubbabel',
    hebrew: 'זְרֻבָּבֶל',
    transliteration: 'Zərubbāḇel',
    strongs: ['H2216'],
    era: 'Post-Exilic Return',
    lineageGroup: 'davidic',
    summary: 'Post-exilic Davidic governor of Judah who led the rebuilding of the Jerusalem temple; appears in both Matthew 1 and Luke 3.',
    keyRefs: [ref('Ezra 3:2', 15, 3, 2), ref('Hag 2:23', 37, 2, 23), ref('Zech 4:9', 38, 4, 9)],
    competingGenealogyNote: 'Ezra 3:2, Haggai 1:1, Matthew 1:12, and Luke 3:27 call Zerubbabel son of Shealtiel, whereas 1 Chronicles 3:19 lists him as son of Pedaiah (often explained as levirate marriage or adoptive succession). Both Matt 1:12 and Luke 3:27 converge at Shealtiel/Zerubbabel before diverging again.',
  },

  // --- Gospels & Apostles (22) ---
  {
    id: 'zechariah_priest',
    name: 'Zechariah',
    disambiguator: 'Priest of Abijah, father of John the Baptist',
    greek: 'Ζαχαρίας',
    transliteration: 'Zacharias',
    strongs: ['G2197'],
    era: 'Second Temple / Gospels',
    lineageGroup: 'gospels_apostles',
    summary: 'Priest of the division of Abijah; husband of Elizabeth and father of John the Baptist.',
    keyRefs: [ref('Luke 1:5', 42, 1, 5), ref('Luke 1:13', 42, 1, 13), ref('Luke 1:67', 42, 1, 67)],
  },
  {
    id: 'elizabeth',
    name: 'Elizabeth',
    greek: 'Ἐλισάβετ',
    transliteration: 'Elisabet',
    strongs: ['G1665'],
    era: 'Second Temple / Gospels',
    lineageGroup: 'gospels_apostles',
    summary: 'Of the daughters of Aaron; wife of Zechariah, relative of Mary (Luke 1:36), and mother of John the Baptist.',
    keyRefs: [ref('Luke 1:5', 42, 1, 5), ref('Luke 1:36', 42, 1, 36), ref('Luke 1:57', 42, 1, 57)],
  },
  {
    id: 'john_baptist',
    name: 'John',
    disambiguator: 'The Baptist, son of Zechariah',
    greek: 'Ἰωάννης',
    transliteration: 'Iōannēs',
    strongs: ['G2491'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'john',
    summary: 'Prophetic forerunner of Jesus; son of Zechariah and Elizabeth who mentored early disciples such as Andrew.',
    keyRefs: [ref('Matt 3:1', 40, 3, 1), ref('Luke 1:13', 42, 1, 13), ref('John 1:29', 43, 1, 29)],
  },
  {
    id: 'joseph_nt',
    name: 'Joseph',
    disambiguator: 'Husband of Mary, Nazareth (NT)',
    greek: 'Ἰωσήφ',
    transliteration: 'Iōsēph',
    strongs: ['G2501'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'joseph',
    summary: 'Carpenter of Nazareth from the house of David; husband of Mary and legal/adoptive father of Jesus.',
    keyRefs: [ref('Matt 1:16', 40, 1, 16), ref('Matt 1:20', 40, 1, 20), ref('Luke 3:23', 42, 3, 23)],
    competingGenealogyNote: 'Matthew 1:16 names Joseph’s father as Jacob (descending from David via Solomon); Luke 3:23 names Heli (descending from David via Nathan).',
  },
  {
    id: 'mary_jesus',
    name: 'Mary',
    disambiguator: 'Mother of Jesus',
    greek: 'Μαριάμ',
    transliteration: 'Mariam',
    strongs: ['G3137'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'mary',
    summary: 'Betrothed and wife of Joseph of Nazareth; mother of Jesus and relative of Elizabeth.',
    keyRefs: [ref('Luke 1:27', 42, 1, 27), ref('Luke 2:7', 42, 2, 7), ref('John 19:25', 43, 19, 25)],
  },
  {
    id: 'mary_magdalene',
    name: 'Mary Magdalene',
    disambiguator: 'Follower from Magdala',
    greek: 'Μαρία ἡ Μαγδαληνή',
    transliteration: 'Maria hē Magdalēnē',
    strongs: ['G3137'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'mary',
    summary: 'Galilean disciple of Jesus from Magdala; primary witness to the crucifixion and resurrection.',
    keyRefs: [ref('Luke 8:2', 42, 8, 2), ref('John 20:1', 43, 20, 1), ref('John 20:16', 43, 20, 16)],
  },
  {
    id: 'mary_bethany',
    name: 'Mary',
    disambiguator: 'Sister of Martha & Lazarus (Bethany)',
    greek: 'Μαρία',
    transliteration: 'Maria',
    strongs: ['G3137'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'mary',
    summary: 'Resident of Bethany, sister of Martha and Lazarus; sat at Jesus’ feet and anointed Him before the Passion.',
    keyRefs: [ref('Luke 10:39', 42, 10, 39), ref('John 11:1', 43, 11, 1), ref('John 12:3', 43, 12, 3)],
  },
  {
    id: 'lazarus',
    name: 'Lazarus',
    disambiguator: 'Brother of Mary & Martha (Bethany)',
    greek: 'Λάζαρος',
    transliteration: 'Lazaros',
    strongs: ['G2976'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    summary: 'Resident of Bethany, brother of Martha and Mary; called "friend" by Jesus and raised from the dead in John 11.',
    keyRefs: [ref('John 11:1', 43, 11, 1), ref('John 11:11', 43, 11, 11), ref('John 12:2', 43, 12, 2)],
  },
  {
    id: 'martha',
    name: 'Martha',
    disambiguator: 'Sister of Mary & Lazarus (Bethany)',
    greek: 'Μάρθα',
    transliteration: 'Martha',
    strongs: ['G3136'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    summary: 'Hostess in Bethany and sister of Mary and Lazarus; confessed Jesus as the Christ in John 11:27.',
    keyRefs: [ref('Luke 10:38', 42, 10, 38), ref('John 11:5', 43, 11, 5), ref('John 11:27', 43, 11, 27)],
  },
  {
    id: 'jesus',
    name: 'Jesus',
    greek: 'Ἰησοῦς',
    transliteration: 'Iēsous',
    strongs: ['G2424'],
    era: 'Gospels',
    lineageGroup: 'gospels_apostles',
    summary: 'Jesus of Nazareth; son of Mary, legal/adopted son of Joseph, teacher of the Twelve, and central messianic heir of the Davidic promises.',
    keyRefs: [ref('Matt 1:1', 40, 1, 1), ref('Luke 2:7', 42, 2, 7), ref('Luke 3:23', 42, 3, 23)],
    competingGenealogyNote:
      'Competing NT Genealogies: Matthew 1:1–17 traces Jesus’ Davidic descent to Joseph via Solomon (edge david_solomon -> Rehoboam -> Hezekiah -> Josiah -> Zerubbabel). Luke 3:23–38 traces the line ("as was supposed, of Joseph") from David via Nathan (edge david_nathan -> Zerubbabel -> Heli) back to Adam. Scholars note differing hypotheses (royal/legal vs. biological, levirate marriage, or maternal line through Mary).',
  },
  {
    id: 'simon_peter',
    name: 'Simon Peter',
    greek: 'Σίμων Πέτρος',
    transliteration: 'Simōn Petros',
    strongs: ['G4613', 'G4074'],
    era: 'Gospels & Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Galilean fisherman, brother of Andrew, and leading apostle among Jesus’ disciples.',
    keyRefs: [ref('Matt 4:18', 40, 4, 18), ref('Matt 16:16', 40, 16, 16), ref('John 21:15', 43, 21, 15)],
  },
  {
    id: 'andrew',
    name: 'Andrew',
    greek: 'Ἀνδρέας',
    transliteration: 'Andreas',
    strongs: ['G406'],
    era: 'Gospels & Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Brother of Simon Peter; first a disciple of John the Baptist before following Jesus and bringing Simon to Him.',
    keyRefs: [ref('Matt 4:18', 40, 4, 18), ref('John 1:40', 43, 1, 40), ref('John 1:41', 43, 1, 41)],
  },
  {
    id: 'james_zebedee',
    name: 'James',
    disambiguator: 'Son of Zebedee, Apostle',
    greek: 'Ἰάκωβος',
    transliteration: 'Iakōbos',
    strongs: ['G2385'],
    era: 'Gospels & Apostolic',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'james',
    summary: 'Galilean fisherman, elder brother of John (son of Zebedee), and first of the Twelve martyred under Herod Agrippa I.',
    keyRefs: [ref('Matt 4:21', 40, 4, 21), ref('Mark 3:17', 41, 3, 17), ref('Acts 12:2', 44, 12, 2)],
  },
  {
    id: 'john_zebedee',
    name: 'John',
    disambiguator: 'Son of Zebedee, Apostle',
    greek: 'Ἰωάννης',
    transliteration: 'Iōannēs',
    strongs: ['G2491'],
    era: 'Gospels & Apostolic',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'john',
    summary: 'Brother of James (son of Zebedee) and disciple of Jesus; recognized among the pillars in Jerusalem.',
    keyRefs: [ref('Matt 4:21', 40, 4, 21), ref('John 19:26', 43, 19, 26), ref('Gal 2:9', 48, 2, 9)],
  },
  {
    id: 'james_jesus',
    name: 'James',
    disambiguator: 'Brother of Jesus, leader in Jerusalem',
    greek: 'Ἰάκωβος',
    transliteration: 'Iakōbos',
    strongs: ['G2385'],
    era: 'Gospels & Apostolic',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'james',
    summary: 'Brother of the Lord (Matt 13:55; Gal 1:19); leader of the Jerusalem church and traditional author of the Epistle of James.',
    keyRefs: [ref('Matt 13:55', 40, 13, 55), ref('Acts 15:13', 44, 15, 13), ref('Gal 1:19', 48, 1, 19)],
    competingGenealogyNote: 'NT texts describe James as Jesus’ brother (adelphos, Matt 13:55; Gal 1:19); historical traditions debate whether this denotes younger sons of Mary and Joseph, stepbrothers from an earlier marriage of Joseph, or close cousins.',
  },
  {
    id: 'paul',
    name: 'Paul (Saul)',
    disambiguator: 'Saul of Tarsus, Apostle',
    greek: 'Παῦλος / Σαῦλος',
    transliteration: 'Paulos / Saulos',
    strongs: ['G3972', 'G4569'],
    era: 'Apostolic',
    lineageGroup: 'gospels_apostles',
    homonymGroup: 'saul',
    summary: 'Pharisee of Benjamin trained under Gamaliel; apostle to the Gentiles, partner of Barnabas, mentor to Timothy, and co-worker with Priscilla and Aquila.',
    keyRefs: [ref('Acts 9:1', 44, 9, 1), ref('Acts 13:9', 44, 13, 9), ref('Acts 22:3', 44, 22, 3)],
  },
  {
    id: 'barnabas',
    name: 'Barnabas',
    greek: 'Βαρναβᾶς',
    transliteration: 'Barnabas',
    strongs: ['G921'],
    era: 'Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Levite of Cyprus ("son of encouragement"); vouched for Saul in Jerusalem, brought him to Antioch, and partnered on the first mission.',
    keyRefs: [ref('Acts 4:36', 44, 4, 36), ref('Acts 9:27', 44, 9, 27), ref('Acts 13:2', 44, 13, 2)],
  },
  {
    id: 'timothy',
    name: 'Timothy',
    greek: 'Τιμόθεος',
    transliteration: 'Timotheos',
    strongs: ['G5095'],
    era: 'Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Son of Eunice and grandson of Lois at Lystra; beloved child in the faith and close disciple/co-worker of Paul.',
    keyRefs: [ref('Acts 16:1', 44, 16, 1), ref('1 Tim 1:2', 54, 1, 2), ref('2 Tim 1:5', 55, 1, 5)],
  },
  {
    id: 'eunice',
    name: 'Eunice',
    greek: 'Εὐνίκη',
    transliteration: 'Eunikē',
    strongs: ['G2131'],
    era: 'Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Believing Jewish woman, daughter of Lois and mother of Timothy (2 Tim 1:5; Acts 16:1).',
    keyRefs: [ref('Acts 16:1', 44, 16, 1), ref('2 Tim 1:5', 55, 1, 5)],
  },
  {
    id: 'lois',
    name: 'Lois',
    greek: 'Λωΐς',
    transliteration: 'Lōis',
    strongs: ['G3090'],
    era: 'Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Maternal grandmother of Timothy and mother of Eunice, commended by Paul for sincere faith.',
    keyRefs: [ref('2 Tim 1:5', 55, 1, 5)],
  },
  {
    id: 'priscilla',
    name: 'Priscilla',
    greek: 'Πρίσκιλλα',
    transliteration: 'Priskilla',
    strongs: ['G4252'],
    era: 'Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Wife of Aquila; tentmaker and teacher who hosted churches and worked alongside Paul in Corinth and Ephesus.',
    keyRefs: [ref('Acts 18:2', 44, 18, 2), ref('Acts 18:26', 44, 18, 26), ref('Rom 16:3', 45, 16, 3)],
  },
  {
    id: 'aquila',
    name: 'Aquila',
    greek: 'Ἀκύλας',
    transliteration: 'Akylas',
    strongs: ['G207'],
    era: 'Apostolic',
    lineageGroup: 'gospels_apostles',
    summary: 'Jewish tentmaker originally from Pontus; husband of Priscilla and co-worker with Paul.',
    keyRefs: [ref('Acts 18:2', 44, 18, 2), ref('1 Cor 16:19', 46, 16, 19), ref('Rom 16:3', 45, 16, 3)],
  },
];

// === @section:data:relationships ===
export const PERSON_RELATIONSHIPS: readonly PersonRelationship[] = [
  // --- Creation & Table of Nations ---
  { id: 'adam_eve_spouse', fromId: 'adam', toId: 'eve', type: 'spouse', witnessRef: ref('Gen 2:22', 1, 2, 22) },
  { id: 'adam_cain', fromId: 'adam', toId: 'cain', type: 'father', witnessRef: ref('Gen 4:1', 1, 4, 1) },
  { id: 'eve_cain', fromId: 'eve', toId: 'cain', type: 'mother', witnessRef: ref('Gen 4:1', 1, 4, 1) },
  { id: 'adam_abel', fromId: 'adam', toId: 'abel', type: 'father', witnessRef: ref('Gen 4:2', 1, 4, 2) },
  { id: 'eve_abel', fromId: 'eve', toId: 'abel', type: 'mother', witnessRef: ref('Gen 4:2', 1, 4, 2) },
  { id: 'cain_abel_sib', fromId: 'cain', toId: 'abel', type: 'sibling', witnessRef: ref('Gen 4:2', 1, 4, 2) },
  { id: 'adam_seth', fromId: 'adam', toId: 'seth', type: 'father', witnessRef: ref('Gen 5:3', 1, 5, 3) },
  { id: 'eve_seth', fromId: 'eve', toId: 'seth', type: 'mother', witnessRef: ref('Gen 4:25', 1, 4, 25) },
  { id: 'cain_seth_sib', fromId: 'cain', toId: 'seth', type: 'sibling', witnessRef: ref('Gen 4:25', 1, 4, 25), note: 'Half/full brother through Adam and Eve.' },
  { id: 'noah_shem', fromId: 'noah', toId: 'shem', type: 'father', witnessRef: ref('Gen 5:32', 1, 5, 32) },
  { id: 'noah_ham', fromId: 'noah', toId: 'ham', type: 'father', witnessRef: ref('Gen 5:32', 1, 5, 32) },
  { id: 'noah_japheth', fromId: 'noah', toId: 'japheth', type: 'father', witnessRef: ref('Gen 5:32', 1, 5, 32) },
  { id: 'shem_ham_sib', fromId: 'shem', toId: 'ham', type: 'sibling', witnessRef: ref('Gen 9:18', 1, 9, 18) },
  { id: 'shem_japheth_sib', fromId: 'shem', toId: 'japheth', type: 'sibling', witnessRef: ref('Gen 10:21', 1, 10, 21) },
  { id: 'ham_japheth_sib', fromId: 'ham', toId: 'japheth', type: 'sibling', witnessRef: ref('Gen 9:22', 1, 9, 22) },
  {
    id: 'ham_cush',
    fromId: 'ham',
    toId: 'cush',
    type: 'father',
    witnessRef: ref('Gen 10:6', 1, 10, 6),
    competingModel: 'Table of Nations household/eponymous genealogy (Gen 10:6), not modern ethnographic taxonomy.',
  },
  {
    id: 'ham_mizraim',
    fromId: 'ham',
    toId: 'mizraim',
    type: 'father',
    witnessRef: ref('Gen 10:6', 1, 10, 6),
    competingModel: 'Table of Nations household/eponymous genealogy (Gen 10:6), not modern ethnographic taxonomy.',
  },
  {
    id: 'ham_canaan',
    fromId: 'ham',
    toId: 'canaan',
    type: 'father',
    witnessRef: ref('Gen 10:6', 1, 10, 6),
    competingModel: 'Table of Nations household/eponymous genealogy (Gen 9:18; 10:6), not modern ethnographic taxonomy.',
  },
  {
    id: 'cush_mizraim_sib',
    fromId: 'cush',
    toId: 'mizraim',
    type: 'sibling',
    witnessRef: ref('Gen 10:6', 1, 10, 6),
  },
  {
    id: 'mizraim_canaan_sib',
    fromId: 'mizraim',
    toId: 'canaan',
    type: 'sibling',
    witnessRef: ref('Gen 10:6', 1, 10, 6),
  },

  // --- Patriarchs ---
  { id: 'terah_abraham', fromId: 'terah', toId: 'abraham', type: 'father', witnessRef: ref('Gen 11:26', 1, 11, 26) },
  { id: 'terah_nahor', fromId: 'terah', toId: 'nahor', type: 'father', witnessRef: ref('Gen 11:26', 1, 11, 26) },
  { id: 'abraham_nahor_sib', fromId: 'abraham', toId: 'nahor', type: 'sibling', witnessRef: ref('Gen 11:26', 1, 11, 26) },
  { id: 'abraham_sarah_spouse', fromId: 'abraham', toId: 'sarah', type: 'spouse', witnessRef: ref('Gen 11:29', 1, 11, 29), note: 'Gen 20:12 also records Abraham calling Sarah daughter of his father by another mother.' },
  { id: 'abraham_hagar_spouse', fromId: 'abraham', toId: 'hagar', type: 'spouse', witnessRef: ref('Gen 16:3', 1, 16, 3), note: 'Given as wife/concubine to Abram.' },
  { id: 'abraham_ishmael', fromId: 'abraham', toId: 'ishmael', type: 'father', witnessRef: ref('Gen 16:15', 1, 16, 15) },
  { id: 'hagar_ishmael', fromId: 'hagar', toId: 'ishmael', type: 'mother', witnessRef: ref('Gen 16:15', 1, 16, 15) },
  { id: 'abraham_isaac', fromId: 'abraham', toId: 'isaac', type: 'father', witnessRef: ref('Gen 21:3', 1, 21, 3) },
  { id: 'sarah_isaac', fromId: 'sarah', toId: 'isaac', type: 'mother', witnessRef: ref('Gen 21:3', 1, 21, 3) },
  { id: 'ishmael_isaac_sib', fromId: 'ishmael', toId: 'isaac', type: 'sibling', witnessRef: ref('Gen 21:9', 1, 21, 9), note: 'Half-brothers through Abraham.' },
  { id: 'isaac_rebekah_spouse', fromId: 'isaac', toId: 'rebekah', type: 'spouse', witnessRef: ref('Gen 24:67', 1, 24, 67) },
  { id: 'isaac_esau', fromId: 'isaac', toId: 'esau', type: 'father', witnessRef: ref('Gen 25:25', 1, 25, 25) },
  { id: 'rebekah_esau', fromId: 'rebekah', toId: 'esau', type: 'mother', witnessRef: ref('Gen 25:25', 1, 25, 25) },
  { id: 'isaac_jacob', fromId: 'isaac', toId: 'jacob', type: 'father', witnessRef: ref('Gen 25:26', 1, 25, 26) },
  { id: 'rebekah_jacob', fromId: 'rebekah', toId: 'jacob', type: 'mother', witnessRef: ref('Gen 25:26', 1, 25, 26) },
  { id: 'esau_jacob_sib', fromId: 'esau', toId: 'jacob', type: 'sibling', witnessRef: ref('Gen 25:26', 1, 25, 26), note: 'Twin brothers.' },
  { id: 'jacob_leah_spouse', fromId: 'jacob', toId: 'leah', type: 'spouse', witnessRef: ref('Gen 29:23', 1, 29, 23) },
  { id: 'jacob_rachel_spouse', fromId: 'jacob', toId: 'rachel', type: 'spouse', witnessRef: ref('Gen 29:28', 1, 29, 28) },
  { id: 'leah_rachel_sib', fromId: 'leah', toId: 'rachel', type: 'sibling', witnessRef: ref('Gen 29:16', 1, 29, 16) },
  { id: 'jacob_reuben', fromId: 'jacob', toId: 'reuben', type: 'father', witnessRef: ref('Gen 29:32', 1, 29, 32) },
  { id: 'leah_reuben', fromId: 'leah', toId: 'reuben', type: 'mother', witnessRef: ref('Gen 29:32', 1, 29, 32) },
  { id: 'jacob_levi', fromId: 'jacob', toId: 'levi', type: 'father', witnessRef: ref('Gen 29:34', 1, 29, 34) },
  { id: 'leah_levi', fromId: 'leah', toId: 'levi', type: 'mother', witnessRef: ref('Gen 29:34', 1, 29, 34) },
  { id: 'jacob_judah', fromId: 'jacob', toId: 'judah', type: 'father', witnessRef: ref('Gen 29:35', 1, 29, 35) },
  { id: 'leah_judah', fromId: 'leah', toId: 'judah', type: 'mother', witnessRef: ref('Gen 29:35', 1, 29, 35) },
  { id: 'reuben_levi_sib', fromId: 'reuben', toId: 'levi', type: 'sibling', witnessRef: ref('Gen 35:23', 1, 35, 23) },
  { id: 'levi_judah_sib', fromId: 'levi', toId: 'judah', type: 'sibling', witnessRef: ref('Gen 35:23', 1, 35, 23) },
  { id: 'judah_joseph_sib', fromId: 'judah', toId: 'joseph_ot', type: 'sibling', witnessRef: ref('Gen 37:26', 1, 37, 26), note: 'Half-brothers through Jacob.' },
  { id: 'jacob_joseph_ot', fromId: 'jacob', toId: 'joseph_ot', type: 'father', witnessRef: ref('Gen 30:24', 1, 30, 24) },
  { id: 'rachel_joseph_ot', fromId: 'rachel', toId: 'joseph_ot', type: 'mother', witnessRef: ref('Gen 30:22', 1, 30, 22) },
  { id: 'jacob_benjamin', fromId: 'jacob', toId: 'benjamin', type: 'father', witnessRef: ref('Gen 35:18', 1, 35, 18) },
  { id: 'rachel_benjamin', fromId: 'rachel', toId: 'benjamin', type: 'mother', witnessRef: ref('Gen 35:18', 1, 35, 18) },
  { id: 'joseph_benjamin_sib', fromId: 'joseph_ot', toId: 'benjamin', type: 'sibling', witnessRef: ref('Gen 43:29', 1, 43, 29), note: 'Full brothers through Jacob and Rachel.' },
  { id: 'judah_perez', fromId: 'judah', toId: 'perez', type: 'father', witnessRef: ref('Gen 38:29', 1, 38, 29) },
  { id: 'tamar_perez', fromId: 'tamar', toId: 'perez', type: 'mother', witnessRef: ref('Gen 38:29', 1, 38, 29) },
  { id: 'joseph_asenath_spouse', fromId: 'joseph_ot', toId: 'asenath', type: 'spouse', witnessRef: ref('Gen 41:45', 1, 41, 45) },
  { id: 'joseph_manasseh', fromId: 'joseph_ot', toId: 'manasseh', type: 'father', witnessRef: ref('Gen 41:51', 1, 41, 51) },
  { id: 'asenath_manasseh', fromId: 'asenath', toId: 'manasseh', type: 'mother', witnessRef: ref('Gen 41:50', 1, 41, 50) },
  { id: 'joseph_ephraim', fromId: 'joseph_ot', toId: 'ephraim', type: 'father', witnessRef: ref('Gen 41:52', 1, 41, 52) },
  { id: 'asenath_ephraim', fromId: 'asenath', toId: 'ephraim', type: 'mother', witnessRef: ref('Gen 41:50', 1, 41, 50) },
  { id: 'manasseh_ephraim_sib', fromId: 'manasseh', toId: 'ephraim', type: 'sibling', witnessRef: ref('Gen 48:1', 1, 48, 1) },

  // --- Exodus & Priests ---
  {
    id: 'levi_jochebed',
    fromId: 'levi',
    toId: 'jochebed',
    type: 'father',
    witnessRef: ref('Num 26:59', 4, 26, 59),
    competingModel: 'Numbers 26:59 calls Jochebed "daughter of Levi"; some read "daughter" in a broader clan sense.',
  },
  { id: 'amram_jochebed_spouse', fromId: 'amram', toId: 'jochebed', type: 'spouse', witnessRef: ref('Exod 6:20', 2, 6, 20) },
  { id: 'amram_miriam', fromId: 'amram', toId: 'miriam', type: 'father', witnessRef: ref('Num 26:59', 4, 26, 59) },
  { id: 'jochebed_miriam', fromId: 'jochebed', toId: 'miriam', type: 'mother', witnessRef: ref('Num 26:59', 4, 26, 59) },
  { id: 'amram_aaron', fromId: 'amram', toId: 'aaron', type: 'father', witnessRef: ref('Exod 6:20', 2, 6, 20) },
  { id: 'jochebed_aaron', fromId: 'jochebed', toId: 'aaron', type: 'mother', witnessRef: ref('Exod 6:20', 2, 6, 20) },
  { id: 'amram_moses', fromId: 'amram', toId: 'moses', type: 'father', witnessRef: ref('Exod 6:20', 2, 6, 20) },
  { id: 'jochebed_moses', fromId: 'jochebed', toId: 'moses', type: 'mother', witnessRef: ref('Exod 6:20', 2, 6, 20) },
  { id: 'miriam_aaron_sib', fromId: 'miriam', toId: 'aaron', type: 'sibling', witnessRef: ref('Num 26:59', 4, 26, 59) },
  { id: 'miriam_moses_sib', fromId: 'miriam', toId: 'moses', type: 'sibling', witnessRef: ref('Num 26:59', 4, 26, 59) },
  { id: 'aaron_moses_sib', fromId: 'aaron', toId: 'moses', type: 'sibling', witnessRef: ref('Exod 4:14', 2, 4, 14) },
  { id: 'moses_zipporah_spouse', fromId: 'moses', toId: 'zipporah', type: 'spouse', witnessRef: ref('Exod 2:21', 2, 2, 21) },
  { id: 'aaron_eleazar', fromId: 'aaron', toId: 'eleazar', type: 'father', witnessRef: ref('Exod 6:23', 2, 6, 23) },
  { id: 'aaron_eleazar_succ', fromId: 'aaron', toId: 'eleazar', type: 'successor', witnessRef: ref('Num 20:26', 4, 20, 26), note: 'Invested with Aaron’s high-priestly garments at Mount Hor.' },
  { id: 'eleazar_phinehas', fromId: 'eleazar', toId: 'phinehas', type: 'father', witnessRef: ref('Exod 6:25', 2, 6, 25) },
  { id: 'moses_joshua_mentor', fromId: 'moses', toId: 'joshua', type: 'mentor_disciple', witnessRef: ref('Exod 24:13', 2, 24, 13), note: 'Joshua served as Moses’ attendant/minister from his youth (Num 11:28).' },
  { id: 'moses_joshua_succ', fromId: 'moses', toId: 'joshua', type: 'successor', witnessRef: ref('Deut 34:9', 5, 34, 9), note: 'Commissioned by Moses to lead Israel into Canaan (Josh 1:1–2).' },
  { id: 'joshua_caleb_friend', fromId: 'joshua', toId: 'caleb', type: 'covenant_friend', witnessRef: ref('Num 14:6', 4, 14, 6), note: 'Faithful co-witnesses among the twelve spies and lifelong allies in Canaan.' },

  // --- Davidic Line ---
  { id: 'boaz_ruth_spouse', fromId: 'boaz', toId: 'ruth', type: 'spouse', witnessRef: ref('Ruth 4:13', 8, 4, 13) },
  { id: 'boaz_obed', fromId: 'boaz', toId: 'obed', type: 'father', witnessRef: ref('Ruth 4:21', 8, 4, 21) },
  { id: 'ruth_obed', fromId: 'ruth', toId: 'obed', type: 'mother', witnessRef: ref('Ruth 4:13', 8, 4, 13) },
  { id: 'obed_jesse', fromId: 'obed', toId: 'jesse', type: 'father', witnessRef: ref('Ruth 4:22', 8, 4, 22) },
  { id: 'jesse_david', fromId: 'jesse', toId: 'david', type: 'father', witnessRef: ref('1 Sam 17:12', 9, 17, 12) },
  { id: 'saul_jonathan', fromId: 'saul', toId: 'jonathan_saul', type: 'father', witnessRef: ref('1 Sam 14:1', 9, 14, 1) },
  { id: 'saul_david_succ', fromId: 'saul', toId: 'david', type: 'successor', witnessRef: ref('2 Sam 5:3', 10, 5, 3), note: 'David anointed in Saul’s lifetime (1 Sam 16:13) and crowned over all Israel after Saul.' },
  { id: 'david_jonathan_covenant', fromId: 'david', toId: 'jonathan_saul', type: 'covenant_friend', witnessRef: ref('1 Sam 18:3', 9, 18, 3), note: 'Jonathan made a solemn covenant with David because he loved him as his own soul (1 Sam 20:16).' },
  { id: 'david_bathsheba_spouse', fromId: 'david', toId: 'bathsheba', type: 'spouse', witnessRef: ref('2 Sam 12:24', 10, 12, 24) },
  {
    id: 'david_solomon',
    fromId: 'david',
    toId: 'solomon',
    type: 'father',
    witnessRef: ref('2 Sam 12:24', 10, 12, 24),
    competingModel: 'Matthew 1:6–16 traces the Davidic line through Solomon.',
  },
  { id: 'bathsheba_solomon', fromId: 'bathsheba', toId: 'solomon', type: 'mother', witnessRef: ref('2 Sam 12:24', 10, 12, 24) },
  { id: 'david_solomon_succ', fromId: 'david', toId: 'solomon', type: 'successor', witnessRef: ref('1 Kgs 1:30', 11, 1, 30) },
  {
    id: 'david_nathan',
    fromId: 'david',
    toId: 'nathan_david',
    type: 'father',
    witnessRef: ref('2 Sam 5:14', 10, 5, 14),
    competingModel: 'Luke 3:23–31 traces the Davidic line through Nathan.',
  },
  { id: 'bathsheba_nathan', fromId: 'bathsheba', toId: 'nathan_david', type: 'mother', witnessRef: ref('1 Chr 3:5', 13, 3, 5) },
  { id: 'solomon_nathan_sib', fromId: 'solomon', toId: 'nathan_david', type: 'sibling', witnessRef: ref('1 Chr 3:5', 13, 3, 5) },
  { id: 'solomon_rehoboam', fromId: 'solomon', toId: 'rehoboam', type: 'father', witnessRef: ref('1 Kgs 11:43', 11, 11, 43) },
  { id: 'solomon_rehoboam_succ', fromId: 'solomon', toId: 'rehoboam', type: 'successor', witnessRef: ref('1 Kgs 11:43', 11, 11, 43) },

  // --- Gospels & Apostles ---
  { id: 'zechariah_elizabeth_spouse', fromId: 'zechariah_priest', toId: 'elizabeth', type: 'spouse', witnessRef: ref('Luke 1:5', 42, 1, 5) },
  { id: 'zechariah_john_baptist', fromId: 'zechariah_priest', toId: 'john_baptist', type: 'father', witnessRef: ref('Luke 1:13', 42, 1, 13) },
  { id: 'elizabeth_john_baptist', fromId: 'elizabeth', toId: 'john_baptist', type: 'mother', witnessRef: ref('Luke 1:57', 42, 1, 57) },
  { id: 'joseph_mary_spouse', fromId: 'joseph_nt', toId: 'mary_jesus', type: 'spouse', witnessRef: ref('Matt 1:20', 40, 1, 20) },
  {
    id: 'joseph_jesus',
    fromId: 'joseph_nt',
    toId: 'jesus',
    type: 'father',
    witnessRef: ref('Luke 3:23', 42, 3, 23),
    note: 'Legal / adoptive father in the Davidic household.',
    competingModel: 'Luke 3:23 notes "being the son, as was supposed, of Joseph" alongside Matthew 1:16–20.',
  },
  { id: 'mary_jesus_mother', fromId: 'mary_jesus', toId: 'jesus', type: 'mother', witnessRef: ref('Luke 2:7', 42, 2, 7) },
  {
    id: 'joseph_james_jesus',
    fromId: 'joseph_nt',
    toId: 'james_jesus',
    type: 'father',
    witnessRef: ref('Matt 13:55', 40, 13, 55),
    competingModel: 'Debated historically: younger son of Joseph & Mary, or Joseph’s son by an earlier marriage.',
  },
  {
    id: 'mary_james_jesus',
    fromId: 'mary_jesus',
    toId: 'james_jesus',
    type: 'mother',
    witnessRef: ref('Mark 6:3', 41, 6, 3),
    competingModel: 'Mark 6:3 pairs Mary with James, Joses, Judas, and Simon; see competing sibling/cousin interpretations.',
  },
  {
    id: 'jesus_james_sib',
    fromId: 'jesus',
    toId: 'james_jesus',
    type: 'sibling',
    witnessRef: ref('Gal 1:19', 48, 1, 19),
    competingModel: 'Called adelphos ("brother") in Matt 13:55, Mark 6:3, and Gal 1:19.',
  },
  { id: 'john_baptist_andrew_mentor', fromId: 'john_baptist', toId: 'andrew', type: 'mentor_disciple', witnessRef: ref('John 1:40', 43, 1, 40), note: 'Andrew was initially a disciple of John the Baptist before following Jesus.' },
  { id: 'jesus_peter_mentor', fromId: 'jesus', toId: 'simon_peter', type: 'mentor_disciple', witnessRef: ref('Matt 4:18', 40, 4, 18) },
  { id: 'jesus_andrew_mentor', fromId: 'jesus', toId: 'andrew', type: 'mentor_disciple', witnessRef: ref('John 1:40', 43, 1, 40) },
  { id: 'jesus_james_zeb_mentor', fromId: 'jesus', toId: 'james_zebedee', type: 'mentor_disciple', witnessRef: ref('Matt 4:21', 40, 4, 21) },
  { id: 'jesus_john_zeb_mentor', fromId: 'jesus', toId: 'john_zebedee', type: 'mentor_disciple', witnessRef: ref('Matt 4:21', 40, 4, 21) },
  { id: 'jesus_mary_mag_mentor', fromId: 'jesus', toId: 'mary_magdalene', type: 'mentor_disciple', witnessRef: ref('Luke 8:2', 42, 8, 2), note: 'Addressed Jesus as "Rabboni" (Teacher) in John 20:16.' },
  { id: 'jesus_mary_beth_mentor', fromId: 'jesus', toId: 'mary_bethany', type: 'mentor_disciple', witnessRef: ref('Luke 10:39', 42, 10, 39), note: 'Sat at the Lord’s feet listening to His teaching.' },
  { id: 'jesus_lazarus_friend', fromId: 'jesus', toId: 'lazarus', type: 'covenant_friend', witnessRef: ref('John 11:11', 43, 11, 11), note: 'Jesus refers to Lazarus as "our friend" (ho philos hēmōn).' },
  { id: 'peter_andrew_sib', fromId: 'simon_peter', toId: 'andrew', type: 'sibling', witnessRef: ref('Matt 4:18', 40, 4, 18) },
  { id: 'james_john_zeb_sib', fromId: 'james_zebedee', toId: 'john_zebedee', type: 'sibling', witnessRef: ref('Matt 4:21', 40, 4, 21) },
  { id: 'lazarus_martha_sib', fromId: 'lazarus', toId: 'martha', type: 'sibling', witnessRef: ref('John 11:1', 43, 11, 1) },
  { id: 'lazarus_mary_beth_sib', fromId: 'lazarus', toId: 'mary_bethany', type: 'sibling', witnessRef: ref('John 11:1', 43, 11, 1) },
  { id: 'martha_mary_beth_sib', fromId: 'martha', toId: 'mary_bethany', type: 'sibling', witnessRef: ref('John 11:5', 43, 11, 5) },
  { id: 'barnabas_paul_mentor', fromId: 'barnabas', toId: 'paul', type: 'mentor_disciple', witnessRef: ref('Acts 9:27', 44, 9, 27), note: 'Barnabas introduced Saul to the apostles and brought him to Antioch (Acts 11:25–26).' },
  { id: 'paul_barnabas_friend', fromId: 'paul', toId: 'barnabas', type: 'covenant_friend', witnessRef: ref('Gal 2:9', 48, 2, 9), note: 'Extended the right hand of fellowship; commissioned together in Acts 13:2.' },
  { id: 'paul_timothy_mentor', fromId: 'paul', toId: 'timothy', type: 'mentor_disciple', witnessRef: ref('1 Tim 1:2', 54, 1, 2), note: 'Called "my true child in the faith" (2 Tim 1:2).' },
  { id: 'lois_eunice', fromId: 'lois', toId: 'eunice', type: 'mother', witnessRef: ref('2 Tim 1:5', 55, 1, 5) },
  { id: 'eunice_timothy', fromId: 'eunice', toId: 'timothy', type: 'mother', witnessRef: ref('2 Tim 1:5', 55, 1, 5) },
  { id: 'priscilla_aquila_spouse', fromId: 'priscilla', toId: 'aquila', type: 'spouse', witnessRef: ref('Acts 18:2', 44, 18, 2) },
  { id: 'paul_priscilla_friend', fromId: 'paul', toId: 'priscilla', type: 'covenant_friend', witnessRef: ref('Rom 16:3', 45, 16, 3), note: 'Fellow tentmakers and co-workers in Christ Jesus.' },
  { id: 'paul_aquila_friend', fromId: 'paul', toId: 'aquila', type: 'covenant_friend', witnessRef: ref('Acts 18:2', 44, 18, 2), note: 'Fellow tentmakers and co-workers in Christ Jesus (Rom 16:3).' },
];

// === @section:logic:lookup ===
const UPSTREAM_TO_CURATED_ID: Record<string, string> = {
  Adam_1: 'adam', Eve_1: 'eve', Cain_1: 'cain', Abel_1: 'abel', Seth_1: 'seth',
  Noah_1: 'noah', Shem_1: 'shem', Ham_1: 'ham', Japheth_1: 'japheth', Cush_1: 'cush',
  Mizraim_1: 'mizraim', Canaan_1: 'canaan', Eber_1: 'eber', Terah_1: 'terah',
  Abram_1: 'abraham', Sarai_1: 'sarah', Hagar_1: 'hagar', Nahor_2: 'nahor', Lot_1: 'lot',
  Ishmael_1: 'ishmael', Isaac_1: 'isaac', Rebekah_1: 'rebekah', Esau_1: 'esau',
  Jacob_1: 'jacob', Leah_1: 'leah', Rachel_1: 'rachel', Reuben_1: 'reuben',
  Levi_1: 'levi', Judah_1: 'judah', Joseph_1: 'joseph_ot', Benjamin_1: 'benjamin',
  Tamar_1: 'tamar', Perez_1: 'perez', Asenath_1: 'asenath', Ephraim_1: 'ephraim',
  Manasseh_1: 'manasseh', Amram_1: 'amram', Jochebed_1: 'jochebed', Miriam_1: 'miriam',
  Aaron_1: 'aaron', Moses_1: 'moses', Zipporah_1: 'zipporah', Eleazar_1: 'eleazar',
  Phinehas_1: 'phinehas', Joshua_1: 'joshua', Caleb_1: 'caleb', Boaz_1: 'boaz',
  Ruth_1: 'ruth', Obed_1: 'obed', Jesse_1: 'jesse', Saul_1: 'saul',
  Jonathan_2: 'jonathan_saul', David_1: 'david', Bathsheba_1: 'bathsheba',
  Solomon_1: 'solomon', Nathan_1: 'nathan_david', Rehoboam_1: 'rehoboam',
  Hezekiah_1: 'hezekiah', Josiah_1: 'josiah', Zerubbabel_2: 'zerubbabel',
  Zacharias_1: 'zechariah_priest', Elizabeth_1: 'elizabeth', John_1: 'john_baptist',
  Joseph_6: 'joseph_nt', Mary_1: 'mary_jesus', Mary_2: 'mary_magdalene',
  Mary_3: 'mary_bethany', Lazarus_2: 'lazarus', Martha_1: 'martha',
  Simon_1: 'simon_peter', Andrew_1: 'andrew', James_1: 'james_zebedee',
  John_2: 'john_zebedee', James_3: 'james_jesus', Saul_2: 'paul',
  Joseph_12: 'barnabas', Timothy_1: 'timothy', Eunice_1: 'eunice',
  Lois_1: 'lois', Priscilla_1: 'priscilla', Aquila_1: 'aquila',
};

const SYMMETRIC_EDGE_TYPES = new Set<RelationshipKind>(['spouse', 'sibling', 'covenant_friend']);

interface PeopleGraphShardPayload {
  people?: BiblicalPerson[];
  relationships?: PersonRelationship[];
}

function normalizeStrongsKey(code: string): string {
  const cleaned = code.trim().replace(/^lemma:/i, '').toUpperCase();
  const m = /^([HG])0*(\d+)([A-Z]*)$/.exec(cleaned);
  return m ? `${m[1]!}${Number(m[2])}${m[3] ?? ''}` : cleaned;
}

function normalizeStrongs(code: string): string {
  return normalizeStrongsKey(code);
}

function normalizeStrongsSearch(raw: string): string {
  const m = /^([hg])0*(\d+)$/i.exec(raw.trim());
  return m ? `${m[1]!.toLowerCase()}${Number(m[2])}` : raw.trim().toLowerCase();
}

let activePeople: BiblicalPerson[] = [...BIBLICAL_PEOPLE];
let activeRelationships: PersonRelationship[] = [...PERSON_RELATIONSHIPS];
let personById = new Map<string, BiblicalPerson>();
let personIndexOrder = new Map<string, number>();
let adjById = new Map<string, PersonRelationship[]>();
let strongsIndex = new Map<string, BiblicalPerson[]>();
let chapterIndex = new Map<string, Set<BiblicalPerson>>();
let homonymMap = new Map<string, BiblicalPerson[]>();
let explicitEdgeCount = 0;
let inferredEdgeCount = 0;
let fullGraphLoaded = false;
let fullGraphPromise: Promise<boolean> | null = null;

function rebuildGraphIndices(aliases?: Map<string, BiblicalPerson>): void {
  personById = new Map();
  personIndexOrder = new Map();
  adjById = new Map();
  strongsIndex = new Map();
  chapterIndex = new Map();
  homonymMap = new Map();

  const addChapterRef = (book: number, chapter: number, person: BiblicalPerson) => {
    const key = `${book}:${chapter}`;
    let set = chapterIndex.get(key);
    if (!set) {
      set = new Set();
      chapterIndex.set(key, set);
    }
    set.add(person);
  };

  activePeople.forEach((person, idx) => {
    personById.set(person.id, person);
    personIndexOrder.set(person.id, idx);

    if (person.strongs) {
      const seenCodes = new Set<string>();
      for (const raw of person.strongs) {
        const norm = normalizeStrongs(raw);
        if (!norm || seenCodes.has(norm)) continue;
        seenCodes.add(norm);
        let list = strongsIndex.get(norm);
        if (!list) {
          list = [];
          strongsIndex.set(norm, list);
        }
        list.push(person);
      }
    }

    for (const kr of person.keyRefs) {
      addChapterRef(kr.passage.book, kr.passage.chapter, person);
    }

    if (person.homonymGroup) {
      let groupList = homonymMap.get(person.homonymGroup);
      if (!groupList) {
        groupList = [];
        homonymMap.set(person.homonymGroup, groupList);
      }
      groupList.push(person);
    }
  });

  if (aliases) {
    for (const [aliasId, target] of aliases.entries()) {
      if (!personById.has(aliasId)) personById.set(aliasId, target);
    }
  }

  explicitEdgeCount = 0;
  inferredEdgeCount = 0;
  for (const edge of activeRelationships) {
    if (edge.category === 'inferred') inferredEdgeCount++;
    else explicitEdgeCount++;

    let fromList = adjById.get(edge.fromId);
    if (!fromList) {
      fromList = [];
      adjById.set(edge.fromId, fromList);
    }
    fromList.push(edge);

    if (edge.toId !== edge.fromId) {
      let toList = adjById.get(edge.toId);
      if (!toList) {
        toList = [];
        adjById.set(edge.toId, toList);
      }
      toList.push(edge);
    }

    const fromP = personById.get(edge.fromId);
    const toP = personById.get(edge.toId);
    if (fromP) addChapterRef(edge.witnessRef.passage.book, edge.witnessRef.passage.chapter, fromP);
    if (toP) addChapterRef(edge.witnessRef.passage.book, edge.witnessRef.passage.chapter, toP);
  }
}

rebuildGraphIndices();

function mergePeopleShard(payload: PeopleGraphShardPayload): void {
  const shardPeople = Array.isArray(payload.people) ? payload.people : [];
  const shardRels = Array.isArray(payload.relationships) ? payload.relationships : [];
  if (shardPeople.length === 0) return;

  const curatedById = new Map<string, BiblicalPerson>(
    BIBLICAL_PEOPLE.map(p => [p.id, { ...p, strongs: p.strongs ? [...p.strongs] : undefined, keyRefs: [...p.keyRefs] }]),
  );
  const mergedList: BiblicalPerson[] = [...curatedById.values()];
  const aliasMap = new Map<string, BiblicalPerson>();

  for (const raw of shardPeople) {
    const mappedCuratedId = UPSTREAM_TO_CURATED_ID[raw.id];
    if (mappedCuratedId) {
      const curated = curatedById.get(mappedCuratedId);
      if (curated) {
        aliasMap.set(raw.id, curated);
        if (!curated.hebrew && raw.hebrew) curated.hebrew = raw.hebrew;
        if (!curated.greek && raw.greek) curated.greek = raw.greek;
        if (!curated.transliteration && raw.transliteration) curated.transliteration = raw.transliteration;
        if (!curated.sex && raw.sex) curated.sex = raw.sex;
        if (!curated.tribe && raw.tribe) curated.tribe = raw.tribe;
        if (raw.strongs && raw.strongs.length > 0) {
          const mergedStrongs = new Set((curated.strongs ?? []).map(normalizeStrongs));
          for (const s of raw.strongs) mergedStrongs.add(normalizeStrongs(s));
          curated.strongs = [...mergedStrongs];
        }
        continue;
      }
    }
    if (curatedById.has(raw.id)) continue;
    mergedList.push(raw);
  }

  const edgeByKey = new Map<string, PersonRelationship>();
  const edgeKeyFor = (fromId: string, toId: string, type: RelationshipKind) => {
    if (SYMMETRIC_EDGE_TYPES.has(type) && fromId > toId) {
      return `${toId}|${fromId}|${type}`;
    }
    return `${fromId}|${toId}|${type}`;
  };

  for (const rel of PERSON_RELATIONSHIPS) {
    const k = edgeKeyFor(rel.fromId, rel.toId, rel.type);
    edgeByKey.set(k, { ...rel, category: rel.category ?? 'explicit' });
  }

  for (const rawRel of shardRels) {
    const fromId = UPSTREAM_TO_CURATED_ID[rawRel.fromId] ?? rawRel.fromId;
    const toId = UPSTREAM_TO_CURATED_ID[rawRel.toId] ?? rawRel.toId;
    if (!fromId || !toId || fromId === toId) continue;
    const k = edgeKeyFor(fromId, toId, rawRel.type);
    const existing = edgeByKey.get(k);
    if (existing) {
      if (!existing.typeLabel && rawRel.typeLabel) existing.typeLabel = rawRel.typeLabel;
      continue;
    }
    edgeByKey.set(k, {
      ...rawRel,
      fromId,
      toId,
      category: rawRel.category ?? 'inferred',
    });
  }

  activePeople = mergedList;
  activeRelationships = [...edgeByKey.values()];
  fullGraphLoaded = true;
  rebuildGraphIndices(aliasMap);
}

export function isFullPeopleGraphLoaded(): boolean {
  return fullGraphLoaded;
}

export async function loadFullPeopleGraph(): Promise<boolean> {
  if (fullGraphLoaded) return true;
  if (fullGraphPromise) return fullGraphPromise;
  if (typeof fetch !== 'function') return false;

  fullGraphPromise = fetch('/data/bible-people-graph.json')
    .then(async (res) => {
      if (!res.ok) return false;
      const payload = (await res.json()) as PeopleGraphShardPayload;
      mergePeopleShard(payload);
      return fullGraphLoaded;
    })
    .catch(() => false);

  return fullGraphPromise;
}

export function getAllPeople(): readonly BiblicalPerson[] {
  return activePeople;
}

export function getPeopleGraphStats(): PeopleGraphStats {
  return {
    peopleCount: activePeople.length,
    relationshipCount: activeRelationships.length,
    explicitEdges: explicitEdgeCount,
    inferredEdges: inferredEdgeCount,
    loaded: fullGraphLoaded,
  };
}

export function searchPeople(
  query: string,
  group: 'all' | LineageGroup = 'all',
  limit = 40,
): { matches: BiblicalPerson[]; totalMatches: number; totalPeople: number } {
  const q = query.trim().toLowerCase();
  const normQ = q ? normalizeStrongsSearch(q) : '';
  const allMatches: BiblicalPerson[] = [];

  for (const person of activePeople) {
    if (group !== 'all' && person.lineageGroup !== group) continue;
    if (q) {
      const textHit =
        person.name.toLowerCase().includes(q) ||
        (person.disambiguator?.toLowerCase().includes(q) ?? false) ||
        (person.hebrew?.toLowerCase().includes(q) ?? false) ||
        (person.greek?.toLowerCase().includes(q) ?? false) ||
        (person.transliteration?.toLowerCase().includes(q) ?? false) ||
        (person.tribe?.toLowerCase().includes(q) ?? false);
      const strongsHit =
        !textHit &&
        Boolean(
          person.strongs?.some(code => {
            const lower = code.toLowerCase();
            return lower.includes(q) || normalizeStrongsSearch(code) === normQ;
          }),
        );
      if (!textHit && !strongsHit) continue;
    }
    allMatches.push(person);
  }

  return {
    matches: allMatches.slice(0, Math.max(1, limit)),
    totalMatches: allMatches.length,
    totalPeople: activePeople.length,
  };
}

export function getPersonById(id: string): BiblicalPerson | undefined {
  return personById.get(id);
}

export function getHomonyms(person: BiblicalPerson): BiblicalPerson[] {
  if (!person.homonymGroup) return [];
  const group = homonymMap.get(person.homonymGroup) ?? [];
  return group.filter(p => p.id !== person.id);
}

export function detectPeopleForContext(passage: ActivePassage, strongsList: string[]): BiblicalPerson[] {
  const strongsSet = new Set(strongsList.map(normalizeStrongs).filter(Boolean));
  const candidates = new Set<BiblicalPerson>();

  for (const code of strongsSet) {
    const list = strongsIndex.get(code);
    if (list) for (const p of list) candidates.add(p);
  }

  const chapterPeople = chapterIndex.get(`${passage.book}:${passage.chapter}`);
  if (chapterPeople) {
    for (const p of chapterPeople) candidates.add(p);
  }

  const scored: { person: BiblicalPerson; score: number; index: number }[] = [];

  for (const person of candidates) {
    let score = 0;

    if (strongsSet.size > 0 && person.strongs) {
      for (const code of person.strongs) {
        if (strongsSet.has(normalizeStrongs(code))) score += 10;
      }
    }

    for (const kr of person.keyRefs) {
      if (kr.passage.book === passage.book && kr.passage.chapter === passage.chapter) {
        score += kr.passage.verse === passage.verse ? 8 : 3;
      }
    }

    const edges = adjById.get(person.id) ?? [];
    for (const edge of edges) {
      const p = edge.witnessRef.passage;
      if (p.book === passage.book && p.chapter === passage.chapter) {
        score += p.verse === passage.verse ? 6 : 2;
      }
    }

    if (score > 0) {
      scored.push({ person, score, index: personIndexOrder.get(person.id) ?? 99999 });
    }
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
  return scored.map(item => item.person);
}

const GENERIC_NON_PERSON_WORDS = new Set([
  'god', 'lord', 'king', 'queen', 'son', 'sons', 'daughter', 'daughters',
  'father', 'fathers', 'mother', 'mothers', 'brother', 'brothers', 'sister', 'sisters',
  'man', 'men', 'woman', 'women', 'human', 'humans', 'mankind',
  'people', 'peoples', 'nation', 'nations', 'servant', 'servants',
  'priest', 'priests', 'prophet', 'prophets', 'angel', 'angels', 'spirit', 'spirits',
  'child', 'children', 'house', 'city', 'land', 'name', 'word', 'words',
  'day', 'days', 'night', 'one', 'two', 'three', 'first', 'second', 'third',
  'the', 'and', 'of', 'in', 'to', 'for', 'with', 'from', 'by', 'as',
  'is', 'was', 'are', 'were', 'be', 'he', 'she', 'it', 'they', 'them',
  'his', 'her', 'their', 'him', 'who', 'whom', 'which', 'that', 'this', 'these', 'those',
  'all', 'not', 'no', 'yes', 'holy', 'christ', 'messiah', 'elohim', 'yahweh', 'adonai',
]);

const ALIAS_STOP_TOKENS = new Set([
  'the', 'of', 'son', 'sons', 'daughter', 'daughters', 'king', 'queen',
  'priest', 'prophet', 'apostle', 'bar', 'ben', 'elder', 'younger', 'great',
]);

let versePersonIndex: Record<string, string[]> | null = null;
let versePersonIndexPromise: Promise<void> | null = null;

export function loadVersePersonIndex(): Promise<void> {
  if (versePersonIndex) return Promise.resolve();
  if (versePersonIndexPromise) return versePersonIndexPromise;
  if (typeof fetch !== 'function') return Promise.resolve();

  versePersonIndexPromise = fetch('/data/bible-person-verses.json')
    .then(async (res) => {
      if (!res.ok) return;
      const payload = (await res.json()) as unknown;
      if (!payload || typeof payload !== 'object') return;
      const maybeWrapped = (payload as { verses?: unknown }).verses;
      const mapObj = maybeWrapped && typeof maybeWrapped === 'object' ? maybeWrapped : payload;
      versePersonIndex = mapObj as Record<string, string[]>;
    })
    .catch(() => {
      // Safe offline fallback: leave versePersonIndex null without throwing
    });

  return versePersonIndexPromise;
}

export function getPeopleInVerse(passage: ActivePassage): BiblicalPerson[] {
  if (!versePersonIndex) return [];
  const rawIds = versePersonIndex[`${passage.book}:${passage.chapter}:${passage.verse}`];
  if (!Array.isArray(rawIds) || rawIds.length === 0) return [];

  const result: BiblicalPerson[] = [];
  const seen = new Set<string>();
  for (const rawId of rawIds) {
    if (typeof rawId !== 'string' || !rawId) continue;
    const mappedId = UPSTREAM_TO_CURATED_ID[rawId] ?? rawId;
    const person = getPersonById(mappedId) ?? getPersonById(rawId);
    if (!person || seen.has(person.id)) continue;
    seen.add(person.id);
    result.push(person);
  }
  return result;
}

function cleanEnglishWord(raw?: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/['’]s$/i, '')
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeOriginalScript(raw?: string): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0591-\u05C7\u0300-\u036f]/g, '')
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}]/gu, '')
    .toLowerCase();
}

function getPersonEnglishAliases(person: BiblicalPerson): { primary: string[]; tokens: string[] } {
  const primarySet = new Set<string>();
  const tokenSet = new Set<string>();

  const full = cleanEnglishWord(person.name);
  if (full) primarySet.add(full);

  const segments = person.name.split(/[()/,]+/);
  for (const seg of segments) {
    const cleaned = cleanEnglishWord(seg);
    if (!cleaned || cleaned.length < 2) continue;
    primarySet.add(cleaned);
    for (const tok of cleaned.split(/[\s-]+/)) {
      if (tok.length >= 3 && !ALIAS_STOP_TOKENS.has(tok) && !GENERIC_NON_PERSON_WORDS.has(tok)) {
        tokenSet.add(tok);
      }
    }
  }
  return { primary: [...primarySet], tokens: [...tokenSet] };
}

function scorePersonForWord(
  person: BiblicalPerson,
  normStrongs: string,
  normOriginal: string,
  normEnglish: string,
): number {
  let score = 0;

  if (normStrongs && person.strongs?.some(code => normalizeStrongsKey(code) === normStrongs)) {
    score += 100;
    if ((normStrongs === 'H3478' || normStrongs === 'G2474') && person.id === 'jacob') {
      score += 100;
    }
  }

  if (normOriginal) {
    const scriptForms = [person.hebrew, person.greek]
      .filter((s): s is string => Boolean(s))
      .flatMap(s => s.split(/[/,]+/))
      .map(normalizeOriginalScript)
      .filter(Boolean);
    if (scriptForms.some(form => form === normOriginal)) {
      score += 70;
    }
  }

  if (normEnglish && !GENERIC_NON_PERSON_WORDS.has(normEnglish)) {
    const aliases = getPersonEnglishAliases(person);
    if (aliases.primary.some(a => a === normEnglish)) {
      score += 65;
    } else if (aliases.tokens.some(t => t === normEnglish)) {
      score += 40;
    }
  }

  return score;
}

export function resolvePersonForWordInVerse(args: {
  passage: ActivePassage;
  strongs?: string;
  english?: string;
  original?: string;
}): { person: BiblicalPerson; matchedByVerse: boolean; homonyms: BiblicalPerson[] } | null {
  const normEnglish = cleanEnglishWord(args.english);
  if (normEnglish && GENERIC_NON_PERSON_WORDS.has(normEnglish)) {
    return null;
  }

  const normStrongs = args.strongs ? normalizeStrongsKey(args.strongs) : '';
  const normOriginal = normalizeOriginalScript(args.original);
  if (!normStrongs && !normOriginal && !normEnglish) {
    return null;
  }

  // Step A: Match among people explicitly attested in this verse
  const versePeople = getPeopleInVerse(args.passage);
  if (versePeople.length > 0) {
    let bestPerson: BiblicalPerson | null = null;
    let bestScore = 0;
    for (const person of versePeople) {
      const score = scorePersonForWord(person, normStrongs, normOriginal, normEnglish);
      if (score > bestScore) {
        bestScore = score;
        bestPerson = person;
      }
    }
    if (bestPerson) {
      return {
        person: bestPerson,
        matchedByVerse: true,
        homonyms: getHomonyms(bestPerson),
      };
    }
  }

  // Step B: Fallback across loaded graph / curated people ranked by passage context
  const contextMatches = detectPeopleForContext(args.passage, normStrongs ? [normStrongs] : []);
  const contextBonus = new Map<string, number>();
  contextMatches.forEach((p, idx) => {
    contextBonus.set(p.id, Math.max(5, 35 - idx * 3));
  });

  const isNt = args.passage.book >= 40;
  let bestFallback: BiblicalPerson | null = null;
  let bestFallbackScore = 0;
  let bestIndex = Number.MAX_SAFE_INTEGER;

  for (const person of activePeople) {
    const wordScore = scorePersonForWord(person, normStrongs, normOriginal, normEnglish);
    if (wordScore <= 0) continue;

    let totalScore = wordScore + (contextBonus.get(person.id) ?? 0);
    const hasMatchingTestamentRef = person.keyRefs.some(kr => (isNt ? kr.passage.book >= 40 : kr.passage.book < 40));
    if (hasMatchingTestamentRef) totalScore += 15;
    if (isNt && person.lineageGroup === 'gospels_apostles') totalScore += 10;

    const orderIdx = personIndexOrder.get(person.id) ?? Number.MAX_SAFE_INTEGER;
    if (
      totalScore > bestFallbackScore ||
      (totalScore === bestFallbackScore && orderIdx < bestIndex)
    ) {
      bestFallbackScore = totalScore;
      bestFallback = person;
      bestIndex = orderIdx;
    }
  }

  if (!bestFallback) return null;
  return {
    person: bestFallback,
    matchedByVerse: false,
    homonyms: getHomonyms(bestFallback),
  };
}

// === @section:logic:neighborhood ===
const MAX_NEIGHBORHOOD_NODES = 22;

function formatSocialRoleText(edge: PersonRelationship, focusId: string): string {
  if (edge.type === 'mentor_disciple') {
    if (edge.typeLabel === 'master' || edge.typeLabel === 'servant') {
      return edge.fromId === focusId ? 'Servant' : 'Master';
    }
    if (edge.typeLabel === 'patron' || edge.typeLabel === 'client') {
      return edge.fromId === focusId ? 'Client' : 'Patron';
    }
    if (edge.typeLabel && edge.typeLabel !== 'rabbi' && edge.typeLabel !== 'disciple') {
      return edge.fromId === focusId ? `Subordinate (${edge.typeLabel})` : `Leader (${edge.typeLabel})`;
    }
    return edge.fromId === focusId ? 'Disciple' : 'Mentor';
  }
  if (edge.type === 'successor') {
    if (edge.typeLabel === 'Heir') return edge.fromId === focusId ? 'Heir' : 'Preceded by';
    return edge.fromId === focusId ? 'Successor' : 'Predecessor';
  }
  if (edge.type === 'adversary') {
    return edge.fromId === focusId ? 'Slew' : 'Killed by';
  }
  if (edge.type === 'covenant_friend') {
    if (edge.typeLabel) {
      return edge.typeLabel.charAt(0).toUpperCase() + edge.typeLabel.slice(1);
    }
    return 'Covenant Friend';
  }
  return '';
}

export function buildBoundedFamilyNeighborhood(
  centerId: string,
  maxGenerations: 1 | 2 = 2,
): FamilyNeighborhood | null {
  const focus = getPersonById(centerId);
  if (!focus) return null;

  const seenNodes = new Set<string>([focus.id]);
  let truncated = false;

  const canIncludeNode = (personId: string): boolean => {
    if (seenNodes.has(personId)) return true;
    if (seenNodes.size >= MAX_NEIGHBORHOOD_NODES) {
      truncated = true;
      return false;
    }
    seenNodes.add(personId);
    return true;
  };

  const parents: { person: BiblicalPerson; edge: PersonRelationship }[] = [];
  const parentIds = new Set<string>();
  const spouses: { person: BiblicalPerson; edge: PersonRelationship }[] = [];
  const spouseIds = new Set<string>();
  const siblings: { person: BiblicalPerson; edge: PersonRelationship }[] = [];
  const siblingIds = new Set<string>();
  const children: { person: BiblicalPerson; edge: PersonRelationship }[] = [];
  const childIds = new Set<string>();
  const socialLinks: { person: BiblicalPerson; edge: PersonRelationship; roleText: string }[] = [];
  const socialByPerson = new Map<string, { person: BiblicalPerson; edge: PersonRelationship; roleText: string }>();

  const focusEdges = adjById.get(focus.id) ?? [];

  // 1. Direct parents (`fromId` -> `toId === focus.id`)
  for (const edge of focusEdges) {
    if ((edge.type === 'father' || edge.type === 'mother') && edge.toId === focus.id) {
      const parent = getPersonById(edge.fromId);
      if (!parent || parentIds.has(parent.id)) continue;
      if (!canIncludeNode(parent.id)) continue;
      parentIds.add(parent.id);
      parents.push({ person: parent, edge });
    }
  }

  // 2. Direct spouses (symmetric)
  for (const edge of focusEdges) {
    if (edge.type !== 'spouse') continue;
    const otherId = edge.fromId === focus.id ? edge.toId : edge.toId === focus.id ? edge.fromId : null;
    if (!otherId || spouseIds.has(otherId)) continue;
    const other = getPersonById(otherId);
    if (!other || !canIncludeNode(other.id)) continue;
    spouseIds.add(other.id);
    spouses.push({ person: other, edge });
  }

  // 3. Direct siblings (symmetric)
  for (const edge of focusEdges) {
    if (edge.type !== 'sibling') continue;
    const otherId = edge.fromId === focus.id ? edge.toId : edge.toId === focus.id ? edge.fromId : null;
    if (!otherId || siblingIds.has(otherId)) continue;
    const other = getPersonById(otherId);
    if (!other || !canIncludeNode(other.id)) continue;
    siblingIds.add(other.id);
    siblings.push({ person: other, edge });
  }

  // 4. Direct children (`fromId === focus.id` -> `toId`)
  for (const edge of focusEdges) {
    if ((edge.type === 'father' || edge.type === 'mother') && edge.fromId === focus.id) {
      const child = getPersonById(edge.toId);
      if (!child || childIds.has(child.id)) continue;
      if (!canIncludeNode(child.id)) continue;
      childIds.add(child.id);
      children.push({ person: child, edge });
    }
  }

  // 5. Direct social/mentorship/succession/adversary links
  for (const edge of focusEdges) {
    if (
      edge.type !== 'mentor_disciple' &&
      edge.type !== 'successor' &&
      edge.type !== 'covenant_friend' &&
      edge.type !== 'adversary'
    ) {
      continue;
    }
    const otherId = edge.fromId === focus.id ? edge.toId : edge.toId === focus.id ? edge.fromId : null;
    if (!otherId) continue;
    const other = getPersonById(otherId);
    if (!other) continue;
    const roleText = formatSocialRoleText(edge, focus.id);
    if (!roleText) continue;
    const existing = socialByPerson.get(other.id);
    if (existing) {
      if (!existing.roleText.includes(roleText)) {
        existing.roleText = `${existing.roleText} & ${roleText}`;
      }
      continue;
    }
    if (!canIncludeNode(other.id)) continue;
    const item = { person: other, edge, roleText };
    socialByPerson.set(other.id, item);
    socialLinks.push(item);
  }

  const grandparents: { person: BiblicalPerson; via: string; edge: PersonRelationship }[] = [];
  const grandparentIds = new Set<string>();
  const grandchildren: { person: BiblicalPerson; via: string; edge: PersonRelationship }[] = [];
  const grandchildIds = new Set<string>();

  if (maxGenerations === 2) {
    // 6. Grandparents via parents
    for (const parentItem of parents) {
      for (const edge of adjById.get(parentItem.person.id) ?? []) {
        if ((edge.type === 'father' || edge.type === 'mother') && edge.toId === parentItem.person.id) {
          const gp = getPersonById(edge.fromId);
          if (!gp || gp.id === focus.id || grandparentIds.has(gp.id)) continue;
          if (!canIncludeNode(gp.id)) continue;
          grandparentIds.add(gp.id);
          grandparents.push({ person: gp, via: parentItem.person.name, edge });
        }
      }
    }

    // 7. Grandchildren via children
    for (const childItem of children) {
      for (const edge of adjById.get(childItem.person.id) ?? []) {
        if ((edge.type === 'father' || edge.type === 'mother') && edge.fromId === childItem.person.id) {
          const gc = getPersonById(edge.toId);
          if (!gc || gc.id === focus.id || grandchildIds.has(gc.id)) continue;
          if (!canIncludeNode(gc.id)) continue;
          grandchildIds.add(gc.id);
          grandchildren.push({ person: gc, via: childItem.person.name, edge });
        }
      }
    }
  }

  return {
    focus,
    parents,
    grandparents,
    spouses,
    siblings,
    children,
    grandchildren,
    socialLinks,
    nodeCount: seenNodes.size,
    truncated,
  };
}
