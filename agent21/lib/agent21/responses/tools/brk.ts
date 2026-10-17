import {
  factsBlock,
  figuresBlock,
  sourcesBlock,
  type Fact,
  type Figure,
} from "../blocks";
import { fetchJson, fetchText, SourceError, type FetchLog } from "../data/http";
import { splitCsvLine } from "../data/report-library";
import { isoDay, opt, s, tool } from "./types";

// BRK's public REST API (the agent21-brk skill): the live network and its
// historical series. Live readings are cached 30 seconds per instance.
export const BRK = "https://bitview.space";
const brkJson = <T>(route: string, log: FetchLog) =>
  fetchJson<T>(`${BRK}${route}`, { log });
const brkText = (route: string, log: FetchLog) =>
  fetchText(`${BRK}${route}`, { log });
const unixIso = (seconds: number) =>
  new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const btc = (sats: number) =>
  `${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} BTC`;
const GENESIS_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const GENESIS_NOTE =
  "The balance excludes the 50 BTC genesis block reward, which was never spendable and is left out of every node's coin set.";

const PARTS = [
  "price",
  "tip",
  "fees",
  "next_blocks",
  "difficulty",
  "mempool",
] as const;
type Part = (typeof PARTS)[number];

export const bitcoinNetwork = tool<{ parts: Part[] }>({
  name: "bitcoin_network",
  label: "Checking a data source",
  description:
    "Bitcoin's live network from BRK: the latest price (intraday, with its time), the chain tip height, fee rates (sat/vB), how full the next blocks are, the next difficulty adjustment and the mempool's size. Point-in-time readings; returns ready figures and sources blocks.",
  parameters: s.object({
    parts: s.list(s.oneOf(PARTS, "A reading"), "The readings to fetch"),
  }),
  async run({ parts }, { log, now }) {
    const want = new Set(
      parts.length ? parts : (["price", "tip", "fees"] as Part[]),
    );
    const out: Record<string, unknown> = { retrieved_at: now.toISOString() };
    const figures: Figure[] = [];
    const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    await Promise.all([
      want.has("price") &&
        brkJson<{ time: number; USD: number }>("/api/v1/prices", log).then(
          (p) => {
            out.price = {
              usd: p.USD,
              time: unixIso(p.time),
              basis: "intraday, not a daily close",
            };
            figures.push({
              label: "Bitcoin price",
              value: p.USD,
              format: "usd",
              asOf: unixIso(p.time),
              kind: "observed",
            });
          },
        ),
      want.has("tip") &&
        brkText("/api/blocks/tip/height", log).then((t) => {
          out.tip_height = Number(t.trim());
          figures.push({
            label: "Block height",
            value: Number(t.trim()),
            format: "number",
            asOf: at,
            kind: "observed",
          });
        }),
      want.has("fees") &&
        brkJson<Record<string, number>>("/api/v1/fees/precise", log).then(
          (f) => {
            out.fees_sat_vb = {
              next_block: f.fastestFee,
              half_hour: f.halfHourFee,
              hour: f.hourFee,
              economy: f.economyFee,
              minimum: f.minimumFee,
            };
            if (f.fastestFee < 1)
              out.fee_note =
                "Rates below 1 sat/vB are accepted by many nodes and miners but not all.";
            figures.push({
              label: "Next-block fee (sat/vB)",
              value: f.fastestFee,
              format: "number",
              asOf: at,
              kind: "observed",
            });
            figures.push({
              label: "1-hour fee (sat/vB)",
              value: f.hourFee,
              format: "number",
              asOf: at,
              kind: "observed",
            });
          },
        ),
      want.has("next_blocks") &&
        brkJson<
          {
            nTx: number;
            blockVSize: number;
            medianFee: number;
            feeRange: number[];
          }[]
        >("/api/v1/fees/mempool-blocks", log).then((blocks) => {
          out.next_blocks = blocks.slice(0, 4).map((b, i) => ({
            block: i + 1,
            transactions: b.nTx,
            vsize_vb: b.blockVSize,
            median_fee_sat_vb: b.medianFee,
            fee_range_sat_vb: [
              b.feeRange[0],
              b.feeRange[b.feeRange.length - 1],
            ],
          }));
          out.next_blocks_note =
            "Block 1 is Bitcoin Core's selection for the next block; later blocks are fee-tier approximations.";
        }),
      want.has("difficulty") &&
        brkJson<Record<string, number>>(
          "/api/v1/difficulty-adjustment",
          log,
        ).then((d) => {
          out.difficulty_adjustment = {
            estimated_change_pct: d.difficultyChange,
            progress_pct: d.progressPercent,
            remaining_blocks: d.remainingBlocks,
            next_retarget_height: d.nextRetargetHeight,
            estimated_retarget: new Date(d.estimatedRetargetDate).toISOString(),
            previous_change_pct: d.previousRetarget,
            note: "The change is an estimate from recent block times, not a guarantee.",
          };
          figures.push({
            label: "Next difficulty change",
            value: d.difficultyChange / 100,
            format: "change",
            asOf: at,
            kind: "calculated",
          });
        }),
      want.has("mempool") &&
        brkJson<{ count: number; vsize: number; total_fee: number }>(
          "/api/mempool",
          log,
        ).then((m) => {
          out.mempool = {
            transactions: m.count,
            vsize_vb: m.vsize,
            total_fee_btc: m.total_fee / 1e8,
          };
          figures.push({
            label: "Mempool transactions",
            value: m.count,
            format: "number",
            asOf: at,
            kind: "observed",
          });
        }),
    ]);
    return {
      ...out,
      blocks: {
        ...(figures.length
          ? { figures: figuresBlock(figures.slice(0, 4)) }
          : {}),
        sources: sourcesBlock([
          { name: "BRK", detail: "bitview.space", url: BRK, asOf: at },
        ]),
      },
    };
  },
});

