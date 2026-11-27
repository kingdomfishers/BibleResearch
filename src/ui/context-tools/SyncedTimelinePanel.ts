// @file: src/ui/context-tools/SyncedTimelinePanel.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: imports | types | data:tracks | data:eras | data:events | logic:scale | logic:focus | styles | ui:main

// === @section:imports ===
import type { ActivePassage } from '../../api/types';
import type { ContextPreview } from '../components/ContextPreview';
import { action, el, status } from '../study-dom';

// === @section:types ===
export type TimelineTrackId = 'covenant' | 'israel_north' | 'judah_south' | 'prophets' | 'world_empires';

export interface SyncedTimelineEvent {
  id: string;
  title: string;
  startYear: number;    // negative = BCE, positive = CE
  endYear: number;
  dateLabel: string;
  era: string;
  track: TimelineTrackId;
  uncertainty: string;
  summary: string;
  refs: { label: string; passage: ActivePassage }[];
  source: string;
}

export interface SyncedTimelineHandle {
  element: HTMLElement;
  focusPassage: (p: ActivePassage) => void;
  focusEra: (eraKey?: string) => void;
}

type ZoomLevel = 'compact' | 'standard' | 'wide';

interface TrackMeta {
  id: TimelineTrackId;
  label: string;
  shortLabel: string;
  accent: string;
}

interface EraMeta {
  key: string;
  eraName: string;
  label: string;
  focusYear: number;
  defaultEventId: string;
}

// === @section:data:tracks ===
export const TIMELINE_TRACKS: readonly TrackMeta[] = [
  { id: 'covenant', label: 'Patriarchs & Covenant', shortLabel: 'Covenant & People', accent: '#d7ba7e' },
  { id: 'israel_north', label: 'Northern Kingdom (Israel)', shortLabel: 'Israel (North)', accent: '#6cb4d9' },
  { id: 'judah_south', label: 'Southern Kingdom (Judah)', shortLabel: 'Judah (South)', accent: '#e09b63' },
  { id: 'prophets', label: 'Prophets & Writings', shortLabel: 'Prophets & Writings', accent: '#8fc79a' },
  { id: 'world_empires', label: 'World & ANE Empires', shortLabel: 'World & ANE', accent: '#b3a1dc' },
];

// === @section:data:eras ===
export const TIMELINE_ERAS: readonly EraMeta[] = [
  {
    key: 'primeval_patriarchs',
    eraName: 'Primeval & Patriarchs',
    label: 'Primeval & Patriarchs',
    focusYear: -2150,
    defaultEventId: 'abraham_call',
  },
  {
    key: 'exodus_conquest',
    eraName: 'Exodus & Conquest',
    label: 'Exodus & Conquest',
    focusYear: -1460,
    defaultEventId: 'moses_exodus',
  },
  {
    key: 'judges_united',
    eraName: 'Judges & United Monarchy',
    label: 'Judges & United Monarchy',
    focusYear: -1200,
    defaultEventId: 'david_king',
  },
  {
    key: 'divided_kingdom',
    eraName: 'Divided Kingdom (Synchronized)',
    label: 'Divided Kingdom (Synchronized)',
    focusYear: -935,
    defaultEventId: 'ahab_jezebel',
  },
  {
    key: 'exile_return',
    eraName: 'Exile & Return',
    label: 'Exile & Return',
    focusYear: -600,
    defaultEventId: 'zerubbabel_second_temple',
  },
  {
    key: 'second_temple_nt',
    eraName: 'Second Temple & NT',
    label: 'Second Temple & NT',
    focusYear: -45,
    defaultEventId: 'jesus_ministry_cross',
  },
];

// === @section:data:events ===
const ref = (label: string, book: number, chapter: number, verse: number): { label: string; passage: ActivePassage } => ({
  label,
  passage: { book, chapter, verse },
});

