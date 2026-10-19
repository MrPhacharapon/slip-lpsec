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


## Candidate rehearsal completed on Supabase Test

The exact candidate file from branch commit `03813218858e11e4bb7a6232655d09f3e11b7c16`
(blob `e4363d40384c7ac21ea3c9a5f4d3311e9733bbc4`) was executed on the
isolated Supabase Test project. It completed successfully.

Aggregate state before -> after:
- slips: 0 -> 0
- upload_history: 0 -> 0
- Storage objects in `slips`: 0 -> 0
- payroll_request_limits rows: 16 -> 16
- bucket public: false -> false
- post-migration RLS tables: 3
- post-migration SECURITY INVOKER payroll RPCs: 8
- anon/authenticated payroll grant rows: 0

After applying the candidate, the exact GitHub
`docs/payroll-g6-eight-rpc-rehearsal-test-only.sql` was rerun. It passed
stage/inspect/discard, stale snapshot rejection, publish/reorder,
inspect/delete, stale published snapshot rejection and rate-limit checks under
transaction rollback. Before/after counts remained slips 0, history 0,
Storage objects 0, rate-limit rows 16.

## Exact Production preflight rerun

The read-only file `docs/payroll-production-g6-final-preflight.sql` returned:
338 slips; 0 invalid accounts, names, months or years; max PDF Base64 length
297388; max 38 slips/period; 0 duplicate slip/history groups; 0 staged periods;
0 slip rows without history; 0 history periods without slips; 9 histories with
Storage paths. Security state remains intentionally unchanged: 0/2 payroll
tables with RLS, 28 anon/authenticated table-grant rows, public Storage bucket
and 4 public Storage policies.

No Production SQL write, Storage ACL change, row deletion, merge or deployment
was performed.
