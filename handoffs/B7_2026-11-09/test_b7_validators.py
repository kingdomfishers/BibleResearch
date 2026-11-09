#!/usr/bin/env python3
"""Synthetic positive + negative tests for the embedded B7 mapping validator."""
import importlib.util
from pathlib import Path
source=Path(__file__).with_name('b7_patch_exporter.py')
spec=importlib.util.spec_from_file_location('b7patch',source)
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
ns={}
exec(mod.VALIDATOR,ns)
verify=ns['validate_b7_source_mappings']
rows=[{'to_ref':f'MT:FAKE.{i}.1','canonical_verse_id':10} for i in range(2086)] + [
    {'to_ref':'MT:PSA.3.1','canonical_verse_id':13959},
    {'to_ref':'MT:GEN.32.1','canonical_verse_id':929},
]
base={
  'books':[{'id':1,'usfm':'GEN'},{'id':19,'usfm':'PSA'}],
  'versification_mappings':rows,
  'morphhb_tokens':[
      {'id':1,'morphhb_id':'19AxB','book':19,'chapter':3,'verse_nr':1,'canonical_verse_id':13959,'step_word_id':88044},
      {'id':2,'morphhb_id':'01SDx','book':1,'chapter':32,'verse_nr':1,'canonical_verse_id':929,'step_word_id':138884},
  ],
  'macula_hebrew_morphemes':[
      {'id':1,'macula_id':'PSA-1','book':19,'chapter_mt':3,'verse_mt':1,'canonical_verse_id':13959,'word_id':88044},
      {'id':2,'macula_id':'GEN-1','book':1,'chapter_mt':32,'verse_mt':1,'canonical_verse_id':929,'word_id':138884},
  ]
}
coords={(19,3,0):13959,(1,31,55):929}
verses={13959:{'id':13959,'book':19,'chapter':3,'verse_nr':0,'word_ids':[88044]},929:{'id':929,'book':1,'chapter':31,'verse_nr':55,'word_ids':[138884]}}
assert verify(base,coords,verses)['morphhb_tokens']['checked']==2
print('PASS positive shifted Hebrew source references')
base['morphhb_tokens'][0]['canonical_verse_id']=929
try:verify(base,coords,verses)
except RuntimeError as e:
    assert 'wrong/missing verse' in str(e)
    print('PASS negative: catches stale Psalm source/canonical mapping')
else:raise AssertionError('Wrong canonical verse undetected')
base['morphhb_tokens'][0]['canonical_verse_id']=13959
base['macula_hebrew_morphemes'][1]['word_id']=88044
try:verify(base,coords,verses)
except RuntimeError as e:
    assert 'word not in canonical verse' in str(e)
    print('PASS negative: catches source word not in target canonical verse')
else:raise AssertionError('Word mismatch undetected')