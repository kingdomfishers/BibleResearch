# BibleResearch MCP AI Evidence Lenses — Implementation & Handoff

**Date:** 2026-11-10. **Live:** Supabase project `ejoperxiwxlcbsqrkrvb`, Edge Function `bible-mcp` version **26**, workflow contract **1.8.0**. **Git:** feature branch `feature/bibleresearch-ai-lenses-20261110` (NOT merged to main).

## What shipped (live)

1. SQL `research_word_lens_v1(query,limit)`: precise lemma/lexicon resolution (no substring gloss search), sense candidates, source-backed root links, exact occurrence counts, bounded one-example-per-book samples, explicitly statistical co-occurrence partners. Does not assign token senses.
2. SQL `research_word_bridge_v1(left,right,limit,window)`: two lexeme queries to original-token/verse witnesses within the same chapter (window 0–2). Returns exact ordered source-token positions and independent WEB verse context. This is **proximity**, not a semantic edge or proof.
3. SQL `research_passage_lens_v1(book,chapter,verse,max_tokens)`: original-language MACULA source tokens/morphemes, grammatical features and allowed source annotations, scoped to WLC Hebrew or Nestle1904 Greek. Hebrew restricted semantic frames, SDBH, and Greek Louw-Nida/MARBLE fields are not returned. Hebrew component order is derived from stable source-record ordering, not unreliable `morph_no`.
4. MCP tools: `research_word_lens`, `trace_biblical_bridge`, `research_passage_lens`. Payloads are filtered to source-anchored signal and explicit uncertainty, with input/output bounds and read-only annotations.
5. New prompt `trace_connection_evidence`; enhanced `study_word` and `study_relationships`; new default research routes and workflow metadata.

Supabase migrations already executed:
- `20261110080422_ai_evidence_research_lenses_v1`
- `20261110081303_ai_evidence_lens_hebrew_morpheme_order_v1`

The live Edge Function was intentionally patched from its **currently deployed code**, not from GitHub main, because the live deployment includes additional notes and syntax tools absent from the GitHub main snapshot. All existing modules were kept during deployment. No changes were made to the Cloudflare `bibleresearch-corpus` worker or its data.

## Why it reduces AI token use

**Database decides:** word identity and disambiguation candidates; indexed occurrence counts; word/verse joins; nearby verse detection; morphology and original tokens; curated source attribution; bounded output.

**AI decides, then verifies:** which candidate sense fits this passage; whether a direct statement, contrast, analogy, metaphor, discourse reference or typological hypothesis is actually supported; how passages interact in literary context; which relevant controls could falsify the proposed relationship.

Send 3–8 decisive original-language witnesses to the model, not 10,000 unranked occurrences. If evidence is ambiguous, ask the AI to inspect **one** decisive verse via `research_passage_lens` or the existing `research_macula_syntax` and `get_verse_hydrated` tools. Human/AI notes are commentary, not canonical text.

## Fast test cases

- `research_word_lens({query:"bread",max_candidates:4})` returns **G740** and **H3899** as distinct lemma candidates. Do not unify the language-specific lexemes into a claim.
- `research_word_lens({query:"H3899"})` separates STEP senses `food`, `food: bread`, `food: allowance`. Exact count at test time: 298 word tokens / 277 distinct verses.
- `trace_biblical_bridge({left:"G4703",right:"G3056",nearby_verse_window:0})` finds Luke 8:11, seed position 7 and word position 10. The explicit interpretation is established **after reading Jesus' words**, not merely from co-occurrence.
- `research_passage_lens({book:42,chapter:8,verse:11})` returns the Greek tokens and WEB context; `research_passage_lens({book:5,chapter:8,verse:3})` returns Hebrew morphology/participant references.
- Check Isaiah 55:10–11 using passage lenses and compare seed/bread/word with an explicit lexical resolution; for a localized full chapter study use existing `get_verse_research`. The bridge v1 is a short same-chapter lexical window and lacks a custom book filter.

SQL read-only smoke tests:
```sql
SELECT (public.research_word_lens_v1('bread',4)->>'status')='ok' AS word_ok;
SELECT (public.research_word_bridge_v1('G4703','G3056',8,0)->'matches'->0->>'left_verse')='11' AS seed_word_ok;
SELECT (public.research_passage_lens_v1(42,8,11,55)->>'status')='ok' AS greek_passage_ok;
SELECT (public.research_passage_lens_v1(5,8,3,55)->'tokens'->1->>'part')='2' AS hebrew_component_order_ok;
```

## Current hard boundaries

1. These are **evidence retrieval tools, not the future all-Bible semantic action graph**. There are still only seven curated graph assertions and incomplete syntax-tree coverage. No event/entity/claim edges were invented.
2. Lexical English labels can resolve to multiple original words. Refine to explicit Strong numbers before a doctrinal claim. Broad gloss searches receive an ambiguity warning.
3. Word-lens samples are one early verse per book, not a representative random sample and not a full concordance. The verse bridge returns earliest matches, not a theological importance ranking. Repeat with an explicit lemma/passage and the existing pericope tools for depth.
4. Two Greek source editions must not be silently merged; the lens selects Nestle1904. Strong's identity and Hebrew/Greek lexical translation are not independently established token alignment.
5. The live v1.8 deploy was verified via `@BibleResearch.get_research_prompt`; SQL smoke cases were run against Supabase. **ChatGPT plugin tool listings may cache the older seven-tool manifest.** Refresh the BibleResearch connector or open a new conversation to discover the newly registered MCP tools. This project cannot force the client's tool-catalog refresh.
6. **Source-control divergence:** GitHub main still has the older workflow generator and lacks the full live notes stack. The branch contains the additive lenses, migration history, routing integration and research prompt changes, but should be reconciled against the authoritative local workspace *before merging or redeploying from GitHub*. Do not deploy GitHub main as a replacement for the current Edge Function.

## Next recommended upgrades

- Add book/chapter filters and purposeful diversity ranking to `trace_biblical_bridge`; enable exact Isaiah 55:10–11 targeting without scanning first canonical matches.
- Move high-volume immutable linguistic proof paths into versioned Cloudflare corpus shards; let Supabase manage dynamic notes and editorial review. Do not copy restricted source components.
- Build typed event/claim extraction from MACULA syntax with negation, speaker, agency, passive voice and metaphor scope; never auto-upgrade lexical proximity to theology.
- Test AI reasoning with blind benchmark tasks: Luke 8:11 (G4703 not G4690), Isaiah 55:10–11, Deuteronomy 8:3, John 6:35, source variants, and counterexamples. Record false positive and missed-link rate, token cost and retrieval time.
