import { cached } from "./cache";
import { fetchJson, fetchText, SourceError, type FetchLog } from "./http";

// Secret Satoshis' daily release. Files are read once per release date and
// kept per instance; a request returns only the columns and dates it asks for,
// so the 47 MB master file is never sent to the model.
export const REPORT_LIBRARY =
  "https://secretsatoshis.github.io/Bitcoin-Report-Library/csv/";

type Manifest = {
  report_date: string;
  generated_at?: string;
  files: Record<string, unknown>;
};

export async function manifest(log?: FetchLog) {
  return fetchJson<Manifest>(`${REPORT_LIBRARY}release_manifest.json`, {
    ttl: 600,
    log,
  });
}

/** The published name of a dataset: "master_metrics" -> "master_metrics_data.csv.gz". */
export async function datasetFile(dataset: string, log?: FetchLog) {
  const files = Object.keys((await manifest(log)).files);
  const clean = dataset.replace(/\.csv(\.gz)?$/, "");
  const found =
    files.find((f) => f === dataset) ??
    files.find((f) => f.replace(/\.csv(\.gz)?$/, "") === clean) ??
    files.find((f) => f.replace(/\.csv(\.gz)?$/, "") === `${clean}_data`);
  if (!found)
    throw new SourceError(
      `No Report Library dataset "${dataset}". Datasets: ${files
        .filter((f) => /\.csv(\.gz)?$/.test(f))
        .map((f) => f.replace(/\.csv(\.gz)?$/, ""))
        .join(", ")}`,
    );
  return found;
}

/** One CSV line split into fields, honouring quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

type Table = { header: string[]; rows: string[][] };
async function table(file: string, log?: FetchLog): Promise<Table> {
  const { report_date } = await manifest(log);
  return cached(`table:${report_date}:${file}`, 3600, async () => {
    const text = await fetchText(`${REPORT_LIBRARY}${file}`, {
      maxBytes: 80 * 1024 ** 2,
      timeoutMs: 45_000,
      ttl: 3600,
      log,
    });
    const lines = text.split(/\r?\n/).filter((l) => l.length);
    return {
      header: splitCsvLine(lines[0]),
      rows: lines.slice(1).map(splitCsvLine),
    };
  });
}

export async function columns(dataset: string, log?: FetchLog) {
  const file = await datasetFile(dataset, log);
  return { file, columns: (await table(file, log)).header };
}

const number = (value: string) => {
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
};

export type Slice = {
  dataset: string;
  file: string;
  report_date: string;
  date_column: string | null;
  rows: Record<string, string | number | null>[];
  total_rows: number;
  note?: string;
};

/**
 * Rows of a dataset, limited to some columns and a date range. Daily candles
 * keep only completed daily rows. A file with no date column returns its rows
 * as published (they are short tables).
 */
export async function slice(
  options: {
    dataset: string;
    columns?: string[];
    start?: string;
    end?: string;
    filter?: Record<string, string>;
    maxRows?: number;
    /** Charts take every row (up to 50,000); the model gets at most 2,000. */
    forChart?: boolean;
  },
  log?: FetchLog,
): Promise<Slice> {
  const file = await datasetFile(options.dataset, log);
  const { report_date } = await manifest(log);
  const { header, rows } = await table(file, log);
  const dateColumn = header.includes("date")
    ? "date"
    : header.includes("observation_date")
      ? "observation_date"
      : null;
  const wanted = options.columns?.length ? options.columns : header;
  const unknown = wanted.filter((c) => !header.includes(c));
  if (unknown.length)
    throw new SourceError(
      `${file} has no column ${unknown.join(", ")}. Use report_library_columns to find names.`,
    );
  const keep = [...new Set([...(dateColumn ? [dateColumn] : []), ...wanted])];
  const index = keep.map((c) => header.indexOf(c));
  const filters = Object.entries(options.filter ?? {}).map(
    ([column, value]) => [header.indexOf(column), value] as const,
  );
  if (filters.some(([i]) => i < 0))
    throw new SourceError(`${file}: unknown filter column`);
  const isCandles = file.startsWith("bitcoin_candles");
  const ci = header.indexOf("interval");
  const cc = header.indexOf("complete");
  const di = dateColumn ? header.indexOf(dateColumn) : -1;
  const picked = rows.filter((row) => {
    if (isCandles && options.filter?.interval === undefined)
      if (row[ci] !== "daily" || row[cc] !== "True") return false;
    for (const [i, value] of filters) if (row[i] !== value) return false;
    if (di >= 0) {
      const day = row[di]?.slice(0, 10);
      if (options.start && day < options.start) return false;
      if (options.end && day > options.end) return false;
    }
    return true;
  });
  const max = options.forChart
    ? 50_000
    : Math.min(options.maxRows ?? 400, 2000);
  const sampled =
    picked.length > max
      ? picked.filter(
          (_, i) =>
            i % Math.ceil(picked.length / max) === 0 || i === picked.length - 1,
        )
      : picked;
  return {
    dataset: options.dataset,
    file,
    report_date,
    date_column: dateColumn,
    rows: sampled.map((row) =>
      Object.fromEntries(keep.map((c, k) => [c, number(row[index[k]] ?? "")])),
    ),
    total_rows: picked.length,
    ...(sampled.length < picked.length
      ? {
          note: `Thinned to ${sampled.length} of ${picked.length} rows (every ${Math.ceil(picked.length / max)}th plus the last); ask a narrower range for full detail.`,
        }
      : {}),
  };
}

/** Column names across the main datasets that match a search. */
export async function searchColumns(query: string, log?: FetchLog) {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out: { dataset: string; column: string }[] = [];
  for (const dataset of [
    "master_metrics",
    "onchain_price_models",
    "summary_table",
    "performance_table",
    "etf_totals_daily",
  ]) {
    const { columns: names } = await columns(dataset, log).catch(() => ({
      columns: [] as string[],
    }));
    for (const column of names)
      if (words.every((w) => column.toLowerCase().includes(w)))
        out.push({ dataset, column });
  }
  return out.slice(0, 40);
}
