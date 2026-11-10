# BibleResearch MCP v1.6.0 handoff (2026-11-10)

LIVE SUPABASE EDGE FUNCTION DEPLOYED: `bible-mcp` version 20, Supabase project `ejoperxiwxlcbsqrkrvb`, JWT verification OFF (pre-existing no-account mode).

## New capabilities
- MCP tool `get_verse_hydrated(book,chapter,verse,include_notes?,include_spelling_candidates?)`: wraps existing server-side `get_verse_research_v2` for a single verse (7 sampled occurrence references per headword, 7 co-occurrence partners, documented roots and literary evidence) and enriches with up to 7 explicitly unverified same-letter candidates for each distinct Strong's entry (maximum 24), plus 15 bounded verse/word research notes, chronology, geography, and original token sequence. The created MCP prompt `get_verse_hydrated(subject)` guides correct use.
- MCP tool `add_research_note`: title, Markdown body, category, references by book/chapter/verse with optional word_position/word_id. Resolves source verse/word ID via live Supabase `get_verse_research_v2`; refuses invalid claimed word IDs; uses existing `agent_save_note_v1` writer, no new note schema or RPC.
- Existing `create_note`, `update_my_note`, `delete_my_note`, `get_notes`, and `get_verse_research` remain available.

## Live checks run
- GET function health: 200, version 1.6.0, 27 MCP tools, 19 prompts, writes enabled.
- `tools/list`: both new tools and existing `create_note` are advertised.
- `prompts/list`: `get_verse_hydrated` is advertised.
- `tools/call get_verse_hydrated` for Gen 1:1: HTTP 200, status ok, one verse, 6 distinct orthographic query groups, context included.
- `tools/call add_research_note` with incorrect Genesis 1:1 word identity: clean validation rejection (isError true), no note saved.
- A successful note INSERT via the new alias was NOT tested (avoid creating unsolicited data). Existing `create_note` backend / `agent_save_note_v1` is reused.

## Local/GitHub reconciliation
LOCAL `C:\Projects\BibleResearch` remains authoritative, and main is intentionally UNCHANGED. This branch captures the exact deployed live `supabase/functions/bible-mcp/` Edge Function source from v20. Integrate these changes into LOCAL source after reviewing `git status` and current local test results. DO NOT overwrite newer local changes or merge this branch blindly. Restart/refresh ChatGPT/Gemini MCP connection to see newly declared tool schemas; a running client can cache its previous list.

## Risks / limitations
- The user explicitly requires accountless note editing until account creation is implemented. Both anonymous and authenticated note write RPCs currently remain enabled; the MCP writer uses an existing server-side service key. This permits public abuse until authorization is installed. Do not revoke notes permissions unilaterally.
- The B7 Cloudflare static corpus canaries still FAIL until the corrected corpus assets are rebuilt and deployed. The hydrated verse function reads the live Supabase research V2 dataset, not those stale static assets.
- Cached lexical co-occurrence is a *statistical association*, orthographic candidates are *unverified spelling resemblance*, and documented etymology requires cited provenance. Geography and chronology can be unknown, symbolic, or disputed.
- MCP output repeats structuredContent and textContent as per the current framework. Further compact-packet optimization is desirable for long verses; verify runtime and costs before changing defaults.

## Local tests recommended
Run existing `scripts/verify-bible-mcp-local.mjs` plus dedicated tests for:
- Genesis 1:1, Psalm 3:0, John 1:1.
- 7 occurrence references and 7 co-occurrences; omissions identified.
- The same-letter disclaimer, missing evidence and truncation.
- Verse- and word-linked note creation, incorrect word rejection, and rollback-safe update semantics.
- Edge function CORS, disabled JWT and existing note writer behavior.
