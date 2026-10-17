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
import {
  OUTPUT_CAP,
  PROGRAM_OUTPUT_CAP,
  runTool,
  type ToolContext,
  type ToolRun,
} from "./tools";

// One answer: rounds of `responses.create`, each streamed, with the data tools
// run here between rounds. Each round continues the conversation: in a
// Conversations API conversation, which keeps every item without expiry, or
// chained on the previous response (stored for 30 days).
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
  toolRuns: (ToolRun & { callId?: string; fromProgram?: boolean })[];
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
export function containersIn(output: ResponseOutputItem[]) {
  const ids = new Set<string>();
  for (const item of output) {
    const env = (item as { environment?: { container_id?: string } | null })
      .environment;
    if (item.type === "shell_call" && env?.container_id)
      ids.add(env.container_id);
  }
  return [...ids];
}

const BUSY = /Another process is currently operating on this conversation/;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One round's request. A conversation stays busy for a moment after the
 * previous round's stream ends, so a refusal for that is retried briefly.
 */
export async function createRound(
  client: OpenAI,
  body: Parameters<OpenAI["responses"]["create"]>[0],
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.responses.create(body);
    } catch (error) {
      if (attempt >= 6 || !BUSY.test(String((error as Error).message)))
        throw error;
      await sleep(500 * attempt);
    }
  }
}

export type RoundStream = {
  response: Response;
  /** Milliseconds from the call to its first event and first answer text. */
  firstEventMs: number | null;
  firstTextMs: number | null;
};

/**
 * Reads one round's event stream to its end: a new round, or a background
 * response being resumed. Progress and answer text go to the sink as they
 * arrive; the response comes back once it completes, fails or stops.
 */
export async function readRound(
  stream: AsyncIterable<ResponseStreamEvent>,
  sink: (event: LoopEvent) => void,
  round = 0,
): Promise<RoundStream> {
  const t0 = Date.now();
  let firstEventMs: number | null = null;
  let firstTextMs: number | null = null;
  const phases = new Map<string, string | null>();
  for await (const event of stream) {
    firstEventMs ??= Date.now() - t0;
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
      if (phase !== "commentary") firstTextMs ??= Date.now() - t0;
      sink({ type: "text", delta: event.delta, itemId: event.item_id, phase });
    }
    if (TERMINAL.has(event.type))
      return {
        response: (event as { response: Response }).response,
        firstEventMs,
        firstTextMs,
      };
  }
  throw new Error("The response stream ended without a result");
}

/** The function calls a finished round asked for, still to be answered. */
export const functionCalls = (response: Response) =>
  response.output.filter((item) => item.type === "function_call");

/**
 * Runs a round's function calls in parallel. A call from a model-written
 * program goes back to that program, tagged with its caller unchanged, and the
 * program resumes.
 */
export async function runCalls(
  calls: ReturnType<typeof functionCalls>,
  context: ToolContext,
  onRun: (
    run: ToolRun & { callId: string; fromProgram?: boolean },
  ) => void = () => undefined,
) {
  return Promise.all(
    calls.map(async (call) => {
      const fromProgram = call.caller?.type === "program";
      const run = {
        ...(await runTool(
          call.name,
          call.arguments,
          context,
          fromProgram ? PROGRAM_OUTPUT_CAP : OUTPUT_CAP,
        )),
        callId: call.call_id,
        ...(fromProgram ? { fromProgram } : {}),
      };
      onRun(run);
      return {
        type: "function_call_output" as const,
        call_id: call.call_id,
        output: run.output,
        ...(call.caller ? { caller: call.caller } : {}),
      };
    }),
  );
}

/** The round that asks for broken blocks to be fixed. */
export const repairInput = (broken: string[]): ResponseInput => [
  {
    role: "developer",
    content: `These blocks in your answer fail the website's checks:\n${broken.join("\n")}\nWrite the whole answer again with them fixed, changing nothing else.`,
  },
];

/** A response's token use, in the ledger's terms. */
export function usageOf(response: Response) {
  const u = response.usage;
  return {
    input: u?.input_tokens ?? 0,
    cached: u?.input_tokens_details?.cached_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

export async function runRounds(options: {
  client: OpenAI;
  params: ResponseCreateParamsBase;
  input: ResponseInput | string;
  /** The Conversations API conversation the answer belongs to. */
  conversationId?: string;
  /** Or: the response to chain on, when there is no conversation. */
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
  // A program pauses once per batch of calls, so rounds run higher with it.
  const maxRounds = options.maxRounds ?? 12;

  for (let round = 1; round <= maxRounds + 1; round++) {
    const startedMs = since();
    const stream = await createRound(options.client, {
      ...options.params,
      input,
      ...(options.conversationId
        ? { conversation: options.conversationId }
        : previous
          ? { previous_response_id: previous }
          : {}),
      ...(options.background ? { background: true } : {}),
      stream: true,
    });
    const read = await readRound(
      stream as AsyncIterable<ResponseStreamEvent>,
      sink,
      round,
    );
    const response = read.response;
    if (read.firstTextMs !== null) firstTextMs ??= startedMs + read.firstTextMs;
    const used = usageOf(response);
    usage.input += used.input;
    usage.cached += used.cached;
    usage.output += used.output;
    usage.reasoning += used.reasoning;
    const log: RoundLog = {
      round,
      responseId: response.id,
      status: response.status ?? "unknown",
      startedMs,
      firstEventMs:
        read.firstEventMs === null ? null : startedMs + read.firstEventMs,
      firstTextMs:
        read.firstTextMs === null ? null : startedMs + read.firstTextMs,
      endedMs: since(),
      usage: response.usage ?? null,
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
      text: answerText(response.output),
      ...(error ? { error } : {}),
      rounds,
      lastResponseId: response.id,
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

    const calls = functionCalls(response);
    if (!calls.length) {
      const text = answerText(response.output);
      const broken =
        options.repairBlocks && !repaired ? invalidBlocks(text) : [];
      if (!broken.length || round > maxRounds) return finish("completed");
      repaired = true;
      input = repairInput(broken);
      continue;
    }
    if (round > maxRounds) return finish("incomplete", "Too many tool rounds");
    input = await runCalls(calls, options.context, (run) => {
      log.toolRuns.push(run);
      sink({ type: "tool", run });
    });
  }
  throw new Error("unreachable");
}
