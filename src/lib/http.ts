import { clientIp, limiter } from "./rate-limit";
import { record, stringify } from "./policy";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const MAX_INPUT_BYTES = 2048;
export function json(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Send application/json.");
  if (Number(request.headers.get("content-length")) > MAX_INPUT_BYTES)
    throw new HttpError(413, "Keep the whole request under 2 KB.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Send a JSON object.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_INPUT_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "Keep the whole request under 2 KB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    throw new HttpError(400, "Send a valid JSON object.");
  }
}
export function textField(value: unknown, name: string, max = 1600): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, `${name} must contain 1–${max} characters.`);
  return value.trim();
}
export function sessionId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(value))
    throw new HttpError(
      400,
      "Start a new session; its ID must be 16–80 letters, digits, underscores or hyphens.",
    );
  return value;
}
export async function api(
  request: Request,
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  const limit = limiter.take(clientIp(request));
  if (!limit.ok)
    return json({ error: limit.note }, 429, {
      "Retry-After": String(limit.retryAfter),
    });
  if (new TextEncoder().encode(request.url).length > MAX_INPUT_BYTES)
    return json({ error: "Keep the request URL under 2 KB." }, 413);
  try {
    return await handler();
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    // Known validation messages only; do not reflect upstream bodies, URLs or credentials.
    return json(
      {
        error:
          error instanceof Error &&
          !/fetch|network|abort|timeout/i.test(error.message)
            ? error.message
            : "The service could not respond. Please try again.",
      },
      400,
    );
  }
}
