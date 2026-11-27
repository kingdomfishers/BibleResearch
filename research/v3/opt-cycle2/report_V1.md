# Research Report V1: Decreation Reversals Across Jeremiah 4:23–26, Genesis 1:1–2:3, and Isaiah 24:1–12

**Target:** `local` (`--no-supabase`, `mcp_release: 2.0.0`)  
**Log:** `research/v3/opt-cycle2/local_V1.jsonl`  
**Total MCP Calls:** 19 logged invocations (17 successful primary calls, 1 `invalid_reference` operational result, 1 schema validation error)  

---

## 1. Call Telemetry & Tool Trace

| # | Tool | Key Arguments | Latency (ms) | Wire Bytes | Payload Bytes | Status |
|---:|---|---|---:|---:|---:|---|
| 1 | `get_prompt` | `{}` | 1968 | 5530 | 5338 | `ok` |
| 2 | `get_Passage` | `passage="Jeremiah 4:23-26", depth=5, view="clues"` | 6679 | 8981 | 7849 | `ok` |
| 3 | `get_Passage` | `passage="Genesis 1:1-2:3", limit=40, depth=5, view="clues"` | 12183 | 12437 | 11065 | `ok` |
| 4 | `get_Passage` | `passage="Isaiah 24:1-12", depth=5, view="clues"` | 11436 | 8490 | 7410 | `ok` |
| 5 | `research` | `lxx_concordance` (3 passages) + `occurrences` (`H8414`, `H0922`) | 6218 | 91669 | 76563 | `ok` |
| 6 | `research` | `lxx_concordance` (4 verses) + `lxx` (`Isaiah 24:1-12`) | 12306 | 56232 | 48218 | `ok` |
| 7 | `research` | `lxx_concordance` (`Isaiah 24:10`, `Isaiah 34:11`) | 2008 | 9154 | 7628 | `ok` |
| 8 | `research` | `literary_structure` (`Jer 4:23-26`, `Isa 24:1-12`, `compare_lxx=true`) + `wordplay_scan` (`a/b`) | 2766 | 46719 | 41387 | `ok` |
| 9 | `research` | `sequence_parallels` (3 pairs across `Gen 1`, `Jer 4`, `Isa 24`) | 2269 | 12313 | 10705 | `ok` |
| 10 | `research` | `sequence_parallels` (`Gen 1`→`Isa 24`) + `clause_role_query` x3 | 8896 | 28915 | 25135 | `ok` |
| 11 | `research` | `set_combine` x3 + `wordplay_scan` (`passage="Isaiah 24:1-12"`) | 5193 | 18508 | 16224 | `ok` |
| 12 | `research` | `set_combine` x3 (`H0056+H0776`, `H1238+H1110`, `H7493+H2022`) | 3143 | 11769 | 10303 | `ok` |
| 13 | `research` | `set_combine` (`refs` x8) | 1543 | 232 | 121 | `is_error: true` (`<=6 items`) |
| 14 | `research` | `set_combine` (`refs` x6 full book names) | 1770 | 374 | 240 | `invalid_reference` |
| 15 | `research` | `expand_clue` x2 + `trace_evidence` x2 | 9016 | 117922 | 107586 | `ok` |
| 16 | `get_Passage` | `passage="Zephaniah 1:2-3", depth=3, view="clues", compact=true` | 5874 | 27049 | 23731 | `ok` |
| 17 | `get_Passage` | `passage="Hosea 4:3", depth=5, view="clues"` | 8093 | 7185 | 6233 | `ok` |
| 18 | `research` | `clause_role_query` x2 (`H0216` NEG, `H0120` NEG, `limit=6`) | 3770 | 10541 | 9065 | `ok` |
| 19 | `follow_connectionchain` | `next_id="r11:xref:19167:2", view="clues"` | 5728 | 6087 | 5397 | `ok` |

---

## 2. Executive Synthesis & Epistemic Separation

