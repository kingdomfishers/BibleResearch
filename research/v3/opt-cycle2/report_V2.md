# Research Report V2: Lexical Wordplay, Evaluative Valence Shifts, Name/Status Reversals, and LXX Semantic Backgrounds in Philemon 1:8–21, Genesis 27:30–40, and Isaiah 62:1–5

## 1. Investigation Scope & MCP Call Ledger

All textual data, lexical entries, wordplay detections, structural patterns, and LXX alignments below were obtained exclusively through 17 logged calls to the local BibleResearch MCP server (`scripts/mcp-bench-cli.mjs --target local --no-supabase --log research/v3/opt-cycle2/local_V2.jsonl`), following an initial schema inspection (`tools/list`: 1,780 ms, 17,028 wire bytes, 32,507 payload bytes).

| # | Tool | Target / Operation Summary | Latency (ms) | Wire Bytes | Payload Bytes |
|---:|---|---|---:|---:|---:|
| 1 | `get_prompt` | Guidelines retrieval (`v2.0.0`) | 1,477 | 5,530 | 5,338 |
| 2 | `get_Passage` | `Philemon 1:8-21` (`view="clues"`, `depth=5`, `literary=1`) | 10,154 | 8,922 | 7,796 |
| 3 | `get_Passage` | `Genesis 27:30-40` (`view="clues"`, `depth=5`, `literary=1`) | 12,177 | 9,283 | 8,151 |
| 4 | `get_Passage` | `Isaiah 62:1-5` (`view="clues"`, `depth=5`, `literary=1`) | 9,827 | 7,598 | 6,654 |
| 5 | `get_Connection` | `["Philemon 1:8-21","Genesis 27:30-40","Isaiah 62:1-5"]` (`connections=15`) | 20,718 | 2,993 | 2,551 |
| 6 | `research` | `wordplay_scan` (×3) + `sequence_parallels` (×3 pairs) | 3,907 | 20,987 | 18,381 |
| 7 | `research` | `literary_structure` (×3, `detail="deep"`, `compare_lxx=true`) | 3,097 | 197,825 | 175,333 |
| 8 | `research` | `lxx` (Gen 27:30-40, Isa 62:1-5) + `lxx_concordance` (`G0890,G2173,G3685,H6117,H1166,H5800`) | 11,253 | 92,573 | 80,377 |
| 9 | `get_Passage` | `Philemon 1:8-21` (`view="evidence"`, `depth=0`, `literary=0`) | 6,125 | 46,908 | 40,138 |
| 10 | `get_Word` | `G0890` (`ἄχρηστος`, `view="clues"`, `etymology=3`) | 2,155 | 3,831 | 3,329 |
| 11 | `get_Word` | `G2173` (`εὔχρηστος`, `view="evidence"`, `etymology=3`) | 2,309 | 14,714 | 13,294 |
| 12 | `research` | `lxx_concordance` (`H1293,H1062,H4820,H5647,H5923,H2654,H8077,G4698`) | 3,360 | 45,167 | 38,757 |
| 13 | `get_Word` | `G3682` (`Ὀνήσιμος`, `view="evidence"`, `etymology=3`) | 2,202 | 14,312 | 12,870 |
| 14 | `get_Word` | `H2657` (`חֶפְצִי־בָהּ`, `view="evidence"`, `etymology=3`) | 1,573 | 15,254 | 13,756 |
| 15 | `research` | `expand_clue` (×4) + `tri_textual_diff` (Isa 62:4, Gen 27:36) + `clause_role_query` (`H2654/H3068`) | 8,142 | 57,644 | 50,630 |
| 16 | `follow_connectionchain` | Seed `Philemon 1:11` (`limit=8`) | 6,798 | 6,492 | 5,788 |
| 17 | `research` | `passage_compare` (Phlm 1:11/Lk 17:10) + `lxx` (Ps 14:3) + `lxx_concordance` (`H5162,H6664`) + `set_combine` (×2) | 9,784 | 48,739 | 42,969 |
| **Total** | **17 calls** | **All 6 read tools + 10 `research` ops** | **115,058 ms** | **598,772** | **526,099** |

---

## 2. Attested Textual & Lexical Evidence by Passage

### 2.1 Philemon 1:8–21 (NA28 Greek)

