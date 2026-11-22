# BibleResearch — UX Strategy
## Bible-first, evidence-first, user-guided discovery

**Approved interaction direction:** 2026-11-22, based on two rounds of direct user decisions.  
**Applies to:** the existing Vite/vanilla TypeScript BibleResearch website and its current Cloudflare, Supabase, corpus, notes and relationship services.  
**Authority:** user-approved UX decisions in this document; AGENTS.md for engineering/safety; TASKS.md for task tracking; actual local workspace for implementation.  
**Scope:** rewrite of the earlier accumulated UX draft, replacing contradictory proposals and obsolete alternative layouts. The design continues iteratively with the user in the running local website.

**Product principle:** The user should see what a Hebrew/Greek word means, what relationships and patterns connect it to the rest of Scripture, and how the source text actually supports them — **at first glance**, without being buried in technical details. The system discovers and presents observable relationships; the **user** investigates their significance. There is **no AI-generated theological interpretation** in the primary research UI.

---

## 1. Final decisions: the intended experience

1. **Bible first.** Open into the last/current passage, not a discovery homepage. Search and passage selectors sit above the reader, below the research trail.
2. **Large fixed research trail at the top.** It is always accessible with Back, Fork, Graph and Compare controls; never a collapsible left history window. A long path condenses to the current steps with history/forks one action away.
3. **Scripture dominates the first screen.** Main reading content occupies the available width, with a context-sensitive right inspector appearing only after something is selected. Each scrolls independently.
4. **Interlinear dominates verse view.** Complete WEB English verse is present above it in smaller, readable type. Each original-language word flows in sequence with original script on top, transliteration, contextual English gloss and 2–3 distinct attested meanings beneath. No root or spelling relatives occupy the verse reader.
5. **Hebrew token-flow direction is selectable.** The word tiles default to **left-to-right order on screen** for accessibility to users who read Western scripts, with an option for traditional right-to-left order. **Hebrew characters within each word always preserve correct right-to-left direction, spelling, diacritics and underlying canonical token order**. Switching presentation direction never reverses letters or changes identifiers.
6. **Chapter mode is continuous English Scripture only**, with source-grounded highlights and word/reference hover tools. Selecting a verse opens rich interlinear verse view. Switching verse ↔ chapter restores selection and scroll.
7. **Click a word → open its inspector**; it remains in view while Scripture is visible. Hover provides a lightweight lemma/root/usage preview. Click another word → inspector changes focus and the research trail records navigation.
8. **Compact Word Focus, not an encyclopedic wall.** First glance: word form, transliteration, English, lemma original/transliterated, different meanings, documented etymological root with transliteration/English, 3–4 spelling relatives, high-value occurrences and an expandable word connection graph. Long/technical data lives behind explicit expansion.
9. **Relevant media on top of the inspector.** If available, a small slideshow of maps, images, models or schematics precedes the lexical/entity information; each slide expands into a larger popup. If no useful sourced media exists, the section disappears.
10. **Below Scripture, scroll into the current verse/passage research area.** A large relationship graph and tools live here. A compact equivalent graph lives in the inspector for words; a Graph action in the fixed trail can enlarge either view. It is the **same graph state**, not different engines.
11. **Graph-first connections, up to 20 visible nodes at a time.** Group subtly by typed relationship colors. Important connections are closer/larger; zooming out progressively reveals lower-ranked connections. Mouse hover previews; clicking a **node** changes the research focus, while clicking an **edge** inspects why the link matters and its actual biblical witnesses.
12. **No AI explanatory claims.** The algorithm identifies relationships, original-language forms, semantic/grammatical co-occurrence, source alignment and candidate patterns. Explain the *mechanism and evidence* of an edge; do not narrate an unsupported spiritual/theological interpretation. Speculative and user-proposed edges remain visibly distinct.
13. **Comparison is a primary workspace.** Two full verses or chapters appear simultaneously in the main area with **independent scrolling**, shared colors for verified matching words and highlighting in both panes on hover. The inspector stays available. A separate graph can show verse-to-verse and wider-corpus connections.
14. **Repetition + structure visible by default.** Same verified lemma occurrences receive consistent accessible colors; source-attested structural roles are also annotated by a different visual channel. Controls let the reader simplify them when needed.
15. **Context tools appear when relevant.** A place opens a mini map, person a genealogy, feast an appointed-times calendar, object a photograph/model/reconstruction, etc., through the same inspector with expand-to-detail. Do not crowd every passage with irrelevant options.
16. **Quick personal notes and hypotheses** from a word, verse, phrase or graph edge. The target and scope are prefilled, save is explicit, and personal edges carry a visibly different status.
17. **One branching exploration session** with reversible history, not bookmarks or multiple simultaneous trails for now. The user can go deep and return to any previous fork without losing their reader, graph or comparison context.

These are user-selected design requirements, **not** optional visual guesses or references to old mockups. When implementation raises a new consequential layout choice, build a small working option in localhost and ask the user before locking it in.

---

## 2. Screen anatomy and behavior

### 2.1 Desktop, initial Bible reading

**Top fixed rail:** BibleResearch | Back / Fork | readable research breadcrumb | Graph | Compare | + Note. Target ~52–64 px high, with accessible 44px click targets. Compact, legible, not a stacked collection of sticky bars. On deep paths, older breadcrumb steps collapse into a dropdown; the current 2–5 steps remain visible. The trail is a navigation tool and persists when scrolling between reading and research.

**Second row, flowing with page:** unified search (reference / word / concept), book / chapter / verse selectors, mode switch Verse / Chapter, simple reading preferences (Hebrew LTR/RTL token layout, optional highlight toggles). It need not remain fixed if that would steal reading area.

**Main content, before a word is selected:** Scripture spans almost all available width. No unused inspector box. Verse mode shows small complete English prose on top and dominant interlinear word flow below; chapter mode shows continuous English.

**After selection:** open a right inspector of approximately 32–38% width, independently scrollable, leaving Scripture ~62–68%. Reader scroll and selection stay unchanged. Inspector can be closed, resized within sensible bounds, or expanded if its graph/media demands room. No duplicate inspector panel beside the chapter research area.

**Below Scripture:** full-width passage research workspace. It begins with the graph and a small set of tools relevant to the currently focused passage. The user reaches it by ordinary vertical scrolling; an Explore/Graph action scrolls or opens it without losing the source verse. Tool navigation changes the active research surface; avoid stacking seven full, redundant panels one below another.

**Inspector and research area coordination:** word selection presents the compact word graph in the inspector. Verse focus presents a large verse graph in the lower research area. Expanding a graph opens a larger overlay/workspace while preserving its selected node, filters, zoom and exploration trail. Closing expansion returns to the original reader/inspector without reconstructing graph state.

