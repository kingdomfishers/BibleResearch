# Research Report D3: Ritual Material Analogies and Purification (Leviticus 14, Numbers 19, Psalm 51, and Hebrews 9)

**Research Task:** Explore the cleansing ritual cluster in Leviticus 14 (bird, cedar, scarlet, hyssop, living water) in connection with Numbers 19, Psalm 51, and Hebrews 9, distinguishing lexical links, physical properties, and structural parallels.

**Corpus & Epistemic Scope:** All textual claims below are grounded in direct calls to the local BibleResearch MCP server (`v2.0.0`) using STEP Hebrew/Aramaic OT, Rahlfs 1935 LXX (`OpenScriptorium/lxx-morph`, with Swete LXX divergences noted where surfaced by `literary_structure`), NA28-membership Greek NT, and World English Bible (WEB) glosses/snippets. Epistemic strata are kept strictly separate: **(A) Attested Textual Evidence**, **(B) Linguistic, Grammatical & LXX Bridges**, **(C) Structural & Rhetorical Parallels**, **(D) Physical Properties (`realworld`)**, and **(E) Interpretive Hypotheses**.

---

## 1. Execution Log: MCP Calls, Latencies, and Payload Sizes

In addition to one initial unlogged `tools/list` schema discovery call (`latency_ms: 1651`, `wire_bytes: 17028`, `payload_bytes: 32507`), **18 MCP calls** were logged to `research/v3/opt-cycle2/local_D3.jsonl`:

| # | Tool | Target / Key Parameters | `latency_ms` | `wire_bytes` | `payload_bytes` |
|---:|---|---|---:|---:|---:|
| 1 | `get_prompt` | `{}` | 1,825 | 5,530 | 5,338 |
| 2 | `get_Passage` | `Lev 14:1-9` (`clues`, `depth=3`, `literary=1`, `realworld=1`) | 11,195 | 7,164 | 6,242 |
| 3 | `get_Passage` | `Numbers 19:1-22` (`clues`, `depth=3`, `literary=1`) | 9,501 | 11,060 | 9,822 |
| 4 | `get_Passage` | `Ps 51:0-19` (`clues`, `depth=3`, `literary=1`) | 9,561 | 8,892 | 7,760 |
| 5 | `get_Passage` | `Hebrews 9:11-28` (`clues`, `depth=3`, `literary=1`) | 11,734 | 9,941 | 8,773 |
| 6 | `get_Passage` | `Leviticus 14:48-57` (`clues`, `depth=3`, `literary=1`, `realworld=1`) | 5,688 | 6,865 | 5,955 |
| 7 | `get_Connection` | `["Leviticus 14:4-7","Numbers 19:6-19","Psalms 51:7","Hebrews 9:13-22"]` (`clues`, `connections=15`) | 14,377 | 7,295 | 6,435 |
| 8 | `get_Word` | `H0730` cedar (`clues`, `realworld=1`, `etymology=3`) | 2,410 | 5,631 | 4,939 |
| 9 | `get_Word` | `H0231` hyssop (`clues`, `realworld=1`, `etymology=3`) | 2,189 | 6,005 | 5,285 |
| 10 | `get_Word` | `H8144` scarlet (`clues`, `realworld=1`, `etymology=3`) | 1,576 | 5,497 | 4,829 |
| 11 | `get_Word` | `H6833` bird (`clues`, `realworld=1`, `etymology=3`) | 2,067 | 5,338 | 4,660 |
| 12 | `get_Word` | `H4325` water anchored at `Leviticus 14:5` (`clues`, `realworld=1`, `etymology=0`) | 3,017 | 4,920 | 4,264 |
| 13 | `research` | Batch 1 (8 ops, `evidence`): `lxx_concordance` (`H0231`,`H0730`,`H8144`,`H2398`), `tri_textual_diff` (`Heb 9:19`,`Heb 9:13`), `set_combine` (`H0730∩H8144∩H0231`), `occurrences` (`G4472`) | 14,080 | 46,736 | 40,660 |
| 14 | `research` | Batch 2 (8 ops, `evidence`): `literary_structure` (`Lev 14:1-9`,`Lev 14:48-53`,`Num 19:1-22`,`Ps 51:1-19`), `sequence_parallels` (`Lev 14:4-9↔49-53`,`Num 19:1-22↔Heb 9:11-23`), `lxx` (`Ps 51:7`), `lxx_concordance` (`H5137`) | 6,803 | 126,076 | 111,844 |
| 15 | `get_Passage` | `Leviticus 14:4-7` (`evidence`, `depth=3`, `literary=0`, `realworld=1`) | 16,617 | 37,998 | 33,226 |
| 16 | `research` | Batch 3 (8 ops, `evidence`): `lxx` (`Lev 14:4`,`14:52`,`Num 19:6`), `passage_compare` (`Exod 24:6-8↔Heb 9:18-22`), `occurrences` (`G2847`,`G5301`), `expand_clue` (`r11:xref:3119:30255`), `wordplay_scan` (`Lev 14:4↔Num 19:6`) | 12,332 | 52,861 | 47,425 |
| 17 | `get_Word` | `H8438` worm/crimson (`clues`, `realworld=1`, `etymology=3`) | 2,866 | 5,628 | 4,922 |
| 18 | `research` | Batch 4 (6 ops, `evidence`): `lxx` (`Num 19:9`,`19:17`,`19:18`,`19:19`), `passage_compare` (`Num 19:17-19↔Heb 9:13-14`), `occurrences` (`G1151`) | 10,133 | 50,844 | 45,556 |

