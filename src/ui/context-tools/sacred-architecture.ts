// @file: src/ui/context-tools/sacred-architecture.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: imports | types | data:plans | logic:normalize | logic:detection | ui:svg

// === @section:imports ===
import type { ActivePassage } from '../../api/types';

// === @section:types ===
export type ArchitecturePlanId = 'tabernacle' | 'first_temple' | 'second_temple' | 'jerusalem_gates';

export interface ArchitectureElement {
  id: string;
  planId: ArchitecturePlanId;
  name: string;
  hebrew?: string;
  greek?: string;
  transliteration?: string;
  strongs: string[];
  phraseKeywords?: string[];
  zone: string;
  dimensions?: string;
  summary: string;
  historicalNote?: string;
  sourceRefs: { label: string; passage: ActivePassage }[];
  svgBox: { x: number; y: number; w: number; h: number; shape?: 'rect' | 'circle' | 'gate' };
}

export interface ArchitecturePlan {
  id: ArchitecturePlanId;
  title: string;
  subtitle: string;
  eraLabel: string;
  epistemicNote: string;
  viewBox: string;
  elements: ArchitectureElement[];
}

export interface ArchitectureDetection {
  planId: ArchitecturePlanId;
  element: ArchitectureElement;
  reason: string;
}

export interface VerseTokenLike {
  strongs_nr: string;
  word_position: number;
  selected_english?: string | null;
  source_english?: string | null;
}

interface ElementVisualMeta {
  shortLabel: string;
  labelX: number;
  labelY: number;
  anchor?: 'start' | 'middle' | 'end';
  subLabel?: string;
  isZoneBackdrop?: boolean;
}

// === @section:data:plans ===
const TABERNACLE_ELEMENTS: ArchitectureElement[] = [
  {
    id: 'outer_courtyard',
    planId: 'tabernacle',
    name: 'Outer Courtyard',
    hebrew: 'חָצֵר',
    transliteration: 'Chatser',
    strongs: ['H2691'],
    phraseKeywords: ['courtyard', 'court of the tabernacle'],
    zone: 'Outer Perimeter',
    dimensions: '100 × 50 cubits (≈ 150 × 75 ft); linen hangings 5 cubits high',
    summary:
      'Rectangular sacred enclosure oriented East–West, fenced by fine twined linen curtains suspended from bronze-socketed acacia pillars.',
    historicalNote:
      'Constructed as a portable desert sanctuary (Exod 27:9–18; 38:9–20). Only Levites and priests officiated inside; worshipers brought offerings to the eastern entrance.',
    sourceRefs: [
      { label: 'Exod 27:9', passage: { book: 2, chapter: 27, verse: 9 } },
      { label: 'Exod 38:9', passage: { book: 2, chapter: 38, verse: 9 } },
      { label: 'Exod 40:8', passage: { book: 2, chapter: 40, verse: 8 } },
    ],
    svgBox: { x: 56, y: 76, w: 560, h: 288, shape: 'rect' },
  },
  {
    id: 'courtyard_gate',
    planId: 'tabernacle',
    name: 'Courtyard Gate (East Screen)',
    hebrew: 'שַׁעַר הֶחָצֵר / מָסָךְ',
    transliteration: "Sha'ar HeChatser / Masak",
    strongs: ['H8179', 'H4539'],
    phraseKeywords: ['gate of the court', 'screen for the gate', 'courtyard gate'],
    zone: 'East Entrance',
    dimensions: '20 cubits wide × 5 cubits high',
    summary:
      'Single embroidered screen of blue, purple, and crimson yarn with fine twined linen set on the eastern side of the courtyard.',
    historicalNote:
      'Facing sunrise (East), the sole entrance established the inward progression from outer court sacrifice toward the westernmost Holy of Holies.',
    sourceRefs: [
      { label: 'Exod 27:16', passage: { book: 2, chapter: 27, verse: 16 } },
      { label: 'Exod 38:18', passage: { book: 2, chapter: 38, verse: 18 } },
    ],
    svgBox: { x: 604, y: 176, w: 24, h: 88, shape: 'gate' },
  },
  {
    id: 'bronze_altar',
    planId: 'tabernacle',
    name: 'Bronze Altar of Burnt Offering',
    hebrew: 'מִזְבַּח הָעֹלָה / מִזְבֵּחַ',
    transliteration: 'Mizbach HaOlah',
    strongs: ['H4196', 'H5178'],
    phraseKeywords: ['bronze altar', 'brazen altar', 'altar of burnt offering', 'burnt offering'],
    zone: 'East Courtyard',
    dimensions: '5 × 5 × 3 cubits (hollow acacia frame overlaid with bronze)',
    summary:
      'Four-horned bronze-clad altar positioned inside the eastern courtyard gate for daily tamid and sacrificial offerings.',
    historicalNote:
      'Equipped with a bronze grating midway up and carrying poles (Exod 27:1–8; 38:1–7). Horns served both for blood application and sanctuary asylum.',
    sourceRefs: [
      { label: 'Exod 27:1', passage: { book: 2, chapter: 27, verse: 1 } },
      { label: 'Exod 38:1', passage: { book: 2, chapter: 38, verse: 1 } },
      { label: 'Lev 1:5', passage: { book: 3, chapter: 1, verse: 5 } },
    ],
    svgBox: { x: 496, y: 192, w: 56, h: 56, shape: 'rect' },
  },
  {
    id: 'bronze_laver',
    planId: 'tabernacle',
    name: 'Bronze Laver (Washbasin)',
    hebrew: 'כִּיּוֹר',
    transliteration: 'Kiyyor',
    strongs: ['H3595'],
    phraseKeywords: ['bronze laver', 'basin of bronze', 'laver'],
    zone: 'Courtyard (Between Altar & Tent)',
    dimensions: 'Circular bronze basin on pedestal (no explicit cubit dimensions recorded)',
    summary:
      'Ritual washbasin placed between the Tent of Meeting and the Bronze Altar where priests washed hands and feet before ministering.',
    historicalNote:
      'Cast from the bronze mirrors of the women serving at the entrance of the Tent of Meeting (Exod 30:17–21; 38:8).',
    sourceRefs: [
      { label: 'Exod 30:18', passage: { book: 2, chapter: 30, verse: 18 } },
      { label: 'Exod 38:8', passage: { book: 2, chapter: 38, verse: 8 } },
      { label: 'Exod 40:30', passage: { book: 2, chapter: 40, verse: 30 } },
    ],
    svgBox: { x: 420, y: 199, w: 42, h: 42, shape: 'circle' },
  },
  {
    id: 'tent_holy_place',
    planId: 'tabernacle',
    name: 'Holy Place (Tent of Meeting)',
    hebrew: 'קֹדֶשׁ / אֹהֶל מוֹעֵד',
    transliteration: 'Qodesh / Ohel Moed',
    strongs: ['H6944', 'H0168', 'H4908'],
    phraseKeywords: ['holy place', 'tent of meeting', 'tabernacle'],
    zone: 'Sanctuary Outer Chamber',
    dimensions: '20 × 10 × 10 cubits (eastern two-thirds of the 30 × 10 cubit Mishkan)',
    summary:
      'Gold-plated acacia board chamber housing the Table of Showbread (North), Golden Menorah (South), and Altar of Incense (West before the Veil).',
    historicalNote:
      'Covered by four layered textiles: cherubim-woven inner linen, goat-hair tent, ram skins dyed red, and protective outer skins (Exod 26:1–14).',
    sourceRefs: [
      { label: 'Exod 26:33', passage: { book: 2, chapter: 26, verse: 33 } },
      { label: 'Exod 40:22', passage: { book: 2, chapter: 40, verse: 22 } },
      { label: 'Heb 9:2', passage: { book: 58, chapter: 9, verse: 2 } },
    ],
    svgBox: { x: 204, y: 132, w: 188, h: 176, shape: 'rect' },
  },
  {
    id: 'table_showbread',
    planId: 'tabernacle',
    name: 'Table of Showbread',
    hebrew: 'שֻׁלְחַן הַפָּנִים',
    transliteration: 'Shulchan HaPanim',
    strongs: ['H7979', 'H3899'],
    phraseKeywords: ['table of showbread', 'bread of the presence', 'showbread'],
    zone: 'Holy Place (North Side)',
    dimensions: '2 × 1 × 1.5 cubits (acacia wood overlaid with pure gold)',
    summary:
      'Golden table stationed on the North side of the Holy Place bearing twelve unleavened loaves of the Bread of the Presence renewed each Sabbath.',
    historicalNote:
      'Positioned opposite the Menorah so lamplight illuminated the twelve loaves representing the twelve tribes (Exod 25:23–30; 26:35; Lev 24:5–9).',
    sourceRefs: [
      { label: 'Exod 25:23', passage: { book: 2, chapter: 25, verse: 23 } },
      { label: 'Exod 26:35', passage: { book: 2, chapter: 26, verse: 35 } },
      { label: 'Lev 24:5', passage: { book: 3, chapter: 24, verse: 5 } },
    ],
    svgBox: { x: 292, y: 158, w: 74, h: 34, shape: 'rect' },
  },
  {
    id: 'menorah',
    planId: 'tabernacle',
    name: 'Golden Lampstand (Menorah)',
    hebrew: 'מְנוֹרָה',
    transliteration: 'Menorah',
    strongs: ['H4501'],
    phraseKeywords: ['lampstand', 'golden lampstand', 'menorah', 'candlestick'],
    zone: 'Holy Place (South Side)',
    dimensions: 'Hammered from 1 talent (≈ 34 kg) of pure gold; 7 oil lamps',
    summary:
      'Seven-branched golden lampstand shaped with almond-blossom cups, buds, and flowers, positioned on the South side of the Holy Place.',
    historicalNote:
      'Tended morning and evening with pure beaten olive oil so light shone "over against the table" (Exod 25:31–40; 27:20–21; Num 8:1–4).',
    sourceRefs: [
      { label: 'Exod 25:31', passage: { book: 2, chapter: 25, verse: 31 } },
      { label: 'Exod 37:17', passage: { book: 2, chapter: 37, verse: 17 } },
      { label: 'Num 8:2', passage: { book: 4, chapter: 8, verse: 2 } },
    ],
    svgBox: { x: 292, y: 242, w: 74, h: 34, shape: 'rect' },
  },
  {
    id: 'incense_altar',
    planId: 'tabernacle',
    name: 'Golden Altar of Incense',
    hebrew: 'מִזְבַּח הַקְּטֹרֶת',
    transliteration: 'Mizbach HaQetoret',
    strongs: ['H7004', 'H4196'],
    phraseKeywords: ['altar of incense', 'golden altar', 'sweet incense', 'incense'],
    zone: 'Holy Place (Before the Veil)',
    dimensions: '1 × 1 × 2 cubits (gold-overlaid acacia wood with crown molding)',
    summary:
      'Small horned golden altar set directly east of the Inner Veil before the Ark, where sacred compound incense burned morning and evening.',
    historicalNote:
      'No animal burnt offerings were made on it; its horns received atonement blood once a year on Yom Kippur (Exod 30:1–10; Lev 16:18).',
    sourceRefs: [
      { label: 'Exod 30:1', passage: { book: 2, chapter: 30, verse: 1 } },
      { label: 'Exod 30:6', passage: { book: 2, chapter: 30, verse: 6 } },
      { label: 'Exod 40:26', passage: { book: 2, chapter: 40, verse: 26 } },
    ],
    svgBox: { x: 222, y: 200, w: 40, h: 40, shape: 'rect' },
  },
  {
    id: 'veil',
    planId: 'tabernacle',
    name: 'Inner Veil (Parokhet)',
    hebrew: 'פָּרֹכֶת',
    transliteration: 'Parokhet',
    strongs: ['H6532'],
    phraseKeywords: ['inner veil', 'veil', 'curtain'],
    zone: 'Sanctuary Partition',
    dimensions: '10 × 10 cubits hung on 4 gold-overlaid pillars',
    summary:
      'Woven curtain of blue, purple, crimson, and fine linen embroidered with cherubim separating the Holy Place from the Most Holy Place.',
    historicalNote:
      'Crossed only by the High Priest on the Day of Atonement (Lev 16:2, 12–15). Referenced in Hebrews 9:3 and 10:19–20.',
    sourceRefs: [
      { label: 'Exod 26:31', passage: { book: 2, chapter: 26, verse: 31 } },
      { label: 'Lev 16:2', passage: { book: 3, chapter: 16, verse: 2 } },
      { label: 'Heb 9:3', passage: { book: 58, chapter: 9, verse: 3 } },
    ],
    svgBox: { x: 198, y: 134, w: 12, h: 172, shape: 'gate' },
  },
  {
    id: 'tent_most_holy',
    planId: 'tabernacle',
    name: 'Most Holy Place (Holy of Holies)',
    hebrew: 'קֹדֶשׁ הַקֳּדָשִׁים',
    transliteration: 'Qodesh HaQodashim',
    strongs: ['H6944'],
    phraseKeywords: ['most holy place', 'holy of holies'],
    zone: 'Westernmost Inner Cube',
    dimensions: '10 × 10 × 10 cubits (perfect cube at West end)',
    summary:
      'Innermost cubic chamber behind the Veil housing only the Ark of the Covenant and its Mercy Seat.',
    historicalNote:
      'Entered exclusively on Yom Kippur with incense cloud and sacrificial blood (Exod 26:33–34; Lev 16:12–17).',
    sourceRefs: [
      { label: 'Exod 26:34', passage: { book: 2, chapter: 26, verse: 34 } },
      { label: 'Lev 16:16', passage: { book: 3, chapter: 16, verse: 16 } },
    ],
    svgBox: { x: 96, y: 132, w: 108, h: 176, shape: 'rect' },
  },
  {
    id: 'mercy_seat',
    planId: 'tabernacle',
    name: 'Mercy Seat & Cherubim',
    hebrew: 'כַּפֹּרֶת / כְּרוּבִים',
    transliteration: 'Kapporet & Keruvim',
    strongs: ['H3727', 'H3742'],
    phraseKeywords: ['mercy seat', 'atonement cover', 'cherubim'],
    zone: 'Most Holy Place (Top of Ark)',
    dimensions: '2.5 × 1.5 cubits solid gold lid with two hammered gold cherubim',
    summary:
      'Solid-gold atonement lid atop the Ark flanked by two facing winged cherubim whose wings overshadowed the cover.',
    historicalNote:
      'Identified as the earthly locus where YHWH spoke from above the kapporet between the two cherubim (Exod 25:17–22; Num 7:89).',
    sourceRefs: [
      { label: 'Exod 25:17', passage: { book: 2, chapter: 25, verse: 17 } },
      { label: 'Lev 16:14', passage: { book: 3, chapter: 16, verse: 14 } },
      { label: 'Num 7:89', passage: { book: 4, chapter: 7, verse: 89 } },
    ],
    svgBox: { x: 118, y: 164, w: 62, h: 34, shape: 'rect' },
  },
  {
    id: 'ark_covenant',
    planId: 'tabernacle',
    name: 'Ark of the Covenant',
    hebrew: 'אֲרוֹן הַבְּרִית / הָעֵדֻת',
    transliteration: 'Aron HaBerit / HaEdut',
    strongs: ['H0727', 'H1285', 'H5715'],
    phraseKeywords: ['ark of the covenant', 'ark of the testimony', 'ark'],
    zone: 'Most Holy Place (West End)',
    dimensions: '2.5 × 1.5 × 1.5 cubits (acacia chest overlaid inside & out with pure gold)',
    summary:
      'Gold-overlaid sacred chest holding the Tablets of the Testimony, carried by permanently inserted gold-clad poles.',
    historicalNote:
      'Also associated with the jar of manna and Aaron’s budded staff (Exod 16:33–34; Num 17:10; Heb 9:4).',
    sourceRefs: [
      { label: 'Exod 25:10', passage: { book: 2, chapter: 25, verse: 10 } },
      { label: 'Exod 37:1', passage: { book: 2, chapter: 37, verse: 1 } },
      { label: 'Heb 9:4', passage: { book: 58, chapter: 9, verse: 4 } },
    ],
    svgBox: { x: 118, y: 214, w: 62, h: 36, shape: 'rect' },
  },
];