### 2.2 Responsive behavior

- **≥1200px:** wide reader + auto-open right inspector; passage research below with optional inspector still visible.
- **~768–1199px:** main reader with a narrower slide-over inspector, or a resizable lower panel if column width becomes insufficient; do not make interlinear tiles tiny.
- **~320–767px:** single-column reader, compact fixed top trail, inspector in a bottom/full-screen sheet with its **own scroll position**; graph enlarged in a sheet when requested. Chapter reader remains continuous English. Compare shows A and B as two persistently accessible stacked passage panes with independent scroll positions and explicit A/B jump controls; never replace one text when switching focus.
- All modes: preserve keyboard focus, Hebrew diacritics, Greek spelling, 200% browser zoom, reduced motion and usable touch targets. Avoid sideways page scrolling; horizontal scrolling may be confined to an explicit trail/graph canvas only.

### 2.3 Information hierarchy

**Primary / always near the surface:** full real Scripture, original form, transliteration, observed English gloss, different attested uses, lemma/root/etymology in inspector, source-cited wordplay and revealing occurrence examples, typed graph of interesting relationships, relevant contextual media.

**Secondary / expand as needed:** exhaustive occurrence pagination, all morphological forms, detailed syntax tables, full source/provenance records, raw scores, grammatical codes, Strong's numbers, gematria, database IDs and repetitive high-degree co-occurrences.

**Never conceal important uncertainty merely to reduce clutter.** Small relation-type + source/uncertainty cues stay attached to claims.

---

## 3. Reader — exact data and interaction contract

### 3.1 Verse view

1. Display **reference and entire English verse** (WEB where licensed/available) above the interlinear area in smaller yet comfortably readable text, not as a string of disconnected English glosses.
2. Render the interlinear as a **flow of original-word units**. Each unit, in sequence, contains:
   - source original word form (Hebrew/Aramaic/Greek with diacritics);
   - readable transliteration;
   - English rendering **here** as attested by the source interlinear or existing user translation choice;
   - 2–3 short, **distinct other attested meanings/renderings** (clearly marked “also” / alternative usages), after removing duplicate synonyms; don't imply all alternatives fit this verse;
   - a subtle note/repetition/grammatical highlight when relevant.
3. **No lemma/root/spelling-relationship row in the unselected verse reader.** They belong in the hover preview and inspector. Keep original form + transliteration + English + alternatives visible without hover or click.
4. Unavailable alternate senses: hide that row rather than inventing meanings or filling the word tile with placeholders. Inflected morphemes and source edition identity remain recoverable.
5. Responsive flowing interlinear: word units form lines naturally; preserve textual token order and text direction independent of the visual preference. The preferred default is **LTR ordering of the token tiles**, **not** LTR rendering of Hebrew characters. Users can switch layout to RTL ordering; reflow only, no word ID or meaning changes.
6. Use subdued group backgrounds/underlines rather than large isolated cards. Words need room for script and diacritics, but avoid excessive padding and repeated “original / translit / meaning” labels on every token.

**Language-direction algorithm:** the canonical token array remains in source order with immutable position IDs. The renderer chooses visual order from an explicit preference; when LTR is selected, tokens appear in source index order left-to-right (for Hebrew sentence comprehension, the user is intentionally opting into reversed spatial convention). When RTL is selected, tokens appear source index order right-to-left. Each Hebrew-script span has direction=rtl and appropriate Unicode isolation; each transliteration/English span has direction=ltr. Keyboard arrow traversal should follow **visual** displayed order while semantic navigation retains canonical IDs. Regression-test multiword Hebrew with punctuation and niqqud. Persist user preference; offer a brief tooltip that the toggle affects **layout only**.

**Alternative-meaning algorithm:** obtain per-lemma small source-attested rendering groups via the current ReaderOverview / translation-choice / lexical records. Normalize orthographic/case/punctuation variants; group semantically identical short renderings where source grouping supports it; rank by attested occurrence/frequency and distinctness (prefer divergent meaning families over near duplicates); take at most 2–3. Cache once per lemma+edition+release, not per tile. If meanings are uncertain or homographic, label them as possible different usages; do not select a precise contextual sense from an English string alone.

**Hebrew spacing/words:** source morphemes may need grouping by true orthographic word/occurrence so a prefix does not become an unrelated “word meaning” card. Preserve individual morpheme inspectability in the detailed view.

### 3.2 Hover / focus / click

- **Word hover or keyboard focus:** a compact unobtrusive preview expands on the already-visible reader tile: lemma in original script + transliteration, documented root/formation with transliteration/English where present, simple grammatical interpretation, up to three sourced interesting occurrences / relationships, and meaning ambiguity. No full MCP hydration on pointer movement. Hover does not change research focus.
- **Word click / Enter:** change focus to that **exact occurrence** and open/reuse Word Focus inspector, with its own scroll area; update the trail. Clicking another word replaces the inspector focus and records another step, not a stack of unmanageable inspectors.
- **Verse reference hover/focus anywhere:** show the complete actual WEB verse, reference/edition and relevant highlighted phrases. For ranges, show the first complete relevant verse and an explicit Expand range action; do not label excerpts as full verse.
- **Reference click:** focus that verse in the reader; expose Verse / Context / Chapter control. Include one-click Pin/Compare actions in the reference preview as appropriate.
- **Entity references:** verified place/person/feast/object names may show their compact context preview, but only if an entity ID resolves unambiguously.
- Keyboard, mouse and touch must have equivalent ways to access previews and actions. Non-hover devices use tap or a small explicit action menu.

### 3.3 Continuous chapter mode

- Switching to **Chapter** displays the **complete English chapter as a continuous reader**, with verse references, source-grounded repetition/structure highlights and verse hover interactions. **Do not render interlinear word tiles in chapter view**; the user explicitly chose English-only continuous reading.
- Clicking a verse or its study action returns to **Verse** mode for that reference, with the rich interlinear and current inspector available.
- Switching Verse → Chapter centers/highlights the source verse; Chapter → Verse restores the selected verse/token and the chapter scroll anchor for the next return. Reader mode is stored in the research trail step.
- Fetch chapter text in bounded batches or an existing read-only chapter projection; do not fetch 40 hydrated word-inspector results. Preserve verse 0 superscriptions and edition differences, no synthesized text.
- English structural colors only when lexical/grammar-to-English alignment is source-backed; if precise token mapping is unavailable, highlight verse/phrase-level candidates or annotate in the inspector rather than pretending an English token equals a particular lemma.

---

