import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBoundedJson, RequestPayloadTooLarge } from "../src/lib/server/bounded-json.ts";

function req(data) {
  return new Request("http://localhost/api/admin/preflight", { method:"POST", body:data,
    headers:{"content-type":"application/json"} });
}

// The production HTTP wrapper imports Next.js, so response status is exercised
// by REAL Next.js browser E2E. These unit tests cover the shared byte parser.
test("bounded Admin JSON parsing accepts an exact UTF-8 byte boundary", async () => {
  const data = '{"month":"ตุลาคม","year":"2569"}';
  assert.deepEqual(await readBoundedJson(req(data), Buffer.byteLength(data)),
    { month:"ตุลาคม", year:"2569" });
});
test("bounded Admin JSON parsing rejects overflow even on chunked uploads", async () => {
  await assert.rejects(readBoundedJson(req("x".repeat(4097)), 4096),
    RequestPayloadTooLarge);
  let wasCancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("A".repeat(1000)));
      c.enqueue(new TextEncoder().encode("B".repeat(50)));
    },
    cancel() { wasCancelled=true; },
  });
  const request = new Request("http://localhost/", { method:"POST",body:stream,duplex:"half" });
  await assert.rejects(readBoundedJson(request, 1024), RequestPayloadTooLarge);
  assert.equal(wasCancelled,true);
});
test("bounded Admin JSON parser rejects malformed text and invalid UTF-8", async () => {
  for(const data of ['{"month":',Uint8Array.from([0x7b,0x22,0xc3,0x28,0x22,0x3a,0x31,0x7d])]) {
    await assert.rejects(readBoundedJson(req(data),1024));
  }
});
test("Admin HTTP wrapper rejects JSON primitives/null/arrays and maps bytes to 413", () => {
  const code = readFileSync("src/lib/server/small-admin-body.ts","utf8");
  assert.match(code,/readBoundedJson\(req, maxBytes\)/);
  assert.match(code,/typeof value !== "object" \|\| Array\.isArray\(value\)/);
  assert.match(code,/RequestPayloadTooLarge \? 413 : 400/);
  assert.doesNotMatch(code,/console\.(?:log|error)/);
});
test("all eight small Admin handlers authenticate before body streaming and DB calls", () => {
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
    assert.equal((code.match(/readSmallAdminBody</g)??[]).length,methods.length,path);
    for (const method of methods) {
      const start=code.indexOf("export async function "+method+"(");
      assert.ok(start>=0,path+" "+method);
      const end=code.indexOf("export async function ",start+20);
      const functionCode=code.slice(start,end<0?undefined:end);
      const auth=functionCode.indexOf("requireAdmin(req, true)");
      const parser=functionCode.indexOf("readSmallAdminBody<");
      assert.ok(auth>=0 && parser>auth,path+" "+method+" must authenticate first");
      assert.ok(functionCode.includes(">(req, "+limit+")"),path+" "+method+" maxBytes");
      assert.ok(functionCode.includes("if (!input.ok) return input.response"),path);
    }
  }
});
