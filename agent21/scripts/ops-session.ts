import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/agent21/db";
import { openai } from "../lib/agent21/openai";

/**
 * One conversation, for investigating a slow or wrong answer: where each
 * answer's time went, and the provider's saved items, turns and traces written
 * to a private local file. Reads only; nothing here is stored in the database.
 */

type Span = {
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: { key: string; value: { stringValue?: string } }[];
};
type TracePage = {
  data: { otlp: { resourceSpans: { scopeSpans: { spans: Span[] }[] }[] } }[];
  has_more: boolean;
  last_id?: string;
};

const seconds = (from: Date | number, to: Date | number) =>
  Math.round((Number(to) - Number(from)) / 100) / 10;

async function sessionTraces(session: string) {
  const traces: TracePage["data"] = [];
  let after: string | undefined;
  do {
    const page = (await openai().get(`/agents/sessions/${session}/traces`, {
      query: { limit: 20, order: "asc", ...(after ? { after } : {}) },
      headers: { "OpenAI-Beta": "agents=v1" },
    })) as TracePage;
    traces.push(...page.data);
    after = page.has_more ? page.last_id : undefined;
  } while (after);
  return traces;
}

/** Model and tool time per turn from the trace spans, by turn ID. */
function spanTimes(traces: TracePage["data"]) {
  const byTurn = new Map<string, { model: number; tools: number }>();
  for (const trace of traces)
    for (const resource of trace.otlp.resourceSpans)
      for (const scope of resource.scopeSpans)
        for (const span of scope.spans) {
          const turn = span.attributes?.find(
            (a) => a.key === "openai.managed_agents.turn.id",
          )?.value.stringValue;
          if (!turn) continue;
          const time =
            (Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) /
            1e9;
          const entry = byTurn.get(turn) ?? { model: 0, tools: 0 };
          if (span.name.startsWith("chat")) entry.model += time;
          if (span.name.startsWith("execute_tool")) entry.tools += time;
          byTurn.set(turn, entry);
        }
  return byTurn;
}

export async function sessionReport(conversation: string, outDir: string) {
  const runs = await db()
    .selectFrom("agent21_runs")
    .select([
      "id",
      "state",
      "session_id",
      "turn_id",
      "created_at",
      "finished_at",
    ])
    .where("conversation_id", "=", conversation)
    .orderBy("created_at")
    .execute();
  if (!runs.length) throw new Error(`No runs for conversation ${conversation}`);
  const api = openai();
  const sessions = [
    ...new Set(runs.map((run) => run.session_id).filter(Boolean)),
  ] as string[];
  const exported = [];
  const turns = new Map<
    string,
    { created_at: number; completed_at?: number | null }
  >();
  const spans = new Map<string, { model: number; tools: number }>();
  for (const id of sessions) {
    const session = await api.beta.agents.sessions.retrieve(id);
    const sessionTurns = [];
    for await (const turn of api.beta.agents.sessions.turns.list(id, {
      order: "asc",
    })) {
      sessionTurns.push(turn);
      turns.set(turn.id, turn);
    }
    const items = [];
    for await (const item of api.beta.agents.sessions.items.list(id, {
      order: "asc",
    }))
      items.push(item);
    let traces: TracePage["data"] | { unavailable: string } = [];
    try {
      traces = await sessionTraces(id);
      for (const [turn, time] of spanTimes(traces)) spans.set(turn, time);
    } catch (error) {
      traces = { unavailable: (error as Error).message };
    }
    exported.push({ session, turns: sessionTurns, items, traces });
  }
  const timing = runs.map((run, index) => {
    const turn = run.turn_id ? turns.get(run.turn_id) : undefined;
    const started = turn ? turn.created_at * 1000 : undefined;
    const ended = turn?.completed_at ? turn.completed_at * 1000 : undefined;
    const span = run.turn_id ? spans.get(run.turn_id) : undefined;
    return {
      answer: index + 1,
      state: run.state,
      totalSeconds: run.finished_at
        ? seconds(run.created_at, run.finished_at)
        : null,
      websiteBeforeSeconds: started ? seconds(run.created_at, started) : null,
      modelTurnSeconds: started && ended ? seconds(started, ended) : null,
      thinkingSeconds: span ? Math.round(span.model * 10) / 10 : null,
      toolSeconds: span ? Math.round(span.tools * 10) / 10 : null,
      websiteAfterSeconds:
        ended && run.finished_at ? seconds(ended, run.finished_at) : null,
    };
  });
  mkdirSync(outDir, { recursive: true });
  const file = join(
    outDir,
    `${conversation}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify({ conversation, runs, timing, sessions: exported }, null, 2),
    { mode: 0o600 },
  );
  return { timing, file };
}
