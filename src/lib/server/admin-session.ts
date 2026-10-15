import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "payroll_admin_session";
const MAX_AGE_SECONDS = 4 * 60 * 60;

function sessionKey(): string {
  const key = process.env.ADMIN_SESSION_SECRET;
  if (!key || key.length < 32) throw new Error("ADMIN_SESSION_SECRET is not configured securely");
  return key;
}

function compareSecrets(received: string, expected: string): boolean {
  const left = createHmac("sha256", "payroll-admin-password-comparison").update(received).digest();
  const right = createHmac("sha256", "payroll-admin-password-comparison").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function verifyAdminPassword(password: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 12) throw new Error("ADMIN_PASSWORD is not configured securely");
  if (typeof password !== "string" || password.length > 512) return false;
  return compareSecrets(password, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

export function createAdminSession(now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ role: "admin", exp: Math.floor(now / 1000) + MAX_AGE_SECONDS })).toString("base64url");
  return payload + "." + sign(payload);
}

export function verifyAdminSession(cookie: string | undefined, now = Date.now()): boolean {
  if (!cookie || cookie.length > 2048) return false;
  const [payload, signature, extra] = cookie.split(".");
  if (!payload || !signature || extra) return false;
  const actual = Buffer.from(signature, "base64url");
  const expected = Buffer.from(sign(payload), "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return false;
    const value = parsed as { role?: unknown; exp?: unknown };
    return value.role === "admin" && typeof value.exp === "number" &&
      Number.isInteger(value.exp) && value.exp > Math.floor(now / 1000) &&
      value.exp <= Math.floor(now / 1000) + MAX_AGE_SECONDS;
  } catch {
    return false;
  }
}

export const adminCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const, path: "/", maxAge: MAX_AGE_SECONDS,
};

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Browsers always send Origin on these JSON-changing requests.
  // Verify against an explicitly trusted origin (do not trust Host headers).
  const expected = process.env.APP_ORIGIN;
  if (!origin || !expected) return false;
  try { return new URL(origin).origin === new URL(expected).origin; }
  catch { return false; }
}