## 4. Inspector — one context-sensitive surface with independent scrolling

The inspector is **closed until selection**. It can inspect **word / verse / place / person / feast / object / event / connection edge / comparison selection** and changes automatically as focus changes. Preserve the reader and graph navigation state on every change.

### 4.1 Universal inspector skeleton

**A. Media slideshow (conditional, first):** compact ~180–220px high when genuinely relevant assets exist; may include modern photo, ancient/artifact image, map, 3D model, architectural plan, timeline graphic or diagram. Clear slide labels, source/date/depicted era/uncertainty, arrow/tap navigation, 1-of-N position. Expanding a slide opens a larger accessible modal: image zoom/pan, source/copyright details; map interactions for geographic slides; orbit/zoom for a supported lightweight model. The popup is optional, not a permanent panel. When media is absent, this whole region disappears.

**B. Identity / immediate insight:** entity name in original/English/transliteration with compact descriptive context, not a wall of raw IDs.

**C. High-value relationship graph:** compact ~5–8 nodes initially within the inspector for words; expands to full graph view on action. The user sees meaningful destinations without scrolling past many technical sections.

**D. Evidence / examples:** 3–5 most revealing occurrences or witness passages; full verse hover, click to focus/compare, and visible reasons for inclusion.

**E. More:** explicitly expandable etymology detail, source morphology, all occurrences, alternate interpretations/candidates, notes, raw data.

A context module may reorder B/C/D around media to fit entity type (e.g. media map then location identity, not dictionary morphology).

### 4.2 Word Focus — exact first-glance requirements

Show compactly without needing to scroll through unrelated material:

- **Original surface form** of the clicked occurrence + readable transliteration + observed English rendering.
- **Original lemma** (distinct from inflected surface), **lemma transliteration**, and readable gloss.
- **Different attested meanings**: 2–4 distinct families when available, each with one easy-to-open source witness; clarify contextual ambiguity.
- **Documented etymological root / formation**, original script + transliteration + English gloss, relationship direction and source classification (documented, traditionally suggested, literary pun, spelling resemblance).
- **3–4 related spellings** with original script, transliteration, approximate English meaning and **why they were suggested**, plus **Show more**. These are **in inspector only**, not in verse reader. Do not conflate similar letter patterns with shared historical root.
- **High-value relationship graph** immediately available; visually grouped and expandable; small first view then full graph.
- **Most revealing occurrences** initially 3–5, grouped for independent contexts and interesting meaning distinctions, with canonical-order and by-meaning alternatives.
- Optional relevant media slideshow **above** all the above (Jerusalem map/photo; menorah object/reconstruction). Use compact height so linguistic essentials still begin visibly on an ordinary screen.
- **+ Note**, **Connect to…**, **Pin to comparison** actions unobtrusively present.

Strong's IDs and technical morphology codes are under Technical details, not part of the headline. Avoid duplicating the same four meanings in three huge paragraphs: interlinear provides one-line summary; Word Focus explains origin/contrasts/evidence.

### 4.3 Etymology and similar-spelling handling

- Read only source-supported directional root/derivation relationships for a **documented root**. Preserve extended lemma/sense and source release.
- A proposed compound name segmentation (e.g. Jerusalem) requires an independently cited historical etymology; do **not** assert “Jeru = city” as a Hebrew dictionary fact. Give traditional “city of peace” literary association and alternative historical proposals separate labels.
- Similar spelling candidates: normalize Hebrew Unicode, remove optional cantillation/vowel marks **for candidate comparison only**, compare consonantal form through bounded Levenshtein / Jaro similarity or source's existing spelling-neighbor index, and retain exact original spelling for display. Rank with consonant overlap, phonological similarity if sourced, frequency/meaningful witness, and anti-homograph safeguards. Show the 3–4 highest interesting candidates first and allow expansion. **These are form observations, not automatic etymologies.**
- Distinguish root, lemma, surface word, Greek translation alignment, literary wordplay, textual use and thematic association in both labels and graph colors.

### 4.4 Meaningful occurrence ordering

Rank a bounded genuine occurrence set to show *useful examples*, **not “theologically important” claims**:

Features:
- exact verified lemma/sense and passage occurrence relevance;
- a source-attested direct definition / wordplay / quotation;
- an independently witnessed different rendering/sense;
- informative syntax / role context and rare neighboring content words (IDF);
- distinct book, narrative/poetic/genre context and evidence source family;
- penalties for duplicates, repeated translation editions, generic high-frequency collocations, ambiguous mappings.

Practical first-pass deterministic scoring (tunable with real examples, not theological probability):
**score = 4×directWitness + 3×identityMatch + 2×distinctSense + 2×distinctiveSyntax + 2×witnessStrength + IDFcontext − 3×duplicatePenalty.** Then use a simple diversity pass / maximal marginal relevance (e.g. 0.65 relevance, 0.35 similarity penalty) to avoid five near-identical verses. Show first 3–5 examples with “Why included” evidence and offer **Most revealing / Canonical order / By meaning / By book**. If retrieved examples are not exhaustive, never label this “top of all occurrences”.

---

## 5. Relationship discovery — the core engine experience

### 5.1 Same graph, three scales

1. **Word inspector:** a compact local graph centered on the selected word, showing strongest ~5–8 distinct nodes. Open immediately when word selected (after quick identity/media information).
2. **Verse research area beneath reader:** a large graph centered on the selected verse, words/patterns/passages and related entities. Default show ~8–12 useful connections, never exceed **20 simultaneously visible connection nodes**.
3. **Graph button on fixed research trail / Expand:** the same graph opens in a larger available workspace or overlay, not a second algorithm. Preserve selected node, relationship filters, zoom, evidence inspector, and research history.

Node shapes/labels identify anchor types; color identifies **relation mechanism** (lexical, etymology/wordplay, grammar, textual/quotation, LXX/cross-language, narrative/event, physical-world, human hypothesis). Use a legend and icons/short labels as well as color. Different epistemic status uses a separate pattern/stroke, not only a hue.

### 5.2 Zoom means exploration depth

The user wants **strongest connections near the center** and **less important ones revealed by zooming outward**:

