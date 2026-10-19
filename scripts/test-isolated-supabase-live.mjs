/**
 * Manual test against the real ISOLATED Supabase test project, never production.
 * No live credentials are stored in GitHub, CI, or source files.
 *
 * Prerequisites (set these outside GitHub in a secure local process):
 *   TEST_SUPABASE_RUN=I_UNDERSTAND_TEST_ONLY
 *   TEST_SUPABASE_URL=https://dpaqvxtbpaduknergflm.supabase.co
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<test-project secret ONLY>
 *   TEST_SUPABASE_PUBLISHABLE_KEY=<test-project publishable key>  (optional)
 *
 * node scripts/test-isolated-supabase-live.mjs
 *
 * Everything written is synthetic and deleted in finally.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const APPROVED_TEST_URL = "https://dpaqvxtbpaduknergflm.supabase.co";
if (process.env.TEST_SUPABASE_RUN !== "I_UNDERSTAND_TEST_ONLY" ||
    process.env.TEST_SUPABASE_URL !== APPROVED_TEST_URL ||
    !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY.length < 30) {
  throw new Error("Refusing to run: isolated test URL and private TEST credentials are required");
}
if (process.env.SUPABASE_URL === APPROVED_TEST_URL &&
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY) {
  // This is safe if the regular server variable is explicitly bound to the
  // sandbox, but never infer the target project from a production default.
}
const db = createClient(APPROVED_TEST_URL, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = process.env.TEST_SUPABASE_PUBLISHABLE_KEY
  ? createClient(APPROVED_TEST_URL, process.env.TEST_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const month = "ธันวาคม", year = "2569";
const people = [
  { name: "นายสมมติ ทดสอบหนึ่ง", bank_account: "9000001001" },
  { name: "นางสาวสมมติ ทดสอบสอง", bank_account: "9000001002" },
];
const fixtureName = "synthetic-integration-only.pdf";
const testStoragePath = "qa/synthetic-" + randomUUID() + ".pdf";
let ownsPeriod = false;
let storedFile = false;

async function checked(result, label) {
  if (result.error) throw new Error(label + ": " + result.error.code);
  return result.data;
}

async function makePdf(person) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1071, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SYNTHETIC TEST ONLY - NOT AN ACTUAL PAYSLIP", {
    x: 48, y: 725, font, size: 18,
  });
  page.drawText("Account: " + person.bank_account, { x: 48, y: 680, font, size: 12 });
  return Buffer.from(await doc.save());
}

try {
  const existingSlips = await checked(db.from("slips").select("id").eq("month",month).eq("year",year).limit(1),"preflight-slips");
  const existingHistory = await checked(db.from("upload_history").select("id").eq("month",month).eq("year",year).limit(1),"preflight-history");
  if (existingSlips.length || existingHistory.length) throw new Error("Test period already exists; refusing to overwrite or clean up unrelated data");
  ownsPeriod = true;

  const pdfs = await Promise.all(people.map(makePdf));
  await checked(db.from("slips").insert(people.map((p,i) => ({
    ...p, month, year, pdf_base64: pdfs[i].toString("base64"),
  }))),"stage-slips");

  const unpublished = await checked(db.from("upload_history").select("id").eq("month",month).eq("year",year),"unpublished-history");
  assert.equal(unpublished.length, 0, "staff search must hide unpublished period");

  const dupe = await db.from("slips").insert({
    ...people[0], month, year, pdf_base64: pdfs[0].toString("base64"),
  });
  assert.equal(dupe.error?.code, "23505", "duplicate owner-period must be blocked by database");

  if (anonymous) {
    const result = await anonymous.from("slips").select("pdf_base64").limit(1);
    assert.ok(result.error, "anon must NOT be able to read payroll tables");
    const insert = await anonymous.from("slips").insert({
      ...people[0], month, year, pdf_base64: pdfs[0].toString("base64"),
    });
    assert.ok(insert.error, "anon must NOT be able to write payroll tables");
  }

  // A real PDF file is uploaded only to the PRIVATE SANDBOX bucket.
  const upload = await db.storage.from("slips").upload(testStoragePath, pdfs[0], {
    contentType: "application/pdf", upsert: false,
  });
  if (upload.error) throw new Error("private-storage upload failed: " + upload.error.message);
  storedFile = true;
  const download = await db.storage.from("slips").download(testStoragePath);
  if (download.error) throw new Error("private-storage server download failed");
  const savedBytes = Buffer.from(await download.data.arrayBuffer());
  assert.equal((await PDFDocument.load(savedBytes)).getPageCount(),1);

  if (anonymous) {
    const denied = await anonymous.storage.from("slips").download(testStoragePath);
    assert.ok(denied.error, "anon must not download private storage object");
  }

  await checked(db.from("upload_history").insert({
    month, year, file_name: fixtureName, storage_path: null,
  }),"publish-history");
  const published = await checked(db.from("upload_history").select("id").eq("month",month).eq("year",year),"published-history");
  assert.equal(published.length, 1);

  for (const p of people) {
    const rows = await checked(db.from("slips").select("pdf_base64")
      .eq("month",month).eq("year",year).eq("bank_account",p.bank_account),"search-owner");
    assert.equal(rows.length, 1);
    const bytes = Buffer.from(rows[0].pdf_base64, "base64");
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1, "one-owner PDF only");
  }

  console.log("PASS: isolated real Supabase staging, publish, owner-scoped PDF, duplicate and private Storage checks.");
} finally {
  if (ownsPeriod) {
    await db.from("upload_history").delete().eq("month",month).eq("year",year).eq("file_name",fixtureName);
    await db.from("slips").delete().eq("month",month).eq("year",year)
      .in("bank_account",people.map(p=>p.bank_account));
  }
  if (storedFile) await db.storage.from("slips").remove([testStoragePath]);
  const [slips,history]=await Promise.all([
    db.from("slips").select("id").eq("month",month).eq("year",year),
    db.from("upload_history").select("id").eq("month",month).eq("year",year),
  ]);
  if (ownsPeriod && (slips.error || history.error || slips.data?.length || history.data?.length))
    throw new Error("Cleanup incomplete: inspect ONLY the isolated test project");
}
