# Neon — Build BibleResearch as a Rabbit-Hole Discovery Explorer

**Implementation orchestrator. Execute working code, not another planning study.**

**READ FIRST:** UX_STRATEGY.md in the actual local workspace. Its 2026-11-21 **Sections 15–24** contain source-aware algorithms, interaction specifications, acceptance criteria and future context tools. **Section 24 contains the user's final layout and immediate-meaning requirements and wins over earlier conflicting wording.** Earlier sections provide existing-components audits and architecture. **Those new sections supersede earlier priority ordering.** Follow AGENTS.md and TASKS.md (single task queue) and preserve unrelated local changes. Check the local branch and active worktrees before editing; GitHub branch feat/r12-qa-fixes is an inspected reference, not a reason to overwrite newer local work.

## Goal and priorities

Turn the existing website into an interactive research environment where a user starts with any verse, word, person, place, object or topic; discovers meaningful relationships; sees the actual English and original-language evidence; follows a path into increasingly surprising connections; branches; goes backward or returns to a fork; compares chapters/verses simultaneously; and saves human observations. The user, not an AI assertion, discovers their significance.

**Priority 0: Make the relationship engine a reversible, evidence-first exploration experience. The reader must show multiple useful meanings directly without a click, and the research trail must remain fixed at the top.** Scripture preview, word identity, whole-chapter navigation and comparison are supporting parts of this *first usable loop*, not separate unrelated UI rewrites.

**Priority 1:** Clean the Word Inspector; add precise linguistic/structural highlighting and deep side-by-side comparison.

**Priority 2:** Extensible type-specific place/person/feast/object/image tools.

**Priority 3:** Advanced literary patterns/chiasm suggestions.

Do not let maps, genealogies, feast calendars, images, fancy graph physics or visual polish delay a deployable P0.

## Phase A — Inspect narrow existing capabilities, freeze adapter

Read existing code only as needed: src/main.ts; DiscoverConnections.ts; ExploreConnectionsPanel.ts; VerseReader.ts; ContextPreview.ts; WordInspector.ts; WordFormation.ts; PassageComparison.ts; PassageCrossReferences.ts; EventTimeline.ts; VerseMap.ts; src/api/rpc.ts, r10-rpc.ts, relationships-rpc.ts, corpus-client.ts; src/ui/state.ts; scripts/verify-ux-refresh.mjs.

Understand actual R10/R12 discovery/evidence/expand and R9B multihop/typed-layer responses. Read MCP_STRATEGY.md and MCP_IMPLEMENTATION_HANDOFF.md for the seven MCP capabilities (get_Passage, get_Word, get_Connection, follow_connectionchain, research, write_Note, get_prompt). **Do not call a large AI MCP response on browser hover**; use existing bounded BibleRPC reader and static-corpus endpoints. Add only a minimal read-only batched projection if a required screen truly lacks one. Respect private MCP chain security and notes authorization.

Implement one normalized UI adapter:
- typed **Anchor**: verse/passage, exact occurrence, lemma/sense, person, place, event, topic, object etc. Preserve canonical coordinates, edition, stable IDs and ambiguous candidates;
- typed **Edge**: relation type, source/target, source evidence ID and release, actual biblical witnesses, epistemic class, limitations and coverage;
- typed **Witness**: reference/range, verified word positions/alignment, full WEB text retrieved lazily, source metadata;
- typed **ExplorationStep**: parent/children, selected edge, current anchor, version and restore snapshot;
- **ToolRegistry**: available contextual tools based on type and actual source coverage.

No new competing graph traversal/ranker. Do not flatten spelling similarity into etymology, co-occurrence into synonyms, editorial xref into quotation or verified step-level edges into documented endpoint interpretations.

## Phase B — FIRST WORKING VERTICAL SLICE: follow, branch, return

Implement **client-side exploration tree + graph neighborhood + textual list + evidence inspector**, integrated with existing DiscoverConnections and ExploreConnectionsPanel:

1. Select an exact word/verse/concept from the current reader; show top 5–9 diverse related anchors with readable gloss and one real witness each. A proposed connection is not evidence until supported.
2. Click a **node** → preview; click its **edge** → explanation + complete verse evidence; click **Follow** → creates a parented trail step. Expanding a neighborhood must NOT silently navigate.
3. After multiple steps allow **Back**, **Forward**, **Return to fork**, **Return to origin**, **Try alternative**, **Revisit**. Record branch children; do not discard sibling branches.
4. Restore exact reader verse/chapter mode, selected word position, scroll anchor, filter, active evidence, pinned passages and graph viewport on return, including browser Back/Forward. The breadcrumb research trail stays fixed/sticky across the TOP, not in a collapsible left column; put it in a narrow single-row rail with fork menu and non-wrapping overflow. Combine with the existing app header rather than stacking bulky bars.
5. Dedupe repeated edges and warn when revisiting a node; graph loops do not create endless history. Show coverage/no-path/ambiguous-sense states as real outcomes.
6. Keep accessible textual cards identical in meaning to nodes and edges; SVG local graph is optional representation, with maximum 5–9 initial neighbors, expandable on demand. No heavy physics graph library.
7. Present tools: **Explore**, **Follow**, **Compare**, **Find bridge**, **Back/Fork**. Deeper tool actions appear from the selected node/edge, not a giant list of empty inspector tabs.

