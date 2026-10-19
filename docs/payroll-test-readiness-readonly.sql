-- READ-ONLY Supabase TEST readiness preflight for the payroll API.
-- Intended for project sliplpsec-test (dpaqvxtbpaduknergflm).
-- Never writes or reads individual names, account numbers or PDF content.
-- "schema_ready" does NOT imply actual Next.js -> Supabase Test integration
-- succeeded or Production is safe. Manual private credentials still required.
WITH
required_functions(signature) AS (
  VALUES
  ('public.check_payroll_rate_limit(text,integer,integer)'),
  ('public.stage_payroll_slips(text,text,jsonb)'),
  ('public.publish_payroll_period(text,text,text,integer)'),
  ('public.inspect_unpublished_payroll_period(text,text)'),
  ('public.discard_unpublished_payroll_period(text,text,integer,text)'),
  ('public.inspect_published_payroll_deletion(uuid,text,text)'),
  ('public.delete_published_payroll_period(uuid,text,text,integer,text)'),
  ('public.reorder_payroll_history(text[])')
),
function_checks AS (
  SELECT signature,
    p.oid IS NOT NULL AND NOT p.prosecdef
      AND has_function_privilege('service_role',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AS safe
  FROM required_functions r
  LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(r.signature)
),
required_columns(tablename,colname) AS (
  VALUES ('slips','id'),('slips','name'),('slips','bank_account'),
    ('slips','month'),('slips','year'),('slips','pdf_base64'),
    ('upload_history','id'),('upload_history','month'),('upload_history','year'),
    ('upload_history','file_name'),('upload_history','storage_path'),
    ('upload_history','created_at'),('upload_history','display_order'),
    ('payroll_request_limits','key_hash'),
    ('payroll_request_limits','bucket_started_at'),
    ('payroll_request_limits','request_count')
),
column_checks AS (
  SELECT r.tablename, r.colname, c.column_name IS NOT NULL AS present
  FROM required_columns r LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name=r.tablename
    AND c.column_name=r.colname
),
table_checks AS (
  SELECT c.relname,
    c.relrowsecurity
      AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('service_role',c.oid,'SELECT') AS safe
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
    ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
    ('slips','upload_history','payroll_request_limits')
),
unique_indexes AS (
  SELECT count(*) FILTER (WHERE idx.relname='slips_unique_owner_period'
    AND i.indisunique AND i.indisvalid
    AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(bank_account, month, year)%')=1
    AND count(*) FILTER (WHERE idx.relname='history_unique_period'
    AND i.indisunique AND i.indisvalid
    AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(month, year)%')=1 AS safe
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx
    ON idx.oid=i.indexrelid JOIN pg_catalog.pg_class tbl
    ON tbl.oid=i.indrelid JOIN pg_catalog.pg_namespace n
    ON n.oid=tbl.relnamespace
  WHERE n.nspname='public' AND tbl.relname IN ('slips','upload_history')
),
storage_check AS (
 SELECT (SELECT NOT b.public FROM storage.buckets b WHERE b.id='slips') AS private,
        (SELECT count(*) FROM storage.objects WHERE bucket_id='slips') AS objects
),
rows_check AS (
 SELECT (SELECT count(*) FROM public.slips) AS slips,
        (SELECT count(*) FROM public.upload_history) AS histories
)
SELECT
  (SELECT bool_and(safe) FROM function_checks) AS rpc_permission_ready,
  (SELECT bool_and(present) FROM column_checks) AS required_columns_ready,
  (SELECT count(*)=3 AND bool_and(safe) FROM table_checks) AS table_access_ready,
  (SELECT safe FROM unique_indexes) AS unique_index_ready,
  (SELECT private FROM storage_check) AS storage_private,
  (SELECT jsonb_build_object('slips',slips,'history',histories)
   FROM rows_check) AS row_counts_only,
  (SELECT objects FROM storage_check) AS storage_object_count,
  (SELECT coalesce(jsonb_agg(signature), '[]'::jsonb)
   FROM function_checks WHERE NOT coalesce(safe,false)) AS unsafe_or_missing_rpcs,
  (SELECT coalesce(jsonb_agg(tablename || '.' || colname),'[]'::jsonb)
   FROM column_checks WHERE NOT present) AS missing_columns,
  (SELECT coalesce(jsonb_agg(relname),'[]'::jsonb)
   FROM table_checks WHERE NOT safe) AS unsafe_tables,
  (
    (SELECT bool_and(safe) FROM function_checks)
    AND (SELECT bool_and(present) FROM column_checks)
    AND (SELECT count(*)=3 AND bool_and(safe) FROM table_checks)
    AND (SELECT safe FROM unique_indexes)
    AND (SELECT private FROM storage_check)
    AND (SELECT objects=0 FROM storage_check)
    AND (SELECT slips=0 AND histories=0 FROM rows_check)
  ) AS schema_ready;
