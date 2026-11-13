# Repository cleanup report

Measured in the local checkout on 2026-11-13, branch phase0/reconcile-and-verify. No production SQL, deployment, API migration, source rewrite or recovery operation was performed.

## Measurements

All sizes are bytes in the working tree, not token estimates. The baseline includes existing local edits. Tracked count uses git ls-files (including the pre-existing deleted tracked handoff); Markdown totals exclude that absent file and untracked user documents.

| Metric | Before | After |
| --- | ---: | ---: |
| Tracked files | 400 | 401 (this report is the only new file) |
| Existing tracked Markdown, excluding this new report | 600,287 | 517,579 |
| Six active workflow/navigation documents below | 125,898 | 43,190 |
| AGENTS + both coding skills combined | 12,361 | 7,733 |

| Document | Before bytes | After bytes |
| --- | ---: | ---: |
| [AGENTS.md](AGENTS.md) | 4,010 | 3,726 |
| [.agents/skills/pre-code/SKILL.md](.agents/skills/pre-code/SKILL.md) | 4,519 | 1,919 |
| [.agents/skills/post-code/SKILL.md](.agents/skills/post-code/SKILL.md) | 3,832 | 2,088 |
| [PROJECTMAP.md](PROJECTMAP.md) | 63,090 | 8,851 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 33,302 | 9,461 |
| [TASKS.md](TASKS.md) | 17,145 | 17,145 |

The six-document working set is 65.7% smaller by bytes; combined instructions are 37.4% smaller. These are measured text reductions, not measured model token savings or development-speed improvements. Total Markdown including this report equals 517,579 plus this report's byte size. Specialized design/recovery documents remain available on demand.

## Audit findings and changes

- Old intake required reading the queue, architecture/spec updates, decomposition and queue entries even for small requests. Both skills could stage everything and commit unrelated local edits. Second-use helper extraction required more source files and metadata changes. Post-code required exact TOCs, arbitrary splits and a broad registry update.
- Batch A rewrote [AGENTS.md](AGENTS.md), [pre-code](.agents/skills/pre-code/SKILL.md) and [post-code](.agents/skills/post-code/SKILL.md) around targeted context, minimal edits and risk-based verification. Library documentation lookup remains required when applicable. The nonexistent generic test runner is explicitly disclaimed rather than invented.
- Batch B replaced the oversized symbol/candidate registry with feature navigation and reduced architecture to current boundaries, flows, invariants and specialized links. Historical architecture is recoverable with git show b3ae8fc:ARCHITECTURE.md; the old navigation is available at the same revision. Retained details include homograph conceptual grouping without losing sense identities, evidence tiers, restricted fields, notes security and the separately gated reclamation scope.
- [TASKS.md](TASKS.md) was already modified by the user and contains unresolved approval/acceptance details. It was deliberately preserved byte-for-byte. Its completed notes subsection can be trimmed later with the ongoing reconciliation work; this cleanup does not overwrite it.
- Batch C consolidated three size-check implementations (inline 200-line command, inline 450/80/TOC command and standalone checker) into [scripts/check-size.mjs](scripts/check-size.mjs). Both npm command names remain valid. Existing section markers are retained; file/section length and duplicate anchors are advisory. No source files were split or rewritten.
- [.gitignore](.gitignore) now excludes new Supabase CLI temporary state. Existing tracked temporary entries remain tracked to preserve unrelated changes. Existing dist/, .artifacts/, node_modules/, environment and Python-cache ignores were sufficient; no generated assets were untracked.

Scope: five instruction/navigation documents, two tooling/config files, one ignore file and this report. The implementation-tooling change touches only two files. The larger overall count comes from the expressly requested documentation batches, not feature refactoring.

## Scripts, fixtures and document classification

The tracked scripts tree has 171 files, including 111 verify-/audit- files. The audit enumerated sizes, scanned tracked text references by filename, examined npm scripts, the publish workflow, Worker asset configuration and representative script headers/side effects. Static reference absence is evidence for review, not proof of disuse: scripts may be run manually. No claim is made that every live test has been executed.

