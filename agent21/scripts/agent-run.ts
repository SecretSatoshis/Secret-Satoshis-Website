// Runs a conversation straight against the dashboard agent, the way the website
// starts one (same agent, tools, vault and sandbox) but without the website, and
// returns each answer with its timings, token use and its full trace: reasoning
// summaries, progress notes, every tool call with its input and output, the
// call timeline and the session's events. Overrides
// apply to this session only and merge into the saved agent's settings; the
// saved agent never changes. Used by `pnpm bench` and `pnpm evals`.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { AgentSessionItem } from "openai/resources/beta/agents/agents";
import type { SessionCreateParamsStreaming } from "openai/resources/beta/agents/sessions/sessions";
import {
  hostedEnvironment,
  mcpVaultId,
  openai,
  publicText,
  sessionTools,
  turnItems,
} from "../lib/agent21/openai";

export type Overrides = {
  model?: string;
  effort?: string;
  tier?: string;
  verbosity?: string;
  size?: string;
  bare?: boolean;
  prewarm?: boolean;
};
export type RunOptions = Overrides & {
  /** The user's messages, sent one after another in the same session. */
  turns: string[];
  /** Local files to restore under /workspace/inputs, as the website does. */
  files?: string[];
  label: string;
  timeZone?: string;
  /** Keep the session (and its sandbox until it expires) for later inspection. */
  keepSession?: boolean;
};

type Span = {
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: { key: string; value: Record<string, unknown> }[];
};
type Page = {
  data: { otlp: { resourceSpans: { scopeSpans: { spans: Span[] }[] }[] } }[];
  has_more: boolean;
  last_id?: string;
};
const ENDED = /turn\.(completed|failed|cancelled)$/;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const round = (n: number) => Math.round(n * 10) / 10;
const secs = (ns: string | number | bigint) => Number(ns) / 1e9;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The website's message line: the question, then the time in UTC and locally. */
export function messageText(text: string, timeZone: string, files = "") {
  const now = new Date();
  const utc = now.toISOString().slice(0, 16).replace("T", " ");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${text}\n\n${files}Current time: ${utc} UTC (the user's local time: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}, ${timeZone}).`;
}

async function traces(session: string) {
  const spans: Span[] = [];
  let after: string | undefined;
  do {
    const page = (await openai().get(`/agents/sessions/${session}/traces`, {
      query: { limit: 20, order: "asc", ...(after ? { after } : {}) },
      headers: { "OpenAI-Beta": "agents=v1" },
    })) as Page;
    for (const trace of page.data)
      for (const resource of trace.otlp.resourceSpans)
        for (const scope of resource.scopeSpans) spans.push(...scope.spans);
    after = page.has_more ? page.last_id : undefined;
  } while (after);
  return spans.sort((a, b) =>
    Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)),
  );
}
const attr = (span: Span, key: string) => {
  const found = span.attributes?.find((a) => a.key === key)?.value;
  return found ? Object.values(found)[0] : undefined;
};

/** A sandbox from the template, ready before the question is sent. */
async function prewarmed() {
  const start = Date.now();
  const { id } = await openai().beta.agents.environments.create({
    environment: {
      type: "openai_hosted",
      environment_template_id: process.env.AGENT21_ENVIRONMENT_TEMPLATE_ID!,
    },
    ...(mcpVaultId() ? { vault_ids: [mcpVaultId()!] } : {}),
  });
  for (;;) {
    const { status } = await openai().beta.agents.environments.retrieve(id);
    if (status === "ready") break;
    if (status !== "pending") throw new Error(`Pre-warm ended as ${status}`);
    await sleep(2000);
  }
  return { id, readySeconds: round((Date.now() - start) / 1000) };
}

/** The saved agent's settings with this run's overrides merged in. */
async function agentOverrides(agentId: string, o: Overrides) {
  const saved = await openai().beta.agents.retrieve(agentId);
  return {
    tools: await sessionTools(agentId),
    ...(o.model ? { model: o.model } : {}),
    ...(o.effort
      ? { reasoning: { ...saved.reasoning, effort: o.effort } }
      : {}),
    ...(o.tier ? { service_tier: o.tier } : {}),
    ...(o.verbosity ? { text: { ...saved.text, verbosity: o.verbosity } } : {}),
  };
}

