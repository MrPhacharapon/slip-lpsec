# G6 actual eight-RPC Test transaction (19 October 2026)

**Test-only evidence.** Supabase project `dpaqvxtbpaduknergflm` was checked immediately before the run: `public.slips=0`, `public.upload_history=0`, `storage.objects(slips)=0`, `payroll_request_limits=16`; all eight required functions are present and `SECURITY INVOKER`.

Executed all eight existing payroll RPCs in one PostgreSQL transaction with entirely synthetic identifiers and invalid disposable test PDF placeholder data. Covered:
- `check_payroll_rate_limit`: one allowed request and one denied at limit 1.
- `stage_payroll_slips`, `inspect_unpublished_payroll_period`, `discard_unpublished_payroll_period`: one fake staged slip, stale snapshot rejection with row preservation, and correct-snapshot discard.
- `publish_payroll_period`, `reorder_payroll_history`: fake published period with confirmed history creation; reordering preserves `created_at`.
- `inspect_published_payroll_deletion`, `delete_published_payroll_period`: qualified preview, stale snapshot rejection without data loss, and correct-snapshot deletion (inside transaction only).

The SQL transaction completed successfully and ended with `ROLLBACK`. Independent post-query: **Test slips=0, histories=0, Storage objects=0, rate-limit rows=16**. None of these aggregate counts changed from preflight. No real payroll record, bank account, salary, PDF source, roster ID or Secret was read or sent to CI.

Reproducible script: [test-only transaction](./payroll-g6-eight-rpc-rehearsal-test-only.sql). The script requires the isolated Test sandbox to be empty and private; it must never be run against Production.

**Limitations:** This validates live database-side RPC behavior at the Test project's current schema, not an end-to-end Next.js request, real service-role HTTP credentials, concurrent requests, a Production-like legacy migration, private Google Sheets connectivity, private Storage serving, data backup or release rollback. The distinct representative legacy-shape DDL rehearsal is documented [here](./payroll-g6-legacy-rehearsal-evidence.md). **G6 remains BLOCKED; G8 remains NO-GO**, G4 remains `WAIVED_BY_OPERATOR`. Any Production DB/Storage/ACL change still needs separate explicit approval.
