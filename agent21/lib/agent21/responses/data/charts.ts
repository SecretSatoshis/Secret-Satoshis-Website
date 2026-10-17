import { createHash } from "node:crypto";
import { validChart } from "../../charts";
import { fetchJson, fetchText, SourceError, type FetchLog } from "./http";

// Secret Satoshis' Chart Library and new charts built on the server (a port of
// the data-analysis skill's chart_payloads.py). Payloads use the Chart Library's
// schema 2, which the conversation draws with the library's own renderer.
export const CHARTS = "https://charts.secretsatoshis.com";
type Json = Record<string, unknown>;
export type Payload = Json & {
  id: string;
  title: string;
  x: (string | number)[];
  series: (Json & {
    id: string;
    axis: string;
    values: (number | null)[];
    start?: number;
  })[];
  axes: Record<string, Json>;
};
type CatalogEntry = {
  title: string;
  filename: string;
  url?: string;
  category?: string;
  description?: string;
  tags?: string[];
  coverage?: string;
};

export async function catalog(log?: FetchLog) {
  return fetchJson<{ charts: CatalogEntry[]; latest_data_date?: string }>(
    `${CHARTS}/catalog.json`,
    { log },
  );
}

/** Published charts matching a query, best first (scored as the skill does). */
export async function findCharts(query: string, limit = 8, log?: FetchLog) {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const phrase = words.join(" ");
  const { charts, latest_data_date } = await catalog(log);
  const scored = charts
    .map((c) => {
      const title = c.title.toLowerCase();
      const tags = (c.tags ?? []).join(" ").toLowerCase();
      const rest = `${c.category ?? ""} ${c.description ?? ""}`.toLowerCase();
      let score = phrase && title.includes(phrase) ? 5 : 0;
      for (const w of words)
        score +=
          (title.includes(w) ? 3 : 0) +
          (tags.includes(w) ? 2 : 0) +
          (rest.includes(w) ? 1 : 0);
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    latest_data_date,
    charts: scored.map(({ c }) => ({
      chart_id: c.filename,
      title: c.title,
      category: c.category,
      coverage: c.coverage,
      page: `${CHARTS}/${c.filename}.html`,
    })),
  };
}

const PAYLOAD =
  /<script id="chart-data" type="application\/json">([\s\S]*?)<\/script>/;
export async function sitePayload(chartId: string, log?: FetchLog) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(chartId))
    throw new SourceError(
      `"${chartId}" is not a chart id; use site_charts to find one`,
    );
  const html = await fetchText(`${CHARTS}/${chartId}.html`, {
    maxBytes: 8 * 1024 ** 2,
    log,
  });
  const match = PAYLOAD.exec(html);
  if (!match) throw new SourceError(`${chartId} has no chart data`);
  const payload = JSON.parse(match[1]) as Payload;
  if (payload.schemaVersion !== 2 || payload.id !== chartId)
    throw new SourceError(`${chartId} is not a schema 2 chart`);
  return payload;
}

