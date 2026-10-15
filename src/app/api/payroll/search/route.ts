import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireSameOrigin, validAccount } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rejected = requireSameOrigin(req);
  if (rejected) return rejected;
  try {
    const input = await req.json();
    if (!validAccount(input?.bankAccount)) return reply({ error: "เลขบัญชีไม่ถูกต้อง" }, 400);
    const db = payrollDb();
    const [slips, history] = await Promise.all([
      db.from("slips").select("month,year,name").eq("bank_account", input.bankAccount).limit(120),
      db.from("upload_history").select("month,year").limit(120),
    ]);
    if (slips.error || history.error) throw new Error("query failed");
    const published = new Set((history.data ?? []).map(x => x.year + ":" + x.month));
    const matches = (slips.data ?? []).filter(x => published.has(x.year + ":" + x.month));
    // Return metadata only; PDFs are fetched one at a time on deliberate click.
    return reply({ results: matches, employee: matches.length ?
      { name: matches[0].name, position: "" } : null });
  } catch {
    return reply({ error: "ค้นหาสลิปไม่สำเร็จ" }, 503);
  }
}
