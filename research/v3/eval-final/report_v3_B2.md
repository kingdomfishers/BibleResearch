# Tri-Textual Investigation: Isaiah 28:16, Isaiah 8:14, Psalm 118:22, and Habakkuk 2:4 Across MT, LXX, and the New Testament

## Scope, Methodology, and Epistemic Categories

This report examines how four foundational Old Testament texts—**Isaiah 28:16**, **Isaiah 8:14**, **Psalm 118:22** (LXX Psalm 117:22), and **Habakkuk 2:4** (together with its immediate antecedent **Habakkuk 2:3** and **Isaiah 26:20**)—shift across the Hebrew Masoretic Text (MT), the Greek Septuagint (LXX, Rahlfs 1935), and their New Testament citations (**Romans 9:32–33; 10:11; 1:17; Galatians 3:11; 1 Peter 2:4–8; Hebrews 10:37–39; Matthew 21:42; Mark 12:10–11; Luke 20:17; Acts 4:11**).

Throughout this analysis, five epistemic layers are kept strictly distinct:
1. **Attested Textual Evidence**: Observed Hebrew MT tokens, Rahlfs LXX Greek tokens, and NA28-membership NT Greek tokens with Strong's numbers, lemmas, and 1-based token positions.
2. **Linguistic / Concordance Relationships**: Corpus-wide MT↔LXX lexical equivalence counts, stability scores, and documented translation shifts (`lexical_theological_shift`, `pronoun_person_shift`, `lxx_plus_expansion`, `mt_minus`).
3. **Structural / Rhetorical Parallels & Splices**: Composite quotation splicing, catchword (*gezerah shavah*) linking, clause inversion, and pericope framing.
4. **Physical / Architectural Analogies**: Real-world masonry and stumbling imagery (foundation, corner/capstone, tripping stone, trap/snare) kept distinct from theological claims.
5. **Interpretive Hypotheses**: Proposed explanations for non-obvious divergences, Vorlage possibilities, or authorial/editorial practices, explicitly marked as hypotheses.

---

## Executive Synthesis: Textual Alignment Profile of the NT Citations

| OT Source | Primary NT Citations | Follows LXX vs. MT | Follows MT vs. LXX | Composite Splice | NT Adaptation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Isaiah 28:16** | **Rom 9:33; 10:11; 1 Pet 2:6** | `ἐκλεκτὸν ἀκρογωνιαῖον ἔντιμον` (1 Pet 2:6); `ὁ πιστεύων ἐπ᾿ αὐτῷ οὐ [μὴ] καταισχυνθῇ / καταισχυνθήσεται` (1 Pet 2:6; Rom 9:33; 10:11) | `τίθημι` (present active, closer to MT `הִנְנִי יִסַּד` / participle-like commissioning than LXX future `ἐγὼ ἐμβαλῶ εἰς τὰ θεμέλια`)? *(see nuance below)* | **Rom 9:33** splices Isa 28:16 frame + Isa 8:14 middle; **1 Pet 2:6–8** chains Isa 28:16 + Ps 118:22 + Isa 8:14 | `Ἰδοὺ τίθημι ἐν Σιὼν` (both Rom 9:33 & 1 Pet 2:6); `Πᾶς` added & `καταισχυνθήσεται` future (Rom 9:33, 10:11); `ἐκλεκτὸν` precedes `ἀκρογωνιαῖον` (1 Pet 2:6) |
| **Isaiah 8:14** | **Rom 9:32–33; 1 Pet 2:8** | `λίθον/λίθος προσκόμματος` (`πρόσκομμα`, matching LXX `λίθου προσκόμματι`) | `πέτραν/πέτρα σκανδάλου` (`σκάνδαλον` reflects MT `מִכְשׁוֹל` `H4383` rather than LXX `πτώματι`!) and omits LXX's negative `οὐχ ... οὐδὲ` | Spliced inside **Rom 9:33**; appended as third member in **1 Pet 2:8** | Reverses LXX's conditional promise (`οὐχ ὡς ... συναντήσεσθε`) back to positive stumbling (`προσέκοψαν` Rom 9:32; `οἳ προσκόπτουσιν τῷ λόγῳ ἀπειθοῦντες` 1 Pet 2:8) |
| **Psalm 118:22** (LXX 117:22) | **Matt 21:42; Mark 12:10–11; Luke 20:17; Acts 4:11; 1 Pet 2:4, 7** | Word-for-word Rahlfs LXX in Synoptics & 1 Pet 2:7 (`λίθον ὃν ἀπεδοκίμασαν οἱ οἰκοδομοῦντες...`) | **Acts 4:11** uses `ἐξουθενηθεὶς` + `τῶν οἰκοδόμων` (noun `οἰκοδόμος`, matching MT plural noun/substantive `הַבּוֹנִים` vs. LXX participle `οἱ οἰκοδομοῦντες`) | **Matt 21:42** & **Mark 12:10–11** continue seamlessly into Ps 118:23; **1 Pet 2:7** embeds Ps 118:22 between Isa 28:16 and Isa 8:14 | **1 Pet 2:7** shifts `λίθον` (acc.) → `λίθος` (nom.) and supplies `ἀπιστοῦσιν δὲ`; **Acts 4:11** recasts into direct 2nd-person accusation (`ὑφ᾿ ὑμῶν τῶν οἰκοδόμων`) |
| **Habakkuk 2:4** (+ **2:3**) | **Rom 1:17; Gal 3:11; Heb 10:37–39** | **Heb 10:37–38** follows LXX `ὁ ἐρχόμενος ἥξει καὶ οὐ χρονίσει`, `ὑποστείληται`, `οὐκ εὐδοκεῖ ἡ ψυχή μου`, and 1sg `μου` | **Rom 1:17; Gal 3:11** drop LXX 1sg `μου` (`ὁ δὲ δίκαιος ἐκ πίστεως ζήσεται`); **Rom 1:17** links to `δικαιοσύνη` | **Heb 10:37–38** splices **Isa 26:20 LXX** (`μικρὸν ὅσον ὅσον`) + **Hab 2:3 LXX** + **Hab 2:4 LXX** | **Heb 10:38** inverts the two clauses of Hab 2:4 (`ὁ δὲ δίκαιός μου...` placed first, `καὶ ἐὰν ὑποστείληται...` second) and places `μου` after `δίκαιος`; **Rom 1:17** & **Gal 3:11** extract only the second clause |

