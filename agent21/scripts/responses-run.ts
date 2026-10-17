// Runs a conversation on the Responses engine (lib/agent21/responses) the way
// the website will, without the website, and returns each answer in the shape
// scripts/agent-run.ts gives, so `pnpm bench` and `pnpm evals` compare the two
// engines on the same checks. Data tools run in this process; web search and
// the shell run at OpenAI. Stored responses and uploaded files are deleted
// afterwards unless kept.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ResponseOutputItem } from "openai/resources/responses/responses";
import { openai } from "../lib/agent21/openai";
import { runRounds, type LoopResult } from "../lib/agent21/responses/loop";
import { promptSource } from "../lib/agent21/responses/prompt";
import {
  createParams,
  engineSettings,
  type EngineSettings,
  type Paths,
} from "../lib/agent21/responses/request";
import { harvest, skillRefs } from "../lib/agent21/responses/shell";
import { TOOLS, type ToolContext } from "../lib/agent21/responses/tools";
import { messageText } from "./agent-run";

export type ResponsesOptions = {
  turns: string[];
  files?: string[];
  label: string;
  timeZone?: string;
  model?: string;
  effort?: EngineSettings["effort"];
  tier?: EngineSettings["tier"];
  verbosity?: EngineSettings["verbosity"];
  paths?: Paths;
  promptFile?: string;
  background?: boolean;
  /** The data tools can be called from a model-written program. */
  programmatic?: boolean;
  /** "conversation" (the Conversations API, default) or "chain" (previous_response_id). */
  state?: "conversation" | "chain";
  /** Keep stored responses for inspection. */
  keepSession?: boolean;
  /** Where files the answer saved are written. */
  outDir?: string;
};

const round1 = (ms: number) => Math.round(ms / 100) / 10;
type Item = Record<string, unknown> & { type: string };

/** A round's items in the shapes the evals read (agent-run's trace items). */
export function evalItems(result: LoopResult): Item[] {
  const items: Item[] = [];
  for (const r of result.rounds) {
    const outputs = new Map(
      r.output
        .filter((o) => o.type === "shell_call_output")
        .map((o) => [(o as { call_id: string }).call_id, o]),
    );
    for (const item of r.output as (ResponseOutputItem &
      Record<string, unknown>)[]) {
      if (item.type === "function_call") {
        const run = r.toolRuns.find((t) => t.callId === item.call_id);
        let args: unknown = item.arguments;
        try {
          args = JSON.parse(item.arguments);
        } catch {
          // Kept as sent.
        }
        // A data tool reads like an MCP call: the evals' trace and outbound
        // checks look at its arguments and the URLs it fetched.
        items.push({
          type: "mcp_call",
          server_label: "agent21",
          ...(run?.fromProgram ? { from_program: true } : {}),
          name: item.name,
          arguments: args,
          urls: run?.urls ?? [],
          duration_ms: run?.ms,
          ...(run?.error ? { error: run.error } : {}),
          output: run?.output.slice(0, 6000),
        });
      } else if (item.type === "shell_call") {
        const out = outputs.get(item.call_id as string) as
          | {
              output: {
                stdout: string;
                stderr: string;
                outcome: { type: string; exit_code?: number };
              }[];
            }
          | undefined;
        const commands = (item.action as { commands: string[] }).commands;
        const exit = out?.output.find(
          (o) => o.outcome.type === "exit" && o.outcome.exit_code,
        )?.outcome.exit_code;
        items.push({
          type: "command_execution",
          command: commands.join("\n"),
          exit_code: out ? (exit ?? 0) : null,
          output: out?.output
            .map((o) => o.stdout + o.stderr)
            .join("\n")
            .slice(-6000),
        });
      } else if (item.type === "shell_call_output") {
        continue;
      } else if (item.type === "program") {
        items.push({ type: "program", code: item.code });
      } else if (item.type === "program_output") {
        items.push({
          type: "program_output",
          status: item.status,
          result: String(item.result).slice(0, 6000),
        });
      } else if (item.type === "reasoning") {
        items.push({ type: "reasoning", summary: item.summary });
      } else {
        items.push({ ...item, encrypted_content: undefined });
      }
    }
  }
  return items;
}

