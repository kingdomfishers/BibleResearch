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
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from build_relationship_graph_v2 import build_r3_graph_artifacts, aggregate_partitions  # noqa: E402
from s0_s1_s2_builder import S1ClauseExtractor, extract_s0_words, norm  # noqa: E402

SOURCES_DIR = REPO_ROOT / ".artifacts" / "sources"
TABLES_DIR = REPO_ROOT / ".artifacts" / "static-corpus" / "tables"
CROSSWALK_CACHE_DIR = REPO_ROOT / ".artifacts" / "relationships-cache" / "crosswalk"
BUNDLE_PATH = REPO_ROOT / "third_party" / "bibleontology" / "heads_and_lexicon.json"
DEFAULT_OUT_DIR = REPO_ROOT / ".artifacts" / "relationships-v2"
RULE_VERSION = "1.2"

# Documented BibleOntology S4 Hebrew speech-verb addressee rule (excludes קרא naming clauses)
SPEECH_IO_HEBREW_LEMMAS = {"אמר", "דבר", "צוה", "ענה", "שאל", "נגד", "שבע", "מלל", "חוה"}
ADDRESSEE_PREPS_HEBREW = {"אל", "ל"}
FUNCTION_WORD_CLASSES = {"art", "om", "cj", "prep", "rel", "ptcl"}

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

USFM_BY_BOOK: tuple[str, ...] = (
    "",
    "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA",
    "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO",
    "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO",
    "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT",
    "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP",
    "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE",
    "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
)

BOOK_NUM_BY_USFM: dict[str, int] = {
    usfm: i for i, usfm in enumerate(USFM_BY_BOOK) if usfm
}

VERIFIED_LEMMA_STATUSES = {
    "token_morphemes_exact",
    "macula_strong_x_disambiguated",
    "word_form_lemmas_unique",
    "lemmas_unique_strongs",
    "subdivision_default_g",
    "lemma_script_exact",
    "tagnt_dstrongs_exact",
}