---

## Detailed Textual Analysis by Passage

### 1. Isaiah 28:16 → Romans 9:33; Romans 10:11; 1 Peter 2:6

#### (a) Attested Textual Evidence (MT vs. LXX)
* **Hebrew MT (Isaiah 28:16)**:
  `לָכֵ֗ן כֹּ֤ה אָמַר֙ אֲדֹנָ֣י יְהוִ֔ה הִנְנִ֛י יִסַּ֥ד בְּצִיּ֖וֹן אָ֑בֶן אֶ֣בֶן בֹּ֜חַן פִּנַּ֤ת יִקְרַת֙ מוּסָ֣ד מוּסָּ֔ד הַֽמַּאֲמִ֖ין לֹ֥א יָחִֽישׁ׃`
  * Key tokens: `הִנְנִי` (pos 6, `H2005`), `יִסַּד` (pos 7, `H3245`, "has laid/founded" — Piel perf. or archaic/defective form), `בְּצִיּוֹן` (pos 8, `H6726`), `אָבֶן` (pos 9, `H0068`), `אֶבֶן` (pos 10, `H0068`), `בֹּחַן` (pos 11, `H0976`, "testing", hapax legomenon in OT), `פִּנַּת` (pos 12, `H6438`, "corner of"), `יִקְרַת` (pos 13, `H3368`, "preciousness of"), `מוּסָד` (pos 14, `H4143`, "foundation"), `מוּסָּד` (pos 15, `H3245`, "founded"), `הַמַּאֲמִין` (pos 16, `H0539`, "the one who trusts/believes"), `לֹא` (pos 17, `H3808`), `יָחִישׁ` (pos 18, `H2363`, "he will make haste").
* **Greek LXX (Isaias 28:16, Rahlfs)**:
  `διὰ τοῦτο οὕτως λέγει Κύριος, Κύριος, ἐγὼ ἐμβαλῶ εἰς τὰ θεμέλια Σιὼν λίθον πολυτελῆ ἐκλεκτὸν ἀκρογωνιαῖον ἔντιμον, εἰς τὰ θεμέλια αὐτῆς, καὶ ὁ πιστεύων ἐπ’ αὐτῷ οὐ μὴ καταισχυνθῇ.` *(Note: corpus text prints `εἷς` / `τὸ,` due to orthographic accents in the Rahlfs morph witness).*

#### (b) Linguistic & Concordance Shifts (MT → LXX)
1. **Verb & Prepositional Expansion (`הִנְנִי יִסַּד` → `ἐγὼ ἐμβαλῶ εἰς τὰ θεμέλια`)**:
   * `H3245` (`יָסַד`) is normally rendered by `θεμελιόω` in the LXX (27 times, mean stability `0.965`). In Isaiah 28:16 alone, the LXX introduces an `lxx_plus_expansion` (`ἐμβαλῶ εἰς`, "I will cast/lay into") and renders the founding root as plural noun `θεμέλια` (`θεμέλιον`, `p_g_given_h = 0.0256`, `g_idf = 12.32`), omitting `הִנְנִי` ("Behold!") in favor of emphatic `ἐγὼ` + future `ἐμβαλῶ`.
2. **Architectural Stone Qualifiers (`אֶבֶן בֹּחַן פִּנַּת יִקְרַת מוּסָד מוּסָּד` → `λίθον πολυτελῆ ἐκλεκτὸν ἀκρογωνιαῖον ἔντιμον, εἰς τὰ θεμέλια αὐτῆς`)**:
   * **MT minus**: `בֹּחַן` (`H0976`, "testing") occurs only once in the Hebrew Bible (Isa 28:16) and has zero direct LXX equivalents in `lxx_concordance` (`mt_minus`). Instead, LXX substitutes `ἐκλεκτὸν` ("chosen") and adds `ἔντιμον` ("honored/precious", `lxx_plus_expansion`, `sum_idf = 10.04`).
   * **Unique rendering of `פִּנַּת` (`H6438`)**: Across 31 LXX verses, `H6438` is normally `γωνία` (20x, mean stability `0.996`). Only in Isaiah 28:16 is `פִּנַּת` rendered `ἀκρογωνιαῖον` (`G0204`, `p_g_given_h = 0.037`, `g_idf = 14.9`), a rare compound adjective meaning "at the extreme corner."
   * `יִקְרַת` (`H3368`) is rendered `πολυτελῆ` ("costly/precious"), and `מוּסָד מוּסָּד` is restructured into `εἰς τὰ θεμέλια αὐτῆς`.
3. **Theological Shift at the Climax (`הַמַּאֲמִין לֹא יָחִישׁ` → `καὶ ὁ πιστεύων ἐπ’ αὐτῷ οὐ μὴ καταισχυνθῇ`)**:
   * **LXX plus (`ἐπ’ αὐτῷ`)**: MT has only the absolute participle `הַמַּאֲמִין` ("the one who trusts/believes") without an explicit object; LXX supplies `ἐπ’ αὐτῷ` ("on it / on him"), personalizing or specifying the stone as the object of trust.
   * **Unique rendering of `יָחִישׁ` (`H2363`)**: `H2363` (`חוּשׁ`, "to hasten") is rendered across the LXX by `προσέχω` (5x), `σπεύδω`, `ὁρμάω`, `σῴζω`, etc. **Only in Isaiah 28:16** is `H2363` rendered by `καταισχύνω` ("to be put to shame", `p_g_given_h = 0.0526`, `g_idf = 8.69`). Conversely, `καταισχύνω` (`G2617`) normally translates `בּוֹשׁ` (`H0954`, 6x), `קָלוֹן` (`H7036`, 3x), or `קָלָה` (`H7034`, 1x).

