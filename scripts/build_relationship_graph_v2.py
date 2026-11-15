#!/usr/bin/env python3
"""
Deterministic R3.2 Lemma Relationship Graph & Multi-Lane Integration Builder.

Consumes verified GrammaticalFrameV2 + OccurrenceRelationV2 records from
extract_relationship_pilot.py and produces:
  - summaries/lemma-relation-summaries.jsonl (RelationSummaryV2)
  - indexes/evidence-by-id.jsonl
  - indexes/by-lemma.json
  - lanes/lexical-and-contextual-lanes.json
  - reports/query-demonstrations.json
  - reports/r3-quality-report.json
  - manifest.json
"""

from __future__ import annotations

import gzip
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
TABLES_DIR = REPO_ROOT / ".artifacts" / "static-corpus" / "tables"

PREDICATE_INVERSE: dict[str, str] = {
    "grammatical_subject_of": "has_grammatical_subject",
    "grammatical_object_of": "has_grammatical_object",
    "grammatical_indirect_object_of": "has_grammatical_indirect_object",
    "grammatical_second_object_of": "has_grammatical_second_object",
    "modifies": "modified_by",
    "possessive_construction_with": "has_possessive_construction",
}

RESTRICTED_FIELD_KEYS = {
    "sdbh",
    "lexdomain",
    "coredomain",
    "contextualdomain",
    "domain",
    "ln",
    "frame",
    "semantic_frame",
    "meaning",
}

COMMAND_OR_PREDICTION_MODALITIES = {
    "imperative",
    "jussive",
    "cohortative",
    "subjunctive",
    "optative",
}


def _iter_shard_rows(table_name: str):
    tdir = TABLES_DIR / table_name
    if not tdir.exists():
        return
    for shard in sorted(tdir.glob("part-*.jsonl.gz")):
        with gzip.open(shard, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)


def _assert_no_restricted(obj: Any, ctx: str, path: str = "") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = k.lower()
            next_p = f"{path}.{k}" if path else k
            if kl in RESTRICTED_FIELD_KEYS:
                raise AssertionError(f"Restricted field '{next_p}' leaked into {ctx}")
            _assert_no_restricted(v, ctx, next_p)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            _assert_no_restricted(item, ctx, f"{path}[{i}]")


def _edition_language(edition: str) -> str:
    return "hebrew" if "hebrew" in edition else "greek"


def _summary_id(
    edition: str,
    quality_tier: str,
    predicate: str,
    from_lemma_id: str,
    to_lemma_id: str,
    rule_version: str,
) -> str:
    return f"sum:{edition}:{quality_tier}:{predicate}:{from_lemma_id}->{to_lemma_id}:v{rule_version}"


def _write_json(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows),
        encoding="utf-8",
        newline="\n",
    )


def _sha256_file(path: Path) -> tuple[str, int]:
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest(), len(data)


