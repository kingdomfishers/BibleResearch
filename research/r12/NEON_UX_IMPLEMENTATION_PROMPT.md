# Neon — Implement the BibleResearch Evidence-First Discovery Explorer

You are the **UX implementation orchestrator**, not an architecture-only consultant. **Implement, integrate, test, deploy, and hand off** the functional research UX defined in the now-authoritative **UX_STRATEGY.md** (2026-11-21) on feat/r12-qa-fixes.

## Mission

A user must understand a biblical word instantly, read an entire cited verse on hover/focus, compare two original-language passages simultaneously, follow branches of a connection graph and inspect each evidence step without losing the source passage.

**Scripture is the foreground; graph navigation is secondary; evidence is inspectable; the user is the investigator.** Build for speed of discovery and reliability, not visual polish.

## Initial inspection (short and surgical)

1. Follow AGENTS.md, inspect the **actual local checkout / Git status / branch** before edits, and preserve unrelated work. Local workspace is authoritative.
2. Read **UX_STRATEGY.md** in full, especially §§1–3, 5–8, 10–14. This is the complete implementation and acceptance specification. Do not write another design proposal or reinvent its interaction architecture.
3. Inspect only relevant existing components: src/main.ts; VerseReader, ContextPreview, WordInspector, WordRenderingRange, PassageComparison, DiscoverConnections, ExploreConnectionsPanel, PassageCrossReferences, EventTimeline, VerseMap; BibleRPC in src/api/rpc.ts, r10-rpc.ts and relationships-rpc.ts; the existing browser verifier.
4. Read MCP_STRATEGY.md and MCP_IMPLEMENTATION_HANDOFF.md only for tool mapping, plus mcp_v2_live_audit_2026-11-20/ROOT_CAUSE_WORD_ID_MISMATCH.md for the **P0 Zechariah 4:2 identity bug**. MCP v2 has get_Passage, get_Word, get_Connection, follow_connectionchain, research, write_Note and get_prompt; use these as reference contracts, **not as heavy hover endpoints**.

## Execution

**A. Accurate evidence and instant previews — P0**

Extend the existing ContextPreview and VerseReader, not a parallel implementation. Every reference in results, notes, graph edges, map/timeline and occurrences must support a **complete WEB verse preview** on hover/focus and an explicit tap/click route. Word hover/focus displays English gloss, readable transliteration, original script, meaning here vs sourced elsewhere, short grammar/ambiguity; it must not change selection. Click/Enter opens the persistent inspector. Reuse/cache bounded reader RPCs, handle stale requests, and honor keyboard/touch/accessibility.

**Critical blocker:** latest connected MCP get_Passage for Zechariah 4:2 still gives H4501 lampstand the transliteration of gold. Never present a wrong canonical word ID/transliteration/grammar as verified. Use exact audited STEP occurrence identity or display unverified alignment until the algorithm/data owner fixes the cross-source positional join. No independent invasive corpus rewrite.

**B. Real comparison — P0**

Upgrade PassageComparison to pin A/B; keep both full WEB passages visible with original tokens, transliteration, gloss, contextual selection and evidence. Highlight only verified original-language correspondences. Provide switchable Word/Grammar/Narrative/Imagery/LXX/Difference lanes as source data supports. Preserve source passage, scroll position, trail and pins. On mobile stack both full texts, never switch one away. Extend incrementally to an optional third pin / Pattern Board.

**C. One shared graph/trail/evidence workspace — P1**

Unify existing DiscoverConnections and ExploreConnectionsPanel through a lightweight typed Anchor/Edge/Witness adapter and client-side branching history. Small expandable neighborhood (5–9 nodes), typed edges with 'Why connected?', complete verse evidence, alternate paths, find-a-bridge, branching/revisit/back and list equivalent. Preserve documented vs inferred vs exploratory evidence and homographs/senses. Do **not** rebuild or retune the relationship engine.

**D. Human-guided patterns — P1/P2**

Allow pinned multi-passage comparison, text/grammar/event/quantity/object/property feature lanes, manual hypothesis edges, source-backed supporting and counterevidence, and explicit note save through existing infrastructure. Make user hypotheses clearly distinct from verified claims. Preserve map, timeline, chronology alternatives, technical research and source rights.

## Parallel execution and credit economy

- Delegate **preview/reader** and **comparison** to separate low-cost implementation subagents with **non-overlapping files**.
- Delegate **graph/trail** only after the shared UI adapter contract is fixed; delegate narrow tests/documentation independently.
- Neon alone owns src/main.ts, shared exploration state/adapter integration, deployment coordination, and edits to TASKS.md when relevant. The other algorithm/MCP agent retains ownership of ranking, graph compiler, corpus and MCP implementation.
- If algorithm work is ongoing, use a separate Git worktree/branch. **Never deploy in parallel to the same Workers/MCP services**; merge only after backend release is stable. Do not overwrite another agent's live work.
- Give subagents exact responsibilities and acceptance tests. Reuse existing code; avoid redundant rereads, repeated large output, unnecessary abstractions, huge full benchmark runs, and expensive visual polish.

## Verification (focused)

Extend **scripts/verify-ux-refresh.mjs** using real local/browser/Playwright tests. Required journeys:

1. Genesis 2:7 adam hover; click, follow adamah, hover Genesis 3:19, compare A/B and return with token selection intact.
2. Zechariah 4:2 identity canary: **menorah must not show za.Hav**; contrast Zechariah 4 and Revelation 11:4.
3. Genesis 6:14 ↔ Exodus 2:3 bridge, actual verse and Hebrew evidence.
4. 2 Peter 1:19 Greek lamp/light-bearer with source occurrence witnesses.
5. John 1:1 repeated word positions, RTL/LTR, Psalm heading verse 0 and ruach alternative renderings.
6. Graph expand / evidence / alternative path / back / branch / no-result / uncertain class.
7. Compare both passages at 320 and 390 px; keyboard focus, pointer hover, touch actions, Escape, no horizontal overflow.
8. Rapid hovering does not flood the network, replace active selection, or trigger large MCP calls.
9. Existing notes, geography, chronology models, reader translation choices, nine advanced tools and original legacy behavior remain usable.

Run type checks/build, focused regressions and actual live smoke after integration. The 239-case algorithm benchmark is **not** your job.

## Release and finish

Implement working vertical slices through integration. Follow the project's direct-live policy, coordinating with the algorithm owner and preserving rollback. Deploy **website only** unless an additional read-only backend projection is objectively required and approved by AGENTS.md. Verify the actual deployed site, not just a build.

Update UX_STRATEGY.md only when necessary to record a genuine implementation decision; TASKS.md remains authoritative. Create **research/r12/DISCOVERY_EXPLORER_UX_HANDOFF.md** with changed files, tests, live URL/version, commit SHA, P0 alignment status, screenshots or results, known gaps and rollback.

Finish with a concise linkable report. Do **not** stop after a strategy document or silently claim untested features.

**Implementation order:** reliable previews → side-by-side comparison → central state & evidence inspector → graph/trail → Pattern Board → live verification. Start now.
