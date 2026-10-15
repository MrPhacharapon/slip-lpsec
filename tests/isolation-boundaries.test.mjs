import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const get = path => readFileSync(path, "utf8");

test("admin UI never preloads a real staff roster", () => {
  const admin = get("src/app/admin/page.tsx");
  assert.match(admin, /useState\(process\.env\.NEXT_PUBLIC_STAFF_SHEET_URL \|\| ""\)/);
  assert.doesNotMatch(admin, /useState\("https:\/\/docs\.google\.com\/spreadsheets\//);
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
  assert.match(source, /const sheetId = process\.env\.STAFF_SHEET_ID/);
  assert.doesNotMatch(source, /const sheetId = process\.env\.STAFF_SHEET_ID\s*\|\|/);
});

test("CI uses a fictional roster URL", () => {
  const source = get(".github/workflows/payroll-pdf-validation.yml");
  assert.match(source, /NEXT_PUBLIC_STAFF_SHEET_URL: https:\/\/docs\.google\.com\/spreadsheets\/d\/TEST_ROSTER_FAKE/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY:\s*[^\s#]+/);
});