export const SYNCED_TIMELINE_EVENTS: readonly SyncedTimelineEvent[] = [
  // --- Era 1: Primeval & Patriarchs ---
  {
    id: 'primeval_creation_flood',
    title: 'Primeval Prologue (Gen 1–11)',
    startYear: -2200,
    endYear: -2100,
    dateLabel: 'Pre-Patriarchal Horizon',
    era: 'Primeval & Patriarchs',
    track: 'covenant',
    uncertainty: 'Genesis 1–11 genealogies (MT vs. LXX vs. SP) do not yield a single consensual calendar year; placed here at the horizon preceding Abraham.',
    summary: 'Creation, Eden, the Flood narrative, and the dispersion at Babel establish the universal covenant horizon prior to Abraham’s call.',
    refs: [ref('Gen 1:1', 1, 1, 1), ref('Gen 6:9', 1, 6, 9), ref('Gen 11:1', 1, 11, 1)],
    source: 'Genesis 1–11 (Canonical Sequence)',
  },
  {
    id: 'sumer_ur_iii',
    title: 'Ur III & Early Mesopotamia',
    startYear: -2150,
    endYear: -2004,
    dateLabel: 'c. 2112–2004 BCE',
    era: 'Primeval & Patriarchs',
    track: 'world_empires',
    uncertainty: 'Middle Chronology ANE dating (± ~50 years); illuminates southern Mesopotamian urbanism around Ur of the Chaldeans.',
    summary: 'Neo-Sumerian dynasty centered at Ur (Tell el-Muqayyar), building the Great Ziggurat of Nanna before Abraham’s family departed for Haran.',
    refs: [ref('Gen 11:28', 1, 11, 28), ref('Gen 11:31', 1, 11, 31)],
    source: 'ANE Middle Chronology / Genesis 11',
  },
  {
    id: 'abraham_call',
    title: 'Call of Abraham & Covenant',
    startYear: -2091,
    endYear: -1991,
    dateLabel: 'c. 2091–1991 BCE (or 19th–18th c.)',
    era: 'Primeval & Patriarchs',
    track: 'covenant',
    uncertainty: 'Early-Exodus model (1 Kgs 6:1 + Gal 3:17 / Exod 12:40) places Abraham c. 2091 BCE; Middle Bronze cultural-context models favor c. 1950–1750 BCE.',
    summary: 'Abram journeys from Ur and Haran to Canaan; YHWH establishes the Abrahamic covenant of land, seed, and blessing to all nations.',
    refs: [ref('Gen 12:1', 1, 12, 1), ref('Gen 15:6', 1, 15, 6), ref('Gen 17:7', 1, 17, 7)],
    source: 'Genesis 12–25 / Ussher-Early Exodus Anchor',
  },
  {
    id: 'middle_kingdom_egypt',
    title: 'Middle Kingdom Egypt (11th–13th Dyn.)',
    startYear: -2050,
    endYear: -1650,
    dateLabel: 'c. 2050–1650 BCE',
    era: 'Primeval & Patriarchs',
    track: 'world_empires',
    uncertainty: 'Egyptian Middle Kingdom and Second Intermediate (Hyksos) transitions overlap the patriarchal sojourn window across competing biblical chronologies.',
    summary: 'Period of Semitic migration into the eastern Nile Delta (attested in Beni Hasan tomb paintings and Execration Texts) coinciding with Abraham’s and Joseph’s eras.',
    refs: [ref('Gen 12:10', 1, 12, 10), ref('Gen 46:34', 1, 46, 34)],
    source: 'Egyptian Chronology / Genesis 12 & 46',
  },
  {
    id: 'isaac_rebekah',
    title: 'Isaac & Covenant Promise',
    startYear: -2066,
    endYear: -1886,
    dateLabel: 'c. 2066–1886 BCE',
    era: 'Primeval & Patriarchs',
    track: 'covenant',
    uncertainty: 'Anchored relative to Abraham’s age (Gen 21:5); absolute BCE dates shift ~150–250 years under Middle Bronze patriarchal reconstructions.',
    summary: 'Son of promise born to Abraham and Sarah, bound on Mount Moriah, and dwelling in Gerar and Beersheba as the covenant heir.',
    refs: [ref('Gen 21:3', 1, 21, 3), ref('Gen 22:9', 1, 22, 9), ref('Gen 26:24', 1, 26, 24)],
    source: 'Genesis 21–26',
  },
  {
    id: 'jacob_israel',
    title: 'Jacob (Israel) & Twelve Tribes',
    startYear: -2006,
    endYear: -1859,
    dateLabel: 'c. 2006–1859 BCE',
    era: 'Primeval & Patriarchs',
    track: 'covenant',
    uncertainty: 'Internal biblical lifespan synchronization places Jacob’s descent to Egypt at age 130 (Gen 47:9).',
    summary: 'Jacob receives the Bethel vision, wrestles at Peniel to be renamed Israel, and fathers the twelve tribal ancestors before settling in Goshen.',
    refs: [ref('Gen 28:12', 1, 28, 12), ref('Gen 32:28', 1, 32, 28), ref('Gen 49:1', 1, 49, 1)],
    source: 'Genesis 25–49',
  },
  {
    id: 'job_patriarchal_setting',
    title: 'Job in Uz (Patriarchal Setting)',
    startYear: -1950,
    endYear: -1750,
    dateLabel: 'Patriarchal Social Horizon',
    era: 'Primeval & Patriarchs',
    track: 'prophets',
    uncertainty: 'Literary setting reflects patriarchal-era wealth (livestock, family priest), though composition/editing date is debated from Mosaic to Post-Exilic times.',
    summary: 'Wisdom dialogue exploring innocent suffering and divine sovereignty outside Israelite Levitical institutions.',
    refs: [ref('Job 1:1', 18, 1, 1), ref('Job 19:25', 18, 19, 25), ref('Job 42:10', 18, 42, 10)],
    source: 'Book of Job (Setting Horizon)',
  },
  {
    id: 'joseph_egypt',
    title: 'Joseph Vizier in Egypt',
    startYear: -1898,
    endYear: -1805,
    dateLabel: 'c. 1898–1805 BCE (or Hyksos Era)',
    era: 'Primeval & Patriarchs',
    track: 'covenant',
    uncertainty: 'Placed c. 1885–1805 BCE in 12th-Dynasty (Sesostris II/III) early models, or c. 1700–1600 BCE in Hyksos-era reconstructions.',
    summary: 'Sold into Egypt, Joseph interprets Pharaoh’s dreams, administers famine relief, and preserves Jacob’s household in Goshen.',
    refs: [ref('Gen 37:28', 1, 37, 28), ref('Gen 41:41', 1, 41, 41), ref('Gen 50:20', 1, 50, 20)],
    source: 'Genesis 37–50',
  },
  {
    id: 'hammurabi_babylon',
    title: 'Hammurabi & Old Babylonian Era',
    startYear: -1792,
    endYear: -1750,
    dateLabel: 'c. 1792–1750 BCE',
    era: 'Primeval & Patriarchs',
    track: 'world_empires',
    uncertainty: 'Middle Chronology dates Hammurabi to 1792–1750 BCE (Low Chronology ~64 years later).',
    summary: 'Prominent Old Babylonian ruler whose law stele and Mari/Nuzi archives illuminate ANE adoption, bride-price, and casuistic legal customs.',
    refs: [ref('Gen 14:1', 1, 14, 1), ref('Exod 21:24', 2, 21, 24)],
    source: 'ANE Comparative Law & History',
  },

  // --- Era 2: Exodus & Conquest ---
  {
    id: 'new_kingdom_egypt_18',
    title: '18th Dynasty Egypt (Thutmose III – Amenhotep II)',
    startYear: -1550,
    endYear: -1350,
    dateLabel: 'c. 1550–1350 BCE',
    era: 'Exodus & Conquest',
    track: 'world_empires',
    uncertainty: 'Primary imperial backdrop under the Early (1446 BCE) Exodus chronology based on 1 Kgs 6:1 (480 years before Solomon’s 4th year).',
    summary: 'Egypt’s imperial zenith in Canaan and Syria; Thutmose III and Amenhotep II campaigned repeatedly along the Way of Horus and Megiddo.',
    refs: [ref('Exod 1:8', 2, 1, 8), ref('Exod 5:2', 2, 5, 2)],
    source: 'New Kingdom Egyptian Chronology',
  },
  {
    id: 'moses_exodus',
    title: 'Exodus from Egypt & Sinai Covenant',
    startYear: -1446,
    endYear: -1406,
    dateLabel: 'c. 1446–1406 BCE (or c. 1260 BCE)',
    era: 'Exodus & Conquest',
    track: 'covenant',
    uncertainty: 'Two principal scholarly dates: Early Date (1446 BCE via 1 Kgs 6:1 & Judg 11:26) vs. Late Date (c. 1270–1250 BCE under Ramesses II, Exod 1:11).',
    summary: 'Deliverance through the Sea of Reeds, Decalogue and covenant at Mount Sinai, Tabernacle construction, and forty-year wilderness sojourn.',
    refs: [ref('Exod 12:40', 2, 12, 40), ref('Exod 19:5', 2, 19, 5), ref('1 Kgs 6:1', 11, 6, 1)],
    source: 'Exodus–Deuteronomy / 1 Kings 6:1',
  },
  {
    id: 'torah_revelation',
    title: 'Torah, Tabernacle & Plains of Moab',
    startYear: -1446,
    endYear: -1406,
    dateLabel: 'Sinai to Moab Covenant',
    era: 'Exodus & Conquest',
    track: 'prophets',
    uncertainty: 'Anchored to the Mosaic period internally; source-critical models debate pre-monarchic vs. monarchic redaction stages.',
    summary: 'Giving of the Ten Commandments, Levitical holiness legislation, wilderness census, and Moses’ covenant renewal speeches in Deuteronomy.',
    refs: [ref('Exod 25:8', 2, 25, 8), ref('Lev 16:2', 3, 16, 2), ref('Deut 6:4', 5, 6, 4)],
    source: 'Exodus 20 – Deuteronomy 34',
  },
  {
    id: 'joshua_conquest',
    title: 'Joshua: Jordan Crossing & Canaan Settlement',
    startYear: -1406,
    endYear: -1355,
    dateLabel: 'c. 1406–1355 BCE (or c. 1220 BCE)',
    era: 'Exodus & Conquest',
    track: 'covenant',
    uncertainty: 'Follows directly upon either the 1446 BCE or c. 1260 BCE Exodus horizon; archaeological debates center on Jericho, Ai, and Hazor strata.',
    summary: 'Crossing the Jordan at flood stage, campaigns at Jericho, Ai, Gibeon, and Hazor, and tribal land allotment concluding at Shechem.',
    refs: [ref('Josh 3:14', 6, 3, 14), ref('Josh 6:20', 6, 6, 20), ref('Josh 24:15', 6, 24, 15)],
    source: 'Book of Joshua',
  },
  {
    id: 'amarna_letters',
    title: 'Amarna Letters (Canaanite Vassals)',
    startYear: -1360,
    endYear: -1332,
    dateLabel: 'c. 1360–1332 BCE',
    era: 'Exodus & Conquest',
    track: 'world_empires',
    uncertainty: 'Cuneiform correspondence to Amenhotep III and Akhenaten; scholars debate whether Habiru/Apiru turmoil correlates with early Israelite settlement.',
    summary: 'Akkadian clay tablets from Jerusalem (Abdi-Heba), Shechem (Labayu), and Gezer reporting Habiru incursions in hill-country Canaan.',
    refs: [ref('Josh 10:1', 6, 10, 1), ref('Josh 15:63', 6, 15, 63)],
    source: 'Tell el-Amarna Archive',
  },
  {
    id: 'ramesses_ii_late_exodus',
    title: '19th Dynasty Egypt (Ramesses II)',
    startYear: -1295,
    endYear: -1213,
    dateLabel: '1279–1213 BCE',
    era: 'Exodus & Conquest',
    track: 'world_empires',
    uncertainty: 'Built Pi-Ramesses in the eastern Delta; serves as the primary imperial synchronism in Late-Exodus models (Exod 1:11).',
    summary: 'Long-reigning New Kingdom pharaoh who fought the Hittites at Kadesh (1274 BCE) and fortified Delta store-cities Pithom and Rameses.',
    refs: [ref('Exod 1:11', 2, 1, 11), ref('Exod 14:13', 2, 14, 13)],
    source: 'Egyptian New Kingdom / Late Exodus Model',
  },
  {
    id: 'merneptah_stele',
    title: 'Merneptah Stele ("Israel" in Canaan)',
    startYear: -1213,
    endYear: -1203,
    dateLabel: 'c. 1208 BCE',
    era: 'Exodus & Conquest',
    track: 'world_empires',
    uncertainty: 'Earliest uncontested extrabiblical mention of Israel (with the determinative for a people group rather than a walled city-state).',
    summary: 'Victory stele of Pharaoh Merneptah in Thebes boasting "Israel is laid waste, his seed is not"—proving Israel was established in Canaan by 1208 BCE.',
    refs: [ref('Judg 2:11', 7, 2, 11), ref('Judg 5:2', 7, 5, 2)],
    source: 'Cairo Museum CG 34025 (Merneptah Stele)',
  },

  // --- Era 3: Judges & United Monarchy ---
  {
    id: 'judges_deborah_gideon',
    title: 'Judges: Othniel, Deborah, Gideon & Samson',
    startYear: -1350,
    endYear: -1075,
    dateLabel: 'c. 1350–1075 BCE (Iron I)',
    era: 'Judges & United Monarchy',
    track: 'covenant',
    uncertainty: 'Regional cycles in Judges likely overlapped geographically rather than running purely sequentially across all twelve tribes.',
    summary: 'Charismatic tribal deliverers rescue Israel from Mesopotamian, Canaanite, Midianite, Ammonite, and Philistine oppression during the Iron Age I hill-country settlement.',
    refs: [ref('Judg 4:4', 7, 4, 4), ref('Judg 6:12', 7, 6, 12), ref('Judg 11:26', 7, 11, 26)],
    source: 'Book of Judges',
  },
  {
    id: 'sea_peoples_philistines',
    title: 'Sea Peoples & Philistine Pentapolis',
    startYear: -1180,
    endYear: -1020,
    dateLabel: 'c. 1180–1020 BCE',
    era: 'Judges & United Monarchy',
    track: 'world_empires',
    uncertainty: 'Medinet Habu reliefs of Ramesses III (c. 1177 BCE) anchor Aegean Sea Peoples settlement along the southern Levantine coast.',
    summary: 'Philistines settle Gaza, Ashkelon, Ashdod, Ekron, and Gath, monopolizing ironwork and contesting Israelite control of the Shephelah.',
    refs: [ref('Judg 13:1', 7, 13, 1), ref('1 Sam 4:1', 9, 4, 1), ref('1 Sam 13:19', 9, 13, 19)],
    source: 'Medinet Habu / Iron I Archaeology',
  },
  {
    id: 'ruth_boaz',
    title: 'Ruth & Boaz in Bethlehem',
    startYear: -1120,
    endYear: -1080,
    dateLabel: 'Late Judges Period',
    era: 'Judges & United Monarchy',
    track: 'covenant',
    uncertainty: 'Relative date anchored two generations before King David (Ruth 4:17–22).',
    summary: 'Moabite widow Ruth gleans in Boaz’s Bethlehem fields and becomes the great-grandmother of King David through kinsman-redemption.',
    refs: [ref('Ruth 1:16', 8, 1, 16), ref('Ruth 4:13', 8, 4, 13)],
    source: 'Book of Ruth',
  },
  {
    id: 'samuel_prophet_judge',
    title: 'Samuel: Last Judge & Prophetic Guilds',
    startYear: -1080,
    endYear: -1015,
    dateLabel: 'c. 1080–1015 BCE',
    era: 'Judges & United Monarchy',
    track: 'prophets',
    uncertainty: 'Chronology reconstructed around Shiloh’s destruction, Ark captivity, and Saul’s anointing.',
    summary: 'Raised at Shiloh, Samuel leads spiritual renewal at Mizpah, establishes prophetic bands, and anoints both Saul and David.',
    refs: [ref('1 Sam 3:19', 9, 3, 19), ref('1 Sam 7:12', 9, 7, 12), ref('1 Sam 16:13', 9, 16, 13)],
    source: '1 Samuel 1–25',
  },
  {
    id: 'saul_united_monarchy',
    title: 'King Saul (United Monarchy Begins)',
    startYear: -1050,
    endYear: -1010,
    dateLabel: 'c. 1050–1010 BCE',
    era: 'Judges & United Monarchy',
    track: 'covenant',
    uncertainty: 'Reign length text in 1 Sam 13:1 is textually damaged; Acts 13:21 and Josephus preserve a ~40-year tradition (or shorter ~20–22 yr estimates).',
    summary: 'Benjamite king anointed by Samuel; relieves Jabesh-gilead and wars against Philistia and Amalek before falling on Mount Gilboa.',
    refs: [ref('1 Sam 10:1', 9, 10, 1), ref('1 Sam 13:1', 9, 13, 1), ref('1 Sam 31:4', 9, 31, 4)],
    source: '1 Samuel 9–31 / Acts 13:21',
  },
  {
    id: 'david_king',
    title: 'King David: Jerusalem & Davidic Covenant',
    startYear: -1010,
    endYear: -970,
    dateLabel: 'c. 1010–970 BCE',
    era: 'Judges & United Monarchy',
    track: 'covenant',
    uncertainty: '40-year reign (7.5 yrs in Hebron, 33 yrs in Jerusalem, 2 Sam 5:4–5); Tel Dan Stele (9th c. BCE) attests "House of David".',
    summary: 'Unites all twelve tribes, captures Jerusalem as royal capital, brings the Ark to Zion, and receives the eternal dynastic promise in 2 Sam 7.',
    refs: [ref('2 Sam 5:7', 10, 5, 7), ref('2 Sam 7:12', 10, 7, 12), ref('1 Chr 17:11', 13, 17, 11)],
    source: '2 Samuel / 1 Chronicles / Tel Dan Stele',
  },
  {
    id: 'davidic_psalms',
    title: 'Psalms of David & Temple Liturgical Guilds',
    startYear: -1010,
    endYear: -960,
    dateLabel: 'c. 1010–960 BCE (Core)',
    era: 'Judges & United Monarchy',
    track: 'prophets',
    uncertainty: 'Superscriptions attribute 73 psalms to David, alongside Asaph and Korahite guilds; the final Psalter reached 150 psalms post-exile.',
    summary: 'Royal, penitential, and liturgical poetry anchoring Israelite temple worship and messianic expectation.',
    refs: [ref('Ps 23:1', 19, 23, 1), ref('Ps 51:1', 19, 51, 1), ref('Ps 110:1', 19, 110, 1)],
    source: 'Book of Psalms / 1 Chronicles 25',
  },
  {
    id: 'phoenicia_hiram',
    title: 'Tyre & Phoenician Alliance (Hiram I)',
    startYear: -980,
    endYear: -935,
    dateLabel: 'c. 980–935 BCE',
    era: 'Judges & United Monarchy',
    track: 'world_empires',
    uncertainty: 'Tyrian king list preserved by Menander of Ephesus (cited in Josephus) provides an independent chronological cross-check for Solomon’s Temple.',
    summary: 'Hiram of Tyre supplies Lebanon cedars, master craftsmen, and Red Sea maritime fleets in partnership with David and Solomon.',
    refs: [ref('1 Kgs 5:1', 11, 5, 1), ref('1 Kgs 9:26', 11, 9, 26)],
    source: '1 Kings 5 & 9 / Tyrian Annals',
  },
  {
    id: 'solomon_king_temple',
    title: 'King Solomon & First Temple Built',
    startYear: -970,
    endYear: -931,
    dateLabel: 'c. 970–931 BCE (Temple 966–959)',
    era: 'Judges & United Monarchy',
    track: 'covenant',
    uncertainty: '40-year reign ending c. 931/930 BCE; foundation laid in Solomon’s 4th year (c. 966 BCE), anchoring the entire Divided Monarchy clock.',
    summary: 'Builds and dedicates the First Temple on Mount Moriah, fortifies Hazor, Megiddo, and Gezer, and expands international trade.',
    refs: [ref('1 Kgs 6:1', 11, 6, 1), ref('1 Kgs 8:22', 11, 8, 22), ref('2 Chr 3:1', 14, 3, 1)],
    source: '1 Kings 1–11 / 2 Chronicles 1–9',
  },
  {
    id: 'solomon_wisdom',
    title: 'Proverbs, Ecclesiastes & Song of Songs',
    startYear: -970,
    endYear: -931,
    dateLabel: 'Solomonic Wisdom Era',
    era: 'Judges & United Monarchy',
    track: 'prophets',
    uncertainty: 'Core Solomonic proverbs (Prov 1–24) were later supplemented by Hezekiah’s scribes (Prov 25:1) and wisdom editors.',
    summary: 'Israelite wisdom tradition framing creation order, fear of YHWH, covenant fidelity, and human reflection.',
    refs: [ref('1 Kgs 4:32', 11, 4, 32), ref('Prov 1:1', 20, 1, 1), ref('Eccl 1:1', 21, 1, 1)],
    source: 'Proverbs / Ecclesiastes / Song of Songs',
  },

  // --- Era 4: Divided Kingdom (Synchronized) ---
  {
    id: 'jeroboam_i',
    title: 'Jeroboam I (Northern Secession)',
    startYear: -930,
    endYear: -909,
    dateLabel: '930–909 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'israel_north',
    uncertainty: 'Accession-year vs. non-accession-year reckoning shifts initial Divided Kingdom boundaries by ±1–2 years (Thiele 931/930 vs. Galil 931 BCE).',
    summary: 'Leads the ten northern tribes to secede at Shechem; establishes rival golden-calf sanctuaries at Bethel and Dan to deter pilgrimage to Jerusalem.',
    refs: [ref('1 Kgs 12:20', 11, 12, 20), ref('1 Kgs 12:28', 11, 12, 28)],
    source: '1 Kings 12–14 / Thiele Synchronism',
  },
  {
    id: 'rehoboam_abijah',
    title: 'Rehoboam & Abijah of Judah',
    startYear: -930,
    endYear: -911,
    dateLabel: '930–911 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: 'Rehoboam reigned 17 years (930–913 BCE) followed by Abijah (913–911 BCE) in direct synchronism with Jeroboam I.',
    summary: 'Rejects elders’ counsel at Shechem, forfeiting the northern tribes; fortifies Judahite cities yet faces Shishak’s devastating 5th-year invasion.',
    refs: [ref('1 Kgs 12:1', 11, 12, 1), ref('1 Kgs 14:21', 11, 14, 21), ref('2 Chr 13:1', 14, 13, 1)],
    source: '1 Kings 12–15 / 2 Chronicles 10–13',
  },
  {
    id: 'ahijah_shemaiah',
    title: 'Prophets Ahijah of Shiloh & Shemaiah',
    startYear: -931,
    endYear: -910,
    dateLabel: 'c. 931–910 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'prophets',
    uncertainty: 'Active across the division of the kingdom; exact birth/death years unrecorded.',
    summary: 'Ahijah tears his cloak into twelve pieces foretelling Jeroboam’s rule and later judgment; Shemaiah halts Rehoboam’s civil war and interprets Shishak’s invasion.',
    refs: [ref('1 Kgs 11:29', 11, 11, 29), ref('1 Kgs 12:22', 11, 12, 22), ref('1 Kgs 14:6', 11, 14, 6)],
    source: '1 Kings 11–14 / 2 Chronicles 11–12',
  },
  {
    id: 'shishak_sheshonq',
    title: 'Pharaoh Sheshonq I (Shishak) Invasion',
    startYear: -926,
    endYear: -924,
    dateLabel: 'c. 925 BCE (Rehoboam Yr 5)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'world_empires',
    uncertainty: 'First fixed external ANE synchronism anchoring biblical monarchic chronology to Egyptian 22nd Dynasty records (Karnak Bubastite Portal).',
    summary: 'Libyan-Egyptian Pharaoh Sheshonq I campaigns through Judah and Israel, stripping Solomon’s gold shields and inscribing conquered towns at Karnak.',
    refs: [ref('1 Kgs 14:25', 11, 14, 25), ref('2 Chr 12:2', 14, 12, 2)],
    source: 'Karnak Relief / 1 Kings 14:25',
  },
  {
    id: 'asa_judah',
    title: 'Asa of Judah (Religious Reform)',
    startYear: -910,
    endYear: -869,
    dateLabel: '910–869 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: '41-year reign overlapping Nadab, Baasha, Elah, Zimri, Omri, and early Ahab in Israel.',
    summary: 'Removes high places and idols, defeats Zerah the Cushite, and allies with Ben-hadad of Aram-Damascus against Baasha’s blockade at Ramah.',
    refs: [ref('1 Kgs 15:9', 11, 15, 9), ref('2 Chr 14:2', 14, 14, 2), ref('2 Chr 15:12', 14, 15, 12)],
    source: '1 Kings 15 / 2 Chronicles 14–16',
  },
  {
    id: 'omri_samaria',
    title: 'Omri & Founding of Samaria',
    startYear: -885,
    endYear: -874,
    dateLabel: '885–874 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'israel_north',
    uncertainty: 'Includes brief co-rival contest with Tibni (1 Kgs 16:21–22); Assyrian annals long called Israel "Bit-Humri" (House of Omri).',
    summary: 'Establishes the powerful Omride dynasty, purchases the hill of Samaria for a new northern capital, and subjugates Moab.',
    refs: [ref('1 Kgs 16:23', 11, 16, 23), ref('1 Kgs 16:24', 11, 16, 24)],
    source: '1 Kings 16 / Mesha Stele',
  },
  {
    id: 'ahab_jezebel',
    title: 'Ahab & Jezebel (Baal Crisis & Qarqar)',
    startYear: -874,
    endYear: -853,
    dateLabel: '874–853 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'israel_north',
    uncertainty: 'Ahab’s death at Ramoth-gilead in 853 BCE shortly after the Battle of Qarqar provides a rock-solid anchor for Assyrian-Israelite synchronisms.',
    summary: 'Marries Tyrian princess Jezebel, builds a Baal temple in Samaria, confronts Elijah, fights Aram, and fields 2,000 chariots at Qarqar.',
    refs: [ref('1 Kgs 16:29', 11, 16, 29), ref('1 Kgs 18:17', 11, 18, 17), ref('1 Kgs 22:34', 11, 22, 34)],
    source: '1 Kings 16–22 / Kurkh Monolith',
  },
  {
    id: 'jehoshaphat_judah',
    title: 'Jehoshaphat of Judah',
    startYear: -872,
    endYear: -848,
    dateLabel: '872–848 BCE (Co-regency 872)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: 'Includes ~3-year co-regency with Asa (872–869 BCE); allied by marriage with Ahab’s house, causing later Athaliah crisis.',
    summary: 'Dispatches Torah-teaching Levites across Judah, reforms courts, and joins Ahab at Ramoth-gilead and Jehoram against Moab.',
    refs: [ref('1 Kgs 22:41', 11, 22, 41), ref('2 Chr 17:7', 14, 17, 7), ref('2 Chr 20:1', 14, 20, 1)],
    source: '1 Kings 22 / 2 Chronicles 17–20',
  },
  {
    id: 'elijah_elisha',
    title: 'Prophets Elijah & Elisha',
    startYear: -870,
    endYear: -798,
    dateLabel: 'c. 870–798 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'prophets',
    uncertainty: 'Elijah prophesied under Ahab and Ahaziah; Elisha succeeded him c. 850 BCE and lived until Joash of Israel (c. 798 BCE).',
    summary: 'Miracle-working northern prophets defending YHWH’s exclusive covenant on Mount Carmel, guiding prophetic communities, and directing Jehu’s anointing.',
    refs: [ref('1 Kgs 17:1', 11, 17, 1), ref('1 Kgs 18:36', 11, 18, 36), ref('2 Kgs 2:11', 12, 2, 11)],
    source: '1 Kings 17 – 2 Kings 13',
  },
  {
    id: 'qarqar_mesha_stele',
    title: 'Battle of Qarqar (853) & Mesha Stele',
    startYear: -853,
    endYear: -840,
    dateLabel: '853–c. 840 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'world_empires',
    uncertainty: 'Shalmaneser III’s Kurkh Monolith dates Qarqar to 853 BCE; Mesha Stele (Dibon) records Moab’s revolt after Omri and Ahab.',
    summary: 'Ahab joins an anti-Assyrian Syrian coalition at Qarqar; soon after Ahab’s death, King Mesha of Moab rebels and records his triumph on the Moabite Stone.',
    refs: [ref('2 Kgs 3:4', 12, 3, 4), ref('1 Kgs 20:1', 11, 20, 1)],
    source: 'Kurkh Monolith / Mesha Stele (KAI 181)',
  },
  {
    id: 'jehu_purge',
    title: 'Jehu’s Purge & Dynasty',
    startYear: -841,
    endYear: -814,
    dateLabel: '841–814 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'israel_north',
    uncertainty: '841 BCE is locked by the synchronous deaths of Joram (Israel) and Ahaziah (Judah) plus Jehu’s tribute to Shalmaneser III.',
    summary: 'Anointed by Elisha’s envoy, Jehu eliminates Joram, Ahaziah, and Jezebel, eradicates Baal worship in Samaria, and submits tribute to Assyria.',
    refs: [ref('2 Kgs 9:6', 12, 9, 6), ref('2 Kgs 10:28', 12, 10, 28)],
    source: '2 Kings 9–10 / Assyrian Eponym Canon',
  },
  {
    id: 'athaliah_joash_judah',
    title: 'Athaliah & King Joash of Judah',
    startYear: -841,
    endYear: -796,
    dateLabel: '841–796 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: 'Athaliah seized the throne 841–835 BCE before Priest Jehoiada crowned seven-year-old Joash in the Temple (835–796 BCE).',
    summary: 'Davidic line nearly extinguished by Athaliah, preserved by Jehosheba hiding infant Joash in the Temple for six years before Temple repairs.',
    refs: [ref('2 Kgs 11:1', 12, 11, 1), ref('2 Kgs 12:1', 12, 12, 1), ref('2 Chr 24:4', 14, 24, 4)],
    source: '2 Kings 11–12 / 2 Chronicles 22–24',
  },
  {
    id: 'black_obelisk_shalmaneser',
    title: 'Shalmaneser III Black Obelisk (841 BCE)',
    startYear: -841,
    endYear: -824,
    dateLabel: '841 BCE Tribute',
    era: 'Divided Kingdom (Synchronized)',
    track: 'world_empires',
    uncertainty: 'Exact year (Shalmaneser III regnal year 18 = 841 BCE) establishes a 12-year interval from Qarqar (853 BCE) matching Ahab–Ahaziah–Joram.',
    summary: 'Limestone obelisk from Nimrud depicting "Jehu, son of Omri" bowing before Shalmaneser III with silver, gold, and lead tribute.',
    refs: [ref('2 Kgs 10:32', 12, 10, 32)],
    source: 'British Museum 118885 (Black Obelisk)',
  },
  {
    id: 'joel_obadiah_early',
    title: 'Joel & Obadiah (Early Window)',
    startYear: -835,
    endYear: -800,
    dateLabel: 'c. 835–800 BCE (or Post-Exilic)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'prophets',
    uncertainty: 'Neither Joel nor Obadiah names a reigning king; early placements note Jehoiada’s regency or Edom’s revolt under Jehoram, while others date them 6th–5th c. BCE.',
    summary: 'Joel calls Judah to repentance amid locust plague and foresees the Day of YHWH’s Spirit; Obadiah pronounces judgment on Edom.',
    refs: [ref('Joel 1:1', 29, 1, 1), ref('Joel 2:28', 29, 2, 28), ref('Obad 1:1', 31, 1, 1)],
    source: 'Books of Joel & Obadiah',
  },
  {
    id: 'jeroboam_ii',
    title: 'Jeroboam II (Northern Peak)',
    startYear: -793,
    endYear: -753,
    dateLabel: '793–753 BCE (Co-regency 793)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'israel_north',
    uncertainty: '41-year span includes co-regency with Jehoash (793–782 BCE); Megiddo seal of "Shema, servant of Jeroboam" attests his administration.',
    summary: 'Restores Israel’s borders from Lebo-hamath to the Dead Sea during temporary Assyrian weakness, yet social injustice triggers Amos and Hosea.',
    refs: [ref('2 Kgs 14:23', 12, 14, 23), ref('2 Kgs 14:25', 12, 14, 25)],
    source: '2 Kings 14 / Megiddo Seal',
  },
  {
    id: 'uzziah_azariah',
    title: 'Uzziah (Azariah) of Judah',
    startYear: -792,
    endYear: -740,
    dateLabel: '792–740 BCE (Co-regency 792)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: '52-year span overlaps Amaziah’s captivity and Jotham’s regency during Uzziah’s leprosy; Isaiah’s call occurs in the year Uzziah died (740/739 BCE).',
    summary: 'Fortifies Jerusalem’s Corner and Valley Gates, expands agriculture in the Negev, and builds military engines before being stricken with leprosy.',
    refs: [ref('2 Kgs 15:1', 12, 15, 1), ref('2 Chr 26:6', 14, 26, 6), ref('Isa 6:1', 23, 6, 1)],
    source: '2 Kings 15 / 2 Chronicles 26 / Isaiah 6:1',
  },
  {
    id: 'amos_hosea_jonah',
    title: 'Jonah, Amos & Hosea',
    startYear: -780,
    endYear: -722,
    dateLabel: 'c. 780–722 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'prophets',
    uncertainty: 'Jonah prophesied under Jeroboam II (2 Kgs 14:25); Amos preached c. 760–750 BCE before the great earthquake; Hosea spanned Jeroboam II through Hoshea.',
    summary: 'Amos exposes economic oppression in Samaria and Bethel; Hosea embodies covenant heartbreak; Jonah carries warning to Assyrian Nineveh.',
    refs: [ref('Jonah 1:1', 32, 1, 1), ref('Amos 1:1', 30, 1, 1), ref('Hos 1:1', 28, 1, 1)],
    source: 'Jonah / Amos / Hosea / 2 Kings 14:25',
  },
  {
    id: 'tiglath_pileser_iii',
    title: 'Tiglath-Pileser III (Pul) Campaigns',
    startYear: -745,
    endYear: -727,
    dateLabel: '745–727 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'world_empires',
    uncertainty: 'Assyrian royal annals record tribute from Menahem (738 BCE), Rezin/Pekah defeat (733–732 BCE), and Ahaz (Jehoahaz) of Judah.',
    summary: 'Reorganizes Assyria into a deportation empire; annexes Galilee and Gilead (733–732 BCE) and receives Judahite submission from Ahaz.',
    refs: [ref('2 Kgs 15:19', 12, 15, 19), ref('2 Kgs 15:29', 12, 15, 29), ref('2 Kgs 16:7', 12, 16, 7)],
    source: 'Assyrian Royal Inscriptions / 2 Kings 15–16',
  },
  {
    id: 'pekah_hoshea',
    title: 'Pekah, Syro-Ephraimite War & Hoshea',
    startYear: -752,
    endYear: -722,
    dateLabel: '752–722 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'israel_north',
    uncertainty: 'Pekah’s 20-year claim (2 Kgs 15:27) likely counts from his Gilead rule in 752 BCE while Menahem/Pekahiah ruled Samaria until 740 BCE.',
    summary: 'Pekah allies with Damascus against Judah (734–732 BCE), triggering Assyrian annexation; Hoshea becomes Assyria’s final northern vassal before rebelling.',
    refs: [ref('2 Kgs 15:27', 12, 15, 27), ref('2 Kgs 17:1', 12, 17, 1), ref('Isa 7:1', 23, 7, 1)],
    source: '2 Kings 15–17 / Isaiah 7',
  },
  {
    id: 'jotham_ahaz',
    title: 'Jotham & Ahaz of Judah',
    startYear: -750,
    endYear: -715,
    dateLabel: '750–715 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: 'Jotham served as regent from 750 BCE and sole king 740–735 BCE; Ahaz began co-regency c. 735 BCE and reigned until 715 BCE (or 727 BCE under alternate co-regency models).',
    summary: 'Facing the Syro-Ephraimite threat, Ahaz rejects Isaiah’s Immanuel sign, appeals to Tiglath-Pileser III, and alters the Jerusalem Temple altar.',
    refs: [ref('2 Kgs 15:32', 12, 15, 32), ref('2 Kgs 16:10', 12, 16, 10), ref('Isa 7:14', 23, 7, 14)],
    source: '2 Kings 15–16 / Isaiah 7–8',
  },
  {
    id: 'isaiah_micah',
    title: 'Isaiah of Jerusalem & Micah',
    startYear: -740,
    endYear: -686,
    dateLabel: 'c. 740–686 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'prophets',
    uncertainty: 'Isaiah prophesied across Uzziah, Jotham, Ahaz, and Hezekiah (Isa 1:1); Isa 40–66 addresses the future Babylonian exile & Cyrus horizon.',
    summary: 'Isaiah counsels Judahite kings through the Assyrian crises and foretells Messiah and comfort; Micah indicts Samaria and Jerusalem and names Bethlehem.',
    refs: [ref('Isa 1:1', 23, 1, 1), ref('Isa 6:1', 23, 6, 1), ref('Mic 1:1', 33, 1, 1), ref('Mic 5:2', 33, 5, 2)],
    source: 'Isaiah 1–39 & 40–66 / Micah',
  },
  {
    id: 'fall_of_samaria',
    title: 'Fall of Samaria (722 BCE)',
    startYear: -722,
    endYear: -720,
    dateLabel: '722/720 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'israel_north',
    uncertainty: 'Shalmaneser V besieged Samaria 725–722 BCE; Sargon II claimed final deportation and resettlement in 720 BCE (Babylonian Chronicle vs. Khorsabad Annals).',
    summary: 'After a three-year Assyrian siege, Samaria falls; the Northern Kingdom ends and populations are deported to Assyria and Media.',
    refs: [ref('2 Kgs 17:5', 12, 17, 5), ref('2 Kgs 17:23', 12, 17, 23), ref('2 Kgs 18:9', 12, 18, 9)],
    source: '2 Kings 17 / Babylonian Chronicle',
  },
  {
    id: 'shalmaneser_v_sargon_ii',
    title: 'Shalmaneser V & Sargon II',
    startYear: -727,
    endYear: -705,
    dateLabel: '727–705 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'world_empires',
    uncertainty: 'Sargon II is named in Isa 20:1 (Ashdod campaign 711 BCE) and documented in Khorsabad inscriptions.',
    summary: 'Assyrian monarchs who toppled Samaria, deported 27,290 inhabitants, and resettled foreign peoples into the province of Samerina.',
    refs: [ref('2 Kgs 17:3', 12, 17, 3), ref('Isa 20:1', 23, 20, 1)],
    source: 'Khorsabad Annals / 2 Kings 17 / Isa 20:1',
  },
  {
    id: 'hezekiah_judah',
    title: 'Hezekiah: Reform & Siloam Tunnel',
    startYear: -715,
    endYear: -686,
    dateLabel: '715–686 BCE (Co-regency 729?)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: 'Scholars debate a 729–715 BCE co-regency with Ahaz to reconcile 2 Kgs 18:9–10 (Samaria 722) with 2 Kgs 18:13 (Sennacherib 701 = Year 14).',
    summary: 'Purges idolatry, celebrates unified Passover, cuts Hezekiah’s 533 m Siloam Tunnel, and seeks YHWH alongside Isaiah during Sennacherib’s siege.',
    refs: [ref('2 Kgs 18:1', 12, 18, 1), ref('2 Kgs 20:20', 12, 20, 20), ref('2 Chr 32:30', 14, 32, 30)],
    source: '2 Kings 18–20 / Siloam Inscription',
  },
  {
    id: 'sennacherib_lachish',
    title: 'Sennacherib Invasion & Lachish Reliefs (701 BCE)',
    startYear: -705,
    endYear: -681,
    dateLabel: '701 BCE Campaign (Reign 705–681)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'world_empires',
    uncertainty: 'Taylor Prism boasts of shutting Hezekiah "like a bird in a cage" while omitting any capture of Jerusalem—corroborating 2 Kgs 19.',
    summary: 'Assyrian king destroys Lachish (immortalized on Nineveh palace reliefs) and besieges Jerusalem before sudden retreat and later assassination.',
    refs: [ref('2 Kgs 18:13', 12, 18, 13), ref('2 Kgs 19:35', 12, 19, 35), ref('Isa 36:1', 23, 36, 1)],
    source: 'Taylor Prism / Lachish Reliefs / 2 Kings 18–19',
  },
  {
    id: 'manasseh_josiah',
    title: 'Manasseh & Josiah’s Torah Reform',
    startYear: -697,
    endYear: -609,
    dateLabel: '697–609 BCE (Josiah 640–609)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: 'Manasseh’s 55-year reign (697–642 BCE) includes ~11-year co-regency with Hezekiah; Josiah’s death at Megiddo is dated 609 BCE.',
    summary: 'Following Manasseh’s syncretism and Amon’s brief rule, King Josiah repairs the Temple, recovers the Book of the Law (622 BCE), and reforms worship.',
    refs: [ref('2 Kgs 21:1', 12, 21, 1), ref('2 Kgs 22:8', 12, 22, 8), ref('2 Kgs 23:25', 12, 23, 25)],
    source: '2 Kings 21–23 / 2 Chronicles 33–35',
  },
  {
    id: 'zephaniah_nahum',
    title: 'Zephaniah & Nahum',
    startYear: -635,
    endYear: -612,
    dateLabel: 'c. 635–612 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'prophets',
    uncertainty: 'Zephaniah prophesied under Josiah (Zeph 1:1); Nahum falls between Thebes’ fall (663 BCE, Nah 3:8) and Nineveh’s fall (612 BCE).',
    summary: 'Zephaniah warns Judah of the Day of YHWH before Josiah’s reform; Nahum proclaims Nineveh’s imminent destruction.',
    refs: [ref('Zeph 1:1', 36, 1, 1), ref('Nah 1:1', 34, 1, 1), ref('Nah 3:7', 34, 3, 7)],
    source: 'Books of Zephaniah & Nahum',
  },
  {
    id: 'nineveh_carchemish_nebuchadnezzar',
    title: 'Fall of Nineveh (612), Carchemish (605) & Nebuchadnezzar II',
    startYear: -612,
    endYear: -562,
    dateLabel: '612–562 BCE (Carchemish 605)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'world_empires',
    uncertainty: 'Babylonian Chronicles fix Nineveh’s fall (612), Pharaoh Necho at Megiddo (609), Carchemish (May/June 605), and Jerusalem’s capture in Adar 597 BCE.',
    summary: 'Babylon and Media topple Assyria; Nebuchadnezzar II crushes Egypt at Carchemish (605 BCE) and asserts Neo-Babylonian hegemony over Judah.',
    refs: [ref('2 Kgs 23:29', 12, 23, 29), ref('2 Kgs 24:1', 12, 24, 1), ref('Jer 46:2', 24, 46, 2)],
    source: 'Babylonian Chronicles (BM 21946)',
  },
  {
    id: 'jeremiah_habakkuk',
    title: 'Jeremiah, Lamentations & Habakkuk',
    startYear: -627,
    endYear: -582,
    dateLabel: '627–c. 582 BCE',
    era: 'Divided Kingdom (Synchronized)',
    track: 'prophets',
    uncertainty: 'Jeremiah called in Josiah’s 13th year (627 BCE) and continued past 586 BCE into Egypt; Habakkuk responds to Babylon’s rise c. 605–598 BCE.',
    summary: 'Jeremiah announces the 70-year Babylonian exile and the New Covenant (Jer 31:31); Habakkuk wrestles with Chaldean violence ("the righteous live by faith").',
    refs: [ref('Jer 1:1', 24, 1, 1), ref('Jer 25:11', 24, 25, 11), ref('Jer 31:31', 24, 31, 31), ref('Hab 1:6', 35, 1, 6)],
    source: 'Jeremiah / Lamentations / Habakkuk',
  },
  {
    id: 'jehoiakim_zedekiah_586',
    title: 'Jehoiakim, Jehoiachin, Zedekiah & Fall of Jerusalem (586 BCE)',
    startYear: -609,
    endYear: -586,
    dateLabel: '609–586 BCE (Temple Destroyed 586)',
    era: 'Divided Kingdom (Synchronized)',
    track: 'judah_south',
    uncertainty: 'First deportation 605 BCE (Dan 1), second 597 BCE (Jehoiachin), final destruction in July–August 586 BCE (some scholars calculate 587 BCE depending on Tishri/Nisan year start).',
    summary: 'Final Davidic kings rebel against Babylon despite Jeremiah’s warnings; Nebuchadnezzar breaches Jerusalem’s walls, burns Solomon’s Temple, and exiles Judah.',
    refs: [ref('2 Kgs 24:12', 12, 24, 12), ref('2 Kgs 25:1', 12, 25, 1), ref('2 Chr 36:17', 14, 36, 17)],
    source: '2 Kings 24–25 / Lachish Ostraca',
  },

  // --- Era 5: Exile & Return ---
  {
    id: 'ezekiel_daniel_exile',
    title: 'Ezekiel in Tel-Abib & Daniel in Babylon',
    startYear: -605,
    endYear: -536,
    dateLabel: '605–536 BCE',
    era: 'Exile & Return',
    track: 'prophets',
    uncertainty: 'Daniel taken in 605 BCE (serving into Cyrus’s 3rd year, 536 BCE); Ezekiel deported in 597 BCE and dated visions from Jehoiachin’s captivity through 571 BCE.',
    summary: 'Ezekiel sees the glory departing and returning to the restored Temple; Daniel interprets imperial dreams and prays over Jeremiah’s 70-year prophecy.',
    refs: [ref('Ezek 1:1', 26, 1, 1), ref('Ezek 40:1', 26, 40, 1), ref('Dan 1:1', 27, 1, 1), ref('Dan 9:2', 27, 9, 2)],
    source: 'Books of Ezekiel & Daniel',
  },
  {
    id: 'babylonian_captivity',
    title: 'Babylonian Exile & Synagogue Origins',
    startYear: -597,
    endYear: -538,
    dateLabel: '597–538 BCE',
    era: 'Exile & Return',
    track: 'covenant',
    uncertainty: '70-year period measured either from 605–536 BCE (first deportation to return) or 586–516 BCE (Temple destruction to Second Temple completion).',
    summary: 'Judahite exiles settle along the Chebar Canal and Babylon (attested in Al-Yahudu tablets), preserving Torah, Sabbath, and prayer without the Temple.',
    refs: [ref('Ps 137:1', 19, 137, 1), ref('Jer 29:10', 24, 29, 10), ref('2 Kgs 25:27', 12, 25, 27)],
    source: '2 Kings 25 / Al-Yahudu Tablets',
  },
  {
    id: 'cyrus_decree_538',
    title: 'Cyrus the Great & Decree of Return (538 BCE)',
    startYear: -559,
    endYear: -530,
    dateLabel: '539–538 BCE (Reign 559–530)',
    era: 'Exile & Return',
    track: 'world_empires',
    uncertainty: 'Nabonidus Chronicle fixes Babylon’s fall to October 12, 539 BCE; Cyrus issued his restoration decree in his 1st regnal year (538 BCE).',
    summary: 'Persian conqueror captures Babylon bloodlessly and issues a royal edict (mirrored in the Cyrus Cylinder) permitting exiled peoples to return and rebuild sanctuaries.',
    refs: [ref('2 Chr 36:22', 14, 36, 22), ref('Ezra 1:1', 15, 1, 1), ref('Isa 44:28', 23, 44, 28)],
    source: 'Cyrus Cylinder / Nabonidus Chronicle / Ezra 1',
  },
  {
    id: 'zerubbabel_second_temple',
    title: 'Zerubbabel & Jeshua Rebuild Second Temple',
    startYear: -538,
    endYear: -516,
    dateLabel: '538–516 BCE (Dedicated 516)',
    era: 'Exile & Return',
    track: 'covenant',
    uncertainty: 'Altar rebuilt and foundation laid 537–536 BCE; stalled under local opposition until work resumed in Darius I’s 2nd year (520 BCE) and finished Adar 3, 516 BCE.',
    summary: 'First wave of ~50,000 returnees under Sheshbazzar, Zerubbabel, and High Priest Jeshua restores sacrificial worship and completes the Second Temple.',
    refs: [ref('Ezra 3:10', 15, 3, 10), ref('Ezra 6:15', 15, 6, 15)],
    source: 'Ezra 1–6',
  },
  {
    id: 'haggai_zechariah',
    title: 'Prophets Haggai & Zechariah',
    startYear: -520,
    endYear: -518,
    dateLabel: '520–518 BCE (Darius Yr 2–4)',
    era: 'Exile & Return',
    track: 'prophets',
    uncertainty: 'Dated precisely to month and day in Darius I’s 2nd–4th years (Aug 520 – Dec 518 BCE).',
    summary: 'Rouse the discouraged returnees to finish the Second Temple, promising greater glory for the house and messianic Branch/Priest-King visions.',
    refs: [ref('Hag 1:1', 37, 1, 1), ref('Zech 1:1', 38, 1, 1), ref('Zech 4:6', 38, 4, 6)],
    source: 'Haggai & Zechariah 1–8 / Ezra 5:1',
  },
  {
    id: 'darius_i_xerxes_persia',
    title: 'Darius I & Xerxes I (Ahasuerus) of Persia',
    startYear: -522,
    endYear: -465,
    dateLabel: '522–465 BCE',
    era: 'Exile & Return',
    track: 'world_empires',
    uncertainty: 'Darius I (522–486 BCE) confirmed Cyrus’s Temple decree (Ezra 6); Xerxes I (486–465 BCE) corresponds to Ahasuerus of Esther.',
    summary: 'Achaemenid emperors who organized satrapies from India to Cush, funded the Jerusalem Temple completion, and ruled from Susa and Persepolis.',
    refs: [ref('Ezra 6:1', 15, 6, 1), ref('Esth 1:1', 17, 1, 1)],
    source: 'Behistun Inscription / Persepolis Archives',
  },
  {
    id: 'esther_mordecai',
    title: 'Esther & Mordecai in Susa',
    startYear: -483,
    endYear: -473,
    dateLabel: 'c. 483–473 BCE (Xerxes Yr 3–12)',
    era: 'Exile & Return',
    track: 'covenant',
    uncertainty: 'Anchored to Xerxes I’s 3rd, 7th, and 12th years (483–474 BCE); timing sits neatly between Xerxes’ Greek campaign (480–479 BCE).',
    summary: 'Queen Esther and Mordecai thwart Haman’s decree across 127 Persian provinces, establishing the annual Feast of Purim.',
    refs: [ref('Esth 4:14', 17, 4, 14), ref('Esth 9:20', 17, 9, 20)],
    source: 'Book of Esther',
  },
  {
    id: 'ezra_nehemiah_walls',
    title: 'Ezra’s Mission (458) & Nehemiah’s Walls (445 BCE)',
    startYear: -458,
    endYear: -430,
    dateLabel: '458–430 BCE (Artaxerxes Yr 7 & 20)',
    era: 'Exile & Return',
    track: 'covenant',
    uncertainty: 'Most place Ezra in Artaxerxes I’s 7th year (458 BCE) and Nehemiah in his 20th year (445 BCE); an alternate view places Ezra under Artaxerxes II (398 BCE).',
    summary: 'Ezra leads Torah teaching and covenant renewal at the Water Gate; Nehemiah rebuilds Jerusalem’s walls in 52 days despite Samarian/Ammonite opposition.',
    refs: [ref('Ezra 7:1', 15, 7, 1), ref('Neh 2:17', 16, 2, 17), ref('Neh 8:1', 16, 8, 1)],
    source: 'Ezra 7–10 / Nehemiah 1–13',
  },
  {
    id: 'artaxerxes_malachi',
    title: 'Artaxerxes I & Prophet Malachi',
    startYear: -465,
    endYear: -420,
    dateLabel: '465–c. 420 BCE',
    era: 'Exile & Return',
    track: 'prophets',
    uncertainty: 'Malachi addresses Persian-era governor (pechah) abuses paralleling Nehemiah 13 (c. 440–420 BCE).',
    summary: 'Under Artaxerxes I (attested also in Elephantine Papyri), Malachi rebukes corrupted priesthood and foretells Elijah’s return before the Day of YHWH.',
    refs: [ref('Neh 2:1', 16, 2, 1), ref('Mal 1:1', 39, 1, 1), ref('Mal 4:5', 39, 4, 5)],
    source: 'Malachi / Elephantine Papyri',
  },

  // --- Era 6: Second Temple & NT ---
  {
    id: 'alexander_hellenistic',
    title: 'Alexander the Great & Hellenistic Rule',
    startYear: -332,
    endYear: -167,
    dateLabel: '332–167 BCE',
    era: 'Second Temple & NT',
    track: 'world_empires',
    uncertainty: 'Intertestamental period linking OT Malachi to the NT world; Ptolemaic (Egypt) and Seleucid (Syria) dynasties contested Judea.',
    summary: 'Greek language and culture spread across the Mediterranean; Judea shifts from Ptolemaic to Seleucid governance.',
    refs: [ref('Dan 8:21', 27, 8, 21), ref('Dan 11:3', 27, 11, 3)],
    source: '1 Maccabees / Josephus',
  },
  {
    id: 'lxx_dss_era',
    title: 'Septuagint (LXX) & Qumran Scribal Era',
    startYear: -280,
    endYear: -30,
    dateLabel: 'c. 280–30 BCE',
    era: 'Second Temple & NT',
    track: 'prophets',
    uncertainty: 'Pentateuch translated into Greek in Alexandria c. 280–250 BCE; Qumran community flourished from mid-2nd c. BCE into the 1st c. CE.',
    summary: 'Jewish scribes preserve biblical manuscripts in Hebrew/Aramaic at Qumran and translate the Hebrew Scriptures into Koine Greek (LXX), preparing the NT linguistic world.',
    refs: [ref('Luke 4:17', 42, 4, 17), ref('Acts 8:32', 44, 8, 32)],
    source: 'Letter of Aristeas / Dead Sea Scrolls',
  },
  {
    id: 'maccabean_revolt',
    title: 'Maccabean Revolt & Hanukkah (164 BCE)',
    startYear: -167,
    endYear: -142,
    dateLabel: '167–142 BCE (Rededication 164)',
    era: 'Second Temple & NT',
    track: 'covenant',
    uncertainty: 'Fixed Seleucid-era dates: Antiochus IV desecrated the Temple in Dec 167 BCE; Judas Maccabeus rededicated the altar Kislev 25, 164 BCE.',
    summary: 'Jewish resistance defeats Seleucid persecution, inaugurating the Feast of Dedication (Hanukkah, John 10:22) and the Hasmonean commonwealth.',
    refs: [ref('Dan 11:31', 27, 11, 31), ref('John 10:22', 43, 10, 22)],
    source: '1–2 Maccabees / John 10:22',
  },
  {
    id: 'herod_augustus_birth',
    title: 'Herod the Great & Caesar Augustus',
    startYear: -37,
    endYear: 14,
    dateLabel: '37 BCE – 14 CE (Herod d. 4 BCE)',
    era: 'Second Temple & NT',
    track: 'world_empires',
    uncertainty: 'Herod began expanding the Second Temple c. 20 BCE and died in 4 BCE (lunar eclipse before Passover); Augustus ruled 27 BCE–14 CE.',
    summary: 'Roman client king Herod monumentalizes Jerusalem’s Temple platform and Caesarea Maritima while Augustus initiates Pax Romana censuses.',
    refs: [ref('Matt 2:1', 40, 2, 1), ref('Luke 2:1', 42, 2, 1), ref('John 2:20', 43, 2, 20)],
    source: 'Josephus / Roman Imperial Fasti',
  },
  {
    id: 'jesus_birth_early',
    title: 'Birth of Jesus in Bethlehem',
    startYear: -6,
    endYear: -4,
    dateLabel: 'c. 6–4 BCE',
    era: 'Second Temple & NT',
    track: 'covenant',
    uncertainty: 'Must precede Herod the Great’s death (4 BCE, Matt 2:1–19); Luke 2:2 Quirinius enrollment syntax ("prior to" or earlier census) remains actively discussed.',
    summary: 'Jesus is born in Bethlehem under Augustus while Herod rules Judea, visited by shepherds and Magi before the flight to Egypt and return to Nazareth.',
    refs: [ref('Matt 2:1', 40, 2, 1), ref('Luke 2:4', 42, 2, 4), ref('Mic 5:2', 33, 5, 2)],
    source: 'Matthew 1–2 / Luke 1–2',
  },
  {
    id: 'tiberius_pilate',
    title: 'Tiberius Caesar & Pontius Pilate',
    startYear: 14,
    endYear: 37,
    dateLabel: '14–37 CE (Pilate 26–36 CE)',
    era: 'Second Temple & NT',
    track: 'world_empires',
    uncertainty: 'Tiberius’s 15th year (Luke 3:1) falls in 28/29 CE (or 26/27 CE counting coregency from 11/12 CE); Pilate inscription at Caesarea confirms his title Prefect.',
    summary: 'Roman imperial and Judean provincial administration during the ministries of John the Baptist and Jesus.',
    refs: [ref('Luke 3:1', 42, 3, 1), ref('John 19:12', 43, 19, 12)],
    source: 'Pilate Stone (Caesarea) / Tacitus / Luke 3:1',
  },
  {
    id: 'john_baptist',
    title: 'John the Baptist (Wilderness Herald)',
    startYear: 26,
    endYear: 29,
    dateLabel: 'c. 26–29 CE',
    era: 'Second Temple & NT',
    track: 'prophets',
    uncertainty: 'Ministry began in Tiberius’s 15th year (Luke 3:1); imprisoned and executed by Herod Antipas at Machaerus prior to Jesus’ Passion.',
    summary: 'Proclaims repentance and baptism at the Jordan River in fulfillment of Isaiah 40:3 and Malachi, identifying Jesus as the Lamb of God.',
    refs: [ref('Matt 3:1', 40, 3, 1), ref('Luke 3:2', 42, 3, 2), ref('John 1:29', 43, 1, 29)],
    source: 'Four Gospels / Josephus Ant. 18.116–119',
  },
  {
    id: 'jesus_ministry_cross',
    title: 'Ministry, Crucifixion & Resurrection of Jesus',
    startYear: 27,
    endYear: 33,
    dateLabel: 'c. 27–30 or 29–33 CE (AD 30 / AD 33)',
    era: 'Second Temple & NT',
    track: 'covenant',
    uncertainty: 'Two leading chronological scenarios fit the astronomical Friday Passover constraints under Pilate: April 7, 30 CE (with 27–30 CE ministry) or April 3, 33 CE (with 29–33 CE ministry).',
    summary: 'Galilean and Judean ministry, Passion Week in Jerusalem, crucifixion outside the city under Pontius Pilate, and Easter resurrection appearances.',
    refs: [ref('Mark 1:14', 41, 1, 14), ref('Matt 27:50', 40, 27, 50), ref('Luke 24:6', 42, 24, 6), ref('1 Cor 15:3', 46, 15, 3)],
    source: 'Four Gospels / 1 Corinthians 15',
  },
  {
    id: 'pentecost_paul_journeys',
    title: 'Pentecost, Jerusalem Council & Paul’s Journeys',
    startYear: 30,
    endYear: 62,
    dateLabel: '30/33–62 CE (Corinth 50–52 CE)',
    era: 'Second Temple & NT',
    track: 'covenant',
    uncertainty: 'Acts chronology is anchored tightly by Herod Agrippa I’s death (44 CE, Acts 12), Claudius’s edict (49 CE), and Gallio’s proconsulship at Corinth (51–52 CE).',
    summary: 'Outpouring of the Spirit at Shavuot, Gentile inclusion at the Jerusalem Council (c. 49 CE), and Paul’s three missionary journeys culminating in Rome.',
    refs: [ref('Acts 2:1', 44, 2, 1), ref('Acts 15:1', 44, 15, 1), ref('Acts 18:12', 44, 18, 12), ref('Acts 28:30', 44, 28, 30)],
    source: 'Book of Acts / Pauline Chronology',
  },
  {
    id: 'claudius_gallio_nero',
    title: 'Claudius, Gallio Inscription, Nero & Fall of Jerusalem (70 CE)',
    startYear: 41,
    endYear: 70,
    dateLabel: '41–70 CE (Gallio 51–52 · Temple Fall 70)',
    era: 'Second Temple & NT',
    track: 'world_empires',
    uncertainty: 'Delphi Gallio Inscription pins Paul’s 18-month stay in Corinth to 51–52 CE; Roman siege under Titus destroys the Second Temple in August 70 CE.',
    summary: 'Claudius expels Jews from Rome (Acts 18:2), Gallio presides at Corinth (Acts 18:12), Nero persecutes Roman Christians (64 CE), and Titus razes Jerusalem (70 CE).',
    refs: [ref('Acts 11:28', 44, 11, 28), ref('Acts 18:2', 44, 18, 2), ref('Acts 18:12', 44, 18, 12), ref('Matt 24:2', 40, 24, 2)],
    source: 'Delphi Gallio Inscription / Josephus War / Tacitus',
  },
  {
    id: 'nt_writings_epistles',
    title: 'New Testament Epistles, Gospels & Revelation',
    startYear: 48,
    endYear: 95,
    dateLabel: 'c. 48–95 CE',
    era: 'Second Temple & NT',
    track: 'prophets',
    uncertainty: 'Early Pauline letters (Galatians/1 Thess c. 48–51 CE) and prison/pastoral letters precede or accompany the four Gospels and Patmos Apocalypse (c. 95 CE or pre-70 debate).',
    summary: 'Apostolic letters, Gospel narratives, Hebrews, and Revelation preserve eyewitness testimony and theological synthesis across the first-century Mediterranean.',
    refs: [ref('Gal 1:1', 48, 1, 1), ref('Rom 1:16', 45, 1, 16), ref('Heb 1:1', 58, 1, 1), ref('Rev 1:9', 66, 1, 9)],
    source: 'NT Epistles, Gospels & Revelation',
  },
];

