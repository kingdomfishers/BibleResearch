// Generates comprehensive book/passage composition_location, audience_location, narrative settings,
// period-specific ancient place names, and the updated get_verse_geography RPC migration.
import fs from 'node:fs/promises';

const passageContexts = [
  // === PENTATEUCH: GENESIS - DEUTERONOMY ===
  {
    passage_key: 'gen-2-8-25-eden',
    title: 'Garden of Eden narrative in Greater Mesopotamia',
    book: 1, start_chapter: 2, start_verse: 8, end_chapter: 3, end_verse: 24,
    place_key: 'openbible:af3daeb',
    relationship_type: 'contextual_location',
    resolution_tier: 4,
    confidence_level: 'regional',
    evidence_refs: 'Genesis 2:8, 10-14',
    evidence_explanation: 'Genesis 2:10-14 connects the river system of Eden with the Tigris (Hiddekel) and Euphrates in Greater Mesopotamia, though the exact garden site is unknown.',
  },
  {
    passage_key: 'gen-11-1-9-shinar-babel',
    title: 'Tower of Babel on the plain of Shinar (Babylonia)',
    book: 1, start_chapter: 11, start_verse: 1, end_chapter: 11, end_verse: 9,
    place_key: 'openbible:af725b1',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Genesis 11:2, 9',
    evidence_explanation: 'Genesis 11:2 and 11:9 explicitly locate the narrative on a plain in the land of Shinar (Babylonia) at Babel.',
  },
  {
    passage_key: 'gen-12-10-20-abram-egypt',
    title: 'Abram’s sojourn in Egypt during the famine',
    book: 1, start_chapter: 12, start_verse: 10, end_chapter: 12, end_verse: 20,
    place_key: 'openbible:af301ca',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Genesis 12:10, 14',
    evidence_explanation: 'Genesis 12:10 establishes that Abram went down to Egypt to sojourn there throughout verses 10-20.',
  },
  {
    passage_key: 'gen-18-1-33-mamre',
    title: 'Visitors at the oaks of Mamre near Hebron',
    book: 1, start_chapter: 18, start_verse: 1, end_chapter: 18, end_verse: 33,
    place_key: 'openbible:aeb9e97',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Genesis 18:1; 13:18',
    evidence_explanation: 'Genesis 18:1 establishes the setting at the oaks of Mamre (near Hebron) for the entire dialogue of chapter 18.',
  },
  {
    passage_key: 'gen-19-1-29-sodom',
    title: 'Angels visit Lot in Sodom and the flight to Zoar',
    book: 1, start_chapter: 19, start_verse: 1, end_chapter: 19, end_verse: 29,
    place_key: 'openbible:a0aa664',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'disputed',
    evidence_refs: 'Genesis 19:1, 4, 22-24',
    evidence_explanation: 'Genesis 19:1 sets the narrative at the gate and house of Lot in Sodom (Southern vs. Northern Dead Sea basin proposals).',
  },
  {
    passage_key: 'gen-24-10-61-nahor-well-haran',
    title: 'Abraham’s servant meets Rebekah at the well of the city of Nahor (Aram-naharaim / Haran)',
    book: 1, start_chapter: 24, start_verse: 10, end_chapter: 24, end_verse: 61,
    place_key: 'openbible:a6d9af3',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'regional',
    evidence_refs: 'Genesis 24:10; 27:43; 29:4',
    evidence_explanation: 'Genesis 24:10 locates the well outside the city of Nahor in Aram-naharaim (Upper Mesopotamia / Haran district) without claiming exact GPS coordinates for the well itself.',
  },
  {
    passage_key: 'gen-28-10-22-bethel',
    title: 'Jacob’s dream at Bethel (formerly Luz)',
    book: 1, start_chapter: 28, start_verse: 10, end_chapter: 28, end_verse: 22,
    place_key: 'openbible:a64f355',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Genesis 28:10, 19',
    evidence_explanation: 'Genesis 28:19 identifies the place where Jacob slept and saw the ladder vision as Bethel (formerly Luz).',
  },
  {
    passage_key: 'gen-29-1-14-haran-well-region',
    title: 'Jacob’s encounter with Rachel at the shepherds’ well in the pastoral region of Haran',
    book: 1, start_chapter: 29, start_verse: 1, end_chapter: 29, end_verse: 14,
    place_key: 'openbible:a6d9af3',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'regional',
    evidence_refs: 'Genesis 27:43; 28:10; 29:1, 4',
    evidence_explanation: 'Genesis 28:10 and 29:4 establish that Jacob traveled to the pastoral countryside around Haran in Paddan-aram (Upper Mesopotamia). The well in the field (Gen 29:2, 10) has no independent archaeological GPS pin and is represented by the approximate Haran regional context.',
  },
  {
    passage_key: 'gen-29-15-31-16-haran-laban',
    title: 'Jacob’s service in Laban’s household in Haran / Paddan-aram',
    book: 1, start_chapter: 29, start_verse: 15, end_chapter: 31, end_verse: 16,
    place_key: 'openbible:a6d9af3',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Genesis 29:4, 15; 30:25; 31:18',
    evidence_explanation: 'Jacob serves Laban in Haran (Paddan-aram) until departing for Canaan in Genesis 31:17-18.',
  },
  {
    passage_key: 'gen-39-1-50-26-joseph-egypt',
    title: 'Joseph and the house of Israel in Egypt',
    book: 1, start_chapter: 39, start_verse: 1, end_chapter: 50, end_verse: 26,
    place_key: 'openbible:af301ca',
    relationship_type: 'contextual_location',
    resolution_tier: 3,
    confidence_level: 'established',
    evidence_refs: 'Genesis 39:1; 41:41; 46:6; 47:11',
    evidence_explanation: 'Genesis 39–50 unfolds primarily in Egypt (and the eastern Nile Delta / land of Goshen), except for Jacob’s burial journey to Machpelah in Hebron (50:7-13).',
  },
  {
    passage_key: 'exod-1-1-12-36-egypt-goshen',
    title: 'Israel in Egypt and the Passover in Goshen / Rameses',
    book: 2, start_chapter: 1, start_verse: 1, end_chapter: 12, end_verse: 36,
    place_key: 'openbible:af301ca',
    relationship_type: 'contextual_location',
    resolution_tier: 3,
    confidence_level: 'established',
    evidence_refs: 'Exodus 1:1, 11; 8:22; 12:1, 37',
    evidence_explanation: 'Exodus 1–12 takes place in Egypt (primarily the eastern Nile Delta / Rameses / Goshen) apart from Moses’ exile in Midian (2:15–4:18).',
  },
  {
    passage_key: 'exod-2-15-4-18-midian',
    title: 'Moses in the land of Midian and at Horeb',
    book: 2, start_chapter: 2, start_verse: 15, end_chapter: 4, end_verse: 18,
    place_key: 'openbible:acc6d8e',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'regional',
    evidence_refs: 'Exodus 2:15; 3:1; 4:19',
    evidence_explanation: 'Exodus 2:15 and 4:19 frame Moses’ exile, encounter at the well, and return commission within the land of Midian and wilderness around Horeb.',
  },
  {
    passage_key: 'exod-15-22-26-marah-shur',
    title: 'Israel in the Wilderness of Shur at Marah',
    book: 2, start_chapter: 15, start_verse: 22, end_chapter: 15, end_verse: 26,
    place_key: 'openbible:ad3970d',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'disputed',
    evidence_refs: 'Exodus 15:22-23; Numbers 33:8',
    evidence_explanation: 'Exodus 15:22-23 locates the bitter waters episode at Marah in the Wilderness of Shur, preserving competing route identifications (Ain Hawarah, Bir Mara, Uyun Musa, Bitter Lakes).',
  },
  {
    passage_key: 'exod-16-1-36-wilderness-sin',
    title: 'Manna and quail in the Wilderness of Sin',
    book: 2, start_chapter: 16, start_verse: 1, end_chapter: 16, end_verse: 36,
    place_key: 'openbible:a0f54e4',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'disputed',
    evidence_refs: 'Exodus 16:1; Numbers 33:11',
    evidence_explanation: 'Exodus 16:1 places the entire manna narrative in the Wilderness of Sin between Elim and Sinai.',
  },
  {
    passage_key: 'exod-17-1-16-rephidim',
    title: 'Water from the rock and battle with Amalek at Rephidim',
    book: 2, start_chapter: 17, start_verse: 1, end_chapter: 17, end_verse: 16,
    place_key: 'openbible:a05ebb7',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'disputed',
    evidence_refs: 'Exodus 17:1, 8; Numbers 33:14',
    evidence_explanation: 'Exodus 17:1 and 17:8 locate the encampment at Rephidim along the disputed Exodus wilderness route.',
  },
  {
    passage_key: 'exod-19-1-40-38-mount-sinai',
    title: 'Encampment at Mount Sinai / Wilderness of Sinai',
    book: 2, start_chapter: 19, start_verse: 1, end_chapter: 40, end_verse: 38,
    place_key: 'openbible:abfba2a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'disputed',
    evidence_refs: 'Exodus 19:1-2, 11, 20; 24:16; 34:2',
    evidence_explanation: 'Exodus 19:1-2 establishes Israel’s encampment before Mount Sinai in the Wilderness of Sinai, preserving all major scholarly and regional route identifications.',
  },
  {
    passage_key: 'lev-1-1-27-34-mount-sinai',
    title: 'Book of Leviticus — Priestly Legislation at Mount Sinai',
    book: 3, start_chapter: 1, start_verse: 1, end_chapter: 27, end_verse: 34,
    place_key: 'openbible:abfba2a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'disputed',
    evidence_refs: 'Leviticus 1:1; 7:38; 25:1; 26:46; 27:34',
    evidence_explanation: 'Leviticus 1:1, 7:38, 25:1, 26:46, and 27:34 explicitly locate the revelation and proclamation of Leviticus at the Tent of Meeting on Mount Sinai in the Wilderness of Sinai.',
  },
  {
    passage_key: 'num-1-1-10-10-sinai-census',
    title: 'Israel’s Census and Camp Preparation in the Wilderness of Sinai',
    book: 4, start_chapter: 1, start_verse: 1, end_chapter: 10, end_verse: 10,
    place_key: 'openbible:abfba2a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'disputed',
    evidence_refs: 'Numbers 1:1, 19; 3:14; 9:1; 10:12',
    evidence_explanation: 'Numbers 1:1 through 10:10 takes place in the Wilderness of Sinai prior to breaking camp in Numbers 10:11-12.',
  },
  {
    passage_key: 'num-10-11-20-21-paran-kadesh',
    title: 'Wilderness of Paran and Kadesh-barnea Sojourn',
    book: 4, start_chapter: 10, start_verse: 11, end_chapter: 20, end_verse: 21,
    place_key: 'openbible:ac2cef0',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Numbers 10:12; 12:16; 13:26; 20:1, 14',
    evidence_explanation: 'Numbers 12:16, 13:26, and 20:1 center Israel’s wilderness camp at Kadesh-barnea in the Wilderness of Paran/Zin.',
  },
  {
    passage_key: 'num-22-1-36-13-plains-of-moab',
    title: 'Encampment in the Plains of Moab by the Jordan across from Jericho',
    book: 4, start_chapter: 22, start_verse: 1, end_chapter: 36, end_verse: 13,
    place_key: 'openbible:aa0b1d6',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Numbers 22:1; 26:3, 63; 33:48-50; 36:13',
    evidence_explanation: 'Numbers 22:1 and 36:13 explicitly set the Balaam narrative, second census, and Transjordan ordinances in the Plains of Moab by the Jordan across from Jericho.',
  },
  {
    passage_key: 'deut-1-1-34-12-moab-covenant',
    title: 'Book of Deuteronomy — Moses’ Farewell Addresses in the Land of Moab',
    book: 5, start_chapter: 1, start_verse: 1, end_chapter: 34, end_verse: 12,
    place_key: 'openbible:aa0b1d6',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Deuteronomy 1:1, 5; 29:1; 34:1, 8',
    evidence_explanation: 'Deuteronomy 1:1, 5 and 29:1 explicitly locate Moses’ exposition of the Torah in the land of Moab beyond the Jordan.',
  },
  {
    passage_key: 'deut-1-1-34-12-composition-nebo',
    title: 'Book of Deuteronomy — Written & Deposited in the Plains of Moab / Mount Nebo',
    book: 5, start_chapter: 1, start_verse: 1, end_chapter: 34, end_verse: 12,
    place_key: 'openbible:aefaa2d',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Deuteronomy 31:9, 24-26; 32:49; 34:1',
    evidence_explanation: 'Deuteronomy 31:9, 24 records Moses writing the words of this law to the very end in the Plains of Moab before ascending Mount Nebo (Pisgah).',
  },

  // === HISTORICAL, EXILIC & WISDOM BOOKS ===
  {
    passage_key: 'ruth-1-1-18-moab',
    title: 'Naomi and Ruth in the Country of Moab',
    book: 8, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 18,
    place_key: 'openbible:aa0b1d6',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ruth 1:1-6, 19',
    evidence_explanation: 'Ruth 1:1-18 takes place in the country of Moab and along the road returning toward Judah.',
  },
  {
    passage_key: 'ruth-1-19-4-22-bethlehem',
    title: 'Ruth and Boaz in Bethlehem of Judah',
    book: 8, start_chapter: 1, start_verse: 19, end_chapter: 4, end_verse: 22,
    place_key: 'openbible:a112427',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ruth 1:19, 22; 2:4; 4:11',
    evidence_explanation: 'Ruth 1:19–4:22 unfolds entirely in the fields and town gate of Bethlehem in Judah.',
  },
  {
    passage_key: 'ezra-1-1-10-44-jerusalem-restoration',
    title: 'Book of Ezra — Temple Restoration & Covenant Reform in Jerusalem',
    book: 15, start_chapter: 1, start_verse: 1, end_chapter: 10, end_verse: 44,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ezra 1:2-5; 2:1; 3:1; 7:7-9; 10:9',
    evidence_explanation: 'Ezra records the return of the Judean exiles to Jerusalem and the rebuilding of the Second Temple and community in Jerusalem.',
  },
  {
    passage_key: 'ezra-1-1-10-44-babylon-origin',
    title: 'Book of Ezra — Departure of Exiles from Babylon',
    book: 15, start_chapter: 1, start_verse: 1, end_chapter: 10, end_verse: 44,
    place_key: 'openbible:a217d18',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'established',
    evidence_refs: 'Ezra 1:11; 2:1; 7:6, 9; 8:1',
    evidence_explanation: 'Both waves of returnees under Zerubbabel (Ezra 2:1) and Ezra the scribe (Ezra 7:6, 9) originate from the Babylonian exile before compiling the records in Jerusalem.',
  },
  {
    passage_key: 'neh-1-1-2-8-susa-citadel',
    title: 'Nehemiah in Susa (Shushan) the Citadel as Cupbearer to Artaxerxes',
    book: 16, start_chapter: 1, start_verse: 1, end_chapter: 2, end_verse: 8,
    place_key: 'openbible:a033b84',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Nehemiah 1:1; 2:1-8',
    evidence_explanation: 'Nehemiah 1:1 explicitly locates Nehemiah in Susa (Shushan) the citadel in the twentieth year of King Artaxerxes I.',
  },
  {
    passage_key: 'neh-2-9-13-31-jerusalem-walls',
    title: 'Nehemiah’s Rebuilding of the Walls and Reforms in Jerusalem',
    book: 16, start_chapter: 2, start_verse: 9, end_chapter: 13, end_verse: 31,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Nehemiah 2:11, 17; 6:15; 8:1; 13:6-15',
    evidence_explanation: 'From Nehemiah 2:11 through 13:31, the narrative and Nehemiah’s personal memoirs are set and composed in Jerusalem.',
  },
  {
    passage_key: 'esth-1-1-10-3-susa-shushan',
    title: 'Book of Esther — Royal Court at Susa (Shushan) the Citadel in Persia',
    book: 17, start_chapter: 1, start_verse: 1, end_chapter: 10, end_verse: 3,
    place_key: 'openbible:a033b84',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Esther 1:2, 5; 2:3, 5, 8; 3:15; 8:14-15; 9:6-18',
    evidence_explanation: 'Esther 1:2 and 9:20-32 locate the royal court events and the recording of the Purim letters in Susa (Shushan) the citadel during the reign of Ahasuerus (Xerxes I).',
  },
  {
    passage_key: 'job-1-1-42-17-land-of-uz',
    title: 'Book of Job — Dialogue in the Land of Uz',
    book: 18, start_chapter: 1, start_verse: 1, end_chapter: 42, end_verse: 17,
    place_key: 'openbible:a324c4d',
    relationship_type: 'contextual_location',
    resolution_tier: 3,
    confidence_level: 'regional',
    evidence_refs: 'Job 1:1; Lamentations 4:21; Jeremiah 25:20',
    evidence_explanation: 'Job 1:1 sets the entire narrative and poetic dialogue in the land of Uz (linked in Lamentations 4:21 with Edom/Teman or northern Aram/Bashan traditions).',
  },
  {
    passage_key: 'eccl-1-1-12-14-jerusalem',
    title: 'Book of Ecclesiastes — Qoheleth in Jerusalem',
    book: 21, start_chapter: 1, start_verse: 1, end_chapter: 12, end_verse: 14,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ecclesiastes 1:1, 12, 16; 2:7, 9',
    evidence_explanation: 'Ecclesiastes 1:1 and 1:12 explicitly frame the speaker’s royal reflection and composition in Jerusalem.',
  },
  {
    passage_key: 'song-1-1-8-14-jerusalem',
    title: 'Song of Songs — Jerusalem and Royal Court Setting',
    book: 22, start_chapter: 1, start_verse: 1, end_chapter: 8, end_verse: 14,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 3,
    confidence_level: 'established',
    evidence_refs: 'Song of Songs 1:5; 2:7; 3:5, 10-11; 5:8, 16; 6:4',
    evidence_explanation: 'Repeated addresses to the "daughters of Jerusalem" (1:5; 2:7; 3:5; 5:8; 8:4) and Zion (3:11) anchor the lyric collection in Jerusalem.',
  },

  // === MAJOR & MINOR PROPHETS (BOOKS 23-39) ===
  {
    passage_key: 'isa-1-1-66-24-jerusalem-composition',
    title: 'Book of Isaiah — Prophetic Ministry & Composition in Jerusalem',
    book: 23, start_chapter: 1, start_verse: 1, end_chapter: 66, end_verse: 24,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Isaiah 1:1; 2:1; 6:1; 7:1-3; 36:2; 37:1-2',
    evidence_explanation: 'Isaiah 1:1 and 2:1 identify the vision of Isaiah son of Amoz concerning Judah and Jerusalem, centered on the Jerusalem Temple and royal court.',
  },
  {
    passage_key: 'jer-1-1-42-22-jerusalem-ministry',
    title: 'Book of Jeremiah (Ch. 1–42) — Prophetic Ministry & Scroll Composition in Jerusalem',
    book: 24, start_chapter: 1, start_verse: 1, end_chapter: 42, end_verse: 22,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Jeremiah 1:1-3; 7:1-2; 26:1-2; 36:1-32',
    evidence_explanation: 'Jeremiah 1–42 records Jeremiah’s proclamations and the dictation of his scroll to Baruch in Jerusalem (Jeremiah 36:4-10, 32) and nearby Anathoth.',
  },
  {
    passage_key: 'jer-43-1-44-30-tahpanhes-egypt',
    title: 'Book of Jeremiah (Ch. 43–44) — Oracles at Tahpanhes in Egypt',
    book: 24, start_chapter: 43, start_verse: 1, end_chapter: 44, end_verse: 30,
    place_key: 'openbible:adb008c',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Jeremiah 43:7-8; 44:1',
    evidence_explanation: 'Jeremiah 43:7-8 explicitly locates Jeremiah and Baruch among the Judean remnant at Tahpanhes (Daphnae / Tell Defenneh) in the eastern Nile Delta of Egypt.',
  },
  {
    passage_key: 'jer-45-1-52-34-jerusalem-babylon',
    title: 'Book of Jeremiah (Ch. 45–52) — Oracles to the Nations & Fall of Jerusalem',
    book: 24, start_chapter: 45, start_verse: 1, end_chapter: 52, end_verse: 34,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'established',
    evidence_refs: 'Jeremiah 45:1; 51:59-64; 52:1-30',
    evidence_explanation: 'Compiled from Jeremiah’s Jerusalem scrolls (45:1; 51:60) and sent via Seraiah to the exiles in Babylon (51:59-64).',
  },
  {
    passage_key: 'lam-1-1-5-22-jerusalem',
    title: 'Book of Lamentations — Dirges over Destroyed Jerusalem',
    book: 25, start_chapter: 1, start_verse: 1, end_chapter: 5, end_verse: 22,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Lamentations 1:1, 7-8, 17; 2:1-15; 4:12',
    evidence_explanation: 'Lamentations mourns the 586 BC siege and destruction of Jerusalem and the Temple on Mount Zion.',
  },
  {
    passage_key: 'ezek-1-1-48-35-chebar-canal',
    title: 'Book of Ezekiel — Prophetic Residence & Composition by the Chebar (Kebar) Canal in Babylonia',
    book: 26, start_chapter: 1, start_verse: 1, end_chapter: 48, end_verse: 35,
    place_key: 'openbible:a3d2f0a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ezekiel 1:1-3; 3:15, 23; 10:15, 20; 11:24-25; 43:3',
    evidence_explanation: 'Ezekiel 1:1-3 and 3:15 explicitly locate Ezekiel among the Judean exiles by the Chebar (Kebar) Canal at Tel-abib in the land of the Chaldeans (Babylonia), where his visions were received and written.',
  },
  {
    passage_key: 'ezek-8-1-11-25-jerusalem-vision',
    title: 'Ezekiel’s First Temple Vision in Jerusalem (while exiled in Babylonia)',
    book: 26, start_chapter: 8, start_verse: 1, end_chapter: 11, end_verse: 25,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ezekiel 8:1-3; 11:24-25',
    evidence_explanation: 'While sitting in his house in Babylonia (8:1), Ezekiel is brought in visions of God to Jerusalem and the inner court of the Temple (8:3) before returning in vision to the exiles in Chaldea (11:24).',
  },
  {
    passage_key: 'ezek-40-1-48-35-restored-temple-jerusalem',
    title: 'Ezekiel’s Vision of the Restored Temple and Land (Centered on Jerusalem)',
    book: 26, start_chapter: 40, start_verse: 1, end_chapter: 48, end_verse: 35,
    place_key: 'openbible:a15257a',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ezekiel 40:1-2; 43:1-7; 48:35',
    evidence_explanation: 'In the twenty-fifth year of exile in Babylonia (40:1), Ezekiel is brought in visions of God to the land of Israel and the temple mount of Jerusalem (40:2; 48:35).',
  },
  {
    passage_key: 'dan-1-1-7-28-babylon-court',
    title: 'Book of Daniel (Ch. 1–7) — Royal Court & Visions in Babylon',
    book: 27, start_chapter: 1, start_verse: 1, end_chapter: 7, end_verse: 28,
    place_key: 'openbible:a217d18',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Daniel 1:1-7; 2:12, 48-49; 4:29-30; 5:1, 30; 7:1',
    evidence_explanation: 'Daniel 1–7 is set and written in Babylon during the reigns of Nebuchadnezzar, Belshazzar, Darius, and Cyrus (Daniel 7:1 records Daniel writing down the dream on his bed in Babylon).',
  },
  {
    passage_key: 'dan-8-1-27-ulai-canal',
    title: 'Daniel’s Vision by the Ulai Canal (Eulaeus River) at Susa in Elam',
    book: 27, start_chapter: 8, start_verse: 1, end_chapter: 8, end_verse: 27,
    place_key: 'openbible:a7a7549',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Daniel 8:2, 16',
    evidence_explanation: 'Daniel 8:2 and 8:16 explicitly locate Daniel’s vision of the ram and the goat beside the Ulai Canal (אוּלַי / Eulaeus / Karkheh-Shaur waterway) at Susa.',
  },
  {
    passage_key: 'dan-8-1-27-susa-composition',
    title: 'Daniel 8 — Susa (Shushan) the Citadel in the Province of Elam (Setting & Composition)',
    book: 27, start_chapter: 8, start_verse: 1, end_chapter: 8, end_verse: 27,
    place_key: 'openbible:a033b84',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Daniel 8:2, 27',
    evidence_explanation: 'Daniel 8:2 and 8:27 locate Daniel at Susa (Shushan) the citadel in the province of Elam, where he saw the vision and afterward went about the king’s business.',
  },
  {
    passage_key: 'dan-9-1-27-babylon-prayer',
    title: 'Daniel 9 — Prayer and Seventy-Weeks Revelation in Babylon',
    book: 27, start_chapter: 9, start_verse: 1, end_chapter: 9, end_verse: 27,
    place_key: 'openbible:a217d18',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Daniel 9:1-2, 20-21',
    evidence_explanation: 'Daniel 9:1-2 locates Daniel in the realm of the Chaldeans (Babylon) in the first year of Darius, studying Jeremiah’s scroll and interceding for Jerusalem.',
  },
  {
    passage_key: 'dan-10-1-12-13-tigris-river',
    title: 'Daniel 10–12 — Final Vision on the Bank of the Great River Tigris (Hiddekel)',
    book: 27, start_chapter: 10, start_verse: 1, end_chapter: 12, end_verse: 13,
    place_key: 'openbible:a38ebfd',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Daniel 10:4; 12:5-6',
    evidence_explanation: 'Daniel 10:4 and 12:5 explicitly locate the entire final revelation (chapters 10–12) on the bank of the great river, the Tigris (Hiddekel).',
  },
  {
    passage_key: 'dan-10-1-12-13-babylon-composition',
    title: 'Daniel 10–12 — Written in Babylonia / Mesopotamia (Third Year of Cyrus)',
    book: 27, start_chapter: 10, start_verse: 1, end_chapter: 12, end_verse: 13,
    place_key: 'openbible:a217d18',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'established',
    evidence_refs: 'Daniel 10:1; 12:4, 9',
    evidence_explanation: 'Revealed and sealed in a scroll (Daniel 12:4) in Mesopotamia/Babylonia in the third year of Cyrus king of Persia (10:1).',
  },
  {
    passage_key: 'hos-1-1-14-9-samaria-israel',
    title: 'Book of Hosea — Prophetic Ministry to Samaria & Northern Israel',
    book: 28, start_chapter: 1, start_verse: 1, end_chapter: 14, end_verse: 9,
    place_key: 'openbible:a041bb3',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Hosea 1:1, 4; 7:1; 8:5-6; 10:5, 7; 13:16',
    evidence_explanation: 'Hosea prophesies in and to the Northern Kingdom of Israel centered at its royal capital Samaria.',
  },
  {
    passage_key: 'joel-1-1-3-21-jerusalem-zion',
    title: 'Book of Joel — Prophetic Liturgy in Jerusalem (Mount Zion)',
    book: 29, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 21,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Joel 1:14; 2:1, 15, 23, 32; 3:1, 16-21',
    evidence_explanation: 'Joel is set at the Temple and Mount Zion in Jerusalem, calling the priests and inhabitants of Judah and Jerusalem to solemn assembly.',
  },
  {
    passage_key: 'amos-1-1-9-15-bethel-audience',
    title: 'Book of Amos — Prophetic Confrontation at Bethel & Samaria',
    book: 30, start_chapter: 1, start_verse: 1, end_chapter: 9, end_verse: 15,
    place_key: 'openbible:a64f355',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Amos 3:14; 4:4; 5:5-6; 7:10-13',
    evidence_explanation: 'Amos delivers his primary indictment at the king’s sanctuary and temple of the kingdom at Bethel in Northern Israel (Amos 7:10-13).',
  },
  {
    passage_key: 'amos-1-1-9-15-tekoa-composition',
    title: 'Book of Amos — Authored by Amos of Tekoa in Judah',
    book: 30, start_chapter: 1, start_verse: 1, end_chapter: 9, end_verse: 15,
    place_key: 'openbible:a2e3aa0',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Amos 1:1; 7:12',
    evidence_explanation: 'Amos 1:1 identifies the prophet’s origin and Judean home base as Tekoa (Khirbet Teku’a, south of Bethlehem).',
  },
  {
    passage_key: 'obad-1-1-21-edom-audience',
    title: 'Book of Obadiah — Oracle Concerning Edom (Mount Seir)',
    book: 31, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 21,
    place_key: 'openbible:a2735ff',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Obadiah 1, 8-9, 18-21',
    evidence_explanation: 'Obadiah 1 explicitly directs the vision against Edom and Mount Seir.',
  },
  {
    passage_key: 'obad-1-1-21-jerusalem-composition',
    title: 'Book of Obadiah — Composed Concerning Jerusalem’s Fall and Restoration',
    book: 31, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 21,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'established',
    evidence_refs: 'Obadiah 11-17, 20-21',
    evidence_explanation: 'Composed in Judah/Jerusalem reflecting on Edom’s hostility on the day strangers entered the gates of Jerusalem (v. 11) and promising deliverance on Mount Zion (v. 17, 21).',
  },
  {
    passage_key: 'jonah-1-1-2-10-joppa-sea',
    title: 'Book of Jonah (Ch. 1–2) — Flight from Joppa onto the Mediterranean Sea',
    book: 32, start_chapter: 1, start_verse: 1, end_chapter: 2, end_verse: 10,
    place_key: 'openbible:ae023a9',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Jonah 1:3-4',
    evidence_explanation: 'Jonah 1:3 locates Jonah’s embarkation at the port of Joppa (Jaffa) into the Mediterranean Sea.',
  },
  {
    passage_key: 'jonah-3-1-4-11-nineveh',
    title: 'Book of Jonah (Ch. 3–4) — Jonah’s Preaching and Vigil at Nineveh',
    book: 32, start_chapter: 3, start_verse: 1, end_chapter: 4, end_verse: 11,
    place_key: 'openbible:a70fd5d',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Jonah 3:2-5; 4:5, 11',
    evidence_explanation: 'Jonah 3:2-5 and 4:5 explicitly set chapters 3–4 in and just east of the great Assyrian city of Nineveh.',
  },
  {
    passage_key: 'mic-1-1-7-20-jerusalem-samaria',
    title: 'Book of Micah — Prophetic Word Concerning Samaria and Jerusalem',
    book: 33, start_chapter: 1, start_verse: 1, end_chapter: 7, end_verse: 20,
    place_key: 'openbible:a15257a',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Micah 1:1, 5, 9; 3:10, 12; 4:1-2',
    evidence_explanation: 'Micah 1:1 and Jeremiah 26:18 anchor Micah of Moresheth’s prophetic ministry and audience in Jerusalem and Judah (alongside Samaria).',
  },
  {
    passage_key: 'nah-1-1-3-19-nineveh-oracle',
    title: 'Book of Nahum — Oracle Concerning Nineveh (Assyria)',
    book: 34, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 19,
    place_key: 'openbible:a70fd5d',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Nahum 1:1; 2:8; 3:7, 18',
    evidence_explanation: 'Nahum 1:1 explicitly titles the book "An oracle concerning Nineveh," the capital of the Neo-Assyrian Empire.',
  },
  {
    passage_key: 'nah-1-1-3-19-judah-composition',
    title: 'Book of Nahum — Composed in Judah / Jerusalem',
    book: 34, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 19,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'probable',
    evidence_refs: 'Nahum 1:15',
    evidence_explanation: 'Nahum 1:15 addresses Judah ("Keep your feasts, O Judah; fulfill your vows") from within the Southern Kingdom centered on Jerusalem.',
  },
  {
    passage_key: 'hab-1-1-3-19-jerusalem-judah',
    title: 'Book of Habakkuk — Watchtower Oracle & Temple Liturgy in Jerusalem',
    book: 35, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 19,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Habakkuk 1:6; 2:1, 20; 3:19',
    evidence_explanation: 'Composed in Jerusalem/Judah on the eve of the Neo-Babylonian invasion, concluding with a liturgical psalm for the Jerusalem Temple choir (3:19).',
  },
  {
    passage_key: 'zeph-1-1-3-20-jerusalem',
    title: 'Book of Zephaniah — Prophetic Ministry in Josiah’s Jerusalem',
    book: 36, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 20,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Zephaniah 1:1, 4, 10-12; 3:14-17',
    evidence_explanation: 'Zephaniah 1:4, 10-12 names specific quarters of Jerusalem (Fish Gate, Second Quarter, Mortar) as the immediate setting and audience of his ministry.',
  },
  {
    passage_key: 'hag-1-1-2-23-jerusalem-temple',
    title: 'Book of Haggai — Oracles at the Second Temple Site in Jerusalem',
    book: 37, start_chapter: 1, start_verse: 1, end_chapter: 2, end_verse: 23,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Haggai 1:1-4, 14; 2:1-9; Ezra 5:1-2',
    evidence_explanation: 'Delivered in Jerusalem in 520 BC (second year of Darius I) to Zerubbabel, Joshua, and the remnant rebuilding the Temple.',
  },
  {
    passage_key: 'zech-1-1-14-21-jerusalem',
    title: 'Book of Zechariah — Post-Exilic Visions and Oracles in Jerusalem',
    book: 38, start_chapter: 1, start_verse: 1, end_chapter: 14, end_verse: 21,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Zechariah 1:1, 16; 2:1-12; 8:3; 14:1-21; Ezra 5:1-2',
    evidence_explanation: 'Zechariah prophesies and writes in post-exilic Jerusalem alongside Haggai during the rebuilding of the Second Temple.',
  },
  {
    passage_key: 'mal-1-1-4-6-jerusalem',
    title: 'Book of Malachi — Covenant Disputation at the Jerusalem Temple',
    book: 39, start_chapter: 1, start_verse: 1, end_chapter: 4, end_verse: 6,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Malachi 1:1, 10; 2:11; 3:1, 4, 10',
    evidence_explanation: 'Malachi addresses the priests and community serving at the altar and storehouse of the Second Temple in Jerusalem (Persian Yehud).',
  },

  // === GOSPELS & ACTS (BOOKS 40-44) ===
  {
    passage_key: 'matt-1-1-28-20-composition-antioch',
    title: 'Gospel of Matthew — Scholarly Composition & Audience Provenance (Syrian Antioch / Judea)',
    book: 40, start_chapter: 1, start_verse: 1, end_chapter: 28, end_verse: 20,
    place_key: 'openbible:ae41ab4',
    relationship_type: 'composition_location',
    resolution_tier: 4,
    confidence_level: 'probable',
    evidence_refs: 'Matthew 4:24; Ignatius of Antioch; Acts 11:19-26',
    evidence_explanation: 'Early patristic reception (Ignatius of Antioch, Didache) and modern New Testament scholarship most commonly locate the composition of Matthew in Syrian Antioch (or Galilee/Judea) for a Greek-speaking Jewish-Christian community.',
  },
  {
    passage_key: 'matt-5-1-7-29-sermon-mount-galilee',
    title: 'Sermon on the Mount in Galilee (near Capernaum / Sea of Galilee)',
    book: 40, start_chapter: 5, start_verse: 1, end_chapter: 7, end_verse: 29,
    place_key: 'openbible:af2161c',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Matthew 4:23-25; 5:1; 8:1, 5',
    evidence_explanation: 'Matthew 4:23–5:1 and 8:1, 5 frame the Sermon on the Mount on the hillsides overlooking the Sea of Galilee immediately adjacent to Capernaum.',
  },
  {
    passage_key: 'mark-1-1-16-20-composition-rome',
    title: 'Gospel of Mark — Composition & Audience Provenance in Rome',
    book: 41, start_chapter: 1, start_verse: 1, end_chapter: 16, end_verse: 20,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 4,
    confidence_level: 'probable',
    evidence_refs: '1 Peter 5:13; Mark 15:21; Papias (Eusebius, Hist. eccl. 3.39.15); Irenaeus (Adv. Haer. 3.1.1)',
    evidence_explanation: 'Early patristic testimony (Papias, Irenaeus, Clement of Alexandria) and Latinisms in the text connect Mark’s Gospel with Peter’s ministry and the Christian community in Rome.',
  },
  {
    passage_key: 'luke-1-1-24-53-composition-caesarea-rome',
    title: 'Gospel of Luke — Composition Provenance (Caesarea / Rome / Achaia)',
    book: 42, start_chapter: 1, start_verse: 1, end_chapter: 24, end_verse: 53,
    place_key: 'openbible:a58735e',
    relationship_type: 'composition_location',
    resolution_tier: 4,
    confidence_level: 'probable',
    evidence_refs: 'Luke 1:1-4; Acts 24:27; 27:1; 28:16, 30',
    evidence_explanation: 'Luke compiled his two-volume work for Theophilus drawing on eyewitness traditions gathered during Paul’s two-year imprisonment at Caesarea Maritima (Acts 24:27) and subsequent stay in Rome (Acts 28:30).',
  },
  {
    passage_key: 'john-4-5-42-sychar-samaria',
    title: 'Jesus and the Samaritan woman at Jacob’s well near Sychar in Samaria',
    book: 43, start_chapter: 4, start_verse: 5, end_chapter: 4, end_verse: 42,
    place_key: 'openbible:a27b472',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'John 4:4-6',
    evidence_explanation: 'John 4:4-6 explicitly establishes the narrative setting at Jacob’s well near the Samaritan town of Sychar (identified with modern Askar or Tell Balatah/Shechem) for the entire dialogue and townspeople encounter through verse 42.',
  },
  {
    passage_key: 'john-13-1-17-26-jerusalem-upper-room',
    title: 'Jesus’ Farewell Discourse and High Priestly Prayer in Jerusalem',
    book: 43, start_chapter: 13, start_verse: 1, end_chapter: 17, end_verse: 26,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'John 12:12; 13:1; 18:1',
    evidence_explanation: 'John 13–17 takes place in Jerusalem on the night before the crucifixion prior to crossing the Kidron Valley in John 18:1.',
  },
  {
    passage_key: 'john-1-1-21-25-composition-ephesus',
    title: 'Gospel of John — Composition & Publication at Ephesus in Roman Asia',
    book: 43, start_chapter: 1, start_verse: 1, end_chapter: 21, end_verse: 25,
    place_key: 'openbible:a5feb15',
    relationship_type: 'composition_location',
    resolution_tier: 4,
    confidence_level: 'established',
    evidence_refs: 'John 21:24; Irenaeus (Adv. Haer. 3.1.1); Polycrates of Ephesus (Eusebius, Hist. eccl. 5.24.2-3)',
    evidence_explanation: 'Second-century witnesses from Asia Minor (Irenaeus, Polycrates of Ephesus) and modern scholarship identify Ephesus as the place where the Fourth Gospel was written and published.',
  },
  {
    passage_key: 'acts-1-1-7-60-jerusalem-early-church',
    title: 'Early Jerusalem Church, Pentecost, and Stephen’s Defense in Jerusalem',
    book: 44, start_chapter: 1, start_verse: 1, end_chapter: 7, end_verse: 60,
    place_key: 'openbible:a15257a',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Acts 1:4, 12; 2:5; 4:5; 6:7; 8:1',
    evidence_explanation: 'Acts 1–7 takes place entirely in Jerusalem (Mount of Olives, Upper Room, Temple courts, and Sanhedrin council chamber).',
  },
  {
    passage_key: 'acts-17-16-34-athens-areopagus',
    title: 'Paul’s ministry and Areopagus speech in Athens',
    book: 44, start_chapter: 17, start_verse: 16, end_chapter: 17, end_verse: 34,
    place_key: 'openbible:a1fe6e7',
    relationship_type: 'contextual_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Acts 17:15-16, 19, 22; 18:1',
    evidence_explanation: 'Acts 17:15-16 and 17:19-22 establish Athens and the Areopagus as the setting of Paul’s reasoning and address until he departs Athens for Corinth in Acts 18:1.',
  },
  {
    passage_key: 'acts-1-1-28-31-composition-rome',
    title: 'Acts of the Apostles — Composition Provenance in Rome',
    book: 44, start_chapter: 1, start_verse: 1, end_chapter: 28, end_verse: 31,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 4,
    confidence_level: 'probable',
    evidence_refs: 'Acts 1:1; 28:16, 30-31',
    evidence_explanation: 'Acts culminates with Luke accompanying Paul to Rome during his two-year house arrest (Acts 28:16, 30-31), where the book is traditionally and critically dated.',
  },

  // === PAULINE EPISTLES (BOOKS 45-58): AUDIENCE (FOR WHERE) & COMPOSITION (WHERE WRITTEN) ===
  {
    passage_key: 'rom-1-1-16-27-audience-rome',
    title: 'Epistle to the Romans — Written To the Church in Rome',
    book: 45, start_chapter: 1, start_verse: 1, end_chapter: 16, end_verse: 27,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Romans 1:7, 15',
    evidence_explanation: 'Romans 1:7 and 1:15 explicitly address the epistle "to all those in Rome who are loved by God and called to be saints."',
  },
  {
    passage_key: 'rom-1-1-16-27-composition-corinth',
    title: 'Epistle to the Romans — Written by Paul from Corinth (Cenchreae)',
    book: 45, start_chapter: 1, start_verse: 1, end_chapter: 16, end_verse: 27,
    place_key: 'openbible:a6f437a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Romans 16:1, 22-23; 1 Corinthians 1:14; Acts 20:2-3',
    evidence_explanation: 'Paul commends Phoebe, a deacon of the church at Cenchreae (Corinth’s eastern port, Romans 16:1), and sends greetings from his host Gaius and city treasurer Erastus in Corinth (16:23; c. AD 57).',
  },
  {
    passage_key: '1cor-1-1-16-24-audience-corinth',
    title: 'First Epistle to the Corinthians — Written To the Church at Corinth',
    book: 46, start_chapter: 1, start_verse: 1, end_chapter: 16, end_verse: 24,
    place_key: 'openbible:a6f437a',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Corinthians 1:2',
    evidence_explanation: '1 Corinthians 1:2 explicitly addresses "the church of God that is in Corinth" in the Roman province of Achaia.',
  },
  {
    passage_key: '1cor-1-1-16-24-composition-ephesus',
    title: 'First Epistle to the Corinthians — Written by Paul from Ephesus',
    book: 46, start_chapter: 1, start_verse: 1, end_chapter: 16, end_verse: 24,
    place_key: 'openbible:a5feb15',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Corinthians 16:8, 19; Acts 19:1, 22',
    evidence_explanation: '1 Corinthians 16:8 and 16:19 explicitly state that Paul is writing from Ephesus ("I will stay in Ephesus until Pentecost... The churches of Asia send you greetings").',
  },
  {
    passage_key: '2cor-1-1-13-14-audience-corinth',
    title: 'Second Epistle to the Corinthians — Written To the Church at Corinth & Achaia',
    book: 47, start_chapter: 1, start_verse: 1, end_chapter: 13, end_verse: 14,
    place_key: 'openbible:a6f437a',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '2 Corinthians 1:1, 23; 6:11',
    evidence_explanation: '2 Corinthians 1:1 explicitly addresses "the church of God that is at Corinth, with all the saints who are in the whole of Achaia."',
  },
  {
    passage_key: '2cor-1-1-13-14-composition-macedonia',
    title: 'Second Epistle to the Corinthians — Written by Paul from Macedonia',
    book: 47, start_chapter: 1, start_verse: 1, end_chapter: 13, end_verse: 14,
    place_key: 'openbible:a69e1b8',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '2 Corinthians 2:13; 7:5-7; 8:1; 9:2-4; Acts 20:1-2',
    evidence_explanation: '2 Corinthians 2:13, 7:5, 8:1, and 9:2-4 establish that Paul wrote the epistle from Macedonia (Philippi/Thessalonica) after meeting Titus on his way toward Corinth.',
  },
  {
    passage_key: 'gal-1-1-6-18-audience-galatia',
    title: 'Epistle to the Galatians — Written To the Churches of Galatia',
    book: 48, start_chapter: 1, start_verse: 1, end_chapter: 6, end_verse: 18,
    place_key: 'openbible:a0f440a',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Galatians 1:2; 3:1; Acts 13:14–14:23; 16:6',
    evidence_explanation: 'Galatians 1:2 and 3:1 explicitly address "the churches of Galatia" in Asia Minor (Pisidian Antioch, Iconium, Lystra, Derbe, and central Anatolia).',
  },
  {
    passage_key: 'gal-1-1-6-18-composition-antioch',
    title: 'Epistle to the Galatians — Written by Paul (Syrian Antioch / Ephesus Provenance)',
    book: 48, start_chapter: 1, start_verse: 1, end_chapter: 6, end_verse: 18,
    place_key: 'openbible:ae41ab4',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'probable',
    evidence_refs: 'Galatians 2:11-14; Acts 14:26-28; 18:22-23',
    evidence_explanation: 'Written by Paul either from his sending church at Syrian Antioch following the First Missionary Journey (Galatians 2:11; Acts 14:26-28) or from Ephesus/Corinth during the Third Missionary Journey.',
  },
  {
    passage_key: 'eph-1-1-6-24-audience-ephesus',
    title: 'Epistle to the Ephesians — Written To the Church at Ephesus (and Roman Asia)',
    book: 49, start_chapter: 1, start_verse: 1, end_chapter: 6, end_verse: 24,
    place_key: 'openbible:a5feb15',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Ephesians 1:1; 6:21-22; Acts 19:1-10',
    evidence_explanation: 'Ephesians 1:1 addresses the saints who are in Ephesus (and circular congregations across the Roman province of Asia, delivered by Tychicus — 6:21-22).',
  },
  {
    passage_key: 'eph-1-1-6-24-composition-rome',
    title: 'Epistle to the Ephesians — Written by Paul in Imprisonment (Rome)',
    book: 49, start_chapter: 1, start_verse: 1, end_chapter: 6, end_verse: 24,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Ephesians 3:1; 4:1; 6:20-21; Acts 28:16, 30',
    evidence_explanation: 'Paul writes as "an ambassador in chains" (Ephesians 3:1; 4:1; 6:20), traditionally from his Roman imprisonment (c. AD 60–62; alternative proposals: Ephesus or Caesarea) and sends the letter with Tychicus.',
  },
  {
    passage_key: 'phil-1-1-4-23-audience-philippi',
    title: 'Epistle to the Philippians — Written To the Church at Philippi in Macedonia',
    book: 50, start_chapter: 1, start_verse: 1, end_chapter: 4, end_verse: 23,
    place_key: 'openbible:a49e1d0',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Philippians 1:1; 4:15; Acts 16:12',
    evidence_explanation: 'Philippians 1:1 and 4:15 explicitly address the saints, overseers, and deacons at Philippi, a Roman colony and leading city of the district of Macedonia.',
  },
  {
    passage_key: 'phil-1-1-4-23-composition-rome',
    title: 'Epistle to the Philippians — Written by Paul in Imprisonment (Rome)',
    book: 50, start_chapter: 1, start_verse: 1, end_chapter: 4, end_verse: 23,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Philippians 1:13; 4:22; Acts 28:16, 30',
    evidence_explanation: 'Philippians 1:13 ("throughout the whole imperial guard / praetorium") and 4:22 ("those of Caesar’s household") point to Paul’s imprisonment in Rome (c. AD 60–62; alternative proposals: Ephesus or Caesarea).',
  },
  {
    passage_key: 'col-1-1-4-18-audience-colossae',
    title: 'Epistle to the Colossians — Written To the Church at Colossae (Colossia)',
    book: 51, start_chapter: 1, start_verse: 1, end_chapter: 4, end_verse: 18,
    place_key: 'openbible:a4e5a69',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Colossians 1:2; 2:1; 4:13, 16',
    evidence_explanation: 'Colossians 1:2 explicitly addresses "the saints and faithful brothers in Christ at Colossae" (Κολοσσαί / Colossia) in the Lycus Valley of Phrygia (Roman Asia), alongside neighboring Laodicea and Hierapolis (4:13, 16).',
  },
  {
    passage_key: 'col-1-1-4-18-composition-rome',
    title: 'Epistle to the Colossians — Written by Paul in Imprisonment (Rome)',
    book: 51, start_chapter: 1, start_verse: 1, end_chapter: 4, end_verse: 18,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Colossians 4:3, 7-10, 18; Philemon 1, 22-24; Acts 28:16, 30',
    evidence_explanation: 'Written by Paul in chains ("Remember my chains" — Colossians 4:3, 10, 18), traditionally from his imprisonment in Rome (c. AD 60–62; alternative proposals: Ephesus or Caesarea) and carried to Colossae by Tychicus and Onesimus (4:7-9).',
  },
  {
    passage_key: '1thess-1-1-5-28-audience-thessalonica',
    title: 'First Epistle to the Thessalonians — Written To the Church at Thessalonica',
    book: 52, start_chapter: 1, start_verse: 1, end_chapter: 5, end_verse: 28,
    place_key: 'openbible:afa9d8e',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Thessalonians 1:1; 2:1-2; Acts 17:1',
    evidence_explanation: '1 Thessalonians 1:1 explicitly addresses "the church of the Thessalonians in God the Father and the Lord Jesus Christ" in Macedonia.',
  },
  {
    passage_key: '1thess-1-1-5-28-composition-corinth',
    title: 'First Epistle to the Thessalonians — Written by Paul from Corinth',
    book: 52, start_chapter: 1, start_verse: 1, end_chapter: 5, end_verse: 28,
    place_key: 'openbible:a6f437a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Thessalonians 3:1-6; Acts 18:1, 5',
    evidence_explanation: 'Acts 18:1, 5 and 1 Thessalonians 3:1-6 show that Paul wrote 1 Thessalonians from Corinth shortly after Silas and Timothy rejoined him from Macedonia (c. AD 50–51).',
  },
  {
    passage_key: '2thess-1-1-3-18-audience-thessalonica',
    title: 'Second Epistle to the Thessalonians — Written To the Church at Thessalonica',
    book: 53, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 18,
    place_key: 'openbible:afa9d8e',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '2 Thessalonians 1:1',
    evidence_explanation: '2 Thessalonians 1:1 explicitly addresses "the church of the Thessalonians in God our Father and the Lord Jesus Christ."',
  },
  {
    passage_key: '2thess-1-1-3-18-composition-corinth',
    title: 'Second Epistle to the Thessalonians — Written by Paul from Corinth',
    book: 53, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 18,
    place_key: 'openbible:a6f437a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '2 Thessalonians 1:1; Acts 18:1, 5, 11',
    evidence_explanation: 'Written by Paul, Silvanus, and Timothy from Corinth during their eighteen-month ministry in Achaia (Acts 18:5, 11; c. AD 51).',
  },
  {
    passage_key: '1tim-1-1-6-21-audience-ephesus',
    title: 'First Epistle to Timothy — Addressed to Timothy at Ephesus',
    book: 54, start_chapter: 1, start_verse: 1, end_chapter: 6, end_verse: 21,
    place_key: 'openbible:a5feb15',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Timothy 1:3',
    evidence_explanation: '1 Timothy 1:3 explicitly states that Paul urged Timothy "to remain at Ephesus" to shepherd the congregation there.',
  },
  {
    passage_key: '1tim-1-1-6-21-composition-macedonia',
    title: 'First Epistle to Timothy — Written by Paul from Macedonia',
    book: 54, start_chapter: 1, start_verse: 1, end_chapter: 6, end_verse: 21,
    place_key: 'openbible:a69e1b8',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Timothy 1:3; 3:14',
    evidence_explanation: '1 Timothy 1:3 records that Paul wrote the epistle after departing Ephesus for Macedonia ("As I urged you when I was going to Macedonia, remain at Ephesus").',
  },
  {
    passage_key: '2tim-1-1-4-22-audience-ephesus',
    title: 'Second Epistle to Timothy — Addressed to Timothy at Ephesus',
    book: 55, start_chapter: 1, start_verse: 1, end_chapter: 4, end_verse: 22,
    place_key: 'openbible:a5feb15',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '2 Timothy 1:18; 4:12, 19; 1 Timothy 1:3',
    evidence_explanation: '2 Timothy 1:18 and 4:12, 19 locate Timothy with the Ephesian household of Onesiphorus and Prisca and Aquila in Ephesus.',
  },
  {
    passage_key: '2tim-1-1-4-22-composition-rome',
    title: 'Second Epistle to Timothy — Written by Paul from Imprisonment in Rome',
    book: 55, start_chapter: 1, start_verse: 1, end_chapter: 4, end_verse: 22,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '2 Timothy 1:16-17; 2:9; 4:6-8, 16-17, 21',
    evidence_explanation: '2 Timothy 1:17 explicitly states that Onesiphorus searched for Paul and found him "when he arrived in Rome," where Paul awaits the conclusion of his trial.',
  },
  {
    passage_key: 'titus-1-1-3-15-audience-crete',
    title: 'Epistle to Titus — Addressed to Titus on the Island of Crete',
    book: 56, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 15,
    place_key: 'openbible:a26aa94',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Titus 1:5, 12',
    evidence_explanation: 'Titus 1:5 explicitly states: "This is why I left you in Crete, so that you might put what remained into order, and appoint elders in every town."',
  },
  {
    passage_key: 'titus-1-1-3-15-composition-nicopolis',
    title: 'Epistle to Titus — Written by Paul En Route to Nicopolis',
    book: 56, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 15,
    place_key: 'openbible:af43cde',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Titus 3:12',
    evidence_explanation: 'Titus 3:12 instructs Titus: "Do your best to come to me at Nicopolis, for I have decided to spend the winter there."',
  },
  {
    passage_key: 'phlm-1-1-25-audience-colossae',
    title: 'Epistle to Philemon — Addressed to Philemon’s House Church at Colossae',
    book: 57, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 25,
    place_key: 'openbible:a4e5a69',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Philemon 1-2, 10-12; Colossians 4:9, 17',
    evidence_explanation: 'Colossians 4:9 ("Onesimus, who is one of you") and 4:17 ("say to Archippus") connect Philemon, Apphia, Archippus, and Onesimus directly to Colossae.',
  },
  {
    passage_key: 'phlm-1-1-25-composition-rome',
    title: 'Epistle to Philemon — Written by Paul in Imprisonment (Rome)',
    book: 57, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 25,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Philemon 1, 9-10, 22-24; Colossians 4:7-14',
    evidence_explanation: 'Written simultaneously with Colossians during Paul’s imprisonment (traditionally Rome, c. AD 60–62; alternative proposal: Ephesus).',
  },
  {
    passage_key: 'heb-1-1-13-25-audience-rome-italy',
    title: 'Epistle to the Hebrews — Italian / Roman Congregation Circle',
    book: 58, start_chapter: 1, start_verse: 1, end_chapter: 13, end_verse: 25,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'audience_location',
    resolution_tier: 3,
    confidence_level: 'probable',
    evidence_refs: 'Hebrews 13:23-24; 1 Clement (Rome, c. AD 96)',
    evidence_explanation: 'Hebrews 13:24 ("Those who come from Italy send you greetings") and its earliest attestation in 1 Clement at Rome connect the epistle’s recipients and senders with Italy/Rome.',
  },

  // === GENERAL EPISTLES & REVELATION (BOOKS 59-66) ===
  {
    passage_key: 'jas-1-1-5-20-composition-jerusalem',
    title: 'Epistle of James — Written from Jerusalem to the Twelve Tribes in the Dispersion',
    book: 59, start_chapter: 1, start_verse: 1, end_chapter: 5, end_verse: 20,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'James 1:1; Acts 12:17; 15:13; 21:18; Galatians 1:19; 2:9',
    evidence_explanation: 'Written by James (the Lord’s brother and leader of the Jerusalem church) from Jerusalem to Jewish-Christian congregations in the Dispersion (James 1:1).',
  },
  {
    passage_key: '1pet-1-1-5-14-audience-asia-minor',
    title: 'First Epistle of Peter — Written To the Churches of Asia Minor (Pontus, Galatia, Cappadocia, Asia, Bithynia)',
    book: 60, start_chapter: 1, start_verse: 1, end_chapter: 5, end_verse: 14,
    place_key: 'openbible:a197f19',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Peter 1:1',
    evidence_explanation: '1 Peter 1:1 explicitly addresses "the elect exiles of the Dispersion in Pontus, Galatia, Cappadocia, Asia, and Bithynia" across Roman Asia Minor.',
  },
  {
    passage_key: '1pet-1-1-5-14-composition-rome',
    title: 'First Epistle of Peter — Written from Rome ("Babylon")',
    book: 60, start_chapter: 1, start_verse: 1, end_chapter: 5, end_verse: 14,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: '1 Peter 5:12-13; Eusebius (Hist. eccl. 2.15.2)',
    evidence_explanation: '1 Peter 5:13 sends greetings from "she who is at Babylon" alongside Mark—universally understood in early patristic and modern critical scholarship as the church in Rome.',
  },
  {
    passage_key: '2pet-1-1-3-18-audience-asia-minor',
    title: 'Second Epistle of Peter — Written To the Churches of Asia Minor',
    book: 61, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 18,
    place_key: 'openbible:a197f19',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: '2 Peter 3:1; 1 Peter 1:1',
    evidence_explanation: '2 Peter 3:1 ("This is now the second letter that I am writing to you") identifies the recipients with the Asia Minor congregations addressed in 1 Peter 1:1.',
  },
  {
    passage_key: '2pet-1-1-3-18-composition-rome',
    title: 'Second Epistle of Peter — Written from Rome Prior to Martyrdom',
    book: 61, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 18,
    place_key: 'openbible:afc8e7a',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'probable',
    evidence_refs: '2 Peter 1:13-15',
    evidence_explanation: 'Framed as Peter’s testament shortly before the putting off of his body (2 Peter 1:14), associated with his martyrdom in Rome.',
  },
  {
    passage_key: '1john-1-1-5-21-ephesus',
    title: 'First Epistle of John — Written & Circulated in Ephesus (Roman Asia)',
    book: 62, start_chapter: 1, start_verse: 1, end_chapter: 5, end_verse: 21,
    place_key: 'openbible:a5feb15',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: 'Irenaeus (Adv. Haer. 3.3.4); Eusebius (Hist. eccl. 3.23)',
    evidence_explanation: 'Composed within the Johannine community network centered at Ephesus in the Roman province of Asia.',
  },
  {
    passage_key: '2john-1-1-13-ephesus',
    title: 'Second Epistle of John — Written from Ephesus in Roman Asia',
    book: 63, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 13,
    place_key: 'openbible:a5feb15',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: '2 John 1, 12; Irenaeus (Adv. Haer. 3.16.8)',
    evidence_explanation: 'Written by the Elder within the Johannine circle centered at Ephesus in Roman Asia.',
  },
  {
    passage_key: '3john-1-1-15-ephesus',
    title: 'Third Epistle of John — Written from Ephesus in Roman Asia',
    book: 64, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 15,
    place_key: 'openbible:a5feb15',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'probable',
    evidence_refs: '3 John 1, 9-14',
    evidence_explanation: 'Written by the Elder to Gaius within the Johannine network of churches around Ephesus in Roman Asia.',
  },
  {
    passage_key: 'jude-1-1-25-jerusalem-judea',
    title: 'Epistle of Jude — Judean / Jerusalem Apostolic Provenance',
    book: 65, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 25,
    place_key: 'openbible:a15257a',
    relationship_type: 'composition_location',
    resolution_tier: 3,
    confidence_level: 'probable',
    evidence_refs: 'Jude 1, 17; Matthew 13:55; Acts 1:14',
    evidence_explanation: 'Written by Jude, servant of Jesus Christ and brother of James (leader of the Jerusalem church).',
  },
  {
    passage_key: 'rev-1-1-3-22-composition-patmos',
    title: 'Book of Revelation (Ch. 1–3) — Written by John on the Island of Patmos',
    book: 66, start_chapter: 1, start_verse: 1, end_chapter: 3, end_verse: 22,
    place_key: 'openbible:a8f60f3',
    relationship_type: 'composition_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 1:9-11',
    evidence_explanation: 'Revelation 1:9-11 explicitly states that John was on the island called Patmos in the Aegean Sea when commanded to write in a scroll to the seven churches of Asia.',
  },
  {
    passage_key: 'rev-1-1-20-audience-asia',
    title: 'Revelation 1 — Addressed to the Seven Churches in the Province of Asia',
    book: 66, start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 20,
    place_key: 'openbible:a197f19',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 1:4, 11',
    evidence_explanation: 'Revelation 1:4 and 1:11 address the seven churches in the Roman province of Asia (Ephesus, Smyrna, Pergamum, Thyatira, Sardis, Philadelphia, Laodicea).',
  },
  {
    passage_key: 'rev-2-1-7-audience-ephesus',
    title: 'Revelation 2:1–7 — Message to the Church in Ephesus',
    book: 66, start_chapter: 2, start_verse: 1, end_chapter: 2, end_verse: 7,
    place_key: 'openbible:a5feb15',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 2:1',
    evidence_explanation: 'Revelation 2:1 explicitly addresses the angel of the church in Ephesus.',
  },
  {
    passage_key: 'rev-2-8-11-audience-smyrna',
    title: 'Revelation 2:8–11 — Message to the Church in Smyrna',
    book: 66, start_chapter: 2, start_verse: 8, end_chapter: 2, end_verse: 11,
    place_key: 'openbible:a2e65fb',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 2:8',
    evidence_explanation: 'Revelation 2:8 explicitly addresses the angel of the church in Smyrna (modern Izmir).',
  },
  {
    passage_key: 'rev-2-12-17-audience-pergamos',
    title: 'Revelation 2:12–17 — Message to the Church in Pergamum',
    book: 66, start_chapter: 2, start_verse: 12, end_chapter: 2, end_verse: 17,
    place_key: 'openbible:a75d2c1',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 2:12',
    evidence_explanation: 'Revelation 2:12 explicitly addresses the angel of the church in Pergamum.',
  },
  {
    passage_key: 'rev-2-18-29-audience-thyatira',
    title: 'Revelation 2:18–29 — Message to the Church in Thyatira',
    book: 66, start_chapter: 2, start_verse: 18, end_chapter: 2, end_verse: 29,
    place_key: 'openbible:a94b661',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 2:18',
    evidence_explanation: 'Revelation 2:18 explicitly addresses the angel of the church in Thyatira.',
  },
  {
    passage_key: 'rev-3-1-6-audience-sardis',
    title: 'Revelation 3:1–6 — Message to the Church in Sardis',
    book: 66, start_chapter: 3, start_verse: 1, end_chapter: 3, end_verse: 6,
    place_key: 'openbible:aab4a5f',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 3:1',
    evidence_explanation: 'Revelation 3:1 explicitly addresses the angel of the church in Sardis.',
  },
  {
    passage_key: 'rev-3-7-13-audience-philadelphia',
    title: 'Revelation 3:7–13 — Message to the Church in Philadelphia',
    book: 66, start_chapter: 3, start_verse: 7, end_chapter: 3, end_verse: 13,
    place_key: 'openbible:a1c7cc1',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 3:7',
    evidence_explanation: 'Revelation 3:7 explicitly addresses the angel of the church in Philadelphia.',
  },
  {
    passage_key: 'rev-3-14-22-audience-laodicea',
    title: 'Revelation 3:14–22 — Message to the Church in Laodicea',
    book: 66, start_chapter: 3, start_verse: 14, end_chapter: 3, end_verse: 22,
    place_key: 'openbible:a83fb1e',
    relationship_type: 'audience_location',
    resolution_tier: 2,
    confidence_level: 'established',
    evidence_refs: 'Revelation 3:14',
    evidence_explanation: 'Revelation 3:14 explicitly addresses the angel of the church in Laodicea in the Lycus Valley.',
  },
  {
    passage_key: 'rev-4-1-5-14-heavenly-throne',
    title: 'Heavenly throne-room vision',
    book: 66, start_chapter: 4, start_verse: 1, end_chapter: 5, end_verse: 14,
    place_key: 'symbolic:heavenly-throne',
    relationship_type: 'uncertain_location',
    resolution_tier: 2,
    confidence_level: 'symbolic_non_physical',
    evidence_refs: 'Revelation 4:1-2',
    evidence_explanation: 'Revelation 4:1-2 explicitly frames the vision in heaven rather than at a physical terrestrial coordinate.',
  },
  {
    passage_key: 'rev-21-1-22-5-new-jerusalem',
    title: 'Vision of the New Heaven, New Earth, and New Jerusalem',
    book: 66, start_chapter: 21, start_verse: 1, end_chapter: 22, end_verse: 5,
    place_key: 'symbolic:new-jerusalem',
    relationship_type: 'uncertain_location',
    resolution_tier: 2,
    confidence_level: 'symbolic_non_physical',
    evidence_refs: 'Revelation 21:1-2, 10',
    evidence_explanation: 'Revelation 21:1-2 describes the eschatological New Jerusalem descending out of heaven from God in a new heaven and new earth; no physical terrestrial GPS coordinate is fabricated.',
  },
];

