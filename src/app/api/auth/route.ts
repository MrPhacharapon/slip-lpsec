import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieOptions, createAdminSession, sameOrigin, verifyAdminPassword, verifyAdminSession } from "@/lib/server/admin-session";

export const dynamic = "force-dynamic";

function noStore(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  return noStore({ authenticated: verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value) });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return noStore({ success: false, error: "คำขอไม่ถูกต้อง" }, 403);
  try {
    const body = await request.json();
    if (!verifyAdminPassword(body?.password)) {
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
