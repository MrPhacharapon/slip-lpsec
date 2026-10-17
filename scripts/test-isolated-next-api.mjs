/**
 * Manual, sandbox-only Next.js -> REAL Supabase integration test.
 * No GitHub Actions, public previews, production resources, or actual payroll.
 *
 * Prerequisites:
 *   npm ci
 *   TEST_SUPABASE_RUN=I_UNDERSTAND_TEST_ONLY
 *   TEST_SUPABASE_URL=https://dpaqvxtbpaduknergflm.supabase.co
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<secret from sliplpsec-test, never in chat>
 *   node scripts/test-isolated-next-api.mjs
 *
 * Secrets are read from the user's private environment and never printed.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { spawn } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const TEST_URL = "https://dpaqvxtbpaduknergflm.supabase.co";
const ORIGIN = "http://127.0.0.1:3137";
const OPT_IN = "I_UNDERSTAND_TEST_ONLY";
if (process.env.TEST_SUPABASE_RUN !== OPT_IN ||
    process.env.TEST_SUPABASE_URL !== TEST_URL ||
    !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY.length < 30) {
  throw new Error("Refusing to run: isolated test URL and private TEST credentials are required");
}

const db = createClient(TEST_URL, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = process.env.TEST_SUPABASE_PUBLISHABLE_KEY
  ? createClient(TEST_URL, process.env.TEST_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const monthIndex = randomInt(MONTHS.length);
const year = String(2590 + randomInt(10));
const staged = { month: MONTHS[monthIndex], year };
const published = { month: MONTHS[(monthIndex + 1) % MONTHS.length], year };
const runId = randomUUID().slice(0, 8);
const seed = randomInt(100000000, 999999998);
const people = [
  { name: "SYNTHETIC ONLY " + runId + " A", bank_account: "9" + seed },
  { name: "SYNTHETIC ONLY " + runId + " B", bank_account: "9" + (seed + 1) },
];
const fixtureName = "synthetic-" + runId + ".pdf";
const storagePath = "qa/synthetic-" + runId + ".pdf";
const startedPeriods = [];
const issues = [];
let assertionsCompleted = false;
let server = null;
let adminCookie = null;
let storageUploaded = false;
const adminPassword = randomBytes(32).toString("base64url");

function requireData(result, label) {
  if (result.error) throw new Error(label + " failed (" + (result.error.code || "unknown") + ")");
  return result.data;
}

async function assertEntireSandboxEmpty() {
  // In particular, never attempt an all-history reorder or any Test
  // write on a project containing records from another run/operator.
  const [slips, histories] = await Promise.all([
    db.from("slips").select("id", { count: "exact", head: true }),
    db.from("upload_history").select("id", { count: "exact", head: true }),
  ]);
  if (slips.error || histories.error || slips.count !== 0 || histories.count !== 0) {
    throw new Error("Private Test project is not empty; no synthetic writes permitted");
  }
}

async function assertUnused(period) {
  const [slips, history] = await Promise.all([
    db.from("slips").select("id").eq("month", period.month).eq("year", period.year).limit(1),
    db.from("upload_history").select("id").eq("month", period.month).eq("year", period.year).limit(1),
  ]);
  if (requireData(slips, "sandbox-only preflight slips").length ||
      requireData(history, "sandbox-only preflight histories").length) {
    throw new Error("Selected synthetic period already has data; refusing to overwrite or delete it");
  }
}

async function makePdf(account) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1071, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SYNTHETIC INTEGRATION TEST ONLY - NOT SALARY DATA", {
    x: 45, y: 730, size: 17, font,
  });
  page.drawText("Fictional bank number: " + account, { x: 45, y: 690, size: 12, font });
  return Buffer.from(await doc.save());
}

async function call(path, { method = "POST", body, admin = false } = {}) {
  const response = await fetch(ORIGIN + path, {
    method, headers: {
      Origin: ORIGIN,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(admin && adminCookie ? { Cookie: adminCookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/pdf")
    ? Buffer.from(await response.arrayBuffer())
    : await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

async function startPrivateNext() {
  // Do not accidentally test an unrelated service already occupying this port.
  let occupied = false;
  try {
    await fetch(ORIGIN + "/api/auth", {
      signal: AbortSignal.timeout(1000), cache: "no-store",
    });
    occupied = true;
  } catch { /* nothing listening on this private test port */ }
  if (occupied) {
    throw new Error("Private sandbox port 3137 is occupied; refusing to use an existing server");
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/SUPABASE|^NEXT_PUBLIC_|^ADMIN_|^PAYROLL_|^STAFF_|^LINE_|^APP_ORIGIN$|^VERCEL/.test(key)));
  Object.assign(env, {
    NODE_ENV: "development",
    CI: "1",
    SUPABASE_URL: TEST_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: TEST_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-ui-key-with-no-database-access",
    STAFF_DIRECTORY_DISABLED: "true",
    STAFF_SHEET_ID: "",
    NEXT_PUBLIC_STAFF_SHEET_URL: "",
    ADMIN_PASSWORD: adminPassword,
    ADMIN_SESSION_SECRET: randomBytes(48).toString("base64url"),
    PAYROLL_RATE_LIMIT_SECRET: randomBytes(48).toString("base64url"),
    APP_ORIGIN: ORIGIN,
    LINE_CHANNEL_SECRET: "",
    LINE_CHANNEL_ACCESS_TOKEN: "",
  });
  const child = spawn(process.execPath, [
    "./node_modules/next/dist/bin/next", "dev", "-p", "3137", "-H", "127.0.0.1",
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  let recentLog = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => {
      recentLog = (recentLog + chunk.toString()).slice(-700);
    });
  }
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error("Private sandbox Next.js failed to start");
    try {
      const response = await fetch(ORIGIN + "/api/auth", {
        signal: AbortSignal.timeout(1200), cache: "no-store",
      });
      if (response.ok) return child;
    } catch { /* private server still starting */ }
    await sleep(500);
  }
  child.kill("SIGTERM");
  throw new Error("Private sandbox Next.js did not start; check local dependencies and port 3137");
}

