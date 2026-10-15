import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  try {
    const { month, year, fileName, expectedCount } = await req.json();
    if (!validPeriod(month, year) ||
        typeof fileName !== "string" || !fileName.toLowerCase().endsWith(".pdf") ||
        fileName.length > 200 || !Number.isInteger(expectedCount) ||
        expectedCount < 1 || expectedCount > 500) return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const db = payrollDb();
    const [existing, inserted] = await Promise.all([
      db.from("upload_history").select("id").eq("month", month).eq("year", year).limit(1),
      db.from("slips").select("bank_account").eq("month", month).eq("year", year).limit(501),
    ]);
    if (existing.error || inserted.error) throw new Error("finalize verification failed");
    if (existing.data?.length) return reply({ error: "มีประวัติอัปโหลดเดือนนี้แล้ว" }, 409);
    if (inserted.data?.length !== expectedCount ||
        new Set(inserted.data.map(x => x.bank_account)).size !== expectedCount)
      return reply({ error: "จำนวนสลิปไม่ครบหรือมีบัญชีซ้ำ ห้ามเผยแพร่" }, 409);
    const { error } = await db.from("upload_history").insert({
      month, year, file_name: fileName, storage_path: null,
    });
    if (error) throw error;
    return reply({ success: true });
  } catch { return reply({ error: "บันทึกประวัติไม่สำเร็จ ต้องตรวจสอบก่อนอัปโหลดซ้ำ" }, 503); }
}
