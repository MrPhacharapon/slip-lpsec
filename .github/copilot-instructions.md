# Repository workflow and security instructions

Follow `AGENTS.md` and `.agents/skills/risk-based-continuous-execution/SKILL.md` when working in this repository.

Minimize duplicate optional tests when the same exact SHA and unchanged environment have already been verified. Use the smallest relevant checks for changed surfaces, and allow all required CI checks to execute. Do not bypass GitHub Protection, security boundaries, or required approvals. Make safe, independent changes on reviewable branches; do not directly edit protected `main`. Do not use or disclose real payroll PII, passwords, PIN, private roster identifiers, or Secrets in tests, code or logs.