async function ensureOwnRecords(period, accounts) {
  const [slips, history] = await Promise.all([
    db.from("slips").select("bank_account").eq("month",period.month).eq("year",period.year),
    db.from("upload_history").select("file_name").eq("month",period.month).eq("year",period.year),
  ]);
  const rows = requireData(slips, "cleanup ownership check");
  const entries = requireData(history, "cleanup history check");
  if (rows.some(r => !accounts.has(r.bank_account)) ||
      entries.some(h => h.file_name !== fixtureName)) {
    throw new Error("Unexpected data appeared in synthetic test period; no cleanup attempted");
  }
  return { rows, entries };
}

async function recoverPeriod(period) {
  const allowedAccounts = new Set(people.map(p => p.bank_account));
  const own = await ensureOwnRecords(period, allowedAccounts);
  if (!own.rows.length && !own.entries.length) return;
  if (!adminCookie) throw new Error("Admin session missing; cannot safely recover synthetic period");
  if (own.entries.length) {
    if (own.entries.length !== 1) throw new Error("Unexpected extra synthetic histories");
    const history = requireData(await db.from("upload_history")
      .select("id").eq("month", period.month).eq("year", period.year), "history ID");
    const id = history[0].id;
    const preview = await call("/api/admin/published-deletion", {
      admin: true, body: { id, ...period },
    });
    if (preview.status !== 200 || !preview.data.eligible) {
      throw new Error("Published synthetic data requires supervised cleanup");
    }
    const result = await call("/api/admin/published-deletion", {
      method: "DELETE", admin: true,
      body: { id, ...period, expectedCount: preview.data.slipCount,
        snapshot: preview.data.snapshot, backupConfirmed: true,
        confirmation: `ลบสลิปที่เผยแพร่ ${period.month} ${period.year}` },
    });
    assert.equal(result.status, 200, "sandbox-only published cleanup");
  } else if (own.rows.length) {
    const preview = await call("/api/admin/staged-recovery", {
      admin: true, body: period,
    });
    if (preview.status !== 200 || preview.data.published ||
        !preview.data.snapshot) throw new Error("Unpublished synthetic state changed");
    const result = await call("/api/admin/staged-recovery", {
      method: "DELETE", admin: true,
      body: { ...period, expectedCount: preview.data.stagedCount,
        snapshot: preview.data.snapshot,
        confirmation: `ลบสลิปค้าง ${period.month} ${period.year}` },
    });
    assert.equal(result.status, 200, "sandbox-only staged cleanup");
  }
  const after = await ensureOwnRecords(period, allowedAccounts);
  assert.equal(after.rows.length + after.entries.length, 0, "synthetic cleanup finished");
}

// A successful delete response alone does not prove that all isolated test
// records are gone. Check the database and the exact Storage object again.
async function verifyCleanup() {
  const allowedAccounts = new Set(people.map(p => p.bank_account));
  for (const period of startedPeriods) {
    const { rows, entries } = await ensureOwnRecords(period, allowedAccounts);
    assert.equal(rows.length + entries.length, 0, "synthetic SQL rows must be gone");
  }
  const listed = await db.storage.from("slips").list("qa", {
    search: "synthetic-" + runId + ".pdf", limit: 100,
  });
  if (listed.error) throw new Error("Cannot verify private Storage cleanup");
  assert.ok(!listed.data?.some(item => item.name === "synthetic-" + runId + ".pdf"),
    "synthetic Storage object must be gone");
}