#### (c) New Testament Citations & Divergences
* **1 Peter 2:6**: `Ἰδοὺ τίθημι ἐν Σιὼν λίθον ἐκλεκτὸν ἀκρογωνιαῖον ἔντιμον καὶ ὁ πιστεύων ἐπ᾿ αὐτῷ οὐ μὴ καταισχυνθῇ`
  * **Follows LXX against MT**: Preserves `ἐκλεκτὸν`, `ἀκρογωνιαῖον`, `ἔντιμον`, `ἐπ᾿ αὐτῷ`, and the exact LXX negative subjunctive `οὐ μὴ καταισχυνθῇ`.
  * **Omits LXX elements / adapts**: Drops `πολυτελῆ`, drops both occurrences of `εἰς τὰ θεμέλια [αὐτῆς]`, swaps order of `ἐκλεκτὸν` and `ἀκρογωνιαῖον` (LXX has `πολυτελῆ ἐκλεκτὸν ἀκρογωνιαῖον ἔντιμον`; 1 Pet 2:6 has `ἐκλεκτὸν ἀκρογωνιαῖον ἔντιμον`, matching the `ἐκλεκτὸν ἔντιμον` pair already introduced in 1 Pet 2:4).
  * **Opening formula shared with Romans 9:33**: Both 1 Peter 2:6 and Romans 9:33 open with `Ἰδοὺ τίθημι ἐν Σιὼν λίθον` instead of LXX `ἐγὼ ἐμβαλῶ εἰς τὰ θεμέλια Σιὼν λίθον`. This restores MT's `הִנְנִי` (`Ἰδοὺ`) and uses present indicative `τίθημι` (`G5087`, "I lay/place") rather than LXX's future `ἐμβαλῶ`.
* **Romans 9:33**: `Ἰδοὺ τίθημι ἐν Σιὼν λίθον προσκόμματος καὶ πέτραν σκανδάλου καὶ ὁ πιστεύων ἐπ᾿ αὐτῷ οὐ καταισχυνθήσεται`
  * Shares `Ἰδοὺ τίθημι ἐν Σιὼν λίθον` and `καὶ ὁ πιστεύων ἐπ᾿ αὐτῷ` with 1 Peter 2:6 / LXX, replaces the architectural modifiers (`ἐκλεκτὸν ἀκρογωνιαῖον ἔντιμον`) with **Isaiah 8:14** (`λίθον προσκόμματος καὶ πέτραν σκανδάλου`), and shifts LXX's aorist subjunctive `οὐ μὴ καταισχυνθῇ` to future indicative `οὐ καταισχυνθήσεται`.
* **Romans 10:11**: `Πᾶς ὁ πιστεύων ἐπ᾿ αὐτῷ οὐ καταισχυνθήσεται`
  * Quotes only the final clause of Isaiah 28:16 in the exact form of Romans 9:33 (`οὐ καταισχυνθήσεται`, following LXX `καταισχυν-` + `ἐπ᾿ αὐτῷ` against MT `יָחִישׁ`), adding universalizing `Πᾶς` ("everyone") to support the Jew/Greek inclusion argument in Rom 10:12.

*(Interpretive Hypothesis)*: The identical opening `Ἰδοὺ τίθημι ἐν Σιὼν λίθον` in both Romans 9:33 and 1 Peter 2:6—diverging identically from Rahlfs LXX `ἐγὼ ἐμβαλῶ εἰς τὰ θεμέλια Σιὼν λίθον` while retaining LXX's `ὁ πιστεύων ἐπ᾿ αὐτῷ` and `καταισχυν-`—suggests either (i) a shared early Christian Greek *testimonia* stone tradition/recension already combining Hebraizing corrections (`הִנְנִי` → `Ἰδοὺ`; `יִסַּד` → `τίθημι`) with LXX endings, or (ii) literary acquaintance between Romans 9:33 and 1 Peter 2:6–8. Similarly, LXX's `καταισχυνθῇ` for MT `יָחִישׁ` may reflect either an interpretive rendering of "not hurrying/panicking" as "not being shamed" or a Hebrew Vorlage/reading confusing/exchanging `יחיש` with `יבוש` (`בּוֹשׁ`, `H0954`).

---

### 2. Isaiah 8:14 → Romans 9:32–33; 1 Peter 2:8

#### (a) Attested Textual Evidence (MT vs. LXX)
* **Hebrew MT (Isaiah 8:14)**:
  `וְהָיָ֖ה לְמִקְדָּ֑שׁ וּלְאֶ֣בֶן נֶ֠גֶף וּלְצ֨וּר מִכְשׁ֜וֹל לִשְׁנֵ֨י בָתֵּ֤י יִשְׂרָאֵל֙ לְפַ֣ח וּלְמוֹקֵ֔שׁ לְיוֹשֵׁ֖ב יְרוּשָׁלִָֽם׃`
  * Key tokens: `וְהָיָה` (`H1961`, "and he will be"), `לְמִקְדָּשׁ` (`H4720`, "a sanctuary"), `וּלְאֶבֶן` (`H0068`, "and a stone of"), `נֶגֶף` (`H5063`, "striking"), `וּלְצוּר` (`H6697`, "and a rock of"), `מִכְשׁוֹל` (`H4383`, "stumbling"), `לִשְׁנֵי בָתֵּי יִשְׂרָאֵל` ("for the two houses of Israel"), `לְפַח` (`H6341`, "trap") `וּלְמוֹקֵשׁ` (`H4170`, "and snare").
* **Greek LXX (Isaias 8:14, Rahlfs)**:
  `καὶ ἐὰν ἐπ᾿ αὐτῷ πεποιθὼς ᾖς, ἔσται σοι εἰς ἁγίασμα, καὶ οὐχ ὡς λίθου προσκόμματι συναντήσεσθε αὐτῷ, οὐδὲ ὡς πέτρας πτώματι. ὁ δὲ οἶκος Ἰακὼβ ἐν παγίδι, καὶ ἐν κοιλάσματι ἐγκαθήμενοι ἐν Ἰερουσαλήμ·`

