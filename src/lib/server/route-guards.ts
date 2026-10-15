import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, sameOrigin, verifyAdminSession } from "./admin-session";

export const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
export function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: noStoreHeaders });
}
export function requireAdmin(req: NextRequest, mutating = false): NextResponse | null {
  if (!verifyAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) return reply({ error: "ไม่ได้รับอนุญาต" }, 401);
  if (mutating && !sameOrigin(req)) return reply({ error: "คำขอไม่ถูกต้อง" }, 403);
  return null;
}
export function requireSameOrigin(req: NextRequest): NextResponse | null {
  return sameOrigin(req) ? null : reply({ error: "คำขอไม่ถูกต้อง" }, 403);
}
export const VALID_MONTHS = new Set([
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
]);
export function validPeriod(month: unknown, year: unknown): month is string {
  return typeof month === "string" && VALID_MONTHS.has(month) &&
    typeof year === "string" && /^25\d{2}$/.test(year);
}
export function validAccount(value: unknown): value is string {
  return typeof value === "string" && /^\d{10}$/.test(value);
}
