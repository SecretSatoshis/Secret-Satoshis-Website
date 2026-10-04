import OpenAI from "openai";
import { required } from "./config";
import pricing from "./contracts/pricing.json";
import type {
  TokenUsage,
  AgentSessionItem,
  HostedEnvironmentFileParam,
} from "openai/resources/beta/agents/agents";
let client: OpenAI | undefined;
/**
 * One client per instance. The SDK retries connection errors, 408, 409, 429
 * and 5xx with backoff. Writes that cannot be deduplicated by the provider
 * (session creation, file uploads) opt out per request.
 */
export function openai() {
  return (client ??= new OpenAI({
    apiKey: required("OPENAI_API_KEY"),
    timeout: 30_000,
  }));
}
/** Test-only injection of a client bound to a fake provider. */
export function setOpenAIForTests(value: OpenAI) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Test adapter is disabled");
  client = value;
}
export const isProviderError = (error: unknown, ...statuses: number[]) =>
  error instanceof OpenAI.APIError &&
  (!statuses.length || statuses.includes(error.status ?? 0));
export function publicText(items: AgentSessionItem[]) {
  return items
    .filter((item) => item.type === "message" && item.role === "assistant")
    .filter((item) => !("phase" in item) || item.phase !== "commentary")
    .flatMap((item) =>
      "content" in item
        ? item.content
            .filter((part) => part.type === "output_text")
            .map((part) => ("text" in part ? part.text : ""))
        : [],
    )
    .join("\n\n");
}
/** The turn's items, newest first until an older turn: a session can hold many turns. */
export async function turnItems(session: string, turn: string) {
  const items: AgentSessionItem[] = [];
  for await (const item of openai().beta.agents.sessions.items.list(session, {
    order: "desc",
  })) {
    if (item.turn_id === turn) items.unshift(item);
    else if (items.length) break;
  }
  return items;
}
/** Model cost of a turn in USD, from the release's pricing.json. */
export function estimatedTokens(usage: TokenUsage | null) {
  if (!usage) return null;
  const rates = pricing.usd_per_million_tokens;
  const cached = usage.input_tokens_details.cached_tokens;
  const long = usage.input_tokens > pricing.long_context.above_input_tokens;
  // Uncached input is billed once, as input or as a cache write. Usage does
  // not say which, so price it at the higher rate.
  const input =
    (usage.input_tokens - cached) * Math.max(rates.input, rates.cache_write) +
    cached * rates.cached_input;
  return (
    (input * (long ? pricing.long_context.input_multiplier : 1) +
      usage.output_tokens *
        rates.output *
        (long ? pricing.long_context.output_multiplier : 1)) /
    1_000_000
  );
}
/** Sandbox cost: billed per minute with a minimum per sandbox. */
export function containerCost(minutes: number) {
  return (
    (pricing.container_usd_per_hour / 60) *
    Math.max(pricing.container_minimum_minutes, minutes)
  );
}
// The documented container_size field is not yet declared by SDK 7.25.0.
// Preserve the managed runtime and send the documented field through the SDK.
export function hostedEnvironment(
  template: string,
  files: HostedEnvironmentFileParam[] = [],
) {
  return {
    type: "openai_hosted" as const,
    environment_template_id: template,
    container_size: "medium",
    network: { access: "disabled" as const },
    ...(files.length ? { files } : {}),
  };
}
export function environmentId(session: {
  environment: { type: string; id?: string };
}) {
  if (session.environment.type !== "openai_hosted" || !session.environment.id)
    throw new Error("A hosted sandbox is required");
  return session.environment.id;
}

export function canonicalData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonicalData) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalData((value as Record<string, unknown>)[key]),
        ]),
    ) as T;
  return value;
}
