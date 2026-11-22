# BibleResearch conventions

The seven-tool endpoint is `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`; public reads require no project secret. `/legacy/mcp` retains legacy signatures when explicitly needed.

Canonical books use IDs 1–66; Psalm verse 0 is a retained heading. Primary source tokens are STEP Hebrew/Aramaic OT and NA28-membership Greek NT. Word glosses are not continuous English translations; other editions need explicit attribution. Private reader translations are excluded from public packets.

Notes/DLM cards have `epistemic_layer: user_note`; preserve authorship and review status. Server write authorization, ownership, rate limits, and kill switches remain authoritative. Never expose credentials, private notes, or chain handles. Missing data and partial coverage must remain explicit.
