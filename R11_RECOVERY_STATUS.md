# R11.5 recovery checkpoint

Worktree: C:/Projects/BibleResearch-r10
Branch: feat/r11-universal-discovery-engine
Recovered HEAD: 8dbdbb2 (Argon R11.3).

Argon completed corpus-wide indexes and discovery runtime; left 15 modified website/MCP/gateway files. Preserved all of them. Original checkout has unrelated modifications and was not changed.

Verified milestone: relationship routing follows manifest inheritance for discovery active pointers, preserves explicit releases; H7307/H7799, two passage frames, coverage, and H7307 -> G4151 pass locally under R10/R11 pointers. Reference strings are removed before lexical tokenization. All 145 legacy proximity-based auto-identifications are quarantined at runtime; builder stops publishing them. No corpus rebuild or source-data changes.

Passed: TypeScript, production build, original 14 R11 checks, expanded reference/auto-identification audit, new release-routing regression.
Remaining: holdout ground truth and benchmark; structured coverage states; numeric parsing; ranking audit; browser/MCP verification; asset integrity; deployments/live verification; final commit/push.
Observed failures: R10 regression assumes <=15 reads (R11 uses 24); browser test expects obsolete cluster heading; Node MCP tests need Deno import-map runtime (@modelcontextprotocol/server unavailable in Node).
Next action: run independent source-corpus holdout benchmark, then resolve browser assertions and MCP runtime. Production deployment authorized, not yet performed.

## Verified universal retrieval milestone

Runtime now balances six lazily loaded profiles across concepts, normalizes composed number phrases, removes passage references before lexical parsing, and ranks shared witnesses above background. Response metadata separates resolution, occurrences, higher-order connections, resource limits and missing assets; exhaustive is never globally asserted. Proximity scans use complete occurrence lists with a bounded sorted-window join, rather than top-50 truncation. Actual supporting profile identity is selected per verse.

Targeted lookup repair: run `node --experimental-strip-types scripts/repair-r11-lookup.mjs` after an index rebuild, followed by `node scripts/prepare-r10-asset-deploy.mjs --activate`. Repairs only 64 derived shards and manifests, retaining corpus evidence and previous releases.

Passed: 30 seeded independent lemmas against MACULA + STEP source ground truth (100% recall and precision; duplicate-free pagination); all named concept/pair direct-evidence checks and full Hebrew/Greek lily acceptance; R8 29/29, R9B 9/9 (R9B_TEST_ASSETS points to R11 bundle), R9C 19/19, R10 full discovery suite (retained legacy evidence checked across advertised pages), R11 expanded audit, MCP Deno test (41 tools), Deno check, TypeScript, build, desktop/mobile Playwright. Asset integrity: 13,932 files, 801 MiB combined; max 3.15 MiB; prior releases preserved.

Next: deploy corpus Worker using .artifacts-r10/deploy-bundle, website dist, and bible-mcp; verify live initialize/list/call, R8/R9 defaults and website. No deployments performed yet. Do not infer ChatGPT catalog refresh from server tools/list.
