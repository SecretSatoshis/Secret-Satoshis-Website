import OpenAI from "openai";
import { required } from "./config";
import pricing from "./contracts/pricing.json";
import type {
  AgentToolParam,
  PersistedAgentTool,
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
/**
 * Model cost of a turn in USD, from the release's pricing.json. Turn usage
 * sums every model request in the turn, while long-context pricing applies
 * per request, so the estimate uses standard rates; the Costs API is exact.
 */
export function estimatedTokens(usage: TokenUsage | null) {
  if (!usage) return null;
  const rates = pricing.usd_per_million_tokens;
  const cached = usage.input_tokens_details.cached_tokens;
  // Uncached input is billed once, as input or as a cache write. Usage does
  // not say which, so price it at the higher rate.
  return (
    ((usage.input_tokens - cached) * Math.max(rates.input, rates.cache_write) +
      cached * rates.cached_input +
      usage.output_tokens * rates.output) /
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
// Network access comes from the release's environment template.
export function hostedEnvironment(
  template: string,
  files: HostedEnvironmentFileParam[] = [],
) {
  return {
    type: "openai_hosted" as const,
    environment_template_id: template,
    container_size: "medium",
    ...(files.length ? { files } : {}),
  };
}
/** The Agent 21 data server; the service credential is sent to this URL only. */
export const mcpServerUrl = () => required("AGENT21_MCP_URL");
const releaseTools = new Map<string, Promise<PersistedAgentTool[]>>();
/**
 * The saved agent's tools with the data server's credential added. Releases
 * name the server without credentials; OpenAI encrypts session headers and
 * omits them from returned resources. Callers must not persist the result.
 */
export async function sessionTools(agentId: string): Promise<AgentToolParam[]> {
  let tools = releaseTools.get(agentId);
  if (!tools) {
    tools = openai()
      .beta.agents.retrieve(agentId)
      .then((agent) => agent.tools);
    releaseTools.set(agentId, tools);
    tools.catch(() => releaseTools.delete(agentId));
  }
  const key = required("AGENT21_MCP_KEY");
  const url = mcpServerUrl();
  return (await tools).map((tool) => {
    // The release defines only the data server; anything else needs review.
    if (
      tool.type !== "mcp" ||
      tool.transport.type !== "http" ||
      tool.transport.server_url !== url
    )
      throw new Error("The release names an unexpected tool or MCP server");
    return {
      type: "mcp",
      server_label: tool.server_label,
      allowed_tools: tool.allowed_tools,
      connection_origin: tool.connection_origin,
      required: tool.required,
      transport: {
        type: "http",
        server_url: url,
        headers: {
          "OAI-Sites-Authorization": `Bearer ${key}`,
          "X-Agent21-MCP-Key": key,
        },
      },
    };
  });
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
