import { figuresBlock, sourcesBlock, tableBlock } from "../blocks";
import { SourceError } from "../data/http";
import { BRK, brkRows } from "./brk";
import { opt, s, tool } from "./types";

// A savings plan on bitcoin's daily close, by the Investment Strategy's method:
// a line-for-line port of the vendored savings.run_plan and
// money_weighted_return, checked against them by the parity tests.
const DAY = 86_400_000;
const dayNumber = (iso: string) =>
  Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const weekday = (n: number) => new Date(n * DAY).getUTCDay();
const yearOf = (n: number) => new Date(n * DAY).getUTCFullYear();
const mod = (a: number, b: number) => ((a % b) + b) % b;

export type Cadence = "weekly" | "biweekly" | "monthly";
export type PlanOptions = {
  start: string;
  annualBtc: number;
  annualCash: number;
  cadence?: Cadence;
  cashApy?: number;
  stillBuying?: boolean;
  stopAfterYears?: number;
};
export type Prices = { dates: string[]; values: number[] };

/** Prices from the first positive close, on every calendar day (prepare_prices). */
function preparePrices(prices: Prices) {
  if (!prices.dates.length)
    throw new SourceError("A nonempty dated price series is required");
  const first = prices.values.findIndex((v) => v > 0);
  if (first < 0)
    throw new SourceError("No positive tradable prices are available");
  const days = prices.dates.slice(first).map(dayNumber);
  const values = prices.values.slice(first);
  for (let i = 0; i < days.length; i++) {
    if (!Number.isFinite(values[i]) || values[i] <= 0)
      throw new SourceError(
        "Tradable prices must be finite and positive on every day",
      );
    if (i && days[i] !== days[i - 1] + 1)
      throw new SourceError(
        "Tradable price history contains missing calendar days",
      );
  }
  return {
    first: days[0],
    last: days[days.length - 1],
    price: (d: number) => values[d - days[0]],
  };
}

function buyDays(start: number, last: number, cadence: Cadence) {
  const out: number[] = [];
  if (cadence === "monthly") {
    for (let d = start; d <= last; d++)
      if (new Date(d * DAY).getUTCDate() === 1) out.push(d);
    return out;
  }
  // Anchored weekly offsets roll the start forward to the first Monday.
  let d = start + mod(1 - weekday(start), 7);
  for (const step = cadence === "weekly" ? 7 : 14; d <= last; d += step)
    out.push(d);
  return out;
}

/** Scheduled contributions in a full calendar year on this plan's cadence. */
export function annualBuyCount(year: number, cadence: Cadence, anchor: number) {
  if (cadence === "monthly") return 12;
  const step = cadence === "weekly" ? 7 : 14;
  let count = 0;
  for (let d = dayNumber(`${year}-01-01`); d <= dayNumber(`${year}-12-31`); d++)
    if (weekday(d) === 1 && mod(d - anchor, step) === 0) count++;
  return count;
}

