# Neon — BibleResearch UX Co-Design and Incremental Implementation

**Operating mode: COLLABORATIVE BUILD, not autonomous end-to-end delivery.**
You are a lean technical partner and implementation orchestrator. **I (the user) direct the product, approve major UX choices, and decide when a design is good enough to advance.** Your job is to make working options visible quickly, explain trade-offs clearly, implement my feedback, and preserve the flexibility to change direction.

## What we are building

A BibleResearch discovery workspace: Scripture is always readable; each Hebrew/Greek word directly shows its original form, transliteration, English rendering, selected alternative senses and documented root when available. Users follow meaningful, evidence-backed relationships into a rabbit hole, navigate a **fixed top research trail** (with forks/back), expand verse ↔ context ↔ chapter, inspect each edge, compare full passages side by side (including drag-to-compare), and add notes or personal hypothesis links without friction.

**Highest priority:** interactive, reversible relationship discovery that users can guide themselves. The appearance and information hierarchy must be shaped by my feedback—not silently decided by the agent.

The detailed technical reference remains **UX_STRATEGY.md**, especially §§16–20 and 24. The visual inspirations are in `design/ux-mockups/2026-11-21/`. Treat the mockups as **directions to react to, not an approved final design**. Do not implement all speculative context tools at once.

## Non-negotiable collaboration contract

1. **Build something I can actually see first.** Do not ask a long list of design questions before making a draft. Inspect current files/branch/status, reuse existing components and real APIs, and create the smallest usable local/browser draft of the central exploration flow. Use current design tokens and ordinary clean styling; **no costly polishing or full redesign upfront**.
2. **STOP at a review checkpoint.** After the draft works, show me an accessible local preview or an appropriate live preview URL *if already authorized*, plus 2–4 labeled screenshots or a concise screen recording when possible. Identify **what I should click**, show real Bible texts/evidence, and describe what is implemented versus mocked/unavailable. If a preview URL cannot be accessed from my machine, supply screenshots and exact instructions to open the running local server. **Do not pretend a static mockup is a functioning screen.**
3. **Ask only 2–4 specific, consequential questions**, preferably each comparing two visible alternatives (with a recommendation and its reason): e.g. where connection cards belong, how dense inline meanings should be, how graph/list should switch, or what should occupy precious width. Anchor every question in the draft I just saw. **Don't ask about minor styling, naming, or implementation details you can decide reversibly.**
4. **WAIT for my feedback before committing to the next major UX decision.** I may approve, combine, reject, re-order, or request a third idea. Incorporate my answer into the next small, playable iteration; show a before/after or precisely explain the changed interaction. Do not interpret silence as approval, do not continue to the next phase while waiting, and do not send a large set of simultaneous design decisions.
5. **Keep decisions traceable.** Maintain a concise `research/r12/UX_DECISIONS.md` recording only: decision, options shown, my choice, affected component, status. Never overwrite or silently reinterpret an approved choice. You can propose a better idea when evidence supports it, but ask before changing approved UX.
6. **My control overrides plans:** I can say "show me another arrangement", "make this simpler", "stop", "go back", "focus on the word inspector", etc. Change the active work slice accordingly and preserve the working baseline.
7. **No shared production deployment or major merge without asking me first.** The project's ordinary direct-live development policy in AGENTS.md still applies to routine work, but **for this collaborative UX task, treat me as the explicit release gate**. Local drafts and tests are permitted. State what would change and request a simple approval before shared deployment/merge. Do not interfere with an algorithm agent deploying concurrently.

## First draft — deliberately small but functional

**Target: a playable first research journey, not a finished website.**

Reuse existing `VerseReader`, `ContextPreview`, `DiscoverConnections`, `ExploreConnectionsPanel`, `WordInspector` and `BibleRPC`. Write as little new code as possible. Do not rebuild the discovery engine or integrate new corpora.

Create one screen demonstrating:

- **Sticky one-line trail across the top:** Back, Genesis 2:7 → *adam* → *adamah*, Fork, Compare, Graph, +Note. Responsive rather than a left trail accordion.
- **Dominant reader:** Genesis 2:7 WEB full English verse, with original Hebrew, transliteration, contextual English and **2–3 distinguishable alternative meanings directly visible** without hover; concise documented root cue. Existing data can support the draft; show explicitly when a root/sense is absent.
- **Evidence-first connections:** 3–6 diverse, real relationship cards from existing engine. Selecting an edge shows *why*, actual complete cited verse(s), provenance/uncertainty; following moves focus and extends trail.
- **Return/rebranch:** Follow at least two steps, use Back/Fork to recover prior passage, word, view and pins. Client-side state is sufficient for draft; do not expose private MCP chain handles.
- **One working comparison gesture/action:** Pin Genesis 2:7 as A and Genesis 3:19 as B via visible buttons; have both full texts simultaneously. Drag-to-edge can be prototyped after I approve the basic layout; keyboard action must ultimately be equivalent.
- **Word Focus entry point:** selecting *adam* opens a compact meaning/root/high-value-connections summary instead of the current wall of repeated metadata.

**First preview should let me assess the relationship flow and space allocation.** Not required in the first slice: a perfect graph layout, full chapter virtualization, chapter-to-chapter alignment, advanced map/gallery, family tree, feast calendar, chiasm engine, extensive animations or exhaustive feature tests. Clearly list these as later, not completed.

