import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseRoster, identifyPageSlips } from "../src/lib/slip-validation.ts";

// Generates real PDF bytes in memory. All names and account numbers are fictional.
async function createTwoPersonPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [text, y] of [
    ["Payroll Person Alpha", 760],
    ["Account 1234567890", 715],
    ["Payroll Person Beta", 320],
    ["Account 0987654321", 280],
  ]) {
    page.drawText(text, { x: 40, y, size: 15, font });
  }
  return pdf.save();
}

const roster = parseRoster([
  ["Person Alpha", "", "1234567890"],
  ["Person Beta", "", "0987654321"],
]);

async function extractTokens(bytes) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes), useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const items = (await page.getTextContent()).items;
    return {
      height: page.view[3] - page.view[1],
      tokens: items.filter(i => "str" in i && "transform" in i)
        .map(i => ({ str: i.str, y: i.transform[5] })),
    };
  } finally {
    await loadingTask.destroy();
  }
}

test("real pdf-lib PDF text extracted by pdfjs maps both fictional owners", async () => {
  const {height,tokens} = await extractTokens(await createTwoPersonPdf());
  const result = identifyPageSlips(tokens,height,roster);
  assert.deepEqual(result.map(r=>[r.person.bankAccount,r.region]),
    [["1234567890","top"],["0987654321","bottom"]]);
});

test("pdf-lib copied PDF with CropBox still contains hidden other person's text", async () => {
  const source = await PDFDocument.load(await createTwoPersonPdf());
  const copy = await PDFDocument.create();
  const [page] = await copy.copyPages(source,[0]);
  page.setCropBox(0,421,595,421);
  page.setMediaBox(0,421,595,421);
  copy.addPage(page);
  const {tokens} = await extractTokens(await copy.save());
  const joined=tokens.map(x=>x.str).join(" ");
  assert.ok(joined.includes("1234567890"),"visible person's account remains");
  assert.ok(joined.includes("0987654321"),"cropped out person's account is still embedded");
});
