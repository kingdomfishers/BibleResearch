# R13.1 deployment retest — 2026-11-23

## Conclusion

**BLOCKED / NO NEW DISCOVERY ENGINE EXPOSED.** Connected production BibleResearch MCP is still backed by corpus `r13-discovery-1`, source commit `838da3d84e1bcdb19ab9e5fff3dd1fb591474b09`, worker version `edd49ef6-44d8-4d0f-b398-f778568aa04c`, MCP protocol version `2.0.0`. This is the exact same release as [the frozen benchmark](R13_LIVE_BENCHMARK_2026-11-23.md). A controlled R13→R13.1 quality delta cannot be reported until the new runtime is deployed and independently identified.

## Deployment inventory (Cloudflare & Supabase live management APIs)

- Cloudflare `bibleresearch-corpus`: most recent deployment **2026-11-23 07:30:34 UTC**, version `edd49ef6-44d8-4d0f-b398-f778568aa04c` at 100% (same as baseline).
- Supabase `bible-mcp`: active function version **52**, last updated **2026-11-23 07:31:00 UTC** (same morning as frozen benchmark).
- Cloudflare website `bibleresearch`: deployment **2026-11-23 08:34:30 UTC** version `b5aae922-4b83-4d0b-894c-b19a3c83b618`; deployment **2026-11-23 08:35:15 UTC** version `4aa841d3-09c2-4eaf-9b6a-f553d8b42959`. Website has newer deployments than the corpus and MCP, but this alone does not prove the graph uses the new discovery algorithm.
- Staging corpus was last deployed **2026-11-18**, so it does not appear to be the new R13.1 target.
- The latest repository default-branch commit visible to GitHub search is `55c153b`, publishing the R13 benchmark, not an R13.1 implementation. Local unpushed work is unknown.

## Read-only retest: exact outcomes

| Query | R13 baseline | Current production MCP |
|---|---|---|
| `get_Word({word:"H0894",connections:15})` | Babel→balal H1101 missing from top | Still missing |
| `get_Word({word:"H5146",connections:10})` | Noah/comfort R13 wordplay #3 | Still #3 |
| `get_Connection({items:["H8247","H8245","H8246"],connections:12})` | `all_endpoints_connected=false` | Still false; 0 complete |
| `get_Connection({items:["H0120","H1818","H0127"],connections:20})` | `all_endpoints_connected=true` but inadequate evidence synthesis | Still true with same 2 claimed `complete_multi_anchor` records |
| `get_Connection({items:["Jeremiah 1:11-12","Exodus 25:33-37","Zechariah 4:2-14","Revelation 5:6"],connections:20})` | `all_endpoints_connected=false` | Still false; 0 complete |
| `get_Connection({items:["Genesis 2:7","Ezekiel 37:5-10","John 20:22","Revelation 11:11"],connections:20})` | `all_endpoints_connected=false` | Still false; 0 complete |
| `get_Passage({passage:"Jeremiah 1:11",depth:0})` vs `research({operations:[{op:"evidence",evidence_id:"r13:wp:H8247:H8245"}]})` | position 4 H0413 vs H2967 | Same mismatch |
| `research(evidence:"r13:wp:H8247:H8245")` | only Jeremiah 1:11, omits 1:12 | Same |
| `research(evidence:"r13:wp:H0894:H6489")` | false documented Babylon/Pekod shared-root | Same |
| `research(evidence:"r13:interp:21519:dem")` | false bones=breath explicit identification | Same |
| `research(evidence:"r13:wp:H8245:H6918")` | false attested watching/holy wordplay | Same |

These are focused regression checks, **not** a complete independent replay of the 44-query frozen baseline. Since the backend release and hashes match, there is no basis for claiming updated R13.1 accuracy.

## Required next action for Neon

1. Inspect the authoritative local workspace and its uncommitted implementation; verify the R13.1 code, worker bundle and static assets actually exist and tests pass. Do not overwrite work.
2. Deploy the **shared corpus discovery engine** first (new `corpus_release`, Worker version ID and source commit), including its versioned static assets and routes.
3. Deploy/update the **production Supabase bible-mcp** adapter if necessary. Confirm `research(lxx)` or another release-attestation response shows the *new* corpus release, Worker version and source commit. Refresh the ChatGPT BibleResearch connector if its tool schemas changed.
4. Verify the **website graph** calls the same new corpus discovery service and uses identical relationship IDs, evidence and ranking for equivalent inputs.
5. Publish code and release/verification reports to GitHub according to project policy; give the precise identifiers and an endpoint to retest. Then rerun all 44 frozen queries, 10 evidence checks and a separate novel held-out suite.
6. Never state algorithm performance improved based on website redeployment alone or compare old R13 against itself.

**Scope of this retest:** Production MCP behavior, Cloudflare Worker deployment metadata, Supabase edge-function metadata and GitHub commit search. No local checkout, website browser interaction, UI DOM or user workspace content was accessed or modified.
