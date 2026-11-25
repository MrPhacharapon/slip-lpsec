import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { readBoundedJson, RequestPayloadTooLarge } from "@/lib/server/bounded-json";
import { payrollDb } from "@/lib/server/payroll-db";
import { reply, requireAdmin, validPeriod } from "@/lib/server/route-guards";

export const dynamic = "force-dynamic";

// Attaches the combined original PDF to a published upload_history record whose
// storage_path is still null. Supports direct signed-URL uploads up to 20 MB
// (bypassing Vercel's 4.5 MB serverless body limit) with server-side structural
// PDF & page-count verification before atomically updating upload_history.
// Never overwrites an existing original file and never modifies individual slips.
const MAX_PDF = 20 * 1024 * 1024;
const MAX_MULTIPART_REQUEST = 4 * 1024 * 1024 + 1024 * 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ORIGINAL_PATH =
  /^original\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

type HistoryRecord = {
  id: string;
  month: string;
  year: string;
  storage_path: string | null;
};

async function resolveNullStorageTarget(
  db: ReturnType<typeof payrollDb>,
  id: unknown,
  monthParam: unknown,
  yearParam: unknown,
  confirmation: unknown,
): Promise<
  | { ok: true; history: HistoryRecord; slipCount: number }
  | { ok: false; status: number; error: string }
> {
  const hasId = typeof id === "string" && UUID.test(id);
  const hasPeriod = validPeriod(monthParam, yearParam);
  if ((!hasId && !hasPeriod) || typeof confirmation !== "string") {
    return { ok: false, status: 400, error: "ไฟล์หรือคำยืนยันไม่ถูกต้อง" };
  }
  const historyQuery = hasId
    ? db.from("upload_history").select("id,month,year,storage_path").eq("id", id).limit(1)
    : db.from("upload_history").select("id,month,year,storage_path")
        .eq("month", monthParam as string).eq("year", yearParam as string).limit(2);
  const { data: histories, error: historyError } = await historyQuery;
  if (historyError) throw historyError;
  const history = histories?.length === 1 ? (histories[0] as HistoryRecord) : null;
  if (!history || !validPeriod(history.month, history.year) || history.storage_path !== null) {
    return { ok: false, status: 409, error: "ประวัติไม่ตรงหรือมีไฟล์ต้นฉบับอยู่แล้ว" };
  }
  if (hasPeriod && (history.month !== monthParam || history.year !== yearParam)) {
    return { ok: false, status: 409, error: "ประวัติไม่ตรงหรือมีไฟล์ต้นฉบับอยู่แล้ว" };
  }

  const { count, error: countError } = await db.from("slips")
    .select("id", { head: true, count: "exact" })
    .eq("month", history.month).eq("year", history.year);
  if (countError) throw countError;
  if (typeof count !== "number" || count < 1 || count > 500) {
    return { ok: false, status: 409, error: "ไม่พบสลิปที่เผยแพร่สำหรับเดือนนี้ กรุณาหยุดและตรวจสอบ" };
  }

  const expectedConfirmation = `ยืนยันไฟล์ต้นฉบับ ${history.month} ${history.year}`;
  const legacyConfirmation = `${expectedConfirmation} ครบ ${count} คน`;
  if (confirmation !== expectedConfirmation && confirmation !== legacyConfirmation) {
    return { ok: false, status: 400, error: "ไฟล์หรือคำยืนยันไม่ถูกต้อง" };
  }

  return { ok: true, history, slipCount: count };
}

