"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileView } from "../../../lib/agent21/types";
import { formatDate, formatValue } from "../../../lib/agent21/blocks";

/**
 * Draws a <id>.chart.json file with the Chart Library renderer. The viewer is a
 * same-origin static page that runs only its own scripts; the payload reaches
 * it as data through postMessage, and its height comes back the same way.
 */
export function ChartFrame({ file }: { file: FileView }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [payload, setPayload] = useState<{ title?: unknown } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/agent21/files/${file.id}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => active && setPayload(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [file.id]);
  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (loaded && payload && target)
      target.postMessage(
        { type: "ss-chart-payload", payload },
        window.location.origin,
      );
  }, [loaded, payload]);
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      const element = frame.current;
      if (
        !element ||
        event.origin !== window.location.origin ||
        event.source !== element.contentWindow ||
        event.data?.type !== "ss-chart-size" ||
        typeof event.data.height !== "number"
      )
        return;
      element.style.height = `${Math.min(Math.max(event.data.height, 320), 2400)}px`;
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);
  if (failed)
    return <p className="a21-chart-error">This chart could not be loaded.</p>;
  return (
    <iframe
      ref={frame}
      className="a21-chart"
      src="/agent21-chart/viewer.html"
      title={typeof payload?.title === "string" ? payload.title : file.name}
      loading="lazy"
      onLoad={() => setLoaded(true)}
    />
  );
}

// The compact card follows the response design's chart rules: title, range, unit and
// scale; at most four series; a legend; a hover readout; now marked.
type Series = {
  id: string;
  name: string;
  axis: string;
  role?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: string;
  opacity?: number;
  start?: number;
  values: (number | null)[];
};
type Payload = {
  title: string;
  axisKind?: string;
  x: (string | number)[];
  axes: Record<string, { label?: string; unit?: string; mode?: string }>;
  series: Series[];
  events?: { date: string; name: string }[];
};

const VIEW = { w: 600, h: 240 };
const MAX_SERIES = 4;
const MAX_POINTS = 600;
const FALLBACK_COLORS = ["#f7931a", "#6d9eff", "#5fd4d0", "#b39aee"];

const day = (x: string | number) =>
  typeof x === "number"
    ? x
    : Date.parse(`${x.slice(0, 10)}T00:00:00Z`) / 86_400_000;
const trimmed = (n: number, max = 2) =>
  n.toLocaleString("en-US", { maximumFractionDigits: max });

function tickLabel(v: number, unit?: string) {
  if (unit === "USD") {
    const a = Math.abs(v);
    const body =
      a >= 1e6
        ? `${trimmed(a / 1e6, 1)}M`
        : a >= 1e3
          ? `${trimmed(a / 1e3, 1)}k`
          : trimmed(a, 2);
    return `${v < 0 ? "−" : ""}$${body}`;
  }
  if (unit === "percent") return `${trimmed(v, 1)}%`;
  const a = Math.abs(v);
  return a >= 1e9
    ? `${trimmed(v / 1e9, 1)}B`
    : a >= 1e6
      ? `${trimmed(v / 1e6, 1)}M`
      : a >= 1e3
        ? `${trimmed(v / 1e3, 1)}k`
        : trimmed(v, 2);
}
function readoutValue(v: number, unit?: string) {
  if (unit === "USD") return formatValue(v, "usd");
  if (unit === "percent") return `${trimmed(v, 2)}%`;
  return trimmed(v, v >= 100 ? 0 : 2);
}

function scale(values: number[], log: boolean, y0: number, y1: number) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (log) {
    lo = Math.log10(lo * 0.9);
    hi = Math.log10(hi * 1.1);
  } else {
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    lo -= pad;
    hi += pad;
  }
  const y = (v: number) =>
    y0 - (((log ? Math.log10(v) : v) - lo) / (hi - lo)) * (y0 - y1);
  let ticks: number[] = [];
  if (log) {
    for (let k = Math.floor(lo); k <= Math.ceil(hi); k++)
      for (const m of [1, 2, 5]) {
        const t = m * 10 ** k;
        if (Math.log10(t) >= lo && Math.log10(t) <= hi) ticks.push(t);
      }
    while (ticks.length > 6) ticks = ticks.filter((_, i) => i % 2 === 0);
  } else {
    const raw = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step =
      [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step)
      ticks.push(Number(t.toPrecision(12)));
  }
  return { y, ticks };
}

