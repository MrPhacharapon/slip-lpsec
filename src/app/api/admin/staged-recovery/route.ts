import { readSmallAdminBody } from "@/lib/server/small-admin-body";
import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";

export const dynamic = "force-dynamic";

type Snapshot = { published: boolean; stagedCount: number; snapshot: string | null };

export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  const input = await readSmallAdminBody<{ month: string; year: string }>(req, 4096);
  if (!input.ok) return input.response;
  try {
    const { month, year } = input.body;
    if (!validPeriod(month, year)) return reply({ error: "เดือนหรือปีไม่ถูกต้อง" }, 400);
    const { data, error } = await payrollDb().rpc("inspect_unpublished_payroll_period", {
      p_month: month, p_year: year,
    });
    if (error || !data || typeof data.stagedCount !== "number" ||
        typeof data.published !== "boolean") {
      return reply({ error: "ตรวจสอบสลิปค้างไม่สำเร็จ กรุณาลองใหม่" }, 503);
    }
    const state = data as Snapshot;
    return reply({ month, year, published: state.published,
      stagedCount: state.stagedCount,
      snapshot: state.published ? null : state.snapshot });
  } catch {
    return reply({ error: "ตรวจสอบสลิปค้างไม่สำเร็จ" }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  const input = await readSmallAdminBody<{ month: string; year: string; expectedCount: number; snapshot: string; confirmation: string }>(req, 4096);
  if (!input.ok) return input.response;
  try {
    const { month, year, expectedCount, snapshot, confirmation } = input.body;
    if (!validPeriod(month, year) ||
      !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 500 ||
      typeof snapshot !== "string" || !/^[a-f0-9]{64}$/.test(snapshot) ||
      confirmation !== `ลบสลิปค้าง ${month} ${year}`) {
      return reply({ error: "ข้อมูลยืนยันไม่ครบหรือไม่ถูกต้อง" }, 400);
    }
    // SECURITY INVOKER RPC: publication and exact staged snapshot are
    // checked under the same advisory lock used by staging and publishing.
    // Only unpublished slips are ever eligible for this operation.
    const { data, error } = await payrollDb().rpc("discard_unpublished_payroll_period", {
      p_month: month, p_year: year,
      p_expected_count: expectedCount, p_expected_snapshot: snapshot,
    });
    if (error?.code === "23505") return reply({ error: "เดือนนี้เผยแพร่แล้ว ห้ามลบด้วยการกู้คืน" }, 409);
    if (error?.code === "40001") return reply({ error: "ข้อมูลเปลี่ยนระหว่างตรวจสอบ โปรดตรวจสอบรายการใหม่" }, 409);
    if (error?.code === "22023") return reply({ error: "ข้อมูลยืนยันไม่ถูกต้อง" }, 400);
    if (error || data !== expectedCount) {
      return reply({ error: "ไม่สามารถยืนยันการล้างข้อมูลค้างได้ โปรดตรวจสอบสถานะใหม่" }, 503);
    }
    return reply({ success: true, deleted: data });
  } catch {
    return reply({ error: "การกู้คืนไม่สำเร็จ โปรดตรวจสอบสถานะ" }, 503);
  }
}
