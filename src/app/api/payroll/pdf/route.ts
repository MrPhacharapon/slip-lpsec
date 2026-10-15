import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { noStoreHeaders, reply, requireSameOrigin, validAccount, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rejected = requireSameOrigin(req);
  if (rejected) return rejected;
  try {
    const { bankAccount, month, year } = await req.json();
    if (!validAccount(bankAccount) || !validPeriod(month, year))
      return reply({ error: "ข้อมูลค้นหาไม่ถูกต้อง" }, 400);
    const db = payrollDb();
    const history = await db.from("upload_history").select("id")
      .eq("month", month).eq("year", year).limit(1);
    if (history.error) throw history.error;
    if (!history.data?.length) return reply({ error: "ไม่พบเอกสาร" }, 404);
    const { data, error } = await db.from("slips").select("pdf_base64")
      .eq("bank_account", bankAccount).eq("month", month).eq("year", year).limit(2);
    if (error) throw error;
    if (data?.length !== 1) return reply({ error: "ไม่พบเอกสาร" }, 404);
    const pdf = Buffer.from(data[0].pdf_base64, "base64");
    if (pdf.length < 8 || pdf.length > 12_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-")
      return reply({ error: "ไฟล์สลิปไม่สมบูรณ์" }, 422);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: { ...noStoreHeaders, "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"payroll-slip.pdf\"" },
    });
  } catch {
    return reply({ error: "ไม่สามารถอ่านไฟล์สลิปได้" }, 503);
  }
}
