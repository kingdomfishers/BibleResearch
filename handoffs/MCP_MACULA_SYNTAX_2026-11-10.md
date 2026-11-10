# Macula syntax research MCP deployment — 2026-11-10

LIVE Supabase Edge Function `bible-mcp`: deployment version **22**, workflow version **1.7.0**. Existing custom MCP endpoint is unchanged. **28 tools / 20 prompts**; existing accountless note functions and `add_research_note` remain enabled. Full source of changed modules is in this handoff branch. Local `C:\Projects\BibleResearch` remains authoritative; this GitHub branch does not modify your local checkout or `main`.

## New capabilities
- `get_verse_hydrated` (existing tool, enriched): `include_syntax` defaults true; `syntax_edition` allows WLC, Nestle1904 or SBLGNT. The new `macula_syntax` key returns a **bounded** syntax graph (240 nodes / 400 edges max) with explicit completeness flags; all previous lexical, top-seven, note, chronology, geography, and spelling-candidate data remains.
- New MCP read tool `research_macula_syntax(book,chapter,verse,edition_key?,word_position?)`: up to 2500 nodes / 3000 edges, exact source role tags, clause and phrase constituents, parent-child and derived subject/object/predicate relations, word-position spans, cross-verse data and optional focus nodes. Returns explicit partial-truncation flags if source graph exceeds caps.
- New MCP prompt `study_macula_syntax(subject)` and routing through `get_research_prompt(name: study_macula_syntax)`. Distinguishes grammatical subject/object from semantic agent/patient.
- The existing `get_syntax_tree` remains supported. Its description now accurately states source semantic-frame annotations are not currently public.

## Licensing and epistemic boundary
Macula Hebrew `frame` is marked `disabled_unverified` in `field_license_registry`. Macula Greek `frame` is marked enabled in the registry, but live Cloudflare security middleware redacts `frame`/`semantic_frame` in public responses. The new tool does **not** bypass that restriction or manufacture semantic A0/A1 roles. `semantics.status = not_publicly_available` until source-level license and release verification is completed. Present grammatical `syntactic_role` as such, never as known semantic agent/patient.

## Tests (real live MCP transport)
- `/health`: HTTP 200, workflow 1.7.0, tools 28, prompts 20.
- `tools/list`: `research_macula_syntax`, `get_verse_hydrated`, `add_research_note` all present.
- `prompts/list`: `study_macula_syntax` present.
- `research_macula_syntax` Genesis 1:1: 1 tree, 19 nodes, 18 edges, 4 role spans, focus position 2 matched 3 nodes, no forbidden semantic fields exposed.
- `research_macula_syntax` John 1:1 (Nestle1904): 1 tree, 30 nodes, 29 edges, 9 role spans; no forbidden semantic frames exposed.
- `get_verse_hydrated` Genesis 1:1 with syntax enabled: status ok, macula_syntax.has_syntax true. With `include_syntax=false`: `not_requested`.
- Incorrect Hebrew/Greek edition combination: `invalid_edition_for_testament`.
- No notes or corpus data modified; no Cloudflare Worker redeploy; B7 canaries remain independent and may still FAIL due to stale static shards.

## Outstanding risk and future development
1. The Macula syntax read RPC still retrieves evidence from the Cloudflare corpus Worker; prior B7 asset mapping defects may remain until a verified corpus rebuild. Do not infer that complete source-to-STEP word mapping is proven.
2. More detailed Greek semantic frames, referent/subjref fields should be reviewed separately for legal exposure, provenance, and accuracy before adding public role data. Hebrew frame license remains unverified.
3. Source `mcp` source in local workspace can differ; inspect `git status`, merge changes carefully and verify with local tests. Do not merge this branch blindly into `main`.
4. Endpoint tool lists can be cached: reconnect/refresh the client to see the new tool and prompt.
