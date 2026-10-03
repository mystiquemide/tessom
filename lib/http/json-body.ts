export const MAX_JSON_BODY_BYTES = 16 * 1024;

type JsonBodyErrorKind = "content-type" | "content-length" | "body" | "too-large" | "encoding" | "json";

export class JsonBodyError extends Error {
  readonly kind: JsonBodyErrorKind;

  constructor(kind: JsonBodyErrorKind) {
    super("Invalid JSON request body");
    this.name = "JsonBodyError";
    this.kind = kind;
  }
}

function hasJsonContentType(request: Request): boolean {
  const value = request.headers.get("content-type");
  if (value === null) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function validContentLength(request: Request, maxBytes: number): boolean {
  const value = request.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return value === null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length <= maxBytes;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The body may already be closed or errored. There is nothing else to do.
  }
}

/** Read and decode a bounded JSON request body without buffering the stream first. */
export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  if (!hasJsonContentType(request)) throw new JsonBodyError("content-type");
  if (!validContentLength(request, maxBytes)) throw new JsonBodyError("content-length");

  const body = request.body;
  if (!body) throw new JsonBodyError("body");

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", {fatal: true});
  let byteLength = 0;
  let text = "";

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        throw new JsonBodyError("body");
      }
      if (result.done) break;

      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) {
        await cancelReader(reader);
        throw new JsonBodyError("body");
      }
      if (chunk.byteLength > maxBytes - byteLength) {
        await cancelReader(reader);
        throw new JsonBodyError("too-large");
      }
      byteLength += chunk.byteLength;
      try {
        text += decoder.decode(chunk, {stream: true});
      } catch {
        await cancelReader(reader);
        throw new JsonBodyError("encoding");
      }
    }

    try {
      text += decoder.decode();
    } catch {
      throw new JsonBodyError("encoding");
    }
  } finally {
    reader.releaseLock();
  }

  if (byteLength === 0 || text.trim().length === 0) throw new JsonBodyError("json");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JsonBodyError("json");
  }
}
