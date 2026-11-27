// @file: src/ui/context-tools/FeastsOverviewPanel.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: imports | types | data:feasts | logic:detect | ui:helpers | ui:main

// === @section:imports ===
import type { ActivePassage } from '../../api/types';
import type { ContextPreview } from '../components/ContextPreview';
import { action, el, status } from '../study-dom';
import {
  computeFeastDatesForGregorianYear,
  explainHebrewYearCalculation,
  type ComputedFeastDate,
  type HebrewTradition,
  type OmerCountingRule,
} from './hebrew-calendar';

// === @section:types ===
export interface BiblicalFeast {
  id: string;
  name: string;
  hebrew: string;
  transliteration: string;
  greek?: string;
  strongs: string[];
  season: 'spring' | 'fall' | 'winter';
  tier: 'torah_moed' | 'second_temple';
  hebrewDateLabel: string;
  hebrewMonth: number;
  hebrewDay: number;
  durationDays: number;
  torahRule: string;
  laterPractice: string;
  agriculturalTie: string;
  sourceRefs: { label: string; passage: ActivePassage; note: string }[];
}

export interface FeastsOverviewHandle {
  element: HTMLElement;
  focusFeast: (feastId?: string) => void;
}

type CalendarModel = 'hillel_fixed' | 'biblical_observational';
type SeasonFilter = 'all' | 'spring' | 'fall' | 'winter';