const FULL_HISTORY_VIEWS = [
  "candleViews",
  "defaultPresentation",
  "defaultInterval",
  "flowViews",
  "flowIntervals",
  "defaultFlowInterval",
];
const day = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The payload limited to a date window and chosen series (chart_payloads._trimmed). */
export function trimPayload(
  payload: Payload,
  options: {
    start?: string;
    end?: string;
    lastDays?: number;
    series?: string[];
  },
): Payload {
  let { start } = options;
  const { end, lastDays, series: keep } = options;
  const x = payload.x as string[];
  if ((start || end || lastDays !== undefined) && payload.axisKind !== "time")
    throw new SourceError(
      `${payload.id} is not dated along the bottom; only series can be chosen`,
    );
  if (lastDays !== undefined && (start || end))
    throw new SourceError("give last_days, or start and end, not both");
  if (lastDays !== undefined) {
    if (lastDays < 1) throw new SourceError("last_days is at least 1");
    const last = day(x[x.length - 1]);
    start = iso(new Date(last.getTime() - (lastDays - 1) * 86_400_000));
  }
  const first = start ? start.slice(0, 10) : undefined;
  const lastDay = end ? end.slice(0, 10) : undefined;
  const window = x
    .map((d, i) => [d, i] as const)
    .filter(([d]) => (!first || d >= first) && (!lastDay || d <= lastDay))
    .map(([, i]) => i);
  if (!window.length)
    throw new SourceError(
      `${payload.id} covers ${x[0]} to ${x[x.length - 1]}; the window has no dates`,
    );
  const lo = window[0];
  const hi = window[window.length - 1] + 1;
  const ids = payload.series.map((s) => s.id);
  if (keep) {
    const unknown = keep.filter((k) => !ids.includes(k));
    if (unknown.length)
      throw new SourceError(
        `${payload.id} has no series ${unknown.join(", ")}; it has ${ids.join(", ")}`,
      );
  }
  const kept = [];
  for (const item of payload.series) {
    if (keep && !keep.includes(item.id)) continue;
    const begin = item.start ?? 0;
    const a = Math.max(begin, lo);
    const b = Math.min(begin + item.values.length, hi);
    const values = a < b ? item.values.slice(a - begin, b - begin) : [];
    if (!values.some((v) => v !== null)) {
      if (keep) throw new SourceError(`${item.id} has no values in the window`);
      continue;
    }
    kept.push({ ...item, values, start: a - lo });
  }
  if (!kept.length) throw new SourceError("no series has values in the window");
  const axes = new Set(kept.map((s) => s.axis));
  const days = x.slice(lo, hi);
  const trimmed: Payload = Object.fromEntries(
    Object.entries(payload).filter(([k]) => !FULL_HISTORY_VIEWS.includes(k)),
  ) as Payload;
  Object.assign(trimmed, {
    x: days,
    series: kept,
    axes: Object.fromEntries(
      Object.entries(payload.axes).filter(([k]) => axes.has(k)),
    ),
  });
  if (payload.axisKind === "time") {
    const events = (payload.events as { date: string }[] | undefined) ?? [];
    Object.assign(trimmed, {
      events: events.filter(
        (e) => days[0] <= e.date && e.date <= days[days.length - 1],
      ),
      coverage: `${days[0]}/${days[days.length - 1]}`,
      readingPoint: [
        String(payload.readingPoint ?? days[days.length - 1]),
        days[days.length - 1],
      ].sort()[0],
      defaultRange: "ALL",
    });
    for (const key of ["dataDate", "rangeEndDate"])
      if (payload[key])
        trimmed[key] = [String(payload[key]), days[days.length - 1]].sort()[0];
  }
  const panels = payload.panels as { axis: string }[] | undefined;
  if (panels?.length) {
    const left = panels.filter((p) => axes.has(p.axis));
    trimmed.panels = left.length === 1 ? [{ ...left[0], weight: 100 }] : left;
  }
  return trimmed;
}

// Series colors (a subset of the Chart Library's chart_style.series_color).
const ORANGE = "#F7931A";
const PALETTE = [
  "#6D9EFF",
  "#5FD4D0",
  "#B39AEE",
  "#EA90BA",
  "#78C99A",
  "#D6C778",
  "#E87878",
  "#D5D8E2",
  "#4378CF",
  "#CF59AA",
  "#A8CA58",
  "#319AA8",
  "#8464C9",
  "#B67983",
  "#A9E6CD",
  "#809BB9",
];
const REGISTERED: Record<string, string> = {
  "7_day_ma_price_close": PALETTE[0],
  "50_day_ma_price_close": PALETTE[1],
  "200_day_ma_price_close": PALETTE[2],
  "200_week_ma_price_close": PALETTE[7],
  realized_price: PALETTE[0],
  sth_realized_price: PALETTE[1],
  lth_realized_price: PALETTE[3],
};
export function seriesColor(key: string, role = "normal") {
  if (key.startsWith("price_close") || role === "highlight") return ORANGE;
  if (role === "mean") return "#68C5AF";
  if (role === "median") return "#DAD9ED";
  if (/^\d+$/.test(key)) return PALETTE[Number(key) % PALETTE.length];
  const cycle = /^(?:Drawdown|Market) Cycle (\d+)$/.exec(key);
  if (cycle) return PALETTE[(Number(cycle[1]) - 1) % PALETTE.length];
  if (REGISTERED[key]) return REGISTERED[key];
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return PALETTE[parseInt(hash, 16) % PALETTE.length];
}

export type NewSeries = {
  id: string;
  name: string;
  values: (number | null)[];
  axis?: "left" | "right";
  role?: "normal" | "highlight" | "historical" | "mean" | "median";
};
export type Axis = {
  label: string;
  unit: "USD" | "count" | "hashrate" | "percent" | "ratio";
  mode: "log" | "linear";
};

