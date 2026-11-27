# Research Report D1: Distributed Clues and Typology Linking Genesis 38, Ruth 4, and Matthew 1:1–6

**Target:** `local` (`--no-supabase`)  
**Log File:** `research/v3/opt-cycle2/local_D1.jsonl`  
**Total Logged MCP Calls:** 17 (+1 unlogged `tools/list` discovery call)  
**English Reference Attribution:** World English Bible (Public Domain), alongside STEP Hebrew/Aramaic OT, NA28-membership Greek NT, and Rahlfs 1935 / Swete LXX alignments as reported by the BibleResearch MCP server.

---

## 1. Executive Synthesis & Cross-Book Verification

Using progressive clue discovery (`view="clues"`) followed by targeted graph comparison (`get_Connection`), stateful traversal (`follow_connectionchain`), and v3 `research` operations, the corpus tools establish a **verified 3-edge textual/lexical triangle** (`r13:proof:triangle:Genesis 38+Ruth 4+Matthew 1:1-6`) directly linking Genesis 38, Ruth 4, and Matthew 1:1–6, supported by secondary legal, symbolic, and onomastic triangles into Deuteronomy 25:5–10, Genesis 25:24–26, Genesis 37:32–33, Joshua 2:18–21, and Jeremiah 22:24 / Haggai 2:23:

1. **Genesis 38 ↔ Matthew 1:1–6:** Direct Hebrew–Greek proper-name bridge `תָּמָר` (`H8559`) ↔ `Θάμαρ` (`G2283`, `passage_lex_bridge:H8559:G2283`, Tier 2) and pericope named-entity bridge `פֶּרֶץ` (`H6557`, Gen 38:29) ↔ `Φάρες` (`G5329`, Matt 1:3, `r12:entity:1144:23264`, Tier 4, `e_perp = 12.69 bits`, `p_null = 0.000152`).
2. **Ruth 4 ↔ Matthew 1:1–6:** Direct Hebrew–Greek proper-name bridge `בֹּעַז` (`H1162`) ↔ `Βοόζ` (`G1003`, `passage_lex_bridge:H1162:G1003`, Tier 2), plus editorial cross-references linking Matt 1:4 to Ruth 4:19–20 (`r11:xref:23265:7210`) and tri-textual token splices in Matt 1:3 drawing from `Ruth 4:12`, `Ruth 4:19`, and `1 Chronicles 2:3–4`.
3. **Genesis 38 ↔ Ruth 4:** Explicit intra-biblical genealogical citation in Ruth 4:12 ("the house of Perez, whom Tamar bore to Judah") and mutual editorial/lexical levirate links (`r11:xref:1128:7196`, Gen 38:8 ↔ Ruth 4:5–11; `r11:xref:1129:7201`, Gen 38:9 ↔ Ruth 4:10).

Throughout this report, findings are strictly separated into **(a) Attested Textual Evidence**, **(b) Linguistic/Grammatical & LXX Relationships**, **(c) Structural/Rhetorical & Wordplay Cues**, **(d) Physical/Real-World Analogs**, and **(e) Interpretive Hypotheses**.

---

## 2. Investigative Ledger (Exact MCP Calls, Latencies, and Byte Counts)

