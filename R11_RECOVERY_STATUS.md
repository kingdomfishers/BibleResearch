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
