import { chartBlock } from "../blocks";
import {
  CHARTS,
  chartSummary,
  eventChart,
  findCharts,
  sitePayload,
  timeseriesChart,
  trimPayload,
  type Axis,
  type NewSeries,
} from "../data/charts";
import { SourceError } from "../data/http";
import { slice } from "../data/report-library";
import { brkRows } from "./brk";
import { opt, s, tool, type ToolContext } from "./types";

// Charts drawn in the answer by the Chart Library's own renderer. Published
// charts are reused as they are; new ones are built here from data fetched on
// the server, so the model never types out a series.
async function keep(
  payloadText: string,
  chartId: string,
  context: ToolContext,
) {
  return context.saveArtifact({
    name: `${chartId}.chart.json`,
    mime: "application/json",
    bytes: Buffer.from(payloadText),
  });
}

export const siteCharts = tool<{ query: string }>({
  name: "site_charts",
  label: "Checking a data source",
  description:
    "Searches Secret Satoshis' published charts (charts.secretsatoshis.com) and returns the best matches with their chart_id, title, category, coverage and page. Check here before building a new chart.",
  parameters: s.object({
    query: s.str("A few words, such as 'moving averages' or 'mvrv'"),
  }),
  async run({ query }, { log }) {
    return findCharts(query, 8, log);
  },
});

export const saveSiteChart = tool<{
  chart_id: string;
  start: string | null;
  end: string | null;
  last_days: number | null;
  series: string[] | null;
  caption: string | null;
}>({
  name: "save_site_chart",
  label: "Preparing a chart",
  description:
    "Places a published Secret Satoshis chart in the answer, optionally limited to a date window (start/end or last_days) or some of its series. Returns the chart's latest readings and a ready chart block; also link its page.",
  parameters: s.object({
    chart_id: s.str("The chart_id from site_charts"),
    start: s.nullable(s.str("First date, YYYY-MM-DD")),
    end: s.nullable(s.str("Last date, YYYY-MM-DD")),
    last_days: s.nullable(
      s.int("The trailing days to show instead of start/end"),
    ),
    series: s.nullable(s.list(s.str("A series id"), "Series ids to keep")),
    caption: s.nullable(
      s.str("A caption under the chart, up to 120 characters"),
    ),
  }),
  async run(args, context) {
    const full = await sitePayload(args.chart_id, context.log);
    const options = {
      start: opt(args.start),
      end: opt(args.end),
      lastDays: opt(args.last_days),
      series: opt(args.series),
    };
    const trimmed =
      options.start ||
      options.end ||
      options.lastDays !== undefined ||
      options.series?.length
        ? trimPayload(full, options)
        : full;
    const file = await keep(JSON.stringify(trimmed), args.chart_id, context);
    const page = `${CHARTS}/${args.chart_id}.html`;
    return {
      file,
      page,
      series: full.series.map((x) => ({ id: x.id, name: x.name })),
      summary: chartSummary(trimmed),
      blocks: { chart: chartBlock(file, page, opt(args.caption)) },
    };
  },
});

const AXIS = s.object({
  label: s.str("Axis label"),
  unit: s.oneOf(["USD", "count", "hashrate", "percent", "ratio"], "Axis unit"),
  mode: s.oneOf(["log", "linear"], "Scale"),
});
const EVENT = s.object({
  date: s.str("YYYY-MM-DD"),
  name: s.str("Short event name"),
});

type SeriesArg = {
  id: string;
  name: string;
  axis: "left" | "right" | null;
  role: NewSeries["role"] | null;
};
type EventArg = { date: string; name: string };

