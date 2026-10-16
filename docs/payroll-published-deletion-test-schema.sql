-- TEST PROJECT ONLY: sliplpsec-test (dpaqvxtbpaduknergflm)
-- Do not apply to Production without backup, review and separate authorization.
--
-- Deletes only a PUBLISHED month with exactly one history entry, 1..500 slips,
-- NO original file path in Storage, and a matching admin preview snapshot.
-- Shared advisory lock with stage/publish/staged recovery prevents TOCTOU
-- across app operations that use these transaction-safe RPCs.
-- Not a replacement for taking an independently restorable backup.
BEGIN;

CREATE OR REPLACE FUNCTION public.inspect_published_payroll_deletion(
  p_id uuid, p_month text, p_year text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  v_history public.upload_history%ROWTYPE;
  v_count integer;
  v_histories integer;
  v_unique integer;
  v_snapshot text;
  v_storage_protected boolean;
  v_eligible boolean;
BEGIN
  IF p_id IS NULL OR p_month IS NULL OR p_month NOT IN (
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
  ) OR p_year IS NULL OR p_year !~ '^25[0-9]{2}$' THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_year || ':' || p_month, 781345)
  );
  SELECT * INTO v_history FROM public.upload_history
  WHERE id=p_id AND month=p_month AND year=p_year;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published history not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_histories
  FROM public.upload_history WHERE month=p_month AND year=p_year;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(DISTINCT bank_account)::integer,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           COALESCE(pg_catalog.string_agg(
             id::text || ':' || COALESCE(bank_account,'') || ':' ||
             pg_catalog.md5(pdf_base64), E'\n' ORDER BY bank_account, id
           ), ''), 'UTF8'
         )), 'hex')
    INTO v_count, v_unique, v_snapshot
    FROM public.slips WHERE month=p_month AND year=p_year;

  v_storage_protected := v_history.storage_path IS NOT NULL
                         AND pg_catalog.btrim(v_history.storage_path) <> '';
  v_eligible := v_histories=1 AND v_count BETWEEN 1 AND 500
                AND v_unique=v_count AND NOT v_storage_protected;
  RETURN pg_catalog.jsonb_build_object(
    'published',true,'slipCount',v_count,'historyCount',v_histories,
    'storageProtected',v_storage_protected,'eligible',v_eligible,
    'snapshot', CASE WHEN v_eligible THEN pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        p_id::text || ':' || p_month || ':' || p_year || ':' ||
        COALESCE(v_history.file_name,'') || ':' ||
        v_history.created_at::text || ':' || v_snapshot,
        'UTF8'
      )), 'hex') ELSE NULL END
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.delete_published_payroll_period(
  p_id uuid, p_month text, p_year text,
  p_expected_count integer, p_expected_snapshot text
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  v_history public.upload_history%ROWTYPE;
  v_count integer;
  v_histories integer;
  v_unique integer;
  v_digest text;
  v_snapshot text;
  v_deleted integer;
  v_history_deleted integer;
BEGIN
  IF p_id IS NULL OR p_month IS NULL OR p_month NOT IN (
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
  ) OR p_year IS NULL OR p_year !~ '^25[0-9]{2}$'
    OR p_expected_count IS NULL OR p_expected_count NOT BETWEEN 1 AND 500
    OR p_expected_snapshot IS NULL OR p_expected_snapshot !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid deletion confirmation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_year || ':' || p_month, 781345)
  );
  -- Row locks also serialize with direct history reorder/update requests
  -- which do not use the period advisory lock yet.
  SELECT * INTO v_history FROM public.upload_history
  WHERE id=p_id AND month=p_month AND year=p_year FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published history not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.slips
    WHERE month=p_month AND year=p_year ORDER BY id FOR UPDATE;
  IF v_history.storage_path IS NOT NULL
      AND pg_catalog.btrim(v_history.storage_path) <> '' THEN
    RAISE EXCEPTION 'original Storage file must be reviewed separately'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_histories
  FROM public.upload_history WHERE month=p_month AND year=p_year;
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(DISTINCT bank_account)::integer,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           COALESCE(pg_catalog.string_agg(
             id::text || ':' || COALESCE(bank_account,'') || ':' ||
             pg_catalog.md5(pdf_base64), E'\n' ORDER BY bank_account, id
           ), ''), 'UTF8'
         )), 'hex')
    INTO v_count, v_unique, v_digest
    FROM public.slips WHERE month=p_month AND year=p_year;

  IF v_histories <> 1 OR v_count <> p_expected_count OR v_unique <> v_count THEN
    RAISE EXCEPTION 'published period count changed' USING ERRCODE = '40001';
  END IF;

  v_snapshot := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    p_id::text || ':' || p_month || ':' || p_year || ':' ||
    COALESCE(v_history.file_name,'') || ':' ||
    v_history.created_at::text || ':' || v_digest,
    'UTF8'
  )), 'hex');
  IF v_snapshot IS DISTINCT FROM p_expected_snapshot THEN
    RAISE EXCEPTION 'published period changed since preview' USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.slips WHERE month=p_month AND year=p_year;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  IF v_deleted <> v_count THEN
    RAISE EXCEPTION 'slip deletion count mismatch' USING ERRCODE = '40001';
  END IF;
  DELETE FROM public.upload_history WHERE id=p_id AND month=p_month AND year=p_year;
  GET DIAGNOSTICS v_history_deleted=ROW_COUNT;
  IF v_history_deleted <> 1 THEN
    RAISE EXCEPTION 'history deletion count mismatch' USING ERRCODE = '40001';
  END IF;
  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.inspect_published_payroll_deletion(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_published_payroll_period(uuid,text,text,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_published_payroll_deletion(uuid,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_published_payroll_period(uuid,text,text,integer,text)
  TO service_role;
COMMIT;