// === @section:data:feasts ===
export const BIBLICAL_FEASTS: readonly BiblicalFeast[] = [
  {
    id: 'pesach',
    name: 'Passover',
    hebrew: 'פֶּסַח',
    transliteration: 'Pesach',
    greek: 'πάσχα (Páscha)',
    strongs: ['H6453', 'G3957'],
    season: 'spring',
    tier: 'torah_moed',
    hebrewDateLabel: 'Nisan 14 (twilight / Seder eve of Nisan 15)',
    hebrewMonth: 1,
    hebrewDay: 14,
    durationDays: 1,
    torahRule:
      'Slaughter an unblemished year-old lamb or kid on the 14th day of the first month (Abib/Nisan) "between the evenings" (בֵּין הָעַרְבָּיִם), eat it roasted that night with unleavened bread and bitter herbs, and bring it to the chosen sanctuary once centralized (Exod 12:1–14; Lev 23:5; Num 28:16; Deut 16:1–7).',
    laterPractice:
      'In the Second Temple era, families offered lambs in the Temple courtyard in shifts and held the Passover Seder meal in Jerusalem after sunset (Nisan 15 begins). Post-70 CE rabbinic liturgy preserves the Haggadah, four cups, and afikoman in the absence of the altar.',
    agriculturalTie:
      'Fixed in Chodesh HaAviv ("Month of Young Barley Ears"), aligning the lunar new year with spring lambing and the early barley harvest so the firstfruits sheaf can follow.',
    sourceRefs: [
      { label: 'Exod 12:6', passage: { book: 2, chapter: 12, verse: 6 }, note: 'Nisan 14 twilight slaughter ordinance' },
      { label: 'Lev 23:5', passage: { book: 3, chapter: 23, verse: 5 }, note: 'Appointed time of YHWH on 14th at twilight' },
      { label: 'Num 28:16', passage: { book: 4, chapter: 28, verse: 16 }, note: 'Daily/festival offering sequence' },
      { label: 'Deut 16:1', passage: { book: 5, chapter: 16, verse: 1 }, note: 'Central sanctuary observance in Aviv' },
      { label: 'Luke 22:7', passage: { book: 42, chapter: 22, verse: 7 }, note: 'Last Supper Passover preparation' },
      { label: '1 Cor 5:7', passage: { book: 46, chapter: 5, verse: 7 }, note: 'Christ our Passover lamb' },
    ],
  },
  {
    id: 'unleavened',
    name: 'Feast of Unleavened Bread',
    hebrew: 'חַג הַמַּצּוֹת',
    transliteration: 'Chag HaMatzot',
    greek: 'ἑορτὴ τῶν ἀζύμων (Heortē tōn Azymōn)',
    strongs: ['H4682', 'H2282', 'G106'],
    season: 'spring',
    tier: 'torah_moed',
    hebrewDateLabel: 'Nisan 15–21 (Nisan 15–22 in Diaspora)',
    hebrewMonth: 1,
    hebrewDay: 15,
    durationDays: 7,
    torahRule:
      'Remove all leaven (se’or / chametz) for seven days (Nisan 15–21). Both the first day (Nisan 15) and seventh day (Nisan 21) are sacred assemblies (miqra qodesh) with cessation from regular labor and daily festival musaf offerings (Exod 12:15–20; Lev 23:6–8; Num 28:17–25).',
    laterPractice:
      'Passover and Unleavened Bread became paired as one spring pilgrimage festival in Second Temple usage (Luke 22:1; Josephus). Outside the land of Israel, rabbinic custom observes an eighth day (Nisan 22) and conducts formal chametz search and sale.',
    agriculturalTie:
      'Commemorates the hasty Exodus departure before dough could rise and marks the transition from old-year sourdough starter to the new spring grain cycle.',
    sourceRefs: [
      { label: 'Exod 12:15', passage: { book: 2, chapter: 12, verse: 15 }, note: 'Seven days without leaven' },
      { label: 'Lev 23:6', passage: { book: 3, chapter: 23, verse: 6 }, note: 'Nisan 15 seven-day festival of matzot' },
      { label: 'Num 28:17', passage: { book: 4, chapter: 28, verse: 17 }, note: 'Seven-day bull, ram, and lamb offerings' },
      { label: 'Deut 16:3', passage: { book: 5, chapter: 16, verse: 3 }, note: 'Bread of affliction remembrance' },
      { label: '1 Cor 5:8', passage: { book: 46, chapter: 5, verse: 8 }, note: 'Unleavened bread of sincerity and truth' },
    ],
  },
  {
    id: 'firstfruits',
    name: 'Firstfruits (Wave Sheaf / Omer)',
    hebrew: 'רֵאשִׁית קְצִירְכֶם / עֹמֶר',
    transliteration: 'Reshit Qetzirchem / Yom HaBikkurim (Omer)',
    greek: 'ἀπαρχή (Aparchē)',
    strongs: ['H1061', 'H6016', 'H7225', 'G536'],
    season: 'spring',
    tier: 'torah_moed',
    hebrewDateLabel: 'Nisan 16 (or Sunday of Unleavened Bread)',
    hebrewMonth: 1,
    hebrewDay: 16,
    durationDays: 1,
    torahRule:
      'Bring an omer (sheaf) of the first barley harvest to the priest, who waves it before YHWH "on the day after the Sabbath" (מִמָּחֳרַת הַשַּׁבָּת, Lev 23:11) alongside a burnt offering and grain/drink offering. Neither bread nor parched grain of the new crop may be eaten beforehand.',
    laterPractice:
      'Pharisees/Rabbis interpreted "the Sabbath" in Lev 23:11 as the Nisan 15 festival rest (anchoring the Omer on Nisan 16), whereas Boethusians, Sadducees, and later Karaites read it as the weekly Saturday Sabbath inside Unleavened Bread (anchoring it on Sunday).',
    agriculturalTie:
      'Marks the ceremonial opening of the spring barley harvest in Israel (roughly late March to April), from which seven weeks are counted until the wheat harvest.',
    sourceRefs: [
      { label: 'Lev 23:10', passage: { book: 3, chapter: 23, verse: 10 }, note: 'Sheaf of firstfruits & day after Sabbath' },
      { label: 'Josh 5:10', passage: { book: 6, chapter: 5, verse: 10 }, note: 'Eating produce of Canaan after Passover' },
      { label: '1 Cor 15:20', passage: { book: 46, chapter: 15, verse: 20 }, note: 'Christ risen as firstfruits (aparche)' },
    ],
  },
  {
    id: 'shavuot',
    name: 'Feast of Weeks (Pentecost)',
    hebrew: 'שָׁבֻעֹת',
    transliteration: 'Shavuot',
    greek: 'ἑορτὴ ἑβδομάδων / πεντηκοστή (Pentēkostē)',
    strongs: ['H7620', 'H1061', 'G4005'],
    season: 'spring',
    tier: 'torah_moed',
    hebrewDateLabel: 'Sivan 6 (50th day from Firstfruits anchor)',
    hebrewMonth: 3,
    hebrewDay: 6,
    durationDays: 1,
    torahRule:
      'Count seven complete weeks (49 days) from the wave-sheaf offering and hold a sacred assembly on the 50th day (Lev 23:15–21; Deut 16:9–12). Present two leavened loaves of fine wheat flour as a wave offering of firstfruits.',
    laterPractice:
      'Called Pentēkostē ("fiftieth") in Greek Jewish and NT texts (Tob 2:1; Acts 2:1). Rabbinic tradition identifies Sivan 6 as Zeman Matan Torateinu (Season of the Giving of the Torah at Sinai, cf. Exod 19) and reads the Book of Ruth; Diaspora adds a second day (Sivan 7).',
    agriculturalTie:
      'Celebrates the completion of the grain harvest and the firstfruits of the summer wheat crop (Chag HaKatzir, Exod 23:16), as well as the start of bringing summer orchard bikkurim to Jerusalem.',
    sourceRefs: [
      { label: 'Exod 23:16', passage: { book: 2, chapter: 23, verse: 16 }, note: 'Feast of Harvest (Chag HaKatzir)' },
      { label: 'Exod 34:22', passage: { book: 2, chapter: 34, verse: 22 }, note: 'Feast of Weeks of wheat firstfruits' },
      { label: 'Lev 23:15', passage: { book: 3, chapter: 23, verse: 15 }, note: '50-day Omer count & two leavened loaves' },
      { label: 'Num 28:26', passage: { book: 4, chapter: 28, verse: 26 }, note: 'Day of Firstfruits offerings' },
      { label: 'Deut 16:9', passage: { book: 5, chapter: 16, verse: 9 }, note: 'Seven weeks from sickle to standing grain' },
      { label: 'Acts 2:1', passage: { book: 44, chapter: 2, verse: 1 }, note: 'Outpouring of the Spirit at Pentecost' },
    ],
  },
  {
    id: 'teruah',
    name: 'Day of Acclamation / Trumpets',
    hebrew: 'יוֹם תְּרוּעָה',
    transliteration: 'Yom Teruah (Rosh Hashanah)',
    greek: 'ἡμέρα σαλπίγγων / μνημόσυνον σαλπίγγων',
    strongs: ['H8643', 'H7782', 'G4536'],
    season: 'fall',
    tier: 'torah_moed',
    hebrewDateLabel: 'Tishrei 1 (7th month)',
    hebrewMonth: 7,
    hebrewDay: 1,
    durationDays: 1,
    torahRule:
      'Observe the first day of the seventh month as a solemn rest, a sacred assembly, and a "memorial of acclamation / horn-blast" (זִכְרוֹן תְּרוּעָה, Lev 23:24; יוֹם תְּרוּעָה, Num 29:1) accompanied by dedicated burnt and sin offerings.',
    laterPractice:
      'In Second Temple and Mishnaic Judaism (m. Rosh Hashanah), Tishrei 1 became Rosh Hashanah—the civil new year for sabbatical/jubilee reckoning and the start of the Ten Days of Repentance, observed with shofar blasts for two days in both Israel and the Diaspora.',
    agriculturalTie:
      'Falls at the turn of the agricultural year after late-summer grape, olive, and date harvests, just before the early autumn rains in Canaan.',
    sourceRefs: [
      { label: 'Lev 23:24', passage: { book: 3, chapter: 23, verse: 24 }, note: 'Memorial of acclamation on 7th month day 1' },
      { label: 'Num 29:1', passage: { book: 4, chapter: 29, verse: 1 }, note: 'Yom Teruah offerings' },
      { label: 'Neh 8:2', passage: { book: 16, chapter: 8, verse: 2 }, note: 'Ezra reads the Torah on Tishrei 1' },
      { label: 'Ps 81:3', passage: { book: 19, chapter: 81, verse: 3 }, note: 'Sounding the shofar at new moon / festival' },
    ],
  },
  {
    id: 'yom_kippur',
    name: 'Day of Atonement',
    hebrew: 'יוֹם הַכִּפֻּרִים',
    transliteration: 'Yom HaKippurim (Yom Kippur)',
    greek: 'ἡμέρα ἐξιλασμοῦ (Hēmera Exilasmou)',
    strongs: ['H3725', 'H3722', 'G2434', 'G2435'],
    season: 'fall',
    tier: 'torah_moed',
    hebrewDateLabel: 'Tishrei 10 (evening of Tishrei 9 to evening of 10)',
    hebrewMonth: 7,
    hebrewDay: 10,
    durationDays: 1,
    torahRule:
      'Observe a Sabbath of complete rest (שַׁבַּת שַׁבָּתוֹן) and "afflict your souls" (תְּעַנּוּ אֶת־נַפְשֹׁתֵיכֶם, fasting) from the evening of the 9th to the evening of the 10th (Lev 23:26–32). Only on this day does the high priest enter the Holy of Holies with blood and incense, casting lots over two goats (Lev 16).',
    laterPractice:
      'Known in Hellenistic/NT Greek as "the Fast" (Acts 27:9) and central to Hebrews 9’s typology of the heavenly sanctuary. Post-Temple synagogue liturgy centers on Kol Nidre, five prayer services, Avodah recollection, and Ne’ilah.',
    agriculturalTie:
      'Marks the solemn spiritual reset between the fall ingathering and the rainy winter planting season; every 50th year the Jubilee shofar sounded on this day (Lev 25:9).',
    sourceRefs: [
      { label: 'Lev 16:29', passage: { book: 3, chapter: 16, verse: 29 }, note: 'Annual purgation of sanctuary and people' },
      { label: 'Lev 23:27', passage: { book: 3, chapter: 23, verse: 27 }, note: 'Self-denial & complete rest on Tishrei 10' },
      { label: 'Num 29:7', passage: { book: 4, chapter: 29, verse: 7 }, note: 'Atonement festival sacrifices' },
      { label: 'Heb 9:7', passage: { book: 58, chapter: 9, verse: 7 }, note: 'High priest enters once a year' },
    ],
  },
  {
    id: 'sukkot',
    name: 'Feast of Booths (Tabernacles)',
    hebrew: 'חַג הַסֻּכּוֹת',
    transliteration: 'Chag HaSukkot',
    greek: 'ἑορτὴ σκηνῶν / σκηνοπηγία (Skēnopēgia)',
    strongs: ['H5521', 'H2282', 'G4634'],
    season: 'fall',
    tier: 'torah_moed',
    hebrewDateLabel: 'Tishrei 15–21 (7 days)',
    hebrewMonth: 7,
    hebrewDay: 15,
    durationDays: 7,
    torahRule:
      'Celebrate seven days before YHWH beginning Tishrei 15 with a sacred assembly on day 1, dwelling in temporary booths (sukkot) to remember Israel’s wilderness journey, rejoicing with branches of palm, thick trees, and brook willows (Lev 23:33–43; Num 29:12–34; Deut 16:13–15).',
    laterPractice:
      'Second Temple liturgy added the joyous Water Libation (Simchat Beit HaShoevah) from Siloam and willow processions around the altar (echoed in John 7:37–38). Rabbinic practice waves the Four Species (lulav and etrog) and culminates on Day 7 as Hoshana Rabbah.',
    agriculturalTie:
      'Also called Chag HaAsif ("Feast of Ingathering", Exod 23:16; 34:22) at the "turn of the year", celebrating the completion of orchard, olive, and vintage harvests and praying for winter rain (Zech 14:16–17).',
    sourceRefs: [
      { label: 'Lev 23:34', passage: { book: 3, chapter: 23, verse: 34 }, note: 'Seven-day festival of booths' },
      { label: 'Num 29:12', passage: { book: 4, chapter: 29, verse: 12 }, note: 'Seventy-bull descending offering cycle' },
      { label: 'Deut 16:13', passage: { book: 5, chapter: 16, verse: 13 }, note: 'Ingathering joy from threshing floor & winepress' },
      { label: 'Neh 8:14', passage: { book: 16, chapter: 8, verse: 14 }, note: 'Post-exilic recovery of dwelling in booths' },
      { label: 'John 7:2', passage: { book: 43, chapter: 7, verse: 2 }, note: 'Jesus at the Feast of Booths in Jerusalem' },
    ],
  },
  {
    id: 'shemini_atzeret',
    name: 'Eighth-Day Sacred Assembly',
    hebrew: 'שְׁמִינִי עֲצֶרֶת',
    transliteration: 'Shemini Atzeret',
    greek: 'ἐξόδιον / ἡμέρα ὀγδόη (Hēmera Ogdōē)',
    strongs: ['H6116', 'H8066'],
    season: 'fall',
    tier: 'torah_moed',
    hebrewDateLabel: 'Tishrei 22 (Tishrei 22–23 in Diaspora)',
    hebrewMonth: 7,
    hebrewDay: 22,
    durationDays: 1,
    torahRule:
      'Hold a solemn closing assembly (עֲצֶרֶת, atzeret) with cessation from labor on the eighth day following Sukkot (Lev 23:36; Num 29:35–38), offering a distinct single-bull, single-ram sacrifice rather than the descending Sukkot bull sequence.',
    laterPractice:
      'Treated in rabbinic halakhah as an independent festival (no longer required to dwell in the sukkah) featuring the Prayer for Rain (Tefillat Geshem). In Israel, Simchat Torah (completion and restart of the annual Torah reading cycle) is celebrated on Tishrei 22; in the Diaspora, Simchat Torah is observed on a second day (Tishrei 23).',
    agriculturalTie:
      'Closes the autumn pilgrimage season right as the early yoreh rains are needed to soften the soil for autumn ploughing and winter wheat.',
    sourceRefs: [
      { label: 'Lev 23:36', passage: { book: 3, chapter: 23, verse: 36 }, note: 'Eighth-day sacred assembly (atzeret)' },
      { label: 'Num 29:35', passage: { book: 4, chapter: 29, verse: 35 }, note: 'Distinct eighth-day offerings' },
      { label: '1 Kgs 8:66', passage: { book: 11, chapter: 8, verse: 66 }, note: 'Solomon dismisses Israel on the eighth day' },
      { label: 'John 7:37', passage: { book: 43, chapter: 7, verse: 37 }, note: 'The last, greatest day of the feast' },
    ],
  },
  {
    id: 'purim',
    name: 'Purim',
    hebrew: 'פּוּרִים',
    transliteration: 'Purim',
    greek: 'Φρουραί (Phrourai)',
    strongs: ['H6332', 'H6331'],
    season: 'winter',
    tier: 'second_temple',
    hebrewDateLabel: 'Adar 14 (Adar II 14 in leap years)',
    hebrewMonth: 12,
    hebrewDay: 14,
    durationDays: 1,
    torahRule:
      'Post-exilic observance instituted in Esther 9:17–32 (not part of the Leviticus 23 Torah moedim). Mordecai and Esther established Adar 14 (and Adar 15 for Susa / walled cities) as annual days of feasting, gladness, sending portions of food, and gifts to the poor.',
    laterPractice:
      'Observed with public reading of Megillat Esther (evening and morning), mishloach manot (food gifts), matanot la-evyonim (charity to the poor), and festive meals. In leap years (13 months), Purim is celebrated in Adar II so it stays one month before Nisan/Passover (m. Megillah 1:4).',
    agriculturalTie:
      'Falls at the close of winter in late February or March when late-winter rains finish and almond blossoms signal the approach of spring.',
    sourceRefs: [
      { label: 'Esth 9:26', passage: { book: 17, chapter: 9, verse: 26 }, note: 'Naming of Purim after Haman’s lot (pur)' },
      { label: 'Esth 3:7', passage: { book: 17, chapter: 3, verse: 7 }, note: 'Casting the pur in Nisan for Adar' },
    ],
  },
  {
    id: 'hanukkah',
    name: 'Hanukkah (Feast of Dedication)',
    hebrew: 'חֲנֻכָּה',
    transliteration: 'Chanukkah',
    greek: 'τὰ ἐγκαίνια (Ta Enkainia)',
    strongs: ['H2598', 'G1456'],
    season: 'winter',
    tier: 'second_temple',
    hebrewDateLabel: 'Kislev 25 – Tevet 2/3 (8 days)',
    hebrewMonth: 9,
    hebrewDay: 25,
    durationDays: 8,
    torahRule:
      'Second Temple / intertestamental observance (not among the Leviticus 23 Torah moedim). Instituted in 164 BCE by Judas Maccabeus and the assembly of Israel to commemorate the cleansing and rededication of the Jerusalem Temple altar on Kislev 25 (1 Maccabees 4:52–59; 2 Maccabees 10:1–8).',
    laterPractice:
      'Attested in the New Testament as "the Feast of Dedication (τὰ ἐγκαίνια) in Jerusalem; it was winter" (John 10:22). Josephus calls it the "Festival of Lights" (Ant. 12.325), and rabbinic tradition (b. Shabbat 21b) institutes the nightly eight-branch menorah (chanukkiyah) lighting and full Hallel.',
    agriculturalTie:
      'Occurs in mid-winter (late November to late December) near the winter solstice when olive oil pressing from the autumn harvest is freshly available.',
    sourceRefs: [
      { label: 'John 10:22', passage: { book: 43, chapter: 10, verse: 22 }, note: 'Feast of Dedication (Enkainia) in winter' },
      { label: 'Ezra 6:16', passage: { book: 15, chapter: 6, verse: 16 }, note: 'Earlier Aramaic/Hebrew chanukkah dedication of the Second Temple' },
      { label: 'Num 7:10', passage: { book: 4, chapter: 7, verse: 10 }, note: 'Torah lexical precedent: chanukkat ha-mizbeach (dedication of the altar)' },
    ],
  },
];

