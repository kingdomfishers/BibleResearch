// Produces a review artifact only. Never connects to production or executes SQL.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {RECLAMATION_TABLES,PROTECTED_RELATIONS,assertReclamationScope} from './phase0-storage-scope.mjs';
const dir='.artifacts/phase0';
const backups=JSON.parse(fs.readFileSync(dir+'/backup-canonical-verification.json'));
assert.equal(backups.status,'PASS_ALL_19_RECOVERY_DATASETS','Complete backup verification required');
assert.equal(backups.tables.length,19);
const baseline=JSON.parse(fs.readFileSync(dir+'/protected-five-baseline.json'));
assert.deepEqual(baseline.map(t=>t.relation).sort(),[...PROTECTED_RELATIONS].sort());
const expectedCounts=[5,1,4,66,5];
PROTECTED_RELATIONS.forEach((n,i)=>assert.equal(Number(baseline.find(t=>t.relation===n).rows),expectedCounts[i]));
let sql=fs.readFileSync('scripts/reclaim-supabase-storage.sql','utf8');assertReclamationScope(sql);
const quote=x=>"'"+x.replaceAll("'","''")+"'";
const scope=RECLAMATION_TABLES.map(quote).join(',');
const catalog=JSON.parse(fs.readFileSync(dir+'/preflight-catalog.json'))[0].preflight;
const releaseGuards=RECLAMATION_TABLES.map(relation=>{
 const trigger=catalog.triggers.find(t=>t.relation===relation.replace(/^public\./,'')&&t.name==='stage_g_release_gate')??catalog.triggers.find(t=>t.relation===relation&&t.name==='stage_g_release_gate');
 assert.ok(trigger,'Missing captured release guard: '+relation);
 assert.equal(trigger.enabled,'O');
 const digest=crypto.createHash('md5').update(trigger.function).digest('hex');
 return `IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=${quote(relation)}::regclass AND tgname='stage_g_release_gate' AND tgenabled='O' AND pg_get_triggerdef(oid,true)=${quote(trigger.definition)} AND md5(pg_get_functiondef(tgfoid))=${quote(digest)}) THEN RAISE EXCEPTION 'Release guard drift: ${relation}'; END IF;`;
}).join('\n');
const snapshot=fs.readFileSync('scripts/reclamation-preservation.sql','utf8')+`
DO $preserve$ DECLARE r record; v jsonb; BEGIN
 IF current_setting('phase0.release_approved',true) IS DISTINCT FROM 'Execute the verified TRUNCATE.' THEN
   RAISE EXCEPTION 'Separate explicit user approval is required'; END IF;
 ${releaseGuards}
 IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname||'.'||c.relname IN (${scope}) AND NOT t.tgisinternal AND (t.tgtype & 32)=32 AND t.tgname<>'stage_g_release_gate') THEN RAISE EXCEPTION 'Unexpected truncation trigger'; END IF;
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p')
 AND n.nspname||'.'||c.relname NOT IN (${scope}) ORDER BY n.nspname,c.relname LOOP
   IF has_table_privilege(format('%I.%I',r.nspname,r.relname),'UPDATE,DELETE,TRUNCATE') THEN
     EXECUTE format('LOCK TABLE ONLY %I.%I IN SHARE MODE',r.nspname,r.relname);
   ELSE
     EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS SHARE MODE',r.nspname,r.relname);
   END IF;
   INSERT INTO pg_temp.phase0_preserved_relations VALUES (r.nspname||'.'||r.relname,pg_temp.phase0_relation_state(format('%I.%I',r.nspname,r.relname)::regclass));
 END LOOP;
 ${baseline.map(t=>`SELECT state INTO v FROM pg_temp.phase0_preserved_relations WHERE relation=${quote(t.relation)};
 IF v#>>'{content,sha256}' IS DISTINCT FROM ${quote(t.canonical_sha256)} OR (v#>>'{content,rows}')::bigint IS DISTINCT FROM ${t.rows} OR v->'schema' IS DISTINCT FROM ${quote(JSON.stringify(t.schema_snapshot))}::jsonb THEN RAISE EXCEPTION 'Protected baseline changed: ${t.relation}'; END IF;`).join('\n')}
END; $preserve$;`;
sql=sql.replace("SET LOCAL statement_timeout = '60s';","SET LOCAL statement_timeout = '60s';\nSET LOCAL TIME ZONE 'UTC';\n"+snapshot);
const release=RECLAMATION_TABLES.map(n=>`ALTER TABLE ONLY ${n} DISABLE TRIGGER stage_g_release_gate;`).join('\n');
const restore=RECLAMATION_TABLES.map(n=>`ALTER TABLE ONLY ${n} ENABLE TRIGGER stage_g_release_gate;`).join('\n');
sql=sql.replace(/TRUNCATE TABLE\s+([\s\S]*?);/,m=>release+'\n'+m+'\n'+restore);
sql=sql.replace(/\nCOMMIT;/,`\nDO $preserved$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM pg_temp.phase0_preserved_relations LOOP
 IF pg_temp.phase0_relation_state(r.relation::regclass) IS DISTINCT FROM r.state THEN
 RAISE EXCEPTION 'Preserved relation changed: %',r.relation; END IF; END LOOP;
END; $preserved$;\nCOMMIT;`);
assertReclamationScope(sql);
fs.writeFileSync(dir+'/reclamation-approval.sql',sql);
console.log(JSON.stringify({status:'GENERATED_REVIEW_ONLY',sha256:crypto.createHash('sha256').update(sql).digest('hex'),target_tables:19,protected_tables:5}));