- Obtain existing ranked candidate edges; **do not build a second semantic/AI ranker**. Remove near-duplicate edges (same target + relation + witness family), ensure variety across genuine mechanism types, keep epistemic classes intact.
- Group candidate edges by coarse rank bands (for example top 5, next 7, next 8). Distribute group sectors by relation mechanism; place high-ranked nodes in the first ring with larger labels and clear witness cues, medium in second ring, lower priority in outer band.
- **Zoomed-in:** center + strongest 5–8, large readable labels and visible short edge captions. **Middle:** center + ~12–15, more sectors and smaller captions. **Zoomed-out:** up to **20** surrounding nodes with less detail, more lower-ranked branches. Use clustering/“+more” controls when more exist; never silently render 80 minuscule dots.
- Zooming out should keep node positions stable (small bounded deterministic radial/fan layout, optional gentle physics only if necessary); use viewport transforms/pan rather than reranking all node coordinates. If zoom semantics and physical zoom conflict, implement explicit **Explore further / Show more** control alongside ordinary pan+zoom so users always understand what changed.
- Key algorithm for priority bands: sort existing scored edges by backend relevance, select first distinct evidence/mechanism representatives for center ring, distribute later results across outer ring. Favor independent witnesses but do not relabel scores as scientific certainty.

**Click/hover resolution:** The user's later explicit preference is **clicking a node changes focus**, while **hover gives preview**. Implement node click as a single-step **Follow** (create trail step and center on that node), with a small preview on hover and keyboard focus. **Clicking an edge** opens why-it-connects evidence in inspector *without* changing central focus; users can then choose either endpoint. This avoids forcing a separate Follow click just to explore a node, while retaining non-navigating evidence inspection.

### 5.3 Evidence preview and detail

**Node hover:** original/transliteration/English if word, readable title if passage/entity; strongest witness reference with whole-verse hover; source mechanism and uncertainty; if previously visited indicate prior branch.

**Edge hover:** both endpoints, relation type, compact reason (“same lemma”, “explicit grammatical dependency”, “shared narrative participant”, “LXX translational witness”, etc.), evidence references, confidence/coverage status as source classification rather than a fabricated numeric probability.

**Edge click:** inspector shows both endpoints, the *entire relevant Bible verses*, original-language witness words, precise connection mechanism, source IDs/edition and limitations. A multi-hop path shows evidence **for each hop separately** and refuses to imply that the endpoints are thereby a documented semantic identity. Provide actions **Follow A / Follow B / Compare witnesses / Find alternative path / Challenge / + Note**.

**Verse/passage graph below reader:** show passage nodes, its meaningful word nodes and neighboring verses/themes, not 20 near-duplicate grammatical edges for one common word. Clicking a passage node updates reader and trail; clicking a word node opens its inspector and changes focus. The graph and textual fallback list share the same selected state.

### 5.4 Paths, forks and returning

Use a **single local branching session tree**, not an array that deletes all “future” branches when going back.

Suggested types (shape can differ; invariants matter):
- Anchor: kind, canonicalKey, edition, exact occurrence coordinates when relevant, readable original / transliteration / English.
- Edge: stableId, source,target, typed mechanism, epistemic class, evidenceRefs/witness IDs, explanation of mechanism, provenance, limitations, source release.
- Step: stepId, parentStepId, childStepIds, selected anchor and incoming edge, timestamp, snapshot.
- Snapshot: reader verse/chapter mode, selected token, scroll anchor/offset, inspector entity and independent scroll, graph center/zoom/layers, comparison pins & independent scroll, current search, active highlights.
- Personal hypothesis: from/to anchor IDs, user note ID, source witnesses, status=user_hypothesis.

Actions: FOCUS, PREVIEW (no navigation), FOLLOW_NODE, INSPECT_EDGE, EXPAND_NEIGHBORS (no navigation), GO_BACK, GO_FORWARD, RETURN_TO_FORK, RETURN_TO_ORIGIN, SWITCH_READER_MODE, PIN_COMPARE, ADD_HYPOTHESIS. State updates should not duplicate expensive fetching.

- **Trail always in a fixed header:** show last ~2–5 readable crumbs; older steps accessible under history. Clicking crumb restores saved state and scroll position. Fork menu shows visited alternate child branches with human-readable labels.
- One click into a graph node follows it; switching inspector focus by selecting a different word also records path navigation. Hover never modifies trail.
- Revisited nodes display “visited earlier” and allow returning without graph loops creating thousands of steps. Bound in-memory session to a reasonable count; persist only if current browser storage/privacy rules allow. No user bookmarks/multiple sessions in this phase.
- Restore views/pins precisely: a rabbit hole that ends in a dead end must allow returning to an earlier verse/word **without reconstructing the research setup**.
- Supabase MCP follow_connectionchain's expiring private capability is a server AI tool, not a public browser history store. The browser should use local trail state and secure BibleRPC; do not expose server secrets.

### 5.5 Available discovery actions, layered by relevance

At focus: **Explore graph**, **Follow**, **Compare**, **Back/Fork**, **+ Note**, with **Find bridge / Alternate paths / More connections / Challenge** available where supported. Semantic layer filters can toggle lexical, orthographic candidate, grammatical, direct textual, LXX, scene/narrative, physical-world and user hypotheses.

**Find bridge** between two selected anchors uses bounded existing graph/path services / get_Connection semantics to show up to a few distinct source-supported paths with independently inspectable edges; if no supported path, show “No verified path found within current coverage” and offer manual hypothesis creation, never manufacture an explanation.

**No AI-generated research narrative**: any automatic summary must be a deterministic textual description of typed relationship evidence, not model-invented spiritual interpretation. If an optional future AI assistant is ever proposed, require a **separate user decision** rather than silently adding it here.

---

## 6. Passage research area — below Scripture, not permanently beside it

Immediately below the reader, show a research tool selector and one substantial active tool, default **Connections** graph. Suggested tabs/actions (dynamic availability):

- **Connections** — large graph with source-backed relations, layers, expand and path alternatives.
- **Structure** — lexical repetition + grammar/role relationships, clause boundaries and semantic pattern candidates.
- **Cross-references / contexts** — cited passage list with full verse hover and evidence types.
- **Comparison** — set A/B, highlight matches and alternative routes; can promote to primary main workspace.
- **Places & Events** — existing geography, map and chronology with model scope/confidence.
- **Occurrences / Lexical sets** — when a word or selected phrase is focus; no duplicate giant word inspector.
- **Notes / My connections** — linked user research with scope and status.

The full graph is visible when **relationship discovery** is active; user can switch to Structure or another tool without losing graph state. Do not mount all large panels simultaneously; preserve selected tabs and scroll as part of the trail snapshot. When the inspector and lower research workspace show related content, they should complement rather than duplicate it.

---

## 7. Comparison — exact interaction and visual matching

### 7.1 Primary layout and controls

