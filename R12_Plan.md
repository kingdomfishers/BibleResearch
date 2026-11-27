# BibleResearch R12 — Discovery-First Architecture, Open-Data Research, and Implementation Handoff

**Prepared:** 2026-11-17  
**Status:** Research/design handoff; **not** a claim that code or datasets have been imported.  
**Audience:** Astra and subsequent implementation agents working in the **local authoritative checkout** at C:\Projects\BibleResearch-r10.  
**GitHub location:** kingdomfishers/BibleResearch, root document on main.  
**Authority order:** Current local AGENTS.md and actual local code/status > current local TASKS.md and RELATIONSHIP_ARCHITECTURE.md v5 > this research handoff > older GitHub branch snapshots. **Never overwrite or roll back local task progress to match this file.**

## 0. One-page decision

The product is an **automatic discovery instrument**, not merely an interlinear Bible search or a machine that asserts theology. Clicking any indexed original-language word should surface: (1) direct source-backed relations, (2) diversified and ranked multihop paths, (3) word-form similarities and potential wordplay, (4) recurring grammatical/narrative/vision configurations, and (5) external semantic and physical-world relationships that can bridge otherwise unrelated passages. A smaller fast result set serves the reader; a paged exploratory tail serves human investigation and ChatGPT's MCP research.

**Top engineering priority:** make **direct connections across the existing vocabulary** visible in the website and MCP, then **offline typed multihop search** and proof expansion. New datasets improve breadth after this functionality works; they must not become another large prerequisite.

**Top new data:** Open English WordNet (sense-based semantic classes) and a **small curated-by-license, programmatically selected Wikidata extract** (physical/object/world properties). Add ChEBI, Pleiades, and Sefaria links later when specific measured gaps justify them. Avoid paid runtime AI, new graph DB, and full external knowledge-graph mirrors.

**Scientific rule:** every edge keeps its own epistemic layer and provenance. A world fact (e.g., a lamp emits light), an original-language attestation, a letter resemblance, a narrative pattern, and a biblical explicit identification are distinct kinds of evidence. The engine may recommend intriguing hypotheses; it may not silently upgrade them to established textual or etymological statements.

**Astra's remaining work:** inspect the *newer local checkout* for actual file/function signatures, merge this plan into the latest task queue without losing D1 progress, choose precise file ownership/acceptance commands, and supervise minimal high-risk integration. Do not spend premium reasoning credits re-researching the public datasets below without a concrete unresolved license or API question.

## 1. Actual starting point; avoid redundant work

The uploaded R12 task queue described an existing stack, not a greenfield project:

- Immutable biblical corpus: about **31,203 canonical verses**; preserve Psalm verse 0 and MT-versification mappings.
- R8: **150,522 grammatical frames**, **124,312 occurrence relations** in the reported audit.
- R9A: **14,469 earlier lexical edges** and approximately **689,397 contextual pairs**. A later staged count of **25,106 records** is *not directly comparable* until release, category, duplication and source are reconciled.
- R9B: sharded lexical/relationship adjacency, resolver, source evidence and manifests.
- R9C: bounded multihop graph traversal and evidence-aware ranker (old implementation 1–3 hops).
- R10/R11: discovery concepts, lemma profiles, around **305,628 cross-reference pairs**, Cloudflare corpus gateway, website DiscoverConnections and WordInspector, and existing MCP discovery functions.
- The previously supplied D1.1 log reports new inventory/verifier scripts and passing R8D 29/29, R9C 19/19 and R11 discovery 14/14. D1.2 CPU diagnostics and D1.3 sharding/caching were underway in subsequent user reports. **These local completion states cannot be independently verified from this GitHub handoff.**

Public GitHub main contains an older TASKS.md and older implementation than the local authoritative R11/R12 checkout. The remote branches visible during research do not contain feat/r11-universal-discovery-engine. Therefore **do not fetch and merge main into the local branch just to acquire this document**. Read the raw URL directly or fetch then inspect with git show, without changing the working branch.

Relevant known integration points; verify names/exports against current local files before coding:

- src/relationships/multihop-search.ts — discoverMultiHopPaths, runOpenEndedSearch, runTargetSearch.
- src/relationships/path-ranker.ts — edgePreRankScore, scoreAndExplainPath, compareMultiHopPaths, buildPathStep.
- src/relationships/adjacency-loader.ts and multihop-types.ts — existing graph protocol and types.
- src/relationships/concept-resolver.ts — exact typed anchor/lemma/sense resolution.
- src/relationships/r10-discovery.ts and r10-types.ts — higher-level R10/R11 discovery envelope.
- scripts/build-r10-discovery-index.mjs, scripts/r12-evidence.mjs and scripts/verify-r12-discovery.mjs — offline orchestration/inventory (last two reported newly added locally).
- scripts/corpus-relationships-rpc.mjs / corpus-worker.mjs — Worker gateway.
- src/ui/components/WordInspector.ts, DiscoverConnections.ts and src/api/r10-rpc.ts — reader integration.
- supabase/functions/bible-mcp/relationships-v2.ts — existing thin MCP adapter.

**Do not duplicate or rebuild R8 source frames, MACULA annotations or the R9B graph merely to obtain an ideal new schema.**

## 2. What is a hidden connection? Five distinct mechanisms

Every recommendation must declare one or more mechanisms. Examples are research tests, **not hardcoded generation rules**.

1. **Direct textual / grammatical.** A source statement explicitly identifies, compares, names or grammatically relates two things; cite exact passage, edition, source-token witnesses and statement scope. Example: Revelation 4:5 identifies seven lamps with seven spirits. Revelation 1:20 separately identifies seven lampstands with churches; *lamp* and *lampstand* cannot be merged.
2. **Lexical / linguistic.** A lexeme has multiple attested senses or is demonstrably related by form, derivation or translation; distinguish shared written form from same lexeme and verified Hebrew–Greek token alignment from lexical candidate. Hebrew ruach has attested spirit/wind/breath/directional uses; **not all senses apply in every verse**. Eye/spring may involve polysemy or distinct lexical analyses; do not collapse homographs.
3. **Orthographic / wordplay candidate.** Hebrew Adam (אדם) and dam (דם) share a suffix string in unpointed consonants. Record precise characters and normalization, not invented historical derivation. A generic similarity index must discover this without a special Adam/Dam branch.
4. **Cross-passage structural pattern.** Scene signatures repeat combinations such as participant, seeing, water source, wilderness, speaker, lampstand, seven lamps, Spirit, seven eyes. This yields Hagar (Genesis 16:7, 13–14; 21:19) and related visions without English keyword matching or hand-enumerated motifs.
5. **External semantic / physical / historical.** WordNet can connect distinct senses under WATER_SOURCE; Wikidata can connect materials, components, natural phenomena and taxa; ChEBI supplies chemistry; Pleiades joins ancient places. Such edges **suggest where to look in scripture**; they do not themselves prove biblical symbolism.