**Totals (18 logged calls):** `137,974 ms` cumulative latency; `394,281` wire bytes (`353,015` payload bytes). Note that all 12 `clues`-mode calls remained compact (`4,920–11,060` wire bytes), whereas `research` Batch 2 with 4 `literary_structure` operations reached `126,076` wire bytes.

---

## 2. Attested Textual & Original-Language Baseline

### 2.1 Leviticus 14:4–7 (Skin-Disease Cleansing) and Leviticus 14:49–53 (House Cleansing)
In `Leviticus 14:4` (`vid:3116`), the priest commands to take for `לַמִּטַּהֵ֛ר` (`H2891`, pos 4, "for the one purifying himself"):
- `שְׁתֵּֽי צִפֳּרִ֥ים חַיּ֖וֹת טְהֹר֑וֹת` (`H8147` pos 5 + `H6833` pos 6 + `H2416` pos 7 + `H2889` pos 8, "two living clean birds")
- `וְעֵ֣ץ אֶ֔רֶז` (`H6086` pos 9 + `H0730` pos 10, "and wood of cedar")
- `וּשְׁנִ֥י תוֹלַ֖עַת` (`H8144` pos 11 + `H8438` pos 12, "and scarlet of a worm [crimson yarn]")
- `וְאֵזֹֽב` (`H0231` pos 13, "and hyssop")

In `Leviticus 14:5` (`vid:3117`), one bird (`הַצִּפּ֣וֹר הָאֶחָ֑ת`, `H6833` pos 5 + `H0259` pos 6) is slaughtered (`וְשָׁחַ֖ט`, `H7819` pos 3) into an earthen vessel (`כְּלִי חֶ֖רֶשׂ`, `H3627` pos 8 + `H2789` pos 9) over living/running water (`עַל מַ֥יִם חַיִּֽים`, `H5921` pos 10 + `H4325` pos 11 + `H2416` pos 12).
In `Leviticus 14:6–7` (`vid:3118–3119`), the living bird (`הַצִּפֹּ֤ר הַֽחַיָּה֙`), cedar wood, scarlet, and hyssop are dipped (`טָבַל`, `H2881`) in the blood of the slaughtered bird over the living water; the priest sprinkles (`וְהִזָּ֗ה`, `H5137` pos 1 in v.7) on the one purifying himself seven times (`שֶׁ֣בַע פְּעָמִ֑ים`, `H7651` pos 6 + `H6471` pos 7), declares him clean (`וְטִ֣הֲר֔וֹ`, `H2891` pos 8), and releases (`וְשִׁלַּ֛ח`, `H7971` pos 9) the living bird over the open field (`עַל פְּנֵ֥י הַשָּׂדֶֽה`, pos 13–15).

In `Leviticus 14:49–53` (`vid:3161–3165`), the identical five-item cluster recurs for cleansing a house (`לְחַטֵּ֥א אֶת־הַבַּ֖יִת`, `H2398` Piʿel). Notably, `Leviticus 14:52` (`vid:3164`) concentrates every material in a single verse: `וְחִטֵּ֣א אֶת־הַבַּ֔יִת בְּדַם֙ הַצִּפּ֔וֹר וּבַמַּ֖יִם הַֽחַיִּ֑ים וּבַצִּפֹּ֣ר הַחַיָּ֗ה וּבְעֵ֥ץ הָאֶ֛רֶז וּבָאֵזֹ֖ב וּבִשְׁנִ֥י הַתּוֹלָֽעַת` (blood of the bird, living water, living bird, cedar wood, hyssop, and scarlet worm-dye), followed in v.53 by releasing the living bird outside the city to make atonement (`וְכִפֶּ֥ר`, `H3722`).