- Users pin verse/passage **A** and **B** from a verse reference, graph witness, inspector or drag action. Comparison uses the main wide workspace with two full texts side-by-side on desktop and stacked both-accessible panes on mobile; the right inspector remains open or becomes a narrow overlay/drawer.
- A and B scroll **independently by default**. Provide explicit **Align corresponding text** or one-off Scroll to match; do not force synchronized scroll.
- Each pane independently switches **Verse / Context / Chapter**. Verse mode shows small WEB English above original interlinear as defined; chapter mode shows continuous **English only**; source-grounded matching colors/structure remain possible where alignment permits.
- Controls: Pin/Replace A, Pin/Replace B, Swap, Clear, Compare by Exact lemma / Documented root / Attested cross-language / Grammar / Imagery candidate / Differences, optionally compare passages' broader graph connections.
- Two separate passages remain visible while inspector displays the selected word or relationship evidence. Return to source preserves A/B independent scroll, focus and trail.

### 7.2 Matching and coloring algorithm

1. Fetch bounded real verses/words/structures from existing BibleRPC / static corpus; never use full MCP hydration on each hover. Keep exact verse, edition and token occurrence identity.
2. **Within compatible language/edition:** same verified extended lemma/sense match gets strong positive weight; documented related root weaker separate class; similar surface spelling is only an exploratory candidate. Same English gloss alone **is not** original-language identity.
3. **Hebrew ↔ Greek:** lexical correspondence needs attested LXX/translation edition alignment. An intentional literary connection may still be displayed at passage level without pretending every word maps.
4. Build sparse candidate edges between token occurrences, preserving repeated tokens. Weight with initial **exact lemma 5, documented root 2, same source-backed grammatical role +1**; for supported LXX witness **4** in a separate lane. These are matching heuristics, **not proof strength**. Choose stable maximum-weight match or sequence-aware DP with gap penalties; preserve one-to-many matches only when corpus source permits; otherwise keep alternatives ambiguous.
5. Each verified matching group receives the **same stable color in both panes**. Hover a word in pane A highlights *all* corresponding occurrences in both panes and dims irrelevant words; clicking opens precise evidence in inspector. In chapter mode, render matched highlights in English only when word-to-English alignment is reliable; otherwise use verse-level markers.
6. Optional **Connections graph** in compare mode shows A, B, direct shared word/scene/verse witnesses and routes into the rest of Scripture. It is a derived view of the same relationship engine, not a new algorithm. A passage graph can show related neighboring verses, but **do not crowd the two readable texts with permanent crossing lines**.
7. For chapter-level candidate alignment: segment into bounded verse/clause/event units using existing syntax, xrefs and chronology sources. Prototype block similarity **0.40 rare verified lexical overlap (IDF Jaccard) + 0.25 grammar/participant-role agreement + 0.20 documented cross-reference/event witness + 0.15 distinctive image/quantity evidence**; penalize hubs and vague shared themes. Use sparse top-N candidate windows + optional monotonic local alignment, not a dense whole-chapter Cartesian matching. Highlight candidate blocks differently from exact token identities.
8. Provide an overview listing **Verified matches / Possible correspondences / Important differences** with links into both texts. Do not write an AI theological conclusion. A user can note a pattern and attach direct witnesses themselves.

### 7.3 Drag to compare

**Drag and drop enhances but never replaces explicit Pin A/B controls.**

- A verse/reference/word occurrence/graph evidence node can be dragged to a visible screen edge or A/B pane drop zone. Payload is typed canonical reference + selected exact word ID if present; no raw HTML or server token.
- Mouse/pen: confirm dragging after ~6–8 CSS px movement; touch: deliberate 300–400ms long press with normal scrolling winning on ambiguity. Confirmed drag shows A/B zones with a readable target preview.
- Left edge → A, right edge → B, existing pane header also accepts drop. Word occurrence drop pins the **verse plus selected token**. Escape, pointercancel and invalid drop restore state; offer Undo.
- Equivalent keyboard/tap actions **Pin A**, **Pin B**, **Compare with current** are mandatory, including on mobile.
- Comparison focus changes do not append false biblical claims or save notes automatically.

---

## 8. Pattern highlighting — by default, with legible semantics

**Channel 1: repeated lexical groups**, shown by stable foreground/background color and label. In the currently visible reader, chapter or two compare panes:

1. Group words by **verified exact lemma+edition (and sense where necessary)**, not by identical English letters, generic Strong's alone, or unrelated homographs.
2. Count occurrences in visible context. Default mark groups with **at least 2 occurrences**; suppress very common function words (articles, basic prepositions, conjunctions) unless requested.
3. Deterministic palette of ~8–10 accessible hues keyed to lemma within current comparison set. First occurrence ordering determines slot; keep it stable while switching verses/chapter or scrolling. For >10 groups use combined stroke/underline patterns, optional highlighting of selected group, and a legend instead of indistinguishable colors.
4. Hover a member → brighten matching occurrences throughout visible text and corresponding compare pane. Click → focus exact word in inspector. If English chapter word alignment is unavailable, do not falsely highlight word-level “same lemma” based on surface English.
5. Across Hebrew/Greek use same match color **only** for a sourced cross-language witness; use a dashed candidate marker for merely similar meaning.

**Channel 2: grammatical/structural roles**, also **on by default** but visually orthogonal to repetition colors:

- Source-attested **agent/subject** → dotted top border or agent icon.
- **Predicate/action** → single underline.
- **Object/patient** → double underline.
- **Negation** → bar/icon and explicit explanation.
- **Number + governed noun** → bracket spanning the phrase.
- **Time/sequence** → narrow side rail; **parallel clauses** → aligned clause marker.

Retrieve available MACULA/R8 dependency/semantic-role features; show “structure unavailable” rather than guess English syntax. Users may toggle **Repetition**, **Structure**, **Both (default)**, **Off**, with a legend that explains exact source/meaning. Accessible non-color shape cues and text descriptions remain available.

**Computation:** O(tokens + groups) group assignment using map from verified lemma to occurrences; avoid pairwise token comparison. Cache by passage/edition/release and update only mounted verse blocks. For comparisons, compute a combined palette across A/B so color identity remains stable.

### Later: literary pattern/chiasm candidates

Not in first milestone. An optional detector can:

1. Segment passage into syntax-backed clauses/poetic units (if not source-defined, segmentation explicitly provisional).
2. Extract independent features: rare lemmas, confirmed root relations, documented role pairs, linked event/image and number+noun.
3. Compute pair similarity e.g. **0.45 lexical rarity + 0.25 role similarity + 0.20 independently sourced image/event + 0.10 documented parallel/contrast**.
4. Compare mirrored A–B–[C]–B′–A′ unit matches to simple forward/adjacent matches, subtract high-degree/hub and repetition penalties, and to seeded within-passage shuffled baselines.
5. Require at least two independent feature families and show evidence for each mirrored pair. Label **candidate structural resemblance**, not a proven authorial chiasm. Support user-edited unit boundaries and save user observations as hypotheses.

