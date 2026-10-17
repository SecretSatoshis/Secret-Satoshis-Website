import type OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsBase,
  ResponseInput,
  ResponseOutputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { extractBlocks, parseBlock } from "../blocks";
import { progressFor } from "./progress";
import { runTool, type ToolContext, type ToolRun } from "./tools";

// One answer: rounds of `responses.create`, each streamed, with the data tools
// run here between rounds and the next round chained on the previous response.
// Hosted tools (web search, the shell) run inside a round. The sink sees
// progress and answer text as they arrive; the website and the bench differ
// only in their sinks.
export type LoopEvent =
  | { type: "round"; round: number; responseId: string }
  | { type: "progress"; label: string }
  | { type: "text"; delta: string; itemId: string; phase: string | null }
  | { type: "tool"; run: ToolRun };
export type RoundLog = {
  round: number;
  responseId: string;
  status: string;
  startedMs: number;
  firstEventMs: number | null;
  firstTextMs: number | null;
  endedMs: number;
  usage: ResponseUsage | null;
  output: ResponseOutputItem[];
  toolRuns: (ToolRun & { callId?: string })[];
  repair?: boolean;
};
export type LoopResult = {
  status: "completed" | "failed" | "incomplete";
  text: string;
  error?: string;
  rounds: RoundLog[];
  lastResponseId: string | null;
  containerIds: string[];
  usage: { input: number; cached: number; output: number; reasoning: number };
  firstTextMs: number | null;
  totalMs: number;
};

const TERMINAL = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
]);

/** The answer in a response: assistant messages that are not progress notes. */
export function answerText(output: ResponseOutputItem[]) {
  return output
    .filter((item) => item.type === "message" && item.role === "assistant")
    .filter((item) => !("phase" in item) || item.phase !== "commentary")
    .flatMap((item) =>
      item.type === "message"
        ? item.content
            .filter((part) => part.type === "output_text")
            .map((part) => part.text)
        : [],
    )
    .join("\n\n");
}

/** Blocks the website would refuse, with the reason for each. */
export function invalidBlocks(text: string) {
  return extractBlocks(text)
    .map(({ language, code }) => ({
      language,
      parsed: parseBlock(language, code),
    }))
    .filter((b) => !b.parsed.ok)
    .map((b) => `${b.language}: ${b.parsed.ok ? "" : b.parsed.reason}`);
}

/** Containers the shell used, from its calls. */
function containersIn(output: ResponseOutputItem[]) {
  const ids = new Set<string>();
  for (const item of output) {
    const env = (item as { environment?: { container_id?: string } | null })
      .environment;
    if (item.type === "shell_call" && env?.container_id)
      ids.add(env.container_id);
  }
  return [...ids];
}

export async function runRounds(options: {
  client: OpenAI;
  params: ResponseCreateParamsBase;
  input: ResponseInput | string;
  previousResponseId?: string;
  context: ToolContext;
  sink?: (event: LoopEvent) => void;
  maxRounds?: number;
  background?: boolean;
  /** One extra round to fix blocks the website would refuse. */
  repairBlocks?: boolean;
}): Promise<LoopResult> {
  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const sink = options.sink ?? (() => undefined);
  const rounds: RoundLog[] = [];
  const usage = { input: 0, cached: 0, output: 0, reasoning: 0 };
  let input: ResponseInput | string = options.input;
  let previous = options.previousResponseId;
  let firstTextMs: number | null = null;
  let repaired = false;
  const maxRounds = options.maxRounds ?? 8;

  for (let round = 1; round <= maxRounds + 1; round++) {
    const startedMs = since();
    let firstEventMs: number | null = null;
    let roundFirstText: number | null = null;
    let response: Response | undefined;
    const phases = new Map<string, string | null>();
    const stream = await options.client.responses.create({
      ...options.params,
      input,
      ...(previous ? { previous_response_id: previous } : {}),
      ...(options.background ? { background: true } : {}),
      stream: true,
    });
    for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
      firstEventMs ??= since();
      if (event.type === "response.created")
        sink({ type: "round", round, responseId: event.response.id });
      if (event.type === "response.output_item.added") {
        const item = event.item;
        if (item.type === "message")
          phases.set(item.id, ("phase" in item ? item.phase : null) ?? null);
        const label = progressFor(item);
        if (label) sink({ type: "progress", label });
      }
      if (event.type === "response.output_text.delta") {
        const phase = phases.get(event.item_id) ?? null;
        if (phase !== "commentary") {
          roundFirstText ??= since();
          firstTextMs ??= since();
        }
        sink({
          type: "text",
          delta: event.delta,
          itemId: event.item_id,
          phase,
        });
      }
      if (TERMINAL.has(event.type)) {
        response = (event as { response: Response }).response;
        break;
      }
    }
    if (!response)
      throw new Error("The response stream ended without a result");
    const u = response.usage;
    if (u) {
      usage.input += u.input_tokens;
      usage.cached += u.input_tokens_details?.cached_tokens ?? 0;
      usage.output += u.output_tokens;
      usage.reasoning += u.output_tokens_details?.reasoning_tokens ?? 0;
    }
    const log: RoundLog = {
      round,
      responseId: response.id,
      status: response.status ?? "unknown",
      startedMs,
      firstEventMs,
      firstTextMs: roundFirstText,
      endedMs: since(),
      usage: u ?? null,
      output: response.output,
      toolRuns: [],
      ...(repaired ? { repair: true } : {}),
    };
    rounds.push(log);
    previous = response.id;
    const finish = (
      status: LoopResult["status"],
      error?: string,
    ): LoopResult => ({
      status,
      text: answerText(response!.output),
      ...(error ? { error } : {}),
      rounds,
      lastResponseId: response!.id,
      containerIds: [...new Set(rounds.flatMap((r) => containersIn(r.output)))],
      usage,
      firstTextMs,
      totalMs: since(),
    });
    if (response.status === "failed")
      return finish("failed", response.error?.message ?? "The response failed");
    if (response.status === "incomplete")
      return finish(
        "incomplete",
        response.incomplete_details?.reason ?? "The response was incomplete",
      );

    const calls = response.output.filter(
      (item) => item.type === "function_call",
    );
    if (!calls.length) {
      const text = answerText(response.output);
      const broken =
        options.repairBlocks && !repaired ? invalidBlocks(text) : [];
      if (!broken.length || round > maxRounds) return finish("completed");
      repaired = true;
      input = [
        {
          role: "developer",
          content: `These blocks in your answer fail the website's checks:\n${broken.join("\n")}\nWrite the whole answer again with them fixed, changing nothing else.`,
        },
      ];
      continue;
    }
    if (round > maxRounds) return finish("incomplete", "Too many tool rounds");
    const runs = await Promise.all(
      calls.map(async (call) => {
        const run = {
          ...(await runTool(call.name, call.arguments, options.context)),
          callId: call.call_id,
        };
        log.toolRuns.push(run);
        sink({ type: "tool", run });
        return {
          type: "function_call_output" as const,
          call_id: call.call_id,
          output: run.output,
        };
      }),
    );
    input = runs;
  }
  throw new Error("unreachable");
}