To maintain strict epistemic hygiene, findings are separated into:
- **(A) Attested Textual / Original-Language Evidence:** MT/STEP Hebrew tokens, Strong's lemmas, Rahlfs/Swete LXX tokens, and exact corpus distribution counts.
- **(B) Linguistic / Grammatical Relationships:** Clause-level negation polarity, construct chains, and MT↔LXX alignment shifts.
- **(C) Structural / Rhetorical Parallels:** Anaphoric framing, sequence alignment (`mirror_inversion` vs. `p_null`), and paronomastic clustering.
- **(D) Interpretive Hypotheses:** Diachronic dependence or theological trajectories inferred from the converging evidence.

Across **Genesis 1:1–2:3**, **Jeremiah 4:23–26**, and **Isaiah 24:1–12**, the corpus evidence reveals two distinct but interlocking **decreation paradigms**:
1. **Jeremiah 4:23–26** executes a tight **visionary, anaphoric undoing** of Genesis 1's pre-creation state and cosmic domains (`רָאִיתִי וְהִנֵּה` × 4), culminating in existential negation (`אֵין`) and seismic shaking (`רָעַשׁ`, `קָלַל`).
2. **Isaiah 24:1–12** executes a **socio-cosmic and urban-cultic undoing** (`קִרְיַת תֹּהוּ`, Isa 24:10; `אָבְלָה נָבְלָה הָאָרֶץ`, Isa 24:4; `שָׁבַת מְשׂוֹשׂ`, Isa 24:8) grounded in covenant violation (`בְּרִית עוֹלָם`, Isa 24:5) and dense paronomasia, linked to Genesis 1 and Jeremiah 4 via rare shared lexemes (`תֹהוּ` H8414, `שָׁבַת` H7673) and intermediate prophetic bridges (**Hosea 4:3**, **Zephaniah 1:2–3**, **Isaiah 33:9 / 34:11**, **Ezekiel 38:20**, **Nahum 1:5 / 2:10**, and **Genesis 7:23 / 11:8–9**).

---

## 3. Decreation Imagery & Lexical Anchors

### 3.1 The `תֹהוּ` (`H8414`) and `בֹהוּ` (`H0922`) Anchor Network
- **(A) Corpus distribution of `בֹהוּ` (`H0922`):** Attested in **only 3 verses** in the entire Hebrew Bible (`occurrences` H0922, `total_verses: 3`):
  1. **Genesis 1:2**: `וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ` ("and the earth was formless and void")
  2. **Jeremiah 4:23**: `רָאִיתִי אֶת הָאָרֶץ וְהִנֵּה תֹהוּ וָבֹהוּ` ("I looked at the earth, and behold, *tohu wabohu*")
  3. **Isaiah 34:11**: `וְנָטָה עָלֶיהָ קַו תֹהוּ וְאַבְנֵי בֹהוּ` ("and he will stretch over it the measuring line of *tohu* and the plumb-stones of *bohu*")
- **(A) Corpus distribution of `תֹהוּ` (`H8414`):** Distributed across 7 books (`book_distribution: {1:1, 5:1, 9:1, 18:3, 19:1, 23:11, 24:1}`), peaking sharply in **Isaiah (11 verses)**, including **Isaiah 24:10** (`נִשְׁבְּרָה קִרְיַת תֹּהוּ`, "broken down is the city of *tohu*") alongside **Isaiah 34:11**, **40:17**, **40:23**, and **45:18** (surfaced by `follow_connectionchain` `v3:bmw:18696`, sharing `H8064 שָׁמַיִם`, `H0776 אֶרֶץ`, `H8414 תֹהוּ`).
- **(A) Editorial & BMW Corroboration:** `get_Passage` and `expand_clue` surfaced reciprocal editorial xref `r11:xref:19167:2` (Jer 4:23 ↔ Gen 1:2, `e_perp: 26.83 bits, p_null: 8.39e-9`, `final_score: 785`) and v3 BMW convergence `v3:bmw:2` (`H0776 + H8414 + H0922`).

