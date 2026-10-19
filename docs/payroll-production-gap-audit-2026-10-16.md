# Payroll release gap audit — 16 October 2026

**READ-ONLY evidence**, no Production changes. The audit selects only schema metadata, permission booleans, row/object counts and aggregate Storage sizes. No personnel names, bank numbers, salary figures, raw PDF content, original Storage paths, or private keys were inspected or recorded.

## Current Test versus Production gap

| Gate | Isolated Supabase Test | Legacy Production |
|---|---:|---:|
| RPCs required by new app (out of 8) | **8** | **0** |
| Relevant tables existing (out of 3) | **3** | **2** |
| Existing tables with RLS enabled | **3/3** | **0/2** |
| Unique index: slips owner/month/year | Yes | No |
| Unique index: history month/year | Yes | No |
| Storage bucket slips public | No | **Yes** |
| Anonymous SELECT grant on slips | No | **Yes** |

Existing Production payroll data was not modified: 338 slips, 9 upload histories, 12 Storage objects. All 12 objects have PDF MIME metadata and non-null byte sizes; total 63,741,850 bytes. History references 9 of those objects; the other 3 must be **retained in the backup** until their purpose has been reviewed privately.

## Production release dependencies

1. Export a private, independently restorable Production Database **and every Storage object**, including the three without a matching history reference. Verify an offline manifest and perform a successful restore in an authorized isolated environment.
2. Verify the new app's server-only Environment Variables through the authorized Vercel administrator interface. Do not push secrets to GitHub/CI. Current Vercel metadata does not list the required server-side Supabase/Admin/Rate-Limit/Origin/Staff Sheet/LINE webhook/Cron keys.
3. Prepare and rehearse the eight required RPCs and the rate-limit table in a separate private environment. Confirm unique owner/period and history/period constraints only after validating the existing records, never delete conflicts automatically.
4. Coordinate a single maintenance window for **both** Next.js deploy and Supabase ACL/RLS/Storage security changes; doing only one side will either break the existing app or leave payroll accessible through the old public Data API.
5. Test admin upload, publish, recover, search by ten-digit bank account, download one PDF, historical Storage access through admin, LINE notification, Cron, unauthorized direct REST/Storage denial, monitoring and rollback.
6. Obtain explicit authorization before touching Production schema, bucket permissions, application secrets, main branch or deployments.

## Current gate status

- Branch automated tests and synthetic browser/PDF.js cases have passed; this is not real-data PDF.js acceptance.
- An isolated PostgreSQL synthetic rollback rehearsal passed; this is **not** a restore from a Production backup.
- Full Next.js → actual Supabase Test REST API integration with a private Test-only service-role key has **not** run in this environment.
- No real PDF or private secret may be transferred to GitHub or CI.

**Overall: NO-GO**. The existing ten-digit bank-account user flow remains as approved; no additional end-user identity/OTP mechanism is introduced in this release.
