/**
 * Small server-only JSON parser with a byte limit enforced WHILE reading.
 * Neither a fake Content-Length nor chunked upload may bypass the cap.
 * The caller decides the endpoint's maximum and maps errors to HTTP codes.
 * Payload content is never added to errors or logs.
 */
export class RequestPayloadTooLarge extends Error {
  constructor() {
    super("Request JSON body exceeds the accepted byte limit");
    this.name = "RequestPayloadTooLarge";
  }
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new RangeError("Invalid server-side request size limit");

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null && /^\d+$/.test(lengthHeader) &&
      Number(lengthHeader) > maxBytes) {
    throw new RequestPayloadTooLarge();
  }
  if (!request.body) throw new SyntaxError("Missing request JSON");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestPayloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}

/** Keep JSON parsing AFTER strict streaming and UTF-8 validation. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBoundedText(request, maxBytes));
}