### 3.2 Reversed Cosmic Domains & Socio-Civic Unmaking
- **Jeremiah 4:23–26** systematically withdraws created order:
  - *Pre-creation state & light* (4:23): `הָאָרֶץ` → `תֹהוּ וָבֹהוּ` (Gen 1:2); `הַשָּׁמַיִם` → `וְאֵין אוֹרָם` (reversing Gen 1:3–5, 14–18).
  - *Cosmic stability / topography* (4:24): `הֶהָרִים... רֹעֲשִׁים` (`H7493`) and `כָּל הַגְּבָעוֹת הִתְקַלְקָלוּ` (`H7043`, Hitpalpel shaking).
  - *Humanity and sky-birds* (4:25): `אֵין הָאָדָם` (`H0120`) and `כָּל עוֹף הַשָּׁמַיִם נָדָדוּ` (`H5775 + H8064 + H5074`, reversing Gen 1:20–28).
  - *Cultivated land and cities* (4:26): `הַכַּרְמֶל` (`H3759`) becomes `הַמִּדְבָּר` (`H4057`), and `כָל עָרָיו נִתְּצוּ` (`H5892 + H5422`) `מִפְּנֵי יְהוָה מִפְּנֵי חֲרֹן אַפּוֹ`.
- **Isaiah 24:1–12** broadens the lens to global and urban decreation:
  - *Emptying, twisting, scattering* (24:1): `בּוֹקֵק` (`H1238`) `וּבוֹלְקָהּ` (`H1110`), `וְעִוָּה פָנֶיהָ` (`H5753 + H6440`), `וְהֵפִיץ יֹשְׁבֶיהָ` (`H6327 + H3427`). Notably, `v3:bmw:275` and `v3:bmw:276` link **Isa 24:1** directly to **Genesis 11:8–9** (`H6327 פּוּץ`, `H3068`, `H6440`, `H0776` — Babel scattering over the face of all the earth!).
  - *Status leveling* (24:2): 6 social pairs (`עָם/כֹּהֵן`, `עֶבֶד/אֲדֹנָיו`, `שִׁפְחָה/גְּבִרְתָּהּ`, `קוֹנֶה/מוֹכֵר`, `מַלְוֶה/לֹוֶה`, `נֹשֶׁה/נֹשֶׁא`).
  - *Covenant curse & earth mourning* (24:4–6): `אָבְלָה נָבְלָה הָאָרֶץ` (`H0056 + H5034 + H0776`); pollution under inhabitants for breaking `בְּרִית עוֹלָם` (`H1285 + H5769`).
  - *Cessation of Sabbath/festal joy & urban ruin* (24:7–12): `שָׁבַת מְשׂוֹשׂ תֻּפִּים... שָׁבַת מְשׂוֹשׂ כִּנּוֹר` (`H7673` twice in 24:8 — lexical irony against Gen 2:2–3 where God `שָׁבַת` from his completed creation!); `נִשְׁבְּרָה קִרְיַת תֹּהוּ` (24:10); `נִשְׁאַר בָּעִיר שַׁמָּה` (24:12).

---

## 4. Structural Reversals & Paronomasia

### 4.1 Anaphora vs. Chiasm/Wordplay Framing
- **(C) Jeremiah 4:23–26 (`literary_structure`):** Detected `verse_initial_anaphora(H7200)` (`רָאִיתִי` at v.23, v.24, v.25, v.26; `mdl_savings_bits: 10.8`, `confidence: 0.776`, 100% token coverage across 37 tokens). Each verse follows an `Evaluation (רָאָה)` → `Action / Execution (הִנֵּה + reversal state)` micro-template.
- **(C) Isaiah 24:1–12 (`literary_structure` + `wordplay_scan`):** Detected 1 symmetry and 4+ sound/wordplay clusters, including high-scoring paronomasia (`wordplay_scan`):
  - `תִּבּוֹק` (`H1238`) ↔ `תִּבּוֹז` (`H0962`, Isa 24:3, `shared_consonantal_substring: תבו`, `formal_score: 0.747`)
  - `אָבְלָה` (`H0056`) ↔ `נָבְלָה` (`H5034`, Isa 24:4, `shared_consonantal_substring: בלה`, `formal_score: 0.747`)
  - `דִּבֶּר` (`H1696`) ↔ `הַדָּבָר` (`H1697`, Isa 24:3, `consonantal_exact`, `formal_score: 1.0`)
  - `צְוָחָה` (`H6682`) ↔ `בַּחוּצוֹת` (`H2351`, Isa 24:11, `metathesis: צו`, `formal_score: 0.677`) and `שִׂמְחָה` (`H8057`, `formal_score: 0.621`)
  - Thematic predicate cluster `Shared role with שָׁאַר` (`H7604`, `score: 10.8`) framing Isa 24:6 (`נִשְׁאַר אֱנוֹשׁ מִזְעָר`) and 24:12 (`נִשְׁאַר בָּעִיר שַׁמָּה`).
  *(Negative control: low-specificity single-consonant overlaps like `tacht/torot` or `אוֹר/אֶרֶץ` `e_perp: 0.45 bits, p_null: 0.731` are discarded as non-probative.)*

