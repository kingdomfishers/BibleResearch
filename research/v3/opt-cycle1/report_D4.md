# Research Report D4: Prophetic Narrative Reversals and Cosmic Motifs
## Jonah 1–4, Psalm 107, and Matthew 12:38–42

**Research Question:** Analyze Jonah 1–4 (the deep, plant, worm, east wind, forty days, and compassion) alongside Psalm 107 and Matthew 12:38–42, surfacing recurring motifs, wordplay, contrasts, and intermediate bridges.

**Epistemic Method & Categories Used Throughout:**
1. **(a) Attested textual / original-language evidence:** Observed MT Hebrew, LXX Greek (Rahlfs 1935), and NT Greek forms, Strong's IDs, lemmas, alignment links, and exact corpus distribution counts returned by the tools.
2. **(b) Linguistic / grammatical relationships:** Documented syntax, voice/actant inversions, construct chains, root derivations, and LXX translation shifts (`p_g_given_h`, `g_idf`, `lxx_plus_expansion`, `mt_minus`, `pronoun_person_shift`).
3. **(c) Structural / rhetorical parallels:** Concentric frames, strophic sequences, talionic echoes, and narrative inversions across units.
4. **(d) Physical analogies:** Concrete cosmological, maritime, botanical, meteorological, and somatic imagery (abyssal descent, storm-tossed vessel, overnight gourd/worm, sirocco east wind, swallowing/regurgitation).
5. **(e) Interpretive hypotheses:** Theological, typological, or intertextual syntheses inferred from the verified textual data (explicitly marked as hypotheses).

---

## 1. Summary of Exact MCP Calls Made

One discovery call (`--list-tools`, unlogged) and 17 logged MCP calls (`research/v3/opt-cycle1/local_D4.jsonl`) were executed sequentially against `--target local --no-supabase`:

| # | Tool | Key Arguments | Latency (ms) | Wire (bytes) | Payload (bytes) | Status |
|---:|---|---|---:|---:|---:|---|
| 0 | `--list-tools` | *(unlogged schema discovery)* | 3,750 | 16,099 | 30,058 | `ok` |
| 1 | `get_prompt` | *(no args)* | 1,892 | 10,756 | 5,241 | `ok` |
| 2 | `get_Passage` | `{"passage":"Jonah 1:1-2:10","limit":30,"depth":3,"literary":1,"view":"evidence"}` | 76,952 | 163,605 | 142,818 | `ok` (27 vv.) |
| 3 | `get_Passage` | `{"passage":"Jonah 3:1-4:11","limit":30,"depth":3,"literary":1,"view":"evidence"}` | 94,810 | 142,179 | 123,988 | `ok` (21 vv.) |
| 4 | `get_Passage` | `{"passage":"Matthew 12:38-42","depth":5,"literary":1,"view":"evidence"}` | 81,133 | 64,859 | 56,646 | `ok` (5 vv.) |
| 5 | `get_Passage` | `{"passage":"Psalm 107:23-43","limit":25,"depth":3,"literary":1,"view":"evidence"}` | 42,909 | 101,024 | 88,506 | `ok` (21 vv.) |
| 6 | `get_Passage` | `{"passage":"Psalm 107:1-22","limit":25,"depth":3,"literary":1,"view":"evidence"}` | 49,391 | 96,956 | 85,024 | `ok` (22 vv.) |
| 7 | `get_Connection` | `{"items":["Jonah 1-4","Psalms 107","Matthew 12:38-42"],"connections":15,"view":"clues"}` | 64,776 | 5,026 | 4,362 | `ok` (5 clues) |
| 8 | `research` (batch 1) | 8 ops: `sequence_parallels` ×2 (err), `lxx_concordance` `Jonah 1-4` (`limit:30`), `tri_textual_diff` ×2 (err), `wordplay_scan` (err), `passage_compare` (`Jonah 2:1-10`, `Psalms 107:17-32`, `Matthew 12:39-41`), `trace_evidence` (err) | 22,437 | 110,851 | 94,523 | `ok` (3/8 ops ok; 5 rejected `"limit"`) |
| 9 | `research` (batch 2) | 8 ops: `sequence_parallels` ×3, `lxx_concordance` `Jonah 3-4` (`limit:30`), `lxx_concordance` `Psalms 107:23-32` (`limit:20`), `trace_evidence` ×2 (`Jonah 2:3`→`Psalms 107:24`; `Jonah 1:17`→`Matthew 12:40`), `clause_role_query` (`H4487`) | 159,243 | 226,238 | 197,372 | `ok` |
| 10 | `research` (batch 3) | 8 ops: `lxx_concordance` (`Jonah 4:3-11`, `Jonah 2`), `tri_textual_diff` (`Matthew 12:39-42`, `Jonah 3:1-5`), `wordplay_scan` (`Jonah 4`, `Psalms 107:23-43`), `intersect_words` (`["H7307","H6921"]`, `["H2587","H7349","H5162"]`), `view:"evidence"` | 13,574 | 144,973 | 122,711 | `ok` |
| 11 | `get_Word` | `{"word":"H7021","realworld":1,"etymology":3,"occurrences":10,"view":"evidence"}` | 1,369 | 205 | 92 | `error` (rejected `"occurrences"`) |
| 12 | `get_Word` | `{"word":"H7021","passage":"Jonah 4:6","connections":12,"etymology":5,"realworld":1,"view":"evidence"}` | 2,209 | 17,817 | 16,097 | `ok` |
| 13 | `get_Word` | `{"word":"H8367","connections":12,"etymology":5,"realworld":1,"view":"evidence"}` | 1,389 | 15,894 | 14,328 | `ok` |
| 14 | `follow_connectionchain` | `{"next":"Jonah 2:3","limit":8,"view":"clues"}` | 4,302 | 6,113 | 5,363 | `ok` (`step:0`) |
| 15 | `follow_connectionchain` | `{"chain":"ch_6970...","action":"follow","next_id":"v3:bmw:22800","limit":8,"view":"clues"}` | 1,246 | 204 | 81 | `error` (`chain_not_found`) |
| 16 | `research` (batch 4) | 8 ops: `occurrences` (`H8438`, `H2759`, `H1104`, `H1280`), `lxx_concordance` (`Psalms 107:17-22`, `Psalms 107:27-32`), `intersect_words` (`["H3381","H3220","H0591"]`, `["H2076","H8426"]`), `view:"evidence"` | 8,654 | 97,246 | 87,022 | `ok` |
| 17 | `research` (batch 5) | 5 ops: `lxx_concordance` (`Jonah 1:11-17`), `intersect_words` (`["H2587","H7349","H0750","H0639","H2617"]`, `["H4310","H3045","H7725","H5162"]`, `["H7592","H5315","H4191"]`), `occurrences` (`H4688`), `view:"evidence"` | 5,849 | 55,521 | 47,209 | `ok` |

