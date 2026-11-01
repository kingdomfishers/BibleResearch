name: pre-code
description: Mandatory pre-coding protocol. Execute BEFORE creating or editing any file in src/ or supabase/. Handles [USER-CHECK] closure, feature decomposition into TASKS.md, progressive context loading, DRY candidate planning, and targeted @section reading.

SKILL: PRE-CODE PROTOCOL (pre-code)

0. PENDING [USER-CHECK] CLOSURE & FEATURE INTAKE

Read TASKS.md first:

If the user is confirming a pending [-] [USER-CHECK] task (e.g., "yes", "works"):

Mark that [-] task as [x] in TASKS.md.

Run git add -A && git commit -m "feat(<ID>): <short title>" to lock in the working checkpoint.

Lock the next sequential [ ] task as [-] and proceed to Step 1.

If the user's request already exists as an open [ ] task:

Lock it as [-] and proceed directly to Step 1 silently.

If the request is NEW, vague, or complex (not yet in TASKS.md):

Ambiguity & Design Check: Check ARCHITECTURE.md. If important UX/product choices, Hebrew/Greek display rules, or SQL RPC parameters are undefined, STOP and ask the user concise questions before writing tasks.

Spec Sync: Once clear, append any new product rules or user flows to ARCHITECTURE.md.

Atomic Decomposition: Break the feature into sequential sub-tasks in TASKS.md (1–2 file edits each):

Step A (Database & RPC): supabase/migrations/001_schema.sql, 002_rpc_prompts.sql, & src/api/types.ts + src/api/rpc.ts (if needed).

Step B (State & Logic): @section:types & @section:logic:<name> in src/ui/state.ts or component files.

Step C (UI & DOM Wiring): @section:ui:<name> in src/ui/components/<Name>.ts, src/ui/styles.css, & src/main.ts.

Assign Verification Track ([AUTO-TEST] vs [USER-CHECK]):

Verify: [AUTO-TEST] <description> -> PostgreSQL RPC queries, GIN index lookups, RLS policies (verified via supabase MCP or npm run test:run <filepath>), and pure state/type contracts.

Verify: [USER-CHECK] <description> -> Visual UI, RTL/LTR verse rendering, word popup <dialog> modal, and browser interactions (optionally pre-checked with playwright / chrome-devtools MCP before asking the user).

Format: - [ ] **<ID> <Short Title>** | Files: <target files> | Verify: <[AUTO-TEST] or [USER-CHECK]> <outcome>

Complexity Gate:

Simple Feature (<= 3 sub-tasks, no DB schema/Architecture changes): Lock ONLY the first [ ] sub-task as [-] and proceed immediately to Step 1.

Complex Feature (> 3 sub-tasks OR requires DB schema / ARCHITECTURE.md changes): Explain the plan simply, highlight SQL/architectural changes, and wait for user approval before coding.

1. CONTEXT ROUTING (Load Selectively for the Active [-] Task)

Read ONLY the relevant section in ARCHITECTURE.md.

If touching data or prompts, inspect supabase/migrations/001_schema.sql and supabase/migrations/002_rpc_prompts.sql (and verify live schema/RPCs via supabase MCP on project ejoperxiwxlcbsqrkrvb).

If using unfamiliar APIs, query context7 MCP before writing code.

2. PREDICTIVE DRY & CANDIDATE PLANNING (PROJECTMAP.md)

Read PROJECTMAP.md and classify every DOM helper, RPC wrapper, or UI sub-block needed for this task:

Match in Active Shared (src/api/, src/ui/state.ts, or src/ui/utils.ts) or Reusable Test Scripts:

Plan: Import/reuse directly during coding.

Match in Reusable Candidates (Currently inside another component's @section):

Plan (Promote During Coding Phase):
a. Locate @section: lines (grep -n "@section:" <source-filepath> or Select-String -Path <source-filepath> -Pattern "@section:") and read ONLY that candidate's @section.
b. During your coding step, extract it to src/ui/utils.ts or src/ui/components/<Name>.ts, update the original file to import it (updating its @toc and @candidates in-place), and use it in the new file. (PROJECTMAP.md will be updated once in post-code).

Net-New Element (1st Use, Potentially Reusable Later):

Plan (Co-locate & Tag): Build it inside the current file under a dedicated @section:ui:<name> or @section:logic:<name> block, and add <name> to the file's @candidates and @toc header during your edit.

3. SURGICAL FILE & SECTION TARGETING

Modifying Existing .ts Files:

Read lines 1–6 (head -n 6 <filepath> or Get-Content <filepath> -TotalCount 6) to inspect @toc, @tables, and @candidates.

Locate section lines (grep -n "@section:" <filepath> or Select-String -Path <filepath> -Pattern "@section:") to get exact line bounds.

Read and edit ONLY the target @section line range. Always update the file's top 6-line manifest (@toc, @tables, @candidates) in the same edit whenever adding, renaming, or promoting sections.