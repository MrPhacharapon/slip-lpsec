import { NextRequest } from "next/server";
import { parseRoster } from "@/lib/slip-validation";
import { ResponsePayloadTooLarge } from "@/lib/server/bounded-response";
import { loadPrivateStaffSheetRows } from "@/lib/server/google-sheet-source";
import { reply, requireAdmin } from "@/lib/server/route-guards";
import { serverSheetRosterEnabled } from "@/lib/server/roster-config";

export const dynamic = "force-dynamic";

/** Admin-only roster read; no client-provided Sheet ID or full CSV URLs. */
export async function GET(req: NextRequest) {
  const rejected = requireAdmin(req);
  if (rejected) return rejected;
  if (!serverSheetRosterEnabled()) {
    return reply({ error: "ทะเบียนบุคลากรไม่พร้อมใช้งาน" }, 503);
  }
  try {
    const roster = parseRoster(await loadPrivateStaffSheetRows());
    return reply({ roster });
  } catch (error) {
    if (error instanceof ResponsePayloadTooLarge) {
      return reply({ error: "ทะเบียนบุคลากรใหญ่เกินกำหนด" }, 413);
    }
    // Never send Google upstream errors, spreadsheet cells or keys to logs.
    return reply({ error: "อ่านทะเบียนบุคลากรไม่ได้ กรุณาตรวจสอบการตั้งค่า" }, 503);
  }
}