function xLabels(first: number, last: number, days: boolean) {
  if (days) {
    const span = last - first;
    const step = [7, 30, 90, 180, 365, 730].find((s) => span / s <= 6) ?? 1460;
    const out: { at: number; text: string }[] = [];
    for (let t = Math.ceil(first / step) * step; t <= last; t += step)
      out.push({ at: t, text: `Day ${trimmed(t, 0)}` });
    return out;
  }
  const start = new Date(first * 86_400_000);
  const end = new Date(last * 86_400_000);
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const out: { at: number; text: string }[] = [];
  if (last - first > 900) {
    const step = Math.max(1, Math.ceil(years / 6));
    for (
      let y = start.getUTCFullYear() + 1;
      y <= end.getUTCFullYear();
      y += step
    )
      out.push({ at: Date.UTC(y, 0, 1) / 86_400_000, text: String(y) });
    return out;
  }
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  const step = [1, 2, 3, 6].find((s) => months / s <= 5) ?? 12;
  // Month starts on the step's grid (Jan, Apr, Jul, Oct for a quarter).
  const from = Math.ceil((start.getUTCMonth() + 1) / step) * step;
  for (let m = from; ; m += step) {
    const d = Date.UTC(start.getUTCFullYear(), m, 1);
    if (d / 86_400_000 > last) break;
    out.push({
      at: d / 86_400_000,
      text: new Date(d).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    });
  }
  return out;
}

// The highlighted series (usually Bitcoin's price) first, then in order.
const shownSeries = (payload: Payload) =>
  [...payload.series]
    .sort(
      (a, b) => Number(b.role === "highlight") - Number(a.role === "highlight"),
    )
    .slice(0, MAX_SERIES);

