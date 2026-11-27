# D4 Research Report: Prophetic Narrative Reversals and Cosmic Motifs — Jonah 1–4, Psalm 107, and Matthew 12:38–42

**Research Task (D4):** Analyze Jonah 1–4 (the deep, plant, worm, east wind, forty days, and compassion) alongside Psalm 107 and Matthew 12:38–42, surfacing recurring motifs, wordplay, contrasts, and intermediate bridges.

**Epistemic Method:** Every verse reference, Strong's ID, Hebrew/Aramaic/Greek form, LXX alignment, occurrence count, and statistical metric below comes directly from the 18 BibleResearch MCP tool calls logged to `research/v3/opt-cycle2/local_D4.jsonl`. Textual attestations, grammatical/lexical derivations, structural/rhetorical parallels, wordplay cues, editorial cross-references, and interpretive syntheses are kept strictly distinct.

---

## 1. Execution Log: Exact Calls, Latencies, and Payload Sizes

| # | Tool | Key Arguments / Target | Latency (ms) | Wire Bytes | Payload Bytes | Status |
|---:|---|---|---:|---:|---:|---|
| 1 | `get_prompt` | `{}` | 2,667 | 5,530 | 5,338 | `ok` |
| 2 | `get_Passage` | `Jonah 1-2` (`depth:3, literary:2, realworld:1, limit:35`) | 14,279 | 135,738 | 119,870 | `ok` |
| 3 | `get_Passage` | `Jonah 3-4` (`depth:3, literary:1, realworld:0, limit:30`) | 13,500 | 10,293 | 9,087 | `ok` |
| 4 | `get_Passage` | `Ps 107` (`depth:3, literary:1, realworld:0, limit:40`) | 7,615 | 12,800 | 11,200 | `ok` |
| 5 | `get_Passage` | `Matt 12:38-42` (`depth:5, word_depth:2, literary:2, realworld:1`) | 14,684 | 39,210 | 34,862 | `ok` |
| 6 | `get_Connection` | `["Jonah 1-4","Psalms 107","Matthew 12:38-42"]` (`connections:20`) | 19,043 | 5,026 | 4,362 | `ok` |
| 7 | `research` | 7 ops: `wordplay_scan(Jonah 1-4)`, `sequence_parallels` ×2, `lxx_concordance` ×2 (`Jonah 3:4`, `Jonah 1:17`), `tri_textual_diff(Matt 12:40)`, `literary_structure(Ps 107, deep/standard, compare_lxx)` | 8,321 | 173,512 | 153,542 | `ok` |
| 8 | `research` | 5 ops: `wordplay_scan(Jonah 3:6-4:11)`, `wordplay_scan(Ps 107:23-43)`, `lxx_concordance(Jonah 4:6-11)`, `tri_textual_diff(Matt 12:41)`, `literary_structure(Jonah 3-4, deep, compare_lxx)` | 9,135 | 192,857 | 167,795 | `ok` |
| 9 | `research` | 8 ops: `occurrences` (`H8367`, `H7021`, `H8438`, `H6921`, `H4487`), `intersect_words` (`H2587+H7349+H5162`, `H3220+H5591+H7307`, `H5848+H5315`) | 14,901 | 92,571 | 86,965 | `ok` |
| 10 | `follow_connectionchain` | Seed `Jonah 2:5` (`limit:8`) | 5,906 | 6,230 | 5,490 | `ok` |
| 11 | `follow_connectionchain` | `action:"follow"`, `next:"Psalms 106:9"` (`limit:8`) | 7,247 | 6,604 | 5,874 | `ok` |
| 12 | `get_Word` | `H7021` (`קִיקָיוֹן`, `etymology:3, realworld:1, connections:8`) | 2,005 | 4,301 | 3,737 | `ok` |
| 13 | `get_Word` | `H8415` (`תְּהוֹם`, `etymology:3, realworld:1, connections:10`) | 1,622 | 4,407 | 3,833 | `ok` |
| 14 | `research` | 8 ops: `set_combine` ×4 (`H7307+H5591`, `H3820+H3220`, `H0705+H3117`, `H4688`), `clause_role_query(H2347)`, `trace_evidence(Jonah 4:2->Joel 2:13)`, `expand_clue(r12:scene:22680:30976)`, `occurrences(G2785)` | 7,527 | 114,190 | 102,494 | `ok` (`trace_evidence` `partial`) |
| 15 | `get_Passage` | `Psalms 107:41-43` (`depth:2, literary:0, realworld:0`) | 9,481 | 5,386 | 4,618 | `ok` |
| 16 | `get_Passage` | `1 Kings 19:4-13` (`depth:3, literary:1, realworld:0`) | 8,402 | 7,627 | 6,697 | `ok` |
| 17 | `get_Passage` | `Joel 2:12-14` (`depth:3, literary:0, realworld:0`) | 5,826 | 6,778 | 5,904 | `ok` |
| 18 | `get_Connection` | `["Jonah 4:2-8","1 Kings 19:4-12","Joel 2:12-14","Psalms 107:23-32"]` (`connections:15`) | 10,935 | 5,293 | 4,547 | `ok` (`3/4` connected) |
| **Total** | **18 calls** | **All 6 read/research tools exercised** | **163,096 ms** (avg 9,061 ms) | **833,353** | **736,215** | **18/18 completed** |

