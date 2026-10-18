# Release operator handoff — Draft PR #1 (18 October 2026)

**NO-GO: instructions and factual readiness only, not authorization to deploy or mutate Production.**
PR: https://github.com/MrPhacharapon/slip-lpsec/pull/1
Branch: `fix/payroll-pdf-validation-no-deploy`
Last tested branch SHA before this documentation change:
`1e0890032d91f8c5d84535c622f4231b39fc9437`
CI: https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39139281682
Production/main currently: `fdced74510f57ab83a758642f2edba08dad0b316`.

## 1. Unresolved gates — do not waive

| Gate | Operator's evidence required before declaring PASS |
|---|---|
| G1 CI | Full `quality`, `browser-e2e`, and `validate` must succeed for the *final* merge/deploy SHA |
| G2 real Test API | Private workstation runs `scripts/test-isolated-next-api.mjs` with **Test-only** service-role key, after SQL `docs/payroll-test-readiness-readonly.sql` returns `schema_ready=true`; verify synthetic stage/publish/download/recovery and zero remaining rows/objects |
| G3 real source PDFs | Authorized workstation runs actual PDF.js via `scripts/validate-private-payroll-pdfs.mjs` with private staff CSV and `--pdf ... --month ... --year ...` per file for all required months/formats, including corrected August, two-per-page B and odd final B; do not use CI or chat for source data |
| G4 genuine backup + restore | Create a protected full PostgreSQL **and all Storage objects** backup, verify independent manifest/copy integrity, then restore to a separate authorized environment; verify schema, full row content/count, Storage bytes/count, RLS/GRANT and sample authorized PDF access. `scripts/verify-private-payroll-backup.mjs` only establishes file-copy integrity, NOT DB/Storage restore |
| G5 server-only config | Verify Production `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `PAYROLL_RATE_LIMIT_SECRET`, `APP_ORIGIN`, `CRON_SECRET`, `LINE_CHANNEL_SECRET`, LINE access/group values, and staff roster mode/ID as appropriate. Use `scripts/check-private-release-env.mjs` in the private operator session; do not copy values to GitHub |
| G6 coordinated migration | Rehearse and review the full schema/index/RPC/RLS/GRANT and Storage-private cutover. Existing Test-only SQL scripts are reference material, not a blindly executable Production migration |
| G7 legacy Storage | Retain and investigate all **12** current Storage objects, including **3** without matching history; never delete them to make validation pass |
| G8 release authorization | Freeze tested SHA and a maintenance window; authorize the specific Production DB/Storage steps and merge/deploy order, ensure responsible operator and safe rollback are present |

## 2. Live read-only schema gap (18 October 2026)

The comparison used `docs/payroll-test-readiness-readonly.sql` and
`docs/payroll-cutover-readonly-preflight.sql`, not payroll record values.

| Check | Test | Production |
|---|---|---|
| Required 8 RPCs | Present with service-role-only execution | **All 8 missing** |
| Required tables/columns | Complete | `payroll_request_limits` missing (3 cols); `upload_history.display_order` missing |
| Business unique indexes | Both exist | **Both missing** |
| Payroll table RLS / public privileges | Protected | **2 tables RLS OFF; public SELECT/INSERT/UPDATE/DELETE granted** |
| slips Storage bucket | Private | **Public; 4 public Storage policies** |
| Rows / objects | 0 slips, 0 histories, 0 Storage objects, 0 limiter records | 338 slips, 9 histories, 12 Storage objects |
| Duplicate key groups | Not used for this gate | **0** slips, **0** history |
| Referenced history paths missing from Storage | Not used | **0** |

Schema readiness on Test **does not** mean full-stack authenticated Next.js →
Supabase Test integration has run.

## 2A. Additional read-only compatibility evidence (18 October 2026)

Run `docs/payroll-legacy-schema-compatibility-readonly.sql` on **both** Supabase Test and Production. Tested values: `legacy_columns_compatible=true`, `both_base_tables_present=true`, `custom_trigger_count=0`, `foreign_key_count=0`, `duplicate_slip_groups=0`, `duplicate_history_groups=0` in both environments. This eliminates some basic schema-drift concerns, **not** migration or restore risk.

Only Test has `payroll_tables_rls_enabled=true`, `anonymous_table_access_revoked=true`, `storage_bucket_private=true`. Production has all three **false**. Production Storage totals: 12 objects, 9 matched by upload history, 3 unreferenced; no history rows point to missing objects. Metadata cannot show whether the unreferenced PDFs are duplicates or disposable. Retain all files and verify private backup/restore before any cutover.

## 3. Migration sequence — planning ONLY

1. **Precondition:** verified private, restorable database and complete Storage backup; check all 12 files and three unclassified objects. Freeze new writes in a coordinated maintenance window. Keep an independent safety copy.
2. Verify the current production duplicate counts and data types again. Inspect clients depending on legacy public access; record a privacy-preserving before snapshot.
3. Prepare migration from reviewed Test-only assets in this order: `payroll_request_limits` and rate-limit RPC, add `upload_history.display_order` and reorder RPC, add validated Unique indexes (`bank_account,month,year` and `month,year`), stage/publish RPCs, staged recovery RPCs, published deletion RPCs. Confirm all **8** functions are `SECURITY INVOKER`, called only by `service_role` and use transaction-safe locks.
4. Rehearse RLS enablement and **REVOKE** for `anon`, `authenticated`, `PUBLIC`; keep service-role access. Rehearse private bucket conversion and removal of all 4 existing public Storage policies **without deleting objects**. Test direct anonymous API/storage denial.
5. Before any live step, verify Server-only Vercel keys and exact `APP_ORIGIN`. Do not merge to main early if Git integration could automatically deploy an app against the unmigrated schema.
6. Perform a **single coordinated** security/schema and application cutover using the tested SHA and a documented monitoring window. Check the new owner-only PDF API, rate-limit, Admin, LINE, legacy document access, no public Data API/Storage, and existing months.
7. **Rollback must never re-enable public payroll table privileges or change the bucket to public.** If the legacy code cannot run with secure ACLs, keep risky functionality unavailable rather than exposing all salaries. Restore only from independently tested backups under approved procedure.

## 4. Immediate operator actions (private, no secrets in chat)

1. In the authorized environment: run `docs/payroll-test-readiness-readonly.sql` on **Test only**, then use `docs/private-payroll-acceptance-local.md` for private G2/G3 execution and safe environment variable handling.
2. Securely back up **all** Production PostgreSQL + Storage objects, independently restore/test G4, and record only non-sensitive PASS/FAIL evidence outside the public repo.
3. In the protected Vercel administrator UI, supply the new server-only environment variables and run `scripts/check-private-release-env.mjs` privately; never share raw values.
4. Submit the gate results (no personnel or credential content) for final SHA freeze and coordinated maintenance release.

Keep PR **Draft** and Production **NO-GO** until G1–G8 are independently verified. A synthetic CI pass cannot replace a real PDF.js test or a real DB + Storage restore.
