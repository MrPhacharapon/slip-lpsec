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
import { PDFDocument } from "pdf-lib";

const people = [
  { name: "นายทดสอบ หนึ่ง", account: "1234567890", position: "0000001" },
  { name: "นางสาวทดลอง สอง", account: "0987654321", position: "0000002" },
  { name: "นางสาวทดลอง สาม", account: "1112223334", position: "0000003" },
];

function fixture(layout, occupants, wrongPosition = false, month = "กันยายน", year = "2569") {
  return execFileSync("python3", ["tests/generate-synthetic-payroll.py"], {
    input: JSON.stringify({ layout, people: occupants, wrongPosition, month, year }),
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
    ...pdfs.flatMap(d => {
      const doc = typeof d === "string" ? { file: d } : d;
      return ["--pdf", doc.file, "--month", doc.month ?? "กันยายน",
        "--year", doc.year ?? "2569"];
    }),
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
      { document: 1, status: "FAIL", page: 1, stage: "PAGE_VALIDATE",
        reason: "OWNER_MATCH" },
      { result: "FAIL", documents: 1, failedDocuments: 1, pages: 0, slips: 0 },
    ]);
    assert.ok(!result.stdout.includes("1234567890"));
    assert.ok(!result.stderr.includes("1234567890"));
    assert.ok(!result.stdout.includes(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("private PDF.js rejects an isolated A page before a B double page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-fictional-mixed-"));
  try {
    const path = join(dir, "synthetic-mixed-invalid.pdf");
    const a = await PDFDocument.load(fixture("A", [people[0]]));
    const b = await PDFDocument.load(fixture("B", people.slice(1)));
    const mixed = await PDFDocument.create();
    for (const doc of [a, b]) {
      const [page] = await mixed.copyPages(doc, [0]);
      mixed.addPage(page);
    }
    writeFileSync(path, Buffer.from(await mixed.save()));
    const output = checkCli(dir, [path]);
    assert.equal(output.status, 1, output.stdout);
    const events = output.stdout.trim().split(/\r?\n/)
      .filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    assert.deepEqual(events, [
      { document: 1, status: "FAIL", page: 1, stage: "PERIOD_VALIDATE" },
      { result: "FAIL", documents: 1, failedDocuments: 1, pages: 0, slips: 0 },
    ]);
    for (const secret of [dir, ...people.flatMap(p => [p.name, p.account, p.position])]) {
      assert.ok(!(output.stdout + output.stderr).includes(secret));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private PDF.js rejects wrong printed month/year and a B half mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-fictional-period-"));
  try {
    const monthFile = join(dir, "synthetic-month.pdf");
    const yearFile = join(dir, "synthetic-year.pdf");
    const halfFile = join(dir, "synthetic-half.pdf");
    writeFileSync(monthFile, fixture("A", [people[0]], false, "ตุลาคม"));
    writeFileSync(yearFile, fixture("A", [people[0]], false, "กันยายน", "2568"));
    writeFileSync(halfFile, fixture("B", [people[0],
      { ...people[1], month: "สิงหาคม" }]));
    const r = checkCli(dir, [monthFile,yearFile,halfFile]);
    assert.equal(r.status, 1);
    const events = r.stdout.trim().split(/\r?\n/)
      .filter(line=>line.startsWith("{")).map(line=>JSON.parse(line));
    assert.deepEqual(events, [
      { document: 1, status: "FAIL", page: 1, stage: "PAGE_VALIDATE",
        reason: "PRINTED_PERIOD" },
      { document: 2, status: "FAIL", page: 1, stage: "PAGE_VALIDATE",
        reason: "PRINTED_PERIOD" },
      { document: 3, status: "FAIL", page: 1, stage: "PAGE_VALIDATE",
        reason: "PRINTED_PERIOD" },
      { result: "FAIL", documents: 3, failedDocuments: 3, pages: 0, slips: 0 },
    ]);
    for (const secret of [dir, ...people.flatMap(p=>[p.name,p.account,p.position])])
      assert.ok(!(r.stdout+r.stderr).includes(secret));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("private PDF.js supports individually declared months across multiple files", () => {
  const dir=mkdtempSync(join(tmpdir(),"payroll-fictional-crossperiod-"));
  try {
    const january=join(dir,"synthetic-jan.pdf");
    const september=join(dir,"synthetic-sep.pdf");
    writeFileSync(january,fixture("A",[people[0]],false,"มกราคม"));
    writeFileSync(september,fixture("A",[people[1]],false,"กันยายน"));
    const r=checkCli(dir,[{file:january,month:"มกราคม"},{file:september,month:"กันยายน"}]);
    assert.equal(r.status,0,r.stdout);
    assert.ok(JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1)).result==="PASS");
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test("private PDF.js reports a redacted layout reason for unsupported PDF paper size", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-fictional-layout-"));
  try {
    const path = join(dir, "fictional-wrong-size.pdf");
    const document = await PDFDocument.load(fixture("A", [people[0]]));
    document.getPage(0).setSize(612, 792);
    writeFileSync(path, Buffer.from(await document.save()));
    const result = checkCli(dir, [path]);
    assert.equal(result.status, 1, result.stdout);
    const events = result.stdout.split(/\r?\n/).filter(x => x.startsWith("{"))
      .map(x => JSON.parse(x));
    assert.deepEqual(events, [
      { document: 1, status: "FAIL", page: 1, stage: "PAGE_VALIDATE",
        reason: "LAYOUT" },
      { result: "FAIL", documents: 1, failedDocuments: 1, pages: 0, slips: 0 },
    ]);
    const visible = result.stdout + result.stderr;
    for (const secret of [dir, ...people.flatMap(p=>[p.name,p.account,p.position])])
      assert.ok(!visible.includes(secret), "must redact private fields");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