type Tx = {
  txid: string;
  weight: number;
  size: number;
  fee: number;
  vin: { is_coinbase?: boolean; prevout?: { value: number } | null }[];
  vout: { value: number }[];
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
};
type Address = {
  address: string;
  chain_stats: {
    balance?: number;
    funded_txo_sum: number;
    spent_txo_sum: number;
    tx_count: number;
    realized_price?: number;
  };
  mempool_stats: {
    balance_delta?: number;
    funded_txo_sum: number;
    spent_txo_sum: number;
    tx_count: number;
  };
};
type Block = {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  extras?: { pool?: { name?: string }; totalFees?: number; reward?: number };
};

export const bitcoinLookup = tool<{
  kind: "tx" | "address" | "block";
  id: string;
}>({
  name: "bitcoin_lookup",
  label: "Checking a data source",
  description:
    "Looks up one transaction (txid), address or block (height or hash) on BRK's node and returns its facts with a ready facts block. Only look up an address the user gave.",
  parameters: s.object({
    kind: s.oneOf(["tx", "address", "block"], "What to look up"),
    id: s.str("The txid, the address, or the block height or hash"),
  }),
  async run({ kind, id }, { log, now }) {
    const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    const value = id.trim();
    const sources = sourcesBlock([
      { name: "BRK", detail: "bitview.space", url: BRK, asOf: at },
    ]);
    if (kind === "tx") {
      if (!/^[0-9a-fA-F]{64}$/.test(value))
        throw new SourceError("A txid is 64 hexadecimal characters.");
      const tx = await brkJson<Tx>(`/api/tx/${value}`, log);
      const coinbase = tx.vin.some((v) => v.is_coinbase);
      const outputs = tx.vout.reduce((sum, o) => sum + o.value, 0);
      const vsize = Math.ceil(tx.weight / 4);
      const facts: Fact[] = [
        { label: "Transaction", value: tx.txid, mono: true },
        {
          label: "Status",
          value: tx.status.confirmed
            ? "Confirmed"
            : "Unconfirmed (in the mempool)",
        },
        ...(tx.status.block_height !== undefined
          ? [{ label: "Block", value: String(tx.status.block_height) }]
          : []),
        ...(tx.status.block_time
          ? [{ label: "Block time", value: unixIso(tx.status.block_time) }]
          : []),
        {
          label: "Inputs / outputs",
          value: `${tx.vin.length} / ${tx.vout.length}`,
        },
        { label: "Total output", value: btc(outputs) },
        ...(coinbase
          ? [{ label: "Type", value: "Coinbase (new coins and fees)" }]
          : [
              {
                label: "Fee",
                value: `${btc(tx.fee)} (${tx.fee.toLocaleString("en-US")} sats)`,
              },
              {
                label: "Fee rate",
                value: `${(tx.fee / vsize).toFixed(2)} sat/vB`,
              },
            ]),
        {
          label: "Size",
          value: `${vsize.toLocaleString("en-US")} vB (${tx.weight.toLocaleString("en-US")} WU)`,
        },
      ];
      return {
        txid: tx.txid,
        confirmed: tx.status.confirmed,
        block_height: tx.status.block_height ?? null,
        block_time: tx.status.block_time ? unixIso(tx.status.block_time) : null,
        fee_sats: coinbase ? null : tx.fee,
        vsize_vb: vsize,
        inputs: tx.vin.length,
        outputs: tx.vout.length,
        total_output_btc: outputs / 1e8,
        coinbase,
        blocks: { facts: factsBlock(facts, "Transaction"), sources },
      };
    }
    if (kind === "address") {
      if (!/^[a-zA-Z0-9]{25,90}$/.test(value))
        throw new SourceError("That is not a Bitcoin address.");
      const a = await brkJson<Address>(`/api/address/${value}`, log);
      const confirmed =
        a.chain_stats.balance ??
        a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum;
      const pending =
        a.mempool_stats.balance_delta ??
        a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum;
      const genesis = a.address === GENESIS_ADDRESS;
      const facts: Fact[] = [
        { label: "Address", value: a.address, mono: true },
        { label: "Confirmed balance", value: btc(confirmed) },
        ...(pending
          ? [{ label: "Unconfirmed change", value: btc(pending) }]
          : []),
        { label: "Received", value: btc(a.chain_stats.funded_txo_sum) },
        { label: "Sent", value: btc(a.chain_stats.spent_txo_sum) },
        {
          label: "Transactions",
          value: a.chain_stats.tx_count.toLocaleString("en-US"),
        },
      ];
      return {
        address: a.address,
        confirmed_balance_btc: confirmed / 1e8,
        unconfirmed_change_btc: pending / 1e8,
        received_btc: a.chain_stats.funded_txo_sum / 1e8,
        sent_btc: a.chain_stats.spent_txo_sum / 1e8,
        transactions: a.chain_stats.tx_count,
        brk_realized_price_estimate_usd: a.chain_stats.realized_price ?? null,
        notes: [
          ...(genesis ? [GENESIS_NOTE] : []),
          "One address is not a wallet; add no owner or entity labels.",
          "realized_price is BRK's own cost-basis estimate, not what the owner paid.",
        ],
        blocks: { facts: factsBlock(facts, "Address"), sources },
      };
    }
    let hash = value;
    if (/^\d{1,7}$/.test(value))
      hash = (await brkText(`/api/block-height/${value}`, log)).trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hash))
      throw new SourceError("A block is a height or a 64-character hash.");
    const b = await brkJson<Block>(`/api/v1/block/${hash}`, log).catch(() =>
      brkJson<Block>(`/api/block/${hash}`, log),
    );
    const facts: Fact[] = [
      { label: "Height", value: String(b.height) },
      { label: "Hash", value: b.id, mono: true },
      { label: "Time", value: unixIso(b.timestamp) },
      { label: "Transactions", value: b.tx_count.toLocaleString("en-US") },
      {
        label: "Size",
        value:
          b.size < 100_000
            ? `${b.size.toLocaleString("en-US")} bytes`
            : `${(b.size / 1e6).toFixed(2)} MB (${(b.weight / 1e6).toFixed(2)} MWU)`,
      },
      ...(b.extras?.pool?.name && b.extras.pool.name !== "Unknown"
        ? [{ label: "Pool (by tag)", value: b.extras.pool.name }]
        : []),
      ...(b.extras?.totalFees !== undefined
        ? [{ label: "Fees", value: btc(b.extras.totalFees) }]
        : []),
    ];
    return {
      height: b.height,
      hash: b.id,
      time: unixIso(b.timestamp),
      transactions: b.tx_count,
      pool: b.extras?.pool?.name ?? null,
      fees_btc:
        b.extras?.totalFees !== undefined ? b.extras.totalFees / 1e8 : null,
      blocks: { facts: factsBlock(facts, "Block"), sources },
    };
  },
});

