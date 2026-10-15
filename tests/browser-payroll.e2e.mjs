/**
 * Isolated browser end-to-end test: synthetic persons and printable PDF only.
 * All Google Sheets and Supabase requests are intercepted in the browser.
 * Never connect this test to production or use real payroll files.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { startMockSupabase, setMockState } from "./mock-supabase-server.mjs";

const base = "http://127.0.0.1:3100";
const persons = [
  { name: "นายทดสอบ หนึ่ง", account: "1234567890", position: "0000001" },
  { name: "นางสาวทดลอง สอง", account: "0987654321", position: "0000002" },
  { name: "นางสาวทดลอง สาม", account: "1112223334", position: "0000003" },
];
const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-range",
};

const until = async (predicate, hint, limitMs = 45000) => {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(250);
  }
  throw new Error("Timed out: " + hint);
};

async function startServer() {
  const server = spawn("npm", ["run", "start", "--", "-p", "3100"], {
    env: { ...process.env, NODE_ENV: "production",
      SUPABASE_URL: "http://127.0.0.1:3200",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key-do-not-use",
      APP_ORIGIN: base,
      ADMIN_PASSWORD: "synthetic-admin-password-do-not-use",
      ADMIN_SESSION_SECRET: "only-used-for-test-never-ship-this-key-0123456789",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let lastLog = "";
  server.stdout.on("data", chunk => { lastLog += chunk.toString().slice(-800); });
  server.stderr.on("data", chunk => { lastLog += chunk.toString().slice(-800); });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Next server exited: " + lastLog);
    try {
      const response = await fetch(base + "/admin", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return server;
    } catch { /* waiting for localhost */ }
    await sleep(500);
  }
  server.kill("SIGTERM");
  throw new Error("Next server did not start: " + lastLog);
}

async function printablePdf(_browser, layout, rosterPeople, wrongPosition = false) {
  const buffer = execFileSync("python3", ["tests/generate-synthetic-payroll.py"], {
    input: JSON.stringify({ layout, people: rosterPeople, wrongPosition }),
    maxBuffer: 8 * 1024 * 1024,
  });
  const doc = await PDFDocument.load(buffer);
  const expectedPages = layout === "A" ? rosterPeople.length : Math.ceil(rosterPeople.length / 2);
  assert.equal(doc.getPageCount(), expectedPages, "synthetic PDF page count");
  if (rosterPeople.length === 1 && !wrongPosition) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const job = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const raw = await job.promise;
    const extracted = await (await raw.getPage(1)).getTextContent();
    console.log("Synthetic-only PDF.js text spans:",
      JSON.stringify(extracted.items.filter(i => "str" in i).map(i => i.str).slice(0,25)));
    await job.destroy();
  }
  return buffer;
}

async function makeSandboxContext(browser, state, personnel = persons) {
  const rosterCsv = [
    ["ชื่อและนามสกุล", "ตำแหน่ง", "เลขบัญชี", "รายการรายรับ (เลขตำแหน่ง)"],
    ...personnel.map(p => [p.name, "ครู", p.account, p.position]),
  ].map(r => r.join(",")).join("\r\n");
  setMockState(state);
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route(/https:\/\/(example\.supabase\.co|docs\.google\.com)\//, async route => {
    const request = route.request();
    if (new URL(request.url()).hostname === "docs.google.com") {
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 200,
        headers: { ...headers, "content-type": "text/csv;charset=utf-8" },
        body: rosterCsv });
    }
    throw new Error("Browser attempted direct Supabase access");
  });
  const login = await context.request.post(base + "/api/auth", {
    headers: { Origin: base }, data: { password: "synthetic-admin-password-do-not-use" },
  });
  assert.equal(login.status(), 200, "admin signed cookie is established");
  return context;
}

