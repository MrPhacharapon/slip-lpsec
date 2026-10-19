import { createSign } from "node:crypto";

/** Signed Google OAuth assertion for a read-only Sheets service account.
 * Private key and token remain server-only and must never enter logs. */
export function signGoogleSheetsAssertion(
  email: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email) ||
      !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
      !Number.isSafeInteger(nowSeconds) || nowSeconds < 1) {
    throw new Error("Google Sheets service account is not configured");
  }
  const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const head = encode({ alg: "RS256", typ: "JWT" });
  const claims = encode({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const message = head + "." + claims;
  const signature = createSign("RSA-SHA256").update(message)
    .sign(privateKey.replace(/\\n/g, "\n"), "base64url");
  return message + "." + signature;
}
