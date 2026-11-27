# Research Report (D2): Naming Reversals and Prophetic Restoration in Hosea 1–2, Joshua 7, and Romans 9:25–26

## 1. Executive Summary & Epistemic Framework

This report examines the interlocking pattern of **naming reversals, covenantal judgment, and prophetic restoration** across **Hosea 1–2**, **Joshua 7**, and **Romans 9:25–26** (with supporting witnesses in **Joshua 2**, **1 Chronicles 2:7**, **Isaiah 65:10**, and **1 Peter 2:10**).

Following BibleResearch epistemic standards, findings are strictly separated into:
- **(a) Attested textual & original-language evidence**: STEP Hebrew/Aramaic OT tokens, NA28-membership Greek NT tokens, Rahlfs 1935 LXX (`lxx_concordance`, `tri_textual_diff`), and Swete LXX (`lxx`, `literary_structure`).
- **(b) Linguistic & grammatical relationships**: Root derivations, syntactic talion, person/number shifts, and MT↔LXX↔NT lexical equivalences.
- **(c) Structural & rhetorical parallels**: Chiastic naming sequences, prophetic-to-historical inversions, and verified graph triangles.
- **(d) Physical/spatial analogies**: Wilderness entry, valley thresholds, and agricultural sowing (`זָרַע`).
- **(e) Interpretive hypotheses**: Theological/canonical synthesis grounded in, but distinct from, raw textual data.

---

## 2. MCP Tool Execution Log (17 Calls + Schema Discovery)

Every MCP call was executed sequentially against `--target local --no-supabase` via `scripts/mcp-bench-cli.mjs` and logged to `research/v3/opt-cycle2/local_D2.jsonl`.

| # | Tool | Target / Key Arguments | Latency (ms) | Wire Bytes | Payload Bytes | Status |
|---:|---|---|---:|---:|---:|---|
| 0 | `tools/list` (`--list-tools`) | Schema & parameter discovery | 1,895 | 17,028 | 32,507 | ok |
| 1 | `get_prompt` | `{}` | 2,202 | 5,530 | 5,338 | ok |
| 2 | `get_Passage` | `Hos 1:1-Hos 2:23` (`limit:40, depth:5, literary:1, view:"clues"`) | 12,207 | 13,243 | 11,855 | ok |
| 3 | `get_Passage` | `Joshua 7` (`limit:30, depth:5, literary:1, view:"clues"`) | 11,734 | 12,049 | 10,831 | ok |
| 4 | `get_Passage` | `Romans 9:22-29` (`depth:5, literary:1, view:"evidence"`) | 16,614 | 65,812 | 57,372 | ok |
| 5 | `research` (batch 1, 8 ops) | `tri_textual_diff` (Rom 9:25-26); `lxx_concordance` (Hos 1:4-2:1, Hos 2:14-23, Josh 7:24-26, `detail:"full"`); `wordplay_scan` (Hos 1-2, Josh 7); `sequence_parallels` (Hos 1-2→Josh 7, Hos 1-2→Rom 9:22-29) | 14,990 | 183,258 | 153,566 | ok |
| 6 | `research` (batch 2, 8 ops) | `literary_structure` (Hos 1-2, Josh 7, `detail:"standard", compare_lxx:true`); `occurrences` (H5911, H5916, H3818, H3819); `lxx_concordance` (H7355, H8615) | 7,862 | 324,431 | 287,949 | ok |
| 7 | `get_Connection` | `["Hosea 2:15", "Joshua 7:24-26"]` (`connections:10, view:"evidence"`) | 10,230 | 32,157 | 29,219 | ok |
| 8 | `get_Connection` | `["Hosea 1:10-2:1", "Hosea 2:21-23", "Romans 9:25-26"]` (`connections:10, view:"clues"`) | 15,612 | 5,712 | 5,020 | ok |
| 9 | `get_Word` | `H5911` (`etymology:3, connections:8, occurrences:10, view:"clues"`) | 3,924 | 4,420 | 3,856 | ok |
| 10 | `get_Word` | `H5912` (`etymology:3, connections:8, view:"clues"`) | 3,232 | 4,463 | 3,893 | ok |
| 11 | `get_Word` | `H3157` (`etymology:3, connections:8, view:"clues"`) | 3,027 | 5,348 | 4,694 | ok |
| 12 | `follow_connectionchain` | Seed `next:"Hosea 2:15"` (`limit:8, view:"clues"`) | 5,019 | 6,671 | 5,927 | ok |
| 13 | `follow_connectionchain` | `action:"follow", next:"Isaiah 65:10"` (`limit:6, view:"clues"`) | 8,309 | 5,620 | 5,010 | ok |
| 14 | `research` (batch 3, 8 ops) | `lxx` Swete (Hos 1:6, 2:15, 2:23); `lxx_concordance` (G0025, Isa 65:10, 1 Chr 2:7); `occurrences` (H8615); `wordplay_scan` (`a:"Joshua 7:24-26", b:"Hosea 2:15"`) | 5,606 | 45,171 | 39,885 | ok |
| 15 | `get_Passage` | `1 Peter 2:9-10` (`depth:3, literary:0, view:"evidence"`) | 7,233 | 21,077 | 18,363 | ok |
| 16 | `research` (batch 4, 5 ops) | `expand_clue` (`r13:interp:22215:name:H3157`, `passage_root_wordplay:H5911:H5916`); `wordplay_scan` (H5912↔H5911, H3157↔H2232); `clause_role_query` (`lemma:"H5916"`, schema error) | 1,883 | 11,501 | 10,067 | ok |
| 17 | `research` (batch 5, 3 ops) | `clause_role_query` (`passage:"Hosea 1:4-2:1"`, `predicate:"H5916"`); `wordplay_scan` (`a:"H5917", b:"H5911"`) | 2,786 | 78,735 | 67,099 | ok |

