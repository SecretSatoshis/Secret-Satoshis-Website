import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  costBasisAnswer,
  halvingAnswer,
  outlookAnswer,
  pizzaAnswer,
  priceOddsAnswer,
} from "../components/agent21/landing/example-answers";
import {
  SNAPSHOT_HEIGHT,
  SNAPSHOT_ODDS,
  loadChainHeight,
  loadPriceOdds,
  priceOddsFromEvent,
} from "../components/agent21/landing/live-examples";
import {
  SNAPSHOT_FACTS,
  loadExampleFacts,
  type ExampleFacts,
} from "../components/agent21/landing/example-facts";

// The landing page's data-driven examples: each wording branch, and the
// fallback to a snapshot whenever a source is unusable.

const text = (nodes: React.ReactNode[]) =>
  renderToStaticMarkup(createElement("div", null, ...nodes))
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const facts = (change: (f: ExampleFacts) => void = () => {}) => {
  const copy = structuredClone(SNAPSHOT_FACTS);
  change(copy);
  return copy;
};

test("the bundled snapshot reads like the Oct 7 release", () => {
  const market = text(costBasisAnswer(SNAPSHOT_FACTS));
  assert.match(
    market,
    /Bitcoin's October 7 close of \$83,172 sits 55% above the realized price of \$53,779 and 12% above the STH realized price of \$74,206\. It has closed above that level every day since August 19\./,
  );
  assert.match(market, /Bitcoin last closed above it on April 17, 2021\./);
  assert.match(
    market,
    /ran from June 2022 to January 2023, with 180 closes below it\./,
  );
  const outlook = text(outlookAnswer(SNAPSHOT_FACTS));
  assert.match(outlook, /Bitcoin is down 4\.7% for the year\./);
  assert.match(
    outlook,
    /Reaching the \$120,000 base case would take a 44% rise in the 12 weeks left\./,
  );
  assert.match(outlook, /It sits 19% above the \$70,000 bear case\./);
  assert.match(
    outlook,
    /from \$123,102 on October 8, 2025 to \$58,367 on June 30, 2026\./,
  );
  assert.match(
    outlook,
    /support at \$73,757 \(2024 Prior ATH\) and resistance at \$100,000 \(Psychological Level\)\./,
  );
  assert.match(outlook, /Base case\$120,000\+44%/);
});

test("price below the STH level, or crossing it on the day, reads that way", () => {
  const below = text(
    costBasisAnswer(
      facts((f) => {
        f.cost_basis.close = 70000;
        f.cost_basis.sth_side = "below";
        f.cost_basis.sth_side_since = "2026-09-01";
      }),
    ),
  );
  assert.match(below, /6% below the STH realized price/);
  assert.match(below, /closed below that level every day since September 1\./);
  const crossed = text(
    costBasisAnswer(
      facts((f) => {
        f.cost_basis.sth_side_since = f.report_date;
      }),
    ),
  );
  assert.match(crossed, /It moved above that level on this close\./);
});

test("a stretch below realized price that is still running is described as ongoing", () => {
  const market = text(
    costBasisAnswer(
      facts((f) => {
        f.cost_basis.close = 50000;
        f.cost_basis.last_stretch_below_realized = {
          start: "2026-08-03",
          end: f.report_date,
          days: 40,
        };
      }),
    ),
  );
  assert.match(market, /7% below the realized price/);
  assert.match(
    market,
    /It has closed below realized price on 40 days since August 2026\./,
  );
});

test("a close past the base case and the last days of the year read that way", () => {
  const passed = text(
    outlookAnswer(
      facts((f) => {
        f.outlook.close = 125000;
      }),
    ),
  );
  assert.match(passed, /Bitcoin is up 43\.2% for the year\./);
  assert.match(passed, /already 4% above the \$120,000 base case\./);
  const late = text(
    outlookAnswer(
      facts((f) => {
        f.outlook.days_left_in_year = 5;
      }),
    ),
  );
  assert.match(late, /rise in the 5 days left\./);
});

// Each fallback logs a sanitized warning; the tests silence and count them.
// `fetch` is one mock whose response each step swaps.
function sources(t: TestContext) {
  const logged = t.mock.method(console, "warn", () => {});
  const fetched = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(),
  );
  const respond = (reply: () => Promise<Response>) =>
    fetched.mock.mockImplementation(reply);
  return { logged, respond };
}

test("the loader falls back to the snapshot when the file is unusable", async (t) => {
  const { logged, respond } = sources(t);
  const json =
    (body: unknown, status = 200) =>
    () =>
      Promise.resolve(Response.json(body, { status }));
  respond(json({ schema_version: 2 }));
  assert.equal(await loadExampleFacts(), SNAPSHOT_FACTS);
  respond(json(SNAPSHOT_FACTS, 404));
  assert.equal(await loadExampleFacts(), SNAPSHOT_FACTS);
  respond(() => Promise.reject(new Error("offline")));
  assert.equal(await loadExampleFacts(), SNAPSHOT_FACTS);
  const newer = facts((f) => {
    f.report_date = "2026-10-08";
  });
  respond(json(newer));
  assert.equal((await loadExampleFacts()).report_date, "2026-10-08");
  assert.equal(logged.mock.callCount(), 3);
});

