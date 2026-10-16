// Runs test cases straight against the dashboard agent and checks each answer.
// The cases file is JSON: { cases: [{ id, title, core, turns, files?, expect,
// notes? }] }, with file paths relative to it. Overrides apply to the test
// sessions only, never the saved agent.
//
//   pnpm evals <cases.json> [--core] [--only SS-1,BRK-2] [--variant baseline]
//     [--model m] [--effort e] [--tier t] [--verbosity v] [--size s] [--prewarm]
//     [--repeat 2] [--concurrency 3] [--keep-sessions]
//   pnpm evals compare <run-a.json> <run-b.json> [...]
//   pnpm evals report <run.json> [...] [--compare <compare prefix>] [--reconcile]
//
// A run writes .exports/evals-<variant>-<time>.json (every answer with its
// timings, tokens, estimated cost, check results and steps), a review sheet
// beside it (.md) with each answer in its plain-text form and how it worked, a
// scores file (.csv) to fill in, the agent as tested (-agent.json: settings,
// prompt, tools, skill versions, template) and one full trace per conversation
// (-traces/<case>-<repeat>.json: reasoning summaries, progress notes, every
// tool call with its input and output, the call timeline, events and spans).
// --keep-sessions leaves the sessions on OpenAI instead of deleting them. `compare` writes one sheet with the variants side by side under
// hidden labels, its own scores file and the key separately. `report` joins the
// scores with time and estimated cost per variant and per case; --reconcile
// sets the estimates against OpenAI's actual charges for the days of the runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { extractBlocks, parseBlock, plainAnswer } from "../lib/agent21/blocks";
import { agentSnapshot, runConversation, type Overrides } from "./agent-run";
import { dailyCosts } from "./costs";

export type Expect = {
  /** Built on data: a step block first and a sources block last. */
  data?: boolean;
  /** Block types that must appear. */
  blocks?: string[];
  /** Groups of block types, at least one from each. */
  blocksAnyOf?: string[][];
  mustInclude?: string[];
  mustNotInclude?: string[];
  /** Hosts or URLs the trace must show were read. */
  mustFetch?: string[];
  /** Text that must not leave the sandbox in a request or search. */
  mustNotSend?: string[];
  maxWords?: number;
};
type Case = {
  id: string;
  title: string;
  core?: boolean;
  turns: string[];
  files?: string[];
  expect: Expect;
  notes?: string;
};
type Item = Record<string, unknown> & { type?: string };
export type Check = { check: string; ok: boolean; detail?: string };

// USD per million tokens (October 2026). "auto" is priced as standard. Almost
// all uncached input is billed as cache writes (OpenAI's charges show plain
// input at 1-2% of it), so uncached input is priced at the cache-write rate.
const PRICES: Record<
  string,
  Record<
    "standard" | "flex",
    { cacheWrite: number; cached: number; output: number }
  >
> = {
  "gpt-6-luna": {
    standard: { cacheWrite: 0.125, cached: 0.01, output: 0.5 },
    flex: { cacheWrite: 0.0625, cached: 0.005, output: 0.25 },
  },
  "gpt-6.1-sol": {
    standard: { cacheWrite: 2.5, cached: 0.1, output: 10 },
    flex: { cacheWrite: 1.25, cached: 0.05, output: 5 },
  },
};
// USD per minute, billed by the minute with a five-minute minimum.
const SANDBOX = { small: 0.03 / 20, medium: 0.12 / 20 };
// USD per web search call; its content tokens are already in the token counts.
const SEARCH_USD = 10 / 1000;

const FENCED = /```[\s\S]*?```/g;
const prose = (text: string) => text.replace(FENCED, " ");
const words = (text: string) =>
  prose(text)
    .split(/\s+/)
    .filter((w) => /\w/.test(w)).length;
const VISUAL = new Set(["figures", "facts", "table", "ladder", "chart"]);

