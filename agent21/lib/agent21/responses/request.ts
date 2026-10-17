import type {
  ResponseCreateParamsBase,
  ResponseIncludable,
  Tool,
} from "openai/resources/responses/responses";
import { GITHUB_READ_TOOLS, GITHUB_READONLY_MCP_URL } from "../openai";
import type { PromptSource } from "./prompt";
import { shellTool, skillRefs } from "./shell";
import { functionTools } from "./tools";

// The create parameters every round shares. Path C is the data tools plus web
// search; path B adds the hosted shell. Both can be offered in one request and
// the model picks per question. With programmatic calling, the model can also
// write a short JavaScript program that calls the data tools, in parallel and
// in loops, and returns only what the answer needs.
export type Paths = "B" | "C" | "BC";
export type EngineSettings = {
  model: string;
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  verbosity?: "low" | "medium" | "high";
  tier?: "auto" | "default" | "flex" | "priority";
  paths: Paths;
  prompt: PromptSource;
  /** The conversation's container while it is alive. */
  containerId?: string;
  /** Uploads copied into a new container. */
  fileIds?: string[];
  /** Keeps the conversation's requests on the same prompt cache. */
  cacheKey?: string;
  metadata?: Record<string, string>;
  /** The data tools can be called from a model-written program. */
  programmatic?: boolean;
  /** Context size (tokens) at which the server compacts older turns. */
  compactThreshold?: number;
  /** Read-only token for GitHub's MCP server (public repositories only). */
  githubToken?: string;
};

export function engineSettings(
  overrides: Partial<EngineSettings> & { prompt: PromptSource },
): EngineSettings {
  return {
    model: process.env.AGENT21_RESPONSES_MODEL ?? "gpt-6-luna",
    effort:
      (process.env.AGENT21_RESPONSES_EFFORT as EngineSettings["effort"]) ??
      "medium",
    verbosity:
      (process.env
        .AGENT21_RESPONSES_VERBOSITY as EngineSettings["verbosity"]) ??
      undefined,
    tier:
      (process.env.AGENT21_RESPONSES_TIER as EngineSettings["tier"]) ??
      undefined,
    paths: "BC",
    programmatic: process.env.AGENT21_PROGRAMMATIC === "1",
    compactThreshold: Number(process.env.AGENT21_COMPACT_THRESHOLD) || 80_000,
    githubToken: process.env.GITHUB_MCP_TOKEN || undefined,
    ...overrides,
  };
}

/**
 * GitHub's read-only MCP server, limited to the four read tools the dashboard
 * agent allows, for questions about how Secret Satoshis builds a number or
 * chart. Calls need no approval: nothing on it can write.
 */
export function githubTool(token: string): Tool {
  return {
    type: "mcp",
    server_label: "github",
    server_url: GITHUB_READONLY_MCP_URL,
    authorization: token,
    allowed_tools: [...GITHUB_READ_TOOLS],
    require_approval: "never",
  };
}

export function tools(settings: EngineSettings): Tool[] {
  const list: Tool[] = [{ type: "web_search" }];
  if (settings.paths.includes("C")) {
    list.unshift(
      ...functionTools(
        undefined,
        settings.programmatic ? ["direct", "programmatic"] : undefined,
      ),
    );
    if (settings.programmatic)
      list.push({ type: "programmatic_tool_calling" } as Tool);
  }
  if (settings.githubToken) list.push(githubTool(settings.githubToken));
  if (settings.paths.includes("B"))
    list.push(
      shellTool({
        containerId: settings.containerId,
        fileIds: settings.fileIds,
        skills: skillRefs(),
      }),
    );
  return list;
}

const INCLUDE: ResponseIncludable[] = ["web_search_call.action.sources"];

/** Everything but the input and the chain, which change each round. */
export function createParams(
  settings: EngineSettings,
): ResponseCreateParamsBase {
  return {
    model: settings.model,
    ...(settings.prompt.kind === "stored"
      ? { prompt: settings.prompt.prompt }
      : { instructions: settings.prompt.instructions }),
    tools: tools(settings),
    parallel_tool_calls: true,
    reasoning: {
      ...(settings.effort ? { effort: settings.effort } : {}),
      summary: "auto",
    },
    ...(settings.verbosity ? { text: { verbosity: settings.verbosity } } : {}),
    ...(settings.tier ? { service_tier: settings.tier } : {}),
    include: INCLUDE,
    store: true,
    ...(settings.compactThreshold
      ? {
          context_management: [
            {
              type: "compaction",
              compact_threshold: settings.compactThreshold,
            },
          ],
        }
      : {}),
    ...(settings.cacheKey ? { prompt_cache_key: settings.cacheKey } : {}),
    ...(settings.metadata ? { metadata: settings.metadata } : {}),
  };
}
