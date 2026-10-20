<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


## slip-lpsec project rules

Read `docs/PROJECT_RULES.md`, `docs/ACCEPTANCE_CRITERIA.md`,
and `docs/PROJECT_STATUS.md` before changing code. Preserve the
Next.js rules above.

- Check live GitHub branch/main HEAD, CI and Vercel deployment first.
  Check Supabase using read-only aggregate SQL when relevant.
- Work on `fix/payroll-pdf-validation-no-deploy` only. Commit
  related changes atomically with an expected parent SHA. Run
  independent checks concurrently; never race dependent writes.
- Maintain existing staff bank-account-only lookup, Admin controls,
  PDF A/B identity, printed-month-and-year checks, and no-overwrite
  invariants. Never dilute tests to force a PASS.
- CI may use fictional data only. No real payroll PDFs, rosters,
  personal information or credentials in GitHub, logs or chat.
- Treat `quality`, `browser-e2e` and aggregated `validate` as
  mandatory; the tested commit must match HEAD.
- Keep CI synthetic results distinct from private real PDF testing,
  full-stack isolated Supabase Test verification, and restore checks.
- Do not merge or deploy to Production or change real databases,
  privileges, Storage or secrets without separate explicit approval.
- Report changed files, exact commit, CI outcome, unresolved
  G1-G8 gates and risks. Update the project status with last
  verified evidence rather than unsupported success claims.


<!-- BEGIN:slip-lpsec-risk-based-execution -->
## Risk-based continuous execution (payroll system)

Read and follow `.agents/skills/risk-based-continuous-execution/SKILL.md` for maintenance work. Reuse valid test evidence tied to an unchanged SHA/environment; do not repeat optional checks routinely. Parallelize safe independent tasks. Keep required GitHub `validate` checks and branch protection; test changed high-risk surfaces and verify affected Production invariants. Use feature branches and PRs, never edit protected `main` directly. Require explicit operator approval before merging to `main`, modifying Production or database/secrets/security settings, or deleting data/backups. Never disclose real payroll PII, bank accounts, PINs, credentials, PDFs or private roster identifiers.
<!-- END:slip-lpsec-risk-based-execution -->