// === @section:logic:detect ===
const FEAST_BY_ID: ReadonlyMap<string, BiblicalFeast> = new Map(
  BIBLICAL_FEASTS.map(feast => [feast.id, feast]),
);

function matchesPassageForFeast(feastId: string, p: ActivePassage): boolean {
  const { book, chapter, verse } = p;
  switch (feastId) {
    case 'pesach':
      return (
        (book === 2 && chapter === 12 && verse >= 1 && verse <= 28) ||
        (book === 2 && chapter === 12 && verse >= 43 && verse <= 51) ||
        (book === 3 && chapter === 23 && verse >= 4 && verse <= 5) ||
        (book === 4 && chapter === 9 && verse >= 1 && verse <= 14) ||
        (book === 4 && chapter === 28 && verse === 16) ||
        (book === 5 && chapter === 16 && verse >= 1 && verse <= 7) ||
        (book === 6 && chapter === 5 && verse === 10) ||
        (book === 40 && chapter === 26 && verse >= 17 && verse <= 30) ||
        (book === 41 && chapter === 14 && verse >= 12 && verse <= 26) ||
        (book === 42 && chapter === 22 && verse >= 1 && verse <= 20) ||
        (book === 43 && chapter === 13 && verse === 1) ||
        (book === 43 && chapter === 18 && verse === 28) ||
        (book === 43 && chapter === 19 && verse === 14) ||
        (book === 46 && chapter === 5 && verse === 7)
      );
    case 'unleavened':
      return (
        (book === 2 && chapter === 12 && verse >= 15 && verse <= 20) ||
        (book === 2 && chapter === 13 && verse >= 3 && verse <= 10) ||
        (book === 2 && chapter === 23 && verse === 15) ||
        (book === 2 && chapter === 34 && verse === 18) ||
        (book === 3 && chapter === 23 && verse >= 6 && verse <= 8) ||
        (book === 4 && chapter === 28 && verse >= 17 && verse <= 25) ||
        (book === 5 && chapter === 16 && verse >= 3 && verse <= 8) ||
        (book === 42 && chapter === 22 && verse === 1) ||
        (book === 46 && chapter === 5 && verse >= 7 && verse <= 8)
      );
    case 'firstfruits':
      return (
        (book === 3 && chapter === 23 && verse >= 9 && verse <= 14) ||
        (book === 6 && chapter === 5 && verse >= 10 && verse <= 12) ||
        (book === 46 && chapter === 15 && verse >= 20 && verse <= 23)
      );
    case 'shavuot':
      return (
        (book === 2 && chapter === 23 && verse === 16) ||
        (book === 2 && chapter === 34 && verse === 22) ||
        (book === 3 && chapter === 23 && verse >= 15 && verse <= 22) ||
        (book === 4 && chapter === 28 && verse >= 26 && verse <= 31) ||
        (book === 5 && chapter === 16 && verse >= 9 && verse <= 12) ||
        (book === 44 && chapter === 2 && verse >= 1 && verse <= 13) ||
        (book === 46 && chapter === 16 && verse === 8)
      );
    case 'teruah':
      return (
        (book === 3 && chapter === 23 && verse >= 23 && verse <= 25) ||
        (book === 4 && chapter === 29 && verse >= 1 && verse <= 6) ||
        (book === 16 && chapter === 8 && verse >= 1 && verse <= 12) ||
        (book === 19 && chapter === 81 && verse >= 3 && verse <= 4)
      );
    case 'yom_kippur':
      return (
        (book === 3 && chapter === 16) ||
        (book === 3 && chapter === 23 && verse >= 26 && verse <= 32) ||
        (book === 4 && chapter === 29 && verse >= 7 && verse <= 11) ||
        (book === 44 && chapter === 27 && verse === 9) ||
        (book === 58 && chapter === 9 && verse >= 6 && verse <= 14)
      );
    case 'sukkot':
      return (
        (book === 2 && chapter === 23 && verse === 16) ||
        (book === 2 && chapter === 34 && verse === 22) ||
        (book === 3 && chapter === 23 && verse >= 33 && verse <= 43) ||
        (book === 4 && chapter === 29 && verse >= 12 && verse <= 34) ||
        (book === 5 && chapter === 16 && verse >= 13 && verse <= 17) ||
        (book === 11 && chapter === 8 && verse === 2) ||
        (book === 16 && chapter === 8 && verse >= 13 && verse <= 18) ||
        (book === 38 && chapter === 14 && verse >= 16 && verse <= 19) ||
        (book === 43 && chapter === 7 && verse >= 1 && verse <= 39)
      );
    case 'shemini_atzeret':
      return (
        (book === 3 && chapter === 23 && verse === 36) ||
        (book === 3 && chapter === 23 && verse === 39) ||
        (book === 4 && chapter === 29 && verse >= 35 && verse <= 39) ||
        (book === 11 && chapter === 8 && verse >= 65 && verse <= 66) ||
        (book === 14 && chapter === 7 && verse >= 9 && verse <= 10) ||
        (book === 43 && chapter === 7 && verse >= 37 && verse <= 39)
      );
    case 'purim':
      return (
        (book === 17 && chapter === 3 && verse === 7) ||
        (book === 17 && chapter === 9 && verse >= 17 && verse <= 32)
      );
    case 'hanukkah':
      return (
        (book === 43 && chapter === 10 && verse >= 22 && verse <= 23) ||
        (book === 15 && chapter === 6 && verse === 16) ||
        (book === 4 && chapter === 7 && verse >= 10 && verse <= 11)
      );
    default:
      return false;
  }
}

