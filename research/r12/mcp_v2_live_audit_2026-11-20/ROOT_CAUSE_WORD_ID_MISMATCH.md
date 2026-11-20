# Confirmed root cause: source-token word IDs shifted by a cross-corpus positional join

**Investigation:** 2026-11-20, read-only, using connected Supabase, Cloudflare and GitHub; no code/data/deployment mutations.

## Verified root cause

The deployed Cloudflare corpus Worker implements `normalizeTokenList(liteVerse, fastVerse)` in `scripts/corpus-relationships-rpc.mjs` (source around line 3373). It makes a `Map` from **R8/STEP chapter-lite** records keyed by canonical ordinal `row[0]`. It iterates **R10/Macula** `fastVerse.toks`, whose `tok.wn` is taken directly from Macula Hebrew `word_no` in `scripts/build-r10-discovery-index.mjs`, and performs this unsafe cross-source join:

```js
const wn = Number(tok.wn);
const liteRow = liteByWn.get(wn);
return {
  position: wn,
  word_id: liteRow ? (liteRow[1] ?? null) : null,
  surface: tok.sf ?? liteRow?.[2] ?? null,
  lemma: tok.lm ?? null,
  lemma_key: extractStemLemmaKey(liteRow?.[4], strongs),
  strongs,
  gloss: tok.g ?? null,
};
```

This implicitly assumes **Macula word number equals canonical STEP occurrence position** and that both verse tokenizations have identical numbering, omissions, and text witness structure. This is demonstrably false in Zechariah 4:2. The join associates a *correct R10 surface/Strong's/gloss* with a *different R8/STEP word ID and lemma key*. The mistaken `word_id` is then passed to `get_words_batch` in `supabase/functions/bible-mcp/discovery-v2-tools.ts` (around lines 710–840). Supabase returns *correct data for that incorrect ID*, causing `tr` and `code` to belong to another word. `research()` passage comparisons also inherit the wrong `lemma_key`.

**Independently verified in production:** The live deployed Cloudflare Worker `bibleresearch-corpus` code bundle was inspected through Cloudflare's script-content API and contains this exact `normalizeTokenList` function. Cloudflare deployment was dated 2026-11-20 04:16:59 UTC. Supabase's live `public.verses` and `public.words` were read directly. The corresponding seven-tool MCP output reproduces the mismatch.

### Concrete canary: Zechariah 4:2

Canonical Supabase `verses.word_ids` and `words` identify:

| STEP ordinal | Original | Correct word ID | Transliteration |
| ---: | --- | ---: | --- |
| 6 | וָאֹמַ֡ר | 35557 | vai.yo.mer |
| 7 | רָאִ֣יתִי׀ | 128692 | ra.'I.ti |
| 8 | וְהִנֵּ֣ה | 57816 | ve.hi.Neh |
| 9 | מְנוֹרַת֩ | 91302 | me.no.Rat |
| 10 | זָהָ֨ב | 59034 | za.Hav |
| 11 | כֻּלָּ֜הּ | 79865 | ku.Lah |
| 16 | נֵרֹתֶ֙יהָ֙ | 99243 | ne.ro.Tei.ha |
| 17 | עָלֶ֔יהָ | 110317 | 'a.Lei.ha |

The returned MCP passage *skips Macula token position 6*; its Macula `tok.wn=7` already carries the text `וָאֹמַ֡ר` (canonical STEP pos 6), but the join assigns `liteByWn.get(7)` → STEP word ID **128692** (the following word). Subsequent Macula tokens continue one position ahead. Therefore:

- `מְנוֹרַת֩` is emitted as `pos:10, word_id:59034` (actually gold) and receives `tr:"za.Hav"`.
- `זָהָ֨ב` is emitted as `pos:11, word_id:79865` (actually all-of-it) and receives `tr:"ku.Lah"`.
- `נֵרֹתֶ֨יהָ֙` is emitted as `pos:17, word_id:110317` (actually upon-it) and receives `tr:"'a.Lei.ha"`.
- The final Macula position 25 has `word_id:null`.

This is **not** a Supabase words-table corruption and **not** an error in a transliteration algorithm. The individual Supabase rows and word IDs are correct. It is an **invalid join across two independently numbered sources**.

**Residual unknown:** Why Macula/R10 contains a gap at position 6 in this verse (source edition segmentation, missing/misassigned morpheme, or upstream canonical mapping error) has **not** been established. Do not assume one cause without inspecting Macula source records and release build artifacts. The cross-source join is erroneous regardless.

### Coverage controls

The same read-only comparison on **Genesis 1:1 (7 words), Ezekiel 1:3 (19 words), and 1 Corinthians 12:10 (18 words)** showed no incorrect word ID at canonical positions. This bug is **conditional**, not a claim that every verse is wrong. The full affected-verse count is unknown and requires a corpus-wide cross-source validation without false equivalence across source editions.

## Required corrective design

1. Use the source-verified **canonical STEP `liteVerse.t`/`verses.word_ids` sequence** as the spine for MCP occurrence identity, original form, ordered positions and word IDs.
2. Treat Macula/R10 token numbers as **source-local ordinal coordinates**. Only attach Macula surfaces/glosses/grammar/roles to canonical occurrences via an explicit validated cross-corpus mapping, or a validated monotonic textual/Strong's alignment with ambiguity handling. Never join by equal number alone.
3. Prefer exact audited mapping records (including compound/morpheme handling, source edition, Psalm headings, shifted verses). If no provable alignment, return a separate Macula annotation with `alignment_status:"unverified"` or omit enrichment. Never attach another token's identifier, transcription, grammar, or lemma key.
4. Verify across R8/R10/R11/STEP/Macula source versions. Check that source-shard records are compatible and rebuild stale assets only after source provenance is confirmed. Never alter canonical `public.words` to compensate for erroneous Cloudflare joins.
5. Add a strict runtime/build-time check for any source-combined token: canonical word ID, source-script normalized surface, Strong's/lemma identity, verse anchor and position must be mutually compatible (allow legitimate documented edition/orthographic variants; do not rely solely on Unicode string equality).
6. Add regression canary Zechariah 4:2 and adjacent verses, and a separate corpus-wide mismatch report; preserve good controls Gen 1:1, Ezek 1:3, 1 Cor 12:10. Test the final `get_Passage` **and** `research(passage_compare)` outputs.
7. Perform no ranking/score changes as part of this P0 data-integrity repair.

## Reproduce with read-only Supabase SQL

```sql
SELECT v.id, v.book, v.chapter, v.verse_nr,
       u.ord AS canonical_position, w.id AS word_id,
       w.original_word, w.strongs_nr, w.transliteration, w.grammar_code
FROM public.verses v
CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id,ord)
LEFT JOIN public.words w ON w.id=u.word_id
WHERE v.book=38 AND v.chapter=4 AND v.verse_nr=2
ORDER BY u.ord;
```

Call `get_Passage({"passage":"Zechariah 4:2","depth":0,"word_depth":0,"etymology":0,"realworld":0})`, compare each returned `word_id` against canonical `ord` and word surface, and compare with `research({"operations":[{"id":"t","op":"passage_compare","passages":["Zechariah 4:2","Revelation 11:4"],"limit":2}]})`.

**Previously archived full outputs:** [RAW_CASES.json](RAW_CASES.json), [REPORT.md](REPORT.md).

**Repo source files:** `scripts/corpus-relationships-rpc.mjs`, `scripts/build-r10-discovery-index.mjs`, `scripts/corpus-worker.mjs`, `supabase/functions/bible-mcp/discovery-v2-tools.ts`.

**No production code, database, notes or deployments were changed during this investigation.**