1. **Onomastic & Valence Wordplay Cluster (`wordplay_scan` + `get_Word`):**
   - **`Ὀνήσιμος` (`G3682`, Phlm 1:10, pos 12: `Ὀνήσιμον`)**: Documented root family (`STEPBible / GreekLexicon`) shares root with **`ὄνησις` (`G8518`, "profitable")**. Syntactically in Phlm 1:10, `Ὀνήσιμον` is the grammatical object of `ἐγέννησα` (`G1080`, "whom I begot in my chains"). Only 2 NT occurrences exist (`Philemon 1:10` and `Colossians 4:9`, where he is titled `πιστῷ καὶ ἀγαπητῷ ἀδελφῷ`).
   - **Antonymous / Synonymous Evaluative Contrast (Phlm 1:11):**
     - `τόν ποτέ σοι ἄχρηστον` (`G0890` `ἄχρηστος`, "useless" — **NT hapax**, `total_verses: 1`, `onomastic_valence` score `0.908`, channel `etymological_synonym_antonym`)
     - `νυνὶ δὲ καὶ σοὶ καὶ ἐμοὶ εὔχρηστον` (`G2173` `εὔχρηστος`, "useful/helpful" — occurs 3× in NT: `Phlm 1:11`, `2 Tim 2:21` modifying `σκεῦος` "vessel", and `2 Tim 4:11` of Mark; `onomastic_valence` score `0.868`).
     - Consonantal stem overlap (`wordplay_scan`): `ἄχρηστον` vs `εὔχρηστον` share `χρηστ` (formal score `0.742`; `r13:wp:G0890:G2173`, `e_perp: 38.68 bits`, `p_null: 2.27e-12`). Note that `get_Word` reports `etymology: unavailable` for `G0890` and `G2173` in the lexicon table, while `wordplay_scan` flags the `ποτέ ... νυνὶ δὲ` temporal-evaluative reversal directly tied to `Ὀνήσιμος`.
   - **Echoic / Root Return (Phlm 1:20):**
     - `ναί, ἀδελφέ, ἐγώ σου ὀναίμην ἐν Κυρίῳ` — `ὀναίμην` (`G3685` `ὀνίνημι`, "may I have profit/joy", **NT hapax**) matches the root of `Ὀνήσιμος` (`onomastic_valence` score `0.850`, channel `etymological_root`), paired with same-verse consonantal overlap `ναί` (`G3483`) ↔ `ὀναίμην` (`ναι`, formal score `0.627`).
   - **Surrounding Epistolary Paronomasia (`wordplay_scan`, `consonantal_candidates`):**
     - Phlm 1:8–9: `παρρησίαν` (`G3954`, "boldness") ↔ `παρακαλῶ` (`G3870`, "I appeal/exhort") — attested wordplay (`r13:wp:G3870:G3954`, `e_perp: 14.47 bits`, `p_null: 4.41e-5`, shared `παρ`).
     - Phlm 1:9–10: `δέσμιος` (`G1198`, "prisoner") ↔ `δεσμοῖς` (`G1199`, "chains") — exact root/consonantal match (`δεσμ`, score `1.0`).
     - Phlm 1:16: `μάλιστα` (`G3122`) ↔ `μᾶλλον` (`G3123`) (`μαλ`, score `0.667`).
     - Phlm 1:17–19: `ἔχεις` (`G2192`) ↔ `χειρί` (`G5495`) (`χει`, score `0.707`).
     - Phlm 1:18–19: `ὀφείλει` (`G3784`, "owes") ↔ `προσοφείλεις` (`G4359`, "you owe besides") (`οφειλ`, score `0.640`) — an explicit status/debt reversal ("if he owes you anything... you owe me your very self").
     - Phlm 1:19–20: `Παῦλος` (`G3972`) ↔ `ἀνάπαυσόν` (`G0373`, "refresh") (`παυ`, score `0.627`).
     - Phlm 1:21: `Πεποιθὼς` (`G3982`) ↔ `ποιήσεις` (`G4160`) (`ποι`, score `0.649`).
2. **Status Reversal (`set_combine` + `get_Passage`):**
   - Phlm 1:16: `οὐκέτι ὡς δοῦλον, ἀλλ’ ὑπὲρ δοῦλον, ἀδελφὸν ἀγαπητόν` ("no longer as a slave [`G1401`], but more than a slave, a beloved [`G0027`] brother [`G0080`]").
   - Corpus-wide `set_combine` intersection of `G0080` (`ἀδελφός`) + `G1401` (`δοῦλος`) yields **only 2 verses in the entire Bible**: `Philemon 1:16` and `Jude 1:1` (`δοῦλος ... ἀδελφὸς δὲ Ἰακώβου`).

### 2.2 Genesis 27:30–40 (MT Hebrew & Swete LXX)