def _load_static_lanes_for_lemmas(pilot_lemma_keys: set[str]) -> dict[str, dict[str, Any]]:
    """Load lexical-lane and contextual-lane data for attested pilot lemmas without duplicating full tables."""
    lemmas_by_key: dict[str, dict[str, Any]] = {}
    lemmas_by_id: dict[int, dict[str, Any]] = {}
    pilot_lemma_ids: set[int] = set()
    pilot_strongs: set[str] = set()

    for row in _iter_shard_rows("lemmas"):
        lk = row.get("lemma_key")
        lid = int(row["id"])
        rec = {
            "id": lid,
            "lemma_key": lk,
            "language": row.get("language"),
            "base_strongs": row.get("base_strongs"),
            "lemma_script": row.get("lemma_script"),
            "homograph_tag": row.get("homograph_tag"),
            "primary_pos": row.get("primary_pos"),
            "primary_lexeme_id": row.get("primary_lexeme_id"),
        }
        lemmas_by_id[lid] = rec
        if lk in pilot_lemma_keys:
            lemmas_by_key[lk] = rec
            pilot_lemma_ids.add(lid)
            if row.get("base_strongs"):
                pilot_strongs.add(str(row["base_strongs"]))

    lexemes_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in _iter_shard_rows("lexemes"):
        lid = row.get("lemma_id")
        if lid is not None and int(lid) in pilot_lemma_ids:
            lexemes_by_lemma_id[int(lid)].append({
                "id": int(row["id"]),
                "lexeme_key": row.get("lexeme_key"),
                "pos": row.get("pos"),
                "base_strongs": row.get("base_strongs"),
                "extended_strongs": row.get("extended_strongs"),
                "disambiguated_strongs": row.get("disambiguated_strongs"),
            })

    roots_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in _iter_shard_rows("lemma_root_links"):
        lid = row.get("lemma_id")
        if lid is not None and int(lid) in pilot_lemma_ids:
            roots_by_lemma_id[int(lid)].append({
                "id": int(row["id"]),
                "root_id": row.get("root_id"),
                "etymology_type": row.get("etymology_type"),
                "implies_synonymy": bool(row.get("implies_synonymy")),
                "derivation_method": row.get("derivation_method"),
            })

    formations_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in _iter_shard_rows("lexical_formations"):
        lid = row.get("lemma_id")
        if lid is not None and int(lid) in pilot_lemma_ids:
            formations_by_lemma_id[int(lid)].append({
                "id": int(row["id"]),
                "analysis_key": row.get("analysis_key"),
                "formation_type": row.get("formation_type"),
                "evidence_status": row.get("evidence_status"),
            })

    connections_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in _iter_shard_rows("lexical_connections"):
        slid = row.get("subject_lemma_id")
        tlid = row.get("target_lemma_id")
        if (slid is not None and int(slid) in pilot_lemma_ids) or (
            tlid is not None and int(tlid) in pilot_lemma_ids
        ):
            s_key = lemmas_by_id.get(int(slid), {}).get("lemma_key") if slid is not None else None
            t_key = lemmas_by_id.get(int(tlid), {}).get("lemma_key") if tlid is not None else None
            rec = {
                "id": int(row["id"]),
                "relation_type": row.get("relation_type"),
                "subject_lemma_key": s_key,
                "target_lemma_key": t_key,
                "evidence_status": row.get("evidence_status"),
                "passage_reference": row.get("passage_reference"),
            }
            if slid is not None and int(slid) in pilot_lemma_ids:
                connections_by_lemma_id[int(slid)].append(rec)
            if tlid is not None and int(tlid) in pilot_lemma_ids and tlid != slid:
                connections_by_lemma_id[int(tlid)].append(rec)

    entities_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    entity_ids_of_interest: set[int] = set()
    entity_by_id: dict[int, dict[str, Any]] = {}
    for row in _iter_shard_rows("canonical_entities"):
        eid = int(row["id"])
        lid = row.get("lemma_id")
        if lid is not None and int(lid) in pilot_lemma_ids:
            rec = {
                "entity_id": eid,
                "entity_key": row.get("entity_key"),
                "entity_kind": row.get("entity_kind"),
                "display_label": row.get("display_label"),
                "lemma_id": int(lid),
                "lexeme_id": row.get("lexeme_id"),
                "root_id": row.get("root_id"),
            }
            entities_by_lemma_id[int(lid)].append(rec)
            entity_ids_of_interest.add(eid)
            entity_by_id[eid] = rec

    entity_rels_by_entity_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in _iter_shard_rows("entity_relationships"):
        seid = row.get("subject_entity_id")
        oeid = row.get("object_entity_id")
        if (seid is not None and int(seid) in entity_ids_of_interest) or (
            oeid is not None and int(oeid) in entity_ids_of_interest
        ):
            rec = {
                "id": int(row["id"]),
                "relationship_key": row.get("relationship_key"),
                "relation_type": row.get("relation_type"),
                "epistemic_layer": row.get("epistemic_layer"),
                "origin_mode": row.get("origin_mode"),
                "subject_entity_id": seid,
                "object_entity_id": oeid,
            }
            if seid is not None and int(seid) in entity_ids_of_interest:
                entity_rels_by_entity_id[int(seid)].append(rec)
            if oeid is not None and int(oeid) in entity_ids_of_interest and oeid != seid:
                entity_rels_by_entity_id[int(oeid)].append(rec)

    # Contextual lane from words_immutable.co_occurrences (strictly non-grammatical statistical lane)
    word_id_to_strongs: dict[int, str] = {}
    coocc_by_strongs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in _iter_shard_rows("words_immutable"):
        wid = int(row["id"])
        snr = str(row.get("strongs_nr") or "")
        if snr:
            word_id_to_strongs[wid] = snr
        if snr in pilot_strongs and row.get("co_occurrences"):
            coocc_by_strongs[snr].append(row)

    lanes_by_lemma: dict[str, dict[str, Any]] = {}
    for lk in sorted(pilot_lemma_keys):
        lmeta = lemmas_by_key.get(lk)
        if not lmeta:
            lanes_by_lemma[lk] = {
                "lexical_lane": {
                    "lane": "lexical",
                    "lemma_id": lk,
                    "lexeme_id": None,
                    "strongs_base": None,
                    "lemma_form": None,
                    "root_links": [],
                    "lexical_formations": [],
                    "lexical_connections": [],
                    "canonical_entity_links": [],
                },
                "contextual_lane": {
                    "lane": "contextual",
                    "nature": "statistical_co_occurrence_not_grammatical_relation",
                    "same_verse_co_occurrences_sample_count": 0,
                    "distinct_co_occurring_strongs": [],
                },
            }
            continue

        lid = lmeta["id"]
        snr = lmeta.get("base_strongs")
        ent_links: list[dict[str, Any]] = []
        for ent in entities_by_lemma_id.get(lid, []):
            rels = entity_rels_by_entity_id.get(ent["entity_id"], [])
            ent_links.append({
                "entity_id": ent["entity_id"],
                "entity_key": ent["entity_key"],
                "entity_kind": ent["entity_kind"],
                "display_label": ent["display_label"],
                "entity_relationships_count": len(rels),
                "entity_relationships_sample": sorted(
                    rels, key=lambda r: int(r["id"])
                )[:10],
            })

        co_strongs: set[str] = set()
        co_total = 0
        for wrow in coocc_by_strongs.get(str(snr or ""), []):
            for co in wrow.get("co_occurrences") or []:
                co_total += int(co.get("freq") or 0)
                target_snr = word_id_to_strongs.get(int(co["word_id"]))
                if target_snr:
                    co_strongs.add(target_snr)

        lex_ids = lexemes_by_lemma_id.get(lid, [])
        lanes_by_lemma[lk] = {
            "lexical_lane": {
                "lane": "lexical",
                "lemma_id": lk,
                "lexeme_id": str(lmeta.get("primary_lexeme_id")) if lmeta.get("primary_lexeme_id") is not None else (
                    lex_ids[0]["lexeme_key"] if lex_ids else None
                ),
                "strongs_base": snr,
                "lemma_form": lmeta.get("lemma_script"),
                "root_links": sorted(roots_by_lemma_id.get(lid, []), key=lambda x: x["id"]),
                "lexical_formations": sorted(formations_by_lemma_id.get(lid, []), key=lambda x: x["id"]),
                "lexical_connections": sorted(connections_by_lemma_id.get(lid, []), key=lambda x: x["id"]),
                "canonical_entity_links": sorted(ent_links, key=lambda x: x["entity_id"]),
            },
            "contextual_lane": {
                "lane": "contextual",
                "nature": "statistical_co_occurrence_not_grammatical_relation",
                "same_verse_co_occurrences_sample_count": co_total,
                "distinct_co_occurring_strongs": sorted(co_strongs)[:50],
            },
        }
    return lanes_by_lemma


