// Exercise the real preservation fingerprint in isolated PostgreSQL, including rollback.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {assertReclamationScope,PROTECTED_RELATIONS,RECLAMATION_TABLES} from './phase0-storage-scope.mjs';
assertReclamationScope();assert.ok(PROTECTED_RELATIONS.every(t=>!RECLAMATION_TABLES.includes(t)));
const db=await PGlite.create();
try{
 await db.exec("CREATE ROLE anon; CREATE TABLE public.bol_events(id integer PRIMARY KEY,content text); INSERT INTO public.bol_events VALUES(1,'preserve Hebrew: בראשית');");
 await db.exec('BEGIN;');
 await db.exec(fs.readFileSync('scripts/reclamation-preservation.sql','utf8'));
 const state=async()=>(await db.query("SELECT pg_temp.phase0_relation_state('public.bol_events') AS state")).rows[0].state;
 const baseline=await state();const checks=[];
 for(const[name,sql]of [
  ['content',"UPDATE public.bol_events SET content='changed' WHERE id=1"],
  ['column','ALTER TABLE public.bol_events ADD COLUMN extra text'],
  ['constraint','ALTER TABLE public.bol_events ADD CONSTRAINT positive CHECK(id>0)'],
  ['index','CREATE INDEX sample_idx ON public.bol_events(content)'],
  ['rls','ALTER TABLE public.bol_events ENABLE ROW LEVEL SECURITY'],
  ['policy','CREATE POLICY sample_policy ON public.bol_events FOR SELECT USING(true)'],
  ['privileges','GRANT SELECT ON public.bol_events TO anon'],
  ['trigger',"CREATE FUNCTION public.sample_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER sample BEFORE UPDATE ON public.bol_events FOR EACH ROW EXECUTE FUNCTION public.sample_trigger()"],
 ]){
  await db.exec('SAVEPOINT mutation;');await db.exec(sql);assert.notDeepEqual(await state(),baseline,'Undetected '+name+' mutation');await db.exec('ROLLBACK TO SAVEPOINT mutation; RELEASE SAVEPOINT mutation;');assert.deepEqual(await state(),baseline,'Rollback did not preserve '+name);checks.push(name);
 }
 await db.exec('ROLLBACK;');assert.equal((await db.query('SELECT content FROM public.bol_events WHERE id=1')).rows[0].content,'preserve Hebrew: בראשית');
 const report={status:'PASS',detected_mutations:checks,rollback_verified:true,protected_scope_disjoint:true};fs.writeFileSync('.artifacts/phase0/preservation-guard-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.log(JSON.stringify({status:'FAIL',code:error.code,message:error.message}));process.exitCode=1;}finally{await db.close();}