---

## 3. Hosea 1–2: Symbolic Naming, Judgment, and Intra-Book Reversal

### 3.1 Textual & Lexical Evidence of the Three Children's Names

1. **First Child — יִזְרְעֶאל (*Jezreel*, `H3157`, Hosea 1:4–5)**
   - **Attested Hebrew/LXX**: MT Hos 1:4 commands `קְרָא שְׁמוֹ יִזְרְעֶאל` ("Call his name Jezreel"; LXX `κάλεσον τὸ ὄνομα αὐτοῦ Ιεζραελ`).
   - **Lexical/Etymological structure (`get_Word` H3157)**: Compound of `זָרַע` (`H2232`, "to sow") + `אֵל` (`H0410`, "God"). `wordplay_scan` (`H3157` ↔ `H2232`) confirms `proven_common_root: true`, `shared_consonants: "זרע"`, `formal_score: 0.667`.
   - **Scriptural self-interpretation (`r13:interp:22215:name:H3157`, tier 1)**: Hosea 1:4–5 links `יִזְרְעֶאל` (`H3157`) directly to `יִשְׂרָאֵל` (`H3478`) in a double judgment: Yahweh will visit (`וּפָקַדְתִּי`, `H6485` / LXX `ἐκδικήσω`) the blood of Jezreel (`דְּמֵי יִזְרְעֶאל`) on the house of Jehu (`יֵהוּא`, `H3058`), end (`וְהִשְׁבַּתִּי`, `H7673` / LXX `καταπαύσω`) the kingdom of the house of Israel, and break (`וְשָׁבַרְתִּי`, `H7665` / LXX `συντρίψω`) Israel's bow `בְּעֵמֶק יִזְרְעֶאל` ("in the valley of Jezreel"; LXX `ἐν τῇ κοιλάδι τοῦ Ιεζραελ`, `Hos 1:5`).

2. **Second Child — לֹא רֻחָמָה (*Lo-Ruhamah*, `H3819`, Hosea 1:6–8)**
   - **Attested Hebrew**: Negation `לֹא` + Pual passive participle of `רָחַם` (`H7355`, "to have compassion"). Directly glossed in the clause: `כִּי לֹא אוֹסִיף עוֹד אֲרַחֵם אֶת־בֵּית יִשְׂרָאֵל` ("for I will no longer have compassion on the house of Israel"), followed by syntactic talion `כִּי־נָשֹׂא אֶשָּׂא לָהֶם` (`H5375` `נָשָׂא` inf. abs. + yiqtol, `wordplay_scan` `score: 0.86`, contrasting with mercy on Judah in 1:7 `וְאֶת־בֵּית יְהוּדָה אֲרַחֵם`).
   - **LXX Rendering & Critical Textual Divergence**:
     - **Swete LXX (`op:"lxx"`, Hos 1:6)**: `Οὐκ ἠλεημένη` (`ἐλεέω`, `G1653`), and renders the difficult `כִּי־נָשֹׂא אֶשָּׂא לָהֶם` as `ἀλλʼ ἢ ἀντιτασσόμενος ἀντιτάξομαι αὐτοῖς` ("but rather setting myself in array, I will oppose them" — an adversarial interpretive translation of `נָשָׂא`).
     - **Rahlfs 1935 (`lxx_concordance`)**: Displays `Οὐκ` alone without `ἠλεημένη` in Hos 1:6, 1:8 (`τὴν Οὐκ`), and 2:23 (`τὴν Οὐκ`) — an edition/tokenization anomaly in the Rahlfs corpus asset (flagged in System Evaluation), whereas Swete preserves the full Greek participial names (`Οὐκ ἠλεημένη` in 1:6; `Οὐκ ἠγαπημένην` in 2:23).

