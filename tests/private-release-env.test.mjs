import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = "scripts/check-private-release-env.mjs";
const fixture = {
  PAYROLL_RELEASE_TARGET: "test",
  STAFF_DIRECTORY_DISABLED: "true",
  SUPABASE_URL: "https://dpaqvxtbpaduknergflm.supabase.co",
  NEXT_PUBLIC_SUPABASE_URL: "https://dpaqvxtbpaduknergflm.supabase.co",
  APP_ORIGIN: "https://private-fixture.example.invalid",
  STAFF_SHEET_ID: "SYNTHETIC_FAKE_ROSTER_SHEET_ID_0001",
  SUPABASE_SERVICE_ROLE_KEY: "SYNTHETIC_TEST_ONLY_SECRET_KEY_1_1234567890",
  ADMIN_PASSWORD: "SYNTHETIC_TEST_ONLY_ADMIN_PASS_2",
  ADMIN_SESSION_SECRET: "SYNTHETIC_TEST_ONLY_SESSION_SECRET_3_1234567890",
  PAYROLL_RATE_LIMIT_SECRET: "SYNTHETIC_TEST_ONLY_RATE_LIMIT_SECRET_4_1234567890",
};
function check(modifications = {}, args = []) {
  const env = { PATH: process.env.PATH || "", ...fixture, ...modifications };
  for (const key of Object.keys(env)) if (env[key] === null) delete env[key];
  const r = spawnSync(process.execPath, [script, ...args],
    { env, encoding: "utf8", timeout: 12000 });
  assert.equal(r.error, undefined);
  for (const secret of [fixture.SUPABASE_SERVICE_ROLE_KEY, fixture.ADMIN_PASSWORD,
    fixture.ADMIN_SESSION_SECRET, fixture.PAYROLL_RATE_LIMIT_SECRET]) {
    assert.ok(!(r.stdout + r.stderr).includes(secret),
      "release preflight must never print configuration values");
  }
  return r;
}
test("release preflight accepts only a complete private fictional test configuration", () => {
  const r = check();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).missingOrInvalid, []);
});
test("release preflight blocks missing server-only secrets and mismatched project", () => {
  const r = check({ SUPABASE_SERVICE_ROLE_KEY: null,
    SUPABASE_URL: "https://wrong-project.example.invalid" });
  assert.equal(r.status, 1);
  const e = JSON.parse(r.stdout).missingOrInvalid;
  assert.ok(e.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(e.includes("SUPABASE_URL_TARGET"));
});
test("release preflight refuses HTTP origin and accidentally reused secrets", () => {
  const r = check({ APP_ORIGIN: "http://private-fixture.example.invalid",
    ADMIN_SESSION_SECRET: fixture.PAYROLL_RATE_LIMIT_SECRET });
  assert.equal(r.status, 1);
  const e = JSON.parse(r.stdout).missingOrInvalid;
  assert.ok(e.includes("APP_ORIGIN"));
  assert.ok(e.includes("SECRET_REUSE"));
});
test("release preflight refuses mismatched public and server Supabase target", () => {
  const r = check({ NEXT_PUBLIC_SUPABASE_URL: "https://another.example.invalid" });
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).missingOrInvalid.includes("NEXT_PUBLIC_SUPABASE_URL_TARGET"));
});
test("release preflight never executes arguments as commands", () => {
  const r = check({}, ["--unknown"]);
  assert.equal(r.status, 2);
});

test("isolated Test permits disabled staff directory without a real roster", () => {
  const r = check({ STAFF_DIRECTORY_DISABLED: "true", STAFF_SHEET_ID: null });
  assert.equal(r.status, 0, r.stderr);
});
test("Production requires a real directory and rejects a disabled directory flag", () => {
  const r = check({
    PAYROLL_RELEASE_TARGET: "production",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    STAFF_DIRECTORY_DISABLED: "true",
    STAFF_SHEET_ID: null,
  });
  assert.equal(r.status, 1);
  const violations = JSON.parse(r.stdout).missingOrInvalid;
  assert.ok(violations.includes("STAFF_SHEET_ID"));
  assert.ok(violations.includes("STAFF_DIRECTORY_DISABLED"));
});
test("Production accepts explicit directory access with correct non-secret metadata", () => {
  const r = check({
    PAYROLL_RELEASE_TARGET: "production",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    STAFF_DIRECTORY_DISABLED: "false",
  });
  assert.equal(r.status, 0, r.stderr);
});
test("Test must refuse an enabled staff directory to prevent reaching real Sheets", () => {
  for (const value of ["false", null]) {
    const r = check({ STAFF_DIRECTORY_DISABLED: value });
    assert.equal(r.status, 1);
    assert.ok(JSON.parse(r.stdout).missingOrInvalid.includes("STAFF_DIRECTORY_DISABLED"));
  }
});
