#!/usr/bin/env python3
"""Synthetic end-to-end fixture for the candidate verifier (offline)."""
from pathlib import Path
import gzip,json, tempfile, subprocess,sys
script=Path(__file__).with_name('b7_verify_candidate.py')
with tempfile.TemporaryDirectory() as d:
 root=Path(d)
 def rows(name,items):
  p=root/'tables'/name/'part-0000.jsonl.gz';p.parent.mkdir(parents=True)
  with gzip.open(p,'wt',encoding='utf8') as z:
   for item in items:z.write(json.dumps(item)+'\n')
 def chapter(name,verses):
  p=root/'v1'/'chapters'/name;p.parent.mkdir(parents=True,exist_ok=True)
  with gzip.open(p,'wt',encoding='utf8') as z:json.dump({'verses':verses},z)
 (root/'manifest.json').write_text('{}')
 rows('books',[{'id':1,'usfm':'GEN'},{'id':19,'usfm':'PSA'}])
 rows('verses_immutable',[
  {'id':13959,'book':19,'chapter':3,'verse_nr':0,'word_ids':[88044]},
  {'id':929,'book':1,'chapter':31,'verse_nr':55,'word_ids':[138884]},
 ])
 rows('versification_mappings',
  [{'to_ref':f'MT:FAKE.{i}.1','canonical_verse_id':929} for i in range(2086)]+[
  {'to_ref':'MT:PSA.3.1','canonical_verse_id':13959},
  {'to_ref':'MT:GEN.32.1','canonical_verse_id':929},
 ])
 morph=[{'id':1,'morphhb_id':'19AxB','book':19,'chapter':3,'verse_nr':1,'canonical_verse_id':13959,'step_word_id':88044},
        {'id':2,'morphhb_id':'01SDx','book':1,'chapter':32,'verse_nr':1,'canonical_verse_id':929,'step_word_id':138884}]
 mac=[{'id':1,'macula_id':'PSA-1','book':19,'chapter_mt':3,'verse_mt':1,'canonical_verse_id':13959,'word_id':88044},
      {'id':2,'macula_id':'GEN-1','book':1,'chapter_mt':32,'verse_mt':1,'canonical_verse_id':929,'word_id':138884}]
 rows('morphhb_tokens',morph);rows('macula_hebrew_morphemes',mac)
 rows('lxx_swete_words',[{'book_no':27,'chapter':3,'chapter_suffix':'','verse_nr':1,'verse_suffix':'','word_text':'τί'}])
 lm=[{'id':100,'canonical_verse_id':13959,'lxx_book_no':27,'lxx_chapter':3,'lxx_verse_nr':1,'b7_target_text_status':'source_text_present'},
     {'id':101,'canonical_verse_id':929,'lxx_book_no':27,'lxx_chapter':3,'lxx_verse_nr':99,'b7_target_text_status':'source_text_absent'}]
 rows('hebrew_lxx_verse_map',lm)
 chapter('b19-c3.json.gz',{'0':{'verse_id':13959,'morphhb_tokens':[morph[0]],'macula_hebrew_morphemes':[mac[0]],'hebrew_lxx_verse_map':[lm[0]],'hebrew_lxx_unresolved_mappings':[]}})
 chapter('b1-c31.json.gz',{'55':{'verse_id':929,'morphhb_tokens':[morph[1]],'macula_hebrew_morphemes':[mac[1]],'hebrew_lxx_verse_map':[],'hebrew_lxx_unresolved_mappings':[lm[1]]}})
 for i in range(1188):chapter(f'b1-c{1000+i}.json.gz',{})
 result=subprocess.run([sys.executable,str(script),'--root',str(root),'--skip-hashes'],capture_output=True,text=True)
 if result.returncode:raise RuntimeError(result.stdout+'\n'+result.stderr)
 assert 'B7 CANDIDATE CHECK PASS' in result.stdout
 print('PASS synthetic end-to-end: 2 sources, crosswalk, source-text presence, all chapter joins')
 # Perturb source-token placement in chapter and ensure verifier fails.
 chapter('b19-c3.json.gz',{'0':{'verse_id':929,'morphhb_tokens':[morph[0]],'macula_hebrew_morphemes':[mac[0]],'hebrew_lxx_verse_map':[lm[0]],'hebrew_lxx_unresolved_mappings':[]}})
 failed=subprocess.run([sys.executable,str(script),'--root',str(root),'--skip-hashes'],capture_output=True,text=True)
 assert failed.returncode!=0 and ('wrong chapter verse' in failed.stderr or 'Chapter MorphHB mismatch' in failed.stderr)
 print('PASS negative end-to-end: misplaced chapter source is detected')