3. **Third Child — לֹא עַמִּי (*Lo-Ammi*, `H3818`, Hosea 1:9)**
   - **Attested Hebrew**: Negation `לֹא` + `עַם` (`H5971`, "people") + 1cs suffix. Explained via broken covenant formula: `כִּי אַתֶּם לֹא עַמִּי וְאָנֹכִי לֹא־אֶהְיֶה לָכֶם` ("for you are not my people, and I will not be yours" — negating the Exodus covenantal *I-will-be-your-God* formula).
   - **LXX**: `ὑμεῖς οὐ λαός μου, καὶ ἐγὼ οὔκ εἰμι ὑμῶν` (Swete/Rahlfs).

### 3.2 Intra-Book Structural & Naming Reversal (Hos 1:10–2:1 and 2:14–23)

`literary_structure` (`lit_hos`, confidence `0.911`, `mdl_savings_bits: 33.8`) segments Hosea 1–2 into an introduction (`1:1–4`) followed by four recurring parallel units anchored by the formula `וְהָיָה בַּיּוֹם הַהוּא` (`1:5–9`, `1:10–2:15`, `2:16–20`, `2:21–23`). Across these units, the three judgment names undergo **explicit lexical and structural inversion**:

| Child | Judgment Name (Hos 1:4–9) | First Reversal (Hos 1:10–2:1 / MT 2:1–3) | Culminating Reversal (Hos 2:21–23 / MT 2:23–25) |
|---|---|---|---|
| 1. **Jezreel** (`יִזְרְעֶאל`, `H3157`) | Avenging blood of Jezreel; breaking bow in valley of Jezreel (1:4–5) | Israel & Judah gather under one head; `גָּדוֹל יוֹם יִזְרְעֶאל` ("great shall be the day of Jezreel", 1:11) | Cosmic `עָנָה` chain answers Jezreel (2:21–22); `וּזְרַעְתִּיהָ לִּי בָּאָרֶץ` ("I will **sow** [`זָרַע`, `H2232`] her for myself in the land", 2:23) |
| 2. **Lo-Ruhamah** (`לֹא רֻחָמָה`, `H3819`) | No more compassion on house of Israel (1:6) | Reversed *second* in 2:1: `וְלַאֲחוֹתֵיכֶם רֻחָמָה` ("and to your sisters, *Ruhamah*"; Swete `Ἐλεημένη`) | Reversed *first* in 2:23: `וְרִחַמְתִּי אֶת־לֹא רֻחָמָה` (Swete LXX `καὶ ἀγαπήσω τὴν Οὐκ ἠγαπημένην`) |
| 3. **Lo-Ammi** (`לֹא עַמִּי`, `H3818`) | "You are not my people, and I am not yours" (1:9) | Reversed *first* in 1:10 (`בְּנֵי אֵל־חָי`) & 2:1 (`אִמְרוּ לַאֲחֵיכֶם עַמִּי`, LXX `Λαός μου`) | Reversed *second* in 2:23: `וְאָמַרְתִּי לְלֹא־עַמִּי עַמִּי־אַתָּה` + reciprocal `וְהוּא יֹאמַר אֱלֹהָי` |

Notice two additional onomastic inversions in **Hos 2:16–17**:
- **Name replacement**: `תִּקְרְאִי אִישִׁי וְלֹא־תִקְרְאִי־לִי עוֹד בַּעְלִי` ("you will call me *my husband* [`אִישִׁי`, `H0376`], and no longer *my Baal/master* [`בַּעְלִי`, `H1180`]" — `wordplay_scan` flags `בַּעֲלִי` ↔ `הַבְּעָלִים` in 2:17, `consonantal_exact` `בעל`, score `1.168`), followed by erasing the names (`שְׁמוֹת`) of the Baals from her mouth (`2:17`).

---

## 4. Joshua 7 and the Valley of Achor in Relation to Hosea 2:14–15

### 4.1 Verified Cross-Book Bridge (`get_Connection` & `lxx_concordance`)