/**
 * A turn's items in full: reasoning summaries, progress notes, the answer and
 * every tool call with its input and output. Only encrypted reasoning, which
 * cannot be read, is dropped.
 */
function fullItems(items: AgentSessionItem[]) {
  return items.map((item) => {
    const copy = { ...(item as unknown as Record<string, unknown>) };
    delete copy.encrypted_content;
    return copy;
  });
}
/** An event without its streamed text: deltas are counted, items kept by reference. */
type Event = { t: number; type: string; [key: string]: unknown };
const DELTA = /\.delta$/;
function keepEvent(event: Record<string, unknown>, t: number): Event {
  const { item, ...rest } = event as { item?: Record<string, unknown> };
  return {
    t,
    ...(rest as { type: string }),
    ...(item
      ? {
          item: {
            id: item.id,
            type: item.type,
            status: item.status,
            ...(item.phase ? { phase: item.phase } : {}),
          },
        }
      : {}),
  };
}

/** Timing and token use for the session's nth turn, read from its traces. */
function turnStats(spans: Span[], index: number) {
  const turnSpan = spans.filter((s) => s.name.startsWith("invoke_agent"))[
    index
  ];
  const start = turnSpan ? BigInt(turnSpan.startTimeUnixNano) : 0n;
  const end = turnSpan ? BigInt(turnSpan.endTimeUnixNano) : 0n;
  const within = (s: Span) =>
    turnSpan &&
    BigInt(s.startTimeUnixNano) >= start &&
    BigInt(s.startTimeUnixNano) <= end;
  const chats = spans.filter((s) => s.name.startsWith("chat") && within(s));
  const tools = spans.filter(
    (s) => s.name.startsWith("execute_tool") && within(s),
  );
  const dur = (s: Span) =>
    secs(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano));
  const usage = (key: string) =>
    turnSpan
      ? Number(attr(turnSpan, `openai.managed_agents.usage.total.${key}`) ?? 0)
      : 0;
  return {
    modelCalls: chats.length,
    firstModelCallSeconds: chats[0] ? round(dur(chats[0])) : null,
    modelSeconds: round(chats.reduce((sum, s) => sum + dur(s), 0)),
    toolCalls: tools.length,
    toolSeconds: round(tools.reduce((sum, s) => sum + dur(s), 0)),
    failedTools: tools.filter((s) =>
      /"exit_code":\s*"?[1-9]/.test(
        String(attr(s, "gen_ai.tool.call.result") ?? ""),
      ),
    ).length,
    tokens: {
      input: usage("input_tokens"),
      cached: usage("cache_read.input_tokens"),
      output: usage("output_tokens"),
      reasoning: usage("reasoning.output_tokens"),
    },
    calls: [...chats, ...tools].map((s) => ({
      at: round(secs(BigInt(s.startTimeUnixNano) - start)),
      seconds: round(dur(s)),
      kind: s.name.startsWith("chat")
        ? "model"
        : String(attr(s, "gen_ai.tool.name") ?? "tool"),
      ...(s.name.startsWith("execute_tool")
        ? {
            arguments: attr(s, "gen_ai.tool.call.arguments"),
            result: attr(s, "gen_ai.tool.call.result"),
          }
        : {}),
    })),
  };
}

/** Uploads local files and lists them for the sandbox and the message. */
async function inputFiles(paths: string[]) {
  const files = [];
  for (const [i, path] of paths.entries()) {
    const name = basename(path);
    const { id } = await openai().files.create(
      {
        file: new File([readFileSync(path)], name),
        purpose: "user_data",
      },
      { maxRetries: 0 },
    );
    files.push({ id, name, path: `/workspace/inputs/eval-${i + 1}/${name}` });
  }
  return files;
}