#### (b) Linguistic & Theological Shifts (MT → LXX)
1. **Syntactic & Theological Reversal (`lxx_plus_expansion`)**:
   * **MT** presents YHWH (from v. 13) unconditionally as *both* a sanctuary (`לְמִקְדָּשׁ`) *and* a stone of striking (`לְאֶבֶן נֶגֶף`) and rock of stumbling (`לְצוּר מִכְשׁוֹל`) to both houses of Israel (`לִשְׁנֵי בָתֵּי יִשְׂרָאֵל`).
   * **LXX** inserts a conditional clause (`καὶ ἐὰν ἐπ᾿ αὐτῷ πεποιθὼς ᾖς`, "and if you trust in him") and **negates** the stumbling clause (`καὶ οὐχ ὡς λίθου προσκόμματι συναντήσεσθε αὐτῷ, οὐδὲ ὡς πέτρας πτώματι`, "and you shall *not* encounter him as a stumbling of a stone, nor as a falling of a rock"), shifting the trap/snare onto `ὁ δὲ οἶκος Ἰακὼβ` ("the house of Jacob") rather than "both houses of Israel."
2. **Lexical Shifts**:
   * `נֶגֶף` (`H5063`) → `προσκόμματι` (`πρόσκομμα`, `G4348`): attested in LXX Isa 8:14 (this is the *only* place `H5063` is rendered `πρόσκομμα` in LXX; elsewhere `πληγή`, `θραῦσις`, etc., though verbal `נָגַף` `H5062` is rendered `προσκόπτω` `G4350` 15x).
   * `מִכְשׁוֹל` (`H4383`) → `πτώματι` (`πτῶμα`, "fall"): a `lexical_theological_shift` unique to Isaiah 8:14 (`p_g_given_h = 0.0714`, `g_idf = 10.44`). Normally `H4383` is rendered `κόλασις` (5x) or `σκάνδαλον` (3x: Lev 19:14; 1 Sam 25:31; Ps 118:165 LXX).
   * `וּלְמוֹקֵשׁ` (`H4170`) → `κοιλάσματι` ("hollow/pit", `p_g_given_h = 0.0333`, `g_idf = 14.9`), whereas `H4170` is normally `σκάνδαλον` (9x) or `παγίς` (9x).
   * `לְיוֹשֵׁב` (`H3427`) → `ἐγκαθήμενοι` (`ἐγκάθημαι`, "sitting in wait/lying in ambush", `p_g_given_h = 0.0171`).

#### (c) New Testament Citations & Divergences (Rom 9:32–33; 1 Pet 2:8)
Both **Romans 9:33** (`λίθον προσκόμματος καὶ πέτραν σκανδάλου`) and **1 Peter 2:8** (`λίθος προσκόμματος καὶ πέτρα σκανδάλου`, echoed in **Rom 9:32** `προσέκοψαν τῷ λίθῳ τοῦ προσκόμματος`) show a striking **hybrid MT/LXX profile**:
1. **Follows MT against LXX syntax**: Both NT passages **reject** the LXX's added negation (`καὶ οὐχ ὡς ... συναντήσεσθε`) and restore the MT's positive statement that the stone/rock *is* a stumbling obstacle for the unbelieving/disobedient.
2. **Follows MT against LXX lexicon (`σκάνδαλον` vs. `πτῶμα`)**: Instead of LXX Isa 8:14's `πέτρας πτώματι`, both Rom 9:33 and 1 Pet 2:8 use `πέτρα(ν) σκανδάλου`. In `tri_textual_diff`, `σκανδάλου` is explicitly flagged `agrees_mt_against_lxx` (`Isaiah 8:14#MT_vs_LXX`), because `σκάνδαλον` (`G4625`) is a documented LXX equivalent of MT `מִכְשׁוֹל` (`H4383`, 3x) and `מוֹקֵשׁ` (`H4170`, 9x), whereas `πτῶμα` is an anomalous LXX shift.
3. **Follows LXX `πρόσκομμα` + structural parallel**: Both NT passages retain `λίθον/λίθος προσκόμματος` (matching LXX Isa 8:14 `λίθου προσκόμματι`), and **1 Peter 2:8** adds an exegetical gloss (`οἳ προσκόπτουσιν τῷ λόγῳ ἀπειθοῦντες εἰς ὃ καὶ ἐτέθησαν`), exploiting the cognate verb `προσκόπτω` (`G4350`, echoed also in **Rom 9:32** `προσέκοψαν`) and connecting back to `τίθημι` (`ἐτέθησαν`, v. 8; `τίθημι`, v. 6).

---

### 3. Psalm 118:22 (LXX 117:22) → Synoptics, Acts 4:11, and 1 Peter 2:4, 7

#### (a) Attested Textual Evidence (MT vs. LXX)
* **Hebrew MT (Psalm 118:22)**:
  `אֶ֭בֶן מָאֲס֣וּ הַבּוֹנִ֑ים הָ֝יְתָ֗ה לְרֹ֣אשׁ פִּנָּֽה׃`
  * Tokens: `אֶבֶן` (pos 1, `H0068`), `מָאֲסוּ` (pos 2, `H3988`, "[which] they rejected"), `הַבּוֹנִים` (pos 3, `H1129`, "the builders"), `הָיְתָה` (pos 4, `H1961`, "it has become"), `לְרֹאשׁ` (pos 5, `H7218`, "head of"), `פִּנָּה` (pos 6, `H6438`, "corner").
* **Greek LXX (Psalmi 117:22, Rahlfs)**:
  `λίθον ὃν ἀπεδοκίμασαν οἱ οἰκοδομοῦντες, οὗτος ἐγενήθη εἰς κεφαλὴν γωνίας·`
  * Notably, `tri_textual_diff` records **zero `lxx_shifts_in_sources`** for Psalm 118:22–23: LXX renders MT literally word-for-word, supplying relative pronoun `ὃν` (absent in Hebrew asyndetic relative `אֶבֶן מָאֲסוּ`), rendering `מָאַס` (`H3988`) with `ἀποδοκιμάζω` (`G0593`, 7x in LXX, mean stability `0.904`), `הַבּוֹנִים` with present participle `οἱ οἰκοδομοῦντες`, and `לְרֹאשׁ פִּנָּה` with `εἰς κεφαλὴν γωνίας` (`γωνία` for `H6438` `פִּנָּה` = standard 20x equivalence).

