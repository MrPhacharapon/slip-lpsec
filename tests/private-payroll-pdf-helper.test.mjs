import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = "scripts/validate-private-payroll-pdfs.mjs";
const run = args => spawnSync(process.execPath,
  ["--experimental-strip-types", script, ...args],
  { cwd: process.cwd(), encoding: "utf8", timeout: 25000 });

test("private PDF.js helper starts without accessing files", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Private PDF\.js payroll acceptance/);
});

test("private PDF.js helper never echoes roster fields on rejected input", () => {
  const dir = mkdtempSync(join(tmpdir(), "payroll-private-helper-"));
  try {
    const roster = join(dir, "private-roster.csv");
    const pdf = join(dir, "private-pdf.pdf");
    writeFileSync(roster,
      "ชื่อ-นามสกุล,ตำแหน่ง,เลขบัญชี,รายการรายรับ (เลขตำแหน่ง)\n" +
      "นายสมมติ หนึ่ง,ครู,9876543210,1234567\n");
    writeFileSync(pdf, "%PDF-1.4\nsynthetic invalid PDF bytes only\n".repeat(8));
    const result = run(["--roster", roster, "--pdf", pdf]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /"status":"FAIL"/);
    const visible = result.stdout + result.stderr;
    for (const forbidden of [
      "นายสมมติ", "9876543210", "1234567", dir,
    ]) assert.ok(!visible.includes(forbidden), "no private roster details in output");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
