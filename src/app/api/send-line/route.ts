import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, validPeriod } from "@/lib/server/route-guards";

export async function POST(req: NextRequest) {
  const rejected = requireAdmin(req, true);
  if (rejected) return rejected;
  try {
    const body = await req.json();
    const { month, year } = body;

    if (!validPeriod(month, year)) {
      return NextResponse.json({ error: 'Missing month or year' }, { status: 400 });
    }

    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const groupId = process.env.LINE_GROUP_ID;

    if (!channelAccessToken || !groupId) {
      console.error('Missing LINE credentials in Environment Variables');
      return NextResponse.json({ error: 'LINE credentials not configured' }, { status: 500 });
    }

    const messageText = `📢 แจ้งเตือน: ใบรับรองการจ่ายเงินเดือน ประจำเดือน ${month} พ.ศ. ${year} ได้อัปโหลดเข้าระบบเรียบร้อยแล้ว\n\nคุณครูสามารถเข้าไปตรวจสอบและดาวน์โหลดเอกสารได้ที่เว็บไซต์ระบบค้นหาใบรับรองการจ่ายเงินเดือน`;

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: 'text', text: messageText }]
      })
    });

    if (!response.ok) {
      // The provider's response body is untrusted. Do not log it: it can
      // contain private request or authorization details.
      console.error('LINE notification failed with HTTP status:', response.status);
      return NextResponse.json({ error: 'Failed to send LINE message' }, { status: response.status });
    }

    return NextResponse.json({ success: true });
  } catch {
    console.error('LINE notification request failed');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
