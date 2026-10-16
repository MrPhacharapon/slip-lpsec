import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("LINE notification errors never echo untrusted upstream response bodies", () => {
  const source = readFileSync("src/app/api/send-line/route.ts", "utf8");
  assert.doesNotMatch(source, /response\.text\s*\(/);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\([^)]*errorText/);
  assert.match(source, /LINE notification failed with HTTP status/);
  assert.match(source, /LINE notification request failed/);
});
test("LINE webhook never logs an untrusted error object or raw body", () => {
  const source = readFileSync("src/app/api/line-webhook/route.ts", "utf8");
  assert.match(source, /verifyLineWebhookSignature\(rawBody/);
  assert.match(source, /LINE webhook processing failed/);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\([^)]*\b(?:error|rawBody)\b/);
});
