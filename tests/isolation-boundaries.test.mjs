import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const get = path => readFileSync(path, "utf8");

test("admin UI fetches its roster via authorized server, never public browser URL", () => {
  const admin = get("src/app/admin/page.tsx");
  assert.match(admin, /fetch\("\/api\/admin\/roster"/);
  assert.doesNotMatch(admin, /NEXT_PUBLIC_STAFF_SHEET_URL/);
  assert.doesNotMatch(admin, /docs\.google\.com\/spreadsheets/);
  assert.doesNotMatch(admin, /sheetUrl/);
  const api = get("src/app/api/admin/roster/route.ts");
  assert.match(api, /requireAdmin\(req\)/);
  assert.match(api, /serverSheetRosterEnabled/);
  const guard = get("src/lib/server/roster-config.ts");
  assert.match(guard, /PAYROLL_RELEASE_TARGET/);
  assert.match(guard, /PAYROLL_ROSTER_MODE/);
  assert.match(guard, /STAFF_DIRECTORY_DISABLED/);
  assert.match(api, /loadPrivateStaffSheetRows/);
  const loader = get("src/lib/server/google-sheet-source.ts");
  assert.match(loader, /process\.env\.STAFF_SHEET_ID/);
  assert.match(loader, /STAFF_SHEET_ACCESS_MODE/);
  assert.doesNotMatch(loader, /\/export\?format=csv/);
  assert.doesNotMatch(api, /req\.nextUrl\.searchParams/);
});

test("neither payroll UI uses browser Supabase access", () => {
  for (const path of ["src/app/page.tsx", "src/app/admin/page.tsx"]) {
    const source = get(path);
    assert.doesNotMatch(source, /from\s+["']@\/lib\/supabase["']/);
    assert.doesNotMatch(source, /supabase\.from\s*\(/);
  }
});

test("staff directory has no hard-coded Google Sheets identifier fallback", () => {
  const source = get("src/lib/server/staff-directory.ts");
  assert.match(source, /loadPrivateStaffSheetRows/);
  assert.match(source, /serverSheetRosterEnabled/);
  const loader = get("src/lib/server/google-sheet-source.ts");
  assert.match(loader, /const id = process\.env\.STAFF_SHEET_ID/);
  assert.doesNotMatch(loader, /const id = process\.env\.STAFF_SHEET_ID\s*\|\|/);
  assert.doesNotMatch(loader, /docs\.google\.com\/spreadsheets/);
});

test("CI does not supply a public staff roster URL or private payroll key", () => {
  const source = get(".github/workflows/payroll-pdf-validation.yml");
  assert.doesNotMatch(source, /NEXT_PUBLIC_STAFF_SHEET_URL:/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY:\s*[^\s#]+/);
});
