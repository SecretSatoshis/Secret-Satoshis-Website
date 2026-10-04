import { randomUUID } from "node:crypto";
import { AppError, errorResponse } from "./errors";

/**
 * Wraps a route handler so every failure becomes a sanitized JSON error that
 * carries a reference ID, matching the diagnostics written to the logs.
 */
export function handler<
  P extends Record<string, string> = Record<string, never>,
>(fn: (request: Request, params: P) => Promise<Response>) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      return await fn(request, await context.params);
    } catch (error) {
      return errorResponse(error, { requestId: randomUUID() });
    }
  };
}
/** Parses a small JSON request body; Agent 21 requests are never larger than 32 KiB. */
export async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > 32_768)
    throw new AppError(413, "Request is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text) > 32_768)
    throw new AppError(413, "Request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "Invalid JSON request.");
  }
}
