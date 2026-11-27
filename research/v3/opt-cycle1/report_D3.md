# Research Report D3: Ritual Material Analogies and Purification (Leviticus 14, Numbers 19, Psalm 51, Hebrews 9)

**Evaluation Arm:** Local BibleResearch MCP (`--target local --no-supabase`)  
**Log File:** `research/v3/opt-cycle1/local_D3.jsonl`  
**Date:** 2026-11-25  

---

## 1. Summary of MCP Calls Made

In addition to two unlogged `--list-tools` inspections (full schema: 3,711 ms, 16,099 wire / 30,058 payload bytes; filtered schema check for `get_Connection`, `follow_connectionchain`, `research`), **22 MCP calls** (21 valid, 1 input-validation error) were logged to `research/v3/opt-cycle1/local_D3.jsonl`:

| # | Tool | Key Arguments | Latency (ms) | Wire Bytes | Payload Bytes | Status |
|---:|---|---|---:|---:|---:|---|
| 1 | `get_prompt` | `{}` | 3,771 | 10,756 | 5,241 | ok |
| 2 | `get_Passage` | `Lev 14:1-9`, `depth=5, realworld=1, literary=1, view="clues"` | 15,245 | 27,227 | 23,677 | ok |
| 3 | `get_Passage` | `Num 19:1-22`, `depth=3, realworld=1, literary=1, view="clues"` | 64,605 | 50,612 | 44,012 | ok |
| 4 | `get_Passage` | `Ps 51:0-19`, `depth=3, realworld=1, literary=1, view="clues"` | 77,581 | 33,569 | 29,144 | ok |
| 5 | `get_Passage` | `Heb 9:11-23`, `depth=5, realworld=1, literary=1, view="clues"` | 71,336 | 37,466 | 32,241 | ok |
| 6 | `get_Passage` | `Lev 14:4-7`, `depth=5, realworld=1, literary=2, view="clues"` | 31,556 | 37,429 | 33,045 | ok |
| 7 | `get_Passage` | `Num 19:6-9`, `depth=3, realworld=1, literary=1, view="clues"` | 37,527 | 15,069 | 13,123 | ok |
| 8 | `get_Passage` | `Num 19:17-19`, `depth=2, realworld=0, literary=0, compact=true` | 43,770 | 26,094 | 22,594 | ok |
| 9 | `get_Passage` | `Ps 51:7-10`, `depth=2, realworld=0, literary=0, compact=true` | 41,261 | 22,357 | 19,395 | ok |
| 10 | `get_Passage` | `Heb 9:13-22`, `depth=2, realworld=0, literary=0, compact=true` | 41,132 | 48,029 | 41,265 | ok |
| 11 | `get_Word` | `H0231` (`Lev 14:4`), `etymology=3, realworld=1, connections=8` | 3,575 | 6,128 | 5,396 | ok |
| 12 | `get_Word` | `H0730` (`Lev 14:4`), `etymology=3, realworld=1, connections=8` | 6,545 | 5,936 | 5,216 | ok |
| 13 | `get_Word` | `H8438` (`Lev 14:4`), `etymology=3, realworld=1, connections=8` | 4,653 | 5,942 | 5,208 | ok |
| 14 | `get_Word` | `H6833` (`Lev 14:4`), `etymology=3, realworld=1, connections=8` | 8,301 | 5,652 | 4,946 | ok |
| 15 | `get_Connection` | `["Leviticus 14:4-7","Numbers 19:6-19","Psalms 51:7","Hebrews 9:13-22"]`, `connections=15` | 48,658 | 7,295 | 6,435 | ok |
| 16 | `get_Word` | `H8144` (`Lev 14:4`), `etymology=3, realworld=1, connections=6` | 12,768 | 5,731 | 5,043 | ok |
| 17 | `research` | 7 ops (`expand_clue` used invalid `detail:"evidence"`) | 4,657 | 288 | 165 | error (`detail` enum) |
| 18 | `research` | 8 ops (`set_combine` x2, `lxx_concordance` x2, `tri_textual_diff`, `sequence_parallels`, `expand_clue` `r12:scene:4296:3118`, `literary_structure` `Lev 14:4-7`) | 37,921 | 86,031 | 73,892 | ok |
| 19 | `research` | 4 ops (`set_combine` `[H4325,H2416]`, `lxx_concordance` `Ps 51:7-10`, `tri_textual_diff` `Heb 9:19-20`, `sequence_parallels` `Lev 14:4-7 -> Num 19:6-19`) | 20,000 | 30,122 | 25,820 | ok |
| 20 | `follow_connectionchain` | `next="Leviticus 14:6"` | 6,886 | 6,469 | 5,677 | ok |
| 21 | `research` | 3 ops (`lxx_concordance` `Ps 51:7`, `tri_textual_diff` `Heb 9:19-20`, `lxx_concordance` `Lev 14:6`) | 12,149 | 19,713 | 16,569 | ok |
| 22 | `research` | 1 op (`tri_textual_diff` `Hebrews 9:19`) | 6,972 | 7,850 | 6,762 | ok |

