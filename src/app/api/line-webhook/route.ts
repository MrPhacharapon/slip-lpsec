import { NextResponse } from "next/server";
import { readBoundedText, RequestPayloadTooLarge } from "@/lib/server/bounded-json";
import { verifyLineWebhookSignature } from "@/lib/server/line-signature";
import { collectLineGroupReplies } from "@/lib/server/line-webhook-events";

export async function POST(req: Request) {
  if (process.env.PAYROLL_RELEASE_TARGET !== "production")
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
  try {
    // LINE signs the exact raw body, not parsed JSON. Never process an event
    // until its original webhook signature has been verified.
    let rawBody: string;
    try {
      // Enforce an actual BYTE limit before signature verification or JSON
      // parsing, including chunked requests and dishonest Content-Length.
      rawBody = await readBoundedText(req, 1_000_000);
    } catch (error) {
      if (error instanceof RequestPayloadTooLarge) {
        return NextResponse.json({ error: "Webhook body too large" }, { status: 413 });
      }
      return NextResponse.json({ error: "Invalid webhook body" }, { status: 400 });
    }
    if (!verifyLineWebhookSignature(rawBody, req.headers.get("x-line-signature"))) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
    let body: { events?: unknown } | null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid webhook body" }, { status: 400 });
    }
    if (!body || !Array.isArray(body.events)) {
      return NextResponse.json({ error: "Invalid webhook body" }, { status: 400 });
    }

    // A single signed webhook may contain several unrelated or group events;
    // processing only events[0] silently drops later group-ID requests.
    const commands = collectLineGroupReplies(body.events);
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (channelAccessToken && commands.length > 0) {
      let replyFailed = false;
      // Bound concurrent provider requests without silently dropping events.
      for (let i = 0; i < commands.length; i += 4) {
        const batch = commands.slice(i, i + 4);
        const results = await Promise.allSettled(batch.map(async command => {
          const replyText = `สวัสดีครับ! บอทสลิปเงินเดือนพร้อมใช้งานแล้ว\n\nรหัสกลุ่ม (Group ID) ของคุณคือ:\n${command.groupId}\n\nกรุณาคัดลอกรหัสนี้ไปใส่ใน Vercel Environment Variables ในชื่อ LINE_GROUP_ID ครับ`;
          const response = await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${channelAccessToken}`,
            },
            body: JSON.stringify({
              replyToken: command.replyToken,
              messages: [{ type: "text", text: replyText }],
            }),
            signal: AbortSignal.timeout(8000),
          });
          return response.ok;
        }));
        if (results.some(r => r.status === "rejected" || !r.value)) {
          replyFailed = true;
        }
      }
      // Always acknowledge a valid signed webhook. A 5xx after a partial
      // provider success can trigger LINE redelivery of the entire batch,
      // duplicating replies for tokens already attempted.
      if (replyFailed) console.error("LINE webhook reply failed");
    }
    return NextResponse.json({ status: "ok" });
  } catch {
    // Never log LINE event text, group IDs, reply tokens or provider bodies.
    console.error("LINE webhook processing failed");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