| # | Tool | Key Arguments Summary | Latency (ms) | Wire Bytes | Payload Bytes | Status |
|---:|---|---|---:|---:|---:|---|
| 0 | `tools/list` *(unlogged)* | `--list-tools` | 2,245 | 17,028 | 32,507 | `ok` |
| 1 | `get_prompt` | `{}` | 2,162 | 5,530 | 5,338 | `ok` |
| 2 | `get_Passage` | `passage:"Genesis 38", view:"clues", depth:3, literary:1` | 12,475 | 12,363 | 10,959 | `ok` (30v) |
| 3 | `get_Passage` | `passage:"Ruth 4", view:"clues", depth:3, literary:1` | 11,033 | 10,771 | 9,525 | `ok` (22v) |
| 4 | `get_Passage` | `passage:"Matthew 1:1-6", view:"clues", depth:3, literary:1` | 15,423 | 6,174 | 5,330 | `ok` (6v) |
| 5 | `get_Connection` | `items:["Genesis 38","Ruth 4","Matthew 1:1-6"], view:"clues", connections:15` | 22,888 | 5,582 | 4,874 | `ok` (triangle) |
| 6 | `get_Word` | `word:"H6162", etymology:2, occurrences:10, connections:10, view:"clues"` | 3,206 | 4,311 | 3,759 | `ok` |
| 7 | `get_Word` | `word:"H8144", etymology:2, occurrences:10, connections:10, view:"clues"` | 2,729 | 5,266 | 4,622 | `ok` |
| 8 | `follow_connectionchain` | `next:"Genesis 38:18", limit:8, view:"clues"` | 7,478 | 6,381 | 5,661 | `ok` (step 0) |
| 9 | `research` (Batch 1) | 8 ops: `expand_clue` (×2), `wordplay_scan` (×2), `sequence_parallels`, `lxx_concordance` (`G0728`), `genealogy` (`Perez`), `tribe_lineage` (`person:"Judah"`) | 4,932 | 52,884 | 46,052 | 6 `ok`, 1 `not_found`, 1 `invalid_request` |
| 10 | `follow_connectionchain` | `chain:~v3c, action:"follow", next_id:"r11:cluster:H2368:prophetic_imagery_and_oracles"` (→ `Jeremiah 22:24`) | 8,774 | 7,129 | 6,385 | `ok` (step 1) |
| 11 | `research` (Batch 2) | 8 ops: `lxx_concordance` (`H6162`,`H8144`,`H2368`), `occurrences` (`G0728`,`H2992`), `set_combine` (`H8144`∩`H2339`), `tri_textual_diff` (`Ruth 4:12`), `literary_structure` (`Genesis 38`) | 9,919 | 166,174 | 146,842 | 7 `ok`, 1 `no_alignment` (`tri_ruth4_12`) |
| 12 | `get_Connection` | `items:["Genesis 38:8-9","Deuteronomy 25:5-10","Ruth 4:5-10"], view:"clues", connections:12` | 17,101 | 5,702 | 5,006 | `ok` (triangle) |
| 13 | `get_Word` | `word:"H2226", etymology:2, occurrences:10, connections:10, view:"clues"` | 3,447 | 5,889 | 5,225 | `ok` |
| 14 | `get_Word` | `word:"H8380", etymology:2, occurrences:10, connections:10, view:"clues"` | 2,212 | 4,361 | 3,809 | `ok` |
| 15 | `research` (Batch 3) | 8 ops: `clause_role_query` (`H5234`; `H6965`+`H8034`), `tri_textual_diff` (`Matthew 1:3`), `literary_structure` (`Ruth 4`, `Matthew 1:1-6`), `genealogy` (`Boaz`), `tribe_lineage` (`branch:"Judah"`), `expand_clue` (`r11:xref:7202:832`) | 19,858 | 253,318 | 223,351 | 8 `ok` |
| 16 | `get_Connection` | `items:["Genesis 25:24-26","Genesis 38:27-30","Joshua 2:18-21"], view:"clues", connections:12` | 20,738 | 5,516 | 4,808 | `ok` (triangle) |
| 17 | `follow_connectionchain` | `chain:~v3c, action:"branch", from_node:"Genesis 38:18", next_id:"v3:bmw:1145"` (→ `Genesis 38:25`) | 11,713 | 7,478 | 6,758 | `ok` (step 2, `br_1`) |

---

## 3. Thematic Investigation & Verified Original-Language Discoveries

### 3.1 Legal Clues: Levirate Duty, Redemption, Sandal Custom, and Forensic Recognition

#### (a) Attested Textual & Lexical Evidence
* **The Levirate Verb `יָבַם` (`H2992`) is confined to 3 verses in the entire OT** (`occurrences` op):
  * `Genesis 38:8` (`וְיַבֵּם אֹתָהּ וְהָקֵם זֶרַע לְאָחִיךָ`, token pos 8): Judah commands Onan to perform levirate duty for Er and "raise up offspring (`זֶרַע` `H2233`) for your brother."
  * `Deuteronomy 25:5` (`וְיִבְּמָהּ`, token pos 24) and `Deuteronomy 25:7` (`יַבְּמִי`, token pos 22): Codifies the brother-in-law (`יָבָם` `H2993`) and sister-in-law (`יְבֵמֶת` `H2994`) statute.
