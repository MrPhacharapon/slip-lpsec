-- RELEASE AUDIT ONLY: non-destructive aggregate counters for G6/G7.
-- May be run read-only on Production and isolated Test; never prints payroll
-- names, bank accounts, PDF bytes, file object names, paths or tokens.
-- Snapshot metadata cannot establish PDF byte identity; do not delete the
-- 3 legacy unreferenced objects or interpret a matching eTag as a hash test.
WITH slip_periods AS (
  SELECT year, month, count(*)::integer AS n
  FROM public.slips GROUP BY year, month
), published AS (
  SELECT p.year, p.month, p.n,
    EXISTS(SELECT 1 FROM public.upload_history h
           WHERE h.year=p.year AND h.month=p.month) AS has_history
  FROM slip_periods p
), obj AS (
  SELECT o.name,
    CASE WHEN (o.metadata->>'size') ~ '^[0-9]+$'
         THEN (o.metadata->>'size')::bigint END AS bytes,
    o.metadata->>'eTag' AS etag,
    EXISTS(SELECT 1 FROM public.upload_history h
           WHERE h.storage_path=o.name) AS referenced
  FROM storage.objects o WHERE o.bucket_id='slips'
)
SELECT
  (SELECT count(*) FROM published) AS slip_period_count,
  (SELECT count(*) FROM published WHERE has_history) AS published_slip_period_count,
  (SELECT count(*) FROM published WHERE NOT has_history) AS staged_slip_period_count,
  (SELECT coalesce(sum(n),0) FROM published WHERE NOT has_history) AS staged_slips,
  (SELECT count(*) FROM public.upload_history h
   WHERE NOT EXISTS(SELECT 1 FROM public.slips s
                    WHERE s.month=h.month AND s.year=h.year)) AS histories_without_slips,
  (SELECT count(*) FROM obj) AS storage_total,
  (SELECT count(*) FROM obj WHERE referenced) AS storage_referenced,
  (SELECT count(*) FROM obj WHERE NOT referenced) AS storage_unreferenced,
  (SELECT count(distinct etag) FROM obj
   WHERE NOT referenced AND etag IS NOT NULL) AS unreferenced_distinct_metadata_etags,
  (SELECT count(*) FROM obj WHERE NOT referenced
   AND lower(name) LIKE '%.pdf') AS unreferenced_pdf_names,
  (SELECT coalesce(sum(bytes),0) FROM obj WHERE NOT referenced) AS unreferenced_declared_bytes,
  (SELECT count(distinct storage_path) FROM public.upload_history
   WHERE coalesce(btrim(storage_path),'')<>'') AS unique_history_storage_paths,
  (SELECT count(*) FROM public.upload_history h
   WHERE h.storage_path IS NOT NULL AND btrim(h.storage_path)<>''
     AND NOT EXISTS(SELECT 1 FROM obj o WHERE o.name=h.storage_path))
     AS history_paths_missing_objects;
