# Bible data provenance

Text and lexical data: [STEP Bible](https://www.STEPBible.org), based on work at Tyndale House Cambridge, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Upstream: [STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data), pinned to commit `be4191f0082aeedddb0eff0c02c966292b2bd641` (import prepared 2026-11-01). Source URLs, byte lengths, and SHA-256 digests are recorded in the generated `.artifacts/stepbible/manifest.json`.

- Hebrew/Aramaic Old Testament: TAHOT, all four parts. Uses STEP's primary readings, including Qere and supplied restorations/additions documented by STEP. This is an edited scholarly text, not a claim to recover an autograph.
- Greek New Testament: TAGNT, both parts, selecting words whose edition list includes `NA28`. STEP supplies shared spellings, punctuation, and ordering across its amalgamated text; this import is not an exact diplomatic transcription of a printed edition. Alternative edition readings are not concatenated into verses.
- Hebrew vocabulary: TBESH forms, transliterations and STEP glosses. Its separately restricted Online Bible `Meaning` column is **excluded**.
- Greek vocabulary: TBESG brief lexicon definitions, based on Abbott-Smith with STEP additions.

## Transformations

English/NRSV references supplied in the source are retained, including Psalm headings at verse 0. The resulting 31,203 records include 116 headings and reflect the selected edition's verse coverage; no empty rows are invented to force a traditional 31,102 total.

The 443,524 ordered tokens reference 150,105 distinct surface-form/morphology combinations, representing 13,913 standard Strong's numbers. Pointing, accents and punctuation are retained. Hebrew internal prefix/suffix separator slashes are removed for display. Strong's numbers are normalized to unpadded standard values (for example, `H0430G` becomes `H430`); extended source tags remain in the local token audit. The importer does not generate transliterations or glosses.

`biblical_def` contains licensed lexical text, with HTML tags removed. `english_translations` contains the source's observed renderings, ordered by frequency for that word form. It is not a list of translation-version frequencies. `physical_def` and `millennium` remain null because these sources do not establish them. No chronology is inferred from book order.

## Occurrence-specific English renderings

`node scripts/import-translations.mjs` verifies the pinned STEP source hashes,
reuses the established corpus parser, and prepares an atomic SQL import under
`.artifacts/stepbible/import-translations.sql`. It checks every occurrence against
the existing verse word-ID sequence and verifies a whole-import rendering hash.
`verse_translation_sources` retains English, grammar, source reference, and commit
for all 443,524 tokens. Empty source renderings remain empty in storage; the reader
labels untranslated grammatical particles explicitly. Source English already
includes inflected verbs, articles, prefixes, and suffixes. Display formatting
replaces segmentation slashes with spaces without rewriting the stored source.
Existing word-form alternatives remain observed renderings, not an exhaustive
dictionary. Private user overrides are stored separately from the public corpus.

## Reproduce and verify

1. Run `node scripts/etl-bible.mjs --dry-run` to download the pinned sources if absent, parse and validate all 66 books, and write the audit manifest, token records, words and verses under ignored `.artifacts/stepbible/`.
2. Run `node scripts/seed-supabase.mjs` to generate `.artifacts/stepbible/import.sql`.
3. Execute that SQL using an authenticated Supabase administrator connection or MCP `execute_sql` on project `ejoperxiwxlcbsqrkrvb`.
4. Execute `scripts/score-stepbible.sql` to compute lexical co-occurrences entirely in PostgreSQL. The top 15 partners are cached once per Strong's number on its lowest-ID representative form. Frequency counts within-verse token pairs; average distance is measured in token positions; score is `frequency / (1 + average_distance)`. RPCs resolve every inflected form to that lexical cache. The imported corpus has 674,125 distinct unordered lexical pairs.
5. Run `node scripts/verify-bible-import.mjs` to check all four RPCs and word details using the configured public key. Execute the generated `.artifacts/stepbible/verify.sql` as an administrator to compare whole-corpus identity and sequence hashes with the independent offline audit.

The importer requires **empty** `public.words` and `public.verses` and refuses to overwrite populated tables. It downloads only the pinned public files, checks their hashes and byte lengths, parses them independently in PostgreSQL, checks the offline totals, inserts both tables, and analyzes their indexes in one transaction. Temporary staging tables and the temporary `http` extension are removed at completion. A failure rolls back the import. It does not grant public write access or use a frontend service-role credential.

Generated data and the exact source files are kept out of source control. To select another Greek edition, pass `--edition=TR` or `--edition=SBL` to the ETL before generating SQL for a separate empty database. Such a selection uses STEP's shared word ordering and spelling, as described above.

## Chronology candidate source (audited, not imported)

[Theographic Bible Metadata](https://github.com/robertrouse/theographic-bible-metadata), pinned to `744355c7a5f38efd407bc67a5257c99aca9532bc`, is the proposed chronology source under CC BY-SA 4.0, with upstream notices and transformations retained. This does not replace STEP text or its attribution.

Run `node scripts/audit-chronology.mjs --download` once with network access, then `node scripts/audit-chronology.mjs` offline. The script checks exact SHA-256 hashes of `json/verses.json`, `json/events.json` and `json/books.json` before reporting coverage. Generated snapshots/report live under ignored `.artifacts/chronology-audit/` and no database is modified.

The pinned source contains 31,102 verses, 28,024 verse years and 450 events. A further 624 verses have event links but no verse year; 2,454 have neither. Event links are associations, not automatic setting-date evidence. Comparison with the local STEP audit finds 31,085 same-address candidates, including 28,007 with source years; 118 local records, including all 116 headings, have no same-address counterpart. Reference equivalence has not yet been verified.

Source verse years and event chronology have different derivations; preserve separate models and their disagreements. Use astronomical year numbering (`-4003` displays as 4004 BC), not a naive minus-sign conversion. AO Lab's Theographic API is a projection of the same source, rather than independent chronological confirmation.

The user's separately confirmed premise is Adam's creation approximately 4,000 years before the resurrection. It is not an imported historical or archaeological finding. See [the chronology design](CHRONOLOGY_ARCHITECTURE.md) for the proposed evidence UI, conditional absolute anchors, source links and unfilled coverage work.

## Biblical geography datasets

Context-aware biblical geography integrates four pinned open datasets offline into PostgreSQL (`public.geography_sources`, `public.places`, `public.place_locations`, `public.passage_geography`, `public.verse_geography`) without runtime third-party geocoding calls or AI-invented coordinates:

1. **OpenBible.info Bible-Geocoding-Data** ([openbibleinfo/Bible-Geocoding-Data](https://github.com/openbibleinfo/Bible-Geocoding-Data), pinned to commit `7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f`):
   - **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Stephen Smith / OpenBible.info); embedded geometries carrying `geometry_credit = "osm"` are licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) (`© OpenStreetMap contributors`).
   - **Files:** `data/ancient.jsonl` (1,342 disambiguated biblical places, verse references, instance types, and scholarly identification scores/votes), `data/modern.jsonl` (1,596 modern identifications with coordinates and precision), `data/geometry.jsonl` (588 regional/river/boundary metadata records and rough boundaries), and `data/source.jsonl` (442 scholarly citations).
2. **Theographic Bible Metadata** ([robertrouse/theographic-bible-metadata](https://github.com/robertrouse/theographic-bible-metadata), pinned to commit `744355c7a5f38efd407bc67a5257c99aca9532bc`):
   - **License:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by/4.0/deed.en) (Robert Rouse / Theographic).
   - **Files:** `json/places.json` (1,298 places), `json/events.json` (450 events, 305 with location links), and `json/verses.json` (4,875 verses with explicit place links), projected onto STEP versification through `data/chronology/reference-mappings.json`.
   - **Symbolic/Apocalyptic Guard:** Where Theographic links apocalyptic visions (such as `Rev.21.2` "new Jerusalem") to physical Jerusalem (`recL1WV82pXaRBQ59`), the importer cross-checks OpenBible and STEP TIPNR classifications so heavenly/symbolic entities are marked `is_non_physical = true` and never resolve to physical GPS pins.
3. **STEPBible TIPNR** ([STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data), pinned to commit `be4191f0082aeedddb0eff0c02c966292b2bd641`):
   - **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (STEPBible.org / Tyndale House Cambridge).
   - **File:** `Proper Nouns/TIPNR - Translators Individualised Proper Names with all References - STEPBible.org CC BY.txt` (783 matched geographical entities supplying original Hebrew `H...` and Greek `G...` spellings, Strong's numbers, and homonym disambiguation).
4. **Pleiades Gazetteer of Ancient Places** ([pleiades.stoa.org](https://pleiades.stoa.org), linked via OpenBible `s2428ed` and Theographic `recogitoUri`):
   - **License:** [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (Pleiades contributors).
   - **Scope:** 279 ancient Greco-Roman and Near Eastern place identifiers, URIs, and historical coordinates/labels.
5. **Natural Earth Vector Basemap** (`public/geo/ancient-basemap.geojson`):
   - **License:** Public Domain ([CC0](https://www.naturalearthdata.com/about/terms-of-use/)). Optional modern map toggle uses [OpenFreeMap](https://openfreemap.org) (`OpenFreeMap © OpenMapTiles Data from OpenStreetMap`, ODbL 1.0 / CC BY 4.0).

Reproduce offline audit and SQL staging with `node scripts/audit-geography.mjs --download` followed by `node scripts/etl-geography.mjs`.