### 4.2 Automated Sequence Alignment (`sequence_parallels`) & Negative-Control Humility
- **Gen 1:1–2:3 (139 clauses) → Jer 4:23–26 (17 clauses):** `arc_kind: "mirror_inversion"`, 3 `reversed` blocks (including Gen 1:1–2 `aIndices: [0,1]` ↔ `bIndices: [3,2]` and Gen 1:26–28 `aIndices: [116..123]` ↔ `bIndices: [13..8]`), `raw_score: 8.08`, **`p_null: 0.1538` (`evidence_bits: 0`)**.
- **Gen 1:1–2:3 → Isa 24:1–12 (48 clauses):** `arc_kind: "mirror_inversion"`, `raw_score: 3.49`, **`p_null: 0.7077` (`evidence_bits: 0`)**.
- **Jer 4:23–26 → Isa 24:1–12:** `arc_kind: "mirror_inversion"`, `raw_score: 2.63`, **`p_null: 0.3538` (`evidence_bits: 0`)**.
- **Analytical takeaway:** While Genesis 1 → Jeremiah 4:23–26 exhibits a real *thematic/conceptual* mirror inversion, the high `p_null` values (`0.1538–0.7077`) confirm that automated clause-predicate sequence matching alone does not establish statistical significance because Jeremiah 4 replaces Genesis 1's active creative predicates (`בָּרָא`, `עָשָׂה`, `וַיֹּאמֶר`) with visionary existential negations (`רָאִיתִי... הִנֵּה... אֵין`) and passive/intransitive collapse verbs (`נָדָדוּ`, `נִתְּצוּ`).

---

## 5. Clause Polarity Flips

- **(B) Structural Breaks in Jeremiah 4:23–26 (`sequence_parallels`):** `structural_breaks` flagged consecutive `polarity_shift` transitions across Jer 4:24 (`concept_jaccard: 0.167`), 4:25 (`0.273`), and 4:26 (`0.200`), and block 3 aligned a `POS` Genesis clause (`aIndices: [118, 119]`) against a `NEG` Jeremiah clause (`bIndices: [11]`).
- **(B) Existential vs. Verbal Negation (`clause_role_query` + `get_Passage`):**
  - In **Genesis 1:1–2:3**, creation clauses carry **positive** assertion (`הָיָה` × 27, `וַיַּרְא אֱלֹהִים... כִּי טוֹב`, `וַיְבָרֶךְ`, `וַיִּשְׁבֹּת`).
  - In **Jeremiah 4:23–26**, polarity flips twice via the **existential negator `אֵין` (`H0369`)**: `וְאֵין אוֹרָם` (4:23, negating Gen 1:3–5, 14–18) and `אֵין הָאָדָם` (4:25, negating Gen 1:26–28 and echoing the pre-creation lack in Gen 2:5 `וְאָדָם אַיִן`), paired with privative transformation (`הַכַּרְמֶל` → `הַמִּדְבָּר`).
  - In **Isaiah 24:1–12**, polarity flips via **verbal negation (`לֹא`)**, **privative verbs**, and **semantic inversion of `שָׁבַת`**: `לֹא יִשְׁתּוּ יָיִן` (24:9), `מִבּוֹא` ("from entering" / shut up, 24:10), and `שָׁבַת` (`H7673`, twice in 24:8)—inverting Gen 2:2–3's celebratory divine cessation into the cessation of human joy.
  - Running `clause_role_query` (`object: H0216, polarity: NEG` and `object: H0120, polarity: NEG`) surfaced verbal `לֹא + OBJ` negations (e.g., Job 3:16 `לֹא רָאוּ אוֹר`; Job 24:16 `לֹא יָדְעוּ אוֹר`; Isa 47:3 `וְלֹא אֶפְגַּע אָדָם`; Ezek 36:14 `לֹא תֹאכְלִי אָדָם`), demonstrating a key grammatical distinction: Jeremiah 4's decreation uses **nominal/existential `אֵין`** rather than transitive `לֹא + V + OBJ`.

