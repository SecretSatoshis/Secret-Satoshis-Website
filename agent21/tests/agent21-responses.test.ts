import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type OpenAI from "openai";
import { extractBlocks, parseBlock } from "../lib/agent21/blocks";
import { validChart } from "../lib/agent21/charts";
import {
  BlockError,
  figuresBlock,
  ladderBlock,
  sourcesBlock,
  tableBlock,
} from "../lib/agent21/responses/blocks";
import { clearCache } from "../lib/agent21/responses/data/cache";
import {
  chartSummary,
  eventChart,
  timeseriesChart,
  trimPayload,
  type Payload,
} from "../lib/agent21/responses/data/charts";
import { splitCsvLine } from "../lib/agent21/responses/data/report-library";
import {
  answerText,
  invalidBlocks,
  runRounds,
} from "../lib/agent21/responses/loop";
import { createParams, engineSettings } from "../lib/agent21/responses/request";
import { shellTool, skillRefs } from "../lib/agent21/responses/shell";
import {
  capOutput,
  functionTools,
  runTool,
  sourceItems,
  TOOLS,
  type ToolContext,
} from "../lib/agent21/responses/tools";
import {
  parseSeriesCsv,
  summarize,
  thin,
} from "../lib/agent21/responses/tools/brk";
import { htmlText } from "../lib/agent21/responses/tools/newsletter";
import {
  annualBuyCount,
  moneyWeightedReturn,
  runPlan,
  type Cadence,
} from "../lib/agent21/responses/tools/savings";
import { csvSummary } from "../lib/agent21/responses/tools/uploads";

// Golden values from the Python methods these modules port (the vendored
// savings.run_plan and money_weighted_return, chart_payloads._trimmed), on
// synthetic prices and a synthetic chart.
const golden = JSON.parse(
  readFileSync(
    new URL("./fixtures/responses/golden.json", import.meta.url),
    "utf8",
  ),
);
const close = (a: number | null, b: number | null, tolerance = 1e-9) => {
  if (a === null || b === null) return assert.equal(a, b);
  assert.ok(
    Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)),
    `${a} vs ${b}`,
  );
};

function context(over: Partial<ToolContext> = {}): ToolContext {
  return {
    log: [],
    now: new Date("2026-10-16T21:00:00Z"),
    saveArtifact: async (a) => a.name,
    uploads: [],
    readUpload: async () => null,
    ...over,
  };
}

test("the savings plan matches the published Python method", () => {
  for (const plan of golden.plans) {
    const o = plan.options;
    const result = runPlan(golden.prices, {
      start: o.start,
      annualBtc: o.annual_btc,
      annualCash: o.annual_cash,
      cadence: o.cadence as Cadence,
      cashApy: o.cash_apy,
      stillBuying: o.still_buying,
      stopAfterYears: o.stop_after_yrs ?? undefined,
    });
    assert.equal(result.rows.length, plan.rows);
    assert.equal(result.rows[0].date, plan.first);
    assert.deepEqual(result.buyDates, plan.buy_dates);
    result.totalContributions.forEach((c, i) =>
      close(c, plan.contributions[i]),
    );
    const final = result.rows.at(-1)!;
    close(final.coins, plan.final.coins);
    close(final.cashValue, plan.final.cash_value);
    close(final.totalValue, plan.final.total_value);
    close(final.totalContributed, plan.final.total_contributed);
    close(final.costBasis, plan.final.cost_basis);
    assert.equal(result.stillContributing, plan.still_contributing);
    const rate = moneyWeightedReturn(
      result.buyDates,
      result.totalContributions,
      final.totalValue,
      final.date,
    );
    close(rate, plan.mwr, 1e-9);
  }
  for (const c of golden.counts) {
    const anchor = Math.round(Date.parse(`${c.anchor}T00:00:00Z`) / 86_400_000);
    assert.equal(
      annualBuyCount(c.year, c.cadence, anchor),
      c.count,
      JSON.stringify(c),
    );
  }
});