Three pathways matter especially:
- **Spirit / wind / direction** through actual lexical attestations, potentially **branching** into Zechariah 4's explicit Spirit statement and the lampstand/eyes vision.
- **Exodus 25 seven-lamp construction -> Zechariah 4 lampstand + Spirit + eyes -> Revelation 4:5 lamps/spirits and 5:6 eyes/spirits.** Multiple independent routes may converge; do not force a single verse-to-verse lexical link.
- **Eye / spring / well / seeing / Hagar**, with distinct lexical and narrative paths preserved.

## 3. Research-verified open data: prioritized source audit

This audit identifies *publisher-described licensing*, not a legal determination about every field, mirror or derivative. Before import pin the exact release, preserve attribution and reject fields with unresolved rights.

| Priority | Resource | What it genuinely adds | Reported license / caveat | Recommended use |
|---|---|---|---|---|
| P0 | **Open English WordNet** | Synsets and typed semantic relations; WATER_SOURCE, LIGHT_SOURCE, object classes, synonyms/meronyms/hypernyms | **CC BY 4.0** for Open English WordNet, underlying Princeton license; attribution required. Modern English synsets are **not Biblical Hebrew lexicographic authority**. | Import narrow relation subset offline; map from biblical **senses**, not English string alone. |
| P0 | **Wikidata** | Object classes, material, constituent, part/whole, geography, taxonomy, structured properties | Structured data **CC0**; individual claims can be mistaken or disputed; public SPARQL has service limits | Import compact pinned **allowlisted property** extract only, based on mapped biblical concepts. |
| P1 | **ChEBI CORE/LITE** | Verified chemical identity/classes for water, metals, salts, sulfur and similar substances | Publisher **CC BY 4.0**; chemical classifications do not prove symbolic claims | Source-backed material subgraph after WordNet/Wikidata pilot. |
| P1 | **Pleiades** | Numbered ancient-place identities, alternative names and geography | **CC BY 3.0**; place identifications may be uncertain | Join to existing OpenBible geography with crosswalk and uncertainty; do not overwrite Bible place IDs. |
| P1 | **Sefaria links metadata** | Jewish commentary, quotation, parallel and reception-history links | **Links dataset CC BY**; text *versions have separate licenses* | Import links without text initially; category = RECEPTION/COMMENTARY, **not** original biblical evidence. |
| P2 | **Open Multilingual WordNet / Hebrew WordNet** | Modern Hebrew synset proposals | Inspect specific Hebrew WordNet/OMW terms; modern semantics, not ancient sense authority | Candidate mapping only; avoid using modern Hebrew to assert Biblical Hebrew etymology. |
| P2 | **Kaikki/Wiktionary** | Extracted dictionary morphology and etymology leads | Wiktionary **CC BY-SA 4.0 / GFDL**; contributed material may vary | Separate attributed exploratory candidate partition; independently verify derivations. |
| P2 | **Catalogue of Life** | Botanical/zoological classification of confidently identified species | General site content **CC BY 4.0** with source-level terms | Import only unambiguous taxa; do not resolve debated biblical plants by gloss. |
| P3 | **ConceptNet** | Large commonsense relation graph for hypothesis generation | **CC BY-SA 4.0**; crowdsourced claims not guaranteed true | Offline optional candidate generator in separate license/epistemic partition; no factual promotion. |
| P3 | **OpenAlex** | DOI/publication metadata for scholarly follow-up | Metadata **CC0**, articles have separate rights; huge bulk corpus | Import *bibliographic leads* only for disputed relations, not scientific/theological assertions. |
| Exclude | **BabelNet** | Multilingual sense network | Non-commercial/restricted licensing | Do not embed in public redistributable Worker corpus. |
| Exclude pending permission | **ETCBC BHSA** | Excellent Hebrew syntax | **CC BY-NC** in publisher source | Do not merge into commercially reusable static assets absent authorization. |
| Separate | **OpenStreetMap / DBpedia** | Maps / general knowledge | ODbL / BY-SA obligations; large overlap with other resources | Separate appropriately licensed layer if ever used; avoid merging into core. |

**Primary references, accessed/reviewed in the 2026-11-17 research:**

- WordNet repository and license: https://github.com/globalwordnet/english-wordnet ; https://github.com/globalwordnet/english-wordnet/blob/main/LICENSE.md ; https://en-word.net/ ; https://wordnet.princeton.edu/license-and-commercial-use
- Wikidata license, access, dumps: https://www.wikidata.org/wiki/Wikidata:Licensing ; https://www.wikidata.org/wiki/Wikidata:Data_access ; https://www.wikidata.org/wiki/Wikidata:Database_download ; https://www.mediawiki.org/wiki/Wikidata_query_service/Implementation
- ChEBI: https://www.ebi.ac.uk/chebi/about ; https://www.ebi.ac.uk/chebi/downloads
- Pleiades: https://pleiades.stoa.org/downloads ; https://pleiades.stoa.org/help/using-pleiades-data
- Sefaria: https://developers.sefaria.org/docs/usage-of-our-name-and-logo ; https://developers.sefaria.org/reference/get-links ; https://developers.sefaria.org/docs/general-faq
- Hebrew WordNet/OMW: https://omwn.org/ ; https://github.com/omwn/omw-data/blob/main/wns/heb/LICENSE
- Kaikki/Wiktionary: https://kaikki.org/dictionary/index.html ; https://en.wiktionary.org/wiki/Wiktionary:Copyrights
- ConceptNet: https://github.com/commonsense/conceptnet5/wiki/Downloads ; https://github.com/commonsense/conceptnet5/blob/master/LICENSE.txt
- OpenAlex: https://openalex.org/transparency ; https://help.openalex.org/api/
- Catalogue of Life / GBIF rights: https://www.catalogueoflife.org/ ; https://www.gbif.org/terms/data-user
- Exclusions: https://www.babelnet.org/license ; https://etcbc.github.io/bhsa/