async function uploadFiles(paths: string[]) {
  const out = [];
  for (const path of paths) {
    const { id } = await openai().files.create(
      {
        file: new File([readFileSync(path)], basename(path)),
        purpose: "user_data",
      },
      { maxRetries: 0 },
    );
    out.push({ id, name: basename(path) });
  }
  return out;
}

export async function runResponsesConversation(options: ResponsesOptions) {
  const timeZone = options.timeZone ?? "America/New_York";
  const prompt = promptSource(options.promptFile);
  const paths = options.paths ?? "BC";
  const local = new Map((options.files ?? []).map((p) => [basename(p), p]));
  // The shell reads uploads from its container; the data tools read them here.
  const uploaded =
    paths.includes("B") && local.size
      ? await uploadFiles([...local.values()])
      : [];
  const settings = engineSettings({
    prompt,
    paths,
    fileIds: uploaded.map((f) => f.id),
    cacheKey: `bench-${options.label}`,
    metadata: { benchmark: options.label },
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.tier ? { tier: options.tier } : {}),
    ...(options.verbosity ? { verbosity: options.verbosity } : {}),
    ...(options.programmatic !== undefined
      ? { programmatic: options.programmatic }
      : {}),
  });
  const saved = new Map<string, Buffer>();
  const answers = [];
  const responseIds: string[] = [];
  let previous: string | undefined;
  let containerId: string | undefined;
  const state = options.state ?? "conversation";
  // One conversation per chat, as the website would keep one per Agent 21
  // conversation; it is deleted with the responses made in it.
  const conversationId =
    state === "conversation"
      ? (
          await openai().conversations.create({
            metadata: { benchmark: options.label },
          })
        ).id
      : undefined;
  for (const [i, turn] of options.turns.entries()) {
    const fileNote =
      i === 0 && local.size
        ? `Files attached to this message: ${[...local.keys()].join(", ")}${paths.includes("B") ? " (in /mnt/data for the shell)" : ""}.\n`
        : "";
    const context: ToolContext = {
      log: [],
      now: new Date(),
      async saveArtifact(a) {
        saved.set(a.name, a.bytes);
        return a.name;
      },
      uploads: [...local.keys()],
      async readUpload(name) {
        const path = local.get(name);
        return path ? { name, bytes: readFileSync(path) } : null;
      },
    };
    // The container stays with the conversation while it lives.
    const params = createParams(
      containerId ? { ...settings, containerId } : settings,
    );
    const started = Date.now();
    const result = await runRounds({
      client: openai(),
      params,
      input: messageText(turn, timeZone, fileNote),
      ...(conversationId
        ? { conversationId }
        : { previousResponseId: previous }),
      context,
      background: options.background,
      repairBlocks: true,
    });
    previous = result.lastResponseId ?? previous;
    responseIds.push(...result.rounds.map((r) => r.responseId));
    containerId = result.containerIds.at(-1) ?? containerId;
    const items = evalItems(result);
    const toolMs = result.rounds.reduce(
      (sum, r) => sum + Math.max(0, ...r.toolRuns.map((t) => t.ms)),
      0,
    );
    answers.push({
      message: turn,
      ended: `response.${result.status}`,
      ...(result.error ? { error: result.error } : {}),
      totalSeconds: round1(Date.now() - started),
      firstEventSeconds:
        result.rounds[0]?.firstEventMs !== null
          ? round1(result.rounds[0]?.firstEventMs ?? 0)
          : null,
      turnStartedSeconds: 0,
      firstAnswerTextSeconds:
        result.firstTextMs === null ? null : round1(result.firstTextMs),
      environmentReadySeconds: null,
      text: result.text,
      traceFound: true,
      modelCalls: result.rounds.length,
      firstModelCallSeconds: result.rounds[0]
        ? round1(result.rounds[0].endedMs - result.rounds[0].startedMs)
        : null,
      modelSeconds: round1(
        result.rounds.reduce((s, r) => s + (r.endedMs - r.startedMs), 0),
      ),
      toolCalls: result.rounds.reduce((n, r) => n + r.toolRuns.length, 0),
      toolSeconds: round1(toolMs),
      failedTools: result.rounds.reduce(
        (n, r) => n + r.toolRuns.filter((t) => !t.ok).length,
        0,
      ),
      tokens: result.usage,
      rounds: result.rounds.map((r) => ({
        round: r.round,
        responseId: r.responseId,
        status: r.status,
        at: round1(r.startedMs),
        seconds: round1(r.endedMs - r.startedMs),
        firstEventSeconds:
          r.firstEventMs === null ? null : round1(r.firstEventMs - r.startedMs),
        firstTextSeconds:
          r.firstTextMs === null ? null : round1(r.firstTextMs - r.startedMs),
        tokens: r.usage
          ? {
              input: r.usage.input_tokens,
              cached: r.usage.input_tokens_details?.cached_tokens ?? 0,
              output: r.usage.output_tokens,
            }
          : null,
        tools: r.toolRuns.map((t) => ({
          name: t.name,
          ms: t.ms,
          ok: t.ok,
          ...(t.error ? { error: t.error } : {}),
        })),
        hosted: r.output
          .filter(
            (o) => o.type === "web_search_call" || o.type === "shell_call",
          )
          .map((o) => o.type),
        ...(r.repair ? { repair: true } : {}),
      })),
      containerIds: result.containerIds,
      fetched: context.log,
      items,
    });
  }
  if (containerId) {
    for (const file of await harvest(openai(), containerId).catch(() => []))
      saved.set(file.name, file.bytes);
  }
  if (options.outDir && saved.size) {
    mkdirSync(options.outDir, { recursive: true });
    for (const [name, bytes] of saved)
      writeFileSync(join(options.outDir, name), bytes, { mode: 0o600 });
  }
  // Deleting a conversation removes its items but not the responses made in
  // it, which stay retrievable until deleted: both go.
  if (!options.keepSession) {
    if (conversationId)
      await openai()
        .conversations.delete(conversationId)
        .catch(() => undefined);
    await Promise.all(
      responseIds.map((id) =>
        openai()
          .responses.delete(id)
          .catch(() => undefined),
      ),
    );
  }
  for (const file of uploaded)
    await openai()
      .files.delete(file.id)
      .catch(() => undefined);
  return {
    label: options.label,
    engine: "responses" as const,
    overrides: {
      model: settings.model,
      effort: settings.effort,
      tier: settings.tier,
      verbosity: settings.verbosity,
      paths,
      programmatic: Boolean(settings.programmatic),
      github: Boolean(settings.githubToken),
      compactThreshold: settings.compactThreshold,
      state,
      background: Boolean(options.background),
      prompt: prompt.label,
    },
    prewarmReadySeconds: null,
    session: conversationId ?? responseIds[0] ?? null,
    sessionKept: Boolean(options.keepSession),
    files: [...saved.entries()].map(([name, bytes]) => ({
      name,
      bytes: bytes.length,
    })),
    answers,
    spans: [],
  };
}

