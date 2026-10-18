import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/test-isolated-next-api.mjs", import.meta.url));
const TEST_URL = "https://dpaqvxtbpaduknergflm.supabase.co";
const DUMMY_KEY = "DUMMY_ONLY_NOT_A_REAL_SUPABASE_KEY_01234567890123456789";

// Pass a deliberately minimal environment. Never inherit an operator's actual
// Supabase secrets or opt-in flags into the regression test subprocess.
function expectRefusal(env = {}) {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 15000,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Refusing to run: isolated test URL and private TEST credentials are required/);
  assert.equal(result.stdout.trim(), "");
}

test("isolated integration runner refuses execution without an explicit opt-in", () => {
  expectRefusal({
    TEST_SUPABASE_URL: TEST_URL,
    TEST_SUPABASE_SERVICE_ROLE_KEY: DUMMY_KEY,
  });
});

test("isolated integration runner refuses a non-test Supabase URL", () => {
  expectRefusal({
    TEST_SUPABASE_RUN: "I_UNDERSTAND_TEST_ONLY",
    TEST_SUPABASE_URL: "https://production-example.supabase.co",
    TEST_SUPABASE_SERVICE_ROLE_KEY: DUMMY_KEY,
  });
});

test("isolated integration runner refuses missing credentials", () => {
  expectRefusal({
    TEST_SUPABASE_RUN: "I_UNDERSTAND_TEST_ONLY",
    TEST_SUPABASE_URL: TEST_URL,
  });
});

test("success is reported only after the cleanup block", () => {
  const source = readFileSync(script, "utf8");
  const cleanupIndex = source.indexOf("} finally {");
  const successIndex = source.lastIndexOf('console.log("PASS: real Next.js APIs');
  assert.ok(cleanupIndex > -1 && successIndex > cleanupIndex);
  assert.match(source.slice(0, cleanupIndex), /assertionsCompleted = true;/);
  assert.doesNotMatch(source.slice(0, cleanupIndex), /console\.log\("PASS: real Next\.js APIs/);
});

test("isolated private Test runner refuses unverified or nonempty Storage BEFORE writes", () => {
  const source = readFileSync(script, "utf8");
  const preflight = source.slice(source.indexOf("async function assertEntireSandboxEmpty()"),
    source.indexOf("async function assertUnused("));
  assert.match(preflight, /db\.from\("slips"\)/);
  assert.match(preflight, /db\.from\("upload_history"\)/);
  assert.match(preflight, /db\.storage\.from\("slips"\)\.list\("", \{ limit: 1 \}\)/);
  assert.match(preflight, /db\.storage\.from\("slips"\)\.list\("qa", \{ limit: 1 \}\)/);
  assert.match(preflight, /rootStorage\.error \|\| qaStorage\.error/);
  assert.match(preflight, /rootStorage\.data\.length !== 0 \|\| qaStorage\.data\.length !== 0/);
  assert.ok(source.indexOf("await assertEntireSandboxEmpty()") <
    source.indexOf("await assertUnused(staged)"));
  assert.ok(source.indexOf("await assertEntireSandboxEmpty()") <
    source.indexOf("await startPrivateNext()"));
});

test("sandbox runner checks SQL and private Storage after cleanup", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /async function verifyCleanup\(\)/);
  assert.match(source, /await ensureOwnRecords\(period, allowedAccounts\)/);
  assert.match(source, /db\.storage\.from\("slips"\)\.list\("qa"/);
  assert.match(source, /try \{ await verifyCleanup\(\); \}/);
  assert.ok(source.lastIndexOf("await verifyCleanup()") < source.lastIndexOf('console.log("PASS: real Next.js APIs'));
});

test("optional anonymous check distinguishes permission denial from invalid API key", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /s\.error\?\.code, "42501"/);
  assert.match(source, /SKIP: anonymous RLS and private Storage checks/);
});