/** Everything the agent sent out: URLs in its code, searches and MCP calls. */
function outbound(items: Item[]) {
  const sent: string[] = [];
  for (const item of items) {
    if (item.type === "command_execution")
      sent.push(
        ...(String(item.command ?? "").match(/https?:\/\/[^\s'"`)]+/g) ?? []),
      );
    if (item.type === "web_search_call" || item.type === "mcp_call")
      sent.push(
        JSON.stringify({ ...item, output: undefined, result: undefined }),
      );
  }
  return sent.join("\n");
}
/** Everything the trace shows was read: code, its output, searches, MCP calls. */
const readTrace = (items: Item[]) =>
  items
    .filter((item) => item.type !== "message")
    .map((item) => JSON.stringify(item))
    .join("\n");

/** The automatic checks for one answer; `last` applies the case's expectations. */
export function checkAnswer(
  text: string,
  items: Item[],
  expect: Expect,
  last = true,
): Check[] {
  const checks: Check[] = [];
  const found = extractBlocks(text).map((b) => ({
    ...b,
    parsed: parseBlock(b.language, b.code),
  }));
  const broken = found.filter((b) => !b.parsed.ok);
  checks.push({
    check: "blocks draw",
    ok: !broken.length,
    detail: broken
      .map((b) => `${b.language}: ${b.parsed.ok ? "" : b.parsed.reason}`)
      .join("; "),
  });
  const types = found.map((b) => b.language.replace(/^a21-/, ""));
  const visuals = types.filter((t) => VISUAL.has(t)).length;
  checks.push({
    check: "at most four visuals",
    ok: visuals <= 4,
    detail: `${visuals}`,
  });
  const body = prose(text);
  const slips = [
    [/\b\d{4}-\d{2}-\d{2}\b/, "ISO date in text"],
    [
      /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.\s/,
      "abbreviated month with a period",
    ],
    [/\b\d+\.\d*0\s*BTC\b/, "BTC with trailing zeros"],
  ] as const;
  for (const [pattern, name] of slips) {
    const match = body.match(pattern);
    checks.push({ check: `no ${name}`, ok: !match, detail: match?.[0] });
  }
  const failed = items.filter(
    (i) =>
      i.type === "command_execution" &&
      i.exit_code !== undefined &&
      i.exit_code !== null &&
      i.exit_code !== 0,
  ).length;
  checks.push({
    check: "no failed code runs",
    ok: !failed,
    detail: `${failed}`,
  });
  if (!last) return checks;

  if (expect.data) {
    checks.push({
      check: "step first, sources last",
      ok: types[0] === "step" && types.at(-1) === "sources",
      detail: types.join(", ") || "no blocks",
    });
  }
  for (const type of expect.blocks ?? [])
    checks.push({ check: `has ${type}`, ok: types.includes(type) });
  for (const group of expect.blocksAnyOf ?? [])
    checks.push({
      check: `has ${group.join(" or ")}`,
      ok: group.some((t) => types.includes(t)),
    });
  for (const value of expect.mustInclude ?? [])
    checks.push({ check: `includes "${value}"`, ok: text.includes(value) });
  for (const value of expect.mustNotInclude ?? [])
    checks.push({ check: `leaves out "${value}"`, ok: !text.includes(value) });
  const read = readTrace(items);
  for (const host of expect.mustFetch ?? [])
    checks.push({ check: `read ${host}`, ok: read.includes(host) });
  const sent = outbound(items);
  for (const value of expect.mustNotSend ?? [])
    checks.push({ check: `never sent "${value}"`, ok: !sent.includes(value) });
  if (expect.maxWords) {
    const n = words(text);
    checks.push({
      check: `at most ${expect.maxWords} words`,
      ok: n <= expect.maxWords,
      detail: `${n}`,
    });
  }
  return checks;
}

type Tokens = { input: number; cached: number; output: number };
/** Web searches the agent ran, each billed as one call. */
export const countSearches = (items: Item[]) =>
  items.filter((item) => item.type === "web_search_call").length;
const oneLine = (text: unknown, max = 240) => {
  const line = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
/** The code itself: without the shell wrapper or the import lines every run starts with. */
const codeOf = (command: unknown) =>
  String(command ?? "")
    .replace(/^\/bin\/(ba)?sh -lc "?(python3? - <<'?PY'?\n)?/, "")
    .replace(/\n?PY"?\s*$/, "")
    .split("\n")
    .filter((line) => !/^\s*(import |from \S+ import |sys\.path)/.test(line))
    .join("\n");
const messageText = (item: Item) =>
  Array.isArray(item.content)
    ? (item.content as { text?: string }[]).map((p) => p.text ?? "").join(" ")
    : "";
/**
 * How the agent worked, step by step and in order: its reasoning summaries,
 * progress notes and tool calls. The full inputs and outputs are in the trace.
 */
export function steps(items: Item[]) {
  const out: string[] = [];
  for (const item of items) {
    if (item.type === "reasoning") {
      const summary = ((item.summary as { text?: string }[]) ?? [])
        .map((s) => s.text ?? "")
        .join(" ");
      if (summary.trim())
        out.push(`Thought: ${oneLine(summary.replace(/\*\*/g, ""), 600)}`);
    } else if (item.type === "message" && item.role === "assistant") {
      if (item.phase === "commentary")
        out.push(`Note: ${oneLine(messageText(item))}`);
    } else if (item.type === "command_execution") {
      const secs =
        typeof item.duration_ms === "number"
          ? `, ${Math.round(item.duration_ms / 100) / 10}s`
          : "";
      out.push(
        `Ran code (exit ${item.exit_code ?? "?"}${secs}): ${oneLine(codeOf(item.command), 160)}`,
      );
      if (item.exit_code && item.output)
        out.push(`  Error: ${oneLine(String(item.output).slice(-400), 300)}`);
    } else if (item.type === "web_search_call") {
      const action = (item.action ?? {}) as {
        query?: string | null;
        queries?: string[];
        url?: string;
        type?: string;
      };
      out.push(
        `Searched the web: ${oneLine(action.query ?? action.queries?.join(" | ") ?? action.url ?? action.type)}`,
      );
    } else if (item.type === "mcp_call") {
      out.push(
        `Called ${item.server_label}.${item.name}${item.error ? " (failed)" : ""}: ${oneLine(JSON.stringify(item.arguments ?? {}), 160)}`,
      );
    }
  }
  return out;
}

/**
 * An estimate from token use, web searches and sandbox minutes; OpenAI's Costs
 * page is the record.
 */
export function estimateCost(
  tokens: Tokens,
  seconds: number,
  o: Overrides,
  model: string,
  searches = 0,
) {
  const price =
    PRICES[o.model ?? model]?.[o.tier === "flex" ? "flex" : "standard"];
  const modelUsd = price
    ? ((tokens.input - tokens.cached) * price.cacheWrite +
        tokens.cached * price.cached +
        tokens.output * price.output) /
      1e6
    : NaN;
  const size = o.prewarm || o.size === "medium" ? "medium" : "small";
  const sandboxUsd = Math.max(5, seconds / 60) * SANDBOX[size];
  const searchUsd = searches * SEARCH_USD;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    modelUsd: round(modelUsd),
    searchUsd: round(searchUsd),
    sandboxUsd: round(sandboxUsd),
    totalUsd: round(modelUsd + searchUsd + sandboxUsd),
  };
}

async function pool<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await run(items[i]);
      }
    }),
  );
  return results;
}
const median = (values: number[]) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2
    ? v[mid]
    : Math.round(((v[mid - 1] + v[mid]) / 2) * 10) / 10;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