1. **Onomastic Paronomasia & Evaluative Valence (`wordplay_scan`):**
   - **Gen 27:36 (Name/Action Pun):** `הֲכִי קָרָא שְׁמוֹ יַעֲקֹב וַיַּעְקְבֵנִי זֶה פַעֲמַיִם` — `יַעֲקֹב` (`H3290`, Jacob) ↔ `וַיַּעְקְבֵנִי` (`H6117` `עָקַב`, "he has supplanted me", `prefix_suffix_overlap` `יעקב`, formal score `0.880`).
   - **Gen 27:35–36 (Sound/Metathesis Chain):**
     - `בְּמִרְמָה` (`H4820`, "with deceit", v. 35) frames the moral re-evaluation of Jacob's act.
     - `בִּרְכָתֶךָ` / `בִּרְכָתִי` (`H1293`, "blessing", vv. 35–36) ↔ `בְּכֹרָתִי` (`H1062`, "my birthright", v. 36) — consonantal **metathesis** (`ב-ר-כ` vs `ב-כ-ר`, formal score `0.660`), spotlighting Esau's double loss.
   - **Syntactic Talion (`wordplay_scan`):**
     - Gen 27:30: `יָצֹא יָצָא` (`H3318`, infinitive absolute + perfect, `shift: a->p`, score `0.860`) — sharp narrative pivot as Jacob exits and Esau enters.
     - Gen 27:33: `וָאֲבָרֲכֵהוּ ... בָּרוּךְ` (`H1288`, wayyiqtol 1cs → passive participle `בָּרוּךְ`, `shift: w->s`, score `0.860`) — irreversible performative blessing ("I blessed him — yes, blessed he shall be!").
   - **Evaluative Valence Contrast (Gen 27:34):** `גְּדֹלָה` (`H1419`, "great") paired with `וּמָרָה` (`H4751`, "and bitter") describing Esau's `צְעָקָה` ("cry", score `0.860`).
   - **Status Reversal & Yoke/Neck Echo (Gen 27:37, 39–40):**
     - Gen 27:37: `גְּבִיר` (`H1376`, "lord/master") over `כָּל־אֶחָיו ... לַעֲבָדִים` ("all his brothers [`H0251`] ... as servants [`H5650`]"), using parallel verbs `שַׂמְתִּיו` (`H7760`) / `סְמַכְתִּיו` (`H5564`, score `0.729`).
     - Gen 27:39–40: `מֵעָל` (`H5921`, "from above", v. 39) ↔ `עֻלּוֹ` (`H5923`, "his yoke", v. 40, shared `על`, score `0.697`), followed by conditional future reversal: `וְאֶת־אָחִיךָ תַּעֲבֹד ... וּפָרַקְתָּ עֻלּוֹ מֵעַל צַוָּארֶךָ` ("you shall serve [`H5647`] your brother ... you shall tear off his yoke from your neck").

### 2.3 Isaiah 62:1–5 (MT Hebrew & Swete LXX)

1. **Syntactic Talion & Voice Inversion (`wordplay_scan`):**
   - **Isa 62:4:** `בְּעוּלָה` (`H1166`, Qal passive participle, "married") ↔ `תִּבָּעֵל` (`H1166`, Niphal imperfect 3fs, "will be married") — flagged as `syntactic_talion` with `voice_inversion` and `tense_aspect_shift` (`shift: active->passive, s->i`, score `0.920`), moving from nominal state ("called Married") to ongoing passive reality ("your land will be married").
2. **Name/Status Reversal (`get_Word` `H2657` + `wordplay_scan`):**
   - **Isa 62:2:** Promise of a `שֵׁם חָדָשׁ` ("new name", `H8034` + `H2319`), linking root `חדש` to `Isa 61:4` (`וְחִדְּשׁוּ`, `H2318`, score `0.860`).
   - **Isa 62:4 Dual Name Antithesis:**
     - `לֹא־יֵאָמֵר לָךְ עוֹד עֲזוּבָה` (`H5800` `עָזַב`, "Forsaken") → `כִּי לָךְ יִקָּרֵא חֶפְצִי־בָהּ` (`H2657` `חֶפְצִי־בָהּ`, "Hephzibah / My Delight Is in Her"), immediately grounded by `כִּי־חָפֵץ יְהוָה בָּךְ` (`H2654`, shared exact consonants `חפצ`, score `1.0`).
     - `וּלְאַרְצֵךְ לֹא־יֵאָמֵר עוֹד שְׁמָמָה` (`H8077`, "Desolate/Devastation") → `וּלְאַרְצֵךְ בְּעוּלָה` ("Beulah / Married").
   - **Historical Background of `חֶפְצִי־בָהּ` (`H2657`, `get_Word`):** Occurs in **only 2 verses** in the Bible: `2 Kings 21:1` (the personal name of King Manasseh's mother) and `Isaiah 62:4` (Zion's eschatological title). `clause_role_query` (`H2654` with `H3068` as subject) shows `YHWH` as subject of `חָפֵץ` in 11 clauses (sampled: `Num 14:8`, `1 Kgs 10:9`, `Ps 135:6`, `Isa 42:21`, `Isa 62:4`).
   - **Isa 62:5 Consonantal & Joy Paronomasia:** `בְּעוּלָה` (`H1166`) echoes `בָּחוּר` (`H0970`, score `0.604`) and `בְּתוּלָה` (`H1330`, `ולה`, score `0.747`), culminating in `וּמְשׂוֹשׂ` (`H4885`) ↔ `יָשִׂישׂ` (`H7797`, "rejoicing/rejoice", score `0.600`).

