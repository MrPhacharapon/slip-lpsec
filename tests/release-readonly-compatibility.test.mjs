import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("legacy schema audit is a privacy-preserving read-only inspection", () => {
  const sql=readFileSync("docs/payroll-legacy-schema-compatibility-readonly.sql","utf8");
  const withoutComments=sql.split("\n").filter(x=>!x.trim().startsWith("--")).join("\n");
  assert.match(withoutComments,/^WITH\s+required\(/);
  assert.match(withoutComments,/legacy_columns_compatible/);
  assert.match(withoutComments,/duplicate_slip_groups/);
  assert.match(withoutComments,/payroll_tables_rls_enabled/);
  assert.match(withoutComments,/anonymous_table_access_revoked/);
  assert.match(withoutComments,/storage_without_history/);
  assert.match(withoutComments,/history_missing_storage/);
  assert.doesNotMatch(withoutComments,/\b(?:INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE|UPDATE\s+public\.|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(withoutComments,/\bSELECT\s+(?:\*|name|bank_account|pdf_base64|storage_path)\s+FROM\b/i);
  assert.doesNotMatch(withoutComments,/https?:\/\/|SUPABASE_SERVICE_ROLE_KEY/);
});
