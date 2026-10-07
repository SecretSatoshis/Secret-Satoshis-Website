import OpenAI from "openai";
import { required } from "./config";
import type {
  AgentToolParam,
  PersistedAgentTool,
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
/** BRK's public MCP server for Bitcoin series and network data; it takes no credential. */
export const BRK_MCP_URL = "https://mcp.bitview.space/";
/**
 * GitHub's remote MCP server, repository tools in read-only mode. Its token
 * lives in the OpenAI vault attached to each session.
 */
export const GITHUB_MCP_URL =
  "https://api.githubcopilot.com/mcp/x/repos/readonly";
// Compare origin and path, ignoring a trailing slash the dashboard may add.
const sameServer = (url: string, expected: string) => {
  try {
    const [a, b] = [new URL(url), new URL(expected)];
    const path = (u: URL) => u.pathname.replace(/\/+$/, "");
    return a.origin === b.origin && path(a) === path(b) && !a.search;
  } catch {
    return false;
  }
};
/** The OpenAI vault holding MCP credentials (the GitHub token). */
export const mcpVaultId = () => process.env.AGENT21_MCP_VAULT_ID || null;
// The saved agent can be edited in the dashboard, so its tools are re-read
// every few minutes rather than cached for the life of the process.
const TOOLS_TTL_MS = 5 * 60_000;
const savedTools = new Map<
  string,
  { at: number; tools: Promise<PersistedAgentTool[]> }
>();
/**
 * The saved agent's tools for one session. Only reviewed tools pass: hosted
 * search, programmatic tool calling, BRK's keyless server and GitHub's read-only
 * server, whose credential OpenAI supplies from the session's vault.
 */
export async function sessionTools(agentId: string): Promise<AgentToolParam[]> {
  let cached = savedTools.get(agentId);
  if (!cached || Date.now() - cached.at > TOOLS_TTL_MS) {
    const tools = openai()
      .beta.agents.retrieve(agentId)
      .then((agent) => agent.tools);
    cached = { at: Date.now(), tools };
    savedTools.set(agentId, cached);
    tools.catch(() => savedTools.delete(agentId));
  }
  return (await cached.tools).map((tool): AgentToolParam => {
    if (tool.type === "web_search")
      return {
        type: "web_search",
        allowed_domains: tool.allowed_domains,
        context_size: tool.context_size,
        location: tool.location,
        mode: tool.mode,
      };
    if (tool.type === "programmatic_tool_calling")
      return { type: "programmatic_tool_calling", enabled: tool.enabled };
    if (tool.type === "mcp" && tool.transport.type === "http") {
      const url = tool.transport.server_url;
      const shared = {
        type: "mcp" as const,
        server_label: tool.server_label,
        allowed_tools: tool.allowed_tools,
        connection_origin: tool.connection_origin,
        required: tool.required,
        transport: { type: "http" as const, server_url: url },
      };
      if (sameServer(url, BRK_MCP_URL)) return shared;
      if (sameServer(url, GITHUB_MCP_URL))
        return { ...shared, credential_id: tool.credential_id };
    }
    throw new Error("The agent names an unexpected tool or MCP server");
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