PILOT_TARGETS: list[dict[str, Any]] = [
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/01-Gen-001-lowfat.xml",
        "verses": (
            [f"GEN 1:{i}" for i in range(1, 13)]
            + [
                "GEN 1:16",
                "GEN 1:20",
                "GEN 1:21",
                "GEN 1:24",
                "GEN 1:26",
                "GEN 1:27",
                "GEN 1:28",
                "GEN 1:30",
                "GEN 1:31",
            ]
        ),
    },
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/01-Gen-003-lowfat.xml",
        "verses": [f"GEN 3:{i}" for i in range(1, 14)] + ["GEN 3:20"],
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
        "verses": [f"JOS 17:{i}" for i in range(14, 19)],
    },
    {
        "edition": "macula-hebrew-wlc",
        "language": "hebrew",
        "source_file": "macula-hebrew/WLC/lowfat/19-Psa-003-lowfat.xml",
        "verses": [f"PSA 3:{i}" for i in range(1, 10)],
    },
    {
        "edition": "macula-greek-nestle1904",
        "language": "greek",
        "source_file": "macula-greek/Nestle1904/lowfat/01-matthew.xml",
        "verses": [f"MAT 28:{i}" for i in range(16, 21)],
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
        "verses": [f"LUK 8:{i}" for i in range(4, 16)],
    },
    {
        "edition": "macula-greek-nestle1904",
        "language": "greek",
        "source_file": "macula-greek/Nestle1904/lowfat/04-john.xml",
        "verses": (
            [f"JHN 1:{i}" for i in range(1, 15)]
            + ["JHN 2:16"]
            + [f"JHN 3:{i}" for i in range(14, 22)]
            + [f"JHN 4:{i}" for i in range(39, 43)]
            + ["JHN 4:46"]
            + [f"JHN 6:{i}" for i in range(35, 41)]
            + [f"JHN 6:{i}" for i in range(66, 70)]
        ),
    },
    {
        "edition": "macula-greek-sblgnt",
        "language": "greek",
        "source_file": "macula-greek/SBLGNT/lowfat/04-john.xml",
        "verses": ["JHN 2:16", "JHN 3:16", "JHN 3:17", "JHN 3:18", "JHN 4:46"],
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

    _global_cache: dict[str, Any] = {}

    @classmethod
    def _ensure_global_tables(cls) -> None:
        if cls._global_cache:
            return
        editions_by_key: dict[str, dict[str, Any]] = {}
        for r in iter_shard_rows("source_editions"):
            editions_by_key[r["edition_key"]] = r

        releases_by_id: dict[int, dict[str, Any]] = {}
        for r in iter_shard_rows("source_releases"):
            releases_by_id[int(r["id"])] = r

        license_registry_summary: dict[str, list[str]] = defaultdict(list)
        for r in iter_shard_rows("field_license_registry"):
            if str(r.get("status", "")).startswith("disabled"):
                key = f"{r.get('dataset_key')}:{r.get('field_name')}"
                license_registry_summary[r["status"]].append(key)

        lemmas_by_id: dict[int, dict[str, Any]] = {}
        lemmas_by_key_lower: dict[str, dict[str, Any]] = {}
        lemmas_by_lang_num: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
        for r in iter_shard_rows("lemmas"):
            lid = int(r["id"])
            lemmas_by_id[lid] = r
            lk = r.get("lemma_key")
            if lk:
                lemmas_by_key_lower[lk.lower()] = r
            parts = parse_strongs_parts(r.get("base_strongs"), "H" if r.get("language") in ("hbo", "arc") else "G")
            if parts:
                lemmas_by_lang_num[(parts[0], parts[1])].append(r)

        verses_by_id: dict[int, dict[str, Any]] = {}
        for r in iter_shard_rows("verses_immutable"):
            vid = int(r["id"])
            verses_by_id[vid] = r

        cls._global_cache = {
            "editions_by_key": editions_by_key,
            "releases_by_id": releases_by_id,
            "license_registry_summary": license_registry_summary,
            "lemmas_by_id": lemmas_by_id,
            "lemmas_by_key_lower": lemmas_by_key_lower,
            "lemmas_by_lang_num": lemmas_by_lang_num,
            "verses_by_id": verses_by_id,
        }

    def __init__(
        self,
        target_heb_ids: set[str] | None = None,
        target_grk_keys: set[tuple[str, str]] | None = None,
        book_num: int | None = None,
        edition: str | None = None,
        cache_dir: Path | None = None,
        force_rebuild_cache: bool = False,
    ) -> None:
        self._ensure_global_tables()
        self.editions_by_key = self._global_cache["editions_by_key"]
        self.releases_by_id = self._global_cache["releases_by_id"]
        self.license_registry_summary = self._global_cache["license_registry_summary"]
        self.lemmas_by_id = self._global_cache["lemmas_by_id"]
        self.lemmas_by_key_lower = self._global_cache["lemmas_by_key_lower"]
        self.lemmas_by_lang_num = self._global_cache["lemmas_by_lang_num"]
        self.verses_by_id = self._global_cache["verses_by_id"]

        self.heb_morphemes: dict[str, dict[str, Any]] = {}
        self.grk_tokens: dict[tuple[str, str], dict[str, Any]] = {}
        self.word_form_lemmas_by_word: dict[int, list[dict[str, Any]]] = defaultdict(list)
        self.token_morphemes_by_vw: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
        self.tagnt_by_vw: dict[tuple[int, int], dict[str, Any]] = {}

        if book_num is not None and edition is not None:
            self._load_for_book(book_num, edition, cache_dir, force_rebuild_cache)
        else:
            self._load_for_targets(target_heb_ids or set(), target_grk_keys or set())

    def _load_for_targets(self, target_heb_ids: set[str], target_grk_keys: set[tuple[str, str]]) -> None:
        remaining_heb = set(target_heb_ids)
        if remaining_heb:
            for r in iter_shard_rows("macula_hebrew_morphemes"):
                mid = r.get("macula_id")
                if mid in remaining_heb:
                    self.heb_morphemes[mid] = r
                    remaining_heb.remove(mid)
                    if not remaining_heb:
                        break

        remaining_grk = set(target_grk_keys)
        if remaining_grk:
            for r in iter_shard_rows("macula_greek_tokens"):
                key = (r.get("edition_key"), r.get("xml_id"))
                if key in remaining_grk:
                    self.grk_tokens[key] = r
                    remaining_grk.remove(key)
                    if not remaining_grk:
                        break

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

        if target_word_ids:
            for r in iter_shard_rows("word_form_lemmas"):
                wid = r.get("word_id")
                if wid is not None and int(wid) in target_word_ids:
                    self.word_form_lemmas_by_word[int(wid)].append(r)

        if target_verse_ids:
            for r in iter_shard_rows("token_morphemes"):
                vid = r.get("verse_id")
                if vid is not None and int(vid) in target_verse_ids:
                    self.token_morphemes_by_vw[(int(vid), int(r["word_position"]))].append(r)

        if target_verse_ids:
            for r in iter_shard_rows("tagnt_tokens"):
                vid = r.get("canonical_verse_id")
                swid = r.get("step_word_id")
                if vid is not None and swid is not None and int(vid) in target_verse_ids:
                    self.tagnt_by_vw[(int(vid), int(swid))] = r

    def _load_for_book(
        self,
        book_num: int,
        edition: str,
        cache_dir: Path | None = None,
        force_rebuild_cache: bool = False,
    ) -> None:
        c_dir = cache_dir or CROSSWALK_CACHE_DIR
        c_dir.mkdir(parents=True, exist_ok=True)
        cache_path = c_dir / f"crosswalk_{edition}_{book_num:02d}.json.gz"

        if cache_path.exists() and not force_rebuild_cache:
            try:
                with gzip.open(cache_path, "rt", encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("edition") == edition and data.get("book_num") == book_num:
                    if edition == "macula-hebrew-wlc":
                        self.heb_morphemes = data.get("heb_morphemes", {})
                        raw_wfl = data.get("word_form_lemmas_by_word", {})
                        self.word_form_lemmas_by_word = defaultdict(list, {int(k): v for k, v in raw_wfl.items()})
                        raw_tm = data.get("token_morphemes_by_vw", {})
                        self.token_morphemes_by_vw = defaultdict(list, {tuple(map(int, k.split(":"))): v for k, v in raw_tm.items()})
                    else:
                        raw_grk = data.get("grk_tokens", {})
                        self.grk_tokens = {(edition, k): v for k, v in raw_grk.items()}
                        raw_tagnt = data.get("tagnt_by_vw", {})
                        self.tagnt_by_vw = {tuple(map(int, k.split(":"))): v for k, v in raw_tagnt.items()}
                        raw_wfl = data.get("word_form_lemmas_by_word", {})
                        self.word_form_lemmas_by_word = defaultdict(list, {int(k): v for k, v in raw_wfl.items()})
                    return
            except Exception:
                pass

        if edition == "macula-hebrew-wlc":
            heb_morphemes = {}
            target_word_ids: set[int] = set()
            target_verse_ids: set[int] = set()
            for p in sorted((TABLES_DIR / "macula_hebrew_morphemes").glob("part-*.jsonl.gz")):
                with gzip.open(p, "rt", encoding="utf-8") as f:
                    for line in f:
                        if f'"book": {book_num}' in line or f'"book":{book_num}' in line:
                            r = json.loads(line)
                            if r.get("book") == book_num:
                                mid = r["macula_id"]
                                heb_morphemes[mid] = r
                                if r.get("word_id") is not None:
                                    target_word_ids.add(int(r["word_id"]))
                                if r.get("canonical_verse_id") is not None:
                                    target_verse_ids.add(int(r["canonical_verse_id"]))

            token_morphemes_by_vw = defaultdict(list)
            for p in sorted((TABLES_DIR / "token_morphemes").glob("part-*.jsonl.gz")):
                with gzip.open(p, "rt", encoding="utf-8") as f:
                    for line in f:
                        r = json.loads(line)
                        vid = r.get("verse_id")
                        if vid is not None and int(vid) in target_verse_ids:
                            key = f"{int(vid)}:{int(r['word_position'])}"
                            token_morphemes_by_vw[key].append(r)

            word_form_lemmas_by_word = defaultdict(list)
            for p in sorted((TABLES_DIR / "word_form_lemmas").glob("part-*.jsonl.gz")):
                with gzip.open(p, "rt", encoding="utf-8") as f:
                    for line in f:
                        r = json.loads(line)
                        wid = r.get("word_id")
                        if wid is not None and int(wid) in target_word_ids:
                            word_form_lemmas_by_word[str(wid)].append(r)

            payload = {
                "edition": edition,
                "book_num": book_num,
                "heb_morphemes": heb_morphemes,
                "token_morphemes_by_vw": token_morphemes_by_vw,
                "word_form_lemmas_by_word": word_form_lemmas_by_word,
            }
            with gzip.open(cache_path, "wt", encoding="utf-8") as f:
                json.dump(payload, f)

            self.heb_morphemes = heb_morphemes
            self.word_form_lemmas_by_word = defaultdict(list, {int(k): v for k, v in word_form_lemmas_by_word.items()})
            self.token_morphemes_by_vw = defaultdict(list, {tuple(map(int, k.split(":"))): v for k, v in token_morphemes_by_vw.items()})
        else:
            grk_tokens = {}
            target_step_word_ids: set[int] = set()
            target_verse_ids = set()
            for p in sorted((TABLES_DIR / "macula_greek_tokens").glob("part-*.jsonl.gz")):
                with gzip.open(p, "rt", encoding="utf-8") as f:
                    for line in f:
                        if f'"book": {book_num}' in line or f'"book":{book_num}' in line:
                            r = json.loads(line)
                            if r.get("book") == book_num and r.get("edition_key") == edition:
                                xid = r["xml_id"]
                                grk_tokens[xid] = r
                                if r.get("step_word_id") is not None:
                                    target_step_word_ids.add(int(r["step_word_id"]))
                                if r.get("canonical_verse_id") is not None:
                                    target_verse_ids.add(int(r["canonical_verse_id"]))

            tagnt_by_vw = {}
            for p in sorted((TABLES_DIR / "tagnt_tokens").glob("part-*.jsonl.gz")):
                with gzip.open(p, "rt", encoding="utf-8") as f:
                    for line in f:
                        if f'"book": {book_num}' in line or f'"book":{book_num}' in line:
                            r = json.loads(line)
                            if r.get("book") == book_num:
                                vid = r.get("canonical_verse_id")
                                swid = r.get("step_word_id")
                                if vid is not None and swid is not None:
                                    tagnt_by_vw[f"{int(vid)}:{int(swid)}"] = r

            word_form_lemmas_by_word = defaultdict(list)
            for p in sorted((TABLES_DIR / "word_form_lemmas").glob("part-*.jsonl.gz")):
                with gzip.open(p, "rt", encoding="utf-8") as f:
                    for line in f:
                        r = json.loads(line)
                        wid = r.get("word_id")
                        if wid is not None and int(wid) in target_step_word_ids:
                            word_form_lemmas_by_word[str(wid)].append(r)

            payload = {
                "edition": edition,
                "book_num": book_num,
                "grk_tokens": grk_tokens,
                "tagnt_by_vw": tagnt_by_vw,
                "word_form_lemmas_by_word": word_form_lemmas_by_word,
            }
            with gzip.open(cache_path, "wt", encoding="utf-8") as f:
                json.dump(payload, f)

            self.grk_tokens = {(edition, k): v for k, v in grk_tokens.items()}
            self.tagnt_by_vw = {tuple(map(int, k.split(":"))): v for k, v in tagnt_by_vw.items()}
            self.word_form_lemmas_by_word = defaultdict(list, {int(k): v for k, v in word_form_lemmas_by_word.items()})

    def edition_release_key(self, edition_key: str) -> str:
        ed = self.editions_by_key.get(edition_key)
        if not ed:
            return "unknown"
        rel = self.releases_by_id.get(int(ed["source_release_id"]))
        return str(rel["release_key"]) if rel else "unknown"

    def canonical_ref_for_verse_id(self, cvid: str | int | None) -> str | None:
        if cvid is None:
            return None
        vrow = self.verses_by_id.get(int(cvid))
        if not vrow:
            return None
        b = int(vrow["book"])
        usfm = USFM_BY_BOOK[b] if 0 <= b < len(USFM_BY_BOOK) and USFM_BY_BOOK[b] else f"B{b}"
        return f"{usfm} {vrow['chapter']}:{vrow['verse_nr']}"

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
                raw_lid = tm.get("lemma_id")
                if raw_lid is None:
                    continue
                try:
                    lid_int = int(raw_lid)
                except (ValueError, TypeError):
                    continue
                lrow = self.lemmas_by_id.get(lid_int)
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
            try:
                wid_int = int(word_id)
            except (ValueError, TypeError):
                wid_int = None
            if wid_int is not None:
                for wfl in self.word_form_lemmas_by_word.get(wid_int, []):
                    raw_lid = wfl.get("lemma_id")
                    if raw_lid is None:
                        continue
                    try:
                        lid_int = int(raw_lid)
                    except (ValueError, TypeError):
                        continue
                    lrow = self.lemmas_by_id.get(lid_int)
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
            raw_lid = wfl.get("lemma_id")
            if raw_lid is None:
                continue
            try:
                lid_int = int(raw_lid)
            except (ValueError, TypeError):
                continue
            lrow = self.lemmas_by_id.get(lid_int)
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
    quotation = cl.get("quotation_status")
    speaker_scope = cl.get("speaker_scope")
    if not quotation or not speaker_scope:
        if cl["speech_quoted"]:
            speaker_scope = "quoted_speaker"
            quotation = "nested_speech_object" if cl.get("role_in_parent") == "o" else "direct_speech_turn"
        else:
            speaker_scope = "unknown"
            quotation = "unknown"
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
        "clauses_eligible_grammatical_indirect_object_of": 0,
        "clauses_eligible_grammatical_second_object_of": 0,
        "clauses_eligible_modifies": 0,
        "clauses_eligible_possessive_construction_with": 0,
        "frames_emitted": 0,
        "relations_emitted_total": 0,
        "relations_by_predicate": {
            "grammatical_subject_of": 0,
            "grammatical_object_of": 0,
            "grammatical_indirect_object_of": 0,
            "grammatical_second_object_of": 0,
            "modifies": 0,
            "possessive_construction_with": 0,
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


def _assess_pair_quality(
    *,
    subj_word: dict[str, Any],
    subj_cw: dict[str, Any],
    subj_head: dict[str, Any],
    obj_word: dict[str, Any],
    obj_cw: dict[str, Any],
    obj_head: dict[str, Any],
    clause_align: str,
    pred_ambiguous: bool = False,
    force_rule_derived: bool = False,
) -> tuple[str, list[str]]:
    """Classify (subject -> object) relation quality strictly without promoting uncertain pairs."""
    cand_reasons: list[str] = []
    if pred_ambiguous:
        cand_reasons.append("ambiguous_multiple_predicates")
    if not subj_head.get("is_verified_head", True):
        cand_reasons.append(subj_head["resolution_kind"])
    if not obj_head.get("is_verified_head", True):
        cand_reasons.append(f"head_{obj_head['resolution_kind']}")
    if (subj_word.get("class") == "pron") and not subj_word.get("referent"):
        cand_reasons.append("unresolved_pronoun_referent")
    if (obj_word.get("class") == "pron") and not obj_word.get("referent"):
        cand_reasons.append("unresolved_head_pronoun_referent")
    if subj_cw["lemma_resolution_status"] not in VERIFIED_LEMMA_STATUSES:
        cand_reasons.append(f"uncertain_lemma:{subj_cw['lemma_resolution_status']}")
    if obj_cw["lemma_resolution_status"] not in VERIFIED_LEMMA_STATUSES:
        cand_reasons.append(f"uncertain_head_lemma:{obj_cw['lemma_resolution_status']}")
    if clause_align not in ("native_source", "versification_shifted"):
        cand_reasons.append(f"alignment:{clause_align}")

    if cand_reasons:
        return "candidate", cand_reasons
    if (
        not force_rule_derived
        and subj_head.get("resolution_kind") == "direct_role_word"
        and obj_head.get("resolution_kind") == "direct_role_word"
    ):
        return "source_explicit", []
    return "rule_derived", []


def _make_relation_record(
    *,
    edition: str,
    cid: str,
    frame_id: str,
    clause_node_id: str,
    effective_ref: str,
    predicate_name: str,
    rule_id: str,
    subj_word: dict[str, Any],
    subj_cw: dict[str, Any],
    obj_word: dict[str, Any],
    obj_cw: dict[str, Any],
    quality: str,
    context: dict[str, str],
) -> dict[str, Any]:
    return {
        "relation_id": f"rel:{edition}:{cid}:{predicate_name}:{subj_word['id']}:{obj_word['id']}",
        "frame_id": frame_id,
        "subject_token_id": subj_word["id"],
        "subject_lemma_id": subj_cw["lemma_id"],
        "predicate": predicate_name,
        "object_token_id": obj_word["id"],
        "object_lemma_id": obj_cw["lemma_id"],
        "evidence": {
            "edition": edition,
            "reference": effective_ref,
            "source_clause_id": clause_node_id,
            "rule_id": rule_id,
        },
        "quality": quality,
        "qualifiers": {
            "polarity": context["polarity"],
            "modality": context["modality"],
            "voice": context["voice"],
            "quotation": context["quotation"],
        },
    }


def run_pilot_extraction(out_dir: Path) -> dict[str, Any]:
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
        rel_source_path = spec["source_file"].split("/", 1)[1] if "/" in spec["source_file"] else spec["source_file"]
        all_clauses = S1ClauseExtractor(words, spec["language"], bundle).extract_file(
            root,
            edition=spec["edition"],
            source_path=rel_source_path,
        )
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
    clause_lemma_presence: dict[tuple[str, str], set[str]] = defaultdict(set)
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

            raw_vref = cl["verse_ref"]
            effective_ref = (
                crosswalk.canonical_ref_for_verse_id(tok_cvids[0]) or raw_vref
                if tok_cvids and clause_align != "not_in_canonical_verse"
                else raw_vref
            )
            cid = f"{effective_ref}#cl{cl['clause_index_in_verse']}"
            clause_node_id = cl.get("syntax_node_key") or cid
            frame_id = f"frame:{edition}:{cid}:svov1"

            for wid in cl["token_ids"]:
                tcw_tok = crosswalk.resolve_token(edition, wid, words.get(wid))
                if tcw_tok["lemma_id"]:
                    clause_lemma_presence[(edition, tcw_tok["lemma_id"])].add(clause_node_id)

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
            if cl.get("predicate_ambiguous"):
                warnings.append("ambiguous_multiple_predicates")
            elif len(v_heads) > 1:
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
                    elif tcw["lemma_resolution_status"] not in VERIFIED_LEMMA_STATUSES:
                        reasons.append(f"uncertain_lemma:{tcw['lemma_resolution_status']}")

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

            # Frame quality assessment & R2+R3.1 relation emission
            clause_relations: list[dict[str, Any]] = []
            context = build_frame_context(cl)
            lang_pfx = "he" if lang == "hebrew" else "gr"

            # Documented BibleOntology S4 Hebrew speech-verb addressee indirect-object candidates
            speech_io_heads: list[tuple[int, dict[str, Any]]] = []
            if (
                lang == "hebrew"
                and clause_align != "not_in_canonical_verse"
                and cl["clause_kind"] == "verbal"
                and pred_word
                and pred_cw
                and pred_cw["lemma_id"]
                and not cl.get("predicate_ambiguous")
                and hebrew_consonants(pred_word.get("lemma")) in SPEECH_IO_HEBREW_LEMMAS
            ):
                for pp_idx, pp_h in enumerate(cl["resolved_roles"].get("pp", [])):
                    if not pp_h.get("is_clausal") and (set(pp_h.get("prep_lemmas") or []) & ADDRESSEE_PREPS_HEBREW):
                        speech_io_heads.append((pp_idx, pp_h))
                        if pp_h.get("word") is not None:
                            pw_h = pp_h["word"]
                            ptcw = crosswalk.resolve_token(edition, pw_h["id"], pw_h)
                            is_unresolved_pron = (pw_h.get("class") == "pron") and not pw_h.get("referent")
                            io_reasons: list[str] = []
                            if not pp_h["is_verified_head"]:
                                io_reasons.append(pp_h["resolution_kind"])
                            if is_unresolved_pron:
                                io_reasons.append("unresolved_pronoun_referent")
                            if ptcw["crosswalk_status"] != "resolved":
                                io_reasons.append(f"crosswalk:{ptcw['crosswalk_status']}")
                            elif ptcw["lemma_resolution_status"] not in VERIFIED_LEMMA_STATUSES:
                                io_reasons.append(f"uncertain_lemma:{ptcw['lemma_resolution_status']}")
                            io_role_rec: dict[str, Any] = {
                                "role": "grammatical_indirect_object",
                                "head_token_id": pw_h["id"],
                                "lemma_id": ptcw["lemma_id"],
                                "source_phrase_id": make_phrase_id(cid, "pp", pp_idx, pp_h["token_span"]),
                                "state": "candidate" if io_reasons else "explicit",
                                "head_resolution": f"{pp_h['resolution_kind']}+speech_pp",
                            }
                            if io_reasons:
                                io_role_rec["reason"] = ";".join(io_reasons)
                            roles_out.append(io_role_rec)

            if clause_align == "not_in_canonical_verse":
                frame_quality = "not_covered"
                m["skip_reasons"]["not_in_canonical_verse"] += 1
                m["unsupported_constructions"]["not_in_canonical_verse"] += 1
                warnings.append("skipped:not_in_canonical_verse")
            else:
                if cl["clause_kind"] != "verbal":
                    skip_tag = f"non_verbal_clause:{cl['clause_kind']}"
                    m["skip_reasons"][skip_tag] += 1
                    m["unsupported_constructions"][cl["clause_kind"]] += 1
                    warnings.append(f"skipped_svo:{skip_tag}")
                elif not pred_word or not pred_cw or not pred_cw["lemma_id"]:
                    reason = pred_cw["crosswalk_status"] if pred_cw else "missing_predicate_token"
                    m["skip_reasons"][f"predicate_unmapped:{reason}"] += 1
                    warnings.append(f"skipped_svo:predicate_unmapped:{reason}")
                else:
                    pred_head = v_heads[0]
                    role_specs: list[tuple[str, str, str, bool, list[dict[str, Any]]]] = [
                        ("s", "grammatical_subject_of", f"{lang_pfx}_clause_s_v_v1", False, cl["resolved_roles"].get("s", [])),
                        ("o", "grammatical_object_of", f"{lang_pfx}_clause_o_v_v1", False, cl["resolved_roles"].get("o", [])),
                        ("io", "grammatical_indirect_object_of", f"{lang_pfx}_clause_io_v_v1", False, cl["resolved_roles"].get("io", [])),
                        ("o2", "grammatical_second_object_of", f"{lang_pfx}_clause_o2_v_v1", False, cl["resolved_roles"].get("o2", [])),
                    ]
                    if speech_io_heads:
                        role_specs.append(
                            (
                                "pp",
                                "grammatical_indirect_object_of",
                                "he_clause_io_speech_pp_v1",
                                True,
                                [pair[1] for pair in speech_io_heads],
                            )
                        )
                    matched_pp_spans = {id(pair[1]) for pair in speech_io_heads}
                    for pp_h in cl["resolved_roles"].get("pp", []):
                        if id(pp_h) not in matched_pp_spans:
                            m["skip_reasons"]["pp:non_io_prepositional_phrase"] += 1

                    for role_code, predicate_name, rule_id, force_rd, role_entries in role_specs:
                        if not role_entries:
                            continue
                        m[f"clauses_eligible_{predicate_name}"] += 1

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

                            rel_quality, cand_reasons = _assess_pair_quality(
                                subj_word=w,
                                subj_cw=tcw,
                                subj_head=h,
                                obj_word=pred_word,
                                obj_cw=pred_cw,
                                obj_head=pred_head,
                                clause_align=clause_align,
                                pred_ambiguous=bool(cl.get("predicate_ambiguous")),
                                force_rule_derived=force_rd,
                            )
                            for cr in cand_reasons:
                                m["candidate_reasons"][cr] += 1

                            rel = _make_relation_record(
                                edition=edition,
                                cid=cid,
                                frame_id=frame_id,
                                clause_node_id=clause_node_id,
                                effective_ref=effective_ref,
                                predicate_name=predicate_name,
                                rule_id=rule_id,
                                subj_word=w,
                                subj_cw=tcw,
                                obj_word=pred_word,
                                obj_cw=pred_cw,
                                quality=rel_quality,
                                context=context,
                            )
                            clause_relations.append(rel)
                            m["relations_emitted_total"] += 1
                            m["relations_by_predicate"][predicate_name] += 1
                            m["relations_by_quality"][rel_quality] += 1

                # R3.1 C/D/E: Phrase-internal modifies & possessive_construction_with (applies inside verbal & nominal clauses)
                for pd in cl.get("phrase_diagnostics", []):
                    pk = pd["relation_kind"]
                    sr = pd["skip_reason"]
                    m["skip_reasons"][f"{pk}:{sr}"] += 1
                    if sr == "clausal_constituent":
                        m["unsupported_constructions"][f"clausal_{pk}"] += 1

                seen_phrase_preds_in_clause: set[str] = set()
                for pr in cl.get("phrase_relations", []):
                    pred_name = pr["relation_kind"]
                    rule_pfx = "mod" if pred_name == "modifies" else "poss"
                    rule_id = f"{lang_pfx}_phrase_{rule_pfx}_v1"
                    if pred_name not in seen_phrase_preds_in_clause:
                        m[f"clauses_eligible_{pred_name}"] += 1
                        seen_phrase_preds_in_clause.add(pred_name)

                    dh = pr["dep_head"]
                    th = pr["target_head"]
                    dw = dh["word"]
                    tw = th["word"]

                    if (
                        (dw.get("class") in FUNCTION_WORD_CLASSES)
                        or (tw.get("class") in FUNCTION_WORD_CLASSES)
                    ):
                        m["skip_reasons"][f"{pred_name}:function_word_endpoint"] += 1
                        continue
                    if (
                        pred_name == "possessive_construction_with"
                        and lang == "greek"
                        and dw.get("case") != "genitive"
                    ):
                        m["skip_reasons"]["possessive_construction_with:non_genitive_dependent"] += 1
                        continue

                    dcw = crosswalk.resolve_token(edition, dw["id"], dw)
                    tcw_head = crosswalk.resolve_token(edition, tw["id"], tw)
                    if not dcw["lemma_id"]:
                        m["skip_reasons"][f"{pred_name}:{dcw['crosswalk_status']}"] += 1
                        m["missing_mappings"].append({
                            "edition": edition,
                            "clause_id": cid,
                            "token_id": dw["id"],
                            "reason": dcw["crosswalk_status"],
                        })
                        continue
                    if not tcw_head["lemma_id"]:
                        m["skip_reasons"][f"{pred_name}:{tcw_head['crosswalk_status']}"] += 1
                        m["missing_mappings"].append({
                            "edition": edition,
                            "clause_id": cid,
                            "token_id": tw["id"],
                            "reason": tcw_head["crosswalk_status"],
                        })
                        continue

                    rel_quality, cand_reasons = _assess_pair_quality(
                        subj_word=dw,
                        subj_cw=dcw,
                        subj_head=dh,
                        obj_word=tw,
                        obj_cw=tcw_head,
                        obj_head=th,
                        clause_align=clause_align,
                        pred_ambiguous=False,
                        force_rule_derived=True,
                    )
                    for cr in cand_reasons:
                        m["candidate_reasons"][cr] += 1

                    rel = _make_relation_record(
                        edition=edition,
                        cid=cid,
                        frame_id=frame_id,
                        clause_node_id=clause_node_id,
                        effective_ref=effective_ref,
                        predicate_name=pred_name,
                        rule_id=rule_id,
                        subj_word=dw,
                        subj_cw=dcw,
                        obj_word=tw,
                        obj_cw=tcw_head,
                        quality=rel_quality,
                        context=context,
                    )
                    clause_relations.append(rel)
                    m["relations_emitted_total"] += 1
                    m["relations_by_predicate"][pred_name] += 1
                    m["relations_by_quality"][rel_quality] += 1

                if clause_relations:
                    if any(r["quality"] == "source_explicit" for r in clause_relations):
                        frame_quality = "source_explicit"
                    elif any(r["quality"] == "rule_derived" for r in clause_relations):
                        frame_quality = "rule_derived"
                    else:
                        frame_quality = "candidate"
                elif cl["clause_kind"] != "verbal":
                    frame_quality = (
                        "candidate"
                        if any(r["state"] in ("candidate", "unresolved") for r in roles_out)
                        else "source_explicit"
                    )
                elif not pred_word or not pred_cw or not pred_cw["lemma_id"]:
                    frame_quality = "candidate"
                else:
                    has_candidate_svo_role = any(
                        r["state"] in ("candidate", "unresolved")
                        for r in roles_out
                        if r["role"] in ("grammatical_subject", "grammatical_object")
                    )
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
                    "clause_node_id": clause_node_id,
                    "reference": effective_ref,
                    "canonical_verse_ids": tok_cvids,
                    "alignment_status": clause_align,
                },
                "predicate": pred_block,
                "roles": roles_out,
                "context": context,
                "extraction": {
                    "algorithm": "bibleontology_s0_s1_s2_r3_v1",
                    "rule_version": RULE_VERSION,
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
        "schema_version": "1.2",
        "pilot_scope_note": "Stratified R3 Hebrew/Greek verification slice; metrics do not represent whole-Bible coverage.",
        "languages": {
            lang: {
                "clauses_examined": m["clauses_examined"],
                "clauses_parsed": m["clauses_parsed"],
                "clauses_eligible_grammatical_subject_of": m["clauses_eligible_grammatical_subject_of"],
                "clauses_eligible_grammatical_object_of": m["clauses_eligible_grammatical_object_of"],
                "clauses_eligible_grammatical_indirect_object_of": m["clauses_eligible_grammatical_indirect_object_of"],
                "clauses_eligible_grammatical_second_object_of": m["clauses_eligible_grammatical_second_object_of"],
                "clauses_eligible_modifies": m["clauses_eligible_modifies"],
                "clauses_eligible_possessive_construction_with": m["clauses_eligible_possessive_construction_with"],
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

    # R3 is an offline build milestone (§8): do NOT overwrite/bloat supabase/functions/bible-mcp/relationships-v2.ts.
    r3_report = build_r3_graph_artifacts(
        out_dir=out_dir,
        frames=frames,
        relations=relations,
        coverage_doc=coverage_doc,
        inventory_doc=inventory_doc,
        clause_lemma_presence=clause_lemma_presence,
        rule_version=RULE_VERSION,
    )

    report = {
        "status": "ok",
        "out_dir": str(out_dir),
        "hebrew": coverage_doc["languages"]["hebrew"],
        "greek": coverage_doc["languages"]["greek"],
        "r3_summary_totals": r3_report["totals"],
    }
    return report


def get_book_source_files(edition: str, book_usfm: str) -> list[tuple[str, Path]]:
    usfm = book_usfm.upper()
    book_num = BOOK_NUM_BY_USFM.get(usfm)
    if not book_num:
        raise ValueError(f"Unknown USFM book code: {book_usfm}")
    if edition == "macula-hebrew-wlc":
        if not (1 <= book_num <= 39):
            return []
        prefix = f"{book_num:02d}-"
        lowfat_dir = SOURCES_DIR / "macula-hebrew" / "WLC" / "lowfat"
        matches = sorted(lowfat_dir.glob(f"{prefix}*.xml"))
        return [(f"macula-hebrew/WLC/lowfat/{p.name}", p) for p in matches]
    elif edition == "macula-greek-nestle1904":
        if not (40 <= book_num <= 66):
            return []
        prefix = f"{(book_num - 39):02d}-"
        lowfat_dir = SOURCES_DIR / "macula-greek" / "Nestle1904" / "lowfat"
        matches = sorted(lowfat_dir.glob(f"{prefix}*.xml"))
        return [(f"macula-greek/Nestle1904/lowfat/{p.name}", p) for p in matches]
    elif edition == "macula-greek-sblgnt":
        if not (40 <= book_num <= 66):
            return []
        prefix = f"{(book_num - 39):02d}-"
        lowfat_dir = SOURCES_DIR / "macula-greek" / "SBLGNT" / "lowfat"
        matches = sorted(lowfat_dir.glob(f"{prefix}*.xml"))
        return [(f"macula-greek/SBLGNT/lowfat/{p.name}", p) for p in matches]
    return []


def extract_book_partition(
    edition: str,
    book_usfm: str,
    out_dir: Path,
    bundle: dict[str, Any],
    force_rebuild: bool = False,
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    usfm = book_usfm.upper()
    book_num = BOOK_NUM_BY_USFM[usfm]
    lang = "hebrew" if edition == "macula-hebrew-wlc" else "greek"
    source_files = get_book_source_files(edition, usfm)
    if not source_files:
        raise ValueError(f"No source XML files found for {edition} {usfm}")

    part_dir = out_dir / "partitions" / edition / usfm
    manifest_path = part_dir / "partition-manifest.json"

    file_hashes: list[dict[str, Any]] = []
    for rel_path, abs_path in source_files:
        sha, byte_len = lf_sha256_and_bytes(abs_path)
        file_hashes.append({
            "source_file": rel_path,
            "abs_path": str(abs_path),
            "sha256": sha,
            "bytes": byte_len,
        })

    if manifest_path.exists() and not force_rebuild:
        try:
            cached_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (
                cached_manifest.get("status") == "COMPLETE"
                and cached_manifest.get("rule_version") == RULE_VERSION
                and cached_manifest.get("edition") == edition
                and cached_manifest.get("book") == usfm
            ):
                cached_files = {f["source_file"]: f["sha256"] for f in cached_manifest.get("source_files", [])}
                current_files = {f["source_file"]: f["sha256"] for f in file_hashes}
                if cached_files == current_files:
                    print(f"[{edition}/{usfm}] Reusing verified existing partition ({cached_manifest['metrics']['frames_emitted']} frames, {cached_manifest['metrics']['relations_emitted_total']} rels).")
                    return cached_manifest
        except Exception:
            pass

    import time
    import tracemalloc
    tracemalloc.start()
    t_start = time.perf_counter()

    print(f"[{edition}/{usfm}] Extracting partition from {len(source_files)} source files...")
    crosswalk = StaticCrosswalkIndex(book_num=book_num, edition=edition, cache_dir=cache_dir, force_rebuild_cache=force_rebuild)
    rel_key = crosswalk.edition_release_key(edition)

    m = init_lang_metrics()
    frames: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    file_inventory: list[dict[str, Any]] = []
    unmapped_tokens: list[dict[str, Any]] = []
    seen_unmapped_keys: set[tuple[str, str]] = set()

    for file_info in file_hashes:
        rel_src = file_info["source_file"]
        abs_src = Path(file_info["abs_path"])
        root = ET.parse(abs_src).getroot()
        words = extract_s0_words(root, lang)
        rel_sub = rel_src.split("/", 1)[1] if "/" in rel_src else rel_src
        all_clauses = S1ClauseExtractor(words, lang, bundle).extract_file(root, edition=edition, source_path=rel_sub)

        file_token_ids: set[str] = set()
        file_mapped_count = 0
        file_missing_reasons: Counter[str] = Counter()

        for cl in all_clauses:
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
                            "source_file": rel_src,
                            "token_id": wid,
                            "verse_ref": (words.get(wid) or {}).get("verse_ref"),
                            "text": (words.get(wid) or {}).get("text"),
                            "status": cw["crosswalk_status"],
                            "candidate_lemmas": cw.get("candidate_lemmas", []),
                        })

            m["clauses_examined"] += 1
            m["clauses_parsed"] += 1

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

            raw_vref = cl["verse_ref"]
            effective_ref = (
                crosswalk.canonical_ref_for_verse_id(tok_cvids[0]) or raw_vref
                if tok_cvids and clause_align != "not_in_canonical_verse"
                else raw_vref
            )
            cid = f"{effective_ref}#cl{cl['clause_index_in_verse']}"
            clause_node_id = cl.get("syntax_node_key") or cid
            frame_id = f"frame:{edition}:{cid}:svov1"

            pred_word = cl["predicate_word"]
            pred_cw = crosswalk.resolve_token(edition, pred_word["id"], pred_word) if pred_word else None
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
            if cl.get("predicate_ambiguous"):
                warnings.append("ambiguous_multiple_predicates")
            elif len(v_heads) > 1:
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
                    elif tcw["lemma_resolution_status"] not in VERIFIED_LEMMA_STATUSES:
                        reasons.append(f"uncertain_lemma:{tcw['lemma_resolution_status']}")

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

            clause_relations: list[dict[str, Any]] = []
            context = build_frame_context(cl)
            lang_pfx = "he" if lang == "hebrew" else "gr"

            speech_io_heads: list[tuple[int, dict[str, Any]]] = []
            if (
                lang == "hebrew"
                and clause_align != "not_in_canonical_verse"
                and cl["clause_kind"] == "verbal"
                and pred_word
                and pred_cw
                and pred_cw["lemma_id"]
                and not cl.get("predicate_ambiguous")
                and hebrew_consonants(pred_word.get("lemma")) in SPEECH_IO_HEBREW_LEMMAS
            ):
                for pp_idx, pp_h in enumerate(cl["resolved_roles"].get("pp", [])):
                    if not pp_h.get("is_clausal") and (set(pp_h.get("prep_lemmas") or []) & ADDRESSEE_PREPS_HEBREW):
                        speech_io_heads.append((pp_idx, pp_h))
                        if pp_h.get("word") is not None:
                            pw_h = pp_h["word"]
                            ptcw = crosswalk.resolve_token(edition, pw_h["id"], pw_h)
                            is_unresolved_pron = (pw_h.get("class") == "pron") and not pw_h.get("referent")
                            io_reasons: list[str] = []
                            if not pp_h["is_verified_head"]:
                                io_reasons.append(pp_h["resolution_kind"])
                            if is_unresolved_pron:
                                io_reasons.append("unresolved_pronoun_referent")
                            if ptcw["crosswalk_status"] != "resolved":
                                io_reasons.append(f"crosswalk:{ptcw['crosswalk_status']}")
                            elif ptcw["lemma_resolution_status"] not in VERIFIED_LEMMA_STATUSES:
                                io_reasons.append(f"uncertain_lemma:{ptcw['lemma_resolution_status']}")
                            io_role_rec: dict[str, Any] = {
                                "role": "grammatical_indirect_object",
                                "head_token_id": pw_h["id"],
                                "lemma_id": ptcw["lemma_id"],
                                "source_phrase_id": make_phrase_id(cid, "pp", pp_idx, pp_h["token_span"]),
                                "state": "candidate" if io_reasons else "explicit",
                                "head_resolution": f"{pp_h['resolution_kind']}+speech_pp",
                            }
                            if io_reasons:
                                io_role_rec["reason"] = ";".join(io_reasons)
                            roles_out.append(io_role_rec)

            if clause_align == "not_in_canonical_verse":
                frame_quality = "not_covered"
                m["skip_reasons"]["not_in_canonical_verse"] += 1
                m["unsupported_constructions"]["not_in_canonical_verse"] += 1
                warnings.append("skipped:not_in_canonical_verse")
            else:
                if cl["clause_kind"] != "verbal":
                    skip_tag = f"non_verbal_clause:{cl['clause_kind']}"
                    m["skip_reasons"][skip_tag] += 1
                    m["unsupported_constructions"][cl["clause_kind"]] += 1
                    warnings.append(f"skipped_svo:{skip_tag}")
                elif not pred_word or not pred_cw or not pred_cw["lemma_id"]:
                    reason = pred_cw["crosswalk_status"] if pred_cw else "missing_predicate_token"
                    m["skip_reasons"][f"predicate_unmapped:{reason}"] += 1
                    warnings.append(f"skipped_svo:predicate_unmapped:{reason}")
                else:
                    pred_head = v_heads[0]
                    role_specs: list[tuple[str, str, str, bool, list[dict[str, Any]]]] = [
                        ("s", "grammatical_subject_of", f"{lang_pfx}_clause_s_v_v1", False, cl["resolved_roles"].get("s", [])),
                        ("o", "grammatical_object_of", f"{lang_pfx}_clause_o_v_v1", False, cl["resolved_roles"].get("o", [])),
                        ("io", "grammatical_indirect_object_of", f"{lang_pfx}_clause_io_v_v1", False, cl["resolved_roles"].get("io", [])),
                        ("o2", "grammatical_second_object_of", f"{lang_pfx}_clause_o2_v_v1", False, cl["resolved_roles"].get("o2", [])),
                    ]
                    if speech_io_heads:
                        role_specs.append(
                            (
                                "pp",
                                "grammatical_indirect_object_of",
                                "he_clause_io_speech_pp_v1",
                                True,
                                [pair[1] for pair in speech_io_heads],
                            )
                        )
                    matched_pp_spans = {id(pair[1]) for pair in speech_io_heads}
                    for pp_h in cl["resolved_roles"].get("pp", []):
                        if id(pp_h) not in matched_pp_spans:
                            m["skip_reasons"]["pp:non_io_prepositional_phrase"] += 1

                    for role_code, predicate_name, rule_id, force_rd, role_entries in role_specs:
                        if not role_entries:
                            continue
                        m[f"clauses_eligible_{predicate_name}"] += 1

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

                            rel_quality, cand_reasons = _assess_pair_quality(
                                subj_word=w,
                                subj_cw=tcw,
                                subj_head=h,
                                obj_word=pred_word,
                                obj_cw=pred_cw,
                                obj_head=pred_head,
                                clause_align=clause_align,
                                pred_ambiguous=bool(cl.get("predicate_ambiguous")),
                                force_rule_derived=force_rd,
                            )
                            for cr in cand_reasons:
                                m["candidate_reasons"][cr] += 1

                            rel = _make_relation_record(
                                edition=edition,
                                cid=cid,
                                frame_id=frame_id,
                                clause_node_id=clause_node_id,
                                effective_ref=effective_ref,
                                predicate_name=predicate_name,
                                rule_id=rule_id,
                                subj_word=w,
                                subj_cw=tcw,
                                obj_word=pred_word,
                                obj_cw=pred_cw,
                                quality=rel_quality,
                                context=context,
                            )
                            clause_relations.append(rel)
                            m["relations_emitted_total"] += 1
                            m["relations_by_predicate"][predicate_name] += 1
                            m["relations_by_quality"][rel_quality] += 1

                for pd in cl.get("phrase_diagnostics", []):
                    pk = pd["relation_kind"]
                    sr = pd["skip_reason"]
                    m["skip_reasons"][f"{pk}:{sr}"] += 1
                    if sr == "clausal_constituent":
                        m["unsupported_constructions"][f"clausal_{pk}"] += 1

                seen_phrase_preds_in_clause: set[str] = set()
                for pr in cl.get("phrase_relations", []):
                    pred_name = pr["relation_kind"]
                    rule_pfx = "mod" if pred_name == "modifies" else "poss"
                    rule_id = f"{lang_pfx}_phrase_{rule_pfx}_v1"
                    if pred_name not in seen_phrase_preds_in_clause:
                        m[f"clauses_eligible_{pred_name}"] += 1
                        seen_phrase_preds_in_clause.add(pred_name)

                    dh = pr["dep_head"]
                    th = pr["target_head"]
                    dw = dh["word"]
                    tw = th["word"]

                    if (
                        (dw.get("class") in FUNCTION_WORD_CLASSES)
                        or (tw.get("class") in FUNCTION_WORD_CLASSES)
                    ):
                        m["skip_reasons"][f"{pred_name}:function_word_endpoint"] += 1
                        continue
                    if (
                        pred_name == "possessive_construction_with"
                        and lang == "greek"
                        and dw.get("case") != "genitive"
                    ):
                        m["skip_reasons"]["possessive_construction_with:non_genitive_dependent"] += 1
                        continue

                    dcw = crosswalk.resolve_token(edition, dw["id"], dw)
                    tcw_head = crosswalk.resolve_token(edition, tw["id"], tw)
                    if not dcw["lemma_id"]:
                        m["skip_reasons"][f"{pred_name}:{dcw['crosswalk_status']}"] += 1
                        m["missing_mappings"].append({
                            "edition": edition,
                            "clause_id": cid,
                            "token_id": dw["id"],
                            "reason": dcw["crosswalk_status"],
                        })
                        continue
                    if not tcw_head["lemma_id"]:
                        m["skip_reasons"][f"{pred_name}:{tcw_head['crosswalk_status']}"] += 1
                        m["missing_mappings"].append({
                            "edition": edition,
                            "clause_id": cid,
                            "token_id": tw["id"],
                            "reason": tcw_head["crosswalk_status"],
                        })
                        continue

                    rel_quality, cand_reasons = _assess_pair_quality(
                        subj_word=dw,
                        subj_cw=dcw,
                        subj_head=dh,
                        obj_word=tw,
                        obj_cw=tcw_head,
                        obj_head=th,
                        clause_align=clause_align,
                        pred_ambiguous=False,
                        force_rule_derived=True,
                    )
                    for cr in cand_reasons:
                        m["candidate_reasons"][cr] += 1

                    rel = _make_relation_record(
                        edition=edition,
                        cid=cid,
                        frame_id=frame_id,
                        clause_node_id=clause_node_id,
                        effective_ref=effective_ref,
                        predicate_name=pred_name,
                        rule_id=rule_id,
                        subj_word=dw,
                        subj_cw=dcw,
                        obj_word=tw,
                        obj_cw=tcw_head,
                        quality=rel_quality,
                        context=context,
                    )
                    clause_relations.append(rel)
                    m["relations_emitted_total"] += 1
                    m["relations_by_predicate"][pred_name] += 1
                    m["relations_by_quality"][rel_quality] += 1

                if clause_relations:
                    if any(r["quality"] == "source_explicit" for r in clause_relations):
                        frame_quality = "source_explicit"
                    elif any(r["quality"] == "rule_derived" for r in clause_relations):
                        frame_quality = "rule_derived"
                    else:
                        frame_quality = "candidate"
                elif cl["clause_kind"] != "verbal":
                    frame_quality = (
                        "candidate"
                        if any(r["state"] in ("candidate", "unresolved") for r in roles_out)
                        else "source_explicit"
                    )
                elif not pred_word or not pred_cw or not pred_cw["lemma_id"]:
                    frame_quality = "candidate"
                else:
                    has_candidate_svo_role = any(
                        r["state"] in ("candidate", "unresolved")
                        for r in roles_out
                        if r["role"] in ("grammatical_subject", "grammatical_object")
                    )
                    frame_quality = "candidate" if has_candidate_svo_role else "source_explicit"

            uniq_warnings = list(dict.fromkeys(warnings))
            frame = {
                "frame_id": frame_id,
                "schema_version": "2.0",
                "source": {
                    "edition": edition,
                    "source_release": rel_key,
                    "source_file": rel_src,
                    "clause_node_id": clause_node_id,
                    "reference": effective_ref,
                    "canonical_verse_ids": tok_cvids,
                    "alignment_status": clause_align,
                },
                "predicate": pred_block,
                "roles": roles_out,
                "context": context,
                "extraction": {
                    "algorithm": "bibleontology_s0_s1_s2_r3_v1",
                    "rule_version": RULE_VERSION,
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
            "source_file": rel_src,
            "lf_sha256": file_info["sha256"],
            "lf_bytes": file_info["bytes"],
            "file_clause_count": len(all_clauses),
            "pilot_verses": [],
            "pilot_clause_count": len(all_clauses),
            "pilot_token_count": len(file_token_ids),
            "mapped_token_count": file_mapped_count,
            "missing_token_reasons": dict(sorted(file_missing_reasons.items())),
        })

    frames.sort(key=lambda f: f["frame_id"])
    relations.sort(key=lambda r: (r["frame_id"], r["predicate"], r["subject_token_id"], r["object_token_id"]))
    unmapped_tokens.sort(key=lambda x: (x["edition"], x["token_id"]))

    duration = time.perf_counter() - t_start
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    peak_mb = round(peak_bytes / (1024 * 1024), 2)

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
        "schema_version": "1.2",
        "pilot_scope_note": f"Complete-book extraction partition for {edition} {usfm}.",
        "languages": {
            lang: {
                "clauses_examined": m["clauses_examined"],
                "clauses_parsed": m["clauses_parsed"],
                "clauses_eligible_grammatical_subject_of": m["clauses_eligible_grammatical_subject_of"],
                "clauses_eligible_grammatical_object_of": m["clauses_eligible_grammatical_object_of"],
                "clauses_eligible_grammatical_indirect_object_of": m["clauses_eligible_grammatical_indirect_object_of"],
                "clauses_eligible_grammatical_second_object_of": m["clauses_eligible_grammatical_second_object_of"],
                "clauses_eligible_modifies": m["clauses_eligible_modifies"],
                "clauses_eligible_possessive_construction_with": m["clauses_eligible_possessive_construction_with"],
                "frames_emitted": m["frames_emitted"],
                "relations_emitted_total": m["relations_emitted_total"],
                "relations_by_predicate": dict(sorted(m["relations_by_predicate"].items())),
                "relations_by_quality": dict(sorted(m["relations_by_quality"].items())),
                "candidate_reasons": dict(sorted(m["candidate_reasons"].items())),
                "skip_reasons": dict(sorted(m["skip_reasons"].items())),
                "unsupported_constructions": dict(sorted(m["unsupported_constructions"].items())),
                "missing_mappings": m["missing_mappings"],
            }
        },
        "totals": {
            "frames_emitted": len(frames),
            "relations_emitted": len(relations),
        },
    }

    assert_no_restricted_fields(frames, "frames")
    assert_no_restricted_fields(relations, "relations")
    assert_no_restricted_fields(inventory_doc, "inventory")

    import os
    tmp_dir = out_dir / "partitions" / edition / f".tmp_{usfm}_{os.getpid()}"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    (tmp_dir / "frames.jsonl").write_text(
        "".join(json.dumps(f, ensure_ascii=False, sort_keys=True) + "\n" for f in frames),
        encoding="utf-8",
        newline="\n",
    )
    (tmp_dir / "occurrence-relations.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in relations),
        encoding="utf-8",
        newline="\n",
    )
    (tmp_dir / "coverage-report.json").write_text(
        json.dumps(coverage_doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (tmp_dir / "source-crosswalk-inventory.json").write_text(
        json.dumps(inventory_doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    manifest = {
        "schema_version": "2.0",
        "status": "COMPLETE",
        "edition": edition,
        "book": usfm,
        "book_num": book_num,
        "language": lang,
        "rule_version": RULE_VERSION,
        "source_files": file_hashes,
        "metrics": {
            "clauses_examined": m["clauses_examined"],
            "clauses_parsed": m["clauses_parsed"],
            "clauses_eligible_grammatical_subject_of": m["clauses_eligible_grammatical_subject_of"],
            "clauses_eligible_grammatical_object_of": m["clauses_eligible_grammatical_object_of"],
            "clauses_eligible_grammatical_indirect_object_of": m["clauses_eligible_grammatical_indirect_object_of"],
            "clauses_eligible_grammatical_second_object_of": m["clauses_eligible_grammatical_second_object_of"],
            "clauses_eligible_modifies": m["clauses_eligible_modifies"],
            "clauses_eligible_possessive_construction_with": m["clauses_eligible_possessive_construction_with"],
            "frames_emitted": len(frames),
            "relations_emitted_total": len(relations),
            "relations_by_predicate": dict(sorted(m["relations_by_predicate"].items())),
            "relations_by_quality": dict(sorted(m["relations_by_quality"].items())),
            "high_quality_count": sum(m["relations_by_quality"].get(q, 0) for q in ("source_explicit", "rule_derived")),
            "candidate_count": m["relations_by_quality"].get("candidate", 0),
        },
        "build": {
            "duration_seconds": round(duration, 3),
            "peak_memory_mb": peak_mb,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    }

    (tmp_dir / "partition-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    if part_dir.exists():
        import shutil
        shutil.rmtree(part_dir)
    tmp_dir.rename(part_dir)

    print(f"[{edition}/{usfm}] Complete: {len(frames)} frames, {len(relations)} relations, {manifest['metrics']['high_quality_count']} HQ in {duration:.2f}s (peak {peak_mb} MB)")
    return manifest


def run_books_extraction(
    books: list[str],
    out_dir: Path,
    edition_filter: str = "",
    force_rebuild: bool = False,
    no_aggregate: bool = False,
) -> dict[str, Any]:
    bundle = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    partition_dirs: list[Path] = []
    partition_manifests: list[dict[str, Any]] = []

    for book in books:
        usfm = book.upper()
        b_num = BOOK_NUM_BY_USFM.get(usfm)
        if not b_num:
            print(f"Warning: unknown USFM book {book}, skipping.")
            continue
        if 1 <= b_num <= 39:
            editions = ["macula-hebrew-wlc"]
        else:
            editions = ["macula-greek-nestle1904", "macula-greek-sblgnt"]

        if edition_filter:
            editions = [ed for ed in editions if ed == edition_filter]

        for ed in editions:
            m = extract_book_partition(
                edition=ed,
                book_usfm=usfm,
                out_dir=out_dir,
                bundle=bundle,
                force_rebuild=force_rebuild,
            )
            partition_manifests.append(m)
            pdir = out_dir / "partitions" / ed / usfm
            partition_dirs.append(pdir)

    agg_result = {}
    if not no_aggregate and partition_dirs:
        print(f"\nAggregating {len(partition_dirs)} partitions into {out_dir}...")
        agg_result = aggregate_partitions(partition_dirs, out_dir, rule_version=RULE_VERSION)
        print(f"Aggregation complete: {agg_result['totals']['relation_summaries_total']} lemma summaries.")

    return {
        "status": "ok",
        "partitions_processed": len(partition_manifests),
        "partition_manifests": partition_manifests,
        "aggregation": agg_result,
    }


def discover_all_partitions(out_dir: Path) -> list[Path]:
    partitions_dir = out_dir / "partitions"
    if not partitions_dir.exists():
        return []
    pdirs = []
    for ed_dir in sorted(partitions_dir.iterdir()):
        if not ed_dir.is_dir():
            continue
        for b_dir in sorted(ed_dir.iterdir()):
            if not b_dir.is_dir():
                continue
            manifest = b_dir / "partition-manifest.json"
            if manifest.exists():
                pdirs.append(b_dir)
    return pdirs


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Deterministic Offline Relationship Extractor")
    parser.add_argument("out_dir", nargs="?", default=str(DEFAULT_OUT_DIR), help="Output directory")
    parser.add_argument("--pilot", action="store_true", help="Run baseline pilot extraction")
    parser.add_argument("--book", type=str, default="", help="Comma-separated USFM books to extract (e.g. RUT,PHP)")
    parser.add_argument("--edition", type=str, default="", help="Filter specific edition (e.g. macula-hebrew-wlc)")
    parser.add_argument("--testament", type=str, default="", choices=["", "OT", "NT"], help="Filter testament (OT or NT)")
    parser.add_argument("--all", action="store_true", help="Extract all available books")
    parser.add_argument("--force-rebuild", action="store_true", help="Force rebuild partitions ignoring cache")
    parser.add_argument("--no-aggregate", action="store_true", help="Skip whole-graph aggregation step")
    parser.add_argument("--aggregate-all", action="store_true", help="Aggregate all existing partitions in out_dir")

    args = parser.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.aggregate_all:
        pdirs = discover_all_partitions(out_dir)
        print(f"\nAggregating all {len(pdirs)} partitions in {out_dir}...")
        agg_result = aggregate_partitions(pdirs, out_dir, rule_version=RULE_VERSION)
        print(f"Aggregation complete: {agg_result['totals']['relation_summaries_total']} lemma summaries.")
        print(json.dumps({"status": "ok", "out_dir": str(out_dir), "partitions_aggregated": len(pdirs), "aggregation": agg_result}, indent=2))
        return

    is_custom_run = bool(args.book or args.edition or args.testament or args.all)

    if not is_custom_run or args.pilot:
        report = run_pilot_extraction(out_dir)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    target_books: list[str] = []
    if args.book:
        for b in args.book.split(","):
            b = b.strip().upper()
            if b:
                target_books.append(b)
    elif args.testament == "OT":
        target_books = [b for b in USFM_BY_BOOK[1:40] if b]
    elif args.testament == "NT":
        target_books = [b for b in USFM_BY_BOOK[40:67] if b]
    elif args.all:
        target_books = [b for b in USFM_BY_BOOK[1:67] if b]

    report = run_books_extraction(
        books=target_books,
        out_dir=out_dir,
        edition_filter=args.edition,
        force_rebuild=args.force_rebuild,
        no_aggregate=args.no_aggregate,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