#### (b) New Testament Citations & Divergences
1. **Matthew 21:42, Mark 12:10–11, and Luke 20:17 (Verbatim LXX)**:
   * **Matt 21:42** and **Mark 12:10–11** reproduce **LXX Ps 117:22–23** verbatim (`Λίθον ὃν ἀπεδοκίμασαν οἱ οἰκοδομοῦντες, οὗτος ἐγενήθη εἰς κεφαλὴν γωνίας· παρὰ Κυρίου ἐγένετο αὕτη καὶ ἔστιν θαυμαστὴ ἐν ὀφθαλμοῖς ἡμῶν`), keeping the accusative attraction `Λίθον ὃν` (matching LXX's `λίθον`, even though grammatically `οὗτος` is the nominative subject of `ἐγενήθη`!). **Luke 20:17** quotes Ps 117:22 verbatim (`Λίθον ὃν...`) and omits v. 23, transitioning directly to v. 18 (stone-crushing imagery echoing Isa 8:14–15 / Dan 2:34–35).
2. **1 Peter 2:4 and 2:7 (Nominative Adaptation + Allusion)**:
   * **1 Peter 2:4** already previews Ps 118:22 by describing Christ as `λίθον ζῶντα ὑπὸ ἀνθρώπων μὲν ἀποδεδοκιμασμένον` (perfect passive participle of `ἀποδοκιμάζω` `G0593`, shared with LXX Ps 117:22, Synoptic Passion predictions [Mark 8:31; Luke 9:22; 17:25], and 1 Pet 2:7) contrasted with `παρὰ δὲ Θεῷ ἐκλεκτὸν ἔντιμον` (from Isa 28:16 LXX).
   * **1 Peter 2:7** introduces Ps 118:22 with an antithetical dative bridge (`ὑμῖν οὖν ἡ τιμὴ τοῖς πιστεύουσιν, ἀπιστοῦσιν δὲ`) linking `ἔντιμον` (v. 6) → `τιμή` (v. 7) and `πιστεύων` → `πιστεύουσιν`/`ἀπιστοῦσιν`, and **adapts** LXX `λίθον` (accusative) to **nominative `λίθος`** (`λίθος ὃν ἀπεδοκίμασαν οἱ οἰκοδομοῦντες οὗτος ἐγενήθη εἰς κεφαλὴν γωνίας`), matching the nominative `καὶ λίθος προσκόμματος καὶ πέτρα σκανδάλου` in v. 8.
3. **Acts 4:11 (Free Adaptation / MT-Closer Nominal Form)**:
   * `οὗτός ἐστιν ὁ λίθος ὁ ἐξουθενηθεὶς ὑφ᾿ ὑμῶν τῶν οἰκοδόμων, ὁ γενόμενος εἰς κεφαλὴν γωνίας`
   * Differs from LXX Ps 117:22 in three ways:
     * **Verb of rejection**: Uses `ἐξουθενηθεὶς` (`ἐξουθενέω`, "despised/treated with contempt") instead of LXX `ἀπεδοκίμασαν`. Notably, `lxx_concordance` for `H3988` (`מָאַס`) shows that LXX elsewhere renders `מָאַס` as `ἐξουθενέω` (2x: 1 Sam 8:7; 10:19) and `ἐξουδενόω` (16x)!
     * **Builders (`τῶν οἰκοδόμων` vs. LXX `οἱ οἰκοδομοῦντες`)**: Flagged by `tri_textual_diff` as `agrees_mt_against_lxx` (`Psalms 118:22#MT_vs_LXX`) because `οἰκοδόμων` (noun `οἰκοδόμος`, "builders") matches the nominal/substantive force of MT `הַבּוֹנִים` without adopting the LXX's verbal participle `οἱ οἰκοδομοῦντες`.
     * **Rhetorical recasting**: Converts the relative clause into a direct predicate (`οὗτός ἐστιν ὁ λίθος ὁ ... ὑφ᾿ ὑμῶν τῶν οἰκοδόμων`), identifying the Sanhedrin leaders as "you builders."

*(Catchword / Structural Linkage)*: `get_Connection` verifies a direct lexical bridge between **Isaiah 28:16** and **Psalm 118:22** via the shared rare Hebrew noun **`פִּנָּה` (`H6438`, "corner", 29 OT verses)** alongside `אֶבֶן` (`H0068`, "stone"). In Hebrew, Isa 28:16 (`פִּנַּת יִקְרַת`) and Ps 118:22 (`רֹאשׁ פִּנָּה`) share the exact catchword `פִּנָּה`; in the LXX, however, Isa 28:16 translates `פִּנַּת` as `ἀκρογωνιαῖον` while Ps 117:22 translates `פִּנָּה` as `γωνίας`, preserving the Greek root `γων-` (`γωνία` / `ἀκρογωνιαῖος`) across both texts.

---

### 4. Habakkuk 2:4 (+ Habakkuk 2:3 & Isaiah 26:20) → Romans 1:17; Galatians 3:11; Hebrews 10:37–39

#### (a) Attested Textual Evidence (MT vs. LXX)
* **Hebrew MT (Habakkuk 2:4)**:
  `הִנֵּ֣ה עֻפְּלָ֔ה לֹא־ יָשְׁרָ֥ה נַפְשׁ֖וֹ בּ֑וֹ וְצַדִּ֖יק בֶּאֱמוּנָת֥וֹ יִחְיֶֽה׃`
  * Tokens: `הִנֵּה` (pos 1, `H2009`), `עֻפְּלָה` (pos 2, `H6075`, "is swollen/puffed up" — Pual perf. 3fs), `לֹא־` (pos 3, `H3808`), `יָשְׁרָה` (pos 4, `H3474`, "is upright"), `נַפְשׁוֹ` (pos 5, `H5315`, "his soul" — 3ms suffix), `בּוֹ` (pos 6, `H9033`, "in him" — 3ms suffix), `וְצַדִּיק` (pos 7, `H6662`, "and [the] righteous"), `בֶּאֱמוּנָתוֹ` (pos 8, `H0530`, "by his faithfulness/steadfastness" — 3ms suffix), `יִחְיֶה` (pos 9, `H2421`, "he will live").
* **Greek LXX (Habacuc 2:4, Rahlfs)**:
  `ἐὰν ὑποστείληται, οὐκ εὐδοκεῖ ἡ ψυχή μου ἐν αὐτῷ· ὁ δὲ δίκαιος ἐκ πίστεώς μου ζήσεται.`

#### (b) Linguistic & Theological Shifts (MT → LXX)
Every clause of Habakkuk 2:4 undergoes a major shift in the Septuagint:
1. **`עֻפְּלָה` (`H6075`) → `ἐὰν ὑποστείληται` ("if he shrinks back")**:
   * `H6075` (`עָפַל`, "to swell/presume") occurs only twice in the OT: Num 14:44 (`διαβιάζομαι`, "acted presumptuously") and Hab 2:4 (`ὑποστέλλω`, "draw back/shrink back", stability `0.956`). The LXX converts MT's declarative accusation of arrogance (`הִנֵּה עֻפְּלָה`, "behold, it is puffed up") into a conditional warning against cowardice/retreat (`ἐὰν ὑποστείληται`). *(Interpretive hypothesis: possibly reading `עֻפְּלָה` via a different root/Vorlage such as `עָלַף` "faint" or `עָפֵל` "sluggish/timid", or contextualizing to Hab 2:3's wait for the vision).*
