# Bible Research UX refresh — proposed strategy

Prepared: 2026-11-05. Revised and approved for implementation: 2026-11-05.
The approved revision makes word ranges, direct place links, and event timelines
part of the initial verse overview. Visual acceptance remains to be verified.
Execution queue: [TASKS.md](TASKS.md#proposed-feature-complete-ux-refresh).

## 1. Product direction

Make the passage the stable center of an exploration of language and meaning.
Within the first few seconds, a reader should understand the selected word's
available meaning, recognize the different kinds of connections, and see a
useful next passage to investigate. Reading Hebrew or Greek must not be a
prerequisite for discovering those connections.

The overview answers **What can these words mean? Where are we? When is this
happening?** before any word inspection. The core journey is
**read → notice → preview → compare → follow evidence**.
Each step adds context while preserving the reader's starting point.

Primary audience: an English-speaking reader curious about original-language
meaning. Experienced students retain access to morphology, identifiers,
statistics, source evidence, and existing research/export tools.

## 2. Current experience: findings and limits of this audit

This is a source and contract audit, not a completed visual usability study.
Reviewed: the application shell, navigation, reader, word dialog, research
panel, relationship explorer, state, API contracts, and project design/data
documents. Browser inspection was blocked by automatic approval review because
the active browser window showed an unrelated personal account page.

| Current behavior | Consequence for understanding |
| --- | --- |
| Introductory hero and instruction sections surround the study tools | Reading and discovery compete with introductory content. |
| Word inspection opens a blocking dialog | Following a word interrupts simultaneous reading of its passage. |
| Occurrences are reference chips; the dialog displays the first 30 | Users must navigate away to learn what a reference says; the remaining results have no continuation control there. |
| Related-word cards emphasize frequency, distance, and score | Users see measures before an explanation of the connection. |
| Nine research tabs expose prompt numbers, endpoints, and database terminology | Users must translate implementation concepts into study questions. |
| Maps and chronology appear as separate sections before research tools | Useful context increases distance between the passage and lexical discovery. |
| Base-Strong's groups retain multiple candidate lexemes and unassigned senses | A single confident meaning label would conceal real ambiguity. |
| Current English data consists of occurrence glosses and lexical renderings | Full readable English verse previews require an additional text source. |

The existing database capabilities are valuable foundations. The refresh should
make their evidence understandable and discoverable through a coherent interface.

## 3. Proposed workspace and first view

Desktop uses two primary columns: a generous reading area and an adjacent word
inspector. Connected passages sit directly below the reading area. A third
comparison column appears only when there is enough width; otherwise comparison
replaces the lower reading-area region while the source passage stays available.

```text
Bible Research   [Find a passage, word, or Strong's number]   Appearance
Passage reference / previous / next             Translation / reading options

READING AREA                                  WORD INSPECTOR
Complete English verse, named translation      Original form · transliteration
Original tokens + occurrence English           Available meaning / meaning here
Other English renderings beneath each word     Plain-language grammar
Transliteration; clickable place names         Rendering evidence across passages
                                              Same word elsewhere
CONNECTIONS FOR THE SELECTED WORD              Often appears with
Connection type · reason · passage excerpt     Related concepts / evidence
[Preview] [Compare] [Open passage]              Sources and deeper details

VISIBLE EVENT TIMELINE                         Research / export access
Era / selected event / linked psalms and narrative / model and uncertainty
WHERE: clickable places → focused map; source passage remains visible
```

At a typical 1280×800 desktop viewport, show the active reference, readable
English, original-language tokens with multiple English renderings, a short
word summary, a visible event timeline, direct place links, and at least one
connection with its reason without requiring a trip into a research console.
Long verses may extend the reader; the summary remains available beside it.

On first entry, suggest one informative word from the loaded passage using a
documented deterministic rule and available data. Label it “Suggested word.”
Prefer a content word with a definition and usable connections; do not silently
assert a token sense or replace an existing user selection. When no suitable
data exists, show “Choose a word to explore” with an obvious example action.

Passage lookup remains available through book/chapter/verse controls. The new
search accepts references, original words, transliterations, English concepts,
and Strong's identifiers, with clearly labeled result types and disambiguation.
An English concept search must never imply exact lexical equivalence. Preserve
all existing passage links and validate actual reference/edition coverage.

## 4. Help readers understand a word immediately

### Verse overview: show a word's range before selection

Each word shows its original form, transliteration, occurrence rendering labeled
“Here,” and a compact visible “Elsewhere” range of two to four representative
English renderings when supported. The range is present before hover or click;
it is not confined to a dropdown or the inspector. Additional renderings remain
reachable through an explicit More action. Short ranges wrap on phones. Function
words show their available rendering or grammatical role without invented variety.

Example layout for a supported occurrence of רוּחַ:

```text
רוּחַ · ruach
Here: [the source rendering for this occurrence]
Elsewhere: wind · spirit · breath · direction / side
```

The direction/side usage has a concrete comparison case in Ezekiel 42:16,
where H7307 is rendered as “side” in “east side”
([verse and word analysis](https://classic.net.bible.org/verse.php?book=Eze&chapter=42&verse=16)).
Audit the actual imported source before publishing the four labels in the UI.
These are uses across contexts, not a claim that all senses apply to every token.

Hover/focus on a rendering previews a real usage passage and the original word;
clicking filters occurrence evidence to that rendering without changing a private
translation choice. Compare two rendering groups to see how the same lexical
group is used across passages. Keep observed source renderings separate from
reviewed semantic categories and from different Bible editions' translations of
the same verse. Do not equate raw inflected gloss frequencies with sense counts.

The audit and SQL contract must collect evidence across word forms, preserve
homographs, provide the grouping method/source, and report partial coverage.
Existing surface-form alternatives alone do not establish a lemma-wide range.
Meaning groups require reviewed mappings; otherwise label them as observed
renderings. Never manufacture a fourth gloss or a contextual sense assignment.

The inspector's initial hierarchy:

1. **Identity:** original surface form, transliteration, language, and concise
   source gloss; show the dictionary form separately when available.
2. **Meaning:** an occurrence-specific English rendering followed by a short
   sourced definition. Label a contextual sense only when evidence supports it;
   otherwise say “Possible meanings” or “Meaning not assigned for this occurrence.”
3. **Grammar:** readable decoded features, for example “noun · singular,” with
   the raw code behind details. Explain the feature's relevance only when a
   sourced explanation exists; retain unresolved grammar explicitly.
4. **Connections:** a small representative set grouped by connection type,
   with a visible reason, relevant passage, and an action to explore further.
5. **Depth:** identifiers, full definitions, statistics, source releases, and
   other available metadata through progressive disclosure.

Selecting a word updates the inspector and its connections without moving the
passage. Hovering another word previews it without changing the selection.
Selecting a related word adds a breadcrumb so “Back to the original word”
restores the previous selection, filters, and position.

Retain occurrence-specific private English choices and reset. Show a quiet,
discoverable choice affordance under each token rather than making selection
controls dominate the reading rhythm. Changing a private rendering does not
modify the published English verse, shared statistics, or public evidence.
Do not add an empty “physical definition” section when no data exists.

## 5. Make the kind of connection explicit

| Reader-facing group | What it establishes | Initial presentation |
| --- | --- | --- |
| Same word elsewhere | Membership in the stated lexical group; current legacy counts use base Strong's | A book distribution and representative verse rows; exact scope and totals visible. |
| Often appears with | Observed co-occurrence under the stated corpus/method | Word, available gloss, shared-passage evidence, and a plain-language reason; raw score in details. |
| Related concepts | A sourced lexical, linguistic, textual, or interpretive assertion | Labeled relationship, summary, source, review state, and supporting passages. |
| Passages with a similar pattern | Reviewed narrative or intertextual evidence | A short sequence of passages, what repeats, what differs, and available counterexamples. |
| Hebrew–Greek translation links | Source-attested correspondence in a particular edition/context | Conditional future section dependent on the separate Septuagint queue. |

Show “Why connected?” on every relationship row or edge. Examples of useful
labels are “same base Strong's group,” “appears together in these passages,” and
“reviewed narrative parallel.” Co-occurrence is evidence of proximity; it does
not establish synonymy, derivation, or a theological conclusion. Score is never
rendered as a percentage confidence in meaning.

Offer a compact, directly labeled connection diagram as a secondary view:
selected word at the center, a few visible neighbors, typed edges, and one-step
expansion. Use the same returned evidence as the list, with equivalent keyboard
actions. Preserve a stable arrangement during preview. Broad corpus graphs and
continuous motion would make the first encounter harder to read.

Counts must distinguish token occurrences, distinct verses, returned examples,
word forms, and sense-specific evidence. Prefer “Showing 5 of N verses” with
“Load more” to a silently truncated list. Never narrow a base-Strong's total to
one sense without a verified sense assignment. A missing reviewed connection
means that no annotation is available in this dataset, not that none exists.

## 6. One preview language throughout the product

| Hover or keyboard focus target | Immediate preview content |
| --- | --- |
| Passage reference / occurrence | Full English verse, translation name, reference, connection reason, and matched original form or gloss where available. |
| Related original-language word | Original/dictionary forms where known, transliteration, English rendering range, short definition, relationship type, and one evidence passage. |
| English rendering under a word | Full evidence verse for that observed rendering, original form, edition/source and lexical grouping scope. |
| Connection label or diagram edge | What links the items, scope, representative evidence, and source/review state. |
| Grammar label | Human-readable features and unresolved parts; optional brief sourced explanation. |
| Place or date | Place role or chronology model, summary, uncertainty, and available evidence reference. |

Interaction rules:

- Pointer dwell of roughly 200–300 ms is a starting hypothesis to test. Cached
  content should appear immediately after the dwell; keyboard focus exposes
  equivalent information without pointer requirements.
- Moving from trigger to preview keeps it open. Escape dismisses it, and it
  stays available while being read. Hover never navigates, changes the selected
  word, moves focus, or edits a translation.
- A read-only preview leaves focus on its trigger. Controls such as Pin,
  Compare, and Open belong to an explicitly opened, accessible nonmodal detail
  surface, with predictable focus entry and return; they are not hidden inside
  a tooltip. A visible Preview action supplies this path for every input mode.
- Pointer users can pin a preview to keep it while comparing. Touch users tap
  the Preview action to open a sheet; Open passage is a separate explicit action.
- Show one transient preview at a time. References inside it do not start a
  chain of nested floating previews. Pinned comparison is the route to depth.
- Keep the triggering text visible where possible. Reposition at viewport
  edges; allow long verses to expand into a reading surface with the complete
  text accessible. Range previews identify the range and show the full relevant
  verse first, with an explicit action for the entire range.
- Display loading and retry in place. Distinguish a failed request from missing
  text or absent evidence. Do not replace a real verse with a sample on failure.

These rules follow the dismissible, hoverable, persistent behavior explained in
[WCAG's hover/focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).
The [ARIA tooltip guidance](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
distinguishes non-focusable tooltips from interactive nonmodal surfaces; that
pattern document itself is marked as work in progress.

## 7. Full English text is a foundation, with explicit boundaries

Recommendation for the source audit: evaluate the Protestant World English
Bible as the initial readable English edition. Its publisher describes it as
public domain and permits faithful reuse; the translation name identifies
unaltered text ([publisher information](https://www.ebible.org/find/details.php?id=engwebp)).
Pin the actual edition, files, version, and hashes before choosing an import.
This proposal has not audited its payload or established full reference parity.

Store readable verse text separately from interlinear glosses and private
choices. Audit mappings against the current corpus, including Psalm headings,
missing/split verses, edition differences, and reference conventions. Where
editions differ, show the difference or unavailable text honestly.

English highlighting must use verified token alignment. Without it, show the
complete English verse and identify the matching word in a separate original
text/gloss line. Do not infer precise English spans by matching similar strings.
An English translation's occurrence of the same English word does not prove
that the underlying Hebrew or Greek word is the same.

## 8. Compare and explore without losing place

Preview provides a quick reading. Compare pins the source and target passages,
their full English text, and available original-word evidence together. Open
passage explicitly navigates the reader and records a return path.

Maintain source passage, selected occurrence position, lexical candidate,
connection type, target passage, and list cursor as distinct state. A word ID
alone cannot distinguish repeated occurrences in one verse. Preserve legacy
`#book-chapter-verse` links; any richer sharing format must remain backward
compatible. Transient hover stays out of browser history. Browser Back should
restore intentional navigation and the prior reading position.

Example test journey: open John 1:1, choose λόγος, read the available gloss and
grammar, preview a real occurrence returned for its lexical group, then compare
the two passages. An unrelated English “word” result must not enter that exact
group. A subsequent Genesis/John connection requires separately labeled textual
or interpretive evidence; cross-language lexical identity is never inferred.

## 9. Visual direction and responsive behavior

Use a quiet scholarly reading environment: a restrained header, clear passage
title, generous text spacing, and fewer enclosing boxes. Replace the prominent
introductory hero with the live study workspace. Keep short onboarding help
available through an example or help action.

Use a readable English text face, a compatible Hebrew/Greek face with ample
diacritic clearance, and a clean interface face. Original script is prominent;
English meaning is immediately adjacent; transliteration remains legible.
Test actual font coverage and line breaks before choosing fonts. Provide light
and dark reading themes with consistent contrast and a saved preference.

Use one stable selection accent and restrained connection-type cues. Pair color
with text, line treatment, or shape. Avoid heat colors that suggest unsupported
certainty. Use motion only to clarify intentional changes, respecting reduced
motion. Keep technical endpoint names and payloads in research/export surfaces.

Wide desktop: reading area plus persistent inspector. Tablet: reader plus an
expandable inspector region. Phone: reader followed by a compact selected-word
summary; explicit detail sheets expose meaning, connections, and comparisons.
Keep full verses readable in the sheet and keep its close action reachable.
Avoid accumulating nested sheets. Comparison stacks the passages on narrow
screens, and every graph operation has an equivalent list action.

Test from 320 px through desktop widths, keyboard navigation, screen readers,
200% text enlargement and 400% zoom, bidirectional text, and approximately
44 px touch targets. The reflow target follows
[WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## 10. Existing capabilities and implementation boundaries

Make place and time first-class overview content. Keep the event timeline
visible by default; expand its evidence and the full map on explicit action.
Retain model alternatives, uncertainty, disputed places, symbolic-location
guards, attributions, and all existing research capabilities.
Group advanced work under study questions such as Find occurrences, Compare
words, Explore patterns, and Export research. Keep OpenAPI/MCP documentation
available in a developer/integrations area. Reuse the current research surfaces
behind these entry points before considering deeper internal restructuring.

All UI requests continue through BibleRPC; joins, word ordering, matching,
counts, pagination, and ranking remain in PostgreSQL. Reuse existing bounded
responses where practical. Plan additive bounded contracts for verse previews,
word overviews with rendering-group evidence and occurrence continuation,
verified place-name anchors, cross-passage event timelines, and discovery search. The latter
must return labeled ambiguous candidates rather than relying on a legacy
single-result resolver. Keep exact totals and stable pagination in SQL.
Preserve existing RPC/public MCP contracts. Audit actual required fields before
finalizing SQL.

Render passage text and visible word ranges before expensive research. Load
bounded timeline/place summaries automatically; defer the map canvas, extended
context evidence, graph and exports until needed. Load the selected word's
overview independently. Batch a small
set of visible preview targets, deduplicate in-flight requests, bound cache
size, and key public text by edition/reference. Keep private rendering state
separate. Prevent stale results during rapid hover, word changes, and navigation.
Do not fetch full occurrence corpora or 100-verse hydration packets for each hover.

Proposed performance objectives, to measure rather than claim as achieved:
cached preview content within 100 ms after dwell; a loading indicator within
100 ms after dwell for an uncached target; typical uncached verse text within
1 second on the agreed test connection. Measure cold/warm p50/p95 and request
volume. A slow statistical/semantic request must not block English text.

Septuagint work remains dependent on its separate source/schema approval and
coverage audit. Gematria remains optional metadata, not a substitute for
lexical evidence. Existing O5/M1 and other pending user checks keep their status.

## 11. Direct place-name interaction

Place names in original tokens, verified English spans, previews and evidence
rows are visibly actionable. Hover/focus shows the ancient name, available
modern identification, role in this passage and uncertainty. Click opens the
existing map focused on that place without changing the active passage. Keep
the name highlighted and make returning to the exact reading position simple.

Use place IDs and verified token/span anchors. Identical strings do not prove
the same place, and English entity spans require a verified edition mapping.
When a name is unresolved, offer candidate places rather than silently choosing
coordinates. Regional/disputed/symbolic references retain their existing guards.
If text anchoring is unavailable, show an explicit “Places in this passage” row
and state its context role instead of inventing an inline link.

A place-name click opens geography; an adjacent Word details action retains
lexical inspection. Keep the two actions separate and avoid nested buttons.
Distinguish event setting, mentioned place, writing location and audience.
An event linked to a psalm can supply contextual place information, labeled as
inherited context rather than as a place explicitly named in the psalm.

## 12. Visible event timeline and links across books

Below the verse, show a compact timeline with era/reign, the selected historical
event, and a few relevant neighboring events. The active passage is connected
to that event. A second aligned lane shows linked texts such as psalms and
narratives, so canonical book order does not hide their historical relationship.
All links show their reason and source, with full-verse previews and comparison.

Primary acceptance example: Psalm 3's superscription associates the psalm with
David fleeing Absalom; show its link to the flight narrative in 2 Samuel 15,
including 15:13–17. These are the historical books corresponding to this example;
also support genuine event links in Kings rather than forcing a Davidic example
into Kings ([Psalm 3 and narrative](https://www.biblegateway.com/passage/?search=2+Samuel+15-17%2CPsalm+3&version=NIV)).
Label the relationship “Historical setting from superscription,” rather than
claiming a securely established composition date. Psalm 18 / 2 Samuel 22 is a
candidate parallel-text fixture to audit separately. 2 Kings 18:13 remains an
existing chronology/archaeological-date regression case.

Separate historical setting, event mentioned, retrospective/prophetic reference,
and composition in the timeline data and labels. Same person, year or region
alone does not establish an event link. Use stable shared event IDs and retain
the association's exact reference, rationale, review state and source. Audit
current published event coverage and add reviewed associations only where needed.

Choose local-event scale by default; allow expansion to reign/era. Show BC/AD
estimates or ranges only when supplied by the selected model. Display uncertainty
as ranges; competing models remain selectable. If only relative sequence is
known, label it “Event sequence; dates uncertain” and avoid a proportional year
axis. Undated/unlinked texts remain explicitly unplaced with useful evidence
actions. Never synthesize dates to fill gaps or stretch an event-start date into
the dating of an entire psalm. Show a chronological text list on narrow screens
and for assistive technology.

Selecting a timeline event updates its evidence and contextual map target while
leaving the reading passage in place. Opening a related text navigates explicitly;
Compare preserves both. Synchronize model/era with the map where supported,
retaining the distinction between source-passage and preview-target context.

## 13. Delivery and validation strategy

**Design first:** review this proposal, audit live UI/data, and produce desktop
and phone wireframes covering no selection, selected word, ambiguous word,
preview, comparison, and unavailable-data states. Approve the hierarchy before
implementation. Proposed details may change in that design review.

**First usable milestone:** readable English text, refreshed reading workspace,
persistent word summary, visible word rendering ranges, mounted occurrence rows
and typed connection groups, full-verse previews, direct place-to-map links,
visible event timeline with cross-book evidence, keyboard/touch parity, and a
return path. Place/time are required in this milestone, not deferred enhancements.

**Second milestone:** passage comparison and the compact optional diagram.
Integrate remaining advanced research without crowding the reading surface.

**Validation:** use Genesis 1:1 and John 1:1 for RTL/LTR; repeated words in John
1:1 for occurrence selection; H5869 and H1254 for ambiguity; Psalm headings and
edition gaps for mapping; a high-frequency word for counts/pagination; reviewed
well/marriage examples with non-marriage controls for interpretive distinctions;
and offline, partial-data, long-verse, slow-response, and stale-response states.
Add ruach's wind/spirit/breath/direction-side evidence across inflections,
unknown and disputed place links, and Psalm 3/event connections with uncertain
dates. Verify that rendering-group selection never writes a translation choice.

Recruit a small formative group of roughly five readers spanning beginners and
experienced students. Proposed targets: at least four can explain the displayed
word summary and one connection within ten seconds; preview a complete verse
without leaving the source within fifteen seconds; compare passages and return
without losing selection within thirty seconds; and distinguish lexical
recurrence from interpretive relationship. Treat these as design targets,
not measured findings. Also require readers to recognize multiple English uses
before opening a word; open the correct place with one explicit action; and
explain the psalm/narrative event link without mistaking it for an exact
composition date. If missed, revise labels and hierarchy before adding depth.

During implementation, run the required pre-code/post-code pipeline one atomic
task at a time. Verify SQL mappings/counts and caller access, then meaningful
reader/preview/state regressions and required type/size/build checks. Update
obsolete tab-count assertions when the new navigation is deliberately approved;
retain coverage of the capabilities they protected. Complete visual user checks
before marking those tasks done. No production rollout or database changes are
implied by design acceptance; implementation is now authorized by the user.