### 2.2 Numbers 19:1–22 (Red Heifer & Water of Impurity)
- `Numbers 19:6` (`vid:4296`) prescribes the exact botanical/textile triad without the birds: `עֵ֥ץ אֶ֛רֶז וְאֵז֖וֹב וּשְׁנִ֣י תוֹלָ֑עַת` (`H6086` pos 3 + `H0730` pos 4 + `H0231` pos 5 + `H8144` pos 6 + `H8438` pos 7), cast into the burning of the red heifer (`פָּרָה`, `H6510`, pos 12). Notice the order shift compared to `Lev 14:4` (`cedar, scarlet, hyssop`) vs `Lev 14:51` and `Num 19:6` (`cedar, hyssop, scarlet`).
- `Numbers 19:9` (`vid:4299`) stores the ashes (`אֵ֣פֶר הַפָּרָ֔ה`, `H0665` pos 5 + `H6510` pos 6) outside the camp in a clean place (`בְּמָק֣וֹם טָה֑וֹר`, `H2889` pos 11) for `לְמֵ֥י נִדָּ֖ה` ("water of impurity", `H4325` pos 17 + `H5079` pos 18), explicitly called `חַטָּ֥את הִֽוא` (`H2403` pos 19, "it is a sin/purification offering").
- `Numbers 19:17–19` (`vid:4307–4309`) re-introduces living water (`מַ֥יִם חַיִּ֖ים`, `H4325` pos 8 + `H2416` pos 9) poured over the ashes (`עָפָר`, `H6083` pos 3) into a vessel (`כֶּֽלִי`, `H3627` pos 11), and uses **hyssop** (`אֵז֜וֹב`, `H0231` pos 2 in v.18) dipped (`וְטָבַ֣ל`, `H2881` pos 3) in the water to sprinkle (`וְהִזָּ֤ה`, `H5137` pos 7 in v.18, pos 1 in v.19) on the third and seventh days, using `חָטָא` (`H2398` Hitpaʿel/Piʿel, vv.12, 13, 19, 20), `כָּבַס` (`H3526`, wash clothes, vv.7, 8, 10, 19, 21), and `רָחַץ` (`H7364`, bathe in water, vv.7, 8, 19).

### 2.3 Psalm 51 (MT 51:9 = English/WEB `Psalms 51:7`; LXX `Psalmi 50:9`)
- `Psalms 51:7` (`vid:14745`): `תְּחַטְּאֵ֣נִי בְאֵז֣וֹב וְאֶטְהָ֑ר תְּ֝כַבְּסֵ֗נִי וּמִשֶּׁ֥לֶג אַלְבִּֽין׃`
  - Pos 1: `תְּחַטְּאֵ֣נִי` (`H2398` Piʿel, "you will de-sin/purify me")
  - Pos 2: `בְאֵז֣וֹב` (`H0231`, "with hyssop")
  - Pos 3: `וְאֶטְהָ֑ר` (`H2891`, "so I may be clean")
  - Pos 4: `תְּ֝כַבְּסֵ֗נִי` (`H3526`, "you will wash me")
  - Pos 5–6: `וּמִשֶּׁ֥לֶג אַלְבִּֽין` (`H7950` + `H3835`, "whiter than snow")
- Notice also `Psalms 51:2` (`כַּבְּסֵנִי` `H3526` + `טַהֲרֵנִי` `H2891`) and `Psalms 51:16–19` (contrasting `זֶבַח` `H2077` / `עֹלָה` `H5930` with a broken spirit `רוּחַ נִשְׁבָּרָה` before restoring `זִבְחֵי־צֶדֶק`).

### 2.4 Hebrews 9:11–28 (and 10:22)
- `Hebrews 9:13` (`vid:30218`): `...τὸ αἷμα τράγων καὶ ταύρων καὶ σποδὸς δαμάλεως ῥαντίζουσα τοὺς κεκοινωμένους ἁγιάζει πρὸς τὴν τῆς σαρκὸς καθαρότητα` ("ashes of a heifer [`σποδὸς δαμάλεως`, `G1151` pos 10] sprinkling [`ῥαντίζουσα`, `G4472` pos 11] the defiled sanctifies for the cleanness of the flesh").
- `Hebrews 9:14` (`vid:30219`): contrasts Christ's blood offered through the eternal Spirit (`διὰ Πνεύματος αἰωνίου`) to cleanse (`καθαριεῖ`, `G2511`) conscience from dead works (`ἀπὸ νεκρῶν ἔργων`) to serve the living God (`Θεῷ ζῶντι`).
- `Hebrews 9:19` (`vid:30224`): `...λαβὼν τὸ αἷμα τῶν μόσχων καὶ τῶν τράγων μετὰ ὕδατος καὶ ἐρίου κοκκίνου καὶ ὑσσώπου αὐτό τε τὸ βιβλίον καὶ πάντα τὸν λαὸν ἐράντισεν` — explicitly adding **water** (`ὕδατος`, `G5204`), **scarlet wool** (`ἐρίου κοκκίνου`, `G2847` pos 25), and **hyssop** (`ὑσσώπου`, `G5301` pos 27) with **sprinkling** (`ἐράντισεν`, `G4472` pos 36) into the Sinai covenant inauguration (`Exod 24:6–8`, quoted in `Heb 9:20`).
- `Hebrews 10:22` (`vid:30255`): combines `ῥεραντισμένοι τὰς καρδίας` (`G4472` pos 8) and `λελουσμένοι τὸ σῶμα ὕδατι καθαρῷ` (`G3068` pos 15 + `G5204` pos 18 + `G2513` pos 19).

---

## 3. Verified Lexical Links & LXX / Tri-Textual Bridges