2. **`לֹא־יָשְׁרָה נַפְשׁוֹ בּוֹ` → `οὐκ εὐδοκεῖ ἡ ψυχή μου ἐν αὐτῷ`**:
   * **Lexical shift (`יָשְׁרָה` `H3474` → `εὐδοκεῖ`)**: `H3474` ("to be straight/upright") is normally rendered `ἀρέσκω` (6x), `εὐθύς` (5x), or `κατευθύνω` (5x); **only in Habakkuk 2:4** is it rendered `εὐδοκέω` (`p_g_given_h = 0.037`, `g_idf = 9.02`), transforming "his soul is not upright in him" into "my soul takes no pleasure in him."
   * **Pronoun Person Shifts (`3ms` → `1sg`)**: `tri_textual_diff` documents three `pronoun_person_shift` transformations in Hab 2:4:
     * `נַפְשׁוֹ` ("his soul", 3ms) → `ἡ ψυχή μου` ("my soul", 1sg — transferring the `ψυχή` from the arrogant person to God!).
     * `בּוֹ` ("in him/it", 3ms) combined with `נַפְשׁוֹ` realignment → `ἐν αὐτῷ` ("in him", referring to the one who shrinks back).
     * `בֶּאֱמוּנָתוֹ` ("by his faithfulness", 3ms) → `ἐκ πίστεώς μου` ("by my faithfulness / faith in me", 1sg).
   * In `H0530` (`אֱמוּנָה`), `lxx_concordance` shows `ἀλήθεια` (22x) and `πίστις` (19x, stability `0.995`) as top equivalents; Hab 2:4 uses `πίστις`, shifting the grammatical person of the pronominal suffix from 3ms (the righteous person's steadfastness) to 1sg (God's faithfulness, or faith directed toward God).
3. **Antecedent Context: Habakkuk 2:3 (`MT → LXX`)**:
   * **MT**: `כִּי־בֹא יָבֹא לֹא יְאַחֵר` ("for it [the vision, `חָזוֹן`] will surely come; it will not delay").
   * **LXX**: `ὅτι ἐρχόμενος ἥξει καὶ οὐ μὴ χρονίσῃ` — `וְיָפֵחַ` (`H6315`) → `ἀνατελεῖ` (`p_g_given_h = 0.0714`), `יְכַזֵּב` (`H3576`) → `κενόν` (`p_g_given_h = 0.0588`), and `בֹא יָבֹא` (`H0935`) → `ἐρχόμενος ἥξει` (`p_g_given_h = 0.0749`). Critically, the masculine participle `ἐρχόμενος` (agreeing grammatically in Hebrew with masc. `חָזוֹן` "vision", or impersonalized in Greek as "the coming one" — contrasted with feminine `ὅρασις` in LXX v. 3a!) enables a **personal messianic reading** ("the Coming One will come").

#### (c) New Testament Citations & Divergences
1. **Romans 1:17 and Galatians 3:11**:
   * Both quote only the second clause: `ὁ δὲ δίκαιος ἐκ πίστεως ζήσεται` (Rom 1:17 has `Ὁ δὲ δίκαιος ἐκ πίστεως ζήσεται`; Gal 3:11 omits `δέ` inside `ὅτι Ὁ δίκαιος ἐκ πίστεως ζήσεται`).
   * **Divergence from both MT and Rahlfs LXX**: Neither Paul's Romans 1:17 nor Galatians 3:11 contains `μου` (LXX `ἐκ πίστεώς μου`) or `αὐτοῦ` (rendering MT 3ms `בֶּאֱמוּנָתוֹ`). Both read `ἐκ πίστεως` without any possessive pronoun.
   * **Framing adaptation in Rom 1:17**: Paul introduces the quote with `δικαιοσύνη γὰρ Θεοῦ ἐν αὐτῷ ἀποκαλύπτεται ἐκ πίστεως εἰς πίστιν`, hooking directly into `δίκαιος` (`δικαιοσύνη`) and `ἐκ πίστεως` from Hab 2:4.
