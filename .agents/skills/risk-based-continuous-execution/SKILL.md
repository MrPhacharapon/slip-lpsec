---
name: risk-based-continuous-execution
description: Minimize redundant verification and continue safe maintenance tasks autonomously, preserving mandatory controls and approvals.
---

# Risk-Based Verification & Continuous Execution

## Scope
Applies to `slip-lpsec` GitHub/Vercel/Supabase/Google Sheets maintenance and similar workflows. It is a preference, not a waiver of safety, branch protection or explicit approvals.

## Rule
Never repeat a completed check merely because the next step started. Reuse scoped results tied to an exact commit SHA, deployment ID, environment and dependencies if still applicable.

## Risk-based checks
- **Low:** read-only docs, issue notes, summaries, non-behavior changes. Reuse proof; skip duplicate manual reviews and optional tests.
- **Medium:** isolated noncritical code/test changes. Review the changed diff and use the smallest relevant check; preserve unaffected evidence. Do not reflexively rerun all optional suites.
- **High:** authentication, permissions, PIN, payroll ownership, PDF parsing, PDF worker, security dependency updates, secrets, deployments, database/storage, backups or protected branch controls. Revalidate changed security invariants, run focused regression at the changed SHA and mandatory CI, seek approval for consequential actions.

## Evidence invalidation triggers
Recheck only when relevant code/lockfile/config/CI rules change; head/base SHA moves; deployment or database operation changes affected invariants; a check fails or becomes obsolete; credible security drift or incident emerges; or critical evidence needed for an authorized action is absent.

## Non-skippable controls
- Preserve GitHub `main` Protection and required `validate` status check on every changed commit. Do not bypass CI even for low-risk changes.
- Before authorized Merge, verify current head SHA and applicable merge checks. Require explicit operator approval for merge to `main`.
- For authorized Production rollout, confirm deployed commit matches approved SHA and verify the critical impacted functionality and state. Do not claim authenticated workflows, runtime logs, or data integrity passed unless independently evidenced.
- Require fresh approval for secrets modifications, destructive actions, database mutations/migrations, backups removal, disabling safeguards and security/governance changes.
- Never expose employee details, bank accounts, PINs, payroll PDFs, service credentials or Google Sheet ID. Use synthetic fixtures and no real payroll data in CI.

## Continuous execution
1. Start from the last evidence checkpoint, not a full recrawl.
2. Select independent non-destructive tasks and parallelize safely where possible.
3. Choose minimal necessary checks based on changed surface and risk.
4. Use feature branches and PRs; never write directly to `main`.
5. When tests fail, repair changed surface; run invalidated checks plus mandatory CI without replaying unrelated audits.
6. Proceed until a real user decision, tool blocker or safety constraint is reached.
7. Report only meaningful milestones, new failures, remaining unknowns and exact approval decisions.

## Checkpoint reporting
Track the SHA, deployment ID, change scope, timestamp, test result and what evidence is reused. Use precise labels: verified, in progress, not tested, approval needed.

## Example
If a PDF.js PR passed browser and synthetic PDF tests at its exact head SHA, do not manually rerun them before Merge unless an invalidation trigger exists. A new merge SHA still requires protected GitHub `validate` CI; a new Production deployment requires relevant post-deploy verification.
