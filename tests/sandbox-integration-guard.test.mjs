import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("real Supabase test script refuses to run without explicit isolated opt-in and private credentials", () => {
  const env = { ...process.env };
  delete env.TEST_SUPABASE_RUN;
  delete env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  delete env.TEST_SUPABASE_PUBLISHABLE_KEY;
  env.TEST_SUPABASE_URL = "https://production-should-never-be-used.supabase.co";
  const result = spawnSync(process.execPath, ["scripts/test-isolated-supabase-live.mjs"], {
    env, encoding: "utf8", timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to run: isolated test URL/);
});
