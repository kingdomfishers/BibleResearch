#!/usr/bin/env python3
"""Read-only validation of a locally rebuilt BibleResearch B7 candidate corpus.

From the local BibleResearch root:
    python path/to/b7_verify_candidate.py

Requires .artifacts/static-corpus-b7-candidate created by the patched exporter.
Does not modify files, databases, or deployments.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from collections import Counter

DEFAULT_ROOT = Path('.artifacts/static-corpus-b7-candidate')


def die(msg: str):
    raise RuntimeError('B7 FAIL: '+msg)


def row_stream(root: Path, table: str):
    files = sorted((root/'tables'/table).glob('part-*.jsonl.gz'))
    if not files: die(f'No table shards found: {table}')
    for f in files:
        with gzip.open(f, 'rt', encoding='utf8') as fh:
            for number, line in enumerate(fh,1):
                if line.strip():
                    try: yield json.loads(line)
                    except json.JSONDecodeError as e: die(f'{f}:{number}: {e}')


def verify_hashes(root: Path, manifest: dict):
    entries=[]
    for table,info in manifest.get('tables',{}).items():
        for rec in info.get('shards',[]):
            entries.append((f'table:{table}',rec))
    for rec in manifest.get('v1_retrieval_shards',[]):
        entries.append(('v1',rec))
    if not entries: die('Manifest lacks shard checksums')
    visited = set()
    counted=Counter()
    for group,entry in entries:
        rel=entry.get('path')
        if not rel or rel in visited: die(f'Missing/duplicate manifest path {rel!r}')
        visited.add(rel)
        path=root/rel.lstrip('/')
        if not path.is_file(): die(f'Missing referenced shard {path}')
        compressed=path.read_bytes()
        h=hashlib.sha256(compressed).hexdigest()
        if h != entry.get('sha256_compressed'):
            die(f'Compressed SHA mismatch for {rel}: expected {entry.get("sha256_compressed")}, got {h}')
        if 'compressed_bytes' in entry and len(compressed) != int(entry['compressed_bytes']):
            die(f'Compressed byte count mismatch in {rel}')
        try: raw=gzip.decompress(compressed)
        except Exception as e: die(f'Invalid gzip shard {rel}: {e}')
        raw_sha=hashlib.sha256(raw).hexdigest()
        if raw_sha != entry.get('sha256_uncompressed'):
            die(f'Uncompressed SHA mismatch for {rel}')
        if 'uncompressed_bytes' in entry and len(raw)!=int(entry['uncompressed_bytes']):
            die(f'Uncompressed bytes mismatch for {rel}')
        if group.startswith('table:'):
            observed=raw.count(b'\n')
            if observed != int(entry.get('rows',-1)):
                die(f'Table shard row count mismatch {rel}, got {observed}')
            counted[group[6:]] += observed
    for table,info in manifest.get('tables',{}).items():
        if counted[table] != int(info.get('total_rows',-1)):
            die(f'Table total mismatch for {table}: {counted[table]} vs {info.get("total_rows")}')
    print(f'PASS: {len(entries)} candidate shard checksums and row counts')
    return counted


def verify_references(root: Path):
    verses={}
    coords={}
    for v in row_stream(root,'verses_immutable'):
        vid=int(v['id'])
        if vid in verses: die(f'Duplicate verse id {vid}')
        verses[vid]=set(map(int,v.get('word_ids') or []))
        coords[(int(v['book']),int(v['chapter']),int(v['verse_nr']))]=vid
    books={int(b['id']):b['usfm'] for b in row_stream(root,'books')}
    xwalk={}
    for x in row_stream(root,'versification_mappings'):
        ref=x.get('to_ref') or ''
        if ref.startswith('MT:'):
            if ref in xwalk: die(f'Duplicate explicit crosswalk {ref}')
            xwalk[ref]=int(x['canonical_verse_id'])
    if len(xwalk)<2088:die(f'Only {len(xwalk)} MT crosswalk rows')
    observed_ids={}
    xml_ids={}
    counters=Counter()
    for table,chf,vf,wordf,idf in (
        ('morphhb_tokens','chapter','verse_nr','step_word_id','morphhb_id'),
        ('macula_hebrew_morphemes','chapter_mt','verse_mt','word_id','macula_id')
    ):
        for r in row_stream(root,table):
            if table=='morphhb_tokens' and str(r.get(idf) or '').startswith('test'):
                continue
            book,ch,v=int(r['book']),int(r[chf]),int(r[vf])
            key=f'MT:{books[book]}.{ch}.{v}'
            expected=xwalk.get(key,coords.get((book,ch,v)))
            vid=int(r['canonical_verse_id']) if r.get('canonical_verse_id') is not None else None
            if vid is None or vid not in verses or vid != expected:
                die(f'{table} id {r["id"]} wrong verse for {key}: {vid}, expected {expected}')
            word=int(r[wordf]) if r.get(wordf) is not None else None
            if word is not None and word not in verses[vid]:
                die(f'{table} id {r["id"]} word {word} not in canonical verse {vid}')
            if r.get(idf):
                key_id=str(r[idf])
                if table=='morphhb_tokens' and key_id in observed_ids:
                    die(f'Duplicate MorphHB source identity {key_id}')
                if table=='morphhb_tokens':observed_ids[key_id]=(vid,word)
                elif key_id in xml_ids and xml_ids[key_id] != (vid,word):
                    die(f'Contradictory Macula XML id {key_id}: {xml_ids[key_id]} vs {(vid,word)}')
                else:xml_ids[key_id]=(vid,word)
            counters[table]+=1
            if word is None:counters[table+':unresolved']+=1
    for source,coord,wid in (('19AxB',(19,3,0),88044),('01SDx',(1,31,55),138884)):
        actual=observed_ids.get(source)
        if actual!=(coords[coord],wid):die(f'Canary mismatch {source}: {actual}, expected {(coords[coord],wid)}')
    print(f'PASS: MT mappings/source-word membership: {dict(counters)}')
    return observed_ids,xml_ids,verses


def verify_lxx_text_presence(root: Path):
    available = {
        (int(w['book_no']), int(w['chapter']), w.get('chapter_suffix') or '',
         int(w['verse_nr']), w.get('verse_suffix') or '')
        for w in row_stream(root,'lxx_swete_words')
    }
    expected = {}
    summary = Counter()
    for m in row_stream(root,'hebrew_lxx_verse_map'):
        if m.get('lxx_book_no') is None:
            status = 'no_source_edition'
        else:
            key = (int(m['lxx_book_no']),int(m['lxx_chapter']),m.get('lxx_chapter_suffix') or '',
                   int(m['lxx_verse_nr']),m.get('lxx_verse_suffix') or '')
            status = 'source_text_present' if key in available else 'source_text_absent'
        if m.get('b7_target_text_status') != status:
            die(f'LXX mapping id {m["id"]} wrongly states source-text status ' 
                f'{m.get("b7_target_text_status")!r}, expected {status!r}')
        expected[int(m['id'])] = (int(m['canonical_verse_id']),status)
        summary[status] += 1
    print(f'PASS: all {len(expected)} LXX mapping statuses reflect actual text availability: {dict(summary)}')
    return expected


def verify_chapters(root: Path, mrefs: dict, macref: dict, lxx_expected: dict):
    expected_morph=dict(mrefs)
    expected_macula={}
    # macula_id is sometimes a compound with several morphemes: check all IDs at least once
    for r in row_stream(root,'macula_hebrew_morphemes'):
        expected_macula[int(r['id'])]=(int(r['canonical_verse_id']),r.get('word_id'))
    chapters=sorted((root/'v1'/'chapters').glob('b*-c*.json.gz'))
    if len(chapters)<1100:die(f'Only {len(chapters)} chapter files')
    morph_seen=set()
    mac_seen=set()
    lxx_seen=set()
    for chpath in chapters:
        with gzip.open(chpath,'rt',encoding='utf8') as f: data=json.load(f)
        for vnum,verse in data.get('verses',{}).items():
            vid=int(verse['verse_id'])
            for label,status in (('hebrew_lxx_verse_map','source_text_present'),
                                 ('hebrew_lxx_unresolved_mappings','unresolved')):
                for lm in verse.get(label,[]):
                    lid = int(lm['id'])
                    if lid in lxx_seen: die(f'Duplicate chapter LXX mapping {lid}')
                    lxx_seen.add(lid)
                    expected = lxx_expected.pop(lid,None)
                    if expected is None:die(f'Unexpected LXX mapping {lid}')
                    if expected[0] != vid:
                        die(f'LXX mapping {lid} attached to wrong chapter verse {vid}')
                    if label == 'hebrew_lxx_verse_map' and expected[1] != status:
                        die(f'Unverified LXX mapping {lid} wrongly promoted to verified text')
                    if label == 'hebrew_lxx_unresolved_mappings' and expected[1] == 'source_text_present':
                        die(f'Available LXX mapping {lid} wrongly quarantined')
            for token in verse.get('morphhb_tokens',[]):
                src=token['morphhb_id']
                if src in morph_seen:die(f'Duplicate chapter MorphHB token {src}')
                morph_seen.add(src)
                exp=expected_morph.pop(src,None)
                if exp is None:die(f'Unexpected chapter MorphHB source {src}')
                if exp!=(vid,token.get('step_word_id')):
                    die(f'Chapter MorphHB mismatch {src} expected {exp}, got {(vid,token.get("step_word_id"))}')
            for token in verse.get('macula_hebrew_morphemes',[]):
                mid=int(token['id'])
                if mid in mac_seen:die(f'Duplicate chapter Macula record {mid}')
                mac_seen.add(mid)
                exp=expected_macula.pop(mid,None)
                if exp is None:die(f'Unexpected chapter Macula id {mid}')
                actual=(vid,token.get('word_id'))
                if actual[1] is not None:actual=(vid,int(actual[1]))
                if exp!=actual:die(f'Chapter Macula mismatch {mid}: {exp} != {actual}')
    if lxx_expected:
        die(f'{len(lxx_expected)} LXX mappings missing from candidate chapter outputs')
    if expected_morph:
        die(f'{len(expected_morph)} MorphHB tokens missing from canonical chapters, sample {next(iter(expected_morph))}')
    if expected_macula:
        die(f'{len(expected_macula)} Macula morphemes missing from canonical chapters, sample {next(iter(expected_macula))}')
    print(f'PASS: all {len(morph_seen)} MorphHB and {len(mac_seen)} Macula records occur exactly once in canonical chapters')


def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--root',type=Path,default=DEFAULT_ROOT)
    a.add_argument('--skip-hashes',action='store_true',help='debug only; never qualifies release')
    args=a.parse_args()
    root=args.root
    if not root.is_dir():die(f'Candidate directory absent: {root}')
    manifest=root/'manifest.json'
    if not manifest.is_file():die(f'Missing manifest {manifest}')
    data=json.loads(manifest.read_text(encoding='utf8'))
    if not args.skip_hashes:verify_hashes(root,data)
    morph,mac,verses=verify_references(root)
    lxx=verify_lxx_text_presence(root)
    verify_chapters(root,morph,mac,lxx)
    print('B7 CANDIDATE CHECK PASS: this validates static structure, not every word\'s independent philology.')
    print('Still required: original-source reconstruction, full syntax tree integrity, LXX mapping,')
    print('licensed-field audit, live deployed canary gate, and external backup verification.')

if __name__=='__main__':main()