---

## 2. Textually Verified Discoveries

Throughout this analysis, **(a) attested textual/LXX evidence**, **(b) linguistic/grammatical relationships**, **(c) structural/rhetorical parallels**, **(d) physical/real-world properties**, and **(e) interpretive hypotheses** are kept strictly distinct.

### 2.1 Attested Lexical Inventory & LXX Bridges of the Leviticus 14 Bundle

From `get_Passage` (`Lev 14:4-7`), `get_Word` (`H0231`, `H0730`, `H8144`, `H8438`, `H6833`), and `lxx_concordance` (`Lev 14:6`), the five ritual elements in Leviticus 14:4–7 resolve to the following attested lemmas and LXX correspondences:

1. **Living & Slain Birds (`צִפּוֹר`, `H6833` + `חַי`, `H2416`)**:
   - `H6833` occurs in 37 verses; in `Lev 14:4, 51` it is grammatically modified by `H2416` (`חַי`, "living/alive", 7× across indexed verses; `e_perp = 16.72 bits`, `p_null = 9.27e-6`).
   - LXX renders `H6833` primarily with `ὄρνεον` (`G3732`, 14×), `ὀρνίθιον` (`G8551`, 9×, explicitly anchored at `Lev 14:4, 5`, `bits=11.77`, `p_null=2.86e-4`), and `πετεινός` (`G4071`, 5×).
   - In `Lev 14:6–7`, one bird is slaughtered (`שָׁחַט`, `H7819`) over living water, while `הַצִּפֹּר הַחַיָּה` ("the living bird") is dipped (`טָבַל`, `H2881`) together with the cedar, scarlet, and hyssop in the slain bird's blood (`דָּם`, `H1818`, `H6833↔H1818` construct 3× at `Lev 14:6, 51, 52`, `bits=15.31`) over the living water, and then sent away (`שָׁלַח`, `H7971`) over the open field (`עַל פְּנֵי הַשָּׂדֶה`, `Lev 14:7`).

2. **Cedar Wood (`עֵץ הָאֶרֶז`: `H6086` + `H0730`)**:
   - `H0730` (`אֶרֶז`, "cedar", 68v) stands in construct with `H6086` (`עֵץ`, "tree/wood", 288v; 16× construct across the OT, `bits=11.54`, `p_null=3.35e-4`).
   - LXX renders `H0730` as `κέδρινος` (`G7989`, 48×). Documented root/relative records link `H0730` to `H0729` (`אָרוּז`, "reinforced") and `H0731` (`אַרְזָה`), and `get_Word` notes an attested orthographic/wordplay pair `אֶרֶז` (`H0730`) ↔ `אֶרֶץ` (`H0776`, "land", `1 Kgs 4:33; 9:11`, `bits=11.82`).

3. **Scarlet (`שְׁנִי הַתּוֹלַעַת`: `H8144` + `H8438`)**:
   - `H8144` (`שָׁנִי`, "scarlet", 42v) and `H8438` (`תֹּולַעַת`, "worm / crimson stuff", 43v) form a tight construct pair (14× construct, `bits=21.77`, `p_null=2.81e-7`) and high-PMI collocation (NPMI=0.94 across 34 verses, `bits=19.92`, `p_null=1.01e-6`), predominantly in Exodus 25–39 sanctuary textiles (`Temple & Sanctuary Architecture` cluster, 32–34 verses).
   - LXX renders both `H8144` (26×) and `H8438` (27×) with **`κόκκινος` (`G2847`, "scarlet")**—the exact Greek adjective used in `Hebrews 9:19`.
   - **`tri_textual_diff` discovery (`Lev 14:6`)**: In `Lev 14:6`, LXX exhibits an `lxx_plus_expansion` (`sum_idf = 14.9`) adding **`κλωστὸν`** (`κλωστός`, "spun/twisted"), rendering the Hebrew scarlet-worm phrase as spun scarlet thread/yarn, bridging toward `Heb 9:19`'s scarlet wool (`κόκκινος`).

