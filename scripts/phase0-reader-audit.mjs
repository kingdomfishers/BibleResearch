// Mechanical source drift and direct-reader inventory; never scans biblical datasets.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { RECLAMATION_TABLES } from './phase0-storage-scope.mjs';
const migrated=process.argv.includes('--migrated');
const functions=JSON.parse(fs.readFileSync('.artifacts/phase0/'+(migrated?'migrated-functions.json':'live-functions.json')));
const current=JSON.parse(fs.readFileSync('.artifacts/phase0/current-function-hashes.json'));
const key=f=>`${f.schema}.${f.name}(${f.identity_arguments})`;
const changed=current.filter(f=>{const old=functions.find(x=>key(x)===key(f));return !old||crypto.createHash('md5').update(old.definition).digest('hex')!==f.md5||old.acl!==f.acl;});
const readers=functions.map(f=>{
 const source=f.definition.replace(/--[^\n]*/g,'');
 const dependencies=RECLAMATION_TABLES.filter(t=>new RegExp('(?:from|join)\\s+'+t.replace('.','\\.')+'\\b','i').test(source));
 return {schema:f.schema,name:f.name,args:f.identity_arguments,public_execute:/(?:^|[,{])anon=X/.test(f.acl??''),dependencies,contexts:f.definition.split('\n').flatMap((line,i,lines)=>dependencies.some(t=>line.includes(t))?[lines.slice(Math.max(0,i-2),i+4).join('\n')]:[])};
}).filter(f=>f.dependencies.length);
fs.writeFileSync('.artifacts/phase0/'+(migrated?'migrated-reader-audit.json':'active-readers.json'),JSON.stringify({changed:migrated?[]:changed,readers},null,2));
console.log(JSON.stringify({changed:migrated?[]:changed.map(key),public_readers:readers.filter(f=>f.schema==='public'&&f.public_execute).map(({name,dependencies})=>({name,dependencies})),direct_readers:readers.map(f=>({schema:f.schema,name:f.name,dependencies:f.dependencies}))}));
if(process.argv.includes('--contexts'))for(const f of readers.filter(f=>f.schema==='public'&&f.public_execute))console.log(JSON.stringify({name:f.name,contexts:f.contexts}));
