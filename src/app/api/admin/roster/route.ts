import { NextRequest } from "next/server";
// @ts-expect-error - papaparse has no bundled declarations in this project
import Papa from "papaparse";
import { parseRoster } from "@/lib/slip-validation";
import { readBoundedResponseText, ResponsePayloadTooLarge } from "@/lib/server/bounded-response";
import { reply, requireAdmin } from "@/lib/server/route-guards";

export const dynamic = "force-dynamic";

/**
 * Admin-only staff roster read. Keep the Sheet ID and Google CSV endpoint
 * on the server, not in a public NEXT_PUBLIC_ variable or browser bundle.
 * This is not a proxy: it accepts no caller-supplied URL or spreadsheet ID.
 */
export async function GET(req: NextRequest) {
  const rejected = requireAdmin(req);
  if (rejected) return rejected;
  if (process.env.STAFF_DIRECTORY_DISABLED === "true" ||
      process.env.PAYROLL_ROSTER_MODE === "local_csv") {
    return reply({ error: "ทะเบียนบุคลากรไม่พร้อมใช้งาน" }, 503);
  }
  const sheetId = process.env.STAFF_SHEET_ID;
  if (!sheetId || !/^[A-Za-z0-9_-]{20,100}$/.test(sheetId)) {
    return reply({ error: "ยังไม่ได้ตั้งค่าทะเบียนบุคลากร" }, 503);
  }
  try {
    const url = "https://docs.google.com/spreadsheets/d/" + sheetId +
      "/export?format=csv&gid=0";
    const response = await fetch(url, {
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("sheet not readable");
    const raw = await readBoundedResponseText(response, 1_000_000);
    const roster = parseRoster(Papa.parse<string[]>(
      raw.replace(/^\uFEFF/, ""), { skipEmptyLines: true },
    ).data);
    return reply({ roster });
  } catch (error) {
    if (error instanceof ResponsePayloadTooLarge) {
      return reply({ error: "ทะเบียนบุคลากรใหญ่เกินกำหนด" }, 413);
    }
    // Neither the upstream error nor the roster content may enter logs.
    return reply({ error: "อ่านทะเบียนบุคลากรไม่ได้ กรุณาตรวจสอบการตั้งค่า" }, 503);
  }
}
