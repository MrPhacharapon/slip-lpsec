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

The present inventory found **only four Vercel key names**: LINE access/group and two `NEXT_PUBLIC_SUPABASE_*` fields. Names alone are not proof that any existing value is correct. The `NEXT_PUBLIC_SUPABASE_URL` must match `SUPABASE_URL`; NEVER set a `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`.

## Sheet format and access preconditions

1. Verify the Google Sheet is the **same** roster used by the existing Admin uploader and staff page. The source identifier is not repeated here.
2. The server reads `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=0`. The roster must be readable from the server via that HTTPS CSV endpoint **without requiring an interactive Google login**, otherwise the new Admin API returns 503. Verify this only from an authorized private workstation/account; avoid making an unnecessary public share-permission change. If it requires new public visibility, stop and review the privacy impact instead.
3. `gid=0` must be the intended roster tab. The parser reads column A = name, B = position, C = 10-digit bank account, D = 7-digit position number. Account values must preserve leading zeros. Do not share original roster contents.
4. Admin `/api/admin/roster` requires a valid admin session and checks CSV structure/duplicates via `parseRoster`; the staff lookup only returns the matched name/position after a published slip match, but lookup **by known bank-account number is not proof of account ownership**. This residual risk is explicitly accepted in the product requirements.
5. To avoid leaking this roster to isolated Preview/Test, configure `STAFF_DIRECTORY_DISABLED=true` in those isolated environments and use Test-only Supabase credentials. Existing legacy main may still embed a Google Sheet URL; keep the existing Production app unchanged until the coordinated safe replacement is approved.

## Private configuration validation

Use `scripts/check-private-release-env.mjs` on an authorized machine with the intended environment populated. Do not run against real Production secrets in GitHub Actions and do not paste secret output. It checks metadata and basic strength/configuration without contacting the Sheet:

```powershell
node scripts/check-private-release-env.mjs
```

Expected summary after **private** configuration: `{"result":"PASS","checks":"release-environment","missingOrInvalid":[]}`. This is *only a local configuration test*; it does not confirm Google API access, live Production behavior, RLS or deployment safety.

For the final authorized cutover, verify from the secured application through the Admin session that Google Sheets import succeeds, the roster matches expected columns, staff lookup retains name/position, wrong-account and outsider access are denied, and no full CSV/Sheet ID appears in client bundles or logs. Never run these checks against real salary data in a public CI environment.

**Stop conditions:** unset or wrong Sheet ID, Google CSV export denied, unexpected Google Sheet columns, Production/Test Supabase mix-up, incomplete server secrets, exposed `NEXT_PUBLIC_` secrets, or secure Schema/Storage cutover not yet ready. Do not merge/deploy until the separate G6–G8 gates and release authorization are complete. G4 remains **WAIVED** by the operator, with no verified PostgreSQL recovery point.
