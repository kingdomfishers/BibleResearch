# BibleOntology Upstream Provenance, Reuse Validation & Licensing Notice (R1)

This directory contains our audited, minimal adaptation of `bibleontology/bibleontology` for offline syntactic clause, phrase-head, coordination, negation, and modality extraction (`RELATIONSHIP_ARCHITECTURE.md` v5.0 §§3, 6, 14).

## 1. Pinned Upstream Repository

- **Repository**: `https://github.com/bibleontology/bibleontology`
- **Pinned Commit**: `62d6bc0fba5f84dfad245e546e87c6212b35fa75` (`2026-04-20T15:39:10Z`)
- **Reuse Decision**: **APPROVED for offline syntactic S0/S1 + S2 negation/modality + S4 speech-frame extraction ONLY**, with mandatory safety overrides documented below. Editorial and AI-assisted claim exports (`out/export/*`) and English-aligned S6 readings (`s6_readings.py`) are **NOT** ingested as native grammatical evidence.

## 2. Evaluated Upstream Files & Checksums (LF-normalized SHA-256)

| Upstream Path | License | Bytes (LF) | SHA-256 (LF) | Role in R1/R2 |
|---|---|---:|---|---|
| `LICENSE` | Apache-2.0 | 11,358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | Code license text |
| `LICENSING.md` | CC-BY-4.0 / Apache-2.0 | 5,278 | `eb4a1e7d204cc0c07ba072fee31e0b94eb5be86935745c4df1fe4ea3b3dffc83` | Folder-by-folder license map |
| `NOTICE` | Upstream notices | 5,505 | `b11481f45dedd79446452b5d19000dea55674acfbaae08a2ce7398e6a5552fe4` | Required third-party notices |
| `SOURCES.md` | CC-BY-4.0 | 20,845 | `be5b0e3bf7b1d2bd3538fb8aa79d6f7f6100cb8fd0ab57c46489a8b5afeba20` | Upstream dataset provenance |
| `data/macula-manifest.json` | CC-BY-4.0 | 2,769 | `66c7c490d8924e860e6870868e72e440d2a806ee3254eab1142dd13dc88c5c84` | Upstream MACULA pin check |
| `tools/builder/source.py` | Apache-2.0 | 4,030 | `8cf02c20ea280f10441851f42f43156eb7290572b14d60901c63f55c754a9860` | S0 source normalization |
| `tools/builder/s1_clauses.py` | Apache-2.0 | 26,905 | `a8c8cc85133de62e406604e8feab5272abff1691daf6804abb4286c5f77f0b26` | S1 clauses, roles, heads, coordination |
| `tools/builder/s2_s3.py` | Apache-2.0 | 20,465 | `9ae74b4dbb8b8a4cba229eeb5af88fe344dc5a38dcbf96983209d939b35735ce` | S2 negation & sentence force |
| `tools/builder/s4_s5.py` | Apache-2.0 | 26,430 | `205f1a8e726263d67e13c35ad73842193e55f414ed9c72b0ac462432eee5d210` | S4 speech-verb turn detection |
| `tools/builder/tables/hebrew/heads.json` | Apache-2.0 / CC-BY-4.0 | 1,873 | `43214eb0fc79e8592cd6e8f787ea159d1e18dd8b1b49defc9b97973498c657dc` | Hebrew phrase-head rules |
| `tools/builder/tables/greek/heads.json` | Apache-2.0 / CC-BY-4.0 | 2,043 | `ed25499615bbb8020a43a12944974ef600a5a5c0f33e0ddc263c344f69954492` | Greek phrase-head rules |
| `tools/builder/tables/hebrew/lexicon.json` | Apache-2.0 / CC-BY-4.0 | 4,391 | `8973e773a48cb41bccced9f4d73fe6100e06800385c348b7bc9beeaf252ec87b` | Hebrew function words, negators, speech verbs |
| `tools/builder/tables/greek/lexicon.json` | Apache-2.0 / CC-BY-4.0 | 6,193 | `693348fa6974ea9dd827602e784c9a46b4d5ba2ade8efb8032b08ff56dd4225f` | Greek function words, negators, speech verbs |

## 3. Copied Upstream `NOTICE` & Attribution Statements

Credit required by `LICENSING.md`: **Bible Ontology by Doug Egge (`bibleontology.org`)**.
Adapted code in `s0_s1_s2_builder.py` is licensed under **Apache License, Version 2.0**.
Phrase-head and function-word tables extracted into `heads_and_lexicon.json` are licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)** with upstream attributions preserved verbatim below:

```text
Bible Ontology
https://bibleontology.org
Copyright 2026 Doug Egge, in the selection, arrangement and additions

The code in this repository is licensed under the Apache License, Version 2.0
(LICENSE). The graph, the vocabularies and the written material are licensed
under Creative Commons Attribution 4.0 International (LICENSE-DATA). Which
licence covers which folder is set out in LICENSING.md.

Credit for this project: Bible Ontology by Doug Egge (bibleontology.org).

This repository includes, or includes data derived from, the works below. Each
keeps its own terms; SOURCES.md gives them in full, with what was read from
each and what was changed.

-------------------------------------------------------------------------------
MACULA

MACULA Hebrew Linguistic Datasets, available at
https://github.com/Clear-Bible/macula-hebrew/

MACULA Greek Linguistic Datasets, available at
https://github.com/Clear-Bible/macula-greek/

(c) 2022-2024 Biblica, Inc. Licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Read as released, from the
pinned tags in data/macula-manifest.json; this project derives clause
structure, phrases and word-level layers from them. Biblica does not endorse
this project.

Within MACULA: the Westminster Leningrad Codex; the Westminster Hebrew Syntax,
(c) 1991-2018 The J. Alan Groves Center for Advanced Biblical Research, CC BY
4.0; the OpenScriptures Hebrew Bible morphology, CC BY 4.0; the Nestle 1904
Greek New Testament (transcription by Diego Santos, morphology by Ulrik
Sandborg-Petersen, markup by Jonathan Robie); English glosses from the Berean
Interlinear Bible and Cherith Glosses by Andi Wu, (c) 2022-2023 Cherith
Analytics, CC BY 4.0.
```

