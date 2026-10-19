# G6 production candidate — current read-only findings

Prepared 19 October 2026. No Production writes, schema changes, Storage ACL
changes, merge or deployment were made while preparing this candidate.

Latest read-only Production aggregate before candidate rehearsal:
- 338 slip rows; 0 invalid 10-digit accounts; 0 blank names; 0 invalid month/year.
- 0 duplicate owner-period groups; 0 duplicate history-period groups.
- Maximum 38 slips in any period (well below the 500 hard cap).
- 0 staged periods / 0 slip rows without publication history.
- 0 history periods without slips.
- 9 upload-history rows reference an original Storage path.
- Both payroll tables still have RLS disabled and anon/authenticated still have
  broad table grants.
- Bucket `slips` is still public with the four legacy public policies.
- No Production RPCs from the secured branch exist yet.

Supabase Test reference state:
- RLS enabled on slips, upload_history and payroll_request_limits.
- No anon/authenticated policies on those three payroll tables.
- All eight RPCs are SECURITY INVOKER and executable only by service_role.
- Private `slips` bucket, 10 MiB PDF-only configuration.
- Security Advisor reports only informational "RLS enabled no policy" findings
  for the intentionally server-only Test tables; no performance lints.

The candidate is intentionally coordinated-only because the currently deployed
legacy browser app still depends on public Data API / Storage. Applying the
migration before the replacement server app is ready would break the old app.
G4 database backup remains waived by the operator, so the candidate contains no
automatic deletion of payroll rows or Storage objects and must not be run on
Production without explicit G6 authorization.
