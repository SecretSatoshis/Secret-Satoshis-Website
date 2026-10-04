/**
 * Optional error monitoring. With SENTRY_DSN set, Sentry receives Agent 21's
 * sanitized diagnostics (event, provider, error code, status and reference
 * IDs) and nothing else: no messages, stack traces, requests or breadcrumbs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  const { setDiagnosticReporter } = await import("./lib/agent21/diagnostics");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    defaultIntegrations: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend: (event) =>
      event.tags?.agent21 === "diagnostic"
        ? { ...event, request: undefined, user: undefined, breadcrumbs: [] }
        : null,
  });
  setDiagnosticReporter((record) =>
    Sentry.captureMessage(
      `${record.event}: ${record.provider} ${record.code}`,
      {
        level: "error",
        fingerprint: [record.event, record.provider, record.code],
        tags: {
          agent21: "diagnostic",
          event: record.event,
          provider: record.provider,
          code: record.code,
          ...(record.status ? { status: String(record.status) } : {}),
        },
        extra: {
          reference: record.id,
          requestId: record.requestId,
          runId: record.runId,
        },
      },
    ),
  );
}
