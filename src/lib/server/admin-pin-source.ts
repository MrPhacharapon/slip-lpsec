import { createHmac, timingSafeEqual } from "node:crypto";
import { loadPrivateAdminPin } from "./google-sheet-source";

/** Three-character legacy admin PIN, read from the existing private Sheet.
 * Fail closed if the Google service account, tab, or rate-limit RPC is absent.
 * A short PIN remains weak even when guarded; never treat it as high assurance.
 */
export async function verifyPrivateAdminPin(value: unknown): Promise<boolean> {
  if (typeof value !== "string" || [...value].length !== 3 ||
      /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  const expected = await loadPrivateAdminPin();
  const toDigest = (input: string) =>
    createHmac("sha256", "payroll-legacy-admin-pin-comparison")
      .update(input).digest();
  return timingSafeEqual(toDigest(value), toDigest(expected));
}