**First delivery checkpoint:** Genesis 2:7 → adam → adamah → Genesis 3:19 → an alternative branch → return to previous fork, showing full cited text at each edge, with exact selection preserved. This MUST work before implementing elaborate context tools.

## Phase C — seamless Scripture reader and inspectable words

Extend the **same VerseReader** with Verse / Context (bounded neighbors) / Chapter modes. Every Bible verse anywhere has a **Read chapter** action; chapter expansion retains the centered verse, selected token and active trail. Within chapter, clicking a verse returns to verse mode without losing chapter scroll state. Large chapters load bounded pages with windowing/lazy interlinear token rendering (not huge repeated MCP hydration).

- Verse mode: full World English Bible sentence **plus every ordered token** as original Hebrew/Greek script, readable transliteration, observed English *interlinear* gloss, **1–3 distinct sourced alternative meanings/renderings clearly visible without hover or click**, and one compact documented root/etymology cue when supported. Distinguish WEB from STEP gloss; don't imply alternatives are all correct in this context. **Rich interlinear is the default**; add Compact and English density controls, and reuse in chapter and comparison. Use existing rendering-range data + batched lemma/cache, not N hydrated MCP requests for N words.
- Chapter mode: all English verses visibly available in sequence; "show all original/transliteration/gloss" toggle makes **every** token in visible/loaded verses available, lazy for offscreen blocks. Each verse retains instant reference preview and original link.
- Hover/focus word: **additional** lemma, grammar, root derivation evidence, occurrence context and high-value links. The basic alternative meanings and concise root are **already on the page without interaction**. Click/Enter opens Word Focus. Source-verified occurrence mapping is mandatory.
- Hover/focus ANY verse reference: full actual WEB verse, not just a number/excerpt; pinned/tap detail has Read/Compare/Inspect. Range shows the complete first relevant verse and Expand range. Use cached bounded requests, stale-response guards, keyboard/touch parity, Escape.

Ensure Psalm heading verse 0 and canon/edition offsets are handled; a chapter cannot implicitly synthesize missing verses.

## Phase D — replace bloated Word Inspector with Word Focus

Existing word inspector repeats scores, grammar, raw IDs and redundant related words while hiding what matters. Refactor it into:

1. **Identity first:** readable gloss, transliteration, original script, selected exact occurrence and meaning/ambiguity here. Do not simply repeat all reader-tile text; lead with deeper insight: source-documented roots, possible etymology, valuable links and meaningful occurrences.
2. **Word origin:** documented roots/forms/derived names *before* similar spelling candidates; spelling candidates visibly marked unverified; per-link source evidence. Avoid fake segmentation such as asserting **Jeru = city** as a Hebrew fact for Jerusalem.
3. **Discover links now:** 4–6 diverse cards of word/passage/topic/image, each with why it matters and a full cited verse hover.
4. **Best occurrences:** source-grounded 3–5 meaningful examples chosen using UI-only rarity/semantic/role/independence heuristic specified in UX_STRATEGY.md §18; tabs for canonical order, by meaning, by book; never claim full-corpus rankings for a truncated sample.
5. **Details on demand:** all raw Strong's/word IDs, exhaustive forms, morphology codes, repeated collocations, stats, gematria, long occurrence pages and technical provenance. Keep **lemma/root/etymology, interesting connections and insightful occurrences ABOVE the fold**, not buried in details.

Keep homographs, name etymologies, lexical claims and thematic associations epistemically separate. Jerusalem first view should offer optional documented analyses/traditional literary reading and links to biblical Salem/Melchizedek without historical-etymology overclaim.

## Phase E — precise two-passage comparison and structure coloring

Extend PassageComparison to **Pin A / Pin B**, each allowing verse/context/chapter independently. Show **both complete WEB texts concurrently**, original-language token rows, transliteration and English gloss, with matching words in the same stable accessible color. Modes: Exact lemma, Source-attested LXX, Grammar, Narrative, Imagery candidates, Differences. Real source evidence is visible for each match. Mobile keeps both panes by stacked cards and sticky A/B positions.

