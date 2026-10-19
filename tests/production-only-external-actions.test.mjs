import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const path of [
  "src/app/api/send-line/route.ts",
  "src/app/api/line-webhook/route.ts",
  "src/app/api/keep-alive/route.ts",
]) {
  test(path + " refuses non-production release targets before privileged work", () => {
    const code = readFileSync(path, "utf8");
    const gate = code.indexOf('process.env.PAYROLL_RELEASE_TARGET !== "production"');
    assert.ok(gate >= 0, "missing production release gate");
    if (path.includes("send-line")) {
      assert.ok(gate < code.indexOf("requireAdmin(req, true)"));
      assert.ok(gate < code.indexOf("LINE_CHANNEL_ACCESS_TOKEN"));
    } else if (path.includes("line-webhook")) {
      assert.ok(gate < code.indexOf("readBoundedText(req"));
      assert.ok(gate < code.indexOf("LINE_CHANNEL_ACCESS_TOKEN"));
    } else {
      assert.ok(gate < code.indexOf("CRON_SECRET"));
      assert.ok(gate < code.indexOf("payrollDb()"));
    }
  });
}
