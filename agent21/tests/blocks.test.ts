import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBlocks,
  formatDate,
  formatTime,
  formatValue,
  parseBlock,
  placedCharts,
  plainAnswer,
  tidyProse,
} from "../lib/agent21/blocks";

const ok = (language: string, value: unknown) => {
  const block = parseBlock(language, JSON.stringify(value));
  assert.equal(block.ok, true, block.ok ? "" : block.reason);
  return block;
};
const refused = (language: string, value: unknown) => {
  const block = parseBlock(
    language,
    typeof value === "string" ? value : JSON.stringify(value),
  );
  assert.equal(block.ok, false, `${language} should be refused`);
  return block;
};

test("answer blocks accept every documented format", () => {
  ok("a21-step", { text: "Checked Bitcoin’s current block height." });
  ok("a21-figures", {
    items: [
      {
        label: "Bitcoin price",
        value: 82224,
        format: "usd",
        change: -0.058,
        changeLabel: "year to date",
        asOf: "2026-10-15T19:20:00Z",
      },
      {
        label: "Above realized",
        value: 0.53,
        format: "percent",
        kind: "calculated",
      },
    ],
  });
  ok("a21-facts", {
    title: "Transaction a1075db5…d48d",
    rows: [
      { label: "Status", value: "Confirmed" },
      {
        label: "Output",
        value: "17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ",
        mono: true,
        href: "https://mempool.space/address/17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ",
      },
    ],
  });
  ok("a21-table", {
    caption: "Year-end cases",
    columns: [
      { label: "Case" },
      { label: "Target", format: "usd" },
      { label: "Move", format: "change" },
    ],
    rows: [
      ["Bull", 160000, 0.95],
      ["Bear", 70000, null],
    ],
  });
  ok("a21-ladder", {
    title: "Odds",
    now: { label: "Now", value: 82224 },
    measure: "odds",
    levels: [
      { value: 150000, odds: 2.2 },
      { value: 90000, odds: 59.5 },
      { value: 70000, odds: 36.5 },
    ],
    market: {
      name: "BTC 2026",
      url: "https://polymarket.com/event/x",
      volume: 1,
      liquidity: 1,
    },
  });
  ok("a21-ladder", {
    title: "Levels",
    now: { label: "Now", value: 82224 },
    measure: "distance",
    levels: [
      { value: 161505, label: "3x" },
      { value: 74431 },
      { value: 53835 },
    ],
  });
  ok("a21-chart", {
    file: "Bitcoin_Realized_Price.chart.json",
    page: "https://charts.secretsatoshis.com/Bitcoin_Realized_Price.html",
  });
  ok("a21-sources", {
    items: [
      { name: "BRK", detail: "block 971,616", asOf: "2026-10-15T19:21:00Z" },
      { name: "Release", asOf: "2026-10-14" },
      {
        name: "Recap",
        url: "https://newsletter.secretsatoshis.com/p/x",
        published: "2026-10-13",
      },
      { name: "Your file: holdings.csv" },
    ],
  });
});