type Record_ = {
  id: string;
  title: string;
  repeat: number;
  turns: string[];
  notes?: string;
  error?: string;
  answers?: {
    text: string;
    ended?: string;
    totalSeconds: number;
    modelSeconds: number;
    modelCalls: number;
    tokens: Tokens & { reasoning: number };
    checks: Check[];
    searches?: number;
    steps?: string[];
    /** False when the turn's timeline (and so its tokens) was not published. */
    traceFound?: boolean;
    /** Only in older runs; newer runs keep items in the trace file. */
    items?: Item[];
  }[];
  /** The conversation's full trace file, relative to the run's JSON. */
  trace?: string;
  session?: string;
  passedChecks?: boolean;
  totalSeconds?: number;
  modelSeconds?: number;
  searches?: number;
  cost?: ReturnType<typeof estimateCost>;
};
type Summary = {
  variant: string;
  overrides: Overrides;
  model: string;
  agent?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
};
type Run = { summary: Summary; records: Record_[] };

/** One conversation's estimated cost, recomputed from its saved tokens and trace. */
function recordCost(record: Record_, summary: Summary) {
  if (!record.answers) return undefined;
  const tokens = record.answers.reduce(
    (t, a) => ({
      input: t.input + a.tokens.input,
      cached: t.cached + a.tokens.cached,
      output: t.output + a.tokens.output,
    }),
    { input: 0, cached: 0, output: 0 },
  );
  const seconds = record.answers.reduce((s, a) => s + a.totalSeconds, 0);
  return estimateCost(
    tokens,
    seconds,
    summary.overrides,
    summary.model,
    record.answers.reduce(
      (n, a) => n + (a.searches ?? countSearches(a.items ?? [])),
      0,
    ),
  );
}

