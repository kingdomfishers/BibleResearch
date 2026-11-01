# Verse chronology and evidence design

Design: 2026-11-01. Status: proposed; implementation awaits the local pre-code
design gate. No chronology schema, importer, UI or AI worker is deployed.
Queue: C1-C12 in [TASKS.md](TASKS.md). Current runtime: [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Product decision

Give every existing passage a chronology record, aiming for an approximate date
or interval with an explanation. Show coverage honestly: a record with no
defensible estimate remains explicitly undated. Do not invent a year merely to
achieve numeric coverage. Separate narrative setting, composition context and
the times of events mentioned by the text; a verse can have several associations.

Use pinned Theographic JSON as the initial chronology source. AO Lab provides a
useful API projection of Theographic, not an independent witness. Preserve the
user's preferred model alongside source models. Future AI proposes revisions
with textual/archaeological evidence; reviewed, versioned releases drive the UI.

User confirmed: Adam was created approximately **4,000 years before Jesus'
resurrection**, rather than 4000 BC. This is a model premise, not an archaeological
finding. Preserve the relative premise even if its absolute anchor changes.

## 2. Source audit and choice

Pinned repository commit: `744355c7a5f38efd407bc67a5257c99aca9532bc`.
Reproduce: `node scripts/audit-chronology.mjs --download`; subsequent offline
checks: `node scripts/audit-chronology.mjs`. Raw snapshots and the complete
per-book report are in ignored `.artifacts/chronology-audit/`.
The script validates pinned SHA-256 hashes before examining any records.

| Audited item | Result |
| --- | ---: |
| Theographic verses | 31,102 |
| Verses with an integer `yearNum` | 28,024 |
| Verses without `yearNum` | 3,078 |
| Events with parseable start years | 450 |
| Distinct verses linked from events | 15,619 |
| Verses with a year or event link | 28,648 |
| Verses with neither | 2,454 |
| Dangling event-to-verse links | 0 |
| Live app passages / Psalm headings | 31,203 / 116 |
| Live app populated `millennium` values | 0 |
| Same-address STEP/Theographic candidates | 31,085 |
| Same-address candidates with `yearNum` | 28,007 |
| Local passages with no same-address source | 118 |

Live counts were read from project `ejoperxiwxlcbsqrkrvb` on the design date.
Address comparison uses the existing local STEP import audit, not an independent
text-alignment check. The 118 include all 116 headings. Matching an address is
only a candidate mapping: KJV and STEP English/NRSV versification must be audited.
Psalm titles and edition-specific omissions require explicit rules.

Theographic's verse-year layer derives from Ussher through Torrey's Treasury
of Scripture Knowledge. Its event layer follows Floyd Nolen Jones, with an Acts
contribution credited to Todd Atwood. These are distinct model inputs. Import
them as attributed chronology assertions, never as independent archaeological
confirmation. Preserve disagreements rather than blending them into one date.
[Source explanation](https://github.com/robertrouse/theographic-bible-metadata/blob/744355c7a5f38efd407bc67a5257c99aca9532bc/docs/chronology-and-dates.md).

AO Lab's live dataset catalog reports 24,547 entity-linked verse records and 450
events for Theographic. That is not a count of dated verses and does not replace
the upstream verse-year table. Its dataset digest at inspection was
`1c33d01b3c7a97251d5a8e326e2b36a191c44ecaee08fc291fe038335825e860`.
Prefer upstream JSON for `yearNum`, event dependencies, durations and provenance;
retain AO Lab URLs as optional adapters after a semantic parity audit.
[Live catalog](https://bible.helloao.org/api/available_datasets.json),
[API reference](https://bible.helloao.org/docs/reference/datasets/).

Keep CC BY-SA 4.0 attribution, version links and transformation notices with the
Theographic-derived dataset and in the UI. Track underlying notices separately;
the AO Lab software license does not replace a dataset's license. Import metadata
needed for chronology, rather than replacing the app's STEP original-language text.

## 3. Dates and model assumptions

Use integer astronomical years internally, including year zero. Display a year
`y <= 0` as `1 - y` BC; positive years as AD. Thus source `-4003` means 4004 BC.
Preserve raw date strings and their source convention. AO Lab's simplified
negative-year documentation must not override the pinned upstream convention.

Store earliest/latest years, optional preferred year, precision and estimate
method. A single source year does not imply one-year historical certainty.
Store calendar dates separately when supplied; never manufacture month/day
precision. Retain durations, predecessor relations, lag types and range flags.
Do not use JavaScript Date parsing for BCE conversion or fractional `sortKey`
values as dates. Test 2 BC, 1 BC, AD 1 and intervals crossing the era boundary.

The user model stores the relation `Adam creation ≈ resurrection - 4000 years`.
Proposed initial absolute scenario: resurrection in AD 30, following the imported
event framework. This gives an illustrative Adam anchor around 3971 BC; AD 33
would give around 3968 BC. Both calculations assume elapsed astronomical years.
Neither absolute scenario is a user-confirmed historical fact; the selector and
assumptions panel expose the chosen resurrection year and the approximate offset.

Do not translate every biblical date by a fixed offset to satisfy the Adam anchor.
Use explicit genealogical/regnal/event constraints, with the text tradition,
inclusive-counting convention and disputed gaps recorded. Historical anchors can
conflict with a model; retain the conflict and its competing explanations. An
approximate 4,000-year premise does not justify an invented statistical error bar.

## 4. Logical SQL contracts (proposed, not executable DDL)

Use additive chronology tables linked to existing `verses.id`. Existing word IDs,
RPC signatures and STEP text remain compatible. Use bigint identity internally,
string IDs in JSON. These table names are local to chronology so the feature can
ship before the larger relationship graph; later integration uses explicit mappings.

| Table | Required fields and invariants |
| --- | --- |
| `chronology_sources` | Dataset/version, commit, file/hash, locator, author, license, attribution and immutable raw metadata record; unique source namespace/record/version |
| `chronology_models` | Named source or user model, assumptions, date convention, resurrection anchor and relative Adam constraint; immutable model versions |
| `chronology_events` | Namespaced source ID, title, source locator, original start/date/duration/range flag; source version retained |
| `chronology_event_links` | Passage/event association, reference-system mapping, relationship (`setting`, `mention`, `retrospective`, `prophetic`, `uncertain`), evidence and review state |
| `chronology_assertions` | Model/version, passage/event, axis, earliest/latest/preferred year, precision, estimate method, rationale, author, source record and superseded assertion; bounds checked |
| `chronology_evidence` | Textual / archaeological / model-premise / scholarly-interpretation category; citation, exact locator, original summary, dating method, uncertainty, scope and evidence provenance |
| `chronology_assertion_evidence` | Supporting / challenging / contextual relationship, explanation and direct / inherited applicability; foreign keys prevent dangling citations |
| `chronology_revisions` | Append-only proposal and review history; model/prompt/input hashes for AI, proposer, reviewer, decision, timestamp and explicit parent version |
| `chronology_runs`, `chronology_assignments` | Immutable published release and one status row per existing passage/model; selected assertions or explicit unresolved state; active-run switch is atomic |

Evidence needs separate bounds for the object's manufacture/deposition and the
historical event it describes. Archaeological relevance can contextualize a
passage without independently dating its composition or every event it mentions.
Source chronology is an interpretation category even when it cites biblical text.

Resolve associations, constraints, inheritance, competing assertions, coverage and
millennia in PostgreSQL. An offline importer parses/validates source files only;
the browser requests and renders packets. Index passage/model/run lookups and
foreign-key joins; verify query plans against the full corpus.

RLS and explicit grants expose published data only. Public clients and the MCP
remain read-only. No public AI write/promotion endpoint. An authenticated offline
review process owns candidates and releases; no service credential in the browser.
Prefer invoker functions with explicit schemas/search paths and bounded inputs.

## 5. Coverage and fallback policy

1. Audit source references against STEP; publish accepted mappings only. Treat
   all same-address matches as candidates until the versification audit passes.
2. Import source verse-year assertions separately from event assertions. Event
   membership alone does not make its start date the setting of a verse.
3. Add reviewed passage-level context intervals where source years are absent.
   Each inherited date names its parent passage, evidence and inference method.
4. Use broader reviewed book context only when appropriate. Composition context
   must stay labelled composition; it cannot silently fill the narrative-date field.
5. Give timeless claims, retrospections and prophecy their proper associations.
   Do not date creation to the first century because John 1 was written then, or
   date a predicted event to Revelation's composition year.
6. Headings can inherit a Psalm context with an explicit heading label, after
   reference alignment. Never copy adjacent/canonically ordered dates blindly.
7. Publish status coverage for all 31,203 records and separate counts for actual
   year/range coverage, inherited estimates, conflicting and unresolved cases.

Widening a range can express uncertainty, but an unsupported whole-history range
is not useful dating. The 2,454 source gaps need additional documented work;
neither upstream source currently establishes a defensible year for every verse.

## 6. Evidence pilots and visible disagreements

| Passage / case | Initial behavior and verification purpose |
| --- | --- |
| Genesis 2:7 | Source model: around 4004 BC. User model: approximately 4,000 years before resurrection. Show Genesis 2 and genealogical derivation as textual/model evidence; do not claim archaeology establishes Adam's creation year. |
| Acts 2:1 | Source verse-year is AD 33; linked Pentecost event is AD 30. Render alternatives with their distinct chronology sources, rather than silently selecting the event date. |
| John 1:1 | Source has neither verse year nor linked event. Explain undated content; any sourced composition context appears on its own axis. |
| 2 Kings 18:13 | Source verse year `-712` displays as 713 BC. Investigate competing archaeological context for the Assyrian campaign in 701 BC; preserve the disagreement. |
| Revelation 1:1 | Source verse-year AD 96 is a source placement assertion. Do not turn it into the date of the events predicted in the book. |

Archaeological pilot: the British Museum's Taylor Prism description reports
Hezekiah's tribute in the 701 BC campaign. The Israel Museum likewise links its
Sennacherib prism exhibition to 2 Kings 18-19 and parallel passages. Those museum
records identify a useful evidence candidate, not blanket support for every
chronological claim in those chapters. Full object pages were inaccessible during
this audit; verify catalog locators and scholarly dating before publishing a
reviewed evidence row. No museum image or inscription transcription was copied.
[British Museum catalog image description](https://www.britishmuseum.org/collection/image/426311001),
[Israel Museum exhibition](https://www.imj.org.il/en/exhibitions/special-display-assyrian-campaign-judah-told-sennacherib-prism).

## 7. Reader and AI contracts

Add proposed read RPC `get_verse_chronology_v1(p_book, p_chapter, p_verse,
p_model_id, p_run_id, p_evidence_cursor)` behind `BibleRPC.getVerseChronology`.
The initial request omits run/cursor to select the current published run; subsequent
pages pin that run. Validate reference bounds in SQL, including supported verse 0.
Use deterministic evidence pagination, a maximum 20 assertions / 20 evidence
items per page and a 50 KiB packet limit. Return truncation and continuation
explicitly; benchmark the limits before release.

Return passage/reference mapping, model/run, assumptions, status, date axes,
ranges/preferred dates, estimate method, evidence IDs/categories/citations,
supporting and challenging explanations, alternatives, coverage and cursors.
Invalid model, unavailable release, empty coverage and request failure have
distinct statuses. No unavailable or network response should be presented as a date.

The reader gets a chronology card below the passage and a summary in navigation:

```text
Genesis 2:7                         Chronology model: User premise [change]
Approx. 4,000 years before the resurrection
Illustrative absolute placement: around 3971 BC
Assumptions: resurrection AD 30; approximate relative offset 4,000 years
Basis: model premise and textual interpretation | Review: initial model

Textual evidence        Genesis 2:7; genealogy constraints [view derivation]
Archaeological evidence No reviewed archaeological date evidence attached
Other model             Theographic/Ussher: around 4004 BC [view source]
Revision history        Source version, changes and reviewed proposals
```

The example is proposed UI copy, not a populated result. Evidence controls show
citations, original summaries, dating method, scope, uncertainty and why the item
supports or challenges this assertion. Distinguish absent evidence from evidence
against a date. Do not label an AI proposal reviewed or a source placement verified.

Reuse `appState` for passage navigation and `BibleRPC` for all requests. Keep model
selection in separate local state; preserve existing `#book-chapter-verse` links.
Discard stale requests on passage/model changes. A chronology request failure must
not prevent the original-language reader from rendering. Render source text with
safe DOM text nodes, validate external links, and verify mobile/keyboard access.
Use callbacks for badge updates rather than modifying another component's DOM.

Do not populate legacy `verses.millennium` with one global model. Derive a selected
model's millennium from its Adam anchor in SQL; display a span if an interval
crosses boundaries, or unknown if the model has no such anchor. Avoid forcing
dates into the legacy 1-7 range. Keep old RPC results compatible.

Future AI workflow: ingest a licensed cited source, record evidence and input
versions, propose changed ranges/constraints with support and counterevidence,
validate citations and chronology invariants, review the diff, then publish a new
immutable run atomically. Record model identifier, prompt hash, input hashes,
time, previous assertion and review decision. Rejection preserves history;
rollback changes the active run pointer. Candidate AI confidence is separate from
evidence strength and review status. This release prepares that path; it does not
promise an autonomous archaeological research service.

## 8. Release gates

- Pinned-source checksums and offline audit reproduce; attribution survives import.
- Reference mapping handles headings, edition differences, splits/merges and
  rejected mappings, with no silent same-address assumptions.
- Source years, events and composition remain separate; date-boundary and AD 30/33
  relative-anchor fixtures pass; conflicts never disappear on model selection.
- Every existing passage has a status assignment; report numeric date coverage
  separately and retain undated cases. Full numeric coverage is not yet achieved.
- Archaeology pilot has a verified catalog/publication locator, scope and review;
  absence of archaeological evidence is displayed honestly for Genesis.
- Public roles cannot read drafts or write/promote revisions. Published RPCs are
  tested under public credentials, with bounded output and indexed lookup plans.
- Reader races, model changes, offline/error/empty states, BCE/range labels,
  evidence links, keyboard and mobile rendering pass browser checks before sign-off.
- Existing type, size/TOC, build and Bible/MCP regressions pass. Published run can
  be rolled back without changing original-language text or old RPC contracts.