export function detectFeastsForContext(
  passage: ActivePassage,
  strongsList: string[],
): BiblicalFeast[] {
  const normalizedStrongs = new Set(
    strongsList.map(code => code.trim().toUpperCase()).filter(Boolean),
  );

  const isLev23Overview =
    passage.book === 3 && passage.chapter === 23 && (passage.verse <= 4 || passage.verse === 44);
  const isDeut16Summary =
    passage.book === 5 && passage.chapter === 16 && (passage.verse === 16 || passage.verse === 17);

  const matched: BiblicalFeast[] = [];
  for (const feast of BIBLICAL_FEASTS) {
    const strongsHit = feast.strongs.some(code => normalizedStrongs.has(code.toUpperCase()));
    const passageHit = matchesPassageForFeast(feast.id, passage);
    const pilgrimageOverviewHit =
      (isLev23Overview && feast.tier === 'torah_moed') ||
      (isDeut16Summary &&
        (feast.id === 'unleavened' || feast.id === 'shavuot' || feast.id === 'sukkot'));

    if (strongsHit || passageHit || pilgrimageOverviewHit) {
      matched.push(feast);
    }
  }
  return matched;
}

// === @section:ui:helpers ===
const SEASON_META: Readonly<
  Record<'spring' | 'fall' | 'winter', { label: string; months: string }>
