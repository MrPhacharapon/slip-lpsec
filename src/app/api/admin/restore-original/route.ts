import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin } from "@/lib/server/route-guards";

export const dynamic = "force-dynamic";

// This endpoint restores ONLY the original-file pointer on the pre-existing
// October 2569 history record. It never uploads/replaces individual slips.
const MAX_PDF = 10 * 1024 * 1024;
const MAX_REQUEST = MAX_PDF + 1024 * 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OCTOBER = "ตุลาคม";
const YEAR = "2569";
const EXPECTED_SLIPS = 38;
const CONFIRMATION = "ยืนยันไฟล์ต้นฉบับ ตุลาคม 2569 ครบ 38 คน";

export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  const length = Number(req.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_REQUEST)
    return reply({ error: "ขนาดคำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 413);
  try {
    const form = await req.formData();
    const id = form.get("historyId");
    const confirmation = form.get("confirmation");
    const file = form.get("file");
    if (typeof id !== "string" || !UUID.test(id) ||
        confirmation !== CONFIRMATION || !(file instanceof File) ||
        file.type !== "application/pdf" || file.size < 100 || file.size > MAX_PDF ||
        !file.name.toLowerCase().endsWith(".pdf"))
      return reply({ error: "ไฟล์หรือคำยืนยันไม่ถูกต้อง" }, 400);

    const db = payrollDb();
    const { data: histories, error: historyError } = await db.from("upload_history")
      .select("id,month,year,storage_path").eq("id", id).limit(1);
    if (historyError) throw historyError;
    if (histories?.length !== 1 || histories[0].month !== OCTOBER ||
        histories[0].year !== YEAR || histories[0].storage_path !== null)
      return reply({ error: "ประวัติไม่ตรงหรือมีไฟล์ต้นฉบับอยู่แล้ว" }, 409);

    const { count, error: countError } = await db.from("slips")
      .select("id", { head: true, count: "exact" }).eq("month", OCTOBER).eq("year", YEAR);
    if (countError) throw countError;
    if (count !== EXPECTED_SLIPS)
      return reply({ error: "จำนวนสลิปที่เผยแพร่เปลี่ยนแปลง กรุณาหยุดและตรวจสอบ" }, 409);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 5));
    if (prefix !== "%PDF-") return reply({ error: "ไฟล์ไม่ใช่ PDF" }, 400);
    let pageCount: number;
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      pageCount = pdf.getPageCount();
    } catch {
      return reply({ error: "ไม่สามารถตรวจสอบโครงสร้าง PDF ได้" }, 400);
    }
    // A = 38 single-slip pages, B = 19 double-slip pages.
    // Page count alone is NOT an ownership/period verification.
    if (pageCount < Math.ceil(EXPECTED_SLIPS / 2) || pageCount > EXPECTED_SLIPS)
      return reply({ error: "จำนวนหน้า PDF ไม่สอดคล้องกับสลิป 38 รายการ" }, 400);

    // Admin must visually verify that this is the exact original document.
    // Random private object name prevents collisions or overwrites.
    const path = "restored-original/" + crypto.randomUUID() + ".pdf";
    const uploaded = await db.storage.from("slips").upload(path, bytes, {
      contentType: "application/pdf", upsert: false,
    });
    if (uploaded.error) return reply({ error: "จัดเก็บไฟล์ต้นฉบับไม่สำเร็จ" }, 503);
    const updated = await db.from("upload_history").update({ storage_path: path })
      .eq("id", id).eq("month", OCTOBER).eq("year", YEAR)
      .is("storage_path", null).select("id");
    if (updated.error || updated.data?.length !== 1) {
      await db.storage.from("slips").remove([path]).catch(() => {});
      return reply({ error: "ข้อมูลเปลี่ยนระหว่างดำเนินการ กรุณาตรวจสอบประวัติ ห้ามอัปโหลดซ้ำทันที" }, 409);
    }
    return reply({ success: true });
  } catch {
    return reply({ error: "ไม่สามารถกู้คืนไฟล์ต้นฉบับได้ กรุณาตรวจสอบสถานะก่อนลองใหม่" }, 503);
  }
}
