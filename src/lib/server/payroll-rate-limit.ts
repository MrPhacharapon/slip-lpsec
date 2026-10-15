import { createHmac } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { payrollDb } from "./payroll-db";
import { reply } from "./route-guards";

// Fixed-window counters live in PostgreSQL, not process memory; requests to
// different serverless instances share the same atomic limit.
const WINDOW_SECONDS = 600;
type Scope = "search" | "pdf" | "admin_login";
const POLICY: Record<Scope, { perIp: number; perAccount?: number }> = {
  search: { perIp: 80, perAccount: 20 },
  pdf: { perIp: 80, perAccount: 20 },
  admin_login: { perIp: 40 },
};

function fingerprint(scope: Scope, kind: "ip" | "account", value: string): string {
  const secret = process.env.PAYROLL_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("PAYROLL_RATE_LIMIT_SECRET is not configured securely");
  }
  return createHmac("sha256", secret).update(scope + ":" + kind + ":" + value).digest("hex");
}

function requesterAddress(request: NextRequest): string {
  // Vercel overwrites X-Forwarded-For to prevent client-supplied IP spoofing.
  // Never trust a user-controlled X-Forwarded-For when running outside Vercel.
  if (process.env.VERCEL === "1") {
    const value = request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-forwarded-for");
    const first = value?.split(",")[0]?.trim();
    if (first && first.length <= 64 && /^[0-9a-fA-F:.]+$/.test(first)) return first;
  }
  // All unidentified clients share one strict bucket rather than bypassing it.
  return "unidentified-client";
}

/**
 * Fail closed on missing config/database failure; do not silently disable
 * throttling. This slows guessing, but does NOT authenticate account ownership.
 */
export async function requirePayrollRateLimit(
  request: NextRequest,
  scope: Scope,
  account?: string,
): Promise<NextResponse | null> {
  const limits = POLICY[scope];
  try {
    const counters = [
      { key: fingerprint(scope, "ip", requesterAddress(request)), max: limits.perIp },
    ];
    if (limits.perAccount && account) {
      counters.push({ key: fingerprint(scope, "account", account), max: limits.perAccount });
    }
    const db = payrollDb();
    // Both checks increment atomically in the database; a second failed check
    // still uses a request count. Nothing is fail-open.
    const result = await Promise.all(counters.map(({ key, max }) =>
      db.rpc("check_payroll_rate_limit", {
        p_key_hash: key, p_window_seconds: WINDOW_SECONDS, p_max_requests: max,
      })));
    if (result.some(x => x.error || typeof x.data !== "boolean")) {
      return reply({ error: "ไม่สามารถตรวจสอบขีดจำกัดคำขอได้ กรุณาลองใหม่ภายหลัง" }, 503);
    }
    if (result.some(x => x.data === false)) {
      const response = reply({ error: "มีการค้นหาหลายครั้งเกินกำหนด กรุณาลองใหม่ภายหลัง" }, 429);
      response.headers.set("Retry-After", String(WINDOW_SECONDS));
      return response;
    }
    return null;
  } catch {
    return reply({ error: "บริการตรวจสอบคำขอไม่พร้อมใช้งาน" }, 503);
  }
}
