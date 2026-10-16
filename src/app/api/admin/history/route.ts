import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const rejected = requireAdmin(req);
  if (rejected) return rejected;
  try {
    const { data, error } = await payrollDb().from("upload_history").select("*")
      // New history without a display_order appears first; preexisting rows
      // remain in chronological order until an Admin explicitly reorders them.
      .order("display_order", { ascending: true, nullsFirst: true })
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
    // One server-side PostgreSQL transaction performs the complete reorder.
    // Never rewrite created_at: it is the actual publication audit timestamp.
    const { data, error } = await payrollDb().rpc("reorder_payroll_history", {
      p_ids: ids,
    });
    if (error?.code === "40001") return reply({
      error: "รายการประวัติมีการเปลี่ยนแปลง กรุณาโหลดใหม่",
    }, 409);
    if (error?.code === "22023") return reply({ error: "ลำดับไม่ถูกต้อง" }, 400);
    if (error || data !== true) return reply({
      error: "ไม่สามารถยืนยันการจัดเรียงได้ กรุณาโหลดใหม่",
    }, 503);
    return reply({ success: true });
  } catch { return reply({ error: "จัดเรียงไม่สำเร็จ กรุณาโหลดใหม่" }, 503); }
}
// Published deletion is handled exclusively by the guarded snapshot RPC.
// Explicitly refuse the legacy multi-request deletion API.
export async function DELETE(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  return reply({ error: "โปรดใช้ขั้นตอนตรวจและยืนยันการลบที่ปลอดภัย" }, 405);
}