**Important import discipline:** "free API" is not equivalent to "safe to republish a compiled download." Retain a source-by-source rights manifest with retrieval URL, exact release/hash, claims actually exported, attribution obligations and field exclusions. API access is for offline compiler runs only; no external service on a user click.

## 4. Minimal graph extension — three new external concepts, not a second engine

Keep the existing R9/R12 occurrence/lexeme/sense/statement/verse/scene/graph IDs. Extend the **existing graph edge** only where required. Source-local mapping must be explicit; Strong's number or English gloss alone is **not** an identity key.

**External node kinds**
- **EXTERNAL_CONCEPT**: stable provider identity, e.g. wn synset, Wikidata QID, ChEBI ID, Pleiades ID. Namespaced stable ID, source release and label.
- **PROPERTY_VALUE**: categorical or typed value, e.g. WATER_SOURCE, METAL, EMITS_LIGHT, material, taxon, coordinate or quantity. Prefer an existing concept ID or source provider identifier to invented free text.
- **EXTERNAL_ASSERTION**: optional materialized assertion node/record when source references, mapping decisions or licensing require claim-level provenance; don't expand it on every path if edge metadata suffices.

**New edge relations only when not representable by existing predicates**
- ALIGN_TO_EXTERNAL_CONCEPT (a *candidate* or a verified mapping with its method),
- SEMANTIC_HYPERNYM, SEMANTIC_MERONYM, SEMANTIC_ANTONYM,
- SUBCLASS_OF, INSTANCE_OF, HAS_PART, MADE_OF, HAS_PROPERTY,
- LOCATED_AT / NEAR (distance computed from sourced coordinates, **not** textual attestation),
- ORTHOGRAPHIC_SIMILARITY, EXTERNAL_ETYM_CANDIDATE, RECEPTION_LINK.
- Keep legacy R8 relations and source-specific predicates for actual grammar, quotation, interpretations, translation and shared written form.

**Minimum evidence record** (adapt exact field names to current local type definitions):
~~~json
{
  "edge_id": "deterministic-source-scoped-id",
  "source_id": "biblical:... or ext:...",
  "target_id": "biblical:... or ext:...",
  "relation_type": "SEMANTIC_HYPERNYM",
  "direction": "source_to_target",
  "epistemic_layer": "EXTERNAL_WORLD",
  "evidence_status": "attested_external|candidate_mapping|algorithmic_pattern|biblical_explicit|unsupported",
  "provider": "OpenEnglishWordNet",
  "provider_assertion_id": "stable-source-id",
  "provider_release": "pinned-release",
  "source_uri": "publisher-url-or-local-source-locator",
  "source_checksum": "sha256",
  "license": "CC-BY-4.0",
  "mapping_method": "validated_id|manual_review|gloss_candidate|algorithm",
  "mapping_status": "verified|candidate|unresolved",
  "passage_ids": [],
  "token_ids": [],
  "claim_scope": {"speaker": null, "negated": false, "edition": null},
  "limitations": ["External class; not a statement made by the biblical author."]
}
~~~

**Layer classification**: TEXTUAL (Bible with original tokens and scope); LINGUISTIC (attested lexical/source analysis); EXTERNAL_WORLD (science, geography, modern semantic class); HYPOTHESIS (computed form/pattern/allusion); optionally USER_NOTE as *separate mutable commentary, never promoted into immutable graph*. Do not conflate layer with numeric interest or source-quality scores.

**Mapping rule**: STEP/MACULA sense -> English WordNet synset **candidate** via gloss/synonyms/usage/POS; a verified mapping requires independent source-level support or reviewed decision. Modern English gloss polysemy is especially hazardous: "spring" has seasons, coils, jumps and water-source meanings. The algorithm must keep multiple candidate synsets and not commit to one using the string alone. A biblical word clicked in context must retain original occurrence and attested sense (or ambiguous status).

**Transitivity rule**: lexical identity and administrative ID joins may help navigation, but "both things are made of bronze" or "both produce light" is a candidate bridge, never proof they symbolize one another. A path can be interesting while its ultimate interpretation remains unresolved.

## 5. Implementable algorithms; conservative facts, adventurous retrieval

### 5.1 Direct relationship retrieval — first visible product

Use the R9B adjacency and R10/R11 profiles. For a clicked validated original-language occurrence, gather typed lexical/sense/form, grammatical, cross-reference and linked entity/context relationships. Return compact top-ranked direct edges **and** paginated lower-ranked edges with provenance. Preserve original-token and verse identity. Never seed results from a hand-written list of Hagar/Spirit/Adam examples.

A cheap direct index is anchor_id -> adjacency pages. Reuse existing shards and caches first. An empty result is an honest coverage state, not proof of no connection.

### 5.2 Generic Hebrew/Greek form candidate builder

For each verified word form/lemma in a language-specific partition, retain these keys:
- Exact original form.
- Pointed/accents-stripped forms separately.
- Hebrew unpointed consonants; optionally normalized final letters in **a distinct** comparison mode.
- Greek case/diacritic-normalized spelling separately from originals.
- Attested roots only where source-derived.
- Transliteration only for presentation, not an original-script match proof.

Build inverted postings of 2/3-character n-grams, first/last-character patterns and short contiguous substrings (for very short Hebrew words, use exact common suffix/prefix, not a 3-gram requirement that drops dam). Retrieve only bounded candidates; score using length-adjusted longest common substring/subsequence, edit distance and n-gram overlap; downweight ubiquitous morphemes and near-identical duplicates. Emit matched character positions, normalization mode, rarity and ORTHOGRAPHIC_SIMILARITY status. Do **not** emit DERIVED_FROM unless an independent historical lexicon asserts that derivation.

Positive: אדם / דם (visible common letters). Negatives: widespread 1-letter Hebrew matches, transliteration coincidence, distinct homographs treated as identical meanings.

