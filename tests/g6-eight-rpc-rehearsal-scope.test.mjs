import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync("docs/payroll-g6-eight-rpc-rehearsal-test-only.sql","utf8");

test("all eight G6 RPCs are covered only in a rollback-scoped TEST fixture",()=>{
  assert.match(sql, /dpaqvxtbpaduknergflm/);
  assert.match(sql, /BEGIN\s*;/);
  assert.match(sql, /ROLLBACK\s*;\s*$/);
  assert.doesNotMatch(sql, /cpwefjcpqykpxdumgogo/);
  for(const name of [
    "check_payroll_rate_limit","stage_payroll_slips","publish_payroll_period",
    "inspect_unpublished_payroll_period","discard_unpublished_payroll_period",
    "inspect_published_payroll_deletion","delete_published_payroll_period",
    "reorder_payroll_history"
  ]) assert.ok(sql.includes("public."+name));
});
test("G6 Test fixture checks empty/private sandbox and stale snapshots",()=>{
  assert.match(sql, /FROM storage\.objects WHERE bucket_id='slips'/);
  assert.match(sql, /FROM storage\.buckets WHERE id='slips'/);
  assert.match(sql, /SQLSTATE '40001'/);
  assert.match(sql, /Stale staged snapshot did not fail closed/);
  assert.match(sql, /Stale published snapshot did not fail closed/);
});
