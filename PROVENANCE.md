# PROVENANCE.md — Source Provenance, Licensing & Derivation Rules

Updated: 2026-11-06. Companion docs: [DATA_SOURCES.md](DATA_SOURCES.md), [DATA_MODEL.md](DATA_MODEL.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Mandatory Provenance Contract

Every imported or deterministically derived relationship and annotation in the Canonical Biblical Lexical & Evidence Database preserves seven traceable fields:

1. **`source_release_id`** (`public.source_releases`): Pinned upstream dataset, repository URL, Git commit SHA, and license.
2. **`source_edition_id`** (`public.source_editions`): Specific textual or lexical edition (`tahot-2026-11`, `tagnt-na28-2026-11`, `tbesh-2026-11`, `tbesg-2026-11`, `abbott-smith-1922`, `webp-2026-11`, etc.).
3. **`source_record_id`**: Exact upstream record locator (e.g., `TAHOT:Gen.1.1#01`, `TBESH:H0430G`, `TAGNT:Jhn.1.1#05`, `OpenBible:a98e1b`).
4. **`relation_type`** (`public.relation_types`): Typed predicate constrained by category and `implies_synonymy` invariants.
5. **`supporting_span_ref` / `external_citation`**: Textual verse/token span or external authority citation.
6. **`origin_mode`**:
   - `'directly_imported'` — Explicitly stated in the pinned upstream source file.
   - `'algorithmically_calculated'` — Deterministically parsed or calculated by a versioned rule without AI/LLM inference.
   - `'user_authored'` — Private reader interpretation isolated to `owner_user_id = (select auth.uid())` via RLS (never exposed publicly).
7. **`derivation_method` & `algorithm_version`**: Exact rule identifier (e.g., `step_tahot_dstrongs_parse`, `step_tbesh_ustrongs_hierarchy`, `step_tagnt_conjoin_word`, `step_tahot_eng_heb_versification`) and deterministic version (`v1.0.0`).

---

## 2. Pinned Upstream Releases & Licensing Boundaries

| Release Key | Upstream Repository / Edition | Pinned Commit / Version | License | Licensing Boundary Enforced |
| :--- | :--- | :--- | :--- | :--- |
| `stepbible-data-2026-11` | `STEPBible/STEPBible-Data` (`TAHOT`, `TAGNT`, `TBESH`, `TBESG`, `TIPNR`) | `be4191f0082aeedddb0eff0c02c966292b2bd641` | CC BY 4.0 | **Strict Exclusion:** `TBESH` column 7 (*Meaning*, derived from Online Bible by Larry Pierce) carries separate permission restrictions and is **excluded** from `lexemes` and `lexical_senses`. Only STEP's CC BY 4.0 Hebrew forms, transliterations, morphology, `dStrong`/`uStrong` tags, and `STEP gloss` subdivisions are imported. `TBESG` Greek definitions (Abbott-Smith / Middle Liddell / STEP) are CC BY 4.0 and retained with attribution. |
| `ebible-webp-2026-11` | World English Bible British/Messianic Public Domain Edition (`WEBP`) | `2026-11` audited snapshot | Public Domain | Continuous verse-level English text only; never presented as word-for-word alignment. |
| `openbible-geocoding-2026-11` | `openbibleinfo/Bible-Geocoding-Data` | `7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f` | CC BY 4.0 / ODbL 1.0 (`osm` geometries) | Tagged `epistemic_layer = 'external_factual'`; `© OpenStreetMap contributors` retained where applicable. |
| `theographic-metadata-2026-11` | `robertrouse/theographic-bible-metadata` | `744355c7a5f38efd407bc67a5257c99aca9532bc` | CC BY-SA 4.0 | Tagged `epistemic_layer = 'external_factual'`; apocalyptic/symbolic places (`is_non_physical = true`) guarded from physical GPS pins. |
| `pleiades-gazetteer-v1` | Pleiades Gazetteer of Ancient Places | Cross-linked authority URIs | CC BY 3.0 | External authority links stored in `public.concept_external_links`. |
| `reviewed-biblical-annotations-v1` | Repository `data/annotations/` curated parallels & motifs | `1.0.0` | CC BY 4.0 (project-curated) | Tagged `epistemic_layer = 'reviewed_interpretation'` / `'reviewed_research'` with explicit counterexamples/controls. |
| `lxx-swete-2026-11` | `nathans/lxx-swete` / `First1KGreek` (Henry Barclay Swete 1909) | `master` snapshot | CC BY-SA 4.0 | 55 books of ancient Greek Old Testament; Psalms title versification preserved. |
| `macula-hebrew-47db250` | `Clear-Bible/macula-hebrew` | `47db250bd55d0d8577f2a94fba114ef16c35b23c` | CC BY 4.0 | UBS SDBH fields strictly excluded; Greek translation equivalents gated via `field_license_registry` (`enabled_origin_unverified`); CATSS alignment data never embedded. |

---

## 3. Reproducible Build & Verification Commands

1. **Schema & RLS Migration:** `supabase/migrations/20261105230000_canonical_lexical_and_evidence_schema.sql` & `20261106060000_septuagint_macula_schema.sql`
2. **Corpus & Provenance Population:** `node scripts/import-canonical-lexical-db.mjs` + `scripts/import-macula.mjs` + `scripts/import-lxx-swete.mjs`
3. **Deterministic Lookup RPCs:** `supabase/migrations/20261105233000_canonical_lookup_rpcs.sql` & `supabase/migrations/20261106063000_septuagint_comparison_rpcs.sql`
4. **End-to-End Validation Suite:** `node scripts/verify-canonical-lexical-db.mjs`, `node scripts/verify-openapi.mjs`, and `node scripts/verify-septuagint-layer.mjs`