async function rowsFor(
  args: {
    source: "brk" | "report_library";
    dataset?: string;
    ids: string[];
    start?: string;
    end?: string;
    lastDays?: number;
  },
  context: ToolContext,
) {
  if (args.source === "brk") {
    const { rows } = await brkRows(
      {
        series: args.ids,
        start: args.start ?? "2010-07-18",
        end: args.end,
        lastDays: args.lastDays,
      },
      context.log,
      context.now,
    );
    return { rows, source: "BRK (bitview.space)", dateKey: "date" };
  }
  if (!args.dataset)
    throw new SourceError("report_library charts need the dataset");
  let start = args.start;
  if (args.lastDays)
    start = new Date(context.now.getTime() - args.lastDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const data = await slice(
    {
      dataset: args.dataset,
      columns: args.ids,
      start,
      end: args.end,
      forChart: true,
    },
    context.log,
  );
  if (!data.date_column) throw new SourceError(`${data.file} is not dated`);
  return {
    rows: data.rows,
    source: `Secret Satoshis Report Library (${data.report_date})`,
    dateKey: data.date_column,
  };
}

export const saveChart = tool<{
  chart_id: string;
  title: string;
  description: string;
  source: "brk" | "report_library";
  dataset: string | null;
  series: SeriesArg[];
  start: string | null;
  end: string | null;
  last_days: number | null;
  right_axis: Axis;
  left_axis: Axis | null;
  events: EventArg[] | null;
  event_paths: { days: number; events: EventArg[] } | null;
  caption: string | null;
}>({
  name: "save_chart",
  label: "Preparing a chart",
  description:
    "Builds a new chart from BRK series or a Report Library dataset and places it in the answer, for a view the published charts lack. The data is fetched here: give series ids (BRK series names or dataset columns), never values. Dated chart by default; with event_paths, each event's path over the following days indexed to 100 on its event day (the first series only, the last event highlighted). Returns the chart's latest readings and a ready chart block.",
  parameters: s.object({
    chart_id: s.str("File stem: letters, digits, _ and -"),
    title: s.str("Chart title"),
    description: s.str("One sentence on what the chart shows"),
    source: s.oneOf(["brk", "report_library"], "Where the series come from"),
    dataset: s.nullable(
      s.str("The Report Library dataset, for source report_library"),
    ),
    series: s.list(
      s.object({
        id: s.str("BRK series name or dataset column"),
        name: s.str("Legend name"),
        axis: s.nullable(s.oneOf(["left", "right"], "Axis; default right")),
        role: s.nullable(
          s.oneOf(
            ["normal", "highlight", "historical", "mean", "median"],
            "Line style",
          ),
        ),
      }),
      "Series, 1 to 8",
    ),
    start: s.nullable(s.str("First date, YYYY-MM-DD")),
    end: s.nullable(s.str("End date, YYYY-MM-DD")),
    last_days: s.nullable(s.int("Trailing days instead of start/end")),
    right_axis: AXIS,
    left_axis: s.nullable(AXIS),
    events: s.nullable(s.list(EVENT, "Dated markers on a dated chart")),
    event_paths: s.nullable(
      s.object({
        days: s.int("Days after each event"),
        events: s.list(EVENT, "Events, oldest first"),
      }),
    ),
    caption: s.nullable(
      s.str("A caption under the chart, up to 120 characters"),
    ),
  }),
  async run(args, context) {
    if (!args.series.length || args.series.length > 8)
      throw new SourceError("a chart takes 1 to 8 series");
    const paths = opt(args.event_paths);
    if (paths) {
      if (!paths.events.length || paths.events.length > 40)
        throw new SourceError("give 1 to 40 events");
      if (paths.days < 1 || paths.days > 5000)
        throw new SourceError("days is 1 to 5,000");
      const id = args.series[0].id;
      const first = [...paths.events].map((e) => e.date).sort()[0];
      const { rows, source, dateKey } = await rowsFor(
        {
          source: args.source,
          dataset: opt(args.dataset),
          ids: [id],
          start: first,
        },
        context,
      );
      const byDay = new Map(
        rows.map((r) => [String(r[dateKey]).slice(0, 10), r[id]]),
      );
      const latest = String(rows[rows.length - 1]?.[dateKey] ?? "").slice(
        0,
        10,
      );
      const status: Record<string, string> = {};
      const built = paths.events.map((event) => {
        const base = byDay.get(event.date);
        if (typeof base !== "number" || base <= 0)
          throw new SourceError(
            `${event.name}: ${id} has no positive value on ${event.date}`,
          );
        const values: (number | null)[] = [];
        const t0 = Date.parse(`${event.date}T00:00:00Z`);
        for (let d = 0; d <= paths.days; d++) {
          const dayKey = new Date(t0 + d * 86_400_000)
            .toISOString()
            .slice(0, 10);
          if (dayKey > latest) break;
          const v = byDay.get(dayKey);
          values.push(typeof v === "number" ? (v / base) * 100 : null);
        }
        while (values.length && values[values.length - 1] === null)
          values.pop();
        status[event.name] =
          values.length - 1 >= paths.days
            ? "complete"
            : `pending (${values.length - 1}/${paths.days} days)`;
        return { id: event.name, name: event.name, values };
      });
      const { payload, text } = eventChart({
        chartId: args.chart_id,
        title: args.title,
        description: args.description,
        source,
        axis: args.right_axis,
        paths: built,
        asOf: latest,
      });
      const file = await keep(text, args.chart_id, context);
      return {
        file,
        status,
        readings: Object.fromEntries(
          built.map((p) => [
            p.name,
            {
              day: p.values.length - 1,
              indexed: p.values[p.values.length - 1],
            },
          ]),
        ),
        note: "Report only complete windows as results; pending ones are still running.",
        summary: chartSummary(payload),
        blocks: { chart: chartBlock(file, undefined, opt(args.caption)) },
      };
    }
    const ids = args.series.map((x) => x.id);
    const { rows, source, dateKey } = await rowsFor(
      {
        source: args.source,
        dataset: opt(args.dataset),
        ids,
        start: opt(args.start),
        end: opt(args.end),
        lastDays: opt(args.last_days),
      },
      context,
    );
    if (!rows.length) throw new SourceError("no rows in that range");
    const x = rows.map((r) => String(r[dateKey]).slice(0, 10));
    const axes: Partial<Record<"left" | "right", Axis>> = {
      right: args.right_axis,
    };
    if (args.left_axis) axes.left = args.left_axis;
    const { payload, text } = timeseriesChart({
      chartId: args.chart_id,
      title: args.title,
      description: args.description,
      source,
      x,
      series: args.series.map((x) => ({
        id: x.id,
        name: x.name,
        axis: opt(x.axis) ?? "right",
        role: opt(x.role) ?? "normal",
        values: rows.map((r) =>
          typeof r[x.id] === "number" ? (r[x.id] as number) : null,
        ),
      })),
      axes,
      events: opt(args.events),
    });
    const file = await keep(text, args.chart_id, context);
    return {
      file,
      summary: chartSummary(payload),
      blocks: { chart: chartBlock(file, undefined, opt(args.caption)) },
    };
  },
});
