---
name: pre-code
description: Find the smallest affected feature, understand relevant code, and plan a focused change before editing src/ or supabase/.
---

# Find ? Understand ? Change

1. Inspect branch and Git status. Preserve unrelated edits and identify any overlap before modifying files.
2. Identify the smallest affected feature and entry point. Use [PROJECTMAP](../../../PROJECTMAP.md) as a navigation index only; search with rg for paths, symbols and existing reusable functionality.
3. Read relevant headers/section anchors and immediate dependencies. Read more of the file when needed to understand behavior. Consult [ARCHITECTURE](../../../ARCHITECTURE.md) and linked designs only for relevant boundaries or contracts.
4. Plan the minimum edit and targeted verification. Prefer existing modules and cohesive local logic. Do not extract helpers merely on second use, introduce speculative abstractions, regenerate tests, or reformat unrelated code.
5. Aim for 1?5 implementation files including relevant tests. Before exceeding about eight files, investigate scope inflation; explain necessary dependencies and proceed within the justified scope.
6. Use [TASKS](../../../TASKS.md) only if this work belongs to its active objective or needs a durable multi-step plan. Do not create tasks or update architecture for every small request. Ask only for missing decisions that materially block the work.
7. For library/API usage fetch current Context7 documentation. Load applicable database/security skills before SQL changes. Choose local tests by inspecting their runtime and side effects; never infer safety from a verify- prefix.

Preserve section navigation incrementally. Legacy manifests and exact TOC matching are optional; no arbitrary file or section size mandates. Keep Cloudflare static-evidence and Supabase dynamic-data responsibilities intact. Production changes require separate authorization.
