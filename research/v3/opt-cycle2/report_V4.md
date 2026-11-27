# Intertextual & Tri-Textual Research Report (Validation Task V4)

**Prompt:** *"Analyze Ezekiel 34:1-16 alongside Zechariah 11:4-17, Micah 5:1-6, and John 10:1-18, tracing rare lexical constellations, LXX shifts, and multi-book intermediate bridges."*  
**Target MCP Server:** `local` (`--no-supabase`, `verification_release.mcp_release: 2.0.0`, Rahlfs 1935 LXX + STEPBible/MACULA MT + SBLGNT/NT)  
**Benchmark Log:** `research/v3/opt-cycle2/local_V4.jsonl` (18 logged MCP calls; 17 succeeded at transport level, 1 input-validation error; plus 1 pre-flight `--list-tools` discovery)

---

## 1. Epistemic Framework & Negative Controls

Every claim in this report is partitioned across five epistemic tiers:
- **(a) Attested Textual Evidence:** Hebrew MT lemmas/surfaces, Rahlfs 1935 LXX Greek tokens/shifts, Swete LXX excerpt (`literary_structure`), and NT Greek tokens directly observed in MCP tool outputs. *(Note on versification: Tool outputs confirm Micah 5:1–6 English = MT 4:14–5:5, e.g., Mic 5:1 = MT 4:14, Mic 5:2 = MT 5:1, Mic 5:4 = MT 5:3, Mic 5:6 = MT 5:5.)*
- **(b) Linguistic & Grammatical Relationships:** Exact Strong's co-occurrences (`intersect_words`, `set_combine`, `occurrences`), clause-role pairs (`clause_role_query`), and statistical LXX-MT shift metrics (`p_g_given_h`, `g_idf`, `sum_idf`) and NT-LXX-MT alignment classifications (`tri_textual_diff`).
- **(c) Structural & Rhetorical Parallels:** Internal literary units, symmetries, wordplays (`get_Passage`, `literary_structure`, `wordplay_scan`), and null-tested order alignments (`sequence_parallels`).
- **(d) Physical / Cultural Realia Analogies:** Pastoral implements, terrain, husbandry, and flock anatomy (`shepherd's staff`, `shepherd's pouch`, `pasture`, `fold`, `hooves/knucklebones`).
- **(e) Interpretive Hypotheses:** Diachronic dependence, deliberate prophetic reversal, or theological synthesis inferred from tiers (a)–(d), marked explicitly as interpretive.

### Upfront Negative Controls
1. **Structural Sequence Ordering (`sequence_parallels`):** All four directed pairwise runs yielded **null-consistent** ordering (`evidence_bits: 0`):
   - `Ezekiel 34:1-16 -> Zechariah 11:4-17`: `p_null: 0.6154`
   - `Ezekiel 34:1-16 -> John 10:1-18`: `p_null: 0.6923`
   - `Zechariah 11:4-17 -> John 10:1-18`: `p_null: 0.9846`
   - `Micah 5:1-6 -> John 10:1-18`: `p_null: 0.2308`
   *Implication:* The canonical connections among these four passages are **not** driven by strict linear token-sequence quotation; they operate through **clustered lexical constellations, LXX translational transformations, and intermediate prophetic/Gospel bridges**.
2. **Corpus Tagging Asymmetry (`H7462` vs. `H7473`):** `get_Word("G4166")` (`ποιμήν`) maps its Hebrew equivalents primarily to `H7473` (`רֹעִי`, 55×), whereas the OT tagger assigns pastoral participle/noun forms in Ezekiel 34, Zechariah 11, and Micah 5 to `H7462` (`רָעָה`) — and `H7462` furthermore suffers a corrupted display lemma (`בֵּית־עֵ֫קֶד הָרֹעִים`) in `get_Word` and token `lm` metadata. Consequently, `get_Word("H7462")` reports `βόσκω` (15×), `ποιμαίνω` (15×), and a homograph/secondary `γινώσκω` (4×), explaining why `get_Connection` linked `Ezekiel 34 <-> John 10` via `passage_lxx:H7462:G1097` (`γινώσκω`) rather than `ποιμήν`.

---

## 2. Exact MCP Call Log

