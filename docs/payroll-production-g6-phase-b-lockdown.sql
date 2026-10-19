-- G6 PHASE B: SECURITY LOCKDOWN.
-- Production candidate only. Requires explicit coordinated cutover approval.
-- Run ONLY after Phase A, a staged Production deployment, and private smoke
-- checks have passed. Once this phase commits, do NOT roll back to the legacy
-- browser app by reopening payroll data or Storage to public access.
-- This phase does not delete payroll rows or Storage objects.

BEGIN;

DO $precheck_phase_b$
BEGIN
  IF to_regclass('public.payroll_request_limits') IS NULL
  THEN RAISE EXCEPTION 'Phase A missing payroll_request_limits'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='upload_history'
      AND column_name='display_order'
  ) THEN RAISE EXCEPTION 'Phase A missing display_order'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (
        'stage_payroll_slips','publish_payroll_period',
        'inspect_unpublished_payroll_period','discard_unpublished_payroll_period',
        'inspect_published_payroll_deletion','delete_published_payroll_period',
        'reorder_payroll_history','check_payroll_rate_limit'
      ) AND NOT p.prosecdef) <> 8
  THEN RAISE EXCEPTION 'Phase A RPC set incomplete'; END IF;

  -- Fail closed if Storage ACLs drift from the exact reviewed legacy state.
  -- Do not guess which unexpected policy is safe to remove.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='slips')
  THEN RAISE EXCEPTION 'slips Storage bucket missing'; END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects') <> 4
     OR EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname='storage' AND tablename='objects'
         AND policyname NOT IN (
           'allow_all 1t7jg3_0','allow_all 1t7jg3_1',
           'allow_all 1t7jg3_2','allow_all 1t7jg3_3'
         )
     )
  THEN RAISE EXCEPTION 'Storage policy inventory changed; re-review before lockdown'; END IF;
END
$precheck_phase_b$;

ALTER TABLE public.slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_request_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.slips FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.upload_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payroll_request_limits FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.slips TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.upload_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payroll_request_limits TO service_role;

UPDATE storage.buckets
SET public=false,
    file_size_limit=10485760,
    allowed_mime_types=ARRAY['application/pdf']::text[]
WHERE id='slips';

DROP POLICY IF EXISTS "allow_all 1t7jg3_0" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_1" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_2" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_3" ON storage.objects;

DO $verify_phase_b$
BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN
        ('slips','upload_history','payroll_request_limits')
        AND c.relrowsecurity) <> 3
  THEN RAISE EXCEPTION 'RLS lockdown incomplete'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN ('slips','upload_history','payroll_request_limits')
      AND grantee IN ('anon','authenticated')
  ) THEN RAISE EXCEPTION 'browser payroll grants remain'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id='slips' AND public=false AND file_size_limit=10485760
      AND allowed_mime_types=ARRAY['application/pdf']::text[]
  ) THEN RAISE EXCEPTION 'private PDF-only Storage lockdown incomplete'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
  ) THEN RAISE EXCEPTION 'Storage object policies remain after lockdown'; END IF;
END
$verify_phase_b$;

COMMIT;