`get_Connection` between `Hosea 2:15` and `Joshua 7:24-26` returns `direct_link_found: true`, `graph_proof.is_complete: true`, anchored by:
1. **Rare Shared Toponym (`shared_lemma:H5911`)**: `עָכוֹר` (*Achor*, `H5911`) occurs in only **5 verses** in the entire Hebrew Bible (`occ_achor`): **Joshua 7:24, 7:26, 15:7**; **Isaiah 65:10**; and **Hosea 2:15**. Its construct pair `עֵמֶק עָכוֹר` (`H6010` + `H5911`) has NPMI = `0.71` (`e_perp = 24.66 bits`, `p_null = 3.77e-8`).
2. **Wordplay / Root Bridge (`passage_root_wordplay:H5911:H5916`)**: `עָכוֹר` (`H5911`) derives from `עָכַר` (`H5916`, "to trouble/bring calamity").

### 4.2 Onomastics, Syntactic Talion, and LXX Shifts in Joshua 7 & 1 Chronicles 2:7

- **Trespass & Covenant Breach (`Josh 7:1, 11`)**: Israel commits `מַעַל` (`H4603`/`H4604`, `וַיִּמְעֲלוּ... מַעַל`) in the `חֵרֶם` (`H2764`, devoted things), turning Israel itself into `חֵרֶם` (`7:12`). Lot-selection (`לָכַד` `H3920`, syntactic talion active→passive `וַיִּלְכֹּד` / `וַיִּלָּכֵד` in `7:17`) isolates **עָכָן** (*Achan*, `H5912`, `7:1, 18–20, 24`).
- **Talion & Etiology (`Josh 7:25–26`)**:
  - Joshua pronounces measure-for-measure judgment: `מֶה עֲכַרְתָּנוּ יַעְכֳּרְךָ יְהוָה בַּיּוֹם הַזֶּה` (`H5916` 2ms qatal → 3ms yiqtol, confirmed by `wordplay_scan` `syntactic_talion`, `score: 0.86`).
  - After stoning and burning in `עֵמֶק עָכוֹר`, YHWH turns (`וַיָּשָׁב`, `H7725`) from the fierceness of his anger (`מֵחֲרוֹן אַפּוֹ`), and the place is named `עֵמֶק עָכוֹר` ("Valley of Achor", `7:26`).
- **MT Paronomasia vs. Chronicles & LXX Harmonization**:
  - In **MT Joshua 7**, the personal name is **עָכָן** (`H5912`, consonants `עכנ`), which `wordplay_scan` (`H5912` ↔ `H5911`) measures at `edit_distance: 1`, `shared_consonants: "עכ"`, `proven_common_root: false` — i.e., **narrative paronomasia** rather than strict root identity (`get_Word` H5912 explicitly notes this distinction).
  - In **MT 1 Chronicles 2:7**, the Chronicler writes **עָכָר** (`H5917`, consonants `עכר`, `wordplay_scan` vs `H5911`: `consonantal_exact`, `edit_distance: 0`, `formal_score: 0.917`) and adds the explicit participial title `עוֹכֵר יִשְׂרָאֵל` ("the troubler of Israel", `H5916`), echoing Elijah's confrontation with Ahab (`1 Kgs 18:17–18`, `occ_achar`).
  - **LXX Joshua 7:24–25 (`joshua-vaticanus-b`)** and **LXX 1 Chr 2:7** both harmonize the personal name to **`Αχαρ`** (`Achar`), aligning the offender's name directly with `Αχωρ` (`Achor`).
  - **LXX lexical shifts on `עָכַר` (`H5916`)**:
    - LXX **Josh 7:25** intensifies `עָכַר` ("trouble") to destruction: `τί ὠλέθρευσας ἡμᾶς ἐξολεθρεύσαι σε κύριος` (`ὀλεθρεύω` / `ἐξολεθρεύω`, `p_g_given_h = 0.0625`).
    - LXX **1 Chr 2:7** renders `עוֹכֵר` as `ὁ ἐμποδοστάτης` ("the hinderer / one who stands in the way").
    - LXX **Josh 7:24** renders `עֵמֶק עָכוֹר` as `φάραγγα Αχωρ`, whereas **LXX Josh 7:26** transliterates the entire phrase as a single place name `Εμεκαχωρ`.

### 4.3 Prophetic Inversion of Achor & "Door of Hope" (`Hosea 2:15` & `Isaiah 65:10`)

