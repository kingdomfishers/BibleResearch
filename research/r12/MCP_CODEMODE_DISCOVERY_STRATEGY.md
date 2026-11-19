# BibleResearch — Compact MCP Discovery Strategy (v2, seven functions)

**Updated:** 2026-11-19  
**Status:** Authoritative proposed AI-facing MCP contract. Documentation only; no MCP implementation or deployment is implied.  
**Replaces:** The previous three-read-tool proposal in this file and the earlier eight-read-tool recommendation in [MCP_AI_DISCOVERY_REQUIREMENTS.md](MCP_AI_DISCOVERY_REQUIREMENTS.md). Preserve that report's detailed evidence/DLM/prophecy and evaluation research, not its superseded tool inventory.  
**Implementation brief:** [NEON_MCP_CODEMODE_IMPLEMENTATION_PROMPT.md](NEON_MCP_CODEMODE_IMPLEMENTATION_PROMPT.md).

## 1. Objective and design rule

Give ChatGPT, Gemini and other AIs a **small, predictable research interface** that reveals non-obvious but genuine biblical patterns without flooding the model with unrelated data. A model must be able to read the actual Scripture, see each original-language word with just enough linguistic/biblical context to notice a connection, request deeper evidence *only when interested*, and follow a research path across the whole Bible.