*(Note: A pre-run `--list-tools` schema discovery check returned 17,028 wire bytes in 1,874 ms and was excluded from the logged 18-call session.)*

---

## 2. Structural Architecture of the Three Primary Texts

### A. Jonah 1–4 (48 Verses)
`get_Passage` (`literary:2` on chs. 1–2; `literary:1` on chs. 3–4) and `research` (`literary_structure` on chs. 3–4) reveal a tightly symmetrical two-halved narrative driven by **divine appointment (`מָנָה` H4487)**, **vertical descent/ascent (`יָרַד` H3381 vs. `עָלָה` H5927)**, **turning (`שׁוּב` H7725 / `הָפַךְ` H2015)**, and **reversal of insider/outsider responses**:
1. **Chs. 1–2 (Flight, Sea Storm, and Descent into the Deep):**
   - `Jonah 1:1–9`: Commission (`קוּם לֵךְ אֶל־נִינְוֵה`, 1:2) → Flight/Descent (`יָרַד` to Joppa, into the ship, into the innermost hold, 1:3, 5) → Yahweh hurls (`טוּל` H2904) a great wind (`רוּחַ גְּדוֹלָה`) and great storm (`סַעַר גָּדוֹל`, 1:4) → Pagan sailors fear and cry out (`וַיִּזְעֲקוּ`) while Jonah sleeps (`רָדַם` H7290).
   - `Jonah 1:10–16`: Sailors' escalating `יִרְאָה גְדוֹלָה` ("exceedingly afraid", 1:10, 16) → Jonah thrown into the sea (`יָם`), which ceases its raging (`וַיִּשְׁתֹּק הַיָּם`, `שָׁתַק` H8367, 1:11–12, 15) → Sailors sacrifice and vow to Yahweh (1:16).
   - `Jonah 1:17–2:10` (MT `2:1–11`): Yahweh appoints (`וַיְמַן` H4487) a great fish (`דָּג גָּדוֹל`) to swallow (`לִבְלֹעַ` H1104) Jonah for three days and three nights (`שְׁלֹשָׁה יָמִים וּשְׁלֹשָׁה לֵילוֹת`, 1:17) → Prayer from the belly of Sheol (`שְׁאוֹל` H7585) and the deep (`מְצוּלָה` H4688, `תְּהוֹם` H8415, 2:2–6) → When his soul faints (`בְּהִתְעַטֵּף עָלַי נַפְשִׁי`, 2:7), he vows thanksgiving (`זֶבַח תּוֹדָה`, 2:9) → Fish vomits (`וַיָּקֵא` H6958) Jonah onto dry land (`יַבָּשָׁה` H3004, 2:10).
2. **Chs. 3–4 (Re-commission, Nineveh's Repentance, and Jonah's Anger Outside the City):**
   - `Jonah 3:1–10`: Second commission (`שֵׁנִית`, 3:1) → 3-day city / 1-day walk / 40-day oracle (`עוֹד אַרְבָּעִים יוֹם וְנִינְוֵה נֶהְפָּכֶת`, 3:4) → Immediate Gentile faith (`וַיַּאֲמִינוּ`), fasting (`צוֹם`), sackcloth (`שַׂק`), and turning (`שׁוּב`) from evil (`רָעָה`, 3:5–9) → God sees and relents (`וַיִּנָּחֶם` H5162, 3:10).
   - `Jonah 4:1–11`: Jonah's great evil/displeasure (`וַיֵּרַע ... רָעָה גְדוֹלָה`, 4:1) → Cites the Exodus/Joel grace creed (`חַנּוּן וְרַחוּם ... וְנִחָם עַל הָרָעָה`, 4:2) and asks to die (4:3) → Sits east of the city under a booth (`סֻכָּה`) → Threefold `מָנָה` (H4487) pedagogy: plant (`קִיקָיוֹן` H7021, 4:6) → worm at dawn (`תּוֹלַעַת` H8438, 4:7) → sultry east wind (`רוּחַ קָדִים חֲרִישִׁית`, 4:8) → Yahweh contrasts Jonah's unlabored pity (`חַסְתָּ` H2347) for an ephemeral plant with divine pity (`אָחוּס`) for Nineveh's 120,000+ inhabitants and livestock (4:10–11).

### B. Psalm 107 (43 Verses; LXX Psalm 106)
`literary_structure` (`confidence: 0.98`, `mdl_savings_bits: 43.85`) identifies **four phase-shifted rescue cycles** (`vv. 1–9`, `10–16`, `17–22`, `23–32`) anchored by the dual refrain (`וַיִּזְעֲקוּ אֶל־יְהוָה בַּצַּר לָהֶם מִמְּצוּקוֹתֵיהֶם` ... `יוֹדוּ לַיהוָה חַסְדּוֹ וְנִפְלְאוֹתָיו לִבְנֵי אָדָם`), followed by **cosmic/socio-ecological reversals** (`vv. 33–42`, turning rivers into desert/salt waste for wickedness and desert into water-pools/habitable cities, lifting the needy while shutting the mouth of injustice) and a **wisdom invitation** (`v. 43`, `מִי חָכָם וְיִשְׁמָר אֵלֶּה וְיִתְבּוֹנְנוּ חַסְדֵי יְהוָה`).

