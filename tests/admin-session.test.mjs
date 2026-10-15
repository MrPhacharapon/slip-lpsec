import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_COOKIE, createAdminSession, verifyAdminPassword, verifyAdminSession, sameOrigin } from "../src/lib/server/admin-session.ts";

process.env.ADMIN_PASSWORD = "synthetic-admin-password-only";
process.env.ADMIN_SESSION_SECRET = "synthetic-hmac-test-secret-longer-than-32-chars";
process.env.APP_ORIGIN = "http://127.0.0.1:3100";

test("correct password accepts, wrong password rejects", () => {
  assert.equal(verifyAdminPassword("synthetic-admin-password-only"), true);
  assert.equal(verifyAdminPassword("guess"), false);
  assert.equal(verifyAdminPassword(null), false);
});
test("cookie carries signature and expires", () => {
  assert.equal(ADMIN_COOKIE, "payroll_admin_session");
  const issued = Date.now();
  const token = createAdminSession(issued);
  assert.equal(verifyAdminSession(token, issued), true);
  assert.equal(verifyAdminSession(token, issued + 5*60*60*1000), false);
});
test("tampered or forged session must fail", () => {
  const token = createAdminSession();
  const [body,signature] = token.split(".");
  assert.equal(verifyAdminSession(body + "." + signature.slice(0,-1) + "a"), false);
  assert.equal(verifyAdminSession("", Date.now()), false);
  assert.equal(verifyAdminSession("abc.def"), false);
});
test("cross-origin POST is rejected by origin gate", () => {
  const req = (origin) => new Request("http://127.0.0.1:3100/api/auth", {
    method: "POST", headers: origin ? { Origin: origin } : {},
  });
  assert.equal(sameOrigin(req("http://127.0.0.1:3100")), true);
  assert.equal(sameOrigin(req("https://attacker.invalid")), false);
  assert.equal(sameOrigin(req(undefined)), false);
});