4. **Hyssop (`אֵזוֹב`, `H0231`)**:
   - Occurs in only 10 verses across the OT; LXX translates `H0231` consistently with **`ὕσσωπος` (`G5301`, "hyssop", 9×, `bits=24.52`, `p_null=4.15e-8`)**.
   - High-PMI collocations link `H0231` to `H8144` ("scarlet", NPMI=0.71, 6×, `bits=29.24`, `p_null=1.58e-9`) and `H6833` ("bird", NPMI=0.69, 5×, `bits=18.77`, `p_null=2.24e-6`), and `Temple & Sanctuary Architecture` clusters it across `Exod 12:22`, `Lev 14`, and `Num 19` (`bits=44.06`, `p_null=5.45e-14`).

5. **Living Water (`הַמַּיִם הַחַיִּים`: `H4325` + `H2416`)**:
   - `research` `set_combine` (`include: ["H4325", "H2416"]`) returned **24 verses** across the canon where water (`מַיִם`) and living (`חַי`) co-occur (from `Gen 1:20–21` swarming living creatures in waters, `Gen 6:17`, `Gen 8:1`, through `Lev 14:5–6` and `Num 19:17`).

---

### 2.2 Canonical Exclusivity & Structural Inversion: Leviticus 14 ↔ Numbers 19

