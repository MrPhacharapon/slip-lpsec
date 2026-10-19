# G5 — Google Sheets staff roster (server_sheet) private operator setup

**Confirmed 19 October 2026:** Keep the same Google Sheets roster source for both the payroll Admin upload and staff name/position lookup. The prior Production client source referenced the same Google Sheet in both pages. Do **not** publish the spreadsheet identifier or personnel rows in this repository, PR, chat or CI.

**Status:** `DECISION CONFIRMED / CONFIG NOT YET SET`. This document does not apply settings, deploy or authorize Production schema changes. Existing Vercel Production remains on `main`.

## Vercel configuration — Production target only

Open the authorized Vercel project `slip-lpsec` → **Settings → Environment Variables**. Specify **Production** as the target for the new Production keys; do not propagate the real Sheet identifier or Production service-role key into Preview/Test.

| Key | Production value / treatment |
| --- | --- |
| `PAYROLL_ROSTER_MODE` | Literal `server_sheet` (required explicitly) |
| `STAFF_DIRECTORY_DISABLED` | Literal `false` (required explicitly) |
| `STAFF_SHEET_ID` | Existing Google Spreadsheet **ID only** (the ID between `/d/` and `/edit`); server-only, never `NEXT_PUBLIC_`; do not paste it in chats/logs |
| `PAYROLL_RELEASE_TARGET` | Literal `production` |
| `SUPABASE_URL` | `https://cpwefjcpqykpxdumgogo.supabase.co` (server-side only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Actual **Production** service-role key; protected server-only environment setting; never publish |
| `ADMIN_PASSWORD` | New strong private password; never publish |
| `ADMIN_SESSION_SECRET` | Independent strong random secret (>=32 chars); never reuse |
| `PAYROLL_RATE_LIMIT_SECRET` | Independent strong random secret (>=32 chars); never reuse |
| `APP_ORIGIN` | `https://slip-lpsec.vercel.app`, if this remains the serving origin; verify against the actual final canonical origin before deploy |
| `CRON_SECRET` | New independent secret (>=32 chars), server-side only |
| `LINE_CHANNEL_SECRET` | The actual LINE webhook signing secret, server-side only |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_GROUP_ID` | Already present as Vercel key names; verify correct target and function privately, do not print values |

The new server code also fails closed: Google staff-directory fetches are **disabled by default** and only allowed when `PAYROLL_RELEASE_TARGET=production`, `PAYROLL_ROSTER_MODE=server_sheet` and `STAFF_DIRECTORY_DISABLED=false` are all explicitly present. The isolated Test environment always keeps the directory disabled.

The present inventory found **only four Vercel key names**: LINE access/group and two `NEXT_PUBLIC_SUPABASE_*` fields. Names alone are not proof that any existing value is correct. The `NEXT_PUBLIC_SUPABASE_URL` must match `SUPABASE_URL`; NEVER set a `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`.

## Sheet format and access preconditions

1. Verify the Google Sheet is the **same** roster used by the existing Admin uploader and staff page. The source identifier is not repeated here.
2. The secured **new** server now reads the existing Sheet through the Google Sheets API using a **read-only service account** (`STAFF_SHEET_ACCESS_MODE=service_account`), not the unauthenticated legacy CSV Export endpoint. The dedicated service-account email must have Reader permission on this Sheet, the Google Sheets API must be enabled for its Google Cloud project, and the private key must be stored only in the Vercel Production environment. Only after real private API tests pass should the owner revoke `anyone / reader` sharing in a coordinated cutover; changing it now would break the still-running legacy web app.
3. `gid=0` must be the intended roster tab. The parser reads column A = name, B = position, C = 10-digit bank account, D = 7-digit position number. Account values must preserve leading zeros. The staff display parser now uses the **same bank-account separator normalization** as the Admin roster validator (hyphens/spaces), and fails closed if more than one Sheet row matches the account, the matched name is blank or the 7-digit position number is invalid. Do not share original roster contents.
4. Admin `/api/admin/roster` requires a valid admin session and checks CSV structure/duplicates via `parseRoster`; the staff lookup only returns the matched name/position after a published slip match, but lookup **by known bank-account number is not proof of account ownership**. This residual risk is explicitly accepted in the product requirements.
5. To avoid leaking this roster to isolated Preview/Test, configure `STAFF_DIRECTORY_DISABLED=true` in those isolated environments and use Test-only Supabase credentials. Existing legacy main may still embed a Google Sheet URL; keep the existing Production app unchanged until the coordinated safe replacement is approved.

## Private configuration validation

Use `scripts/check-private-release-env.mjs` on an authorized machine with the intended environment populated. Do not run against real Production secrets in GitHub Actions and do not paste secret output. It checks metadata and basic strength/configuration without contacting the Sheet:

```powershell
node scripts/check-private-release-env.mjs
```

Expected summary after **private** configuration: `{"result":"PASS","checks":"release-environment","missingOrInvalid":[]}`. This is *only a local configuration test*; it does not confirm Google API access, live Production behavior, RLS or deployment safety.

For the final authorized cutover, verify from the secured application through the Admin session that Google Sheets import succeeds, the roster matches expected columns, staff lookup retains name/position, wrong-account and outsider access are denied, and no full CSV/Sheet ID appears in client bundles or logs. Never run these checks against real salary data in a public CI environment.

**Stop conditions:** unset or wrong Sheet ID, Google OAuth or Sheets API access denied, unexpected Google Sheet columns, Production/Test Supabase mix-up, incomplete server secrets, exposed `NEXT_PUBLIC_` secrets, or secure Schema/Storage cutover not yet ready. Do not merge/deploy until the separate G6–G8 gates and release authorization are complete. G4 remains **WAIVED** by the operator, with no verified PostgreSQL recovery point.

## Privacy finding verified through Google Drive metadata (19 Oct 2026)

The connected Drive metadata reports the **same old roster Google Spreadsheet** exists with `application/vnd.google-apps.spreadsheet` MIME and `anyone / reader` permission. **No roster rows, identifiers, bank accounts or Sheet ID were exported to PR/CI/chat.** Since the legacy client publicly included the source Sheet URL, anyone-with-link read access creates a meaningful risk of third-party roster disclosure. Metadata alone does not establish who has accessed the file or whether the CSV endpoint is operating.

Do not unilaterally remove public sharing: the **currently deployed legacy app** uses unauthenticated Google CSV, and would fail if public access were removed now. The replacement branch already requires authenticated Google Sheets API access; it has **not** been deployed. A future secure solution must keep the **same Google Sheet** as source but use authenticated server-side Google access (such as a dedicated read-only service account granted to the Sheet); only after a fully validated integration and coordinated cutover may the owner disable `anyone` sharing. Setting `STAFF_SHEET_ID` as a secret on Vercel is not sufficient while old frontend code or shared permissions still disclose the roster. No changes to Google Drive sharing have been made.

## G5 secure server-to-Sheets setup (branch prepared; credentials pending)

Three **additional Production-only variables** are needed for the private Google Sheets API:

- `STAFF_SHEET_ACCESS_MODE=service_account` (**already set in Vercel Production**, without deployment; anonymous CSV export is **not** a valid mode for the secure branch).
- `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`: dedicated service account email; configure Reader sharing for that account on the **existing** roster file.
- `GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`: sensitive Google service-account private key PEM; Vercel **Sensitive** / server-only; never send to chat, GitHub, client code or any `NEXT_PUBLIC_` field.

Google Cloud project owner must enable the Sheets API and create/authorize the key privately. This chat cannot create or retrieve that credential. Do not delete or rotate other existing credentials to make the checker pass. `scripts/check-private-release-env.mjs` checks configuration format but cannot prove Google API rights. The app's Google token exchange and API request path must be tested in an isolated authorized deployment before changing sharing permissions. A staged failure must not reveal upstream Google errors or raw Sheet contents.
