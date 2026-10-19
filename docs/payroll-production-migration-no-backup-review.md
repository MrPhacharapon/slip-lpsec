# G6 Production migration rehearsal / decision boundary — 19 October 2026

**PLAN ONLY / NO PRODUCTION SQL.** This is not a runbook authorized for automatic execution. The operator explicitly waived database and PDF Storage backup/Restore at G4; that waiver **does not prove rollback or authorize DDL, DELETE, changing access policies, merge, or deploy**. Preserve all 338 existing slip rows, nine history entries and 12 Storage objects; do not force completeness by deleting rows or files.

## Evidence verified read-only

- Test `dpaqvxtbpaduknergflm`: 8 required payroll RPCs exist and are `SECURITY INVOKER` scoped to service_role; RLS ON, anonymous table privileges revoked, private Storage bucket, unique business indexes, schema readiness=true. The fixture `slips`, `upload_history` and bucket counts were 0.
- Production `cpwefjcpqykpxdumgogo`: 8 RPCs absent, `payroll_request_limits` absent, `upload_history.display_order` absent, business uniqueness indexes absent, both payroll RLS OFF, anon/authenticated CRUD grants, bucket public with four public Storage policies; schema readiness=false.
- Production has no duplicate `(bank_account, month, year)` slips or duplicate `(month, year)` history keys; old 13 columns/type/nullability are compatible across Test and Production.
- G7 audit (19 October): 9 source slip periods all have matching published history; zero staged slip rows and orphan histories; 12 Storage objects, 9 uniquely history-linked, 3 unreferenced PDF-named objects (declared total 14,759,310 bytes); zero history pointers missing an object. Shared eTag metadata **does not prove byte equality**.

## Sources for *review* — these are Test-only SQL, not a Production migration

| Required capability | Reference file | Production review |
| --- | --- | --- |
| request limiter table and `check_payroll_rate_limit` | `docs/payroll-rate-limit-test-schema.sql` | Test-only implementation; confirm SQL function scope, retention and concurrent operations |
| `stage_payroll_slips` + `publish_payroll_period` | `docs/payroll-atomic-publish-test-schema.sql` | Check mutual advisory locks, 1–8 stage batch, atomic publish, 500 safety cap |
| `inspect_unpublished_payroll_period` + `discard_unpublished_payroll_period` | `docs/payroll-staged-recovery-test-schema.sql` | Check snapshot/lock and recovery safety; no deleting unexpected records |
| `inspect_published_payroll_deletion` + `delete_published_payroll_period` | `docs/payroll-published-deletion-test-schema.sql` | **Destructive functions:** extra caution without DB backup; do not expose or run without a separately approved delete policy |
| `upload_history.display_order` + `reorder_payroll_history` | `docs/payroll-history-display-order-test.sql` | Existing timestamp must be preserved; column additive |
| index, RLS, anon/auth Grants and Storage restrictions | `docs/supabase-security-cutover-draft.md` | Public read/write removal must be coordinated with Next.js API deployment; never simply disable legacy frontend access mid-use |

## Proposed protected cutover **after** G5, no action authorized yet

1. Review exact Production defaults, extension versions, existing roles, storage policy predicates, out-of-band consumers and current write traffic; re-run `docs/payroll-cutover-readonly-preflight.sql` and `docs/payroll-release-data-integrity-readonly.sql` immediately before changes.
2. Confirm private Google Sheet access mode and all server-only Vercel secrets. Keep the real staff bank-account roster out of browser code and GitHub. If anyone-with-link access remains, mark Google Sheet privacy as an unresolved risk rather than calling G5 safe.
3. In a separate **representative, isolated rehearsal environment**, run the full planned migration against synthetic data and verify RPC permissions, strict RLS/Storage and positive/negative API calls. Test in **Production-like legacy schema**, not only an already-migrated Test schema. Do not use real payroll data for CI. Any new test project/branch cost requires separate approval.
4. Have a human review an explicit forward-only migration, query-lock/downtime limits, additive DDL/unique-index compatibility and non-destructive fallback. Since there is no verified DB backup, changes with irreversible loss potential are **not permitted** by the general instruction to proceed. Any future Production mutation requires a specific approval of the exact operation.
5. On a separately authorized maintenance window, stop payroll writes; recheck zero duplicates/orphans; stage additive schema/RPC/index updates with strict invoker/service_role permissions. Coordinate removal of public Data API privileges and public Storage policies/bucket access with deployment of the secure Next.js API and private server secrets; verify auth/forbidden responses and PDF access.
6. Verify original month functionality, CSV/Sheet account triple-match, Admin sessions, LINE/cron, and new private `/api/admin/storage` endpoint against authorized resources **without logging PII**. Keep all 12 files. Re-run both read-only audits after every approved cutover.
7. If one cutover condition fails, **stop writes/unsafe access**. Never restore public SQL grants, disable RLS, or make the bucket public as an automatic code rollback. Without a tested database backup, rollback can only rely on separately rehearsed safe forward-fixes; do not pretend records can be restored.

**Current judgment:** NO-GO. Missing production secrets, unreviewed public Google Sheets exposure, absent Production RPC/security schema, no representative rehearsal, and G4 waiver all remain relevant.
