# BibleResearch UX Strategy — Evidence-First Discovery Explorer

**Revised:** 2026-11-21. **Status:** implementation specification, superseding the 2026-11-05 UX refresh proposal where they differ. **Branch inspected:** feat/r12-qa-fixes. **Authority:** AGENTS.md and local workspace remain authoritative for implementation; TASKS.md is the only task queue.

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

## 2. CRITICAL correctness gate — verified token identity (P0)

**2026-11-21 live reproduction:** get_Passage Zechariah 4:2 still pairs the surface מְנוֹרַת֩ (menorah/lampstand, H4501) with word_id 59034 and transliteration za.Hav (gold), although canonical STEP identifies the lampstand as word_id **91302**. Similarly gold receives ku.Lah (all-of-it) and lamp(s) receives 'a.Lei.ha (upon-it). The 2026-11-20 audit traced the bug to src-independent Cloudflare normalizeTokenList joining Macula local word_no to STEP canonical positional indexes. This is a data-contract bug, not a cosmetic issue.

**UX rule:** never attach transliteration, lemma key, grammar, precise English alignment, or evidence badges to a token until canonical occurrence and source edition identity have been verified. Do not assume identical Macula/STEP ordinal positions. In case of uncertainty render the safely sourced original English and token form separately and mark enriched alignment **unverified/unavailable**, rather than display a false word gloss. Preserve distinctions: word occurrence vs lexeme/lemma vs sense vs surface form; edition and Psalm verse 0.

**Owner boundary:** UX implementer must not independently rewrite the algorithm or corpus crosswalk while Neon fixes it; add UI guards and regression fixtures, and integrate the corrected release when available. At minimum test Zech 4:2 against canonical STEP positions and controls Gen 1:1, Ezek 1:3, 1 Cor 12:10, Psalm headings and shifted Hebrew verses. Do not claim full original-language parity until corrected in live data.

For geography and chronology, display model name, scope (setting / mention / audience / composition), confidence, evidence and alternatives. For example, an inferred Eden site or a 4004 BC model must never look like an established coordinates/date fact. External OEWN/Wikidata bridges remain modern exploratory concepts, not biblical proof.

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

Desktop >=1200 px: left collapsible **Trail & Connections**, center dominant **Scripture Reader**, right **Evidence/Word Inspector**. On standard 900–1199 px use reader plus inspector with trail as drawer. On phone (320–430 px), default to **Read → Evidence → Next Connections**, with sticky compact path bar and graph in optional full-screen sheet. Do not put three tiny columns on a phone.

On first load show active full English verse + original/transliteration, one approachable query field (verse/word/concept), a compact **What connects to this?** set (3–6 varied results), and an explicit **Compare** control. No hero, MCP tool names or nine technical tabs between reader and evidence. Leave maps and chronology as optional expandable lanes associated with the verse.

**Readable scaffold:**

TOP: Search / passage selector | Back | Compare | Graph | Saved trails

TRAIL: Genesis 2:7 > adam > adamah  [branch indicator]

READER: Genesis 2:7 (WEB full text)
Original tokens in reading order: form / readable transliteration / contextual gloss
Tap word → inspector; hover word → quick meaning

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

Click/Enter opens the persistent **Word Inspector** at the selected passage/word position, retaining the reader. More meanings, occurrences with full-verse preview, senses, LXX, roots, context/grammatical relations and data provenance live here, not in the hover tooltip. Do not perform full get_Word/MCP hydration on every pointer move. Group by proper extended lemma/sense when attested; show disambiguation instead of choosing a homograph automatically.

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
2. **Zech 4:2 P0:** correct original token ↔ transliteration/word_id; do not render *menorat* as za.Hav. If corrected backend not yet available, evidence enrichment is marked unverified and no incorrect precise pairing appears. Compare Zech 4 with Revelation 11:4; full English in both panes, original + romanized words, inspect two-olive-tree direct/editorial links.
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
