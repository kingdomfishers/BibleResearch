# BibleResearch UX Strategy — Evidence-First Discovery Explorer (Rabbit-Hole Research UX)

**Revised:** 2026-11-21 (relationship-first, refined for always-visible meanings and compact workspace). **Status:** implementation specification, superseding the 2026-11-05 UX refresh proposal where they differ. **Branch inspected:** feat/r12-qa-fixes. **Authority:** AGENTS.md and local workspace remain authoritative for implementation; TASKS.md is the only task queue.

**IMPLEMENTATION PRIORITY UPDATE:** The primary milestone is reversible interactive relationship exploration *with* immediate readable Scripture, not a static Bible-reader refresh. **Sections 15–24 take precedence on milestone order** wherever older sections conflict. **Section 24 takes precedence for inline reader meanings, top research trail, drag/drop, notes and spatial layout.** Build discovery trail + inspectable edges first; chapter/interlinear and comparison are core parts of that first working exploration loop. Maps, genealogy, feast calendars, images, and advanced structural/chiasm suggestions are later tools in the same extensible system.

## 0. Product principle and measurable outcome

The product is not a catalog of Bible references or a decorative network graph. It is a **Bible reading and exploration workspace** that makes surprising, grounded relationships intelligible in seconds. Scripture is the foreground; a graph provides navigation; evidence explains why edges exist; the reader remains free to notice patterns the algorithm cannot interpret.

Four core actions, available on every appropriate surface:

1. **Preview** — understand a word or read an entire cited verse without navigating.
2. **Inspect** — see original-language context, translations, witnesses, provenance and epistemic limitations.
3. **Compare** — display two or more actual passages simultaneously with aligned observations.
4. **Follow** — traverse, branch, return to and save a path of discoveries.

Success criteria: a user can read a cited verse in one hover/focus or tap, inspect a word's English/gloss/transliteration immediately, compare two entire verses without losing the original, and understand which evidence supports each graph edge. Discovery quality remains separate from infrastructure and visual acceptance.

**Priority:** correctness of text and token identity > readable evidence > frictionless interaction > navigation/graph > additional research functions > decoration.

## 1. Verified current capabilities — reuse rather than rebuild

Source and connected MCP inspection on 2026-11-21 (not a completed end-to-end browser usability test):

### Website components already present

- **src/main.ts:** working reader-focused app shell, reader, inspector, cross-references, DiscoverConnections panel, notes, map, timeline, preview and comparison. Existing #book-chapter-verse navigation, search, theme and passage-selection state.
- **VerseReader.ts:** full WEB English verse, ordered STEP-based original-language tokens, transliterations, occurrence renderings, rendering-range links, clickable words, note counts and place links.
- **ContextPreview.ts:** 240 ms hover/focus preview using BibleRPC.getReaderPassage; persistent pointer preview, Escape handling, full English verse; pinned sheet has Compare/Open actions. Improve centrality and discoverability, do not reimplement it.
- **WordInspector.ts:** nonmodal inspector with definitions, related words, word formation, occurrence pagination, LXX/grammatical relationships and notes. It currently requires selection; add lightweight hover preview independent of deep inspector fetching.
- **PassageComparison.ts:** side-by-side English and concatenated original text for two verses. **Main gap:** no per-token transliteration/gloss, evidence alignment, phrase selection, third passage or reusable pin slots.
- **DiscoverConnections.ts:** large standalone R10–R12 discovery workspace with search, modes, clusters, source references and expand/drill-down. **Main gap:** primarily result listings/chips rather than a synchronized Scripture/graph/evidence workbench.
- **ExploreConnectionsPanel.ts:** existing R9B typed graph layers, target concept resolution, bounded multihop paths, source references, pagination and evidence cards. Reuse logic; unify with discovery instead of introducing another graph engine.
- **PassageCrossReferences.ts, LexicalRelationshipsSection.ts, RelationshipExplorer.ts, ResearchPanel.ts:** multiple overlapping evidence and query surfaces. Consolidate reader-facing entry points; preserve technical tools under Advanced Research.
- **VerseMap.ts, EventTimeline, ChronologyPanel, NotesPanel/NoteEditor:** geography, historical models, related narrative passages, user/AI notes and association workflows. Preserve these as optional contextual lanes, not competing primary screens.
- **BibleRPC src/api/rpc.ts, r10-rpc.ts, relationships-rpc.ts, corpus-client.ts:** supported reader, lexical, notes and graph clients, with existing static corpus caching and gateway routing. Use these adapters. Do not initialize new Supabase clients inside UI components.
- **scripts/verify-ux-refresh.mjs:** Playwright scenarios already cover full WEB preview, two-verse comparison, ruach renderings, Psalm 3/2 Samuel context, place focus, repeated Greek word selection, responsive widths and themes. Extend rather than discard.

### New MCP v2 — seven user-facing research functions

Live connected tools and GitHub MCP source inspected:

1. **get_Passage** — full WEB and original text for verse/range/chapter; ordered word positions with shared lexicon, transliterations, glosses, LXX, passage/verse connections, named geography and chronology; pagination default 30/max 40; optional word_depth/etymology/realworld.
2. **get_Word** — original-language lemma/form, transliteration, senses/candidates, grammar, occurrence evidence, LXX, etymology (documented versus spelling candidates), gematria, real-world data and connections; supports passage anchoring.
3. **get_Connection** — compares 2–6 mixed passages, words or concepts with typed relation lanes, references and explicit uncertainty.
4. **follow_connectionchain** — follow, branch, revisit, inspect; private expiring 24-hour server-side capability handle and trail; currently may record exploratory arbitrary hops.
5. **research** — evidence, occurrences, word intersection, grammar search, LXX, gematria, numbers, chronology, geography, passage comparison, notes, set intersection/union/difference; batched 1–8 operations.
6. **write_Note** — authenticated notes and DLM validation, **never call without user authorization**.
7. **get_prompt** — guidance for AI tool use, not a reader-facing UX element.

GitHub sources: research/r12/MCP_STRATEGY.md, MCP_IMPLEMENTATION_HANDOFF.md, mcp_v2_live_audit_2026-11-20/REPORT.md and ROOT_CAUSE_WORD_ID_MISMATCH.md; implementation in supabase/functions/bible-mcp/discovery-v2-tools.ts, word-model.ts, research-engine.ts, chain-store.ts.

**Critical architecture boundary:** the MCP is designed for AI and can return large/slow hydrated responses (archived cold 6–14 seconds for large ranges; 2–3.5 warm). Its shape is a **semantic model**, not necessarily the browser's efficient hover network protocol. Use existing bounded BibleRPC reader/Cloudflare endpoints for instant verse/word previews. Add only minimal batched public read-only projection endpoints if truly missing, through the existing API layer. Do not expose MCP chain capability secrets or server/service credentials to an unauthenticated browser. Browser path history can be local; reuse the MCP chain server only with a proven secure authenticated contract.

## 2. Data reliability without disrupting the user experience

Use source-backed original forms, word identities, glosses, and historical/lexical attributions. Keep lemma, root, alternative senses and similar spelling clearly distinguished, and label uncertain source links instead of inventing certainty. This is a general interface requirement; backend data-repair work is owned by its separate agent.

Geography and chronology show their model names, passage relation, alternative candidates and uncertainty. An inferred ancient location or one chronological model must not appear as an established historical fact.

## 3. Single exploration state and reusable evidence contract

Build **one central DiscoveryWorkspace** coordinating existing modules. Avoid a second traversal engine or duplicative discovery computations.

Suggested typed adapter model (final types can differ, semantics must not):

- **Anchor:** {kind: occurrence|lemma|sense|verse|passage|event|concept|place|external, canonicalKey, edition?, book/chapter/verse/position?, word_id?, label, original?, transliteration?, gloss?}. Source-specific keys and ambiguous alternatives remain explicit.
- **Witness:** {reference/range, edition, completeEnglishText? [lazy], orderedOriginalTokens? [lazy], matchedOccurrenceIDs?, passageRole, source, evidenceID?, alignmentStatus}.
- **ConnectionEdge:** {stable ID, from/to anchors, relation type, direct/indirect, epistemic class, human-readable why, support witnesses, step list, source/provenance, limitations, rank score as non-probabilistic metadata, release}.
- **ExplorationBranch:** {id, parent branch/step, anchor, selected edge, path, expansion/filter/pagination state, scroll/selection state, pins, release}. Client-side state is authoritative for browser journeys.
- **PinnedPassage:** {canonical reference, edition, selected occurrence/phrase, active connection/branch, explicit comparison slot}. Hold 2 by default, optionally up to 3.
- **ResearchHypothesis:** user-owned note/edge with status **hypothesis**, not automatically promoted to verified corpus evidence.

Normalize legacy R8/R9B grammatical/lexical/contextual/LXX, R10/R11 passages and R12 path/structural/orthographic/physical sources to this common UI format, while preserving epistemic distinctions and original evidence IDs. **Do not flatten contextual co-occurrence into lexical kinship, letter overlap into etymology, editorial cross-reference into quotation, or a multihop edge into a proven endpoint claim.**

The same anchor/edge should render consistently as a compact result card, hover preview, graph node/edge, breadcrumb step and comparison annotation. A missing witness is explicit; do not create unsupported proof or synthetic verse text.

## 4. Main screen hierarchy (build function first, not beauty)