### C. Matthew 12:38–42 (5 Verses)
`get_Passage` (`literary:2`) segments the pericope into four units: (1) Sign demand by scribes/Pharisees (`σημεῖον ἰδεῖν`, v. 38); (2) Counter-indictment of an "evil and adulterous generation" (`γενεὰ πονηρὰ καὶ μοιχαλίς`) given only "the sign of Jonah the prophet" (`τὸ σημεῖον Ἰωνᾶ τοῦ προφήτου`), defined by the 3-day/3-night descent into `κῆτος` // "heart of the earth" (`ἐν τῇ καρδίᾳ τῆς γῆς`, vv. 39–40); (3) Gentile Ninevites rising in judgment (`ἐν τῇ κρίσει`) to condemn (`κατακρινοῦσιν`, G2632) this generation because they repented (`μετενόησαν`) at Jonah's preaching (`κήρυγμα`), and "something greater than Jonah is here" (`πλεῖον Ἰωνᾶ ὧδε`, v. 41); (4) The Queen of the South (`Βασίλισσα νότου`) rising in judgment to condemn it, having come from the ends of the earth to hear Solomon's wisdom (`σοφίαν Σολομῶνος`), and "something greater than Solomon is here" (`πλεῖον Σολομῶνος ὧδε`, v. 42).

---

## 3. Motif-by-Motif Original-Language Analysis

### 1. The Deep, Sea Storm, and Descent (`יָם`, `מְצוּלָה`, `תְּהוֹם`, `שְׁאוֹל`, `סוּף`, `κῆτος`)
* **Attested Textual Evidence:**
  - `Jonah 2:3` (2:4 MT) pairs `מְצוּלָה` (H4688, "deep") with `בִּלְבַב יַמִּים` (`H3824` + `H3220`, "heart of the seas"). `set_combine(H4688)` proves `מְצוּלָה` occurs in **only 11 verses** across the OT: `Exod 15:5`, `Neh 9:11`, `Job 41:31`, `Ps 68:22`, `Ps 69:2`, `Ps 69:15`, `Ps 88:6`, `Ps 107:24`, `Jonah 2:3`, `Mic 7:19`, and `Zech 10:11`.
  - `Jonah 2:5` (2:6 MT) pairs `תְּהוֹם` (H8415, "abyss" — rendered by LXX as `ἄβυσσος` G0012 in 19/24 passages per `get_Word(H8415)`) with `סוּף` (H5488, "reeds/weeds", the same noun as `יַם סוּף`, Sea of Reeds).
  - `Jonah 2:7` (2:8 MT) shares the exact 2-lemma idiom `עָטַף` (H5848, "faint/swoon") + `נֶפֶשׁ` (H5315, "soul") with **only 3 other verses in the OT** (`intersect_words`): `Ps 107:5` (`נַפְשָׁם בָּהֶם תִּתְעַטָּף`), `Lam 2:12`, and `Lam 2:19`.
  - `Jonah 1:11, 12` shares the rare verb `שָׁתַק` (H8367, "become quiet/calm") with `Ps 107:30` (`וַיִּשְׂמְחוּ כִי־יִשְׁתֹּקוּ`) — **3 of the only 4 occurrences** in the entire OT (the 4th is `Prov 26:20`).
  - `Jonah 1:4` and `Ps 107:25` both deploy `רוּחַ` (H7307) + `סְעָרָה/סַעַר` (H5591, "storm/stormy wind") — `set_combine(H7307, H5591)` finds only 8 verses (`Ps 55:8; 107:25; 148:8; Isa 41:16; Ezek 1:4; 13:11, 13; Jonah 1:4`).
  - `Matthew 12:40` (`tri_textual_diff`) quotes LXX Jonah 2:1 (1:17 MT) verbatim for `ἐν τῇ κοιλίᾳ τοῦ κήτους τρεῖς ἡμέρας καὶ τρεῖς νύκτας` (preserving the NT hapax `κῆτος` G2785, `occurrences(G2785) = 1`), and transforms `בִּלְבַב יַמִּים` ("heart of the seas", Jonah 2:3; LXX `καρδίας θαλασσῶν`) / `שְׁאוֹל` (2:2) / `קִצְבֵי הָרִים` ("bottoms of the mountains", 2:6) into `ἐν τῇ καρδίᾳ τῆς γῆς` ("in the heart of the earth").
* **Statistical Negative Control:** `sequence_parallels` between `Jonah 1–2` and `Ps 107:23–32` returned `raw_score = 5.58`, `p_null = 0.6154` (`evidence_bits = 0`). Thus the link between Jonah 1–2 and Ps 107:23–32 is **shared rare-lemma vocabulary and motif architecture**, not a rigid clause-by-clause syntactic copy.

