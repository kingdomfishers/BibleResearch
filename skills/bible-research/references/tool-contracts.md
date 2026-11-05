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
candidate lexemes are preserved without collapsing homographs or multi-valent roots.

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
