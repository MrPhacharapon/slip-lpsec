import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify LINE Messaging API's x-line-signature against the unmodified body.
 * The channel secret must be present server-side, never NEXT_PUBLIC_.
 */
export function verifyLineWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret = process.env.LINE_CHANNEL_SECRET,
): boolean {
  if (!secret || !signature || signature.length > 128 || rawBody.length > 1_000_000) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64"); }
  catch { return false; }
  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected) &&
    signature === expected.toString("base64");
}
