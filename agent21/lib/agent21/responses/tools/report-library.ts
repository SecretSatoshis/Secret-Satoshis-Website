import { sourcesBlock } from "../blocks";
import {
  columns,
  manifest,
  REPORT_LIBRARY,
  searchColumns,
  slice,
} from "../data/report-library";
import { opt, s, tool } from "./types";

// Secret Satoshis' daily release (the agent21-secret-satoshis skill): values
// published there are read, not recomputed.
export const reportLibrary = tool<{
  dataset: string;
  columns: string[] | null;
  start: string | null;
  end: string | null;
  filter: { column: string; value: string }[] | null;
  max_rows: number | null;
}>({
  name: "report_library",
  label: "Checking a data source",
  description:
    "Rows of a Secret Satoshis Report Library dataset (the daily release, completed UTC days through its report_date), limited to some columns and a date range. Main datasets: master_metrics (every daily metric), onchain_price_models, summary_table, performance_table, etf_totals_daily, bitcoin_candles. Use report_library_columns to find column names. Returns at most max_rows rows (default 400), thinned evenly for longer ranges.",
  parameters: s.object({
    dataset: s.str("Dataset name, such as master_metrics"),
    columns: s.nullable(
      s.list(s.str("Column name"), "Columns; null for all (short tables only)"),
    ),
    start: s.nullable(s.str("First date, YYYY-MM-DD")),
    end: s.nullable(s.str("Last date, YYYY-MM-DD")),
    filter: s.nullable(
      s.list(
        s.object({ column: s.str("Column"), value: s.str("Exact value") }),
        "Rows to keep by exact value",
      ),
    ),
    max_rows: s.nullable(s.int("At most this many rows, up to 2000")),
  }),
  async run(args, { log }) {
    const data = await slice(
      {
        dataset: args.dataset,
        columns: opt(args.columns),
        start: opt(args.start),
        end: opt(args.end),
        filter: args.filter
          ? Object.fromEntries(args.filter.map((f) => [f.column, f.value]))
          : undefined,
        maxRows: opt(args.max_rows),
      },
      log,
    );
    return {
      ...data,
      blocks: {
        sources: sourcesBlock([
          {
            name: "Report Library release",
            detail: data.file.replace(/\.csv(\.gz)?$/, ""),
            url: "https://github.com/SecretSatoshis/Bitcoin-Report-Library",
            asOf: data.report_date,
          },
        ]),
      },
    };
  },
});

export const reportLibraryColumns = tool<{
  dataset: string | null;
  query: string | null;
}>({
  name: "report_library_columns",
  label: "Checking a data source",
  description:
    "Finds Report Library column names: with query, the matching columns across the main datasets; with dataset, that dataset's columns; with neither, the release's report_date and dataset list.",
  parameters: s.object({
    dataset: s.nullable(s.str("A dataset name")),
    query: s.nullable(
      s.str("Words in the column name, such as 'mvrv' or 'realized price'"),
    ),
  }),
  async run({ dataset, query }, { log }) {
    const release = await manifest(log);
    if (query)
      return {
        report_date: release.report_date,
        matches: await searchColumns(query, log),
      };
    if (dataset)
      return {
        report_date: release.report_date,
        ...(await columns(dataset, log)),
      };
    return {
      report_date: release.report_date,
      base_url: REPORT_LIBRARY,
      datasets: Object.keys(release.files)
        .filter((f) => /\.csv(\.gz)?$/.test(f))
        .map((f) => f.replace(/\.csv(\.gz)?$/, "")),
    };
  },
});