> = {
  spring: { label: 'Spring Feasts', months: 'Nisan – Sivan' },
  fall: { label: 'Fall Feasts', months: 'Tishrei' },
  winter: { label: 'Winter / Late-Winter', months: 'Kislev – Adar' },
};

function badge(text: string, tone: 'torah' | 'second' | 'neutral' | 'warn'): HTMLElement {
  const span = el('span', 'feast-badge', text);
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.padding = '2px 8px';
  span.style.borderRadius = '999px';
  span.style.fontSize = '11px';
  span.style.fontWeight = '600';
  span.style.lineHeight = '1.4';
  span.style.border = '1px solid var(--border)';
  if (tone === 'torah') {
    span.style.background = 'var(--accent, rgba(162, 197, 174, 0.14))';
    span.style.color = 'var(--green)';
    span.style.borderColor = 'var(--green)';
  } else if (tone === 'second') {
    span.style.background = 'rgba(196, 163, 107, 0.14)';
    span.style.color = 'var(--gold-light)';
    span.style.borderColor = 'var(--gold)';
  } else if (tone === 'warn') {
    span.style.background = 'rgba(215, 186, 126, 0.16)';
    span.style.color = 'var(--gold-light)';
    span.style.borderColor = 'var(--gold)';
  } else {
    span.style.background = 'var(--soft, var(--background))';
    span.style.color = 'var(--muted)';
  }
  return span;
}

function toggleButton(
  label: string,
  active: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = action(label, onClick, 'study-button');
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.style.fontSize = '12px';
  btn.style.padding = '5px 10px';
  if (active) {
    btn.style.borderColor = 'var(--gold)';
    btn.style.color = 'var(--gold-light)';
    btn.style.background = 'var(--soft, rgba(196, 163, 107, 0.15))';
    btn.style.fontWeight = '600';
  }
  return btn;
}

function sectionBlock(title: string, body: string): HTMLElement {
  const box = el('div', 'feast-detail-section');
  box.style.padding = '10px 12px';
  box.style.border = '1px solid var(--border)';
  box.style.borderRadius = '6px';
  box.style.background = 'var(--background)';
  const heading = el('h4', '', title);
  heading.style.margin = '0 0 6px';
  heading.style.fontSize = '12px';
  heading.style.textTransform = 'uppercase';
  heading.style.letterSpacing = '0.06em';
  heading.style.color = 'var(--gold)';
  const copy = el('p', '', body);
  copy.style.margin = '0';
  copy.style.fontSize = '13px';
  copy.style.lineHeight = '1.6';
  box.append(heading, copy);
  return box;
}