| # | Tool | Key Arguments / Operations | Latency (ms) | Wire (B) | Payload (B) | Status / Notes |
|---:|---|---|---:|---:|---:|---|
| 0 | `tools/list` (`--list-tools`) | Schema discovery (unlogged) | 1,950 | 17,028 | 32,507 | `ok` (6 tools discovered) |
| 1 | `get_prompt` | Workflow guidance | 1,971 | 5,530 | 5,338 | `ok` |
| 2 | `get_Passage` | `Ezekiel 34:1-16`, `depth:5, literary:1, view:"clues"` | 12,372 | 10,939 | 9,725 | `ok` (16 vv, 3 units, 4 sym, 4 wordplays) |
| 3 | `get_Passage` | `Zechariah 11:4-17`, `depth:5, literary:1, view:"clues"` | 13,608 | 10,254 | 9,070 | `ok` (14 vv, 3 units, 3 sym, 4 wordplays) |
| 4 | `get_Passage` | `Micah 5:1-6`, `depth:5, literary:1, view:"clues"` | 9,306 | 8,007 | 7,041 | `ok` (6 vv; confirms Eng 5:1 = MT 4:14) |
| 5 | `get_Passage` | `John 10:1-18`, `depth:5, literary:1, view:"clues"` | 18,069 | 10,474 | 9,180 | `ok` (18 vv, 4 units, 1 sym, 4 wordplays) |
| 6 | `get_Connection` | 4 passages, `connections:20, view:"clues"` | 17,290 | 7,118 | 6,266 | `ok` (`cycle_network`, 5 edges, 6 pairs) |
| 7 | `research` (`evidence`) | 3× `lxx_concordance` (Ezek 34, Zech 11, Mic 5); 4× `tri_textual_diff` (John 10, OT ×3) | 31,349 | 208,154 | 173,232 | `ok`; silent 12-v cap truncated Ezek 34:13–16 & Zech 11:16–17; OT tri_textual returned `no_alignment` + source shifts |
| 8 | `research` (`evidence`) | 4× `sequence_parallels`; 3× `wordplay_scan`; `tri_textual_diff` (`John 10:11-18`) | 8,927 | 57,543 | 50,241 | `ok` (all `sequence_parallels` `p_null > 0.23`; `John 10:11-14` scored) |
| 9 | `research` (`clues`) | 6× `intersect_words`; `set_combine` (`H7462+H2719+H5337`); `occurrences` (`H2028`) | 7,837 | 44,323 | 41,103 | `ok` (found exact 1-, 2-, 4-, 5-, 7-, 12-verse constellations) |
| 10 | `research` (`clues`) | 4× `trace_evidence`; 4× `literary_structure` (`detail:"standard", compare_lxx:true`) | 15,446 | 587,626 | 527,508 | `ok` (Swete excerpts, clusters, speaker shifts; huge payload) |
| 11 | `follow_connectionchain` | `next:"Ezekiel 34:1-16", limit:12, view:"clues"` | 4,294 | 9,187 | 8,259 | `ok` (seeded on `34:1` `דבר יהוה`) |
| 12 | `research` (`evidence`) | 6× `lxx_concordance` (`Num 27:16-17`, `1 Sam 17:34-40`, `Jer 23:1-6`, `Ezek 34:22-25`, `Zech 13:7`, `2 Chr 18:16`); 2× `tri_textual_diff` (`Matt 2:6`, `Matt 26:31`) | 12,548 | 150,199 | 124,857 | `ok` |
| 13 | `get_Word` | `H7462`, `connections:10, etymology:3, realworld:1, view:"clues"` | 1,454 | 5,790 | 5,082 | `ok` (revealed corrupted `H7462A` lemma & `γινώσκω` tie) |
| 14 | `get_Word` | `G4166`, `connections:10, etymology:3, realworld:1, view:"clues"` | 1,813 | 4,436 | 3,834 | `ok` (maps `ποιμήν` -> `H7473`, explaining `H7462` gap) |
| 15 | `research` (`evidence`) | 3× `tri_textual_diff` (`Matt 27:9-10`, `1 Pet 2:25`, `Heb 13:20`); `clause_role_query`; 2× `occurrences` (`H1243`, `H0264`); 2× `set_combine` (`H7462+H7626`, `H7462+H0259`) | 15,769 | 53,769 | 47,043 | `ok` |
| 16 | `research` (`evidence`) | 3× `lxx_concordance` (using `ref`); `set_combine` (`H3627+H7462`); `occurrences` (`H4731`, `G4167`); 2× `tri_textual_diff` (using `ref`) | 3,392 | 19,391 | 17,865 | Partial: `set_combine` & `occurrences` `ok`; `lxx_concordance` (`not_found`) & `tri_textual_diff` (`invalid_request`) rejected `ref` in favor of `passage` |
| 17 | `research` (`evidence`) | Same + `intersect_words` with `strongs: [...]` | 1,216 | 240 | 129 | `is_error: true` (`operations.7.strongs` expects string) |
| 18 | `research` (`evidence`) | 5× `lxx_concordance` (`Ezek 34:13-16`, `Zech 11:16-17`, `Jer 19:1-6`, `Jer 25:34`, `Jer 12:3`); 2× `tri_textual_diff` (`1 Pet 5:2-4`, `Matt 9:36`); `intersect_words` (`strongs` key) | 11,083 | 118,100 | 98,528 | Ops 0–6 `ok` (recovered cut-off Ezek/Zech verses); op 7 `invalid_request` (`intersect_words` requires `words: string[]`) |

---

## 3. Graph Topology of the Four Primary Passages

Call 6 (`get_Connection`) returned `direct_link_found: true` and `all_endpoints_connected: true` via a 5-edge `cycle_network` linking all four endpoints across 6 pairs:
1. **`Ezekiel 34:1-16 <-> Zechariah 11:4-17`** via `passage_lex_bridge:H4829:H7462` (`מִרְעֶה` "pasture" <-> `רָעָה` "shepherd/feed")
2. **`Ezekiel 34:1-16 <-> Micah 5:1-6`** via `shared_lemma:H7462` (`רָעָה`)
3. **`Ezekiel 34:1-16 <-> John 10:1-18`** via `passage_lxx:H7462:G1097` (`γινώσκω`) — an artifact of `H7462` homograph overlap (`רָעָה` "associate with / know" vs. `רָעָה` "shepherd"), masking the deeper `βόσκω`/`ποίμνιον`/`νομή`/`πρόβατον` ties verified via `lxx_concordance`
4. **`Zechariah 11:4-17 <-> John 10:1-18`** via `passage_lxx:H6629:G4263` (`צֹאן` <-> `πρόβατον`)
5. **`Micah 5:1-6 <-> John 10:1-18`** via `passage_lxx:G2064:H0935` (`ἔρχομαι` <-> `בּוֹא`, cf. Mic 5:2 "come forth" / John 10:8, 10 "came / I have come")

---

## 4. Rare Lexical Constellations (Tier a & Tier b Evidence)

Exact corpus-wide queries (`intersect_words`, `set_combine`, `occurrences`, `clause_role_query`) isolate tight, non-trivial Hebrew and Greek lexical signatures uniting our four texts and a small set of canonical prophets/histories:

### A. Exclusive & Near-Exclusive Hebrew Constellations
1. **`H7462` (`רָעָה`) + `H7495` (`רָפָא`, heal) + `H7665` (`שָׁבַר`, broken/maimed)** (`intersect_words`, `window:2`):  
   - **Total OT matches: 2 verses** — **`Ezekiel 34:4`** and **`Zechariah 11:16`**.  
   - *Attested significance:* Nowhere else in the Hebrew Bible do "shepherding," "healing," and "the broken/maimed (`הַנִּשְׁבֶּרֶת`)" co-occur. Ezekiel 34:4 indicts Israel's shepherds for failing to heal (`רִפֵּאתֶם`) and bind the broken (`לַנִּשְׁבֶּרֶת`), whereas Zechariah 11:16 intentionally inverts the checklist in judgment ("the broken [`וְהַנִּשְׁבֶּרֶת`] he will *not* heal [`לֹא יְרַפֵּא`]", adding `נַעַר`/`נִכְחָדוֹת`/`נִצָּבָה`).
2. **`H7462` (`רָעָה`) + `H5080` (`נָדַח`, driven away/strayed) + `H0006` (`אָבַד`, lost/perishing)** (`intersect_words`, `window:2`):  
   - **Total OT matches: 4 verses across 2 books** — **`Jeremiah 23:2, 3`** and **`Ezekiel 34:4, 16`**.  
   - *Attested significance:* Directly establishes Jeremiah 23:1–4 as the lexical matrix behind Ezekiel 34's dual indictment (v. 4) and divine counter-shepherding pledge (v. 16).
