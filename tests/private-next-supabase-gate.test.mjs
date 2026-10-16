import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const runner = "scripts/test-isolated-next-api.mjs";
const testUrl = "https://dpaqvxtbpaduknergflm.supabase.co";
const fakeCredential = "SYNTHETIC_FAKE_KEY_NOT_VALID_" + "x".repeat(64);

function run(vars) {
  const env = { ...process.env };
  for (const key of ["TEST_SUPABASE_RUN", "TEST_SUPABASE_URL",
    "TEST_SUPABASE_SERVICE_ROLE_KEY", "TEST_SUPABASE_PUBLISHABLE_KEY"]) {
    delete env[key];
  }
  Object.assign(env, vars);
  return spawnSync(process.execPath, [runner], {
    cwd: process.cwd(), env, encoding: "utf8", timeout: 15000,
  });
}

test("private Next.js integration refuses missing opt-in or service secret", () => {
  for (const overrides of [
    {},
    { TEST_SUPABASE_URL: testUrl,
      TEST_SUPABASE_SERVICE_ROLE_KEY: fakeCredential },
    { TEST_SUPABASE_RUN: "I_UNDERSTAND_TEST_ONLY",
      TEST_SUPABASE_URL: testUrl },
  ]) {
    const result = run(overrides);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to run: isolated test URL and private TEST credentials are required/);
    assert.ok(!result.stderr.includes(fakeCredential));
  }
});

test("private Next.js integration refuses an unapproved Supabase URL", () => {
  const result = run({
    TEST_SUPABASE_RUN: "I_UNDERSTAND_TEST_ONLY",
    TEST_SUPABASE_URL: "https://different-project.supabase.co",
    TEST_SUPABASE_SERVICE_ROLE_KEY: fakeCredential,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr,
    /Refusing to run: isolated test URL and private TEST credentials are required/);
  assert.ok(!result.stderr.includes(fakeCredential));
});
