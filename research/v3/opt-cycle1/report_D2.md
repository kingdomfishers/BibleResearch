# Biblical Research Report (D2): Naming Reversals and Prophetic Restoration in Hosea 1–2, Joshua 7, and Romans 9:25–26

## 1. Scope & Epistemic Method

This report examines **Hosea 1–2** (the prophetic sign-names of the children and the restoration of the Valley of Achor), **Joshua 7** (Achan, the Valley of Achor, and its canonical reception), and **Romans 9:25–26** (with **1 Peter 2:10** as an attested New Testament comparative witness), focusing on naming inversions, Septuagint (LXX) lexical and interpretive shifts, sequence reversals, and intermediate canonical bridges.

All textual claims, Strong's identifiers, Hebrew/Greek lemmas, LXX readings, cross-references, and diagnostic metrics in this report are grounded exclusively in outputs observed directly from the BibleResearch MCP server (`local` target via `scripts/mcp-bench-cli.mjs`). Throughout the analysis, findings are separated into five epistemic tiers:

- **(a) Attested textual / original-language evidence** — exact MT, LXX, and NT tokens, Strong's numbers, lemmas, and verse-level witnesses directly returned by the tools.
- **(b) Linguistic / grammatical relationships** — shared roots, morphological/stem shifts (*niphal* vs. *piel*, compound vs. split tagging), and MT–LXX translational correspondences.
- **(c) Structural / rhetorical parallels** — clause-order reversals, formulaic frames, and multi-passage motif symmetries.
- **(d) Physical / geographical realia** — attested place-name topography (e.g., Jezreel valley, Valley of Achor on Judah's northern boundary).
- **(e) Interpretive hypotheses** — plausible theological or exegetical syntheses inferred from (a)–(d), explicitly flagged as non-mechanical inferences.

*(Note on versification: English/LXX verse numbering is used as the primary reference key unless `MT` is specified; Hosea 1:10–11 Eng./LXX = MT 2:1–2, and Hosea 2:1–23 Eng./LXX = MT 2:3–25.)*

---

## 2. Summary of Exact MCP Calls Made

Sixteen MCP tool calls (plus `--list-tools`) were executed and logged to `research/v3/opt-cycle1/local_D2.jsonl` using `--target local --no-supabase`.

| # | Tool | Arguments (Summary / Exact JSON) | Latency (ms) | Wire Bytes | Payload Bytes | Status / Notes |
|---:|---|---|---:|---:|---:|---|
| 0 | `--list-tools` | *(schema discovery; unlogged)* | 3,548 | 16,099 | 30,058 | `ok` — 7 tools exposed (`get_Passage`, `get_Word`, `get_Connection`, `follow_connectionchain`, `research`, `write_Note`, `get_prompt`) |
| 1 | `get_prompt` | `{}` | 2,621 | 10,756 | 5,241 | `ok` — server guidance & workflow conventions |
| 2 | `get_Passage` | `{"passage":"Hosea 1","depth":5,"literary":1}` | 57,993 | 30,706 | 26,567 | `ok` — MT/WEB text, tokens, xrefs, clues, literary summary |
| 3 | `get_Passage` | `{"passage":"Hosea 2","depth":5,"literary":1}` | 91,383 | 52,564 | 45,603 | `ok` — full ch. 2 tokens, clues, literary summary |
| 4 | `get_Passage` | `{"passage":"Joshua 7","depth":5,"literary":1}` | 56,750 | 71,504 | 62,131 | `ok` — full ch. 7 tokens, xrefs, clues |
| 5 | `get_Passage` | `{"passage":"Romans 9:25-26","depth":5,"literary":1,"view":"evidence"}` | 59,740 | 25,403 | 22,319 | `ok` — NT tokens, xrefs, evidence clues |
| 6 | `research` | `{"view":"evidence","operations":[{"id":"tri_rom","op":"tri_textual_diff","passage":"Romans 9:25-26"},{"id":"lxx_hos1","op":"lxx","passage":"Hosea 1:4-11"},{"id":"lxx_hos2","op":"lxx","passage":"Hosea 2:14-23"},{"id":"lxxc_raham","op":"lxx_concordance","word":"H7355"},{"id":"lxxc_achor","op":"lxx_concordance","word":"H5911"},{"id":"lxxc_akar","op":"lxx_concordance","word":"H5916"},{"id":"lxxc_yizreel","op":"lxx_concordance","word":"H3157"},{"id":"lxxc_lo_ruh","op":"lxx_concordance","word":"H3819"}]}` | 47,752 | 113,411 | 98,319 | `ok` — 8/8 ops succeeded (note alignment glitch on `lxxc_lo_ruh`) |
| 7 | `get_Connection` | `{"items":["Hosea 1-2","Joshua 7","Romans 9:25-26"],"connections":15,"view":"evidence"}` | 92,604 | 35,027 | 32,011 | `ok` — returned `verified_three_edge_triangle` + connection clues |
| 8 | `research` | `{"view":"evidence","operations":[{"id":"lit_hos1","op":"literary_structure","passage":"Hosea 1","detail":"deep","compare_lxx":true,"include_alternatives":true},{"id":"lit_hos2","op":"literary_structure","passage":"Hosea 2","detail":"deep","compare_lxx":true,"include_alternatives":true},{"id":"wp_hos_josh","op":"wordplay_scan","a":"Hosea 1-2","b":"Joshua 7"},{"id":"wp_hos","op":"wordplay_scan","passage":"Hosea 1-2"},{"id":"seq_hos","op":"sequence_parallels","source":"Hosea 1:4-11","target":"Hosea 2:1-23"},{"id":"seq_hos_rom","op":"sequence_parallels","source":"Hosea 1:10-2:23","target":"Romans 9:25-26"},{"id":"occ_achor","op":"occurrences","word":"H5911","hydrate_verses":true},{"id":"occ_akar","op":"occurrences","word":"H5916","hydrate_verses":true}]}` | 66,927 | 236,049 | 209,345 | `ok` (batch), 6/8 ops ok; `occ_achor` & `occ_akar` returned `invalid_request` (`hydrate_verses` unrecognized) |
| 9 | `research` | `{"view":"evidence","operations":[{"id":"tri_rom25","op":"tri_textual_diff","passage":"Romans 9:25"},{"id":"tri_1pet","op":"tri_textual_diff","passage":"1 Peter 2:10"},{"id":"lxx_hos2_1","op":"lxx","passage":"Hosea 2:1-4"},{"id":"lxx_josh7","op":"lxx","passage":"Joshua 7:24-26"},{"id":"lxx_isa65","op":"lxx","passage":"Isaiah 65:10"},{"id":"lxx_1chr2","op":"lxx","passage":"1 Chronicles 2:7"},{"id":"occ_achan","op":"occurrences","word":"H5912","detail":"full"},{"id":"occ_achor2","op":"occurrences","word":"H5911","detail":"full"}]}` | 48,261 | 160,289 | 139,579 | `ok` — 8/8 ops succeeded |
| 10 | `research` | `{"view":"evidence","operations":[{"id":"occ_lo_ammi","op":"occurrences","word":"H3818","detail":"full"},{"id":"occ_lo_ruh","op":"occurrences","word":"H3819","detail":"full"},{"id":"occ_yizreel","op":"occurrences","word":"H3157","detail":"full","limit":40},{"id":"wp_achor","op":"wordplay_scan","a":"H5912","b":"H5911"},{"id":"wp_achar","op":"wordplay_scan","a":"H5917","b":"H5916"},{"id":"wp_yiz_zar","op":"wordplay_scan","a":"H3157","b":"H2232"},{"id":"trace_achor","op":"trace_evidence","from":"Hosea 2:15","to":"Joshua 7:26","max_hops":3},{"id":"expand_nt","op":"expand_clue","expand_id":"nt_typological_citation:Hosea 1-2:Romans 9:25-26","detail":"full"}]}` | 29,254 | 295,550 | 260,222 | `ok` (batch); `trace_achor` = `partial`; `expand_nt` = `not_found` |
| 11 | `get_Word` | `{"word":"H5912","etymology":3,"view":"evidence"}` | 10,895 | 14,929 | 13,477 | `ok` — Achan (`עָכָן`) lexical & occurrence profile |
| 12 | `get_Word` | `{"word":"H3157","etymology":3,"view":"evidence"}` | 7,378 | 17,057 | 15,369 | `ok` — Jezreel (`יִזְרְעֶאל`) etymology & family (`H2232`+`H0410`) |
| 13 | `follow_connectionchain` | `{"next":"Hosea 2:15","limit":8,"view":"clues"}` | 5,605 | 6,798 | 6,014 | `ok` — hop 0 surfaced `Isa 65:10`, `Josh 7:24`, `Josh 15:7` |
| 14 | `follow_connectionchain` | `{"chain":"ch_c57b93da36a61dcc96b580aa_0dd04116ec92ea228fc572187231190a5a8c","action":"follow","next":"Joshua 7:24","next_id":"r13:colloc:H5911:H6010","limit":8}` | 7,362 | 204 | 81 | `is_error: true` (`chain_not_found`) — stateless local CLI processes do not persist chain handles |
| 15 | `research` | `{"view":"evidence","operations":[{"id":"lxx_hos1_1_3","op":"lxx","passage":"Hosea 1:1-3"},{"id":"lxx_josh7_1","op":"lxx","passage":"Joshua 7:1"},{"id":"lxx_num13_16","op":"lxx","passage":"Numbers 13:16"},{"id":"crq_akar","op":"clause_role_query","predicate":"H5916","limit":20},{"id":"crq_raham","op":"clause_role_query","predicate":"H7355","limit":25},{"id":"sc_achor","op":"set_combine","include":["H6010","H5911"],"testament":"OT","hydrate_verses":true},{"id":"sc_raham_am","op":"set_combine","include":["H7355","H5971"],"testament":"OT","hydrate_verses":true},{"id":"seq_josh_hos","op":"sequence_parallels","source":"Joshua 7:24-26","target":"Hosea 2:14-17"}]}` | 19,895 | 69,741 | 60,853 | `ok` — 8/8 ops succeeded (note LXX verse offset on Num 13:16) |
| 16 | `get_Passage` | `{"passage":"1 Peter 2:9-10","depth":3,"literary":1,"view":"evidence"}` | 13,611 | 25,379 | 22,247 | `ok` — NT comparative witness for Hosea reception |

---

## 3. Textually Verified Discoveries

### 3.1 Hosea 1–2: The Children's Sign-Names, Morphological Tagging Shifts, and Sequence Inversions

1. **The Prophetic Frame (`Hosea 1:1–2`) [a, b]:**
   The superscription names the prophet `הוֹשֵׁעַ` (**H1954**, *ho.she.a*, "Hosea", derived from `יָשַׁע` **H3467**, "to save"), son of `בְּאֵרִי` (**H0882**, linked to `בְּאֵר` **H0875**, "well"), prophesying under `עֻזִּיָּה` (**H5818**), `יוֹתָם` (**H3147**), `אָחָז` (**H0271**), `יְחִזְקִיָּה` (**H3169**) of Judah (`יְהוּדָה` **H3063**) and `יָרָבְעָם` (**H3379**) son of `יוֹאָשׁ` (**H3101**) of Israel (`יִשְׂרָאֵל` **H3478**). `wp_hos` flags the cognate talionic frame in 1:2 (`כִּֽי־זָנֹ֤ה תִזְנֶה֙ הָאָ֔רֶץ`, infinitive absolute + imperfect) and 1:7 (`וְהוֹשַׁעְתִּים`, `H3467` echoing `הוֹשֵׁעַ` `H1954`).

2. **The Three Children's Names and Their Reversals Across Hosea 1–2 [a, b, c]:**
   `lit_hos1` cleanly segments Hosea 1 into three naming units marked by the terminal formula `קְרָא שְׁמוֹ/שְׁמָהּ` (`H7121` + `H8034`, vv. 4, 6, 9) followed by the restoration conclusion (vv. 10–11):

   | Child | Judgment Act (Hos 1) | MT Tokens / Strong's | Restoration Act 1 (Hos 1:10–2:1 [MT 2:1–3]) | Restoration Act 2 (Hos 2:21–23 [MT 2:23–25]) |
   |---|---|---|---|---|
   | **1. Jezreel** | **1:4–5**: `קְרָא שְׁמוֹ יִזְרְעֶאל` (**H3157**, *yiz.re.el*, etym. `זָרַע` **H2232** "sow" + `אֵל` **H0410** "God"); judgment on `בֵּית יֵהוּא` (`H3058`) and breaking Israel's bow `בְּעֵמֶק יִזְרְעֶאל` (`H6010`+**H3157**). | `H3157` | **1:11**: `עָלוּ מִן־הָאָרֶץ כִּי גָדוֹל יוֹם יִזְרְעֶאל` (`H3157`) — gathering of Judah & Israel under `רֹאשׁ אֶחָד`. | **2:22–23**: `וְהֵם יַעֲנוּ אֶת־יִזְרְעֶאל` (**H3157**) + `וּזְרַעְתִּיהָ לִּי בָּאָרֶץ` (**H2232** `זָרַע`, "I will sow her for myself in the land"). |
   | **2. Lo-Ruhamah** | **1:6, 8**: `קְרָא שְׁמָהּ לֹא רֻחָמָה` (**H3819**, *lo ru.cha.mah*, "No Mercy"); `לֹא אוֹסִיף עוֹד אֲרַחֵם` (**H7355** `רָחַם`). | Compound **H3819** (1:6, 8) + verb `H7355` (1:6) | **2:1** [MT 2:3]: placed **second** after `עַמִּי`: `וְלַאֲחוֹתֵיכֶם רֻחָמָה` (**H7355**, "Mercy / Pitied"). | **2:23** [MT 2:25]: `וְרִחַמְתִּי אֶת־לֹא רֻחָמָה` — **H7355** (`רָחַם`) + split **H3808** (`לֹא`) + **H7355** (`רֻחָמָה`). |
   | **3. Lo-Ammi** | **1:9**: `קְרָא שְׁמוֹ לֹא עַמִּי` (**H3818**, *lo am.mi*, "Not My People"); `כִּי אַתֶּם לֹא עַמִּי וְאָנֹכִי לֹא־אֶהְיֶה לָכֶם` (`H3808`+`H5971`, and `לֹא־אֶהְיֶה` `H1961`). | Compound **H3818** (`H3808`+`H5971` in clause 2) | **1:10**: `בִּמְקוֹם אֲשֶׁר־יֵאָמֵר לָהֶם לֹא־עַמִּי אַתֶּם יֵאָמֵר לָהֶם בְּנֵי אֵל־חָי`. **2:1**: placed **first**: `אִמְרוּ לַאֲחֵיכֶם עַמִּי` (**H5971**). | **2:23** [MT 2:25]: `וְאָמַרְתִּי לְלֹא־עַמִּי עַמִּי־אַתָּה` — `H0559` + split **H3808** (`לֹא`) + **H5971** (`עַמִּי`), answered by `וְהוּא יֹאמַר אֱלֹהָי`. |

3. **Key Lexical & Morphological Observations [a, b, c]:**
   - **Compound vs. split Strong's tagging:** In Hosea 1:6, 8, 9, the negative sign-names carry dedicated compound Strong's tags (`H3819` `לֹא רֻחָמָה` and `H3818` `לֹא עַמִּי`). In Hosea 2:23, the MT reverses them using separate lexical tokens (`H3808` `לֹא` + `H7355` `רֻחָמָה`, and `H3808` `לֹא` + `H5971` `עַמִּי`), though `occ_lo_ammi` (`H3818`) notably records `filtered_count: 2` (`verse_ids: [22220, 22245]`, i.e., Hos 1:9 and Hos 2:23) even while reporting `total_verses: 1`.
   - **Polyvalence of Jezreel (`H3157`):** In `1:4–5`, Jezreel denotes the historical bloodguilt of Jehu's house (cf. 2 Kgs 9–10, surfaced in `occ_yizreel`) and the military breaking of Israel in `עֵמֶק יִזְרְעֶאל` (`H6010`+`H3157`). In `2:22–23`, `יִזְרְעֶאל` is etymologically re-activated as its literal root meaning via `וּזְרַעְתִּיהָ` (`H2232` `זָרַע`, "I will sow her", `wp_yiz_zar` confirmed shared root consonant sequence `זרע`), turning a place of bloodshed into a cosmic agricultural-covenantal chain (`הַשָּׁמַיִם` → `הָאָרֶץ` → `הַדָּגָן / הַתִּירוֹשׁ / הַיִּצְהָר` → `יִזְרְעֶאל`, linked by fivefold `עָנָה` `H6030` in vv. 21–22).
   - **Sequence Inversion (1:6, 9 → 2:1 → 2:23) [c]:** Hosea 1 introduces the children in the order **(1) Jezreel → (2) Lo-Ruhamah → (3) Lo-Ammi**. At the opening of chapter 2 (**2:1** [MT 2:3]), the restoration address immediately **inverts** the second and third names: `עַמִּי` (*Ammi*) comes **before** `רֻחָמָה` (*Ruhamah*). At the chapter's climax (**2:22–23**), the original 1-2-3 order is restored (`Jezreel / sow → Ruhamah → Ammi`), culminating in the mutual covenant formula (`לֹא־אֶהְיֶה לָכֶם` in 1:9 reversed into `אֱלֹהָי` in 2:23). `seq_hos` and `seq_hos_rom` both flagged `mirror_inversion` (`CONCORDANT`, though with weak statistical `p_null` values of `0.5538` and `0.5077`).
   - **Marital Naming Inversions (`Hosea 2:16–17` [MT 2:18–19]) [a, b]:** Mirroring the children's renamings, Israel's address to YHWH undergoes a parallel lexical substitution: `תִּקְרְאִי אִישִׁי` (`H0376`, "my husband/man") replaces `בַּעְלִי` (`H1180`, "my Baal/master"), followed by the removal of `שְׁמוֹת הַבְּעָלִים` (`H8034`+`H1168`, v. 17).
   - **OT Co-occurrence Profile (`sc_raham_am`) [a, b]:** A `set_combine` query intersecting `רָחַם` (`H7355`) and `עַם` (`H5971`) across the entire OT returned **only 7 verses**: Deut 30:3, 1 Kgs 8:50, Isa 27:11, Isa 49:13, Jer 21:7, Hos 2:1, and Hos 2:23.

---

### 3.2 Joshua 7 & the Valley of Achor (`עֵמֶק עָכוֹר`): Wordplay, LXX Standardization, and Canonical Bridges

1. **Achan (`עָכָן`, H5912) and the Troubling Wordplay (`עָכַר`, H5916) in Joshua 7 [a, b]:**
   - `occ_achan` (`H5912`) attests `עָכָן` in **6 OT verses**: Josh 7:1, 18, 19, 20, 24, and Josh 22:20.
   - In Josh 7:1, `עָכָן בֶּן־כַּרְמִי בֶן־זַבְדִּי בֶן־זֶרַח לְמַטֵּה יְהוּדָה` commits `מַעַל` (`H4603`/`H4604`, unfaithfulness) regarding `הַחֵרֶם` (`H2764`, the devoted things), kindling YHWH's anger (`וַיִּחַר אַף יְהוָה`).
   - In **Josh 7:24–26**, Achan and his household are brought to `עֵמֶק עָכוֹר` (**H6010** `עֵמֶק` + **H5911** `עָכוֹר`, "Valley of Achor"). Joshua confronts him with a doubled *figura etymologica* on **`עָכַר` (`H5916`, "to trouble")**: `מֶה עֲכַרְתָּנוּ יַעְכֳּרְךָ יְהוָה בַּיּוֹם הַזֶּה` ("Why have you troubled us? Yahweh will trouble you this day," v. 25), after which `וַיָּשָׁב יְהוָה מֵחֲרוֹן אַפּוֹ עַל־כֵּן קָרָא שֵׁם הַמָּקוֹם הַהוּא עֵמֶק עָכוֹר עַד הַיּוֹם הַזֶּה` (v. 26).
   - **Etymological / Orthographic Distinction (`wp_achor`, `wp_achar`) [b]:** Between `עָכָן` (`H5912`) and `עָכוֹר` (`H5911`), there is a consonantal shift (`ן` vs. `ר`, edit distance 1), so `wp_achor` records `proven_common_root: false` despite the narrative pun in Josh 7:25–26.

2. **Intermediate Canonical Bridge — `1 Chronicles 2:7` (`עָכָר` H5917) & LXX Harmonization [a, b]:**
   - **1 Chronicles 2:7** supplies the exact consonantal harmonization: `וּבְנֵי כַרְמִי עָכָר עוֹכֵר יִשְׂרָאֵל אֲשֶׁר מָעַל בַּחֵרֶם` (**H5917** `עָכָר` *Achar* + **H5916** `עוֹכֵר` "troubler of Israel"). Here `wp_achar` verifies `attested_textual_wordplay: true` (`consonantal_exact`, edit distance 0 on root `עכר`).
   - **Crucial LXX alignment across Joshua 7 and 1 Chronicles 2:7:** Already in **Joshua 7:1, 24, 25 LXX**, the Greek translator removes the MT `עָכָן` / `עָכוֹר` consonantal gap by rendering `עָכָן` as **`Ἀχὰρ`** (*Achar*) — identical to 1 Chr 2:7 LXX (`Ἀχὰρ ὁ ἐμποδοστάτης Ἰσραήλ`). Moreover, Josh 7:24–26 LXX renders `עָכַר` (`H5916`) with `ὀλεθρεύω` / `ἐξολεθρεύω` ("destroy/utterly destroy": `Τί ὠλέθρευσας ἡμᾶς; ἐξολεθρεύσαι σε κύριος`) and renders `עֵמֶק עָכוֹר` in 7:24 with a **translational + transliterated doublet**: `εἰς φάραγγα Ἀχώρ` ... `εἰς Ἐμεκαχώρ` (and `Ἐμεκαχὼρ` in 7:26).

3. **All Five Occurrences of `עֵמֶק עָכוֹר` (`H6010` + `H5911`, `sc_achor` & `occ_achor2`) [a, d]:**
   `sc_achor` (`H6010` ∩ `H5911`) and `occ_achor2` (`H5911`, `book_distribution: {"6": 3, "23": 1, "28": 1}`) establish every OT attestation of the Valley of Achor:
   1. **Joshua 7:24** — site of Achan's execution (`εἰς φάραγγα Ἀχώρ` / `Ἐμεκαχώρ`).
   2. **Joshua 7:26** — naming etiology (`עַל־כֵּן קָרָא שֵׁם הַמָּקוֹם הַהוּא עֵמֶק עָכוֹר`; LXX `Ἐμεκαχὼρ`).
   3. **Joshua 15:7** [d] — geographical boundary marker on Judah's northern border (`וְעָלָה הַגְּבוּל דְּבִרָה מֵעֵמֶק עָכוֹר`).
   4. **Isaiah 65:10** — intermediate prophetic bridge (`וְהָיָה הַשָּׁרוֹן לִנְוֵה־צֹאן וְעֵמֶק עָכוֹר לְרֵבֶץ בָּקָר לְעַמִּי אֲשֶׁר דְּרָשׁוּנִי`; LXX `καὶ φάραγξ Ἀχὼρ εἷς ἀνάπαυσιν Βουκολίων τῷ λαῷ μου οἱ ἐζήτησάν με`). Notice that Isa 65:10 explicitly transforms the Valley of Achor into a resting-place **"for my people"** (`לְעַמִּי` / `τῷ λαῷ μου`) — uniting the Achor reversal motif directly with Hosea's `עַמִּי` terminology!
   5. **Hosea 2:15 [MT 2:17]** — `וְנָתַתִּי לָהּ אֶת־כְּרָמֶיהָ מִשָּׁם וְאֶת־עֵמֶק עָכוֹר לְפֶתַח תִּקְוָה וְעָנְתָה שָּׁמָּה כִּימֵי נְעוּרֶיהָ וּכְיוֹם עֲלֹתָהּ מֵאֶרֶץ־מִצְרָיִם`.

4. **Structural & Thematic Inversion Between Joshua 7:24–26 and Hosea 2:14–16 [c, e]:**
   - In **Joshua 7**, `עֵמֶק עָכוֹר` stands at the **threshold of the conquest** as a place of hidden sin (`מַעַל`), divine wrath (`אַף`), stoning, and memorialized **troubling** (`עָכַר`). Note also that Josh 7:26 ends with YHWH turning from the fierceness of his anger (`וַיָּשָׁב יְהוָה מֵחֲרוֹן אַפּוֹ`), establishing an initial turn from wrath only *after* judgment.
   - In **Hosea 2:14–15**, YHWH brings Israel back into `הַמִּדְבָּר` ("the wilderness," v. 14) and re-stages the entrance into the land as a second Exodus (`וּכְיוֹם עֲלֹתָהּ מֵאֶרֶץ־מִצְרָיִם`, v. 15), turning `עֵמֶק עָכוֹר` ("Valley of Trouble") into `פֶּתַח תִּקְוָה` (`H6607` + `H8615`, "a door of hope") and restoring her vineyards (`כְּרָמֶיהָ` — notable word-sound resonance with Achan's patronymic `כַּרְמִי` in Josh 7:1, 18, though `כֶּרֶם` "vineyard" vs. `כַּרְמִי` "Carmi" is an interpretive/paronomastic observation **[e]**, not an attested etymological claim).
   - **Onomastic Bridge Surfaced by `get_Connection` (`Numbers 13:16`) [a, b]:** `get_Connection` linked **Hosea (`H1954` `הוֹשֵׁעַ`)** and **Joshua (`H3091` `יְהוֹשֻׁעַ`)** via **Numbers 13:16**, where Moses renames `הוֹשֵׁעַ בִּן־נוּן` (`H1954`) to `יְהוֹשֻׁעַ` (`H3091`) — both names rooted in `יָשַׁע` (`H3467`, "to save"). Thus the prophet Hosea bears the original unexpanded name of Joshua himself.

---

### 3.3 LXX Shifts Across Hosea 1–2 and Their Downstream Consequences

Direct inspection of Rahlfs LXX (`lxx_hos1`, `lxx_hos2_1`, `lxx_hos2`, `lxx_hos1_1_3`) alongside MT reveals **six decisive LXX divergences** that reshape the theology of naming and enable Paul's and Peter's NT quotations:

| Reference | MT Text (Observed) | LXX Text (Observed) | Nature & Significance of Shift [a, b] |
|---|---|---|---|
| **Hos 1:4** | `עַל בֵּית יֵהוּא` ("upon the house of Jehu", `H3058`) | `ἐπὶ τὸν οἶκον Ἰούδα` ("upon the house of **Judah**") | **Historical/dynastic shift**: Jehu's northern dynasty is replaced by Judah in LXX (possibly through graphic confusion or later Judean actualization). |
| **Hos 1:6** | `לֹא רֻחָמָה` (`H3819`) ... `אֲרַחֵם` (`H7355`) ... `כִּי נָשֹׂא אֶשָּׂא לָהֶם` ("that I should in any way pardon them", `H5375`) | `Οὐκ ἠλεημένη` ... `ἐλεῆσαι` ... `ἀλλʼ ἢ ἀντιτασσόμενος ἀντιτάξομαι αὐτοῖς` ("but rather **opposing I will oppose them**") | **(1)** Uses **`ἐλεέω`** ("show mercy") for `רָחַם`; **(2)** reverses the sense of MT's ambiguous `נָשֹׂא אֶשָּׂא` (pardon/forgive vs. take away) into emphatic divine hostility (`ἀντιτάξομαι`). |
| **Hos 1:10** [MT 2:1] | `וְהָיָה מִסְפַּר` ... `אֲשֶׁר־יֵאָמֵר לָהֶם לֹא־עַמִּי אַתֶּם יֵאָמֵר לָהֶם בְּנֵי אֵל־חָי` (`אָמַר` `H0559` *niphal* twice) | `Καὶ ἦν ὁ ἀριθμὸς` ... `οὗ ἐρρέθη αὐτοῖς Οὐ λαός μου ὑμεῖς, **κληθήσονται καὶ αὐτοὶ** υἱοὶ θεοῦ ζῶντος` | **(1)** First `וְהָיָה` → imperfect `Καὶ ἦν` ("and the number was"); **(2)** second `יֵאָמֵר לָהֶם` ("it shall be said to them") shifts from `εἶπον/ἐρρέθη` to **`κληθήσονται καὶ αὐτοὶ`** (`καλέω`, "they themselves **shall be called**") — the exact verb Paul quotes in **Rom 9:26**! |
| **Hos 2:1** [MT 2:3] | `אִמְרוּ לַאֲחֵיכֶם עַמִּי וְלַאֲחוֹתֵיכֶם רֻחָמָה` (plural brothers/sisters) | `εἴπατε τῷ ἀδελφῷ ὑμῶν Λαός μου. καὶ τῇ ἀδελφῇ ὑμῶν Ἐλεημένη.` (singular brother/sister) | Singularizes addressees while keeping **`Ἐλεημένη`** (`ἐλεέω`) and preserving the inverted order (`Λαός μου` → `Ἐλεημένη`). |
| **Hos 2:15** [MT 2:17] | `כְּרָמֶיהָ` ("her vineyards") / `לְפֶתַח תִּקְוָה` ("for a door of hope") / `וְעָנְתָה` ("and she shall answer/sing", `H6030`) / `נְעוּרֶיהָ` ("her youth") | `τὰ κτήματα αὐτῆς` ("her possessions") / `**διανοῖξαι σύνεσιν αὐτῆς**` ("to open her **understanding**") / `**ταπεινωθήσεται**` ("she shall be **humbled**") / `νηπιότητος` ("infancy") | **Major LXX theological re-reading**: `תִּקְוָה` ("hope") is read via Aramaic/late Hebrew or cognitive metaphor as `σύνεσις` ("understanding"); and `וְעָנְתָה` is taken from homonymous `עָנָה II` ("be afflicted/humbled") rather than `עָנָה I` ("answer/sing", cf. 2:21–22 `ἐπακούσεται`). |
| **Hos 2:23** [MT 2:25] | `וְרִחַמְתִּי אֶת־לֹא רֻחָמָה` (`רָחַם` `H7355`) ... `וְהוּא יֹאמַר אֱלֹהָי` | `καὶ **ἀγαπήσω τὴν Οὐκ ἠγαπημένην**` ... `καὶ αὐτὸς ἐρεῖ **Κύριος** ὁ θεός μου εἰ σύ.` | **Decisive lexical shift**: LXX switches from `ἐλεέω` (1:6, 8; 2:1, 4) to **`ἀγαπάω`** ("love"), producing `Οὐκ ἠγαπημένην` — the exact form cited in **Rom 9:25** — and expands Israel's final confession with `Κύριος`. |

*(Additional `lxx_concordance` lexical distributions verified in Call 6: `H7355` `רָחַם` maps predominantly to `ἐλεέω` [29] and `οἰκτείρω` [12], with `ἀγαπάω` only twice in MT-aligned OT [Ps 18:1 + Hos 2:23]; `H5911` `עָכוֹר` maps to `Ἀχώρ` [5] / `Ἐμεκαχώρ` [1]; `H5916` `עָכַר` maps across `ὀλεθρεύω` [3], `ἐξολεθρεύω` [3], `ἐκταράσσω` [2], `ταράσσω` [2], `ἀπόλλυμι` [2], `διαστρέφω` [1], `καταστρέφω` [1].)*

---

### 3.4 Romans 9:25–26 & 1 Peter 2:10: Composite Quotation Mechanics and Dual LXX Streams

1. **Text of Romans 9:25–26 (Verified Tokens) [a]:**
   - **9:25**: `ὡς καὶ ἐν τῷ Ὡσηὲ λέγει Καλέσω τὸν οὐ λαόν μου λαόν μου καὶ τὴν οὐκ ἠγαπημένην ἠγαπημένην` (`G5617` `Ὡσηέ`, `G2564` `καλέω`, `G2992` `λαός`, `G0025` `ἀγαπάω`).
   - **9:26**: `καὶ ἔσται ἐν τῷ τόπῳ οὗ ἐρρέθη αὐτοῖς Οὐ λαός μου ὑμεῖς ἐκεῖ κληθήσονται υἱοὶ Θεοῦ ζῶντος` (`G5117` `τόπος`, `G2046` `ἐρέω`, `G2992` `λαός`, `G1563` `ἐκεῖ`, `G2564` `καλέω`, `G5207` `υἱός`, `G2316` `θεός`, `G2198` `ζάω`).

2. **Four Textual Modifications in Paul's Quotation of Hosea [a, b, c]:**
   - **(1) Composite splicing of Hos 2:23 + Hos 1:10:** Rom 9:25 draws its content from **Hos 2:23** (`Οὐ λαός μου` / `Οὐκ ἠγαπημένην`), while Rom 9:26 continues seamlessly with **Hos 1:10b** (`καὶ ἔσται ἐν τῷ τόπῳ ...`).
   - **(2) Sequence Inversion (`Ruhamah → Ammi` in 2:23 reversed to `People → Beloved` in Rom 9:25):** Whereas Hos 2:23 LXX places `ἀγαπήσω τὴν Οὐκ ἠγαπημένην` **before** `ἐρῶ τῷ Οὐ λαῷ μου Λαός μου εἶ σύ`, Paul reverses the clauses so `τὸν οὐ λαόν μου λαόν μου` comes **first** (matching the inverted order already present in **Hos 2:1** and enabling a tight verbal link between `λαόν μου` at the end of v. 25 and `Οὐ λαός μου` at the start of v. 26).
   - **(3) Lexical Unification Under `καλέω` ("to call"):** In Hos 2:23 LXX, the two verbs are `ἀγαπήσω` ("I will love") and `ἐρῶ` ("I will say"). Paul replaces both with **`Καλέσω`** ("I will call", future active of `G2564` `καλέω`), harmonizing Hos 2:23 with **`κληθήσονται`** (`G2564`, "they shall be called") in Hos 1:10 LXX (which itself rendered MT `יֵאָמֵר לָהֶם` with `καλέω`, as verified in `lxx_hos1`!) and tying the quotation directly to Paul's `καλέω` theme in Rom 9:7, 11, 24.
   - **(4) Retention of `ἀγαπάω` and Modification of Hos 1:10b (`ἐκεῖ` for `καὶ αὐτοὶ`):** Paul depends unmistakably on the **LXX** of Hos 2:23 (`ἠγαπημένην`, `ἀγαπάω`) rather than MT `רֻחָמָה` (`ἐλεέω`), and on the **LXX** of Hos 1:10 (`ὑμεῖς`, `κληθήσονται`), while substituting **`ἐκεῖ`** ("there") for LXX `καὶ αὐτοὶ` ("even they") to sharpen the locative contrast (`ἐν τῷ τόπῳ ... ἐκεῖ`). *(Note: `tri_rom` mislabeled `ἐκεῖ κληθήσονται` as `agrees_lxx_against_mt`, even though `lxx_hos1` proves Rahlfs `Osee 1:10` actually reads `κληθήσονται καὶ αὐτοὶ`, without `ἐκεῖ`.)*

3. **Comparison with `1 Peter 2:10` — Divergent LXX Stream, Identical Sequence Inversion [a, b, c]:**
   - **1 Peter 2:10**: `οἵ ποτε οὐ λαὸς νῦν δὲ λαὸς Θεοῦ οἱ οὐκ ἠλεημένοι νῦν δὲ ἐλεηθέντες` (`G2992` `λαός`, `G1653` `ἐλεέω`).
   - Like Romans 9:25 (and Hosea 2:1), 1 Peter 2:10 follows the **inverted sequence** (`People` before `Mercy`).
   - Unlike Romans 9:25 (which takes `ἠγαπημένην` from Hos 2:23 LXX), 1 Peter 2:10 uses **`ἠλεημένοι / ἐλεηθέντες`** (`G1653` `ἐλεέω`), matching **Hos 1:6, 8 and 2:1 LXX** (`Οὐκ ἠλεημένη` / `Ἐλεημένη`) — or a Greek tradition closer to MT `רֻחָמָה` — while replacing singular feminine participles with plural masculine nominatives (`οἱ οὐκ ἠλεημένοι`). Notice also `crq_raham` / `occ_lo_ammi` cross-references showing `1 Pet 2:10` as a canonical twin to `Hos 1:9–10` and `2:23`.

---

### 3.5 Summary Matrix by Epistemic Tier

| Category | Verified Claims in This Study |
|---|---|
| **(a) Attested textual evidence** | Exact MT/LXX/NT forms and Strong's IDs (`H1954`, `H3157`, `H3819`, `H3818`, `H7355`, `H5971`, `H2232`, `H5912`, `H5911`, `H5916`, `H5917`, `H3091`, `G2564`, `G2992`, `G0025`, `G1653`); exact 5 occurrences of `עֵמֶק עָכוֹר` (Josh 7:24, 26; 15:7; Isa 65:10; Hos 2:15); exact 6 occurrences of `עָכָן` (Josh 7:1, 18, 19, 20, 24; 22:20); 1 Chr 2:7 `עָכָר עוֹכֵר`; LXX shifts in Hos 1:4 (`Ἰούδα`), 1:6 (`ἀντιτάξομαι`), 1:10 (`κληθήσονται`), 2:15 (`διανοῖξαι σύνεσιν` / `ταπεινωθήσεται`), 2:23 (`ἀγαπήσω τὴν Οὐκ ἠγαπημένην`). |
| **(b) Linguistic / grammatical relationships** | `H3157` (`יִזְרְעֶאל`) = `H2232` (`זָרַע`) + `H0410` (`אֵל`); `H1954` (`הוֹשֵׁעַ`) & `H3091` (`יְהוֹשֻׁעַ`) share `H3467` (`יָשַׁע`); `1 Chr 2:7` `עָכָר`/`עוֹכֵר` is `consonantal_exact` (edit dist. 0) whereas Josh 7 `עָכָן`/`עָכוֹר` has edit dist. 1 (`ן`→`ר`); LXX Josh 7 harmonizes `עָכָן` to `Ἀχὰρ`; Hos 2:15 LXX reads `עָנְתָה` from `ענה II` ("humble") instead of `ענה I` ("answer/sing"). |
| **(c) Structural / rhetorical parallels** | Terminal `קְרָא שְׁמוֹ` segmentation in Hos 1:4, 6, 9; name-sequence inversion (`Jezreel → Lo-Ruhamah → Lo-Ammi` in ch. 1 vs. `Ammi → Ruhamah` in 2:1 vs. `Jezreel/sow → Ruhamah → Ammi` in 2:22–23); Paul's inversion of 2:23 clauses (`People → Beloved`) and unification under `καλέω`; 1 Pet 2:10 matching `People → Mercy` order. |
| **(d) Physical / geographical realia** | `עֵמֶק יִזְרְעֶאל` (Hos 1:5) as a military basin; `עֵמֶק עָכוֹר` as a real boundary depression on Judah's northern border (`Josh 15:7`) near Jericho/Ai (`Josh 7:24–26`) re-imagined as pastureland (`Isa 65:10`) and desert entryway (`Hos 2:15`). |
| **(e) Interpretive hypotheses** | That Hosea's `כְּרָמֶיהָ` ("vineyards," Hos 2:15) echoes Achan's patronymic `כַּרְמִי` ("Carmi," Josh 7:1); that Paul's `ἐκεῖ` in Rom 9:26 echoes `שָׁמָּה` ("there") in Hos 2:15 or intensifies Gentile inclusion "in the very place" of rejection; that Hosea frames restoration via `עֵמֶק עָכוֹר` specifically to reverse the threshold sin of Joshua 7 into a second-conquest "door of hope." |

---

## 4. Dedicated System Evaluation (All 8 Questions)

### Q1. What did the MCP server help you discover that you would not easily have noticed or verified from memory alone?
- **Exact MT vs. LXX divergences in Hosea 1–2 and Joshua 7:** Calling `research` with `op: "lxx"` cleanly surfaced Rahlfs Greek side-by-side with aligned Hebrew Strong's tags, immediately spotlighting non-obvious shifts: Hos 1:4 `יֵהוּא` → `Ἰούδα`; Hos 1:6 `כִּי נָשֹׂא אֶשָּׂא לָהֶם` → `ἀλλʼ ἢ ἀντιτασσόμενος ἀντιτάξομαι αὐτοῖς`; Hos 1:10 `יֵאָמֵר לָהֶם` → `κληθήσονται καὶ αὐτοὶ` (explaining Paul's `καλέω` unification); Hos 2:15 `לְפֶתַח תִּקְוָה` → `διανοῖξαι σύνεσιν αὐτῆς` and `וְעָנְתָה` → `ταπεινωθήσεται`; Josh 7:1/24/25 `עָכָן` already harmonized to `Ἀχὰρ` and `עֵמֶק עָכוֹר` doubled as `φάραγγα Ἀχώρ` + `Ἐμεκαχώρ`.
- **Exhaustive corpus distributions (`set_combine`, `occurrences`, `lxx_concordance`):** `sc_achor` proved there are **exactly 5** OT verses containing `עֵמֶק` + `עָכוֹר` (`Josh 7:24, 26; 15:7; Isa 65:10; Hos 2:15`); `sc_raham_am` isolated the **only 7** OT verses co-occurring `רָחַם` + `עַם`; and `lxx_concordance` quantified `H7355` (`ἐλεέω` 29 vs. `ἀγαπάω` 2) across the entire LXX.
- **Compound vs. split Strong's tagging in Hosea:** `H3819`/`H3818` in Hos 1:6, 8, 9 vs. split `H3808+H7355` / `H3808+H5971` in Hos 2:23 (alongside `occ_lo_ammi` still indexing `22245` / Hos 2:23).

### Q2. Did the MCP results lead you to interesting connections you might otherwise have missed?
Yes, in two concrete ways:
1. **`Numbers 13:16` (`H1954` `הוֹשֵׁעַ` → `H3091` `יְהוֹשֻׁעַ`):** Surfacing automatically in `get_Connection`, this connected the prophet Hosea's own name (`H1954`) to Joshua's pre-renaming name (`H1954`), enriching the Hosea–Joshua intertextual nexus beyond just Achor.
2. **`Isaiah 65:10` and `1 Chronicles 2:7` via `follow_connectionchain` / `get_Passage` xrefs:** Hop 0 on `Hosea 2:15` immediately linked Achor (`H5911`) to `Isaiah 65:10` (which bridges `עֵמֶק עָכוֹר` directly to `לְעַמִּי`, "for my people"), while Joshua 7 xrefs and `wordplay_scan` (`wp_achar`) surfaced `1 Chronicles 2:7`'s exact consonantal wordplay (`עָכָר עוֹכֵר`) as the lexical bridge between MT `עָכָן` and LXX `Ἀχὰρ`.

### Q3. How well could you follow up on leads and investigate intermediate clues?
- **Mixed — strong inside single `research` batches, broken across multi-turn chains:**
  - Single-shot `research` batching (`8` ops per call) was fast (`19–67s`) and productive for pivoting from a clue to `lxx`, `occurrences`, `set_combine`, `clause_role_query`, and `wordplay_scan`.
  - **Major blocker on `follow_connectionchain`:** Hop 0 (`Hosea 2:15`) worked (`5.6s`) and returned clear candidates, but Hop 1 failed with `chain_not_found` (`is_error: true`). Because each `scripts/mcp-bench-cli.mjs` call spawns a stateless local process, in-memory chain handles (`ch_...`) do not survive across CLI invocations.
  - **`expand_clue` failed (`status: "not_found"`)** on the exact `expand_id` (`nt_typological_citation:Hosea 1-2:Romans 9:25-26`) returned earlier by `get_Connection`.
  - **`trace_evidence` (`Hosea 2:15` → `Joshua 7:26`) returned `status: "partial"`** with `ctrl:missing_concepts` (`"Unresolved or unsupported query terms: hosea 2 15, joshua 7 26"`), yielding paths through `Judges 5:15` and `Genesis 38:29` rather than tracing the direct `H5911`/`H6010` bridge between those two verses.

### Q4. Were intermediate clues clearly surfaced, or did they require guesswork?
- **Passage-level and `follow_connectionchain` hop-0 clues were clear**, exposing explicit `clue_id`, `expand_id`, `source_ref`, `target_ref`, and Strong's keys.
- However, **`expand_id` round-tripping and `trace_evidence` input semantics required guesswork**: `trace_evidence` expects Strong's/concept terms rather than verse references (failing to parse `Hosea 2:15` / `Joshua 7:26` as verse endpoints), and `expand_id` from `get_Connection` was not recognized by `research(op: "expand_clue")`.

### Q5. What relationships or connections were missing that you expected to find?
1. **Achor (`H5911` / `H6010`) missing from `get_Connection(["Hosea 1-2", "Joshua 7", "Romans 9:25-26"])`:** Although `get_Connection` found a `verified_three_edge_triangle` (`G5617↔H1954`, `G2992↔H5971`, `H1954↔H3091`), it completely missed the primary explicit lexical link between Hosea 1–2 and Joshua 7 — **`עֵמֶק עָכוֹר` (`H6010` + `H5911`)** in Hos 2:15 and Josh 7:24, 26!
2. **`tri_textual_diff` failing to resolve composite OT quotations to Hosea 2:23:**
   - On `Romans 9:25–26`, `tri_rom` matched `9:26` to `Hosea 1:10` well, but aligned `9:25b` (`καὶ τὴν οὐκ ἠγαπημένην ἠγαπημένην`) to **`Deuteronomy 30:16`** (`ἀγαπᾶν`) instead of `Hosea 2:23`!
   - On `Romans 9:25` alone (`tri_rom25`), it spliced `Hosea 1:9` + **`Leviticus 19:18`** and omitted `Hosea 2:23` entirely!
   - On `1 Peter 2:10` (`tri_1pet`), `Hosea 2:23` ranked #1 in `candidate_sources` (`slot_count: 28`), yet the final splice selected **`Daniel 3:29`**, **`Jeremiah 7:16`**, and **`Isaiah 27:11`** instead of Hosea 1:6 / 1:9 / 2:1 / 2:23.
3. **MT/LXX versification mismatch in `op: "lxx"`:** Passing `"Numbers 13:16"` returned LXX `Numeri 13:16` (`τῆς φυλῆς Γάδ, Γουδιὴλ υἱὸς Μακχί`, which corresponds to MT Num 13:15/14), failing to auto-map MT↔LXX versification offsets (unlike Hosea 1:10–2:23, which mapped accurately).

### Q6. Were there distracting, noisy, or falsely elevated results?
Yes, several concrete cases:
- **Spurious splice matches in `tri_textual_diff`:** `Deuteronomy 30:16` (`tri_rom`), `Leviticus 19:18` (`tri_rom25`), and `Daniel 3:29` / `Jeremiah 7:16` (`tri_1pet`) were elevated into the primary `splices` output purely by isolated single-word Greek overlap (`ἀγαπάω`, `λαός`).
- **Inaccurate variant attribution in `tri_rom`:** `tri_rom` labeled `ἐκεῖ κληθήσονται` as `agrees_lxx_against_mt`, whereas `lxx_hos1` shows Rahlfs `Osee 1:10` actually reads `κληθήσονται καὶ αὐτοὶ` (only `κληθήσονται` agrees with LXX; `ἐκεῖ` is Paul's own substitution).
- **LXX token-alignment bug on `H3819` (`lxxc_lo_ruh`):** `lxx_concordance` for `H3819` (`לֹא רֻחָמָה`) reported `g_lemma: "ἔτι"` instead of `οὐκ ἠλεημένη` / `ἐλεέω` / `ἀγαπάω` because multi-word compound name tokens misaligned against adjacent Greek words (`ἔτι` / `ἀντιτασσόμενος`) in `Hos 1:6`.
- **Noisy consonantal pairs and Strong's mismatch in `wordplay_scan` (`wp_hos`):** Alongside genuine wordplays (`זָנֹה תִזְנֶה`, `הוֹשַׁעְתִּים`/`אוֹשִׁיעֵם`), `wp_hos` elevated accidental short-root overlaps (`מֶלֶךְ`↔`לֵךְ`, `עַם`↔`עֵמֶק`, `בַּת`↔`בֵּית`, `יְהוָה`↔`עֻזִּיָּה`) and swapped Strong's pairings on `onomastic_valence` (`H3819` `לֹא רֻחָמָה` paired with `עַמִּי` and `H3818` `לֹא עַמִּי` paired with `אֲרַחֵם`).
- **`occ_lo_ammi` count inconsistency:** Reported `"total_verses": 1` alongside `"filtered_count": 2` (`verse_ids: [22220, 22245]`).

### Q7. How well-organized, concise, and scholarly was the presentation of tool outputs?
- **Strengths:** Structured JSON with `tokens`, `lemma`, `lemma_key`, `strongs`, `xrefs`, `book_distribution`, and `evidence` view makes machine verification rigorous; `expected_params` on `invalid_request` (e.g., Call 8 `occurrences`) allowed immediate self-correction; batching 8 operations in `research` kept round-trips economical.
- **Weaknesses:** Full-chapter `get_Passage` payloads with `depth: 5` and `research` results with `detail: "full"` are massive (`71–295 KB` wire bytes) and slow (`48–93s` for `get_Passage`/`get_Connection`), largely because every verse token and long unpaginated `xrefs` arrays are duplicated inline. In `lit_hos1` / `lit_hos2`, helpful insights (`key_words`, `wordplays`, `lxx_comparison`) are buried inside thousands of lines of `word_ids` arrays.

### Q8. What additional capability or improvement would most help this kind of biblical research?
1. **Stateless / persisted `chain` state (or single-call multi-hop expansion) for `follow_connectionchain`:** Persist chain tokens across CLI invocations (or embed the chain state in a compact signed token) so multi-hop traversal works in stateless benchmark/CLI environments.
2. **Composite-quotation mode in `tri_textual_diff`:** Allow splitting or matching a NT quotation against *multiple* source verses within the same OT book (e.g., Hos 2:23 + Hos 1:10 for Rom 9:25–26, and Hos 1:6/9 + 2:1/23 for 1 Pet 2:10), penalizing single-token lexical hits from unrelated Torah/Prophetic passages (`Deut 30:16`, `Lev 19:18`, `Dan 3:29`) when a clear primary source book is already established.
3. **MT↔LXX versification-aware `lxx` lookup and compound-name alignment:** Automatically resolve MT↔LXX chapter/verse offsets (e.g., Num 13:16, Hosea 2:1–25) and improve multi-word Hebrew proper-noun alignment (`H3819`, `H3818`) so `lxx_concordance` never maps `לֹא רֻחָמָה` to `ἔτι`.
4. **Compact / selective hydration (`fields` projection) and verse-endpoint support in `trace_evidence`:** Let `get_Passage` and `occurrences` omit per-token/xref bloat when only `text + lxx + key_lexicon` are needed, and let `trace_evidence` accept verse references (`Hosea 2:15` → `Joshua 7:26`) directly without `ctrl:missing_concepts`.