3. **`H7462` (`רָעָה`) + `H6327` (`פוּץ`, scatter) + `H6629` (`צֹאן`, flock)** (`intersect_words`, `window:2`):  
   - **Total OT matches: 7 verses across 3 books** — **`Jeremiah 23:1, 2`**, **`Ezekiel 34:5, 6, 12, 21`**, and **`Zechariah 13:7`**.  
   - *Attested significance:* Connects the judgment oracle of Jeremiah 23 and Ezekiel 34 directly to the struck-shepherd oracle of Zechariah 13:7 (`הַךְ אֶת־הָרֹעֶה וּתְפוּצֶיןָ הַצֹּאן`), which in turn feeds Matthew 26:31 // Mark 14:27 and John 10's contrast between the hireling who lets the flock scatter (`σκορπίζει`, John 10:12) and the Good Shepherd.
4. **`H7462` (`רָעָה`) + `H2719` (`חֶרֶב`, sword) + `H5337` (`נָצַל`, rescue/deliver)** (`set_combine`, `OT`):  
   - **Total OT matches: 1 verse** — **`Micah 5:6`** (MT 5:5; `vid: 22756`).  
   - *Context:* Combines `וְרָעוּ` ("they shall shepherd" Assyria with the sword `בַּחֶרֶב`) and `וְהִצִּיל` ("he shall deliver" us from the Assyrian) — linking royal militarized shepherding in Micah 5:6 inversely with Ezekiel 34:10, 12, 27 (`וְהִצַּלְתִּי`, Yahweh delivering His sheep *from* predators/shepherds) and Zech 11:17 (`חֶרֶב`, sword upon the worthless shepherd's arm).
5. **`H3627` (`כְּלִי`, gear/equipment/vessel) + `H7462` (`רָעָה`)** (`set_combine`, `OT`):  
   - **Total OT matches: 3 verses** — **`1 Samuel 17:40`** (`בִּכְלִי הָרֹעִים`), **`Jeremiah 25:34`** (`כִּכְלִי חֶמְדָּה`, addressed to `הָרֹעִים`), and **`Zechariah 11:15`** (`כְּלִי רֹעֶה אֱוִלִי`).
6. **`H4731` (`מַקֵּל`, shepherd's staff/rod)** (`occurrences`, `OT`):  
   - **Total OT matches: 16 verses** across 8 books, notably clustering at **Genesis 30:37–41** (5×), **1 Samuel 17:40, 43** (David's pastoral staff vs. Goliath), **Ezekiel 39:9**, and **Zechariah 11:7, 10, 14** (the two staffs *Noam* and *Choblim*).
7. **`H2028` (`הֲרֵגָה`, slaughter)** (`occurrences`, `OT`):  
   - **Total OT matches: 5 verses across 2 books** — **`Jeremiah 7:32; 12:3; 19:6`** (`גֵּיא הַהֲרֵגָה` / `יוֹם הֲרֵגָה`) and **`Zechariah 11:4, 7`** (`צֹאן הַהֲרֵגָה`).
8. **`H7462` + `H0259` (`אֶחָד`, one)** (`set_combine`, `OT`):  
   - **Total OT matches: 8 verses**, dividing cleanly into: (a) pastoral unity (**`Ezekiel 34:23`**, **`Ezekiel 37:24`** `רֹעֶה אֶחָד`, **`Ecclesiastes 12:11`** `מֵרֹעֶה אֶחָד`, **`Isaiah 65:25`** `יִרְעוּ כְאֶחָד`), (b) historical tribal leadership (**`2 Samuel 7:7 // 1 Chronicles 17:6`**), and (c) ironic inversion in **`Zechariah 11:7–8`** (one staff vs. three shepherds cut off "in *one* month").
9. **`H7462` + `H7626` (`שֵׁבֶט`, rod/tribe/staff)** (`set_combine`, `OT`):  
   - **Total OT matches: 2 verses** — **`2 Samuel 7:7`** and **`Micah 7:14`** (`רְעֵה עַמְּךָ בְשִׁבְטֶךָ`). *(Contrast `Micah 5:1`, where `בַּשֵּׁבֶט` `H7626` "with the rod they strike the judge of Israel" lacks `H7462` in v. 1 itself, two verses before `וְרָעָה` in v. 4.)*
10. **Canonical Hapax Anchors & Clause-Role Syntax:**  
    - `H1243` (`בַּקָּרָה`, seeking/inspection, 1× OT) occurs exclusively at **`Ezekiel 34:12`** (alongside its structural wordplay/verbal echo `בקשׁ`/`בקר` in `Literary Structure`).  
    - `H0264` (`אַחֲוָה`, brotherhood, 1× OT) occurs exclusively at **`Zechariah 11:14`**.  
    - `clause_role_query` (`predicate: H7462`, `object: H6629`, `window: 4`) confirms **24 candidate verses** where "flock" (`צֹאן`) is the direct syntactic patient of "shepherd" (`רָעָה`), concentrating in Genesis 30–37, Exodus 3:1, 1 Sam 17:15/25:16, Isa 61:5, **Ezekiel 34:2, 3, 8, 10, 15**, and **Zechariah 11:4, 7**.

### B. Rare Greek NT Constellation
- **`G4166` (`ποιμήν`) + `G4263` (`πρόβατον`)** (`intersect_words`, `window: 1`):  
  - **Total NT matches: 12 verses** — `Matt 9:36; 25:32; 26:31`, `Mark 6:34; 14:27`, **`John 10:2, 11, 12, 14, 16`**, `Heb 13:20`, `1 Pet 2:25`.  
- **`G4167` (`ποίμνη`, flock)** (`occurrences`, `NT`):  
  - **Total NT matches: 4 verses** — `Matt 26:31` (quoting Zech 13:7), `Luke 2:8`, **`John 10:16`** (`μία ποίμνη εἷς ποιμήν`), `1 Cor 9:7` (drinking milk of the flock — cf. Ezek 34:3 LXX `γάλα`).

---

## 5. LXX Textual, Lexical & Theological Shifts

Comparing MT (`mt_tokens`) with Rahlfs 1935 LXX (`grk_tokens`, `shifts` from `lxx_concordance`) across all 4 primary passages (100% verse coverage achieved by combining Calls 7 and 18) and intermediate passages (Calls 12 and 18) exposes systematic translational divergences directly relevant to NT reception:

### A. Ezekiel 34:1–16
- **34:3 (`הַחֵלֶב` fat -> `τὸ γάλα` milk):** MT accuses the shepherds of eating "the fat" (`הַחֵלֶב`, *ḥēleb*); LXX reads **`τὸ γάλα`** ("milk", *ḥālāb* — classic unpointed consonantal vocalization shift `חלב`), and renders `תִּזְבָּחוּ` as `σφάζετε` ("slaughter").
- **34:4 (Lexical shifts & compression):**  
  - `לֹא־רִפֵּאתֶם` (`H7495` heal) -> **`οὐκ ἐσωματοποιήσατε`** ("did not restore bodily / build up the body");  
  - `וְאֶת־הַנִּדַּחַת` (`H5080`) -> **`τὸ πλανώμενον`** ("the wandering/astray", echoed verbatim in `1 Pet 2:25` `πλανώμενοι`);  
  - `וּבְחָזְקָה רְדִיתֶם אֹתָם וּבְפָרֶךְ` -> **`τὸ ἰσχυρὸν κατειργάσασθε μόχθῳ`** ("the strong you exploited/wore down with toil", shifting adverbial `בְחָזְקָה` into substantive object `τὸ ἰσχυρόν`, matching v. 16!).
- **34:5 (LXX Plus):** LXX adds **`τὰ πρόβατά μου`** ("my sheep", `sum_idf: 6.83`, flagged in `John 10:1` `tri_textual_diff` as an `agrees_lxx_against_mt` alignment anchor) and shows `mt_minus` on `וַתְּפוּצֶינָה` (`H6327` token alignment gap / doubled `διεσπάρη` across vv. 5–6).
- **34:6 (Shift & Compression):** `יִשְׁגּוּ` (`H7686` wander) -> `διεσπάρη` ("were scattered"); MT's paired `וְאֵין דּוֹרֵשׁ וְאֵין מְבַקֵּשׁ` shifts/compresses to `οὐκ ἦν ὁ ἐκζητῶν οὐδὲ ὁ ἀποστρέφων` ("nor anyone turning them back").
- **34:12 (Unexpected Rescue Shift):** MT `וְהִצַּלְתִּי אֶתְהֶם` ("I will rescue them", `H5337`) -> LXX **`καὶ ἀπελάσω αὐτὰ`** ("I will drive them out/away", `ἀπελαύνω`) — a striking semantic divergence where "rescue" becomes "drive out (of the places of scattering)."
- **34:14 (`מִרְעֶה` / `נָוֶה` -> `νομή` & `μάνδρα`):** Both `בְּמִרְעֶה־טוֹב` and `וּבְנָוֶה שָׁמֵן` yield **`νομή`** (`ἐν νομῇ ἀγαθῇ ... ἐν νομῇ πίονι`), matching John 10:9 (`νομὴν εὑρήσει`), while the first `נָוֶה` renders as **`αἱ μάνδραι αὐτῶν`** ("their folds") plus an LXX expansion **`κοιμηθήσονται`** ("they shall lie down/sleep").
- **34:15 (LXX Covenant Formula Expansion):** LXX adds **`αὐτὰ καὶ γνώσονται ὅτι ἐγώ εἰμι [κύριος]`** ("and they shall know that I am the LORD"), reinforcing John 10:14–15's mutual-knowledge motif (`γινώσκω`).
- **34:16 (Theological Reversal on "Strong": `אַשְׁמִיד` -> `φυλάξω`):** MT reads "the fat and the strong I will *destroy* (`אַשְׁמִיד` `H8045`)" — judging the bullying rams (cf. vv. 17–22); LXX omits `הַשְּׁמֵנָה` (`H8082` `mt_minus`) and flips the verb on `τὸ ἰσχυρόν` from "destroy" (`שׁמד`) to **`φυλάξω`** ("I will *guard/keep*", likely reflecting Vorlage/reading `אֶשְׁמֹר` `d/r` or `אֶשְׁקֹד` / theological softening!).

### B. Zechariah 11:4–17
- **11:4 (Pluralization & Divine Title):** `יְהוָה אֱלֹהָי` ("YHWH my God") -> **`κύριος παντοκράτωρ`**; singular imperative `רְעֵה` ("shepherd!") -> plural **`ποιμαίνετε`** ("shepherd [ye]!").
- **11:7 (`עֲנִיֵּי הַצֹּאן` -> `εἰς τὴν Χαναανῖτιν`):** MT `לָכֵן עֲנִיֵּי הַצֹּאן` ("therefore, O afflicted of the flock") is read without word division as `לִכְנַעֲנֵי הַצֹּאן` -> **`εἰς τὴν Χαναανῖτιν`** ("for the Canaanitish [women/land] / merchants", repeated in v. 11!). Meanwhile the two staffs `נֹעַם` (*Noam*, Favor) and `חֹבְלִים` (*Choblim*, Union/Binders) become **`Κάλλος`** ("Beauty") and **`Σχοίνισμα`** ("Measuring-line / Allotment").
- **11:8 (`בָּחֲלָה` -> `ἐπωρύοντο`):** MT "my soul grew impatient (`וַתִּקְצַר`), and their soul also loathed (`בָּחֲלָה`) me" -> LXX `βαρυνθήσεται ἡ ψυχή μου ... καὶ αἱ ψυχαὶ αὐτῶν ἐπωρύοντο ἐπ᾽ ἐμέ` ("they howled/snarled at me", `ἐπωρύομαι`).
- **11:13 (`הַיּוֹצֵר` "the potter" -> `τὸ χωνευτήριον` "the smelting furnace"):** Where Jeremiah 19:1 translates `יוֹצֵר` (`H3335`) concretely as `πλάσσω` ("potter/molder"), LXX Zechariah 11:13 renders `אֶל־הַיּוֹצֵר` as **`εἰς τὸ χωνευτήριον`** (Rahlfs; Swete reads `χαονευτήριον` in `literary_structure`), shifting the temple-treasury imagery from a **potter** to a **foundry/crucible** (`צֹרֵף` / melting silver). Matthew 27:7–10 bypasses LXX's `χωνευτήριον` back to Hebrew **`κεραμεύς`** ("potter")!
- **11:14 (`אַחֲוָה` -> `κατάσχεσιν`):** Hapax `הָאַחֲוָה` (`H0264`, "brotherhood") is read/translated as `אֲחֻזָּה` -> **`τὴν κατάσχεσιν`** ("possession/inheritance").
- **11:15 (`כְּלִי רֹעֶה אֱוִלִי` -> `σκεύη ποιμενικὰ ποιμένος ἀπείρου`):** Uses the ultra-rare adjective **`ποιμενικός`** (matching **only 1 Samuel 17:40** LXX `ἐν τῷ καδίῳ τῷ ποιμενικῷ` [`p_g_given_h: 0.0058`, `g_idf: 13.9`]!) and shifts `אֱוִלִי` ("foolish") to `ἀπείρου` ("inexperienced/unskilled").
- **11:16 (`הַנִּצָּבָה` / `פַרְסֵיהֶן`):** Shifts "that which stands firm" (`הַנִּצָּבָה`) to LXX plus/expansion **`τὸ ὁλόκληρον οὐ μὴ κατευθύνῃ`** ("what is whole/sound he shall not guide aright", replacing `יְכַלְכֵּל` `H3557`), and shifts "their hooves (`וּפַרְסֵיהֶן`) he tears off" to **`τοὺς ἀστραγάλους αὐτῶν ἐκστρέψει`** ("their ankle-bones/knucklebones he will dislocate", `g_idf: 13.32`).
- **11:17 (`הָאֱלִיל` -> `τὰ μάταια`):** "Shepherd of worthlessness/idol (`הָאֱלִיל`)" -> `οἱ ποιμαίνοντες τὰ μάταια` ("those shepherding vain things", pluralized like v. 4!).

### C. Micah 5:1–6 (MT 4:14–5:5)
- **5:1 (MT 4:14 — `שֹׁפֵט` "judge" -> `τὰς φυλὰς` "tribes"; `גְּדוּד` -> `φραγμῷ`):** MT `תִּתְגֹּדְדִי בַת־גְּדוּד` ("slash yourself / gather in troops, daughter of troops") -> LXX `ἐμφραχθήσεται θυγάτηρ Εφραιμ ἐν φραγμῷ` ("shall be hedged in with a hedge", reading `גדר` and `אפרים`!), and MT `שֹׁפֵט יִשְׂרָאֵל` ("judge of Israel") -> LXX **`τὰς φυλὰς τοῦ Ισραηλ`** ("the tribes of Israel", reading `שִׁבְטֵי` vs `שֹׁפֵט`).
- **5:2 (MT 5:1 — `בֵּית־לֶחֶם` Doublet & `צָעִיר`):** LXX expands `בֵּית־לֶחֶם` as `Βηθλεεμ οἶκος τοῦ Εφραθα` (both transliteration and translation `οἶκος`!), and renders `צָעִיר` ("small/youngest") as **`ὀλιγοστὸς`** (vs. Matthew 2:6 `οὐδαμῶς ἐλαχίστη`).
- **5:4 (MT 5:3 — Double Translation of `רעה` + `ποίμνιον` Plus + `ὑπάρξουσιν`):** MT reads simply `וְעָמַד וְרָעָה בְּעֹז יְהוָה ... וְיָשָׁבוּ` ("he shall stand and shepherd in the strength of YHWH ... and they shall dwell"). LXX produces a **classic double translation of consonantal `רעה`** ("see" + "shepherd") AND supplies the explicit object **`τὸ ποίμνιον αὐτοῦ`**: **`καὶ στήσεται καὶ ὄψεται καὶ ποιμανεῖ τὸ ποίμνιον αὐτοῦ ... καὶ ὑπάρξουσιν`** ("and they shall subsist/be" for `יָשָׁבוּ`, plus `αὐτῶν` for `3ms` `אֱלֹהָיו`). Crucially, `tri_textual_diff` on **`1 Peter 5:2–4`** detects **`τοῦ ποιμνίου`** agreeing with this exact **`Micah 5:4#lxx_plus_expansion`** (`agrees_lxx_against_mt`)!
- **5:5 (MT 5:4 — `נְסִיכֵי אָדָם` -> `δήγματα ἀνθρώπων` + Person Shift):** MT "eight princes of men (`נְסִיכֵי`)" -> LXX **`ὀκτὼ δήγματα ἀνθρώπων`** ("eight bites of men", reading `נשׁך` "bite" instead of `נסך` "prince"!) and shifts 1st-person plural suffixes (`בְּאַרְצֵנוּ`/`בְּאַרְמְנֹתֵינוּ`) to 2nd-person plural (`τὴν γῆν ὑμῶν / τὴν χώραν ὑμῶν`).
- **5:6 (MT 5:5 — `בִּפְתָחֶיהָ` -> `ἐν τῇ τάφρῳ αὐτῆς`):** "In its gates/entrances (`H6607`)" -> "in its trench (`τάφρῳ`)".

---

## 6. Multi-Book Intermediate Bridges (Verified via `lxx_concordance` & `tri_textual_diff`)

Rather than isolated direct citation, the four passages form a dense web mediated by **six multi-book textual bridges**:

1. **Numbers 27:16–17 & 1 Kings 22:17 // 2 Chronicles 18:16 ("Sheep Without a Shepherd" + "Go In / Go Out" + `ἡγούμενος`):**
   - **Numbers 27:17** supplies the exact four-fold exit/entry liturgy (`יֵצֵא ... יָבֹא ... יוֹצִיאֵם ... יְבִיאֵם` -> LXX `ἐξελεύσεται ... εἰσελεύσεται ... ἐξάξει ... εἰσάξει`, shifting `בוא` to `εἰσάγω` [`p_g_given_h: 0.047`]) coupled with `καὶ οὐκ ἔσται ἡ συναγωγὴ κυρίου ὡσεὶ πρόβατα οἷς οὐκ ἔστιν ποιμήν` (LXX adds **`ὡσεὶ`**!). This directly bridges **Ezekiel 34:5–6, 13** (`ἐξάξω`/`εἰσάξω` + sheep with no shepherd), **John 10:3–4, 9** (`ἐξάγει` + `εἰσελεύσεται καὶ ἐξελεύσεται καὶ νομὴν εὑρήσει`), and **Matthew 9:36 // Mark 6:34** (`ὡσεὶ πρόβατα μὴ ἔχοντα ποιμένα`). *(Note: On `Matt 9:36`, `tri_textual_diff` retrieved `2 Chr 18:16` and `Num 27:17` in `candidate_sources` but wrongly spliced `Gen 4:2 + Ezek 34:2` — see §9.4.)*
   - **2 Chronicles 18:16** (par. 1 Kgs 22:17) exhibits an **LXX plus** **`ἔχουσιν ἡγούμενον`** ("they have no ruler/leader", replacing `אֲדֹנִים` `mt_minus H0113`), creating a Greek bridge to **Micah 5:2 -> Matthew 2:6** (`ἡγούμενος` in LXX Micah 5:2 / `ὅστις ποιμανεῖ τὸν λαόν μου` — `2 Sam 5:2 // Mic 5:2` conflation verified in Call 12 `Matt 2:6` `tri_textual_diff`, though `Matt 2:6` omitted `Mic 5:2` in its top candidate list!).
2. **Jeremiah 23:1–6 (Indictment -> Return -> Righteous Branch/Davidic Shepherd):**
   - **Jeremiah 23:1–2** shares **`H7462+H6327+H6629`** with Ezekiel 34:5–6, 12 and **`H7462+H5080+H0006`** with Ezekiel 34:4, 16; **Jeremiah 23:3–4** anticipates Ezekiel 34:11–16, 23 (`קִבַּצְתִּי` -> `εἰσδέξομαι` shift in Jer 23:3 LXX; `וַהֲקִמֹתִי עֲלֵיהֶם רֹעִים` "I will raise up shepherds over them", matching **Ezekiel 34:23** `וַהֲקִמֹתִי עֲלֵיהֶם רֹעֶה אֶחָד` AND inverted in **Zechariah 11:16** `אָנֹכִי מֵקִים רֹעֶה` "I am raising up a [worthless] shepherd"!).
3. **Jeremiah 12:3 & 19:1–6 -> Zechariah 11:4, 7, 13 -> Matthew 27:9–10:**
   - **Jeremiah 12:3** (`כְּצֹאן לְטִבְחָה ... לְיוֹם הֲרֵגָה`, though LXX drops `כְּצֹאן לְטִבְחָה`) and **Jeremiah 19:1–6** (`בַקְבֻּק יוֹצֵר חָרֶשׂ` + `גֵּיא הַהֲרֵגָה` -> LXX `πεπλασμένον` + **`πολυάνδριον τῆς σφαγῆς`**, "burial-ground of slaughter") link Zechariah 11:4, 7 (`צֹאן הַהֲרֵגָה`, the only other OT occurrences of `H2028`) and 11:13 (`הַיּוֹצֵר`) directly to Matthew 27:7–10's conflated attribution to "Jeremiah the prophet" (potter + burial field).
4. **1 Samuel 17:34–40 & Jeremiah 25:34 -> Zechariah 11:7, 10, 14–15 -> John 10:11–15:**
   - **1 Samuel 17:34–36** pairs the shepherd rescuing (`הִצִּיל`/`וְהִצַּלְתִּי` -> LXX 17:35 **`ἐξέσπασα`**, `p_g_given_h: 0.024`) the sheep from lion/bear at risk of life, prefiguring John 10:11–15 (shepherd vs. wolf) and Ezek 34:10, 12 (`נָצַל` `H5337`).
   - **1 Samuel 17:40** pairs David's **`מַקֵּל`** (`H4731`, matching Zech 11:7, 10, 14) with **`בִּכְלִי הָרֹעִים` -> LXX `ἐν τῷ καδίῳ τῷ ποιμενικῷ`**, sharing the ultra-rare adjective **`ποιμενικός`** solely with **Zechariah 11:15** (`σκεύη ποιμενικά` = `כְּלִי רֹעֶה`)! Meanwhile **Jeremiah 25:34** is the 3rd verse in the `H3627+H7462` set ("Wail, you shepherds ... fall like a vessel"), whose LXX (`Jer 32:34`) shifts `אַדִּירֵי` -> `οἱ κριοὶ τῶν προβάτων` ("rams of the flock", par. Ezek 34:17–22!).
5. **Ezekiel 34:22–25 & 37:24 ("One Shepherd" `רֹעֶה אֶחָד`) -> Zechariah 11:7–8 -> John 10:16:**
   - **Ezekiel 34:23–25** (and **37:24**) supplies the exact phrase `רֹעֶה אֶחָד` -> LXX **`ποιμένα ἕνα`** ("one shepherd", `עַבְדִּי דָוִיד`, plus `בְּרִית שָׁלוֹם` `διαθήκην εἰρήνης`), forming the direct verbal matrix for **John 10:16** (`γενήσεται μία ποίμνη εἷς ποιμήν` — where John 10:16 uses **`ποίμνη`** `G4167` with `εἷς ποιμήν` while `Micah 5:4` LXX uses `ποίμνιον` `G4168`).
6. **Zechariah 13:7 -> Matthew 26:31 // Mark 14:27 & Petrine/Hebrews Epistles:**
   - **Zechariah 13:7** LXX pluralizes the singular shepherd (`הָרֹעֶה` -> **`τοὺς ποιμένας`**) and shifts `וּתְפוּצֶיןָ` (`H6327`) to **`ἐκσπάσατε`** ("pluck out"); **Matthew 26:31** (`tri_textual_diff`, Call 12) **diverges from LXX back toward MT** (`agrees_mt_against_lxx` on singular **`τὸν ποιμένα`** `mt_idx:4` and **`διασκορπισθήσονται`** `mt_idx:5` from `פוץ`, adding `τῆς ποίμνης` from Mic 5:4/Ezek 34/John 10:16 typology).
   - **1 Peter 2:25** (`tri_textual_diff`, Call 15): Combines Isa 53:6 (`ὡς πρόβατα πλανώμενοι`, `agrees_both`) with **`ἐπεστράφητε`** (echoing Ezek 34:4, 16 `τὸ πλανώμενον ἐπιστρέψω`!).
   - **1 Peter 5:2–4** (`tri_textual_diff`, Call 18): Aligns `τοῦ ποιμνίου` explicitly to **`Micah 5:4#lxx_plus_expansion`** (`τὸ ποίμνιον αὐτοῦ`).
   - **Hebrews 13:20** (`tri_textual_diff`, Call 15): Combines Isa 63:11 LXX (`ὁ ἀναγαγὼν ... τὸν ποιμένα τῶν προβάτων`, `lxx_plus_expansion` "shepherd" plural/singular shift!) with **"blood of an eternal covenant"** (Zech 9:11 / Ezek 34:25 / 37:26 `διαθήκη αἰωνία`).

---

## 7. Internal Structural, Rhetorical & Wordplay Observations (Tier c & d)

- **Ezekiel 34:1–16** (`get_Passage` & `literary_structure`): Divides into 3 units (`34:1-6` indictment, `34:7-8` oath of judgment, `34:9-16` divine rescue and counter-shepherding), framed by 4 symmetries (e.g., `רְעוּ`/`רֹעֵי` in v. 2; `בקשׁ`/`בקר` paronomasia in vv. 6, 11–12, 16). Notice how Yahweh's 6 actions in v. 16 systematically invert the shepherds' 5 failures in v. 4 (`seek`, `bring back`, `bind`, `strengthen`, plus `judge`).
- **Zechariah 11:4–17**: 3 units (`11:4-12` prophetic sign-act of two staffs and thirty pieces of silver, `11:13-14` casting to the potter/foundry and breaking brotherhood, `11:15-17` foolish shepherd & woe oracle), with 3 symmetries and wordplays (`שׁלם`/`אשׁלם`/`שׁלשׁים` sounds in v. 12; `נֹעַם`/`חֹבְלִים`). Physical analogy (Tier d): breaking two actual shepherd staffs (`מַקְלוֹת`) enacts covenant dissolution between Yahweh, the peoples, and Judah/Israel.
- **Micah 5:1–6**: Compact messianic-military oracle without formal `units`/`symmetries` metadata, structured around assonant wordplays (`תִּתְגֹּדְדִי בַת־גְּדוּד` v. 1, `צָעִיר`/`יֵצֵא` vv. 2–3, `וְעָמַד וְרָעָה` v. 4), moving from humiliation (`struck on the cheek with a rod`) to Bethlehem origin, universal shepherding (`5:4`), and anti-Assyrian defense (`7 shepherds and 8 princes`, `5:5-6`).
- **John 10:1–18**: 4 units (`10:1-5` *paroimia* of gate/fold/voice, `10:6` misunderstanding, `10:7-13` "I am the Door" & "Good Shepherd" vs. hireling, `10:14-18` mutual knowledge, "other sheep / one flock, one shepherd," and voluntary self-laying down). Direct internal shift `r13:interp:26588:eq20` links `κλέπτης` -> `λῃστής` (vv. 1, 8, 10).

---

## 8. Interpretive Synthesis (Tier e — Clearly Marked Hypotheses)

- **Hypothesis 1 (Prophetic Diachronic Trajectory):** Ezekiel 34 likely synthesizes and expands Jeremiah 23:1–4 (`H7462+H5080+H0006` and `H7462+H6327+H6629`), transforming pre-exilic anti-monarchic critique into a comprehensive counter-pastoral theology (Yahweh Himself taking over the 5 neglected duties). Post-exilic Zechariah 11:4–17 then **deliberately inverts** Ezekiel 34:4/16 (`H7462+H7495+H7665`) in a dark tragedy of rejected divine shepherding leading to the "foolish/idol shepherd."
- **Hypothesis 2 (Johannine Synthesis via LXX + Hebrew):** John 10:1–18 does not quote a single OT verse linearly (explaining `sequence_parallels` `p_null = 0.69–0.98`); instead, it **fuses** (1) Ezekiel 34's divine counter-shepherd & `Ezek 34:23 / 37:24`'s `one shepherd` (`John 10:16`), (2) Num 27:17 + Ezek 34:13–14 LXX's `go out/go in` and `νομή` (`John 10:3–4, 9`), (3) Zechariah 11's flock-for-slaughter / hired vs. self-giving shepherd contrast, and (4) 1 Sam 17:34–36's wolf/predator rescue (`John 10:11–13`), while re-focusing Davidic royal victory (Mic 5:2–6) onto voluntary life-laying down (`John 10:11, 15, 17–18`).

---

## 9. Honest 8-Question System Evaluation

### 1. How effective was the MCP toolset for open-ended, cross-testament intertextual research?
**Very strong overall, especially for falsification and non-obvious lexical discovery.** Without `intersect_words`, `set_combine`, and `lxx_concordance`, standard commentary intuition easily misses that `H7462+H7495+H7665` occurs **only** in `Ezek 34:4` and `Zech 11:16`, that `H7462+H2719+H5337` is **unique** to `Mic 5:6`, that `H2028` unites **only** `Jer 7/12/19` and `Zech 11:4,7`, and that `ποιμενικός` connects `1 Sam 17:40` and `Zech 11:15` LXX. Equally valuable, `sequence_parallels` `p_null` values prevented false claims of structural sequence dependence.

### 2. How discoverable and ergonomic were the tool schemas and parameter names?
**Moderately rough due to cross-operation parameter-name inconsistencies inside `research`.** In Call 16–18, three distinct conventions collided under the single `research` endpoint:
- `lxx_concordance` and `tri_textual_diff` require `"passage"` (rejecting `"ref"`, even though `tri_textual_diff` outputs `"target_ref"` and `"source_ref"`!);
- `set_combine` expects `"include": string[]`;
- `intersect_words` expects `"words": string[]` (rejecting `"strongs": [...]` or `"strongs": "..."`, though the validation error usefully returned `expected_params`).
Standardizing on `"passage"` (or accepting `"ref"` as an alias) and unifying Strong's array parameters would eliminate wasted round trips.

### 3. Did you observe any corpus metadata, tagging, or alignment bugs?
**Yes — three concrete bugs verified directly in tool outputs:**
1. **`H7462` Corrupted Display Lemma:** Both `get_Word("H7462")` and `lxx_concordance` `mt_tokens` (e.g., Zech 11:16, 17; Jer 25:34) print **`בֵּית־עֵ֫קֶד הָרֹעִים`** ("House of Shepherds", Beth-eked) as the lemma `lm` for `H7462` participatory/nominal forms (`רֹעֶה`/`הָרֹעִים`), instead of `רָעָה`!
2. **`H7462` vs. `H7473` Lexicon Split:** `get_Word("G4166")` (`ποιμήν`) links to `H7473` (`רֹעִי`), while OT occurrences of "shepherd" in Ezekiel 34, Zechariah 11, and Micah 5 are tagged `H7462`. Meanwhile `get_Word("H7462")` elevates a 4× secondary/homograph sense (`γινώσκω`), causing `get_Connection` to justify `Ezekiel 34 <-> John 10` via `passage_lxx:H7462:G1097` (`γινώσκω`) instead of `ποιμήν`/`βόσκω`/`ποίμνιον`!
3. **`1 Peter 5:2` NT Token-Lemma Off-by-One Desynchronization:** In Call 18 (`tri_textual_diff` on `1 Peter 5:2-4`, `nt_idx` 7–16), `nt_surface` and `nt_lemma` are shifted by one position around the omitted/variant word `ἐπισκοποῦντες`: `nt_idx:7` pairs `nt_surface: "μὴ"` with `nt_lemma: "ἐπισκοπέω"` (falsely triggering an `agrees_lxx_against_mt` alignment to `Deut 11:12`), `nt_idx:8` pairs `"ἀναγκαστῶς"` with `"μή"`, `nt_idx:12` pairs `"Θεόν"` with `"κατά"`, etc.

### 4. How accurate and reliable was `lxx_concordance`?
**High linguistic fidelity, hampered by a silent 12-verse cap.** Individual verse alignments (`links`, `stability`, `shifts`, `lxx_plus_expansion`, `mt_minus`, `pronoun_person_shift`) surfaced extraordinary, publication-grade insights (`χωνευτήριον` in Zech 11:13 vs `πλάσσω` in Jer 19:1; `γάλα` in Ezek 34:3; `φυλάξω` in Ezek 34:16; `τὸ ποίμνιον αὐτοῦ` in Mic 5:4; `δήγματα` in Mic 5:5; `ἀστραγάλους` in Zech 11:16; `πολυάνδριον τῆς σφαγῆς` in Jer 19:6). **However**, passing a 16-verse (`Ezekiel 34:1-16`) or 14-verse (`Zechariah 11:4-17`) passage silently truncated output at **12 verses** without a `truncated: true` flag or warning, forcing a follow-up call (Call 18) once noticed.

### 5. How well did `tri_textual_diff` perform on NT quotation/allusion attribution?
**Mixed — strong token-level witness classification when the right OT source is chosen, weak candidate ranking on composite allusions.**
- *Wins:* Correctly flagged `agrees_lxx_against_mt` for `1 Pet 5:4` -> `Mic 5:4#lxx_plus_expansion`, `Heb 13:20` -> `Isa 63:11`, `John 10:1` -> `Ezek 34:5`, and `agrees_mt_against_lxx` for `Matt 26:31` -> `Zech 13:7`.
- *Failures:*
  1. On **`Matthew 9:36`**, `Numbers 27:17` and `2 Chronicles 18:16` were retrieved in `candidate_sources` (even listing `ὡσεὶ` shift!), yet the splice algorithm selected **`Genesis 4:2`** (`ἦσαν ... πρόβατα`) + `Ezekiel 34:2` as top `sources`!
  2. On **`Matthew 2:6`**, **`Micah 5:2` was completely absent** from `candidate_sources` (ranked behind `Job 30:1` and `2 Sam 5:2` alone).
  3. On **`Matthew 27:9-10`**, **`Zechariah 11:12-13` was absent** from `candidate_sources` (picking `Exod 30:16`, `2 Chr 36:22`, `Jer 51:59` via `Ιερεμίου`/`τριάκοντα`/`ἀργύρια`).
  4. On **`John 10:14`**, common-word overlap pulled false-positive `Proverbs 2:10` (`γνῶσις`).
  5. Calling `tri_textual_diff` on OT passages returns `status:"no_alignment"` (expected, since it targets NT->OT), yet still appends huge `candidate_sources` and `lxx_shifts_in_sources` dumps inflating Call 7 to 173 KB.

### 6. How useful were the lexical-constellation and syntactic tools (`intersect_words`, `set_combine`, `occurrences`, `clause_role_query`)?
**The standout, highest-precision instruments in the toolkit.** Fast (`7.8s`–`15.8s` for 8-op batches), deterministic, zero hallucination, and capable of exact Boolean intersections (`H7462+H7495+H7665` = 2 vv; `H7462+H2719+H5337` = 1 v; `H3627+H7462` = 3 vv) and predicate-patient disambiguation (`clause_role_query` returning 24 exact `רָעָה + צֹאן` verses). Adding optional LXX Greek lemma co-occurrence in `intersect_words` (beyond NT/MT) would make Greek LXX bridges like `ποιμενικός` queryable in one call instead of requiring verse-by-verse inspection.

### 7. How did graph/chain/structure tools (`get_Connection`, `follow_connectionchain`, `literary_structure`) behave?
- **`get_Connection`** reliably built the full 4-endpoint `cycle_network` in one call, though its edge labeling relies on corpus link tables affected by the `H7462`/`H7473` tag split.
- **`follow_connectionchain("Ezekiel 34:1-16")`** anchored its lexical/grammatical hops solely on the **first verse (`Ezek 34:1` `דבר יהוה`)** rather than salient rare lemmas across the whole pericope (`34:4, 12, 16`), limiting multi-verse discovery.
- **`literary_structure`** provided valuable thematic clusters, Swete LXX variants (`χαονευτήριον`), and speaker shifts, **but** produced extreme bloat (`Call 10` = **587,626 wire bytes / 527,508 payload bytes** across 4 `trace_evidence` + 4 `literary_structure` ops).

### 8. What are the top concrete engineering improvements recommended from this session?
1. **Fix `H7462` lemma metadata (`בֵּית־עֵ֫קֶד הָרֹעִים` -> `רָעָה`)** and **unify `H7462`/`H7473` (`רָעָה`/`רֹעִי`) + suppress homograph `γινώσκω` priority** so `G4166` (`ποιμήν`) connects cleanly to OT shepherd passages.
2. **Fix the NT surface/lemma alignment offset in `1 Peter 5:2`** (and audit other NT passages with bracketed/variant words like `ἐπισκοποῦντες`).
3. **Eliminate silent 12-verse truncation in `lxx_concordance`** (raise cap or emit explicit `truncated: true` + `remaining_refs`).
4. **Upgrade `tri_textual_diff` candidate retrieval & splice ranking** (lexical-IDF weighting + known quotation/allusion priors so `Mic 5:2` is not missed in `Matt 2:6`, `Zech 11:12-13` is not missed in `Matt 27:9-10`, and `Num 27:17`/`2 Chr 18:16` are not outranked by `Gen 4:2` on `Matt 9:36`).
5. **Normalize `research` operation schemas** (`passage`/`ref` aliasing, consistent Strong's parameter naming) and **trim default verbosity** on `trace_evidence`/`literary_structure` (`Call 10` 527 KB) and OT `tri_textual_diff` fallbacks.
6. **Anchor `follow_connectionchain` on multi-verse pericopes by TF-IDF/rarity across the whole range**, not verse 1.
