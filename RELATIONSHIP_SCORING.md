# RELATIONSHIP_SCORING.md — Context Units & Lexical Association Scoring

Updated: 2026-11-01. Architecture: [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md).

## 1. Context Units & Denominators

1. **Single-Verse Unit (`verse`):** Canonical `public.verses` record (`31,203` total passages, including `116` Psalm headings at `verse_nr = 0`).
2. **Narrative Pericope Unit (`narrative_unit`):** Sourced multi-verse narrative episodes (such as `Genesis 24:11-67`, `Genesis 29:2-28`, `Exodus 2:15-21`). Narrative units never cross canonical book boundaries.
3. **Token-Pair vs. Passage Counts:**
   - `token_pair_frequency`: Total within-verse ordered or unordered token pairs across the corpus (`674,125` distinct unordered base-Strong's pairs in STEP TAHOT/TAGNT).
   - `passage_count`: Distinct `verses.id` where all target lexemes co-occur.

## 2. Fixed Formulas

### A. Cached Pair Association Score (`prompt_word_cooccurrences`)
Computed in PostgreSQL (`scripts/score-stepbible.sql`) per unordered Strong's pair $(w_a, w_b)$:
$$\text{score}(w_a, w_b) = \text{round}\left(\frac{\text{frequency}}{1 + \text{avg\_distance}}, 2\right)$$
where $\text{frequency}$ is the count of within-verse token pairs and $\text{avg\_distance}$ is the mean absolute token-position distance $|p_a - p_b|$.

### B. Multi-Word Verse Density Score (`prompt_word_relationships`)
Computed in PostgreSQL (`002_rpc_prompts.sql`) for any set of target words $W$ co-occurring in verse $v$:
$$\text{relationship\_score}(v, W) = \text{round}\left(\frac{|v \cap W| \times 100}{\max(\text{cardinality}(v.\text{word\_ids}), 1)}, 2\right)$$

## 3. Epistemic Boundaries

- Statistical scores measure corpus co-presence and proximity only; they never prove semantic synonymy or theological identity.
- Multi-verse literary motifs (e.g., `well` + `marriage`) are retrieved via reviewed `narrative_parallel` assertions in `public.assertions` rather than single-verse proximity.
