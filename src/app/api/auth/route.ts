import { NextRequest, NextResponse } from "next/server";
import { readBoundedJson, RequestPayloadTooLarge } from "@/lib/server/bounded-json";
import { ADMIN_COOKIE, adminCookieOptions, createAdminSession, sameOrigin, verifyAdminPassword, verifyAdminSession } from "@/lib/server/admin-session";
import { requirePayrollRateLimit } from "@/lib/server/payroll-rate-limit";
import { verifyPrivateAdminPin } from "@/lib/server/admin-pin-source";

export const dynamic = "force-dynamic";

function noStore(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  return noStore({ authenticated: verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value) });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return noStore({ success: false, error: "คำขอไม่ถูกต้อง" }, 403);
  const limited = await requirePayrollRateLimit(request, "admin_login");
  if (limited) return limited;
  let password: unknown;
  try {
    password = (await readBoundedJson(request, 2048) as { password?: unknown } | null)?.password;
  } catch (error) {
    return noStore({ success: false, error: "คำขอมีขนาดใหญ่เกินกำหนดหรือรูปแบบไม่ถูกต้อง" },
      error instanceof RequestPayloadTooLarge ? 413 : 400);
  }
  try {
    // Production uses the unchanged three-character PIN in the existing
    // Google Sheet's Settings tab. ADMIN_PASSWORD remains a TEST-only fixture.
    const valid = process.env.PAYROLL_RELEASE_TARGET === "production"
      ? await verifyPrivateAdminPin(password)
      : verifyAdminPassword(password);
    if (!valid) {
      return noStore({ success: false, error: "รหัสผ่านไม่ถูกต้อง" }, 401);
    }
    const result = noStore({ success: true });
    result.cookies.set(ADMIN_COOKIE, createAdminSession(), adminCookieOptions);
    return result;
  } catch {
    return noStore({ success: false, error: "ไม่สามารถตรวจสอบรหัสผ่านได้" }, 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return noStore({ success: false }, 403);
  const result = noStore({ success: true });
  result.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
  return result;
}