---

## 3. LXX Semantic Backgrounds & Translation Shifts

### 3.1 Genesis 27:30–40 LXX: Loss of Phonetic Wordplay, Gain of Semantic/Social Precision
- **Gen 27:36 (`יַעֲקֹב` / `עָקַב` → `Ἰακώβ` / `πτερνίζω`):**
  - Swete LXX: `καὶ εἶπεν Δικαίως ἐκλήθη τὸ ὄνομα αὐτοῦ Ἰακώβ· ἐπτέρνικεν γάρ με ἤδη δεύτερον τοῦτο`.
  - `lxx_concordance` (`H6117`): Rahlfs aligns `עָקַב` to `πτερνίζω` 3× (`Gen 27:36`, `Hos 12:4`, `Jer 9:3`, `mean_stability: 0.940`; plus `Mal 3:8-9` `πτέρνη`/`πτερνίζω`). Because `Ἰακώβ` is transliterated, Greek loses the Hebrew consonantal pun `yʿqb` and replaces it with an explicit semantic gloss (`πτερνίζω`, "trip by the heel") plus `Δικαίως` ("rightly/justly").
- **Gen 27:35–36 (`מִרְמָה` / `בְּרָכָה` / `בְּכֹרָה`):**
  - `בְּמִרְמָה` (`H4820`) → `μετὰ δόλου` (`δόλος`, 22× in Rahlfs, stability `0.974`).
  - `בְּרָכָה` (`H1293`) → `εὐλογία` (60× in Rahlfs, stability `0.972`); `בְּכֹרָה` (`H1062`) → `πρωτοτόκιον` (7×, stability `0.959`). Thus the Hebrew metathesis `בְּכֹרָתִי / בִּרְכָתִי` becomes an unrelated lexical pair in Greek (`πρωτοτοκεῖα / εὐλογία`).
- **Gen 27:37, 40 (`גְּבִיר` / `עֶבֶד` / `עָבַד` / `עֹל`):**
  - `גְּבִיר` (`H1376`) → `κύριον` (`κύριος`); `לַעֲבָדִים` (`H5650`) → `οἰκέτας` (`οἰκέτης`, household servants), while `תַּעֲבֹד` (`H5647`, v. 40) → `δουλεύσεις` (`δουλεύω`, 117× in Rahlfs, stability `0.975`; `δοῦλος` appears 9× for `H5647`).
  - `עֻלּוֹ` (`H5923`, v. 40) → `τὸν ζυγὸν αὐτοῦ` (`ζυγόν` noted as a `lexical_theological_shift` in `lxx_concordance` vs standard `ζυγός` 24×).
- **Gen 27:42 (`נָחַם` `H5162`):** Although outside v. 40, `expand_clue` + `lxx_concordance` (`H5162`) show `נָחַם` is usually `παρακαλέω` (62× in LXX—the exact verb Paul uses in Phlm 1:9–10!), whereas in Gen 27:42 `מִתְנַחֵם` ("consoling himself by killing") shifts to `ἀπειλεῖ` ("threatens").

### 3.2 Isaiah 62:1–5 LXX: Semantic Translation of Symbolic Names & Theological Shifts
- **Isa 62:1 Pronoun Shift (`צִדְקָהּ` / `יְשׁוּעָתָהּ` → `δικαιοσύνη μου` / `σωτήριόν μου`):**
  - `lxx_concordance` (`H6664`) flags `Isa 62:1` as a `pronoun_person_shift`: MT 3fs ("her righteousness / her salvation") becomes LXX 1cs ("my righteousness / my salvation", spoken by the Lord/speaker). Note also Swete LXX reads `καὶ διὰ Ἰερουσαλὴμ ἀνήσω` (without negative particle before `ἀνήσω`).
