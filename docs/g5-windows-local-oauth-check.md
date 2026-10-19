# G5 — Private Google Sheets check on Windows (operator only)

## Before starting

You have configured seven secret *names* in Vercel Production and shared
the original spreadsheet with a dedicated Google Service Account (Viewer).
This test is intentionally local: never upload the downloaded JSON key
to GitHub, ChatGPT, CI, a public terminal, or the repository folder.

## Steps

1. In GitHub select branch: fix/payroll-pdf-validation-no-deploy.
   Click Code -> Download ZIP, then extract it on your own Windows PC.
2. Ensure Node.js 22+ is installed. Check with PowerShell: node -v
3. Use File Explorer to open the extracted project root (contains scripts).
   In the address bar type: powershell
4. In the new PowerShell window enter:
   node scripts/check-private-google-sheets-local.mjs
5. When asked for your key file, drag the previously downloaded JSON file
   into PowerShell. Press Enter. Never paste the JSON contents themselves.
6. When asked for your Sheet URL, paste the original roster spreadsheet
   browser URL; press Enter. Do not post its URL in chat.
7. Send only the single result word PASS or NO_GO back to the assistant.
   Do not send screenshots of credentials, browser tabs or personnel data.

The helper reads the JSON only on your own PC, calls Google OAuth, then
requests only tab titles and IDs from Google Sheets metadata. It never
fetches spreadsheet values, staff bank accounts or admin PIN. It never
updates Google sharing, Supabase or Vercel.

The result is generic:
{"result":"PASS","checks":"private-google-oauth-and-tab-metadata"}
or {"result":"NO_GO","checks":"private-google-metadata"}

A local PASS is not a Production deployment or complete live integration
test and does not prove that the key copied into Vercel is identical.
If NO_GO, do not share any keys or loosen Google Sheet permissions.
Keep the existing website unchanged; G6/G8 are still NO-GO.