### 3.1 Canonical Co-Occurrence of the Triad (`set_combine`)
Running BMW bitset intersection (`set_combine: intersect`) across `H0730` (cedar) + `H8144` (scarlet) + `H0231` (hyssop) across the entire OT+NT canon returns **only 6 verses**:
- `Leviticus 14:4` (`vid:3116`), `Leviticus 14:6` (`vid:3118`)
- `Leviticus 14:49` (`vid:3161`), `Leviticus 14:51` (`vid:3163`), `Leviticus 14:52` (`vid:3164`)
- `Numbers 19:6` (`vid:4296`)

Pairwise collocations further confirm tight ritual binding:
- `H0231` (אֵזוֹב, 10 verses total in OT) ↔ `H8144` (שָׁנִי): **NPMI = 0.71** across 6 verses (`e_perp = 29.24 bits`, `p_null = 1.58e-9`, `r13:colloc:H0231:H8144`).
- `H8144` (שָׁנִי) ↔ `H8438` (תּוֹלֵעָה/תּוֹלָע): **NPMI = 0.94** across 34 verses (`e_perp = 19.92 bits`, `p_null = 1.01e-6`, `r13:colloc:H8144:H8438`), appearing in construct 14× (usually in tabernacle textiles, Exod 25–39, plus Lev 14 and Num 19).
- `H6833` (צִפּוֹר) modified by `H2416` (חַי, "living"): 7× exclusively in `Leviticus 14` (`e_perp = 16.72 bits`, `p_null = 9.27e-6`, `r11:gram:H6833:modifies:H2416`).

### 3.2 Complete Cycle Network (`get_Connection`)
Comparing `["Leviticus 14:4-7", "Numbers 19:6-19", "Psalms 51:7", "Hebrews 9:13-22"]` yields a complete, valid cycle network (`is_complete: true`, 5 independent edges across 6 anchor pairs):
1. `Lev 14:4-7 ↔ Num 19:6-19`: `טָהֵר` (`H2891`) ↔ `טָהוֹר` (`H2889`) (`passage_root_wordplay:H2891:H2889`).
2. `Lev 14:4-7 ↔ Ps 51:7`: `טָהוֹר` (`H2889`) ↔ `טָהֵר` (`H2891`) (`passage_root_wordplay:H2889:H2891`).
3. `Num 19:6-19 ↔ Ps 51:7`: shared vocabulary `כָּבַס` (`H3526`, 48v, "to wash", `shared_lemma:H3526`).
4. `Lev 14:4-7 ↔ Heb 9:13-22`: LXX lexical bridge `טָהֵר` (`H2891`) ↔ `καθαρίζω` (`G2511`, `passage_lxx:H2891:G2511`).
5. `Num 19:6-19 ↔ Heb 9:13-22`: LXX lexical bridge `מוּת` (`H4191`) ↔ `θάνατος` (`G2288`, `passage_lxx:G2288:H4191`).

### 3.3 Crucial LXX Theological & Ritual Shifts (MT ↔ LXX ↔ NT)
Direct `lxx` and `lxx_concordance` inspection reveals how the Septuagint mediates the lexical transition from Leviticus 14 / Numbers 19 / Psalm 51 into Hebrews 9:

1. **Piʿel/Hitpaʿel `חָטָא` (`H2398`) → `ἀφαγνίζω` / `ἁγνίζω` / `ῥαντίζω`:**
   - Standard Qal `חָטָא` renders as `ἁμαρτάνω` (167×) or `ἐξαμαρτάνω` (30×).
   - In the ritual cleansing chapters, `lxx_concordance` detects systematic `lexical_theological_shift` entries to **`ἀφαγνίζω`** (`p_g_given_h = 0.0289`, `g_idf = 11.58`) in `Leviticus 14:49` (`ἀφαγνίσαι`), `Leviticus 14:52` (`ἀφαγνιεῖ`), `Numbers 19:12` (`ἀφαγνισθῇ`), `19:13` (`ἀφαγνισθῇ`), and `19:19` (`ἀφαγνισθήσεται`), alongside `ἁγνίζω` (`Num 19:12`).
   - **Psalm 51:7 (LXX 50:9) Direct Discovery:** While `lxx_concordance` missed this single-verse shift in its top-12 table (and the token aligner left pos 1 `unmatched`), direct `lxx` comparison on `Psalms 51:7` shows LXX renders Piʿel `תְּחַטְּאֵ֣נִי` (`H2398`, "de-sin me") as **`ῥαντιεῖς με`** (`G4472`, `ῥαντίζω`, "you will sprinkle me"): `ῥαντιεῖς με ὑσσώπῳ καὶ καθαρισθήσομαι, πλυνεῖς με...` (`Ps 50:9 LXX`). This directly anticipates Hebrews' vocabulary (`ῥαντίζω` occurs 5× in the NT: `Mark 7:4` and 4× in Hebrews: `9:13, 19, 21; 10:22`).

