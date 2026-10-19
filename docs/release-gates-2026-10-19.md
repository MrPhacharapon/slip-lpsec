# Payroll G5–G8 checkpoint — 19 October 2026

**Authoritative latest gate snapshot for this branch; historical 16–18 October notes are superseded where inconsistent.**

- G2: Private operator reported real Next.js ↔ isolated Supabase Test PASS, including anonymous-denial check and cleanup.
- G3: Private operator reported actual PDF.js+CSV `PASS` for 10 PDFs / 338 pages / 376 slips, Jan–Oct 2569, zero failures and exit code 0. Confirm the corrected August source was selected. Original PDFs and roster were never committed to GitHub.
- G4: `WAIVED_BY_OPERATOR`, not `PASS`. User explicitly declined PostgreSQL DB backup, Storage PDF re-backup and Restore rehearsal. User affirms possession of original PDF copies; no independently verified Production DB restore point exists. This waiver does **not** authorize irreversible data modifications or public rollback.
- G5: `DECISION CONFIRMED / CONFIG BLOCKED`. Operator selected Google Sheets `server_sheet` like the legacy app, explicitly `STAFF_DIRECTORY_DISABLED=false` and server-only `STAFF_SHEET_ID`. Verified legacy Staff/Admin source references the same spreadsheet without disclosing its identifier. Four Vercel env names found: two LINE variables and two public Supabase variables; values not decrypted. Missing server-only config must be set privately, not via chat/PR. See [G5 operator checklist](./g5-server-sheet-operator.md) and [release handoff](./RELEASE_OPERATOR_HANDOFF.md).
- G6: `BLOCKED`: Production 8 RPC absent, two missing unique indexes, no rate limit table, no history display order, RLS disabled, anon/authenticated CRUD grants, public Storage. Test passes metadata checks; rehearsal of Production change on an isolated, representative schema not yet demonstrated.
- G7: `PARTIAL`: 12 Storage objects: 9 have matching upload history, 3 have no reference; do not delete or classify them without evidence. Zero history-to-Storage dangling references.
- G8: `NO-GO`. Final change approval has not been granted. **Do not merge or deploy.**
- G1: exact branch SHA `790cad573d6feacd707f110d9c00acd1af11ce3c` passed GitHub Actions [39187403281](https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39187403281); any subsequent commit requires new exact-SHA CI.

Checked against metadata-only Vercel / Supabase Test+Production on 19 October 2026 and private operator's G2/G3 results. All real payroll contents, PDF bytes, roster data, credentials and unlinked file paths remain private. The user requested continuing preparation without backup; Production destructive or security-changing actions remain gated.
