import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("Admin login validates same origin, throttles, and caps JSON before password comparison", () => {
  const code = readFileSync("src/app/api/auth/route.ts", "utf8");
  const origin = code.indexOf("if (!sameOrigin(request))");
  const limit = code.indexOf('requirePayrollRateLimit(request, "admin_login")');
  const body = code.indexOf("readBoundedJson(request, 2048)");
  const compare = code.indexOf("verifyAdminPassword(password)");
  assert.ok(origin >= 0 && origin < limit && limit < body && body < compare);
  assert.match(code, /RequestPayloadTooLarge \? 413 : 400/);
  assert.match(code, /createAdminSession\(\)/);
  assert.doesNotMatch(code, /await request\.json\(\)/);
});
