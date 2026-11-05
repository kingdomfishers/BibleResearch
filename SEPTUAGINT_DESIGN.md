# Direct Hebrew–Greek connections through the Septuagint

Status: proposed, awaiting the pre-code architecture approval. 2026-11-02.

## Reader behavior

Add a “Septuagint connections” section to the word inspector. A Hebrew or
Aramaic word lists the Greek equivalents recorded in the selected source;
a Greek NT word lists the Hebrew/Aramaic words associated with it through
those Septuagint records. Each result shows original forms, available glosses,
Strong's identifiers, source-attestation counts, and expandable evidence.
An available counterpart can be opened directly in the inspector.

The evidence view shows the source reference, original source identifier,
Hebrew form, supplied Greek equivalent and source attribution. Passage
navigation is available only for references verified against the reader's
versification. A Greek equivalent absent from the current NT vocabulary still
appears, with its source identity; no synthetic NT word ID is invented.

These are translation correspondences in context. One Hebrew word can have
several Greek renderings and one Greek word several Hebrew sources. A shared
Greek lexeme across LXX and NT does not establish the same sense in every use,
nor establish that an NT passage quotes a particular OT passage.

## Selected source and audit gate

Start with Clear Bible MACULA Hebrew's source-supplied Septuagint equivalents
and Hebrew/Greek Strong's identifiers. Its own license explicitly includes
these fields under CC BY 4.0:

- https://github.com/Clear-Bible/macula-hebrew/blob/main/LICENSE.md
- https://github.com/Clear-Bible/macula-hebrew

Required attribution: “MACULA Hebrew Linguistic Datasets, available at
https://github.com/Clear-Bible/macula-hebrew/”.

The license and README were inspected. The annotation payload has not yet
been fetched or audited in this session. Before schema implementation, pin
an actual commit and SHA-256 for each selected file, inspect field semantics,
check source references and Greek-edition metadata, and publish coverage.
The existing local MACULA inventory is metadata only; it does not establish
that the required evidence is already imported.

Import only cleared equivalence fields and their occurrence anchors. Exclude
external dictionary prose. Retain raw compound/private identifiers; normalize
only identifiers whose namespace is verified. Never strip a suffix and assume
the remaining number is a valid lexical identity. Ambiguous/private identifiers
remain unmapped with an explicit reason.

If the source supplies equivalents without LXX token positions, label records
as source-supplied equivalents. Do not present them as verified full-text token
alignments. LXX edition and reference are nullable when unspecified by source.
Full continuous LXX text and complete token alignment are a separate extension.

## Database and API extension

Use additive migrations and retain existing words, verses, IDs and RPC contracts.
Reuse source_releases with a genuinely pinned new release record. Store immutable
source evidence separately from its mapping to current corpus vocabulary.
Each evidence unit preserves occurrence/morpheme locator, raw identifiers,
supplied forms, source reference, mapping status and provenance. Preserve
multi-part correspondence groups without inventing pairwise token alignments.

Map WLC-based occurrence evidence to STEP only after checking reference,
forms, morphology and local sequence. Preserve differences including Qere/Ketiv,
affixes, additions and Psalm headings. Lexical-level mappings can be published
without claiming a verified occurrence-level projection. Aramaic stays distinct.

Add a versioned read-only RPC, provisionally get_word_lxx_connections_v1,
accepting an existing word ID and bounded pagination parameters. Return:

- query identity and matching granularity;
- counterpart identities and optional existing reader word IDs;
- exact distinct source-evidence totals and paginated evidence;
- source edition/release, mapping method and coverage limitations;
- separate empty, unresolved, unavailable and error states.

Compute both directions, counts, vocabulary matching, evidence joins and stable
ordering in PostgreSQL. Counts refer to distinct source evidence units, with
the denominator defined after the source audit; they are not automatically
whole-LXX occurrence totals. Index both lookup directions and release/locator
uniqueness. Use caller-RLS reads, explicit grants and no public writes.

Expose the same contract through BibleRPC, OpenAPI and the read-only public MCP.
Hydrated research gains an optional additive LXX field after standalone parity
is established. Keep lexical translation evidence separate from interpretive
graph assertions and statistical co-occurrence scores.

## Verification and rollout

Audit real source records before selecting exact acceptance examples. Verify
one-to-many and reverse lookups, repeated morphemes, absent NT vocabulary,
ambiguous/private IDs, reference changes, and unlinked evidence. Compare SQL
counts and pages against an independent import audit. Check caller privileges,
RLS and query plans on representative frequent and rare terms.

Verify inspector counterpart navigation, Hebrew RTL/Greek LTR, keyboard use,
stale responses, failures and small-screen evidence. Run type, size/TOC and
build gates, plus existing RPC/MCP regression suites. Publish measured coverage
and source gaps. UI acceptance follows the project's USER-CHECK procedure.
