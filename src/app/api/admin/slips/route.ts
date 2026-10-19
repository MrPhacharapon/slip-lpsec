import { NextRequest } from "next/server";
import { readBoundedText, RequestPayloadTooLarge } from "@/lib/server/bounded-json";
import { payrollDb } from "@/lib/server/payroll-db";
import { validateStoredSlipPdf } from "@/lib/server/slip-pdf-validation";
import { reply, requireAdmin, validAccount, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  let rows: unknown;
  try {
    // Bound received BYTES before decoding and parsing. A dishonest or
    // absent Content-Length must not bypass the 1.9 MB upload batch limit.
    const raw = await readBoundedText(req, 1_900_000);
    rows = (JSON.parse(raw) as { rows?: unknown } | null)?.rows;
  } catch (error) {
    return reply({ error: error instanceof RequestPayloadTooLarge ?
      "ชุดอัปโหลดใหญ่เกินกำหนด" : "ข้อมูลอัปโหลดไม่ถูกต้อง" },
      error instanceof RequestPayloadTooLarge ? 413 : 400);
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 8)
    return reply({ error: "จำนวนสลิปไม่ถูกต้อง" }, 400);
  try {
    const first = rows[0];
    if (!validPeriod(first.month, first.year)) return reply({ error: "เดือนไม่ถูกต้อง" }, 400);
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.month !== first.month || row.year !== first.year ||
        typeof row.name !== "string" || !row.name.trim() || row.name.length > 200 ||
        !validAccount(row.bank_account) || seen.has(row.bank_account) ||
        !(await validateStoredSlipPdf(row.pdf_base64)).valid) {
        return reply({ error: "ข้อมูลสลิปไม่ถูกต้องหรือซ้ำ หรือ PDF ไม่ใช่สลิปหน้าเดียว", }, 400);
      }
      seen.add(row.bank_account);
    }
    const { data, error } = await payrollDb().rpc("stage_payroll_slips", {
      p_month: first.month,
      p_year: first.year,
      p_rows: rows.map(row => ({
        name: row.name, bank_account: row.bank_account, month: row.month,
        year: row.year, pdf_base64: row.pdf_base64,
      })),
    });
    if (error?.code === "23505") return reply({ error: "เดือนนี้เผยแพร่แล้วหรือมีสลิปซ้ำ ห้ามอัปโหลดทับ" }, 409);
    if (error?.code === "22023") return reply({ error: "ข้อมูลอัปโหลดไม่ถูกต้อง" }, 400);
    if (error || typeof data !== "number" || data !== rows.length) {
      return reply({ error: "ไม่สามารถยืนยันการบันทึกสลิปได้ กรุณาตรวจสถานะก่อนอัปโหลดซ้ำ" }, 503);
    }
    return reply({ success: true, inserted: data });
  } catch { return reply({ error: "ไม่สามารถบันทึกชุดสลิปได้" }, 503); }
}
