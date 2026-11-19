# BibleResearch MCP — Simple Discovery Strategy

**Goal:** Help ChatGPT and Gemini notice surprising, meaningful connections in Scripture and explore them deeply. Return **enough evidence to spark useful associations, but not so much that most of it is ignored**. The AI should make interpretations; the server should provide accurate biblical, linguistic and contextual data.

## Tools

### 1. get_Passage(passage, depth=3, word_depth=0, etymology=0, realworld=0)

Example: `get_Passage("1COR12:10-1COR13:4", 10, 0, 0)`

- **depth (z):** up to z connections for the whole passage and up to z for **each verse**.
- **word_depth (x):** up to x connections **per word**; 0 means no per-word connection list.
- **etymology (y):** 0 = omit; positive y = root/formation evidence plus up to y separately labelled spelling-similarity suggestions.
- **realworld:** 0 = omit; 1 = definitions and connected physical/world concepts where supported.

Suggested output:

```text
Passage range
  Passage_Connections [top z: brief reason, relationship, reference, evidence ID]
  Geography [place, relation to passage, coordinates if known]
  Chronology [date/range, what was dated, model, uncertainty]
  Verse (for every requested verse)
    Complete verse in original language
    Complete verse in readable English
    Verse_Connections [top z]
    Word (in original order)
      original form, lemma, transliteration, English gloss
      senses [important alternatives]
      grammar [compact code or expanded notation when helpful]
      LXX [attested translation links, if applicable]
      etymology [documented roots; separate suggested letter matches] if requested
      notes [brief text/ID and attribution]
      connections [top x] if x > 0
      realworld [definition and linked concepts] if requested
```

Keep original text, transliteration and English readable. Connections should say **why they matter**, not just list IDs. Reuse shared word information to avoid repeating long entries. For large ranges, keep verses complete and paginate extras explicitly.

**Geography and dating must be correctly scoped:** a recipient city is not necessarily where a letter was written; competing dating models must be named rather than presented as fact.

### 2. get_Word(word, connections=10, etymology=0)

Example: `get_Word("Ruach", 30, 10)`

Accept English, original Hebrew/Greek, transliteration, lemma, Strong's number, or a word in a specified verse. Return the **same word structure** as above, plus:
- Relevant senses with examples and ambiguous candidates.
- Grammar and occurrences in biblical context.
- LXX links, etymology and optional similar-spelling candidates.
- Gematria/isopsephy with the **specified method and spelling**.
- Notes, real-world meaning where supported, and top x diverse connections with short biblical witnesses.

Do not equate spelling similarity with etymology or co-occurrence with meaning.

### 3. get_Connection(items, connections=10)

Compare two or more words, passages or concepts, including mixed inputs. Give the strongest *actual* links, what connects them, supporting verses and clear uncertainty. Return the complete get_Word-style object for word inputs. For passage inputs return passage context and up to x connections **without expanding every word**. Support exploration of more than one possible connection, not only a forced path.

### 4. follow_connectionchain(chain, next)

The AI can start, follow, branch or revisit a connection chain. **The server remembers the visited nodes and evidence** and returns the next relevant connections without sending everything again. Keep sessions lightweight, expiring, private to the appropriate user/session, and distinguish a possible chain from an actually evidenced relationship.

### 5. research(query)

A flexible tool for deeper investigations: exact word/passages, original-language relationships and grammar, LXX, verse and motif comparisons, gematria, number patterns, word occurrences across chronological models, and passages/events linked to geographic places. Allow several searches/calculations to be combined in **one request**, returning selected results and evidence. The coding agent may choose a secure composable-query approach or true sandboxed code execution if feasible and inexpensive; never run unrestricted AI code or enable paid services without permission.

### 6. write_Note()

**Keep the existing note-writing functionality and permissions** (including exact word/verse links and DLM notes). Nothing should be saved automatically unless the user authorizes it.

### 7. get_prompt()

Simply return **the BibleResearch research guidelines prompt** explaining how an AI should use the MCP tools, explore and verify connections, cite actual passages, and distinguish textual facts from hypotheses. Do not add unnecessary prompt-selection options.

## Information design: let the coding AI experiment

**Do not design every response field or optional setting in advance.** The coding agent should simulate realistic ChatGPT/Gemini research sessions with the existing tools and prototype outputs, then decide:

- Which information causes useful, unexpected connections to become apparent?
- What is usually noise? What can be shortened (e.g. a recognizable grammar code rather than a full sentence)?
- Where is **more** information worthwhile (e.g. the original verse, a distinctive textual parallel, documented root components, a non-obvious relationship)?
- Which output levels/settings genuinely help, and how should they be described to the model?
- Which follow-up calls should immediately retrieve deeper evidence without repeating everything?

Try at least: **Genesis 6:14** (covering/pitch and `kaphar` family), **Zechariah 4** (seven eyes/lamps, oil, Spirit, Revelation 11), **Ezekiel 1** (Ezekiel 10), **Revelation 13** (Daniel 7), **1 Corinthians 12:10–13:4**, and a **Ruach** word study. Judge the outputs by how many **interesting, defensible discoveries per token** they make possible—not sheer connection count.

The AI must still see direct biblical texts and meaningful source-language detail. Preserve distinctions among attested etymology, grammar, literary comparison, statistical association, external physical facts and DLM speculation. Notes and hypotheses are not Scripture. Missing data must be identified, never invented.

## Implementation boundaries

Build on existing STEP/Macula, LXX, relationship/discovery indexes, geography, chronology and notes; avoid duplicating large assets or changing original source evidence. Use the current project development contract and `TASKS.md` for work tracking.

**Success:** A model calls get_Passage or get_Word, notices worthwhile biblical connections immediately, and can investigate the ones it finds interesting with only a few targeted follow-ups.