test("the money-weighted return handles the edge cases as the Python does", () => {
  assert.equal(moneyWeightedReturn([], [], 100, "2026-01-01"), null);
  assert.equal(
    moneyWeightedReturn(["2026-01-01"], [100], 120, "2026-01-20"),
    null,
  );
  assert.equal(moneyWeightedReturn(["2025-01-01"], [100], 0, "2026-01-01"), -1);
  close(
    moneyWeightedReturn(["2025-01-01"], [100], 110, "2026-01-01")!,
    1.1 ** (365.25 / 365) - 1,
    1e-9,
  );
});

test("trimming a published chart matches chart_payloads._trimmed", () => {
  const { payload, cases } = golden.trim;
  for (const { args, result } of cases) {
    const trimmed = trimPayload(payload as Payload, {
      start: args.start ?? undefined,
      end: args.end ?? undefined,
      lastDays: args.last_days ?? undefined,
      series: args.keep ?? undefined,
    });
    assert.deepEqual(
      JSON.parse(JSON.stringify(trimmed)),
      result,
      JSON.stringify(args),
    );
  }
  assert.throws(
    () => trimPayload(payload as Payload, { lastDays: 3, start: "2024-01-02" }),
    /not both/,
  );
});

test("new charts pass the viewer's checks and summarize their lows and highs", () => {
  const { payload, text } = timeseriesChart({
    chartId: "test_chart",
    title: "Test",
    description: "Test chart",
    source: "BRK (bitview.space)",
    x: ["2026-01-01", "2026-01-02", "2026-01-03"],
    series: [{ id: "price_close", name: "Price", values: [3, 1, 2] }],
    axes: { right: { label: "USD", unit: "USD", mode: "log" } },
  });
  assert.ok(validChart(text));
  const summary = chartSummary(payload) as {
    series: Record<
      string,
      {
        low: { value: number };
        high: { value: number };
        latest: { at: string };
      }
    >;
  };
  assert.equal(summary.series.price_close.low.value, 1);
  assert.equal(summary.series.price_close.high.value, 3);
  assert.equal(summary.series.price_close.latest.at, "2026-01-03");
  const cycle = eventChart({
    chartId: "cycles",
    title: "Cycles",
    description: "Paths",
    source: "BRK",
    axis: { label: "Indexed", unit: "ratio", mode: "log" },
    paths: [
      { id: "a", name: "A", values: [100, 120, 130] },
      { id: "b", name: "B", values: [100, 90] },
    ],
    asOf: "2026-10-15",
  });
  assert.ok(validChart(cycle.text));
  assert.throws(() =>
    timeseriesChart({
      chartId: "bad",
      title: "Bad",
      description: "d",
      source: "s",
      x: ["2026-01-01"],
      series: [{ id: "x", name: "X", values: [0] }],
      axes: { right: { label: "USD", unit: "USD", mode: "log" } },
    }),
  );
});

test("tool-built blocks pass the website's parser and catch unit slips", () => {
  const blocks = [
    figuresBlock([
      { label: "Price", value: 81000, format: "usd", asOf: "2026-10-16" },
    ]),
    tableBlock(
      [["2025", 0.15]],
      [{ label: "Year" }, { label: "Return", format: "percent" }],
      "Returns",
    ),
    ladderBlock(
      "Strikes",
      81000,
      [
        { value: 90000, odds: 53.5 },
        { value: 100000, odds: 19.5 },
      ],
      {
        measure: "odds",
        market: {
          name: "M",
          url: "https://polymarket.com/event/x",
          volume: 1,
          liquidity: 1,
        },
      },
    ),
    sourcesBlock([
      {
        name: "BRK",
        url: "https://bitview.space",
        asOf: "2026-10-16T21:00:00Z",
      },
    ]),
  ];
  for (const fenced of blocks) {
    const [block] = extractBlocks(fenced);
    assert.equal(parseBlock(block.language, block.code).ok, true, fenced);
  }
  assert.throws(
    () => figuresBlock([{ label: "Up", value: 46, format: "percent" }]),
    BlockError,
  );
  assert.throws(
    () => tableBlock([["a"]], [{ label: "A" }, { label: "B" }], "Bad"),
    BlockError,
  );
});