async function runCases(
  file: string,
  values: Record<string, string | boolean | undefined>,
) {
  const base = dirname(resolve(file));
  const { cases } = JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] };
  const only = String(values.only ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const chosen = cases.filter(
    (c) => (!values.core || c.core) && (!only.length || only.includes(c.id)),
  );
  if (!chosen.length) throw new Error("No cases match");
  const overrides: Overrides = {
    model: values.model as string | undefined,
    effort: values.effort as string | undefined,
    tier: values.tier as string | undefined,
    verbosity: values.verbosity as string | undefined,
    size: values.size as string | undefined,
    prewarm: Boolean(values.prewarm),
  };
  const variant = String(values.variant ?? "baseline");
  const repeat = Number(values.repeat ?? 1);
  const jobs = chosen.flatMap((c) =>
    Array.from({ length: repeat }, (_, i) => ({ c, repeat: i + 1 })),
  );
  console.log(
    `Running ${chosen.length} cases × ${repeat} (${jobs.length} conversations) as "${variant}", ${Number(values.concurrency ?? 3)} at a time.`,
  );
  const startedAt = new Date().toISOString();
  mkdirSync(".exports", { recursive: true });
  const out = `.exports/evals-${variant}-${stamp()}`;
  mkdirSync(`${out}-traces`, { recursive: true });
  // The agent as tested, so results can be tied to its exact setup.
  const snapshot = await agentSnapshot();
  writeFileSync(`${out}-agent.json`, JSON.stringify(snapshot, null, 2), {
    mode: 0o600,
  });
  const savedModel = snapshot.agent.model;
  const agentSummary = {
    model: overrides.model ?? snapshot.agent.model,
    effort: overrides.effort ?? snapshot.agent.reasoning?.effort,
    verbosity: overrides.verbosity ?? snapshot.agent.text?.verbosity,
    serviceTier: overrides.tier ?? snapshot.agent.serviceTier,
    instructionsSha256: snapshot.agent.instructionsSha256,
    instructionsChars: snapshot.agent.instructionsChars,
    skills: Object.fromEntries(
      snapshot.skills.map((s) => [s.name, s.defaultVersion]),
    ),
    runtimeLabel: snapshot.runtimeLabel,
    websiteCommit: snapshot.websiteCommit,
  };
  const records = await pool(
    jobs,
    Number(values.concurrency ?? 3),
    async ({ c, repeat: r }) => {
      const record: Record_ = {
        id: c.id,
        title: c.title,
        repeat: r,
        turns: c.turns,
        notes: c.notes,
      };
      try {
        const run = await runConversation({
          ...overrides,
          turns: c.turns,
          files: (c.files ?? []).map((f) => resolve(base, f)),
          label: `eval-${variant}-${c.id}`,
          keepSession: Boolean(values["keep-sessions"]),
        });
        // The full trace stays out of the run's JSON, one file per conversation.
        const trace = `${out}-traces/${c.id}-${r}.json`;
        writeFileSync(
          trace,
          JSON.stringify({ case: c.id, repeat: r, variant, ...run }, null, 2),
          { mode: 0o600 },
        );
        record.trace = `${basename(out)}-traces/${c.id}-${r}.json`;
        record.session = run.session;
        record.answers = run.answers.map((a, i) => ({
          text: a.text,
          ended: a.ended,
          totalSeconds: a.totalSeconds,
          modelSeconds: a.modelSeconds,
          modelCalls: a.modelCalls,
          tokens: a.tokens,
          traceFound: a.traceFound,
          searches: countSearches(a.items as Item[]),
          steps: steps(a.items as Item[]),
          checks: checkAnswer(
            a.text,
            a.items as Item[],
            c.expect,
            i === run.answers.length - 1,
          ),
        }));
        record.passedChecks = record.answers.every(
          (a) => a.ended?.endsWith("completed") && a.checks.every((k) => k.ok),
        );
        record.totalSeconds =
          Math.round(
            record.answers.reduce((s, a) => s + a.totalSeconds, 0) * 10,
          ) / 10;
        record.modelSeconds =
          Math.round(
            record.answers.reduce((s, a) => s + a.modelSeconds, 0) * 10,
          ) / 10;
        record.searches = record.answers.reduce(
          (n, a) => n + (a.searches ?? 0),
          0,
        );
        record.cost = recordCost(record, {
          variant,
          overrides,
          model: savedModel,
        });
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
      }
      const failed =
        record.answers?.flatMap((a) => a.checks.filter((k) => !k.ok)) ?? [];
      console.log(
        `${c.id.padEnd(6)} #${r} ${record.error ? `error: ${record.error}` : `${record.passedChecks ? "checks pass" : `${failed.length} check(s) failed`} · ${record.totalSeconds}s (model ${record.modelSeconds}s) · $${record.cost?.totalUsd}`}`,
      );
      return record;
    },
  );

  const done = records.filter((r) => !r.error);
  const summary = {
    variant,
    overrides,
    model: savedModel,
    agent: agentSummary,
    startedAt,
    finishedAt: new Date().toISOString(),
    conversations: records.length,
    errors: records.length - done.length,
    passedChecks: done.filter((r) => r.passedChecks).length,
    medianSeconds: median(done.map((r) => r.totalSeconds!)),
    medianModelSeconds: median(done.map((r) => r.modelSeconds!)),
    medianWords: median(done.map((r) => words(r.answers!.at(-1)!.text))),
    searches: done.reduce((s, r) => s + (r.searches ?? 0), 0),
    totalUsd:
      Math.round(done.reduce((s, r) => s + (r.cost?.totalUsd ?? 0), 0) * 100) /
      100,
  };
  writeFileSync(`${out}.json`, JSON.stringify({ summary, records }, null, 2), {
    mode: 0o600,
  });
  writeFileSync(`${out}.md`, reviewSheet(summary, records), { mode: 0o600 });
  writeFileSync(
    `${out}-scores.csv`,
    scoresTemplate(records.map((r) => [r.id, r.repeat])),
    { mode: 0o600 },
  );
  console.log(summary);
  console.log(
    `Saved ${out}.json, ${out}.md, ${out}-scores.csv, ${out}-agent.json and ${records.length} traces in ${out}-traces/`,
  );
}

