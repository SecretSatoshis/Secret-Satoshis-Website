import test from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, estimateCost } from "../scripts/evals";

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
  const tokens = { input: 300_000, cached: 250_000, output: 4_000 };
  assert.deepEqual(estimateCost(tokens, 90, {}, "gpt-6-luna"), {
    modelUsd: 0.0095,
    sandboxUsd: 0.0075,
    totalUsd: 0.017,
  });
  assert.equal(
    estimateCost(
      tokens,
      600,
      { model: "gpt-6.1-sol", tier: "flex", prewarm: true },
      "gpt-6-luna",
    ).totalUsd,
    0.1425,
  );
});