function seriesEntry(s: NewSeries, mode: string) {
  const role = s.role ?? "normal";
  if (!s.values.some((v) => v !== null && Number.isFinite(v)))
    throw new SourceError(`${s.id} has no finite values`);
  if (mode === "log" && s.values.some((v) => v !== null && v <= 0))
    throw new SourceError(`${s.id} has nonpositive values on a log axis`);
  return {
    id: s.id,
    name: s.name,
    axis: s.axis ?? "right",
    role,
    color: seriesColor(s.id, role),
    lineWidth:
      role === "highlight" || s.id === "price_close"
        ? 3
        : role === "historical"
          ? 1
          : 2,
    lineStyle: role === "median" ? "dashed" : "solid",
    opacity: role === "historical" ? 0.45 : 1,
    values: s.values.map((v) => (v !== null && Number.isFinite(v) ? v : null)),
    start: 0,
  };
}

function finish(payload: Payload) {
  const text = JSON.stringify(payload);
  if (!validChart(text))
    throw new SourceError("the chart is too large or malformed for the viewer");
  return { payload, text };
}

/** A new dated chart (chart_payloads.save_chart_payload). */
export function timeseriesChart(options: {
  chartId: string;
  title: string;
  description: string;
  source: string;
  x: string[];
  series: NewSeries[];
  axes: Partial<Record<"left" | "right", Axis>>;
  events?: { date: string; name: string }[];
  note?: string;
}) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(options.chartId))
    throw new SourceError("bad chart id");
  if (!options.x.length || options.x.length > 50_000)
    throw new SourceError("a chart needs 1 to 50,000 dates");
  const first = options.x[0];
  const last = options.x[options.x.length - 1];
  return finish({
    schemaVersion: 2,
    id: options.chartId,
    title: options.title,
    description: options.description,
    category: "Agent 21",
    featured: false,
    source: options.source,
    unavailable: [],
    family: "timeseries",
    reportDate: last,
    coverage: `${first}/${last}`,
    axisKind: "time",
    axes: options.axes as Record<string, Json>,
    defaultRange: "ALL",
    x: options.x,
    series: options.series.map((s) =>
      seriesEntry(s, options.axes[s.axis ?? "right"]?.mode ?? "linear"),
    ),
    events: (options.events ?? [])
      .filter((e) => first <= e.date && e.date <= last)
      .sort((a, b) => a.date.localeCompare(b.date)),
    readingPoint: last,
    note: options.note ?? "Daily observations.",
  } as Payload);
}

/** An event comparison by days since each event (chart_payloads.save_event_chart). */
export function eventChart(options: {
  chartId: string;
  title: string;
  description: string;
  source: string;
  axis: Axis;
  paths: { id: string; name: string; values: (number | null)[] }[];
  asOf: string;
  note?: string;
}) {
  const length = Math.max(...options.paths.map((p) => p.values.length));
  const last = options.paths[options.paths.length - 1];
  const series = options.paths.map((p, i) =>
    seriesEntry(
      {
        ...p,
        axis: "right",
        role: i === options.paths.length - 1 ? "highlight" : "normal",
      },
      options.axis.mode,
    ),
  );
  return finish({
    schemaVersion: 2,
    id: options.chartId,
    title: options.title,
    description: options.description,
    category: "Agent 21",
    featured: false,
    source: options.source,
    unavailable: [],
    family: "cycle",
    reportDate: options.asOf,
    coverage: null,
    axisKind: "days",
    axes: { right: options.axis },
    defaultRange: "ALL",
    x: Array.from({ length }, (_, i) => i),
    series,
    events: [],
    readingPoint: last.values.length - 1,
    note:
      options.note ??
      "Each path is indexed to 100 on its event day. Readings compare the same elapsed day.",
  } as unknown as Payload);
}

/** What a saved chart shows, in a few lines for the model. */
export function chartSummary(payload: Payload) {
  const x = payload.x;
  return {
    title: payload.title,
    coverage: payload.coverage ?? `${x[0]}/${x[x.length - 1]}`,
    points: x.length,
    // Latest, low and high of each series: a drawdown chart's lows are each
    // cycle's trough, so most questions are answered without the raw values.
    series: Object.fromEntries(
      payload.series.map((s) => {
        type Point = { at: string | number; value: number };
        const points: Point[] = [];
        s.values.forEach((value, i) => {
          if (value !== null) points.push({ at: x[(s.start ?? 0) + i], value });
        });
        if (!points.length) return [s.id, null];
        const low = points.reduce((a, b) => (b.value < a.value ? b : a));
        const high = points.reduce((a, b) => (b.value > a.value ? b : a));
        return [
          s.id,
          { name: s.name, latest: points[points.length - 1], low, high },
        ];
      }),
    ),
  };
}
