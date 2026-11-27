# Biblical Research Report (Live MCP Evaluation — B6): Elisha Healing Jericho's Waters (2 Kings 2:19–22)

**Research Target:** `2 Kings 2:19–22` (Elisha healing Jericho's spring with salt in a new jar)  
**Mode:** Blind independent research using the live BibleResearch MCP (`live_B6`, 12 research tool calls + 2 initial contract-discovery calls)  
**Log File:** `research/v3/baseline/live_B6.jsonl`

---

## Executive Overview

At first glance, `2 Kings 2:19–22` appears to be a brief prophetic wonder story at the inauguration of Elisha's ministry. When interrogated across original-language morphology, syntactic argument structures, Septuagint (LXX) lexical bridges, and canonical bridge passages, however, the pericope emerges as a **compressed hinge** linking five major biblical trajectories:

1. **The Jericho Curse & Child-Loss Arc:** `Joshua 6:26` → `1 Kings 16:34` → `2 Kings 2:19–22` → `2 Kings 2:23–24` (via `שָׁכַל` H7921 / LXX `ἀτεκνουμένη`, and the Bethelite/Bethel itinerary in `Joshua 16:1`).
2. **The Marah Water-Healing & Prophetic Antidote Arc:** `Exodus 15:25–26` → `2 Kings 2:19–22` → `2 Kings 4:38–41` → `2 Kings 6:6` (via `שָׁלַךְ` H7993 + `מַיִם` H4325 + `רָפָא` H7495 + `מָוֶת` H4194).
3. **The Sacrificial Salt-Covenant & Altar-Consecration Arc:** `Leviticus 2:13` / `Exodus 30:35` / `Numbers 18:19` / `2 Chronicles 13:5` → `2 Kings 2:20–21` → `Ezekiel 43:24` (the **only two passages** in the Hebrew Bible where salt `מֶלַח` H4417 is the grammatical direct object of `שָׁלַךְ` H7993, "to throw/cast") → `Mark 9:49–50`.
4. **The Jordan–Arabah–Salt Sea Eschatological Healing Arc:** `Joshua 3:16` ("Salt Sea" opposite Jericho) / `Psalm 107:33–35` (`מוֹצָאֵי מַיִם` + `מְלֵחָה` H4420) → `2 Kings 2:19–22` (`מוֹצָא הַמַּיִם`) → `Ezekiel 47:8–11` (the **only other OT passage** where `מַיִם` H4325 are healed `רָפָא` H7495, explicitly reversing the Dead/Salt Sea while reserving its marshes `לְמֶלַח`) → `Zechariah 14:8` / `Revelation 21:4; 22:1–2`.
5. **The New-Vessel / LXX Water-Jar (`ὑδρίσκη` / `ὑδρία`) Bridge:** `2 Kings 2:20` (`צְלֹחִית חֲדָשָׁה` H6746 + H2319; H6746 is an OT hapax derived from `צָלַח` H6743, rendered `ὑδρίσκην καινήν` in Swete LXX and indexed under `ὑδρία` G5201) ↔ `1 Kings 17:12–16` / `1 Kings 18:33–34` (Elijah's `כַּד` H3537 = LXX `ὑδρία`) ↔ `John 2:6–9` (`ὑδρίαι` for purification, water transformed at Cana).

---

## 1. Key Findings by Epistemic Register

### (A) Attested Textual & Original-Language Evidence

1. **Exact Hebrew Text & Token Inventory of `2 Kings 2:19–22` (STEP/MACULA WLC):**
   - **2 Kings 2:19 (verse_id 9571):** `אַנְשֵׁ֤י הָעִיר֙` (`H0582` + `H5892`), `מוֹשַׁ֤ב הָעִיר֙ ט֔וֹב` (`H4186` + `H5892` + `H2896`), `וְהַמַּ֥יִם רָעִ֖ים` (`H4325` + `H7451`), `וְהָאָ֥רֶץ מְשַׁכָּֽלֶת` (`H0776` + `H7921`, Piel participle fem. sg. `HVprfsa`, "causing abortions / miscarrying / bereaving of children").
   - **2 Kings 2:20 (verse_id 9572):** `צְלֹחִ֣ית חֲדָשָׁ֔ה` (`H6746`, fem. sg. noun, *hapax legomenon*, + `H2319`, adj. fem. sg. "new"), `וְשִׂ֥ימוּ שָׁ֖ם מֶ֑לַח` (`H7760` + `H8033` + `H4417`).
   - **2 Kings 2:21 (verse_id 9573):** `וַיֵּצֵא֙ אֶל־ מוֹצָ֣א הַמַּ֔יִם` (`H3318` + `H4161` + `H4325`), `וַיַּשְׁלֶךְ־ שָׁ֖ם מֶ֑לַח` (`H7993` Hiphil wayyiqtol + `H8033` + `H4417`), `רִפִּ֙אתִי֙ לַמַּ֣יִם הָאֵ֔לֶּה` (`H7495` Piel perfect 1cs `HVpp1cs`), `לֹֽא־ יִהְיֶ֥ה מִשָּׁ֛ם ע֖וֹד מָ֥וֶת וּמְשַׁכָּֽלֶת` (`H4194` "death" + `H7921` "miscarriage/bereavement").
   - **2 Kings 2:22 (verse_id 9574):** `וַיֵּרָפ֣וּ הַמַּ֔יִם` (`H7495` Niphal wayyiqtol 3mp `Hc/VNw3mp`), `עַ֖ד הַיּ֣וֹם הַזֶּ֑ה כִּדְבַ֥ר אֱלִישָׁ֖ע אֲשֶׁ֥ר דִּבֵּֽר`.

2. **Corpus Uniqueness & Exhaustive Distribution Facts (Verified via `research`):**
   - **`צְלֹחִית` (`H6746`) is a strict biblical hapax legomenon** (`total_verses: 1`, `2 Kings 2:20`).
   - **`מוֹשָׁב` (`H4186`) + `טוֹב` (`H2896`) within the same verse** (`window: 0`) occurs **only once** in the Hebrew Bible: `2 Kings 2:19` (`total_matches: 1`).
   - **Waters (`מַיִם`, `H4325`) explicitly healed (`רָפָא`, `H7495`)**: An exhaustive intersection (`window: 1`) across the entire OT yields only **two** water-healing scenes: `2 Kings 2:21–22` (Jericho's spring) and `Ezekiel 47:8–11` (Dead/Salt Sea healed by the Temple river, while its swamps/marshes are *not* healed `לֹא יֵרָפְאוּ`, given over `לְמֶלַח`). The only adjacent poetic/Torah hits are `Exodus 15:26` ("I am YHWH your healer" immediately following Marah's waters in `15:25`) and `Jeremiah 15:18` (an unhealed wound compared to failing waters).
   - **Salt (`מֶלַח`, `H4417`) as direct object of "throw/cast" (`שָׁלַךְ`, `H7993`)**: MACULA syntactic dependency data attests this exact construction **only twice** in the OT: **`2 Kings 2:21`** (Elisha throwing salt into the spring) and **`Ezekiel 43:24`** (the priests casting salt `וְהִשְׁלִיכוּ... מֶלַח` upon the burnt offering at the consecration of Ezekiel's Temple altar).
   - **"The waters of Jericho" (`מֵי יְרִיחוֹ`)**: Exhaustive intersection of `יְרִיחוֹ` (`H3405`) + `מַיִם` (`H4325`) surfaces **`Joshua 16:1`**, which names `מֵי יְרִיחוֹ` explicitly along the Ephraim/Joseph border running *from the Jordan at Jericho, at the waters of Jericho, going up from Jericho through the hill country to Bethel* (`בֵּית־אֵל`)—the exact geographic itinerary Elisha traverses in `2 Kings 2:14–23`! It also surfaces `Joshua 3:16`, where the Jordan waters cut off down to `יָם הַמֶּלַח` (the Salt Sea) *opposite Jericho* (`נֶגֶד יְרִיחוֹ`).
   - **Attested NT Textual Detail (`Mark 9:49–50`, NA28):** NA28 Greek reads `πᾶς γὰρ πυρὶ ἁλισθήσεται` in `Mark 9:49` (without the longer Byzantine/WEB clause "and every sacrifice will be seasoned with salt"), followed by `ἅλας` (`G0217`) / `ἄναλος` (`G0358`, NT hapax) / `ἅλα` in `9:50`. Meanwhile, **`ἁλυκός` (`G0252`, "salty") is a NT hapax legomenon** in `James 3:12` (`οὔτε ἁλυκὸν γλυκὺ ποιῆσαι ὕδωρ`).

---

### (B) Linguistic, Grammatical, Etymological, and LXX Bridges

1. **Root Family of `צְלֹחִית` (`H6746`):**
   - `get_Word` documents `צְלֹחִית` (`H6746`) as derived from root anchor `צָלַח` (`H6743`).
   - Crucially, `H6743` (`צָלַח`, 64 verses) spans two striking semantic spheres directly adjacent to `2 Kings 2`:
     1. **Fording/rushing across the Jordan** (`וְצָלְחוּ הַיַּרְדֵּן`, `2 Samuel 19:17` [MT `19:18`]) and the **Spirit of YHWH rushing** (`וַתִּצְלַח ר֣וּחַ יְהוָה`) upon Samson (`Judges 14:6, 19; 15:14`), Saul (`1 Samuel 10:6, 10; 11:6`), and David (`1 Samuel 16:13`). Elisha has *just* crossed the Jordan (`2 Kings 2:14`) with Elijah's spirit resting on him (`2:15`).
     2. **Water-outlet engineering / prosperity:** `2 Chronicles 32:30` pairs `מוֹצָא מֵימֵי גִיחוֹן` (Hezekiah redirecting the **outlet of the waters** of Gihon) with `וַיַּצְלַח` (`H6743`).
   - Related vessel noun `צַלַּחַת` (`H6747`, 2 verses: `2 Kings 21:13` wiping Jerusalem like a dish; `Proverbs 26:15` sluggard's hand in the dish) shares the same consonantal root (`צלח`), though `get_Word` for `H6746` did not list `H6747` as a relative.

2. **LXX Cross-Language Bridge (`ὑδρίσκη` vs. `ὑδρία` `G5201`):**
   - In `research` (`lxx compare` on `2 Kings 2:19–22`), Swete LXX (`Regnorum IV 2:20`) renders `צְלֹחִית חֲדָשָׁה` as **`ὑδρίσκην καινὴν`** (diminutive of `ὑδρία`, "small water-jar/flask").
   - In `get_Passage` and `get_Word`, STEP/LXX alignment aggregates `H6746` under **`ὑδρία` (`G5201`)** (which in `Regnorum III 18:34` = `1 Kings 18:33–34` renders Elijah's `כַּד` `H3537`, "Fill four `ὑδρίας` with water" — `Λάβετέ μοι τέσσαρας ὑδρίας ὕδατος`, matching Elisha's `λάβετέ μοι ὑδρίσκην καινὴν` in `2 Kings 2:20`!).
   - In the NT, `ὑδρία` (`G5201`) occurs **exclusively in John's Gospel** (3 verses: `John 2:6, 7` stone water jars for Jewish purification filled with water and transformed into wine; `John 4:28` the Samaritan woman leaving her water jar at Jacob's well).

3. **LXX Rendering of `מְשַׁכָּלֶת` (`H7921`) and `מוֹצָא` (`H4161`):**
   - In `Regnorum IV 2:19, 21`, the LXX renders `מְשַׁכָּלֶת` (`H7921`, Piel fem. ptc. of `שׁכל`) with **`ἀτεκνουμένη`** ("being made childless"), preserving the human-progeny sense ("bereaving of children") rather than generic agricultural sterility—tightening the verbal link to child-loss curses (`Joshua 6:26`; `1 Kings 16:34`; `Exodus 23:26`; `Hosea 9:14`).
   - `מוֹצָא` (`H4161`) in `2:21` is rendered `διέξοδον τῶν ὑδάτων` ("outlet/channel of the waters").

4. **Salt Lexical Network (`מֶלַח` `H4417`, `מָלַח` `H4414`, `מְלֵחָה` `H4420`, and Spelling Siblings):**
   - **`מֶלַח` (`H4417`, 26v)** is rendered in LXX by `ἅλς` (`G0251`, 13x including `2 Kings 2:20–21` `ἄλα`), `ἁλυκός` (`G0252`, 4x), and `ἅλας` (`G0217`, 3x: `Leviticus 2:13`, `Judges 9:45`, `Ezekiel 47:11`).
   - **Verbal root `מָלַח` (`H4414`, 4v)** appears in two seemingly opposite senses documented under the same Strong's ID:
     - Denominative *"to salt / season / rub with salt"*: `Exodus 30:35` (holy incense `מְמֻלָּח` pure and holy), `Leviticus 2:13` (grain offering salted `תִּמְלָח`), and **`Ezekiel 16:4`** (newborn infant Jerusalem: "you were not washed in water... nor salted at all" `וְהָמְלֵחַ לֹא הֻמְלַחַתְּ`).
     - Verb *"to dissipate / vanish like smoke"*: `Isaiah 51:6` (`כֶּעָשָׁן נִמְלָחוּ`).
   - **Feminine noun `מְלֵחָה` (`H4420`, 3v)** = "saltiness / salt waste": `Job 39:6`, **`Psalm 107:34`** (turning a fruitful land `לִמְלֵחָה` between two verses using `מֹצָאֵי מַיִם`!), and `Jeremiah 17:6` (`אֶרֶץ מְלֵחָה`).
   - **Distinct consonantal homographs/siblings (orthographic overlap only, NOT shared etymology):** `H4415` Aramaic *to eat salt* (`Ezra 4:14`), `H4416` Aramaic *salt*, `H4418` *rag/worn-out cloth* (`Jeremiah 38:11–12`), `H4419` *mariner/sailor* (`Jonah 1:5`, `Ezekiel 27`).

5. **Syntactic & Grammatical Parallels:**
   - `2 Kings 2:20–21` exhibits an internal **command–fulfillment frame** (`literary_structure`): `קְחוּ־לִי` → `וַיִּקְחוּ` (`H3947`), and `וְשִׂ֥ימוּ שָׁ֖ם מֶ֑לַח` → `וַיַּשְׁלֶךְ־שָׁ֖ם מֶ֑לַח` (`H8033` + `H4417`). Notice the subtle escalation in fulfillment: Elisha commands them to *"put"* (`שִׂים` H7760) salt in the new jar, and he himself *"throws/casts"* (`שָׁלַךְ` H7993) salt into the outlet of the waters.
   - Only `Exodus 15:25`, `2 Kings 2:21`, and `2 Kings 4:41` (`וַיַּשְׁלֵךְ`, H7993) feature a prophet casting a counter-agent into water or a pot to remove harm/death (`מָוֶת`, `דָּבָר רָע`).

---

### (C) Rhetorical, Structural Parallels & Intermediate Bridge Passages

1. **Immediate Narrative Frame & Geographical/Moral Inversion (`1 Kings 16:34` → `2 Kings 2:14–25`):**
   - **Bridge 1: `Joshua 6:26` → `1 Kings 16:34` → `2 Kings 2:19–24`.** Joshua cursed Jericho so its rebuilder would lose his firstborn and youngest son (`Joshua 6:26`). `1 Kings 16:34` records that **Hiel the Bethelite** (`בֵּית הָאֱלִי` `H1017`) rebuilt Jericho at the cost of Abiram and Segub, *according to YHWH's word through Joshua* (`כִּדְבַר יְהוָה אֲשֶׁר דִּבֶּר`, cf. `2 Kings 2:22` `כִּדְבַר אֱלִישָׁע אֲשֶׁר דִּבֵּר`!). Thus, when Elisha arrives at Jericho immediately after crossing the Jordan (`2 Kings 2:14–18`), the city is pleasant in location (`מוֹשַׁב הָעִיר טוֹב`) yet still under the shadow of child-loss (`מְשַׁכָּלֶת`). Elisha heals Jericho's spring—ending death and childlessness there—and then immediately walks up the exact `Joshua 16:1` corridor (`2:23`) **from Jericho to Bethel** (`בֵּית־אֵל` `H1008`, Hiel's hometown!), where mocking youths are cursed and forty-two are mauled (`2:24`). Literary structure analysis (`lit_2kgs2`) highlights the proximate metathesis linking `2:23` and `2:24`: **`הָעִיר`** ("the city") ↔ **`הַיַּעַר`** ("the forest") and **`מִשָּׁם`** ("from there") ↔ **`בְּשֵׁם`** ("in the name of").

2. **The Moses–Marah Antitype (`Exodus 15:22–26`):**
   - `Exodus 15:25–26` is the structural archetype: bad/bitter water at the start of Israel's wilderness journey → prophet acts at YHWH's direction → throws (`וַיַּשְׁלֵךְ` `H7993`) a counter-agent (wood `עֵץ`) into `הַמַּיִם` → waters change → YHWH declares `אֲנִי יְהוָה רֹפְאֶךָ` ("I am YHWH your healer", `H7495`).
   - Notice the **covenantal test** at Marah (`שָׁם שָׂם לוֹ חֹק וּמִשְׁפָּט וְשָׁם נִסָּהוּ`, `15:25`) and the promise in `15:26` to withhold Egypt's diseases. `2 Kings 2:21` echoes both `שָׁלַךְ` (`H7993`), `מַיִם` (`H4325`), and `רָפָא` (`H7495`, now spoken directly as `כֹּה־אָמַר יְהוָה רִפִּאתִי לַמַּיִם הָאֵלֶּה`).

3. **Elisha's Own Doublet (`2 Kings 4:38–41`) & (`2 Kings 6:6`):**
   - In `2 Kings 4:38–41` (at Gilgal, just east of Jericho per `Joshua 4:19`), the sons of the prophets cry `מָוֶת בַּסִּיר` ("death in the pot", `H4194`), Elisha commands `קְחוּ־קֶמַח` ("bring meal", `H3947`), throws (`וַיַּשְׁלֵךְ` `H7993`) it into the pot, and `וְלֹא הָיָה דָּבָר רָע בַּסִּיר` ("there was nothing harmful/bad in the pot", `H7451`). This mirrors `2 Kings 2:19–21` word-for-word in micro-structure: `רַע`/`מָוֶת` → `קְחוּ` (household substance in a vessel) → `וַיַּשְׁלֵךְ` → `לֹא יִהְיֶה עוֹד מָוֶת` / `לֹא הָיָה דָּבָר רָע`.

4. **Ritual Parallels for "New" (`חָדָשׁ` `H2319`) + Salt (`מֶלַח` `H4417`):**
   - `H2319` (`חָדָשׁ`) in ritual/prophetic symbolic actions modifies objects set apart from prior profane or cursed use: `Leviticus 23:16` & `Numbers 28:26` (`מִנְחָה חֲדָשָׁה`, new grain offering—which by `Leviticus 2:13` *must* be seasoned with `מֶלַח בְּרִית אֱלֹהֶיךָ`); `1 Samuel 6:7` / `2 Samuel 6:3` / `1 Chronicles 13:7` (`עֲגָלָה חֲדָשָׁה`, new cart for the Ark); `1 Kings 11:29–30` (`שַׂלְמָה חֲדָשָׁה`, Ahijah's new garment); `2 Kings 2:20` (`צְלֹחִית חֲדָשָׁה`, new jar); and `Ezekiel 18:31` (cast away [`הַשְׁלִיכוּ` `H7993`] transgressions and make `לֵב חָדָשׁ וְרוּחַ חֲדָשָׁה`).
   - **The Ezekiel Bridge (`Ezekiel 16:4` → `Ezekiel 43:24` → `Ezekiel 47:8–11`):**
     - `Ezekiel 16:4` links newborn life/cleansing with **water + salting** (`בְּמַיִם... וְהָמְלֵחַ לֹא הֻמְלַחַתְּ`).
     - `Ezekiel 43:24` is the **only other verse** where priests *throw salt* (`וְהִשְׁלִיכוּ... מֶלַח`, `H7993` + `H4417`)—here onto the altar consecration offering before YHWH's glory fills the sanctuary.
     - `Ezekiel 47:8–11` completes the Jordan–Jericho–Arabah trajectory: waters issue (`יוֹצְאִים`, `H3318`) from the Temple eastward down into the Arabah (`הָעֲרָבָה`) to the Salt Sea (`יָם הַמֶּלַח`), and **the waters are healed** (`וְנִרְפּוּ הַמָּיִם` / `וְיֵרָפְאוּ`, `H7495` + `H4325`), bringing abundant life—while its marshes/swamps (`בִּצֹּאתָיו וּגְבָאָיו`) are left unhealed, explicitly *"given up to salt"* (`לְמֶלַח נִתָּנוּ`, `47:11`)!
     - Thus **Jericho's healed spring (`2 Kings 2:21–22`) stands as a local prophetic anticipation of Ezekiel's Temple river (`Ezekiel 47:8–11`)**, and both share an intermediate lexical/editorial bridge to `James 3:11–12` ("no salt spring `ἁλυκόν` can yield fresh water") and `Revelation 21:4; 22:1–2` ("no more death" + river of water of life + healing leaves).

5. **`מוֹצָא הַמַּיִם` ("Outlet/Spring of Waters") Covenant-Reversal Motif:**
   - `Psalm 107:33–35` uses `מוֹצָאֵי מַיִם` (`H4161` + `H4325`) twice to frame a covenantal reversal: God turns `מוֹצָאֵי מַיִם` into thirsty ground and a fruitful land into a **salt waste** (`לִמְלֵחָה` `H4420`, `107:34`), and conversely turns desert into `מוֹצָאֵי מָיִם` (`107:35`, echoed in `Isaiah 41:18` and `Isaiah 58:11`). In `2 Kings 2:21`, Elisha goes directly to `מוֹצָא הַמַּיִם` and uses `מֶלַח` to reverse the curse into fertility.

6. **New Testament Bridges:**
   - `Mark 9:49–50` + `Matthew 5:13` + `Luke 14:34–35` + `Colossians 4:6`: Salt as covenantal/sacrificial purity (`Lev 2:13`, `Ezek 43:24`), peace (`Mark 9:50`), and speech (`Col 4:6`). Conversely, tasteless salt is **thrown out** (`βληθὲν ἔξω` / `ἔξω βάλλουσιν`).
   - `James 3:11–12`: Contrasts a single spring (`πηγή`) yielding sweet and bitter/salty (`ἁλυκόν` `G0252`) water.
   - `Revelation 8:10–11`: Inverse of Marah and Jericho—the star Wormwood falls on `τὰς πηγὰς τῶν ὑδάτων`, turning waters bitter and causing many to die (`ἀπέθανον`).
   - `John 2:6–9`: Six stone `ὑδρίαι` (`G5201`, sharing the LXX vessel label with `2 Kings 2:20` / `1 Kings 18:33–34`) hold purification water transformed into abundance.

---

### (D) Physical & Real-World Analogies (Clearly Distinguished from Textual Claims)

*Note on MCP capability:* `get_Word` (`realworld=1`) returned `status: "unavailable"` for `H4417` (`מֶלַח`), and simple `biblical_def` strings (`"jar"`, `"barenness"`) for `H6746` and `H7921`. OpenEnglishWordNet (`r12:prop:H4417:G0217`) provided only taxonomic hypernym equivalence (`oewn:07829083-n` → `oewn:07825344-n`). The physical analogies below are therefore **independent scientific/historical observations** explicitly separated from attested textual claims:

1. **Hydrological & Geological Irony at Jericho:** Jericho sits in the lower Jordan Rift Valley just north of the **Dead Sea (Salt Sea)**, where hypersalinity already destroys plant and aquatic life (`Deuteronomy 29:23`; `Psalm 107:34`; `Ezekiel 47:11`). Pouring *salt*—a substance that ordinarily sterilizes soil (`Judges 9:45`) and renders water undrinkable (`James 3:12`)—into Jericho's spring in order to *heal* it and end barrenness is **physically paradoxical**. Just as Moses' branch at Marah or Elisha's flour in the poisoned stew (`2 Kings 4:41`) could not chemically detoxify a spring or toxic gourd stew in the quantity of a single jar/handful, the miracle deliberately uses a **physically counterintuitive sign** whose efficacy is explicitly attributed to the divine word (`כֹּה־אָמַר יְהוָה רִפִּאתִי...`, `2:21`; `כִּדְבַר אֱלִישָׁע`, `2:22`).
2. **Material & Ritual Analogies (New Ceramic Vessel + Salt):** In ancient Near Eastern practice, unglazed earthenware absorbs prior liquids/impurities (`Leviticus 6:28; 11:33`), so a **new jar** (`צְלֹחִית חֲדָשָׁה`) signifies an uncontaminated ritual vessel. Meanwhile, sodium chloride (`NaCl`) acts physically as an antimicrobial preservative, antiseptic wash (cf. newborn salting in `Ezekiel 16:4`), and ionic mineralizer—capable at low concentrations of stabilizing/preserving, yet at high concentrations of causing hyperosmotic death (`מְלֵחָה`).

---

### (E) Interpretive Hypotheses (With Counterexamples & Limitations)

1. **Hypothesis 1 — Covenant-Salt as Curse-Reversal Sign:** Elisha's act dramatizes the replacement of Jericho's *ban/curse* (`חֵרֶם` / `Joshua 6:26`) with YHWH's *covenant of salt* (`Leviticus 2:13`; `Numbers 18:19`; `2 Chronicles 13:5`). The "new vessel" signals a fresh cultic/prophetic mediation that reverses Hiel's cursed rebuilding (`1 Kings 16:34`), while the immediately following Bethel judgment (`2 Kings 2:23–24`) shows that the curse/blessing boundary remains active for those who reject the prophetic word.
   - *Limitations/Counterexamples:* `2 Kings 2:19–22` never uses the word `בְּרִית` (covenant) or `אָרוּר` (cursed), and `H4417` is not exclusively positive in Kings (cf. `2 Kings 14:7` Valley of Salt). Thus the covenantal-salt meaning is an **intertextual inference**, not an explicit lexical assertion inside `2 Kings 2:19–22`.

2. **Hypothesis 2 — New-Creation / Temple-Source Typology (`2 Kings 2:19–22` → `Ezekiel 47:8–11` → `Revelation 22:1–2`):** Jericho's healed `מוֹצָא הַמַּיִם` functions as a prophetic microcosm of the eschatological healing of the Jordan-Arabah-Dead Sea basin (`Ezekiel 47:8–11`), where "healing of waters" (`רפא` + `מים`) and "no more death" (`לא יהיה עוד מות`, cf. `Rev 21:4`) converge.
   - *Limitations/Counterexamples:* In `2 Kings 2`, the spring is at Jericho, not issuing from the Jerusalem Temple; and in `Ezekiel 47:11`, salt (`לְמֶלַח`) names the *unhealed* remnant marshes rather than the healing agent. The parallel is therefore **structural and lexical with inversion**, not a simple one-to-one allegory.

3. **Hypothesis 3 — Elisha's "Rushing Spirit" Vessel Wordplay (`צְלֹחִית` ↔ `צָלַח`):** Because `צְלֹחִית` (`H6746`) is a hapax from `צָלַח` (`H6743`, used of the Spirit rushing upon leaders and crossing the Jordan in `2 Samuel 19:17`), choosing `צְלֹחִית` rather than `כַּד` (`H3537`) or `צַלַּחַת` (`H6747`) may subtly echo Elisha's Jordan crossing and reception of Elijah's spirit (`2 Kings 2:14–15`).
   - *Limitations/Counterexamples:* `צְלֹחִית` may simply reflect a Northern/Iron Age dialectal term for a shallow flask/bowl; shared root does not prove intentional authorial paronomasia.

---

## 2. Exact MCP Tool Calls & Decisive Evidence Returned

*(Excluding the 2 initial schema/guideline calls `--list-tools` and `get_prompt`, 12 logged research calls were made to `live_B6`.)*

| # | Tool | Key Arguments | Latency / Payload | Decisive Evidence Returned |
|---|---|---|---|---|
| 1 | `get_Passage` | `passage: "2 Kings 2:19-22"`, `depth: 8`, `literary: 2` | 6.1s / 59.7 KB | Full WLC/WEB tokens & Strong's; `H6746` hapax flag; `H7921` (`HVprfsa`); command–fulfillment pairs (`2:20–21`); wordplays (`וַיֵּצֵא`↔`מוֹצָא`, `כִּדְבַר`↔`דִּבֵּר`, `וְשִׂימוּ`↔`שָׁם`); editorial xrefs (`James 3:12`, `Rev 8:10`, `Exod 15:25-26`, `Ezek 47:8-11`, `Josh 6:17-26`, `2 Kgs 4:41`). |
| 2 | `get_Word` | `word: "H6746"`, `passage: "2 Kings 2:20"`, `etymology: 6`, `realworld: 1`, `mode: "bridge"`, `connections: 15` | 3.8s / 14.6 KB | Confirmed `total_verses: 1`; root `צָלַח` (`H6743`); LXX bridge `ὑδρία` (`G5201`); syntactic `modifies:H2319` & `object_of:H3947`; `gematria` 538. |
| 3 | `get_Word` | `word: "H4417"`, `passage: "2 Kings 2:20"`, `etymology: 6`, `realworld: 1`, `mode: "bridge"`, `connections: 15` | 4.7s / 24.8 KB | **Decisive syntactic discovery:** `H4417` is `grammatical_object_of` `H7993` (`שָׁלַךְ`) **only 2× in OT** (`2 Kings 2:21`, `Ezekiel 43:24`); construct with `H1285` (`Num 18:19`, `2 Chr 13:5`); root relative `H4414` (`מָלַח`); OEWN `oewn:07825344-n`; `realworld` unavailable. |
| 4 | `research` (8 ops) | `occurrences` (`H4414`, `H7921`, `G5201`, `H6747`), `lxx` (`G5201`), `intersect_words` (`H7495+H4325`, `H7993+H4325`), `discover_patterns` | 4.3s / 54.5 KB | `H4414` (4v: `Exod 30:35`, `Lev 2:13`, `Isa 51:6`, `Ezek 16:4`); `H7921` (22v: `Exod 23:26`, `Hos 9:14`, `Mal 3:11`, etc.); `G5201` (3v: `John 2:6,7; 4:28`); `H7495+H4325` (`window:1`) proved **only** `2 Kings 2:21-22` & `Ezekiel 47:8-11` explicitly heal waters; `H7993+H4325` (`15v`, incl. `Exod 15:25`, `2 Kgs 2:21; 6:6`). |
| 5 | `research` (8 ops) | `passage_compare` (Exod 15 / 2 Kgs 2 / Ezek 43:24 / Ezek 47:8-11), `occurrences` (`H2319`, `H6743`), `intersect_words` (`H4417+H1285`, `H4194+H7993`), `trace_evidence` (×2), `grammar_search` | 7.1s / 225.9 KB | `H6743` (`2 Sam 19:17` crossing Jordan; `2 Chr 32:30` `מוֹצָא` Gihon; Spirit rushing); `H2319` (49v: `Lev 23:16`, `Num 28:26`, `1 Sam 6:7`, `1 Kgs 11:29-30`, `Ezek 18:31`); `H4417+H1285` surfaced `Josh 3:16` (`window:1`). *(Note: `trace_evidence` failed to resolve passage refs.)* |
| 6 | `research` (7 ops) | `passage_compare` (`Josh 6:26`, `1 Kgs 16:34`, `2 Kgs 2:23-25`, `2 Kgs 4:38-41`), `intersect_words` (`H4161+H4325`, `H4417+H4325`, `H7451+H4325`), `occurrences` (`H3537`), `lxx compare` (`2 Kgs 2:19-22`, `1 Kgs 18:33-34`) | 14.1s / 73.8 KB | Swete LXX `2 Kings 2:20` actually reads **`ὑδρίσκην καινὴν`** & `2:19,21` **`ἀτεκνουμένη`**; `1 Kings 18:34` LXX reads `ὑδρίας ὕδατος`; `1 Kings 16:34`↔`2 Kings 2:23` root link `H1017`↔`H1008` (Bethel); `H4161+H4325` (7 verse_ids). |
| 7 | `get_Connection` | `items: ["2 Kings 2:19-22", "Exodus 15:25-26", "Ezekiel 43:24", "Ezekiel 47:8-11", "Mark 9:49-50"]`, `connections: 15`, `compact: true` | 4.9s / 30.8 KB | Returned complete 5-node `cycle_network` (`6` verified edges across `H7495`, `H4417`, `H7993`, LXX `H4417↔G0217`, and editorial xrefs) + Steiner bridge `2 Kings 2:19 ↔ James 3:12 ↔ Ezekiel 47:8`. |
| 8 | `follow_connectionchain` | `next: "2 Kings 2:20"`, `limit: 10` | 1.9s / 10.5 KB | Seeded chain cleanly; surfaced `H2319` (`temple_and_sanctuary_architecture`), `H4417↔H3220`, `H4417↔H4414`, and `H6746↔H6743`. |
| 9 | `research` (7 ops) | `passage_compare` (`Ps 107:33-35`, `Isa 41:18`, `Isa 58:11`, `2 Chr 32:30`), `passage_compare` (NT salt/springs), `occurrences` (`G0251`, `G0252`, `G0233`), `sacred_architecture` (`Ezek 43:24`), `literary_structure` (`2 Kgs 2:19-25`, `compare_lxx: true`) | 3.8s / 81.4 KB | `Ps 107:34` `מְלֵחָה` framed by `מֹצָאֵי מַיִם`; NA28 `Mark 9:49` shorter text; `G0252` NT hapax (`Jas 3:12`); `2 Kgs 2:23–24` wordplay `הָעִיר`↔`הַיַּעַר`; `Ezek 47:1-12` architectural context; LXX `2 Kgs 2:24` length divergence. |
| 10 | `get_Word` | `word: "H7921"`, `passage: "2 Kings 2:19"`, `etymology: 5`, `realworld: 1`, `connections: 10` | 3.7s / 18.6 KB | Confirmed `H7921` (`שָׁכֹל`) senses, cluster distribution (22v across Torah curses, narrative, prophets), and disambiguation from `שׂכל` (`H7919`/`H7922`). |
| 11 | `research` (4 ops) | `occurrences` (`H4420`), `passage_compare` (`Lev 2:13`, `Num 18:19`, `2 Chr 13:5`, `2 Kgs 2:14-18`), `passage_compare` (`John 2:6-9`, `Zech 14:8`, `Rev 21:4`, `Rev 22:1-2`), `intersect_words` (`H3405+H4325`) | 3.6s / 53.3 KB | **Decisive geography bridge:** `Joshua 16:1` explicitly names `מֵי יְרִיחוֹ` ("waters of Jericho") on the Jericho→Bethel road; `H4420` `מְלֵחָה` exhaustive 3v (`Job 39:6`, `Ps 107:34`, `Jer 17:6`). |
| 12 | `research` (2 ops) | `passage_compare` (`Judg 9:45`, `Deut 29:23`, `Zeph 2:9`, `Col 4:6`), `intersect_words` (`H4186+H2896`) | 3.0s / 20.3 KB | Confirmed `H4186+H2896` (`מוֹשָׁב` + `טוֹב`) is unique to `2 Kings 2:19`; verified exact Hebrew/Greek witnesses for salt-judgment and `Col 4:6` (`ἅλατι ἠρτυμένος`). |

---

## 3. Discoveries Enabled by MCP vs. Independent Synthesis

- **Directly Enabled by the MCP (unlikely or impossible to verify exhaustively without corpus tooling):**
  1. **Exhaustive negative/uniqueness proofs:** `H6746` (`צְלֹחִית`) hapax status; `H4186+H2896` (`מוֹשָׁב` + `טוֹב`) uniqueness to `2 Kings 2:19`; `G0252` (`ἁλυκός`) NT hapax status; and the fact that **only `2 Kings 2:21–22` and `Ezekiel 47:8–11`** explicitly pair `רָפָא` (`H7495`) with `מַיִם` (`H4325`).
  2. **The unexpected `שָׁלַךְ` + `מֶלַח` syntactic link (`2 Kings 2:21` ↔ `Ezekiel 43:24`):** MACULA dependency indexing immediately surfaced that `Ezekiel 43:24` is the *only* other OT verse where `מֶלַח` is the direct object of `שָׁלַךְ`—a non-obvious altar-consecration bridge that standard cross-reference lists around `2 Kings 2:20–21` often miss.
  3. **The `Joshua 16:1` (`מֵי יְרִיחוֹ`) itinerary bridge** connecting the Jordan, Jericho's waters, and Bethel (`2 Kings 2:14–23`), plus the Bethelite/Bethel root link (`H1017` ↔ `H1008`) between `1 Kings 16:34` and `2 Kings 2:23`.
  4. **The Swete LXX lexical discrepancy (`ὑδρίσκην` vs. `ὑδρία` `G5201`)** and the `1 Kings 18:34` LXX parallel (`ὑδρίας ὕδατος`).
  5. **Automated `literary_structure` detections:** Command–fulfillment echoes (`2:20–21`), `וַיֵּצֵא`↔`מוֹצָא` (`2:21`), and `הָעִיר`↔`הַיַּעַר` metathesis (`2:23–24`).

- **Independent Scholarly Synthesis Required:**
  1. Connecting the **LXX `ἀτεκνουμένη` (`2 Kings 2:19, 21`)** rendering of `מְשַׁכָּלֶת` back to Hiel's child-loss in `1 Kings 16:34` / `Joshua 6:26` as the narrative problem Elisha reverses—and contrasting it with `2 Kings 2:23–24` at Bethel.
  2. Integrating `Ezekiel 16:4` (salting a newborn in water), `Ezekiel 43:24` (altar salt), and `Ezekiel 47:8–11` (Salt Sea healed) into a coherent three-stage Ezekielian trajectory.
  3. Supplying **physical, chemical, agricultural, and geological explanations** (Dead Sea proximity, soil salinization vs. antimicrobial preservation, porous ceramic absorption), since MCP `realworld` data for salt was unavailable/minimal.
  4. Filtering noisy graph paths and distinguishing genuine intertextual bridges from homographic or statistical artifacts.

---

## 4. Missing Connections, Dead Ends, and Noisy / Redundant Results

1. **Missing Capabilities / Data Gaps Observed:**
   - **`realworld` gap on key nouns:** `get_Word` (`realworld=1`) for `H4417` (`מֶלַח`, salt) returned `status: "unavailable"`, and `H6746`/`H7921` returned only 1-word glosses (`"jar"`, `"barenness"`). No physical, chemical, or archaeological properties of Dead Sea salt, Jericho's spring (Ain es-Sultan), or Iron Age vessels were provided.
   - **`geography` unresolved on `2 Kings 2:19–22`:** `get_Passage` returned `status: "symbolic_or_unresolved"` with empty `places: []`, even though Jericho is the explicit pericope setting (`2 Kings 2:15, 18`) and `מוֹשַׁב הָעִיר` refers to that city.
   - **LXX lookup limitations:** Calling `research` `op: "lxx"` with Greek lemma `G5201` (`mode: "alignments"`) returned `total_returned: 0` (`alignments: []`), meaning reverse Greek-to-Hebrew LXX concordance queries are not supported by that operation. Also, `get_Passage` / `get_Word` reported `H6746` → `ὑδρία` (`G5201`), whereas `lxx` `mode: "compare"` on Swete LXX `Regnorum IV 2:20` showed the actual surface form `ὑδρίσκην` (`ὑδρίσκη`).

2. **Investigative Dead Ends & Tool Failures:**
   - **`trace_evidence` failure on passage references:** Both `trace_evidence` calls (`from: "2 Kings 2:20"` to `"Ezekiel 47:11"` and `"Exodus 15:25"`) returned `status: "partial"` with `Unresolved or unsupported query terms: 2 kings 2 20, ezekiel 47 11` and fell back to **identical generic word-level paths** (`Exodus 28:12 → Numbers 6:27` via `שׂוּם`/`שֵׁם`, `Deut 20:5 → 2 Chr 20:5` via `חָדָשׁ`).
   - **`motsa_mayim` (`H4161+H4325`) empty `verses` array:** In Call #6, `intersect_words` returned `total_matches: 7` and `verse_ids`, but `verses: []` (empty), forcing an extra `passage_compare` call (#9) to read `Psalm 107:33–35`, `Isaiah 41:18`, `Isaiah 58:11`, and `2 Chronicles 32:30`.
   - **`G0251` (`ἅλς`) returned `0` NT occurrences** because NA28 uses `ἅλας` (`G0217`)—whereas LXX `2 Kings 2:20–21` uses `ἅλς` (`ἄλα`), creating a minor Strong's split across testaments (`G0251` vs. `G0217`).

3. **Distracting, Misleading, or Redundant Results:**
   - **Noisy high-scoring motifs/wordplays:** `get_Passage` (`2 Kings 2:19–22`) ranked `r13:motif:chain:H6555:H6556:H6557:H0776` (`פָּרַץ`/Perez/`אֶרֶץ`) at #3 (`final: 851`) and `עֶצֶם/קָבַר/קֶבֶר/אֱנוֹשׁ` at #8 (`final: 814`) merely because `2:19` contains high-frequency `אֶרֶץ` and `אֱנוֹשׁ`. Similarly, `get_Word` on `H7921` surfaced high-PMI collocation with `כַּלְנֵה` (`Calneh`, `H3641`)—likely a lemmatization/statistical artifact with `כל`/`כֻּלָּהּ`, and `H4417` had to disambiguate `Salt (Sea)` vs. `(Valley of) Salt`, while `H2319` (`חָדָשׁ`) glossed several occurrences as `"New (Gate)"` (`sense:H2319G:primary`).
   - **Verbose/redundant payload structures:** Every `mcp-bench-cli` response had `has_structured_duplicate: true` (roughly doubling wire size vs. payload), and `grammar_search` / `trace_evidence` in Call #5 inflated a single `research` response to **225.9 KB** (`471 KB` wire).

---

## 5. Self-Assessment

- **Research Depth:** High across canonical, lexical, syntactic, and LXX dimensions. Within 12 MCP calls, the investigation moved well beyond standard cross-references (`Exod 15:25`, `Ezek 47:8–11`) to uncover syntactic exclusives (`H4417` as direct object of `H7993` in `Ezek 43:24`; `H4186+H2896` unique to `2 Kgs 2:19`), the `Joshua 16:1` `מֵי יְרִיחוֹ` Jericho–Bethel itinerary, the `H4420` (`מְלֵחָה`) / `H4414` (`Ezek 16:4`) contrast, and the Swete LXX `ὑδρίσκην` vs. STEP `ὑδρία` nuance. The main remaining depth limit was not checking non-canonical Jewish/ANE comparative literature (outside corpus scope) or running `follow_connectionchain` beyond its seed step.
- **Evidence Quality:** Strong epistemic separation throughout. Every verse citation, Strong's ID, morphological code, LXX reading, and syntactic relation in Sections 1(A)–(C) was directly observed in MCP tool outputs, while physical analogies (Section 1D) and theological syntheses (Section 1E) are explicitly cordoned off with counterexamples.
- **Payload & Token Efficiency:** Moderate-to-good, with one major bottleneck. Batching 4–8 operations inside `research` kept total MCP calls to 12, and switching `passage_compare` to `detail: "compact"` kept Calls #6, #9, #11, #12 between 20–81 KB. However, Call #5 (`225.9 KB` payload / `471 KB` wire) showed that `grammar_search` and `trace_evidence` emit excessively verbose schemas, and `has_structured_duplicate: true` consistently inflates wire bytes across all tools.
- **Missing Capabilities:** (1) Physical/chemical/archaeological `realworld` data for concrete biblical substances like salt (`H4417`); (2) Passage-to-passage graph resolution in `trace_evidence` (which currently treats verse strings as unresolved tokens); (3) Reverse Greek-to-Hebrew LXX alignment search (`op: "lxx"`, `word: "G5201"`); (4) Consistent verse snippet hydration in `intersect_words` when `total_matches > 0`; and (5) Pericope-level geographic resolution for named cities like Jericho in `2 Kings 2:19–22`.
