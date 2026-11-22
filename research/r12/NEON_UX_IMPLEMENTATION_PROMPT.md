# Neon — BibleResearch UX: Build Together in the Existing Localhost Preview

**Mode: USER-LED LIVE CO-DESIGN.** I make the important UX decisions while seeing the actual website change. You are a fast implementation partner, not an autonomous designer executing a predetermined visual concept. Build small working changes, let me inspect them in my existing local browser, ask specific questions, and wait for my answer.

## 1. Where to find the strategy — exact GitHub MCP instructions

The UX strategy is on **GitHub**, and my local working folder might not yet contain the latest version.

- **Repository:** `kingdomfishers/BibleResearch`
- **Branch/ref:** `feat/r12-qa-fixes`
- **Exact repository-root path:** `UX_STRATEGY.md` (case-sensitive; **not** `research/r12/UX_STRATEGY.md`).
- **This orchestration prompt:** `research/r12/NEON_UX_IMPLEMENTATION_PROMPT.md` on the same branch.
- **GitHub MCP/plugin action:** use the connected GitHub **fetch file / get file contents** action. If named `mcp__GitHub__fetch_file`, call it with `repository_full_name="kingdomfishers/BibleResearch"`, `path="UX_STRATEGY.md"`, `ref="feat/r12-qa-fixes"`. Retrieve the actual remote contents; do not rely on a stale local copy or a search snippet.
- If the plugin names differ, discover the equivalent connected GitHub repository-file read action and use those **exact three values**. Only fall back to GitHub repository search if direct file retrieval fails. Do not invent a different location.
- Inspect the **actual local folder, package.json, current branch, git status and worktrees** before doing any code work. Local workspace remains authoritative for implementation, but use the fetched GitHub UX strategy as the current **technical requirements reference**. If the remote strategy differs from the local file, use remote text for the brief and reconcile safely; **never overwrite a locally modified file** or reset/pull over another agent's changes.
- Read only the relevant parts of UX_STRATEGY.md as you work, especially §§2–8 for the approved workspace, reader, inspector, graph and comparison, plus §§11–13 for integration and acceptance; avoid passing the entire long document to every cheap subagent. Its technical algorithms and factual constraints are guidance, **not final approval of a visual layout**.

**Do not open, cite, copy, imitate or build from any UI mockup images, screenshots, SVG concepts or design references**, including `design/ux-mockups/2026-11-21/`. They do **not** represent my chosen design. Start from the actual current website and develop the design interactively with me; do not introduce alternative visual references unless I specifically request them. My live feedback supersedes assumptions in the strategy.

## 2. Live preview — exactly how we collaborate

**Use the existing development server and my local browser.** Do not deploy a preview, share a preview link, or produce design screenshots/videos.

1. From the real local project root (the folder containing `package.json`), inspect `package.json` to confirm the dev script, then run **`npm run dev`**. If a working Vite development server is already running on the intended workspace, **reuse it** rather than start a competing server. On Windows, use the appropriate npm executable if needed.
2. Keep the terminal development process alive **while working and during each feedback pause**; do not block the rest of implementation on the foreground process. Use the IDE's terminal/background task workflow that keeps it alive across interactions.
3. Make code changes directly in the local checkout served by that process. Rely on **Vite hot-module reload** for instant updates. When a change requires a restart, restart that same local dev task and verify it is serving the edited files; do not let me watch an obsolete worktree or another branch.
4. After each small iteration, confirm dev build/HMR has updated the existing preview. You may use browser/Playwright tooling internally to validate an interaction **without capturing or supplying screenshots or videos**. Avoid opening a second inaccessible preview environment.
5. **Do not send screenshots, screen recordings, generated mockups, image files, external visual references, or localhost/preview URLs.** I will look at the running localhost page myself in my own browser; simply tell me which visible part of the page changed and what to try.
6. Do not publish/deploy to shared Cloudflare Workers, Pages, Supabase or production services while we are co-designing; get my **explicit approval** before any merge or shared deployment. Continuing to edit locally in the approved workspace does not require repeated permission.
7. If the local server cannot be started or kept alive, report the exact error and smallest recovery action. Do not falsely claim I can see changes or replace the live workflow with images.

