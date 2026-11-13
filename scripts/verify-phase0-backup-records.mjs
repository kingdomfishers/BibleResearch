// Verify typed recovery records without restoring the full dataset or contacting production.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {buildReclamationSchema,quoteRelation,quoteIdentifier} from './build-reclamation-backup-schema.mjs';
import {RECLAMATION_TABLES} from './phase0-storage-scope.mjs';

const root='.artifacts/phase0';
const catalog=JSON.parse(fs.readFileSync('supabase/recovery/reclamation-catalog.json'));
const inventory=JSON.parse(fs.readFileSync(root+'/backup-inventory.json'));
const expected=JSON.parse(fs.readFileSync(root+'/live-table-digests.json'));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const secret=fs.readFileSync('ARCHITECTURE_INDEPENDENT_AUDIT.md','utf8').match(/'([^'\r\n]*private_macula_frame_vault[^'\r\n]*)'/)?.[1];
assert.ok(secret,'Historical archive key evidence missing');
function decrypt(file){
 const e=JSON.parse(fs.readFileSync(file));
 const d=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),Buffer.from(e.iv,'hex'));
 d.setAuthTag(Buffer.from(e.auth_tag,'hex'));
 const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'base64')),d.final()]);
 assert.equal(hash(bytes),e.plaintext_sha256,'Archive plaintext digest mismatch');
 const rows=JSON.parse(bytes.toString('utf8'));assert.equal(rows.length,e.record_count);return rows;
}
async function* records(table){
 const internal=table.relation.split('.').pop();
 if(table.relation.startsWith('bible_internal.')){
  const file=fs.readdirSync('.artifacts/private-backup').find(f=>f.startsWith(internal+'_')&&f.endsWith('.json.enc'));
  assert.ok(file,'Missing internal recovery archive');yield* decrypt('.artifacts/private-backup/'+file);return;
 }
 for(const shard of table.shards){
  // Compressed file digests were already verified in the inventory. This pass verifies typed records.
  for await(const line of createInterface({input:fs.createReadStream(shard.path).pipe(createGunzip()),crlfDelay:Infinity}))if(line.trim())yield JSON.parse(line);
 }
 for(const shard of table.encrypted)yield* decrypt(shard.path);
}
const failedOnly=process.argv.includes('--failed-only');
const previous=failedOnly?JSON.parse(fs.readFileSync(root+'/backup-record-verification.json')):null;
const targets=failedOnly?previous.tables.filter(t=>!t.count_matches||!t.digest_matches).map(t=>t.relation):RECLAMATION_TABLES;
const report={status:'RUNNING',full_restore_performed:false,tables:previous?previous.tables.filter(t=>!targets.includes(t.relation)):[]};
let db;
try{
 db=await PGlite.create({extensions:{pg_trgm}});
 await db.exec("CREATE EXTENSION pg_trgm; SET TIME ZONE 'UTC';");
 await db.exec(buildReclamationSchema(catalog).tables);
 for(const relation of targets){
  const descriptor=catalog.relations.find(t=>t.schema+'.'+t.name===relation);
  const pk=descriptor.constraints.find(c=>c.type==='p').definition.match(/PRIMARY KEY \(([^)]+)\)/)[1].split(',').map(c=>c.trim().replaceAll('"',''));
  const table=inventory.tables.find(t=>t.relation===relation),digests=[];let batch=[];
  async function check(){
   if(!batch.length)return;
   const result=await db.query(`SELECT jsonb_build_array(${pk.map(k=>'t.'+quoteIdentifier(k)).join(',')}) AS pk,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest FROM jsonb_populate_recordset(NULL::${quoteRelation(relation)},$1::jsonb)t`,[JSON.stringify(batch)]);
   digests.push(...result.rows);batch=[];
  }
  for await(const row of records(table)){batch.push(row);if(batch.length===1000)await check();}await check();
  // Let PostgreSQL order typed primary keys; JavaScript string ordering is not a SQL collation contract.
  await db.exec(`DROP TABLE IF EXISTS digest_keys; CREATE TEMP TABLE digest_keys (${pk.map(k=>quoteIdentifier(k)+' '+descriptor.columns.find(c=>c.name===k).type).join(',')},digest text);`);
  for(let i=0;i<digests.length;i+=1000)await db.query(`INSERT INTO digest_keys SELECT ${pk.map((k,j)=>`(r->'pk'->>${j})::${descriptor.columns.find(c=>c.name===k).type}`).join(',')},r->>'digest' FROM jsonb_array_elements($1::jsonb)r`,[JSON.stringify(digests.slice(i,i+1000))]);
  const actual=(await db.query(`SELECT encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY ${pk.map(quoteIdentifier).join(',')}),''),'UTF8')),'hex') AS digest FROM digest_keys`)).rows[0].digest,golden=expected.find(t=>t.relation===relation);
  const result={relation,rows:digests.length,typed_rows_sha256:actual,count_matches:digests.length===Number(golden.rows),digest_matches:actual===golden.typed_rows_sha256};
  report.tables.push(result);
  fs.writeFileSync(root+'/backup-record-verification.json',JSON.stringify(report,null,2));
  fs.writeFileSync(root+'/backup-record-progress.json',JSON.stringify({relation,checked_tables:report.tables.length,rows:digests.length,pass:result.count_matches&&result.digest_matches}));
 }
 report.status=report.tables.every(t=>t.count_matches&&t.digest_matches)?'PASS_ALL_19_RECOVERY_DATASETS':'BACKUP_MISMATCH';
 console.log(JSON.stringify({status:report.status,tables:report.tables.length,mismatches:report.tables.filter(t=>!t.count_matches||!t.digest_matches).map(t=>t.relation)}));
 if(report.status!=='PASS_ALL_19_RECOVERY_DATASETS')process.exitCode=1;
}catch(error){report.status='FAIL';report.message=error.message;console.log(JSON.stringify({status:report.status,message:error.message}));process.exitCode=1;}
finally{fs.writeFileSync(root+'/backup-record-verification.json',JSON.stringify(report,null,2));if(db)await db.close();}