function answerSection(record: Record_) {
  if (record.error) return `_Error: ${record.error}_\n`;
  return record
    .answers!.map((a, i) => {
      const failed = a.checks.filter((k) => !k.ok);
      return [
        record.turns.length > 1
          ? `**Message ${i + 1}:** ${record.turns[i]}\n`
          : "",
        `${a.totalSeconds}s · model ${a.modelSeconds}s in ${a.modelCalls} calls · ${a.tokens.input} tokens in (${a.tokens.cached} cached), ${a.tokens.output} out · ${a.searches ?? countSearches(a.items ?? [])} web searches`,
        failed.length
          ? `Checks failed: ${failed.map((k) => `${k.check}${k.detail ? ` (${k.detail})` : ""}`).join("; ")}`
          : "Automatic checks pass.",
        a.traceFound === false
          ? "Timeline missing: OpenAI had not published this turn's trace, so its model time, tokens and cost are understated."
          : "",
        "",
        plainAnswer(a.text)
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
        a.steps?.length
          ? [
              "",
              `<details><summary>How it worked (${a.steps.filter((x) => !x.startsWith("  ")).length} steps)</summary>`,
              "",
              ...a.steps.map((step, n) =>
                step.startsWith("  ")
                  ? `   ${step.trim()}`
                  : `${n + 1}. ${step}`,
              ),
              "",
              "</details>",
            ].join("\n")
          : "",
      ].join("\n");
    })
    .join("\n\n")
    .concat(
      record.cost
        ? `\n\nEstimated cost $${record.cost.totalUsd} (model $${record.cost.modelUsd} · web search $${record.cost.searchUsd} · sandbox $${record.cost.sandboxUsd})`
        : "",
    )
    .concat(record.trace ? `\n\nFull trace: \`${record.trace}\`` : "");
}
const SCORES =
  "Correct _ · Sourced and dated _ · Blocks _ · Scope and safety _ · Voice and length _ · Honest limits _ (0, 1 or 2 each)";

// The six review points, in the order of the scores file's columns.
export const POINTS = [
  "correct",
  "sourced",
  "blocks",
  "scope",
  "voice",
  "limits",
] as const;
type Scores = Partial<Record<(typeof POINTS)[number], number>> & {
  notes?: string;
};

/** A scores file to fill in: one row per answer, a blank 0-2 cell per point. */
function scoresTemplate(rows: (string | number)[][], label = false) {
  const head = [
    "case",
    ...(label ? ["label"] : []),
    "repeat",
    ...POINTS,
    "notes",
  ];
  return [head, ...rows.map((r) => [...r, ...POINTS.map(() => ""), ""])]
    .map((r) => r.join(","))
    .join("\n")
    .concat("\n");
}