**Primary calls:** \`get_Passage()\` and \`get_Word()\`. These return **hierarchical, readable, source-grounded packets**; they are not verbose automatically generated theological essays.

**Supporting calls:** \`get_Connection()\`, \`follow_connectionchain()\`, \`research()\`, \`get_prompt()\`, and the existing authorized \`write_Note()\` behavior.

**Seven public operations in total:** two everyday retrieval functions; one targeted comparison; one stateful traversal; one powerful composite query; one prompt guide; one explicitly authorized note write. This is a deliberately limited front door, **not** a proposal to delete underlying 46 legacy tools or data.

The ideal progression is:

> Read passage/word → notice a surprising relation → compare its exact witnesses → follow a chain or run targeted analysis → test other explanations → optionally save a note.

## 2. Exact public tool contracts

Names/capitalization below deliberately preserve the owner's requested interface. Prefer named, typed JSON arguments over fragile positional parsing in actual MCP; publish the equivalent positional examples in documentation. Parameters with defaults may be omitted.

### 2.1 \`get_Passage(PASSAGE, Depth=z, WordDepth=x, show_etymology=y, show_realworld=0)\`

**Inputs**

- \`passage\`: canonical reference or **inclusive cross-chapter range** such as \`1COR12:10-1COR13:4\`; accept canonical \`book/chapter/verse\` objects and a bounded array of ranges. Normalize a display reference and retain source identity, Psalm heading verse 0 and versification caveats.
- \`depth\` (\`z\`, default small, e.g. **3**, min 0): at most **z passage-level connections AND z for EACH verse**, ranked separately. \`0\` disables these connection arrays, not original verses.
- \`word_depth\` (\`x\`, default **0**, min 0): at most **x connections for EACH word**. \`0\` means the word's core lexical/grammar capsule still appears but its connection list is omitted.
- \`show_etymology\` (\`y\`, default **0**): \`0\` omits optional etymology/orthographic exploration; \`y>0\` includes documented derivation/root evidence **plus at most y separately labeled *unverified spelling/letter-similarity candidates*** when available. Never call those candidates proven etymology.
- \`show_realworld\` (\`0|1\`, default **0**): attach a short, source-attributed physical/world concept definition and related properties only when available, never as evidence of biblical authorial intent.
- \`include_notes\` (default true): compact, attributed note summaries and IDs when authorized; source type always \`commentary\`.
- Optional \`focus\` (reorder potentially useful connections for user's question), \`edition\`, \`english_translation\`, \`max_output_tokens\`, \`cursor\`, and \`include[]\` for targeted extra sections. Never require the model to specify these for an ordinary passage.
- Optional \`chronology_model\` for dates; \`time_axis=event|composition|audience\` when needed. Missing chronology is unknown, not a chosen date.

**Example (owner's intended short call):**
\`get_Passage("1COR12:10-1COR13:4", 10, 0, 0)\` — omits \`show_realworld\`, which defaults to 0. Return up to ten passage connections, ten per-verse connections, all requested verses and core word data, **zero per-word connections**, **zero optional etymology matches**, and no real-world overlay. This can be large; compact individual connection records and paginate if a hard budget is reached **without silently losing verses**.

**Output structure (normative hierarchy; exact casing/JSON contract to be finalized in implementation):**

\`\`\`json
{
  "passage": "1 Corinthians 12:10–13:4",
  "passage_connections": [
    {"id":"...", "target_ref":"...", "why":"...", "type":"...", "evidence_level":"...", "witness_excerpt":"..."}
  ],
  "geography": [
    {"place":"Corinth", "role":"recipient_city", "latitude":null, "longitude":null,
     "confidence":null, "source":"...", "resolution_status":"..."}
  ],
  "chronology": {
    "model":"...", "time_axis":"composition", "date_or_range":null,
    "confidence":null, "alternative_models":[], "coverage_status":"..."
  },
  "verses": [
    {
      "reference":"1 Corinthians 12:10", "verse_id":"...",
      "original":"ἄλλῳ δὲ ...", "english":"[complete licensed verse text]",
      "verse_connections":[{"id":"...", "target_ref":"...", "why":"...", "type":"..."}],
      "words":[
        {
          "surface":"ἄλλῳ", "lemma":"ἄλλος",
          "transliteration":"allō", "english":"to another",
          "senses":["other", "another"], "grammar":"A-DSM",
          "grammar_explained":"adjective, dative, masculine, singular",
          "strongs":"...", "occurrence_id":"...", "position":1,
          "lxx":{"status":"no_attested_alignment_for_this_occurrence"},
          "etymology":null, "notes":[],
          "connections":[], "realworld":null
        }
      ]
    }
  ],
  "coverage":{"verse_text":"...", "lexical":"...", "lxx":"...", "notes":"..."},
  "release":{"corpus":"...", "graph":"...", "mcp":"..."},
  "paging":{"truncated":false, "cursor":null}
}
\`\`\`

**Example strings/IDs are illustrative only**, not verified data. Do not write literal placeholders into live results. \`original\` and \`english\` must contain **the complete requested verse** where the selected text is available and licensed; do not make the AI infer a whole verse from glosses or mere references. Each \`word\` is a source-token occurrence; morphological grammar belongs to the actual inflected token, not indiscriminately to the lemma.

**Nested behavior:** \`passage_connections\` selected for the whole range, \`verse_connections\` selected for each verse, \`word.connections\` only if \`word_depth>0\`. Do not repeat huge witness details under each repeated word: reuse short IDs, tiny snippets and shared dictionary records; deep witnesses are fetched via \`get_Connection\` or \`research\`. Keep exact ordered original tokens (including distinct morpheme parts) in the word array.

**LXX field:** For Hebrew Bible tokens, include *attested* LXX translation candidates and witness counts/source when indexed. A Greek NT word is **not automatically an LXX translation occurrence**; show attested correspondences only if real evidence exists, otherwise \`not_applicable\`/\`not_covered\`. For Greek/NT, Hebrew equivalents from LXX are lexical research *candidates*, not identities.

**Geography:** Distinguish where a passage happened, where a letter was written, where its recipients lived, locations mentioned, and symbolic locations. Coordinates require real source/role/confidence; never infer Corinth's coordinates or composition place from a letter's recipient. **Chronology:** Do not unconditionally return \`59 AD\` or \`year 4029\`; such values are model-dependent and may be disputed/unknown. Return date model, axis, range and alternatives if available.

### 2.2 \`get_Word(WORD, x, y)\`

**Inputs:** A word expressed in English, Hebrew/Aramaic, Greek, transliteration, source surface, extended Strong's/lemma ID, or exact \`verse_id + word_position + edition\`; \`x\` (default **10**) is max distinct connections, \`y\` (default **0**) max optional spelling candidates/etymology switch as above. Optional \`show_realworld=0|1\` (default 1 for word concepts where supported, omit if missing), \`include_notes\`, \`context\`, \`sense_id\`, \`limit\`, \`cursor\`, and \`max_output_tokens\`.

**Output — same word object** used in \`get_Passage\`, expanded to show \`senses\`, morphology/grammatical *forms* (or occurrence-specific code when anchored), LXX evidence, documented etymology/root and separate spelling candidates (when \`y>0\`), **gematria**, compact notes, top \`x\` diverse connections, real-world definition/relations when sourced, occurrence statistics, contextual verse witnesses, provenance and disambiguation candidates. When an English/transliteration query maps to multiple original words or senses, return explicit candidates and request sense/occurrence selection before making definitive claims; do not silently collapse homographs.

**Example:** \`get_Word("Ruach", 30, 10)\`.

**Gematria:** Provide the applicable Hebrew gematria or Greek isopsephy only with **named alphabet/value system, normalization, input spelling, letter-by-letter values and result**. Lemma vs inflected surface may differ; treatment of diacritics, matres lectionis, final forms, and iota subscript changes sums. Do **not** hardcode the example number 861 for \`ἄλλῳ\` without a specified scheme and verification. Equality of sums is a numerical observation, not semantic/prophetic evidence.

**Etymology warning:** Historical root and derivation are a different field from morphological segmentation, literary pun and shared consonants. Maintain source/evidence distinctions.

### 2.3 \`get_Connection(...ITEMS, x)\`

**Inputs:** Two or more word/passage/concept/occurrence references (recommended 2–8 bounded), max \`x\` returned meaningful connections and optional \`types\`, \`focus\`, \`max_hops\`, \`include_counterexamples\`, \`cursor\` and budget. Mixed words and passages allowed.

**Output:** \`inputs\` (resolved with ambiguity), \`connections\` up to x with **actual witness excerpts, direct/indirect proof paths, exact word/verse references, ranking reason, mechanism, evidence level, alternatives and expandable evidence IDs**.

**Expansion rules the user requested:**
- When an input is a **word**, include the *complete get_Word-shaped lexical object* for each selected input word (bounded/paged where necessary), not only its lemma ID.
- When an input is a **passage**, show the passage text/context and **up to x passage-level connections only**; **do not expand every word of the passage**.
- Do not assume a chain of individually true edges proves a connection between endpoints. Separate direct evidence, interpretive comparison and research hypothesis. Return a valid \`chain_candidate\`/node for deliberate continuation.

### 2.4 \`follow_connectionchain(chain_id?, next_node?, ...)\`

The server should **remember the investigative path** so the AI can continue one node at a time without re-sending previous evidence.

**Inputs:** \`chain_id\` optional on start; \`start\` (word/passage/connection) when new; \`next_node\` or \`connection_id\` for append; \`action=start|follow|branch|back|inspect|reset\`, optional \`focus\`, \`x\`, \`cursor\`.

**Output:** stable \`chain_id\`, version/revision, prior node summaries, current node, proposed next connections (brief), evidence for the newly joined edge, exact source references, endpoint proof status, alternative branches, per-chain limits and continuation token. Returns compact *delta* + short breadcrumb rather than redownloading all prior packets.

**Persistence and security:** A read-only research action may maintain **ephemeral workflow state**, but cannot write canonical research claims or user notes. Use a Supabase-backed TTL store or another existing suitable free-tier persistence mechanism **only when authorized and appropriately scoped**. Avoid trusting caller-supplied chain IDs as authorization: bind state to authenticated client/user/session, or use cryptographically unguessable high-entropy per-chain capability tokens and expiration; prevent cross-user reads/overwrites; allow expiry/reset. Scope storage/retention and disclose it. Test concurrency/revision conflicts, expiration, pagination and rollback. No permanent note persistence without \`write_Note\`.

### 2.5 \`research(query_or_plan)\`

One flexible entry point for **advanced research**, not an excuse to dump the entire corpus or expose all low-level tools.

**Input:** \`query\` (ordinary-language description and available typed filters) **or** \`plan\` (validated declarative operations), optional \`output\` projection, source/edition/chronology model, budgets. When no internal model is available, the server may support deterministic natural-language patterns or respond with a suggested plan/clarifying capability; **do not pretend arbitrary freeform questions are automatically solved by an LLM inside the server**.

**Allowlisted operations accessible through this tool:** exact word/verse search, original-language occurrences and co-occurrence by clause/verse, morphology/grammar and syntax, semantic/lexical relationships, passage-passage comparisons, graph paths/expansion, LXX alignment, gematria with explicit schemes, numeric/text patterns, geography queries (event vs mentioned vs symbolic), chronology distributions (event vs composition axes/model/denominator), real-world properties with source, negative controls, note reads and bounded joins/aggregations/projection.

**Composability:** The AI may request multiple independent operations at once, or a dependency-ordered DAG of typed operations, with server-side filtering and compact result projection. Each step reports complete/partial/not-covered/ambiguous/unavailable and can be expanded by evidence IDs. Enforce hard time/CPU/rows/operations/depth/output limits. **No arbitrary SQL/JS/eval/HTTP/file access, no note writing** in this read tool.

**Code Mode:** True model-authored JavaScript is optional for a *future isolated sandbox*; Cloudflare Dynamic Workers paid-plan requirement may be relevant, so do not enable paid billing. A declarative executor is **not** advertised as executing arbitrary code.

### 2.6 \`write_Note()\` — keep existing note behavior

Preserve present note creation/update/deletion and DLM card semantics, canonical word/verse anchors, review status, author attribution, idempotency, provenance, security and authorization. Expose one user-facing entry or compatible alias that routes to verified existing authorized note operations. **Do not weaken existing write permissions or silently authorize writes from any public read-only client.** User instruction controls saving; never write canonical source claims from AI observations.

### 2.7 \`get_prompt()\`

Read the concise current BibleResearch usage guidance, available functions/arguments, citation/coverage classes, distinction between fact and hypothesis, short workflows and examples. Optionally choose \`general|prophecy|word_study|dlm|challenge|chain\`. Do not require this call before ordinary \`get_Passage\`/\`get_Word\` usage; keep server tool descriptions sufficient for common tasks.

## 3. Output selection: **minimal information, maximum discoverability**

The default should be *far smaller* than a complete verse hydration dump of every possible root, occurrence, candidate, note, physical property, and relation.

**Always include:** requested complete verse(s), original language and readable translation, each token's original/lemma/transliteration/gloss, a concise sense list and grammar notation, concise LXX information if truly applicable, notes IDs/summaries when available, context geography/chronology when sourced, and the precisely requested connection counts.

**Conditionally include:** optional per-word top x connections, optional detailed roots and up to y **unverified spelling suggestions**, real-world properties, full witness chains, exhaustive occurrences, complex grammar trees, statistical distributions and DLM overlays.

**Connection record must be compact:** \`id, target, type, why, evidence_level, one_short_witness, follow_id\`; deep proof and full other verse text are available through \`get_Connection\`/\`research\`. The model should see **why each connection might matter**, not just a Strong's number or opaque score.

**Importance weighting (inside requested x/z slots):** explicit interpretations, unique image combinations, narrative/grammatical roles, meaningful textual contrasts, cross-book reuse, documented linguistic connections, and surprising but testable parallels. Downrank generic grammatical hubs, ubiquitous co-occurrence and unrelated spelling overlaps without hiding requested types. Rank *interest* separately from *proof* and label both.

**Budget and paging:** \`depth\` and \`word_depth\` define *maximum per scope*, never an obligation to fabricate weak connections. Response cost can grow as \`verse_count × z + word_count × x\`: enforce hard resource limits and deterministic priority. If requested content cannot fit, return explicit \`truncated\`, \`omitted_sections\`, \`next_cursor\`, and **retrievable continuation**, not false "complete" claims. Test the cross-chapter 1 Corinthians example, including word_depth=0. Favor compact summaries and deduplication over reducing the whole verse text.

## 4. Important evidence distinctions

1. **Noah's ark covering:** Distinguish *kaphar* (cover/coat) and *kopher* (pitch/ransom usages) with actual Genesis 6:14 Hebrew and other attested verses. A resonance with atonement/redemption is a *candidate interpretation*, not the verse's literal gloss or automatic root-based proof.
2. **Zechariah 4:** Show text-internal "not by might ... but by my Spirit" (v.6), seven eyes (v.10), olive trees/branches (vv.11–14), their contextual roles and Revelation 11:4; support contrasts with Revelation 1:20, 4:5, 5:6, Matthew 6:22 and tabernacle menorah. "Seven directions" is a hypothesis until the relevant textual interpretation is demonstrated.
3. **Ezekiel 1:** Whole-scene creatures, wheels, movement, spirit, throne/glory; high-priority Ezekiel 10 explicit cherub identification; possible Revelation 4 comparisons.
4. **Revelation 13:** Whole-scene composite sea beast imagery and Daniel 7; retain alternatives and historical context; do not let generic head/sea or horn etymologies dominate.
5. **DLM:** Keep primary biblical text, textual comparisons, empirical mechanisms with external citations, and layer hypotheses in *four different epistemic records*. Do not invent DLM 0–7 layer meanings; use actual authoritative framework. Notes are untrusted commentary, never source instructions.
6. **Source truth:** STEP Hebrew/Greek identities, source edition, morphology/grammatical source, Macula license-gated semantics, LXX versification and historical/chronological models must remain visible where consequential. Place coordinates and scientific definitions require independent evidence. Keep user's explicit uncertainty visible.

## 5. Implementation and acceptance

**First:** inspect actual local repo, MCP tool registry and running Supabase/Worker versions. Then write focused, testable tasks in **TASKS.md only**. Preserve legacy endpoints and note writers until the new client surface is verified.

**Deliver in order:** (1) canonical nested word & verse schemas plus robust exact source identity; (2) \`get_Passage\` with bounded z/x/y and cross-chapter ranges; (3) \`get_Word\` with matching word object, resolution, optional gematria; (4) \`get_Connection\`; (5) persistent \`follow_connectionchain\`; (6) \`research\` with safe operation registry; (7) \`get_prompt\` plus write_Note compatibility; (8) compact core MCP catalog and deploy/rollback. Delegate independent code/test/document tasks to inexpensive agents after the interfaces are agreed.

**Small acceptance fixtures:**
- \`get_Passage("1COR12:10-1COR13:4",10,0,0)\`: inclusive cross-chapter range, no per-word connections or optional etymology/real-world; text+source tokens complete or explicit cursor/truncation, z max separately for passage and per verse.
- \`get_Word("Ruach",30,10)\`: ambiguity handled, roots vs spelling suggestions separate, meaningful varied connections, gematria scheme given, actual witnesses.
- \`get_Connection(["Zechariah 4","Revelation 11:4"],10)\`: passages receive comparison, **not all nested passage words**, explicit textual witness and differences.
- \`follow_connectionchain\`: start→follow→branch→inspect, preserved independent calls/clients, secure TTL/identity, invalid/expired token and conflicting writes rejected; proof status never laundered.
- \`research\`: two dependent operations, safe filtering and minimal projection; chronology distribution by explicit model; geographical event-vs-mentioned query; gematria with deterministic normalization.
- \`write_Note\`: authorized mutation works, unauthorized reader cannot write; no silent AI note creation.
- \`get_prompt\`: short accurate routing guide.
- Regression: Genesis 6:14, Ezekiel 1/10, Zechariah 4/Revelation 11, Revelation 13/Daniel 7, LXX and homographs, error/coverage cases, bounded performance.

**Final deliverable:** live new MCP version + source/tests/updated TASKS.md + \`research/r12/MCP_CODEMODE_IMPLEMENTATION_HANDOFF.md\` (versions, deployment evidence, tool schema, old-tool compatibility, cursor budgets, source issues, chain persistence, rollback, and exact independent ChatGPT test instructions). Run focused agent smoke tests only; ChatGPT performs the large independent benchmark later.

**No paid infrastructure, destructive migrations, security weakening, or removal of unique data without explicit permission.**

## 6. Related documentation

- [Detailed AI discovery/DLM/prophetic evidence requirements](MCP_AI_DISCOVERY_REQUIREMENTS.md) — evidence and evaluation only; older tool-count design is superseded.
- [Neon implementation prompt](NEON_MCP_CODEMODE_IMPLEMENTATION_PROMPT.md)
- [R12 deployment and algorithm handoff](R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md)
- [R12 diagnosis](R12_BENCHMARK_DIAGNOSIS.md)
- [Current MCP catalog](../../supabase/functions/bible-mcp/catalog.ts)
- [MCP configuration](../../MCP_SETUP.md)

**Final principle:** Do not force the AI to request everything, but make *something truly worth investigating* visible the moment it opens a passage or word.