Desktop >=1200 px: **one fixed/sticky compact research-trail header across the top**, below or merged with the app navigation; dominant Scripture reader + available discovery/evidence area. On 900–1199 px keep the same horizontal header but use one main reading column and a contextual inspector drawer. On phone the trail becomes a single horizontally scrollable breadcrumb rail with back/fork actions; open graph/evidence only when needed. **No collapsible left-side research-trail window.** Use space freed by the trail for actual verses and comparison.

On first load show active full English verse + original/transliteration, one approachable query field (verse/word/concept), a compact **What connects to this?** set (3–6 varied results), and an explicit **Compare** control. No hero, MCP tool names or nine technical tabs between reader and evidence. Leave maps and chronology as optional expandable lanes associated with the verse.

**Readable scaffold:**

FIXED TOP RESEARCH HEADER (single compact rail): Back/Fork | Genesis 2:7 › adam › adamah [branches] | Compare | Graph | Note. Merge with existing navigation where possible; auto-condense labels on scroll and horizontally scroll deep trails without wrapping into several rows.

READER: Genesis 2:7 (WEB full text)
Original tokens in reading order: original form / readable transliteration / observed English gloss / **1–3 short alternative meanings (and short root when supported) visible without clicking**.
Tap word → inspector; hover word → further lemma/root/occurrence context.

NEXT: 5 relationship cards [why + real short evidence excerpt + evidence type]
[More] [Find a bridge] [Surprise me]

INSPECTOR: selected node/edge; full cited verses; highlighted original words; what links them; limits
[Pin A] [Pin B] [Compare] [Follow] [Challenge]

GRAPH: optional expandable local network, uses same state and evidence

A **discovery** always has an evidence-centric textual rendering even if graph view is closed.

## 5. Instant preview interaction contract

### 5.1 Word hover / keyboard focus

Hovering a token in the original text, its transliteration, an English rendering when mapped, a result card, or a graph word node shows a compact nonblocking preview after ~180–250 ms dwell (cached preview immediate after dwell; uncached loading state within ~100 ms). No navigation or persistent selection change on hover.

Preview contains:
- readable English heading **man / human**; *adam*; אָדָם; source/reference and exact occurrence when available;
- **Here:** occurrence-specific observed English rendering;
- **Elsewhere:** up to 2–3 distinct sourced renderings/meanings with small witness refs (not all possible senses asserted for this occurrence);
- short decoded grammar (e.g. noun, masculine, singular) and ambiguous-sense notice where applicable;
- one high-value connection/occurrence with an actual verse excerpt if cached; technical Strong's in secondary detail.

Click/Enter opens the persistent **Word Inspector** at the selected passage/word position, retaining the reader. **Meaning choices and a concise root are already visible directly in each word's interlinear reader cell, without hover or click;** the inspector adds documented derivation chains, precise sourced examples, more senses, LXX and related passages, not repetitive copies of the inline summary. Do not perform full get_Word/MCP hydration on every pointer move. Group by proper extended lemma/sense when attested; show disambiguation instead of choosing a homograph automatically.

### 5.2 Verse reference hover / keyboard focus

Any biblical reference **anywhere** (discovery result, graph edge, note, xref, word occurrence, map/timeline, nested evidence, compare pane) uses one reusable reference component and **ContextPreview**.

- Within hover/focus show reference, complete actual WEB verse, translation label and connection-relevant highlighted phrase/word only where alignment is verified.
- Range references: immediate first relevant *full verse*, visible range label and **Expand range** action to view all verses. Never substitute a partial excerpt for a full-verse preview while claiming it is complete.
- Interactions: hover must be persistent/dismissible; no accidental navigation; Escape; focus parity; reposition away from viewport edges; no nested tooltip chains.
- Click/tap opens an accessible nonmodal detail panel with explicit **Read**, **Pin/Compare**, **Inspect relation** actions. Touch never depends on hover.
- Long verses remain readable with scroll/expanded view. Unknown text shows **English verse unavailable for this edition**, not generated substitute.
- Use bounded in-flight-deduped requests keyed by edition+reference, stale-response guard, small LRU cache and optional prefetch for 3–6 visible references. Never fetch entire chapters for each hover.

### 5.3 Event/place/edge hover

Graph edge: **why these are connected**, type, weakest epistemic class, first real witness and limits; click opens full evidence. Place: identity/role/confidence with map action; date: competing model/scope. Never display uncertain location or model as settled fact.

## 6. Comparison should be a first-class research workspace (P0/P1)

Extend **PassageComparison.ts**, don't replace it with an unrelated page.

- **Pin A** and **Pin B** explicit controls on any verse/edge; comparison opens both concurrently (not navigational toggle). Support an optional **C** column/passage later.
- Each pane shows canonical reference, complete WEB text, complete original verse in proper RTL/LTR, **per-token transliteration and English gloss** plus selected contextual word/phrase. A plain concatenated original-language string is insufficient.
- Highlight verified matching original words by linked evidence IDs/occurrence positions. Separately mark tentative conceptual similarities; do not auto-highlight identical English strings as original-language matches.
- **Aligned comparison modes:** Word/translation, Grammar/action–participant, Repeated images/theme, LXX Hebrew/Greek, Narrative sequence, Contrast/difference. Switch lane without removing pinned texts. Unavailable lanes say why.
- A comparison summary answers **What actually repeats? What differs? Which bridge is direct, which is proposed?** Include concrete witness locations rather than generic AI exposition. User can tag a pattern manually.
- Allow selecting any token in pane A to preview/focus its counterpart(s) in B when supported, and to inspect the evidence that supports the proposed alignment. Else show **no verified correspondence**; do not fabricate a 1:1 translation alignment.
- Add **Compare words in context**: source occurrence and another occurrence of same lemma/sense, showing both verse texts; display differing renderings separately from different underlying senses.
- Add **Passage set compare** for a small group (up to 3 initially): display shared evidence categories / unique elements, with a per-passage verse list and passage pinning. Full passages with pagination; don't explode to all 40 verses in DOM at once.
- A copyable comparison citation/route and **Back to source** preserve the original selection, pins, scroll, trail and filters.
- Responsive: two columns when room; two stacked cards with sticky A/B selectors on phones, both fully retrievable without replacing one with the other.

Existing data pathways: BibleRPC.getReaderPassage + getVerseWords/getReaderOverview; get_Connection and research(passage_compare, intersect_words, grammar_search, lxx) demonstrate available server analysis but are **not** required on every compare click. Enrich on demand.

## 7. Graph traversal as the map, not the only UI

Implement a small **graph neighborhood** centered on selected anchor, initially 5–9 diverse high-signal neighbors. Provide the *same ranked connections in a keyboard-accessible textual list*. No physics simulation or thousands of rendered nodes; use an SVG or simple lightweight graph first.

Interaction:
- Click node → shift focus and show word/passage summary + evidence; **Expand** adds next bounded neighborhood and does not replace trail.
- Click edge → open evidence inspector showing full supporting verse(s) and individually attested steps.
- **Follow** creates a step in a branching trail; **Branch from here**, **Back**, **Forward**, **Revisit**, **Return to origin** retain source reader and exact token position.
- **Find a bridge:** select A and B (words/verses/concepts); use bounded existing get_Connection or graph path APIs; return multiple distinct routes with precise edge evidence. If no verified route, show **No supported path found at current coverage** plus explicitly exploratory leads.
- **Alternative routes:** deduplicate mirrored/same-evidence paths; compare route length, provenance and meaning rather than numeric scores alone.
- **Surprise me:** show unexpected, source-grounded, diverse next steps. Slider can adjust familiarity vs surprisingness; epistemic threshold never changes silently. Distinguish discovery based on precomputed pilot vs general corpus coverage.
- Layer toggles: word/etymology, grammar, contextual co-occurrence, Hebrew–LXX–Greek, xrefs/direct quotes, narratives/events, motifs/structural patterns, physical-world bridges, and user hypotheses. Default 3–5 relevant diverse groups; advanced filters behind controls.
- Source node typed roles matter. Do not merge *eye* and *spring* just because they share a Strong's ID; ambiguous meanings require an explicit branch/candidate choice.
- A path is a series of evidenced steps, **not proof that first and last nodes have the same meaning**. Show an overall endpoint classification derived from evidence, not automatically from constituent edges.

Persist a lightweight session tree locally and optionally save/bookmark via the existing notes/auth flow. The AI MCP 24-hour private follow_connectionchain is a useful interaction model but **must not be exposed as public browser persistence**. If server chain is integrated, require proper per-user authentication and capability isolation; do not grant extra permissions.

## 8. Human-visible pattern discovery beyond the ranker

Create a **Pattern Board** where users pin 2–3 verses/words and inspect observable features side by side without needing a model to propose a theological explanation.

Feature lanes (each sourced and bounded):
- shared actual words, common lemma versus similar spelling;
- grammatical actions, agent/object/recipient and negation;
- occurrences in near context, independent textual witnesses;
- narrative motifs, event participants, order, place/time (distinguish narrative time from composition);
- quantities *bound to their nouns* (e.g. three days, seven lamps), not random number co-occurrence;
- imagery/objects/material properties; external data explicitly modern;
- Hebrew–Greek translation parallels and variants (LXX correspondence/edition caveats);
- contrasting features and **why this may not be the same pattern**.

Let users manually select or add a pattern feature and label an edge **my hypothesis** with a note. Offer **Find supporting verses** and **Challenge** via research(occurrences/intersect_words/grammar_search/passage_compare/lxx) only when requested. Show genuine source snippets; no claim that a discovered literary resemblance is historical authorial intent. Integrate existing NotesPanel/NoteEditor; do not silently write notes or make global annotations.

