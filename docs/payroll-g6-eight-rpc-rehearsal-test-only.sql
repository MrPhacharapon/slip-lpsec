-- G6: Synthetic eight-RPC transaction test against isolated Supabase TEST ONLY.
-- Project: dpaqvxtbpaduknergflm. DO NOT RUN ON PRODUCTION.
-- This test MUST finish with ROLLBACK and must not read production personnel.
-- Ensure Test slips/history/Storage are empty; no PDF source bytes are needed.
-- Do not use this script as evidence for real Next.js/Storage/Google end-to-end.
BEGIN;
DO $$
DECLARE
  v_hash text := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  v_inserted integer;
  v_preview jsonb;
  v_history_id uuid;
  v_created timestamptz;
  v_rejected boolean;
BEGIN
  IF (SELECT count(*) FROM public.slips)<>0 OR
     (SELECT count(*) FROM public.upload_history)<>0 OR
     (SELECT count(*) FROM storage.objects WHERE bucket_id='slips')<>0 OR
     (SELECT public FROM storage.buckets WHERE id='slips') IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'Isolated Test sandbox is not empty or private'; END IF;

  IF public.check_payroll_rate_limit(v_hash,600,1) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'First rate-limit request rejected'; END IF;
  IF public.check_payroll_rate_limit(v_hash,600,1) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'Second rate-limit request not blocked'; END IF;

  SELECT public.stage_payroll_slips('พฤศจิกายน','2569',
    jsonb_build_array(jsonb_build_object(
      'name','SYNTHETIC PAYROLL ONLY','bank_account','0000000000',
      'month','พฤศจิกายน','year','2569','pdf_base64',repeat('A',120)
    ))) INTO v_inserted;
  IF v_inserted<>1 THEN RAISE EXCEPTION 'Stage failed'; END IF;

  SELECT public.inspect_unpublished_payroll_period('พฤศจิกายน','2569')
  INTO v_preview;
  IF (v_preview->>'published')::boolean IS DISTINCT FROM false OR
     (v_preview->>'stagedCount')::integer<>1 OR
     v_preview->>'snapshot' IS NULL
  THEN RAISE EXCEPTION 'Unpublished preview failed'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.discard_unpublished_payroll_period(
      'พฤศจิกายน','2569',1,repeat('0',64));
  EXCEPTION WHEN SQLSTATE '40001' THEN v_rejected:=true;
  END;
  IF NOT v_rejected OR
     (SELECT count(*) FROM public.slips WHERE month='พฤศจิกายน')<>1
  THEN RAISE EXCEPTION 'Stale staged snapshot did not fail closed'; END IF;

  IF public.discard_unpublished_payroll_period(
      'พฤศจิกายน','2569',1,v_preview->>'snapshot')<>1
  THEN RAISE EXCEPTION 'Staged discard failed'; END IF;

  SELECT public.stage_payroll_slips('ธันวาคม','2569',
    jsonb_build_array(jsonb_build_object(
      'name','SYNTHETIC PAYROLL ONLY','bank_account','0000000000',
      'month','ธันวาคม','year','2569','pdf_base64',repeat('B',120)
    ))) INTO v_inserted;
  IF v_inserted<>1 THEN RAISE EXCEPTION 'Second stage failed'; END IF;
  IF public.publish_payroll_period('ธันวาคม','2569','SYNTHETIC-ONLY.pdf',1)
       IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Publish failed'; END IF;

  SELECT id,created_at INTO v_history_id,v_created
    FROM public.upload_history WHERE month='ธันวาคม' AND year='2569';
  IF v_history_id IS NULL THEN RAISE EXCEPTION 'Published history missing'; END IF;

  SELECT public.inspect_unpublished_payroll_period('ธันวาคม','2569')
  INTO v_preview;
  IF (v_preview->>'published')::boolean IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Published state missing'; END IF;

  IF public.reorder_payroll_history(ARRAY[v_history_id::text])
       IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Reorder RPC failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.upload_history WHERE id=v_history_id
       AND created_at=v_created AND display_order=0)
  THEN RAISE EXCEPTION 'Reorder altered history timestamp'; END IF;

  SELECT public.inspect_published_payroll_deletion(
    v_history_id,'ธันวาคม','2569') INTO v_preview;
  IF (v_preview->>'eligible')::boolean IS DISTINCT FROM true OR
     (v_preview->>'slipCount')::integer<>1 OR
     v_preview->>'snapshot' IS NULL
  THEN RAISE EXCEPTION 'Published preview failed'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.delete_published_payroll_period(
      v_history_id,'ธันวาคม','2569',1,repeat('0',64));
  EXCEPTION WHEN SQLSTATE '40001' THEN v_rejected:=true;
  END;
  IF NOT v_rejected OR
     (SELECT count(*) FROM public.slips WHERE month='ธันวาคม')<>1
  THEN RAISE EXCEPTION 'Stale published snapshot did not fail closed'; END IF;

  IF public.delete_published_payroll_period(
    v_history_id,'ธันวาคม','2569',1,v_preview->>'snapshot')<>1
  THEN RAISE EXCEPTION 'Published cleanup RPC failed'; END IF;
  IF (SELECT count(*) FROM public.slips)<>0 OR
     (SELECT count(*) FROM public.upload_history)<>0
  THEN RAISE EXCEPTION 'Published cleanup left rows'; END IF;
END $$;
ROLLBACK;
