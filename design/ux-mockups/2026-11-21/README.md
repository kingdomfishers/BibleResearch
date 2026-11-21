# BibleResearch UX Mockups — 2026-11-21

These are **static SVG design illustrations** for implementation planning, not screenshots of the currently deployed application. They supplement `UX_STRATEGY.md` and `research/r12/NEON_UX_IMPLEMENTATION_PROMPT.md`.

| File | Focus |
| --- | --- |
| [01 Discovery workspace](01-discovery-workspace.svg) | Sticky research trail; full verse; rich original/transliteration/alternate meanings; evidence-first connections; local graph. |
| [02 Chapter & interlinear](02-chapter-rich-interlinear.svg) | Seamless chapter mode; always-visible alternatives; structure and lexical repetition; concise word focus. |
| [03 Passage comparison](03-side-by-side-verse-comparison.svg) | Pin A/B, both complete texts, verified alignment/highlights, drag-to-compare, comparison actions. |
| [04 Context tools](04-context-tools-jerusalem-menorah-feasts.svg) | Jerusalem etymology hypotheses + map, Melchizedek family context, menorah object, Pesach calendar. |
| [05 Mobile exploration](05-mobile-rabbit-hole.svg) | Compact fixed top trail, meaningful inline words, inspectable evidence, mobile next steps and actions. |

The screenshots are **concept mockups**, so the words and data shown inside are illustrative, not validated output from the live corpus. Source validation, graph edges, verse editions, and visual/citation accuracy are governed by the current project strategy.

## Core implementation rules

1. Build the reversible relationship path first: follow, fork, back/forward and inspect each edge; graph is an optional view over same state.
2. Keep true WEB English verses and interlinear source glosses distinct; visible alternative meanings are lexical possibilities, not assigned contextual senses.
3. Display original-language script, transliteration, observed English and selected root/other meanings without needing hover/click.
4. Make comparison real, simultaneous and accessible; keyboard Pin A/B must work wherever drag-and-drop works.
5. Keep Strong's, gematria and deep metadata discoverable but secondary.
6. Do not copy visual claims (e.g., etymology/wordplay) into fact tables without a source; especially distinguish proposed name origin from biblical literary association.

See [UX_STRATEGY.md](../../UX_STRATEGY.md) for precise interaction algorithms, component ownership, acceptance tests and phased delivery.
