import { randomUUID } from "node:crypto";

const providers = [
  "application",
  "openai",
  "neon",
  "blob",
  "workflow",
  "source",
  "unknown",
] as const;
type Provider = (typeof providers)[number];
const events = [
  "request_failed",
  "run_failed",
  "diagnostic_persist_failed",
  "migration_failed",
  "ops_report_failed",
  "preflight_failed",
  "beta_failed",
  "deletion_failed",
  "webhook_failed",
] as const;
type Event = (typeof events)[number];
const codes = new Set([
  "invalid_api_key",
  "insufficient_quota",
  "rate_limit_exceeded",
  "unknown_parameter",
  "invalid_request_error",
  "model_not_found",
  "permission_denied",
  "timeout",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "23505",
  "42P01",
  "42703",
  "57014",
  "invalid_request",
  "request_failed",
  "service_unavailable",
]);
const openaiErrors = new Set([
  "APIError",
  "BadRequestError",
  "AuthenticationError",
  "PermissionDeniedError",
  "NotFoundError",
  "ConflictError",
  "UnprocessableEntityError",
  "RateLimitError",
  "InternalServerError",
  "APIConnectionError",
  "APIConnectionTimeoutError",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DiagnosticContext = {
  requestId?: string;
  runId?: string;
  provider?: Provider;
};
export type Diagnostic = {
  id: string;
  event: Event;
  provider: Provider;
  code: string;
  status?: number;
  requestId?: string;
  runId?: string;
};

/** Deliberately never reads message, stack, body, details, headers, URLs or arguments. */
export function diagnostic(
  error: unknown,
  event: Event,
  context: DiagnosticContext = {},
): Diagnostic {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const name = typeof value.name === "string" ? value.name : "";
  const code =
    typeof value.code === "string" && codes.has(value.code)
      ? value.code
      : "unclassified_error";
  const provider =
    context.provider && providers.includes(context.provider)
      ? context.provider
      : name === "AppError" || name === "ZodError"
        ? "application"
        : openaiErrors.has(name)
          ? "openai"
          : ["23505", "42P01", "42703", "57014"].includes(code)
            ? "neon"
            : name.startsWith("Blob")
              ? "blob"
              : "unknown";
  return {
    id: randomUUID(),
    event: events.includes(event) ? event : "request_failed",
    provider,
    code,
    ...(typeof value.status === "number" &&
    Number.isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599
      ? { status: value.status }
      : {}),
    ...(context.requestId && uuid.test(context.requestId)
      ? { requestId: context.requestId }
      : {}),
    ...(context.runId && uuid.test(context.runId)
      ? { runId: context.runId }
      : {}),
  };
}
let reporter: ((record: Diagnostic) => void) | undefined;
/** Error monitoring receives the same sanitized records as the logs, and nothing else. */
export function setDiagnosticReporter(report: (record: Diagnostic) => void) {
  reporter = report;
}
export function logDiagnostic(
  error: unknown,
  event: Event,
  context: DiagnosticContext = {},
) {
  const record = diagnostic(error, event, context);
  console.error("Agent21 diagnostic", record);
  reporter?.(record);
  return record;
}
export function storedDiagnostic(value: unknown): Diagnostic | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !uuid.test(row.id)) return null;
  if (
    !events.includes(row.event as Event) ||
    !providers.includes(row.provider as Provider)
  )
    return null;
  return {
    id: row.id,
    event: row.event as Event,
    provider: row.provider as Provider,
    code:
      typeof row.code === "string" && codes.has(row.code)
        ? row.code
        : "unclassified_error",
    ...(typeof row.status === "number" &&
    Number.isInteger(row.status) &&
    row.status >= 100 &&
    row.status <= 599
      ? { status: row.status }
      : {}),
    ...(typeof row.requestId === "string" && uuid.test(row.requestId)
      ? { requestId: row.requestId }
      : {}),
    ...(typeof row.runId === "string" && uuid.test(row.runId)
      ? { runId: row.runId }
      : {}),
  };
}