await fs.writeFile('data/geography/passage-contexts.json', JSON.stringify(passageContexts, null, 2));

// Era Gazetteer & Period-Specific Ancient Place Names by Chronological Era
const eraGazetteerEntries = [
  // Primeval & Patriarchal (Middle Bronze Age, c. 2100–1550 BC)
  { place_key: 'openbible:a6d9af3', eras: ['primeval_patriarchal', 'monarchy_divided_kingdom'], period_names: { primeval_patriarchal: 'Haran / Charan (חָרָן · Paddan-aram)', monarchy_divided_kingdom: 'Haran (חָרָן · Upper Aram)' } },
  { place_key: 'openbible:af725b1', eras: ['primeval_patriarchal', 'exile_persian'], period_names: { primeval_patriarchal: 'Shinar / Sumer & Akkad (שִׁנְעָר)', exile_persian: 'Shinar / Babylonia (שִׁנְעָר)' } },
  { place_key: 'openbible:a217d18', eras: ['primeval_patriarchal', 'monarchy_divided_kingdom', 'exile_persian'], period_names: { primeval_patriarchal: 'Babel (בָּבֶל · Shinar)', monarchy_divided_kingdom: 'Babylon (בָּבֶל · Chaldea)', exile_persian: 'Babylon / Bavel (בָּבֶל · Imperial Capital)' } },
  { place_key: 'openbible:aeb9e97', eras: ['primeval_patriarchal'], period_names: { primeval_patriarchal: 'Mamre / Kiriath-arba (מַמְרֵא · Hebron)' } },
  { place_key: 'openbible:a64f355', eras: ['primeval_patriarchal', 'exodus_conquest_judges', 'monarchy_divided_kingdom'], period_names: { primeval_patriarchal: 'Luz / Bethel (לוּז · בֵּית־אֵל)', exodus_conquest_judges: 'Bethel (בֵּית־אֵל)', monarchy_divided_kingdom: 'Bethel Royal Sanctuary (בֵּית־אֵל)' } },
  { place_key: 'openbible:ad2f6c2', eras: ['primeval_patriarchal', 'monarchy_divided_kingdom'], period_names: { primeval_patriarchal: 'Beersheba (בְּאֵר שֶׁבַע · Negev)', monarchy_divided_kingdom: 'Beersheba (בְּאֵר שֶׁבַע · Southern Border)' } },
  { place_key: 'openbible:af301ca', eras: ['primeval_patriarchal', 'exodus_conquest_judges', 'monarchy_divided_kingdom', 'exile_persian'], period_names: { primeval_patriarchal: 'Mitzrayim / Egypt (מִצְרַיִם)', exodus_conquest_judges: 'Mitzrayim / Goshen (מִצְרַיִם)', monarchy_divided_kingdom: 'Egypt (מִצְרַיִם)', exile_persian: 'Egypt / Satrapy of Mudraya (מִצְרַיִם)' } },
  { place_key: 'openbible:a69c1d4', eras: ['primeval_patriarchal', 'monarchy_divided_kingdom', 'roman_new_testament'], period_names: { primeval_patriarchal: 'Damascus / Dammeseq (דַּמֶּשֶׂק)', monarchy_divided_kingdom: 'Damascus / Aram-Damascus (דַּמֶּשֶׂק)', roman_new_testament: 'Damaskos / Damascus (Δαμασκός · Syria)' } },
  { place_key: 'openbible:a15257a', eras: ['primeval_patriarchal', 'exodus_conquest_judges', 'monarchy_divided_kingdom', 'exile_persian', 'roman_new_testament'], period_names: { primeval_patriarchal: 'Salem / Moriah (שָׁלֵם · מֹרִיָּה)', exodus_conquest_judges: 'Jebus / Jerusalem (יְבוּס · יְרוּשָׁלִַם)', monarchy_divided_kingdom: 'Jerusalem / City of David (יְרוּשָׁלִַם · צִיּוֹן)', exile_persian: 'Jerusalem / Yehud Medinata (יְרוּשְׁלֶם)', roman_new_testament: 'Hierosolyma / Jerusalem (Ἱεροσόλυμα · Judaea)' } },

  // Exodus, Wilderness, Conquest & Judges (Late Bronze / Iron I, c. 1550–1010 BC)
  { place_key: 'openbible:abfba2a', eras: ['exodus_conquest_judges'], period_names: { exodus_conquest_judges: 'Mount Sinai / Horeb (הַר סִינַי · חֹרֵב)' } },
  { place_key: 'openbible:ad3970d', eras: ['exodus_conquest_judges'], period_names: { exodus_conquest_judges: 'Marah in Shur (מָרָה)' } },
  { place_key: 'openbible:a05ebb7', eras: ['exodus_conquest_judges'], period_names: { exodus_conquest_judges: 'Rephidim (רְפִידִים)' } },
  { place_key: 'openbible:acc6d8e', eras: ['exodus_conquest_judges'], period_names: { exodus_conquest_judges: 'Land of Midian (מִדְיָן)' } },
  { place_key: 'openbible:ac2cef0', eras: ['exodus_conquest_judges'], period_names: { exodus_conquest_judges: 'Kadesh-barnea (קָדֵשׁ בַּרְנֵעַ · Paran)' } },
  { place_key: 'openbible:aa0b1d6', eras: ['exodus_conquest_judges', 'monarchy_divided_kingdom'], period_names: { exodus_conquest_judges: 'Plains of Moab (עַרְבוֹת מוֹאָב)', monarchy_divided_kingdom: 'Kingdom of Moab (מוֹאָב)' } },
  { place_key: 'openbible:aefaa2d', eras: ['exodus_conquest_judges'], period_names: { exodus_conquest_judges: 'Mount Nebo / Pisgah (הַר נְבוֹ)' } },

  // Monarchy & Divided Kingdom (Iron Age II, c. 1010–586 BC)
  { place_key: 'openbible:a041bb3', eras: ['monarchy_divided_kingdom', 'roman_new_testament'], period_names: { monarchy_divided_kingdom: 'Samaria / Shomeron (שֹׁמְרוֹן · Capital of Israel)', roman_new_testament: 'Samareia / Sebaste (Σαμάρεια)' } },
  { place_key: 'openbible:a112427', eras: ['exodus_conquest_judges', 'monarchy_divided_kingdom', 'roman_new_testament'], period_names: { exodus_conquest_judges: 'Bethlehem / Ephrathah (בֵּית לֶחֶם)', monarchy_divided_kingdom: 'Bethlehem of Judah (בֵּית לֶחֶם יְהוּדָה)', roman_new_testament: 'Bethleem (Βηθλέεμ · Judaea)' } },
  { place_key: 'openbible:a70fd5d', eras: ['monarchy_divided_kingdom', 'exile_persian'], period_names: { monarchy_divided_kingdom: 'Nineveh (נִינְוֵה · Neo-Assyrian Capital)', exile_persian: 'Nineveh Ruins (נִינְוֵה · Assyria)' } },
  { place_key: 'openbible:a2e3aa0', eras: ['monarchy_divided_kingdom'], period_names: { monarchy_divided_kingdom: 'Tekoa in Judah (תְּקוֹעַ)' } },
  { place_key: 'openbible:a2735ff', eras: ['exodus_conquest_judges', 'monarchy_divided_kingdom', 'exile_persian'], period_names: { exodus_conquest_judges: 'Land of Edom / Seir (אֱדוֹם)', monarchy_divided_kingdom: 'Kingdom of Edom (אֱדוֹם · Bozrah)', exile_persian: 'Edom / Idumea (אֱדוֹם)' } },
  { place_key: 'openbible:ae023a9', eras: ['monarchy_divided_kingdom', 'roman_new_testament'], period_names: { monarchy_divided_kingdom: 'Joppa / Yafo Port (יָפוֹ)', roman_new_testament: 'Ioppe / Joppa (Ἰόππη)' } },

  // Babylonian Exile & Achaemenid Persian Period (c. 586–332 BC)
  { place_key: 'openbible:a033b84', eras: ['exile_persian'], period_names: { exile_persian: 'Shushan the Citadel / Susa (שׁוּשַׁן הַבִּירָה · Elam)' } },
  { place_key: 'openbible:a7a7549', eras: ['exile_persian'], period_names: { exile_persian: 'Ulai Canal / Eulaeus River (אוּלַי · Susa)' } },
  { place_key: 'openbible:a3d2f0a', eras: ['exile_persian'], period_names: { exile_persian: 'Chebar / Kebar Canal (נְהַר־כְּבָר · Nippur/Babylonia)' } },
  { place_key: 'openbible:a38ebfd', eras: ['primeval_patriarchal', 'monarchy_divided_kingdom', 'exile_persian'], period_names: { primeval_patriarchal: 'Hiddekel / Tigris River (חִדֶּקֶל)', monarchy_divided_kingdom: 'Tigris River (חִדֶּקֶל · Assyria)', exile_persian: 'Great River Hiddekel / Tigris (חִדֶּקֶל)' } },
  { place_key: 'openbible:adb008c', eras: ['exile_persian'], period_names: { exile_persian: 'Tahpanhes / Daphnae (תַּחְפַּנְחֵס · Nile Delta)' } },

  // Early Roman Empire & New Testament Apostolic Age (1st Century AD)
  { place_key: 'openbible:a27b472', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Sychar by Jacob’s Well (Συχάρ · Samaria)' } },
  { place_key: 'openbible:af2161c', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Kapharnaoum / Capernaum (Καφαρναούμ · Galilee)' } },
  { place_key: 'openbible:af5884f', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Nazaret / Nazareth (Ναζαρέτ · Galilee)' } },
  { place_key: 'openbible:a58735e', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Kaisareia Maritima (Καισάρεια · Roman Judaea Capital)' } },
  { place_key: 'openbible:ae41ab4', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Antiocheia on the Orontes (Ἀντιόχεια · Roman Syria)' } },
  { place_key: 'openbible:a6c704a', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Pisidian Antiocheia (Ἀντιόχεια τῆς Πισιδίας · Galatia)' } },
  { place_key: 'openbible:a4e5a69', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Colossae / Colossia (Κολοσσαί · Lycus Valley, Phrygia)' } },
  { place_key: 'openbible:a5feb15', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Ephesos / Ephesus (Ἔφεσος · Roman Asia Capital)' } },
  { place_key: 'openbible:a83fb1e', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Laodikeia on the Lycus (Λαοδίκεια · Phrygia, Asia)' } },
  { place_key: 'openbible:a2e65fb', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Smyrna (Σμύρνα · Roman Asia)' } },
  { place_key: 'openbible:a75d2c1', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Pergamon / Pergamum (Πέργαμον · Roman Asia)' } },
  { place_key: 'openbible:a94b661', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Thyateira / Thyatira (Θυάτειρα · Lydia, Asia)' } },
  { place_key: 'openbible:aab4a5f', eras: ['exile_persian', 'roman_new_testament'], period_names: { exile_persian: 'Sepharad / Sardis (סְפָרַד · Lydia)', roman_new_testament: 'Sardeis / Sardis (Σάρδεις · Roman Asia)' } },
  { place_key: 'openbible:a1c7cc1', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Philadelpheia (Φιλαδέλφεια · Roman Asia)' } },
  { place_key: 'openbible:a8f60f3', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Island of Patmos (Πάτμος · Aegean Sea)' } },
  { place_key: 'openbible:a49e1d0', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Philippoi / Colonia Philippi (Φίλιπποι · Macedonia)' } },
  { place_key: 'openbible:afa9d8e', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Thessalonike (Θεσσαλονίκη · Macedonia Capital)' } },
  { place_key: 'openbible:a1fe6e7', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Athenai / Athens (Ἀθῆναι · Achaia)' } },
  { place_key: 'openbible:a6f437a', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Korinthos / Corinth (Κόρινθος · Achaia Capital)' } },
  { place_key: 'openbible:afc8e7a', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Rhome / Imperial Rome (Ῥώμη · Italia)' } },
  { place_key: 'openbible:a26aa94', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Krete / Island of Crete (Κρήτη)' } },
  { place_key: 'openbible:af43cde', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Nikopolis in Epirus (Νικόπολις)' } },
  { place_key: 'openbible:a0f440a', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Province of Galatia (Γαλατία · Anatolia)' } },
  { place_key: 'openbible:a197f19', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Roman Province of Asia (Ἀσία · Western Anatolia)' } },
  { place_key: 'openbible:a69e1b8', eras: ['roman_new_testament'], period_names: { roman_new_testament: 'Roman Province of Macedonia (Μακεδονία)' } },
];

const q = v => v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
const qArr = arr => !arr || !arr.length ? `'{}'::text[]` : `ARRAY[${arr.map(q).join(',')}]::text[]`;
const qJson = obj => obj === null || obj === undefined ? 'null' : `${q(JSON.stringify(obj))}::jsonb`;

const passageValues = passageContexts.map(p =>
  `(${q(p.passage_key)},${q(p.title)},${p.book},${p.start_chapter},${p.start_verse},${p.end_chapter},${p.end_verse},${q(p.place_key)},${q(p.relationship_type)},${p.resolution_tier},${q(p.confidence_level)},${q(p.evidence_refs)},${q(p.evidence_explanation)},'curated_narrative_geography')`
).join(',\n');

const eraUpdates = eraGazetteerEntries.map(e =>
  `(${q(e.place_key)},${qArr(e.eras)},${qJson(e.period_names)})`
).join(',\n');

const sql = `-- Additive migration: composition_location & audience_location support, curated book/epistle/prophetic provenance,
-- chronological era place names, and era_gazetteer in public.get_verse_geography.

alter table public.places
  add column if not exists active_eras text[] not null default '{}'::text[],
  add column if not exists period_names jsonb not null default '{}'::jsonb;

create index if not exists idx_places_active_eras_gin on public.places using gin(active_eras);

alter table public.passage_geography
  drop constraint if exists passage_geography_relationship_type_check;
alter table public.passage_geography
  add constraint passage_geography_relationship_type_check
  check (relationship_type in (
    'event_location',
    'contextual_location',
    'composition_location',
    'audience_location',
    'mentioned_location',
    'travel_origin',
    'travel_destination',
    'uncertain_location'
  ));

alter table public.verse_geography
  drop constraint if exists verse_geography_relationship_type_check;
alter table public.verse_geography
  add constraint verse_geography_relationship_type_check
  check (relationship_type in (
    'event_location',
    'contextual_location',
    'composition_location',
    'audience_location',
    'mentioned_location',
    'travel_origin',
    'travel_destination',
    'uncertain_location'
  ));

-- Populate period_names and active_eras on key biblical places
update public.places as p
set
  active_eras = v.active_eras,
  period_names = v.period_names
from (values
${eraUpdates}
) as v(place_key, active_eras, period_names)
where p.place_key = v.place_key;

-- Upsert curated narrative, composition (where written), and audience (for whom/where written) passage contexts
insert into public.passage_geography(
  passage_key, title, book, start_chapter, start_verse, end_chapter, end_verse,
  place_id, relationship_type, resolution_tier, confidence_level,
  evidence_refs, evidence_explanation, source_id
)
select
  v.passage_key, v.title, v.book::smallint, v.start_chapter::smallint, v.start_verse::smallint,
  v.end_chapter::smallint, v.end_verse::smallint, pl.id, v.relationship_type,
  v.resolution_tier::smallint, v.confidence_level, v.evidence_refs, v.evidence_explanation, s.id
from (values
${passageValues}
) as v(
  passage_key, title, book, start_chapter, start_verse, end_chapter, end_verse,
  place_key, relationship_type, resolution_tier, confidence_level,
  evidence_refs, evidence_explanation, source_key
)
left join public.places pl on pl.place_key = v.place_key
join public.geography_sources s on s.source_key = v.source_key
on conflict (passage_key) do update set
  title = excluded.title,
  book = excluded.book,
  start_chapter = excluded.start_chapter,
  start_verse = excluded.start_verse,
  end_chapter = excluded.end_chapter,
  end_verse = excluded.end_verse,
  place_id = excluded.place_id,
  relationship_type = excluded.relationship_type,
  resolution_tier = excluded.resolution_tier,
  confidence_level = excluded.confidence_level,
  evidence_refs = excluded.evidence_refs,
  evidence_explanation = excluded.evidence_explanation;

-- Ensure Daniel 8:2 & 8:16 Ulai and Susa direct verse_geography rows are event_location (Tier 1)
update public.verse_geography vg
set relationship_type = 'event_location', resolution_tier = 1
from public.verses vr, public.places pl
where vg.verse_id = vr.id and vg.place_id = pl.id
  and vr.book = 27 and vr.chapter = 8
  and pl.place_key in ('openbible:a7a7549', 'openbible:a033b84');

-- Replace public.get_verse_geography with chronological context, period-specific ancient names,
-- composition/audience location resolution, and era_gazetteer
create or replace function public.get_verse_geography(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '5s'
as $rpc$
declare
  vid integer;
  v_millennium smallint;
  lo_year integer;
  hi_year integer;
  era_key text;
  era_label text;
  date_label text;
  chron_json jsonb;
  gazetteer_json jsonb;
  locations_json jsonb;
  passages_json jsonb;
  sources_json jsonb;
  bounds_json jsonb;
  res_status text;
  top_tier smallint;
  has_physical boolean;
  has_non_physical boolean;
  response jsonb;
begin
  if p_book is null or p_chapter is null or p_verse is null
     or p_book not between 1 and 66
     or p_chapter not between 1 and 150
     or p_verse not between 0 and 176 then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_reference');
  end if;

  select v.id, v.millennium into vid, v_millennium
  from public.verses v
  where v.book = p_book::smallint and v.chapter = p_chapter::smallint and v.verse_nr = p_verse::smallint;

  if vid is null then
    return jsonb_build_object('schema_version', 1, 'status', 'passage_not_found');
  end if;

  -- 1. Resolve chronological time of the verse from chronology_assertions or scholarly book range
  select
    min(a.earliest_year),
    max(a.latest_year)
  into lo_year, hi_year
  from public.chronology_assignment_assertions aa
  join public.chronology_assertions a on a.id = aa.assertion_id
  join public.chronology_active_runs ar on ar.run_id = aa.run_id
  where aa.verse_id = vid
    and a.axis <> 'mentioned_event'
    and a.earliest_year is not null;

  if lo_year is null then
    if p_book = 1 then lo_year := -2000; hi_year := -1800;
    elsif p_book in (2, 3, 4, 5, 6, 7, 18) then lo_year := -1445; hi_year := -1050;
    elsif p_book in (8, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34, 35, 36) then lo_year := -1010; hi_year := -586;
    elsif p_book = 26 then lo_year := -592; hi_year := -570;
    elsif p_book = 27 and p_chapter = 8 then lo_year := -550; hi_year := -550;
    elsif p_book = 27 then lo_year := -604; hi_year := -535;
    elsif p_book = 17 then lo_year := -482; hi_year := -472;
    elsif p_book in (15, 16, 37, 38, 39) then lo_year := -538; hi_year := -430;
    elsif p_book in (40, 41, 42, 43) then lo_year := -4; hi_year := 33;
    elsif p_book = 44 then lo_year := 30; hi_year := 62;
    elsif p_book in (52, 53) then lo_year := 50; hi_year := 51;
    elsif p_book in (45, 46, 47, 48) then lo_year := 53; hi_year := 57;
    elsif p_book in (49, 50, 51, 57) then lo_year := 60; hi_year := 62;
    elsif p_book in (54, 55, 56, 58, 59, 60, 61, 65) then lo_year := 48; hi_year := 67;
    else lo_year := 85; hi_year := 96;
    end if;
  end if;

  if p_book >= 40 or hi_year >= -10 then
    era_key := 'roman_new_testament';
    era_label := 'Early Roman Empire & Apostolic Age (1st Century AD)';
  elsif p_book in (15, 16, 17, 26, 27, 37, 38, 39) or (hi_year between -586 and -332) then
    era_key := 'exile_persian';
    era_label := 'Babylonian Exile & Achaemenid Persian Period (6th–5th Century BC)';
  elsif p_book = 1 or (hi_year <= -1550) then
    era_key := 'primeval_patriarchal';
    era_label := 'Primeval & Patriarchal Period (Middle Bronze Age)';
  elsif p_book in (2, 3, 4, 5, 6, 7) or (hi_year between -1549 and -1040) then
    era_key := 'exodus_conquest_judges';
    era_label := 'Exodus, Wilderness, Conquest & Judges (Late Bronze / Iron Age I)';
  else
    era_key := 'monarchy_divided_kingdom';
    era_label := 'United & Divided Monarchy (Iron Age II — Israel, Judah & Near East)';
  end if;

  date_label := case
    when lo_year is null then 'Date range not established'
    when lo_year = hi_year then 'around ' || public.chronology_year_label(lo_year)
    else public.chronology_year_label(lo_year) || ' to ' || public.chronology_year_label(hi_year)
  end;

  chron_json := jsonb_build_object(
    'era_key', era_key,
    'era_label', era_label,
    'date_label', date_label,
    'earliest_year', lo_year,
    'latest_year', hi_year
  );

  -- 2. Resolve active passages (including narrative settings, audience_location, and composition_location)
  with active_passages as materialized (
    select
      pg.id as passage_id,
      pg.passage_key,
      pg.title,
      pg.book,
      pg.start_chapter,
      pg.start_verse,
      pg.end_chapter,
      pg.end_verse,
      pg.place_id,
      pg.relationship_type,
      pg.resolution_tier,
      pg.confidence_level,
      pg.evidence_refs,
      pg.evidence_explanation,
      pg.source_id,
      ((pg.end_chapter - pg.start_chapter) * 200 + (pg.end_verse - pg.start_verse)) as span_length
    from public.passage_geography pg
    where pg.published
      and pg.book = p_book::smallint
      and (pg.start_chapter, pg.start_verse) <= (p_chapter::smallint, p_verse::smallint)
      and (p_chapter::smallint, p_verse::smallint) <= (pg.end_chapter, pg.end_verse)
    order by pg.resolution_tier asc, span_length asc, pg.id asc
    limit 8
  ),
  direct_links as materialized (
    select
      vg.id as link_id,
      vg.place_id,
      vg.relationship_type,
      vg.resolution_tier,
      vg.is_inferred,
      vg.confidence_level,
      vg.evidence_ref,
      vg.evidence_explanation,
      coalesce(vg.establishing_passage_id, ap.passage_id) as passage_id,
      coalesce(ap.title, null) as passage_title,
      coalesce(ap.evidence_refs, vg.evidence_ref) as establishing_refs,
      vg.source_id,
      1 as source_priority
    from public.verse_geography vg
    left join active_passages ap on ap.place_id = vg.place_id
    where vg.verse_id = vid and vg.published
  ),
  inherited_links as materialized (
    select
      null::bigint as link_id,
      ap.place_id,
      ap.relationship_type,
      ap.resolution_tier,
      not exists (select 1 from direct_links dl where dl.place_id = ap.place_id) as is_inferred,
      ap.confidence_level,
      ap.evidence_refs as evidence_ref,
      ap.evidence_explanation,
      ap.passage_id,
      ap.title as passage_title,
      ap.evidence_refs as establishing_refs,
      ap.source_id,
      2 as source_priority
    from active_passages ap
    where ap.place_id is not null
      and not exists (
        select 1 from direct_links dl
        where dl.place_id = ap.place_id
          and dl.relationship_type in (
            'event_location',
            'contextual_location',
            'audience_location',
            'composition_location',
            'travel_origin',
            'travel_destination'
          )
      )
  ),
  combined_candidates as materialized (
    select * from direct_links
    union all
    select * from inherited_links
  ),
  deduped_places as materialized (
    select distinct on (cc.place_id)
      cc.place_id,
      cc.relationship_type,
      cc.resolution_tier,
      cc.is_inferred,
      cc.confidence_level,
      cc.evidence_ref,
      cc.evidence_explanation,
      cc.passage_id,
      cc.passage_title,
      cc.establishing_refs,
      cc.source_id
    from combined_candidates cc
    order by
      cc.place_id,
      case cc.relationship_type
        when 'travel_origin' then 1
        when 'travel_destination' then 2
        when 'event_location' then 3
        when 'contextual_location' then 4
        when 'audience_location' then 5
        when 'composition_location' then 6
        when 'uncertain_location' then 7
        else 8
      end asc,
      cc.source_priority asc,
      cc.resolution_tier asc
  ),
  hydrated_places as materialized (
    select
      dp.place_id,
      p.place_key,
      p.biblical_name,
      coalesce(
        p.period_names->>era_key,
        case
          when era_key = 'roman_new_testament' and p.greek_name is not null then p.biblical_name || ' (' || p.greek_name || ')'
          when p.hebrew_name is not null then p.biblical_name || ' (' || p.hebrew_name || ')'
          when p.greek_name is not null then p.biblical_name || ' (' || p.greek_name || ')'
          else p.biblical_name
        end
      ) as ancient_name,
      p.historical_names,
      p.hebrew_name,
      p.greek_name,
      p.strongs_numbers,
      p.place_type,
      p.is_non_physical,
      p.external_ids,
      dp.relationship_type,
      dp.resolution_tier,
      dp.is_inferred,
      dp.confidence_level,
      dp.evidence_ref,
      dp.evidence_explanation,
      dp.passage_title,
      dp.establishing_refs,
      gs.dataset as source_dataset,
      gs.license as source_license,
      gs.attribution as source_attribution,
      primary_loc.id as primary_location_id,
      primary_loc.modern_name,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.latitude end as latitude,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.longitude end as longitude,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.geometry end as geometry,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.bbox end as bbox,
      case
        when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then 'none'
        when dp.confidence_level = 'regional' then 'approximate_region'
        else coalesce(primary_loc.precision_kind, 'none')
      end as precision_kind,
      case
        when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then 'unknown'
        when dp.confidence_level = 'regional' and primary_loc.location_status = 'established' then 'regional_only'
        else coalesce(primary_loc.location_status, 'unknown')
      end as location_status,
      coalesce(primary_loc.confidence_label, 'Symbolic or unknown location') as confidence_label,
      coalesce(primary_loc.raw_source_score, '{}'::jsonb) as raw_source_score,
      coalesce(primary_loc.evidence_summary, dp.evidence_explanation) as identification_evidence,
      coalesce(primary_loc.source_citations, '[]'::jsonb) as source_citations,
      coalesce(alts.alternatives, '[]'::jsonb) as alternative_locations,
      case dp.relationship_type
        when 'event_location' then 1
        when 'contextual_location' then 2
        when 'travel_origin' then 3
        when 'travel_destination' then 4
        when 'audience_location' then 5
        when 'composition_location' then 6
        when 'uncertain_location' then 7
        else 8
      end as role_rank
    from deduped_places dp
    join public.places p on p.id = dp.place_id and p.published
    join public.geography_sources gs on gs.id = dp.source_id and gs.published
    left join lateral (
      select pl.*
      from public.place_locations pl
      where pl.place_id = p.id and pl.published
      order by pl.rank_order asc, pl.id asc
      limit 1
    ) primary_loc on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', pl.id::text,
          'rank_order', pl.rank_order,
          'modern_name', pl.modern_name,
          'latitude', pl.latitude,
          'longitude', pl.longitude,
          'geometry', pl.geometry,
          'bbox', pl.bbox,
          'precision_kind', pl.precision_kind,
          'location_status', pl.location_status,
          'confidence_label', pl.confidence_label,
          'raw_source_score', pl.raw_source_score,
          'is_alternative', pl.is_alternative,
          'evidence_summary', pl.evidence_summary,
          'source_citations', pl.source_citations
        ) order by pl.rank_order asc, pl.id asc
      ) as alternatives
      from public.place_locations pl
      where pl.place_id = p.id and pl.published and pl.rank_order > 1
    ) alts on true
    order by role_rank asc, dp.resolution_tier asc, p.biblical_name asc
    limit 12
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'place_id', hp.place_id::text,
        'place_key', hp.place_key,
        'biblical_name', hp.biblical_name,
        'ancient_name', hp.ancient_name,
        'historical_names', hp.historical_names,
        'hebrew_name', hp.hebrew_name,
        'greek_name', hp.greek_name,
        'strongs_numbers', hp.strongs_numbers,
        'place_type', hp.place_type,
        'is_non_physical', hp.is_non_physical,
        'modern_name', hp.modern_name,
        'latitude', hp.latitude,
        'longitude', hp.longitude,
        'geometry', hp.geometry,
        'bbox', hp.bbox,
        'precision_kind', hp.precision_kind,
        'relationship_type', hp.relationship_type,
        'resolution_tier', hp.resolution_tier,
        'is_inferred', hp.is_inferred,
        'confidence_level', hp.confidence_level,
        'location_status', hp.location_status,
        'confidence_label', hp.confidence_label,
        'raw_source_score', hp.raw_source_score,
        'evidence_ref', hp.evidence_ref,
        'establishing_refs', hp.establishing_refs,
        'passage_title', hp.passage_title,
        'evidence_explanation', hp.evidence_explanation,
        'identification_evidence', hp.identification_evidence,
        'external_ids', hp.external_ids,
        'source_citations', hp.source_citations,
        'source', jsonb_build_object(
          'dataset', hp.source_dataset,
          'license', hp.source_license,
          'attribution', hp.source_attribution
        ),
        'alternative_locations', hp.alternative_locations
      ) order by hp.role_rank asc, hp.resolution_tier asc, hp.biblical_name asc
    ), '[]'::jsonb),
    coalesce(min(hp.resolution_tier) filter (where hp.relationship_type <> 'mentioned_location'), min(hp.resolution_tier)),
    bool_or(not hp.is_non_physical and (hp.latitude is not null or hp.geometry is not null)),
    bool_or(hp.is_non_physical or hp.confidence_level = 'symbolic_non_physical'),
    case
      when count(*) filter (where not hp.is_non_physical and hp.latitude is not null and hp.longitude is not null) > 0 then
        jsonb_build_array(
          min(coalesce(hp.bbox[1], hp.longitude)) filter (where not hp.is_non_physical and hp.longitude is not null),
          min(coalesce(hp.bbox[2], hp.latitude)) filter (where not hp.is_non_physical and hp.latitude is not null),
          max(coalesce(hp.bbox[3], hp.longitude)) filter (where not hp.is_non_physical and hp.longitude is not null),
          max(coalesce(hp.bbox[4], hp.latitude)) filter (where not hp.is_non_physical and hp.latitude is not null)
        )
      else null
    end
  into locations_json, top_tier, has_physical, has_non_physical, bounds_json
  from hydrated_places hp;

  -- 3. Build Era Gazetteer (contemporaneous ancient biblical places for the map background)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'place_key', g.place_key,
      'biblical_name', g.biblical_name,
      'ancient_name', g.ancient_name,
      'modern_name', g.modern_name,
      'place_type', g.place_type,
      'latitude', g.latitude,
      'longitude', g.longitude
    ) order by g.biblical_name asc
  ), '[]'::jsonb)
  into gazetteer_json
  from (
    select
      p.place_key,
      p.biblical_name,
      coalesce(p.period_names->>era_key, p.biblical_name) as ancient_name,
      pl.modern_name,
      p.place_type,
      pl.latitude,
      pl.longitude
    from public.places p
    join lateral (
      select loc.modern_name, loc.latitude, loc.longitude
      from public.place_locations loc
      where loc.place_id = p.id and loc.published and loc.latitude is not null and loc.longitude is not null
      order by loc.rank_order asc, loc.id asc
      limit 1
    ) pl on true
    where p.published
      and not p.is_non_physical
      and era_key = any(p.active_eras)
    limit 24
  ) g;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'passage_key', pg.passage_key,
      'title', pg.title,
      'book', pg.book,
      'start_chapter', pg.start_chapter,
      'start_verse', pg.start_verse,
      'end_chapter', pg.end_chapter,
      'end_verse', pg.end_verse,
      'relationship_type', pg.relationship_type,
      'resolution_tier', pg.resolution_tier,
      'confidence_level', pg.confidence_level,
      'evidence_refs', pg.evidence_refs,
      'evidence_explanation', pg.evidence_explanation
    ) order by pg.resolution_tier asc, pg.id asc
  ), '[]'::jsonb)
  into passages_json
  from public.passage_geography pg
  where pg.published
    and pg.book = p_book::smallint
    and (pg.start_chapter, pg.start_verse) <= (p_chapter::smallint, p_verse::smallint)
    and (p_chapter::smallint, p_verse::smallint) <= (pg.end_chapter, pg.end_verse);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'source_key', gs.source_key,
      'dataset', gs.dataset,
      'version', gs.version,
      'license', gs.license,
      'attribution', gs.attribution,
      'locator', gs.locator
    ) order by gs.id asc
  ), '[]'::jsonb)
  into sources_json
  from public.geography_sources gs
  where gs.published;

  res_status := case
    when coalesce(has_physical, false) then
      case top_tier
        when 1 then 'direct_event_location'
        when 2 then 'passage_context'
        when 3 then 'event_metadata'
        else 'regional_context'
      end
    when coalesce(has_non_physical, false) then 'symbolic_non_physical'
    else 'unknown'
  end;

  response := jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'passage', jsonb_build_object(
      'book', p_book,
      'chapter', p_chapter,
      'verse', p_verse,
      'is_heading', p_verse = 0
    ),
    'chronological_context', chron_json,
    'resolution_status', res_status,
    'has_physical_location', coalesce(has_physical, false),
    'message', case
      when coalesce(has_physical, false) then null
      when coalesce(has_non_physical, false) then 'No reliable geographical location identified for this verse (symbolic or heavenly setting).'
      else 'No reliable geographical location identified for this verse.'
    end,
    'bounds', bounds_json,
    'locations', coalesce(locations_json, '[]'::jsonb),
    'era_gazetteer', coalesce(gazetteer_json, '[]'::jsonb),
    'passage_contexts', coalesce(passages_json, '[]'::jsonb),
    'sources', coalesce(sources_json, '[]'::jsonb)
  );

  if octet_length(response::text) > 51200 then
    return jsonb_build_object('schema_version', 1, 'status', 'packet_limit_exceeded');
  end if;

  return response;
end
$rpc$;

notify pgrst, 'reload schema';
`;

await fs.writeFile('supabase/migrations/20261101183000_geography_composition_and_era.sql', sql);
console.log(`Generated migration with ${passageContexts.length} curated passages and ${eraGazetteerEntries.length} era gazetteer places.`);
