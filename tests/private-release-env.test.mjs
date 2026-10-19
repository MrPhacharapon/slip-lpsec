import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = "scripts/check-private-release-env.mjs";
const fixture = {
  PAYROLL_RELEASE_TARGET: "test",
  CRON_SECRET: "FICTIONAL_ONLY_CRON_SECRET_12345678",
  LINE_CHANNEL_SECRET: "FICTIONAL_ONLY_LINE_CHANNEL_SECRET_23456789",
  LINE_CHANNEL_ACCESS_TOKEN: "FICTIONAL_ONLY_LINE_ACCESS_TOKEN_34567890",
  LINE_GROUP_ID: "FICTIONAL_ONLY_LINE_GROUP_45678901",
  STAFF_DIRECTORY_DISABLED: "true",
  PAYROLL_ROSTER_MODE: "server_sheet",
  STAFF_SHEET_ACCESS_MODE: "service_account",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "fake-operator@synthetic-project.iam.gserviceaccount.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nFICTIONAL_TEST_KEY_NOT_VALID\\n-----END PRIVATE KEY-----",
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
test("Production must select a roster mode explicitly, never default silently", () => {
  const r = check({
    PAYROLL_RELEASE_TARGET: "production",
    PAYROLL_ROSTER_MODE: null,
    STAFF_DIRECTORY_DISABLED: "false",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
  });
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).missingOrInvalid.includes("PAYROLL_ROSTER_MODE"));
});

test("Production server_sheet refuses omitted or mistyped roster enabled flag", () => {
  for (const status of [null, "FALSE", "enabled", "true"]) {
    const r = check({
      PAYROLL_RELEASE_TARGET: "production",
      PAYROLL_ROSTER_MODE: "server_sheet",
      STAFF_DIRECTORY_DISABLED: status,
      SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
      NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    });
    assert.equal(r.status, 1);
    assert.ok(JSON.parse(r.stdout).missingOrInvalid.includes("STAFF_DIRECTORY_DISABLED"));
  }
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

test("Production fails closed when LINE signing key or cron authorization is missing", () => {
  const r = check({
    PAYROLL_RELEASE_TARGET: "production",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    STAFF_DIRECTORY_DISABLED: "false",
    CRON_SECRET: null,
    LINE_CHANNEL_SECRET: null,
  });
  assert.equal(r.status, 1);
  const e = JSON.parse(r.stdout).missingOrInvalid;
  assert.ok(e.includes("CRON_SECRET"));
  assert.ok(e.includes("LINE_CHANNEL_SECRET"));
});
test("Production rejects duplicated cron secret and rate limit key", () => {
  const r = check({
    PAYROLL_RELEASE_TARGET: "production",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    STAFF_DIRECTORY_DISABLED: "false",
    CRON_SECRET: fixture.PAYROLL_RATE_LIMIT_SECRET,
  });
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).missingOrInvalid.includes("SECRET_REUSE"));
});

test("sheet ID format must match the actual staff-directory loader", () => {
  for (const id of ["1234567890123456789", "x".repeat(101), "invalid%filename"]) {
    const result = check({
      PAYROLL_RELEASE_TARGET: "production",
      SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
      NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
      STAFF_DIRECTORY_DISABLED: "false",
      STAFF_SHEET_ID: id,
    });
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).missingOrInvalid.includes("STAFF_SHEET_ID"));
  }
});

test("private CSV Production mode does not require a public Sheet ID", () => {
  const result = check({
    PAYROLL_RELEASE_TARGET: "production",
    PAYROLL_ROSTER_MODE: "local_csv",
    STAFF_DIRECTORY_DISABLED: "true",
    STAFF_SHEET_ID: null,
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
  });
  assert.equal(result.status, 0, result.stdout);
});
test("private CSV mode refuses staff directory access and unknown modes", () => {
  const prod = {
    PAYROLL_RELEASE_TARGET: "production",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
  };
  const wrong = check({ ...prod, PAYROLL_ROSTER_MODE: "local_csv",
    STAFF_DIRECTORY_DISABLED: "false", STAFF_SHEET_ID: null });
  assert.equal(wrong.status, 1);
  assert.ok(JSON.parse(wrong.stdout).missingOrInvalid.includes("STAFF_DIRECTORY_DISABLED"));
  const invalid = check({ ...prod, PAYROLL_ROSTER_MODE: "anything" });
  assert.equal(invalid.status, 1);
  assert.ok(JSON.parse(invalid.stdout).missingOrInvalid.includes("PAYROLL_ROSTER_MODE"));
});

test("release preflight rejects any browser-exposed payroll server-only configuration", () => {
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_ADMIN_PASSWORD",
    "NEXT_PUBLIC_ADMIN_SESSION_SECRET",
    "NEXT_PUBLIC_PAYROLL_RATE_LIMIT_SECRET",
    "NEXT_PUBLIC_CRON_SECRET",
    "NEXT_PUBLIC_LINE_CHANNEL_SECRET",
    "NEXT_PUBLIC_LINE_CHANNEL_ACCESS_TOKEN",
    "NEXT_PUBLIC_LINE_GROUP_ID",
    "NEXT_PUBLIC_STAFF_SHEET_ID",
  ]) {
    const result = check({ [key]: "FICTIONAL_TEST_VALUE_NOT_A_REAL_SECRET" });
    assert.equal(result.status, 1, key + " must fail before release");
    assert.ok(JSON.parse(result.stdout).missingOrInvalid.includes(key));
    assert.ok(!result.stdout.includes("FICTIONAL_TEST_VALUE_NOT_A_REAL_SECRET"));
  }
});

test("release preflight also rejects an empty server-only NEXT_PUBLIC_ variable", () => {
  const result = check({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "" });
  assert.equal(result.status, 1);
  assert.ok(JSON.parse(result.stdout).missingOrInvalid
    .includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"));
});

test("Production server_sheet blocks anonymous CSV access mode and missing Google service account", () => {
  const prod = {
    PAYROLL_RELEASE_TARGET: "production",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    STAFF_DIRECTORY_DISABLED: "false",
  };
  const legacy = check({ ...prod, STAFF_SHEET_ACCESS_MODE: "public_csv" });
  assert.equal(legacy.status, 1);
  assert.ok(JSON.parse(legacy.stdout).missingOrInvalid.includes("STAFF_SHEET_ACCESS_MODE"));
  const missing = check({ ...prod, GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: null });
  assert.equal(missing.status, 1);
  assert.ok(JSON.parse(missing.stdout).missingOrInvalid.includes("GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY"));
});

test("private Google service account credentials never appear in release preflight output", () => {
  const r = check({
    PAYROLL_RELEASE_TARGET: "production",
    SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    NEXT_PUBLIC_SUPABASE_URL: "https://cpwefjcpqykpxdumgogo.supabase.co",
    STAFF_DIRECTORY_DISABLED: "false",
    NEXT_PUBLIC_GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: "FICTIONAL_PUBLIC_LEAK_TEST",
  });
  assert.equal(r.status, 1);
  const p = JSON.parse(r.stdout);
  assert.ok(p.missingOrInvalid.includes("NEXT_PUBLIC_GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY"));
  assert.ok(!r.stdout.includes("FICTIONAL_PUBLIC_LEAK_TEST"));
});