### 2. The Plant (`קִיקָיוֹן` H7021 / `κολοκύνθη`)
* **Attested Evidence:** `H7021` occurs **only 4 times in the OT**, all in `Jonah 4:6, 7, 9, 10` (`occurrences(H7021)`). It is the second object Yahweh appoints (`וַיְמַן` H4487) in Jonah, rising (`עָלָה` H5927) to provide shade (`צֵל` H6738) and deliver Jonah from his distress/evil (`לְהַצִּיל לוֹ מֵרָעָתוֹ`, 4:6).
* **LXX & Lexical Bridges:**
  - LXX renders `קִיקָיוֹן` as `κολοκύνθη/κολόκυνθα` ("gourd"), and renders `לְהַצִּיל לוֹ מֵרָעָתוֹ` ("to deliver him from his evil/discomfort") as `τοῦ σκιάζειν αὐτῷ ἀπὸ τῶν κακῶν αὐτοῦ` ("to shade him from his evils", `lxx_concordance(Jonah 4:6)`).
  - `get_Word(H7021)` reports a STEPBible/OpenScriptures lexical link to root `קָיָה` (`H7006`, "to vomit") and `wordplay_scan` flags phonetic/consonantal overlap with `יוֹנָה` (`H3124`, shared `יונ`, `formal_score = 0.667`). Historically/botanically, `קִיקָיוֹן` is widely compared to Egyptian *kiki* (castor-oil plant, an interpretive/comparative note), while within Jonah's Hebrew soundscape it creates an ironic echo between the fish's vomiting (`וַיָּקֵא`, `H6958`, 2:10), the `קִיקָיוֹן` (4:6), and `יוֹנָה` himself.

### 3. The Worm (`תּוֹלַעַת` / `תּוֹלֵעָה` H8438 / `σκώληξ`)
* **Attested Evidence:** In `Jonah 4:7`, Yahweh appoints (`וַיְמַן`) a worm (`תּוֹלַעַת`, LXX `σκώληξ`) at the rising of dawn (`בַּעֲלוֹת הַשַּׁחַר`) the next day; it strikes (`וַתַּךְ`, `נָכָה` H5221, LXX `πατάσσω`) the `קִיקָיוֹן`, and it withers (`וַיִּיבָשׁ`, `יָבֵשׁ` H3001, LXX `ἀποξηραίνω`, `p_g_given_h = 0.0714, g_idf = 12.9`).
* **Intermediate Bridges (`occ_tolaat`, 43 OT verses):**
  - `Exod 16:20`: Leftover manna kept `עַד־בֹּקֶר` ("until morning") breeds `תּוֹלָעִים` ("worms") and Moses grows angry (`וַיִּקְצֹף`). Both passages pair **unearned miraculous provision**, **overnight decay at dawn by `תּוֹלַעַת`**, and **prophetic/human anger**.
  - `Deut 28:39`: Covenant curse where vineyards planted and tended are eaten by `הַתֹּלָעַת` (a direct foil to Jonah 4:10, where Jonah *did not labor* on the plant).
  - `Ps 22:6` (22:7 MT), `Isa 41:14`, `Isa 14:11`, `Isa 66:24`: `תּוֹלַעַת` spans lowly human frailty (`Ps 22:6`, `Isa 41:14`) and eschatological/Sheol decay (`Isa 14:11`, `66:24`).

