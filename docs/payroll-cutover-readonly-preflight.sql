-- Payroll cutover PRE-FLIGHT: read-only SQL, verified on 2026-10-16.
-- Compatible with sliplpsec-test and existing Production schemas.
-- Does NOT display names, account numbers, PDF bytes or private file paths.
-- A successful database query is NOT a GO decision: verify independent
-- restorable backups, private PDF.js tests, secrets, live API integration,
-- Storage policy scope and explicit Production change approval separately.
-- Do not modify Production or attach real payroll data to GitHub Actions.

WITH duplicate_slips AS (
  SELECT COUNT(*) AS groups_count FROM (
    SELECT 1 FROM public.slips
    GROUP BY bank_account, month, year HAVING COUNT(*) > 1
  ) d
), duplicate_histories AS (
  SELECT COUNT(*) AS groups_count FROM (
    SELECT 1 FROM public.upload_history
    GROUP BY month, year HAVING COUNT(*) > 1
  ) d
)
SELECT
  (SELECT COUNT(*) FROM public.slips) AS slips_total,
  (SELECT COUNT(*) FROM public.upload_history) AS history_total,
  (SELECT groups_count FROM duplicate_slips) AS duplicate_slip_groups,
  (SELECT groups_count FROM duplicate_histories) AS duplicate_history_groups,
  (SELECT COUNT(*) FROM public.slips WHERE bank_account IS NULL
     OR bank_account !~ '^[0-9]{10}$') AS invalid_account_rows,
  (SELECT COUNT(*) FROM public.slips WHERE pdf_base64 IS NULL
     OR LENGTH(pdf_base64) < 100) AS incomplete_pdf_rows,
  (SELECT rowsecurity FROM pg_catalog.pg_tables
     WHERE schemaname='public' AND tablename='slips') AS slips_rls_enabled,
  (SELECT rowsecurity FROM pg_catalog.pg_tables
     WHERE schemaname='public' AND tablename='upload_history') AS history_rls_enabled,
  has_table_privilege('anon','public.slips','SELECT') AS anon_slips_read,
  has_table_privilege('anon','public.slips','INSERT') AS anon_slips_insert,
  has_table_privilege('anon','public.slips','UPDATE') AS anon_slips_update,
  has_table_privilege('anon','public.slips','DELETE') AS anon_slips_delete,
  has_table_privilege('anon','public.upload_history','SELECT') AS anon_history_read,
  has_table_privilege('anon','public.upload_history','INSERT') AS anon_history_insert,
  has_table_privilege('anon','public.upload_history','UPDATE') AS anon_history_update,
  has_table_privilege('anon','public.upload_history','DELETE') AS anon_history_delete,
  (SELECT public FROM storage.buckets WHERE id='slips') AS slips_bucket_public,
  (SELECT COUNT(*) FROM storage.objects WHERE bucket_id='slips') AS storage_object_count,
  (SELECT COUNT(*) FROM public.upload_history h
     WHERE h.storage_path IS NOT NULL AND BTRIM(h.storage_path)<>'') AS history_storage_references,
  (SELECT COUNT(*) FROM public.upload_history h
     WHERE h.storage_path IS NOT NULL AND BTRIM(h.storage_path)<>''
     AND NOT EXISTS (SELECT 1 FROM storage.objects o
       WHERE o.bucket_id='slips' AND o.name=h.storage_path)) AS unmatched_storage_references,
  (SELECT COUNT(*) FROM pg_catalog.pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND 'public'=ANY(roles)) AS public_storage_object_policy_count;