/** Rows of a CSV file, with quoted fields that may hold commas or quotes. */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

/** A filled-in scores file as objects keyed by its header. */
export function readScores(text: string) {
  const [head, ...rows] = parseCsv(text);
  return rows.map((cells) => {
    const row = Object.fromEntries(
      head.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]),
    );
    const scores: Scores = {};
    for (const point of POINTS) {
      const value = row[point];
      if (value === "") continue;
      const n = Number(value);
      if (![0, 1, 2].includes(n))
        throw new Error(
          `Score ${point} for ${row.case} must be 0, 1 or 2, not "${value}"`,
        );
      scores[point] = n;
    }
    if (row.notes) scores.notes = row.notes;
    return {
      case: row.case,
      label: row.label as string | undefined,
      repeat: Number(row.repeat || 1),
      scores,
    };
  });
}
/** Scored on all six points. */
const scored = (s?: Scores) =>
  Boolean(s) && POINTS.every((p) => s![p] !== undefined);
/** The rubric's pass: Correct at 2 and no 0 anywhere. */
export const passes = (s: Scores) =>
  s.correct === 2 && POINTS.every((p) => s[p] !== 0);

function reviewSheet(summary: Record<string, unknown>, records: Record_[]) {
  const lines = [
    `# Test run: ${summary.variant}`,
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ];
  for (const r of records) {
    lines.push(
      `## ${r.id} · ${r.title}${r.repeat > 1 ? ` (repeat ${r.repeat})` : ""}`,
      "",
      `**Asked:** ${r.turns[0]}`,
      r.notes ? `**Look for:** ${r.notes}` : "",
      "",
      answerSection(r),
      "",
      SCORES,
      "",
    );
  }
  return lines.join("\n");
}

/** Side by side under hidden labels, shuffled per case; the key is written apart. */
function compare(files: string[]) {
  const runs = files.map(
    (f) =>
      JSON.parse(readFileSync(f, "utf8")) as {
        summary: { variant: string };
        records: Record_[];
      },
  );
  const ids = [...new Set(runs.flatMap((r) => r.records.map((x) => x.id)))];
  const labels = "XYZWVU".split("");
  const key: Record<string, Record<string, string>> = {};
  const scoreRows: (string | number)[][] = [];
  const lines = [
    "# Side-by-side review",
    "",
    "Variants are hidden; the key is in the matching -key.json file.",
    "",
  ];
  for (const id of ids) {
    const order = runs.map((_, i) => i).sort(() => Math.random() - 0.5);
    key[id] = {};
    const first = runs
      .find((r) => r.records.some((x) => x.id === id))!
      .records.find((x) => x.id === id)!;
    lines.push(
      `## ${id} · ${first.title}`,
      "",
      `**Asked:** ${first.turns[0]}`,
      first.notes ? `**Look for:** ${first.notes}` : "",
      "",
    );
    order.forEach((runIndex, slot) => {
      const label = labels[slot];
      key[id][label] = runs[runIndex].summary.variant;
      for (const record of runs[runIndex].records.filter((x) => x.id === id)) {
        scoreRows.push([id, label, record.repeat]);
        lines.push(
          `### ${label}${record.repeat > 1 ? ` (repeat ${record.repeat})` : ""}`,
          "",
          answerSection(record),
          "",
          SCORES,
          "",
        );
      }
    });
  }
  mkdirSync(".exports", { recursive: true });
  const out = `.exports/evals-compare-${stamp()}`;
  writeFileSync(`${out}.md`, lines.join("\n"), { mode: 0o600 });
  writeFileSync(`${out}-key.json`, JSON.stringify(key, null, 2), {
    mode: 0o600,
  });
  writeFileSync(`${out}-scores.csv`, scoresTemplate(scoreRows, true), {
    mode: 0o600,
  });
  const table = runs.map((r) => r.summary);
  console.table(table);
  console.log(`Saved ${out}.md, ${out}-scores.csv and ${out}-key.json`);
}

type Row = {
  variant: string;
  record: Record_;
  cost?: ReturnType<typeof estimateCost>;
  scores?: Scores;
};

