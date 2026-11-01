name: post-code

description: Mandatory post-coding protocol. Execute AFTER completing all file edits for an atomic task. Handles batch type/size/@toc verification, PROJECTMAP.md & SQL migration sync, Two-Track Task Verification, and Git checkpoints.

SKILL: POST-CODE PROTOCOL (post-code)

1. AUTOMATED STATIC & @toc BATCH CHECKS (Run Once After All Task Edits)

Do not run checks mid-refactor. Once all edits (including in-place @toc, @tables, and @candidates header updates) for the active [-] task are complete, run:

npm run check:types

If errors occur: Fix the affected @section blocks first. (If the exact same error fails twice, STOP and ask the user).

npm run check:size (Validates 450-line file cap, 80-line @section cap, AND exact @toc header alignment across src/**/*.ts)

If @toc mismatch occurs: Update line 5 (// @toc: ...) of the flagged file to match its // === @section:... === anchors.

If a @section exceeds 80 lines: Split it into two logical @section:logic:<subname> or @section:ui:<subname> blocks inside the same file and update @toc.

If a file exceeds 450 lines: Extract the largest independent sub-workflow into a sibling file in src/ui/components/.

2. PROGRESSIVE DOC & DB SYNC (PROJECTMAP.md, supabase/migrations/, ARCHITECTURE.md)

Update ONLY the documentation and SQL files impacted by this task:

PROJECTMAP.md:

New File/Component Created: Add the file path, 1-line responsibility, and exported symbols under Module & Component Index.

New Reusable Candidate Created (1st Use): Add an entry under Reusable Candidates pointing to <filepath> (@section:<type>:<name>).

Candidate Promoted (2nd Use): Move it from Reusable Candidates to Active Shared.

New Reusable Test Script Created: Add the test file path or SQL verification query under Reusable Test Scripts.

supabase/migrations/001_schema.sql & 002_rpc_prompts.sql:

If the task created or altered Supabase tables, indexes, RLS policies, or RPC prompt functions, ensure the canonical SQL is saved in supabase/migrations/, applied to the remote DB via the supabase MCP, and mirrored in src/api/types.ts and src/api/rpc.ts.

ARCHITECTURE.md & supabase/openapi.json:

Update supabase/openapi.json if any RPC function signature changed. Only update ARCHITECTURE.md if a new global pattern was established (with user approval).

3. TWO-TRACK VERIFICATION, TASK CLOSURE & GIT CHECKPOINT (TASKS.md)

NEVER assume a task works without proof. Check the Verify: tag of the active [-] task in TASKS.md and follow its track:

Track A: If Task is [AUTO-TEST]

For Database / RPC Tasks: Execute the RPC function or schema check directly via the supabase MCP (execute_sql) against live data to verify exact output columns and performance.

For TypeScript Logic / Gateway Tasks: Check PROJECTMAP.md (Reusable Test Scripts) and run npm run test:run <test-filepath> (or npm run build for compile/bundle verification).

Once Passing:

Mark the task [x] in TASKS.md.

Run git add -A && git commit -m "feat(<ID>): <short title>" to save a clean Git checkpoint.

Proceed to the next sequential task (or report completion).

Track B: If Task is [USER-CHECK]

(Optional Agent Pre-Flight): If the dev server is running, you may use playwright or chrome-devtools MCP to sanity-check that the page renders without console errors.

Do NOT mark the task [x] or commit yet. Keep the task marked [-] in TASKS.md.

Output a short Manual Verification Request to the user in this exact format:

What Changed: 1-sentence summary.

How to Test (30 seconds):

<Exact URL/hash, e.g., http://localhost:3000/#1-1-1>

Prompt: "Does this work as expected? Reply 'yes' to close task <ID>, commit the checkpoint, and continue—or tell me what needs adjusting."

STOP and wait. (pre-code Step 0 will mark [x] and run the Git commit on the next turn once the user replies "yes").