- **Isa 62:2:** `שֵׁם חָדָשׁ` → `τὸ ὄνομά σου τὸ καινὸν ὃ ὁ κύριος ὀνομάσει αὐτό`.
- **Isa 62:4 Semantic Rendering of Status Names (vs. 2 Kgs 21:1 Transliteration):**
  - MT: `עֲזוּבָה` / `שְׁמָמָה` → `חֶפְצִי־בָהּ` / `בְּעוּלָה` (+ `כִּי־חָפֵץ יְהוָה בָּךְ וְאַרְצֵךְ תִּבָּעֵל`).
  - Swete LXX: `Καταλελιμμένη` / `Ἔρημος` → `Θέλημα ἐμόν` ("My Will/Delight") / `Οἰκουμένη` ("Inhabited").
  - Contrast with `2 Kings 21:1`, where `get_Word` (`H2657`) documents the LXX axis `LXX:Οψιβα` (transliterating the queen mother's personal name). In Isa 62:4, the LXX translates the evaluative meaning rather than transliterating, AND omits/condenses MT's concluding `כִּי־חָפֵץ יְהוָה בָּךְ וְאַרְצֵךְ תִּבָּעֵל` clause (23 MT tokens vs 21 Swete words). Meanwhile `lxx_concordance` (`H5800` `עָזַב` → `ἐγκαταλείπω` 138×, `καταλείπω` 49×; `H8077` `שְׁמָמָה` → `ἀφανισμός` 22×, `ἔρημος` 15×; `H2654` `חָפֵץ` → `θέλω` 38×, `βούλομαι` 21×, `θέλημα` 1× in Jer 9:24) confirms that `Θέλημα ἐμόν` draws on `θέλω`/`θέλημα` equivalents for `חפץ`.
- **Isa 62:5 Lexical-Theological Shift on `בָּעַל` (`H1166`):**
  - MT repeats `H1166` (`יִבְעַל` ... `יִבְעָלוּךְ בָּנָיִךְ`, "marry ... your sons will marry you").
  - Swete LXX splits the single Hebrew verb into two distinct Greek verbs: `συνοικῶν νεανίσκος παρθένῳ` ("a young man cohabiting with a virgin", matching `H1166` → `συνοικέω` 3× in Rahlfs) → `οὕτως κατοικήσουσιν οἱ υἱοί σου μετὰ σοῦ` ("so your sons will dwell with you", `κατοικέω` 2× in Rahlfs, smoothing the marital metaphor when applied to `υἱοί`).

### 3.3 Philemon 1:8–21 & LXX Vocabulary Coverage
- Notice an important empirical finding from `lxx_concordance` (Calls 8, 12): `G0890` (`ἄχρηστος`), `G2173` (`εὔχρηστος`), `G3685` (`ὀνίνημι`), and `G4698` (`σπλάγχνον`) returned `lxx_equivalents: []` in the Rahlfs MT↔LXX concordance index (either absent from canonical MT-aligned LXX verses or unindexed in the reverse `G->H` direction).
- By contrast, `get_Passage(view="evidence")` on Philemon 1:8–21 did surface LXX Hebrew backgrounds for other key terms in the pericope:
  - `G3870` (`παρακαλῶ`, vv. 9–10) ↔ `H5162` (`נָחַם`, 30× in `get_Passage`; 62× in `lxx_concordance`).
  - `G0661` (`ἀποτίσω`, v. 19) ↔ `H7999` (`שָׁלֵם`, "repay/complete", 23×).
  - `G0373` (`ἀνάπαυσόν`, v. 20) ↔ `H5117` (`נוּחַ`, 19×) / `H8252` (`שָׁקַט`, 3× — note `H8252` also occurs in `Isa 62:1`!).
  - `G5547` (`Χριστός`, vv. 8, 9, 20) ↔ `H4899` (`מָשִׁיחַ`, 24×).
- Additionally, `follow_connectionchain` (`Philemon 1:11`) and `passage_compare` (`Philemon 1:11` vs `Luke 17:10`) surfaced NT/LXX lexical neighbors for `useless` (`G0890` `ἄχρηστος`): `Luke 17:10` (`Δοῦλοι ἀχρεῖοί ἐσμεν`, `G0888`) and `Romans 3:12` (quoting LXX Ps 13:3 `ἠχρεώθησαν`, though `lxx` on `Psalms 14:3` returned LXX `Psalmi 13:4` due to Psalm versification offset).

---

## 4. Cross-Passage Synthesis & Negative Controls

### 4.1 What the Graph & Sequence Tools Actually Connect (vs. Negative Controls)
- **`get_Connection` across all 3 passages:** Returned `all_endpoints_connected: false` (`partial_components`). It verified **1** LXX lexical bridge connecting `Philemon 1:8-21` ↔ `Genesis 27:30-40` (`passage_lxx:G0080:H0251`, `ἀδελφός` ↔ `אָח`, "brother"), and **0** verified `<=3-hop` edges reaching `Isaiah 62:1-5`.
- **`sequence_parallels` (Statistical Negative Control):**
  - `Philemon 1:8-21` vs `Genesis 27:30-40`: `raw_score: 4.26`, `p_null: 0.6154`, `evidence_bits: 0` (`mirror_inversion` blocks are **not** statistically significant against null permutation).
  - `Philemon 1:8-21` vs `Isaiah 62:1-5`: `raw_score: 0`, `p_null: 1`, `evidence_bits: 0`.
  - `Genesis 27:30-40` vs `Isaiah 62:1-5`: `raw_score: 1.75`, `p_null: 0.2462`, `evidence_bits: 0` (`antithetical_decreation` blocks are **not** statistically significant).
- **`tri_textual_diff`:** Returned `status: "no_alignment"` for both `Isaiah 62:4` and `Genesis 27:36` (no NT composite splice detected), while listing relevant intrabiblical candidate sources (`Isa 54:1`, `2 Kgs 21:1`, `Gen 25:26`, `Gen 32:28`).

**Methodological Conclusion:** There is **no** direct quotation, composite splice, or statistically significant clause-sequence alignment linking Philemon 1:8–21, Genesis 27:30–40, and Isaiah 62:1–5. Their convergence is **thematic, rhetorical, and typological-comparative**, rather than a single textual dependency chain.

### 4.2 Comparative Matrix: Name/Status Reversals & Valence Shifts

| Dimension | Philemon 1:8–21 | Genesis 27:30–40 | Isaiah 62:1–5 |
|---|---|---|---|
| **Proper Name / Title** | `Ὀνήσιμος` (`G3682`, "Profitable") | `יַעֲקֹב` (`H3290`, "Heel-grasper / Supplanter") | `עֲזוּבָה` / `שְׁמָמָה` → `חֶפְצִי־בָהּ` / `בְּעוּלָה` |
| **Lexical Wordplay Mechanism** | Root pun (`Ὀνήσιμος` ↔ `ὀναίμην` v. 20) + prefix-antonym valence pun (`ἄχρηστος` ↔ `εὔχρηστος` v. 11) | Etymological-narrative pun (`יַעֲקֹב` ↔ `וַיַּעְקְבֵנִי` v. 36) + metathesis (`בְּכֹרָה` ↔ `בִּרְכָה` vv. 35–36) | Name-grounding repetition (`חֶפְצִי־בָהּ` ↔ `חָפֵץ` v. 4) + syntactic talion (`בְּעוּלָה` ↔ `תִּבָּעֵל` v. 4) |
| **Evaluative Valence Shift** | `ποτέ ἄχρηστον` (negative) → `νυνὶ εὔχρηστον` (positive, v. 11) | Ambiguous/negative `בְּמִרְמָה` ("with deceit", v. 35) yet irreversible `וָאֲבָרֲכֵהוּ ... בָּרוּךְ` (v. 33) | Negative public labels (`Forsaken`, `Desolate`) negated (`לֹא־יֵאָמֵר עוֹד`) → positive divine delight (`Hephzibah`, `Beulah`) |
| **Relational / Status Reversal** | `δοῦλος` → `ὑπὲρ δοῦλον, ἀδελφὸν ἀγαπητόν` (v. 16); Paul's debt inversion (`ὀφείλει` vs `προσοφείλεις`, vv. 18–19) | Elder (`בְּכֹר`) subordinated (`גְּבִיר` over `אֶחָיו לַעֲבָדִים`, v. 37), with future conditional release (`פָרַקְתָּ עֻלּוֹ`, v. 40) | Abandoned/desolate city & land elevated to royal `στέφανος`/`διάδημα` (v. 3) and bride (`κάλλος`/joy, v. 5) |
| **LXX Semantic Effect** | `ἄχρηστος`/`εὔχρηστος`/`ὀνίνημι` unattested in MT↔LXX canonical concordance; `παρακαλῶ` (`H5162`) & `ἀνάπαυσον` (`H5117`/`H8252`) carry LXX resonance | Loses Hebrew phonetic pun (`Ἰακώβ` / `ἐπτέρνικεν`) & `בכרה/ברכה` metathesis; shifts social titles (`גְּבִיר`→`κύριος`, `עֲבָדִים`→`οἰκέται`, `עָבַד`→`δουλεύω`) | Translates symbolic names semantically (`Θέλημα ἐμόν`, `Οἰκουμένη`); shifts v. 1 pronouns (`her`→`μου`) and splits `בָּעַל` in v. 5 (`συνοικέω`→`κατοικέω`) |

### 4.3 Interpretive Hypotheses (Clearly Distinguished from Attested Evidence)
1. **Triadic Status-Language Contrast (Hypothesis):** While Gen 27:37, 40 uses `אָח`/`ἀδελφός` and `עָבַד`/`עֶבֶד` (`δουλεύω` / `οἰκέτης`) in a *zero-sum* patriarchal hierarchy (one brother becomes `κύριος` while brothers become `οἰκέται`, until the yoke is violently broken), Philemon 1:16–19 restructures the same `δοῦλος`/`ἀδελφός` polarity *non-violently* in Christ (`οὐκέτι ὡς δοῦλον ... ἀδελφὸν ἀγαπητόν`), and Isa 62:2–4 models divine renaming that overrides prior degraded status (`לֹא־יֵאָמֵר ... עֲזוּבָה` // `οὐκέτι ... δοῦλον`).
2. **Phonetic `χρηστός` / `Χριστός` Resonance in Philemon (Hypothesis):** Because `Χριστός` (`G5547`) frames Phlm 1:8, 9, 20 and `ἄχρηστος` / `εὔχρηστος` share the `χρηστ-` stem in v. 11 (identical or near-identical to `χρηστός` / itacistic `Χριστός` in Koine pronunciation), Paul's `ἄχρηστος → εὔχρηστος` shift may carry secondary Christological resonance alongside the primary `Ὀνήσιμος` pun; however, this remains an interpretive/phonetic hypothesis not directly attested by a lexical root link in the corpus.

---

## 5. Honest 8-Question System Evaluation

### Q1. Tool Discovery & Guidelines (`get_prompt` & Schema Clarity)
**Rating: Strong (4.5/5).** Calling `get_prompt` and `--list-tools` immediately clarified the 7-tool architecture, progressive detail ladder (`clues` → `evidence` → `deep`), negative-control humility (`p_null`, epistemic separation), and all 26 `research` operations. Minor friction: `research` packs 26 operations into one flat `properties` schema where operation-specific required/optional parameter pairings (e.g., `tri_textual_diff` vs `lxx_concordance` vs `clause_role_query`) are only hinted at in the tool description rather than discriminated per `op` via `oneOf`/`anyOf`.

### Q2. Progressive Disclosure & Payload Efficiency (`clues` vs `evidence` vs `deep`)
**Rating: Good with one severe bloat outlier (3.5/5).** Default `view="clues"` kept `get_Passage` (`7.6–9.3 KB` wire), `get_Word` (`3.8 KB`), `get_Connection` (`3.0 KB`), and `follow_connectionchain` (`6.5 KB`) crisp and readable. Hydrating `get_Passage` (`view="evidence"`) and `get_Word` (`view="evidence"`) grew predictably to `46.9 KB` and `14.3–15.3 KB`. **Critical flaw:** `research` `op: "literary_structure"` with `detail: "deep"` across 3 passages exploded to **197,825 wire bytes (175,333 payload bytes)**—mostly verbose per-token `word_ids` arrays (`grc_nt:30046:9`, etc.)—which forced heavy file truncation in CLI logs.

### Q3. Latency & Execution Reliability
**Rating: Reliable, moderate-to-slow on multi-anchor graph calls (4/5).** Zero tool errors across all 17 calls (`is_error: false` 17/17). Single-word `get_Word` calls were fast (`1.57–2.31 s`), and `wordplay_scan` + `sequence_parallels` (6 ops) finished in `3.91 s`. However, `get_Passage` clues took `9.8–12.2 s` per call, `research` `lxx` + `lxx_concordance` took `11.25 s`, and `get_Connection` across 3 passages took **20.72 s** despite returning only 1 edge and a `2,993`-byte payload.

### Q4. Cross-Passage & Multi-Hop Discovery (`get_Connection`, `follow_connectionchain`, `sequence_parallels`)
**Rating: Honest but limited on thematic/OT-NT triads (3.5/5).** `get_Connection` found the direct `ἀδελφός ↔ אָח` LXX bridge between Philemon and Genesis 27 (`1` edge) and honestly reported `partial_components` because no `<=3-hop` edge reached Isaiah 62. `follow_connectionchain` smoothly seeded `Philemon 1:11` and surfaced `Luke 17:10`, `Romans 3:12`, `2 Timothy 2:21 / 4:11`, `Job 30:1-2`, and `Jeremiah 13:7`. However, `get_Connection` did not bridge shared *conceptual/motif* axes (e.g., `name-change / status-reversal` or `servant/master` across `H5647/G1401`) to Isaiah 62, leaving thematic synthesis to manual multi-tool orchestration.

### Q5. Wordplay, Onomastics & Evaluative Valence Detection (`wordplay_scan`, `literary_structure`)
**Rating: Standout strength (4.5/5).** `wordplay_scan` nailed nearly every major scholarly feature across all three passages in `3.9 s`:
- Philemon 1:10–11, 20: `Ὀνήσιμον` ↔ `ἄχρηστον` (`0.908`), `εὔχρηστον` (`0.868`), `ὀναίμην` (`0.850`), plus `παρρησίαν`/`παρακαλῶ`, `δέσμιος`/`δεσμοῖς`, `ὀφείλει`/`προσοφείλεις`, `Παῦλος`/`ἀνάπαυσόν`.
- Genesis 27:30–40: `יַעֲקֹב`/`וַיַּעְקְבֵנִי` (`0.880`), `בִּרְכָתֶךָ`/`בְּכֹרָתִי` metathesis (`0.660`), `יָצֹא יָצָא` and `וָאֲבָרֲכֵהוּ/בָּרוּךְ` `syntactic_talion` (`0.860`), `גְּדֹלָה/וּמָרָה` valence contrast (`0.860`).
- Isaiah 62:1–5: `בְּעוּלָה/תִּבָּעֵל` voice-inversion `syntactic_talion` (`0.920`), `חֶפְצִי/חָפֵץ` (`1.0`), `חָדָשׁ/וְחִדְּשׁוּ` (`0.860`).
Minor oddity: `גְּדֹלָה` vs `וּמָרָה` (Gen 27:34) was filed under `onomastic_valence` (`cues: ["onomastic_etymology", "evaluative_valence_contrast"]`) even though neither word is a proper name; and `חָדָשׁ` (Isa 62:2) was filed under `onomastic_valence` (`proper_form`) instead of `חֶפְצִי־בָהּ` ↔ `עֲזוּבָה` (which is an antithetical proper-name reversal!).

### Q6. LXX Semantic Background & Cross-Language Alignment (`lxx`, `lxx_concordance`, `tri_textual_diff`)
**Rating: Very valuable for Hebrew→Greek, incomplete for Greek→Hebrew and Psalm versification (3.5/5).**
- **Strengths:** `lxx` passage comparisons exposed the exact Swete Greek texts for Gen 27:30–40 and Isa 62:1–5 (including the `Θέλημα ἐμόν` / `Οἰκουμένη` semantic name translations in Isa 62:4 and the `συνοικέω` → `κατοικέω` split in Isa 62:5). `lxx_concordance` for `H...` lemmas (`H6117, H1166, H5800, H1293, H1062, H4820, H5647, H5923, H2654, H8077, H5162, H6664`) richly surfaced `lxx_equivalents`, `mean_stability`, and `lexical_theological_shift` / `pronoun_person_shift` examples (including `Isa 62:1` 3fs→1cs and `Gen 27:42` `H5162`→`ἀπειλέω`).
- **Gaps / Bugs observed:**
  1. Calling `lxx_concordance` with Greek `G...` Strong's IDs (`G0890`, `G2173`, `G3685`, AND even `G4698` `σπλάγχνον` which occurs ~28× in the LXX!) returned **empty** `lxx_equivalents: []` and `lxx_shifts: []`, whereas `get_Passage(view="evidence")` *did* show `lxx` Hebrew mappings for several `G...` words.
  2. `lxx` on `Psalms 14:3` aligned to Swete **`Psalmi 13:4`** (`οὐχὶ γνώσονται...`) instead of `Psalmi 13:3` (`ἠχρεώθησαν...`), indicating a verse-offset mismatch in Psalm MT↔LXX alignment.
  3. Minor tokenization/OCR artifacts appear in the Swete LXX text (`Ἀωαστήτω` in Gen 27:31; `ν` before `εὐλογίαν` in Gen 27:36; `ἱστᾶι` and `ἐκλύσειςτὸν` in Gen 27:40; `μετὰ.` in Isa 62:5; `ὃ ὃ` in Isa 62:2).

### Q7. Epistemic Hygiene & Negative Controls
**Rating: Exemplary (5/5).** Every tool strictly separates `direct_textual_evidence`, `documented_lexical_relationship`, `documented_collocation_or_cooccurrence`, `editorial_cross_reference`, `orthographic_similarity_only`, and `shared_motif_evidence`. `wordplay_scan` carries explicit disclaimers against inferring historical etymology; `sequence_parallels` outputs calibrated `p_null` (`0.2462`, `0.6154`, `1.0`) preventing false structural claims; `get_Word` (`G0890`, `G2173`) reports `etymology: unavailable` rather than fabricating roots; `tri_textual_diff` reports `no_alignment` cleanly when no splice exists.

### Q8. Highest-Impact Improvements
1. **Enable reverse `G...` lookups in `lxx_concordance`** (especially for NT words with rich LXX backgrounds like `G4698` `σπλάγχνον` and `G0888`/`G0890`) and include deuterocanonical LXX hits (e.g., Wisdom/Sirach) cleanly tagged.
2. **Fix MT↔Swete Psalm versification mapping** (`Psalms 14:3` → `Psalmi 13:3`, not `13:4`) and clean Swete OCR/spacing artifacts (`Ἀωαστήτω`, `ὃ ὃ`, `ἐκλύσειςτὸν`).
3. **Trim `literary_structure` `detail="deep"` payload** (e.g., compact span ranges instead of repeating hundreds of individual `word_ids` unless explicitly requested) to prevent 198 KB payload spikes.
4. **Distinguish true proper-name valence reversals from general evaluative pairs in `wordplay_scan`** (e.g., detect `עֲזוּבָה`/`שְׁמָמָה` → `חֶפְצִי־בָהּ`/`בְּעוּלָה` as a name-antonym reversal in Isa 62:4, rather than placing `גְּדֹלָה/וּמָרָה` under `onomastic_valence`).
5. **Optimize `get_Connection` multi-passage latency** (20.7s for 3 passages) and optionally expose a `concept`/motif bridge mode so thematic triads like Philemon–Genesis–Isaiah can surface shared semantic axes even when no `<3`-hop lemma path exists.
