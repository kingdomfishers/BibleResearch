-- Included by build-reclamation-approval.mjs. Session-local state only.
CREATE TEMP TABLE phase0_preserved_relations (relation text PRIMARY KEY, state jsonb NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.phase0_relation_state(p_relation regclass) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $state$
DECLARE v_content jsonb; v_schema jsonb;
BEGIN
  EXECUTE format('SELECT jsonb_build_object(''rows'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') h FROM %s t)x',p_relation) INTO v_content;
  SELECT jsonb_build_object(
    'relation',jsonb_build_object('owner',pg_get_userbyid(c.relowner),'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'kind',c.relkind,'options',c.reloptions),
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'collation',a.attcollation::regcollation::text,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid,true),'validated',convalidated,'deferrable',condeferrable,'deferred',condeferred) ORDER BY conname),'[]'::jsonb) FROM pg_constraint WHERE conrelid=c.oid),
    'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname),'[]'::jsonb) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'internal',tgisinternal,'definition',pg_get_triggerdef(oid,true)) ORDER BY tgname),'[]'::jsonb) FROM pg_trigger WHERE tgrelid=c.oid),
    'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY policyname),'[]'::jsonb) FROM pg_policies p WHERE schemaname=n.nspname AND tablename=c.relname),
    'privileges',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY grantee,privilege_type),'[]'::jsonb) FROM information_schema.table_privileges p WHERE table_schema=n.nspname AND table_name=c.relname)
  ) INTO v_schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=p_relation;
  IF v_content IS NULL OR v_schema IS NULL THEN RAISE EXCEPTION 'Cannot fingerprint %',p_relation; END IF;
  RETURN jsonb_build_object('content',v_content,'schema',v_schema);
END;
$state$;