export function runPlan(prices: Prices, options: PlanOptions) {
  const {
    annualBtc,
    annualCash,
    cadence = "monthly",
    cashApy = 0.03,
    stillBuying = true,
  } = options;
  if (![annualBtc, annualCash, cashApy].every(Number.isFinite))
    throw new SourceError("Contributions and APY must be finite");
  if (
    Math.min(annualBtc, annualCash) < 0 ||
    annualBtc + annualCash <= 0 ||
    cashApy <= -1
  )
    throw new SourceError("Invalid contributions or APY");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.start))
    throw new SourceError("Start must be a UTC calendar date");
  const series = preparePrices(prices);
  const start = Math.max(dayNumber(options.start), series.first);
  const last = series.last;
  if (start > last)
    throw new SourceError(
      `PLAN_START (${isoOf(start)}) is after the last price date (${isoOf(last)}). Set an earlier start date, or refresh the price data.`,
    );
  let buys = buyDays(start, last, cadence);
  let stop: number | null = null;
  if (!stillBuying) {
    const years = options.stopAfterYears;
    if (years === undefined || !Number.isFinite(years) || years <= 0)
      throw new SourceError(
        "STOP_AFTER_YRS must be positive when STILL_BUYING is False.",
      );
    stop = start + years * 365.25;
    buys = buys.filter((d) => d < stop!);
  }
  if (!buys.length)
    throw new SourceError(
      "The plan makes no purchases with these settings; check PLAN_START and STOP_AFTER_YRS.",
    );

  // Each calendar year's budget spreads across its actual scheduled buys.
  const anchor = buys[0];
  const counts = new Map<number, number>();
  for (const d of buys)
    if (!counts.has(yearOf(d)))
      counts.set(yearOf(d), annualBuyCount(yearOf(d), cadence, anchor));
  const btcAmount = (d: number) => annualBtc / counts.get(yearOf(d))!;
  const cashAmount = (d: number) => annualCash / counts.get(yearOf(d))!;
  const dailyRate = (1 + cashApy) ** (1 / 365.25) - 1;
  const buySet = new Set(buys);

  let coins = 0;
  let cash = 0;
  let btcIn = 0;
  let cashIn = 0;
  const rows: {
    date: string;
    coins: number;
    btcValue: number;
    cashValue: number;
    btcContributed: number;
    cashContributed: number;
    price: number;
  }[] = [];
  for (let d = start; d <= last; d++) {
    cash *= 1 + dailyRate;
    const price = series.price(d);
    if (buySet.has(d)) {
      coins += btcAmount(d) / price;
      btcIn += btcAmount(d);
      cash += cashAmount(d);
      cashIn += cashAmount(d);
    }
    rows.push({
      date: isoOf(d),
      coins,
      btcValue: coins * price,
      cashValue: cash,
      btcContributed: btcIn,
      cashContributed: cashIn,
      price,
    });
  }
  return {
    rows: rows.map((r) => ({
      ...r,
      totalValue: r.btcValue + r.cashValue,
      totalContributed: r.btcContributed + r.cashContributed,
      costBasis: r.coins ? r.btcContributed / r.coins : null,
    })),
    stopDate: stop,
    stillContributing: stop === null || last < stop,
    buyDates: buys.map(isoOf),
    totalContributions: buys.map((d) => btcAmount(d) + cashAmount(d)),
  };
}

/** The annual rate that turns the contribution stream into the final value. */
export function moneyWeightedReturn(
  dates: string[],
  amounts: number[],
  finalValue: number,
  finalDate: string,
) {
  const contributed = amounts.reduce((a, b) => a + b, 0);
  if (!dates.length || contributed <= 0) return null;
  const end = dayNumber(finalDate);
  const ages = dates.map((d) => (end - dayNumber(d)) / 365.25);
  const elapsed = Math.max(end - Math.min(...dates.map(dayNumber)), 0) / 365.25;
  if (elapsed < 30 / 365.25) return null;
  if (finalValue <= 0) return -1;
  const npv = (r: number) =>
    ages.reduce((sum, age, i) => sum - amounts[i] * (1 + r) ** age, 0) +
    finalValue;
  let lo = -0.999;
  let hi = 100;
  let npvLo = npv(lo);
  if (npvLo * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npv(mid);
    if (npvLo * npvMid <= 0) hi = mid;
    else {
      lo = mid;
      npvLo = npvMid;
    }
  }
  return (lo + hi) / 2;
}

/** run_savings_plan: the plan, the same money held only as cash, and the summary. */
export function savingsPlan(prices: Prices, options: PlanOptions) {
  const schedule = {
    ...options,
    stillBuying: options.stopAfterYears === undefined,
  };
  const plan = runPlan(prices, schedule);
  const cashOnly = runPlan(prices, {
    ...schedule,
    annualBtc: 0,
    annualCash: options.annualBtc + options.annualCash,
  });
  const final = plan.rows[plan.rows.length - 1];
  const rate = moneyWeightedReturn(
    plan.buyDates,
    plan.totalContributions,
    final.totalValue,
    final.date,
  );
  return {
    plan,
    summary: {
      start_date: plan.rows[0].date,
      as_of: final.date,
      purchases: plan.buyDates.length,
      btc_held: final.coins,
      average_purchase_price_usd: final.costBasis,
      spot_price_usd: final.price,
      total_contributed_usd: final.totalContributed,
      total_value_usd: final.totalValue,
      total_gain_usd: final.totalValue - final.totalContributed,
      cash_only_value_usd: cashOnly.rows[cashOnly.rows.length - 1].totalValue,
      money_weighted_return_pct: rate === null ? null : rate * 100,
      still_contributing: plan.stillContributing,
      basis: "nominal USD, before fees and tax",
    },
  };
}

