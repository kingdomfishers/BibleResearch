# BibleResearch MCP — deployed on Supabase

The server is deployed as the `bible-mcp` Supabase Edge Function in project `ejoperxiwxlcbsqrkrvb`.
Deployment version 5 is active (server v1.3.0, 11 read-only tools, 16 prompts). You can connect now; no local server, additional host, or API-key entry is needed.

**Server URL — paste this into both assistants:**

```text
https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp
```

| Setting | Value |
| --- | --- |
| Name | BibleResearch |
| Description | Research the original Hebrew/Aramaic and Greek Bible using verse tokens, word occurrences, lexical associations and shared passages. |
| Transport | Streamable HTTP |
| Authentication | None / No authentication |
| Health check | https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/health |

This is a personal MCP connection. Public directory publication is a separate, optional process.

## Add to ChatGPT

1. Open ChatGPT on the web and go to **Plugins**.
2. Select **+ → Add custom MCP server**.
3. Enter **BibleResearch** as the name and the description above.
4. Under Connection, paste the complete server URL above, including `/mcp`.
5. Select **No authentication**.
6. Review the connection notice and select **Create as a plugin**.
7. Open the resulting plugin in your personal plugins and install it using the **+** button.
8. Start a new **Work** chat, type `@`, and select **BibleResearch**.
9. Ask: **Use BibleResearch to show the original words of Genesis 1:1.**

Expect a call to `prompt_verse_words` with `p_book=1`, `p_chapter=1`, `p_verse=1`, returning seven ordered tokens.
Account/workspace policies can restrict adding custom MCP servers. If the option is unavailable, check the workspace's plugin controls.

