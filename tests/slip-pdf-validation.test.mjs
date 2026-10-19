import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { validateStoredSlipPdf } from "../src/lib/server/slip-pdf-validation.ts";

async function pdfBase64(width = 1071, height = 792, pages = 1, rotate = 0) {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = document.addPage([width, height]);
    if (rotate) page.setRotation({ type: "degrees", angle: rotate });
  }
  return Buffer.from(await document.save()).toString("base64");
}

test("accept a one-page traditional (full) payslip", async () => {
  assert.deepEqual(await validateStoredSlipPdf(await pdfBase64()), { valid: true });
});

test("accept a one-person half-page payslip from two-per-page input", async () => {
  assert.deepEqual(await validateStoredSlipPdf(await pdfBase64(1071, 396)), { valid: true });
});

test("reject two-person PDF that was not split into separate pages", async () => {
  assert.deepEqual(await validateStoredSlipPdf(await pdfBase64(1071,792,2)), { valid: false, reason: "pages" });
});

test("reject an invalid or truncated PDF with a plausible PDF header", async () => {
  const fake = Buffer.from("%PDF-1.4\n" + "X".repeat(150)).toString("base64");
  assert.deepEqual(await validateStoredSlipPdf(fake), { valid: false, reason: "pdf" });
});

test("reject incorrect page dimensions", async () => {
  assert.deepEqual(await validateStoredSlipPdf(await pdfBase64(500,792)), { valid: false, reason: "geometry" });
  assert.deepEqual(await validateStoredSlipPdf(await pdfBase64(1071,420)), { valid: false, reason: "geometry" });
});

test("reject rotated PDF pages", async () => {
  assert.deepEqual(await validateStoredSlipPdf(await pdfBase64(1071,792,1,90)), { valid: false, reason: "geometry" });
});

test("reject malformed and non-canonical base64 or non-string inputs", async () => {
  for (const value of [null, "", "QUJD?", "A".repeat(220), "QUJD====", {pdf:1}]) {
    assert.equal((await validateStoredSlipPdf(value)).valid, false);
  }
});
