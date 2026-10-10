import { useEffect, useRef, useState } from "react";
import type { ExampleFacts } from "./example-facts";
import type {
  ChainHeight,
  Close,
  PriceOdds,
  RealizedLevels,
} from "./live-examples";

// Templates for the examples built from data: the daily release facts, the
// price now and the live block height and Polymarket ladder. The wording is
// fixed; every figure and date comes from the data, and each sentence that
// depends on the market's direction has a version for either side. A price
// with no `at` is the release's latest close, and reads as that close.

type CostBasis = ExampleFacts["cost_basis"];
type Outlook = ExampleFacts["outlook"];

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const percent = (n: number) => `${Math.round(Math.abs(n))}%`;
const change = (to: number, from: number) => (to / from - 1) * 100;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const format = (iso: string, options: Intl.DateTimeFormatOptions) =>
  utc(iso).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });

/** "Oct 7, 2026" */
export const shortDate = (iso: string) =>
  format(iso, { month: "short", day: "numeric", year: "numeric" });
/** "October 7", with the year when it differs from `year`. */
const longDate = (iso: string, year: number) =>
  format(iso, {
    month: "long",
    day: "numeric",
    ...(utc(iso).getUTCFullYear() === year ? {} : { year: "numeric" }),
  });
/** "June 2022" */
const monthYear = (iso: string) =>
  format(iso, { month: "long", year: "numeric" });
const DAY_MS = 86_400_000;
/** Days from `iso` to December 31 of its year. */
const daysLeftInYear = (iso: string) =>
  Math.round(
    (Date.UTC(utc(iso).getUTCFullYear(), 11, 31) - utc(iso).getTime()) / DAY_MS,
  );
/** The release's latest close, as a price with no `at`. */
const latestClose = (facts: ExampleFacts): Close => ({
  date: facts.report_date,
  price: facts.cost_basis.close,
});

const VIEW = { w: 600, h: 236 };
const PLOT = { x0: 44, x1: 590, y0: 212, y1: 12 };

/** The point under the pointer, by its x position in the chart. A mouse
 * picks it on hover; touch picks it on a tap, never as a scroll starts, and a
 * tap elsewhere puts it away; the arrow keys step through it. `keyed` is set
 * while the keyboard is choosing, so only those choices are announced. */
function usePoint(xs: number[]) {
  const ref = useRef<SVGSVGElement>(null);
  const [point, setPoint] = useState<number | null>(null);
  const [keyed, setKeyed] = useState(false);
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - box.left) / box.width) * VIEW.w;
    let best = 0;
    xs.forEach((x, i) => {
      if (Math.abs(x - at) < Math.abs(xs[best] - at)) best = i;
    });
    setKeyed(false);
    setPoint(best);
  };
  useEffect(() => {
    if (point === null) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPoint(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [point]);
  const svg = {
    ref,
    tabIndex: 0,
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType !== "touch") pick(e);
    },
    onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === "touch") pick(e);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType !== "touch" || point !== null) pick(e);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") setPoint(null);
    },
    onBlur: () => setPoint(null),
    onKeyDown: (e: React.KeyboardEvent) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      setKeyed(true);
      setPoint((p) =>
        Math.min(xs.length - 1, Math.max(0, (p ?? xs.length) + step)),
      );
    },
  };
  return [point, svg, keyed] as const;
}

type ReadoutRow = [label: string, value: string, color?: string];

/** The readout beside the hovered point, on whichever side has room, and
 * spoken for screen readers when the keyboard moves it. */
