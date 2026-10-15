-- ONLY FOR THE ISOLATED sliplpsec-test DATABASE until separate Production approval.
-- Applied in a transaction; no real people, bank accounts or IPs are stored here.
-- The application sends HMAC-SHA256 digest keys, never the raw IP/account.
begin;

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

commit;

-- Test environment may periodically delete buckets older than one day.
-- Do not schedule an unreviewed database cleanup in Production.
