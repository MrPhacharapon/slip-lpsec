import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");

test("Next.js agent rules are preserved alongside project-specific policy", () => {
  const content = read("AGENTS.md");
  assert.match(content, /<!-- BEGIN:nextjs-agent-rules -->/);
  assert.match(content, /<!-- END:nextjs-agent-rules -->/);
  for (const file of ["PROJECT_RULES.md", "ACCEPTANCE_CRITERIA.md",
    "PROJECT_STATUS.md"]) assert.ok(content.includes(file));
});

test("project documents carry all release gates and current printed-period rule", () => {
  const rules = read("docs/PROJECT_RULES.md");
  const acceptance = read("docs/ACCEPTANCE_CRITERIA.md");
  const status = read("docs/PROJECT_STATUS.md");
  assert.match(rules, /เดือน–ปีที่พิมพ์/);
  assert.match(acceptance, /เดือน–ปีที่พิมพ์/);
  assert.match(status, /NO-GO/);
  for (let n = 1; n <= 8; n++) assert.ok(status.includes("G" + n));
  // Verify evidence provenance rather than freezing the exact prose
  // of an older status snapshot. A pending new SHA is never a CI pass.
  assert.ok(status.includes("ล่าสุดที่ **ยืนยัน CI ผ่าน**"));
  assert.match(status, /ยังไม่อ้างว่าชุด Commit ล่าสุดผ่าน CI/);
});

test("CI separates suites, cancels outdated pushes and fails closed on both results", () => {
  const ci = read(".github/workflows/payroll-pdf-validation.yml");
  assert.match(ci, /^concurrency:/m);
  assert.match(ci, /cancel-in-progress:/);
  assert.match(ci, /^  quality:/m);
  assert.match(ci, /^  browser-e2e:/m);
  assert.match(ci, /^  validate:/m);
  assert.match(ci, /needs: \[quality, browser-e2e\]/);
  assert.match(ci, /QUALITY_RESULT:/);
  assert.match(ci, /BROWSER_RESULT:/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npx tsc --noEmit/);
  assert.match(ci, /npm run build/);
  assert.match(ci, /tests\/private-payroll-pdf-fixtures\.e2e\.mjs/);
  assert.match(ci, /tests\/browser-payroll\.e2e\.mjs/);
  assert.doesNotMatch(ci, /vercel (?:deploy|--prod|promote)/);
  assert.doesNotMatch(ci, /supabase db (?:push|reset)/);
});

test("every third-party CI action reference uses a verified immutable SHA", () => {
  const ci = read(".github/workflows/payroll-pdf-validation.yml");
  const actions = [...ci.matchAll(/^\s+- uses: ([^\s#]+)/gm)].map(m => m[1]);
  assert.equal(actions.length, 5, "review and pin any newly added GitHub Action");
  for (const action of actions) {
    assert.match(action, /^actions\/(?:checkout|setup-node|setup-python)@[0-9a-f]{40}$/);
  }
  assert.doesNotMatch(ci, /uses:\s+[^\s]+@v\d+/);
});
