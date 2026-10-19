-- PRODUCTION CANDIDATE ONLY. DO NOT RUN WITHOUT EXPLICIT G6 APPROVAL.
-- Prepared from the already-tested isolated Supabase Test schema.
-- This migration does NOT delete rows from public.slips or public.upload_history,
-- and does NOT delete Storage objects. It creates guarded deletion RPC definitions,
-- but it never invokes them.
--
-- Coordinated cutover requirement: apply only with the reviewed server-only app
-- release. The currently deployed legacy browser client depends on public access.
-- G4 database backup was waived by operator; therefore any unexpected precondition
-- must abort before this migration is started.

BEGIN;

-- Core payroll tables become server-only. No anon/authenticated policies are added.
ALTER TABLE public.slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slips FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.upload_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.slips TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.upload_history TO service_role;

-- Production preflight already verified zero duplicate owner-period/history groups.
CREATE UNIQUE INDEX IF NOT EXISTS slips_unique_owner_period
  ON public.slips(bank_account, month, year);
CREATE UNIQUE INDEX IF NOT EXISTS history_unique_period
  ON public.upload_history(month, year);

-- Preserve real created_at audit timestamps. Existing rows intentionally remain NULL
-- until an Admin explicitly reorders the complete history set.
ALTER TABLE public.upload_history
  ADD COLUMN IF NOT EXISTS display_order integer;

-- Shared server-side rate limiting. No raw account number or IP is stored here.
create table if not exists public.payroll_request_limits (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  bucket_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (key_hash, bucket_started_at)
);

alter table public.payroll_request_limits enable row level security;
revoke all on table public.payroll_request_limits from public, anon, authenticated;
grant select, insert, update, delete on public.payroll_request_limits to service_role;

create or replace function public.check_payroll_rate_limit(
  p_key_hash text,
  p_window_seconds integer,
  p_max_requests integer
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or
     p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 3600 or
     p_max_requests is null or p_max_requests < 1 or p_max_requests > 1000 then
    return false;
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.payroll_request_limits (key_hash, bucket_started_at, request_count)
  values (p_key_hash, v_bucket, 1)
  on conflict (key_hash, bucket_started_at)
  do update set request_count = public.payroll_request_limits.request_count + 1
  returning request_count into v_count;

  -- Same function call and transaction: counter increments are atomic even across
  -- different Next.js instances. The application denies after the quota.
  return v_count <= p_max_requests;
end;
$function$;

revoke all on function public.check_payroll_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.check_payroll_rate_limit(text,integer,integer) to service_role;

-- Transactional stage/publish RPCs.
create or replace function public.stage_payroll_slips(
  p_month text,
  p_year text,
  p_rows jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_inserted integer;
  v_existing integer;
begin
  if p_month is null or p_month not in (
      'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
    ) or p_year is null or p_year !~ '^25[0-9]{2}$'
    or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array'
    or pg_catalog.jsonb_array_length(p_rows) not between 1 and 8
  then
    raise exception 'invalid payroll stage request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_year || ':' || p_month, 781345)
  );

  if exists (
    select 1 from public.upload_history where month = p_month and year = p_year
  ) then
    raise exception 'payroll period already published' using errcode = '23505';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_rows) as r(
      name text, bank_account text, month text, year text, pdf_base64 text
    )
    where r.month is distinct from p_month
       or r.year is distinct from p_year
       or r.name is null or pg_catalog.length(pg_catalog.btrim(r.name)) = 0
       or pg_catalog.length(r.name) > 200
       or r.bank_account is null or r.bank_account !~ '^[0-9]{10}$'
       or r.pdf_base64 is null or pg_catalog.length(r.pdf_base64) > 1500000
       or pg_catalog.length(r.pdf_base64) < 100
  ) then
    raise exception 'invalid payroll stage rows' using errcode = '22023';
  end if;

  -- Publication accepts no more than 500 total slips per period. Enforce
  -- the SAME cap during staging, while holding the period advisory lock, so
  -- direct API batches cannot accumulate rows that cannot be published.
  select pg_catalog.count(*)::integer into v_existing
  from public.slips where month = p_month and year = p_year;
  if v_existing + pg_catalog.jsonb_array_length(p_rows) > 500 then
    raise exception 'payroll period has too many staged slips' using errcode = '22023';
  end if;

  insert into public.slips(name, bank_account, month, year, pdf_base64)
  select r.name, r.bank_account, r.month, r.year, r.pdf_base64
  from pg_catalog.jsonb_to_recordset(p_rows) as r(
    name text, bank_account text, month text, year text, pdf_base64 text
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$fn$;

create or replace function public.publish_payroll_period(
  p_month text,
  p_year text,
  p_file_name text,
  p_expected_count integer
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_count integer;
  v_unique integer;
begin
  if p_month is null or p_month not in (
      'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
    ) or p_year is null or p_year !~ '^25[0-9]{2}$'
    or p_file_name is null or pg_catalog.length(p_file_name) > 200
    or pg_catalog.lower(pg_catalog.right(p_file_name, 4)) <> '.pdf'
    or p_expected_count is null or p_expected_count not between 1 and 500
  then
    raise exception 'invalid payroll publish request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_year || ':' || p_month, 781345)
  );
  if exists (
    select 1 from public.upload_history where month = p_month and year = p_year
  ) then
    raise exception 'payroll period already published' using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct bank_account)::integer
  into v_count, v_unique
  from public.slips
  where month = p_month and year = p_year;

  if v_count <> p_expected_count or v_unique <> p_expected_count then
    raise exception 'payroll publish count mismatch' using errcode = '22023';
  end if;

  insert into public.upload_history(month, year, file_name, storage_path)
  values(p_month, p_year, p_file_name, null);
  return true;