| Classification | Files/families | Evidence and disposition |
| --- | --- | --- |
| KEEP | Source, migrations, data/, import-*, etl-*, build/export pipeline, Worker/security modules | Runtime/import paths, workflow generation and current dynamic/static architecture; retain pinned source inputs and provenance |
| KEEP | scripts/fixtures/*, verify-* and audit-* regression families | Reader, original-language identity, canonical mappings, lexical evidence, notes, security and corpus checks have different contracts; similar names do not establish equivalence |
| KEEP | Recovery/backup/reclamation/restore/preflight tooling and reports | Pending queue gates and checkpoint/approval runbooks reference recovery capabilities; never run as routine cleanup checks |
| KEEP | Specialized designs, source rights, provenance, integration/skill contracts | Authoritative details remain linked on demand; no whole-document auto-loading |
| CONSOLIDATE | package.json check:size/check:lines and scripts/check-size.mjs | Confirmed overlapping size implementations; completed consolidation with stable command names |
| ARCHIVE candidate | Historical audit/verification reports | Keep at existing paths for now; Git history and on-demand navigation avoid routine context cost without breaking links |
| DELETE | None proven safe and useful to remove in this checkout | No tests, migrations, data, licenses, recovery archives or production scripts removed |

Removed files: zero. Consolidated functionality: three structure-check implementations into one. No speculative helper consolidation or test regeneration.

## Remaining candidates (no removal approved or attempted)

- [scripts/verify-audit-01.mjs](scripts/verify-audit-01.mjs): no other tracked text filename references found in the audit scan; header covers security lockdown, restricted fields and backup-vault checks. Retain until ownership/coverage review proves those checks are preserved elsewhere.
- [scripts/verify-audit-02.mjs](scripts/verify-audit-02.mjs): likewise no tracked filename references found; network/corpus checks require contract comparison before archive or deletion. Filename age is insufficient evidence.
- [scripts/audit-notes-prereqs.mjs](scripts/audit-notes-prereqs.mjs): referenced by [DATA_MODEL.md](DATA_MODEL.md); likely historical preflight but retain until the reference and operational use are resolved.
- Historical [ARCHITECTURE_INDEPENDENT_AUDIT.md](ARCHITECTURE_INDEPENDENT_AUDIT.md), [MIGRATION_VERIFICATION_REPORT.md](MIGRATION_VERIFICATION_REPORT.md) and [COVERAGE_REPORT.md](COVERAGE_REPORT.md): possible archive relocation only after checking inbound links and separating live gates from historical observations. Current locations remain intact.

Any later uncertain deletion should present its exact paths and replacement-coverage evidence for approval first. No approval is needed merely to retain these files.

## Verification

| Check | Baseline | Final |
| --- | --- | --- |
| npm.cmd run check:types | Pass | Pass |
| npm.cmd run check:size | Pass under old hard rules | Pass, 56 files, zero advisory notices |
| npm.cmd run check:lines | Not run (obsolete conflicting 200-line policy) | Pass; same shared checker |
| npm.cmd run build | Pass; existing large-chunk warning | Pass; same generated asset hashes and large-chunk warning |
| Intended-path git diff --check | Each batch | Pass |
| Rewritten-document relative links | Not applicable | 145 links resolve across the five rewritten documents |
| Checker syntax and temporary smoke input | Not applicable | Pass; no manifest required, oversized file/section and duplicate anchors advise with exit 0 |
| Unrelated-work preservation | Saved initial status and SHA-256 fingerprints | All initial modified/untracked file hashes unchanged; initial deleted handoff stays deleted |

The first npm attempt was blocked by PowerShell execution policy; npm.cmd worked without changing system policy. A checker regex escaping error introduced during editing was caught by syntax validation and corrected before commit. Python's launcher was unavailable for audit scripting, so local measurement used Node. No pre-existing typecheck/size/build failures were found. No live database tests or browser journey tests were needed because application behavior was untouched.

## Representative small change: improve a translation-choice label

Hypothetical only; no application edit was made.

| Step | Old instructions | New instructions |
| --- | --- | --- |
| Locate | Read TASKS, check architecture and read the 63,090-byte registry; potentially create tasks/spec updates | Use the 8,851-byte map's reader row, then targeted search |
| Understand | Read TranslationChoice header and target section; classify helpers/candidates across registry | Read [TranslationChoice.ts](src/ui/components/TranslationChoice.ts) logic:translation-label, its call sites/types and immediate dependencies only |
| Edit | Could trigger candidate promotion, helper extraction, TOC/candidate updates and registry sync | Change the existing label function; add/update a relevant test only if behavior warrants it |
| Verify | Mandatory type/size/TOC checks plus task track; generic nonexistent runner or user sign-off loop | Typecheck plus the directly relevant existing translation check after inspecting prerequisites; browser interaction if rendering behavior changes |
| Record | Queue update, candidate/module registry updates, broad staging checkpoint | Inspect intended diff, explicit-path staging when appropriate; no architecture/queue/map edit for an unchanged responsibility |

The new path does not load architecture or TASKS for this independent label change. Exact source-context and test-runtime savings depend on the change; no speed or token number is asserted.
