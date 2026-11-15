# Copyright 2026 Doug Egge (https://bibleontology.org), Apache-2.0.
# Adapted for BibleResearch (R1/R2) from pinned bibleontology/bibleontology commit
# 62d6bc0fba5f84dfad245e546e87c6212b35fa75:
#   - tools/builder/source.py (S0)
#   - tools/builder/s1_clauses.py (S1)
#   - tools/builder/s2_s3.py (S2)
#   - tools/builder/s4_s5.py (S4 speech-turn scoping)
#
# Key BibleResearch adaptations:
# 1. License-gated S0 attributes (excludes sdbh, lexdomain, coredomain, domain, ln, frame, gloss/english).
# 2. Never converts an unverified first_child fallback in S1 head_index into a verified head:
#    unlisted multi-child non-clause phrase rules without @head="true" return
#    head_resolution="unlisted_rule_fallback:<rule>", is_verified_head=False.
# 3. Supports Hebrew VerbX wrapper (paragogic/cohortative <w class="x"> suffix).
# 4. Preserves per-clause nesting, coordination conjuncts, S2 negation (with Greek rough-breathing
#    guard), S2 modality/force (including interrogatives), and S4 speech-turn quotation flag.

from __future__ import annotations

import json
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

XID = "{http://www.w3.org/XML/1998/namespace}id"

# Strictly non-restricted grammatical/identity attributes only (no sdbh, lexdomain, coredomain, ln, gloss).
S0_FIELDS = (
    "class",
    "pos",
    "lemma",
    "strongnumberx",
    "strong",
    "type",
    "stem",
    "person",
    "gender",
    "number",
    "state",
    "role",
    "lang",
    "mood",
    "tense",
    "voice",
    "case",
    "degree",
    "normalized",
    "subjref",
    "referent",
    "after",
)

GREEK_CLASS = {"conj": "cj", "det": "art"}
GREEK_PERSON = {"αυτος": "third", "εγω": "first", "συ": "second"}
CLAUSE_ROLES = {"s", "v", "o", "io", "p", "vc", "adv", "o2", "cmpl", "pp"}
FUNCTION_CLASSES = ("cj", "rel", "prep", "ptcl", "art")
OPENER_CLASSES = ("cj", "rel", "prep", "ptcl")
NOT_A_VERB_FORM = {
    "common",
    "proper",
    "adjective",
    "relative",
    "demonstrative",
    "interjection",
    "gentilic",
    "personal",
    "cardinal",
    "ordinal",
}

FINITE_VERB_FORMS = {
    "qatal",
    "yiqtol",
    "wayyiqtol",
    "weqatal",
    "imperative",
    "jussive",
    "cohortative",
    "indicative",
    "subjunctive",
    "optative",
}


def norm(s: str | None) -> str:
    """BibleOntology S0/S2 lookup normalization: Hebrew consonants or accent-free lowercase Greek."""
    s = s or ""
    heb = "".join(ch for ch in s if "א" <= ch <= "ת")
    if heb:
        return heb
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c)
    ).lower()


def load_tables(bundle_path: Path | None = None) -> dict[str, Any]:
    path = bundle_path or (Path(__file__).resolve().parent / "heads_and_lexicon.json")
    return json.loads(path.read_text(encoding="utf-8"))


class HeadRules:
    def __init__(self, lang: str, bundle: dict[str, Any]):
        key = "hebrew" if lang in ("hebrew", "hbo", "arc") else "greek"
        heads = bundle[key]["heads"]
        compat = bundle.get("compatibility_extensions", {}).get(key, {})
        self.coord: set[str] = set(heads["coord"])
        self.first: dict[str, str | None] = dict(heads["head_first"])
        self.first.update(compat.get("head_first", {}))
        self.last: dict[str, str | None] = dict(heads["head_last"])
        self.last.update(compat.get("head_last", {}))
        self.prep: set[str] = set(heads["prep"])
        self.wrap: set[str] = set(heads["wrap"])


class LexiconRules:
    def __init__(self, lang: str, bundle: dict[str, Any]):
        key = "hebrew" if lang in ("hebrew", "hbo", "arc") else "greek"
        d = bundle[key]["lexicon"]
        self.lang = key
        self.force: dict[str, str] = d["force_by_verb_type"]
        self.subjunctive_main: str | None = d.get("subjunctive_main")
        self.q_types: set[str] = set(d["question_types"])
        self.q_lemmas: set[str] = {norm(x) for x in d["question_lemmas"]}
        self.q_punct: str | None = d.get("question_punctuation")
        self.neg_types: set[str] = set(d["negative_types"])
        self.neg_lemmas: set[str] = {norm(x) for x in d.get("negative_lemmas", [])}
        self.subordinators: set[str] = {norm(x) for x in d.get("subordinators", [])}
        self.speech: set[str] = {norm(x) for x in d["speech_verbs"]}
        self.narrative_moods: set[str] = set(d.get("narrative_moods", ["wayyiqtol"]))
        self.addressee_preps: set[str] = {norm(x) for x in d["addressee_preps"]}

    def is_negative(self, word_rec: dict[str, Any] | None) -> bool:
        if not word_rec:
            return False
        lemma = word_rec.get("lemma") or ""
        # Preserve upstream S2 M-D5 guard: rough-breathing οὗ ('where') != smooth οὐ ('not').
        if "\u0314" in unicodedata.normalize("NFD", lemma):
            return False
        if (word_rec.get("type") or "") in self.neg_types:
            return True
        if norm(lemma) in self.neg_lemmas:
            return True
        # Hebrew negative particles carry morph 'Tn' with class 'adv' / pos 'particle'
        if word_rec.get("morph") == "Tn":
            return True
        return False


