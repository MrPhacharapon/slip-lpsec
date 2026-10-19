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
      const admin = code.indexOf("requireAdmin(req, true)");
      assert.ok(admin >= 0 && admin < gate,
        "public callers must retain the existing 401 admin denial");
      assert.ok(gate < code.indexOf("payrollDb()"));
      assert.ok(gate < code.indexOf("LINE_CHANNEL_ACCESS_TOKEN"));
    } else if (path.includes("line-webhook")) {
      const bounded = code.indexOf("readBoundedText(req");
      const signature = code.indexOf("verifyLineWebhookSignature(rawBody");
      const parse = code.indexOf("JSON.parse(rawBody)");
      assert.ok(bounded >= 0 && bounded < signature && signature < parse && parse < gate,
        "bounded body, signature and JSON validation must preserve webhook contract");
      assert.ok(gate < code.indexOf("LINE_CHANNEL_ACCESS_TOKEN"),
        "non-production must stop before provider credentials");
      assert.ok(gate < code.indexOf('fetch("https://api.line.me/'),
        "non-production must stop before provider network calls");
    } else {
      assert.ok(gate < code.indexOf("CRON_SECRET"));
      assert.ok(gate < code.indexOf("payrollDb()"));
    }
  });
}