const FIRST_TEMPLE_ELEMENTS: ArchitectureElement[] = [
  {
    id: 'first_inner_court',
    planId: 'first_temple',
    name: 'Inner Court of the Temple',
    hebrew: 'הֶחָצֵר הַפְּנִימִית',
    transliteration: 'HeChatser HaPenimit',
    strongs: ['H2691'],
    phraseKeywords: ['inner court', 'court of the priests'],
    zone: 'Temple Forecourt',
    dimensions: 'Built with 3 courses of hewn stone and 1 course of cedar beams (1 Kgs 6:36)',
    summary:
      'Walled priestly enclosure surrounding Solomon’s sanctuary, housing the monumental Burnt Offering Altar, Bronze Sea, and Ten Lavers.',
    historicalNote:
      'Surrounded by the Great Court (2 Chr 4:9). Excavations outside the Temple Mount cannot probe the pre-exilic platform directly; layout rests on 1 Kgs 6–7 & 2 Chr 3–4.',
    sourceRefs: [
      { label: '1 Kgs 6:36', passage: { book: 11, chapter: 6, verse: 36 } },
      { label: '2 Chr 4:9', passage: { book: 14, chapter: 4, verse: 9 } },
    ],
    svgBox: { x: 42, y: 62, w: 610, h: 320, shape: 'rect' },
  },
  {
    id: 'side_chambers',
    planId: 'first_temple',
    name: 'Three-Story Side Chambers',
    hebrew: 'הַיָּצִיעַ / צְלָעוֹת',
    transliteration: 'HaYatsia / Tselaot',
    strongs: ['H6763', 'H3326'],
    phraseKeywords: ['side chambers', 'three stories'],
    zone: 'North, West & South Exterior Perimeter',
    dimensions: '3 stories: 5, 6, and 7 cubits wide (5 cubits high per story)',
    summary:
      'Three-tiered storage and priestly annex wrapping the North, West, and South walls of the Hekal and Debir without piercing the sanctuary stone.',
    historicalNote:
      'Resting on stepped ledges (recesses) in the outer masonry wall and linked internally by winding stairs (1 Kgs 6:5–10).',
    sourceRefs: [
      { label: '1 Kgs 6:5', passage: { book: 11, chapter: 6, verse: 5 } },
      { label: '1 Kgs 6:8', passage: { book: 11, chapter: 6, verse: 8 } },
    ],
    svgBox: { x: 78, y: 108, w: 302, h: 228, shape: 'rect' },
  },
  {
    id: 'debir',
    planId: 'first_temple',
    name: 'Most Holy Place (Debir)',
    hebrew: 'דְּבִיר',
    transliteration: 'Debir',
    strongs: ['H1687'],
    phraseKeywords: ['inner sanctuary', 'debir', 'most holy place', 'holy of holies'],
    zone: 'Western Sanctuary Cube',
    dimensions: '20 × 20 × 20 cubits (double the Tabernacle cube)',
    summary:
      'Cedar-lined and gold-overlaid cubic inner oracle separated from the Hekal by a cedar partition, golden chains, and olivewood doors.',
    historicalNote:
      'Unlike the portable Tabernacle, Solomon’s Debir featured carved olivewood doors plus a veil (2 Chr 3:14) and stood windowless (1 Kgs 8:12).',
    sourceRefs: [
      { label: '1 Kgs 6:19', passage: { book: 11, chapter: 6, verse: 19 } },
      { label: '1 Kgs 8:6', passage: { book: 11, chapter: 8, verse: 6 } },
      { label: '2 Chr 3:8', passage: { book: 14, chapter: 3, verse: 8 } },
    ],
    svgBox: { x: 106, y: 140, w: 108, h: 164, shape: 'rect' },
  },
  {
    id: 'solomon_ark_cherubim',
    planId: 'first_temple',
    name: 'Ark & Monumental Cherubim',
    hebrew: 'אֲרוֹן וּכְרוּבִים',
    transliteration: 'Aron uKeruvim',
    strongs: ['H0727', 'H3742'],
    phraseKeywords: ['cherubim', 'ark of the covenant', 'two cherubim'],
    zone: 'Inside the Debir',
    dimensions: 'Two 10-cubit tall olivewood cherubim (20-cubit combined wingspan)',
    summary:
      'Moses’ golden Ark placed beneath two colossal 10-cubit gold-overlaid olivewood cherubim whose outstretched wings spanned the entire 20-cubit Debir.',
    historicalNote:
      'The Ark’s poles were so long their tips could be seen from the Hekal immediately outside the Debir (1 Kgs 8:6–9).',
    sourceRefs: [
      { label: '1 Kgs 6:23', passage: { book: 11, chapter: 6, verse: 23 } },
      { label: '1 Kgs 8:6', passage: { book: 11, chapter: 8, verse: 6 } },
      { label: '2 Chr 3:10', passage: { book: 14, chapter: 3, verse: 10 } },
    ],
    svgBox: { x: 124, y: 184, w: 72, h: 74, shape: 'rect' },
  },
  {
    id: 'hekal',
    planId: 'first_temple',
    name: 'Main Hall (Hekal)',
    hebrew: 'הֵיכָל',
    transliteration: 'Hekal',
    strongs: ['H1964'],
    phraseKeywords: ['hekal', 'main hall', 'nave', 'temple hall'],
    zone: 'Central Sanctuary Hall',
    dimensions: '40 × 20 × 30 cubits (stone walls lined with carved cedar & gold)',
    summary:
      'Grand central nave paneled in Lebanon cedar carved with gourds, open flowers, palms, and cherubim, housing ten lampstands, ten tables, and the incense altar.',
    historicalNote:
      'Entered through folding cypress doors carved with cherubim and palm trees (1 Kgs 6:17, 29–35).',
    sourceRefs: [
      { label: '1 Kgs 6:17', passage: { book: 11, chapter: 6, verse: 17 } },
      { label: '1 Kgs 6:29', passage: { book: 11, chapter: 6, verse: 29 } },
    ],
    svgBox: { x: 214, y: 140, w: 166, h: 164, shape: 'rect' },
  },
  {
    id: 'first_incense_altar',
    planId: 'first_temple',
    name: 'Cedar-Gold Altar of Incense',
    hebrew: 'מִזְבַּח הַקְּטֹרֶת',
    transliteration: 'Mizbach HaQetoret',
    strongs: ['H7004', 'H4196'],
    phraseKeywords: ['altar of incense', 'golden altar', 'cedar altar'],
    zone: 'Hekal (Before the Debir)',
    dimensions: 'Cedar altar overlaid completely in gold before the inner oracle',
    summary:
      'Golden incense altar belonging to the inner sanctuary, positioned centrally at the western threshold of the Hekal.',
    historicalNote:
      'Cited in 1 Kgs 6:20–22 and 7:48 as overlaid with pure gold and standing directly before the Debir.',
    sourceRefs: [
      { label: '1 Kgs 6:22', passage: { book: 11, chapter: 6, verse: 22 } },
      { label: '1 Kgs 7:48', passage: { book: 11, chapter: 7, verse: 48 } },
    ],
    svgBox: { x: 226, y: 204, w: 36, h: 36, shape: 'rect' },
  },
  {
    id: 'ten_tables',
    planId: 'first_temple',
    name: 'Ten Tables of Showbread',
    hebrew: 'שֻׁלְחָנוֹת עֲשָׂרָה',
    transliteration: 'Shulchanot Asarah',
    strongs: ['H7979'],
    phraseKeywords: ['ten tables', 'tables of showbread', 'table of showbread'],
    zone: 'Hekal (North & South Rows)',
    dimensions: '10 golden tables (5 on North, 5 on South; 2 Chr 4:8)',
    summary:
      'Ten gold-clad tables arrayed along the Hekal walls for the Bread of the Presence, expanding the single Tabernacle table.',
    historicalNote:
      '1 Kgs 7:48 summarizes "the table of gold" while 2 Chr 4:8 details ten tables arranged five on the right and five on the left.',
    sourceRefs: [
      { label: '2 Chr 4:8', passage: { book: 14, chapter: 4, verse: 8 } },
      { label: '1 Kgs 7:48', passage: { book: 11, chapter: 7, verse: 48 } },
    ],
    svgBox: { x: 280, y: 164, w: 86, h: 30, shape: 'rect' },
  },
  {
    id: 'ten_lampstands',
    planId: 'first_temple',
    name: 'Ten Golden Lampstands',
    hebrew: 'מְנֹרוֹת הַזָּהָב',
    transliteration: 'Menoroth HaZahav',
    strongs: ['H4501'],
    phraseKeywords: ['ten lampstands', 'golden lampstands', 'lampstands'],
    zone: 'Hekal (5 South, 5 North)',
    dimensions: '10 pure gold lampstands before the inner sanctuary (1 Kgs 7:49)',
    summary:
      'Ten golden lampstands flanking the approach to the Debir—five on the South side and five on the North side.',
    historicalNote:
      'Carried into exile by Nebuchadnezzar in 586 BCE (Jer 52:19); only one seven-branched Menorah stood in the Second Temple.',
    sourceRefs: [
      { label: '1 Kgs 7:49', passage: { book: 11, chapter: 7, verse: 49 } },
      { label: '2 Chr 4:7', passage: { book: 14, chapter: 4, verse: 7 } },
    ],
    svgBox: { x: 280, y: 244, w: 86, h: 30, shape: 'rect' },
  },
  {
    id: 'ulam_porch',
    planId: 'first_temple',
    name: 'Porch / Vestibule (Ulam)',
    hebrew: 'אוּלָם',
    transliteration: 'Ulam',
    strongs: ['H0197'],
    phraseKeywords: ['porch', 'vestibule', 'ulam'],
    zone: 'East Facade of Temple',
    dimensions: '20 cubits wide (N–S) × 10 cubits deep (E–W)',
    summary:
      'Monumental eastern vestibule framing the entrance into the Hekal, flanked at its threshold by the bronze pillars Jachin and Boaz.',
    historicalNote:
      '2 Chr 3:4 describes the Ulam rising 120 cubits (possibly a towered facade or textual variant alongside 20/30 cubits in 1 Kgs 6:2–3).',
    sourceRefs: [
      { label: '1 Kgs 6:3', passage: { book: 11, chapter: 6, verse: 3 } },
      { label: '2 Chr 3:4', passage: { book: 14, chapter: 3, verse: 4 } },
    ],
    svgBox: { x: 380, y: 140, w: 54, h: 164, shape: 'rect' },
  },
  {
    id: 'pillars_jachin_boaz',
    planId: 'first_temple',
    name: 'Pillars Jachin & Boaz',
    hebrew: 'יָכִין וּבֹעַז',
    transliteration: 'Yachin uBoaz',
    strongs: ['H3199', 'H1162', 'H5982'],
    phraseKeywords: ['jachin', 'boaz', 'two pillars', 'bronze pillars'],
    zone: 'Porch Entrance (North & South)',
    dimensions: '18 cubits high + 5-cubit lily/pomegranate capitals; 12 cubits circumference',
    summary:
      'Two freestanding cast-bronze pillars erected at the Temple vestibule: Boaz ("In him is strength") on the North and Jachin ("He establishes") on the South.',
    historicalNote:
      'Cast in the Jordan plain clay between Succoth and Zarethan by Huram-abi; broken up by Babylonians in 586 BCE (1 Kgs 7:15–22, 46; 2 Kgs 25:13).',
    sourceRefs: [
      { label: '1 Kgs 7:15', passage: { book: 11, chapter: 7, verse: 15 } },
      { label: '1 Kgs 7:21', passage: { book: 11, chapter: 7, verse: 21 } },
      { label: '2 Chr 3:17', passage: { book: 14, chapter: 3, verse: 17 } },
    ],
    svgBox: { x: 436, y: 154, w: 30, h: 136, shape: 'rect' },
  },
  {
    id: 'first_bronze_altar',
    planId: 'first_temple',
    name: 'Bronze Altar of Burnt Offering',
    hebrew: 'מִזְבַּח הַנְּחֹשֶׁת',
    transliteration: 'Mizbach HaNechoshet',
    strongs: ['H4196', 'H5178'],
    phraseKeywords: ['bronze altar', 'altar of bronze', 'burnt offering'],
    zone: 'Inner Court (East of Porch)',
    dimensions: '20 × 20 × 10 cubits (2 Chr 4:1)',
    summary:
      'Massive square bronze sacrificial altar standing in the center of the Inner Court east of the Temple porch.',
    historicalNote:
      'Later moved north by King Ahaz when he installed a Damascus-patterned altar (2 Kgs 16:14).',
    sourceRefs: [
      { label: '2 Chr 4:1', passage: { book: 14, chapter: 4, verse: 1 } },
      { label: '1 Kgs 8:64', passage: { book: 11, chapter: 8, verse: 64 } },
    ],
    svgBox: { x: 542, y: 184, w: 74, h: 74, shape: 'rect' },
  },
  {
    id: 'molten_sea',
    planId: 'first_temple',
    name: 'Molten / Bronze Sea',
    hebrew: 'הַיָּם הַמּוּצָק',
    transliteration: 'HaYam HaMutzaq',
    strongs: ['H3220'],
    phraseKeywords: ['molten sea', 'bronze sea', 'cast metal sea'],
    zone: 'Inner Court (Southeast Corner)',
    dimensions: '10 cubits brim-to-brim, 5 cubits deep, 30 cubits circumference; 2,000 baths',
    summary:
      'Monumental cast-bronze reservoir mounted atop twelve bronze oxen facing outward in triads (N, W, S, E), used by priests for washing.',
    historicalNote:
      'Set explicitly "on the right side of the house eastward, toward the south" (1 Kgs 7:39).',
    sourceRefs: [
      { label: '1 Kgs 7:23', passage: { book: 11, chapter: 7, verse: 23 } },
      { label: '1 Kgs 7:39', passage: { book: 11, chapter: 7, verse: 39 } },
      { label: '2 Chr 4:2', passage: { book: 14, chapter: 4, verse: 2 } },
    ],
    svgBox: { x: 486, y: 294, w: 58, h: 58, shape: 'circle' },
  },
  {
    id: 'ten_lavers',
    planId: 'first_temple',
    name: 'Ten Bronze Lavers on Stands',
    hebrew: 'כִּיֹּרוֹת וּמְכֹנוֹת',
    transliteration: 'Kiyyorot uMekhonot',
    strongs: ['H3595', 'H4350'],
    phraseKeywords: ['ten lavers', 'ten basins', 'wheeled stands'],
    zone: 'Inner Court (5 North, 5 South)',
    dimensions: '10 wheeled bronze stands (4 × 4 × 3 cubits) each holding a 40-bath basin',
    summary:
      'Ten mobile bronze basins on ornate wheeled stands engraved with lions, oxen, and cherubim—five placed on the North and five on the South side of the court.',
    historicalNote:
      'Used to rinse items for burnt offerings, while priests washed in the Molten Sea (2 Chr 4:6; 1 Kgs 7:27–39).',
    sourceRefs: [
      { label: '1 Kgs 7:27', passage: { book: 11, chapter: 7, verse: 27 } },
      { label: '1 Kgs 7:38', passage: { book: 11, chapter: 7, verse: 38 } },
      { label: '2 Chr 4:6', passage: { book: 14, chapter: 4, verse: 6 } },
    ],
    svgBox: { x: 486, y: 84, w: 124, h: 36, shape: 'rect' },
  },
];

