// Runs test cases straight against the dashboard agent and checks each answer.
// The cases file is JSON: { cases: [{ id, title, core, turns, files?, expect,
// notes? }] }, with file paths relative to it. Overrides apply to the test
// sessions only, never the saved agent.
//
//   pnpm evals <cases.json> [--core] [--only SS-1,BRK-2] [--variant baseline]
//     [--model m] [--effort e] [--tier t] [--verbosity v] [--size s] [--prewarm]
//     [--repeat 2] [--concurrency 3]
//   pnpm evals compare <run-a.json> <run-b.json> [...]
//
// A run writes .exports/evals-<variant>-<time>.json (every answer, its trace,
// timings, tokens, estimated cost and check results) and a review sheet beside
// it (.md) with each answer in its plain-text form. `compare` writes one sheet
// with the variants side by side under hidden labels, and the key separately.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { extractBlocks, parseBlock, plainAnswer } from "../lib/agent21/blocks";
import { runConversation, type Overrides } from "./agent-run";

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

// USD per million tokens (October 2026). "auto" is priced as standard.
const PRICES: Record<
  string,
  Record<"standard" | "flex", { input: number; cached: number; output: number }>
> = {
  "gpt-6-luna": {
    standard: { input: 0.1, cached: 0.01, output: 0.5 },
    flex: { input: 0.05, cached: 0.005, output: 0.25 },
  },
  "gpt-6.1-sol": {
    standard: { input: 2, cached: 0.1, output: 10 },
    flex: { input: 1, cached: 0.05, output: 5 },
  },
};
// USD per minute, billed by the minute with a five-minute minimum.
const SANDBOX = { small: 0.03 / 20, medium: 0.12 / 20 };

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
/** An estimate from token use and sandbox minutes; OpenAI's Costs page is the record. */
export function estimateCost(
  tokens: Tokens,
  seconds: number,
  o: Overrides,
  model: string,
) {
  const price =
    PRICES[o.model ?? model]?.[o.tier === "flex" ? "flex" : "standard"];
  const modelUsd = price
    ? ((tokens.input - tokens.cached) * price.input +
        tokens.cached * price.cached +
        tokens.output * price.output) /
      1e6
    : NaN;
  const size = o.prewarm || o.size === "medium" ? "medium" : "small";
  const sandboxUsd = Math.max(5, seconds / 60) * SANDBOX[size];
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    modelUsd: round(modelUsd),
    sandboxUsd: round(sandboxUsd),
    totalUsd: round(modelUsd + sandboxUsd),
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
    items: Item[];
  }[];
  passedChecks?: boolean;
  totalSeconds?: number;
  modelSeconds?: number;
  cost?: ReturnType<typeof estimateCost>;
};

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
  const savedModel = process.env.AGENT21_EVAL_MODEL ?? "gpt-6-luna";
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
        });
        record.answers = run.answers.map((a, i) => ({
          text: a.text,
          ended: a.ended,
          totalSeconds: a.totalSeconds,
          modelSeconds: a.modelSeconds,
          modelCalls: a.modelCalls,
          tokens: a.tokens,
          items: a.items as Item[],
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
        record.totalSeconds = record.answers.reduce(
          (s, a) => s + a.totalSeconds,
          0,
        );
        record.modelSeconds = record.answers.reduce(
          (s, a) => s + a.modelSeconds,
          0,
        );
        const tokens = record.answers.reduce(
          (t, a) => ({
            input: t.input + a.tokens.input,
            cached: t.cached + a.tokens.cached,
            output: t.output + a.tokens.output,
          }),
          { input: 0, cached: 0, output: 0 },
        );
        record.cost = estimateCost(
          tokens,
          record.totalSeconds,
          overrides,
          savedModel,
        );
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
    conversations: records.length,
    errors: records.length - done.length,
    passedChecks: done.filter((r) => r.passedChecks).length,
    medianSeconds: median(done.map((r) => r.totalSeconds!)),
    medianModelSeconds: median(done.map((r) => r.modelSeconds!)),
    medianWords: median(done.map((r) => words(r.answers!.at(-1)!.text))),
    totalUsd:
      Math.round(done.reduce((s, r) => s + (r.cost?.totalUsd ?? 0), 0) * 100) /
      100,
  };
  mkdirSync(".exports", { recursive: true });
  const out = `.exports/evals-${variant}-${stamp()}`;
  writeFileSync(`${out}.json`, JSON.stringify({ summary, records }, null, 2), {
    mode: 0o600,
  });
  writeFileSync(`${out}.md`, reviewSheet(summary, records), { mode: 0o600 });
  console.log(summary);
  console.log(`Saved ${out}.json and ${out}.md`);
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
        `${a.totalSeconds}s · model ${a.modelSeconds}s in ${a.modelCalls} calls · ${a.tokens.input} tokens in (${a.tokens.cached} cached), ${a.tokens.output} out`,
        failed.length
          ? `Checks failed: ${failed.map((k) => `${k.check}${k.detail ? ` (${k.detail})` : ""}`).join("; ")}`
          : "Automatic checks pass.",
        "",
        plainAnswer(a.text)
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      ].join("\n");
    })
    .join("\n\n");
}
const SCORES =
  "Correct _ · Sourced and dated _ · Blocks _ · Scope and safety _ · Voice and length _ · Honest limits _ (0, 1 or 2 each)";

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
      for (const record of runs[runIndex].records.filter((x) => x.id === id))
        lines.push(
          `### ${label}${record.repeat > 1 ? ` (repeat ${record.repeat})` : ""}`,
          "",
          answerSection(record),
          "",
          SCORES,
          "",
        );
    });
  }
  mkdirSync(".exports", { recursive: true });
  const out = `.exports/evals-compare-${stamp()}`;
  writeFileSync(`${out}.md`, lines.join("\n"), { mode: 0o600 });
  writeFileSync(`${out}-key.json`, JSON.stringify(key, null, 2), {
    mode: 0o600,
  });
  const table = runs.map((r) => r.summary);
  console.table(table);
  console.log(`Saved ${out}.md and ${out}-key.json`);
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
    },
  });
  if (positionals[0] === "compare") compare(positionals.slice(1));
  else if (positionals[0]) await runCases(positionals[0], values);
  else {
    console.error(
      "Usage: pnpm evals <cases.json> [--core] [--only ids] [--variant name] [overrides] | pnpm evals compare <run.json>...",
    );
    process.exit(1);
  }
}