Pattern Board should support examples:
- Genesis 2:7 ↔ Genesis 3:19 ↔ 1 Corinthians 15:45–49 (Adam/ground/dust/life with lexical/cross-language caveats);
- Genesis 6:14 ↔ Exodus 2:3 (tevah/ark and covering/pitch; assess distinct words/contexts);
- Zechariah 4 ↔ Revelation 11:4 (two olive trees and lampstands; source-specific link);
- Genesis 1 ↔ Exodus 12–14 ↔ Revelation 21–22 (comparative observations, not forced typology).

## 9. Research capability menu — progressive disclosure

Default simple verbs: **Read**, **Explore**, **Compare**, **Find bridge**, **Follow path**, **Save insight**. Move technical research console and nine prompt tabs behind **Advanced research** without deleting their functionality.

Offer context actions:
- Word: usages, sense variants, forms, transliteration, LXX equivalents, grammatical neighbors, related words, documented roots vs spelling candidates, real-world bridge and optional gematria with method.
- Passage: full read, nearby context, xrefs, event/map, chronology model, grammatical scene, compare, multiple-word intersection.
- Edge: full evidence, competing paths, provenance, challenge or add note.
- Selected set: overlap/intersection, differences, events, lexeme/grammar compare.

Numbers/gematria should never be prominent as if they imply theological significance; they are exploratory calculators with recorded method and sample scope.

## 10. Source integrity, identity, epistemology, and security

- Preserve precise verse identity including Psalm headings verse 0, MT/LXX shifts and source editions. No synthetic verse references or misplaced morphology.
- Word positions are occurrence-specific; never infer lemma/sense identity from a single base Strong's or an English gloss.
- Use WEB with clear source and licensing for English text; STEP/MACULA/Swete retain their own provenance. Do not label STEP morpheme interlinear glosses as WEB translation.
- English–original token highlights require a verified alignment. In absence, show accurate full English and the corresponding original word separately. Never fake precise WEB token spans.
- Clarify direct biblical text, textual cross-reference/editorial association, lexical bridge, grammatical attestation, semantic interpretation, typological proposal, orthographic possibility, external world-property relation, and user hypothesis.
- Historical events and chronology: show exact relation to passage, alternative dating models and uncertainty. Inferred or speculative places remain visibly inferred, not pinpointed as proven coordinates.
- Distinguish loading, no result, source coverage gap, model ambiguity, stale release, request error, and permission failure.
- Keep note permissions unchanged. Authorship, review status and DLM claims remain separate from corpus facts.
- No destructive SQL, paid services, unlicensed source imports, security-control changes, or pushing private data into public assets.

## 11. Implementation boundaries, sequencing and agent ownership

**Do not start with an aesthetic redesign.** Reuse and refactor existing functional components; avoid adding competing apps.

Suggested files and ownership (verify against local branch):
- **P0 A — hover/reader:** ContextPreview.ts, VerseReader.ts, WordRenderingRange.ts; small shared word-preview component if needed. Own preview request lifecycle and keyboard/touch behavior.
- **P0 B — compare:** PassageComparison.ts plus small shared verse-token rendering subcomponent; owns dual-pane state and accurate text rendering.
- **P0 C — integration/state:** src/main.ts, ui/state.ts, a new exploration state/adapter module, relevant styles-workspace/mobile; **orchestrator owns these shared files**.
- **P1 D — evidence/graph:** DiscoverConnections.ts, ExploreConnectionsPanel.ts, relationships-rpc/r10-rpc adapter only when necessary; one unified graph/trail UX, preserve existing algorithms.
- **P1 E — Pattern Board:** a small new component reusing comparison and graph evidence; notes integration with explicit save.
- **P2 F — optional map/timeline/technical research:** EventTimeline, VerseMap, ResearchPanel; do not block P0 on styling/polish.

If another agent is implementing algorithms/MCP, use a separate Git worktree and feature branch. UI agent **does not edit** backend traversal/ranking, shared MCP schemas, corpus build scripts, or TASKS.md; Neon owns integration and TASKS.md. Integrate on the latest verified algorithm release and adapt only the client adapter. Do not deploy two branches to the same shared Workers/MCP simultaneously.

MCP source contracts are reference data, not permission to expose server-only functions on an unauthenticated website. Keep the existing browser access model intact. Favor the existing BibleRPC methods and a small typed adapter mapping them into Anchor/ConnectionEdge/Witness.

Build and test in thin working vertical slices:
1. Accurate full verse display + reusable hover/focus word and reference preview.
2. Expand and inspect one connection without leaving Scripture; stabilize shared selection/anchor identity.
3. Side-by-side comparison with transliteration/gloss and reliable back/pinning.
4. Graph neighborhood + branching trail + bridge search.
5. Pattern Board + notes hypothesis/save + refined layer navigation.

Every slice must remain usable before moving to the next.

## 12. Performance and accessibility gates

No full MCP calls or 40-verse hydrations on hover. Target cached hover visible within ~100 ms after dwell and network loading indicator within ~100 ms; measure real cold/warm p50/p95 separately rather than inventing compliance. Use request deduplication, bounded concurrency, cancel/ignore stale responses, finite cache keyed by reference+edition+release, lazy inspector and graph hydration, optional prefetch for a few visible citations. A slow graph search must not delay Scripture.

Avoid new heavy graph dependencies and continuous-motion layouts. Support keyboard, screen readers, Escape, dismissible persistent preview, stable focus, nonmodal interaction when feasible, font scaling, true Hebrew RTL and Greek LTR, 200% text, 320/360/390/430/768/1280/1440px layouts, 44px touch targets, reduced motion and no horizontal overflow. Compare on mobile stacks both passages; no disappearing source pane.

**No raw HTML insertion of untrusted text/evidence without escaping.** Prefer textContent/DOM builders for lexical/scriptural content.

## 13. Exact acceptance journeys and checks

Extend scripts/verify-ux-refresh.mjs (and add small focused tests where needed). Test actual local browser/Playwright, not screenshots alone. Core acceptance:

1. **Gen 2:7:** load full WEB and original text. Hover original *adam* → English, transliteration, script, contextual gloss without selecting. Click *adam* → inspector, follow documented *adamah* wordplay, read Genesis 3:19 on hover; pin and compare both verses, return to same token/scroll.
2. **Zech 4 ↔ Rev 11:4:** compare complete passages side by side; show meaningful source-attested olive-tree/lampstand links, visible inline word meanings and relevant original-language spellings/transliterations.
3. **Gen 6:14 ↔ Exod 2:3:** show WEB English for both, shared H8392 *tevah* with source evidence, do not equate other coverings automatically. Graph and list provide equivalent traversal.
4. **2 Pet 1:19:** compare Greek *lamp* G3088 and *light-bearer* G5459 in their actual verse; no generic words overwhelm the precise source witness.
5. **John 1:1:** repeated G3056 tokens keep distinct occurrence positions; RTL/LTR correct; hover/focus previews never change active occurrence.
6. **Ruach:** render documented wind/spirit/breath and potentially direction-side as **different witnessed uses**, not a forced contextual sense; full-verse rendering-group preview; list pagination and uncertain homograph choices.
7. **Psalm 3:** full superscription/context link to 2 Samuel 15 as a historical-association source, not an exact composition year. Psalm 45:0 heading present; ambiguous dates/places appropriately named.
8. **Graph:** 6 neighbors expandable, click node/edge, inspect verse, branch, return to origin and back without losing pins. Failed/no-path/coverage states explicit.
9. **Pattern Board:** pin A/B, compare shared and distinct features, manually add hypothesis, note only saved on explicit click. Show no implied certainty from mere English word similarity.
10. **Mobile/accessibility:** 320/390px, keyboard only, focus/hover/tap parity, Escape, scroll/no overflow, two passages simultaneously accessible, no nested dialogs.
11. **Performance:** measure cached vs uncached previews, number of network requests from 20 rapid hovers, graph expansion; assert no repeated large MCP query per hover and no stale-response UI corruption.
12. **Regressions:** earlier scripts/verify-ux-refresh.mjs journeys, existing notes/reading preferences, map focus, full chronology alternatives, technical research tabs preserved.

A completed UX is **not** accepted if the first page looks attractive but a user cannot inspect an exact verse, understand a related word in English, or follow and return along a path.

## 14. Release and handoff

Neon should coordinate low-cost subagents by non-overlapping file ownership, integrate, run npm type check/build and focused Playwright test(s), deploy the website only after backend algorithm/MCP integration compatibility is confirmed, and verify *live* reader/preview/compare/graph journeys. Follow AGENTS.md direct-live policy but preserve rollback and do not overwrite another active deployment.

Update TASKS.md only through orchestrator; preserve its authority and old task history. In the UX handoff record: implementation commits, route/adapter changes, exact relevant MCP/Worker releases, P0 word-alignment status, screenshot/browser evidence, measured preview performance, limitations, and independently testable paths. Do not claim visual or data correctness if not tested.

**Summary:** Every reference is readable, every important word is understandable, every edge is explainable, every comparison keeps both texts visible, and every path remains navigable. The user is the investigator; the graph and AI supply a map, not an unquestionable interpretation.


---

# 2026-11-21 Expansion: Rabbit-Hole Discovery, Continuous Scripture, Structural Patterns and Context Tools

**This expansion is implementation-authoritative over previous phase ordering. The first usable milestone is the reversible RELATIONSHIP EXPLORER, with enough actual Scripture to inspect its evidence.** Full-verse/chapter mode is implemented inside that same milestone. Person trees, calendars, visual media and advanced chiasm mining come afterward through extensible tool slots. The system must become useful before it becomes visually elaborate.

