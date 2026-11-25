import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startMockSupabase } from "./mock-supabase-server.mjs";

test("Rate limiter enforces 5 requests / 180s on production admin login and keeps search/pdf 600s", () => {
  const code = readFileSync("src/lib/server/payroll-rate-limit.ts", "utf8");

  // Production shortPin quota: 5 per IP, 20 global cap, 180 seconds window
  assert.match(code, /const\s+shortPin\s*=\s*scope\s*===\s*"admin_login"\s*&&\s*process\.env\.PAYROLL_RELEASE_TARGET\s*===\s*"production"/);
  assert.match(code, /const\s+windowSeconds\s*=\s*shortPin\s*\?\s*180\s*:\s*WINDOW_SECONDS/);
  assert.match(code, /const\s+limits\s*=\s*shortPin\s*\?\s*\{\s*perIp:\s*5\s*\}\s*:\s*POLICY\[scope\]/);
  assert.match(code, /max:\s*20/);

  // Search & PDF scopes remain 600 seconds, perIp: 80, perAccount: 20
  assert.match(code, /search:\s*\{\s*perIp:\s*80,\s*perAccount:\s*20\s*\}/);
  assert.match(code, /pdf:\s*\{\s*perIp:\s*80,\s*perAccount:\s*20\s*\}/);

  // RPC parameters and Retry-After header
  assert.match(code, /p_window_seconds:\s*windowSeconds/);
  assert.match(code, /response\.headers\.set\("Retry-After",\s*String\(windowSeconds\)\)/);
});

test("Mock Supabase check_payroll_rate_limit enforces 5 requests per 180s window", async () => {
  const server = await startMockSupabase();
  try {
    const keyHash = "a".repeat(64);
    const endpoint = "http://127.0.0.1:3200/rest/v1/rpc/check_payroll_rate_limit";

    // 5 requests allowed
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_key_hash: keyHash,
          p_window_seconds: 180,
          p_max_requests: 5,
        }),
      });
      assert.equal(res.status, 200);
      assert.equal(await res.json(), true, `request ${i} should be allowed`);
    }

    // 6th request rejected (429 condition)
    const excess = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_key_hash: keyHash,
        p_window_seconds: 180,
        p_max_requests: 5,
      }),
    });
    assert.equal(excess.status, 200);
    assert.equal(await excess.json(), false, "6th request within 180s must be denied");
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    );
  }
});

test("Admin page hides 'ตั้งค่าฐานข้อมูล' by default and requires ?dev=csv", () => {
  const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");

  // Uses searchParams to check dev=csv
  assert.match(adminPage, /useSearchParams/);
  assert.match(adminPage, /searchParams\?\.get\("dev"\)\s*===\s*"csv"/);

  // The database settings card is conditionally rendered
  assert.match(adminPage, /\{showDevCsv\s*&&\s*\(/);
  assert.match(adminPage, /ตั้งค่าฐานข้อมูล/);
  assert.match(adminPage, /aria-label="ไฟล์ CSV ทะเบียนบุคลากร \(ไม่บังคับ\)"/);

  // Page wraps content in Suspense for useSearchParams compatibility
  assert.match(adminPage, /<Suspense\s+fallback=\{null\}>/);

  // When rosterCsvFile is not provided, automatically calls /api/admin/roster
  assert.match(adminPage, /fetch\("\/api\/admin\/roster"/);
});