2. **Numbers 19:9 & 19:17–19 LXX → Hebrews 9:13–14 & 10:22:**
   - `Numbers 19:9` LXX renders `אֵפֶר הַפָּרָה` as **`τὴν σποδὸν τῆς δαμάλεως`** — echoed verbatim (without article) in `Hebrews 9:13` (`σποδὸς δαμάλεως`, where `G1151 δάμαλις` is a NT hapax).
   - `Numbers 19:9` LXX shifts `לְמֵי נִדָּה חַטָּאת הִוא` to **`ὕδωρ ῥαντισμοῦ, ἅγνισμά ἐστιν`** ("water of sprinkling [`ῥαντισμοῦ`], a purification [`ἅγνισμα`, `g_idf=14.9`]").
   - `Numbers 19:17` LXX renders `מַיִם חַיִּים` as **`ὕδωρ ζῶν`** ("living water"), paralleling `Lev 14:5–6, 50–52` (`ὕδατι ζῶντι`).
   - `Numbers 19:19` LXX uses **`πλυνεῖ`** (`πλύνω`, matching `πλυνεῖς με` in `Ps 50:9 LXX`) and **`λούσεται ὕδατι`** (`λούω`, echoed in `Heb 10:22` `λελουσμένοι τὸ σῶμα ὕδατι καθαρῷ`). Note also a textual divergence surfaced in the Rahlfs/Swete LXX witness for `Num 19:19`: LXX reads `ἀκάθαρτος ὦσται` ("unclean until evening") against MT `וְטָהֵר בָּעָרֶב` ("clean at evening").

3. **Scarlet (`שְׁנִי תוֹלַעַת`) & Hyssop (`אֵזוֹב`) into `Hebrews 9:19`:**
   - In `Leviticus 14:4, 6, 52`, LXX translates `שְׁנִי תוֹלַעַת` as **`κεκλωσμένον κόκκινον`** ("spun scarlet", `lxx_plus_expansion` `κλωστός` at `Lev 14:6`), whereas `Numbers 19:6` LXX condenses to **`κόκκινον`**.
   - `Hebrews 9:19` uses **`ἐρίου κοκκίνου`** ("scarlet wool", `G2847`) + **`ὑσσώπου`** (`G5301`, found in NT only at `Heb 9:19` and `John 19:29`) + **`ὕδατος`** (`G5204`).
   - `tri_textual_diff` on `Hebrews 9:19` detects `Leviticus 14:51` (`score: 20.26`, `agrees_both` on `λαμβάνω ... κόκκινος ... καί ... ὕσσωπος`) spliced into the covenant-inauguration frame (`composite_splice: 5`), while `passage_compare` on `Exodus 24:6–8 ↔ Hebrews 9:18–22` verifies 8 LXX-bridged lemmas (`דָּם`/`αἷμα`, `סֵפֶר`/`βιβλίον`, `בְּרִית`/`διαθήκη`, `עַם`/`λαός`, `מֹשֶׁה`/`Μωϋσῆς`, `דָּבָר`/`λαλέω`, `לָקַח`/`λαμβάνω`), confirming that `Hebrews 9:19` fuses the Sinai covenant-blood rite (`Exod 24:6–8`) with the Leviticus 14 / Numbers 19 hyssop-scarlet-water cluster. *(Methodological note: `tri_textual_diff` algorithmically matched `Nehemiah 8:1` and `1 Samuel 14:34` for `βιβλίον`/`λαός` rather than `Exod 24:7–8`, which required `passage_compare` to verify.)*

---

## 4. Physical Properties (`realworld`) vs. Missing Real-World Coverage

Inspecting the 5 ritual materials + `תּוֹלֵעָה` via `get_Word(..., realworld=1)` and `get_Passage(..., realworld=1)` strictly separates corpus-attested physical ontology from gaps:

