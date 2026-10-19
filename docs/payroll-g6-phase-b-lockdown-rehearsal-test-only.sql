-- TEST ONLY. Simulate the legacy public security posture inside one
-- transaction, apply the same Phase-B lockdown statements, verify, then ROLLBACK.
-- No Test payroll rows/Storage objects are created or deleted.
BEGIN;

ALTER TABLE public.slips DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_history DISABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.slips TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.upload_history TO anon,authenticated;

UPDATE storage.buckets
SET public=true,file_size_limit=NULL,allowed_mime_types=NULL
WHERE id='slips';

DROP POLICY IF EXISTS "allow_all 1t7jg3_0" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_1" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_2" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_3" ON storage.objects;
CREATE POLICY "allow_all 1t7jg3_0" ON storage.objects
  FOR SELECT TO public USING (bucket_id='slips');
CREATE POLICY "allow_all 1t7jg3_1" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id='slips');
CREATE POLICY "allow_all 1t7jg3_2" ON storage.objects
  FOR UPDATE TO public USING (bucket_id='slips') WITH CHECK (bucket_id='slips');
CREATE POLICY "allow_all 1t7jg3_3" ON storage.objects
  FOR DELETE TO public USING (bucket_id='slips');

-- Negative drift check: an unexpected fifth public policy must trigger the
-- same fail-closed inventory condition used by Production Phase B.
CREATE POLICY "synthetic_unexpected_storage_policy" ON storage.objects
  FOR SELECT TO public USING (bucket_id='slips');
DO $drift$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'unexpected Storage policy drift was not rejected';
  END IF;
END
$drift$;
DROP POLICY "synthetic_unexpected_storage_policy" ON storage.objects;

-- Exact reviewed inventory now passes the Production Phase-B precheck.
DO $precheck$
BEGIN
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
$precheck$;

-- Same security-lockdown body as Production Phase B.
ALTER TABLE public.slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slips FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.upload_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payroll_request_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.slips TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.upload_history TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.payroll_request_limits TO service_role;
UPDATE storage.buckets
SET public=false,file_size_limit=10485760,
    allowed_mime_types=ARRAY['application/pdf']::text[]
WHERE id='slips';
DROP POLICY IF EXISTS "allow_all 1t7jg3_0" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_1" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_2" ON storage.objects;
DROP POLICY IF EXISTS "allow_all 1t7jg3_3" ON storage.objects;

DO $assert$
BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN
        ('slips','upload_history','payroll_request_limits')
        AND c.relrowsecurity) <> 3
  THEN RAISE EXCEPTION 'RLS rehearsal failed'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN ('slips','upload_history','payroll_request_limits')
      AND grantee IN ('anon','authenticated')
  ) THEN RAISE EXCEPTION 'grant rehearsal failed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id='slips'
      AND public=false AND file_size_limit=10485760
      AND allowed_mime_types=ARRAY['application/pdf']::text[]
  ) THEN RAISE EXCEPTION 'bucket rehearsal failed'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage'
      AND tablename='objects'
      AND policyname LIKE 'allow_all 1t7jg3_%'
  ) THEN RAISE EXCEPTION 'policy rehearsal failed'; END IF;
END
$assert$;

ROLLBACK;