---

## 2. Textually Verified Discoveries

### 2.1 Cosmic & Narrative Inventory Across Jonah 1–4, Psalm 107, and Matthew 12:38–42

#### A. The Deep, Storm, and Abyssal Descent (Jonah 1–2 ↔ Psalm 107 ↔ Matthew 12:40)

1. **(a) Attested lexical convergence between Jonah 1–2 and Psalm 107:**
   - **Going down to the sea in ships (`H3381` + `H3220` + `H0591`):** A corpus-wide `intersect_words` query (`["H3381","H3220","H0591"]`) shows that `יָרַד` ("go down") + `יָם` ("sea") + `אֳנִיָּה` ("ship") co-occur in **only 3 verses in the entire Hebrew Bible**: **Psalms 107:23** (`יוֹרְדֵ֣י הַ֭יָּם בָּאֳנִיּ֑וֹת`), **Jonah 1:5** (`בָּֽאֳנִיָּה֙ אֶל הַיָּ֔ם ... יָרַד֙`), and **Ezekiel 27:29** (`וְֽיָרְד֞וּ מֵאָנִיּֽוֹתֵיהֶ֗ם ... הַיָּ֑ם`). Jonah 1:3 further stacks `וַיֵּרֶד יָפוֹ` and `וַיֵּרֶד בָּהּ` (`H3381`), and Jonah 2:6 brings this downward trajectory to its cosmic floor: `לְקִצְבֵי הָרִים יָרַדְתִּי` (`H7095` + `H2022` + `H3381`).
   - **The Deep (`מְצוֹלָה` H4688 / `תְּהוֹם` H8415) & Cosmic Ocean:** `H4688` (`מְצוֹלָה`) occurs in only 11–12 OT verses (Jonah 2:3 `מְצוּלָה֙ בִּלְבַ֣ב יַמִּ֔ים`; Ps 107:24 `בִּמְצוּלָֽה`). Both passages pair it with `תְּהוֹם` (`H8415`, Jonah 2:5; Ps 107:26 `יֵרְד֣וּ תְהוֹמוֹת`), `מַיִם` (`H4325`, Jonah 2:5; Ps 107:23), `גַּל` (`H1530` billows/waves, Jonah 2:3; Ps 107:25, 29), and `סַעַר`/`סְעָרָה` (`H5591` storm/tempest, Jonah 1:4, 12; Ps 107:25 `ר֣וּחַ סְעָרָ֑ה`, 107:29 `סְעָרָה`).
   - **Calming of the sea (`שָׁתַק` H8367):** `get_Word` + `occurrences` confirm `H8367` appears in **only 4 verses in the Hebrew Bible**: **Jonah 1:11** (`וְיִשְׁתֹּ֥ק הַיָּ֖ם`), **Jonah 1:12** (`וְיִשְׁתֹּ֥ק הַיָּ֖ם`), **Psalms 107:30** (`וַיִּשְׂמְח֥וּ כִֽי יִשְׁתֹּ֑קוּ`), and Proverbs 26:20.
   - **Fainting life (`עָטַף` H5848 + `נֶפֶשׁ` H5315):** Jonah 2:7 (`בְּהִתְעַטֵּ֤ף עָלַי֙ נַפְשִׁ֔י`) shares Hithpael `עָטַף` + `נֶפֶשׁ` with Ps 107:5 (`נַפְשָׁם בָּהֶם תִּתְעַטָּף`).
   - **Swallowing (`בָּלַע` H1104):** Jonah 1:17 (`לִבְלֹעַ אֶת־יוֹנָה`) shares `H1104` with Ps 107:27 (`וְכָל חָכְמָתָם תִּתְבַּלָּע` — "all their wisdom is swallowed up / confused").
   - **Prison bars, Pit, and Thanksgiving Sacrifice (`H1280`, `H7845`/`H7825`, `H2076`+`H8426`):** Jonah 2:6 (`הָאָרֶץ בְּרִחֶיהָ בַעֲדִי לְעוֹלָם וַתַּעַל מִשַּׁחַת חַיַּי`) echoes Ps 107:16 (`בְרִיחֵי בַרְזֶל` `H1280`), Ps 107:20 (`מִשְּׁחִיתוֹתָם` `H7825`, LXX `διαφθορά`, matching Jonah 2:6 LXX `φθορά`), and Ps 107:22 ↔ Jonah 2:9 (`וְיִזְבְּחוּ זִבְחֵי תוֹדָה` / `בְּקוֹל תּוֹדָה אֶזְבְּחָה־לָּךְ` — `H2076`+`H8426` occurs in only 7 OT verses total!).

