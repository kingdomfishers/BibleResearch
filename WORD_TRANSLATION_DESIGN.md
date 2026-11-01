# Word-by-word translation proposal

Status: implementation approved on 2026-11-01. Schema, source import, RPCs,
gateway, and interlinear dropdown are implemented. Anonymous sign-in is enabled;
live private saving, reload, reset, and reader isolation are verified. Final
user UI sign-off is pending; the complete browser suite passed and temporary
test accounts were signed out/session-revoked and removed.
The user approved private choices per verse occurrence on 2026-11-01.
Date: 2026-11-01.

## Reader behavior

- Each token displays original script, an English rendering, and transliteration.
- Original-script clicks retain the existing word-inspector dialog.
- Clicking English opens an accessible dropdown containing all available STEP
  renderings for that exact original form and grammar, with the active choice
  selected. Keyboard operation and English left-to-right direction are required.
- Save a chosen rendering in Supabase and restore it on navigation and reload.
- Show saving, saved, and failure status. A failed save must never appear saved.
- Include a reset-to-source action. Mark grammatical particles with no independent
  English equivalent explicitly, for example "[object marker]".

## Grammar and source fidelity

Existing `words` records are grouped by root, original spelling, morphology, and
transliteration. Their `english_translations` are observed source renderings,
ordered by frequency. They already retain inflection, attached articles,
prepositions, conjunctions, and pronouns; Genesis 1:1 includes "he created",
"the/ heavens", and "the/ earth". Display segmentation slashes as spaces while
retaining the exact source value for storage and validation.

Frequency-first form glosses are not always the correct default for a particular
occurrence. Import the pinned audit's occurrence-specific English into a new
table keyed by verse and ordinal, validating its word ID against the existing
`verses.word_ids` sequence. Keep the source locator and grammar alongside it.
Use that occurrence rendering by default, then the user's saved override.

Use source renderings associated with the same form and grammar. Do not generate
new English verb paradigms by mechanically mapping Hebrew aspect to English
tense or forcing grammatical plurals onto contextually singular nouns.
Preserve supplied-word brackets and explicitly account for untranslated
particles. Preserve Greek rendering and its LTR token order too.

The imported renderings support a dropdown of all available source alternatives;
they are not an exhaustive dictionary of every possible English translation.
Combining all entries sharing a simplified Strong's number would mix inflections
and potentially homographs, so it is not a valid source of extra options.

## Proposed persistence and RPC contracts

Approved scope: private per-reader, per-verse-occurrence choices. This allows
the same original word to have different contextual translations in two verses.

- New occurrence table: verse ID, ordinal, word ID, source English, source locator.
- New preference table: owner ID, verse ID, ordinal, word ID, exact English choice,
  update time, with an ownership-prefixed unique key and foreign key to occurrence.
- Private ownership uses Supabase Auth and `auth.uid()` RLS. With no current login
  UI, the proposed default is anonymous sign-in when a reader first saves, a
  persistent session, and session restoration before loading saved overrides.
  This requires checking/enabling anonymous sign-in in project configuration.
- Anonymous-session choices survive browser reloads. Cross-device recovery needs
  a linked account and is outside this proposed browser-session behavior.
- Add a versioned read RPC returning ordered tokens, occurrence source rendering,
  grammar, allowed alternatives, and any caller-owned saved rendering in one call.
- Add save/reset RPCs that validate verse position, current word ID, and membership
  in allowed source renderings. Enforce ownership in PostgreSQL and run as caller.
- Keep legacy `prompt_verse_words` and its existing public clients compatible.
- All UI access goes through `BibleRPC`; only `src/api/supabase.ts` imports the SDK.
- Public research/MCP requests continue to read corpus data without user choices.

## Implementation sequence after approval

1. Add occurrence/preference schema and RLS in an additive migration.
2. Add bounded read/save/reset RPCs in a separate migration.
3. Prepare and execute a hash-checked occurrence-gloss import from the pinned
   STEP audit; verify complete verse/word/ordinal parity before publication.
4. Add TypeScript response types and single-client session persistence.
5. Extend `BibleRPC` with translation reads and validated save/reset calls.
6. Add a focused translation dropdown component and its CSS.
7. Wire token rendering and passage loading, then update OpenAPI and registry docs.
8. Run static, database, and browser verification, followed by project UI sign-off.

Execute one atomic task at a time, with one or two target file edits per task.
Record exact task IDs and file paths in `TASKS.md` after scope is agreed.

## Acceptance checks

- Genesis 1:1 shows source inflections and an explicit untranslated object marker;
  every English row aligns beneath its original token in RTL reading order.
- A word with multiple renderings opens all available form-specific choices.
- A selected choice survives navigating away/back and browser reload.
- Repeated words at different positions can retain different choices.
- A second reader cannot read, overwrite, or delete another reader's choices.
- Invalid rendering, word/position mismatch, and unauthenticated writes fail.
- Reset restores the occurrence's source English, including after reload.
- Save failures are visible; rapid navigation cannot update the wrong passage.
- Greek order, existing original-word inspector, offline samples, and mobile
  layout remain functional. Samples do not claim Supabase persistence.
- Run type, size/TOC, production build, live RPC/RLS, and browser checks.

## Relevant project constraint

`.agents/skills/pre-code/SKILL.md`, step 0, requires approval for features with
more than three subtasks or database/architecture changes. The user provided
that approval. The post-code skill requires final user UI sign-off for T9.