**The preview itself is our design discussion.** The page changes on localhost as you edit. Ask about what I can actually see, not hypothetical visuals or mockups.

## 3. Product mission and fixed functional priorities

Build an evidence-first Biblical research workspace using the existing components and relationship APIs.

**Priority 1: relationship exploration.** Start at a word, verse, entity or concept; see high-value distinct connections; read actual supporting verses; follow, branch, reverse, return to earlier forks, pin, compare, and add personal hypotheses without losing reading/scroll state.

Other required capabilities, introduced when needed and shaped together:
- A **compact fixed top research trail** (not a left-hand history accordion).
- Scripture reading that seamlessly switches **verse ↔ context ↔ whole chapter**.
- In the reader **without hover or click**: original Hebrew/Greek script, readable transliteration, current English gloss, a few different sourced English meanings and a short documented root where available. Actual WEB English text remains plainly readable; interlinear glosses are not WEB prose.
- Hover/focus over a word adds detailed lemma, etymology, grammar and valuable evidence; hover/focus over a reference gives the **complete verse**.
- **Word Focus** shows meaning, root/etymology, 4–6 diverse high-value connections and most useful occurrences first. Raw Strong's IDs, gematria, repetitive counts and technical metadata remain accessible but subordinate.
- Two full passages visible simultaneously in **A/B comparison**, with source-grounded lexical/grammar highlights; drag a verse/word to a compare edge **after we agree on placement and behavior**, with equivalent keyboard/touch buttons.
- Context tools (places/maps, people/families, feast calendars, historical images, object/temple diagrams, structural/chiasm exploration) are **modular, later, and selected with me** rather than all built upfront.
- Notes and `Connect to…` open small, easy editors scoped to selected word occurrence, lemma, verse, or edge, with existing authorization and explicit saving.

Keep source identity, edition/homographs, exact verse evidence, relationship classifications and uncertainty intact. Use existing `VerseReader`, `ContextPreview`, `DiscoverConnections`, `ExploreConnectionsPanel`, `WordInspector`, `PassageComparison`, `BibleRPC` and the corpus API. Do **not** rebuild the relationship engine or retune its ranking as part of this UI exercise.

## 4. First task — a tiny, visible working draft, not a whole redesign

**No AI-generated theological interpretations:** show only algorithmic relationship types, inspectable Scripture evidence and source-aware uncertainty; let the user infer significance. **Chapter view is continuous English only**, switching back to a verse restores rich interlinear.

**Build immediately; do not begin by interviewing me or producing design plans.**

On the current localhost site, make the smallest usable demonstration of:

1. A compact, fixed **top discovery trail** and Back/Fork action; clicking a graph node changes focus, hovering previews it and clicking an edge inspects its witnesses.
2. The existing reader showing one actual verse with enough original script, transliteration and inline English alternatives to evaluate **reading density**.
3. **Three to six real discovery suggestions** with inspectable evidence; follow one and return to the fork.
4. A simple persistent evidence/word-details area or minimal drawer — whichever reuses most of the current code. **Treat its layout as provisional; I will decide after using it.**
5. Keep an obvious way to pin the source verse and compare it with another verse; no sophisticated drag, charts, maps or polish yet.

Use real available data and honest unavailable states. Work in a single small slice; do not chase all features before I can evaluate the first page. Keep code minimal and the running preview current. Existing layout may be reused temporarily; do not silently assume it is the intended final composition.

Once the first draft is working in localhost:

- Say **exactly what changed** in the page and one short example path to try, such as Genesis 2:7 → *adam* → *adamah* → Back.
- Ask **2–4 short, specific questions based on the UI I am viewing**, such as where the evidence should go or whether the inline meanings should be denser.
- For consequential choices, name two feasible options and your recommendation, but **do not choose for me**.
- **Stop and wait** for my answers. Do not move to the next visual-design milestone or continue refactoring while waiting.

## 5. Repeatable co-design cycle — every change visible

For each next iteration:

1. **Listen and reflect:** Take my latest feedback as the design direction. Restate the next tiny change in one sentence. If I reject an approach, abandon/revert it rather than defend it.
2. **Implement narrowly:** Edit the live local files. Use low-cost subagents only for independent bounded tasks; avoid a large orchestrator discussion for a small CSS/component fix. Keep approved behavior intact.
3. **Check cheaply:** Confirm hot reload (or the necessary same-server restart), run a small targeted test/type check if relevant, and keep the visible page usable. Do not run the full discovery benchmark or repeated whole-project tests for every draft tweak.
4. **Hand me control:** Report the changed element and exact interaction to try on localhost, plus any real limitation. **No screenshots, video, links or mockups.**
5. **Ask 1–3 focused follow-up questions**, then wait. I can request an alternative, reorder priorities, ask for a different component, or finish.
6. Record only accepted high-impact decisions in `research/r12/UX_DECISIONS.md` (choice, rationale, affected files/status). Keep changes reversible. A local commit is a development checkpoint, not deployment authorization.

**Avoid excessive process overhead:** for an obvious small change, implement and let me react rather than requiring formal sign-off on every button. But never decide foundational layouts/information hierarchy, prematurely polish, or move through an entire phase while I am reviewing.

## 6. What we decide together, one decision at a time

Recommended order, **subject to my feedback**:

1. **Relationship discovery flow:** can I see and follow interesting connections immediately, return to forks, and inspect the evidence?
2. **Spatial layout:** how much width should Scripture receive versus relationship suggestions/inspector? Does the top trail fit naturally?
3. **Interlinear density and word inspector:** which meanings/roots belong immediately in reading view; what is genuinely useful on word selection?
4. **Comparison:** A/B arrangement, chapter expansion, matching colors, pin/drag/drop zones and accessibility.
5. **Graph and quick notes:** where graph adds understanding beyond cards; how easy it feels to add a personal connection.
6. **Only then selected contextual modules** (maps, genealogy, feasts, images, patterns) and final polish.

Each is a potential checkpoint, **not an automatic queue** to execute without my decision. I may change the order or scope at any time.

## 7. Efficiency, safety and final release

- Start in the correct actual local folder and reuse the running dev server. Keep the **browser preview live across iterations**. GitHub is used to read reference instructions and eventually commit code, **not** to host visual previews.
- Respect `AGENTS.md`, keep `TASKS.md` the only official task queue, inspect Git status, preserve other agents' files and branches, and separate UI ownership from concurrent algorithm/MCP work. No destructive SQL, new paid resources or security-policy changes.
- Keep replies short and concrete; prefer one working interaction over a large written plan or dozens of design proposals.
- Keep user-created notes private to existing auth/permissions. Never write notes without explicit user action.
- When I say the UI is ready, run the agreed focused Playwright/regression, build and performance checks, show any remaining issues **in text**, and ask before merge or shared deployment.
- **Do not imply work continues in the background after a feedback checkpoint.** Stop at the checkpoint and resume when I respond.

## Format after each visible local iteration

**Changed on localhost:** one or two concrete sentences.

**Try:** exact UI interaction to test in the existing running page.

**Choose:** up to three short decisions (with brief trade-offs) that materially affect the next version.

**Then wait for my response.**

**START NOW: retrieve the GitHub UX_STRATEGY.md using the precise repo/branch/path above, inspect the current local project, run or reuse `npm run dev`, implement the smallest real relationship-discovery draft, and pause after I can see it locally.**
