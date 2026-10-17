import type {
  ResponseCreateParamsBase,
  ResponseIncludable,
  Tool,
} from "openai/resources/responses/responses";
import type { PromptSource } from "./prompt";
import { shellTool, skillRefs } from "./shell";
import { functionTools } from "./tools";

// The create parameters every round shares. Path C is the data tools plus web
// search; path B adds the hosted shell. Both can be offered in one request and
// the model picks per question.
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
    ...overrides,
  };
}

export function tools(settings: EngineSettings): Tool[] {
  const list: Tool[] = [{ type: "web_search" }];
  if (settings.paths.includes("C")) list.unshift(...functionTools());
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
    ...(settings.cacheKey ? { prompt_cache_key: settings.cacheKey } : {}),
    ...(settings.metadata ? { metadata: settings.metadata } : {}),
  };
}
