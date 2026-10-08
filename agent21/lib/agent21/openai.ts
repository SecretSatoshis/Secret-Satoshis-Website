import OpenAI from "openai";
import { required } from "./config";
import { AppError } from "./errors";
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
// The dashboard's environment template sets network access and packages. A
// template has no sandbox size and a session defaults to medium (2 vCPU, 4 GB),
// so the session asks for small (1 vCPU, 1 GB): the agent's data and charts fit,
// and the sandbox is the largest part of a conversation's cost. container_size is
// documented but not yet declared by SDK 7.25.0.
export function hostedEnvironment(
  template: string,
  files: HostedEnvironmentFileParam[] = [],
) {
  return {
    type: "openai_hosted" as const,
    environment_template_id: template,
    container_size: "small",
    ...(files.length ? { files } : {}),
  };
}
/** BRK's public MCP server for Bitcoin series and network data; it takes no credential. */
export const BRK_MCP_URL = "https://mcp.bitview.space/";
/**
 * GitHub's remote MCP server, at the URL the dashboard agent uses; its
 * read-only repository path is accepted too. The full server also offers write
 * tools, so a session passes GitHub through only when the agent allows nothing
 * beyond these read tools. Its token, which can only read public repositories,
 * lives in the OpenAI vault attached to each session.
 */
export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";
const GITHUB_READONLY_MCP_URL =
  "https://api.githubcopilot.com/mcp/x/repos/readonly";
export const GITHUB_READ_TOOLS: ReadonlySet<string> = new Set([
  "get_commit",
  "get_file_contents",
  "list_commits",
  "search_code",
]);
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
export const isGitHubServer = (url: string) =>
  sameServer(url, GITHUB_MCP_URL) || sameServer(url, GITHUB_READONLY_MCP_URL);
/** The OpenAI vault holding MCP credentials (the GitHub token). */
export const mcpVaultId = () => process.env.AGENT21_MCP_VAULT_ID || null;
// The saved agent can be edited in the dashboard, so its tools are re-read
// every few minutes rather than cached for the life of the process.
const TOOLS_TTL_MS = 5 * 60_000;
const savedTools = new Map<
  string,
  { at: number; tools: Promise<PersistedAgentTool[]> }
>();
// A tool outside the reviewed list is a dashboard setting, not a passing
// fault: the answer fails at once with a code the diagnostics keep.
const rejectedTools = (message: string) =>
  new AppError(503, message, "agent_tools_rejected");
// The Agents API enables programmatic tool calling unless a session's tools
// turn it off; the agent works in its Python sandbox instead.
const NO_PROGRAMMATIC_CALLS = {
  type: "programmatic_tool_calling",
  enabled: false,
} as const;
/**
 * The saved agent's tools for one session. Only reviewed tools pass: hosted
 * search, BRK's keyless server and GitHub's server limited to read tools, whose
 * credential OpenAI supplies from the session's vault. Programmatic tool
 * calling is always turned off.
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
  const tools = (await cached.tools).flatMap((tool): AgentToolParam[] => {
    if (tool.type === "programmatic_tool_calling" && !tool.enabled) return [];
    if (tool.type === "web_search")
      return [
        {
          type: "web_search",
          allowed_domains: tool.allowed_domains,
          context_size: tool.context_size,
          location: tool.location,
          mode: tool.mode,
        },
      ];
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
      if (sameServer(url, BRK_MCP_URL)) return [shared];
      if (isGitHubServer(url)) {
        const allowed = tool.allowed_tools ?? [];
        if (
          !allowed.length ||
          !allowed.every((name) => GITHUB_READ_TOOLS.has(name))
        )
          throw rejectedTools(
            "The agent's GitHub server must allow only read tools",
          );
        return [{ ...shared, credential_id: tool.credential_id }];
      }
    }
    throw rejectedTools("The agent names an unexpected tool or MCP server");
  });
  return [...tools, NO_PROGRAMMATIC_CALLS];
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