test("every function tool has a strict schema", () => {
  const walk = (schema: Record<string, unknown>, path: string) => {
    if (
      schema.type === "object" ||
      (Array.isArray(schema.type) && schema.type.includes("object"))
    ) {
      const properties = schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      assert.equal(schema.additionalProperties, false, path);
      assert.deepEqual(
        [...(schema.required as string[])].sort(),
        Object.keys(properties).sort(),
        path,
      );
      for (const [k, v] of Object.entries(properties)) walk(v, `${path}.${k}`);
    }
    if (schema.items)
      walk(schema.items as Record<string, unknown>, `${path}[]`);
  };
  const defs = functionTools();
  assert.equal(defs.length, TOOLS.length);
  assert.equal(new Set(defs.map((d) => d.name)).size, defs.length);
  for (const d of defs) {
    assert.equal(d.strict, true);
    walk(d.parameters, d.name);
  }
});

test("tool results stay under the cap without cutting blocks", () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({
    date: `d${i}`,
    value: i,
  }));
  const text = capOutput(
    { rows, blocks: { chart: "```a21-chart\n{}\n```" } },
    5000,
  );
  const parsed = JSON.parse(text);
  assert.ok(text.length <= 5000);
  assert.equal(parsed.rows.at(-1).value, 1999);
  assert.equal(parsed.blocks.chart, "```a21-chart\n{}\n```");
  assert.match(parsed.trimmed, /thinned/);
  const items = sourceItems({
    blocks: {
      sources: sourcesBlock([{ name: "BRK", url: "https://bitview.space" }]),
    },
  });
  assert.deepEqual(items.source, { name: "BRK", url: "https://bitview.space" });
  assert.equal(items.blocks?.sources, undefined);
});

test("tool failures come back as errors the model can act on", async () => {
  const unknown = await runTool("nope", "{}", context());
  assert.equal(unknown.ok, false);
  const bad = await runTool("bitcoin_lookup", "{not json", context());
  assert.match(bad.output, /not valid JSON/);
  const txid = await runTool(
    "bitcoin_lookup",
    JSON.stringify({ kind: "tx", id: "abc" }),
    context(),
  );
  assert.match(JSON.parse(txid.output).error, /64 hexadecimal/);
});

test("the network tool reads BRK and builds its blocks", async (t) => {
  clearCache();
  const answers: Record<string, string> = {
    "/api/v1/prices": JSON.stringify({ time: 1792199732, USD: 81314.2 }),
    "/api/blocks/tip/height": "971786",
    "/api/v1/fees/precise": JSON.stringify({
      fastestFee: 1.5,
      halfHourFee: 0.9,
      hourFee: 0.48,
      economyFee: 0.2,
      minimumFee: 0.1,
    }),
  };
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL) => {
      const body = answers[new URL(String(input)).pathname];
      return new Response(body ?? "not found", { status: body ? 200 : 404 });
    },
  );
  const ctx = context();
  const run = await runTool(
    "bitcoin_network",
    JSON.stringify({ parts: ["price", "tip", "fees"] }),
    ctx,
  );
  const out = JSON.parse(run.output);
  assert.equal(run.ok, true);
  assert.equal(out.tip_height, 971786);
  assert.equal(out.fees_sat_vb.next_block, 1.5);
  assert.equal(out.source.name, "BRK");
  assert.equal(
    parseBlock("a21-figures", out.blocks.figures.split("\n")[1]).ok,
    true,
  );
  assert.equal(fetch.mock.callCount(), 3);
  assert.deepEqual(
    run.urls.map((u) => new URL(u).host),
    ["bitview.space", "bitview.space", "bitview.space"],
  );
  clearCache();
});