| Lemma (Strong's) | Material | `realworld.status` | Attested Physical Properties & External Bridges | What Is *Not* Ontology-Attested |
|---|---|---|---|---|
| **אֶרֶז** (`H0730`) | Cedar | `ok` | `domain: botany`, `organism: cedrus_libani`, `material: aromatic_timber` (v3 sense-ontology) | Decay-resistance / preservative chemistry not explicitly encoded |
| **אֵזוֹב** (`H0231`) | Hyssop | `ok` | `domain: botany`, `organism: hyssop`, `ritual_use: sprinkling_cleansing`; OEWN hypernyms `herb, herbaceous plant`, `vascular plant` | Capillary/brush-like leaf hairs (e.g., *Origanum syriacum*) not encoded |
| **שָׁנִי** (`H8144`) | Scarlet | `ok` | OEWN hypernym `red, redness` (`oewn:04969961-n`) | Textile-binding / kermes-dye source not encoded on `H8144` |
| **תּוֹלֵעָה** (`H8438`) | Worm / Crimson | `unavailable` | No `realworld` entry recorded | Scale-insect dye (*Kermes ilicis*) |
| **צִפּוֹר** (`H6833`) | Bird | `unavailable` | No `realworld` entry recorded | Flight/release mechanics |
| **מַיִם** (`H4325`) | Water | `ok` | `domain: hydrology`, `substance: water`, `physical_state: liquid`; Wikidata `water source` | Flowing vs. stagnant hydrology (`חַיִּים`) not differentiated in `realworld` |

**Physical-Analogy Assessment:** Within the attested ontology, the cluster pairs an **aromatic wood** (*Cedrus libani*, `H0730`), a **herbaceous sprinkling plant** (`H0231`), a **red dye** (`H8144`), and **liquid water** (`H4325`), with `H0730` and `H8144`/`H8438` also heavily indexed under `temple_and_sanctuary_architecture` (`Exod 25–39`, `1 Kgs 5–7`). Any further physical-mechanism claims (e.g., cedar as anti-putrefactive aromatic, scarlet wool binding hyssop to cedar as an absorbent brush, living water vs. stagnant corpse-water) must be classified strictly under **Interpretive Hypotheses** (§6), not ontology facts.

---

## 5. Structural & Rhetorical Parallels

1. **Intra-Leviticus 14 Structural Parallel (`sequence_parallels`):**
   Comparing `Leviticus 14:4–9` (skin-disease rite) against `Leviticus 14:49–53` (house rite) yields a statistically significant forward concordant alignment: `arc_kind: "parallel_scene"`, `mode: "CONCORDANT"`, `raw_score: 8.2`, `p_null: 0.0308` (`evidence_bits: 5.02`), `has_inversion: false`.
   - **Shared Core Sequence (vv.4–7 // vv.49–53):** Command/take materials (2 clean living birds, cedar wood, scarlet, hyssop) → slaughter one bird into earthenware over living water → dip living bird + cedar + scarlet + hyssop into blood + living water → sprinkle 7× (`הִזָּה ... שֶׁבַע פְּעָמִים`) → release living bird into open field (`וְשִׁלַּח אֶת הַצִּפֹּר הַחַיָּה`).
   - **Structural Divergence (`structural_breaks` at `Lev 14:7` & `14:8`, concept Jaccard `0.105` / `0.087`):** The personal rite continues with a 7-day liminal period, clothes-washing (`כָּבַס`), shaving all hair (`גָּלַח`), and bathing (`רָחַץ`, vv.8–9) before camp/tent re-entry, whereas the house rite terminates immediately at v.53 with `כִּפֶּר` (atonement) and pronouncing the house clean.
   - **Syntactic Talion in `Lev 14:7–8`:** `literary_structure` detects `attested_textual_wordplay` (`syntactic_talion`, confidence `0.818`) flipping the root `טהר` (`H2891`) between priestly declaration `וְטִהֲרוֹ` (`14:7` pos 8, Piʿel + 3ms suffix) and reflexive self-purification `הַמִּטַּהֵר` (`14:8` pos 2, Hitpaʿel participle).

2. **Numbers 19 Four-Unit & Polarity Structure (`literary_structure` + `sequence_parallels`):**
   - `literary_structure` segments `Numbers 19` into 4 units: **Unit 1** (`19:4–5`, blood sprinkling & heifer burning), **Unit 2** (`19:6–16`, casting cedar/hyssop/scarlet into burning, ash storage, and 7-day corpse-defilement cases), **Unit 3** (`19:17`, ash + living-water preparation), **Unit 4** (`19:18–22`, hyssop sprinkling on day 3 & day 7, washing, and contagion rules).
   - **Key Polarity:** `Num 19:7–10, 21` exhibits the classic purification-paradox: those who handle/burn/gather/sprinkle the purifying agent become `טָמֵא` until evening (`H2930` appears 12×, `H2931` 6×, `H6153` "evening" 6×), whereas the corpse-defiled person is cleansed on days 3 and 7.

3. **Psalm 51 Rhetorical & Frame Parallels:**
   - `literary_structure` identifies three predicate-role frames uniting Psalm 51: `מָחָה` ("blot out", `51:1, 9`), `חָפַץ` ("desire", `51:6, 16, 19`), and `דָּכָה` ("crush", `51:8, 17`).
   - Crucially, `Ps 51:7` applies Lev 14 / Num 19's **external ritual action** (`חָטָא` Piʿel + `אֵזוֹב` + `טָהֵר` + `כָּבַס`) metaphorically to internal moral guilt (`עָוֺן`, `חַטָּאת`, `לֵב טָהוֹר` in v.10), while `51:16–19` moves from negated external sacrifice (`זֶבַח וּמִנְחָה / עוֹלָה`, v.16) through broken spirit/heart (v.17) to restored righteous sacrifices (`זִבְחֵי־צֶדֶק`, v.19).

4. **Hebrews 9:11–28 Structural Contrast & Negative Control:**
   - **Negative Control (`seq_num_heb`):** `sequence_parallels` between `Numbers 19:1–22` and `Hebrews 9:11–23` yields `p_null = 0.9231`, `evidence_bits = 0` — demonstrating that Hebrews 9 does **not** reproduce the narrative/procedural sequence of Numbers 19.
   - Instead, `Hebrews 9:11–28` is structured into 3 rhetorical units (`9:11–14`, `9:15–22`, `9:23–28`) driven by an *a fortiori* (`εἰ γὰρ ... πόσῳ μᾶλλον`, `9:13–14`) contrast: **external/fleshly sprinkling** (`σποδὸς δαμάλεως` [Num 19] + `ὕδωρ/ἔριον κόκκινον/ὕσσωπος` [Lev 14] + `αἷμα τράγων/μόσχων` [Lev 16 / Exod 24] → `τῆς σαρκὸς καθαρότητα`) vs. **Christ's self-offering through the eternal Spirit** (`διὰ Πνεύματος αἰωνίου` → `καθαριεῖ τὴν συνείδησιν ἡμῶν ἀπὸ νεκρῶν ἔργων`).

---

## 6. Interpretive Hypotheses (Explicitly Distinguished from Textual Facts)

1. **Vitality vs. Death-Realm Polarity:** Both Leviticus 14 (`צָרַעַת` on skin/houses, treated with two living birds, living water, cedar, crimson) and Numbers 19 (corpse defilement, treated with red heifer ashes + living water + hyssop) confront spheres of decay/death. The pairing of **slaughtered blood** with **living water** (`מַיִם חַיִּים`) and a **released living bird** (`צִפּוֹר חַיָּה`, Lev 14) or **red** heifer + **cedar/scarlet/hyssop** (Num 19) plausibly symbolizes life overcoming death-defilement—yet this symbolic synthesis is an *interpretive hypothesis*, not stated explicitly in the biblical text.
2. **Material Function (Brush & Absorbent Hypothesis):** Historically/materially, a cedar rod, scarlet wool, and hyssop bundle in Lev 14 and Heb 9:19 could function together as an absorbent sprinkling implement (`Lev 14:6–7`; `Exod 12:22` uses hyssop alone; `Num 19:6` burns all three into the ash rather than using cedar/scarlet as a brush). Because `Lev 14` does not state *how* they are bound together (unlike Mishnaic tradition) and `Heb 9:19` omits cedar while explicitly calling scarlet "wool" (`ἔριον κόκκινον`), this remains an interpretive/historical reconstruction.
3. **Why Hebrews 9:19 Splices Lev 14/Num 19 into Exod 24:6–8:** Hebrews 9:19's inclusion of water, scarlet wool, and hyssop alongside the Sinai covenant blood (`Exod 24:6–8`) likely reflects either a Second Temple liturgical synthesis of Torah purification rites or a rhetorical compression uniting covenant inauguration (`9:18–21`) with general cultic purification (`9:22`, `σχεδὸν ἐν αἵματι πάντα καθαρίζεται`).

---

## 7. Honest 8-Question System Evaluation

1. **Tool Selection & Discoverability:**
   - `get_prompt` and `--list-tools` provide clear, accurate guidance on the 7 tools and 26 `research` operations. The progression (`get_Passage` → `get_Word` → `get_Connection` → `research` v3 ops) worked smoothly without trial-and-error. One minor friction: `wordplay_scan` accepted `a: "Leviticus 14:4", b: "Numbers 19:6"` without returning an input validation error, instead silently returning `comparable: false` (`edit_distance: 99`) because `a`/`b` expect lexical terms rather than passage refs (which use `passage`).

2. **Progressive Detail (`view="clues"` vs. `evidence`) & Payload Discipline:**
   - Default `view="clues"` kept all 12 passage/word/connection calls between `4.9 KB` and `11.1 KB` wire bytes (`1.5–14.4 s`). Batching 6–8 `research` ops was very efficient for staying within the 12–18 call budget, though batching 4 `literary_structure` ops in `evidence` view produced `126 KB` wire bytes; using `detail="compact"` on `literary_structure` helped keep Num 19 / Ps 51 manageable, though `Lev 14:1-9` and `14:48-53` in `standard` expanded many repetitive keyword spans.

3. **Original-Language Textual Fidelity:**
   - `get_Passage(view="evidence")` and `research` (`lxx`, `occurrences`, `set_combine`) returned exact pointed Hebrew (STEP), Rahlfs 1935 LXX Greek, and NA28 Greek with Strong's IDs and 1-based token positions. A useful safeguard: Psalm 51 uses English versification (`Psalms 51:7` for MT `51:9`), while `literary_structure` `lxx_comparison` explicitly documents the MT↔LXX offset (`Psalms 51:7` ↔ `LXX Psalms 50:9`).

4. **LXX & Tri-Textual (`lxx_concordance`, `lxx`, `tri_textual_diff`) Performance:**
   - `lxx_concordance` excelled on `H2398` (`חָטָא`), immediately surfacing the Piʿel/Hitpaʿel `lexical_theological_shift` to `ἀφαγνίζω`/`ἁγνίζω` in `Lev 14:49, 52` and `Num 19:12, 13, 19`, and `H2403` → `ἅγνισμα` in `Num 19:9`.
   - **Two bugs/quirks observed:** (a) In `lxx_concordance` for `H5137` (`נָזָה`), the top concordance lemma returned was **`καί`** (`62,222` occurrences!) because the Hebrew conjunction `וְ` attached to `וְהִזָּה` co-aligned with `καί` 18× in the alignment index (`lxx_equivalents[0]` = `καί`), drowning out the real equivalents (`ῥαίνω`, `περιρραίνω`, `ῥαντίζω`) in the verse list! (b) In `tri_textual_diff` on `Hebrews 9:19`, it cleanly identified the `Leviticus 14:51` splice (`ὕσσωπος`, `κόκκινος`, `λαμβάνω`), but spliced `τὸ βιβλίον καὶ πάντα τὸν λαόν` from `1 Samuel 14:34` / `Nehemiah 8:1` instead of `Exodus 24:7–8` (`סֵפֶר הַבְּרִית` / `τὸ βιβλίον τῆς διαθήκης` + `הָעָם` / `τὸν λαόν`), requiring `passage_compare` on `Exodus 24:6-8` to confirm the primary Sinai source. Also, in `lxx` for `Psalms 51:7`, `תְּחַטְּאֵנִי` ↔ `ῥαντιεῖς` was marked `unmatched` by the token aligner, so direct bilingual reading was still essential.

5. **Physical Properties (`realworld`) & Epistemic Separation:**
   - Epistemic tagging (`direct_textual_evidence`, `documented_lexical_relationship`, `editorial_cross_reference`, `orthographic_similarity_only`, `candidate_literary_pattern`) is rigorous and consistently warns against etymological fallacies (e.g., separating `H8144` שָׁנִי "scarlet" from homograph `H8145` שֵׁנִי "second").
   - `realworld=1` gave verified botanical/hydrological anchors for `H0730` cedar (`cedrus_libani`, `aromatic_timber`), `H0231` hyssop (`sprinkling_cleansing`, OEWN `herb`), `H8144` scarlet (`red, redness`), and `H4325` water (`hydrology`, `liquid`), while honestly reporting `unavailable` for `H6833` bird and `H8438` worm (`kermes`). Coverage for animal/material terms (`bird`, `kermes worm`, `earthenware`, `running` water vs. stagnant water) remains sparse.

6. **Structural & Sequence Discovery (`literary_structure`, `sequence_parallels`):**
   - `sequence_parallels` produced highly informative, statistically calibrated discrimination: `Lev 14:4-9 ↔ Lev 14:49-53` scored `p_null = 0.0308` (`CONCORDANT`, identifying the exact `14:7–8` structural break), whereas `Num 19:1-22 ↔ Heb 9:11-23` returned `p_null = 0.9231` (`evidence_bits: 0`), preventing false structural claims. `literary_structure` also detected the `Lev 14:7–8` `טהר` syntactic talion (`וְטִהֲרוֹ` ↔ `הַמִּטַּהֵר`) and segmented `Num 19` and `Heb 9` into coherent rhetorical units.

7. **Negative-Control Discipline & Failure Modes:**
   - High-frequency hubs (`H4325` water, 522v) properly yielded near-zero `e_perp` (`0.01–0.07 bits`, `p_null = 0.95–0.99`), and `get_Word` separated spelling suggestions from documented roots.
   - Minor data anomaly noticed in `research` `lxx` on `Numbers 19:19`: the Swete/Rahlfs LXX string read `καὶ ἀκάθαρτος ὦσται ἕως ἑσπέρας` (`ὦσται` looks like a morphological/OCR-like glitch for `ἔσται` in the underlying LXX text source, though the semantic divergence from MT `וְטָהֵר` is real). Similarly, `Leviticus 14:52` LXX text printed `μαὶ` for `καὶ` at pos 29.

8. **Overall Research Utility & Recommendations:**
   - **Verdict:** Highly valuable for rigorous biblical scholarship—especially `set_combine`, `get_Connection` cycle proofs, `lxx_concordance` shift detection, `sequence_parallels` with `p_null`, and strict epistemic labeling.
   - **Concrete Improvements:** (1) Filter stop-words (`καί`, `ὁ`, `εἰς`, `ἐν`) from driving the primary `lemma` concordance in `lxx_concordance` (fixing `H5137` → `καί`); (2) boost multi-word phrase/LXX-lemma recall in `tri_textual_diff` candidate retrieval so `Hebrews 9:19` retrieves `Exodus 24:6–8` ahead of `1 Sam 14:34`; (3) reject or warn when passage refs are passed to `wordplay_scan` `a`/`b`; (4) expand `realworld` ontology coverage for biblical fauna/dyes/ritual implements (`H6833`, `H8438`, `H2789`); and (5) inspect `Lev 14:52` (`μαὶ`) and `Num 19:19` (`ὦσται`) in the Rahlfs/Swete LXX tokenization source.
