-- READ ONLY: run on Supabase Test and Production to compare legacy
-- column compatibility, constraints and privacy posture before cutover.
-- Tested 2026-10-18; this does not replace DB+Storage restore, private
-- API integration, real PDFs, or approval. Does not print any personal data.
WITH required(table_name,column_name,udt_name,nullable) AS (
 VALUES
 ('slips','id','uuid','NO'),
 ('slips','created_at','timestamptz','NO'),
 ('slips','name','text','YES'),
 ('slips','bank_account','text','NO'),
 ('slips','month','text','NO'),
 ('slips','year','text','NO'),
 ('slips','pdf_base64','text','NO'),
 ('upload_history','id','uuid','NO'),
 ('upload_history','created_at','timestamptz','NO'),
 ('upload_history','month','text','NO'),
 ('upload_history','year','text','NO'),
 ('upload_history','file_name','text','NO'),
 ('upload_history','storage_path','text','YES')
),
matched AS (
 SELECT r.table_name,r.column_name,
        coalesce(c.udt_name=r.udt_name AND c.is_nullable=r.nullable,false) as correct
 FROM required r LEFT JOIN information_schema.columns c
   ON c.table_schema='public' AND c.table_name=r.table_name
      AND c.column_name=r.column_name
),
tables AS (
 SELECT c.oid,c.relname,c.relrowsecurity
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('slips','upload_history') AND c.relkind='r'
),
duplicates AS (
 SELECT (SELECT count(*) FROM (SELECT 1 FROM public.slips GROUP BY bank_account,month,year HAVING count(*)>1) d) AS slips,
        (SELECT count(*) FROM (SELECT 1 FROM public.upload_history GROUP BY month,year HAVING count(*)>1) d) AS history
),
storage_snapshot AS (
 SELECT count(*) AS objects,
 count(*) FILTER(WHERE EXISTS (SELECT 1 FROM public.upload_history h WHERE h.storage_path=o.name)) AS referenced,
 count(*) FILTER(WHERE NOT EXISTS (SELECT 1 FROM public.upload_history h WHERE h.storage_path=o.name)) AS unreferenced
 FROM storage.objects o WHERE o.bucket_id='slips'
)
SELECT
 (SELECT count(*)=13 AND bool_and(correct) FROM matched) AS legacy_columns_compatible,
 (SELECT count(*)=2 FROM tables) AS both_base_tables_present,
 (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN tables b ON b.oid=t.tgrelid WHERE NOT t.tgisinternal) AS custom_trigger_count,
 (SELECT count(*) FROM pg_catalog.pg_constraint k JOIN tables b ON b.oid=k.conrelid WHERE k.contype='f') AS foreign_key_count,
 (SELECT slips FROM duplicates) AS duplicate_slip_groups,
 (SELECT history FROM duplicates) AS duplicate_history_groups,
 (SELECT bool_and(relrowsecurity) FROM tables) AS payroll_tables_rls_enabled,
 (SELECT bool_and(NOT has_table_privilege('anon',oid,'SELECT') AND NOT has_table_privilege('anon',oid,'INSERT') AND NOT has_table_privilege('anon',oid,'UPDATE') AND NOT has_table_privilege('anon',oid,'DELETE')) FROM tables) AS anonymous_table_access_revoked,
 (SELECT public=false FROM storage.buckets WHERE id='slips') AS storage_bucket_private,
 (SELECT objects FROM storage_snapshot) AS storage_total,
 (SELECT referenced FROM storage_snapshot) AS storage_history_linked,
 (SELECT unreferenced FROM storage_snapshot) AS storage_without_history,
 (SELECT count(*) FROM public.upload_history h WHERE h.storage_path IS NOT NULL AND btrim(h.storage_path)<>'' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='slips' AND o.name=h.storage_path)) AS history_missing_storage;