def _build_query_demo(
    query_label: str,
    target_lemma_ids: list[str],
    summaries: list[dict[str, Any]],
    relations_by_id: dict[str, dict[str, Any]],
    frames_by_id: dict[str, dict[str, Any]],
    lanes_by_lemma: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Assemble an inspectable multi-lane query result separating homographs, editions, and quality tiers."""
    by_lemma_entries: list[dict[str, Any]] = []
    for lid in target_lemma_ids:
        editions_map: dict[str, dict[str, Any]] = {}
        for s in summaries:
            if s["from_lemma_id"] != lid and s["to_lemma_id"] != lid:
                continue
            ed = s["source_edition"]
            ed_bucket = editions_map.setdefault(
                ed,
                {
                    "source_edition": ed,
                    "high_quality": {
                        "incoming_grammatical_subjects": [],
                        "incoming_grammatical_objects": [],
                        "incoming_grammatical_indirect_objects": [],
                        "incoming_grammatical_second_objects": [],
                        "outgoing_as_subject_of": [],
                        "outgoing_as_object_of": [],
                        "outgoing_as_indirect_object_of": [],
                        "outgoing_as_second_object_of": [],
                        "modifiers_attached": [],
                        "modifies_targets": [],
                        "possessive_dependents": [],
                        "possessive_heads": [],
                    },
                    "candidate_only": [],
                },
            )
            ev_samples = []
            for eid in s["evidence_ids"][:10]:
                rel = relations_by_id[eid]
                fr = frames_by_id[rel["frame_id"]]
                ev_samples.append({
                    "relation_id": eid,
                    "frame_id": rel["frame_id"],
                    "clause_node_id": fr["source"]["clause_node_id"],
                    "canonical_ref": rel["evidence"]["reference"],
                    "subject_token_id": rel["subject_token_id"],
                    "object_token_id": rel["object_token_id"],
                    "quality": rel["quality"],
                    "qualifiers": rel["qualifiers"],
                })
            entry = {
                "summary_id": s["summary_id"],
                "from_lemma_id": s["from_lemma_id"],
                "predicate": s["predicate"],
                "inverse_predicate": s["inverse_predicate"],
                "to_lemma_id": s["to_lemma_id"],
                "stats": s["stats"],
                "sample_passages": s["sample_passages"],
                "evidence_ids": s["evidence_ids"],
                "evidence_details": ev_samples,
            }
            if s["quality_tier"] == "candidate_only":
                ed_bucket["candidate_only"].append(entry)
                continue

            hq = ed_bucket["high_quality"]
            pred = s["predicate"]
            if s["to_lemma_id"] == lid:
                if pred == "grammatical_subject_of":
                    hq["incoming_grammatical_subjects"].append(entry)
                elif pred == "grammatical_object_of":
                    hq["incoming_grammatical_objects"].append(entry)
                elif pred == "grammatical_indirect_object_of":
                    hq["incoming_grammatical_indirect_objects"].append(entry)
                elif pred == "grammatical_second_object_of":
                    hq["incoming_grammatical_second_objects"].append(entry)
                elif pred == "modifies":
                    hq["modifiers_attached"].append(entry)
                elif pred == "possessive_construction_with":
                    hq["possessive_dependents"].append(entry)
            if s["from_lemma_id"] == lid:
                if pred == "grammatical_subject_of":
                    hq["outgoing_as_subject_of"].append(entry)
                elif pred == "grammatical_object_of":
                    hq["outgoing_as_object_of"].append(entry)
                elif pred == "grammatical_indirect_object_of":
                    hq["outgoing_as_indirect_object_of"].append(entry)
                elif pred == "grammatical_second_object_of":
                    hq["outgoing_as_second_object_of"].append(entry)
                elif pred == "modifies":
                    hq["modifies_targets"].append(entry)
                elif pred == "possessive_construction_with":
                    hq["possessive_heads"].append(entry)

        lane_info = lanes_by_lemma.get(lid, {})
        by_lemma_entries.append({
            "lemma_id": lid,
            "grammatical_lane_by_edition": editions_map,
            "lexical_lane": lane_info.get("lexical_lane"),
            "contextual_lane": lane_info.get("contextual_lane"),
            "research_inference_lane": {"status": "not_populated_in_r3"},
        })

    return {
        "query": query_label,
        "target_lemma_ids": target_lemma_ids,
        "homograph_separation_preserved": True,
        "results": by_lemma_entries,
    }


def build_r3_graph_artifacts(
    out_dir: Path,
    frames: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    coverage_doc: dict[str, Any],
    inventory_doc: dict[str, Any],
    clause_lemma_presence: dict[tuple[str, str], set[str]],
    rule_version: str = "1.2",
) -> dict[str, Any]:
    """Compile R3.2 lemma summaries, evidence/lemma indexes, multi-lane JSON, query demos, and manifest."""
    frames_by_id = {f["frame_id"]: f for f in frames}
    relations_by_id = {r["relation_id"]: r for r in relations}

    # Precompute processed frames per (edition, lemma_id) where lemma appears in the clause tokens and frame ran
    processed_by_ed_lemma: dict[tuple[str, str], set[str]] = defaultdict(set)
    # Derive from clause_lemma_presence intersected with non-not_covered frames
    valid_clause_ids_by_ed: dict[str, set[str]] = defaultdict(set)
    for f in frames:
        if f["extraction"]["quality"] != "not_covered":
            valid_clause_ids_by_ed[f["source"]["edition"]].add(f["source"]["clause_node_id"])
    for (ed, lid), cids in clause_lemma_presence.items():
        processed_by_ed_lemma[(ed, lid)] = cids & valid_clause_ids_by_ed[ed]

    # Group occurrence relations into RelationSummaryV2 buckets without merging high_quality & candidate_only
    grouped: dict[tuple[str, str, str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for rel in relations:
        from_lid = rel.get("subject_lemma_id")
        to_lid = rel.get("object_lemma_id")
        if not from_lid or not to_lid:
            continue
        ed = rel["evidence"]["edition"]
        lang = _edition_language(ed)
        tier = "candidate_only" if rel["quality"] == "candidate" else "high_quality"
        key = (from_lid, rel["predicate"], to_lid, ed, lang, tier)
        grouped[key].append(rel)

    summaries: list[dict[str, Any]] = []
    rel_to_summary_id: dict[str, str] = {}
    by_lemma_outgoing: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_lemma_incoming: dict[str, list[dict[str, Any]]] = defaultdict(list)
    pilot_lemmas: set[str] = set()

    for key in sorted(grouped.keys()):
        from_lid, pred, to_lid, ed, lang, tier = key
        grp = sorted(grouped[key], key=lambda r: r["relation_id"])
        pilot_lemmas.add(from_lid)
        pilot_lemmas.add(to_lid)

        sid = _summary_id(ed, tier, pred, from_lid, to_lid, rule_version)
        inv = PREDICATE_INVERSE[pred]
        ev_ids = [r["relation_id"] for r in grp]
        for eid in ev_ids:
            rel_to_summary_id[eid] = sid

        passages = sorted({r["evidence"]["reference"] for r in grp})
        books = {p.split()[0] for p in passages if p}
        frame_ids = {r["frame_id"] for r in grp}

        n_se = sum(1 for r in grp if r["quality"] == "source_explicit")
        n_rd = sum(1 for r in grp if r["quality"] == "rule_derived")
        n_cand = sum(1 for r in grp if r["quality"] == "candidate")

        n_neg_unc = sum(
            1
            for r in grp
            if r["quality"] == "candidate"
            or r["qualifiers"]["polarity"] == "negative"
            or r["qualifiers"]["quotation"] == "unknown"
            or r["qualifiers"]["modality"] == "unknown"
        )
        n_cmd_pred = sum(
            1 for r in grp if r["qualifiers"]["modality"] in COMMAND_OR_PREDICTION_MODALITIES
        )

        elig_set = clause_lemma_presence.get((ed, from_lid), set()) & clause_lemma_presence.get(
            (ed, to_lid), set()
        )
        proc_set = processed_by_ed_lemma.get((ed, from_lid), set()) & processed_by_ed_lemma.get(
            (ed, to_lid), set()
        )
        # Ensure counts never fall below observed distinct frames in case verse alignment differs
        c_proc = max(len(proc_set), len(frame_ids))
        c_elig = max(len(elig_set), c_proc)

        summary = {
            "summary_id": sid,
            "lane": "grammatical",
            "from_lemma_id": from_lid,
            "predicate": pred,
            "inverse_predicate": inv,
            "to_lemma_id": to_lid,
            "quality_tier": tier,
            "source_edition": ed,
            "language": lang,
            "rule_version": rule_version,
            "stats": {
                "distinct_frames": len(frame_ids),
                "occurrences": (n_se + n_rd) if tier == "high_quality" else 0,
                "distinct_passages": len(passages),
                "distinct_books": len(books),
                "source_explicit": n_se,
                "rule_derived": n_rd,
                "candidate": n_cand,
                "negated_or_uncertain": n_neg_unc,
                "command_or_prediction": n_cmd_pred,
                "clauses_eligible": c_elig,
                "clauses_processed": c_proc,
            },
            "sample_passages": passages[:10],
            "evidence_ids": ev_ids,
        }
        summaries.append(summary)

        by_lemma_outgoing[from_lid].append({
            "summary_id": sid,
            "predicate": pred,
            "to_lemma_id": to_lid,
            "quality_tier": tier,
            "source_edition": ed,
            "stats": summary["stats"],
        })
        by_lemma_incoming[to_lid].append({
            "summary_id": sid,
            "predicate": pred,
            "inverse_predicate": inv,
            "from_lemma_id": from_lid,
            "quality_tier": tier,
            "source_edition": ed,
            "stats": summary["stats"],
        })

    summaries.sort(key=lambda s: s["summary_id"])

    # Evidence lookup index
    evidence_entries: list[dict[str, Any]] = []
    for rel in sorted(relations, key=lambda r: r["relation_id"]):
        fr = frames_by_id[rel["frame_id"]]
        ed = rel["evidence"]["edition"]
        sid = rel_to_summary_id.get(rel["relation_id"])
        evidence_entries.append({
            "relation_id": rel["relation_id"],
            "frame_id": rel["frame_id"],
            "clause_node_id": fr["source"]["clause_node_id"],
            "canonical_ref": rel["evidence"]["reference"],
            "source_edition": ed,
            "language": _edition_language(ed),
            "summary_id": sid,
            "inverse_predicate": PREDICATE_INVERSE[rel["predicate"]],
            "relation": rel,
        })

    # Load lexical + contextual lanes strictly separated from grammatical summaries
    lanes_by_lemma = _load_static_lanes_for_lemmas(pilot_lemmas)
    multi_lane_doc: dict[str, Any] = {}
    by_lemma_index: dict[str, Any] = {}

    for lid in sorted(pilot_lemmas):
        out_sums = sorted(by_lemma_outgoing.get(lid, []), key=lambda x: x["summary_id"])
        in_sums = sorted(by_lemma_incoming.get(lid, []), key=lambda x: x["summary_id"])
        hq_out = sum(1 for x in out_sums if x["quality_tier"] == "high_quality")
        hq_in = sum(1 for x in in_sums if x["quality_tier"] == "high_quality")
        cand_out = sum(1 for x in out_sums if x["quality_tier"] == "candidate_only")
        cand_in = sum(1 for x in in_sums if x["quality_tier"] == "candidate_only")

        editions_seen = sorted({x["source_edition"] for x in out_sums + in_sums})
        by_lemma_index[lid] = {
            "lemma_id": lid,
            "editions": editions_seen,
            "outgoing_summaries": out_sums,
            "incoming_summaries": in_sums,
            "lanes_ref": f"lanes/lexical-and-contextual-lanes.json#{lid}",
        }
        static_lane = lanes_by_lemma.get(lid, {})
        multi_lane_doc[lid] = {
            "lemma_id": lid,
            "grammatical_lane": {
                "lane": "grammatical",
                "high_quality_outgoing_summaries": hq_out,
                "high_quality_incoming_summaries": hq_in,
                "candidate_only_outgoing_summaries": cand_out,
                "candidate_only_incoming_summaries": cand_in,
                "outgoing_summary_ids": [x["summary_id"] for x in out_sums],
                "incoming_summary_ids": [x["summary_id"] for x in in_sums],
            },
            "lexical_lane": static_lane.get("lexical_lane"),
            "contextual_lane": static_lane.get("contextual_lane"),
            "research_inference_lane": {
                "lane": "research_inference",
                "status": "not_populated_in_r3",
                "note": "Reserved for future editorial/candidate hypotheses; never mixed with grammatical or lexical counts.",
            },
        }

    # Query demonstrations requested in R3.2
    query_demos_doc = {
        "schema_version": "2.0",
        "rule_version": rule_version,
        "note": "Deterministic R3.2 lemma graph demonstrations separating homographs, source editions, high-quality vs candidate-only tiers, and grammatical/lexical/contextual lanes.",
        "demonstrations": {
            "H1254": _build_query_demo(
                "H1254 (בָּרָא create [H1254a] vs cut down/clear [H1254b])",
                ["lemma:H1254a", "lemma:H1254b"],
                summaries,
                relations_by_id,
                frames_by_id,
                lanes_by_lemma,
            ),
            "H0430": _build_query_demo(
                "H0430 (אֱלֹהִים God [lemma:H0430G])",
                ["lemma:H0430G"],
                summaries,
                relations_by_id,
                frames_by_id,
                lanes_by_lemma,
            ),
            "G2316": _build_query_demo(
                "G2316 (θεός God across Nestle1904 and SBLGNT)",
                ["lemma:G2316"],
                summaries,
                relations_by_id,
                frames_by_id,
                lanes_by_lemma,
            ),
            "G3056": _build_query_demo(
                "G3056 (λόγος word across Nestle1904 and SBLGNT)",
                ["lemma:G3056"],
                summaries,
                relations_by_id,
                frames_by_id,
                lanes_by_lemma,
            ),
        },
    }

    summary_pred_counts = Counter(s["predicate"] for s in summaries)
    summary_tier_counts = Counter(s["quality_tier"] for s in summaries)
    summary_ed_counts = Counter(s["source_edition"] for s in summaries)
    r3_quality_report = {
        "schema_version": "2.0",
        "rule_version": rule_version,
        "totals": {
            "frames_emitted": len(frames),
            "occurrence_relations_emitted": len(relations),
            "relation_summaries_total": len(summaries),
            "distinct_lemmas_in_graph": len(pilot_lemmas),
            "evidence_index_entries": len(evidence_entries),
        },
        "summaries_by_predicate": dict(sorted(summary_pred_counts.items())),
        "summaries_by_quality_tier": dict(sorted(summary_tier_counts.items())),
        "summaries_by_edition": dict(sorted(summary_ed_counts.items())),
        "occurrence_relations_by_predicate": {
            lang: m["relations_by_predicate"] for lang, m in coverage_doc["languages"].items()
        },
        "occurrence_relations_by_quality": {
            lang: m["relations_by_quality"] for lang, m in coverage_doc["languages"].items()
        },
    }

    _assert_no_restricted(summaries, "summaries")
    _assert_no_restricted(evidence_entries, "evidence_index")
    _assert_no_restricted(by_lemma_index, "by_lemma_index")
    _assert_no_restricted(multi_lane_doc, "lanes")
    _assert_no_restricted(query_demos_doc, "query_demonstrations")

    # Write all R3.2 outputs
    _write_jsonl(out_dir / "summaries" / "lemma-relation-summaries.jsonl", summaries)
    _write_jsonl(out_dir / "indexes" / "evidence-by-id.jsonl", evidence_entries)
    _write_json(out_dir / "indexes" / "by-lemma.json", by_lemma_index)
    _write_json(out_dir / "lanes" / "lexical-and-contextual-lanes.json", multi_lane_doc)
    _write_json(out_dir / "reports" / "query-demonstrations.json", query_demos_doc)
    _write_json(out_dir / "reports" / "r3-quality-report.json", r3_quality_report)

    # Manifest covers every deterministic artifact produced under out_dir (excluding manifest.json and test-report.json)
    artifact_files = [
        p
        for p in sorted(out_dir.rglob("*"))
        if p.is_file() and p.name not in ("manifest.json", "test-report.json")
    ]
    manifest_files: dict[str, dict[str, Any]] = {}
    for p in artifact_files:
        rel_p = p.relative_to(out_dir).as_posix()
        sha, size = _sha256_file(p)
        manifest_files[rel_p] = {"path": rel_p, "sha256": sha, "bytes": size}

    manifest_doc = {
        "schema_version": "2.0",
        "rule_version": rule_version,
        "generated_at": f"deterministic-build:rule-v{rule_version}",
        "artifact_root": ".artifacts/relationships-v2",
        "upstream_bibleontology_commit": inventory_doc.get("upstream_bibleontology_commit"),
        "source_releases": inventory_doc.get("source_releases"),
        "files": manifest_files,
        "counts": r3_quality_report["totals"],
    }
    _write_json(out_dir / "manifest.json", manifest_doc)
    return r3_quality_report
