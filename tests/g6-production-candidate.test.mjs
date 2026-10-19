import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync("docs/payroll-production-security-migration-candidate.sql","utf8");
test("G6 candidate is one transaction and never removes payroll/storage objects",()=>{
  assert.match(sql,/^-- PRODUCTION CANDIDATE ONLY/);
  assert.match(sql,/\bBEGIN;[\s\S]*\bCOMMIT;\s*$/);
  assert.doesNotMatch(sql,/\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql,/\bTRUNCATE\b/i);
  assert.doesNotMatch(sql,/DELETE\s+FROM\s+storage\.objects/i);
  assert.doesNotMatch(sql,/\.remove\s*\(/i);
});
test("G6 candidate hardens all payroll tables and private Storage",()=>{
  for(const table of ["slips","upload_history","payroll_request_limits"]){
    assert.match(sql,new RegExp("ALTER TABLE public\\."+table+" ENABLE ROW LEVEL SECURITY","i"));
  }
  assert.match(sql,/UPDATE storage\.buckets[\s\S]*public = false/i);
  assert.match(sql,/file_size_limit = 10485760/);
  assert.match(sql,/allowed_mime_types = ARRAY\['application\/pdf'\]::text\[\]/);
  for(const suffix of ["0","1","2","3"])
    assert.match(sql,new RegExp('DROP POLICY IF EXISTS "allow_all 1t7jg3_'+suffix+'"'));
});
test("G6 candidate keeps browser roles out and defines exactly eight invoker RPCs",()=>{
  assert.doesNotMatch(sql,/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*\bTO\s+(?:anon|authenticated)\b/i);
  const fn=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/gi)].map(x=>x[1]);
  assert.deepEqual(new Set(fn).size,8);
  assert.equal(fn.length,8);
  assert.equal((sql.match(/SECURITY INVOKER/gi)||[]).length>=8,true);
  assert.match(sql,/REVOKE ALL ON TABLE public\.slips FROM PUBLIC, anon, authenticated/i);
  assert.match(sql,/REVOKE ALL ON TABLE public\.upload_history FROM PUBLIC, anon, authenticated/i);
});
test("G6 candidate creates required business constraints without touching audit timestamps",()=>{
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS slips_unique_owner_period/);
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS history_unique_period/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS display_order integer/);
  assert.doesNotMatch(sql,/SET\s+created_at\s*=/i);
  assert.doesNotMatch(sql,/UPDATE\s+public\.upload_history[\s\S]{0,120}created_at/i);
});
test("G6 candidate defines deletion RPCs but never invokes them during migration",()=>{
  assert.match(sql,/FUNCTION public\.delete_published_payroll_period/);
  assert.match(sql,/FUNCTION public\.discard_unpublished_payroll_period/);
  assert.doesNotMatch(sql,/PERFORM\s+public\.delete_published_payroll_period/i);
  assert.doesNotMatch(sql,/SELECT\s+public\.delete_published_payroll_period/i);
  assert.doesNotMatch(sql,/PERFORM\s+public\.discard_unpublished_payroll_period/i);
  assert.doesNotMatch(sql,/SELECT\s+public\.discard_unpublished_payroll_period/i);
});
