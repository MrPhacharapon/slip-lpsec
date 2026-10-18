/**
 * Parse commands out of ALL signed LINE webhook events.
 * The caller verifies the original raw webhook's HMAC before invoking this.
 * No message text, token, group ID or account data is logged.
 */
export type LineGroupReply = { groupId: string; replyToken: string };

export function collectLineGroupReplies(events: unknown): LineGroupReply[] {
  if (!Array.isArray(events)) return [];
  const commands: LineGroupReply[] = [];
  const handledTokens = new Set<string>();
  for (const value of events) {
    if (!value || typeof value !== "object") continue;
    const event = value as {
      type?: unknown;
      source?: { type?: unknown; groupId?: unknown } | null;
      replyToken?: unknown;
      message?: { type?: unknown; text?: unknown } | null;
    };
    if (event?.source?.type !== "group" ||
        typeof event.source.groupId !== "string" || !event.source.groupId ||
        typeof event.replyToken !== "string" || !event.replyToken ||
        handledTokens.has(event.replyToken)) continue;

    const requestedGroupId = event.type === "join" ||
      (event.type === "message" && event.message?.type === "text" &&
       typeof event.message.text === "string" &&
       event.message.text.includes("เช็คไอดีกลุ่ม"));
    if (!requestedGroupId) continue;
    handledTokens.add(event.replyToken);
    commands.push({ groupId: event.source.groupId, replyToken: event.replyToken });
  }
  return commands;
}
