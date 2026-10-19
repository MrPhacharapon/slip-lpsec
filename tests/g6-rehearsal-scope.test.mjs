import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = "docs/payroll-g6-legacy-rehearsal-test-only.sql";
const sql = readFileSync(file, "utf8");
test("G6 rehearsal remains isolated from public production payroll objects", () => {
  assert.match(sql, /\bBEGIN\s*;/);
  assert.match(sql, /\bROLLBACK\s*;\s*$/);
  assert.match(sql, /CREATE SCHEMA payroll_rehearsal_20261019_g6/);
  assert.doesNotMatch(sql, /(?:ALTER|INSERT INTO|UPDATE|DELETE FROM|DROP)\s+(?:TABLE\s+)?public\.(?:slips|upload_history|payroll_request_limits)\b/i);
  assert.doesNotMatch(sql, /storage\.objects|storage\.buckets|cpwefjcpqykpxdumgogo|SERVICE_ROLE_KEY/i);
});
test("G6 rehearsal tests RLS, privileges, unique constraints and preservation", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql, /FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /GRANT SELECT,INSERT,UPDATE,DELETE/);
  assert.match(sql, /WHEN unique_violation THEN NULL/g);
  assert.match(sql, /Existing synthetic slip changed/);
  assert.match(sql, /Existing synthetic history changed/);
});