Official instructions: [OpenAI plugin quickstart](https://developers.openai.com/plugins/quickstart),
[connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Add to Gemini on the web

As documented on 1 November 2026, custom Connected Apps require a personal Google Account,
age 18+, US availability, English, and Keep Activity enabled. Work/school accounts are excluded.
If the option is unavailable for your account or region, use Gemini CLI below.

1. Open **gemini.google.com**.
2. Open **Settings → Connected Apps**. On some accounts this is under **Personal Intelligence → Connected Apps**.
3. Under **Custom apps**, select **Add a custom app**.
4. Paste the complete server URL above.
5. Select **Next** and complete the connection flow. The endpoint requires no sign-in or API key.
6. In a new conversation, type `@` and select **BibleResearch** (or the connected app name Gemini displays).
7. Ask: **Use BibleResearch to find passages containing Strong's H7225.**

If Gemini requests OAuth credentials, confirm that you entered this anonymous endpoint and selected the available no-authorization option.
Do not enter a Supabase service-role key or project access token. Account rollout may still prevent the custom-app flow;
the CLI configuration below connects directly to the same server.

Official instructions: [Google custom Connected Apps](https://support.google.com/gemini/answer/17209137?hl=en-12).

## Gemini CLI alternative

With Gemini CLI installed, run:

```powershell
gemini mcp add --transport http --scope user BibleResearch https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp
gemini mcp list
gemini
```

Inside Gemini, run `/mcp` to inspect the tools and prompts.

Equivalent settings, to merge into the existing `mcpServers` object in your Gemini `settings.json`:

```json
{
  "mcpServers": {
    "BibleResearch": {
      "httpUrl": "https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp"
    }
  }
}
```

The user settings file on Windows is `%USERPROFILE%\.gemini\settings.json`.
The command above adds the entry without replacing your other settings.

Official instructions: [Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/).

## Research prompts you can use immediately

All sixteen templates accept one required string argument named `subject`.

| Template | Example subject | Workflow |
| --- | --- | --- |
| `study_verse` | `Genesis 1:1` | Original tokens, morphology, glosses and significant word definitions |
| `study_word` | `H7225` | Definition, occurrences, associated words and representative passages |
| `compare_words` | `H7225, H1254` | Resolve real word IDs, find shared passages and explain density scores |
| `study_chronology` | `1 Kings 6:1` | Compare supported dates, chronological models and evidence |
| `study_geography` | `John 4:7` | Inspect settings, map data, confidence and disputed locations |
| `study_relationships` | `well -> marriage` | Inspect reviewed relationships and counterexample controls |

Ten additional templates cover repetition, literary structure, motifs, allusions,
semantic contrasts, grammatical shifts, rare connections, time/place, translation
effects, and counterexamples. Names and coverage rules are in
[RESEARCH_API.md](RESEARCH_API.md#5-deep-pattern-prompts). For example, request
`get_research_prompt` with `name: "challenge_pattern"` and the proposed claim as
`subject`.

In either assistant, ask:

```text
Use BibleResearch's get_research_prompt tool with name study_word and subject H7225.
Then follow those research instructions using the BibleResearch tools and cite the passages.
```

In Gemini CLI, native MCP prompt commands are also available:

```text
/study_verse --subject="Genesis 1:1"
/study_word --subject="H7225"
/compare_words --subject="H7225, H1254"
```

MCP prompt menus depend on the client. `get_research_prompt` exposes the same instructions as a tool for clients without those menus.
Templates return instructions; the assistant then performs the actual research tool calls.

## Exposed tools

| Tool | Required arguments |
| --- | --- |
| `prompt_verse_words` | `p_book`, `p_chapter`, `p_verse` |
| `prompt_word_occurrences` | `p_word_query` |
| `prompt_word_cooccurrences` | `p_word_query` |
| `prompt_word_relationships` | `p_word_ids` (2–10 positive database IDs) |
| `resolve_word_id` | `p_query` |
| `get_word_details` | `word_id` |
| `get_research_prompt` | `name`, `subject` |
| `get_verse_chronology_v1` | `p_book`, `p_chapter`, `p_verse` |
| `get_verse_geography` | `p_book`, `p_chapter`, `p_verse` |
| `research_relationships` | `subject` (optional `target`, `mode`) |
| `get_verse_research` | `p_request` containing 1-5 `passages` |

The four research tools additionally accept `limit` (1–100, default 25) and `offset` (default 0).
Legacy database results have `source: "live"`, `rows`, and `page` metadata. Continue with `page.next_offset`
while `page.has_more` is true. A page length is not a total corpus count. Unknown words and passages return empty rows.

Book IDs are 1–66: Genesis=1, Psalms=19, Matthew=40, John=43, Revelation=66.
Verse 0 retains Psalm headings. Word queries accept Strong's numbers, positive IDs, exact original forms or transliterations.
Occurrences group inflections by Strong's number. Co-occurrences contain the top 15 cached lexical partners;
relationship scores measure lexical density in a shared passage, rather than theological significance.
English results are glosses, not a full continuous Bible translation. Unknown fields remain null.
Corpus sources and attribution are documented in [DATA_SOURCES.md](DATA_SOURCES.md).

`get_verse_research` returns a direct JSON packet in structuredContent rather
than a rows envelope. Example tool arguments:

```json
{"p_request":{"passages":[{"book":1,"chapter":1,"verse":1}],"occurrences":{"mode":"all"}}}
```

The packet includes ordered words, source translations, Strong's, raw grammar,
definitions, shared complete occurrence references/counts, seven cached word
connections, dating, map data and available semantic evidence. Private reader
choices are excluded. Inspect coverage, unresolved grammatical tags, ambiguous
lexeme candidates and nested component statuses. An oversized packet returns
`packet_limit_exceeded`; request fewer passages or explicitly select sample mode.

## Verification and maintenance

The automated live suite checks all eleven tools, all sixteen native and compatibility prompts, three legacy MCP
initialization versions, Hebrew/Greek token ordering, pagination, missing results, invalid arguments,
unknown operations, caller credential isolation, CORS, malformed JSON and request size limits.
The H7225 corpus check verifies 49 passages and 51 tokens across three pages, without duplicate references.

Run it without credentials or extra packages:

```powershell
node scripts/verify-bible-mcp.mjs
```

To test a different deployment, set `BIBLE_MCP_URL` before running the script.
With Deno installed, run the local mock-based security/reliability checks and Edge Function typecheck:

```powershell
deno check --config supabase/functions/bible-mcp/deno.json supabase/functions/bible-mcp/index.ts
deno run --config supabase/functions/bible-mcp/deno.json scripts/verify-bible-mcp-local.mjs
```

The mock suite proves caller tokens are not forwarded, administrative keys are rejected, invalid requests cannot
reach the database, and a transient upstream failure is retried exactly once. Persistent failures return MCP errors;
the server never substitutes sample data. The retry shares the original 12-second database-request budget.

The function uses Supabase's automatically provided `SUPABASE_URL` and legacy public `SUPABASE_ANON_KEY`.
An optional `BIBLE_SUPABASE_PUBLISHABLE_KEY` Edge Function secret can select a modern publishable key instead.
No extra secret provisioning is required for the current deployment. Caller authorization headers are ignored;
all requests use the configured public database identity. The adapter exposes only the listed Bible operations.

For future source updates, the already-installed Supabase CLI supports this deployment command:

```powershell
npx supabase functions deploy bible-mcp --project-ref ejoperxiwxlcbsqrkrvb --no-verify-jwt --use-api
```

This command requires an authenticated CLI or a scoped `SUPABASE_ACCESS_TOKEN` with `edge_functions_write`.
The current deployment is complete; you do not need to run it to connect your assistants.
When deploying through the Supabase MCP tool, explicitly set `import_map_path` to `deno.json` along with the
`index.ts`, `catalog.ts`, and `deno.json` files, to avoid retaining an import-map path from an older deployment.

After changing tool descriptions or schemas, refresh the ChatGPT plugin connection and start a new conversation.
In Gemini Developer Mode use **Sync schema**, or refresh/reconnect the custom app. Restart Gemini CLI to rediscover tools.

Supabase hosting reference: [MCP servers on Edge Functions](https://supabase.com/docs/guides/functions/examples/mcp-server-mcp-lite).
This implementation uses the official MCP SDK; the hosting guide's mcp-lite framework is an alternative.

No OpenAPI import is needed for this MCP connection. `supabase/openapi.json` remains an unrelated placeholder for the older Actions workflow.