## 15. Concrete user journeys, not just feature lists

### Journey A — follow a rabbit hole and reverse a dead end

1. Open Genesis 2:7, choose the exact occurrence of *adam*; reader and inspector share the same selection.
2. Inspector immediately shows the English identity, original + transliteration, observed sense, three strongest **different** connections, and top meaningful occurrences. Full witness verses are one tap away.
3. Click **adamah**: create branch edge (adam → adamah), show its words highlighted in Genesis 2:7 and its source explanation, then reveal 5–9 new options (ground, dust, tilling, Genesis 3:19, etc.).
4. Click a passage, expand to the entire chapter, notice another word, follow it; all of this extends or branches the *same* trail.
5. If a branch has weak connections, use **Back to fork**, **Try another route**, **Compare with origin** or **Challenge**. No forced return to home; no reset of reading position.
6. Revisit any trail step; compare the currently selected verse with an earlier pinned verse. Evidence used at each step remains inspectable even if the live algorithm is updated (record evidence ID/release).
7. Save a human observation as a user hypothesis, not as a source-proven relationship.

### Journey B — Jerusalem: word + etymology + place + narratives

Open Jerusalem (Hebrew H3389; preserve lemma/homograph variants). First screen:

- **Jerusalem · Yerushalayim · יְרוּשָׁלִַם**; plain-English "city/place name"; source-era variants.
- **Name & wordplay:** an *etymology possibilities* block, not an asserted decomposition **Jeru=city + Salem=peace**. Historical Urusalim/Yerushalem proposals include "foundation of Shalem"; traditional "city of peace" / shalom association is a meaningful later interpretation but not settled linguistic derivation. Label each source and competing reading. The link to Salem and Melchizedek (Genesis 14:18; Psalm 76:2; Hebrews 7:1–2) is a **biblical place/text association**, not proof that modern "Jeru" is the Hebrew noun for city.
- **Best witnesses:** Jerusalem/Sion/Salem passages grouped by distinct meaningful connections, with full-verse previews.
- **See it:** popup modern map centered on a *verified* place candidate; optional pinned historical images/maps with date of depiction, date of map creation, maker and rights. A 1486 Jerusalem illustration is a historical *image*, not a Bronze/Iron Age surveyed plan.
- **Follow:** Salem → Melchizedek → king/priest → Hebrews 7; user can return to Jerusalem and follow another path.

A location/name etymology may be surprising without being historically certain. Each claim retains a type (historical etymology proposal / literary association / visual illustration / textual relation).

### Journey C — Menorah: word + object + spatial and textual graph

Open H4501. First screen shows *menorah* (מְנוֹרָה, lampstand), observed gloss, verified lexical relatives, Exodus 25:31–40 passage, and top useful connections: gold (material), branches (parts), lamps (part distinction), Zechariah 4, Greek λυχνία and Revelation 11:4. Show 5–6 diverse sources, **not** 15 repetitions of "grammatical possessive connection."

"See object" opens an appropriately licensed menorah photograph or explicitly labeled reconstruction diagram, not an unlabeled object claimed to be Moses' own lampstand. "Where placed?" shows a **schematic** tabernacle/Temple plan; highlight only source-attested room or object position, link Exodus 26/40 and 1 Kings 7 as applicable, distinguish structures and periods. Click two olive trees → Zechariah 4 ↔ Revelation 11. An edge click shows both real verses concurrently and their Hebrew/Greek relevant original words.

### Journey D — Pesach: feast within a calendar, context and textual sequence

Click a feast mention. Show Hebrew form/transliteration/translation, Exodus 12 and Leviticus 23 links, an expandable **Appointed Times** calendar, and side-by-side biblical vs later Jewish observance.

For the familiar "seven feasts" study framework, state the counting convention; Leviticus 23 also includes the weekly Sabbath and an eighth-day assembly. Keep Passover (14 Nisan) and Unleavened Bread (15–21 Nisan) separate. Firstfruits and Weeks/Shavuot have interpretation-dependent counting details. Do not imply a single undisputed calendrical reading.

Use a **modern fixed Hebrew-calendar** calculator for chosen year/location (19-year leap cycle; month lengths; Rosh Hashanah postponements as implemented by a pinned audited library), show Israel/Diaspora options and sunset day boundary. Do **not** project its exact modern Gregorian dates into Exodus. Add a separate *historical/biblical observance model* with uncertainty: Nisan/Abib, moon/harvest observation and divergent interpretive rules. Explain the arithmetic/rules for each result, and separate dates from interpretations. From Pesach follow blood → doorposts → Exodus 12 → Exodus 14 with narrative chronology as **sequence**, not an automatic assertion of a specified feast-day crossing.

### Journey E — People and places from Scripture

Click a **disambiguated person** in the verse → compact profile with identity, family graph (parents, spouses, children, siblings with evidence), role and narrative appearances. Click a family edge → open the verse proving that relation; traverse up/down lineage, retain separate same-name individuals. Person ↔ place ↔ event links reuse the central graph.

Click a **verified place** → small anchored map popup with exact passage relation (setting, mention, recipient, travel, inferred location), modern/ancient alternatives and uncertainty; actions "Open full map", "Compare locations", "Related events". For east gate references, never map every "eastern gate" to the modern Golden Gate without period/structure/text evidence.

