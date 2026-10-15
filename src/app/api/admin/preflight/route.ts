import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  try {
    const { month, year } = await req.json();
    if (!validPeriod(month, year)) return reply({ error: "เดือนหรือปีไม่ถูกต้อง" }, 400);
    const db = payrollDb();
    const [slips, history] = await Promise.all([
      db.from("slips").select("id").eq("month", month).eq("year", year).limit(501),
      db.from("upload_history").select("id").eq("month", month).eq("year", year).limit(1),
    ]);
    if (slips.error || history.error) throw new Error("preflight failed");
    const published = Boolean(history.data?.length);
    const stagedCount = slips.data?.length ?? 0;
    return reply({
      clear: !published && stagedCount === 0,
      published,
      stagedCount,
      truncated: stagedCount === 501,
    });
  } catch { return reply({ error: "ไม่สามารถตรวจสอบเดือนที่เลือกได้" }, 503); }
}