// === @section:logic:scale ===
const SCALE_ANCHORS: readonly [number, number][] = [
  [-2200, 0],
  [-1800, 340],
  [-1450, 580],
  [-1200, 830],
  [-1050, 1040],
  [-935, 1260],
  [-720, 1820],
  [-586, 2240],
  [-400, 2740],
  [-10, 3100],
  [105, 3660],
];

const ZOOM_MULTIPLIER: Record<ZoomLevel, number> = {
  compact: 0.65,
  standard: 1.0,
  wide: 1.6,
};

const RULER_TICKS: readonly { year: number; label: string }[] = [
  { year: -2100, label: '2100 BCE' },
  { year: -1800, label: '1800 BCE' },
  { year: -1446, label: '1446 BCE' },
  { year: -1208, label: '1208 BCE' },
  { year: -1010, label: '1010 BCE' },
  { year: -930, label: '930 BCE' },
  { year: -853, label: '853 BCE' },
  { year: -722, label: '722 BCE' },
  { year: -586, label: '586 BCE' },
  { year: -538, label: '538 BCE' },
  { year: -445, label: '445 BCE' },
  { year: -164, label: '164 BCE' },
  { year: -4, label: '4 BCE' },
  { year: 30, label: '30/33 CE' },
  { year: 70, label: '70 CE' },
];