test("parsing helpers handle quotes, blanks, HTML and thin long series", () => {
  assert.deepEqual(splitCsvLine('a,"b,c","d ""e"""'), ["a", "b,c", 'd "e"']);
  const { rows } = parseSeriesCsv(
    "date,price_close\n2026-01-01,10\n2026-01-02,\n2026-01-03,12\n",
  );
  assert.equal(rows[1].price_close, null);
  const summary = summarize(rows, ["price_close"]) as Record<
    string,
    { low: { value: number }; change: number }
  >;
  assert.equal(summary.price_close.low.value, 10);
  close(summary.price_close.change, 0.2);
  const thinned = thin(
    Array.from({ length: 1000 }, (_, i) => i),
    100,
  );
  assert.ok(thinned.rows.length <= 101);
  assert.equal(thinned.rows.at(-1), 999);
  assert.equal(
    htmlText("<p>One &amp; two</p><ul><li>a</li></ul><script>x</script>"),
    "One & two\n- a",
  );
  const csv = csvSummary("date,btc\n2024-01-01,0.1\n2024-02-01,0.05\n");
  assert.equal(csv.rows, 2);
  assert.equal(csv.columns[1].type, "number");
});

test("requests carry the prompt, tools and shell settings", () => {
  const settings = engineSettings({
    model: "gpt-6-luna",
    prompt: {
      kind: "stored",
      prompt: { id: "pmpt_1", version: "3" },
      label: "pmpt_1@3",
    },
    paths: "BC",
    fileIds: ["file_1"],
  });
  const params = createParams(settings);
  assert.deepEqual(params.prompt, { id: "pmpt_1", version: "3" });
  assert.equal(params.instructions, undefined);
  assert.equal(params.store, true);
  const types = (params.tools ?? []).map((t) => t.type);
  assert.ok(
    types.includes("web_search") &&
      types.includes("shell") &&
      types.includes("function"),
  );
  assert.deepEqual(skillRefs("skill_a:4, skill_b"), [
    { type: "skill_reference", skill_id: "skill_a", version: "4" },
    { type: "skill_reference", skill_id: "skill_b" },
  ]);
  assert.deepEqual(shellTool({ containerId: "cntr_1" }).environment, {
    type: "container_reference",
    container_id: "cntr_1",
  });
  const c = createParams({ ...settings, paths: "C" });
  assert.ok(!(c.tools ?? []).some((t) => t.type === "shell"));
});

type Round = { output: Record<string, unknown>[]; text?: string };
function fakeClient(rounds: Round[]) {
  const sent: Record<string, unknown>[] = [];
  let n = 0;
  const client = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        sent.push(params);
        const round = rounds[n++];
        const id = `resp_${n}`;
        return (async function* () {
          yield { type: "response.created", response: { id } };
          for (const item of round.output) {
            yield { type: "response.output_item.added", item };
            if (item.type === "message")
              yield {
                type: "response.output_text.delta",
                item_id: item.id,
                delta: "x",
              };
          }
          yield {
            type: "response.completed",
            response: {
              id,
              status: "completed",
              output: round.output,
              usage: {
                input_tokens: 100,
                input_tokens_details: { cached_tokens: 40 },
                output_tokens: 10,
                output_tokens_details: { reasoning_tokens: 2 },
              },
            },
          };
        })();
      },
    },
  };
  return { client: client as unknown as OpenAI, sent };
}
const message = (text: string, phase: string | null = "final_answer") => ({
  type: "message",
  id: `msg_${text.length}`,
  role: "assistant",
  phase,
  content: [{ type: "output_text", text, annotations: [] }],
});

