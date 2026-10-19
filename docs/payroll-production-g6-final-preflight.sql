-- READ ONLY. Safe Production preflight for the candidate G6 migration.
-- Returns aggregate/schema metadata only; no names, account numbers, PDFs or paths.
WITH duplicate_slips AS (
  SELECT count(*)::int groups FROM (
    SELECT bank_account,month,year FROM public.slips
    GROUP BY 1,2,3 HAVING count(*)>1
  ) x
), duplicate_history AS (
  SELECT count(*)::int groups FROM (
    SELECT month,year FROM public.upload_history
    GROUP BY 1,2 HAVING count(*)>1
  ) x
), periods AS (
  SELECT coalesce(max(c),0)::int max_slips_per_period FROM (
    SELECT count(*) c FROM public.slips GROUP BY month,year
  ) x
), validity AS (
  SELECT
    count(*)::int slip_rows,
    count(*) FILTER (WHERE bank_account !~ '^[0-9]{10}$')::int invalid_accounts,
    count(*) FILTER (WHERE name IS NULL OR btrim(name)='')::int blank_names,
    count(*) FILTER (WHERE month NOT IN (
      'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
    ))::int invalid_months,
    count(*) FILTER (WHERE year !~ '^25[0-9]{2}$')::int invalid_years,
    max(length(pdf_base64))::int max_pdf_base64_chars
  FROM public.slips
), publication AS (
  SELECT
    count(*) FILTER (WHERE h.id IS NULL)::int slip_rows_without_history,
    count(DISTINCT (s.month,s.year)) FILTER (WHERE h.id IS NULL)::int staged_periods
  FROM public.slips s LEFT JOIN public.upload_history h USING(month,year)
), history_check AS (
  SELECT
    count(*) FILTER (WHERE s.month IS NULL)::int history_periods_without_slips,
    count(*) FILTER (WHERE h.storage_path IS NOT NULL AND btrim(h.storage_path)<>'')::int history_with_storage_path
  FROM public.upload_history h
  LEFT JOIN (SELECT DISTINCT month,year FROM public.slips) s USING(month,year)
), schema_state AS (
  SELECT
    count(*) FILTER (WHERE c.relname IN ('slips','upload_history') AND c.relrowsecurity)::int rls_enabled_payroll_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
), grants AS (
  SELECT count(*)::int anon_authenticated_grants
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name IN ('slips','upload_history')
    AND grantee IN ('anon','authenticated')
), storage_state AS (
  SELECT
    coalesce(bool_or(public),false) bucket_public,
    (SELECT count(*)::int FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND roles @> ARRAY['public']::name[]
       AND (qual LIKE '%slips%' OR with_check LIKE '%slips%')) public_slips_policies
  FROM storage.buckets WHERE id='slips'
)
SELECT jsonb_build_object(
  'slipRows',(SELECT slip_rows FROM validity),
  'invalidAccounts',(SELECT invalid_accounts FROM validity),
  'blankNames',(SELECT blank_names FROM validity),
  'invalidMonths',(SELECT invalid_months FROM validity),
  'invalidYears',(SELECT invalid_years FROM validity),
  'maxPdfBase64Chars',(SELECT max_pdf_base64_chars FROM validity),
  'duplicateSlipGroups',(SELECT groups FROM duplicate_slips),
  'duplicateHistoryGroups',(SELECT groups FROM duplicate_history),
  'maxSlipsPerPeriod',(SELECT max_slips_per_period FROM periods),
  'slipRowsWithoutHistory',(SELECT slip_rows_without_history FROM publication),
  'stagedPeriods',(SELECT staged_periods FROM publication),
  'historyPeriodsWithoutSlips',(SELECT history_periods_without_slips FROM history_check),
  'historyWithStoragePath',(SELECT history_with_storage_path FROM history_check),
  'rlsEnabledPayrollTables',(SELECT rls_enabled_payroll_tables FROM schema_state),
  'anonAuthenticatedGrantRows',(SELECT anon_authenticated_grants FROM grants),
  'storageBucketPublic',(SELECT bucket_public FROM storage_state),
  'publicStoragePolicyCount',(SELECT public_slips_policies FROM storage_state)
) AS g6_preflight;