/** The Responses engine as tested: model, prompt checksum, tools and skills. */
export function responsesSnapshot(
  options: Pick<
    ResponsesOptions,
    | "promptFile"
    | "model"
    | "effort"
    | "verbosity"
    | "tier"
    | "paths"
    | "programmatic"
  >,
) {
  const prompt = promptSource(options.promptFile);
  const settings = engineSettings({
    prompt,
    ...(options.paths ? { paths: options.paths } : {}),
    ...(options.programmatic !== undefined
      ? { programmatic: options.programmatic }
      : {}),
  });
  let websiteCommit: string | null = null;
  try {
    websiteCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout.
  }
  const text = prompt.kind === "file" ? prompt.instructions : "";
  return {
    takenAt: new Date().toISOString(),
    engine: "responses",
    websiteCommit,
    model: options.model ?? settings.model,
    effort: options.effort ?? settings.effort,
    verbosity: options.verbosity ?? settings.verbosity ?? null,
    tier: options.tier ?? settings.tier ?? null,
    paths: settings.paths,
    programmatic: Boolean(settings.programmatic),
    github: Boolean(settings.githubToken),
    compactThreshold: settings.compactThreshold ?? null,
    prompt: prompt.label,
    instructionsChars: text.length,
    instructionsSha256: text
      ? createHash("sha256").update(text).digest("hex")
      : null,
    tools: TOOLS.map((t) => t.name),
    skills: skillRefs(),
  };
}
