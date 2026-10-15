-- TEST ONLY: sliplpsec-test, do not execute against Production without
-- backups, duplicate audits, coordinated deployment and explicit authorization.
--
-- Transaction-scoped advisory lock serializes stage and publish for one
-- (year, month) across all serverless instances.
--
-- This is SECURITY INVOKER; only service_role may call these RPCs. The app's
-- admin cookie is checked before the privileged server invokes them.

begin;

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

commit;