Implement source-aware matching per UX_STRATEGY.md §§19–20:
- same-edition exact lemma ID is high-weight; shared root lower-weight and separately typed; mere spelling similarity speculative;
- Hebrew ↔ Greek receives lexical matching **only through attested LXX correspondence** with source/edition alignment; same English translation strings are not proof;
- preserve individual token positions and legitimate one-to-many source alignments; sparse weighted matching or ordered DP with gaps; do not force matches.
- Chapter comparison groups candidate verse/clause blocks by IDF-weighted lexemes, syntax roles, source xrefs, quantities bound to nouns, rare imagery and events; use sparse top-N alignment and optional explicit synchronized scrolling.
- Highlights: deterministic mapping of repeated verified lemma groups to 8–10 accessible colors, stable across the two panes, with patterns/icons if >10. Stopword-filter by default, group same verified lemma, never merge homographs; all appearances highlighted on hover. **Independent structural channel:** subject dotted-top, action solid underline, object double underline, number+noun bracket, time margin rail, negation marker. Include legend and keyboard explanation; no claim of intentional chiasm from colored repetitions.

**Test:** Genesis 2:7 ↔ Genesis 3:19; Zechariah 4 ↔ Revelation 11:4; 2 Peter 1:19 lamp/light-bearer; John 1:1 repeated G3056; same visible English source, actual original/transliteration/gloss, no fake cross-edition match.

## Phase F — plug-in contextual tools (only after P0 and core P1)

Implement a **typed ContextToolRegistry** and one working vertical example per genuinely supported source; leave the rest as explicit planned tasks if source/crosswalk/rights is absent. It must be easy to add more providers without editing the exploration state machine.

**Place:** match canonical source-identified location, not string; small popup with existing MapLibre focused marker, role in passage, uncertainty, ancient/modern candidates, optional licensed map/image. Do not equate Ezekiel's east gate with the modern Golden Gate without textual/period evidence.

**Person:** disambiguate canonical biblical person ID; bounded BFS family graph parents/spouses/children with each relation linked to a verse or verified source; Theographic/BibleData only after exact rights/provenance/crosswalk audit. Expose alternate genealogies and homonyms.

**Feast:** contextual calendar for Pesach and Torah appointed times. Display seven-feast *grouping convention* and Sabbath/eighth assembly distinctions. For modern calculated dates use verified @hebcal/core or hdate with 19-year leap cycle, Nisan/Tishrei, postponement rules, Israel/Diaspora and sunset boundary; explain chosen calculation. The biblical historical observational system is a *different uncertain model*, not the same exact algorithm. Biblical passages and Jewish later traditions separated.

**Object/image:** curated small licensed-media manifest keyed by entity; show menorah image or reconstructed tabernacle/temple plan with source/period/creator/license and exact evidence-based highlight. Wikimedia Commons images must pass individual license review. Historical illustration ≠ exact biblical-era map. Genesis **10** is Table of Nations; do not label Genesis 12 that.

**User hypothesis and quick notes:** a subtle + Note action appears on selected verse/word/connection/graph edge; one compact composer has the target and passage prefilled, a plain text field, Save/Cancel. The user may switch scope between occurrence/lemma/verse. **Connect to…** selects a second anchor and creates a clearly labeled personal hypothesis edge with its own source notes. No permission bypass or silent saves; integrate with existing NotesPanel/NoteEditor and show small contextual markers. Dragging a pinned verse/word to the edge of the screen opens Compare A/B, with touch-safe deliberate long-press and keyboard menu equivalents; preserve scroll/trail. See UX_STRATEGY.md §24 for exact pointer thresholds, drop-zone behavior, invalid-drop handling and tests.

## Phase G — optional structural/chiasm research (P3, do not block P0)

Follow UX_STRATEGY.md §21's actual computational recipe: clause/cola segmentation from existing MACULA/BibleOntology/R8 roles, independent IDF-weighted lexical/role/event/quantity features, mirrored matching for A/B/[C]/B′/A′, subtract straightforward parallel/adjacent matches and hub effects, compare shuffled/controlled baseline, require at least two independent feature families. Render text with matched bands and source citations and label **candidate**. Audit NuBerea/hebrew-poetry and ETCBC BHSA datasets for quality/rights/edition before optional reuse. No fake guaranteed chiasms.

## Orchestration and delivery