async function verifyOriginalPdfBytes(
  bytes: Uint8Array,
  slipCount: number,
): Promise<string | null> {
  if (bytes.length < 100 || bytes.length > MAX_PDF) {
    return "ขนาดไฟล์ PDF ไม่ถูกต้องหรือใหญ่เกินกำหนด (ไม่เกิน 20 MB)";
  }
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 5));
  if (prefix !== "%PDF-") return "ไฟล์ไม่ใช่ PDF";
  let pageCount: number;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
    pageCount = pdf.getPageCount();
  } catch {
    return "ไม่สามารถตรวจสอบโครงสร้าง PDF ได้";
  }
  // Layout A = slipCount single-slip pages; Layout B = ceil(slipCount / 2) double-slip pages.
  if (pageCount < Math.ceil(slipCount / 2) || pageCount > slipCount) {
    return `จำนวนหน้า PDF ไม่สอดคล้องกับสลิป ${slipCount} รายการ`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: {
      historyId?: unknown;
      month?: unknown;
      year?: unknown;
      fileName?: unknown;
      fileSize?: unknown;
      confirmation?: unknown;
    } | null;
    try {
      const parsed = await readBoundedJson(req, 2048);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
      }
      body = parsed as typeof body;
    } catch (error) {
      return reply(
        { error: "ขนาดคำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" },
        error instanceof RequestPayloadTooLarge ? 413 : 400,
      );
    }

    const { historyId, month, year, fileName, fileSize, confirmation } = body ?? {};
    if (typeof fileName !== "string" || !fileName.toLowerCase().endsWith(".pdf") ||
        fileName.length > 200 || typeof fileSize !== "number" ||
        !Number.isInteger(fileSize) || fileSize < 100 || fileSize > MAX_PDF) {
      return reply({ error: "ไฟล์ไม่ถูกต้อง (รองรับเฉพาะ PDF ไม่เกิน 20 MB)" }, 400);
    }

    try {
      const db = payrollDb();
      const target = await resolveNullStorageTarget(db, historyId, month, year, confirmation);
      if (!target.ok) return reply({ error: target.error }, target.status);

      const path = "original/" + crypto.randomUUID() + ".pdf";
      const signed = await db.storage.from("slips").createSignedUploadUrl(path);
      if (signed.error || !signed.data?.signedUrl) {
        return reply({ error: "ไม่สามารถสร้างลิงก์อัปโหลดไฟล์ต้นฉบับได้" }, 503);
      }
      return reply({
        success: true,
        historyId: target.history.id,
        month: target.history.month,
        year: target.history.year,
        path,
        signedUrl: signed.data.signedUrl,
      });
    } catch {
      return reply({ error: "ไม่สามารถเตรียมการบันทึกไฟล์ต้นฉบับได้" }, 503);
    }
  }

  // Legacy direct multipart upload path for small PDFs (<= 4 MB).
  const length = Number(req.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_MULTIPART_REQUEST)
    return reply({ error: "ขนาดคำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 413);
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "application/pdf" ||
        file.size < 100 || file.size > MAX_PDF ||
        !file.name.toLowerCase().endsWith(".pdf")) {
      return reply({ error: "ไฟล์หรือคำยืนยันไม่ถูกต้อง" }, 400);
    }

    const db = payrollDb();
    const target = await resolveNullStorageTarget(
      db, form.get("historyId"), form.get("month"), form.get("year"), form.get("confirmation"),
    );
    if (!target.ok) return reply({ error: target.error }, target.status);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const invalid = await verifyOriginalPdfBytes(bytes, target.slipCount);
    if (invalid) return reply({ error: invalid }, 400);

    const path = "original/" + crypto.randomUUID() + ".pdf";
    const uploaded = await db.storage.from("slips").upload(path, bytes, {
      contentType: "application/pdf", upsert: false,
    });
    if (uploaded.error) return reply({ error: "จัดเก็บไฟล์ต้นฉบับไม่สำเร็จ" }, 503);
    const updated = await db.from("upload_history").update({ storage_path: path })
      .eq("id", target.history.id).eq("month", target.history.month).eq("year", target.history.year)
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

async function removeUnreferenced(
  db: ReturnType<typeof payrollDb>,
  path: string,
): Promise<void> {
  const referenced = await db.from("upload_history")
    .select("id").eq("storage_path", path).limit(1);
  if (!referenced.error && !referenced.data?.length) {
    await db.storage.from("slips").remove([path]).catch(() => {});
  }
}

export async function PATCH(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;

  let body: {
    historyId?: unknown;
    month?: unknown;
    year?: unknown;
    path?: unknown;
    confirmation?: unknown;
  } | null;
  try {
    const parsed = await readBoundedJson(req, 2048);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    }
    body = parsed as typeof body;
  } catch (error) {
    return reply(
      { error: "ขนาดคำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" },
      error instanceof RequestPayloadTooLarge ? 413 : 400,
    );
  }

  const { historyId, month, year, path, confirmation } = body ?? {};
  if (typeof path !== "string" || !SAFE_ORIGINAL_PATH.test(path)) {
    return reply({ error: "ตำแหน่งไฟล์ไม่ถูกต้อง" }, 400);
  }

  try {
    const db = payrollDb();
    const target = await resolveNullStorageTarget(db, historyId, month, year, confirmation);
    if (!target.ok) {
      await removeUnreferenced(db, path);
      return reply({ error: target.error }, target.status);
    }

    const downloaded = await db.storage.from("slips").download(path);
    if (downloaded.error || !downloaded.data) {
      return reply({ error: "ไม่พบไฟล์ที่อัปโหลดใน Storage" }, 404);
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const invalid = await verifyOriginalPdfBytes(bytes, target.slipCount);
    if (invalid) {
      await removeUnreferenced(db, path);
      return reply({ error: invalid }, 400);
    }

    const updated = await db.from("upload_history").update({ storage_path: path })
      .eq("id", target.history.id).eq("month", target.history.month).eq("year", target.history.year)
      .is("storage_path", null).select("id");
    if (updated.error || updated.data?.length !== 1) {
      await removeUnreferenced(db, path);
      return reply({ error: "ข้อมูลเปลี่ยนระหว่างดำเนินการ กรุณาตรวจสอบประวัติ ห้ามอัปโหลดซ้ำทันที" }, 409);
    }
    return reply({ success: true, storagePath: path });
  } catch {
    return reply({ error: "ไม่สามารถยืนยันไฟล์ต้นฉบับได้ กรุณาตรวจสอบสถานะก่อนลองใหม่" }, 503);
  }
}
