# Private payroll acceptance evidence — 16 October 2026

Scope: isolated acceptance only. Contains **no** real names, account numbers, salaries, original PDF content, PDF filenames, credentials, or Storage object paths. Do not interpret this as Production release approval.

## 1. Real PDF mapping: external parser preflight

- Input: seven original private monthly PDFs (January–July 2026), 263 pages total.
- Reference: private local 39-person staff CSV; checked owner identity against exact name, ten-digit bank account, and seven-digit position number.
- Result: **263/263 pages matched**, one full-page slip per page, no unmatched owner or duplicate owner per monthly source.
- Method: **PyMuPDF** extracted text; a Python adaptation reproduced normalization, layout, and owner-matching criteria of `src/lib/slip-validation.ts`.
- Limitation: **This is not an actual `pdfjs-dist` run on real PDFs.** The local runtime has no installed PDF.js package and could not reach the npm registry; do not mark the PDF.js real-data gate passed. The synthetic PDF.js A/B/odd tests in GitHub Actions previously passed.
- Privacy: no source PDFs or roster uploaded to CI, GitHub, or external preview.

## 2. Private source-PDF copy integrity

- Seven private source PDFs were copied into temporary restricted source and restored-copy directories, covering 41,104,733 bytes.
- All restored copies matched source SHA-256 fingerprints. A deliberate byte change to one copy was detected. The copy was then returned to the original bytes and reverified.
- All temporary copies were removed.
- Limitation: source-document copy integrity does **not** establish an actual Supabase Production DB + Storage backup or prove restore of database schemas, access policies, and metadata.

## 3. Synthetic isolated Supabase Test restore rehearsal

- Project: `sliplpsec-test`, ID `dpaqvxtbpaduknergflm`.
- An explicit guard required that both payroll tables be empty.
- In one SQL transaction, inserted two fictional slip rows and one fictional history row, snapshotted the full rows into temporary tables, deleted those fictional rows, restored them, and compared the restored contents across all columns.
- An intentional same-row-count content mutation was detected by the exact-row comparison.
- Transaction concluded with `ROLLBACK`. Post-check: **0 slips, 0 histories, 0 Storage objects**.
- Limitation: this tested **fictional SQL data only**. It was not a restore from a real exported Production backup and did not restore Storage.

## 4. Next.js → real Supabase Test API integration

- **Not executed**. Test-only service-role credentials were not available in the local runtime or supported project-connector actions.
- No Production key was used or requested. A publishable key is insufficient for these server-side service-role RPC operations.
- Manual secure integration runner already in the repository: `scripts/test-isolated-next-api.mjs`. Its fixture tests, fail-closed environment checks, and mock browser E2E have previously passed CI, but mock success cannot replace real API evidence.

## 5. Remaining approval gates

- Run PDF.js on the seven real sources, and obtain the amended August–October PDFs if all 2026 months are to be included, **inside an authorized private workstation**.
- Run the Next.js integration helper using only the dedicated Test service-role key, with clean Test state verified before and after.
- Obtain the actual Production DB + Storage backup via an authorized, confidential backup method; rehearse restore in a separate private project/environment with verified schema, private Storage, privileges, data and file hashes. **Never restore over Production**.
- Production currently remains **NO-GO**. No branch merge, Vercel production deployment, Production schema, Storage, permissions, or secrets changes are authorized by this document.