2. **Hebrews 10:37–39**:
   * **Hebrews 10:37 (`Composite Splice`: Isaiah 26:20 LXX + Habakkuk 2:3 LXX)**:
     * `ἔτι γὰρ μικρὸν ὅσον ὅσον, ὁ ἐρχόμενος ἥξει καὶ οὐ χρονίσει`
     * **Isaiah 26:20**: MT has `חֲבִי כִמְעַט־רֶגַע` ("hide for a little moment"); LXX Isaias 26:20 has `ἀποκρύβηθι μικρὸν ὅσον ὅσον` ("hide for a very little while"). Hebrews 10:37 splices `μικρὸν ὅσον ὅσον` from LXX Isa 26:20 directly after `ἔτι [γὰρ]` from LXX Hab 2:3 (`διότι ἔτι ὅρασις...`).
     * **Habakkuk 2:3 LXX**: Hebrews adopts LXX's `ἐρχόμενος ἥξει καὶ οὐ ... χρονίσει` (against MT's impersonal `חָזוֹן` "vision"), **adding the definite article `ὁ`** (`ὁ ἐρχόμενος`, "the Coming One") to make the messianic/parousia subject explicit, and changing LXX's aorist subjunctive `οὐ μὴ χρονίσῃ` to simple future indicative `οὐ χρονίσει` (mirroring the mood shift in Rom 9:33 `οὐ καταισχυνθήσεται`).
   * **Hebrews 10:38 (Follows LXX against MT + Clause Inversion + Pronoun Transposition)**:
     * `ὁ δὲ δίκαιός μου ἐκ πίστεως ζήσεται, καὶ ἐὰν ὑποστείληται, οὐκ εὐδοκεῖ ἡ ψυχή μου ἐν αὐτῷ.`
     * **Follows LXX against MT**: Retains all three distinctive LXX Hab 2:4 shifts—`ὑποστείληται` (for MT `עֻפְּלָה`), `οὐκ εὐδοκεῖ ἡ ψυχή μου` (for MT `לֹא־יָשְׁרָה נַפְשׁוֹ`), and the 1sg pronoun `μου`.
     * **Clause Inversion**: In both MT and Rahlfs LXX Habakkuk 2:4, the negative/arrogant/shrinking-back clause comes **first**, and `וְצַדִּיק` / `ὁ δὲ δίκαιος` comes **second**. Hebrews 10:38 **reverses the two halves**, placing `ὁ δὲ δίκαιός μου ἐκ πίστεως ζήσεται` first and `καὶ ἐὰν ὑποστείληται...` second.
     * **Pronoun Transposition**: Rahlfs LXX reads `ὁ δὲ δίκαιος ἐκ πίστεώς μου ζήσεται` (`μου` modifying `πίστεως`, "my faithfulness"); Hebrews 10:38 reads `ὁ δὲ δίκαιός μου ἐκ πίστεως ζήσεται` (`μου` modifying `δίκαιος`, "my righteous one"). *(Note: textual witnesses such as Codex Alexandrinus of LXX Hab 2:4 also place `μου` after `δίκαιος`, so this may reflect an existing Greek textual variant rather than an independent alteration by Hebrews).*
   * **Hebrews 10:39 (Rhetorical Echo / Adaptation)**:
     * `ἡμεῖς δὲ οὐκ ἐσμὲν ὑποστολῆς εἰς ἀπώλειαν ἀλλὰ πίστεως εἰς περιποίησιν ψυχῆς`
     * Reuses the nominal cognate `ὑποστολή` (`G5289`, NT hapax legomenon, echoing LXX Hab 2:4 `ὑποστείληται`, `G5288`—whose only other NT occurrences are Acts 20:20, 27 and Gal 2:12), `πίστις` (`G4102`), and `ψυχή` (`G5590`), flipping the clause order back so that shrinking back comes first (negated) and faith/soul-preservation ends the pericope.

---

## Physical & Architectural Analogies vs. Theological Claims

* **Masonry / Temple Building Domain (`Isa 28:16`, `Ps 118:22`, `1 Pet 2:4–8`)**: In the physical domain, `אֶבֶן` / `λίθος` denotes a cut building stone; `מוּסָד` / `θεμέλιον` denotes a structural foundation; `פִּנָּה` / `ἀκρογωνιαῖος` / `κεφαλὴ γωνίας` denotes a primary corner/bonding stone or capstone evaluated by builders (`הַבּוֹנִים` / `οἱ οἰκοδομοῦντες`). `1 Peter 2:4–5` explicitly signals metaphorical/analogical transfer (`λίθον ζῶντα`, `ὡς λίθοι ζῶντες οἰκοδομεῖσθε οἶκος πνευματικός`).
* **Obstacle / Hunting Domain (`Isa 8:14`, `Rom 9:32–33`, `1 Pet 2:8`)**: `אֶבֶן נֶגֶף` / `λίθος προσκόμματος` and `צוּר מִכְשׁוֹל` / `πέτρα σκανδάλου` (`פַּח` / `מוֹקֵשׁ`) belong to physical tripping hazards and bird/animal traps. In `Isa 8:14`, `Rom 9:32–33`, and `1 Pet 2:8`, these physical hazards serve as analogies for encountering divine action or "stumbling at the word" (`προσκόπτουσιν τῷ λόγῳ`).

---

## Interpretive Hypotheses (Explicitly Separated from Attested Evidence)

