import { randomUUID } from "node:crypto";
import OpenAI from "openai";

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
  "landing_fallback",
  "answer_block_invalid",
  // A pre-warmed sandbox could not take the conversation's files; the session
  // started cold instead.
  "warm_environment_unused",
  "usage_not_recorded",
  "display_not_saved",
  "answer_withheld",
] as const;
type Event = (typeof events)[number];
const codes = new Set([
  "invalid_block_step",
  "invalid_block_figures",
  "invalid_block_facts",
  "invalid_block_table",
  "invalid_block_ladder",
  "invalid_block_chart",
  "invalid_block_sources",
  "invalid_block_unknown",
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
  "agent_tools_rejected",
  "example_facts_unavailable",
  "block_height_unavailable",
  "price_odds_unavailable",
  "live_price_unavailable",
  "realized_levels_unavailable",
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
  /** OpenAI's own error code and the request field it names: identifiers, never content. */
  providerCode?: string;
  param?: string;
  requestId?: string;
  runId?: string;
};

// OpenAI's error codes and field names are short identifiers such as
// "invalid_request_error" or "environment.files[0].file_id".
const identifier = /^[A-Za-z0-9_.[\]-]{1,80}$/;
const safeIdentifier = (value: unknown) =>
  typeof value === "string" && identifier.test(value) ? value : undefined;

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
        : // A production build renames error classes, so the type is checked too.
          error instanceof OpenAI.APIError || openaiErrors.has(name)
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
    ...(error instanceof OpenAI.APIError && safeIdentifier(error.code)
      ? { providerCode: safeIdentifier(error.code) }
      : {}),
    ...(error instanceof OpenAI.APIError && safeIdentifier(error.param)
      ? { param: safeIdentifier(error.param) }
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
/** The same record for a degraded path that still works, such as a snapshot
 * standing in for an unavailable source: logged as a warning, not an error. */
export function warnDiagnostic(
  error: unknown,
  event: Event,
  context: DiagnosticContext = {},
) {
  const record = diagnostic(error, event, context);
  console.warn("Agent21 diagnostic", record);
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
    ...(safeIdentifier(row.providerCode)
      ? { providerCode: safeIdentifier(row.providerCode) }
      : {}),
    ...(safeIdentifier(row.param) ? { param: safeIdentifier(row.param) } : {}),
    ...(typeof row.requestId === "string" && uuid.test(row.requestId)
      ? { requestId: row.requestId }
      : {}),
    ...(typeof row.runId === "string" && uuid.test(row.runId)
      ? { runId: row.runId }
      : {}),
  };
}
