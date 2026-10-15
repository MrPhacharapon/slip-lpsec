import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { validateStoredSlipPdf } from "@/lib/server/slip-pdf-validation";
import { reply, requireAdmin, validAccount, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  try {
    const raw = await req.text();
    if (raw.length > 1_900_000) return reply({ error: "ชุดอัปโหลดใหญ่เกินกำหนด" }, 413);
    const { rows } = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length || rows.length > 8)
      return reply({ error: "จำนวนสลิปไม่ถูกต้อง" }, 400);
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
    const db = payrollDb();
    const { data: published, error: publishedError } = await db.from("upload_history")
      .select("id").eq("month", first.month).eq("year", first.year).limit(1);
    if (publishedError) throw publishedError;
    if (published?.length) return reply({ error: "เดือนนี้เผยแพร่แล้ว" }, 409);
    const inserted = await db.from("slips").insert(rows.map(row => ({
      name: row.name, bank_account: row.bank_account,
      month: row.month, year: row.year, pdf_base64: row.pdf_base64,
    })));
    if (inserted.error) throw inserted.error;
    return reply({ success: true, inserted: rows.length });
  } catch { return reply({ error: "ไม่สามารถบันทึกชุดสลิปได้" }, 503); }
}