const CANVAS_LEFT_PAD = 24;
const CANVAS_RIGHT_PAD = 120;
const MIN_BAR_PX = 104;

function yearToBasePx(year: number): number {
  const first = SCALE_ANCHORS[0]!;
  if (year <= first[0]) return first[1];
  for (let i = 1; i < SCALE_ANCHORS.length; i += 1) {
    const [y0, x0] = SCALE_ANCHORS[i - 1]!;
    const [y1, x1] = SCALE_ANCHORS[i]!;
    if (year <= y1) {
      const t = (year - y0) / (y1 - y0);
      return x0 + t * (x1 - x0);
    }
  }
  const last = SCALE_ANCHORS[SCALE_ANCHORS.length - 1]!;
  return last[1] + (year - last[0]) * 4.5;
}

function yearToPx(year: number, zoom: ZoomLevel): number {
  return CANVAS_LEFT_PAD + Math.round(yearToBasePx(year) * ZOOM_MULTIPLIER[zoom]);
}

function getCanvasTotalWidth(zoom: ZoomLevel): number {
  return yearToPx(105, zoom) + CANVAS_RIGHT_PAD;
}

interface PlacedBar {
  event: SyncedTimelineEvent;
  x: number;
  width: number;
  subRow: number;
}

function packTrackEvents(events: SyncedTimelineEvent[], zoom: ZoomLevel): { bars: PlacedBar[]; rowCount: number } {
  const sorted = [...events].sort((a, b) => (a.startYear - b.startYear) || (a.endYear - b.endYear));
  const rowEnds: number[] = [];
  const bars: PlacedBar[] = [];

  for (const event of sorted) {
    const x = yearToPx(event.startYear, zoom);
    const xEnd = yearToPx(event.endYear, zoom);
    const width = Math.max(MIN_BAR_PX, xEnd - x);
    let placedRow = -1;
    for (let r = 0; r < rowEnds.length; r += 1) {
      if (rowEnds[r]! + 10 <= x) {
        placedRow = r;
        rowEnds[r] = x + width;
        break;
      }
    }
    if (placedRow === -1) {
      placedRow = rowEnds.length;
      rowEnds.push(x + width);
    }
    bars.push({ event, x, width, subRow: placedRow });
  }

  return { bars, rowCount: Math.max(1, rowEnds.length) };
}

