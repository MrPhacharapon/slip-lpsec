/**
 * Isolated browser end-to-end test: synthetic persons and printable PDF only.
 * All Google Sheets and Supabase requests are intercepted in the browser.
 * Never connect this test to production or use real payroll files.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const base = "http://127.0.0.1:3100";
const persons = [
  { name: "นายทดสอบ หนึ่ง", account: "1234567890", position: "0000001" },
  { name: "นางสาวทดลอง สอง", account: "0987654321", position: "0000002" },
  { name: "นางสาวทดลอง สาม", account: "1112223334", position: "0000003" },
];
const csv = [
  ["ชื่อและนามสกุล", "ตำแหน่ง", "เลขบัญชี", "รายการรายรับ (เลขตำแหน่ง)"],
  ...persons.map(p => [p.name, "ครู", p.account, p.position]),
].map(r => r.join(",")).join("\r\n");

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
    env: { ...process.env, NODE_ENV: "production" },
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

function slipHtml(person, topPt = 0, printedPosition = person.position) {
  // Use exactly the Thai headings present on the actual PDF template.
  return [
    '<section style="position:absolute;top:', String(topPt + 10),
    'pt;left:30pt;width:1000pt;font-size:15pt;line-height:26pt">',
    '<div>ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน กันยายน ปี พ.ศ. 2569</div>',
    '<div>ชื่อ -นามสกุล ', person.name, '</div>',
    '<div>รายการรายรับ เลขตำแหน่ง ', printedPosition,
    ' โอนเงินเข้า ธนาคารกรุงไทย จำกัด(มหาชน) เลขที่บัญชี ', person.account, '</div>',
    '<div>เงินเดือนและรายการรายรับ 99999.99</div>',
    '</section>',
  ].join("");
}

async function printablePdf(browser, layout, rosterPeople, wrongPosition = false) {
  let groups;
  if (layout === "A") {
    groups = rosterPeople.map(p => [p]);
  } else {
    groups = [];
    for (let i = 0; i < rosterPeople.length; i += 2) groups.push(rosterPeople.slice(i, i + 2));
  }
  const sheets = groups.map((group, index) => {
    const content = group.map((person, sub) => slipHtml(person, sub * 396,
      wrongPosition && index === 0 && sub === 0 ? "9999999" : person.position)).join("");
    return '<article class="sheet">' + content + '</article>';
  }).join("");
  const page = await browser.newPage();
  try {
    await page.setContent([
      '<html lang="th"><meta charset="utf-8"><style>',
      '@page { size: 1071pt 792pt; margin:0; }',
      'html,body { margin:0; padding:0; font-family:"Noto Sans Thai","Loma",sans-serif; }',
      '.sheet { width:1071pt; height:792pt; position:relative; break-after:page; }',
      '.sheet:last-child { break-after:auto; }',
      '</style><body>', sheets, '</body></html>',
    ].join(""));
    await page.evaluate(() => document.fonts.ready);
    const buffer = await page.pdf({
      width: "1071pt", height: "792pt", printBackground: true,
      preferCSSPageSize: true, margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    const file = await PDFDocument.load(buffer);
    assert.equal(file.getPageCount(), groups.length, "synthetic PDF has correct page count");
    return buffer;
  } finally { await page.close(); }
}

async function makeSandboxContext(browser, state) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => { sessionStorage.setItem("adminAuth", "true"); });
  await context.route(/https:\/\/(example\.supabase\.co|docs\.google\.com)\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers });
    }
    if (url.hostname === "docs.google.com") {
      return route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "text/csv;charset=utf-8" },
        body: csv,
      });
    }
    if (url.pathname.includes("/rest/v1/slips")) {
      if (request.method() === "POST") {
        const rows = JSON.parse(request.postData() || "[]");
        assert.ok(Array.isArray(rows), "insert is a batch of rows");
        state.rows.push(...rows);
        return route.fulfill({ status: 201, headers, body: "[]" });
      }
      const accountFilter = url.searchParams.get("bank_account");
      const monthFilter = url.searchParams.get("month");
      const yearFilter = url.searchParams.get("year");
      let selected = state.rows.filter(row =>
        (!accountFilter || row.bank_account === accountFilter.replace(/^eq\./, "")) &&
        (!monthFilter || row.month === monthFilter.replace(/^eq\./, "")) &&
        (!yearFilter || row.year === yearFilter.replace(/^eq\./, "")));
      if (url.searchParams.has("limit")) selected = selected.slice(0, Number(url.searchParams.get("limit")));
      return route.fulfill({ status: 200, headers, body: JSON.stringify(selected) });
    }
    if (url.pathname.includes("/rest/v1/upload_history")) {
      if (request.method() === "POST") {
        const row = JSON.parse(request.postData() || "{}");
        state.history.push({ ...row, id: String(state.history.length + 1), created_at: new Date().toISOString() });
        return route.fulfill({ status: 201, headers, body: "[]" });
      }
      return route.fulfill({ status: 200, headers, body: JSON.stringify(state.history) });
    }
    throw new Error("Unexpected external mock request " + request.method() + " " + url.pathname);
  });
  return context;
}

async function submitOnAdmin(context, pdf, month = "กันยายน") {
  const page = await context.newPage();
  const messages = [];
  page.on("dialog", async dialog => {
    if (dialog.type() === "alert") messages.push(dialog.message());
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
}

async function checkStaffSearch(context, account, name) {
  const staff = await context.newPage();
  try {
    await staff.goto(base, { waitUntil: "domcontentloaded" });
    await staff.getByRole("button", { name: "ค้นหาใบรับรองการจ่ายเงินเดือน" }).waitFor();
    await staff.locator('input[placeholder="กรอกเลขบัญชี (ไม่ต้องมีขีด)"]').fill(account);
    await staff.getByRole("button", { name: "ค้นหาใบรับรองการจ่ายเงินเดือน" }).click();
    await staff.getByText("ผลการค้นหา (1 รายการ)").waitFor({ timeout: 15000 });
    await staff.getByText(name, { exact: true }).waitFor({ timeout: 15000 });
  } finally { await staff.close(); }
}

async function main() {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    console.log("Browser test uses localhost and fully mocked external services.");

    // A: traditional single slip, upload + retrieval.
    {
      const state = { rows: [], history: [] };
      const context = await makeSandboxContext(browser, state);
      try {
        const pdf = await printablePdf(browser, "A", [persons[0]]);
        const {page,errors} = await submitOnAdmin(context, pdf, "มกราคม");
        await page.getByText("อัปโหลดสำเร็จ!").waitFor({ timeout: 45000 });
        assert.deepEqual(errors, []);
        assert.equal(state.rows.length, 1);
        assert.equal(state.rows[0].bank_account, persons[0].account);
        await checkStoredImageOnlyPDF(state.rows[0], 792);
        await checkStaffSearch(context, persons[0].account, persons[0].name);
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
        const {page,errors} = await submitOnAdmin(context, pdf);
        await page.getByText("อัปโหลดสำเร็จ!").waitFor({ timeout: 45000 });
        assert.deepEqual(errors, []);
        assert.equal(state.rows.length, 2);
        assert.deepEqual(state.rows.map(x => x.bank_account), persons.slice(0, 2).map(x => x.account));
        assert.notEqual(state.rows[0].pdf_base64, state.rows[1].pdf_base64);
        for (const row of state.rows) await checkStoredImageOnlyPDF(row, 396);
        await checkStaffSearch(context, persons[1].account, persons[1].name);
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
        const {page,errors} = await submitOnAdmin(context, pdf);
        await page.getByText("อัปโหลดสำเร็จ!").waitFor({ timeout: 45000 });
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
  } finally {
    if (browser) await browser.close();
    process.kill(-server.pid, "SIGTERM");
  }
}

main().catch(error => {
  console.error("Synthetic browser E2E failed:", error.stack || error.message);
  process.exitCode = 1;
});