* **Legal Bridge `Genesis 38:8–9 ↔ Deuteronomy 25:5–10 ↔ Ruth 4:5–10`** (`get_Connection` Call #12, verified 3-edge `triangle` proof):
  * `Genesis 38:8–9 ↔ Deuteronomy 25:5–10`: `passage_root_wordplay:H2992:H2993` (`יָבַם` ↔ `יָבָם`/`יְבֵמֶת`, Tier 2).
  * `Deuteronomy 25:5–10 ↔ Ruth 4:5–10`: `shared_lemma:H5275` (`נַעַל` "sandal", 22 verses in OT, Tier 3) — connecting the *chalitzah* sandal-removal rite (`Deut 25:9–10`) to the kinsman's sandal transfer at the Bethlehem gate (`Ruth 4:7–8`).
  * `Genesis 38:8–9 ↔ Ruth 4:5–10`: Editorial cross-reference (`r11:xref:1128:7196`, `Ruth 4:5 ↔ Gen 38:8`).
* **Clause-Role Formula "Raise Up a Name" (`H6965` `קוּם` Hiphil + Object `H8034` `שֵׁם`)** (`clause_role_query` Call #15):
  * Across the OT, this exact predicate–object frame returns only 4 verses: `Genesis 17:19` (alongside establishing covenant), **`Deuteronomy 25:7`** (`לְהָקִים לְאָחִיו שֵׁם`, `cl:5555:4`), **`Ruth 4:5`** (`לְהָקִים שֵׁם־הַמֵּת עַל־נַחֲלָתוֹ`, `cl:7196:4`), and **`Ruth 4:10`** (`לְהָקִים שֵׁם־הַמֵּת עַל־נַחֲלָתוֹ`, `cl:7201:1`).
  * Whereas Genesis 38:8 speaks of raising up *offspring* (`הָקֵם זֶרַע`), Deuteronomy 25:7 and Ruth 4:5,10 speak of raising up the *name* (`לְהָקִים שֵׁם`) on the inheritance (`נַחֲלָה` `H5159`). Ruth 4 further integrates redemption (`גָּאַל` `H1350`, 14× in Ruth 4) and purchase (`קָנָה` `H7069`, 5× in Ruth 4) with the gate-court of ten elders (`Ruth 4:1–2, 9–11`).
* **Capital Sentence & Forensic Recognition (`H8313` `שָׂרַף` and `H5234` `נָכַר`)**:
  * In `Genesis 38:24`, Judah orders Tamar brought out to be burned (`וְתִשָּׂרֵף` `H8313`, word 17), linked via editorial cross-reference (`r11:xref:1144:3355`, `e_perp = 13.13 bits`, `p_null = 0.000111`) to `Leviticus 21:9` (priest's daughter burned for harlotry).
  * `clause_role_query` on `נָכַר` (`H5234`, Hiphil, Call #15) alongside `follow_connectionchain` (`r13:v3bmw:1116` on `Gen 38:25`, Call #17) reveals an exact morpho-syntactic mirror between **Jacob's deception of his father/brothers** and **Tamar's legal confrontation of Judah**:
    * `Genesis 37:32` (`cl:1116:4`): Hiphil 2ms imperative `הַכֶּר־נָא` ("Please discern/recognize!") + `Genesis 37:33` (`cl:1117:0`): Hiphil 3ms wayyiqtol `וַיַּכִּירָהּ` ("and he recognized it").
    * `Genesis 38:25` (`cl:1145:7`): Hiphil 2ms imperative `הַכֶּר־נָא` ("Please discern/recognize whose these are!") + `Genesis 38:26` (`cl:1146:0`): Hiphil 3ms wayyiqtol `וַיַּכֵּר יְהוּדָה` ("and Judah acknowledged [them]"). Judah's verdict follows immediately: `צָדְקָה מִמֶּנִּי` (`H6663` "she is more righteous than I").
    * Note also `Ruth 2:10` (`cl:7160:4`), where Ruth asks Boaz why he has taken notice of (`לְהַכִּירֵנִי`, Hiphil inf. constr. of `H5234`) a foreigner.

#### (b) Literary & Structural Cues in Ruth 4
* `literary_structure` on Ruth 4 (Call #15, 22v, 335 tokens) detects an introduction (`Ruth 4:1–2`, courtroom assembly at the gate) followed by 8 parallel units (`Ruth 4:3–22`), driven by `קָנָה` (`H7069`, 5 spans) and `שֵׁם` (`H8034`, emerging at `4:11` and `4:17`), culminating in an antithetical parallelism in `4:14` (`לֹא הִשְׁבִּית... גֹּאֵל` vs `וְיִקָּרֵא שְׁמוֹ בְּיִשְׂרָאֵל`) and a progressive 6-step genealogy parallelism in `Ruth 4:18–22`.
* `wordplay_scan` on Ruth 4 (Call #9) surfaces syntactic talion/polyptoton on `יָשַׁב` (`H3427`, "sit", `4:1–2`), `גָּאַל` (`H1350`, `4:4, 6`), and consonantal metathesis between `לַגֹּאֵל` (`H1350`, `4:3`) and `אֶגְלֶה` (`H1540`, `4:4`, `גאל`/`גלה`), plus `הַשָּׂדֶה` ("field") ↔ `הַשָּׁבָה` ("returned") in `4:3`. *(See Section 5, Q4 regarding a Strong's alignment defect in `wordplay_scan` on Ruth 4:4,6.)*

---

### 3.2 Pledge Items (`עֵרָבוֹן`, `חֹתָם`, `פָּתִיל`, `מַטֶּה`) and LXX→NT Bridges

#### (a) Attested Textual & Lexical Evidence
* **`עֵרָבוֹן` (`H6162`, *a.ra.von*, "pledge")** (`get_Word` Call #6; `lxx_concordance` Call #11):
  * Attested in **only 3 verses in the entire OT**: `Genesis 38:17`, `38:18`, and `38:20`.
  * Documented root derivation (`STEPBible / OpenScriptures HebrewLexicon`): derived from `עָרַב` (`H6148`, "to pledge"; `e_perp = 27.23 bits`).
  * **LXX Alignment:** Rendered by Greek `ἀρραβών` (`G0728`, "guarantee/pledge") in all 3 occurrences (`mean_stability = 0.934`, `idf = 13.3164`).
  * **NT Attestation (`occurrences` Call #11):** `G0728` `ἀρραβών` occurs in **only 3 verses in the NT**: `2 Corinthians 1:22`, `2 Corinthians 5:5`, and `Ephesians 1:14`. Crucially, `2 Corinthians 1:22` combines **both** pledge and signet terminology: `ὁ καὶ σφραγισάμενος ἡμᾶς καὶ δοὺς τὸν ἀρραβῶνα τοῦ Πνεύματος` ("who also sealed us and gave us the pledge of the Spirit").
* **The Three Pledge Items in `Genesis 38:18` and `38:25`**:
  * **Signet:** `חֹתָם` (`H2368`, masculine in `38:18`) / `חֹתֶמֶת` (`H2858`, feminine in `38:25`). `lxx_concordance` (`H2368`, Call #11) confirms primary LXX rendering `σφραγίς` (`G4973`, 10×, `mean_stability = 0.941`; cf. `σφραγίζω` in 2 Cor 1:22) alongside `ἀποσφράγισμα` in `Jeremiah 22:24`. `follow_connectionchain` (Calls #8, #10) traces `H2368` directly to:
    * High-priestly signet engravings (`פִּתּוּחַ` `H6603`, `Exodus 28:11, 21, 36`, `e_perp = 15.72 bits`);
    * Royal Davidic signet imagery in **`Jeremiah 22:24`** (Coniah/Jeconiah, cf. Matt 1:11–12) and **`Haggai 2:23`** (Zerubbabel, descendant of Perez and ancestor of Jesus in Matt 1:12).
  * **Cord:** `פָּתִיל` (`H6616`). Construct connections link `H6616` to the blue cord (`תְּכֵלֶת` `H8504`) of the high priest's ephod/turban (`Exodus 28:37`, `39:21`).
  * **Staff:** `מַטֶּה` (`H4294`, denoting both "staff/rod" and "tribe").
* **Interpretive Observation (Hypothesis, clearly separated):** In Genesis 38:18, Tamar asks for Judah's personal/tribal insignia (`signet`, `cord`, `staff`) as an `עֵרָבוֹן` ("pledge"). While no direct literary dependence is claimed between Genesis 38 and 2 Corinthians 1:22 / Ephesians 1:14, the lexical continuity of the Semitic loanword `עֵרָבוֹן → ἀρραβών` alongside `חֹתָם → σφραγίς` establishes an attested linguistic bridge in the biblical vocabulary of guaranteed inheritance.

---

### 3.3 Scarlet (`שָׁנִי`), Twins (`תּוֹאָם`), and Birth-Order Reversal (`פֶּרֶץ` / `זֶרַח`)

#### (a) Attested Textual & Lexical Evidence
* **`שָׁנִי` (`H8144`, *sha.ni*, "scarlet", 42 OT verses)** (`get_Word` Call #7; `lxx_concordance` Call #11):
  * LXX renders `שָׁנִי` predominantly by `κόκκινος` (`G2847`, 35 occurrences in Rahlfs LXX alignment, `mean_stability = 0.801`, `idf = 9.4751`).
  * In `Genesis 38:28, 30`, the midwife ties (`קָשַׁר` `H7194`) a scarlet thread (`שָׁנִי` `H8144`) on Zerah's hand (`יָד` `H3027`).
  * **Tabernacle & Cleansing Cluster:** `H8144` forms a high-PMI collocation with `תּוֹלֵעָה`/`תּוֹלָע` (`H8438`, "worm/crimson", 34×, `NPMI = 0.94`, `e_perp = 19.92 bits`) in `Exodus 25–39` and `Leviticus 14` / `Numbers 19`.
  * **Scarlet Thread Intersection (`set_combine` `H8144 ∩ H2339` `חוּט`, Call #11; `get_Connection` Call #16):** The exact intersection of `שָׁנִי` (`H8144`) and `חוּט` (`H2339`, "thread") occurs in **only 2 OT verses**: **`Joshua 2:18`** (Rahab's `תִּקְוַת חוּט הַשָּׁנִי`, "cord of scarlet thread", tied `קָשַׁר` `H7194` in `Josh 2:21`) and **`Song of Solomon 4:3`**. Thus, two of the four OT women named in Matthew 1:3–6 (Tamar in Gen 38:28–30 and Rahab in Josh 2:18–21 / Matt 1:5) are linked by `שָׁנִי` (`H8144`) + `קָשַׁר` (`H7194`, "bind/tie").
* **`תּוֹאָם` (`H8380`, *ta.om*, "twin", 6 OT verses)** (`get_Word` Call #14; `get_Connection` Call #16):
  * Derived from `תָּאַם` (`H8382`, "to be double"). Attested in `Genesis 25:24` (Rebekah's twins Esau & Jacob), `Genesis 38:27` (Tamar's twins Perez & Zerah), `Exodus 26:24` & `36:29` (coupled tabernacle frames), and `Song 4:5` & `7:3` (twin gazelles).
  * `get_Connection` (`["Genesis 25:24-26","Genesis 38:27-30","Joshua 2:18-21"]`, Call #16) establishes a verified 3-edge triangle linking Rebekah's twin birth (`H8380`, plus `r11:xref:685:1148` `Gen 25:26 → Gen 38:28–30`), Tamar's twin birth & scarlet thread (`H8144`), and Rahab's scarlet cord (`H8144` + `H7194` `קָשַׁר`).
* **Naming Wordplay & Negative Controls on `פֶּרֶץ` (`H6557`), `זֶרַח` (`H2226`), and `שָׁנִי` (`H8144`)**:
  * **Attested Polyptoton (`wordplay_scan` Call #9):** `Genesis 38:29` displays clause polyptoton (`score = 0.86`) between verb `פָּרַצְתָּ` (`H6555`, "you have broken out/made a breach") and noun `פָּרֶץ` (`H6556`, "a breach"), grounding the naming of `פֶּרֶץ` (`H6557`).
  * **Orthographic / Homograph Siblings (Negative Control):** `get_Word` (`H8144`, Call #7) flags `שֵׁנִי` (`H8145`, "second", shared consonants `שני`) as **orthographic similarity only**, explicitly disclaiming shared historical etymology; similarly, `get_Word` (`H2226` `זֶרַח`, Call #13) separates `זָרַח` (`H2224`, "to rise/shine") and `זֶרַח` (`H2225`, "dawning") as homograph/consonantal siblings (noting also an Edomite clan chief Zerah in `Genesis 36:13, 17, 33`).
  * **Interpretive Hypothesis:** Narratively, Zerah extends his hand first and receives the scarlet (`שָׁנִי`) marker, only to withdraw and emerge second (`שֵׁנִי`), while Perez breaks out first—echoing the Jacob/Esau birth-reversal (`Gen 25:24–26`, where Esau also carries a red/`admoni` association) and establishing Perez as the royal line in Ruth 4:12,18 and Matt 1:3 (where both Perez and Zerah are still named together).

---

### 3.4 Royal Genealogy and Tri-Textual Reception (`Genesis 38 → Ruth 4 → Matthew 1:1–6`)

* **Ruth 4:11–22 Literary & Genealogical Synthesis**:
  * `Ruth 4:11–12` explicitly joins two foundational matriarchal traditions: (1) Rachel and Leah, who "both built the house of Israel" (`r11:xref:7202:832` → `Gen 30:1–24`; `r11:xref:7202:1028` → `Gen 35:16–19` Ephrathah/Bethlehem), and (2) "the house of Perez (`H6557`), whom Tamar (`H8559`) bore to Judah (`H3063`)."
  * `Ruth 4:18–22` (`אֵלֶּה תּוֹלְדוֹת פָּרֶץ`) traces a 10-generation royal line from Perez through Hezron, Ram, Amminadab, Nahshon, Salmon, Boaz, Obed, Jesse, to David (`literary_structure` detects 6-step progressive parallelism, score `9.15`).
  * `tribe_lineage` (`branch:"Judah"`, Call #15) confirms Judah (`H3063`/`G2455`) as the fourth son of Jacob & Leah, attested in `Gen 29:35`, `Gen 49:8–12`, and `Josh 15:1–63`, centered in the Judean Hill Country (Hebron–Bethlehem).
* **Matthew 1:1–6 Structure & Tri-Textual Analysis**:
  * `literary_structure` (`lit_matt1`, Call #15) identifies 5 parallel generational units (`Matt 1:2–6`) structured by `γεννάω` (`G1080`, **14 occurrences**, `idf_salience = 29.24`), anchored to `γένεσις` (`G1078`, `1:1`, cf. `r11:xref:23262:107` → `Gen 5:1` `βίβλος γενέσεως`, `e_perp = 29.54 bits`) and `Δαυίδ` (`G1138`, 3 occurrences in `1:1, 6`).
  * **`tri_textual_diff` on `Matthew 1:3` (Call #15):** Demonstrates that Matthew 1:3 (`Ἰούδας δὲ ἐγέννησεν τὸν Φαρὲς καὶ τὸν Ζαρὰ ἐκ τῆς Θάμαρ...`) is a **composite splice** (`evidence_bits = 16`) across `1 Chronicles 2:3–4`, `Ruth 4:12`, and `Ruth 4:19`:
    * `agrees_both` (MT & LXX): 10 tokens (including `Φαρές`, `Ζαρά`, `Θάμαρ`).
    * `agrees_mt_against_lxx`: 4 tokens (`Ἰούδας` [1 Chr 2:3], `ἐγέννησεν` [1 Chr 2:4 & Ruth 4:12], `Ἀράμ` [Ruth 4:19]).
    * `nt_adaptation`: 7 tokens (`δὲ`, `ἐκ τῆς`, `τόν`, `Ἑσρώμ` re-linked across splice boundaries)—reflecting Matthew's deliberate insertion of the prepositional maternal formula `ἐκ τῆς Θάμαρ` (paralleled in `1:5` by `ἐκ τῆς Ῥαχάβ` and `ἐκ τῆς Ῥούθ`, and in `1:6` by `ἐκ τῆς τοῦ Οὐρίου`).

---

## 4. Negative Controls & Methodological Boundaries

* **`sequence_parallels` (`Genesis 38` vs `Ruth 4`, Call #9):** Returned `raw_score = 28.24` with **`p_null = 0.5231`** (`evidence_bits = 0`), properly confirming that clause-role sequence ordering across these two narratives does **not** achieve statistical significance over random permutation. Their connection rests on **explicit named citation** (Ruth 4:12), **shared levirate/legal vocabulary** (`H2992`, `H6965+H8034`, `H5275`), and **genealogical succession** (`Ruth 4:18–22`), not syntactic sequence mimicry.
* **Homograph / Spelling Separation:** The tools explicitly demarcate orthographic similarities (`שָׁנִי` `H8144` vs `שֵׁנִי` `H8145`; `זֶרַח` `H2226` vs `זָרַח` `H2224`) from documented historical etymology (`get_Word` Call #7, #13) and label editorial cross-references (`Tier 4`) separately from original-language bridges (`Tier 2`) and clause-role matches.
* **LXX Length Divergences (`literary_structure` Call #11):** Swete LXX for Genesis 38 contains `682` tokens vs MT `405` tokens (`30/30` verses), with notable length divergences flagged in `38:11, 13, 14, 15, 18, 27, 28, 29, 30` (e.g., `38:29` `lxx_plus_expansion` `ἐπισυνήγαγεν`, `εὐθύς`).

---

## 5. Honest 8-Question System Evaluation

### Q1. Progressive Disclosure & Payload Efficiency (`view="clues"` vs Expansion)
* **Assessment:** Strong overall for primary tools, uneven for `research` batch ops.
* **Observed Evidence:** All single-purpose tools in `view="clues"` stayed remarkably compact: `get_Word` (4.3–5.9 KB wire), `get_Connection` (5.5–5.7 KB wire), `follow_connectionchain` (6.4–7.5 KB wire), and `get_Passage` (6.2–12.4 KB wire, even for 30 verses of Gen 38). However, multi-op `research` calls expanded rapidly—Call #11 hit **166,174 wire bytes** and Call #15 hit **253,318 wire bytes**—principally because `literary_structure` (`detail:"standard"`) emits exhaustive `word_ids` arrays and `template` cell tables, and `wordplay_scan` emits dozens of low-signal `consonantal_candidates` (e.g., 1-letter `י`/`א`/`ש` edit-distance-1 pairs) even when `view="clues"` is passed at the top level.

### Q2. Cross-Passage & Multi-Anchor Graph Discovery (`get_Connection`, `follow_connectionchain`)
* **Assessment:** Excellent.
* **Observed Evidence:** `get_Connection` with 3 anchors (`["Genesis 38","Ruth 4","Matthew 1:1-6"]`, `["Genesis 38:8-9","Deuteronomy 25:5-10","Ruth 4:5-10"]`, and `["Genesis 25:24-26","Genesis 38:27-30","Joshua 2:18-21"]`) consistently synthesized **complete 3-edge `graph_proof` triangles** in ~17–23 seconds and ~5.5–5.7 KB wire. `follow_connectionchain` preserved opaque `~v3c:` session handles cleanly across `follow` (Call #10 → `Jeremiah 22:24`) and `branch` (`br_1` from `Genesis 38:18` → `Genesis 38:25`, Call #17), tracking epistemic summaries and preventing loops.

### Q3. Original-Language, LXX, and Tri-Textual Fidelity (`get_Word`, `lxx_concordance`, `tri_textual_diff`)
* **Assessment:** Very high analytical value, with one clear directional limitation.
* **Observed Evidence:** `get_Word` + `lxx_concordance` on Hebrew lemmas (`H6162`, `H8144`, `H2368`) produced crisp Rahlfs 1935 stability scores, IDFs, and theological shifts (`Jeremiah 22:24` `ἀποσφράγισμα`). `tri_textual_diff` on `Matthew 1:3` delivered a token-by-token splice map across `1 Chr 2:3–4` and `Ruth 4:12,19`, distinguishing MT-agreement vs NT adaptation (`ἐκ τῆς Θάμαρ`). **Gap:** `lxx_concordance` on NT Strong's `G0728` (`ἀρραβών`, Call #9) returned `lxx_equivalents: []` without a reverse-lookup note pointing to `H6162` (`עֵרָבוֹן`), requiring a separate Hebrew query in Call #11.

### Q4. Syntactic, Literary, and Wordplay Tooling (`clause_role_query`, `wordplay_scan`, `literary_structure`, `sequence_parallels`)
* **Assessment:** High discovery power, but **two concrete token-mapping bugs** were observed.
* **Observed Evidence:**
  * `clause_role_query` (`H5234` and `H6965+H8034`) was a standout, pinpointing `Gen 37:32–33` ↔ `Gen 38:25–26` (`הַכֶּר־נָא`) and `Deut 25:7` ↔ `Ruth 4:5,10` (`לְהָקִים שֵׁם`) immediately. **Minor defect:** in `Ruth 4:5` (`cl:7196:4`), `predicate.s` is `H6965` (`קוּם`) and `start_wn` is `14`, yet `predicate.sf` displayed `"קָנִיתָה"` (an adjacent token) rather than `"לְהָקִים"`.
  * `wordplay_scan` cleanly detected `פָּרַצְתָּ`/`פָּרֶץ` in Gen 38:29 and `גאל`/`גלה` metathesis in Ruth 4:3–4, **but in Ruth 4:4 and 4:6 (`syntactic_talion`), several unrelated surface tokens (`זוּלָתְךָ`, `אָנֹכִי`, `נַחֲלָתִי`, `אוּכַל`) were tagged with `strongsB: "H1350"` (`גָּאַל`)**—an index/alignment offset bug in `wordplay_scan` that could mislead a researcher who does not verify the Hebrew forms.
  * `sequence_parallels` provided an honest null control (`p_null = 0.5231`).

### Q5. Specialized Domain Ops (`genealogy`, `tribe_lineage`, `set_combine`)
* **Assessment:** `set_combine` is crisp and accurate; `genealogy` and `tribe_lineage` need richer data coverage and clearer parameter docs.
* **Observed Evidence:**
  * `set_combine` (`H8144 ∩ H2339`, Call #11) returned the exact 2 matching verses (`Joshua 2:18`, `Song 4:3`) in compact form.
  * `genealogy` returned `source: "fallback_only"` (`total_people_indexed: 64`) with notable gaps: for `Perez` (Call #9), `children: []` and `Boaz` was listed as `successor` (`Ruth 4:18`) while Hezron, Ram, Amminadab, Nahshon, and Salmon were absent; for `Boaz` (Call #15), `parents: []` (missing Salmon/Rahab) and `Perez` was again listed as `successor`.
  * `tribe_lineage` rejected `person: "Judah"` (`invalid_request: Unrecognized key: "person"`), requiring trial with `branch: "Judah"` (Call #15) because the shared `research` tool schema lists `person`, `strongs`, and `branch` without per-op parameter constraints.

### Q6. Epistemic Discipline & Negative Controls
* **Assessment:** Best-in-class.
* **Observed Evidence:** Every layer is explicitly tagged (`direct_textual_evidence`, `documented_lexical_relationship`, `documented_collocation_or_cooccurrence`, `shared_motif_evidence`, `editorial_cross_reference`, `candidate_literary_pattern`, `orthographic_similarity_only`). Homograph siblings (`H8144`/`H8145`, `H2226`/`H2224`) carry explicit non-etymological warnings, and `follow_connectionchain` includes `chain_epistemic_summary` cautioning against conflating multi-hop paths with direct dependence.

### Q7. Latency, Reliability & Schema Ergonomics
* **Assessment:** Reliable execution (zero crashes/timeouts across 17 calls), moderate latency on 3-item graph comparisons, and two handle/schema rough edges.
* **Observed Evidence:**
  * Latencies ranged from `2.2s–3.4s` (`get_Word`) and `4.9s–19.9s` (`research` 8-op batches) to `17.1s–22.9s` (`get_Connection` 3-passage graph proofs).
  * **Handle mismatch bug:** Calling `expand_clue` on the synthetic triangle ID returned by `get_Connection` (`r13:proof:triangle:Genesis 38+Ruth 4+Matthew 1:1-6`, Call #9) returned `status: "not_found"`, whereas expanding individual edge IDs (`r12:entity:1144:23264`, `r11:xref:7202:832`) succeeded.
  * `tri_textual_diff` on OT `Ruth 4:12` returned `status: "no_alignment"` (expected, since it targets NT→OT splices, though its `candidate_sources` and `lxx_shifts_in_sources` were still informative).

### Q8. Overall Verdict & Priority Improvements
* **Overall Verdict:** **8.5 / 10** — The BibleResearch v3 MCP server enabled deep, original-language-verified discovery across Genesis 38, Ruth 4, and Matthew 1:1–6 within 17 calls, surfacing non-obvious bridges (`עֵרָבוֹן → ἀρραβών` + `חֹתָם → σφραγίς`, `הַכֶּר־נָא` in Gen 37/38, `לְהָקִים שֵׁם` in Deut 25/Ruth 4, `שָׁנִי + חוּט` linking Tamar & Rahab, and `tri_textual_diff` composite splices in Matt 1:3) while maintaining strict epistemic discipline.
* **Top 5 Concrete Recommendations (Grounded in Observed Behavior):**
  1. Fix the Strong's/surface-token alignment offset in `wordplay_scan` (`syntactic_talion` on Ruth 4:4,6) and `clause_role_query` (`predicate.sf` on Ruth 4:5).
  2. Allow `expand_clue` to resolve synthetic `r13:proof:triangle:...` handles (or omit `expand_id` from unexpandable synthetic summary cards).
  3. Add reverse NT→MT lookup support (or a helpful hint) in `lxx_concordance` when queried with an NT Strong's like `G0728`.
  4. Cap `consonantal_candidates` and suppress `word_ids` arrays in `research` when `view="clues"` is active so 8-op batches stay under ~30–50 KB instead of 166–253 KB.
  5. Complete the intermediate generations (`Hezron → Salmon`) in the `genealogy` dataset and document per-op accepted keys (e.g., `tribe_lineage` requires `branch` rather than `person`).
