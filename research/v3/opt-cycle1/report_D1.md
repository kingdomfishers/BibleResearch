# Research Report (D1): Distributed Clues and Typology Linking Genesis 38, Ruth 4, and Matthew 1:1–6

**Researcher:** Independent Biblical Scholar (Blind Evaluation Arm)  
**Target Corpus & Environment:** Local BibleResearch MCP (`--target local --no-supabase`), STEP Hebrew/Aramaic OT, NA28-membership Greek NT, Rahlfs 1935 / Swete LXX, World English Bible (WEB)  
**Date:** 2026-11-25  
**Log File:** `research/v3/opt-cycle1/local_D1.jsonl`

---

## 1. Summary of MCP Tool Calls Executed

In addition to one initial schema discovery call (`--list-tools`, `latency_ms: 4176`, `wire_bytes: 16099`, `payload_bytes: 30058`), **18 logged MCP tool calls** were executed:

| # | Tool | Key Arguments | Latency (ms) | Wire Bytes | Payload Bytes | Status / Notes |
|---:|---|---|---:|---:|---:|---|
| 1 | `get_prompt` | `{}` | 2,760 | 10,756 | 5,241 | `ok` |
| 2 | `get_Passage` | `{"passage":"Genesis 38","depth":5,"literary":1,"limit":30}` | 42,093 | 57,882 | 50,310 | `ok` (30/30 verses) |
| 3 | `get_Passage` | `{"passage":"Ruth 4","depth":5,"literary":1,"limit":30}` | 88,079 | 50,420 | 43,725 | `ok` (22/22 verses) |
| 4 | `get_Passage` | `{"passage":"Matthew 1:1-6","depth":5,"literary":1}` | 77,188 | 16,817 | 14,446 | `ok` (6/6 verses) |
| 5 | `get_Connection` | `{"items":["Genesis 38","Ruth 4","Matthew 1:1-6"],"connections":25,"view":"clues"}` | 88,518 | 5,582 | 4,874 | `ok` (triangle proof, 5 cards) |
| 6 | `research` | `operations`: `passage_compare` (Gen 38, Ruth 4, Matt 1:1-6), `sequence_parallels` (Gen 38→Ruth 4), `wordplay_scan` (Gen 38, Ruth 4), `view:"clues"` | 230,924 | 69,680 | 62,982 | `ok` |
| 7 | `get_Word` | `{"word":"H6162","connections":15,"etymology":5,"realworld":1,"view":"clues"}` | 10,945 | 4,311 | 3,759 | `ok` (עֵרָבוֹן) |
| 8 | `get_Word` | `{"word":"H8144","connections":15,"etymology":5,"realworld":1,"view":"clues"}` | 11,552 | 5,872 | 5,164 | `ok` (שָׁנִי) |
| 9 | `research` | `operations`: `genealogy` (Perez, Boaz, `generations:2`), `literary_structure` (Gen 38, Ruth 4, `detail:"standard"`, `compare_lxx:true`), `view:"clues"` | 10,991 | 317,881 | 280,429 | `ok` |
| 10 | `research` | `operations`: `occurrences` (`H2992`, `H5234`, `H6555`, `H8380`, `H5275`, `G0728`), `lxx_concordance` (`lemma:"H6557"`), `tri_textual_diff` (`Matthew 1:1-6`), `view:"clues"` | 39,198 | 73,132 | 68,496 | `ok` (`lxx_perez` `not_found` due to `lemma` vs `strongs` param; `tri_matt` covered vv. 1–4) |
| 11 | `get_Passage` | `{"passage":"Deuteronomy 25:5-10","depth":5,"literary":1}` | 33,428 | 19,405 | 16,857 | `ok` (6/6 verses) |
| 12 | `follow_connectionchain` | `{"next":"Genesis 38:28","limit":8,"view":"clues"}` | 25,294 | 6,575 | 5,794 | `ok` (8 neighbor clues, returned `ch_...` handle) |
| 13 | `follow_connectionchain` | `{"chain":"ch_13aba2a4...","action":"follow","next":"Joshua 2:18","next_id":"v3:bmw:5888","limit":8,"view":"clues"}` | 2,025 | 204 | 81 | `error` (`chain_not_found` across separate CLI invocations) |
| 14 | `research` | `operations`: `lxx_concordance` (`strongs:"H6557"`, `"H1350"`, `"H2368"`), `occurrences` (`G2847`, `H8559`, `H6557`), `view:"clues"` | 5,082 | 43,273 | 39,269 | `ok` |
| 15 | `get_Passage` | `{"passage":"Joshua 2:18-21","depth":5,"literary":0}` | 24,027 | 14,960 | 13,014 | `ok` (4/4 verses) |
| 16 | `research` | `operations`: `expand_clue` ×4 (`detail:"evidence"`), `view:"evidence"` | 3,510 | 1,389 | 1,083 | `invalid_request` (outer schema vs op enum mismatch) |
| 17 | `research` | `operations`: `expand_clue` ×4 (`detail:"full"` on `r13:interp:7202:name:H1035`, `r11:xref:1144:3355`, `passage_lex_bridge:H8559:G2283`, `v3:bmw:5888`), `view:"full"` | 4,713 | 33,077 | 28,783 | `ok` (3 hydrated; `passage_lex_bridge:H8559:G2283` returned `not_found`) |
| 18 | `research` | `operations`: `occurrences` (`H2368`, `H6616`, `H8615`, `G4477`, `H6663`), `lxx_concordance` (`strongs:"H8559"`), `view:"clues"` | 9,138 | 39,814 | 36,940 | `ok` |

