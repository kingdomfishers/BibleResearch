# CHRONOLOGY_API.md — Versioned Biblical Chronology Contract

Updated: 2026-11-01. Architecture: [CHRONOLOGY_ARCHITECTURE.md](CHRONOLOGY_ARCHITECTURE.md).

## 1. Endpoint & Invocation

- **PostgreSQL RPC:** `public.get_verse_chronology_v1(p_book integer, p_chapter integer, p_verse integer, p_model_id text default 'theographic-verse-v1', p_run_id text default null, p_evidence_cursor text default null) returns jsonb`
- **PostgREST Endpoint:** `POST /rest/v1/rpc/get_verse_chronology_v1`
- **Public MCP Tool:** `get_verse_chronology_v1` (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`)
- **Public MCP Prompt:** `study_chronology`
- **Frontend Gateway:** `BibleRPC.getVerseChronology(p, modelId, runId, cursor)` in `src/api/rpc.ts`
- **Security:** `SECURITY INVOKER`, `STABLE`, `PARALLEL SAFE`. Public `anon` and `authenticated` roles have `SELECT`-only access to published runs and assertions; candidate/draft assertions and publication RPCs are restricted.

## 2. Published Models (`chronology_models`)

| Model ID | Name | Coverage (`31,203` passages) | Scope |
| --- | --- | --- | --- |
| `theographic-verse-v1` | Theographic Verse Year (Ussher-derived source placement) | 31,203 status assignments | Source-attributed verse placement from `robertrouse/theographic-bible-metadata` (CC BY-SA 4.0) |
| `theographic-events-v1` | Theographic Event Associations | 31,203 status assignments | Associated event start years and durations (`mentioned_event` axis) |
| `adam-resurrection-30-v1` | Relative Adam Anchor (4,000 yr before AD 30 Resurrection) | 31,203 status assignments | User-confirmed relative premise (`3971 BC` / `-3970` astronomical) on cited creation context |
| `adam-resurrection-33-v1` | Relative Adam Anchor (4,000 yr before AD 33 Resurrection) | 31,203 status assignments | User-confirmed relative premise (`3968 BC` / `-3967` astronomical) on cited creation context |
| `archaeology-pilot-v1` | Reviewed Archaeological & Inscriptional Pilot | 31,203 status assignments | Reviewed synchronisms (e.g., Sennacherib's 701 BC campaign in 2 Kings 18:13, Taylor/Jerusalem Prism) |

## 3. Response Schema (`schema_version: 1`)

```json
{
  "schema_version": 1,
  "status": "ok",
  "passage": { "book": 12, "chapter": 18, "verse": 13, "is_heading": false },
  "assignment_status": "estimated",
  "model": { "id": "archaeology-pilot-v1", "name": "...", "assumptions": {} },
  "run": { "id": "...", "label": "...", "coverage": { "passages": 31203, "dated": 1, "unresolved": 31202, "conflicting": 0 } },
  "summary": {
    "axis": "setting",
    "earliest_year": -700,
    "latest_year": -700,
    "label": "around 701 BC",
    "millennium_first": 4,
    "millennium_last": 4
  },
  "assertions": [],
  "evidence": [],
  "alternatives": [],
  "history": [],
  "models": []
}
```

## 4. Epistemic Guardrails

1. **Astronomical vs. Display Years:** Internal `earliest_year` and `latest_year` use astronomical numbering (`0 = 1 BC`, `-3970 = 3971 BC`); `date_label` and `summary.label` render human-readable `BC`/`AD` labels.
2. **Object vs. Event Dates:** Archaeological evidence separates `object_year` (e.g., `691 BC` prism inscription) from `event_year` (e.g., `701 BC` campaign).
3. **Unresolved Passages:** Passages without a supported setting date return `assignment_status: "unresolved"` and `summary.label: "No setting date established"`.
4. **Packet Cap:** Responses are bounded to `<= 20` assertions, `<= 20` evidence items per cursor page, and `<= 50 KiB` total JSON payload.