export async function runConversation(options: RunOptions) {
  const agentId = process.env.AGENT21_AGENT_ID!;
  const timeZone = options.timeZone ?? "America/New_York";
  const warm = options.prewarm ? await prewarmed() : undefined;
  const files = await inputFiles(options.files ?? []);
  const fileNote = files.length
    ? `Files selected for this message: ${files.map((f) => f.path).join(", ")}.\nFiles from this conversation are restored under /workspace/inputs.\n`
    : "";
  const environment = warm
    ? { type: "openai_hosted", environment_id: warm.id }
    : {
        // --bare: a hosted sandbox without the template (no packages or
        // skills), to time the template's own start-up cost.
        ...(options.bare
          ? { type: "openai_hosted", container_size: "small" }
          : hostedEnvironment(
              process.env.AGENT21_ENVIRONMENT_TEMPLATE_ID!,
              files.map((f) => ({
                type: "file_id" as const,
                file_id: f.id,
                path: f.path,
              })),
            )),
        ...(options.size ? { container_size: options.size } : {}),
      };
  const body = {
    agent_id: agentId,
    agent: await agentOverrides(agentId, options),
    ...(mcpVaultId() ? { vault_ids: [mcpVaultId()!] } : {}),
    environment,
    input: messageText(options.turns[0], timeZone, fileNote),
    metadata: { benchmark: options.label },
    stream: true,
  } as unknown as SessionCreateParamsStreaming;

  const t0 = Date.now();
  const at = () => round((Date.now() - t0) / 1000);
  const events: Event[] = [];
  let deltas = 0;
  let session: string | undefined;
  let firstText: number | undefined;
  let ended: string | undefined;
  const stream = await openai().beta.agents.sessions.create(body);
  for await (const event of stream) {
    const e = event as {
      type: string;
      session_id?: string;
      session?: { id?: string };
      item?: { type?: string };
    };
    session ??= e.session_id ?? e.session?.id;
    if (e.type === "agent.session.turn.output_text.delta") firstText ??= at();
    if (DELTA.test(e.type)) {
      deltas++;
      continue;
    }
    events.push(keepEvent(e as unknown as Record<string, unknown>, at()));
    if (ENDED.test(e.type)) {
      ended = e.type;
      break;
    }
  }
  if (!session) throw new Error("The session did not start");
  const firstTotal = at();
  type TurnLog = {
    message: string;
    ended: string | undefined;
    totalSeconds: number;
    firstEventSeconds: number | null;
    turnStartedSeconds: number | null;
    firstAnswerTextSeconds: number | null;
    environmentReadySeconds: number | null;
    events: Event[];
    deltas: number;
  };
  const turnLog: TurnLog[] = [
    {
      message: options.turns[0],
      ended,
      totalSeconds: firstTotal,
      firstEventSeconds: events[0]?.t ?? null,
      turnStartedSeconds:
        events.find((e) => e.type.endsWith("turn.created"))?.t ?? null,
      firstAnswerTextSeconds: firstText ?? null,
      environmentReadySeconds:
        events.find((e) => e.type.endsWith("environment.ready"))?.t ?? null,
      events,
      deltas,
    },
  ];

  // Follow-ups go to the same session, as the website sends them.
  for (const message of options.turns.slice(1)) {
    const prior = new Set(
      (
        await openai().beta.agents.sessions.turns.list(session, { limit: 20 })
      ).data.map((t) => t.id),
    );
    const sent = Date.now();
    const since = () => round((Date.now() - sent) / 1000);
    // The session's events while the reply runs. A new subscription replays the
    // current turn from its start; events of earlier turns are left out.
    const followEvents: Event[] = [];
    let followDeltas = 0;
    let followText: number | undefined;
    const listening = new AbortController();
    const listen = openai()
      .beta.agents.sessions.events.stream(session, {
        signal: listening.signal,
      })
      .then(async (events) => {
        for await (const event of events) {
          const e = event as unknown as Record<string, unknown> & {
            type: string;
            turn_id?: string;
            turn?: { id?: string };
          };
          const turn = e.turn_id ?? e.turn?.id;
          if (turn && prior.has(turn)) continue;
          if (e.type === "agent.session.turn.output_text.delta")
            followText ??= since();
          if (DELTA.test(e.type)) followDeltas++;
          else followEvents.push(keepEvent(e, since()));
        }
      })
      .catch(() => undefined);
    await openai().beta.agents.sessions.events.create(session, {
      events: [
        {
          type: "agent.session.input.message",
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: messageText(message, timeZone) },
              ],
            },
          ],
        },
      ],
    } as never);
    let status = "unknown";
    for (let i = 0; i < 300; i++) {
      await sleep(2000);
      const turn = (
        await openai().beta.agents.sessions.turns.list(session, { limit: 20 })
      ).data.find((t) => !prior.has(t.id) && !t.subagent_id);
      if (turn && TERMINAL.has(turn.status)) {
        status = turn.status;
        break;
      }
    }
    // Let the last events arrive before closing the subscription.
    await sleep(3000);
    listening.abort();
    await listen;
    turnLog.push({
      message,
      ended: `agent.session.turn.${status}`,
      totalSeconds: since(),
      firstEventSeconds: followEvents[0]?.t ?? null,
      turnStartedSeconds:
        followEvents.find((e) => e.type.endsWith("turn.created"))?.t ?? null,
      firstAnswerTextSeconds: followText ?? null,
      environmentReadySeconds: null,
      events: followEvents,
      deltas: followDeltas,
    });
  }

  // Traces appear a few seconds after the turn ends.
  let spans: Span[] = [];
  for (let i = 0; i < 8; i++) {
    spans = await traces(session).catch(() => []);
    const done = spans.filter((s) => s.name.startsWith("invoke_agent"));
    if (done.length >= options.turns.length) break;
    await sleep(3000);
  }
  const turns = (
    await openai().beta.agents.sessions.turns.list(session, {
      order: "asc",
      limit: 20,
    })
  ).data.filter((t) => !t.subagent_id);
  const answers = [];
  for (const [i, log] of turnLog.entries()) {
    const turn = turns[i];
    const items = turn ? await turnItems(session, turn.id) : [];
    answers.push({
      ...log,
      turnId: turn?.id ?? null,
      text: publicText(items),
      ...turnStats(spans, i),
      items: fullItems(items),
    });
  }
  if (!options.keepSession)
    await openai()
      .beta.agents.sessions.delete(session)
      .catch(() => undefined);
  for (const file of files)
    await openai()
      .files.delete(file.id)
      .catch(() => undefined);
  return {
    label: options.label,
    overrides: {
      model: options.model,
      effort: options.effort,
      tier: options.tier,
      verbosity: options.verbosity,
      size: options.size,
      prewarm: options.prewarm,
    },
    prewarmReadySeconds: warm?.readySeconds ?? null,
    session,
    sessionKept: Boolean(options.keepSession),
    answers,
    spans,
  };
}

