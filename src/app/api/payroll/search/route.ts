import { NextRequest } from "next/server";
import { readBoundedJson, RequestPayloadTooLarge } from "@/lib/server/bounded-json";
import { payrollDb } from "@/lib/server/payroll-db";
import { requirePayrollRateLimit } from "@/lib/server/payroll-rate-limit";
import { lookupStaffDirectory } from "@/lib/server/staff-directory";
import { reply, requireSameOrigin, validAccount } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rejected = requireSameOrigin(req);
  if (rejected) return rejected;
  let bankAccount: unknown;
  try {
    bankAccount = (await readBoundedJson(req, 1024) as { bankAccount?: unknown } | null)?.bankAccount;
  } catch (error) {
    return reply({ error: "ข้อมูลค้นหาไม่ถูกต้องหรือมีขนาดใหญ่เกินกำหนด" },
      error instanceof RequestPayloadTooLarge ? 413 : 400);
  }
  if (!validAccount(bankAccount)) return reply({ error: "เลขบัญชีไม่ถูกต้อง" }, 400);
  try {
    const limited = await requirePayrollRateLimit(req, "search", bankAccount);
    if (limited) return limited;
    const db = payrollDb();
    const [slips, history] = await Promise.all([
      db.from("slips").select("month,year,name").eq("bank_account", bankAccount).limit(120),
      db.from("upload_history").select("month,year").limit(120),
    ]);
    if (slips.error || history.error) throw new Error("query failed");
    const published = new Set((history.data ?? []).map(x => x.year + ":" + x.month));
    const matches = (slips.data ?? []).filter(x => published.has(x.year + ":" + x.month));
    // Return metadata only; PDFs are fetched one at a time on deliberate click.
    // Retrieve only the matching person's name/position from the roster.
    const employee = matches.length
      ? (await lookupStaffDirectory(bankAccount)) ?? { name: matches[0].name, position: "" }
      : null;
    return reply({ results: matches, employee });
  } catch {
    return reply({ error: "ค้นหาสลิปไม่สำเร็จ" }, 503);
  }
}