// === @section:ui:main ===
export function createFeastsOverviewPanel(callbacks: {
  preview: ContextPreview;
  onNavigate: (p: ActivePassage) => void;
  onInspectStrongs?: (strongs: string) => void;
}): FeastsOverviewHandle {
  const currentYear = new Date().getFullYear();
  let selectedYear = currentYear;
  let tradition: HebrewTradition = 'israel';
  let omerRule: OmerCountingRule = 'rabbinic_nisan_16';
  let calendarModel: CalendarModel = 'hillel_fixed';
  let seasonFilter: SeasonFilter = 'all';
  let selectedFeastId: string = BIBLICAL_FEASTS[0].id;

  const element = el('section', 'feasts-overview-panel');
  element.setAttribute('aria-label', 'Biblical Feasts Overview');
  element.style.display = 'grid';
  element.style.gap = '14px';
  element.style.padding = '16px';
  element.style.border = '1px solid var(--border)';
  element.style.borderRadius = '8px';
  element.style.background = 'var(--panel)';
  element.style.color = 'var(--text)';

  const headerRow = el('div', 'feasts-header');
  headerRow.style.display = 'flex';
  headerRow.style.flexWrap = 'wrap';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.alignItems = 'flex-start';
  headerRow.style.gap = '10px';

  const titleWrap = el('div', '');
  const eyebrow = el('p', 'eyebrow', 'APPOINTED TIMES & SECOND TEMPLE CALENDAR');
  eyebrow.style.margin = '0 0 4px';
  const title = el('h3', '', 'Biblical Feasts & Sacred Calendar');
  title.style.margin = '0';
  title.style.fontSize = '18px';
  titleWrap.append(eyebrow, title);

  const controlsHost = el('div', 'feasts-controls');
  const noticeHost = el('div', 'feasts-epistemic-notice');
  const wheelHost = el('div', 'feasts-wheel');
  const detailHost = el('article', 'feasts-detail-card');
  const hillelDetailsHost = el('div', 'feasts-hillel-explainer');

  headerRow.append(titleWrap);
  element.append(headerRow, controlsHost, noticeHost, wheelHost, detailHost, hillelDetailsHost);

  function renderControls() {
    controlsHost.replaceChildren();
    controlsHost.style.display = 'flex';
    controlsHost.style.flexWrap = 'wrap';
    controlsHost.style.gap = '10px 14px';
    controlsHost.style.padding = '10px 12px';
    controlsHost.style.border = '1px solid var(--border)';
    controlsHost.style.borderRadius = '6px';
    controlsHost.style.background = 'var(--background)';
    controlsHost.style.alignItems = 'center';

    // Year stepper
    const yearGroup = el('div', 'feasts-control-group');
    yearGroup.style.display = 'flex';
    yearGroup.style.alignItems = 'center';
    yearGroup.style.gap = '6px';
    const yearLabel = el('span', 'study-muted', 'Civil Year:');
    yearLabel.style.fontSize = '11px';
    const prevBtn = action('←', () => {
      selectedYear -= 1;
      renderAll();
    }, 'study-button');
    prevBtn.setAttribute('aria-label', 'Previous Gregorian year');
    prevBtn.style.padding = '4px 9px';
    const yearReadout = el('strong', '', String(selectedYear));
    yearReadout.style.minWidth = '44px';
    yearReadout.style.textAlign = 'center';
    yearReadout.style.fontSize = '13px';
    const nextBtn = action('→', () => {
      selectedYear += 1;
      renderAll();
    }, 'study-button');
    nextBtn.setAttribute('aria-label', 'Next Gregorian year');
    nextBtn.style.padding = '4px 9px';
    const todayBtn = action('Today', () => {
      selectedYear = new Date().getFullYear();
      renderAll();
    }, 'study-button');
    todayBtn.style.fontSize = '11px';
    todayBtn.style.padding = '4px 8px';
    yearGroup.append(yearLabel, prevBtn, yearReadout, nextBtn, todayBtn);

    // Tradition toggle
    const tradGroup = el('div', 'feasts-control-group');
    tradGroup.style.display = 'flex';
    tradGroup.style.alignItems = 'center';
    tradGroup.style.gap = '4px';
    const tradLabel = el('span', 'study-muted', 'Tradition:');
    tradLabel.style.fontSize = '11px';
    tradGroup.append(
      tradLabel,
      toggleButton('Israel', tradition === 'israel', () => {
        tradition = 'israel';
        renderAll();
      }),
      toggleButton('Diaspora', tradition === 'diaspora', () => {
        tradition = 'diaspora';
        renderAll();
      }),
    );

    // Omer / Firstfruits counting rule
    const omerGroup = el('div', 'feasts-control-group');
    omerGroup.style.display = 'flex';
    omerGroup.style.alignItems = 'center';
    omerGroup.style.gap = '4px';
    const omerLabel = el('span', 'study-muted', 'Firstfruits / Omer:');
    omerLabel.style.fontSize = '11px';
    omerGroup.append(
      omerLabel,
      toggleButton('Nisan 16', omerRule === 'rabbinic_nisan_16', () => {
        omerRule = 'rabbinic_nisan_16';
        renderAll();
      }),
      toggleButton('Sunday of Unleavened Bread', omerRule === 'boethusian_sunday', () => {
        omerRule = 'boethusian_sunday';
        renderAll();
      }),
    );

    // Historical calendar model toggle
    const modelGroup = el('div', 'feasts-control-group');
    modelGroup.style.display = 'flex';
    modelGroup.style.alignItems = 'center';
    modelGroup.style.gap = '4px';
    const modelLabel = el('span', 'study-muted', 'Calendar Model:');
    modelLabel.style.fontSize = '11px';
    modelGroup.append(
      modelLabel,
      toggleButton('Fixed Hillel II Calendar', calendarModel === 'hillel_fixed', () => {
        calendarModel = 'hillel_fixed';
        renderAll();
      }),
      toggleButton('Biblical Observational (New Moon + Abib)', calendarModel === 'biblical_observational', () => {
        calendarModel = 'biblical_observational';
        renderAll();
      }),
    );

    controlsHost.append(yearGroup, tradGroup, omerGroup, modelGroup);
  }

  function renderEpistemicNotice() {
    noticeHost.replaceChildren();
    noticeHost.style.padding = '10px 12px';
    noticeHost.style.borderRadius = '6px';
    noticeHost.style.fontSize = '12px';
    noticeHost.style.lineHeight = '1.55';
    noticeHost.style.border = '1px solid var(--border)';

    if (calendarModel === 'biblical_observational') {
      noticeHost.style.borderColor = 'var(--gold)';
      noticeHost.style.background = 'rgba(196, 163, 107, 0.1)';
      const head = el(
        'strong',
        '',
        'Historical Epistemic Notice — Observational Calendar (Uncertain Historical Reconstruction): ',
      );
      head.style.color = 'var(--gold-light)';
      const body = document.createTextNode(
        'First Temple, Exodus, and Second Temple feast dates depended on eyewitness crescent-moon sighting (rosh chodesh) in Judea and agricultural inspection of ripe barley (aviv) to intercalate a 13th month. Rabbinic postponements (Dechiyot: Lo ADU, Molad Zaken, GaTRaD, BeTuTaKPoT) and the fixed 19-year Metonic table (traditionally attributed to Hillel II, c. 359 CE) cannot be retrojected as certainty onto ancient biblical events; modern Hillel II civil dates are shown below as an astronomical reference only.',
      );
      noticeHost.append(head, body);
    } else {
      noticeHost.style.background = 'var(--background)';
      const head = el('strong', '', 'Fixed Hillel II Arithmetical Reference · Sunset-to-Sunset: ');
      head.style.color = 'var(--green)';
      const body = document.createTextNode(
        'Biblical and Jewish calendar days run from sunset to sunset ("evening and morning", Gen 1:5; Lev 23:32). Each date range marks the evening (civil eve) when the festival begins through the sunset when it concludes.',
      );
      noticeHost.append(head, body);
    }
  }

  function renderWheel(computed: Record<string, ComputedFeastDate>) {
    wheelHost.replaceChildren();
    wheelHost.style.display = 'grid';
    wheelHost.style.gap = '10px';

    // Season filter strip
    const seasonBar = el('div', 'feasts-season-bar');
    seasonBar.style.display = 'flex';
    seasonBar.style.flexWrap = 'wrap';
    seasonBar.style.gap = '6px';
    seasonBar.style.alignItems = 'center';

    const seasonOptions: { id: SeasonFilter; label: string }[] = [
      { id: 'all', label: 'All Seasons (Annual Wheel)' },
      { id: 'spring', label: 'Spring · Nisan–Sivan' },
      { id: 'fall', label: 'Fall · Tishrei' },
      { id: 'winter', label: 'Winter / Adar · Kislev–Adar' },
    ];

    for (const opt of seasonOptions) {
      seasonBar.append(
        toggleButton(opt.label, seasonFilter === opt.id, () => {
          seasonFilter = opt.id;
          renderWheel(computed);
        }),
      );
    }
    wheelHost.append(seasonBar);

    const seasonsToShow: ('spring' | 'fall' | 'winter')[] =
      seasonFilter === 'all' ? ['spring', 'fall', 'winter'] : [seasonFilter];

    const grid = el('div', 'feasts-season-grid');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
    grid.style.gap = '10px';

    for (const season of seasonsToShow) {
      const card = el('div', 'feasts-season-card');
      card.style.border = '1px solid var(--border)';
      card.style.borderRadius = '6px';
      card.style.padding = '10px';
      card.style.background = 'var(--background)';
      card.style.display = 'grid';
      card.style.gap = '8px';
      card.style.alignContent = 'start';

      const sHead = el('div', '');
      sHead.style.display = 'flex';
      sHead.style.justifyContent = 'space-between';
      sHead.style.alignItems = 'baseline';
      sHead.style.borderBottom = '1px solid var(--border)';
      sHead.style.paddingBottom = '6px';
      const sTitle = el('strong', '', SEASON_META[season].label);
      sTitle.style.fontSize = '13px';
      sTitle.style.color = 'var(--gold-light)';
      const sMonths = el('span', 'study-muted', SEASON_META[season].months);
      sMonths.style.fontSize = '11px';
      sHead.append(sTitle, sMonths);
      card.append(sHead);

      const list = el('div', 'feasts-pill-list');
      list.style.display = 'grid';
      list.style.gap = '6px';

      const seasonFeasts = BIBLICAL_FEASTS.filter(f => f.season === season);
      for (const feast of seasonFeasts) {
        const isSelected = feast.id === selectedFeastId;
        const dates = computed[feast.id];
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'study-button feast-pill';
        pill.dataset.feastId = feast.id;
        pill.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        pill.style.textAlign = 'left';
        pill.style.width = '100%';
        pill.style.display = 'grid';
        pill.style.gap = '4px';
        pill.style.padding = '8px 10px';
        if (isSelected) {
          pill.style.borderColor = 'var(--gold)';
          pill.style.background = 'var(--soft, rgba(196, 163, 107, 0.14))';
        }

        const top = el('div', '');
        top.style.display = 'flex';
        top.style.justifyContent = 'space-between';
        top.style.alignItems = 'baseline';
        top.style.gap = '8px';

        const nameEl = el('strong', '', feast.name);
        nameEl.style.fontSize = '13px';
        const hebEl = el('span', '', feast.hebrew);
        hebEl.dir = 'rtl';
        hebEl.lang = 'he';
        hebEl.style.fontSize = '14px';
        hebEl.style.color = 'var(--gold-light)';
        top.append(nameEl, hebEl);

        const metaRow = el('div', '');
        metaRow.style.display = 'flex';
        metaRow.style.flexWrap = 'wrap';
        metaRow.style.gap = '6px';
        metaRow.style.alignItems = 'center';
        metaRow.append(
          badge(
            feast.tier === 'torah_moed' ? 'Torah Moed (Lev 23)' : 'Second Temple',
            feast.tier === 'torah_moed' ? 'torah' : 'second',
          ),
        );

        const dateLine = el(
          'span',
          'study-muted',
          calendarModel === 'biblical_observational'
            ? `${dates.hebrewDateText} · Ref: ${dates.formattedRange} (observational dates vary)`
            : `${dates.hebrewDateText} · ${dates.formattedRange}`,
        );
        dateLine.style.fontSize = '11px';

        pill.append(top, metaRow, dateLine);
        pill.addEventListener('click', () => {
          selectedFeastId = feast.id;
          renderWheel(computed);
          renderDetail(computed);
        });

        list.append(pill);
      }

      card.append(list);
      grid.append(card);
    }

    wheelHost.append(grid);
  }

  function renderDetail(computed: Record<string, ComputedFeastDate>) {
    detailHost.replaceChildren();
    const feast = FEAST_BY_ID.get(selectedFeastId) ?? BIBLICAL_FEASTS[0];
    const dates = computed[feast.id];

    detailHost.style.border = '1px solid var(--border)';
    detailHost.style.borderRadius = '8px';
    detailHost.style.padding = '14px';
    detailHost.style.background = 'var(--surface-alt, var(--panel))';
    detailHost.style.display = 'grid';
    detailHost.style.gap = '12px';

    // Header
    const head = el('div', 'feast-detail-head');
    head.style.display = 'flex';
    head.style.flexWrap = 'wrap';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'flex-start';
    head.style.gap = '10px';
    head.style.borderBottom = '1px solid var(--border)';
    head.style.paddingBottom = '10px';

    const namesWrap = el('div', '');
    namesWrap.style.display = 'grid';
    namesWrap.style.gap = '4px';

    const titleLine = el('div', '');
    titleLine.style.display = 'flex';
    titleLine.style.flexWrap = 'wrap';
    titleLine.style.alignItems = 'baseline';
    titleLine.style.gap = '10px';
    const h3 = el('h3', '', feast.name);
    h3.style.margin = '0';
    h3.style.fontSize = '18px';
    const hebSpan = el('span', '', feast.hebrew);
    hebSpan.dir = 'rtl';
    hebSpan.lang = 'he';
    hebSpan.style.fontSize = '20px';
    hebSpan.style.color = 'var(--gold-light)';
    titleLine.append(h3, hebSpan);

    const subLine = el('p', 'study-muted', '');
    subLine.style.margin = '0';
    subLine.style.fontSize = '12px';
    subLine.append(document.createTextNode(feast.transliteration));
    if (feast.greek) {
      subLine.append(document.createTextNode(' · LXX/NT: '));
      const grk = el('span', '', feast.greek);
      grk.dir = 'ltr';
      grk.lang = 'el';
      subLine.append(grk);
    }

    namesWrap.append(titleLine, subLine);

    const badgesWrap = el('div', '');
    badgesWrap.style.display = 'flex';
    badgesWrap.style.flexWrap = 'wrap';
    badgesWrap.style.gap = '6px';
    badgesWrap.style.alignItems = 'center';
    badgesWrap.append(
      badge(
        feast.tier === 'torah_moed' ? 'Torah Appointed Time (Lev 23 / Num 28–29)' : 'Second Temple / Post-Exilic',
        feast.tier === 'torah_moed' ? 'torah' : 'second',
      ),
      badge(SEASON_META[feast.season].label, 'neutral'),
    );

    head.append(namesWrap, badgesWrap);

    // Date & Strong's strip
    const dateBox = el('div', 'feast-date-box');
    dateBox.style.display = 'grid';
    dateBox.style.gap = '4px';
    dateBox.style.padding = '10px 12px';
    dateBox.style.border = '1px solid var(--border)';
    dateBox.style.borderRadius = '6px';
    dateBox.style.background = 'var(--background)';

    const civilLine = el('div', '');
    civilLine.style.fontSize = '13px';
    const modelTag =
      calendarModel === 'biblical_observational'
        ? `Hillel II Reference (${selectedYear}, AM ${dates.hebrewYear}): `
        : `Computed Civil Window (${selectedYear}, AM ${dates.hebrewYear}): `;
    civilLine.append(
      el('strong', '', modelTag),
      document.createTextNode(`${dates.formattedRange} · Sunset eve to sunset close`),
    );

    const hebrewLine = el(
      'div',
      'study-muted',
      `Hebrew Date: ${dates.hebrewDateText} (${feast.hebrewDateLabel}) · ${dates.yearSummaryNote}`,
    );
    hebrewLine.style.fontSize = '12px';
    dateBox.append(civilLine, hebrewLine);

    if (calendarModel === 'biblical_observational') {
      const obsWarn = status(
        'Observational mode: exact civil date in antiquity depended on visible new-moon crescent and local barley (aviv) inspection; this Hillel II window is an astronomical proxy only.',
      );
      obsWarn.style.margin = '4px 0 0';
      obsWarn.style.fontSize = '11px';
      obsWarn.style.color = 'var(--gold-light)';
      dateBox.append(obsWarn);
    }

    // Strong's badges
    const strongsRow = el('div', 'feast-strongs-row');
    strongsRow.style.display = 'flex';
    strongsRow.style.flexWrap = 'wrap';
    strongsRow.style.alignItems = 'center';
    strongsRow.style.gap = '6px';
    const strongsLabel = el('span', 'study-muted', "Strong's Lexicon:");
    strongsLabel.style.fontSize = '12px';
    strongsRow.append(strongsLabel);

    for (const code of feast.strongs) {
      if (callbacks.onInspectStrongs) {
        const inspect = callbacks.onInspectStrongs;
        const btn = action(code, () => inspect(code), 'study-button');
        btn.style.padding = '3px 8px';
        btn.style.fontSize = '11px';
        btn.style.color = 'var(--gold-light)';
        btn.setAttribute('aria-label', `Inspect Strong's ${code}`);
        strongsRow.append(btn);
      } else {
        strongsRow.append(badge(code, 'neutral'));
      }
    }

    // Content sections
    const sectionsGrid = el('div', 'feast-sections-grid');
    sectionsGrid.style.display = 'grid';
    sectionsGrid.style.gap = '10px';
    sectionsGrid.append(
      sectionBlock('Torah Rule', feast.torahRule),
      sectionBlock('Agricultural & Seasonal Context', feast.agriculturalTie),
      sectionBlock('Later & Second Temple Practice', feast.laterPractice),
    );

    // Key Biblical Passages
    const refsBox = el('div', 'feast-refs-box');
    refsBox.style.display = 'grid';
    refsBox.style.gap = '8px';
    const refsHeading = el('h4', '', 'Key Biblical Passages (hover to preview · click to open)');
    refsHeading.style.margin = '0';
    refsHeading.style.fontSize = '12px';
    refsHeading.style.textTransform = 'uppercase';
    refsHeading.style.letterSpacing = '0.06em';
    refsHeading.style.color = 'var(--gold)';

    const refsList = el('div', 'study-actions');
    refsList.style.display = 'flex';
    refsList.style.flexWrap = 'wrap';
    refsList.style.gap = '8px';

    for (const ref of feast.sourceRefs) {
      const refBtn = action(`${ref.label} — ${ref.note}`, () => {
        callbacks.onNavigate(ref.passage);
      }, 'study-button');
      refBtn.style.fontSize = '12px';
      refBtn.style.padding = '5px 10px';
      callbacks.preview.attach(refBtn, ref.passage, `${feast.name}: ${ref.note}`);
      refsList.append(refBtn);
    }

    refsBox.append(refsHeading, refsList);
    detailHost.append(head, dateBox, strongsRow, sectionsGrid, refsBox);
  }

  function renderHillelDetails() {
    hillelDetailsHost.replaceChildren();
    const springSummary = explainHebrewYearCalculation(selectedYear - 1);
    const fallSummary = explainHebrewYearCalculation(selectedYear);

    const details = el('details', 'feast-hillel-details');
    details.style.border = '1px solid var(--border)';
    details.style.borderRadius = '6px';
    details.style.padding = '10px 12px';
    details.style.background = 'var(--background)';

    const summary = el('summary', '', 'How Hillel II dates & leap years work');
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = '600';
    summary.style.fontSize = '13px';
    summary.style.color = 'var(--gold-light)';

    const body = el('div', '');
    body.style.display = 'grid';
    body.style.gap = '8px';
    body.style.marginTop = '10px';
    body.style.fontSize = '12px';
    body.style.lineHeight = '1.55';

    const springLine = el(
      'p',
      '',
      `Spring ${selectedYear} (AM ${springSummary.hebrewYear}): ${springSummary.yearLengthDays} days · ${springSummary.yearTypeLabel} · Year ${springSummary.metonicCycleYear}/19 in Metonic cycle · ${springSummary.isLeap ? 'Leap year (13 months: Adar I & Adar II)' : 'Common year (12 months)'} · Rosh Hashanah began ${springSummary.roshHashanahDate}.`,
    );
    springLine.style.margin = '0';

    const fallLine = el(
      'p',
      '',
      `Fall ${selectedYear} (AM ${fallSummary.hebrewYear}): ${fallSummary.yearLengthDays} days · ${fallSummary.yearTypeLabel} · Year ${fallSummary.metonicCycleYear}/19 in Metonic cycle · ${fallSummary.isLeap ? 'Leap year (13 months: Adar I & Adar II)' : 'Common year (12 months)'} · Rosh Hashanah begins ${fallSummary.roshHashanahDate}.`,
    );
    fallLine.style.margin = '0';

    const rulesLine = el(
      'p',
      'study-muted',
      'Fixed arithmetic rules: (1) 19-year Metonic cycle adds a 13th month (Adar I) in years 3, 6, 8, 11, 14, 17, 19 ((7·hy + 1) mod 19 < 7). (2) Month lengths vary Cheshvan (29/30) and Kislev (29/30) to yield 353/354/355 (common) or 383/384/385 (leap) days. (3) Four Dechiyot postpone Tishrei 1: Lo ADU (not Sun/Wed/Fri so Yom Kippur avoids Fri/Sun and Hoshana Rabbah avoids Shabbat), Molad Zaken (molad ≥ 18h/noon), GaTRaD (Tue common ≥ 9h 204p), and BeTuTaKPoT (Mon post-leap ≥ 15h 589p).',
    );
    rulesLine.style.margin = '0';

    body.append(springLine, fallLine, rulesLine);
    details.append(summary, body);
    hillelDetailsHost.append(details);
  }

  function renderAll() {
    const computed = computeFeastDatesForGregorianYear(selectedYear, { tradition, omerRule });
    renderControls();
    renderEpistemicNotice();
    renderWheel(computed);
    renderDetail(computed);
    renderHillelDetails();
  }

  function focusFeast(feastId?: string) {
    if (feastId && FEAST_BY_ID.has(feastId)) {
      selectedFeastId = feastId;
      const target = FEAST_BY_ID.get(feastId)!;
      if (seasonFilter !== 'all' && seasonFilter !== target.season) {
        seasonFilter = 'all';
      }
    }
    renderAll();
    const targetButton = wheelHost.querySelector<HTMLButtonElement>(
      `button[data-feast-id="${selectedFeastId}"]`,
    );
    targetButton?.focus();
  }

  renderAll();
  return { element, focusFeast };
}