---

## 9. Context tools — inspector-first and expandable

Use one lazy **ContextToolRegistry** with declarations for supported anchor kinds, required corpus/provider capabilities, evidence/provenance requirements, rights, display priority and popup/expanded component. Only show tools when relevant and actually supported. Selective implementation **after** the core reader/trail/graph/inspector/compare works.

### 9.1 Geographic places and historical maps

Use existing MapLibre/VerseMap, canonical place IDs and passage relation tags. An entity's inspector opens a small map slide, expandable to the interactive map; indicate **mentioned vs setting vs destination vs inferred setting**, historical/modern alternative locations and confidence. Optional licensed ancient maps identify **date created** and **era depicted** separately; do not treat a medieval illustration as a biblical-era surveyed map. “Eastern gate” must be disambiguated by verse, structure and period; do not silently equate to current Jerusalem gate.

**Jerusalem example:** Word Focus shows the name and proposed etymologies/traditional wordplay separately; media slideshow offers modern map, selected historical image and later optional 3D reconstruction. Salem ↔ Melchizedek (Gen 14:18; Ps 76:2; Heb 7) is a sourced textual pathway but **not proof** of a simplistic “Jeru = city” root segmentation.

### 9.2 People and genealogies

Select a resolved biblical person, open 1–2-generation bounded BFS family tree (~15–25 nodes) with directional father/mother/spouse/child/sibling edges. Every relation links to cited verse or reviewed dataset witness. Same-name characters and disputed genealogies remain distinct. Clicking a person/edge navigates through the same discovery trail. Evaluate existing Theographic metadata or other open data only after license, identity crosswalk and source audit.

### 9.3 Feasts and calendar

Selecting *Pesach* opens a small calendar slide with associated Torah verses, expandable to appointed-times overview and calculation explanation. Distinguish Passover 14 Nisan from Unleavened Bread 15–21 Nisan; the “seven feasts” grouping is a teaching convention, not the entire contents of Leviticus 23. For modern fixed dates use an audited compatible Hebrew-calendar library (e.g. Hebcal) with leap cycle, postponement rules, Israel/Diaspora and evening boundary. For Exodus-period observance separately describe contested observational/harvest models; **do not project exact modern dates backward**. Details should be source-grounded, not AI interpretations.

### 9.4 Objects, tabernacle and temple media

Menorah opens source-aware media: licensed photograph/artifact or explicitly labeled reconstruction, diagram of tabernacle/temple and object location when text supports it. A slide zoom popup can show labeled sections and clickable biblical witnesses (Exodus 25, Zech 4, Revelation 11). Historical periods, artistic reconstruction and excavated evidence are not interchangeable. Media manifest: entity ID, creator, origin URL, license, creation date, depicted era, model type, witness refs, optional overlay coordinates; no random remote hotlink on every hover.

**Genesis 10**, not Genesis 12, contains the Table of Nations: offer a genealogy and proposed geographic identifications in separate layers, with speculative migrations clearly labeled.

### 9.5 Context-data security and rights

External images, 3D models and datasets require per-source rights and attribution checks; lazy-load only selected media to keep the website fast and within free tiers. No new paid services or blanket imports. Maps/images/popup should never obstruct Scripture permanently.

---

## 10. Personal notes and proposed connections

- Selected exact **word occurrence, lemma, verse, selected phrase or graph edge** exposes a small + Note action. Composer opens in place or inspector with target/scope prefilled and one primary text field. Notes to selected occurrence should **not silently attach to all occurrences** of a Strong's grouping.
- Explicit Save / Cancel, with existing authentication and permissions. A subtle note indicator appears on the selected verse/word/graph edge after save. A user can move the scope before saving.
- **Connect to…** lets the user select a second anchor through graph, text search or comparison; creates a **personal hypothesis edge** with the user's explanation and optional witness references, visibly marked “My connection”, with a layer toggle to show/hide personal links alongside source relations.
- No backend automatic approval, no anonymous privilege expansion, no derived claims promoted into corpus truth. Note ownership/review/DLM policies remain those of existing app.

---

## 11. Engineering fit — reuse the current project

**Existing:** Vite + vanilla TypeScript, CSS and MapLibre; source of truth is the local checkout, backed by GitHub. Browser accesses existing BibleRPC gateway, Cloudflare Worker static corpus/immutable indexes, Supabase dynamic notes/auth/chronology/geography, and R9B/R10/R11/R12 relationship APIs. MCP v2 has get_Passage, get_Word, get_Connection, follow_connectionchain, research, write_Note and get_prompt, but its hydrated AI-oriented responses are **not** an instant browser hover protocol.

Re-use/refactor these proven components:
- src/main.ts — overall routing, passage selection and mounting.
- VerseReader.ts — WEB + STEP original words and transliterations/rendering groups, translation choices.
- ContextPreview.ts — verse/reference hover and pinned actions.
- WordInspector.ts and WordFormation.ts — reorganize into Word Focus; do not duplicate lexical computations.
- DiscoverConnections.ts and ExploreConnectionsPanel.ts — existing ranked connections, layers and multihop paths; UI adapter unifies them, rather than replacing traversal engine.
- PassageComparison.ts — extend to A/B full verses or chapters, independent scrolling, matching and source evidence.
- PassageCrossReferences.ts, ResearchPanel.ts, VerseMap.ts, EventTimeline.ts, NotesPanel/NoteEditor — preserve as context tools.
- src/api/rpc.ts, r10-rpc.ts, relationships-rpc.ts, corpus-client.ts — route bounded browser requests with caching; **do not create a new Supabase client inside each component**.
- scripts/verify-ux-refresh.mjs — extend existing Playwright journeys rather than starting an enormous framework.

**Normalized UI adapter** should preserve word occurrence vs lemma vs sense, canonical reference, edition, source release, relationship mechanism, epistemic status, witness IDs and retrieval coverage. Types can evolve but should cover Anchor, EvidenceWitness, RelationshipEdge, ResearchStep, InspectorContext and ComparisonSlot. Do not store expensive full responses inside every trail node; store stable IDs and small snapshots then fetch bounded details when revisiting. No private MCP capability tokens in the public browser.