1. **Shared Christian Stone *Testimonia* vs. Literary Dependence (`Rom 9:33` & `1 Pet 2:6–8`)**: Because *both* Romans 9:33 and 1 Peter 2:6 open Isaiah 28:16 with the identical non-LXX phrase `Ἰδοὺ τίθημι ἐν Σιὼν λίθον` and *both* render Isaiah 8:14 as `λίθος/ν προσκόμματος καὶ πέτρα/ν σκανδάλου` (following MT `מִכְשׁוֹל` with `σκάνδαλον` instead of LXX `πτώματι`, and dropping LXX's negative `οὐχ`), it is a plausible hypothesis that either (a) a pre-Pauline/early-Christian Greek stone *testimonium* already harmonized Isa 28:16 and Isa 8:14 toward the Hebrew, or (b) 1 Peter drew directly on Romans 9:33 while expanding the chain with 1 Pet 2:6's fuller LXX Isa 28:16 and 1 Pet 2:7's Ps 118:22.
2. **Paul's Omission of `μου` in Habakkuk 2:4 (`Rom 1:17`; `Gal 3:11`)**: Paul may have omitted `μου` either because his Greek Vorlage lacked it, or intentionally to leave `ἐκ πίστεως` open to his Christ-faith / faith-righteousness antithesis (`ἐκ πίστεως` vs. `ἐξ ἔργων νόμου`).
3. **Hebrews 10:37–38 Clause Inversion & Messianic Re-reading**: By splicing `μικρὸν ὅσον ὅσον` (Isa 26:20 LXX) with `ὁ ἐρχόμενος` (Hab 2:3 LXX + definite article) and reversing the two clauses of Hab 2:4 LXX, the author of Hebrews restructures an exhortation about a coming *vision* into a two-stage eschatological choice: faithful endurance leading to life (transitioning into Heb 11's `πίστις` catalog) vs. apostate shrinking back (`ὑποστολή`).

---

## Toolset Self-Assessment

1. **Which MCP tools worked best and what were their strengths?**
   * **`research` (`op: "tri_textual_diff"`)**: Exceptionally strong for token-by-token alignment across NT, LXX, and MT (`agrees_both`, `agrees_lxx_against_mt`, `agrees_mt_against_lxx`, `composite_splice`, `nt_adaptation`) and automatic surfacing of `lxx_shifts_in_sources` (`lexical_theological_shift`, `pronoun_person_shift`, `lxx_plus_expansion`, `mt_minus`). It immediately isolated `σκανδάλου` (Rom 9:33; 1 Pet 2:8), `οἰκοδόμων` (Acts 4:11), `δικαιοσύνη` (Rom 1:17), `ἐκλεκτὸν`/`ἔντιμον`/`καταισχυνθῇ` (1 Pet 2:6), and `ἥξει`/`εὐδοκεῖ` (Heb 10:37–38).
   * **`research` (`op: "lxx_concordance"`)**: Outstanding for testing whether an LXX rendering is standard or anomalous (`p_g_given_h`, `mean_stability`, `g_idf`). It proved empirically that `H2363` → `καταισχύνω` (Isa 28:16), `H6438` → `ἀκρογωνιαῖος` (Isa 28:16), `H4383` → `πτῶμα` (Isa 8:14), and `H3474` → `εὐδοκέω` (Hab 2:4) are **1-of-a-kind shifts** in the entire LXX, whereas `σκάνδαλον` is a standard LXX equivalent of `H4383`/`H4170`.
   * **`research` (`op: "lxx"`)** and **`get_Passage` (`view="evidence"`)**: Essential for verifying full verse texts, Strong's numbers, and surrounding pericope context (e.g., Rom 9:30–32, 1 Pet 2:4–5, Heb 10:35–36, 39, Isa 26:20).
   * **`get_Connection`**: Useful for multi-anchor graph verification (connecting `Isa 28:16`, `Isa 8:14`, `Ps 118:22`, `1 Pet 2:6–8`, and `Rom 9:33` via 6 independent edges including the shared Hebrew catchword `H6438` `פִּנָּה`).

2. **Observed Tool Limitations, Edge Cases, or Data Discrepancies**:
   * **Swapped Strong's metadata in `1 Peter 2:6` (pos 10–11)**: `get_Passage` (`1 Pet 2:6`), `occurrences` (`G0204`), and `tri_textual_diff` (`1 Pet 2:6`) tag token pos 10 (`ἐκλεκτὸν`) with `G0204` (`ἀκρογωνιαῖος`) and pos 11 (`ἀκρογωνιαῖον`) with `G1588` (`ἐκλεκτός`). Because of that metadata swap, `occurrences` for `G0204` matched `ἐκλεκτὸν` rather than `ἀκρογωνιαῖον` in 1 Pet 2:6, and `tri_textual_diff` marked `ἀκρογωνιαῖον` as `nt_adaptation` instead of `agrees_lxx_against_mt`.
   * **Partial splice detection in `Rom 9:33` and `Heb 10:37–38`**: In `Rom 9:33`, `tri_textual_diff` listed both `Isa 28:16` and `Isa 8:14` under `candidate_sources`, but only emitted a splice for `Isa 8:14`, labeling the `Isa 28:16` opening (`τίθημι ἐν Σιὼν`) and closing (`οὐ καταισχυνθήσεται`) as `nt_adaptation` or attributing `τίθημι ἐν Σιὼν ... καὶ ὁ πιστεύων` to `Isa 8:14` (contrast `1 Pet 2:6–8`, where the 3-source splice succeeded cleanly). Similarly, in `Heb 10:37–38` with `sources: ["Isa26:20", "Hab2:3", "Hab2:4"]`, `tri_textual_diff` missed the `Isa 26:20` splice for `μικρὸν ὅσον ὅσον` (likely because `ὅσον ὅσον` was marked `unmatched` in the underlying `Isa 26:20` MT↔LXX alignment), and marked `μου` after `δίκαιός` as `nt_adaptation` due to word-order difference from Rahlfs LXX `πίστεώς μου`.
   * **Token-level MT↔LXX alignment noise in `lxx` op**: In `lxx` (`Isa 28:16`), `בֹּחַן` was aligned to `ἀκρογωνιαῖον` while `פִּנַּת` was marked `unmatched`, and `מוּסָד` was aligned to `πιστεύων` while `הַמַּאֲמִין` was marked `unmatched`—even though `lxx_shifts_in_sources` inside `tri_textual_diff` got the true pairings (`פִּנַּת` → `ἀκρογωνιαῖον`, `יָחִישׁ` → `καταισχυνθῇ`, `יִסַּד` → `θεμέλια`) right!
   * **Orthographic / punctuation quirks in Rahlfs LXX text**: Minor punctuation/accent artifacts appear in `Isa 28:16` LXX (`εἷς τὰ. θεμέλια`, `εἷς τὸ, θεμέλια`, `καὶ ὃ πιστεύων ... οὔ μὴ`).
   * **Windows PowerShell CLI quoting**: Passing JSON `--args` with spaces inside values failed under PowerShell native command splitting; compact space-free Bible references (`Isa28:16`, `1Pet2:6-8`) solved this cleanly.