test("the loop runs function calls between rounds and chains responses", async () => {
  const good = '```a21-step\n{"text":"Checked the chain."}\n```\n\nDone.';
  const { client, sent } = fakeClient([
    {
      output: [
        message("Checking the chain.", "commentary"),
        {
          type: "function_call",
          call_id: "call_1",
          name: "read_upload",
          arguments: '{"name":null}',
        },
      ],
    },
    { output: [message(good)] },
  ]);
  const events: string[] = [];
  const result = await runRounds({
    client,
    params: { model: "m" },
    input: "Question",
    context: context({ uploads: ["a.csv"] }),
    sink: (e) =>
      events.push(e.type === "progress" ? `progress:${e.label}` : e.type),
    repairBlocks: true,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.text, good);
  assert.equal(result.rounds.length, 2);
  assert.equal(sent[1].previous_response_id, "resp_1");
  assert.deepEqual(sent[1].input, [
    {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"files":["a.csv"]}',
    },
  ]);
  assert.deepEqual(result.usage, {
    input: 200,
    cached: 80,
    output: 20,
    reasoning: 4,
  });
  assert.ok(events.includes("progress:Reading your file"));
  assert.ok(events.includes("tool"));
});

test("the loop asks once for broken blocks to be fixed", async () => {
  const broken = '```a21-figures\n{"items":[]}\n```';
  const fixed = '```a21-step\n{"text":"Checked."}\n```';
  const { client, sent } = fakeClient([
    { output: [message(broken)] },
    { output: [message(fixed)] },
  ]);
  const result = await runRounds({
    client,
    params: { model: "m" },
    input: "Q",
    context: context(),
    repairBlocks: true,
  });
  assert.equal(result.text, fixed);
  assert.equal(result.rounds[1].repair, true);
  assert.match(JSON.stringify(sent[1].input), /fail the website's checks/);
  assert.equal(invalidBlocks(fixed).length, 0);
  assert.equal(
    answerText([message("note", "commentary"), message("answer")] as never),
    "answer",
  );
});

test("requests add programmatic calling, compaction and GitHub when set", () => {
  const prompt = { kind: "file" as const, instructions: "x", label: "f" };
  const params = createParams(
    engineSettings({
      prompt,
      paths: "C",
      programmatic: true,
      compactThreshold: 50_000,
      githubToken: "token",
    }),
  );
  const list = (params.tools ?? []) as unknown as Record<string, unknown>[];
  assert.ok(list.some((t) => t.type === "programmatic_tool_calling"));
  assert.ok(
    list
      .filter((t) => t.type === "function")
      .every(
        (t) =>
          JSON.stringify(t.allowed_callers) ===
          JSON.stringify(["direct", "programmatic"]),
      ),
  );
  const github = list.find((t) => t.type === "mcp")!;
  assert.equal(github.require_approval, "never");
  assert.deepEqual([...(github.allowed_tools as string[])].sort(), [
    "get_commit",
    "get_file_contents",
    "list_commits",
    "search_code",
  ]);
  assert.deepEqual(params.context_management, [
    { type: "compaction", compact_threshold: 50_000 },
  ]);
  const plain = createParams(
    engineSettings({
      prompt,
      paths: "C",
      programmatic: false,
      githubToken: undefined,
    }),
  );
  const plainTools = (plain.tools ?? []) as unknown as Record<
    string,
    unknown
  >[];
  assert.ok(
    !plainTools.some(
      (t) => t.type === "programmatic_tool_calling" || t.type === "mcp",
    ),
  );
  assert.ok(plainTools.every((t) => t.allowed_callers === undefined));
});

test("calls from a program go back to it with their caller", async () => {
  const caller = { type: "program", caller_id: "call_prog" };
  const { client, sent } = fakeClient([
    {
      output: [
        {
          type: "program",
          id: "p1",
          call_id: "call_prog",
          code: "await read_upload({name:null})",
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "read_upload",
          arguments: '{"name":null}',
          caller,
        },
      ],
    },
    { output: [message("Done.")] },
  ]);
  const result = await runRounds({
    client,
    params: { model: "m" },
    input: "Q",
    context: context({ uploads: ["a.csv"] }),
  });
  assert.equal(result.text, "Done.");
  assert.deepEqual(sent[1].input, [
    {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"files":["a.csv"]}',
      caller,
    },
  ]);
  assert.equal(result.rounds[0].toolRuns[0].fromProgram, true);
});
