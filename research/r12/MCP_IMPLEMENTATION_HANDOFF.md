# MCP v2 Implementation Handoff (R12-MCP)

Date: 2026-11-20. Branch: `feat/r12-qa-fixes`. Strategy: `research/r12/MCP_STRATEGY.md`.

## Releases and rollback

| Component | Live | Rollback |
| --- | --- | --- |
| `bible-mcp` Edge Function (Supabase `ejoperxiwxlcbsqrkrvb`) | **v46**, `ezbr_sha256 fdda29cf5f7623372a9ca1e3f4c9f2b9655d7f358c97b6ff3ea10f9d9e7d4f0e` (v45 = first v2 deploy) | v44 (`7560b097…fac71`) |
| `bibleresearch-corpus` Cloudflare Worker | `e96253fd-4144-4869-a54b-72d5931c6ab6` | `cce819e9-60d4-4e17-bb01-ed138af9a9a3` |
| Migration | `20261120000000_mcp_connection_chains.sql` (additive; RLS on; no anon/authenticated/PUBLIC grants; verified) | table is unused by legacy |

- Primary (7 tools + prompt `bible_research`): `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`
- Legacy (46 tools, 22 prompts, unchanged behavior): `.../bible-mcp/legacy/mcp`, health `.../legacy/health`.
- ChatGPT/Gemini connectors must be **Refreshed** to see the new tool list.

## What changed

- `supabase/functions/bible-mcp/`: new `discovery-v2-tools.ts` (7 tools), `word-model.ts` (shared `CompactWord`/`CompactConnection`, scoped geography, competing chronology models, etymology separated from spelling suggestions), `research-engine.ts` (declarative allowlisted ops, no code execution), `bible-ref.ts` (66-book parser, cross-chapter ranges, `Ps 45:0`), `gematria.ts` (explicit-method), `chain-store.ts` (private chains: capability token, hashed token/session, 24h TTL, size caps, service key used only here); `index.ts` routes `/mcp` → v2, `/legacy/mcp` → old surface; `notes-write.ts`/`dlm-notes.ts` export helpers reused by `write_Note` (permissions, `NOTES_AGENT_KEY`, ownership, DLM validation unchanged).
- Cloudflare Worker (`scripts/corpus-worker.mjs`, `corpus-relationships-rpc.mjs`): read-only RPCs `get_passage_compact_v1`, `get_word_profiles_batch_v1`, `resolve_fast_lookup_v1`. No new static assets, no `/v1/chapters/` opens (CPU-safe).
- Skill/plugin docs bumped to 2.0.0 (`skills/bible-research`, `integrations/*`). Test helper `scripts/mcp-deno-loader.mjs`.

## Verification actually run

Local: `check:types`, `build`, `verify-bible-mcp-local` (legacy), `verify-mcp-v2-local` (surface split 7/6 and 46/41, health, parser/gematria values, strict `get_prompt`, unknown research op rejected, bad chain token rejected, `write_Note` refused without valid key, service key never in output), `verify-research-workflow`, `verify-r12-smoke`.
Not run to a confirmed result: `verify-r12-algorithm-v2`, `node --test research/r12`.

Live (`node scripts/verify-mcp-v2-live.mjs`, raw output in `.artifacts-r12/mcp-v2-live/`, untracked): all 7 tools respond; chain start/follow/inspect work across stateless HTTP calls, tampered token rejected; invalid DLM rejected. Worker: `/health` 200, `/__integrity/b7` PASS_CANARIES, `metadata.json.gz` 403, no 503 on 26–28 verse ranges.

Observed discoveries: Gen 6:14↔Exod 2:3 (xref + shared `תֵּבָה` H8392, 25v); Zech 4 ↔ Rev 5:6 (tier-1 explicit identification), Rev 11:4 (two olive trees; menorah↔λυχνία bridge with Exod 25:31); Ruach resolves to H7307 (348v) first with H7304/H7305/H7308 as ambiguous candidates and gematria 214; 1 Cor 12:10-13:4 geography: Corinth `audience_location`, Ephesus `composition_location`.

Tuning done after first live run: per-verse connections shortened (witness dropped, `why` ≤100 chars); thematic-cluster "Prophetic Imagery & Oracles" comparisons filtered (generic noise on Gen/Zech/Ezek).

## Known gaps

- **Size/latency:** a chapter-size `get_Passage` is still ~137–268 KB (≈63–124 KB of payload, duplicated in `content` and `structuredContent`); the per-verse `words` table dominates. Cold calls took 6–14 s, warm 2–3.5 s. Use `limit`/`offset` and `depth` to shrink.
- Not tested live with real data: `get_Passage` with `word_depth`/`etymology`/`realworld` variants, branch/revisit chain actions, `NOTES_AGENT_KEY` valid-key writes. Local v2 tests are surface/guard level only.
- Some low-value connections remain (e.g. Ruach↔Zech 4 returns `שֵׁנָה→ὕπνος` LXX bridge; Gen 6:14 passage-level surfaces `קֵן` "nest" LXX bridge).
- `/health` reports `authentication: none` with writes enabled; write protection relies on the existing `NOTES_AGENT_KEY` check (pre-existing design).
- Known corpus gap: `kopher` (H3724) lacks root-link data, so no documented root is returned for it. Era gazetteer entries are intentionally never shown as passage locations.
- The first `research` live call used a wrong argument shape and was rejected by schema (the script is fixed); only gematria + query ops were exercised live.

## How ChatGPT should independently test

1. `get_prompt {}` → guidelines text; `get_prompt {"x":1}` must be rejected.
2. `get_Passage {"passage":"Genesis 6:14"}`, then `{"passage":"Zechariah 4","depth":3,"word_depth":2}`, `{"passage":"1COR12:10-1COR13:4","realworld":1}`, `{"passage":"Ps 45:0"}`, `{"passage":"Ezekiel 1","limit":10,"offset":10}`. Check: English present, transliterations/glosses readable, lexicon not repeated per verse, geography only from `locations`.
3. `get_Word {"word":"Ruach"}`, `{"word":"kaphar","etymology":3}`, `{"word":"tevah","passage":"Genesis 6:14"}`. Check H7307/H3722/H8392 primary, ambiguity listed separately, etymology only documented, gematria states method.
4. `get_Connection {"items":["Genesis 6:14","Exodus 2:3"]}`, `["Ruach","Zechariah 4"]`, `["Zechariah 4","Revelation 11"]`; verify every claim has refs you can read with `get_Passage`.
5. `follow_connectionchain {"next":"Zechariah 4"}` → keep `chain`; then `{"chain":"…","next":"Revelation 11"}`, `{"chain":"…","action":"inspect"}`; a modified handle must fail; visited nodes shouldn't reappear.
6. `research {"query":"ruach"}` and `{"operations":[{"op":"gematria","terms":["רוּחַ","אָדָם"],"find_matches":true,"limit":5}]}`; combine ops (`occurrences` + `set_combine`); unknown ops must be rejected.
7. `write_Note`: only test in a scratch scenario with a valid key; invalid DLM payloads must be rejected and nothing is written without authorization.