- **MT Hosea 2:15**: `וְנָתַתִּי לָהּ אֶת־כְּרָמֶיהָ מִשָּׁם וְאֶת־עֵמֶק עָכוֹר לְפֶתַח תִּקְוָה וְעָנְתָה שָּׁמָּה כִּימֵי נְעוּרֶיהָ וּכְיוֹם עֲלֹתָהּ מֵאֶרֶץ־מִצְרָיִם`.
  - **Physical/Historical Analogy & Inversion**: In Joshua 7, Achor marks the crisis immediately after crossing the Jordan into Canaan—where Rahab's household had just been spared via `תִּקְוַת חוּט הַשָּׁנִי` ("cord of scarlet thread", `H8615`, **Joshua 2:18, 21**, `occ_tikvah`), while Achan's theft turned entry into defeat and a monument of trouble. Hosea 2:14–15 reenacts a second wilderness entry (`מִדְבָּר`) and transforms `עֵמֶק עָכוֹר` ("Valley of Trouble") into `פֶתַח תִּקְוָה` ("a door of hope", `H6607`+`H8615`). Moreover, Israel's `וְעָנְתָה` ("she will answer/respond", `H6030`) there initiates the cosmic chain of `עָנָה` (`H6030`) in Hos 2:21–22 that terminates on `יִזְרְעֶאל`.
  - **Isaianic Parallel (`Isaiah 65:10`, traced via `follow_connectionchain`)**: `וְעֵמֶק עָכוֹר לְרֵבֶץ בָּקָר לְעַמִּי אֲשֶׁר דְּרָשׁוּנִי` ("and the Valley of Achor [shall be] a resting place for herds, for my people who have sought me"; LXX `εἰς ἀνάπαυσιν βουκολίων τῷ λαῷ μου`).
- **Radical LXX Divergence in Hosea 2:15 (LXX 2:17)**:
  - Both Swete and Rahlfs read: `καὶ τὴν κοιλάδα Αχωρ διανοῖξαι σύνεσιν αὐτῆς· καὶ ταπεινωθήσεται ἐκεῖ κατὰ τὰς ἡμέρας νηπιότητος αὐτῆς`.
  - The LXX translator construed `לְפֶתַח` not as the noun `פֶּתַח` ("door") + `תִּקְוָה` ("hope"), but as a verbal infinitive `לִפְתֹּחַ` ("to open", `διανοῖξαι`) with `σύνεσιν αὐτῆς` ("her understanding"), and read `וְעָנְתָה` (`עָנָה` I, "answer") as `עָנָה` II ("be afflicted/humbled", `ταπεινωθήσεται`) — shifting an exodus-song of covenantal hope into cognitive/penitential humbling! (By contrast, elsewhere in Hosea — `Hos 2:18` MT `לָבֶטַח` → LXX 2:20 `ἐπ' ἐλπίδι` — the LXX *does* introduce `ἐλπίς`!).

---

## 5. Romans 9:25–26 in Relation to Hosea 1–2 (and 1 Peter 2:10)

`get_Connection` across `Hosea 1:10-2:1`, `Hosea 2:21-23`, and `Romans 9:25-26` yields a **complete 3-edge triangle** (`graph_proof.is_complete: true`) linking `יִזְרְעֶאל`↔`זָרַע` (`H3157:H2232`), `אֵל`↔`θεός` (`H0410:G2316`), and `רָחַם`↔`ἀγαπάω` (`H7355:G0025`).

### 5.1 Tri-Textual Analysis of Romans 9:25–26 (`tri_textual_diff` + Swete LXX)

