#!/usr/bin/env node
/**
 * PRIVATE WORKSTATION ONLY. Creates/verifies SHA-256 inventories of offline
 * payroll backup files (SQL dumps AND Storage binaries). Never talks to
 * Supabase, GitHub, or a network. Never logs names, paths, bytes or secrets.
 *
 *   node scripts/verify-private-payroll-backup.mjs create --root PRIVATE_SOURCE --manifest PRIVATE_MANIFEST.json
 *   node scripts/verify-private-payroll-backup.mjs verify --root PRIVATE_RESTORED_COPY --manifest PRIVATE_MANIFEST.json
 *
 * The manifest contains private relative filenames. Keep it with the
 * restricted backup records, never inside this repository or GitHub CI.
 * Matching files/hashes are NOT proof that Postgres data was restored
 * successfully; that needs a separate isolated database restore rehearsal.
 */
import { createReadStream } from "node:fs";
import { readdir, lstat, realpath, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, sep, win32, join } from "node:path";

const MAX_FILES = 10000;
const MAX_MANIFEST = 4_000_000;

function ensureOutsideRoot(root, manifest) {
  const rel = relative(root, resolve(manifest));
  if (!rel || (rel !== ".." && !rel.startsWith(".." + sep) && !win32.isAbsolute(rel))) {
    throw Error("manifest cannot be saved in backed-up files");
  }
}

function allowedRelative(p) {
  return typeof p === "string" && p.length > 0 && p.length <= 2048 &&
    !p.includes("\\") && !p.includes("\0") &&
    !p.startsWith("/") && !win32.isAbsolute(p) &&
    p.split("/").every(segment => segment && segment !== "." && segment !== "..");
}

async function inventory(root) {
  const result = [];
  async function visit(dir, prefix) {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isSymbolicLink()) throw Error("symlink in backup");
      const rel = prefix ? prefix + "/" + item.name : item.name;
      if (!allowedRelative(rel)) throw Error("unexpected file path");
      const absolute = join(dir, item.name);
      if (item.isDirectory()) await visit(absolute, rel);
      else if (item.isFile()) {
        result.push({ path: rel, absolute });
        if (result.length > MAX_FILES) throw Error("too many backup files");
      } else throw Error("unsupported backup entry");
    }
  }
  await visit(root, "");
  result.sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (!result.length) throw Error("empty backup");
  return result;
}

async function fingerprint(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error("not a regular file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { bytes: stat.size, sha256: hash.digest("hex") };
}

async function main(args) {
  if (args.length !== 5 || !["create", "verify"].includes(args[0]) ||
      args[1] !== "--root" || args[3] !== "--manifest") {
    throw Error("usage");
  }
  const [mode, , rootInput, , manifestInput] = args;
  const root = await realpath(resolve(rootInput));
  if (!(await lstat(root)).isDirectory()) throw Error("invalid root");
  ensureOutsideRoot(root, manifestInput);
  const files = await inventory(root);
  let count = 0, bytes = 0;
  if (mode === "create") {
    const entries = [];
    for (const file of files) {
      const hash = await fingerprint(file.absolute);
      entries.push({ path: file.path, ...hash });
      count++;
      bytes += hash.bytes;
    }
    const output = JSON.stringify({ version: 1, algorithm: "sha256", entries }, null, 2) + "\n";
    // Explicit exclusive create: never overwrite an earlier backup manifest.
    await writeFile(resolve(manifestInput), output, { flag: "wx", mode: 0o600 });
  } else {
    const manifestText = await readFile(resolve(manifestInput), "utf8");
    if (Buffer.byteLength(manifestText) > MAX_MANIFEST) throw Error("oversized manifest");
    const manifest = JSON.parse(manifestText);
    if (manifest?.version !== 1 || manifest.algorithm !== "sha256" ||
        !Array.isArray(manifest.entries) || manifest.entries.length !== files.length ||
        manifest.entries.length > MAX_FILES) throw Error("invalid manifest");
    const expected = new Map();
    for (const entry of manifest.entries) {
      if (!allowedRelative(entry.path) || !Number.isSafeInteger(entry.bytes) ||
          entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
          expected.has(entry.path)) throw Error("invalid manifest entry");
      expected.set(entry.path, entry);
    }
    for (const file of files) {
      const entry = expected.get(file.path);
      if (!entry) throw Error("additional backup file");
      const actual = await fingerprint(file.absolute);
      if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) {
        throw Error("backup file changed");
      }
      count++;
      bytes += actual.bytes;
    }
  }
  process.stdout.write(JSON.stringify({ status: "PASS", operation: mode,
    files: count, bytes }) + "\n");
}

try { await main(process.argv.slice(2)); }
catch {
  // Fail closed, never reveal a potentially identifying file name, path,
  // manifest contents, account number, or raw operating-system error.
  process.stderr.write("FAIL: private offline backup integrity check\n");
  process.exitCode = 1;
}
