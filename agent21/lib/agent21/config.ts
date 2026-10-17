import { engine } from "./engine";

export const LIMITS = {
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
  // A file still pending after this was abandoned (an upload that never
  // finished): it no longer counts toward the allowances, and maintenance
  // removes it.
  pendingFileMs: 30 * 60_000,
  attachments: 5,
} as const;
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
// Credentials by engine. The Agents engine (dormant) needs its dashboard
// agent, sandbox template, build label, MCP vault and session webhooks; the
// Responses engine needs the skill versions its shell mounts.
const AGENTS_CREDENTIALS = [
  "OPENAI_API_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "AGENT21_AGENT_ID",
  "AGENT21_ENVIRONMENT_TEMPLATE_ID",
  "AGENT21_RUNTIME_VERSION",
  "AGENT21_MCP_VAULT_ID",
  "APP_ORIGIN",
  "OPENAI_WEBHOOK_SECRET",
  "CLERK_WEBHOOK_SIGNING_SECRET",
] as const;
const RESPONSES_CREDENTIALS = [
  "OPENAI_API_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "AGENT21_SKILLS",
  "APP_ORIGIN",
  "CLERK_WEBHOOK_SIGNING_SECRET",
] as const;
/** Every credential either engine reads. */
export const credentialNames = [
  ...new Set([...AGENTS_CREDENTIALS, ...RESPONSES_CREDENTIALS]),
];
/** The credentials the configured engine needs. */
export const engineCredentials = (): readonly string[] =>
  engine() === "agents" ? AGENTS_CREDENTIALS : RESPONSES_CREDENTIALS;
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
    ...engineCredentials().filter(
      (name) =>
        !process.env[name] &&
        !(local && webhookCredentials.some((webhook) => webhook === name)),
    ),
    ...(blobConfigured() ? [] : ["BLOB_STORE_ID"]),
    // Presigned browser uploads cannot be signed without it.
    ...(process.env.BLOB_WEBHOOK_PUBLIC_KEY ? [] : ["BLOB_WEBHOOK_PUBLIC_KEY"]),
  ];
}
export function enabled() {
  return configured() && process.env.AGENT21_ENABLED === "true";
}