def extract_s0_words(root: ET.Element, lang: str) -> dict[str, dict[str, Any]]:
    """Stage S0: Normalize MACULA <w> elements into a uniform, license-gated dictionary."""
    out: dict[str, dict[str, Any]] = {}
    pos_by_ref: dict[str, int] = {}
    is_greek = lang in ("greek", "grc")
    for w in root.iter("w"):
        raw_ref = w.get("ref") or ""
        vref = raw_ref.split("!")[0]
        if not vref:
            continue
        wid = w.get(XID)
        if not wid:
            continue
        pos = pos_by_ref.get(vref, 0)
        pos_by_ref[vref] = pos + 1
        rec: dict[str, Any] = {
            k: w.get(k) for k in S0_FIELDS if w.get(k) is not None
        }
        rec["id"] = wid
        rec["ref"] = raw_ref
        rec["verse_ref"] = vref
        rec["pos_in_verse"] = pos
        rec["text"] = w.text or ""
        rec["after"] = w.get("after") or ""
        rec["morph"] = w.get("morph") or ""
        if is_greek:
            rec["lang"] = "G"
            if rec.get("strong") and not rec.get("strongnumberx"):
                rec["strongnumberx"] = rec["strong"]
            rec["class"] = GREEK_CLASS.get(rec.get("class"), rec.get("class"))
            if rec.get("class") == "verb" and rec.get("mood"):
                rec["type"] = rec["mood"]
            if rec.get("class") == "pron" and not rec.get("person"):
                p = GREEK_PERSON.get(norm(rec.get("lemma")))
                if p:
                    rec["person"] = p
        else:
            rec.setdefault("lang", w.get("lang") or "H")
            if rec.get("class") == "verb":
                if not rec.get("type") and len(rec["morph"]) >= 3 and rec["morph"].startswith("V"):
                    hebrew_conj_map = {
                        "p": "qatal",
                        "q": "weqatal",
                        "i": "yiqtol",
                        "w": "wayyiqtol",
                        "v": "imperative",
                        "j": "jussive",
                        "h": "cohortative",
                        "r": "participle",
                        "s": "participle",
                        "c": "infinitive construct",
                        "a": "infinitive absolute",
                    }
                    inferred_type = hebrew_conj_map.get(rec["morph"][2])
                    if inferred_type:
                        rec["type"] = inferred_type
                if not rec.get("mood"):
                    rec["mood"] = rec.get("type")
        out[wid] = rec
    return out


def _get_rule(elem: ET.Element) -> str:
    return elem.get("rule") or elem.get("Rule") or ""


def _is_v2cl_word(elem: ET.Element) -> bool:
    return (
        elem.tag == "w"
        and elem.get("role") in ("v", "vc")
        and _get_rule(elem) in ("v2cl", "vc2cl")
    )


