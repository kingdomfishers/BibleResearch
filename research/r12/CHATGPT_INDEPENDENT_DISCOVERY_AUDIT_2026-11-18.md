# BibleResearch R12 — Independent Discovery Algorithm Audit

## Infrastructure status correction — 2026-11-19

**The HTTP 503 / Cloudflare `exceededCpu` incident documented in this November 18 audit is FIXED for the observed full production serial retest.** Worker `cf2182ed-b3fc-4ab6-99ab-5590e7e8a075` and MCP v43 returned valid responses on **239/239 benchmark cases** (238 `ok`, one `no_match` for unresolved “yeast”), with **zero 503/timeout/transport errors** across 222 actual MCP requests. The historic errors below describe the **prior deployed version** and remain useful for regression analysis. **Ranking, source-provenance and semantic-composition defects remain open**: 4 misleading multi-hop paths were independently rechecked and still labeled `documented_lexical_relationship`.

[2026-11-19 complete retest report](https://github.com/kingdomfishers/BibleResearch/blob/feat/r12-qa-fixes/research/r12/live_mcp_retest_2026-11-19/R12_MCP_RETEST_REPORT.md) · [Case-by-case results](https://github.com/kingdomfishers/BibleResearch/blob/feat/r12-qa-fixes/research/r12/live_mcp_retest_2026-11-19/R12_MCP_RETEST_ALL_239.json).

---


**Date:** 2026-11-18  
**Author:** ChatGPT independent audit, using live production RPC/MCP, GitHub source inspection, Cloudflare telemetry, STEP verse-token calls, and selected published scholarship.  
**Scope:** Discovery relevance, evidence correctness, unexpected multihop patterns, linguistic wordplay, physical-world provenance, ranking calibration, runtime reliability, and reproducibility.  
**Status:** AUDITED — NOT FULLY ACCEPTED. No production code or data was changed in this audit.

## 1. Exact baseline and test methodology

- Git source branch inspected: feat/r12-qa-fixes; pre-audit HEAD be46032306e511fa3e3535680c63499838c32c60; algorithm implementation 6ea3b6802d73724ffad6a54c3185a4076f7be90f.
- Cloudflare production corpus: bibleresearch-corpus Worker 7f51d378-ecef-4022-bcbc-94123397c6ec; corpus release r12-discovery-1; asset revision c23272125b34f179237e1c61381ec0b3b9b7329ef8b92e282f6ae496194bf994.
- Website Worker: d147114c-6a5c-4927-80ed-2a48877c2af4.
- Main Supabase Edge MCP: bible-mcp v42, health reports 46 tools, 22 prompts and note writes enabled; connected ChatGPT tool listing was not refreshed to expose an independent v2 discovery tool at audit time.
- URLs: https://bibleresearch-corpus.kingdomfishers-custom.workers.dev ; https://bibleresearch.kingdomfishers-custom.workers.dev ; https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp.
- Direct production POST: /v1/rpc/discover_biblical_connections_v2 with JSON including query, limit:25, max_hops:5. Tested by PostgreSQL extensions.http_post as an HTTP test transport, not by calling database discovery functions. Its default approximately 5-second HTTP timeout was too short for cold Workers; subsequent calls set CURLOPT_TIMEOUT_MS to 22000–25000 inside the read-only SQL statement. Some requests still failed/returned HTTP 500.
- Evidence was retrieved via the connected production BibleResearch get_connection_evidence_v1 and/or direct corpus POST to /v1/rpc/get_connection_evidence_v1. Canonical STEP occurrence tokens were independently checked with prompt_verse_words. No write tools or note mutations were called.
- This is a structured, reproducible diagnostic sample, NOT a pre-registered blind holdout, exhaustive corpus test, independent human relevance study, or claim of statistical recall/precision. The 48 pilot anchors were explicitly chosen in scripts/build-r12-pilot.mjs; they are not a random held-out sample.

### High-level result

The engine can find legitimate, surprisingly useful connections, but ranks mechanically valid yet semantically incoherent chains almost as highly as good connections, sometimes higher. The physical-world layer has a **provenance-integrity defect**, in addition to coverage and reproducibility limitations. Do not call R12 ranking or external physical claims fully accepted until these are repaired.

## 2. Predictions and observed outcomes

The expectations are explicit functional hypotheses/negative controls; these tests were not sealed independently before pilot construction. PASS = observed behavior meets the stated expectation; PARTIAL = evidence exists but key discovery/verification requirement missing; FAIL = a reproducible counterexample; BLOCKED = request failure prevented judgment.

| ID | Query / expected algorithm behavior | Actual observation | Outcome |
|---|---|---|---|
| P01 | Single original-language query H0120 should surface meaningful Adam/ground/blood leads, with attested vs form similarity distinguished | H0120 top result is existing Genesis 2:5–7 Adam/adamah wordplay; H1818 blood not promoted to top. After prompting “Adam dam,” six exact same-verse contacts surfaced, including Genesis 9:6 | PARTIAL |
| P02 | Hebrew אדם / דם spelling connection exists but is NOT asserted to be etymology | Evidence r12:orth:H0120:H1818 explicitly reports unpointed shared substring דם, score 0.825, with non-etymology warning | PASS |
| P03 | Seeded “Adam dam” should identify actual verse evidence rather than infer shared roots | r11:intersect:verse:H0120:H1818:212 (Gen 9:6) quotes human blood and the image of God; also Gen 9:5, Prov 28:17, Ezek 14:19, 22:2, 39:17 | PASS (co-occurrence only) |
| P04 | “menorah lamp fire smoke” should construct an ordered, sourced lamp/material/flame/smoke or vision chain | R11 finds Zech 4 lampstand/lamp/oil/Spirit/eyes, H0784+H6227 fire/smoke in Gen 15:17 and Exod 19:18; no unified justified four-part R12 path; r12_discovery absent for full natural-language query | PARTIAL / FAIL full bridge |
| P05 | “unleavened bread Red Sea crossing” should find chronological/narrative connection beyond isolated words | Returns existing candidate r10:pattern:death_passage_life_passover_redsea (rank 16), Passover and Exodus 14 references, but does not independently assemble the historical/chronological relationship | PARTIAL, NOT new R12 discovery |
| P06 | “three days resurrection” should prioritize canonical death/restoration-on-third-day passages | Top result was Gen 5:23 because a numeral related to 365 and “days” co-occur, not an actual three-day restoration event; more noisy co-occurrences | FAIL |
| P07 | “Hosea 6:2 Matthew 12:40 three days” should compare corporate “raise us” and Jesus/Jonah event language, with typology distinguished from quotation | Explicit passage text returned, but no ranked Hosea↔Jesus relationship; Matthew’s three-day occurrences dominated | FAIL |
| P08 | Blind H0231 (hyssop) should find nontrivial cross-testament lexical/ritual connection | r12:path:H0231:G2053: hyssop -> scarlet -> scarlet wool; Exod 12:22; Lev 14:4; Heb 9:19 | PASS as useful research lead |
| P09 | Blind G3088 (lamp) should find distinctive light/morning-star relation and cite the strongest direct witness | r12:path:G3088:G5459 finds lamp -> illuminate -> light-bearer; however does not cite 2 Pet 1:19, where STEP independently verifies BOTH G3088 (pos 12) and G5459 (pos 22) in the same verse | PARTIAL; evidence/rank missed direct witness |
| P10 | Blind H1285 (covenant) should surface coherent literary connections | r12:path:H1285:G1953: covenant -> Hebrew forget -> LXX forget -> Greek forgetfulness, backed by 2 Kgs 17:38, Deut 4:23. G1953 occurs in James 1:25; algorithm does not itself complete that last contextual link | PASS as source-backed intermediate; PARTIAL as whole-passage discovery |
| P11 | Blind H2233 (seed) should find real covenantal descendant relations | r12:path:H2233:H4135: seed -> Abraham -> circumcision, anchored in 2 Chr 20:7, Isa 41:8, Gen 17:26, 21:4 | PASS as a sensible multi-passage lead |
| P12 | Multihop ranking should not elevate semantically incoherent chains merely because each step is true somewhere | Hagar -> gave birth -> daughter -> ostrich (r12:path:H1904:H3284), interest 0.850632, independent group C=1, rank 3 of query H1904. No evidence Hagar is related to ostriches | FAIL — major relevance issue |
| P13 | A weak chain should rank below a well-attested cross-book theme | Hagar->ostrich 0.850632 outranks hyssop->scarlet wool 0.843435; eye->pity->spare->angel (r12:path:H5869:G0032) 0.851057 also high | FAIL — Q/C/D/T do not measure whole-path semantic coherence |
| P14 | Structural parallels must have multiple genuinely distinct informative features | r12:struct:H5869:1CH_21:16:2SA_18:24 claims Jaccard=1 with three shared features; all three encode the same lifted-eyes grammatical object relationship/participant, so evidence is largely redundant | FAIL as strong structural-pattern ranking; possible shallow descriptive match |
| P15 | Physical bridges must cite exact independently verifiable sourced assertions | r12:prop:G3088:H5216 resolves both biblical lamps to the SAME OEWN synset and Wikidata QID; source code additionally synthesizes wd:combustion_fuel_agent and wd:related_physical_class pseudo-predicates with claim_status=sourced | FAIL provenance / novelty for physical-property mechanism |
| P16 | Eye/spring polysemy must not transfer anatomical properties to physical water | r12:prop:H5869:G4077 combines verified H5869_eye mapping with Greek spring mapping through external hypernym; correctly labeled exploratory candidate, but risks mixed senses. Occurrence-specific Gen 16:7 and Zech 4:10 v2 queries produced client errors or HTTP 500, so context-guarding could not be verified | PARTIAL with significant unresolved risk |
| P17 | Every single-word pilot query should expose R12 and report scope accurately | H5869, H0120, H1904, G3088 etc show r12_discovery; natural multi-term queries often show r12_discovery:null even when terms or passages contain pilot lemmas. Coverage is just 48 manual anchors | PARTIAL — limited query routing/coverage |
| P18 | Deployment must be stable under independent live testing | Cloudflare telemetry sampled 136 corpus events: 3 HTTP 503 exceededCpu, 2 HTTP 500 on v2 discovery; some MCP evidence calls returned 503 under parallel load | FAIL reliability acceptance |
| P19 | A fresh checkout of active branch must contain all compiler dependencies | scripts/build-r12-pilot.mjs imports ../research/r12/{proof-ranker,property-bridges,structural-candidates,orthographic-candidates}.mjs. Those files were NOT found by GitHub fetch_file on feat/r12-qa-fixes; they exist on main. Active-branch standalone reproducibility is therefore not established | FAIL / reproducibility blocker |

## 3. Positive evidence: what the engine really discovered

### A. Adam and dam: a correct distinction between form and scripture

- Canonical lexemes: H0120 אָדָם (adam, human/man), H1818 דָּם (dam, blood).
- Orthographic candidate: r12:orth:H0120:H1818. Shared consonantal sequence דם; similarity 0.825; explicitly NOT a proved root/derivation.
- Direct source: r11:intersect:verse:H0120:H1818:212, Genesis 9:6: whoever sheds human blood, by a human shall his blood be shed, because God made the human in God's image.
- Discovery mode matters: raw H0120 did not prioritize dam; “Adam dam” explicitly supplied both words and surfaced their contact. Therefore the latter is RECOGNITION of prompted evidence, not an autonomous discovery of a previously unknown connection.
- Value: exact wordplay candidates linked to contextual evidence are useful; do not silently upgrade same letters to etymology or claim the passage was composed to make this play unless argued separately.

### B. Hyssop -> scarlet -> wool: best tested cross-testament example

Evidence ID: r12:path:H0231:G2053. Tool-reported score interest 0.843435, Q 0.762553, C 1, D 1, T 0.75, 11 alleged independent groups.

Exact displayed path:
1. H0231 hyssop -> H8438 תּוֹלָע (“worm,” also used in scarlet-dye contexts), contextual collocation, examples Exod 12:22 and Lev 14:4/6.
2. H8438 -> G2847 κόκκινος (“scarlet”), LXX lexical bridge; path step has **no direct witness_ref**, so mapping validation should be explicit.
3. G2847 -> G2053 ἔριον (“wool”), grammatical modification, Heb 9:19.

Actual verse basis:
- Exod 12:22: hyssop is used to apply Passover blood.
- Lev 14:4: scarlet and hyssop occur in cleansing ritual.
- Heb 9:19: scarlet wool and hyssop accompany ritual sprinkling.

Judgment: relevant multi-document ritual connection, recovered starting from only H0231; not a new historical discovery because Heb 9:19 itself makes the association explicit. Improve by indexing direct ritual-scene correspondence and distinguishing source-original color/dye terms from biological “worm.”

### C. Greek lamp -> light-bearer/morning star: strong missed direct evidence

Evidence ID: r12:path:G3088:G5459. Score 0.876491; displayed proof G3088 lamp -> G5461 illuminate (Luke 11:36) -> G5459 φωσφόρος light-bringer (shared-root lexical claim).

Independently verified from the LIVE BibleResearch STEP token tool:
- 2 Peter 1:19 G3088 λύχνος at position 12.
- 2 Peter 1:19 G5459 φωσφόρος at position 22.

Both endpoints are in the same verse. The tool's selected 2-hop proof instead cites Luke 11:36 and John 1:9. This is a useful lexical path but misses the **strongest exact textual witness** and gives its own indirect path a high score. The single-verse lamp-to-daystar progression is already discussed in published Bible commentary, so cannot be claimed academically new.

### D. Seed -> Abraham -> circumcision: meaningful but endpoint nuance matters

Evidence ID: r12:path:H2233:H4135. Interest 0.857646. Steps: seed/offspring H2233 -> Abraham H0085 in 2 Chr 20:7 and Isa 41:8; Abraham -> circumcise H4135 in Gen 17:26 and 21:4. Supports a legitimate covenantal research path. Does not itself prove every use of “seed” concerns circumcision; filter by historical participant/context.

### E. Covenant -> forgetfulness -> James: most interesting research lead to follow up

Evidence ID: r12:path:H1285:G1953. Interest 0.867429, Q 0.85119, C 0.935785, 7 support groups.

Path:
- H1285 בְּרִית covenant -> H7911 שָׁכַח forget: Deut 4:23; 2 Kgs 17:38 (“do not forget the covenant”).
- H7911 -> LXX Greek ἐπιλήθω: translation bridge, including Deut 4:23 as a source example.
- ἐπιλήθω -> NT G1953 ἐπιλησμονή forgetfulness: source-reported lexical relative.

A NEW, independently performed follow-up was needed: live STEP tokens verify G1953 at James 1:25 position 14. James contrasts a forgetful hearer with a person who perseveres in, and does, the perfect law. This yields a useful **research question**: might James' doing-versus-forgetting exhortation echo Israel's covenantal memory imperative? It is not established literary dependence.

**Scholarly novelty check:** This general connection has already been discussed. A 2002 Glasgow dissertation discusses James 1:22–24 and the “covenantal memory motif,” explicitly referencing Deut 4:9,23. https://theses.gla.ac.uk/1082/1/2002mayphd.pdf ; see also https://www.icr.org/article/forgetful-hearers/ . Therefore this is a personally surprising tool-assisted lead, NOT a verified first-ever discovery. Claiming no theologian has noticed a connection cannot be justified from absence of search results.

**Exact tool contribution:** starting with only H1285, the algorithm surfaced G1953 through a three-step Hebrew/LXX/Greek path; independent researcher then looked up G1953's actual NT occurrence (James 1:25) and evaluated interpretation. The graph helped FIND a research lead; it did NOT establish the theological conclusion.

## 4. The four specifically requested discovery challenges

### Adam–dam

PASS at orthographic candidate level and attested Genesis 9 lexical co-occurrence. No historical derivation established; user-supplied two-word query is not blind discovery. Evidence IDs above.

### Menorah–lamp–fire–smoke

PARTIAL. The system has genuine component relations:
- Zech 4:2–14 ties H4501 menorah, H5216 lamp, H8081 oil, H7307 Spirit, and H5869 eyes. Evidence r10:corresp:zech4_menorah_oil_spirit_eyes.
- Fire H0784 and smoke H6227 are in Gen 15:17 and Exod 19:18; the latter directly says Sinai smoked because the LORD descended in fire. Evidence r11:intersect:verse:H0784:H6227:2045.
- The broad query “menorah lamp fire smoke” produced NO r12_discovery pilot output and no single source-backed path accounting for oil, combustion, light, smoke and distinct biblical narrative settings.
- A shared physical process does not establish a common theological referent; “fire produces smoke” needs sourced, correctly scoped external claims rather than a hardcoded fake Wikidata predicate.

### Feast of Unleavened Bread–Red Sea

PARTIAL: “unleavened bread Red Sea crossing” returned an already curated R10 candidate r10:pattern:death_passage_life_passover_redsea at rank 16, not a newly inferred R12 bridge. Evidence describes Exod 12:13 death passing the marked doorway, Exod 14:30 escape by sea, and Rom 6:3–4 baptismal death/life; note that this is a literary analogy, not an explicit biblical statement that the feast commemorates the sea crossing. Stronger available evidence to retrieve/align in future: Exod 12:15–20, 12:39; 13:3–10; 14:21–31; Deut 16:3; Num 33:3–8; 1 Cor 10:1–2. Distinguish festival chronology, Exodus deliverance history, later liturgical association and New Testament typology.

### Hosea's third day–Jesus

FAIL as automatic discovery. Hosea 6:2 and Matt 12:40 supplied together led to generic “three + days” results, not a source-scoped cross-book restoration parallel. Unseeded “three days resurrection” returned Genesis 5:23 first (numerical language that is NOT a three-day resurrection). Correct targets: Hos 6:2 restoration of “us” (Israel), 1 Cor 15:4 “raised on the third day,” Matt 12:40 Jonah's three days, Luke 24:46; test exact event/subject/scope. The Hosea-Jesus interpretation is already well known, and disputed as an explicit intended reference: https://scholar.csl.edu/theo/2022/sessions/20/ and https://intertextual.bible/text/lxx-hosea-6.2/1-corinthains-15.4 . Avoid labeling Hosea's collective restoration as an explicit prediction about Jesus without further argument.

## 5. Critical defects and source-level causes

### P0 — Path ranking confuses independently sourced STEPS with evidence that the ENDPOINTS are meaningfully related

Counterexamples:
- r12:path:H1904:H3284: Hagar -> give birth -> daughter -> ostrich, interest 0.850632, C=1, 9 alleged independent biblical support groups.
- r12:path:H5869:G0032: eye -> pity -> spare -> angel, interest 0.851057, C=1.
- Both compare favorably against useful hyssop -> scarlet wool 0.843435.

Each hop has source witnesses, but those witnesses refer to different people, contexts and relations. The convergence metric counts independent statements supporting any step of a chain, not independent source evidence for a coherent whole-path or anchor/destination relationship. Ranking requires a path-level coherence component, not just geometric mean of individual edges.

Recommended repair: retain step-local witnesses separately from anchor/destination convergence; C_endpoint should count **independent whole-path/endpoint-level proofs**, zero when only disconnected intermediary attestations exist. Add clause/role/participant/episode continuity, semantic specificity, and explicit typed join safeguards. Penalize generic relation hops and long paths without source continuity. Preserve exploratory paths but do not rank them as documented lexical connections.

### P0 — Evidence label overstates multihop conclusions

In src/relationships/r10-discovery.ts lines 271–284, multihop recs get finalScore = 700 + 260 * interest; lines 277–278 use documented_lexical_relationship unless a step itself is HYPOTHESIS. A chain of genuine but unrelated textual steps thus becomes an allegedly documented **lexical** relation between Hagar and ostrich. “Source-backed individual steps” must NOT imply “documented endpoint lexical relationship.” Set explicit epistemic classification to computational/interpretive path hypothesis, distinct from source facts at each step. Ranking must not silently promote unsupported endpoint significance.

### P0 — External-world claim provenance has fabricated statement identities / predicates

scripts/acquire-r12-external-pilot.mjs lines 713–762:
- wd:related_physical_class is emitted for hand-entered subclass/class target pairs using an arbitrary found claim on the subject, not necessarily a claim about the asserted target; synthesized source_id appends “:class:<target>” to a different original statement.
- wd:combustion_fuel_agent is a manually added domain inference from lamp descriptions. It is NOT an extracted Wikidata P-number structured claim. It is emitted with provider Wikidata, source_id “wd-rev-...:fuel:...”, claim_status sourced and a revision URL. This makes a synthetic predicate look like original source-attested Wikidata structured data.
- r12:prop:G3088:H5216 shows these pseudo-claims under shared_features along with actual Wikidata Q821952 P279 statement and OEWN synset. Both endpoints are mapped to the SAME OEWN 03641539-n and Wikidata Q821952, so the “discovery” is partly an already asserted identity, not independent physical insight.

Required: distinguish ORIGINAL_WIKIDATA_STATEMENT (exact statement ID, P-ID, snak target, qualifiers) from DERIVED_PHYSICAL_ASSERTION with transparent derivation and source-text limitations, or remove unsupported rows. Never create a synthetic statement ID that looks extract-native. Failing assertions must NOT ship as sourced facts. Rebuild pilot from exact source claims only, then audit all 291 output assertions.

### P1 — Algorithm has parallel compiler/runtime implementations

scripts/build-r12-pilot.mjs lines 21–24 imports research/r12/proof-ranker.mjs and prototype helpers; lines 336–385 implement a separate bespoke traversal and call rankDiscoveryDestinations from the prototype. Yet src/relationships/multihop-search.ts defines runR12BeamSearch (line 558) and src/relationships/path-ranker.ts defines scoreR12Path (575) and rankR12DiscoveryDestinations (683). The offline pilot is NOT clearly using the stated authoritative traversal/ranker; code paths can diverge. Consolidate offline and runtime into one actual reusable implementation and a single scoring contract; compare identical pilot fixture hashes.

### P1 — Active feature branch cannot independently reproduce the compiled pilot

GitHub fetch_file on feat/r12-qa-fixes returned NOT_FOUND for research/r12/proof-ranker.mjs, property-bridges.mjs, structural-candidates.mjs, orthographic-candidates.mjs, despite scripts/build-r12-pilot.mjs importing these exact paths. They exist on main. Put required source/tests/pins in the active authoritative branch (or use a clearly pinned build dependency), with explicit-path commits; verify clean checkout build. Existing generated static bundle not tracked is fine, but the input/compiler manifest must be reproducible.

### P1 — Structural pattern features are correlated duplicates

r12:struct:H5869:1CH_21:16:2SA_18:24 returns Jaccard 1.0 on “three shared roles”: anchor:H5869 grammatical_object_of, participant:H5375 attested, role H5869->H5375 grammatical_object_of. These largely restate the same lifted-eyes syntax, rather than three independent action/participant/setting correspondences. Test structural parallels with feature families and min two independent mechanisms, counterexamples, and scene-level semantic context.

### P1 — Sense and concept bridging is insufficiently constrained

r12:prop:H5869:G4077 returns a candidate mapping across H5869_eye (explicitly verified anatomical sense) and G4077 spring via a shared external hypernym; the “spring” meaning of H5869 is a distinct candidate sense. This produces a potentially interesting eye/spring analogy, but risks projecting incompatible senses. Exact occurrence Gen 16:7 H5869 pos 5 word 109560 vs Zech 4:10 pos 15 word 109292 should constrain applicable sense. During this audit those occurrence-specific v2 calls failed through the HTTP test client / Worker 500, so **do not claim this guard verified**.

### P1 — Pilot availability not integrated into natural-language multi-concept discovery

A single H4501, G3088, H5869 or H1285 query includes R12 pilot records; “menorah lamp fire smoke”, “unleavened bread Red Sea crossing” and “three days resurrection” returned legacy/R11 results without r12_discovery, despite relevant indexed terms. Query resolution/anchor selection and fallback need explicit coverage disclosure and better scoped multi-anchor traversal. Do not fabricate output for unindexed anchors.

### P1 — Live CPU and HTTP reliability

Sampled Cloudflare corpus telemetry (75-minute lookback; 136 events, NOT entire system request history): 121 HTTP 200, 9 HTTP 204, 2 HTTP 500, 3 HTTP 503, 1 without response status. Three 503s had outcome exceededCpu (on reader overview and word-form batch, not only discovery); two discovery v2 HTTP 500 events. Observed reported CPU across these events median approximately 105 ms, P95 approximately 628 ms, max 1310 ms (sample/method dependent). Some high-concurrency MCP evidence calls returned 503. Do not claim zero failures or Free-tier CPU acceptance. R12's 1.11 MiB compressed pilot is loaded under Workers; optimize compact per-anchor/offline lookup and reuse existing packed loader rather than larger in-request decompression. First reproduce the 500 cases with exact error logs and occurrence inputs.

### P2 — Pilot quality/coverage and presentation

- Only 48 manually selected anchor lemmas, 24 Hebrew/24 Greek, are precomputed; same 48 are used in demonstrations; “48/48 with paths” says nothing about hidden discovery quality or generalization.
- Path grades often saturate: Q around 0.84–0.90, C=1, D=1 on both strong and weak paths. Calibrate with blinded pairwise labels (relevant vs tangential), degree-preserving random-baseline graphs, and a curated-but-held-out evaluation suite.
- For v2 result bodies the top-level release_id still says r11-v1.0 while the optional r12_discovery.release_id identifies r12-discovery-1. Clarify to clients that R12 is a partial additive pilot, not full-corpus completion.
- Combined static asset total exactly 20,000; add no more standalone files without packing/sharding changes.
- This ChatGPT connector session did not expose a separate discover_biblical_connections_v2 tool even though main server v42 was deployed; actual corpus v2 was tested directly, and MCP v1/evidence/coverage were tested via connector. Confirm deployed tools/list vs refreshed ChatGPT tool registry; do not infer parity from health alone.
- Full interactive live website was NOT independently tested in this audit because browser-extension control was unavailable. Existing Argon browser smoke assertion is not a substitute for this audit's live browser interaction.

## 6. Independent discovery novelty check

Asked to find a genuinely surprising original interpretation not previously noticed by theologians. **No such historical originality can be certified**, and the best leads checked are already discussed in existing scholarship:
- H5869 eye/spring around Hagar: scholarly wordplay analyses exist: https://etzion.org.il/en/tanakh/studies-tanakh/literary-readings-tanakh/leitwort-vi and https://wjudaism.library.utoronto.ca/index.php/wjudaism/article/download/14663/11656/34638 .
- Hos 6:2/third-day resurrection: substantial existing scholarship: https://scholar.csl.edu/theo/2022/sessions/20/ .
- Deut 4:23 covenant forgetting ↔ James 1:25 forgetful hearer: already treated in 2002 scholarly work and earlier exposition (links in §3E).
- Lamp/morning star 2 Pet 1:19: https://tips.translation.bible/tip_term/translation-commentary-on-2-peter-119/ .

**Most surprising to this auditor:** H1285 covenant → H7911 forget → LXX Greek forget -> G1953 forgetfulness. The automatic path surfaced a precise rare NT lexeme, which, when independently looked up, landed in James 1:25 and produced a plausible cross-book research question. This is a **tool-assisted rediscovery/research lead, not verified scholarly novelty or literary dependence**. The tool found the word chain, not the complete James parallel; that distinction is essential.

## 7. Prioritized correction milestones and predicted acceptance results

### NEXT-1 (P0): repair world-source identity and epistemic contracts

1. Delete or relabel synthetic wd:combustion_fuel_agent and wd:related_physical_class as explicit compiler hypotheses with derivation, never source-native Wikidata claims.
2. Assert every imported original Wikidata claim has a real subject, P-number predicate, exact statement GUID, target, rank and qualifier match to the pinned raw extract. Negative-test an arbitrary unrelated source claim (must fail).
3. External bridge claims must show actual independent external relation versus two lemmas mapped to identical modern QID/synset. Rename identity bridges accordingly.
4. Return EXPLORATORY for every composed external path, independent biblical support zero; no promotion by ranking.

**Prediction:** G3088/H5216 remains an informative cross-language object mapping; fake attributed “Wikidata fuel property” disappears or becomes explicitly inferred; zero synthetic statement GUIDs pass the sourced-claim validator.

### NEXT-2 (P0): endpoint-coherent multihop ranking

1. Keep edge-wise attestation groups but separate them from whole-path/endpoint support; never infer 9 support routes from 9 unrelated step witnesses.
2. Add an explainable path coherence/continuity factor: typed semantic compatibility, lexical sense fit, shared participants/events/statement scope, and signal above a generic degree-controlled null baseline. For mixed-script LXX bridge require actual mapped source attestation.
3. Use weakest-link semantics. Assign every composed path an exploratory interpretation tier unless a text directly links endpoints. Preserve the steps as individually documented facts.
4. Human-rank positive and negative pairs before weight optimization; report rank changes and zero authoritarian false labels.

**Predictions:** On a fresh ranking, Hagar->ostrich and eye->angel are demoted below hyssop->scarlet wool, seed->Abraham->circumcision, and lamp->light-bringer. “C=1” must not describe endpoint convergence for these disconnected chains. Evidence IDs and source-step metadata remain stable or version-mapped.

### NEXT-3 (P1): distinguish scene/quantifier semantics

1. Normalize syntactically correlated structural features into independent feature families: action, participant role, object, polarity, time/event, discourse/quotation. Require at least two distinct families.
2. Treat "three days" as quantity attached to DAYS within a scoped event, not any verse with “three” and “days” or a large numeral containing three.
3. Compile canonical event sequences and chronology with sourced anchor links: Exod 12/13 departure/unleavened bread -> Exod 14 sea crossing; Hosea 6:2 corporate third-day revival vs Jesus/Jonah resurrection typology as candidate (not authorial quotation).
4. Distinguish new derived result from preloaded curated R10 motif.

**Predictions:** Gen 5:23 will no longer lead “three days resurrection”; Hos 6:2 + 1 Cor 15:4 will surface as a labeled cross-book *candidate comparison*, not a direct proof. “Unleavened bread/Red Sea” must show exact event chronology without claiming Exodus explicitly ties the feast to crossing day.

### NEXT-4 (P1): unify compiler, files and deployment efficiency

1. Port/retain one shared beam traversal and one shared ranker actually called by the offline builder. Remove duplicate production-authoritative implementations; verify same fixture hashes and stable cursor.
2. Commit missing referenced research/r12 modules and their tests (currently absent on feature branch), source download SHA pins and generated manifest inputs. Verify fresh-checkout offline pilot reproduction.
3. Stop using a full-r12-pilot read if normal word search can read a compact precomputed page; keep 20,000-asset budget with packing.
4. Make natural query resolver choose bounded relevant pilot anchors and explicitly report partial/unmapped coverage. Improve runtime telemetry and rare 500/503 cases.

**Predictions:** clean branch checkout can recompile pilot deterministically; basic one-anchor discovery on cold Worker avoids CPU-limit errors in a separately measured short stress sample; manual "menorah lamp fire smoke" exposes relevant pilot links or a clear not-precomputed scope. Do not claim global P95 CPU performance on a tiny sample.

### NEXT-5 (P2): independent measurement after fixes

Separate test set selected by reviewer *after* freezing candidate algorithm, including ≥12 unseen examples from ≥4 mechanisms, ≥8 deliberately misleading links, 8 Hebrew/Greek homograph cases, directed property qualifier controls, query-seeding sensitivity, and comparison to current R11 baseline. Have independent humans grade relevance/novelty/interpretation separately. Report top-5 precision, candidate recall, false authoritative claim count, Brier score only if calibrated probabilities are actually estimated (otherwise N/A), and per-category feature attribution. Do not optimize to the 48 pilot anchor list.

## 8. Exact reproducibility capsule

- Main direct discovery route: POST https://bibleresearch-corpus.kingdomfishers-custom.workers.dev/v1/rpc/discover_biblical_connections_v2 with {"query":"H1904","limit":25,"max_hops":5}, or query H0231, G3088, H1285, H0120, H5869.
- Multihop negative evidence IDs: r12:path:H1904:H3284 ; r12:path:H5869:G0032.
- Stronger multihop IDs: r12:path:H0231:G2053 ; r12:path:H2233:H4135 ; r12:path:G3088:G5459 ; r12:path:H1285:G1953.
- Orthographic candidate: r12:orth:H0120:H1818.
- Physical bridge: r12:prop:G3088:H5216; mixed-sense candidate r12:prop:H5869:G4077.
- Structural warning: r12:struct:H5869:1CH_21:16:2SA_18:24.
- Original textual baseline IDs: r11:intersect:verse:H0120:H1818:212 ; r11:intersect:verse:H0784:H6227:2045 ; r10:pattern:death_passage_life_passover_redsea ; r10:corresp:zech4_menorah_oil_spirit_eyes.
- Targeted semantic query strings: “Adam dam”; “menorah lamp fire smoke”; “unleavened bread Red Sea crossing”; “Exodus 12:15 Exodus 14:21”; “three days resurrection”; “Hosea 6:2 Matthew 12:40 three days”.
- Original token cross-checks: 2 Pet 1:19 G3088 pos 12 and G5459 pos 22; James 1:25 G1953 pos 14; Gen 16:7 H5869 pos 5 word 109560 and pos 9 word 109554; Zech 4:10 H5869 pos 15 word 109292.
- Main MCP direct coverage get_relationship_coverage_v2 returned r9b-v1.1 and verified r12-discovery-1, Worker 7f51d378; get_notes read returned status ok and epistemic_layer user_note.
- No data writes performed. Some occurrence-context v2 test requests returned 500 or timeout; those are recorded as failed transport/runtime tests, NOT as successful sense discrimination. Browser interaction not directly tested.

## 9. One-sentence engineering verdict

R12 demonstrates credible retrieval of interesting cross-textual leads, but the immediate improvement must be **epistemic integrity of the world-data claims, endpoint-coherent ranking, and reproducible single-source algorithms**, before increasing graph coverage or claiming novel theological findings.
