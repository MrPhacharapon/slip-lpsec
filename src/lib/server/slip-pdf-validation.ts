import { PDFDocument } from "pdf-lib";

export type StoredSlipPdfCheck =
  | { valid: true }
  | { valid: false; reason: "encoding" | "pdf" | "pages" | "geometry" };

const GEOMETRY_TOLERANCE = 3;
const approximately = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= GEOMETRY_TOLERANCE;

/**
 * Validate the one-person image PDF constructed by the admin uploader.
 * This is structural integrity checking, NOT proof of the owner's identity:
 * source text/name/account/position must still be matched at upload time.
 */
export async function validateStoredSlipPdf(base64: unknown): Promise<StoredSlipPdfCheck> {
  if (typeof base64 !== "string" || base64.length < 100 ||
      base64.length > 1_500_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    return { valid: false, reason: "encoding" };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64 ||
      bytes.length < 100 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return { valid: false, reason: "encoding" };
  }
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    if (document.getPageCount() !== 1) return { valid: false, reason: "pages" };
    const page = document.getPage(0);
    const height = page.getHeight();
    if (!approximately(page.getWidth(), 1071) ||
        !(approximately(height, 792) || approximately(height, 396)) ||
        page.getRotation().angle % 360 !== 0) {
      return { valid: false, reason: "geometry" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "pdf" };
  }
}