class S1ClauseExtractor:
    """Adapted S1 + S2 + S4 clause and phrase-head extractor with strict fallback guards."""

    def __init__(self, words: dict[str, dict[str, Any]], lang: str, bundle: dict[str, Any]):
        self.words = words
        self.lang = "hebrew" if lang in ("hebrew", "hbo", "arc") else "greek"
        self.heads = HeadRules(self.lang, bundle)
        self.lex = LexiconRules(self.lang, bundle)
        self._neg_only_positions = {
            (w.get("verse_ref"), w.get("pos_in_verse"))
            for w in words.values()
            if norm(w.get("lemma")) in ("μονον", "μονος")
        }

    def _rec(self, elem: ET.Element) -> dict[str, Any] | None:
        if elem.tag != "w":
            return None
        wid = elem.get(XID)
        return self.words.get(wid) if wid else None

    def _is_fn(self, elem: ET.Element, classes: tuple[str, ...] = FUNCTION_CLASSES) -> bool:
        rec = self._rec(elem)
        if not rec:
            return False
        return (rec.get("class") in classes) or (rec.get("type") == "interrogative")

    def is_complex(self, elem: ET.Element) -> bool:
        if elem.tag != "wg" or elem.get("class") not in (None, "cl"):
            return False
        kids = list(elem)
        rule = _get_rule(elem)
        complex_rules = ("ClCl", "ClCl2", "Conj-CL", "CLaCL", "aCLaCL")
        if any(ch.get("role") for ch in kids):
            # MACULA Greek <wg Rule="ClCl"> can wrap 2+ flattened clauses (wg.cl or w[rule=v2cl])
            # without any non-clausal role constituents (e.g., MAT 28:9!6-7).
            if rule not in complex_rules:
                return False
            clause_unit_count = 0
            for ch in kids:
                if _is_v2cl_word(ch):
                    clause_unit_count += 1
                elif ch.tag == "wg" and (ch.get("class") == "cl" or self.is_complex(ch)):
                    clause_unit_count += 1
                elif ch.tag == "w" and self._is_fn(ch, OPENER_CLASSES + ("adv",)):
                    continue
                elif ch.tag == "wg" and ch.get("class") == "cjp":
                    continue
                else:
                    return False
            return clause_unit_count >= 2
        has_clause = False
        for ch in kids:
            if ch.tag == "w":
                if _is_v2cl_word(ch):
                    has_clause = True
                elif not self._is_fn(ch, OPENER_CLASSES + ("adv",)):
                    return False
            elif ch.get("class") == "cl" or self.is_complex(ch):
                has_clause = True
            elif ch.get("class") != "cjp":
                return False
        return has_clause

    def _is_not_only(self, word_rec: dict[str, Any]) -> bool:
        vref = word_rec.get("verse_ref")
        pos = word_rec.get("pos_in_verse")
        if vref is None or pos is None:
            return False
        return any((vref, pos + k) in self._neg_only_positions for k in range(1, 5))

    def _unwrap_conjunct(self, elem: ET.Element) -> ET.Element:
        if elem.tag != "wg" or elem.get("type") != "group" or _get_rule(elem):
            return elem
        rest = [
            x
            for x in elem
            if not (
                x.tag == "w"
                and (
                    self._is_fn(x, ("cj",))
                    or (self._rec(x) or {}).get("lemma") in ("καί", "ἤ")
                )
            )
        ]
        if len(rest) == 1 and len(rest) < len(elem):
            return rest[0]
        return elem

    def resolve_heads(self, elem: ET.Element) -> list[dict[str, Any]]:
        """
        Resolve head token(s) of a phrase constituent without trusting an unlisted first_child fallback.
        Returns a list of dicts:
          {
            "word": <S0 word dict or None>,
            "resolution_kind": "direct_role_word" | "explicit_head_attr" | "curated_head_rule" |
                               "unlisted_rule_fallback" | "clausal_constituent" | "unresolved",
            "is_verified_head": bool,
            "applied_rules": list[str],
            "unlisted_rules": list[str],
            "is_clausal": bool,
            "is_coordinated": bool,
            "token_span": list[str],
            "prep_lemmas": list[str],
            "prep_token_ids": list[str],
            "diagnostics": list[str],
          }
        """
        span = [w.get(XID) for w in elem.iter("w") if w.get(XID)]
        return self._resolve_node(
            elem,
            top_span=span,
            applied=[],
            unlisted=[],
            diagnostics=[],
            is_coord=False,
            prep_lemmas=[],
            prep_token_ids=[],
        )

    def _resolve_node(
        self,
        elem: ET.Element,
        top_span: list[str],
        applied: list[str],
        unlisted: list[str],
        diagnostics: list[str],
        is_coord: bool,
        prep_lemmas: list[str] | None = None,
        prep_token_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        p_lemmas = list(prep_lemmas or [])
        p_tids = list(prep_token_ids or [])
        if elem.tag == "w":
            rec = self._rec(elem)
            if not rec:
                return []
            if unlisted:
                kind = "unlisted_rule_fallback"
            elif not applied:
                kind = "direct_role_word"
            elif any(r.endswith("@head=true") for r in applied):
                kind = "explicit_head_attr" if not [r for r in applied if not r.endswith("@head=true")] else "curated_head_rule"
            else:
                kind = "curated_head_rule"
            return [
                {
                    "word": rec,
                    "resolution_kind": kind,
                    "is_verified_head": len(unlisted) == 0,
                    "applied_rules": list(applied),
                    "unlisted_rules": list(unlisted),
                    "is_clausal": False,
                    "is_coordinated": is_coord,
                    "token_span": top_span,
                    "prep_lemmas": p_lemmas,
                    "prep_token_ids": p_tids,
                    "diagnostics": list(diagnostics),
                }
            ]

        if elem.get("class") == "cl" or self.is_complex(elem):
            return [
                {
                    "word": None,
                    "resolution_kind": "clausal_constituent",
                    "is_verified_head": True,
                    "applied_rules": list(applied),
                    "unlisted_rules": list(unlisted),
                    "is_clausal": True,
                    "is_coordinated": is_coord,
                    "token_span": [w.get(XID) for w in elem.iter("w") if w.get(XID)],
                    "prep_lemmas": p_lemmas,
                    "prep_token_ids": p_tids,
                    "diagnostics": ["clausal_argument_not_nominal_participant"],
                }
            ]

        kids = list(elem)
        rule = _get_rule(elem)
        if not kids:
            return [
                {
                    "word": None,
                    "resolution_kind": "unresolved",
                    "is_verified_head": False,
                    "applied_rules": list(applied),
                    "unlisted_rules": list(unlisted),
                    "is_clausal": False,
                    "is_coordinated": is_coord,
                    "token_span": top_span,
                    "prep_lemmas": p_lemmas,
                    "prep_token_ids": p_tids,
                    "diagnostics": ["empty_phrase_group"],
                }
            ]

        if len(kids) == 1:
            next_applied = applied + ([rule] if rule else [])
            return self._resolve_node(
                kids[0], top_span, next_applied, unlisted, diagnostics, is_coord, p_lemmas, p_tids
            )

        if rule in self.heads.coord:
            next_applied = applied + [f"coord:{rule}"]
            results: list[dict[str, Any]] = []
            for raw_k in kids:
                k = self._unwrap_conjunct(raw_k)
                if k.tag == "w" and self._is_fn(k, ("cj",)):
                    continue
                results.extend(
                    self._resolve_node(
                        k, top_span, next_applied, unlisted, diagnostics, True, p_lemmas, p_tids
                    )
                )
            return results

        if rule in self.heads.prep:
            marked = [k for k in kids if k.get("head") == "true"]
            obj = marked[0] if marked else kids[-1]
            next_prep_lemmas = list(p_lemmas)
            next_prep_tids = list(p_tids)
            for k in kids:
                if k is obj or k.tag != "w":
                    continue
                kr = self._rec(k)
                if kr and (kr.get("class") == "prep" or kr.get("pos") == "preposition"):
                    pl = norm(kr.get("lemma"))
                    if pl and pl not in next_prep_lemmas:
                        next_prep_lemmas.append(pl)
                    if kr.get("id") and kr["id"] not in next_prep_tids:
                        next_prep_tids.append(kr["id"])
            next_applied = applied + [f"prep:{rule}"]
            return self._resolve_node(
                obj, top_span, next_applied, unlisted, diagnostics, is_coord, next_prep_lemmas, next_prep_tids
            )

        marked_idx = [i for i, k in enumerate(kids) if k.get("head") == "true"]
        next_applied = list(applied)
        next_unlisted = list(unlisted)
        next_diag = list(diagnostics)

        # In BibleOntology, an explicit @head="true" mark OR a curated head rule is required
        # for verified resolution. Unlisted multi-child rules without @head="true" must NOT be
        # silently promoted as verified heads via first_child fallback.
        if marked_idx:
            head_i = marked_idx[0]
            if rule and (
                rule in self.heads.first
                or rule in self.heads.last
                or rule in self.heads.wrap
            ):
                next_applied.append(rule)
            elif rule:
                next_applied.append(f"{rule}@head=true")
            else:
                next_applied.append("@head=true")
        elif rule in self.heads.last:
            head_i = len(kids) - 1
            next_applied.append(rule)
        elif rule in self.heads.first:
            head_i = 0
            next_applied.append(rule)
        elif rule in self.heads.wrap:
            # Multi-child wrap should not occur unless function words wrap one content child; verify!
            non_fn = [i for i, k in enumerate(kids) if not (k.tag == "w" and self._is_fn(k))]
            if len(non_fn) == 1:
                head_i = non_fn[0]
                next_applied.append(rule)
            else:
                head_i = 0
                next_unlisted.append(rule or "<unmarked_wrap>")
                next_diag.append(f"unlisted_rule_fallback:{rule or '<unmarked>'}")
        else:
            head_i = 0
            rule_tag = rule or "<missing_rule>"
            next_unlisted.append(rule_tag)
            next_diag.append(f"unlisted_rule_fallback:{rule_tag}")

        # Upstream S1 guard: An article NEVER heads a phrase (e.g., DetCL ὁ πιστεύων).
        if kids[head_i].tag == "w" and (self._rec(kids[head_i]) or {}).get("class") == "art":
            non_art = next(
                (
                    i
                    for i, k in enumerate(kids)
                    if i > head_i and not (k.tag == "w" and self._is_fn(k))
                ),
                head_i,
            )
            head_i = non_art

        res = self._resolve_node(
            kids[head_i], top_span, next_applied, next_unlisted, next_diag, is_coord, p_lemmas, p_tids
        )
        # Upstream S1 guard: "πᾶς ὁ πιστεύων" (All-NP wrapping DetCL): word head if present
        if res and res[0]["is_clausal"] and len(next_unlisted) == 0:
            word_i = next(
                (
                    i
                    for i, k in enumerate(kids)
                    if i != head_i
                    and k.tag == "w"
                    and (
                        not self._is_fn(k)
                        or (self._rec(k) or {}).get("type") == "interrogative"
                    )
                ),
                None,
            )
            if word_i is not None:
                return self._resolve_node(
                    kids[word_i], top_span, next_applied, next_unlisted, next_diag, is_coord, p_lemmas, p_tids
                )
        return res

    def extract_clause_phrase_relations(
        self,
        cl_elem: ET.Element,
        excluded_ids: set[int] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Extract phrase-internal attribute ('modifies') and genitive/construct ('possessive_construction_with')
        relations strictly within cl_elem's direct phrase tree without crossing nested clause boundaries."""
        skip = excluded_ids or set()
        relations: list[dict[str, Any]] = []
        diagnostics: list[dict[str, Any]] = []
        seen_pairs: set[tuple[str, str, str]] = set()
        clausal_rules = {"CL2Adjp", "CL2NP", "DetCL", "V-ADV", "relCL", "PrepCL", "CL-NP"}

        def visit_phrase(node: ET.Element, is_clause_root: bool = False) -> None:
            if not is_clause_root:
                rule = _get_rule(node)
                rel: str | None = None
                head_i: int | None = None
                kids = list(node)
                if len(kids) >= 2 and rule:
                    if rule in self.heads.first:
                        rel = self.heads.first[rule]
                        head_i = 0
                    elif rule in self.heads.last:
                        rel = self.heads.last[rule]
                        head_i = len(kids) - 1
                    marked = [i for i, k in enumerate(kids) if k.get("head") == "true"]
                    if marked and rel in ("attribute", "of"):
                        head_i = marked[0]

                if rel in ("attribute", "of") and head_i is not None:
                    rel_kind = "modifies" if rel == "attribute" else "possessive_construction_with"
                    span = [w.get(XID) for w in node.iter("w") if w.get(XID)]
                    head_elem = kids[head_i]
                    target_heads = self.resolve_heads(head_elem)
                    for idx, dep_elem in enumerate(kids):
                        if idx == head_i or id(dep_elem) in skip:
                            continue
                        if dep_elem.tag == "w" and self._is_fn(dep_elem, ("art", "om", "cj", "prep", "rel", "ptcl")):
                            continue
                        dep_rule = _get_rule(dep_elem) if dep_elem.tag == "wg" else ""
                        if (
                            dep_elem.tag == "wg"
                            and (
                                dep_elem.get("class") == "cl"
                                or self.is_complex(dep_elem)
                                or dep_rule in clausal_rules
                            )
                        ):
                            diagnostics.append({
                                "relation_kind": rel_kind,
                                "phrase_rule": rule,
                                "skip_reason": "clausal_constituent",
                                "phrase_token_span": span,
                            })
                            continue

                        dep_heads = self.resolve_heads(dep_elem)
                        valid_targets = [h for h in target_heads if h.get("word") and not h.get("is_clausal")]
                        if not valid_targets or any(h.get("is_clausal") for h in target_heads):
                            reason = "clausal_constituent" if any(h.get("is_clausal") for h in target_heads) else "unresolved_phrase_head"
                            diagnostics.append({
                                "relation_kind": rel_kind,
                                "phrase_rule": rule,
                                "skip_reason": reason,
                                "phrase_token_span": span,
                            })
                            continue

                        if not dep_heads or any(h.get("is_clausal") for h in dep_heads):
                            reason = "clausal_constituent" if any(h.get("is_clausal") for h in dep_heads) else "unresolved_phrase_head"
                            diagnostics.append({
                                "relation_kind": rel_kind,
                                "phrase_rule": rule,
                                "skip_reason": reason,
                                "phrase_token_span": span,
                            })
                            continue

                        for dh in dep_heads:
                            dw = dh.get("word")
                            if not dw or dh.get("is_clausal"):
                                diagnostics.append({
                                    "relation_kind": rel_kind,
                                    "phrase_rule": rule,
                                    "skip_reason": "unresolved_phrase_head",
                                    "phrase_token_span": span,
                                })
                                continue
                            for th in valid_targets:
                                tw = th["word"]
                                if dw["id"] == tw["id"]:
                                    continue
                                pair_key = (rel_kind, dw["id"], tw["id"])
                                if pair_key in seen_pairs:
                                    continue
                                seen_pairs.add(pair_key)
                                relations.append({
                                    "relation_kind": rel_kind,
                                    "phrase_rule": rule,
                                    "phrase_token_span": span,
                                    "dep_head": dh,
                                    "target_head": th,
                                    "is_coordinated": bool(dh.get("is_coordinated") or th.get("is_coordinated")),
                                })

            for ch in node:
                if ch.tag != "wg" or id(ch) in skip:
                    continue
                if ch.get("class") == "cl" or self.is_complex(ch):
                    continue
                visit_phrase(ch, is_clause_root=False)

        visit_phrase(cl_elem, is_clause_root=True)
        return relations, diagnostics

    def _compute_sentence_clauses(
        self,
        root: ET.Element,
        edition: str = "",
        source_path: str = "",
    ) -> list[dict[str, Any]]:
        """Walk all sentences and return clause descriptors in document order."""
        clauses_out: list[dict[str, Any]] = []
        clause_counters: dict[str, int] = {}

        # Precompute deterministic syntax_nodes.node_key paths matching scripts/export-static-corpus.py:
        # macula_tree:{edition}:{source_path}#s{s_idx}.{child_ord}...
        node_key_map: dict[int, str] = {}
        sentences = [ch for ch in root if ch.tag == "sentence"]
        if not sentences:
            sentences = root.findall(".//sentence")

        def _index_element(el: ET.Element, prefix: str) -> None:
            ord_idx = 0
            for ch in el:
                if ch.tag not in ("wg", "w", "c"):
                    continue
                ord_idx += 1
                k = f"{prefix}.{ord_idx}"
                node_key_map[id(ch)] = k
                _index_element(ch, k)

        for s_idx, sent_el in enumerate(sentences, start=1):
            base = f"macula_tree:{edition}:{source_path}#s{s_idx}"
            node_key_map[id(sent_el)] = base
            _index_element(sent_el, base)

        seen_speech_in_file = False

        def collect_direct_words(
            cl_elem: ET.Element,
            excluded_ids: set[int] | None = None,
        ) -> list[dict[str, Any]]:
            """Words belonging to this clause outside any nested <wg class='cl'>, complex, or excluded v2cl."""
            direct: list[dict[str, Any]] = []
            skip = excluded_ids or set()

            def walk(node: ET.Element) -> None:
                for ch in node:
                    if id(ch) in skip:
                        continue
                    if ch.tag == "w":
                        rec = self._rec(ch)
                        if rec:
                            direct.append(rec)
                    elif ch.tag == "wg":
                        if ch.get("class") == "cl" or self.is_complex(ch):
                            continue
                        walk(ch)

            walk(cl_elem)
            return direct

        def build_v2cl_record(
            w_elem: ET.Element,
            parent_cid: str | None,
            pending_openers: list[dict[str, Any]],
            wrapping_neg: bool,
            role_in_parent: str | None,
            sent_clauses: list[dict[str, Any]],
        ) -> None:
            rec = self._rec(w_elem)
            if not rec:
                return
            vref = rec["verse_ref"]
            k = clause_counters.get(vref, 0)
            clause_counters[vref] = k + 1
            cid = f"{vref}#cl{k}"
            raw_role = w_elem.get("role") or "v"
            v_head = {
                "word": rec,
                "resolution_kind": "direct_role_word",
                "is_verified_head": True,
                "applied_rules": [],
                "unlisted_rules": [],
                "is_clausal": False,
                "is_coordinated": False,
                "token_span": [rec["id"]],
                "diagnostics": [],
            }
            resolved_roles = {raw_role: [v_head]}
            neg_signals: list[str] = []
            if wrapping_neg:
                neg_signals.append("wrapping_complex_negator")
            if self.lex.is_negative(rec) and not self._is_not_only(rec):
                neg_signals.append(f"{rec['id']}:{rec.get('lemma')}")
            negated = len(neg_signals) > 0

            vt = rec.get("type")
            if vt in NOT_A_VERB_FORM:
                vt = None
            force = self.lex.force.get(vt or "", self.lex.force["_default"])
            if (
                vt == "subjunctive"
                and self.lex.subjunctive_main
                and parent_cid is None
                and not ({norm(o.get("lemma")) for o in pending_openers} & self.lex.subordinators)
            ):
                force = self.lex.subjunctive_main

            q_signals: list[str] = []
            for o in pending_openers:
                if o.get("type") in self.lex.q_types or norm(o.get("lemma")) in self.lex.q_lemmas:
                    q_signals.append(f"opener:{o['id']}:{o.get('lemma')}")
            if rec.get("type") in self.lex.q_types or norm(rec.get("lemma")) in self.lex.q_lemmas:
                q_signals.append(f"word:{rec['id']}:{rec.get('lemma')}")
            if self.lex.q_punct and self.lex.q_punct in (rec.get("after") or ""):
                q_signals.append("punct:;")

            if vt and vt.startswith("participle"):
                modality = "participle"
            elif vt and vt.startswith("infinitive"):
                modality = "infinitive"
            elif force != "directive" and q_signals:
                modality = "interrogative"
            elif vt in ("imperative", "jussive", "cohortative", "subjunctive", "optative"):
                modality = vt
            elif force == "directive":
                modality = "imperative"
            else:
                modality = "indicative"

            raw_voice = rec.get("voice")
            voice = raw_voice if raw_voice in ("active", "passive", "middle", "middlepassive") else "unknown"
            conj_lemmas = [o.get("lemma") for o in pending_openers if o.get("class") == "cj" and o.get("lemma")]
            cl_rec = {
                "source_clause_id": cid,
                "syntax_node_key": node_key_map.get(id(w_elem), ""),
                "verse_ref": vref,
                "all_verse_refs": [vref],
                "clause_index_in_verse": k,
                "clause_rule": _get_rule(w_elem),
                "role_in_parent": role_in_parent or "v2cl",
                "parent_clause_id": parent_cid,
                "clause_kind": "verbal" if raw_role == "v" else "copular",
                "direct_role_keys": [raw_role],
                "resolved_roles": resolved_roles,
                "predicate_heads": [v_head] if raw_role == "v" else [],
                "copular_heads": [v_head] if raw_role == "vc" else [],
                "predicate_word": rec,
                "predicate_ambiguous": False,
                "verb_form": vt,
                "verb_stem": rec.get("stem"),
                "voice": voice,
                "modality": modality,
                "negated": negated,
                "negation_signals": neg_signals,
                "question_signals": q_signals,
                "coord_conjunction": " ".join(conj_lemmas) if conj_lemmas else None,
                "opener_lemmas": [o.get("lemma") for o in pending_openers if o.get("lemma")],
                "token_ids": [rec["id"]],
                "direct_token_ids": [rec["id"]],
                "speech_quoted": False,
                "speech_parent_clause_id": None,
                "quotation_status": "unknown",
                "speaker_scope": "unknown",
                "relativized": role_in_parent == "rel" or any(o.get("class") == "rel" for o in pending_openers),
                "phrase_relations": [],
                "phrase_diagnostics": [],
            }
            sent_clauses.append(cl_rec)

        def walk_sentence(sent: ET.Element, sent_idx: int) -> None:
            nonlocal seen_speech_in_file
            sent_clauses: list[dict[str, Any]] = []

            CONTRAST_LEMMAS = ("αλλα", "πλην", "ברם", "להן")

            def walk_container(
                container: ET.Element,
                parent_cid: str | None,
                pending_openers: list[dict[str, Any]],
                wrapping_neg: bool,
                wrapping_question: bool,
                role_in_parent: str | None,
                keep_inherited_openers: bool,
                prefer_node_role: bool,
            ) -> None:
                inherited = list(pending_openers)
                local_openers = list(inherited)
                local_neg = wrapping_neg
                for ch in container:
                    if _is_v2cl_word(ch):
                        child_role = ch.get("role") or role_in_parent or "v2cl"
                        build_v2cl_record(
                            ch,
                            parent_cid,
                            local_openers,
                            local_neg,
                            child_role,
                            sent_clauses,
                        )
                        local_openers = list(inherited) if keep_inherited_openers else []
                        local_neg = wrapping_neg
                    elif ch.tag == "w":
                        r = self._rec(ch)
                        if r and self.lex.is_negative(r) and not self._is_not_only(r):
                            local_neg = True
                        elif r and norm(r.get("lemma")) in CONTRAST_LEMMAS:
                            # Contrast branch ('not X BUT Y') cancels leading container negation.
                            local_neg = False
                        if r and self._is_fn(ch, OPENER_CLASSES + ("adv",)):
                            local_openers.append(r)
                    elif ch.tag == "wg" and ch.get("class") == "cjp":
                        for w in ch.iter("w"):
                            r = self._rec(w)
                            if r:
                                if norm(r.get("lemma")) in CONTRAST_LEMMAS:
                                    local_neg = False
                                local_openers.append(r)
                    elif ch.tag == "wg":
                        child_role = (
                            (container.get("role") or role_in_parent)
                            if prefer_node_role
                            else (ch.get("role") or role_in_parent)
                        )
                        visit_wg(
                            ch,
                            parent_cid,
                            local_openers,
                            local_neg,
                            wrapping_question,
                            child_role,
                        )
                        local_openers = list(inherited) if keep_inherited_openers else []
                        local_neg = wrapping_neg

            def visit_wg(
                node: ET.Element,
                parent_cid: str | None,
                pending_openers: list[dict[str, Any]],
                wrapping_neg: bool,
                wrapping_question: bool,
                role_in_parent: str | None,
            ) -> None:
                if node.tag != "wg":
                    return
                if self.is_complex(node):
                    walk_container(
                        node,
                        parent_cid,
                        pending_openers,
                        wrapping_neg,
                        wrapping_question,
                        role_in_parent,
                        keep_inherited_openers=True,
                        prefer_node_role=True,
                    )
                    return

                if node.get("class") == "cl":
                    ws = [self._rec(w) for w in node.iter("w") if self._rec(w)]
                    if not ws:
                        return
                    first_vref = ws[0]["verse_ref"]
                    k = clause_counters.get(first_vref, 0)
                    clause_counters[first_vref] = k + 1
                    cid = f"{first_vref}#cl{k}"

                    # Separate subordinate 1-word verbal clauses (<w role="v" rule="v2cl">)
                    # when a clause also has a primary governing predicate (e.g. MAT 28:18, 28:19, JHN 6:67).
                    direct_v_or_vc = [ch for ch in node if ch.get("role") in ("v", "vc")]
                    sub_v2cl_kids = [ch for ch in direct_v_or_vc if _is_v2cl_word(ch)]
                    primary_v_kids = [ch for ch in direct_v_or_vc if not _is_v2cl_word(ch)]
                    detached_v2cl = sub_v2cl_kids if (primary_v_kids and sub_v2cl_kids) else []
                    excluded_ids = {id(ch) for ch in detached_v2cl}

                    direct_words = collect_direct_words(node, excluded_ids)
                    # Determine roles on direct children
                    role_children: list[tuple[str, ET.Element]] = []
                    child_openers = list(pending_openers)
                    for ch in node:
                        if id(ch) in excluded_ids:
                            continue
                        r_attr = ch.get("role")
                        if ch.tag == "w" and not r_attr and self._is_fn(ch, OPENER_CLASSES):
                            rec = self._rec(ch)
                            if rec:
                                child_openers.append(rec)
                            continue
                        if ch.tag == "wg" and ch.get("class") == "cjp" and not r_attr:
                            for w in ch.iter("w"):
                                rec = self._rec(w)
                                if rec:
                                    child_openers.append(rec)
                            continue
                        if r_attr:
                            role_children.append((r_attr, ch))

                    resolved_roles: dict[str, list[dict[str, Any]]] = {}
                    for r_attr, ch in role_children:
                        heads = self.resolve_heads(ch)
                        resolved_roles.setdefault(r_attr, []).extend(heads)

                    # Negation detection (S2)
                    neg_signals: list[str] = []
                    if wrapping_neg:
                        neg_signals.append("wrapping_complex_negator")
                    for w in direct_words:
                        if self.lex.is_negative(w) and not self._is_not_only(w):
                            neg_signals.append(f"{w['id']}:{w.get('lemma')}")
                    negated = len(neg_signals) > 0

                    # Primary predicate & voice & modality (S2)
                    v_heads = [h for h in resolved_roles.get("v", []) if h["word"] is not None]
                    vc_heads = [h for h in resolved_roles.get("vc", []) if h["word"] is not None]
                    p_heads = resolved_roles.get("p", [])
                    predicate_ambiguous = False
                    pred_word: dict[str, Any] | None = None
                    if len(v_heads) == 1:
                        pred_word = v_heads[0]["word"]
                    elif len(v_heads) > 1:
                        finite_v = [h for h in v_heads if (h["word"].get("type") or "") in FINITE_VERB_FORMS]
                        if len(finite_v) == 1:
                            pred_word = finite_v[0]["word"]
                            v_heads = finite_v
                        else:
                            pred_word = (finite_v[0] if finite_v else v_heads[0])["word"]
                            predicate_ambiguous = True
                    elif vc_heads:
                        pred_word = vc_heads[0]["word"]

                    if v_heads:
                        clause_kind = "verbal"
                    elif vc_heads:
                        clause_kind = "copular"
                    elif p_heads:
                        clause_kind = "verbless"
                    else:
                        clause_kind = "other_role_clause"

                    vt = (pred_word or {}).get("type")
                    if vt in NOT_A_VERB_FORM:
                        vt = None
                    force = self.lex.force.get(vt or "", self.lex.force["_default"])
                    if (
                        vt == "subjunctive"
                        and self.lex.subjunctive_main
                        and parent_cid is None
                        and not ({norm(o.get("lemma")) for o in child_openers} & self.lex.subordinators)
                    ):
                        force = self.lex.subjunctive_main

                    q_signals: list[str] = []
                    for o in child_openers:
                        if o.get("type") in self.lex.q_types or norm(o.get("lemma")) in self.lex.q_lemmas:
                            q_signals.append(f"opener:{o['id']}:{o.get('lemma')}")
                    for w in direct_words:
                        if w.get("type") in self.lex.q_types or norm(w.get("lemma")) in self.lex.q_lemmas:
                            q_signals.append(f"word:{w['id']}:{w.get('lemma')}")
                    if self.lex.q_punct and any(self.lex.q_punct in (w.get("after") or "") for w in direct_words):
                        q_signals.append("punct:;")

                    # Map raw S2 force/verb form to clear normalized modality category
                    if vt and vt.startswith("participle"):
                        modality = "participle"
                    elif vt and vt.startswith("infinitive"):
                        modality = "infinitive"
                    elif force != "directive" and q_signals:
                        modality = "interrogative"
                    elif vt in ("imperative", "jussive", "cohortative", "subjunctive", "optative"):
                        modality = vt
                    elif force == "directive":
                        modality = "imperative"
                    elif pred_word is None:
                        modality = "unknown"
                    else:
                        modality = "indicative"

                    raw_voice = (pred_word or {}).get("voice")
                    if raw_voice in ("active", "passive", "middle", "middlepassive"):
                        voice = raw_voice
                    elif pred_word and self.lang == "hebrew":
                        # Preserve stem (Qal, Piel, Hiphil, Niphal, Hithpael) without fabricating Greek voice
                        voice = "unknown"
                    else:
                        voice = "unknown"

                    conj_lemmas = [o.get("lemma") for o in child_openers if o.get("class") == "cj" and o.get("lemma")]
                    phrase_relations, phrase_diagnostics = self.extract_clause_phrase_relations(
                        node, excluded_ids
                    )

                    cl_rec = {
                        "source_clause_id": cid,
                        "syntax_node_key": node_key_map.get(id(node), ""),
                        "verse_ref": first_vref,
                        "all_verse_refs": sorted({w["verse_ref"] for w in ws}),
                        "clause_index_in_verse": k,
                        "clause_rule": _get_rule(node),
                        "role_in_parent": role_in_parent,
                        "parent_clause_id": parent_cid,
                        "clause_kind": clause_kind,
                        "direct_role_keys": sorted(resolved_roles.keys()),
                        "resolved_roles": resolved_roles,
                        "predicate_heads": v_heads,
                        "copular_heads": vc_heads,
                        "predicate_word": pred_word,
                        "predicate_ambiguous": predicate_ambiguous,
                        "verb_form": vt,
                        "verb_stem": (pred_word or {}).get("stem"),
                        "voice": voice,
                        "modality": modality,
                        "negated": negated,
                        "negation_signals": neg_signals,
                        "question_signals": q_signals,
                        "coord_conjunction": " ".join(conj_lemmas) if conj_lemmas else None,
                        "opener_lemmas": [o.get("lemma") for o in child_openers if o.get("lemma")],
                        "token_ids": [w["id"] for w in ws],
                        "direct_token_ids": [w["id"] for w in direct_words],
                        "speech_quoted": False,
                        "speech_parent_clause_id": None,
                        "quotation_status": "unknown",
                        "speaker_scope": "unknown",
                        "relativized": role_in_parent == "rel" or any(o.get("class") == "rel" for o in child_openers),
                        "phrase_relations": phrase_relations,
                        "phrase_diagnostics": phrase_diagnostics,
                    }
                    sent_clauses.append(cl_rec)

                    # Emit detached subordinate 1-word v2cl clauses nested under cid
                    for w_ch in detached_v2cl:
                        build_v2cl_record(w_ch, cid, [], False, "v2cl", sent_clauses)

                    # Recurse into child elements that contain nested clauses
                    for ch in node:
                        if ch.tag != "wg":
                            continue
                        ch_role = ch.get("role")
                        if ch.get("class") == "cl" or self.is_complex(ch):
                            visit_wg(ch, cid, [], False, False, ch_role)
                        else:
                            # Walk phrase subtree for any nested <wg class='cl'> (e.g., DetCL, CL2Adjp, PrepCL)
                            def walk_nested_in_phrase(pnode: ET.Element, p_role: str | None) -> None:
                                for pk in pnode:
                                    if pk.tag != "wg":
                                        continue
                                    if pk.get("class") == "cl" or self.is_complex(pk):
                                        visit_wg(pk, cid, [], False, False, p_role)
                                    else:
                                        walk_nested_in_phrase(pk, p_role)
                            walk_nested_in_phrase(ch, ch_role)
                    return

                # Non-cl container at top of sentence or inside complex
                walk_container(
                    node,
                    parent_cid,
                    pending_openers,
                    wrapping_neg,
                    wrapping_question,
                    role_in_parent,
                    keep_inherited_openers=False,
                    prefer_node_role=False,
                )

            for top_wg in sent:
                if top_wg.tag == "wg":
                    visit_wg(top_wg, None, [], False, False, top_wg.get("role"))

            # Stage S4 speech-turn marking within the same <sentence>:
            # 1) Top-level speech verb followed by sibling clauses in the same sentence
            #    until another narrative speech verb or narrative 3rd-person wayyiqtol (Heb).
            # 2) Greek/Hebrew nested clause filling role='o' (not typed as purpose/reason/condition)
            #    of a speech-verb clause, plus all descendants of a quoted clause.
            by_cid = {c["source_clause_id"]: c for c in sent_clauses}
            top_level = [c for c in sent_clauses if c["parent_clause_id"] is None]
            speech_lemmas = self.lex.speech

            for idx, c in enumerate(top_level):
                pw = c["predicate_word"]
                if not pw or norm(pw.get("lemma")) not in speech_lemmas:
                    continue
                for follow in top_level[idx + 1:]:
                    fpw = follow["predicate_word"]
                    f_lemma = norm((fpw or {}).get("lemma"))
                    f_person = (fpw or {}).get("person")
                    f_mood = follow["verb_form"]
                    if f_lemma in speech_lemmas and f_person not in ("first", "second"):
                        break
                    if f_mood in self.lex.narrative_moods and f_person == "third":
                        break
                    follow["speech_quoted"] = True
                    follow["speech_parent_clause_id"] = c["source_clause_id"]

            for c in sent_clauses:
                pid = c["parent_clause_id"]
                if not pid or pid not in by_cid:
                    continue
                parent = by_cid[pid]
                ppw = parent["predicate_word"]
                if ppw and norm(ppw.get("lemma")) in speech_lemmas and c["role_in_parent"] == "o":
                    c["speech_quoted"] = True
                    c["speech_parent_clause_id"] = pid
                elif parent["speech_quoted"]:
                    c["speech_quoted"] = True
                    c["speech_parent_clause_id"] = parent["speech_parent_clause_id"]

            # Assign quotation_status & speaker_scope conservatively:
            # Never claim "none" unless narrative absence of quotation is structurally verified
            # (speech-framing clause, Hebrew 3rd-person wayyiqtol narrative chain & its 3rd-person
            # nested clauses, or chapter-initial 3rd-person Hebrew prose before any speech turn).
            sent_words = [self.words[tid] for c in sent_clauses for tid in c["direct_token_ids"] if tid in self.words]
            sent_has_1st_2nd = any((w.get("person") or "") in ("first", "second") for w in sent_words)
            sent_has_speech_verb = any(
                norm((c["predicate_word"] or {}).get("lemma")) in speech_lemmas
                for c in sent_clauses
            )

            for c in sent_clauses:
                if c["speech_quoted"]:
                    c["quotation_status"] = (
                        "nested_speech_object" if c.get("role_in_parent") == "o" else "direct_speech_turn"
                    )
                    c["speaker_scope"] = "quoted_speaker"
                    continue

                pw = c["predicate_word"]
                pw_person = (pw or {}).get("person")
                pw_is_speech = pw is not None and norm(pw.get("lemma")) in speech_lemmas and pw_person not in ("first", "second")
                is_top = c["parent_clause_id"] is None
                is_heb_wayyiqtol_3 = self.lang == "hebrew" and c["verb_form"] == "wayyiqtol" and pw_person == "third"
                parent = by_cid.get(c["parent_clause_id"] or "")
                parent_is_verified_narrator = bool(parent and parent["quotation_status"] == "none")

                if pw_is_speech and is_top and not sent_has_1st_2nd:
                    c["quotation_status"] = "none"
                    c["speaker_scope"] = "narrator"
                elif is_heb_wayyiqtol_3 and is_top:
                    c["quotation_status"] = "none"
                    c["speaker_scope"] = "narrator"
                elif parent_is_verified_narrator and pw_person not in ("first", "second"):
                    c["quotation_status"] = "none"
                    c["speaker_scope"] = "narrator"
                elif (
                    self.lang == "hebrew"
                    and not seen_speech_in_file
                    and not sent_has_1st_2nd
                    and pw_person not in ("first", "second")
                    and sent_idx <= 2
                ):
                    c["quotation_status"] = "none"
                    c["speaker_scope"] = "narrator"
                else:
                    c["quotation_status"] = "unknown"
                    c["speaker_scope"] = "unknown"

            if sent_has_speech_verb:
                seen_speech_in_file = True

            # Propagate inherited negation or speech quotation from wrapping parent only when
            # clause is nested inside a quoted clause (already done above) and re-check question
            # punctuation on top-level sentence containing nested questions.
            if self.lex.q_punct:
                has_q_mark = any(
                    self.lex.q_punct in (self.words[tid].get("after") or "")
                    for c in sent_clauses
                    for tid in c["direct_token_ids"]
                    if tid in self.words
                )
                if has_q_mark:
                    # Only mark clauses as interrogative if their own tokens carry ';' or an interrogative word
                    for c in sent_clauses:
                        if c["speech_quoted"] and any(
                            self.lex.q_punct in (self.words[tid].get("after") or "")
                            for tid in c["token_ids"]
                            if tid in self.words
                        ) and c["modality"] not in ("imperative", "jussive", "cohortative", "infinitive", "participle"):
                            c["modality"] = "interrogative"

            clauses_out.extend(sent_clauses)

        for sent_idx, sent in enumerate(sentences, start=1):
            walk_sentence(sent, sent_idx)
        return clauses_out

    def extract_file(self, root: ET.Element, edition: str = "", source_path: str = "") -> list[dict[str, Any]]:
        return self._compute_sentence_clauses(root, edition=edition, source_path=source_path)
