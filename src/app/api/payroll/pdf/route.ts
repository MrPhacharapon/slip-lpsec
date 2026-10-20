import { NextRequest } from "next/server";
import { readBoundedJson, RequestPayloadTooLarge } from "@/lib/server/bounded-json";
import { payrollDb } from "@/lib/server/payroll-db";
import { requirePayrollRateLimit } from "@/lib/server/payroll-rate-limit";
import { noStoreHeaders, reply, requireSameOrigin, validAccount, validPeriod } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rejected = requireSameOrigin(req);
  if (rejected) return rejected;
  let input: { bankAccount?: string; month?: string; year?: string } | null;
  try {
    input = await readBoundedJson(req, 1024) as typeof input;
  } catch (error) {
    return reply({ error: "ข้อมูลค้นหาไม่ถูกต้องหรือมีขนาดใหญ่เกินกำหนด" },
      error instanceof RequestPayloadTooLarge ? 413 : 400);
  }
  const { bankAccount, month, year } = input ?? {};
  if (!validAccount(bankAccount) || !validPeriod(month, year))
    return reply({ error: "ข้อมูลค้นหาไม่ถูกต้อง" }, 400);
  try {
    const start = performance.now();
    const limited = await requirePayrollRateLimit(req, "pdf", bankAccount);
    const rateLimitMs = performance.now() - start;
    if (limited) return limited;
    const db = payrollDb();
    const historyStart = performance.now();
    const history = await db.from("upload_history").select("id")
      .eq("month", month).eq("year", year).limit(1);
    const historyMs = performance.now() - historyStart;
    if (history.error) throw history.error;
    if (!history.data?.length) return reply({ error: "ไม่พบเอกสาร" }, 404);
    const slipStart = performance.now();
    const { data, error } = await db.from("slips").select("pdf_base64")
      .eq("bank_account", bankAccount).eq("month", month).eq("year", year).limit(2);
    const slipMs = performance.now() - slipStart;
    if (error) throw error;
    if (data?.length !== 1) return reply({ error: "ไม่พบเอกสาร" }, 404);
    const decodeStart = performance.now();
    const pdf = Buffer.from(data[0].pdf_base64, "base64");
    if (pdf.length < 8 || pdf.length > 12_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-")
      return reply({ error: "ไฟล์สลิปไม่สมบูรณ์" }, 422);
    const decodeMs = performance.now() - decodeStart;
    // Timings only: no identifiers, balances, PDF contents or account information.
    const serverTiming = [
      `rate_limit;dur=${rateLimitMs.toFixed(1)}`,
      `history_lookup;dur=${historyMs.toFixed(1)}`,
      `slip_lookup;dur=${slipMs.toFixed(1)}`,
      `pdf_decode;dur=${decodeMs.toFixed(1)}`,
    ].join(", ");
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: { ...noStoreHeaders, "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"payroll-slip.pdf\"",
        "Server-Timing": serverTiming },
    });
  } catch {
    return reply({ error: "ไม่สามารถอ่านไฟล์สลิปได้" }, 503);
  }
}
