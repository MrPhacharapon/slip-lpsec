# G6/G8 two-phase Production cutover runbook

**Status: PREPARED / NOT AUTHORIZED.** No step below that changes Production,
creates a Vercel deployment, promotes traffic, or changes Google sharing may be
performed without explicit operator approval.

## Why split the cutover

The legacy Main app directly depends on public Supabase access. The replacement
app requires new RPCs/rate-limit schema. Applying all security changes first
would break legacy Main; deploying the replacement first without RPCs would
fail closed. Two phases keep a rollback point before the irreversible privacy
lockdown.

## Phase 0 — already completed, read-only

- Exact branch CI passes on prior reviewed SHAs.
- Production aggregate: 338 slips; max 38/period; no duplicate business keys,
  invalid accounts/names/month/year, staged period, or history-without-slips.
- 9/9 histories reference existing Storage objects; preserve all 12 objects,
  including 3 unreferenced files.
- Seven required new Production Vercel variables exist as Sensitive values;
  values were never decrypted by review.
- Google Service Account Viewer + Sheets API configured; operator local OAuth
  and tab-metadata check PASS.
- Production remains legacy: RLS off, broad browser grants, public Storage.

## Phase A — additive compatibility (first Production decision)

Apply `docs/payroll-production-g6-phase-a-additive.sql`.

Expected effects:
- add two unique business indexes;
- add nullable `upload_history.display_order` without rewriting `created_at`;
- add server-only rate-limit table;
- install 8 SECURITY INVOKER RPCs for service_role only;
- **do not** change existing slips/upload_history browser access or Storage
  visibility, so currently deployed Main should keep working.

After Phase A, verify aggregate row/object counts and run Security Advisor.
If any unexpected error occurs, stop. Do not delete or rewrite payroll rows.

## Stage the replacement without traffic (second Production decision)

At the exact reviewed commit, create a **staged Production deployment without
assigning the live domain** (Vercel production build / skip-domain workflow).
This step uses Production environment variables but does not send users to the
new build.

Private operator smoke checks against the staged deployment:
1. Admin login accepts the existing 3-character PIN and creates HttpOnly session.
2. Admin roster endpoint loads through Service Account (no public CSV).
3. A known authorized account search returns only published period metadata.
4. Deliberate PDF open returns exactly one PDF.
5. Admin history loads; no writes/deletes are performed.
6. Wrong account/PIN cases fail cleanly and rate-limit RPC responds.
7. Browser/client bundles contain no Google Sheet URL/ID or server-only secret.

If any check fails: discard staged deployment / keep Main live. Because Phase B
has not run, legacy Main remains operational.

## Promote, then Phase B lockdown (final coordinated Production decision)

Only after staged smoke PASS:
1. Promote the exact staged build to the live Production domain.
2. Immediately apply `docs/payroll-production-g6-phase-b-lockdown.sql`.
3. Re-run Supabase Security Advisor and aggregate integrity checks.
4. Verify anon/authenticated direct table access is denied.
5. Verify unauthenticated Storage download is denied while Admin server download
   still succeeds.
6. Then remove `anyone / reader` from the roster Google Sheet, leaving the
   dedicated Service Account as Viewer. This Google permission change is a
   separate explicit owner action.

## Rollback boundary

Before Phase B, rollback to legacy Main is possible because its old public
access still exists. After Phase B, **do not restore public table grants,
public Storage policies, or public Google sharing merely to revive legacy UI**.
Use a forward fix/staged replacement instead. G4 database backup was waived, so
the cutover must not depend on an unverified database restore.

No Production row deletion is part of Phase A or Phase B.
