import { NextResponse } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { noStoreHeaders } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { data, error } = await payrollDb().from("upload_history").select("month,year").limit(120);
    if (error) throw error;
    return NextResponse.json({ periods: data ?? [] }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ error: "โหลดช่วงเวลาไม่สำเร็จ" }, { status: 503, headers: noStoreHeaders });
  }
}