const SECOND_TEMPLE_ELEMENTS: ArchitectureElement[] = [
  {
    id: 'court_of_gentiles',
    planId: 'second_temple',
    name: 'Court of the Gentiles',
    greek: 'ἱερόν (Hieron)',
    transliteration: 'Hieron (Outer Esplanade)',
    strongs: ['G2411'],
    phraseKeywords: ['court of the gentiles', 'temple courts', 'outer court'],
    zone: 'Outer Herodian Esplanade',
    dimensions: 'Approx. 480 × 300 m Herodian platform retained by massive ashlar walls',
    summary:
      'Expansive paved outer precinct surrounding the sacred sanctuary terrace, open to all nations and housing moneychangers and portico teaching.',
    historicalNote:
      'NT authors distinguish hieron (G2411, entire Temple complex) from naos (G3485, the inner sanctuary building itself).',
    sourceRefs: [
      { label: 'Matt 21:12', passage: { book: 40, chapter: 21, verse: 12 } },
      { label: 'John 2:14', passage: { book: 43, chapter: 2, verse: 14 } },
    ],
    svgBox: { x: 40, y: 56, w: 636, h: 342, shape: 'rect' },
  },
  {
    id: 'royal_stoa',
    planId: 'second_temple',
    name: 'Royal Stoa (Southern Basilica)',
    greek: 'βασιλικὴ στοά',
    transliteration: 'Basilikē Stoa',
    strongs: ['G4745'],
    phraseKeywords: ['royal stoa', 'southern portico'],
    zone: 'South Wall of Complex',
    dimensions: '162 monolithic Corinthian columns in 4 rows along the southern flank',
    summary:
      'Monumental three-aisled Herodian basilica overlooking the southern stairs and Robinson’s Arch, serving civic, judicial, and commercial functions.',
    historicalNote:
      'Described in detail by Josephus (Ant. 15.411–416); likely scene of temple trade cleared by Jesus.',
    sourceRefs: [
      { label: 'Matt 21:12', passage: { book: 40, chapter: 21, verse: 12 } },
      { label: 'Mark 11:15', passage: { book: 41, chapter: 11, verse: 15 } },
    ],
    svgBox: { x: 44, y: 356, w: 584, h: 38, shape: 'rect' },
  },
  {
    id: 'solomons_portico',
    planId: 'second_temple',
    name: "Solomon's Portico (East Colonnade)",
    greek: 'στοὰ τοῦ Σολομῶνος',
    transliteration: 'Stoa tou Solomōnos',
    strongs: ['G4745', 'G4672'],
    phraseKeywords: ["solomon's portico", 'solomon portico', 'solomon porch', 'portico'],
    zone: 'East Colonnade (Facing Kidron)',
    dimensions: 'Double colonnade running the eastern length of the Temple Mount',
    summary:
      'Roofed eastern colonnade where Jesus walked in winter at Hanukkah and where the early Jerusalem apostles taught and healed.',
    historicalNote:
      'Named after Solomon because tradition held its lower eastern foundation preserved First Temple masonry overlooking the Kidron Valley.',
    sourceRefs: [
      { label: 'John 10:23', passage: { book: 43, chapter: 10, verse: 23 } },
      { label: 'Acts 3:11', passage: { book: 44, chapter: 3, verse: 11 } },
      { label: 'Acts 5:12', passage: { book: 44, chapter: 5, verse: 12 } },
    ],
    svgBox: { x: 632, y: 60, w: 40, h: 334, shape: 'rect' },
  },
  {
    id: 'soreq_balustrade',
    planId: 'second_temple',
    name: 'Soreq Balustrade (Dividing Wall)',
    greek: 'μεσότοιχον / δρύφακτος',
    transliteration: 'Mesotoichon (Soreq)',
    strongs: ['G3320'],
    phraseKeywords: ['soreq', 'dividing wall', 'wall of partition', 'balustrade'],
    zone: 'Inner Terrace Boundary',
    dimensions: '3-cubit lattice stone barrier encircling the inner Chel terrace',
    summary:
      'Low stone balustrade bearing Greek and Latin warning inscriptions forbidding non-Jews from advancing into the inner courts on pain of death.',
    historicalNote:
      'Two surviving Greek warning stelae (found 1871 & 1935) illuminate Paul’s metaphor of the "dividing wall of hostility" in Eph 2:14 and the riot in Acts 21:28.',
    sourceRefs: [
      { label: 'Acts 21:28', passage: { book: 44, chapter: 21, verse: 28 } },
      { label: 'Eph 2:14', passage: { book: 49, chapter: 2, verse: 14 } },
    ],
    svgBox: { x: 96, y: 98, w: 488, h: 236, shape: 'rect' },
  },
  {
    id: 'beautiful_gate',
    planId: 'second_temple',
    name: 'Beautiful Gate',
    greek: 'ἡ ὡραία πύλη / θύρα',
    transliteration: 'Hē Hōraia Pylē',
    strongs: ['G5611', 'G2374', 'G4439'],
    phraseKeywords: ['beautiful gate', 'gate called beautiful'],
    zone: 'East Entrance to Women’s Court',
    dimensions: 'Monumental Corinthian-bronze plated portal (Acts 3:2, 10)',
    summary:
      'Ornate eastern portal where Peter and John healed the lame man before entering the temple courts and addressing the crowd in Solomon’s Portico.',
    historicalNote:
      'Ancient witnesses debate whether Luke’s "Beautiful Gate" refers to the eastern Shushan Gate, the outer gate of the Women’s Court, or the gleaming Corinthian-bronze Nicanor Gate.',
    sourceRefs: [
      { label: 'Acts 3:2', passage: { book: 44, chapter: 3, verse: 2 } },
      { label: 'Acts 3:10', passage: { book: 44, chapter: 3, verse: 10 } },
    ],
    svgBox: { x: 564, y: 186, w: 28, h: 60, shape: 'gate' },
  },
  {
    id: 'womens_court',
    planId: 'second_temple',
    name: "Court of Women (Ezrat Nashim)",
    greek: 'αὐλὴ / γαζοφυλάκιον',
    transliteration: 'Ezrat Nashim',
    strongs: ['G1049'],
    phraseKeywords: ["women's court", 'court of women', 'treasury'],
    zone: 'Eastern Inner Court',
    dimensions: '135 × 135 cubits square with 4 corner chambers and 13 trumpet chests',
    summary:
      'Square eastern forecourt open to ritually pure Jewish men and women, housing the thirteen shofar-shaped treasury receptacles.',
    historicalNote:
      'Setting of Jesus teaching near the treasury (John 8:20) and observing the widow’s two lepta (Mark 12:41–44).',
    sourceRefs: [
      { label: 'Mark 12:41', passage: { book: 41, chapter: 12, verse: 41 } },
      { label: 'John 8:20', passage: { book: 43, chapter: 8, verse: 20 } },
    ],
    svgBox: { x: 448, y: 128, w: 118, h: 176, shape: 'rect' },
  },
  {
    id: 'nicanor_gate',
    planId: 'second_temple',
    name: 'Nicanor Gate (15 Semicircular Steps)',
    greek: 'θύρα Νικάνωρ',
    transliteration: 'Sha’ar Nikanor',
    strongs: ['G4439', 'G2374'],
    phraseKeywords: ['nicanor gate', 'fifteen steps'],
    zone: 'Between Women’s Court & Court of Israel',
    dimensions: '50 cubits high Corinthian bronze doors above 15 semicircular steps',
    summary:
      'Grand bronze portal ascending from the Court of Women into the Court of Israel where Levites sang the 15 Psalms of Ascent (Pss 120–134).',
    historicalNote:
      'Mishnaic tradition (m. Middot 2:3, 5) notes its doors were donated from Alexandria by Nicanor and remained un-gilded bronze out of honor.',
    sourceRefs: [
      { label: 'Ps 120:1', passage: { book: 19, chapter: 120, verse: 1 } },
      { label: 'Acts 3:2', passage: { book: 44, chapter: 3, verse: 2 } },
    ],
    svgBox: { x: 428, y: 188, w: 22, h: 56, shape: 'gate' },
  },
  {
    id: 'court_israel_priests',
    planId: 'second_temple',
    name: 'Court of Israel, Priests & Altar',
    greek: 'θυσιαστήριον (Thysiasterion)',
    transliteration: 'Ezrat Yisrael / Kohanim',
    strongs: ['G2379'],
    phraseKeywords: ['court of israel', 'court of priests', 'altar of burnt offering'],
    zone: 'Sacrificial Forecourt',
    dimensions: '32 × 32 cubit unhewn stone altar (m. Middot 3:1) in priestly court',
    summary:
      'Restricted liturgical courts directly east of the Sanctuary where daily tamid and Passover lambs were offered on the massive ramped stone altar.',
    historicalNote:
      'Referenced by Jesus in Matt 23:35 ("between the sanctuary [naos] and the altar [thysiasterion]").',
    sourceRefs: [
      { label: 'Matt 23:35', passage: { book: 40, chapter: 23, verse: 35 } },
      { label: 'Luke 1:10', passage: { book: 42, chapter: 1, verse: 10 } },
    ],
    svgBox: { x: 320, y: 128, w: 108, h: 176, shape: 'rect' },
  },
  {
    id: 'second_sanctuary',
    planId: 'second_temple',
    name: 'Sanctuary Building (Naos)',
    greek: 'ναός (Naos)',
    transliteration: 'Naos',
    strongs: ['G3485'],
    phraseKeywords: ['sanctuary', 'naos', 'holy place'],
    zone: 'Elevated Inner Sanctuary',
    dimensions: '100 cubits wide facade × 100 cubits high (Herodian white stone & gold)',
    summary:
      'Towering inner sanctuary housing the Holy Place (Menorah, Table of Showbread, Altar of Incense) and the Most Holy Place behind the Veil.',
    historicalNote:
      'Distinct from Solomon’s First Temple (586 BCE) and from Ezekiel’s visionary temple (Ezek 40–48), Herodian expansion by Herod the Great began c. 20 BCE and stood until 70 CE.',
    sourceRefs: [
      { label: 'Matt 24:1', passage: { book: 40, chapter: 24, verse: 1 } },
      { label: 'Luke 1:9', passage: { book: 42, chapter: 1, verse: 9 } },
      { label: 'Heb 9:2', passage: { book: 58, chapter: 9, verse: 2 } },
    ],
    svgBox: { x: 118, y: 136, w: 188, h: 160, shape: 'rect' },
  },
  {
    id: 'second_showbread',
    planId: 'second_temple',
    name: 'Table of Showbread',
    greek: 'τράπεζα / πρόθεσις ἄρτων',
    transliteration: 'Trapeza (Prothesis)',
    strongs: ['G5132', 'G4286'],
    phraseKeywords: ['showbread', 'table of showbread', 'bread of the presence'],
    zone: 'Holy Place (North Side)',
    dimensions: '2 × 1 × 1.5 cubits (depicted later on the Arch of Titus)',
    summary:
      'Golden table on the North side of the Herodian Holy Place holding the twelve loaves of the Presence.',
    historicalNote:
      'Carried off to Rome in 70 CE and carved in relief on the Arch of Titus alongside the golden Menorah.',
    sourceRefs: [
      { label: 'Heb 9:2', passage: { book: 58, chapter: 9, verse: 2 } },
      { label: 'Matt 12:4', passage: { book: 40, chapter: 12, verse: 4 } },
    ],
    svgBox: { x: 224, y: 156, w: 62, h: 32, shape: 'rect' },
  },
  {
    id: 'second_menorah',
    planId: 'second_temple',
    name: 'Golden Lampstand (Menorah)',
    greek: 'λυχνία',
    transliteration: 'Lychnia',
    strongs: ['G3087'],
    phraseKeywords: ['lampstand', 'menorah'],
    zone: 'Holy Place (South Side)',
    dimensions: 'Single seven-branched gold lampstand (cf. 1 Macc 1:21; Arch of Titus)',
    summary:
      'Seven-branched golden lampstand standing opposite the Showbread table on the South side of the Second Temple Holy Place.',
    historicalNote:
      'Unlike Solomon’s ten lampstands, Second Temple texts (m. Tamid, Josephus, Heb 9:2) attest a single seven-branched Menorah.',
    sourceRefs: [
      { label: 'Heb 9:2', passage: { book: 58, chapter: 9, verse: 2 } },
      { label: 'Rev 1:12', passage: { book: 66, chapter: 1, verse: 12 } },
    ],
    svgBox: { x: 224, y: 244, w: 62, h: 32, shape: 'rect' },
  },
  {
    id: 'second_incense_altar',
    planId: 'second_temple',
    name: 'Altar of Incense',
    greek: 'θυμιατήριον / θυσιαστήριον θυμιάματος',
    transliteration: 'Thysiasterion Thymiamatos',
    strongs: ['G2368', 'G2379'],
    phraseKeywords: ['altar of incense', 'burn incense'],
    zone: 'Holy Place (Before Veil)',
    dimensions: 'Golden incense altar positioned directly before the Veil',
    summary:
      'Site where Zechariah offered evening incense when Gabriel announced the birth of John the Baptist while the crowd prayed outside.',
    historicalNote:
      'Notice Heb 9:4 discusses the golden incense altar (thymiaterion) in relation to the inner sanctuary liturgy.',
    sourceRefs: [
      { label: 'Luke 1:11', passage: { book: 42, chapter: 1, verse: 11 } },
      { label: 'Heb 9:4', passage: { book: 58, chapter: 9, verse: 4 } },
    ],
    svgBox: { x: 184, y: 200, w: 34, h: 34, shape: 'rect' },
  },
  {
    id: 'second_veil',
    planId: 'second_temple',
    name: 'Thick Veil (Katapetasma)',
    greek: 'καταπέτασμα',
    transliteration: 'Katapetasma',
    strongs: ['G2665'],
    phraseKeywords: ['veil', 'curtain of the temple', 'katapetasma'],
    zone: 'Partition Before Most Holy',
    dimensions: 'Double heavy woven curtains (40 × 20 cubits in Herodian sanctuary)',
    summary:
      'Massive woven curtain separating the Holy Place from the Most Holy Place, torn from top to bottom at Jesus’ crucifixion.',
    historicalNote:
      'Mishnah (m. Yoma 5:1) describes two curtains (Traksin) separated by a cubit space in the Second Temple.',
    sourceRefs: [
      { label: 'Matt 27:51', passage: { book: 40, chapter: 27, verse: 51 } },
      { label: 'Heb 9:3', passage: { book: 58, chapter: 9, verse: 3 } },
      { label: 'Heb 10:20', passage: { book: 58, chapter: 10, verse: 20 } },
    ],
    svgBox: { x: 170, y: 138, w: 12, h: 156, shape: 'gate' },
  },
  {
    id: 'second_most_holy',
    planId: 'second_temple',
    name: 'Most Holy Place (Foundation Stone)',
    greek: 'ἅγια ἁγίων',
    transliteration: 'Hagia Hagiōn',
    strongs: ['G0039'],
    phraseKeywords: ['most holy place', 'holy of holies', 'second curtain'],
    zone: 'Westernmost Cube (No Ark Present)',
    dimensions: '20 × 20 × 60 cubits tall interior chamber',
    summary:
      'Innermost sanctum entered once yearly on Yom Kippur; in the Second Temple era the Ark was absent, leaving only the exposed Foundation Stone.',
    historicalNote:
      'Josephus (War 5.219) and m. Yoma 5:2 confirm the Second Temple Holy of Holies contained no Ark—the High Priest rested the censer on the Even haShetiyyah (Foundation Stone).',
    sourceRefs: [
      { label: 'Heb 9:3', passage: { book: 58, chapter: 9, verse: 3 } },
      { label: 'Heb 9:7', passage: { book: 58, chapter: 9, verse: 7 } },
    ],
    svgBox: { x: 118, y: 136, w: 54, h: 160, shape: 'rect' },
  },
];