### 5.3 Semantic and physical bridge creation

Import WordNet **sense graph** and then Wikidata small world graph as separate licensed partitions. Align biblical candidate senses to external IDs, retaining disambiguation. Sample generic path:

biblical occurrence -> attested sense -> candidate external synset SPRING_WATER_SOURCE -> hypernym WATER_SOURCE <- hypernym WELL_WATER_SOURCE <- candidate biblical sense -> other biblical occurrence.

World example:

biblical lamp/object -> verified object mapping -> material/part/light-emission property -> another mapped object -> biblical verse.

The external property generates a *candidate*. The actual textual relationship appears only if text, grammar, explicit cross-reference or independent structural evidence supports it. Limit generic hubs like THING, PERSON, OBJECT, MATERIAL, LIGHT and WATER as intermediate steps; require distinctive features or independent convergence before ranking highly.

### 5.4 Structural scene signatures (offline)

Reuse existing MACULA/BibleOntology roles, negation, quotation/speaker scope and lexical senses. Build sparse feature tuples:
- participant, action, object, attribute, location, quantity, statement_type,
- scene/vision ID, source statement IDs, edition/source lineage,
- unknown referents explicitly unknown.

A source-backed event/vision may extend beyond an arbitrary five-verse window; infer boundaries only under validated discourse/participant continuity and record uncertainty.

Index postings for typed (role, concept-or-sense) features; suppress high-frequency generic features for candidate nomination. For a scene pair sharing >=2 informative features, calculate:

idf(f) = min(6, 1 + ln((N+1)/(df(f)+1))).

Weighted Jaccard = sum weights for shared typed features / sum weights for union. Initial threshold ~0.25; track candidate truncation, comparisons, evidence and repeated overlapping scene lineage. Use only rare-feature postings instead of quadratic scene comparisons. Group repeated patterns into PATTERN nodes/edges with exact matching features and witness statements.

For Hagar: seeing, water source, location/participant continuity may form a pattern; never assume "eye = spring" via pattern alone. For Zechariah 4: keep lampstand, seven lamps, Spirit and eyes within sourced vision context, yet distinguish which claims are explicit versus associated.

### 5.5 Typed multihop search, meta-path interpretation and long-tail retrieval

**Extend existing R9C routines, not fork them.** Default offline 2–5 **meaningful nonadministrative** relationship hops, beam 64 per depth, up to 16 diverse eligible outgoing edges per expanded node, no cycles, at most one weak co-occurrence per path, stable ordering. Separately cap *physical* graph transitions/read operations to prevent unbounded identity-join chains. R9C legacy runtime remains unchanged; Cloudflare **never runs heavy traversal on HTTP requests**.

A path is not a generic unlabeled edge list; record its **typed meta-path family** (lexical/form, textual explicit, grammatical, configuration, cross-book pattern, world-property, reception). A search can rank families differently and diversify over them without implementing the full PathSim or HeteSim mathematical algorithms. Preserve canonical edge direction; reversed traversal uses an inverse display label.

Ranking: preserve the R12 baseline formula unless actual holdout evidence shows a problem. Q = geometric_mean(nonadministrative edge weights) * 0.95^(max(0,hops-2)); C = independent evidence convergence; D = distinctive-feature IDF; T = relation-type diversity. Interest I = clamp(0.45 Q + 0.30 C + 0.15 D + 0.10 T - hub/duplicate penalties, 0,1). Treat these as **heuristic ordering**, not theological probabilities. Do not assign external-world or word-form candidates weights that let them masquerade as explicit biblical identification; their own epistemic layers survive scoring.

Store multiple independent routes to each target. Use MMR over destinations and proof types (initial 0.35 overlap penalty) for top 24 compact cards. **Persist additional lower-ranked exploratory candidates with cursor**, not just top 24. Alternative path and deep offline profile can widen search for high-degree anchors. "Not precomputed" is distinct from "not connected."

**Weakest inferential link**: if a path includes a candidate mapping, orthographic resemblance or speculative parallel, its conclusion remains explicitly exploratory regardless of the strong other edges.

Background papers (conceptual guidance, not a requirement to implement full algorithms):
- PathSim: https://sites.cs.ucsb.edu/~xyan/papers/vldb11_pathsim.pdf
- HeteSim: https://arxiv.org/abs/1309.7393
- Personalized PageRank may later generate extra candidates but is not proof: https://sidbanerjee.orie.cornell.edu/publication/lofgren-14-ppr/
- MMR relevance/diversity (Carbonell & Goldstein, 1998): https://www.researchgate.net/publication/243774776_The_use_of_mmr_and_diversity-based_reranking_in_document_reranking_and_summarization

## 6. Ready-to-use offline source pilots (not executed)

### Pilot A: Open English WordNet

1. Pin the exact GitHub release/tag/commit of https://github.com/globalwordnet/english-wordnet; save upstream license and original Princeton notice.
2. Read the maintained Global WordNet LMF source format documented in that repository. Stream synsets, lexical entries, relation IDs and source labels. **Never** index them as Biblical Hebrew facts.
3. Select minimal relation types: hypernym/hyponym, meronym/holonym and synonym/antonym as licensed; validate direction and source IDs.
4. Generate biblical-sense -> synset **candidate** mappings using existing STEP/MACULA gloss and POS. Store competing mappings and reason codes. An exact gloss alone should not certify mapping.
5. Emit small JSONL partitions, deterministic sort/IDs, source-checksum manifest, coverage and rejected/ambiguous mappings. Read from local files in the compiler; not from WordNet API at request time.
6. Compare against baseline on 40–60 diverse anchors (water/spring/well/eye/spirit/wind/fire/lamp/oil/bronze/salt/tree/river/bread/stone plus negatives). Count **new** concept links vs already-existing R9 edges and inspect semantic false positives.

Suggested output records:
~~~json
{"biblical_sense_id":"existing-sense-id","external_id":"oen:source-synset-id","mapping_status":"candidate","candidates_considered":3,"method":"gloss+pos+context","evidence_ids":["existing-lexical-source-id"]}
{"source_id":"oen:source-synset-id","target_id":"oen:source-hypernym-id","relation_type":"SEMANTIC_HYPERNYM","provider_release":"pinned-version","license":"CC-BY-4.0"}
~~~

