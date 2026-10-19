import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const a=readFileSync("docs/payroll-production-g6-phase-a-additive.sql","utf8");
const b=readFileSync("docs/payroll-production-g6-phase-b-lockdown.sql","utf8");
const r=readFileSync("docs/payroll-g6-phase-b-lockdown-rehearsal-test-only.sql","utf8");

test("Phase A is additive and deliberately leaves legacy access/storage untouched",()=>{
  assert.match(a,/\bBEGIN;[\s\S]*\bCOMMIT;\s*$/);
  assert.doesNotMatch(a,/ALTER TABLE public\.slips ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(a,/ALTER TABLE public\.upload_history ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(a,/UPDATE storage\.buckets/i);
  assert.doesNotMatch(a,/DROP POLICY/i);
  assert.doesNotMatch(a,/REVOKE ALL ON TABLE public\.slips/i);
  assert.doesNotMatch(a,/REVOKE ALL ON TABLE public\.upload_history/i);
  assert.match(a,/CREATE UNIQUE INDEX IF NOT EXISTS slips_unique_owner_period/);
  assert.match(a,/CREATE UNIQUE INDEX IF NOT EXISTS history_unique_period/);
  assert.match(a,/ADD COLUMN IF NOT EXISTS display_order integer/);
  assert.match(a,/CREATE TABLE IF NOT EXISTS public\.payroll_request_limits/i);
});
test("Phase A installs exactly eight server-only invoker RPC definitions",()=>{
  const fn=[...a.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/gi)].map(x=>x[1]);
  assert.equal(fn.length,8);
  assert.equal(new Set(fn).size,8);
  assert.ok((a.match(/SECURITY INVOKER/gi)||[]).length>=8);
  assert.doesNotMatch(a,/GRANT EXECUTE[^;]*TO (?:anon|authenticated|public)/i);
});
test("Phase B is security-only and never deletes payroll or Storage objects",()=>{
  assert.match(b,/ALTER TABLE public\.slips ENABLE ROW LEVEL SECURITY/i);
  assert.match(b,/ALTER TABLE public\.upload_history ENABLE ROW LEVEL SECURITY/i);
  assert.match(b,/REVOKE ALL ON TABLE public\.slips FROM PUBLIC, anon, authenticated/i);
  assert.match(b,/UPDATE storage\.buckets[\s\S]*public=false/i);
  assert.doesNotMatch(b,/CREATE OR REPLACE FUNCTION/i);
  assert.doesNotMatch(b,/DELETE\s+FROM\s+public\.(?:slips|upload_history)/i);
  assert.doesNotMatch(b,/DELETE\s+FROM\s+storage\.objects/i);
  assert.doesNotMatch(b,/DROP\s+TABLE/i);
  assert.doesNotMatch(b,/TRUNCATE/i);
});
test("Phase B fails closed on Storage policy drift and drops the reviewed four",()=>{
  assert.match(b,/Storage policy inventory changed; re-review before lockdown/);
  assert.match(b,/pg_policies[\s\S]*<> 4/);
  assert.match(b,/policyname NOT IN/);
  for(const n of ["0","1","2","3"])
    assert.match(b,new RegExp('DROP POLICY IF EXISTS "allow_all 1t7jg3_'+n+'" ON storage\\.objects'));
  assert.match(b,/Storage object policies remain after lockdown/);
});
test("Test rehearsal simulates legacy exposure then applies same lockdown primitives under rollback",()=>{
  assert.match(r,/ALTER TABLE public\.slips DISABLE ROW LEVEL SECURITY/i);
  assert.match(r,/SET public=true/);
  assert.match(r,/CREATE POLICY "allow_all 1t7jg3_0"/);
  for(const statement of [
    "ALTER TABLE public.slips ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON TABLE public.slips FROM PUBLIC, anon, authenticated",
    "REVOKE ALL ON TABLE public.upload_history FROM PUBLIC, anon, authenticated",
    'DROP POLICY IF EXISTS "allow_all 1t7jg3_0" ON storage.objects',
    'DROP POLICY IF EXISTS "allow_all 1t7jg3_3" ON storage.objects'
  ]) assert.ok(r.toLowerCase().includes(statement.toLowerCase()));
  assert.match(r,/ROLLBACK;\s*$/);
});
