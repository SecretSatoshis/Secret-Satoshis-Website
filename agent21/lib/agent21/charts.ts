import { z } from "zod";

export { isChartFile } from "./types";

/**
 * Interactive charts: the agent saves a Chart Library payload (schema 2) as
 * <id>.chart.json, and the conversation draws it with the Chart Library's own
 * renderer in chart-viewer/. Only data crosses into the viewer, never markup.
 */
// The largest published chart payload is about 1.3 MB.
export const CHART_MAX_BYTES = 8 * 1024 * 1024;
const MAX_POINTS = 50_000;

const label = (max = 200) => z.string().max(max);
// Plain colors only: a color reaches styles and canvas, so no url() or other values.
const color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\))$/);
const series = z.looseObject({
  id: label(),
  name: label(),
  axis: label(40),
  color: color.optional(),
  values: z.array(z.number().nullable()).max(MAX_POINTS),
});
const payload = z.looseObject({
  schemaVersion: z.literal(2),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  title: label().min(1),
  reportDate: label(40),
  axes: z.record(label(40), z.looseObject({ label: label(120) })),
  x: z.array(z.union([label(40), z.number()])).max(MAX_POINTS),
  series: z.array(series).min(1).max(40),
  events: z
    .array(z.looseObject({ date: label(40), name: label() }))
    .max(500)
    .optional(),
});

/** True when text is a bounded chart payload the viewer can draw. */
export function validChart(text: string) {
  if (Buffer.byteLength(text) > CHART_MAX_BYTES) return false;
  try {
    return payload.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}