test("answer blocks refuse only what is unsafe or malformed", () => {
  refused("a21-banner", { text: "x" });
  refused("a21-step", "{not json");
  refused("a21-figures", { items: [] });
  refused("a21-facts", {
    rows: [{ label: "x", value: "y", href: "javascript:alert(1)" }],
  });
  refused("a21-facts", {
    rows: [{ label: "x", value: "y", href: "http://example.com" }],
  });
  refused("a21-table", {
    caption: "x",
    columns: [{ label: "a" }, { label: "b" }],
    rows: [["1", "2"], ["only one"]],
  });
  refused("a21-ladder", {
    title: "x",
    now: { label: "Now", value: 1 },
    measure: "odds",
    levels: [
      { value: 2, odds: 1 },
      { value: 3, odds: 1 },
      { value: 4, odds: 1 },
    ],
  });
  refused("a21-ladder", {
    title: "x",
    now: { label: "Now", value: 1 },
    measure: "odds",
    levels: [
      { value: 2, odds: 1 },
      { value: 3, odds: 1 },
      { value: 4, odds: 1 },
    ],
    market: {
      name: "m",
      url: "https://example.com/event",
      volume: 1,
      liquidity: 1,
    },
  });
  refused("a21-ladder", {
    title: "x",
    now: { label: "Now", value: 1 },
    measure: "distance",
    levels: [{ value: 2, odds: 5 }, { value: 3 }, { value: 4 }],
  });
  refused("a21-chart", { file: "../secrets.chart.json" });
  refused("a21-chart", { file: "chart.png" });
  refused("a21-chart", {
    file: "a.chart.json",
    page: "https://example.com/a.html",
  });
  refused("a21-step", `{"text": "${"x".repeat(20_001)}"}`);
  refused("a21-figures", { items: [{ label: "x", value: "12" }] });
  refused("a21-ladder", {
    title: "x",
    now: { label: "Now", value: 1 },
    measure: "odds",
    levels: [{ value: 2, odds: 140 }],
    market: {
      name: "m",
      url: "https://polymarket.com/event/x",
      volume: 1,
      liquidity: 1,
    },
  });
  refused("a21-sources", {
    items: [{ name: "x", url: "javascript:alert(1)" }],
  });
});

const data = <T>(block: ReturnType<typeof ok>) =>
  (block as unknown as { data: T }).data;

test("answer blocks fit length, count and style instead of refusing", () => {
  const step = data<{ text: string }>(
    ok("a21-step", { text: `I checked the ${"very ".repeat(40)}price.`, x: 1 }),
  );
  assert.match(step.text, /^Checked the very/);
  assert.ok(step.text.length <= 120 && step.text.endsWith("…"));
  assert.doesNotMatch(step.text, / …$/);
  assert.equal(
    data<{ text: string }>(ok("a21-step", { text: "We've pulled blocks." }))
      .text,
    "Pulled blocks.",
  );

  const figures = data<{ items: { format?: string }[] }>(
    ok("a21-figures", {
      items: Array(6).fill({ label: "x", value: 1, format: "money" }),
    }),
  );
  assert.equal(figures.items.length, 4);
  assert.equal(figures.items[0].format, undefined);

  const facts = data<{ rows: { label: string; value: string }[] }>(
    ok("a21-facts", {
      rows: [
        { label: "First transaction confirmed on chain", value: "2010-05-22" },
        { label: "Received", value: "0.99000000 BTC and 10.0 BTC" },
        { label: "Seen", value: "2010-05-22T18:16:31Z" },
        { label: "Hash", value: "2010-05-22 0.50 BTC", mono: true },
        ...Array(14).fill({ label: "x", value: "y" }),
      ],
    }),
  );
  assert.equal(facts.rows.length, 14);
  assert.ok(
    facts.rows[0].label.length <= 30 && facts.rows[0].label.endsWith("…"),
  );
  assert.equal(facts.rows[0].value, "May 22, 2010");
  assert.equal(facts.rows[1].value, "0.99 BTC and 10 BTC");
  assert.match(facts.rows[2].value, /^May 22, 2010, 6:16 PM UTC$/);
  assert.equal(facts.rows[3].value, "2010-05-22 0.50 BTC", "mono stays exact");

  const table = data<{
    columns: { format?: string }[];
    rows: unknown[][];
    note?: string;
  }>(
    ok("a21-table", {
      caption: "Every day",
      columns: Array(8).fill({ label: "c", format: "html" }),
      rows: Array.from({ length: 25 }, (_, i) => Array(8).fill(i)),
    }),
  );
  assert.equal(table.columns.length, 6);
  assert.equal(table.columns[0].format, undefined);
  assert.equal(table.rows.length, 20);
  assert.equal(table.rows[0].length, 6);
  assert.equal(table.note, "First 20 of 25 rows.");
  ok("a21-table", {
    caption: "One row",
    columns: [{ label: "a" }, { label: "b" }],
    rows: [["1", "2"]],
  });

  const ladder = data<{ levels: { value: number }[] }>(
    ok("a21-ladder", {
      title: "Levels",
      now: { label: "Now", value: 100 },
      measure: "distance",
      levels: Array.from({ length: 30 }, (_, i) => ({ value: 50 + i * 5 })),
    }),
  );
  assert.equal(ladder.levels.length, 24);
  assert.ok(!ladder.levels.some((level) => level.value >= 170));
  assert.ok(ladder.levels.some((level) => level.value === 50));

  const sources = data<{ items: { asOf?: string; published?: string }[] }>(
    ok("a21-sources", {
      items: [
        { name: "a", asOf: "2026-10-14", published: "2026-10-13" },
        { name: "b", asOf: "2026-13-40" },
        ...Array(9).fill({ name: "c" }),
      ],
    }),
  );
  assert.equal(sources.items.length, 8);
  assert.equal(sources.items[0].published, undefined);
  assert.equal(sources.items[0].asOf, "2026-10-14");
  assert.equal(sources.items[1].asOf, undefined);
});

