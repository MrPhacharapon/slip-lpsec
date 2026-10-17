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
  setMockState(state);
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route("**/api/admin/roster", async route => {
    // Browser-fixture response only; the real authenticated API is independently
    // tested against localhost without this Playwright interception.
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ roster: personnel.map(p => ({
        name: p.name, bankAccount: p.account, positionNumber: p.position,
      })) }) });
  });
  // Notification requests are synthetic in browser CI: never call real LINE.
  // Specific scenarios below override this route to verify delivery semantics.
  await context.route("**/api/send-line", async route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ success: true }),
  }));
  await context.route(/https:\/\/(example\.supabase\.co|docs\.google\.com)\//, async route => {
    throw new Error("Browser attempted to reach external payroll data source");
  });
  const login = await context.request.post(base + "/api/auth", {
    headers: { Origin: base }, data: { password: "synthetic-admin-password-do-not-use" },
  });
  assert.equal(login.status(), 200, "admin signed cookie is established");
  return context;
}

async function submitOnAdmin(context, pdf, month = "กันยายน", localRosterCsv = null,
  sendNotification = true) {
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
  if (localRosterCsv !== null) {
    await page.getByLabel("ไฟล์ CSV ทะเบียนบุคลากร (ไม่บังคับ)").setInputFiles({
      name: "SYNTHETIC_ONLY_roster.csv",
      mimeType: "text/csv", buffer: Buffer.from(localRosterCsv),
    });
  }
  if (!sendNotification) await page.locator("#notify-line").uncheck();
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
      const noPublishedPreview = await visitor.request.post(base + "/api/admin/published-deletion", {
        headers: { Origin: base }, data: {
          id: "22222222-2222-4222-8222-222222222222",
          month: "มกราคม", year: "2569",
        },
      });
      assert.equal(noPublishedPreview.status(), 401, "anonymous users cannot preview published deletion");
      const noPublishedDelete = await visitor.request.delete(base + "/api/admin/published-deletion", {
        headers: { Origin: base }, data: {
          id: "22222222-2222-4222-8222-222222222222",
          month: "มกราคม", year: "2569",
          expectedCount: 1, snapshot: "a".repeat(64), backupConfirmed: true,
          confirmation: "ลบสลิปที่เผยแพร่ มกราคม 2569",
        },
      });
      assert.equal(noPublishedDelete.status(), 401, "anonymous users cannot delete published payroll");
      const forbiddenLine = await visitor.request.post(base + "/api/send-line", {
        headers: { Origin: base }, data: { month: "ตุลาคม", year: "2569" },
      });
      assert.equal(forbiddenLine.status(), 401, "public visitors cannot trigger LINE payroll announcements");

      // A staff-facing account-only lookup is not a cross-origin public API.
      // These requests must fail before database access or rate counting.
      for (const route of ["/api/payroll/search", "/api/payroll/pdf"]) {
        const rejected = await visitor.request.post(base + route, {
          headers: { Origin: "https://cross-site.invalid" },
          data: { bankAccount: "9000000123", month: "มกราคม", year: "2569" },
        });
        assert.equal(rejected.status(), 403, "foreign Origin blocked: " + route);
      }
      const forbiddenRoster = await visitor.request.get(base + "/api/admin/roster");
      assert.equal(forbiddenRoster.status(), 401,
        "staff roster with bank accounts must never be available anonymously");
      const forbiddenOriginal = await visitor.request.get(base +
        "/api/admin/storage?path=synthetic.pdf");
      assert.equal(forbiddenOriginal.status(), 401,
        "original source PDF cannot be downloaded by an anonymous visitor");
      const forbiddenStage = await visitor.request.post(base + "/api/admin/slips", {
        headers: { Origin: base }, data: { rows: [] },
      });
      assert.equal(forbiddenStage.status(), 401, "anonymous client cannot stage slips");
      const forbiddenPublish = await visitor.request.post(base + "/api/admin/finalize", {
        headers: { Origin: base },
        data: { month: "มกราคม", year: "2569", expectedCount: 1, fileName: "fake.pdf" },
      });
      assert.equal(forbiddenPublish.status(), 401, "anonymous client cannot publish");
      console.log("PASS security boundaries: anonymous Admin access and cross-origin staff PDF/search refused.");
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

        // On local HTTP, a Secure cookie may not enter Playwright's cookie
        // jar. Obtain a real signed test session from the login response,
        // then explicitly attach it only to this synthetic CSRF check.
        const testLogin = await context.request.post(base + "/api/auth", {
          headers: { Origin: base },
          data: { password: "synthetic-admin-password-do-not-use" },
        });
        assert.equal(testLogin.status(), 200, "sandbox Admin login for CSRF check");
        const signedCookie = testLogin.headers()["set-cookie"]?.split(";")[0] ?? "";
        assert.match(signedCookie, /^payroll_admin_session=[^.]+\.[^.]+$/,
          "sandbox login returned a signed session cookie");
        const unavailableRoster = await context.request.get(base + "/api/admin/roster", {
          headers: { Cookie: signedCookie },
        });
        assert.equal(unavailableRoster.status(), 503,
          "disabled private Test roster must refuse outbound Google Sheets access");
        for (const route of ["/api/admin/preflight", "/api/admin/finalize",
          "/api/admin/slips", "/api/send-line"]) {
          const rejected = await context.request.post(base + route, {
            headers: {
              Origin: "https://cross-site.invalid",
              Cookie: signedCookie,
            },
            data: route.endsWith("/slips") ? { rows: [] } :
              { month: "ตุลาคม", year: "2569", fileName: "fake.pdf", expectedCount: 1 },
          });
          assert.equal(rejected.status(), 403,
            "signed Admin cookie must not bypass Origin check: " + route);
        }
        assert.equal(state.rows.length, 0, "cross-site mutation wrote no staged slips");
        console.log("PASS CSRF: signed Admin session cannot mutate from foreign Origin.");

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

    // An HTTP 200 is not sufficient evidence that a batch was saved.
    // A proxy or buggy route must not cause premature publication.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        await context.route("**/api/admin/slips", async route => {
          if (route.request().method() !== "POST") return route.continue();
          return route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify({ success: true, inserted: 0 }),
          });
        });
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, errors, messages } = await submitOnAdmin(context, pdf);
        await until(() => messages.some(m => m.includes("ไม่สามารถยืนยันจำนวนสลิปที่บันทึกได้")),
          "uploader refuses false success with incorrect stage count");
        assert.equal(await page.getByText("อัปโหลดสำเร็จ!").count(), 0);
        assert.equal(state.rows.length, 0, "no staged records were acknowledged");
        assert.equal(state.history.length, 0, "false stage success must not publish");
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS stage acknowledgment: false HTTP 200 cannot publish.");
      } finally { await context.close(); }
    }

    // A finalize response lacking success:true must not show upload success.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        await context.route("**/api/admin/finalize", async route => {
          if (route.request().method() !== "POST") return route.continue();
          return route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify({ success: false }),
          });
        });
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, errors, messages } = await submitOnAdmin(context, pdf);
        await until(() => messages.some(m => m.includes("ไม่สามารถยืนยันการเผยแพร่")),
          "uploader refuses false finalize success");
        assert.equal(await page.getByText("อัปโหลดสำเร็จ!").count(), 0);
        assert.equal(state.rows.length, 1, "staged rows remain for manual review");
        assert.equal(state.history.length, 0, "a false finalize response did not publish");
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS publication acknowledgment: false HTTP 200 is not success.");
      } finally { await context.close(); }
    }

    // Initial history API downtime should show a bounded UI warning, not
    // create an unhandled promise rejection on an authenticated Admin page.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        await context.route("**/api/admin/history", async route => {
          if (route.request().method() === "GET") {
            return route.fulfill({
              status: 503, contentType: "application/json",
              body: JSON.stringify({ error: "synthetic initial-history outage" }),
            });
          }
          return route.continue();
        });
        const page = await context.newPage();
        const errors = [], messages = [];
        page.on("pageerror", err => errors.push(String(err)));
        page.on("dialog", async dialog => {
          messages.push(dialog.message());
          await dialog.accept();
        });
        await page.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await page.getByText("ระบบจัดการสลิปเงินเดือน").waitFor();
        await until(() => messages.some(m =>
          m.includes("ไม่สามารถโหลดประวัติสลิปได้")),
          "initial history outage surfaces recoverable warning");
        assert.deepEqual(errors, [], "initial history failure must not reject an unhandled promise");
        assert.equal(state.rows.length, 0);
        await page.close();
        console.log("PASS initial admin history outage: warning without unhandled rejection.");
      } finally { await context.close(); }
    }

    // Publishing cannot be undone by a failure to refresh the history UI.
    // Show success and a separate refresh warning, never a retry-upload error.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        await context.route("**/api/admin/history", async route => {
          if (route.request().method() === "GET" && state.history.length > 0) {
            return route.fulfill({
              status: 503, contentType: "application/json",
              body: JSON.stringify({ error: "synthetic history refresh failure" }),
            });
          }
          return route.continue();
        });
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, errors, messages } = await submitOnAdmin(context, pdf);
        await awaitUploadSuccess(page, messages, errors);
        await until(() => messages.some(m =>
          m.includes("เผยแพร่สลิปสำเร็จแล้ว แต่โหลดประวัติไม่สำเร็จ")),
          "history refresh failure is a warning after publication");
        assert.equal(state.rows.length, 1, "published slip stays stored");
        assert.equal(state.history.length, 1, "publication is not rolled back");
        assert.ok(!messages.some(m => m.includes("ตรวจสอบเอกสารไม่สำเร็จ")));
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS post-publish history failure: success preserved without retry guidance.");
      } finally { await context.close(); }
    }

    // Drag-and-drop history order must be separate from the actual
    // published timestamp, and a stale/partial reorder must be atomic.
    {
      const originals = [
        { id: "synthetic-old", month: "มกราคม", year: "2569",
          file_name: "fictional-old.pdf", storage_path: null,
          created_at: "2026-01-01T00:00:00Z" },
        { id: "synthetic-new", month: "กุมภาพันธ์", year: "2569",
          file_name: "fictional-new.pdf", storage_path: null,
          created_at: "2026-02-01T00:00:00Z" },
      ];
      const state = { rows: [], history: originals.map(x => ({ ...x })) };
      const context = await makeSandboxContext(browser, state);
      try {
        const page = await context.newPage();
        await page.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await page.getByText("ระบบจัดการสลิปเงินเดือน").waitFor();
        const initial = await page.evaluate(async () =>
          (await (await fetch("/api/admin/history")).json()).history.map(x => x.id));
        assert.deepEqual(initial, ["synthetic-new", "synthetic-old"],
          "unreordered history retains chronological display");
        const updated = await page.evaluate(async () => {
          const res = await fetch("/api/admin/history", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: ["synthetic-old", "synthetic-new"] }),
          });
          return { status: res.status, body: await res.json() };
        });
        assert.equal(updated.status, 200, JSON.stringify(updated.body));
        assert.equal(updated.body.success, true);
        const reordered = await page.evaluate(async () =>
          (await (await fetch("/api/admin/history")).json()).history.map(x => x.id));
        assert.deepEqual(reordered, ["synthetic-old", "synthetic-new"],
          "manual order differs from original chronology");
        assert.deepEqual(state.history.map(x => x.created_at),
          originals.map(x => x.created_at), "audit timestamps unchanged");
        const stale = await page.evaluate(async () => {
          const res = await fetch("/api/admin/history", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: ["synthetic-old"] }),
          });
          return res.status;
        });
        assert.equal(stale, 409, "partial history reorder must fail closed");
        assert.deepEqual(state.history.map(x => x.display_order), [0, 1],
          "failed reorder must leave all positions unchanged");
        await page.close();
        console.log("PASS history reorder: atomic positions without changing created_at.");
      } finally { await context.close(); }
    }

    // Direct Admin POST is not sufficient to announce a payroll period.
    // The route must check the committed publication even without the UI.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const uncommitted = await context.request.post(base + "/api/send-line", {
          headers: { Origin: base },
          data: { month: "กันยายน", year: "2569" },
        });
        assert.equal(uncommitted.status(), 409,
          "Admin must not announce a period without a committed publication");
        assert.equal(state.history.length, 0);
        console.log("PASS LINE API: unpublished periods cannot be announced.");
      } finally { await context.close(); }
    }

    // LINE is sent once after a real publication acknowledgement, not
    // before finalizing the payroll. The checkbox must control the side effect.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const notifications = [];
        await context.route("**/api/send-line", async route => {
          notifications.push({
            payload: route.request().postDataJSON(),
            historyCount: state.history.length,
            stagedCount: state.rows.length,
          });
          return route.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify({ success: true }) });
        });
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, messages, errors } = await submitOnAdmin(context, pdf);
        await awaitUploadSuccess(page, messages, errors);
        await until(() => notifications.length === 1, "LINE once after publication");
        assert.deepEqual(notifications, [{
          payload: { month: "กันยายน", year: "2569" },
          historyCount: 1,
          stagedCount: 1,
        }]);
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS LINE notification: one post-publish request with correct period.");
      } finally { await context.close(); }
    }
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        let notifications = 0;
        await context.route("**/api/send-line", async route => {
          notifications++;
          return route.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify({ success: true }) });
        });
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, messages, errors } = await submitOnAdmin(
          context, pdf, "กันยายน", null, false);
        await awaitUploadSuccess(page, messages, errors);
        await page.waitForLoadState("networkidle");
        assert.equal(notifications, 0, "unchecked LINE must never notify");
        assert.equal(state.history.length, 1, "unchecked LINE cannot block publish");
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS LINE opt-out: payroll published without notification.");
      } finally { await context.close(); }
    }
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        let notifications = 0;
        await context.route("**/api/send-line", async route => {
          notifications++;
          return route.fulfill({ status: 503, contentType: "application/json",
            body: JSON.stringify({ error: "synthetic LINE service outage" }) });
        });
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, messages, errors } = await submitOnAdmin(context, pdf);
        await awaitUploadSuccess(page, messages, errors);
        await until(() => messages.some(m =>
          m.includes("เผยแพร่สลิปสำเร็จแล้ว แต่ส่งแจ้งเตือน LINE ไม่สำเร็จ")),
          "LINE failure is a warning after committed publish");
        assert.equal(notifications, 1);
        assert.equal(state.history.length, 1, "LINE failure cannot undo publish");
        assert.equal(state.rows.length, 1);
        assert.equal(await page.getByText("อัปโหลดสำเร็จ!").count(), 1);
        assert.ok(!messages.some(m => m.includes("ตรวจสอบเอกสารไม่สำเร็จ")));
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS LINE outage: warning only; no duplicate payroll publication.");
      } finally { await context.close(); }
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

    // Reject an A page followed by a compact B page before any staging.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const first = await PDFDocument.load(await printablePdf(browser, "A", [persons[0]]));
        const second = await PDFDocument.load(await printablePdf(browser, "B", persons.slice(1)));
        const combined = await PDFDocument.create();
        for (const document of [first, second]) {
          const [page] = await combined.copyPages(document, [0]);
          combined.addPage(page);
        }
        const result = await submitOnAdmin(context, Buffer.from(await combined.save()));
        await until(() => result.messages.length > 0, "mixed payroll layout rejection");
        assert.equal(state.rows.length, 0);
        assert.equal(state.history.length, 0);
        assert.ok(result.messages.some(s => s.includes("หน้าสุดท้าย")));
        assert.deepEqual(result.errors, []);
        await result.page.close();
      } finally { await context.close(); }
    }

    // Local private CSV can replace the server roster without any Google
    // Sheets request. The original CSV stays within the admin browser.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        await context.route("**/api/admin/roster", route =>
          route.fulfill({ status: 503, contentType: "application/json",
            body: JSON.stringify({ error: "simulated server roster outage" }) }));
        const privateCsv = [
          ["ชื่อ-นามสกุล", "ตำแหน่ง", "เลขที่บัญชี", "เลขตำแหน่ง"],
          ...persons.map(p => [p.name, "ครู", p.account, p.position]),
        ].map(row => row.join(",")).join("\r\n");
        const pdf = await printablePdf(browser, "B", persons);
        const { page, errors, messages } = await submitOnAdmin(
          context, pdf, "กันยายน", privateCsv);
        await awaitUploadSuccess(page, messages, errors);
        assert.equal(state.rows.length, 3);
        assert.equal(state.history.length, 1);
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS local-only CSV roster: upload works without server Sheet access.");
      } finally { await context.close(); }
    }

    // A private CSV with an incorrect position must reject the complete
    // source file; even a readable PDF may never bypass roster ownership.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const wrongCsv = [
          ["ชื่อ-นามสกุล", "ตำแหน่ง", "เลขบัญชี", "เลขตำแหน่ง"],
          [persons[0].name, "ครู", persons[0].account, "9999999"],
        ].map(row => row.join(",")).join("\r\n");
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const { page, messages, errors } = await submitOnAdmin(
          context, pdf, "กันยายน", wrongCsv);
        await until(() => messages.length > 0, "incorrect CSV ownership rejection");
        assert.equal(state.rows.length, 0);
        assert.equal(state.history.length, 0);
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS negative: private CSV with wrong position refuses whole upload.");
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


    // Published deletion is a separate explicit backup-confirmed operation:
    // immutable snapshot, signed admin cookie, and no legacy shortcut.
    {
      const historyId = "22222222-2222-4222-8222-222222222222";
      const state = {
        rows: [{
          id: "11111111-1111-4111-8111-111111111111",
          month: "มกราคม", year: "2569", bank_account: persons[0].account,
          name: persons[0].name, pdf_base64: "SYNTHETIC_PUBLISHED_DOCUMENT",
        }],
        history: [{
          id: historyId, month: "มกราคม", year: "2569",
          file_name: "fictional-published.pdf", storage_path: null,
          created_at: new Date().toISOString(),
        }],
      };
      const context = await makeSandboxContext(browser, state);
      const admin = await context.newPage();
      try {
        await admin.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await admin.getByText("สลิปเดือน มกราคม 2569").waitFor();

        const oldApi = await admin.evaluate(async ({id}) => {
          const r = await fetch("/api/admin/history", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, month: "มกราคม", year: "2569" }),
          });
          return r.status;
        }, {id:historyId});
        assert.equal(oldApi, 405, "legacy non-atomic history delete must be disabled");
        assert.equal(state.rows.length, 1);

        const preview = await admin.evaluate(async ({id}) => {
          const r = await fetch("/api/admin/published-deletion", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, month: "มกราคม", year: "2569" }),
          });
          return { status: r.status, data: await r.json() };
        }, {id:historyId});
        if (preview.status !== 200) {
          const mock = await context.request.post(
            "http://127.0.0.1:3200/rest/v1/rpc/inspect_published_payroll_deletion", {
              data: { p_id: historyId, p_month: "มกราคม", p_year: "2569" },
            });
          throw new Error("Published preview failed (synthetic only) with API=" +
            preview.status + " " + JSON.stringify(preview.data) +
            "; local mock=" + mock.status() + " " + (await mock.text()).slice(0,400));
        }
        assert.equal(preview.data.eligible, true);
        assert.equal(preview.data.slipCount, 1);
        assert.match(preview.data.snapshot, /^[a-f0-9]{64}$/);

        const unconfirmed = await admin.evaluate(async ({id,snapshot}) => {
          const r = await fetch("/api/admin/published-deletion", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, month: "มกราคม", year: "2569",
              expectedCount: 1, snapshot,
              confirmation: "ลบสลิปที่เผยแพร่ มกราคม 2569", backupConfirmed: false }),
          });
          return r.status;
        }, {id:historyId,snapshot:preview.data.snapshot});
        assert.equal(unconfirmed, 400, "missing backup acknowledgement must be rejected");

        state.rows[0].pdf_base64 = "SYNTHETIC_CHANGED_AFTER_PREVIEW";
        const stale = await admin.evaluate(async ({id,snapshot}) => {
          const r = await fetch("/api/admin/published-deletion", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, month: "มกราคม", year: "2569",
              expectedCount: 1, snapshot,
              confirmation: "ลบสลิปที่เผยแพร่ มกราคม 2569", backupConfirmed: true }),
          });
          return r.status;
        }, {id:historyId,snapshot:preview.data.snapshot});
        assert.equal(stale, 409, "PDF changed since preview: delete refused");
        assert.equal(state.rows.length, 1);
        assert.equal(state.history.length, 1);

        const dialogs = [];
        admin.on("dialog", async dialog => {
          dialogs.push(dialog.type());
          if (dialog.type() === "prompt")
            await dialog.accept("ลบสลิปที่เผยแพร่ มกราคม 2569");
          else await dialog.accept();
        });
        await admin.locator('button[title="ลบข้อมูล"]').click();
        await until(() => state.rows.length === 0 && state.history.length === 0,
          "confirmed published period deleted atomically");
        assert.ok(dialogs.includes("confirm") && dialogs.includes("prompt"),
          "published deletion requires backup acknowledgement and typed phrase");
        console.log("PASS published deletion: old API disabled, backup required, stale refused, atomic confirmed delete.");
      } finally { await context.close(); }
    }

    // Published periods with original Storage objects require a separate
    // backup and Storage workflow, even with a valid admin session.
    {
      const historyId = "33333333-3333-4333-8333-333333333333";
      const state = {
        rows: [{ id: "44444444-4444-4444-8444-444444444444",
          month: "มกราคม", year: "2569", bank_account: persons[0].account,
          pdf_base64: "SYNTHETIC_OLD_DOCUMENT" }],
        history: [{ id: historyId, month: "มกราคม", year: "2569",
          file_name: "old-synthetic.pdf", storage_path: "private/original-synthetic.pdf",
          created_at: new Date().toISOString() }],
      };
      const context = await makeSandboxContext(browser,state);
      const admin = await context.newPage();
      try {
        await admin.goto(base + "/admin", { waitUntil: "domcontentloaded" });
        await admin.getByText("สลิปเดือน มกราคม 2569").waitFor();
        const preview = await admin.evaluate(async ({id}) => {
          const r = await fetch("/api/admin/published-deletion", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, month: "มกราคม", year: "2569" }),
          });
          return await r.json();
        }, {id:historyId});
        assert.equal(preview.eligible, false);
        assert.equal(preview.storageProtected, true);
        const attempt = await admin.evaluate(async ({id}) => {
          const r = await fetch("/api/admin/published-deletion", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, month: "มกราคม", year: "2569",
              expectedCount: 1, snapshot: "a".repeat(64),
              confirmation: "ลบสลิปที่เผยแพร่ มกราคม 2569", backupConfirmed: true }),
          });
          return r.status;
        }, {id:historyId});
        assert.equal(attempt, 409, "server refuses published deletion when original file still referenced");
        assert.equal(state.rows.length, 1);
        assert.equal(state.history.length, 1);
        console.log("PASS original Storage file protection: published payroll cannot be deleted automatically.");
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

    // Capacity regression at the realistic 100-person upper planning bound:
    // layout B produces 50 pages; the separate 3-person test covers odd tails.
    // This is a browser-only benchmark, not a production performance claim.
    {
      const glyphs = [..."กขคฆงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ"];
      const large = Array.from({ length: 100 }, (_, i) => ({
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
        assert.equal(state.rows.length, 100, "all fictitious owners must be stored");
        assert.equal(state.history.length, 1);
        assert.equal(new Set(state.rows.map(x => x.bank_account)).size, 100);
        assert.ok(state.rows.every(x => x.pdf_base64?.length > 1000));
        console.log("PASS volume: 100 synthetic slips / 50 pages processed in " + elapsed + " seconds on CI runner.");
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
