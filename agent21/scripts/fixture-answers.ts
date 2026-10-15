// A local conversation with one answer per response pattern, for checking the
// answer blocks in the chat without the agent.
// It writes to the configured database and Blob store, so it runs only against
// a loopback APP_ORIGIN, never a deployment. The values are illustrative.
import { randomUUID } from "node:crypto";
import { formatDate } from "../lib/agent21/blocks";
import { validChart } from "../lib/agent21/charts";
import { closeDatabase, db } from "../lib/agent21/db";
import { fileView, reserveFile, retainFile } from "../lib/agent21/files";
import { saveMessage } from "../lib/agent21/history";
import { createConversation } from "../lib/agent21/service";
import type { FileView } from "../lib/agent21/types";

const owner = process.argv[2] ?? "";
const CHART_PAGE =
  "https://charts.secretsatoshis.com/Bitcoin_Realized_Price.html";
const CHART_NAME = "Bitcoin_Realized_Price.chart.json";

/** The published chart's payload, cut to its last five years. */
async function chartPayload() {
  const html = await (await fetch(CHART_PAGE)).text();
  const json = html.match(
    /<script id="chart-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!json) throw new Error("The published chart page has no chart data.");
  const payload = JSON.parse(json);
  const from = Math.max(0, payload.x.length - 5 * 365);
  payload.x = payload.x.slice(from);
  for (const series of payload.series) {
    const start = series.start ?? 0;
    series.values = series.values.slice(Math.max(0, from - start));
    series.start = Math.max(0, start - from);
  }
  payload.events = (payload.events ?? []).filter(
    (event: { date: string }) => event.date >= payload.x[0],
  );
  const text = JSON.stringify(payload);
  if (!validChart(text))
    throw new Error("The trimmed chart is not a valid payload.");
  return Buffer.from(text);
}

const block = (type: string, value: unknown) =>
  `\`\`\`a21-${type}\n${JSON.stringify(value)}\n\`\`\``;
const answer = (...parts: string[]) => parts.join("\n\n");
const now = new Date().toISOString().slice(0, 16) + ":00Z";
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function turns(chart: FileView): [string, string, FileView[]][] {
  return [
    [
      "What does the halving actually change?",
      answer(
        block("step", { text: "Checked Bitcoin’s current block height." }),
        "Every 210,000 blocks, roughly every four years, the new bitcoin paid to miners in each block is cut in half. The April 2024 halving cut it from 6.25 to **3.125 BTC**.",
        "The next halving comes at block **1,050,000**, about 78,500 blocks from now: roughly 18 months at ten minutes a block. The 21 million limit stays the same.",
        block("sources", {
          items: [{ name: "BRK", detail: "block 971,616", asOf: now }],
        }),
      ),
      [],
    ],
    [
      "What is Bitcoin trading at, and how far is it from realized price?",
      answer(
        block("step", { text: "Checked Bitcoin’s price and realized price." }),
        block("figures", {
          items: [
            {
              label: "Bitcoin price",
              value: 82224,
              format: "usd",
              change: -0.058,
              changeLabel: "year to date",
              asOf: now,
            },
            {
              label: "Realized price",
              value: 53835,
              format: "usd",
              asOf: yesterday,
            },
            {
              label: "Above realized",
              value: 0.527,
              format: "percent",
              kind: "calculated",
            },
          ],
        }),
        "Bitcoin sits **53% above** its realized price, the average price at which every coin last moved.",
        block("sources", {
          items: [
            { name: "BRK price", asOf: now },
            { name: "Report Library release", asOf: yesterday },
          ],
        }),
      ),
      [],
    ],
    [
      "How does Bitcoin’s current price compare with our year-end scenarios?",
      answer(
        block("step", {
          text: "Compared the published outlook with recent price data.",
        }),
        "At **$82,224**, Bitcoin is down 5.8% for the year. Reaching the **$120,000** base case would take a 46% rise in the 11 weeks left.",
        block("table", {
          caption: "Year-end cases against the current price",
          columns: [
            { label: "Case" },
            { label: "Target", format: "usd" },
            { label: "Move needed", format: "change" },
          ],
          rows: [
            ["Bull case", 160000, 0.946],
            ["Base case", 120000, 0.459],
            ["Bear case", 70000, -0.149],
          ],
          note: "Targets from the Secret Satoshis 2026 outlook.",
        }),
        "The bear case is closer than the base case, but the outlook’s support at $73,757 sits between them.",
        block("sources", {
          items: [
            {
              name: "Secret Satoshis 2026 outlook",
              url: "https://newsletter.secretsatoshis.com/",
              published: "2026-01-05",
            },
            { name: "Report Library release", asOf: yesterday },
            { name: "BRK price", asOf: now },
          ],
        }),
      ),
      [],
    ],
    [
      "Where does Bitcoin sit against its cost-basis levels?",
      answer(
        block("step", {
          text: "Compared Bitcoin’s price with its realized-price levels.",
        }),
        "Bitcoin trades **10% above** the short-term holder realized price, the level recent buyers paid on average.",
        block("ladder", {
          title: "Bitcoin’s price against its cost-basis levels",
          now: { label: "Now", value: 82224 },
          measure: "distance",
          levels: [
            { value: 161505, label: "3x realized price" },
            { value: 74431, label: "Short-term holder realized price" },
            { value: 53835, label: "Realized price" },
          ],
        }),
        block("sources", {
          items: [{ name: "BRK", detail: "realized prices", asOf: now }],
        }),
      ),
      [],
    ],
    [
      "Chart Bitcoin’s price against realized price over the past five years.",
      answer(
        block("step", {
          text: "Compared Bitcoin’s price and realized price over five years.",
        }),
        "Bitcoin has held above its realized price since early 2023; the last stretch below it ran from June 2022 to January 2023.",
        block("chart", { file: chart.name, page: CHART_PAGE }),
        "The 3x realized price has marked cycle tops; Bitcoin is well below it today.",
        block("sources", {
          items: [
            { name: "Chart Library", url: CHART_PAGE },
            { name: "Report Library release", asOf: yesterday },
          ],
        }),
      ),
      [chart],
    ],
    [
      "What odds does Polymarket give Bitcoin of reaching different prices this year?",
      answer(
        block("step", {
          text: "Checked Polymarket’s price odds, volume and liquidity.",
        }),
        "The market gives a **59.5%** chance of a touch of $90,000 before the year ends, and 36.5% for $70,000.",
        block("ladder", {
          title: "Odds Bitcoin touches each price in 2026",
          now: { label: "Now", value: 82224 },
          measure: "odds",
          levels: [
            { value: 150000, odds: 2.2 },
            { value: 120000, odds: 6.5 },
            { value: 100000, odds: 23.5 },
            { value: 90000, odds: 59.5 },
            { value: 70000, odds: 36.5 },
            { value: 60000, odds: 16.5 },
            { value: 50000, odds: 7.5 },
          ],
          market: {
            name: "What price will Bitcoin hit in 2026?",
            url: "https://polymarket.com/event/what-price-will-bitcoin-hit-in-2026",
            volume: 41250000,
            liquidity: 2310000,
          },
        }),
        "Each figure is the odds of a touch at any minute before 2027, not a forecast of the year-end close.",
        block("sources", {
          items: [
            {
              name: "Polymarket",
              url: "https://polymarket.com/event/what-price-will-bitcoin-hit-in-2026",
              asOf: now,
            },
          ],
        }),
      ),
      [],
    ],
    [
      "Look up the 2010 pizza transaction.",
      answer(
        block("step", { text: "Retrieved the transaction details." }),
        "It is the 2010 pizza transaction: **131 inputs** into a single **10,000 BTC** output, with a 0.99 BTC fee.",
        block("facts", {
          title: "Transaction a1075db5…d48d",
          rows: [
            { label: "Status", value: "Confirmed" },
            { label: "Block", value: "57,043 · May 22, 2010, 18:16:31 UTC" },
            { label: "Inputs", value: "131 legacy (P2PKH) · 10,000.99 BTC" },
            {
              label: "Output",
              value: "1 · 10,000 BTC to 17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ",
              mono: true,
            },
            { label: "Fee", value: "0.99 BTC" },
            { label: "Confirmations", value: "914,574 at block 971,616" },
          ],
        }),
        block("sources", {
          items: [{ name: "BRK", detail: "block 971,616", asOf: now }],
        }),
      ),
      [],
    ],
    [
      "Compare Bitcoin, gold and the S&P 500 this year.",
      answer(
        block("step", {
          text: "Compared year-to-date returns and volatility.",
        }),
        "Gold leads this year; Bitcoin is behind with the most volatility.",
        block("table", {
          caption: `Year to date through ${formatDate(yesterday)}`,
          columns: [
            { label: "Asset" },
            { label: "Return", format: "change" },
            { label: "Volatility", format: "percent" },
            { label: "Last close", format: "usd2" },
          ],
          rows: [
            ["Gold", 0.312, 0.164, 4012.5],
            ["S&P 500", 0.143, 0.152, 6805.12],
            ["Bitcoin", -0.058, 0.421, 81334.84],
          ],
          note: "Annualized volatility of daily returns, market days.",
        }),
        block("sources", {
          items: [{ name: "Report Library release", asOf: yesterday }],
        }),
      ),
      [],
    ],
    [
      "What did the latest weekly recap say?",
      answer(
        "The recap argued that ETF inflows returned while long-term holders kept distributing ([Weekly Bitcoin Recap](https://newsletter.secretsatoshis.com/t/weekly-bitcoin-recap), published Oct 13).",
        block("sources", {
          items: [
            {
              name: "Weekly Bitcoin Recap",
              url: "https://newsletter.secretsatoshis.com/t/weekly-bitcoin-recap",
              published: "2026-10-13",
            },
          ],
        }),
      ),
      [],
    ],
    [
      "Show me the broken-block fallback.",
      answer(
        "The next two blocks are invalid on purpose: one is not JSON and one breaks the schema.",
        "```a21-table\n{not json\n```",
        block("ladder", {
          title: "Too few levels",
          now: { label: "Now", value: 1 },
          measure: "distance",
          levels: [{ value: 2 }],
        }),
        "An unknown language stays an ordinary code block:",
        '```a21-banner\n{"text": "hello"}\n```',
      ),
      [],
    ],
  ];
}

try {
  if (!/^user_[A-Za-z0-9]+$/.test(owner))
    throw new Error("Usage: pnpm fixture <Clerk user ID>");
  if (
    process.env.NODE_ENV === "production" ||
    !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(
      process.env.APP_ORIGIN ?? "",
    )
  )
    throw new Error("Fixtures run only against a local APP_ORIGIN.");
  const { id } = await createConversation(owner, { requestId: randomUUID() });
  await db()
    .updateTable("agent21_conversations")
    .set({ title: "Response design fixtures" })
    .where("id", "=", id)
    .execute();
  const bytes = await chartPayload();
  const row = await reserveFile(
    owner,
    id,
    CHART_NAME,
    bytes.length,
    "application/json",
    "artifact",
  );
  await retainFile(row, bytes);
  const chart = fileView({ ...row, state: "ready", bytes: bytes.length });
  let minute = 0;
  for (const [question, text, files] of turns(chart)) {
    const at = (offset: number) =>
      new Date(Date.now() + (minute + offset) * 1000).toISOString();
    await saveMessage(id, owner, `fixture-user-${minute}`, {
      role: "user",
      text: question,
      createdAt: at(0),
    });
    await saveMessage(id, owner, `fixture-answer-${minute}`, {
      role: "assistant",
      text,
      createdAt: at(1),
      files,
    });
    minute += 2;
  }
  console.log(
    `Fixture conversation: ${process.env.APP_ORIGIN}/c/${id} (${today})`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
