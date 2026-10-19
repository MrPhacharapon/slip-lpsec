# Release operator handoff — G5–G8 (19 October 2026)

**DRAFT / NO-GO.** This is a verified, non-secret status and an operator plan. It is not permission to merge, deploy, change Production SQL, change Storage ACLs, or delete records.

Repository: `MrPhacharapon/slip-lpsec` · PR [#1](https://github.com/MrPhacharapon/slip-lpsec/pull/1) · branch `fix/payroll-pdf-validation-no-deploy`.
Prior tested source SHA `790cad573d6feacd707f110d9c00acd1af11ce3c`, [CI success](https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39187403281) (134 synthetic Node tests, 7 synthetic PDF.js cases and browser checks). Any new documentation commit needs its own exact-SHA CI before release. Production/main remains `fdced74510f57ab83a758642f2edba08dad0b316`.

## Gate ledger — operator evidence is not a CI artifact

| Gate | 19 Oct status | Evidence / unresolved work |
| --- | --- | --- |
| G1: exact-SHA CI | PASS at `790cad5`, must be rechecked on final SHA | [run 39187403281](https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39187403281); not deployment authorization |
| G2: real isolated Supabase Test | PASS reported by authorized private operator (18 Oct) | Local Next.js+Test service key integration, anon denial and private Storage, cleanup of payroll fixtures; do not share credentials |
| G3: private actual PDF.js + actual CSV | PASS reported by authorized private operator (19 Oct) | Local PowerShell `G3 Exit code: 0`, Jan–Oct 2569, ten source PDFs, 338 pages, 376 slips, zero failed documents, including layout B and corrected August (subject to operator selecting corrected file) |
| G4: backup/restore | **WAIVED BY OPERATOR — NOT PASS** | Operator explicitly declined both PostgreSQL backup and repeat PDF Storage backup; states original PDF sources already backed up privately. No DB restore point, backup integrity, full Storage recovery or recovery capability has been demonstrated |
| G5: Vercel + private Google configuration | **PARTIAL** | Seven new Production server-only keys now exist as Sensitive variables; `ADMIN_PASSWORD` intentionally absent. Local operator OAuth+tab-metadata check PASS. Vercel runtime values/end-to-end roster+PIN read are still unverified. |
| G6: secure Production cutover | **BLOCKED — CANDIDATE REHEARSED** | Consolidated no-delete candidate SQL was applied successfully to Supabase Test and all 8 RPCs replayed with rollback. Production read-only preflight is clean for duplicates/format/staged data, but RLS/grants/Storage remain insecure until an explicitly approved coordinated cutover. |
| G7: legacy Storage consistency | **PARTIAL** | All 9 history paths have Storage objects; 12 stored objects total, 3 unreferenced and unclassified; preserve all. No source bytes, personnel data or paths inspected/disclosed |
| G8: Production GO authorization | **NO-GO** | No authorized, rehearsed secure cutover / tested no-backup incident response / exact-SHA maintenance release yet |

## G4 risk acceptance boundary

The backup and restore tasks must **not** be performed; do not ask the operator to install Docker for backup or provide PDF copies. The waiver changes the evidence standard, not the physical risk. It does not authorize destructive or difficult-to-reverse Production DDL, data migration, record deletion, widening access or automatic rollback to an insecure legacy configuration. Without a verified DB restore point, a botched schema/data change may be unrecoverable. A separately reviewed and approved secure change plan must distinguish reversible additive changes from high-risk operations; blocking production changes must pause until approved.

## G5: exact Vercel metadata-only evidence — updated 19 Oct

Project `slip-lpsec` now reports 18 Production/Preview variable names. The seven
newly required Production secret names are present and are stored as Vercel
`sensitive` values: `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SESSION_SECRET`,
`PAYROLL_RATE_LIMIT_SECRET`, `CRON_SECRET`, `LINE_CHANNEL_SECRET`,
`GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`, and
`GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`. Their **values were never
decrypted or copied by this review**. `ADMIN_PASSWORD` is intentionally absent:
the operator chose to retain the existing three-character Admin PIN from the
same Google Sheet `Settings` tab.

The roster configuration is Production-only: `PAYROLL_ROSTER_MODE=server_sheet`,
`STAFF_DIRECTORY_DISABLED=false`, authenticated service-account access and
server-only Sheet ID. Google Sheets API is enabled, the dedicated Service
Account has Viewer permission, and the operator's local metadata-only OAuth test
returned PASS without reading roster rows or the PIN. The old `anyone / reader`
permission still exists solely because current legacy Main depends on it.

This evidence does **not** prove that the secret values entered in Vercel are
correct or that a deployed Vercel Function can reach Google/Supabase. No
Production redeploy has occurred.

## G6: read-only environment difference (rechecked 19 Oct)

Supabase Test project `dpaqvxtbpaduknergflm`: metadata `schema_ready=true`, 8 privileged RPCs permission-safe, 3 public tables with RLS, missing-column list empty, two business unique indexes, `slips` bucket private, 0 payroll rows/objects.

Supabase Production `cpwefjcpqykpxdumgogo`: `schema_ready=false`, 338 slips + 9 histories, 12 Storage objects, missing all 8 RPCs, missing `upload_history.display_order` and `payroll_request_limits` table (3 columns). Two payroll tables have RLS OFF with SELECT/INSERT/UPDATE/DELETE available to anon/authenticated; `slips` bucket PUBLIC with four public policies. Source scripts: `docs/payroll-test-readiness-readonly.sql` and `docs/payroll-cutover-readonly-preflight.sql`. **Do not blindly apply Test-only migrations or enable RLS/bucket privacy in isolation:** the current Production app may stop working; all changes need coordinated application/API transition.

Consolidated candidate: `docs/payroll-production-security-migration-candidate.sql`. It has now been executed successfully against Supabase Test as an idempotent schema/security rehearsal with no payroll/Storage object count changes. Exact Production write remains approval-gated.

## G7: do not delete legacy files

The production aggregate shows 12 objects and 9 history references, zero dangling history pointers and three files without history. Distinct metadata is not evidence those three are disposable. Do not remove, rename, download into CI or publicly expose anything to satisfy a test. Original source PDF backup asserted by operator is **not** evidence these 12 stored objects were individually reconciled. Keep all 12 during cutover, and test authorized access through the new server-only Admin endpoint after a future approved secure cutover.

## Operator stop conditions

Stop and request explicit approval for: any Production SQL write, RLS/GRANT/policy/bucket change, merge/deploy, deletion, broad data export, or a new cost. Do not log source payroll data or secrets. Preserve Draft PR and Production NO-GO until G5–G8 decision gates are met. Rollback must never restore public payroll table grants or a public Storage bucket merely to revive legacy UI.

## Google Sheets privacy gate — metadata-only check (19 Oct)

Connected Google Drive **metadata** confirms the same legacy source Sheet permits `anyone / reader` sharing. The legacy client embeds the Sheet URL. New server-only `STAFF_SHEET_ID` protects it from new browser bundles but does not revoke the existing public permission. Do not disable public sharing until an authenticated alternative is rehearsed; `server_sheet` must stay the selected source. G5 is **PARTIAL / PRIVACY BLOCKED**, separate from missing server secrets. See [G5 operator guide](./g5-server-sheet-operator.md). This read accessed **no personnel records**.

## Prepared secure Google Sheets path (feature branch, 19 Oct)

Branch now includes a read-only Google Sheets API client using RS256-signed Google service account OAuth (scope `spreadsheets.readonly`) for the exact existing `gid=0` roster tab, shared by Admin and staff lookup. **No anonymous CSV fallback exists in the new route.** Google Cloud credentials have not been supplied or tested live, and `anyone / reader` still exists on the legacy Sheet to keep the old Production web app working. New required server-only values: `STAFF_SHEET_ACCESS_MODE=service_account`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`. A dedicated service account must be granted Reader on the old Sheet; only after private end-to-end testing and approved cutover may the old public permission be removed. This is preparation, not proof of G5 PASS.