- **Start with B (reversible relationship exploration + fixed top research trail)**, then C (**always-visible inline word meanings/roots**, chapter and hover), D (insight-first Word Focus), E (**drag-to-compare**, matching/highlighting), and Quick Notes as part of these core flows. Context tools and chiasm are modular and must not delay first deployed core.
- Split into small, testable slices; delegate independent Reader/Hover, Word Focus, Compare and tests to low-tier subagents in disjoint files. Neon owns shared main.ts, typed exploration state/adapter, API contract decisions and integration. For graph/tree or evidence-contract semantics use stronger model briefly; inexpensive agents handle component assembly and fixtures.
- If another agent is still modifying ranking/MCP, use separate Git worktree/branch and **do not deploy the same live service concurrently**. Never overwrite the algorithm agent's changes. Do not edit unrelated corpus/SQL/security, and do not create a second discovery engine.
- TASKS.md is sole task queue; record implementation and unresolved source/rights gaps there, but do not create a new competing tracker.
- Every implemented slice: focused unit tests, npm.cmd run check:types/build, bounded Playwright. Extend scripts/verify-ux-refresh.mjs rather than deleting existing tests.
- Concrete Playwright acceptance: branching/refork/revisit and original scroll/word restoration; verse↔chapter↔verse and long chapter; all token triads; hover 20 references/words without heavyweight repeated requests; 2 comparison panes with exact matched words; source-scope and palette collision controls; Psalm verse 0, source editions, notes permission, keyboard, touch and 320/390px reflow; available context tools with explicit rights and uncertainty.
- Avoid full 239-case algorithm benchmark; ChatGPT will independently evaluate ranker later.
- Deploy the website via AGENTS.md direct-live development once integrated and verified; coordinate backend release, preserve rollback, actual HTTP and live interaction tests, then explicit-path commit/push. Do not claim advanced features implemented if only the registry exists.
- Handoff: research/r12/DISCOVERY_EXPLORER_UX_HANDOFF.md with exact live URL/Worker release/Git SHA, implemented/blocked P0–P3, test evidence, contracts, measured preview request count, source licenses and rollback.

**Stop condition:** P0 is only complete once a person can start reading a verse, preview a connection's complete evidence, follow multiple branches, inspect words, open chapter, compare two verses, and reliably return to an earlier fork without losing any research context. An attractive static graph, copied MCP JSON, or plan-only report does not qualify. Continue autonomously through P1 if feasible; give explicit blocked tasks rather than false completion.


## Non-negotiable refinements from the latest UX request (implement now)

1. **Visible meanings, not hover-dependent.** The verse reader must immediately show Hebrew/Greek original, transliteration, current observed English and **2–3 other distinct sourced meanings/renderings** (e.g. ruach: spirit, wind, breath), plus a short root when documented. **Never require click/hover to see the lexical richness.** Hover expands details; Word Focus shows full origin/connection evidence. Use 3 density modes (Rich default, Compact, English), tightly spaced responsive meaning tiles with proper RTL/LTR, cache profiles once per distinct lemma. No giant tiles or per-token MCP requests.
2. **Fixed/sticky top trail across screen.** Back/Fork, compact nonwrapping breadcrumb, Graph, Compare, quick + Note. The research trail is **not a collapsible left window** and must not steal precious reading width. On mobile shorten and horizontally scroll breadcrumbs, keep actions accessible, never obscure passages or keyboard.
3. **Drag/drop with safe fallback.** Drag a word, occurrence, verse or graph card to the left/right screen edge to target comparison pane A/B. Show drop zone labels and previews, keep both full passages, preserve trail and scrolling, allow Swap/Undo. Use pointer events for mouse/touch/pen with press/movement thresholds; scrolling must win over accidental drags. The exact same commands must be available via keyboard/tap menus; no touch-only/mouse-only features.
4. **Fast notes and custom connections.** Inline + Note on selection, verse, graph edge or preview; target scope visibly prefilled (specific occurrence, lemma, verse, or edge); one-field composer with explicit Save/Cancel and existing authorization. "Connect to…" creates a personal *hypothesis* edge with evidence attached, never a proven corpus relationship.
5. **Smart information hierarchy.** Spotlight full English Scripture, original/transliteration/alternate meanings, root/etymology, strongest diverse links, insightful occurrences and context maps/images where appropriate. Move Strong's, gematria, raw grammar codes, IDs, huge duplicate lists and debug information into **More/Technical details**, still accessible. Main reader ~60–70% width with inspector open; comparison uses main full width with optional evidence drawer. Avoid duplicated explanation, empty panels and oversized permanent sidebars.
6. **Required tests:** without any user interaction, ruach's alternate meanings are visible in Gen 1:2; Rich/Compact persists across verse/chapter; trail stays on top through 8 hops; drag Gen 3:19 into Compare B with Gen 2:7 pinned in A, same by keyboard, cancel/undo works; note on exact word occurrence and add a personal A→B hypothesis with explicit authorization; mobile 320/390 and zoom show no overlaps/overflow. Treat all as P0/P1 acceptance, not as future ideas.

In case of conflict between earlier wording and the above, **this refinement and UX_STRATEGY.md §24 take precedence.** Keep the graph/evidence first priority and prevent unrelated long-term tools from blocking release.