function findOverlappingEvents(selected: SyncedTimelineEvent): SyncedTimelineEvent[] {
  const trackOrder = new Map<TimelineTrackId, number>(TIMELINE_TRACKS.map((t, i) => [t.id, i]));
  return SYNCED_TIMELINE_EVENTS
    .filter(other =>
      other.id !== selected.id &&
      other.track !== selected.track &&
      other.startYear <= selected.endYear &&
      selected.startYear <= other.endYear,
    )
    .sort((a, b) => {
      const ta = trackOrder.get(a.track) ?? 99;
      const tb = trackOrder.get(b.track) ?? 99;
      if (ta !== tb) return ta - tb;
      return a.startYear - b.startYear;
    });
}

// === @section:logic:focus ===
function matchPassageToEvent(p: ActivePassage): SyncedTimelineEvent {
  // 1. Direct scripture reference match (exact verse, then chapter, then book)
  let bestScore = -1;
  let bestEvent: SyncedTimelineEvent | null = null;
  for (const ev of SYNCED_TIMELINE_EVENTS) {
    for (const r of ev.refs) {
      let score = 0;
      if (r.passage.book === p.book) {
        score = 10;
        if (r.passage.chapter === p.chapter) {
          score = r.passage.verse === p.verse ? 100 : 40;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestEvent = ev;
      }
    }
  }
  if (bestEvent && bestScore >= 40) return bestEvent;

  // 2. Book-and-chapter chronological fallback covering all 66 canonical books
  const byId = (id: string) => SYNCED_TIMELINE_EVENTS.find(e => e.id === id);
  const { book, chapter } = p;
  let targetId = 'david_king';

  if (book === 1) {
    if (chapter <= 11) targetId = 'primeval_creation_flood';
    else if (chapter <= 24) targetId = 'abraham_call';
    else if (chapter <= 27) targetId = 'isaac_rebekah';
    else if (chapter <= 36) targetId = 'jacob_israel';
    else targetId = 'joseph_egypt';
  } else if (book >= 2 && book <= 5) {
    targetId = book === 3 || book === 5 ? 'torah_revelation' : 'moses_exodus';
  } else if (book === 6) {
    targetId = 'joshua_conquest';
  } else if (book === 7) {
    targetId = 'judges_deborah_gideon';
  } else if (book === 8) {
    targetId = 'ruth_boaz';
  } else if (book === 9) {
    targetId = chapter <= 8 ? 'samuel_prophet_judge' : 'saul_united_monarchy';
  } else if (book === 10 || book === 13) {
    targetId = 'david_king';
  } else if (book === 11) {
    if (chapter <= 11) targetId = 'solomon_king_temple';
    else if (chapter <= 14) targetId = 'jeroboam_i';
    else if (chapter <= 16) targetId = 'omri_samaria';
    else targetId = 'ahab_jezebel';
  } else if (book === 12) {
    if (chapter <= 8) targetId = 'elijah_elisha';
    else if (chapter <= 13) targetId = 'jehu_purge';
    else if (chapter <= 16) targetId = 'jeroboam_ii';
    else if (chapter === 17) targetId = 'fall_of_samaria';
    else if (chapter <= 20) targetId = 'hezekiah_judah';
    else if (chapter <= 23) targetId = 'manasseh_josiah';
    else targetId = 'jehoiakim_zedekiah_586';
  } else if (book === 14) {
    if (chapter <= 9) targetId = 'solomon_king_temple';
    else if (chapter <= 13) targetId = 'rehoboam_abijah';
    else if (chapter <= 20) targetId = 'jehoshaphat_judah';
    else if (chapter <= 25) targetId = 'athaliah_joash_judah';
    else if (chapter <= 28) targetId = 'uzziah_azariah';
    else if (chapter <= 32) targetId = 'hezekiah_judah';
    else if (chapter <= 35) targetId = 'manasseh_josiah';
    else targetId = 'jehoiakim_zedekiah_586';
  } else if (book === 15) {
    targetId = chapter <= 6 ? 'zerubbabel_second_temple' : 'ezra_nehemiah_walls';
  } else if (book === 16) {
    targetId = 'ezra_nehemiah_walls';
  } else if (book === 17) {
    targetId = 'esther_mordecai';
  } else if (book === 18) {
    targetId = 'job_patriarchal_setting';
  } else if (book === 19) {
    targetId = chapter === 137 ? 'babylonian_captivity' : 'davidic_psalms';
  } else if (book >= 20 && book <= 22) {
    targetId = 'solomon_wisdom';
  } else if (book === 23) {
    targetId = chapter >= 40 ? 'cyrus_decree_538' : 'isaiah_micah';
  } else if (book === 24 || book === 25) {
    targetId = 'jeremiah_habakkuk';
  } else if (book === 26 || book === 27) {
    targetId = 'ezekiel_daniel_exile';
  } else if (book === 28 || book === 30 || book === 32) {
    targetId = 'amos_hosea_jonah';
  } else if (book === 29 || book === 31) {
    targetId = 'joel_obadiah_early';
  } else if (book === 33) {
    targetId = 'isaiah_micah';
  } else if (book === 34 || book === 36) {
    targetId = 'zephaniah_nahum';
  } else if (book === 35) {
    targetId = 'jeremiah_habakkuk';
  } else if (book === 37 || book === 38) {
    targetId = 'haggai_zechariah';
  } else if (book === 39) {
    targetId = 'artaxerxes_malachi';
  } else if (book >= 40 && book <= 43) {
    targetId = (book === 40 || book === 42) && chapter <= 2 ? 'jesus_birth_early' : 'jesus_ministry_cross';
  } else if (book === 44) {
    targetId = 'pentecost_paul_journeys';
  } else if (book >= 45) {
    targetId = 'nt_writings_epistles';
  }

  return byId(targetId) ?? bestEvent ?? SYNCED_TIMELINE_EVENTS[0]!;
}

// === @section:styles ===
const STYLE_ID = 'synced-timeline-panel-styles';

function ensureSyncedTimelineStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.st-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  color: var(--text);
  min-width: 0;
}
.st-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px 14px;
}
.st-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.st-title {
  margin: 0;
  font: 600 18px/1.25 Georgia, serif;
}
.st-subtitle {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted);
}
.st-count-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--gold);
  background: color-mix(in srgb, var(--gold) 12%, var(--background));
  color: var(--gold-light);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.st-era-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.st-era-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background);
  color: var(--text);
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}
.st-era-chip:hover,
.st-era-chip:focus-visible {
  border-color: var(--gold);
  background: var(--soft);
}
.st-era-chip.is-active {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 18%, var(--panel));
  color: var(--gold-light);
  font-weight: 600;
}
.st-controls-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
}
.st-search-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 220px;
  min-width: 180px;
}
.st-search-input {
  width: 100%;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
}
.st-search-input:focus {
  outline: none;
  border-color: var(--gold);
}
.st-zoom-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.st-zoom-btn {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--muted);
  padding: 5px 9px;
  font-size: 11.5px;
  cursor: pointer;
}
.st-zoom-btn:hover,
.st-zoom-btn:focus-visible {
  border-color: var(--gold);
  color: var(--text);
}
.st-zoom-btn.is-active {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 18%, var(--panel));
  color: var(--gold-light);
  font-weight: 600;
}
.st-track-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
}
.st-track-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background);
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
}
.st-track-toggle input {
  margin: 0;
  accent-color: var(--gold);
  cursor: pointer;
}
.st-track-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
.st-viewport {
  position: relative;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
}
.st-canvas {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 220px;
}
.st-ruler-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  position: sticky;
  top: 0;
  z-index: 5;
}
.st-corner-cell {
  position: sticky;
  left: 0;
  z-index: 6;
  flex: 0 0 168px;
  width: 168px;
  padding: 7px 10px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--gold);
  display: flex;
  align-items: center;
}
.st-ruler-track {
  position: relative;
  flex: 1 0 auto;
  height: 30px;
}
.st-ruler-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
  padding-left: 5px;
  display: flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  pointer-events: none;
}
.st-lanes-body {
  position: relative;
  display: flex;
  flex-direction: column;
}
.st-sync-band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--gold) 11%, transparent);
  border-left: 1.5px dashed color-mix(in srgb, var(--gold) 65%, transparent);
  border-right: 1.5px dashed color-mix(in srgb, var(--gold) 65%, transparent);
  pointer-events: none;
  z-index: 1;
}
.st-gridline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--border) 55%, transparent);
  pointer-events: none;
  z-index: 0;
}
.st-track-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  position: relative;
}
.st-track-row:last-child {
  border-bottom: none;
}
.st-track-label {
  position: sticky;
  left: 0;
  z-index: 4;
  flex: 0 0 168px;
  width: 168px;
  padding: 10px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.st-track-label-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  display: flex;
  align-items: center;
  gap: 6px;
}
.st-track-label-sub {
  font-size: 10.5px;
  color: var(--muted);
}
.st-track-lane {
  position: relative;
  flex: 1 0 auto;
  z-index: 2;
}
.st-event-bar {
  position: absolute;
  height: 34px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  border-left-width: 3.5px;
  background: var(--panel);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  overflow: hidden;
  transition: border-color 0.14s ease, background-color 0.14s ease, transform 0.12s ease;
}
.st-event-bar:hover,
.st-event-bar:focus-visible {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 12%, var(--panel));
  z-index: 6;
}
.st-event-bar.is-selected {
  border-color: var(--gold-light);
  background: color-mix(in srgb, var(--gold) 22%, var(--panel));
  box-shadow: 0 0 0 1px var(--gold);
  z-index: 7;
}
.st-event-bar.is-contemporary {
  border-color: var(--green);
  background: color-mix(in srgb, var(--green) 14%, var(--panel));
  z-index: 5;
}
.st-event-bar-title {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.st-event-bar-date {
  font-size: 9.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.st-inspector-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.15fr);
  gap: 12px;
  min-width: 0;
}
.st-detail-card,
.st-sync-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  min-width: 0;
}
.st-card-eyebrow {
  margin: 0;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gold);
}
.st-detail-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 6px 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.st-detail-title {
  margin: 0;
  font: 600 17px/1.25 Georgia, serif;
}
.st-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.st-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 11px;
  color: var(--muted);
}
.st-badge--date {
  border-color: var(--gold);
  color: var(--gold-light);
  font-weight: 600;
}
.st-summary {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}
.st-uncertainty-box {
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--gold);
  border-radius: 6px;
  background: color-mix(in srgb, var(--gold) 7%, var(--panel));
  font-size: 12px;
  line-height: 1.5;
}
.st-refs-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.st-ref-btn {
  font-size: 11.5px;
  padding: 4px 9px;
}
.st-sync-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 2px;
}
.st-sync-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 6px;
  background: var(--panel);
}
.st-sync-item-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}
.st-sync-jump {
  border: none;
  background: none;
  padding: 0;
  color: var(--text);
  font: 600 13px/1.3 Georgia, serif;
  text-align: left;
  cursor: pointer;
}
.st-sync-jump:hover,
.st-sync-jump:focus-visible {
  color: var(--gold-light);
  text-decoration: underline;
}
.st-sync-summary {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}
@media (max-width: 780px) {
  .st-inspector-grid {
    grid-template-columns: 1fr;
  }
  .st-corner-cell,
  .st-track-label {
    flex: 0 0 124px;
    width: 124px;
    padding: 7px 8px;
  }
}
`;
  document.head.append(style);
}

// === @section:ui:main ===
export function createSyncedTimelinePanel(callbacks: {
  preview: ContextPreview;
  onNavigate: (p: ActivePassage) => void;
}): SyncedTimelineHandle {
  ensureSyncedTimelineStyles();

  let zoom: ZoomLevel = 'standard';
  let searchQuery = '';
  let activeEraKey: string = 'divided_kingdom';
  let selectedEventId: string = 'ahab_jezebel';
  const visibleTracks = new Set<TimelineTrackId>(TIMELINE_TRACKS.map(t => t.id));

  const element = el('section', 'st-panel');
  element.setAttribute('aria-label', 'Synchronized Biblical Timeline');

  const headerHost = el('div', 'st-header');
  const eraBarHost = el('div', 'st-era-bar');
  const controlsHost = el('div', 'st-controls-row');
  const trackTogglesHost = el('div', 'st-track-toggles');
  const viewportHost = el('div', 'st-viewport');
  const inspectorHost = el('div', 'st-inspector-grid');

  element.append(headerHost, eraBarHost, controlsHost, trackTogglesHost, viewportHost, inspectorHost);

  const trackById = new Map<TimelineTrackId, TrackMeta>(TIMELINE_TRACKS.map(t => [t.id, t]));

  function getSelectedEvent(): SyncedTimelineEvent {
    return SYNCED_TIMELINE_EVENTS.find(e => e.id === selectedEventId) ?? SYNCED_TIMELINE_EVENTS[0]!;
  }

  function matchesSearch(ev: SyncedTimelineEvent, q: string): boolean {
    if (!q) return true;
    const lower = q.toLowerCase();
    return (
      ev.title.toLowerCase().includes(lower) ||
      ev.summary.toLowerCase().includes(lower) ||
      ev.dateLabel.toLowerCase().includes(lower) ||
      ev.era.toLowerCase().includes(lower) ||
      ev.refs.some(r => r.label.toLowerCase().includes(lower))
    );
  }

  function getFilteredEvents(): SyncedTimelineEvent[] {
    const q = searchQuery.trim();
    if (!q) return [...SYNCED_TIMELINE_EVENTS];
    return SYNCED_TIMELINE_EVENTS.filter(ev => matchesSearch(ev, q));
  }

  function scrollToX(targetX: number): void {
    const labelWidth = typeof window !== 'undefined' && window.innerWidth <= 780 ? 124 : 168;
    const nextLeft = Math.max(0, targetX - labelWidth - 28);
    if (typeof viewportHost.scrollTo === 'function') {
      try {
        viewportHost.scrollTo({ left: nextLeft, behavior: 'smooth' });
        return;
      } catch {
        // Fallback for non-browser DOM implementations
      }
    }
    viewportHost.scrollLeft = nextLeft;
  }

  function scrollToEvent(ev: SyncedTimelineEvent): void {
    scrollToX(yearToPx(ev.startYear, zoom));
  }

  function renderHeader(): void {
    headerHost.replaceChildren();
    const titleWrap = el('div', 'st-title-wrap');
    const eyebrow = el('p', 'eyebrow', 'SYNCHRONIZED BIBLICAL CHRONOLOGY');
    eyebrow.style.margin = '0 0 2px';
    const title = el('h3', 'st-title', 'Parallel Kingdoms, Prophets & ANE Empires');
    const subtitle = el(
      'p',
      'st-subtitle',
      'Simultaneous events share vertical alignment across all 5 parallel tracks (piecewise time scale preserves detail in dense periods). Click any bar to inspect overlapping contemporaries.',
    );
    titleWrap.append(eyebrow, title, subtitle);

    const filteredCount = getFilteredEvents().length;
    const countText = searchQuery.trim()
      ? `${filteredCount} of ${SYNCED_TIMELINE_EVENTS.length} events shown`
      : `${SYNCED_TIMELINE_EVENTS.length} synchronized events · 5 tracks`;
    headerHost.append(titleWrap, el('span', 'st-count-pill', countText));
  }

  function renderEraChips(): void {
    eraBarHost.replaceChildren();
    for (const era of TIMELINE_ERAS) {
      const isActive = era.key === activeEraKey;
      const chip = action(
        era.label,
        () => {
          focusEra(era.key);
        },
        isActive ? 'st-era-chip is-active' : 'st-era-chip',
      );
      chip.setAttribute('aria-pressed', String(isActive));
      eraBarHost.append(chip);
    }
  }

  function renderControls(): void {
    controlsHost.replaceChildren();

    const searchWrap = el('div', 'st-search-wrap');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'st-search-input';
    input.placeholder = 'Filter kings, prophets, empires, dates, or refs…';
    input.value = searchQuery;
    input.setAttribute('aria-label', 'Search synchronized timeline events');
    input.addEventListener('input', () => {
      searchQuery = input.value;
      const matches = getFilteredEvents();
      if (matches.length > 0 && !matches.some(m => m.id === selectedEventId)) {
        selectedEventId = matches[0]!.id;
      }
      renderHeader();
      renderViewport();
      renderInspector();
    });
    searchWrap.append(input);

    if (searchQuery.trim()) {
      const clearBtn = action('Clear', () => {
        searchQuery = '';
        renderAll();
      }, 'st-zoom-btn');
      searchWrap.append(clearBtn);
    }

    const zoomGroup = el('div', 'st-zoom-group');
    zoomGroup.setAttribute('role', 'group');
    zoomGroup.setAttribute('aria-label', 'Horizontal timeline zoom');
    const zoomLevels: { id: ZoomLevel; label: string }[] = [
      { id: 'compact', label: 'Compact' },
      { id: 'standard', label: 'Standard' },
      { id: 'wide', label: 'Wide' },
    ];
    for (const z of zoomLevels) {
      const btn = action(
        z.label,
        () => {
          zoom = z.id;
          renderControls();
          renderViewport();
          scrollToEvent(getSelectedEvent());
        },
        zoom === z.id ? 'st-zoom-btn is-active' : 'st-zoom-btn',
      );
      btn.setAttribute('aria-pressed', String(zoom === z.id));
      zoomGroup.append(btn);
    }

    controlsHost.append(searchWrap, zoomGroup);
  }

  function renderTrackToggles(): void {
    trackTogglesHost.replaceChildren();
    for (const track of TIMELINE_TRACKS) {
      const label = document.createElement('label');
      label.className = 'st-track-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = visibleTracks.has(track.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          visibleTracks.add(track.id);
        } else if (visibleTracks.size > 1) {
          visibleTracks.delete(track.id);
        } else {
          checkbox.checked = true;
          return;
        }
        renderViewport();
      });
      const dot = el('span', 'st-track-dot');
      dot.style.background = track.accent;
      label.append(checkbox, dot, document.createTextNode(track.label));
      trackTogglesHost.append(label);
    }
  }

  function renderViewport(): void {
    const filtered = getFilteredEvents();
    if (filtered.length === 0) {
      viewportHost.replaceChildren(
        status('No timeline events match that search query. Clear the search box to restore all 5 tracks.'),
      );
      return;
    }

    const selected = getSelectedEvent();
    const overlappingIds = new Set(findOverlappingEvents(selected).map(e => e.id));
    const totalTrackPx = getCanvasTotalWidth(zoom);

    const canvas = el('div', 'st-canvas');

    // Top Ruler Row
    const rulerRow = el('div', 'st-ruler-row');
    const corner = el('div', 'st-corner-cell', 'PARALLEL TRACKS');
    const rulerTrack = el('div', 'st-ruler-track');
    rulerTrack.style.width = `${totalTrackPx}px`;
    rulerTrack.style.minWidth = `${totalTrackPx}px`;

    for (const tick of RULER_TICKS) {
      const tickEl = el('div', 'st-ruler-tick', tick.label);
      tickEl.style.left = `${yearToPx(tick.year, zoom)}px`;
      rulerTrack.append(tickEl);
    }
    rulerRow.append(corner, rulerTrack);

    // Body with gridlines, sync highlight band, and track rows
    const body = el('div', 'st-lanes-body');

    const activeTracks = TIMELINE_TRACKS.filter(t => visibleTracks.has(t.id));
    for (const track of activeTracks) {
      const trackEvents = filtered.filter(ev => ev.track === track.id);
      const { bars, rowCount } = packTrackEvents(trackEvents, zoom);
      const laneHeight = Math.max(54, rowCount * 40 + 14);

      const row = el('div', 'st-track-row');
      const labelCell = el('div', 'st-track-label');
      const labelTitle = el('span', 'st-track-label-title');
      const dot = el('span', 'st-track-dot');
      dot.style.background = track.accent;
      labelTitle.append(dot, document.createTextNode(track.label));
      labelCell.append(
        labelTitle,
        el('span', 'st-track-label-sub', `${trackEvents.length} event${trackEvents.length === 1 ? '' : 's'}`),
      );

      const lane = el('div', 'st-track-lane');
      lane.style.width = `${totalTrackPx}px`;
      lane.style.minWidth = `${totalTrackPx}px`;
      lane.style.height = `${laneHeight}px`;

      // Vertical gridlines inside lane
      for (const tick of RULER_TICKS) {
        const gl = el('div', 'st-gridline');
        gl.style.left = `${yearToPx(tick.year, zoom)}px`;
        lane.append(gl);
      }

      // Synchronizer highlight band spanning selected event's temporal window
      const selStartX = yearToPx(selected.startYear, zoom);
      const selEndX = yearToPx(selected.endYear, zoom);
      const syncBand = el('div', 'st-sync-band');
      syncBand.style.left = `${selStartX}px`;
      syncBand.style.width = `${Math.max(8, selEndX - selStartX)}px`;
      lane.append(syncBand);

      // Event bars
      for (const bar of bars) {
        const isSel = bar.event.id === selected.id;
        const isContemp = !isSel && overlappingIds.has(bar.event.id);
        const cls = [
          'st-event-bar',
          isSel ? 'is-selected' : '',
          isContemp ? 'is-contemporary' : '',
        ].filter(Boolean).join(' ');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.style.left = `${bar.x}px`;
        btn.style.width = `${bar.width}px`;
        btn.style.top = `${7 + bar.subRow * 40}px`;
        btn.style.borderLeftColor = track.accent;
        btn.dataset.eventId = bar.event.id;
        btn.setAttribute('aria-pressed', String(isSel));
        btn.title = `${bar.event.title} (${bar.event.dateLabel})`;

        btn.append(
          el('span', 'st-event-bar-title', bar.event.title),
          el('span', 'st-event-bar-date', bar.event.dateLabel),
        );

        btn.addEventListener('click', () => {
          selectedEventId = bar.event.id;
          const matchingEra = TIMELINE_ERAS.find(e => e.eraName === bar.event.era);
          if (matchingEra) activeEraKey = matchingEra.key;
          renderEraChips();
          renderViewport();
          renderInspector();
        });

        lane.append(btn);
      }

      row.append(labelCell, lane);
      body.append(row);
    }

    canvas.append(rulerRow, body);
    viewportHost.replaceChildren(canvas);
  }

  function renderRefButtons(ev: SyncedTimelineEvent): HTMLElement {
    const row = el('div', 'st-refs-row');
    for (const r of ev.refs) {
      const btn = action(`${r.label} →`, () => callbacks.onNavigate(r.passage), 'study-button st-ref-btn');
      callbacks.preview.attach(btn, r.passage, `${ev.title} (${ev.dateLabel})`);
      row.append(btn);
    }
    return row;
  }

  function renderInspector(): void {
    const selected = getSelectedEvent();
    const trackMeta = trackById.get(selected.track)!;
    const overlapping = findOverlappingEvents(selected);

    // Left Card: Selected Event
    const detailCard = el('article', 'st-detail-card');
    const detailHead = el('div', 'st-detail-head');
    const titleBox = el('div', '');
    titleBox.append(
      el('p', 'st-card-eyebrow', 'SELECTED TIMELINE EVENT'),
      el('h4', 'st-detail-title', selected.title),
    );
    const badges = el('div', 'st-badges-row');
    const trackBadge = el('span', 'st-badge');
    const dot = el('span', 'st-track-dot');
    dot.style.background = trackMeta.accent;
    trackBadge.append(dot, document.createTextNode(trackMeta.label));
    badges.append(
      el('span', 'st-badge st-badge--date', selected.dateLabel),
      trackBadge,
      el('span', 'st-badge', selected.era),
    );
    detailHead.append(titleBox, badges);

    const summaryEl = el('p', 'st-summary', selected.summary);

    const uncBox = el('div', 'st-uncertainty-box');
    const uncLead = el('strong', '', 'Chronology & Model Scope: ');
    uncLead.style.color = 'var(--gold-light)';
    uncBox.append(
      uncLead,
      document.createTextNode(`${selected.uncertainty} `),
      el('span', 'study-muted', `Source: ${selected.source}.`),
    );

    const refsLabel = el('p', 'st-card-eyebrow', 'Scripture References (hover to preview · click to open)');
    detailCard.append(detailHead, summaryEl, uncBox, refsLabel, renderRefButtons(selected));

    // Right Card: Happening at the Same Time (Synchronized)
    const syncCard = el('aside', 'st-sync-card');
    const syncHead = el('div', 'st-detail-head');
    const syncTitleWrap = el('div', '');
    syncTitleWrap.append(
      el('p', 'st-card-eyebrow', 'SYNCHRONIZED ACROSS OTHER TRACKS'),
      el('h4', 'st-detail-title', 'Happening at the Same Time (Synchronized)'),
    );
    syncHead.append(
      syncTitleWrap,
      el('span', 'st-badge st-badge--date', `${overlapping.length} overlapping`),
    );
    syncCard.append(syncHead);

    if (overlapping.length === 0) {
      syncCard.append(status('No simultaneous events overlap this window on the remaining tracks.'));
    } else {
      const list = el('div', 'st-sync-list');
      for (const other of overlapping) {
        const otherTrack = trackById.get(other.track)!;
        const item = el('div', 'st-sync-item');
        item.style.borderLeftColor = otherTrack.accent;

        const top = el('div', 'st-sync-item-top');
        const jumpBtn = action(`${other.title} ↗`, () => {
          selectedEventId = other.id;
          const eraMatch = TIMELINE_ERAS.find(e => e.eraName === other.era);
          if (eraMatch) activeEraKey = eraMatch.key;
          visibleTracks.add(other.track);
          renderTrackToggles();
          renderEraChips();
          renderViewport();
          renderInspector();
          scrollToEvent(other);
        }, 'st-sync-jump');

        const metaBadge = el('span', 'st-badge', `${otherTrack.shortLabel} · ${other.dateLabel}`);
        top.append(jumpBtn, metaBadge);

        item.append(top, el('p', 'st-sync-summary', other.summary), renderRefButtons(other));
        list.append(item);
      }
      syncCard.append(list);
    }

    inspectorHost.replaceChildren(detailCard, syncCard);
  }

  function renderAll(): void {
    renderHeader();
    renderEraChips();
    renderControls();
    renderTrackToggles();
    renderViewport();
    renderInspector();
  }

  function focusEra(eraKey?: string): void {
    const normalized = (eraKey ?? '').trim().toLowerCase();
    const found =
      TIMELINE_ERAS.find(e => e.key === normalized || e.eraName.toLowerCase() === normalized) ??
      TIMELINE_ERAS.find(e => e.key === 'divided_kingdom')!;
    activeEraKey = found.key;
    selectedEventId = found.defaultEventId;
    if (searchQuery.trim()) {
      searchQuery = '';
      renderControls();
    }
    renderHeader();
    renderEraChips();
    renderViewport();
    renderInspector();
    scrollToX(yearToPx(found.focusYear, zoom));
  }

  function focusPassage(p: ActivePassage): void {
    const matched = matchPassageToEvent(p);
    selectedEventId = matched.id;
    const eraMatch = TIMELINE_ERAS.find(e => e.eraName === matched.era);
    if (eraMatch) activeEraKey = eraMatch.key;
    visibleTracks.add(matched.track);
    if (searchQuery.trim()) {
      searchQuery = '';
      renderControls();
    }
    renderHeader();
    renderEraChips();
    renderTrackToggles();
    renderViewport();
    renderInspector();
    scrollToEvent(matched);
  }

  renderAll();
  scrollToX(yearToPx(-935, zoom));

  return {
    element,
    focusPassage,
    focusEra,
  };
}
