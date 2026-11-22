# BibleResearch — UX implementation specification

**Version:** 2026-11-22, optimized for AI coding. **Status:** user-approved functionality; visual styling is adaptable.  
**Repository:** \`kingdomfishers/BibleResearch\` · branch \`feat/r12-qa-fixes\` · root path \`UX_STRATEGY.md\`.  
**Authority:** \`AGENTS.md\` (repository safety/workflow), actual local workspace (code), \`ARCHITECTURE.md\` (system boundaries), \`PROJECTMAP.md\` (file locations), \`TASKS.md\` (only task queue). Preserve unrelated and concurrent agent work.

## 0. Product contract — read this first

**Goal:** Scripture-first exploration. A reader immediately sees original-language words, transliterations, English meanings and meaningful patterns; clicks a word to inspect deeper lexical evidence, follows surprising but source-backed relationships through a graph, compares passages and returns to earlier research forks without losing context. The software **reveals relationships and witnesses, not AI-generated theological interpretations**.

**Non-negotiable UX decisions:**

| Surface | Required behavior |
| --- | --- |
| Top | Fixed, legible **research trail** with Back/Fork/Graph/Compare/Note; older crumbs collapse on long journeys. No left-hand history accordion. |
| Search | Search + book/chapter/verse selector below the trail. Start with last/current Bible passage. |
| Verse reading | **Interlinear visually dominates**. Complete WEB English verse in smaller readable type above. Every source word shows original script, transliteration, contextual English rendering, plus up to **2–3 distinct attested alternative usages** without hover. Flowing word units; **no roots or spelling relatives inside reader tiles**. |
| Hebrew layout | Token tiles **LTR by default**, toggle RTL. Individual Hebrew words always render in correct RTL letter order, with intact diacritics and canonical IDs. |
| Chapter reading | **Continuous English only**, with verse selection returning to rich interlinear. Restore scroll and focus when switching modes. |
| Inspector | Hidden until selection; opens beside Scripture, independently scrollable, automatically changes when another word/entity/edge is selected. |
| Word inspector | Compact first-glance form + lemma (each original/translit/English), distinct senses, root with translit/English, **3–4 similar-spelling words**, important occurrences and compact expandable graph. Strong's/gematria/raw codes live in Technical details. |
| Media | When relevant, a compact **slideshow at top of inspector** for maps, images, diagrams and 3D models; expand selected slide into full detail popup. Hide completely when no media. |
| Passage research | **Below the Scripture reader:** large passage relationship graph first, then selected research tools. Word graph also appears compactly in inspector; expand button or top Graph action enlarges the **same** graph. |
| Graph | Default strongest ~8–12, at most **20 visible connection nodes**. Organized relationship-type colors; important nodes near center, less important via zoom out/Show more. **Hover node previews; click node follows and changes focus; click edge inspects actual evidence without navigating.** |
| Comparison | Full A/B passages visible simultaneously; **independent scrolling**; stable matching colors, hover highlights both corresponding words; inspector remains available; optional passage-to-passage connection graph. |
| Structure | Same-lemma repetition and source-backed grammatical roles **on by default**, with separate visual encodings, legend and toggles. |
| Notes | Easy +Note and Connect to… for selected occurrence/lemma/verse/edge; prefilled scope, explicit Save; personal hypotheses visibly distinct from corpus relationships. |
| Research history | One **branching, reversible trail**, restoring reader/inspector/graph/comparison state. No multiple sessions/bookmarks required in this version. |

**Information hierarchy:** Scripture and original-language understanding first; meaningful graph links and real evidence second; context-specific media/tools on demand; technical identifiers, exhaustive raw data and gematria remain findable but visually secondary.

**Source truth:** distinguish surface form, occurrence ID, lemma, sense, root, similar spelling, translation alignment, literary association, grammatical edge and human hypothesis. Do not turn a candidate spelling resemblance into an established root or a graph path into a proven endpoint identity. Show what evidence exists, with source and uncertainty. Historical/lexical interpretations belong in sourced evidence views, not AI-generated commentary.

**Implementation directive:** build the **complete feasible specification** in coordinated slices; not merely a prototype. No intermediate visual-design review gates are required. Keep \`npm run dev\` alive and localhost updated via HMR; **no screenshots, videos, generated mockups or preview links** required. Run focused integration tests; report unavailable datasets/capabilities precisely. Request approval before *shared production deployment or major merge* (the UX-specific release gate).

---

## 1. Code architecture — extend, don't rebuild

**Stack:** Vite, vanilla TypeScript and CSS; MapLibre for maps; \`BibleRPC\` browser gateway; Cloudflare immutable corpus/evidence; Supabase user notes and mutable research; existing R8/R9B/R10–R12 deterministic relationships. \`bible-mcp\` AI-oriented hydrated results are not a browser hover API.

**Reuse current files** (inspect real exports and \`PROJECTMAP.md\`; paths/ownership may evolve):

| Responsibility | Existing module / implementation entry |
| --- | --- |
| App shell + state wiring | \`src/main.ts\`, \`src/ui/state.ts\` |
| Navigation / search | \`src/ui/components/NavSelector.ts\`, \`StudySearch.ts\` |
| Reader / interlinear | \`VerseReader.ts\`, \`WordRenderingRange.ts\`, \`TranslationChoice.ts\` |
| Hover previews | \`ContextPreview.ts\` |
| Word inspector and word formation | \`WordInspector.ts\`, \`WordFormation.ts\` |
| Relationship data / graph | \`DiscoverConnections.ts\`, \`ExploreConnectionsPanel.ts\`, current relationship RPCs |
| Passage comparison | \`PassageComparison.ts\` |
| Research tools | \`PassageCrossReferences.ts\`, \`VerseMap.ts\`, \`EventTimeline.ts\`, notes/research panels |
| Data gateway | \`src/api/rpc.ts\`, \`r10-rpc.ts\`, \`relationships-rpc.ts\`, \`corpus-client.ts\` |
| Styles | \`src/ui/styles.css\`, \`src/ui/styles-base.css\`, \`styles-workspace.css\`, other \`styles-*.css\` |
| Tests | \`scripts/verify-ux-refresh.mjs\` and existing focused scripts |

**Implement one typed UI evidence adapter**, not a second discovery algorithm. Required logical types (use existing types where possible):

- \`Anchor {kind, key, edition?, passage?, occurrenceId?, lemmaId?, label, original?, transliteration?, gloss?}\`: kind is word occurrence/lemma/sense, verse/passage, person/place/event/object/concept/external.
- \`Witness {ref, edition, source, matchedOccurrenceIds?, evidenceId?, completeEnglishText? [lazy], provenance, coverage}\`.
- \`Edge {id, from, to, mechanism, epistemicClass, witnessIds, explanationOfMechanism, sourceRelease, limitations}\`.
- \`TrailStep {id, parentId, childIds[], focusedAnchor, incomingEdge?, snapshot}\`.
- \`Snapshot {readerRef, readerMode, selection, readerScroll, inspectorContext, inspectorScroll, graphFocus, graphZoom, graphFilters, researchTab, comparisonA/B, comparisonScrolls, highlightModes}\`.
- \`InspectorContext\` and \`CompareSlot\` share exact canonical IDs with the other surfaces.
- \`ContextToolProvider\` identifies supported anchor type, capability prerequisites, evidence/rights, compact renderer and expandable detail renderer.

Separate \`PREVIEW\` from \`FOCUS\`, \`FOLLOW_NODE\`, \`INSPECT_EDGE\`, \`EXPAND_GRAPH\`, \`GO_BACK/FORK\`, \`SWITCH_READER_MODE\`, \`PIN_COMPARE\`, \`SAVE_NOTE\`. **Preview must never append history**. Graph/list/inspector/trail/compare consume the same state; share retrieval caches, avoid repeated hydration.

**Data boundaries:** browser UI calls existing bounded BibleRPC/read-only projections. Do not expose private MCP capabilities, Supabase service credentials or unvalidated notes writes. Keep user data in existing permission model and source/provenance in the evidence adapter. No corpus rebuild, DB schema redesign, new paid dependency or ranking rewrite unless genuinely required and separately justified.

### 1.1 One centralized, AI-editable design system

Create/adapt **\`src/ui/design/\`** as the single discoverable source of shared visual definitions, integrating existing CSS theme variables rather than duplicating them:

- \`tokens.css\`: palettes/light-dark/high-contrast, text and Hebrew font scale, spacing, radii, shadows, borders, interactive states, header/inspector/compare dimensions, breakpoints, animation, layers; **separate semantic relation colors from lexical repetition colors**.
- \`components.css\`: reusable Button, Card, Tag, Tab, Tooltip/Preview, Modal, InspectorFrame, WordTile, TrailCrumb, GraphNode/Edge, MediaViewer, ComparePane, input and note variants.
- \`primitives.ts\` **only for actual repeated DOM code**, not a parallel framework.
- \`README.md\`: where the few global tokens/variants live and how a future AI redesigns all surfaces through them. No second palette or value registry in the README.
- Dev-only component preview (or focused dev route) using **real shared styles**, to verify one token change affects reader, graph, inspector, trail and comparison simultaneously.

Features may keep structural CSS, but must consume shared tokens/variants; no scattered duplicate theme hex values or repeated button/card styles. Preserve compatibility with existing \`--background\`, \`--panel\`, \`--gold\` etc. while migrating. New semantic relationship classes must work with color-vision differences and keyboard focus. **Do not move all app logic into one massive component**.

---

## 2. Layout and navigation

### 2.1 Desktop

- Fixed top research trail ~52–64px, never obscuring content. Back, Fork and last 2–5 readable crumbs; older steps available via history menu. Graph/Compare/Note accessible.
- Flowing search/selector row under header. Then **dominant Scripture reader**. If inspector closed, reader takes full available width. On selection show **right inspector ~32–38% width**, reader ~62–68%; independently scrollable, resizable/collapsible. No permanent empty sidebar.
- The current passage's research area follows **below Scripture**. Default selected tool is **Connections** full graph; others are one active surface at a time: Structure, Cross-references, Comparison, Places/Events, Occurrences, My notes. Preserve tab and scroll states.
- Inspector may show word-level local graph, while research area shows verse-level graph. Expansion shows the **same graph data/selection** at a larger scale; no duplicate traversal engine or inconsistent results.

### 2.2 Mobile and intermediate widths

- 768–1199px: adaptive reader + inspector drawer/overlay if side-by-side would crush text.
- 320–767px: single column; inspector bottom/full-screen sheet with independent scroll, compact fixed trail; expanded graph in a full sheet; A/B compare retains both independent reading positions via stacked panes with A/B jump controls.
- Support 320/390/768/1280/1440px and 200% zoom, 44px controls, keyboard/screen-reader focus, contrast, touch, reduced motion, no unwanted page-wide horizontal overflow. Scrollbars belong to panels only when needed.

---

## 3. Scripture reader

### 3.1 Verse mode

Render full English verse (WEB if available) **in smaller but readable prose above** a dominant flowing interlinear. Per original orthographic word/token group:

1. Original Hebrew/Aramaic/Greek script with accurate marks.
2. Transliteration.
3. **English here**: existing attested rendering/gloss or user choice; clarify it is not identical to the complete WEB prose.
4. **Also**: 2–3 *distinct, sourced alternative renderings/meaning families* visible without interaction. If absent, omit row. No invented meanings.
5. Lightweight source-backed repetition/grammar/note markers. **No root or spelling relatives inline.**

Use subtle flowing word units, not large boxed mini-dictionaries. Group source morphemes into their real written word where the existing records allow; keep morpheme/occurrence IDs recoverable for deeper inspection.

**Hebrew layout toggle:** default spatial **left-to-right sequence of word tiles**, option right-to-left. Source token array and canonical occurrence order never change; only visual flex/grid flow changes. Each Hebrew script run renders internally RTL under Unicode isolation; transliteration and English stay LTR. Punctuation, niqqud, selection and keyboard arrow behavior remain correct. Persist preference. Greek stays LTR.

**Alternatives:** normalize case/punctuation, deduplicate near-identical short renderings within supported rendering groups, preserve distinct sense families/homographs; rank attested frequency + meaning diversity, cap at 2–3; cache profiles per lemma+edition+release (not one RPC for every visible token). A literal English surface match alone cannot identify an exact original-language sense.

### 3.2 Reference and word interactions

- Hover/focus **word**: short additional preview of lemma original/transliterated, documented root with translit/English, simple grammar, selected useful occurrence(s). Do not force a large MCP request on hover. Click/Enter exact occurrence: open/reuse inspector and record focus in trail.
- Hover/focus **verse reference anywhere**: **complete actual English verse** (not merely citation); range begins with complete first relevant verse and offers Expand. Citation previews reused across graph, notes, occurrences and comparison; Escape/focus/touch parity.
- Click reference: select verse in reader; choosing Chapter expands to English-only chapter. Source entity names may open a relevant inspector tool when exact identity is known; unresolved identity stays explicit.
- Clicking another selected word changes inspector focus, not a stack of many inspectors. Hover never changes focus/trail.

### 3.3 Chapter mode

Continuous **English-only** chapter with verse references. Switch Verse→Chapter centers selected verse, Chapter→Verse opens detailed interlinear for selected verse. Preserve both modes' scroll anchor, selection, trail and inspector. Repetition/structure markers on English require reliable source alignment; otherwise use verse-level markers rather than fabricating word correspondence. Support Psalm verse 0 and differing edition numbering. Fetch English chapter in bounded requests, not 40 full word-inspector payloads.

---

## 4. Context inspector / Word Focus

**One context-sensitive inspector** for word, verse, edge, person, place, feast, object, event and selected compare correspondence. Closed until focus; keeps its own scroll and can expand a subsection without hijacking Scripture.

**Content order:**

1. **Conditional media slideshow first:** small ~180–220px only if real map/photo/diagram/3D model exists. Each slide opens a larger modal with zoom/pan or interactive map/model, source/creator/license, creation date vs era depicted, and uncertainty. No relevant media → no reserved blank space.
2. **Immediate word/entity identity:** selected surface original/translit/English, lemma original/translit/English, meanings here vs other attested uses, root/formation original/translit/English; concise and readable.
3. **3–4 similar-spelling relations in Word Focus**, expandable; show spelling, translit, English, relation label. Differentiate morphology, documented root, literary wordplay, orthographic resemblance and translation links. No spelling relatives in reader.
4. **Small word graph** with strongest ~5–8 nodes; an Expand action opens full graph in passage research surface/modal. Graph appears early, not after exhaustive occurrences.
5. **3–5 valuable occurrences** with short “why relevant” and complete verse preview. Provide Most revealing / Canonical / By meaning / By book, paginated expansion.
6. **More/Technical details:** all forms, full provenance, grammatical codes, raw IDs/Strong's, counts and gematria. Don't duplicate large prose already in reader.

**Spelling suggestion algorithm:** compare Unicode-normalized consonantal forms (strip Hebrew niqqud/cantillation only in comparison representation; preserve displayed original). Prefer an existing lexical-neighbor index, otherwise bounded Levenshtein/Jaro candidate search; rank meaningful similar forms with source/witness diversity and anti-homograph filtering. Display first 3–4 and expand. Spelling similarity is a **candidate form relation**, not silently a root claim.

**Useful occurrence ordering (deterministic UI heuristic):**

\`score = 4*directWitness + 3*identityMatch + 2*distinctSense + 2*distinctiveSyntax + 2*witnessStrength + rarityContext - 3*duplicatePenalty\`.

Input is bounded actual retrieved occurrences, not synthetic examples. After scoring, select diverse witnesses by a simple novelty penalty (e.g. MMR: 0.65 relevance − 0.35 similarity to selected). Prefer distinct contexts/senses/genres, avoid five near-identical verses, show why selected. **Never claim global ranking from a partial result page.** Keep backend discovery ranker intact.

---

## 5. Relationship graph and research trail

### 5.1 Single graph in multiple surfaces

Inspector word view ~5–8 neighbors; passage research below reader ~8–12 initial; expanded Graph action presents the same state at larger scale. **Never exceed 20 simultaneously visible connection nodes**. Every node has readable label and anchor kind; every edge has a typed relation and source evidence. Relation type colors and non-color symbols: lexical, documented root/wordplay, grammar, textual, LXX, narrative/event, geography/physical, personal hypothesis.

**Graph presentation:** use existing backend-ranked edges. Deduplicate same target+relation+witness family; retain a useful mix of mechanisms. Sort existing scores, use priority bands (e.g. strongest 5, next 7, next 8) in stable grouped radial/sector layout. Strongest nodes nearest/larger; outer rings lower-ranked. Zoom in shows fewer clearer nodes; zoom out reveals up to 20; more beyond cap requires Show more/pagination/clustering. Keep positions stable while zooming. **Pan/zoom is a viewport transform, while revealing more results is an explicit bounded query/action**; don't confuse expanding coverage with magnifying coordinates.

**Interaction contract (important):**
- Hover/focus node → short identity + best witnessed verse preview, **no navigation**.
- **Click node → immediately follow**, center that anchor and append a research-trail step. Clicking a word node opens word inspector; passage node navigates reader.
- Hover/focus edge → typed mechanism, two endpoints, supporting citation and uncertainty.
- **Click edge → inspector evidence, without changing graph focus or trail**. Show both endpoints, complete relevant verses, source language witness, edition, limitations. Multi-hop evidence is per-hop, not automatic proof of a direct endpoint relationship.
- Expand neighborhood / zoom → no trail change. “Visited earlier” is clearly marked, and loops do not create infinite uncontrolled histories.
- Accessible textual result cards mirror graph actions/evidence for keyboard/assistive tech. No heavy force layout dependency required.

### 5.2 One reversible branching session

A trail step has \`parent\` + \`children\`, selected anchor, incoming edge and saved workspace snapshot; new exploration from a previous step creates a **new child branch**, not deletion of existing forward paths.

Actions: preview, follow, inspect edge, expand neighbors, back, forward, choose fork, return to origin, pin compare, switch reader, select research tool. Store reader ref/mode/scroll/exact token; inspector entity/scroll; graph focus/zoom/filters; compare A/B/scrolls; current research tab/highlight. Back/Fork restores these precisely without refetching everything.

Fixed header shows recent ~2–5 crumbs, older steps accessible by history control; Fork menu lists previously explored alternate branches. No bookmarks or multiple sessions needed for this release. Browser state is local, subject to existing privacy/storage policy; do **not** expose private MCP chain capability handles.

### 5.3 Research tools below passage

Default **Connections** graph. Other tabs: Structure, Cross-references, Comparison, Places/Events, Occurrences, Notes/My connections. Render one active tool at a time, keep its state. Use existing graph / bridge / path APIs for alternate paths and “find bridge”; no new inference engine. If no supported path within coverage, say so and offer manual hypothesis creation.

---

## 6. Passage comparison and structural patterns

### 6.1 Two complete passages, independent scrolling

Pin A/B from reference, occurrence, inspector, graph or drag. Desktop: two equal readable main-content panes; mobile: stacked panes, both accessible. **Independent scrolling by default**, explicit one-shot Align available. A and B each use Verse (full WEB + rich interlinear), Context or Chapter (English-only); reader inspector stays available as right drawer/overlay. Preserve pins and scroll when following trails.

Controls: Pin/Replace A/B, Swap, Clear; Exact lemma / Documented root / Attested cross-language / Grammar / Narrative/imagery candidates / Differences; evidence pane and optional A↔B↔wider-Scripture connection graph. Hovering matched token highlights counterpart(s) **in both texts**; do not permanently draw a tangled mass of crossing lines through paragraphs.

**Token matching implementation:**
1. Fetch exact occurrence/edition IDs from existing corpus; form sparse candidates preserving repeated occurrences.
2. Exact same supported lemma/sense in compatible language/edition: weight **5**. Documented shared root **2**, verified same grammatical role **1**, source-attested LXX/Hebrew–Greek cross-language lexical witness **4** in its own lane. Mere similar English gloss or spelling has **no verified lexical match**.
3. Use deterministic maximum-weight bipartite assignment or ordered sequence DP with gaps; permit one-to-many only when corpus morphology explicitly supports it. Label uncertainty and candidate classes instead of forcing correspondence.
4. Use stable color per verified match group across both passages; root-related but distinct lemma gets separate mark; selected match highlights all corresponding occurrences. Word focus opens exact source evidence.
5. For verse/clause/chapter candidates, use bounded block comparison with source syntax/xrefs/events; initial score \`0.40*rareLemmaIDFJaccard + 0.25*roleAgreement + 0.20*documentedXrefOrEvent + 0.15*distinctImageOrQuantity\`. Penalize generic words/hubs. Use sparse top-N alignments, not all-versus-all across huge chapters. Mark as **candidate correspondence**, distinct from verified occurrence match.
6. Comparison summary: Verified exact matches, Supported related forms, Candidate patterns, Differences; click each to focus both passages. No generated theological conclusion.

### 6.2 Drag-to-compare (progressive enhancement)

A draggable word/verse/graph witness carries canonical typed IDs, not raw HTML or secrets. Confirm mouse drag after ~6–8 CSS px, touch long-press ~300–400ms with scrolling priority; show **left edge = Pin A**, **right edge = Pin B**, plus pane targets with preview. Word drop pins its **containing verse and selected token**. Escape/cancel/invalid drop leaves state unchanged; support Undo. Keyboard/tap **Pin A / Pin B / Compare with current** invokes the same commands. Drag must never create an automatic note or hypothesis.

### 6.3 Source-backed patterns **on by default**

**Repetition channel:** group by verified lemma+edition (and sense when necessary), not by English surface or generic Strong's. Show groups occurring at least twice in visible context; suppress function words by default. Stable accessible 8–10-color palette shared between A/B, keyed to match group. For more groups use non-color patterns/legend/selection. Hover highlights all matching instances. Across Hebrew/Greek share color only when attested LXX correspondence; otherwise show candidate marker.

**Grammar/structure channel:** independent from colors, using existing R8/MACULA syntactic roles: subject/agent dotted top edge; action single underline; object double underline; negation bar; number+noun bracket; time/sequence rail; parallel clause marker. Must be source-backed. Controls Both (default), Repetition, Structure, Off; accessible legend/text explanation.

Compute lexical groups in O(tokens + groups) with map lemma→occurrence positions; cache by verse/edition/release; only update visible mounted DOM. Do not claim structural evidence where data is absent.

**Optional later structural/chiasm detection:** split into supported clauses/units; feature groups rare lemma, roles, source-backed motif/event/quantity; mirrored A–B–[C]–B′–A′ match score \`0.45*lexical + 0.25*roles + 0.20*eventOrImage + 0.10*parallelOrContrast\` versus forward/adjacent and seeded shuffled baseline; penalize hubs; require ≥2 independent evidence families, show complete passages and label as a *candidate*, never known authorial intention. Not a blocker for core release; implement if real source/mapping permits.

---

## 7. Contextual tools: provider registry, not bespoke screens

\`ContextToolRegistry\` declares supported anchor kind, capability/source requirements, compact inspector renderer, media slides, expandable popup, evidence provenance and loading. **Show tools only when relevant and available**; don't reserve blank space or fabricate photos/models.

| Type | Compact inspector behavior | Expanded behavior / data rules |
| --- | --- | --- |
| Place | Mini MapLibre map + place label, role in passage and ambiguity | Interactive map + optional licensed historical image, alternative candidate places, **era depicted vs source creation date**, uncertainty. Eastern gate identification depends on text/period. |
| Person | Small relation/family graph (resolved person ID) | Bounded 1–2-generation BFS, ~15–25 people, sourced father/mother/spouse/child/sibling edges; same-name people remain distinct. |
| Feast | Relevant calendar/feast slide, scripture refs | Pesach and appointed-times overview; show Passover 14 Nisan, Unleavened Bread 15–21; modern fixed Hebrew calendar with calculation model distinct from ancient calendar uncertainties. “Seven feasts” is a grouping convention. |
| Object | Menorah/temple/tabernacle image, schematic, or sourced model | Zoomable viewer or lightweight interactive 3D/plan, period, provenance, linked Exodus/Zechariah/Revelation witnesses. |
| Verse/passage | Local map, chronology, genealogy or imagery only when relevant | Genesis **10** Table of Nations shows genealogy and uncertain geographic identifications in different layers; crosslinks return to Scripture. |
| Timeline/event | Source-backed dates/sequence and relevant people/places | Expand existing chronology view; distinguish modelled chronology vs explicit textual date. |

**Media manifest:** entity key, asset URL, type, creator/license/attribution, creation date, period depicted, evidence references, uncertainty, optional overlay coordinates. Lazy load selected image/model only; respect source rights, existing free budget and old-device performance. No automatic unlicensed scraping/hotlinking. If a provider has no valid data, hide rather than show fake content. Graph relation evidence and media contextual information must remain traceable.

---

## 8. Notes and personal relationships

- Selected word **occurrence vs lemma**, verse, phrase or graph edge → subtle +Note, one-field editor with exact scope/reference prefilled, changeable before explicit Save/Cancel.
- \`Connect to…\` selects a second exact anchor via reader/graph/search/compare. Save optional explanation and supporting verse refs as **user_hypothesis**; show “My connection” with separate edge styling and layer toggle.
- Keep existing Supabase authentication, ownership, RLS/DLM/review constraints. Never auto-save from a drag, hover or graph navigation; no privilege/security modifications.
- Note markers appear on exact source word/verse/graph edge; don't silently attach a note about one word occurrence to every token with similar English or Strong's.

---

## 9. Implementation DAG and efficient subagent ownership

**Build full feasible feature coverage, integrate continuously; no intermediate user approval checkpoints.** A shared production deployment/major merge still needs explicit authorization for this UX task. Use **\`npm run dev\`** from the correct local checkout, reusing an existing Vite process, to keep localhost HMR live. No screenshots/videos/preview URLs. Avoid reading this entire specification in every subagent; delegate relevant numbered sections and exact file ownership only.

**Phase 0 — architecture baseline (orchestrator, short):**
- Check actual local branch, git status/worktrees, AGENTS.md/pre-code skill, available gateway methods and concurrent agent ownership; use GitHub copy as design reference without overwriting dirty local changes.
- Create central UI evidence adapter and exploration state/actions/snapshot contract (§1, §5.2); establish design token entry point (§1.1) and bounded data methods. Decide disjoint file owners and integration points. Keep the plan concise in TASKS.md, not duplicate strategy docs.

**Parallel batch A — after shared contracts are fixed:**
- **Reader agent (§3, §2):** VerseReader + reference hover, chapter switch, Hebrew LTR/RTL layout, original/translit/English/alternatives, cached requests. Own reader files + focused tests.
- **Inspector agent (§4, §7):** WordInspector/WordFormation/ContextToolRegistry; compact meanings/lemma/root/spelling, media slideshow, lazy tools. Own inspector files + focused tests.
- **Graph agent (§5):** DiscoverConnections/ExploreConnectionsPanel unified through adapter; 20-node view, zoom/rings, evidence preview/click semantics, textual fallback. Own graph files + focused tests.
- **Design agent (§1.1):** central shared tokens/components/preview, safe incremental CSS migration; coordinate styling contracts before editing components owned by others. Own design files + tokens.
- **Compare agent (§6):** PassageComparison + matching/highlights/pins/drag; source-aware labels, independent scroll, keyboard parity. Own comparison module + focused tests.
- **Notes agent (§8)** if useful and disjoint: NotesPanel/NoteEditor hooks via existing commands/auth, personal hypotheses. Avoid parallel modification of main.ts/shared state.

**Orchestrator integration (serial where necessary):** owns \`src/main.ts\`, \`src/ui/state.ts\`, shared adapter/types/API routing and global event wiring; do not let subagents edit these concurrently. Integrate batch A one surface at a time as soon as ready; use Vite HMR and cheap real interaction checks, not a giant merge at the end. Context tools can be delegated as independent provider implementations once inspector/registry contract is stable. Optional chiasm later.

**Phase B — focused integrated tests and fixes:** type/build, existing Playwright route tests, targeted touch/keyboard/graph/compare cases. Fix regressions, record coverage gaps explicitly; avoid the full unrelated 239-case ranker benchmark, redundant source research and endless design-option generation. User will inspect localhost themselves.

**Phase C — completion / handoff:** report implemented features by §, actual tests, missing source coverage and blockers, file paths/tokens entry point and release status. Ask before shared deployment/major merge. Do not describe unimplemented context providers as completed.

**Quality constraints:** no blanket refactor, no new framework, no new semantic discovery ranker, no exposed MCP chain handles, no paid services, no destructive SQL, no changing notes permissions, preserve previous work. Small bounded API projections only if essential; keep expensive MCP hydration out of hot browser paths.

---

## 10. Acceptance gates — test what matters

Use existing \`scripts/verify-ux-refresh.mjs\`, focused unit tests and Playwright. Avoid using screenshot existence as evidence of working UX. **All items below are user journeys or source-contract assertions; unavailable upstream data must produce an honest covered/unavailable state.**

| ID | Test and required result |
| --- | --- |
| A01 | Open current/last Scripture → search/selectors, dominant reader, **inspector hidden** until selection, fixed top research trail visible while scrolling. |
| A02 | Genesis 2:7 Verse: small whole WEB English above flowing Hebrew original/translit/current rendering/≤3 alternative uses; no root or similar spellings inline. |
| A03 | Toggle Hebrew token spatial LTR↔RTL: same canonical occurrence IDs, correct internal Hebrew RTL glyph order/diacritics, correct selection/focus/keyboard position. |
| A04 | Genesis 1:2 **ruach** alternatives are visible without hover where sourced; lemma/root appear in hover/Word Focus, not inline; no overclaiming contextual sense. |
| A05 | Chapter mode Genesis 2 is **English only**; select verse returns interlinear; switching back restores chapter scroll; Psalm superscriptions/verse 0 and edition shifts supported. |
| A06 | Click word opens right Word Focus, independent scroll. Shows lemma in both scripts, meanings, root/translit/gloss, 3–4 similar forms, graph and revealing occurrences; raw Strong's/gematria behind Details. Clicking next word replaces focus. |
| A07 | Media slideshow when genuine media exists (map/image/model), expand-to-popup and dismiss restores inspector; absent media does not leave empty box. |
| A08 | Graph initial ~8–12, max 20 connections; relation types identifiable; zoom/Show more reveals lower-ranked nodes with stable layout. Hover node previews, click node follows, click edge inspects witness **without navigation**. |
| A09 | Follow Gen 2:7 → adam → adamah → other passage → Back/Fork returns exact reader, inspector scroll, graph zoom/filters and A/B pins; trail stays fixed; revisit/forks work. |
| A10 | Passage research below Scripture shares graph state with inspector/expanded view; tool switching does not reset Scripture. |
| A11 | Compare Gen 2:7 A with Gen 3:19 B: both complete texts, independent scroll; exact lemma highlights identical hues in both; hover matching word highlights both and reveals source in inspector; unsupported same-English-only alignment not asserted. |
| A12 | Same-lemma repetitions + source-backed syntax markings visible by default; two independent channels and toggles; mixed Hebrew/Greek requires attested mapping; English chapter only shows precise token highlights where backed by mapping. |
| A13 | Drag word/verse toward A/B: correct containing verse and selected occurrence, keyboard/touch equivalents, invalid drop/Escape/Undo safe. |
| A14 | Quick +Note scoped to exact occurrence/verse/edge, saved only by explicit action with existing auth. Personal A→B relationship labeled My connection, never promoted to corpus evidence. |
| A15 | Place/person/feast/object tools show relevant real media + evidence, expandable; license and historical model visible; missing provider returns unavailable rather than fake demo. |
| A16 | 320/390/768/1280/1440px, 200% zoom, dark/light, direction and highlight controls, touch scrolling/keyboard focus, independent panes, reduced motion, no page overflow. |
| A17 | Change one design-system palette/spacing/WordTile variant centrally → consistent result across reader, inspector, graph, trail and comparison; no duplicated competing theme values. |
| A18 | No large hydrated MCP calls per hover or token; bounded concurrent fetch, caches, generation guard against stale response, graph ≤20 nodes, chapter lazy loading, fast navigation on older mobile hardware. |
| A19 | Each displayed relationship carries the real mechanism, source witness and limitations; no AI-written theological conclusions, fabricated Scripture or silent corpus-data edits. |
| A20 | Build/typecheck/focused browser tests pass; explicit completion matrix maps implemented vs unavailable provider/data; no unauthorized production deployment. |

**Recommended representative research journeys:** Gen 2:7 ↔ Gen 3:19 (adam/adamah/dust), Gen 1:2 (ruach), Zechariah 4 ↔ Revelation 11 (menorah/olive trees as typed source links), Jerusalem/Salem place/word research, a Pesach calendar, a person family graph. Their relationships and translations must be retrieved from actual sources, not transcribed from this document as hardcoded UI facts.

---

## 11. External evidence and rollout constraints

Prefer **already ingested** STEP Hebrew/Greek, Macula, MorphHB, Swete LXX, R8 syntax/roles, R9B/R10–R12 discoveries, current maps, notes and chronology. Verify actual API availability before coding against a record.

Optional provider candidates to **audit before integration**: ETCBC BHSA/Text-Fabric for clause research, a sourced poetry annotation dataset for parallelism candidates, Theographic for geospatial/person metadata, a modern Hebrew calendar library (e.g. Hebcal) for *modern fixed* calendar calculations, Wikimedia Commons/media source manifests, other verified map providers. External genealogy/geography claims require source citations, canonical identity and licensing review.

**Design invariant:** Useful original-language evidence and surprising graph patterns appear with minimal interaction; technical details never overwhelm; all exploration is reversible; all source-dependent modules show clear availability and provenance. Future AI agents can change the entire look through the shared design-system tokens and primitives without changing lexical, graph or notes logic.