---

## 2. Textually Verified Discoveries

Throughout this report, **attested textual/original-language evidence** (a), **linguistic/grammatical/LXX relationships** (b), **structural/rhetorical/wordplay parallels** (c), **physical/real-world analogs** (d), and **interpretive hypotheses** (e) are kept strictly distinct.

### 2.1 Macro-Graph Proof Across the Three Passages
`get_Connection` on `["Genesis 38", "Ruth 4", "Matthew 1:1-6"]` established a complete 3-edge **triangle proof** (`r13:proof:triangle:Genesis 38+Ruth 4+Matthew 1:1-6`):
- **Genesis 38 ↔ Matthew 1:1–6** (`passage_lex_bridge:H8559:G2283`, tier 2): Original-language proper-name bridge `תָּמָר` (`H8559`, Gen 38:6, 11, 13, 24) ↔ `Θάμαρ` (`G2283`, Matt 1:3).
- **Ruth 4 ↔ Matthew 1:1–6** (`passage_lex_bridge:H1162:G1003`, tier 2): `בֹּעַז` (`H1162`, Ruth 4:1–21) ↔ `Βόες` / `Βοόζ` (`G1003`, Matt 1:5).
- **Genesis 38 ↔ Ruth 4** (`r11:xref:1128:7196`, `r11:xref:1129:7201`, tier 4 editorial cross-references): Gen 38:8 ↔ Ruth 4:5–11 (levirate duty to raise up offspring/name) and Gen 38:9 ↔ Ruth 4:10 ("offspring would not belong to him").

`passage_compare` further surfaced **18 shared Hebrew lemmas** between Genesis 38 and Ruth 4 (including `H0802` אִשָּׁה 6×/6×, `H5414` נָתַן 8×/4×, `H0251` אָח 8×/2×, `H7121` קָרָא 5×/4×, `H3427` יָשַׁב 3×/6×, `H3027` יָד 7×/2×, `H3947` לָקַח 5×/3×, `H0935` בּוֹא 6×/2×, `H1121` בֵּן 5×/3×, `H4191` מוּת 4×/4×, `H8559` תָּמָר 5×/1×, `H1004` בַּיִת 2×/4×, `H6965` קוּם 2×/3×, `H2233` זֶרַע 3×/1×, `H3618` כַּלָּה 3×/1×) and **LXX-bridged lemmas** across all three passages:
- `יָלַד` (`H3205`) ↔ `γεννάω` (`G1080`, 167× in LXX) and `γένεσις` (`G1078`, 3× in LXX) across Gen 38, Ruth 4, and Matt 1:1–6.
- `בֵּן` (`H1121`) / `בַּיִת` (`H1004`) / `בָּנָה` (`H1129`) ↔ `υἱός` (`G5207`).
- `פֶּרֶץ` (`H6557`) ↔ `Φάρες` (`G5329`, 15× in LXX) across Gen 38:29, Ruth 4:12, 18, and Matt 1:3.

---

### 2.2 Legal & Institutional Clues (Genesis 38 ↔ Deuteronomy 25:5–10 ↔ Ruth 4)

1. **Exclusive Levirate Verb `יָבַם` (`H2992`, a/b):**
   - `occurrences` confirmed `H2992` occurs **only 3 times in the entire OT**: `Genesis 38:8` (`וְיַבֵּם אֹתָהּ`, Judah commanding Onan) and `Deuteronomy 25:5, 7` (`וְיִבְּמָהּ` / `יַבְּמִי`, the Torah levirate statute).
   - Both Gen 38:8 and Deut 25:7 pair this duty with `קוּם` (`H6965`, "raise up") for a brother (`אָח`, `H0251`): Gen 38:8 uses `וְהָקֵם זֶרַע לְאָחִיךָ` ("raise up offspring for your brother"), while Deut 25:7 uses `לְהָקִים לְאָחִיו שֵׁם בְּיִשְׂרָאֵל` ("raise up a name for his brother in Israel"). Ruth 4:5, 10 synthesizes these exact phrases: `לְהָקִים שֵׁם־הַמֵּת עַל־נַחֲלָתוֹ` ("to raise up the name of the dead upon his inheritance").