function Readout({
  x,
  title,
  rows,
}: {
  x: number;
  title: string;
  rows: ReadoutRow[];
}) {
  return (
    <div
      className="uc-tip"
      data-side={x > VIEW.w / 2 ? "left" : "right"}
      style={{ left: `${(x / VIEW.w) * 100}%` }}
    >
      <b>{title}</b>
      {rows.map(([label, value, color]) => (
        <div key={label}>
          {color && <i style={{ background: color }} />}
          {label}
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

function Spoken({ text }: { text: string }) {
  return (
    <p className="uc-sr" aria-live="polite">
      {text}
    </p>
  );
}
const spoken = ({ title, rows }: { title: string; rows: ReadoutRow[] }) =>
  `${title}: ${rows.map(([label, value]) => `${label} ${value}`).join(", ")}`;

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="uc-legend">
      {items.map(([label, color]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function CostBasisChart({
  chart,
  now = false,
}: {
  chart: CostBasis["chart"];
  /** The last point is the price and levels now, not a weekly reading. */
  now?: boolean;
}) {
  const bands: [string, number[], string][] = [
    ["3x Realized Price", chart.realized_price_3x, "#b39aee"],
    ["STH Realized Price", chart.sth_realized_price, "#5fd4d0"],
    ["Realized Price", chart.realized_price, "#6d9eff"],
    ["Bitcoin Price", chart.price, "#f7931a"],
  ];
  const values = bands.flatMap(([, s]) => s);
  const lo = Math.log(Math.min(...values) * 0.85);
  const hi = Math.log(Math.max(...values) * 1.15);
  const y = (v: number) =>
    PLOT.y0 - ((Math.log(v) - lo) / (hi - lo)) * (PLOT.y0 - PLOT.y1);
  const first = utc(chart.dates[0]).getTime();
  const span = utc(chart.dates.at(-1)!).getTime() - first;
  const x = (iso: string) =>
    PLOT.x0 + ((utc(iso).getTime() - first) / span) * (PLOT.x1 - PLOT.x0);
  const ticks = [5e3, 1e4, 2e4, 4e4, 8e4, 16e4, 32e4, 64e4].filter(
    (t) => Math.log(t) > lo && Math.log(t) < hi,
  );
  const years: number[] = [];
  for (
    let year = utc(chart.dates[0]).getUTCFullYear() + 1;
    year <= utc(chart.dates.at(-1)!).getUTCFullYear();
    year++
  )
    years.push(year);
  const xs = chart.dates.map(x);
  const points = (series: number[]) =>
    series.map((v, i) => `${xs[i].toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const [point, svg, keyed] = usePoint(xs);
  const readout = (i: number) => ({
    title:
      now && i === chart.dates.length - 1
        ? `Now · ${shortDate(chart.dates[i])}`
        : shortDate(chart.dates[i]),
    rows: bands
      .map(([label, series, color]) => ({ label, v: series[i], color }))
      .sort((a, b) => b.v - a.v)
      .map(({ label, v, color }): ReadoutRow => [label, usd(v), color]),
  });
  return (
    <figure className="uc-chart">
      <figcaption className="uc-chart-t">
        <span>Bitcoin Realized Price</span>
        <span>
          {shortDate(chart.dates[0])} – {shortDate(chart.dates.at(-1)!)} · USD,
          log scale
        </span>
      </figcaption>
      <div className="uc-plot">
        <svg
          viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
          role="img"
          aria-label="Bitcoin price over five years on a log scale, with realized price, STH realized price and 3x realized price"
          {...svg}
        >
          <g stroke="#1c1c2e">
            {ticks.map((t) => (
              <line key={t} x1={PLOT.x0} x2={PLOT.x1} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          <g fill="#82829c" fontSize="10">
            {ticks.map((t) => (
              <text key={t} x="38" y={y(t) + 3} textAnchor="end">
                ${t / 1000}k
              </text>
            ))}
            {years.map((year) => (
              <text
                key={year}
                x={x(`${year}-01-01`)}
                y="230"
                textAnchor="middle"
              >
                {year}
              </text>
            ))}
          </g>
          {bands.map(([label, series, color]) => (
            <polyline
              key={label}
              fill="none"
              stroke={color}
              strokeWidth={label === "Bitcoin Price" ? 2 : 1.5}
              strokeLinejoin="round"
              points={points(series)}
            />
          ))}
          {point !== null && (
            <g className="uc-cross">
              <line x1={xs[point]} x2={xs[point]} y1={PLOT.y1} y2={PLOT.y0} />
              {bands.map(([label, series, color]) => (
                <circle
                  key={label}
                  cx={xs[point]}
                  cy={y(series[point])}
                  r="3.5"
                  fill={color}
                />
              ))}
            </g>
          )}
        </svg>
        {point !== null && <Readout x={xs[point]} {...readout(point)} />}
        <Spoken text={keyed && point !== null ? spoken(readout(point)) : ""} />
      </div>
      <Legend items={bands.map(([label, , color]) => [label, color])} />
    </figure>
  );
}

const caseNamed = (o: Outlook, name: string) =>
  o.cases.find((c) => c.name.toLowerCase().startsWith(name));

/** The weekly candles with the current week brought up to the price now: the
 * week to date when `now` falls in it, or a new week that opens at the last
 * close. The window stays the same number of weeks. */
function toDate(candles: Outlook["weekly_candles"], now: Close) {
  const last = candles.at(-1)!;
  const day = utc(now.date).getTime();
  const lastStart = utc(last.start).getTime();
  if (day < lastStart) return candles;
  const p = now.price;
  if (day < lastStart + 7 * DAY_MS)
    return last.complete
      ? candles
      : [
          ...candles.slice(0, -1),
          {
            ...last,
            high: Math.max(last.high, p),
            low: Math.min(last.low, p),
            close: p,
          },
        ];
  const weeks = Math.floor((day - lastStart) / (7 * DAY_MS));
  const start = new Date(lastStart + weeks * 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return [
    ...candles.slice(1),
    {
      start,
      open: last.close,
      high: Math.max(last.close, p),
      low: Math.min(last.close, p),
      close: p,
      complete: false,
    },
  ];
}

function OutlookChart({
  outlook,
  candles,
  through,
}: {
  outlook: Outlook;
  candles: Outlook["weekly_candles"];
  /** The day the last candle runs to. */
  through: string;
}) {
  const base = caseNamed(outlook, "base");
  const bear = caseNamed(outlook, "bear");
  const step = 5000;
  const levels = [base?.price, bear?.price].filter((v): v is number => !!v);
  const lo =
    Math.floor(
      (Math.min(...candles.map((c) => c.low), ...levels) * 0.95) / step,
    ) * step;
  const hi =
    Math.ceil(
      (Math.max(...candles.map((c) => c.high), ...levels) * 1.03) / step,
    ) * step;
  const y = (v: number) =>
    PLOT.y0 - ((v - lo) / (hi - lo)) * (PLOT.y0 - PLOT.y1);
  const slot = (PLOT.x1 - PLOT.x0) / candles.length;
  const x = (i: number) => PLOT.x0 + slot * (i + 0.5);
  const width = slot * 0.62;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / 20000) * 20000; t < hi; t += 20000) ticks.push(t);
  // Quarter starts, kept clear of the right edge.
  const months = candles
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => {
      const d = utc(c.start);
      return d.getUTCMonth() % 3 === 0 && d.getUTCDate() <= 7;
    })
    .filter(({ i }) => x(i) < PLOT.x1 - 24);
  const [point, svg, keyed] = usePoint(candles.map((_, i) => x(i)));
  const readout = (i: number) => {
    const c = candles[i];
    const up = c.close >= c.open;
    return {
      title: `Week of ${shortDate(c.start)}${c.complete ? "" : " · to date"}`,
      rows: [
        ["Open", usd(c.open)],
        ["High", usd(c.high)],
        ["Low", usd(c.low)],
        ["Close", usd(c.close)],
        [
          "Change",
          `${up ? "+" : "−"}${Math.abs(change(c.close, c.open)).toFixed(1)}%`,
          up ? "#00e5a0" : "#ef4444",
        ],
      ] as ReadoutRow[],
    };
  };
  const halo = {
    stroke: "#060610",
    strokeWidth: 4,
    strokeDasharray: "none",
    paintOrder: "stroke" as const,
  };
  return (
    <figure className="uc-chart">
      <figcaption className="uc-chart-t">
        <span>Bitcoin Weekly Candles</span>
        <span>
          {shortDate(candles[0].start)} – {shortDate(through)} · USD
        </span>
      </figcaption>
      <div className="uc-plot">
        <svg
          viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
          role="img"
          aria-label={`${candles.length} weekly Bitcoin candles with the ${outlook.year} outlook's base and bear cases`}
          {...svg}
        >
          <g stroke="#1c1c2e">
            {ticks.map((t) => (
              <line key={t} x1={PLOT.x0} x2={PLOT.x1} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          {point !== null && (
            <rect
              className="uc-week"
              x={x(point) - slot / 2}
              y={PLOT.y1}
              width={slot}
              height={PLOT.y0 - PLOT.y1}
            />
          )}
          <g fill="#82829c" fontSize="10">
            {ticks.map((t) => (
              <text key={t} x="38" y={y(t) + 3} textAnchor="end">
                ${t / 1000}k
              </text>
            ))}
            {months.map(({ c, i }) => (
              <text key={c.start} x={x(i)} y="230" textAnchor="middle">
                {format(c.start, { month: "short", year: "numeric" })}
              </text>
            ))}
          </g>
          {candles.map((c, i) => {
            const color = c.close >= c.open ? "#00e5a0" : "#ef4444";
            return (
              <g key={c.start} stroke={color}>
                <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} />
                <rect
                  x={x(i) - width / 2}
                  y={Math.min(y(c.open), y(c.close))}
                  width={width}
                  height={Math.max(Math.abs(y(c.open) - y(c.close)), 1)}
                  fill={color}
                />
              </g>
            );
          })}
          <g strokeDasharray="5 4" strokeWidth="1.2" fontSize="10">
            {base && (
              <>
                <line
                  x1={PLOT.x0}
                  x2={PLOT.x1}
                  y1={y(base.price)}
                  y2={y(base.price)}
                  stroke="#ffd700"
                />
                <text
                  x="588"
                  y={y(base.price) - 5}
                  textAnchor="end"
                  fill="#ffd700"
                  {...halo}
                >
                  Base case ${Math.round(base.price / 1000)}k
                </text>
              </>
            )}
            {bear && (
              <>
                <line
                  x1={PLOT.x0}
                  x2={PLOT.x1}
                  y1={y(bear.price)}
                  y2={y(bear.price)}
                  stroke="#ff3b30"
                />
                <text
                  x="50"
                  y={y(bear.price) + 13}
                  textAnchor="start"
                  fill="#ff3b30"
                  {...halo}
                >
                  Bear case ${Math.round(bear.price / 1000)}k
                </text>
              </>
            )}
          </g>
        </svg>
        {point !== null && <Readout x={x(point)} {...readout(point)} />}
        <Spoken text={keyed && point !== null ? spoken(readout(point)) : ""} />
      </div>
    </figure>
  );
}

/** "55% above" / "3% below" / "level with" */
const side = (value: number, level: number) => {
  const p = change(value, level);
  if (Math.abs(p) < 0.5) return "level with";
  return `${percent(p)} ${p > 0 ? "above" : "below"}`;
};

/** The "Analyze the market" answer: price against its on-chain cost basis.
 * With a live price and live `levels`, the readings and the chart's last
 * point are as of now; otherwise the levels are the release's. When the
 * price has crossed the STH level since the latest close the answer says so;
 * the history of closes is the release's either way. */
export function costBasisAnswer(
  facts: ExampleFacts,
  now: Close = latestClose(facts),
  levels: RealizedLevels | null = null,
): React.ReactNode[] {
  const f = facts.cost_basis;
  const year = utc(facts.report_date).getUTCFullYear();
  const closeDay = longDate(facts.report_date, year);
  const live = now.at && levels ? levels : null;
  const realized = live ? live.realized : f.realized_price;
  const sth = live ? live.sth : f.sth_realized_price;
  const realized3x = live ? 3 * live.realized : f.realized_price_3x;
  const c = f.chart;
  const chart =
    live && now.date > c.dates.at(-1)!
      ? {
          dates: [...c.dates, now.date],
          price: [...c.price, now.price],
          realized_price: [...c.realized_price, realized],
          sth_realized_price: [...c.sth_realized_price, sth],
          realized_price_3x: [...c.realized_price_3x, realized3x],
        }
      : c;
  const sthNow = now.price >= sth ? "above" : "below";
  const held =
    now.at && sthNow !== f.sth_side
      ? `It has moved ${sthNow} that level since the ${closeDay} close.`
      : f.sth_side_since === facts.report_date
        ? `It moved ${f.sth_side} that level on ${now.at ? `the ${closeDay} close` : "this close"}.`
        : `It has closed ${f.sth_side} that level every day since ${longDate(f.sth_side_since, year)}.`;
  const stretch = f.last_stretch_below_realized;
  let stretchLine = "";
  if (stretch && stretch.end === facts.report_date)
    stretchLine = ` It has closed below realized price on ${stretch.days} days since ${monthYear(stretch.start)}.`;
  else if (stretch)
    stretchLine = ` Its last stretch below realized price ran from ${monthYear(stretch.start)} to ${monthYear(stretch.end)}, with ${stretch.days} closes below it.`;
  const above3x = f.close > f.realized_price_3x;
  return [
    <p key="close">
      Bitcoin&apos;s {now.at ? "current price" : `${closeDay} close`} of{" "}
      <strong>{usd(now.price)}</strong> sits {side(now.price, realized)} the
      realized price of <strong>{usd(realized)}</strong> and{" "}
      {side(now.price, sth)} the STH realized price of{" "}
      <strong>{usd(sth)}</strong>. {held}
    </p>,
    <p key="bands">
      The 3x realized price sits at <strong>{usd(realized3x)}</strong>.{" "}
      {above3x
        ? "Bitcoin closed above it."
        : f.last_close_above_3x
          ? `Bitcoin last closed above it on ${longDate(f.last_close_above_3x, year)}.`
          : "Bitcoin has not closed above it."}
      {stretchLine}
    </p>,
    <CostBasisChart key="chart" chart={chart} now={chart !== c} />,
  ];
}

/** The "Review the outlook" answer: the year's cases against the price now,
 * or the latest close. */
export function outlookAnswer(
  facts: ExampleFacts,
  now?: Close,
): React.ReactNode[] {
  const o = facts.outlook;
  const year = utc(facts.report_date).getUTCFullYear();
  const live = now?.at ? now : null;
  const price = live ? live.price : o.close;
  const daysLeft = live ? daysLeftInYear(live.date) : o.days_left_in_year;
  const ytd = change(price, o.previous_year_close);
  const base = caseNamed(o, "base");
  const bear = caseNamed(o, "bear");
  const weeks = Math.round(daysLeft / 7);
  const left =
    weeks >= 2
      ? `the ${weeks} weeks left`
      : daysLeft >= 2
        ? `the ${daysLeft} days left`
        : "the last days of the year";
  const levels = [
    o.nearest_support &&
      `support at ${usd(o.nearest_support.price)} (${o.nearest_support.name})`,
    o.nearest_resistance &&
      `resistance at ${usd(o.nearest_resistance.price)} (${o.nearest_resistance.name})`,
  ].filter(Boolean);
  return [
    <p key="cases">
      At{" "}
      {live
        ? "its current price of"
        : `the ${longDate(facts.report_date, year)} close of`}{" "}
      <strong>{usd(price)}</strong>, Bitcoin is {ytd >= 0 ? "up" : "down"}{" "}
      {Math.abs(ytd).toFixed(1)}% for the year.
      {base &&
        (price < base.price ? (
          <>
            {" "}
            Reaching the <strong>{usd(base.price)}</strong> base case would take
            a {percent(change(base.price, price))} rise in {left}.
          </>
        ) : (
          <>
            {" "}
            The {live ? "price" : "close"} is already{" "}
            {percent(change(price, base.price))} above the{" "}
            <strong>{usd(base.price)}</strong> base case.
          </>
        ))}
      {bear && (
        <>
          {" "}
          It sits {side(price, bear.price)} the{" "}
          <strong>{usd(bear.price)}</strong> bear case.
        </>
      )}
    </p>,
    <p key="range">
      Over the past year, daily closes ranged from {usd(o.year_high.close)} on{" "}
      {longDate(o.year_high.date, 0)} to {usd(o.year_low.close)} on{" "}
      {longDate(o.year_low.date, 0)}.
      {levels.length > 0 && ` The outlook marks ${levels.join(" and ")}.`}
    </p>,
    <OutlookChart
      key="chart"
      outlook={o}
      candles={live ? toDate(o.weekly_candles, live) : o.weekly_candles}
      through={live ? live.date : facts.report_date}
    />,
    <table key="table" className="uc-cases">
      <caption>
        Year-end cases against the{" "}
        {live
          ? "current price"
          : `${shortDate(facts.report_date).replace(/, \d{4}$/, "")} close`}
      </caption>
      <thead>
        <tr>
          <th scope="col">Case</th>
          <th scope="col">Target</th>
          <th scope="col">Move needed</th>
        </tr>
      </thead>
      <tbody>
        {o.cases.map((c) => {
          const move = change(c.price, price);
          return (
            <tr key={c.name}>
              <th scope="row">{c.name.replace(/ Case$/, " case")}</th>
              <td>{usd(c.price)}</td>
              <td>
                {move >= 0 ? "+" : "−"}
                {percent(move)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>,
  ];
}

const count = (n: number) => n.toLocaleString("en-US");
/** "Oct 9, 2026, 13:06 UTC" */
export const retrievedLabel = (iso: string) =>
  `${shortDate(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC`;
/** "$74.2 million" */
const money = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(1)} billion`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(1)} million`
      : usd(n);
const odds = (n: number) => `${Number(n.toFixed(1))}%`;

const HALVING_INTERVAL = 210_000;
const HALVINGS: Record<number, string> = {
  210000: "November 2012",
  420000: "July 2016",
  630000: "May 2020",
  840000: "April 2024",
};

/** The "Learn the fundamentals" answer: the halving, from the current block. */
export function halvingAnswer(chain: ChainHeight): React.ReactNode[] {
  const era = Math.floor(chain.height / HALVING_INTERVAL);
  const last = era * HALVING_INTERVAL;
  const next = last + HALVING_INTERVAL;
  const left = next - chain.height;
  const days = (left * 10) / 1440;
  const months = days / 30.44;
  const time =
    months >= 2
      ? `about ${Math.round(months)} months`
      : days >= 2
        ? `about ${Math.round(days)} days`
        : "less than two days";
  const when = HALVINGS[last]
    ? `The ${HALVINGS[last]} halving`
    : "The last halving";
  return [
    <p key="rule">
      Every 210,000 blocks, roughly every four years, the new bitcoin paid to
      miners in each block is cut in half. {when} at block {count(last)} cut it
      from{" "}
      <strong>
        {50 / 2 ** (era - 1)} to {50 / 2 ** era} BTC
      </strong>
      .
    </p>,
    <p key="next">
      The next halving comes at block <strong>{count(next)}</strong>,{" "}
      {count(left)} blocks after the current block: {time} at ten minutes a
      block. It slows how fast new coins arrive. The 21 million limit stays the
      same.
    </p>,
  ];
}

function OddsRow({
  price,
  chance,
  up,
}: {
  price: number;
  chance: number;
  up: boolean;
}) {
  return (
    <div className={`uc-odds-row ${up ? "up" : "down"}`}>
      <span>
        {up ? "↑" : "↓"} ${Math.round(price / 1000)}k
      </span>
      <span className="uc-odds-track">
        <i style={{ width: `${chance}%` }} />
      </span>
      <b>{odds(chance)}</b>
    </div>
  );
}

/** The "Ask where price is heading" answer: Polymarket's yearly price ladder. */
export function priceOddsAnswer(
  market: PriceOdds,
  facts: ExampleFacts,
): React.ReactNode[] {
  const nearestUp = market.up.at(-1)!;
  const base = caseNamed(facts.outlook, "base");
  const baseStrike =
    base && market.up.find((s) => s.price === base.price && s !== nearestUp);
  const [firstDown, , thirdDown] = market.down;
  const laterDown = thirdDown ?? market.down.at(-1)!;
  return [
    <p key="up">
      Polymarket&apos;s &ldquo;{market.title}&rdquo; market, with{" "}
      <strong>{money(market.volume)}</strong> traded and{" "}
      {money(market.liquidity)} in liquidity, puts a{" "}
      <strong>{odds(nearestUp.odds)}</strong> chance on Bitcoin touching{" "}
      {usd(nearestUp.price)} before the year ends
      {baseStrike && (
        <>
          {" "}
          and {odds(baseStrike.odds)} on {usd(baseStrike.price)}, the
          outlook&apos;s base case
        </>
      )}
      .
    </p>,
    <p key="down">
      On the way down, it prices <strong>{odds(firstDown.odds)}</strong> for a
      touch of {usd(firstDown.price)}
      {laterDown !== firstDown && (
        <>
          {" "}
          and {odds(laterDown.odds)} for {usd(laterDown.price)}
        </>
      )}
      . Each figure is the odds of a touch on Binance BTC/USDT at any minute
      before {market.year + 1}, not a forecast of the year-end close.
    </p>,
    <figure key="ladder" className="uc-chart">
      <figcaption className="uc-chart-t">
        <span>Odds Bitcoin touches each price in {market.year}</span>
        <span>Polymarket · {retrievedLabel(market.retrievedAt)}</span>
      </figcaption>
      <div className="uc-odds">
        {market.up.map((s) => (
          <OddsRow key={s.price} price={s.price} chance={s.odds} up />
        ))}
        <p className="uc-odds-now">
          {market.close.at
            ? "Now"
            : `${shortDate(market.close.date).replace(/, \d{4}$/, "")} close`}{" "}
          · {usd(market.close.price)}
        </p>
        {market.down.map((s) => (
          <OddsRow key={s.price} price={s.price} chance={s.odds} up={false} />
        ))}
      </div>
    </figure>,
  ];
}

const PIZZA_BLOCK = 57043;
const PIZZA_BTC = 10000;

/** The "Explore the blockchain" answer: the 2010 pizza transaction, with its
 * value at the price now (or the latest close) and its confirmations at the
 * current block. */
export function pizzaAnswer(
  facts: ExampleFacts,
  chain: ChainHeight,
  now: Close = latestClose(facts),
): React.ReactNode[] {
  const value = PIZZA_BTC * now.price;
  const year = utc(facts.report_date).getUTCFullYear();
  const fields: [string, string][] = [
    ["Status", "Confirmed"],
    ["Block", "57,043 · May 22, 2010, 18:16:31 UTC"],
    ["Inputs", "131 legacy (P2PKH) · 10,000.99 BTC"],
    ["Output", "1 · 10,000 BTC to 17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ"],
    ["Fee", "0.99 BTC"],
    ["Size", "23,620 bytes · 94,480 weight units"],
    [
      "Confirmations",
      `${count(chain.height - PIZZA_BLOCK + 1)} at block ${count(chain.height)}`,
    ],
  ];
  return [
    <p key="summary">
      It is widely known as the 2010 pizza transaction. It spent{" "}
      <strong>131 inputs</strong> into a single <strong>10,000 BTC</strong>{" "}
      output and left a 0.99 BTC fee. At{" "}
      {now.at
        ? "the current price"
        : `the ${longDate(facts.report_date, year)} close`}{" "}
      of {usd(now.price)}, that output would be worth about{" "}
      <strong>
        {value >= 1e9
          ? `$${(value / 1e9).toFixed(1)} billion`
          : `$${Math.round(value / 1e6)} million`}
      </strong>
      .
    </p>,
    <dl key="fields" className="uc-tx">
      {fields.map(([label, field]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{field}</dd>
        </div>
      ))}
    </dl>,
  ];
}