/** Numbers parsed from BRK's CSV; blanks are null. */
export function parseSeriesCsv(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(
      header.map((h, i) => {
        const cell = cells[i] ?? "";
        if (h === "date") return [h, cell.slice(0, 10)];
        const n = cell === "" ? null : Number(cell);
        return [h, n !== null && Number.isFinite(n) ? n : cell || null];
      }),
    ) as Record<string, string | number | null>;
  });
  return { header, rows };
}

/** First, last, low and high of each numeric column. */
export function summarize(
  rows: Record<string, string | number | null>[],
  columns: string[],
) {
  return Object.fromEntries(
    columns.map((c) => {
      const points = rows
        .map((r) => [r.date as string, r[c]] as const)
        .filter(
          (p): p is readonly [string, number] => typeof p[1] === "number",
        );
      if (!points.length) return [c, null];
      let low = points[0];
      let high = points[0];
      for (const p of points) {
        if (p[1] < low[1]) low = p;
        if (p[1] > high[1]) high = p;
      }
      const first = points[0];
      const last = points[points.length - 1];
      return [
        c,
        {
          first: { date: first[0], value: first[1] },
          last: { date: last[0], value: last[1] },
          low: { date: low[0], value: low[1] },
          high: { date: high[0], value: high[1] },
          change: first[1] ? last[1] / first[1] - 1 : null,
        },
      ];
    }),
  );
}