*(Note: BibleResearch excludes WordNet verb classes, `ontology/entities/entities.jsonl`, and `out/export/*` claims from `third_party/bibleontology/`.)*

## 4. Compatibility with Local Pinned MACULA Releases

- **MACULA Hebrew (`macula-hebrew-wlc`, `source_release_id: 7`, `edition_id: 11`)**:
  - Local pinned commit: `47db250bd55d0d8577f2a94fba114ef16c35b23c` vs BibleOntology pinned tag `26.04.13`.
  - LF-normalized SHA-256 verification shows **100% byte-for-byte identity** on matching lowfat XML files:
    - `01-Gen-001-lowfat.xml`: `523856a1f2953408d847e8d3fcc231f2bd681e540aa91c349cd9c4e128f30f60` (640,186 LF bytes — exact match).
    - `19-Psa-023-lowfat.xml`: `224d0f587d442dfdf0c1b80a5ffc817ede44bb46e54937d8be8d993c3ff5d155` (75,517 LF bytes — exact match).
  - Note: Local Windows checkout stores CRLF on disk; S0 and our inventory compute hashes after `\r\n -> \n` normalization.
- **MACULA Greek (`macula-greek-nestle1904` edition 18 & `macula-greek-sblgnt` edition 19, `source_release_id: 8`)**:
  - Local pinned commit: `8423afe47b9e8f24b7772e808af45c7159a6fe7e` vs BibleOntology pinned tag `24.06.17`.
  - LF-normalized file SHA-256 digests differ from `24.06.17` (`03-luke.xml`: `03dfe693...` vs `71372cd0...`, `04-john.xml`: `8d05ead4...` vs `8dedfc02...`, `02-mark.xml`: `6df302c2...` vs `4b7a5dcc...`).
  - XML element schema (`<sentence>`, `<wg class="cl" rule="..." role="...">`, `<w xml:id="..." ref="..." role="..." class="..." morph="..." lemma="..." strong="..." voice="..." mood="..." subjref="..." referent="...">`) is 100% compatible with S0/S1/S2. Both Greek editions are tracked separately via `edition_key` so SBLGNT and Nestle1904 are never double-counted or mixed.

## 5. Required Adaptations & Safety Overrides

1. **Reject unverified `first_child` fallback (`s1_clauses.py:head_index`)**:
   - Upstream `head_index` returns `0` whenever `@head="true"` is absent and `rule` is not in `head_last`, silently picking child 0 even when `rule` is absent from `heads.json` (for example `AdjpAdjp2` in `John 4:41`, where child 0 is dative adverbial `πολλῷ` instead of head adjective `πλείους`, or `CjpAdjp` in `Gen 20:4`, where child 0 is conjunction `גַּם`).
   - Adaptation: If a multi-child non-clause phrase has no child with `head="true"` AND its `rule` is NOT in `coord`, `head_first`, `head_last`, `prep`, or `wrap`, `resolve_phrase_heads` sets `head_resolution = "unlisted_rule_fallback:<rule>"` and `is_verified_head = False`. Any downstream R2 relation referencing an unverified head MUST be downgraded to `quality: "candidate"` (never emitted as `source_explicit` or `rule_derived`).
2. **Documented Hebrew `VerbX` verb-phrase wrapper (`Gen 3:3–4`, etc.)**:
   - Hebrew verbs with paragogic nun (e.g. `תְּמֻתֽוּן` in `Gen 3:4`) or cohortative/energetic suffix `<w class="x">` are wrapped in `<wg class="vp" role="v" rule="VerbX">` (`o010030040071` `verb` + `o010030040072` `x`). `VerbX` is explicitly added as a documented compatibility rule in `heads_and_lexicon.json` (`compatibility_extensions.hebrew.head_first: {"VerbX": "paragogic_suffix"}`) selecting the `<w class="verb">` stem token.
3. **Restrict S0/S1 attributes against `field_license_registry`**:
   - Explicitly exclude `sdbh`, `lexdomain`, `coredomain`, `contextualdomain`, `domain`, `ln`, Hebrew `frame`, and STEP TBESH restricted columns (`Meaning`). Only public morphological, syntactic, lemma, and Strong's attributes are read.
4. **No editorial/AI/translation-aligned claims**:
   - Upstream S5 pronoun guessing, S6 BSB-aligned readings, and `out/export/*` RDF/claim triples are excluded. Only S0 normalization, S1 clause/role/head/coordination structure, S2 negation and morphosyntactic modality (with upstream's rough-breathing guard for Greek `οὗ` vs `οὐ`), and S4 speech-turn boundary marking (`speech_quoted` boolean flag) are used.
5. **Deterministic non-clause scope guards**:
   - Clauses with `role="vc"` (copular verb like `εἰμί`, e.g., `Luke 8:11`, `John 6:35`) or verbless `role="p"` predicates are extracted as `GrammaticalFrameV2` (`clause_kind: "copular" | "verbless"`) and skipped for R2 SVO relation rules (`grammatical_subject_of` / `grammatical_object_of`).
   - Nested clauses occupying `role="s"` or `role="o"` (e.g., `DetCL` in `John 6:35` or `S-VC-P` under `εἶπεν` in `John 6:35`) are linked via `parent_frame_id` and never coerced into nominal subject/object edges on the outer verb.