Click "Table of Nations" → **Genesis 10** genealogical dispersal graph (Genesis 12 is Abram's calling, not the Table of Nations); shade proposed identifications and migration routes as scholarly candidates, not precise historical coordinates.

### Journey F — see a poetic/structural pattern

In a verse or expanded chapter, identical **verified lemma instances** share a stable readable highlight. Toggle **Structure**: subject, predicate/action, object, temporal phrases, negation, repetition and syntactic links appear as separate line/shape annotations. Adjacent clauses visually group. An optional **Compare pattern** view aligns units between two passages, with explanatory connectors. Later a **Possible chiasm** overlay can label A / B / C / B′ / A′, show exact matched pairs/contrasts, independent witness text and the reason it is only a candidate.

## 16. The highest-priority interaction: a persistent and reversible discovery engine

Implement a **local exploration tree** plus a selected branch, NOT a single back/forward array and NOT a server-only expiring chain. UI state:

- selectedAnchor: canonical kind + ID + edition + exact occurrence (book, chapter, verse, position, verified word_id) when relevant.
- nodes: {nodeId, anchor, originStepId?, normalized readable label, status/coverage}.
- edges: {edgeId, sourceNodeId, targetNodeId, relation, evidenceId, sourceRelease, epistemicClass, witnesses, why, limitations, edgeStatus}.
- steps: {stepId, parentStepId|null, currentNodeId, traversedEdgeId|null, childStepIds[], createdAt, branchLabel?, selectionSnapshot}.
- viewState per step: {readerMode: verse|context|chapter, centeredVerse, scrollAnchor, selectedWordPosition, inspectorTab, graphViewport, activeLayers, resultCursor, pins, comparisonMode}.
- userHypotheses: {id, from/to, human note, status:user_hypothesis, linkedWitnessIds[], saved?}. Store saved notes via authenticated existing notes path only.
- source/version and source-coordinate normalization: preserve canonical identity, preserve distinct lemma/sense/occurrence, source edition, original bibliography, verified vs uncertain mapping.

Events: START, FOCUS_ANCHOR, PREVIEW (does not change state), FOLLOW_EDGE, EXPAND_NEIGHBORHOOD (does not necessarily follow), BRANCH, RETURN_TO_STEP, FORWARD_TO_CHILD, PIN_PASSAGE, UNPIN, SWITCH_READER_MODE, COMPARE, SET_LAYERS, ADD_HYPOTHESIS. Each event creates or updates a known state snapshot; **Back** restores exact prior selection, scroll and pins, not merely the reference.

Navigation architecture:
1. A text breadcrumb **origin > branch > current** always visible. Fork indicator displays other child branches with short readable labels.
2. **Return to fork** jumps to nearest ancestor with >=2 outgoing explored branches; **Return to origin** jumps to root; browser Back/Forward for navigations must remain correct.
3. Graph expansion computes suggestions but does not move the anchor until user intentionally **Follow**s a node/edge.
4. Dedupe visited edges by canonical source/target/relation/evidence ID; allow looped exploration but display "visited on branch X" and offer **Revisit** rather than infinitely recursing.
5. Persist session-local branch tree (bounded, e.g. 150–300 steps) with safe serialized snapshot; optionally export user-owned JSON/share link devoid of secrets. On release mismatch preserve historical label/evidence ID but refetch claims; show stale/changed witness instead of silently rewriting a trail.
6. **Undo** affects exploration state only; never deletes a note or modifies the corpus.
7. A graph edge is **documented only as far as its source evidence supports**. Never upgrade endpoint certainty because intermediate steps are each documented.

Use existing R10/R12 discovery/explain/challenge/expand APIs, R9B multi-hop relationship layers and MCP get_Connection as semantic references. Browser interaction must reuse BibleRPC bounded read-only calls and local path state; do not send private MCP follow_connectionchain capability tokens to unauthenticated clients.

### First-screen discovery toolbelt

Only five high-value controls visible initially: **Explore**, **Follow**, **Compare**, **Find bridge**, **Back / Fork**. Contextual actions from the selected node/edge: Occurrences, Word family, Similar spelling, Original language, Grammar, LXX, Map, Family, Calendar, Images, Structure, Challenge, Notes. **Show only tools supported by the selected entity and available sources.**

Use a typed tool registry: tool {id, acceptsAnchorKinds, requiredDataCaps, lazyComponent, loadAdapter, previewLabel, evidencePolicy}; surface when (entity.kind intersects accepted) AND (required sources available or explicit "not yet indexed"). Do not make giant inspector tabs with empty placeholders; tool registry is extensible without changing the central state machine.

### Discovery result selection (presentation, not a new theology ranker)

Take the bounded existing ranked results. Group by independent relationship mechanism and distinct endpoint/witness family. Prefer one representative per group in initial 5–9 cards, with direct endpoint textual witness, documented wordplay, useful cross-testament link, narrative/event link and selected exploratory candidate if supplied. Suppress identical-edge duplicates in preview; let "More of this type" expand them. Never remove contradictory/negative evidence or convert a source rank to theological probability. Example: for H4501 show cross-language image, Exodus material/form, Zechariah/Revelation rather than a whole top-five list of grammatical dependencies.

If current engine cannot prove a connection, **expose the valid underlying observations** and label them independently; do not fabricate a path. User can manually bridge them as a hypothesis. "No route found" offers Expand scope / Inspect separate passages / Create hypothesis / Return to fork.

## 17. Reading must flow verse → context → chapter → verse without a reset

Extend the **same reader component** with modes: **Verse**, **Context** (e.g. 2 before + 2 after, bounded at chapter edges), **Chapter**, and **Compare**. Every embedded verse in references, witnesses, comparisons, notes and path steps must have **Expand to chapter**; opening a chapter keeps the selected verse centered/highlighted and the inspector/trail intact.

Data algorithm:
1. Resolve canonical book+chapter+verse including Psalm heading verse 0; keep edition and MT/LXX alternative identity separate.
2. Fetch adjacent verses/chapter through existing per-verse BibleRPC reader methods for tiny context or a **bounded chapter/range read projection** if already supported; the MCP get_Passage(passage=chapter, limit<=40, offset) proves data exists but its 100KB+ results are not suitable as a hover transport. Add one read-only paginated browser projection only if needed, using existing corpus gateway and static assets.
3. Return {reference, canonicalVerseId, WEB text, original ordered token references, verse-status/source, nextOffset} per verse; metadata by ID/reference separate or lazy. Do not join unverified Macula token numbers to STEP word IDs.
4. Chapter view uses verse blocks, each with complete WEB, verse number, hoverable references/words and a compact "interlinear" row. The complete original-script + transliteration + contextual English rendering must be available for **every token**; use a global **Show all interlinear** toggle with windowed/lazy rendering so long chapters remain fast. Verse mode displays all token triads by default.
5. Maintain one scroll **anchor ID** on every mode switch. On Chapter → Verse, keep selected verse; on Verse → Chapter restore chapter scroll offset and current token focus. Chapter "Next/Previous verse" navigates within the chapter without closing chapter view.
6. Load chapter pages incrementally, e.g. 10–20 verses per batch; render one viewport plus overscan, but preserve anchor and keyboard navigation. Do not retrieve all detailed word relationships for each token.
7. Link *verse number* hover → full verse preview even inside chapter; click → focus verse; expand icon → context/chapter; all actions preserve discovery trail and compare pins.

**Translation layering:** actual WEB sentence is a distinct English layer; interlinear "Here" gloss is derived from STEP/source occurrence (NOT misrepresented as WEB translation); optional "Elsewhere" meanings are explicitly labeled lexical alternatives rather than claims about the token in this verse. Show original form + readable transliteration + source occurrence gloss for each verified word. A word with no verified lexical alignment can show source-verified form and separate English verse, with "precise mapping unavailable."

## 18. Word Inspector replacement: meaning-first, no duplication

Existing WordInspector, WordFormation, LexicalRelationshipsSection and other views repeat raw counts, Strong's references, giant grammar codes and similar results. Build one reusable **Word Focus** header plus concise contextual lanes; move long details behind actions.

**Above the fold (desktop/phone)**:
1. Identity: main English gloss/short definition + transliteration + original script + lemma source; exact instance (where in verse) and alternate candidate selector. Strong's hidden behind "Technical details".
2. Meaning *here*: documented occurrence rendering; alternative dictionary senses in separate labeled chips with 1 real verse per sense, where available. Do not choose a polysemous meaning solely from Strong's.
3. Word origin: source-documented derivation/formations/roots; **separate** consonantal/spelling similarity and literary wordplay. Display candidate chains graphically with source and explicit degree of certainty.
4. "Explore the most revealing connections": initial 4–6 **diverse** cards, with reason + entire source verse on hover, rather than raw scores/IDs. Available types include related word, passage, concept, historical entity, a visual tool and potential interesting hypothesis.
5. "Most revealing occurrences": 3–5 real cited verses ranked for *helpfulness of context*, with "All occurrences", "Canonical order", "By meaning", "By book" and pagination.

**Do not automatically copy all etymological suggestions into an asserted family.** Source etymology, proposed segmentation of proper names, co-occurrence, phonetic/similar-spelling candidate, homograph, direct textual pun and later reception are separate lanes. The opening word Jerusalem example requires exactly this distinction.

### Transparent occurrence ordering algorithm

Work from an existing bounded occurrence set (verified canonical token+lemma and sense); never claim exhaustive rank when only a truncated sample was fetched. Use non-theological **exploration value** indicators, not "confidence in meaning":

- textDirect = 1 if this verse explicitly defines/names/explains the word or participates in an attested wordplay/direct quotation;
- identityFit = 1 if exact lemma/sense and edition match;
- rareContext = IDF-weighted rarity of neighbors within sentence/verse, stopping function words;
- distinctSense = 1 if example illustrates a separately witnessed alternate meaning versus already selected examples;
- distinctiveRole = 1 if grammar/syntax scene is structurally unusual and attested;
- newBookOrGenre = 1 if diversifies source contexts;
- witnessStrength = independently sourced direct/explicit support rather than editorial votes alone;
- penalty = near-duplicate text/parallel edition, unverified join, or same-verse repeated token displayed again without reason.

Proposed *presentation heuristic*, to validate against 10–20 manually inspected examples:
  relevance = 4*textDirect + 3*identityFit + 2*distinctSense + 2*distinctiveRole + 2*witnessStrength + rareContext - 3*penalty.
  Select first result; rerank remaining with maximal marginal relevance, approximate novelty = 0.65*relevance - 0.35*similarityToAlreadyShown (similarity from shared passage, source, lemma neighbors/role). Guarantee one representative of an available documented contrasting sense and another book before filling with same-context entries. **Weights are initial tunable UI defaults, not asserted validated ranks.**

Alternative ordering "First occurrence" and "All canonical order" remain direct and deterministic; user may never be trapped in the heuristic. Every card shows full verse on hover and clear "Why shown" reason.

### Etymology / spelling algorithms

Documented roots/formation: traverse *directional pinned source records*, preserve relationship type and exact extended lemma ID, no synonymy inference. Etymology segmentation for compound names requires a **curated etymological analysis with references**; no automatic splitting on English string "Jeru" or "salem". Similar spelling: normalize Unicode by removing accent/cantillation, optional Hebrew vowel points; compare consonantal sequences via bounded Levenshtein/Jaro score (with script-specific normalization) **only as candidates**; homographs separated by lemma/sense; allow letter-by-letter display and contextual passages. Underline which characters match and how many words were searched. Do not auto-derive theological meaning from similarity. If source etymology missing, label "Historical derivation not established here."

## 19. Deterministic structural highlights and readable color architecture

**Do not just color every occurrence randomly.** Use two orthogonal visual channels:

**Channel A — lexical repetition (background + label):**
1. For each rendered verse/chapter/compare set, identify all verified token occurrences by exact lemma key + optionally sense key. Fall back to strongs+edition only with scope warning; never merge person/place homonyms.
2. Exclude configurable stopword/function-word list from default highlighting (articles, prepositions, conjunctions); allow show all.
3. Count distinct verse occurrences (>=2 to highlight). Build groups with deterministic key = lemmaKey + source edition; within the *current comparison set*, sort by first appearance and assign 8–10 accessible hues from palette. Keep same group color across current compare panes. Use striped/dotted underlays and a readable badge/underline when groups exceed palette capacity. Contrast-check WCAG.
4. Hover one group: brighten all verified occurrences in current chapter/compared panes and show **X uses in Y verses**; click filters its appearances and opens lexical inspector. No nested color bleeding into unrelated senses.
5. Across Hebrew ↔ Greek, share colors ONLY when an explicit attested LXX/translation relation links a pair within the selected source scope; otherwise use separate shades and a dashed candidate connector.

**Channel B — structural role (stroke/icon/connector, NOT the same background fill):**
- Verified grammatical subject = top dotted outline / "agent" label.
- Predicate/action = solid underline / "action" tag.
- Direct object/patient = double underline / "object" tag.
- Number-with-noun = bracket spanning both; time/sequence = side rail; negation = bar or explicit "not"; parallel clauses = matching left-edge markers.
- Each role comes from MACULA/bibleontology/R8 attested clause and head/dependency frames, not heuristics solely on English word order.
- Group clauses with a subtle border and label **subject → action → object** when actual relation is known. On hovering action, link subject/object with readable connectors, not opaque color alone.

Color and pattern cannot themselves certify interpretation. Provide toggle **Repetitions / Grammar / Both / Off**, accessible legend, keyboard highlight and "Explain this highlight". Overlap of multiple roles uses combined text labels and distinct stroke patterns, never an unreadable blend.

**Performance algorithm:** indexed token rendering by verse, precompute lemma group map on fetched page, update CSS classes via keyed DOM (O(tokens+groups)), not pairwise token comparisons (O(n²)). Only calculate visible chapter blocks; cache per edition/release. Palette assignment anchored to current passage+comparison set and stable across back/forward snapshots.

## 20. Precise comparison tool — two verses, chapters or passage ranges

Extend PassageComparison, default **Pin A** and **Pin B**. Each can reference a word occurrence, verse, passage range, or whole chapter. Switch scope independently (single verse → ±2 context → chapter) without dismissing the other. Show both full WEB source texts simultaneously; separate original script, transliteration and gloss as accessible interlinear rows, plus selected sense alternatives in inspector.

**Interaction algorithm:**

1. Pin A from current reader. Pin B from any reference hover/evidence/graph edge; compare immediately, scroll both top to matched verses.
2. Query each passage range using bounded reader projection, respecting edition/source and verse 0; include token-level exact IDs only if verified. Fetch expensive syntax/LXX overlays when selected.
3. Compute candidate token correspondence:
   - **same Hebrew/Greek edition**: exact verified extended lemma match weight 5; documented shared root weight 2 (not synonymy); identical surface alone weight <=1 and labeled similar form; grammatical role match adds 1 only to structural lane.
   - **Hebrew ↔ Greek**: source-attested LXX crosswalk of compatible passage/edition/lemma weight 4, otherwise *no lexical alignment*. Cross-book Greek same-lemma matches allowed if exact IDs match. English-only similar words are suggestions, not token correspondence.
   - documented direct quotation/allusion or exact verse cross-reference adds evidence to the *passage relation*, not automatic word identity.
4. Create sparse weighted bipartite matches between actual token positions (repeated lemma tokens stay distinct); choose stable maximum-weight matching or sequence DP when ordered alignment matters, with gap penalties and permission for one-to-many **only where source morphology/crosswalk says so**. Expose alternate ambiguous candidates; don't force all tokens to align.
5. Show corresponding colors on independently sourced links. Hover word in pane A highlights linked B tokens and scrolls a small focus cue; evidence inspector shows matching criterion/source. Unmatched words remain neutral.
6. For chapter comparisons, align at **verse/clause/scene blocks**, not full word-by-word cross-product. Candidate block similarity = 0.40 verified lexical IDF Jaccard + 0.25 roles/actions + 0.20 supported xref/event + 0.15 imagery/quantity with source-backed scope. These are prototype UI suggestion weights, not an epistemic quality score; downweight generic motifs and show what each signal matched. Use top-N sparse candidate windows and monotonic local sequence alignment with gaps; don't force story sequences into identical order.
7. Render overview header "Same / Different / Not established" plus clickable links to every matched source verse. Comparison notes/hypotheses authored by user.
8. **Synchronize on explicit request**, not every scroll. "Align matching passages" locks corresponding verse blocks; "Free scroll" preserves independent positions. On mobile stack both panes with sticky A/B anchors and mini matched-position navigator; neither pane replaces the other.
9. Add **Replace A**, **Replace B**, **Swap**, **Add C (optional)**, **Save comparison**, **Return to origin** actions. Changing B never drops A or the main trail.
10. Show methodological controls: "Lexical exact", "Grammar", "Cross-language attested", "Imagery candidate", "Differences", with clear source coverage badges.

**Default test:** Zechariah 4:2 vs Revelation 11:4 shows actual verses, menôrâ / λυχνία connection only with valid LXX bridge, olive-tree relation and qualifying witness. Genesis 2:7 vs Genesis 3:19 highlights repeated *adam*/*adamah* as separate but related lemmas; identical English "ground" is not sufficient. The two texts remain simultaneously visible during word inspection.

## 21. Optional structural/chiasm suggestion engine (later, never a blocking milestone)

Start from the **Macula Hebrew/Greek clause and morphology assets already in corpus**, R8 grammatical roles and editorial xrefs; compare algorithms offline or on bounded selected ranges.

**Candidate detection**:
1. Segment passage into 2–12 candidate units: clauses, poetic cola or verse blocks; respect quotations/speech and syntax boundaries where present. If line segmentation absent, label approximate segmentation and permit user adjustment.
2. Extract independent features per unit: rare exact lemmas (IDF weighted), documented roots, actor/action/object role pairs, negation, numbers tied to nouns, explicit names/events, shared rare image fields. Exclude stop words, high-degree themes and repeated features from the same witness family.
3. Pair similarity between units i,j = 0.45 lexical rarity overlap + 0.25 source-verified grammatical/role parallel + 0.20 supported image/event link + 0.10 contrast/parallel marker. Do not use a free-form LLM assertion as direct evidence; these are configurable heuristic weights.
4. Candidate A–B–B′–A′: for k>=2 mirrored pairs, compute mean(pairSimilarity(i, n-1-i)), subtract mean(adjacent/forward matching) as a symmetry preference, subtract degree/hub/duplication penalties and a gap penalty; identify optional center C.
5. Compare mirror score to a **within-passage shuffled-block or degree/length-matched baseline** (e.g. 100 seeded permutations at offline build) and require a materially higher score plus >=2 independent feature families. Avoid unstable claimed p-values for tiny samples; report empirical rank/null percentile as exploratory only. Enforce a small minimum witness count and cap findings per passage.
6. Render A / B / [C] / B′ / A′ bands around the actual full verses, each mirrored pair using identical pattern/line style and linked evidence; clicking a pair shows detailed source words and why it was grouped. Provide **Not a confirmed chiasm** label, alternatives and controls.
7. Allow manually resegmented user hypothesis overlays; save only as notes. Validate on source-backed examples and intentionally repetitive prose; do not label every lexical repetition a chiasm.

**Resources to audit, not blindly import:** Clear-Bible/macula-hebrew and macula-greek syntax; existing BibleOntology-derived R8 clause roles; ETCBC BHSA/Text-Fabric for independent structural features where compatible; NuBerea/hebrew-poetry for proposed parallelism/chiasmus annotations **after rigorous provenance, methodology, rights and edition matching review**. No new large corpus import necessary for first prototype.

## 22. Extensible context tools: places, people, feasts, objects, images

One **ContextToolRegistry** with capabilities rather than one-off screens. A provider must declare anchor types, source dependencies, evidence fields, version/rights and available assets; it renders in a nonblocking popover/drawer plus a "Follow as graph node" action where supported.

### Place and map

**Detection:** prefer canonical place IDs bound to original-word occurrence or sourced verse/place tags; string matching alone gives *unverified candidate*. Resolve mention, setting, composition/audience independently. If ambiguous (multiple Bethlehems/Jerusalems), chooser with alternatives.

**Popup:** miniature existing MapLibre map centered only when coordinates/evidence are stable, uncertainty ring when warranted; source and current/ancient place names; period selector where supported; "View historical image". Same place in different eras can have different walls/gates; no modern gate retroprojection. Use existing VerseMap/MapLibre and Theographic/OpenBible geography rather than new map backend.

### People / family tree

**Detection:** canonical person entity, verse-scoped names and homonym chooser. Existing Theographic event/people context should be audited for true family edges. Data sources to evaluate before any import: Theographic Bible metadata (CC BY-SA 4.0), BibleData PersonRelationship (CC BY 4.0), Wikidata (CC0, often sparse/unsourced); verify each upstream license, source statement and identity crosswalk.

**Algorithm:** typed edges father/mother/spouse/child/sibling/etc, each directional and citing a supporting verse or reviewed source. For a selected person traverse a bounded BFS (first 1–2 generations, max 15–25 nodes), group spouses/parents/children, collapse repeated people but not homonymous persons; optionally expand. Mark competing genealogies and unresolved identities rather than merging. Clicking a relation reads the supporting verse in ContextPreview; tracing person -> event -> place returns to same discovery trail.

### Feasts and calendrical calculation

**Detection:** sourced feast/concept ID from original token/verse, never English word substring alone. Card shows name, source verses, observance activities, Torah rule and later practice separately.

**Calendar algorithms:** a pinned and license-approved @hebcal/core (or @hebcal/hdate) implementation produces modern fixed Hebrew dates. At minimum show Hebrew year, leap/ordinary year, Nisan/Tishrei index, Nisan 14 (Passover), Nisan 15–21 (Unleavened Bread), counting options for Omer/Firstfruits/Weeks, Tishrei 1 (Teruah/Trumpets), Tishrei 10 (Yom Kippur), Tishrei 15–21 (Sukkot) and Tishrei 22 (assembly). Explain calculation: Hebrew 19-year cycle with 7 leap years, variable months and postponement rules as the chosen library implements; conversion uses the selected proleptic civil calendar. Where sunset is relevant, civil-day display spans evening to evening; accurate local sunset needs location/timezone and separate vetted calculation. Biblical observational/new-moon/harvest reconstructions remain a distinct **uncertain historical model**; rabbinic fixed calendar is not asserted for ancient Exodus dates. Show Israel/Diaspora tradition settings and different ways "seven feasts" are grouped.

### Object/media/temple diagrams

**Detection:** verified object/concept (menorah, altar, ark, curtain, eastern gate). **Contextual action:** "See object / plan" loads a vetted, small **curated media manifest** (no arbitrary image-search hotlink in UI): {object/entity ID, title, depictsPeriod, creationDate, sourceURL, thumbnailURL, creator, licenseID/licenseURL, licenseAttribution, depictionType=photograph|artifact|reconstruction|historic illustration, confidence, matchScope, annotation polygons, sourceRefs}. Wikimedia Commons API/media information can seed review, but imported files must pass per-asset license review. Source asset URL and period metadata are mandatory.

**Menorah diagram:** image + overlay polygon for lampstand position, linked to Exodus 25/37, Zech 4, Temple vessels with distinct eras. **Tabernacle/temple plan:** choose textual depiction/reconstruction model; outline room/object position only with explicit textual/archaeological source and disputed models available. Do not call a modern drawing an excavated plan.

**Historical map:** use licensed OpenBible.info coordinates, existing MapLibre, optional pinned public-domain/CC artwork. Always label *map created in year X*, *purported depicted era Y*, *reconstructed vs original survey* separately. Medieval maps are evidence of medieval interpretation, not evidence of first-temple streets. Golden/East Gate similarly requires period and identification.

**Table of Nations:** from Genesis 10, graph derived from direct father/son name relationships + cited textual units; migration/location proposals remain separately source-labeled conjectures. Use bounded tree and optional schematic map; never assign coordinates merely from similarity of ancient ethnonyms to modern places.

## 23. Concrete engineering milestones and acceptance gates

### P0 — relationship exploration and trustworthy reading (build FIRST)

**Deliver:** shared exploration state/adapter; typed edges and evidence previews; branch/fork/return/back; initial local graph + list; consistent verse full English preview; reader verse/context/chapter transitions; readable word triads and hover; slim Word Focus; a 2-pane comparison with both English and per-word original/transliteration/gloss.

**Acceptance:** Genesis 2:7 → adamah → Gen 3:19 → full chapter → branch to dust → return to earlier fork restores exact reader/selection/pins; all relevant references show full text and all mapped words have correct identity. No heavy context panel/large MCP on hover.

### P1 — deepen the discovery graph and structural comparison

**Deliver:** Find bridge/alternatives/Challenge, relationship-layer tools, occurrence ranking+canonical toggle, exact lemma repetition colors, structural role overlays from existing syntax, verified cross-pane links, Comparison A/B modes, controlled 3-pane/Pattern Board when feasible.

**Acceptance:** 2 Pet 1:19 direct lamp/light-bearer witness; Zech 4↔Rev 11:4 comparisons and distinct LXX vs editorial evidence; Menorah word focus shows useful diverse links without duplicated grammar clutter. A/B highlights explain criteria and do not create Hebrew-Greek identity from English spelling. Back/forward on 390px.

### P2 — contextual providers and human hypotheses

**Deliver:** verified source-aware place popup, family tool (if verified entity family edges exist), feast calendar with explicit modern/historical calculation modes, curated object image/temple maps, save hypothesis/pins; meaningful Hebrew name etymology versus tradition/homograph choices.

**Acceptance:** Jerusalem proposed name origins clearly distinguished, Salem/Melchizedek path, modern/historic image provenance, place confidence visible; person family relation links cite verses; Pesach dates explain calculation; Exodus 25 Menorah artifact image is appropriately labeled.

### P3 — deeper literary pattern assistance

**Deliver:** structural candidate matching/chiasm overlays, optional independent datasets after license/sanity audit, user-configurable pattern segments and controls.

**Acceptance:** show actual A/B/B′/A′ textual features, a mirror-match score vs a baseline and clear "candidate" status; low-quality controls do not become confirmed chiasms.

### Implementation handoff boundaries

Existing src/main.ts orchestrates components. Keep BibleRPC as the browser gateway, Cloudflare static shards/read projections for immutable evidence, Supabase for dynamic/authenticated notes and no new paid storage or free-tier-breaking asset explosion. Reuse DiscoverConnections.ts/R10, ExploreConnectionsPanel.ts/R9B, ContextPreview.ts, WordInspector.ts, PassageComparison.ts, VerseReader.ts, WordFormation.ts, VerseMap.ts/EventTimeline/Notes. Implement a small adapter layer + exploration-state module + registry rather than multiplying screens and backend engines.

Assign non-overlapping subagents to: (A) exploration state/graph (lead reviews shared interface), (B) reader chapter/word hover, (C) Word Focus information architecture, (D) A/B comparison/colors, (E) contextual provider prototypes, (F) focused Playwright tests. The orchestrator owns shared src/main.ts, API contract changes, TASKS.md and final integration. Do not simultaneously deploy algorithm/MCP and frontend from competing worktrees. Preserve current changes, release pins and rollback.

### Tests before marking any milestone complete

- Extend scripts/verify-ux-refresh.mjs using actual browser. Desktop 1280/1440 and mobile 320/360/390/430, keyboard focus, 200% zoom, touch, Hebrew RTL/Greek LTR, no overflow.
- **Graph navigation:** 10+ steps including branching, back-to-fork, revisits, stale result, no-path, ambiguous identity; exact source verse selection and pins restored.
- **Reader:** switch verse↔context↔chapter for long 40+ verse chapters and Psalm verse 0; do not lose selected token or main trail; chapter pagination/virtualization keyboard and screen reader safe.
- **Hover:** 20 rapid hovers request deduped/limited, no full hydrated MCP call; full verse available; word gloss/transliteration verified and distinguish alternative senses.
- **Compare:** A/B (verse and chapter), pin and swap, source word linked to B only with valid evidence, actual full English+original+transliteration+gloss, preserve independent scroll on mobile; differences visible.
- **Colors:** exact lemma repeated two/three times within verse and across chapter; stopword suppression, collisions >10 groups, no conflation of homographs or unverified LXX links, grammar stroke layering not color collision.
- **Context tool:** Genesis 10 table-of-nations vs Genesis 12 call, uncertain eastern gate, Jerusalem etymology claim status, modern calendar rule choices, source attribution and no image without licensing.
- **Regressions:** notes security, translation-choice writes, existing map/timeline, legacy research tools, search and external deep links; no new silent data simulation.
- **Performance:** measure cold/warm hover and neighborhood expansion actual timings and bytes; no claim of passing targets until measured; no production destructive operations or paid services.

### Candidate resource shortlist (audit licenses before incorporation)

- MACULA Hebrew/Greek syntax: https://github.com/Clear-Bible/macula-hebrew and https://github.com/Clear-Bible/macula-greek
- ETCBC BHSA/Text-Fabric annotations: https://github.com/ETCBC/bhsa
- NuBerea Hebrew poetry/chiasm candidate dataset (quality/rights must be verified): https://huggingface.co/datasets/NuBerea/hebrew-poetry
- Theographic people/places/events/family (CC BY-SA 4.0; license implications): https://github.com/robertrouse/theographic-bible-metadata
- BibleData PersonRelationship (CC BY 4.0, audit exact version/provenance): https://github.com/BradyStephenson/bible-data
- OpenBible.info geography overlays and licensed atlas datasets: https://www.openbible.info/geo/
- Modern Hebrew calendar: https://hebcal.github.io/api/core/ (check @hebcal/core code license), https://www.hebcal.com/api-docs/ (API content CC BY 4.0)
- Wikimedia Commons source-licensed imagery/media API and attribution guidance: https://commons.wikimedia.org/wiki/Commons:Machine-readable_data and https://attribution.wikimedia.org/attribution-signals/license.html
- Historical Jerusalem-name etymology must retain alternatives: https://www.jewishencyclopedia.com/articles/8604-jerusalem

**Do not import a source simply because it appears here.** Verify version, license, quality and mapping to existing corpus; prefer already-present data and pre-curated small assets.

**North star:** Users can descend into a chain of evidence, visually notice repetitions and structures, compare texts without losing either, view place/person/object/feast context only when relevant, and return to any prior fork with their research intact.


## 24. Refinement: visible meanings, fixed trail, drag-and-drop and intelligent use of space

**This section supersedes earlier layout wording. It applies to the FIRST discovery milestone, not a future phase.** The reader should be informative **before any hover or click**, while the graph trail remains continually available and advanced features stay unobtrusive.

### 24.1 Reader: show meaning ranges without any interaction

Keep the existing source-driven *Here / Elsewhere* concept but make it more informative and compact. Render each word as a responsive **meaning tile** in textual reading order. Default tile:

- **Original script** (Hebrew/Greek; correctly directed) at the top.
- **Transliteration** directly under it, readable for someone who cannot read the script.
- **Here: short English rendering** prominently.
- **Also:** 1–3 *different attested English renderings or compact lexical senses* in smaller but readable text, e.g. **ruach — spirit · wind · breath**. Do not repeat identical variants or include a giant lexicon in each tile.
- **Root:** a single short, meaningful source-documented root/derivation label when available (e.g. "root: …") with a clickable/hoverable path to its actual evidence; hide this row entirely if no supported root rather than writing "unknown" everywhere.

**This is not merely a tooltip. The reader presents these directly and permanently, including without a selected word.** Avoid turning every word into a 12-line mini-dictionary. Suggested responsive display-density algorithm:

1. Fetch word tiles from existing VerseReader/ReaderOverview source records, rendering groups and small shared lemma profiles *once per distinct lemma*. Use existing GET reader/gateway and a small batched dictionary cache; **no full get_Word/MCP for each word**.
2. Normalize observed rendering variants, removing duplicate orthographic/punctuation differences but preserving meaning differences. Rank by occurrence frequency when available; take first 2–3 **distinct** renderings; explicitly label as lexical alternatives unless sense-specific evidence warrants stronger wording. Preserve homographs as separate possibilities.
3. If documented root is short (e.g. one root label, not a formation tree), show it inline; otherwise present a compact clickable **Origin** cue and load detailed root family on focus/selection.
4. Long-word/rare-word tiles get a maximum inline height and expand text within the same tile on user request. Do not truncate original spellings, lose transliteration or silently delete alternatives. The WEB English verse stays the easiest text to read.
5. Three reader density modes: **Rich (default)** shows original / transliteration / Here / Also / root; **Compact** shows original / transliteration / Here + a small alternatives cue; **English** displays WEB with selected-word overlay. Persist preference, apply consistently to verse/chapter/compare. Rich is the default precisely because alternative meanings encourage discovery *without clicking*.
6. On hover/focus, add lemma, pronunciation/source, detailed root/formation, contextual grammar and relevant examples; click opens Word Focus. Hover must not be required to access the inline meanings.
7. Even in chapter mode, each verse has immediately readable WEB; Rich triads appear on expanded verses or in a viewport-bounded interlinear stream. An explicit **Show Rich for chapter** option may progressively render the entire chapter with virtualization, no huge data fetch.

**Space:** use CSS grid/flex with natural RTL Hebrew token order and LTR transliteration/gloss, minimum sensible token widths, wrap into clean rows without changing language order; cap decorative whitespace and per-tile labels. Favor content density over oversized cards, but honor 200% zoom and touch sizes. No hidden automatic horizontally-scrolling Bible text just to fit more columns.

### 24.2 Fixed research-trail top header, not a left accordion

Replace the proposed left trail panel with a **single always-visible top header** for research navigation. The header holds:

**[Back] [Fork]  Genesis 2:7 › adam › adamah › dust  [branch count]  [Compare] [Graph] [New note]**

Use position:sticky at top:0 or genuinely fixed with compensating page offset (depending on existing header); do not stack two bulky fixed toolbars. Target one-line height roughly 44–56 px desktop, with optional 1-line overflow menu. On deep trails, horizontally scroll only the breadcrumb region, keep Back/Fork/actions reachable; collapsing older steps into "…3 earlier" is preferable to forcing line wraps. Tooltip on truncated crumb shows full readable label and path.

Click a breadcrumb restores its exact saved reader mode/scroll/selected token/graph selection. Fork menu shows visited child branches with destination and last relevant verse, not raw UUIDs. Trail updates when following relationships or intentionally navigating, not on hover.

Mobile header: fixed compact **Back | current > previous branch | Fork | Compare** with optional overflow **Graph / Note**. It must not cover the WEB verse, on-screen keyboard or the comparison tabs. Dedicated graph view remains accessible, but **the trail is never parked in a left drawer**.

### 24.3 Drag and drop for comparison, evidence and notes

**Intent:** a word/verse/connection can be dragged toward a screen edge to start comparing, pinning or linking without requiring menu hunting. A mouse-only HTML5 drag handler is insufficient for phones.

- Add small drag handles on verse headers, occurrence labels, word tiles (only on deliberate drag gesture) and discovery cards. An object dragged carries a typed **AnchorPayload** (anchor kind, canonical IDs/reference, selected occurrence/edition, source provenance; **no private tokens**). Do not serialize raw HTML or data from untrusted source.
- Start drag after pointer displacement >=6–8 CSS px for mouse/pen, or deliberate 300–400 ms press with ~10px movement tolerance for touch; normal scrolling and text-selection are **never captured** as drags. Cancel by Escape, pointercancel, scroll, visibility change, or leaving app.
- While dragging, show temporary edge drop zones: **right edge = Compare B**, **left edge = Compare A**, optional **bottom shelf = Pin evidence**. First dragged item can auto-populate A and then B, but always show the result and permit Swap. If comparison is already open, show clear A/B panes as drop targets. Hover zone for ~250 ms shows a preview: "Compare Genesis 3:19 with Genesis 2:7".
- Valid drops: verse/passage → Compare A/B; word occurrence → Compare current word's verse plus selected token (not nonsense word-only verse); connection edge → pin its source/target witnesses; person/place → graph pin, with relevant tool actions. Invalid drop zones announce reason and leave state unchanged.
- On drop: call the **same compare/pin/follow commands** used by keyboard and button interactions, preserving source selection, trail and scroll. Add a brief reversible "Pinned as B · Undo" notification.
- Keyboard/touch parity: every draggable item has accessible **Pin to A**, **Pin to B**, **Compare with current**, **Save note** menu actions; edge drag is progressive enhancement. Support touch scrolling and screen readers. No drop gesture should silently create a research claim or save a note.
- Implementation: one pointer-event controller with setPointerCapture, central DragState and drop-zone registry integrated into the exploration state; visual ghost in lightweight overlay; hit-test using event clientX/Y and getBoundingClientRect; requestAnimationFrame only while dragging, no continuous graph animation. CSS must prevent accidental text selection only during a confirmed drag. Tests cover long-press vs scroll, Escape, invalid drop, keyboard path and compare replacement.

### 24.4 Quick notes and manual connections in context

**A note should feel like part of reading**, not a journey to an advanced editor.

- A subtle **+ Note** control appears next to selected word/verse, reference preview, graph edge and selected highlighted passage. A quiet margin marker appears for existing notes; default reader remains uncluttered.
- Click **+ Note** opens a small inline composer or anchored drawer with **exact target prefilled** (occurrence vs lemma vs verse vs passage vs graph edge, and source reference), optional selected text, and one content field. Save/Cancel visible. If user is not authenticated under current rules, show the current sign-in/permission path; no bypass.
- **Connect to…** from a word/verse/pinned item allows choosing another existing anchor by search, graph selection or drag-and-drop. Creates a **my hypothesis** edge with two endpoints, short explanation, optional supporting verses, and explicit uncertainty; no promotion into indexed corpus until separately reviewed.
- Save by one explicit click/keyboard shortcut and show an unobtrusive "Saved" state; undo/cancel applies to draft as permitted. Preserve existing notes ownership/review logic. Closing draft warns on unsaved changes, not every keystroke; autosave private drafts only if existing permission model permits.
- Display note marks on the relevant reader token/verse and graph edge; selecting mark opens note next to the evidence. Avoid attaching a note to an entire Strong's group when the user selected one occurrence; selection scope visible and changeable before save.
- Technical notes/research DLM provenance remains in More Details; simple prose-first note creation comes first.

### 24.5 Intelligent information and screen-space hierarchy

**High-value, above-the-fold information:** actual English Scripture, original script, transliteration, contextual gloss, alternative meanings, documented root/etymology, high-value related words/passages with *real verse evidence*, top insightful occurrences, and context tools when entity appropriate (map, image, family, feast). **Secondary information:** Strong's number, raw database IDs, morphology codes, exhaustive grammatical counts, every redundant co-occurrence, raw scoring features, gematria and technical provenance tables. Secondary is searchable/discoverable via **More / Technical details** but should not dominate.

Do not hide **critical uncertainty or citations** just to shorten cards; present source/epistemic type unobtrusively adjacent to the claim, with full source on demand.

Layout rules:
1. **Main reading surface gets ~60–70% desktop width** when a contextual inspector is open; inspector gets ~30–40% and may be closed. When comparison opens it becomes the dominant wide content area (two balanced panes), inspector becomes overlay/drawer rather than a third squeezed column.
2. **Never duplicate the selected word's entire profile** in reader tile, inspector and graph. The reader shows 1-line meanings; inspector shows richer explanation and evidence; graph shows destination/relation. Reuse a common data model, render only appropriate depth.
3. Show **4–6 useful connection cards** before "More", grouped across different evidence mechanisms. Word Focus defaults to meaning/origin/insightful occurrences, not enormous co-occurrence listings.
4. Inline place/icon/image affordance only where supported. Side tools stay one click away, not permanently consuming width with empty boxes.
5. Long chapters use full-width WEB paragraph reading with optionally expanded interlinear rows. Maps and large genealogical/calendar/media visuals open an anchored popover or overlay that can be dismissed without losing location.
6. Save space with progressive disclosure, not font shrinkage; ensure visible text >= comfortable reading size, Hebrew niqqud/Greek diacritics legible, keyboard focus clear, 200% zoom and mobile reflow.

### 24.6 Updated acceptance tests

Extend focused Playwright checks with the following mandatory assertions:
- Without hover/click, Gen 1:2 **ruach** displays original script, transliteration, **spirit / wind / breath** as sourced alternative uses in the reader, plus supported root cue if available; no invented single contextual meaning. A regular verse's other words also show original/transliteration/English gloss.
- With multiple words visible, no giant unreadable per-word boxes; Rich and Compact density controls work without changing passage, and Rich persists when switching verse ↔ chapter and back.
- After 8+ discovery hops, **the research trail stays at top**, is readable/scrollable, Back/Fork works and selected Scripture isn't covered. No left-side trail accordion.
- Drag Gen 3:19 reference toward right screen edge → comparison pane B opens beside pinned Gen 2:7 pane A with both full English texts; source verse and research trail unchanged. Keyboard menu produces identical result. On mobile, 350 ms long press works without hijacking ordinary scrolling.
- Drag a word occurrence to comparison → correct verse/token focus in destination; invalid object drop doesn't mutate state; Escape cancels; undo restores previous pin.
- Select a specific word occurrence → + Note → one-field composer targeted to that occurrence; change scope to whole lemma; save only with authorized explicit action; note marker appears in reader/graph. Create a manual A→B hypothesis and keep it distinct from source-proven edges.
- Word Focus shows etymology, root, top interesting occurrences and connections immediately; raw Strong's/morphology/gematria only under details, and no repeated lengthy summaries.
- At widths 320/390/768/1280/1440 with 200% zoom, fixed header and compare do not overlap readable Scripture, map/other tools do not steal space, and there is no horizontal overflow.

**Use these as implementation guidance and regression tests, not as permission to change corpus data or research rankings.** Source evidence still governs every word claim and connection.