function CompactChart({ payload }: { payload: Payload }) {
  const days = payload.axisKind === "days" || typeof payload.x[0] === "number";
  const shown = shownSeries(payload);
  const hidden = payload.series.length - shown.length;
  const axesUsed = [...new Set(shown.map((s) => s.axis))];
  const secondary = axesUsed.length > 1 ? axesUsed[1] : null;
  const plot = { x0: 52, x1: secondary ? 548 : 590, y0: 210, y1: 14 };
  const xs = payload.x.map(day);
  const first = xs[0];
  const last = xs[xs.length - 1];
  const px = (d: number) =>
    plot.x0 + ((d - first) / (last - first || 1)) * (plot.x1 - plot.x0);
  const step = Math.max(1, Math.ceil(payload.x.length / MAX_POINTS));
  const grid = payload.x
    .map((_, i) => i)
    .filter((i) => i % step === 0 || i === payload.x.length - 1);
  const valueAt = (s: Series, i: number) => {
    const v = s.values[i - (s.start ?? 0)];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const scales = Object.fromEntries(
    axesUsed.map((axis) => {
      const log = payload.axes[axis]?.mode === "log";
      const values = shown
        .filter((s) => s.axis === axis)
        .flatMap((s) => grid.map((i) => valueAt(s, i)))
        .filter((v): v is number => v !== null && (!log || v > 0));
      return [
        axis,
        {
          log,
          unit: payload.axes[axis]?.unit,
          ...scale(values.length ? values : [1, 2], log, plot.y0, plot.y1),
        },
      ];
    }),
  );
  const primary = scales[axesUsed[0]];
  const color = (s: Series, i: number) =>
    s.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  const paths = shown.map((s) => {
    const sc = scales[s.axis];
    let d = "";
    let pen = false;
    for (const i of grid) {
      const v = valueAt(s, i);
      if (v === null || (sc.log && v <= 0)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${px(xs[i]).toFixed(1)},${sc.y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  });
  const lastIndex = (s: Series) => {
    for (let i = payload.x.length - 1; i >= 0; i--)
      if (valueAt(s, i) !== null) return i;
    return -1;
  };
  const lead = shown[0];
  const nowIndex = lastIndex(lead);
  const events = (payload.events ?? []).filter((e) => {
    const d = day(e.date);
    return d >= first && d <= last;
  });
  const [point, setPoint] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pick = (clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const at = ((clientX - box.left) / box.width) * VIEW.w;
    let best = grid[0];
    for (const i of grid)
      if (Math.abs(px(xs[i]) - at) < Math.abs(px(xs[best]) - at)) best = i;
    setPoint(best);
  };
  const label = (i: number) =>
    days
      ? `Day ${trimmed(Number(payload.x[i]), 0)}`
      : formatDate(String(payload.x[i]));
  const rows =
    point === null
      ? []
      : shown
          .map((s, k) => ({ s, k, v: valueAt(s, point) }))
          .filter((r) => r.v !== null)
          .sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
  return (
    <div className="ans-plot">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        role="img"
        aria-label={`${payload.title}: ${shown.map((s) => s.name).join(", ")}`}
        tabIndex={0}
        onPointerMove={(e) => e.pointerType !== "touch" && pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType !== "touch" && setPoint(null)}
        onBlur={() => setPoint(null)}
        onKeyDown={(e) => {
          const move = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
          if (!move) return;
          e.preventDefault();
          const k = point === null ? grid.length - 1 : grid.indexOf(point);
          setPoint(grid[Math.min(grid.length - 1, Math.max(0, k + move))]);
        }}
      >
        <g stroke="#1c1c2e">
          {primary.ticks.map((t) => (
            <line
              key={t}
              x1={plot.x0}
              x2={plot.x1}
              y1={primary.y(t)}
              y2={primary.y(t)}
            />
          ))}
        </g>
        <g fill="#82829c" fontSize="10">
          {primary.ticks.map((t) => (
            <text key={t} x={plot.x0 - 6} y={primary.y(t) + 3} textAnchor="end">
              {tickLabel(t, primary.unit)}
            </text>
          ))}
          {secondary &&
            scales[secondary].ticks.map((t) => (
              <text key={t} x={plot.x1 + 6} y={scales[secondary].y(t) + 3}>
                {tickLabel(t, scales[secondary].unit)}
              </text>
            ))}
          {xLabels(first, last, days).map((l) => (
            <text key={l.at} x={px(l.at)} y={VIEW.h - 10} textAnchor="middle">
              {l.text}
            </text>
          ))}
        </g>
        {events.slice(0, 8).map((e) => (
          <line
            key={e.date + e.name}
            className="ans-event"
            x1={px(day(e.date))}
            x2={px(day(e.date))}
            y1={plot.y1}
            y2={plot.y0}
          >
            <title>{`${e.name} · ${formatDate(e.date)}`}</title>
          </line>
        ))}
        {shown.map((s, k) => (
          <path
            key={s.id}
            d={paths[k]}
            fill="none"
            stroke={color(s, k)}
            strokeWidth={Math.min(Math.max((s.lineWidth ?? 2) * 0.75, 1), 2.5)}
            strokeDasharray={s.lineStyle === "dashed" ? "5 4" : undefined}
            strokeOpacity={s.opacity ?? 1}
            strokeLinejoin="round"
          />
        ))}
        {nowIndex >= 0 && point === null && (
          <circle
            className="ans-now-dot"
            cx={px(xs[nowIndex])}
            cy={scales[lead.axis].y(valueAt(lead, nowIndex) ?? 1)}
            r="3.5"
            fill={color(lead, 0)}
          />
        )}
        {point !== null && (
          <g className="ans-cross">
            <line
              x1={px(xs[point])}
              x2={px(xs[point])}
              y1={plot.y1}
              y2={plot.y0}
            />
            {rows.map(({ s, k, v }) => (
              <circle
                key={s.id}
                cx={px(xs[point])}
                cy={scales[s.axis].y(v!)}
                r="3.5"
                fill={color(s, k)}
              />
            ))}
          </g>
        )}
      </svg>
      {point !== null && (
        <div
          className="ans-tip"
          data-side={px(xs[point]) > VIEW.w / 2 ? "left" : "right"}
          style={{ left: `${(px(xs[point]) / VIEW.w) * 100}%` }}
        >
          <b>{label(point)}</b>
          {rows.map(({ s, k, v }) => (
            <div key={s.id}>
              <i style={{ background: color(s, k) }} />
              {s.name}
              <span>{readoutValue(v!, scales[s.axis].unit)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="ans-sr" aria-live="polite">
        {point === null
          ? ""
          : `${label(point)}: ${rows.map(({ s, v }) => `${s.name} ${readoutValue(v!, scales[s.axis].unit)}`).join(", ")}`}
      </p>
      <div className="ans-legend">
        {shown.map((s, k) => (
          <span key={s.id}>
            <i
              style={{ background: color(s, k), opacity: s.opacity ?? 1 }}
              data-dashed={s.lineStyle === "dashed" || undefined}
            />
            {s.name}
          </span>
        ))}
        {hidden > 0 && (
          <span className="ans-more">
            +{hidden} more in the interactive chart
          </span>
        )}
      </div>
    </div>
  );
}

function subtitle(payload: Payload) {
  const days = payload.axisKind === "days" || typeof payload.x[0] === "number";
  const first = payload.x[0];
  const last = payload.x[payload.x.length - 1];
  const range = days
    ? `Days ${trimmed(Number(first), 0)}–${trimmed(Number(last), 0)}`
    : `${formatDate(String(first))} – ${formatDate(String(last))}`;
  const axes = [...new Set(shownSeries(payload).map((s) => s.axis))].map(
    (a) => payload.axes[a],
  );
  const units = [...new Set(axes.map((a) => a?.unit).filter(Boolean))].join(
    " and ",
  );
  const log = axes.some((a) => a?.mode === "log");
  return [range, [units, log ? "log scale" : ""].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
}

const looksLikePayload = (value: unknown): value is Payload => {
  const p = value as Payload;
  return (
    !!p &&
    typeof p.title === "string" &&
    Array.isArray(p.x) &&
    p.x.length > 1 &&
    Array.isArray(p.series) &&
    p.series.length > 0 &&
    typeof p.axes === "object"
  );
};

/** A saved chart as the compact card, with the full viewer on demand. */
export function ChartCard({
  file,
  page,
  caption,
}: {
  file: FileView;
  page?: string;
  caption?: string;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/agent21/files/${file.id}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!active) return;
        if (looksLikePayload(data)) setPayload(data);
        else setFailed(true);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [file.id]);
  const sub = useMemo(() => (payload ? subtitle(payload) : ""), [payload]);
  if (failed)
    return <p className="a21-chart-error">This chart could not be loaded.</p>;
  if (!payload)
    return <div className="ans-ph ans-ph-chart" aria-hidden="true" />;
  return (
    <figure className="ans-card ans-chart">
      <figcaption className="ans-card-t">
        <span>{payload.title}</span>
        <span>{sub}</span>
      </figcaption>
      {full ? <ChartFrame file={file} /> : <CompactChart payload={payload} />}
      {caption && <p className="ans-note">{caption}</p>}
      <div className="ans-chart-actions">
        <button type="button" onClick={() => setFull(!full)}>
          {full ? "Compact chart" : "Open interactive chart"}
        </button>
        {page && (
          <a href={page} target="_blank" rel="noopener noreferrer">
            Chart Library ↗
          </a>
        )}
      </div>
    </figure>
  );
}