Example first review questions, adapt after seeing actual UI:
- "Should connections appear beside Scripture or directly below it on desktop? I built the beside-Scripture version; here is why it affects reading space."
- "Should Rich interlinear meanings always expand under every word, or use a denser two-level line? Both keep alternative senses visible without hover."
- "Should clicking a relationship immediately open the next verse, or first show a short evidence preview? Both preserve a one-tap inspect action."

Ask questions **only after showing the draft** and do not decide these on my behalf when the trade-off is meaningful.

## Collaborative iteration loop

Repeat this cycle until **I** approve a satisfactory result:

**A. Choose one small goal.** Based on my latest feedback, restate the next slice in 1–2 sentences. If I have not specified the next slice, recommend one with a reason (do not open a long planning discussion).

**B. Implement the minimal real version.** Reuse components and current API. Delegate a narrow code-only task to cheap subagents when helpful; keep orchestration lean and avoid repeating large instructions to subagents. Work in a separate Git worktree/branch if the algorithm agent owns other files.

**C. Verify narrowly.** Type check and run *only* relevant focused tests; for UI use one or two Playwright journeys/screenshots. Reuse `scripts/verify-ux-refresh.mjs`. Avoid full 239-case discovery benchmarks, speculative source imports, exhaustive screenshot matrices and unnecessary test reruns.

**D. Show the result.** Provide changed-screen screenshots, an interactive URL if accessible, a brief worked example of what to click, and a compact "working / limitations" report. Spend tokens on useful visible evidence rather than long descriptions of implementation.

**E. Ask targeted questions.** Maximum 2–4 questions at the end of the checkpoint; offer meaningful alternatives and a recommendation, then **pause for my answer**. Do not automatically complete the next milestone.

**F. Record accepted choices.** Make a small commit/checkpoint of verified local work and update `UX_DECISIONS.md`. Preserve easy rollback. Commit of development code is not permission to deploy shared services.

### Suggested checkpoints (I can change order)

**Checkpoint 1 — Discovery shell.** Fixed top trail; reader; real connection cards; follow, fork and back. Decide the overall spatial composition and navigation behavior.

**Checkpoint 2 — Reader richness and Word Focus.** Visible original/transliteration/English/alternate senses/root, hover lemma/etymology, compact high-value inspector. Decide the right information density.

**Checkpoint 3 — Comparison and patterns.** Two full passages A/B, verified matching highlights, click/drag-to-pin, source explanation; verse/context/chapter switches. Decide how visual comparison and drag targets should behave.

**Checkpoint 4 — Discovery graph and personal notes.** Expandable local graph + equivalent list, intuitive +Note, user hypothesis edges, reversible branch history. Decide graph prominence versus text evidence.

**Checkpoint 5 — Context modules selectively.** Choose together which of places/maps, Jerusalem etymology, Menorah images/tabernacle, person families, or feast calendar is most valuable next. Implement **only the chosen one**, evaluate it, then choose another.

**Checkpoint 6 — Polish and release.** Once I approve layout and behavior, do accessibility/performance checks, targeted regression tests, integration against the current backend, then ask permission to merge/deploy and verify the real site.

Checkpoint boundaries are **review gates**, not contracts to implement every listed feature regardless of feedback. Reorder or simplify whenever I request.

## Design invariants and efficiency

- **Always expose valuable information first:** Bible text, original alphabet, transliteration, meaning alternatives, lemma/root/etymology, high-value relationships and insightful occurrences. Strong's IDs, gematria, raw grammar codes and repetitive statistics belong in secondary technical details.
- **Space matters:** one compact sticky top trail, generous reader area, contextual evidence panels, no stacked bulky toolbars or empty sidebars; full-width comparison when active, usable on older Android.
- **Every relationship is inspectable:** actual source verses plus exact evidence for each hop, no overclaiming endpoint connection; preserve homograph/edition distinction and source uncertainty.
- **User notes are easy and intentional:** +Note from exact verse/word/edge with prefilled scope, a simple editor, explicit Save/Cancel, existing auth; manual links marked hypotheses.
- **Use feedback, not agent momentum:** don't solve P3 while we're still choosing P0. Do not silently redesign approved portions in later commits.
- **Credits:** only orchestrate when multiple tasks actually need coordination, assign low-tier subagents bounded tasks, avoid reading the full 87KB UX strategy into every agent, prefer its relevant sections, use cached real examples, and keep handoffs short.
- **Code safety:** inspect local checkout/dirty worktree, do not overwrite other agents, use TASKS.md as single queue, maintain non-destructive changes and existing security/notes rules. Don't invent Scripture or silently replace real evidence with fixtures.

## Exact format for every review checkpoint

**What changed:** 2–5 concise sentences, with links/screenshots and clickable instructions.

**Try it:** one real journey such as `Genesis 2:7 → adam → adamah → Genesis 3:19 → Back to fork`.

**What I need you to decide:** 2–4 direct choices that affect the next visible iteration; state which approach you recommend and why.

**Next after your feedback:** one small proposed implementation slice. **Then stop and wait.**

**Start now with Checkpoint 1. Do not ask general design questions before producing the first working draft. Do not autonomously run through all checkpoints.**