2. **(b) LXX Shifts and NT Bridge (`Jonah 1–2` → `Ps 106 LXX` → `Matt 12:38–42`):**
   - **Fish / Sea-monster (`H1709`/`H1710` → `κῆτος` G2785) and Belly (`H4578`/`H0990` → `κοιλία` G2836):** In Jonah 1:17 (`2:1` LXX), `דָּג גָּדוֹל` is rendered `κήτει μεγάλῳ`, `לִבְלֹעַ` (`H1104`) → `καταπιεῖν` (`καταπίνω`), `בִּמְעֵי הַדָּג` (`H4578`) → `ἐν τῇ κοιλίᾳ τοῦ κήτους`, and `שְׁלֹשָׁה יָמִים וּשְׁלֹשָׁה לֵילוֹת` → `τρεῖς ἡμέρας καὶ τρεῖς νύκτας`. Matthew 12:40 reproduces `ἐν τῇ κοιλίᾳ τοῦ κήτους τρεῖς ἡμέρας καὶ τρεῖς νύκτας` verbatim.
   - **"Heart" (`לֵבָב` H3824 / `καρδία` G2588):** Jonah 2:3 (`בִּלְבַב יַמִּים`, LXX `καρδίας θαλάσσης`) parallels Matthew 12:40 (`ἐν τῇ καρδίᾳ τῆς γῆς`), transferring cosmic "heart" imagery from the sea to the earth/realm of the dead.
   - **Calm verb divergence in LXX (`שָׁתַק` H8367):** Jonah 1:11–12 renders `וְיִשְׁתֹּק` as `κοπάσει` (`κοπάζω`, "abate/subside"), whereas Ps 107:30 (`106:30` LXX) renders `יִשְׁתֹּקוּ` as `ἡσύχασαν` (`ἡσυχάζω`).
   - **Commanding the storm (`lxx_plus_expansion`):** In Ps 107:29 (`106:29` LXX), LXX inserts `καὶ ἐπέταξεν` (`ἐπιτάσσω`, `sum_idf: 9.77`) before `τῇ καταιγίδι` ("and he commanded the storm"), creating a grammatical parallel to the LXX's 5-fold `προστάσσω` in Jonah (1:17, 2:10 [LXX `+` expansion `προσετάγη`], 4:6, 4:7, 4:8).
   - **LXX divergence on `סוּף` (Jonah 2:5) and `בַעֲדִי` / `לְקִצְבֵי הָרִים` (Jonah 2:6):** MT `סוּף` (`H5488`, "reeds/weeds", evoking the Reed Sea) becomes `ἔσχατος` ("uttermost abyss") in LXX Jonah 2:5 (`2:6`), while LXX adds `εἰς σχισμὰς ὀρέων` ("into the clefts of the mountains", `sum_idf: 18.55`), shifting `לְקִצְבֵי הָרִים` (`mt_minus` in 2:6) into the prior clause and translating `בַעֲדִי` (`H1157`) as `κάτοχοι` ("eternal bars holding fast", `p_g_given_h: 0.0106`).
   - **LXX theological shift in Ps 107:17 (`106:17` LXX):** MT `אֱוִלִים` (`H0191`, "fools") is rendered `ἀντελάβετο αὐτῶν` (`ἀντιλαμβάνω`, "he helped them", `p_g_given_h: 0.0333, g_idf: 9.26`), softening human folly into divine rescue.
   - **Wisdom & Swallowing (`H2451` + `H1104` → `σοφία` + `καταπίνω`):** Ps 107:27 (`106:27` LXX) reads `καὶ πᾶσα ἡ σοφία αὐτῶν κατεπόθη` ("and all their wisdom was swallowed up"). In Matt 12:42, `σοφία Σολομῶνος` (`G4678`) stands alongside the `πλεῖον` motif immediately after the sign of Jonah's swallowing. *(e) Interpretive hypothesis:* Ps 107:27's shipwrecking of human `σοφία` (cf. the mariners' failed efforts in Jonah 1:5, 13) stands in ironic contrast to the Queen of the South seeking true `σοφία` and "something greater than Solomon/Jonah" in Matt 12:41–42.

---

#### B. Plant, Worm, and Scorching East Wind (Jonah 4:5–10)

1. **(a) Attested lexical & LXX data:**
   - **Divine appointment verb (`מָנָה` H4487):** `clause_role_query` and passage tokens confirm `H4487` frames four decisive cosmic/ecological agents in Jonah: `דָּג גָּדוֹל` (1:17), `קִיקָיוֹן` (4:6), `תּוֹלַעַת` (4:7), and `ר֤וּחַ קָדִים חֲרִישִׁ֔ית` (4:8). LXX consistently renders all four (plus `לַדָּג` in 2:10 via `lxx_plus_expansion` `προσετάγη`) with `προστάσσω`.
   - **The Plant (`קִיקָיוֹן` H7021):** `get_Word` confirms `H7021` occurs only 4× in the Hebrew Bible (Jonah 4:6, 7, 9, 10). LXX translates it `κολοκύνθη` / `κολόκυνθα` ("gourd"). STEPBible / OpenScriptures etymology in `get_Word` links `H7021` to the root **`קָיָה` (`H7006`, "to vomit")**, resonating phonetically/lexically with the fish vomiting Jonah (`וַיָּקֵא`, `H6958` `קִיא`) in 2:10.
   - **The Worm (`תּוֹלַעַת` H8438):** `occurrences` shows 43 OT verses (27× in Exodus for tabernacle crimson dye `תּוֹלַעַת שָׁנִי`; 1× in Exodus 16:20 where hoarded manna breeds `תּוֹלָעִים` overnight *until morning* `עַד־בֹּקֶר`; plus Ps 22:6, Job 25:6, Isa 14:11, 66:24, Lam 4:5). In Jonah 4:7 (`LXX` `σκώληκι ἑωθινῇ τῇ ἐπαύριον`), God appoints the worm `בַּעֲלוֹת הַשַּׁחַר לַמָּחֳרָת` ("at the rising of dawn the next day"). Notably, `LXX` has `mt_minus` for `בַּעֲל֥וֹת` (`H5927`), turning "when dawn *came up*" into the adjective `ἑωθινῇ` ("morning [worm]") and masking the Hebrew vertical echo with `וַיַּעַל` (`H5927`) of the plant "going up" in 4:6! Also `וַיִּיבָשׁ` (`H3001`) shifts to `ἀπεξηράνθη` (`ἀποξηραίνω`, `g_idf: 12.9`).
   - **The East Wind (`ר֤וּחַ קָדִים֙ חֲרִישִׁ֔ית` H7307 + H6921 + H2759):** `occurrences` confirms `H2759` (`חֲרִישִׁי`) is a **strict OT hapax legomenon** in Jonah 4:8; LXX renders `קָדִים חֲרִישִׁית` as `πνεύματι καύσωνος συγκαίοντι` ("a burning wind of scorching heat"). `intersect_words` (`["H7307","H6921"]`) surfaces 14 verses in the OT, including **Exod 10:13** (east wind bringing locusts), **Exod 14:21** (east wind drying the sea), **Ps 48:7** ("with the east wind you shatter the ships of Tarshish"), **Ezek 17:10 & 19:12** (east wind touching/drying up a vine), **Ezek 27:26** ("the east wind broke you in the heart of the seas" `בְּלֵב יַמִּים`), and **Hos 12:1; 13:15** (chasing the east wind; east wind drying up springs).

---

#### C. Forty Days vs. Three Days, Repentance, and Compassion (Jonah 3–4 ↔ Joel 2 ↔ Matt 12:38–42)

1. **Forty Days (`אַרְבָּעִים` H0705) → LXX `τρεῖς` ("three") (`Jonah 3:4`):**
   - **(a)+(b)** In Jonah 3:4 MT, Jonah proclaims: `ע֚וֹד אַרְבָּעִ֣ים י֔וֹם וְנִֽינְוֵ֖ה נֶהְפָּֽכֶת` ("Yet forty days, and Nineveh shall be overturned [`הָפַךְ` H2015]").
   - `lxx_concordance` verifies that **LXX Jonah 3:4 renders `אַרְבָּעִים` (`H0705`) as `τρεῖς` ("three", `p_g_given_h: 0.0073, g_idf: 6.51`)** — "Yet three days, and Nineveh shall be overthrown (`καταστραφήσεται`)."
   - *(e) Interpretive hypothesis:* Whether reflecting a Vorlage scribal variation (`ארבעים` ↔ `שלשה`) or a Septuagintal harmonization with the "three days' journey" of Jonah 3:3 (`LXX` `ὡσεὶ πορείας ὁδοῦ ἡμερῶν τριῶν`) and the "three days and three nights" in the fish (Jonah 1:17 / Matt 12:40), the LXX creates an explicit numerical symmetry (`τρεῖς` in 1:17, 3:3, 3:4) that ties Jonah's three-day descent/deliverance directly to Nineveh's three-day reprieve before Matthew 12:40–41 links them together.
   - Note also `וְנִֽינְוֵ֖ה נֶהְפָּֽכֶת` (`H2015` `הָפַךְ` Niphal participle): `הָפַךְ` carries dual valence — both "overthrown/destroyed" (Sodom/Gomorrah) and "turned/transformed" — which is literally enacted when Nineveh *turns* (`שׁוּב` H7725, 3:8, 10) instead of being physically overturned.

2. **Compassion Formula (`H2587`, `H7349`, `H0750`, `H0639`, `H7227`, `H2617`, `H5162`) and `חוּס` (`H2347`):**
   - **(a) Exact corpus distribution:** `intersect_words` `["H2587","H7349","H0750","H0639","H2617"]` returns **6 verses**: Exod 34:6, Ps 86:15, Ps 103:8, Ps 145:8, Joel 2:13, and Jonah 4:2. Adding `H5162` (`וְנִחָם`, "and relents" over calamity `עַל הָרָעָה`), `intersect_words` `["H2587","H7349","H5162"]` returns **ONLY 2 verses in the entire Hebrew Bible**: **Joel 2:13** and **Jonah 4:2**.
   - Likewise, `intersect_words` `["H4310","H3045","H7725","H5162"]` (`מִי יוֹדֵעַ יָשׁוּב וְנִחַם`, "Who knows whether he will turn and relent?") returns **ONLY 2 verses in the entire Hebrew Bible**: **Joel 2:14** and **Jonah 3:9**!
   - **(b) LXX Shifts in Jonah 3:9–4:4:**
     - MT `נָחַם` (`H5162`, Niphal "relent/repent") in Jonah 3:9–10 is rendered by LXX as **`μετανοέω`** (`μετανοήσει` / `μετενόησεν` "repent / change mind" — God!). In **Matthew 12:41**, Jesus uses the **exact same Greek verb `μετανοέω`** (`μετενόησαν`, `G3340`) for the *Ninevites* repenting at Jonah's `κήρυγμα` (`G2782`, cf. LXX Jonah 1:2 `κήρυξον`, 3:2 `κήρυξον`, 3:4 `ἐκήρυξεν` for `קָרָא` `H7121`!). Thus in Greek, *both* Nineveh (`Matt 12:41`) and God (`LXX Jonah 3:9–10`) undergo `μετάνοια` — whereas in Jonah 4:1–4, MT `וַיֵּרַע ... רָעָה גְדוֹלָה וַיִּחַר לוֹ` ("it was a great evil to Jonah and he burned with anger") is softened in LXX to `ἐλυπήθη Ιωνας λύπην μεγάλην καὶ συνεχύθη` ("grieved with great grief and was confounded"), and `חָרָה` (`H2734`) in 4:4, 9 shifts to `λυπέω` (`λελύπησαι` / `λελύπημαι`, `p_g_given_h: 0.0632`).
     - In Jonah 4:3, LXX adds `δέσποτα` (`lxx_plus_expansion`, `sum_idf: 9.02`) before `κύριε` ("O Sovereign Lord").
     - In Jonah 4:10–11, YHWH confronts Jonah with `חוּס` (`H2347`, "pity/spare/have compassion", LXX `φείδομαι`): "You had compassion (`חַסְתָּ`) on the plant... and should I not have compassion (`לֹא אָחוּס`) on Nineveh?" — extending compassion to >120,000 (`מִשְׁתֵּים עֶשְׂרֵה רִבּוֹ אָדָם`, LXX `πλείους ἢ δώδεκα μυριάδες ἀνθρώπων`) *and* `וּבְהֵמָה רַבָּה` (`H0929`+`H7227`, "much livestock", echoing 3:7–8 where beasts also fasted and cried out).

---

### 2.2 Wordplay, Paronomasia, and Polysemy (Attested & Surface-Cue Evidence)

All wordplays below were verified in `get_Passage` (`literary_structure.wordplays`) and `wordplay_scan`:

| Forms & Strong's | Refs | Classification & Score (Tool) | Analysis |
|---|---|---|---|
| `וַיַּפִּלוּ` ↔ `וַיִּפֹּל` (`H5307` `נָפַל`) | Jonah 1:7 | `attested_textual_wordplay` (`syntactic_talion`, `voice_inversion`, `actant_role_flip`, `score: 0.98, conf: 0.921`) | Sailors "caused lots to fall" (Hiphil) and the lot "fell" (Qal) on Jonah. |
| `ק֠וּם` ↔ `וַיָּ֤קָם` (`H6965` `קוּם`) | Jonah 1:2–3; 3:2–3 | `attested_textual_wordplay` (`syntactic_talion`, `score: 0.82`) | Identical imperative + wayyiqtol reversal: 1:2–3 "Arise, go to Nineveh" → "he arose to flee to Tarshish"; 3:2–3 "Arise, go to Nineveh" → "he arose and went to Nineveh." |
| `בַּצֵּל` (`H6738` `צֵל`) ↔ `לְהַצִּיל` (`H5337` `נָצַל`) | Jonah 4:5–6 | `attested_textual_wordplay` (`shared_consonantal_substring` `צל`, `score: 0.883, conf: 0.795`) | Paronomasia linking the plant's "shade" (`צֵל`) with "delivering" (`לְהַצִּיל`) Jonah from his distress (`מֵרָעָתוֹ`). LXX flattens this Hebrew pun into `σκιά` / `σκιάζω` ("shade / overshadow"). |
| `יוֹנָה` (`H3124`) ↔ `קִיקָיוֹן` (`H7021`) | Jonah 4:5–6, 9 | `attested_textual_wordplay` (`proper_name_paronomasia` `יונ`, `score: 0.841`, `formal_score: 0.667`) | Sound/letter echo between `יוֹנָה` and `קִיקָיוֹן` (whose lexicon root `קָיָה` `H7006` "vomit" also echoes `קִיא` `H6958` in 2:10). |
| `הָאָדָם` (`H120`) ↔ `אַדְמָתִי` (`H127`) | Jonah 3:7; 4:2 | `attested_textual_wordplay` (`onomastic_valence_play` `אדם`, `score: 0.90, conf: 0.846`) | Contrasts Nineveh's humbled "humankind" (`הָאָדָם`) with Jonah's possessive attachment to "my own soil/land" (`אַדְמָתִי`). |
| `יָשׁוּב` ↔ `וְשָׁב` (`H7725` `שׁוּב`) | Jonah 3:9 (and 3:8, 10) | `attested_textual_wordplay` (`syntactic_talion`, `score: 0.86`) | Double `שׁוּב` in 3:9 ("turn and relent, and turn back from fierce anger") mirroring 3:8–10 (Nineveh turns from its evil way → God turns from anger). |
| `שָׁם` (`H8033`) ↔ `וַיִּשְׂמַח` (`H8055`) | Jonah 4:5–6 | `attested_textual_wordplay` (`shared_consonantal_substring` `שמ`, `score: 0.862`) | Also in Ps 107:35–42: `יָשֵׂם` (`H7760`) ↔ `שָׁם` (`H8033`) ↔ `וְיִשְׂמָחוּ` (`H8055`) ↔ `וְיִשְׁמָר` (`H8104`) (`formal_score: 0.707–0.867`). |
| `וַיֵּרַע ... רָעָה` (`H7489`/`H7451`) | Jonah 1:2; 3:8,10; 4:1,2,6 | `wordplay_scan` (`evaluative_valence_contrast`, `score: 0.86` with `גְדוֹלָה`) | `רָעָה` rotates meaning across the book: Nineveh's *wickedness* (1:2; 3:8) → God's planned *calamity* (3:10; 4:2) → Jonah's *displeasure/distress* ("it was evil to Jonah with a great evil", 4:1; "his discomfort", 4:6). |
| `יְרֵא`/`יִרְאָה` (`H3372`/`H3373`/`H3374`) | Jonah 1:9–10, 16 | `orthographic_similarity_only` (`consonantal_exact`) | Jonah claims `אֱלֹהֵי הַשָּׁמַיִם אֲנִי יָרֵא` ("I fear the God of heaven") while fleeing; the pagan sailors actually fear with a `יִרְאָה גְדוֹלָה` (1:10, 16). |
| `הַרְבֵּה` (`H7235`) ↔ `רַבָּה` (`H7227`) | Jonah 4:11 | `consonantal_exact` (`רבה`, `formal_score: 1.0`) | Acoustic pairing of "more than 120,000 humans" (`הַרְבֵּה`) with "much livestock" (`וּבְהֵמָה רַבָּה`). |
| `מַיִם` (`H4325`) ↔ `כְרָמִים` (`H3754`) / `עֹשֵׂי` ↔ `מַעֲשֵׂי` (`H6213`/`H4639`) | Ps 107:23–24, 35–37 | `wordplay_scan` (`prefix_suffix_overlap`, `formal_score: 0.867 / 0.827`) | Sailors "doers of business" (`עֹשֵׂי מְלָאכָה`, v.23) see "works of YHWH" (`מַעֲשֵׂי יְהוָה`, v.24). |
| `σημεῖον` (`G4592`) ↔ `ἡμέρας` (`G2250`) | Matt 12:39–40 | `orthographic_similarity_only` (`ημε`, `score: 0.815`) | Surface orthographic/phonetic cue only (not etymological). |

---

### 2.3 Narrative Reversals, Inversions, and Contrasts

1. **(c) Spatial & Vertical Reversals (`יָרַד` vs. `עָלָה`):**
   - Jonah's downward flight (`יָרַד` to Joppa → into the ship → into the hold `1:3, 5` → into the sea → to the roots of the mountains `2:6`) is reversed by YHWH bringing up his life from the pit (`וַתַּעַל מִשַּׁחַת חַיַּי`, `H5927` `עָלָה`, 2:6).
   - **Psalm 107** turns this vertical oscillation into a cosmic principle: sailors "go up to heaven, go down to the deeps" (`יַעֲלוּ שָׁמַיִם יֵרְד֣וּ תְהוֹמוֹת`, v.26), and stanzas 5–6 (`v.33–41`) enact paired ecological/social inversions (`שִׂים` `H7760`): rivers → desert (`v.33`), fruitful land → salt waste (`v.34`), desert → pools of water (`v.35`), pouring contempt on princes (`שֹׁפֵךְ בּוּז עַל נְדִיבִים`) in `בְּתֹהוּ לֹא־דָרֶךְ` (`H8414`, v.40) while lifting the needy on high (`וַיְשַׂגֵּב אֶבְיוֹן מֵעוֹנִי`, v.41).
   - In **Jonah 4:6–8**, `עָלָה` (`H5927`) is ironically inverted in 24 hours: the plant *goes up* (`וַיַּעַל`, 4:6) to give shade, only for dawn to *come up* (`בַּעֲלוֹת הַשַּׁחַר`, 4:7) with a worm that strikes (`וַתַּךְ` `H5221`) the plant, followed by the sun rising and striking (`וַתַּךְ` `H5221`) Jonah's head (4:8).

2. **(c) Moral & Ethnic Reversals (Prophet vs. Pagans; Israel's Generation vs. Nineveh & Sheba):**
   - **Jonah 1 & 3 vs. Jonah 4:** Pagan mariners (1:5–16) pray, row hard to spare innocent blood, fear YHWH greatly, sacrifice, and vow; pagan Ninevites and their king (3:5–9) believe immediately, fast, put on sackcloth (even beasts), and turn from evil. Meanwhile, the Israelite prophet sleeps in a deadly storm (`וַיֵּרָדַם` H7290, LXX `ἔρρεγχεν` "snored", 1:5), flees precisely because he *knows* Exod 34:6 / Joel 2:13 (4:2), rejoices "with great joy" (`שִׂמְחָה גְדוֹלָה`) only over his own temporary shade (4:6, contrasting the "great evil" `רָעָה גְדוֹלָה` of 4:1 and Ps 107:30, 42 where joy `שָׂמַח` responds to YHWH's rescue/justice), and twice asks to die (4:3, 8).
   - **Jonah 2:8–10 `conclusion_transformation`:** As detected in `get_Passage` (`surprisal_bits: 14.4`), Jonah's psalm unexpectedly pivots at 2:8 (`מְשַׁמְּרִים הַבְלֵי־שָׁוְא חַסְדָּם יַעֲזֹבוּ`, "those who cling to vain idols abandon their `חֶסֶד`") — ironic given that the pagan sailors just vowed/sacrificed (`1:16`) and Jonah himself will soon resent YHWH's `רַב־חֶסֶד` toward Nineveh (`4:2`).
   - **Matthew 12:38–42 Reversal of "Sign" and "Judgment":**
     - Scribes and Pharisees demand a `σημεῖον` (`G4592`), yet Jesus refuses every spectacle except `τὸ σημεῖον Ἰωνᾶ τοῦ προφήτου` (`12:39–40`): burial in the heart of the earth for three days and three nights, culminating in resurrection (`ἀναστήσονται` / `ἐγερθήσεται`, `G0450` / `G1453`).
     - In a courtroom reversal (`ἐν τῇ κρίσει`), Gentile Ninevites and the Queen of the South (`βασίλισσα νότου`) rise up to condemn (`κατακρινοῦσιν` / `κατακρινεῖ`, `G2632`) "this evil and adulterous generation." Contrast: the Ninevites had no miracle/deliverance narrative recounted to them, only `τὸ κήρυγμα Ἰωνᾶ` (`G2782`), and the Queen of the South came `ἐκ τῶν περάτων τῆς γῆς` (`G4009`+`G1093`) to hear Solomon's wisdom (`σοφία`, `G4678`), whereas Jonah fled in the opposite direction (`תַּרְשִׁישָׁה`) away from YHWH's presence (`1:3`) and this generation rejects `πλεῖον Ἰωνᾶ ὧδε` and `πλεῖον Σολομῶνος ὧδε` (`G4119`, neuter "something greater").

3. **(d) Physical Analogies Across the Corpus:**
   - **Cosmic enclosure and release:** Storm-tossed ship at sea (`1:4–15`; `Ps 107:23–30`) ↔ living entombment inside the great fish (`1:17–2:10`) ↔ Sheol's earth-bars and gates of death (`2:6`; `Ps 107:16, 18`) ↔ Son of Man in the heart of the earth (`Matt 12:40`).
   - **Ephemeral shelter vs. devouring nature:** A fast-growing plant (`בִּן־לַיְלָה הָיָה וּבִן־לַיְלָה אָבָד`, 4:10) attacked at dawn by a tiny worm (`תּוֹלַעַת`, 4:7) and desiccated by an arid sirocco (`רוּחַ קָדִים חֲרִישִׁית`, 4:8) physically models the fragility of Jonah's self-serving comfort compared to an enduring, populous city (`4:11`) and the desert-to-springs sovereignty of YHWH (`Ps 107:33–35`).

---

### 2.4 Intermediate Bridges Linking Jonah 1–4, Psalm 107, and Matthew 12:38–42

Every bridge below was verified by `intersect_words`, `occurrences`, `trace_evidence`, or `follow_connectionchain`:

1. **Joel 2:13–14 (Primary Bridge for Compassion & Repentance):**
   - The **only** other OT verse sharing `חַנּוּן` (`H2587`) + `רַחוּם` (`H7349`) + `נִחָם` (`H5162`) with Jonah 4:2 (`Joel 2:13`), and the **only** other OT verse sharing `מִי יוֹדֵעַ יָשׁוּב וְנִחַם` with Jonah 3:9 (`Joel 2:14`). Joel 2:13–14 bridges **Exodus 34:6** (source of the grace creed) to **Jonah 3–4**'s theology of divine relenting.
2. **Ezekiel 27:26, 29 (Primary Bridge for Shipwreck, East Wind, and Heart of the Seas):**
   - Shares the exact 3-lemma cluster `H3381 + H3220 + H0591` ("go down + sea + ship") with **Psalms 107:23** and **Jonah 1:5** (`Ezek 27:29`), and pairs `רוּחַ הַקָּדִים` (`H7307`+`H6921`) with `בְּלֵב יַמִּים` ("in the heart of the seas", `Ezek 27:26`), bridging Jonah 1 (`ship`), Jonah 2:3 (`heart of the seas`), Jonah 4:8 (`east wind`), and Ps 107:23–27.
3. **Exodus 14:21; 15:5, 12; 10:13; 16:20 & Nehemiah 9:11 (Exodus-Red Sea Cosmic Bridge):**
   - `Exod 15:5` (`תְּהֹמֹת` + `מְצוֹלֹת`, surfaced by `trace_evidence` `r11:lex:H4688:0`) and `Neh 9:11` (`הִשְׁלַכְתָּ בִמְצוֹלֹת` — surfaced by `follow_connectionchain` `r13:v3bmw:12523`, 4 rare shared lemmas `H3220+H5674+H7993+H4688` with Jonah 2:3!) establish the Red Sea deliverance template behind Jonah 2:3–5 (`סוּף`, `מְצוּלָה`, `תְּהוֹם`) and Ps 107:24–26. `Exod 14:21` and `10:13` supply `רוּחַ קָדִים` as divine meteorological instrument, while `Exod 16:20` supplies overnight `תּוֹלָעִים` (`H8438`) appearing at morning (`עַד־בֹּקֶר`).
4. **Psalms 42:7; 48:7; 69:15; 50:14, 23; 116:17 (Psalter Bridges):**
   - **Psalms 42:7** (`r13:v3bmw:14601`: `H4867 + H1530 + H5674` — "all your breakers and your waves have passed over me"): near-verbatim template for Jonah 2:3b.
   - **Psalms 48:7** (`בְּר֥וּחַ קָדִים תְּשַׁבֵּר אֳנִיּוֹת תַּרְשִׁישׁ`): directly links `רוּחַ קָדִים` (`H7307`+`H6921`, Jonah 4:8) with shattering "ships of Tarshish" (`אֳנִיּוֹת תַּרְשִׁישׁ`, cf. Jonah 1:3–4).
   - **Psalms 69:15** (`וְאַל תִּבְלָעֵנִי מְצוּלָה`, `H1104`+`H4688`): fuses "deep" (`מְצוּלָה`) and "swallow" (`בָּלַע`), bridging Jonah 1:17/2:3 and Ps 107:24, 27.
   - **Psalms 50:14, 23 & 116:17:** Share `H2076 + H8426` (`זָבַח + תּוֹדָה`, "sacrifice of thanksgiving") and vow-paying/salvation (`שַׁלֵּם נְדָרֶיךָ`, `יֵשַׁע`) with Jonah 2:9 and Ps 107:22.
5. **1 Kings 19:4 (Prophetic Despair Under a Tree):**
   - `intersect_words` `["H7592","H5315","H4191"]` yields **only 1 Kings 19:4 and Jonah 4:8** (`וַיִּשְׁאַל אֶת־נַפְשׁוֹ לָמוּת`), bridging Elijah sitting under a broom tree in the wilderness (`תַּחַת רֹתֶם אֶחָד`) to Jonah sitting under his booth/gourd east of Nineveh (`4:5–8`).
6. **Micah 7:19 & Zechariah 10:11 (Prophetic-Assyrian Abyssal Bridges):**
   - **Micah 7:19** (`r13:v3bmw:22800`: `H7993+H4688+H3220`) inverts Jonah 2:3's cast-into-the-deep motif: God *casts all sins into the depths of the sea* (`וְתַשְׁלִיךְ בִּמְצֻלוֹת יָם`) out of compassion (`יָשׁוּב יְרַחֲמֵנוּ`).
   - **Zechariah 10:11** (`r13:v3bmw:23144` & `trace_evidence` `r12:scene:22668:23144`, `e_perp=15.774 bits`): pairs `מְצוּלוֹת` + `יָם` + `גַּלִּים` with `וְהוּרַד גְּאוֹן אַשּׁוּר` ("and the pride of Assyria will be brought down"), connecting Red Sea depth imagery directly to Assyria (Nineveh's empire).

---

## 3. System Evaluation

### 3.1 What did the MCP tools help discover?
- **Exact corpus-wide uniqueness counts via `research` (`intersect_words`, `occurrences`):** Confirming instantaneously that `H2587+H7349+H5162` (`Joel 2:13`, `Jonah 4:2`), `H4310+H3045+H7725+H5162` (`Joel 2:14`, `Jonah 3:9`), `H7592+H5315+H4191` (`1 Kgs 19:4`, `Jonah 4:8`), `H3381+H3220+H0591` (`Ps 107:23`, `Ezek 27:29`, `Jonah 1:5`), and `H8367` (`Jonah 1:11,12`, `Ps 107:30`, `Prov 26:20`) are ultra-tight, nearly exclusive lexical signatures rather than commonplace idioms.
- **Fine-grained MT ↔ LXX translation shifts via `lxx_concordance`:** Revealing `אַרְבָּעִים` → `τρεῖς` (Jonah 3:4), `נָחַם` → `μετανοέω` (Jonah 3:9–10, matching Matt 12:41), `חָרָה` → `λυπέω` (Jonah 4:1,4,9), `צֵל`/`לְהַצִּיל` flattened to `σκιά`/`σκιάζω` (Jonah 4:6), `סוּף` → `ἔσχατος` + `εἰς σχισμὰς ὀρέων` (Jonah 2:5), `אֱוִלִים` → `ἀντελάβετο` (Ps 107:17), `לִדְמָמָה` preceded by `lxx_plus_expansion` `καὶ ἐπέταξεν` (Ps 107:29), `σοφία ... κατεπόθη` (Ps 107:27), and `δέσποτα` (Jonah 4:3).
- **Documented root/etymology & syntactic wordplay:** `get_Word` (`H7021`) surfaced the STEPBible root link between `קִיקָיוֹן` (`H7021`) and `קָיָה` (`H7006`, "vomit"), while `get_Passage` (`literary_structure`) and `wordplay_scan` surfaced `Syntactic Talion` (`נָפַל` 1:7; `קוּם` 1:2–3, 3:2–3; `שׁוּב` 3:9) and `צֵל`/`נָצַל` (4:5–6) with clear epistemic labels separating attested wordplay from `orthographic_similarity_only`.

### 3.2 Did it lead to interesting connections?
Yes — strongly. Most notably:
- **Psalms 107:27 (`σοφία ... κατεπόθη`) ↔ Jonah 1:17 (`καταπιεῖν`) ↔ Matthew 12:42 (`σοφία Σολομῶνος`)**, linking the sailors' swallowed wisdom in the storm, Jonah swallowed by the great fish, and the Queen of the South seeking wisdom greater than Solomon.
- **Ezekiel 27:26, 29** as a structural hub uniting `יָרַד + יָם + אֳנִיָּה`, `רוּחַ קָדִים`, and `בְּלֵב יַמִּים`.
- **Psalms 48:7** (`east wind` breaking `ships of Tarshish`), **Exodus 16:20** (overnight `תּוֹלָעִים` at morning), and **Micah 7:19 / Zechariah 10:11** (`מְצוֹלָה` + Assyrian/sin inversion).

### 3.3 How well did the tools support follow-up investigation?
Mixed — **excellent when pivoting to `research` sub-operations and `get_Word`, but broken on stateful chain traversal in local CLI mode**:
- **`get_Word`** (`1.4–2.2s`) and **`research` (`intersect_words`, `occurrences`, `lxx_concordance`, `clause_role_query`)** (`5.8–13.6s`) supported rapid, surgical follow-up hypotheses.
- **`follow_connectionchain`** succeeded on initialization (`step: 0`, `Jonah 2:3`, surfacing `Micah 7:19`, `Neh 9:11`, `Zech 10:11`, `Ps 42:7`), **but failed on step 1 (`chain_not_found`, `error`) 11 seconds later**, well before its `expires_at` timestamp (`2026-11-26T22:33:17.179Z`). Under `--target local --no-supabase` per-invocation CLI execution, server-side opaque `chain` handles do not persist across calls, preventing multi-hop chain follow-up (`follow` / `branch` / `revisit`).
- **`lxx_concordance` silently truncated** multi-chapter passages (`Jonah 1-4` stopped at `1:12`; `Jonah 3-4` stopped at `4:2`) without returning `has_more` or a pagination cursor, forcing multiple manual chunked follow-up calls.
- **`trace_evidence`** rejected verse references (`"Jonah 2:3"`, `"Psalms 107:24"`) as `"Unresolved or unsupported query terms"` because it tokenizes them as words instead of resolving verse anchors.

### 3.4 Did the system surface helpful intermediate clues?
Yes, with caveats by tool:
- **`follow_connectionchain` (`step: 0` on `Jonah 2:3`)** and **`trace_evidence` (fallback)** surfaced genuinely illuminating intermediate verses via multi-term BMW convergence and lexical bridges: **Psalms 42:7**, **Micah 7:19**, **Nehemiah 9:11**, **Zechariah 10:11**, **Exodus 15:5**, and **Psalms 68:22**.
- **`passage_compare` (`Jonah 2:1-10`, `Psalms 107:17-32`, `Matthew 12:39-41`)** surfaced `shared_lemmas` and `lxx_bridged_lemmas` (`יָרַד`/`καταβαίνω`, `קָרָא`/`צָעַק`, `מְצוֹלָה`, `בֶּטֶן`/`κοιλία`, `תּוֹדָה`/`αἴνεσις`, `קֵץ`/`חַיִּים`), though not intermediate third-party verses.
- **`get_Connection` (`["Jonah 1-4", "Psalms 107", "Matthew 12:38-42"]`)** was underwhelming: it returned only 5 clues (1 steiner tree, 1 `H3124↔G2495` link, and 3 OpenBible editorial xrefs) and missed almost the entire shared Hebrew storm/abyss/deliverance/thanksgiving vocabulary between Jonah and Psalm 107.

### 3.5 What important relationships did the system miss or bury?
1. **`tri_textual_diff` on `Matthew 12:39–42` completely missed `Jonah 1:17`, `Jonah 2:1`, `Jonah 3:5`, and `1 Kings 10:1` (`Queen of Sheba`)!** Its `candidate_sources` picked `1 Sam 30:22`, `Deut 6:22`, `Gen 9:12`, `Ps 74:9`, and `2 Chr 18:6`, leaving tokens 29–105 (`κοιλίᾳ τοῦ κήτους ... Νινευεῖται ... βασίλισσα νότου ... σοφίαν Σολομῶνος`) wholly unaligned as `nt_adaptation` — a severe failure on one of the NT's most famous explicit Jonah quotations/typologies. (Similarly, `tri_textual_diff` on `Jonah 3:1–5` returned `status: "no_alignment"` despite listing `Jonah 1:2` in `candidate_sources`.)
2. **`sequence_parallels` missed the deep structural storm/distress/calm/thanksgiving parallel between Jonah 1–2 and Psalm 107:23–32** (`raw_score: 2.22, p_null: 0.4615, evidence_bits: 0`) and scored `0` (`p_null: 1`) for Jonah 3–4 vs. Psalm 107:33–43 (and truncated `"Jonah 1:1-2:10"` in output metadata to `"Jonah 1:1"`).
3. **`get_Connection` (`["Jonah 1-4","Psalms 107","Matthew 12:38-42"]`) missed the direct Hebrew lexical bridges** (`H4688`, `H8367`, `H5848`, `H1280`, `H8426`, `H1104`, `H3381+H3220+H0591`) between Jonah and Psalm 107.
4. **`get_Word` `lxx` summary on `H8367` (`שָׁתַק`)** reported only `G2272 ἡσύχιος` (`Prov 26:20`), omitting `κοπάζω` (`Jonah 1:11–12`) and `ἡσυχάζω` (`Ps 107:30`), which were only visible via `lxx_concordance`.
5. **`get_Passage` `geography` & `chronology` summaries** returned `"symbolic_or_unresolved"` / `"unresolved"` even where explicit places (`Joppa`, `Tarshish`, `Nineveh`) and time markers (`three days and three nights`, `forty days`) appear in the text.
6. **`realworld` metadata on `get_Word`** was `"unavailable"` for concrete ecological/physical items (`H7021` `קִיקָיוֹן`, `H8367` `שָׁתַק`), limiting real-world property bridging.

### 3.6 Were any results distracting, noisy, or falsely elevated?
Yes:
- **Noisy `physical_bridge` clusters in `trace_evidence` (`Jonah 2:3` → `Psalms 107:24`):** Elevated `"Temple & Sanctuary Architecture"` (`H7993` & `H5437`) at the top despite maritime/abyssal context.
- **Noisy collocations in `follow_connectionchain` (`Jonah 2:3`):** Elevated `נָהָר ↔ פְּרָת` (`Euphrates`, `e_perp: 1.57 bits`) and `נָהָר ↔ עֵבֶר` (`e_perp: 0 bits, p_null: 1`) from `Joshua 1:4` and `24:2`, which are irrelevant to Jonah's cosmic river (`וְנָהָר יְסֹבְבֵנִי`).
- **False-positive `tri_textual_diff` candidate sources (`Matt 12:39–42`):** Elevated `1 Sam 30:22`, `Deut 6:22`, `Gen 9:12`, `Ps 74:9`, and `2 Chr 18:6` over `Jonah 1:17` and `1 Kgs 10:1`.
- **Lexicon/token-index glitches observed directly in tool output:**
  - `H6030` (`עָנָה`, "answer", in Jonah 2:2) is misglossed `"to dwell"` (`עוּן`) in both `get_Passage` (`Matt 12:38–42` lexicon) and `passage_compare` (`lxx_bridged_lemmas`).
  - `intersect_words` `matched_tokens` in `1 Kings 19:4` (`["H7592","H5315","H4191"]`) exhibited a 1-token positional offset (`אֶחָד` tagged `H7592`, `אֶת` tagged `H5315`, `נַפְשׁוֹ` tagged `H4191`), and `2 Chronicles 33:16` (`["H2076","H8426"]`) similarly shifted `matched_tokens` onto `יְהוָה` and `שְׁלָמִים`.
- **Schema inconsistency in `research`:** Rejecting `"limit"` on `sequence_parallels`, `tri_textual_diff`, `wordplay_scan`, and `trace_evidence` caused 5/8 sub-operations in batch 1 to fail until `"limit"` was stripped.

### 3.7 How was the presentation quality (clarity, length, formatting, epistemic rigor)?
- **Epistemic rigor:** Very strong overall. Clear separation of `attested_textual_wordplay` vs. `orthographic_similarity_only`, explicit `epistemic` tiers, and cautionary disclaimers on `wordplay_scan` and `gematria` prevent false etymological claims.
- **Wire efficiency & latency:** `get_Word` (`1.4–2.2s`, `~16–18 KB`) and `follow_connectionchain` (`4.3s`, `6 KB`) in progressive `clues`/`evidence` modes are crisp and fast. By contrast, `get_Passage` (`43–95s`, `65–164 KB`) and `research` (`passage_compare` / `sequence_parallels` batch 2 at `159s`, `226 KB`) are heavy and slow, especially when loading full per-token arrays alongside `literary_structure`.
- **Truncation hygiene:** Silent truncation in `lxx_concordance` (`~12` verses max) and non-persistent `chain` handles in `--no-supabase` CLI mode hurt usability without explicit error/pagination cues.

### 3.8 What additional capability would most improve this research workflow?
1. **Stateful or client-passable chain context (for `--no-supabase` / stateless CLI):** Allow `follow_connectionchain` to accept a compact serialized `trail` state or persist local file/SQLite chain state when Supabase is disabled, so multi-hop chain exploration actually works in local/CLI runs.
2. **OT↔NT quotation/allusion-aware `tri_textual_diff` & `sequence_parallels`:** Fix `tri_textual_diff`'s candidate retrieval so explicit proper-noun + lexical citations (`Ἰωνᾶς`/`יוֹנָה`, `κοιλία κήτους`, `Νινευεῖται`, `βασίλισσα νότου`/`Σολομών`) rank `Jonah 1:17; 3:5` and `1 Kgs 10:1` above generic function-word splices (`1 Sam 30:22`, `2 Chr 18:6`), and boost `sequence_parallels` across shared Hebrew/LXX motif arcs (`Jonah 1–2` ↔ `Ps 107:23–32`).
3. **Multi-passage lexical matrix / shared-rarity report in `get_Connection`:** When comparing 2–3 whole chapters/books (`Jonah 1–4`, `Ps 107`, `Matt 12:38–42`), automatically rank rare shared Hebrew roots, LXX-bridged Greek lemmas, and shared 2-to-3-lemma co-occurrences (just as `intersect_words` did manually), rather than returning only 5 top-level clues.
4. **Pagination metadata (`has_more`, `next_verse`) on `lxx_concordance`** and fixing the `1`-based vs. `0`-based `matched_tokens` index alignment in `intersect_words` (observed in `1 Kgs 19:4`, `2 Chr 33:16`) plus the `H6030` `"to dwell"` lexicon gloss bug.
