import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSmallAdminBody } from "../src/lib/server/small-admin-body.ts";

function req(data) {
  return new Request("http://localhost/api/admin/preflight", { method:"POST", body:data,
    headers:{"content-type":"application/json"} });
}

test("small Admin JSON helper accepts an exact UTF-8 byte boundary", async () => {
  const text = '{"month":"ตุลาคม","year":"2569"}';
  const result = await readSmallAdminBody(req(text), Buffer.byteLength(text));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.body, {month:"ตุลาคม",year:"2569"});
});
test("Admin JSON helper refuses overflow even when chunked", async () => {
  const oversized = await readSmallAdminBody(req("x".repeat(4097)), 4096);
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.response.status, 413);
  let wasCancelled = false;
  const stream = new ReadableStream({
    start(c){ c.enqueue(new TextEncoder().encode("A".repeat(1000)));c.enqueue(new TextEncoder().encode("B".repeat(50)));},
    cancel(){wasCancelled=true;},
  });
  const request = new Request("http://localhost/", {method:"POST",body:stream,duplex:"half"});
  const result = await readSmallAdminBody(request, 1024);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 413);
  assert.equal(wasCancelled, true);
});
test("Admin JSON helper responds 400 to malformed, null, arrays and invalid UTF-8", async () => {
  for(const body of ['{"month":', "null", "[]", '"string"', "123",
    Uint8Array.from([0x7b,0x22,0xc3,0x28,0x22,0x3a,0x31,0x7d])]) {
    const result = await readSmallAdminBody(req(body), 1024);
    assert.equal(result.ok,false);
    if(!result.ok) assert.equal(result.response.status,400);
  }
});
test("all small Admin write endpoints authenticate before bounded streaming, with no raw JSON parse", () => {
  for (const [path,limit,methods] of [
    ["src/app/api/admin/preflight/route.ts",1024,["POST"]],
    ["src/app/api/admin/finalize/route.ts",2048,["POST"]],
    ["src/app/api/admin/history/route.ts",16384,["PATCH"]],
    ["src/app/api/admin/staged-recovery/route.ts",4096,["POST","DELETE"]],
    ["src/app/api/admin/published-deletion/route.ts",4096,["POST","DELETE"]],
    ["src/app/api/send-line/route.ts",1024,["POST"]],
  ]) {
    const code=readFileSync(path,"utf8");
    assert.doesNotMatch(code,/await req\.json\(\)/,path);
    assert.match(code,/requireAdmin\(req, true\)/,path);
    assert.ok(code.indexOf("requireAdmin(req, true)")<code.indexOf("readSmallAdminBody("),path);
    assert.ok(code.includes("readSmallAdminBody(req, "+limit+")") ||
      code.includes("readSmallAdminBody<"),path);
    assert.equal((code.match(/readSmallAdminBody</g)??[]).length,methods.length,path);
  }
});