1. **Romans 9:25** — `ὡς καὶ ἐν τῷ Ὡσηὲ λέγει· Καλέσω τὸν οὐ λαόν μου λαόν μου καὶ τὴν οὐκ ἠγαπημένην ἠγαπημένην`:
   - **Composite Reordering**: Paul quotes **Hosea 2:23** *before* **Hosea 1:10**, and **inverts the two clauses within Hos 2:23** (`οὐ λαόν μου` first, `οὐκ ἠγαπημένην` second — matching the order of Hos 2:1 and **1 Peter 2:10**, while reversing Hos 1:6→1:9 and Hos 2:23).
   - **Verbal Unification under `καλέω` (`G2564`)**: Paul replaces Hos 2:23's two verbs (`σπερῶ`/`ἀγαπήσω` + `ἐρῶ`) with `Καλέσω` ("I will call"), binding the quotation directly to `οὓς καὶ ἐκάλεσεν ἡμᾶς` (Rom 9:24) and `κληθήσονται` (Rom 9:26).
   - **LXX Textual Stream (`ἀγαπάω` vs. `ἐλεέω`)**: Paul's `τὴν οὐκ ἠγαπημένην ἠγαπημένην` (`ἀγαπάω`, `G0025`) matches **Swete LXX Hos 2:23** (`καὶ ἀγαπήσω τὴν Οὐκ ἠγαπημένην`), whereas Rahlfs 1935 prints `ἐλεήσω` in Hos 2:23 and **1 Peter 2:10** uses `οἱ οὐκ ἠλεημένοι νῦν δὲ ἐλεηθέντες` (`ἐλεέω`, `G1653`). `lxx_concordance` on `H7355` (`רָחַם`) confirms `ἀγαπάω` is a documented LXX equivalent (4×) alongside `ἐλεέω` (26×) and `οἰκτείρω`/`οἰκτίρω` (12×).
   - **Critical Negative Control on `tri_textual_diff`**: `tri_textual_diff` flagged `Deuteronomy 30:16` as a composite splice source for `καὶ τὴν οὐκ ἠγαπημένην ἠγαπημένην` solely on `ἀγαπᾶν` (`G0025`). Direct inspection of **Swete LXX Hos 2:23** refutes a Deuteronomic splice: Paul is following the `ἀγαπάω` LXX textual tradition of Hosea 2:23 itself.

2. **Romans 9:26** — `καὶ ἔσται ἐν τῷ τόπῳ οὗ ἐρρέθη αὐτοῖς· Οὐ λαός μου ὑμεῖς, ἐκεῖ κληθήσονται υἱοὶ Θεοῦ ζῶντος`:
   - **Verbal Alignment with LXX Hosea 1:10 (LXX 2:1) against MT**:
     - `tri_textual_diff` summary across Rom 9:25–26: `agrees_both: 14`, `agrees_lxx_against_mt: 4`, `agrees_mt_against_lxx: 1`, `composite_splice: 5`, `nt_adaptation: 11`.
     - Specifically, `ἐκεῖ κληθήσονται` ("there they shall be called") is an `lxx_plus_expansion` in LXX Hos 2:1 against MT's `יֵאָמֵר לָהֶם` ("it shall be said to them", without "there" `שָׁם` and without `קרא`/`καλέω`). Paul preserves LXX's `ἐκεῖ κληθήσονται` verbatim because `κληθήσονται` completes his `καλέω` frame (`9:24 ἐκάλεσεν → 9:25 Καλέσω → 9:26 κληθήσονται`).
   - **Link to Rom 9:27–29 (Isaiah 10:22–23 & 1:9)**: Immediately after Hos 1:10 (`כְּחוֹל הַיָּם`, "as the sand of the sea"), Paul quotes Isa 10:22 (`ὡς ἡ ἄμμος τῆς θαλάσσης`, `Rom 9:27`) — sharing the identical sand-of-the-sea comparison with Hos 1:10 — and concludes with `σπέρμα` ("seed", `G4690`, `Rom 9:29`, from Isa 1:9).

---

## 6. Cross-Book Synthesis & Interpretive Hypotheses