---

## 6. Septuagint (LXX) Renderings & Translation Shifts

Direct inspection via `lxx_concordance` (Rahlfs 1935) and `lxx` / `literary_structure` (`compare_lxx`) reveals sharp divergence in how the LXX translators handled `תֹהוּ`/`בֹהוּ` and decreation imagery across the three corpora:

| MT Verse | MT Hebrew Form(s) | LXX Greek Rendering | Alignment / Shift Evidence (`lxx_concordance` / `lxx`) |
|---|---|---|---|
| **Genesis 1:2** | `תֹהוּ וָבֹהוּ` (`H8414`, `H0922`) | `ἀόρατος καὶ ἀκατασκεύαστος` ("invisible and unformed") | `H8414 → ἀόρατος` (`stability: 0.7544`); `H0922 → ἀκατασκεύαστος` (`stability: 0.7168`) |
| **Jeremiah 4:23** | `תֹהוּ וָבֹהוּ` (`H8414`, `H0922`); `וְאֵין אוֹרָם` | `οὐδείς` ("nothing"); `καὶ οὐκ ἦν τὰ φῶτα αὐτοῦ` | `H8414 → οὐδείς` (`stability: 0.9765`), collapsing the hendiadys into a single negative pronoun; `pronoun_person_shift` on `אוֹרָם` ("their light") → `τὰ φῶτα αὐτοῦ` ("its lights") |
| **Isaiah 24:10** | `נִשְׁבְּרָה קִרְיַת תֹּהוּ` ("broken down is the city of *tohu*") | `ἠρημώθη πᾶσα πόλις` ("every city has been laid waste") | `lexical_theological_shift` (`H7665 שָׁבַר → ἐρημόω`, `p_g_given_h: 0.0068, g_idf: 8.79`); `קִרְיַת תֹּהוּ` generalized to `πᾶσα πόλις` (dropping `תֹהוּ` lexically) |
| **Isaiah 24:1–2** | `בּוֹקֵק... וּבוֹלְקָהּ` (9 MT tokens); `כָעָם כַּכֹּהֵן...` (15 MT tokens) | Expanded Greek clauses (19 words in 24:1; 40 words in 24:2) | `length_divergence` flagged by `literary_structure` Swete comparison |
| **Isaiah 24:12** | `נִשְׁאַר בָּעִיר שַׁמָּה וּשְׁאִיָּה יֻכַּת שָׁעַר` | `καὶ καταλειφθήσονται πόλεις ἔρημοι, καὶ οἶκοι ἐγκαταλελιμμένοι ἀπολοῦνται` | LXX pluralizes (`πόλεις ἔρημοι`) and replaces "the gate is crushed" with "abandoned houses shall perish" |
| **Isaiah 34:11** | `קַו תֹהוּ וְאַבְנֵי בֹהוּ` | `σπαρτίον γεωμετρίας ἐρήμου καὶ ὀνοκένταυροι οἰκήσουσιν ἐν αὐτῇ` | Translates `תֹהוּ` contextually as `γεωμετρίας ἐρήμου` and mythologizes `אַבְנֵי בֹהוּ` ("stones of emptiness") as `ὀνοκένταυροι` ("donkey-centaurs") |