### 4. The East Wind (`רוּחַ קָדִים חֲרִישִׁית` H7307 + H6921 + H2759 / `πνεῦμα καύσωνος συγκαίοντι`)
* **Attested Evidence:** In `Jonah 4:8`, God appoints (`וַיְמַן`) a `רוּחַ קָדִים חֲרִישִׁית` (with `H2759` `חֲרִישִׁי` as a biblical hapax legomenon, rendered by LXX `καύσωνι συγκαίοντι`, "burning/scorching east wind", `lxx_concordance`). The sun strikes (`נָכָה` H5221 — repeating the worm's verb!) Jonah's head so he faints (`וַיִּתְעַלָּף` H5968, LXX `ὀλιγοψυχέω`).
* **Intermediate Bridges (`occ_qadim`, 64 OT verses):**
  - **Psalms 48:7 (48:8 MT):** `בְּרוּחַ קָדִים תְּשַׁבֵּר אֳנִיּוֹת תַּרְשִׁישׁ` ("With the east wind you shatter the ships of Tarshish") — a remarkable intermediate bridge linking `Jonah 1:3–4` (flight in a Tarshish ship nearly breaking `לְהִשָּׁבֵר` in a great wind) with `Jonah 4:8` (`רוּחַ קָדִים`)!
  - **Ezekiel 27:26:** `רוּחַ הַקָּדִים שְׁבָרֵךְ בְּלֵב יַמִּים` ("The east wind has broken you in the heart of the seas") — directly bridges Tyre's Tarshish-shipwreck (`Ezek 27:25–27`) with Jonah's `בִּלְבַב יַמִּים` (2:3) and `רוּחַ קָדִים` (4:8)!
  - **Ezekiel 17:10; 19:12:** `רוּחַ הַקָּדִים` touches and withers (`תִּיבַשׁ` / `הוֹבִישׁ`) a planted vine, mirroring the withering of Jonah's `קִיקָיוֹן` (4:7–8).
  - **Exodus 10:13; 14:21:** Yahweh uses `רוּחַ קָדִים` to bring locusts and turn the sea into `חָרָבָה` (dry land).
  - **1 Kings 19:11–12 (`get_Passage`):** Contrasts a great strong wind (`רוּחַ גְּדוֹלָה וְחָזָק`) with `קוֹל דְּמָמָה דַקָּה` (`H1827` `דְּמָמָה`, stillness/calm — the exact rare noun used in `Ps 107:29`, `יָקֵם סְעָרָה לִדְמָמָה`, "he turns the storm to a calm"!).

### 5. Forty Days (`אַרְבָּעִים יוֹם` H0705 + H3117) vs. Three Days (`τρεῖς ἡμέραι`)
* **Attested MT vs. LXX Divergence (`lxx_concordance(Jonah 3:4)`):**
  - **MT Jonah 3:4:** `עוֹד אַרְבָּעִים יוֹם וְנִינְוֵה נֶהְפָּכֶת` ("Yet **forty** days, and Nineveh will be overturned").
  - **LXX Jonah 3:4:** `ἔτι τρεῖς ἡμέραι καὶ Νινευη καταστραφήσεται` ("Yet **three** days, and Nineveh will be overturned") — flagged by `lxx_concordance` as `lexical_theological_shift` (`p_g_given_h = 0.0073`, `g_idf = 6.51`).
* **Theological & Canonical Significance (`sc_40_days`):**
  - In MT, `עוֹד אַרְבָּעִים יוֹם` echoes `Gen 7:4` (`לְיָמִים עוֹד שִׁבְעָה ... אַרְבָּעִים יוֹם`, flood judgment) and `Exod 34:28` / `Deut 9:9, 18, 25` / `1 Kgs 19:8` (40 days of covenant fasting/intercession for a rebellious people!).
  - In LXX, shifting 40 days to **3 days** aligns Nineveh's reprieve with Jonah's **3 days and 3 nights** in the `κῆτος` (Jonah 1:17 / 2:1 LXX) and Nineveh's **3-day breadth** (Jonah 3:3), which prepares directly for Jesus' focus on the **three days and three nights** ("sign of Jonah") and Nineveh's repentance in **Matthew 12:40–41**!

### 6. Compassion, Relenting, and Pity (`חַנּוּן וְרַחוּם`, `נָחַם`, `חוּס`)
* **Attested Evidence (`int_grace_relent`, `cr_chush`):**
  - `Jonah 4:2` shares the exact three-lemma triad `חַנּוּן` (H2587) + `רַחוּם` (H7349) + `נִחָם` (H5162, "relent") with **only one other verse in the entire OT**: `Joel 2:13` (`intersect_words`), and both contexts share the rhetorical question `מִי יוֹדֵעַ יָשׁוּב וְנִחַם` ("Who knows? He may turn and relent", `Joel 2:14` ↔ `Jonah 3:9`). (Related Exodus 34:6 / Ps 86:15 lack `וְנִחָם עַל הָרָעָה`, as confirmed by `trace_evidence` surfacing `Jonah 4:2 ↔ Ps 86:15` without `H5162`.)
  - `Jonah 4:10–11` shifts to the verb `חוּס` (`H2347`, "have pity/spare", LXX `φείδομαι`). `clause_role_query(H2347)` demonstrates that in Deuteronomic and Ezekielian legal/judgment prose (`Deut 7:16; 13:8; 19:13, 21; 25:12; Ezek 5:11; 7:4, 9`), `חוּס` appears almost exclusively with **negative polarity** (`לֹא תָחוֹס עֵינְךָ`, "your eye shall not pity"). Jonah 4:11 (`וַאֲנִי לֹא אָחוּס`) uses a rhetorical double negative to **invert** Deuteronomic non-pity into universal divine compassion!

---

## 4. Wordplay, Double Entendres, and Structural Contrasts

| Mechanism | Textual Location | Original Forms & Data | Literary / Thematic Force |
|---|---|---|---|
| **Syntactic talion (voice flip)** | `Jonah 1:7` | `וְנַפִּילָה` / `וַיַּפִּלוּ` (H5307 Hiphil) → `וַיִּפֹּל` (H5307 Qal; `wordplay_scan` score 0.97–0.98) | Sailors actively cast lots; the lot passively/inexorably falls on Jonah. |
| **Polyptoton on "turn"** | `Jonah 3:9` | `יָשׁוּב` (impf.) → `וְשָׁב` (perf. `H7725`; `wordplay_scan` score 0.86) | Mirrors human turning (`שׁוּבוּ`, 3:8) with divine turning from fierce anger (`שָׁב`, 3:9). |
| **Double entendre on `הָפַךְ`** | `Jonah 3:4` | `נֶהְפָּכֶת` (H2015 Niphal ptc.) | Means either "overthrown" in destruction (Sodom motif) or "overturned/transformed" in repentance (which occurs in 3:5–10). |
| **Consonantal/phonetic plays** | `Jonah 1:5`; `1:7`; `1:14`; `4:6` | `יָרַד` / `וַיֵּרָדַם` (`ירד`, 0.867); `רֵעֵהוּ` / `הָרָעָה` (`רעה`, 0.907); `אֶל` / `אַל` (`אל`, 0.995); `קִיקָיוֹן` / `יוֹנָה` (`יונ`, 0.667) + `קָיָה`/`קִיא` (`H7006`/`H6958`) | Physical descent into sleep mirrors spiritual flight; neighbor vs. calamity; prayer *to* (`אֶל`) Yahweh *not* (`אַל`) to destroy; plant echoes both the fish's vomiting and Jonah's own name. |
| **Key-word inversion on `רָעָה` & `גָּדוֹל`** | `Jonah 1–4` | `גָּדוֹל` (H1419) + `רָעָה` (H7451) | Nineveh's `רָעָה` (1:2; 3:8, 10) is pardoned when God relents of `הָרָעָה` (3:10; 4:2); Jonah then feels `רָעָה גְדוֹלָה` (4:1), asks delivery from `רָעָתוֹ` (4:6), and rejoices `שִׂמְחָה גְדוֹלָה` over a tiny plant while angry at `נִינְוֵה הָעִיר הַגְּדוֹלָה` (4:11). |
| **Structural wordplay chain in Ps 107** | `Ps 107:41–43` | `וַיָּשֶׂם` (`H7760`) → `יְשָׁרִים` (`H3477`) → `וְיִשְׂמָחוּ` (`H8055`) → `וְיִשְׁמָר` (`H8104`) (`wp_ps107_sea`, score 0.707–0.867) | Alliterative `ישמ`/`ישר` cascade links God's societal reversal (`שׂים`), the upright's joy (`שׂמח`), and wise observance (`שׁמר`). |

### Core Contrasts Across Jonah 1–4, Psalm 107, and Matthew 12:38–42
1. **Direction of Reversal (Psalm 107 vs. Jonah):** In Psalm 107, Yahweh summons the storm (`107:25`) so terrified sailors' "wisdom is swallowed up" (`תִּתְבַּלָּע`, `107:27`), hears their cry (`107:28`), brings the storm to stillness (`לִדְמָמָה ... כִּי יִשְׁתֹּקוּ`, `107:29–30`), and ends with joyful uprightness (`107:42–43`). In Jonah, pagan sailors and Ninevites follow the Psalm 107 pattern (cry → rescue → sacrifice/vows/repentance), whereas the *Hebrew prophet himself* is swallowed (`לִבְלֹעַ`, `1:17`), moves from thanksgiving (ch. 2) back into wilderness despair, scorching wind, and death-wish (ch. 4) — an **inverted Psalm 107** inside Israel's own prophet.
2. **Gentile Repentance vs. Covenant Hardening (Jonah → Matthew 12:38–42):** Matthew 12:38–42 universalizes Jonah's irony: the scribes/Pharisees demand a `σημεῖον` while missing the `πλεῖον Ἰωνᾶ` and `πλεῖον Σολομῶνος` standing before them; meanwhile pagan Nineveh (who repented at Jonah's `κήρυγμα`) and the Queen of the South (`ἐκ τῶν περάτων τῆς γῆς`, recalling Ps 107:3's gathering from the four compass points and Ps 107:43's `מִי חָכָם`) rise in eschatological judgment to condemn (`κατακρινοῦσιν`) "this generation."

