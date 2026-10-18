import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedJson, RequestPayloadTooLarge } from "../src/lib/server/bounded-json.ts";

const url = "https://local.invalid/api/payroll/search";
function request(payload, extra = {}) {
  return new Request(url, { method: "POST", body: payload,
    headers: { "Content-Type": "application/json", ...(extra.headers ?? {}) } });
}

test("bounded JSON allows an exact-size legitimate lookup and Thai UTF-8", async () => {
  const payload = '{"bankAccount":"9000000123","month":"กันยายน"}';
  const size = Buffer.byteLength(payload);
  assert.deepEqual(await readBoundedJson(request(payload), size), {
    bankAccount: "9000000123", month: "กันยายน",
  });
});

test("bounded JSON refuses one byte too many without parsing or echoing values", async () => {
  const text = '{"bankAccount":"9000000123"}';
  await assert.rejects(readBoundedJson(request(text), Buffer.byteLength(text) - 1),
    e => e instanceof RequestPayloadTooLarge && !e.message.includes("9000000123"));
});

test("header rejects oversized claims even when the submitted body is short", async () => {
  await assert.rejects(readBoundedJson(request("{}", {
    headers: { "Content-Length": "1000000000" },
  }), 1024), RequestPayloadTooLarge);
});

test("streamed chunked input is limited by actual bytes, not the declared header", async () => {
  let cancelCalled = false;
  const payload = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"bankAccount":"'));
      controller.enqueue(new TextEncoder().encode("9".repeat(1024)));
    },
    cancel() { cancelCalled = true; },
  });
  const req = new Request(url, { method: "POST", body: payload, duplex: "half" });
  await assert.rejects(readBoundedJson(req, 1024), RequestPayloadTooLarge);
  assert.equal(cancelCalled, true, "stream is cancelled once the byte cap is reached");
});

test("malformed, missing and invalid UTF-8 JSON cannot reach application handlers", async () => {
  await assert.rejects(readBoundedJson(request('{"bankAccount":'), 1024), SyntaxError);
  const empty = new Request(url, { method: "POST" });
  await assert.rejects(readBoundedJson(empty, 1024), SyntaxError);
  const bad = request(Uint8Array.from([0x7b,0x22,0xc3,0x28,0x22,0x3a,0x31,0x7d]));
  await assert.rejects(readBoundedJson(bad, 1024), TypeError);
});

test("invalid policy cap fails safely rather than silently disabling limits", async () => {
  for (const limit of [0, -1, Infinity, NaN, 0.5])
    await assert.rejects(readBoundedJson(request("{}"), limit), RangeError);
});