- **Canonical Exhaustiveness (`set_combine` `["H0730", "H0231", "H8144"]`)**: Across the entire Bible, cedar (`H0730`), hyssop (`H0231`), and scarlet (`H8144`) co-occur in **exactly 6 verses**:
  - **Leviticus 14:4, 14:6** (cleansing a person from *tsara'at*),
  - **Leviticus 14:49, 14:51, 14:52** (cleansing a house from *tsara'at*),
  - **Numbers 19:6** (burning of the red heifer, `פָּרָה` `H6510`).
- **Intermediate Scene Bridges**: `get_Passage` surfaced two cross-book scene correspondences:
  - `r12:scene:4296:3118`: **Numbers 19:6 ↔ Leviticus 14:6** (`bits=16.08`, `p_null=1.45e-5`),
  - `r12:scene:4308:3163`: **Numbers 19:18 ↔ Leviticus 14:51**.
- **Structural & Operational Inversion (Attested Textual Contrast)**:
  - In **Leviticus 14:6**, the cedar, scarlet, and hyssop remain **unburned** and are dipped (`טָבַל` `H2881`) alongside the living bird into slain-bird blood over living water, then used to sprinkle (`נָזָה` `H5137`) seven times (`Lev 14:7`).
  - In **Numbers 19:6**, the priest casts cedar wood, hyssop, and scarlet **into the midst of the burning** of the red heifer (`שְׂרֵפָה` `H8316`), turning all three materials plus the heifer into `אֵפֶר` (`H0665`, ashes, `Num 19:9`) / `עָפָר` (`H6083`, dust, `Num 19:17`).
  - In **Numbers 19:17–19**, living water (`מַיִם חַיִּים`) is poured onto those ashes in a vessel, and a separate clean man (`אִישׁ טָהוֹר`) uses **hyssop alone** (`Num 19:18`) to sprinkle (`נָזָה` `H5137`) on days 3 and 7, followed by `וְחִטְּאוֹ` (`H2398` Piel, "de-sin / purify him", `Num 19:19`).
  - **Shared Closing Triad & Contagion Paradox**: Both rituals take place outside the camp (`מִחוּץ לַמַּחֲנֶה`, `Lev 14:3,8`; `Num 19:3,9`), culminate on the seventh day (`בַּיּוֹם הַשְּׁבִיעִי`, `Lev 14:9`; `Num 19:19`), and end with the identical three-verb purification sequence: `כָּבַס` (`H3526`, wash clothes) + `רָחַץ` (`H7364`, bathe in water) + `טָהֵר` (`H2891`, be clean). Yet in Num 19:7, 8, 21, the clean officiants and water-handlers become unclean until evening (`יִטְמָא עַד הָעָרֶב`), whereas the corpse-defiled recipient is cleansed.
- **Statistical Sequence Check (`sequence_parallels` `Lev 14:4-7 -> Num 19:6-19`)**: Returned 4 forward `CONCORDANT` clause blocks aligning `Lev 14:4–7` (`aIndices 3..8`) with `Num 19:17–19` (`bIndices 52..55`), plus a `slot_atom_shift` break at `Lev 14:7` (`Jaccard=0.105`). Crucially, `raw_score=2.13` with **`p_null=0.1077`** (`evidence_bits=0`)—confirming that clause-order alignment alone is non-significant relative to chance and that the substantive bond rests on shared rare vocabulary and ritual syntax rather than mechanical clause sequence.

---

### 2.3 Psalm 51 (MT 51:9–12 / Eng 51:7–10) and the Crucial LXX Lexical Bridge

- **Selective Reduction & Lexical Continuity**: Psalm 51:7 omits bird, cedar, scarlet, and ashes, retaining **hyssop (`אֵזוֹב`, `H0231`)**, **`כָּבַס` (`H3526`, "wash")**, and **`טָהֵר` (`H2891`, "be pure")**—with `get_Connection` explicitly identifying `shared_lemma:H3526` (`Num 19:6-19 ↔ Ps 51:7`) and `passage_root_wordplay:H2889:H2891` (`Lev 14:4-7 ↔ Ps 51:7`).
- **LXX Theological/Lexical Shift (`lxx_concordance` on `Psalms 51:7` = LXX `50:9`)**:
  - In MT `Ps 51:7` (MT v.9), the verb with hyssop is `תְּחַטְּאֵנִי` (**`חָטָא`, `H2398`** in Piel, "purge/de-sin me")—the *exact* Hebrew verb used for the day-7 purification in **`Num 19:19`** (`וְחִטְּאוֹ`) and **`Lev 14:49`** (`לְחַטֵּא`).
  - The LXX (`Ps 50:9`) translates `H2398` here neither as `ἁμαρτάνω` (118× elsewhere) nor `ἁγνίζω` (3×), but as **`ῥαντιεῖς` (`ῥαντίζω`, `G4472`, "you shall sprinkle")**, producing `ῥαντιεῖς με ὑσσώπῳ καὶ καθαρισθήσομαι` (`p_g_given_h = 0.0041`, `g_idf = 13.32`, flagged by MCP as `lexical_theological_shift`).
  - **Significance**: In the MT, `נָזָה` (`H5137`, sprinkle) appears in Lev 14 and Num 19, while `חָטָא` (`H2398`, de-sin) appears in Lev 14:49, Num 19:19, and Ps 51:7. By rendering `H2398` with `ῥαντίζω` (`G4472`), the LXX unifies Ps 51:7's hyssop-purging directly with the Greek sprinkling vocabulary (`ῥαντίζω` + `ὕσσωπος` + `καθαρίζω`) inherited by **Hebrews 9:13, 19, 21**.
- **Interiorization & Creation (`Ps 51:10` / MT `51:12`)**: Shifts from external ablution (`כָּבַס`, snow-whiteness `שֶׁלֶג` `H7950` / `לָבֵן` `H3835`) to `לֵב טָהוֹר` (`H3820` + `H2889`, "clean heart") created (`בָּרָא`, `H1254`) and a steadfast spirit (`רוּחַ`, `H7307`) renewed (`חָדַשׁ`, `H2318`).

---

### 2.4 Hebrews 9:13–23: Cross-Testament Synthesis & Composite Splicing

- **Direct Num 19 Vocabulary (`Heb 9:13`)**: `σποδὸς δαμάλεως` (`G4700` ashes + `G1151` `δάμαλις` heifer; `get_Passage` LXX data confirms `δάμαλις` renders `H6510` `פָּרָה` 6× in LXX!) + `ῥαντίζουσα` (`G4472`, rendering `H5137` `נָזָה` 2×) sanctifying (`ἁγιάζω`, `G0037`) the defiled (`κοινόω`, `G2840`) to purity of flesh—contrasted *a fortiori* with Christ's blood (`αἷμα`, `G0129`) cleansing (`καθαρίζω`, `G2511`, `Heb 9:14`) the conscience (`get_Connection` bridge `passage_lxx:H2891:G2511` linking `Lev 14:4-7` `טָהֵר` ↔ `Heb 9:13-22` `καθαρίζω`).
- **Composite Ritual Fusion (`Heb 9:19–23`)**: `Heb 9:19` adds **water, scarlet wool (`κόκκινος` `G2847`), and hyssop (`ὕσσωπος` `G5301`)** to the Sinai covenant blood-sprinkling (`ἐράντισεν`, `G4472`, vv.19, 21), generalizing in `Heb 9:22` that nearly everything is cleansed (`καθαρίζεται`, `G2511`) with blood (`G0129`) and calling the earthly ritual apparatus `ὑποδείγματα` ("copies", `G5262`) cleansed with these (`Heb 9:23`).
- **`tri_textual_diff` on `Hebrews 9:19`**: Classified `Heb 9:19` as a composite adaptation (`agrees_both=16, composite_splice=5, nt_adaptation=15`, `evidence_bits=16`), identifying **`Leviticus 14:51`** as a major splice contributor (`score=20.26, contentMatches=3`) and listing `Lev 14:6`, `Lev 14:52`, and `Exod 12:22` among `candidate_sources` (see Evaluation §3.5–3.6 for missing `Exod 24` and noisy `Neh 8:1`/`1 Sam 14:34`).

---

### 2.5 Physical Properties vs. Physical Analogies & Interpretive Hypotheses

| Element | Attested Textual / LXX Data | MCP `realworld=1` Output | Physical Analogy / Interpretive Hypothesis (Non-Textual) |
|---|---|---|---|
| **Hyssop** (`H0231` / `G5301`) | Applicator for dipping/sprinkling blood (`Exod 12:22`, `Lev 14:6`) or water-ash (`Num 19:18`); sole retained plant in `Ps 51:7`; added in `Heb 9:19` | `status: "ok"`: `domain: "botany"`, `organism: "hyssop"`, `ritual_use: "sprinkling_cleansing"`, `oewn:12226211-n` | Bristled/leafy stem holds droplets by capillary action as a natural sprinkler brush; antimicrobial thymol/aromatic oils (*Origanum syriacum*) are **not** mentioned in the texts (physical analogy only). |
| **Cedar** (`H0730` / `G7989`) | `עֵץ הָאֶרֶז` dipped unburned (`Lev 14:6`) or burned inside heifer (`Num 19:6`); absent from `Ps 51` & `Heb 9` | `status: "ok"`: `domain: "botany"`, `organism: "cedrus_libani"`, `material: "aromatic_timber"` | Rigid handle for hyssop bundle; decay-resistant / aromatic resin countering corpse/scale corruption is **not** stated in the texts (physical analogy / interpretive hypothesis). |
| **Scarlet** (`H8144`+`H8438` / `G2847`) | Construct `שְׁנִי תוֹלַעַת` (tabernacle textile dye, 34×); LXX `Lev 14:6` adds `κλωστόν` ("spun"); `Heb 9:19` `scarlet wool` | `H8144` `status: "ok"` (`oewn:04969961-n` only); `H8438` `status: "unavailable"` | Twine/yarn binding cedar + hyssop into one brush; vivid blood-red / life-color symbolism or crushed scale-insect (`Kermes`) dye analogy is **not** stated in `Lev 14`/`Num 19` (interpretive hypothesis). |
| **Bird** (`H6833`+`H2416`) | Two clean birds: one slain over living water, one living dipped and released to open field (`Lev 14:4–7`); omitted in `Num 19`, `Ps 51`, `Heb 9` | `status: "unavailable"` | Symbolic enactment of death-bearing/removal outside the camp (parallel to Azazel goat in Lev 16) is an **interpretive hypothesis**, not explicitly equated in Lev 14. |
| **Living Water** (`H4325`+`H2416`) | Running/spring water in earthen vessel (`Lev 14:5`) or over heifer ashes (`Num 19:17`) | Not queried separately via `get_Word`; `set_combine` shows 24 OT verses | Flowing water (vs. stagnant water) physically dilutes/suspends ash and blood and provides an intuitive analogy for life countering death-defilement (`Num 19`). |

---

## 3. System Evaluation

### 1. What did the MCP server help you discover that you would not easily have found otherwise?
- **Canonical boundary proof via `set_combine`**: Running `set_combine` on `["H0730", "H0231", "H8144"]` immediately proved across the entire Bible that cedar + hyssop + scarlet co-occur in **exactly 6 verses** (`Lev 14:4, 6, 49, 51, 52`; `Num 19:6`), giving exhaustive negative control that no other canonical passage has the triad.
- **LXX theological/lexical shift in `Psalms 51:7` (`lxx_concordance`)**: Flagged MT `H2398` (`חָטָא` Piel, `p_g_given_h=0.0041`, `g_idf=13.32`) -> LXX `G4472` (`ῥαντίζω`) as a `lexical_theological_shift`, illuminating the exact Greek lexical bridge from `Num 19:19` (`וְחִטְּאוֹ`) and `Ps 51:7` into `Heb 9:13, 19, 21`.
- **`tri_textual_diff` `lxx_plus_expansion` in `Lev 14:6`**: Surfaced LXX `κλωστόν` ("spun", `sum_idf=14.9`) as an expansion not present in MT, linking Hebrew `שְׁנִי הַתּוֹלַעַת` to `Heb 9:19`'s scarlet wool (`κόκκινος`) and identifying `Lev 14:51` (`score=20.26`) as a splice source.
- **Quantified construct/collocation profiles (`get_Word`)**: Confirmed `שָׁנִי`↔`תּוֹלַעַת` (NPMI=0.94, 34×, 14× construct) and `אֵזוֹב`↔`שָׁנִי` (NPMI=0.71, 6×) alongside `Temple & Sanctuary Architecture` clustering with Exodus 25–28.

### 2. Did it lead you to interesting connections?
Yes—most notably:
- The `H2398 -> G4472` (`ῥαντίζω`) bridge in `Ps 51:7` (`lxx_concordance`),
- The `κλωστόν` LXX expansion in `Lev 14:6` (`tri_textual_diff`),
- `r12:scene:4296:3118` (`Num 19:6 ↔ Lev 14:6`) and `r12:scene:4308:3163` (`Num 19:18 ↔ Lev 14:51`),
- `shared_lemma:H3526` (`כָּבַס`, "to wash", 48v) connecting `Num 19:6–19` and `Ps 51:7` (`get_Connection`),
- `G1151 δάμαλις` -> `H6510 פָּרָה` (6× in LXX) linking `Heb 9:13` directly to `Num 19`.

### 3. Were you able to investigate the connections further?
Partially, with notable friction:
- Targeted follow-ups via `get_Word` and batched `research` ops (`set_combine`, `lxx_concordance`, `tri_textual_diff`, `sequence_parallels`) worked cleanly and fast (3.5–20 s).
- However, `follow_connectionchain` from `Leviticus 14:6` (without `axis_filter`) filled 7 of 8 `next_connections` with **same-chapter** `Lev 14` self-links (`Lev 14:4, 49, 51, 52`) rather than cross-book ritual links (`Num 19:6`, `Heb 9:19`).
- `research` `expand_clue` rejected `"detail":"evidence"` (expecting `"clue"|"compact"|"standard"|"deep"|"summary"|"full"`), whereas `get_Passage`/`get_Word`/`get_Connection` use `view: "clues"|"evidence"|"full"`.
- Multi-verse `get_Passage` (`13–22` verses) and 4–8 op `research` outputs reached 30–86 KB wire bytes (up to 162 KB uncompressed text in stdout), causing CLI output truncation and requiring smaller follow-up queries.

### 4. Did it provide intermediate clues that helped you progress?
Yes:
- `get_Passage` clues `r12:scene:4296:3118` and `r12:scene:4308:3163` bridged `Num 19` to `Lev 14:6` and `14:51`.
- `get_Connection`'s `graph_proof` (`cycle_network`, 5 independent edges) verified connectivity across all 4 passages.
- `get_Word` and `get_Passage` LXX tables surfaced `G2847`, `G5301`, `G4472`, `G1151`, and `G2511`, which directly guided the `lxx_concordance` and `tri_textual_diff` follow-ups.

### 5. Were there important relationships you expected to see that were missing or hard to find?
Yes—three significant gaps:
1. **`get_Connection` missed the core shared ritual term across all 4 passages**: Comparing `["Leviticus 14:4-7", "Numbers 19:6-19", "Psalms 51:7", "Hebrews 9:13-22"]` returned only 5 `connections` (despite `connections=15`) and **omitted `אֵזוֹב` (`H0231`) ↔ `ὕσσωπος` (`G5301`)**—the only material present in *all four* passages—as well as `נָזָה` (`H5137`) ↔ `ῥαντίζω` (`G4472`) and `שָׁנִי` (`H8144`) ↔ `κόκκινος` (`G2847`). It stopped after constructing one 5-edge spanning cycle (`טָהֵר`/`כָּבַס`/`מוּת`).
2. **Sparse `realworld` coverage for ritual materials**: `H8438` (`תּוֹלַעַת`) and `H6833` (`צִפּוֹר`) had `realworld.status = "unavailable"`; `H8144` (`שָׁנִי`) returned only an unlabelled OEWN synset (`oewn:04969961-n`). Even `H0231` and `H0730` had only minimal tags (`sprinkling_cleansing`, `cedrus_libani`, `aromatic_timber`), offering little help on physical-material analogies.
3. **`tri_textual_diff` on `Hebrews 9:19` missed `Exodus 24:6–8`**: The actual primary Sinai covenant blood passage cited by `Heb 9:19–20` was absent from `candidate_sources`.

### 6. Were there distracting or falsely elevated results?
Yes:
- **`get_Passage` generic Pentateuch/entity noise**:
  - `Lev 14:1-9` surfaced `r13:colloc:H4872:H6680` ("Moses" ↔ "command", 133×, `bits=0, p_null=1`) in its top 5 clues.
  - `Num 19:1-22` ranked `r13:motif:chain:H1648:H1649:H4847:H0175` ("Gershon/Gershonite/Merari/Aaron", `bits=0.63, p_null=0.649`) #1 and `Exod 4:14` (`Moses + Aaron + YHWH`) #3, triggered by the `Num 19:1` speech formula.
  - `Ps 51:0-19` ranked a named-entity bridge (`H5416` Nathan in `Ps 51:2/0` ↔ `G3481` Nathan in `Luke 3:31` genealogy, `bits=22.54`) as #1.
- **`tri_textual_diff` on `Heb 9:19`**: Elevated `Nehemiah 8:1` ("law... Moses") and `1 Samuel 14:34` ("all the people... blood") as top `splices` ahead of `Lev 14:6` while missing `Exod 24:6–8`.
- **`get_Word` lexical-root artifacts**: `H0231` (`אֵזוֹב`) elevated proper name `H0229` (`אֶזְבָּי`, Ezbai, `bits=36.51, p_null=1.02e-11`) and `H8438` listed `H3216` (`יָלַע`, "to blurt") as root-anchor relatives (though `spelling_suggestions` were cleanly disclaimed).

### 7. How clear, compact, and usable was the presentation of results?
- **Strong**: `get_Word` (~5–6 KB, 3.5–12.7 s) and `get_Connection` (~6–7 KB) are well-organized, readable, and clearly separate epistemic tiers (`direct_textual_evidence`, `documented_lexical_relationship`, `editorial_cross_reference`) alongside `e_perp` bits and `p_null`.
- **Needs improvement**:
  - `get_Passage` was heavy and slow (31–77 s, 15–50 KB); even `compact=true` still emitted full per-word `lexicon` + `lxx` entries (48 KB for `Heb 9:13-22`), causing output truncation.
  - `realworld.property_bridges` exposed raw synset IDs (`oewn:12226211-n`, `oewn:04969961-n`) without English glosses.
  - `tri_textual_diff` truncated `tokens_preview` at token 15 of 36, cutting off the key ritual phrase (`water, scarlet wool, hyssop`) in `Heb 9:19`.
  - Parameter naming inconsistency between `view` (`clues|evidence|full`) and `expand_clue` `detail` (`clue|compact|standard|deep|summary|full`).

### 8. What additional capability would most help this kind of research?
1. **Multi-anchor intersection mode in `get_Connection`**: Surface *all* shared/LXX-bridged lemmas ranked by **anchor coverage** (e.g., `H0231`/`G5301` appearing in 4/4 passages, `H5137`/`G4472` in 3/4) rather than halting once a minimal spanning cycle is found.
2. **Human-readable `realworld` property resolution & broader material coverage**: Resolve `oewn:*` synset IDs to English labels/definitions and populate physical-property records for biblical flora/fauna/dyes like `H8438` and `H6833`.
3. **Lightweight `get_Passage` text-only projection**: Add a `lexicon=false` or `view="text"` option returning original text, glosses, and Strong's IDs in <3 KB / <3 s without 30 KB of dictionary/LXX tables, and allow full token alignment inspection in `tri_textual_diff`.
4. **IDF / formulaic-frame down-weighting**: Suppress ubiquitous speech-introduction hubs (`Moses`, `Aaron`, `YHWH`, `command`) and genealogical homonyms in `get_Passage` and `follow_connectionchain` so thematic/ritual bridges surface first.