---

## 5. Verified Intermediate Bridges

1. **1 Kings 19:4–13 (Elijah Bridge — `get_Passage`, `get_Connection`):**
   - Exact verbal match with Jonah 4:8: `וַיִּשְׁאַל אֶת־נַפְשׁוֹ לָמוּת` ("requested for himself that he might die", `1 Kgs 19:4` ↔ `Jonah 4:8`), plus `קַח נַפְשִׁי` ("take my life", `1 Kgs 19:4` ↔ `Jonah 4:3`), sitting under a shade plant (`רֹתֶם` vs. `סֻכָּה`/`קִיקָיוֹן`), a day's journey (`דֶּרֶךְ יוֹם`, `1 Kgs 19:4` ↔ `Jonah 3:4`), second command (`שֵׁנִית` + `קוּם`, `1 Kgs 19:7` ↔ `Jonah 3:1–2`), 40 days (`1 Kgs 19:8` ↔ `Jonah 3:4`), and `רוּחַ גְּדוֹלָה` followed by `דְּמָמָה` (`H1827`, `1 Kgs 19:11–12` ↔ `Ps 107:29`).
2. **Joel 2:12–14 (Grace & Relenting Bridge — `intersect_words`, `get_Passage`):**
   - Only other verse in OT sharing `חַנּוּן + רַחוּם + נִחָם` (`Joel 2:13` ↔ `Jonah 4:2`), paired with `צוֹם` ("fasting", `Joel 2:12` ↔ `Jonah 3:5`) and `מִי יוֹדֵעַ יָשׁוּב וְנִחָם` (`Joel 2:14` ↔ `Jonah 3:9`).
