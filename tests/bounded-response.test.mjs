import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedResponseText, ResponsePayloadTooLarge } from "../src/lib/server/bounded-response.ts";
import { readFileSync } from "node:fs";

function csvResponse(source, headers={}) {
  return new Response(source, { headers });
}

test("staff CSV reader accepts Thai names at the exact UTF-8 byte limit", async () => {
  const csv = "ชื่อสมมติ,ตำแหน่งสมมติ,9000000123,1234567\n";
  const bytes = Buffer.byteLength(csv, "utf8");
  assert.equal(await readBoundedResponseText(csvResponse(csv), bytes), csv);
  assert.ok(bytes > csv.length, "limit is applied to bytes, not JS characters");
});
test("staff CSV reader rejects one byte over the limit", async () => {
  const csv = "SIMULATED_ONLY,9999999,9000000123\n";
  await assert.rejects(readBoundedResponseText(csvResponse(csv), Buffer.byteLength(csv)-1),
    error => error instanceof ResponsePayloadTooLarge &&
      !error.message.includes("9000000123"));
});
test("staff CSV reader rejects forged oversized Content-Length before parsing", async () => {
  const res = csvResponse("small", { "Content-Length": "9999999999" });
  await assert.rejects(readBoundedResponseText(res, 1024), ResponsePayloadTooLarge);
});
test("chunked upstream stream cannot bypass a small limit or hide inside one chunk", async () => {
  let cancelled = false;
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("A".repeat(512)));
      controller.enqueue(new TextEncoder().encode("B".repeat(513)));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBoundedResponseText(csvResponse(readable), 1024),
    ResponsePayloadTooLarge);
  assert.equal(cancelled, true);
});
test("CSV decoding fails closed for invalid UTF-8 and absent body", async () => {
  const bytes = Uint8Array.from([0xc3, 0x28]);
  await assert.rejects(readBoundedResponseText(csvResponse(bytes), 1024), TypeError);
  await assert.rejects(readBoundedResponseText(csvResponse(null), 1024), TypeError);
});
test("invalid byte caps cannot silently turn protection off", async () => {
  for (const limit of [0, -1, NaN, Infinity, 0.5]) {
    await assert.rejects(readBoundedResponseText(csvResponse("x"), limit), RangeError);
  }
});
test("both Google Sheets ingestion paths enforce streaming bytes before parsing", () => {
  const directory = readFileSync("src/lib/server/staff-directory.ts", "utf8");
  const admin = readFileSync("src/app/api/admin/roster/route.ts", "utf8");
  const loader = readFileSync("src/lib/server/google-sheet-source.ts", "utf8");
  for (const source of [directory, admin, loader]) {
    assert.doesNotMatch(source, /await response\.text\(\)/);
  }
  assert.match(directory, /loadPrivateStaffSheetRows/);
  assert.match(admin, /loadPrivateStaffSheetRows/);
  assert.match(loader, /readBoundedResponseText\(data, 1_000_000\)/);
  assert.match(loader, /readBoundedResponseText\(auth, 16_384\)/);
  assert.match(admin, /ResponsePayloadTooLarge/);
  assert.match(directory, /catch \{[\s\S]*?return null;[\s\S]*?\}/);
});
