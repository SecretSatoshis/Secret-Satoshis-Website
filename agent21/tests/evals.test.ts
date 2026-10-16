import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkAnswer,
  countSearches,
  estimateCost,
  joinScores,
  passes,
  readScores,
  steps,
  variantTable,
} from "../scripts/evals";

const fence = (type: string, data: unknown) =>
  "```a21-" + type + "\n" + JSON.stringify(data) + "\n```";
const answer = [
  fence("step", { text: "Checked the transaction record." }),
  "The pizza transaction confirmed on May 22, 2010, in block 57,043.",
  fence("facts", {
    rows: [
      { label: "Block", value: "57,043" },
      { label: "Fee", value: "0.99 BTC" },
    ],
  }),
  fence("sources", { items: [{ name: "BRK", asOf: "2026-10-16" }] }),
].join("\n\n");
const failed = (checks: ReturnType<typeof checkAnswer>) =>
  checks.filter((c) => !c.ok).map((c) => c.check);

test("a well-formed data answer passes every check", () => {
  const items = [
    {
      type: "command_execution",
      command: 'download_public("https://bitview.space/api/tx/a1075db5")',
      exit_code: 0,
    },
  ];
  assert.deepEqual(
    failed(
      checkAnswer(answer, items, {
        data: true,
        blocks: ["facts"],
        mustInclude: ["57,043"],
        mustFetch: ["bitview.space"],
        mustNotSend: ["abandon"],
      }),
    ),
    [],
  );
});

test("slips, missing blocks, failures and leaks are caught", () => {
  const sloppy = [
    "On 2010-05-22 (Oct. 14) it moved 10,000.99000000 BTC.",
    fence("table", { caption: "x", columns: [{ label: "a" }], rows: [[1, 2]] }),
  ].join("\n\n");
  const items = [
    { type: "command_execution", command: "python run.py", exit_code: 1 },
    {
      type: "command_execution",
      command: 'download_public("https://example.com/?q=abandon+abandon")',
      exit_code: 0,
    },
  ];
  assert.deepEqual(
    failed(
      checkAnswer(sloppy, items, {
        data: true,
        blocks: ["facts"],
        mustFetch: ["polymarket.com"],
        mustNotSend: ["abandon"],
        maxWords: 5,
      }),
    ),
    [
      "blocks draw",
      "no ISO date in text",
      "no abbreviated month with a period",
      "no BTC with trailing zeros",
      "no failed code runs",
      "step first, sources last",
      "has facts",
      "read polymarket.com",
      'never sent "abandon"',
      "at most 5 words",
    ],
  );
});

test("text the agent only read is not counted as sent", () => {
  const items = [
    {
      type: "command_execution",
      command: "pd.read_csv('/workspace/inputs/eval-1/holdings.csv')",
      output: "date,btc_bought\n2025-06-18,0.0075",
      exit_code: 0,
    },
  ];
  assert.deepEqual(
    failed(
      checkAnswer("Your average cost is $32,728.", items, {
        mustNotSend: ["0.0075"],
      }),
    ),
    [],
  );
});

test("cost estimates use token prices and a five-minute sandbox minimum", () => {
  // 40k uncached at the cache-write rate, 260k cached, 4k out.
  const tokens = { input: 300_000, cached: 260_000, output: 4_000 };
  assert.deepEqual(estimateCost(tokens, 90, {}, "gpt-6-luna"), {
    modelUsd: 0.0096,
    searchUsd: 0,
    sandboxUsd: 0.0075,
    totalUsd: 0.0171,
  });
  assert.equal(estimateCost(tokens, 90, {}, "gpt-6-luna", 3).totalUsd, 0.0471);
  assert.equal(
    countSearches([
      { type: "web_search_call" },
      { type: "message" },
      { type: "web_search_call" },
    ]),
    2,
  );
  assert.equal(
    estimateCost(
      tokens,
      600,
      { model: "gpt-6.1-sol", tier: "flex", prewarm: true },
      "gpt-6-luna",
    ).totalUsd,
    0.143,
  );
});

test("scores files are read strictly and the pass rule is Correct 2 with no 0", () => {
  const rows = readScores(
    'case,repeat,correct,sourced,blocks,scope,voice,limits,notes\nBRK-2,1,2,2,1,2,2,2,"Good, but ""Block"" label long"\nPM-1,1,,,,,,,\n',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].scores, {
    correct: 2,
    sourced: 2,
    blocks: 1,
    scope: 2,
    voice: 2,
    limits: 2,
    notes: 'Good, but "Block" label long',
  });
  assert.deepEqual(rows[1].scores, {});
  assert.ok(passes(rows[0].scores));
  assert.ok(!passes({ ...rows[0].scores, voice: 0 }));
  assert.ok(!passes({ ...rows[0].scores, correct: 1 }));
  assert.throws(
    () => readScores("case,repeat,correct\nX,1,3\n"),
    /must be 0, 1 or 2/,
  );
});