**Performance rules:**
- Hover/focus uses bounded in-flight-deduped reader/lexical projection requests, cache by edition+reference+release; target cached preview visible immediately after short dwell, a loading indicator when needed. Do not call full hydrated MCP for every word hover.
- A verse's alternative meaning profiles are fetched once per lemma/edition, not N independent per-token calls.
- A graph neighborhood loads at most 20 visible result nodes and has bounded next-page expansion; no thousands-node canvas, no continuous force physics required.
- Chapter view lazy-fetches bounded English verse batches while preserving scroll anchor; inspector, graph/media assets hydrate only when opened.
- Prevent stale asynchronous responses from overwriting latest selected word; abort or generation-guard requests, preserve keyboard focus.
- Use CSS token grid/flow with direction handling and clear labels. Hebrew niqqud render carefully in fonts already available; do not distribute font files.
- Be accessible at 320/390/768/1280/1440px, large text, correct bidirectional script, keyboard and touch equivalents, contrast and no page overflow.

---

## 12. Delivery order — collaborating in localhost

The user wants to **co-design by seeing actual changes in the running local website**. No predetermined mockup or reference image is approved. Do not use the generated image set as instructions.

**Workflow:** read this strategy via GitHub MCP (kingdomfishers/BibleResearch, feat/r12-qa-fixes, exact root path UX_STRATEGY.md), inspect local checkout/status, start/reuse **npm run dev** in the project workspace, use Vite HMR to keep localhost updated while editing. **No screenshots, videos or preview URLs** in design review messages. Report exactly what changed in localhost, ask 1–3 specific consequential questions grounded in the running UI, then **wait** for user feedback before the next major UX decision. No shared production deploy or major merge without explicit approval.

**P0 — first working feedback cycle (build before more interviews):**
1. Fixed top trail with follow/back/fork + state snapshots.
2. Large VerseReader with small English sentence and dominant, flowing original/translit/English/alternate meaning words; LTR/RTL token-flow toggle.
3. Click original word → inspector opens with compact word identity, meaning/lemma/root and a small real connections graph.
4. The current verse's large graph available below Scripture; graph hover vs node click vs edge click distinctions working; real source evidence.
5. One straightforward pin A/B compare example with both texts readable.
6. Stop and ask user what to change in this **visible local draft**. No overbuilding of P1 context tools.

**P1 — after the user approves P0 behavior:** chapter English-only transitions, graph semantic zoom + full graph expansion, Word Focus occurrence/spelling ordering, precise comparison colors, default grammatical structure overlays, quick notes, drag-to-compare and accessible controls. Build short visible slices and ask for approval at each significant design choice.

**P2 — selectively chosen by user:** map/entity slideshow, Jerusalem, Menorah, people, feasts, related 3D assets and imagery, narrative pattern boards. Modular provider first; only integrate actual available licensed data.

**P3 — later:** higher-order cross-passage structural alignment, chiasm proposals and sources imported only after evidence/rights audit.

**Agent ownership:** small low-tier subagents may handle contained reader or comparison changes; orchestrator owns shared exploration state/main.ts/adapter and integration. Work in a separate Git worktree/branch when another agent changes the algorithm/MCP; do not overwrite unrelated files or deploy shared services concurrently. TASKS.md remains the sole project task queue. Do not run 239-case algorithm benchmark to approve UI; use targeted interaction tests.

---

## 13. Acceptance tests: observable user journeys

These are user-facing gates, not visual-only screenshot tests.

1. **Bible-first start:** opens the last/current verse. Search/selectors above reader; main verse clearly dominates. Inspector hidden until selection.
2. **Gen 2:7 interlinear:** full WEB English smaller above flowing Hebrew word units, each original script + translit + English here + up to 2–3 alternative uses. No root or spelling relatives in reader. Changing Hebrew **token visual flow** LTR ↔ RTL preserves each Hebrew word's internal RTL spelling, canonical order IDs, word click identity and keyboard navigation.
3. **Gen 1:2 ruach:** *spirit / wind / breath* appear visibly as sourced alternative uses without hover; root and lemma appear after hover or word inspector selection, not in the reader tile. Irrelevant candidate meanings aren't asserted as the context's translation.
4. **Word inspector:** click *adam* opens it, scroll independently of verse; media slideshow only if relevant; lemma original+translit, meaning, source root, 3–4 related spellings, compact word graph, revealing occurrences. Strong's and gematria not at top.
5. **Graph 20-node cap:** word compact graph ~5–8, verse full graph <=20; zoom in focuses on important nearby nodes, zoom out exposes lower-ranked distant candidates; relation type colors and labels clear. Hover a node previews, click changes focus/trail. Hover an edge previews why, click opens full real verse evidence without navigation.
6. **Rabbit-hole reverse:** Gen 2:7 → adam → adamah → Gen 3:19 → alternate branch → return to earlier fork; exact reader mode, verse position, inspector selection/scroll, zoom and compare pins restored. History visible in **fixed top trail**, older crumbs compact.
7. **Verse ↔ chapter:** expand Gen 2:7 to Genesis 2 chapter (continuous English only), scroll and select a verse, return to rich verse view and later return to chapter at prior position. Psalm superscriptions/verse 0 and cross-edition shifted verses handled.
8. **Comparison:** select Gen 2:7 A and Gen 3:19 B; two complete text panes visible, independently scrollable; real matched lemmas highlighted with the **same color**, hover an attested occurrence highlights counterpart(s), source evidence in inspector; unrelated words and root-only resemblance use distinct relation treatments. Both chapter English views supported.
9. **Default pattern visualization:** same lemma repeated in verse/chapter gets consistent palette; grammar role underlines/brackets remain separately visible. Repeated root≠same lemma and similar English words≠Hebrew lemma. Toggle both off while keeping English readable.
10. **Relationship research below Scripture:** scroll down to graph/tools without losing the current verse selection; inspector and full graph use shared state; enlarge and return preserves focus/zoom.
11. **Manual research note:** select an exact occurrence → + Note with prefilled scope; save explicitly under existing auth; add A→B personal hypothesis, visible as *My connection* and not indexed evidence; no unauthorized writes.
12. **Contextual inspector slides:** place shows mini map with alternate identification; Menorah image/model labeled reconstruction and source; feast calendar explains modern calculation vs biblical timing; popups expand without resetting research trail. Only implemented tools claim completion.
13. **Drag-to-compare:** pointer/touch/keyboard pin A/B equivalence; avoid accidental drags while scrolling; Escape/Undo works and no data corruption.
14. **Responsive/accessibility:** 320, 390, 768, 1280, 1440 widths; 200% zoom, Hebrew RTL glyph direction with selected LTR/RTL tile layout, Greek LTR, 44px controls, focus/hover parity, long verse scroll, independent inspector and comparison scroll.
15. **Performance/safety:** no heavy MCP per hover, bounded graph and chapter requests, no duplicate requests after rapid hovers, stale response guard, proper data/source licensing, no fabricated Scripture or theological claims, and existing notes permissions unchanged.

