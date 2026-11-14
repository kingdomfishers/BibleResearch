#!/usr/bin/env python3
"""
Deterministic R1/R2 Pilot Relationship Extractor for BibleResearch.

Connects pinned MACULA Lowfat XML source files + BibleOntology S0/S1/S2/S4
clausal/head rules + local static-corpus crosswalk tables into structured
GrammaticalFrameV2, OccurrenceRelationV2, inventory, and coverage artifacts.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "third_party" / "bibleontology"))

from s0_s1_s2_builder import S1ClauseExtractor, extract_s0_words, norm  # noqa: E402

SOURCES_DIR = REPO_ROOT / ".artifacts" / "sources"
TABLES_DIR = REPO_ROOT / ".artifacts" / "static-corpus" / "tables"
BUNDLE_PATH = REPO_ROOT / "third_party" / "bibleontology" / "heads_and_lexicon.json"
DEFAULT_OUT_DIR = REPO_ROOT / ".artifacts" / "relationships-v2"

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

PILOT_TARGETS: list[dict[str, Any]] = [
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/01-Gen-001-lowfat.xml",
        "verses": ["GEN 1:1", "GEN 1:11"],
    },
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/01-Gen-003-lowfat.xml",
        "verses": ["GEN 3:4"],
    },
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/01-Gen-009-lowfat.xml",
        "verses": ["GEN 9:19"],
    },
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/06-Jos-017-lowfat.xml",
        "verses": ["JOS 17:15"],
    },
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/19-Psa-003-lowfat.xml",
        "verses": ["PSA 3:1"],
    },
    {
        "edition": "macula-greek-nestle1904",
        "language": "greek",
        "source_file": "macula-greek/Nestle1904/lowfat/02-mark.xml",
        "verses": ["MRK 16:99"],
    },
    {
        "edition": "macula-greek-nestle1904",
        "language": "greek",
        "source_file": "macula-greek/Nestle1904/lowfat/03-luke.xml",
        "verses": ["LUK 8:11"],
    },
    {
        "edition": "macula-greek-nestle1904",
        "language": "greek",
        "source_file": "macula-greek/Nestle1904/lowfat/04-john.xml",
        "verses": ["JHN 3:17", "JHN 4:41", "JHN 6:35", "JHN 6:67"],
    },
    {
        "edition": "macula-greek-sblgnt",
        "language": "greek",
        "source_file": "macula-greek/SBLGNT/lowfat/04-john.xml",
        "verses": ["JHN 3:17"],
    },
]

ROLE_CODE_TO_V2 = {
    "s": "grammatical_subject",
    "o": "grammatical_object",
    "io": "grammatical_indirect_object",
    "o2": "grammatical_second_object",
    "vc": "copular_verb",
    "p": "nonverbal_predicate",
}

VREF_NUM_RE = re.compile(r"^([1-3]?[A-Z]+)\s+(\d+):(\d+)$")
STRONGS_RE = re.compile(r"^([HGhg])?0*(\d+)([a-zA-Z]?)$")


def iter_shard_rows(table_name: str):
    tdir = TABLES_DIR / table_name
    for shard in sorted(tdir.glob("part-*.jsonl.gz")):
        with gzip.open(shard, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)


def hebrew_consonants(text: str | None) -> str:
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if "\u05d0" <= ch <= "\u05ea")


def lf_sha256_and_bytes(path: Path) -> tuple[str, int]:
    raw = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(raw).hexdigest(), len(raw)


def parse_strongs_parts(raw: str | None, lang_prefix: str) -> tuple[str, int, str] | None:
    if not raw:
        return None
    m = STRONGS_RE.match(raw.strip())
    if not m:
        return None
    pfx = (m.group(1) or lang_prefix).upper()
    num = int(m.group(2))
    tag = m.group(3).lower() if m.group(3) else ""
    return (pfx, num, tag)


def assert_no_restricted_fields(obj: Any, path: str = "") -> None:
    if isinstance(obj, list):
        for idx, item in enumerate(obj):
            assert_no_restricted_fields(item, f"{path}[{idx}]")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in RESTRICTED_FIELD_KEYS:
                raise AssertionError(f"Restricted field {k!r} found at {path}.{k}")
            assert_no_restricted_fields(v, f"{path}.{k}" if path else k)


class StaticCrosswalkIndex:
    """Offline crosswalk connecting MACULA XML tokens to BibleResearch occurrence & lemma identities."""

    def __init__(self, target_heb_ids: set[str], target_grk_keys: set[tuple[str, str]]) -> None:
        self.editions_by_key: dict[str, dict[str, Any]] = {}
        for r in iter_shard_rows("source_editions"):
            self.editions_by_key[r["edition_key"]] = r

        self.releases_by_id: dict[int, dict[str, Any]] = {}
        for r in iter_shard_rows("source_releases"):
            self.releases_by_id[int(r["id"])] = r

        self.license_registry_summary: dict[str, list[str]] = defaultdict(list)
        for r in iter_shard_rows("field_license_registry"):
            if str(r.get("status", "")).startswith("disabled"):
                key = f"{r.get('dataset_key')}:{r.get('field_name')}"
                self.license_registry_summary[r["status"]].append(key)

        self.lemmas_by_id: dict[int, dict[str, Any]] = {}
        self.lemmas_by_key_lower: dict[str, dict[str, Any]] = {}
        self.lemmas_by_lang_num: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
        for r in iter_shard_rows("lemmas"):
            lid = int(r["id"])
            self.lemmas_by_id[lid] = r
            lk = r.get("lemma_key")
            if lk:
                self.lemmas_by_key_lower[lk.lower()] = r
            parts = parse_strongs_parts(r.get("base_strongs"), "H" if r.get("language") in ("hbo", "arc") else "G")
            if parts:
                self.lemmas_by_lang_num[(parts[0], parts[1])].append(r)

        # Load target MACULA Hebrew morpheme rows
        self.heb_morphemes: dict[str, dict[str, Any]] = {}
        remaining_heb = set(target_heb_ids)
        if remaining_heb:
            for r in iter_shard_rows("macula_hebrew_morphemes"):
                mid = r.get("macula_id")
                if mid in remaining_heb:
                    self.heb_morphemes[mid] = r
                    remaining_heb.remove(mid)
                    if not remaining_heb:
                        break

        # Load target MACULA Greek token rows
        self.grk_tokens: dict[tuple[str, str], dict[str, Any]] = {}
        remaining_grk = set(target_grk_keys)
        if remaining_grk:
            for r in iter_shard_rows("macula_greek_tokens"):
                key = (r.get("edition_key"), r.get("xml_id"))
                if key in remaining_grk:
                    self.grk_tokens[key] = r
                    remaining_grk.remove(key)
                    if not remaining_grk:
                        break

        # Collect target word IDs and canonical verse IDs
        target_word_ids: set[int] = set()
        target_verse_ids: set[int] = set()
        for r in self.heb_morphemes.values():
            if r.get("word_id") is not None:
                target_word_ids.add(int(r["word_id"]))
            if r.get("canonical_verse_id") is not None:
                target_verse_ids.add(int(r["canonical_verse_id"]))
        for r in self.grk_tokens.values():
            if r.get("step_word_id") is not None:
                target_word_ids.add(int(r["step_word_id"]))
            if r.get("canonical_verse_id") is not None:
                target_verse_ids.add(int(r["canonical_verse_id"]))

        self.verses_by_id: dict[int, dict[str, Any]] = {}
        if target_verse_ids:
            rem_v = set(target_verse_ids)
            for r in iter_shard_rows("verses_immutable"):
                vid = int(r["id"])
                if vid in rem_v:
                    self.verses_by_id[vid] = r
                    rem_v.remove(vid)
                    if not rem_v:
                        break

        self.word_form_lemmas_by_word: dict[int, list[dict[str, Any]]] = defaultdict(list)
        if target_word_ids:
            for r in iter_shard_rows("word_form_lemmas"):
                wid = r.get("word_id")
                if wid is not None and int(wid) in target_word_ids:
                    self.word_form_lemmas_by_word[int(wid)].append(r)

        self.token_morphemes_by_vw: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
        if target_verse_ids:
            for r in iter_shard_rows("token_morphemes"):
                vid = r.get("verse_id")
                if vid is not None and int(vid) in target_verse_ids:
                    self.token_morphemes_by_vw[(int(vid), int(r["word_position"]))].append(r)

        self.tagnt_by_vw: dict[tuple[int, int], dict[str, Any]] = {}
        if target_verse_ids:
            for r in iter_shard_rows("tagnt_tokens"):
                vid = r.get("canonical_verse_id")
                swid = r.get("step_word_id")
                if vid is not None and swid is not None and int(vid) in target_verse_ids:
                    self.tagnt_by_vw[(int(vid), int(swid))] = r

    def edition_release_key(self, edition_key: str) -> str:
        ed = self.editions_by_key.get(edition_key)
        if not ed:
            return "unknown"
        rel = self.releases_by_id.get(int(ed["source_release_id"]))
        return str(rel["release_key"]) if rel else "unknown"

    def resolve_token(self, edition: str, xml_id: str, word_rec: dict[str, Any] | None = None) -> dict[str, Any]:
        is_hebrew = edition == "macula-hebrew-wlc"
        if is_hebrew:
            m = self.heb_morphemes.get(xml_id)
            if not m:
                return {
                    "xml_id": xml_id,
                    "edition": edition,
                    "crosswalk_status": "missing_macula_table_row",
                    "canonical_verse_id": None,
                    "alignment_status": "not_covered",
                    "occurrence_id": None,
                    "lemma_id": None,
                    "lemma_resolution_status": "missing_source_row",
                }
            cvid = m.get("canonical_verse_id")
            if cvid is None:
                return {
                    "xml_id": xml_id,
                    "edition": edition,
                    "crosswalk_status": "not_in_canonical_verse",
                    "canonical_verse_id": None,
                    "alignment_status": "not_in_canonical_verse",
                    "occurrence_id": None,
                    "lemma_id": None,
                    "lemma_resolution_status": "not_in_canonical_verse",
                }
            cvid_int = int(cvid)
            vrow = self.verses_by_id.get(cvid_int)
            align = "native_source"
            if vrow and (vrow.get("chapter") != m.get("chapter_mt") or vrow.get("verse_nr") != m.get("verse_mt")):
                align = "versification_shifted"

            word_id = m.get("word_id")
            word_no = int(m["word_no"]) if m.get("word_no") is not None else None
            morph_no = int(m["morph_no"]) if m.get("morph_no") is not None else None
            occ_id = f"heb:{cvid_int}:{word_id}:{morph_no}:{xml_id}"

            lemma_key, lstat, candidates = self._resolve_hebrew_lemma(m, cvid_int, word_id, word_no, morph_no, word_rec)
            return {
                "xml_id": xml_id,
                "edition": edition,
                "crosswalk_status": "resolved" if lemma_key else lstat,
                "canonical_verse_id": str(cvid_int),
                "canonical_ref": (
                    f"{vrow['book']}:{vrow['chapter']}:{vrow['verse_nr']}" if vrow else None
                ),
                "source_ref": m.get("ref_mt"),
                "alignment_status": align,
                "occurrence_id": occ_id,
                "step_word_id": word_id,
                "lemma_id": lemma_key,
                "lemma_resolution_status": lstat,
                "candidate_lemmas": candidates,
            }

        # Greek Editions (Nestle1904 / SBLGNT kept strictly separate by edition_key)
        g = self.grk_tokens.get((edition, xml_id))
        if not g:
            return {
                "xml_id": xml_id,
                "edition": edition,
                "crosswalk_status": "missing_macula_table_row",
                "canonical_verse_id": None,
                "alignment_status": "not_covered",
                "occurrence_id": None,
                "lemma_id": None,
                "lemma_resolution_status": "missing_source_row",
            }
        cvid = g.get("canonical_verse_id")
        if cvid is None or g.get("step_word_id") is None:
            return {
                "xml_id": xml_id,
                "edition": edition,
                "crosswalk_status": "not_in_canonical_verse",
                "canonical_verse_id": None,
                "alignment_status": "not_in_canonical_verse",
                "occurrence_id": None,
                "lemma_id": None,
                "lemma_resolution_status": "not_in_canonical_verse",
            }
        cvid_int = int(cvid)
        swid = int(g["step_word_id"])
        vrow = self.verses_by_id.get(cvid_int)
        align = "native_source"
        if vrow and (vrow.get("chapter") != g.get("chapter") or vrow.get("verse_nr") != g.get("verse_nr")):
            align = "versification_shifted"
        occ_id = f"grk:{edition}:{cvid_int}:{swid}:{xml_id}"

        lemma_key, lstat, candidates = self._resolve_greek_lemma(g, cvid_int, swid)
        return {
            "xml_id": xml_id,
            "edition": edition,
            "crosswalk_status": "resolved" if lemma_key else lstat,
            "canonical_verse_id": str(cvid_int),
            "canonical_ref": (
                f"{vrow['book']}:{vrow['chapter']}:{vrow['verse_nr']}" if vrow else None
            ),
            "source_ref": g.get("ref_nt"),
            "alignment_status": align,
            "occurrence_id": occ_id,
            "step_word_id": swid,
            "lemma_id": lemma_key,
            "lemma_resolution_status": lstat,
            "candidate_lemmas": candidates,
        }

    def _resolve_hebrew_lemma(
        self,
        m: dict[str, Any],
        cvid_int: int,
        word_id: int | None,
        word_no: int | None,
        morph_no: int | None,
        word_rec: dict[str, Any] | None,
    ) -> tuple[str | None, str, list[str]]:
        lang_pfx = "H" if (m.get("lang") or "H").upper() != "A" else "H"
        parts = parse_strongs_parts(m.get("strong_x"), lang_pfx)
        if not parts:
            return None, "missing_strongs", []
        pfx, num, letter = parts

        # 1. Exact token_morphemes match for (canonical_verse_id, word_position) matching Strong's base
        if word_no is not None:
            tms = self.token_morphemes_by_vw.get((cvid_int, word_no), [])
            tm_matched = []
            for tm in tms:
                lrow = self.lemmas_by_id.get(int(tm["lemma_id"]))
                if not lrow:
                    continue
                lparts = parse_strongs_parts(lrow.get("base_strongs"), "H")
                if lparts and lparts[1] == num:
                    tm_matched.append(lrow)
            if len(tm_matched) == 1:
                return tm_matched[0]["lemma_key"], "token_morphemes_exact", [tm_matched[0]["lemma_key"]]
            if len(tm_matched) > 1 and letter:
                for lr in tm_matched:
                    if (lr.get("homograph_tag") or "").lower() == letter:
                        return lr["lemma_key"], "token_morphemes_exact", [lr["lemma_key"]]

        # 2. Explicit homograph/subdivision letter on MACULA strong_x (e.g. 1254b -> H1254b, 2050c -> H2050c)
        src_cons = hebrew_consonants(m.get("lemma") or (word_rec or {}).get("lemma"))
        if letter:
            exact_key = f"lemma:h{num:04d}{letter}"
            lrow = self.lemmas_by_key_lower.get(exact_key.lower())
            if lrow:
                return lrow["lemma_key"], "macula_strong_x_disambiguated", [lrow["lemma_key"]]

        # 3. Consult word_form_lemmas candidates matching this base Strong's number
        wfl_candidates: list[dict[str, Any]] = []
        if word_id is not None:
            for wfl in self.word_form_lemmas_by_word.get(int(word_id), []):
                lrow = self.lemmas_by_id.get(int(wfl["lemma_id"]))
                if not lrow:
                    continue
                lparts = parse_strongs_parts(lrow.get("base_strongs"), "H")
                if lparts and lparts[1] == num:
                    wfl_candidates.append(lrow)

        if letter and not wfl_candidates:
            # Explicit extended Strong's code (e.g. suffix code 2050c) with no lemma_key or
            # word_form_lemmas entry: only allow fallback if consonants genuinely agree.
            cons_pool = [
                lr
                for lr in self.lemmas_by_lang_num.get(("H", num), [])
                if not src_cons or hebrew_consonants(lr.get("lemma_script")) == src_cons
            ]
            if not cons_pool:
                return None, f"unmapped_extended_strongs:{pfx}{num:04d}{letter}", []
            pool = cons_pool
        else:
            pool = wfl_candidates if wfl_candidates else [
                lr
                for lr in self.lemmas_by_lang_num.get(("H", num), [])
                if not src_cons or hebrew_consonants(lr.get("lemma_script")) == src_cons
            ]
            if not pool and not wfl_candidates:
                return None, f"unmapped_strongs_consonant_mismatch:{pfx}{num:04d}", []
        # Deduplicate preserving order
        seen_keys: dict[str, dict[str, Any]] = {}
        for lr in pool:
            seen_keys.setdefault(lr["lemma_key"], lr)
        uniq = list(seen_keys.values())
        cand_keys = [lr["lemma_key"] for lr in uniq]

        if len(uniq) == 1:
            return uniq[0]["lemma_key"], "word_form_lemmas_unique" if wfl_candidates else "lemmas_unique_strongs", cand_keys

        # Check for true distinct homographs (A/B/C/D/...) vs lexical subdivisions (G/H/I/...)
        true_homograph_tags = {(lr.get("homograph_tag") or "").upper() for lr in uniq} & {"A", "B", "C", "D", "E", "F"}
        if true_homograph_tags:
            # Never guess between distinct Hebrew homographs when strong_x lacks A/B/C!
            # Check if only one row in wfl is non-ambiguous or exact lemma script match exists?
            return None, "ambiguous_homograph", cand_keys

        # Single lexeme with G/H/I subdivisions (e.g. H0430G / H0430H, H0776G / H0776H):
        # Preserve primary general 'G' lemma key rather than splitting identity, and record subdivision status.
        for lr in uniq:
            if (lr.get("homograph_tag") or "").upper() == "G":
                return lr["lemma_key"], "subdivision_default_g", cand_keys

        # Fall back to exact lemma_script match only if one entry shares exact script
        src_lemma = unicodedata.normalize("NFC", (m.get("lemma") or (word_rec or {}).get("lemma") or ""))
        exact_script = [lr for lr in uniq if unicodedata.normalize("NFC", lr.get("lemma_script") or "") == src_lemma]
        if len(exact_script) == 1:
            return exact_script[0]["lemma_key"], "lemma_script_exact", cand_keys

        return None, f"ambiguous_candidates:{len(uniq)}", cand_keys

    def _resolve_greek_lemma(
        self,
        g: dict[str, Any],
        cvid_int: int,
        swid: int,
    ) -> tuple[str | None, str, list[str]]:
        parts = parse_strongs_parts(g.get("strongs"), "G")
        if not parts:
            return None, "missing_strongs", []
        _, num, _ = parts

        # 1. Exact TAGNT token alignment at (canonical_verse_id, step_word_id)
        tagnt = self.tagnt_by_vw.get((cvid_int, swid))
        if tagnt and tagnt.get("dstrongs"):
            raw_ds = str(tagnt["dstrongs"]).split("=")[0].strip()
            lrow = self.lemmas_by_key_lower.get(f"lemma:{raw_ds.lower()}")
            if lrow:
                return lrow["lemma_key"], "tagnt_dstrongs_exact", [lrow["lemma_key"]]

        # 2. Match word_form_lemmas for step_word_id filtered by base Strong's
        wfl_candidates: list[dict[str, Any]] = []
        for wfl in self.word_form_lemmas_by_word.get(swid, []):
            lrow = self.lemmas_by_id.get(int(wfl["lemma_id"]))
            if not lrow:
                continue
            lparts = parse_strongs_parts(lrow.get("base_strongs"), "G")
            if lparts and lparts[1] == num:
                wfl_candidates.append(lrow)

        pool = wfl_candidates if wfl_candidates else self.lemmas_by_lang_num.get(("G", num), [])
        seen_keys: dict[str, dict[str, Any]] = {}
        for lr in pool:
            seen_keys.setdefault(lr["lemma_key"], lr)
        uniq = list(seen_keys.values())
        cand_keys = [lr["lemma_key"] for lr in uniq]

        if len(uniq) == 1:
            return uniq[0]["lemma_key"], "word_form_lemmas_unique" if wfl_candidates else "lemmas_unique_strongs", cand_keys

        for lr in uniq:
            if (lr.get("homograph_tag") or "").upper() == "G":
                return lr["lemma_key"], "subdivision_default_g", cand_keys

        return None, f"ambiguous_greek_candidates:{len(uniq)}", cand_keys


def build_frame_context(cl: dict[str, Any]) -> dict[str, str]:
    polarity = "negative" if cl["negated"] else "affirmative_candidate"
    modality = cl["modality"] or "unknown"
    voice = cl["voice"] or "unknown"
    if cl["speech_quoted"]:
        speaker_scope = "quoted_speaker"
        quotation = "nested_speech_object" if cl.get("role_in_parent") == "o" else "direct_speech_turn"
    else:
        speaker_scope = "narrator_candidate"
        quotation = "none"
    return {
        "polarity": polarity,
        "modality": modality,
        "voice": voice,
        "speaker_scope": speaker_scope,
        "quotation": quotation,
        "figurative_scope": "unknown",
    }


def make_phrase_id(clause_id: str, role_code: str, idx: int, span: list[str]) -> str:
    if not span:
        return f"{clause_id}:{role_code}[{idx}]:empty"
    if len(span) == 1:
        return f"{clause_id}:{role_code}[{idx}]:{span[0]}"
    return f"{clause_id}:{role_code}[{idx}]:{span[0]}..{span[-1]}"


def init_lang_metrics() -> dict[str, Any]:
    return {
        "clauses_examined": 0,
        "clauses_parsed": 0,
        "clauses_eligible_grammatical_subject_of": 0,
        "clauses_eligible_grammatical_object_of": 0,
        "frames_emitted": 0,
        "relations_emitted_total": 0,
        "relations_by_predicate": {
            "grammatical_subject_of": 0,
            "grammatical_object_of": 0,
        },
        "relations_by_quality": {
            "source_explicit": 0,
            "rule_derived": 0,
            "candidate": 0,
        },
        "candidate_reasons": Counter(),
        "skip_reasons": Counter(),
        "missing_mappings": [],
        "unsupported_constructions": Counter(),
    }


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    bundle = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))

    # Pass 1: Parse pilot XML files with adapted BibleOntology S0-S2/S4 extractor
    extracted_files: list[dict[str, Any]] = []
    target_heb_ids: set[str] = set()
    target_grk_keys: set[tuple[str, str]] = set()

    for spec in PILOT_TARGETS:
        xml_path = SOURCES_DIR / spec["source_file"]
        sha256, byte_len = lf_sha256_and_bytes(xml_path)
        root = ET.parse(xml_path).getroot()
        words = extract_s0_words(root, spec["language"])
        all_clauses = S1ClauseExtractor(words, spec["language"], bundle).extract_file(root)
        target_set = set(spec["verses"])
        pilot_clauses = [c for c in all_clauses if c["verse_ref"] in target_set]

        for cl in pilot_clauses:
            for wid in cl["token_ids"]:
                if spec["language"] == "hebrew":
                    target_heb_ids.add(wid)
                else:
                    target_grk_keys.add((spec["edition"], wid))

        extracted_files.append({
            **spec,
            "xml_path": xml_path,
            "lf_sha256": sha256,
            "lf_bytes": byte_len,
            "file_clause_count": len(all_clauses),
            "words": words,
            "pilot_clauses": pilot_clauses,
        })

    # Pass 2: Build offline crosswalk index limited to pilot tokens & verses
    crosswalk = StaticCrosswalkIndex(target_heb_ids, target_grk_keys)

    frames: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    metrics = {"hebrew": init_lang_metrics(), "greek": init_lang_metrics()}
    file_inventory: list[dict[str, Any]] = []
    unmapped_tokens: list[dict[str, Any]] = []
    seen_unmapped_keys: set[tuple[str, str]] = set()

    # Track per-edition and per-file coverage stats
    for entry in extracted_files:
        edition = entry["edition"]
        lang = entry["language"]
        src_file = entry["source_file"]
        rel_key = crosswalk.edition_release_key(edition)
        m = metrics[lang]
        words = entry["words"]

        file_token_ids: set[str] = set()
        file_mapped_count = 0
        file_missing_reasons: Counter[str] = Counter()

        for cl in entry["pilot_clauses"]:
            for wid in cl["token_ids"]:
                if wid in file_token_ids:
                    continue
                file_token_ids.add(wid)
                cw = crosswalk.resolve_token(edition, wid, words.get(wid))
                if cw["crosswalk_status"] == "resolved":
                    file_mapped_count += 1
                else:
                    file_missing_reasons[cw["crosswalk_status"]] += 1
                    ukey = (edition, wid)
                    if ukey not in seen_unmapped_keys:
                        seen_unmapped_keys.add(ukey)
                        unmapped_tokens.append({
                            "edition": edition,
                            "source_file": src_file,
                            "token_id": wid,
                            "verse_ref": (words.get(wid) or {}).get("verse_ref"),
                            "text": (words.get(wid) or {}).get("text"),
                            "status": cw["crosswalk_status"],
                            "candidate_lemmas": cw.get("candidate_lemmas", []),
                        })

            m["clauses_examined"] += 1
            m["clauses_parsed"] += 1

            cid = cl["source_clause_id"]
            vref = cl["verse_ref"]
            frame_id = f"frame:{edition}:{cid}:svov1"

            # Determine clause-level canonical alignment from tokens
            tok_aligns = []
            tok_cvids: list[str] = []
            seen_cvid: set[str] = set()
            for wid in cl["token_ids"]:
                tcw = crosswalk.resolve_token(edition, wid, words.get(wid))
                tok_aligns.append(tcw["alignment_status"])
                if tcw["canonical_verse_id"] and tcw["canonical_verse_id"] not in seen_cvid:
                    seen_cvid.add(tcw["canonical_verse_id"])
                    tok_cvids.append(tcw["canonical_verse_id"])

            if all(a == "not_in_canonical_verse" for a in tok_aligns) and tok_aligns:
                clause_align = "not_in_canonical_verse"
            elif "versification_shifted" in tok_aligns:
                clause_align = "versification_shifted"
            elif "not_covered" in tok_aligns and not tok_cvids:
                clause_align = "not_covered"
            else:
                clause_align = "native_source"

            pred_word = cl["predicate_word"]
            pred_cw = (
                crosswalk.resolve_token(edition, pred_word["id"], pred_word)
                if pred_word
                else None
            )
            pred_block = (
                {
                    "token_id": pred_word["id"],
                    "lemma_id": pred_cw["lemma_id"] if pred_cw else None,
                    "source_form": pred_word.get("text"),
                }
                if pred_word
                else None
            )

            warnings: list[str] = []
            v_heads = [h for h in cl["resolved_roles"].get("v", []) if h["word"] is not None]
            if len(v_heads) > 1:
                warnings.append("multiple_v_role_tokens_using_primary")

            roles_out: list[dict[str, Any]] = []
            for r_code, r_name in ROLE_CODE_TO_V2.items():
                for r_idx, h in enumerate(cl["resolved_roles"].get(r_code, [])):
                    w = h["word"]
                    span_id = make_phrase_id(cid, r_code, r_idx, h["token_span"])
                    if h["is_clausal"]:
                        roles_out.append({
                            "role": r_name,
                            "head_token_id": None,
                            "lemma_id": None,
                            "source_phrase_id": span_id,
                            "state": "clausal",
                            "head_resolution": h["resolution_kind"],
                            "reason": "clausal_constituent",
                        })
                        continue
                    if w is None:
                        roles_out.append({
                            "role": r_name,
                            "head_token_id": None,
                            "lemma_id": None,
                            "source_phrase_id": span_id,
                            "state": "unresolved",
                            "head_resolution": h["resolution_kind"],
                            "reason": "empty_head_token",
                        })
                        continue

                    tcw = crosswalk.resolve_token(edition, w["id"], w)
                    is_unresolved_pron = (w.get("class") == "pron") and not w.get("referent")
                    reasons: list[str] = []
                    if clause_align == "not_in_canonical_verse":
                        reasons.append("not_in_canonical_verse")
                    if not h["is_verified_head"]:
                        reasons.append(h["resolution_kind"])
                    if is_unresolved_pron:
                        reasons.append("unresolved_pronoun_referent")
                    if tcw["crosswalk_status"] != "resolved":
                        reasons.append(f"crosswalk:{tcw['crosswalk_status']}")

                    if clause_align == "not_in_canonical_verse":
                        r_state = "unresolved"
                    elif reasons:
                        r_state = "candidate"
                        warnings.extend(reasons)
                    else:
                        r_state = "explicit"

                    role_rec: dict[str, Any] = {
                        "role": r_name,
                        "head_token_id": w["id"],
                        "lemma_id": tcw["lemma_id"],
                        "source_phrase_id": span_id,
                        "state": r_state,
                        "head_resolution": h["resolution_kind"],
                    }
                    if reasons:
                        role_rec["reason"] = ";".join(reasons)
                    roles_out.append(role_rec)

            # Frame quality assessment & R2 SVO edge emission
            clause_relations: list[dict[str, Any]] = []
            context = build_frame_context(cl)
            lang_pfx = "he" if lang == "hebrew" else "gr"

            if clause_align == "not_in_canonical_verse":
                frame_quality = "not_covered"
                m["skip_reasons"]["not_in_canonical_verse"] += 1
                m["unsupported_constructions"]["not_in_canonical_verse"] += 1
                warnings.append("skipped:not_in_canonical_verse")
            elif cl["clause_kind"] != "verbal":
                frame_quality = (
                    "candidate"
                    if any(r["state"] in ("candidate", "unresolved") for r in roles_out)
                    else "source_explicit"
                )
                skip_tag = f"non_verbal_clause:{cl['clause_kind']}"
                m["skip_reasons"][skip_tag] += 1
                m["unsupported_constructions"][cl["clause_kind"]] += 1
                warnings.append(f"skipped_svo:{skip_tag}")
            elif not pred_word or not pred_cw or not pred_cw["lemma_id"]:
                frame_quality = "candidate"
                reason = pred_cw["crosswalk_status"] if pred_cw else "missing_predicate_token"
                m["skip_reasons"][f"predicate_unmapped:{reason}"] += 1
                warnings.append(f"skipped_svo:predicate_unmapped:{reason}")
            else:
                pred_head = v_heads[0]
                for role_code, predicate_name, rule_id in (
                    ("s", "grammatical_subject_of", f"{lang_pfx}_clause_s_v_v1"),
                    ("o", "grammatical_object_of", f"{lang_pfx}_clause_o_v_v1"),
                ):
                    role_entries = cl["resolved_roles"].get(role_code, [])
                    if not role_entries:
                        continue
                    if predicate_name == "grammatical_subject_of":
                        m["clauses_eligible_grammatical_subject_of"] += 1
                    else:
                        m["clauses_eligible_grammatical_object_of"] += 1

                    for h in role_entries:
                        if h["is_clausal"]:
                            m["skip_reasons"][f"{predicate_name}:clausal_constituent"] += 1
                            m["unsupported_constructions"][f"clausal_{role_code}"] += 1
                            continue
                        w = h["word"]
                        if w is None:
                            m["skip_reasons"][f"{predicate_name}:empty_head"] += 1
                            continue
                        tcw = crosswalk.resolve_token(edition, w["id"], w)
                        if not tcw["lemma_id"]:
                            m["skip_reasons"][f"{predicate_name}:{tcw['crosswalk_status']}"] += 1
                            m["missing_mappings"].append({
                                "edition": edition,
                                "clause_id": cid,
                                "token_id": w["id"],
                                "reason": tcw["crosswalk_status"],
                            })
                            continue

                        cand_reasons: list[str] = []
                        if not h["is_verified_head"]:
                            cand_reasons.append(h["resolution_kind"])
                        if not pred_head["is_verified_head"]:
                            cand_reasons.append(f"pred_{pred_head['resolution_kind']}")
                        if (w.get("class") == "pron") and not w.get("referent"):
                            cand_reasons.append("unresolved_pronoun_referent")
                        if not cand_reasons and h["resolution_kind"] == "direct_role_word" and pred_head["resolution_kind"] == "direct_role_word":
                            rel_quality = "source_explicit"
                        elif not cand_reasons:
                            rel_quality = "rule_derived"
                        else:
                            rel_quality = "candidate"
                            for cr in cand_reasons:
                                m["candidate_reasons"][cr] += 1

                        rel_id = f"rel:{edition}:{cid}:{predicate_name}:{w['id']}:{pred_word['id']}"
                        rel = {
                            "relation_id": rel_id,
                            "frame_id": frame_id,
                            "subject_token_id": w["id"],
                            "subject_lemma_id": tcw["lemma_id"],
                            "predicate": predicate_name,
                            "object_token_id": pred_word["id"],
                            "object_lemma_id": pred_cw["lemma_id"],
                            "evidence": {
                                "edition": edition,
                                "reference": vref,
                                "source_clause_id": cid,
                                "rule_id": rule_id,
                            },
                            "quality": rel_quality,
                            "qualifiers": {
                                "polarity": context["polarity"],
                                "modality": context["modality"],
                                "voice": context["voice"],
                                "quotation": context["quotation"],
                            },
                        }
                        clause_relations.append(rel)
                        m["relations_emitted_total"] += 1
                        m["relations_by_predicate"][predicate_name] += 1
                        m["relations_by_quality"][rel_quality] += 1

                has_candidate_svo_role = any(
                    r["state"] in ("candidate", "unresolved")
                    for r in roles_out
                    if r["role"] in ("grammatical_subject", "grammatical_object")
                )
                if clause_relations:
                    if all(r["quality"] == "candidate" for r in clause_relations) or (
                        not any(r["quality"] in ("source_explicit", "rule_derived") for r in clause_relations)
                    ):
                        frame_quality = "candidate"
                    elif has_candidate_svo_role:
                        frame_quality = "candidate"
                    elif any(r["quality"] == "source_explicit" for r in clause_relations):
                        frame_quality = "source_explicit"
                    else:
                        frame_quality = "rule_derived"
                else:
                    frame_quality = "candidate" if has_candidate_svo_role else "source_explicit"

            # Deduplicate warnings deterministically
            uniq_warnings = list(dict.fromkeys(warnings))
            frame = {
                "frame_id": frame_id,
                "schema_version": "2.0",
                "source": {
                    "edition": edition,
                    "source_release": rel_key,
                    "source_file": src_file,
                    "clause_node_id": cid,
                    "reference": vref,
                    "canonical_verse_ids": tok_cvids,
                    "alignment_status": clause_align,
                },
                "predicate": pred_block,
                "roles": roles_out,
                "context": context,
                "extraction": {
                    "algorithm": "bibleontology_s0_s1_s2_r2_svov1",
                    "rule_version": "1.0",
                    "quality": frame_quality,
                    "warnings": uniq_warnings,
                },
            }
            frames.append(frame)
            relations.extend(clause_relations)
            m["frames_emitted"] += 1

        file_inventory.append({
            "edition": edition,
            "language": lang,
            "source_release": rel_key,
            "source_file": src_file,
            "lf_sha256": entry["lf_sha256"],
            "lf_bytes": entry["lf_bytes"],
            "file_clause_count": entry["file_clause_count"],
            "pilot_verses": entry["verses"],
            "pilot_clause_count": len(entry["pilot_clauses"]),
            "pilot_token_count": len(file_token_ids),
            "mapped_token_count": file_mapped_count,
            "missing_token_reasons": dict(sorted(file_missing_reasons.items())),
        })

    # Canonical deterministic ordering
    frames.sort(key=lambda f: f["frame_id"])
    relations.sort(key=lambda r: (r["frame_id"], r["predicate"], r["subject_token_id"], r["object_token_id"]))
    unmapped_tokens.sort(key=lambda x: (x["edition"], x["token_id"]))

    inventory_doc = {
        "schema_version": "1.0",
        "upstream_bibleontology_commit": "62d6bc0fba5f84dfad245e546e87c6212b35fa75",
        "excluded_restricted_fields": sorted(RESTRICTED_FIELD_KEYS),
        "field_license_registry_disabled": {
            k: sorted(v) for k, v in sorted(crosswalk.license_registry_summary.items())
        },
        "source_releases": {
            str(r["id"]): {
                "release_key": r["release_key"],
                "dataset": r["dataset"],
                "commit_sha": r["commit_sha"],
                "license": r["license"],
            }
            for r in sorted(crosswalk.releases_by_id.values(), key=lambda x: int(x["id"]))
            if int(r["id"]) in (1, 7, 8)
        },
        "files": file_inventory,
        "unmapped_tokens": unmapped_tokens,
    }

    coverage_doc = {
        "schema_version": "1.0",
        "pilot_scope_note": "Deliberate 39-41 clause Hebrew/Greek pilot; metrics do not represent whole-Bible coverage.",
        "languages": {
            lang: {
                "clauses_examined": m["clauses_examined"],
                "clauses_parsed": m["clauses_parsed"],
                "clauses_eligible_grammatical_subject_of": m["clauses_eligible_grammatical_subject_of"],
                "clauses_eligible_grammatical_object_of": m["clauses_eligible_grammatical_object_of"],
                "frames_emitted": m["frames_emitted"],
                "relations_emitted_total": m["relations_emitted_total"],
                "relations_by_predicate": m["relations_by_predicate"],
                "relations_by_quality": m["relations_by_quality"],
                "candidate_reasons": dict(sorted(m["candidate_reasons"].items())),
                "skip_reasons": dict(sorted(m["skip_reasons"].items())),
                "unsupported_constructions": dict(sorted(m["unsupported_constructions"].items())),
                "missing_mappings": m["missing_mappings"],
            }
            for lang, m in metrics.items()
        },
        "totals": {
            "frames_emitted": len(frames),
            "relations_emitted": len(relations),
        },
    }

    assert_no_restricted_fields(frames, "frames")
    assert_no_restricted_fields(relations, "relations")
    assert_no_restricted_fields(inventory_doc, "inventory")

    (out_dir / "source-crosswalk-inventory.json").write_text(
        json.dumps(inventory_doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (out_dir / "frames.jsonl").write_text(
        "".join(json.dumps(f, ensure_ascii=False, sort_keys=True) + "\n" for f in frames),
        encoding="utf-8",
        newline="\n",
    )
    (out_dir / "occurrence-relations.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in relations),
        encoding="utf-8",
        newline="\n",
    )
    (out_dir / "coverage-report.json").write_text(
        json.dumps(coverage_doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    print(
        json.dumps(
            {
                "status": "ok",
                "out_dir": str(out_dir),
                "hebrew": coverage_doc["languages"]["hebrew"],
                "greek": coverage_doc["languages"]["greek"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
