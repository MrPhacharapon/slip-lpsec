import test from "node:test";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { verifyLineWebhookSignature } from "../src/lib/server/line-signature.ts";

const body = '{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}';
// These test values are published by LINE in its official docs, not credentials.
const sampleSecret = "8c570fa6dd201bb328f1c1eac23a96d8";
const exampleSignature = "GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=";

test("LINE's published valid example passes HMAC verification", () => {
  assert.equal(verifyLineWebhookSignature(body, exampleSignature, sampleSecret), true);
});
test("changed payload and missing or forged signatures are rejected", () => {
  assert.equal(verifyLineWebhookSignature(body + " ", exampleSignature, sampleSecret), false);
  assert.equal(verifyLineWebhookSignature(body, null, sampleSecret), false);
  assert.equal(verifyLineWebhookSignature(body, exampleSignature.slice(0,-1), sampleSecret), false);
  assert.equal(verifyLineWebhookSignature(body, exampleSignature, undefined), false);
});
test("webhook must have a valid length and encoding", () => {
  assert.equal(verifyLineWebhookSignature(body, "!".repeat(140), sampleSecret), false);
  assert.equal(verifyLineWebhookSignature("A".repeat(1_000_001), exampleSignature, sampleSecret), false);
});

test("malformed JSON can be correctly signed, allowing separate 400 handling", () => {
  const raw = '{"events":';
  const secret = "SYNTHETIC_ONLY_LINE_WEBHOOK_KEY_NOT_REAL";
  const hmac = createHmac("sha256", secret).update(Buffer.from(raw, "utf8")).digest("base64");
  assert.equal(verifyLineWebhookSignature(raw, hmac, secret), true);
  assert.throws(() => JSON.parse(raw), SyntaxError);
});
