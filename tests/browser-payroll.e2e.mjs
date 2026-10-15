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
      PAYROLL_RATE_LIMIT_SECRET: "synthetic-rate-limit-key-for-CI-not-production-2026",
      STAFF_DIRECTORY_DISABLED: "true",
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
    // The user confirmed bank-account-only staff lookup (no login or OTP).
    assert.equal(await staff.locator('input[autocomplete="one-time-code"], input[name="otp"], input[placeholder*="OTP"]').count(), 0,
      "staff lookup must not introduce an OTP field");

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
    await staff.locator('input[placeholder="กรอกเลขบัญชี (ไม่ต้องมีขีด)"]').fill("9000000099");
    await staff.getByText("ผลการค้นหา (1 รายการ)").waitFor({ state: "hidden" });
    assert.equal(await staff.getByText(name, { exact: true }).count(), 0,
      "changing account clears stale owner's visible PDF results");
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
      const noPreview = await visitor.request.post(base + "/api/admin/staged-recovery", {
        headers: { Origin: base }, data: { month: "ตุลาคม", year: "2569" },
      });
      assert.equal(noPreview.status(), 401, "unauthenticated clients cannot inspect staged payroll");
      const noDiscard = await visitor.request.delete(base + "/api/admin/staged-recovery", {
        headers: { Origin: base }, data: {
          month: "ตุลาคม", year: "2569", expectedCount: 1,
          snapshot: "a".repeat(64), confirmation: "ลบสลิปค้าง ตุลาคม 2569",
        },
      });
      assert.equal(noDiscard.status(), 401, "unauthenticated clients cannot discard staged payroll");
      const forbiddenLine = await visitor.request.post(base + "/api/send-line", {
        headers: { Origin: base }, data: { month: "ตุลาคม", year: "2569" },
      });
      assert.equal(forbiddenLine.status(), 401, "public visitors cannot trigger LINE payroll announcements");
    } finally { await visitor.close(); }


    // The admin API must reject forged/malformed PDF payloads even when
    // submitted directly, bypassing PDF.js validation in the browser.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      const admin = await context.newPage();
      try {
        await admin.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await admin.getByText("ระบบจัดการสลิปเงินเดือน").waitFor();
        const pdfDocument = await PDFDocument.create();
        pdfDocument.addPage([1071, 792]);
        pdfDocument.addPage([1071, 792]);
        const twoPagePdf = Buffer.from(await pdfDocument.save()).toString("base64");
        const result = await admin.evaluate(async ({twoPagePdf, person}) => {
          const response = await fetch("/api/admin/slips", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: [{
              name: person.name, bank_account: person.account,
              month: "ตุลาคม", year: "2569", pdf_base64: twoPagePdf,
            }] }),
          });
          return response.status;
        }, { twoPagePdf, person: persons[0] });
        assert.equal(result, 400, "direct admin API rejects an unsplit two-page PDF");
        assert.equal(state.rows.length, 0, "invalid document must never be stored");
        console.log("PASS server-side PDF structural validation: direct multi-page submission refused.");
      } finally { await context.close(); }
    }

    // Failure to reach the shared limiter must never silently bypass it.
    {
      setMockState({ rows: [], history: [], rateLimiterUnavailable: true });
      const visitor = await browser.newContext();
      try {
        const lookup = await visitor.request.post(base + "/api/payroll/search", {
          headers: { Origin: base }, data: { bankAccount: "9000000123" },
        });
        assert.equal(lookup.status(), 503, "search fails closed when limiter cannot be reached");
        const pdf = await visitor.request.post(base + "/api/payroll/pdf", {
          headers: { Origin: base },
          data: { bankAccount: "9000000123", month: "มกราคม", year: "2569" },
        });
        assert.equal(pdf.status(), 503, "PDF download fails closed when limiter cannot be reached");
        console.log("PASS fail-closed: search/PDF withheld during rate-limit service outage.");
      } finally { await visitor.close(); }
    }

    // Distributed-style rate limiting applies without a staff login or OTP.
    {
      setMockState({ rows: [], history: [] });
      const visitor = await browser.newContext();
      try {
        for (let attempt = 1; attempt <= 20; attempt++) {
          const response = await visitor.request.post(base + "/api/payroll/search", {
            headers: { Origin: base }, data: { bankAccount: "9000000123" },
          });
          assert.equal(response.status(), 200, "first 20 same-account searches are permitted");
        }
        const excess = await visitor.request.post(base + "/api/payroll/search", {
          headers: { Origin: base }, data: { bankAccount: "9000000123" },
        });
        assert.equal(excess.status(), 429, "21st search for one bank account is throttled");
        assert.equal(excess.headers()["retry-after"], "600");
        console.log("PASS anonymous staff search rate limiting: 429 after per-account quota.");
      } finally { await visitor.close(); }
    }
    // Direct PDF requests must also be rate-limited; no bypass via the
    // download endpoint when someone guesses valid account numbers.
    {
      setMockState({ rows: [], history: [] });
      const visitor = await browser.newContext();
      try {
        for (let attempt = 1; attempt <= 20; attempt++) {
          const response = await visitor.request.post(base + "/api/payroll/pdf", {
            headers: { Origin: base },
            data: { bankAccount: "9000000432", month: "มกราคม", year: "2569" },
          });
          assert.equal(response.status(), 404, "unpublished PDF is not available");
        }
        const excess = await visitor.request.post(base + "/api/payroll/pdf", {
          headers: { Origin: base },
          data: { bankAccount: "9000000432", month: "มกราคม", year: "2569" },
        });
        assert.equal(excess.status(), 429, "21st PDF request for one bank account is throttled");
        console.log("PASS anonymous direct PDF access rate limiting: 429 after account quota.");
      } finally { await visitor.close(); }
    }
    // Wrong admin password attempts are throttled even with a valid Origin.
    {
      setMockState({ rows: [], history: [] });
      const visitor = await browser.newContext();
      try {
        for (let attempt = 1; attempt <= 40; attempt++) {
          const response = await visitor.request.post(base + "/api/auth", {
            headers: { Origin: base }, data: { password: "wrong-synthetic-password" },
          });
          assert.equal(response.status(), 401, "invalid admin passwords rejected before quota");
        }
        const excess = await visitor.request.post(base + "/api/auth", {
          headers: { Origin: base }, data: { password: "wrong-synthetic-password" },
        });
        assert.equal(excess.status(), 429, "repeated invalid login attempts are throttled");
        console.log("PASS admin password rate limiting: 429 after per-IP quota.");
      } finally { await visitor.close(); }
    }

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
        assert.ok(messages.some(message => message.includes("อัปโหลดค้าง 1 รายการ")),
          "unpublished staged rows must be identified separately before any retry");
        assert.equal(state.rows.length, 1);
        assert.equal(state.rows[0].pdf_base64, "not-mutated");
        assert.equal(state.history.length, 0);
        await page.close();
        console.log("PASS negative: existing period is not overwritten or deleted.");
      } finally { await context.close(); }
    }


    // Published month must never be rewritten, even if an admin submits the same file.
    {
      const original = { id: "already-published", month: "มกราคม", year: "2569",
        bank_account: persons[0].account, pdf_base64: "existing-file" };
      const state = { rows: [original], history: [{
        id: "published-uuid", month: "มกราคม", year: "2569",
        file_name: "old-payroll.pdf", storage_path: null, created_at: new Date().toISOString(),
      }] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, messages } = await submitOnAdmin(context, pdf, "มกราคม");
        await until(() => messages.length > 0, "published period warning");
        assert.ok(messages.some(message => message.includes("เผยแพร่แล้ว")),
          "already-published month must show a different warning from staged rows");
        assert.equal(state.rows[0].pdf_base64, "existing-file");
        assert.equal(state.history.length, 1);
        await page.close();
      } finally { await context.close(); }
    }

    // Unpublished staging recovery: preview, explicit typed confirmation,
    // atomic snapshot check, and never deleting already published payroll.
    {
      const state = { rows: [{
        id: "staged-recovery-one", name: persons[0].name,
        bank_account: persons[0].account, month: "มกราคม", year: "2569",
        pdf_base64: "FICTIONAL_NOT_PUBLISHED",
      }], history: [] };
      const context = await makeSandboxContext(browser, state);
      const admin = await context.newPage();
      try {
        await admin.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await admin.getByText("ระบบจัดการสลิปเงินเดือน").waitFor();

        await admin.getByRole("button", { name: "ตรวจสอบข้อมูลอัปโหลดค้าง" }).click();
        await admin.getByText("พบสลิปที่ยังไม่เผยแพร่ 1 รายการ").waitFor();
        const inspection = await admin.evaluate(async () => {
          const r = await fetch("/api/admin/staged-recovery", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month: "มกราคม", year: "2569" }),
          });
          return { status: r.status, value: await r.json() };
        });
        assert.equal(inspection.status, 200);
        assert.match(inspection.value.snapshot, /^[a-f0-9]{64}$/);

        state.rows.push({
          id: "staged-recovery-second", name: persons[1].name,
          bank_account: persons[1].account, month: "มกราคม", year: "2569",
          pdf_base64: "FICTIONAL_NOT_PUBLISHED",
        });
        const stale = await admin.evaluate(async ({snapshot}) => {
          const r = await fetch("/api/admin/staged-recovery", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              month: "มกราคม", year: "2569", expectedCount: 1, snapshot,
              confirmation: "ลบสลิปค้าง มกราคม 2569",
            }),
          });
          return r.status;
        }, {snapshot: inspection.value.snapshot});
        assert.equal(stale, 409, "stale preview must not delete newly staged data");
        assert.equal(state.rows.length, 2);

        await admin.getByRole("button", { name: "ตรวจสอบข้อมูลอัปโหลดค้าง" }).click();
        await admin.getByText("พบสลิปที่ยังไม่เผยแพร่ 2 รายการ").waitFor();
        admin.once("dialog", dialog => dialog.accept("ลบสลิปค้าง มกราคม 2569"));
        await admin.getByRole("button", { name: "ยืนยันการล้างสลิปค้าง (ต้องพิมพ์ยืนยันอีกครั้ง)" }).click();
        // After request succeeds a separate success alert is displayed.
        admin.once("dialog", dialog => dialog.accept());
        await until(() => state.rows.length === 0, "explicit recovery removed only staged rows");
        assert.equal(state.history.length, 0, "recovery never creates or removes publication history");
        console.log("PASS staged recovery: stale snapshot denied; typed confirmation deletes only unpublished rows.");
      } finally { await context.close(); }
    }
    {
      const state = {
        rows: [{ id: "published-protected", name: persons[0].name,
          bank_account: persons[0].account, month: "มกราคม", year: "2569",
          pdf_base64: "PUBLISHED_DOCUMENT" }],
        history: [{ id: "published-history", month: "มกราคม", year: "2569",
          file_name: "fictional.pdf", storage_path: null, created_at: new Date().toISOString() }],
      };
      const context = await makeSandboxContext(browser, state);
      const admin = await context.newPage();
      try {
        await admin.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await admin.getByText("ระบบจัดการสลิปเงินเดือน").waitFor();
        await admin.getByRole("button", { name: "ตรวจสอบข้อมูลอัปโหลดค้าง" }).click();
        await admin.getByText("เดือนนี้เผยแพร่แล้ว ไม่อนุญาตให้ใช้วิธีกู้คืนสลิปค้าง").waitFor();
        assert.equal(await admin.getByRole("button", { name: "ยืนยันการล้างสลิปค้าง (ต้องพิมพ์ยืนยันอีกครั้ง)" }).count(), 0);
        const attempted = await admin.evaluate(async () => {
          const r = await fetch("/api/admin/staged-recovery", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              month: "มกราคม", year: "2569", expectedCount: 1,
              snapshot: "a".repeat(64), confirmation: "ลบสลิปค้าง มกราคม 2569",
            }),
          });
          return r.status;
        });
        assert.equal(attempted, 409);
        assert.equal(state.rows.length, 1);
        assert.equal(state.history.length, 1);
        console.log("PASS published-month recovery guard: no destructive action available.");
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
        const prematurePublish = await admin.evaluate(async ({ month, year }) => {
          const res = await fetch("/api/admin/finalize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month, year, fileName: "fictional-payroll.pdf", expectedCount: 2 }),
          });
          return res.status;
        }, { month, year });
        assert.equal(prematurePublish, 409, "incorrect expected count cannot publish staged rows");
        assert.equal(state.history.length, 0, "failed transaction leaves month unpublished");
        const finalizeResult = await admin.evaluate(async ({ month, year }) => {
          const response = await fetch("/api/admin/finalize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month, year, fileName: "fictional-payroll.pdf", expectedCount: 1 }),
          });
          return { status: response.status, text: await response.text() };
        }, { month, year });
        assert.equal(finalizeResult.status, 200, finalizeResult.text);
        const secondPublish = await admin.evaluate(async ({ month, year }) => {
          const res = await fetch("/api/admin/finalize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month, year, fileName: "duplicate.pdf", expectedCount: 1 }),
          });
          return res.status;
        }, { month, year });
        assert.equal(secondPublish, 409, "second publish must be blocked");
        assert.equal(state.history.length, 1, "failed second publish creates no duplicate history");
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
