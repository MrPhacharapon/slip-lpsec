import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePrivateAdminSettingsTitle, parsePrivateAdminSettingsPin,
} from "../src/lib/server/google-sheet-payload.ts";

const fake = (values) => ({ values });

test("Settings tab lookup rejects absent and ambiguous metadata", () => {
  assert.equal(parsePrivateAdminSettingsTitle({ sheets: [
    { properties: { sheetId: 0, title: "Roster" } },
    { properties: { sheetId: 5, title: "Settings" } },
  ] }), "Settings");
  for (const bad of [null, {}, { sheets: [] },
    { sheets: [{ properties: { title: "settings", sheetId: 1 } }] },
    { sheets: [
      { properties: { title: "Settings", sheetId: 1 } },
      { properties: { title: "Settings", sheetId: 2 } },
    ] },
  ]) assert.throws(() => parsePrivateAdminSettingsTitle(bad));
});
test("Private Settings keeps the legacy adjacent-cell and next-row PIN layouts", () => {
  assert.equal(parsePrivateAdminSettingsPin(fake([
    ["รหัสผ่านแอดมิน", "001"],
  ])), "001");
  assert.equal(parsePrivateAdminSettingsPin(fake([
    ["Header", "Value"], ["รหัสผ่านแอดมิน", ""], ["A7B"],
  ])), "A7B");
});
test("Private Settings refuses duplicate labels, malformed values and empty PIN", () => {
  for (const bad of [
    null, {}, fake([]), fake([["รหัสผ่านแอดมิน"]]),
    fake([["รหัสผ่านแอดมิน",""]]),
    fake([["รหัสผ่านแอดมิน", "1234"]]),
    fake([["รหัสผ่านแอดมิน", "12"]]),
    fake([["รหัสผ่านแอดมิน", 123]]),
    fake([["รหัสผ่านแอดมิน","123","UNEXPECTED"]]),
    fake([["รหัสผ่านแอดมิน","123"],["รหัสผ่านแอดมิน","456"]]),
    fake([["รหัสผ่านแอดมิน","1 3"]]),
  ]) assert.throws(() => parsePrivateAdminSettingsPin(bad));
});
test("PIN errors never contain supplied PIN or Google Settings contents", () => {
  const sentinel = "FICTIONAL_PRIVATE_PIN_NOT_REAL";
  try {
    parsePrivateAdminSettingsPin(fake([["รหัสผ่านแอดมิน",sentinel]]));
    assert.fail("invalid PIN accepted");
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(!e.message.includes(sentinel));
  }
});
test("Production Admin PIN uses private service account and strict fail-closed quota", () => {
  const auth = readFileSync("src/app/api/auth/route.ts","utf8");
  const pin = readFileSync("src/lib/server/admin-pin-source.ts","utf8");
  const sheets = readFileSync("src/lib/server/google-sheet-source.ts","utf8");
  const limit = readFileSync("src/lib/server/payroll-rate-limit.ts","utf8");
  assert.match(auth, /process\.env\.PAYROLL_RELEASE_TARGET === "production"/);
  assert.match(auth, /await verifyPrivateAdminPin\(password\)/);
  assert.match(sheets, /loadPrivateSheetPayload\("admin_pin"\)/);
  assert.doesNotMatch(sheets, /\/export\?format=csv/);
  assert.match(pin, /timingSafeEqual/);
  assert.match(limit, /shortPin \? \{ perIp: 3 \}/);
  assert.match(limit, /max: 10/);
});
