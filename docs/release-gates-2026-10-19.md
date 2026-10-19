# Payroll G5–G8 checkpoint — 19 October 2026

**Authoritative latest gate snapshot for this branch; historical 16–18 October notes are superseded where inconsistent.**

## Latest evidence — G6 representative Test rehearsal (19 October 2026)

- New G6 component rehearsal executed using only synthetic legacy-shaped tables in Supabase Test under \`BEGIN\` ... \`ROLLBACK\`: additive columns/table, unique business keys, RLS and service-role grants; duplicates denied and legacy-shaped fake records preserved. Post-check confirmed the ephemeral schema absent; Test slips/history/Storage object counts remained zero. Test rate-limit counters measured 16 and were not modified by this exercise. Evidence: [G6 synthetic rehearsal](./payroll-g6-legacy-rehearsal-evidence.md).
- This is **not** a complete Production migration rehearsal; eight RPC integration, live request concurrency, no-backup cutover recovery, and Google credentials remain blockers. G6 stays **BLOCKED**.
- Prior exact-SHA G1 successful evidence: \`22c0aee5097c5f31afbbeaa8103fdfd6120db782\`, [CI 39220252298 PASS](https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39220252298), 152 Node tests. The new documentation commit must have a *new* exact-SHA CI run.


- G2: Private operator reported real Next.js ↔ isolated Supabase Test PASS, including anonymous-denial check and cleanup.
- G3: Private operator reported actual PDF.js+CSV `PASS` for 10 PDFs / 338 pages / 376 slips, Jan–Oct 2569, zero failures and exit code 0. Confirm the corrected August source was selected. Original PDFs and roster were never committed to GitHub.
- G4: `WAIVED_BY_OPERATOR`, not `PASS`. User explicitly declined PostgreSQL DB backup, Storage PDF re-backup and Restore rehearsal. User affirms possession of original PDF copies; no independently verified Production DB restore point exists. This waiver does **not** authorize irreversible data modifications or public rollback.
- G5: `PARTIAL / LIVE LOCAL OAUTH PASS`. Seven Production server-only secret names now exist in Vercel as Sensitive values; `ADMIN_PASSWORD` is intentionally absent because the operator retained the existing 3-character PIN. Dedicated Google Service Account Viewer access and Google Sheets API are configured. Operator local OAuth + tab-metadata test returned PASS without reading staff rows/PIN. Vercel runtime values and deployed end-to-end Google integration remain unverified.
- G6: `BLOCKED — CANDIDATE REHEARSED`. Production still lacks 8 RPCs, two business unique indexes, rate-limit table, history display order, RLS and private Storage. However, the consolidated no-delete migration candidate was applied successfully to Supabase Test; all eight RPC rehearsal cases passed afterward with rollback and Test row/object counts unchanged. Latest Production read-only preflight: 338 slips, max 38/period, 0 invalid accounts/names/months/years, 0 duplicate slip/history groups, 0 staged periods, 0 history-without-slips.
- G7: `PARTIAL`: 12 Storage objects: 9 have matching upload history, 3 have no reference; do not delete or classify them without evidence. Zero history-to-Storage dangling references.
- G8: `NO-GO`. Final change approval has not been granted. **Do not merge or deploy.**
- G1: latest fully completed exact-SHA before this documentation refresh was `90ef11d54de3dc2a5bbd007aa3f1d2dc5889a825`, CI 39254346367 PASS with 177/177 tests plus build/PDF.js/browser. Subsequent commits require their own exact-SHA CI.

Checked against metadata-only Vercel / Supabase Test+Production on 19 October 2026 and private operator's G2/G3 results. All real payroll contents, PDF bytes, roster data, credentials and unlinked file paths remain private. The user requested continuing preparation without backup; Production destructive or security-changing actions remain gated.

- **19 Oct G5 privacy finding:** Connected Google Drive file metadata confirms existing roster Sheet has `anyone / reader` sharing; legacy client code embeds its URL. Server-only ID is not yet sufficient to secure the roster. Keep `server_sheet` as selected data source, prepare authenticated read access, and do not change sharing unilaterally. No Sheet rows were read. G5 remains BLOCKED.
- **19 Oct G7 expanded aggregate audit:** 9/9 slip periods have published histories, zero staged slips, zero histories missing slips, 12 objects / 9 history-linked / 3 unreferenced PDF-named objects / 0 missing object references. Never infer byte equality from metadata etags; retain all 12. See [repeatable read-only G7 query](./payroll-release-data-integrity-readonly.sql) and [G6 no-backup review](./payroll-production-migration-no-backup-review.md).

- **19 Oct G5 secure access implementation prepared:** service-account Google Sheets API read-only client built on feature branch, with RS256 JWT synthetic regression; both Staff/Admin server readers share the authenticated source. No Google key created or read, no Google sharing changed and no Production deployment. Real credential/provisioning and isolated Next.js ↔ Google Sheets integration still required. No fallback to public CSV in the new API.

- **19 Oct Vercel secret metadata recheck:** all seven new Production keys are present as Sensitive variables; values were not decrypted. `ADMIN_PASSWORD` remains absent by operator decision.
- **19 Oct G6 consolidated candidate rehearsal:** exact branch file `docs/payroll-production-security-migration-candidate.sql` applied successfully to Supabase Test. Before/after Test: slips 0, history 0, Storage objects 0, rate-limit rows 16; after security state = 3 RLS tables, 8 SECURITY INVOKER RPCs, 0 anon/authenticated payroll grant rows, private bucket. Exact 8-RPC rollback rehearsal was rerun successfully afterward with the same before/after counts.
