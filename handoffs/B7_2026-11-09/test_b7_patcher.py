#!/usr/bin/env python3
"""Patcher contract test against source anchors. Not a substitute for local --check."""
import ast
import importlib.util
from pathlib import Path
source=Path(__file__).with_name('b7_patch_exporter.py')
spec=importlib.util.spec_from_file_location('b7patch',source)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
tree=ast.parse(source.read_text())
fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='patch')
refs={}
for n in ast.walk(fn):
 if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name):
  try:refs[n.targets[0].id]=ast.literal_eval(n.value)
  except Exception:pass
pieces=[]
for statement in fn.body:
 # retain patch invocation ordering, including those in multiline AST expressions
 if isinstance(statement,ast.Assign) and isinstance(statement.value,ast.Call) and isinstance(statement.value.func,ast.Name):
  c=statement.value;name=c.func.id
  if name in ('once','between'):
   def val(x):
    if isinstance(x,ast.Name):return refs[x.id]
    return ast.literal_eval(x)
   if name=='once':pieces.append(val(c.args[1]))
   else:pieces.extend([val(c.args[1]),'# placeholder\n',val(c.args[2])])
mock='MOCK_SOURCE = r\'\'\'\n'+'\n'.join(pieces)+'\n\'\'\'\n'
assert 'def validate_b7_source_mappings' not in mock
result=mod.patch(mock)
ast.parse(result)
assert result.count('def validate_b7_source_mappings')==1
assert 'CORPUS_DIR = ARTIFACTS_DIR / "static-corpus-b7-candidate"' in result
assert 'return cached_meta' not in result
assert 'semantic_frame = None  # restricted Macula field; never publish' in result
print('PASS: all staged patch replacement contracts succeed on synthetic source')
print('NOTE: Still run --check against actual LOCAL scripts/export-static-corpus.py')