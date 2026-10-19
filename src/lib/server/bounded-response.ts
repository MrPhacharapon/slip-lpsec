/**
 * A response's Content-Length can be missing or incorrect. Enforce a real
 * byte limit while streaming a third-party CSV, before UTF-8 decode/parse.
 * The error never embeds names, account numbers, CSV bytes or an upstream URL.
 */
export class ResponsePayloadTooLarge extends Error {
  constructor() {
    super("Upstream response exceeded byte limit");
    this.name = "ResponsePayloadTooLarge";
  }
}

export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Invalid response byte limit");
  }
  const claimed = response.headers.get("content-length");
  if (claimed !== null && /^\d+$/.test(claimed) && Number(claimed) > maxBytes) {
    await response.body?.cancel();
    throw new ResponsePayloadTooLarge();
  }
  if (!response.body) throw new TypeError("Missing upstream response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) throw new ResponsePayloadTooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(result);
}
