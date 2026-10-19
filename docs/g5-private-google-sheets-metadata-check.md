# G5 — Private Google Sheets connection verification (metadata only)

**Purpose:** Confirm that the separately configured Google Service Account can get
a read-only OAuth token and see the **same old Spreadsheet**'s roster tab
(sheetId/gid 0) and the \`Settings\` tab. This diagnostic **does not request
rows or admin PIN values** and does not change Google sharing, Vercel or Supabase.

The file permission can already be confirmed via Drive metadata, but Drive access
under the owner's account does **not** prove that the Service Account has valid
credentials. Presence of seven Vercel Production key names is also not proof.

## Execution boundary

- Run \`node scripts/check-private-google-sheets-access.mjs\` **only in an
  authorized private Node 22+ execution environment** where the Production
  \`PAYROLL_RELEASE_TARGET\`, \`PAYROLL_ROSTER_MODE\`, \`STAFF_DIRECTORY_DISABLED\`,
  \`STAFF_SHEET_ACCESS_MODE\`, \`STAFF_SHEET_ID\`,
  \`GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL\` and
  \`GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY\` are already securely available.
- **Never copy values to chats, GitHub PRs, CI, terminal history or public
  screenshots.** Do not pull Production keys to public or shared machines.
- The checker has exactly two outbound operations: Google OAuth service-account
  token exchange, then Google Sheets spreadsheet **tab metadata**. Never reads
  \`/values/\`, CSV or original staff/Settings rows. No writes or deploys.
- Output: \`{"result":"PASS","checks":"private-google-oauth-and-tab-metadata"}\`
  or a generic \`NO_GO\` with no credentials, account identifiers, roster data
  or upstream Google error bodies. No-go is not an instruction to loosen sharing.
- A PASS proves token + tab metadata access **from the machine executing it**;
  it does not prove the Vercel Production runtime or full roster/PIN
  parsing, nor does it approve a Production release.
- Feature Branch CI runs **only synthetic mocked requests with a freshly
  generated fictional RSA key**, never real credentials or payroll data.
- Next: authorized isolated Next.js integration for actual row import and
  three-character PIN login, with no secret exposure; security cutover G6
  and G7/G8 approvals remain separate and blocked.