export const savingsPlanTool = tool<{
  start: string;
  annual_btc: number;
  annual_cash: number | null;
  cadence: Cadence | null;
  cash_apy: number | null;
  stop_after_years: number | null;
}>({
  name: "savings_plan",
  label: "Running analysis",
  description:
    "Runs a bitcoin savings plan on completed daily closes by Secret Satoshis' published method: buys on Mondays (weekly, biweekly) or the 1st (monthly) at that day's close, each year's amounts split evenly across its buys, cash earning cash_apy. Returns BTC held, value, contributions, the money-weighted annual return, the same contributions held only as cash and a year-by-year table, with ready blocks. Nominal USD, before fees and tax.",
  parameters: s.object({
    start: s.str("First day, YYYY-MM-DD"),
    annual_btc: s.num("USD a year into bitcoin"),
    annual_cash: s.nullable(s.num("USD a year into cash; default 0")),
    cadence: s.nullable(
      s.oneOf(
        ["weekly", "biweekly", "monthly"],
        "Buy cadence; default monthly",
      ),
    ),
    cash_apy: s.nullable(
      s.num("Cash yield as a fraction (0.03 for 3%); default 0.03"),
    ),
    stop_after_years: s.nullable(
      s.num("Stop contributing after this many years; null keeps buying"),
    ),
  }),
  async run(args, { log, now }) {
    const { rows } = await brkRows(
      { series: ["price_close"], start: args.start },
      log,
      now,
    );
    const prices = {
      dates: rows.map((r) => r.date as string),
      values: rows.map((r) =>
        typeof r.price_close === "number" ? r.price_close : Number.NaN,
      ),
    };
    const { plan, summary } = savingsPlan(prices, {
      start: args.start,
      annualBtc: args.annual_btc,
      annualCash: args.annual_cash ?? 0,
      cadence: opt(args.cadence),
      cashApy: args.cash_apy ?? 0.03,
      stopAfterYears: opt(args.stop_after_years),
    });
    const yearEnds = new Map<string, (typeof plan.rows)[number]>();
    for (const r of plan.rows) yearEnds.set(r.date.slice(0, 4), r);
    const byYear = [...yearEnds.entries()].map(([year, r]) => ({
      year,
      as_of: r.date,
      contributed_usd: r.totalContributed,
      value_usd: r.totalValue,
      btc_held: r.coins,
    }));
    const figures = [
      {
        label: "BTC held",
        value: summary.btc_held,
        format: "btc" as const,
        asOf: summary.as_of,
        kind: "calculated" as const,
      },
      {
        label: "Plan value",
        value: summary.total_value_usd,
        format: "usd" as const,
        asOf: summary.as_of,
        kind: "calculated" as const,
      },
      {
        label: "Contributed",
        value: summary.total_contributed_usd,
        format: "usd" as const,
        asOf: summary.as_of,
        kind: "calculated" as const,
      },
      ...(summary.money_weighted_return_pct === null
        ? [
            {
              label: "Cash only",
              value: summary.cash_only_value_usd,
              format: "usd" as const,
              asOf: summary.as_of,
              kind: "calculated" as const,
            },
          ]
        : [
            {
              label: "Annual return (money-weighted)",
              value: summary.money_weighted_return_pct / 100,
              format: "percent" as const,
              asOf: summary.as_of,
              kind: "calculated" as const,
            },
          ]),
    ];
    return {
      summary,
      by_year: byYear.slice(-20),
      blocks: {
        figures: figuresBlock(figures, true),
        table: tableBlock(
          byYear
            .slice(-20)
            .map((y) => [y.year, y.contributed_usd, y.value_usd, y.btc_held]),
          [
            { label: "Year" },
            { label: "Contributed", format: "usd" },
            { label: "Value", format: "usd" },
            { label: "BTC held", format: "btc" },
          ],
          "Savings plan by year",
          "Year-end values (latest year to date); nominal USD, before fees and tax.",
        ),
        sources: sourcesBlock([
          {
            name: "BRK",
            detail: "Daily closes (price_close)",
            url: BRK,
            asOf: summary.as_of,
          },
        ]),
      },
    };
  },
});
