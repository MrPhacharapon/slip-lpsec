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
  ["Person Alpha", "", "1234567890", "0000001"],
  ["Person Beta", "", "0987654321", "0000002"],
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
  // The built-in Helvetica fixture cannot draw Thai labels. Inject only the
  // position label text token; names/account numbers still come from PDF.js.
  const withPositionLabels = [...tokens,
    {str:"เลขตำแหน่ง 0000001",y:715},
    {str:"เลขตำแหน่ง 0000002",y:280}];
  const result = identifyPageSlips(withPositionLabels,height,roster);
  assert.deepEqual(result.map(r=>[r.person.bankAccount,r.region]),
    [["1234567890","top"],["0987654321","bottom"]]);
});

test("expanding pdf-lib CropBox recovers hidden other person's data", async () => {
  const source = await PDFDocument.load(await createTwoPersonPdf());
  const copy = await PDFDocument.create();
  const [page] = await copy.copyPages(source,[0]);
  page.setCropBox(0,421,595,421);
  page.setMediaBox(0,421,595,421);
  copy.addPage(page);
  const croppedBytes = await copy.save();
  const shown = await extractTokens(croppedBytes);
  assert.ok(shown.tokens.some(x => x.str.includes("1234567890")),
    "visible person's account remains");
  // PDF.js respects the CropBox when presenting text. However, reopening the
  // same copied-page file and restoring the page box reveals the other owner.
  const reopen = await PDFDocument.load(croppedBytes);
  const croppedPage = reopen.getPage(0);
  croppedPage.setCropBox(0,0,595,842);
  croppedPage.setMediaBox(0,0,595,842);
  const restored = await extractTokens(await reopen.save());
  const joined = restored.tokens.map(x=>x.str).join(" ");
  assert.ok(joined.includes("1234567890"), "visible person's account remains");
  assert.ok(joined.includes("0987654321"), "hidden person's account is recoverable");
});
