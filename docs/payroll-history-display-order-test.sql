-- TEST ONLY: sliplpsec-test. DO NOT apply to Production without an
-- approved schema cutover, restorable backup, and matching deployed app.
-- Display order must not overwrite the true created_at audit timestamp.
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
