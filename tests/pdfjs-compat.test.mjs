import test from "node:test";
import assert from "node:assert/strict";
import { ensurePdfJsMapCompatibility } from "../src/lib/pdfjs-compat.ts";

test("PDF.js older-browser compatibility supplies both Map upsert functions", () => {
  ensurePdfJsMapCompatibility();
  const map = new Map();
  assert.equal(map.getOrInsert("a", 7), 7);
  assert.equal(map.get("a"), 7);
  assert.equal(map.getOrInsert("a", 99), 7);
  let calls = 0;
  assert.equal(map.getOrInsertComputed("a", () => { calls++; return 1; }), 7);
  assert.equal(calls, 0);
  assert.equal(map.getOrInsertComputed("b", () => { calls++; return 11; }), 11);
  assert.equal(map.get("b"), 11);
  assert.equal(calls, 1);
  map.set("defined-with-undefined", undefined);
  assert.equal(map.getOrInsertComputed("defined-with-undefined", () => {
    throw new Error("must not compute an already-present key");
  }), undefined);
  ensurePdfJsMapCompatibility();
});
