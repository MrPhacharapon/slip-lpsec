/**
 * Execute the private PDF.js acceptance CLI on generated fictional PDF files.
 * This runs only after CI installs Python ReportLab and the local Thai font.
 * Never place a real payroll file or private roster in GitHub Actions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const people = [
  { name: "นายทดสอบ หนึ่ง", account: "1234567890", position: "0000001" },
  { name: "นางสาวทดลอง สอง", account: "0987654321", position: "0000002" },
  { name: "นางสาวทดลอง สาม", account: "1112223334", position: "0000003" },
];

function fixture(layout, occupants, wrongPosition = false) {
  return execFileSync("python3", ["tests/generate-synthetic-payroll.py"], {
    input: JSON.stringify({ layout, people: occupants, wrongPosition }),
    maxBuffer: 8 * 1024 * 1024,
  });
}

function checkCli(dir, pdfs) {
  const roster = join(dir, "SYNTHETIC_ONLY_roster.csv");
  writeFileSync(roster, [
    "ชื่อและนามสกุล,ตำแหน่ง,เลขบัญชี,รายการรายรับ (เลขตำแหน่ง)",
    ...people.map(p => [p.name, "ครู", p.account, p.position].join(",")),
  ].join("\r\n") + "\r\n");
  return spawnSync(process.execPath, [
    "--experimental-strip-types", "scripts/validate-private-payroll-pdfs.mjs",
    "--roster", roster,
    ...pdfs.flatMap(file => ["--pdf", file]),
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 45000,
       maxBuffer: 1024 * 1024 });
}

test("private PDF.js accepts A and B with odd last page using synthetic data", () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-fictional-"));
  try {
    const a = join(dir, "synthetic-A.pdf");
    const b = join(dir, "synthetic-B-odd.pdf");
    writeFileSync(a, fixture("A", people));
    writeFileSync(b, fixture("B", people));
    const result = checkCli(dir, [a, b]);
    assert.equal(result.status, 0, result.stdout);
    const parsed = result.stdout.trim().split(/\r?\n/).filter(l => l.startsWith("{"))
      .map(l => JSON.parse(l));
    assert.deepEqual(parsed, [
      { document: 1, status: "PASS", pageCount: 3, slipCount: 3,
        singlePages: 3, doublePages: 0 },
      { document: 2, status: "PASS", pageCount: 2, slipCount: 3,
        singlePages: 1, doublePages: 1 },
      { result: "PASS", documents: 2, failedDocuments: 0, pages: 5, slips: 6 },
    ]);
    const output = result.stdout + result.stderr;
    for (const person of people)
      for (const detail of [person.name, person.account, person.position])
        assert.ok(!output.includes(detail), "redact synthetic owner details");
    assert.ok(!output.includes(dir), "redact absolute local paths");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private PDF.js rejects incorrect position in synthetic PDF at page 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-fictional-bad-"));
  try {
    const bad = join(dir, "synthetic-invalid.pdf");
    writeFileSync(bad, fixture("B", people, true));
    const result = checkCli(dir, [bad]);
    assert.equal(result.status, 1);
    const lines = result.stdout.trim().split(/\r?\n/).filter(l => l.startsWith("{"))
      .map(l => JSON.parse(l));
    assert.deepEqual(lines, [
      { document: 1, status: "FAIL", page: 1, stage: "PAGE_VALIDATE" },
      { result: "FAIL", documents: 1, failedDocuments: 1, pages: 0, slips: 0 },
    ]);
    assert.ok(!result.stdout.includes("1234567890"));
    assert.ok(!result.stderr.includes("1234567890"));
    assert.ok(!result.stdout.includes(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
