import { readSmallAdminBody } from "@/lib/server/small-admin-body";
import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  const input = await readSmallAdminBody<{ month: string; year: string; fileName: string; expectedCount: number }>(req, 2048);
  if (!input.ok) return input.response;
  try {
    const { month, year, fileName, expectedCount } = input.body;
    if (!validPeriod(month, year) ||
        typeof fileName !== "string" || !fileName.toLowerCase().endsWith(".pdf") ||
        fileName.length > 200 || !Number.isInteger(expectedCount) ||
        expectedCount < 1 || expectedCount > 500) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    // Count, ownership uniqueness and publication are checked inside one
    // database transaction. Staging requests for the same period use the same
    // transaction-scoped advisory lock; no publish/stage race is possible.
    const { data, error } = await payrollDb().rpc("publish_payroll_period", {
      p_month: month, p_year: year, p_file_name: fileName,
      p_expected_count: expectedCount,
    });
    if (error?.code === "23505") return reply({ error: "เดือนนี้เผยแพร่แล้ว ห้ามบันทึกซ้ำ" }, 409);
    if (error?.code === "22023") return reply({ error: "จำนวนสลิปยังไม่ครบหรือข้อมูลไม่ถูกต้อง ห้ามเผยแพร่" }, 409);
    if (error || data !== true) return reply({ error: "ไม่สามารถยืนยันการเผยแพร่ กรุณาตรวจสถานะก่อนดำเนินการต่อ" }, 503);
    return reply({ success: true });
  } catch { return reply({ error: "บันทึกประวัติไม่สำเร็จ ต้องตรวจสอบก่อนอัปโหลดซ้ำ" }, 503); }
}
