// Small isolated recovery rehearsal. No production connection and no full-data restore.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {buildReclamationSchema,quoteRelation,quoteIdentifier} from './build-reclamation-backup-schema.mjs';
const root='.artifacts/phase0',catalog=JSON.parse(fs.readFileSync('supabase/recovery/reclamation-catalog.json'));
const inventory=JSON.parse(fs.readFileSync(root+'/backup-inventory.json'));
const secret=fs.readFileSync('ARCHITECTURE_INDEPENDENT_AUDIT.md','utf8').match(/'([^'\r\n]*private_macula_frame_vault[^'\r\n]*)'/)?.[1];
function decrypt(file){const e=JSON.parse(fs.readFileSync(file)),d=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),Buffer.from(e.iv,'hex'));d.setAuthTag(Buffer.from(e.auth_tag,'hex'));const b=Buffer.concat([d.update(Buffer.from(e.ciphertext,'base64')),d.final()]);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),e.plaintext_sha256);return JSON.parse(b);}
async function* records(relation,privateOnly=false){
 const name=relation.split('.').pop();
 if(relation.startsWith('bible_internal.')||privateOnly){const prefix=privateOnly?'macula_gated_restricted_frame':name;const file=fs.readdirSync('.artifacts/private-backup').find(f=>f.startsWith(prefix)&&f.endsWith('.json.enc'));assert.ok(file);yield* decrypt('.artifacts/private-backup/'+file);return;}
 const t=inventory.tables.find(t=>t.relation===relation);
 let files=t?.shards.map(s=>s.path);
 if(!files){const key=['words','verses'].includes(name)?name+'_full':name;const dir=[`.artifacts/db-backup/tables/${key}`,`.artifacts/static-corpus/tables/${key}`].find(d=>fs.existsSync(d));assert.ok(dir,'Missing parent artifact '+relation);files=fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl.gz')).sort().map(f=>path.join(dir,f));}
 for(const file of files)for await(const line of createInterface({input:fs.createReadStream(file).pipe(createGunzip()),crlfDelay:Infinity}))if(line.trim())yield JSON.parse(line);
}
const selected=new Map(),queue=[];
function add(relation,row){const list=selected.get(relation)??[];if(!selected.has(relation))selected.set(relation,list);if(!list.some(r=>JSON.stringify(r)===JSON.stringify(row))){list.push(row);queue.push({relation,row});}}
function columns(text){return text.split(',').map(s=>s.trim().replaceAll('"',''));}
let db;const report={status:'RUNNING',full_restore_performed:false};
try{
 for(const relation of ['public.morphhb_tokens','public.macula_greek_tokens','public.lxx_swete_words','public.macula_gated_field_values','bible_internal.macula_syntax_unmapped_nodes']){for await(const row of records(relation,relation==='public.macula_gated_field_values')){add(relation,row);break;}}
 // Resolve only the foreign-key closure of these five sample records.
 while(queue.length){const {relation,row}=queue.shift(),t=catalog.relations.find(t=>t.schema+'.'+t.name===relation);
  for(const fk of t.constraints.filter(c=>c.type==='f')){const m=fk.definition.match(/FOREIGN KEY \(([^)]+)\) REFERENCES [^(]+\(([^)]+)\)/);assert.ok(m,'Unsupported FK');const local=columns(m[1]),remote=columns(m[2]);if(local.some(k=>row[k]==null))continue;const parent=fk.parent.includes('.')?fk.parent:'public.'+fk.parent;const matches=r=>remote.every((k,i)=>String(r[k])===String(row[local[i]]));if(selected.get(parent)?.some(matches))continue;let found=false;for await(const r of records(parent))if(matches(r)){add(parent,r);found=true;break;}assert.ok(found,'Missing recovery parent '+parent);}
 }
 db=await PGlite.create({extensions:{pg_trgm}});await db.exec("CREATE EXTENSION pg_trgm; SET TIME ZONE 'UTC';");const ddl=buildReclamationSchema(catalog);await db.exec(ddl.tables);
 for(const[relation,rows]of selected){const t=catalog.relations.find(t=>t.schema+'.'+t.name===relation),names=t.columns.filter(c=>!c.generated).map(c=>c.name);await db.query(`INSERT INTO ${quoteRelation(relation)} (${names.map(quoteIdentifier)}) OVERRIDING SYSTEM VALUE SELECT ${names.map(k=>'x.'+quoteIdentifier(k))} FROM jsonb_populate_recordset(NULL::${quoteRelation(relation)},$1::jsonb)x`,[JSON.stringify(rows)]);const n=(await db.query(`SELECT count(*)::int AS n FROM ${quoteRelation(relation)}`)).rows[0].n;assert.equal(n,rows.length);}
 await db.exec(ddl.foreignKeys);await db.exec(ddl.indexes);
 for(const s of ddl.sequences){const max=(await db.query(`SELECT max(${quoteIdentifier(s.column)})::text AS n FROM ${quoteRelation(s.relation)}`)).rows[0].n;if(max!==null){const sequence=s.sequence??(await db.query('SELECT pg_get_serial_sequence($1,$2) AS n',[s.relation,s.column])).rows[0].n;await db.query('SELECT setval($1::regclass,$2::bigint,true)',[sequence,max]);}}
 // Exercise recovered source references and canonical token links through real joins.
 const retrieval=(await db.query('SELECT (SELECT count(*) FROM public.morphhb_tokens t JOIN public.words w ON w.id=t.step_word_id) AS hebrew,(SELECT count(*) FROM public.macula_greek_tokens t JOIN public.words w ON w.id=t.step_word_id) AS greek,(SELECT count(*) FROM public.lxx_swete_words t JOIN public.source_editions e ON e.id=t.source_edition_id) AS lxx,(SELECT count(*) FROM public.macula_gated_field_values t JOIN public.macula_hebrew_morphemes m ON m.id=t.morpheme_id) AS restricted,(SELECT count(*) FROM bible_internal.macula_syntax_unmapped_nodes n JOIN bible_internal.macula_syntax_import_files f ON f.id=n.source_file_id) AS unmapped')).rows[0];
 for(const n of Object.values(retrieval))assert.equal(Number(n),1);
 report.status='PASS_REPRESENTATIVE_RESTORE';report.relations=[...selected].map(([relation,rows])=>({relation,rows:rows.length}));report.foreign_keys_validated=true;report.indexes_recreated=true;report.sequences_reset=true;report.retrieval=retrieval;
 console.log(JSON.stringify({status:report.status,relations:selected.size,records:[...selected.values()].reduce((s,r)=>s+r.length,0)}));
}catch(error){report.status='FAIL';report.message=error.message;report.code=error.code;console.log(JSON.stringify(report));process.exitCode=1;}
finally{fs.writeFileSync(root+'/representative-restore-report.json',JSON.stringify(report,null,2));if(db)await db.close();}