try {
  // Require the entire Test project to be clean before any synthetic write.
  await assertEntireSandboxEmpty();
  // Inspect both target periods before allowing any write to the sandbox.
  await assertUnused(staged);
  await assertUnused(published);
  if (anonymous) {
    const s = await anonymous.from("slips").select("pdf_base64").limit(1);
    assert.equal(s.error?.code, "42501",
      "Public Supabase read must be rejected for lack of permission, not an invalid API key");
  } else {
    console.log("SKIP: anonymous RLS and private Storage checks (TEST_SUPABASE_PUBLISHABLE_KEY not set).");
  }

  server = await startPrivateNext();
  const unauthorized = await call("/api/admin/preflight", {
    body: staged,
  });
  assert.equal(unauthorized.status, 401);

  const authResponse = await fetch(ORIGIN + "/api/auth", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(authResponse.status, 200, "sandbox-only admin auth");
  adminCookie = authResponse.headers.get("set-cookie")?.split(";")[0] || null;
  assert.ok(adminCookie?.startsWith("payroll_admin_session="), "signed Admin cookie");

  for (const period of [staged, published]) {
    const preflight = await call("/api/admin/preflight", { admin:true,body:period });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.data.clear, true);
    startedPeriods.push(period);
  }

  const [aPdf, bPdf] = await Promise.all(people.map(p => makePdf(p.bank_account)));
  const rows = people.map((p,i) => ({
    ...p, ...staged, pdf_base64: [aPdf,bPdf][i].toString("base64"),
  }));

  const stagedResult = await call("/api/admin/slips", {
    admin:true, body: { rows: rows.slice(0, 1) },
  });
  assert.equal(stagedResult.status, 200, "RPC staging through Next.js");
  assert.equal(stagedResult.data.inserted, 1);
  const unpublished = await call("/api/payroll/search", {
    body: { bankAccount: people[0].bank_account },
  });
  assert.equal(unpublished.status, 200);
  assert.equal(unpublished.data.results.length, 0, "unpublished PDF remains hidden");
  const prematurePdf = await call("/api/payroll/pdf", {
    body: { bankAccount: people[0].bank_account, ...staged },
  });
  assert.equal(prematurePdf.status, 404);
  // A real Next.js -> Supabase Test call must block a premature LINE
  // announcement; this never contacts LINE or any production resource.
  const prematureLine = await call("/api/send-line", {
    admin: true, body: staged,
  });
  assert.equal(prematureLine.status, 409, "unpublished period cannot be announced");

  const snapshot = await call("/api/admin/staged-recovery", {
    admin:true, body:staged,
  });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.data.stagedCount, 1);
  const clearStaged = await call("/api/admin/staged-recovery", {
    method:"DELETE", admin:true,
    body: { ...staged, expectedCount: 1, snapshot: snapshot.data.snapshot,
      confirmation: `ลบสลิปค้าง ${staged.month} ${staged.year}` },
  });
  assert.equal(clearStaged.status, 200, "staged recovery through real RPC");

  const pubRows = rows.map(row => ({ ...row, ...published }));
  const saved = await call("/api/admin/slips", {
    admin:true, body:{ rows: pubRows },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.inserted, 2);
  const duplicate = await call("/api/admin/slips", {
    admin:true, body:{ rows: pubRows.slice(0,1) },
  });
  assert.equal(duplicate.status, 409, "duplicate owner/period refused");

  const wrong = await call("/api/admin/finalize", {
    admin:true, body: { ...published, fileName: fixtureName, expectedCount: 3 },
  });
  assert.equal(wrong.status, 409, "count mismatch cannot publish");
  const publish = await call("/api/admin/finalize", {
    admin:true, body: { ...published, fileName: fixtureName, expectedCount: 2 },
  });
  assert.equal(publish.status, 200, "atomic publication through real RPC");
  // The sandbox intentionally has no LINE credentials. Confirm the route
  // reaches the post-publication gate but fails safely before any network call.
  const publishedLine = await call("/api/send-line", {
    admin: true, body: published,
  });
  assert.equal(publishedLine.status, 500, "sandbox LINE delivery is disabled");
  const periodList = await call("/api/payroll/periods", { method: "GET" });
  assert.equal(periodList.status, 200);
  assert.ok(periodList.data.periods.some(x => x.month === published.month &&
    x.year === published.year), "published period appears in staff month selector");

  for (const [i,p] of people.entries()) {
    const found = await call("/api/payroll/search", {
      body: { bankAccount: p.bank_account },
    });
    assert.equal(found.status, 200);
    assert.ok(found.data.results.some(r => r.month === published.month &&
      r.year === published.year), "published period searchable");
    const file = await call("/api/payroll/pdf", {
      body: { bankAccount: p.bank_account, ...published },
    });
    assert.equal(file.status, 200);
    assert.ok(Buffer.isBuffer(file.data));
    const result = await PDFDocument.load(file.data);
    assert.equal(result.getPageCount(),1);
    assert.equal(Buffer.compare(file.data, [aPdf,bPdf][i]),0, "owner-scoped exact bytes");
  }

  const unknownAccount = "8" + String(seed).padStart(9, "0");
  const outsider = await call("/api/payroll/pdf", {
    body: { bankAccount: unknownAccount, ...published },
  });
  assert.equal(outsider.status, 404, "different account cannot retrieve these synthetic payslips");

  // The Storage bucket remains private; this is a separate synthetic object.
  const storage = await db.storage.from("slips").upload(storagePath,aPdf, {
    contentType:"application/pdf",upsert:false,
  });
  if (storage.error) throw new Error("Sandbox private Storage failed: " + storage.error.message);
  storageUploaded = true;
  if (anonymous) {
    const denied = await anonymous.storage.from("slips").download(storagePath);
    assert.ok(denied.error, "Public cannot download a private synthetic PDF");
  }

  const history = requireData(await db.from("upload_history").select("id")
    .eq("month",published.month).eq("year",published.year), "published history");
  assert.equal(history.length,1);
  // Check the actual Next.js history GET/PATCH -> Test RPC path. Refuse to
  // reorder anyone else's data; this requires an otherwise-empty Test project.
  const beforeReorder = await call("/api/admin/history", {
    method:"GET", admin:true,
  });
  assert.equal(beforeReorder.status, 200, "private history GET");
  assert.equal(beforeReorder.data?.history?.length, 1,
    "Test history must contain only this synthetic publication");
  assert.equal(beforeReorder.data.history[0].id, history[0].id);
  const originalCreatedAt = beforeReorder.data.history[0].created_at;
  const reordered = await call("/api/admin/history", {
    method:"PATCH", admin:true, body:{ ids:[history[0].id] },
  });
  assert.equal(reordered.status, 200, "atomic private history reorder RPC");
  assert.equal(reordered.data?.success, true);
  const afterReorder = await call("/api/admin/history", {
    method:"GET", admin:true,
  });
  assert.equal(afterReorder.status, 200);
  assert.equal(afterReorder.data?.history?.length, 1);
  assert.equal(afterReorder.data.history[0].id, history[0].id);
  assert.equal(afterReorder.data.history[0].created_at, originalCreatedAt,
    "history display order must not rewrite publication audit time");
  const preview = await call("/api/admin/published-deletion", {
    admin:true,body:{ id:history[0].id,...published },
  });
  assert.equal(preview.status,200);
  assert.equal(preview.data.eligible,true);

  const missingBackup = await call("/api/admin/published-deletion", {
    method:"DELETE", admin:true,
    body: { id:history[0].id,...published,expectedCount:2,
      snapshot:preview.data.snapshot, backupConfirmed:false,
      confirmation: `ลบสลิปที่เผยแพร่ ${published.month} ${published.year}` },
  });
  assert.equal(missingBackup.status,400);
  // Do not report PASS until the finally block has verified cleanup.
  assertionsCompleted = true;
} finally {
  for (const period of startedPeriods.reverse()) {
    try { await recoverPeriod(period); }
    catch (error) { issues.push("Cleanup requires manual sandbox review: " + String(error)); }
  }
  if (storageUploaded) {
    const deleted = await db.storage.from("slips").remove([storagePath]);
    if (deleted.error) issues.push("Synthetic Storage cleanup requires manual review");
  }
  try { await verifyCleanup(); }
  catch (error) { issues.push("Post-cleanup verification requires manual sandbox review: " + String(error)); }
  if (server) {
    server.kill("SIGTERM");
    await sleep(500);
  }
  if (issues.length) {
    throw new Error("Sandbox-only cleanup incomplete. " + issues.join("; "));
  }
}

if (assertionsCompleted) {
  console.log("PASS: real Next.js APIs + isolated Supabase (synthetic stage, recovery, publish, owner-scoped PDF, backup gate) AND cleanup.");
}
