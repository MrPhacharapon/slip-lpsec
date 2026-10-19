import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files=[
  "src/app/page.tsx",
  "src/app/admin/page.tsx",
  "src/app/api/auth/route.ts",
  "src/app/api/admin/roster/route.ts",
  "src/lib/server/google-sheet-source.ts"
];
const code=files.map(p=>readFileSync(p,"utf8")).join("\n");
test("secured branch contains no browser-visible Google Spreadsheet URL literal",()=>{
  for(const p of ["src/app/page.tsx","src/app/admin/page.tsx"]){
    const s=readFileSync(p,"utf8");
    assert.doesNotMatch(s,/docs\.google\.com\/spreadsheets\/d\//i);
    assert.doesNotMatch(s,/NEXT_PUBLIC_STAFF_SHEET/i);
    assert.doesNotMatch(s,/NEXT_PUBLIC_GOOGLE/i);
  }
});
test("real roster source is server-side env only with no anonymous CSV fallback",()=>{
  const s=readFileSync("src/lib/server/google-sheet-source.ts","utf8");
  assert.match(s,/process\.env\.STAFF_SHEET_ID/);
  assert.match(s,/GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL/);
  assert.match(s,/GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.doesNotMatch(s,/docs\.google\.com/);
  assert.doesNotMatch(s,/export\?format=csv/i);
});
test("Admin and staff pages do not initialize Supabase directly",()=>{
  for(const p of ["src/app/page.tsx","src/app/admin/page.tsx"]){
    const s=readFileSync(p,"utf8");
    assert.doesNotMatch(s,/from\s+["']@\/lib\/supabase["']/);
    assert.doesNotMatch(s,/createClient\s*\(/);
    assert.doesNotMatch(s,/NEXT_PUBLIC_SUPABASE_/);
  }
});