/** Every nth row plus the last, so the model sees the shape without every value. */
export function thin<T>(rows: T[], max: number) {
  if (rows.length <= max) return { rows, note: undefined };
  const step = Math.ceil(rows.length / max);
  const kept = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  return {
    rows: kept,
    note: `Thinned to ${kept.length} of ${rows.length} rows (every ${step}th plus the last); the summary uses every row.`,
  };
}

/** Series rows from BRK's bulk route, completed UTC days only on day1. */
export async function brkRows(
  options: {
    series: string[];
    index?: string;
    start?: string;
    end?: string;
    lastDays?: number;
  },
  log: FetchLog,
  now: Date,
) {
  const index = options.index ?? "day1";
  const names = options.series.filter((n) => n !== "date");
  if (!names.length || names.length > 6)
    throw new SourceError("Ask for 1 to 6 series at a time.");
  for (const n of names)
    if (!/^[a-z0-9_]{1,80}$/.test(n))
      throw new SourceError(`"${n}" is not a series name`);
  const params = new URLSearchParams({
    index,
    series: ["date", ...names].join(","),
    format: "csv",
  });
  if (options.lastDays) params.set("start", String(-(options.lastDays + 1)));
  else params.set("start", options.start ?? "-366");
  if (options.end) params.set("end", options.end);
  const text = await fetchText(`${BRK}/api/series/bulk?${params}`, {
    log,
    maxBytes: 8 * 1024 ** 2,
  });
  const { rows } = parseSeriesCsv(text);
  const today = isoDay(now);
  // BRK's last day1 row can be today's unfinished UTC day.
  const done =
    index === "day1" ? rows.filter((r) => (r.date as string) < today) : rows;
  return { names, rows: done, dropped_today: done.length < rows.length };
}

export const brkSeries = tool<{
  series: string[];
  index: string | null;
  start: string | null;
  end: string | null;
  last_days: number | null;
}>({
  name: "brk_series",
  label: "Checking a data source",
  description:
    "Historical values of up to 6 BRK series on one index (default day1), with summary statistics. Daily rows are completed UTC days only. start is inclusive and end exclusive (YYYY-MM-DD); last_days gives a trailing window. At most 400 rows come back (thinned for longer ranges); the summary covers every row. For a chart, use save_chart instead of copying values.",
  parameters: s.object({
    series: s.list(
      s.str("A BRK series name, such as price_close or realized_price"),
      "Series names",
    ),
    index: s.nullable(
      s.oneOf(["day1", "week1", "month1", "height"], "The index; default day1"),
    ),
    start: s.nullable(s.str("First date, YYYY-MM-DD")),
    end: s.nullable(s.str("End date (exclusive), YYYY-MM-DD")),
    last_days: s.nullable(
      s.int("Trailing completed days instead of start/end"),
    ),
  }),
  async run(args, { log, now }) {
    const { names, rows, dropped_today } = await brkRows(
      {
        series: args.series,
        index: opt(args.index),
        start: opt(args.start),
        end: opt(args.end),
        lastDays: opt(args.last_days),
      },
      log,
      now,
    );
    const thinned = thin(rows, 400);
    return {
      series: names,
      index: args.index ?? "day1",
      rows: thinned.rows,
      total_rows: rows.length,
      summary: summarize(rows, names),
      ...(thinned.note ? { note: thinned.note } : {}),
      ...(dropped_today
        ? { today: "Today's unfinished UTC row was left out." }
        : {}),
      blocks: {
        sources: sourcesBlock([
          {
            name: "BRK",
            detail: names.join(", ").slice(0, 60),
            url: BRK,
            ...(rows.length
              ? { asOf: rows[rows.length - 1].date as string }
              : {}),
          },
        ]),
      },
    };
  },
});

export const brkSeriesSearch = tool<{ query: string }>({
  name: "brk_series_search",
  label: "Checking a data source",
  description:
    "Finds BRK series names for a concept (velocity, profit, hash, supply, realized) and describes the closest matches with their meaning and indexes. Use before brk_series when the name is not certain.",
  parameters: s.object({
    query: s.str("A short concept, such as 'realized price' or 'hash rate'"),
  }),
  async run({ query }, { log }) {
    const names = await brkJson<string[]>(
      `/api/series/search?${new URLSearchParams({ q: query, limit: "20" })}`,
      log,
    );
    const described = await Promise.all(
      names.slice(0, 4).map(async (name) => {
        const d = await brkJson<{ description?: string; indexes?: string[] }>(
          `/api/series/${name}`,
          log,
        ).catch(() => null);
        return {
          name,
          description: d?.description ?? null,
          daily: d?.indexes?.includes("day1") ?? null,
        };
      }),
    );
    return { matches: names, described };
  },
});