2. **Refusal & "Ruining" (`שָׁחַת`, `H7843`, a/b):**
   - In `Genesis 38:9`, Onan refuses levirate progeny because `"the offspring would not be his"` (`לֹא לוֹ יִהְיֶה הַזָּרַע`), and `"spoiled/ruined"` (`וְשִׁחֵת`, `H7843`) on the ground.
   - In `Ruth 4:6`, the closer unnamed redeemer (`פְּלֹנִי אַלְמֹנִי`, Ruth 4:1) refuses when told he must acquire Ruth as well (`4:5`), using the **exact same verb `H7843`**: `פֶּן־אַשְׁחִית אֶת־נַחֲלָתִי` ("lest I ruin/impair my own inheritance").

3. **The Sandal Ritual (`נַעַל`, `H5275`) and Gate Court (`שַׁעַר`, `H8179`, a/c):**
   - In `Deut 25:7–10`, refusal is adjudicated at the gate (`הַשַּׁעְרָה אֶל־הַזְּקֵנִים`, `H8179` + `H2205`) and marked by the widow loosing the sandal (`וְחָלְצָה נַעֲלוֹ`, `H2502` + `H5275`), branding the refuser's lineage `בֵּית חֲלוּץ הַנָּעַל` ("house of him whose sandal was removed").
   - In `Ruth 4:1–2, 7–8`, Boaz convenes ten city elders (`זִקְנֵי הָעִיר`, `H2205`) at the gate (`הַשַּׁעַר`, `H8179`). Rather than spitting and shaming (`Deut 25:9`), the unnamed kinsman removes his own sandal (`וַיִּשְׁלֹף נַעֲלוֹ`, `H8025` + `H5275`) and gives it to his neighbor (`וְנָתַן לְרֵעֵהוּ`) as formal attestation (`תְּעוּדָה`, `H8584`) of redemption (`גְּאֻלָּה`, `H1353`) and exchange (`תְּמוּרָה`, `H8545`).
   - *Interpretive hypothesis (e):* Whereas the unnamed kinsman preserves his own estate and becomes nameless (`פְּלֹנִי אַלְמֹנִי`, Ruth 4:1; LXX `κρύφιε`), Boaz accepts the levirate-redemption obligation and secures his house in the royal genealogy (`Ruth 4:11–12, 21–22`).

4. **LXX Legal Differentiation of `גָּאַל` (`H1350`) in Ruth 4 (b):**
   - `literary_structure` (`compare_lxx: true`) and `lxx_concordance` on `H1350` show that while Rahlfs/Swete LXX normally renders `גָּאַל` as `λυτρόω` (46×, e.g., Exodus/Deuteronomy ransom), in **Ruth 3:9; 4:1, 3, 6, 8, 14** it shifts consistently to `ἀγχιστεύς` / `ἀγχιστευτής` / `ἀγχιστεύω` / `ἀγχιστεία` ("next-of-kin / kinship-right", `p_g_given_h = 0.0588`, `g_idf = 12.09`–`14.9`), explicitly distinguishing familial-levirate succession from monetary redemption.

