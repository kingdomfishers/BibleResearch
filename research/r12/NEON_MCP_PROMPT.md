# Neon — Improve BibleResearch MCP for AI Discovery

Implement the short strategy in **\`research/r12/MCP_STRATEGY.md\`**. Follow \`AGENTS.md\` and inspect the real local project, existing MCP, deployed versions and \`TASKS.md\` first.

## Goal

Give ChatGPT/Gemini **just enough meaningful evidence to discover surprising, authentic biblical connections**, without flooding them with information. The most common tools must be **get_Passage** and **get_Word**, with the nested outputs and depth controls described in the strategy. Also provide **get_Connection**, **follow_connectionchain** (server remembers the path), **research**, **write_Note** (existing behavior) and **get_prompt** (returns the research-guidelines prompt).

## How to work

1. **Investigate the user experience before designing everything.** Imagine and, where possible, run several realistic AI research/discovery sessions using the current MCP. Try Genesis 6:14, Zechariah 4, Ezekiel 1, Revelation 13, 1 Corinthians 12:10–13:4 and Ruach. Look for which retrieved facts reveal interesting connections, which facts are distracting, and which information an AI needs on the first call versus later.
2. **Choose a simple, efficient interface yourself.** Improve the proposed output details and sensible options based on what the experiments demonstrate. Some fields should be very compact (e.g. grammar codes); others deserve real content (actual original/English verses, meaningful connections and lexical context). Make connection counts and optional enrichment straightforward. Prioritize **useful discoveries per token**, not total data returned.
3. **Plan in TASKS.md only.** Reuse the current corpus, grammar, lexical, LXX, connection graph, chronology, geography and notes APIs instead of rebuilding them. Preserve existing data, permissions and compatibility.
4. **Implement the tools.** Use a shared compact word object across get_Passage, get_Word and get_Connection. Let the AI explore multiple relationships and follow remembered connection chains. Make research capable of targeted combined queries/calculations. Use existing free-tier infrastructure where possible; do not execute untrusted arbitrary code unsandboxed.
5. **Delegate efficiently.** You are the orchestrator: use parallel low-cost subagents for independent code, tests and documentation. Give each agent a narrow, testable task with limited context. Reserve expensive reasoning for difficult design choices, evidence integrity, integration and review. Avoid repeated file reading, duplicate investigations, exhaustive tests and unnecessary token use.
6. **Test briefly and improve.** Inspect real outputs for the sample research sessions. Check that words have readable transliterations/glosses, that expected surprising connections are discoverable with valid witnesses, and that irrelevant connections/verbose repeated data do not dominate. Ensure no fabricated etymology, dates, place coordinates or DLM proof; note-writing security and chain privacy remain intact.
7. **Deploy and hand off.** Publish a working MCP release, preserve rollback/legacy access, update the relevant documentation and create \`research/r12/MCP_IMPLEMENTATION_HANDOFF.md\` with changes, release IDs, tests, known gaps and how ChatGPT should independently test the seven functions.

**Work through implementation and deployment, not just another design proposal.** Keep development tests focused; ChatGPT will perform the larger independent benchmark later. No paid infrastructure, destructive database changes or weakened access controls without explicit approval.