const JERUSALEM_GATES_ELEMENTS: ArchitectureElement[] = [
  {
    id: 'temple_mount',
    planId: 'jerusalem_gates',
    name: 'Temple Mount (Mount Moriah)',
    hebrew: 'הַר הַמּוֹרִיָּה / יְרוּשָׁלִַם',
    greek: 'Ἱερουσαλήμ / ἱερόν',
    transliteration: 'Har HaMoriyah / Yerushalayim',
    strongs: ['H4179', 'H2022', 'H3389', 'G2419', 'G2414'],
    phraseKeywords: ['temple mount', 'mount moriah', 'moriah', 'house of the lord'],
    zone: 'Northeast Ridge',
    dimensions: 'Elevated summit north of the City of David spur',
    summary:
      'Sacred hilltop north of the original City of David ridge where David purchased Araunah’s threshing floor and Solomon built the First Temple.',
    historicalNote:
      'Later expanded dramatically southward and northward by Herod the Great into the current ~36-acre platform.',
    sourceRefs: [
      { label: '2 Chr 3:1', passage: { book: 14, chapter: 3, verse: 1 } },
      { label: 'Ezra 3:10', passage: { book: 15, chapter: 3, verse: 10 } },
      { label: 'Matt 24:1', passage: { book: 40, chapter: 24, verse: 1 } },
    ],
    svgBox: { x: 346, y: 106, w: 142, h: 104, shape: 'rect' },
  },
  {
    id: 'city_of_david',
    planId: 'jerusalem_gates',
    name: 'City of David (Zion Spur)',
    hebrew: 'עִיר דָּוִד / צִיּוֹן',
    transliteration: 'Ir David / Tsiyyon',
    strongs: ['H6726', 'H5892'],
    phraseKeywords: ['city of david', 'zion', 'fortress of zion'],
    zone: 'Southeastern Ridge',
    dimensions: 'Narrow terraced ridge descending south from Moriah between Kidron & Tyropoeon',
    summary:
      'Original Jebusite stronghold captured by David, bounded sharply by the Kidron Valley on the east and the Central (Tyropoeon) Valley on the west.',
    historicalNote:
      'Positioned strategically directly above the Gihon Spring—the sole perennial natural water source of ancient Jerusalem.',
    sourceRefs: [
      { label: '2 Sam 5:7', passage: { book: 10, chapter: 5, verse: 7 } },
      { label: '1 Kgs 8:1', passage: { book: 11, chapter: 8, verse: 1 } },
      { label: 'Neh 3:15', passage: { book: 16, chapter: 3, verse: 15 } },
    ],
    svgBox: { x: 356, y: 218, w: 88, h: 122, shape: 'rect' },
  },
  {
    id: 'kidron_valley',
    planId: 'jerusalem_gates',
    name: 'Kidron Valley',
    hebrew: 'נַחַל קִדְרוֹן',
    transliteration: 'Nachal Qidron',
    strongs: ['H6939', 'G2748'],
    phraseKeywords: ['kidron', 'brook kidron', 'valley of kidron'],
    zone: 'Eastern Boundary Valley',
    dimensions: 'Deep north–south wadi separating Jerusalem’s East wall from the Mount of Olives',
    summary:
      'Steep eastern ravine crossed by David fleeing Absalom, reform kings disposing of idols, and Jesus walking toward Gethsemane.',
    historicalNote:
      'In Neh 2:15 Nehemiah inspected the ruined eastern wall by riding up the Kidron Valley at night.',
    sourceRefs: [
      { label: '2 Sam 15:23', passage: { book: 10, chapter: 15, verse: 23 } },
      { label: 'Neh 2:15', passage: { book: 16, chapter: 2, verse: 15 } },
      { label: 'John 18:1', passage: { book: 43, chapter: 18, verse: 1 } },
    ],
    svgBox: { x: 572, y: 66, w: 46, h: 324, shape: 'rect' },
  },
  {
    id: 'mount_of_olives',
    planId: 'jerusalem_gates',
    name: 'Mount of Olives',
    hebrew: 'הַר הַזֵּיתִים',
    greek: 'τὸ ὄρος τῶν ἐλαιῶν',
    transliteration: 'Har HaZeitim / Oros tōn Elaiōn',
    strongs: ['H2132', 'G1636', 'H2022'],
    phraseKeywords: ['mount of olives', 'olivet', 'mount of olivet'],
    zone: 'East Across Kidron',
    dimensions: 'Ridge ~815 m elevation rising directly east of the Temple Mount',
    summary:
      'Prominent eastern ridge overlooking the Temple precinct and East Gate across the Kidron Valley; site of Gethsemane, the Olivet Discourse, and the Ascension.',
    historicalNote:
      'Directly opposite the eastern Temple facade (Mark 13:3; Ezek 11:23; Zech 14:4).',
    sourceRefs: [
      { label: '2 Sam 15:30', passage: { book: 10, chapter: 15, verse: 30 } },
      { label: 'Zech 14:4', passage: { book: 38, chapter: 14, verse: 4 } },
      { label: 'Luke 19:37', passage: { book: 42, chapter: 19, verse: 37 } },
      { label: 'Acts 1:12', passage: { book: 44, chapter: 1, verse: 12 } },
    ],
    svgBox: { x: 656, y: 106, w: 80, h: 224, shape: 'rect' },
  },
  {
    id: 'hinnom_valley',
    planId: 'jerusalem_gates',
    name: 'Hinnom Valley',
    hebrew: 'גֵּי בֶן־הִנֹּם',
    transliteration: 'Ge Ben-Hinnom',
    strongs: ['H1516', 'H2011'],
    phraseKeywords: ['hinnom', 'valley of hinnom', 'gehenna'],
    zone: 'West & South Boundary Valley',
    dimensions: 'Curving ravine flanking the West and South walls to join Kidron at En-rogel',
    summary:
      'Western and southern valley outside the Valley Gate and Dung Gate; later Greek transliteration Gehenna became a byword for judgment.',
    historicalNote:
      'Forms the natural western/southern defense moat of biblical Jerusalem (Josh 15:8; Jer 7:31; Neh 11:30).',
    sourceRefs: [
      { label: 'Josh 15:8', passage: { book: 6, chapter: 15, verse: 8 } },
      { label: 'Jer 7:31', passage: { book: 24, chapter: 7, verse: 31 } },
      { label: 'Neh 11:30', passage: { book: 16, chapter: 11, verse: 30 } },
    ],
    svgBox: { x: 56, y: 184, w: 72, h: 192, shape: 'rect' },
  },
  {
    id: 'gihon_spring',
    planId: 'jerusalem_gates',
    name: "Gihon Spring & Hezekiah's Tunnel",
    hebrew: 'גִּיחוֹן',
    transliteration: 'Gichon',
    strongs: ['H1521'],
    phraseKeywords: ['gihon', 'gihon spring', "hezekiah's tunnel", 'siloam tunnel'],
    zone: 'East Slope of City of David',
    dimensions: '~533 m S-curved bedrock water tunnel cut c. 701 BCE',
    summary:
      'Karstic spring on the lower eastern slope of the City of David channeled by King Hezekiah underground through bedrock to bring water inside the city walls to Siloam.',
    historicalNote:
      'Site of Solomon’s anointing (1 Kgs 1:33) and Hezekiah’s defensive siege engineering attested by the Siloam Inscription (2 Chr 32:30; 2 Kgs 20:20).',
    sourceRefs: [
      { label: '1 Kgs 1:33', passage: { book: 11, chapter: 1, verse: 33 } },
      { label: '2 Kgs 20:20', passage: { book: 12, chapter: 20, verse: 20 } },
      { label: '2 Chr 32:30', passage: { book: 14, chapter: 32, verse: 30 } },
    ],
    svgBox: { x: 442, y: 274, w: 30, h: 30, shape: 'circle' },
  },
  {
    id: 'pool_of_siloam',
    planId: 'jerusalem_gates',
    name: 'Pool of Siloam',
    hebrew: 'בְּרֵכַת הַשֶּׁלַח',
    greek: 'Σιλωάμ',
    transliteration: 'Berechat HaShelach / Silōam',
    strongs: ['H7975', 'G4611'],
    phraseKeywords: ['pool of siloam', 'siloam', 'pool of shelah'],
    zone: 'Southern Tip (Below City of David)',
    dimensions: 'Stepped Second Temple limestone pool (~50 m wide) discovered in 2004',
    summary:
      'Southern reservoir fed by Hezekiah’s Tunnel near the Fountain Gate; destination of Sukkot water-libation processions and the healing of the man born blind.',
    historicalNote:
      'Also identified with the "Pool of Shelah by the king’s garden" in Neh 3:15 and Isaiah’s "waters of Shiloah" (Isa 8:6).',
    sourceRefs: [
      { label: 'Neh 3:15', passage: { book: 16, chapter: 3, verse: 15 } },
      { label: 'Isa 8:6', passage: { book: 23, chapter: 8, verse: 6 } },
      { label: 'John 9:7', passage: { book: 43, chapter: 9, verse: 7 } },
    ],
    svgBox: { x: 332, y: 318, w: 38, h: 26, shape: 'rect' },
  },
  {
    id: 'pool_of_bethesda',
    planId: 'jerusalem_gates',
    name: 'Pool of Bethesda',
    greek: 'Βηθεσδά',
    transliteration: 'Bēthesda',
    strongs: ['G0964'],
    phraseKeywords: ['pool of bethesda', 'bethesda', 'five porticoes'],
    zone: 'North of Temple Mount (By Sheep Gate)',
    dimensions: 'Twin rock-cut reservoirs with five colonnaded porticoes (excavated near St. Anne)',
    summary:
      'Double-basin pool complex just north of the Temple wall near the Sheep Gate where Jesus healed a man paralyzed for thirty-eight years.',
    historicalNote:
      'Archaeological excavations north of the Temple Mount uncovered the twin basins divided by a central dam, matching John 5:2’s five porticoes.',
    sourceRefs: [
      { label: 'John 5:2', passage: { book: 43, chapter: 5, verse: 2 } },
      { label: 'John 5:7', passage: { book: 43, chapter: 5, verse: 7 } },
    ],
    svgBox: { x: 396, y: 40, w: 46, h: 26, shape: 'rect' },
  },
  {
    id: 'sheep_gate',
    planId: 'jerusalem_gates',
    name: 'Sheep Gate',
    hebrew: 'שַׁעַר הַצֹּאן',
    greek: 'προβατική',
    transliteration: "Sha'ar HaTson / Probatikē",
    strongs: ['H6629', 'G4262'],
    phraseKeywords: ['sheep gate', 'sheep market'],
    zone: 'Northeast Wall (North of Temple)',
    summary:
      'First gate rebuilt and consecrated by Eliashib the high priest and fellow priests in Nehemiah 3:1; gateway for sacrificial flocks entering near Bethesda.',
    historicalNote:
      'Located at the northeastern corner near the Temple precincts; notably the only gate explicitly said to be consecrated in Neh 3:1.',
    sourceRefs: [
      { label: 'Neh 3:1', passage: { book: 16, chapter: 3, verse: 1 } },
      { label: 'Neh 12:39', passage: { book: 16, chapter: 12, verse: 39 } },
      { label: 'John 5:2', passage: { book: 43, chapter: 5, verse: 2 } },
    ],
    svgBox: { x: 446, y: 82, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'inspection_gate',
    planId: 'jerusalem_gates',
    name: 'Inspection Gate (Miphkad)',
    hebrew: 'שַׁעַר הַמִּפְקָד',
    transliteration: "Sha'ar HaMiphqad",
    strongs: ['H4663'],
    phraseKeywords: ['inspection gate', 'gate miphkad', 'muster gate'],
    zone: 'Northeast / East Temple Sector',
    summary:
      'Gate near the northeastern corner of the Temple precincts repaired by Malchijah of the goldsmiths (Neh 3:31), closing the clockwise circuit back to the Sheep Gate.',
    historicalNote:
      'Its name (miphqad) points to a muster, census, or inspection station on the eastern perimeter.',
    sourceRefs: [
      { label: 'Neh 3:31', passage: { book: 16, chapter: 3, verse: 31 } },
    ],
    svgBox: { x: 484, y: 120, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'east_gate',
    planId: 'jerusalem_gates',
    name: 'East Gate',
    hebrew: 'שַׁעַר הַמִּזְרָח / שַׁעַר הַקַּדְמוֹנִי',
    greek: 'πύλη ἡ κατὰ ἀνατολάς',
    transliteration: "Sha'ar HaMizrah",
    strongs: ['H8179', 'H4217', 'H6921', 'H6924', 'G4439', 'G0395'],
    phraseKeywords: ['east gate', 'eastern gate', 'eastward gate', 'gate toward the east'],
    zone: 'East Wall (Facing Kidron & Mount of Olives)',
    summary:
      'Eastern gateway repaired by Shemaiah the keeper of the East Gate (Neh 3:29) and central in Ezekiel’s vision of the glory returning from the east (Ezek 43:1–4; 44:1–3).',
    historicalNote:
      'Historical distinction: the biblical East Gate (both in Nehemiah’s wall / First-Second Temple eastern Temple approach facing Kidron & the Mount of Olives, and Ezekiel’s visionary gate) must be distinguished from the much later visible Golden Gate (Bab al-Rahma), built in the 6th–7th c. CE above earlier Herodian/First-Temple-era lower arches and sealed by Ottoman Sultan Suleiman the Magnificent in 1541 CE.',
    sourceRefs: [
      { label: 'Neh 3:29', passage: { book: 16, chapter: 3, verse: 29 } },
      { label: 'Ezek 43:1', passage: { book: 26, chapter: 43, verse: 1 } },
      { label: 'Ezek 44:1', passage: { book: 26, chapter: 44, verse: 1 } },
      { label: 'Ezek 10:19', passage: { book: 26, chapter: 10, verse: 19 } },
    ],
    svgBox: { x: 484, y: 162, w: 22, h: 24, shape: 'gate' },
  },
  {
    id: 'horse_gate',
    planId: 'jerusalem_gates',
    name: 'Horse Gate',
    hebrew: 'שַׁעַר הַסּוּסִים',
    transliteration: "Sha'ar HaSusim",
    strongs: ['H5483'],
    phraseKeywords: ['horse gate'],
    zone: 'East Wall (South of Temple)',
    summary:
      'Eastern wall gate connecting the Temple/royal quarter to the Kidron slope; site where Queen Athaliah was led out and executed.',
    historicalNote:
      'Marked the boundary between the priests’ repairs north of it and the Temple/palace quarter (Neh 3:28; 2 Chr 23:15; Jer 31:40).',
    sourceRefs: [
      { label: 'Neh 3:28', passage: { book: 16, chapter: 3, verse: 28 } },
      { label: '2 Chr 23:15', passage: { book: 14, chapter: 23, verse: 15 } },
      { label: 'Jer 31:40', passage: { book: 24, chapter: 31, verse: 40 } },
    ],
    svgBox: { x: 478, y: 204, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'water_gate',
    planId: 'jerusalem_gates',
    name: 'Water Gate',
    hebrew: 'שַׁעַר הַמַּיִם',
    transliteration: "Sha'ar HaMayim",
    strongs: ['H4325'],
    phraseKeywords: ['water gate'],
    zone: 'East Slope (Above Gihon Spring)',
    summary:
      'Gate on the eastern City of David ridge leading down toward the Gihon Spring, adjacent to the broad plaza where Ezra read the Torah publicly.',
    historicalNote:
      'Notably required no structural rebuilding in Neh 3:26 and served as the focal gathering square for the Feast of Booths revival in Neh 8:1–3.',
    sourceRefs: [
      { label: 'Neh 3:26', passage: { book: 16, chapter: 3, verse: 26 } },
      { label: 'Neh 8:1', passage: { book: 16, chapter: 8, verse: 1 } },
      { label: 'Neh 12:37', passage: { book: 16, chapter: 12, verse: 37 } },
    ],
    svgBox: { x: 444, y: 240, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'fountain_gate',
    planId: 'jerusalem_gates',
    name: 'Fountain Gate',
    hebrew: 'שַׁעַר הָעַיִן',
    transliteration: "Sha'ar HaAyin",
    strongs: ['H5869'],
    phraseKeywords: ['fountain gate'],
    zone: 'Southeast Tip (Near Siloam)',
    summary:
      'Southeastern gate near the Pool of Siloam and the King’s Garden, ascending via the stairs of the City of David.',
    historicalNote:
      'Reached by Nehemiah on his night inspection when debris forced him to dismount (Neh 2:14; 3:15; 12:37).',
    sourceRefs: [
      { label: 'Neh 2:14', passage: { book: 16, chapter: 2, verse: 14 } },
      { label: 'Neh 3:15', passage: { book: 16, chapter: 3, verse: 15 } },
      { label: 'Neh 12:37', passage: { book: 16, chapter: 12, verse: 37 } },
    ],
    svgBox: { x: 394, y: 338, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'dung_gate',
    planId: 'jerusalem_gates',
    name: 'Dung Gate',
    hebrew: 'שַׁעַר הָאַשְׁפֹּת',
    transliteration: "Sha'ar HaAshpot",
    strongs: ['H0830'],
    phraseKeywords: ['dung gate', 'refuse gate'],
    zone: 'Southern Tip (Above Hinnom)',
    summary:
      'Southernmost city gate opening onto the confluence of the Hinnom, Tyropoeon, and Kidron valleys for refuse removal.',
    historicalNote:
      'Positioned roughly 1,000 cubits south of the Valley Gate along the southern ridge (Neh 2:13; 3:13–14).',
    sourceRefs: [
      { label: 'Neh 2:13', passage: { book: 16, chapter: 2, verse: 13 } },
      { label: 'Neh 3:14', passage: { book: 16, chapter: 3, verse: 14 } },
      { label: 'Neh 12:31', passage: { book: 16, chapter: 12, verse: 31 } },
    ],
    svgBox: { x: 306, y: 356, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'valley_gate',
    planId: 'jerusalem_gates',
    name: 'Valley Gate',
    hebrew: 'שַׁעַר הַגַּיְא',
    transliteration: "Sha'ar HaGai",
    strongs: ['H1516'],
    phraseKeywords: ['valley gate'],
    zone: 'Western Wall (Facing Hinnom)',
    summary:
      'Western city gate opening onto the Hinnom Valley, strengthened with towers by King Uzziah and used by Nehemiah to begin his night survey.',
    historicalNote:
      'Both thanksgiving choirs in Neh 12:31, 38 started near or passed by the Valley/Tower sectors on the western wall.',
    sourceRefs: [
      { label: 'Neh 2:13', passage: { book: 16, chapter: 2, verse: 13 } },
      { label: 'Neh 3:13', passage: { book: 16, chapter: 3, verse: 13 } },
      { label: '2 Chr 26:9', passage: { book: 14, chapter: 26, verse: 9 } },
    ],
    svgBox: { x: 144, y: 264, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'corner_gate',
    planId: 'jerusalem_gates',
    name: 'Corner Gate',
    hebrew: 'שַׁעַר הַפִּנָּה',
    transliteration: "Sha'ar HaPinnah",
    strongs: ['H6438'],
    phraseKeywords: ['corner gate'],
    zone: 'Northwest Corner',
    summary:
      'Strategic northwestern bastion gate breached by Jehoash of Israel, fortified by Uzziah, and cited in prophetic restoration boundaries.',
    historicalNote:
      'Marks the northwestern extent of the city in Jer 31:38 and Zech 14:10 ("from the Gate of Benjamin to the Corner Gate").',
    sourceRefs: [
      { label: '2 Kgs 14:13', passage: { book: 12, chapter: 14, verse: 13 } },
      { label: '2 Chr 26:9', passage: { book: 14, chapter: 26, verse: 9 } },
      { label: 'Zech 14:10', passage: { book: 38, chapter: 14, verse: 10 } },
    ],
    svgBox: { x: 156, y: 112, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'ephraim_gate',
    planId: 'jerusalem_gates',
    name: 'Ephraim Gate',
    hebrew: 'שַׁעַר אֶפְרַיִם',
    transliteration: "Sha'ar Efrayim",
    strongs: ['H0669'],
    phraseKeywords: ['ephraim gate', 'gate of ephraim'],
    zone: 'North Wall (West Sector)',
    summary:
      'Northern wall gate leading toward the hill country of Ephraim; 400 cubits east of the Corner Gate and site of booths during Ezra’s Feast of Tabernacles.',
    historicalNote:
      'Listed on the northern processional route in Neh 12:39 between the Broad Wall and the Old Gate.',
    sourceRefs: [
      { label: '2 Kgs 14:13', passage: { book: 12, chapter: 14, verse: 13 } },
      { label: 'Neh 8:16', passage: { book: 16, chapter: 8, verse: 16 } },
      { label: 'Neh 12:39', passage: { book: 16, chapter: 12, verse: 39 } },
    ],
    svgBox: { x: 220, y: 84, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'old_gate',
    planId: 'jerusalem_gates',
    name: 'Old Gate (Jeshanah Gate)',
    hebrew: 'שַׁעַר הַיְשָׁנָה',
    transliteration: "Sha'ar HaYeshanah",
    strongs: ['H3465'],
    phraseKeywords: ['old gate', 'jeshanah gate', 'gate of jeshanah'],
    zone: 'North Wall (Central Sector)',
    summary:
      'Northern gate ("Gate of the Old [Quarter]" or Jeshanah) repaired by Joiada and Meshullam between the Fish Gate and the Broad Wall.',
    historicalNote:
      'Likely marked the junction with the older northern defensive line before Hezekiah’s western expansion.',
    sourceRefs: [
      { label: 'Neh 3:6', passage: { book: 16, chapter: 3, verse: 6 } },
      { label: 'Neh 12:39', passage: { book: 16, chapter: 12, verse: 39 } },
    ],
    svgBox: { x: 294, y: 78, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'fish_gate',
    planId: 'jerusalem_gates',
    name: 'Fish Gate',
    hebrew: 'שַׁעַר הַדָּגִים',
    transliteration: "Sha'ar HaDagim",
    strongs: ['H1709'],
    phraseKeywords: ['fish gate'],
    zone: 'North Wall (East-Central)',
    summary:
      'Major northern commercial portal through which Tyrian merchants brought coastal fish into the Mishneh quarter of Jerusalem.',
    historicalNote:
      'Fortified by Manasseh (2 Chr 33:14) and paired with the Mishneh / Second Quarter in Zeph 1:10.',
    sourceRefs: [
      { label: 'Neh 3:3', passage: { book: 16, chapter: 3, verse: 3 } },
      { label: '2 Chr 33:14', passage: { book: 14, chapter: 33, verse: 14 } },
      { label: 'Zeph 1:10', passage: { book: 36, chapter: 1, verse: 10 } },
    ],
    svgBox: { x: 356, y: 76, w: 22, h: 22, shape: 'gate' },
  },
  {
    id: 'antonia_fortress',
    planId: 'jerusalem_gates',
    name: 'Antonia Fortress',
    greek: 'παρεμβολή (Parembolē)',
    transliteration: 'Antonia / Parembolē (Barracks)',
    strongs: ['G3925'],
    phraseKeywords: ['antonia', 'barracks', 'fortress', 'castle'],
    zone: 'Northwest Corner of Temple Mount',
    dimensions: 'Herodian citadel rising on bedrock directly north-northwest of the Temple courts',
    summary:
      'Roman garrison fortress overlooking the Temple courts; site where Roman tribune Claudius Lysias rescued Paul from the Temple mob and let him address the crowd from the steps.',
    historicalNote:
      'Rebuilt by Herod the Great over the earlier Hasmonean Baris and named after Mark Antony; linked directly to the outer court by stairways (Acts 21:31–40; 22:24; 23:10).',
    sourceRefs: [
      { label: 'Acts 21:34', passage: { book: 44, chapter: 21, verse: 34 } },
      { label: 'Acts 21:37', passage: { book: 44, chapter: 21, verse: 37 } },
      { label: 'Acts 22:24', passage: { book: 44, chapter: 22, verse: 24 } },
    ],
    svgBox: { x: 384, y: 74, w: 48, h: 28, shape: 'rect' },
  },
  {
    id: 'gethsemane',
    planId: 'jerusalem_gates',
    name: 'Gethsemane (Olive Press)',
    greek: 'Γεθσημανί (Gethsēmani)',
    hebrew: 'גַּת שְׁמָנִים',
    transliteration: 'Gat Shemanim / Gethsēmani',
    strongs: ['G1068'],
    phraseKeywords: ['gethsemane', 'olive press', 'garden across kidron'],
    zone: 'Lower Western Slope of Mount of Olives',
    dimensions: 'Olive-grove enclosure immediately east across the Kidron Brook (~665 m elev.)',
    summary:
      'Sheltered olive grove and press at the foot of the Mount of Olives where Jesus frequently withdrew with his disciples and prayed in agony before his arrest.',
    historicalNote:
      'John 18:1 notes Jesus crossed the Kidron Valley into the garden; Judas knew the rendezvous spot from earlier evenings during festival weeks.',
    sourceRefs: [
      { label: 'Matt 26:36', passage: { book: 40, chapter: 26, verse: 36 } },
      { label: 'Mark 14:32', passage: { book: 41, chapter: 14, verse: 32 } },
      { label: 'John 18:1', passage: { book: 43, chapter: 18, verse: 1 } },
    ],
    svgBox: { x: 620, y: 156, w: 32, h: 28, shape: 'rect' },
  },
  {
    id: 'herods_palace',
    planId: 'jerusalem_gates',
    name: "Herod's Palace & Upper City",
    greek: 'πραιτώριον / βασίλειον',
    transliteration: 'Upper City (Western Hill · ~765 m)',
    strongs: ['G4232', 'G0934'],
    phraseKeywords: ["herod's palace", 'upper city', 'western hill', 'praetorium'],
    zone: 'Western Hill (Upper City Citadel)',
    dimensions: 'Elevated western plateau (~765 m) fortified by three towers (Phasael, Hippicus, Mariamne)',
    summary:
      'Fortified royal palace complex of Herod the Great on Jerusalem’s high Western Hill, later used as the Roman governor’s praetorium when visiting from Caesarea.',
    historicalNote:
      'Archaeology beneath the Kishle and Citadel confirms massive Herodian podium walls; many scholars locate Pilate’s trial of Jesus (Matt 27:27; John 18:28) at this Western Hill praetorium.',
    sourceRefs: [
      { label: 'Matt 27:27', passage: { book: 40, chapter: 27, verse: 27 } },
      { label: 'Luke 23:7', passage: { book: 42, chapter: 23, verse: 7 } },
      { label: 'John 18:28', passage: { book: 43, chapter: 18, verse: 28 } },
    ],
    svgBox: { x: 184, y: 198, w: 68, h: 50, shape: 'rect' },
  },
  {
    id: 'tyropoeon_valley',
    planId: 'jerusalem_gates',
    name: 'Tyropoeon (Central) Valley',
    hebrew: 'הַגַּיְא הַמֶּרְכָּזִי',
    transliteration: 'Central / Cheesemakers’ Valley',
    strongs: ['H1516'],
    phraseKeywords: ['tyropoeon', 'central valley'],
    zone: 'Central North–South Ravine',
    dimensions: 'Deep ravine dividing the Western Hill (~765 m) from Moriah & City of David (~690–743 m)',
    summary:
      'Internal north–south gorge slicing through the heart of ancient Jerusalem toward the Pool of Siloam, spanned in the Second Temple era by Robinson’s Arch and Wilson’s Arch.',
    historicalNote:
      'Named the "Valley of the Cheesemakers" (Tyropoeon) by Josephus (War 5.140); centuries of fill have largely obscured its steep biblical depth beneath modern Old City streets.',
    sourceRefs: [
      { label: 'Neh 3:15', passage: { book: 16, chapter: 3, verse: 15 } },
      { label: 'Zeph 1:11', passage: { book: 36, chapter: 1, verse: 11 } },
      { label: 'John 9:7', passage: { book: 43, chapter: 9, verse: 7 } },
    ],
    svgBox: { x: 300, y: 112, w: 38, h: 222, shape: 'rect' },
  },
];

export const ARCHITECTURE_PLANS: Record<ArchitecturePlanId, ArchitecturePlan> = {
  tabernacle: {
    id: 'tabernacle',
    title: 'Wilderness Tabernacle',
    subtitle: 'Portable Desert Sanctuary & Courtyard Furnishings',
    eraLabel: 'Exodus – Judges (Exod 25–40)',
    epistemicNote:
      'Schematic 2D architectural plan based directly on Exodus 25–40 and Leviticus 16 (dimensions in ancient cubits, ≈ 45 cm). Courtyard (100 × 50 cubits) and Tent of Meeting (30 × 10 cubits) are drawn with slightly widened interior spacing so each furnishing remains cleanly readable.',
    viewBox: '0 0 760 440',
    elements: TABERNACLE_ELEMENTS,
  },
  first_temple: {
    id: 'first_temple',
    title: "Solomon's First Temple",
    subtitle: 'Solomonic Sanctuary, Side Chambers & Inner Court',
    eraLabel: 'c. 960–586 BCE (1 Kgs 6–8; 2 Chr 3–4)',
    epistemicNote:
      'Reconstruction derived from 1 Kings 6–8 and 2 Chronicles 3–4 (no direct archaeological excavation exists beneath the Temple Mount sanctuary footprint). Distinguishes the Solomonic complex (with Ten Lampstands, Ten Tables, Jachin & Boaz, and the Molten Sea) from both the earlier Tabernacle and the later Second Temple.',
    viewBox: '0 0 760 440',
    elements: FIRST_TEMPLE_ELEMENTS,
  },
  second_temple: {
    id: 'second_temple',
    title: 'Second / Herodian Temple',
    subtitle: 'New Testament Complex (Gospels, Acts & Hebrews)',
    eraLabel: 'c. 20 BCE – 70 CE (Herodian Era)',
    epistemicNote:
      'Synthesizes NT witnesses (Gospels, Acts, Eph 2:14, Heb 9) with Josephus, Mishnah Middot, and Herodian perimeter archaeology. Distinguish carefully: this Herodian complex differs substantially from Solomon’s First Temple (586 BCE) and from Ezekiel’s visionary temple (Ezek 40–48), and its Most Holy Place contained no Ark—only the exposed Foundation Stone.',
    viewBox: '0 0 760 440',
    elements: SECOND_TEMPLE_ELEMENTS,
  },
  jerusalem_gates: {
    id: 'jerusalem_gates',
    title: 'Jerusalem Walls & Gates',
    subtitle: 'Biblical Gates, Waterworks & Topographic Landmarks',
    eraLabel: 'Monarchy – Nehemiah – NT (Neh 3 & 12)',
    epistemicNote:
      'Geographically oriented schematic (North up, Kidron & Mount of Olives East, Hinnom West/South). Gate placements follow Nehemiah 3’s counterclockwise repair circuit and Nehemiah 12’s processions. Note: the biblical East Gate (Neh 3:29; Ezek 43:1–4) must be distinguished from the later 6th–16th c. sealed Ottoman Golden Gate built above ancient eastern arches.',
    viewBox: '0 0 760 440',
    elements: JERUSALEM_GATES_ELEMENTS,
  },
};

const ALL_ELEMENTS: ArchitectureElement[] = [
  ...TABERNACLE_ELEMENTS,
  ...FIRST_TEMPLE_ELEMENTS,
  ...SECOND_TEMPLE_ELEMENTS,
  ...JERUSALEM_GATES_ELEMENTS,
];

const ELEMENT_BY_KEY = new Map<string, ArchitectureElement>(
  ALL_ELEMENTS.map(e => [`${e.planId}:${e.id}`, e]),
);

// === @section:logic:normalize ===
export function normalizeStrongsCode(code?: string | null): string {
  if (!code) return '';
  const m = /^([HG])0*(\d+)([A-Z]?)$/.exec(code.trim().toUpperCase());
  if (!m) return code.trim().toUpperCase();
  return `${m[1]}${m[2]}${m[3]}`;
}

function getDefaultPlanForPassage(passage: ActivePassage): ArchitecturePlanId {
  const { book, chapter } = passage;
  // Exodus (2), Leviticus (3), Numbers (4) -> Tabernacle
  if (book === 2 || book === 3 || book === 4) return 'tabernacle';
  // Hebrews 9:1-5 explicitly reviews the earthly Tabernacle layout
  if (book === 58 && chapter === 9 && passage.verse <= 5) return 'tabernacle';
  // 1-2 Kings (11,12), 1-2 Chronicles (13,14) -> First Temple
  if (book === 11 || book === 12 || book === 13 || book === 14) return 'first_temple';
  // Ezekiel 40-48 (26) -> First/Visionary Temple unless East Gate specifically matched
  if (book === 26 && chapter >= 40) return 'first_temple';
  // Ezra (15), Nehemiah (16), Zephaniah (36), Zechariah (38) -> Jerusalem & Gates
  if (book === 15 || book === 16 || book === 36 || book === 38) return 'jerusalem_gates';
  // New Testament (40-66) -> Second Temple by default
  if (book >= 40) return 'second_temple';
  return 'jerusalem_gates';
}

// === @section:logic:detection ===
interface PhraseRule {
  id: string;
  planId?: ArchitecturePlanId;
  englishPhrases: string[];
  strongsAnchor?: string[];
  strongsPartner?: string[];
  label: string;
}

const PHRASE_RULES: PhraseRule[] = [
  {
    id: 'courtyard_gate',
    planId: 'tabernacle',
    englishPhrases: ['gate of the court', 'courtyard gate', 'screen for the gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H2691', 'H4539'],
    label: 'Courtyard Gate phrase',
  },
  {
    id: 'east_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['east gate', 'eastern gate', 'eastward gate', 'gate toward the east', 'gate facing east'],
    strongsAnchor: ['H8179', 'G4439'],
    strongsPartner: ['H4217', 'H6921', 'H6924', 'G395'],
    label: 'East Gate phrase',
  },
  {
    id: 'sheep_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['sheep gate', 'sheep market'],
    strongsAnchor: ['H8179', 'G4439'],
    strongsPartner: ['H6629', 'G4262'],
    label: 'Sheep Gate phrase',
  },
  {
    id: 'fish_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['fish gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H1709'],
    label: 'Fish Gate phrase',
  },
  {
    id: 'old_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['old gate', 'jeshanah gate', 'gate of jeshanah'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H3465'],
    label: 'Old Gate phrase',
  },
  {
    id: 'water_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['water gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H4325'],
    label: 'Water Gate phrase',
  },
  {
    id: 'valley_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['valley gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H1516'],
    label: 'Valley Gate phrase',
  },
  {
    id: 'dung_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['dung gate', 'refuse gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H830'],
    label: 'Dung Gate phrase',
  },
  {
    id: 'horse_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['horse gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H5483'],
    label: 'Horse Gate phrase',
  },
  {
    id: 'fountain_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['fountain gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H5869'],
    label: 'Fountain Gate phrase',
  },
  {
    id: 'inspection_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['inspection gate', 'gate miphkad', 'muster gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H4663'],
    label: 'Inspection Gate phrase',
  },
  {
    id: 'corner_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['corner gate'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H6438'],
    label: 'Corner Gate phrase',
  },
  {
    id: 'ephraim_gate',
    planId: 'jerusalem_gates',
    englishPhrases: ['ephraim gate', 'gate of ephraim'],
    strongsAnchor: ['H8179'],
    strongsPartner: ['H669'],
    label: 'Ephraim Gate phrase',
  },
  {
    id: 'beautiful_gate',
    planId: 'second_temple',
    englishPhrases: ['beautiful gate', 'gate called beautiful'],
    strongsAnchor: ['G2374', 'G4439'],
    strongsPartner: ['G5611'],
    label: 'Beautiful Gate phrase',
  },
  {
    id: 'solomons_portico',
    planId: 'second_temple',
    englishPhrases: ["solomon's portico", 'solomon portico', "solomon's porch", 'solomon porch'],
    strongsAnchor: ['G4745'],
    strongsPartner: ['G4672'],
    label: "Solomon's Portico phrase",
  },
  {
    id: 'city_of_david',
    planId: 'jerusalem_gates',
    englishPhrases: ['city of david'],
    strongsAnchor: ['H5892'],
    strongsPartner: ['H1732'],
    label: 'City of David phrase',
  },
  {
    id: 'pool_of_siloam',
    planId: 'jerusalem_gates',
    englishPhrases: ['pool of siloam', 'siloam', 'pool of shelah'],
    strongsAnchor: ['H7975', 'G4611'],
    label: 'Pool of Siloam',
  },
  {
    id: 'pool_of_bethesda',
    planId: 'jerusalem_gates',
    englishPhrases: ['pool of bethesda', 'bethesda'],
    strongsAnchor: ['G964'],
    label: 'Pool of Bethesda',
  },
  {
    id: 'mount_of_olives',
    planId: 'jerusalem_gates',
    englishPhrases: ['mount of olives', 'olivet'],
    strongsAnchor: ['H2022', 'G3735'],
    strongsPartner: ['H2132', 'G1636'],
    label: 'Mount of Olives phrase',
  },
  {
    id: 'kidron_valley',
    planId: 'jerusalem_gates',
    englishPhrases: ['kidron', 'brook kidron'],
    strongsAnchor: ['H6939', 'G2748'],
    label: 'Kidron Valley',
  },
  {
    id: 'antonia_fortress',
    planId: 'jerusalem_gates',
    englishPhrases: ['antonia', 'the barracks', 'the fortress'],
    strongsAnchor: ['G3925'],
    label: 'Antonia Fortress',
  },
  {
    id: 'gethsemane',
    planId: 'jerusalem_gates',
    englishPhrases: ['gethsemane'],
    strongsAnchor: ['G1068'],
    label: 'Gethsemane',
  },
  {
    id: 'herods_palace',
    planId: 'jerusalem_gates',
    englishPhrases: ["herod's palace", 'praetorium', 'upper city'],
    strongsAnchor: ['G4232'],
    label: "Herod's Palace",
  },
  {
    id: 'tyropoeon_valley',
    planId: 'jerusalem_gates',
    englishPhrases: ['tyropoeon', 'central valley'],
    label: 'Tyropoeon Valley',
  },
  {
    id: 'mercy_seat',
    planId: 'tabernacle',
    englishPhrases: ['mercy seat', 'atonement cover'],
    strongsAnchor: ['H3727'],
    label: 'Mercy Seat',
  },
  {
    id: 'incense_altar_generic',
    englishPhrases: ['altar of incense', 'golden altar'],
    strongsAnchor: ['H4196', 'G2379'],
    strongsPartner: ['H7004', 'G2368'],
    label: 'Altar of Incense phrase',
  },
  {
    id: 'holy_of_holies_generic',
    englishPhrases: ['holy of holies', 'most holy place'],
    label: 'Most Holy Place phrase',
  },
];

function resolvePlanElementByFamily(
  familyKey: 'incense_altar_generic' | 'holy_of_holies_generic',
  preferredPlan: ArchitecturePlanId,
): ArchitectureElement | undefined {
  if (familyKey === 'incense_altar_generic') {
    if (preferredPlan === 'first_temple') return ELEMENT_BY_KEY.get('first_temple:first_incense_altar');
    if (preferredPlan === 'second_temple') return ELEMENT_BY_KEY.get('second_temple:second_incense_altar');
    return ELEMENT_BY_KEY.get('tabernacle:incense_altar');
  }
  if (preferredPlan === 'first_temple') return ELEMENT_BY_KEY.get('first_temple:debir');
  if (preferredPlan === 'second_temple') return ELEMENT_BY_KEY.get('second_temple:second_most_holy');
  return ELEMENT_BY_KEY.get('tabernacle:tent_most_holy');
}

function resolvePhraseElement(rule: PhraseRule, preferredPlan: ArchitecturePlanId): ArchitectureElement | undefined {
  if (rule.id === 'incense_altar_generic' || rule.id === 'holy_of_holies_generic') {
    return resolvePlanElementByFamily(rule.id, preferredPlan);
  }
  if (rule.planId) {
    return ELEMENT_BY_KEY.get(`${rule.planId}:${rule.id}`);
  }
  return undefined;
}

function getTokenText(tok: VerseTokenLike): string {
  return (tok.selected_english ?? tok.source_english ?? '').trim().toLowerCase();
}

function matchPhraseRuleInWindow(
  rule: PhraseRule,
  windowTokens: VerseTokenLike[],
  clickedStrongsNorm: string,
  clickedEnglishLower: string,
): boolean {
  const joinedWindow = windowTokens.map(getTokenText).filter(Boolean).join(' ');
  const reversedWindow = [...windowTokens].reverse().map(getTokenText).filter(Boolean).join(' ');

  // 1. Direct English phrase check across clicked word or token window
  const englishHit = rule.englishPhrases.some(phrase => {
    if (clickedEnglishLower.includes(phrase)) return true;
    return joinedWindow.includes(phrase) || reversedWindow.includes(phrase);
  });

  // 2. Strong's pair proximity check (±3 word positions)
  const normAnchors = (rule.strongsAnchor ?? []).map(normalizeStrongsCode);
  const normPartners = (rule.strongsPartner ?? []).map(normalizeStrongsCode);
  const windowStrongs = windowTokens.map(t => normalizeStrongsCode(t.strongs_nr));

  let strongsPairHit = false;
  if (normAnchors.length > 0 && normPartners.length > 0) {
    const clickedIsAnchor = normAnchors.includes(clickedStrongsNorm);
    const clickedIsPartner = normPartners.includes(clickedStrongsNorm);
    const hasAnchor = clickedIsAnchor || windowStrongs.some(s => normAnchors.includes(s));
    const hasPartner = clickedIsPartner || windowStrongs.some(s => normPartners.includes(s));
    if (hasAnchor && hasPartner && (clickedIsAnchor || clickedIsPartner || !clickedStrongsNorm)) {
      strongsPairHit = true;
    }
  } else if (normAnchors.length > 0 && normAnchors.includes(clickedStrongsNorm)) {
    strongsPairHit = true;
  }

  if (strongsPairHit) return true;

  if (englishHit) {
    // Ensure clicked token actually participates in the phrase if a specific word was clicked
    if (!clickedStrongsNorm && !clickedEnglishLower) return true;
    if (
      normAnchors.includes(clickedStrongsNorm) ||
      normPartners.includes(clickedStrongsNorm) ||
      rule.englishPhrases.some(p => clickedEnglishLower && p.split(/\s+/).some(w => clickedEnglishLower.includes(w)))
    ) {
      return true;
    }
  }

  return false;
}

function scoreElementForPassage(el: ArchitectureElement, passage: ActivePassage, preferredPlan: ArchitecturePlanId): number {
  let score = 0;
  if (el.planId === preferredPlan) score += 10;
  for (const ref of el.sourceRefs) {
    if (ref.passage.book === passage.book && ref.passage.chapter === passage.chapter) {
      score += ref.passage.verse === passage.verse ? 25 : 8;
    } else if (ref.passage.book === passage.book) {
      score += 3;
    }
  }
  return score;
}

export function detectArchitectureForWord(args: {
  strongs?: string;
  english?: string;
  original?: string;
  passage: ActivePassage;
  verseTokens?: VerseTokenLike[];
  position?: number;
}): ArchitectureDetection | null {
  const { strongs, english, passage, verseTokens, position } = args;
  const normStrongs = normalizeStrongsCode(strongs);
  const englishLower = (english ?? '').trim().toLowerCase();
  const preferredPlan = getDefaultPlanForPassage(passage);

  // Build ±3 window around clicked token position
  let windowTokens: VerseTokenLike[] = [];
  if (verseTokens && verseTokens.length > 0) {
    let centerPos = position;
    if (centerPos === undefined && normStrongs) {
      const found = verseTokens.find(t => normalizeStrongsCode(t.strongs_nr) === normStrongs);
      centerPos = found?.word_position;
    }
    if (centerPos !== undefined) {
      windowTokens = verseTokens
        .filter(t => Math.abs(t.word_position - centerPos!) <= 3)
        .sort((a, b) => a.word_position - b.word_position);
    } else {
      windowTokens = [...verseTokens].sort((a, b) => a.word_position - b.word_position);
    }
  }

  // 1. Multi-word phrase & proximity rules first (handles "east" + "gate", "altar" + "incense", etc.)
  for (const rule of PHRASE_RULES) {
    if (matchPhraseRuleInWindow(rule, windowTokens, normStrongs, englishLower)) {
      const el = resolvePhraseElement(rule, preferredPlan);
      if (el) {
        return {
          planId: el.planId,
          element: el,
          reason: `Matched ${rule.label} (${el.name})`,
        };
      }
    }
  }

  // 2. Direct single-token Strong's lookup (skip generic direction/gate words without phrase match)
  const GENERIC_DIRECTION_STRONGS = new Set(['H8179', 'H4217', 'H6921', 'H6924', 'G4439', 'G395', 'H2022', 'G3735']);
  if (normStrongs && !GENERIC_DIRECTION_STRONGS.has(normStrongs)) {
    const candidates = ALL_ELEMENTS.filter(el =>
      el.strongs.some(s => normalizeStrongsCode(s) === normStrongs),
    );
    if (candidates.length > 0) {
      candidates.sort(
        (a, b) => scoreElementForPassage(b, passage, preferredPlan) - scoreElementForPassage(a, passage, preferredPlan),
      );
      const best = candidates[0]!;
      return {
        planId: best.planId,
        element: best,
        reason: `Strong's ${normStrongs} → ${best.name}`,
      };
    }
  }

  // 3. Direct English phrase match against element phraseKeywords (e.g. "menorah", "jerosalem", "molten sea")
  if (englishLower.length >= 4) {
    const kwCandidates = ALL_ELEMENTS.filter(el =>
      (el.phraseKeywords ?? []).some(kw => englishLower.includes(kw) || kw === englishLower),
    );
    if (kwCandidates.length > 0) {
      kwCandidates.sort(
        (a, b) => scoreElementForPassage(b, passage, preferredPlan) - scoreElementForPassage(a, passage, preferredPlan),
      );
      const best = kwCandidates[0]!;
      return {
        planId: best.planId,
        element: best,
        reason: `Keyword "${englishLower}" → ${best.name}`,
      };
    }
  }

  return null;
}

export function detectArchitectureForPassage(
  passage: ActivePassage,
  verseTokens?: VerseTokenLike[],
): ArchitectureDetection[] {
  const preferredPlan = getDefaultPlanForPassage(passage);
  const results = new Map<string, ArchitectureDetection>();

  const push = (det: ArchitectureDetection | null) => {
    if (!det) return;
    const key = `${det.planId}:${det.element.id}`;
    if (!results.has(key)) results.set(key, det);
  };

  // 1. Scan tokens in the verse for phrase rules and Strong's matches
  if (verseTokens && verseTokens.length > 0) {
    const sorted = [...verseTokens].sort((a, b) => a.word_position - b.word_position);
    for (const tok of sorted) {
      const det = detectArchitectureForWord({
        strongs: tok.strongs_nr,
        english: tok.selected_english ?? tok.source_english ?? undefined,
        passage,
        verseTokens: sorted,
        position: tok.word_position,
      });
      push(det);
    }
  }

  // 2. Direct scripture reference matches (exact verse first, then same chapter)
  for (const el of ALL_ELEMENTS) {
    for (const ref of el.sourceRefs) {
      if (ref.passage.book === passage.book && ref.passage.chapter === passage.chapter && ref.passage.verse === passage.verse) {
        push({ planId: el.planId, element: el, reason: `Direct reference ${ref.label}` });
      }
    }
  }

  for (const el of ALL_ELEMENTS) {
    for (const ref of el.sourceRefs) {
      if (ref.passage.book === passage.book && ref.passage.chapter === passage.chapter) {
        push({ planId: el.planId, element: el, reason: `Chapter reference (${ref.label})` });
      }
    }
  }

  // Sort preferred plan & exact references ahead of secondary matches
  return [...results.values()].sort((a, b) => {
    const scoreA = scoreElementForPassage(a.element, passage, preferredPlan);
    const scoreB = scoreElementForPassage(b.element, passage, preferredPlan);
    return scoreB - scoreA;
  });
}

// === @section:ui:svg ===
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

const VISUAL_META: Record<string, ElementVisualMeta> = {
  // Tabernacle
  outer_courtyard: { shortLabel: 'Outer Courtyard (100 × 50 cubits)', labelX: 336, labelY: 66, isZoneBackdrop: true },
  courtyard_gate: { shortLabel: 'East Gate', labelX: 642, labelY: 224, anchor: 'start', subLabel: '20 cubits' },
  bronze_altar: { shortLabel: 'Bronze Altar', labelX: 524, labelY: 266 },
  bronze_laver: { shortLabel: 'Laver', labelX: 441, labelY: 258 },
  tent_most_holy: { shortLabel: 'Most Holy', labelX: 150, labelY: 120, isZoneBackdrop: true },
  tent_holy_place: { shortLabel: 'Holy Place (20 × 10)', labelX: 298, labelY: 120, isZoneBackdrop: true },
  mercy_seat: { shortLabel: 'Mercy Seat', labelX: 149, labelY: 156 },
  ark_covenant: { shortLabel: 'Ark', labelX: 149, labelY: 268 },
  veil: { shortLabel: 'Veil', labelX: 204, labelY: 326 },
  incense_altar: { shortLabel: 'Incense', labelX: 242, labelY: 256 },
  table_showbread: { shortLabel: 'Showbread (N)', labelX: 329, labelY: 150 },
  menorah: { shortLabel: 'Menorah (S)', labelX: 329, labelY: 292 },

  // First Temple
  first_inner_court: { shortLabel: 'Inner Court', labelX: 347, labelY: 52, isZoneBackdrop: true },
  side_chambers: { shortLabel: '3-Story Side Chambers', labelX: 228, labelY: 98, isZoneBackdrop: true },
  debir: { shortLabel: 'Debir (20×20)', labelX: 160, labelY: 158, isZoneBackdrop: true },
  solomon_ark_cherubim: { shortLabel: 'Ark & Cherubim', labelX: 160, labelY: 276 },
  hekal: { shortLabel: 'Hekal (40 × 20)', labelX: 297, labelY: 155, isZoneBackdrop: true },
  first_incense_altar: { shortLabel: 'Incense', labelX: 244, labelY: 256 },
  ten_tables: { shortLabel: '10 Tables (N/S)', labelX: 323, labelY: 209 },
  ten_lampstands: { shortLabel: '10 Lampstands', labelX: 323, labelY: 289 },
  ulam_porch: { shortLabel: 'Ulam', labelX: 407, labelY: 225, isZoneBackdrop: true },
  pillars_jachin_boaz: { shortLabel: 'Boaz / Jachin', labelX: 468, labelY: 225, anchor: 'start' },
  first_bronze_altar: { shortLabel: 'Burnt Altar', labelX: 579, labelY: 276 },
  molten_sea: { shortLabel: 'Molten Sea', labelX: 515, labelY: 368 },
  ten_lavers: { shortLabel: '10 Lavers (5 N / 5 S)', labelX: 548, labelY: 77 },

  // Second Temple
  court_of_gentiles: { shortLabel: 'Court of the Gentiles (Hieron)', labelX: 334, labelY: 46, isZoneBackdrop: true },
  royal_stoa: { shortLabel: 'Royal Stoa (South Basilica)', labelX: 336, labelY: 379 },
  solomons_portico: { shortLabel: "Solomon's Portico", labelX: 652, labelY: 225 },
  soreq_balustrade: { shortLabel: 'Soreq Balustrade', labelX: 340, labelY: 91, isZoneBackdrop: true },
  beautiful_gate: { shortLabel: 'Beautiful Gate', labelX: 598, labelY: 220, anchor: 'start' },
  womens_court: { shortLabel: "Women's Court", labelX: 507, labelY: 146, isZoneBackdrop: true },
  nicanor_gate: { shortLabel: 'Nicanor', labelX: 439, labelY: 264 },
  court_israel_priests: { shortLabel: 'Priests & Altar', labelX: 374, labelY: 146, isZoneBackdrop: true },
  second_sanctuary: { shortLabel: 'Sanctuary (Naos)', labelX: 212, labelY: 126, isZoneBackdrop: true },
  second_showbread: { shortLabel: 'Showbread', labelX: 255, labelY: 150 },
  second_menorah: { shortLabel: 'Menorah', labelX: 255, labelY: 289 },
  second_incense_altar: { shortLabel: 'Incense', labelX: 201, labelY: 250 },
  second_veil: { shortLabel: 'Veil', labelX: 176, labelY: 314 },
  second_most_holy: { shortLabel: 'Holy of Holies', labelX: 145, labelY: 216, isZoneBackdrop: true },

  // Jerusalem Gates
  temple_mount: { shortLabel: 'Temple Mount', labelX: 417, labelY: 158, isZoneBackdrop: true },
  city_of_david: { shortLabel: 'City of David', labelX: 400, labelY: 276, isZoneBackdrop: true },
  kidron_valley: { shortLabel: 'Kidron Valley', labelX: 595, labelY: 368, isZoneBackdrop: true },
  mount_of_olives: { shortLabel: 'Mount of Olives', labelX: 696, labelY: 224, isZoneBackdrop: true },
  hinnom_valley: { shortLabel: 'Hinnom Valley', labelX: 90, labelY: 280, isZoneBackdrop: true },
  tyropoeon_valley: { shortLabel: 'Tyropoeon Valley', labelX: 319, labelY: 242, isZoneBackdrop: true },
  antonia_fortress: { shortLabel: 'Antonia', labelX: 408, labelY: 118 },
  gethsemane: { shortLabel: 'Gethsemane', labelX: 636, labelY: 148 },
  herods_palace: { shortLabel: "Herod's Palace", labelX: 218, labelY: 227 },
  gihon_spring: { shortLabel: 'Gihon Spring', labelX: 478, labelY: 293, anchor: 'start' },
  pool_of_siloam: { shortLabel: 'Pool of Siloam', labelX: 324, labelY: 335, anchor: 'end' },
  pool_of_bethesda: { shortLabel: 'Bethesda', labelX: 448, labelY: 56, anchor: 'start' },
  sheep_gate: { shortLabel: 'Sheep', labelX: 476, labelY: 85, anchor: 'start' },
  inspection_gate: { shortLabel: 'Inspection', labelX: 512, labelY: 135, anchor: 'start' },
  east_gate: { shortLabel: 'East Gate', labelX: 512, labelY: 178, anchor: 'start' },
  horse_gate: { shortLabel: 'Horse', labelX: 506, labelY: 219, anchor: 'start' },
  water_gate: { shortLabel: 'Water', labelX: 472, labelY: 255, anchor: 'start' },
  fountain_gate: { shortLabel: 'Fountain', labelX: 422, labelY: 354, anchor: 'start' },
  dung_gate: { shortLabel: 'Dung', labelX: 317, labelY: 394 },
  valley_gate: { shortLabel: 'Valley', labelX: 138, labelY: 279, anchor: 'end' },
  corner_gate: { shortLabel: 'Corner', labelX: 150, labelY: 126, anchor: 'end' },
  ephraim_gate: { shortLabel: 'Ephraim', labelX: 231, labelY: 75 },
  old_gate: { shortLabel: 'Old Gate', labelX: 305, labelY: 68 },
  fish_gate: { shortLabel: 'Fish', labelX: 367, labelY: 66 },
};

function renderCompassBadge(root: SVGSVGElement): void {
  const g = svgEl('g', { class: 'arch-compass', 'aria-hidden': 'true' });
  g.append(
    svgEl('circle', { cx: 716, cy: 36, r: 22, class: 'arch-compass-ring' }),
    svgEl('line', { x1: 716, y1: 18, x2: 716, y2: 54, class: 'arch-compass-axis' }),
    svgEl('line', { x1: 698, y1: 36, x2: 734, y2: 36, class: 'arch-compass-axis' }),
    svgEl('polygon', { points: '716,17 713,25 719,25', class: 'arch-compass-north' }),
    svgEl('text', { x: 716, y: 12, class: 'arch-compass-lbl' }, 'N'),
    svgEl('text', { x: 742, y: 40, class: 'arch-compass-lbl' }, 'E'),
    svgEl('text', { x: 716, y: 66, class: 'arch-compass-lbl' }, 'S'),
    svgEl('text', { x: 690, y: 40, class: 'arch-compass-lbl' }, 'W'),
  );
  root.append(g);
}

function appendJerusalemTerrainDefs(defs: SVGDefsElement): void {
  const mkGrad = (id: string, stops: Array<{ offset: string; color: string; opacity: number }>) => {
    const grad = svgEl('radialGradient', { id, cx: '50%', cy: '50%', r: '50%' });
    for (const s of stops) {
      grad.append(svgEl('stop', { offset: s.offset, 'stop-color': s.color, 'stop-opacity': s.opacity }));
    }
    return grad;
  };
  const valleyGrad = svgEl('linearGradient', { id: 'arch-grad-valley', x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
  valleyGrad.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#385c6b', 'stop-opacity': 0.28 }),
    svgEl('stop', { offset: '100%', 'stop-color': '#233b44', 'stop-opacity': 0.1 }),
  );
  defs.append(
    mkGrad('arch-grad-olives', [
      { offset: '0%', color: '#c8a96e', opacity: 0.34 },
      { offset: '65%', color: '#8f7d52', opacity: 0.16 },
      { offset: '100%', color: '#8f7d52', opacity: 0 },
    ]),
    mkGrad('arch-grad-ridge', [
      { offset: '0%', color: '#d7ba7e', opacity: 0.26 },
      { offset: '70%', color: '#a59369', opacity: 0.12 },
      { offset: '100%', color: '#a59369', opacity: 0 },
    ]),
    valleyGrad,
  );
}

function renderPlanBackdrop(root: SVGSVGElement, planId: ArchitecturePlanId, showTerrain = true): void {
  const bg = svgEl('g', { class: 'arch-backdrop', 'aria-hidden': 'true' });

  // Subtle East-West axis guide at bottom
  bg.append(
    svgEl('line', { x1: 56, y1: 416, x2: 676, y2: 416, class: 'arch-axis-guide' }),
    svgEl(
      'text',
      { x: 366, y: 432, class: 'arch-axis-text', 'text-anchor': 'middle' },
      planId === 'jerusalem_gates'
        ? 'West (Hinnom) ← Topographic Axis → East (Kidron & Mount of Olives)'
        : 'West (Most Holy Place) ← Sacred East–West Axis → East (Entrance)',
    ),
  );

  if (planId === 'jerusalem_gates') {
    if (showTerrain) {
      const reliefImg = svgEl('image', {
        href: 'https://commons.wikimedia.org/wiki/Special:FilePath/JerusalemTopography.png?width=1000',
        x: 0,
        y: 0,
        width: 760,
        height: 440,
        opacity: '0.35',
        preserveAspectRatio: 'xMidYMid slice',
        class: 'arch-terrain-image',
      });
      reliefImg.addEventListener('error', () => {
        reliefImg.remove();
      });
      bg.append(reliefImg);

      // Hypsometric ridge & valley gradient fills
      bg.append(
        svgEl('ellipse', { cx: 696, cy: 218, rx: 78, ry: 145, fill: 'url(#arch-grad-olives)' }),
        svgEl('ellipse', { cx: 418, cy: 158, rx: 92, ry: 74, fill: 'url(#arch-grad-ridge)' }),
        svgEl('ellipse', { cx: 224, cy: 228, rx: 84, ry: 112, fill: 'url(#arch-grad-ridge)' }),
        svgEl('path', {
          d: 'M 556,48 C 566,158 552,272 532,394 L 622,394 C 632,272 634,158 626,48 Z',
          fill: 'url(#arch-grad-valley)',
        }),
        svgEl('path', {
          d: 'M 294,102 C 304,194 308,284 316,356 L 352,356 C 344,284 342,194 338,102 Z',
          fill: 'url(#arch-grad-valley)',
        }),
        svgEl('path', {
          d: 'M 42,158 C 46,278 94,378 338,392 L 344,368 C 138,354 114,268 118,158 Z',
          fill: 'url(#arch-grad-valley)',
        }),
      );
    }

    // Multi-step SVG topographic contour lines
    bg.append(
      // Mount of Olives ridge east (815 m)
      svgEl('path', {
        d: 'M 642,88 C 686,74 736,104 742,212 C 746,314 708,356 664,348 C 632,340 624,262 628,176 C 630,126 634,94 642,88 Z',
        class: 'arch-contour-line',
      }),
      svgEl('path', {
        d: 'M 664,126 C 692,118 724,142 726,214 C 728,284 704,314 676,306 C 654,300 650,248 654,184 Z',
        class: 'arch-contour-line arch-contour-line--inner',
      }),
      // Moriah / Temple Mount ridge center-east (743 m)
      svgEl('path', {
        d: 'M 342,96 C 388,82 464,86 496,112 C 512,148 504,202 478,224 C 424,230 356,222 338,194 C 330,154 334,112 342,96 Z',
        class: 'arch-contour-line',
      }),
      // Upper City / Western Hill west (765 m)
      svgEl('path', {
        d: 'M 158,128 C 204,104 276,112 294,158 C 304,218 296,304 256,334 C 202,342 152,302 146,232 C 142,174 148,142 158,128 Z',
        class: 'arch-contour-line',
      }),
      svgEl('path', {
        d: 'M 178,164 C 210,148 258,154 270,192 C 278,236 268,284 236,302 C 198,306 172,276 170,224 Z',
        class: 'arch-contour-line arch-contour-line--inner',
      }),
      // City of David spur south (690 m)
      svgEl('path', {
        d: 'M 358,222 C 398,216 446,226 458,266 C 464,306 436,342 396,348 C 362,346 346,304 348,256 Z',
        class: 'arch-contour-line arch-contour-line--inner',
      }),
      // Kidron Valley depression contour (640 m)
      svgEl('path', {
        d: 'M 578,66 C 594,156 592,262 562,386',
        class: 'arch-valley-line',
      }),
      // Hinnom Valley curve
      svgEl('path', {
        d: 'M 94,182 C 92,294 144,368 332,382',
        class: 'arch-valley-line',
      }),
      // Elevation labels
      svgEl('text', { x: 696, y: 98, class: 'arch-elev-label', 'text-anchor': 'middle' }, '815 m'),
      svgEl('text', { x: 224, y: 148, class: 'arch-elev-label', 'text-anchor': 'middle' }, '765 m'),
      svgEl('text', { x: 454, y: 120, class: 'arch-elev-label', 'text-anchor': 'middle' }, '743 m'),
      svgEl('text', { x: 400, y: 330, class: 'arch-elev-label', 'text-anchor': 'middle' }, '690 m'),
      svgEl('text', { x: 595, y: 82, class: 'arch-elev-label', 'text-anchor': 'middle' }, '640 m'),
      // City Wall Loop
      svgEl('path', {
        d: 'M 154,274 L 148,196 L 166,122 L 232,96 L 304,88 L 367,86 L 456,92 L 494,108 L 494,214 L 455,250 L 444,306 L 404,348 L 318,368 L 194,342 Z',
        class: 'arch-city-wall',
      }),
      // Tyropoeon Central Valley subtle dashed path
      svgEl('path', {
        d: 'M 322,92 C 324,165 326,248 334,342',
        class: 'arch-valley-line',
      }),
      // Hezekiah's Tunnel S-curve from Gihon Spring to Pool of Siloam
      svgEl('path', {
        d: 'M 452,288 C 412,282 396,318 354,328',
        class: 'arch-water-tunnel',
      }),
      svgEl('text', { x: 404, y: 314, class: 'arch-subnote', 'text-anchor': 'middle' }, "Hezekiah's Tunnel"),
    );
  } else if (planId === 'first_temple') {
    // Subtle indication of South 5 lavers matching North 5 lavers
    for (let i = 0; i < 5; i += 1) {
      bg.append(svgEl('circle', { cx: 498 + i * 24, cy: 352, r: 6, class: 'arch-ghost-prop' }));
    }
    bg.append(svgEl('text', { x: 546, y: 372, class: 'arch-subnote', 'text-anchor': 'middle' }, '5 South Lavers'));
  } else if (planId === 'second_temple') {
    // Dashed sacrificial altar square inside Court of Israel/Priests
    bg.append(
      svgEl('rect', { x: 354, y: 194, width: 42, height: 42, rx: 3, class: 'arch-ghost-prop' }),
      svgEl('text', { x: 375, y: 252, class: 'arch-subnote', 'text-anchor': 'middle' }, 'Altar'),
    );
  }

  root.append(bg);
}

function renderCustomElementShapes(g: SVGGElement, el: ArchitectureElement): void {
  const { x, y, w, h, shape } = el.svgBox;

  if (el.id === 'pillars_jachin_boaz') {
    g.append(
      svgEl('rect', { x, y, width: w, height: h, rx: 4, class: 'arch-hit-area' }),
      svgEl('circle', { cx: x + w / 2, cy: y + 14, r: 10, class: 'arch-node-shape arch-pillar' }),
      svgEl('circle', { cx: x + w / 2, cy: y + h - 14, r: 10, class: 'arch-node-shape arch-pillar' }),
      svgEl('text', { x: x + w / 2, y: y + 3, class: 'arch-subnote', 'text-anchor': 'middle' }, 'Boaz (N)'),
      svgEl('text', { x: x + w / 2, y: y + h + 11, class: 'arch-subnote', 'text-anchor': 'middle' }, 'Jachin (S)'),
    );
    return;
  }

  if (el.id === 'ten_lavers') {
    g.append(svgEl('rect', { x, y, width: w, height: h, rx: 5, class: 'arch-node-shape' }));
    for (let i = 0; i < 5; i += 1) {
      g.append(svgEl('circle', { cx: x + 14 + i * 24, cy: y + h / 2, r: 6, class: 'arch-detail-dot' }));
    }
    return;
  }

  if (el.id === 'menorah' || el.id === 'ten_lampstands' || el.id === 'second_menorah') {
    g.append(svgEl('rect', { x, y, width: w, height: h, rx: 5, class: 'arch-node-shape' }));
    const cx = x + w / 2;
    const cy = y + h / 2;
    g.append(svgEl('line', { x1: cx - 16, y1: cy + 5, x2: cx + 16, y2: cy + 5, class: 'arch-detail-stroke' }));
    for (let i = -3; i <= 3; i += 1) {
      g.append(svgEl('circle', { cx: cx + i * 5, cy: cy - 3, r: 2, class: 'arch-detail-dot' }));
    }
    return;
  }

  if (shape === 'circle') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2;
    g.append(svgEl('circle', { cx, cy, r, class: 'arch-node-shape' }));
    return;
  }

  if (shape === 'gate') {
    g.append(
      svgEl('rect', { x, y, width: w, height: h, rx: 3, class: 'arch-node-shape arch-gate-shape' }),
      svgEl('line', { x1: x + w / 2, y1: y + 3, x2: x + w / 2, y2: y + h - 3, class: 'arch-gate-split' }),
    );
    return;
  }

  g.append(
    svgEl('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: el.id === 'outer_courtyard' || el.id === 'first_inner_court' || el.id === 'court_of_gentiles' ? 8 : 4,
      class: 'arch-node-shape',
    }),
  );
}

export function renderArchitectureSvg(
  planId: ArchitecturePlanId,
  highlightElementId?: string | null,
  opts?: { compact?: boolean; showTerrain?: boolean; onSelectElement?: (el: ArchitectureElement) => void },
): SVGSVGElement {
  const plan = ARCHITECTURE_PLANS[planId];
  const compact = Boolean(opts?.compact);
  const showTerrain = opts?.showTerrain !== false;

  const svg = svgEl('svg', {
    viewBox: plan.viewBox,
    class: compact ? 'arch-svg arch-svg--compact' : 'arch-svg',
    role: 'img',
    'aria-label': `${plan.title} interactive 2D architectural plan`,
  });

  // Self-contained SVG styles using CSS variables with fallbacks
  const styleNode = document.createElementNS(SVG_NS, 'style');
  styleNode.textContent = `
    .arch-svg { width: 100%; height: auto; display: block; overflow: visible; user-select: none; }
    .arch-compass-ring { fill: var(--panel, #162321); stroke: var(--border, #2c3e37); stroke-width: 1.25; }
    .arch-compass-axis { stroke: var(--muted, #a8b6ad); stroke-width: 1; opacity: 0.7; }
    .arch-compass-north { fill: var(--gold, #d7ba7e); }
    .arch-compass-lbl { fill: var(--muted, #a8b6ad); font-size: 9px; font-weight: 700; text-anchor: middle; }
    .arch-axis-guide { stroke: var(--border, #2c3e37); stroke-width: 1; stroke-dasharray: 4 4; }
    .arch-axis-text { fill: var(--muted, #a8b6ad); font-size: 10px; letter-spacing: 0.03em; }
    .arch-terrain-image { pointer-events: none; filter: saturate(0.85) contrast(1.05); }
    .arch-contour-line { fill: none; stroke: color-mix(in srgb, var(--gold, #d7ba7e) 42%, transparent); stroke-width: 1.1; stroke-dasharray: 3 3; pointer-events: none; }
    .arch-contour-line--inner { stroke: color-mix(in srgb, var(--gold, #d7ba7e) 58%, transparent); stroke-dasharray: none; opacity: 0.7; }
    .arch-elev-label { fill: var(--gold-light, #e7d19f); font-size: 9px; font-weight: 600; opacity: 0.85; paint-order: stroke; stroke: var(--panel, #162321); stroke-width: 2.5px; pointer-events: none; }
    .arch-city-wall { fill: color-mix(in srgb, var(--soft, #1f302b) 45%, transparent); stroke: var(--muted, #a8b6ad); stroke-width: 2.2; stroke-linejoin: round; }
    .arch-valley-line { fill: none; stroke: var(--muted, #a8b6ad); stroke-width: 1.4; stroke-dasharray: 4 3; opacity: 0.7; }
    .arch-water-tunnel { fill: none; stroke: var(--green, #9ec7aa); stroke-width: 2; stroke-dasharray: 5 3; }
    .arch-ghost-prop { fill: none; stroke: var(--muted, #a8b6ad); stroke-width: 1; stroke-dasharray: 3 2; opacity: 0.65; }
    .arch-subnote { fill: var(--muted, #a8b6ad); font-size: 9.5px; pointer-events: none; paint-order: stroke; stroke: var(--panel, #162321); stroke-width: 2.5px; }
    .arch-el { cursor: pointer; outline: none; }
    .arch-node-shape { fill: var(--surface-alt, #131e1c); stroke: var(--border, #2c3e37); stroke-width: 1.5; transition: stroke 0.16s ease, fill 0.16s ease; }
    .arch-el--zone .arch-node-shape { fill: color-mix(in srgb, var(--soft, #1f302b) 36%, transparent); stroke-dasharray: 4 3; }
    .arch-gate-shape { fill: color-mix(in srgb, var(--gold, #d7ba7e) 22%, var(--panel, #162321)); stroke: var(--gold, #d7ba7e); stroke-width: 1.8; }
    .arch-gate-split { stroke: var(--gold-light, #e7d19f); stroke-width: 1.2; }
    .arch-pillar { fill: color-mix(in srgb, var(--gold, #d7ba7e) 28%, var(--panel, #162321)); stroke: var(--gold, #d7ba7e); }
    .arch-hit-area { fill: transparent; stroke: none; }
    .arch-detail-dot { fill: var(--gold, #d7ba7e); pointer-events: none; }
    .arch-detail-stroke { stroke: var(--gold, #d7ba7e); stroke-width: 1.4; pointer-events: none; }
    .arch-label {
      fill: var(--text, #ecece4);
      font-size: ${compact ? '12px' : '11px'};
      font-weight: 600;
      paint-order: stroke;
      stroke: var(--panel, #162321);
      stroke-width: 3.5px;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .arch-el--zone .arch-label { fill: var(--muted, #a8b6ad); font-weight: 600; font-size: ${compact ? '11px' : '10.5px'}; }
    .arch-el:hover .arch-node-shape,
    .arch-el:focus-visible .arch-node-shape {
      stroke: var(--gold, #d7ba7e);
      stroke-width: 2.2;
      fill: color-mix(in srgb, var(--gold, #d7ba7e) 16%, var(--panel, #162321));
    }
    @keyframes arch-pulse-ring {
      0%, 100% { filter: drop-shadow(0 0 0px rgba(215, 186, 126, 0.2)); }
      50% { filter: drop-shadow(0 0 6px rgba(215, 186, 126, 0.75)); }
    }
    .arch-el.is-highlighted .arch-node-shape {
      stroke: var(--gold-light, #e7d19f);
      stroke-width: 2.8;
      fill: color-mix(in srgb, var(--gold, #d7ba7e) 28%, var(--panel, #162321));
      animation: arch-pulse-ring 1.9s ease-in-out infinite;
    }
    .arch-el.is-highlighted .arch-label {
      fill: var(--gold-light, #e7d19f);
      font-weight: 700;
    }
  `;
  const defs = svgEl('defs', {});
  defs.append(styleNode);
  if (planId === 'jerusalem_gates') {
    appendJerusalemTerrainDefs(defs);
  }
  svg.append(defs);

  renderPlanBackdrop(svg, planId, showTerrain);

  // Render zone backdrops first so interactive furnishings sit above them in hit order
  const ordered = [...plan.elements].sort((a, b) => {
    const za = VISUAL_META[a.id]?.isZoneBackdrop ? 0 : 1;
    const zb = VISUAL_META[b.id]?.isZoneBackdrop ? 0 : 1;
    return za - zb;
  });

  for (const elem of ordered) {
    const meta = VISUAL_META[elem.id] ?? {
      shortLabel: elem.name,
      labelX: elem.svgBox.x + elem.svgBox.w / 2,
      labelY: elem.svgBox.y + elem.svgBox.h + 14,
    };
    const isHighlighted = Boolean(highlightElementId && highlightElementId === elem.id);
    const classes = [
      'arch-el',
      meta.isZoneBackdrop ? 'arch-el--zone' : '',
      isHighlighted ? 'is-highlighted' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const g = svgEl('g', {
      class: classes,
      'data-element-id': elem.id,
      tabindex: '0',
      role: 'button',
      'aria-label': `${elem.name} (${elem.zone})`,
      'aria-pressed': String(isHighlighted),
    });

    const title = svgEl('title', {}, `${elem.name} — ${elem.zone}`);
    g.append(title);
    renderCustomElementShapes(g, elem);

    const labelText = compact && meta.shortLabel.length > 22
      ? meta.shortLabel.replace(/\s*\([^)]*\)/g, '')
      : meta.shortLabel;

    g.append(
      svgEl(
        'text',
        {
          x: meta.labelX,
          y: meta.labelY,
          'text-anchor': meta.anchor ?? 'middle',
          class: 'arch-label',
        },
        labelText,
      ),
    );

    if (opts?.onSelectElement) {
      const select = opts.onSelectElement;
      g.addEventListener('click', ev => {
        ev.stopPropagation();
        select(elem);
      });
      g.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          select(elem);
        }
      });
    }

    svg.append(g);
  }

  renderCompassBadge(svg);
  return svg;
}
