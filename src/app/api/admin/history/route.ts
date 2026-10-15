import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const rejected = requireAdmin(req);
  if (rejected) return rejected;
  try {
    const { data, error } = await payrollDb().from("upload_history").select("*")
      .order("created_at", { ascending: false }).limit(120);
    if (error) throw error;
    return reply({ history: data ?? [] });
  } catch { return reply({ error: "ไม่สามารถโหลดประวัติได้" }, 503); }
}
export async function PATCH(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 120 ||
        ids.some(x => typeof x !== "string" || x.length > 100) ||
        new Set(ids).size !== ids.length) return reply({ error: "ลำดับไม่ถูกต้อง" }, 400);
    const db = payrollDb();
    const { data, error } = await db.from("upload_history").select("id");
    if (error) throw error;
    if ((data ?? []).length !== ids.length ||
        data?.some(entry => !ids.includes(String(entry.id)))) return reply({ error: "รายการประวัติมีการเปลี่ยนแปลง กรุณาโหลดใหม่" }, 409);
    const now = Date.now();
    for (const [index, id] of ids.entries()) {
      const updated = await db.from("upload_history").update({
        created_at: new Date(now - index * 1000).toISOString(),
      }).eq("id", id);
      if (updated.error) throw updated.error;
    }
    return reply({ success: true });
  } catch { return reply({ error: "จัดเรียงไม่สำเร็จ กรุณาโหลดใหม่" }, 503); }
}
export async function DELETE(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  try {
    const { id, month, year } = await req.json();
    if (typeof id !== "string" || id.length > 100 || !validPeriod(month, year))
      return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const db = payrollDb();
    const existing = await db.from("upload_history").select("id,storage_path")
      .eq("id", id).eq("month", month).eq("year", year).limit(1);
    if (existing.error) throw existing.error;
    if (!existing.data?.length) return reply({ error: "ไม่พบประวัติ" }, 404);
    // First unpublish the period, so public retrieval stops before any deletion.
    const unpublished = await db.from("upload_history").delete().eq("id", id)
      .eq("month", month).eq("year", year);
    if (unpublished.error) throw unpublished.error;
    const slips = await db.from("slips").delete().eq("month", month).eq("year", year);
    if (slips.error) return reply({ error: "ปิดการเผยแพร่แล้ว แต่ลบสลิปไม่ครบ ต้องตรวจสอบด้วยผู้ดูแล" }, 503);
    const path = existing.data[0].storage_path;
    if (path) {
      const removed = await db.storage.from("slips").remove([path]);
      if (removed.error) return reply({ error: "ลบสลิปแล้ว แต่ลบไฟล์ต้นฉบับไม่สำเร็จ" }, 503);
    }
    return reply({ success: true });
  } catch { return reply({ error: "ลบข้อมูลไม่สำเร็จ" }, 503); }
}
