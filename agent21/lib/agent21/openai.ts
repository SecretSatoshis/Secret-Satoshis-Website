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
/** The Agent 21 data server; the data key is sent to this URL only. */
export const mcpServerUrl = () => required("AGENT21_MCP_URL");
/** BRK's public MCP server for Bitcoin series and network data; it takes no key. */
export const BRK_MCP_URL = "https://mcp.bitview.space/";
const isBrkServer = (url: string) => {
  try {
    return new URL(url).href === BRK_MCP_URL;
  } catch {
    return false;
  }
};
/**
 * The OpenAI vault holding the data key, when the agent authenticates through
 * one (OpenAI's recommended setup). Without it, the website sends the key from
 * AGENT21_MCP_KEY itself.
 */
export const mcpVaultId = () => process.env.AGENT21_MCP_VAULT_ID || null;
// The saved agent can be edited in the dashboard, so its tools are re-read
// every few minutes rather than cached for the life of the process.
const TOOLS_TTL_MS = 5 * 60_000;
const savedTools = new Map<
  string,
  { at: number; tools: Promise<PersistedAgentTool[]> }
>();
/**
 * The saved agent's tools for one session. With a vault, OpenAI supplies the
 * data key; otherwise it is added here as a bearer header, which OpenAI
 * encrypts and omits from returned resources. Callers must not persist the
 * result.
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
  const vault = mcpVaultId();
  const key = vault ? null : required("AGENT21_MCP_KEY");
  const url = mcpServerUrl();
  return (await cached.tools).map((tool): AgentToolParam => {
    // Releases may add hosted search, programmatic tool calling and BRK's
    // keyless server; any other tool or MCP server needs review first.
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
    if (
      tool.type === "mcp" &&
      tool.transport.type === "http" &&
      isBrkServer(tool.transport.server_url)
    )
      return {
        type: "mcp",
        server_label: tool.server_label,
        allowed_tools: tool.allowed_tools,
        connection_origin: tool.connection_origin,
        required: tool.required,
        transport: { type: "http", server_url: tool.transport.server_url },
      };
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
      ...(vault ? { credential_id: tool.credential_id } : {}),
      transport: {
        type: "http",
        server_url: url,
        ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
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
