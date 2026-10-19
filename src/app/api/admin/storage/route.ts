import { NextRequest } from "next/server";
import { payrollDb } from "@/lib/server/payroll-db";
import { noStoreHeaders, reply, requireAdmin } from "@/lib/server/route-guards";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const rejected = requireAdmin(req);
  if (rejected) return rejected;
  const path = req.nextUrl.searchParams.get("path");
  if (!path || path.length > 500 || path.includes("..") || path.startsWith("/"))
    return reply({ error: "ไม่พบไฟล์" }, 404);
  try {
    const db = payrollDb();
    const registered = await db.from("upload_history").select("id").eq("storage_path", path).limit(1);
    if (registered.error) throw registered.error;
    if (!registered.data?.length) return reply({ error: "ไม่พบไฟล์" }, 404);
    const downloaded = await db.storage.from("slips").download(path);
    if (downloaded.error || !downloaded.data) return reply({ error: "ไม่สามารถเปิดไฟล์ได้" }, 404);
    return new Response(downloaded.data.stream(), {
      headers: { ...noStoreHeaders, "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"original-payroll.pdf\"" },
    });
  } catch {
    return reply({ error: "ไม่สามารถเปิดไฟล์ได้" }, 503);
  }
}
