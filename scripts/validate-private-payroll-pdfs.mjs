#!/usr/bin/env node
/**
 * Private-only acceptance of real payroll PDFs against a locally exported
 * staff roster. Runs on the operator's workstation; NEVER upload source PDFs,
 * account numbers, or roster to CI, GitHub, or application logs.
 *
 * node --experimental-strip-types scripts/validate-private-payroll-pdfs.mjs \
 *   --roster "/private/staff-roster.csv" \
 *   --pdf "/private/january.pdf" --pdf "/private/february.pdf"
 *
 * Output includes only document indices, counts, and failure page numbers.
 * No names, accounts, positions, PDF text, or absolute local paths are logged.
 */
import { readFile } from "node:fs/promises";
import Papa from "papaparse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  parseRoster, validateSlipPageLayout, identifyPageSlips, assertUniquePeriod,
} from "../src/lib/slip-validation.ts";

function argumentsFrom(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const result = { roster: null, pdfs: [] };
  for (let i = 0; i < argv.length; i += 2) {
    if (i + 1 >= argv.length) throw Error("usage");
    if (argv[i] === "--roster" && result.roster === null) result.roster = argv[i + 1];
    else if (argv[i] === "--pdf") result.pdfs.push(argv[i + 1]);
    else throw Error("usage");
  }
  if (!result.roster || !result.pdfs.length || result.pdfs.length > 24) {
    throw Error("usage");
  }
  return result;
}

async function readRoster(file) {
  const input = await readFile(file);
  if (input.length > 1_000_000) throw Error("roster too large");
  // The web uploader uses Papa.parse(..., { skipEmptyLines: true }) with
  // columns 0:name, 2:account, 3:position number; keep that exact mapping.
  const csv = new TextDecoder("utf-8").decode(input).replace(/^\uFEFF/, "");
  return parseRoster(Papa.parse(csv, { skipEmptyLines: true }).data);
}

async function checkPdf(file, roster) {
  let stage = "FILE_READ";
  const bytes = await readFile(file);
  if (bytes.length < 100 || bytes.length > 100_000_000)
    throw Error("invalid pdf file size");
  stage = "DOCUMENT_LOAD";
  const task = getDocument({
    data: new Uint8Array(bytes), useSystemFonts: true,
    // Only locally installed PDF.js assets; do not supply remote URLs.
    disableFontFace: true,
  });
  let document;
  try {
    document = await task.promise;
    if (!document.numPages || document.numPages > 500)
      throw Error("invalid source page count");
    const all = [];
    let singlePages = 0, doublePages = 0;
    for (let i = 0; i < document.numPages; i++) {
      stage = "PAGE_READ";
      const page = await document.getPage(i + 1);
      if (page.rotate % 360 !== 0 || page.view[1] !== 0) {
        throw Object.assign(Error("unsupported page rotation or view"), { page: i + 1 });
      }
      const text = await page.getTextContent();
      const tokens = text.items.filter(item => "str" in item && "transform" in item)
        .map(item => ({ str: item.str, y: item.transform[5] }));
      const width = page.view[2] - page.view[0];
      const height = page.view[3] - page.view[1];
      let layout, matches;
      try {
        stage = "PAGE_VALIDATE";
        layout = validateSlipPageLayout(tokens, width, height);
        matches = identifyPageSlips(tokens, height, roster);
        if ((layout === "single" &&
             (matches.length !== 1 || matches[0].region !== "full")) ||
            (layout === "double" &&
             (matches.length !== 2 || matches[0].region !== "top" ||
              matches[1].region !== "bottom"))) {
          throw Error("page layout does not match exactly one owner per region");
        }
      } catch {
        throw Object.assign(Error("PDF text/layout/ownership validation failed"),
          { page: i + 1 });
      }
      if (layout === "single") singlePages++;
      else doublePages++;
      all.push(...matches);
      page.cleanup();
    }
    // Duplicate accounts or impossible period totals are refused before
    // rendering or database staging by the same uploader validator.
    stage = "PERIOD_VALIDATE";
    assertUniquePeriod(all);
    return {
      pageCount: document.numPages,
      slipCount: all.length,
      singlePages, doublePages,
    };
  } catch (error) {
    // Only a fixed stage label; never emit raw dependency errors or PDF text.
    if (error && typeof error === "object" && !error.stage) error.stage = stage;
    throw error;
  } finally {
    if (document) await document.destroy();
    else await task.destroy();
  }
}

async function main() {
  let args;
  try {
    args = argumentsFrom(process.argv.slice(2));
  } catch {
    process.stderr.write("Usage: --roster PRIVATE.csv --pdf PRIVATE.pdf [--pdf PRIVATE.pdf ...]\n");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write("Private PDF.js payroll acceptance: --roster PRIVATE.csv --pdf PRIVATE.pdf (repeat --pdf).\n");
    return;
  }
  let roster;
  try { roster = await readRoster(args.roster); }
  catch {
    process.stderr.write("Roster rejected. No roster content will be printed.\n");
    process.exitCode = 1;
    return;
  }
  let failures = 0, pages = 0, slips = 0;
  for (let i = 0; i < args.pdfs.length; i++) {
    try {
      const result = await checkPdf(args.pdfs[i], roster);
      pages += result.pageCount;
      slips += result.slipCount;
      process.stdout.write(JSON.stringify({
        document: i + 1, status: "PASS", ...result,
      }) + "\n");
    } catch (error) {
      failures++;
      process.stdout.write(JSON.stringify({
        document: i + 1, status: "FAIL",
        page: Number.isInteger(error?.page) ? error.page : null,
        stage: typeof error?.stage === "string" ? error.stage : "UNKNOWN",
      }) + "\n");
    }
  }
  process.stdout.write(JSON.stringify({
    result: failures ? "FAIL" : "PASS",
    documents: args.pdfs.length, failedDocuments: failures, pages, slips,
  }) + "\n");
  if (failures) process.exitCode = 1;
}
await main();
