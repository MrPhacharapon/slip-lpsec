import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  copyFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = "scripts/verify-private-payroll-backup.mjs";
function run(operation, root, manifest) {
  return spawnSync(process.execPath,
    [script, operation, "--root", root, "--manifest", manifest],
    { cwd: process.cwd(), encoding: "utf8", timeout: 20000 });
}
function workspace(fn) {
  const home = mkdtempSync(join(tmpdir(), "fixture-backup-"));
  try { fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test("offline manifest validates exact synthetic DB and Storage backup contents", () => {
  workspace(home => {
    const source = join(home, "source"), restored = join(home, "restored");
    mkdirSync(join(source, "storage"), { recursive: true });
    mkdirSync(join(restored, "storage"), { recursive: true });
    writeFileSync(join(source, "synthetic-database.sql"),
      "-- SYNTHETIC ONLY, no payroll rows\nSELECT 1;\n");
    writeFileSync(join(source, "storage", "synthetic-pdf.bin"),
      Buffer.from("%PDF-1.4\nFICTIONAL ONLY\n"));
    const manifest = join(home, "private-manifest.json");
    const created = run("create", source, manifest);
    assert.equal(created.status, 0, created.stderr);
    const data = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(data.entries.length, 2);
    assert.ok(data.entries.every(x => /^[a-f0-9]{64}$/.test(x.sha256)));
    copyFileSync(join(source, "synthetic-database.sql"),
      join(restored, "synthetic-database.sql"));
    copyFileSync(join(source, "storage", "synthetic-pdf.bin"),
      join(restored, "storage", "synthetic-pdf.bin"));
    const verified = run("verify", restored, manifest);
    assert.equal(verified.status, 0, verified.stderr);
    const result = JSON.parse(verified.stdout);
    assert.deepEqual(result, { status: "PASS", operation: "verify",
      files: 2, bytes: data.entries.reduce((sum, e) => sum + e.bytes, 0) });
    assert.equal(run("create", source, manifest).status, 1,
      "existing baseline manifest cannot be overwritten");
  });
});

test("offline hash check rejects even same-length tampering without disclosing files", () => {
  workspace(home => {
    const source = join(home, "source"), restored = join(home, "restored");
    mkdirSync(source); mkdirSync(restored);
    const sensitive = "SYNTHETIC_SENSITIVE_FILENAME_1234567890.pdf";
    writeFileSync(join(source, sensitive), "FICTIONAL123");
    writeFileSync(join(restored, sensitive), "FICTIONAL123");
    const manifest = join(home, "private-manifest.json");
    assert.equal(run("create", source, manifest).status, 0);
    writeFileSync(join(restored, sensitive), "FICTIONAL124");
    const verified = run("verify", restored, manifest);
    assert.equal(verified.status, 1, "modified bytes must fail even at same size");
    const log = verified.stdout + verified.stderr;
    assert.ok(!log.includes(sensitive));
    assert.ok(!log.includes(home));
    assert.ok(!log.includes("1234567890"));
    assert.match(log, /FAIL: private offline backup integrity check/);
  });
});

test("offline verifier rejects extra files, symlinks and manifest inside source tree", () => {
  workspace(home => {
    const source = join(home, "source");
    mkdirSync(source);
    writeFileSync(join(source, "synthetic.txt"), "SYNTHETIC ONLY");
    const manifest = join(home, "manifest.json");
    assert.equal(run("create", source, manifest).status, 0);
    writeFileSync(join(source, "extra.txt"), "EXTRA");
    assert.equal(run("verify", source, manifest).status, 1);
    rmSync(join(source, "extra.txt"));
    symlinkSync(join(source, "synthetic.txt"), join(source, "symlink.txt"));
    assert.equal(run("verify", source, manifest).status, 1);
    rmSync(join(source, "symlink.txt"));
    assert.equal(run("verify", source, manifest).status, 0);
    assert.equal(run("create", source, join(source, "unsafe-manifest.json")).status, 1);
    assert.equal(run("create", source, join(process.cwd(), "private-manifest.json")).status, 1,
      "never create a sensitive manifest inside the Git checkout");
    assert.equal(run("create", join(process.cwd(), "scripts"), manifest).status, 1,
      "never inventory any repository directory as a payroll backup");
  });
});
