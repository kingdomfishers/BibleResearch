# BibleResearch tool contracts

The remote endpoint is
`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`.
It is public and read-only; no project secret or reader login is required.

Canonical book IDs are 1-66: Genesis=1, Psalms=19, Matthew=40, John=43,
Revelation=66. Verse 0 is a retained Psalm heading. English glosses are source
renderings, not a continuous Bible translation. Respect the primary STEP
Hebrew/Aramaic OT and NA28-membership Greek NT corpus; other editions require
an explicit source rather than assumed equivalence.

Hydration arguments use this structure:

```json
{
  "profile": "analysis",
  "p_request": {
    "passages": [
      { "book": 38, "chapter": 4, "start_verse": 1, "end_verse": 14 }
    ]
  }
}
```

`profile` is an MCP delivery preset, not an RPC parameter. Omitted profile
retains `full`. `analysis` supplies sample mode with five references only when
occurrences is omitted and allows up to 100 verses in a single round-trip. Explicit
`p_request.occurrences` wins, including all references or a sample limit of 1-100.
Requested verse tokens remain fully hydrated in both modes. Default full behavior
and REST contracts are unchanged.

The hydration result is a direct packet, not a rows envelope. Check `status`,
`coverage`, `verses[].coverage`, component statuses, and evidence cursors. To minimize
payload size, repetitive metadata (`chronology`, `geography`, and `semantic_evidence`)
is hoisted to top-level dictionaries keyed by verse reference string (`"{book}:{chapter}:{verse}"`),
reducing packet size by ~60–70%. Each word includes structured server-decoded grammar
(`decoded_grammar`) with part of speech, stem, aspect, gender, number, and state.
Each word's `lexical_entry_key` refers to `lexical_entries`, where all polysemous
candidate lexemes and homographs are preserved. Never treat homographs as separate concepts:
treat them as a unified study object and show their different meanings across different verses.
Setting `version: 2` on `get_verse_research` activates set-based lexical formation hydration:
it returns `lexical_formations` deduplicated by `disambiguated_lemma_key` (including components,
documented roots, root relatives, and literary connections) and separates token morphology
from lexical composition.

Word formation tools:
- `inspect_word_formation(p_query, p_word_id?)`: Returns verified lexical formations, constituent components, documented roots, root relatives, and literary connections.
- `suggest_word_connections(p_query, p_limit?, p_min_chars?)`: Returns exploratory consonantal candidate words. Never cite these as proven etymologies or shared roots.

Legacy database tools return `source`, `rows`, and `page`. Word IDs are real
positive database IDs, not Strong's numeric suffixes. `get_verse_chronology_v1`
uses p_book/p_chapter/p_verse and optional published model ID. Its run IDs are
decimal strings as returned in the packet, not UUIDs. `research_relationships`
uses `subject`, optional `target`, and `mode` (explain/discover).

`get_research_prompt` accepts `subject` and optional `name` (default study_bible).
Its structured `workflow` metadata identifies starting tools and analysis/full
presets; the instructions govern the research procedure, not the source text.

An explicit packet error is not evidence that a passage or relationship does
not exist. `packet_limit_exceeded` means request fewer passages or ask whether
a sample is acceptable when the reader requires completeness. Transport errors
mean unavailable data. Private reader translations are excluded from public
research packets. Client tool visibility can lag a deployment; compare the
client's list with live discovery and refresh the connection when necessary.

## Notes tools contracts

Existing user-generated notes (human and AI) provide study commentary alongside corpus evidence. All note tools carry epistemic notices and untrusted data markers.

### Read tools
- `get_notes`: Retrieves notes by passage (`book`, `chapter`, `verse_start`, `verse_end?`), word target (`word_id`, `verse_id?`, `word_position?`), or direct note ID (`note_id`). Returns `{ epistemic_layer: 'user_note', notice, untrusted_notes: { ... } }`. Note bodies > 4,000 chars are truncated in list mode with `truncated: true`; full text is available via `note_id`.
- `search_note_targets`: Searches autocomplete candidates across passages, Strong's numbers, lemmas, concepts, and places (`query`, optional `kinds`, `limit` up to 50).
- `list_note_connection_types`: Returns allowed connection types (e.g. `linguistic_wordplay`, `thematic_parallel`) with categories and default directions, plus registered `note_kinds`.

### Write tools
When configured on the server, AI agents can author and maintain study notes:
- `create_note`: Creates a new note.
  - Inputs: `title?`, `body_md` (1-20,000 chars), `note_kind` (enum: `observation`, `historical_context`, `literary_structure`, `word_play`, `cross_reference`, `translation_note`, `theological`), `language?` (default `'en'`), `confidence?` (0.0 to 1.0), `anchors` (1 to 20 objects with unique `client_key`s), `connections?` (up to 20 objects linking `client_key`s), `blocks?` (up to 10 structured link/image blocks), `source_context?` (up to 8 KB object with evidence citations), `model?` (self-reported identifier).
  - Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: false`.
- `update_my_note`: Updates an existing note authored by the calling agent.
  - Inputs: `note_id` (UUID), `expected_version` (integer optimistic lock), plus note fields as in `create_note`.
  - Annotations: `readOnlyHint: false`, `destructiveHint: false`.
- `delete_my_note`: Soft-deletes a note authored by the calling agent.
  - Inputs: `note_id` (UUID), optional `model`.
  - Annotations: `readOnlyHint: false`, `destructiveHint: true`.

### Authentication and safety
- If `NOTES_AGENT_KEY` is set on the server, write tools require `Authorization: Bearer <key>`. Missing or invalid tokens return an MCP tool error while read tools continue operating without authentication. If unset, single-user mode allows writes.
- Write operations enforce author ownership: agents can only update or delete their own notes (`forbidden` error on mismatch). Kill switch (`writes_disabled`) and rate limits (`rate_limited`) are enforced by the database.
