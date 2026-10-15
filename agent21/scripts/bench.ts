// Times one question straight against the dashboard agent, the way the website
// starts a conversation (same agent, tools, vault and sandbox size) but without
// the website, so agent time can be told apart from website time. Optional
// overrides apply to the benchmark session only, never the saved agent.
//
//   pnpm bench "What is Bitcoin's block height?" [--model gpt-6.1-sol]
//     [--effort low|medium|high] [--tier auto|default|flex] [--size small|medium]
//     [--bare] [--prewarm] [--repeat 3] [--label x]
//
// --prewarm starts a sandbox from the template first, waits until it is ready
// (as if the user were still writing) and attaches it, so the timings start
// with a warm sandbox. Pre-warmed sandboxes take no size and run as medium.
//
// Writes the event timeline, per-call model times and token use to
// .exports/bench-*.json (git-ignored) and deletes each benchmark session.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { SessionCreateParamsStreaming } from "openai/resources/beta/agents/sessions/sessions";
import {
  hostedEnvironment,
  mcpVaultId,
  openai,
  sessionTools,
} from "../lib/agent21/openai";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string" },
    effort: { type: "string" },
    tier: { type: "string" },
    size: { type: "string" },
    bare: { type: "boolean", default: false },
    prewarm: { type: "boolean", default: false },
    repeat: { type: "string", default: "1" },
    label: { type: "string", default: "baseline" },
    "time-zone": { type: "string", default: "America/New_York" },
  },
});
const question = positionals.join(" ").trim();
if (!question) {
  console.error(
    'Usage: pnpm bench "<question>" [--model m] [--effort e] [--tier t] [--repeat n] [--label x]',
  );
  process.exit(1);
}

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

/** The website's message line: the question, then the time in UTC and locally. */
function messageText(text: string, timeZone: string) {
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
  return `${text}\n\nCurrent time: ${utc} UTC (the user's local time: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}, ${timeZone}).`;
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
const secs = (ns: string | number | bigint) => Number(ns) / 1e9;
const round = (n: number) => Math.round(n * 10) / 10;

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
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { id, readySeconds: round((Date.now() - start) / 1000) };
}

async function once(run: number) {
  const agentId = process.env.AGENT21_AGENT_ID!;
  const warm = values.prewarm ? await prewarmed() : undefined;
  const overrides = {
    tools: await sessionTools(agentId),
    ...(values.model ? { model: values.model } : {}),
    ...(values.effort ? { reasoning: { effort: values.effort } } : {}),
    ...(values.tier ? { service_tier: values.tier } : {}),
  };
  const body = {
    agent_id: agentId,
    agent: overrides,
    ...(mcpVaultId() ? { vault_ids: [mcpVaultId()!] } : {}),
    // --bare: a hosted sandbox without the template (no packages or skills),
    // to time the template's own start-up cost.
    environment: warm
      ? { type: "openai_hosted", environment_id: warm.id }
      : {
          ...(values.bare
            ? { type: "openai_hosted", container_size: "small" }
            : hostedEnvironment(process.env.AGENT21_ENVIRONMENT_TEMPLATE_ID!)),
          ...(values.size ? { container_size: values.size } : {}),
        },
    input: messageText(question, values["time-zone"]!),
    metadata: { benchmark: values.label! },
    stream: true,
  } as unknown as SessionCreateParamsStreaming;
  const t0 = Date.now();
  const at = () => round((Date.now() - t0) / 1000);
  const events: { t: number; type: string; item?: string }[] = [];
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
    if (e.type === "agent.session.turn.output_text.delta") {
      firstText ??= at();
      continue;
    }
    events.push({
      t: at(),
      type: e.type,
      ...(e.item?.type ? { item: e.item.type } : {}),
    });
    if (/turn\.(completed|failed|cancelled)$/.test(e.type)) {
      ended = e.type;
      break;
    }
  }
  const total = at();
  // Traces appear a few seconds after the turn ends.
  let spans: Span[] = [];
  for (let i = 0; session && i < 8; i++) {
    spans = await traces(session).catch(() => []);
    if (spans.some((s) => s.name.startsWith("invoke_agent"))) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const chats = spans.filter((s) => s.name.startsWith("chat"));
  const tools = spans.filter((s) => s.name.startsWith("execute_tool"));
  const turnSpan = spans.find((s) => s.name.startsWith("invoke_agent"));
  const usage = (key: string) =>
    turnSpan
      ? Number(attr(turnSpan, `openai.managed_agents.usage.total.${key}`) ?? 0)
      : 0;
  const dur = (s: Span) =>
    secs(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano));
  const turnStart = turnSpan ? secs(turnSpan.startTimeUnixNano) : 0;
  const result = {
    run,
    label: values.label,
    overrides: {
      model: values.model,
      effort: values.effort,
      tier: values.tier,
      size: values.size,
      prewarm: values.prewarm,
    },
    prewarmReadySeconds: warm?.readySeconds ?? null,
    session,
    ended,
    totalSeconds: total,
    firstEventSeconds: events[0]?.t ?? null,
    turnStartedSeconds:
      events.find((e) => e.type.endsWith("turn.created"))?.t ?? null,
    firstAnswerTextSeconds: firstText ?? null,
    environmentReadySeconds:
      events.find((e) => e.type.endsWith("environment.ready"))?.t ?? null,
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
    calls: [...chats, ...tools]
      .sort((a, b) =>
        Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)),
      )
      .map((s) => ({
        at: round(secs(s.startTimeUnixNano) - turnStart),
        seconds: round(dur(s)),
        kind: s.name.startsWith("chat")
          ? "model"
          : String(attr(s, "gen_ai.tool.name") ?? "tool"),
        ...(s.name.startsWith("execute_tool")
          ? {
              result: String(attr(s, "gen_ai.tool.call.result") ?? "").slice(
                0,
                2000,
              ),
            }
          : {}),
      })),
    events,
  };
  if (session)
    await openai()
      .beta.agents.sessions.delete(session)
      .catch(() => undefined);
  return result;
}

const results = [];
for (let i = 1; i <= Number(values.repeat); i++) {
  const r = await once(i);
  results.push(r);
  console.log(
    `[${r.label} #${i}] ${r.ended ?? "no end"} · ${r.prewarmReadySeconds !== null ? `pre-warmed in ${r.prewarmReadySeconds}s · ` : ""}total ${r.totalSeconds}s · session ${r.firstEventSeconds}s · sandbox ready ${r.environmentReadySeconds}s · first answer text ${r.firstAnswerTextSeconds}s · ` +
      `model ${r.modelSeconds}s in ${r.modelCalls} calls (first ${r.firstModelCallSeconds}s) · tools ${r.toolSeconds}s in ${r.toolCalls} (${r.failedTools} failed) · ` +
      `tokens in ${r.tokens.input} (cached ${r.tokens.cached}) out ${r.tokens.output} (reasoning ${r.tokens.reasoning})`,
  );
}
mkdirSync(".exports", { recursive: true });
const file = `.exports/bench-${values.label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ question, results }, null, 2), {
  mode: 0o600,
});
console.log(`Saved ${file}`);