### Pilot B: Wikidata

1. Start with verified concept -> QID crosswalks only. Do not auto-map biblical Hebrew sense directly from English label. Record ambiguity and competing QIDs.
2. Allowlist needed **property categories**, initially subclass (P279), instance (P31), part of (P361), has part (P527), material used (P186), location/coordinates only if mapped/meaningful. Inspect Wikidata statement ranks, qualifiers and item datatypes; do not flatten disputed/time-scoped facts.
3. Query a **small batch** at development/import time, then pin exact query/results checksums; large-scale work should use filtered dumps instead of hammering SPARQL. Avoid unbounded "?item ?property ?value" joins.
4. Do a one-hop property extraction and limited two-hop candidate expansion, with hub suppression. Never import a universal QID neighbor graph.
5. Store Wikidata ID, statement/property/value IDs, rank/qualifiers/references if available, access timestamp and source release/snapshot ID. Export only useful typed assertion fields.

Example of a *bounded development query* (water Q283 is illustrative; verify the needed property statements in the returned response):
~~~sparql
SELECT ?item ?property ?value WHERE {
  VALUES ?item { wd:Q283 }
  VALUES ?property { wdt:P279 wdt:P31 wdt:P361 wdt:P527 wdt:P186 }
  ?item ?property ?value .
} LIMIT 100
~~~

Run on https://query.wikidata.org/ only for small exploratory batches and respect service guidelines. Official docs: https://www.wikidata.org/wiki/Wikidata:Data_access

### Pilot C: ChEBI / geography / Sefaria only after measured need

- ChEBI: pin CORE/LITE OWL/OBO/JSON, import recognized substance classes and IDs only. Keep biochemical scientific claims separate from biblical imagery. Source: https://www.ebi.ac.uk/chebi/downloads
- Pleiades: pin numbered JSON release, crosswalk existing OpenBible place IDs with uncertain geographic identifications. Keep external place claims and scriptural identification edges separately. Source: https://pleiades.stoa.org/downloads
- Sefaria: use its documented links endpoint with text excluded; import source/target reference and link category with license; retain commentary/reception status. **Do not import texts** without each version's rights audit. Source: https://developers.sefaria.org/reference/get-links

## 7. Exact MCP and UI behavior

The MCP must be a *thin gateway onto the same precomputed evidence used by the website*. Extend existing discover_biblical_connections_v2, evidence and hydrated research tools where compatible; no redundant server-side traversal.

**MCP input anchors**: original word occurrence with edition/verse/token ID; lexeme or specific sense; verse/range; concept/entity; optional pair. Reject contradictory supplied IDs. Text-only search triggers explicit disambiguation, not silently selected English gloss.

**Compact default response** (conceptual contract; merge into existing envelopes):
~~~json
{
  "anchor": {"id": "existing-id", "kind": "WORD_OCCURRENCE", "resolution": "verified|ambiguous|unmapped"},
  "direct_relations": [{"target_id": "...", "type": "...", "evidence_ids": ["..."], "layer": "TEXTUAL"}],
  "discoveries": [{"target_id": "...", "path_ids": ["..."], "quality": 0.0, "interest": 0.0, "layers": ["TEXTUAL","EXTERNAL_WORLD"], "limitations": []}],
  "external_bridges": [{"provider":"OpenEnglishWordNet", "mapping_status":"candidate", "edge_ids":["..."]}],
  "exploratory_candidates": {"items": [], "cursor": "opaque-or-null"},
  "coverage": {"release": "r12-candidate", "complete": false, "truncation_reasons": []}
}
~~~

The AI must be able to request later-ranked results, alternate proof routes, exact edge/evidence original-script witnesses, and links from intermediate nodes, while default hydrated verse calls remain compact. Do not confuse an empty page with exhausted research space. Add links to citations/source notices, explain evidence limits, and mark user-authored notes as USER_NOTE, not graph authority.

**WordInspector behavior**: automatic discoveries on word click, not a second text query. Four visual groupings are presentation categories over **one graph**: **Text**, **Language**, **World / Physical**, **Patterns & Hypotheses**. A compact ranked primary set; "more exploratory links" and alternate routes discoverable; proof drawer displays typed direction, original language and exact passages, source links, and what is *not* established. Tap intermediate word/concept to open another anchor. Responsive on older Android phones. Evidence is lazy-loaded, not eagerly downloaded with cards.

Asset contract: extend R9B/R11 manifests/keyed shards and current D1 cache improvements. Prefer <=8 reads and <400 KiB decoded on the typical cold click as initial goals, release-keyed cache, explicit incomplete coverage. Worker Free constraints and actual CPU profiles are acceptance evidence; Node wall time is not request CPU. Preserve existing releases and do not deploy without authorization.

## 8. Engineering sequence: deliver value before complete corpus enrichment

Use the newest local status, not the old remote TASKS.md. The following is a **proposed condensed task plan**; Astra should map to current local D-IDs without rewriting completed task history.

| Stage | Task / measurable output | Dependencies | Suggested lowest viable tier |
|---|---|---|---|
| Preserve | D1 reliability inventory, profiling, selective shard reads: **finish only unresolved local acceptance** | Existing work | Terra for tests; Sol for hard CPU failures |
| M1 | Existing adjacency -> typed direct relationship response for arbitrary indexed occurrence, source refs and paging | D1 local stable | Terra |
| M2 | Generic unpointed/pointed form similarity index, Adam/dam positive and common-letter negatives, source-independent wordplay labels | M1 contracts | Terra |
| M3 | WordInspector auto direct connections and compact evidence drilldown; no new discovery engine | M1 | Terra/Hydrogen |
| M4 | MCP direct relationship parity and paged neighbors; hydrated word/verse links kept compact | M1 | Terra/Hydrogen |
| M5 | Extend R9C offline typed beam (2–5 meaningful hops, explicit coverage/truncation) with existing edges | M1 | Sol |
| M6 | Convergence, evidence-strength vs interest, MMR, typed proof step and exploratory tail | M5 | Sol |
| M7 | Small pilot precompute, keyed manifest, real browser/MCP multi-hop proof expansion | M6 + M3/M4 | Hydrogen/Sol |
| M8 | Freeze independent research holdout and source-based negative controls; verify actual results, not trace existence | Can begin once M1 contracts frozen | Terra for harness; human/independent reviewer for labels |
| M9 | WordNet importer + ambiguous mapping provenance + pilot test | M1 + source rights audit | Terra/Hydrogen |
| M10 | Wikidata compact QID property bridge + source-qualified assertions | M9 mapping protocol | Terra/Hydrogen |
| M11 | Structural scene signature + rarity postings + weighted-Jaccard candidates | M1; existing R8 frames | Sol for rule design; Terra for index |
| M12 | Pattern/external edges merged into same graph, re-precompute pilot and compare discovery yield | M7 + M9/M10/M11 | Sol |
| M13 | Expand offline anchors incrementally and cache/CPU optimize; preserve secondary evidence tier | M12 | Hydrogen/Terra |
| M14 | Final provenance/license, holdout, source witnesses, compatibility, worker and browser acceptance; reversible release candidate | M13 | Sol for failures; Terra for deterministic checks |