3. **Psalms 106:9 & Exodus 14:21 / 15:5–8 (Reed Sea / Abyss Bridge — `follow_connectionchain`, `set_combine`):**
   - `follow_connectionchain` linked `Jonah 2:5` (`סוּף` + `תְּהוֹם`) → `Ps 106:9` (immediately preceding Ps 107 in Book V of the Psalter!), and `Ps 106:9` → `Isa 51:10` and `Nah 1:4` (Nineveh judgment oracle!). `Exod 15:5, 8` similarly shares `תְּהֹמֹת` + `יָרְדוּ` + `מְצוֹלֹת` + `בְּלֶב־יָם` with `Jonah 2:3, 5–6`.
4. **Psalms 48:7 (48:8 MT) & Ezekiel 27:25–26 (Tarshish + East Wind + Heart of Seas Bridge — `occ_qadim`, `sc_heart_sea`):**
   - `Ps 48:7`: `בְּרוּחַ קָדִים תְּשַׁבֵּר אֳנִיּוֹת תַּרְשִׁישׁ` connects Jonah's Tarshish flight/ship-breaking (1:3–4) directly to the east wind (`4:8`). `Ezek 27:25–26` unites `אֳנִיּוֹת תַּרְשִׁישׁ`, `רוּחַ הַקָּדִים`, and `בְּלֵב יַמִּים`.
5. **Exodus 16:20 & Lamentations 2:12, 19 (`occ_tolaat`, `int_faint_soul`):**
   - `Exod 16:20` bridges the morning worm (`תּוֹלַעַת`) + anger over miraculous provision; `Lam 2:12, 19` shares `עָטַף + נֶפֶשׁ` exclusively with `Jonah 2:7` and `Ps 107:5`.
6. **Micah 7:19 & Psalms 68:22; 69:2, 15 (`sc_metsulah`):**
   - `Mic 7:19` flips `Jonah 2:3` (`וַתַּשְׁלִיכֵנִי מְצוּלָה`, "you cast me into the deep") into salvation: "you will cast (`תַשְׁלִיךְ`) all their sins into the depths (`בִּמְצֻלוֹת`) of the sea."

---

## 6. Honest 8-Question System Evaluation

### Q1. Tool Selection & Workflow Ergonomics
The 6-tool + `get_prompt` architecture (`get_Passage`, `get_Word`, `get_Connection`, `follow_connectionchain`, `research`, `write_Note`) is well-organized and intuitive. `get_prompt` gave clear progressive workflow rules (`Passage -> Word -> Clues -> Bridges -> v3 Ops -> expand_clue`), and batching up to 8 heterogeneous operations inside `research` (`occurrences`, `intersect_words`, `set_combine`, `lxx_concordance`, `tri_textual_diff`, `wordplay_scan`, `sequence_parallels`, `literary_structure`, `clause_role_query`) dramatically reduced round-trips.

### Q2. Retrieval Precision & Original-Language Grounding
Overall lexical, morphological, and LXX grounding is very strong. Token-level alignments (`lxx_concordance` on Jonah 1:17, 3:4, 4:6–11; `tri_textual_diff` on Matt 12:40), exact occurrence counts (`H8367` = 4, `H7021` = 4, `H5848+H5315` = 4, `H2587+H7349+H5162` = 2, `H4688` = 11, `G2785` = 1), and MACULA syntactic polarity (`clause_role_query` on `H2347`) provided rock-solid primary evidence. However, several ranking/alignment quirks were observed (detailed in Q6).

### Q3. Payload Size, Progressive Detail, & Latency
Using default `view="clues"` with `literary:1, realworld:0` kept `get_Passage` payloads crisp (`5.3–12.8 KB` wire). Conversely, requesting `literary:2, realworld:1` on `Jonah 1–2` inflated wire size to `135.7 KB` (`119.9 KB` payload), and batching `literary_structure(detail:"deep")` + `wordplay_scan` + `lxx_concordance` in `research` produced `173–193 KB` wire responses. Total session latency across 18 calls was `163.1 s` (mean `9.06 s/call`; fastest `get_Word` at `1.6–2.0 s`, slowest `get_Connection` at `19.0 s`). Progressive detail works well when `literary` is kept at `0–1` during initial sweeps.

### Q4. Discovery of Non-Obvious Bridges & Statistical Calibration (`e_perp`, `p_null`)
Very strong. `follow_connectionchain` from `Jonah 2:5` immediately surfaced `Psalms 106:9` (`H5488 + H8415`) and from there `Isaiah 51:10` and `Nahum 1:4`. `set_combine`, `intersect_words`, and `occurrences` surfaced `Joel 2:13`, `Psalms 48:7`, `Ezekiel 27:26`, `Lamentations 2:12, 19`, `Exodus 16:20`, and `Micah 7:19`. `sequence_parallels` provided honest statistical calibration (`p_null = 0.6154` for `Jonah 1-2` vs. `Ps 107:23-32` and `p_null = 0.9231` for `Jonah 1:17-3:10` vs. `Matt 12:38-42`), preventing over-claiming of syntactic sequence dependence where the bond is lexical/thematic.

