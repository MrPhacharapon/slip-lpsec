# G6 — synthetic legacy-schema rehearsal evidence (19 October 2026)

Scope: the Supabase **Test** project only (\`dpaqvxtbpaduknergflm\`), not Production. Executed inside one transaction using fictional fixtures in an isolated schema and ended with \`ROLLBACK\`. See [repeatable SQL](./payroll-g6-legacy-rehearsal-test-only.sql).

## Verified
- Legacy-shaped 7-column slips and 6-column history tables accepted an additive \`display_order\`, rate-limit table and two unique business-key indexes.
- Three tables had RLS enabled and were restricted away from \`anon\` and \`authenticated\`, with \`service_role\` table access.
- Simulated pre-existing slip and history records survived. Attempts to create duplicate slip owner/month/year and duplicate history month/year raised uniqueness violations as intended.
- The same-session SQL returned normally, so all assertions completed.
- **Independent post-rollback check**: \`to_regnamespace('payroll_rehearsal_20261019_g6') IS NULL\` was **true**. Actual Test \`public.slips=0\`, \`public.upload_history=0\`, \`storage.objects WHERE bucket_id='slips'=0\`. Existing Test rate-limit table had **16 counters after the rehearsal**; this SQL never referenced or changed that table.

## Not verified / release implications
- This is a **component rehearsal**, not the exact Production cutover or an end-to-end execution of all eight RPCs against a Production-like app and private Storage.
- It does not show the exact migration lock duration, the retention of real Production data, actual payroll PDF byte correctness, Google service-account access, or safe Production rollback.
- Production is still unsecured (RLS OFF, legacy public grants, public Storage), and no Production mutations were performed.
- G4 remains \`WAIVED_BY_OPERATOR\` with no verified PostgreSQL restore point. Never apply this test SQL to Production.
- G6 remains **BLOCKED**, and G8 remains **NO-GO** pending a separate, explicit cutover decision and G5 configuration.
