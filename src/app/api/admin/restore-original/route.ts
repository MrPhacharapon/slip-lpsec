import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";

export const dynamic = "force-dynamic";

// Attaches the combined original PDF to a published upload_history record whose
// storage_path is still null (either automatically after finalize or manually by
// an admin for an older period). Never overwrites an existing original file and
// never modifies individual published slips.
const MAX_PDF = 10 * 1024 * 1024;
const MAX_REQUEST = MAX_PDF + 1024 * 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  const length = Number(req.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_REQUEST)
    return reply({ error: "ขนาดคำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 413);
  try {
    const form = await req.formData();
    const id = form.get("historyId");
    const monthParam = form.get("month");
    const yearParam = form.get("year");
    const confirmation = form.get("confirmation");
    const file = form.get("file");

    const hasId = typeof id === "string" && UUID.test(id);
    const hasPeriod = validPeriod(monthParam, yearParam);
    if ((!hasId && !hasPeriod) ||
        typeof confirmation !== "string" || !(file instanceof File) ||
        file.type !== "application/pdf" || file.size < 100 || file.size > MAX_PDF ||
        !file.name.toLowerCase().endsWith(".pdf"))
      return reply({ error: "ไฟล์หรือคำยืนยันไม่ถูกต้อง" }, 400);

    const db = payrollDb();
    const historyQuery = hasId
      ? db.from("upload_history").select("id,month,year,storage_path").eq("id", id).limit(1)
      : db.from("upload_history").select("id,month,year,storage_path")
          .eq("month", monthParam as string).eq("year", yearParam as string).limit(2);
    const { data: histories, error: historyError } = await historyQuery;
    if (historyError) throw historyError;
    const history = histories?.length === 1 ? histories[0] : null;
    if (!history || !validPeriod(history.month, history.year) || history.storage_path !== null)
      return reply({ error: "ประวัติไม่ตรงหรือมีไฟล์ต้นฉบับอยู่แล้ว" }, 409);

    const { count, error: countError } = await db.from("slips")
      .select("id", { head: true, count: "exact" })
      .eq("month", history.month).eq("year", history.year);
    if (countError) throw countError;
    if (typeof count !== "number" || count < 1 || count > 500)
      return reply({ error: "ไม่พบสลิปที่เผยแพร่สำหรับเดือนนี้ กรุณาหยุดและตรวจสอบ" }, 409);

    const expectedConfirmation = `ยืนยันไฟล์ต้นฉบับ ${history.month} ${history.year}`;
    const legacyConfirmation = `${expectedConfirmation} ครบ ${count} คน`;
    if (confirmation !== expectedConfirmation && confirmation !== legacyConfirmation)
      return reply({ error: "ไฟล์หรือคำยืนยันไม่ถูกต้อง" }, 400);

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
    // Layout A = count single-slip pages; Layout B = ceil(count / 2) double-slip pages.
    if (pageCount < Math.ceil(count / 2) || pageCount > count)
      return reply({ error: `จำนวนหน้า PDF ไม่สอดคล้องกับสลิป ${count} รายการ` }, 400);

    // Random ASCII private object name prevents collisions, overwrites, or encoding issues.
    const path = "original/" + crypto.randomUUID() + ".pdf";
    const uploaded = await db.storage.from("slips").upload(path, bytes, {
      contentType: "application/pdf", upsert: false,
    });
    if (uploaded.error) return reply({ error: "จัดเก็บไฟล์ต้นฉบับไม่สำเร็จ" }, 503);
    const updated = await db.from("upload_history").update({ storage_path: path })
      .eq("id", history.id).eq("month", history.month).eq("year", history.year)
      .is("storage_path", null).select("id");
    if (updated.error || updated.data?.length !== 1) {
      await db.storage.from("slips").remove([path]).catch(() => {});
      return reply({ error: "ข้อมูลเปลี่ยนระหว่างดำเนินการ กรุณาตรวจสอบประวัติ ห้ามอัปโหลดซ้ำทันที" }, 409);
    }
    return reply({ success: true, storagePath: path });
  } catch {
    return reply({ error: "ไม่สามารถบันทึกไฟล์ต้นฉบับได้ กรุณาตรวจสอบสถานะก่อนลองใหม่" }, 503);
  }
}