**Critical milestone A after M1/M3/M4:** Clicking an ordinary original-language word yields available direct source-backed connections through BOTH UI and MCP. **No new external import or pattern engine is prerequisite.**

**Critical milestone B after M5–M7:** Existing graph can already provide **ranked, automatically found multihop recommendations with per-step proof**, through UI and MCP. Ship local prototype BEFORE M9–M11.

**Critical milestone C after M9–M12:** New word/world/pattern bridges increase candidate recall and novelty without erasing source boundaries.

Proposed parallelism: after fixing a shared response contract, **M2 (form index)** and **M3/M4 (different UI/MCP files)** may run simultaneously if test output directories and files are disjoint; **M9 (WordNet importer)** and **M11 (pattern compiler)** may also run concurrently only with frozen graph fields, disjoint source files, no shared staging writes, and one task-queue writer. Default to one agent; maximum two if coordination demonstrably cheaper.

**Defer rather than delete**: complete LXX token alignment, full external dumps, large scholarly bibliography imports, general neural embedding search, automatic theological assertion generation, complex front-end graph visualizations, personalization/recommendation learning, sophisticated ontology redesign. Activate only for a demonstrated missing mechanism, measurable recall improvement, or proven resource bottleneck.

## 9. Test protocol and reproducibility

1. Baseline existing R8/R9/R11 regressions and the 157 audit IDs; **39 historical traces are not 157 verified passes**. Preserve regression provenance and known failures.
2. New generic word-form tests: Adam/dam and unrelated Hebrew one-character matches; accents/pointing variants; roots vs suffixes, ambiguous Greek normalization.
3. Sense disambiguation: ruach directional use vs wind vs spirit; spring as water source vs coil/season; verified LXX alignment vs lexical candidate.
4. Multi-route convergence: Exodus 25, Zechariah 4, Revelation 4:5, Revelation 5:6; Revelation 1:20 *lampstands/churches* as a strict negative-control conflation.
5. Hagar seeing/water-source structural matching with exact verses, no hardcoded Hagar path in production code.
6. External mappings: ambiguous QID/synset returns candidate; no false "biblical author said physical property"; source rights and checksum/attribution 100%.
7. Direct word reachability for random ordinary anchors across both languages; measure percentage with evidence-bearing direct relations, not fabricated universal coverage.
8. Precision *and* exploration: check ranking Recall@10/24; alternative-route recall; top-10 relation/motif diversity; long-tail cursor coverage and source provenance. Have independent humans review "worth investigating?" on unseen holdout, **without asking algorithms to produce perfect theological conclusions**.
9. Full corpus builds must be deterministic and incremental; pinned input hashes and compiler rule versions; preserve earlier immutable asset manifests.
10. Worker and browser: no runtime graph traversal, cold and warm CPU measured with appropriate local workerd tools, bounded reads/decompression, no 503, same UI/MCP evidence IDs, readable small-screen layout.

**Source and mapping provenance acceptance:** Never count an external fact as a biblical citation. Never count two exports of the same underlying text as independent corroboration. Never assert etymology from orthographic resemblance. A speculative recommendation can be accepted as exploratory; a forged source/span cannot.

## 10. Cost-efficient agent workflow for Astra and downstream models

Astra should first inspect the **actual local** R12 progress and contract, not re-execute all 35 previous tasks. Optimize for verified output per consumed allowance, not the cheapest model label.

- **Economical narrow agent (Luna/Terra or equivalent if available):** parsers, manifests, lookups, transformations, fixtures, UI wiring with fixed types, localized tests.
- **Mid-range implementer (Hydrogen/Terra/Sol when needed):** grouped modules, API integration, worker dispatch, moderate debugging.
- **High-reasoning Sol:** typed beam traversal, difficult extractor semantics, cross-version parity or nonlocal regression repair.
- **Astra:** unresolved architecture conflicts, source-rights decisions that require nuanced review, model/task optimization, repeated multi-system failures.

Model names/caps and whether they are available in the user's editor must be **verified locally**; do not invent 2026 quotas or performance comparisons. Increase reasoning only after a clear escalation trigger, not for every deterministic transform.

A task prompt should contain **one objective**, exact inspected file/function references, small input/output schema, deterministic algorithm steps, targeted test command, safety exclusions, acceptance condition, and explicit stopping point. Usually 1–4 implementation files. The agent should not re-read the full source corpus, all architecture documents or the 157-case ledger unless a failed targeted test requires it.

Minimal execution prompt once Astra has integrated the queue:

> In the authoritative BibleResearch-r10 checkout, follow AGENTS.md. Implement only task [ID] from the current local TASKS.md. Read its referenced files only. Preserve unrelated changes and never deploy/push/mutate DB. Run the named targeted tests and typecheck where needed. Mark done only on evidence. Report changed files, pass/fail and next dependency; stop.

**Parallel agents:** at most two, only independent tasks with frozen contract, exclusive file ownership, separate generated-run directories and exactly one task-queue writer. If coordinating requires repeated shared-state repair, revert to one agent.

## 11. Astra handoff checklist — things ChatGPT could not finish remotely

