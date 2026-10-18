import type { NextResponse } from "next/server";
import { readBoundedJson, RequestPayloadTooLarge } from "./bounded-json";
import { reply } from "./route-guards";

export type SmallAdminBody<T> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse };

/**
 * Only call after the signed Admin session + same-origin check.
 * Read at most maxBytes, including chunked requests with missing or forged
 * Content-Length. Return non-sensitive HTTP errors; never print JSON content.
 */
export async function readSmallAdminBody<T extends object>(
  req: Request, maxBytes: number,
): Promise<SmallAdminBody<T>> {
  try {
    const value = await readBoundedJson(req, maxBytes);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, response: reply({ error: "รูปแบบคำขอไม่ถูกต้อง" }, 400) };
    }
    return { ok: true, body: value as T };
  } catch (error) {
    return { ok: false, response: reply({
      error: error instanceof RequestPayloadTooLarge ?
        "คำขอมีขนาดใหญ่เกินกำหนด" : "รูปแบบคำขอไม่ถูกต้อง",
    }, error instanceof RequestPayloadTooLarge ? 413 : 400) };
  }
}