**Key LXX Insight:** Whereas LXX **Genesis 1:2** renders `תֹהוּ וָבֹהוּ` philosophically/cosmologically (`ἀόρατος καὶ ἀκατασκεύαστος`), **LXX Jeremiah 4:23** strips the Gen 1 lexical echo (`οὐδείς`) and converts "their [the heavens'] light" into "its [heaven's] lights" (`τὰ φῶτα αὐτοῦ`), while **LXX Isaiah 24:10** neutralizes `קִרְיַת תֹּהוּ` into `πᾶσα πόλις` (`ἠρημώθη`). Consequently, the MT's overt `תֹהוּ`/`בֹהוּ` intertextual thread linking Gen 1:2, Jer 4:23, Isa 24:10, and Isa 34:11 is largely **obscured in the Greek Septuagint**.

---

## 7. Intermediate Prophetic & Canonical Bridges

Tool-driven retrieval (`set_combine` BMW bitsets, `get_Passage`, and `follow_connectionchain`) identified and verified the following concrete textual bridges linking Genesis 1, Jeremiah 4:23–26, and Isaiah 24:1–12:

1. **Genesis 7:23 & 6:7 (Flood Decreation — Narrative Pivot):**
   - `set_combine(include=[H0776, H5775, H8064, H0120])` returned **only 3 verses** in the entire OT: **Genesis 1:26**, **Genesis 7:23**, and **Ezekiel 38:20**. Gen 7:23 reverses Gen 1:26's fauna list (`אָדָם`, `בְּהֵמָה`, `רֶמֶשׂ`, `עוֹף הַשָּׁמַיִם`) under `וַיִּמַח` ("wiped out from the earth"). **Genesis 6:7** is directly cross-referenced from **Zephaniah 1:3** (`r11:xref:22907:145`).
2. **Hosea 4:3 (Northern Prophetic Bridge to Isa 24:4 & Jer 4:25):**
   - `עַל כֵּן תֶּאֱבַל הָאָרֶץ וְאֻמְלַל כָּל יוֹשֵׁב בָּהּ בְּחַיַּת הַשָּׂדֶה וּבְעוֹף הַשָּׁמָיִם וְגַם דְּגֵי הַיָּם יֵאָסֵפוּ`.
   - Shares the exact mourning/languishing verb pair `אָבַל (H0056)` + `אָמַל (H0535)` with **Isaiah 24:4** (`r13:wp:H0535:H0056`, `e_perp: 14.37 bits, p_null: 0.0000472`), links to **Jeremiah 12:4** (`r11:xref:22253:19370`, `e_perp: 13.28 bits`), **Ezekiel 38:20** (`r11:xref:22253:21562`, `e_perp: 13.24 bits`), and **Zephaniah 1:3** (`r11:xref:22907:22253`).
3. **Zephaniah 1:2–3 (Judahite Prophetic Bridge Reversing Gen 1:20–27):**
   - `אָסֵף אָדָם וּבְהֵמָה אָסֵף עוֹף הַשָּׁמַיִם וּדְגֵי הַיָּם... וְהִכְרַתִּי אֶת הָאָדָם מֵעַל פְּנֵי הָאֲדָמָה`.
   - Preserves the `אָדָם ↔ הָאֲדָמָה` wordplay from Gen 2:5, 7 (`fam:wp:onom:hbo:22907:2:hbo:22906:6`) while reversing Day 6 → Day 5 creation order and cross-referencing Gen 6:7 and Hos 4:3.