/** Every answer of the runs, with its estimated cost and any scores given. */
export function joinScores(
  runs: { file: string; run: Run }[],
  compared?: {
    scores: ReturnType<typeof readScores>;
    key: Record<string, Record<string, string>>;
  },
) {
  const rows: Row[] = [];
  for (const { file, run } of runs) {
    const own = file.replace(/\.json$/, "-scores.csv");
    const scores = existsSync(own) ? readScores(readFileSync(own, "utf8")) : [];
    for (const record of run.records)
      rows.push({
        variant: run.summary.variant,
        record,
        cost: recordCost(record, run.summary),
        scores: scores.find(
          (s) => s.case === record.id && s.repeat === record.repeat,
        )?.scores,
      });
  }
  // Blind scores from a comparison, mapped back to their variants by the key.
  for (const s of compared?.scores ?? []) {
    const variant = compared!.key[s.case]?.[s.label ?? ""];
    const row = rows.find(
      (r) =>
        r.variant === variant &&
        r.record.id === s.case &&
        r.record.repeat === s.repeat,
    );
    if (row && scored(s.scores)) row.scores = s.scores;
  }
  return rows;
}

const usd = (n: number) => Math.round(n * 10000) / 10000;
const medianUsd = (rows: Row[]) => {
  const m = median(rows.map((r) => (r.cost?.totalUsd ?? NaN) * 10000));
  return m === null ? null : usd(m / 10000);
};
const mean = (values: number[]) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) /
      100
    : null;

/** Per variant: quality, time and cost side by side. */
export function variantTable(rows: Row[]) {
  const variants = [...new Set(rows.map((r) => r.variant))];
  return variants.map((variant) => {
    const mine = rows.filter((r) => r.variant === variant);
    const ok = mine.filter((r) => !r.record.error);
    const rated = ok.filter((r) => scored(r.scores));
    const passed = rated.filter((r) => passes(r.scores!));
    const ratedCost = rated.reduce((s, r) => s + (r.cost?.totalUsd ?? 0), 0);
    return {
      variant,
      answers: mine.length,
      errors: mine.length - ok.length,
      autoChecksPass: ok.filter((r) => r.record.passedChecks).length,
      scored: rated.length,
      passRate: rated.length
        ? Math.round((passed.length / rated.length) * 100) / 100
        : null,
      ...Object.fromEntries(
        POINTS.map((p) => [`avg ${p}`, mean(rated.map((r) => r.scores![p]!))]),
      ),
      medianSeconds: median(ok.map((r) => r.record.totalSeconds ?? NaN)),
      medianModelSeconds: median(ok.map((r) => r.record.modelSeconds ?? NaN)),
      medianUsd: medianUsd(ok),
      totalUsd: usd(ok.reduce((s, r) => s + (r.cost?.totalUsd ?? 0), 0)),
      searchUsd: usd(ok.reduce((s, r) => s + (r.cost?.searchUsd ?? 0), 0)),
      usdPerPass: passed.length ? usd(ratedCost / passed.length) : null,
    };
  });
}

/** Per case: each variant's result, median time and median cost. */
function caseTable(rows: Row[]) {
  const variants = [...new Set(rows.map((r) => r.variant))];
  const ids = [...new Set(rows.map((r) => r.record.id))];
  return ids.map((id) => ({
    case: id,
    ...Object.fromEntries(
      variants.map((v) => {
        const mine = rows.filter(
          (r) => r.variant === v && r.record.id === id && !r.record.error,
        );
        if (!mine.length) return [v, "—"];
        const rated = mine.filter((r) => scored(r.scores));
        const result = rated.length
          ? `${rated.filter((r) => passes(r.scores!)).length}/${rated.length} pass`
          : `${mine.filter((r) => r.record.passedChecks).length}/${mine.length} checks`;
        const seconds = median(mine.map((r) => r.record.totalSeconds ?? NaN));
        const cost = medianUsd(mine);
        return [v, `${result} · ${seconds}s · $${cost}`];
      }),
    ),
  }));
}

