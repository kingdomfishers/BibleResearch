# Browser skeleton
- Genesis 1:1 and John 1:1 are available as local fixtures before database import, including original script, transliteration, and word inspection.
- Database results take precedence when present. Missing passages show an empty state with links to the samples.
- Samples and illustrative relationship metadata are explicitly labeled. Unknown chronology, physical definitions, and translation frequencies are shown as unavailable rather than invented.
- The existing Priority 1 scope includes the reader and word modal; browser checks cover both before handoff.

# Populated Bible corpus
- STEP Bible TAHOT supplies the Hebrew/Aramaic OT; TAGNT supplies the Greek NT using NA28 vocabulary, selected by the user. STEP's English/NRSV references and Psalm headings at verse 0 are retained.
- Surface forms retain pointing, punctuation, morphology and source transliterations. Strong's queries, clicked word IDs and relationship queries resolve lexical identity across inflections.
- STEP's licensed glosses supply Hebrew definitions; its separately restricted Online Bible Meaning column is excluded. Physical definitions and unsupported chronology remain null.
- Co-occurrences are computed in PostgreSQL at lexical level, cached once per Strong's number and hydrated through the existing RPC contract.
- Source version, checksums, attribution and reproducible import/verification commands are in DATA_SOURCES.md. No frontend administrative credentials or public write policies are introduced.

# Shipped verse chronology (`get_verse_chronology_v1`)
- User confirmed an approximate Adam-creation anchor 4,000 years before Jesus' resurrection. Preserved as a named relative model premise (`adam-resurrection-30-v1` and `adam-resurrection-33-v1`) alongside independently attributed source chronologies (`theographic-verse-v1`, `theographic-events-v1`, `archaeology-pilot-v1`).
- Every canonical passage (`31,203`) has a status assignment per published model. Unresolved cases remain explicitly undated (`No setting date established`).
- Narrative setting, composition context and events mentioned by a verse are kept distinct. See [CHRONOLOGY_ARCHITECTURE.md](CHRONOLOGY_ARCHITECTURE.md) and [CHRONOLOGY_API.md](CHRONOLOGY_API.md).

# Shipped context-aware biblical geography (`get_verse_geography`)
- Integrates OpenBible.info Geocoding (`CC BY 4.0`, OSM polygons `ODbL 1.0`), Theographic Bible Metadata (`CC BY-SA 4.0`), STEPBible TIPNR (`CC BY 4.0`), and Pleiades (`CC BY 3.0`) offline in PostgreSQL.
- Deterministic 5-tier context hierarchy (`direct_event_location`, `passage_context`, `event_metadata`, `regional_context`, `symbolic_non_physical` / `unknown`).
- Distinguishes `event_location`, `contextual_location`, `mentioned_location`, `travel_origin`, `travel_destination`, and `uncertain_location`. Symbolic/heavenly places (`Revelation 21:2` New Jerusalem) never render physical GPS pins.

# Relationship research & evidence graph (`research_relationships_v1`)
- Orthographic identity separates `original_source` (raw pointed/accented text with internal STEP markers), `display_form` (clean reader rendering), and `search_form` (Unicode-normalized lookup key).
- Extended/disambiguated Strong's identifiers (`H0430G`, `H1254a`) are preserved in `lexemes` and `lexeme_identifiers` alongside base Strong's aliases (`H430`, `H1254`), preventing homograph collapse while maintaining backward compatibility with `prompt_word_occurrences`.
- Epistemic categories (`lexical`, `linguistic`, `statistical`, `textual`, `interpretive`) and review states (`reviewed`, `candidate`, `rejected`) are strictly separated.
- Benchmark motifs (`well` + `marriage` across Genesis 24, Genesis 29, Exodus 2:15-21 with Genesis 21/26 controls; `menorah`/`lampstand` + `seven spirits of God` across Exodus 25, Zechariah 4, Revelation 4:5/5:6 with Revelation 1:20 church distinction) are stored as reviewed, source-attributed evidence paths and retrieved in a single bounded `research_relationships_v1` call.
