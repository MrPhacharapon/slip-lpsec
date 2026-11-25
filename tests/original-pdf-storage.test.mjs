import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { startMockSupabase, setMockState } from "./mock-supabase-server.mjs";

test("PDF.js WASM decoders for JPXDecode/JBIG2/QCMS are bundled in public/pdfjs-wasm and wired via wasmUrl", () => {
  const page = readFileSync("src/app/admin/page.tsx", "utf8");
  assert.match(page, /wasmUrl:\s*new URL\("\/pdfjs-wasm\/",\s*window\.location\.origin\)\.href/,
    "Admin PDF.js getDocument must pass wasmUrl so JPEG 2000 signatures render");
  for (const file of [
    "openjpeg.wasm",
    "openjpeg_nowasm_fallback.js",
    "jbig2.wasm",
    "jbig2_nowasm_fallback.js",
    "qcms_bg.wasm",
  ]) {
    const publicBytes = readFileSync("public/pdfjs-wasm/" + file);
    const pkgBytes = readFileSync("node_modules/pdfjs-dist/wasm/" + file);
    assert.ok(publicBytes.equals(pkgBytes),
      `public/pdfjs-wasm/${file} must exactly match locked pdfjs-dist wasm binary`);
  }
});

test("restore-original route authenticates first, supports signed URLs up to 20 MB, and never overwrites", () => {
  const code = readFileSync("src/app/api/admin/restore-original/route.ts", "utf8");
  for (const method of ["POST", "PATCH"]) {
    const start = code.indexOf(`export async function ${method}(`);
    const end = code.indexOf("export async function ", start + 20);
    const fn = code.slice(start, end < 0 ? undefined : end);
    const authIdx = fn.indexOf("requireAdmin(req, true)");
    const parseIdx = fn.indexOf("readBoundedJson(");
    assert.ok(authIdx >= 0 && parseIdx > authIdx, `${method} must authenticate before reading body`);
  }
  assert.match(code, /const MAX_PDF = 20 \* 1024 \* 1024/);
  assert.match(code, /createSignedUploadUrl\(path\)/);
  assert.match(code, /SAFE_ORIGINAL_PATH/);
  assert.match(code, /removeUnreferenced\(db,\s*path\)/);
  assert.match(code, /validPeriod\(history\.month,\s*history\.year\)/);
  assert.match(code, /history\.storage_path !== null/);
  assert.match(code, /upsert:\s*false/);
  assert.match(code, /\.is\("storage_path",\s*null\)/);
  assert.match(code, /pageCount < Math\.ceil\(slipCount \/ 2\) \|\| pageCount > slipCount/);
  assert.doesNotMatch(code, /const OCTOBER = "ตุลาคม"/, "must not hardcode a single month");
});

test("Admin UI auto-attaches original PDF via signed URL after finalize and allows manual attach for any null-storage history", () => {
  const page = readFileSync("src/app/admin/page.tsx", "utf8");
  const finalizeIdx = page.indexOf('fetch("/api/admin/finalize"');
  const autoAttachIdx = page.indexOf("attachOriginalPdf(", finalizeIdx);
  assert.ok(finalizeIdx >= 0 && autoAttachIdx > finalizeIdx,
    "handleUpload must attach original PDF after finalize succeeds");
  assert.match(page, /method:\s*"PUT"/);
  assert.match(page, /method:\s*"PATCH"/);
  assert.match(page, /\{!item\.storage_path && \(/);
  assert.doesNotMatch(page, /item\.month === "ตุลาคม" && item\.year === "2569" && !item\.storage_path/);
});

test("Mock Supabase supports signed upload URLs, storage download/remove, HEAD exact count, and is.null PATCH", async () => {
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

    const path = "original/11111111-1111-4111-8111-111111111111.pdf";
    const bytes = new TextEncoder().encode("%PDF-1.4\nsynthetic");
    const signed = await db.storage.from("slips").createSignedUploadUrl(path);
    assert.equal(signed.error, null);
    assert.ok(signed.data?.signedUrl);

    const putRes = await fetch(signed.data.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
      body: bytes,
    });
    assert.equal(putRes.status, 200);

    // Reusing the one-time token must fail
    const replay = await fetch(signed.data.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
      body: bytes,
    });
    assert.equal(replay.status, 403);

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
      .update({ storage_path: "original/22222222-2222-4222-8222-222222222222.pdf" })
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