async function submitOnAdmin(context, pdf, month = "กันยายน") {
  const page = await context.newPage();
  const messages = [];
  page.on("dialog", async dialog => {
    if (dialog.type() === "alert") {
      messages.push(dialog.message());
      // Synthetic test inputs only; safe to surface validation errors in CI.
      console.error("Sandbox upload alert:", dialog.message());
    }
    await dialog.accept();
  });
  const errors = [];
  page.on("pageerror", err => errors.push(String(err)));
  await page.goto(base + "/admin", { waitUntil: "domcontentloaded" });
  await page.getByText("ระบบจัดการสลิปเงินเดือน").waitFor();
  await page.locator("form select").first().selectOption(month);
  await page.locator("#pdf-upload").setInputFiles({
    name: "fictional-payroll.pdf", mimeType: "application/pdf", buffer: pdf,
  });
  await page.getByRole("button", { name: "อัพโหลดไฟล์" }).click();
  return { page, messages, errors };
}

async function awaitUploadSuccess(page, messages, errors, timeoutMs = 15000) {
  try {
    await page.getByText("อัปโหลดสำเร็จ!").waitFor({ timeout: timeoutMs });
  } catch (error) {
    const visible = (await page.locator("body").innerText()).slice(-500);
    throw new Error("Expected upload success, alerts=" + JSON.stringify(messages) +
      ", client errors=" + JSON.stringify(errors) + ", screen=" + visible +
      "; underlying error=" + String(error));
  }
}

async function checkStoredImageOnlyPDF(row, expectedHeight) {
  assert.match(row.bank_account, /^\d{10}$/);
  assert.ok(row.pdf_base64?.length > 1000, "PDF data is recorded");
  const doc = await PDFDocument.load(Buffer.from(row.pdf_base64, "base64"));
  assert.equal(doc.getPageCount(), 1);
  assert.ok(Math.abs(doc.getPage(0).getWidth() - 1071) < 2);
  assert.ok(Math.abs(doc.getPage(0).getHeight() - expectedHeight) < 2);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  assert.ok(contents, "image-backed page exists");
  // PDF text extraction must reveal no embedded original characters in the
  // fresh raster-only PDF, including text from the other owner's half.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(Buffer.from(row.pdf_base64, "base64")),
    useSystemFonts: true,
  });
  const raw = await loading.promise;
  try {
    const extracted = await (await raw.getPage(1)).getTextContent();
    assert.equal(extracted.items.filter(i => "str" in i && i.str.trim()).length, 0,
      "the split file must not retain any hidden PDF text");
  } finally { await loading.destroy(); }
}

async function checkStaffSearch(browser, account, name) {
  // Staff must work in a fresh context with no admin cookie.
  const context = await browser.newContext();
  const staff = await context.newPage();
  try {
    await staff.goto(base, { waitUntil: "domcontentloaded" });
    await staff.getByRole("button", { name: "ค้นหาใบรับรองการจ่ายเงินเดือน" }).waitFor();
    await staff.locator('input[placeholder="กรอกเลขบัญชี (ไม่ต้องมีขีด)"]').fill(account);
    await staff.getByRole("button", { name: "ค้นหาใบรับรองการจ่ายเงินเดือน" }).click();
    try {
      await staff.getByText("ผลการค้นหา (1 รายการ)").waitFor({ timeout: 15000 });
    } catch (error) {
      const screen = (await staff.locator("body").innerText()).slice(-800);
      const direct = await context.request.post(base + "/api/payroll/search", {
        headers: { Origin: base }, data: { bankAccount: account },
      });
      const body = await direct.text();
      throw new Error("staff lookup failed, screen=" + screen +
        "; API status=" + direct.status() + "; API results=" + body.slice(0,700) +
        "; underlying=" + String(error));
    }
    await staff.getByText(name, { exact: true }).waitFor({ timeout: 15000 });
    const pdf = await context.request.post(base + "/api/payroll/pdf", {
      headers: { Origin: base },
      data: { bankAccount: account, month: "มกราคม", year: "2569" },
    });
    if (await staff.getByText("ใบรับรองการจ่ายเงินเดือน ประจำเดือน มกราคม").count())
      assert.equal(pdf.status(), 200, "anonymous staff can retrieve only own selected PDF");
  } finally { await context.close(); }
}

