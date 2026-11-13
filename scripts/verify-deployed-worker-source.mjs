// Compare compiler-normalized deployed functions against the reconciled Git baseline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import esbuild from 'esbuild';
const deployed=fs.readFileSync('.artifacts/phase0/deployed-corpus-worker.js','utf8');
const baseline=execFileSync('git',['show','d6658d4:scripts/corpus-worker.mjs'],{encoding:'utf8'});
const built=await esbuild.build({stdin:{contents:baseline,resolveDir:path.resolve('scripts'),sourcefile:'corpus-worker.mjs'},bundle:true,format:'esm',platform:'neutral',target:'es2022',keepNames:true,write:false});
async function inventory(source){
 const map=new Map();
 // esbuild emits named top-level functions with their closing brace at column zero.
 for(const m of source.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\([^\n]*\)\s*\{[\s\S]*?^\}/gm)){
  if(m[1].startsWith('__'))continue; // Security wrapper has its own source and boundary tests.
  const normalized=await esbuild.transform(m[0],{minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'es2022'});
  map.set(m[1],{hash:crypto.createHash('sha256').update(normalized.code).digest('hex'),source:m[0]});
 }
 return map;
}
const old=await inventory(deployed),local=await inventory(built.outputFiles[0].text),mismatches=[];
for(const[name,f]of old){const b=local.get(name);if(!b||b.hash!==f.hash)mismatches.push({name,deployed:f,local:b??null});}
fs.writeFileSync('.artifacts/phase0/deployed-worker-function-diff.json',JSON.stringify(mismatches,null,2));
console.log(JSON.stringify({deployed_functions:old.size,local_functions:local.size,mismatches:mismatches.map(m=>m.name)}));
