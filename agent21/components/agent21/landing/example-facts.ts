import { z } from "zod";
import { warnDiagnostic } from "../../../lib/agent21/diagnostics";
import snapshot from "./example-facts.json";

// The figures behind the "Analyze the market" and "Review the outlook" examples,
// published by the Report Library with each daily release (agent21_examples.py).
// The bundled snapshot stands in whenever the published file is missing or invalid.
export const EXAMPLE_FACTS_URL =
  "https://secretsatoshis.github.io/Bitcoin-Report-Library/csv/agent21_examples.json";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const price = z.number().positive().finite();
const level = z.object({ price, name: z.string().min(1) }).nullable();
const series = z.array(price).min(2);

export const exampleFactsSchema = z.object({
  schema_version: z.literal(1),
  report_date: isoDate,
  cost_basis: z.object({
    close: price,
    realized_price: price,
    sth_realized_price: price,
    realized_price_3x: price,
    realized_side: z.enum(["above", "below"]),
    realized_side_since: isoDate,
    sth_side: z.enum(["above", "below"]),
    sth_side_since: isoDate,
    last_close_above_3x: isoDate.nullable(),
    last_stretch_below_realized: z
      .object({
        start: isoDate,
        end: isoDate,
        days: z.number().int().positive(),
      })
      .nullable(),
    chart: z
      .object({
        dates: z.array(isoDate).min(2),
        price: series,
        realized_price: series,
        sth_realized_price: series,
        realized_price_3x: series,
      })
      .refine(
        (c) =>
          [
            c.price,
            c.realized_price,
            c.sth_realized_price,
            c.realized_price_3x,
          ].every((s) => s.length === c.dates.length),
        "Every chart series needs one value per date",
      ),
  }),
  outlook: z.object({
    year: z.number().int(),
    close: price,
    previous_year_close: price,
    days_left_in_year: z.number().int().min(0),
    cases: z.array(z.object({ name: z.string(), price })).min(1),
    nearest_support: level,
    nearest_resistance: level,
    year_high: z.object({ date: isoDate, close: price }),
    year_low: z.object({ date: isoDate, close: price }),
    weekly_candles: z
      .array(
        z.object({
          start: isoDate,
          open: price,
          high: price,
          low: price,
          close: price,
          complete: z.boolean(),
        }),
      )
      .min(2),
  }),
});

export type ExampleFacts = z.infer<typeof exampleFactsSchema>;

export const SNAPSHOT_FACTS = exampleFactsSchema.parse(snapshot);

/** The bundled snapshot, logged so a broken daily file does not go unnoticed. */
function snapshotFacts(status?: number) {
  warnDiagnostic(
    { code: "example_facts_unavailable", status },
    "landing_fallback",
    {
      provider: "source",
    },
  );
  return SNAPSHOT_FACTS;
}

/** The latest published facts, cached for an hour; the bundled snapshot if
 * the file cannot be fetched or does not match the schema. */
export async function loadExampleFacts(): Promise<ExampleFacts> {
  try {
    const response = await fetch(EXAMPLE_FACTS_URL, {
      cache: "force-cache",
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return snapshotFacts(response.status);
    const parsed = exampleFactsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : snapshotFacts();
  } catch {
    return snapshotFacts();
  }
}
