import { FORMATS, parseBlock, type Format } from "../blocks";

// Answer blocks built on the server from tool results (a port of the
// data-analysis skill's answer_blocks.py). Each builder returns the fenced
// `a21-*` block the website draws, already checked by its parser, so the model
// pastes it instead of writing JSON. A builder throws only where the website
// would refuse the block, or where a percent or change value is plainly in the
// wrong unit.

const KINDS = ["observed", "calculated", "outlook", "market"] as const;
const NUMBER_FORMATS: readonly Format[] = FORMATS.filter(
  (f) => f !== "text" && f !== "date",
);
const FRACTION_FORMATS = new Set<Format>(["percent", "change"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

export class BlockError extends Error {
  name = "BlockError";
}

function fence(type: string, data: unknown) {
  const code = JSON.stringify(data);
  const parsed = parseBlock(`a21-${type}`, code);
  if (!parsed.ok) throw new BlockError(`${type} block: ${parsed.reason}`);
  return "```a21-" + type + "\n" + code + "\n```";
}
const text = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim())
    throw new BlockError(`${field} needs text`);
  return value.trim();
};
const finite = (value: unknown, field: string) => {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) throw new BlockError(`${field} needs a number`);
  return n;
};
/** Percent and change values are fractions: 0.15 shows as 15%. */
function fraction(value: number, field: string, largeOk: boolean) {
  if (!largeOk && Math.abs(value) >= 10)
    throw new BlockError(
      `${field} ${value} would show as ${Math.round(value * 100)}%: percent and change take fractions (0.15 for 15%); use usd for dollar gaps`,
    );
  return value;
}
/** An ISO date or UTC time ending in Z, or undefined. */
export function when(value: unknown) {
  if (typeof value !== "string") return undefined;
  return ISO_DATE.test(value) || ISO_TIME.test(value) ? value : undefined;
}

export function stepBlock(sentence: string) {
  return fence("step", { text: text(sentence, "step text") });
}

export type Figure = {
  label: string;
  value: number;
  format?: Format;
  change?: number;
  changeLabel?: string;
  asOf?: string;
  kind?: (typeof KINDS)[number];
};
export function figuresBlock(items: Figure[], largeOk = false) {
  if (!items.length) throw new BlockError("figures need at least one item");
  return fence("figures", {
    items: items.map((item) => {
      const value = finite(item.value, "figure value");
      const format =
        item.format && NUMBER_FORMATS.includes(item.format)
          ? item.format
          : undefined;
      if (format && FRACTION_FORMATS.has(format))
        fraction(value, "figure value", largeOk);
      return {
        label: text(item.label, "figure label"),
        value,
        ...(format ? { format } : {}),
        ...(item.change !== undefined
          ? {
              change: fraction(
                finite(item.change, "figure change"),
                "figure change",
                largeOk,
              ),
            }
          : {}),
        ...(item.changeLabel ? { changeLabel: item.changeLabel } : {}),
        ...(when(item.asOf) ? { asOf: item.asOf } : {}),
        ...(item.kind && KINDS.includes(item.kind) ? { kind: item.kind } : {}),
      };
    }),
  });
}

export type Fact = {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
};
export function factsBlock(rows: Fact[], title?: string) {
  if (!rows.length) throw new BlockError("fact sheets need at least one row");
  return fence("facts", {
    ...(title?.trim() ? { title: title.trim() } : {}),
    rows: rows.map((row) => ({
      label: text(row.label, "fact label"),
      value: text(String(row.value), "fact value"),
      ...(row.href ? { href: row.href } : {}),
      ...(row.mono ? { mono: true } : {}),
    })),
  });
}

export type Column = { label: string; format?: Format };
export function tableBlock(
  rows: (string | number | null)[][],
  columns: Column[],
  caption: string,
  note?: string,
  largeOk = false,
) {
  rows.forEach((row, r) => {
    if (row.length !== columns.length)
      throw new BlockError(
        `row ${r + 1} has ${row.length} cells for ${columns.length} columns`,
      );
    columns.forEach((column, c) => {
      const cell = row[c];
      if (
        column.format &&
        FRACTION_FORMATS.has(column.format) &&
        typeof cell === "number"
      )
        fraction(cell, `row ${r + 1} ${column.label}`, largeOk);
    });
  });
  return fence("table", {
    caption: text(caption, "table caption"),
    columns: columns.map((c) => ({
      label: text(c.label, "column label"),
      ...(c.format && FORMATS.includes(c.format) ? { format: c.format } : {}),
    })),
    rows,
    ...(note?.trim() ? { note: note.trim() } : {}),
  });
}

export type Level = { value: number; label?: string; odds?: number };
export function ladderBlock(
  title: string,
  now: number,
  levels: Level[],
  options: {
    measure?: "distance" | "odds";
    nowLabel?: string;
    market?: { name: string; url: string; volume: number; liquidity: number };
  } = {},
) {
  const measure = options.measure ?? "distance";
  if (measure === "odds" && !options.market)
    throw new BlockError("odds need the market, its volume and liquidity");
  return fence("ladder", {
    title: text(title, "ladder title"),
    now: { label: options.nowLabel ?? "Now", value: finite(now, "now") },
    measure,
    levels: levels.map((level) => ({
      value: finite(level.value, "level value"),
      ...(level.label ? { label: level.label } : {}),
      ...(measure === "odds" ? { odds: finite(level.odds, "level odds") } : {}),
    })),
    ...(measure === "odds" ? { market: options.market } : {}),
  });
}

export function chartBlock(file: string, page?: string, caption?: string) {
  return fence("chart", {
    file,
    ...(page ? { page } : {}),
    ...(caption ? { caption } : {}),
  });
}

export type Source = {
  name: string;
  detail?: string;
  url?: string;
  asOf?: string;
  published?: string;
};
export function sourcesBlock(items: Source[]) {
  if (!items.length) throw new BlockError("sources need at least one item");
  return fence("sources", {
    items: items.map((item) => ({
      name: text(item.name, "source name"),
      ...(item.detail ? { detail: item.detail } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(when(item.asOf)
        ? { asOf: item.asOf }
        : item.published && ISO_DATE.test(item.published)
          ? { published: item.published }
          : {}),
    })),
  });
}
