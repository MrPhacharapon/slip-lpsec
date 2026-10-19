-- G6 isolated representative LEGACY schema rehearsal, SYNTHETIC DATA ONLY.
-- Supabase TEST project dpaqvxtbpaduknergflm. NOT FOR PRODUCTION.
-- Transaction ROLLBACK is compulsory; this does not rehearse app deployment,
-- the eight public RPCs, live Storage cutover, locks or a data backup.
-- Result must be followed by a separate query verifying schema absence.
BEGIN;
CREATE SCHEMA payroll_rehearsal_20261019_g6;
CREATE TABLE payroll_rehearsal_20261019_g6.slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT (timezone('utc',now())),
  name text, bank_account text NOT NULL, month text NOT NULL,
  year text NOT NULL, pdf_base64 text
);
CREATE TABLE payroll_rehearsal_20261019_g6.upload_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT (timezone('utc',now())),
  month text NOT NULL, year text NOT NULL, file_name text NOT NULL,
  storage_path text
);
INSERT INTO payroll_rehearsal_20261019_g6.slips
  (name,bank_account,month,year,pdf_base64)
VALUES ('SYNTHETIC ONLY','0000000000','มกราคม','2569',
        'SYNTHETIC-INVALID-PDF-NOT-USED');
INSERT INTO payroll_rehearsal_20261019_g6.upload_history
  (month,year,file_name)
VALUES ('มกราคม','2569','SYNTHETIC-NOT-A-REAL-PDF.pdf');

ALTER TABLE payroll_rehearsal_20261019_g6.upload_history
  ADD COLUMN display_order integer;
CREATE UNIQUE INDEX slips_unique_owner_period_rehearsal
  ON payroll_rehearsal_20261019_g6.slips(bank_account,month,year);
CREATE UNIQUE INDEX history_unique_period_rehearsal
  ON payroll_rehearsal_20261019_g6.upload_history(month,year);
CREATE TABLE payroll_rehearsal_20261019_g6.payroll_request_limits (
  key_hash text NOT NULL CHECK(key_hash ~ '^[0-9a-f]{64}$'),
  bucket_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK(request_count > 0),
  PRIMARY KEY(key_hash,bucket_started_at)
);
ALTER TABLE payroll_rehearsal_20261019_g6.slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_rehearsal_20261019_g6.upload_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_rehearsal_20261019_g6.payroll_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA payroll_rehearsal_20261019_g6
  FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA payroll_rehearsal_20261019_g6 TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE
  ON ALL TABLES IN SCHEMA payroll_rehearsal_20261019_g6 TO service_role;

DO $$
DECLARE n integer;
BEGIN
  IF NOT (SELECT bool_and(c.relrowsecurity)
       FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
       WHERE ns.nspname='payroll_rehearsal_20261019_g6'
         AND c.relname IN ('slips','upload_history','payroll_request_limits'))
  THEN RAISE EXCEPTION 'RLS regression'; END IF;
  IF has_table_privilege('anon','payroll_rehearsal_20261019_g6.slips','SELECT')
      OR has_table_privilege('authenticated',
         'payroll_rehearsal_20261019_g6.slips','DELETE')
      OR NOT has_table_privilege('service_role',
         'payroll_rehearsal_20261019_g6.slips','SELECT')
  THEN RAISE EXCEPTION 'ACL regression'; END IF;
  SELECT count(*) INTO n FROM payroll_rehearsal_20261019_g6.slips;
  IF n<>1 THEN RAISE EXCEPTION 'Existing synthetic slip changed'; END IF;
  SELECT count(*) INTO n FROM payroll_rehearsal_20261019_g6.upload_history;
  IF n<>1 THEN RAISE EXCEPTION 'Existing synthetic history changed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM payroll_rehearsal_20261019_g6.slips
    WHERE bank_account='0000000000' AND month='มกราคม' AND year='2569'
  ) THEN RAISE EXCEPTION 'Synthetic business key altered'; END IF;
  BEGIN
    INSERT INTO payroll_rehearsal_20261019_g6.slips
      (name,bank_account,month,year)
    VALUES ('DUPLICATE FICTIONAL','0000000000','มกราคม','2569');
    RAISE EXCEPTION 'Expected slip uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO payroll_rehearsal_20261019_g6.upload_history
      (month,year,file_name)
    VALUES('มกราคม','2569','DUPLICATE.pdf');
    RAISE EXCEPTION 'Expected history uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
ROLLBACK;
