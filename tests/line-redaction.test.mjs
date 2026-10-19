import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("LINE notification errors never echo untrusted upstream response bodies", () => {
  const source = readFileSync("src/app/api/send-line/route.ts", "utf8");
  assert.doesNotMatch(source, /response\.text\s*\(/);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\([^)]*errorText/);
  assert.match(source, /LINE notification failed with HTTP status/);
  assert.match(source, /LINE notification request failed/);
  assert.match(source, /signal: AbortSignal\.timeout\(8000\)/);
  assert.match(source, /Payroll period is not published/);
});
test("LINE webhook never logs an untrusted error object or raw body", () => {
  const source = readFileSync("src/app/api/line-webhook/route.ts", "utf8");
  assert.match(source, /verifyLineWebhookSignature\(rawBody/);
  assert.match(source, /readBoundedText\(req, 1_000_000\)/);
  assert.match(source, /RequestPayloadTooLarge/);
  assert.match(source, /LINE webhook processing failed/);
  assert.match(source, /collectLineGroupReplies\(body\.events\)/);
  assert.match(source, /Promise\.allSettled/);
  const eventParser = readFileSync("src/lib/server/line-webhook-events.ts", "utf8");
  assert.match(eventParser, /event\?\.source\?\.type/);
  assert.match(eventParser, /event\.message\?\.type/);
  assert.match(eventParser, /typeof event\.message\.text === "string"/);
  assert.match(source, /signal: AbortSignal\.timeout\(8000\)/);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\([^)]*\b(?:error|rawBody)\b/);
  assert.match(source, /LINE webhook reply failed/);
  assert.doesNotMatch(source, /response\.text\s*\(/);
});