const CLOSE = { date: "2026-10-07", price: 83172 };
const market = (title: string, yes: number | null, closed = false) => ({
  groupItemTitle: title,
  outcomePrices:
    yes === null ? null : JSON.stringify([String(yes), String(1 - yes)]),
  closed,
});
const event = (markets: unknown[], closed = false) => ({
  title: "What price will Bitcoin hit in 2026?",
  slug: "what-price-will-bitcoin-hit-before-2027",
  volume: 74227369.5,
  liquidity: "4255770.1",
  closed,
  markets,
});

test("the Polymarket ladder keeps the nearest open, untouched strikes on each side", () => {
  const odds = priceOddsFromEvent(
    event([
      market("↑ 90,000", 0.59),
      market("↑ 90,000", 1, true), // an older market that already resolved
      market("↑ 85,000", 0.999), // touched, waiting to resolve
      market("↑ 80,000", 0.9), // below the close
      ...[95, 100, 110, 120, 130, 140, 150, 160, 200].map((k) =>
        market(`↑ ${k},000`, 0.5 / k),
      ),
      market("↓ 70,000", 0.395),
      market("↓ 65,000", 0.235),
      market("↓ 90,000", 0.2), // above the close
      market("↓ 60,000", null),
      market("↓ 55,000", 0.11),
    ]),
    2026,
    CLOSE,
    "2026-10-09T13:06:19.000Z",
  );
  assert.ok(odds);
  assert.deepEqual(odds.close, CLOSE);
  assert.deepEqual(
    odds.up.map((s) => s.price),
    [150000, 140000, 130000, 120000, 110000, 100000, 95000, 90000],
  );
  assert.equal(odds.up.at(-1)!.odds, 59);
  assert.deepEqual(
    odds.down.map((s) => [s.price, s.odds]),
    [
      [70000, 39.5],
      [65000, 23.5],
      [55000, 11],
    ],
  );
  assert.equal(odds.liquidity, 4255770.1);
  assert.equal(priceOddsFromEvent(event([], true), 2026, CLOSE, ""), null);
  assert.equal(
    priceOddsFromEvent(event([market("↑ 90,000", 0.5)]), 2026, CLOSE, ""),
    null,
  );
});

test("the Polymarket answer names the nearest strikes and the base case", () => {
  const answer = text(priceOddsAnswer(SNAPSHOT_ODDS, SNAPSHOT_FACTS));
  assert.match(
    answer,
    /with \$74\.2 million traded and \$4\.3 million in liquidity, puts a 59% chance on Bitcoin touching \$90,000 before the year ends and 7\.5% on \$120,000, the outlook's base case\./,
  );
  assert.match(
    answer,
    /prices 39\.5% for a touch of \$70,000 and 15\.5% for \$60,000\. .* before 2027,/,
  );
  assert.match(answer, /Oct 7 close · \$83,172/);
  // The snapshot ladder keeps the close its strikes were chosen against.
  const later = text(
    priceOddsAnswer(
      SNAPSHOT_ODDS,
      facts((f) => {
        f.report_date = "2026-10-20";
        f.cost_basis.close = 96000;
      }),
    ),
  );
  assert.match(later, /Oct 7 close · \$83,172/);
});

test("the halving answer counts from the current block", () => {
  const now = text(
    halvingAnswer({ height: 970543, retrievedAt: "2026-10-08T23:52:00Z" }),
  );
  assert.match(
    now,
    /The April 2024 halving at block 840,000 cut it from 6\.25 to 3\.125 BTC\./,
  );
  assert.match(
    now,
    /block 1,050,000, 79,457 blocks after the current block: about 18 months at ten minutes a block\./,
  );
  const close = text(halvingAnswer({ height: 1049900, retrievedAt: "" }));
  assert.match(close, /100 blocks after the current block: less than two days/);
  const after = text(halvingAnswer({ height: 1050001, retrievedAt: "" }));
  assert.match(
    after,
    /The last halving at block 1,050,000 cut it from 3\.125 to 1\.5625 BTC\./,
  );
  assert.match(
    after,
    /block 1,260,000, 209,999 blocks after the current block/,
  );
});

test("the transaction's confirmations follow the current block", () => {
  const answer = text(
    pizzaAnswer(SNAPSHOT_FACTS, { height: 970633, retrievedAt: "" }),
  );
  assert.match(answer, /913,591 at block 970,633/);
  assert.match(answer, /worth about \$832 million/);
});

test("live loaders use the response date and fall back to their snapshots", async (t) => {
  const { logged, respond } = sources(t);
  const date = "Fri, 09 Oct 2026 13:06:19 GMT";
  respond(async () => new Response("970633", { headers: { date } }));
  assert.deepEqual(await loadChainHeight(), {
    height: 970633,
    retrievedAt: "2026-10-09T13:06:19.000Z",
  });
  respond(async () => new Response("not a block"));
  assert.equal(await loadChainHeight(), SNAPSHOT_HEIGHT);
  respond(() => Promise.reject(new Error("offline")));
  assert.equal(await loadPriceOdds(CLOSE), SNAPSHOT_ODDS);
  respond(async () => Response.json(event([market("↑ 90,000", 0.5)])));
  assert.equal(await loadPriceOdds(Promise.resolve(CLOSE)), SNAPSHOT_ODDS);
  assert.equal(logged.mock.callCount(), 3);
});
