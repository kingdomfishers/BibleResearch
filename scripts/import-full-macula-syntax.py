#!/usr/bin/env python3
"""Resumable source-faithful MACULA lowfat XML -> existing BibleResearch syntax RPC.
Dry-run by default. Never stores credentials or modifies source token corpora.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
REF = re.compile(r"^([A-Za-z0-9]{2,5})\s+(\d+):(\d+)(?:!(\d+))?")
SOURCES = {
    "hebrew": ("Clear-Bible/macula-hebrew", "47db250bd55d0d8577f2a94fba114ef16c35b23c", "WLC/lowfat", "macula-hebrew-wlc", 11, 7),
    "nestle1904": ("Clear-Bible/macula-greek", "8423afe47b9e8f24b7772e808af45c7159a6fe7e", "Nestle1904/lowfat", "macula-greek-nestle1904", 18, 8),
    "sblgnt": ("Clear-Bible/macula-greek", "8423afe47b9e8f24b7772e808af45c7159a6fe7e", "SBLGNT/lowfat", "macula-greek-sblgnt", 19, 8),
}
ROLE = {"s": "subject", "o": "object", "v": "predicate"}

def get_json(url, key=None, payload=None, retries=4):
    headers = {"Accept": "application/json"}
    if key:
        headers.update({"apikey": key, "Authorization": "Bearer " + key})
    if payload is not None:
        headers["Content-Type"] = "application/json"
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, body, headers), timeout=120) as r:
                return json.loads(r.read())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            if attempt == retries - 1:
                raise RuntimeError("HTTP request failed: " + str(exc)) from exc
            time.sleep(2 ** attempt)

def clone_pinned(cache, repository, sha):
    folder = cache / repository.split("/")[-1]
    if not (folder / ".git").is_dir():
        folder.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "-C", str(folder), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(folder), "remote", "add", "origin",
                        "https://github.com/" + repository + ".git"], check=True)
    current = subprocess.run(["git", "-C", str(folder), "rev-parse", "HEAD"],
                             capture_output=True, text=True)
    if current.returncode or current.stdout.strip() != sha:
        subprocess.run(["git", "-C", str(folder), "fetch", "-q", "--depth", "1",
                        "origin", sha], check=True)
        subprocess.run(["git", "-C", str(folder), "checkout", "-q", "--detach",
                        "FETCH_HEAD"], check=True)
    actual = subprocess.check_output(["git", "-C", str(folder), "rev-parse", "HEAD"], text=True).strip()
    if actual != sha:
        raise RuntimeError("Pinned source commit mismatch")
    return folder

def source_ref(word):
    raw = word.attrib.get("ref", "")
    m = REF.match(raw)
    return (m.group(1).upper(), int(m.group(2)), int(m.group(3)), int(m.group(4) or 1)) if m else None

def parse_sentence(sentence, prefix, edition_id, release_id, verse_ids):
    words = [(w, source_ref(w)) for w in sentence.iter("w")]
    if not words or any(v is None for _, v in words):
        raise ValueError("Missing or malformed upstream token ref: " + prefix)
    evidence = []
    for word, (book, ch, vs, pos) in words:
        k = (book, ch, vs)
        if k not in verse_ids:
            raise ValueError("Unmapped canonical verse " + repr(k) + " in " + prefix)
        evidence.append((verse_ids[k], pos, word.attrib.get(XML_ID)))
    nodes, edges = [], []
    seq = 0
    def visit(elem, parent=None, depth=0, order=0):
        nonlocal seq
        if elem.tag not in ("sentence", "wg", "w"):
            return
        subs = [w for w in elem.iter("w")]
        locs = [source_ref(w) for w in subs]
        ids = [verse_ids[(x[0], x[1], x[2])] for x in locs]
        if not ids:
            raise ValueError("Empty grammar group " + prefix)
        seq += 1
        key = prefix + ":" + str(seq)
        is_word = elem.tag == "w"
        cls = elem.attrib.get("class", "")
        kind = "sentence" if elem.tag == "sentence" else ("terminal" if is_word else ("clause" if cls == "cl" else "phrase"))
        positions = [x[3] for x in locs]
        first, last = min(ids), max(ids)
        roles = elem.attrib.get("role")
        rec = {
            "node_key": key, "parent_node_key": parent, "tree_id": prefix,
            "edition_id": edition_id, "source_release_id": release_id,
            "verse_id": first, "end_verse_id": last,
            "is_cross_verse": first != last,
            "node_type": kind, "start_word_position": min(positions),
            "end_word_position": max(positions), "head_word_position": None,
            "syntactic_role": roles, "class_label": cls or None,
            "rule_label": elem.attrib.get("rule"), "cl_type": elem.attrib.get("cltype"),
            "grammar_summary": None, "depth": depth, "sibling_order": order,
            "is_head": elem.attrib.get("head") == "true",
            "is_terminal": is_word, "terminal_xml_id": elem.attrib.get(XML_ID) if is_word else None,
            "semantic_frame": elem.attrib.get("frame"),
            "source_record_id": key
        }
        nodes.append(rec)
        if parent:
            edges.append({
                "source_node_key": parent, "target_node_key": key,
                "edition_id": edition_id, "source_release_id": release_id,
                "verse_id": first, "dependent_word_position": min(positions),
                "head_word_position": min(positions), "relation_type": ROLE.get(roles, "parent_child"),
                "raw_relation_tag": roles or elem.attrib.get("rule") or cls or "constituent",
                "source_record_id": parent + "->" + key,
                "origin_mode": "directly_imported",
                "derivation_method": "macula_lowfat_xml_parent_child_v1"
            })
        for i, child in enumerate(c for c in elem if c.tag in ("wg", "w")):
            visit(child, key, depth + 1, i)
    visit(sentence)
    if sum(n["is_terminal"] for n in nodes) != len(words):
        raise ValueError("Terminal coverage mismatch in " + prefix)
    return nodes, edges, set(x[0] for x in evidence)

def page_all(url, key, page_size=1000):
    out, offset = [], 0
    while True:
        sep = "&" if "?" in url else "?"
        page = get_json(url + sep + f"limit={page_size}&offset={offset}", key)
        out.extend(page)
        if len(page) < page_size:
            return out
        offset += page_size

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edition", choices=(*SOURCES.keys(), "all"), default="all")
    ap.add_argument("--cache", type=Path, default=Path(".artifacts/macula-source-cache"))
    ap.add_argument("--execute", action="store_true", help="Actually write through admin RPC")
    ap.add_argument("--max-files", type=int, default=0)
    ap.add_argument("--batch-size", type=int, default=250)
    args = ap.parse_args()
    if args.batch_size < 25 or args.batch_size > 600:
        ap.error("--batch-size must be 25..600")
    endpoint = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if args.execute and (not endpoint.startswith("https://") or not secret):
        ap.error("--execute requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    if not endpoint or not secret:
        ap.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (required to verify source-linked IDs)")
    base = endpoint + "/rest/v1/"
    books = page_all(base + "books?select=id,usfm", secret)
    book_by_usfm = {b["usfm"].upper(): b["id"] for b in books}
    verses = page_all(base + "verses?select=id,book,chapter,verse_nr", secret)
    ids = {(usfm, int(v["chapter"]), int(v["verse_nr"])): int(v["id"])
           for v in verses for usfm in [next((k for k, n in book_by_usfm.items() if n == v["book"]), None)]
           if usfm}
    editions = SOURCES if args.edition == "all" else {args.edition: SOURCES[args.edition]}
    total_files = total_trees = total_nodes = total_edges = 0
    for edition, (repository, sha, subdir, edition_key, eid, rid) in editions.items():
        root = clone_pinned(args.cache, repository, sha) / subdir
        files = sorted(root.glob("*.xml"))
        if not files:
            raise RuntimeError("No upstream XML files under " + str(root))
        for xml_file in files:
            if args.max_files and total_files >= args.max_files:
                break
            book_verses = set()
            sent_count = node_count = edge_count = 0
            for _, sentence in ET.iterparse(xml_file, events=("end",)):
                if sentence.tag != "sentence":
                    continue
                first = next((source_ref(w) for w in sentence.iter("w") if source_ref(w)), None)
                if not first:
                    sentence.clear()
                    continue
                book = first[0]
                if book not in book_by_usfm:
                    raise RuntimeError("Unknown USFM book in source: " + book)
                sent_count += 1
                prefix = f"macula:full:{edition}:{book}:{xml_file.stem}:sentence-{sent_count}"
                nodes, edges, covered = parse_sentence(sentence, prefix, eid, rid, ids)
                book_verses |= covered
                if args.execute:
                    def send(node_rows, edge_rows):
                        response = get_json(base + "rpc/ingest_syntax_tree_batch_v1", secret,
                                            {"p_nodes": node_rows, "p_edges": edge_rows})
                        if not response.get("success"):
                            raise RuntimeError("Syntax RPC failed: " + repr(response))
                    for i in range(0, len(nodes), args.batch_size):
                        send(nodes[i:i + args.batch_size], [])
                    for i in range(0, len(edges), args.batch_size):
                        send([], edges[i:i + args.batch_size])
                node_count += len(nodes)
                edge_count += len(edges)
                sentence.clear()
            total_files += 1
            total_trees += sent_count
            total_nodes += node_count
            total_edges += edge_count
            print(json.dumps({"edition": edition, "file": xml_file.name, "sentences": sent_count,
                              "nodes": node_count, "edges": edge_count, "verses_touched": len(book_verses),
                              "committed": args.execute}), flush=True)
        if args.max_files and total_files >= args.max_files:
            break
    print(json.dumps({"done": True, "files": total_files, "trees": total_trees,
                      "nodes": total_nodes, "edges": total_edges, "committed": args.execute}))

if __name__ == "__main__":
    main()