5. **Capital Judgment (`שָׂרַף`, `H8313`) vs. Judicial Vindication (`צָדֵק`, `H6663`, a/c):**
   - `r11:xref:1144:3355` (expanded in Call 17) links Judah's sentence on Tamar in `Gen 38:24` (`הוֹצִיאוּהָ וְתִשָּׂרֵף`, "bring her out and let her be burned", `H8313`) with `Lev 21:9` (`בָּאֵשׁ תִּשָּׂרֵף`, `H8313`), the Torah penalty for a priest's daughter who profanes herself by `זָנָה` (`H2181`).
   - Tamar overturns the sentence by compelling Judah to examine the pledge (`הַכֶּר־נָא`, `H5234`, Gen 38:25), leading to his confession `צָדְקָה מִמֶּנִּי` (`H6663`, Gen 38:26). Notably, `occurrences` of `H6663` (`צָדֵק`) shows Judah uses this verb **only twice in Genesis**: here (`Gen 38:26`, confessing Tamar's superior righteousness) and before Joseph (`Gen 44:16`, `וּמַה־נִּצְטַדָּק`, "how can we clear ourselves?").

---

### 2.3 Pledge Items (`עֵרָבוֹן`) & the Recognition Motif (`נָכַר`)

1. **Hapax/Rare Pledge Vocabulary: `עֵרָבוֹן` (`H6162`) → LXX `ἀρραβών` (`G0728`) (a/b):**
   - `get_Word` on `H6162` (`עֵרָבוֹן`, "pledge") established that it appears in **only 3 OT verses**, all in this episode (`Genesis 38:17, 18, 20`), derived from root `עָרַב` (`H6148`, "to pledge / stand surety").
   - In the LXX, `H6162` is rendered exclusively by `ἀρραβών` (`G0728`, 3×). `occurrences` on `G0728` confirmed that `ἀρραβών` occurs **only 3 times in the NT**: `2 Cor 1:22`, `2 Cor 5:5`, and `Eph 1:14` (`ὅς ἐστιν ἀρραβὼν τῆς κληρονομίας ἡμῶν`, "guarantee of our inheritance"). Remarkably, `2 Cor 1:22` pairs `ἀρραβῶνα` with `σφραγισάμενος` ("having sealed us")—mirroring Judah's `עֵרָבוֹן` consisting first of his **signet** (`חֹתָם`, `H2368`, rendered `σφραγίς` in LXX)!

2. **The Three Pledge Items (`Gen 38:18, 25`) — Royal & Priestly Distribution (a/b/e):**
   - **Signet (`חֹתָם` / `חֹתֶמֶת`, `H2368` / `H2858`, 13× in OT):** `occurrences` and `lxx_concordance` (`H2368` → `σφραγίς` 10×) show three major clusters outside Gen 38: (i) the High Priest's engraved tribal stones and golden crown plate (`Exod 28:11, 21, 36; 39:6, 14, 30`, `פִּתּוּחֵי חֹתָם`), (ii) Ahab's royal letters (`1 Kgs 21:8`), and (iii) **Davidic royal succession** in `Jer 22:24` (Coniah/Jeconiah plucked off as YHWH's right-hand signet, `חוֹתָם`) and `Hag 2:23` (Zerubbabel restored: `וְשַׂמְתִּיךָ כַּחוֹתָם`)—both kings named in Matthew's genealogy (`Matt 1:11–13`)!
   - **Cord (`פָּתִיל`, `H6616`, 11× in OT):** Aside from `Gen 38:18, 25`, Judges 16:9, Num 19:15, and Ezek 40:3, `H6616` appears almost exclusively for the High Priest's blue cord (`פְּתִיל תְּכֵלֶת` in `Exod 28:28, 37; 39:3, 21, 31`) and Israel's covenantal fringes (`Num 15:38`).
   - **Staff (`מַטֶּה`, `H4294`):** Symbol of tribal/personal identity and authority (also spelled/paired with tribal "branch/tribe" in Hebrew usage).

3. **The Recognition Motif: `נָכַר` (`H5234`) & Goat-Exchange Irony (a/c):**
   - `occurrences` of `H5234` (`נָכַר`, "recognize/discern/acknowledge") directly surfaces a striking inner-Genesis and Genesis–Ruth lexical arc:
     - `Gen 37:32–33`: Judah's brothers send Joseph's bloodied (goat-dipped) tunic to Jacob with the imperative **`הַכֶּר־נָא`** ("Please examine/recognize…"), and Jacob recognized it (`וַיַּכִּירָהּ`).
     - `Gen 38:25–26`: Tamar sends Judah's signet, cords, and staff back to him with the **verbatim imperative `הַכֶּר־נָא`** ("Please examine/recognize…"), and Judah recognized them (`וַיַּכֵּר יְהוּדָה`). Moreover, Judah had promised a kid of the goats (`גְּדִי־עִזִּים`, `H1423+H5795`, `Gen 38:17, 20, 23`) that never reached her!
     - `Ruth 2:10, 19; 3:14`: `H5234` recurs three times in Ruth, notably `Ruth 2:10` where Ruth pairs `לְהַכִּירֵנִי` (`H5234`, "to take notice of me") with `נָכְרִיָּה` ("a foreigner", from the same consonantal root `נכר`), highlighting Boaz's gracious recognition of a foreign widow—the exact inverse of Judah's initial failure to recognize his veiled daughter-in-law (`Gen 38:15–16`).

---

### 2.4 Scarlet (`שָׁנִי`), Twins (`תּוֹאָם`), and the Rahab Bridge (`Joshua 2:18–21`)

1. **Scarlet (`שָׁנִי`, `H8144`) ↔ Second (`שֵׁנִי`, `H8145`) Wordplay in Gen 38:28–30 (a/c):**
   - `get_Word` on `H8144` (`שָׁנִי`, 42× in OT) immediately surfaced `H8145` (`שֵׁנִי`, `she.ni`, "second") under `ambiguous_candidates` and `spelling_suggestions` (shared consonants `שני`), while explicitly disclaiming historical etymology.
   - In `Gen 38:28–30`, the midwife ties a scarlet thread (`שָׁנִי`, `H8144`) on the hand (`יָד`, `H3027`) that emerges first (`רִאשֹׁנָה`, `H7223`), declaring `"This one came out first"` (`זֶה יָצָא רִאשֹׁנָה`). Yet he draws back his hand, Perez breaches ahead, and the twin wearing `הַשָּׁנִי` (`H8144`) comes out **second** (`שֵׁנִי` in sense, `אַחַר` in v. 30).

2. **Scarlet Bridge to Rahab (`Gen 38:28` ↔ `Joshua 2:18, 21` ↔ `Matt 1:5`, a/b/c):**
   - `follow_connectionchain` (seeded at `Genesis 38:28`) and `get_Word(H8144)` directly bridged `Gen 38:28` to **`Joshua 2:18` and `2:21`** via multi-term rare-lemma convergence (`v3:bmw:5888`, `v3:bmw:5891`): both passages uniquely combine **`קָשַׁר` (`H7194`, "to bind/tie") + `שָׁנִי` (`H8144`, "scarlet")**.
   - Inspecting `Joshua 2:18–21` via `get_Passage` verified:
     - `Josh 2:18`: `תִּקְוַת חוּט הַשָּׁנִי הַזֶּה תִּקְשְׁרִי בַּחַלּוֹן` ("tie this cord of scarlet thread in the window").
     - `Josh 2:21`: `וַתִּקְשֹׁר אֶת־תִּקְוַת הַשָּׁנִי בַּחַלּוֹן` ("she tied the scarlet cord in the window").
   - Furthermore, `occurrences` of `תִּקְוָה` (`H8615`, 33×) reveals a striking canonical sequence in its first three occurrences: `Josh 2:18` ("cord"), `Josh 2:21` ("cord"), and **`Ruth 1:12`** (`יֶשׁ־לִי תִקְוָה`, Naomi speaking of "hope" of a husband and sons)!
   - In the LXX, `שָׁנִי` (`H8144`) is translated by `κόκκινος` (`G2847`, 26×, including `Gen 38:28, 30` and `Josh 2:18`), which recurs 6× in the NT (`Matt 27:28` scarlet robe; `Heb 9:19` scarlet wool of covenant sprinkling; `Rev 17:3–4; 18:12, 16`).
   - *Interpretive hypothesis (e):* In both Tamar's birth narrative (`Gen 38:28–30`) and Rahab's rescue (`Josh 2:18–21`), a tied scarlet thread (`קָשַׁר` + `שָׁנִי`) serves as an identifying sign at a threshold of life/death and inclusion into Israel—illuminating why `Matthew 1:3, 5` pairs **Tamar** and **Rahab** alongside **Ruth** in the lineage of Jesus.

3. **Twins (`תּוֹאָם`, `H8380`, 6× in OT) and Breach Paronomasia (`פָּרַץ` / `פֶּרֶץ`, `H6555`–`H6557`, a/c):**
   - `occurrences` of `H8380` (`תּוֹאָם`, "twins") appears only 6× in the OT: `Gen 25:24` (Rebekah's twins Jacob & Esau), `Gen 38:27` (Tamar's twins Perez & Zerah), `Exod 26:24; 36:29` (coupled tabernacle frames), and `Song 4:5; 7:3`. Both Genesis twin births (`25:24–26` and `38:27–30`) feature a prenatal struggle/hand-grasp and reversal of primogeniture (`בְּכוֹר` status), and both narratives feature `נָכַר` (`H5234`: Gen 27:23 vs. Gen 38:25–26).
   - `wordplay_scan` and `literary_structure` confirm `attested_textual_wordplay` (`confidence: 0.95`, `naming_etiological_formula`, `proper_name_paronomasia`) in `Gen 38:29`: `פָּרַצְתָּ` (`H6555`) → `פָּרֶץ` (`H6556`, "a breach") → `פָּרֶץ` (`H6557`, Perez), sharing exact consonants `פרצ`.
   - `occurrences` of `H6555` (`פָּרַץ`) connects Tamar's breach birth to patriarchal blessing (`Gen 28:14`, `וּפָרַצְתָּ` "you shall spread abroad"; `Gen 30:30, 43`, Jacob increasing), Exodus multiplication (`Exod 1:12`), and Davidic breakthroughs (`2 Sam 5:20` Baal-perazim; `2 Sam 6:8` / `1 Chr 13:11` Perez-uzzah).
   - `lxx_concordance` of `H6557` (`פֶּרֶץ`, 13 MT verses) shows consistent LXX rendering `Φαρές` (`15×`), linking `Gen 38:29`, `Gen 46:12`, `Num 26:16–17`, `Ruth 4:12, 18`, `1 Chr 2:4–5; 4:1; 9:4; 27:3`, `Neh 11:4, 6` directly to `Matt 1:3` (`Φαρές`, `G5329`).

---

### 2.5 Royal Genealogy, Structural Architecture, and Matthew 1:1–6

1. **Internal Literary Structure of Genesis 38 & Ruth 4 (`literary_structure`, c):**
   - **Genesis 38:** Structured around an introduction (`Gen 38:1–7`) and **3 parallel units** (`38:8–10`, `38:11–22`, `38:23–30`) opened by `וַיֹּאמֶר יְהוּדָה` (`H559+H3063`), bounded by a **chapter-level inclusio** (`38:1` ↔ `38:30`) on `אָח` (`H251`, "brothers/brother") and `שֵׁם` (`H8034`, "name") (`score: 2.8`, `confidence: 0.75`). Notable grammatical `deviations` occur on `שְׁבִי` (`38:11`, 2fs command to Tamar) and `הוֹצִיאוּהָ` (`38:24`, 2mp command to execute Tamar). `wordplays` also highlight syntactic talion in `38:11` (`שְׁבִי` ↔ `וַתֵּשֶׁב`, `H3427`) and `38:17` (`אֲשַׁלַּח` ↔ `שָׁלְחֶךָ`, `H7971`).
   - **Ruth 4:** Structured into **8 parallel speech/action units** (`4:3–14`) framed by Boaz's gate assembly (`4:1–2`) and the concluding blessing, birth, and Davidic `toledot` (`4:15–22`), with `כַּלָּה` (`H3618`, "daughter-in-law", Ruth 4:15) echoing Tamar's designation in Gen 38:11, 16, 24 (`H3618`).
   - **Scriptural Self-Interpretation (`r13:interp:7202:name:H1035`, tier 1, a/c):** `Ruth 4:11` explicitly links `בֵּית לֶחֶם` (`H1035`, Bethlehem) with `בַּיִת` (`H1004`, `"the woman who has come into your house [בֵּיתֶךָ] ... built the house [בֵּית] of Israel ... proclaim a name in Bethlehem [בְּבֵית לָחֶם]"`), immediately followed in `4:12` by `"Let your house [בֵיתְךָ] be like the house [כְּבֵית] of Perez, whom Tamar bore to Judah"`.

2. **Tri-Textual Splices & LXX Witness in Matthew 1:1–6 (`tri_textual_diff`, `lxx_concordance`, `genealogy`, a/b):**
   - `tri_textual_diff` on `Matthew 1:1–4` identifies composite splices from **`Genesis 25:19`** (`βίβλος γενέσεως` / Isaac; cf. `Gen 5:1` `סֵפֶר` → `βίβλος` and `Gen 2:4` `תוֹלְדוֹת` → `βίβλος`), **`Ruth 4:18`** (`וְאֵלֶּה תּוֹלְדוֹת פֶּרֶץ`: Perez → Hezron), **`Ruth 4:19`** (Hezron → Ram → Amminadab), and `1 Chr 4:8` (formulaic `δὲ ἐγέννησεν`).
   - `lxx_concordance` on `H8559` (`תָּמָר`) reveals a subtle orthographic/textual witness: the LXX distinguishes **`Θαμαρ`** (7×: **Genesis 38 & Ruth 4:12**) from **`Θημαρ`** (15×: David's daughter Tamar in 2 Sam 13 / 14:27 / 1 Chr 3:9). Matthew 1:3 (`ἐκ τῆς Θάμαρ`, `G2283`) matches the Genesis 38 / Ruth 4:12 LXX spelling!
   - `Matt 1:1–6` includes four distinctive anomalies in its strict `A ἐγέννησεν τὸν B` chain:
     1. `"Judah and his brothers"` (`1:2`, `καὶ τοὺς ἀδελφοὺς αὐτοῦ`), evoking the fraternal/levirate solidarity violated in Gen 38.
     2. Both twins `"Perez and Zerah by Tamar"` (`1:3`, `τὸν Φαρὲς καὶ τὸν Ζαρὰ ἐκ τῆς Θάμαρ`), preserving the Gen 38:27–30 dual-birth memory (`1 Chr 2:4` also names both, whereas `Ruth 4:12, 18` names Perez alone).
     3. Foreign/marginalized mothers (`ἐκ τῆς Θάμαρ` `1:3`, `ἐκ τῆς Ῥαχάβ` `1:5`, `ἐκ τῆς Ῥούθ` `1:5`, `ἐκ τῆς τοῦ Οὐρίου` `1:6`), uniting the Tamar, Rahab (scarlet cord), and Ruth (levirate-redemption) narratives in the line culminating in **`Δαυεὶδ τὸν βασιλέα`** (`G1138` + `G0935`, `1:6`).

---

## 3. System Evaluation

### 1. What did the MCP help me discover that I would otherwise likely have missed?
- **The `follow_connectionchain` / `get_Word(H8144)` scarlet-cord bridge to Joshua 2:18, 21:** While Rahab is in Matt 1:5, I would not have immediately noticed the exact two-lemma co-occurrence (`קָשַׁר` `H7194` "tie" + `שָׁנִי` `H8144` "scarlet") binding `Gen 38:28` specifically to `Josh 2:18, 21`, nor that `תִּקְוָה` (`H8615`) transitions in its first three canonical occurrences from Rahab's scarlet `"cord"` (`Josh 2:18, 21`) to Naomi's `"hope"` of levirate offspring (`Ruth 1:12`).
- **The LXX orthographic split on Tamar (`Θαμαρ` vs. `Θημαρ`):** `lxx_concordance(H8559)` revealed that LXX uses `Θαμαρ` (7×) for Genesis 38 / Ruth 4:12 and `Θημαρ` (15×) for 2 Sam 13 / 1 Chr 3:9, confirming Matt 1:3 (`Θάμαρ`) aligns directly with the Gen 38 / Ruth 4 LXX witness.
- **LXX lexical differentiation of `גָּאַל` (`H1350`) in Ruth 4:** `literary_structure(compare_lxx: true)` and `lxx_concordance(H1350)` surfaced the systematic LXX shift from `λυτρόω` (ransom) to `ἀγχιστεύς` / `ἀγχιστεία` (next-of-kin) in Ruth 3–4.
- **Onan's `שָׁחַת` (`H7843`) echoed in the closer kinsman's `אַשְׁחִית` (`Ruth 4:6`)** and **`חֹתָם` (`H2368`) connecting Judah's signet to Coniah (`Jer 22:24`) and Zerubbabel (`Hag 2:23`)**, plus `2 Cor 1:22` pairing `σφραγισάμενος` with `ἀρραβῶνα` (`G0728`, LXX of `H6162` `עֵרָבוֹן`).
- **The exact distribution counts** of rare terms (`H2992` `יָבַם` = 3×; `H6162` `עֵרָבוֹן` = 3×; `G0728` `ἀρραβών` = 3×; `H8380` `תּוֹאָם` = 6×; `H6616` `פָּתִיל` = 11×; `H2368` `חֹתָם` = 13×).

### 2. Did it lead me towards genuinely interesting connections?
Yes. Beyond obvious proper-name links (Tamar, Perez, Boaz, David), the MCP surfaced genuinely rich cross-book lexical, legal, and LXX connections: `H8144`+`H7194` (`Gen 38:28` → `Josh 2:18, 21`), `H8144`↔`H8145` (`שָׁנִי`/`שֵׁנִי`), `H6162`→`G0728` (`עֵרָבוֹן`→`ἀρραβών` + `H2368`→`σφραγίς` in `2 Cor 1:22`), `H5234` (`הַכֶּר־נָא` Gen 37:32 → 38:25 → Ruth 2:10), and `Ruth 4:11`'s self-interpretive `בֵּית לֶחֶם` ↔ `בַּיִת` etiology (`r13:interp:7202:name:H1035`).

### 3. Could I investigate those connections further using the available functions?
Mostly yes, with three concrete friction points:
1. **`follow_connectionchain` statefulness vs. CLI invocation:** Calling `follow_connectionchain` in step 12 returned a valid `chain` handle, but calling `action: "follow"` with that handle in step 13 returned `chain_not_found` because each CLI run spawns an ephemeral local server process where in-memory chain state is lost.
2. **`expand_clue` handle coverage and schema mismatch:** `get_Connection` returned `expand_id: "passage_lex_bridge:H8559:G2283"`, which returned `status: "not_found"` when passed to `research(op:"expand_clue")` (whereas `r13:interp:...`, `r11:xref:...`, and `v3:bmw:...` hydrated cleanly). Also, `research` outer schema `detail` enum lacks `"evidence"`, while `expand_clue` demands `"clue"|"evidence"|"full"`, causing `"evidence"` to fail validation (step 16) until switched to `"full"` (step 17).
3. **`tri_textual_diff` range truncation:** Passing `"Matthew 1:1-6"` to `tri_textual_diff` silently processed only `Matthew 1:1–4` (`target_vids: [23262..23265]`), omitting vv. 5–6 (where Rahab, Ruth, and David appear).

### 4. Which intermediate clues enabled larger discoveries?
- **`get_Word("H8144")` (`ambiguous_candidates` + `grammatical` connections):** Immediately revealed both the `שָׁנִי`/`שֵׁנִי` (`H8144`/`H8145`) consonantal wordplay and the `שָׁנִי`+`חוּט` (`H2339`) link to `Joshua 2:18`.
- **`follow_connectionchain` on `Genesis 38:28`:** Its `v3:bmw:5888` clue (`H8144`+`H7194`) was the decisive bridge to Rahab (`Joshua 2:18, 21`), which in turn led via `Joshua 2:18–21` to `תִּקְוָה` (`H8615`) → `Ruth 1:12`.
- **`get_Word("H6162")` (`etymology` + `lxx`):** Anchored `עֵרָבוֹן` (`H6162`) to `עָרַב` (`H6148`) and LXX `ἀρραβών` (`G0728`), unlocking the NT seal/guarantee cluster (`2 Cor 1:22`, `Eph 1:14`).
- **`occurrences` of `H5234` (`נָכַר`):** Revealed the full Genesis 27 → 37 → 38 → 42 → Ruth 2–3 recognition arc in a single call.

### 5. Which important relationships were missing?
- **No automated OT-to-NT legal/typological bridge between `Gen 38` / `Ruth 4` and `Matt 1:5–6` via Rahab (`Josh 2`) or Bathsheba:** `get_Connection(["Genesis 38","Ruth 4","Matthew 1:1-6"])` proved the triangle using only Tamar, Boaz, and two `CrossReferences.org` links; it did not surface `Gen 38:9` (`שָׁחַת` `H7843`) ↔ `Ruth 4:6` (`אַשְׁחִית` `H7843`), `Gen 38:25` (`הַכֶּר־נָא` `H5234`) ↔ `Gen 37:32` / `Ruth 2:10`, or `Gen 38:28` (`שָׁנִי`) ↔ `Josh 2:18` (`Ῥαχάβ` in Matt 1:5).
- **`genealogy` coverage gaps:** `genealogy` for `Boaz` returned `parents: []` (source `"fallback_only"`, 64 people indexed), missing Salmon and Rahab (`Matt 1:5`; `Ruth 4:21`), and `Perez` omitted his twin sibling `Zerah` (`siblings: []`) and children (`children: []`, listing only an `other_links` jump to Boaz).
- **`get_Passage` geography/chronology:** All four `get_Passage` calls returned `geography: {status: "symbolic_or_unresolved"}` and `chronology: {status: "unresolved"}`, even though Genesis 38, Ruth 4, and Joshua 2 contain explicit place names (Adullam, Timnah, Enaim, Chezib, Bethlehem, Ephrathah, Moab).

### 6. Which results were distracting or falsely elevated?
- **Token-to-Strong's alignment offsets in `Ruth 4:4–6` and isolated `occurrences` entries:** In `Ruth 4:4–6` (`get_Passage` and `wordplay_scan`), Strong's IDs were visibly shifted by 1–2 tokens relative to surface forms (e.g., `Ruth 4:6` `פֶּן` was tagged `H7843` while `אַשְׁחִית` was tagged `H0853`; `גְּאֻלָּתִי` was tagged `H3588`; `wordplay_scan` consequently grouped `זוּלָתְךָ`, `אָנֹכִי`, `נַחֲלָתִי`, and `אוּכַל` under `strongsA/B: "H1350"`). Similar single-verse misalignments appeared in `occurrences` for `2 Kgs 14:13` (`יְרוּשָׁלַ͏ִם` tagged `H6555`), `1 Chr 15:13` (`אַתֶּם` tagged `H6555`), `1 Chr 9:4` (`מִן` tagged `H6557`), `Exod 28:28` (`הָאֵפֹד` tagged `H6616`), and `Ezek 47:18` (`תָּמֹדּוּ` tagged `H8559`).
- **Secondary gloss mislabeling on `H7194` (`קָשַׁר`):** Glossed uniformly as `"to conspire"` in `Joshua 2:18` and `follow_connectionchain`, even though in `Gen 38:28` and `Josh 2:18, 21` it means `"to tie/bind"` (only `"conspire"` in political contexts).
- **Low-signal `consonantal_candidates` in `wordplay_scan`:** Lists single-letter `edit_distance_1` pairs (e.g., `וַיַּרְא` ↔ `וַיָּבֹא` sharing `"י"`, `לְתָמָר` ↔ `וַתָּסַר` sharing `"ת"`) alongside genuine paronomasia (`פָּרַצְתָּ` ↔ `פָּרֶץ`).
- **`sequence_parallels` (`Gen 38` → `Ruth 4`):** Returned `raw_score: 19.3`, `p_null: 0.8`, `evidence_bits: 0` (statistically indistinguishable from random), yet emitted 9 fragmented `reversed`/`forward` blocks without glosses or verse refs on the clause indices (`aIndices`/`bIndices`), making it opaque and low-value.

### 7. Was the information presented in a way that supported reasoning?
Largely **yes**. The progressive `view="clues"` design kept `get_Word` and `get_Connection` outputs crisp (~4–6 KB), `e_perp` bits and `p_null` helped calibrate statistical weight, and the explicit epistemic tags (`direct_textual_evidence`, `documented_lexical_relationship`, `editorial_cross_reference`, plus the orthographic-vs-etymology disclaimers) directly supported rigorous scholarly separation of fact from hypothesis. However, two presentation issues hindered reasoning:
- `literary_structure` (`detail:"standard"`) with `compare_lxx:true` on two chapters returned **317 KB**, and `sequence_parallels` gave raw numeric clause indices (`aIndices: [100]`) without verse references or Hebrew text.
- `get_Passage` (`view="clues"`) on a 30-verse chapter (`Genesis 38`) still returned ~58 KB, and `passage_connections` capped at 5 chapter-level clues, sometimes repeating minor `CrossReferences.org` links while omitting higher-value lexical parallels (`H7843`, `H5234`).

### 8. What additional capability would have substantially improved my research?
1. **Fixing the token-to-Strong's alignment offset** in MT verses with maqaf/compound prefixes (observed in `Ruth 4:4–6` and isolated `occurrences` results) so `wordplay_scan` and `matched_tokens` never misattribute lemmas.
2. **A `shared_rare_lemmas` / `shared_motifs` mode in `get_Connection` and `passage_compare`** that ranks shared Hebrew/LXX roots by **corpus-wide IDF** rather than raw frequency (which would immediately spotlight `H7843` `שָׁחַת`, `H5234` `נָכַר`, `H2992` `יָבַם`, `H3618` `כַּלָּה`, and `H8144`+`H7194` across Gen 38, Deut 25, Josh 2, and Ruth 4).
3. **Resolvable `expand_id`s across all clue generators** (making `passage_lex_bridge:...` work in `expand_clue`), **consistent `detail` enum schemas** (`"evidence"` allowed in `research`), and **persistent or stateless-portable `chain` tokens** in `follow_connectionchain`.
4. **Verse-annotated output in `sequence_parallels`** and **full-range handling in `tri_textual_diff`** (not silently truncating `Matthew 1:1–6` at v. 4).
