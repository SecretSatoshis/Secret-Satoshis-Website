import { ZodError } from "zod";
import { logDiagnostic, type DiagnosticContext } from "./diagnostics";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_failed",
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function errorResponse(error: unknown, context: DiagnosticContext = {}) {
  const record = logDiagnostic(error, "request_failed", context);
  const reference = record.requestId ?? record.id;
  const headers = {
    "X-Agent21-Request-Id": reference,
    "Cache-Control": "private, no-store",
  };
  if (error instanceof ZodError)
    return Response.json(
      {
        error: "Please check the request fields.",
        code: "invalid_request",
        requestId: reference,
      },
      { status: 400, headers },
    );
  if (error instanceof AppError)
    return Response.json(
      { error: error.message, code: error.code, requestId: reference },
      { status: error.status, headers },
    );
  return Response.json(
    {
      error: "Agent 21 could not complete this request. Please try again.",
      code: "service_unavailable",
      requestId: reference,
    },
    { status: 503, headers },
  );
}
