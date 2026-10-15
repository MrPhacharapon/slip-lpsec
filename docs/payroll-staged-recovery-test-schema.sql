-- TEST ONLY: sliplpsec-test. No Production schema, data, or Storage changes.
-- Admin must preview the snapshot and explicitly confirm before discarding
-- an UNPUBLISHED staged period. The database lock is shared by stage/publish.
BEGIN;

CREATE OR REPLACE FUNCTION public.inspect_unpublished_payroll_period(
  p_month text, p_year text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  v_published boolean;
  v_count integer;
  v_snapshot text;
BEGIN
  IF p_month IS NULL OR p_month NOT IN (
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
  ) OR p_year IS NULL OR p_year !~ '^25[0-9]{2}$' THEN
    RAISE EXCEPTION 'invalid payroll period' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_year || ':' || p_month, 781345)
  );
  SELECT EXISTS (
    SELECT 1 FROM public.upload_history WHERE month = p_month AND year = p_year
  ) INTO v_published;
  SELECT pg_catalog.count(*)::integer,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        COALESCE(pg_catalog.string_agg(
          id::text || ':' || bank_account, E'\n' ORDER BY bank_account, id
        ), ''), 'UTF8'
      )), 'hex')
    INTO v_count, v_snapshot
    FROM public.slips WHERE month = p_month AND year = p_year;

  RETURN pg_catalog.jsonb_build_object(
    'published', v_published, 'stagedCount', v_count,
    'snapshot', CASE WHEN v_count > 0 AND NOT v_published THEN v_snapshot ELSE NULL END
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.discard_unpublished_payroll_period(
  p_month text, p_year text,
  p_expected_count integer, p_expected_snapshot text
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  v_published boolean;
  v_count integer;
  v_snapshot text;
  v_deleted integer;
BEGIN
  IF p_month IS NULL OR p_month NOT IN (
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
  ) OR p_year IS NULL OR p_year !~ '^25[0-9]{2}$'
    OR p_expected_count IS NULL OR p_expected_count NOT BETWEEN 1 AND 500
    OR p_expected_snapshot IS NULL OR p_expected_snapshot !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid recovery confirmation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_year || ':' || p_month, 781345)
  );
  SELECT EXISTS (
    SELECT 1 FROM public.upload_history WHERE month = p_month AND year = p_year
  ) INTO v_published;
  IF v_published THEN
    RAISE EXCEPTION 'published period cannot be discarded' USING ERRCODE = '23505';
  END IF;

  SELECT pg_catalog.count(*)::integer,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        COALESCE(pg_catalog.string_agg(
          id::text || ':' || bank_account, E'\n' ORDER BY bank_account, id
        ), ''), 'UTF8'
      )), 'hex')
    INTO v_count, v_snapshot
    FROM public.slips WHERE month = p_month AND year = p_year;

  IF v_count IS DISTINCT FROM p_expected_count
      OR v_snapshot IS DISTINCT FROM p_expected_snapshot THEN
    RAISE EXCEPTION 'staged rows changed since preview' USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.slips WHERE month = p_month AND year = p_year;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_count THEN
    RAISE EXCEPTION 'staged recovery row count mismatch' USING ERRCODE = '40001';
  END IF;
  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.inspect_unpublished_payroll_period(text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_unpublished_payroll_period(text,text,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_unpublished_payroll_period(text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_unpublished_payroll_period(text,text,integer,text)
  TO service_role;
COMMIT;
