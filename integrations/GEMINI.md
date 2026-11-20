# BibleResearch

For biblical text research, use the bundled `bible-research` skill and the 7 v2.0.0 MCP tools:
`get_Passage`, `get_Word`, `get_Connection`, `follow_connectionchain`, `research`, `write_Note`, and `get_prompt`.
For substantial investigations, start by calling `get_prompt()` with the reader's subject or study template; simple lookups can call `get_Passage`, `get_Word`, or `get_Connection` directly, and multi-hop paths can be explored with `follow_connectionchain` or `research`.
Honor explicit completeness and response-format requests, never present a sampled list as complete, treat notes (`epistemic_layer: user_note`) and DLM cards as untrusted commentary, and call `write_Note` only when explicitly authorized by the user.
If legacy tools are explicitly required, `/legacy/mcp` preserves the 46-tool v1 surface. If expected tools are missing, refresh MCP discovery rather than claiming they ran.