### Q5. Epistemic Separation & Negative-Control Humility
Excellent. Tools consistently tag epistemic classes (`direct_textual_evidence`, `documented_lexical_relationship`, `editorial_cross_reference`, `documented_collocation_or_cooccurrence`, `shared_motif_evidence`, `candidate_literary_pattern`, `orthographic_similarity_only`), and `wordplay_scan` / `literary_structure` attach explicit disclaimers distinguishing surface consonantal overlap from historical etymology.

### Q6. Gaps, Edge Cases, & Concrete Limitations Observed
1. **`wordplay_scan` silent range truncation:** Passing `"Jonah 1-4"` (48 verses) silently scanned only `"Jonah 1:1..Jonah 3:5"`, omitting `Jonah 3:6–4:11` without a `truncated: true` warning; a second call was required to scan `Jonah 3:6-4:11`.
2. **`literary_structure` `lxx_comparison` off-by-one versification bug on Psalm 107:** Although `versificationNotes` recognized `Psalms 107:1` → `LXX Psalms 106:2`, the `divergences` array compared MT `107:25` against LXX `106:26` (which is MT `107:26`), MT `107:29` against LXX `106:30` (MT `107:30`), etc., generating spurious `length_divergence` alerts due to a 1-verse offset.
3. **`trace_evidence` passage-endpoint failure:** Passing `from: "Jonah 4:2"`, `to: "Joel 2:13"` returned `status: "partial"` with `ctrl:missing_concepts` (`"Unresolved or unsupported query terms: jonah 4 2, joel 2 13"`), falling back to generic word-level connections rather than tracing paths between the two verses.
4. **`tri_textual_diff` false-positive splice ranking on short NT parallels:** On `Matthew 12:41`, `tri_textual_diff` selected `Joshua 8:1` and `Jeremiah 31:8` as top composite splices based on generic words (`ἄνδρες ... ἀναστήσονται`, `καὶ ἰδοὺ πολύν ... ὧδε`), even though `Jonah 3:2` (`κήρυξον` ↔ `κήρυγμα`) was already in `candidate_sources`.
5. **`get_Connection` missing rare-lemma bridge:** Comparing `["Jonah 4:2-8","1 Kings 19:4-12","Joel 2:12-14","Psalms 107:23-32"]` reported `all_endpoints_connected: false` ("no verified <=3-hop original-language or textual edge reached: Psalms 107:23-32"), missing both `H1827` (`דְּמָמָה`, shared exclusively by `1 Kgs 19:12` and `Ps 107:29` among these anchors) and `H7307` (`רוּחַ`, in `Jonah 4:8`, `1 Kgs 19:11`, `Ps 107:25`).
6. **`realworld:1` coverage gaps & `get_Passage` text-field inconsistency:** Both `H7021` (`קִיקָיוֹן`) and `H8415` (`תְּהוֹם`) returned `realworld.status: "unavailable"`. Additionally, `get_Passage` returned `original` Hebrew text for short ranges (`Ps 107:41-43`, `Joel 2:12-14`) but omitted `original` on longer ranges (`Jonah 1-2`, `Jonah 3-4`, `Ps 107`, `1 Kgs 19:4-13`).

### Q7. Comparison to Unassisted / Control Research
Without the MCP toolset, verifying exhaustive negative/rare corpus distributions (`H8367` = 4 verses; `H5848+H5315` = 4 verses; `H2587+H7349+H5162` = 2 verses; `H4688` = 11 verses; `G2785` = 1 NT verse), computing exact MT↔LXX lexical shift probabilities (`Jonah 3:4` `אַרְבָּעִים` → `τρεῖς`, `p_g_given_h = 0.0073`), and checking clause-level null probabilities (`sequence_parallels`) would be impossible to verify rigorously from memory. The toolset caught both genuine discoveries (e.g., `Ps 106:9`, `Lam 2:12,19`, `Exod 16:20`, `Deut` negative polarity of `חוּס`) and false positives (e.g., non-significant clause-order similarity between `Jonah 1-2` and `Ps 107:23-32`).

### Q8. Overall Verdict & Recommendations
**Verdict:** Highly effective (`8.5 / 10`) for rigorous, reproducible biblical research with transparent epistemic controls.
**Top 4 Recommendations:**
1. Fix `literary_structure` `lxx_comparison` verse-index alignment on Psalms with MT/LXX numbering shifts (e.g., Ps 107 ↔ LXX Ps 106).
2. Add an explicit `truncated: true` flag and continuation hint when `wordplay_scan` caps a multi-chapter range (e.g., `Jonah 1-4` stopping at `3:5`).
3. Make `trace_evidence` accept canonical verse refs in `from`/`to` directly (converting them to `verse_id`s before graph traversal) instead of tokenizing `"jonah 4 2"` as concept keywords.
4. Upgrade `get_Connection` multi-anchor passage proof search to check shared low-DF lemmas (`<= 20` OT occurrences, such as `H1827` `דְּמָמָה`) between anchor passages, and consistently include `original` tokens or a `tokens` toggle in `get_Passage`.