**Already completed in this handoff:** source comparison and licensing triage; explicit prioritization; minimum external graph schema; sense-crosswalk caution; word-form/pattern/meta-path/beam ranking design; bounded WordNet/Wikidata pilot procedures; example SPARQL; MCP/UI output principles; early-value roadmap; regression/holdout criteria; constrained model assignment guidance.

**Not done; requires the authoritative local worktree:**
- Inspect current D1.1–D1.3 completion and pending defects, newest R12 TASKS.md, exact live TS/Python interfaces and generated manifest layout.
- Verify named files and exports against the newest checkout; the accessible GitHub branches are older than R11 local.
- Check actual asset headroom and Worker local CPU measurements after D1.3.
- Pin and download/import source releases, compute exact hashes, inspect full dataset-specific notices and perform source crosswalk evaluation. No new imported WordNet/Wikidata/ChEBI/Pleiades data is claimed by this document.
- Implement and run on a representative corpus slice, independently evaluate ambiguous biblical-sense -> external concept mappings, obtain holdout labels without peeking at output.
- Map proposed M-stages into the latest local TASKS.md, keeping existing completed D-tasks unchanged; decide whether to create a short architecture companion file locally.
- Implement UI/MCP parity, full source tests, production deployment only upon explicit user authorization.

**Do not spend time on:** another broad resource search, a rewrite of R9C, a replacement ontology, importing all Wikidata/ConceptNet/OpenAlex, or training a model. The bottleneck is now local evidence-to-UI integration and iterative empirical testing, not the absence of more architectural possibilities.

---
**Handoff version:** 1.0 — 2026-11-17. This is a ready-to-execute research plan and design specification, not a benchmark report or implementation completion certificate.


## 12. Additional work completed in ChatGPT (2026-11-17)

This appendix records working, separately published research assets. The authoritative newer local R12 checkout remains untouched. The assets are **research prototypes**, not assertions of production integration.

### 12.1 Executable algorithm components and tests

- [Orthographic candidate generator](research/r12/orthographic-candidates.mjs): Hebrew consonantal and Greek unaccented form normalization, inverted bigram postings, bounded candidate retrieval, stable scoring and matched-character spans. Candidate edges are explicitly labeled ORTHOGRAPHIC_SIMILARITY / HYPOTHESIS. Identical spelling never proves a shared lexeme or etymology.
- [Orthographic tests](research/r12/orthographic-candidates.test.mjs): Hebrew Adam/dam, Greek diacritics, pointed/unpointed Hebrew, same-spelling distinct IDs, common single-letter negative cases and cross-language exclusions.
- [Structural scene candidate generator](research/r12/structural-candidates.mjs): typed participant/action/object/location feature postings, capped IDF-weighted Jaccard, minimum informative-feature overlap, bounded candidate pool and source-lineage deduplication.
- [Structural tests](research/r12/structural-candidates.test.mjs): Hagar-like independent scenes, rejected duplicate annotations, generic/unrelated negatives and explicit hypothesis labeling.
- [Prototype README](research/r12/README.md): exact commands, integration guidance and known limitations.

The two prototype test files were executed locally under Node 22 and passed (18 source-level assertions across two files). **The GitHub files still need a fresh run in the authoritative local repository** and integration with actual corpus IDs. Synthetic input tests are not empirical claims of biblical pattern discovery or full-corpus recall.

**Astra should reuse these helpers or transplant their pure functions into existing R12 compilation passes**, rather than designing another form detector or scene candidate matcher. The upstream MACULA/R8 extractor must still supply correct roles, scenes, senses and source evidence; these helper functions do not parse original-language grammar. They must not become a second discovery engine.

### 12.2 Eleven-source machine-readable pilot and rights catalog

The new [data-sources.json](research/r12/data-sources.json) records license, source URL, priority, optional download, proposed relations, allowed scope and risk for eleven resources. No dataset has yet been downloaded or imported. The catalog is a triage aid, **not** an authorization to redistribute every source field.

Added scientifically useful source candidates after the first handoff:

- **ENVO (Environment Ontology)**, native content CC0: structured classes of environments, environmental materials and systems (official source: https://obofoundry.org/ontology/envo.html). A natural fit for water, springs, rivers, wilderness and wind, subject to validated biblical-sense mapping.
- **Uberon**, CC BY 3.0 per OBO registry: anatomical terms and part/whole relations (https://obofoundry.org/ontology/uberon.html), useful for eyes, bodies and tissues.
- **PATO**, CC BY 3.0: *vocabulary of qualities*, such as color, temperature and size (https://obofoundry.org/ontology/pato.html). PATO does NOT assert that a particular biblical object has one of those qualities. Such a property must come from a separate sourced assertion.

Avoid importing whole OWL dependency closures: external imported ontology modules may have different licenses from the root. Pin release, source record IDs, allowed fields, SHA-256 and attribution *before* publication.

Source confirmations from primary documentation:

- Open English WordNet 2025 publishes JSON, XML/LMF and RDF downloads and is CC BY 4.0 (with original WordNet attribution): https://en-word.net/downloads . The common-lexeme 2025 release is a suitable small pilot, not a biblical Hebrew lexicon.
- Wikidata structured namespace facts are CC0: https://www.wikidata.org/wiki/Wikidata:Licensing . The short SPARQL wdt form loses qualifiers, while full p/ps/pq statement paths carry rank and qualifier detail; use claim-level statements for historical or conditional assertions: https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/queries .
- ChEBI publishes CC BY 4.0 chemical classifications: https://www.ebi.ac.uk/chebi/about .
- Pleiades distributes archival ancient-places data under CC BY 3.0: https://pleiades.stoa.org/downloads .
- Sefaria **links metadata** is CC BY; **texts have independent licenses**: https://developers.sefaria.org/docs/usage-of-our-name-and-logo .

### 12.3 Conditions for physical-world discovery

A high-interest world-property path has several epistemically different transitions:

1. A Bible token is attested in a specific passage with original language, scope and edition.
2. A biblical sense is mapped to an external physical or semantic class, with verified or candidate status.
3. An external source reports a class relationship or physical property with provenance, temporal/conditional scope and rights.
4. A distinct biblical sense or occurrence is attached to that class through its own independently verifiable mapping.
5. The algorithm suggests a relationship worth investigating. This is **not** an explicit biblical identification or proof of authorial intent.

A class hierarchy alone is not a physics rule. ENVO naming a WATER_SOURCE, Uberon naming an EYE and PATO naming HOT do not establish that a particular passage asserts those attributes. Distinguish typological object, material, component, emission, physical process and actual quoted identification.

Prevent generic bridge flooding: highly frequent classes (THING, OBJECT, PHYSICAL_ENTITY, generic MATERIAL), shared basic properties and low-specificity gloss mappings should not dominate the top-24. Retain them in paged exploratory evidence when potentially useful. External-property edges never count as independent **biblical textual attestations**.

### 12.4 Concrete zero-new-AI-architecture checkpoints

**Checkpoint A — direct evidence in UI/MCP:** One Hebrew and one Greek clicked occurrence with correct canonical IDs returns bounded R9B direct graph neighbors, typed evidence and original-language witnesses in both WordInspector and MCP. Requires no extra dataset.

**Checkpoint B — existing-graph multihop:** Extend R9C offline search, precompute a representative set of anchors and show a real multihop proof, independent routes, completeness metadata and exploratory pagination through the existing UI/MCP. This is the principal early product milestone.

**Checkpoint C — generic form/pattern candidates:** Feed the two published helpers with actual STEP/MACULA frames and source-local crosswalk IDs, emit source-traceable candidate graph edges and rerun the exact same pilot. Record recall, false positives, hub effects, coverage and new candidate mechanisms. No example-specific production rules.

**Checkpoint D — external semantics and science:** Import a limited licensed WordNet sense network and Wikidata property graph for verified mapped anchors, then check whether **new** useful paths appear beyond already indexed relations. Only add ENVO/ChEBI/Uberon/PATO/Pleiades after a measured gap. No full dumps or paid APIs required.

### 12.5 Scope remaining for Astra

Only the **newer local worktree** can establish D1.1–D1.3 completion, actual R12 type definitions, current reader and MCP interfaces, current shard headroom, source crosswalk accuracy and Worker CPU budgets. Astra must perform those local tasks, wire helpers into existing R12 passes and prepare real-source validation. No production deployment or database mutation was performed here.

**What is now done without Astra credits:** reusable candidate algorithms and tests; eleven-source machine-readable rights triage; additional free science ontologies research; concrete integration priorities and falsifiable acceptance checkpoints. Do not repeat that broad research unless a specific source/version/license conflict appears.


## 13. Live Supabase/Cloudflare-grounded design and executable prototypes (2026-11-17)

The source and DB design has now been refined using **read-only access to the user's existing Supabase project and Cloudflare account**. This does **not** mean production changes have been made.

**Verified database finding:** BibleResearch already has 82,485 canonical entities, 26,179 lexical senses, 2,637 roots, 744 lexical formations, 15,642 entity relationships, 8,864 concept-property records, and 2,119 external-concept links. However, the concept properties are overwhelmingly geographic metadata (place type, coordinates, OpenBible/Pleiades/Wikidata IDs, confidence), **not scientific properties of lamps, water, metals or other physical concepts**. All existing external mappings are to geographical places. The proposed world-knowledge enrichment should add a **new offline physical/semantic assertion layer** rather than reimport these rows or fill an expensive new Supabase graph database.

Read-only Cloudflare metadata confirmed scripts named bibleresearch and bibleresearch-corpus. No live R12 code or active version was deployed or changed.

**New handoff files, source code and tests:**

- [Live-schema-grounded database plan](research/r12/R12_DB_DESIGN.md): one graph, canonical identities, logical offline JSONL tables, provenance and source rights, review-state boundaries, small immutable Cloudflare shards, lazy MCP/UI hydration.
- [Source-aware property bridge algorithm](research/r12/property-bridges.mjs) and [its tests](research/r12/property-bridges.test.mjs): shared external claims, property-specific rarity, ambiguous mapping downweight, exclusion of geographic metadata fields, rights/claim provenance, external-only epistemic status.
- [Source-aware proof ranker](research/r12/proof-ranker.mjs) and [its tests](research/r12/proof-ranker.test.mjs): independent witness grouping, quality/rarity/diversity factors, epistemic weakest-link labeling, Maximal Marginal Relevance across candidate destinations, alternative paths preserved.
- [Machine-readable record JSON Schema](research/r12/evidence-contract.schema.json): external crosswalk, external assertions, typed evidence edges, stored proof paths; **proposed contract** rather than a forced rewrite of actual local R12 types.
- [Supabase SELECT-only audit queries](research/r12/r12_schema_readonly_audit.sql): accurate existing table/column names, no data mutation.
- [Optional private review schema proposal](research/r12/r12_review_schema_PROPOSAL.sql): **not executed**, defer unless existing notes/review functionality cannot support human validation of lexical-to-external mappings.
- [Research source catalog](research/r12/data-sources.json), [older orthographic and structural candidate modules](research/r12/README.md) and their tests.

**Verification scope:** The two new JavaScript modules and their corresponding test files were fetched back from GitHub and executed in an isolated JavaScript smoke harness; **26 assertions passed**. The test input is small and synthetic. This is not a full Node.js CI run, a MACULA corpus evaluation, or a Cloudflare acceptance test. The current latest local checkout still needs to adapt and execute them. No additional external data set has been downloaded/imported.

**Astra: do not redesign these pieces.** Inspect local R12 code and adopt/adapt source logic within the existing R9C ranker and R12 offline compiler; do not create a parallel graph traversal or database. Integrate in this order: direct existing graph neighbors -> real UI/MCP paths -> offline existing-graph multihop -> candidate form/scene/property edges -> broader WordNet/Wikidata pilot -> performance/holdout. Reuse source IDs and field-license gates already present; do not duplicate geographical metadata. If the helper interfaces conflict with real local types, adapt their boundaries and keep their negative tests, rather than rewriting the algorithms.

**One important data insight:** because lexical and biblical evidence already exists at substantial scale, the highest-value next work is a **crosswalk from source-attested biblical senses to external semantic/physical classes** with explicit ambiguity, not another generic lexical word list. A fact about an external concept is not a fact asserted by the biblical text. A high-interest path may remain a research lead rather than an interpretation.

All files are on GitHub main under research/r12; the authoritative C:\Projects\BibleResearch-r10 branch and TASKS.md remain unchanged.
