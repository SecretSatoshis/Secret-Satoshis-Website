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

test("answer blocks refuse what the website must not draw", () => {
  refused("a21-banner", { text: "x" });
  refused("a21-step", "{not json");
  refused("a21-step", { text: "x".repeat(121) });
  refused("a21-step", { text: "ok", color: "red" });
  refused("a21-figures", { items: [] });
  refused("a21-figures", { items: Array(5).fill({ label: "x", value: 1 }) });
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
  refused("a21-table", {
    caption: "x",
    columns: [{ label: "a" }, { label: "b" }],
    rows: [["1", "2"]],
  });
  refused("a21-table", {
    caption: "x",
    columns: [{ label: "a", format: "html" }, { label: "b" }],
    rows: [
      ["1", "2"],
      ["3", "4"],
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
  refused("a21-sources", { items: [{ name: "x", asOf: "2026-13-40" }] });
  refused("a21-sources", {
    items: [{ name: "x", asOf: "2026-10-14", published: "2026-10-13" }],
  });
  refused("a21-step", `{"text": "${"x".repeat(20_001)}"}`);
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