end;
$fn$;

revoke all on function public.stage_payroll_slips(text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.publish_payroll_period(text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.stage_payroll_slips(text,text,jsonb) to service_role;
grant execute on function public.publish_payroll_period(text,text,text,integer) to service_role;

-- Transactional recovery for unpublished staged rows.
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

-- Guarded published-period delete definitions. Merely creating these functions
-- performs no deletion.
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
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pdf_base64, 'UTF8')), 'hex'), E'\n' ORDER BY bank_account, id
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
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pdf_base64, 'UTF8')), 'hex'), E'\n' ORDER BY bank_account, id
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

-- Admin-only display ordering without modifying created_at.
ALTER TABLE public.upload_history
  ADD COLUMN IF NOT EXISTS display_order integer;

CREATE OR REPLACE FUNCTION public.reorder_payroll_history(p_ids text[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_existing integer;
  v_updated integer;
  v_requested integer;
BEGIN
  v_requested := pg_catalog.cardinality(p_ids);
  IF p_ids IS NULL OR v_requested NOT BETWEEN 1 AND 120 OR
     EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_ids) AS x(id)
       WHERE id IS NULL OR pg_catalog.length(id) > 100
     )
  THEN
    RAISE EXCEPTION 'invalid history order' USING errcode = '22023';
  END IF;

  -- Serialize competing reorders, then validate the entire set in one
  -- transaction. Never update created_at or expose account/PDF values.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payroll:history:display-order', 781345)
  );
  SELECT pg_catalog.count(*)::integer INTO v_existing FROM public.upload_history;
  IF v_existing <> v_requested OR
     (SELECT pg_catalog.count(DISTINCT id)::integer
        FROM pg_catalog.unnest(p_ids) AS x(id)) <> v_requested OR
     EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_ids) AS x(id)
       WHERE NOT EXISTS (SELECT 1 FROM public.upload_history h
                         WHERE h.id::text = x.id)
     )
  THEN
    RAISE EXCEPTION 'history changed; reload before sorting'
      USING errcode = '40001';
  END IF;

  UPDATE public.upload_history h
  SET display_order = (r.position - 1)::integer
  FROM pg_catalog.unnest(p_ids) WITH ORDINALITY AS r(id, position)
  WHERE h.id::text = r.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_requested THEN
    RAISE EXCEPTION 'history changed during reorder' USING errcode = '40001';
  END IF;
  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.reorder_payroll_history(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_payroll_history(text[])
  TO service_role;


-- Private original-PDF Storage. Keep every existing object in place.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf']::text[]
WHERE id = 'slips';

DROP POLICY IF EXISTS "allow_all 1t7jg3_0" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_1" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_2" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_3" ON storage.objects;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='slips' AND public=false)
  THEN RAISE EXCEPTION 'slips Storage bucket was not secured'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN ('slips','upload_history','payroll_request_limits')
      AND grantee IN ('anon','authenticated')
  ) THEN RAISE EXCEPTION 'public payroll table grants remain'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (
       'stage_payroll_slips','publish_payroll_period',
       'inspect_unpublished_payroll_period','discard_unpublished_payroll_period',
       'inspect_published_payroll_deletion','delete_published_payroll_period',
       'reorder_payroll_history','check_payroll_rate_limit'
      ) AND NOT p.prosecdef) <> 8
  THEN RAISE EXCEPTION 'expected eight SECURITY INVOKER payroll RPCs'; END IF;
END
$verify$;

COMMIT;