/**
 * The dashboard agent as tested: its settings, prompt, tools, skill versions
 * and sandbox template, so a result can be tied to the setup that produced it.
 */
export async function agentSnapshot() {
  const agentId = process.env.AGENT21_AGENT_ID!;
  const templateId = process.env.AGENT21_ENVIRONMENT_TEMPLATE_ID!;
  const agent = await openai().beta.agents.retrieve(agentId);
  const skills = [];
  for await (const skill of openai().skills.list())
    if (skill.name.startsWith("agent21-"))
      skills.push({
        name: skill.name,
        id: skill.id,
        defaultVersion: skill.default_version,
        latestVersion: skill.latest_version,
      });
  const template = await openai()
    .beta.agents.environments.templates.retrieve(templateId)
    .catch(() => null);
  let websiteCommit: string | null = null;
  try {
    websiteCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout.
  }
  return {
    takenAt: new Date().toISOString(),
    runtimeLabel: process.env.AGENT21_RUNTIME_VERSION ?? null,
    websiteCommit,
    agent: {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      reasoning: agent.reasoning,
      text: agent.text,
      serviceTier: agent.service_tier,
      instructionsChars: agent.instructions?.length ?? 0,
      instructionsSha256: createHash("sha256")
        .update(agent.instructions ?? "")
        .digest("hex"),
      tools: agent.tools,
    },
    skills,
    template,
    instructions: agent.instructions,
  };
}
