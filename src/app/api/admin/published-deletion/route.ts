import { readSmallAdminBody } from "@/lib/server/small-admin-body";
import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  const input = await readSmallAdminBody<{ id: string; month: string; year: string }>(req, 4096);
  if (!input.ok) return input.response;
  try {
    const { id, month, year } = input.body;
    if (typeof id !== "string" || !UUID.test(id) || !validPeriod(month, year))
      return reply({ error: "ข้อมูลเดือนหรือรหัสประวัติไม่ถูกต้อง" }, 400);
    const { data, error } = await payrollDb().rpc("inspect_published_payroll_deletion", {
      p_id: id, p_month: month, p_year: year,
    });
    if (error?.code === "P0002") return reply({ error: "ไม่พบประวัติการเผยแพร่" }, 404);
    if (error || !data || typeof data.slipCount !== "number" ||
        typeof data.historyCount !== "number" || typeof data.eligible !== "boolean" ||
        typeof data.storageProtected !== "boolean" ||
        (data.eligible && (typeof data.snapshot !== "string" ||
         !/^[a-f0-9]{64}$/.test(data.snapshot)))) {
      return reply({ error: "ไม่สามารถตรวจสอบข้อมูลก่อนลบได้" }, 503);
    }
    // Expose only counts and eligibility, never account numbers or PDF data.
    return reply({
      id, month, year,
      slipCount: data.slipCount, historyCount: data.historyCount,
      storageProtected: data.storageProtected, eligible: data.eligible,
      snapshot: data.eligible ? data.snapshot : null,
    });
  } catch { return reply({ error: "ตรวจสอบข้อมูลก่อนลบไม่สำเร็จ" }, 503); }
}

export async function DELETE(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  const input = await readSmallAdminBody<{ id: string; month: string; year: string; expectedCount: number; snapshot: string; confirmation: string; backupConfirmed: boolean }>(req, 4096);
  if (!input.ok) return input.response;
  try {
    const { id, month, year, expectedCount, snapshot, confirmation, backupConfirmed } = input.body;
    if (typeof id !== "string" || !UUID.test(id) || !validPeriod(month, year) ||
        !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 500 ||
        typeof snapshot !== "string" || !/^[a-f0-9]{64}$/.test(snapshot) ||
        backupConfirmed !== true || confirmation !== `ลบสลิปที่เผยแพร่ ${month} ${year}`) {
      return reply({ error: "ข้อมูลยืนยันไม่ครบ ต้องตรวจและสำรองก่อนลบ" }, 400);
    }
    const { data, error } = await payrollDb().rpc("delete_published_payroll_period", {
      p_id: id, p_month: month, p_year: year,
      p_expected_count: expectedCount, p_expected_snapshot: snapshot,
    });
    if (error?.code === "40001") return reply({ error: "ข้อมูลเปลี่ยนหลังตรวจสอบ กรุณาเริ่มตรวจใหม่" }, 409);
    if (error?.code === "P0002") return reply({ error: "ไม่พบประวัติที่เลือก กรุณาโหลดใหม่" }, 404);
    if (error?.code === "22023") return reply({
      error: "ข้อมูลยืนยันไม่ถูกต้อง หรือพบไฟล์ต้นฉบับใน Storage ที่ต้องตรวจสอบแยก",
    }, 409);
    if (error || data !== expectedCount) return reply({
      error: "ไม่สามารถยืนยันผลการลบได้ กรุณาโหลดประวัติใหม่และติดต่อผู้ดูแล",
    }, 503);
    return reply({ success: true, deleted: data });
  } catch { return reply({ error: "ดำเนินการลบไม่สำเร็จ กรุณาตรวจสอบสถานะ" }, 503); }
}