**Release gate:** after iterative user approval, run focused type/build/browser checks against localhost, then request explicit permission to merge or deploy. A large attractive static network or a long untested document is not sufficient.

---

## 14. Candidate resources and source provenance

Start with **already imported** STEP Bible, Macula Hebrew/Greek, MorphHB, Swete LXX, R8 grammatical/semantic indexes, R9B/R10/R11/R12 connection indexes, existing notes, maps and chronology; verify actual availability in local workspace and current deployment before relying on a capability.

Potential **later** sources, only if license, source methodology, canonical identity and attribution checks pass:

- Macula Hebrew and Greek syntactic source corpora: Clear-Bible/macula-hebrew and Clear-Bible/macula-greek.
- ETCBC BHSA/Text-Fabric clause and linguistic structure annotations, mapping carefully across editions.
- A Hebrew poetry/parallelism annotated dataset if genuinely accessible, accurate and legally usable; do not treat automatically generated chiasm labels as truth.
- Theographic geography and people metadata, public biblical genealogy sources with witnessed parent-child relations.
- Modern Hebrew calendar implementation such as Hebcal library for **modern fixed** Jewish calendar (not proof of ancient observance).
- Existing MapLibre and vetted OpenBible.info/Commons geography and licensed image asset manifests.

Keep provenance for every original-language claim, etymology, image and calendar model. **Explore surprising evidence; do not turn interesting similarities into asserted historical/semantic certainty.**

**End state:** The reader immediately suggests the richness of every Hebrew/Greek word; one click reveals a compact but deep inspector; every interesting connection is visible in an organized, expandable graph; every rabbit hole is reversible; passage comparisons make patterns visible; and additional research tools appear exactly when they help.


---

## 15. Central design system — one place to change the entire UI

**Requirement:** Future coding agents must be able to redesign BibleResearch consistently without hunting through dozens of CSS/TypeScript files or adjusting each panel separately. **Define all shared visual language and reusable UI elements in one discoverable design-system module/directory**, rather than scattering hardcoded values and duplicated component styles.

**Fit the existing architecture:** this project uses vanilla TypeScript and CSS, with existing theme variables in \`src/ui/styles-base.css\` and \`src/ui/styles-workspace.css\` and other feature stylesheets. Extend and **consolidate** what exists; no React/component-framework migration or unnecessary dependency. Suggested stable entry point: **\`src/ui/design/\`** containing:

- **\`tokens.css\`** — the *single source of truth* for theme palettes and shared CSS custom properties: background/panel/text, borders, accents, hover/focus/selected/disabled states, semantic relationship-type and epistemic colors/patterns, spacing scale, border radius, shadows, typography scale, original-script/interlinear typography, animation duration, inspector/header dimensions and layer/z-index values. Light/dark/high-contrast variations belong here, keyed by theme data attributes. Preserve or alias existing \`--background\`, \`--panel\`, \`--gold\`, etc. during migration.
- **\`components.css\`** (or equivalent well-organized existing styles) — canonical visual definitions for Button, IconButton, Badge/Tag, Card, Tab, Tooltip/Preview, Popover/Modal, SearchField, InspectorFrame, NoteComposer, ResearchTrail, WordTile, GraphNode/Edge, MediaSlideshow, ComparisonPane and loading/empty/error states. Provide a few explicit sizes/variants (compact/normal, quiet/prominent, selected/hover/focus) instead of bespoke per-screen copies.
- **\`primitives.ts\`** — only when justified by real duplication: small typed DOM factories/props for the shared elements above. If a suitable helper already exists, consolidate into it rather than introducing a competing component abstraction. Feature components still own data fetching and interactions.
- **\`README.md\`** — concise human/AI entry point: file map, token naming conventions, variants, responsive rules and **“change this to redesign the app”** instructions. This README documents the source; it must **not** become a second set of hardcoded color/spacing values.

**Critical distinction:** “One place” refers to the **shared design definitions**, not moving the entire app and all its feature-specific code into one giant file. Feature CSS can still control unique structure/behavior, but it must consume tokens and primitives instead of redefining the global visual style.

**Centralized layout constraints** should include: fixed research header height; reader/inspector proportions and breakpoints; interlinear tile spacing and Hebrew fonts; independent panel scrolling; graph node typography and link stroke; comparison pane minimum widths; responsive 320–1440+ layouts. For exceptions, define named variants/tokens, not scattered magic numbers.

**Relationship colors have semantic meaning.** Map each relation mechanism (lexical, etymology/wordplay, grammatical, textual, LXX, narrative, real-world, personal hypothesis) to a centralized color plus non-color marker. Keep *repeated-lemma highlight palette* separate from *relationship-type colors*, and ensure both work with light/dark modes and color-vision differences. The graph, cards, inline highlights, inspector and comparison must derive matching labels/styles from the same semantic mapping.

**Implementation order and verification:**

1. Inventory existing root/theme variables and repeated button/card/tooltip/panel styles before editing. Introduce the canonical design-system entry point and wire it through the existing \`styles.css\` imports and app styles. Do not break existing theme switching or responsive behavior.
2. Migrate the common high-visibility UI first (header/trail, VerseReader word tiles, inspector, graph/cards, comparison). Move remaining duplicated definitions incrementally without blocking the first functioning UX.
3. When designing a new UI element, first add or reuse a token/primitive/variant in the central system; feature code consumes it. No new repeated inline hex codes, font sizes, radii or component-specific buttons unless there is a documented reason.
4. Keep the existing component/data boundaries: \`BibleRPC\` and feature event/state logic stay separate from styling. Replacing a theme should **not** require rewriting connection traversal, lexical retrieval, notes or comparison logic.
5. Create a simple **Design System Preview / component gallery** reachable locally in development (or a small dev-only test page) showing common controls, original-script word tiles, compact and expanded inspectors, graph nodes/edges and comparison highlights in light/dark themes. It must use the **actual shared styles/components**, not screenshots or static mockups.
6. **Acceptance:** changing a small set of design tokens must visibly update the reader, inspector, research trail, graph and comparison consistently. Changing Button/Card/WordTile primitive styling updates all consumers; no accidental duplicated hover/focus styles. Verify light/dark mode, RTL/LTR word-tile ordering, reduced motion, keyboard focus, mobile widths and readable graph/lemma color contrast.

**Future AI workflow:** inspect \`src/ui/design/README.md\` first, modify \`tokens.css\` for the overall look and \`components.css\`/shared primitives for element design, then check the live \`npm run dev\` page. Users should be able to explore alternate visual directions rapidly through small central changes **without redesigning every screen by hand**.
