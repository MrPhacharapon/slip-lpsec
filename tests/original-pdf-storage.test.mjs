import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { startMockSupabase, setMockState } from "./mock-supabase-server.mjs";

test("restore-original route authenticates first, supports any null-storage period, and never overwrites", () => {
  const code = readFileSync("src/app/api/admin/restore-original/route.ts", "utf8");
  const authIdx = code.indexOf("requireAdmin(req, true)");
  const formIdx = code.indexOf("await req.formData()");
  assert.ok(authIdx >= 0 && formIdx > authIdx, "must authenticate before reading formData");
  assert.match(code, /content-length/);
  assert.match(code, /413/);
  assert.match(code, /validPeriod\(history\.month,\s*history\.year\)/);
  assert.match(code, /history\.storage_path !== null/);
  assert.match(code, /upsert:\s*false/);
  assert.match(code, /\.is\("storage_path",\s*null\)/);
  assert.match(code, /db\.storage\.from\("slips"\)\.remove\(\[path\]\)/);
  assert.match(code, /pageCount < Math\.ceil\(count \/ 2\) \|\| pageCount > count/);
  assert.doesNotMatch(code, /const OCTOBER = "ตุลาคม"/, "must not hardcode a single month");
});

test("Admin UI auto-attaches original PDF after finalize and allows manual attach for any null-storage history", () => {
  const page = readFileSync("src/app/admin/page.tsx", "utf8");
  const finalizeIdx = page.indexOf('fetch("/api/admin/finalize"');
  const autoAttachIdx = page.indexOf('fetch("/api/admin/restore-original"', finalizeIdx);
  assert.ok(finalizeIdx >= 0 && autoAttachIdx > finalizeIdx,
    "handleUpload must attach original PDF after finalize succeeds");
  assert.match(page, /\{!item\.storage_path && \(/);
  assert.doesNotMatch(page, /item\.month === "ตุลาคม" && item\.year === "2569" && !item\.storage_path/);
});

test("Mock Supabase supports storage upload/download/remove, HEAD exact count, and is.null PATCH", async () => {
  const server = await startMockSupabase();
  try {
    const historyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const state = {
      rows: [
        { id: "1", name: "SYNTHETIC", bank_account: "1234567890", month: "พฤศจิกายน", year: "2569", pdf_base64: "JVBERi0xLjQK" },
      ],
      history: [
        { id: historyId, month: "พฤศจิกายน", year: "2569", file_name: "synthetic.pdf", storage_path: null, created_at: new Date().toISOString() },
      ],
    };
    setMockState(state);
    const db = createClient("http://127.0.0.1:3200", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { count, error: countError } = await db.from("slips")
      .select("id", { head: true, count: "exact" })
      .eq("month", "พฤศจิกายน").eq("year", "2569");
    assert.equal(countError, null);
    assert.equal(count, 1);

    const path = "original/test-file.pdf";
    const bytes = new TextEncoder().encode("%PDF-1.4\nsynthetic");
    const up = await db.storage.from("slips").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    assert.equal(up.error, null);

    const dup = await db.storage.from("slips").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    assert.ok(dup.error, "upsert: false must reject duplicate storage path");

    const dl = await db.storage.from("slips").download(path);
    assert.equal(dl.error, null);
    assert.equal(await dl.data.text(), "%PDF-1.4\nsynthetic");

    const updated = await db.from("upload_history")
      .update({ storage_path: path })
      .eq("id", historyId).eq("month", "พฤศจิกายน").eq("year", "2569")
      .is("storage_path", null).select("id");
    assert.equal(updated.error, null);
    assert.equal(updated.data?.length, 1);
    assert.equal(state.history[0].storage_path, path);

    const secondUpdate = await db.from("upload_history")
      .update({ storage_path: "original/other.pdf" })
      .eq("id", historyId).eq("month", "พฤศจิกายน").eq("year", "2569")
      .is("storage_path", null).select("id");
    assert.equal(secondUpdate.error, null);
    assert.equal(secondUpdate.data?.length, 0, "no-overwrite guard must skip non-null storage_path");
    assert.equal(state.history[0].storage_path, path);

    const rm = await db.storage.from("slips").remove([path]);
    assert.equal(rm.error, null);
    const missing = await db.storage.from("slips").download(path);
    assert.ok(missing.error);
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
});
