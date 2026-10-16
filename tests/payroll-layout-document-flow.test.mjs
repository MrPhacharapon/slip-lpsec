import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Admin rejects mixed layout before rasterization or any payroll API write", () => {
  const s = readFileSync("src/app/admin/page.tsx", "utf8");
  const p = s.indexOf("layouts.push(layout);");
  const guard = s.indexOf("assertSlipDocumentLayout(layouts);");
  const unique = s.indexOf("assertUniquePeriod(mapped);");
  const render = s.indexOf("const view = page.getViewport({ scale: 2.5 });");
  const staged = s.indexOf('fetch("/api/admin/slips"');
  assert.ok(p >= 0 && p < guard && guard < unique && unique < render);
  assert.ok(staged === -1 || guard < staged, "reject before staging");
});

test("Private PDF.js uses the same full-document guard and reports failed page", () => {
  const s = readFileSync("scripts/validate-private-payroll-pdfs.mjs", "utf8");
  const track = s.indexOf("layouts.push(layout);");
  const stage = s.indexOf('stage = "PERIOD_VALIDATE"');
  const guard = s.indexOf("assertSlipDocumentLayout(layouts);");
  const unique = s.indexOf("assertUniquePeriod(all);");
  assert.ok(track >= 0 && track < stage && stage < guard && guard < unique);
  assert.match(s, /Number\.isInteger\(error\?\.page\)/);
});
