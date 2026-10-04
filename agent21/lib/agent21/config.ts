export const LIMITS = {
  users: 20,
  turnMs: 600_000,
  // Hard stop for every phase: an unfinished run is settled as failed after this.
  abandonMs: 900_000,
  // Window for a lost creation to appear in the provider's session listing.
  creationSettleMs: 60_000,
  // Newest quoted history replayed into a replacement sandbox.
  historyChars: 120_000,
  uploadBytes: 10 * 1024 ** 2,
  outputBytes: 20 * 1024 ** 2,
  storageBytes: 250 * 1024 ** 2,
  attachments: 5,
} as const;
export function setting(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new Error(`Invalid ${name}`);
  return number;
}
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export const credentialNames = [
  "OPENAI_API_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "AGENT21_AGENT_ID",
  "AGENT21_ENVIRONMENT_TEMPLATE_ID",
  "AGENT21_RUNTIME_VERSION",
  "APP_ORIGIN",
  "OPENAI_WEBHOOK_SECRET",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "CRON_SECRET",
] as const;
export function configured() {
  return missingCredentials().length === 0;
}
const webhookCredentials = [
  "OPENAI_WEBHOOK_SECRET",
  "CLERK_WEBHOOK_SIGNING_SECRET",
] as const;
export function isLoopbackDevelopment() {
  return (
    process.env.NODE_ENV === "development" &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(process.env.APP_ORIGIN ?? "")
  );
}
// On Vercel, Blob authenticates with rotating OIDC tokens for the connected
// store (BLOB_STORE_ID); local development can use a read-write token instead.
const blobConfigured = () =>
  Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
export function missingCredentials() {
  // Local development polls provider state; public deployments also require
  // signed lifecycle webhooks. This exception never applies to production.
  const local = isLoopbackDevelopment();
  return [
    ...credentialNames.filter(
      (name) =>
        !process.env[name] &&
        !(local && webhookCredentials.some((webhook) => webhook === name)),
    ),
    ...(blobConfigured() ? [] : ["BLOB_STORE_ID"]),
  ];
}
/** Configuration evidence only: no credentials, origins or provider IDs are returned. */
export function configurationReadiness() {
  const missing = missingCredentials();
  const deploymentMissing = [
    ...credentialNames.filter((name) => !process.env[name]),
    ...(process.env.BLOB_STORE_ID ? [] : ["BLOB_STORE_ID"]),
  ];
  const local = isLoopbackDevelopment();
  const omittedWebhooks = webhookCredentials.filter(
    (name) => !process.env[name],
  );
  const origin = process.env.APP_ORIGIN ?? "";
  let originKind:
    "missing" | "loopback_http" | "https_origin" | "invalid_or_non_https" =
    "missing";
  if (origin) {
    if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
      originKind = "loopback_http";
    else {
      try {
        const url = new URL(origin);
        originKind =
          url.protocol === "https:" &&
          url.origin === origin &&
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
            ? "https_origin"
            : "invalid_or_non_https";
      } catch {
        originKind = "invalid_or_non_https";
      }
    }
  }
  const developmentClerk =
    process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ===
      true;
  const blockers = [
    ...(deploymentMissing.length ? ["missing_credentials"] : []),
    ...(originKind !== "https_origin"
      ? ["approved_https_origin_required"]
      : []),
    ...(developmentClerk ? ["production_clerk_credentials_required"] : []),
  ];
  return {
    application: {
      status: missing.length
        ? "missing_configuration"
        : "configuration_present_not_verified",
      mode: local ? "loopback_development" : "deployment",
      missingCredentials: missing,
      webhookExceptionApplied: local && omittedWebhooks.length > 0,
      omittedDevelopmentWebhooks: local ? omittedWebhooks : [],
      newRunsEnabledByConfiguration: enabled(),
    },
    productionPreparation: {
      status: blockers.length
        ? "incomplete"
        : "configuration_present_not_verified",
      missingCredentials: deploymentMissing,
      originKind,
      developmentClerkCredentials: developmentClerk,
      blockers,
      pendingVerification: [
        "provider_access",
        "dashboard_settings",
        "signed_webhook_delivery",
        "protected_preview_acceptance",
      ],
    },
  };
}
export function enabled() {
  return configured() && process.env.AGENT21_ENABLED === "true";
}