4. **Isaiah 33:9 & 34:11 (Intra-Isaianic Bridges):**
   - **Isaiah 33:9** (`set_combine` `H0056+H0776`) combines Isa 24:4's `אָבַל אֻמְלְלָה אָרֶץ` with Jer 4:26's devastated `כַּרְמֶל` ("Sharon is like a desert, and Bashan and Carmel are stripped bare").
   - **Isaiah 34:11** (`occurrences` `H0922`, `v3:bmw:18431`) is the sole third attestation of `תֹהוּ` + `בֹהוּ` (`קַו תֹהוּ וְאַבְנֵי בֹהוּ`), bridging Gen 1:2 and Jer 4:23 into Isaianic judgment of an uninhabitable city/land (cf. Isa 24:10 `קִרְיַת תֹּהוּ`).
5. **Jeremiah 4:28 & 19:7; Nahum 1:5 & 2:10; Ezekiel 38:20 (Theophanic & Emptying Bridges):**
   - **Jeremiah 4:28** (`set_combine` `H0056+H0776`) immediately follows Jer 4:23–26 (`תֶּאֱבַל הָאָרֶץ`), linking Jeremiah's *tohu wabohu* vision directly into the `אָבַל הָאָרֶץ` motif of Hos 4:3 and Isa 24:4.
   - **Nahum 1:5** (`set_combine` `H7493+H2022`) shares `הָרִים רָעֲשׁוּ... וְהַגְּבָעוֹת` with Jer 4:24, while **Nahum 2:10** (`r11:xref:18213:22826`) shares the rare `בקק/בלק` emptying pair with **Isaiah 24:1**.
   - **Ezekiel 38:20** (`v3:bmw:21562`) unites Gen 1:26 / Hos 4:3 / Zeph 1:3's fourfold creature list with Jer 4:24's `רָעַשׁ` and Jer 4:26's `מִפְּנֵי` ("will shake at my presence, and the mountains will be thrown down").
   - **Jeremiah 19:7** (`v3:bmw:19531`: `H1238 בקק`, `H6440 פָּנֶה`, `H0776 אֶרֶץ`) and **Isaiah 6:11–12** (`r11:xref:18213:17897`) connect Isa 24:1's emptying motif to prophetic Judahite/urban desolation.

---

## 8. System Evaluation (8 Questions)

1. **How clear and useful were `get_prompt` and the tool schemas for guiding progressive discovery?**  
   `get_prompt` (v2.0.0) gave an accurate, concise map of the 7-tool surface, epistemic layers, and negative-control rules. However, two parameter mismatches caused friction: (a) `set_combine` `refs[]` enforces `<=6` items (not stated in `get_prompt`) and rejected standard full book names (`"Jeremiah 4:27"`) as `invalid_reference` even though `get_Passage` accepts them; and (b) `wordplay_scan` treated `a`/`b` passage strings as single-word tokens rather than passage ranges, and `trace_evidence` reported `from`/`to` passage strings as unresolved concepts.

2. **Did progressive disclosure (`view="clues"`) keep payloads compact and actionable?**  
   On `get_Passage` (Jer 4:23–26: 7.8 KB; Isa 24:1–12: 7.4 KB; Hos 4:3: 6.2 KB) and `follow_connectionchain` (5.4 KB), `view="clues"` worked very well. However, passing `compact=true` alongside `view="clues"` on `Zephaniah 1:2–3` counter-intuitively bloated the payload to 23.7 KB by returning full `literary_structure` and per-token `words` arrays. Furthermore, `research` ops like `lxx_concordance`, `lxx`, `literary_structure`, and `trace_evidence` ignore `view="clues"` compactness when batched, producing 41–108 KB payloads that truncate in CLI previews.

3. **How well did the tools support original-language lexical, morphological, and polarity analysis?**  
   Hebrew tokenization, Strong's IDs, lemma keys, and `occurrences` book distributions (`H0922` = 3 verses; `H8414` = 20 verses across 7 books) were exact and reliable. `clause_role_query` provided rich Macula-aligned predicate/slot/polarity structures, though searching `object="H0216", polarity="NEG"` only matched verbal `לֹא + V + OBJ` clauses (e.g., Job 3:16) and missed nominal/existential negation with `אֵין` (`H0369`, Jer 4:23, 25). Adding an explicit existential-negation or passage-scoped polarity view would directly strengthen this workflow.

