import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== "Bearer " + secret)
    return reply({ error: "ไม่ได้รับอนุญาต" }, 401);
  try {
    const result = await payrollDb().from("upload_history").select("id").limit(1);
    if (result.error) throw result.error;
    return reply({ success: true });
  } catch { return reply({ success: false }, 503); }
}