test("the report joins scores with time and cost per variant, blind scores by key", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-"));
  const answer = (seconds: number, searches: number) => ({
    text: "x",
    ended: "agent.session.turn.completed",
    totalSeconds: seconds,
    modelSeconds: seconds - 10,
    modelCalls: 3,
    tokens: {
      input: 300_000,
      cached: 260_000,
      output: 4_000,
      reasoning: 1_000,
    },
    checks: [],
    items: Array.from({ length: searches }, () => ({
      type: "web_search_call",
    })),
  });
  const run = (variant: string, model: string, seconds: number) => ({
    summary: { variant, overrides: { model }, model: "gpt-6-luna" },
    records: [
      {
        id: "BRK-2",
        title: "t",
        repeat: 1,
        turns: ["q"],
        passedChecks: true,
        totalSeconds: seconds,
        modelSeconds: seconds - 10,
        answers: [answer(seconds, 0)],
      },
      {
        id: "PM-1",
        title: "t",
        repeat: 1,
        turns: ["q"],
        passedChecks: true,
        totalSeconds: seconds,
        modelSeconds: seconds - 10,
        answers: [answer(seconds, 2)],
      },
    ],
  });
  const baseFile = join(dir, "evals-baseline.json");
  const solFile = join(dir, "evals-sol.json");
  writeFileSync(baseFile, "{}");
  writeFileSync(solFile, "{}");
  // Baseline scored directly; Sol scored blind through a comparison.
  writeFileSync(
    join(dir, "evals-baseline-scores.csv"),
    "case,repeat,correct,sourced,blocks,scope,voice,limits,notes\nBRK-2,1,2,2,2,2,2,2,\nPM-1,1,1,2,2,2,2,2,\n",
  );
  const rows = joinScores(
    [
      { file: baseFile, run: run("baseline", "gpt-6-luna", 90) as never },
      { file: solFile, run: run("sol", "gpt-6.1-sol", 60) as never },
    ],
    {
      scores: readScores(
        "case,label,repeat,correct,sourced,blocks,scope,voice,limits,notes\nBRK-2,Y,1,2,2,2,2,2,2,\nPM-1,X,1,2,2,2,2,1,2,\n",
      ),
      key: {
        "BRK-2": { X: "baseline", Y: "sol" },
        "PM-1": { X: "sol", Y: "baseline" },
      },
    },
  );
  const [base, sol] = variantTable(rows);
  assert.equal(base.variant, "baseline");
  assert.equal(base.scored, 2);
  assert.equal(base.passRate, 0.5);
  assert.equal(
    base.totalUsd,
    0.0542,
    "two answers at $0.0171 plus two searches",
  );
  assert.equal(base.searchUsd, 0.02);
  assert.equal(base.usdPerPass, 0.0542);
  assert.equal(sol.scored, 2);
  assert.equal(sol.passRate, 1);
  assert.equal(sol.medianSeconds, 60);
  assert.ok(sol.totalUsd > base.totalUsd);
});

test("the review sheet's steps show thinking, notes and tool calls in order", () => {
  const items = [
    {
      type: "reasoning",
      summary: [
        {
          type: "summary_text",
          text: "**Finding it** The user wants the pizza transaction.",
        },
      ],
    },
    {
      type: "message",
      role: "assistant",
      phase: "commentary",
      content: [
        { type: "output_text", text: "Checking the transaction record." },
      ],
    },
    {
      type: "command_execution",
      command:
        "/bin/bash -lc \"python - <<'PY'\nimport json\nfrom x import y\ntx = download_public(url)\nPY\"",
      exit_code: 0,
      duration_ms: 1234,
    },
    {
      type: "command_execution",
      command: "bad()",
      exit_code: 1,
      output: "Traceback...\nNameError: name 'bad' is not defined",
    },
    {
      type: "web_search_call",
      action: {
        type: "search",
        query: null,
        queries: ["bitcoin pizza day 2010", "laszlo txid"],
      },
    },
    {
      type: "mcp_call",
      server_label: "github",
      name: "get_file_contents",
      arguments: { path: "README.md" },
      output: "...",
    },
    {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text: "Answer" }],
    },
  ];
  assert.deepEqual(steps(items), [
    "Thought: Finding it The user wants the pizza transaction.",
    "Note: Checking the transaction record.",
    "Ran code (exit 0, 1.2s): tx = download_public(url)",
    "Ran code (exit 1): bad()",
    "  Error: Traceback... NameError: name 'bad' is not defined",
    "Searched the web: bitcoin pizza day 2010 | laszlo txid",
    'Called github.get_file_contents: {"path":"README.md"}',
  ]);
});
