---
name: post-code
description: Review the intended diff, run relevant verification, record material changes and finish without unrelated staging or documentation churn.
---

# Verify ? Record ? Finish

1. Inspect the exact diff and status. Confirm the change matches the plan and preserves unrelated work. Check whitespace with git diff --check on intended paths.
2. For code edits run npm run check:types and directly relevant tests once. Inspect test runtime, inputs, service access and mutation behavior first. There is no npm run test:run command. On Windows use npm.cmd when needed.
3. Run npm run build for bundling/assets/import risks; broaden tests only for affected contracts or unresolved risks. npm run check:size is an advisory navigation/size review, not a demand to split files or synchronize legacy TOCs. Documentation-only edits need link/content checks, not an automatic full regression run.
4. Record pre-existing failures separately. Fix regressions caused by this change; do not launch unrelated repairs or repeat successful expensive tests without changed inputs. Use browser verification for meaningful interaction/rendering changes; request user verification only when necessary.
5. Update documentation only if actual content changed. Update PROJECTMAP for changed responsibility, location or important entry point, not exported-symbol inventories. Update ARCHITECTURE only for changed boundaries/invariants. Update an active task only when relevant; preserve unresolved acceptance criteria and blockers.
6. Keep database changes in versioned migrations and align affected contracts when in scope. Never automatically apply SQL remotely or deploy; those actions need authorization.
7. When a focused checkpoint is appropriate, stage explicit intended paths, inspect git diff --cached, and commit only that scope. Never use git add -A or include unrelated pre-staged work. Do not require a commit or user sign-off for every small UI change.
8. Report changed files, verification outcomes and remaining issues concisely. Stop when the authorized task is complete.