const dayOf = (iso: string) => iso.slice(0, 10);
/** Each run day's estimate next to OpenAI's actual charges for that day. */
async function reconcile(runs: Run[], rows: Row[]) {
  const dated = runs.filter((r) => r.summary.startedAt);
  if (!dated.length)
    return [
      "No run has a start time; runs from before this change cannot be reconciled.",
    ];
  const days = [
    ...new Set(dated.map((r) => dayOf(r.summary.startedAt!))),
  ].sort();
  const start = Date.parse(`${days[0]}T00:00:00Z`) / 1000;
  const end = Date.parse(`${days.at(-1)}T00:00:00Z`) / 1000 + 86400;
  const costs = await dailyCosts(start, end);
  if (costs.status === "not_configured")
    return [
      "Set OPENAI_ADMIN_KEY (and OPENAI_PROJECT_ID) to compare with actual charges.",
    ];
  if (costs.status === "unavailable")
    return [`The OpenAI Costs API answered ${costs.httpStatus}.`];
  const lines = [
    "",
    "## Estimates against actual charges",
    "",
    `Actual charges come from the OpenAI Costs API (${costs.scope} scope), lag by up to a day, and include any other use that day, so they set a ceiling rather than an exact match.`,
    "",
    "| Day | Estimated model | Estimated web search | Estimated sandbox | Estimated total | Actual total | Actual by line item |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const day of days) {
    const variants = new Set(
      dated
        .filter((r) => dayOf(r.summary.startedAt!) === day)
        .map((r) => r.summary.variant),
    );
    const mine = rows.filter((r) => variants.has(r.variant));
    const sum = (k: "modelUsd" | "searchUsd" | "sandboxUsd" | "totalUsd") =>
      usd(mine.reduce((s, r) => s + (r.cost?.[k] ?? 0), 0));
    const actual = costs.days.get(day) ?? {};
    const actualTotal = usd(Object.values(actual).reduce((a, b) => a + b, 0));
    const items = Object.entries(actual)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} $${usd(v)}`)
      .join("; ");
    lines.push(
      `| ${day} | $${sum("modelUsd")} | $${sum("searchUsd")} | $${sum("sandboxUsd")} | $${sum("totalUsd")} | $${actualTotal} | ${items || "none yet"} |`,
    );
  }
  return lines;
}

const markdownTable = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const head = Object.keys(rows[0]);
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map(
      (r) => `| ${head.map((h) => String(r[h] ?? "—")).join(" | ")} |`,
    ),
  ].join("\n");
};

async function report(
  files: string[],
  values: Record<string, string | boolean | undefined>,
) {
  const runs = files.map((file) => ({
    file,
    run: JSON.parse(readFileSync(file, "utf8")) as Run,
  }));
  const prefix = values.compare
    ? String(values.compare).replace(/(-scores\.csv|-key\.json|\.md)$/, "")
    : undefined;
  const compared = prefix
    ? {
        scores: existsSync(`${prefix}-scores.csv`)
          ? readScores(readFileSync(`${prefix}-scores.csv`, "utf8"))
          : [],
        key: JSON.parse(readFileSync(`${prefix}-key.json`, "utf8")) as Record<
          string,
          Record<string, string>
        >,
      }
    : undefined;
  const rows = joinScores(runs, compared);
  const variants = variantTable(rows);
  const cases = caseTable(rows);
  const lines = [
    "# Test report",
    "",
    "Cost is estimated from each answer's tokens, web searches and sandbox minutes. A pass is Correct at 2 and no 0; usdPerPass is the cost of the scored answers divided by the passes.",
    "",
    "## By variant",
    "",
    markdownTable(variants),
    "",
    "## By case",
    "",
    markdownTable(cases),
  ];
  if (values.reconcile)
    lines.push(
      ...(await reconcile(
        runs.map((r) => r.run),
        rows,
      )),
    );
  console.table(variants);
  console.table(cases);
  mkdirSync(".exports", { recursive: true });
  const out = `.exports/evals-report-${stamp()}.md`;
  writeFileSync(out, lines.join("\n").concat("\n"), { mode: 0o600 });
  console.log(`Saved ${out}`);
}

if (process.argv[1]?.endsWith("evals.ts")) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      core: { type: "boolean", default: false },
      only: { type: "string" },
      variant: { type: "string", default: "baseline" },
      model: { type: "string" },
      effort: { type: "string" },
      tier: { type: "string" },
      verbosity: { type: "string" },
      size: { type: "string" },
      prewarm: { type: "boolean", default: false },
      repeat: { type: "string", default: "1" },
      concurrency: { type: "string", default: "3" },
      compare: { type: "string" },
      "keep-sessions": { type: "boolean", default: false },
      reconcile: { type: "boolean", default: false },
    },
  });
  if (positionals[0] === "compare") compare(positionals.slice(1));
  else if (positionals[0] === "report")
    await report(positionals.slice(1), values);
  else if (positionals[0]) await runCases(positionals[0], values);
  else {
    console.error(
      "Usage: pnpm evals <cases.json> [--core] [--only ids] [--variant name] [overrides] | pnpm evals compare <run.json>... | pnpm evals report <run.json>... [--compare <prefix>] [--reconcile]",
    );
    process.exit(1);
  }
}
