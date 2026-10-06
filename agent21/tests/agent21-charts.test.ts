import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { safeArtifact } from "../lib/agent21/files";
import { validChart } from "../lib/agent21/charts";

const viewer = new URL("../chart-viewer/", import.meta.url);
const chart = (changes: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: 2,
    id: "Bitcoin_Price_Chart_MA",
    title: "Bitcoin Moving Averages",
    reportDate: "2026-10-05",
    axes: { right: { label: "USD", unit: "USD", mode: "log" } },
    x: ["2026-10-04", "2026-10-05"],
    series: [
      {
        id: "price_close",
        name: "Bitcoin price",
        axis: "right",
        color: "#F7931A",
        values: [86246.24, null],
      },
    ],
    events: [{ date: "2026-10-04", name: "Example" }],
    note: "Daily close.",
    ...changes,
  });

test("chart files are kept only as valid Chart Library payloads", () => {
  const path = "/workspace/outputs/Bitcoin_Price_Chart_MA.chart.json";
  assert(safeArtifact(path, Buffer.from(chart())));
  // Other JSON files are not deliverables.
  assert(!safeArtifact("/workspace/outputs/data.json", Buffer.from(chart())));
  for (const bad of [
    "not json",
    chart({ schemaVersion: 3 }),
    chart({ id: "../other" }),
    chart({ series: [] }),
    chart({ title: "" }),
    // A color reaches styles, so anything but a plain color is refused.
    chart({
      series: [
        {
          id: "p",
          name: "p",
          axis: "right",
          color: "url(https://example.com/x)",
          values: [1],
        },
      ],
    }),
    chart({
      series: [{ id: "p", name: "p", axis: "right", values: ["1"] }],
    }),
  ])
    assert(!safeArtifact(path, Buffer.from(bad)), bad.slice(0, 80));
  assert(!validChart(chart({ x: Array(50_001).fill("2026-01-01") })));
  assert(
    !safeArtifact(
      path,
      Buffer.from(chart({ note: "AGENT21_PRIVATE_CONTROL" })),
    ),
  );
});

test("the viewer page has every element the vendored renderer reads", () => {
  const renderer = readFileSync(new URL("assets/renderer.js", viewer), "utf8");
  const page = readFileSync(new URL("viewer.html", viewer), "utf8");
  const ids = new Set(
    [...renderer.matchAll(/\$\('([A-Za-z-]+)'\)/g)].map((match) => match[1]),
  );
  // viewer.js adds chart-data; the chart site's navigation is not embedded.
  for (const optional of ["chart-data", "navToggle", "navLinks"])
    ids.delete(optional);
  for (const id of ids) assert(page.includes(`id="${id}"`), `missing #${id}`);
});

test("vendored chart viewer files match the recorded hashes", () => {
  const lock = JSON.parse(readFileSync(new URL("lock.json", viewer), "utf8"));
  for (const [name, digest] of Object.entries(lock.files))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(`assets/${name}`, viewer)))
        .digest("hex"),
      digest,
      name,
    );
});

test("the viewer's style policy allows the chart runtime's attribution style", () => {
  const runtime = readFileSync(
    new URL("assets/lightweight-charts.js", viewer),
    "utf8",
  );
  const style = runtime.match(/a#tv-attr-logo\{[^"'`]*/)?.[0];
  assert(style, "attribution style not found in the chart runtime");
  const hash = createHash("sha256").update(style).digest("base64");
  const config = readFileSync(
    new URL("../next.config.ts", import.meta.url),
    "utf8",
  );
  assert(
    config.includes(`'sha256-${hash}'`),
    `add 'sha256-${hash}' to style-src`,
  );
});
