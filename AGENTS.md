# AGENTS.md — Operational Contract

## 1. STACK & COMMANDS
* **Stack:** Vite (Vanilla TypeScript + CSS Variables), Supabase PostgreSQL (100% Database-Native RPCs via `src/api/rpc.ts`).
* **Dev Server:** `npm run dev`
* **Build & Typecheck:** `npm run check:types` (`tsc --noEmit`) | `npm run build`
* **Size & @toc Sync Check:** `npm run check:size` (Enforces max 450 lines/file, max 80 lines/section, and exact `@toc` match)
* **Run Specific Test Script:** `npm run test:run <filepath>`
* **Inspect File Header/TOC (Lines 1-6):** Read lines 1–6 (`head -n 6 <filepath>` or PowerShell `Get-Content <filepath> -TotalCount 6`)
* **Locate Section Lines:** Search for `@section:` (`grep -n "@section:" <filepath>` or `Select-String -Path <filepath> -Pattern "@section:"`)
* **MCPs:**
  * `supabase` (`project_ref=ejoperxiwxlcbsqrkrvb`): Inspect DB schemas, execute/verify SQL migrations, test RPC functions, and check RLS policies.
  * `context7`: Live library and PostgREST/Supabase documentation.
  * `playwright` & `chrome-devtools`: Automated browser verification and DOM/network inspection.

---

## 2. MANDATORY SKILL PIPELINE
NEVER write or edit code in `src/` or `supabase/` without executing these skills in order:
1. **PRE-CODE:** Read & execute `.agents/skills/pre-code/SKILL.md`.
2. **POST-CODE:** Read & execute `.agents/skills/post-code/SKILL.md`.

---

## 3. PROGRESSIVE CONTEXT ROUTER (Load Only On-Demand)
* `TASKS.md` -> Active task queue (`[ ]` Open, `[-]` In Progress, `[x]` Done). Execute ONE atomic task at a time.
* `PROJECTMAP.md` -> Active Shared modules, Reusable Candidates, Test Scripts, and UI/RPC Index.
* `ARCHITECTURE.md` -> System blueprint, Supabase RPC contracts, UI component layout, and AI Plugin OpenAPI rules.
* `supabase/migrations/001_schema.sql` -> Canonical `words` and `verses` tables, GIN indexes, and RLS policies.
* `supabase/migrations/002_rpc_prompts.sql` -> Canonical PostgreSQL RPC functions (`prompt_verse_words`, `prompt_word_occurrences`, `prompt_word_cooccurrences`, `prompt_word_relationships`).

---

## 4. ARCHITECTURE & FOLDER LAWS
* **SQL-First Compute Law:** All array intersections (`@>`), word-order unnesting, co-occurrence hydration, and proximity scoring MUST happen inside PostgreSQL RPCs (`supabase/migrations/002_rpc_prompts.sql`). Never compute joins or full-table filters in browser JavaScript.
* `src/api/supabase.ts` -> Single Supabase client initialization. The ONLY file allowed to import `@supabase/supabase-js`.
* `src/api/rpc.ts` -> Single Database Gateway (`BibleRPC`). UI components MUST call `BibleRPC.<method>()` and NEVER import `supabase.ts` or `@supabase/supabase-js` directly.
* `src/api/types.ts` -> Canonical TypeScript interfaces matching PostgreSQL tables and RPC return signatures.
* `src/ui/state.ts` -> Lightweight URL-hash synchronized state (`#book-chapter-verse`). Zero external state libraries.
* `src/ui/components/<Name>.ts` -> Focused, modular DOM components (`NavSelector.ts`, `VerseReader.ts`, `WordModal.ts`, max 450 lines/file, max 80 lines per `@section`). Components communicate via `appState` or explicit callback props—never by mutating another component's DOM directly.
* `src/main.ts` -> Top-level application shell that mounts components and wires state transitions.

---

## 5. FILE ANATOMY (6-LINE MANIFEST & ANCHORS)
Every `.ts` file in `src/` MUST begin with this exact 6-line manifest and use matching `@section` anchors. Update `@tables`, `@candidates`, and `@toc` during every file edit:

```typescript
// @file: <relative-filepath>
// @feature: <api | state | nav-selector | verse-reader | word-modal | app-shell>
// @tables: <words | verses | none>
// @candidates: <section-names of reusable candidates in this file | none>
// @toc: imports | types | logic:<name> | ui:<name> | ui:main

// === @section:imports ===
// === @section:types ===
// === @section:logic:<name> ===
// === @section:ui:<name> ===
// === @section:ui:main ===