1. **Three-Stage Naming Inversion Trajectory (Textually Grounded → Interpretive Synthesis)**:
   - **Stage 1 (Joshua 7 → Hosea 2:15)**: A spatial/historical *toponym of trouble* (`עֵמֶק עָכוֹר`, arising from Achan/Achar's `מַעַל` upon entering Canaan) is inverted by Hosea into a *threshold of renewed entry and hope* (`לְפֶתַח תִּקְוָה`), while **Isaiah 65:10** turns it into a *pastoral resting place* (`לְרֵבֶץ בָּקָר`).
   - **Stage 2 (Hosea 1 → Hosea 2)**: Three personal judgment names (`Jezreel`, `Lo-Ruhamah`, `Lo-Ammi`) are reversed twice—first in `1:10–2:1` (`Ammi` → `Ruhamah`, `day of Jezreel`), then cosmically in `2:21–23` (`I will sow her` → `Ruhamah` → `Ammi` → `My God`), accompanied by replacing `Baali` with `Ishi` (2:16).
   - **Stage 3 (Hosea 1–2 → Romans 9:25–26)**: Paul (*interpretive hypothesis*) applies Israel's covenantal reversal ("not my people" → "sons of the living God") to the inclusive calling (`καλέω`) of both Jews and Gentiles (`ἐξ ἐθνῶν`, 9:24), leveraging the LXX `ἀγαπάω` stream (`Hos 2:23`) and LXX `ἐκεῖ κληθήσονται` (`Hos 1:10`) while inverting the sequence (`2:23` → `1:10`) and internal clause order (`people` → `beloved`) so that Gentiles ("not my people") stand in the foreground of divine calling.
2. **Negative-Control Restraint**: `sequence_parallels` between Hosea 1–2 and Romans 9:22–29 yielded `p_null: 0.7231` (`evidence_bits: 0`) and between Hosea 1–2 and Joshua 7 yielded `p_null: 0.0615` (`evidence_bits: 0`). Thus, macro-structural clause-sequence alignment alone does *not* establish dependence; the proven links are lexical (`H5911`/`H5916`, `H3157`/`H2232`), tri-textual (`Hos 2:23`, `Hos 1:10` → `Rom 9:25–26`), and thematic-etiological.

---

## 7. Honest 8-Question System Evaluation

### Q1. How effective were `get_prompt`, tool descriptions, and input schemas for planning the investigation?
- **Strengths**: `get_prompt` clearly laid out the progressive workflow (`Passage -> Word -> Clues -> Bridges -> v3 Ops -> expand_clue`), epistemic separation rules, and parameter roles. When `clause_role_query` received an invalid key (`lemma`), the error response helpfully returned `expected_params`.
- **Weaknesses**: Parameter semantics differ subtly across `research` ops: `wordplay_scan` accepts word/Strong's inputs in `a`/`b` (passing passage ranges `"Joshua 7:24-26"` silently returned `comparable: false` instead of a schema/hint error), and `clause_role_query` uses `predicate` rather than `lemma`.

### Q2. How accurate and complete is the original-language textual, lexical, and morphological data?
- **Strengths**: STEP Hebrew (OSHB/MACULA) and NA28-membership Greek NT tokens are accurate, well-indexed with Strong's IDs, glosses, stems, moods, and 1-based positions. `clause_role_query` provides rich MACULA clause frames, polarity, and speech-opener/naming tags.
- **Weaknesses / Anomalies**:
  - **Rahlfs 1935 LXX token omission in `lxx_concordance`**: In **Hosea 1:6, 1:8, and 2:23**, Rahlfs `grk_tokens` contained only `Οὐκ` (omitting `ἠλεημένη`/`ἠλεημένην`), whereas Swete (`op:"lxx"`) preserved the full Greek names (`Οὐκ ἠλεημένη` in 1:6; `Οὐκ ἠγαπημένην` in 2:23). This is a major pitfall if a researcher relies solely on `lxx_concordance` without cross-checking `op:"lxx"`!
  - **Lexicon gloss bleed**: In `get_Word` / `get_Connection`, `H6010` (`עֵמֶק`, "valley") occasionally displayed the sense-specific gloss `"Valley (of Achor)"` even when appearing in `עֵמֶק יִזְרְעֶאל` (`get_Word` H3157: `יִזְרְעֶאל ↔ עֵ֫מֶק ("Valley (of Achor)", 3×)`).

### Q3. How well did the cross-language (`lxx`, `lxx_concordance`, `tri_textual_diff`) tools perform?
- **Strengths**: `lxx_concordance` brilliantly exposed the theological shift in **Hos 2:15** (`לְפֶתַח תִּקְוָה` → `διανοῖξαι σύνεσιν αὐτῆς`, `וְעָנְתָה` → `ταπεινωθήσεται`), **Josh 7:25** (`עָכַר` → `ὀλεθρεύω`/`ἐξολεθρεύω`), **Josh 7:26** (`Εμεκαχωρ`), and **1 Chr 2:7** (`עוֹכֵר` → `ἐμποδοστάτης`). `tri_textual_diff` accurately caught LXX's `ἐκεῖ κληθήσονται` plus-expansion in **Rom 9:26 / Hos 1:10**.
- **Weaknesses**:
  - `tri_textual_diff` produced a **false-positive composite splice** (`Deuteronomy 30:16`) in Rom 9:25 because Rahlfs Hos 2:23 has `ἐλεήσω`/`Οὐκ` rather than Swete's `ἀγαπήσω τὴν Οὐκ ἠγαπημένην`, causing the aligner to hunt elsewhere for `ἀγαπάω`.
  - Passing a Greek Strong's (`G0025`) to `lxx_concordance` returned empty `lxx_equivalents: []` (it only resolves Hebrew `H...` keys for concordance profiles, even though `H7355` listed `ἀγαπάω` 4×).
  - `H3157` (`יִזְרְעֶאל`) in `get_Word` showed an alignment artifact mapping `יִזְרְעֶאל` → `εἰς` (`G1519`, count 5) from prepositional prefixes/directional-he contexts.

### Q4. How reliable were `wordplay_scan`, `literary_structure`, and `sequence_parallels`?
- **Strengths**: `wordplay_scan` cleanly distinguished `proven_common_root: true` (`H3157`↔`H2232`), `consonantal_exact` (`H5917`↔`H5911`, `edit_distance: 0`), `edit_distance_1` narrative paronomasia (`H5912`↔`H5911`, `proven_common_root: false`), and syntactic talion (`Josh 7:25`, `Hos 1:6`). `literary_structure` accurately segmented Hosea 1–2 into 4 parallel units around `וְהָיָה בַּיּוֹם הַה֑וּא` (`confidence: 0.911`).
- **Weaknesses**: `sequence_parallels` on long spans (`Hosea 1-2` vs `Joshua 7` or `Rom 9:22-29`) returned high `p_null` (`0.0615`, `0.7231`, `evidence_bits: 0`) and opaque `aIndices`/`bIndices` without inline verse/clause text previews, making manual verification of the aligned blocks difficult without a separate `clause_role_query`.

### Q5. How useful were `get_Connection`, `follow_connectionchain`, and `expand_clue`?
- **Strengths**: `get_Connection` in `view="clues"` (5.7 KB) was fast, concise, and mathematically rigorous (`graph_proof` triangle across Hos 1:10-2:1, Hos 2:21-23, Rom 9:25-26; direct pair Hos 2:15 ↔ Josh 7:24-26). `follow_connectionchain` smoothly branched from `Hos 2:15` to `Isa 65:10`, `Josh 7:24`, `Josh 15:7`, and `Ezek 23:19` without repeating visited nodes. `expand_clue` cleanly hydrated `r13:interp:22215:name:H3157`.
- **Weaknesses**: `expand_clue` on `passage_root_wordplay:H5911:H5916` returned `shared_verse_ids: []` (because the two lemmas appear in *adjacent* verses Josh 7:24 and 7:25 rather than the same verse) without surfacing the adjacent-verse witnesses.

### Q6. Did the system maintain strong epistemic discipline and negative controls?
- **Yes — exceptional**. Every wordplay card carried an explicit etymology disclaimer; proper-name entries (`H5912`, `H3157`) distinguished narrative paronomasia from comparative ANE etymology; `get_Connection` separated `editorial_cross_reference` (tier 4) from `documented_lexical_relationship` (tier 2–3); and `sequence_parallels` reported `p_null` honestly without overclaiming significance.

### Q7. How were latency, payload efficiency, and progressive disclosure?
- **Strengths**: `view="clues"` on `get_Word` (3.0–3.9s, 4.4–5.3 KB), `get_Connection` (5.7 KB), and `follow_connectionchain` (5.0–8.3s, 5.6–6.7 KB) were compact and fast. Batching 3–8 operations in `research` saved round-trips (`2.8–15.0s` per batch).
- **Weaknesses**: `detail:"full"` on `lxx_concordance` and `detail:"standard"` on `literary_structure` generated **183 KB–324 KB** wire payloads (with thousands of lines of `word_ids` and `links`), which required multi-chunk file reading. A `detail:"summary"` or `include_links:false` option on `lxx_concordance` and `literary_structure` would dramatically improve signal-to-noise ratio.

### Q8. What are the top concrete improvements recommended for the BibleResearch MCP server?
1. **Audit Rahlfs 1935 LXX Hosea 1:6, 1:8, 2:23** for the missing `ἠλεημένη`/`ἠλεημένην` tokens (and expose Swete vs. Rahlfs variant notes directly inside `lxx_concordance` and `tri_textual_diff`).
2. **Enhance `tri_textual_diff` to check Swete/variant LXX readings** (e.g., Hos 2:23 `ἀγαπήσω τὴν Οὐκ ἠγαπημένην`) before attributing a token like Rom 9:25's `ἠγαπημένην` to an unrelated composite splice (`Deut 30:16`).
3. **Support Greek Strong's (`G...`) reverse profiles in `lxx_concordance`**, and filter function-word alignment artifacts (`εἰς` on `H3157`) and sense-bleed glosses (`"Valley (of Achor)"` on generic `H6010`).
4. **Add concise clause text snippets to `sequence_parallels` block pairs** and adjacent-verse witness refs to `expand_clue` for `passage_root_wordplay`, plus a slim `include_links:false` / `include_word_ids:false` projection on `lxx_concordance` and `literary_structure`.