test("numbers, dates and times follow the visual standards", () => {
  assert.equal(formatValue(82224, "usd"), "$82,224");
  assert.equal(formatValue(0.99, "usd"), "$0.99");
  assert.equal(formatValue(-1200, "usd"), "−$1,200");
  assert.equal(formatValue(41_250_000, "usd_compact"), "$41.3M");
  assert.equal(formatValue(1.6e12, "usd_compact"), "$1.6T");
  assert.equal(formatValue(10000, "btc"), "10,000 BTC");
  assert.equal(formatValue(0.25, "btc"), "0.25 BTC");
  assert.equal(formatValue(1250, "sats"), "1,250 sats");
  assert.equal(formatValue(0.46, "percent"), "46%");
  assert.equal(formatValue(0.058, "percent"), "5.8%");
  assert.equal(formatValue(0.46, "change"), "+46%");
  assert.equal(formatValue(-0.15, "change"), "−15%");
  assert.equal(formatValue(1.2, "pp"), "+1.2 pp");
  assert.equal(formatValue(971616, "number"), "971,616");
  assert.equal(formatValue(null, "usd"), "—");
  assert.equal(formatValue("2026-10-14", "date"), "Oct 14, 2026");
  assert.equal(formatDate("2026-10-14"), "Oct 14, 2026");
  assert.equal(
    formatTime("2026-10-15T19:21:00Z", "America/New_York"),
    "Oct 15, 2026, 3:21 PM EDT",
  );
});

test("answers keep their blocks findable, copyable and their charts placed", () => {
  const markdown = [
    "Lead **text**.",
    '```a21-step\n{"text": "Checked the price."}\n```',
    '```a21-chart\n{"file": "Price.chart.json"}\n```',
    "```a21-table\n{not json\n```",
    "```python\nprint(1)\n```",
    '```a21-sources\n{"items": [{"name": "BRK", "asOf": "2026-10-14"}]}\n```',
  ].join("\n\n");
  assert.deepEqual(
    extractBlocks(markdown).map((b) => b.language),
    ["a21-step", "a21-chart", "a21-table", "a21-sources"],
  );
  assert.deepEqual([...placedCharts(markdown)], ["Price.chart.json"]);
  const plain = plainAnswer(markdown);
  assert.match(
    plain,
    /^Lead \*\*text\*\*\.\n\nChecked the price\.\n\n\[Chart: Price\]/,
  );
  assert.match(plain, /Sources: BRK, Oct 14, 2026$/);
  assert.doesNotMatch(plain, /a21-|\{|not json/);
  assert.match(plain, /```python\nprint\(1\)\n```/);
});

test("months in an answer's text lose their period, code and blocks do not", () => {
  const text = [
    "The Fed meets Oct. 27–28 after its Sept. 16 hike; markets close Dec. 31.",
    "`Oct. 1` stays, and so does Dec. at the end of a sentence.",
    '```a21-step\n{"text":"Checked Oct. 14 data."}\n```',
  ].join("\n\n");
  assert.equal(
    tidyProse(text),
    [
      "The Fed meets Oct 27–28 after its Sep 16 hike; markets close Dec 31.",
      "`Oct. 1` stays, and so does Dec. at the end of a sentence.",
      '```a21-step\n{"text":"Checked Oct. 14 data."}\n```',
    ].join("\n\n"),
  );
});