async function main() {
  const fakeSupabase = await startMockSupabase();
  let server;
  try { server = await startServer(); }
  catch (error) { await new Promise(resolve => fakeSupabase.close(resolve)); throw error; }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    console.log("Browser test uses localhost and fully mocked external services.");
    const visitor = await browser.newContext();
    try {
      const forbidden = await visitor.request.get(base + "/api/admin/history");
      assert.equal(forbidden.status(), 401, "unauthenticated staff cannot list admin history");
      const forbiddenMutation = await visitor.request.post(base + "/api/admin/preflight", {
        headers: { Origin: base }, data: { month: "ตุลาคม", year: "2569" },
      });
      assert.equal(forbiddenMutation.status(), 401, "unauthenticated staff cannot reach admin writes");
    } finally { await visitor.close(); }


    // A: traditional single slip, upload + retrieval.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const {page,errors,messages} = await submitOnAdmin(context, pdf, "มกราคม");
        await awaitUploadSuccess(page, messages, errors);
        assert.deepEqual(errors, []);
        assert.equal(state.rows.length, 1);
        assert.equal(state.rows[0].bank_account, persons[0].account);
        await checkStoredImageOnlyPDF(state.rows[0], 792);
        await checkStaffSearch(browser, persons[0].account, persons[0].name);
        await page.close();
        console.log("PASS A: admin upload -> 1 PDF -> staff account lookup.");
      } finally { await context.close(); }
    }

    // B: two people in one page; ensure distinct separated outputs.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "B", persons.slice(0, 2));
        const {page,errors,messages} = await submitOnAdmin(context, pdf);
        await awaitUploadSuccess(page, messages, errors);
        assert.deepEqual(errors, []);
        assert.equal(state.rows.length, 2);
        assert.deepEqual(state.rows.map(x => x.bank_account), persons.slice(0, 2).map(x => x.account));
        assert.notEqual(state.rows[0].pdf_base64, state.rows[1].pdf_base64);
        for (const row of state.rows) await checkStoredImageOnlyPDF(row, 396);
        await checkStaffSearch(browser, persons[1].account, persons[1].name);
        await page.close();
        console.log("PASS B: 2 people on same page -> separate half-page PDFs -> lookup.");
      } finally { await context.close(); }
    }

    // B odd: two slips first page plus one full page at end.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "B", persons);
        const {page,errors,messages} = await submitOnAdmin(context, pdf);
        await awaitUploadSuccess(page, messages, errors);
        assert.deepEqual(errors, []);
        assert.equal(state.rows.length, 3);
        for (let i = 0; i < 3; i++)
          await checkStoredImageOnlyPDF(state.rows[i], i < 2 ? 396 : 792);
        await page.close();
        console.log("PASS B odd: 3 people / 2 pages -> 3 stored PDFs.");
      } finally { await context.close(); }
    }

    // Mismatched position: fail closed; nothing written.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "A", [persons[0]], true);
        const {page,messages} = await submitOnAdmin(context, pdf);
        await until(() => messages.length > 0, "position mismatch alert");
        assert.equal(state.rows.length, 0);
        assert.equal(state.history.length, 0);
        assert.ok(messages.some(s => s.includes("เลขตำแหน่ง")), "failure identifies verification field");
        await page.close();
        console.log("PASS negative: wrong position blocks any write.");
      } finally { await context.close(); }
    }

    // Wrong registered name: matching account and position must not override it.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const spoof = { ...persons[0], name: "นายผิดชื่อ ทดสอบ" };
        const pdf = await printablePdf(browser, "A", [spoof]);
        const {page,messages} = await submitOnAdmin(context, pdf);
        await until(() => messages.length > 0, "name mismatch alert");
        assert.equal(state.rows.length, 0);
        assert.equal(state.history.length, 0);
        await page.close();
        console.log("PASS negative: name mismatch cannot publish.");
      } finally { await context.close(); }
    }

    // One mismatch on a 2-person B page must abort the whole month.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "B", persons.slice(0, 2), true);
        const {page,messages} = await submitOnAdmin(context, pdf);
        await until(() => messages.length > 0, "mixed valid/invalid two-person page alert");
        assert.equal(state.rows.length, 0);
        assert.equal(state.history.length, 0);
        await page.close();
        console.log("PASS negative: B page partial ownership mismatch rejects whole batch.");
      } finally { await context.close(); }
    }

    // Previously uploaded period: refuse overwrite, even with a valid PDF.
    {
      const original = {
        id: "already-published", month: "มกราคม", year: "2569",
        bank_account: persons[0].account, pdf_base64: "not-mutated",
      };
      const state = { rows: [original], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const {page,messages} = await submitOnAdmin(context, pdf, "มกราคม");
        await until(() => messages.length > 0, "existing period alert");
        assert.equal(state.rows.length, 1);
        assert.equal(state.rows[0].pdf_base64, "not-mutated");
        assert.equal(state.history.length, 0);
        await page.close();
        console.log("PASS negative: existing period is not overwritten or deleted.");
      } finally { await context.close(); }
    }


    // A partly staged period must remain invisible until finalization.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      const visitor = await browser.newContext();
      try {
        const admin = await context.newPage();
        await admin.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await admin.getByText("ระบบจัดการสลิปเงินเดือน").waitFor();
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const month = "พฤศจิกายน", year = "2569";
        const stageRow = { name: persons[0].name, bank_account: persons[0].account,
          month, year, pdf_base64: pdf.toString("base64") };
        const stageResult = await admin.evaluate(async row => {
          const response = await fetch("/api/admin/slips", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: [row] }),
          });
          return { status: response.status, text: await response.text() };
        }, stageRow);
        assert.equal(stageResult.status, 200, stageResult.text);
        assert.equal(state.rows.length, 1);
        assert.equal(state.history.length, 0);
        const lookup = await visitor.request.post(base + "/api/payroll/search", {
          headers: { Origin: base }, data: { bankAccount: persons[0].account },
        });
        assert.equal(lookup.status(), 200);
        assert.equal((await lookup.json()).results.length, 0,
          "staged slip is hidden from staff until the history is published");
        const hiddenPdf = await visitor.request.post(base + "/api/payroll/pdf", {
          headers: { Origin: base },
          data: { bankAccount: persons[0].account, month, year },
        });
        assert.equal(hiddenPdf.status(), 404);
        const finalizeResult = await admin.evaluate(async ({ month, year }) => {
          const response = await fetch("/api/admin/finalize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month, year, fileName: "fictional-payroll.pdf", expectedCount: 1 }),
          });
          return { status: response.status, text: await response.text() };
        }, { month, year });
        assert.equal(finalizeResult.status, 200, finalizeResult.text);
        const visible = await visitor.request.post(base + "/api/payroll/search", {
          headers: { Origin: base }, data: { bankAccount: persons[0].account },
        });
        assert.equal((await visible.json()).results.length, 1);
        console.log("PASS staged upload: not visible to staff before publish, visible after.");
      } finally { await visitor.close(); await context.close(); }
    }

    // Capacity regression: 39 fictitious staff -> 20 pages, last with one.
    // This is a browser-only benchmark, not a production performance claim.
    {
      const glyphs = [..."กขคฆงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ"];
      const large = Array.from({ length: 39 }, (_, i) => ({
        name: "นายทดสอบ " + glyphs[Math.floor(i / glyphs.length)] + glyphs[i % glyphs.length],
        account: String(7000000000 + i),
        position: String(1000000 + i),
      }));
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state, large);
      try {
        const pdf = await printablePdf(browser, "B", large);
        const start = Date.now();
        const {page,messages,errors} = await submitOnAdmin(context, pdf, "ตุลาคม");
        await awaitUploadSuccess(page, messages, errors, 150000);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        assert.equal(state.rows.length, 39, "all fictitious owners must be stored");
        assert.equal(state.history.length, 1);
        assert.equal(new Set(state.rows.map(x => x.bank_account)).size, 39);
        assert.ok(state.rows.every(x => x.pdf_base64?.length > 1000));
        console.log("PASS volume: 39 synthetic slips / 20 pages processed in " + elapsed + " seconds on CI runner.");
        await page.close();
      } finally { await context.close(); }
    }

  } finally {
    if (browser) await browser.close();
    process.kill(-server.pid, "SIGTERM");
    await new Promise(resolve => fakeSupabase.close(resolve));
  }
}

main().catch(error => {
  console.error("Synthetic browser E2E failed:", error.stack || error.message);
  process.exitCode = 1;
});