4. **How effective were structural detection (`literary_structure`), sequence alignment (`sequence_parallels`), and paronomasia (`wordplay_scan`)?**  
   Very strong for transparent, falsifiable analysis. `literary_structure` accurately identified Jer 4:23–26's 4-fold `רָאִיתִי` anaphora (`mdl_savings_bits: 10.8`) and Isa 24:1–12's `שָׁאַר` thematic frame. `wordplay_scan(passage="Isaiah 24:1-12")` surfaced genuine assonance/paronomasia (`תִּבּוֹק/תִּבּוֹז`, `אָבְלָה/נָבְלָה`, `צְוָחָה/בַּחוּצוֹת`). Most commendably, `sequence_parallels` reported `mirror_inversion` alongside honest `p_null` values (`0.1538`, `0.3538`, `0.7077`), preventing overclaiming statistical significance where inversion is thematic rather than predicate-verbatim.

5. **How accurate and insightful were the Septuagint (`lxx_concordance`, `lxx`, `compare_lxx`) capabilities?**  
   `lxx_concordance` was a standout v3 feature: it exposed exact MT↔Rahlfs token links with stability scores and typed shifts (`pronoun_person_shift` in Jer 4:23; `lexical_theological_shift` in Isa 24:10 `נִשְׁבְּרָה → ἠρημώθη`), while `literary_structure(compare_lxx=true)` flagged Swete word-count expansions in Isa 24:1–2. Its main weakness is verbosity—even 2–3 verses emit 8–18 KB of per-token metadata; a `view="clues"` summary mode listing only `shifts` and key content-lemma pairs would cut payload size by ~80%.

6. **How effective were multi-hop and bridge-finding tools (`set_combine`, `expand_clue`, `trace_evidence`, `follow_connectionchain`)?**  
   `set_combine` with `include[]` BMW bitsets was extraordinary for hypothesis-free bridge discovery—surfacing the exact 3-verse intersection (`Gen 1:26`, `Gen 7:23`, `Ezek 38:20`) and `אָבַל + אֶרֶץ` / `רָעַשׁ + הַר` prophetic networks in 3–5 seconds. `follow_connectionchain` cleanly yielded `Isa 45:18` and `Isa 34:11` in 5.4 KB. Conversely, `set_combine(refs=[...])` failed on full book names, and `trace_evidence` returned an overly heavy 100+ KB graph when paired with `expand_clue`.

7. **How well did the server enforce epistemic discipline and negative-control humility?**  
   Exemplary. Every clue distinguished `direct_textual_evidence` (Tier 2), `documented_collocation_or_cooccurrence` / `orthographic_similarity_only` (Tier 3), and `editorial_cross_reference` (Tier 4, explicitly warning that OpenBible/CrossReferences.org does not prove ancient textual dependence). Low-information orthographic pairs (e.g., `אוֹר ↔ אֶרֶץ`, `e_perp: 0.45 bits, p_null: 0.731`) and homograph ambiguity (`הִנֵּה` vs. `הֵנָּה`) were transparently flagged.

8. **What were the main reliability, latency, or UX bottlenecks, and top recommended fixes?**  
   - **Latency:** Average latency was ~6.1s, with `Gen 1:1–2:3` (12.2s), `Isa 24:1–12` (11.4s), and `lxx_concordance` batches (12.3s) exceeding 10s.  
   - **Top Fixes:**  
     1. Normalize `set_combine.refs[]` with the same parser used by `get_Passage` (so `"Jeremiah 4:27"` works) and document the 6-ref cap in `get_prompt`.  
     2. Ensure `view="clues"` compresses `lxx_concordance`, `clause_role_query`, and `trace_evidence` responses (e.g., shifts-only / summary-only projections) and prevent `compact=true` from expanding `get_Passage` clues into full `literary_structure` payloads.  
     3. Support passage-scoped `polarity` queries (including nominal/existential `אֵין` `H0369` negations) in `clause_role_query`, and clarify `a`/`b` vs. `passage` inputs for `wordplay_scan` and `trace_evidence`.
